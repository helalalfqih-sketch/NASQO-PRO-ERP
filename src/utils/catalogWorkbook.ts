import type { InventoryItemRecord } from "../types";
import { getCatalogReferenceCost } from "./catalogCosts";

export function catalogCardsForReport(items: readonly InventoryItemRecord[], selected?: ReadonlySet<string>): InventoryItemRecord[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const cards = new Map<string, InventoryItemRecord>();
  for (const item of items) {
    if (selected && !selected.has(item.id)) continue;
    const id = item.catalogSourceItemId || item.legacySourceItemId || item.id;
    if (!cards.has(id)) cards.set(id, byId.get(id) || item);
  }
  return [...cards.values()];
}

export function catalogCardRows(items: readonly InventoryItemRecord[]) {
  return [
    ["رقم الصنف", "اسم الصنف", "الباركود", "الوحدة", "سعر الشراء", "سعر البيع", "العملة", "الوحدة 2", "count2", "سعر البيع 2", "الوحدة 3", "count3", "سعر البيع 3", "الوحدة الافتراضية", "الحالة", "حد الطلب", "تاريخ الانتهاء"],
    ...catalogCardsForReport(items).map(item => [
      item.legacyId ?? item.id, item.name, item.sku ?? "", item.unit,
      getCatalogReferenceCost(item) ?? "", item.sellingPrice ?? "", item.currencyCode || "ريال",
      item.unit2 || "", item.unit2 ? item.count2 ?? "" : "", item.unit2 ? item.sprice2 ?? "" : "",
      item.unit3 || "", item.unit3 ? item.count3 ?? "" : "", item.unit3 ? item.sprice3 ?? "" : "",
      item.defaultUnit ?? 1, item.isActive === false ? "خامل" : "نشط", item.minThreshold ?? "", item.expiryDate || "",
    ]),
  ];
}
