#!/usr/bin/env node
/**
 * Prevent accounting backup or database files from entering public web assets.
 * This guards the Vite public directory before release builds.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SENSITIVE_DATABASE_EXTENSION = /\.(?:back|db|sqlite|sqlite3|dump|sql)(?:\.gz)?$/i;

export function findPublicDatabaseFiles(publicRoot) {
  if (!fs.existsSync(publicRoot)) return [];
  const forbidden = [];
  const walk = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, item.name);
      if (item.isDirectory()) {
        walk(fullPath);
      } else if (item.isFile() && SENSITIVE_DATABASE_EXTENSION.test(item.name)) {
        forbidden.push(path.relative(publicRoot, fullPath));
      }
    }
  };
  walk(publicRoot);
  return forbidden.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const forbidden = findPublicDatabaseFiles(path.resolve("public"));
  if (forbidden.length > 0) {
    process.stderr.write(
      "SECURITY: Database/backup files found inside public/; refusing build.\n" +
      forbidden.map((f) => `  - ${f}\n`).join("") +
      "Move private backups outside the repository's public directory.\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("Public directory backup guard: PASS\n");
  }
}
