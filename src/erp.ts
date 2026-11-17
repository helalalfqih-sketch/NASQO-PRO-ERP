import {
  computeAccountSummary,
  computeInventorySummary,
  formatAmount,
  inferExpenseCategory,
  normalizeExpenseCategory,
  parseArabicNumber,
} from "./accounting.ts";
import {
  EXPENSE_CATEGORIES,
  type AccountRecord,
  type CurrencyCode,
  type ExpenseCategory,
  type InventoryItemRecord,
  type LedgerEntryRecord,
} from "./types.ts";

export type ErpModuleId =
  | "erp-hub"
  | "erp-finance"
  | "erp-hr"
  | "erp-crm"
  | "erp-procurement"
  | "erp-manufacturing";

export type ErpEmployeeProfile = {
  id: string;
  accountId?: string;
  name: string;
  roleTitle: string;
  department: string;
  basicSalary: number;
  allowances: number;
  deductions: number;
  status: "active" | "on-leave" | "inactive";
  hireDate: string;
  leaveBalanceDays: number;
  attendanceToday: "present" | "leave" | "absent";
};

export type ErpLeaveRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: "سنوية" | "مرضية" | "اضطرارية";
  startDate: string;
  days: number;
  status: "pending" | "approved" | "rejected";
  note: string;
};

export type ErpDealStage = "lead" | "proposal" | "negotiation" | "won" | "lost";

export type ErpDealRecord = {
  id: string;
  title: string;
  clientAccountId: string;
  clientName: string;
  value: number;
  currency: CurrencyCode;
  stage: ErpDealStage;
  probability: number;
  expectedCloseDate: string;
  assignedTo: string;
  convertedInvoiceEntryId?: string;
};

export type ErpPurchaseOrderLine = {
  inventoryItemId?: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitCost: number;
};

export type ErpPurchaseOrderStatus = "draft" | "approved" | "received";

export type ErpPurchaseOrder = {
  id: string;
  poNumber: string;
  supplierAccountId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  currency: CurrencyCode;
  orderDate: string;
  expectedDate: string;
  status: ErpPurchaseOrderStatus;
  lines: ErpPurchaseOrderLine[];
  notes: string;
  postedLedgerEntryId?: string;
};

export type ErpBomComponent = {
  inventoryItemId: string;
  itemName: string;
  unit: string;
  quantityPerUnit: number;
};

export type ErpBomRecipe = {
  id: string;
  name: string;
  finishedItemId: string;
  finishedItemName: string;
  finishedUnit: string;
  components: ErpBomComponent[];
};

export type ErpProductionOrder = {
  id: string;
  orderNumber: string;
  bomId: string;
  bomName: string;
  finishedItemId: string;
  finishedItemName: string;
  quantityToProduce: number;
  warehouseId: string;
  status: "planned" | "in-progress" | "completed";
  createdDate: string;
  completedDate?: string;
  costCenterId?: string;
};

export type ErpCostCenter = {
  id: string;
  code: string;
  name: string;
  managerName: string;
  budget: number;
  extraPostedSpend: number;
  linkedCategories: ExpenseCategory[];
  status: "active" | "closed";
};

export type ErpWorkspaceData = {
  employees: ErpEmployeeProfile[];
  leaveRequests: ErpLeaveRequest[];
  deals: ErpDealRecord[];
  purchaseOrders: ErpPurchaseOrder[];
  boms: ErpBomRecipe[];
  productionOrders: ErpProductionOrder[];
  costCenters: ErpCostCenter[];
  lastPayrollRunMonth?: string;
};

export type TrialBalanceRow = {
  accountId: string;
  codeNumber: number;
  accountName: string;
  category: AccountRecord["category"];
  debitTurnover: number;
  creditTurnover: number;
  closingDebit: number;
  closingCredit: number;
};

export type TrialBalanceReport = {
  rows: TrialBalanceRow[];
  totalDebitTurnover: number;
  totalCreditTurnover: number;
  totalClosingDebit: number;
  totalClosingCredit: number;
  netDifference: number;
};

export type IncomeStatementReport = {
  salesRevenue: number;
  salesReturns: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  expensesByCategory: { category: ExpenseCategory; amount: number }[];
  totalOperatingExpenses: number;
  netProfit: number;
};

export type BalanceSheetReport = {
  cashAndBank: number;
  accountsReceivable: number;
  inventoryValue: number;
  totalAssets: number;
  accountsPayable: number;
  payrollPayable: number;
  totalLiabilities: number;
  ownerEquityBase: number;
  currentPeriodProfit: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
};

export type VatSummaryReport = {
  vatRate: number;
  taxableSales: number;
  outputVat: number;
  taxablePurchases: number;
  inputVat: number;
  netVatPayable: number;
};

