import type {
  AccountRecord,
  InventoryItemRecord,
  LedgerEntryRecord,
  WarehouseRecord,
  WorkspaceSettings,
} from "../types.ts";

export const LOCAL_DB_NAME = "nasqo_pro_erp_db";
export const LOCAL_DB_VERSION = 2;

// v1 stores are retained read-only for non-destructive migration. The v2
// compound keys let two authenticated workspaces share original document IDs.
const SCOPED_STORES = ["accounts_v2", "ledger_v2", "warehouses_v2", "inventory_v2"] as const;
type ScopedStoreName = (typeof SCOPED_STORES)[number];

export type LocalDbStoreName =
  | "workspaces"
  | "accounts"
  | "ledger"
  | "warehouses"
  | "inventory"
  | "erp_modules"
  | ScopedStoreName;

export type LocalWorkspaceDbSnapshot = {
  workspace: WorkspaceSettings;
  accounts: AccountRecord[];
  ledger: LedgerEntryRecord[];
  warehouses: WarehouseRecord[];
  inventory: InventoryItemRecord[];
  backups: { id: string; name: string; exportedAtIso: string }[];
};

export type LocalDatabaseStats = {
  engine: "IndexedDB" | "localStorage";
  dbName: string;
  accountsCount: number;
  ledgerCount: number;
  warehousesCount: number;
  inventoryCount: number;
  erpModulesSaved: boolean;
  lastSyncedAt: string | null;
};

let lastSyncedAtIso: string | null = null;

export function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = window.indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    let finished = false;
    const complete = () => {
      if (finished) return false;
      finished = true;
      clearTimeout(deadline);
      return true;
    };
    // A blocked upgrade used to leave the app on its loading screen forever.
    // A timeout does not delete or reset any browser database.
    const deadline = setTimeout(() => {
      if (complete()) reject(new Error(
        "تأخر فتح قاعدة البيانات المحلية. أغلق نوافذ نسق برو الأخرى ثم اضغط إعادة المحاولة. بياناتك لم تُحذف.",
      ));
    }, 10_000);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("workspaces")) {
        db.createObjectStore("workspaces", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("accounts")) {
        const store = db.createObjectStore("accounts", { keyPath: "id" });
        store.createIndex("category", "category", { unique: false });
      }
      if (!db.objectStoreNames.contains("ledger")) {
        const store = db.createObjectStore("ledger", { keyPath: "id" });
        store.createIndex("accountId", "accountId", { unique: false });
        store.createIndex("entryDate", "entryDate", { unique: false });
      }
      if (!db.objectStoreNames.contains("warehouses")) {
        db.createObjectStore("warehouses", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("inventory")) {
        const store = db.createObjectStore("inventory", { keyPath: "id" });
        store.createIndex("warehouseId", "warehouseId", { unique: false });
      }
      if (!db.objectStoreNames.contains("erp_modules")) {
        db.createObjectStore("erp_modules", { keyPath: "uid" });
      }
      for (const name of SCOPED_STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const scoped = db.createObjectStore(name, { keyPath: ["ownerId", "id"] });
        scoped.createIndex("byOwner", "ownerId", { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A future new release must be able to upgrade while this tab is open.
      db.onversionchange = () => db.close();
      if (complete()) resolve(db);
      else db.close();
    };
    req.onerror = () => {
      if (complete()) reject(req.error ?? new Error("تعذر فتح IndexedDB"));
    };
    req.onblocked = () => {
      if (complete()) reject(new Error(
        "تحديث قاعدة البيانات محجوب بواسطة علامة تبويب أخرى لنسق برو. أغلقها ثم اضغط إعادة المحاولة؛ لم تُمسح بياناتك.",
      ));
    };
  });
}

/** Open the version ALREADY on disk. Reading must not require a schema
 * upgrade, since an older installed PWA tab may still own a v1 connection.
 * Never create an empty database merely to check for historical records. */
function openExistingLocalDbForRead(): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) { resolve(null); return; }
    const request = window.indexedDB.open(LOCAL_DB_NAME);
    let finished = false;
    let wasAbsent = false;
    const deadline = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error("تعذر الوصول إلى قاعدة بيانات الهاتف. لم يتم حذف أي بيانات."));
      }
    }, 8_000);
    const finish = () => {
      if (finished) return false;
      finished = true;
      clearTimeout(deadline);
      return true;
    };
    request.onupgradeneeded = () => {
      // This event only occurs when no database exists yet. Never leave an
      // accidental v1 database behind just because we attempted a read.
      wasAbsent = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (finish()) resolve(db);
      else db.close();
    };
    request.onerror = () => {
      if (!finish()) return;
      if (wasAbsent && request.error?.name === "AbortError") resolve(null);
      else reject(request.error ?? new Error("تعذر قراءة قاعدة بيانات الهاتف"));
    };
    request.onblocked = () => {
      if (finish()) reject(new Error("توجد عملية أخرى تمنع قراءة قاعدة البيانات. لم يتم حذف بياناتك."));
    };
  });
}

