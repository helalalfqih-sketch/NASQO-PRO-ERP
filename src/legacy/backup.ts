/**
 * Versioned full backup & staged restore for NASQO Pro + Legacy SQLite archives.
 */
import type { AccountRecord, InventoryItemRecord, LedgerEntryRecord, WarehouseRecord, WorkspaceSettings } from "../types";
import { computeSha256 } from "../utils/sqliteEngine";
import { LegacyDatabaseAdapter, type Tables } from "./adapter";
import { reviewMoves, summarizeReview, type ReviewSummary } from "./analysis";
import {
  addJournal,
  archiveBatchId,
  deleteCenterDb,
  getSource,
  importArchive,
  listBatches,
  listIdMap,
  listSettings,
  loadTables,
  openCenterDb,
  putIdMap,
  putSetting,
  putSource,
  type BatchRecord,
  type CenterDb,
  type IdMapEntry,
} from "./store";

export const FULL_BACKUP_FORMAT = "nasqo-pro-full-legacy-backup-v1";
export const FULL_BACKUP_VERSION = 1;

export type FullBackupBundle = {
  format: typeof FULL_BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  bundleSha256: string;
  liveWorkspace: {
    workspace: WorkspaceSettings | null;
    accounts: AccountRecord[];
    warehouses: WarehouseRecord[];
    inventory: InventoryItemRecord[];
    ledger: LedgerEntryRecord[];
  };
  legacySource: {
    sha256: string;
    fileName: string;
    size: number;
    sqliteBase64: string;
    tableCounts: Record<string, number>;
    totalRows: number;
  } | null;
  legacyArchiveTables: Tables | null;
  idMap: IdMapEntry[];
  settings: { key: string; value: unknown }[];
  batches: BatchRecord[];
  reconciliationSummary: ReviewSummary | null;
};

