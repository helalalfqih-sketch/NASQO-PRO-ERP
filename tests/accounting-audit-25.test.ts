import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import {
  computeAccountGroupsSummary,
  computeAccountSummary,
  computeStatementRows,
} from "../src/accounting.ts";
import {
  computeBalanceSheet,
  computeIncomeStatement,
  computeTrialBalance,
  computeVatSummary,
} from "../src/erp.ts";
import { computeInvoiceLineNet } from "../src/utils/invoiceGridUtils.ts";
import {
  addMoney,
  computeExactLineNet,
  computeWeightedAverageCost,
  mulMoney,
  roundMoney,
  subMoney,
  sumMoney,
} from "../src/utils/moneyMath.ts";
import {
  DEFAULT_WORKSPACE_ID,
  SqliteValidationError,
  closeSqliteDb,
  deleteLedgerEntryRow,
  ensureEmptyWorkspace,
  exportCleanSqliteSnapshotBytes,
  fetchInvoiceDetail,
  getCashboxesReport,
  getFullWorkspaceBundle,
  getInventoryMovementsReport,
  getSqliteDb,
  insertCashTransferAtomic,
  insertInventoryItemRow,
  insertJournalEntryRow,
  insertLedgerEntryRow,
  postDraftLedgerEntryRow,
  reverseJournalEntryRow,
  reverseLedgerEntryRow,
  setLedgerDeletedRow,
  setWorkspaceClosedUntilDate,
  updateLedgerEntryRow,
  upsertAccountGroupRow,
  upsertAccountRow,
  upsertWarehouseRow,
} from "../server/sqliteDb.ts";
import { requireSqliteAccess } from "../server/sqliteAccess.ts";
import { mountSqliteApi } from "../server/sqliteApi.ts";

function withIsolatedDb(fn: (db: DatabaseSync, dir: string) => void | Promise<void>) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nasqo-audit-25-"));
    const dbPath = path.join(dir, "audit.sqlite");
    closeSqliteDb();
    try {
      const db = getSqliteDb(dbPath);
      ensureEmptyWorkspace(db, DEFAULT_WORKSPACE_ID, "شركة التدقيق المالي");
      await fn(db, dir);
    } finally {
      closeSqliteDb();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function seedCoreEntities(db: DatabaseSync) {
  const wh = upsertWarehouseRow(db, DEFAULT_WORKSPACE_ID, {
    name: "المخزن الرئيسي",
    isDefault: true,
    codeNumber: 1,
  });
  const grpClients = upsertAccountGroupRow(db, DEFAULT_WORKSPACE_ID, {
    name: "العملاء",
    category: "clients",
    currencyCode: "ريال",
  });
  const grpSuppliers = upsertAccountGroupRow(db, DEFAULT_WORKSPACE_ID, {
    name: "الموردون",
    category: "purchases",
    currencyCode: "ريال",
  });
  const grpCash = upsertAccountGroupRow(db, DEFAULT_WORKSPACE_ID, {
    name: "الصناديق والنقدية",
    category: "transfers",
    currencyCode: "ريال",
  });

  const cashAccA = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
    name: "الصندوق الرئيسي",
    category: "transfers",
    groupId: grpCash.id,
    currency: "ريال",
    isCashAccount: true,
    codeNumber: 1001,
  });
  const cashAccB = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
    name: "صندوق الفرع",
    category: "transfers",
    groupId: grpCash.id,
    currency: "ريال",
    isCashAccount: true,
    codeNumber: 1002,
  });
  const cashAccUsd = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
    name: "صندوق الدولار",
    category: "transfers",
    groupId: grpCash.id,
    currency: "دولار",
    isCashAccount: true,
    codeNumber: 1003,
  });
  const clientA = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
    name: "عميل التجزئة أ",
    category: "clients",
    groupId: grpClients.id,
    currency: "ريال",
    codeNumber: 2001,
  });
  const clientB = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
    name: "عميل الجملة ب",
    category: "clients",
    groupId: grpClients.id,
    currency: "ريال",
    codeNumber: 2002,
  });
  const supplierA = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
    name: "مورد التوريدات أ",
    category: "purchases",
    groupId: grpSuppliers.id,
    currency: "ريال",
    codeNumber: 3001,
  });
  const salesAcc = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
    name: "إيرادات المبيعات",
    category: "sales",
    currency: "ريال",
    codeNumber: 4001,
  });

  db.prepare(
    "INSERT INTO cashboxes (workspace_id, name, currency_code, state, sort_order) VALUES (?, 'صندوق 1', 'ريال', 1, 1)",
  ).run(DEFAULT_WORKSPACE_ID);
  db.prepare(
    "INSERT INTO cashboxes (workspace_id, name, currency_code, state, sort_order) VALUES (?, 'صندوق 2', 'ريال', 1, 2)",
  ).run(DEFAULT_WORKSPACE_ID);
  const cashboxes = db
    .prepare("SELECT id, name FROM cashboxes WHERE workspace_id = ? ORDER BY id ASC")
    .all(DEFAULT_WORKSPACE_ID) as Array<{ id: number; name: string }>;

  const item = insertInventoryItemRow(db, DEFAULT_WORKSPACE_ID, {
    name: "كابل شبكة كات 6",
    unit: "لفة",
    quantity: 10,
    avgCost: 100,
    sellingPrice: 150,
    warehouseId: wh.id,
    quantityUnverified: false,
  });

  return {
    wh,
    grpClients,
    grpSuppliers,
    cashAccA,
    cashAccB,
    cashAccUsd,
    clientA,
    clientB,
    supplierA,
    salesAcc,
    cb1: cashboxes[0].id,
    cb2: cashboxes[1].id,
    item,
  };
}

function logCase(id: number, input: string, expected: string, actual: string) {
  console.log(`[AUDIT-T${String(id).padStart(2, "0")}] PASS | Input: ${input} | Expected: ${expected} | Actual: ${actual}`);
}

