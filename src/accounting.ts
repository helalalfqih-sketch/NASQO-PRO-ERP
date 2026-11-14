import {
  ACCOUNT_CATEGORIES,
  CURRENCIES,
  LEDGER_KINDS,
  SCHEMA_LIMITS,
  type AccountCategory,
  type AccountRecord,
  type CurrencyCode,
  type InventoryItemRecord,
  type LedgerEntryRecord,
  type LedgerKind,
  type StatementRowWithBalance,
  type WarehouseRecord,
  type WorkspaceSettings,
} from "./types.ts";

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

export function formatAmount(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const rounded = Math.round(safe * 100) / 100;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(rounded);
}

export function normalizeArabicSearch(text: string): string {
  return text
    .replace(/[أإآ]/g, "ا")
    .replace(/[ـ,٬]/g, "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_INDIC.indexOf(d)))
    .toLocaleLowerCase()
    .trim();
}

export function clampString(value: string, max: number): string {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function isValidCurrency(val: string): val is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(val);
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
    defaultCurrency: isValidCurrency(input.defaultCurrency ?? "") ? input.defaultCurrency! : "ريال",
    whatsappProvider: input.whatsappProvider === "external" ? "external" : "nasqo",
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
    category: isValidCategory(input.category ?? "") ? input.category! : "purchases",
    phone: clampString(input.phone ?? "", SCHEMA_LIMITS.phoneMax),
    creditLimit: safeLimit,
    currency: isValidCurrency(input.currency ?? "") ? input.currency! : "ريال",
    isCashAccount: Boolean(input.isCashAccount),
    accountImage: input.accountImage === "2" || input.accountImage === "3" ? input.accountImage : "1",
    sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 1,
    settlement: Boolean(input.settlement),
    documentNumberRequired: Boolean(input.documentNumberRequired),
    messageMethod: input.messageMethod === "whatsapp" ? "whatsapp" : "sms",
    sendMode: input.sendMode === "auto" || input.sendMode === "confirm" ? input.sendMode : "never",
    note: clampString(input.note ?? "", SCHEMA_LIMITS.accountNoteMax),
    openingBalance: safeOpening,
    openingDirection: input.openingDirection === "credit" ? "credit" : "debit",
    codeNumber: Number.isFinite(input.codeNumber) ? Number(input.codeNumber) : 1,
  };
}

export function sanitizeLedgerPayload(
  input: Partial<LedgerEntryRecord> & { ownerId: string; accountId: string; accountName: string },
) {
  const safeAmount = Math.max(0, parseArabicNumber(input.amount));
  const safeRate = Math.max(0.0001, parseArabicNumber(input.exchangeRate) || 1);
  return {
    ownerId: clampString(input.ownerId, SCHEMA_LIMITS.ownerIdMax),
    accountId: clampString(input.accountId, SCHEMA_LIMITS.ownerIdMax),
    accountName: clampString(input.accountName, SCHEMA_LIMITS.accountNameMax) || "حساب",
    counterpartAccountId: clampString(input.counterpartAccountId ?? "", SCHEMA_LIMITS.ownerIdMax),
    counterpartAccountName: clampString(input.counterpartAccountName ?? "", SCHEMA_LIMITS.accountNameMax),
    kind: isValidLedgerKind(input.kind ?? "") ? input.kind! : "voucher",
    typeLabel: clampString(input.typeLabel || "سند", SCHEMA_LIMITS.typeLabelMax) || "سند",
    payment: input.payment === "cash" || input.payment === "credit" ? input.payment : "balance",
    direction: input.direction === "credit" ? "credit" : "debit",
    amount: safeAmount,
    currency: isValidCurrency(input.currency ?? "") ? input.currency! : "ريال",
    exchangeRate: safeRate,
    details: clampString(input.details ?? "", SCHEMA_LIMITS.ledgerDetailsMax),
    documentNumber: clampString(input.documentNumber ?? "", SCHEMA_LIMITS.documentNumberMax),
    warehouseId: clampString(input.warehouseId ?? "", SCHEMA_LIMITS.ownerIdMax),
    warehouseName: clampString(input.warehouseName ?? "", SCHEMA_LIMITS.warehouseNameMax),
    invoiceContent:
      input.invoiceContent === "items" || input.invoiceContent === "free" ? input.invoiceContent : "none",
    entryNumber: Number.isFinite(input.entryNumber) ? Number(input.entryNumber) : 1,
    deleted: Boolean(input.deleted),
    entryDate:
      clampString(input.entryDate || new Date().toISOString().slice(0, 10), SCHEMA_LIMITS.entryDateMax) ||
      new Date().toISOString().slice(0, 10),
  };
}

