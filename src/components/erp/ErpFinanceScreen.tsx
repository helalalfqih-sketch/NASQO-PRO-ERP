import { useMemo, useState } from "react";
import { DownloadIcon } from "@radix-ui/react-icons";
import { buildCsvContent, formatAmount } from "../../accounting";
import {
  computeBalanceSheet,
  computeIncomeStatement,
  computeTrialBalance,
  computeVatSummary,
} from "../../erp";
import { MobileScroll } from "../../mobile";
import type { AccountRecord, InventoryItemRecord, LedgerEntryRecord } from "../../types";
import { triggerHaptic } from "../../utils/haptics";

type FinanceTab = "trial" | "income" | "balance" | "vat";

const CATEGORY_LABELS: Record<AccountRecord["category"], string> = {
  purchases: "موردون ومشتريات",
  sales: "المبيعات",
  clients: "العملاء",
  employees: "الموظفون",
  transfers: "الحوالات والنقدية",
  shop: "مصروفات المحل",
};

export function ErpFinanceScreen({
  companyName,
  currency,
  accounts,
  ledger,
  inventory,
  onToast,
}: {
  companyName: string;
  currency: string;
  accounts: readonly AccountRecord[];
  ledger: readonly LedgerEntryRecord[];
  inventory: readonly InventoryItemRecord[];
  onToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<FinanceTab>("trial");

  const trial = useMemo(() => computeTrialBalance(accounts, ledger), [accounts, ledger]);
  const income = useMemo(() => computeIncomeStatement(accounts, ledger), [accounts, ledger]);
  const balanceSheet = useMemo(
    () => computeBalanceSheet(accounts, ledger, inventory),
    [accounts, inventory, ledger],
  );
  const vat = useMemo(() => computeVatSummary(accounts, ledger, 0.15), [accounts, ledger]);

  const exportCsv = () => {
    triggerHaptic("light");
    const csv = buildCsvContent(
      ["الرقم", "الحساب", "التصنيف", "حركة مدين", "حركة دائن", "رصيد مدين", "رصيد دائن"],
      trial.rows.map((r) => [
        r.codeNumber,
        r.accountName,
        CATEGORY_LABELS[r.category],
        r.debitTurnover,
        r.creditTurnover,
        r.closingDebit,
        r.closingCredit,
      ]),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "erp-trial-balance.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 800);
    onToast("تم تصدير ميزان المراجعة بصيغة CSV");
  };

  return (
    <MobileScroll className="app-screen erp-scroll">
      <main className="erp-page" data-testid="erp-finance-screen">
        <div className="erp-segmented" role="tablist" aria-label="القوائم المالية">
          {(
            [
              ["trial", "ميزان المراجعة"],
              ["income", "قائمة الدخل"],
              ["balance", "الميزانية"],
              ["vat", "الضرائب VAT"],
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

        {tab === "trial" ? (
          <section className="erp-card" data-testid="erp-trial-balance-card">
            <div className="erp-card-head">
              <div>
                <h3>ميزان المراجعة العام</h3>
                <small>{companyName} · {trial.rows.length} حساب نشط</small>
              </div>
              <button type="button" className="erp-chip-btn" onClick={exportCsv}>
                <DownloadIcon />
                <span>تصدير CSV</span>
              </button>
            </div>

            <div className="erp-summary-strip">
              <div>
                <small>إجمالي الأرصدة المدينة</small>
                <strong className="neg"><bdi>{formatAmount(trial.totalClosingDebit)}</bdi></strong>
              </div>
              <div>
                <small>إجمالي الأرصدة الدائنة</small>
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
                  {trial.rows.map((row) => (
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
                <small>مشتقة من الفواتير والمبيعات والمصاريف المرحلة</small>
              </div>
              <span className="erp-badge">{currency}</span>
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
                <p className="erp-muted-note">لا توجد مصاريف تشغيلية مسجلة في الفترة الحالية.</p>
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
                    {formatAmount(Math.abs(income.netProfit))} {currency}
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
                <small>الأصول = الخصوم + حقوق الملكية</small>
              </div>
              <span className="erp-badge">{currency}</span>
            </div>

            <div className="erp-stmt-list">
              <div className="erp-stmt-subhead">الأصول (Assets)</div>
              <div className="erp-stmt-row">
                <span>النقدية والصناديق والحوالات</span>
                <strong><bdi>{formatAmount(balanceSheet.cashAndBank)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>ذمم العملاء المدينة (AR)</span>
                <strong><bdi>{formatAmount(balanceSheet.accountsReceivable)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>المخزون السلعي بالتكلفة</span>
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
                <span>صافي حقوق الملكية ورأس المال</span>
                <strong><bdi>{formatAmount(balanceSheet.ownerEquityBase)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>أرباح / خسائر الفترة الحالية</span>
                <strong className={balanceSheet.currentPeriodProfit >= 0 ? "pos" : "neg"}>
                  <bdi>{formatAmount(balanceSheet.currentPeriodProfit)}</bdi>
                </strong>
              </div>
              <div className="erp-stmt-row grand">
                <span>إجمالي الخصوم وحقوق الملكية</span>
                <strong><bdi>{formatAmount(balanceSheet.totalLiabilitiesAndEquity)} {currency}</bdi></strong>
              </div>
            </div>
          </section>
        ) : null}

        {tab === "vat" ? (
          <section className="erp-card" data-testid="erp-vat-card">
            <div className="erp-card-head">
              <div>
                <h3>الإقرار الضريبي — ضريبة القيمة المضافة</h3>
                <small>احتساب آلي بنسبة {Math.round(vat.vatRate * 100)}% على الفواتير والمرتجعات</small>
              </div>
              <span className="erp-badge">15% VAT</span>
            </div>

            <div className="erp-stmt-list">
              <div className="erp-stmt-row">
                <span>إجمالي المبيعات الخاضعة للضريبة</span>
                <strong><bdi>{formatAmount(vat.taxableSales)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>ضريبة المخرجات (المبيعات) 15%</span>
                <strong className="warn"><bdi>{formatAmount(vat.outputVat)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>إجمالي المشتريات الخاضعة للضريبة</span>
                <strong><bdi>{formatAmount(vat.taxablePurchases)}</bdi></strong>
              </div>
              <div className="erp-stmt-row">
                <span>ضريبة المدخلات القابلة للاسترداد 15%</span>
                <strong className="pos"><bdi>{formatAmount(vat.inputVat)}</bdi></strong>
              </div>
              <div className="erp-stmt-row grand">
                <span>{vat.netVatPayable >= 0 ? "صافي الضريبة المستحقة للدفع" : "رصيد ضريبي دائن مسترد"}</span>
                <strong className={vat.netVatPayable >= 0 ? "neg" : "pos"}>
                  <bdi>{formatAmount(Math.abs(vat.netVatPayable))} {currency}</bdi>
                </strong>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </MobileScroll>
  );
}