export function computeTrialBalance(
  accounts: readonly AccountRecord[],
  entries: readonly LedgerEntryRecord[],
): TrialBalanceReport {
  const rows: TrialBalanceRow[] = [];
  let totalDebitTurnover = 0;
  let totalCreditTurnover = 0;
  let totalClosingDebit = 0;
  let totalClosingCredit = 0;

  for (const account of accounts) {
    const summary = computeAccountSummary(account, entries);
    const netSigned = summary.creditTotal - summary.debitTotal;
    const closingDebit = netSigned < 0 ? Math.abs(netSigned) : 0;
    const closingCredit = netSigned > 0 ? netSigned : 0;

    rows.push({
      accountId: account.id,
      codeNumber: account.codeNumber,
      accountName: account.name,
      category: account.category,
      debitTurnover: summary.debitTotal,
      creditTurnover: summary.creditTotal,
      closingDebit,
      closingCredit,
    });

    totalDebitTurnover += summary.debitTotal;
    totalCreditTurnover += summary.creditTotal;
    totalClosingDebit += closingDebit;
    totalClosingCredit += closingCredit;
  }

  return {
    rows,
    totalDebitTurnover,
    totalCreditTurnover,
    totalClosingDebit,
    totalClosingCredit,
    netDifference: Math.abs(totalClosingDebit - totalClosingCredit),
  };
}

export function computeIncomeStatement(
  accounts: readonly AccountRecord[],
  entries: readonly LedgerEntryRecord[],
): IncomeStatementReport {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const salesIds = new Set(accounts.filter((a) => a.category === "sales").map((a) => a.id));

  let salesRevenue = 0;
  let salesReturns = 0;
  let cogs = 0;
  const expenseBuckets = new Map<ExpenseCategory, number>();
  for (const cat of EXPENSE_CATEGORIES) {
    expenseBuckets.set(cat, 0);
  }

  for (const acc of accounts) {
    if (acc.category === "sales" && acc.openingBalance > 0) {
      salesRevenue += acc.openingBalance;
    }
  }

  for (const entry of entries) {
    if (entry.deleted) continue;
    if (entry.kind === "quote" || entry.kind === "order") continue;

    const amount = entry.amount * (entry.exchangeRate || 1);
    if (amount <= 0) continue;

    const acc = accountMap.get(entry.accountId);
    const isSale =
      salesIds.has(entry.accountId) ||
      (entry.kind === "invoice" && entry.direction === "debit");

    if (isSale) {
      if (entry.kind === "return") {
        salesReturns += amount;
      } else {
        salesRevenue += amount;
      }
      continue;
    }

    const explicitCategory = normalizeExpenseCategory(entry.expenseCategory);
    const inferred =
      explicitCategory ?? inferExpenseCategory(entry.details, entry.accountName, acc?.category);

    const isPurchaseCogs =
      inferred === "مشتريات بضائع" &&
      (acc?.category === "purchases" || (entry.kind === "invoice" && entry.direction === "credit"));

    if (isPurchaseCogs) {
      if (entry.kind === "return") {
        cogs = Math.max(0, cogs - amount);
      } else {
        cogs += amount;
      }
      continue;
    }

    const isOperatingExpense =
      acc?.category === "shop" ||
      acc?.category === "employees" ||
      Boolean(explicitCategory) ||
      (entry.kind === "voucher" && entry.direction === "debit");

    if (isOperatingExpense && inferred !== "مشتريات بضائع") {
      expenseBuckets.set(inferred, (expenseBuckets.get(inferred) ?? 0) + amount);
    }
  }

  const netSales = Math.max(0, salesRevenue - salesReturns);
  const grossProfit = netSales - cogs;
  const grossMarginPct = netSales > 0 ? Math.round((grossProfit / netSales) * 1000) / 10 : 0;

  const expensesByCategory = Array.from(expenseBuckets.entries())
    .filter(([, amount]) => amount > 0)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const totalOperatingExpenses = expensesByCategory.reduce((sum, item) => sum + item.amount, 0);
  const netProfit = grossProfit - totalOperatingExpenses;

  return {
    salesRevenue,
    salesReturns,
    netSales,
    cogs,
    grossProfit,
    grossMarginPct,
    expensesByCategory,
    totalOperatingExpenses,
    netProfit,
  };
}

