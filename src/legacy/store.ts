/**
 * IndexedDB storage for the legacy-database center.
 *
 * Kept in its OWN database (`nasqo_legacy_center`) so existing NASQO stores
 * (`nasqo_legacy_historical_archive`, the workspace mirror, …) are never altered or cleared.
 *
 * Layers (object stores):
 *   sources  – original SQLite copy, untouched bytes + SHA-256
 *   batches  – import / posting / restore log (status: importing | complete | rolled_back)
 *   records  – every historical row of every table (generic archive)
 *   idmap    – legacy id ➜ live workspace id
 *   settings – user-confirmed mappings (document roles, posting policy, account groups)
 *   journal  – append-only audit log
 */
import { rowKey, type Row, type Tables } from "./adapter";

export const CENTER_DB = "nasqo_legacy_center";
export const CENTER_DB_VERSION = 1;

export type SourceRecord = {
  sha256: string;
  fileName: string;
  size: number;
  bytes: Uint8Array;
  savedAt: string;
  integrity: string;
  tableCounts: Record<string, number>;
  totalRows: number;
};
export type SourceMeta = Omit<SourceRecord, "bytes">;

export type BatchKind = "archive" | "master" | "posting";
export type BatchStatus = "importing" | "complete" | "rolled_back";
export type BatchRecord = {
  batchId: string;
  kind: BatchKind;
  sha256: string;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
  total: number;
  nextIndex: number;
  tableCounts: Record<string, number>;
  note?: string;
  counts?: Record<string, number>;
};

export type ArchiveRow = {
  key: string;
  batchId: string;
  table: string;
  id: string;
  fk: string;
  row: Row;
};

export type IdMapEntry = { key: string; batchId: string; kind: string; legacyId: string; liveId: string };
export type JournalEntry = { seq?: number; batchId: string; at: string; level: "info" | "warn" | "error"; message: string };

export type CenterDb = IDBDatabase;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("فشل طلب IndexedDB"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("أُلغيت المعاملة بالكامل"));
    tx.onerror = () => {
      /* surfaced through onabort */
    };
  });
}

