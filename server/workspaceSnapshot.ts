import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SQLITE_SCHEMA_VERSION, UNIFIED_SQLITE_TABLES } from "./sqliteSchema.ts";
import { SqliteValidationError, withTransaction } from "./sqliteDb.ts";

type Row = Record<string, string | number | null>;
export type WorkspaceSnapshot = {
  format: "nasqo-workspace-tables-v1";
  schemaVersion: number;
  tables: Record<string, Row[]>;
  sha256: string;
};

const fail = (detail: string): never => {
  throw new SqliteValidationError(`لم تُستعد النسخة: ${detail}. لم تتغير بيانات العمل.`);
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function checksum(value: Omit<WorkspaceSnapshot, "sha256">): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** A data-only manifest: no DDL, SQL, triggers or executable backup contents. */
export function snapshotFromTables(tables: Record<string, unknown[]>): WorkspaceSnapshot {
  const payload = { format: "nasqo-workspace-tables-v1" as const, schemaVersion: SQLITE_SCHEMA_VERSION, tables: tables as Record<string, Row[]> };
  return { ...payload, sha256: checksum(payload) };
}

export function captureWorkspaceSnapshot(db: DatabaseSync, workspaceId: string): WorkspaceSnapshot {
  return withTransaction(db, () => snapshotFromTables(Object.fromEntries(UNIFIED_SQLITE_TABLES.map(table => [
    table, db.prepare(`SELECT * FROM "${table}" WHERE ${table === "workspaces" ? "id" : "workspace_id"} = ? ORDER BY rowid`).all(workspaceId),
  ]))));
}

function validate(db: DatabaseSync, input: unknown): WorkspaceSnapshot {
  if (!object(input) || input.format !== "nasqo-workspace-tables-v1" || input.schemaVersion !== SQLITE_SCHEMA_VERSION || !object(input.tables)) {
    return fail("صيغة قائمة الجداول أو إصدارها غير مدعوم");
  }
  const tables = input.tables;
  if (Object.keys(tables).length !== UNIFIED_SQLITE_TABLES.length || UNIFIED_SQLITE_TABLES.some(t => !Array.isArray(tables[t]))) {
    return fail("قائمة الجداول غير مكتملة؛ لا يمكن استبدال العمل بنسخة جزئية");
  }
  const snapshot = input as unknown as WorkspaceSnapshot;
  const { format, schemaVersion, sha256 } = snapshot;
  if (typeof sha256 !== "string" || sha256 !== checksum({ format, schemaVersion, tables: snapshot.tables })) return fail("بصمة محتوى الجداول غير متطابقة");
  const workspaces = snapshot.tables.workspaces;
  if (workspaces.length !== 1 || !object(workspaces[0]) || typeof workspaces[0].id !== "string" || !workspaces[0].id) return fail("يجب أن تحتوي النسخة منشأة واحدة محددة");
  const sourceWorkspace = workspaces[0].id;
  let total = 0;
  for (const table of UNIFIED_SQLITE_TABLES) {
    const info = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; pk: number }[];
    const columns = new Set(info.map(c => c.name));
    const primary = info.filter(c => c.pk).map(c => c.name);
    const rows = snapshot.tables[table];
    total += rows.length;
    if (total > 1_000_000) return fail("حجم الجداول يتجاوز الحد المدعوم");
    for (const row of rows) {
      if (!object(row) || Object.keys(row).length === 0 || Object.keys(row).some(k => !columns.has(k))) return fail(`أعمدة الجدول ${table} غير مدعومة`);
      if (primary.some(key => row[key] === undefined || row[key] === null || row[key] === "")) return fail(`معرّف صف في ${table} غير مكتمل`);
      if (table !== "workspaces" && row.workspace_id !== sourceWorkspace) return fail(`منشأة الصف في ${table} لا تطابق النسخة`);
      if (Object.values(row).some(v => v !== null && typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v)))) return fail(`قيمة غير صالحة في ${table}`);
    }
  }
  // SQLite IDs are global. A restored row must never bind to a record from a
  // different workspace merely because that ID already exists locally.
  const targets = new Map<string, Set<unknown>>();
  for (const table of UNIFIED_SQLITE_TABLES) {
    const links = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as {table: string; from: string; to: string}[];
    for (const link of links) {
      const key = `${link.table}.${link.to}`;
      if (!targets.has(key)) targets.set(key, new Set((snapshot.tables[link.table] ?? []).map(row => row[link.to])));
      for (const row of snapshot.tables[table]) {
        if (row[link.from] !== null && row[link.from] !== undefined && !targets.get(key)!.has(row[link.from])) {
          return fail(`علاقة ${table}.${link.from} لا تشير إلى سجل داخل النسخة`);
        }
      }
    }
  }
  const journalTotals = new Map<unknown, {count: number; debit: number; credit: number}>();
  for (const line of snapshot.tables.journal_entry_lines) {
    if (![line.debit_minor,line.credit_minor].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)) return fail("مبلغ بند اليومية ليس بوحدات نقدية صحيحة");
    const total = journalTotals.get(line.journal_id) ?? {count: 0, debit: 0, credit: 0};
    total.count++; total.debit += Number(line.debit_minor); total.credit += Number(line.credit_minor);
    journalTotals.set(line.journal_id,total);
  }
  for (const journal of snapshot.tables.journal_entries) {
    if (journal.posting_status === "draft") continue;
    const {count,debit,credit} = journalTotals.get(journal.id) ?? {count:0,debit:0,credit:0};
    if (count < 2 || !Number.isSafeInteger(debit) || debit <= 0 || debit !== credit ||
        journal.total_debit_minor !== debit || journal.total_credit_minor !== credit) return fail("قيد يومية مرحّل لا يطابق بنوده المتوازنة");
  }
  return snapshot;
}

/** Exact rows/values, preserving journal IDs, archives and historical posting state. */
export function restoreWorkspaceSnapshot(db: DatabaseSync, workspaceId: string, input: unknown) {
  const snapshot = validate(db, input);
  return withTransaction(db, () => {
    // Deferred relationships allow source rows to refer to later tables. The
    // final FK check is explicit; any failure rolls the entire replacement back.
    db.exec("PRAGMA defer_foreign_keys = ON");
    db.prepare("DELETE FROM audit_log WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
    for (const table of UNIFIED_SQLITE_TABLES) {
      for (const source of snapshot.tables[table]) {
        const row: Row = { ...source };
        if (table === "workspaces") { row.id = workspaceId; row.owner_id = workspaceId; }
        else row.workspace_id = workspaceId;
        const keys = Object.keys(row);
        try {
          db.prepare(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map(k => row[k]));
        } catch {
          return fail(`تعذر استعادة ${table} بسبب قيمة أو علاقة أو معرّف متعارض`);
        }
      }
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length) return fail("علاقات الجداول غير مكتملة");
    const n = (table: string) => snapshot.tables[table].length;
    return { accountGroups: n("account_groups"), accounts: n("accounts"), warehouses: n("warehouses"), inventory: n("inventory_items"), ledger: n("ledger_entries"), invoiceLines: n("invoice_lines"), stockTransfers: n("stock_transfers"), priceOffers: n("price_offers"), journalEntries: n("journal_entries"), archivedDocuments: n("archived_documents"), tables: UNIFIED_SQLITE_TABLES.length };
  });
}
