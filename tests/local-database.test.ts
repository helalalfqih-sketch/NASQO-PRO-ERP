import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LOCAL_DB_NAME,
  LOCAL_DB_VERSION,
  clearLocalDatabase,
  exportIndexedDbSnapshot,
  getLocalDatabaseStats,
  isIndexedDbAvailable,
  readErpDataFromIndexedDb,
  readSnapshotFromIndexedDb,
  saveErpDataToIndexedDb,
} from "../src/utils/localDatabase";
import { createDefaultErpData, createEmptyErpData, saveErpWorkspaceData } from "../src/erp";

test("localDatabase metadata and non-browser guards behave safely in Node", async () => {
  assert.equal(LOCAL_DB_NAME, "nasqo_pro_erp_db");
  assert.equal(LOCAL_DB_VERSION, 2);
  assert.equal(isIndexedDbAvailable(), false);

  const snap = await readSnapshotFromIndexedDb("local-erp-workspace");
  assert.equal(snap, null);

  const erp = await readErpDataFromIndexedDb("local-erp-workspace");
  assert.equal(erp, null);

  const stats = await getLocalDatabaseStats("local-erp-workspace");
  assert.equal(stats.engine, "localStorage");
  assert.equal(stats.accountsCount, 0);

  const dump = await exportIndexedDbSnapshot("local-erp-workspace");
  assert.equal(dump.dbName, LOCAL_DB_NAME);
  assert.equal(dump.version, 2);
  assert.equal(dump.workspaceSnapshot, null);

  await saveErpDataToIndexedDb("local-erp-workspace", { test: true });
  await clearLocalDatabase();

  await saveErpWorkspaceData("local-erp-workspace", createEmptyErpData());
  // A real write without a browser/native service must reject, never report a
  // successful memory-only save. Await the rejection to catch async failures.
  await assert.rejects(saveErpWorkspaceData("local-erp-workspace", {
    ...createEmptyErpData(), employees: createDefaultErpData().employees.slice(0, 1),
  }), /خدمة حفظ السجلات غير متاحة/);
});

test("Flutter SQLite database service and pubspec contain required tables and sqflite", () => {
  const pubspec = readFileSync(path.resolve(process.cwd(), "flutter_app/pubspec.yaml"), "utf8");
  assert.match(pubspec, /sqflite:\s*\^2\./);
  assert.match(pubspec, /path:\s*\^1\./);

  const dartDb = readFileSync(
    path.resolve(process.cwd(), "flutter_app/lib/services/local_database.dart"),
    "utf8",
  );
  assert.match(dartDb, /CREATE TABLE accounts/);
  assert.match(dartDb, /CREATE TABLE ledger_entries/);
  assert.match(dartDb, /CREATE TABLE warehouses/);
  assert.match(dartDb, /CREATE TABLE inventory_items/);
  assert.match(dartDb, /CREATE TABLE erp_state/);
});
