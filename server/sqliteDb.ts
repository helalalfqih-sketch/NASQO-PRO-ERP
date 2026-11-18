import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import {
  createDefaultErpData,
  createEmptyErpData,
  sanitizeAccountPayload,
  sanitizeInventoryPayload,
  sanitizeLedgerPayload,
  sanitizeWarehousePayload,
  sanitizeWorkspacePayload,
} from "./sqliteRuntimeSupport.ts";
import type { ErpWorkspaceData } from "../src/erp.ts";
import type {
  AccountCategory,
  AccountGroupRecord,
  AccountRecord,
  CashboxRecord,
  CurrencyCode,
  InvoiceLineInput,
  InventoryItemRecord,
  LedgerEntryRecord,
  WarehouseRecord,
  WorkspaceSettings,
} from "../src/types.ts";
import {
  SQLITE_SCHEMA_MIGRATION_V2_DDL,
  SQLITE_SCHEMA_V2,
  UNIFIED_SQLITE_DDL,
  UNIFIED_SQLITE_TABLES,
  type UnifiedSqliteTableName,
} from "./sqliteSchema.ts";

export const DEFAULT_WORKSPACE_ID = "local-erp-workspace";

export class SqliteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqliteValidationError";
  }
}

let cachedDb: DatabaseSync | null = null;
let cachedDbPath = "";

export function resolveSqliteDbPath(overridePath?: string): string {
  if (overridePath) return overridePath;
  const envPath = process.env.NASQO_SQLITE_PATH?.trim();
  if (envPath) return envPath;
  return path.resolve(process.cwd(), "data", "nasqo.sqlite");
}

