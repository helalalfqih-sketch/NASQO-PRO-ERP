import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { LegacyDatabaseAdapter } from "../src/legacy/adapter";
import { indexHistoricalInvoices, searchHistoricalInvoices } from "../src/legacy/search";
import { getActiveArchiveInfo } from "../src/legacy/centerService";
import { importArchive, openCenterDb, putSetting } from "../src/legacy/store";
import type { Tables } from "../src/legacy/adapter";
import type { RoleMapping } from "../src/legacy/analysis";

const sample: Tables = {
  customers: [{ id: 5, name: "علي الأحمد" }],
  products: [{ id: 9, name: "فلتر زيت", barcode: "BAR-123" }],
  input_move: [{ id: 21, bill: "INV-500", bill_type: 2, per_id: 5, year: 2026, month: 1, day: 4 }],
  bill_details: [{ id: 34, bill_id: 21, prod_id: 9, amount: 2, price: 50 }],
  bill_details2: [{ id: 35, bill_id: 21, details: "خدمة تركيب" }],
  bin: [{ id: 31, bill: "DELETED-42", bill_type: 2, per_id: 5 }],
  bin_bill_details: [{ id: 39, bill_id: 31, prod_id: 9 }],
  bin_bill_details2: [],
};

test("invoice index joins real headers, lines, customer, product and barcode without guessing role", () => {
  const hits = indexHistoricalInvoices(sample, {});
  assert.equal(hits.length, 2);
  assert.equal(hits[0].lineCount, 2);
  assert.equal(hits[1].table, "bin");
  assert.deepEqual(hits.map((hit) => hit.role), ["unknown", "unknown"]);
  assert.equal(searchHistoricalInvoices(hits, "INV-500").length, 1);
  assert.equal(searchHistoricalInvoices(hits, "علي الاحمد").length, 2);
  assert.equal(searchHistoricalInvoices(hits, "BAR-123").length, 2);
  assert.equal(searchHistoricalInvoices(hits, "فلتر زيت").length, 2);
  assert.equal(searchHistoricalInvoices(hits, "خدمة تركيب").length, 1);
  assert.equal(searchHistoricalInvoices(hits, "DELETED-42")[0].table, "bin");
  assert.equal(searchHistoricalInvoices(hits, "", "sale").length, 0);
  const roles: RoleMapping = { "2": { role: "sale", confirmed: true } };
  assert.equal(searchHistoricalInvoices(indexHistoricalInvoices(sample, roles), "", "sale").length, 2);
});

test("historical archive remains visible only to its bound workspace and source reference", async () => {
  const db = await openCenterDb();
  const sha = "a".repeat(64);
  await importArchive(db, sha, sample);
  await putSetting(db, "activeArchive:alice", sha);
  db.close();
  assert.equal((await getActiveArchiveInfo("alice"))?.sha256, sha);
  assert.equal(await getActiveArchiveInfo("bob"), null);
  assert.equal((await getActiveArchiveInfo("alice", `${sha.slice(0, 12)}:customers:5`))?.sha256, sha);
  assert.equal(await getActiveArchiveInfo("alice", `bbbbbbbbbbbb:customers:5`), null);
});

const realFile = process.env.NASQO_LEGACY_SQLITE_PATH;
if (realFile) {
  test("real 22-table SQLite supports source-backed invoice and product search", async () => {
    const adapter = await LegacyDatabaseAdapter.open(new Uint8Array(readFileSync(realFile)), "original.sqlite");
    try {
      const schema = adapter.schema();
      assert.equal(schema.tableCount, 22);
      assert.equal(schema.totalRows, 26001);
      const tables = adapter.loadAll();
      const hits = indexHistoricalInvoices(tables, {});
      const withProduct = hits.find((hit) => hit.table === "input_move" && (tables.bill_details ?? []).some((l) => String(l.bill_id) === String(hit.row.id)));
      assert.ok(withProduct);
      const line = tables.bill_details.find((l) => String(l.bill_id) === String(withProduct.row.id));
      const product = tables.products.find((p) => String(p.id) === String(line?.prod_id));
      assert.ok(product?.name);
      assert.ok(searchHistoricalInvoices(hits, String(product.name)).some((hit) => hit.row.id === withProduct.row.id && hit.table === withProduct.table));
      const bin = hits.find((hit) => hit.table === "bin");
      assert.ok(bin, "historically deleted invoice with real lines must be discoverable");
      assert.equal(searchHistoricalInvoices(hits, "", "sale").length, 0);
      console.log(`Source-backed historical invoices: ${hits.length}, including ${hits.filter((h) => h.table === "bin").length} archived/deleted`);
    } finally { adapter.close(); }
  });
}