function readAllFromStore<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error ?? new Error("Failed reading store"));
  });
}

function replaceOwnedRows<T extends { id: string; ownerId: string }>(
  tx: IDBTransaction,
  storeName: ScopedStoreName,
  uid: string,
  items: readonly T[],
): void {
  const store = tx.objectStore(storeName);
  const request = store.index("byOwner").getAllKeys(IDBKeyRange.only(uid));
  request.onsuccess = () => {
    // Atomic replacement of exactly one workspace; never delete other owners.
    for (const key of request.result) store.delete(key);
    for (const item of items) store.put({ ...item, ownerId: uid });
  };
}

/** Store one workspace atomically without clearing records of other accounts. */
export async function writeSnapshotToIndexedDb(
  snapshot: LocalWorkspaceDbSnapshot,
): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openLocalDb();
  try {
    const uid = snapshot.workspace.id;
    if (!uid || snapshot.workspace.ownerId !== uid) {
      throw new Error("معرف مساحة العمل غير متطابق؛ تم إيقاف الحفظ لحماية البيانات.");
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["workspaces", ...SCOPED_STORES], "readwrite");
      tx.oncomplete = () => {
        lastSyncedAtIso = new Date().toISOString();
        resolve();
      };
      tx.onabort = () => reject(tx.error ?? new Error("Failed saving workspace in IndexedDB"));
      tx.onerror = () => reject(tx.error ?? new Error("Failed writing IndexedDB"));
      tx.objectStore("workspaces").put({ ...snapshot.workspace, backups: snapshot.backups, snapshotVersion: 2 });
      replaceOwnedRows(tx, "accounts_v2", uid, snapshot.accounts);
      replaceOwnedRows(tx, "ledger_v2", uid, snapshot.ledger);
      replaceOwnedRows(tx, "warehouses_v2", uid, snapshot.warehouses);
      replaceOwnedRows(tx, "inventory_v2", uid, snapshot.inventory);
    });
  } finally {
    db.close();
  }
}

/** Read only the requested workspace. Old v1 rows remain readable until that
 * specific workspace is first saved into v2; no background destructive copy. */
export async function readSnapshotFromIndexedDb(
  uid: string,
): Promise<LocalWorkspaceDbSnapshot | null> {
  if (!isIndexedDbAvailable()) return null;
  const db = await openExistingLocalDbForRead();
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains("workspaces")) return null;
    const wsRequest = db.transaction("workspaces", "readonly").objectStore("workspaces").get(uid);
    const ws = await new Promise<(WorkspaceSettings & { backups?: LocalWorkspaceDbSnapshot["backups"]; snapshotVersion?: number }) | undefined>((resolve, reject) => {
      wsRequest.onsuccess = () => resolve(wsRequest.result);
      wsRequest.onerror = () => reject(wsRequest.error ?? new Error("Failed reading workspace"));
    });
    if (!ws) return null;

    const usesV2 = ws.snapshotVersion === 2;
    const storeNames = usesV2 ? [...SCOPED_STORES] : ["accounts", "ledger", "warehouses", "inventory"];
    if (storeNames.some((name) => !db.objectStoreNames.contains(name))) {
      throw new Error("قاعدة البيانات لا تحتوي على الجداول المطلوبة. لم تُغيّر بياناتك.");
    }
    const tx = db.transaction(storeNames, "readonly");
    const readStore = async <T extends { ownerId: string }>(name: string): Promise<T[]> => {
      const store = tx.objectStore(name);
      const records = usesV2
        ? await readAllFromIndex<T>(store.index("byOwner"), IDBKeyRange.only(uid))
        : await readAllFromStore<T>(store);
      return records.filter((record) => record.ownerId === uid);
    };
    const [accounts, ledger, warehouses, inventory] = await Promise.all([
      readStore<AccountRecord>(storeNames[0]),
      readStore<LedgerEntryRecord>(storeNames[1]),
      readStore<WarehouseRecord>(storeNames[2]),
      readStore<InventoryItemRecord>(storeNames[3]),
    ]);
    // A v1 workspace with no accounts often means an older cross-workspace
    // cache overwrite. Prefer the surviving localStorage data to an empty v1
    // mirror; v2 explicitly permits an intentional empty workspace.
    if (!usesV2 && accounts.length === 0) return null;
    const { backups = [], snapshotVersion: _version, ...workspaceFields } = ws;
    return { workspace: workspaceFields, accounts, ledger, warehouses, inventory, backups };
  } finally {
    db.close();
  }
}

