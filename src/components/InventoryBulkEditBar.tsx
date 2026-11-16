import { useState } from "react";
import { CheckCircledIcon, Cross2Icon, Pencil1Icon } from "@radix-ui/react-icons";
import { parseArabicNumber } from "../accounting";
import { batchUpdateInventoryItems } from "../firebase";
import type { InventoryItemRecord } from "../types";
import { triggerHaptic } from "../utils/haptics";

interface InventoryBulkEditBarProps {
  uid: string;
  items: readonly InventoryItemRecord[];
  selectedIds: ReadonlySet<string>;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onNotify: (message: string) => void;
  onBatchUpdateItems?: (
    updates: {
      item: InventoryItemRecord;
      quantity: number;
      avgCost: number;
      sellingPrice?: number;
      minThreshold?: number;
      quantityUnverified?: boolean;
    }[],
  ) => Promise<void>;
}

export function InventoryBulkEditBar({
  uid,
  items,
  selectedIds,
  onToggleSelectAll,
  onClearSelection,
  onNotify,
  onBatchUpdateItems,
}: InventoryBulkEditBarProps) {
  const [priceMode, setPriceMode] = useState<"keep" | "set" | "percent">("keep");
  const [priceValue, setPriceValue] = useState("");
  const [sellingPriceValue, setSellingPriceValue] = useState("");
  const [confirmSellingPrice, setConfirmSellingPrice] = useState(false);
  const [stockMode, setStockMode] = useState<"keep" | "set" | "delta">("keep");
  const [stockValue, setStockValue] = useState("");
  const [minThresholdValue, setMinThresholdValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmStockCount, setConfirmStockCount] = useState(false);

  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const allSelected = items.length > 0 && selectedItems.length === items.length;

  const handleApply = async () => {
    if (selectedItems.length === 0) return;
    if (priceMode === "keep" && stockMode === "keep" && !sellingPriceValue.trim() && !minThresholdValue.trim()) {
      triggerHaptic("warning");
      onNotify("اختر حقلًا واحدًا على الأقل للتحديث الجماعي (السعر أو الكمية أو الحد الأدنى).");
      return;
    }

    const unverifiedSelected = selectedItems.some((item) => item.quantityUnverified);
    if (unverifiedSelected && stockMode === "delta") {
      onNotify("لا يمكن إضافة أو خصم كمية من رصيد غير معتمد. اختر تعيين كمية بناءً على جرد فعلي.");
      return;
    }
    if (unverifiedSelected && stockMode === "set" && (!stockValue.trim() || !confirmStockCount)) {
      onNotify("لتسوية رصيد مستورد: أدخل كمية الجرد الفعلية وأقر بصحتها أولًا.");
      return;
    }

    if (sellingPriceValue.trim()) {
      const price = parseArabicNumber(sellingPriceValue);
      if (!Number.isFinite(price) || price <= 0 || !confirmSellingPrice) {
        onNotify("أدخل سعر بيع موجبًا ومعتمدًا وأكّد مراجعته قبل تطبيقه على الأصناف.");
        return;
      }
    }

    const parsedPrice = parseArabicNumber(priceValue);
    const parsedStock = parseArabicNumber(stockValue);
    const hasThreshold = minThresholdValue.trim().length > 0;
    const parsedThreshold = Math.max(0, parseArabicNumber(minThresholdValue));

    const updates = selectedItems.map((item) => {
      let nextCost = item.avgCost;
      if (priceMode === "set" && priceValue.trim() !== "") {
        nextCost = Math.max(0, parsedPrice);
      } else if (priceMode === "percent" && priceValue.trim() !== "") {
        nextCost = Math.max(0, Math.round(item.avgCost * (1 + parsedPrice / 100) * 100) / 100);
      }

      let nextQty = item.quantity;
      if (stockMode === "set" && stockValue.trim() !== "") {
        nextQty = Math.max(0, parsedStock);
      } else if (stockMode === "delta" && stockValue.trim() !== "") {
        nextQty = Math.max(0, item.quantity + parsedStock);
      }

      return {
        item,
        avgCost: nextCost,
        ...(sellingPriceValue.trim() ? { sellingPrice: parseArabicNumber(sellingPriceValue) } : {}),
        quantity: nextQty,
        ...(stockMode === "set" && stockValue.trim() !== "" ? { quantityUnverified: false } : {}),
        ...(hasThreshold ? { minThreshold: parsedThreshold } : {}),
      };
    });

    setSaving(true);
    try {
      if (onBatchUpdateItems) {
        await onBatchUpdateItems(updates);
      } else {
        await batchUpdateInventoryItems(uid, updates);
      }
      triggerHaptic("success");
      onNotify(`تم تحديث ${updates.length} صنف دفعة واحدة في قاعدة البيانات`);
      setPriceValue("");
      setSellingPriceValue("");
      setConfirmSellingPrice(false);
      setStockValue("");
      setMinThresholdValue("");
      setPriceMode("keep");
      setStockMode("keep");
      setConfirmStockCount(false);
      onClearSelection();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="inv-bulk-card" aria-label="التعديل الجماعي للمخزون" data-testid="inventory-bulk-edit-bar">
      <div className="inv-bulk-head">
        <label className="inv-bulk-select-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => {
              triggerHaptic("light");
              onToggleSelectAll();
            }}
            data-testid="inventory-select-all-checkbox"
          />
          <span>
            {allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"} ({selectedItems.length} / {items.length})
          </span>
        </label>
        {selectedItems.length > 0 ? (
          <button type="button" className="inv-bulk-clear" onClick={onClearSelection}>
            <Cross2Icon />
            <span>مسح التحديد</span>
          </button>
        ) : null}
      </div>

      {selectedItems.length > 0 ? (
        <div className="inv-bulk-controls" data-testid="inventory-bulk-controls">
          <div className="inv-bulk-field">
            <label>
              <span>تحديث التكلفة / السعر</span>
              <select
                aria-label="نوع تعديل السعر"
                value={priceMode}
                onChange={(e) => setPriceMode(e.target.value as "keep" | "set" | "percent")}
              >
                <option value="keep">بدون تغيير</option>
                <option value="set">تعيين سعر ثابت</option>
                <option value="percent">تعديل بنسبة %</option>
              </select>
            </label>
            {priceMode !== "keep" ? (
              <input
                type="number"
                step="any"
                aria-label="قيمة تعديل السعر"
                placeholder={priceMode === "percent" ? "مثال: 10 أو -5" : "السعر الجديد"}
                value={priceValue}
                onChange={(e) => setPriceValue(e.target.value)}
                data-testid="bulk-price-input"
              />
            ) : null}
          </div>

          <div className="inv-bulk-field">
            <label>
              <span>سعر البيع التشغيلي (اختياري)</span>
              <input type="number" min={0} step="any" aria-label="سعر البيع المعتمد" placeholder="أدخل السعر المعتمد" value={sellingPriceValue} onChange={(e) => setSellingPriceValue(e.target.value)} />
            </label>
            {sellingPriceValue.trim() ? (
              <label style={{ display: "block", fontSize: 12, color: "#854d0e" }}>
                <input type="checkbox" aria-label="تأكيد اعتماد سعر البيع" checked={confirmSellingPrice} onChange={(e) => setConfirmSellingPrice(e.target.checked)} />
                أقر بأن سعر البيع أُدخل وراجعته يدويًا، وليس مستنتجًا من تكلفة SQLite.
              </label>
            ) : null}
          </div>
          <div className="inv-bulk-field">
            <label>
              <span>تحديث الكمية</span>
              <select
                aria-label="نوع تعديل الكمية"
                value={stockMode}
                onChange={(e) => setStockMode(e.target.value as "keep" | "set" | "delta")}
              >
                <option value="keep">بدون تغيير</option>
                <option value="set">تعيين كمية موحدة</option>
                <option value="delta">إضافة / خصم (±)</option>
              </select>
            </label>
            {stockMode !== "keep" ? (
              <input
                type="number"
                step="any"
                aria-label="قيمة تعديل الكمية"
                placeholder={stockMode === "delta" ? "مثال: +10 أو -3" : "الكمية الجديدة"}
                value={stockValue}
                onChange={(e) => setStockValue(e.target.value)}
                data-testid="bulk-stock-input"
              />
            ) : null}
          </div>

          <div className="inv-bulk-field">
            <label>
              <span>الحد الأدنى للتنبيه (اختياري)</span>
              <input
                type="number"
                min={0}
                aria-label="الحد الأدنى الجماعي"
                placeholder="اتركه فارغًا للإبقاء"
                value={minThresholdValue}
                onChange={(e) => setMinThresholdValue(e.target.value)}
                data-testid="bulk-threshold-input"
              />
            </label>
          </div>

          {selectedItems.some((item) => item.quantityUnverified) ? (
            <div role="status" style={{ fontSize: 12, color: "#854d0e" }}>
              أصناف مستوردة بحاجة إلى تسوية. لا يمكن حساب حركة نسبية على كمية غير معتمدة.
              {stockMode === "set" ? (
                <label style={{ display: "block", marginTop: 6 }}>
                  <input type="checkbox" checked={confirmStockCount} onChange={(e) => setConfirmStockCount(e.target.checked)} aria-label="تأكيد جرد المخزون الفعلي" />
                  أؤكد أن القيمة المحددة ناتجة عن جرد فعلي، وأوافق على اعتمادها رصيدًا تشغيليًا.
                </label>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="inv-bulk-apply"
            disabled={saving}
            onClick={handleApply}
            data-testid="bulk-apply-btn"
          >
            {saving ? (
              <span>جاري التطبيق...</span>
            ) : (
              <>
                <CheckCircledIcon />
                <span>تطبيق على {selectedItems.length} صنف</span>
              </>
            )}
          </button>
        </div>
      ) : (
        <p className="inv-bulk-hint">
          <Pencil1Icon /> حدّد صنفًا أو أكثر من الجدول لتعديل الأسعار أو الكميات دفعة واحدة.
        </p>
      )}
    </section>
  );
}
