import crypto from "node:crypto";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { AccountCategory, CurrencyCode } from "../src/types.ts";
import { DEFAULT_WORKSPACE_ID, saveErpDataRows, withTransaction, writeAudit } from "./sqliteDb.ts";
import { createEmptyErpData } from "./sqliteRuntimeSupport.ts";

export type SmartProSqlImportReport = {
  sourceName: string;
  sourceSha256: string;
  skippedDuplicate: boolean;
  tablesDetected: number;
  totalSourceRows: number;
  tableCounts: Record<string, number>;
  imported: {
    accounts: number;
    accountGroups: number;
    cashboxes: number;
    currencies: number;
    warehouses: number;
    inventoryItems: number;
    ledgerEntries: number;
    invoiceLines: number;
    stockTransfers: number;
    stockTransferLines: number;
    priceOffers: number;
    priceOfferLines: number;
    archivedDocuments: number;
    archivedDocumentLines: number;
    alerts: number;
    legacyUsers: number;
    legacyPermissions: number;
  };
  anomalies: {
    missingCurrencyIds: Record<string, number>;
    missingTransferStoreRefs: number;
    zeroAmountBounds: number;
  };
};

type ParsedDump = {
  columnsByTable: Map<string, string[]>;
  rowsByTable: Map<string, Record<string, string | null>[]>;
};

function unescapeMysqlString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      const next = raw[i + 1];
      i += 1;
      if (next === "0") out += "\0";
      else if (next === "b") out += "\b";
      else if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else if (next === "Z") out += "\x1a";
      else out += next;
    } else if (ch === "'" && i + 1 < raw.length && raw[i + 1] === "'") {
      out += "'";
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

function parseInsertTuples(
  sqlValuesTail: string,
  colNames: readonly string[],
  out: Record<string, string | null>[],
): void {
  let i = 0;
  const n = sqlValuesTail.length;
  let inStr = false;
  let escape = false;
  let depth = 0;
  let tokenStart = -1;
  let currentIsQuoted = false;
  let rowValues: (string | null)[] = [];

  const pushToken = (endIdx: number) => {
    const raw = sqlValuesTail.slice(tokenStart, endIdx).trim();
    if (currentIsQuoted) {
      const inner = raw.slice(1, -1);
      rowValues.push(unescapeMysqlString(inner));
    } else if (!raw || raw.toUpperCase() === "NULL") {
      rowValues.push(null);
    } else {
      rowValues.push(raw);
    }
    tokenStart = -1;
    currentIsQuoted = false;
  };

  while (i < n) {
    const ch = sqlValuesTail[i];
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "'") {
        if (i + 1 < n && sqlValuesTail[i + 1] === "'") {
          i += 1;
        } else {
          inStr = false;
        }
      }
      i += 1;
      continue;
    }

    if (ch === "'") {
      inStr = true;
      if (depth === 1 && tokenStart === -1) {
        tokenStart = i;
        currentIsQuoted = true;
      }
    } else if (ch === "(") {
      if (depth === 0) {
        rowValues = [];
        tokenStart = -1;
        currentIsQuoted = false;
      }
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        if (tokenStart !== -1) {
          pushToken(i);
        } else {
          tokenStart = -1;
          currentIsQuoted = false;
        }
        const record: Record<string, string | null> = {};
        for (let idx = 0; idx < colNames.length; idx += 1) {
          record[colNames[idx]] = idx < rowValues.length ? rowValues[idx] : null;
        }
        out.push(record);
      }
    } else if (ch === "," && depth === 1) {
      if (tokenStart !== -1) {
        pushToken(i);
      } else {
        rowValues.push(null);
      }
      tokenStart = -1;
      currentIsQuoted = false;
    } else if (depth === 1 && tokenStart === -1 && !/\s/.test(ch)) {
      tokenStart = i;
      currentIsQuoted = false;
    } else if (ch === ";" && depth === 0) {
      break;
    }
    i += 1;
  }
}

