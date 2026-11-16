/** Financially conservative guards for migrated stock in live screens.
 * Legacy quantity and selling price are not approved merely because an archive exists.
 */
import type { InventoryItemRecord } from "../types";

export function requiresStockReconciliation(item: InventoryItemRecord): boolean {
  return Boolean(item.quantityUnverified);
}

export function approvedLiveSellingPrice(item: InventoryItemRecord): number | null {
  const explicit = item.sellingPrice;
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) return explicit;
  // Existing non-legacy POS pricing stays backwards-compatible. Never compute
  // a legacy product's price from cost: price2 has not been independently approved.
  if (item.legacyRef) return null;
  const previousApplicationPrice = Math.round(item.avgCost * 1.25);
  return Number.isFinite(previousApplicationPrice) && previousApplicationPrice > 0
    ? previousApplicationPrice : null;
}

export function canSellFromVerifiedStock(item: InventoryItemRecord): boolean {
  return !requiresStockReconciliation(item) && item.quantity > 0 && approvedLiveSellingPrice(item) !== null;
}

export function canReceiveAgainstExistingStock(item: InventoryItemRecord): boolean {
  return !requiresStockReconciliation(item);
}
