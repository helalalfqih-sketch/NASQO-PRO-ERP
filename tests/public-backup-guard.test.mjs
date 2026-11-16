import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findPublicDatabaseFiles } from "../scripts/guard-public-backups.mjs";
import worker from "../worker/index.js";

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

test("Sites worker returns 404 for private database file extensions without touching assets", async () => {
  for (const fileName of [
    "backup.back",
    "accounting.sqlite",
    "clients.db",
    "system.dump",
    "backup.SQL.GZ",
    "accounting%2Eback",
  ]) {
    let calls = 0;
    const response = await worker.fetch(
      new Request(`https://example.test/assets/${fileName}`),
      { ASSETS: { fetch: async () => { calls += 1; return new Response("exposed"); } } },
    );
    assert.equal(response.status, 404, fileName);
    assert.equal(calls, 0, fileName);
  }
});