function extractCreateTableColumns(bodyInsideParens: string): string[] {
  const cols: string[] = [];
  let inStr = false;
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= bodyInsideParens.length; i += 1) {
    const ch = i < bodyInsideParens.length ? bodyInsideParens[i] : ",";
    if (inStr) {
      if (ch === "\\" && i + 1 < bodyInsideParens.length) {
        i += 1;
      } else if (ch === "'") {
        inStr = false;
      }
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      const part = bodyInsideParens.slice(start, i).trim();
      start = i + 1;
      if (part.startsWith("`")) {
        const m = /^`([^`]+)`/.exec(part);
        if (m) cols.push(m[1]);
      }
    }
  }
  return cols;
}

export function parseSmartProSqlDump(sqlText: string): ParsedDump {
  const columnsByTable = new Map<string, string[]>();
  const rowsByTable = new Map<string, Record<string, string | null>[]>();

  const lines = sqlText.split(/\r?\n/);

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    const trimmed = line.trim();

    const ctMatch = /^CREATE TABLE\s+`([^`]+)`\s*\((.*)$/i.exec(trimmed);
    if (ctMatch) {
      const tableName = ctMatch[1];
      let block = trimmed;
      while (!block.endsWith(";") && li + 1 < lines.length) {
        li += 1;
        block += `\n${lines[li]}`;
      }
      const openIdx = block.indexOf("(");
      let closeIdx = -1;
      if (openIdx !== -1) {
        let depth = 0;
        let inStr = false;
        for (let ci = openIdx; ci < block.length; ci += 1) {
          const ch = block[ci];
          if (inStr) {
            if (ch === "\\" && ci + 1 < block.length) ci += 1;
            else if (ch === "'") inStr = false;
          } else if (ch === "'") {
            inStr = true;
          } else if (ch === "(") {
            depth += 1;
          } else if (ch === ")") {
            depth -= 1;
            if (depth === 0) {
              closeIdx = ci;
              break;
            }
          }
        }
      }
      if (openIdx !== -1 && closeIdx > openIdx) {
        columnsByTable.set(tableName, extractCreateTableColumns(block.slice(openIdx + 1, closeIdx)));
      }
      continue;
    }

    const insMatch = /^INSERT INTO\s+`([^`]+)`\s*(?:\(([^)]+)\)\s*)?VALUES\s*(.*)$/i.exec(line);
    if (insMatch) {
      const table = insMatch[1];
      let statement = insMatch[3];
      // Accumulate multi-line INSERT statement if needed
      while (!statement.trimEnd().endsWith(";") && li + 1 < lines.length) {
        li += 1;
        statement += `\n${lines[li]}`;
      }
      const explicitCols = insMatch[2]
        ? insMatch[2]
            .split(",")
            .map((s) => s.replace(/[`\s]/g, ""))
            .filter(Boolean)
        : columnsByTable.get(table) ?? [];
      if (!explicitCols.length) {
        throw new Error(`تعذر تحديد أعمدة الجدول ${table} أثناء قراءة ملف SQL.`);
      }
      let bucket = rowsByTable.get(table);
      if (!bucket) {
        bucket = [];
        rowsByTable.set(table, bucket);
      }
      parseInsertTuples(statement, explicitCols, bucket);
    }
  }

  return { columnsByTable, rowsByTable };
}

