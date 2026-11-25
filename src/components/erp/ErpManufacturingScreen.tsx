import { usesNativeDocumentOutput } from "../../hybrid/documentOutput";
import { useMemo, useState } from "react";
import { CheckCircledIcon, PlusIcon } from "@radix-ui/react-icons";
import { formatAmount } from "../../accounting";
import {
  computeBomAvailability,
  computeCostCenterMetrics,
  parsePositiveNumber,
  type ErpCostCenter,
  type ErpProductionOrder,
  type ErpWorkspaceData,
} from "../../erp";
import { batchUpdateInventoryItems } from "../../firebase";
import { KeyboardInput, MobileScroll, useKeyboard } from "../../mobile";
import type {
  AccountRecord,
  CurrencyCode,
  InventoryItemRecord,
  LedgerEntryRecord,
  WarehouseRecord,
} from "../../types";
import { triggerHaptic } from "../../utils/haptics";

type MfgTab = "bom" | "cost-centers";

export function ErpManufacturingScreen({
  uid,
  currency,
  accounts,
  ledger,
  warehouses,
  inventory,
  erpData,
  onUpdateErpData,
  onToast,
}: {
  uid: string;
  currency: CurrencyCode;
  accounts: readonly AccountRecord[];
  ledger: readonly LedgerEntryRecord[];
  warehouses: readonly WarehouseRecord[];
  inventory: readonly InventoryItemRecord[];
  erpData: ErpWorkspaceData;
  onUpdateErpData: (next: ErpWorkspaceData) => Promise<boolean>;
  onToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<MfgTab>("bom");
  const keyboard = useKeyboard();

  const [newOrderQty, setNewOrderQty] = useState("4");
  const [selectedBomId, setSelectedBomId] = useState(() => erpData.boms[0]?.id ?? "");
  const [completingOrderId, setCompletingOrderId] = useState<string | null>(null);

  const [addingCc, setAddingCc] = useState(false);
  const [ccName, setCcName] = useState("");
  const [ccManager, setCcManager] = useState("");
  const [ccBudget, setCcBudget] = useState("30000");

  const ccMetrics = useMemo(
    () => computeCostCenterMetrics(erpData.costCenters, accounts, ledger),
    [accounts, erpData.costCenters, ledger],
  );

  const handleCreateProductionOrder = async () => {
    if(usesNativeDocumentOutput()){onToast("هذا الترحيل المتقدم غير مدعوم محليًا بعد؛ استخدم شاشة المستند الأصلية. لم يُرحّل أي أثر.");return;}
    keyboard.hide();
    const bom = erpData.boms.find((b) => b.id === selectedBomId) ?? erpData.boms[0];
    if (!bom) {
      onToast("لا توجد قائمة مواد متاحة");
      return;
    }
    const qty = Math.max(1, Math.round(parsePositiveNumber(newOrderQty)));
    const defaultWh = warehouses.find((w) => w.isDefault) ?? warehouses[0];
    const order: ErpProductionOrder = {
      id: `mfg_${Date.now()}`,
      orderNumber: `MFG-0${erpData.productionOrders.length + 1}`,
      bomId: bom.id,
      bomName: bom.name,
      finishedItemId: bom.finishedItemId,
      finishedItemName: bom.finishedItemName,
      quantityToProduce: qty,
      warehouseId: defaultWh?.id ?? "wh_1",
      status: "planned",
      createdDate: new Date().toISOString().slice(0, 10),
      costCenterId: erpData.costCenters[0]?.id,
    };
    if (!await onUpdateErpData({
      ...erpData,
      productionOrders: [order, ...erpData.productionOrders],
    })) return;
    triggerHaptic("success");
    onToast(`تم إنشاء أمر التصنيع ${order.orderNumber}`);
  };

  const handleCompleteProduction = async (order: ErpProductionOrder) => {
    if(usesNativeDocumentOutput()){onToast("هذا الترحيل المتقدم غير مدعوم محليًا بعد؛ استخدم شاشة المستند الأصلية. لم يُرحّل أي أثر.");return;}
    keyboard.hide();
    if (order.status === "completed") return;
    const bom = erpData.boms.find((b) => b.id === order.bomId);
    if (!bom) return;

    const check = computeBomAvailability(bom, order.quantityToProduce, inventory);
    if (!check.canProduce) {
      triggerHaptic("warning");
      const firstShort = check.shortages[0];
      onToast(
        `نقص خامات: ${firstShort.itemName} (المطلوب ${firstShort.required} والمتاح ${firstShort.available})`,
      );
      return;
    }

    setCompletingOrderId(order.id);
    try {
      const updates: { item: InventoryItemRecord; quantity: number }[] = [];
      for (const comp of bom.components) {
        const rawItem = inventory.find((i) => i.id === comp.inventoryItemId);
        if (rawItem) {
          updates.push({
            item: rawItem,
            quantity: Math.max(0, rawItem.quantity - comp.quantityPerUnit * order.quantityToProduce),
          });
        }
      }
      const finishedItem = inventory.find((i) => i.id === order.finishedItemId);
      if (finishedItem) {
        updates.push({
          item: finishedItem,
          quantity: finishedItem.quantity + order.quantityToProduce,
        });
      }
      await batchUpdateInventoryItems(uid, updates);

      if (!await onUpdateErpData({
        ...erpData,
        productionOrders: erpData.productionOrders.map((o) =>
          o.id === order.id
            ? {
                ...o,
                status: "completed",
                completedDate: new Date().toISOString().slice(0, 10),
              }
            : o,
        ),
      })) return;
      triggerHaptic("success");
      onToast(
        `تم إتمام الإنتاج ${order.orderNumber}: خصم الخامات وإضافة ${order.quantityToProduce} للمنتج التام`,
      );
    } catch {
      onToast("تعذر إتمام أمر الإنتاج حاليًا");
    } finally {
      setCompletingOrderId(null);
    }
  };

  const handleAddCostCenter = async () => {
    keyboard.hide();
    if (!ccName.trim()) {
      onToast("أدخل اسم مركز التكلفة أولًا");
      return;
    }
    const nextCode = `CC-${(erpData.costCenters.length + 1) * 100}`;
    const cc: ErpCostCenter = {
      id: `cc_${Date.now()}`,
      code: nextCode,
      name: ccName.trim(),
      managerName: ccManager.trim() || "الإدارة المالية",
      budget: parsePositiveNumber(ccBudget),
      extraPostedSpend: 0,
      linkedCategories: ["مصروفات تشغيلية"],
      status: "active",
    };
    if (!await onUpdateErpData({
      ...erpData,
      costCenters: [...erpData.costCenters, cc],
    })) return;
    setCcName("");
    setCcManager("");
    setAddingCc(false);
    triggerHaptic("success");
    onToast(`تم إنشاء مركز التكلفة ${cc.code}`);
  };

  return (
    <MobileScroll className="app-screen erp-scroll">
      <main className="erp-page" data-testid="erp-manufacturing-screen">
        {usesNativeDocumentOutput()?<p role="note" className="field-inline-error">حفظ السجلات الإدارية متاح محليًا. الترحيل المتقدم والاستلام والتصنيع غير متاحة هنا؛ استخدم شاشات الفاتورة والسند الأصلية.</p>:null}
        <div className="erp-segmented" role="tablist" aria-label="التصنيع ومراكز التكلفة">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "bom"}
            className={tab === "bom" ? "active" : ""}
            onClick={() => {
              triggerHaptic("light");
              setTab("bom");
            }}
          >
            التصنيع والمكونات
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "cost-centers"}
            className={tab === "cost-centers" ? "active" : ""}
            onClick={() => {
              triggerHaptic("light");
              setTab("cost-centers");
            }}
          >
            مراكز التكلفة
          </button>
        </div>

        {tab === "bom" ? (
          <>
            <section className="erp-card">
              <div className="erp-card-head">
                <div>
                  <h3>إنشاء أمر تصنيع جديد</h3>
                  <small>فحص توفر المكونات وتحديث المخزون عند الإتمام</small>
                </div>
              </div>
              <div className="erp-inline-form">
                <div className="erp-form-row-2">
                  <select
                    aria-label="وصفة التصنيع"
                    value={selectedBomId}
                    onChange={(e) => setSelectedBomId(e.target.value)}
                  >
                    {erpData.boms.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <KeyboardInput
                    inputMode="decimal"
                    placeholder="الكمية المطلوبة"
                    value={newOrderQty}
                    onChange={(e) => setNewOrderQty(e.target.value)}
                  />
                </div>
                <button type="button" className="erp-primary-btn full" disabled={usesNativeDocumentOutput()} onClick={handleCreateProductionOrder}>
                  <PlusIcon />
                  <span>إصدار أمر تصنيع</span>
                </button>
              </div>
            </section>

            <section className="erp-card">
              <div className="erp-card-head">
                <h3>أوامر الإنتاج النشطة والسابقة</h3>
                <small>
                  {erpData.productionOrders.length === 1
                    ? "أمر واحد"
                    : erpData.productionOrders.length <= 10
                      ? `${erpData.productionOrders.length} أوامر`
                      : `${erpData.productionOrders.length} أمر`}
                </small>
              </div>
              <div className="erp-list">
                {erpData.productionOrders.map((order) => {
                  const bom = erpData.boms.find((b) => b.id === order.bomId);
                  const availability = bom
                    ? computeBomAvailability(bom, order.quantityToProduce, inventory)
                    : null;
                  return (
                    <article key={order.id} className="erp-row-card">
                      <div className="erp-row-main">
                        <div>
                          <strong>{order.orderNumber} · {order.finishedItemName}</strong>
                          <small>{order.bomName} · الكمية: <bdi>{order.quantityToProduce}</bdi></small>
                        </div>
                        <span className={`erp-status-text status-${order.status === "completed" ? "approved" : "pending"}`}>
                          {order.status === "completed" ? "مكتمل" : "مخطط للتنفيذ"}
                        </span>
                      </div>

                      {availability ? (
                        <div className="erp-row-meta">
                          <span>التكلفة التقديرية: <bdi>{formatAmount(availability.totalEstimatedCost)} {currency}</bdi></span>
                          <span className={availability.canProduce ? "pos" : "neg"}>
                            {availability.canProduce ? "الخامات متوفرة" : `عجز في ${availability.shortages.length} مكونات`}
                          </span>
                        </div>
                      ) : null}

                      {order.status !== "completed" ? (
                        <div className="erp-inline-actions">
                          <button
                            type="button"
                            className="erp-primary-btn"
                            disabled={usesNativeDocumentOutput() || completingOrderId === order.id}
                            onClick={() => handleCompleteProduction(order)}
                            data-testid={`erp-complete-${order.id}`}
                          >
                            <CheckCircledIcon />
                            <span>
                              {completingOrderId === order.id
                                ? "جاري التنفيذ..."
                                : "إتمام الإنتاج وتحديث المخزون"}
                            </span>
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <section className="erp-card">
            <div className="erp-card-head">
              <div>
                <h3>مراكز التكلفة والموازنات</h3>
                <small>ربط آلي ببنود المصاريف في الأستاذ العام</small>
              </div>
              <button
                type="button"
                className="erp-chip-btn"
                onClick={() => {
                  keyboard.hide();
                  setAddingCc((v) => !v);
                }}
              >
                <PlusIcon />
                <span>{addingCc ? "إغلاق" : "مركز جديد"}</span>
              </button>
            </div>

            {addingCc ? (
              <div className="erp-inline-form">
                <KeyboardInput
                  placeholder="اسم مركز التكلفة (مثال: فرع جدة)"
                  value={ccName}
                  onChange={(e) => setCcName(e.target.value)}
                />
                <div className="erp-form-row-2">
                  <KeyboardInput
                    placeholder="المسؤول"
                    value={ccManager}
                    onChange={(e) => setCcManager(e.target.value)}
                  />
                  <KeyboardInput
                    inputMode="decimal"
                    placeholder="الموازنة المعتمدة"
                    value={ccBudget}
                    onChange={(e) => setCcBudget(e.target.value)}
                  />
                </div>
                <button type="button" className="erp-primary-btn full" onClick={handleAddCostCenter}>
                  حفظ مركز التكلفة
                </button>
              </div>
            ) : null}

            <div className="erp-list">
              {ccMetrics.map((cc) => (
                <article key={cc.id} className="erp-row-card">
                  <div className="erp-row-main">
                    <div>
                      <strong><bdi>{cc.code}</bdi> · {cc.name}</strong>
                      <small>المسؤول: {cc.managerName} · {cc.linkedCategories.join(" · ")}</small>
                    </div>
                    <div className="erp-row-value">
                      <strong className={cc.remaining >= 0 ? "pos" : "neg"}>
                        <bdi>{cc.utilizationPct}%</bdi>
                      </strong>
                      <small>استهلاك</small>
                    </div>
                  </div>
                  <div className="erp-progress-track">
                    <div
                      className={`erp-progress-fill ${cc.utilizationPct > 90 ? "danger" : ""}`}
                      style={{ width: `${Math.min(100, cc.utilizationPct)}%` }}
                    />
                  </div>
                  <div className="erp-row-meta">
                    <span>المنصرف: <bdi>{formatAmount(cc.actualSpend)}</bdi></span>
                    <span>الموازنة: <bdi>{formatAmount(cc.budget)}</bdi></span>
                    <span>المتبقي: <bdi>{formatAmount(cc.remaining)}</bdi> {currency}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </MobileScroll>
  );
}
