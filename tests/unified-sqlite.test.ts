import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  amountToArabicWords,
  computeAccountGroupsSummary,
  computeAccountSummary,
  computeCategoryTotals,
  computeStatementRows,
  computeTrialBalanceReport,
} from "../src/accounting.ts";
import { importLegacySqliteIntoUnifiedDb } from "../server/legacySqliteImporter.ts";
import { importSmartProSqlDump } from "../server/smartproSqlImporter.ts";
import {
  DEFAULT_WORKSPACE_ID,
  SqliteValidationError,
  batchUpdateInventoryItemRows,
  closeSqliteDb,
  deleteAccountRow,
  deleteLedgerEntryRow,
  ensureEmptyWorkspace,
  ensureStarterWorkspace,
  exportCleanSqliteSnapshotBytes,
  exportWorkspaceJsonBackup,
  fetchInvoiceDetail,
  getCashboxesReport,
  getDbStats,
  getFullWorkspaceBundle,
  getInventoryMovementsReport,
  getProductPriceStats,
  getSqliteDb,
  insertInventoryItemRow,
  insertLedgerEntryRow,
  listUnifiedTablesMeta,
  loadErpDataRows,
  postDraftLedgerEntryRow,
  queryUnifiedTable,
  resetWorkspaceToEmpty,
  restoreUnifiedJsonBundle,
  reverseLedgerEntryRow,
  saveErpDataRows,
  setLedgerDeletedRow,
  updateLedgerEntryRow,
  upsertAccountGroupRow,
  upsertAccountRow,
  upsertWarehouseRow,
} from "../server/sqliteDb.ts";

function makeTempDbPath(): { dir: string; filePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nasqo-sqlite-test-"));
  return { dir, filePath: path.join(dir, "test.sqlite") };
}