export function sanitizeWarehousePayload(input: Partial<WarehouseRecord> & { ownerId: string; name: string }) {
  return {
    ownerId: clampString(input.ownerId, SCHEMA_LIMITS.ownerIdMax),
    name: clampString(input.name, SCHEMA_LIMITS.warehouseNameMax),
    details: clampString(input.details ?? "", SCHEMA_LIMITS.warehouseDetailsMax),
    isDefault: Boolean(input.isDefault),
    codeNumber: Number.isFinite(input.codeNumber) ? Number(input.codeNumber) : 1,
  };
}

export function sanitizeInventoryPayload(
  input: Partial<InventoryItemRecord> & { ownerId: string; name: string; warehouseId: string },
) {
  return {
    ownerId: clampString(input.ownerId, SCHEMA_LIMITS.ownerIdMax),
    name: clampString(input.name, SCHEMA_LIMITS.inventoryNameMax),
    unit: clampString(input.unit || "حبة", SCHEMA_LIMITS.inventoryUnitMax) || "حبة",
    quantity: Math.max(0, parseArabicNumber(input.quantity)),
    avgCost: Math.max(0, parseArabicNumber(input.avgCost)),
    warehouseId: clampString(input.warehouseId, SCHEMA_LIMITS.ownerIdMax),
  };
}

export type AccountSummary = {
  debitTotal: number;
  creditTotal: number;
  netBalance: number;
  tone: "credit" | "debit" | "neutral";
  entryCount: number;
};

export function affectsAccountBalance(entry: Pick<LedgerEntryRecord, "deleted" | "kind">): boolean {
  if (entry.deleted) return false;
  return entry.kind !== "quote" && entry.kind !== "order";
}

export function computeAccountSummary(
  account: AccountRecord,
  entries: readonly LedgerEntryRecord[],
  currencyFilter?: string,
): AccountSummary {
  let debitTotal = 0;
  let creditTotal = 0;
  let entryCount = 0;

  if (account.openingBalance > 0 && (!currencyFilter || currencyFilter === "الكل" || currencyFilter === account.currency)) {
    if (account.openingDirection === "credit") {
      creditTotal += account.openingBalance;
    } else {
      debitTotal += account.openingBalance;
    }
  }

  for (const entry of entries) {
    if (entry.deleted) continue;
    const isPrimary = entry.accountId === account.id;
    const isCounterpart = entry.counterpartAccountId === account.id && entry.counterpartAccountId !== "";
    if (!isPrimary && !isCounterpart) continue;

    if (
      currencyFilter &&
      currencyFilter !== "الكل" &&
      currencyFilter !== "جميع العملات بدون مصارفة" &&
      currencyFilter !== "مصارفة الكل بعملة ريال" &&
      entry.currency !== currencyFilter
    ) {
      continue;
    }

    entryCount += 1;
    if (!affectsAccountBalance(entry)) continue;

    const effectiveAmount =
      currencyFilter === "مصارفة الكل بعملة ريال" ? entry.amount * (entry.exchangeRate || 1) : entry.amount;

    if (isPrimary) {
      if (account.isCashAccount && entry.payment === "cash") {
        // Cash settlement washes both sides while preserving turnover totals.
        creditTotal += effectiveAmount;
        debitTotal += effectiveAmount;
      } else if (entry.direction === "credit") {
        creditTotal += effectiveAmount;
      } else {
        debitTotal += effectiveAmount;
      }
    } else if (isCounterpart) {
      // Counterpart in simple entry receives the opposite side.
      if (entry.direction === "credit") {
        debitTotal += effectiveAmount;
      } else {
        creditTotal += effectiveAmount;
      }
    }
  }

  const netSigned = creditTotal - debitTotal;
  const tone: "credit" | "debit" | "neutral" =
    Math.abs(netSigned) < 0.005 ? "neutral" : netSigned > 0 ? "credit" : "debit";

  return {
    debitTotal,
    creditTotal,
    netBalance: Math.abs(netSigned),
    tone,
    entryCount,
  };
}

export function computeCategoryTotals(
  accounts: readonly AccountRecord[],
  entries: readonly LedgerEntryRecord[],
): Record<AccountCategory, { netSigned: number; debitTotal: number; creditTotal: number; count: number }> {
  const result: Record<AccountCategory, { netSigned: number; debitTotal: number; creditTotal: number; count: number }> =
    {
      purchases: { netSigned: 0, debitTotal: 0, creditTotal: 0, count: 0 },
      sales: { netSigned: 0, debitTotal: 0, creditTotal: 0, count: 0 },
      clients: { netSigned: 0, debitTotal: 0, creditTotal: 0, count: 0 },
      employees: { netSigned: 0, debitTotal: 0, creditTotal: 0, count: 0 },
      transfers: { netSigned: 0, debitTotal: 0, creditTotal: 0, count: 0 },
      shop: { netSigned: 0, debitTotal: 0, creditTotal: 0, count: 0 },
    };

  for (const account of accounts) {
    const summary = computeAccountSummary(account, entries);
    const bucket = result[account.category];
    bucket.count += 1;
    bucket.debitTotal += summary.debitTotal;
    bucket.creditTotal += summary.creditTotal;
    bucket.netSigned += summary.creditTotal - summary.debitTotal;
  }

  return result;
}

