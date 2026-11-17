import { useMemo, useState } from "react";
import { CheckCircledIcon, PlusIcon } from "@radix-ui/react-icons";
import { formatAmount, normalizeArabicSearch } from "../../accounting";
import {
  parsePositiveNumber,
  type ErpDealRecord,
  type ErpDealStage,
  type ErpWorkspaceData,
} from "../../erp";
import { batchUpdateInventoryItems, createLedgerEntry } from "../../firebase";
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

const STAGE_LABEL: Record<ErpDealStage, string> = {
  lead: "فرصة جديدة",
  proposal: "عرض سعر",
  negotiation: "تفاوض",
  won: "صفقة مغلقة (ربح)",
  lost: "مغلقة (خسارة)",
};

const STAGE_NEXT: Partial<Record<ErpDealStage, ErpDealStage>> = {
  lead: "proposal",
  proposal: "negotiation",
  negotiation: "won",
};

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
  onUpdateErpData: (next: ErpWorkspaceData) => void;
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

  const [addingDeal, setAddingDeal] = useState(false);
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("15000");
  const [dealClientId, setDealClientId] = useState(() => salesAndClientAccounts[0]?.id ?? "");

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
    setCheckingOut(true);
    try {
      await batchUpdateInventoryItems(
        uid,
        cartLines.map((line) => ({
          item: line.item,
          quantity: Math.max(0, line.item.quantity - line.qty),
        })),
      );
      const detailsText =
        cartLines
          .map((l) => `${l.item.name} | ${l.qty} ${l.item.unit} × ${formatAmount(l.unitSellPrice)}`)
          .join("\n") + (includeVat ? `\nضريبة القيمة المضافة 15%: ${formatAmount(vatAmount)}` : "");

      await createLedgerEntry(uid, {
        accountId: targetAccount.id,
        accountName: targetAccount.name,
        kind: "invoice",
        typeLabel: payment === "cash" ? "ف.مبيعات نقدية (POS)" : "ف.مبيعات آجلة (POS)",
        payment,
        direction: "debit",
        amount: grandTotal,
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

  const handleCreateDeal = () => {
    keyboard.hide();
    if (!dealTitle.trim()) {
      onToast("أدخل عنوان الصفقة أولًا");
      return;
    }
    const client =
      salesAndClientAccounts.find((a) => a.id === dealClientId) ?? salesAndClientAccounts[0];
    const newDeal: ErpDealRecord = {
      id: `deal_${Date.now()}`,
      title: dealTitle.trim(),
      clientAccountId: client?.id ?? "acc_sales_1",
      clientName: client?.name ?? "المبيعات العامة",
      value: parsePositiveNumber(dealValue),
      currency,
      stage: "lead",
      probability: 25,
      expectedCloseDate: new Date().toISOString().slice(0, 10),
      assignedTo: erpData.employees[0]?.name ?? "فريق المبيعات",
    };
    onUpdateErpData({
      ...erpData,
      deals: [newDeal, ...erpData.deals],
    });
    setDealTitle("");
    setAddingDeal(false);
    triggerHaptic("success");
    onToast("تمت إضافة الفرصة البيعية إلى خط المبيعات");
  };

  const handleAdvanceDeal = (dealId: string) => {
    triggerHaptic("light");
    onUpdateErpData({
      ...erpData,
      deals: erpData.deals.map((d) => {
        if (d.id !== dealId) return d;
        const nextStage = STAGE_NEXT[d.stage];
        if (!nextStage) return d;
        const probMap: Record<ErpDealStage, number> = {
          lead: 25,
          proposal: 50,
          negotiation: 75,
          won: 100,
          lost: 0,
        };
        return { ...d, stage: nextStage, probability: probMap[nextStage] };
      }),
    });
  };

  const handleConvertDealToInvoice = async (deal: ErpDealRecord) => {
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
    const defaultWh = warehouses.find((w) => w.isDefault) ?? warehouses[0];
    try {
      const entryId = await createLedgerEntry(uid, {
        accountId: acc.id,
        accountName: acc.name,
        kind: "invoice",
        typeLabel: "فاتورة مبيعات (CRM)",
        payment: "credit",
        direction: "debit",
        amount: deal.value,
        currency: deal.currency,
        exchangeRate: 1,
        details: `تحويل صفقة: ${deal.title}`,
        warehouseId: defaultWh?.id ?? "wh_1",
        warehouseName: defaultWh?.name ?? "المخزن الرئيسي",
        invoiceContent: "free",
        entryDate: new Date().toISOString().slice(0, 10),
      });
      onUpdateErpData({
        ...erpData,
        deals: erpData.deals.map((d) =>
          d.id === deal.id
            ? { ...d, stage: "won", probability: 100, convertedInvoiceEntryId: entryId }
            : d,
        ),
      });
      triggerHaptic("success");
      onToast(`تم تحويل الصفقة إلى فاتورة مبيعات بقيمة ${formatAmount(deal.value)} ${deal.currency}`);
    } catch {
      onToast("تعذر تحويل الصفقة إلى فاتورة");
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
            نقطة البيع (POS)
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
            فرص المبيعات (CRM)
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
                disabled={checkingOut || cartLines.length === 0}
                onClick={handlePosCheckout}
                data-testid="erp-pos-checkout-btn"
              >
                <CheckCircledIcon />
                <span>{checkingOut ? "جاري الترحيل..." : "إتمام البيع وترحيل المخزون والمحاسبة"}</span>
              </button>
            </section>
          </>
        ) : (
          <>
            <section className="erp-summary-strip">
              <div>
                <small>إجمالي قيمة الصفقات</small>
                <strong className="pos"><bdi>{formatAmount(activePipelineTotal)} {currency}</bdi></strong>
              </div>
              <div>
                <small>الصفقات المفتوحة</small>
                <strong>{erpData.deals.filter((d) => d.stage !== "won" && d.stage !== "lost").length}</strong>
              </div>
            </section>

            <section className="erp-card">
              <div className="erp-card-head">
                <h3>خط أنابيب المبيعات (CRM)</h3>
                <button
                  type="button"
                  className="erp-chip-btn"
                  onClick={() => {
                    keyboard.hide();
                    setAddingDeal((v) => !v);
                  }}
                >
                  <PlusIcon />
                  <span>{addingDeal ? "إغلاق" : "صفقة جديدة"}</span>
                </button>
              </div>

              {addingDeal ? (
                <div className="erp-inline-form">
                  <KeyboardInput
                    placeholder="عنوان الفرصة البيعية أو المشروع"
                    value={dealTitle}
                    onChange={(e) => setDealTitle(e.target.value)}
                  />
                  <div className="erp-form-row-2">
                    <KeyboardInput
                      inputMode="decimal"
                      placeholder="القيمة المتوقعة"
                      value={dealValue}
                      onChange={(e) => setDealValue(e.target.value)}
                    />
                    <select
                      aria-label="العميل"
                      value={dealClientId}
                      onChange={(e) => setDealClientId(e.target.value)}
                    >
                      {salesAndClientAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className="erp-primary-btn full" onClick={handleCreateDeal}>
                    حفظ الفرصة البيعية
                  </button>
                </div>
              ) : null}

              <div className="erp-list">
                {erpData.deals.map((deal) => (
                  <article key={deal.id} className="erp-row-card">
                    <div className="erp-row-main">
                      <div>
                        <strong>{deal.title}</strong>
                        <small>{deal.clientName} · {deal.assignedTo}</small>
                      </div>
                      <div className="erp-row-value">
                        <strong className="pos"><bdi>{formatAmount(deal.value)}</bdi></strong>
                        <small>{deal.currency}</small>
                      </div>
                    </div>
                    <div className="erp-row-meta">
                      <span>المرحلة: {STAGE_LABEL[deal.stage]}</span>
                      <span>احتمال الإغلاق: <bdi>{deal.probability}%</bdi></span>
                    </div>
                    <div className="erp-inline-actions">
                      {STAGE_NEXT[deal.stage] ? (
                        <button
                          type="button"
                          className="erp-secondary-btn"
                          onClick={() => handleAdvanceDeal(deal.id)}
                        >
                          ترقية المرحلة
                        </button>
                      ) : null}
                      {!deal.convertedInvoiceEntryId && deal.stage !== "lost" ? (
                        <button
                          type="button"
                          className="erp-primary-btn"
                          onClick={() => handleConvertDealToInvoice(deal)}
                        >
                          تحويل إلى فاتورة مبيعات
                        </button>
                      ) : null}
                      {deal.convertedInvoiceEntryId ? (
                        <span className="erp-status-text status-approved">تم الترحيل لفاتورة مبيعات</span>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
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
