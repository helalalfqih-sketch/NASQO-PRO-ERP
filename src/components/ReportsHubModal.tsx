import { useEffect, useMemo, useState } from "react";
import { ArrowRightIcon, Cross2Icon } from "@radix-ui/react-icons";
import {
  computeCategoryTotals,
  computeTrialBalanceReport,
  formatAmount,
  formatSignedSmartBalance,
  getCategoryTitle,
} from "../accounting";
import { fetchInventoryMovementsReport } from "../firebase";
import {
  ACCOUNT_CATEGORIES,
  type AccountRecord,
  type CashboxRecord,
  type InventoryItemRecord,
  type LedgerEntryRecord,
  type WarehouseRecord,
} from "../types";

type ReportId =
  | "closing"
  | "by-category"
  | "stock-remaining"
  | "stock-expiry"
  | "invoice-profit"
  | "services"
  | "tax";

type MovementReport = Awaited<ReturnType<typeof fetchInventoryMovementsReport>>;

interface ReportsHubModalProps {
  open: boolean;
  onClose: () => void;
  uid: string;
  accounts: readonly AccountRecord[];
  ledger: readonly LedgerEntryRecord[];
  inventory: readonly InventoryItemRecord[];
  warehouses: readonly WarehouseRecord[];
  cashboxes: readonly CashboxRecord[];
  currencyCodes: readonly string[];
  defaultCurrency: string;
  onOpenCashboxes: () => void;
  onOpenTrialBalance: () => void;
  onOpenInventoryMovements: () => void;
}

const REPORT_TITLES: Record<ReportId, string> = {
  closing: "تقرير الحسابات الختامية",
  "by-category": "تقرير إجمالي حسب التصنيف",
  "stock-remaining": "المخزون المتبقي",
  "stock-expiry": "المخزون المتبقي وتاريخ الانتهاء",
  "invoice-profit": "أرباح الفواتير",
  services: "تقارير الخدمات",
  tax: "التقارير الضريبية",
};

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

function stockQty(item: InventoryItemRecord): number {
  return item.quantityUnverified ? (item.computedQuantity ?? 0) : item.quantity;
}

function matchesCurrency(entryCurrency: string, filter: string): boolean {
  return filter === "الكل" || entryCurrency === filter;
}

