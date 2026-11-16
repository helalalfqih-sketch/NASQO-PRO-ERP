/**
 * Read-only historical staging for NASQO SQLite exports.
 * No writes to the live accounting database or Firestore.
 * Posting to the general ledger is intentionally NOT implemented.
 */
export const LEGACY_ARCHIVE_DB = "nasqo_legacy_historical_archive";
export const LEGACY_ARCHIVE_DB_VERSION = 1;

export type LegacyRow = Record<string, unknown>;
export type LegacyTable = { columns?: string[]; rows: LegacyRow[] };
export type LegacyPayload = {
  format: "nasqo-legacy-financial-staging-v1" | "legacy-sqlite-full-export-v1";
  version?: number;
  sourceSha256: string;
  sourceName?: string;
  sourceUserVersion?: number;
  tables: Record<string, LegacyTable>;
};

export type LegacyInspection = {
  payload: LegacyPayload;
  sourceSha256: string;
  tableCounts: Record<string, number>;
  totalRows: number;
  typeCounts: Record<string, number>;
  bothAmountsPositive: number;
  bothAmountsZero: number;
  missingCustomerRefs: number;
  missingProductRefs: number;
  missingInvoiceRefs: number;
  unregisteredCurrencyRefs: number;
  duplicateIds: number;
  warnings: string[];
};

export type StagedLegacyArchive = {
  id: string;
  workspaceId: string;
  sourceSha256: string;
  importedAt: string;
  sourceName: string;
  rowCount: number;
  tableCounts: Record<string, number>;
  typeCounts: Record<string, number>;
  bothAmountsPositive: number;
  unregisteredCurrencyRefs: number;
  status: "review_only";
  postedToLedger: false;
};

