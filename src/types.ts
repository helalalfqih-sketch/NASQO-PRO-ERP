export const CURRENCIES = ["ريال"] as const;
export type CurrencyCode = string;

export type CurrencyRecord = {
  id: number;
  code: string;
  name: string;
  symbol: string;
  ratePrimary: number;
  rateSecondary: number;
  nameSecondary: string;
  legacyId?: number;
};

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
  /** Optional fiscal period lock date (YYYY-MM-DD); posting or reversing on/before this date is rejected */
  closedUntilDate?: string;
};

export type AccountGroupRecord = {
  id: number;
  name: string;
  category: AccountCategory;
  currencyCode: CurrencyCode;
  hasBill?: boolean;
  isEmployee?: boolean;
  sortOrder: number;
  legacyId?: number;
};

export type AccountRecord = {
  id: string;
  ownerId: string;
  groupId?: number;
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
  /** stable reference to the legacy SQLite source row (`<sha12>:<table>:<id>`) */
  legacyRef?: string;
};

export type CashboxRecord = {
  id: number;
  name: string;
  details: string;
  currencyCode: CurrencyCode;
  state?: number;
  boxType?: number;
  sortOrder?: number;
  isActive?: boolean;
  legacyId?: number;
};

export type InvoiceLineInput = {
  lineKind?: "item" | "free";
  inventoryItemId?: string;
  warehouseId?: string;
  itemName: string;
  unit?: string;
  unitNum?: 1 | 2 | 3 | number;
  quantity: number;
  price: number;
  total: number;
  discount?: number;
  bonus?: number;
  details?: string;
  expiryDate?: string;
  /** Snapshot of Weighted Average Cost (WAC) per base unit at the time of posting */
  unitCostAtSale?: number;
  legacyId?: number;
};

export type LedgerEntryRecord = {
  id: string;
  ownerId: string;
  accountId: string;
  accountName: string;
  counterpartAccountId: string;
  counterpartAccountName: string;
  cashboxId?: number;
  kind: LedgerKind;
  typeLabel: string;
  payment: "cash" | "credit" | "balance";
  direction: "debit" | "credit";
  amount: number;
  rawDain?: number;
  rawMadin?: number;
  settledOnReceipt?: boolean;
  currency: CurrencyCode;
  exchangeRate: number;
  taxAmount?: number;
  discount?: number;
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
  sourceOrigin?: "native" | "smartpro_sql" | "legacy_sqlite";
  postingStatus?: "draft" | "posted" | "reversed" | "historical_unposted";
  /** Editable quote/order created locally; never posted to accounts or stock. */
  localDraft?: boolean;
  /** Explicit balanced SQLite journal legs; authoritative when present. */
  journalLines?: {accountId:string;debitMinor:number;creditMinor:number}[];
  stockPosting?: boolean;
  stockSale?: boolean;
  stockCostMinor?: number;
  returnableLines?: {itemId:string;itemName:string;unit:string;quantity:number}[];
  returnLines?: {itemId:string;quantity:number}[];
  taxRateBps?: number;
  netBeforeTax?: number;
  originalInvoiceId?: string;
  returnedById?: string;
  inventoryAccountId?: string;
  costAccountId?: string;
  taxAccountId?: string;
  idempotencyKey?: string;
  reversedEntryId?: string;
  reversalEntryId?: string;
  paidAmount?: number;
  docType?: number;
  lineCount?: number;
  lines?: InvoiceLineInput[];
  createdAtMs: number;
  legacyRef?: string;
};

export type WarehouseRecord = {
  id: string;
  ownerId: string;
  name: string;
  details: string;
  isDefault: boolean;
  codeNumber: number;
  legacyRef?: string;
};

export type InventoryItemRecord = {
  id: string;
  ownerId: string;
  name: string;
  unit: string;
  quantity: number;
  avgCost: number;
  /** Explicitly approved selling price; legacy products never receive an inferred value. */
  sellingPrice?: number;
  minThreshold?: number;
  sku?: string;
  unit2?: string;
  count2?: number;
  sprice2?: number;
  unit3?: string;
  count3?: number;
  sprice3?: number;
  defaultUnit?: number;
  currencyCode?: CurrencyCode;
  isActive?: boolean;
  expiryDate?: string;
  legacyId?: number;
  warehouseId: string;
  /** Live quantity computed from invoice_lines/transfers when static count is unverified */
  computedQuantity?: number;
  /** Unapproved historical invoice net by original warehouse, not an opening stock count. */
  legacyInvoiceQtyByWarehouse?: Record<string, number>;
  /** Pending historical reference, never available stock. */
  legacyHistoricalQtyByWarehouse?: Record<string, number>;
  legacyStockPending?: boolean;
  legacyTransferIncomplete?: boolean;
  legacyHistoryIncludesTransfers?: boolean;
  legacySourceItemId?: string;
  /** true when the quantity could not be derived from the legacy data and needs a manual stock count */
  quantityUnverified?: boolean;
  legacyRef?: string;
};

export type StatementRowWithBalance = LedgerEntryRecord & {
  runningBalance: number;
};