function openAndInit(filePath: string): DatabaseSync {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const db = new DatabaseSync(filePath);
  if (filePath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
  }
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(UNIFIED_SQLITE_DDL);
  db.exec(SQLITE_SCHEMA_MIGRATION_V2_DDL);
  const verRow = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  if (Number(verRow?.user_version ?? 0) < SQLITE_SCHEMA_V2) {
    db.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_V2};`);
  }
  return db;
}

export function getSqliteDb(overridePath?: string): DatabaseSync {
  const target = resolveSqliteDbPath(overridePath);
  if (cachedDb && cachedDbPath === target) {
    return cachedDb;
  }
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch {
      // ignore close failures during path swap
    }
    cachedDb = null;
  }
  cachedDb = openAndInit(target);
  cachedDbPath = target;
  return cachedDb;
}

export function closeSqliteDb(): void {
  if (!cachedDb) return;
  try {
    cachedDb.close();
  } finally {
    cachedDb = null;
    cachedDbPath = "";
  }
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  const alreadyOpen = Boolean((db as unknown as { isTransaction?: boolean }).isTransaction);
  if (alreadyOpen) {
    return fn();
  }
  db.exec("BEGIN IMMEDIATE;");
  try {
    const out = fn();
    db.exec("COMMIT;");
    return out;
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore rollback errors
    }
    throw err;
  }
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

export function writeAudit(
  db: DatabaseSync,
  workspaceId: string,
  actorUid: string,
  tableName: string,
  rowId: string,
  action: string,
  summary: unknown = {},
): void {
  db.prepare(
    `INSERT INTO audit_log (workspace_id, actor_uid, table_name, row_id, action, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(workspaceId, actorUid, tableName, rowId, action, JSON.stringify(summary ?? {}), new Date().toISOString());
}

function nowIso(): string {
  return new Date().toISOString();
}

export function saveErpDataRows(db: DatabaseSync, workspaceId: string, data: ErpWorkspaceData): void {
  const now = nowIso();
  db.prepare("DELETE FROM erp_employees WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM erp_leave_requests WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM erp_deals WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM erp_purchase_orders WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM erp_boms WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM erp_production_orders WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM erp_cost_centers WHERE workspace_id = ?").run(workspaceId);

  const insEmp = db.prepare(
    `INSERT INTO erp_employees (id, workspace_id, account_id, name, role_title, department, basic_salary, allowances, deductions, status, hire_date, leave_balance_days, attendance_today)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of data.employees ?? []) {
    insEmp.run(
      e.id,
      workspaceId,
      e.accountId ?? null,
      e.name,
      e.roleTitle,
      e.department,
      Number(e.basicSalary || 0),
      Number(e.allowances || 0),
      Number(e.deductions || 0),
      e.status,
      e.hireDate,
      Number(e.leaveBalanceDays || 0),
      e.attendanceToday,
    );
  }

  const insLeave = db.prepare(
    `INSERT INTO erp_leave_requests (id, workspace_id, employee_id, employee_name, leave_type, start_date, days, status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const l of data.leaveRequests ?? []) {
    insLeave.run(l.id, workspaceId, l.employeeId, l.employeeName, l.leaveType, l.startDate, Number(l.days || 1), l.status, l.note ?? "");
  }

  const insDeal = db.prepare(
    `INSERT INTO erp_deals (id, workspace_id, title, client_account_id, client_name, value, currency, stage, probability, expected_close_date, assigned_to, converted_invoice_entry_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const d of data.deals ?? []) {
    insDeal.run(
      d.id,
      workspaceId,
      d.title,
      d.clientAccountId,
      d.clientName,
      Number(d.value || 0),
      d.currency,
      d.stage,
      Number(d.probability || 0),
      d.expectedCloseDate,
      d.assignedTo ?? "",
      d.convertedInvoiceEntryId ?? null,
    );
  }

  const insPo = db.prepare(
    `INSERT INTO erp_purchase_orders (id, workspace_id, po_number, supplier_account_id, supplier_name, warehouse_id, warehouse_name, currency, order_date, expected_date, status, lines_json, notes, posted_ledger_entry_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const po of data.purchaseOrders ?? []) {
    insPo.run(
      po.id,
      workspaceId,
      po.poNumber,
      po.supplierAccountId,
      po.supplierName,
      po.warehouseId,
      po.warehouseName,
      po.currency,
      po.orderDate,
      po.expectedDate,
      po.status,
      JSON.stringify(po.lines ?? []),
      po.notes ?? "",
      po.postedLedgerEntryId ?? null,
    );
  }

  const insBom = db.prepare(
    `INSERT INTO erp_boms (id, workspace_id, name, finished_item_id, finished_item_name, finished_unit, components_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const b of data.boms ?? []) {
    insBom.run(b.id, workspaceId, b.name, b.finishedItemId, b.finishedItemName, b.finishedUnit, JSON.stringify(b.components ?? []));
  }

  const insProd = db.prepare(
    `INSERT INTO erp_production_orders (id, workspace_id, order_number, bom_id, bom_name, finished_item_id, finished_item_name, quantity_to_produce, warehouse_id, status, created_date, completed_date, cost_center_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const p of data.productionOrders ?? []) {
    insProd.run(
      p.id,
      workspaceId,
      p.orderNumber,
      p.bomId,
      p.bomName,
      p.finishedItemId,
      p.finishedItemName,
      Number(p.quantityToProduce || 0),
      p.warehouseId,
      p.status,
      p.createdDate,
      p.completedDate ?? null,
      p.costCenterId ?? null,
    );
  }

  const insCc = db.prepare(
    `INSERT INTO erp_cost_centers (id, workspace_id, code, name, manager_name, budget, extra_posted_spend, linked_categories_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of data.costCenters ?? []) {
    insCc.run(
      c.id,
      workspaceId,
      c.code,
      c.name,
      c.managerName ?? "",
      Number(c.budget || 0),
      Number(c.extraPostedSpend || 0),
      JSON.stringify(c.linkedCategories ?? []),
      c.status,
    );
  }

  db.prepare(
    `INSERT INTO erp_meta (workspace_id, last_payroll_run_month, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET last_payroll_run_month = excluded.last_payroll_run_month, updated_at = excluded.updated_at`,
  ).run(workspaceId, data.lastPayrollRunMonth ?? null, now);
}

export function loadErpDataRows(db: DatabaseSync, workspaceId: string): ErpWorkspaceData {
  const meta = db.prepare("SELECT last_payroll_run_month FROM erp_meta WHERE workspace_id = ?").get(workspaceId) as
    | { last_payroll_run_month?: string | null }
    | undefined;
  if (!meta) {
    return createEmptyErpData();
  }

  const employees = (
    db.prepare("SELECT * FROM erp_employees WHERE workspace_id = ?").all(workspaceId) as Record<string, unknown>[]
  ).map((r) => ({
    id: String(r.id),
    ...(r.account_id ? { accountId: String(r.account_id) } : {}),
    name: String(r.name),
    roleTitle: String(r.role_title ?? ""),
    department: String(r.department ?? ""),
    basicSalary: Number(r.basic_salary ?? 0),
    allowances: Number(r.allowances ?? 0),
    deductions: Number(r.deductions ?? 0),
    status: (r.status as "active" | "on-leave" | "inactive") ?? "active",
    hireDate: String(r.hire_date ?? ""),
    leaveBalanceDays: Number(r.leave_balance_days ?? 0),
    attendanceToday: (r.attendance_today as "present" | "leave" | "absent") ?? "present",
  }));

  const leaveRequests = (
    db.prepare("SELECT * FROM erp_leave_requests WHERE workspace_id = ?").all(workspaceId) as Record<string, unknown>[]
  ).map((r) => ({
    id: String(r.id),
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    leaveType: r.leave_type as "سنوية" | "مرضية" | "اضطرارية",
    startDate: String(r.start_date),
    days: Number(r.days ?? 1),
    status: (r.status as "pending" | "approved" | "rejected") ?? "pending",
    note: String(r.note ?? ""),
  }));

  const deals = (
    db.prepare("SELECT * FROM erp_deals WHERE workspace_id = ?").all(workspaceId) as Record<string, unknown>[]
  ).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    clientAccountId: String(r.client_account_id),
    clientName: String(r.client_name),
    value: Number(r.value ?? 0),
    currency: String(r.currency ?? "ريال") as ErpWorkspaceData["deals"][number]["currency"],
    stage: r.stage as ErpWorkspaceData["deals"][number]["stage"],
    probability: Number(r.probability ?? 50),
    expectedCloseDate: String(r.expected_close_date ?? ""),
    assignedTo: String(r.assigned_to ?? ""),
    ...(r.converted_invoice_entry_id ? { convertedInvoiceEntryId: String(r.converted_invoice_entry_id) } : {}),
  }));

  const purchaseOrders = (
    db.prepare("SELECT * FROM erp_purchase_orders WHERE workspace_id = ?").all(workspaceId) as Record<string, unknown>[]
  ).map((r) => ({
    id: String(r.id),
    poNumber: String(r.po_number),
    supplierAccountId: String(r.supplier_account_id),
    supplierName: String(r.supplier_name),
    warehouseId: String(r.warehouse_id),
    warehouseName: String(r.warehouse_name),
    currency: String(r.currency ?? "ريال") as ErpWorkspaceData["purchaseOrders"][number]["currency"],
    orderDate: String(r.order_date),
    expectedDate: String(r.expected_date ?? ""),
    status: r.status as ErpWorkspaceData["purchaseOrders"][number]["status"],
    lines: JSON.parse(String(r.lines_json ?? "[]")),
    notes: String(r.notes ?? ""),
    ...(r.posted_ledger_entry_id ? { postedLedgerEntryId: String(r.posted_ledger_entry_id) } : {}),
  }));

  const boms = (
    db.prepare("SELECT * FROM erp_boms WHERE workspace_id = ?").all(workspaceId) as Record<string, unknown>[]
  ).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    finishedItemId: String(r.finished_item_id),
    finishedItemName: String(r.finished_item_name),
    finishedUnit: String(r.finished_unit ?? "حبة"),
    components: JSON.parse(String(r.components_json ?? "[]")),
  }));

  const productionOrders = (
    db.prepare("SELECT * FROM erp_production_orders WHERE workspace_id = ?").all(workspaceId) as Record<string, unknown>[]
  ).map((r) => ({
    id: String(r.id),
    orderNumber: String(r.order_number),
    bomId: String(r.bom_id),
    bomName: String(r.bom_name),
    finishedItemId: String(r.finished_item_id),
    finishedItemName: String(r.finished_item_name),
    quantityToProduce: Number(r.quantity_to_produce ?? 0),
    warehouseId: String(r.warehouse_id),
    status: r.status as ErpWorkspaceData["productionOrders"][number]["status"],
    createdDate: String(r.created_date),
    ...(r.completed_date ? { completedDate: String(r.completed_date) } : {}),
    ...(r.cost_center_id ? { costCenterId: String(r.cost_center_id) } : {}),
  }));

  const costCenters = (
    db.prepare("SELECT * FROM erp_cost_centers WHERE workspace_id = ?").all(workspaceId) as Record<string, unknown>[]
  ).map((r) => ({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    managerName: String(r.manager_name ?? ""),
    budget: Number(r.budget ?? 0),
    extraPostedSpend: Number(r.extra_posted_spend ?? 0),
    linkedCategories: JSON.parse(String(r.linked_categories_json ?? "[]")),
    status: (r.status === "closed" ? "closed" : "active") as "active" | "closed",
  }));

  return {
    employees,
    leaveRequests,
    deals,
    purchaseOrders,
    boms,
    productionOrders,
    costCenters,
    ...(meta.last_payroll_run_month ? { lastPayrollRunMonth: String(meta.last_payroll_run_month) } : {}),
  };
}

function ensureDefaultAccountGroups(db: DatabaseSync, workspaceId: string) {
  const existingCount = Number(
    (db.prepare("SELECT COUNT(*) AS c FROM account_groups WHERE workspace_id = ?").get(workspaceId) as { c: number }).c,
  );
  if (existingCount > 0) return;
  const defs: { legacyId: number; name: string; category: AccountCategory; sort: number }[] = [
    { legacyId: 1, name: "المبيعات", category: "sales", sort: 1 },
    { legacyId: 2, name: "المشتريات", category: "purchases", sort: 2 },
    { legacyId: 3, name: "العملاء", category: "clients", sort: 3 },
    { legacyId: 4, name: "الموظفين", category: "employees", sort: 4 },
    { legacyId: 6, name: "المحل", category: "shop", sort: 6 },
  ];
  const ins = db.prepare(
    `INSERT INTO account_groups (workspace_id, name, category, currency_code, sort_order, legacy_id)
     VALUES (?, ?, ?, 'ريال', ?, ?)`,
  );
  const linkAcc = db.prepare(
    `UPDATE accounts SET group_id = ? WHERE workspace_id = ? AND category = ? AND group_id IS NULL`,
  );
  for (const d of defs) {
    const res = ins.run(workspaceId, d.name, d.category, d.sort, d.legacyId);
    linkAcc.run(Number(res.lastInsertRowid), workspaceId, d.category);
  }
}

export function ensureEmptyWorkspace(
  db: DatabaseSync,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  displayName?: string | null,
): void {
  const existing = db.prepare("SELECT id FROM workspaces WHERE id = ?").get(workspaceId);
  if (existing) {
    const erpMeta = db.prepare("SELECT workspace_id FROM erp_meta WHERE workspace_id = ?").get(workspaceId);
    if (!erpMeta) {
      db.prepare(
        `INSERT INTO erp_meta (workspace_id, last_payroll_run_month, updated_at) VALUES (?, NULL, ?)
         ON CONFLICT(workspace_id) DO NOTHING`,
      ).run(workspaceId, nowIso());
    }
    return;
  }
  withTransaction(db, () => {
    const now = nowIso();
    const companyName = displayName ? `نشاط ${displayName}` : "نسقو برو ERP";
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, company_name, default_currency, whatsapp_provider, whatsapp_instant_enabled, whatsapp_phone, created_at, updated_at)
       VALUES (?, ?, ?, 'ريال', 'nasqo', 0, '', ?, ?)`,
    ).run(workspaceId, workspaceId, companyName, now, now);
    db.prepare(
      `INSERT INTO currencies (workspace_id, code, name, symbol, rate_primary, rate_secondary, name_secondary)
       VALUES (?, 'ريال', 'ريال', 'ر.ي', 1, 1, '')`,
    ).run(workspaceId);
    db.prepare(
      `INSERT INTO erp_meta (workspace_id, last_payroll_run_month, updated_at) VALUES (?, NULL, ?)
       ON CONFLICT(workspace_id) DO NOTHING`,
    ).run(workspaceId, now);
  });
}

export function resetWorkspaceToEmpty(db: DatabaseSync, workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  withTransaction(db, () => {
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  });
  ensureEmptyWorkspace(db, workspaceId);
}

export function ensureStarterWorkspace(
  db: DatabaseSync,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  displayName?: string | null,
): void {
  const existing = db.prepare("SELECT id FROM workspaces WHERE id = ?").get(workspaceId);
  if (existing) {
    const erpMeta = db.prepare("SELECT workspace_id FROM erp_meta WHERE workspace_id = ?").get(workspaceId);
    if (!erpMeta) {
      withTransaction(db, () => saveErpDataRows(db, workspaceId, createDefaultErpData()));
    }
    ensureDefaultAccountGroups(db, workspaceId);
    return;
  }

  withTransaction(db, () => {
    const now = nowIso();
    const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const companyName = displayName ? `نشاط ${displayName}` : "نسقو برو ERP";

    db.prepare(
      `INSERT INTO workspaces (id, owner_id, company_name, default_currency, whatsapp_provider, whatsapp_instant_enabled, whatsapp_phone, created_at, updated_at)
       VALUES (?, ?, ?, 'ريال', 'nasqo', 0, '', ?, ?)`,
    ).run(workspaceId, workspaceId, companyName, now, now);

    db.prepare(
      `INSERT INTO currencies (workspace_id, code, name, symbol, rate_primary, rate_secondary, name_secondary)
       VALUES (?, 'ريال', 'ريال', 'ر.ي', 1, 1, '')`,
    ).run(workspaceId);

    db.prepare(
      `INSERT INTO cashboxes (workspace_id, name, details, state, currency_code, box_type, sort_order, legacy_id)
       VALUES (?, 'الصندوق الرئيسي', 'الصندوق الافتراضي', 1, 'ريال', 1, 0, 1)`,
    ).run(workspaceId);

    const starterWarehouses: (Omit<WarehouseRecord, "ownerId"> & { id: string })[] = [
      { id: `${workspaceId}_wh_1`, name: "المخزن الرئيسي", details: "المستودع الافتراضي", isDefault: true, codeNumber: 1 },
      { id: `${workspaceId}_wh_3`, name: "مخازن بينون", details: "مستودع البضائع العام", isDefault: false, codeNumber: 3 },
      { id: `${workspaceId}_wh_4`, name: "بينون", details: "فرع التوريد", isDefault: false, codeNumber: 4 },
    ];
    const insWh = db.prepare(
      `INSERT INTO warehouses (id, workspace_id, code_number, name, details, is_default, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    for (const wh of starterWarehouses) {
      insWh.run(wh.id, workspaceId, wh.codeNumber, wh.name, wh.details, wh.isDefault ? 1 : 0, now, now);
    }

    const whRef = (suffix: string) => `${workspaceId}_${suffix}`;
    const starterItems = [
      { id: whRef("inv_1"), name: "ابجورة شكل قمر", unit: "حبة", quantity: 40, avgCost: 2200, minThreshold: 25, sku: "SKU-1001", warehouseId: whRef("wh_3") },
      { id: whRef("inv_2"), name: "توصيلة تايب سي 2 متر", unit: "حبة", quantity: 120, avgCost: 1500, minThreshold: 30, sku: "SKU-1002", warehouseId: whRef("wh_1") },
      { id: whRef("inv_3"), name: "بطارية جهاز كشف الذهب", unit: "حبة", quantity: 25, avgCost: 1500, minThreshold: 25, sku: "SKU-1003", warehouseId: whRef("wh_1") },
      { id: whRef("inv_4"), name: "فواحة عطرية خازن", unit: "حبة", quantity: 35, avgCost: 3400, minThreshold: 20, sku: "SKU-1004", warehouseId: whRef("wh_3") },
      { id: whRef("inv_5"), name: "مكينة خياطة كبير", unit: "حبة", quantity: 12, avgCost: 10000, minThreshold: 25, sku: "SKU-1005", warehouseId: whRef("wh_1") },
      { id: whRef("inv_6"), name: "عازل سطوح 10 كيلو", unit: "كيلو", quantity: 18, avgCost: 33000, minThreshold: 25, sku: "SKU-1006", warehouseId: whRef("wh_1") },
      { id: whRef("inv_7"), name: "فرامة لحم", unit: "حبة", quantity: 15, avgCost: 3000, minThreshold: 25, sku: "SKU-1007", warehouseId: whRef("wh_4") },
    ];
    const insInv = db.prepare(
      `INSERT INTO inventory_items (id, workspace_id, warehouse_id, name, unit, quantity, avg_cost, selling_price, min_threshold, sku, quantity_unverified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?)`,
    );
    for (const item of starterItems) {
      insInv.run(item.id, workspaceId, item.warehouseId, item.name, item.unit, item.quantity, item.avgCost, item.minThreshold, item.sku, now, now);
    }

    const starterAccounts: Omit<AccountRecord, "ownerId">[] = [
      { id: whRef("acc_barari"), name: "البراري للتوريد", category: "purchases", phone: "055 832 1042", creditLimit: 1000000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 1, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 243450, openingDirection: "credit", codeNumber: 34 },
      { id: whRef("acc_naqd_hilal"), name: "نقـد هلال", category: "purchases", phone: "050 441 7731", creditLimit: 500000, currency: "ريال", isCashAccount: true, accountImage: "1", sortOrder: 2, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "حساب المشتريات النقدية", openingBalance: 0, openingDirection: "credit", codeNumber: 9 },
      { id: whRef("acc_waha"), name: "الواحة التجارية", category: "purchases", phone: "053 190 6208", creditLimit: 750000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 3, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 227601, openingDirection: "credit", codeNumber: 49 },
      { id: whRef("acc_khatabi"), name: "خطابي وشركاه", category: "purchases", phone: "056 710 8824", creditLimit: 250000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 4, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 64000, openingDirection: "debit", codeNumber: 53 },
      { id: whRef("acc_bashar"), name: "بشار العزي", category: "purchases", phone: "", creditLimit: 1000000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 5, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 227601, openingDirection: "credit", codeNumber: 6 },
      { id: whRef("acc_client_noor"), name: "شركة النور للتجارة", category: "clients", phone: "055 210 9934", creditLimit: 400000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 6, settlement: false, documentNumberRequired: false, messageMethod: "whatsapp", sendMode: "confirm", note: "عميل جملة رئيسي", openingBalance: 48500, openingDirection: "debit", codeNumber: 55 },
      { id: whRef("acc_shop_main"), name: "حساب المحل", category: "shop", phone: "", creditLimit: 500000, currency: "ريال", isCashAccount: false, accountImage: "2", sortOrder: 7, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "مصروفات وتشغيل المحل", openingBalance: 261100, openingDirection: "debit", codeNumber: 60 },
      { id: whRef("acc_emp_1"), name: "رواتب الموظفين", category: "employees", phone: "", creditLimit: 200000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 8, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 10500, openingDirection: "credit", codeNumber: 61 },
      { id: whRef("acc_sales_1"), name: "المبيعات العامة", category: "sales", phone: "", creditLimit: 2000000, currency: "ريال", isCashAccount: false, accountImage: "3", sortOrder: 9, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 172650, openingDirection: "debit", codeNumber: 62 },
    ];
    const insAcc = db.prepare(
      `INSERT INTO accounts (id, workspace_id, code_number, name, category, phone, credit_limit, currency, is_cash_account, account_image, sort_order, settlement, document_number_required, message_method, send_mode, note, opening_balance, opening_direction, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const acc of starterAccounts) {
      insAcc.run(
        acc.id, workspaceId, acc.codeNumber, acc.name, acc.category, acc.phone, acc.creditLimit, acc.currency,
        acc.isCashAccount ? 1 : 0, acc.accountImage, acc.sortOrder, acc.messageMethod, acc.sendMode,
        acc.note, acc.openingBalance, acc.openingDirection, now, now,
      );
    }
    ensureDefaultAccountGroups(db, workspaceId);

    const baseMs = Date.now() - 20 * 86_400_000;
    const starterLedger: Omit<LedgerEntryRecord, "ownerId">[] = [
      { id: whRef("ent_1108"), accountId: whRef("acc_barari"), accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "voucher", typeLabel: "عليه", payment: "cash", direction: "debit", amount: 20000, currency: "ريال", exchangeRate: 1, details: "تسوية حساب مورد", documentNumber: "", warehouseId: whRef("wh_1"), warehouseName: "المخزن الرئيسي", invoiceContent: "none", entryNumber: 1108, deleted: false, entryDate: daysAgoIso(18), expenseCategory: "مشتريات بضائع", deliveryDays: 3, createdAtMs: baseMs + 1000 },
      { id: whRef("ent_1136"), accountId: whRef("acc_barari"), accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "فاتورة آجلة", payment: "credit", direction: "credit", amount: 4000, currency: "ريال", exchangeRate: 1, details: "زينة منازل شكل شجرة | 1 حبة", documentNumber: "", warehouseId: whRef("wh_1"), warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1136, deleted: false, entryDate: daysAgoIso(11), expenseCategory: "مشتريات بضائع", deliveryDays: 2, createdAtMs: baseMs + 2000 },
      { id: whRef("ent_1178"), accountId: whRef("acc_barari"), accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "فاتورة آجلة", payment: "credit", direction: "credit", amount: 33000, currency: "ريال", exchangeRate: 1, details: "عازل سطوح 10 كيلو | 1 كيلو", documentNumber: "", warehouseId: whRef("wh_1"), warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1178, deleted: false, entryDate: daysAgoIso(5), dueDate: daysAgoIso(-3), expenseCategory: "مشتريات بضائع", deliveryDays: 4, createdAtMs: baseMs + 3000 },
      { id: whRef("ent_1090"), accountId: whRef("acc_naqd_hilal"), accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 17000, currency: "ريال", exchangeRate: 1, details: "فواحة عطرية خازن | 5 حبة", documentNumber: "", warehouseId: whRef("wh_3"), warehouseName: "مخازن بينون", invoiceContent: "items", entryNumber: 1090, deleted: false, entryDate: daysAgoIso(14), expenseCategory: "مشتريات بضائع", deliveryDays: 1, createdAtMs: baseMs + 4000 },
      { id: whRef("ent_1140"), accountId: whRef("acc_naqd_hilal"), accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 3000, currency: "ريال", exchangeRate: 1, details: "توصيلة تايب سي 2 متر | 1 حبة\nبطارية جهاز كشف الذهب | 1 حبة", documentNumber: "1140", warehouseId: whRef("wh_1"), warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1140, deleted: false, entryDate: daysAgoIso(6), expenseCategory: "مشتريات بضائع", deliveryDays: 2, createdAtMs: baseMs + 5000 },
      { id: whRef("ent_1218"), accountId: whRef("acc_naqd_hilal"), accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 20000, currency: "ريال", exchangeRate: 1, details: "محلات بن عوضة\nمكينة خياطة كبير | 2 حبة", documentNumber: "", warehouseId: whRef("wh_1"), warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1218, deleted: false, entryDate: daysAgoIso(3), expenseCategory: "شحن ونقل", deliveryDays: 2, createdAtMs: baseMs + 6000 },
      { id: whRef("ent_1225"), accountId: whRef("acc_shop_main"), accountName: "حساب المحل", counterpartAccountId: "", counterpartAccountName: "", kind: "voucher", typeLabel: "عليه (سند)", payment: "cash", direction: "debit", amount: 6500, currency: "ريال", exchangeRate: 1, details: "فاتورة كهرباء وصيانة مستودع", documentNumber: "1225", warehouseId: whRef("wh_1"), warehouseName: "المخزن الرئيسي", invoiceContent: "none", entryNumber: 1225, deleted: false, entryDate: daysAgoIso(4), expenseCategory: "صيانة ومرافق", createdAtMs: baseMs + 7000 },
      { id: whRef("ent_1230"), accountId: whRef("acc_emp_1"), accountName: "رواتب الموظفين", counterpartAccountId: "", counterpartAccountName: "", kind: "voucher", typeLabel: "عليه (سند)", payment: "cash", direction: "debit", amount: 12000, currency: "ريال", exchangeRate: 1, details: "دفعة رواتب شهرية", documentNumber: "1230", warehouseId: whRef("wh_1"), warehouseName: "المخزن الرئيسي", invoiceContent: "none", entryNumber: 1230, deleted: false, entryDate: daysAgoIso(2), expenseCategory: "رواتب وأجور", createdAtMs: baseMs + 8000 },
      { id: whRef("ent_1235"), accountId: whRef("acc_sales_1"), accountName: "المبيعات العامة", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "debit", amount: 24500, currency: "ريال", exchangeRate: 1, details: "مبيعات أجهزة وتجهيزات", documentNumber: "1235", warehouseId: whRef("wh_1"), warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1235, deleted: false, entryDate: daysAgoIso(1), createdAtMs: baseMs + 9000 },
      { id: whRef("ent_1236"), accountId: whRef("acc_sales_1"), accountName: "المبيعات العامة", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "debit", amount: 18500, currency: "ريال", exchangeRate: 1, details: "مبيعات الجملة اليومية", documentNumber: "1236", warehouseId: whRef("wh_1"), warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1236, deleted: false, entryDate: daysAgoIso(0), createdAtMs: baseMs + 10000 },
    ];
    const insEnt = db.prepare(
      `INSERT INTO ledger_entries (id, workspace_id, account_id, account_name, counterpart_account_id, counterpart_account_name, kind, type_label, payment, direction, amount, currency, exchange_rate, details, document_number, warehouse_id, warehouse_name, invoice_content, entry_number, deleted, entry_date, due_date, expense_category, delivery_days, created_at_ms)
       VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    );
    for (const e of starterLedger) {
      insEnt.run(
        e.id, workspaceId, e.accountId, e.accountName, e.kind, e.typeLabel, e.payment, e.direction, e.amount,
        e.currency, e.details, e.documentNumber, e.warehouseId, e.warehouseName, e.invoiceContent,
        e.entryNumber, e.entryDate, e.dueDate ?? null, e.expenseCategory ?? null, e.deliveryDays ?? null, e.createdAtMs,
      );
    }

    saveErpDataRows(db, workspaceId, createDefaultErpData());
    writeAudit(db, workspaceId, workspaceId, "workspaces", workspaceId, "seed", { starter: true });
  });
}

function mapWorkspaceRow(r: Record<string, unknown>): WorkspaceSettings {
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    companyName: String(r.company_name),
    defaultCurrency: String(r.default_currency ?? "ريال") as WorkspaceSettings["defaultCurrency"],
    whatsappProvider: r.whatsapp_provider === "external" ? "external" : "nasqo",
    whatsappInstantEnabled: Boolean(r.whatsapp_instant_enabled),
    whatsappPhone: String(r.whatsapp_phone ?? ""),
  };
}

function mapAccountRow(r: Record<string, unknown>): AccountRecord {
  return {
    id: String(r.id),
    ownerId: String(r.workspace_id),
    ...(r.group_id !== null && r.group_id !== undefined ? { groupId: Number(r.group_id) } : {}),
    name: String(r.name),
    category: String(r.category) as AccountRecord["category"],
    phone: String(r.phone ?? ""),
    creditLimit: Number(r.credit_limit ?? 0),
    currency: String(r.currency ?? "ريال") as AccountRecord["currency"],
    isCashAccount: Boolean(r.is_cash_account),
    accountImage: (r.account_image === "2" || r.account_image === "3" ? r.account_image : "1"),
    sortOrder: Number(r.sort_order ?? 1),
    settlement: Boolean(r.settlement),
    documentNumberRequired: Boolean(r.document_number_required),
    messageMethod: r.message_method === "whatsapp" ? "whatsapp" : "sms",
    sendMode: (r.send_mode === "auto" || r.send_mode === "confirm" ? r.send_mode : "never"),
    note: String(r.note ?? ""),
    openingBalance: Number(r.opening_balance ?? 0),
    openingDirection: r.opening_direction === "credit" ? "credit" : "debit",
    codeNumber: Number(r.code_number ?? 1),
    ...(r.legacy_ref ? { legacyRef: String(r.legacy_ref) } : {}),
  };
}

function mapWarehouseRow(r: Record<string, unknown>): WarehouseRecord {
  return {
    id: String(r.id),
    ownerId: String(r.workspace_id),
    name: String(r.name),
    details: String(r.details ?? ""),
    isDefault: Boolean(r.is_default),
    codeNumber: Number(r.code_number ?? 1),
    ...(r.legacy_ref ? { legacyRef: String(r.legacy_ref) } : {}),
  };
}

function mapInventoryRow(r: Record<string, unknown>): InventoryItemRecord {
  const sp = r.selling_price === null || r.selling_price === undefined ? undefined : Number(r.selling_price);
  const mt = r.min_threshold === null || r.min_threshold === undefined ? undefined : Number(r.min_threshold);
  const c2 = r.count2 === null || r.count2 === undefined ? undefined : Number(r.count2);
  const sp2 = r.sprice2 === null || r.sprice2 === undefined ? undefined : Number(r.sprice2);
  const c3 = r.count3 === null || r.count3 === undefined ? undefined : Number(r.count3);
  const sp3 = r.sprice3 === null || r.sprice3 === undefined ? undefined : Number(r.sprice3);
  return {
    id: String(r.id),
    ownerId: String(r.workspace_id),
    name: String(r.name),
    unit: String(r.unit ?? "حبة"),
    quantity: Number(r.quantity ?? 0),
    avgCost: Number(r.avg_cost ?? 0),
    ...(sp !== undefined && Number.isFinite(sp) && sp > 0 ? { sellingPrice: sp } : {}),
    ...(mt !== undefined && Number.isFinite(mt) ? { minThreshold: mt } : {}),
    ...(r.sku ? { sku: String(r.sku) } : {}),
    ...(r.unit2 ? { unit2: String(r.unit2) } : {}),
    ...(c2 !== undefined && Number.isFinite(c2) && c2 > 0 ? { count2: c2 } : {}),
    ...(sp2 !== undefined && Number.isFinite(sp2) && sp2 > 0 ? { sprice2: sp2 } : {}),
    ...(r.unit3 ? { unit3: String(r.unit3) } : {}),
    ...(c3 !== undefined && Number.isFinite(c3) && c3 > 0 ? { count3: c3 } : {}),
    ...(sp3 !== undefined && Number.isFinite(sp3) && sp3 > 0 ? { sprice3: sp3 } : {}),
    ...(r.default_unit !== undefined && r.default_unit !== null ? { defaultUnit: Number(r.default_unit) } : {}),
    ...(r.legacy_id !== undefined && r.legacy_id !== null ? { legacyId: Number(r.legacy_id) } : {}),
    warehouseId: String(r.warehouse_id),
    ...(r.computed_quantity !== undefined ? { computedQuantity: Number(r.computed_quantity) } : {}),
    ...(r.quantity_unverified ? { quantityUnverified: true } : {}),
    ...(r.legacy_ref ? { legacyRef: String(r.legacy_ref) } : {}),
  };
}

export function mapLedgerRow(r: Record<string, unknown>): LedgerEntryRecord {
  return {
    id: String(r.id),
    ownerId: String(r.workspace_id),
    accountId: String(r.account_id),
    accountName: String(r.account_name),
    counterpartAccountId: String(r.counterpart_account_id ?? ""),
    counterpartAccountName: String(r.counterpart_account_name ?? ""),
    ...(r.cashbox_id !== null && r.cashbox_id !== undefined ? { cashboxId: Number(r.cashbox_id) } : {}),
    kind: String(r.kind) as LedgerEntryRecord["kind"],
    typeLabel: String(r.type_label),
    payment: String(r.payment) as LedgerEntryRecord["payment"],
    direction: r.direction === "credit" ? "credit" : "debit",
    amount: Number(r.amount ?? 0),
    ...(r.raw_dain !== null && r.raw_dain !== undefined ? { rawDain: Number(r.raw_dain) } : {}),
    ...(r.raw_madin !== null && r.raw_madin !== undefined ? { rawMadin: Number(r.raw_madin) } : {}),
    ...(r.settled_on_receipt ? { settledOnReceipt: true } : {}),
    currency: String(r.currency ?? "ريال") as LedgerEntryRecord["currency"],
    exchangeRate: Number(r.exchange_rate ?? 1),
    details: String(r.details ?? ""),
    documentNumber: String(r.document_number ?? ""),
    warehouseId: String(r.warehouse_id ?? ""),
    warehouseName: String(r.warehouse_name ?? ""),
    invoiceContent: (r.invoice_content === "items" || r.invoice_content === "free" ? r.invoice_content : "none"),
    entryNumber: Number(r.entry_number ?? 1),
    deleted: Boolean(r.deleted),
    entryDate: String(r.entry_date ?? ""),
    ...(r.due_date ? { dueDate: String(r.due_date) } : {}),
    ...(r.expense_category ? { expenseCategory: String(r.expense_category) } : {}),
    ...(r.delivery_days !== null && r.delivery_days !== undefined ? { deliveryDays: Number(r.delivery_days) } : {}),
    ...(r.source_origin ? { sourceOrigin: String(r.source_origin) as LedgerEntryRecord["sourceOrigin"] } : {}),
    ...(r.line_count !== undefined && Number(r.line_count) > 0 ? { lineCount: Number(r.line_count) } : {}),
    createdAtMs: Number(r.created_at_ms ?? Date.now()),
    ...(r.legacy_ref ? { legacyRef: String(r.legacy_ref) } : {}),
  };
}

export function getDbStats(db: DatabaseSync, workspaceId: string) {
  const filePath = cachedDbPath || resolveSqliteDbPath();
  let fileSizeBytes = 0;
  if (filePath !== ":memory:" && fs.existsSync(filePath)) {
    fileSizeBytes = fs.statSync(filePath).size;
  }
  const accountsCount = Number((db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE workspace_id = ?").get(workspaceId) as { c: number }).c);
  const ledgerCount = Number((db.prepare("SELECT COUNT(*) AS c FROM ledger_entries WHERE workspace_id = ?").get(workspaceId) as { c: number }).c);
  const invoiceLinesCount = Number((db.prepare("SELECT COUNT(*) AS c FROM invoice_lines WHERE workspace_id = ?").get(workspaceId) as { c: number }).c);
  const warehousesCount = Number((db.prepare("SELECT COUNT(*) AS c FROM warehouses WHERE workspace_id = ?").get(workspaceId) as { c: number }).c);
  const inventoryCount = Number((db.prepare("SELECT COUNT(*) AS c FROM inventory_items WHERE workspace_id = ?").get(workspaceId) as { c: number }).c);
  const archivedCount = Number((db.prepare("SELECT COUNT(*) AS c FROM archived_documents WHERE workspace_id = ?").get(workspaceId) as { c: number }).c);
  const transfersCount = Number((db.prepare("SELECT COUNT(*) AS c FROM stock_transfers WHERE workspace_id = ?").get(workspaceId) as { c: number }).c);
  const offersCount = Number((db.prepare("SELECT COUNT(*) AS c FROM price_offers WHERE workspace_id = ?").get(workspaceId) as { c: number }).c);
  const imports = db.prepare("SELECT id, source_name, source_format, source_sha256, tables_count, total_rows, imported_at, notes_json FROM legacy_imports WHERE workspace_id = ? ORDER BY imported_at DESC").all(workspaceId) as Record<string, unknown>[];

  return {
    engine: "SQLite (node:sqlite WAL)",
    dbName: filePath === ":memory:" ? ":memory:" : path.relative(process.cwd(), filePath).replace(/\\/g, "/"),
    schemaVersion: SQLITE_SCHEMA_V2,
    tablesCount: UNIFIED_SQLITE_TABLES.length,
    fileSizeBytes,
    accountsCount,
    ledgerCount,
    invoiceLinesCount,
    warehousesCount,
    inventoryCount,
    archivedCount,
    transfersCount,
    offersCount,
    erpModulesSaved: true,
    lastSyncedAt: new Date().toISOString(),
    imports: imports.map((imp) => ({
      id: String(imp.id),
      sourceName: String(imp.source_name),
      sourceFormat: String(imp.source_format),
      sourceSha256: String(imp.source_sha256),
      tablesCount: Number(imp.tables_count ?? 0),
      totalRows: Number(imp.total_rows ?? 0),
      importedAt: String(imp.imported_at),
      notes: JSON.parse(String(imp.notes_json ?? "{}")),
    })),
  };
}

export function getFullWorkspaceBundle(db: DatabaseSync, workspaceId: string) {
  ensureEmptyWorkspace(db, workspaceId);
  const wsRow = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as Record<string, unknown>;
  const groupRows = db
    .prepare(
      `SELECT id, name, category, currency_code, has_bill, is_employee, sort_order, legacy_id
       FROM account_groups
       WHERE workspace_id = ?
       ORDER BY COALESCE(legacy_id, sort_order, id) ASC`,
    )
    .all(workspaceId) as Record<string, unknown>[];
  const accountRows = db
    .prepare("SELECT * FROM accounts WHERE workspace_id = ? ORDER BY sort_order ASC, code_number ASC")
    .all(workspaceId) as Record<string, unknown>[];
  const warehouseRows = db
    .prepare("SELECT * FROM warehouses WHERE workspace_id = ? ORDER BY code_number ASC")
    .all(workspaceId) as Record<string, unknown>[];
  const inventoryRows = db
    .prepare("SELECT * FROM inventory_items WHERE workspace_id = ? ORDER BY name ASC")
    .all(workspaceId) as Record<string, unknown>[];
  const computedQtyByItem = new Map<string, number>();
  for (const row of db
    .prepare(
      `SELECT il.inventory_item_id AS item_id,
              SUM(CASE
                WHEN le.doc_type IN (3, 9, 4) OR (le.doc_type IS NULL AND ((le.kind = 'invoice' AND le.direction = 'credit') OR (le.kind = 'return' AND le.direction = 'credit')))
                  THEN (il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                WHEN le.doc_type IN (2, 7, 5) OR (le.doc_type IS NULL AND ((le.kind = 'invoice' AND le.direction = 'debit') OR (le.kind = 'return' AND le.direction = 'debit')))
                  THEN -(il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                ELSE 0
              END) AS net_qty
       FROM invoice_lines il
       JOIN ledger_entries le ON le.id = il.entry_id
       LEFT JOIN inventory_items ii ON ii.id = il.inventory_item_id
       WHERE le.workspace_id = ? AND le.deleted = 0 AND il.inventory_item_id IS NOT NULL AND il.line_kind = 'item'
       GROUP BY il.inventory_item_id`,
    )
    .all(workspaceId) as { item_id: string; net_qty: number }[]) {
    computedQtyByItem.set(row.item_id, Number(row.net_qty ?? 0));
  }
  const lineCountByEntry = new Map<string, number>();
  for (const row of db.prepare("SELECT entry_id, COUNT(*) AS cnt FROM invoice_lines WHERE workspace_id = ? GROUP BY entry_id").all(workspaceId) as { entry_id: string; cnt: number }[]) {
    lineCountByEntry.set(row.entry_id, Number(row.cnt));
  }
  const ledgerRows = db
    .prepare("SELECT * FROM ledger_entries WHERE workspace_id = ? ORDER BY created_at_ms ASC, entry_number ASC")
    .all(workspaceId) as Record<string, unknown>[];
  const cashboxRows = db
    .prepare("SELECT id, name, details, currency_code, legacy_id FROM cashboxes WHERE workspace_id = ? AND state = 1 ORDER BY sort_order ASC, id ASC")
    .all(workspaceId) as Record<string, unknown>[];
  const backupRows = db
    .prepare("SELECT id, name, exported_at_iso FROM backups WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as Record<string, unknown>[];

  const accountGroups: AccountGroupRecord[] = groupRows.map((g) => ({
    id: Number(g.id),
    name: String(g.name ?? ""),
    category: String(g.category ?? "shop") as AccountCategory,
    currencyCode: String(g.currency_code ?? "ريال") as CurrencyCode,
    hasBill: Boolean(g.has_bill),
    isEmployee: Boolean(g.is_employee),
    sortOrder: Number(g.sort_order ?? 0),
    ...(g.legacy_id !== null && g.legacy_id !== undefined ? { legacyId: Number(g.legacy_id) } : {}),
  }));

  const cashboxes: CashboxRecord[] = cashboxRows.map((c) => ({
    id: Number(c.id),
    name: String(c.name ?? ""),
    details: String(c.details ?? ""),
    currencyCode: String(c.currency_code ?? "ريال") as CurrencyCode,
    ...(c.legacy_id !== null && c.legacy_id !== undefined ? { legacyId: Number(c.legacy_id) } : {}),
  }));

  return {
    workspace: mapWorkspaceRow(wsRow),
    accountGroups,
    accounts: accountRows.map(mapAccountRow),
    cashboxes,
    warehouses: warehouseRows.map(mapWarehouseRow),
    inventory: inventoryRows.map((r) =>
      mapInventoryRow({
        ...r,
        ...(r.quantity_unverified && computedQtyByItem.has(String(r.id))
          ? { computed_quantity: computedQtyByItem.get(String(r.id)) }
          : {}),
      }),
    ),
    ledger: ledgerRows.map((r) => mapLedgerRow({ ...r, line_count: lineCountByEntry.get(String(r.id)) ?? 0 })),
    erpData: loadErpDataRows(db, workspaceId),
    backups: backupRows.map((b) => ({
      id: String(b.id),
      name: String(b.name),
      exportedAtIso: String(b.exported_at_iso),
    })),
    stats: getDbStats(db, workspaceId),
  };
}

export function saveWorkspaceSettingsRow(
  db: DatabaseSync,
  workspaceId: string,
  updates: Partial<WorkspaceSettings>,
): WorkspaceSettings {
  ensureEmptyWorkspace(db, workspaceId);
  const current = mapWorkspaceRow(db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as Record<string, unknown>);
  const clean = sanitizeWorkspacePayload({ ...current, ...updates, ownerId: workspaceId });
  const now = nowIso();
  db.prepare(
    `UPDATE workspaces
     SET company_name = ?, default_currency = ?, whatsapp_provider = ?, whatsapp_instant_enabled = ?, whatsapp_phone = ?, updated_at = ?
     WHERE id = ?`,
  ).run(clean.companyName, clean.defaultCurrency, clean.whatsappProvider, clean.whatsappInstantEnabled ? 1 : 0, clean.whatsappPhone, now, workspaceId);
  writeAudit(db, workspaceId, workspaceId, "workspaces", workspaceId, "update", clean);
  return {
    id: workspaceId,
    ownerId: workspaceId,
    companyName: clean.companyName,
    defaultCurrency: clean.defaultCurrency,
    whatsappProvider: clean.whatsappProvider,
    whatsappInstantEnabled: clean.whatsappInstantEnabled,
    whatsappPhone: clean.whatsappPhone,
  };
}

export function upsertAccountRow(
  db: DatabaseSync,
  workspaceId: string,
  input: Partial<AccountRecord> & { name: string },
  existingId?: string,
): AccountRecord {
  ensureEmptyWorkspace(db, workspaceId);
  const id = existingId || makeId("acc");
  const clean = sanitizeAccountPayload({ ...input, ownerId: workspaceId });
  const now = nowIso();
  const existing = existingId
    ? (db.prepare("SELECT code_number, group_id FROM accounts WHERE workspace_id = ? AND id = ?").get(workspaceId, id) as { code_number: number; group_id: number | null } | undefined)
    : undefined;

  let resolvedGroupId: number | null =
    typeof input.groupId === "number" && Number.isFinite(input.groupId) ? input.groupId : (existing?.group_id ?? null);
  if (!resolvedGroupId) {
    const grp = db
      .prepare("SELECT id FROM account_groups WHERE workspace_id = ? AND category = ? ORDER BY COALESCE(legacy_id, id) ASC LIMIT 1")
      .get(workspaceId, clean.category) as { id: number } | undefined;
    if (grp) resolvedGroupId = grp.id;
  }

  if (existing) {
    db.prepare(
      `UPDATE accounts
       SET name = ?, group_id = ?, category = ?, phone = ?, credit_limit = ?, currency = ?, is_cash_account = ?, account_image = ?,
           sort_order = ?, settlement = ?, document_number_required = ?, message_method = ?, send_mode = ?,
           note = ?, opening_balance = ?, opening_direction = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ?`,
    ).run(
      clean.name, resolvedGroupId, clean.category, clean.phone, clean.creditLimit, clean.currency, clean.isCashAccount ? 1 : 0,
      clean.accountImage, clean.sortOrder, clean.settlement ? 1 : 0, clean.documentNumberRequired ? 1 : 0,
      clean.messageMethod, clean.sendMode, clean.note, clean.openingBalance, clean.openingDirection, now, workspaceId, id,
    );
    writeAudit(db, workspaceId, workspaceId, "accounts", id, "update", { name: clean.name });
  } else {
    db.prepare(
      `INSERT INTO accounts (id, workspace_id, group_id, code_number, name, category, phone, credit_limit, currency, is_cash_account, account_image, sort_order, settlement, document_number_required, message_method, send_mode, note, opening_balance, opening_direction, legacy_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, workspaceId, resolvedGroupId, clean.codeNumber, clean.name, clean.category, clean.phone, clean.creditLimit, clean.currency,
      clean.isCashAccount ? 1 : 0, clean.accountImage, clean.sortOrder, clean.settlement ? 1 : 0,
      clean.documentNumberRequired ? 1 : 0, clean.messageMethod, clean.sendMode, clean.note, clean.openingBalance,
      clean.openingDirection, clean.legacyRef ?? null, now, now,
    );
    writeAudit(db, workspaceId, workspaceId, "accounts", id, "insert", { name: clean.name });
  }
  const row = db.prepare("SELECT * FROM accounts WHERE workspace_id = ? AND id = ?").get(workspaceId, id) as Record<string, unknown>;
  return mapAccountRow(row);
}

export function upsertAccountGroupRow(
  db: DatabaseSync,
  workspaceId: string,
  input: { id?: number; name: string; category?: AccountCategory; currencyCode?: CurrencyCode; sortOrder?: number },
): AccountGroupRecord {
  ensureEmptyWorkspace(db, workspaceId);
  const name = String(input.name || "").trim().slice(0, 80);
  if (!name) throw new Error("اسم الصندوق / المجموعة مطلوب.");
  const category = (input.category || "shop") as AccountCategory;
  const currencyCode = (input.currencyCode || "ريال") as CurrencyCode;
  const sortOrder = Number(input.sortOrder ?? 0) || 0;

  let rowId = input.id;
  if (rowId) {
    db.prepare(
      `UPDATE account_groups SET name = ?, category = ?, currency_code = ?, sort_order = ?
       WHERE workspace_id = ? AND id = ?`,
    ).run(name, category, currencyCode, sortOrder, workspaceId, rowId);
    writeAudit(db, workspaceId, workspaceId, "account_groups", String(rowId), "update", { name });
  } else {
    const maxLegacy = Number(
      ((db.prepare("SELECT COALESCE(MAX(legacy_id), 12) AS m FROM account_groups WHERE workspace_id = ?").get(workspaceId) as { m: number })?.m ?? 12),
    );
    const res = db
      .prepare(
        `INSERT INTO account_groups (workspace_id, name, category, currency_code, sort_order, legacy_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(workspaceId, name, category, currencyCode, sortOrder || maxLegacy + 1, maxLegacy + 1);
    rowId = Number(res.lastInsertRowid);
    writeAudit(db, workspaceId, workspaceId, "account_groups", String(rowId), "insert", { name });
  }
  const g = db.prepare("SELECT * FROM account_groups WHERE workspace_id = ? AND id = ?").get(workspaceId, rowId) as Record<string, unknown>;
  return {
    id: Number(g.id),
    name: String(g.name),
    category: String(g.category) as AccountCategory,
    currencyCode: String(g.currency_code) as CurrencyCode,
    hasBill: Boolean(g.has_bill),
    isEmployee: Boolean(g.is_employee),
    sortOrder: Number(g.sort_order ?? 0),
    ...(g.legacy_id !== null && g.legacy_id !== undefined ? { legacyId: Number(g.legacy_id) } : {}),
  };
}

function inferDocTypeForLedger(
  kind: LedgerEntryRecord["kind"],
  direction: LedgerEntryRecord["direction"],
  invoiceContent: LedgerEntryRecord["invoiceContent"],
  existingDocType?: number | null,
): number | null {
  if (kind === "voucher") return 1;
  if (kind === "invoice") {
    if (invoiceContent === "free") return direction === "credit" ? 9 : 7;
    return direction === "credit" ? 3 : 2;
  }
  if (kind === "return") return direction === "credit" ? 4 : 5;
  return typeof existingDocType === "number" ? existingDocType : null;
}

function stockSignForEntry(
  kind: string,
  direction: string,
  docType?: number | null,
): -1 | 0 | 1 {
  if (docType === 3 || docType === 9 || docType === 4) return 1;
  if (docType === 2 || docType === 7 || docType === 5) return -1;
  if (kind === "invoice") return direction === "credit" ? 1 : -1;
  if (kind === "return") return direction === "credit" ? 1 : -1;
  return 0;
}

function unitMultiplierForItem(
  unitNum: number | null | undefined,
  count2: number | null | undefined,
  count3: number | null | undefined,
): number {
  const n = Number(unitNum ?? 1);
  const c2 = Number(count2 ?? 0);
  const c3 = Number(count3 ?? 0);
  if (n === 2) return c2 > 0 ? c2 : 1;
  if (n === 3) return (c2 > 0 ? c2 : 1) * (c3 > 0 ? c3 : 1);
  return 1;
}

function applyEntryLinesStockDelta(
  db: DatabaseSync,
  workspaceId: string,
  entryId: string,
  signFactor: number,
  now: string,
): void {
  if (!signFactor) return;
  const lineRows = db
    .prepare(
      `SELECT il.inventory_item_id, il.quantity, il.bonus, il.unit_num,
              ii.quantity AS item_qty, ii.quantity_unverified, ii.count2, ii.count3
       FROM invoice_lines il
       JOIN inventory_items ii ON ii.id = il.inventory_item_id AND ii.workspace_id = il.workspace_id
       WHERE il.workspace_id = ? AND il.entry_id = ? AND il.line_kind = 'item' AND il.inventory_item_id IS NOT NULL`,
    )
    .all(workspaceId, entryId) as Array<{
      inventory_item_id: string;
      quantity: number;
      bonus: number | null;
      unit_num: number | null;
      item_qty: number;
      quantity_unverified: number;
      count2: number | null;
      count3: number | null;
    }>;
  if (lineRows.length === 0) return;

  const deltaByItem = new Map<string, { curQty: number; delta: number; unverified: boolean }>();
  for (const r of lineRows) {
    const mult = unitMultiplierForItem(r.unit_num, r.count2, r.count3);
    const baseUnits = Number(r.quantity ?? 0) * mult + Number(r.bonus ?? 0);
    const existing = deltaByItem.get(r.inventory_item_id);
    if (existing) {
      existing.delta += signFactor * baseUnits;
    } else {
      deltaByItem.set(r.inventory_item_id, {
        curQty: Number(r.item_qty ?? 0),
        delta: signFactor * baseUnits,
        unverified: Boolean(r.quantity_unverified),
      });
    }
  }

  const upd = db.prepare("UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE workspace_id = ? AND id = ?");
  for (const [itemId, info] of deltaByItem.entries()) {
    if (info.unverified) continue;
    // Preserve exact signed arithmetic (never clamp to 0) so reversing/deleting an oversold bill restores true stock.
    const nextQty = Math.round((info.curQty + info.delta) * 10000) / 10000;
    upd.run(nextQty, now, workspaceId, itemId);
  }
}

type NormalizedInvoiceLine = {
  inventoryItemId?: string;
  warehouseId?: string;
  itemName: string;
  price: number;
  quantity: number;
  discount: number;
  bonus: number;
  total: number;
  unit: string;
  unitNum: 1 | 2 | 3;
  details: string;
};

function normalizeAndReconcileInvoiceLines(
  rawLines: readonly InvoiceLineInput[] | undefined,
  headerInput: {
    amount?: number;
    taxAmount?: number;
    discount?: number;
  },
): { lines: NormalizedInvoiceLine[]; linesTotal: number; expectedAmount: number | null } {
  const round2 = (v: number) => Math.round(v * 100) / 100;
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { lines: [], linesTotal: 0, expectedAmount: null };
  }

  const nonEmpty = rawLines.filter(
    (line) =>
      line &&
      (String(line.itemName || "").trim().length > 0 ||
        Boolean(line.inventoryItemId) ||
        Number(line.quantity || 0) !== 0 ||
        Number(line.price || 0) !== 0),
  );
  if (nonEmpty.length === 0) {
    return { lines: [], linesTotal: 0, expectedAmount: null };
  }

  const lines: NormalizedInvoiceLine[] = [];
  let linesTotal = 0;
  for (const line of nonEmpty) {
    const itemName = String(line.itemName || "").trim().slice(0, 140);
    const qty = Number(line.quantity);
    const price = Number(line.price);
    const discount = line.discount === undefined || line.discount === null ? 0 : Number(line.discount);
    const bonus = line.bonus === undefined || line.bonus === null ? 0 : Number(line.bonus);

    if (!itemName) {
      throw new SqliteValidationError("اسم الصنف مطلوب في كل سطر من سطور الفاتورة.");
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new SqliteValidationError(`كمية الصنف "${itemName}" يجب أن تكون أكبر من صفر.`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new SqliteValidationError(`سعر الصنف "${itemName}" لا يمكن أن يكون سالبًا.`);
    }
    if (!Number.isFinite(discount) || discount < 0 || !Number.isFinite(bonus) || bonus < 0) {
      throw new SqliteValidationError(`الخصم أو البونص للصنف "${itemName}" غير صالح.`);
    }
    const gross = qty * price;
    if (discount > gross + 0.01) {
      throw new SqliteValidationError(`خصم السطر للصنف "${itemName}" يتجاوز قيمته الإجمالية.`);
    }
    const total = round2(Math.max(0, gross - discount));
    const unitNumRaw = Number(line.unitNum ?? 1);
    const unitNum: 1 | 2 | 3 = unitNumRaw === 2 || unitNumRaw === 3 ? unitNumRaw : 1;

    lines.push({
      ...(line.inventoryItemId ? { inventoryItemId: line.inventoryItemId } : {}),
      ...(line.warehouseId ? { warehouseId: line.warehouseId } : {}),
      itemName,
      price: Math.round(price * 10000) / 10000,
      quantity: Math.round(qty * 10000) / 10000,
      discount: round2(discount),
      bonus: Math.round(bonus * 10000) / 10000,
      total,
      unit: String(line.unit || "حبة").trim().slice(0, 32) || "حبة",
      unitNum,
      details: String(line.details ?? "").trim().slice(0, 300),
    });
    linesTotal = round2(linesTotal + total);
  }

  const taxAmount = Number.isFinite(Number(headerInput.taxAmount))
    ? Math.max(0, round2(Number(headerInput.taxAmount)))
    : 0;
  const headerDiscount = Number.isFinite(Number(headerInput.discount))
    ? Math.max(0, round2(Number(headerInput.discount)))
    : 0;
  const expectedAmount = round2(Math.max(0, linesTotal + taxAmount - headerDiscount));

  if (
    headerInput.amount !== undefined &&
    headerInput.amount !== null &&
    Number.isFinite(Number(headerInput.amount))
  ) {
    const provided = round2(Math.max(0, Number(headerInput.amount)));
    if (Math.abs(provided - expectedAmount) > 0.02) {
      throw new SqliteValidationError(
        `إجمالي الفاتورة (${provided}) لا يطابق مجموع السطور المحسوب (${expectedAmount}).`,
      );
    }
  }

  return { lines, linesTotal, expectedAmount };
}

function insertInvoiceLinesForEntry(
  db: DatabaseSync,
  workspaceId: string,
  entryId: string,
  defaultWarehouseId: string,
  lines: readonly NormalizedInvoiceLine[],
): void {
  if (lines.length === 0) return;
  const insLine = db.prepare(
    `INSERT INTO invoice_lines (
       workspace_id, entry_id, line_kind, inventory_item_id, warehouse_id, item_name,
       price, quantity, total, discount, bonus, unit, unit_num, details
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const findItem = db.prepare("SELECT id FROM inventory_items WHERE workspace_id = ? AND id = ?");
  const findWh = db.prepare("SELECT id FROM warehouses WHERE workspace_id = ? AND id = ?");

  for (const line of lines) {
    const matchedItem = line.inventoryItemId
      ? (findItem.get(workspaceId, line.inventoryItemId) as { id: string } | undefined)
      : undefined;
    const lineWhIdRaw = line.warehouseId || defaultWarehouseId;
    const matchedWh = lineWhIdRaw
      ? (findWh.get(workspaceId, lineWhIdRaw) as { id: string } | undefined)
      : undefined;

    insLine.run(
      workspaceId,
      entryId,
      matchedItem ? "item" : "free",
      matchedItem?.id ?? null,
      matchedWh?.id ?? null,
      line.itemName,
      line.price,
      line.quantity,
      line.total,
      line.discount,
      line.bonus,
      line.unit,
      line.unitNum,
      line.details,
    );
  }
}

export function listWorkspaceInventoryRows(db: DatabaseSync, workspaceId: string): InventoryItemRecord[] {
  const inventoryRows = db
    .prepare("SELECT * FROM inventory_items WHERE workspace_id = ? ORDER BY name ASC")
    .all(workspaceId) as Record<string, unknown>[];
  const computedQtyByItem = new Map<string, number>();
  for (const row of db
    .prepare(
      `SELECT il.inventory_item_id AS item_id,
              SUM(CASE
                WHEN le.doc_type IN (3, 9, 4) OR (le.doc_type IS NULL AND ((le.kind = 'invoice' AND le.direction = 'credit') OR (le.kind = 'return' AND le.direction = 'credit')))
                  THEN (il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                WHEN le.doc_type IN (2, 7, 5) OR (le.doc_type IS NULL AND ((le.kind = 'invoice' AND le.direction = 'debit') OR (le.kind = 'return' AND le.direction = 'debit')))
                  THEN -(il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                ELSE 0
              END) AS net_qty
       FROM invoice_lines il
       JOIN ledger_entries le ON le.id = il.entry_id
       LEFT JOIN inventory_items ii ON ii.id = il.inventory_item_id
       WHERE le.workspace_id = ? AND le.deleted = 0 AND il.inventory_item_id IS NOT NULL AND il.line_kind = 'item'
       GROUP BY il.inventory_item_id`,
    )
    .all(workspaceId) as { item_id: string; net_qty: number }[]) {
    computedQtyByItem.set(row.item_id, Number(row.net_qty ?? 0));
  }
  return inventoryRows.map((r) =>
    mapInventoryRow({
      ...r,
      ...(r.quantity_unverified && computedQtyByItem.has(String(r.id))
        ? { computed_quantity: computedQtyByItem.get(String(r.id)) }
        : {}),
    }),
  );
}

export function insertLedgerEntryRow(
  db: DatabaseSync,
  workspaceId: string,
  input: Partial<LedgerEntryRecord> & { accountId: string; accountName: string; lines?: InvoiceLineInput[] },
): LedgerEntryRecord {
  ensureEmptyWorkspace(db, workspaceId);
  const explicitId = input.id && !input.id.includes("/") ? String(input.id).trim() : "";
  if (explicitId) {
    const existingRow = db
      .prepare("SELECT * FROM ledger_entries WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, explicitId) as Record<string, unknown> | undefined;
    if (existingRow) {
      const cntRow = db
        .prepare("SELECT COUNT(*) AS cnt FROM invoice_lines WHERE workspace_id = ? AND entry_id = ?")
        .get(workspaceId, explicitId) as { cnt: number } | undefined;
      return mapLedgerRow({ ...existingRow, line_count: Number(cntRow?.cnt ?? 0) });
    }
  }
  const id = explicitId || makeId("ent");
  const clean = sanitizeLedgerPayload({ ...input, ownerId: workspaceId });
  const createdAtMs = Date.now();
  const accRow = db
    .prepare("SELECT id, is_cash_account FROM accounts WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, clean.accountId) as { id: string; is_cash_account: number } | undefined;
  if (!accRow) {
    throw new Error("الحساب المرتبط بالقيد غير موجود في قاعدة البيانات.");
  }

  let cashboxId: number | null = null;
  if (typeof input.cashboxId === "number" && Number.isFinite(input.cashboxId)) {
    const cb = db
      .prepare("SELECT id FROM cashboxes WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, input.cashboxId) as { id: number } | undefined;
    if (cb) cashboxId = cb.id;
  }

  const { lines, expectedAmount } = normalizeAndReconcileInvoiceLines(input.lines, {
    amount: input.amount !== undefined ? clean.amount : undefined,
    taxAmount: input.taxAmount,
    discount: input.discount,
  });
  const finalAmount = expectedAmount !== null ? expectedAmount : clean.amount;

  const settled =
    Boolean(input.settledOnReceipt) ||
    Boolean(accRow.is_cash_account && clean.payment === "cash");
  const rawDain = settled ? finalAmount : clean.direction === "debit" ? finalAmount : 0;
  const rawMadin = settled ? finalAmount : clean.direction === "credit" ? finalAmount : 0;
  const docType = inferDocTypeForLedger(clean.kind, clean.direction, clean.invoiceContent, input.docType);

  const runWrite = () => {
    db.prepare(
      `INSERT INTO ledger_entries (
         id, workspace_id, account_id, account_name, counterpart_account_id, counterpart_account_name,
         cashbox_id, kind, type_label, payment, direction, amount, raw_dain, raw_madin, settled_on_receipt,
         currency, exchange_rate, details, document_number, warehouse_id, warehouse_name, invoice_content,
         entry_number, deleted, entry_date, due_date, expense_category, delivery_days, doc_type,
         source_origin, posting_status, created_at_ms, legacy_ref
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'native', 'posted', ?, ?)`,
    ).run(
      id, workspaceId, clean.accountId, clean.accountName, clean.counterpartAccountId, clean.counterpartAccountName,
      cashboxId, clean.kind, clean.typeLabel, clean.payment, clean.direction, finalAmount, rawDain, rawMadin, settled ? 1 : 0,
      clean.currency, clean.exchangeRate, clean.details, clean.documentNumber, clean.warehouseId, clean.warehouseName,
      clean.invoiceContent, clean.entryNumber, clean.deleted ? 1 : 0, clean.entryDate, clean.dueDate ?? null,
      clean.expenseCategory ?? null, clean.deliveryDays ?? null, docType, createdAtMs, clean.legacyRef ?? null,
    );

    if (lines.length > 0) {
      insertInvoiceLinesForEntry(db, workspaceId, id, clean.warehouseId, lines);
      if (!clean.deleted) {
        const sign = stockSignForEntry(clean.kind, clean.direction, docType);
        applyEntryLinesStockDelta(db, workspaceId, id, sign, nowIso());
      }
    }

    writeAudit(db, workspaceId, workspaceId, "ledger_entries", id, "insert", {
      entryNumber: clean.entryNumber,
      amount: finalAmount,
      linesCount: lines.length,
    });
  };

  if (db.isTransaction) runWrite();
  else withTransaction(db, runWrite);

  const row = db.prepare("SELECT * FROM ledger_entries WHERE workspace_id = ? AND id = ?").get(workspaceId, id) as Record<string, unknown>;
  return mapLedgerRow({ ...row, line_count: lines.length });
}

export function updateLedgerEntryRow(
  db: DatabaseSync,
  workspaceId: string,
  entryId: string,
  input: Partial<LedgerEntryRecord> & { accountId: string; accountName: string },
): LedgerEntryRecord | null {
  const existing = db
    .prepare("SELECT * FROM ledger_entries WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, entryId) as Record<string, unknown> | undefined;
  if (!existing) return null;

  const clean = sanitizeLedgerPayload({
    ...input,
    entryNumber: input.entryNumber ?? Number(existing.entry_number ?? 1),
    ownerId: workspaceId,
  });
  const accRow = db
    .prepare("SELECT id, is_cash_account FROM accounts WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, clean.accountId) as { id: string; is_cash_account: number } | undefined;
  if (!accRow) {
    throw new Error("الحساب المرتبط بالقيد غير موجود في قاعدة البيانات.");
  }

  let cashboxId: number | null = existing.cashbox_id === null || existing.cashbox_id === undefined ? null : Number(existing.cashbox_id);
  if (input.cashboxId !== undefined) {
    if (typeof input.cashboxId === "number" && Number.isFinite(input.cashboxId)) {
      const cb = db
        .prepare("SELECT id FROM cashboxes WHERE workspace_id = ? AND id = ?")
        .get(workspaceId, input.cashboxId) as { id: number } | undefined;
      cashboxId = cb ? cb.id : null;
    } else {
      cashboxId = null;
    }
  }

  const settled =
    input.settledOnReceipt !== undefined
      ? Boolean(input.settledOnReceipt)
      : Boolean(accRow.is_cash_account && clean.payment === "cash");
  const rawDain = settled ? clean.amount : clean.direction === "debit" ? clean.amount : 0;
  const rawMadin = settled ? clean.amount : clean.direction === "credit" ? clean.amount : 0;
  const newDocType = inferDocTypeForLedger(
    clean.kind,
    clean.direction,
    clean.invoiceContent,
    input.docType ?? (existing.doc_type as number | null | undefined),
  );
  const oldSign = existing.deleted
    ? 0
    : stockSignForEntry(String(existing.kind ?? ""), String(existing.direction ?? ""), existing.doc_type as number | null | undefined);
  const newSign = existing.deleted ? 0 : stockSignForEntry(clean.kind, clean.direction, newDocType);
  const hasNewLines = Array.isArray(input.lines);
  let cleanLines: NormalizedInvoiceLine[] = [];
  let finalAmount = clean.amount;
  if (hasNewLines) {
    const normalized = normalizeAndReconcileInvoiceLines(input.lines, {
      amount: input.amount !== undefined ? clean.amount : undefined,
      taxAmount: input.taxAmount,
      discount: input.discount,
    });
    cleanLines = normalized.lines;
    if (normalized.expectedAmount !== null) {
      finalAmount = normalized.expectedAmount;
    }
  } else {
    const existingLineStats = db
      .prepare(
        `SELECT COUNT(*) AS cnt,
                COALESCE(SUM(ROUND(MAX(0, quantity * price - COALESCE(discount, 0)), 2)), 0) AS lines_sum
         FROM invoice_lines
         WHERE workspace_id = ? AND entry_id = ?`,
      )
      .get(workspaceId, entryId) as { cnt: number; lines_sum: number };
    if (Number(existingLineStats?.cnt ?? 0) > 0) {
      const round2 = (v: number) => Math.round(v * 100) / 100;
      const taxAmount = Number.isFinite(Number(input.taxAmount)) ? Math.max(0, round2(Number(input.taxAmount))) : 0;
      const headerDiscount = Number.isFinite(Number(input.discount)) ? Math.max(0, round2(Number(input.discount))) : 0;
      const expectedExisting = round2(Math.max(0, Number(existingLineStats.lines_sum ?? 0) + taxAmount - headerDiscount));
      const amountModified =
        input.amount !== undefined &&
        Math.abs(round2(clean.amount) - round2(Number(existing.amount ?? 0))) > 0.02;
      if ((existing.source_origin === "native" || amountModified) && Math.abs(round2(clean.amount) - expectedExisting) > 0.02) {
        throw new SqliteValidationError(
          `إجمالي الفاتورة (${round2(clean.amount)}) لا يطابق مجموع السطور المحسوب (${expectedExisting}).`,
        );
      }
    }
  }

  const now = nowIso();
  const finalRawDain = settled ? finalAmount : clean.direction === "debit" ? finalAmount : 0;
  const finalRawMadin = settled ? finalAmount : clean.direction === "credit" ? finalAmount : 0;

  const runUpdate = () => {
    if (hasNewLines) {
      applyEntryLinesStockDelta(db, workspaceId, entryId, -oldSign, now);
      db.prepare("DELETE FROM invoice_lines WHERE workspace_id = ? AND entry_id = ?").run(workspaceId, entryId);
    } else if (oldSign !== newSign) {
      applyEntryLinesStockDelta(db, workspaceId, entryId, newSign - oldSign, now);
    }

    db.prepare(
      `UPDATE ledger_entries
       SET account_id = ?, account_name = ?, counterpart_account_id = ?, counterpart_account_name = ?,
           cashbox_id = ?, kind = ?, type_label = ?, payment = ?, direction = ?, amount = ?,
           raw_dain = ?, raw_madin = ?, settled_on_receipt = ?, currency = ?, exchange_rate = ?,
           details = ?, document_number = ?, warehouse_id = ?, warehouse_name = ?, invoice_content = ?,
           entry_number = ?, entry_date = ?, due_date = ?, expense_category = ?, delivery_days = ?, doc_type = ?
       WHERE workspace_id = ? AND id = ?`,
    ).run(
      clean.accountId, clean.accountName, clean.counterpartAccountId, clean.counterpartAccountName,
      cashboxId, clean.kind, clean.typeLabel, clean.payment, clean.direction, finalAmount,
      finalRawDain, finalRawMadin, settled ? 1 : 0, clean.currency, clean.exchangeRate,
      clean.details, clean.documentNumber, clean.warehouseId, clean.warehouseName, clean.invoiceContent,
      clean.entryNumber, clean.entryDate, clean.dueDate ?? null, clean.expenseCategory ?? null,
      clean.deliveryDays ?? null, newDocType, workspaceId, entryId,
    );

    if (hasNewLines && cleanLines.length > 0) {
      insertInvoiceLinesForEntry(db, workspaceId, entryId, clean.warehouseId, cleanLines);
      applyEntryLinesStockDelta(db, workspaceId, entryId, newSign, now);
    }

    writeAudit(db, workspaceId, workspaceId, "ledger_entries", entryId, "update", {
      amount: finalAmount,
      linesUpdated: hasNewLines ? cleanLines.length : undefined,
    });
  };

  if (db.isTransaction) runUpdate();
  else withTransaction(db, runUpdate);

  const row = db.prepare("SELECT * FROM ledger_entries WHERE workspace_id = ? AND id = ?").get(workspaceId, entryId) as Record<string, unknown>;
  const cntRow = db
    .prepare("SELECT COUNT(*) AS cnt FROM invoice_lines WHERE workspace_id = ? AND entry_id = ?")
    .get(workspaceId, entryId) as { cnt: number } | undefined;
  return mapLedgerRow({ ...row, line_count: Number(cntRow?.cnt ?? 0) });
}

export function setLedgerDeletedRow(db: DatabaseSync, workspaceId: string, entryId: string, deleted: boolean): void {
  const existing = db
    .prepare("SELECT id, deleted, kind, direction, doc_type FROM ledger_entries WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, entryId) as
    | { id: string; deleted: number; kind: string; direction: string; doc_type: number | null }
    | undefined;
  if (!existing) return;

  const wasDeleted = Boolean(existing.deleted);
  const runToggle = () => {
    if (wasDeleted !== Boolean(deleted)) {
      const sign = stockSignForEntry(existing.kind, existing.direction, existing.doc_type);
      applyEntryLinesStockDelta(db, workspaceId, entryId, deleted ? -sign : sign, nowIso());
    }
    db.prepare("UPDATE ledger_entries SET deleted = ? WHERE workspace_id = ? AND id = ?").run(
      deleted ? 1 : 0,
      workspaceId,
      entryId,
    );
    writeAudit(db, workspaceId, workspaceId, "ledger_entries", entryId, deleted ? "soft_delete" : "restore", {});
  };

  if (db.isTransaction) runToggle();
  else withTransaction(db, runToggle);
}

export function getInventoryMovementsReport(
  db: DatabaseSync,
  workspaceId: string,
  options?: {
    warehouseId?: string;
    itemId?: string;
    fromDate?: string;
    toDate?: string;
    currency?: string;
    profitBasis?: "avg" | "cost" | "last";
  },
) {
  const warehouses = db
    .prepare("SELECT id, name FROM warehouses WHERE workspace_id = ? ORDER BY code_number ASC, name ASC")
    .all(workspaceId) as Array<{ id: string; name: string }>;
  const whNameById = new Map(warehouses.map((w) => [w.id, w.name]));

  const fromDate = options?.fromDate?.trim() || "";
  const toDate = options?.toDate?.trim() || "";
  const currency = options?.currency?.trim() || "";
  const profitBasis: "avg" | "cost" | "last" =
    options?.profitBasis === "cost" || options?.profitBasis === "last" ? options.profitBasis : "avg";

  const invWhereParts = [
    "le.workspace_id = ?",
    "le.deleted = 0",
    "il.line_kind = 'item'",
    "il.inventory_item_id IS NOT NULL",
  ];
  const invParams: (string | number)[] = [workspaceId];
  if (options?.itemId) {
    invWhereParts.push("il.inventory_item_id = ?");
    invParams.push(options.itemId);
  }
  if (fromDate) {
    invWhereParts.push("le.entry_date >= ?");
    invParams.push(fromDate);
  }
  if (toDate) {
    invWhereParts.push("le.entry_date <= ?");
    invParams.push(toDate);
  }
  if (currency && currency !== "الكل" && currency !== "جميع العملات") {
    invWhereParts.push("le.currency = ?");
    invParams.push(currency);
  }

  const invoiceWhRows = db
    .prepare(
      `SELECT il.inventory_item_id AS item_id,
              COALESCE(NULLIF(il.warehouse_id, ''), NULLIF(le.warehouse_id, ''), ii.warehouse_id) AS wh_id,
              SUM(CASE WHEN le.doc_type IN (3, 9) OR (le.doc_type IS NULL AND le.kind = 'invoice' AND le.direction = 'credit')
                THEN (il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                ELSE 0 END) AS purchases_qty,
              SUM(CASE WHEN le.doc_type IN (3, 9) OR (le.doc_type IS NULL AND le.kind = 'invoice' AND le.direction = 'credit')
                THEN il.total ELSE 0 END) AS purchases_val,
              SUM(CASE WHEN le.doc_type IN (2, 7) OR (le.doc_type IS NULL AND le.kind = 'invoice' AND le.direction = 'debit')
                THEN (il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                ELSE 0 END) AS sales_qty,
              SUM(CASE WHEN le.doc_type IN (2, 7) OR (le.doc_type IS NULL AND le.kind = 'invoice' AND le.direction = 'debit')
                THEN il.total ELSE 0 END) AS sales_val,
              SUM(CASE WHEN le.doc_type = 4 OR (le.doc_type IS NULL AND le.kind = 'return' AND le.direction = 'credit')
                THEN (il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                ELSE 0 END) AS sales_return_qty,
              SUM(CASE WHEN le.doc_type = 4 OR (le.doc_type IS NULL AND le.kind = 'return' AND le.direction = 'credit')
                THEN il.total ELSE 0 END) AS sales_return_val,
              SUM(CASE WHEN le.doc_type = 5 OR (le.doc_type IS NULL AND le.kind = 'return' AND le.direction = 'debit')
                THEN (il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                ELSE 0 END) AS purchase_return_qty,
              SUM(CASE WHEN le.doc_type = 5 OR (le.doc_type IS NULL AND le.kind = 'return' AND le.direction = 'debit')
                THEN il.total ELSE 0 END) AS purchase_return_val
       FROM invoice_lines il
       JOIN ledger_entries le ON le.id = il.entry_id
       JOIN inventory_items ii ON ii.id = il.inventory_item_id AND ii.workspace_id = il.workspace_id
       WHERE ${invWhereParts.join(" AND ")}
       GROUP BY il.inventory_item_id, wh_id`,
    )
    .all(...invParams) as Array<{
      item_id: string;
      wh_id: string;
      purchases_qty: number;
      purchases_val: number;
      sales_qty: number;
      sales_val: number;
      sales_return_qty: number;
      sales_return_val: number;
      purchase_return_qty: number;
      purchase_return_val: number;
    }>;

  const txBaseParts = ["stl.workspace_id = ?", "stl.inventory_item_id IS NOT NULL"];
  const txBaseParams: (string | number)[] = [workspaceId];
  if (options?.itemId) {
    txBaseParts.push("stl.inventory_item_id = ?");
    txBaseParams.push(options.itemId);
  }
  if (fromDate) {
    txBaseParts.push("st.transfer_date != '' AND st.transfer_date >= ?");
    txBaseParams.push(fromDate);
  }
  if (toDate) {
    txBaseParts.push("(st.transfer_date = '' OR st.transfer_date <= ?)");
    txBaseParams.push(toDate);
  }

  const transferOutRows = db
    .prepare(
      `SELECT stl.inventory_item_id AS item_id,
              st.from_warehouse_id AS wh_id,
              SUM(stl.quantity * (CASE COALESCE(stl.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END)) AS qty
       FROM stock_transfer_lines stl
       JOIN stock_transfers st ON st.id = stl.transfer_id AND st.workspace_id = stl.workspace_id
       JOIN inventory_items ii ON ii.id = stl.inventory_item_id AND ii.workspace_id = stl.workspace_id
       WHERE ${txBaseParts.join(" AND ")} AND st.from_warehouse_id IS NOT NULL
       GROUP BY stl.inventory_item_id, st.from_warehouse_id`,
    )
    .all(...txBaseParams) as Array<{ item_id: string; wh_id: string; qty: number }>;

  const transferInRows = db
    .prepare(
      `SELECT stl.inventory_item_id AS item_id,
              st.to_warehouse_id AS wh_id,
              SUM(stl.quantity * (CASE COALESCE(stl.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END)) AS qty
       FROM stock_transfer_lines stl
       JOIN stock_transfers st ON st.id = stl.transfer_id AND st.workspace_id = stl.workspace_id
       JOIN inventory_items ii ON ii.id = stl.inventory_item_id AND ii.workspace_id = stl.workspace_id
       WHERE ${txBaseParts.join(" AND ")} AND st.to_warehouse_id IS NOT NULL
       GROUP BY stl.inventory_item_id, st.to_warehouse_id`,
    )
    .all(...txBaseParams) as Array<{ item_id: string; wh_id: string; qty: number }>;

  type StockAcc = {
    inventoryItemId: string;
    warehouseId: string;
    warehouseName: string;
    purchasesQty: number;
    purchasesValue: number;
    salesQty: number;
    salesValue: number;
    salesReturnQty: number;
    salesReturnValue: number;
    purchaseReturnQty: number;
    purchaseReturnValue: number;
    transferInQty: number;
    transferOutQty: number;
    netComputedQty: number;
  };
  const stockMap = new Map<string, StockAcc>();
  const ensureAcc = (itemId: string, whId: string): StockAcc => {
    const key = `${itemId}::${whId}`;
    let acc = stockMap.get(key);
    if (!acc) {
      acc = {
        inventoryItemId: itemId,
        warehouseId: whId,
        warehouseName: whNameById.get(whId) ?? "مخزن غير معروف",
        purchasesQty: 0,
        purchasesValue: 0,
        salesQty: 0,
        salesValue: 0,
        salesReturnQty: 0,
        salesReturnValue: 0,
        purchaseReturnQty: 0,
        purchaseReturnValue: 0,
        transferInQty: 0,
        transferOutQty: 0,
        netComputedQty: 0,
      };
      stockMap.set(key, acc);
    }
    return acc;
  };

  // All-time invoice aggregates per item (for verified baseline stock offset & fallback average cost across sub-periods)
  const allTimeWhereParts = [
    "le.workspace_id = ?",
    "le.deleted = 0",
    "il.line_kind = 'item'",
    "il.inventory_item_id IS NOT NULL",
  ];
  const allTimeParams: (string | number)[] = [workspaceId];
  if (options?.itemId) {
    allTimeWhereParts.push("il.inventory_item_id = ?");
    allTimeParams.push(options.itemId);
  }
  const allTimeInvoiceNetByItem = new Map<string, number>();
  const allTimePurchaseTotals = new Map<string, { qty: number; val: number }>();
  for (const r of db
    .prepare(
      `SELECT il.inventory_item_id AS item_id,
              SUM(CASE WHEN le.doc_type IN (3, 9) OR (le.doc_type IS NULL AND le.kind = 'invoice' AND le.direction = 'credit')
                THEN (il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                ELSE 0 END) AS purchases_qty,
              SUM(CASE WHEN le.doc_type IN (3, 9) OR (le.doc_type IS NULL AND le.kind = 'invoice' AND le.direction = 'credit')
                THEN il.total ELSE 0 END) AS purchases_val,
              SUM(CASE WHEN le.doc_type IN (2, 7) OR (le.doc_type IS NULL AND le.kind = 'invoice' AND le.direction = 'debit')
                THEN (il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                ELSE 0 END) AS sales_qty,
              SUM(CASE WHEN le.doc_type = 4 OR (le.doc_type IS NULL AND le.kind = 'return' AND le.direction = 'credit')
                THEN (il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                ELSE 0 END) AS sales_return_qty,
              SUM(CASE WHEN le.doc_type = 5 OR (le.doc_type IS NULL AND le.kind = 'return' AND le.direction = 'debit')
                THEN (il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                ELSE 0 END) AS purchase_return_qty,
              SUM(CASE WHEN le.doc_type = 5 OR (le.doc_type IS NULL AND le.kind = 'return' AND le.direction = 'debit')
                THEN il.total ELSE 0 END) AS purchase_return_val
       FROM invoice_lines il
       JOIN ledger_entries le ON le.id = il.entry_id
       JOIN inventory_items ii ON ii.id = il.inventory_item_id AND ii.workspace_id = il.workspace_id
       WHERE ${allTimeWhereParts.join(" AND ")}
       GROUP BY il.inventory_item_id`,
    )
    .all(...allTimeParams) as Array<{
      item_id: string;
      purchases_qty: number;
      purchases_val: number;
      sales_qty: number;
      sales_return_qty: number;
      purchase_return_qty: number;
      purchase_return_val: number;
    }>) {
    const net =
      Number(r.purchases_qty ?? 0) +
      Number(r.sales_return_qty ?? 0) -
      Number(r.sales_qty ?? 0) -
      Number(r.purchase_return_qty ?? 0);
    allTimeInvoiceNetByItem.set(r.item_id, net);
    allTimePurchaseTotals.set(r.item_id, {
      qty: Number(r.purchases_qty ?? 0) - Number(r.purchase_return_qty ?? 0),
      val: Number(r.purchases_val ?? 0) - Number(r.purchase_return_val ?? 0),
    });
  }

  // Prior period net stock per (item, warehouse) strictly before fromDate
  const priorNetByItemWh = new Map<string, number>();
  if (fromDate) {
    const priorInvParts = [
      "le.workspace_id = ?",
      "le.deleted = 0",
      "il.line_kind = 'item'",
      "il.inventory_item_id IS NOT NULL",
      "le.entry_date < ?",
    ];
    const priorInvParams: (string | number)[] = [workspaceId, fromDate];
    if (options?.itemId) {
      priorInvParts.push("il.inventory_item_id = ?");
      priorInvParams.push(options.itemId);
    }
    if (currency && currency !== "الكل" && currency !== "جميع العملات") {
      priorInvParts.push("le.currency = ?");
      priorInvParams.push(currency);
    }
    for (const r of db
      .prepare(
        `SELECT il.inventory_item_id AS item_id,
                COALESCE(NULLIF(il.warehouse_id, ''), NULLIF(le.warehouse_id, ''), ii.warehouse_id) AS wh_id,
                SUM(CASE
                  WHEN le.doc_type IN (3, 9, 4) OR (le.doc_type IS NULL AND ((le.kind = 'invoice' AND le.direction = 'credit') OR (le.kind = 'return' AND le.direction = 'credit')))
                    THEN (il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                  WHEN le.doc_type IN (2, 7, 5) OR (le.doc_type IS NULL AND ((le.kind = 'invoice' AND le.direction = 'debit') OR (le.kind = 'return' AND le.direction = 'debit')))
                    THEN -(il.quantity * (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END) + COALESCE(il.bonus, 0))
                  ELSE 0
                END) AS net_qty
         FROM invoice_lines il
         JOIN ledger_entries le ON le.id = il.entry_id
         JOIN inventory_items ii ON ii.id = il.inventory_item_id AND ii.workspace_id = il.workspace_id
         WHERE ${priorInvParts.join(" AND ")}
         GROUP BY il.inventory_item_id, wh_id`,
      )
      .all(...priorInvParams) as Array<{ item_id: string; wh_id: string; net_qty: number }>) {
      if (!r.wh_id) continue;
      const k = `${r.item_id}::${r.wh_id}`;
      priorNetByItemWh.set(k, (priorNetByItemWh.get(k) ?? 0) + Number(r.net_qty ?? 0));
    }

    const priorTxParts = ["stl.workspace_id = ?", "stl.inventory_item_id IS NOT NULL", "(st.transfer_date = '' OR st.transfer_date < ?)"];
    const priorTxParams: (string | number)[] = [workspaceId, fromDate];
    if (options?.itemId) {
      priorTxParts.push("stl.inventory_item_id = ?");
      priorTxParams.push(options.itemId);
    }
    for (const r of db
      .prepare(
        `SELECT stl.inventory_item_id AS item_id, st.to_warehouse_id AS wh_id,
                SUM(stl.quantity * (CASE COALESCE(stl.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END)) AS qty
         FROM stock_transfer_lines stl
         JOIN stock_transfers st ON st.id = stl.transfer_id AND st.workspace_id = stl.workspace_id
         JOIN inventory_items ii ON ii.id = stl.inventory_item_id AND ii.workspace_id = stl.workspace_id
         WHERE ${priorTxParts.join(" AND ")} AND st.to_warehouse_id IS NOT NULL
         GROUP BY stl.inventory_item_id, st.to_warehouse_id`,
      )
      .all(...priorTxParams) as Array<{ item_id: string; wh_id: string; qty: number }>) {
      const k = `${r.item_id}::${r.wh_id}`;
      priorNetByItemWh.set(k, (priorNetByItemWh.get(k) ?? 0) + Number(r.qty ?? 0));
    }
    for (const r of db
      .prepare(
        `SELECT stl.inventory_item_id AS item_id, st.from_warehouse_id AS wh_id,
                SUM(stl.quantity * (CASE COALESCE(stl.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END)) AS qty
         FROM stock_transfer_lines stl
         JOIN stock_transfers st ON st.id = stl.transfer_id AND st.workspace_id = stl.workspace_id
         JOIN inventory_items ii ON ii.id = stl.inventory_item_id AND ii.workspace_id = stl.workspace_id
         WHERE ${priorTxParts.join(" AND ")} AND st.from_warehouse_id IS NOT NULL
         GROUP BY stl.inventory_item_id, st.from_warehouse_id`,
      )
      .all(...priorTxParams) as Array<{ item_id: string; wh_id: string; qty: number }>) {
      const k = `${r.item_id}::${r.wh_id}`;
      priorNetByItemWh.set(k, (priorNetByItemWh.get(k) ?? 0) - Number(r.qty ?? 0));
    }
  }

  const globalPurchaseTotals = new Map<string, { qty: number; val: number }>();
  for (const r of invoiceWhRows) {
    if (r.wh_id) {
      const acc = ensureAcc(r.item_id, r.wh_id);
      acc.purchasesQty += Number(r.purchases_qty ?? 0);
      acc.purchasesValue += Number(r.purchases_val ?? 0);
      acc.salesQty += Number(r.sales_qty ?? 0);
      acc.salesValue += Number(r.sales_val ?? 0);
      acc.salesReturnQty += Number(r.sales_return_qty ?? 0);
      acc.salesReturnValue += Number(r.sales_return_val ?? 0);
      acc.purchaseReturnQty += Number(r.purchase_return_qty ?? 0);
      acc.purchaseReturnValue += Number(r.purchase_return_val ?? 0);
    }
    const g = globalPurchaseTotals.get(r.item_id) ?? { qty: 0, val: 0 };
    g.qty += Number(r.purchases_qty ?? 0) - Number(r.purchase_return_qty ?? 0);
    g.val += Number(r.purchases_val ?? 0) - Number(r.purchase_return_val ?? 0);
    globalPurchaseTotals.set(r.item_id, g);
  }
  for (const r of transferInRows) {
    ensureAcc(r.item_id, r.wh_id).transferInQty += Number(r.qty ?? 0);
  }
  for (const r of transferOutRows) {
    ensureAcc(r.item_id, r.wh_id).transferOutQty += Number(r.qty ?? 0);
  }

  for (const acc of stockMap.values()) {
    acc.netComputedQty =
      acc.purchasesQty + acc.salesReturnQty + acc.transferInQty - acc.salesQty - acc.purchaseReturnQty - acc.transferOutQty;
  }

  const warehouseStocks = [...stockMap.values()].filter(
    (row) => !options?.warehouseId || row.warehouseId === options.warehouseId,
  );

  // Latest purchase unit price per item (used when profitBasis === 'last')
  const lastPurchasePriceByItem = new Map<string, number>();
  if (!options?.itemId || options.profitBasis === "last") {
    const lpRows = db
      .prepare(
        `SELECT il.inventory_item_id AS item_id,
                (il.price / (CASE COALESCE(il.unit_num, 1) WHEN 2 THEN COALESCE(NULLIF(ii.count2, 0), 1) WHEN 3 THEN COALESCE(NULLIF(ii.count2, 0), 1) * COALESCE(NULLIF(ii.count3, 0), 1) ELSE 1 END)) AS unit_price
         FROM invoice_lines il
         JOIN ledger_entries le ON le.id = il.entry_id
         JOIN inventory_items ii ON ii.id = il.inventory_item_id AND ii.workspace_id = il.workspace_id
         WHERE le.workspace_id = ? AND le.deleted = 0
           AND (le.doc_type IN (3, 9) OR (le.doc_type IS NULL AND le.kind = 'invoice' AND le.direction = 'credit'))
           AND il.price > 0 AND il.inventory_item_id IS NOT NULL
         ORDER BY le.entry_date DESC, le.entry_number DESC, il.id DESC`,
      )
      .all(workspaceId) as Array<{ item_id: string; unit_price: number }>;
    for (const r of lpRows) {
      if (!lastPurchasePriceByItem.has(r.item_id)) {
        lastPurchasePriceByItem.set(r.item_id, Number(r.unit_price ?? 0));
      }
    }
  }

  const catalogItems = db
    .prepare(
      `SELECT id, legacy_id, name, sku, unit, unit2, count2, avg_cost, selling_price, quantity, quantity_unverified, warehouse_id
       FROM inventory_items
       WHERE workspace_id = ?
       ORDER BY name ASC`,
    )
    .all(workspaceId) as Array<{
      id: string;
      legacy_id: number | null;
      name: string;
      sku: string | null;
      unit: string;
      unit2: string | null;
      count2: number | null;
      avg_cost: number;
      selling_price: number | null;
      quantity: number;
      quantity_unverified: number;
      warehouse_id: string;
    }>;

  const round2 = (v: number) => Math.round(v * 100) / 100;
  let totalSales = 0;
  let totalPurchases = 0;
  let totalProfit = 0;
  let totalRemainingValue = 0;
  let activeItemsCount = 0;

  const itemRows = catalogItems.map((ci) => {
    let grossBuyQty = 0;
    let grossBuyVal = 0;
    let grossSellQty = 0;
    let grossSellVal = 0;
    let srQty = 0;
    let srVal = 0;
    let prQty = 0;
    let prVal = 0;
    let txIn = 0;
    let txOut = 0;

    if (options?.warehouseId) {
      const acc = stockMap.get(`${ci.id}::${options.warehouseId}`);
      if (acc) {
        grossBuyQty = acc.purchasesQty;
        grossBuyVal = acc.purchasesValue;
        grossSellQty = acc.salesQty;
        grossSellVal = acc.salesValue;
        srQty = acc.salesReturnQty;
        srVal = acc.salesReturnValue;
        prQty = acc.purchaseReturnQty;
        prVal = acc.purchaseReturnValue;
        txIn = acc.transferInQty;
        txOut = acc.transferOutQty;
      }
    } else {
      for (const acc of stockMap.values()) {
        if (acc.inventoryItemId !== ci.id) continue;
        grossBuyQty += acc.purchasesQty;
        grossBuyVal += acc.purchasesValue;
        grossSellQty += acc.salesQty;
        grossSellVal += acc.salesValue;
        srQty += acc.salesReturnQty;
        srVal += acc.salesReturnValue;
        prQty += acc.purchaseReturnQty;
        prVal += acc.purchaseReturnValue;
        txIn += acc.transferInQty;
        txOut += acc.transferOutQty;
      }
    }

    const buyQty = round2(grossBuyQty - prQty);
    const buyTotal = round2(grossBuyVal - prVal);
    const sellQty = round2(grossSellQty - srQty);
    const sellTotal = round2(grossSellVal - srVal);
    const transferInQty = round2(txIn);
    const transferOutQty = round2(txOut);

    const baselineOpening = ci.quantity_unverified
      ? 0
      : Number(ci.quantity ?? 0) - (allTimeInvoiceNetByItem.get(ci.id) ?? 0);
    const baselineForScope =
      !options?.warehouseId || options.warehouseId === ci.warehouse_id ? baselineOpening : 0;
    let priorMovementNet = 0;
    if (fromDate) {
      if (options?.warehouseId) {
        priorMovementNet = priorNetByItemWh.get(`${ci.id}::${options.warehouseId}`) ?? 0;
      } else {
        for (const [key, qty] of priorNetByItemWh.entries()) {
          if (key.startsWith(`${ci.id}::`)) priorMovementNet += qty;
        }
      }
    }
    const openingQty = round2(baselineForScope + priorMovementNet);
    const availableQty = round2(openingQty + buyQty + transferInQty - sellQty - transferOutQty);

    const gTot = globalPurchaseTotals.get(ci.id);
    const allTot = allTimePurchaseTotals.get(ci.id);
    const globalAvgCost =
      gTot && gTot.qty > 0
        ? gTot.val / gTot.qty
        : allTot && allTot.qty > 0
          ? allTot.val / allTot.qty
          : Number(ci.avg_cost ?? 0);
    const localAvgCost = buyQty > 0 ? buyTotal / buyQty : globalAvgCost;
    const lastPrice = lastPurchasePriceByItem.get(ci.id) ?? localAvgCost;

    const unitCostBasis =
      profitBasis === "cost"
        ? Number(ci.avg_cost ?? 0) > 0
          ? Number(ci.avg_cost)
          : localAvgCost
        : profitBasis === "last"
          ? lastPrice
          : localAvgCost;

    const remainingValue = round2(availableQty * unitCostBasis);
    const profit = round2(sellTotal - sellQty * unitCostBasis);
    const hasMovement =
      grossBuyQty !== 0 ||
      prQty !== 0 ||
      grossSellQty !== 0 ||
      srQty !== 0 ||
      transferInQty !== 0 ||
      transferOutQty !== 0;

    if (hasMovement || (!ci.quantity_unverified && openingQty !== 0)) {
      if (hasMovement) activeItemsCount += 1;
      totalSales += sellTotal;
      totalPurchases += buyTotal;
      totalProfit += profit;
      totalRemainingValue += remainingValue;
    }

    return {
      id: ci.id,
      code: ci.legacy_id ?? null,
      name: ci.name,
      sku: ci.sku || "",
      unit: ci.unit || "حبة",
      unit2: ci.unit2 || "",
      count2: ci.count2 ?? null,
      warehouseId: ci.warehouse_id,
      openingQty,
      buyQty,
      sellQty,
      transferInQty,
      transferOutQty,
      buyTotal,
      sellTotal,
      availableQty,
      unitCost: round2(unitCostBasis),
      remainingValue,
      profit,
      avgCost: Number(ci.avg_cost ?? 0),
      sellingPrice: ci.selling_price ?? undefined,
      catalogQuantity: Number(ci.quantity ?? 0),
      quantityUnverified: Boolean(ci.quantity_unverified),
      hasMovement,
    };
  });

  let movements: Array<{
    source: "invoice" | "transfer";
    refId: string;
    entryNumber?: number;
    date: string;
    label: string;
    accountName: string;
    warehouseName: string;
    quantity: number;
    unit: string;
    unitNum: number;
    baseQuantity: number;
    effectQty: number;
    price: number;
    total: number;
  }> = [];

  if (options?.itemId) {
    const invMoves = db
      .prepare(
        `SELECT le.id AS ref_id, le.entry_number, le.entry_date AS dt, le.type_label, le.kind, le.doc_type,
                le.direction, le.account_name, COALESCE(NULLIF(il.warehouse_id, ''), le.warehouse_id) AS wh_id,
                le.warehouse_name, il.quantity, il.unit, il.unit_num, il.bonus, il.price, il.total,
                ii.count2, ii.count3
         FROM invoice_lines il
         JOIN ledger_entries le ON le.id = il.entry_id
         LEFT JOIN inventory_items ii ON ii.id = il.inventory_item_id
         WHERE le.workspace_id = ? AND le.deleted = 0 AND il.inventory_item_id = ?
         ORDER BY le.entry_date DESC, le.entry_number DESC
         LIMIT 200`,
      )
      .all(workspaceId, options.itemId) as Array<Record<string, unknown>>;

    const txMoves = db
      .prepare(
        `SELECT st.id AS tx_id, st.transfer_date AS dt, st.transfer_type, st.from_warehouse_id, st.to_warehouse_id,
                st.raw_from_store_id, st.raw_to_store_id, st.details, stl.quantity, stl.unit, stl.unit_num,
                ii.count2, ii.count3
         FROM stock_transfer_lines stl
         JOIN stock_transfers st ON st.id = stl.transfer_id AND st.workspace_id = stl.workspace_id
         LEFT JOIN inventory_items ii ON ii.id = stl.inventory_item_id
         WHERE stl.workspace_id = ? AND stl.inventory_item_id = ?
         ORDER BY st.transfer_date DESC, st.id DESC
         LIMIT 100`,
      )
      .all(workspaceId, options.itemId) as Array<Record<string, unknown>>;

    movements = [
      ...invMoves.map((m) => {
        const mult = unitMultiplierForItem(Number(m.unit_num ?? 1), Number(m.count2 ?? 0), Number(m.count3 ?? 0));
        const baseQuantity = Number(m.quantity ?? 0) * mult + Number(m.bonus ?? 0);
        const sign = stockSignForEntry(String(m.kind ?? ""), String(m.direction ?? ""), m.doc_type as number | null);
        const whId = String(m.wh_id ?? "");
        return {
          source: "invoice" as const,
          refId: String(m.ref_id),
          entryNumber: Number(m.entry_number ?? 0),
          date: String(m.dt ?? ""),
          label: String(m.type_label ?? ""),
          accountName: String(m.account_name ?? ""),
          warehouseName: whNameById.get(whId) ?? (String(m.warehouse_name ?? "") || "—"),
          quantity: Number(m.quantity ?? 0),
          unit: String(m.unit ?? "حبة"),
          unitNum: Number(m.unit_num ?? 1),
          baseQuantity,
          effectQty: sign * baseQuantity,
          price: Number(m.price ?? 0),
          total: Number(m.total ?? 0),
        };
      }),
      ...txMoves.map((t) => {
        const mult = unitMultiplierForItem(Number(t.unit_num ?? 1), Number(t.count2 ?? 0), Number(t.count3 ?? 0));
        const baseQuantity = Number(t.quantity ?? 0) * mult;
        const fromId = t.from_warehouse_id ? String(t.from_warehouse_id) : "";
        const toId = t.to_warehouse_id ? String(t.to_warehouse_id) : "";
        const fromName = fromId ? (whNameById.get(fromId) ?? fromId) : `مخزن #${String(t.raw_from_store_id ?? "?")}`;
        const toName = toId ? (whNameById.get(toId) ?? toId) : `مخزن #${String(t.raw_to_store_id ?? "?")}`;
        return {
          source: "transfer" as const,
          refId: `tx-${String(t.tx_id)}`,
          date: String(t.dt ?? ""),
          label: Number(t.transfer_type) === 3 ? "تسوية / جرد مخزني" : "تحويل مخزني",
          accountName: `${fromName} ⟵ ${toName}`,
          warehouseName: toName,
          quantity: Number(t.quantity ?? 0),
          unit: String(t.unit ?? "حبة"),
          unitNum: Number(t.unit_num ?? 1),
          baseQuantity,
          effectQty: 0,
          price: 0,
          total: 0,
        };
      }),
    ].sort((a, b) => b.date.localeCompare(a.date));
  }

  const unresolvedTransfers = db
    .prepare(
      `SELECT st.id, st.transfer_date, st.transfer_type, st.raw_from_store_id, st.raw_to_store_id, st.details,
              (SELECT COUNT(*) FROM stock_transfer_lines stl WHERE stl.transfer_id = st.id) AS lines_count
       FROM stock_transfers st
       WHERE st.workspace_id = ? AND (st.from_warehouse_id IS NULL OR st.to_warehouse_id IS NULL)
       ORDER BY st.id ASC`,
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  const unverifiedRow = db
    .prepare("SELECT COUNT(*) AS cnt FROM inventory_items WHERE workspace_id = ? AND quantity_unverified = 1")
    .get(workspaceId) as { cnt: number } | undefined;

  const negativeComputedItems = itemRows
    .filter((row) => row.availableQty < -0.0001)
    .map((row) => ({
      id: row.id,
      name: row.name,
      netComputedQty: row.availableQty,
    }))
    .slice(0, 50);

  return {
    warehouses,
    warehouseStocks,
    itemRows,
    totals: {
      totalSales: round2(totalSales),
      totalPurchases: round2(totalPurchases),
      totalProfit: round2(totalProfit),
      totalRemainingValue: round2(totalRemainingValue),
      activeItemsCount,
      profitBasis,
    },
    movements,
    anomalies: {
      unverifiedItemsCount: Number(unverifiedRow?.cnt ?? 0),
      unresolvedTransfersCount: unresolvedTransfers.length,
      unresolvedTransfers: unresolvedTransfers.map((u) => ({
        id: Number(u.id),
        transferDate: String(u.transfer_date ?? ""),
        transferType: Number(u.transfer_type ?? 1),
        rawFromStoreId: u.raw_from_store_id === null ? null : Number(u.raw_from_store_id),
        rawToStoreId: u.raw_to_store_id === null ? null : Number(u.raw_to_store_id),
        details: String(u.details ?? ""),
        linesCount: Number(u.lines_count ?? 0),
      })),
      negativeComputedItems,
    },
  };
}

export function getCashboxesReport(db: DatabaseSync, workspaceId: string) {
  const rows = db
    .prepare(
      `SELECT cb.id, cb.name, cb.currency_code,
              COALESCE(SUM(CASE
                WHEN le.deleted = 0 AND (le.settled_on_receipt = 1 OR le.payment = 'cash') AND (le.doc_type IN (2, 7, 5) OR le.direction = 'debit')
                  THEN le.amount ELSE 0 END), 0) AS total_in,
              COALESCE(SUM(CASE
                WHEN le.deleted = 0 AND (le.settled_on_receipt = 1 OR le.payment = 'cash') AND (le.doc_type IN (3, 9, 4) OR le.direction = 'credit')
                  THEN le.amount ELSE 0 END), 0) AS total_out,
              COUNT(CASE WHEN le.deleted = 0 THEN 1 END) AS entry_count
       FROM cashboxes cb
       LEFT JOIN ledger_entries le ON le.workspace_id = cb.workspace_id AND le.cashbox_id = cb.id
       WHERE cb.workspace_id = ? AND cb.state = 1
       GROUP BY cb.id
       ORDER BY cb.sort_order ASC, cb.id ASC`,
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  return {
    cashboxes: rows.map((r) => {
      const totalIn = Number(r.total_in ?? 0);
      const totalOut = Number(r.total_out ?? 0);
      return {
        id: Number(r.id),
        name: String(r.name ?? ""),
        currencyCode: String(r.currency_code ?? "ريال"),
        totalIn,
        totalOut,
        netBalance: totalIn - totalOut,
        entryCount: Number(r.entry_count ?? 0),
      };
    }),
  };
}

export function deleteLedgerEntryRow(db: DatabaseSync, workspaceId: string, entryId: string): void {
  const existing = db
    .prepare("SELECT id, deleted, kind, direction, doc_type FROM ledger_entries WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, entryId) as
    | { id: string; deleted: number; kind: string; direction: string; doc_type: number | null }
    | undefined;
  if (!existing) return;

  const runDelete = () => {
    if (!existing.deleted) {
      const sign = stockSignForEntry(existing.kind, existing.direction, existing.doc_type);
      applyEntryLinesStockDelta(db, workspaceId, entryId, -sign, nowIso());
    }
    db.prepare("DELETE FROM ledger_entries WHERE workspace_id = ? AND id = ?").run(workspaceId, entryId);
    writeAudit(db, workspaceId, workspaceId, "ledger_entries", entryId, "delete", {});
  };
  if (db.isTransaction) runDelete();
  else withTransaction(db, runDelete);
}

export function upsertWarehouseRow(
  db: DatabaseSync,
  workspaceId: string,
  warehouse: Partial<WarehouseRecord> & { name: string },
  existingId?: string,
): WarehouseRecord {
  ensureEmptyWorkspace(db, workspaceId);
  const id = existingId || makeId("wh");
  const clean = sanitizeWarehousePayload({ ...warehouse, ownerId: workspaceId });
  const now = nowIso();
  return withTransaction(db, () => {
    if (clean.isDefault) {
      db.prepare("UPDATE warehouses SET is_default = 0, updated_at = ? WHERE workspace_id = ?").run(now, workspaceId);
    }
    const existing = db.prepare("SELECT id FROM warehouses WHERE workspace_id = ? AND id = ?").get(workspaceId, id);
    if (existing) {
      db.prepare(
        "UPDATE warehouses SET name = ?, details = ?, is_default = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
      ).run(clean.name, clean.details, clean.isDefault ? 1 : 0, now, workspaceId, id);
      writeAudit(db, workspaceId, workspaceId, "warehouses", id, "update", { name: clean.name });
    } else {
      db.prepare(
        `INSERT INTO warehouses (id, workspace_id, code_number, name, details, is_default, state, legacy_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).run(id, workspaceId, clean.codeNumber, clean.name, clean.details, clean.isDefault ? 1 : 0, clean.legacyRef ?? null, now, now);
      writeAudit(db, workspaceId, workspaceId, "warehouses", id, "insert", { name: clean.name });
    }
    const row = db.prepare("SELECT * FROM warehouses WHERE workspace_id = ? AND id = ?").get(workspaceId, id) as Record<string, unknown>;
    return mapWarehouseRow(row);
  });
}

export function insertInventoryItemRow(
  db: DatabaseSync,
  workspaceId: string,
  item: Partial<InventoryItemRecord> & { name: string; warehouseId: string },
): InventoryItemRecord {
  ensureEmptyWorkspace(db, workspaceId);
  const id = makeId("inv");
  const clean = sanitizeInventoryPayload({ ...item, ownerId: workspaceId });
  const now = nowIso();
  db.prepare(
    `INSERT INTO inventory_items (id, workspace_id, warehouse_id, name, unit, quantity, avg_cost, selling_price, min_threshold, sku, quantity_unverified, legacy_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, workspaceId, clean.warehouseId, clean.name, clean.unit, clean.quantity, clean.avgCost,
    clean.sellingPrice ?? null, clean.minThreshold, clean.sku ?? "", clean.quantityUnverified ? 1 : 0,
    clean.legacyRef ?? null, now, now,
  );
  writeAudit(db, workspaceId, workspaceId, "inventory_items", id, "insert", { name: clean.name });
  const row = db.prepare("SELECT * FROM inventory_items WHERE workspace_id = ? AND id = ?").get(workspaceId, id) as Record<string, unknown>;
  return mapInventoryRow(row);
}

export function updateInventoryItemRow(
  db: DatabaseSync,
  workspaceId: string,
  itemId: string,
  item: Partial<InventoryItemRecord> & { name: string; warehouseId: string },
): void {
  const clean = sanitizeInventoryPayload({ ...item, ownerId: workspaceId });
  const now = nowIso();
  db.prepare(
    `UPDATE inventory_items
     SET name = ?, unit = ?, quantity = ?, avg_cost = ?, selling_price = ?, min_threshold = ?, sku = ?, warehouse_id = ?, quantity_unverified = ?, updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
  ).run(
    clean.name, clean.unit, clean.quantity, clean.avgCost, clean.sellingPrice ?? null, clean.minThreshold,
    clean.sku ?? "", clean.warehouseId, clean.quantityUnverified ? 1 : 0, now, workspaceId, itemId,
  );
  writeAudit(db, workspaceId, workspaceId, "inventory_items", itemId, "update", { quantity: clean.quantity });
}

export function batchUpdateInventoryItemRows(
  db: DatabaseSync,
  workspaceId: string,
  updates: readonly {
    item: InventoryItemRecord;
    quantity?: number;
    avgCost?: number;
    sellingPrice?: number;
    minThreshold?: number;
    quantityUnverified?: boolean;
  }[],
): void {
  if (!updates.length) return;
  const now = nowIso();
  withTransaction(db, () => {
    const stmt = db.prepare(
      `UPDATE inventory_items
       SET name = ?, unit = ?, quantity = ?, avg_cost = ?, selling_price = ?, min_threshold = ?, sku = ?, warehouse_id = ?, quantity_unverified = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ?`,
    );
    for (const entry of updates) {
      const clean = sanitizeInventoryPayload({
        ...entry.item,
        ownerId: workspaceId,
        quantity: entry.quantity ?? entry.item.quantity,
        avgCost: entry.avgCost ?? entry.item.avgCost,
        sellingPrice: entry.sellingPrice ?? entry.item.sellingPrice,
        minThreshold: entry.minThreshold ?? entry.item.minThreshold,
        quantityUnverified: entry.quantityUnverified ?? entry.item.quantityUnverified,
      });
      stmt.run(
        clean.name, clean.unit, clean.quantity, clean.avgCost, clean.sellingPrice ?? null,
        clean.minThreshold, clean.sku ?? "", clean.warehouseId, clean.quantityUnverified ? 1 : 0,
        now, workspaceId, entry.item.id,
      );
    }
    writeAudit(db, workspaceId, workspaceId, "inventory_items", "batch", "update", { count: updates.length });
  });
}

export function fetchInvoiceDetail(db: DatabaseSync, workspaceId: string, target: string) {
  const clean = String(target || "").trim();
  if (!clean) return null;
  let row = db.prepare("SELECT * FROM ledger_entries WHERE workspace_id = ? AND id = ? LIMIT 1").get(workspaceId, clean) as Record<string, unknown> | undefined;
  if (!row && /^\d+$/.test(clean)) {
    row = db
      .prepare("SELECT * FROM ledger_entries WHERE workspace_id = ? AND (entry_number = ? OR legacy_id = ?) LIMIT 1")
      .get(workspaceId, Number(clean), Number(clean)) as Record<string, unknown> | undefined;
  }
  if (!row) return null;
  const entry = mapLedgerRow(row);
  const lines = (
    db.prepare(
      `SELECT l.*, w.name AS warehouse_name, i.sku AS sku
       FROM invoice_lines l
       LEFT JOIN warehouses w ON w.id = l.warehouse_id
       LEFT JOIN inventory_items i ON i.id = l.inventory_item_id
       WHERE l.workspace_id = ? AND l.entry_id = ?
       ORDER BY l.id ASC`,
    ).all(workspaceId, entry.id) as Record<string, unknown>[]
  ).map((l) => ({
    id: Number(l.id),
    lineKind: String(l.line_kind ?? "item") as "item" | "free",
    inventoryItemId: l.inventory_item_id ? String(l.inventory_item_id) : null,
    itemName: String(l.item_name ?? l.details ?? ""),
    sku: String(l.sku ?? ""),
    warehouseName: String(l.warehouse_name ?? entry.warehouseName ?? ""),
    price: Number(l.price ?? 0),
    quantity: Number(l.quantity ?? 0),
    total: Number(l.total ?? 0),
    discount: Number(l.discount ?? 0),
    bonus: Number(l.bonus ?? 0),
    unit: String(l.unit ?? ""),
    unitNum: Number(l.unit_num ?? 1),
    details: String(l.details ?? ""),
    expiryDate: String(l.expiry_date ?? ""),
  }));
  return { entry: { ...entry, lineCount: lines.length }, lines };
}

export function getProductPriceStats(db: DatabaseSync, workspaceId: string, inventoryItemId: string) {
  const agg = db
    .prepare(
      `SELECT MIN(CASE WHEN price > 0 THEN price END) AS min_price,
              MAX(price) AS max_price,
              COUNT(*) AS tx_count
       FROM invoice_lines
       WHERE workspace_id = ? AND inventory_item_id = ?`,
    )
    .get(workspaceId, inventoryItemId) as { min_price: number | null; max_price: number | null; tx_count: number } | undefined;

  const latest = db
    .prepare(
      `SELECT il.price AS last_price
       FROM invoice_lines il
       LEFT JOIN ledger_entries le ON le.id = il.entry_id
       WHERE il.workspace_id = ? AND il.inventory_item_id = ? AND il.price > 0
       ORDER BY le.entry_date DESC, il.id DESC
       LIMIT 1`,
    )
    .get(workspaceId, inventoryItemId) as { last_price: number | null } | undefined;

  return {
    minPrice: Number(agg?.min_price ?? 0),
    maxPrice: Number(agg?.max_price ?? 0),
    lastPrice: Number(latest?.last_price ?? 0),
    txCount: Number(agg?.tx_count ?? 0),
  };
}

export function listUnifiedTablesMeta(db: DatabaseSync, workspaceId: string) {
  return UNIFIED_SQLITE_TABLES.map((name) => {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string; type: string; pk: number; notnull: number }[];
    const hasWs = cols.some((c) => c.name === "workspace_id");
    const countRow = hasWs
      ? (db.prepare(`SELECT COUNT(*) AS c FROM ${name} WHERE workspace_id = ?`).get(workspaceId) as { c: number })
      : (db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get() as { c: number });
    return {
      name,
      rowsCount: Number(countRow?.c ?? 0),
      columns: cols.map((c) => ({ name: c.name, type: c.type || "TEXT", pk: Boolean(c.pk), nullable: !c.notnull })),
    };
  });
}

export function queryUnifiedTable(
  db: DatabaseSync,
  workspaceId: string,
  rawTable: string,
  q: string,
  limit: number,
  offset: number,
) {
  if (!(UNIFIED_SQLITE_TABLES as readonly string[]).includes(rawTable)) {
    throw new Error("اسم الجدول غير معروف.");
  }
  const table = rawTable as UnifiedSqliteTableName;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  const colNames = cols.map((c) => c.name);
  const hasWs = colNames.includes("workspace_id");
  const searchCol = colNames.find((n) => ["name", "details", "account_name", "item_name", "company_name", "title", "source_name", "action"].includes(n));
  const safeLimit = Math.min(100, Math.max(1, limit || 40));
  const safeOffset = Math.max(0, offset || 0);

  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (hasWs) {
    clauses.push("workspace_id = ?");
    params.push(workspaceId);
  }
  const term = q.trim().slice(0, 120);
  if (term && searchCol) {
    clauses.push(`${searchCol} LIKE ?`);
    params.push(`%${term}%`);
  }
  const whereSql = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM ${table}${whereSql}`).get(...params) as { c: number };
  const orderCol = colNames.includes("id") ? "id DESC" : "rowid DESC";
  const rows = db
    .prepare(`SELECT * FROM ${table}${whereSql} ORDER BY ${orderCol} LIMIT ? OFFSET ?`)
    .all(...params, safeLimit, safeOffset) as Record<string, unknown>[];

  return {
    table,
    columns: colNames,
    total: Number(totalRow?.c ?? 0),
    rows,
  };
}

export async function exportCleanSqliteSnapshotBytes(db: DatabaseSync, destinationTempPath: string): Promise<Uint8Array> {
  await sqliteBackup(db, destinationTempPath);
  const bytes = fs.readFileSync(destinationTempPath);
  return new Uint8Array(bytes);
}

export function restoreUnifiedJsonBundle(
  db: DatabaseSync,
  workspaceId: string,
  payload: Record<string, unknown>,
): {
  accountGroups: number;
  accounts: number;
  warehouses: number;
  inventory: number;
  ledger: number;
} {
  const now = nowIso();
  const wsIn = (payload.workspace && typeof payload.workspace === "object"
    ? payload.workspace
    : {}) as Partial<WorkspaceSettings> & { baseCurrency?: string };
  const groupsIn = Array.isArray(payload.accountGroups) ? (payload.accountGroups as Partial<AccountGroupRecord>[]) : [];
  const cashboxesIn = Array.isArray(payload.cashboxes) ? (payload.cashboxes as Partial<CashboxRecord>[]) : [];
  const warehousesIn = Array.isArray(payload.warehouses) ? (payload.warehouses as Partial<WarehouseRecord>[]) : [];
  const accountsIn = Array.isArray(payload.accounts) ? (payload.accounts as Partial<AccountRecord>[]) : [];
  const inventoryIn = Array.isArray(payload.inventory) ? (payload.inventory as Partial<InventoryItemRecord>[]) : [];
  const ledgerIn = Array.isArray(payload.ledger) ? (payload.ledger as Partial<LedgerEntryRecord>[]) : [];
  const erpIn = payload.erpData && typeof payload.erpData === "object"
    ? (payload.erpData as Partial<ErpWorkspaceData>)
    : undefined;

  return withTransaction(db, () => {
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);

    const companyName = String(wsIn.companyName || "نسقو برو ERP").trim() || "نسقو برو ERP";
    const defaultCurrency = String(wsIn.defaultCurrency || wsIn.baseCurrency || "ريال").trim() || "ريال";
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, company_name, default_currency, whatsapp_provider, whatsapp_instant_enabled, whatsapp_phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      workspaceId,
      workspaceId,
      companyName,
      defaultCurrency,
      String(wsIn.whatsappProvider || "nasqo"),
      wsIn.whatsappInstantEnabled ? 1 : 0,
      String(wsIn.whatsappPhone || ""),
      now,
      now,
    );
    db.prepare(
      `INSERT INTO currencies (workspace_id, code, name, symbol, rate_primary, rate_secondary, name_secondary)
       VALUES (?, ?, ?, 'ر.ي', 1, 1, '')`,
    ).run(workspaceId, defaultCurrency, defaultCurrency);

    const groupIdMap = new Map<number, number>();
    const groupByCat = new Map<AccountCategory, number>();
    const insGroup = db.prepare(
      `INSERT INTO account_groups (workspace_id, name, category, currency_code, has_bill, is_employee, sort_order, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let groupsCount = 0;
    for (let i = 0; i < groupsIn.length; i += 1) {
      const g = groupsIn[i];
      if (!g || !String(g.name || "").trim()) continue;
      const cat = (g.category || "shop") as AccountCategory;
      const res = insGroup.run(
        workspaceId,
        String(g.name).trim(),
        cat,
        String(g.currencyCode || defaultCurrency),
        g.hasBill ? 1 : 0,
        g.isEmployee ? 1 : 0,
        Number(g.sortOrder ?? i + 1),
        g.legacyId ?? g.id ?? i + 1,
      );
      const newId = Number(res.lastInsertRowid);
      if (typeof g.id === "number") groupIdMap.set(g.id, newId);
      if (!groupByCat.has(cat)) groupByCat.set(cat, newId);
      groupsCount += 1;
    }

    if (groupsCount === 0 && accountsIn.length > 0) {
      const catLabels: Record<AccountCategory, string> = {
        sales: "المبيعات",
        purchases: "المشتريات",
        clients: "العملاء",
        employees: "الموظفين",
        transfers: "الحوالات",
        shop: "المحل",
      };
      const seenCats = new Set<AccountCategory>();
      let idx = 1;
      for (const a of accountsIn) {
        const cat = (a.category || "shop") as AccountCategory;
        if (seenCats.has(cat)) continue;
        seenCats.add(cat);
        const res = insGroup.run(workspaceId, catLabels[cat] ?? "حسابات", cat, defaultCurrency, 0, cat === "employees" ? 1 : 0, idx, idx);
        groupByCat.set(cat, Number(res.lastInsertRowid));
        groupsCount += 1;
        idx += 1;
      }
    }

    const cashboxMap = new Map<number, number>();
    const insCb = db.prepare(
      `INSERT INTO cashboxes (workspace_id, name, details, state, currency_code, box_type, sort_order, legacy_id)
       VALUES (?, ?, ?, 1, ?, 1, ?, ?)`,
    );
    for (let i = 0; i < cashboxesIn.length; i += 1) {
      const cb = cashboxesIn[i];
      if (!cb || !String(cb.name || "").trim()) continue;
      const res = insCb.run(workspaceId, String(cb.name).trim(), String(cb.details || ""), String(cb.currencyCode || defaultCurrency), i, cb.legacyId ?? cb.id ?? i + 1);
      if (typeof cb.id === "number") cashboxMap.set(cb.id, Number(res.lastInsertRowid));
    }

    const whMap = new Map<string, string>();
    const insWh = db.prepare(
      `INSERT INTO warehouses (id, workspace_id, code_number, name, details, is_default, state, legacy_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    );
    let whCount = 0;
    for (let i = 0; i < warehousesIn.length; i += 1) {
      const w = warehousesIn[i];
      if (!w || !String(w.name || "").trim()) continue;
      const clean = sanitizeWarehousePayload({ ...w, name: String(w.name), ownerId: workspaceId });
      const wid = w.id && !String(w.id).includes("/") ? String(w.id) : makeId("wh");
      insWh.run(wid, workspaceId, clean.codeNumber || i + 1, clean.name, clean.details, clean.isDefault ? 1 : 0, clean.legacyRef ?? null, now, now);
      if (w.id) whMap.set(String(w.id), wid);
      whCount += 1;
    }

    const accMap = new Map<string, { id: string; name: string }>();
    const insAcc = db.prepare(
      `INSERT INTO accounts (
         id, workspace_id, group_id, code_number, name, category, phone, credit_limit, currency,
         is_cash_account, account_image, sort_order, settlement, document_number_required,
         message_method, send_mode, note, opening_balance, opening_direction, legacy_ref, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let accCount = 0;
    for (const a of accountsIn) {
      if (!a || !String(a.name || "").trim()) continue;
      const clean = sanitizeAccountPayload({ ...a, name: String(a.name), ownerId: workspaceId });
      const aid = a.id && !String(a.id).includes("/") ? String(a.id) : makeId("acc");
      const mappedGroupId =
        (typeof a.groupId === "number" ? groupIdMap.get(a.groupId) : undefined) ??
        groupByCat.get(clean.category) ??
        null;
      insAcc.run(
        aid, workspaceId, mappedGroupId, clean.codeNumber, clean.name, clean.category, clean.phone, clean.creditLimit,
        clean.currency, clean.isCashAccount ? 1 : 0, clean.accountImage, clean.sortOrder, clean.settlement ? 1 : 0,
        clean.documentNumberRequired ? 1 : 0, clean.messageMethod, clean.sendMode, clean.note, clean.openingBalance,
        clean.openingDirection, clean.legacyRef ?? null, now, now,
      );
      if (a.id) accMap.set(String(a.id), { id: aid, name: clean.name });
      accCount += 1;
    }

    const invMap = new Map<string, string>();
    const firstWhId = [...whMap.values()][0] || "";
    const insInv = db.prepare(
      `INSERT INTO inventory_items (id, workspace_id, warehouse_id, name, unit, quantity, avg_cost, selling_price, min_threshold, sku, quantity_unverified, legacy_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let invCount = 0;
    for (const item of inventoryIn) {
      if (!item || !String(item.name || "").trim()) continue;
      const mappedWh = (item.warehouseId && whMap.get(String(item.warehouseId))) || firstWhId;
      if (!mappedWh) continue;
      const clean = sanitizeInventoryPayload({ ...item, name: String(item.name), warehouseId: mappedWh, ownerId: workspaceId });
      const iid = item.id && !String(item.id).includes("/") ? String(item.id) : makeId("inv");
      insInv.run(
        iid, workspaceId, mappedWh, clean.name, clean.unit, clean.quantity, clean.avgCost,
        clean.sellingPrice ?? null, clean.minThreshold, clean.sku ?? "", clean.quantityUnverified ? 1 : 0,
        clean.legacyRef ?? null, now, now,
      );
      if (item.id) invMap.set(String(item.id), iid);
      invCount += 1;
    }

    const insEnt = db.prepare(
      `INSERT INTO ledger_entries (
         id, workspace_id, account_id, account_name, counterpart_account_id, counterpart_account_name, cashbox_id,
         kind, type_label, payment, direction, amount, raw_dain, raw_madin, settled_on_receipt, currency, exchange_rate,
         details, document_number, warehouse_id, warehouse_name, invoice_content, entry_number, deleted, entry_date,
         due_date, expense_category, delivery_days, source_origin, posting_status, created_at_ms, legacy_ref
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'native', 'posted', ?, ?)`,
    );
    const insLine = db.prepare(
      `INSERT INTO invoice_lines (
         workspace_id, entry_id, line_kind, inventory_item_id, warehouse_id, item_name,
         price, quantity, total, discount, bonus, unit, unit_num, details
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    );
    let ledgerCount = 0;
    for (const e of ledgerIn) {
      if (!e || typeof e.amount !== "number") continue;
      const accRef = (e.accountId && accMap.get(String(e.accountId))) || [...accMap.values()][0];
      if (!accRef) continue;
      const clean = sanitizeLedgerPayload({
        ...e,
        accountId: accRef.id,
        accountName: e.accountName || accRef.name,
        ownerId: workspaceId,
      });
      const eid = e.id && !String(e.id).includes("/") ? String(e.id) : makeId("ent");
      const mappedCb = typeof e.cashboxId === "number" ? (cashboxMap.get(e.cashboxId) ?? null) : null;
      const mappedWh = (clean.warehouseId && whMap.get(clean.warehouseId)) || clean.warehouseId || firstWhId;
      insEnt.run(
        eid, workspaceId, clean.accountId, clean.accountName, clean.counterpartAccountId, clean.counterpartAccountName, mappedCb,
        clean.kind, clean.typeLabel, clean.payment, clean.direction, clean.amount, e.rawDain ?? null, e.rawMadin ?? null,
        e.settledOnReceipt ? 1 : 0, clean.currency, clean.exchangeRate, clean.details, clean.documentNumber, mappedWh,
        clean.warehouseName, clean.invoiceContent, clean.entryNumber, clean.deleted ? 1 : 0, clean.entryDate,
        clean.dueDate ?? null, clean.expenseCategory ?? null, clean.deliveryDays ?? null,
        Number(e.createdAtMs || Date.now()), clean.legacyRef ?? null,
      );
      if (Array.isArray(e.lines)) {
        for (const l of e.lines) {
          const mappedItem = l.inventoryItemId ? (invMap.get(String(l.inventoryItemId)) ?? String(l.inventoryItemId)) : null;
          insLine.run(
            workspaceId, eid, mappedItem ? "item" : "free", mappedItem, mappedWh || null, l.itemName,
            Number(l.price || 0), Number(l.quantity || 0), Number(l.total || 0), Number(l.discount || 0),
            Number(l.bonus || 0), l.unit || "حبة", l.details ?? "",
          );
        }
      }
      ledgerCount += 1;
    }

    const empty = createEmptyErpData();
    saveErpDataRows(db, workspaceId, {
      ...empty,
      ...(erpIn ?? {}),
      employees: Array.isArray(erpIn?.employees) ? erpIn.employees : [],
      leaveRequests: Array.isArray(erpIn?.leaveRequests) ? erpIn.leaveRequests : [],
      deals: Array.isArray(erpIn?.deals) ? erpIn.deals : [],
      purchaseOrders: Array.isArray(erpIn?.purchaseOrders) ? erpIn.purchaseOrders : [],
      boms: Array.isArray(erpIn?.boms) ? erpIn.boms : [],
      productionOrders: Array.isArray(erpIn?.productionOrders) ? erpIn.productionOrders : [],
      costCenters: Array.isArray(erpIn?.costCenters) ? erpIn.costCenters : [],
    });

    writeAudit(db, workspaceId, workspaceId, "restore_json", "bundle", "restore", {
      groupsCount, accCount, whCount, invCount, ledgerCount,
    });

    return {
      accountGroups: groupsCount,
      accounts: accCount,
      warehouses: whCount,
      inventory: invCount,
      ledger: ledgerCount,
    };
  });
}