export function bytesToBase64(bytes: Uint8Array): string {
  const nodeBuf = (globalThis as { Buffer?: { from: (b: Uint8Array) => { toString: (enc: string) => string } } }).Buffer;
  if (nodeBuf) {
    return nodeBuf.from(bytes).toString("base64");
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const nodeBuf = (globalThis as { Buffer?: { from: (s: string, enc: string) => Uint8Array } }).Buffer;
  if (nodeBuf) {
    return new Uint8Array(nodeBuf.from(b64, "base64"));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function exportFullBackupBundle(
  centerDb: CenterDb,
  liveWorkspace: FullBackupBundle["liveWorkspace"],
  sourceSha256?: string,
): Promise<FullBackupBundle> {
  const batches = await listBatches(centerDb);
  const settings = await listSettings(centerDb);
  const activeSha = sourceSha256 || batches.find((b) => b.kind === "archive" && b.status === "complete")?.sha256;

  let legacySource: FullBackupBundle["legacySource"] = null;
  let legacyArchiveTables: Tables | null = null;
  let idMap: IdMapEntry[] = [];
  let reconciliationSummary: ReviewSummary | null = null;

  if (activeSha) {
    const src = await getSource(centerDb, activeSha);
    if (src) {
      legacySource = {
        sha256: src.sha256,
        fileName: src.fileName,
        size: src.size,
        sqliteBase64: bytesToBase64(src.bytes),
        tableCounts: src.tableCounts,
        totalRows: src.totalRows,
      };
    }
    const archiveBatch = await batches.find((b) => b.batchId === archiveBatchId(activeSha));
    if (archiveBatch) {
      const tableNames = Object.keys(archiveBatch.tableCounts);
      legacyArchiveTables = await loadTables(centerDb, archiveBatch.batchId, tableNames);
      reconciliationSummary = summarizeReview(reviewMoves(legacyArchiveTables).reviews);
    }
    for (const b of batches) {
      const entries = await listIdMap(centerDb, b.batchId);
      idMap = idMap.concat(entries);
    }
  }

  const core = {
    format: FULL_BACKUP_FORMAT as typeof FULL_BACKUP_FORMAT,
    version: FULL_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    liveWorkspace,
    legacySource,
    legacyArchiveTables,
    idMap,
    settings,
    batches,
    reconciliationSummary,
  };
  const coreBytes = new TextEncoder().encode(JSON.stringify(core));
  const bundleSha256 = await computeSha256(coreBytes);

  return {
    ...core,
    bundleSha256,
  };
}

export type RestoreVerification = {
  valid: boolean;
  bundleShaMatch: boolean;
  sqliteShaMatch: boolean | null;
  tableCountMatch: boolean | null;
  rowCountMatch: boolean | null;
  sqliteIntegrity: string | null;
  totalArchiveRows: number;
  liveCounts: {
    accounts: number;
    warehouses: number;
    inventory: number;
    ledger: number;
  };
  errors: string[];
};

/**
 * Verifies hashes, row counts, and SQLite binary integrity, then stages the restored
 * data in an isolated staging IndexedDB database BEFORE any acceptance into live workspace.
 */
export async function verifyAndStageFullBackupRestore(
  rawJson: unknown,
  stagingDbName = "nasqo_legacy_restore_staging",
  factory?: IDBFactory,
): Promise<{
  bundle: FullBackupBundle;
  verification: RestoreVerification;
}> {
  if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) {
    throw new Error("ملف النسخة الاحتياطية ليس كائن JSON صالحًا.");
  }
  const b = rawJson as Partial<FullBackupBundle>;
  if (b.format !== FULL_BACKUP_FORMAT || b.version !== FULL_BACKUP_VERSION) {
    throw new Error("صيغة أو إصدار النسخة الاحتياطية غير مدعوم.");
  }
  if (!b.liveWorkspace || !Array.isArray(b.liveWorkspace.accounts)) {
    throw new Error("بيانات مساحة العمل الحية مفقودة داخل النسخة الاحتياطية.");
  }

  const errors: string[] = [];
  const { bundleSha256, ...coreWithoutSha } = b;
  const computedBundleSha = await computeSha256(new TextEncoder().encode(JSON.stringify(coreWithoutSha)));
  const bundleShaMatch = computedBundleSha === bundleSha256;
  if (!bundleShaMatch) {
    errors.push("بصمة حزمة النسخة الاحتياطية (bundleSha256) غير متطابقة.");
  }

  let sqliteShaMatch: boolean | null = null;
  let tableCountMatch: boolean | null = null;
  let rowCountMatch: boolean | null = null;
  let sqliteIntegrity: string | null = null;
  let totalArchiveRows = 0;

  let decodedSqliteBytes: Uint8Array | null = null;
  if (b.legacySource) {
    decodedSqliteBytes = base64ToBytes(b.legacySource.sqliteBase64);
    const actualSha = await computeSha256(decodedSqliteBytes);
    sqliteShaMatch = actualSha === b.legacySource.sha256;
    if (!sqliteShaMatch) {
      errors.push("بصمة ملف SQLite المستعاد لا تطابق البصمة الأصلية SHA-256.");
    }

    const adapter = await LegacyDatabaseAdapter.open(decodedSqliteBytes, b.legacySource.fileName);
    try {
      const schema = adapter.schema();
      sqliteIntegrity = schema.integrity;
      tableCountMatch = schema.tableCount === Object.keys(b.legacySource.tableCounts).length;
      rowCountMatch = schema.totalRows === b.legacySource.totalRows;
      totalArchiveRows = schema.totalRows;
      if (schema.integrity !== "ok") errors.push(`فحص سلامة SQLite: ${schema.integrity}`);
      if (!tableCountMatch) errors.push("عدد الجداول المستعادة لا يطابق السجل.");
      if (!rowCountMatch) errors.push("إجمالي السجلات المستعادة لا يطابق السجل.");
    } finally {
      adapter.close();
    }
  }

  // Stage into isolated IndexedDB before user accepts merging into live workspace
  await deleteCenterDb(stagingDbName, factory);
  const stagingDb = await openCenterDb(stagingDbName, factory);
  try {
    if (b.legacySource && decodedSqliteBytes) {
      await putSource(stagingDb, {
        sha256: b.legacySource.sha256,
        fileName: b.legacySource.fileName,
        size: b.legacySource.size,
        bytes: decodedSqliteBytes,
        savedAt: new Date().toISOString(),
        integrity: sqliteIntegrity ?? "ok",
        tableCounts: b.legacySource.tableCounts,
        totalRows: b.legacySource.totalRows,
      });
      if (b.legacyArchiveTables) {
        await importArchive(stagingDb, b.legacySource.sha256, b.legacyArchiveTables, {
          note: "استعادة معزولة للتحقق قبل القبول",
        });
      }
      if (Array.isArray(b.idMap) && b.idMap.length > 0) {
        const byBatch = new Map<string, IdMapEntry[]>();
        for (const m of b.idMap) {
          const arr = byBatch.get(m.batchId) ?? [];
          arr.push(m);
          byBatch.set(m.batchId, arr);
        }
        for (const [bid, list] of byBatch) {
          await putIdMap(stagingDb, bid, list);
        }
      }
    }
    if (Array.isArray(b.settings)) {
      for (const s of b.settings) {
        await putSetting(stagingDb, s.key, s.value);
      }
    }
    await addJournal(stagingDb, {
      batchId: "restore-staging",
      level: errors.length ? "error" : "info",
      message: errors.length ? `فشل التحقق أثناء الاستعادة: ${errors.join(" | ")}` : "اكتمل التحقق والعزل في قاعدة الاستعادة بنجاح.",
    });
  } finally {
    stagingDb.close();
  }

  const verification: RestoreVerification = {
    valid: errors.length === 0,
    bundleShaMatch,
    sqliteShaMatch,
    tableCountMatch,
    rowCountMatch,
    sqliteIntegrity,
    totalArchiveRows,
    liveCounts: {
      accounts: b.liveWorkspace.accounts.length,
      warehouses: b.liveWorkspace.warehouses.length,
      inventory: b.liveWorkspace.inventory.length,
      ledger: b.liveWorkspace.ledger.length,
    },
    errors,
  };

  return { bundle: b as FullBackupBundle, verification };
}
