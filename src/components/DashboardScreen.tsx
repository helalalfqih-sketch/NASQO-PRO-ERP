import { useMemo, useState } from "react";
import {
  ActivityLogIcon,
  ArrowLeftIcon,
  BackpackIcon,
  CheckCircledIcon,
  ExclamationTriangleIcon,
  FilePlusIcon,
  FileTextIcon,
  PlusIcon,
  ReaderIcon,
} from "@radix-ui/react-icons";
import { MobileScroll } from "../mobile";
import { computeDashboardSummary, formatAmount } from "../accounting";
import type {
  AccountRecord,
  CurrencyCode,
  InventoryItemRecord,
  LedgerEntryRecord,
  WarehouseRecord,
} from "../types";

export type DashboardPeriod = "all" | "month" | "week";

export interface DashboardProps {
  companyName: string;
  defaultCurrency: CurrencyCode;
  accounts: readonly AccountRecord[];
  ledger: readonly LedgerEntryRecord[];
  warehouses: readonly WarehouseRecord[];
  inventory: readonly InventoryItemRecord[];
  loading?: boolean;
  onOpenSales: () => void;
  onCreateInvoice: () => void;
  onPreviewInvoice: (entryId: string) => void;
  onAddInventoryItem: () => void;
  onOpenInventoryReport: () => void;
  onOpenDailyJournal: () => void;
}

const PERIOD_OPTIONS: readonly { id: DashboardPeriod; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "month", label: "30 يوم" },
  { id: "week", label: "7 أيام" },
];

const THRESHOLD_OPTIONS = [15, 25, 50] as const;

