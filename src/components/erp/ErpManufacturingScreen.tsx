import { executeErpAction } from "../../firebase";
import { ErpRecordManager } from "./ErpRecordManager";
import { usesNativeDocumentOutput } from "../../hybrid/documentOutput";
import { useMemo, useState } from "react";
import { formatAmount } from "../../accounting";
import {
  computeBomAvailability,
  computeCostCenterMetrics,
  type ErpProductionOrder,
  type ErpWorkspaceData,
} from "../../erp";
import { MobileScroll, useKeyboard } from "../../mobile";
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

  const [completingOrderId, setCompletingOrderId] = useState<string | null>(null);

  const ccMetrics = useMemo(
    () => computeCostCenterMetrics(erpData.costCenters, accounts, ledger),
    [accounts, erpData.costCenters, ledger],
  );

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
      await executeErpAction(uid,{action:'completeProduction',id:order.id,expectedRevision:(order as unknown as {_revision:string})._revision});
      triggerHaptic("success");
      onToast(
        `تم إتمام الإنتاج ${order.orderNumber}: خصم الخامات وإضافة ${order.quantityToProduce} للمنتج التام`,
      );
    } catch(e) {
      onToast(e instanceof Error?e.message:"تعذر إتمام أمر الإنتاج حاليًا");
    } finally {
      setCompletingOrderId(null);
    }
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

        {tab === "bom" ? <>
          <ErpRecordManager uid={uid} collection="boms" erpData={erpData} inventory={inventory} onToast={onToast}/>
          <ErpRecordManager uid={uid} collection="productionOrders" erpData={erpData} warehouses={warehouses} inventory={inventory} onToast={onToast}
            extraActions={row=>row.status!=="completed"?<button className="erp-primary-btn" disabled={usesNativeDocumentOutput()||completingOrderId===row.id} onClick={()=>void handleCompleteProduction(row as ErpProductionOrder)}>إتمام الإنتاج وتحديث المخزون</button>:null}/>
        </> : <>
          <ErpRecordManager uid={uid} collection="costCenters" erpData={erpData} onToast={onToast}/>
          <section className="erp-card"><h3>استهلاك الموازنات</h3>{ccMetrics.map(cc=><article key={cc.id} className="erp-row-card"><strong>{cc.code} · {cc.name}</strong><div className="erp-progress-track"><div className={`erp-progress-fill ${cc.utilizationPct>90?'danger':''}`} style={{width:`${Math.min(100,cc.utilizationPct)}%`}}/></div><div className="erp-row-meta"><span>المنصرف: {formatAmount(cc.actualSpend)}</span><span>الموازنة: {formatAmount(cc.budget)}</span><span>المتبقي: {formatAmount(cc.remaining)} {currency}</span><span>الاستهلاك: {cc.utilizationPct}%</span></div></article>)}</section>
        </>}
      </main>
    </MobileScroll>
  );
}
