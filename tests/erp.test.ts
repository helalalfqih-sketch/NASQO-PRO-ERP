import test from "node:test";
import assert from "node:assert/strict";
import {
  computeBalanceSheet,
  computeBomAvailability,
  computeCostCenterMetrics,
  computeEmployeeNetSalary,
  computeIncomeStatement,
  computePayrollTotals,
  computePurchaseOrderTotal,
  computeTrialBalance,
  computeVatSummary,
  computeWeightedAvgCost,
  createDefaultErpData,
} from "../src/erp.ts";
import type { AccountRecord, InventoryItemRecord, LedgerEntryRecord } from "../src/types.ts";

const sampleAccounts: AccountRecord[] = [
  {
    id: "acc_sales",
    ownerId: "u1",
    name: "المبيعات العامة",
    category: "sales",
    phone: "",
    creditLimit: 0,
    currency: "ريال",
    isCashAccount: false,
    accountImage: "1",
    sortOrder: 1,
    settlement: false,
    documentNumberRequired: false,
    messageMethod: "sms",
    sendMode: "never",
    note: "",
    openingBalance: 10000,
    openingDirection: "debit",
    codeNumber: 1,
  },
  {
    id: "acc_supplier",
    ownerId: "u1",
    name: "مورد التوريدات",
    category: "purchases",
    phone: "",
    creditLimit: 100000,
    currency: "ريال",
    isCashAccount: false,
    accountImage: "1",
    sortOrder: 2,
    settlement: false,
    documentNumberRequired: false,
    messageMethod: "sms",
    sendMode: "never",
    note: "",
    openingBalance: 4000,
    openingDirection: "credit",
    codeNumber: 2,
  },
  {
    id: "acc_client",
    ownerId: "u1",
    name: "شركة النور",
    category: "clients",
    phone: "",
    creditLimit: 50000,
    currency: "ريال",
    isCashAccount: false,
    accountImage: "1",
    sortOrder: 3,
    settlement: false,
    documentNumberRequired: false,
    messageMethod: "sms",
    sendMode: "never",
    note: "",
    openingBalance: 2500,
    openingDirection: "debit",
    codeNumber: 3,
  },
  {
    id: "acc_emp",
    ownerId: "u1",
    name: "رواتب الموظفين",
    category: "employees",
    phone: "",
    creditLimit: 0,
    currency: "ريال",
    isCashAccount: false,
    accountImage: "1",
    sortOrder: 4,
    settlement: false,
    documentNumberRequired: false,
    messageMethod: "sms",
    sendMode: "never",
    note: "",
    openingBalance: 0,
    openingDirection: "credit",
    codeNumber: 4,
  },
];

const sampleEntries: LedgerEntryRecord[] = [
  {
    id: "e1",
    ownerId: "u1",
    accountId: "acc_sales",
    accountName: "المبيعات العامة",
    counterpartAccountId: "",
    counterpartAccountName: "",
    kind: "invoice",
    typeLabel: "فاتورة مبيعات",
    payment: "cash",
    direction: "debit",
    amount: 15000,
    currency: "ريال",
    exchangeRate: 1,
    details: "مبيعات أجهزة",
    documentNumber: "1001",
    warehouseId: "wh_1",
    warehouseName: "الرئيسي",
    invoiceContent: "items",
    entryNumber: 1,
    deleted: false,
    entryDate: "2026-11-10",
    createdAtMs: 1000,
  },
  {
    id: "e2",
    ownerId: "u1",
    accountId: "acc_supplier",
    accountName: "مورد التوريدات",
    counterpartAccountId: "",
    counterpartAccountName: "",
    kind: "invoice",
    typeLabel: "فاتورة مشتريات",
    payment: "credit",
    direction: "credit",
    amount: 6000,
    currency: "ريال",
    exchangeRate: 1,
    details: "توريد بضاعة",
    documentNumber: "1002",
    warehouseId: "wh_1",
    warehouseName: "الرئيسي",
    invoiceContent: "items",
    entryNumber: 2,
    deleted: false,
    entryDate: "2026-11-11",
    expenseCategory: "مشتريات بضائع",
    createdAtMs: 2000,
  },
  {
    id: "e3",
    ownerId: "u1",
    accountId: "acc_emp",
    accountName: "رواتب الموظفين",
    counterpartAccountId: "",
    counterpartAccountName: "",
    kind: "voucher",
    typeLabel: "سند رواتب",
    payment: "cash",
    direction: "debit",
    amount: 5000,
    currency: "ريال",
    exchangeRate: 1,
    details: "مسير رواتب الشهر",
    documentNumber: "1003",
    warehouseId: "wh_1",
    warehouseName: "الرئيسي",
    invoiceContent: "none",
    entryNumber: 3,
    deleted: false,
    entryDate: "2026-11-12",
    expenseCategory: "رواتب وأجور",
    createdAtMs: 3000,
  },
];

