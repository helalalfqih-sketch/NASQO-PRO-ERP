import { exportReport } from "../../utils/reportDocument";
import { useEffect, useMemo, useState } from "react";
import { DownloadIcon } from "@radix-ui/react-icons";
import { buildCsvContent, formatAmount } from "../../accounting";
import { runWithBrandLoader } from "../../utils/brandLoaderBus";
import {
  computeBalanceSheet,
  computeIncomeStatement,
  computeTrialBalance,
  computeVatSummary,
  type ErpVatConfig,
  type ErpVatJurisdiction,
  type ErpWorkspaceData,
} from "../../erp";
import {
  LOCAL_WORKSPACE_UID,
  fetchCashboxesReport,
  fetchInventoryMovementsReport,
} from "../../firebase";
import { MobileScroll } from "../../mobile";
import type {
  AccountRecord,
  CashboxRecord,
  InventoryItemRecord,
  LedgerEntryRecord,
} from "../../types";
import { triggerHaptic } from "../../utils/haptics";

type FinanceTab = "trial" | "income" | "balance" | "vat";
type PeriodPreset = "all" | "daily" | "monthly" | "yearly" | "custom";

const CATEGORY_LABELS: Record<AccountRecord["category"], string> = {
  purchases: "موردون ومشتريات",
  sales: "المبيعات",
  clients: "العملاء",
  employees: "الموظفون",
  transfers: "الحوالات والنقدية",
  shop: "مصروفات المحل",
};

