import { useEffect, useMemo, useState } from "react";
import { NasqoBrandLoader } from "./NasqoBrandLoader";
import { UnifiedSearchFilterBar } from "./UnifiedSearchFilterBar";
import { DateRangeFields } from "./DateRangeFields";
import { formatAmount, matchesArabicSearch, normalizeArabicSearch } from "../accounting";
import { fetchInventoryMovementsReport, type InventoryMovementItemRow } from "../firebase";
import type { InventoryItemRecord, WarehouseRecord } from "../types";
import {
  buildDateSearchTokens,
  formatDateRangeLabel,
  formatDisplayDate,
} from "../utils/dateUtils";
import {
  countActiveFilters,
  createInitialSearchState,
  onSearchBlur,
  onSearchClear,
  onSearchExit,
  onSearchFocus,
  onSearchQueryChange,
  onTogglePanel,
} from "../utils/searchFocusState";
import {
  buildItemMovementsLedger,
  filterItemMovements,
  formatExpiryStatus,
  summarizeItemMovements,
  type CurrencyTotalBucket,
  type ItemMovementFilter,
} from "../utils/itemMovementSummary";

type MovementReport = Awaited<ReturnType<typeof fetchInventoryMovementsReport>>;

export interface SelectedStockItemSeed {
  id: string;
  code: number | null;
  name: string;
  sku: string;
  unit: string;
  qty: number;
  unitCost: number;
  value: number;
  currencyCode: string;
  expiryDate: string;
}

interface StockItemMovementDetailProps {
  uid: string;
  item: SelectedStockItemSeed;
  catalogMeta?: InventoryItemRecord;
  warehouses: readonly WarehouseRecord[];
  initialWarehouseId: string;
  initialFromDate?: string;
  initialToDate?: string;
}

const FILTER_OPTIONS: ReadonlyArray<{ id: ItemMovementFilter; label: string }> = [
  { id: "all", label: "الكل" },
  { id: "purchases", label: "مشتريات وتوريد" },
  { id: "sales", label: "مبيعات" },
  { id: "transfers", label: "تحويلات" },
  { id: "returns", label: "مرتجعات" },
];

function formatCurrencyBuckets(buckets: readonly CurrencyTotalBucket[]): string {
  if (buckets.length === 0) return "—";
  return buckets.map((b) => `${formatAmount(b.amount)} ${b.currency}`).join(" • ");
}

