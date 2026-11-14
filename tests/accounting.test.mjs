import test from "node:test";
import assert from "node:assert/strict";
import {
  accountMatchesQuery,
  buildCsvContent,
  computeAccountSummary,
  computeCategoryTotals,
  computeInventorySummary,
  computeStatementRows,
  normalizeArabicSearch,
  parseArabicNumber,
  sanitizeAccountPayload,
  sanitizeLedgerPayload,
} from "../src/accounting.ts";

const baseAccount = {
  id: "acc_1",
  ownerId: "user_1",
  name: "البراري للتوريد",
  category: "purchases",
  phone: "0558321042",
  creditLimit: 1000000,
  currency: "ريال",
  isCashAccount: false,
  accountImage: "1",
  sortOrder: 1,
  settlement: false,
  documentNumberRequired: false,
  messageMethod: "sms",
  sendMode: "never",
  note: "",
  openingBalance: 100000,
  openingDirection: "credit",
  codeNumber: 34,
};

test("parseArabicNumber parses Arabic/Persian digits and formatting commas", () => {
  assert.equal(parseArabicNumber("١٢٬٥٠٠٫٥"), 12500.5);
  assert.equal(parseArabicNumber("3,000"), 3000);
  assert.equal(parseArabicNumber("invalid"), 0);
  assert.equal(parseArabicNumber(""), 0);
});

test("normalizeArabicSearch strips tatweel and normalizes alef variants", () => {
  assert.equal(normalizeArabicSearch("نقـد هلال"), "نقد هلال");
  assert.equal(normalizeArabicSearch("إبراهيم وأحمد"), "ابراهيم واحمد");
});

test("computeAccountSummary computes balances from opening + debit/credit entries and ignores quotes/orders/deleted", () => {
  const entries = [
    {
      id: "e1",
      ownerId: "user_1",
      accountId: "acc_1",
      accountName: "البراري للتوريد",
      counterpartAccountId: "",
      counterpartAccountName: "",
      kind: "invoice",
      typeLabel: "فاتورة آجلة",
      payment: "credit",
      direction: "credit",
      amount: 50000,
      currency: "ريال",
      exchangeRate: 1,
      details: "توريد",
      documentNumber: "",
      warehouseId: "",
      warehouseName: "",
      invoiceContent: "items",
      entryNumber: 1,
      deleted: false,
      entryDate: "2026-01-01",
      createdAtMs: 100,
    },
    {
      id: "e2",
      ownerId: "user_1",
      accountId: "acc_1",
      accountName: "البراري للتوريد",
      counterpartAccountId: "",
      counterpartAccountName: "",
      kind: "voucher",
      typeLabel: "عليه",
      payment: "cash",
      direction: "debit",
      amount: 20000,
      currency: "ريال",
      exchangeRate: 1,
      details: "سداد",
      documentNumber: "",
      warehouseId: "",
      warehouseName: "",
      invoiceContent: "none",
      entryNumber: 2,
      deleted: false,
      entryDate: "2026-01-02",
      createdAtMs: 200,
    },
    {
      id: "e3",
      ownerId: "user_1",
      accountId: "acc_1",
      accountName: "البراري للتوريد",
      counterpartAccountId: "",
      counterpartAccountName: "",
      kind: "quote",
      typeLabel: "عرض سعر",
      payment: "credit",
      direction: "credit",
      amount: 99999,
      currency: "ريال",
      exchangeRate: 1,
      details: "عرض سعر غير ملزم",
      documentNumber: "",
      warehouseId: "",
      warehouseName: "",
      invoiceContent: "free",
      entryNumber: 3,
      deleted: false,
      entryDate: "2026-01-03",
      createdAtMs: 300,
    },
    {
      id: "e4",
      ownerId: "user_1",
      accountId: "acc_1",
      accountName: "البراري للتوريد",
      counterpartAccountId: "",
      counterpartAccountName: "",
      kind: "voucher",
      typeLabel: "سند",
      payment: "cash",
      direction: "debit",
      amount: 5000,
      currency: "ريال",
      exchangeRate: 1,
      details: "محذوف",
      documentNumber: "",
      warehouseId: "",
      warehouseName: "",
      invoiceContent: "none",
      entryNumber: 4,
      deleted: true,
      entryDate: "2026-01-04",
      createdAtMs: 400,
    },
  ];

  const summary = computeAccountSummary(baseAccount, entries);
  assert.equal(summary.creditTotal, 150000);
  assert.equal(summary.debitTotal, 20000);
  assert.equal(summary.netBalance, 130000);
  assert.equal(summary.tone, "credit");
  assert.equal(summary.entryCount, 3);
});