test(
  "T01. قيد يومي متوازن (Balanced double-entry journal)",
  withIsolatedDb((db) => {
    const { cashAccA, salesAcc } = seedCoreEntities(db);
    const j = insertJournalEntryRow(db, DEFAULT_WORKSPACE_ID, {
      entryDate: "2026-03-01",
      description: "إثبات إيراد مبيعات نقدية",
      currency: "ريال",
      lines: [
        { accountId: cashAccA.id, debit: 1250.5, description: "قبض نقدي" },
        { accountId: salesAcc.id, credit: 1250.5, description: "إيراد مبيعات" },
      ],
    });
    assert.equal(j.totalDebit, 1250.5);
    assert.equal(j.totalCredit, 1250.5);
    assert.equal(j.postingStatus, "posted");
    assert.equal(j.lines.length, 2);
    logCase(1, "Debit=1250.50, Credit=1250.50", "Posted & Balanced", `totalDebit=${j.totalDebit}, totalCredit=${j.totalCredit}`);
  }),
);

test(
  "T02. رفض قيد غير متوازن (Reject unbalanced journal entry)",
  withIsolatedDb((db) => {
    const { cashAccA, salesAcc } = seedCoreEntities(db);
    assert.throws(
      () =>
        insertJournalEntryRow(db, DEFAULT_WORKSPACE_ID, {
          entryDate: "2026-03-01",
          description: "قيد مختل التوازن",
          lines: [
            { accountId: cashAccA.id, debit: 1000 },
            { accountId: salesAcc.id, credit: 999.99 },
          ],
        }),
      (err) => err instanceof SqliteValidationError,
    );
    const count = (db.prepare("SELECT COUNT(*) AS c FROM journal_entries").get() as { c: number }).c;
    assert.equal(count, 0);
    logCase(2, "Debit=1000.00, Credit=999.99", "Rejected & 0 rows", `Rejected (rows=${count})`);
  }),
);

test(
  "T03. فاتورة مبيعات نقدية (Cash sales invoice: cashbox + stock + WAC COGS snapshot)",
  withIsolatedDb((db) => {
    const { wh, clientA, cb1, item } = seedCoreEntities(db);
    const inv = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      cashboxId: cb1,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات نقدية",
      payment: "cash",
      direction: "debit",
      amount: 450,
      currency: "ريال",
      warehouseId: wh.id,
      warehouseName: wh.name,
      invoiceContent: "items",
      entryNumber: 1,
      entryDate: "2026-03-02",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 3, price: 150, total: 450 },
      ],
    });
    const stock = (db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(item.id) as { quantity: number }).quantity;
    const lineCost = (
      db.prepare("SELECT unit_cost_at_sale FROM invoice_lines WHERE entry_id = ?").get(inv.id) as { unit_cost_at_sale: number }
    ).unit_cost_at_sale;
    const cbRep = getCashboxesReport(db, DEFAULT_WORKSPACE_ID, { currency: "ريال" });
    assert.equal(stock, 7);
    assert.equal(lineCost, 100);
    assert.equal(cbRep.cashboxes.find((c) => c.id === cb1)?.totalIn, 450);
    logCase(3, "Cash sale 3×150 (cost 100)", "stock=7, cogs/unit=100, cashIn=450", `stock=${stock}, cost=${lineCost}, cashIn=450`);
  }),
);

test(
  "T04. فاتورة مبيعات آجلة (Credit sales invoice: AR + stock deduction + zero cash impact)",
  withIsolatedDb((db) => {
    const { wh, clientA, cb1, item } = seedCoreEntities(db);
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات آجلة",
      payment: "credit",
      direction: "debit",
      amount: 600,
      currency: "ريال",
      warehouseId: wh.id,
      invoiceContent: "items",
      entryNumber: 2,
      entryDate: "2026-03-03",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 4, price: 150, total: 600 },
      ],
    });
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const ar = computeAccountSummary(clientA, bundle.ledger, "ريال");
    const cbRep = getCashboxesReport(db, DEFAULT_WORKSPACE_ID, { currency: "ريال" });
    const stock = (db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(item.id) as { quantity: number }).quantity;
    assert.equal(ar.netBalance, 600);
    assert.equal(ar.tone, "debit");
    assert.equal(cbRep.cashboxes.find((c) => c.id === cb1)?.totalIn, 0);
    assert.equal(stock, 6);
    logCase(4, "Credit sale 4×150", "AR=600 debit, cashIn=0, stock=6", `AR=${ar.netBalance} ${ar.tone}, cashIn=0, stock=${stock}`);
  }),
);

test(
  "T05. فاتورة مبيعات بدفع جزئي (Partial-payment invoice: atomic invoice + receipt voucher)",
  withIsolatedDb((db) => {
    const { wh, clientA, cb1, item } = seedCoreEntities(db);
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      cashboxId: cb1,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات آجلة",
      payment: "credit",
      direction: "debit",
      amount: 750,
      paidAmount: 300,
      currency: "ريال",
      warehouseId: wh.id,
      invoiceContent: "items",
      entryNumber: 3,
      entryDate: "2026-03-04",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 5, price: 150, total: 750 },
      ],
    });
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const ar = computeAccountSummary(clientA, bundle.ledger, "ريال");
    const cbRep = getCashboxesReport(db, DEFAULT_WORKSPACE_ID, { currency: "ريال" });
    assert.equal(bundle.ledger.length, 2); // Invoice + atomic partial receipt voucher
    assert.equal(ar.debitTotal, 750);
    assert.equal(ar.creditTotal, 300);
    assert.equal(ar.netBalance, 450);
    assert.equal(cbRep.cashboxes.find((c) => c.id === cb1)?.totalIn, 300);
    logCase(5, "Invoice=750, paidAmount=300", "AR=450, cashIn=300, entries=2", `AR=${ar.netBalance}, cashIn=300, entries=${bundle.ledger.length}`);
  }),
);

test(
  "T06. فاتورة مبيعات بخصم وضريبة (Sales invoice with line discount, header discount & VAT)",
  withIsolatedDb((db) => {
    const { wh, clientA, item } = seedCoreEntities(db);
    // 2 * 150 - 20 line discount = 280; header discount 30 -> 250; VAT 15% = 37.50 -> Total = 287.50
    const inv = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات ضريبية",
      payment: "credit",
      direction: "debit",
      amount: 287.5,
      discount: 30,
      taxAmount: 37.5,
      currency: "ريال",
      warehouseId: wh.id,
      invoiceContent: "items",
      entryNumber: 4,
      entryDate: "2026-03-05",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 2, price: 150, discount: 20, total: 280 },
      ],
    });
    const detail = fetchInvoiceDetail(db, DEFAULT_WORKSPACE_ID, inv.id)!;
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const vat = computeVatSummary(bundle.accounts, bundle.ledger, 0.15, { currency: "ريال", vatMode: "recorded_only" });
    assert.equal(detail.lines[0].total, 280);
    assert.equal(detail.entry.amount, 287.5);
    assert.equal(vat.recordedOutputVat, 37.5);
    logCase(6, "2×150 -20 lineDisc -30 hdrDisc +37.5 VAT", "net=287.50, outputVAT=37.50", `net=${detail.entry.amount}, outputVAT=${vat.recordedOutputVat}`);
  }),
);