export function computeStatementRows(
  account: AccountRecord,
  entries: readonly LedgerEntryRecord[],
  options: {
    currency?: string;
    searchQuery?: string;
    searchMode?: string;
    showPreviousBalance?: boolean;
  } = {},
): {
  rows: StatementRowWithBalance[];
  debitTotal: number;
  creditTotal: number;
  netBalance: number;
  netDirection: "credit" | "debit" | "neutral";
} {
  const currency = options.currency ?? "الكل";
  const query = normalizeArabicSearch(options.searchQuery ?? "");
  const searchMode = options.searchMode ?? "الكل";

  const relevant = entries
    .filter((entry) => {
      if (entry.deleted) return false;
      const belongs = entry.accountId === account.id || entry.counterpartAccountId === account.id;
      if (!belongs) return false;
      if (
        currency !== "الكل" &&
        currency !== "جميع العملات بدون مصارفة" &&
        currency !== "مصارفة الكل بعملة ريال" &&
        entry.currency !== currency
      ) {
        return false;
      }
      if (!query) return true;
      return ledgerEntryMatchesQuery(entry, query, searchMode);
    })
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.entryNumber - b.entryNumber);

  let running = options.showPreviousBalance
    ? account.openingDirection === "credit"
      ? account.openingBalance
      : -account.openingBalance
    : 0;
  let debitTotal = 0;
  let creditTotal = 0;

  const chronological: StatementRowWithBalance[] = relevant.map((entry) => {
    const isPrimary = entry.accountId === account.id;
    const amount =
      currency === "مصارفة الكل بعملة ريال" ? entry.amount * (entry.exchangeRate || 1) : entry.amount;

    if (affectsAccountBalance(entry)) {
      if (account.isCashAccount && entry.payment === "cash") {
        creditTotal += amount;
        debitTotal += amount;
      } else if (isPrimary) {
        if (entry.direction === "credit") {
          creditTotal += amount;
          running += amount;
        } else {
          debitTotal += amount;
          running -= amount;
        }
      } else {
        if (entry.direction === "credit") {
          debitTotal += amount;
          running -= amount;
        } else {
          creditTotal += amount;
          running += amount;
        }
      }
    }

    return {
      ...entry,
      runningBalance: account.isCashAccount ? 0 : Math.abs(running),
    };
  });

  // Newest entries appear at the top of statements cleanly
  const rows = [...chronological].reverse();
  const netSigned = creditTotal - debitTotal + (options.showPreviousBalance ? (account.openingDirection === "credit" ? account.openingBalance : -account.openingBalance) : 0);

  return {
    rows,
    debitTotal,
    creditTotal,
    netBalance: Math.abs(netSigned),
    netDirection: Math.abs(netSigned) < 0.005 ? "neutral" : netSigned > 0 ? "credit" : "debit",
  };
}

export function ledgerEntryMatchesQuery(entry: LedgerEntryRecord, normalizedQuery: string, mode: string): boolean {
  if (!normalizedQuery) return true;
  const amountText = String(entry.amount);
  const fields: Record<string, string> = {
    "الرقم": String(entry.entryNumber),
    "البيان": entry.details,
    "رقم المستند": entry.documentNumber,
    "اسم المرسل": entry.counterpartAccountName,
    "اسم المستلم": entry.accountName,
    "اسم الشركة": entry.warehouseName,
    "المبلغ عليه": entry.direction === "debit" ? amountText : "",
    "المبلغ له": entry.direction === "credit" ? amountText : "",
  };
  if (mode === "الكل") {
    return normalizeArabicSearch([...Object.values(fields), entry.typeLabel, entry.entryDate].join(" ")).includes(
      normalizedQuery,
    );
  }
  return normalizeArabicSearch(fields[mode] ?? "").includes(normalizedQuery);
}

export function accountMatchesQuery(account: AccountRecord, query: string): boolean {
  const needle = normalizeArabicSearch(query);
  if (!needle) return true;
  return normalizeArabicSearch(`${account.name} ${account.phone} ${account.codeNumber}`).includes(needle);
}