test("computeStatementRows calculates chronological running balances and filters by search mode", () => {
  const entries = [
    {
      id: "e1",
      ownerId: "user_1",
      accountId: "acc_1",
      accountName: "البراري للتوريد",
      counterpartAccountId: "",
      counterpartAccountName: "",
      kind: "invoice",
      typeLabel: "فاتورة آجلة",
      payment: "credit",
      direction: "credit",
      amount: 33000,
      currency: "ريال",
      exchangeRate: 1,
      details: "عازل سطوح",
      documentNumber: "DOC-9",
      warehouseId: "",
      warehouseName: "المخزن الرئيسي",
      invoiceContent: "items",
      entryNumber: 1178,
      deleted: false,
      entryDate: "2025-12-28",
      createdAtMs: 1000,
    },
    {
      id: "e2",
      ownerId: "user_1",
      accountId: "acc_1",
      accountName: "البراري للتوريد",
      counterpartAccountId: "",
      counterpartAccountName: "",
      kind: "voucher",
      typeLabel: "عليه",
      payment: "cash",
      direction: "debit",
      amount: 13000,
      currency: "ريال",
      exchangeRate: 1,
      details: "سداد نقدي",
      documentNumber: "",
      warehouseId: "",
      warehouseName: "",
      invoiceContent: "none",
      entryNumber: 1179,
      deleted: false,
      entryDate: "2025-12-29",
      createdAtMs: 2000,
    },
  ];

  const statement = computeStatementRows(baseAccount, entries, { showPreviousBalance: false });
  assert.equal(statement.rows.length, 2);
  // Reverse chronological: newest (1179) first with balance 20000, older (1178) with 33000
  assert.equal(statement.rows[0].entryNumber, 1179);
  assert.equal(statement.rows[0].runningBalance, 20000);
  assert.equal(statement.rows[1].runningBalance, 33000);
  assert.equal(statement.netBalance, 20000);

  const filtered = computeStatementRows(baseAccount, entries, {
    searchQuery: "عازل",
    searchMode: "البيان",
  });
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].entryNumber, 1178);
});

test("computeCategoryTotals & computeInventorySummary aggregate across accounts and inventory items", () => {
  const totals = computeCategoryTotals([baseAccount], []);
  assert.equal(totals.purchases.netSigned, 100000);
  assert.equal(totals.clients.netSigned, 0);

  const inv = computeInventorySummary(
    [
      { id: "i1", ownerId: "user_1", name: "ابجورة", unit: "حبة", quantity: 10, avgCost: 500, warehouseId: "w1" },
      { id: "i2", ownerId: "user_1", name: "مصباح", unit: "حبة", quantity: 5, avgCost: 200, warehouseId: "w2" },
    ],
    "w1",
  );
  assert.equal(inv.items.length, 1);
  assert.equal(inv.totalQuantity, 10);
  assert.equal(inv.totalValue, 5000);
});

test("sanitizers clamp bounds and reject invalid enums; buildCsvContent adds UTF-8 BOM and escapes commas", () => {
  const longName = "ا".repeat(150);
  const acc = sanitizeAccountPayload({
    ownerId: "u1",
    name: longName,
    category: "invalid_cat",
    openingBalance: "٥٠٠",
  });
  assert.equal(acc.name.length, 100);
  assert.equal(acc.category, "purchases");
  assert.equal(acc.openingBalance, 500);

  const led = sanitizeLedgerPayload({
    ownerId: "u1",
    accountId: "acc_1",
    accountName: "مورد",
    amount: "-50",
    exchangeRate: "0",
  });
  assert.equal(led.amount, 50 > 0 ? 0 : 0); // clamped >= 0
  assert.equal(led.exchangeRate, 1);

  assert.equal(accountMatchesQuery(baseAccount, "براري"), true);
  const csv = buildCsvContent(["الاسم", "ملاحظة"], [["أحمد", 'قيمة "1", سطر']]);
  assert.ok(csv.startsWith("\uFEFFالاسم,ملاحظة"));
  assert.ok(csv.includes('"قيمة ""1"", سطر"'));
});

import { computeDashboardSummary } from "../src/accounting.ts";