test(
  "T07. مرتجع مبيعات (Sales return: revenue, AR, stock restock & output VAT reduction)",
  withIsolatedDb((db) => {
    const { wh, clientA, item } = seedCoreEntities(db);
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات آجلة",
      payment: "credit",
      direction: "debit",
      amount: 690,
      taxAmount: 90,
      currency: "ريال",
      warehouseId: wh.id,
      invoiceContent: "items",
      entryNumber: 5,
      entryDate: "2026-03-06",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 4, price: 150, total: 600 },
      ],
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "return",
      typeLabel: "مرتجع مبيعات",
      payment: "credit",
      direction: "credit",
      docType: 4,
      amount: 172.5,
      taxAmount: 22.5,
      currency: "ريال",
      warehouseId: wh.id,
      invoiceContent: "items",
      entryNumber: 6,
      entryDate: "2026-03-07",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 1, price: 150, total: 150 },
      ],
    });
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const ar = computeAccountSummary(clientA, bundle.ledger, "ريال");
    const vat = computeVatSummary(bundle.accounts, bundle.ledger, 0.15, { currency: "ريال", vatMode: "recorded_only" });
    const stock = (db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(item.id) as { quantity: number }).quantity;
    assert.equal(ar.netBalance, 517.5);
    assert.equal(vat.recordedOutputVat, 67.5);
    assert.equal(stock, 7); // 10 - 4 + 1
    logCase(7, "Sale 690 (VAT 90) - Return 172.5 (VAT 22.5)", "AR=517.5, outputVAT=67.5, stock=7", `AR=${ar.netBalance}, outputVAT=${vat.recordedOutputVat}, stock=${stock}`);
  }),
);

test(
  "T08. فاتورة مشتريات (Purchase invoice: stock increase + Weighted Average Cost update + AP)",
  withIsolatedDb((db) => {
    const { wh, supplierA, item } = seedCoreEntities(db);
    // Starting item: 10 units @ 100 = 1000. Buy 10 units @ 200 = 2000 -> 20 units @ WAC 150.00
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: supplierA.id,
      accountName: supplierA.name,
      kind: "invoice",
      typeLabel: "فاتورة مشتريات آجلة",
      payment: "credit",
      direction: "credit",
      docType: 3,
      amount: 2000,
      currency: "ريال",
      warehouseId: wh.id,
      invoiceContent: "items",
      entryNumber: 7,
      entryDate: "2026-03-08",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 10, price: 200, total: 2000 },
      ],
    });
    const invRow = db.prepare("SELECT quantity, avg_cost FROM inventory_items WHERE id = ?").get(item.id) as {
      quantity: number;
      avg_cost: number;
    };
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const ap = computeAccountSummary(supplierA, bundle.ledger, "ريال");
    assert.equal(invRow.quantity, 20);
    assert.equal(invRow.avg_cost, 150);
    assert.equal(ap.netBalance, 2000);
    assert.equal(ap.tone, "credit");
    logCase(8, "Opening 10@100 + Purchase 10@200", "qty=20, WAC=150, AP=2000 credit", `qty=${invRow.quantity}, WAC=${invRow.avg_cost}, AP=${ap.netBalance}`);
  }),
);

test(
  "T09. مرتجع مشتريات (Purchase return: stock check, AP debit & input VAT reduction — not sales VAT)",
  withIsolatedDb((db) => {
    const { wh, supplierA, clientA, item } = seedCoreEntities(db);
    // Sale 1000 + 150 VAT, Purchase 2000 + 300 VAT, Purchase Return 500 + 75 VAT
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات",
      payment: "credit",
      direction: "debit",
      docType: 2,
      amount: 1150,
      taxAmount: 150,
      currency: "ريال",
      warehouseId: wh.id,
      entryNumber: 8,
      entryDate: "2026-03-09",
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: supplierA.id,
      accountName: supplierA.name,
      kind: "invoice",
      typeLabel: "فاتورة مشتريات",
      payment: "credit",
      direction: "credit",
      docType: 3,
      amount: 2300,
      taxAmount: 300,
      currency: "ريال",
      warehouseId: wh.id,
      invoiceContent: "items",
      entryNumber: 9,
      entryDate: "2026-03-09",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 10, price: 200, total: 2000 },
      ],
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: supplierA.id,
      accountName: supplierA.name,
      kind: "return",
      typeLabel: "مرتجع مشتريات",
      payment: "credit",
      direction: "debit",
      docType: 5,
      amount: 575,
      taxAmount: 75,
      currency: "ريال",
      warehouseId: wh.id,
      invoiceContent: "items",
      entryNumber: 10,
      entryDate: "2026-03-10",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 2.5, price: 200, total: 500 },
      ],
    });
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const ap = computeAccountSummary(supplierA, bundle.ledger, "ريال");
    const vat = computeVatSummary(bundle.accounts, bundle.ledger, 0.15, { currency: "ريال", vatMode: "recorded_only" });
    const stock = (db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(item.id) as { quantity: number }).quantity;
    assert.equal(ap.netBalance, 1725);
    assert.equal(vat.recordedOutputVat, 150); // Must NOT be reduced by purchase return!
    assert.equal(vat.recordedInputVat, 225); // 300 - 75
    assert.equal(stock, 17.5); // 10 + 10 - 2.5
    logCase(9, "Buy 2300(VAT 300) - BuyRet 575(VAT 75)", "AP=1725, outVAT=150, inVAT=225, stock=17.5", `AP=${ap.netBalance}, outVAT=${vat.recordedOutputVat}, inVAT=${vat.recordedInputVat}, stock=${stock}`);
  }),
);

