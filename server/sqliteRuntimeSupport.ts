/**
 * Self-contained server runtime helpers for Node 24 direct execution (`node server.ts`)
 * and `Dockerfile.deploy` (where only `server.ts`, `server/`, and `dist/client/` are copied).
 * Keep zero runtime imports from `../src/` (`import type` only, erased at runtime).
 */
import type {
  AccountCategory,
  AccountRecord,
  CurrencyCode,
  InventoryItemRecord,
  LedgerEntryRecord,
  LedgerKind,
  WarehouseRecord,
  WorkspaceSettings,
} from "../src/types.ts";
import type { ErpWorkspaceData } from "../src/erp.ts";

export const CURRENCIES = ["ريال"] as const;

export const ACCOUNT_CATEGORIES = [
  "purchases",
  "sales",
  "clients",
  "employees",
  "transfers",
  "shop",
] as const;

export const LEDGER_KINDS = [
  "voucher",
  "invoice",
  "return",
  "quote",
  "order",
  "transfer",
  "currency",
  "simple-entry",
  "opening",
] as const;

export const SCHEMA_LIMITS = {
  ownerIdMax: 128,
  companyNameMax: 100,
  phoneMax: 32,
  accountNameMax: 100,
  accountNoteMax: 300,
  ledgerDetailsMax: 600,
  documentNumberMax: 64,
  typeLabelMax: 60,
  entryDateMax: 40,
  expenseCategoryMax: 60,
  warehouseNameMax: 100,
  warehouseDetailsMax: 300,
  inventoryNameMax: 120,
  inventoryUnitMax: 32,
  skuMax: 64,
} as const;

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_INDIC = "۰۱۲۳۴۵۶۷۸۹";

