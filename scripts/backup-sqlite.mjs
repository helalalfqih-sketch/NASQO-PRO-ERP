#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

const sourcePath = process.env.NASQO_SQLITE_PATH;
const targetPath = process.argv[2];
if (!sourcePath || !path.isAbsolute(sourcePath) ||
    !targetPath || !path.isAbsolute(targetPath) ||
    path.resolve(sourcePath) === path.resolve(targetPath)) {
  console.error("Usage: NASQO_SQLITE_PATH=/absolute/nasqo.sqlite node scripts/backup-sqlite.mjs /absolute/backups/backup.sqlite");
  process.exit(2);
}
if (!fs.existsSync(sourcePath)) {
  console.error("Source SQLite database is missing. Refusing to create a blank backup.");
  process.exit(2);
}
fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
if (fs.existsSync(targetPath)) {
  console.error("Backup destination already exists. Refusing to overwrite.");
  process.exit(2);
}
process.umask(0o077);
const db = new DatabaseSync(sourcePath, { readOnly: true });
try {
  await backup(db, targetPath);
  const copy = new DatabaseSync(targetPath, { readOnly: true });
  const integrity = copy.prepare("PRAGMA integrity_check").get();
  copy.close();
  if (!integrity || Object.values(integrity)[0] !== "ok") {
    throw new Error("Backup integrity check failed");
  }
  fs.chmodSync(targetPath, 0o600);
  console.log("SQLite backup verified:", targetPath, fs.statSync(targetPath).size, "bytes");
} catch (e) {
  // A failed backup must not be presented as a usable file.
  console.error("Backup failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally { db.close(); }