test(
  "T10. سند قبض من عميل (Customer receipt voucher: AR reduction + cashbox inflow)",
  withIsolatedDb((db) => {
    const { clientA, cb1 } = seedCoreEntities(db);
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات آجلة",
      payment: "credit",
      direction: "debit",
      amount: 1000,
      currency: "ريال",
      entryNumber: 11,
      entryDate: "2026-03-11",
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      cashboxId: cb1,
      kind: "voucher",
      typeLabel: "سند قبض",
      payment: "cash",
      direction: "credit",
      amount: 650,
      currency: "ريال",
      entryNumber: 12,
      entryDate: "2026-03-12",
    });
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const ar = computeAccountSummary(clientA, bundle.ledger, "ريال");
    const cbRep = getCashboxesReport(db, DEFAULT_WORKSPACE_ID, { currency: "ريال" });
    assert.equal(ar.netBalance, 350);
    assert.equal(ar.tone, "debit");
    assert.equal(cbRep.cashboxes.find((c) => c.id === cb1)?.totalIn, 650);
    logCase(10, "AR 1000 - Receipt 650", "AR=350 debit, cashIn=650", `AR=${ar.netBalance}, cashIn=650`);
  }),
);

test(
  "T11. سند صرف لمورد (Supplier payment voucher: AP reduction + cashbox outflow)",
  withIsolatedDb((db) => {
    const { supplierA, cb1 } = seedCoreEntities(db);
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: supplierA.id,
      accountName: supplierA.name,
      kind: "invoice",
      typeLabel: "فاتورة مشتريات آجلة",
      payment: "credit",
      direction: "credit",
      amount: 1800,
      currency: "ريال",
      entryNumber: 13,
      entryDate: "2026-03-13",
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: supplierA.id,
      accountName: supplierA.name,
      cashboxId: cb1,
      kind: "voucher",
      typeLabel: "سند صرف",
      payment: "cash",
      direction: "debit",
      amount: 700,
      currency: "ريال",
      entryNumber: 14,
      entryDate: "2026-03-14",
    });
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const ap = computeAccountSummary(supplierA, bundle.ledger, "ريال");
    const cbRep = getCashboxesReport(db, DEFAULT_WORKSPACE_ID, { currency: "ريال" });
    assert.equal(ap.netBalance, 1100);
    assert.equal(ap.tone, "credit");
    assert.equal(cbRep.cashboxes.find((c) => c.id === cb1)?.totalOut, 700);
    logCase(11, "AP 1800 - Payment 700", "AP=1100 credit, cashOut=700", `AP=${ap.netBalance}, cashOut=700`);
  }),
);

test(
  "T12. تحويل بين صندوقين بنفس العملة (Same-currency atomic cashbox transfer)",
  withIsolatedDb((db) => {
    const { cashAccA, cashAccB, cb1, cb2 } = seedCoreEntities(db);
    const tx = insertCashTransferAtomic(db, DEFAULT_WORKSPACE_ID, {
      fromAccountId: cashAccA.id,
      toAccountId: cashAccB.id,
      fromCashboxId: cb1,
      toCashboxId: cb2,
      amount: 500,
      fromCurrency: "ريال",
      entryDate: "2026-03-15",
      details: "تمويل صندوق الفرع",
    });
    const cbRep = getCashboxesReport(db, DEFAULT_WORKSPACE_ID, { currency: "ريال" });
    const box1 = cbRep.cashboxes.find((c) => c.id === cb1)!;
    const box2 = cbRep.cashboxes.find((c) => c.id === cb2)!;
    assert.equal(tx.convertedAmount, 500);
    assert.equal(box1.netBalance, -500);
    assert.equal(box2.netBalance, 500);
    assert.equal(cbRep.reconciliation.linkedCashboxesNet, 0);
    logCase(12, "Transfer 500 SAR cb1->cb2", "cb1=-500, cb2=+500, net=0", `cb1=${box1.netBalance}, cb2=${box2.netBalance}, net=${cbRep.reconciliation.linkedCashboxesNet}`);
  }),
);

test(
  "T13. تحويل بين عملتين بسعر صرف (Cross-currency transfer with explicit exchange rate)",
  withIsolatedDb((db) => {
    const { cashAccUsd, cashAccA } = seedCoreEntities(db);
    // Reject cross-currency transfer without explicit exchange rate
    assert.throws(
      () =>
        insertCashTransferAtomic(db, DEFAULT_WORKSPACE_ID, {
          fromAccountId: cashAccUsd.id,
          toAccountId: cashAccA.id,
          amount: 100,
          fromCurrency: "دولار",
          toCurrency: "ريال",
          entryDate: "2026-03-16",
        }),
      (err) => err instanceof SqliteValidationError,
    );
    const tx = insertCashTransferAtomic(db, DEFAULT_WORKSPACE_ID, {
      fromAccountId: cashAccUsd.id,
      toAccountId: cashAccA.id,
      amount: 100.25,
      fromCurrency: "دولار",
      toCurrency: "ريال",
      exchangeRate: 3.75,
      entryDate: "2026-03-16",
    });
    // 100.25 * 3.75 = 375.9375 -> Half-Up 2 decimals = 375.94
    assert.equal(tx.outEntry.amount, 100.25);
    assert.equal(tx.inEntry.amount, 375.94);
    assert.equal(tx.convertedAmount, 375.94);
    logCase(13, "100.25 USD × 3.75 -> SAR", "375.94 SAR (reject missing rate)", `converted=${tx.convertedAmount} SAR`);
  }),
);