export function computeBalanceSheet(
  accounts: readonly AccountRecord[],
  entries: readonly LedgerEntryRecord[],
  inventory: readonly InventoryItemRecord[],
): BalanceSheetReport {
  const invSummary = computeInventorySummary(inventory);
  const income = computeIncomeStatement(accounts, entries);

  let cashAndBank = 0;
  let accountsReceivable = 0;
  let accountsPayable = 0;
  let payrollPayable = 0;

  for (const acc of accounts) {
    const summary = computeAccountSummary(acc, entries);
    const netSigned = summary.creditTotal - summary.debitTotal;

    if (acc.isCashAccount || acc.category === "transfers") {
      cashAndBank += Math.abs(netSigned) > 0 ? Math.abs(netSigned) : summary.creditTotal;
    } else if (acc.category === "clients") {
      if (netSigned < 0) {
        accountsReceivable += Math.abs(netSigned);
      } else if (netSigned > 0) {
        accountsPayable += netSigned;
      }
    } else if (acc.category === "purchases") {
      if (netSigned > 0) {
        accountsPayable += netSigned;
      } else if (netSigned < 0) {
        accountsReceivable += Math.abs(netSigned);
      }
    } else if (acc.category === "employees") {
      if (netSigned > 0) {
        payrollPayable += netSigned;
      }
    }
  }

  const inventoryValue = invSummary.totalValue;
  const totalAssets = cashAndBank + accountsReceivable + inventoryValue;
  const totalLiabilities = accountsPayable + payrollPayable;
  const currentPeriodProfit = income.netProfit;
  const ownerEquityBase = totalAssets - totalLiabilities - currentPeriodProfit;
  const totalEquity = ownerEquityBase + currentPeriodProfit;

  return {
    cashAndBank,
    accountsReceivable,
    inventoryValue,
    totalAssets,
    accountsPayable,
    payrollPayable,
    totalLiabilities,
    ownerEquityBase,
    currentPeriodProfit,
    totalEquity,
    totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
  };
}

export function computeVatSummary(
  accounts: readonly AccountRecord[],
  entries: readonly LedgerEntryRecord[],
  vatRate: number = 0.15,
): VatSummaryReport {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  let taxableSales = 0;
  let taxablePurchases = 0;

  for (const entry of entries) {
    if (entry.deleted) continue;
    if (entry.kind !== "invoice" && entry.kind !== "return") continue;
    const amount = entry.amount * (entry.exchangeRate || 1);
    const acc = accountMap.get(entry.accountId);
    const isSale = acc?.category === "sales" || entry.direction === "debit";
    if (isSale) {
      taxableSales += entry.kind === "return" ? -amount : amount;
    } else {
      taxablePurchases += entry.kind === "return" ? -amount : amount;
    }
  }

  taxableSales = Math.max(0, taxableSales);
  taxablePurchases = Math.max(0, taxablePurchases);
  const outputVat = Math.round(taxableSales * vatRate * 100) / 100;
  const inputVat = Math.round(taxablePurchases * vatRate * 100) / 100;

  return {
    vatRate,
    taxableSales,
    outputVat,
    taxablePurchases,
    inputVat,
    netVatPayable: Math.round((outputVat - inputVat) * 100) / 100,
  };
}

export function computeEmployeeNetSalary(emp: Pick<ErpEmployeeProfile, "basicSalary" | "allowances" | "deductions">): number {
  return Math.max(0, (emp.basicSalary || 0) + (emp.allowances || 0) - (emp.deductions || 0));
}

export function computePayrollTotals(employees: readonly ErpEmployeeProfile[]): {
  activeCount: number;
  totalBasic: number;
  totalAllowances: number;
  totalDeductions: number;
  totalNetPayroll: number;
} {
  let activeCount = 0;
  let totalBasic = 0;
  let totalAllowances = 0;
  let totalDeductions = 0;
  let totalNetPayroll = 0;

  for (const emp of employees) {
    if (emp.status === "inactive") continue;
    activeCount += 1;
    totalBasic += Math.max(0, emp.basicSalary);
    totalAllowances += Math.max(0, emp.allowances);
    totalDeductions += Math.max(0, emp.deductions);
    totalNetPayroll += computeEmployeeNetSalary(emp);
  }

  return {
    activeCount,
    totalBasic,
    totalAllowances,
    totalDeductions,
    totalNetPayroll,
  };
}

export function computePurchaseOrderTotal(po: Pick<ErpPurchaseOrder, "lines">): number {
  return po.lines.reduce(
    (sum, line) => sum + Math.max(0, line.quantity) * Math.max(0, line.unitCost),
    0,
  );
}