test("1. unified SQLite engine initializes cleanly, enforces foreign keys, and isolates workspaces", async () => {
  const { dir, filePath } = makeTempDbPath();
  try {
    const db = getSqliteDb(filePath);
    ensureStarterWorkspace(db, DEFAULT_WORKSPACE_ID, "اختبار رئيسي");
    ensureStarterWorkspace(db, "ws_second", "مساحة ثانية");

    const bundleA = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const bundleB = getFullWorkspaceBundle(db, "ws_second");
    assert.equal(bundleA.workspace.companyName, "نشاط اختبار رئيسي");
    assert.equal(bundleB.workspace.companyName, "نشاط مساحة ثانية");
    assert.ok(bundleA.accounts.length >= 9);
    assert.ok(bundleA.inventory.length >= 7);

    // Insert into A must not leak into B
    const createdAcc = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
      name: "مؤسسة الأفق",
      category: "clients",
      phone: "0550001122",
      creditLimit: 50000,
    });
    const entry = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: createdAcc.id,
      accountName: createdAcc.name,
      kind: "invoice",
      typeLabel: "فاتورة بيع",
      payment: "credit",
      direction: "debit",
      amount: 12500,
      entryNumber: 9001,
      entryDate: "2026-11-16",
      details: "بيع تجريبي",
    });
    assert.equal(entry.amount, 12500);

    const afterA = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const afterB = getFullWorkspaceBundle(db, "ws_second");
    assert.ok(afterA.accounts.some((a) => a.id === createdAcc.id));
    assert.ok(!afterB.accounts.some((a) => a.id === createdAcc.id));

    // Foreign key violation test: inserting entry with non-existent account must throw
    assert.throws(() => {
      insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
        accountId: "nonexistent_acc",
        accountName: "وهمي",
        amount: 100,
      });
    });

    // Export clean SQLite snapshot binary
    const snapFile = path.join(dir, "exported.sqlite");
    const snapBytes = await exportCleanSqliteSnapshotBytes(db, snapFile);
    assert.equal(Buffer.from(snapBytes.subarray(0, 15)).toString("ascii"), "SQLite format 3");
    assert.ok(snapBytes.length > 4096);
  } finally {
    closeSqliteDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("2. SmartPro SQL dump parser & importer maps all entities, invoice lines, cash washes, and anomalies", () => {
  const { dir, filePath } = makeTempDbPath();
  try {
    const db = getSqliteDb(filePath);
    const sampleDump = `
CREATE TABLE \`currencies\` (\`id\` int(11), \`name\` text, \`sympol\` text, \`amount\` text, \`amount2\` varchar(100), \`name2\` text, \`user_id\` int(11));
INSERT INTO \`currencies\` VALUES (1,'ريال','ر.ي','1','1','',1);
CREATE TABLE \`boxes\` (\`id\` int(11), \`name\` text, \`cur_id\` int(11), \`has_bill\` int(1), \`is_emp\` int(1), \`img\` text, \`user_id\` int(11), \`ord\` int(11));
INSERT INTO \`boxes\` VALUES (1,'المبيعات',1,0,0,'1',1,1),(2,'المشتريات',1,0,0,'1',1,2);
CREATE TABLE \`cboxes\` (\`id\` int(11), \`name\` text, \`details\` text, \`state\` int(11), \`user_id\` int(11), \`cur\` int(11), \`type\` int(11), \`ord\` int(11));
INSERT INTO \`cboxes\` VALUES (1,'الصندوق الرئيسي','',1,1,1,1,0);
CREATE TABLE \`stores\` (\`id\` bigint(20), \`name\` text, \`details\` text, \`state\` int(11));
INSERT INTO \`stores\` VALUES (1,'المخزن الرئيسي','',1),(4,'بينون','',1);
CREATE TABLE \`users\` (\`id\` int(11), \`name\` text, \`username\` text, \`password\` text, \`role_id\` int(11));
INSERT INTO \`users\` VALUES (1,'مدير','admin','secret-do-not-leak',1);
CREATE TABLE \`prems\` (\`id\` int(11), \`name\` text, \`add_box\` int(1));
INSERT INTO \`prems\` VALUES (1,'كامل',1);
CREATE TABLE \`accounts\` (\`id\` int(11), \`name\` text, \`phone\` text, \`details\` text, \`lim\` varchar(50), \`box_id\` int(11), \`user_id\` int(11), \`msg\` int(11), \`msgway\` int(11), \`tax\` varchar(100));
INSERT INTO \`accounts\` VALUES (10,'عميل الاختبار','777000111','ملاحظة \\'مقتبسة\\'','50000',1,1,2,2,'TAX-1'),(20,'مورد نقد','777000222','','0',2,1,0,1,'');
CREATE TABLE \`products\` (\`id\` bigint(20), \`name\` text, \`sell_price\` varchar(100), \`buy_price\` varchar(100), \`barcode\` text, \`unit\` varchar(20), \`exdate\` datetime, \`unit2\` varchar(50), \`unit3\` varchar(50), \`count2\` varchar(10), \`count3\` varchar(10), \`sprice2\` varchar(100), \`sprice3\` varchar(100), \`defunit\` int(11), \`dated\` int(11), \`cur\` int(11), \`bstate\` int(11));
INSERT INTO \`products\` VALUES (101,'كابل شحن','1500','900','BAR-101','حبة',NULL,'','','','','','',1,0,1,1);
CREATE TABLE \`bounds\` (\`id\` int(11), \`dain\` text, \`madin\` text, \`date\` date, \`acc_id\` int(11), \`cur_id\` int(11), \`bill\` text, \`user_id\` int(11), \`details\` text, \`img\` text, \`doc_type\` int(11), \`ref\` text, \`recever\` text, \`sender\` text, \`comp\` text, \`bonus\` varchar(50), \`discount\` varchar(50), \`bstate\` int(11), \`added\` varchar(100), \`added2\` varchar(100), \`curprice\` varchar(100), \`cboxid\` int(11), \`discount_amount\` varchar(100));
INSERT INTO \`bounds\` VALUES (501,'3000','0','2026-11-15',10,1,'B-501',1,'بيع آجل','','2','','','','','0','0',1,'','','1',0,'0'),(502,'1500','1500','2026-11-16',20,3,'B-502',1,'','','3','','','','','0','0',1,'','','1',1,'0');
CREATE TABLE \`bill_details\` (\`id\` int(11), \`bill_id\` int(11), \`prod_id\` bigint(20), \`price\` varchar(1000), \`amount\` varchar(50), \`total\` varchar(1000), \`details\` text, \`unit\` varchar(20), \`store_id\` bigint(20), \`discount\` varchar(50), \`bonus\` varchar(50), \`unitnum\` int(11), \`exdate\` varchar(20));
INSERT INTO \`bill_details\` VALUES (1,501,101,'1500','2','3000','','حبة',4,'0','0',1,''),(2,502,101,'900','1','1500','','حبة',1,'0','0',1,'');
CREATE TABLE \`bill_details2\` (\`id\` bigint(20), \`bill_id\` int(11), \`price\` varchar(1000), \`amount\` varchar(50), \`unit\` varchar(50), \`total\` varchar(1000), \`details\` text, \`discount\` varchar(50), \`bonus\` varchar(50));
INSERT INTO \`bill_details2\` VALUES (1,502,'600','1','خدمة','600','تغليف وشحن','0','0');
CREATE TABLE \`store_trans\` (\`id\` int(11), \`store_id1\` int(11), \`store_id2\` int(11), \`details\` text, \`date\` date, \`user_id\` int(11), \`type\` int(11));
INSERT INTO \`store_trans\` VALUES (1,0,4,'جرد','2026-11-01',1,3);
CREATE TABLE \`trans_details\` (\`id\` int(11), \`amount\` varchar(50), \`unit\` varchar(50), \`details\` text, \`bill_id\` int(11), \`prod_id\` bigint(11), \`unitnum\` int(11), \`exdate\` varchar(20));
INSERT INTO \`trans_details\` VALUES (1,'10','حبة','',1,101,1,'');
CREATE TABLE \`offers\` (\`id\` int(11), \`acc_id\` int(11), \`dain\` text, \`madin\` text, \`date\` date, \`cur_id\` int(11), \`details\` text, \`user_id\` int(11), \`name\` varchar(100), \`type\` int(11), \`bonus\` varchar(50), \`discount\` varchar(50));
CREATE TABLE \`offer_bill_details\` (\`id\` int(11), \`bill_id\` int(11), \`prod_id\` bigint(20), \`price\` varchar(1000), \`amount\` varchar(1000), \`total\` varchar(1000), \`unit\` varchar(20), \`details\` text, \`unitnum\` int(11));
CREATE TABLE \`offer_sbill_details\` (\`id\` bigint(20), \`bill_id\` int(11), \`price\` varchar(1000), \`amount\` varchar(50), \`unit\` varchar(50), \`total\` varchar(1000), \`details\` text);
CREATE TABLE \`bin\` (\`id\` int(11), \`per_id\` int(11), \`dain\` text, \`madin\` text, \`details\` text, \`date\` date, \`bill\` text, \`cur\` int(11), \`bill_type\` int(11), \`img\` text, \`ref\` text, \`bonus\` varchar(50), \`discount\` varchar(50), \`sender\` text, \`recever\` text, \`comp\` text, \`bstate\` int(11), \`added\` text, \`added2\` text, \`curprice\` varchar(50), \`cboxid\` int(11), \`pername\` text, \`curname\` text, \`boxname\` text, \`discount_amount\` varchar(100));
INSERT INTO \`bin\` VALUES (9,10,'500','0','ملغي','2026-11-10','',1,2,'','','0','0','','','','1','','','',0,'عميل الاختبار','ريال','المبيعات','0');
CREATE TABLE \`bin_bill_details\` (\`id\` int(11), \`bill_id\` int(11), \`prod_id\` bigint(20), \`price\` text, \`amount\` int(11), \`total\` text, \`details\` text, \`unit\` text, \`store_id\` int(11), \`discount\` text, \`bonus\` text, \`unitnum\` int(11), \`exdate\` text);
CREATE TABLE \`bin_bill_details2\` (\`id\` int(11), \`bill_id\` int(11), \`price\` text, \`amount\` int(11), \`unit\` text, \`total\` text, \`details\` text, \`discount\` text, \`bonus\` text);
CREATE TABLE \`alerts\` (\`id\` int(11), \`mdate\` date, \`det\` text, \`per_id\` int(11));
INSERT INTO \`alerts\` VALUES (1,'2026-11-20','متابعة تحصيل',10);
`;

    const report = importSmartProSqlDump(db, sampleDump, { workspaceId: DEFAULT_WORKSPACE_ID, replaceExisting: true });
    assert.equal(report.skippedDuplicate, false);
    assert.equal(report.imported.accounts, 2);
    assert.equal(report.imported.warehouses, 2);
    assert.equal(report.imported.inventoryItems, 1);
    assert.equal(report.imported.ledgerEntries, 2);
    assert.equal(report.imported.invoiceLines, 3);
    assert.equal(report.imported.stockTransfers, 1);
    assert.equal(report.imported.archivedDocuments, 1);
    assert.equal(report.anomalies.missingCurrencyIds["3"], 1);
    assert.equal(report.anomalies.missingTransferStoreRefs, 1);

    // Duplicate import skipped safely unless replaceExisting=true
    const dupReport = importSmartProSqlDump(db, sampleDump, { workspaceId: DEFAULT_WORKSPACE_ID, replaceExisting: false });
    assert.equal(dupReport.skippedDuplicate, true);

    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const invItem = bundle.inventory[0];
    assert.equal(invItem.sellingPrice, 1500);
    assert.equal(invItem.avgCost, 900);
    assert.equal(invItem.quantityUnverified, true);
    assert.equal(invItem.warehouseId, "sp_wh_4"); // Most frequently used in bill_details!

    // Invoice lines query
    const detail = fetchInvoiceDetail(db, DEFAULT_WORKSPACE_ID, "502");
    assert.ok(detail);
    assert.equal(detail!.lines.length, 2);
    assert.equal(detail!.entry.settledOnReceipt, true);

    // Cash wash arithmetic keeps zero net balance on settled cash supplier
    const cashAcc = bundle.accounts.find((a) => a.name === "مورد نقد")!;
    const cashSum = computeAccountSummary(cashAcc, bundle.ledger);
    assert.equal(cashSum.netBalance, 0);
    assert.equal(cashSum.debitTotal, 1500);
    assert.equal(cashSum.creditTotal, 1500);

    // Single-pass category totals equivalence
    const catTotals = computeCategoryTotals(bundle.accounts, bundle.ledger);
    assert.equal(catTotals.sales.debitTotal, 3000);
    assert.equal(catTotals.sales.netSigned, -3000);

    // Verify table inspector hides user password
    const usersPage = queryUnifiedTable(db, DEFAULT_WORKSPACE_ID, "legacy_users", "", 20, 0);
    assert.equal(usersPage.total, 1);
    assert.ok(!usersPage.columns.includes("password"));
    assert.ok(listUnifiedTablesMeta(db, DEFAULT_WORKSPACE_ID).length >= 25);

    // Save ERP & stock reconciliation updates
    saveErpDataRows(db, DEFAULT_WORKSPACE_ID, {
      ...bundle.erpData,
      lastPayrollRunMonth: "2026-11",
    });
    batchUpdateInventoryItemRows(db, DEFAULT_WORKSPACE_ID, [
      { item: invItem, quantity: 14, sellingPrice: 1650, quantityUnverified: false },
    ]);
    const refreshed = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    assert.equal(refreshed.erpData.lastPayrollRunMonth, "2026-11");
    assert.equal(refreshed.inventory[0].quantity, 14);
    assert.equal(refreshed.inventory[0].quantityUnverified, undefined);
    assert.equal(getDbStats(db, DEFAULT_WORKSPACE_ID).invoiceLinesCount, 3);
  } finally {
    closeSqliteDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("3. legacy SQLite binary import runs into the single unified SQLite DB cleanly", () => {
  const { dir, filePath } = makeTempDbPath();
  const srcPath = path.join(dir, "legacy-source.sqlite");
  try {
    const srcDb = new DatabaseSync(srcPath);
    srcDb.exec(`
      CREATE TABLE boxes (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, type INTEGER, phone TEXT, lim REAL);
      CREATE TABLE stores (id INTEGER PRIMARY KEY, name TEXT, details TEXT, state INTEGER);
      CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, barcode TEXT, unit TEXT, price REAL, price2 REAL);
      CREATE TABLE currencies (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE input_move (id INTEGER PRIMARY KEY, bill TEXT, per_id INTEGER, bill_type INTEGER, bstate INTEGER, year INTEGER, month INTEGER, day INTEGER, dain REAL, madin REAL, cur INTEGER, details TEXT);
      CREATE TABLE bill_details (id INTEGER PRIMARY KEY, bill_id INTEGER, prod_id INTEGER, store_id INTEGER, unit TEXT, amount REAL, price REAL, discount REAL, total REAL);
      CREATE TABLE bill_details2 (id INTEGER PRIMARY KEY, bill_id INTEGER, details TEXT, total REAL);
      INSERT INTO boxes VALUES (1, 'العملاء');
      INSERT INTO customers VALUES (10, 'عميل أرشيف قديم', 1, '777123456', 0);
      INSERT INTO stores VALUES (3, 'مستودع قديم', '', 1);
      INSERT INTO products VALUES (20, 'فلتر قديم', 'BAR-OLD', 'حبة', 150, 100);
      INSERT INTO currencies VALUES (1, 'ريال');
      INSERT INTO input_move VALUES (30, 'INV-OLD', 10, 2, 1, 2026, 11, 15, 300, 0, 1, 'فاتورة أرشيفية');
      INSERT INTO bill_details VALUES (40, 30, 20, 3, 'حبة', 2, 150, 0, 300);
    `);
    srcDb.close();

    const uploadBytes = new Uint8Array(fs.readFileSync(srcPath));
    const db = getSqliteDb(filePath);
    const out = importLegacySqliteIntoUnifiedDb(db, uploadBytes, {
      workspaceId: DEFAULT_WORKSPACE_ID,
      fileName: "legacy-source.sqlite",
    });
    assert.equal(out.integrity, "ok");
    assert.equal(out.added.accounts, 1);
    assert.equal(out.added.warehouses, 1);
    assert.equal(out.added.inventory, 1);
    assert.equal(out.added.ledger, 1);
    assert.equal(out.added.invoiceLines, 1);

    const detail = fetchInvoiceDetail(db, DEFAULT_WORKSPACE_ID, "30");
    assert.ok(detail);
    assert.equal(detail!.lines[0].itemName, "فلتر قديم");

    // Verify statement rows computation handles settled cash properly
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const acc = bundle.accounts.find((a) => a.name === "عميل أرشيف قديم")!;
    const st = computeStatementRows(acc, bundle.ledger);
    assert.equal(st.rows.length, 1);
  } finally {
    closeSqliteDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("4. multi-line native invoice persistence, cashbox mapping, currency-scoped category totals, and Arabic tafqeet", () => {
  const { dir, filePath } = makeTempDbPath();
  try {
    const db = getSqliteDb(filePath);
    ensureStarterWorkspace(db, DEFAULT_WORKSPACE_ID, "تست");
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    assert.ok(bundle.cashboxes.length >= 1);
    const cashbox = bundle.cashboxes[0];
    const item = bundle.inventory[0];
    const supplier = bundle.accounts.find((a) => a.category === "purchases")!;

    // Insert a currency-2 entry on supplier and ensure computeCategoryTotals('ريال') isolates it
    const createdRiyal = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: supplier.id,
      accountName: supplier.name,
      cashboxId: cashbox.id,
      kind: "invoice",
      typeLabel: "فاتورة شراء آجلة",
      payment: "credit",
      direction: "credit",
      amount: 3000,
      currency: "ريال",
      entryNumber: 8801,
      entryDate: "2026-11-17",
      details: "[ صنف تجريبي ]",
      lines: [
        {
          inventoryItemId: item.id,
          warehouseId: item.warehouseId,
          itemName: item.name,
          unit: item.unit,
          quantity: 2,
          price: 1500,
          total: 3000,
        },
      ],
    });
    assert.equal(createdRiyal.lineCount, 1);
    const invDetail = fetchInvoiceDetail(db, DEFAULT_WORKSPACE_ID, createdRiyal.id);
    assert.equal(invDetail?.lines.length, 1);
    assert.equal(invDetail?.lines[0].itemName, item.name);

    const priceStats = getProductPriceStats(db, DEFAULT_WORKSPACE_ID, item.id);
    assert.equal(priceStats.lastPrice, 1500);
    assert.equal(priceStats.lastPurchasePrice, 1500);
    assert.equal(priceStats.minPrice, 1500);
    assert.equal(priceStats.maxPrice, 1500);

    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: supplier.id,
      accountName: supplier.name,
      kind: "voucher",
      typeLabel: "له (سند)",
      payment: "balance",
      direction: "credit",
      amount: 2000,
      currency: "عملة 2",
      entryNumber: 8802,
      entryDate: "2026-11-17",
    });

    const after = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const totalsRiyal = computeCategoryTotals(after.accounts, after.ledger, "ريال");
    const totalsAll = computeCategoryTotals(after.accounts, after.ledger);
    assert.equal(totalsAll.purchases.creditTotal - totalsRiyal.purchases.creditTotal, 2000);

    // Partner purchase sub-group maps cleanly to shop, NOT purchases
    const samplePartnerSql = `
CREATE TABLE \`boxes\` (\`id\` int(11), \`name\` text, \`cur_id\` int(11), \`has_bill\` int(1), \`is_emp\` int(1), \`img\` text, \`user_id\` int(11), \`ord\` int(1));
INSERT INTO \`boxes\` VALUES (2,'المشتريات',1,0,0,'1',1,1),(8,'مشتريات هلال وحسين',1,0,0,'1',1,2);
CREATE TABLE \`accounts\` (\`id\` int(11), \`name\` text, \`phone\` text, \`details\` text, \`lim\` varchar(50), \`box_id\` int(11), \`user_id\` int(11), \`msg\` int(11), \`msgway\` int(11), \`tax\` varchar(100));
INSERT INTO \`accounts\` VALUES (1,'مورد حقيقي','','','0',2,1,0,1,''),(2,'حسين مشتريات بضاعة المحل','','','0',8,1,0,1,'');
`;
    importSmartProSqlDump(db, samplePartnerSql, { workspaceId: "ws_groups_test", replaceExisting: true });
    const gBundle = getFullWorkspaceBundle(db, "ws_groups_test");
    assert.equal(gBundle.accounts.filter((a) => a.category === "purchases").length, 1);
    assert.equal(gBundle.accounts.filter((a) => a.category === "shop").length, 1);

    const tafqeet = amountToArabicWords(239500, "ريال");
    assert.match(tafqeet, /مائتان/);
    assert.match(tafqeet, /تسعة وثلاثون ألف/);
    assert.match(tafqeet, /خمسمائة ريال فقط لا غير$/);

    // Explicit rawDain/rawMadin on a cash account only washes when settledOnReceipt is true
    const cashBuyer = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
      name: "عميل نقد تجريبي",
      category: "sales",
      isCashAccount: true,
      currency: "ريال",
    });
    const fakeCashLedger = [
      {
        id: "c1",
        ownerId: DEFAULT_WORKSPACE_ID,
        accountId: cashBuyer.id,
        accountName: cashBuyer.name,
        counterpartAccountId: "",
        counterpartAccountName: "",
        kind: "voucher" as const,
        typeLabel: "له",
        payment: "cash" as const,
        direction: "credit" as const,
        amount: 12500,
        rawDain: 0,
        rawMadin: 12500,
        settledOnReceipt: false,
        currency: "ريال" as const,
        exchangeRate: 1,
        details: "قيد نقدي مباشر",
        documentNumber: "",
        warehouseId: "",
        warehouseName: "",
        invoiceContent: "none" as const,
        entryNumber: 1,
        deleted: false,
        entryDate: "2026-11-10",
        createdAtMs: 1,
      },
      {
        id: "c2",
        ownerId: DEFAULT_WORKSPACE_ID,
        accountId: cashBuyer.id,
        accountName: cashBuyer.name,
        counterpartAccountId: "",
        counterpartAccountName: "",
        kind: "voucher" as const,
        typeLabel: "عليه",
        payment: "cash" as const,
        direction: "debit" as const,
        amount: 5000,
        rawDain: 5000,
        rawMadin: 0,
        settledOnReceipt: false,
        currency: "ريال" as const,
        exchangeRate: 1,
        details: "قيد نقدي مدين",
        documentNumber: "",
        warehouseId: "",
        warehouseName: "",
        invoiceContent: "none" as const,
        entryNumber: 2,
        deleted: false,
        entryDate: "2026-11-11",
        createdAtMs: 2,
      },
    ];
    const cashBuyerSummary = computeAccountSummary(cashBuyer, fakeCashLedger);
    assert.equal(cashBuyerSummary.debitTotal, 5000);
    assert.equal(cashBuyerSummary.creditTotal, 12500);
    assert.equal(cashBuyerSummary.netBalance, 7500);
    assert.equal(cashBuyerSummary.tone, "credit");

    const createdGroup = upsertAccountGroupRow(db, DEFAULT_WORKSPACE_ID, {
      name: "أصول إضافية",
      category: "shop",
      currencyCode: "ريال",
    });
    assert.ok(createdGroup.id > 0);
    const afterWithGroup = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const groupsSummary = computeAccountGroupsSummary(
      afterWithGroup.accountGroups,
      afterWithGroup.accounts,
      afterWithGroup.ledger,
      {},
      "ريال",
    );
    assert.ok(groupsSummary.length >= 6);
    const trialReport = computeTrialBalanceReport(
      afterWithGroup.accounts,
      afterWithGroup.ledger,
      afterWithGroup.inventory,
      afterWithGroup.cashboxes,
      { currency: "ريال" },
    );
    assert.equal(trialReport.currency, "ريال");
    assert.ok(trialReport.purchasesTotal >= 3000);
    assert.ok(trialReport.inventoryValue > 0);
  } finally {
    closeSqliteDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("5. empty ERP workspace starts clean, restores .back/.sqlite + native snapshots + JSON atomically", async () => {
  const { dir, filePath } = makeTempDbPath();
  const srcBackPath = path.join(dir, "erp-backup.back");
  const snapshotPath = path.join(dir, "snapshot.sqlite");
  try {
    const db = getSqliteDb(filePath);
    ensureEmptyWorkspace(db, DEFAULT_WORKSPACE_ID);
    const emptyBundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    assert.equal(emptyBundle.accounts.length, 0);
    assert.equal(emptyBundle.accountGroups.length, 0);
    assert.equal(emptyBundle.warehouses.length, 0);
    assert.equal(emptyBundle.inventory.length, 0);
    assert.equal(emptyBundle.ledger.length, 0);
    assert.equal(emptyBundle.erpData.employees.length, 0);

    // Create a SmartPro ERP .back file with custom groups + cashboxes + accounts + bills
    const srcDb = new DatabaseSync(srcBackPath);
    srcDb.exec(`
      CREATE TABLE currencies (id INTEGER PRIMARY KEY, name TEXT, sympol TEXT, amount REAL, amount2 REAL, name2 TEXT);
      CREATE TABLE boxes (id INTEGER PRIMARY KEY, name TEXT, cur INTEGER, hasbill INTEGER, isemp INTEGER, ord INTEGER);
      CREATE TABLE cboxes (id INTEGER PRIMARY KEY, name TEXT, details TEXT, state INTEGER, cur INTEGER, type INTEGER, ord INTEGER);
      CREATE TABLE stores (id INTEGER PRIMARY KEY, name TEXT, details TEXT, state INTEGER);
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, type INTEGER, phone TEXT, lim REAL);
      CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, barcode TEXT, unit TEXT, price REAL, price2 REAL);
      CREATE TABLE input_move (id INTEGER PRIMARY KEY, bill TEXT, per_id INTEGER, bill_type INTEGER, bstate INTEGER, ndate TEXT, dain REAL, madin REAL, cur INTEGER, cboxid INTEGER, details TEXT);
      CREATE TABLE bill_details (id INTEGER PRIMARY KEY, bill_id INTEGER, prod_id INTEGER, store_id INTEGER, unit TEXT, amount REAL, price REAL, discount REAL, total REAL);
      INSERT INTO currencies VALUES (1, 'ريال', 'ر.ي', 1, 1, '');
      INSERT INTO boxes VALUES (2, 'المشتريات', 1, 0, 0, 2), (8, 'راس المال والشركاء', 1, 0, 0, 8), (4, 'الموظفين', 1, 0, 1, 4);
      INSERT INTO cboxes VALUES (1, 'الصندوق الرئيسي', '', 1, 1, 1, 1);
      INSERT INTO stores VALUES (1, 'المخزن الرئيسي', '', 1);
      INSERT INTO customers VALUES (10, 'مورد رئيسي', 2, '777000111', 0), (11, 'شريك المحل', 8, '', 0), (12, 'موظف مبيعات', 4, '', 0);
      INSERT INTO products VALUES (100, 'جهاز شبكة', 'NET-100', 'حبة', 25000, 18000);
      INSERT INTO input_move VALUES (500, '500', 10, 3, 1, '20261116', 0, 18000, 1, 0, 'فاتورة شراء');
      INSERT INTO bill_details VALUES (700, 500, 100, 1, 'حبة', 1, 18000, 0, 18000);
    `);
    srcDb.close();

    const backBytes = new Uint8Array(fs.readFileSync(srcBackPath));
    const restoreRes = importLegacySqliteIntoUnifiedDb(db, backBytes, {
      workspaceId: DEFAULT_WORKSPACE_ID,
      fileName: "erp-backup.back",
      replaceExisting: true,
    });
    assert.equal(restoreRes.added.accountGroups, 3);
    assert.equal(restoreRes.added.accounts, 3);

    const restoredBundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    assert.equal(restoredBundle.accountGroups.length, 3);
    assert.equal(restoredBundle.cashboxes.length, 1);
    const partnerAcc = restoredBundle.accounts.find((a) => a.name === "شريك المحل")!;
    const partnerGrp = restoredBundle.accountGroups.find((g) => g.legacyId === 8)!;
    assert.equal(partnerGrp.category, "shop");
    assert.equal(partnerAcc.groupId, partnerGrp.id);
    const empGrp = restoredBundle.accountGroups.find((g) => g.legacyId === 4)!;
    assert.equal(empGrp.category, "employees");

    // Save custom ERP employee & verify full unified SQLite export + reset + re-restore roundtrip
    saveErpDataRows(db, DEFAULT_WORKSPACE_ID, {
      ...restoredBundle.erpData,
      employees: [
        {
          id: "emp_real_1",
          name: "خالد المحاسبي",
          roleTitle: "محاسب",
          department: "المالية",
          basicSalary: 5000,
          allowances: 0,
          deductions: 0,
          status: "active",
          hireDate: "2026-01-01",
          leaveBalanceDays: 20,
          attendanceToday: "present",
        },
      ],
    });
    const nativeSnapshot = await exportCleanSqliteSnapshotBytes(db, snapshotPath);
    resetWorkspaceToEmpty(db, DEFAULT_WORKSPACE_ID);
    assert.equal(getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID).accounts.length, 0);

    importLegacySqliteIntoUnifiedDb(db, nativeSnapshot, {
      workspaceId: DEFAULT_WORKSPACE_ID,
      fileName: "snapshot.sqlite",
      replaceExisting: true,
    });
    const roundtrip = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    assert.equal(roundtrip.accountGroups.length, 3);
    assert.equal(roundtrip.accounts.length, 3);
    assert.equal(roundtrip.erpData.employees.length, 1);
    assert.equal(roundtrip.erpData.employees[0].name, "خالد المحاسبي");

    // Verify JSON bundle restore
    resetWorkspaceToEmpty(db, DEFAULT_WORKSPACE_ID);
    restoreUnifiedJsonBundle(db, DEFAULT_WORKSPACE_ID, {
      workspace: { companyName: "شركة النخبة ERP", defaultCurrency: "ريال" },
      accountGroups: [{ id: 99, legacyId: 1, name: "المبيعات", category: "sales", currencyCode: "ريال" }],
      warehouses: [{ id: "wh_json_1", name: "مخزن جدة", isDefault: true, codeNumber: 1 }],
      accounts: [{ id: "acc_json_1", groupId: 99, name: "عميل JSON", category: "sales", currency: "ريال", codeNumber: 1 }],
      inventory: [],
      ledger: [],
    });
    const jsonBundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    assert.equal(jsonBundle.workspace.companyName, "شركة النخبة ERP");
    assert.equal(jsonBundle.accountGroups.length, 1);
    assert.equal(jsonBundle.accounts.length, 1);
  } finally {
    closeSqliteDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("6. schema v6 migration, multi-unit stock math, draft edit + posted reversal, transfers report, cashboxes, and dated statement previous balance", () => {
  const { dir, filePath } = makeTempDbPath();
  try {
    // Verify current schema retains v3 indexes and upgrades non-destructively
    const db = getSqliteDb(filePath);
    const uv = db.prepare("PRAGMA user_version").get() as { user_version: number };
    assert.equal(uv.user_version, 6);
    const workspaceColumns = db.prepare('PRAGMA table_info(workspaces)').all().map(row => row.name);
    for (const column of ['business_profile_json','user_preferences_json','setup_fingerprint']) assert(workspaceColumns.includes(column));
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_inv_lines_ws_entry'")
      .get() as { name?: string } | undefined;
    assert.equal(idx?.name, "idx_inv_lines_ws_entry");

    ensureEmptyWorkspace(db, DEFAULT_WORKSPACE_ID, "شركة الاختبار المتكاملة");
    const whMain = upsertWarehouseRow(db, DEFAULT_WORKSPACE_ID, { name: "المخزن الرئيسي", isDefault: true, codeNumber: 1 });
    const whBranch = upsertWarehouseRow(db, DEFAULT_WORKSPACE_ID, { name: "فرع تعز", isDefault: false, codeNumber: 2 });
    const accSupplier = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
      name: "مورد التوريد",
      category: "purchases",
      currency: "ريال",
      openingBalance: 500,
      openingDirection: "credit",
      codeNumber: 101,
    });
    const accClient = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
      name: "عميل الجملة",
      category: "sales",
      currency: "ريال",
      openingBalance: 0,
      openingDirection: "debit",
      codeNumber: 102,
    });

    // Multi-unit item: 1 carton = 2 dozens = 12 pcs (unit2=درزن count2=6, unit3=كرتون count3=2)
    db.prepare(
      `INSERT INTO inventory_items (id, workspace_id, warehouse_id, name, unit, quantity, avg_cost, selling_price, unit2, count2, sprice2, unit3, count3, sprice3, default_unit, quantity_unverified, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'حبة', 0, 100, 150, 'درزن', 6, 800, 'كرتون', 2, 1600, 1, 0, ?, ?)`,
    ).run("prod_multi", DEFAULT_WORKSPACE_ID, whMain.id, "لمبة ليد متعددة", new Date().toISOString(), new Date().toISOString());

    db.prepare("INSERT INTO cashboxes (workspace_id, name, currency_code, state, sort_order) VALUES (?, 'الصندوق العام', 'ريال', 1, 1)").run(
      DEFAULT_WORKSPACE_ID,
    );
    const cashboxRow = db.prepare("SELECT id FROM cashboxes WHERE workspace_id = ? LIMIT 1").get(DEFAULT_WORKSPACE_ID) as { id: number };

    // 1. Purchase 2 cartons (unitNum=3 -> 2 * 12 = 24 base units)
    const purchaseEntry = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      id: "ent_idem_purchase_1",
      accountId: accSupplier.id,
      accountName: accSupplier.name,
      kind: "invoice",
      typeLabel: "فاتورة شراء آجلة",
      payment: "credit",
      direction: "credit",
      amount: 2400,
      currency: "ريال",
      warehouseId: whMain.id,
      warehouseName: whMain.name,
      invoiceContent: "items",
      entryNumber: 101,
      entryDate: "2026-01-05",
      lines: [
        {
          inventoryItemId: "prod_multi",
          warehouseId: whMain.id,
          itemName: "لمبة ليد متعددة",
          unit: "كرتون",
          unitNum: 3,
          quantity: 2,
          price: 1200,
          total: 2400,
        },
      ],
    });
    // Idempotency retry with same explicit ID must not duplicate entry or stock!
    const retryPurchase = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      id: "ent_idem_purchase_1",
      accountId: accSupplier.id,
      accountName: accSupplier.name,
      kind: "invoice",
      typeLabel: "فاتورة شراء آجلة",
      payment: "credit",
      direction: "credit",
      amount: 2400,
      warehouseId: whMain.id,
      entryNumber: 101,
      entryDate: "2026-01-05",
      invoiceContent: 'items',
      lines: [{inventoryItemId: 'prod_multi', warehouseId: whMain.id, itemName: 'لمبة ليد متعددة', unit: 'كرتون', unitNum: 3, quantity: 2, price: 1200, total: 2400}],
    });
    assert.equal(retryPurchase.id, purchaseEntry.id);
    assert.throws(() => insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {...retryPurchase, lines: []}), /معرّف الطلب/);

    const stockAfterBuy = db.prepare("SELECT quantity FROM inventory_items WHERE id = 'prod_multi'").get() as { quantity: number };
    assert.equal(stockAfterBuy.quantity, 24);

    // 2. Draft cash sale of 1 dozen (unitNum=2 -> 6 base units): drafts do NOT affect stock until posted
    const saleDraft = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: accClient.id,
      accountName: accClient.name,
      cashboxId: cashboxRow.id,
      kind: "invoice",
      typeLabel: "فاتورة بيع نقدي",
      payment: "cash",
      direction: "debit",
      postingStatus: "draft",
      amount: 750,
      currency: "ريال",
      warehouseId: whMain.id,
      warehouseName: whMain.name,
      invoiceContent: "items",
      entryNumber: 102,
      entryDate: "2026-02-10",
      lines: [
        {
          inventoryItemId: "prod_multi",
          warehouseId: whMain.id,
          itemName: "لمبة ليد متعددة",
          unit: "درزن",
          unitNum: 2,
          quantity: 1,
          price: 800,
          discount: 50,
          total: 750,
        },
      ],
    });
    const stockWhileDraft = db.prepare("SELECT quantity FROM inventory_items WHERE id = 'prod_multi'").get() as { quantity: number };
    assert.equal(stockWhileDraft.quantity, 24);

    // 3. Edit draft in-place to 2 dozens (unitNum=2 -> 12 base units), then POST it atomically
    const updatedSale = updateLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, saleDraft.id, {
      accountId: accClient.id,
      accountName: accClient.name,
      cashboxId: cashboxRow.id,
      kind: "invoice",
      typeLabel: "فاتورة بيع نقدي",
      payment: "cash",
      direction: "debit",
      amount: 1550,
      currency: "ريال",
      warehouseId: whMain.id,
      warehouseName: whMain.name,
      invoiceContent: "items",
      entryNumber: 102,
      entryDate: "2026-02-10",
      lines: [
        {
          inventoryItemId: "prod_multi",
          warehouseId: whMain.id,
          itemName: "لمبة ليد متعددة",
          unit: "درزن",
          unitNum: 2,
          quantity: 2,
          price: 800,
          discount: 50,
          total: 1550,
        },
      ],
    });
    assert.ok(updatedSale);
    assert.equal(updatedSale!.amount, 1550);
    const saleEntry = postDraftLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, saleDraft.id);
    assert.equal(saleEntry.postingStatus, "posted");
    const totalEntriesCount = db.prepare("SELECT COUNT(*) AS c FROM ledger_entries WHERE workspace_id = ?").get(DEFAULT_WORKSPACE_ID) as { c: number };
    assert.equal(totalEntriesCount.c, 2);
    const stockAfterPost = db.prepare("SELECT quantity FROM inventory_items WHERE id = 'prod_multi'").get() as { quantity: number };
    assert.equal(stockAfterPost.quantity, 12);

    // 4. Posted entries cannot be directly edited or soft-deleted (immutability policy)
    assert.throws(
      () => setLedgerDeletedRow(db, DEFAULT_WORKSPACE_ID, saleEntry.id, true),
      (err) => err instanceof SqliteValidationError,
    );
    assert.throws(
      () => deleteLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, saleEntry.id),
      (err) => err instanceof SqliteValidationError,
    );

    // 5. Stock transfers + anomalies + Cashboxes report
    const txRes = db
      .prepare(
        `INSERT INTO stock_transfers (workspace_id, from_warehouse_id, to_warehouse_id, raw_from_store_id, raw_to_store_id, transfer_date, transfer_type, details)
         VALUES (?, ?, ?, 1, 2, '2026-02-12', 1, 'نقل لفرع تعز')`,
      )
      .run(DEFAULT_WORKSPACE_ID, whMain.id, whBranch.id);
    db.prepare(
      `INSERT INTO stock_transfer_lines (workspace_id, transfer_id, inventory_item_id, quantity, unit, unit_num)
       VALUES (?, ?, 'prod_multi', 5, 'حبة', 1)`,
    ).run(DEFAULT_WORKSPACE_ID, Number(txRes.lastInsertRowid));
    // Unresolved anomaly transfer (raw store 0 -> missing store 99)
    db.prepare(
      `INSERT INTO stock_transfers (workspace_id, from_warehouse_id, to_warehouse_id, raw_from_store_id, raw_to_store_id, transfer_date, transfer_type, details)
       VALUES (?, NULL, NULL, 0, 99, '2026-02-13', 3, 'مخزن مفقود')`,
    ).run(DEFAULT_WORKSPACE_ID);

    const invRep = getInventoryMovementsReport(db, DEFAULT_WORKSPACE_ID, { itemId: "prod_multi" });
    const mainStock = invRep.warehouseStocks.find((s) => s.warehouseId === whMain.id)!;
    const branchStock = invRep.warehouseStocks.find((s) => s.warehouseId === whBranch.id)!;
    assert.equal(mainStock.netComputedQty, 7); // 24 bought - 12 sold - 5 transferred out
    assert.equal(branchStock.netComputedQty, 5); // 5 transferred in
    assert.equal(invRep.anomalies.unresolvedTransfersCount, 1);
    assert.equal(invRep.movements.length, 3); // 2 invoices + 1 transfer

    const whMainRep = getInventoryMovementsReport(db, DEFAULT_WORKSPACE_ID, { warehouseId: whMain.id, profitBasis: "avg" });
    const multiRow = whMainRep.itemRows.find((r) => r.id === "prod_multi")!;
    assert.equal(multiRow.buyQty, 24);
    assert.equal(multiRow.sellQty, 12);
    assert.equal(multiRow.transferOutQty, 5);
    assert.equal(multiRow.availableQty, 7);
    assert.equal(whMainRep.totals.totalPurchases, 2400);
    assert.equal(whMainRep.totals.totalSales, 1550);
    assert.equal(whMainRep.totals.totalProfit, 350); // Sold 12 units at avg cost 100 = 1200 COGS -> 1550 - 1200 = 350

    const cbRep = getCashboxesReport(db, DEFAULT_WORKSPACE_ID);
    assert.equal(cbRep.cashboxes.length, 1);
    assert.equal(cbRep.cashboxes[0].totalIn, 1550);
    assert.equal(cbRep.cashboxes[0].entryCount, 1);

    // 6. Dated statement rows + pre-period previous balance calculation
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: accSupplier.id,
      accountName: accSupplier.name,
      kind: "voucher",
      typeLabel: "عليه (سند)",
      payment: "cash",
      direction: "debit",
      amount: 400,
      currency: "ريال",
      entryNumber: 103,
      entryDate: "2026-02-15",
    });
    const allSupplierEntries = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID).ledger;
    const datedStmt = computeStatementRows(accSupplier, allSupplierEntries, {
      fromDate: "2026-02-01",
      toDate: "2026-02-28",
      showPreviousBalance: true,
    });
    // Opening credit 500 + pre-period purchase credit 2400 (2026-01-05) = 2900 previous credit
    assert.equal(datedStmt.previousBalance, 2900);
    assert.equal(datedStmt.previousDirection, "credit");
    assert.equal(datedStmt.rows.length, 1); // Only 2026-02-15 voucher
    assert.equal(datedStmt.netBalance, 2500); // 2900 credit - 400 debit
    assert.equal(datedStmt.netDirection, "credit");
  } finally {
    closeSqliteDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("7. exact negative stock reversals, invoice line/total enforcement, and period opening balance report", () => {
  const { dir, filePath } = makeTempDbPath();
  try {
    const db = getSqliteDb(filePath);
    ensureEmptyWorkspace(db, DEFAULT_WORKSPACE_ID);

    const whMain = upsertWarehouseRow(db, DEFAULT_WORKSPACE_ID, { name: "المخزن الرئيسي", isDefault: true, codeNumber: 1 });
    const whBranch = upsertWarehouseRow(db, DEFAULT_WORKSPACE_ID, { name: "فرع تعز", codeNumber: 2 });
    const accClient = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, { name: "عميل نقدي", category: "clients", currency: "ريال" });
    const accSupplier = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, { name: "مورد بضاعة", category: "purchases", currency: "ريال" });

    // A) Verified item with opening quantity = 5; oversell 8 MUST be rejected (no negative stock policy)
    const itemVerified = insertInventoryItemRow(db, DEFAULT_WORKSPACE_ID, {
      id: "prod_oversell",
      name: "كشاف يدوي",
      unit: "حبة",
      quantity: 5,
      avgCost: 100,
      sellingPrice: 150,
      warehouseId: whMain.id,
      quantityUnverified: false,
    });
    assert.equal(itemVerified.quantity, 5);

    assert.throws(
      () =>
        insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
          accountId: accClient.id,
          accountName: accClient.name,
          kind: "invoice",
          typeLabel: "فاتورة بيع آجل",
          payment: "credit",
          direction: "debit",
          amount: 1200,
          currency: "ريال",
          warehouseId: whMain.id,
          warehouseName: whMain.name,
          invoiceContent: "items",
          entryNumber: 501,
          entryDate: "2026-06-05",
          lines: [
            { inventoryItemId: itemVerified.id, warehouseId: whMain.id, itemName: itemVerified.name, unit: "حبة", quantity: 8, price: 150, total: 1200 },
          ],
        }),
      (err) => err instanceof SqliteValidationError,
    );
    assert.equal((db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(itemVerified.id) as { quantity: number }).quantity, 5);

    // B) Invoice line recomputation + mismatch rejection
    // Caller spoofs line.total=9999 while 2*150 - 20 = 280; server recomputes line.total to 280!
    const validSale = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: accClient.id,
      accountName: accClient.name,
      kind: "invoice",
      typeLabel: "فاتورة بيع آجل",
      payment: "credit",
      direction: "debit",
      amount: 280,
      currency: "ريال",
      warehouseId: whMain.id,
      warehouseName: whMain.name,
      invoiceContent: "items",
      entryNumber: 502,
      entryDate: "2026-06-05",
      lines: [
        { inventoryItemId: itemVerified.id, warehouseId: whMain.id, itemName: itemVerified.name, unit: "حبة", quantity: 2, price: 150, discount: 20, total: 9999 },
      ],
    });
    const savedDetail = fetchInvoiceDetail(db, DEFAULT_WORKSPACE_ID, validSale.id);
    assert.equal(savedDetail?.lines[0].total, 280);
    assert.equal(savedDetail?.entry.amount, 280);

    // Reject mismatched header amount
    assert.throws(
      () =>
        insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
          accountId: accClient.id,
          accountName: accClient.name,
          kind: "invoice",
          typeLabel: "فاتورة بيع آجل",
          payment: "credit",
          direction: "debit",
          amount: 500,
          warehouseId: whMain.id,
          invoiceContent: "items",
          entryNumber: 503,
          entryDate: "2026-06-05",
          lines: [
            { inventoryItemId: itemVerified.id, warehouseId: whMain.id, itemName: itemVerified.name, unit: "حبة", quantity: 2, price: 150, discount: 20, total: 280 },
          ],
        }),
      (err) => err instanceof SqliteValidationError,
    );

    // Reject header-only PATCH altering amount away from existing lines sum
    assert.throws(
      () =>
        updateLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, validSale.id, {
          accountId: accClient.id,
          accountName: accClient.name,
          kind: "invoice",
          typeLabel: "فاتورة بيع آجل",
          payment: "credit",
          direction: "debit",
          amount: 999,
          warehouseId: whMain.id,
          invoiceContent: "items",
          entryNumber: 502,
          entryDate: "2026-06-05",
        }),
      (err) => err instanceof SqliteValidationError,
    );

    // Accept explicit VAT (taxAmount: 42 -> 280 + 42 = 322)
    const vatSale = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: accClient.id,
      accountName: accClient.name,
      kind: "invoice",
      typeLabel: "ف.مبيعات نقدية",
      payment: "cash",
      direction: "debit",
      amount: 322,
      taxAmount: 42,
      currency: "ريال",
      warehouseId: whMain.id,
      invoiceContent: "items",
      entryNumber: 504,
      entryDate: "2026-06-06",
      lines: [
        { inventoryItemId: itemVerified.id, warehouseId: whMain.id, itemName: itemVerified.name, unit: "حبة", quantity: 2, price: 140, discount: 0, total: 280 },
      ],
    });
    assert.equal(vatSale.amount, 322);
    reverseLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, vatSale.id, {
      reason: "عكس فاتورة الاختبار",
      reversalDate: "2026-06-06",
    });

    // Stock after validSale(2) + vatSale(2) + reversal(-2) should be 5 - 2 = 3
    assert.equal((db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(itemVerified.id) as { quantity: number }).quantity, 3);

    // C) Period report with opening balance + pre-period purchase/transfer:
    // Item verified (10 - 2 = 8): let's set verified opening = 10 by creating itemOpening(10) and selling 2 on 2026-06-05
    const itemPeriod = insertInventoryItemRow(db, DEFAULT_WORKSPACE_ID, {
      id: "prod_period_open",
      name: "بطارية صيانة",
      unit: "حبة",
      quantity: 10,
      avgCost: 100,
      warehouseId: whMain.id,
      quantityUnverified: false,
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: accClient.id,
      accountName: accClient.name,
      kind: "invoice",
      typeLabel: "فاتورة بيع آجل",
      payment: "credit",
      direction: "debit",
      amount: 300,
      currency: "ريال",
      warehouseId: whMain.id,
      invoiceContent: "items",
      entryNumber: 505,
      entryDate: "2026-06-05",
      lines: [
        { inventoryItemId: itemPeriod.id, warehouseId: whMain.id, itemName: itemPeriod.name, unit: "حبة", quantity: 2, price: 150, total: 300 },
      ],
    });

    // Plus unverified item bought before period (10 on 2026-01-10), transferred (3 on 2026-02-05), sold in June (4 on 2026-06-10)
    const itemFlow = insertInventoryItemRow(db, DEFAULT_WORKSPACE_ID, {
      id: "prod_period_flow",
      name: "كابل طاقة",
      unit: "حبة",
      quantity: 0,
      avgCost: 50,
      warehouseId: whMain.id,
      quantityUnverified: true,
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: accSupplier.id,
      accountName: accSupplier.name,
      kind: "invoice",
      typeLabel: "فاتورة شراء آجلة",
      payment: "credit",
      direction: "credit",
      amount: 500,
      currency: "ريال",
      warehouseId: whMain.id,
      invoiceContent: "items",
      entryNumber: 506,
      entryDate: "2026-01-10",
      lines: [
        { inventoryItemId: itemFlow.id, warehouseId: whMain.id, itemName: itemFlow.name, unit: "حبة", quantity: 10, price: 50, total: 500 },
      ],
    });
    const txRes = db
      .prepare(
        `INSERT INTO stock_transfers (workspace_id, from_warehouse_id, to_warehouse_id, raw_from_store_id, raw_to_store_id, transfer_date, transfer_type, details)
         VALUES (?, ?, ?, 1, 2, '2026-02-05', 1, 'تحويل قبل الفترة')`,
      )
      .run(DEFAULT_WORKSPACE_ID, whMain.id, whBranch.id);
    db.prepare(
      `INSERT INTO stock_transfer_lines (workspace_id, transfer_id, inventory_item_id, quantity, unit, unit_num)
       VALUES (?, ?, ?, 3, 'حبة', 1)`,
    ).run(DEFAULT_WORKSPACE_ID, Number(txRes.lastInsertRowid), itemFlow.id);
    // Imported historical sales remain reportable even when quantity is unverified.
    // Seed those stored rows, rather than using the stricter new-sale command.
    const historicalSale = (id: string, number: number, date: string, warehouse: string,
      item: {id: string; name: string}, quantity: number, price: number) => {
      const total = quantity * price;
      db.prepare(`INSERT INTO ledger_entries
        (id,workspace_id,account_id,account_name,kind,type_label,payment,direction,amount,warehouse_id,
         invoice_content,entry_number,entry_date,doc_type,source_origin,created_at_ms)
        VALUES (?,?,?,?,'invoice','فاتورة بيع آجل','credit','debit',?,?,'items',?,?,2,'legacy',?)`)
        .run(id,DEFAULT_WORKSPACE_ID,accClient.id,accClient.name,total,warehouse,number,date,Date.parse(date));
      db.prepare(`INSERT INTO invoice_lines
        (workspace_id,entry_id,inventory_item_id,warehouse_id,item_name,unit,quantity,price,total)
        VALUES (?,?,?,?,?,'حبة',?,?,?)`)
        .run(DEFAULT_WORKSPACE_ID,id,item.id,warehouse,item.name,quantity,price,total);
    };
    historicalSale('qa-historical-sale',507,'2026-06-10',whMain.id,itemFlow,4,90);

    const juneReport = getInventoryMovementsReport(db, DEFAULT_WORKSPACE_ID, {
      warehouseId: whMain.id,
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
      profitBasis: "avg",
    });
    const periodRow = juneReport.itemRows.find((r) => r.id === itemPeriod.id)!;
    assert.equal(periodRow.openingQty, 10);
    assert.equal(periodRow.periodNetQty, -2);
    assert.equal(periodRow.sellQty, 2);
    assert.equal(periodRow.availableQty, 8); // NOT -2!
    assert.equal(periodRow.remainingValue, 800);
    assert.ok(!juneReport.anomalies.negativeComputedItems.some((n) => n.id === itemPeriod.id));

    const flowRow = juneReport.itemRows.find((r) => r.id === itemFlow.id)!;
    assert.equal(flowRow.openingQty, 7); // 10 bought - 3 transferred out before June
    assert.equal(flowRow.periodNetQty, -4);
    assert.equal(flowRow.sellQty, 4);
    assert.equal(flowRow.availableQty, 3); // 7 - 4 = 3
    assert.equal(flowRow.unitCost, 50); // Falls back to January purchase cost even when June buyQty=0
    assert.equal(flowRow.profit, 160); // 360 - 4*50 = 160

    // D) Zero-quantity/zero-cost item creation succeeds; missing warehouse rejects cleanly; empty account safe delete
    const zeroItem = insertInventoryItemRow(db, DEFAULT_WORKSPACE_ID, {
      name: "صنف اختبار صفر",
      unit: "حبة",
      quantity: 0,
      avgCost: 0,
      warehouseId: whMain.id,
      quantityUnverified: false,
    });
    assert.equal(zeroItem.quantity, 0);
    assert.equal(zeroItem.avgCost, 0);

    // Catalog-only item ("هيبان", cost=2003, sell=5000) without specifying warehouse saves with quantity=0 and hasMovement=false
    const hayban = insertInventoryItemRow(db, DEFAULT_WORKSPACE_ID, {
      name: "هيبان",
      sku: "5324290422",
      unit: "حبة",
      quantity: 0,
      avgCost: 2003,
      sellingPrice: 5000,
    });
    assert.equal(hayban.quantity, 0);
    assert.equal(hayban.avgCost, 2003);
    assert.equal(hayban.sellingPrice, 5000);
    const haybanReport = getInventoryMovementsReport(db, DEFAULT_WORKSPACE_ID).itemRows.find((r) => r.id === hayban.id)!;
    assert.equal(haybanReport.hasMovement, false);
    assert.equal(haybanReport.buyQty, 0);
    assert.equal(haybanReport.availableQty, 0);
    assert.equal(haybanReport.remainingValue, 0);

    // SmartPro movement formula match (#19 ولاعه مع اضاءة in المخزن الجديد: buy=0, sell=1 @ 3500, transferIn=4, catalogCost=2500 -> available=3, remaining=7500, profit=1000)
    const lighter = insertInventoryItemRow(db, DEFAULT_WORKSPACE_ID, {
      name: "ولاعه مع اضاءة",
      warehouseId: whBranch.id,
      unit: "حبة",
      quantity: 0,
      avgCost: 2500,
      sellingPrice: 3500,
      quantityUnverified: true,
    });
    const txLighter = db
      .prepare(
        `INSERT INTO stock_transfers (workspace_id, from_warehouse_id, to_warehouse_id, raw_from_store_id, raw_to_store_id, transfer_date, transfer_type, details)
         VALUES (?, ?, ?, 1, 2, '2026-06-12', 1, 'تحويل وارد إلى المخزن الجديد')`,
      )
      .run(DEFAULT_WORKSPACE_ID, whMain.id, whBranch.id);
    db.prepare(
      `INSERT INTO stock_transfer_lines (workspace_id, transfer_id, inventory_item_id, quantity, unit, unit_num)
       VALUES (?, ?, ?, 4, 'حبة', 1)`,
    ).run(DEFAULT_WORKSPACE_ID, Number(txLighter.lastInsertRowid), lighter.id);
    historicalSale('qa-historical-lighter',508,'2026-06-15',whBranch.id,lighter,1,3500);
    const branchReport = getInventoryMovementsReport(db, DEFAULT_WORKSPACE_ID, {
      warehouseId: whBranch.id,
      profitBasis: "avg",
    });
    const lighterRow = branchReport.itemRows.find((r) => r.id === lighter.id)!;
    assert.equal(lighterRow.buyQty, 0);
    assert.equal(lighterRow.sellQty, 1);
    assert.equal(lighterRow.transferInQty, 4);
    assert.equal(lighterRow.transferOutQty, 0);
    assert.equal(lighterRow.buyTotal, 0);
    assert.equal(lighterRow.sellTotal, 3500);
    assert.equal(lighterRow.availableQty, 3);
    assert.equal(lighterRow.remainingValue, 7500);
    assert.equal(lighterRow.profit, 1000);

    assert.throws(
      () =>
        insertInventoryItemRow(db, DEFAULT_WORKSPACE_ID, {
          name: "صنف بلا مخزن",
          warehouseId: "nonexistent_wh",
        }),
      (err) => err instanceof SqliteValidationError,
    );

    const tempAcc = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, { name: "حساب اختبار مؤقت", category: "purchases" });
    assert.throws(
      () => deleteAccountRow(db, DEFAULT_WORKSPACE_ID, accClient.id),
      (err) => err instanceof SqliteValidationError,
    );
    deleteAccountRow(db, DEFAULT_WORKSPACE_ID, tempAcc.id);
    assert.equal(db.prepare("SELECT id FROM accounts WHERE id = ?").get(tempAcc.id), undefined);

    // E) Cashboxes report includes active+inactive boxes, uses accounting voucher signs, and persists VAT config
    const activeCbRes = db
      .prepare(
        `INSERT INTO cashboxes (workspace_id, name, details, state, currency_code, box_type, sort_order)
         VALUES (?, 'الصندوق الرئيسي اختبار', '', 1, 'ريال', 1, 0)`,
      )
      .run(DEFAULT_WORKSPACE_ID);
    const mainCbId = Number(activeCbRes.lastInsertRowid);
    db.prepare(
      `INSERT INTO cashboxes (workspace_id, name, details, state, currency_code, box_type, sort_order)
       VALUES (?, 'صندوق موقوف اختبار', '', 0, 'ريال', 1, 5)`,
    ).run(DEFAULT_WORKSPACE_ID);
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: accClient.id,
      accountName: accClient.name,
      cashboxId: mainCbId,
      kind: "voucher",
      typeLabel: "له (سند)",
      payment: "cash",
      direction: "credit",
      amount: 250,
      currency: "ريال",
      entryNumber: 120,
      deleted: false,
      entryDate: "2026-06-15",
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: accClient.id,
      accountName: accClient.name,
      cashboxId: mainCbId,
      kind: "voucher",
      typeLabel: "عليه (سند)",
      payment: "cash",
      direction: "debit",
      amount: 90,
      currency: "ريال",
      entryNumber: 121,
      deleted: false,
      entryDate: "2026-06-16",
    });
    const cbFull = getCashboxesReport(db, DEFAULT_WORKSPACE_ID, { currency: "ريال" });
    const mainBox = cbFull.cashboxes.find((b) => b.id === mainCbId)!;
    const inactiveBox = cbFull.cashboxes.find((b) => b.name === "صندوق موقوف اختبار")!;
    assert.equal(mainBox.isActive, true);
    assert.equal(mainBox.totalIn, 250); // Credit receipt voucher adds to cashbox inflow
    assert.equal(mainBox.totalOut, 90); // Debit payment voucher adds to cashbox outflow
    assert.equal(mainBox.netBalance, 160);
    assert.equal(inactiveBox.isActive, false);
    assert.equal(cbFull.reconciliation?.inactiveCount, 1);

    saveErpDataRows(db, DEFAULT_WORKSPACE_ID, {
      ...loadErpDataRows(db, DEFAULT_WORKSPACE_ID),
      vatConfig: { jurisdiction: "sa_15", ratePercent: 15, basis: "estimated_gross" },
    });
    const {_revision, ...vatFields} = loadErpDataRows(db, DEFAULT_WORKSPACE_ID).vatConfig as unknown as Record<string,unknown>;
    assert.equal(typeof _revision, "string");
    assert.deepEqual(vatFields, {
      jurisdiction: "sa_15",
      ratePercent: 15,
      basis: "estimated_gross",
    });
  } finally {
    closeSqliteDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("8. full JSON export/restore roundtrip preserves invoice lines & ERP entities, invalid {} rejects without wiping, rollback works, and SQLite merge respects replaceExisting: false", async () => {
  const { dir, filePath } = makeTempDbPath();
  const snapPath = path.join(dir, "native-export.sqlite");
  try {
    const db = getSqliteDb(filePath);
    ensureEmptyWorkspace(db, DEFAULT_WORKSPACE_ID, "شركة النقاء للتجارة");
    db.prepare(
      `INSERT INTO currencies (workspace_id, code, name, symbol, rate_primary, rate_secondary, name_secondary)
       VALUES (?, 'دولار', 'دولار أمريكي', '$', 535, 535, 'USD')`,
    ).run(DEFAULT_WORKSPACE_ID);
    const grp = upsertAccountGroupRow(db, DEFAULT_WORKSPACE_ID, { name: "العملاء", category: "clients", currencyCode: "ريال" });
    const wh1 = upsertWarehouseRow(db, DEFAULT_WORKSPACE_ID, { name: "المخزن الرئيسي", isDefault: true, codeNumber: 1 });
    const wh2 = upsertWarehouseRow(db, DEFAULT_WORKSPACE_ID, { name: "فرع الحديدة", isDefault: false, codeNumber: 2 });
    const cbRes = db
      .prepare("INSERT INTO cashboxes (workspace_id, name, currency_code, state, sort_order) VALUES (?, 'الصندوق العام', 'ريال', 1, 1)")
      .run(DEFAULT_WORKSPACE_ID);
    const cbId = Number(cbRes.lastInsertRowid);

    const supplierGroup = upsertAccountGroupRow(db, DEFAULT_WORKSPACE_ID, {name:"الموردون",category:"purchases",currencyCode:"ريال"});
    const accSupp = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
      name: "مورد التصدير",
      category: "purchases",
      groupId: supplierGroup.id,
      currency: "ريال",
      openingBalance: 1000,
      openingDirection: "credit",
      codeNumber: 10,
    });
    const accCust = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
      name: "عميل التجزئة",
      category: "clients",
      groupId: grp.id,
      currency: "ريال",
      openingBalance: 250,
      openingDirection: "debit",
      codeNumber: 11,
    });

    db.prepare(
      `INSERT INTO inventory_items (id, workspace_id, warehouse_id, name, unit, quantity, avg_cost, selling_price, unit2, count2, sprice2, default_unit, quantity_unverified, created_at, updated_at)
       VALUES ('prod_json_1', ?, ?, 'كابل شحن سريع', 'حبة', 0, 50, 80, 'باكت', 5, 380, 1, 0, ?, ?)`,
    ).run(DEFAULT_WORKSPACE_ID, wh2.id, new Date().toISOString(), new Date().toISOString());

    const inv1 = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: accSupp.id,
      accountName: accSupp.name,
      cashboxId: cbId,
      kind: "invoice",
      typeLabel: "فاتورة شراء آجلة",
      payment: "credit",
      direction: "credit",
      amount: 1850,
      discount: 100,
      taxAmount: 50,
      currency: "ريال",
      warehouseId: wh2.id,
      warehouseName: wh2.name,
      invoiceContent: "items",
      entryNumber: 501,
      entryDate: "2026-10-01",
      lines: [
        {
          inventoryItemId: "prod_json_1",
          warehouseId: wh2.id,
          itemName: "كابل شحن سريع",
          unit: "باكت",
          unitNum: 2,
          quantity: 4,
          price: 500,
          discount: 100,
          bonus: 1,
          total: 1900,
        },
      ],
    });
    const ret1 = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: accCust.id,
      accountName: accCust.name,
      kind: "return",
      typeLabel: "مردود مبيعات",
      payment: "credit",
      direction: "credit",
      amount: 80,
      currency: "ريال",
      warehouseId: wh2.id,
      warehouseName: wh2.name,
      invoiceContent: "items",
      entryNumber: 502,
      entryDate: "2026-10-02",
      lines: [
        {
          inventoryItemId: "prod_json_1",
          warehouseId: wh2.id,
          itemName: "كابل شحن سريع",
          unit: "حبة",
          unitNum: 1,
          quantity: 1,
          price: 80,
          total: 80,
        },
      ],
    });

    const txRes = db
      .prepare("INSERT INTO stock_transfers (workspace_id, from_warehouse_id, to_warehouse_id, details, transfer_date, transfer_type) VALUES (?, ?, ?, 'تحويل بين الفروع', '2026-10-03', 1)")
      .run(DEFAULT_WORKSPACE_ID, wh2.id, wh1.id);
    db.prepare(
      "INSERT INTO stock_transfer_lines (workspace_id, transfer_id, inventory_item_id, quantity, unit, unit_num, details) VALUES (?, ?, 'prod_json_1', 3, 'حبة', 1, 'تحويل اختبار')",
    ).run(DEFAULT_WORKSPACE_ID, Number(txRes.lastInsertRowid));

    const offerRes = db
      .prepare("INSERT INTO price_offers (workspace_id, account_id, name, offer_type, madin, currency, offer_date, details) VALUES (?, ?, 'عرض أكتوبر', 1, 400, 'ريال', '2026-10-04', 'عرض سعر')")
      .run(DEFAULT_WORKSPACE_ID, accCust.id);
    db.prepare(
      "INSERT INTO price_offer_lines (workspace_id, offer_id, line_kind, inventory_item_id, price, quantity, total, unit, unit_num) VALUES (?, ?, 'item', 'prod_json_1', 80, 5, 400, 'حبة', 1)",
    ).run(DEFAULT_WORKSPACE_ID, Number(offerRes.lastInsertRowid));

    saveErpDataRows(db, DEFAULT_WORKSPACE_ID, {
      ...loadErpDataRows(db, DEFAULT_WORKSPACE_ID),
      vatConfig: { jurisdiction: "sa_15", ratePercent: 15, basis: "estimated_gross" },
    });

    // A) Export full JSON backup & verify every entity + line is present
    const exported = exportWorkspaceJsonBackup(db, DEFAULT_WORKSPACE_ID);
    assert.equal(exported.format, "nasqo-unified-sqlite-export-v2");
    assert.equal(exported.version, 2);
    assert.equal(exported.emptyBackup, false);
    assert.ok(exported.currencies.length >= 2);
    assert.equal(exported.stockTransfers.length, 1);
    assert.equal(exported.priceOffers.length, 1);
    const exportedInv = exported.ledger.find((e) => e.id === inv1.id)!;
    assert.equal(exportedInv.lines.length, 1);
    assert.equal(exportedInv.lines[0].unitNum, 2);
    assert.equal(exportedInv.lines[0].bonus, 1);
    assert.equal(exportedInv.lines[0].warehouseId, wh2.id);
    assert.equal(exportedInv.taxAmount, 50);

    // B) Invalid / arbitrary JSON must throw SqliteValidationError BEFORE deleting anything
    for (const invalid of [{}, { random: "abc" }, [], { format: "unknown-format" }, { format: "nasqo-unified-sqlite-export-v2", ledger: [{ id: "x", accountId: "missing", amount: 10 }] }]) {
      assert.throws(() => restoreUnifiedJsonBundle(db, DEFAULT_WORKSPACE_ID, invalid), (err) => err instanceof SqliteValidationError);
      assert.equal(getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID).accounts.length, 2);
      assert.equal(getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID).ledger.length, 2);
    }

    // C) Mid-restore failure trigger proves full atomic transaction ROLLBACK (zero data loss)
    db.exec(`CREATE TRIGGER test_fail_mid_restore BEFORE INSERT ON invoice_lines BEGIN SELECT RAISE(ABORT, 'simulated-mid-restore-failure'); END;`);
    assert.throws(() => restoreUnifiedJsonBundle(db, DEFAULT_WORKSPACE_ID, JSON.parse(JSON.stringify(exported))), /invoice_lines/);
    db.exec(`DROP TRIGGER test_fail_mid_restore;`);
    assert.equal(getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID).accounts.length, 2);
    assert.equal(fetchInvoiceDetail(db, DEFAULT_WORKSPACE_ID, inv1.id)!.lines.length, 1);

    // D) Reset to empty, export explicit empty backup, then restore full exported JSON & compare before === after
    resetWorkspaceToEmpty(db, DEFAULT_WORKSPACE_ID);
    const emptyExport = exportWorkspaceJsonBackup(db, DEFAULT_WORKSPACE_ID);
    assert.equal(emptyExport.emptyBackup, true);
    restoreUnifiedJsonBundle(db, DEFAULT_WORKSPACE_ID, JSON.parse(JSON.stringify(emptyExport)));
    assert.equal(getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID).accounts.length, 0);

    const restoredCounts = restoreUnifiedJsonBundle(db, DEFAULT_WORKSPACE_ID, JSON.parse(JSON.stringify(exported)));
    assert.equal(restoredCounts.ledger, 2);
    assert.equal(restoredCounts.invoiceLines, 2);
    assert.equal(restoredCounts.stockTransfers, 1);
    assert.equal(restoredCounts.priceOffers, 1);

    const afterExport = exportWorkspaceJsonBackup(db, DEFAULT_WORKSPACE_ID);
    assert.equal(afterExport.workspace.companyName, exported.workspace.companyName);
    assert.equal(afterExport.currencies.length, exported.currencies.length);
    assert.equal(afterExport.warehouses.length, exported.warehouses.length);
    assert.equal(afterExport.accounts.length, exported.accounts.length);
    assert.equal(afterExport.inventory[0].quantity, exported.inventory[0].quantity);
    assert.equal(afterExport.inventory[0].unit2, "باكت");
    assert.equal(afterExport.ledger.length, exported.ledger.length);
    assert.deepEqual(afterExport.ledger.find((e) => e.id === inv1.id)!.lines, exportedInv.lines);
    assert.deepEqual(afterExport.ledger.find((e) => e.id === ret1.id)!.lines, exported.ledger.find((e) => e.id === ret1.id)!.lines);
    assert.equal(afterExport.ledger.find((e) => e.id === inv1.id)!.taxAmount, 50);
    assert.deepEqual(afterExport.erpData.vatConfig, exported.erpData.vatConfig);

    // E) Export native SQLite snapshot -> setup a workspace with an existing account -> import with replaceExisting: false MUST reject without wiping!
    const nativeBytes = await exportCleanSqliteSnapshotBytes(db, snapPath);
    resetWorkspaceToEmpty(db, DEFAULT_WORKSPACE_ID);
    upsertAccountRow(db, DEFAULT_WORKSPACE_ID, { name: "الحساب القائم المحمي", category: "purchases", currency: "ريال" });
    assert.throws(
      () =>
        importLegacySqliteIntoUnifiedDb(db, nativeBytes, {
          workspaceId: DEFAULT_WORKSPACE_ID,
          fileName: "native-export.sqlite",
          replaceExisting: false,
        }),
      (err) => err instanceof SqliteValidationError,
    );
    const survived = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    assert.equal(survived.accounts.length, 1);
    assert.equal(survived.accounts[0].name, "الحساب القائم المحمي");

    // Explicit replaceExisting: true succeeds cleanly
    importLegacySqliteIntoUnifiedDb(db, nativeBytes, {
      workspaceId: DEFAULT_WORKSPACE_ID,
      fileName: "native-export.sqlite",
      replaceExisting: true,
    });
    assert.equal(getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID).accounts.length, 2);
  } finally {
    closeSqliteDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