function readAllFromIndex<T>(index: IDBIndex, range: IDBKeyRange): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = index.getAll(range);
    request.onsuccess = () => resolve((request.result as T[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error("Failed reading scoped records"));
  });
}

export async function saveErpDataToIndexedDb(uid: string, data: unknown): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openLocalDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["erp_modules"], "readwrite");
      tx.oncomplete = () => {
        lastSyncedAtIso = new Date().toISOString();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error("Failed writing ERP modules"));
      tx.objectStore("erp_modules").put({ uid: uid || "local", data, updatedAt: Date.now() });
    });
  } finally {
    db.close();
  }
}

export async function readErpDataFromIndexedDb<T>(uid: string): Promise<T | null> {
  if (!isIndexedDbAvailable()) return null;
  const db = await openExistingLocalDbForRead();
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains("erp_modules")) return null;
    const row = await new Promise<{ uid: string; data: T } | undefined>((resolve, reject) => {
      const request = db.transaction("erp_modules", "readonly")
        .objectStore("erp_modules").get(uid || "local");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("تعذر قراءة وحدات ERP"));
    });
    return row?.data ?? null;
  } finally {
    db.close();
  }
}

export async function exportIndexedDbSnapshot(uid: string): Promise<{
  exportedAtIso: string;
  dbName: string;
  version: number;
  uid: string;
  workspaceSnapshot: LocalWorkspaceDbSnapshot | null;
  erpModules: unknown;
}> {
  const [workspaceSnapshot, erpModules] = await Promise.all([
    readSnapshotFromIndexedDb(uid),
    readErpDataFromIndexedDb(uid),
  ]);
  return {
    exportedAtIso: new Date().toISOString(),
    dbName: LOCAL_DB_NAME,
    version: LOCAL_DB_VERSION,
    uid,
    workspaceSnapshot,
    erpModules,
  };
}

export async function getLocalDatabaseStats(uid: string): Promise<LocalDatabaseStats> {
  if (!isIndexedDbAvailable()) {
    return {
      engine: "localStorage", dbName: "nasqo-local-workspace-v1",
      accountsCount: 0, ledgerCount: 0, warehousesCount: 0,
      inventoryCount: 0, erpModulesSaved: false, lastSyncedAt: lastSyncedAtIso,
    };
  }
  const [snap, erp] = await Promise.all([readSnapshotFromIndexedDb(uid), readErpDataFromIndexedDb(uid)]);
  return {
    engine: "IndexedDB", dbName: LOCAL_DB_NAME,
    accountsCount: snap?.accounts.length ?? 0,
    ledgerCount: snap?.ledger.length ?? 0,
    warehousesCount: snap?.warehouses.length ?? 0,
    inventoryCount: snap?.inventory.length ?? 0,
    erpModulesSaved: erp !== null,
    lastSyncedAt: lastSyncedAtIso,
  };
}

/** Reset only the local workspace; never remove another Google workspace's cache. */
export async function clearLocalDatabase(uid = "local-erp-workspace"): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openLocalDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        ["workspaces", ...SCOPED_STORES, "accounts", "ledger", "warehouses", "inventory", "erp_modules"],
        "readwrite",
      );
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Failed clearing this workspace"));
      tx.onerror = () => reject(tx.error ?? new Error("Failed clearing IndexedDB"));
      tx.objectStore("workspaces").delete(uid);
      tx.objectStore("erp_modules").delete(uid);
      for (const scoped of SCOPED_STORES) {
        const store = tx.objectStore(scoped);
        const request = store.index("byOwner").getAllKeys(IDBKeyRange.only(uid));
        request.onsuccess = () => {
          for (const key of request.result) store.delete(key);
        };
      }
      // Non-destructive compatibility cleanup for owned v1 rows only.
      for (const legacy of ["accounts", "ledger", "warehouses", "inventory"]) {
        const store = tx.objectStore(legacy);
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          if (cursor.value?.ownerId === uid) cursor.delete();
          cursor.continue();
        };
      }
    });
  } finally {
    db.close();
  }
}