export function Dashboard({
  companyName,
  defaultCurrency,
  accounts,
  ledger,
  warehouses,
  inventory,
  loading = false,
  onOpenSales,
  onCreateInvoice,
  onPreviewInvoice,
  onAddInventoryItem,
  onOpenInventoryReport,
  onOpenDailyJournal,
}: DashboardProps) {
  const [period, setPeriod] = useState<DashboardPeriod>("all");
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(25);

  const summary = useMemo(
    () =>
      computeDashboardSummary(accounts, ledger, warehouses, inventory, {
        period,
        lowStockThreshold,
        recentInvoicesLimit: 6,
      }),
    [accounts, inventory, ledger, lowStockThreshold, period, warehouses],
  );

  const criticalCount = useMemo(
    () => summary.lowStockItems.filter((item) => item.severity === "critical").length,
    [summary.lowStockItems],
  );

  const periodSubtitle =
    period === "all"
      ? "جميع الفترات المسجلة"
      : period === "month"
        ? "خلال آخر 30 يومًا"
        : "خلال آخر 7 أيام";

  return (
    <MobileScroll className="app-screen exec-dashboard-scroll">
      <main className="exec-dashboard-page" data-testid="analytics-dashboard-screen">
        <header className="exec-toolbar">
          <div className="exec-toolbar-copy">
            <h1>{companyName || "نسقو برو"}</h1>
            <p>ملخص المبيعات والفواتير والمخزون · {periodSubtitle}</p>
          </div>
          <div className="exec-segmented" role="group" aria-label="تصفية الفترة الزمنية">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={period === option.id ? "active" : ""}
                aria-pressed={period === option.id}
                onClick={() => setPeriod(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </header>

        <section className="exec-kpi-grid" aria-label="ملخص المؤشرات الرئيسية">
          <button
            type="button"
            className="exec-kpi-card"
            onClick={onOpenSales}
            data-testid="kpi-total-sales"
          >
            <div className="exec-kpi-top">
              <span className="exec-kpi-label">إجمالي المبيعات</span>
              <span className="exec-kpi-icon sales" aria-hidden="true">
                <ActivityLogIcon />
              </span>
            </div>
            <strong className="exec-kpi-value">
              {loading ? "..." : `${formatAmount(summary.totalSales)} ${defaultCurrency}`}
            </strong>
            <span className="exec-kpi-meta">
              {summary.salesInvoiceCount} فاتورة مبيعات · {summary.salesAccountCount} حساب مبيعات
            </span>
          </button>

          <button
            type="button"
            className="exec-kpi-card"
            onClick={onOpenDailyJournal}
            data-testid="kpi-recent-invoices"
          >
            <div className="exec-kpi-top">
              <span className="exec-kpi-label">الفواتير المسجلة</span>
              <span className="exec-kpi-icon invoices" aria-hidden="true">
                <FileTextIcon />
              </span>
            </div>
            <strong className="exec-kpi-value">
              {loading ? "..." : `${summary.totalInvoicesCount} فاتورة`}
            </strong>
            <span className="exec-kpi-meta">
              إجمالي القيمة: {formatAmount(summary.totalInvoicesVolume)} {defaultCurrency}
            </span>
          </button>

          <button
            type="button"
            className="exec-kpi-card"
            onClick={onOpenInventoryReport}
            data-testid="kpi-low-stock"
          >
            <div className="exec-kpi-top">
              <span className="exec-kpi-label">تنبيهات المخزون</span>
              <span
                className={`exec-kpi-icon ${summary.lowStockItems.length > 0 ? "alerts" : "healthy"}`}
                aria-hidden="true"
              >
                {summary.lowStockItems.length > 0 ? <ExclamationTriangleIcon /> : <CheckCircledIcon />}
              </span>
            </div>
            <strong
              className={`exec-kpi-value ${
                criticalCount > 0 ? "critical" : summary.lowStockItems.length > 0 ? "warning" : "healthy"
              }`}
            >
              {loading ? "..." : `${summary.lowStockItems.length} أصناف`}
            </strong>
            <span className="exec-kpi-meta">
              من أصل {summary.totalInventoryItems} صنف ·{" "}
              {criticalCount > 0
                ? `${criticalCount} نفاد وشيك`
                : summary.lowStockItems.length > 0
                  ? `أقل من أو يساوي ${lowStockThreshold}`
                  : "المخزون ضمن الحد الآمن"}
            </span>
          </button>
        </section>

        <div className="exec-panels-grid">
          <section className="exec-panel" aria-labelledby="recent-invoices-heading">
            <div className="exec-panel-head">
              <div>
                <h2 id="recent-invoices-heading">أحدث الفواتير</h2>
                <p>عرض آخر {summary.recentInvoices.length} مستندات فواتير ومردودات</p>
              </div>
              <div className="exec-panel-actions">
                <button
                  type="button"
                  className="exec-action-primary"
                  onClick={onCreateInvoice}
                  data-testid="dashboard-create-invoice-btn"
                >
                  <FilePlusIcon />
                  <span>فاتورة جديدة</span>
                </button>
                <button type="button" className="exec-action-link" onClick={onOpenDailyJournal}>
                  <span>الكل</span>
                  <ArrowLeftIcon />
                </button>
              </div>
            </div>

            {loading ? (
              <div className="exec-empty">جاري مزامنة الفواتير من السحابة...</div>
            ) : summary.recentInvoices.length === 0 ? (
              <div className="exec-empty">
                <p>لا توجد فواتير مسجلة ضمن الفترة المحددة.</p>
                <button type="button" className="exec-action-primary" onClick={onCreateInvoice}>
                  <PlusIcon />
                  <span>إصدار أول فاتورة</span>
                </button>
              </div>
            ) : (
              <ul className="exec-list" data-testid="recent-invoices-list">
                {summary.recentInvoices.map((entry) => {
                  const paymentLabel =
                    entry.payment === "cash" ? "نقدي" : entry.payment === "credit" ? "آجل" : "رصيد";
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="exec-row"
                        onClick={() => onPreviewInvoice(entry.id)}
                      >
                        <div className="exec-row-main">
                          <strong>{entry.accountName}</strong>
                          <span className="exec-row-meta">
                            #{entry.entryNumber} · {entry.typeLabel} · {paymentLabel} · {entry.entryDate}
                          </span>
                          {entry.details ? (
                            <span className="exec-row-detail">{entry.details.split("\n")[0]}</span>
                          ) : null}
                        </div>
                        <div className="exec-row-side">
                          <strong className={`exec-amount ${entry.kind === "return" ? "debit" : ""}`}>
                            {formatAmount(entry.amount)} {entry.currency}
                          </strong>
                          <span className="exec-row-link">
                            معاينة <ArrowLeftIcon />
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="exec-panel" aria-labelledby="low-stock-heading">
            <div className="exec-panel-head">
              <div>
                <h2 id="low-stock-heading">تنبيهات انخفاض المخزون</h2>
                <p>الأصناف التي وصلت الكمية فيها إلى {lowStockThreshold} فأقل</p>
              </div>
              <div className="exec-panel-actions">
                <div className="exec-threshold-group" role="group" aria-label="حد تنبيه المخزون">
                  {THRESHOLD_OPTIONS.map((threshold) => (
                    <button
                      key={threshold}
                      type="button"
                      className={lowStockThreshold === threshold ? "active" : ""}
                      aria-pressed={lowStockThreshold === threshold}
                      onClick={() => setLowStockThreshold(threshold)}
                    >
                      ≤ {threshold}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="exec-action-secondary"
                  onClick={onAddInventoryItem}
                  aria-label="إضافة صنف للمخزن"
                >
                  <PlusIcon />
                  <span>صنف</span>
                </button>
              </div>
            </div>

            {loading ? (
              <div className="exec-empty">جاري فحص أرصدة المخازن...</div>
            ) : summary.lowStockItems.length === 0 ? (
              <div className="exec-empty">
                <p>جميع الأصناف المسجلة أعلى من حد التنبيه ({lowStockThreshold}).</p>
                <button type="button" className="exec-action-link" onClick={onOpenInventoryReport}>
                  <ReaderIcon />
                  <span>عرض تقرير المخزون</span>
                </button>
              </div>
            ) : (
              <ul className="exec-list" data-testid="low-stock-list">
                {summary.lowStockItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="exec-row"
                      onClick={onOpenInventoryReport}
                    >
                      <div className="exec-row-main">
                        <strong>{item.name}</strong>
                        <span className="exec-row-meta">
                          {item.warehouseName} · {item.unit} · تكلفة {formatAmount(item.avgCost)}
                        </span>
                      </div>
                      <div className="exec-row-side">
                        <strong className="exec-qty">
                          {formatAmount(item.quantity)} {item.unit}
                        </strong>
                        <span className={`exec-severity ${item.severity}`}>
                          {item.severity === "critical" ? "نفاد وشيك" : "مخزون منخفض"}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <footer className="exec-panel-foot">
              <button type="button" className="exec-action-link" onClick={onOpenInventoryReport}>
                <BackpackIcon />
                <span>فتح تقرير حركة المخزون الكامل</span>
                <ArrowLeftIcon />
              </button>
            </footer>
          </section>
        </div>
      </main>
    </MobileScroll>
  );
}

export const DashboardScreen = Dashboard;
export default Dashboard;