export function parseArabicNumber(raw: string | number | null | undefined): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : 0;
  }
  if (!raw) return 0;
  const ascii = String(raw)
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_INDIC.indexOf(d)))
    .replace(/[,٬\s]/g, "")
    .replace(/٫/g, ".");
  const parsed = Number(ascii);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clampString(value: string, max: number): string {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function isValidCurrency(val: string): val is CurrencyCode {
  const clean = String(val ?? "").trim();
  return clean.length >= 1 && clean.length <= 32 && !/[\r\n\t<>]/.test(clean);
}

export function isValidCategory(val: string): val is AccountCategory {
  return (ACCOUNT_CATEGORIES as readonly string[]).includes(val);
}

export function isValidLedgerKind(val: string): val is LedgerKind {
  return (LEDGER_KINDS as readonly string[]).includes(val);
}

export function sanitizeWorkspacePayload(input: Partial<WorkspaceSettings> & { ownerId: string }) {
  return {
    ownerId: clampString(input.ownerId, SCHEMA_LIMITS.ownerIdMax),
    companyName: clampString(input.companyName || "نسقو برو", SCHEMA_LIMITS.companyNameMax) || "نسقو برو",
    defaultCurrency: isValidCurrency(input.defaultCurrency ?? "") ? input.defaultCurrency! : ("ريال" as const),
    whatsappProvider: (input.whatsappProvider === "external" ? "external" : "nasqo") as "external" | "nasqo",
    whatsappInstantEnabled: Boolean(input.whatsappInstantEnabled),
    whatsappPhone: clampString(input.whatsappPhone ?? "", SCHEMA_LIMITS.phoneMax),
  };
}

export function sanitizeAccountPayload(input: Partial<AccountRecord> & { ownerId: string; name: string }) {
  const safeOpening = Math.max(0, parseArabicNumber(input.openingBalance));
  const safeLimit = Math.max(0, parseArabicNumber(input.creditLimit));
  return {
    ownerId: clampString(input.ownerId, SCHEMA_LIMITS.ownerIdMax),
    name: clampString(input.name, SCHEMA_LIMITS.accountNameMax),
    category: isValidCategory(input.category ?? "") ? input.category! : ("purchases" as const),
    phone: clampString(input.phone ?? "", SCHEMA_LIMITS.phoneMax),
    creditLimit: safeLimit,
    currency: isValidCurrency(input.currency ?? "") ? input.currency! : ("ريال" as const),
    isCashAccount: Boolean(input.isCashAccount),
    accountImage: (input.accountImage === "2" || input.accountImage === "3" ? input.accountImage : "1") as "1" | "2" | "3",
    sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 1,
    settlement: Boolean(input.settlement),
    documentNumberRequired: Boolean(input.documentNumberRequired),
    messageMethod: (input.messageMethod === "whatsapp" ? "whatsapp" : "sms") as "whatsapp" | "sms",
    sendMode: (input.sendMode === "auto" || input.sendMode === "confirm" ? input.sendMode : "never") as "auto" | "confirm" | "never",
    note: clampString(input.note ?? "", SCHEMA_LIMITS.accountNoteMax),
    openingBalance: safeOpening,
    openingDirection: (input.openingDirection === "credit" ? "credit" : "debit") as "credit" | "debit",
    codeNumber: Number.isFinite(input.codeNumber) ? Number(input.codeNumber) : 1,
    ...(input.legacyRef ? { legacyRef: clampString(input.legacyRef, 128) } : {}),
  };
}

export function sanitizeLedgerPayload(
  input: Partial<LedgerEntryRecord> & { ownerId: string; accountId: string; accountName: string },
) {
  const safeAmount = Math.max(0, parseArabicNumber(input.amount));
  const safeRate = Math.max(0.0001, parseArabicNumber(input.exchangeRate) || 1);
  const dueDate = clampString(input.dueDate ?? "", SCHEMA_LIMITS.entryDateMax);
  const expenseCategory = clampString(input.expenseCategory ?? "", SCHEMA_LIMITS.expenseCategoryMax);
  const rawDelivery =
    input.deliveryDays !== undefined && input.deliveryDays !== null
      ? parseArabicNumber(input.deliveryDays)
      : undefined;
  const deliveryDays =
    rawDelivery !== undefined && Number.isFinite(rawDelivery)
      ? Math.min(365, Math.max(0, Math.round(rawDelivery)))
      : undefined;
  return {
    ownerId: clampString(input.ownerId, SCHEMA_LIMITS.ownerIdMax),
    accountId: clampString(input.accountId, SCHEMA_LIMITS.ownerIdMax),
    accountName: clampString(input.accountName, SCHEMA_LIMITS.accountNameMax) || "حساب",
    counterpartAccountId: clampString(input.counterpartAccountId ?? "", SCHEMA_LIMITS.ownerIdMax),
    counterpartAccountName: clampString(input.counterpartAccountName ?? "", SCHEMA_LIMITS.accountNameMax),
    kind: isValidLedgerKind(input.kind ?? "") ? input.kind! : ("voucher" as const),
    typeLabel: clampString(input.typeLabel || "سند", SCHEMA_LIMITS.typeLabelMax) || "سند",
    payment: (input.payment === "cash" || input.payment === "credit" ? input.payment : "balance") as "cash" | "credit" | "balance",
    direction: (input.direction === "credit" ? "credit" : "debit") as "credit" | "debit",
    amount: safeAmount,
    currency: isValidCurrency(input.currency ?? "") ? input.currency! : ("ريال" as const),
    exchangeRate: safeRate,
    details: clampString(input.details ?? "", SCHEMA_LIMITS.ledgerDetailsMax),
    documentNumber: clampString(input.documentNumber ?? "", SCHEMA_LIMITS.documentNumberMax),
    warehouseId: clampString(input.warehouseId ?? "", SCHEMA_LIMITS.ownerIdMax),
    warehouseName: clampString(input.warehouseName ?? "", SCHEMA_LIMITS.warehouseNameMax),
    invoiceContent: (
      input.invoiceContent === "items" || input.invoiceContent === "free" ? input.invoiceContent : "none"
    ) as "items" | "free" | "none",
    entryNumber: Number.isFinite(input.entryNumber) ? Number(input.entryNumber) : 1,
    deleted: Boolean(input.deleted),
    entryDate:
      clampString(input.entryDate || new Date().toISOString().slice(0, 10), SCHEMA_LIMITS.entryDateMax) ||
      new Date().toISOString().slice(0, 10),
    ...(dueDate ? { dueDate } : {}),
    ...(expenseCategory ? { expenseCategory } : {}),
    ...(deliveryDays !== undefined ? { deliveryDays } : {}),
    ...(input.legacyRef ? { legacyRef: clampString(input.legacyRef, 128) } : {}),
  };
}

export function sanitizeWarehousePayload(input: Partial<WarehouseRecord> & { ownerId: string; name: string }) {
  return {
    ownerId: clampString(input.ownerId, SCHEMA_LIMITS.ownerIdMax),
    name: clampString(input.name, SCHEMA_LIMITS.warehouseNameMax),
    details: clampString(input.details ?? "", SCHEMA_LIMITS.warehouseDetailsMax),
    isDefault: Boolean(input.isDefault),
    codeNumber: Number.isFinite(input.codeNumber) ? Number(input.codeNumber) : 1,
    ...(input.legacyRef ? { legacyRef: clampString(input.legacyRef, 128) } : {}),
  };
}

export function sanitizeInventoryPayload(
  input: Partial<InventoryItemRecord> & { ownerId: string; name: string; warehouseId?: string },
) {
  const minThreshold =
    input.minThreshold !== undefined ? Math.max(0, parseArabicNumber(input.minThreshold)) : 25;
  const sku = clampString(input.sku ?? "", SCHEMA_LIMITS.skuMax);
  return {
    ownerId: clampString(input.ownerId, SCHEMA_LIMITS.ownerIdMax),
    name: clampString(input.name, SCHEMA_LIMITS.inventoryNameMax),
    unit: clampString(input.unit || "حبة", SCHEMA_LIMITS.inventoryUnitMax) || "حبة",
    quantity: Math.max(0, parseArabicNumber(input.quantity)),
    avgCost: Math.max(0, parseArabicNumber(input.avgCost)),
    ...(input.sellingPrice !== undefined && Number.isFinite(Number(input.sellingPrice)) && Number(input.sellingPrice) > 0
      ? { sellingPrice: Number(input.sellingPrice) }
      : {}),
    minThreshold,
    ...(sku ? { sku } : {}),
    warehouseId: clampString(input.warehouseId ?? "", SCHEMA_LIMITS.ownerIdMax),
    ...(input.quantityUnverified ? { quantityUnverified: true } : {}),
    ...(input.legacyRef ? { legacyRef: clampString(input.legacyRef, 128) } : {}),
  };
}

export function createDefaultErpData(todayIso: string = new Date().toISOString().slice(0, 10)): ErpWorkspaceData {
  return {
    employees: [
      {
        id: "emp_1",
        accountId: "acc_emp_1",
        name: "أحمد السالم",
        roleTitle: "مدير مبيعات وفروع",
        department: "المبيعات",
        basicSalary: 6500,
        allowances: 1200,
        deductions: 0,
        status: "active",
        hireDate: "2024-03-01",
        leaveBalanceDays: 18,
        attendanceToday: "present",
      },
      {
        id: "emp_2",
        name: "سارة القحطاني",
        roleTitle: "محاسبة مالية رئيسية",
        department: "المالية",
        basicSalary: 5800,
        allowances: 900,
        deductions: 200,
        status: "active",
        hireDate: "2024-07-15",
        leaveBalanceDays: 21,
        attendanceToday: "present",
      },
      {
        id: "emp_3",
        name: "خالد الحربي",
        roleTitle: "أمين مستودع ومشتريات",
        department: "المخازن وسلسلة التوريد",
        basicSalary: 4500,
        allowances: 750,
        deductions: 0,
        status: "active",
        hireDate: "2025-01-10",
        leaveBalanceDays: 14,
        attendanceToday: "present",
      },
    ],
    leaveRequests: [
      {
        id: "lv_1",
        employeeId: "emp_3",
        employeeName: "خالد الحربي",
        leaveType: "سنوية",
        startDate: todayIso,
        days: 3,
        status: "pending",
        note: "إجازة عائلية قصيرة",
      },
    ],
    deals: [
      {
        id: "deal_1",
        title: "توريد تجهيزات إنارة ذكية — معرض الشمال",
        clientAccountId: "acc_sales_1",
        clientName: "المبيعات العامة",
        value: 42000,
        currency: "ريال",
        stage: "negotiation",
        probability: 75,
        expectedCloseDate: todayIso,
        assignedTo: "أحمد السالم",
      },
      {
        id: "deal_2",
        title: "عقد صيانة وتوريد مستلزمات مكتبية سنوي",
        clientAccountId: "acc_sales_1",
        clientName: "المبيعات العامة",
        value: 28500,
        currency: "ريال",
        stage: "proposal",
        probability: 50,
        expectedCloseDate: todayIso,
        assignedTo: "أحمد السالم",
      },
    ],
    purchaseOrders: [
      {
        id: "po_101",
        poNumber: "PO-2026-101",
        supplierAccountId: "acc_barari",
        supplierName: "البراري للتوريد",
        warehouseId: "wh_1",
        warehouseName: "المخزن الرئيسي",
        currency: "ريال",
        orderDate: todayIso,
        expectedDate: todayIso,
        status: "approved",
        lines: [
          {
            inventoryItemId: "inv_2",
            itemName: "توصيلة تايب سي 2 متر",
            unit: "حبة",
            quantity: 20,
            unitCost: 1450,
          },
          {
            inventoryItemId: "inv_3",
            itemName: "بطارية جهاز كشف الذهب",
            unit: "حبة",
            quantity: 10,
            unitCost: 1500,
          },
        ],
        notes: "توريد لتعويض المخزون المنخفض",
      },
    ],
    boms: [
      {
        id: "bom_1",
        name: "طقم تجهيز إضاءة وطاقة محمول",
        finishedItemId: "inv_1",
        finishedItemName: "ابجورة شكل قمر",
        finishedUnit: "حبة",
        components: [
          {
            inventoryItemId: "inv_2",
            itemName: "توصيلة تايب سي 2 متر",
            unit: "حبة",
            quantityPerUnit: 1,
          },
          {
            inventoryItemId: "inv_3",
            itemName: "بطارية جهاز كشف الذهب",
            unit: "حبة",
            quantityPerUnit: 1,
          },
        ],
      },
    ],
    productionOrders: [
      {
        id: "mfg_1",
        orderNumber: "MFG-01",
        bomId: "bom_1",
        bomName: "طقم تجهيز إضاءة وطاقة محمول",
        finishedItemId: "inv_1",
        finishedItemName: "ابجورة شكل قمر",
        quantityToProduce: 5,
        warehouseId: "wh_1",
        status: "planned",
        createdDate: todayIso,
        costCenterId: "cc_ops",
      },
    ],
    costCenters: [
      {
        id: "cc_ops",
        code: "CC-100",
        name: "مركز تشغيل الفروع والمخازن",
        managerName: "خالد الحربي",
        budget: 95000,
        extraPostedSpend: 0,
        linkedCategories: ["مصروفات تشغيلية", "صيانة ومرافق", "شحن ونقل"],
        status: "active",
      },
      {
        id: "cc_hr",
        code: "CC-200",
        name: "مركز الرواتب والموارد البشرية",
        managerName: "سارة القحطاني",
        budget: 60000,
        extraPostedSpend: 0,
        linkedCategories: ["رواتب وأجور"],
        status: "active",
      },
      {
        id: "cc_sales",
        code: "CC-300",
        name: "مركز المبيعات والتسويق",
        managerName: "أحمد السالم",
        budget: 45000,
        extraPostedSpend: 0,
        linkedCategories: ["تسويق ومبيعات"],
        status: "active",
      },
    ],
  };
}

export function createEmptyErpData(): ErpWorkspaceData {
  return {
    employees: [],
    leaveRequests: [],
    deals: [],
    purchaseOrders: [],
    boms: [],
    productionOrders: [],
    costCenters: [],
  };
}

/* ------------------------------------------------------------------ legacy SQLite helpers */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

const TOLERANCE = 0.005;

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function isoDate(row: Row): string | null {
  const y = Number(row.year);
  const m = Number(row.month);
  const d = Number(row.day);
  if (Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) && y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const nd = text(row.ndate);
  if (/^\d{8}$/.test(nd) && nd !== "00000000") {
    return `${nd.slice(0, 4)}-${nd.slice(4, 6)}-${nd.slice(6, 8)}`;
  }
  return null;
}

export type DocumentRole =
  | "sale"
  | "purchase"
  | "sale_return"
  | "purchase_return"
  | "free_sale"
  | "free_purchase"
  | "voucher"
  | "unknown";

export type BillTypeEvidence = {
  billType: number;
  rows: number;
  deletedRows: number;
  withPricedLines: number;
  withFreeLines: number;
  totalSide: "dain" | "madin" | "mixed" | "none";
  sideMatchedRows: number;
  comparedRows: number;
  priceEqualsProductPrice: number;
  priceEqualsProductPrice2: number;
  oneSidedRows: number;
  equalSidedRows: number;
  otherSidedRows: number;
  topAccountGroups: { groupId: number; groupName: string; count: number }[];
  suggestedRole: DocumentRole;
  basis: string[];
};

type LinesIndex = { priced: Map<string, Row[]>; free: Map<string, Row[]> };

function indexLines(tables: Tables, pricedTable: string, freeTable: string): LinesIndex {
  const group = (rows: Row[] | undefined) => {
    const map = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const k = String(r.bill_id);
      const list = map.get(k);
      if (list) list.push(r);
      else map.set(k, [r]);
    }
    return map;
  };
  return { priced: group(tables[pricedTable]), free: group(tables[freeTable]) };
}

