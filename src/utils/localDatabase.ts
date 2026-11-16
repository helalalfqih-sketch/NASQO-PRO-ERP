import type {
  AccountRecord,
  InventoryItemRecord,
  LedgerEntryRecord,
  WarehouseRecord,
  WorkspaceSettings,
} from "../types.ts";

export const LOCAL_DB_NAME = "nasqo_pro_erp_db";
export const LOCAL_DB_VERSION = 1;

export type LocalDbStoreName =
  | "workspaces"
  | "accounts"
  | "ledger"
  | "warehouses"
  | "inventory"
  | "erp_modules";

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed opening IndexedDB"));
  });
}

function readAllFromStore<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error ?? new Error("Failed reading store"));
  });
}

export async function writeSnapshotToIndexedDb(
  snapshot: LocalWorkspaceDbSnapshot,
): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openLocalDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        ["workspaces", "accounts", "ledger", "warehouses", "inventory"],
        "readwrite",
      );
      tx.oncomplete = () => {
        lastSyncedAtIso = new Date().toISOString();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error("Failed writing IndexedDB"));

      const wsStore = tx.objectStore("workspaces");
      wsStore.put({ ...snapshot.workspace, backups: snapshot.backups });

      const accStore = tx.objectStore("accounts");
      accStore.clear();
      for (const acc of snapshot.accounts) accStore.put(acc);

      const ledStore = tx.objectStore("ledger");
      ledStore.clear();
      for (const entry of snapshot.ledger) ledStore.put(entry);

      const whStore = tx.objectStore("warehouses");
      whStore.clear();
      for (const wh of snapshot.warehouses) whStore.put(wh);

      const invStore = tx.objectStore("inventory");
      invStore.clear();
      for (const item of snapshot.inventory) invStore.put(item);
    });
  } finally {
    db.close();
  }
}

export async function readSnapshotFromIndexedDb(
  uid: string,
): Promise<LocalWorkspaceDbSnapshot | null> {
  if (!isIndexedDbAvailable()) return null;
  const db = await openLocalDb();
  try {
    const tx = db.transaction(
      ["workspaces", "accounts", "ledger", "warehouses", "inventory"],
      "readonly",
    );
    const [workspaces, accounts, ledger, warehouses, inventory] = await Promise.all([
      readAllFromStore<WorkspaceSettings & { backups?: { id: string; name: string; exportedAtIso: string }[] }>(
        tx.objectStore("workspaces"),
      ),
      readAllFromStore<AccountRecord>(tx.objectStore("accounts")),
      readAllFromStore<LedgerEntryRecord>(tx.objectStore("ledger")),
      readAllFromStore<WarehouseRecord>(tx.objectStore("warehouses")),
      readAllFromStore<InventoryItemRecord>(tx.objectStore("inventory")),
    ]);

    const ws = workspaces.find((w) => w.id === uid) ?? workspaces[0];
    if (!ws || accounts.length === 0) return null;

    const { backups = [], ...workspaceFields } = ws;
    return {
      workspace: workspaceFields,
      accounts,
      ledger,
      warehouses,
      inventory,
      backups,
    };
  } finally {
    db.close();
  }
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
  const db = await openLocalDb();
  try {
    const tx = db.transaction(["erp_modules"], "readonly");
    const rows = await readAllFromStore<{ uid: string; data: T }>(
      tx.objectStore("erp_modules"),
    );
    const match = rows.find((r) => r.uid === (uid || "local"));
    return match ? match.data : null;
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
      engine: "localStorage",
      dbName: "nasqo-local-workspace-v1",
      accountsCount: 0,
      ledgerCount: 0,
      warehousesCount: 0,
      inventoryCount: 0,
      erpModulesSaved: false,
      lastSyncedAt: lastSyncedAtIso,
    };
  }
  const db = await openLocalDb();
  try {
    const tx = db.transaction(
      ["accounts", "ledger", "warehouses", "inventory", "erp_modules"],
      "readonly",
    );
    const [accounts, ledger, warehouses, inventory, erpModules] = await Promise.all([
      readAllFromStore<AccountRecord>(tx.objectStore("accounts")),
      readAllFromStore<LedgerEntryRecord>(tx.objectStore("ledger")),
      readAllFromStore<WarehouseRecord>(tx.objectStore("warehouses")),
      readAllFromStore<InventoryItemRecord>(tx.objectStore("inventory")),
      readAllFromStore<{ uid: string }>(tx.objectStore("erp_modules")),
    ]);

    return {
      engine: "IndexedDB",
      dbName: LOCAL_DB_NAME,
      accountsCount: accounts.length,
      ledgerCount: ledger.length,
      warehousesCount: warehouses.length,
      inventoryCount: inventory.length,
      erpModulesSaved: erpModules.some((m) => m.uid === (uid || "local")),
      lastSyncedAt: lastSyncedAtIso,
    };
  } finally {
    db.close();
  }
}

export async function clearLocalDatabase(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openLocalDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        ["workspaces", "accounts", "ledger", "warehouses", "inventory", "erp_modules"],
        "readwrite",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed clearing IndexedDB"));
      for (const name of [
        "workspaces",
        "accounts",
        "ledger",
        "warehouses",
        "inventory",
        "erp_modules",
      ] as const) {
        tx.objectStore(name).clear();
      }
    });
  } finally {
    db.close();
  }
}