const VAT_JURISDICTION_LABELS: Record<ErpVatJurisdiction, string> = {
  none: "غير مفعّل / بدون ولاية ضريبية (0%)",
  sa_15: "السعودية — ضريبة القيمة المضافة 15%",
  ae_5: "الإمارات — ضريبة القيمة المضافة 5%",
  custom: "معدل ضريبي مخصص",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function presetDateBounds(preset: PeriodPreset): { fromDate: string; toDate: string } {
  const now = new Date();
  const isoToday = now.toISOString().slice(0, 10);
  if (preset === "daily") return { fromDate: isoToday, toDate: isoToday };
  if (preset === "monthly") return { fromDate: `${isoToday.slice(0, 7)}-01`, toDate: isoToday };
  if (preset === "yearly") return { fromDate: `${now.getFullYear()}-01-01`, toDate: isoToday };
  return { fromDate: "", toDate: "" };
}

export function ErpFinanceScreen({
  uid = LOCAL_WORKSPACE_UID,
  companyName,
  currency,
  accounts,
  ledger,
  inventory,
  cashboxes = [],
  erpData,
  onUpdateErpData,
  onToast,
}: {
  uid?: string;
  companyName: string;
  currency: string;
  accounts: readonly AccountRecord[];
  ledger: readonly LedgerEntryRecord[];
  inventory: readonly InventoryItemRecord[];
  cashboxes?: readonly CashboxRecord[];
  erpData?: ErpWorkspaceData;
  onUpdateErpData?: (next: ErpWorkspaceData) => Promise<boolean>;
  onToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<FinanceTab>("trial");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState<string>(currency || "ريال");
  const [useUnifiedCash, setUseUnifiedCash] = useState<boolean>(true);
  const [includeUnverifiedInventory, setIncludeUnverifiedInventory] = useState<boolean>(false);
  const [visibleTrialRows, setVisibleTrialRows] = useState<number>(80);

  const savedVatConfig: ErpVatConfig = erpData?.vatConfig ?? {
    jurisdiction: "none",
    ratePercent: 0,
    basis: "recorded_only",
  };
  const [vatJurisdiction, setVatJurisdiction] = useState<ErpVatJurisdiction>(savedVatConfig.jurisdiction);
  const [vatRatePercent, setVatRatePercent] = useState<string>(String(savedVatConfig.ratePercent));
  const [vatBasis, setVatBasis] = useState<"recorded_only" | "estimated_gross">(savedVatConfig.basis);

  useEffect(() => {
    if (!erpData?.vatConfig) return;
    setVatJurisdiction(erpData.vatConfig.jurisdiction);
    setVatRatePercent(String(erpData.vatConfig.ratePercent));
    setVatBasis(erpData.vatConfig.basis);
  }, [erpData?.vatConfig]);

  const availableCurrencies = useMemo(() => {
    const set = new Set<string>([currency || "ريال"]);
    for (const acc of accounts) if (acc.currency) set.add(acc.currency);
    for (const e of ledger) if (!e.deleted && e.currency) set.add(e.currency);
    for (const cb of cashboxes) if (cb.currencyCode) set.add(cb.currencyCode);
    return [...set];
  }, [accounts, cashboxes, currency, ledger]);

  const activeFrom = periodPreset === "all" ? "" : fromDate.trim();
  const activeTo = periodPreset === "all" ? "" : toDate.trim();

  const [serverInvReportValue, setServerInvReportValue] = useState<number | undefined>(undefined);
  const [serverCashboxesReport, setServerCashboxesReport] = useState<
    Awaited<ReturnType<typeof fetchCashboxesReport>> | null
  >(null);

  useEffect(() => {
    let active = true;
    const scopeCur = selectedCurrency === "الكل" ? undefined : selectedCurrency;
    void fetchInventoryMovementsReport(uid, {
      currency: scopeCur,
      toDate: activeTo || undefined,
      profitBasis: "avg",
    })
      .then((res) => {
        if (active) setServerInvReportValue(res.totals?.totalRemainingValue);
      })
      .catch(() => {
        if (active) setServerInvReportValue(undefined);
      });

    void fetchCashboxesReport(uid, {
      currency: scopeCur,
      fromDate: activeFrom || undefined,
      toDate: activeTo || undefined,
    })
      .then((res) => {
        if (active) setServerCashboxesReport(res);
      })
      .catch(() => {
        if (active) setServerCashboxesReport(null);
      });

    return () => {
      active = false;
    };
  }, [activeFrom, activeTo, ledger.length, selectedCurrency, uid]);

  const trial = useMemo(
    () =>
      computeTrialBalance(accounts, ledger, {
        currency: selectedCurrency,
        fromDate: activeFrom || undefined,
        toDate: activeTo || undefined,
      }),
    [accounts, activeFrom, activeTo, ledger, selectedCurrency],
  );

  const income = useMemo(
    () =>
      computeIncomeStatement(accounts, ledger, {
        currency: selectedCurrency,
        fromDate: activeFrom || undefined,
        toDate: activeTo || undefined,
      }),
    [accounts, activeFrom, activeTo, ledger, selectedCurrency],
  );

  const balanceSheet = useMemo(
    () =>
      computeBalanceSheet(accounts, ledger, inventory, {
        currency: selectedCurrency,
        fromDate: activeFrom || undefined,
        toDate: activeTo || undefined,
        cashboxes,
        useUnifiedCash,
        includeUnverifiedInventory,
        estimatedInventoryReportValue: serverInvReportValue,
      }),
    [
      accounts,
      activeFrom,
      activeTo,
      cashboxes,
      includeUnverifiedInventory,
      inventory,
      ledger,
      selectedCurrency,
      serverInvReportValue,
      useUnifiedCash,
    ],
  );

  const numericVatRatePercent = Math.max(0, Math.min(100, Number(vatRatePercent) || 0));
  const effectiveVatRate = numericVatRatePercent / 100;
  const vat = useMemo(
    () =>
      computeVatSummary(accounts, ledger, effectiveVatRate, {
        currency: selectedCurrency,
        fromDate: activeFrom || undefined,
        toDate: activeTo || undefined,
        vatMode: vatBasis,
        jurisdictionCode: vatJurisdiction,
        jurisdictionLabel: VAT_JURISDICTION_LABELS[vatJurisdiction],
      }),
    [accounts, activeFrom, activeTo, effectiveVatRate, ledger, selectedCurrency, vatBasis, vatJurisdiction],
  );

  const activeScopeMeta =
    tab === "trial"
      ? trial.scope
      : tab === "income"
        ? income.scope
        : tab === "balance"
          ? balanceSheet.scope
          : vat.scope;

  const periodLabel =
    periodPreset === "all"
      ? `الكل (${activeScopeMeta?.earliestEntryDate ?? "بداية السجل"} ← ${activeScopeMeta?.latestEntryDate ?? todayIso()})`
      : tab === "balance"
        ? `تراكمي حتى ${activeTo || activeScopeMeta?.latestEntryDate || todayIso()}${activeFrom ? ` (صافي ربح من ${activeFrom})` : ""}`
        : `من ${activeFrom || "البداية"} إلى ${activeTo || activeScopeMeta?.latestEntryDate || todayIso()}`;

  const currencyDisplayLabel = selectedCurrency === "الكل" ? "الكل (بالعملة الأساسية)" : selectedCurrency;

  const handlePresetChange = (nextPreset: PeriodPreset) => {
    setPeriodPreset(nextPreset);
    if (nextPreset === "custom") {
      setFromDate((prev) => prev || `${new Date().getFullYear()}-01-01`);
      setToDate((prev) => prev || todayIso());
    } else {
      const bounds = presetDateBounds(nextPreset);
      setFromDate(bounds.fromDate);
      setToDate(bounds.toDate);
    }
  };

  const handleJurisdictionChange = (next: ErpVatJurisdiction) => {
    setVatJurisdiction(next);
    if (next === "none") {
      setVatRatePercent("0");
      setVatBasis("recorded_only");
    } else if (next === "sa_15") {
      setVatRatePercent("15");
      setVatBasis("estimated_gross");
    } else if (next === "ae_5") {
      setVatRatePercent("5");
      setVatBasis("estimated_gross");
    } else if (Number(vatRatePercent) <= 0) {
      setVatRatePercent("15");
    }
  };

  const saveVatSettings = async () => {
    if (!erpData || !onUpdateErpData) {
      onToast("تم تطبيق إعداد الضريبة على العرض الحالي");
      return;
    }
    const nextConfig: ErpVatConfig = {
      jurisdiction: vatJurisdiction,
      ratePercent: numericVatRatePercent,
      basis: vatBasis,
    };
    if (!await onUpdateErpData({ ...erpData, vatConfig: nextConfig })) return;
    triggerHaptic("success");
    onToast("تم حفظ إعدادات الضريبة بنجاح");
  };

  const exportCsv = () => {
    void runWithBrandLoader("جاري تجهيز مصنف ميزان المراجعة...",async()=>{
      const ok=await exportReport({kind:"trial-balance",title:"ميزان المراجعة",scope:{currency:selectedCurrency,from:fromDate,to:toDate},
        columns:["الرقم","الحساب","التصنيف","العملة","حركة مدين","حركة دائن","رصيد مدين","رصيد دائن"],
        rows:trial.rows.map(r=>({id:r.accountId,currency:selectedCurrency,cells:[r.codeNumber,r.accountName,CATEGORY_LABELS[r.category],selectedCurrency,r.debitTurnover,r.creditTurnover,r.closingDebit,r.closingCredit]})),totals:[]},"excel","save");
      onToast(ok?"تم حفظ مصنف Excel":"أُلغي الحفظ");
    }).catch(error=>onToast(error instanceof Error?error.message:"تعذر تصدير ميزان المراجعة"));
  };

  const vatIsConfigured = vatJurisdiction !== "none" && Boolean(erpData?.vatConfig && erpData.vatConfig.jurisdiction !== "none");

  return (
    <MobileScroll className="app-screen erp-scroll">
      <main className="erp-page" data-testid="erp-finance-screen">
        <div className="erp-segmented" role="tablist" aria-label="القوائم المالية">
          {(
            [
              ["trial", "ميزان المراجعة"],
              ["income", "قائمة الدخل"],
              ["balance", "الميزانية"],
              ["vat", "الضرائب"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                triggerHaptic("light");
                setTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="erp-card erp-scope-bar" data-testid="erp-finance-scope-bar" aria-label="نطاق القوائم المالية">
          <div className="erp-scope-controls">
            <label className="erp-scope-field">
              <span>الفترة الزمنية</span>
              <select
                aria-label="فترة القوائم المالية"
                data-testid="erp-finance-period-select"
                value={periodPreset}
                onChange={(e) => handlePresetChange(e.target.value as PeriodPreset)}
              >
                <option value="all">الكل (كامل السجل)</option>
                <option value="daily">اليوم</option>
                <option value="monthly">الشهر الحالي</option>
                <option value="yearly">السنة الحالية</option>
                <option value="custom">فترة مخصصة</option>
              </select>
            </label>
            <label className="erp-scope-field">
              <span>العملة</span>
              <select
                aria-label="عملة القوائم المالية"
                data-testid="erp-finance-currency-select"
                value={selectedCurrency}
                onChange={(e) => setSelectedCurrency(e.target.value)}
              >
                {availableCurrencies.map((cur) => (
                  <option key={cur} value={cur}>
                    {cur}
                  </option>
                ))}
                <option value="الكل">الكل (تجميع عبر سعر الصرف)</option>
              </select>
            </label>
          </div>

          {periodPreset !== "all" ? (
            <div className="erp-scope-dates">
              <label className="erp-scope-field">
                <span>من تاريخ</span>
                <input
                  type="date"
                  aria-label="من تاريخ القوائم المالية"
                  value={fromDate}
                  onChange={(e) => {
                    setPeriodPreset("custom");
                    setFromDate(e.target.value);
                  }}
                />
              </label>
              <label className="erp-scope-field">
                <span>إلى تاريخ</span>
                <input
                  type="date"
                  aria-label="إلى تاريخ القوائم المالية"
                  value={toDate}
                  onChange={(e) => {
                    setPeriodPreset("custom");
                    setToDate(e.target.value);
                  }}
                />
              </label>
              <button
                type="button"
                className="erp-chip-btn"
                onClick={() => handlePresetChange("all")}
              >
                الكل
              </button>
            </div>
          ) : null}

          <div className="erp-scope-meta" data-testid="erp-finance-scope-summary">
            <div>
              <b>النطاق:</b> <bdi>{periodLabel}</bdi> · <b>العملة:</b> <bdi>{currencyDisplayLabel}</bdi>
            </div>
            <div>
              <b>المصدر:</b> سجلات النظام ({accounts.length} حساب · {cashboxes.length} صندوق ·{" "}
              {inventory.length} صنف) — حركات مطابقة: <b>{activeScopeMeta?.matchedEntriesCount ?? 0}</b>
              {(activeScopeMeta?.excludedByCurrencyCount ?? 0) > 0
                ? ` · مستبعد لاختلاف العملة: ${activeScopeMeta?.excludedByCurrencyCount}`
                : ""}
              {(activeScopeMeta?.excludedByDateCount ?? 0) > 0
                ? ` · خارج الفترة: ${activeScopeMeta?.excludedByDateCount}`
                : ""}
              {" "}· القوائم فعلية ولا تشمل الموازنات التخطيطية.
            </div>
          </div>
        </section>

        {tab === "trial" ? (
          <section className="erp-card" data-testid="erp-trial-balance-card">
            <div className="erp-card-head">
              <div>
                <h3>ميزان المراجعة العام</h3>
                <small>
                  {companyName} · {trial.rows.length} حساب · <bdi>{currencyDisplayLabel}</bdi>
                </small>
              </div>
              <button type="button" className="erp-chip-btn" onClick={exportCsv}>
                <DownloadIcon />
                <span>تصدير Excel</span>
              </button>
            </div>

            <div className="erp-summary-strip">
              <div>
                <small>إجمالي الأرصدة المدينة ({currencyDisplayLabel})</small>
                <strong className="neg"><bdi>{formatAmount(trial.totalClosingDebit)}</bdi></strong>
              </div>
              <div>
                <small>إجمالي الأرصدة الدائنة ({currencyDisplayLabel})</small>
                <strong className="pos"><bdi>{formatAmount(trial.totalClosingCredit)}</bdi></strong>
              </div>
            </div>

            <div className="erp-table-wrap">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th>حركة مدين</th>
                    <th>حركة دائن</th>
                    <th>الختامي</th>
                  </tr>
                </thead>
                <tbody>
                  {trial.rows.slice(0, visibleTrialRows).map((row) => (
                    <tr key={row.accountId}>
                      <td>
                        <div className="erp-cell-title">{row.accountName}</div>
                        <small>{CATEGORY_LABELS[row.category]}</small>
                      </td>
                      <td className="num"><bdi>{formatAmount(row.debitTurnover)}</bdi></td>
                      <td className="num"><bdi>{formatAmount(row.creditTurnover)}</bdi></td>
                      <td className={`num ${row.closingDebit > 0 ? "neg" : row.closingCredit > 0 ? "pos" : ""}`}>
                        <bdi>
                          {row.closingDebit > 0
                            ? `${formatAmount(row.closingDebit)} م`
                            : row.closingCredit > 0
                              ? `${formatAmount(row.closingCredit)} د`
                              : "0"}
                        </bdi>
                      </td>
                    </tr>
                  ))}
                  {trial.rows.length > visibleTrialRows ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", padding: 8 }}>
                        <button
                          type="button"
                          className="load-more-list-btn"
                          onClick={() => setVisibleTrialRows((v) => v + 100)}
                        >
                          عرض المزيد (المعروض {visibleTrialRows} من {trial.rows.length} حساب)
                        </button>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {tab === "income" ? (
          <section className="erp-card" data-testid="erp-income-statement-card">
            <div className="erp-card-head">
              <div>
                <h3>قائمة الدخل (الأرباح والخسائر)</h3>
                <small>
                  الفواتير والمصاريف المرحلة — <bdi>{periodLabel}</bdi>
                </small>
              </div>
              <span className="erp-badge">{currencyDisplayLabel}</span>
            </div>

            <div className="erp-stmt-list">
              <div className="erp-stmt-row">
                <span>إجمالي إيرادات المبيعات</span>
                <strong className="pos"><bdi>{formatAmount(income.salesRevenue)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>(−) مرتجعات المبيعات</span>
                <strong className="neg"><bdi>{formatAmount(income.salesReturns)}</bdi></strong>
              </div>
              <div className="erp-stmt-row total">
                <span>صافي المبيعات</span>
                <strong><bdi>{formatAmount(income.netSales)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>(−) تكلفة البضاعة والمشتريات (COGS)</span>
                <strong className="neg"><bdi>{formatAmount(income.cogs)}</bdi></strong>
              </div>
              <div className="erp-stmt-row total">
                <span>مجمل الربح ({income.grossMarginPct}%)</span>
                <strong className={income.grossProfit >= 0 ? "pos" : "neg"}>
                  <bdi>{formatAmount(income.grossProfit)}</bdi>
                </strong>
              </div>

              <div className="erp-stmt-subhead">المصاريف التشغيلية حسب البند</div>
              {income.expensesByCategory.length === 0 ? (
                <p className="erp-muted-note">لا توجد مصاريف تشغيلية مسجلة في النطاق المحدد.</p>
              ) : (
                income.expensesByCategory.map((item) => (
                  <div className="erp-stmt-row" key={item.category}>
                    <span>{item.category}</span>
                    <strong className="neg"><bdi>{formatAmount(item.amount)}</bdi></strong>
                  </div>
                ))
              )}

              <div className="erp-stmt-row grand">
                <span>صافي الربح / الخسارة</span>
                <strong className={income.netProfit >= 0 ? "pos" : "neg"}>
                  <bdi>
                    {income.netProfit < 0 ? "−" : ""}
                    {formatAmount(Math.abs(income.netProfit))} {currencyDisplayLabel}
                  </bdi>
                </strong>
              </div>
            </div>
          </section>
        ) : null}

        {tab === "balance" ? (
          <section className="erp-card" data-testid="erp-balance-sheet-card">
            <div className="erp-card-head">
              <div>
                <h3>المركز المالي (الميزانية العمومية)</h3>
                <small>
                  الأصول = الخصوم + حقوق الملكية · <bdi>{periodLabel}</bdi>
                </small>
              </div>
              <span className="erp-badge">{currencyDisplayLabel}</span>
            </div>

            <div className="erp-reconcile-toggles">
              <label>
                <input
                  type="checkbox"
                  checked={useUnifiedCash}
                  onChange={(e) => setUseUnifiedCash(e.target.checked)}
                />
                <span>اعتماد تدفق الصناديق الموحد في بند النقدية (بدلاً من حسابات الدليل فقط)</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  data-testid="erp-balance-include-unverified-inv"
                  checked={includeUnverifiedInventory}
                  onChange={(e) => setIncludeUnverifiedInventory(e.target.checked)}
                />
                <span>إدراج القيمة التقديرية للمخزون غير المجرود ضمن الأصول</span>
              </label>
            </div>

            <div className="erp-stmt-list">
              <div className="erp-stmt-subhead">الأصول (Assets)</div>
              <div className="erp-stmt-row">
                <span>
                  {useUnifiedCash
                    ? "النقدية والصناديق الفعلية (مربوط + نقدي مباشر)"
                    : "حسابات النقدية والحوالات في الدليل"}
                </span>
                <strong><bdi>{formatAmount(balanceSheet.cashAndBank)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>ذمم العملاء المدينة (AR)</span>
                <strong><bdi>{formatAmount(balanceSheet.accountsReceivable)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>
                  {includeUnverifiedInventory
                    ? "المخزون السلعي (معتمد + تقديري من الحركات)"
                    : "المخزون السلعي المعتمد بالجرد فقط"}
                </span>
                <strong><bdi>{formatAmount(balanceSheet.inventoryValue)}</bdi></strong>
              </div>
              <div className="erp-stmt-row total">
                <span>إجمالي الأصول</span>
                <strong className="pos"><bdi>{formatAmount(balanceSheet.totalAssets)}</bdi></strong>
              </div>

              <div className="erp-stmt-subhead">الخصوم وحقوق الملكية</div>
              <div className="erp-stmt-row">
                <span>ذمم الموردين الدائنة (AP)</span>
                <strong><bdi>{formatAmount(balanceSheet.accountsPayable)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>مستحقات الموظفين والرواتب</span>
                <strong><bdi>{formatAmount(balanceSheet.payrollPayable)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>صافي حقوق الملكية ورأس المال / التسوية التراكمية</span>
                <strong><bdi>{formatAmount(balanceSheet.ownerEquityBase)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>أرباح / خسائر الفترة المحددة</span>
                <strong className={balanceSheet.currentPeriodProfit >= 0 ? "pos" : "neg"}>
                  <bdi>{formatAmount(balanceSheet.currentPeriodProfit)}</bdi>
                </strong>
              </div>
              <div className="erp-stmt-row grand">
                <span>إجمالي الخصوم وحقوق الملكية</span>
                <strong><bdi>{formatAmount(balanceSheet.totalLiabilitiesAndEquity)} {currencyDisplayLabel}</bdi></strong>
              </div>
            </div>

            {balanceSheet.cashReconciliation && balanceSheet.inventoryReconciliation ? (
              <div className="erp-reconcile-box" data-testid="erp-balance-reconciliation">
                <h4>مطابقة وتسوية النقدية والمخزون (نفس الفترة والعملة)</h4>

                <div className="erp-stmt-subhead">1) تسوية النقدية: تقرير الصناديق مقابل الميزانية ودليل الحسابات</div>
                {(serverCashboxesReport?.cashboxes ?? balanceSheet.cashReconciliation.linkedCashboxes).map((cb) => (
                  <div className="erp-stmt-row" key={cb.id}>
                    <span>
                      صندوق «{cb.name}» ({cb.currencyCode} · {cb.entryCount} حركة{cb.isActive === false ? " · موقوف" : ""})
                    </span>
                    <strong><bdi>{formatAmount(cb.netBalance)}</bdi></strong>
                  </div>
                ))}
                <div className="erp-stmt-row">
                  <span>مجموع صافي الصناديق المربوطة بـ cashbox_id</span>
                  <strong><bdi>{formatAmount(balanceSheet.cashReconciliation.linkedCashboxesNet)}</bdi></strong>
                </div>
                <div className="erp-stmt-row">
                  <span>
                    (+) حركات نقدية مسددة بدون ربط صندوق ({balanceSheet.cashReconciliation.unassignedCashCount} حركة)
                  </span>
                  <strong><bdi>{formatAmount(balanceSheet.cashReconciliation.unassignedCashNet)}</bdi></strong>
                </div>
                <div className="erp-stmt-row total">
                  <span>(=) إجمالي النقدية الموحدة للصناديق والحركات</span>
                  <strong><bdi>{formatAmount(balanceSheet.cashReconciliation.totalCashFlowNet)}</bdi></strong>
                </div>
                <div className="erp-stmt-row">
                  <span>أرصدة حسابات النقدية والحوالات في الدليل (isCashAccount / transfers)</span>
                  <strong><bdi>{formatAmount(balanceSheet.cashReconciliation.ledgerCashAccountsNet)}</bdi></strong>
                </div>
                <div className="erp-stmt-row">
                  <span>الفرق بين التدفق النقدي الموحد وأرصدة الدليل</span>
                  <strong className="warn">
                    <bdi>{formatAmount(balanceSheet.cashReconciliation.differenceVsLedgerAccounts)}</bdi>
                  </strong>
                </div>
                <p className="erp-muted-note">
                  سبب الفرق: الفواتير النقدية الفورية (settledOnReceipt) تُغسل في كشف الحساب حتى لا تُحسب ذمة،
                  بينما يعتمد تقرير الصناديق على الحركات المرتبطة بـ cashbox_id. في العملة الواحدة يكون{" "}
                  <code>إجمالي النقدية الموحد = مجموع الصناديق + الحركات غير المربوطة بصندوق</code>.
                </p>

                <div className="erp-stmt-subhead">2) تسوية المخزون: الجرد المعتمد مقابل تقرير حركة المخزون</div>
                <div className="erp-stmt-row">
                  <span>
                    المخزون المعتمد بجرد افتتاحي فعلي ({balanceSheet.inventoryReconciliation.verifiedCount} صنف)
                  </span>
                  <strong><bdi>{formatAmount(balanceSheet.inventoryReconciliation.verifiedValue)}</bdi></strong>
                </div>
                <div className="erp-stmt-row">
                  <span>
                    المخزون التقديري من حركات الفواتير والتحويلات ({balanceSheet.inventoryReconciliation.unverifiedCount} صنف غير مجرود)
                  </span>
                  <strong className="pos">
                    <bdi>{formatAmount(balanceSheet.inventoryReconciliation.unverifiedEstimatedValue)}</bdi>
                  </strong>
                </div>
                <div className="erp-stmt-row total">
                  <span>إجمالي تقرير حركة المخزون التقديري ({currencyDisplayLabel})</span>
                  <strong><bdi>{formatAmount(balanceSheet.inventoryReconciliation.inventoryReportTotalValue)}</bdi></strong>
                </div>
                <div className="erp-stmt-row">
                  <span>الفرق الظاهر في الميزانية حالياً</span>
                  <strong className="warn">
                    <bdi>{formatAmount(balanceSheet.inventoryReconciliation.differenceVsInventoryReport)}</bdi>
                  </strong>
                </div>
                <p className="erp-muted-note">
                  سبب صفرية المخزون المعتمد: جميع الأصناف المستوردة (<code>{balanceSheet.inventoryReconciliation.unverifiedCount}</code>)
                  موسومة كغير مجرودة (<code>quantity_unverified = 1</code>) ولا تُدرج تلقائياً في الميزانية كأصل مؤكد قبل الجرد الافتتاحي أو تفعيل الإدراج التقديري أعلاه.
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "vat" ? (
          <section className="erp-card" data-testid="erp-vat-card">
            <div className="erp-card-head">
              <div>
                <h3>تقرير ضريبة القيمة المضافة</h3>
                <small>
                  الولاية: {VAT_JURISDICTION_LABELS[vatJurisdiction]} · النسبة: {numericVatRatePercent}%
                </small>
              </div>
              <span className="erp-badge">
                {vatBasis === "recorded_only"
                  ? "مسجل فعلياً"
                  : `${numericVatRatePercent}% تقديري`}
              </span>
            </div>

            <div className="erp-vat-config" data-testid="erp-vat-config">
              <div className="erp-scope-controls">
                <label className="erp-scope-field">
                  <span>الولاية / النظام الضريبي</span>
                  <select
                    aria-label="الولاية الضريبية"
                    data-testid="erp-vat-jurisdiction-select"
                    value={vatJurisdiction}
                    onChange={(e) => handleJurisdictionChange(e.target.value as ErpVatJurisdiction)}
                  >
                    <option value="none">غير مفعّل / بدون ولاية ضريبية (0%)</option>
                    <option value="sa_15">المملكة العربية السعودية (15% تقديري)</option>
                    <option value="ae_5">الإمارات العربية المتحدة (5% تقديري)</option>
                    <option value="custom">معدل مخصص (%)</option>
                  </select>
                </label>

                <label className="erp-scope-field">
                  <span>طريقة الاحتساب</span>
                  <select
                    aria-label="طريقة احتساب الضريبة"
                    data-testid="erp-vat-basis-select"
                    value={vatBasis}
                    onChange={(e) => setVatBasis(e.target.value as "recorded_only" | "estimated_gross")}
                  >
                    <option value="recorded_only">الضريبة المسجلة بالفواتير فقط</option>
                    <option value="estimated_gross">احتساب تقديري على صافي الحركات</option>
                  </select>
                </label>
              </div>

              {vatJurisdiction === "custom" ? (
                <div className="erp-scope-dates">
                  <label className="erp-scope-field">
                    <span>معدل الضريبة المخصص (%)</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      aria-label="نسبة الضريبة المخصصة"
                      value={vatRatePercent}
                      onChange={(e) => setVatRatePercent(e.target.value)}
                    />
                  </label>
                </div>
              ) : null}

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="erp-chip-btn" data-testid="erp-vat-save-btn" onClick={saveVatSettings}>
                  <span>حفظ إعداد الضريبة</span>
                </button>
              </div>
            </div>

            <div className="erp-warning-banner" data-testid="erp-vat-warning" role="status">
              {!vatIsConfigured && vatBasis === "estimated_gross" ? (
                <>
                  <strong>تنبيه تحقق ضريبي:</strong> لم تُعتمد ولاية ضريبية في إعدادات القاعدة بعد؛ الرقم المعروض بنسبة{" "}
                  <b>{numericVatRatePercent}%</b> هو <b>محاكاة تقديرية</b> وليس التزاماً ضريبياً ملزماً. الفواتير المسجل بها
                  ضريبة صراحةً في الدفتر: <b>{vat.entriesWithRecordedTaxCount ?? 0}</b>.
                </>
              ) : vatBasis === "recorded_only" ? (
                <>
                  <strong>وضع الاعتماد على المسجل:</strong> يتم احتساب مبالغ الضريبة المُرحّلة صراحةً في الفواتير فقط (
                  <b>{vat.entriesWithRecordedTaxCount ?? 0}</b> فاتورة بها ضريبة مسجلة). الإعداد:{" "}
                  <b>{VAT_JURISDICTION_LABELS[vatJurisdiction]}</b>.
                </>
              ) : (
                <>
                  <strong>إعداد ضريبي مفعّل ({numericVatRatePercent}% تقديري):</strong> يُطبق على المبيعات والمشتريات
                  الخاضعة في نطاق <bdi>{periodLabel}</bdi> بعملة <bdi>{currencyDisplayLabel}</bdi>. الفواتير ذات الضريبة المسجلة صراحة:{" "}
                  <b>{vat.entriesWithRecordedTaxCount ?? 0}</b>.
                </>
              )}
            </div>

            <div className="erp-stmt-list">
              <div className="erp-stmt-row">
                <span>إجمالي المبيعات الخاضعة (في النطاق)</span>
                <strong><bdi>{formatAmount(vat.taxableSales)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>
                  {vatBasis === "recorded_only"
                    ? "ضريبة المخرجات المسجلة على المبيعات"
                    : `ضريبة المخرجات التقديرية (${numericVatRatePercent}%)`}
                </span>
                <strong className="warn"><bdi>{formatAmount(vat.outputVat)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>إجمالي المشتريات الخاضعة (في النطاق)</span>
                <strong><bdi>{formatAmount(vat.taxablePurchases)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>
                  {vatBasis === "recorded_only"
                    ? "ضريبة المدخلات المسجلة على المشتريات"
                    : `ضريبة المدخلات التقديرية (${numericVatRatePercent}%)`}
                </span>
                <strong className="pos"><bdi>{formatAmount(vat.inputVat)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>مجموع الضريبة الصريحة المسجلة فعلياً بالفواتير (مخرجات / مدخلات)</span>
                <strong>
                  <bdi>
                    {formatAmount(vat.recordedOutputVat ?? 0)} / {formatAmount(vat.recordedInputVat ?? 0)}
                  </bdi>
                </strong>
              </div>
              <div className="erp-stmt-row grand">
                <span>
                  {vatBasis === "recorded_only" && (vat.entriesWithRecordedTaxCount ?? 0) === 0
                    ? "صافي الضريبة المسجلة"
                    : vat.netVatPayable >= 0
                      ? "صافي الضريبة التقديرية المستحقة"
                      : "رصيد ضريبي دائن (قابل للاسترداد)"}
                </span>
                <strong className={vat.netVatPayable >= 0 ? "neg" : "pos"}>
                  <bdi>{formatAmount(Math.abs(vat.netVatPayable))} {currencyDisplayLabel}</bdi>
                </strong>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </MobileScroll>
  );
}