function recordOf(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rows(payload: LegacyPayload, table: string): LegacyRow[] {
  return payload.tables[table]?.rows ?? [];
}

function idOf(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function amountOf(value: unknown): number {
  const raw = String(value ?? "0").replace(/,/g, "").trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

const REQUIRED_TABLES = [
  "customers", "products", "stores", "currencies", "input_move",
  "bill_details", "bill_details2", "offers", "store_trans",
] as const;

export function inspectLegacyFinancialArchive(input: unknown): LegacyInspection {
  if (!recordOf(input)) throw new Error("الملف ليس كائن JSON صالحًا.");
  if (input.format !== "nasqo-legacy-financial-staging-v1" &&
      input.format !== "legacy-sqlite-full-export-v1") {
    throw new Error("الصيغة ليست أرشيف SQLite محولًا متوافقًا مع هذا المستورد.");
  }
  if (typeof input.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(input.sourceSha256)) {
    throw new Error("بصمة المصدر SHA-256 غير موجودة أو غير صحيحة.");
  }
  if (!recordOf(input.tables)) throw new Error("ملف الأرشيف لا يحتوي على الجداول.");
  const rawTables = input.tables;
  const tables: Record<string, LegacyTable> = {};
  for (const [name, value] of Object.entries(rawTables)) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error("اسم جدول غير مسموح.");
    if (!recordOf(value) || !Array.isArray(value.rows) || !value.rows.every(recordOf)) {
      throw new Error("سجلات الجدول " + name + " غير صالحة.");
    }
    tables[name] = { rows: value.rows, columns: Array.isArray(value.columns) ? value.columns.filter((c): c is string => typeof c === "string") : [] };
  }
  for (const name of REQUIRED_TABLES) {
    if (!tables[name]) throw new Error("الجدول المطلوب غير موجود: " + name);
  }
  const payload: LegacyPayload = {
    format: input.format,
    sourceSha256: input.sourceSha256.toLowerCase(),
    sourceName: typeof input.sourceName === "string" ? input.sourceName : undefined,
    sourceUserVersion: typeof input.sourceUserVersion === "number" ? input.sourceUserVersion : undefined,
    tables,
  };
  const tableCounts: Record<string, number> = {};
  let totalRows = 0;
  let duplicateIds = 0;
  for (const [table, def] of Object.entries(tables)) {
    tableCounts[table] = def.rows.length;
    totalRows += def.rows.length;
    const ids = new Set<string>();
    for (let i = 0; i < def.rows.length; i += 1) {
      const id = idOf(def.rows[i].id) || "#" + i;
      if (ids.has(id)) duplicateIds += 1;
      ids.add(id);
    }
  }
  if (duplicateIds > 0) throw new Error("يوجد تكرار في معرفات سجلات المصدر: " + duplicateIds);

  const knownCustomers = new Set(rows(payload, "customers").map((r) => idOf(r.id)));
  const knownProducts = new Set(rows(payload, "products").map((r) => idOf(r.id)));
  const knownMoves = new Set(rows(payload, "input_move").map((r) => idOf(r.id)));
  const knownCurrencies = new Set(rows(payload, "currencies").map((r) => idOf(r.id)));
  const typeCounts: Record<string, number> = {};
  let bothAmountsPositive = 0;
  let bothAmountsZero = 0;
  let missingCustomerRefs = 0;
  let missingProductRefs = 0;
  let missingInvoiceRefs = 0;
  let unregisteredCurrencyRefs = 0;
  let invalidAmountFields = 0;

  for (const r of rows(payload, "input_move")) {
    const billType = idOf(r.bill_type) || "?";
    typeCounts[billType] = (typeCounts[billType] ?? 0) + 1;
    const a = amountOf(r.dain);
    const b = amountOf(r.madin);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) invalidAmountFields += 1;
    else if (a > 0 && b > 0) bothAmountsPositive += 1;
    else if (a === 0 && b === 0) bothAmountsZero += 1;
    if (r.per_id !== null && r.per_id !== undefined && !knownCustomers.has(idOf(r.per_id))) missingCustomerRefs += 1;
    if (r.cur !== null && r.cur !== undefined && !knownCurrencies.has(idOf(r.cur))) unregisteredCurrencyRefs += 1;
  }
  for (const table of ["bill_details", "bill_details2"]) {
    for (const r of rows(payload, table)) {
      if (!knownMoves.has(idOf(r.bill_id))) missingInvoiceRefs += 1;
      if (table === "bill_details" && !knownProducts.has(idOf(r.prod_id))) missingProductRefs += 1;
    }
  }

  const warnings: string[] = [];
  if (bothAmountsPositive) warnings.push(bothAmountsPositive + " حركة فيها قيمتان موجبتان في dain/madin: يلزم تحديد المعنى.");
  if (bothAmountsZero) warnings.push(bothAmountsZero + " حركات قيمتها صفر في الحقلين.");
  if (unregisteredCurrencyRefs) warnings.push(unregisteredCurrencyRefs + " حركات تستعمل رموز عملة غير موجودة في جدول العملات.");
  if (missingCustomerRefs || missingProductRefs || missingInvoiceRefs) {
    warnings.push("توجد مراجع مفقودة؛ يلزم إصلاحها قبل الترحيل.");
  }
  if (invalidAmountFields) warnings.push(invalidAmountFields + " حركات لها مبالغ غير صالحة.");
  warnings.push("هذا مستورد أرشيف للمراجعة فقط؛ لا يغيّر أرصدة العملاء أو الأستاذ العام أو المخزون.");

  return {
    payload, sourceSha256: payload.sourceSha256, tableCounts, totalRows,
    typeCounts, bothAmountsPositive, bothAmountsZero, missingCustomerRefs,
    missingProductRefs, missingInvoiceRefs, unregisteredCurrencyRefs,
    duplicateIds, warnings,
  };
}

function archiveKey(workspaceId: string, sourceSha256: string): string {
  return workspaceId + "::" + sourceSha256;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("متصفحك لا يدعم IndexedDB."));
      return;
    }
    const request = indexedDB.open(LEGACY_ARCHIVE_DB, LEGACY_ARCHIVE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("archives")) {
        db.createObjectStore("archives", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("records")) {
        const store = db.createObjectStore("records", { keyPath: "key" });
        store.createIndex("byArchiveTable", ["archiveId", "table"], { unique: false });
        store.createIndex("byArchiveTableBill", ["archiveId", "table", "billId"], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("تعذر فتح أرشيف IndexedDB."));
    request.onblocked = () => reject(new Error("أغلق علامات التبويب الأخرى ثم حاول مجددًا."));
  });
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("تعذر قراءة البيانات."));
  });
}