export function StockItemMovementDetail({
  uid,
  item,
  catalogMeta,
  warehouses,
  initialWarehouseId,
  initialFromDate = "",
  initialToDate = "",
}: StockItemMovementDetailProps) {
  const [scopeWarehouseId, setScopeWarehouseId] = useState(initialWarehouseId);
  const [fromDate, setFromDate] = useState(initialFromDate);
  const [toDate, setToDate] = useState(initialToDate);
  const [searchState, setSearchState] = useState(() => createInitialSearchState());
  const [activeFilter, setActiveFilter] = useState<ItemMovementFilter>("all");
  const [visibleCount, setVisibleCount] = useState(40);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [reportData, setReportData] = useState<MovementReport | null>(null);

  const searchQuery = searchState.query;

  useEffect(() => {
    setScopeWarehouseId(initialWarehouseId);
    setFromDate(initialFromDate);
    setToDate(initialToDate);
    setSearchState(onSearchExit());
    setActiveFilter("all");
    setVisibleCount(40);
  }, [item.id, initialWarehouseId, initialFromDate, initialToDate]);

  useEffect(() => {
    setVisibleCount(40);
  }, [activeFilter, scopeWarehouseId, fromDate, toDate, searchQuery]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void fetchInventoryMovementsReport(uid, {
      itemId: item.id,
      warehouseId: scopeWarehouseId || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    })
      .then((res) => {
        if (active) setReportData(res);
      })
      .catch(() => {
        if (active) {
          setReportData(null);
          setError("تعذر تحميل بيانات وحركة الصنف من قاعدة البيانات.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [uid, item.id, scopeWarehouseId, fromDate, toDate, reloadTick]);

  const liveItemRow: InventoryMovementItemRow | undefined = useMemo(
    () => reportData?.itemRows?.find((r) => r.id === item.id),
    [reportData, item.id],
  );

  const unit = liveItemRow?.unit || catalogMeta?.unit || item.unit || "حبة";
  const currency =
    liveItemRow?.currencyCode || catalogMeta?.currencyCode || item.currencyCode || "ريال";
  const availableQty = liveItemRow ? Number(liveItemRow.availableQty ?? 0) : item.qty;
  const unitCost = liveItemRow
    ? Number(liveItemRow.unitCost ?? liveItemRow.avgCost ?? 0)
    : item.unitCost;
  const remainingValue = liveItemRow ? Number(liveItemRow.remainingValue ?? 0) : item.value;
  const sellingPrice = liveItemRow?.sellingPrice ?? catalogMeta?.sellingPrice;
  const sku = liveItemRow?.sku || catalogMeta?.sku || item.sku || "";
  const expiryDate = liveItemRow?.expiryDate || catalogMeta?.expiryDate || item.expiryDate || "";
  const expiryInfo = useMemo(() => formatExpiryStatus(expiryDate), [expiryDate]);

  const effectiveWarehouses = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const w of warehouses) {
      map.set(w.id, { id: w.id, name: w.name });
    }
    for (const w of reportData?.warehouses ?? []) {
      if (!map.has(w.id)) {
        map.set(w.id, { id: w.id, name: w.name });
      }
    }
    return [...map.values()];
  }, [warehouses, reportData?.warehouses]);

  const defaultWarehouseName = useMemo(() => {
    const whId = liveItemRow?.warehouseId || catalogMeta?.warehouseId || "";
    if (!whId) return "غير محدد";
    return effectiveWarehouses.find((w) => w.id === whId)?.name || whId;
  }, [liveItemRow?.warehouseId, catalogMeta?.warehouseId, effectiveWarehouses]);

  const altUnitsSummary = useMemo(() => {
    const parts: string[] = [];
    const u2 = liveItemRow?.unit2 || catalogMeta?.unit2;
    const c2 = liveItemRow?.count2 ?? catalogMeta?.count2;
    if (u2 && c2 && c2 > 0) parts.push(`${u2} (${formatAmount(c2)} ${unit})`);
    if (catalogMeta?.unit3 && catalogMeta?.count3 && catalogMeta.count3 > 0) {
      parts.push(`${catalogMeta.unit3} (${formatAmount(catalogMeta.count3)} ${u2 || unit})`);
    }
    return parts.join(" • ");
  }, [liveItemRow?.unit2, liveItemRow?.count2, catalogMeta, unit]);

  const itemWarehouseStocks = useMemo(
    () => (reportData?.warehouseStocks ?? []).filter((ws) => ws.inventoryItemId === item.id),
    [reportData, item.id],
  );

  const rawMovements = useMemo(() => reportData?.movements ?? [], [reportData]);

  const summary = useMemo(
    () => summarizeItemMovements(rawMovements, currency),
    [rawMovements, currency],
  );

  const enrichedMovements = useMemo(
    () => buildItemMovementsLedger(rawMovements, availableQty),
    [rawMovements, availableQty],
  );

  const typeFilteredMovements = useMemo(
    () => filterItemMovements(enrichedMovements, activeFilter),
    [enrichedMovements, activeFilter],
  );

  const filteredMovements = useMemo(() => {
    const q = normalizeArabicSearch(searchQuery);
    if (!q) return typeFilteredMovements;
    return typeFilteredMovements.filter((mv) =>
      matchesArabicSearch(
        [
          mv.badgeLabel,
          mv.label,
          mv.accountName,
          mv.warehouseName,
          mv.entryNumber ? String(mv.entryNumber) : "",
          mv.documentNumber ?? "",
          mv.details ?? "",
          mv.currency ?? "",
          mv.date,
          buildDateSearchTokens(mv.date),
        ].join(" "),
        q,
      ),
    );
  }, [searchQuery, typeFilteredMovements]);

  const filterCounts: Record<ItemMovementFilter, number> = useMemo(
    () => ({
      all: summary.totalCount,
      purchases: summary.purchasesCount,
      sales: summary.salesCount,
      transfers: summary.transfersCount + summary.adjustmentsCount,
      returns: summary.purchaseReturnsCount + summary.saleReturnsCount,
    }),
    [summary],
  );

  const activeFiltersCount = countActiveFilters(
    { warehouse: scopeWarehouseId, fromDate, toDate },
    { warehouse: "", fromDate: "", toDate: "" },
  );
  const dateRangeLabel = formatDateRangeLabel(fromDate, toDate);
  const scopeWarehouseName = scopeWarehouseId
    ? effectiveWarehouses.find((w) => w.id === scopeWarehouseId)?.name || "مخزن محدد"
    : "جميع المخازن";

  return (
    <div className="stock-item-detail" data-testid="stock-item-detail">
      {/* Item Identity & Core Profile Card */}
      <section className="stock-item-hero" aria-label="بيانات الصنف الأساسية">
        <div className="stock-item-hero-head">
          <div className="stock-item-hero-title-wrap">
            <h3 className="stock-item-hero-name">{item.name}</h3>
            <div className="stock-item-hero-meta">
              {item.code !== null ? (
                <span className="stock-item-meta-tag">رقم #{item.code}</span>
              ) : null}
              {sku ? <span className="stock-item-meta-tag">رمز: {sku}</span> : null}
              <span className="stock-item-meta-tag">الوحدة: {unit}</span>
              {catalogMeta?.isActive === false ? (
                <span className="stock-item-meta-tag warn">غير نشط</span>
              ) : null}
              {liveItemRow?.quantityUnverified ? (
                <span className="stock-item-meta-tag warn">الرصيد الافتتاحي غير محقق</span>
              ) : null}
            </div>
          </div>
          <div
            className={`stock-item-hero-qty ${availableQty < 0 ? "neg" : availableQty > 0 ? "pos" : "zero"}`}
          >
            <span className="stock-item-hero-qty-label">الرصيد المتاح</span>
            <strong>
              <bdi>
                {formatAmount(availableQty)} {unit}
              </bdi>
            </strong>
          </div>
        </div>

        <div className="stock-item-specs-grid">
          <div className="stock-item-spec">
            <span>قيمة المتبقي</span>
            <strong>
              <bdi>
                {formatAmount(remainingValue)} {currency}
              </bdi>
            </strong>
          </div>
          <div className="stock-item-spec">
            <span>متوسط التكلفة</span>
            <strong>
              <bdi>
                {formatAmount(unitCost)} {currency}
              </bdi>
            </strong>
          </div>
          <div className="stock-item-spec">
            <span>سعر البيع</span>
            <strong>
              <bdi>
                {sellingPrice !== undefined && sellingPrice > 0
                  ? `${formatAmount(sellingPrice)} ${currency}`
                  : "غير محدد"}
              </bdi>
            </strong>
          </div>
          <div className="stock-item-spec">
            <span>المخزن الافتراضي</span>
            <strong>{defaultWarehouseName}</strong>
          </div>
          {expiryInfo.displayDate ? (
            <div className="stock-item-spec stock-item-spec-wide" data-testid="stock-item-expiry-spec">
              <span>تاريخ الانتهاء والصلاحية</span>
              <strong className={`stock-expiry-val ${expiryInfo.tone}`}>
                <bdi>{expiryInfo.displayDate}</bdi>
                {expiryInfo.statusLabel && expiryInfo.statusLabel !== expiryInfo.displayDate ? (
                  <> — {expiryInfo.statusLabel}</>
                ) : null}
              </strong>
            </div>
          ) : null}
          {altUnitsSummary ? (
            <div className="stock-item-spec stock-item-spec-wide">
              <span>الوحدات البديلة</span>
              <strong>{altUnitsSummary}</strong>
            </div>
          ) : null}
          {catalogMeta?.minThreshold !== undefined && catalogMeta.minThreshold > 0 ? (
            <div className="stock-item-spec">
              <span>الحد الأدنى للطلب</span>
              <strong>
                <bdi>
                  {formatAmount(catalogMeta.minThreshold)} {unit}
                </bdi>
              </strong>
            </div>
          ) : null}
          {liveItemRow?.openingQty !== undefined && Math.abs(liveItemRow.openingQty) > 0.0001 ? (
            <div className="stock-item-spec">
              <span>الرصيد الافتتاحي</span>
              <strong>
                <bdi>
                  {formatAmount(liveItemRow.openingQty)} {unit}
                </bdi>
              </strong>
            </div>
          ) : null}
        </div>
      </section>

      {/* Unified Search + Collapsible Warehouse & Date Range Filter */}
      <UnifiedSearchFilterBar
        testId="stock-item-search-bar"
        inputTestId="stock-item-search-input"
        ariaLabel="بحث في حركات الصنف"
        placeholder="ابحث بالتاريخ أو الفاتورة أو الحساب أو البيان..."
        query={searchQuery}
        matchedCount={filteredMovements.length}
        totalCount={typeFilteredMovements.length}
        unitLabel="حركة"
        isFocused={searchState.isFocused}
        onFocus={() => setSearchState((prev) => onSearchFocus(prev))}
        onBlur={() => setSearchState((prev) => onSearchBlur(prev))}
        onQueryChange={(next) => setSearchState((prev) => onSearchQueryChange(prev, next))}
        onClear={() => setSearchState((prev) => onSearchClear(prev))}
        onExitSearch={() => setSearchState(onSearchExit())}
        panelToggles={[
          {
            id: "filters",
            label: "المخزن والتاريخ",
            activeCount: activeFiltersCount,
            expanded: searchState.activePanel === "filters",
            testId: "stock-item-toggle-filters",
            onClick: () => setSearchState((prev) => onTogglePanel(prev, "filters")),
          },
        ]}
        compactSummary={
          <div className="nasqo-summary-inline" data-testid="stock-item-scope-summary">
            <span>{scopeWarehouseName}</span>
            {dateRangeLabel ? (
              <span>
                {" "}
                · <bdi>{dateRangeLabel}</bdi>
              </span>
            ) : null}
            <span>
              {" "}
              · <b><bdi>{filteredMovements.length}</bdi></b> حركة
            </span>
          </div>
        }
        expandedPanel={
          searchState.activePanel === "filters" ? (
            <div className="reports-hub-filters nasqo-modal-filter-grid" data-testid="stock-item-filters-panel">
              <label>
                <span>نطاق العرض حسب المخزن</span>
                <select
                  id="stock-item-warehouse-scope"
                  aria-label="تصفية حركة الصنف حسب المخزن"
                  value={scopeWarehouseId}
                  onChange={(e) => setScopeWarehouseId(e.target.value)}
                >
                  <option value="">جميع المخازن</option>
                  {effectiveWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <DateRangeFields
                fromDate={fromDate}
                toDate={toDate}
                onFromDateChange={setFromDate}
                onToDateChange={setToDate}
                fromTestId="stock-item-from-date"
                toTestId="stock-item-to-date"
                clearTestId="stock-item-clear-dates"
              />
            </div>
          ) : null
        }
      />

      {loading ? (
        <NasqoBrandLoader size="sm" label="جاري تحميل حركات الصنف التفصيلية..." />
      ) : error ? (
        <div className="stock-item-error-box">
          <p className="cash-empty">{error}</p>
          <button
            type="button"
            className="load-more-list-btn"
            onClick={() => setReloadTick((t) => t + 1)}
          >
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <>
          {/* Movement KPI Summary */}
          <section className="stock-item-kpi-grid" aria-label="ملخص حركات الصنف">
            <div className="stock-item-kpi in">
              <div className="stock-item-kpi-label">المشتريات والتوريد</div>
              <div className="stock-item-kpi-qty">
                <bdi dir="ltr">+{formatAmount(summary.purchasesQty)}</bdi> {unit}
              </div>
              <div className="stock-item-kpi-sub">
                <span>{summary.purchasesCount} عملية</span>
                {summary.purchasesByCurrency.length > 0 ? (
                  <bdi>{formatCurrencyBuckets(summary.purchasesByCurrency)}</bdi>
                ) : null}
              </div>
            </div>

            <div className="stock-item-kpi out">
              <div className="stock-item-kpi-label">المبيعات</div>
              <div className="stock-item-kpi-qty">
                <bdi dir="ltr">-{formatAmount(summary.salesQty)}</bdi> {unit}
              </div>
              <div className="stock-item-kpi-sub">
                <span>{summary.salesCount} عملية</span>
                {summary.salesByCurrency.length > 0 ? (
                  <bdi>{formatCurrencyBuckets(summary.salesByCurrency)}</bdi>
                ) : null}
              </div>
            </div>

            <div className="stock-item-kpi transfer">
              <div className="stock-item-kpi-label">التحويلات والتسويات</div>
              <div className="stock-item-kpi-qty">
                <bdi dir="ltr">{formatAmount(summary.transferTotalMovedQty)}</bdi> {unit}
              </div>
              <div className="stock-item-kpi-sub">
                <span>{summary.transfersCount + summary.adjustmentsCount} عملية</span>
                {scopeWarehouseId ? (
                  <span>
                    وارد <bdi dir="ltr">+{formatAmount(summary.transferInQty)}</bdi> / صادر{" "}
                    <bdi dir="ltr">-{formatAmount(summary.transferOutQty)}</bdi>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="stock-item-kpi returns">
              <div className="stock-item-kpi-label">المرتجعات</div>
              <div className="stock-item-kpi-qty">
                <bdi dir="ltr">+{formatAmount(summary.saleReturnsQty)}</bdi> /{" "}
                <bdi dir="ltr">-{formatAmount(summary.purchaseReturnsQty)}</bdi>
              </div>
              <div className="stock-item-kpi-sub">
                <span>
                  بيع {summary.saleReturnsCount} • شراء {summary.purchaseReturnsCount}
                </span>
              </div>
            </div>
          </section>

          {/* Per-Warehouse Breakdown */}
          {itemWarehouseStocks.length > 0 ? (
            <section className="stock-item-section" aria-label="توزيع الرصيد حسب المخازن">
              <div className="smart-section-band">توزيع الحركة حسب المخازن</div>
              <div className="account-groups-table-wrap">
                <table className="account-groups-table stock-item-wh-table">
                  <thead>
                    <tr>
                      <th>المخزن</th>
                      <th>مشتريات</th>
                      <th>مبيعات</th>
                      <th>تحويل (+ / -)</th>
                      <th>صافي الحركة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemWarehouseStocks.map((ws) => (
                      <tr key={ws.warehouseId}>
                        <td className="ag-name-cell">{ws.warehouseName}</td>
                        <td className="coa-credit-cell">
                          <bdi>{formatAmount(ws.purchasesQty)}</bdi>
                        </td>
                        <td className="coa-debit-cell">
                          <bdi>{formatAmount(ws.salesQty)}</bdi>
                        </td>
                        <td>
                          <bdi>
                            +{formatAmount(ws.transferInQty)} / -{formatAmount(ws.transferOutQty)}
                          </bdi>
                        </td>
                        <td className={ws.netComputedQty < 0 ? "coa-debit-cell" : "coa-credit-cell"}>
                          <bdi>{formatAmount(ws.netComputedQty)}</bdi>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Detailed Chronological Movements Ledger */}
          <section className="stock-item-section" aria-label="سجل حركات الصنف التفصيلي">
            <div className="smart-section-band">
              سجل الحركات التفصيلي ({filteredMovements.length})
            </div>

            <div className="stock-item-filter-tabs" role="tablist" aria-label="تصفية نوع الحركة">
              {FILTER_OPTIONS.map((tab) => {
                const count = filterCounts[tab.id];
                const isActive = activeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`stock-item-filter-tab ${isActive ? "active" : ""}`}
                    onClick={() => setActiveFilter(tab.id)}
                  >
                    <span>{tab.label}</span>
                    <span className="stock-item-filter-count">{count}</span>
                  </button>
                );
              })}
            </div>

            {filteredMovements.length === 0 ? (
              <p className="cash-empty" data-testid="stock-item-moves-empty">
                {rawMovements.length === 0
                  ? "لا توجد فواتير مشتريات أو مبيعات أو تحويلات مخزنية مسجلة لهذا الصنف في هذا النطاق."
                  : "لا توجد حركات تطابق البحث أو نوع التصفية المحدد."}
              </p>
            ) : (
              <div className="stock-item-moves-list" data-testid="stock-item-moves-list">
                {filteredMovements.slice(0, visibleCount).map((mv, idx) => {
                  const signPrefix =
                    mv.effectQty > 0 ? "+" : mv.effectQty < 0 ? "-" : "";
                  const absDisplayQty = formatAmount(Math.abs(mv.quantity));
                  const mvCurrency = mv.currency || currency;
                  return (
                    <article
                      key={`${mv.refId}-${idx}`}
                      className={`stock-move-card tone-${mv.tone}`}
                    >
                      <div className="stock-move-card-top">
                        <div className="stock-move-badges">
                          <span className={`stock-move-badge tone-${mv.tone}`}>
                            {mv.badgeLabel}
                          </span>
                          {mv.entryNumber ? (
                            <span className="stock-move-doc">#{mv.entryNumber}</span>
                          ) : mv.documentNumber ? (
                            <span className="stock-move-doc">مستند {mv.documentNumber}</span>
                          ) : null}
                        </div>
                        <span className="stock-move-date">
                          <bdi>{formatDisplayDate(mv.date)}</bdi>
                        </span>
                      </div>

                      <div className="stock-move-party-row">
                        <strong className="stock-move-party">{mv.accountName || "—"}</strong>
                        <span className="stock-move-wh">{mv.warehouseName || "—"}</span>
                      </div>

                      <div className="stock-move-metrics">
                        <span
                          className={`stock-move-qty ${
                            mv.effectQty > 0 ? "pos" : mv.effectQty < 0 ? "neg" : "neutral"
                          }`}
                        >
                          <bdi dir="ltr">
                            {signPrefix}
                            {absDisplayQty}
                          </bdi>{" "}
                          {mv.unit}
                          {mv.bonus && mv.bonus > 0 ? (
                            <>
                              {" "}
                              (<bdi dir="ltr">+{formatAmount(mv.bonus)}</bdi> بونص)
                            </>
                          ) : null}
                        </span>
                        {mv.price > 0 ? (
                          <span className="stock-move-price">
                            السعر:{" "}
                            <bdi>
                              {formatAmount(mv.price)} {mvCurrency}
                            </bdi>
                          </span>
                        ) : null}
                        {mv.total > 0 ? (
                          <span className="stock-move-total">
                            الإجمالي:{" "}
                            <bdi>
                              {formatAmount(mv.total)} {mvCurrency}
                            </bdi>
                          </span>
                        ) : null}
                        {mv.runningBalance !== null ? (
                          <span className="stock-move-balance">
                            الرصيد:{" "}
                            <bdi>
                              {formatAmount(mv.runningBalance)} {unit}
                            </bdi>
                          </span>
                        ) : null}
                      </div>

                      {mv.details ? <p className="stock-move-notes">{mv.details}</p> : null}
                    </article>
                  );
                })}

                {filteredMovements.length > visibleCount ? (
                  <div className="stock-item-load-more">
                    <button
                      type="button"
                      className="load-more-list-btn"
                      onClick={() => setVisibleCount((v) => v + 50)}
                    >
                      عرض المزيد (المعروض {visibleCount} من {filteredMovements.length})
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
