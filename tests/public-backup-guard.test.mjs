import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findPublicDatabaseFiles, SENSITIVE_DATABASE_EXTENSION } from "../scripts/guard-public-backups.mjs";

test("build guard detects SQLite files recursively but allows normal application assets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nasqo-public-guard-"));
  try {
    const assets = path.join(root, "assets");
    fs.mkdirSync(assets);
    fs.writeFileSync(path.join(assets, "backup.back"), "PRIVATE");
    fs.writeFileSync(path.join(root, "finance.sqlite"), "PRIVATE");
    fs.writeFileSync(path.join(root, "app.js"), "safe");
    assert.deepEqual(findPublicDatabaseFiles(root), ["assets/backup.back", "finance.sqlite"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("database backup extensions are treated as sensitive regardless of case", () => {
  for (const name of ["backup.back", "accounting.sqlite", "clients.db", "system.dump", "backup.SQL.GZ"]) {
    assert.equal(SENSITIVE_DATABASE_EXTENSION.test(name), true, name);
  }
  for (const name of ["app.js", "style.css", "manifest.json"]) {
    assert.equal(SENSITIVE_DATABASE_EXTENSION.test(name), false, name);
  }
});
