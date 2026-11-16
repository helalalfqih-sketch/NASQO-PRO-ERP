import { LEGACY_ARCHIVE_DB } from "./legacyFinancialStaging";
import type { SqliteInspectionResult } from "./sqliteEngine";

export const RAW_SQLITE_STORE = "raw_sqlite_archives";
export const STORAGE_DB_VERSION = 2;

export type RawSqliteRecord = {
  id: string; // workspaceId::sourceSha256
  workspaceId: string;
  sourceSha256: string;
  fileName: string;
  fileSize: number;
  rawBytes: Uint8Array;
  importedAt: string;
  integrity: string;
  totalRows: number;
  tableCounts: Record<string, number>;
  status: "original_exact_preserved";
};

export type RawSqliteMeta = Omit<RawSqliteRecord, "rawBytes">;

function openStorageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("المتصفح لا يدعم IndexedDB."));
      return;
    }
    const request = indexedDB.open(LEGACY_ARCHIVE_DB, STORAGE_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains("archives")) {
        db.createObjectStore("archives", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("records")) {
        const store = db.createObjectStore("records", { keyPath: "key" });
        store.createIndex("byArchiveTable", ["archiveId", "table"], { unique: false });
        store.createIndex("byArchiveTableBill", ["archiveId", "table", "billId"], { unique: false });
      }
      if (!db.objectStoreNames.contains(RAW_SQLITE_STORE)) {
        db.createObjectStore(RAW_SQLITE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("تعذر فتح قاعدة بيانات الأرشيف المحلي."));
    request.onblocked = () => reject(new Error("يرجى إغلاق علامات التبويب الأخرى للمتابعة."));
  });
}

function reqPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("تعذر إتمام قراءة/كتابة البيانات."));
  });
}

export function buildArchiveKey(workspaceId: string, sourceSha256: string): string {
  return `${workspaceId.trim()}::${sourceSha256.trim().toLowerCase()}`;
}

export async function findRawSqliteArchive(
  workspaceId: string,
  sourceSha256: string,
): Promise<RawSqliteMeta | null> {
  const db = await openStorageDb();
  try {
    const tx = db.transaction(RAW_SQLITE_STORE, "readonly");
    const key = buildArchiveKey(workspaceId, sourceSha256);
    const item = (await reqPromise(tx.objectStore(RAW_SQLITE_STORE).get(key))) as RawSqliteRecord | undefined;
    if (!item) return null;
    const { rawBytes: _discard, ...meta } = item;
    return meta;
  } finally {
    db.close();
  }
}

export async function saveRawSqliteArchive(
  workspaceId: string,
  fileName: string,
  rawBytes: Uint8Array,
  inspection: SqliteInspectionResult,
): Promise<{ alreadyExists: boolean; meta: RawSqliteMeta }> {
  if (!workspaceId.trim()) throw new Error("معرّف مساحة العمل مطلوب لحفظ النسخة.");
  const existing = await findRawSqliteArchive(workspaceId, inspection.sourceSha256);
  if (existing) {
    return { alreadyExists: true, meta: existing };
  }

  const db = await openStorageDb();
  const id = buildArchiveKey(workspaceId, inspection.sourceSha256);
  const record: RawSqliteRecord = {
    id,
    workspaceId,
    sourceSha256: inspection.sourceSha256,
    fileName,
    fileSize: rawBytes.byteLength,
    rawBytes,
    importedAt: new Date().toISOString(),
    integrity: inspection.integrity,
    totalRows: inspection.totalRows,
    tableCounts: inspection.tableCounts,
    status: "original_exact_preserved",
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RAW_SQLITE_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("فشلت معاملة حفظ النسخة الأصلية."));
      tx.onerror = () => { /* onabort handles */ };
      tx.objectStore(RAW_SQLITE_STORE).add(record);
    });
    const { rawBytes: _discard, ...meta } = record;
    return { alreadyExists: false, meta };
  } finally {
    db.close();
  }
}

export async function exportRawSqliteArchive(
  workspaceId: string,
  sourceSha256: string,
): Promise<{ rawBytes: Uint8Array; fileName: string; fileSize: number }> {
  const db = await openStorageDb();
  try {
    const tx = db.transaction(RAW_SQLITE_STORE, "readonly");
    const key = buildArchiveKey(workspaceId, sourceSha256);
    const item = (await reqPromise(tx.objectStore(RAW_SQLITE_STORE).get(key))) as RawSqliteRecord | undefined;
    if (!item) {
      throw new Error("لم يتم العثور على النسخة الأصلية المحفوظة بالبصمة المطلوبة.");
    }
    return {
      rawBytes: item.rawBytes,
      fileName: item.fileName,
      fileSize: item.fileSize,
    };
  } finally {
    db.close();
  }
}

export async function listRawSqliteArchives(workspaceId: string): Promise<RawSqliteMeta[]> {
  const db = await openStorageDb();
  try {
    const tx = db.transaction(RAW_SQLITE_STORE, "readonly");
    const all = (await reqPromise(tx.objectStore(RAW_SQLITE_STORE).getAll())) as RawSqliteRecord[];
    const list = all
      .filter((r) => r.workspaceId === workspaceId)
      .map(({ rawBytes: _discard, ...meta }) => meta);
    return list;
  } finally {
    db.close();
  }
}

export async function deleteRawSqliteArchive(
  workspaceId: string,
  sourceSha256: string,
): Promise<boolean> {
  const db = await openStorageDb();
  try {
    const key = buildArchiveKey(workspaceId, sourceSha256);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RAW_SQLITE_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("تعذر حذف النسخة الأصلية."));
      tx.objectStore(RAW_SQLITE_STORE).delete(key);
    });
    return true;
  } finally {
    db.close();
  }
}
