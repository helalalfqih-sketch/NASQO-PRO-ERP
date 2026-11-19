import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  billTypeEvidence,
  buildMasterData,
  createEmptyErpData,
  GROUP_CATEGORY_BY_NAME,
  livePrefix,
  reviewMoves,
  suggestGroupCategories,
  summarizeReview,
  type BillTypeEvidence,
  type MoveReview,
  type Row,
  type Tables,
} from "./sqliteRuntimeSupport.ts";
import type { AccountCategory, CurrencyCode } from "../src/types.ts";
import {
  classifyBoundsDocType,
  inferCategoryFromGroupName,
  mapCurrencyCode,
} from "./smartproSqlImporter.ts";
import {
  DEFAULT_WORKSPACE_ID,
  SqliteValidationError,
  ensureEmptyWorkspace,
  saveErpDataRows,
  withTransaction,
  writeAudit,
} from "./sqliteDb.ts";

export function isSqliteSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 15) return false;
  return Buffer.from(bytes.subarray(0, 15)).toString("ascii") === "SQLite format 3";
}

function withReadonlySqliteBytes<T>(bytes: Uint8Array, fn: (srcDb: DatabaseSync) => T): T {
  if (!isSqliteSignature(bytes)) {
    throw new Error("الملف لا يبدأ بتوقيع SQLite format 3 الصحيح.");
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nasqo-upload-"));
  const tmpFile = path.join(tmpDir, "source.sqlite");
  try {
    fs.writeFileSync(tmpFile, bytes);
    const srcDb = new DatabaseSync(tmpFile, { readOnly: true });
    try {
      return fn(srcDb);
    } finally {
      srcDb.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function inspectAndExtractLegacySqlite(bytes: Uint8Array): {
  sha256: string;
  integrity: string;
  tables: Tables;
  tableCounts: Record<string, number>;
  totalRows: number;
  evidence: BillTypeEvidence[];
  reviews: MoveReview[];
  reviewSummary: ReturnType<typeof summarizeReview>;
} {
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return withReadonlySqliteBytes(bytes, (srcDb) => {
    const integrityRow = srcDb.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
    const integrity = integrityRow ? String(Object.values(integrityRow)[0] ?? "ok") : "ok";

    const tableRows = srcDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];

    const tables: Tables = {};
    const tableCounts: Record<string, number> = {};
    let totalRows = 0;

    for (const { name } of tableRows) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      const rows = srcDb.prepare(`SELECT * FROM "${name}"`).all() as Row[];
      tables[name] = rows;
      tableCounts[name] = rows.length;
      totalRows += rows.length;
    }

    const evidence = billTypeEvidence(tables);
    const { reviews } = reviewMoves(tables);
    const reviewSummary = summarizeReview(reviews);
    return { sha256, integrity, tables, tableCounts, totalRows, evidence, reviews, reviewSummary };
  });
}

function asNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(String(v).replace(/[,٬\s]/g, "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function asInt(v: unknown, fallback = 0): number {
  return Math.trunc(asNum(v, fallback));
}

function asText(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function isoDateFromMove(r: Row): string {
  const y = asInt(r.year);
  const m = asInt(r.month);
  const d = asInt(r.day);
  if (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const nd = asText(r.ndate);
  if (/^\d{8}$/.test(nd) && nd !== "00000000") {
    return `${nd.slice(0, 4)}-${nd.slice(4, 6)}-${nd.slice(6, 8)}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function normalizeAr(v: string): string {
  return v.replace(/[\u064B-\u065F\u0640]/g, "").replace(/\s+/g, " ").trim();
}

function restoreNativeUnifiedSqlite(
  db: DatabaseSync,
  tables: Tables,
  sha256: string,
  integrity: string,
  tableCounts: Record<string, number>,
  totalRows: number,
  workspaceId: string,
  fileName: string,
) {
  const now = new Date().toISOString();
  const wsSrc = (tables.workspaces?.[0] ?? {}) as Row;

  return withTransaction(db, () => {
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, company_name, default_currency, whatsapp_provider, whatsapp_instant_enabled, whatsapp_phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      workspaceId,
      workspaceId,
      asText(wsSrc.company_name) || "نسقو برو",
      asText(wsSrc.default_currency) || "ريال",
      asText(wsSrc.whatsapp_provider) || "nasqo",
      asInt(wsSrc.whatsapp_instant_enabled, 0),
      asText(wsSrc.whatsapp_phone),
      asText(wsSrc.created_at) || now,
      now,
    );

    const insCur = db.prepare(
      `INSERT INTO currencies (workspace_id, code, name, symbol, rate_primary, rate_secondary, name_secondary, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of tables.currencies ?? []) {
      insCur.run(
        workspaceId, asText(r.code) || "ريال", asText(r.name) || "ريال", asText(r.symbol),
        asNum(r.rate_primary, 1) || 1, asNum(r.rate_secondary, 1) || 1, asText(r.name_secondary),
        r.legacy_id != null ? asInt(r.legacy_id) : null,
      );
    }

    const groupMap = new Map<number, number>();
    const insGrp = db.prepare(
      `INSERT INTO account_groups (workspace_id, name, category, currency_code, has_bill, is_employee, sort_order, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const g of tables.account_groups ?? []) {
      const oldId = asInt(g.id);
      const res = insGrp.run(
        workspaceId, asText(g.name), asText(g.category) || "shop", asText(g.currency_code) || "ريال",
        asInt(g.has_bill), asInt(g.is_employee), asInt(g.sort_order),
        g.legacy_id != null ? asInt(g.legacy_id) : oldId || null,
      );
      if (oldId) groupMap.set(oldId, Number(res.lastInsertRowid));
    }

    const cbMap = new Map<number, number>();
    const insCb = db.prepare(
      `INSERT INTO cashboxes (workspace_id, name, details, state, currency_code, box_type, sort_order, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const cb of tables.cashboxes ?? []) {
      const oldId = asInt(cb.id);
      const res = insCb.run(
        workspaceId, asText(cb.name), asText(cb.details), asInt(cb.state, 1),
        asText(cb.currency_code) || "ريال", asInt(cb.box_type, 1), asInt(cb.sort_order),
        cb.legacy_id != null ? asInt(cb.legacy_id) : oldId || null,
      );
      if (oldId) cbMap.set(oldId, Number(res.lastInsertRowid));
    }

    const whIds = new Set<string>();
    const insWh = db.prepare(
      `INSERT INTO warehouses (id, workspace_id, code_number, name, details, is_default, state, legacy_id, legacy_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    );
    let warehousesAdded = 0;
    for (const w of tables.warehouses ?? []) {
      const wid = asText(w.id) || `wh_${warehousesAdded + 1}`;
      const res = insWh.run(
        wid, workspaceId, asInt(w.code_number, 1), asText(w.name), asText(w.details),
        asInt(w.is_default), asInt(w.state, 1), w.legacy_id != null ? asInt(w.legacy_id) : null,
        w.legacy_ref ? asText(w.legacy_ref) : null, asText(w.created_at) || now, asText(w.updated_at) || now,
      );
      if (Number(res.changes) > 0) warehousesAdded += 1;
      whIds.add(wid);
    }

    const insAcc = db.prepare(
      `INSERT INTO accounts (
         id, workspace_id, group_id, code_number, name, category, phone, credit_limit, currency,
         is_cash_account, account_image, sort_order, settlement, document_number_required,
         message_method, send_mode, tax_number, note, opening_balance, opening_direction,
         legacy_id, legacy_ref, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    );
    let accountsAdded = 0;
    for (const a of tables.accounts ?? []) {
      const aid = asText(a.id) || `acc_${accountsAdded + 1}`;
      const gid = a.group_id != null ? (groupMap.get(asInt(a.group_id)) ?? null) : null;
      const res = insAcc.run(
        aid, workspaceId, gid, asInt(a.code_number, 1), asText(a.name), asText(a.category) || "shop",
        asText(a.phone), asNum(a.credit_limit, 0), asText(a.currency) || "ريال", asInt(a.is_cash_account),
        asText(a.account_image) || "1", asInt(a.sort_order, 1), asInt(a.settlement), asInt(a.document_number_required),
        asText(a.message_method) || "sms", asText(a.send_mode) || "never", asText(a.tax_number), asText(a.note),
        asNum(a.opening_balance, 0), asText(a.opening_direction) === "credit" ? "credit" : "debit",
        a.legacy_id != null ? asInt(a.legacy_id) : null, a.legacy_ref ? asText(a.legacy_ref) : null,
        asText(a.created_at) || now, asText(a.updated_at) || now,
      );
      if (Number(res.changes) > 0) accountsAdded += 1;
    }

    const defaultWh = [...whIds][0] ?? "";
    const insInv = db.prepare(
      `INSERT INTO inventory_items (
         id, workspace_id, warehouse_id, name, unit, quantity, avg_cost, selling_price,
         min_threshold, sku, unit2, count2, sprice2, unit3, count3, sprice3,
         default_unit, expiry_date, has_expiry, currency_code, bstate,
         quantity_unverified, legacy_id, legacy_ref, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    );
    let inventoryAdded = 0;
    for (const i of tables.inventory_items ?? []) {
      const wid = whIds.has(asText(i.warehouse_id)) ? asText(i.warehouse_id) : defaultWh;
      if (!wid) continue;
      const res = insInv.run(
        asText(i.id) || `inv_${inventoryAdded + 1}`, workspaceId, wid, asText(i.name), asText(i.unit) || "حبة",
        asNum(i.quantity, 0), asNum(i.avg_cost, 0), i.selling_price != null ? asNum(i.selling_price) : null,
        i.min_threshold != null ? asNum(i.min_threshold) : 25, asText(i.sku), asText(i.unit2),
        i.count2 != null ? asNum(i.count2) : null, i.sprice2 != null ? asNum(i.sprice2) : null, asText(i.unit3),
        i.count3 != null ? asNum(i.count3) : null, i.sprice3 != null ? asNum(i.sprice3) : null,
        asInt(i.default_unit, 1), i.expiry_date ? asText(i.expiry_date) : null, asInt(i.has_expiry),
        asText(i.currency_code) || "ريال", asInt(i.bstate, 1), asInt(i.quantity_unverified),
        i.legacy_id != null ? asInt(i.legacy_id) : null, i.legacy_ref ? asText(i.legacy_ref) : null,
        asText(i.created_at) || now, asText(i.updated_at) || now,
      );
      if (Number(res.changes) > 0) inventoryAdded += 1;
    }

    const insEnt = db.prepare(
      `INSERT INTO ledger_entries (
         id, workspace_id, account_id, account_name, counterpart_account_id, counterpart_account_name, cashbox_id,
         kind, type_label, payment, direction, amount, raw_dain, raw_madin, settled_on_receipt, currency, exchange_rate,
         details, document_number, warehouse_id, warehouse_name, invoice_content, entry_number, deleted, entry_date,
         due_date, expense_category, delivery_days, sender, receiver, company_name, discount, tax_amount, bonus,
         doc_type, bstate, source_origin, posting_status, created_at_ms, legacy_id, legacy_ref
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    let ledgerAdded = 0;
    for (const e of tables.ledger_entries ?? []) {
      const cbId = e.cashbox_id != null ? (cbMap.get(asInt(e.cashbox_id)) ?? null) : null;
      const res = insEnt.run(
        asText(e.id) || `ent_${ledgerAdded + 1}`, workspaceId, asText(e.account_id), asText(e.account_name),
        asText(e.counterpart_account_id), asText(e.counterpart_account_name), cbId,
        asText(e.kind) || "voucher", asText(e.type_label) || "سند", asText(e.payment) || "credit",
        asText(e.direction) === "credit" ? "credit" : "debit", asNum(e.amount, 0),
        e.raw_dain != null ? asNum(e.raw_dain) : null, e.raw_madin != null ? asNum(e.raw_madin) : null,
        asInt(e.settled_on_receipt), asText(e.currency) || "ريال", asNum(e.exchange_rate, 1) || 1,
        asText(e.details), asText(e.document_number), asText(e.warehouse_id), asText(e.warehouse_name),
        asText(e.invoice_content) || "none", asInt(e.entry_number, 1), asInt(e.deleted), asText(e.entry_date),
        e.due_date ? asText(e.due_date) : null, e.expense_category ? asText(e.expense_category) : null,
        e.delivery_days != null ? asInt(e.delivery_days) : null, asText(e.sender), asText(e.receiver),
        asText(e.company_name), asNum(e.discount, 0), asNum(e.tax_amount, 0), asNum(e.bonus, 0),
        e.doc_type != null ? asInt(e.doc_type) : null, e.bstate != null ? asInt(e.bstate) : null,
        asText(e.source_origin) || "native", asText(e.posting_status) || "posted",
        asNum(e.created_at_ms, Date.now()), e.legacy_id != null ? asInt(e.legacy_id) : null,
        e.legacy_ref ? asText(e.legacy_ref) : null,
      );
      if (Number(res.changes) > 0) ledgerAdded += 1;
    }

    const insLine = db.prepare(
      `INSERT INTO invoice_lines (
         workspace_id, entry_id, line_kind, inventory_item_id, warehouse_id, item_name,
         price, quantity, total, discount, bonus, unit, unit_num, details, expiry_date, legacy_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let linesAdded = 0;
    for (const l of tables.invoice_lines ?? []) {
      insLine.run(
        workspaceId, asText(l.entry_id), asText(l.line_kind) || "item",
        l.inventory_item_id ? asText(l.inventory_item_id) : null,
        l.warehouse_id ? asText(l.warehouse_id) : null,
        asText(l.item_name), asNum(l.price, 0), asNum(l.quantity, 0), asNum(l.total, 0),
        asNum(l.discount, 0), asNum(l.bonus, 0), asText(l.unit), asInt(l.unit_num, 1),
        asText(l.details), asText(l.expiry_date), l.legacy_id != null ? asInt(l.legacy_id) : null,
      );
      linesAdded += 1;
    }

    const erpBase = createEmptyErpData();
    const parseArr = <T>(rows: Row[] | undefined, mapFn: (r: Row) => T): T[] => (rows ?? []).map(mapFn);
    saveErpDataRows(db, workspaceId, {
      employees: parseArr(tables.erp_employees, (r) => ({
        id: asText(r.id),
        ...(r.account_id ? { accountId: asText(r.account_id) } : {}),
        name: asText(r.name),
        roleTitle: asText(r.role_title),
        department: asText(r.department),
        basicSalary: asNum(r.basic_salary, 0),
        allowances: asNum(r.allowances, 0),
        deductions: asNum(r.deductions, 0),
        status: (asText(r.status) || "active") as "active" | "on-leave" | "inactive",
        hireDate: asText(r.hire_date),
        leaveBalanceDays: asNum(r.leave_balance_days, 0),
        attendanceToday: (asText(r.attendance_today) || "present") as "present" | "leave" | "absent",
      })),
      leaveRequests: parseArr(tables.erp_leave_requests, (r) => ({
        id: asText(r.id),
        employeeId: asText(r.employee_id),
        employeeName: asText(r.employee_name),
        leaveType: (asText(r.leave_type) || "سنوية") as "سنوية" | "مرضية" | "اضطرارية",
        startDate: asText(r.start_date),
        days: asNum(r.days, 1),
        status: (asText(r.status) || "pending") as "pending" | "approved" | "rejected",
        note: asText(r.note),
      })),
      deals: parseArr(tables.erp_deals, (r) => ({
        id: asText(r.id),
        title: asText(r.title),
        clientAccountId: asText(r.client_account_id),
        clientName: asText(r.client_name),
        value: asNum(r.value, 0),
        currency: (asText(r.currency) || "ريال") as CurrencyCode,
        stage: (
          ["lead", "proposal", "negotiation", "won", "lost"].includes(asText(r.stage))
            ? asText(r.stage)
            : "lead"
        ) as "lead" | "proposal" | "negotiation" | "won" | "lost",
        probability: asNum(r.probability, 50),
        expectedCloseDate: asText(r.expected_close_date),
        assignedTo: asText(r.assigned_to),
        ...(r.converted_invoice_entry_id ? { convertedInvoiceEntryId: asText(r.converted_invoice_entry_id) } : {}),
      })),
      purchaseOrders: parseArr(tables.erp_purchase_orders, (r) => ({
        id: asText(r.id),
        poNumber: asText(r.po_number),
        supplierAccountId: asText(r.supplier_account_id),
        supplierName: asText(r.supplier_name),
        warehouseId: asText(r.warehouse_id),
        warehouseName: asText(r.warehouse_name),
        currency: (asText(r.currency) || "ريال") as CurrencyCode,
        orderDate: asText(r.order_date),
        expectedDate: asText(r.expected_date),
        status: (asText(r.status) || "draft") as "draft" | "approved" | "received",
        lines: JSON.parse(asText(r.lines_json) || "[]"),
        notes: asText(r.notes),
        ...(r.posted_ledger_entry_id ? { postedLedgerEntryId: asText(r.posted_ledger_entry_id) } : {}),
      })),
      boms: parseArr(tables.erp_boms, (r) => ({
        id: asText(r.id),
        name: asText(r.name),
        finishedItemId: asText(r.finished_item_id),
        finishedItemName: asText(r.finished_item_name),
        finishedUnit: asText(r.finished_unit) || "حبة",
        components: JSON.parse(asText(r.components_json) || "[]"),
      })),
      productionOrders: parseArr(tables.erp_production_orders, (r) => ({
        id: asText(r.id),
        orderNumber: asText(r.order_number),
        bomId: asText(r.bom_id),
        bomName: asText(r.bom_name),
        finishedItemId: asText(r.finished_item_id),
        finishedItemName: asText(r.finished_item_name),
        quantityToProduce: asNum(r.quantity_to_produce, 0),
        warehouseId: asText(r.warehouse_id),
        status: (asText(r.status) || "planned") as "planned" | "in-progress" | "completed",
        createdDate: asText(r.created_date),
        ...(r.completed_date ? { completedDate: asText(r.completed_date) } : {}),
        ...(r.cost_center_id ? { costCenterId: asText(r.cost_center_id) } : {}),
      })),
      costCenters: parseArr(tables.erp_cost_centers, (r) => ({
        id: asText(r.id),
        code: asText(r.code),
        name: asText(r.name),
        managerName: asText(r.manager_name),
        budget: asNum(r.budget, 0),
        extraPostedSpend: asNum(r.extra_posted_spend, 0),
        linkedCategories: JSON.parse(asText(r.linked_categories_json) || "[]"),
        status: (asText(r.status) || "active") as "active" | "closed",
      })),
      ...(tables.erp_meta?.[0]?.last_payroll_run_month
        ? { lastPayrollRunMonth: asText(tables.erp_meta[0].last_payroll_run_month) }
        : erpBase.lastPayrollRunMonth ? { lastPayrollRunMonth: erpBase.lastPayrollRunMonth } : {}),
    });

    const impId = `imp_${sha256.slice(0, 12)}`;
    db.prepare(
      `INSERT INTO legacy_imports (id, workspace_id, source_name, source_format, source_sha256, tables_count, total_rows, imported_at, notes_json)
       VALUES (?, ?, ?, 'nasqo_unified_sqlite', ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, source_sha256) DO UPDATE SET imported_at = excluded.imported_at`,
    ).run(impId, workspaceId, fileName, sha256, Object.keys(tableCounts).length, totalRows, now, JSON.stringify({ tableCounts }));

    writeAudit(db, workspaceId, workspaceId, "legacy_imports", impId, "restore_unified_sqlite", {
      fileName, totalRows, accountsAdded, warehousesAdded, inventoryAdded, ledgerAdded, linesAdded,
    });

    return {
      sha256,
      prefix: "unified",
      integrity,
      tablesCount: Object.keys(tableCounts).length,
      totalRows,
      tableCounts,
      added: {
        accounts: accountsAdded,
        accountGroups: groupMap.size,
        cashboxes: cbMap.size,
        warehouses: warehousesAdded,
        inventory: inventoryAdded,
        ledger: ledgerAdded,
        invoiceLines: linesAdded,
      },
    };
  });
}

export function importLegacySqliteIntoUnifiedDb(
  db: DatabaseSync,
  bytes: Uint8Array,
  options: {
    workspaceId?: string;
    fileName?: string;
    groupCategories?: Record<string, AccountCategory>;
    replaceExisting?: boolean;
  } = {},
) {
  const workspaceId = options.workspaceId || DEFAULT_WORKSPACE_ID;
  const fileName = options.fileName || "legacy.sqlite";
  const replaceExisting = Boolean(options.replaceExisting);
  const extracted = inspectAndExtractLegacySqlite(bytes);
  const { sha256, integrity, tables, tableCounts, totalRows, evidence } = extracted;

  if (tables.account_groups && tables.accounts && tables.ledger_entries && !tables.input_move && !tables.bounds) {
    if (!replaceExisting) {
      throw new SqliteValidationError(
        "دمج نسخة SQLite موحّدة أصلية فوق بيانات قائمة غير مدعوم حاليًا؛ تم إبقاء كافة البيانات دون حذف. استخدم إجراء «استبدال كامل (استعادة)» كخيار منفصل.",
      );
    }
    return restoreNativeUnifiedSqlite(db, tables, sha256, integrity, tableCounts, totalRows, workspaceId, fileName);
  }

  const prefix = replaceExisting ? "sp" : livePrefix(sha256);
  const suggestions = suggestGroupCategories(tables);
  const effectiveCats: Record<string, AccountCategory> = {};
  for (const s of suggestions) {
    effectiveCats[String(s.groupId)] =
      options.groupCategories?.[String(s.groupId)] ??
      (GROUP_CATEGORY_BY_NAME[s.groupName] ?? inferCategoryFromGroupName(s.groupName));
  }

  const master = buildMasterData(tables, sha256, workspaceId, effectiveCats);
  const now = new Date().toISOString();

  return withTransaction(db, () => {
    if (replaceExisting) {
      db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
    }
    ensureEmptyWorkspace(db, workspaceId);

    // 1. Currencies
    const currenciesById = new Map<number, string>();
    const existingCurrencies = Number(
      (db.prepare("SELECT COUNT(*) AS c FROM currencies WHERE workspace_id = ?").get(workspaceId) as { c: number }).c,
    );
    const insCurrency = db.prepare(
      `INSERT INTO currencies (workspace_id, code, name, symbol, rate_primary, rate_secondary, name_secondary, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    if (replaceExisting && (tables.currencies?.length ?? 0) > 0) {
      db.prepare("DELETE FROM currencies WHERE workspace_id = ?").run(workspaceId);
    }
    for (const c of tables.currencies ?? []) {
      const lid = asInt(c.id);
      const name = asText(c.name) || "ريال";
      currenciesById.set(lid, name);
      if (replaceExisting || existingCurrencies <= 1) {
        insCurrency.run(
          workspaceId,
          name.includes("ريال") ? "ريال" : name,
          name,
          asText(c.sympol),
          asNum(c.amount, 1) || 1,
          asNum(c.amount2, 1) || 1,
          asText(c.name2),
          lid,
        );
      }
    }

    // 2. Account Groups (`boxes`)
    const groupByLegacyId = new Map<number, { dbId: number; name: string; category: AccountCategory; currencyCode: CurrencyCode }>();
    const existingGroups = db
      .prepare("SELECT id, legacy_id, name, category, currency_code FROM account_groups WHERE workspace_id = ?")
      .all(workspaceId) as { id: number; legacy_id: number | null; name: string; category: string; currency_code: string }[];
    for (const g of existingGroups) {
      if (g.legacy_id != null) {
        groupByLegacyId.set(Number(g.legacy_id), {
          dbId: Number(g.id),
          name: g.name,
          category: g.category as AccountCategory,
          currencyCode: g.currency_code as CurrencyCode,
        });
      }
    }
    const insGroup = db.prepare(
      `INSERT INTO account_groups (workspace_id, name, category, currency_code, has_bill, is_employee, sort_order, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let accountGroupsAdded = 0;
    for (const b of tables.boxes ?? []) {
      const lid = asInt(b.id);
      if (groupByLegacyId.has(lid)) continue;
      const gname = asText(b.name) || `مجموعة ${lid}`;
      const isEmpFlag = asInt(b.isemp ?? b.is_emp);
      const cat = options.groupCategories?.[String(lid)] ?? effectiveCats[String(lid)] ?? inferCategoryFromGroupName(gname, isEmpFlag);
      const curCode = mapCurrencyCode(asInt(b.cur ?? b.cur_id, 1), currenciesById, {});
      const res = insGroup.run(
        workspaceId, gname, cat, curCode, asInt(b.hasbill ?? b.has_bill), isEmpFlag, asInt(b.ord, lid), lid,
      );
      groupByLegacyId.set(lid, { dbId: Number(res.lastInsertRowid), name: gname, category: cat, currencyCode: curCode });
      accountGroupsAdded += 1;
    }

    // 3. Cashboxes (`cboxes`)
    const cashboxByLegacyId = new Map<number, number>();
    const existingCashboxes = db
      .prepare("SELECT id, legacy_id FROM cashboxes WHERE workspace_id = ?")
      .all(workspaceId) as { id: number; legacy_id: number | null }[];
    for (const cb of existingCashboxes) {
      if (cb.legacy_id != null) cashboxByLegacyId.set(Number(cb.legacy_id), Number(cb.id));
    }
    const insCashbox = db.prepare(
      `INSERT INTO cashboxes (workspace_id, name, details, state, currency_code, box_type, sort_order, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let cashboxesAdded = 0;
    for (const r of tables.cboxes ?? []) {
      const lid = asInt(r.id);
      if (cashboxByLegacyId.has(lid)) continue;
      const res = insCashbox.run(
        workspaceId, asText(r.name) || `صندوق ${lid}`, asText(r.details), asInt(r.state, 1),
        mapCurrencyCode(asInt(r.cur, 1), currenciesById, {}), asInt(r.type, 1), asInt(r.ord, 0), lid,
      );
      cashboxByLegacyId.set(lid, Number(res.lastInsertRowid));
      cashboxesAdded += 1;
    }

    // 4. Warehouses (`stores`)
    const insWh = db.prepare(
      `INSERT INTO warehouses (id, workspace_id, code_number, name, details, is_default, state, legacy_id, legacy_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    let warehousesAdded = 0;
    const whMapByLegacy = new Map<number, { id: string; name: string }>();
    for (let wi = 0; wi < master.warehouses.length; wi += 1) {
      const wh = master.warehouses[wi];
      const wid = replaceExisting ? `sp_wh_${wh.codeNumber}` : wh.id;
      const isDefault = replaceExisting && (wh.codeNumber === 1 || wi === 0) ? 1 : wh.isDefault ? 1 : 0;
      const res = insWh.run(
        wid, workspaceId, wh.codeNumber, wh.name, wh.details, isDefault,
        wh.codeNumber, wh.legacyRef ?? null, now, now,
      );
      if (Number(res.changes) > 0) warehousesAdded += 1;
      whMapByLegacy.set(wh.codeNumber, { id: wid, name: wh.name });
    }
    const existingDefaultWh = db
      .prepare("SELECT id, name FROM warehouses WHERE workspace_id = ? ORDER BY is_default DESC, code_number ASC LIMIT 1")
      .get(workspaceId) as { id: string; name: string } | undefined;

    // 5. Accounts (`customers` / `accounts`)
    const rawAccountRows = tables.customers ?? tables.accounts ?? [];
    const rawBoxByAccId = new Map<number, number>();
    const rawTaxByAccId = new Map<number, string>();
    const rawMsgByAccId = new Map<number, { msg: number; msgway: number }>();
    for (const r of rawAccountRows) {
      const aid = asInt(r.id);
      rawBoxByAccId.set(aid, asInt(r.type ?? r.box_id));
      rawTaxByAccId.set(aid, asText(r.tax));
      rawMsgByAccId.set(aid, { msg: asInt(r.msg), msgway: asInt(r.msgway) });
    }
    const insAcc = db.prepare(
      `INSERT INTO accounts (
         id, workspace_id, group_id, code_number, name, category, phone, credit_limit, currency,
         is_cash_account, account_image, sort_order, settlement, document_number_required,
         message_method, send_mode, tax_number, note, opening_balance, opening_direction, legacy_id, legacy_ref, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    let accountsAdded = 0;
    const accMapByLegacy = new Map<number, { id: string; name: string }>();
    for (const acc of master.accounts) {
      const aid = replaceExisting ? `sp_acc_${acc.codeNumber}` : acc.id;
      const boxId = rawBoxByAccId.get(acc.codeNumber) ?? 0;
      const grp = groupByLegacyId.get(boxId);
      const normName = normalizeAr(acc.name);
      const isCashAccount = acc.isCashAccount || (replaceExisting && (normName.includes("نقد") || normName.includes("صندوق")));
      const msgMeta = rawMsgByAccId.get(acc.codeNumber);
      const messageMethod = msgMeta ? (msgMeta.msgway === 2 ? "whatsapp" : "sms") : acc.messageMethod;
      const sendMode = msgMeta ? (msgMeta.msg === 1 ? "auto" : msgMeta.msg === 2 ? "confirm" : "never") : acc.sendMode;
      const res = insAcc.run(
        aid, workspaceId, grp?.dbId ?? null, acc.codeNumber, acc.name, grp?.category ?? acc.category, acc.phone, acc.creditLimit,
        grp?.currencyCode ?? acc.currency, isCashAccount ? 1 : 0, acc.accountImage, acc.sortOrder,
        messageMethod, sendMode, rawTaxByAccId.get(acc.codeNumber) ?? "", acc.note, acc.openingBalance, acc.openingDirection,
        acc.codeNumber, acc.legacyRef ?? null, now, now,
      );
      if (Number(res.changes) > 0) accountsAdded += 1;
      accMapByLegacy.set(acc.codeNumber, { id: aid, name: acc.name });
    }

    // 6. Inventory Items (`products`)
    const prodExtraById = new Map<number, Row>();
    const prodNameById = new Map<number, string>();
    for (const p of tables.products ?? []) {
      const pid = asInt(p.id);
      prodExtraById.set(pid, p);
      prodNameById.set(pid, asText(p.name));
    }
    const insInv = db.prepare(
      `INSERT INTO inventory_items (
         id, workspace_id, warehouse_id, name, unit, quantity, avg_cost, selling_price,
         min_threshold, sku, unit2, count2, sprice2, unit3, count3, sprice3,
         default_unit, expiry_date, has_expiry, currency_code, bstate,
         quantity_unverified, legacy_id, legacy_ref, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    let inventoryAdded = 0;
    const invMapByLegacy = new Map<number, { id: string; name: string }>();
    for (const item of master.inventory) {
      const legacyId = Number(item.legacyRef?.split(":").at(-1) ?? 0) || null;
      const iid = replaceExisting && legacyId ? `sp_inv_${legacyId}` : item.id;
      const pRaw = legacyId ? prodExtraById.get(legacyId) : undefined;
      const targetWhId =
        (replaceExisting && pRaw ? undefined : db.prepare("SELECT id FROM warehouses WHERE workspace_id = ? AND id = ?").get(workspaceId, item.warehouseId) ? item.warehouseId : undefined) ??
        (item.warehouseId.includes("_wh_") ? whMapByLegacy.get(Number(item.warehouseId.split("_wh_").at(-1) ?? 0))?.id : undefined) ??
        existingDefaultWh?.id ??
        item.warehouseId;
      if (!targetWhId) continue;
      const sellRaw = pRaw ? asNum(pRaw.price ?? pRaw.sell_price, 0) : 0;
      const sellPrice = sellRaw > 0 ? sellRaw : (item.sellingPrice ?? null);
      const c2 = pRaw ? asNum(pRaw.count2, 0) : 0;
      const sp2 = pRaw ? asNum(pRaw.sprice2, 0) : 0;
      const c3 = pRaw ? asNum(pRaw.count3, 0) : 0;
      const sp3 = pRaw ? asNum(pRaw.sprice3, 0) : 0;
      const res = insInv.run(
        iid, workspaceId, targetWhId, item.name, item.unit, item.quantity, item.avgCost,
        sellPrice, item.minThreshold ?? 25, item.sku ?? "",
        pRaw ? asText(pRaw.unit2) : "", c2 > 0 ? c2 : null, sp2 > 0 ? sp2 : null,
        pRaw ? asText(pRaw.unit3) : "", c3 > 0 ? c3 : null, sp3 > 0 ? sp3 : null,
        pRaw ? asInt(pRaw.defunit, 1) : 1,
        pRaw && asText(pRaw.exdate) ? asText(pRaw.exdate) : null,
        pRaw ? asInt(pRaw.dated, 0) : 0,
        pRaw ? mapCurrencyCode(asInt(pRaw.cur, 1), currenciesById, {}) : "ريال",
        pRaw ? asInt(pRaw.bstate, 1) : 1,
        item.quantityUnverified ? 1 : 0, legacyId, item.legacyRef ?? null, now, now,
      );
      if (Number(res.changes) > 0) inventoryAdded += 1;
      if (legacyId) invMapByLegacy.set(legacyId, { id: iid, name: item.name });
    }

    // Build bill item previews and top store map from bill_details
    const billFirstItems = new Map<number, string[]>();
    const billTopStore = new Map<number, number>();
    for (const bd of tables.bill_details ?? []) {
      const billId = asInt(bd.bill_id);
      const prodId = asInt(bd.prod_id);
      const storeId = asInt(bd.store_id);
      if (storeId > 0 && !billTopStore.has(billId)) billTopStore.set(billId, storeId);
      const pName = prodNameById.get(prodId);
      if (pName) {
        let arr = billFirstItems.get(billId);
        if (!arr) {
          arr = [];
          billFirstItems.set(billId, arr);
        }
        if (arr.length < 8) {
          const qty = asText(bd.amount) || "1";
          const unit = asText(bd.unit);
          arr.push(`${pName} (${qty}${unit ? ` ${unit}` : ""})`);
        }
      }
    }

    // 7. Store historical moves + lines into ledger_entries & invoice_lines
    const evidenceRole = new Map(evidence.map((e) => [e.billType, e.suggestedRole]));
    const insEntry = db.prepare(
      `INSERT INTO ledger_entries (
         id, workspace_id, account_id, account_name, counterpart_account_id, counterpart_account_name, cashbox_id,
         kind, type_label, payment, direction, amount, raw_dain, raw_madin, settled_on_receipt, currency, exchange_rate,
         details, document_number, warehouse_id, warehouse_name, invoice_content, entry_number, deleted, entry_date,
         sender, receiver, company_name, discount, bonus, doc_type, bstate, source_origin, posting_status, created_at_ms, legacy_id, legacy_ref
       ) VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );

    let ledgerAdded = 0;
    const entryMapByMoveId = new Map<number, string>();
    for (const r of tables.input_move ?? tables.bounds ?? []) {
      const moveId = asInt(r.id);
      const perId = asInt(r.per_id ?? r.acc_id);
      const acc = accMapByLegacy.get(perId);
      if (!acc) continue;
      const entryId = replaceExisting ? `sp_ent_${moveId}` : `${prefix}_hist_${moveId}`;
      const rawDain = Math.max(0, asNum(r.dain, 0));
      const rawMadin = Math.max(0, asNum(r.madin, 0));
      const settled = rawDain > 0 && rawMadin > 0 && Math.abs(rawDain - rawMadin) < 0.01;
      const billType = asInt(r.bill_type ?? r.doc_type, 1);
      const cboxLegacyId = asInt(r.cboxid, 0);
      const cashboxDbId = cashboxByLegacyId.get(cboxLegacyId) ?? null;

      let kind: "voucher" | "invoice" | "return";
      let typeLabel: string;
      let invoiceContent: "items" | "free" | "none";
      let cashDefaultDirection: "debit" | "credit";
      if (replaceExisting || [1, 2, 3, 4, 5, 7, 9].includes(billType)) {
        const meta = classifyBoundsDocType(billType, settled, rawDain);
        kind = meta.kind;
        typeLabel = meta.typeLabel;
        invoiceContent = meta.invoiceContent;
        cashDefaultDirection = meta.cashDefaultDirection;
      } else {
        const role = evidenceRole.get(billType) ?? "voucher";
        kind = role === "sale" || role === "purchase" || role === "free_sale" || role === "free_purchase" ? "invoice" : role === "sale_return" || role === "purchase_return" ? "return" : "voucher";
        invoiceContent = role === "free_sale" || role === "free_purchase" ? "free" : kind !== "voucher" ? "items" : "none";
        typeLabel = "سند تاريخي";
        cashDefaultDirection = rawDain >= rawMadin ? "debit" : "credit";
      }

      let payment: "cash" | "credit" | "balance" = "credit";
      let direction: "debit" | "credit" = "debit";
      let amount = 0;
      if (settled) {
        payment = "cash";
        amount = rawDain;
        direction = cashDefaultDirection;
      } else if (rawDain > 0 && rawMadin === 0) {
        payment = billType === 1 && cboxLegacyId > 0 ? "cash" : "credit";
        direction = "debit";
        amount = rawDain;
      } else if (rawMadin > 0 && rawDain === 0) {
        payment = billType === 1 && cboxLegacyId > 0 ? "cash" : "credit";
        direction = "credit";
        amount = rawMadin;
      } else if (rawDain > 0 || rawMadin > 0) {
        payment = "credit";
        direction = rawDain >= rawMadin ? "debit" : "credit";
        amount = Math.max(rawDain, rawMadin);
      } else {
        payment = "balance";
        direction = "debit";
        amount = 0;
      }

      const currency = mapCurrencyCode(asInt(r.cur ?? r.cur_id, 1), currenciesById, {});
      const entryDate = asText(r.date) || isoDateFromMove(r);
      const createdAtMs = Date.parse(`${entryDate}T00:00:00Z`) + moveId;
      const wh = whMapByLegacy.get(billTopStore.get(moveId) ?? 0) ?? existingDefaultWh;
      const rawDetails = asText(r.details);
      const lineSummary = billFirstItems.get(moveId)?.join("\n") ?? "";
      const details = (rawDetails || lineSummary).slice(0, 600);
      const rate = asNum(r.curprice, 1) || 1;

      const res = insEntry.run(
        entryId,
        workspaceId,
        acc.id,
        acc.name,
        cashboxDbId,
        kind,
        typeLabel,
        payment,
        direction,
        amount,
        rawDain,
        rawMadin,
        settled ? 1 : 0,
        currency,
        rate,
        details,
        asText(r.bill),
        wh?.id ?? "",
        wh?.name ?? "",
        invoiceContent,
        moveId,
        entryDate,
        asText(r.sender),
        asText(r.recever),
        asText(r.comp),
        asNum(r.discount, 0),
        asNum(r.bonus, 0),
        billType,
        asInt(r.bstate, 1),
        replaceExisting ? "smartpro_sql" : "legacy_sqlite",
        replaceExisting ? "posted" : "historical_unposted",
        Number.isFinite(createdAtMs) ? createdAtMs : Date.now() + moveId,
        moveId,
        `${sha256.slice(0, 12)}:input_move:${moveId}`,
      );
      if (Number(res.changes) > 0) ledgerAdded += 1;
      entryMapByMoveId.set(moveId, entryId);
    }

    const insLine = db.prepare(
      `INSERT INTO invoice_lines (
         workspace_id, entry_id, line_kind, inventory_item_id, warehouse_id, item_name,
         price, quantity, total, discount, bonus, unit, unit_num, details, expiry_date, legacy_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let linesAdded = 0;
    for (const bd of tables.bill_details ?? []) {
      const entryId = entryMapByMoveId.get(asInt(bd.bill_id));
      if (!entryId) continue;
      const pid = asInt(bd.prod_id);
      const inv = invMapByLegacy.get(pid);
      const wh = whMapByLegacy.get(asInt(bd.store_id));
      insLine.run(
        workspaceId, entryId, "item", inv?.id ?? null, wh?.id ?? null,
        inv?.name ?? asText(bd.details) ?? `صنف ${pid}`,
        asNum(bd.price, 0), asNum(bd.amount, 0), asNum(bd.total, 0),
        asNum(bd.discount, 0), asNum(bd.bonus, 0), asText(bd.unit), asInt(bd.unitnum, 1),
        asText(bd.details), asText(bd.exdate), asInt(bd.id),
      );
      linesAdded += 1;
    }
    for (const bd2 of tables.bill_details2 ?? []) {
      const entryId = entryMapByMoveId.get(asInt(bd2.bill_id));
      if (!entryId) continue;
      insLine.run(
        workspaceId, entryId, "free", null, null, asText(bd2.details) || "بند حر",
        asNum(bd2.price, 0), asNum(bd2.amount, 0), asNum(bd2.total, 0),
        asNum(bd2.discount, 0), asNum(bd2.bonus, 0), asText(bd2.unit), 1,
        asText(bd2.details), "", asInt(bd2.id),
      );
      linesAdded += 1;
    }

    // 8. Stock Transfers, Price Offers, Deleted Archive (`bin`), Alerts
    const transferMap = new Map<number, number>();
    const insTx = db.prepare(
      `INSERT INTO stock_transfers (workspace_id, from_warehouse_id, to_warehouse_id, raw_from_store_id, raw_to_store_id, details, transfer_date, transfer_type, user_legacy_id, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const st of tables.store_trans ?? []) {
      const lid = asInt(st.id);
      const s1 = asInt(st.store_id1);
      const s2 = asInt(st.store_id2);
      const res = insTx.run(
        workspaceId, whMapByLegacy.get(s1)?.id ?? null, whMapByLegacy.get(s2)?.id ?? null, s1, s2,
        asText(st.details), asText(st.date) || isoDateFromMove(st), asInt(st.type, 1), asInt(st.user_id, 0), lid,
      );
      transferMap.set(lid, Number(res.lastInsertRowid));
    }
    const insTxLine = db.prepare(
      `INSERT INTO stock_transfer_lines (workspace_id, transfer_id, inventory_item_id, raw_prod_id, quantity, unit, unit_num, details, expiry_date, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const td of tables.trans_details ?? []) {
      const txId = transferMap.get(asInt(td.bill_id));
      if (!txId) continue;
      const pid = asInt(td.prod_id);
      insTxLine.run(workspaceId, txId, invMapByLegacy.get(pid)?.id ?? null, pid, asNum(td.amount, 0), asText(td.unit), asInt(td.unitnum, 1), asText(td.details), asText(td.exdate), asInt(td.id));
    }

    const offerMap = new Map<number, number>();
    const insOffer = db.prepare(
      `INSERT INTO price_offers (workspace_id, account_id, raw_acc_id, name, offer_type, dain, madin, currency, offer_date, details, bonus, discount, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const o of tables.offers ?? []) {
      const lid = asInt(o.id);
      const rawAcc = asInt(o.per_id ?? o.acc_id);
      const res = insOffer.run(
        workspaceId, accMapByLegacy.get(rawAcc)?.id ?? null, rawAcc, asText(o.name), asInt(o.type, 1),
        asNum(o.dain, 0), asNum(o.madin, 0), mapCurrencyCode(asInt(o.cur ?? o.cur_id, 1), currenciesById, {}),
        asText(o.date) || isoDateFromMove(o), asText(o.details), asNum(o.bonus, 0), asNum(o.discount, 0), lid,
      );
      offerMap.set(lid, Number(res.lastInsertRowid));
    }
    const insOfferLine = db.prepare(
      `INSERT INTO price_offer_lines (workspace_id, offer_id, line_kind, inventory_item_id, raw_prod_id, price, quantity, total, unit, unit_num, details, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const obd of tables.offer_bill_details ?? []) {
      const oid = offerMap.get(asInt(obd.bill_id));
      if (!oid) continue;
      const pid = asInt(obd.prod_id);
      insOfferLine.run(workspaceId, oid, "item", invMapByLegacy.get(pid)?.id ?? null, pid, asNum(obd.price, 0), asNum(obd.amount, 0), asNum(obd.total, 0), asText(obd.unit), asInt(obd.unitnum, 1), asText(obd.details), asInt(obd.id));
    }
    for (const osbd of tables.offer_sbill_details ?? []) {
      const oid = offerMap.get(asInt(osbd.bill_id));
      if (!oid) continue;
      insOfferLine.run(workspaceId, oid, "free", null, null, asNum(osbd.price, 0), asNum(osbd.amount, 0), asNum(osbd.total, 0), asText(osbd.unit), 1, asText(osbd.details), asInt(osbd.id));
    }

    const binMap = new Map<number, number>();
    const insBin = db.prepare(
      `INSERT INTO archived_documents (
         workspace_id, legacy_id, account_id, raw_acc_id, account_name, group_name, currency_name, box_name,
         doc_type, bstate, dain, madin, doc_date, bill_no, details, ref, sender, receiver, company_name,
         discount, bonus, curprice, cbox_id, discount_amount
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const b of tables.bin ?? []) {
      const lid = asInt(b.id);
      const rawPer = asInt(b.per_id);
      const res = insBin.run(
        workspaceId, lid, accMapByLegacy.get(rawPer)?.id ?? null, rawPer,
        asText(b.pername) || accMapByLegacy.get(rawPer)?.name || "",
        asText(b.boxname), asText(b.curname) || "ريال", asText(b.boxname),
        asInt(b.bill_type, 1), asInt(b.bstate, 1), asNum(b.dain, 0), asNum(b.madin, 0),
        asText(b.date) || isoDateFromMove(b), asText(b.bill), asText(b.details), asText(b.ref),
        asText(b.sender), asText(b.recever), asText(b.comp),
        asNum(b.discount, 0), asNum(b.bonus, 0), asText(b.curprice), asInt(b.cboxid, 0), asNum(b.discount_amount, 0),
      );
      binMap.set(lid, Number(res.lastInsertRowid));
    }
    const insBinLine = db.prepare(
      `INSERT INTO archived_document_lines (
         workspace_id, archived_doc_id, line_kind, inventory_item_id, raw_prod_id, warehouse_id, raw_store_id,
         price, quantity, total, discount, bonus, unit, unit_num, details, expiry_date, legacy_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const bbd of tables.bin_bill_details ?? []) {
      const did = binMap.get(asInt(bbd.bill_id));
      if (!did) continue;
      const pid = asInt(bbd.prod_id);
      const sid = asInt(bbd.store_id);
      insBinLine.run(workspaceId, did, "item", invMapByLegacy.get(pid)?.id ?? null, pid, whMapByLegacy.get(sid)?.id ?? null, sid, asNum(bbd.price, 0), asNum(bbd.amount, 0), asNum(bbd.total, 0), asNum(bbd.discount, 0), asNum(bbd.bonus, 0), asText(bbd.unit), asInt(bbd.unitnum, 1), asText(bbd.details), asText(bbd.exdate), asInt(bbd.id));
    }
    for (const bbd2 of tables.bin_bill_details2 ?? []) {
      const did = binMap.get(asInt(bbd2.bill_id));
      if (!did) continue;
      insBinLine.run(workspaceId, did, "free", null, null, null, null, asNum(bbd2.price, 0), asNum(bbd2.amount, 0), asNum(bbd2.total, 0), asNum(bbd2.discount, 0), asNum(bbd2.bonus, 0), asText(bbd2.unit), 1, asText(bbd2.details), "", asInt(bbd2.id));
    }

    const insAlert = db.prepare(
      `INSERT INTO alerts (workspace_id, account_id, raw_per_id, alert_date, details, legacy_id) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const a of tables.alerts ?? []) {
      const rawPer = asInt(a.per_id);
      insAlert.run(workspaceId, accMapByLegacy.get(rawPer)?.id ?? null, rawPer, asText(a.mdate), asText(a.det), asInt(a.id));
    }

    const impId = `imp_${sha256.slice(0, 12)}`;
    db.prepare(
      `INSERT INTO legacy_imports (id, workspace_id, source_name, source_format, source_sha256, tables_count, total_rows, imported_at, notes_json)
       VALUES (?, ?, ?, 'legacy_sqlite_file', ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, source_sha256) DO UPDATE SET imported_at = excluded.imported_at`,
    ).run(impId, workspaceId, fileName, sha256, Object.keys(tableCounts).length, totalRows, now, JSON.stringify({ tableCounts, prefix }));

    writeAudit(db, workspaceId, workspaceId, "legacy_imports", impId, replaceExisting ? "restore_sqlite" : "import_sqlite", {
      fileName,
      totalRows,
      accountGroupsAdded,
      cashboxesAdded,
      accountsAdded,
      warehousesAdded,
      inventoryAdded,
      ledgerAdded,
      linesAdded,
    });

    return {
      sha256,
      prefix,
      integrity,
      tablesCount: Object.keys(tableCounts).length,
      totalRows,
      tableCounts,
      added: {
        accounts: accountsAdded,
        accountGroups: accountGroupsAdded,
        cashboxes: cashboxesAdded,
        warehouses: warehousesAdded,
        inventory: inventoryAdded,
        ledger: ledgerAdded,
        invoiceLines: linesAdded,
      },
    };
  });
}
