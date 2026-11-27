import { executeErpAction } from "../../firebase";
import { ErpRecordManager } from "./ErpRecordManager";
import { usesNativeDocumentOutput } from "../../hybrid/documentOutput";
import { useMemo, useState } from "react";
import { CheckCircledIcon, PlusIcon } from "@radix-ui/react-icons";
import { formatAmount, normalizeArabicSearch } from "../../accounting";
import {
  type ErpDealRecord,
  type ErpWorkspaceData,
} from "../../erp";
import { createLedgerEntry } from "../../firebase";
import { KeyboardInput, MobileScroll, useKeyboard } from "../../mobile";
import type {
  AccountRecord,
  CurrencyCode,
  InventoryItemRecord,
  WarehouseRecord,
} from "../../types";
import { triggerHaptic } from "../../utils/haptics";
import { InvoiceForm } from "../InvoiceForm";
import { approvedLiveSellingPrice, canSellFromVerifiedStock } from "../../legacy/liveSafety";

type CrmPosTab = "pos" | "crm";

export function ErpCrmPosScreen({
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
  const [tab, setTab] = useState<CrmPosTab>("pos");
  const [catalogSearch, setCatalogSearch] = useState("");
  const keyboard = useKeyboard();

  const salesAndClientAccounts = useMemo(() => {
    const preferred = accounts.filter((a) => a.category === "sales" || a.category === "clients");
    return preferred.length > 0 ? preferred : accounts;
  }, [accounts]);

  const [selectedAccountId, setSelectedAccountId] = useState(
    () => salesAndClientAccounts[0]?.id ?? "",
  );
  const [selectedWhId, setSelectedWhId] = useState(
    () => warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "",
  );
  const [payment, setPayment] = useState<"cash" | "credit">("cash");
  const [includeVat, setIncludeVat] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [checkingOut, setCheckingOut] = useState(false);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);

  const effectiveAccountId =
    salesAndClientAccounts.find((a) => a.id === selectedAccountId)?.id ??
    salesAndClientAccounts[0]?.id ??
    "";
  const effectiveWhId =
    warehouses.find((w) => w.id === selectedWhId)?.id ?? warehouses[0]?.id ?? "";

  const cartLines = useMemo(() => {
    return inventory
      .filter((item) => (cart[item.id] ?? 0) > 0)
      .map((item) => {
        const qty = cart[item.id] ?? 0;
        const unitSellPrice = approvedLiveSellingPrice(item) ?? 0;
        return {
          item,
          qty,
          unitSellPrice,
          lineTotal: qty * unitSellPrice,
        };
      });
  }, [cart, inventory]);

  const visibleCatalog = useMemo(() => {
    const query = normalizeArabicSearch(catalogSearch);
    return inventory.filter((item) => !query || normalizeArabicSearch(
      `${item.name} ${item.sku ?? ""} ${item.unit} ${item.legacyRef ?? ""}`,
    ).includes(query));
  }, [catalogSearch, inventory]);

  const subtotal = useMemo(
    () => cartLines.reduce((sum, l) => sum + l.lineTotal, 0),
    [cartLines],
  );
  const vatAmount = includeVat ? Math.round(subtotal * 0.15 * 100) / 100 : 0;
  const grandTotal = subtotal + vatAmount;

  const adjustCart = (item: InventoryItemRecord, delta: number) => {
    triggerHaptic("light");
    setCart((prev) => {
      const current = prev[item.id] ?? 0;
      if (!canSellFromVerifiedStock(item)) return prev;
      const next = Math.max(0, Math.min(item.quantity, current + delta));
      if (next === 0) {
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      }
      return { ...prev, [item.id]: next };
    });
  };

  const handlePosCheckout = async () => {
    if(usesNativeDocumentOutput()){onToast("هذا الترحيل المتقدم غير مدعوم محليًا بعد؛ استخدم شاشة المستند الأصلية. لم يُرحّل أي أثر.");return;}
    keyboard.hide();
    if (cartLines.length === 0) {
      onToast("أضف صنفًا واحدًا على الأقل لسلة نقطة البيع");
      return;
    }
    if (cartLines.some((line) => !canSellFromVerifiedStock(line.item) || line.qty > line.item.quantity)) {
      onToast("لا يمكن إتمام بيع صنف برصيد غير مسوى أو بسعر بيع غير معتمد. راجع جرد المخزون وسعر البيع أولًا.");
      return;
    }
    const targetAccount =
      salesAndClientAccounts.find((a) => a.id === effectiveAccountId) ?? accounts[0];
    if (!targetAccount) {
      onToast("لا يوجد حساب مبيعات أو عميل محدد");
      return;
    }
    const targetWh = warehouses.find((w) => w.id === effectiveWhId) ?? warehouses[0];
    if(!targetWh){onToast("اختر مخزنًا موجودًا لإتمام البيع.");return;}
    setCheckingOut(true);
    try {
      const detailsText =
        cartLines
          .map((l) => `${l.item.name} | ${l.qty} ${l.item.unit} × ${formatAmount(l.unitSellPrice)}`)
          .join("\n") + (includeVat ? `\nضريبة القيمة المضافة 15%: ${formatAmount(vatAmount)}` : "");

      await createLedgerEntry(uid, {
        accountId: targetAccount.id,
        accountName: targetAccount.name,
        kind: "invoice",
        typeLabel: payment === "cash" ? "ف.مبيعات نقدية" : "ف.مبيعات آجلة",
        payment,
        direction: "debit",
        amount: grandTotal,
        taxAmount: vatAmount,
        lines: cartLines.map(l=>({inventoryItemId:l.item.id,itemName:l.item.name,unit:l.item.unit,warehouseId:targetWh!.id,quantity:l.qty,price:l.unitSellPrice,total:l.lineTotal})),
        currency,
        exchangeRate: 1,
        details: detailsText,
        warehouseId: targetWh?.id ?? "wh_1",
        warehouseName: targetWh?.name ?? "المخزن الرئيسي",
        invoiceContent: "items",
        entryDate: new Date().toISOString().slice(0, 10),
      });

      setCart({});
      triggerHaptic("success");
      onToast(`تم إتمام البيع (${formatAmount(grandTotal)} ${currency}) وتحديث المخزون والأستاذ العام`);
    } catch {
      onToast("حدث خطأ أثناء ترحيل عملية نقطة البيع");
    } finally {
      setCheckingOut(false);
    }
  };

  const handleConvertDealToInvoice = async (deal: ErpDealRecord) => {
    if(usesNativeDocumentOutput()){onToast("هذا الترحيل المتقدم غير مدعوم محليًا بعد؛ استخدم شاشة المستند الأصلية. لم يُرحّل أي أثر.");return;}
    keyboard.hide();
    if (deal.convertedInvoiceEntryId) return;
    const acc =
      accounts.find((a) => a.id === deal.clientAccountId) ??
      salesAndClientAccounts[0] ??
      accounts[0];
    if (!acc) {
      onToast("لا يوجد حساب عميل مرتبط بالصفقة");
      return;
    }
    try {
      await executeErpAction(uid,{action:'convertDeal',id:deal.id,expectedRevision:(deal as unknown as {_revision:string})._revision});
      triggerHaptic("success");
      onToast(`تم تحويل الصفقة إلى فاتورة مبيعات بقيمة ${formatAmount(deal.value)} ${deal.currency}`);
    } catch(e) {
      onToast(e instanceof Error?e.message:"تعذر تحويل الصفقة إلى فاتورة");
    }
  };

  const activePipelineTotal = useMemo(
    () =>
      erpData.deals
        .filter((d) => d.stage !== "lost")
        .reduce((sum, d) => sum + d.value, 0),
    [erpData.deals],
  );

  return (
    <MobileScroll className="app-screen erp-scroll">
      <main className="erp-page" data-testid="erp-crm-screen">
        {usesNativeDocumentOutput()?<p role="note" className="field-inline-error">حفظ السجلات الإدارية متاح محليًا. الترحيل المتقدم والاستلام والتصنيع غير متاحة هنا؛ استخدم شاشات الفاتورة والسند الأصلية.</p>:null}
        <div className="erp-segmented" role="tablist" aria-label="المبيعات ونقطة البيع">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pos"}
            className={tab === "pos" ? "active" : ""}
            onClick={() => {
              triggerHaptic("light");
              setTab("pos");
            }}
          >
            نقطة البيع
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "crm"}
            className={tab === "crm" ? "active" : ""}
            onClick={() => {
              triggerHaptic("light");
              setTab("crm");
            }}
          >
            فرص المبيعات
          </button>
        </div>

        {tab === "pos" ? (
          <>
            <section className="erp-card">
              <div className="erp-form-row-2">
                <label className="erp-field">
                  <span>العميل / المبيعات</span>
                  <select
                    aria-label="حساب العميل في نقطة البيع"
                    value={effectiveAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                  >
                    {salesAndClientAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="erp-field">
                  <span>المستودع</span>
                  <select
                    aria-label="مستودع الصرف"
                    value={effectiveWhId}
                    onChange={(e) => setSelectedWhId(e.target.value)}
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="erp-pos-toggles">
                <div className="erp-pill-switch">
                  <button
                    type="button"
                    className={payment === "cash" ? "active" : ""}
                    onClick={() => setPayment("cash")}
                  >
                    نقدي
                  </button>
                  <button
                    type="button"
                    className={payment === "credit" ? "active" : ""}
                    onClick={() => setPayment("credit")}
                  >
                    آجل
                  </button>
                </div>
                <label className="erp-checkbox">
                  <input
                    type="checkbox"
                    checked={includeVat}
                    onChange={(e) => setIncludeVat(e.target.checked)}
                  />
                  <span>ضريبة 15%</span>
                </label>
              </div>
            </section>

            <section className="erp-card">
              <div className="erp-card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3>كتالوج الأصناف للبيع السريع</h3>
                  <small>البيع يخصم من المخزون آليًا</small>
                </div>
                <button
                  type="button"
                  className="erp-chip-btn"
                  onClick={() => {
                    keyboard.hide();
                    setShowInvoiceForm(true);
                  }}
                  data-testid="open-invoice-form-btn"
                  style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 10px", background: "var(--nasqo-blue)", color: "#fff", borderRadius: "8px" }}
                >
                  <PlusIcon />
                  <span>فاتورة مفصلة</span>
                </button>
              </div>
              <label className="erp-field" style={{ margin: "8px 0" }}>
                <span>البحث في الأصناف المستوردة</span>
                <KeyboardInput
                  aria-label="البحث عن صنف أو باركود في نقطة البيع"
                  placeholder="ابحث بالاسم أو الباركود..."
                  value={catalogSearch}
                  onChange={(event) => setCatalogSearch(event.target.value)}
                />
              </label>
              <div className="erp-list">
                {visibleCatalog.map((item) => {
                  const qtyInCart = cart[item.id] ?? 0;
                  const sellPrice = approvedLiveSellingPrice(item);
                  const saleBlocked = !canSellFromVerifiedStock(item);
                  return (
                    <div key={item.id} className="erp-pos-item">
                      <div className="erp-pos-item-info">
                        <strong>{item.name}</strong>
                        <small>
                          السعر: {sellPrice === null ? <b style={{ color: "#b45309" }}>بحاجة لاعتماد سعر البيع</b> : <><bdi>{formatAmount(sellPrice)}</bdi> {currency}</>} · المتاح:{" "}
                          {item.quantityUnverified ? (
                            <bdi style={{ color: "#b45309" }}>بحاجة إلى تسوية</bdi>
                          ) : (
                            <>
                              <bdi>{item.quantity}</bdi> {item.unit}
                            </>
                          )}
                        </small>
                      </div>
                      <div className="erp-stepper">
                        <button
                          type="button"
                          aria-label={`إنقاص ${item.name}`}
                          disabled={qtyInCart === 0}
                          onClick={() => adjustCart(item, -1)}
                        >
                          −
                        </button>
                        <span><bdi>{qtyInCart}</bdi></span>
                        <button
                          type="button"
                          aria-label={`إضافة ${item.name}`}
                          data-testid={`pos-add-${item.id}`}
                          disabled={saleBlocked || qtyInCart >= item.quantity}
                          title={saleBlocked ? "يتطلب الصنف تسوية كمية المخزون واعتماد سعر البيع" : undefined}
                          onClick={() => adjustCart(item, 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="erp-card erp-checkout-bar">
              <div className="erp-stmt-list">
                <div className="erp-stmt-row">
                  <span>المجموع الفرعي ({cartLines.length} أصناف)</span>
                  <strong><bdi>{formatAmount(subtotal)}</bdi></strong>
                </div>
                {includeVat ? (
                  <div className="erp-stmt-row">
                    <span>ضريبة القيمة المضافة 15%</span>
                    <strong><bdi>{formatAmount(vatAmount)}</bdi></strong>
                  </div>
                ) : null}
                <div className="erp-stmt-row total">
                  <span>الإجمالي المستحق</span>
                  <strong className="pos">
                    <bdi>{formatAmount(grandTotal)} {currency}</bdi>
                  </strong>
                </div>
              </div>
              <button
                type="button"
                className="erp-primary-btn full"
                disabled={usesNativeDocumentOutput() || checkingOut || cartLines.length === 0}
                onClick={handlePosCheckout}
                data-testid="erp-pos-checkout-btn"
              >
                <CheckCircledIcon />
                <span>{checkingOut ? "جاري الترحيل..." : "إتمام البيع وترحيل المخزون والمحاسبة"}</span>
              </button>
            </section>
          </>
        ) : <ErpRecordManager uid={uid} collection="deals" erpData={erpData} currency={currency} accounts={accounts} onToast={onToast}
          extraActions={row=>row.stage==="won"&&!row.convertedInvoiceEntryId?<button className="erp-chip-btn" disabled={usesNativeDocumentOutput()} onClick={()=>void handleConvertDealToInvoice(row as ErpDealRecord)}>تحويل إلى فاتورة مبيعات</button>:null}/>}
      </main>
      <InvoiceForm
        open={showInvoiceForm}
        uid={uid}
        currency={currency}
        accounts={accounts}
        warehouses={warehouses}
        inventory={inventory}
        onClose={() => setShowInvoiceForm(false)}
        onToast={onToast}
      />
    </MobileScroll>
  );
}