function escapeCsvCell(cell: string | number | boolean): string {
  const str = String(cell ?? "");
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvContent(headers: readonly string[], rows: readonly (readonly (string | number | boolean)[])[]): string {
  const headerLine = headers.map(escapeCsvCell).join(",");
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(","));
  return `\uFEFF${[headerLine, ...dataLines].join("\r\n")}`;
}

export function computeInventorySummary(items: readonly InventoryItemRecord[], warehouseId?: string) {
  const filtered = warehouseId ? items.filter((item) => item.warehouseId === warehouseId) : items;
  let totalQuantity = 0;
  let totalValue = 0;
  for (const item of filtered) {
    totalQuantity += item.quantity;
    totalValue += item.quantity * item.avgCost;
  }
  return {
    items: filtered,
    totalQuantity,
    totalValue,
  };
}

export type LowStockAlertItem = InventoryItemRecord & {
  warehouseName: string;
  severity: "critical" | "warning";
  stockValue: number;
};

export type DashboardSummary = {
  totalSales: number;
  salesInvoiceCount: number;
  salesAccountCount: number;
  recentInvoices: LedgerEntryRecord[];
  totalInvoicesCount: number;
  totalInvoicesVolume: number;
  lowStockItems: LowStockAlertItem[];
  totalInventoryItems: number;
  lowStockThreshold: number;
};

export function computeDashboardSummary(
  accounts: readonly AccountRecord[],
  entries: readonly LedgerEntryRecord[],
  warehouses: readonly WarehouseRecord[],
  inventory: readonly InventoryItemRecord[],
  options: {
    lowStockThreshold?: number;
    recentInvoicesLimit?: number;
    period?: "all" | "month" | "week";
    referenceDate?: Date;
  } = {},
): DashboardSummary {
  const lowStockThreshold = options.lowStockThreshold ?? 25;
  const recentInvoicesLimit = options.recentInvoicesLimit ?? 6;
  const period = options.period ?? "all";
  const refDate = options.referenceDate ?? new Date();

  const cutoffIso =
    period === "week"
      ? new Date(refDate.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
      : period === "month"
        ? new Date(refDate.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
        : "";

  const salesAccountIds = new Set(accounts.filter((a) => a.category === "sales").map((a) => a.id));
  const warehouseMap = new Map(warehouses.map((w) => [w.id, w.name]));

  let totalSales = 0;
  if (period === "all") {
    for (const acc of accounts) {
      if (acc.category === "sales" && acc.openingBalance > 0) {
        totalSales += acc.openingBalance;
      }
    }
  }

  let salesInvoiceCount = 0;
  let totalInvoicesVolume = 0;
  const activeInvoices: LedgerEntryRecord[] = [];

  for (const entry of entries) {
    if (entry.deleted) continue;
    if (cutoffIso && entry.entryDate < cutoffIso) continue;

    const isInvoiceDoc = entry.kind === "invoice" || entry.kind === "return";
    if (isInvoiceDoc) {
      activeInvoices.push(entry);
      if (entry.kind === "invoice") {
        totalInvoicesVolume += entry.amount;
      }
    }

    const isSaleEntry =
      salesAccountIds.has(entry.accountId) ||
      (entry.kind === "invoice" && entry.direction === "debit") ||
      (entry.kind === "return" && entry.direction === "credit" && salesAccountIds.has(entry.accountId));

    if (isSaleEntry) {
      if (entry.kind === "return") {
        totalSales = Math.max(0, totalSales - entry.amount);
      } else if (entry.kind === "invoice" || entry.kind === "voucher") {
        totalSales += entry.amount;
        if (entry.kind === "invoice") {
          salesInvoiceCount += 1;
        }
      }
    }
  }

  activeInvoices.sort(
    (a, b) =>
      b.entryDate.localeCompare(a.entryDate) ||
      b.createdAtMs - a.createdAtMs ||
      b.entryNumber - a.entryNumber,
  );

  const lowStockItems: LowStockAlertItem[] = inventory
    .filter((item) => item.quantity <= lowStockThreshold)
    .map((item) => ({
      ...item,
      warehouseName: warehouseMap.get(item.warehouseId) ?? "مخزن عام",
      severity: item.quantity <= Math.max(15, Math.floor(lowStockThreshold * 0.6)) ? ("critical" as const) : ("warning" as const),
      stockValue: item.quantity * item.avgCost,
    }))
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, "ar"));

  return {
    totalSales,
    salesInvoiceCount,
    salesAccountCount: salesAccountIds.size,
    recentInvoices: activeInvoices.slice(0, recentInvoicesLimit),
    totalInvoicesCount: activeInvoices.length,
    totalInvoicesVolume,
    lowStockItems,
    totalInventoryItems: inventory.length,
    lowStockThreshold,
  };
}

