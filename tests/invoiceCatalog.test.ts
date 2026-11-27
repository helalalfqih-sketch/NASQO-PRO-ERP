import test from "node:test";
import assert from "node:assert/strict";
import { findInvoiceCatalogItems, invoiceItemAtWarehouse, invoiceItemStockLocations, invoiceUnitMatches } from "../src/utils/invoiceCatalog";
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

test("warehouse changes and cashier shortcuts resolve explicit families without moving quantities", () => {
  for (const link of ["legacySourceItemId", "catalogSourceItemId"] as const) {
    const source = item("source", "branch", { quantity: 4, sku: "SKU" });
    const selected = item("location", "selected", { [link]: source.id, quantity: 9, sku: source.sku });
    const unrelated = item("unrelated", "missing", { quantity: 30, sku: source.sku });
    const records = [source, selected, unrelated];
    const before = JSON.stringify(records);
    assert.equal(invoiceItemAtWarehouse(records, source, "selected", true), selected);
    assert.equal(invoiceItemAtWarehouse(records, selected, "branch", true), source);
    assert.equal(invoiceItemAtWarehouse(records, source, "missing", true), source);
    assert.equal(invoiceItemAtWarehouse(records, source, "", true), source);
    assert.equal(invoiceItemAtWarehouse(records, source, "selected", false), source);
    assert.equal(JSON.stringify(records), before);
  }
});

test("available warehouses include only known, positive, usable balances of the same product", () => {
  const source = item("source", "branch", { quantity: 4 });
  const location = item("location", "selected", { legacySourceItemId: "source", quantity: 9 });
  const extra = [
    item("unverified", "other", { legacySourceItemId: "source", quantity: 10, quantityUnverified: true }),
    item("cost", "other", { legacySourceItemId: "source", quantity: 10, costUnverified: true }),
    item("zero", "other", { legacySourceItemId: "source", quantity: 0 }),
    item("negative", "other", { legacySourceItemId: "source", quantity: -2 }),
    item("inactive", "other", { legacySourceItemId: "source", quantity: 10, isActive: false }),
    item("unrelated", "other", { quantity: 10 }),
  ];
  assert.deepEqual(invoiceItemStockLocations([source, location, ...extra], location), [source, location]);
});

test("switching a warehouse never silently changes an invoice unit conversion", () => {
  const source = item("source", "branch", { unit2: "كرتون", count2: 12, unit3: "صندوق", count3: 2 });
  const target = { ...source, id: "location", warehouseId: "selected" };
  assert.equal(invoiceUnitMatches(source, target, 3), true);
  assert.equal(invoiceUnitMatches(source, { ...target, count2: 6 }, 1), true);
  assert.equal(invoiceUnitMatches(source, { ...target, count2: 6 }, 2), false);
  assert.equal(invoiceUnitMatches(source, { ...target, count3: 3 }, 3), false);
  assert.equal(invoiceUnitMatches(source, { ...target, unit: "كيلو" }, 1), false);
  assert.equal(invoiceUnitMatches(source, { ...target, count2: 0 }, 2), false);
});