export async function findStagedLegacyArchive(
  workspaceId: string, sourceSha256: string,
): Promise<StagedLegacyArchive | null> {
  const db = await openDb();
  try {
    const tx = db.transaction("archives", "readonly");
    const value = await readRequest(tx.objectStore("archives").get(archiveKey(workspaceId, sourceSha256)));
    return (value as StagedLegacyArchive | undefined) ?? null;
  } finally { db.close(); }
}

/** One IndexedDB transaction for *all* 26k+ source rows. Any error aborts everything. */
export async function stageLegacyFinancialArchive(
  workspaceId: string, inspection: LegacyInspection,
): Promise<{ alreadyImported: boolean; meta: StagedLegacyArchive }> {
  if (!workspaceId.trim()) throw new Error("معرف مساحة العمل مطلوب.");
  const key = archiveKey(workspaceId, inspection.sourceSha256);
  const existing = await findStagedLegacyArchive(workspaceId, inspection.sourceSha256);
  if (existing) return { alreadyImported: true, meta: existing };
  const db = await openDb();
  const meta: StagedLegacyArchive = {
    id: key,
    workspaceId,
    sourceSha256: inspection.sourceSha256,
    importedAt: new Date().toISOString(),
    sourceName: inspection.payload.sourceName ?? "نسخة SQLite تاريخية",
    rowCount: inspection.totalRows,
    tableCounts: inspection.tableCounts,
    typeCounts: inspection.typeCounts,
    bothAmountsPositive: inspection.bothAmountsPositive,
    unregisteredCurrencyRefs: inspection.unregisteredCurrencyRefs,
    status: "review_only",
    postedToLedger: false,
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["archives", "records"], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("أُلغيت معاملة الاستيراد بالكامل."));
      tx.onerror = () => { /* onabort handles the failure */ };
      const archives = tx.objectStore("archives");
      const records = tx.objectStore("records");
      archives.add(meta);
      for (const [table, def] of Object.entries(inspection.payload.tables)) {
        for (let i = 0; i < def.rows.length; i += 1) {
          const row = def.rows[i];
          const sourceId = idOf(row.id) || "#" + i;
          records.add({
            key: key + "::" + table + "::" + sourceId,
            archiveId: key,
            table,
            sourceId,
            billId: idOf(row.bill_id),
            row,
          });
        }
      }
    });
    return { alreadyImported: false, meta };
  } finally {
    db.close();
  }
}

export async function browseStagedLegacyRows(
  workspaceId: string, sourceSha256: string, table: string, limit = 50,
): Promise<LegacyRow[]> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error("اسم جدول غير صالح.");
  const db = await openDb();
  try {
    const tx = db.transaction("records", "readonly");
    const index = tx.objectStore("records").index("byArchiveTable");
    const values = await readRequest(index.getAll(IDBKeyRange.only([archiveKey(workspaceId, sourceSha256), table]), Math.min(200, Math.max(1, limit))));
    return (values as Array<{row:LegacyRow}>).map((x) => x.row);
  } finally { db.close(); }
}

export async function readStagedInvoiceLines(
  workspaceId: string, sourceSha256: string, invoiceId: string | number,
): Promise<{ priced: LegacyRow[]; freeText: LegacyRow[] }> {
  const db = await openDb();
  const base = archiveKey(workspaceId, sourceSha256);
  try {
    const getLines = async (table: string): Promise<LegacyRow[]> => {
      const tx = db.transaction("records", "readonly");
      const idx = tx.objectStore("records").index("byArchiveTableBill");
      const items = await readRequest(idx.getAll(IDBKeyRange.only([base, table, String(invoiceId)])));
      return (items as Array<{row:LegacyRow}>).map((x) => x.row);
    };
    const [priced, freeText] = await Promise.all([getLines("bill_details"), getLines("bill_details2")]);
    return { priced, freeText };
  } finally { db.close(); }
}
