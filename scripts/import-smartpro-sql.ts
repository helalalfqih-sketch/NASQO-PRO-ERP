import fs from "node:fs";
import path from "node:path";
import { importSmartProSqlDump } from "../server/smartproSqlImporter.ts";
import { DEFAULT_WORKSPACE_ID, closeSqliteDb, getDbStats, getSqliteDb, resolveSqliteDbPath } from "../server/sqliteDb.ts";

const sqlPath = process.argv[2] || process.env.NASQO_BOOTSTRAP_SQL_PATH || "d:\\SmartProBackups\\smartprodb.sql";

if (!fs.existsSync(sqlPath)) {
  console.error(`SQL file not found: ${sqlPath}`);
  process.exit(1);
}

const sqlText = fs.readFileSync(sqlPath, "utf8");
const db = getSqliteDb();
try {
  const report = importSmartProSqlDump(db, sqlText, {
    workspaceId: DEFAULT_WORKSPACE_ID,
    sourceName: path.basename(sqlPath),
    replaceExisting: true,
  });
  const integrityRow = db.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
  const integrity = String(Object.values(integrityRow)[0] ?? "unknown");
  const stats = getDbStats(db, DEFAULT_WORKSPACE_ID);
  console.log("Unified SQLite path:", resolveSqliteDbPath());
  console.log("Integrity:", integrity);
  console.log("Import report:", JSON.stringify(report, null, 2));
  console.log("DB stats:", JSON.stringify(stats, null, 2));
} finally {
  closeSqliteDb();
}