export function openCenterDb(name = CENTER_DB, factory?: IDBFactory): Promise<CenterDb> {
  return new Promise((resolve, reject) => {
    const f = factory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
    if (!f) {
      reject(new Error("المتصفح لا يدعم IndexedDB."));
      return;
    }
    const open = f.open(name, CENTER_DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("sources")) db.createObjectStore("sources", { keyPath: "sha256" });
      if (!db.objectStoreNames.contains("batches")) {
        const s = db.createObjectStore("batches", { keyPath: "batchId" });
        s.createIndex("bySha", "sha256", { unique: false });
      }
      if (!db.objectStoreNames.contains("records")) {
        const s = db.createObjectStore("records", { keyPath: "key" });
        s.createIndex("byBatchTable", ["batchId", "table"], { unique: false });
        s.createIndex("byBatchTableFk", ["batchId", "table", "fk"], { unique: false });
        s.createIndex("byBatch", "batchId", { unique: false });
      }
      if (!db.objectStoreNames.contains("idmap")) {
        const s = db.createObjectStore("idmap", { keyPath: "key" });
        s.createIndex("byBatch", "batchId", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
      if (!db.objectStoreNames.contains("journal")) {
        const s = db.createObjectStore("journal", { keyPath: "seq", autoIncrement: true });
        s.createIndex("byBatch", "batchId", { unique: false });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("تعذر فتح قاعدة مركز الترحيل."));
    open.onblocked = () => reject(new Error("أغلق علامات التبويب الأخرى ثم أعد المحاولة."));
  });
}

export function deleteCenterDb(name: string, factory?: IDBFactory): Promise<void> {
  return new Promise((resolve, reject) => {
    const f = factory ?? indexedDB;
    const r = f.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve();
  });
}

/* ------------------------------------------------------------------ sources */

export async function putSource(db: CenterDb, source: SourceRecord): Promise<{ existed: boolean; meta: SourceMeta }> {
  const tx = db.transaction("sources", "readwrite");
  const store = tx.objectStore("sources");
  const existing = (await req(store.get(source.sha256))) as SourceRecord | undefined;
  if (!existing) store.add(source);
  await txDone(tx);
  const { bytes: _b, ...meta } = existing ?? source;
  return { existed: Boolean(existing), meta };
}

export async function getSource(db: CenterDb, sha256: string): Promise<SourceRecord | null> {
  const tx = db.transaction("sources", "readonly");
  return ((await req(tx.objectStore("sources").get(sha256))) as SourceRecord | undefined) ?? null;
}

export async function listSources(db: CenterDb): Promise<SourceMeta[]> {
  const tx = db.transaction("sources", "readonly");
  const all = (await req(tx.objectStore("sources").getAll())) as SourceRecord[];
  return all.map(({ bytes: _b, ...meta }) => meta).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/* ------------------------------------------------------------------ journal / settings */

export async function addJournal(db: CenterDb, entry: Omit<JournalEntry, "at"> & { at?: string }): Promise<void> {
  const tx = db.transaction("journal", "readwrite");
  tx.objectStore("journal").add({ ...entry, at: entry.at ?? new Date().toISOString() });
  await txDone(tx);
}

export async function listJournal(db: CenterDb, batchId?: string): Promise<JournalEntry[]> {
  const tx = db.transaction("journal", "readonly");
  const store = tx.objectStore("journal");
  const rows = (batchId
    ? await req(store.index("byBatch").getAll(IDBKeyRange.only(batchId)))
    : await req(store.getAll())) as JournalEntry[];
  return rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

export async function putSetting<T>(db: CenterDb, key: string, value: T): Promise<void> {
  const tx = db.transaction("settings", "readwrite");
  tx.objectStore("settings").put({ key, value });
  await txDone(tx);
}

export async function getSetting<T>(db: CenterDb, key: string): Promise<T | null> {
  const tx = db.transaction("settings", "readonly");
  const found = (await req(tx.objectStore("settings").get(key))) as { key: string; value: T } | undefined;
  return found ? found.value : null;
}

export async function listSettings(db: CenterDb): Promise<{ key: string; value: unknown }[]> {
  const tx = db.transaction("settings", "readonly");
  return (await req(tx.objectStore("settings").getAll())) as { key: string; value: unknown }[];
}

/* ------------------------------------------------------------------ batches */

export const archiveBatchId = (sha256: string) => `archive:${sha256}`;

export async function getBatch(db: CenterDb, batchId: string): Promise<BatchRecord | null> {
  const tx = db.transaction("batches", "readonly");
  return ((await req(tx.objectStore("batches").get(batchId))) as BatchRecord | undefined) ?? null;
}

export async function listBatches(db: CenterDb): Promise<BatchRecord[]> {
  const tx = db.transaction("batches", "readonly");
  const all = (await req(tx.objectStore("batches").getAll())) as BatchRecord[];
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function putBatch(db: CenterDb, batch: BatchRecord): Promise<void> {
  const tx = db.transaction("batches", "readwrite");
  tx.objectStore("batches").put(batch);
  await txDone(tx);
}

export type ArchiveProgress = { written: number; total: number };
export type ArchiveImportOptions = {
  chunkSize?: number;
  onProgress?: (p: ArchiveProgress) => void;
  /** test hook: abort after N committed chunks to simulate a crash */
  failAfterChunks?: number;
  note?: string;
};

function archiveRows(batchId: string, tables: Tables): ArchiveRow[] {
  const rows: ArchiveRow[] = [];
  for (const table of Object.keys(tables).sort()) {
    for (const row of tables[table]) {
      const id = rowKey(row);
      const fkRaw = table === "input_move" || table === "bin" ? row.per_id : "bill_id" in row ? row.bill_id : "";
      const { __rowid__: _r, ...clean } = row;
      rows.push({
        key: `${batchId}:${table}:${id}`,
        batchId,
        table,
        id,
        fk: fkRaw === null || fkRaw === undefined ? "" : String(fkRaw),
        row: clean,
      });
    }
  }
  return rows;
}

/**
 * Saves every historical row. Each chunk is one atomic transaction; the batch only becomes
 * visible (`complete`) after the final transaction, and an interrupted batch is resumed
 * (idempotent `put`) instead of being duplicated.
 */
export async function importArchive(
  db: CenterDb,
  sha256: string,
  tables: Tables,
  options: ArchiveImportOptions = {},
): Promise<{ duplicate: boolean; resumed: boolean; batch: BatchRecord }> {
  const batchId = archiveBatchId(sha256);
  const existing = await getBatch(db, batchId);
  if (existing?.status === "complete") return { duplicate: true, resumed: false, batch: existing };

  const rows = archiveRows(batchId, tables);
  const tableCounts: Record<string, number> = {};
  for (const [name, list] of Object.entries(tables)) tableCounts[name] = list.length;
  const now = new Date().toISOString();
  const resumed = existing?.status === "importing";
  let batch: BatchRecord =
    existing?.status === "importing"
      ? existing
      : {
          batchId,
          kind: "archive",
          sha256,
          status: "importing",
          createdAt: now,
          updatedAt: now,
          total: rows.length,
          nextIndex: 0,
          tableCounts,
          note: options.note,
        };
  if (!resumed) {
    await putBatch(db, batch);
    await addJournal(db, { batchId, level: "info", message: `بدء استيراد الأرشيف التاريخي: ${rows.length} سجلًا` });
  } else {
    await addJournal(db, { batchId, level: "warn", message: `استئناف استيراد منقطع من السجل ${batch.nextIndex}` });
  }

  const chunkSize = Math.max(1, options.chunkSize ?? 2000);
  let committedChunks = 0;
  for (let start = batch.nextIndex; start < rows.length; start += chunkSize) {
    const slice = rows.slice(start, start + chunkSize);
    const tx = db.transaction(["records", "batches"], "readwrite");
    const records = tx.objectStore("records");
    for (const r of slice) records.put(r);
    batch = { ...batch, nextIndex: start + slice.length, updatedAt: new Date().toISOString() };
    tx.objectStore("batches").put(batch);
    await txDone(tx);
    committedChunks += 1;
    options.onProgress?.({ written: batch.nextIndex, total: rows.length });
    if (options.failAfterChunks !== undefined && committedChunks >= options.failAfterChunks && batch.nextIndex < rows.length) {
      throw new Error("انقطاع محاكى أثناء الاستيراد");
    }
  }

  const tx = db.transaction(["batches", "journal"], "readwrite");
  batch = { ...batch, status: "complete", updatedAt: new Date().toISOString(), nextIndex: rows.length };
  tx.objectStore("batches").put(batch);
  tx.objectStore("journal").add({ batchId, level: "info", at: new Date().toISOString(), message: `اكتمل استيراد الأرشيف: ${rows.length} سجلًا` });
  await txDone(tx);
  return { duplicate: false, resumed, batch };
}

export async function rollbackBatch(db: CenterDb, batchId: string): Promise<{ removedRecords: number; removedMappings: number }> {
  const tx = db.transaction(["records", "idmap", "batches", "journal"], "readwrite");
  const records = tx.objectStore("records");
  const idmap = tx.objectStore("idmap");
  let removedRecords = 0;
  let removedMappings = 0;
  const keys = (await req(records.index("byBatch").getAllKeys(IDBKeyRange.only(batchId)))) as IDBValidKey[];
  for (const k of keys) { records.delete(k); removedRecords += 1; }
  const mapKeys = (await req(idmap.index("byBatch").getAllKeys(IDBKeyRange.only(batchId)))) as IDBValidKey[];
  for (const k of mapKeys) { idmap.delete(k); removedMappings += 1; }
  const batches = tx.objectStore("batches");
  const batch = (await req(batches.get(batchId))) as BatchRecord | undefined;
  if (batch) batches.put({ ...batch, status: "rolled_back", updatedAt: new Date().toISOString() });
  tx.objectStore("journal").add({ batchId, level: "warn", at: new Date().toISOString(), message: `تراجع عن الدفعة: حُذف ${removedRecords} سجلًا و${removedMappings} ربطًا` });
  await txDone(tx);
  return { removedRecords, removedMappings };
}

/* ------------------------------------------------------------------ record queries */

export async function countTable(db: CenterDb, batchId: string, table: string): Promise<number> {
  const tx = db.transaction("records", "readonly");
  return req(tx.objectStore("records").index("byBatchTable").count(IDBKeyRange.only([batchId, table])));
}

export async function allRows(db: CenterDb, batchId: string, table: string): Promise<Row[]> {
  const tx = db.transaction("records", "readonly");
  const found = (await req(tx.objectStore("records").index("byBatchTable").getAll(IDBKeyRange.only([batchId, table])))) as ArchiveRow[];
  return found.map((r) => r.row).sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));
}

export async function loadTables(db: CenterDb, batchId: string, names: readonly string[]): Promise<Tables> {
  const tables: Tables = {};
  for (const n of names) tables[n] = await allRows(db, batchId, n);
  return tables;
}

export async function rowsByFk(db: CenterDb, batchId: string, table: string, fk: string | number): Promise<Row[]> {
  const tx = db.transaction("records", "readonly");
  const found = (await req(
    tx.objectStore("records").index("byBatchTableFk").getAll(IDBKeyRange.only([batchId, table, String(fk)])),
  )) as ArchiveRow[];
  return found.map((r) => r.row).sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));
}

export async function getRow(db: CenterDb, batchId: string, table: string, id: string | number): Promise<Row | null> {
  const tx = db.transaction("records", "readonly");
  const found = (await req(tx.objectStore("records").get(`${batchId}:${table}:${id}`))) as ArchiveRow | undefined;
  return found?.row ?? null;
}

/* ------------------------------------------------------------------ id maps */

export async function putIdMap(db: CenterDb, batchId: string, entries: { kind: string; legacyId: string | number; liveId: string }[]): Promise<void> {
  const tx = db.transaction("idmap", "readwrite");
  const store = tx.objectStore("idmap");
  for (const e of entries) {
    store.put({ key: `${batchId}:${e.kind}:${e.legacyId}`, batchId, kind: e.kind, legacyId: String(e.legacyId), liveId: e.liveId } satisfies IdMapEntry);
  }
  await txDone(tx);
}

export async function listIdMap(db: CenterDb, batchId: string): Promise<IdMapEntry[]> {
  const tx = db.transaction("idmap", "readonly");
  return (await req(tx.objectStore("idmap").index("byBatch").getAll(IDBKeyRange.only(batchId)))) as IdMapEntry[];
}

export async function deleteIdMap(db: CenterDb, batchId: string): Promise<void> {
  const tx = db.transaction("idmap", "readwrite");
  const store = tx.objectStore("idmap");
  const keys = (await req(store.index("byBatch").getAllKeys(IDBKeyRange.only(batchId)))) as IDBValidKey[];
  for (const k of keys) store.delete(k);
  await txDone(tx);
}
