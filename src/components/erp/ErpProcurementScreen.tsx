import { executeErpAction } from "../../firebase";
import { ErpRecordManager } from "./ErpRecordManager";
import { usesNativeDocumentOutput } from "../../hybrid/documentOutput";
import { useMemo, useState } from "react";
import { formatAmount } from "../../accounting";
import {
  computePurchaseOrderTotal,
  type ErpPurchaseOrder,
  type ErpWorkspaceData,
} from "../../erp";
import { MobileScroll, useKeyboard } from "../../mobile";
import type {
  AccountRecord,
  CurrencyCode,
  InventoryItemRecord,
  WarehouseRecord,
} from "../../types";
import { triggerHaptic } from "../../utils/haptics";
import { canReceiveAgainstExistingStock } from "../../legacy/liveSafety";

export function ErpProcurementScreen({
  uid,
  currency,
  accounts,
  warehouses,
  inventory,
  erpData,
  onUpdateErpData,
  onToast,
}: {
  uid: string;
  currency: CurrencyCode;
  accounts: readonly AccountRecord[];
  warehouses: readonly WarehouseRecord[];
  inventory: readonly InventoryItemRecord[];
  erpData: ErpWorkspaceData;
  onUpdateErpData: (next: ErpWorkspaceData) => Promise<boolean>;
  onToast: (msg: string) => void;
}) {
  const keyboard = useKeyboard();
  const [receivingPoId, setReceivingPoId] = useState<string | null>(null);

  const totalOpenValue = useMemo(
    () =>
      erpData.purchaseOrders
        .filter((p) => p.status !== "received")
        .reduce((s, p) => s + computePurchaseOrderTotal(p), 0),
    [erpData.purchaseOrders],
  );

  const handleReceivePo = async (po: ErpPurchaseOrder) => {
    if(usesNativeDocumentOutput()){onToast("هذا الترحيل المتقدم غير مدعوم محليًا بعد؛ استخدم شاشة المستند الأصلية. لم يُرحّل أي أثر.");return;}
    keyboard.hide();
    if (po.status === "received") return;
    // Validate every line before the first write. Never merge a new receipt
    // into a legacy stock balance that has not been counted and approved.
    const unsafe = po.lines.find((line) => {
      const match = inventory.find((item) => item.id === line.inventoryItemId);
      return !match || !canReceiveAgainstExistingStock(match);
    });
    if (unsafe) {
      onToast(`تعذر استلام ${po.poNumber}: الصنف «${unsafe.itemName}» يحتاج جردًا معتمدًا أو لم يعد موجودًا. لم تُرحّل أي حركة.`);
      return;
    }
    setReceivingPoId(po.id);
    try {
      await executeErpAction(uid,{action:'receivePurchaseOrder',id:po.id,expectedRevision:(po as unknown as {_revision:string})._revision});
      triggerHaptic("success");
      onToast(`تم استلام ${po.poNumber} وتحديث المخزون وترحيل فاتورة المورد`);
    } catch(e) {
      onToast(e instanceof Error?e.message:"تعذر استلام أمر الشراء حاليًا");
    } finally {
      setReceivingPoId(null);
    }
  };

  return (
    <MobileScroll className="app-screen erp-scroll">
      <main className="erp-page" data-testid="erp-procurement-screen">
        {usesNativeDocumentOutput()?<p role="note" className="field-inline-error">حفظ السجلات الإدارية متاح محليًا. الترحيل المتقدم والاستلام والتصنيع غير متاحة هنا؛ استخدم شاشات الفاتورة والسند الأصلية.</p>:null}
        <section className="erp-summary-strip">
          <div>
            <small>أوامر الشراء المفتوحة</small>
            <strong>{erpData.purchaseOrders.filter((p) => p.status !== "received").length}</strong>
          </div>
          <div>
            <small>قيمة التوريد المفتوحة</small>
            <strong className="warn"><bdi>{formatAmount(totalOpenValue)} {currency}</bdi></strong>
          </div>
        </section>

        <ErpRecordManager uid={uid} collection="purchaseOrders" erpData={erpData} currency={currency} accounts={accounts} warehouses={warehouses} inventory={inventory} onToast={onToast}
          extraActions={row=>row.status==="approved"?<button className="erp-primary-btn" disabled={usesNativeDocumentOutput()||receivingPoId===row.id} onClick={()=>void handleReceivePo(row as ErpPurchaseOrder)}>استلام أمر الشراء</button>:null}/>
      </main>
    </MobileScroll>
  );
}