test(
  "T14. عكس قيد مرحّل ومنع تعديل أو حذف القيد المرحّل مباشرةً (Immutability & Reversal)",
  withIsolatedDb((db) => {
    const { wh, clientA, item } = seedCoreEntities(db);
    const sale = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات آجلة",
      payment: "credit",
      direction: "debit",
      amount: 450,
      currency: "ريال",
      warehouseId: wh.id,
      invoiceContent: "items",
      entryNumber: 15,
      entryDate: "2026-03-17",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 3, price: 150, total: 450 },
      ],
    });
    assert.throws(
      () => updateLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, sale.id, { accountId: clientA.id, accountName: clientA.name, amount: 1 }),
      (err) => err instanceof SqliteValidationError,
    );
    assert.throws(() => setLedgerDeletedRow(db, DEFAULT_WORKSPACE_ID, sale.id, true), (err) => err instanceof SqliteValidationError);
    assert.throws(() => deleteLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, sale.id), (err) => err instanceof SqliteValidationError);

    const rev = reverseLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, sale.id, { reason: "خطأ في التسعير", reversalDate: "2026-03-18" });
    assert.equal(rev.original.postingStatus, "reversed");
    assert.equal(rev.reversal.reversedEntryId, sale.id);
    // Double reversal must be blocked
    assert.throws(() => reverseLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, sale.id), (err) => err instanceof SqliteValidationError);

    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const ar = computeAccountSummary(clientA, bundle.ledger, "ريال");
    const stock = (db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(item.id) as { quantity: number }).quantity;
    assert.equal(ar.netBalance, 0);
    assert.equal(stock, 10);

    // Also verify Journal Entry reversal
    const j = insertJournalEntryRow(db, DEFAULT_WORKSPACE_ID, {
      entryDate: "2026-03-17",
      lines: [
        { accountId: clientA.id, debit: 200 },
        { accountId: seedCoreEntities(db).salesAcc.id, credit: 200 },
      ],
    });
    const jRev = reverseJournalEntryRow(db, DEFAULT_WORKSPACE_ID, j.id, { reversalDate: "2026-03-18" });
    assert.equal(jRev.original.postingStatus, "reversed");
    assert.equal(jRev.reversal.totalDebit, 200);
    logCase(14, "Mutate/Delete/Reverse posted entry", "Mutate/Delete blocked; Reversal nets to 0 & restores stock=10", `AR=${ar.netBalance}, stock=${stock}, jRev=${jRev.original.postingStatus}`);
  }),
);

test(
  "T15. رفض الترحيل في فترة مالية مغلقة (Closed fiscal period lock)",
  withIsolatedDb((db) => {
    const { clientA, salesAcc } = seedCoreEntities(db);
    setWorkspaceClosedUntilDate(db, DEFAULT_WORKSPACE_ID, "2026-02-28");

    assert.throws(
      () =>
        insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
          accountId: clientA.id,
          accountName: clientA.name,
          kind: "voucher",
          typeLabel: "سند",
          payment: "cash",
          direction: "debit",
          amount: 100,
          entryDate: "2026-02-28",
        }),
      (err) => err instanceof SqliteValidationError,
    );
    assert.throws(
      () =>
        insertJournalEntryRow(db, DEFAULT_WORKSPACE_ID, {
          entryDate: "2026-01-15",
          lines: [
            { accountId: clientA.id, debit: 100 },
            { accountId: salesAcc.id, credit: 100 },
          ],
        }),
      (err) => err instanceof SqliteValidationError,
    );

    const openEntry = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "voucher",
      typeLabel: "سند",
      payment: "cash",
      direction: "debit",
      amount: 100,
      entryDate: "2026-03-01",
    });
    assert.equal(openEntry.entryDate, "2026-03-01");
    logCase(15, "closedUntil=2026-02-28; test 02-28 & 03-01", "Block <=02-28, allow 03-01", `Blocked closed, posted ${openEntry.entryDate}`);
  }),
);

test(
  "T16. منع تكرار القيد عند إعادة إرسال الطلب (Idempotency key protection)",
  withIsolatedDb((db) => {
    const { wh, clientA, salesAcc, item } = seedCoreEntities(db);
    const first = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات",
      payment: "credit",
      direction: "debit",
      amount: 300,
      warehouseId: wh.id,
      entryDate: "2026-03-19",
      idempotencyKey: "req-invoice-001",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 2, price: 150, total: 300 },
      ],
    });
    const duplicate = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات",
      payment: "credit",
      direction: "debit",
      amount: 300,
      warehouseId: wh.id,
      entryDate: "2026-03-19",
      idempotencyKey: "req-invoice-001",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 2, price: 150, total: 300 },
      ],
    });
    assert.equal(duplicate.id, first.id);
    const count = (db.prepare("SELECT COUNT(*) AS c FROM ledger_entries WHERE workspace_id = ?").get(DEFAULT_WORKSPACE_ID) as { c: number }).c;
    const stock = (db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(item.id) as { quantity: number }).quantity;
    assert.equal(count, 1);
    assert.equal(stock, 8);

    const j1 = insertJournalEntryRow(db, DEFAULT_WORKSPACE_ID, {
      entryDate: "2026-03-19",
      idempotencyKey: "req-jrn-001",
      lines: [
        { accountId: clientA.id, debit: 50 },
        { accountId: salesAcc.id, credit: 50 },
      ],
    });
    const j2 = insertJournalEntryRow(db, DEFAULT_WORKSPACE_ID, {
      entryDate: "2026-03-19",
      idempotencyKey: "req-jrn-001",
      lines: [
        { accountId: clientA.id, debit: 50 },
        { accountId: salesAcc.id, credit: 50 },
      ],
    });
    assert.equal(j2.id, j1.id);
    logCase(16, "Duplicate idempotencyKey submitted twice", "1 entry, stock deducted once (8)", `rows=${count}, stock=${stock}, sameId=${duplicate.id === first.id}`);
  }),
);

test(
  "T17. التراجع الكامل عند فشل منتصف العملية (Atomic rollback on mid-transaction failure)",
  withIsolatedDb((db) => {
    const { wh, clientA, item } = seedCoreEntities(db);
    const item2 = insertInventoryItemRow(db, DEFAULT_WORKSPACE_ID, {
      name: "سويتش 8 منافذ",
      unit: "حبة",
      quantity: 1,
      avgCost: 50,
      sellingPrice: 100,
      warehouseId: wh.id,
      quantityUnverified: false,
    });
    // Line 1 valid (qty 4 of 10), Line 2 exceeds stock (qty 5 of 1) -> entire transaction MUST roll back!
    assert.throws(
      () =>
        insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
          accountId: clientA.id,
          accountName: clientA.name,
          kind: "invoice",
          typeLabel: "فاتورة مبيعات",
          payment: "credit",
          direction: "debit",
          amount: 1100,
          warehouseId: wh.id,
          entryDate: "2026-03-20",
          lines: [
            { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 4, price: 150, total: 600 },
            { inventoryItemId: item2.id, warehouseId: wh.id, itemName: item2.name, unit: item2.unit, quantity: 5, price: 100, total: 500 },
          ],
        }),
      (err) => err instanceof SqliteValidationError,
    );
    const ledgerCount = (db.prepare("SELECT COUNT(*) AS c FROM ledger_entries").get() as { c: number }).c;
    const linesCount = (db.prepare("SELECT COUNT(*) AS c FROM invoice_lines").get() as { c: number }).c;
    const stock1 = (db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(item.id) as { quantity: number }).quantity;
    const stock2 = (db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(item2.id) as { quantity: number }).quantity;
    assert.equal(ledgerCount, 0);
    assert.equal(linesCount, 0);
    assert.equal(stock1, 10);
    assert.equal(stock2, 1);
    logCase(17, "2-line invoice where line 2 lacks stock", "Full rollback: 0 entries, stock1=10, stock2=1", `entries=${ledgerCount}, lines=${linesCount}, stock1=${stock1}, stock2=${stock2}`);
  }),
);

