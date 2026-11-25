import test from "node:test";
import assert from "node:assert/strict";
import { findInvoiceCatalogItems } from "../src/utils/invoiceCatalog";
import type { InventoryItemRecord } from "../src/types";

function item(id: string, warehouseId: string, extra: Partial<InventoryItemRecord> = {}): InventoryItemRecord {
  return { id, warehouseId, ownerId: "synthetic", name: "صنف تجريبي", unit: "حبة", quantity: 0, avgCost: 0, ...extra };
}

test("catalog includes unverified and other-warehouse products without changing stock", () => {
  const source = item("source", "other", { quantityUnverified: true, legacyHistoricalQtyByWarehouse: { selected: 37 } });
  const before = JSON.stringify(source);
  assert.equal(findInvoiceCatalogItems([source], "تجريبي", "selected", true)[0], source);
  assert.equal(JSON.stringify(source), before);
});

test("explicit imported family selects the existing approved selected-warehouse clone once", () => {
  const source = item("legacy-source", "old", { quantityUnverified: true, sku: "TEST-SKU" });
  const other = item("legacy-location-other", "other", { legacySourceItemId: source.id, quantityUnverified: false, sku: source.sku });
  const selected = item("legacy-location-selected", "selected", { legacySourceItemId: source.id, quantityUnverified: false, quantity: 12, avgCost: 8, sku: source.sku });
  for (const records of [[source, other, selected], [selected, source, other]]) {
    assert.deepEqual(findInvoiceCatalogItems(records, "TEST-SKU", "selected", true), [selected]);
    assert.deepEqual(findInvoiceCatalogItems(records, "legacy-source", "selected", true), [selected]);
  }
  assert.equal(selected.quantity, 12);
});

test("same warehouse unverified source stays selectable when no approved clone exists", () => {
  const source = item("source", "selected", { quantityUnverified: true });
  const other = item("other", "other", { legacySourceItemId: "source", quantityUnverified: false });
  assert.deepEqual(findInvoiceCatalogItems([other, source], "تجريبي", "selected", true), [source]);
});

test("identical names and SKUs do not collapse unrelated catalog records", () => {
  const first = item("first", "selected", { sku: "SAME" });
  const second = item("second", "selected", { sku: "SAME" });
  assert.deepEqual(findInvoiceCatalogItems([first, second], "SAME", "selected", true), [first, second]);
  assert.deepEqual(findInvoiceCatalogItems([first, second], "", "selected", true), []);
});
