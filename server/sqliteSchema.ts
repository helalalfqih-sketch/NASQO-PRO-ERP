export const SQLITE_SCHEMA_VERSION = 5;

export const UNIFIED_SQLITE_TABLES = [
  "workspaces",
  "currencies",
  "account_groups",
  "cashboxes",
  "accounts",
  "warehouses",
  "inventory_items",
  "ledger_entries",
  "invoice_lines",
  "journal_entries",
  "journal_entry_lines",
  "stock_transfers",
  "stock_transfer_lines",
  "price_offers",
  "price_offer_lines",
  "archived_documents",
  "archived_document_lines",
  "alerts",
  "erp_employees",
  "erp_leave_requests",
  "erp_deals",
  "erp_purchase_orders",
  "erp_boms",
  "erp_production_orders",
  "erp_cost_centers",
  "erp_meta",
  "backups",
  "legacy_imports",
  "legacy_users",
  "legacy_permissions",
  "audit_log",
] as const;

export type UnifiedSqliteTableName = (typeof UNIFIED_SQLITE_TABLES)[number];

export const UNIFIED_SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  default_currency TEXT NOT NULL DEFAULT 'ريال',
  whatsapp_provider TEXT NOT NULL DEFAULT 'nasqo',
  whatsapp_instant_enabled INTEGER NOT NULL DEFAULT 0,
  whatsapp_phone TEXT NOT NULL DEFAULT '',
  closed_until_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS currencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT '',
  rate_primary REAL NOT NULL DEFAULT 1,
  rate_secondary REAL NOT NULL DEFAULT 1,
  name_secondary TEXT NOT NULL DEFAULT '',
  legacy_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_currencies_ws ON currencies(workspace_id);

CREATE TABLE IF NOT EXISTS account_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('purchases','sales','clients','employees','transfers','shop')),
  currency_code TEXT NOT NULL DEFAULT 'ريال',
  has_bill INTEGER NOT NULL DEFAULT 0,
  is_employee INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  legacy_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_account_groups_ws ON account_groups(workspace_id);

CREATE TABLE IF NOT EXISTS cashboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  state INTEGER NOT NULL DEFAULT 1,
  currency_code TEXT NOT NULL DEFAULT 'ريال',
  box_type INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  legacy_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cashboxes_ws ON cashboxes(workspace_id);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES account_groups(id) ON DELETE SET NULL,
  code_number INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('purchases','sales','clients','employees','transfers','shop')),
  phone TEXT NOT NULL DEFAULT '',
  credit_limit REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ريال',
  is_cash_account INTEGER NOT NULL DEFAULT 0,
  account_image TEXT NOT NULL DEFAULT '1',
  sort_order INTEGER NOT NULL DEFAULT 1,
  settlement INTEGER NOT NULL DEFAULT 0,
  document_number_required INTEGER NOT NULL DEFAULT 0,
  message_method TEXT NOT NULL DEFAULT 'sms',
  send_mode TEXT NOT NULL DEFAULT 'never',
  tax_number TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  opening_balance REAL NOT NULL DEFAULT 0,
  opening_direction TEXT NOT NULL DEFAULT 'debit' CHECK(opening_direction IN ('debit','credit')),
  legacy_id INTEGER,
  legacy_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_ws ON accounts(workspace_id, category, sort_order, code_number);
