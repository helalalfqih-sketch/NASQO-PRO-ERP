import { useMemo, useState } from "react";
import { CheckCircledIcon, PlusIcon, TrashIcon } from "@radix-ui/react-icons";
import { formatAmount, normalizeArabicSearch } from "../accounting";
import { createLedgerEntry } from "../firebase";
import { KeyboardInput, useKeyboard } from "../mobile";
import type {
  AccountRecord,
  CurrencyCode,
  InventoryItemRecord,
  LedgerEntryRecord,
  WarehouseRecord,
} from "../types";
import { triggerHaptic } from "../utils/haptics";
import { CustomerList } from "./CustomerList";
import { approvedLiveSellingPrice, requiresStockReconciliation } from "../legacy/liveSafety";

interface InvoiceItemRow {
  id: string;
  itemId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

interface InvoiceFormProps {
  open: boolean;
  uid: string;
  currency: CurrencyCode;
  accounts: readonly AccountRecord[];
  warehouses: readonly WarehouseRecord[];
  inventory: readonly InventoryItemRecord[];
  onClose: () => void;
  onToast: (msg: string) => void;
  onCreateLedgerEntry?: (
    entry: Omit<LedgerEntryRecord, "id" | "ownerId" | "createdAtMs">,
  ) => Promise<unknown>;
  onInvoiceCreated?: () => void;
}

export function InvoiceForm({
  open,
  uid,
  currency,
  accounts,
  warehouses,
  inventory,
  onClose,
  onToast,
  onCreateLedgerEntry,
  onInvoiceCreated,
}: InvoiceFormProps) {
  const keyboard = useKeyboard();
  const [customerName, setCustomerName] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState(
    () => accounts.find((a) => a.category === "sales" || a.category === "clients")?.id ?? accounts[0]?.id ?? "",
  );
  const [useCustomCustomer, setUseCustomCustomer] = useState(false);
  const [selectedWhId, setSelectedWhId] = useState(
    () => warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "",
  );
  const [payment, setPayment] = useState<"cash" | "credit">("cash");
  const [includeVat, setIncludeVat] = useState(true);
  const [productSearch, setProductSearch] = useState("");
  const [showCustomerListModal, setShowCustomerListModal] = useState(false);

  const [rows, setRows] = useState<InvoiceItemRow[]>([
    {
      id: `row_${Date.now()}`,
      itemId: inventory[0]?.id,
      productName: inventory[0]?.name ?? "",
      quantity: 1,
      unitPrice: inventory[0] ? (approvedLiveSellingPrice(inventory[0]) ?? 0) : 0,
    },
  ]);

  const [saving, setSaving] = useState(false);

  const salesAndClientAccounts = useMemo(() => {
    if (!open) return [];
    const preferred = accounts.filter((a) => a.category === "sales" || a.category === "clients");
    return preferred.length > 0 ? preferred : accounts;
  }, [accounts, open]);

  // Source-backed SKU is the barcode imported from the original SQLite.
  const matchingProducts = useMemo(() => {
    if (!open) return [];
    const q = normalizeArabicSearch(productSearch);
    return inventory.filter((item) => !q || normalizeArabicSearch(
      `${item.name} ${item.sku ?? ""} ${item.unit} ${item.legacyRef ?? ""}`,
    ).includes(q));
  }, [inventory, open, productSearch]);

  const rowProductOptions = useMemo(() => {
    if (!open) return [];
    const capped = matchingProducts.slice(0, 120);
    const seen = new Set(capped.map((i) => i.id));
    const selectedIds = new Set(rows.map((r) => r.itemId).filter(Boolean) as string[]);
    const extras: InventoryItemRecord[] = [];
    for (let i = 0; i < inventory.length; i += 1) {
      const item = inventory[i];
      if (selectedIds.has(item.id) && !seen.has(item.id)) {
        seen.add(item.id);
        extras.push(item);
      }
    }
    return extras.length > 0 ? [...extras, ...capped] : capped;
  }, [inventory, matchingProducts, open, rows]);

  const activeAccount = useMemo(
    () => salesAndClientAccounts.find((a) => a.id === selectedAccountId) ?? accounts[0],
    [accounts, salesAndClientAccounts, selectedAccountId],
  );

  const subtotal = useMemo(
    () => rows.reduce((sum, r) => sum + r.quantity * r.unitPrice, 0),
    [rows],
  );
  const vatAmount = includeVat ? Math.round(subtotal * 0.15 * 100) / 100 : 0;
  const grandTotal = subtotal + vatAmount;

  if (!open) return null;

  const handleAddRow = () => {
    triggerHaptic("light");
    const defaultItem = matchingProducts[0] ?? inventory[0];
    setRows((prev) => [
      ...prev,
      {
        id: `row_${Date.now()}_${Math.random()}`,
        itemId: defaultItem?.id,
        productName: defaultItem?.name ?? "",
        quantity: 1,
        unitPrice: defaultItem ? (approvedLiveSellingPrice(defaultItem) ?? 0) : 0,
      },
    ]);
  };

  const handleRemoveRow = (id: string) => {
    if (rows.length <= 1) {
      onToast("يجب أن تحتوي الفاتورة على صنف واحد على الأقل");
      return;
    }
    triggerHaptic("light");
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUpdateRow = (id: string, patch: Partial<InvoiceItemRow>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        if (patch.itemId) {
          const matched = inventory.find((item) => item.id === patch.itemId);
          if (matched) {
            next.productName = matched.name;
            next.unitPrice = approvedLiveSellingPrice(matched) ?? 0;
          }
        }
        return next;
      }),
    );
  };

  const handleSaveInvoice = async () => {
    keyboard.hide();
    const finalCustName = useCustomCustomer
      ? customerName.trim()
      : (activeAccount?.name ?? "عميل عام");

    if (!finalCustName) {
      onToast("أدخل اسم العميل أولًا");
      return;
    }
    if (rows.length === 0 || rows.some((r) => !r.productName.trim() || !Number.isFinite(r.quantity) || r.quantity <= 0 || !Number.isFinite(r.unitPrice) || r.unitPrice <= 0)) {
      onToast("حدد صنفًا حقيقيًا وتحقق من الكمية وأدخل سعر بيع موجبًا ومعتمدًا.");
      return;
    }
    const unresolvedStock = rows.find((r) => {
      const item = inventory.find((candidate) => candidate.id === r.itemId);
      return item && requiresStockReconciliation(item);
    });
    if (unresolvedStock) {
      onToast("لا يمكن ترحيل فاتورة لصنف مستورد قبل اعتماد جرد المخزون الفعلي.");
      return;
    }

    setSaving(true);
    try {
      const targetWh = warehouses.find((w) => w.id === selectedWhId) ?? warehouses[0];
      const detailsText =
        rows
          .map((r) => `${r.productName} | ${r.quantity} × ${formatAmount(r.unitPrice)}`)
          .join("\n") +
        (includeVat ? `\nضريبة القيمة المضافة 15%: ${formatAmount(vatAmount)}` : "");

      const entryPayload: Omit<LedgerEntryRecord, "id" | "ownerId" | "createdAtMs"> = {
        accountId: activeAccount?.id ?? "acc_sales_1",
        accountName: finalCustName,
        counterpartAccountId: "",
        counterpartAccountName: "",
        kind: "invoice",
        typeLabel: payment === "cash" ? "ف.مبيعات نقدية" : "ف.مبيعات آجل",
        payment,
        direction: "debit",
        amount: grandTotal,
        ...(includeVat && vatAmount > 0 ? { taxAmount: vatAmount } : {}),
        currency,
        exchangeRate: 1,
        details: detailsText,
        documentNumber: `INV-${Date.now().toString().slice(-6)}`,
        warehouseId: targetWh?.id ?? "wh_1",
        warehouseName: targetWh?.name ?? "المخزن الرئيسي",
        invoiceContent: "items",
        entryNumber: Math.floor(Math.random() * 90000) + 10000,
        deleted: false,
        entryDate: new Date().toISOString().slice(0, 10),
        lines: rows.map((r) => {
          const item = inventory.find((candidate) => candidate.id === r.itemId);
          return {
            ...(item ? { inventoryItemId: item.id, warehouseId: targetWh?.id ?? item.warehouseId } : { warehouseId: targetWh?.id }),
            itemName: r.productName.trim(),
            unit: item?.unit ?? "حبة",
            quantity: r.quantity,
            price: r.unitPrice,
            total: r.quantity * r.unitPrice,
          };
        }),
      };

      if (onCreateLedgerEntry) {
        await onCreateLedgerEntry(entryPayload);
      } else {
        await createLedgerEntry(uid, entryPayload);
      }

      triggerHaptic("success");
      onToast(`تمت إضافة الفاتورة (${formatAmount(grandTotal)} ${currency}) بنجاح`);
      if (onInvoiceCreated) onInvoiceCreated();
      onClose();
    } catch {
      onToast("حدث خطأ أثناء حفظ الفاتورة وإضافتها للمبيعات");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="center-modal-layer" data-testid="invoice-form-modal">
      <button
        type="button"
        className="center-modal-backdrop"
        onClick={() => {
          keyboard.hide();
          onClose();
        }}
        aria-label="إغلاق نموذج الفاتورة"
      />
      <section
        className="ref-dialog-card transfer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-form-title"
        style={{ maxWidth: "440px", padding: "10px", gap: "6px" }}
      >
        <div className="transfer-modal-head" style={{ marginBottom: "2px" }}>
          <h2 id="invoice-form-title" style={{ fontSize: "15px" }}>إصدار فاتورة مبيعات جديدة</h2>
          <button
            type="button"
            onClick={() => {
              keyboard.hide();
              onClose();
            }}
            style={{ background: "transparent", color: "var(--nasqo-blue)", fontWeight: "bold", fontSize: "14px" }}
          >
            ✕
          </button>
        </div>

        <div className="erp-card" style={{ margin: "2px 0", padding: "8px", gap: "6px" }}>
          <div className="erp-form-row-2">
            <label className="erp-field">
              <span>نوع العميل</span>
              <div className="erp-pill-switch" style={{ marginTop: "2px" }}>
                <button
                  type="button"
                  className={!useCustomCustomer ? "active" : ""}
                  onClick={() => setUseCustomCustomer(false)}
                  style={{ fontSize: "10px", minHeight: "28px" }}
                >
                  حساب مسجل
                </button>
                <button
                  type="button"
                  className={useCustomCustomer ? "active" : ""}
                  onClick={() => setUseCustomCustomer(true)}
                  style={{ fontSize: "10px", minHeight: "28px" }}
                >
                  اسم حر
                </button>
              </div>
            </label>
            <label className="erp-field">
              <span>المستودع</span>
              <select
                aria-label="مستودع الصرف"
                value={selectedWhId}
                onChange={(e) => setSelectedWhId(e.target.value)}
                style={{ fontSize: "11px", padding: "4px" }}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
            <span style={{ fontSize: "10px", color: "var(--nasqo-muted)" }}>اختر العميل</span>
            <button
              type="button"
              className="erp-chip-btn"
              onClick={() => {
                keyboard.hide();
                setShowCustomerListModal(true);
              }}
              style={{ padding: "3px 7px", background: "var(--nasqo-blue)", color: "#fff", borderRadius: "5px", fontSize: "10px", minHeight: "26px" }}
            >
              قائمة العملاء
            </button>
          </div>

          {useCustomCustomer ? (
            <div style={{ marginTop: "4px" }}>
              <KeyboardInput
                placeholder="اسم العميل أو الجهة"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
          ) : (
            <div style={{ marginTop: "4px" }}>
              <select
                aria-label="اختر حساب العميل"
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                style={{ width: "100%", padding: "6px", border: "1px solid #ccd9e6", borderRadius: "6px", fontSize: "11px" }}
              >
                {salesAndClientAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.category})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="erp-pos-toggles" style={{ marginTop: "6px" }}>
            <div className="erp-pill-switch" style={{ minHeight: "28px" }}>
              <button
                type="button"
                className={payment === "cash" ? "active" : ""}
                onClick={() => setPayment("cash")}
                style={{ fontSize: "10px", minHeight: "26px" }}
              >
                نقدي
              </button>
              <button
                type="button"
                className={payment === "credit" ? "active" : ""}
                onClick={() => setPayment("credit")}
                style={{ fontSize: "10px", minHeight: "26px" }}
              >
                آجل
              </button>
            </div>
            <label className="erp-checkbox" style={{ fontSize: "11px" }}>
              <input
                type="checkbox"
                checked={includeVat}
                onChange={(e) => setIncludeVat(e.target.checked)}
              />
              <span>ضريبة 15%</span>
            </label>
          </div>
        </div>

        <div className="erp-card" style={{ margin: "2px 0", padding: "8px" }}>
          <div className="erp-card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <h3 style={{ fontSize: "12px" }}>بنود الأصناف</h3>
            <button
              type="button"
              className="erp-chip-btn"
              onClick={handleAddRow}
              style={{ display: "flex", alignItems: "center", gap: "3px", padding: "3px 7px", background: "var(--nasqo-blue)", color: "#fff", borderRadius: "5px", fontSize: "10px", minHeight: "26px" }}
            >
              <PlusIcon />
              <span>إضافة صنف</span>
            </button>
          </div>

          {rows.some((row) => inventory.some((item) => item.id === row.itemId && (item.quantityUnverified || (item.legacyRef && !item.sellingPrice)))) ? (
            <p role="status" style={{ color: "#92400e", fontSize: 11, margin: "4px 0" }}>
              يلزم اعتماد الجرد وسعر البيع للصنف المحدد من شاشة المخزون قبل البيع.
            </p>
          ) : null}
          <label style={{ display: "grid", gap: 4, margin: "4px 0 8px", fontSize: 11, color: "var(--nasqo-muted)" }}>
            ابحث عن الصنف أو الباركود
            <KeyboardInput
              aria-label="البحث عن صنف أو باركود داخل الفاتورة"
              placeholder="اسم الصنف أو رقم الباركود..."
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
            />
            <small>{matchingProducts.length} صنف مطابق للبحث</small>
          </label>
          <div style={{ display: "grid", gap: "4px", maxHeight: "140px", overflowY: "auto" }}>
            {rows.map((row, idx) => (
              <div
                key={row.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 60px 80px 26px",
                  gap: "4px",
                  alignItems: "center",
                  background: "#f8fbff",
                  padding: "4px 6px",
                  borderRadius: "6px",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div>
                  <select
                    aria-label={`المنتح رقم ${idx + 1}`}
                    value={row.itemId ?? ""}
                    onChange={(e) => handleUpdateRow(row.id, { itemId: e.target.value })}
                    style={{ width: "100%", fontSize: "11px", padding: "3px" }}
                  >
                    <option value="">(صنف حر)</option>
                    {rowProductOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} {item.sku ? `• ${item.sku}` : ""} ({item.quantityUnverified ? "بحاجة إلى تسوية" : item.quantity})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <KeyboardInput
                    aria-label="الكمية"
                    inputMode="decimal"
                    placeholder="الكمية"
                    value={String(row.quantity)}
                    onChange={(e) =>
                      handleUpdateRow(row.id, { quantity: Math.max(1, Number(e.target.value) || 1) })
                    }
                  />
                </div>
                <div>
                  <KeyboardInput
                    aria-label="السعر"
                    inputMode="decimal"
                    placeholder="السعر"
                    value={String(row.unitPrice)}
                    onChange={(e) =>
                      handleUpdateRow(row.id, { unitPrice: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                </div>
                <button
                  type="button"
                  aria-label="حذف البند"
                  onClick={() => handleRemoveRow(row.id)}
                  style={{ display: "grid", placeItems: "center", color: "#d84949", background: "transparent", padding: 0 }}
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="erp-stmt-list" style={{ background: "#edf5fc", padding: "8px", borderRadius: "6px", margin: "2px 0", fontSize: "11px" }}>
          <div className="erp-stmt-row">
            <span>المجموع الفرعي</span>
            <strong><bdi>{formatAmount(subtotal)} {currency}</bdi></strong>
          </div>
          {includeVat ? (
            <div className="erp-stmt-row">
              <span>الضريبة (15%)</span>
              <strong><bdi>{formatAmount(vatAmount)} {currency}</bdi></strong>
            </div>
          ) : null}
          <div className="erp-stmt-row total">
            <span>الإجمالي النهائي</span>
            <strong className="pos"><bdi>{formatAmount(grandTotal)} {currency}</bdi></strong>
          </div>
        </div>

        <div className="ref-action-bar cols-2" style={{ marginTop: "6px" }}>
          <button
            type="button"
            className="ref-btn blue"
            disabled={saving}
            onClick={() => void handleSaveInvoice()}
            data-testid="invoice-form-save-btn"
            style={{ minHeight: "36px", fontSize: "12px" }}
          >
            <CheckCircledIcon />
            <span>{saving ? "جاري الحفظ..." : "حفظ الفاتورة"}</span>
          </button>
          <button
            type="button"
            className="ref-btn purple"
            onClick={() => {
              keyboard.hide();
              onClose();
            }}
            style={{ minHeight: "36px", fontSize: "12px" }}
          >
            إلغاء
          </button>
        </div>
      </section>
      <CustomerList
        open={showCustomerListModal}
        uid={uid}
        accounts={accounts}
        currency={currency}
        onClose={() => setShowCustomerListModal(false)}
        onSelectCustomer={(client) => {
          setSelectedAccountId(client.id);
          setUseCustomCustomer(false);
          onToast(`تم اختيار العميل: ${client.name}`);
        }}
        onToast={onToast}
      />
    </div>
  );
}