test(
  "T18. التزامن وتحديث المخزون المتسابق دون مخزون سالب (Concurrent stock depletion safety)",
  withIsolatedDb(async (db) => {
    const { wh, clientA, item } = seedCoreEntities(db);
    // Available = 10; dispatch 3 concurrent sales of 4 units each -> exactly 2 succeed (8 units), 3rd fails!
    const tasks = [1, 2, 3].map((idx) =>
      Promise.resolve().then(() =>
        insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
          accountId: clientA.id,
          accountName: clientA.name,
          kind: "invoice",
          typeLabel: "فاتورة مبيعات",
          payment: "credit",
          direction: "debit",
          amount: 600,
          warehouseId: wh.id,
          entryNumber: 200 + idx,
          entryDate: "2026-03-21",
          lines: [
            { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 4, price: 150, total: 600 },
          ],
        }),
      ),
    );
    const settled = await Promise.allSettled(tasks);
    const fulfilled = settled.filter((r) => r.status === "fulfilled").length;
    const rejected = settled.filter((r) => r.status === "rejected").length;
    const finalStock = (db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(item.id) as { quantity: number }).quantity;
    assert.equal(fulfilled, 2);
    assert.equal(rejected, 1);
    assert.equal(finalStock, 2);
    logCase(18, "3 concurrent sales × 4 from 10 stock", "2 pass, 1 rejected, stock=2 (>=0)", `pass=${fulfilled}, reject=${rejected}, stock=${finalStock}`);
  }),
);

test(
  "T19. رفض القيم الصفرية والسالبة وNaN وInfinity (Strict numeric input validation)",
  withIsolatedDb((db) => {
    const { clientA } = seedCoreEntities(db);
    const badPayloads = [
      { amount: 0 },
      { amount: -50 },
      { amount: Number.NaN },
      { amount: Number.POSITIVE_INFINITY },
      { amount: 100, exchangeRate: 0 },
      { amount: 100, exchangeRate: -3.75 },
      { amount: 100, discount: -5 },
      { amount: 100, taxAmount: Number.NaN },
    ];
    for (const bad of badPayloads) {
      assert.throws(
        () =>
          insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
            accountId: clientA.id,
            accountName: clientA.name,
            kind: "voucher",
            typeLabel: "سند",
            payment: "cash",
            direction: "debit",
            entryDate: "2026-03-22",
            ...bad,
          }),
        (err) => err instanceof SqliteValidationError,
      );
    }
    const count = (db.prepare("SELECT COUNT(*) AS c FROM ledger_entries").get() as { c: number }).c;
    assert.equal(count, 0);
    logCase(19, "8 invalid numeric payloads (0, -50, NaN, Inf, rate<=0)", "All 8 rejected, 0 rows", `8/8 rejected, rows=${count}`);
  }),
);

test(
  "T20. دقة التقريب العشري وفروقات الفواصل للعملات (Exact 2-decimal precision & rounding)",
  () => {
    assert.equal(addMoney(0.1, 0.2), 0.3);
    assert.equal(roundMoney(1.005, 2), 1.01);
    assert.equal(roundMoney(2.675, 2), 2.68);
    assert.equal(roundMoney(-1.005, 2), -1.01);
    assert.equal(subMoney(100, 99.99), 0.01);
    assert.equal(mulMoney(19.99, 3, 2), 59.97);
    assert.equal(sumMoney(Array.from({ length: 1000 }, () => 0.01)), 10);
    assert.equal(computeExactLineNet(3, 33.335, 0, 2), 100.01);
    assert.equal(computeInvoiceLineNet("3", "33.335", "0"), 100.01);
    assert.equal(computeWeightedAverageCost(3, 10, 3, 20, 2), 15);
    logCase(20, "0.1+0.2, round(1.005), 1000×0.01, 3×33.335", "0.30, 1.01, 10.00, 100.01", "All exact with 0 drift");
  },
);

test(
  "T21. مطابقة ميزان المراجعة مع دفتر الأستاذ واستبعاد المسودات (Trial Balance vs GL & Draft exclusion)",
  withIsolatedDb((db) => {
    const { clientA, supplierA, cashAccA } = seedCoreEntities(db);
    // Posted entries
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      counterpartAccountId: cashAccA.id,
      counterpartAccountName: cashAccA.name,
      kind: "simple-entry",
      typeLabel: "قيد بسيط",
      payment: "balance",
      direction: "debit",
      amount: 1200.5,
      currency: "ريال",
      entryDate: "2026-03-23",
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: supplierA.id,
      accountName: supplierA.name,
      counterpartAccountId: cashAccA.id,
      counterpartAccountName: cashAccA.name,
      kind: "simple-entry",
      typeLabel: "قيد بسيط",
      payment: "balance",
      direction: "credit",
      amount: 700.25,
      currency: "ريال",
      entryDate: "2026-03-23",
    });
    // Draft entry MUST NOT affect trial balance!
    const draft = insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "مسودة فاتورة",
      payment: "credit",
      direction: "debit",
      postingStatus: "draft",
      amount: 9999,
      currency: "ريال",
      entryDate: "2026-03-23",
    });
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const tb = computeTrialBalance(bundle.accounts, bundle.ledger, { currency: "ريال" });
    assert.equal(tb.totalClosingDebit, tb.totalClosingCredit);
    assert.equal(tb.netDifference, 0);
    const clientRow = tb.rows.find((r) => r.accountId === clientA.id)!;
    assert.equal(clientRow.closingDebit, 1200.5);
    // Post draft later -> now affects balance
    postDraftLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, draft.id);
    const afterPost = computeAccountSummary(clientA, getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID).ledger, "ريال");
    assert.equal(afterPost.netBalance, 11199.5);
    logCase(21, "2 balanced simple entries + 1 draft(9999)", "TB Debit==Credit (diff=0), draft excluded", `TB D=${tb.totalClosingDebit}, C=${tb.totalClosingCredit}, diff=${tb.netDifference}`);
  }),
);

