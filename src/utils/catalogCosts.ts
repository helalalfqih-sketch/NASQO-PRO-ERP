import type { InventoryItemRecord } from "../types.ts";

/** Display/export reference only. Never use this value to approve or value stock. */
export function getCatalogReferenceCost(
  item: Pick<InventoryItemRecord, "catalogReferenceCost" | "legacyCatalogCost" | "quantityUnverified" | "legacyRef" | "avgCost">,
): number | undefined {
  if (item.catalogReferenceCost !== undefined && Number.isFinite(item.catalogReferenceCost)) return item.catalogReferenceCost;
  if (item.legacyCatalogCost !== undefined && Number.isFinite(item.legacyCatalogCost)) {
    return item.legacyCatalogCost;
  }
  // The original web importer kept price2 in avgCost. Recognize its explicit
  // source-table identity, without treating arbitrary unverified records alike.
  if (item.quantityUnverified === true && /^[a-f0-9]{12}:products:[^:]+$/i.test(item.legacyRef ?? "") &&
      Number.isFinite(item.avgCost)) {
    return item.avgCost;
  }
  return undefined;
}

/** Only priced operational purchases contribute while opening cost is pending. */
export function approvedInventoryValue(item: Pick<InventoryItemRecord, "quantityUnverified" | "costUnverified" | "approvedStockValue" | "quantity" | "avgCost">): number {
  if (item.quantityUnverified) return 0;
  if (item.costUnverified) return Number.isFinite(item.approvedStockValue) ? item.approvedStockValue ?? 0 : 0;
  return item.quantity * item.avgCost;
}
