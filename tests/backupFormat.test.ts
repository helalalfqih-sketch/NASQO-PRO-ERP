import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalBackupDownloadName,
  extractBackupCollections,
  formatNasqoBackupFilename,
  inspectBackupBytes,
} from "../src/utils/backupFormat";

test("formatNasqoBackupFilename matches backup_YYYY.MM.DD_HH.MM.SS.back convention", () => {
  const sample = new Date(2026, 10, 8, 3, 49, 26); // 2026-11-08 03:49:26
  assert.equal(formatNasqoBackupFilename(sample), "backup_2026.11.08_03.49.26.back");
});

test("buildLocalBackupDownloadName preserves .back or .json and appends .back when missing", () => {
  assert.equal(
    buildLocalBackupDownloadName("backup_2026.11.08_03.49.26.back"),
    "backup_2026.11.08_03.49.26.back",
  );
  assert.equal(buildLocalBackupDownloadName("my-export.json"), "my-export.json");
  assert.equal(buildLocalBackupDownloadName("نسخة-نوفمبر"), "نسخة-نوفمبر.back");
});

test("inspectBackupBytes detects JSON .back files, SQLite .back files, and ZIP .back files", () => {
  const jsonBytes = new TextEncoder().encode(
    JSON.stringify({
      name: "backup_2026.11.08_03.49.26.back",
      accounts: [{ id: "a1", name: "شركة النور" }],
      ledger: [{ id: "l1", accountId: "a1", amount: 500 }],
    }),
  );
  const jsonResult = inspectBackupBytes(jsonBytes, "backup_2026.11.08_03.49.26.back");
  assert.equal(jsonResult.kind, "json");
  if (jsonResult.kind === "json") {
    const collections = extractBackupCollections(jsonResult.payload);
    assert.equal(collections.accounts.length, 1);
    assert.equal(collections.ledger.length, 1);
    assert.equal(collections.totalRecords, 2);
  }

  const sqliteBytes = new TextEncoder().encode("SQLite format 3\u0000dummy");
  assert.equal(
    inspectBackupBytes(sqliteBytes, "backup_2026.11.08_03.49.26.back").kind,
    "sqlite",
  );

  const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  assert.equal(
    inspectBackupBytes(zipBytes, "backup_2026.11.08_03.49.26.back").kind,
    "zip",
  );
});
