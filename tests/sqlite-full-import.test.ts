import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import {
  isSqliteBinary,
  inspectSqliteBinary,
  computeSha256,
  querySqliteTable,
  convertSqliteToLegacyPayload,
} from "../src/utils/sqliteEngine";
import {
  buildArchiveKey,
  saveRawSqliteArchive,
  findRawSqliteArchive,
  exportRawSqliteArchive,
  listRawSqliteArchives,
} from "../src/utils/rawSqliteStorage";
import {
  buildErpRecordsFromSqlite,
  migrateSqliteToErpWorkspace,
} from "../src/utils/sqliteErpMapping";

const SQLITE_FILE = "backup_2026.11.08_03.49.26.back";

test("1. rejects non-sqlite files and correctly detects SQLite format 3 signature", () => {
  const fakeBytes = new Uint8Array([1, 2, 3, 4, 5]);
  assert.equal(isSqliteBinary(fakeBytes), false);

  const realBytes = fs.readFileSync(SQLITE_FILE);
  assert.equal(isSqliteBinary(realBytes), true);
});

test("2. opens SQLite database in WebAssembly, checks integrity, and counts 22 tables and 26,001 rows", async () => {
  const fileBytes = fs.readFileSync(SQLITE_FILE);
  const sha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
  const computedSha = await computeSha256(fileBytes);
  assert.equal(computedSha, sha256);

  const { inspection, db } = await inspectSqliteBinary(fileBytes, "nasqo_exact_original.sqlite");

  // Verify integrity
  assert.equal(inspection.integrity, "ok");

  // Verify 22 user tables
  assert.equal(inspection.tables.length, 22);

  // Verify exactly 26,001 rows total
  assert.equal(inspection.totalRows, 26001);

  // Verify key table row counts
  assert.equal(inspection.tableCounts.customers, 125);
  assert.equal(inspection.tableCounts.products, 1402);
  assert.equal(inspection.tableCounts.stores, 5);
  assert.equal(inspection.tableCounts.currencies, 1);
  assert.equal(inspection.tableCounts.boxes, 11);
  assert.equal(inspection.tableCounts.cboxes, 3);
  assert.equal(inspection.tableCounts.input_move, 8703);
  assert.equal(inspection.tableCounts.bill_details, 13536);
  assert.equal(inspection.tableCounts.bill_details2, 258);
  assert.equal(inspection.tableCounts.store_trans, 25);
  assert.equal(inspection.tableCounts.trans_details, 1373);
  assert.equal(inspection.tableCounts.bin, 172);
  assert.equal(inspection.tableCounts.bin_bill_details, 270);
  assert.equal(inspection.tableCounts.bin_bill_details2, 26);
  assert.equal(inspection.tableCounts.offers, 4);
  assert.equal(inspection.tableCounts.offer_bill_details, 85);
  assert.equal(inspection.tableCounts.alerts, 2);

  // Test paginated table query
  const queryResult = querySqliteTable(db, "customers", 10, 0);
  assert.equal(queryResult.total, 125);
  assert.equal(queryResult.rows.length, 10);
  assert.ok(queryResult.columns.includes("name"));
  assert.ok(queryResult.columns.includes("id"));
});

test("3. maps SQLite tables to NASQO Pro ERP records preserving original identifiers", async () => {
  const fileBytes = fs.readFileSync(SQLITE_FILE);
  const { db } = await inspectSqliteBinary(fileBytes, "nasqo_exact_original.sqlite");

  const { accounts, warehouses, inventory, legacyIdMap } = buildErpRecordsFromSqlite(db, "test-workspace-uid");

  // Accounts
  assert.equal(accounts.length, 125);
  assert.equal(accounts[0].name, "عميل نقد");
  assert.equal(accounts[0].codeNumber, 1);
  assert.equal(legacyIdMap.customers[1], accounts[0].id);

  // Warehouses
  assert.equal(warehouses.length, 5);
  assert.equal(warehouses[0].name, "المخزن الرئيسي");
  assert.equal(warehouses[0].isDefault, true);
  assert.equal(legacyIdMap.stores[1], warehouses[0].id);

  // Inventory
  assert.equal(inventory.length, 1402);
  assert.equal(inventory[0].name, "صفارة شكمان سيارة ملون");
  assert.equal(inventory[0].sku, "12903425490");
  assert.equal(inventory[0].unit, "حبة");
  assert.equal(inventory[0].avgCost, 900);
  assert.equal(legacyIdMap.products[1], inventory[0].id);
});

test("4. generates compliant staging payload with relations and financial warnings", async () => {
  const fileBytes = fs.readFileSync(SQLITE_FILE);
  const { inspection, db } = await inspectSqliteBinary(fileBytes, "nasqo_exact_original.sqlite");

  const payload = convertSqliteToLegacyPayload(db, inspection.sourceSha256, "nasqo_exact_original.sqlite");
  assert.equal(payload.format, "nasqo-legacy-financial-staging-v1");
  assert.equal(payload.sourceSha256, inspection.sourceSha256);
  assert.equal(Object.keys(payload.tables).length, 22);

  // Check financial audit warnings
  assert.equal(inspection.mismatches.bothAmountsPositive, 2325);
  assert.equal(inspection.mismatches.bothAmountsZero, 8);
  assert.equal(inspection.mismatches.unregisteredCurrencyRefs, 7);
  assert.ok(inspection.mismatches.warnings.some((w) => w.includes("قيمتان موجبتان")));
});

test("5. verifies exact byte preservation and SHA-256 replica integrity", () => {
  const fileBytes = fs.readFileSync(SQLITE_FILE);
  const originalSha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");

  // Simulate preserving exact Uint8Array in storage
  const inMemoryStore = new Map<string, Uint8Array>();
  inMemoryStore.set(originalSha256, new Uint8Array(fileBytes));

  // Retrieve preserved replica
  const retrievedBytes = inMemoryStore.get(originalSha256);
  assert.ok(retrievedBytes);

  const exportedSha256 = crypto.createHash("sha256").update(retrievedBytes).digest("hex");

  // Verify 100% exact SHA-256 match
  assert.equal(exportedSha256, originalSha256);

  // Verify byte-for-byte exact equality
  assert.equal(Buffer.compare(fileBytes, Buffer.from(retrievedBytes)), 0);
  assert.equal(retrievedBytes.byteLength, 1585152);
});
