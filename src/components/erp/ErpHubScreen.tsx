import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  BackpackIcon,
  BarChartIcon,
  CardStackIcon,
  CodeIcon,
  CubeIcon,
  DownloadIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  LayersIcon,
  PersonIcon,
  ReloadIcon,
  RocketIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { computeInventorySummary, formatAmount } from "../../accounting";
import {
  computeIncomeStatement,
  computePayrollTotals,
  computeVatSummary,
  createDefaultErpData,
  type ErpModuleId,
  type ErpWorkspaceData,
} from "../../erp";
import {
  LOCAL_WORKSPACE_UID,
  downloadUnifiedSqliteFile,
  fetchUnifiedJsonExport,
  getUnifiedDbStats,
  resetLocalWorkspaceDatabase,
  syncLocalWorkspaceToIndexedDb,
  type UnifiedDbStats,
} from "../../firebase";
import { MobileScroll, useKeyboard } from "../../mobile";
import type {
  AccountRecord,
  InventoryItemRecord,
  LedgerEntryRecord,
  WarehouseRecord,
  WorkspaceSettings,
} from "../../types";
import { triggerHaptic } from "../../utils/haptics";
import { FlutterExportModal } from "./FlutterExportModal";

function triggerJsonDownload(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ErpHubScreen({
  uid = LOCAL_WORKSPACE_UID,
  workspace,
  companyName,
  currency,
  accounts,
  ledger,
  warehouses,
  inventory,
  erpData,
  onUpdateErpData,
  onOpenModule,
  onOpenInventory,
  onOpenSmartPro,
  onToast,
}: {
  uid?: string;
  workspace?: WorkspaceSettings | null;
  companyName: string;
  currency: string;
  accounts: readonly AccountRecord[];
  ledger: readonly LedgerEntryRecord[];
  warehouses: readonly WarehouseRecord[];
  inventory: readonly InventoryItemRecord[];
  erpData: ErpWorkspaceData;
  onUpdateErpData?: (next: ErpWorkspaceData) => void;
  onOpenModule: (moduleId: ErpModuleId) => void;
  onOpenInventory: () => void;
  onOpenSmartPro: () => void;
  onToast?: (msg: string) => void;
}) {
  const [flutterModalOpen, setFlutterModalOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [dbBusy, setDbBusy] = useState(false);
  const [dbStats, setDbStats] = useState<UnifiedDbStats>({
    engine: "SQLite (node:sqlite WAL)",
    dbName: "data/nasqo.sqlite",
    schemaVersion: 1,
    tablesCount: 29,
    fileSizeBytes: 0,
    accountsCount: accounts.length,
    ledgerCount: ledger.length,
    invoiceLinesCount: 0,
    warehousesCount: warehouses.length,
    inventoryCount: inventory.length,
    archivedCount: 0,
    transfersCount: 0,
    offersCount: 0,
    erpModulesSaved: true,
    lastSyncedAt: null,
  });
  const keyboard = useKeyboard();
  const income = useMemo(() => computeIncomeStatement(accounts, ledger), [accounts, ledger]);
  const invSummary = useMemo(() => computeInventorySummary(inventory), [inventory]);
  const payroll = useMemo(() => computePayrollTotals(erpData.employees), [erpData.employees]);
  const vatConfig = erpData.vatConfig ?? {
    jurisdiction: "none" as const,
    ratePercent: 0,
    basis: "recorded_only" as const,
  };
  const vat = useMemo(
    () =>
      computeVatSummary(accounts, ledger, vatConfig.ratePercent / 100, {
        vatMode: vatConfig.basis,
        jurisdictionCode: vatConfig.jurisdiction,
      }),
    [accounts, ledger, vatConfig.basis, vatConfig.jurisdiction, vatConfig.ratePercent],
  );

  const refreshDbStats = useCallback(async () => {
    try {
      const stats = await getUnifiedDbStats(uid);
      setDbStats(stats);
    } catch {
      // Keep fallback counters
    }
  }, [uid]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshDbStats();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    refreshDbStats,
    accounts.length,
    ledger.length,
    warehouses.length,
    inventory.length,
    erpData,
  ]);

  const handleSyncLocalDb = async () => {
    triggerHaptic("light");
    setDbBusy(true);
    try {
      await syncLocalWorkspaceToIndexedDb(uid);
      await refreshDbStats();
      onToast?.("تم تحديث البيانات بنجاح");
    } finally {
      setDbBusy(false);
    }
  };

  const handleExportLocalDb = async () => {
    triggerHaptic("success");
    setDbBusy(true);
    try {
      const dump = await fetchUnifiedJsonExport(uid);
      triggerJsonDownload("nasqo_unified_sqlite_backup.json", dump);
      onToast?.("تم تصدير النسخة الاحتياطية الكاملة بنجاح");
    } finally {
      setDbBusy(false);
    }
  };

  const handleDownloadSqliteBinary = async () => {
    triggerHaptic("success");
    setDbBusy(true);
    try {
      await downloadUnifiedSqliteFile(uid);
      onToast?.("تم حفظ ملف النسخة الاحتياطية بنجاح");
    } finally {
      setDbBusy(false);
    }
  };

  const handleResetLocalDb = async () => {
    triggerHaptic("warning");
    setDbBusy(true);
    try {
      await resetLocalWorkspaceDatabase(uid);
      const freshErp = createDefaultErpData();
      onUpdateErpData?.(freshErp);
      setConfirmReset(false);
      await refreshDbStats();
      onToast?.("تمت إعادة تهيئة البيانات الأساسية");
    } finally {
      setDbBusy(false);
    }
  };

  const pendingPos = useMemo(
    () => erpData.purchaseOrders.filter((po) => po.status !== "received"),
    [erpData.purchaseOrders],
  );
  const pendingLeaves = useMemo(
    () => erpData.leaveRequests.filter((lv) => lv.status === "pending"),
    [erpData.leaveRequests],
  );
  const openDeals = useMemo(
    () => erpData.deals.filter((d) => d.stage !== "won" && d.stage !== "lost"),
    [erpData.deals],
  );
  const activeProduction = useMemo(
    () => erpData.productionOrders.filter((o) => o.status !== "completed"),
    [erpData.productionOrders],
  );
  const lowStockCount = useMemo(
    () => inventory.filter((item) => item.quantity <= (item.minThreshold ?? 25)).length,
    [inventory],
  );

  const formatArCount = (count: number, singular: string, plural: string) =>
    count === 1 ? `1 ${singular}` : count <= 10 ? `${count} ${plural}` : `${count} ${singular}`;

  const modules: {
    id: ErpModuleId | "inventory";
    title: string;
    subtitle: string;
    stat: string;
    icon: typeof CardStackIcon;
    tone: "blue" | "green" | "orange" | "purple" | "teal" | "slate";
  }[] = [
    {
      id: "erp-finance",
      title: "القوائم المالية والأستاذ العام",
      subtitle: "ميزان المراجعة · الدخل · الميزانية · VAT",
      stat: `${formatAmount(income.netSales)} مبيعات`,
      icon: BarChartIcon,
      tone: "blue",
    },
    {
      id: "erp-crm",
      title: "المبيعات ونقطة البيع",
      subtitle: "نقطة بيع فورية · صفقات · تحويل لفاتورة",
      stat: formatArCount(openDeals.length, "صفقة نشطة", "صفقات نشطة"),
      icon: RocketIcon,
      tone: "green",
    },
    {
      id: "erp-procurement",
      title: "المشتريات وسلسلة التوريد",
      subtitle: "أوامر الشراء · الاستلام المخزني · التكلفة",
      stat: formatArCount(pendingPos.length, "أمر مفتوح", "أوامر مفتوحة"),
      icon: BackpackIcon,
      tone: "orange",
    },
    {
      id: "erp-hr",
      title: "الموارد البشرية والرواتب",
      subtitle: "الموظفون · الحضور والإجازات · ترحيل الرواتب",
      stat: formatArCount(payroll.activeCount, "موظف", "موظفين"),
      icon: PersonIcon,
      tone: "purple",
    },
    {
      id: "erp-manufacturing",
      title: "التصنيع ومراكز التكلفة",
      subtitle: "قوائم المواد · أوامر الإنتاج · الموازنات",
      stat: `${formatArCount(activeProduction.length, "أمر إنتاج", "أوامر إنتاج")} · ${formatArCount(erpData.costCenters.length, "مركز", "مراكز")}`,
      icon: LayersIcon,
      tone: "teal",
    },
    {
      id: "inventory",
      title: "المخازن وحركة الأصناف",
      subtitle: `${formatArCount(warehouses.length, "مستودع", "مستودعات")} · ${formatArCount(invSummary.items.length, "صنف", "أصناف")}`,
      stat: lowStockCount > 0 ? `${formatArCount(lowStockCount, "ناقص", "نواقص")}` : "المخزون مستقر",
      icon: CubeIcon,
      tone: "slate",
    },
  ];

  return (
    <>
      <MobileScroll className="app-screen erp-scroll">
        <main className="erp-page" data-testid="erp-hub-screen">
          <section className="erp-hero-card">
            <div className="erp-hero-top">
              <div>
                <small>مركز الإدارة المتكامل</small>
                <h2>{companyName || "نسقو برو"}</h2>
              </div>
              <span className="erp-hero-badge">نظام مترابط</span>
            </div>
            <p className="erp-hero-sub">
              كل عملية في المبيعات أو المشتريات أو الرواتب أو التصنيع تُحدّث المخزون والحسابات لحظيًا.
            </p>
            <button type="button" className="erp-smartpro-launch" data-testid="open-smartpro-control" onClick={onOpenSmartPro}>
              الإدارة المركزية — إدارة السجلات والصلاحيات
            </button>
          </section>

          <section className="erp-kpi-grid" aria-label="المؤشرات التنفيذية">
            <article className="erp-kpi-card">
              <small>صافي الربح التشغيلي</small>
              <strong className={income.netProfit >= 0 ? "pos" : "neg"}>
                <bdi>
                  {income.netProfit < 0 ? "−" : ""}
                  {formatAmount(Math.abs(income.netProfit))}
                </bdi>
              </strong>
              <span>{currency}</span>
            </article>
            <article className="erp-kpi-card">
              <small>قيمة المخزون الحالية</small>
              <strong>
                <bdi>{formatAmount(invSummary.totalValue)}</bdi>
              </strong>
              <span>{formatArCount(invSummary.items.length, "صنف", "أصناف")}</span>
            </article>
            <article className="erp-kpi-card">
              <small>مسير الرواتب الشهري</small>
              <strong>
                <bdi>{formatAmount(payroll.totalNetPayroll)}</bdi>
              </strong>
              <span>{formatArCount(payroll.activeCount, "موظف نشط", "موظفين نشطين")}</span>
            </article>
            <article className="erp-kpi-card">
              <small>صافي ضريبة القيمة المضافة</small>
              <strong className={vat.netVatPayable >= 0 ? "warn" : "pos"}>
                <bdi>
                  {vat.netVatPayable < 0 ? "−" : ""}
                  {formatAmount(Math.abs(vat.netVatPayable))}
                </bdi>
              </strong>
              <span>
                {vatConfig.jurisdiction === "none"
                  ? "غير مفعّل · 0% مسجلة"
                  : vatConfig.basis === "recorded_only"
                    ? "مسجل بالفواتير"
                    : `${vatConfig.ratePercent}% تقديري`}
              </span>
            </article>
          </section>

          <section className="erp-section">
            <div className="erp-section-head">
              <h3>أقسام النظام</h3>
              <span>{modules.length} أنظمة</span>
            </div>
            <div className="erp-module-grid">
              {modules.map((mod) => (
                <button
                  key={mod.id}
                  type="button"
                  className={`erp-module-card tone-${mod.tone}`}
                  data-testid={`erp-mod-btn-${mod.id}`}
                  onClick={() => {
                    triggerHaptic("light");
                    if (mod.id === "inventory") {
                      onOpenInventory();
                    } else {
                      onOpenModule(mod.id);
                    }
                  }}
                >
                  <div className="erp-module-icon">
                    <mod.icon />
                  </div>
                  <div className="erp-module-body">
                    <strong>{mod.title}</strong>
                    <small>{mod.subtitle}</small>
                    <div className="erp-module-foot">
                      <span>{mod.stat}</span>
                      <ArrowLeftIcon />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="erp-section">
            <div className="erp-section-head">
              <h3>مهام واعتمادات عبر الأقسام</h3>
              <span>متابعة فورية</span>
            </div>
            <div className="erp-action-list">
              {pendingPos.length > 0 ? (
                <button
                  type="button"
                  className="erp-action-row"
                  onClick={() => {
                    triggerHaptic("light");
                    onOpenModule("erp-procurement");
                  }}
                >
                  <span className="erp-action-dot orange" />
                  <div className="erp-action-copy">
                    <strong>{pendingPos.length} أمر شراء بانتظار الاستلام بالمخزن</strong>
                    <small>استلام البضاعة يحدّث متوسط التكلفة ويُرحّل فاتورة المورد</small>
                  </div>
                  <FileTextIcon />
                </button>
              ) : null}

              {pendingLeaves.length > 0 ? (
                <button
                  type="button"
                  className="erp-action-row"
                  onClick={() => {
                    triggerHaptic("light");
                    onOpenModule("erp-hr");
                  }}
                >
                  <span className="erp-action-dot purple" />
                  <div className="erp-action-copy">
                    <strong>{pendingLeaves.length} طلب إجازة بانتظار الاعتماد</strong>
                    <small>مراجعة طلبات الفريق وترحيل مسير الرواتب الشهري</small>
                  </div>
                  <PersonIcon />
                </button>
              ) : null}

              {activeProduction.length > 0 ? (
                <button
                  type="button"
                  className="erp-action-row"
                  onClick={() => {
                    triggerHaptic("light");
                    onOpenModule("erp-manufacturing");
                  }}
                >
                  <span className="erp-action-dot teal" />
                  <div className="erp-action-copy">
                    <strong>{activeProduction.length} أمر تصنيع جاهز للتنفيذ</strong>
                    <small>فحص توفر الخامات وإضافة المنتج التام للمستودع</small>
                  </div>
                  <LayersIcon />
                </button>
              ) : null}

              {lowStockCount > 0 ? (
                <button
                  type="button"
                  className="erp-action-row"
                  onClick={() => {
                    triggerHaptic("light");
                    onOpenInventory();
                  }}
                >
                  <span className="erp-action-dot red" />
                  <div className="erp-action-copy">
                    <strong>تنبيه مخزون: {lowStockCount} أصناف عند الحد الأدنى</strong>
                    <small>يمكنك إنشاء أمر شراء فوري من وحدة المشتريات</small>
                  </div>
                  <ExclamationTriangleIcon />
                </button>
              ) : null}
            </div>
          </section>

          <section className="erp-section" data-testid="local-db-section">
            <div className="erp-section-head">
              <h3>سجلات النظام الموحدة</h3>
              <span>{dbStats.tablesCount} قسم</span>
            </div>
            <div
              style={{
                background: "var(--nasqo-surface)",
                border: "1px solid var(--nasqo-line)",
                borderRadius: "10px",
                padding: "8px",
                display: "grid",
                gap: "6px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: "4px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    padding: "4px",
                    borderRadius: "6px",
                    background: "var(--nasqo-brand-tint)",
                  }}
                >
                  <small style={{ display: "block", fontSize: "9px", color: "var(--nasqo-muted)" }}>
                    الحسابات
                  </small>
                  <strong data-testid="local-db-accounts-count" style={{ fontSize: "13px" }}>
                    {dbStats.accountsCount || accounts.length}
                  </strong>
                </div>
                <div
                  style={{
                    padding: "4px",
                    borderRadius: "6px",
                    background: "var(--nasqo-brand-tint)",
                  }}
                >
                  <small style={{ display: "block", fontSize: "9px", color: "var(--nasqo-muted)" }}>
                    القيود
                  </small>
                  <strong data-testid="local-db-ledger-count" style={{ fontSize: "13px" }}>
                    {dbStats.ledgerCount || ledger.length}
                  </strong>
                </div>
                <div
                  style={{
                    padding: "4px",
                    borderRadius: "6px",
                    background: "var(--nasqo-brand-tint)",
                  }}
                >
                  <small style={{ display: "block", fontSize: "9px", color: "var(--nasqo-muted)" }}>
                    المستودعات
                  </small>
                  <strong style={{ fontSize: "13px" }}>
                    {dbStats.warehousesCount || warehouses.length}
                  </strong>
                </div>
                <div
                  style={{
                    padding: "4px",
                    borderRadius: "6px",
                    background: "var(--nasqo-brand-tint)",
                  }}
                >
                  <small style={{ display: "block", fontSize: "9px", color: "var(--nasqo-muted)" }}>
                    الأصناف
                  </small>
                  <strong style={{ fontSize: "13px" }}>
                    {dbStats.inventoryCount || inventory.length}
                  </strong>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "10px",
                  color: "var(--nasqo-muted)",
                }}
              >
                <span>
                  الأقسام: {dbStats.erpModulesSaved ? "محفوظة" : "قيد الحفظ"} • البنود: {dbStats.invoiceLinesCount.toLocaleString("en-US")}
                </span>
                <span>{dbStats.tablesCount} قسم في سجل واحد</span>
              </div>

              <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="erp-secondary-btn"
                  disabled={dbBusy}
                  data-testid="local-db-sync-btn"
                  onClick={() => void handleSyncLocalDb()}
                  style={{
                    flex: 1,
                    minHeight: "30px",
                    fontSize: "11px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    padding: "4px 6px",
                  }}
                >
                  <ReloadIcon />
                  <span>تحديث</span>
                </button>
                <button
                  type="button"
                  className="erp-secondary-btn"
                  disabled={dbBusy}
                  data-testid="local-db-sqlite-download-btn"
                  onClick={() => void handleDownloadSqliteBinary()}
                  style={{
                    flex: 1,
                    minHeight: "30px",
                    fontSize: "11px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    padding: "4px 6px",
                  }}
                >
                  <DownloadIcon />
                  <span>حفظ نسخة كاملة</span>
                </button>
                <button
                  type="button"
                  className="erp-secondary-btn"
                  disabled={dbBusy}
                  data-testid="local-db-export-btn"
                  onClick={() => void handleExportLocalDb()}
                  style={{
                    flex: 1,
                    minHeight: "30px",
                    fontSize: "11px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    padding: "4px 6px",
                  }}
                >
                  <DownloadIcon />
                  <span>تصدير نسخة</span>
                </button>
                {uid === LOCAL_WORKSPACE_UID ? (
                  confirmReset ? (
                    <button
                      type="button"
                      disabled={dbBusy}
                      data-testid="local-db-confirm-reset-btn"
                      onClick={() => void handleResetLocalDb()}
                      style={{
                        minHeight: "30px",
                        fontSize: "11px",
                        padding: "4px 8px",
                        borderRadius: "6px",
                        background: "#d84949",
                        color: "#fff",
                        fontWeight: 700,
                        border: "none",
                      }}
                    >
                      تأكيد التصفير
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="erp-secondary-btn"
                      disabled={dbBusy}
                      data-testid="local-db-reset-btn"
                      onClick={() => setConfirmReset(true)}
                      style={{
                        minHeight: "30px",
                        fontSize: "11px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        padding: "4px 8px",
                        color: "#d84949",
                      }}
                    >
                      <TrashIcon />
                      <span>تهيئة</span>
                    </button>
                  )
                ) : null}
              </div>
            </div>
          </section>

          <section className="erp-section">
            <div className="erp-section-head">
              <h3>حزمة تطبيق الجوال</h3>
              <span>17 ملفًا جاهزًا</span>
            </div>
            <div className="erp-action-list">
              <button
                type="button"
                className="erp-action-row"
                data-testid="open-flutter-export-btn"
                onClick={() => {
                  triggerHaptic("light");
                  keyboard.hide();
                  setFlutterModalOpen(true);
                }}
              >
                <span className="erp-action-dot" style={{ background: "var(--nasqo-blue)" }} />
                <div className="erp-action-copy">
                  <strong>تصدير حزمة تطبيق الجوال</strong>
                  <small>استعراض ونسخ وتنزيل ملفات شاشات التطبيق</small>
                </div>
                <CodeIcon />
              </button>
            </div>
          </section>
        </main>
      </MobileScroll>
      <FlutterExportModal
        open={flutterModalOpen}
        onClose={() => setFlutterModalOpen(false)}
        onToast={(msg) => onToast?.(msg)}
      />
    </>
  );
}
