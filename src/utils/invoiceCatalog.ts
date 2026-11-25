import { matchesArabicSearch, normalizeArabicSearch } from "../accounting";
import type { InventoryItemRecord } from "../types";

/** Catalog lookup only: returns existing records and never approves or changes stock. */
export function findInvoiceCatalogItems(
  inventory: readonly InventoryItemRecord[], query: string, warehouseId: string, hybridLocal: boolean,
): InventoryItemRecord[] {
  const normalized = normalizeArabicSearch(query);
  if (!normalized) return [];
  const families = new Map<string, InventoryItemRecord[]>();
  for (const item of inventory) {
    // Imported warehouse balances can have distinct operational IDs. Only an
    // explicit source link joins them; matching names/SKUs do not imply identity.
    const family = hybridLocal ? item.legacySourceItemId || item.id : item.id;
    const variants = families.get(family) ?? [];
    variants.push(item);
    families.set(family, variants);
  }
  const candidates: InventoryItemRecord[] = [];
  const preference = (item: InventoryItemRecord, family: string) => {
    if (warehouseId && item.warehouseId === warehouseId) return item.quantityUnverified === true ? 1 : 0;
    return item.id === family ? 2 : 3;
  };
  for (const [family, variants] of families) {
    if (!variants.some((item) => matchesArabicSearch(
      `${item.name} ${item.sku ?? ""} ${item.legacyId ?? ""} ${item.id} ${item.legacySourceItemId ?? ""} ${item.unit} ${item.unit2 ?? ""} ${item.unit3 ?? ""}`,
      normalized,
    ))) continue;
    candidates.push(variants.reduce((best, item) => preference(item, family) < preference(best, family) ? item : best));
  }
  return candidates.sort((a, b) => {
    const aExact = a.sku?.toLowerCase() === normalized || String(a.legacyId ?? "") === normalized ? 0 : 1;
    const bExact = b.sku?.toLowerCase() === normalized || String(b.legacyId ?? "") === normalized ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aPrefix = normalizeArabicSearch(a.name).startsWith(normalized) ? 0 : 1;
    const bPrefix = normalizeArabicSearch(b.name).startsWith(normalized) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return Number(b.warehouseId === warehouseId) - Number(a.warehouseId === warehouseId);
  }).slice(0, 10);
}
