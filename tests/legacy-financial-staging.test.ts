import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectLegacyFinancialArchive,
  stageLegacyFinancialArchive,
  findStagedLegacyArchive,
  LEGACY_ARCHIVE_DB,
  LEGACY_ARCHIVE_DB_VERSION,
} from "../src/utils/legacyFinancialStaging";

function fixture() {
  return {
    format: "nasqo-legacy-financial-staging-v1",
    sourceSha256: "a".repeat(64),
    sourceName: "backup.back",
    sourceUserVersion: 28,
    tables: {
      customers: { rows: [{ id: 1, name: "عميل" }] },
      products: { rows: [{ id: 2, name: "صنف" }] },
      stores: { rows: [{ id: 3, name: "مخزن" }] },
      currencies: { rows: [{ id: 1, name: "ريال" }] },
      input_move: {
        rows: [
          { id: 9, per_id: 1, cur: 1, bill_type: 2, dain: "50", madin: "50" },
          { id: 10, per_id: 1, cur: 3, bill_type: 3, dain: "0", madin: "100" },
        ],
      },
      bill_details: { rows: [{ id: 11, bill_id: 9, prod_id: 2, amount: 4 }] },
      bill_details2: { rows: [{ id: 12, bill_id: 9, total: "200" }] },
      offers: { rows: [] },
      store_trans: { rows: [] },
      bin: { rows: [{ id: 6, bill_type: 9 }] },
    },
  };
}

test("inspects historical invoices and preserves source data unchanged", () => {
  const data = fixture();
  const before = JSON.stringify(data);
  const result = inspectLegacyFinancialArchive(data);
  assert.equal(result.totalRows, 9);
  assert.equal(result.tableCounts.input_move, 2);
  assert.equal(result.tableCounts.bill_details, 1);
  assert.equal(result.typeCounts["2"], 1);
  assert.equal(result.typeCounts["3"], 1);
  assert.equal(result.bothAmountsPositive, 1);
  assert.equal(result.unregisteredCurrencyRefs, 1);
  assert.equal(result.missingCustomerRefs, 0);
  assert.equal(result.missingInvoiceRefs, 0);
  assert.equal(JSON.stringify(data), before);
});

test("accepts the existing full extraction format", () => {
  const data = fixture();
  const preview = inspectLegacyFinancialArchive({ ...data, format: "legacy-sqlite-full-export-v1" });
  assert.equal(preview.payload.format, "legacy-sqlite-full-export-v1");
});

test("rejects invalid signatures and unsupported archive formats", () => {
  assert.throws(() => inspectLegacyFinancialArchive({ ...fixture(), format: "any-other-json" }));
  assert.throws(() => inspectLegacyFinancialArchive({ ...fixture(), sourceSha256: "invalid" }));
});

test("rejects missing required tables instead of partial import", () => {
  const data = fixture();
  const { products: _removed, ...withoutProducts } = data.tables;
  assert.throws(() => inspectLegacyFinancialArchive({ ...data, tables: withoutProducts }), /products/);
});

test("rejects duplicate table identifiers", () => {
  const data = fixture();
  data.tables.input_move.rows.push({ id: 9, per_id: 1, cur: 1, bill_type: 2, dain: "0", madin: "5" });
  assert.throws(() => inspectLegacyFinancialArchive(data), /تكرار/);
});

test("identifies broken foreign references for review", () => {
  const data = fixture();
  data.tables.bill_details.rows[0].prod_id = 999;
  const preview = inspectLegacyFinancialArchive(data);
  assert.equal(preview.missingProductRefs, 1);
  assert.ok(preview.warnings.some((w) => w.includes("مراجع مفقودة")));
});

test("never silently stages records outside a browser IndexedDB runtime", async () => {
  assert.equal(LEGACY_ARCHIVE_DB, "nasqo_legacy_historical_archive");
  assert.equal(LEGACY_ARCHIVE_DB_VERSION, 1);
  const preview = inspectLegacyFinancialArchive(fixture());
  await assert.rejects(() => stageLegacyFinancialArchive("local-erp-workspace", preview), /IndexedDB/);
  await assert.rejects(() => findStagedLegacyArchive("local-erp-workspace", preview.sourceSha256), /IndexedDB/);
});