test("computeDashboardSummary aggregates total sales, sorts recent invoices, and flags low-stock inventory", () => {
  const accounts = [
    baseAccount,
    {
      ...baseAccount,
      id: "acc_sales",
      name: "المبيعات العامة",
      category: "sales",
      openingBalance: 10000,
      openingDirection: "debit",
    },
  ];
  const entries = [
    {
      id: "inv_old",
      ownerId: "user_1",
      accountId: "acc_sales",
      accountName: "المبيعات العامة",
      counterpartAccountId: "",
      counterpartAccountName: "",
      kind: "invoice",
      typeLabel: "فاتورة مبيعات",
      payment: "cash",
      direction: "debit",
      amount: 5000,
      currency: "ريال",
      exchangeRate: 1,
      details: "بيع 1",
      documentNumber: "",
      warehouseId: "w1",
      warehouseName: "المخزن الرئيسي",
      invoiceContent: "items",
      entryNumber: 101,
      deleted: false,
      entryDate: "2026-10-01",
      createdAtMs: 100,
    },
    {
      id: "inv_new",
      ownerId: "user_1",
      accountId: "acc_sales",
      accountName: "المبيعات العامة",
      counterpartAccountId: "",
      counterpartAccountName: "",
      kind: "invoice",
      typeLabel: "فاتورة مبيعات",
      payment: "credit",
      direction: "debit",
      amount: 8000,
      currency: "ريال",
      exchangeRate: 1,
      details: "بيع 2",
      documentNumber: "",
      warehouseId: "w1",
      warehouseName: "المخزن الرئيسي",
      invoiceContent: "items",
      entryNumber: 102,
      deleted: false,
      entryDate: "2026-11-10",
      createdAtMs: 200,
    },
    {
      id: "ret_1",
      ownerId: "user_1",
      accountId: "acc_sales",
      accountName: "المبيعات العامة",
      counterpartAccountId: "",
      counterpartAccountName: "",
      kind: "return",
      typeLabel: "مردود مبيعات",
      payment: "credit",
      direction: "credit",
      amount: 2000,
      currency: "ريال",
      exchangeRate: 1,
      details: "مرتجع",
      documentNumber: "",
      warehouseId: "w1",
      warehouseName: "المخزن الرئيسي",
      invoiceContent: "items",
      entryNumber: 103,
      deleted: false,
      entryDate: "2026-11-11",
      createdAtMs: 300,
    },
    {
      id: "q_1",
      ownerId: "user_1",
      accountId: "acc_sales",
      accountName: "المبيعات العامة",
      counterpartAccountId: "",
      counterpartAccountName: "",
      kind: "quote",
      typeLabel: "عرض سعر",
      payment: "credit",
      direction: "debit",
      amount: 99000,
      currency: "ريال",
      exchangeRate: 1,
      details: "عرض سعر",
      documentNumber: "",
      warehouseId: "w1",
      warehouseName: "المخزن الرئيسي",
      invoiceContent: "free",
      entryNumber: 104,
      deleted: false,
      entryDate: "2026-11-12",
      createdAtMs: 400,
    },
  ];
  const warehouses = [{ id: "w1", ownerId: "user_1", name: "المخزن الرئيسي", details: "", isDefault: true, codeNumber: 1 }];
  const inventory = [
    { id: "i1", ownerId: "user_1", name: "صنف منخفض جدا", unit: "حبة", quantity: 8, avgCost: 100, warehouseId: "w1" },
    { id: "i2", ownerId: "user_1", name: "صنف منخفض", unit: "حبة", quantity: 20, avgCost: 50, warehouseId: "w1" },
    { id: "i3", ownerId: "user_1", name: "صنف وافر", unit: "حبة", quantity: 60, avgCost: 30, warehouseId: "w1" },
  ];

  const allSummary = computeDashboardSummary(accounts, entries, warehouses, inventory, {
    lowStockThreshold: 25,
    period: "all",
  });
  // opening (10,000) + inv_old (5,000) + inv_new (8,000) - ret_1 (2,000) = 21,000
  assert.equal(allSummary.totalSales, 21000);
  assert.equal(allSummary.salesInvoiceCount, 2);
  assert.equal(allSummary.salesAccountCount, 1);
  // quotes are excluded from recentInvoices; ret_1 (Nov 11) comes first
  assert.equal(allSummary.recentInvoices.length, 3);
  assert.equal(allSummary.recentInvoices[0].id, "ret_1");
  assert.equal(allSummary.recentInvoices[1].id, "inv_new");
  assert.equal(allSummary.lowStockItems.length, 2);
  assert.equal(allSummary.lowStockItems[0].id, "i1");
  assert.equal(allSummary.lowStockItems[0].severity, "critical");
  assert.equal(allSummary.lowStockItems[1].severity, "warning");
  assert.equal(allSummary.lowStockItems[0].warehouseName, "المخزن الرئيسي");

  const weekSummary = computeDashboardSummary(accounts, entries, warehouses, inventory, {
    period: "week",
    referenceDate: new Date("2026-11-14T00:00:00Z"),
  });
  // Within 7 days of Nov 14: inv_new (8,000) - ret_1 (2,000) = 6,000
  assert.equal(weekSummary.totalSales, 6000);
  assert.equal(weekSummary.recentInvoices.length, 2);
});