function asNum(v: string | null | undefined, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const cleaned = v.replace(/[,٬\s]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function asInt(v: string | null | undefined, fallback = 0): number {
  return Math.trunc(asNum(v, fallback));
}

function asText(v: string | null | undefined): string {
  return v === null || v === undefined ? "" : v.trim();
}

function normalizeAr(v: string): string {
  return v.replace(/[\u064B-\u065F\u0640]/g, "").replace(/\s+/g, " ").trim();
}

export function inferCategoryFromGroupName(groupName: string, isEmployeeFlag = 0): AccountCategory {
  const n = normalizeAr(groupName);
  if (isEmployeeFlag === 1) return "employees";
  if (n.includes("هلال") || n.includes("حسين") || n.includes("سحبيات") || n.includes("راس المال") || n.includes("اصول") || n.includes("تاك ستور") || n.includes("المحل")) {
    return "shop";
  }
  if (n.includes("مبيعات") || n.includes("بيع")) return "sales";
  if (n.includes("مشتريات") || n.includes("مورد") || n.includes("شراء")) return "purchases";
  if (n.includes("عملاء") || n.includes("زبائن") || n.includes("عميل")) return "clients";
  if (n.includes("موظف") || n.includes("رواتب")) return "employees";
  if (n.includes("حوال") || n.includes("تحويل")) return "transfers";
  return "shop";
}

export function mapCurrencyCode(curId: number, currenciesById: Map<number, string>, missingCounts: Record<string, number>): CurrencyCode {
  const found = currenciesById.get(curId);
  if (found) {
    if (found.includes("ريال")) return "ريال";
    if (found.includes("دولار")) return "دولار";
    if (found.includes("يورو")) return "يورو";
    return "عملة 2";
  }
  if (curId !== 0) {
    const k = String(curId);
    missingCounts[k] = (missingCounts[k] ?? 0) + 1;
  }
  if (curId === 2) return "عملة 2";
  if (curId === 3) return "دولار";
  return "ريال";
}

export function classifyBoundsDocType(docType: number, settledOnReceipt: boolean, rawDain: number): {
  kind: "voucher" | "invoice" | "return";
  typeLabel: string;
  invoiceContent: "items" | "free" | "none";
  cashDefaultDirection: "debit" | "credit";
} {
  switch (docType) {
    case 2:
      return {
        kind: "invoice",
        typeLabel: settledOnReceipt ? "فاتورة بيع نقدي" : "فاتورة بيع آجل",
        invoiceContent: "items",
        cashDefaultDirection: "debit",
      };
    case 3:
      return {
        kind: "invoice",
        typeLabel: settledOnReceipt ? "ف.ش.نقدي" : "فاتورة شراء آجلة",
        invoiceContent: "items",
        cashDefaultDirection: "credit",
      };
    case 4:
      return {
        kind: "return",
        typeLabel: "مردود مبيعات",
        invoiceContent: "items",
        cashDefaultDirection: "credit",
      };
    case 5:
      return {
        kind: "return",
        typeLabel: "مردود مشتريات",
        invoiceContent: "items",
        cashDefaultDirection: "debit",
      };
    case 7:
      return {
        kind: "invoice",
        typeLabel: settledOnReceipt ? "فاتورة بيع حر نقدي" : "فاتورة بيع حرة",
        invoiceContent: "free",
        cashDefaultDirection: "debit",
      };
    case 9:
      return {
        kind: "invoice",
        typeLabel: settledOnReceipt ? "فاتورة شراء حر نقدي" : "فاتورة شراء حرة",
        invoiceContent: "free",
        cashDefaultDirection: "credit",
      };
    case 1:
    default:
      return {
        kind: "voucher",
        typeLabel: rawDain > 0 ? "عليه (سند)" : "له (سند)",
        invoiceContent: "none",
        cashDefaultDirection: rawDain > 0 ? "debit" : "credit",
      };
  }
}

export function importSmartProSqlDump(
  db: DatabaseSync,
  sqlText: string,
  options: {
    workspaceId?: string;
    sourceName?: string;
    replaceExisting?: boolean;
  } = {},
): SmartProSqlImportReport {
  const workspaceId = options.workspaceId || DEFAULT_WORKSPACE_ID;
  const sourceName = options.sourceName || "smartprodb.sql";
  const sourceSha256 = crypto.createHash("sha256").update(sqlText, "utf8").digest("hex");

  const already = db
    .prepare("SELECT id, tables_count, total_rows FROM legacy_imports WHERE workspace_id = ? AND source_sha256 = ?")
    .get(workspaceId, sourceSha256) as { id: string; tables_count: number; total_rows: number } | undefined;

  if (already && !options.replaceExisting) {
    return {
      sourceName,
      sourceSha256,
      skippedDuplicate: true,
      tablesDetected: Number(already.tables_count),
      totalSourceRows: Number(already.total_rows),
      tableCounts: {},
      imported: {
        accounts: 0, accountGroups: 0, cashboxes: 0, currencies: 0, warehouses: 0,
        inventoryItems: 0, ledgerEntries: 0, invoiceLines: 0, stockTransfers: 0,
        stockTransferLines: 0, priceOffers: 0, priceOfferLines: 0, archivedDocuments: 0,
        archivedDocumentLines: 0, alerts: 0, legacyUsers: 0, legacyPermissions: 0,
      },
      anomalies: { missingCurrencyIds: {}, missingTransferStoreRefs: 0, zeroAmountBounds: 0 },
    };
  }

  const parsed = parseSmartProSqlDump(sqlText);
  const tableCounts: Record<string, number> = {};
  let totalSourceRows = 0;
  for (const name of parsed.columnsByTable.keys()) {
    const cnt = parsed.rowsByTable.get(name)?.length ?? 0;
    tableCounts[name] = cnt;
    totalSourceRows += cnt;
  }

  return withTransaction(db, () => {
    const now = new Date().toISOString();

    if (options.replaceExisting) {
      db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
    }

    db.prepare(
      `INSERT INTO workspaces (id, owner_id, company_name, default_currency, whatsapp_provider, whatsapp_instant_enabled, whatsapp_phone, created_at, updated_at)
       VALUES (?, ?, 'نسقو برو — SmartPro الموحد', 'ريال', 'nasqo', 0, '', ?, ?)
       ON CONFLICT(id) DO UPDATE SET company_name = excluded.company_name, updated_at = excluded.updated_at`,
    ).run(workspaceId, workspaceId, now, now);

    // 1. Currencies
    const currenciesById = new Map<number, string>();
    const insCurrency = db.prepare(
      `INSERT INTO currencies (workspace_id, code, name, symbol, rate_primary, rate_secondary, name_secondary, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let currenciesCount = 0;
    for (const r of parsed.rowsByTable.get("currencies") ?? []) {
      const lid = asInt(r.id);
      const name = asText(r.name) || "ريال";
      currenciesById.set(lid, name);
      insCurrency.run(
        workspaceId,
        name.includes("ريال") ? "ريال" : name,
        name,
        asText(r.sympol),
        asNum(r.amount, 1) || 1,
        asNum(r.amount2, 1) || 1,
        asText(r.name2),
        lid,
      );
      currenciesCount += 1;
    }

    // 2. Account Groups (`boxes`)
    const groupByLegacyId = new Map<number, { dbId: number; name: string; category: AccountCategory; currencyCode: CurrencyCode }>();
    const insGroup = db.prepare(
      `INSERT INTO account_groups (workspace_id, name, category, currency_code, has_bill, is_employee, sort_order, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let accountGroupsCount = 0;
    for (const r of parsed.rowsByTable.get("boxes") ?? []) {
      const lid = asInt(r.id);
      const gname = asText(r.name) || `مجموعة ${lid}`;
      const isEmpFlag = asInt(r.is_emp ?? r.isemp);
      const cat = inferCategoryFromGroupName(gname, isEmpFlag);
      const curCode = mapCurrencyCode(asInt(r.cur_id ?? r.cur, 1), currenciesById, {});
      const res = insGroup.run(
        workspaceId,
        gname,
        cat,
        curCode,
        asInt(r.has_bill ?? r.hasbill),
        isEmpFlag,
        asInt(r.ord, lid),
        lid,
      );
      groupByLegacyId.set(lid, { dbId: Number(res.lastInsertRowid), name: gname, category: cat, currencyCode: curCode });
      accountGroupsCount += 1;
    }

    // 3. Cashboxes (`cboxes`)
    const cashboxByLegacyId = new Map<number, number>();
    const insCashbox = db.prepare(
      `INSERT INTO cashboxes (workspace_id, name, details, state, currency_code, box_type, sort_order, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let cashboxesCount = 0;
    for (const r of parsed.rowsByTable.get("cboxes") ?? []) {
      const lid = asInt(r.id);
      const res = insCashbox.run(
        workspaceId,
        asText(r.name) || `صندوق ${lid}`,
        asText(r.details),
        asInt(r.state, 1),
        mapCurrencyCode(asInt(r.cur, 1), currenciesById, {}),
        asInt(r.type, 1),
        asInt(r.ord, 0),
        lid,
      );
      cashboxByLegacyId.set(lid, Number(res.lastInsertRowid));
      cashboxesCount += 1;
    }

    // 4. Legacy Users & Permissions (never return password hashes over client API)
    const insLegacyUser = db.prepare(
      `INSERT INTO legacy_users (workspace_id, legacy_id, name, username, role_id, password_present)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    let legacyUsersCount = 0;
    for (const r of parsed.rowsByTable.get("users") ?? []) {
      insLegacyUser.run(workspaceId, asInt(r.id), asText(r.name), asText(r.username), asInt(r.role_id, 1), asText(r.password) ? 1 : 0);
      legacyUsersCount += 1;
    }

    const insPerm = db.prepare(
      `INSERT INTO legacy_permissions (workspace_id, legacy_id, name, flags_json) VALUES (?, ?, ?, ?)`,
    );
    let legacyPermissionsCount = 0;
    for (const r of parsed.rowsByTable.get("prems") ?? []) {
      const flags: Record<string, number> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k !== "id" && k !== "name") flags[k] = asInt(v);
      }
      insPerm.run(workspaceId, asInt(r.id), asText(r.name), JSON.stringify(flags));
      legacyPermissionsCount += 1;
    }

    // 5. Warehouses (`stores`)
    const warehouseByLegacyId = new Map<number, { id: string; name: string }>();
    const insWh = db.prepare(
      `INSERT INTO warehouses (id, workspace_id, code_number, name, details, is_default, state, legacy_id, legacy_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let warehousesCount = 0;
    const storeRows = parsed.rowsByTable.get("stores") ?? [];
    for (let i = 0; i < storeRows.length; i += 1) {
      const r = storeRows[i];
      const lid = asInt(r.id);
      const id = `sp_wh_${lid}`;
      const name = asText(r.name) || `مخزن ${lid}`;
      const isDefault = lid === 1 || (i === 0 && !storeRows.some((s) => asInt(s.id) === 1));
      insWh.run(
        id,
        workspaceId,
        lid,
        name,
        asText(r.details),
        isDefault ? 1 : 0,
        asInt(r.state, 1),
        lid,
        `${sourceSha256.slice(0, 12)}:stores:${lid}`,
        now,
        now,
      );
      warehouseByLegacyId.set(lid, { id, name });
      warehousesCount += 1;
    }
    const fallbackWhId = warehouseByLegacyId.get(1)?.id ?? [...warehouseByLegacyId.values()][0]?.id;

    // 6. Accounts (`accounts` or `customers`)
    const accountByLegacyId = new Map<number, { id: string; name: string; category: AccountCategory; isCashAccount: boolean }>();
    const insAcc = db.prepare(
      `INSERT INTO accounts (
         id, workspace_id, group_id, code_number, name, category, phone, credit_limit, currency,
         is_cash_account, account_image, sort_order, settlement, document_number_required,
         message_method, send_mode, tax_number, note, opening_balance, opening_direction,
         legacy_id, legacy_ref, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '1', ?, 0, 0, ?, ?, ?, ?, 0, 'debit', ?, ?, ?, ?)`,
    );
    let accountsCount = 0;
    const accRows = parsed.rowsByTable.get("accounts") ?? parsed.rowsByTable.get("customers") ?? [];
    for (let idx = 0; idx < accRows.length; idx += 1) {
      const r = accRows[idx];
      const lid = asInt(r.id);
      const id = `sp_acc_${lid}`;
      const name = asText(r.name) || `حساب ${lid}`;
      const boxId = asInt(r.box_id ?? r.type);
      const grp = groupByLegacyId.get(boxId);
      const category: AccountCategory = grp?.category ?? "shop";
      const accCurrency = grp?.currencyCode ?? "ريال";
      const norm = normalizeAr(name);
      const isCashAccount = norm.includes("نقد") || norm.includes("صندوق");
      const msgWay = asInt(r.msgway);
      const msg = asInt(r.msg);
      const note = [asText(r.details), grp ? `المجموعة الأصلية: ${grp.name}` : ""].filter(Boolean).join(" | ");
      insAcc.run(
        id,
        workspaceId,
        grp?.dbId ?? null,
        lid,
        name,
        category,
        asText(r.phone) || asText(r.phon),
        Math.max(0, asNum(r.lim, 0)),
        accCurrency,
        isCashAccount ? 1 : 0,
        idx + 1,
        msgWay === 2 ? "whatsapp" : "sms",
        msg === 1 ? "auto" : msg === 2 ? "confirm" : "never",
        asText(r.tax),
        note.slice(0, 300),
        lid,
        `${sourceSha256.slice(0, 12)}:accounts:${lid}`,
        now,
        now,
      );
      accountByLegacyId.set(lid, { id, name, category, isCashAccount });
      accountsCount += 1;
    }

    // Build frequency map of bill_details.store_id per prod_id & bill_id for honest placement
    const prodStoreFreq = new Map<number, Map<number, number>>();
    const billTopStore = new Map<number, number>();
    const billFirstItems = new Map<number, string[]>();
    const productNameById = new Map<number, string>();
    for (const r of parsed.rowsByTable.get("products") ?? []) {
      productNameById.set(asInt(r.id), asText(r.name));
    }
    for (const bd of parsed.rowsByTable.get("bill_details") ?? []) {
      const billId = asInt(bd.bill_id);
      const prodId = asInt(bd.prod_id);
      const storeId = asInt(bd.store_id);
      if (storeId > 0 && !billTopStore.has(billId)) {
        billTopStore.set(billId, storeId);
      }
      if (prodId > 0 && storeId > 0) {
        let freq = prodStoreFreq.get(prodId);
        if (!freq) {
          freq = new Map();
          prodStoreFreq.set(prodId, freq);
        }
        freq.set(storeId, (freq.get(storeId) ?? 0) + 1);
      }
      const pName = productNameById.get(prodId);
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

    // 7. Inventory Items (`products`)
    const inventoryByLegacyId = new Map<number, { id: string; name: string }>();
    const insInv = db.prepare(
      `INSERT INTO inventory_items (
         id, workspace_id, warehouse_id, name, unit, quantity, avg_cost, selling_price,
         min_threshold, sku, unit2, count2, sprice2, unit3, count3, sprice3,
         default_unit, expiry_date, has_expiry, currency_code, bstate,
         quantity_unverified, legacy_id, legacy_ref, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 25, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    );
    let inventoryCount = 0;
    for (const r of parsed.rowsByTable.get("products") ?? []) {
      const lid = asInt(r.id);
      const id = `sp_inv_${lid}`;
      const name = asText(r.name) || `صنف ${lid}`;
      let bestStoreId = 0;
      let bestHits = 0;
      for (const [sid, hits] of prodStoreFreq.get(lid) ?? []) {
        if (hits > bestHits && warehouseByLegacyId.has(sid)) {
          bestStoreId = sid;
          bestHits = hits;
        }
      }
      const whId = warehouseByLegacyId.get(bestStoreId)?.id ?? fallbackWhId;
      if (!whId) continue;
      const buyPrice = Math.max(0, asNum(r.buy_price ?? r.price2, 0));
      const sellPriceRaw = asNum(r.sell_price ?? r.price, 0);
      const sellPrice = sellPriceRaw > 0 ? sellPriceRaw : null;
      const c2 = asNum(r.count2, 0);
      const sp2 = asNum(r.sprice2, 0);
      const c3 = asNum(r.count3, 0);
      const sp3 = asNum(r.sprice3, 0);
      insInv.run(
        id,
        workspaceId,
        whId,
        name,
        asText(r.unit) || "حبة",
        buyPrice,
        sellPrice,
        asText(r.barcode),
        asText(r.unit2),
        c2 > 0 ? c2 : null,
        sp2 > 0 ? sp2 : null,
        asText(r.unit3),
        c3 > 0 ? c3 : null,
        sp3 > 0 ? sp3 : null,
        asInt(r.defunit, 1),
        asText(r.exdate) || null,
        asInt(r.dated, 0),
        mapCurrencyCode(asInt(r.cur, 1), currenciesById, {}),
        asInt(r.bstate, 1),
        lid,
        `${sourceSha256.slice(0, 12)}:products:${lid}`,
        now,
        now,
      );
      inventoryByLegacyId.set(lid, { id, name });
      inventoryCount += 1;
    }

    // 8. Ledger Entries (`bounds` or `input_move`)
    const entryIdByLegacyBillId = new Map<number, string>();
    const missingCurrencyIds: Record<string, number> = {};
    let zeroAmountBounds = 0;
    const insLedger = db.prepare(
      `INSERT INTO ledger_entries (
         id, workspace_id, account_id, account_name, counterpart_account_id, counterpart_account_name,
         cashbox_id, kind, type_label, payment, direction, amount, raw_dain, raw_madin, settled_on_receipt,
         currency, exchange_rate, details, document_number, warehouse_id, warehouse_name, invoice_content,
         entry_number, deleted, entry_date, sender, receiver, company_name, discount, bonus,
         doc_type, bstate, source_origin, posting_status, created_at_ms, legacy_id, legacy_ref
       ) VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'smartpro_sql', 'posted', ?, ?, ?)`,
    );
    let ledgerCount = 0;
    for (const r of parsed.rowsByTable.get("bounds") ?? parsed.rowsByTable.get("input_move") ?? []) {
      const lid = asInt(r.id);
      const id = `sp_ent_${lid}`;
      const accId = asInt(r.acc_id ?? r.per_id);
      const account = accountByLegacyId.get(accId);
      if (!account) continue;

      const rawDain = Math.max(0, asNum(r.dain, 0));
      const rawMadin = Math.max(0, asNum(r.madin, 0));
      const settledOnReceipt = rawDain > 0 && rawMadin > 0 && Math.abs(rawDain - rawMadin) < 0.01;
      if (rawDain === 0 && rawMadin === 0) zeroAmountBounds += 1;

      const docType = asInt(r.doc_type ?? r.bill_type, 1);
      const cboxLegacyId = asInt(r.cboxid, 0);
      const cashboxDbId = cashboxByLegacyId.get(cboxLegacyId) ?? null;
      const docMeta = classifyBoundsDocType(docType, settledOnReceipt, rawDain);

      let payment: "cash" | "credit" | "balance" = "credit";
      let direction: "debit" | "credit" = "debit";
      let amount = 0;
      if (settledOnReceipt) {
        payment = "cash";
        amount = rawDain;
        direction = docMeta.cashDefaultDirection;
      } else if (rawDain > 0 && rawMadin === 0) {
        payment = docType === 1 && cboxLegacyId > 0 ? "cash" : "credit";
        direction = "debit";
        amount = rawDain;
      } else if (rawMadin > 0 && rawDain === 0) {
        payment = docType === 1 && cboxLegacyId > 0 ? "cash" : "credit";
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

      const currency = mapCurrencyCode(asInt(r.cur_id ?? r.cur, 1), currenciesById, missingCurrencyIds);
      const rawNdate = asText(r.ndate);
      const yInt = asInt(r.year);
      const mInt = asInt(r.month);
      const dInt = asInt(r.day);
      const entryDate =
        asText(r.date) ||
        (/^\d{8}$/.test(rawNdate) && rawNdate !== "00000000"
          ? `${rawNdate.slice(0, 4)}-${rawNdate.slice(4, 6)}-${rawNdate.slice(6, 8)}`
          : yInt > 1900 && mInt >= 1 && mInt <= 12 && dInt >= 1 && dInt <= 31
            ? `${yInt}-${String(mInt).padStart(2, "0")}-${String(dInt).padStart(2, "0")}`
            : now.slice(0, 10));
      const dateMs = Date.parse(`${entryDate}T00:00:00Z`);
      const createdAtMs = Number.isFinite(dateMs) ? dateMs + lid : Date.now() + lid;

      const storeLegacyId = billTopStore.get(lid) ?? 0;
      const wh = warehouseByLegacyId.get(storeLegacyId) ?? (fallbackWhId ? { id: fallbackWhId, name: warehouseByLegacyId.get(1)?.name ?? "" } : null);

      const rawDetails = asText(r.details);
      const lineSummary = billFirstItems.get(lid)?.join("\n") ?? "";
      const details = (rawDetails || lineSummary).slice(0, 600);

      insLedger.run(
        id,
        workspaceId,
        account.id,
        account.name,
        cashboxDbId,
        docMeta.kind,
        docMeta.typeLabel,
        payment,
        direction,
        amount,
        rawDain,
        rawMadin,
        settledOnReceipt ? 1 : 0,
        currency,
        details,
        asText(r.bill),
        wh?.id ?? "",
        wh?.name ?? "",
        docMeta.invoiceContent,
        lid,
        entryDate,
        asText(r.sender),
        asText(r.recever),
        asText(r.comp),
        asNum(r.discount, 0),
        asNum(r.bonus, 0),
        docType,
        asInt(r.bstate, 1),
        createdAtMs,
        lid,
        `${sourceSha256.slice(0, 12)}:bounds:${lid}`,
      );
      entryIdByLegacyBillId.set(lid, id);
      ledgerCount += 1;
    }

    // 9. Invoice Lines (`bill_details` + `bill_details2`)
    const insLine = db.prepare(
      `INSERT INTO invoice_lines (
         workspace_id, entry_id, line_kind, inventory_item_id, warehouse_id, item_name,
         price, quantity, total, discount, bonus, unit, unit_num, details, expiry_date, legacy_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let invoiceLinesCount = 0;
    for (const r of parsed.rowsByTable.get("bill_details") ?? []) {
      const billId = asInt(r.bill_id);
      const entryId = entryIdByLegacyBillId.get(billId);
      if (!entryId) continue;
      const prodId = asInt(r.prod_id);
      const inv = inventoryByLegacyId.get(prodId);
      const wh = warehouseByLegacyId.get(asInt(r.store_id));
      insLine.run(
        workspaceId,
        entryId,
        "item",
        inv?.id ?? null,
        wh?.id ?? null,
        inv?.name ?? asText(r.details) ?? `صنف ${prodId}`,
        asNum(r.price, 0),
        asNum(r.amount, 0),
        asNum(r.total, 0),
        asNum(r.discount, 0),
        asNum(r.bonus, 0),
        asText(r.unit),
        asInt(r.unitnum, 1),
        asText(r.details),
        asText(r.exdate),
        asInt(r.id),
      );
      invoiceLinesCount += 1;
    }
    for (const r of parsed.rowsByTable.get("bill_details2") ?? []) {
      const billId = asInt(r.bill_id);
      const entryId = entryIdByLegacyBillId.get(billId);
      if (!entryId) continue;
      insLine.run(
        workspaceId,
        entryId,
        "free",
        null,
        null,
        asText(r.details) || "بند حر",
        asNum(r.price, 0),
        asNum(r.amount, 0),
        asNum(r.total, 0),
        asNum(r.discount, 0),
        asNum(r.bonus, 0),
        asText(r.unit),
        1,
        asText(r.details),
        "",
        asInt(r.id),
      );
      invoiceLinesCount += 1;
    }

    // 10. Stock Transfers (`store_trans` + `trans_details`)
    const transferIdByLegacyId = new Map<number, number>();
    let missingTransferStoreRefs = 0;
    const insTx = db.prepare(
      `INSERT INTO stock_transfers (workspace_id, from_warehouse_id, to_warehouse_id, raw_from_store_id, raw_to_store_id, details, transfer_date, transfer_type, user_legacy_id, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let stockTransfersCount = 0;
    for (const r of parsed.rowsByTable.get("store_trans") ?? []) {
      const lid = asInt(r.id);
      const s1 = asInt(r.store_id1);
      const s2 = asInt(r.store_id2);
      const w1 = warehouseByLegacyId.get(s1)?.id ?? null;
      const w2 = warehouseByLegacyId.get(s2)?.id ?? null;
      if (!w1 || !w2) missingTransferStoreRefs += 1;
      const res = insTx.run(workspaceId, w1, w2, s1, s2, asText(r.details), asText(r.date), asInt(r.type, 1), asInt(r.user_id, 0), lid);
      transferIdByLegacyId.set(lid, Number(res.lastInsertRowid));
      stockTransfersCount += 1;
    }

    const insTxLine = db.prepare(
      `INSERT INTO stock_transfer_lines (workspace_id, transfer_id, inventory_item_id, raw_prod_id, quantity, unit, unit_num, details, expiry_date, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let stockTransferLinesCount = 0;
    for (const r of parsed.rowsByTable.get("trans_details") ?? []) {
      const txId = transferIdByLegacyId.get(asInt(r.bill_id));
      if (!txId) continue;
      const pid = asInt(r.prod_id);
      insTxLine.run(workspaceId, txId, inventoryByLegacyId.get(pid)?.id ?? null, pid, asNum(r.amount, 0), asText(r.unit), asInt(r.unitnum, 1), asText(r.details), asText(r.exdate), asInt(r.id));
      stockTransferLinesCount += 1;
    }

    // 11. Price Offers (`offers`, `offer_bill_details`, `offer_sbill_details`)
    const offerIdByLegacyId = new Map<number, number>();
    const insOffer = db.prepare(
      `INSERT INTO price_offers (workspace_id, account_id, raw_acc_id, name, offer_type, dain, madin, currency, offer_date, details, bonus, discount, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let priceOffersCount = 0;
    for (const r of parsed.rowsByTable.get("offers") ?? []) {
      const lid = asInt(r.id);
      const rawAcc = asInt(r.acc_id);
      const res = insOffer.run(
        workspaceId,
        accountByLegacyId.get(rawAcc)?.id ?? null,
        rawAcc,
        asText(r.name),
        asInt(r.type, 1),
        asNum(r.dain, 0),
        asNum(r.madin, 0),
        mapCurrencyCode(asInt(r.cur_id, 1), currenciesById, {}),
        asText(r.date),
        asText(r.details),
        asNum(r.bonus, 0),
        asNum(r.discount, 0),
        lid,
      );
      offerIdByLegacyId.set(lid, Number(res.lastInsertRowid));
      priceOffersCount += 1;
    }

    const insOfferLine = db.prepare(
      `INSERT INTO price_offer_lines (workspace_id, offer_id, line_kind, inventory_item_id, raw_prod_id, price, quantity, total, unit, unit_num, details, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let priceOfferLinesCount = 0;
    for (const r of parsed.rowsByTable.get("offer_bill_details") ?? []) {
      const oid = offerIdByLegacyId.get(asInt(r.bill_id));
      if (!oid) continue;
      const pid = asInt(r.prod_id);
      insOfferLine.run(workspaceId, oid, "item", inventoryByLegacyId.get(pid)?.id ?? null, pid, asNum(r.price, 0), asNum(r.amount, 0), asNum(r.total, 0), asText(r.unit), asInt(r.unitnum, 1), asText(r.details), asInt(r.id));
      priceOfferLinesCount += 1;
    }
    for (const r of parsed.rowsByTable.get("offer_sbill_details") ?? []) {
      const oid = offerIdByLegacyId.get(asInt(r.bill_id));
      if (!oid) continue;
      insOfferLine.run(workspaceId, oid, "free", null, null, asNum(r.price, 0), asNum(r.amount, 0), asNum(r.total, 0), asText(r.unit), 1, asText(r.details), asInt(r.id));
      priceOfferLinesCount += 1;
    }

    // 12. Deleted Archive (`bin`, `bin_bill_details`, `bin_bill_details2`)
    const binIdByLegacyId = new Map<number, number>();
    const insBin = db.prepare(
      `INSERT INTO archived_documents (
         workspace_id, legacy_id, account_id, raw_acc_id, account_name, group_name, currency_name, box_name,
         doc_type, bstate, dain, madin, doc_date, bill_no, details, ref, sender, receiver, company_name,
         discount, bonus, curprice, cbox_id, discount_amount
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let archivedDocumentsCount = 0;
    for (const r of parsed.rowsByTable.get("bin") ?? []) {
      const lid = asInt(r.id);
      const rawPer = asInt(r.per_id);
      const res = insBin.run(
        workspaceId, lid, accountByLegacyId.get(rawPer)?.id ?? null, rawPer,
        asText(r.pername) || accountByLegacyId.get(rawPer)?.name || "",
        asText(r.boxname), asText(r.curname) || "ريال", asText(r.boxname),
        asInt(r.bill_type, 1), asInt(r.bstate, 1), asNum(r.dain, 0), asNum(r.madin, 0),
        asText(r.date), asText(r.bill), asText(r.details), asText(r.ref),
        asText(r.sender), asText(r.recever), asText(r.comp),
        asNum(r.discount, 0), asNum(r.bonus, 0), asText(r.curprice), asInt(r.cboxid, 0), asNum(r.discount_amount, 0),
      );
      binIdByLegacyId.set(lid, Number(res.lastInsertRowid));
      archivedDocumentsCount += 1;
    }

    const insBinLine = db.prepare(
      `INSERT INTO archived_document_lines (
         workspace_id, archived_doc_id, line_kind, inventory_item_id, raw_prod_id, warehouse_id, raw_store_id,
         price, quantity, total, discount, bonus, unit, unit_num, details, expiry_date, legacy_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let archivedDocumentLinesCount = 0;
    for (const r of parsed.rowsByTable.get("bin_bill_details") ?? []) {
      const did = binIdByLegacyId.get(asInt(r.bill_id));
      if (!did) continue;
      const pid = asInt(r.prod_id);
      const sid = asInt(r.store_id);
      insBinLine.run(
        workspaceId, did, "item", inventoryByLegacyId.get(pid)?.id ?? null, pid,
        warehouseByLegacyId.get(sid)?.id ?? null, sid,
        asNum(r.price, 0), asNum(r.amount, 0), asNum(r.total, 0), asNum(r.discount, 0), asNum(r.bonus, 0),
        asText(r.unit), asInt(r.unitnum, 1), asText(r.details), asText(r.exdate), asInt(r.id),
      );
      archivedDocumentLinesCount += 1;
    }
    for (const r of parsed.rowsByTable.get("bin_bill_details2") ?? []) {
      const did = binIdByLegacyId.get(asInt(r.bill_id));
      if (!did) continue;
      insBinLine.run(
        workspaceId, did, "free", null, null, null, null,
        asNum(r.price, 0), asNum(r.amount, 0), asNum(r.total, 0), asNum(r.discount, 0), asNum(r.bonus, 0),
        asText(r.unit), 1, asText(r.details), "", asInt(r.id),
      );
      archivedDocumentLinesCount += 1;
    }

    // 13. Alerts
    const insAlert = db.prepare(
      `INSERT INTO alerts (workspace_id, account_id, raw_per_id, alert_date, details, legacy_id) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    let alertsCount = 0;
    for (const r of parsed.rowsByTable.get("alerts") ?? []) {
      const rawPer = asInt(r.per_id);
      insAlert.run(workspaceId, accountByLegacyId.get(rawPer)?.id ?? null, rawPer, asText(r.mdate), asText(r.det), asInt(r.id));
      alertsCount += 1;
    }

    // 14. Initialize clean empty ERP module marker unless explicitly saved in backup
    const erpExists = db.prepare("SELECT workspace_id FROM erp_meta WHERE workspace_id = ?").get(workspaceId);
    if (!erpExists) {
      saveErpDataRows(db, workspaceId, createEmptyErpData());
    }

    const anomalies = {
      missingCurrencyIds,
      missingTransferStoreRefs,
      zeroAmountBounds,
    };

    const impId = `imp_${sourceSha256.slice(0, 12)}`;
    db.prepare(
      `INSERT INTO legacy_imports (id, workspace_id, source_name, source_format, source_sha256, tables_count, total_rows, imported_at, notes_json)
       VALUES (?, ?, ?, 'smartpro_mariadb_sql', ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, source_sha256) DO UPDATE SET imported_at = excluded.imported_at, notes_json = excluded.notes_json`,
    ).run(impId, workspaceId, sourceName, sourceSha256, parsed.columnsByTable.size, totalSourceRows, now, JSON.stringify({ tableCounts, anomalies }));

    writeAudit(db, workspaceId, workspaceId, "legacy_imports", impId, "import_sql", {
      sourceName,
      totalSourceRows,
      accountsCount,
      ledgerCount,
      invoiceLinesCount,
    });

    return {
      sourceName,
      sourceSha256,
      skippedDuplicate: false,
      tablesDetected: parsed.columnsByTable.size,
      totalSourceRows,
      tableCounts,
      imported: {
        accounts: accountsCount,
        accountGroups: accountGroupsCount,
        cashboxes: cashboxesCount,
        currencies: currenciesCount,
        warehouses: warehousesCount,
        inventoryItems: inventoryCount,
        ledgerEntries: ledgerCount,
        invoiceLines: invoiceLinesCount,
        stockTransfers: stockTransfersCount,
        stockTransferLines: stockTransferLinesCount,
        priceOffers: priceOffersCount,
        priceOfferLines: priceOfferLinesCount,
        archivedDocuments: archivedDocumentsCount,
        archivedDocumentLines: archivedDocumentLinesCount,
        alerts: alertsCount,
        legacyUsers: legacyUsersCount,
        legacyPermissions: legacyPermissionsCount,
      },
      anomalies,
    };
  });
}

export function bootstrapSmartProSqlIfConfigured(db: DatabaseSync, defaultSqlPath = process.env.NASQO_BOOTSTRAP_SQL_PATH || "d:\\SmartProBackups\\smartprodb.sql"): SmartProSqlImportReport | null {
  if (process.env.NASQO_AUTO_BOOTSTRAP_SQL !== "1" || process.env.NASQO_SKIP_AUTO_SQL_IMPORT === "1") return null;
  const existingWs = db.prepare("SELECT COUNT(*) AS c FROM workspaces").get() as { c: number };
  if (Number(existingWs?.c ?? 0) > 0) return null;
  if (!fs.existsSync(defaultSqlPath)) return null;
  const sqlText = fs.readFileSync(defaultSqlPath, "utf8");
  return importSmartProSqlDump(db, sqlText, {
    workspaceId: DEFAULT_WORKSPACE_ID,
    sourceName: defaultSqlPath.split(/[\\/]/).pop() || "smartprodb.sql",
    replaceExisting: true,
  });
}
