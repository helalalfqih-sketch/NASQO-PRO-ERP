export const CURRENCIES = ["ريال", "دولار", "يورو", "عملة 2"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const ACCOUNT_CATEGORIES = [
  "purchases",
  "sales",
  "clients",
  "employees",
  "transfers",
  "shop",
] as const;
export type AccountCategory = (typeof ACCOUNT_CATEGORIES)[number];

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
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const EXPENSE_CATEGORIES = [
  "مشتريات بضائع",
  "مصروفات تشغيلية",
  "شحن ونقل",
  "رواتب وأجور",
  "صيانة ومرافق",
  "تسويق ومبيعات",
  "إيجار ومقر",
  "أخرى",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

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

export type WorkspaceSettings = {
  id: string;
  ownerId: string;
  companyName: string;
  defaultCurrency: CurrencyCode;
  whatsappProvider: "nasqo" | "external";
  whatsappInstantEnabled: boolean;
  whatsappPhone: string;
};

export type AccountRecord = {
  id: string;
  ownerId: string;
  name: string;
  category: AccountCategory;
  phone: string;
  creditLimit: number;
  currency: CurrencyCode;
  isCashAccount: boolean;
  accountImage: "1" | "2" | "3";
  sortOrder: number;
  settlement: boolean;
  documentNumberRequired: boolean;
  messageMethod: "sms" | "whatsapp";
  sendMode: "auto" | "confirm" | "never";
  note: string;
  openingBalance: number;
  openingDirection: "debit" | "credit";
  codeNumber: number;
};

export type LedgerEntryRecord = {
  id: string;
  ownerId: string;
  accountId: string;
  accountName: string;
  counterpartAccountId: string;
  counterpartAccountName: string;
  kind: LedgerKind;
  typeLabel: string;
  payment: "cash" | "credit" | "balance";
  direction: "debit" | "credit";
  amount: number;
  currency: CurrencyCode;
  exchangeRate: number;
  details: string;
  documentNumber: string;
  warehouseId: string;
  warehouseName: string;
  invoiceContent: "items" | "free" | "none";
  entryNumber: number;
  deleted: boolean;
  entryDate: string;
  dueDate?: string;
  expenseCategory?: string;
  deliveryDays?: number;
  createdAtMs: number;
};

export type WarehouseRecord = {
  id: string;
  ownerId: string;
  name: string;
  details: string;
  isDefault: boolean;
  codeNumber: number;
};

export type InventoryItemRecord = {
  id: string;
  ownerId: string;
  name: string;
  unit: string;
  quantity: number;
  avgCost: number;
  minThreshold?: number;
  sku?: string;
  warehouseId: string;
};

export type StatementRowWithBalance = LedgerEntryRecord & {
  runningBalance: number;
};
