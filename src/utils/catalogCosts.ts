import type { InventoryItemRecord } from "../types";

/** Display/export reference only. Never use this value to approve or value stock. */
export function getCatalogReferenceCost(
  item: Pick<InventoryItemRecord, "legacyCatalogCost" | "quantityUnverified" | "legacyRef" | "avgCost">,
): number | undefined {
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
