import { useMemo, useState } from "react";
import { CheckCircledIcon, PlusIcon } from "@radix-ui/react-icons";
import { formatAmount } from "../../accounting";
import {
  computePurchaseOrderTotal,
  computeWeightedAvgCost,
  parsePositiveNumber,
  type ErpPurchaseOrder,
  type ErpWorkspaceData,
} from "../../erp";
import { createInventoryItem, createLedgerEntry, updateInventoryItem } from "../../firebase";
import { KeyboardInput, MobileScroll, useKeyboard } from "../../mobile";
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
  onUpdateErpData: (next: ErpWorkspaceData) => void;
  onToast: (msg: string) => void;
}) {
  const keyboard = useKeyboard();
  const suppliers = useMemo(() => {
    const list = accounts.filter((a) => a.category === "purchases");
    return list.length > 0 ? list : accounts;
  }, [accounts]);

  const [creatingPo, setCreatingPo] = useState(false);
  const [supplierId, setSupplierId] = useState(() => suppliers[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(
    () => warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "",
  );
  const [itemId, setItemId] = useState(() => inventory[0]?.id ?? "");
  const [qty, setQty] = useState("10");
  const [unitCost, setUnitCost] = useState(() => inventory[0]?.legacyRef ? "" : String(inventory[0]?.avgCost ?? ""));
  const [notes, setNotes] = useState("");
  const [receivingPoId, setReceivingPoId] = useState<string | null>(null);

  const totalOpenValue = useMemo(
    () =>
      erpData.purchaseOrders
        .filter((p) => p.status !== "received")
        .reduce((s, p) => s + computePurchaseOrderTotal(p), 0),
    [erpData.purchaseOrders],
  );

  const handleCreatePo = () => {
    keyboard.hide();
    const supplier = suppliers.find((a) => a.id === supplierId) ?? suppliers[0];
    const wh = warehouses.find((w) => w.id === warehouseId) ?? warehouses[0];
    const invItem = inventory.find((i) => i.id === itemId) ?? inventory[0];
    if (!supplier || !wh || !invItem) {
      onToast("تأكد من اختيار المورد والمستودع والصنف");
      return;
    }
    const parsedQty = Math.max(1, Math.round(parsePositiveNumber(qty)));
    if (!unitCost.trim() || !Number.isFinite(Number(unitCost)) || Number(unitCost) <= 0) {
      onToast("أدخل تكلفة شراء معتمدة وصريحة؛ تكلفة الصنف التاريخي ليست سعرًا معتمدًا لأمر جديد.");
      return;
    }
    const parsedCost = parsePositiveNumber(unitCost);
    const nextNum = 101 + erpData.purchaseOrders.length;

    const newPo: ErpPurchaseOrder = {
      id: `po_${Date.now()}`,
      poNumber: `PO-2026-${nextNum}`,
      supplierAccountId: supplier.id,
      supplierName: supplier.name,
      warehouseId: wh.id,
      warehouseName: wh.name,
      currency,
      orderDate: new Date().toISOString().slice(0, 10),
      expectedDate: new Date().toISOString().slice(0, 10),
      status: "draft",
      lines: [
        {
          inventoryItemId: invItem.id,
          itemName: invItem.name,
          unit: invItem.unit,
          quantity: parsedQty,
          unitCost: parsedCost,
        },
      ],
      notes: notes.trim() || "طلب توريد مخزني",
    };
    onUpdateErpData({
      ...erpData,
      purchaseOrders: [newPo, ...erpData.purchaseOrders],
    });
    setCreatingPo(false);
    setNotes("");
    triggerHaptic("success");
    onToast(`تم إنشاء أمر الشراء ${newPo.poNumber}`);
  };

  const handleApprovePo = (poId: string) => {
    triggerHaptic("light");
    onUpdateErpData({
      ...erpData,
      purchaseOrders: erpData.purchaseOrders.map((po) =>
        po.id === poId ? { ...po, status: "approved" } : po,
      ),
    });
    onToast("تم اعتماد أمر الشراء — جاهز للاستلام بالمخزن");
  };

  const handleReceivePo = async (po: ErpPurchaseOrder) => {
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
      for (const line of po.lines) {
        const existing = inventory.find((i) => i.id === line.inventoryItemId);
        if (existing) {
          const avg = computeWeightedAvgCost(
            existing.quantity,
            existing.avgCost,
            line.quantity,
            line.unitCost,
          );
          await updateInventoryItem(uid, existing.id, {
            ...existing,
            quantity: avg.newQty,
            avgCost: avg.newAvgCost,
          });
        } else {
          await createInventoryItem(uid, {
            name: line.itemName,
            unit: line.unit,
            quantity: line.quantity,
            avgCost: line.unitCost,
            warehouseId: po.warehouseId,
          });
        }
      }

      const poTotal = computePurchaseOrderTotal(po);
      const supplier =
        accounts.find((a) => a.id === po.supplierAccountId) ?? suppliers[0] ?? accounts[0];
      const ledgerId = supplier
        ? await createLedgerEntry(uid, {
            accountId: supplier.id,
            accountName: supplier.name,
            kind: "invoice",
            typeLabel: "فاتورة شراء (PO)",
            payment: "credit",
            direction: "credit",
            amount: poTotal,
            currency: po.currency,
            exchangeRate: 1,
            details:
              `أمر شراء ${po.poNumber}\n` +
              po.lines.map((l) => `${l.itemName} | ${l.quantity} ${l.unit}`).join("\n"),
            documentNumber: po.poNumber,
            warehouseId: po.warehouseId,
            warehouseName: po.warehouseName,
            invoiceContent: "items",
            entryDate: new Date().toISOString().slice(0, 10),
            expenseCategory: "مشتريات بضائع",
          })
        : undefined;

      onUpdateErpData({
        ...erpData,
        purchaseOrders: erpData.purchaseOrders.map((item) =>
          item.id === po.id
            ? { ...item, status: "received", postedLedgerEntryId: ledgerId }
            : item,
        ),
      });
      triggerHaptic("success");
      onToast(`تم استلام ${po.poNumber} وتحديث المخزون وترحيل فاتورة المورد`);
    } catch {
      onToast("تعذر استلام أمر الشراء حاليًا");
    } finally {
      setReceivingPoId(null);
    }
  };

  const statusText: Record<ErpPurchaseOrder["status"], string> = {
    draft: "مسودة",
    approved: "معتمد",
    received: "تم الاستلام والترحيل",
  };

  return (
    <MobileScroll className="app-screen erp-scroll">
      <main className="erp-page" data-testid="erp-procurement-screen">
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

        <section className="erp-card">
          <div className="erp-card-head">
            <h3>أوامر الشراء والتوريد</h3>
            <button
              type="button"
              className="erp-chip-btn"
              onClick={() => {
                keyboard.hide();
                setCreatingPo((v) => !v);
              }}
            >
              <PlusIcon />
              <span>{creatingPo ? "إغلاق" : "أمر شراء جديد"}</span>
            </button>
          </div>

          {creatingPo ? (
            <div className="erp-inline-form">
              <div className="erp-form-row-2">
                <label className="erp-field">
                  <span>المورد</span>
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="erp-field">
                  <span>المستودع</span>
                  <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="erp-field">
                <span>الصنف المطلوب</span>
                <select
                  value={itemId}
                  onChange={(e) => {
                    setItemId(e.target.value);
                    const found = inventory.find((i) => i.id === e.target.value);
                    if (found) setUnitCost(found.legacyRef ? "" : String(found.avgCost));
                  }}
                >
                  {inventory.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.quantityUnverified ? "بحاجة إلى تسوية" : `متاح: ${i.quantity}`})
                    </option>
                  ))}
                </select>
              </label>
              <div className="erp-form-row-2">
                <KeyboardInput
                  inputMode="decimal"
                  placeholder="الكمية"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
                <KeyboardInput
                  inputMode="decimal"
                  placeholder="تكلفة الوحدة"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                />
              </div>
              <KeyboardInput
                placeholder="ملاحظات التوريد (اختياري)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <button type="button" className="erp-primary-btn full" onClick={handleCreatePo}>
                إنشاء أمر الشراء
              </button>
            </div>
          ) : null}

          <div className="erp-list">
            {erpData.purchaseOrders.map((po) => {
              const poTotal = computePurchaseOrderTotal(po);
              return (
                <article key={po.id} className="erp-row-card">
                  <div className="erp-row-main">
                    <div>
                      <strong>{po.poNumber} · {po.supplierName}</strong>
                      <small>{po.warehouseName} · <bdi>{po.orderDate}</bdi></small>
                    </div>
                    <div className="erp-row-value">
                      <strong><bdi>{formatAmount(poTotal)}</bdi></strong>
                      <small>{po.currency}</small>
                    </div>
                  </div>
                  <div className="erp-po-lines">
                    {po.lines.map((line, idx) => (
                      <div key={idx} className="erp-po-line">
                        <span>{line.itemName}</span>
                        <span>
                          <bdi>{line.quantity}</bdi> {line.unit} × <bdi>{formatAmount(line.unitCost)}</bdi>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="erp-row-meta">
                    <span className={`erp-status-text status-${po.status === "received" ? "approved" : "pending"}`}>
                      الحالة: {statusText[po.status]}
                    </span>
                  </div>
                  <div className="erp-inline-actions">
                    {po.status === "draft" ? (
                      <button
                        type="button"
                        className="erp-secondary-btn"
                        onClick={() => handleApprovePo(po.id)}
                      >
                        اعتماد الأمر
                      </button>
                    ) : null}
                    {po.status !== "received" ? (
                      <button
                        type="button"
                        className="erp-primary-btn"
                        disabled={receivingPoId === po.id}
                        onClick={() => handleReceivePo(po)}
                        data-testid={`erp-receive-${po.id}`}
                      >
                        <CheckCircledIcon />
                        <span>
                          {receivingPoId === po.id
                            ? "جاري الاستلام..."
                            : "استلام بالمخزن وترحيل الفاتورة"}
                        </span>
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </MobileScroll>
  );
}