const sampleInventory: InventoryItemRecord[] = [
  {
    id: "inv_1",
    ownerId: "u1",
    name: "ابجورة",
    unit: "حبة",
    quantity: 10,
    avgCost: 200,
    warehouseId: "wh_1",
  },
  {
    id: "inv_2",
    ownerId: "u1",
    name: "توصيلة",
    unit: "حبة",
    quantity: 4,
    avgCost: 50,
    warehouseId: "wh_1",
  },
  {
    id: "inv_3",
    ownerId: "u1",
    name: "بطارية",
    unit: "حبة",
    quantity: 12,
    avgCost: 100,
    warehouseId: "wh_1",
  },
];

test("computeTrialBalance computes per-account closing debit/credit balances", () => {
  const tb = computeTrialBalance(sampleAccounts, sampleEntries);
  assert.equal(tb.rows.length, 4);
  const salesRow = tb.rows.find((r) => r.accountId === "acc_sales")!;
  assert.equal(salesRow.closingDebit, 25000);
  assert.equal(salesRow.closingCredit, 0);
  const supRow = tb.rows.find((r) => r.accountId === "acc_supplier")!;
  assert.equal(supRow.closingCredit, 10000);
  assert.equal(tb.totalClosingDebit, 32500);
  assert.equal(tb.totalClosingCredit, 10000);
});

test("computeIncomeStatement computes revenue, COGS, operating expenses, and net profit", () => {
  const is = computeIncomeStatement(sampleAccounts, sampleEntries);
  assert.equal(is.netSales, 25000);
  assert.equal(is.cogs, 6000);
  assert.equal(is.grossProfit, 19000);
  assert.equal(is.totalOperatingExpenses, 5000);
  assert.equal(is.netProfit, 14000);
});

test("computeBalanceSheet balances Total Assets == Total Liabilities + Equity", () => {
  const bs = computeBalanceSheet(sampleAccounts, sampleEntries, sampleInventory);
  assert.equal(bs.inventoryValue, 3400);
  assert.equal(bs.accountsReceivable, 2500);
  assert.equal(bs.accountsPayable, 10000);
  assert.equal(bs.totalAssets, bs.totalLiabilitiesAndEquity);
});

test("computeVatSummary computes 15% output, input, and net VAT payable", () => {
  const vat = computeVatSummary(sampleAccounts, sampleEntries, 0.15);
  assert.equal(vat.taxableSales, 15000);
  assert.equal(vat.outputVat, 2250);
  assert.equal(vat.taxablePurchases, 6000);
  assert.equal(vat.inputVat, 900);
  assert.equal(vat.netVatPayable, 1350);
});

test("computeEmployeeNetSalary and computePayrollTotals ignore inactive employees and clamp below 0", () => {
  assert.equal(computeEmployeeNetSalary({ basicSalary: 5000, allowances: 1000, deductions: 300 }), 5700);
  assert.equal(computeEmployeeNetSalary({ basicSalary: 100, allowances: 0, deductions: 500 }), 0);
  const erp = createDefaultErpData("2026-11-15");
  erp.employees.push({
    id: "emp_inactive",
    name: "موظف موقوف",
    roleTitle: "موقوف",
    department: "عام",
    basicSalary: 10000,
    allowances: 0,
    deductions: 0,
    status: "inactive",
    hireDate: "2024-01-01",
    leaveBalanceDays: 0,
    attendanceToday: "absent",
  });
  const totals = computePayrollTotals(erp.employees);
  assert.equal(totals.activeCount, 3);
  assert.equal(totals.totalNetPayroll, 7700 + 6500 + 5250);
});

