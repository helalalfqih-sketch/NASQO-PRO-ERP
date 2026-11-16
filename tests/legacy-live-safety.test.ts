import test from "node:test";
import assert from "node:assert/strict";
import { approvedLiveSellingPrice, canReceiveAgainstExistingStock, canSellFromVerifiedStock } from "../src/legacy/liveSafety";
import { sanitizeInventoryPayload } from "../src/accounting";
import type { InventoryItemRecord } from "../src/types";

const imported: InventoryItemRecord = {
  id: "lg123_inv_7", ownerId: "local-erp-workspace", name: "منتج تراثي", unit: "حبة",
  quantity: 0, avgCost: 900, warehouseId: "lg123_wh_1", quantityUnverified: true,
  legacyRef: "abc123def456:products:7",
};

test("legacy products never receive an inferred selling price or approved stock", () => {
  assert.equal(approvedLiveSellingPrice(imported), null);
  assert.equal(canSellFromVerifiedStock(imported), false);
  assert.equal(canReceiveAgainstExistingStock(imported), false);
  assert.equal(canSellFromVerifiedStock({ ...imported, quantity: 7, quantityUnverified: false }), false);
  assert.equal(canSellFromVerifiedStock({ ...imported, quantity: 7, sellingPrice: 200 }), false);
});

test("stocktake and explicitly approved retail price unlock only the reconciled item", () => {
  const reconciled = { ...imported, quantity: 7, quantityUnverified: false, sellingPrice: 200 };
  const clean = sanitizeInventoryPayload(reconciled);
  assert.equal(clean.quantityUnverified, undefined);
  assert.equal(clean.sellingPrice, 200);
  assert.equal(clean.quantity, 7);
  assert.equal(canReceiveAgainstExistingStock(reconciled), true);
  assert.equal(approvedLiveSellingPrice(reconciled), 200);
  assert.equal(canSellFromVerifiedStock(reconciled), true);
});