export function computeWeightedAvgCost(
  currentQty: number,
  currentAvgCost: number,
  receivedQty: number,
  unitCost: number,
): { newQty: number; newAvgCost: number } {
  const safeCurQty = Math.max(0, currentQty);
  const safeRecQty = Math.max(0, receivedQty);
  const newQty = safeCurQty + safeRecQty;
  if (newQty <= 0) {
    return { newQty: 0, newAvgCost: Math.max(0, unitCost || currentAvgCost) };
  }
  const totalCost = safeCurQty * Math.max(0, currentAvgCost) + safeRecQty * Math.max(0, unitCost);
  return {
    newQty,
    newAvgCost: Math.round((totalCost / newQty) * 100) / 100,
  };
}

export function computeBomAvailability(
  bom: ErpBomRecipe,
  quantityToProduce: number,
  inventory: readonly InventoryItemRecord[],
): {
  canProduce: boolean;
  estimatedUnitCost: number;
  totalEstimatedCost: number;
  shortages: { itemName: string; required: number; available: number; unit: string }[];
} {
  const invMap = new Map(inventory.map((i) => [i.id, i]));
  const qty = Math.max(1, quantityToProduce);
  const shortages: { itemName: string; required: number; available: number; unit: string }[] = [];
  let estimatedUnitCost = 0;

  for (const comp of bom.components) {
    const item = invMap.get(comp.inventoryItemId);
    const available = item?.quantity ?? 0;
    const required = comp.quantityPerUnit * qty;
    estimatedUnitCost += comp.quantityPerUnit * (item?.avgCost ?? 0);
    if (available < required) {
      shortages.push({
        itemName: comp.itemName,
        required,
        available,
        unit: comp.unit,
      });
    }
  }

  return {
    canProduce: shortages.length === 0,
    estimatedUnitCost: Math.round(estimatedUnitCost * 100) / 100,
    totalEstimatedCost: Math.round(estimatedUnitCost * qty * 100) / 100,
    shortages,
  };
}

export function computeCostCenterMetrics(
  costCenters: readonly ErpCostCenter[],
  accounts: readonly AccountRecord[],
  entries: readonly LedgerEntryRecord[],
): (ErpCostCenter & { actualSpend: number; remaining: number; utilizationPct: number })[] {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const categorySpend = new Map<ExpenseCategory, number>();
  for (const entry of entries) {
    if (entry.deleted || entry.kind === "quote" || entry.kind === "order" || entry.kind === "return") continue;
    const acc = accountMap.get(entry.accountId);
    const cat =
      normalizeExpenseCategory(entry.expenseCategory) ??
      inferExpenseCategory(entry.details, entry.accountName, acc?.category);
    categorySpend.set(cat, (categorySpend.get(cat) ?? 0) + entry.amount * (entry.exchangeRate || 1));
  }

  return costCenters.map((cc) => {
    const ledgerSpend = cc.linkedCategories.reduce((s, c) => s + (categorySpend.get(c) ?? 0), 0);
    const actualSpend = ledgerSpend + Math.max(0, cc.extraPostedSpend || 0);
    const remaining = cc.budget - actualSpend;
    const utilizationPct = cc.budget > 0 ? Math.min(200, Math.round((actualSpend / cc.budget) * 100)) : 0;
    return {
      ...cc,
      actualSpend,
      remaining,
      utilizationPct,
    };
  });
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

const erpMemoryCache = new Map<string, ErpWorkspaceData>();
const erpListeners = new Set<(data: ErpWorkspaceData) => void>();

export function hydrateErpWorkspaceCache(uid: string, data: ErpWorkspaceData): void {
  const key = uid || "local-erp-workspace";
  erpMemoryCache.set(key, data);
  for (const listener of erpListeners) {
    listener(data);
  }
}

export function subscribeErpCache(listener: (data: ErpWorkspaceData) => void): () => void {
  erpListeners.add(listener);
  return () => {
    erpListeners.delete(listener);
  };
}

export function loadErpWorkspaceData(uid: string): ErpWorkspaceData {
  const key = uid || "local-erp-workspace";
  return erpMemoryCache.get(key) ?? erpMemoryCache.get("local-erp-workspace") ?? createEmptyErpData();
}

export function saveErpWorkspaceData(uid: string, data: ErpWorkspaceData): void {
  const key = uid || "local-erp-workspace";
  erpMemoryCache.set(key, data);
  for (const listener of erpListeners) {
    listener(data);
  }
  if (typeof window === "undefined") return;
  try {
    const viteBase = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/";
    const base = new URL("api/db/workspace/", new URL(viteBase, window.location.origin)).pathname;
    void fetch(`${base}local-erp-workspace/erp`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).catch(() => {});
  } catch {
    // Ignore non-browser test environments
  }
}

export function formatErpCurrency(amount: number, currency: CurrencyCode | string = "ريال"): string {
  return `${formatAmount(amount)} ${currency}`;
}

export function parsePositiveNumber(raw: string | number): number {
  return Math.max(0, parseArabicNumber(raw));
}