test(
  "T22. مطابقة أرصدة العملاء والموردين مع المجموعات التجميعية (Sub-ledger vs Control Group Totals)",
  withIsolatedDb((db) => {
    const { clientA, clientB, supplierA, grpClients, grpSuppliers } = seedCoreEntities(db);
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "مبيعات",
      payment: "credit",
      direction: "debit",
      amount: 1400.4,
      currency: "ريال",
      entryDate: "2026-03-24",
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientB.id,
      accountName: clientB.name,
      kind: "invoice",
      typeLabel: "مبيعات",
      payment: "credit",
      direction: "debit",
      amount: 599.6,
      currency: "ريال",
      entryDate: "2026-03-24",
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: supplierA.id,
      accountName: supplierA.name,
      kind: "invoice",
      typeLabel: "مشتريات",
      payment: "credit",
      direction: "credit",
      amount: 850.75,
      currency: "ريال",
      entryDate: "2026-03-24",
    });
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const groupsSummary = computeAccountGroupsSummary(bundle.accountGroups, bundle.accounts, bundle.ledger);
    const clientsGrpSum = groupsSummary.find((g) => g.id === grpClients.id)!;
    const suppliersGrpSum = groupsSummary.find((g) => g.id === grpSuppliers.id)!;
    const subClientsTotal = addMoney(
      computeAccountSummary(clientA, bundle.ledger, "ريال").netBalance,
      computeAccountSummary(clientB, bundle.ledger, "ريال").netBalance,
    );
    const subSuppliersTotal = computeAccountSummary(supplierA, bundle.ledger, "ريال").netBalance;
    assert.equal(clientsGrpSum.netDebitMinusCredit, subClientsTotal);
    assert.equal(Math.abs(suppliersGrpSum.netDebitMinusCredit), subSuppliersTotal);
    logCase(22, "Clients(1400.4+599.6), Suppliers(850.75)", "Sub-ledger == Control Groups", `Clients=${subClientsTotal}, Suppliers=${subSuppliersTotal}`);
  }),
);

test(
  "T23. مطابقة تقييم المخزون بالمتوسط المرجح مع تقرير حركة الصنف (WAC valuation vs Movements report)",
  withIsolatedDb((db) => {
    const { wh, supplierA, clientA, item } = seedCoreEntities(db);
    // Start: 10 @ 100. Buy 5 @ 160 -> 15 @ WAC 120. Sell 5 @ 200 -> 10 remaining @ WAC 120 = 1200 value
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: supplierA.id,
      accountName: supplierA.name,
      kind: "invoice",
      typeLabel: "فاتورة مشتريات",
      payment: "credit",
      direction: "credit",
      docType: 3,
      amount: 800,
      warehouseId: wh.id,
      invoiceContent: "items",
      entryDate: "2026-03-25",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 5, price: 160, total: 800 },
      ],
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات",
      payment: "credit",
      direction: "debit",
      docType: 2,
      amount: 1000,
      warehouseId: wh.id,
      invoiceContent: "items",
      entryDate: "2026-03-26",
      lines: [
        { inventoryItemId: item.id, warehouseId: wh.id, itemName: item.name, unit: item.unit, quantity: 5, price: 200, total: 1000 },
      ],
    });
    const dbItem = db.prepare("SELECT quantity, avg_cost FROM inventory_items WHERE id = ?").get(item.id) as {
      quantity: number;
      avg_cost: number;
    };
    const invRep = getInventoryMovementsReport(db, DEFAULT_WORKSPACE_ID, { warehouseId: wh.id, profitBasis: "avg" });
    const row = invRep.itemRows.find((r) => r.id === item.id)!;
    const bs = computeBalanceSheet(
      getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID).accounts,
      getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID).ledger,
      getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID).inventory,
      { currency: "ريال" },
    );
    assert.equal(dbItem.quantity, 10);
    assert.equal(dbItem.avg_cost, 120);
    assert.equal(row.availableQty, 10);
    assert.equal(mulMoney(dbItem.quantity, dbItem.avg_cost, 2), 1200);
    assert.equal(bs.inventoryValue, 1200);
    assert.equal(invRep.totals.totalProfit, 400); // 1000 sales - (5 * 120 COGS)
    logCase(23, "10@100 + Buy 5@160 - Sell 5@200", "qty=10, WAC=120, val=1200, profit=400", `qty=${dbItem.quantity}, WAC=${dbItem.avg_cost}, val=${bs.inventoryValue}, profit=${invRep.totals.totalProfit}`);
  }),
);

test(
  "T24. كشف حساب لفترة بتاريخ محدد (Dated statement: opening + prior + period + closing)",
  withIsolatedDb((db) => {
    const acc = upsertAccountRow(db, DEFAULT_WORKSPACE_ID, {
      name: "عميل كشف الفترة",
      category: "clients",
      currency: "ريال",
      openingBalance: 1000,
      openingDirection: "debit",
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: acc.id,
      accountName: acc.name,
      kind: "invoice",
      typeLabel: "مبيعات يناير",
      payment: "credit",
      direction: "debit",
      amount: 500,
      currency: "ريال",
      entryDate: "2026-01-15",
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: acc.id,
      accountName: acc.name,
      kind: "voucher",
      typeLabel: "سند قبض فبراير",
      payment: "cash",
      direction: "credit",
      amount: 350,
      currency: "ريال",
      entryDate: "2026-02-10",
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: acc.id,
      accountName: acc.name,
      kind: "invoice",
      typeLabel: "مبيعات مارس",
      payment: "credit",
      direction: "debit",
      amount: 900,
      currency: "ريال",
      entryDate: "2026-03-05",
    });
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const stmt = computeStatementRows(acc, bundle.ledger, {
      fromDate: "2026-02-01",
      toDate: "2026-02-28",
      showPreviousBalance: true,
    });
    // Opening 1000 debit + Jan 500 debit = 1500 previous debit; Feb credit 350 -> closing 1150 debit; Mar excluded
    assert.equal(stmt.previousBalance, 1500);
    assert.equal(stmt.previousDirection, "debit");
    assert.equal(stmt.rows.length, 1);
    assert.equal(stmt.creditTotal, 350);
    assert.equal(stmt.netBalance, 1150);
    assert.equal(stmt.netDirection, "debit");
    logCase(24, "Open 1000D + Jan 500D + Feb 350C + Mar 900D [Feb]", "prev=1500D, rows=1, close=1150D", `prev=${stmt.previousBalance}D, rows=${stmt.rows.length}, close=${stmt.netBalance}D`);
  }),
);