CREATE INDEX IF NOT EXISTS idx_accounts_legacy ON accounts(workspace_id, legacy_id);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code_number INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 1,
  legacy_id INTEGER,
  legacy_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warehouses_ws ON warehouses(workspace_id, code_number);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  warehouse_id TEXT REFERENCES warehouses(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'حبة',
  quantity REAL NOT NULL DEFAULT 0,
  avg_cost REAL NOT NULL DEFAULT 0,
  selling_price REAL,
  min_threshold REAL DEFAULT 25,
  sku TEXT NOT NULL DEFAULT '',
  unit2 TEXT NOT NULL DEFAULT '',
  count2 REAL,
  sprice2 REAL,
  unit3 TEXT NOT NULL DEFAULT '',
  count3 REAL,
  sprice3 REAL,
  default_unit INTEGER NOT NULL DEFAULT 1,
  expiry_date TEXT,
  has_expiry INTEGER NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'ريال',
  bstate INTEGER NOT NULL DEFAULT 1,
  quantity_unverified INTEGER NOT NULL DEFAULT 0,
  legacy_id INTEGER,
  legacy_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_ws ON inventory_items(workspace_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_legacy ON inventory_items(workspace_id, legacy_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  account_name TEXT NOT NULL,
  counterpart_account_id TEXT NOT NULL DEFAULT '',
  counterpart_account_name TEXT NOT NULL DEFAULT '',
  cashbox_id INTEGER REFERENCES cashboxes(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('voucher','invoice','return','quote','order','transfer','currency','simple-entry','opening')),
  type_label TEXT NOT NULL,
  payment TEXT NOT NULL CHECK(payment IN ('cash','credit','balance')),
  direction TEXT NOT NULL CHECK(direction IN ('debit','credit')),
  amount REAL NOT NULL DEFAULT 0,
  raw_dain REAL,
  raw_madin REAL,
  settled_on_receipt INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ريال',
  exchange_rate REAL NOT NULL DEFAULT 1,
  details TEXT NOT NULL DEFAULT '',
  document_number TEXT NOT NULL DEFAULT '',
  warehouse_id TEXT NOT NULL DEFAULT '',
  warehouse_name TEXT NOT NULL DEFAULT '',
  invoice_content TEXT NOT NULL DEFAULT 'none' CHECK(invoice_content IN ('items','free','none')),
  entry_number INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  entry_date TEXT NOT NULL,
  due_date TEXT,
  expense_category TEXT,
  delivery_days INTEGER,
  sender TEXT NOT NULL DEFAULT '',
  receiver TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  discount REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  bonus REAL NOT NULL DEFAULT 0,
  doc_type INTEGER,
  bstate INTEGER,
  source_origin TEXT NOT NULL DEFAULT 'native',
  posting_status TEXT NOT NULL DEFAULT 'posted',
  idempotency_key TEXT,
  request_fingerprint TEXT,
  reversed_entry_id TEXT,
  reversal_entry_id TEXT,
  paid_amount REAL NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  legacy_id INTEGER,
  legacy_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_ws_deleted ON ledger_entries(workspace_id, deleted, entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_acc ON ledger_entries(workspace_id, account_id, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_num ON ledger_entries(workspace_id, entry_number);
CREATE INDEX IF NOT EXISTS idx_ledger_legacy ON ledger_entries(workspace_id, legacy_id);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  line_kind TEXT NOT NULL DEFAULT 'item' CHECK(line_kind IN ('item','free')),
  inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  warehouse_id TEXT REFERENCES warehouses(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  bonus REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  unit_num INTEGER NOT NULL DEFAULT 1,
  unit_cost_at_sale REAL NOT NULL DEFAULT 0,
  details TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  legacy_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_inv_lines_entry ON invoice_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_inv_lines_item ON invoice_lines(workspace_id, inventory_item_id);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entry_number INTEGER NOT NULL DEFAULT 1,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'ريال',
  exchange_rate REAL NOT NULL DEFAULT 1,
  posting_status TEXT NOT NULL DEFAULT 'posted' CHECK(posting_status IN ('draft','posted','reversed')),
  idempotency_key TEXT,
  request_fingerprint TEXT,
  reversed_journal_id TEXT,
  reversal_journal_id TEXT,
  total_debit_minor INTEGER NOT NULL DEFAULT 0,
  total_credit_minor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_ws ON journal_entries(workspace_id, entry_date);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  journal_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  account_name TEXT NOT NULL DEFAULT '',
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK(debit_minor >= 0),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_minor >= 0),
  description TEXT NOT NULL DEFAULT '',
  CHECK((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_journal ON journal_entry_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_acc ON journal_entry_lines(workspace_id, account_id);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_warehouse_id TEXT REFERENCES warehouses(id) ON DELETE SET NULL,
  to_warehouse_id TEXT REFERENCES warehouses(id) ON DELETE SET NULL,
  raw_from_store_id INTEGER,
  raw_to_store_id INTEGER,
  details TEXT NOT NULL DEFAULT '',
  transfer_date TEXT NOT NULL DEFAULT '',
  transfer_type INTEGER NOT NULL DEFAULT 1,
  user_legacy_id INTEGER,
  legacy_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_ws ON stock_transfers(workspace_id);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  raw_prod_id INTEGER,
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  unit_num INTEGER NOT NULL DEFAULT 1,
  details TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  legacy_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_tx ON stock_transfer_lines(transfer_id);

CREATE TABLE IF NOT EXISTS price_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  raw_acc_id INTEGER,
  name TEXT NOT NULL DEFAULT '',
  offer_type INTEGER NOT NULL DEFAULT 1,
  dain REAL NOT NULL DEFAULT 0,
  madin REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ريال',
  offer_date TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  bonus REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  legacy_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_price_offers_ws ON price_offers(workspace_id);

CREATE TABLE IF NOT EXISTS price_offer_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL REFERENCES price_offers(id) ON DELETE CASCADE,
  line_kind TEXT NOT NULL DEFAULT 'item' CHECK(line_kind IN ('item','free')),
  inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  raw_prod_id INTEGER,
  price REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  unit_num INTEGER NOT NULL DEFAULT 1,
  details TEXT NOT NULL DEFAULT '',
  legacy_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_price_offer_lines_offer ON price_offer_lines(offer_id);

CREATE TABLE IF NOT EXISTS archived_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  legacy_id INTEGER NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  raw_acc_id INTEGER,
  account_name TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  currency_name TEXT NOT NULL DEFAULT 'ريال',
  box_name TEXT NOT NULL DEFAULT '',
  doc_type INTEGER,
  bstate INTEGER,
  dain REAL NOT NULL DEFAULT 0,
  madin REAL NOT NULL DEFAULT 0,
  doc_date TEXT NOT NULL DEFAULT '',
  bill_no TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  sender TEXT NOT NULL DEFAULT '',
  receiver TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  discount REAL NOT NULL DEFAULT 0,
  bonus REAL NOT NULL DEFAULT 0,
  curprice TEXT NOT NULL DEFAULT '',
  cbox_id INTEGER,
  discount_amount REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_archived_docs_ws ON archived_documents(workspace_id, legacy_id);

CREATE TABLE IF NOT EXISTS archived_document_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  archived_doc_id INTEGER NOT NULL REFERENCES archived_documents(id) ON DELETE CASCADE,
  line_kind TEXT NOT NULL DEFAULT 'item' CHECK(line_kind IN ('item','free')),
  inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  raw_prod_id INTEGER,
  warehouse_id TEXT REFERENCES warehouses(id) ON DELETE SET NULL,
  raw_store_id INTEGER,
  price REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  bonus REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  unit_num INTEGER NOT NULL DEFAULT 1,
  details TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  legacy_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_archived_doc_lines_doc ON archived_document_lines(archived_doc_id);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  raw_per_id INTEGER,
  alert_date TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  legacy_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alerts_ws ON alerts(workspace_id);

CREATE TABLE IF NOT EXISTS erp_employees (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT,
  name TEXT NOT NULL,
  role_title TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  basic_salary REAL NOT NULL DEFAULT 0,
  allowances REAL NOT NULL DEFAULT 0,
  deductions REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  hire_date TEXT NOT NULL DEFAULT '',
  leave_balance_days INTEGER NOT NULL DEFAULT 0,
  attendance_today TEXT NOT NULL DEFAULT 'present',
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS erp_leave_requests (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  days INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS erp_deals (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  client_account_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ريال',
  stage TEXT NOT NULL DEFAULT 'lead',
  probability INTEGER NOT NULL DEFAULT 50,
  expected_close_date TEXT NOT NULL DEFAULT '',
  assigned_to TEXT NOT NULL DEFAULT '',
  converted_invoice_entry_id TEXT,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS erp_purchase_orders (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  supplier_account_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  warehouse_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ريال',
  order_date TEXT NOT NULL,
  expected_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  lines_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  posted_ledger_entry_id TEXT,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS erp_boms (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  finished_item_id TEXT NOT NULL,
  finished_item_name TEXT NOT NULL,
  finished_unit TEXT NOT NULL DEFAULT 'حبة',
  components_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS erp_production_orders (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  bom_id TEXT NOT NULL,
  bom_name TEXT NOT NULL,
  finished_item_id TEXT NOT NULL,
  finished_item_name TEXT NOT NULL,
  quantity_to_produce REAL NOT NULL DEFAULT 0,
  warehouse_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  created_date TEXT NOT NULL,
  completed_date TEXT,
  cost_center_id TEXT,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS erp_cost_centers (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  manager_name TEXT NOT NULL DEFAULT '',
  budget REAL NOT NULL DEFAULT 0,
  extra_posted_spend REAL NOT NULL DEFAULT 0,
  linked_categories_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS erp_meta (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  last_payroll_run_month TEXT,
  vat_config_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  accounts_count INTEGER NOT NULL DEFAULT 0,
  ledger_count INTEGER NOT NULL DEFAULT 0,
  warehouses_count INTEGER NOT NULL DEFAULT 0,
  inventory_count INTEGER NOT NULL DEFAULT 0,
  exported_at_iso TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_ws ON backups(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS legacy_imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_format TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  tables_count INTEGER NOT NULL DEFAULT 0,
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL,
  notes_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (workspace_id, source_sha256)
);

CREATE TABLE IF NOT EXISTS legacy_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  legacy_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  role_id INTEGER NOT NULL DEFAULT 1,
  password_present INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS legacy_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  legacy_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  flags_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  action TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ws ON audit_log(workspace_id, id DESC);
`;

export const SQLITE_SCHEMA_V2 = 2;
export const SQLITE_SCHEMA_V3 = 3;
export const SQLITE_SCHEMA_MIGRATION_V2_DDL = `
CREATE INDEX IF NOT EXISTS idx_inv_lines_ws_entry ON invoice_lines(workspace_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_stock_tx_lines_item ON stock_transfer_lines(workspace_id, inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_wh ON stock_transfers(workspace_id, from_warehouse_id, to_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_ledger_acc_curr ON ledger_entries(workspace_id, account_id, deleted, currency);
CREATE INDEX IF NOT EXISTS idx_ledger_doc_type ON ledger_entries(workspace_id, doc_type, deleted);
CREATE INDEX IF NOT EXISTS idx_accounts_ws_group ON accounts(workspace_id, group_id, sort_order);
`;
export const SQLITE_SCHEMA_MIGRATION_V3_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_idempotency
  ON ledger_entries(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_idempotency
  ON journal_entries(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
`;