export function ReportsHubModal({
  open,
  onClose,
  uid,
  accounts,
  ledger,
  inventory,
  warehouses,
  cashboxes,
  currencyCodes,
  defaultCurrency,
  onOpenCashboxes,
  onOpenTrialBalance,
  onOpenInventoryMovements,
}: ReportsHubModalProps) {
  const [report, setReport] = useState<ReportId | null>(null);
  const [currency, setCurrency] = useState(defaultCurrency || "ريال");
  const [warehouseId, setWarehouseId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [profitData, setProfitData] = useState<MovementReport | null>(null);
  const [profitError, setProfitError] = useState("");

  useEffect(() => {
    if (!open) setReport(null);
  }, [open]);

  useEffect(() => {
    if (!open || report !== "invoice-profit") return;
    let active = true;
    setProfitData(null);
    setProfitError("");
    void fetchInventoryMovementsReport(uid, {
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      currency: currency !== "الكل" ? currency : undefined,
      warehouseId: warehouseId || undefined,
    })
      .then((res) => {
        if (active) setProfitData(res);
      })
      .catch(() => {
        if (active) setProfitError("تعذر تحميل تقرير الأرباح من قاعدة البيانات.");
      });
    return () => {
      active = false;
    };
  }, [open, report, uid, fromDate, toDate, currency, warehouseId]);

  const activeLedger = useMemo(() => ledger.filter((e) => !e.deleted), [ledger]);

  const closing = useMemo(
    () => computeTrialBalanceReport(accounts, ledger, inventory, cashboxes, { currency }),
    [accounts, ledger, inventory, cashboxes, currency],
  );

  const categoryTotals = useMemo(
    () => computeCategoryTotals(accounts, ledger, currency),
    [accounts, ledger, currency],
  );

  const stockRows = useMemo(
    () =>
      inventory
        .filter((i) => !warehouseId || i.warehouseId === warehouseId)
        .map((i) => ({ item: i, qty: stockQty(i) }))
        .filter((r) => Math.abs(r.qty) > 0.0001)
        .sort((a, b) => a.item.name.localeCompare(b.item.name, "ar")),
    [inventory, warehouseId],
  );
  const stockTotals = useMemo(
    () => ({
      qty: round2(stockRows.reduce((s, r) => s + r.qty, 0)),
      value: round2(stockRows.reduce((s, r) => s + r.qty * r.item.avgCost, 0)),
    }),
    [stockRows],
  );

  const todayMs = useMemo(() => {
    const t = new Date();
    return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  }, []);
  const expiryRows = useMemo(
    () =>
      stockRows
        .filter((r) => Boolean(r.item.expiryDate))
        .map((r) => {
          const ms = Date.parse(`${r.item.expiryDate}T00:00:00Z`);
          const days = Number.isFinite(ms) ? Math.round((ms - todayMs) / 86_400_000) : null;
          return { ...r, days };
        })
        .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9)),
    [stockRows, todayMs],
  );

  const profitRows = useMemo(
    () =>
      (profitData?.itemRows ?? [])
        .filter((r) => Math.abs(r.sellQty) > 0.0001 || Math.abs(r.sellTotal) > 0.0001)
        .sort((a, b) => b.profit - a.profit),
    [profitData],
  );

  const serviceRows = useMemo(
    () =>
      activeLedger
        .filter(
          (e) =>
            e.kind === "invoice" && e.invoiceContent === "free" && matchesCurrency(e.currency, currency),
        )
        .sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.entryNumber - a.entryNumber),
    [activeLedger, currency],
  );
  const serviceTotals = useMemo(() => {
    let sales = 0;
    let purchases = 0;
    for (const e of serviceRows) {
      if (e.direction === "debit") sales += e.amount;
      else purchases += e.amount;
    }
    return { sales: round2(sales), purchases: round2(purchases) };
  }, [serviceRows]);

  const tax = useMemo(() => {
    let output = 0;
    let input = 0;
    let taxedDocs = 0;
    for (const e of activeLedger) {
      if ((e.kind !== "invoice" && e.kind !== "return") || !matchesCurrency(e.currency, currency)) continue;
      const t = Number(e.taxAmount ?? 0);
      if (!(t > 0)) continue;
      taxedDocs += 1;
      const isSaleSide = e.kind === "invoice" ? e.direction === "debit" : e.direction === "credit";
      const sign = e.kind === "return" ? -1 : 1;
      if (isSaleSide) output += sign * t;
      else input += sign * t;
    }
    return { output: round2(output), input: round2(input), net: round2(output - input), taxedDocs };
  }, [activeLedger, currency]);

  if (!open) return null;

  const openExternal = (fn: () => void) => {
    onClose();
    fn();
  };

  const menu: { label: string; tone: "orange" | "blue"; run: () => void }[][] = [
    [
      { label: "حركة الصندوق", tone: "orange", run: () => openExternal(onOpenCashboxes) },
      { label: "تقرير الحسابات الختامية", tone: "blue", run: () => setReport("closing") },
      { label: "تقرير اجمالي حسب التصنيف", tone: "orange", run: () => setReport("by-category") },
      { label: "ميزان المراجعة", tone: "blue", run: () => openExternal(onOpenTrialBalance) },
    ],
    [
      { label: "تقرير حركة المخزون والارباح", tone: "orange", run: () => openExternal(onOpenInventoryMovements) },
      { label: "تقرير المخزون المتبقي وتاريخ الانتهاء", tone: "blue", run: () => setReport("stock-expiry") },
      { label: "المخزون المتبقي", tone: "orange", run: () => setReport("stock-remaining") },
      { label: "أرباح الفواتير", tone: "blue", run: () => setReport("invoice-profit") },
      { label: "تقارير الخدمات", tone: "orange", run: () => setReport("services") },
      { label: "تقارير ضريبية", tone: "blue", run: () => setReport("tax") },
    ],
  ];
  const sectionTitles = ["التقارير المالية", "التقارير المخزنية"];

  const usesCurrency = report === "closing" || report === "by-category" || report === "services" || report === "tax" || report === "invoice-profit";
  const usesWarehouse = report === "stock-remaining" || report === "stock-expiry" || report === "invoice-profit";
  const usesDates = report === "invoice-profit";

  const row = (label: string, value: string, tone?: "pos" | "neg") => (
    <div className="trial-balance-row" key={label}>
      <span className="trial-row-label">{label}</span>
      <strong className={`trial-row-val ${tone ?? ""}`}>
        <bdi>{value}</bdi>
      </strong>
    </div>
  );

  return (
    <div className="center-modal-layer" data-testid="reports-hub-modal">
      <button className="center-modal-backdrop" onClick={onClose} aria-label="إغلاق التقارير" />
      <section
        className="account-groups-modal reports-hub-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reports-hub-title"
      >
        <header className="smart-modal-header">
          <button type="button" className="smart-modal-close" onClick={onClose} aria-label="إغلاق">
            <Cross2Icon />
          </button>
          <h2 id="reports-hub-title">{report ? REPORT_TITLES[report] : "التقارير"}</h2>
          {report ? (
            <button
              type="button"
              className="smart-modal-close"
              onClick={() => setReport(null)}
              aria-label="رجوع إلى قائمة التقارير"
              data-testid="reports-back-btn"
            >
              <ArrowRightIcon />
            </button>
          ) : (
            <span className="smart-modal-spacer" aria-hidden="true" />
          )}
        </header>

        {!report ? (
          <div className="reports-hub-menu" data-testid="reports-hub-menu">
            {menu.map((group, gi) => (
              <div key={sectionTitles[gi]}>
                <div className="reports-hub-section">{sectionTitles[gi]}</div>
                {group.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`reports-hub-btn ${item.tone}`}
                    onClick={item.run}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="reports-hub-detail">
            {usesCurrency || usesWarehouse || usesDates ? (
              <div className="reports-hub-filters">
                {usesCurrency ? (
                  <label>
                    <span>العملة</span>
                    <select aria-label="عملة التقرير" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {currencyCodes.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      <option value="الكل">الكل</option>
                    </select>
                  </label>
                ) : null}
                {usesWarehouse ? (
                  <label>
                    <span>المخزن</span>
                    <select aria-label="مخزن التقرير" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                      <option value="">جميع المخازن</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {usesDates ? (
                  <>
                    <label>
                      <span>من تاريخ</span>
                      <input type="date" dir="ltr" aria-label="من تاريخ" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                    </label>
                    <label>
                      <span>إلى تاريخ</span>
                      <input type="date" dir="ltr" aria-label="إلى تاريخ" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                    </label>
                  </>
                ) : null}
              </div>
            ) : null}

            {report === "closing" ? (
              <div data-testid="report-closing">
                <div className="smart-section-band">الأرصدة</div>
                <div className="trial-balance-rows">
                  {row("إجمالي المدين (عليهم)", formatAmount(closing.totalDebitAccounts), "pos")}
                  {row("إجمالي الدائن (لهم)", formatAmount(closing.totalCreditAccounts), "neg")}
                  {row("إجمالي النقدية", formatAmount(closing.cashTotal), "pos")}
                  {row("صافي الرصيد", formatSignedSmartBalance(closing.netBalance), closing.netBalance < 0 ? "neg" : "pos")}
                </div>
                <div className="smart-section-band">نتيجة النشاط</div>
                <div className="trial-balance-rows">
                  {row("المبيعات", formatAmount(closing.salesTotal), "pos")}
                  {row("المشتريات", formatAmount(closing.purchasesTotal), "neg")}
                  {row("قيمة المخزون", formatAmount(closing.inventoryValue), "pos")}
                  {row("صافي الربح", formatSignedSmartBalance(closing.netProfit), closing.netProfit < 0 ? "neg" : "pos")}
                </div>
              </div>
            ) : null}

            {report === "by-category" ? (
              <div className="account-groups-table-wrap" data-testid="report-by-category">
                <table className="account-groups-table">
                  <thead>
                    <tr>
                      <th>التصنيف</th>
                      <th>الحسابات</th>
                      <th>عليه</th>
                      <th>له</th>
                      <th>الرصيد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ACCOUNT_CATEGORIES.map((cat) => {
                      const b = categoryTotals[cat];
                      return (
                        <tr key={cat}>
                          <td className="ag-name-cell">{getCategoryTitle(cat)}</td>
                          <td>{b.count}</td>
                          <td className="coa-debit-cell">{formatAmount(b.debitTotal)}</td>
                          <td className="coa-credit-cell">{formatAmount(b.creditTotal)}</td>
                          <td className={b.netSigned < 0 ? "coa-debit-cell" : "coa-credit-cell"}>
                            {formatAmount(Math.abs(b.netSigned))} {b.netSigned < 0 ? "عليه" : b.netSigned > 0 ? "له" : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {report === "stock-remaining" ? (
              <div className="account-groups-table-wrap" data-testid="report-stock-remaining">
                <table className="account-groups-table">
                  <thead>
                    <tr>
                      <th>الرقم</th>
                      <th>اسم الصنف</th>
                      <th>الوحدة</th>
                      <th>الكمية</th>
                      <th>القيمة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockRows.map(({ item, qty }, idx) => (
                      <tr key={item.id}>
                        <td>{item.legacyId ?? idx + 1}</td>
                        <td className="ag-name-cell">{item.name}</td>
                        <td>{item.unit || "حبة"}</td>
                        <td>{formatAmount(qty)}</td>
                        <td>{formatAmount(qty * item.avgCost)}</td>
                      </tr>
                    ))}
                    {stockRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="coa-empty-cell">
                          لا توجد أصناف بكميات متبقية.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}

            {report === "stock-expiry" ? (
              <div className="account-groups-table-wrap" data-testid="report-stock-expiry">
                <table className="account-groups-table">
                  <thead>
                    <tr>
                      <th>اسم الصنف</th>
                      <th>الكمية</th>
                      <th>تاريخ الانتهاء</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiryRows.map(({ item, qty, days }) => (
                      <tr key={item.id}>
                        <td className="ag-name-cell">{item.name}</td>
                        <td>
                          {formatAmount(qty)} {item.unit || "حبة"}
                        </td>
                        <td>
                          <bdi>{item.expiryDate}</bdi>
                        </td>
                        <td className={days !== null && days < 0 ? "coa-debit-cell" : days !== null && days <= 30 ? "coa-cash-tag" : "coa-credit-cell"}>
                          {days === null ? "—" : days < 0 ? `منتهي منذ ${Math.abs(days)} يوم` : days === 0 ? "ينتهي اليوم" : `متبقي ${days} يوم`}
                        </td>
                      </tr>
                    ))}
                    {expiryRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="coa-empty-cell">
                          لا توجد أصناف بتاريخ انتهاء مسجل في بطاقات الأصناف.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}

            {report === "invoice-profit" ? (
              <div data-testid="report-invoice-profit">
                {profitError ? <p className="cash-empty">{profitError}</p> : null}
                {!profitData && !profitError ? <p className="cash-empty">جاري حساب الأرباح...</p> : null}
                {profitData ? (
                  <>
                    <div className="account-groups-table-wrap">
                      <table className="account-groups-table">
                        <thead>
                          <tr>
                            <th>اسم الصنف</th>
                            <th>كمية البيع</th>
                            <th>إجمالي البيع</th>
                            <th>الربح</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profitRows.map((r) => (
                            <tr key={r.id}>
                              <td className="ag-name-cell">{r.name}</td>
                              <td>{formatAmount(r.sellQty)}</td>
                              <td>{formatAmount(r.sellTotal)}</td>
                              <td className={r.profit < 0 ? "coa-debit-cell" : "coa-credit-cell"}>
                                {formatSignedSmartBalance(r.profit)}
                              </td>
                            </tr>
                          ))}
                          {profitRows.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="coa-empty-cell">
                                لا توجد مبيعات أصناف في النطاق المحدد.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    <div className="trial-balance-rows">
                      {row("إجمالي المبيعات", formatAmount(profitData.totals.totalSales), "pos")}
                      {row(
                        "إجمالي الأرباح",
                        formatSignedSmartBalance(profitData.totals.totalProfit),
                        profitData.totals.totalProfit < 0 ? "neg" : "pos",
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {report === "services" ? (
              <div data-testid="report-services">
                <div className="account-groups-table-wrap">
                  <table className="account-groups-table">
                    <thead>
                      <tr>
                        <th>الرقم</th>
                        <th>التاريخ</th>
                        <th>الحساب</th>
                        <th>النوع</th>
                        <th>المبلغ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviceRows.map((e) => (
                        <tr key={e.id}>
                          <td>{e.entryNumber}</td>
                          <td>
                            <bdi>{e.entryDate}</bdi>
                          </td>
                          <td className="ag-name-cell">{e.accountName}</td>
                          <td>{e.typeLabel}</td>
                          <td className={e.direction === "debit" ? "coa-credit-cell" : "coa-debit-cell"}>
                            {formatAmount(e.amount)} {e.currency}
                          </td>
                        </tr>
                      ))}
                      {serviceRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="coa-empty-cell">
                            لا توجد فواتير خدمات (فواتير حرة بدون أصناف).
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <div className="trial-balance-rows">
                  {row("إيرادات الخدمات (مبيعات)", formatAmount(serviceTotals.sales), "pos")}
                  {row("مصروفات الخدمات (مشتريات)", formatAmount(serviceTotals.purchases), "neg")}
                  {row(
                    "صافي الخدمات",
                    formatSignedSmartBalance(serviceTotals.sales - serviceTotals.purchases),
                    serviceTotals.sales - serviceTotals.purchases < 0 ? "neg" : "pos",
                  )}
                </div>
              </div>
            ) : null}

            {report === "tax" ? (
              <div data-testid="report-tax">
                <div className="smart-section-band">ملخص ضريبة القيمة المضافة</div>
                <div className="trial-balance-rows">
                  {row("ضريبة المبيعات (مخرجات)", formatAmount(tax.output), "pos")}
                  {row("ضريبة المشتريات (مدخلات)", formatAmount(tax.input), "neg")}
                  {row(
                    tax.net >= 0 ? "الضريبة المستحقة للسداد" : "ضريبة مستردة",
                    formatAmount(Math.abs(tax.net)),
                    tax.net >= 0 ? "neg" : "pos",
                  )}
                  {row("عدد المستندات الخاضعة للضريبة", String(tax.taxedDocs))}
                </div>
                {tax.taxedDocs === 0 ? (
                  <p className="cash-empty">لا توجد مستندات بضريبة مسجلة في هذه العملة حتى الآن.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <footer className="account-groups-footer">
          <span>{report ? REPORT_TITLES[report] : "اختر تقريرًا"}</span>
          <button type="button" className="ag-btn close" onClick={onClose}>
            إغلاق
          </button>
        </footer>
      </section>
    </div>
  );
}