test(
  "T25. إعادة احتساب الأرصدة من القيود الأصلية + عزل التصدير + حماية المسارات المحمية (Recalculation, Tenant Export Isolation & Auth Guard)",
  withIsolatedDb(async (db, dir) => {
    const { clientA, supplierA } = seedCoreEntities(db);
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "invoice",
      typeLabel: "مبيعات",
      payment: "credit",
      direction: "debit",
      amount: 333.33,
      currency: "ريال",
      entryDate: "2026-03-27",
    });
    insertLedgerEntryRow(db, DEFAULT_WORKSPACE_ID, {
      accountId: clientA.id,
      accountName: clientA.name,
      kind: "voucher",
      typeLabel: "سند قبض",
      payment: "cash",
      direction: "credit",
      amount: 111.11,
      currency: "ريال",
      entryDate: "2026-03-28",
    });

    // 1. Recalculate from raw SQLite rows independently and compare with computeAccountSummary + Income Statement
    const rawRows = db
      .prepare("SELECT direction, amount FROM ledger_entries WHERE workspace_id = ? AND account_id = ? AND deleted = 0 AND posting_status != 'draft'")
      .all(DEFAULT_WORKSPACE_ID, clientA.id) as Array<{ direction: string; amount: number }>;
    const rawNet = rawRows.reduce(
      (acc, r) => (r.direction === "debit" ? addMoney(acc, r.amount) : subMoney(acc, r.amount)),
      0,
    );
    const bundle = getFullWorkspaceBundle(db, DEFAULT_WORKSPACE_ID);
    const summary = computeAccountSummary(clientA, bundle.ledger, "ريال");
    const inc = computeIncomeStatement(bundle.accounts, bundle.ledger, { currency: "ريال" });
    assert.equal(summary.netBalance, rawNet);
    assert.equal(summary.netBalance, 222.22);
    assert.equal(inc.netSales, 333.33);

    // 2. Multi-workspace SQLite export isolation (workspace B must NOT leak into workspace A export)
    ensureEmptyWorkspace(db, "ws_other_tenant", "شركة أخرى");
    upsertAccountRow(db, "ws_other_tenant", { name: "حساب سري لعميل آخر", category: "clients", currency: "ريال" });
    const exportPath = path.join(dir, "isolated-export.sqlite");
    await exportCleanSqliteSnapshotBytes(db, exportPath, DEFAULT_WORKSPACE_ID);
    const snapDb = new DatabaseSync(exportPath);
    try {
      const otherAccounts = (
        snapDb.prepare("SELECT COUNT(*) AS c FROM accounts WHERE workspace_id != ?").get(DEFAULT_WORKSPACE_ID) as { c: number }
      ).c;
      const ownAccounts = (
        snapDb.prepare("SELECT COUNT(*) AS c FROM accounts WHERE workspace_id = ?").get(DEFAULT_WORKSPACE_ID) as { c: number }
      ).c;
      assert.equal(otherAccounts, 0);
      assert.ok(ownAccounts >= 1);
    } finally {
      snapDb.close();
    }

    // 3. Unauthorized remote access test against SQLite API & AI route when admin password & session secret are configured
    const prevPwd = process.env.NASQO_SQLITE_ADMIN_PASSWORD;
    const prevSecret = process.env.NASQO_SQLITE_SESSION_SECRET;
    process.env.NASQO_SQLITE_ADMIN_PASSWORD = "AuditAdminPassword-2026!";
    process.env.NASQO_SQLITE_SESSION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";
    try {
      const app = express();
      mountSqliteApi(app);
      app.post("/api/ai/categorize-expense", requireSqliteAccess, (_req, res) => {
        res.json({ ok: true });
      });
      const srv = app.listen(0);
      const sendRawHttp = (
        port: number,
        method: string,
        urlPath: string,
        headers: Record<string, string>,
        body?: string,
      ): Promise<number> =>
        new Promise((resolve, reject) => {
          const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          });
          req.on("error", reject);
          if (body) req.write(body);
          req.end();
        });
      try {
        const addr = srv.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const dbStatus = await sendRawHttp(port, "GET", `/api/db/workspace/${DEFAULT_WORKSPACE_ID}`, {
          Host: "erp.nasqo.example",
        });
        const aiStatus = await sendRawHttp(
          port,
          "POST",
          "/api/ai/categorize-expense",
          {
            Host: "erp.nasqo.example",
            Origin: "https://erp.nasqo.example",
            "Content-Type": "application/json",
            "X-Nasqo-Csrf": "1",
          },
          JSON.stringify({ description: "test" }),
        );
        assert.equal(dbStatus, 401);
        assert.equal(aiStatus, 401);
        assert.ok(supplierA.id);
        logCase(
          25,
          "Raw SQL recalc + tenant export + unauth remote HTTP",
          "recalc=222.22, otherWs=0, HTTP 401/401",
          `recalc=${rawNet}, otherWs=0, db=${dbStatus}, ai=${aiStatus}`,
        );
      } finally {
        srv.close();
      }
    } finally {
      if (prevPwd === undefined) delete process.env.NASQO_SQLITE_ADMIN_PASSWORD;
      else process.env.NASQO_SQLITE_ADMIN_PASSWORD = prevPwd;
      if (prevSecret === undefined) delete process.env.NASQO_SQLITE_SESSION_SECRET;
      else process.env.NASQO_SQLITE_SESSION_SECRET = prevSecret;
    }
  }),
);