function lineTotal(rows: Row[]): number | null {
  let sum = 0;
  for (const r of rows) {
    const v = num(r.total);
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

export function billTypeEvidence(tables: Tables): BillTypeEvidence[] {
  const live = indexLines(tables, "bill_details", "bill_details2");
  const del = indexLines(tables, "bin_bill_details", "bin_bill_details2");
  const products = new Map<string, Row>((tables.products ?? []).map((p: Row) => [String(p.id), p]));
  const customers = new Map<string, Row>((tables.customers ?? []).map((c: Row) => [String(c.id), c]));
  const groups = new Map<number, string>((tables.boxes ?? []).map((b: Row) => [Number(b.id), text(b.name)]));

  type Acc = BillTypeEvidence & { groupCounts: Map<number, number>; priceLines: number };
  const byType = new Map<number, Acc>();
  const acc = (t: number): Acc => {
    let a = byType.get(t);
    if (!a) {
      a = {
        billType: t,
        rows: 0,
        deletedRows: 0,
        withPricedLines: 0,
        withFreeLines: 0,
        totalSide: "none",
        sideMatchedRows: 0,
        comparedRows: 0,
        priceEqualsProductPrice: 0,
        priceEqualsProductPrice2: 0,
        oneSidedRows: 0,
        equalSidedRows: 0,
        otherSidedRows: 0,
        topAccountGroups: [],
        suggestedRole: "unknown",
        basis: [],
        groupCounts: new Map(),
        priceLines: 0,
      };
      byType.set(t, a);
    }
    return a;
  };
  const sideVotes = new Map<number, { dain: number; madin: number; compared: number }>();

  const scan = (moves: Row[], lines: LinesIndex, deleted: boolean) => {
    for (const m of moves) {
      const t = Number(m.bill_type);
      const a = acc(t);
      if (deleted) a.deletedRows += 1;
      else a.rows += 1;
      const dain = num(m.dain);
      const madin = num(m.madin);
      if (dain !== null && madin !== null) {
        if (dain > 0 && madin > 0) {
          if (Math.abs(dain - madin) < TOLERANCE) a.equalSidedRows += 1;
          else a.otherSidedRows += 1;
        } else if (dain > 0 || madin > 0) a.oneSidedRows += 1;
      }
      const cust = customers.get(String(m.per_id));
      if (cust && !deleted) a.groupCounts.set(Number(cust.type), (a.groupCounts.get(Number(cust.type)) ?? 0) + 1);

      const pricedLines = lines.priced.get(String(m.id));
      const freeLines = lines.free.get(String(m.id));
      if (pricedLines?.length) a.withPricedLines += 1;
      if (freeLines?.length) a.withFreeLines += 1;
      const ls = pricedLines?.length ? pricedLines : freeLines;
      if (!deleted && ls?.length && dain !== null && madin !== null) {
        const total = lineTotal(ls);
        if (total !== null) {
          const v = sideVotes.get(t) ?? { dain: 0, madin: 0, compared: 0 };
          v.compared += 1;
          if (Math.abs(total - dain) < 0.01) v.dain += 1;
          if (Math.abs(total - madin) < 0.01) v.madin += 1;
          sideVotes.set(t, v);
        }
      }
      if (!deleted && pricedLines?.length) {
        for (const l of pricedLines) {
          const p = products.get(String(l.prod_id));
          const lp = num(l.price);
          if (!p || lp === null) continue;
          a.priceLines += 1;
          if (Math.abs(lp - (num(p.price) ?? NaN)) < 0.005) a.priceEqualsProductPrice += 1;
          if (Math.abs(lp - (num(p.price2) ?? NaN)) < 0.005) a.priceEqualsProductPrice2 += 1;
        }
      }
    }
  };
  scan(tables.input_move ?? [], live, false);
  scan(tables.bin ?? [], del, true);

  const list = [...byType.values()].sort((a, b) => a.billType - b.billType);
  for (const a of list) {
    const v = sideVotes.get(a.billType);
    a.comparedRows = v?.compared ?? 0;
    if (v && v.compared > 0) {
      const dRatio = v.dain / v.compared;
      const mRatio = v.madin / v.compared;
      if (dRatio >= 0.95 && mRatio < 0.95) { a.totalSide = "dain"; a.sideMatchedRows = v.dain; }
      else if (mRatio >= 0.95 && dRatio < 0.95) { a.totalSide = "madin"; a.sideMatchedRows = v.madin; }
      else if (dRatio >= 0.95 && mRatio >= 0.95) { a.totalSide = "mixed"; a.sideMatchedRows = v.compared; }
      else { a.totalSide = "mixed"; a.sideMatchedRows = Math.max(v.dain, v.madin); }
    }
    a.topAccountGroups = [...a.groupCounts.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([groupId, count]) => ({ groupId, groupName: groups.get(groupId) ?? `مجموعة ${groupId}`, count }));
  }

  const priced = list.filter((a) => a.withPricedLines > 0 && (a.totalSide === "dain" || a.totalSide === "madin"));
  const reference = [...priced].sort(
    (a, b) => (b.priceEqualsProductPrice - b.priceEqualsProductPrice2) - (a.priceEqualsProductPrice - a.priceEqualsProductPrice2),
  )[0];
  const saleSide = reference && reference.priceEqualsProductPrice > reference.priceEqualsProductPrice2 ? reference.totalSide : null;

  for (const a of list) {
    const basis: string[] = [];
    const hasLines = a.withPricedLines + a.withFreeLines > 0;
    if (!hasLines) {
      a.suggestedRole = "voucher";
      basis.push("لا توجد بنود مرتبطة بهذا النوع في bill_details أو bill_details2.");
      a.basis = basis;
      continue;
    }
    if (a.totalSide === "dain" || a.totalSide === "madin") {
      basis.push(`مجموع بنود المستند يطابق الحقل ${a.totalSide} في ${a.sideMatchedRows} من ${a.comparedRows} مستندًا.`);
    }
    if (saleSide === null || (a.totalSide !== "dain" && a.totalSide !== "madin")) {
      a.suggestedRole = "unknown";
      basis.push("الأدلة غير كافية لاقتراح دور محاسبي.");
      a.basis = basis;
      continue;
    }
    if (a.withPricedLines > 0) {
      const sellLike = a.priceEqualsProductPrice > a.priceEqualsProductPrice2;
      basis.push(`سعر البند يساوي price في الصنف ${a.priceEqualsProductPrice} مرة، ويساوي price2 ${a.priceEqualsProductPrice2} مرة (من ${a.priceLines} بندًا).`);
      const onSaleSide = a.totalSide === saleSide;
      a.suggestedRole = sellLike ? (onSaleSide ? "sale" : "sale_return") : (onSaleSide ? "purchase_return" : "purchase");
    } else {
      basis.push("بنود حرة بلا ربط بالأصناف؛ الاقتراح مبني على جهة المجموع فقط.");
      a.suggestedRole = a.totalSide === saleSide ? "free_sale" : "free_purchase";
    }
    const top = a.topAccountGroups[0];
    if (top) basis.push(`أكثر حسابات هذا النوع تنتمي للمجموعة «${top.groupName}» (${top.count}).`);
    a.basis = basis;
  }
  return list.map(({ groupCounts: _g, priceLines: _p, ...rest }) => rest);
}

export type ReasonCode =
  | "deleted_in_source"
  | "invoice_needs_counter_account"
  | "voucher_no_pair"
  | "voucher_ref_single"
  | "voucher_unbalanced"
  | "both_sides_positive"
  | "both_sides_zero"
  | "invalid_amount"
  | "invalid_date"
  | "missing_account"
  | "unregistered_currency"
  | "unsupported_currency"
  | "mixed_currency_group"
  | "same_account_pair"
  | "policy_not_selected"
  | "account_not_migrated";

export type MoveStatus = "eligible" | "pending" | "rejected" | "deleted";

export type MoveReview = {
  table: "input_move" | "bin";
  id: number;
  billType: number;
  kind: "voucher" | "invoice";
  personId: number | null;
  personName: string;
  date: string | null;
  dain: number | null;
  madin: number | null;
  currencyId: number | null;
  documentNumber: string;
  details: string;
  groupRef: string;
  status: MoveStatus;
  reasons: ReasonCode[];
};

export type VoucherGroup = {
  groupRef: string;
  rows: number[];
  sumDain: number;
  sumMadin: number;
  balanced: boolean;
};

function documentTypesWithLines(tables: Tables): Set<number> {
  const billIdsWithLines = new Set<string>();
  for (const r of tables.bill_details ?? []) billIdsWithLines.add(String(r.bill_id));
  for (const r of tables.bill_details2 ?? []) billIdsWithLines.add(String(r.bill_id));
  const types = new Set<number>();
  for (const m of tables.input_move ?? []) if (billIdsWithLines.has(String(m.id))) types.add(Number(m.bill_type));
  const binIds = new Set<string>();
  for (const r of tables.bin_bill_details ?? []) binIds.add(String(r.bill_id));
  for (const r of tables.bin_bill_details2 ?? []) binIds.add(String(r.bill_id));
  for (const m of tables.bin ?? []) if (binIds.has(String(m.id))) types.add(Number(m.bill_type));
  return types;
}

function voucherGroups(tables: Tables, invoiceTypes: Set<number>): Map<string, VoucherGroup> {
  const groups = new Map<string, VoucherGroup>();
  for (const m of tables.input_move ?? []) {
    if (invoiceTypes.has(Number(m.bill_type))) continue;
    const ref = text(m.ref);
    if (!ref) continue;
    const g = groups.get(ref) ?? { groupRef: ref, rows: [], sumDain: 0, sumMadin: 0, balanced: false };
    g.rows.push(Number(m.id));
    g.sumDain += num(m.dain) ?? 0;
    g.sumMadin += num(m.madin) ?? 0;
    groups.set(ref, g);
  }
  for (const g of groups.values()) g.balanced = g.rows.length >= 2 && Math.abs(g.sumDain - g.sumMadin) < TOLERANCE;
  return groups;
}

export function reviewMoves(tables: Tables): { reviews: MoveReview[]; groups: Map<string, VoucherGroup> } {
  const invoiceTypes = documentTypesWithLines(tables);
  const groups = voucherGroups(tables, invoiceTypes);
  const customers = new Map<string, Row>((tables.customers ?? []).map((c: Row) => [String(c.id), c]));
  const currencies = new Set<string>((tables.currencies ?? []).map((c: Row) => String(c.id)));
  const movesById = new Map<number, Row>((tables.input_move ?? []).map((m: Row) => [Number(m.id), m]));
  const reviews: MoveReview[] = [];

  const push = (m: Row, table: "input_move" | "bin") => {
    const billType = Number(m.bill_type);
    const kind: MoveReview["kind"] = invoiceTypes.has(billType) ? "invoice" : "voucher";
    const dain = num(m.dain);
    const madin = num(m.madin);
    const date = isoDate(m);
    const groupRef = text(m.ref);
    const reasons: ReasonCode[] = [];
    let status: MoveStatus = "pending";

    if (table === "bin") {
      reasons.push("deleted_in_source");
      status = "deleted";
    } else if (kind === "invoice") {
      reasons.push("invoice_needs_counter_account");
    } else {
      const g = groupRef ? groups.get(groupRef) : undefined;
      if (dain === null || madin === null || dain < 0 || madin < 0) { reasons.push("invalid_amount"); status = "rejected"; }
      else if (dain > 0 && madin > 0) { reasons.push("both_sides_positive"); status = "rejected"; }
      else if (dain === 0 && madin === 0) { reasons.push("both_sides_zero"); status = "rejected"; }
      if (!customers.has(String(m.per_id))) { reasons.push("missing_account"); status = "rejected"; }
      if (!currencies.has(String(m.cur))) { reasons.push("unregistered_currency"); status = "rejected"; }
      if (!date) { reasons.push("invalid_date"); status = "rejected"; }
      if (!g) { if (status !== "rejected") reasons.push("voucher_no_pair"); }
      else if (g.rows.length < 2) { if (status !== "rejected") reasons.push("voucher_ref_single"); }
      else {
        const curs = new Set(g.rows.map((id) => String(movesById.get(id)?.cur)));
        const accounts = new Set(g.rows.map((id) => String(movesById.get(id)?.per_id)));
        if (curs.size > 1) { reasons.push("mixed_currency_group"); status = "rejected"; }
        if (!g.balanced) { reasons.push("voucher_unbalanced"); status = "rejected"; }
        if (g.rows.length === 2 && accounts.size === 1) { reasons.push("same_account_pair"); status = "rejected"; }
        if (status !== "rejected") status = "eligible";
      }
    }
    reviews.push({
      table,
      id: Number(m.id),
      billType,
      kind,
      personId: m.per_id === null || m.per_id === undefined ? null : Number(m.per_id),
      personName: customers.get(String(m.per_id)) ? text(customers.get(String(m.per_id))!.name) : text(m.pername),
      date,
      dain,
      madin,
      currencyId: m.cur === null || m.cur === undefined ? null : Number(m.cur),
      documentNumber: text(m.bill),
      details: text(m.details),
      groupRef,
      status,
      reasons,
    });
  };
  for (const m of tables.input_move ?? []) push(m, "input_move");
  for (const m of tables.bin ?? []) push(m, "bin");
  return { reviews, groups };
}

export type ReviewSummary = {
  total: number;
  byStatus: Record<MoveStatus, number>;
  byReason: Partial<Record<ReasonCode, number>>;
  byBillType: Record<string, { rows: number; eligible: number; pending: number; rejected: number; deleted: number }>;
};

export function summarizeReview(reviews: MoveReview[]): ReviewSummary {
  const summary: ReviewSummary = {
    total: reviews.length,
    byStatus: { eligible: 0, pending: 0, rejected: 0, deleted: 0 },
    byReason: {},
    byBillType: {},
  };
  for (const r of reviews) {
    summary.byStatus[r.status] += 1;
    for (const reason of r.reasons) summary.byReason[reason] = (summary.byReason[reason] ?? 0) + 1;
    const key = String(r.billType);
    const row = (summary.byBillType[key] ||= { rows: 0, eligible: 0, pending: 0, rejected: 0, deleted: 0 });
    row.rows += 1;
    row[r.status] += 1;
  }
  return summary;
}

export function legacyRef(sha256: string, table: string, id: unknown): string {
  return `${sha256.slice(0, 12)}:${table}:${String(id)}`;
}

export const livePrefix = (sha256: string) => `lg${sha256.slice(0, 10)}`;
export const liveId = (sha256: string, kind: "acc" | "wh" | "inv" | "ent", id: number | string) => `${livePrefix(sha256)}_${kind}_${id}`;

export const GROUP_CATEGORY_BY_NAME: Record<string, AccountCategory> = {
  "المبيعات": "sales",
  "المشتريات": "purchases",
  "الموردين": "purchases",
  "العملاء": "clients",
  "الموظفين": "employees",
  "المحل": "shop",
};

export type GroupSuggestion = {
  groupId: number;
  groupName: string;
  accounts: number;
  category: AccountCategory;
  matchedByName: boolean;
};

export function suggestGroupCategories(tables: Tables): GroupSuggestion[] {
  const counts = new Map<number, number>();
  for (const c of tables.customers ?? []) counts.set(Number(c.type), (counts.get(Number(c.type)) ?? 0) + 1);
  const names = new Map<number, string>((tables.boxes ?? []).map((b: Row) => [Number(b.id), text(b.name)]));
  const ids = new Set<number>([...counts.keys(), ...names.keys()]);
  return [...ids]
    .sort((a, b) => a - b)
    .filter((id) => counts.has(id))
    .map((groupId) => {
      const groupName = names.get(groupId) ?? `مجموعة ${groupId}`;
      const mapped = GROUP_CATEGORY_BY_NAME[groupName];
      return { groupId, groupName, accounts: counts.get(groupId) ?? 0, category: mapped ?? "shop", matchedByName: Boolean(mapped) };
    });
}

export type MasterData = {
  accounts: AccountRecord[];
  warehouses: WarehouseRecord[];
  inventory: InventoryItemRecord[];
  idMap: { kind: "accounts" | "warehouses" | "inventory"; legacyId: number; liveId: string }[];
  notes: {
    unmatchedGroups: string[];
    warehouseInferredForProducts: number;
    warehouseFallbackForProducts: number;
    productsWithoutLines: number;
    phoneFallbackUsed: number;
  };
};

function positiveInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export function buildMasterData(
  tables: Tables,
  sha256: string,
  ownerId: string,
  groupCategories: Record<string, AccountCategory>,
): MasterData {
  const idMap: MasterData["idMap"] = [];
  const groupNames = new Map<number, string>((tables.boxes ?? []).map((b: Row) => [Number(b.id), text(b.name)]));
  const unmatched = new Set<string>();
  let phoneFallbackUsed = 0;

  const accounts: AccountRecord[] = [];
  for (const c of tables.customers ?? []) {
    const id = Number(c.id);
    const group = Number(c.type);
    const category = groupCategories[String(group)] ?? GROUP_CATEGORY_BY_NAME[groupNames.get(group) ?? ""] ?? "shop";
    if (!GROUP_CATEGORY_BY_NAME[groupNames.get(group) ?? ""] && !groupCategories[String(group)]) unmatched.add(groupNames.get(group) ?? String(group));
    let phone = text(c.phone);
    if (!phone && text(c.phon)) { phone = text(c.phon); phoneFallbackUsed += 1; }
    const limit = num(c.lim);
    const groupLabel = groupNames.get(group);
    const note = [text(c.details), groupLabel ? `المجموعة الأصلية: ${groupLabel}` : ""].filter(Boolean).join(" | ");
    const live = liveId(sha256, "acc", id);
    accounts.push({
      id: live,
      ownerId,
      name: text(c.name) || `حساب ${id}`,
      category,
      phone,
      creditLimit: limit !== null && limit >= 0 ? limit : 0,
      currency: "ريال",
      isCashAccount: false,
      accountImage: "1",
      sortOrder: id,
      settlement: false,
      documentNumberRequired: false,
      messageMethod: "sms",
      sendMode: "never",
      note,
      openingBalance: 0,
      openingDirection: "debit",
      codeNumber: id,
      legacyRef: legacyRef(sha256, "customers", id),
    });
    idMap.push({ kind: "accounts", legacyId: id, liveId: live });
  }

  const warehouses: WarehouseRecord[] = [];
  const storeIds = new Set<number>();
  for (const s of tables.stores ?? []) {
    const id = Number(s.id);
    storeIds.add(id);
    const live = liveId(sha256, "wh", id);
    warehouses.push({
      id: live,
      ownerId,
      name: text(s.name) || `مخزن ${id}`,
      details: text(s.details),
      isDefault: false,
      codeNumber: id,
      legacyRef: legacyRef(sha256, "stores", id),
    });
    idMap.push({ kind: "warehouses", legacyId: id, liveId: live });
  }

  const storeVotes = new Map<number, Map<number, number>>();
  for (const l of tables.bill_details ?? []) {
    const p = positiveInt(l.prod_id);
    const s = positiveInt(l.store_id);
    if (p === null || s === null || !storeIds.has(s)) continue;
    const votes = storeVotes.get(p) ?? new Map<number, number>();
    votes.set(s, (votes.get(s) ?? 0) + 1);
    storeVotes.set(p, votes);
  }
  const fallbackStore = [...storeIds].sort((a, b) => a - b)[0];
  let inferred = 0;
  let fallback = 0;
  const inventory: InventoryItemRecord[] = [];
  for (const p of tables.products ?? []) {
    const id = Number(p.id);
    const votes = storeVotes.get(id);
    let store = fallbackStore;
    if (votes && votes.size) {
      store = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      inferred += 1;
    } else fallback += 1;
    const cost = num(p.price2);
    const live = liveId(sha256, "inv", id);
    inventory.push({
      id: live,
      ownerId,
      name: text(p.name) || `صنف ${id}`,
      unit: text(p.unit) || "حبة",
      quantity: 0,
      quantityUnverified: true,
      avgCost: cost !== null && cost >= 0 ? cost : 0,
      minThreshold: 0,
      ...(text(p.barcode) ? { sku: text(p.barcode) } : {}),
      warehouseId: store === undefined ? "" : liveId(sha256, "wh", store),
      legacyRef: legacyRef(sha256, "products", id),
    });
    idMap.push({ kind: "inventory", legacyId: id, liveId: live });
  }
  return {
    accounts,
    warehouses,
    inventory,
    idMap,
    notes: {
      unmatchedGroups: [...unmatched],
      warehouseInferredForProducts: inferred,
      warehouseFallbackForProducts: fallback,
      productsWithoutLines: fallback,
      phoneFallbackUsed,
    },
  };
}
