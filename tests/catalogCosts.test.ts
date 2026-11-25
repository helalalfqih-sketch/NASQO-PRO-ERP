import test from "node:test";
import assert from "node:assert/strict";
import { getCatalogReferenceCost } from "../src/utils/catalogCosts";

test("native reference survives zero operational cost without changing approval or stock", () => {
  const item = Object.freeze({ legacyCatalogCost: 37, quantityUnverified: true, avgCost: 0, quantity: 0 });
  assert.equal(getCatalogReferenceCost(item), 37);
  assert.equal(item.avgCost, 0);
  assert.equal(item.quantityUnverified, true);
});

test("old web catalog cost requires both unverified state and exact product provenance", () => {
  const old = { quantityUnverified: true, legacyRef: "abcdef012345:products:17", avgCost: 12 };
  assert.equal(getCatalogReferenceCost(old), 12);
  assert.equal(getCatalogReferenceCost({ ...old, quantityUnverified: false }), undefined);
  assert.equal(getCatalogReferenceCost({ ...old, legacyRef: "abcdef012345:customers:17" }), undefined);
  assert.equal(getCatalogReferenceCost({ ...old, legacyRef: undefined }), undefined);
});

test("explicit zero reference is retained and does not fall back to another price", () => {
  assert.equal(getCatalogReferenceCost({ legacyCatalogCost: 0, avgCost: 19, quantityUnverified: true }), 0);
  assert.equal(getCatalogReferenceCost({ legacyCatalogCost: NaN, avgCost: 19, quantityUnverified: true }), undefined);
});