test("computePurchaseOrderTotal and computeWeightedAvgCost calculate PO value and inventory costing", () => {
  const poTotal = computePurchaseOrderTotal({
    lines: [
      { itemName: "A", unit: "حبة", quantity: 10, unitCost: 100 },
      { itemName: "B", unit: "حبة", quantity: 5, unitCost: 200 },
    ],
  });
  assert.equal(poTotal, 2000);

  const avg = computeWeightedAvgCost(10, 100, 10, 200);
  assert.equal(avg.newQty, 20);
  assert.equal(avg.newAvgCost, 150);
});

test("computeBomAvailability detects stock shortages and estimates unit cost", () => {
  const erp = createDefaultErpData("2026-11-15");
  const bom = erp.boms[0];
  const okCheck = computeBomAvailability(bom, 3, sampleInventory);
  assert.equal(okCheck.canProduce, true);
  assert.equal(okCheck.estimatedUnitCost, 150);
  assert.equal(okCheck.totalEstimatedCost, 450);

  const failCheck = computeBomAvailability(bom, 6, sampleInventory);
  assert.equal(failCheck.canProduce, false);
  assert.equal(failCheck.shortages.length, 1);
  assert.equal(failCheck.shortages[0].available, 4);
  assert.equal(failCheck.shortages[0].required, 6);
});

test("computeCostCenterMetrics aggregates linked ledger category spending against budget", () => {
  const erp = createDefaultErpData("2026-11-15");
  const metrics = computeCostCenterMetrics(erp.costCenters, sampleAccounts, sampleEntries);
  const hrCc = metrics.find((c) => c.id === "cc_hr")!;
  assert.equal(hrCc.actualSpend, 5000);
  assert.equal(hrCc.remaining, 55000);
  assert.equal(hrCc.utilizationPct, 8);
});

test("financial statements support currency/period filters, cash/inventory reconciliation, and VAT modes", () => {
  const mixedEntries: LedgerEntryRecord[] = [
    ...sampleEntries,
    {
      ...sampleEntries[0],
      id: "e_usd",
      amount: 1000,
      currency: "دولار",
      entryDate: "2026-11-13",
      entryNumber: 4,
    },
    {
      ...sampleEntries[0],
      id: "e_linked_cb",
      cashboxId: 1,
      amount: 2000,
      currency: "ريال",
      entryDate: "2026-11-14",
      entryNumber: 5,
    },
  ];
  const cashboxes = [{ id: 1, name: "الصندوق الرئيسي", details: "", currencyCode: "ريال" as const, state: 1, isActive: true }];

  const riyalIncome = computeIncomeStatement(sampleAccounts, mixedEntries, {
    currency: "ريال",
    fromDate: "2026-11-10",
    toDate: "2026-11-12",
  });
  assert.equal(riyalIncome.netSales, 15000);
  assert.equal(riyalIncome.scope?.excludedByCurrencyCount, 1);
  assert.equal(riyalIncome.scope?.excludedByDateCount, 1);

  const unverifiedInv: InventoryItemRecord[] = [
    { ...sampleInventory[0], quantity: 0, avgCost: 200, quantityUnverified: true, computedQuantity: 5 },
  ];
  const bsVerifiedOnly = computeBalanceSheet(sampleAccounts, mixedEntries, unverifiedInv, {
    currency: "ريال",
    cashboxes,
    useUnifiedCash: true,
    includeUnverifiedInventory: false,
    estimatedInventoryReportValue: 1000,
  });
  assert.equal(bsVerifiedOnly.inventoryValue, 0);
  assert.equal(bsVerifiedOnly.inventoryReconciliation?.unverifiedEstimatedValue, 1000);
  assert.equal(bsVerifiedOnly.inventoryReconciliation?.differenceVsInventoryReport, 1000);
  assert.equal(bsVerifiedOnly.cashReconciliation?.linkedCashboxesNet, 2000);
  assert.equal(bsVerifiedOnly.cashReconciliation?.unassignedCashNet, 10000); // +15000 sale - 5000 salary voucher
  assert.equal(bsVerifiedOnly.cashAndBank, 12000);
  assert.equal(bsVerifiedOnly.totalAssets, bsVerifiedOnly.totalLiabilitiesAndEquity);

  const vatRecorded = computeVatSummary(sampleAccounts, mixedEntries, 0.15, {
    currency: "ريال",
    vatMode: "recorded_only",
    jurisdictionCode: "none",
  });
  assert.equal(vatRecorded.outputVat, 0);
  assert.equal(vatRecorded.netVatPayable, 0);
  assert.equal(vatRecorded.entriesWithRecordedTaxCount, 0);
});
