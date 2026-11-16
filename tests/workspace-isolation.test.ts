import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  LOCAL_DB_NAME, LOCAL_DB_VERSION, clearLocalDatabase,
  getLocalDatabaseStats, readSnapshotFromIndexedDb, writeSnapshotToIndexedDb,
  type LocalWorkspaceDbSnapshot,
} from "../src/utils/localDatabase";

function installIsolatedBrowser() {
  const factory = new IDBFactory();
  Object.defineProperty(globalThis, "window", { value: { indexedDB: factory }, configurable: true });
  Object.defineProperty(globalThis, "IDBKeyRange", { value: IDBKeyRange, configurable: true });
  return factory;
}

function snapshot(uid: string, quantity: number): LocalWorkspaceDbSnapshot {
  return {
    workspace: {
      id: uid, ownerId: uid, companyName: `نسقو ${uid}`,
      defaultCurrency: "ريال", whatsappProvider: "nasqo",
      whatsappInstantEnabled: false, whatsappPhone: "",
    },
    accounts: [{
      id: "shared_account_id", ownerId: uid, name: `عميل ${uid}`,
      category: "clients", phone: "", creditLimit: 0, currency: "ريال",
      isCashAccount: false, accountImage: "1", sortOrder: 1, settlement: false,
      documentNumberRequired: false, messageMethod: "sms", sendMode: "never",
      note: "", openingBalance: 0, openingDirection: "debit", codeNumber: 12,
      legacyRef: "abc012345678:customers:12",
    }],
    ledger: [],
    warehouses: [{ id: "shared_warehouse_id", ownerId: uid, name: "مستودع", details: "", isDefault: true, codeNumber: 1 }],
    inventory: [{ id: "shared_product_id", ownerId: uid, name: `صنف ${uid}`, unit: "حبة", quantity,
      avgCost: 55, sellingPrice: 100, quantityUnverified: false,
      warehouseId: "shared_warehouse_id", legacyRef: "abc012345678:products:20" }],
    backups: [],
  };
}

test("owner-scoped v2 records never overwrite other workspaces, even with same source IDs", async () => {
  installIsolatedBrowser();
  assert.equal(LOCAL_DB_VERSION, 2);
  const localUid = "local-erp-workspace";
  const remoteUid = "google-user-55";
  await writeSnapshotToIndexedDb(snapshot(localUid, 7));
  await writeSnapshotToIndexedDb(snapshot(remoteUid, 81));
  assert.equal((await readSnapshotFromIndexedDb(localUid))?.inventory[0]?.quantity, 7);
  assert.equal((await readSnapshotFromIndexedDb(remoteUid))?.inventory[0]?.quantity, 81);
  const modified = snapshot(localUid, 15);
  await writeSnapshotToIndexedDb(modified);
  assert.equal((await readSnapshotFromIndexedDb(localUid))?.inventory[0]?.quantity, 15);
  assert.equal((await readSnapshotFromIndexedDb(remoteUid))?.inventory[0]?.quantity, 81);
  assert.equal((await getLocalDatabaseStats(localUid)).inventoryCount, 1);
  assert.equal((await getLocalDatabaseStats(remoteUid)).inventoryCount, 1);
  assert.equal(await readSnapshotFromIndexedDb("unknown-user"), null);

  await clearLocalDatabase(localUid);
  assert.equal(await readSnapshotFromIndexedDb(localUid), null);
  assert.equal((await readSnapshotFromIndexedDb(remoteUid))?.inventory[0]?.quantity, 81);
});

test("version-one IndexedDB snapshot remains readable and is copied only for its owner", async () => {
  const factory = installIsolatedBrowser();
  const uid = "local-erp-workspace";
  const old = snapshot(uid, 12);
  const db1 = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(LOCAL_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("workspaces", { keyPath: "id" });
      db.createObjectStore("accounts", { keyPath: "id" });
      db.createObjectStore("ledger", { keyPath: "id" });
      db.createObjectStore("warehouses", { keyPath: "id" });
      db.createObjectStore("inventory", { keyPath: "id" });
      db.createObjectStore("erp_modules", { keyPath: "uid" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db1.transaction(["workspaces", "accounts", "warehouses", "inventory"], "readwrite");
    tx.objectStore("workspaces").put(old.workspace);
    tx.objectStore("accounts").put(old.accounts[0]);
    tx.objectStore("warehouses").put(old.warehouses[0]);
    tx.objectStore("inventory").put(old.inventory[0]);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db1.close();
  assert.equal((await readSnapshotFromIndexedDb(uid))?.inventory[0]?.quantity, 12);
  await writeSnapshotToIndexedDb(snapshot(uid, 25));
  assert.equal((await readSnapshotFromIndexedDb(uid))?.inventory[0]?.quantity, 25);
  await writeSnapshotToIndexedDb(snapshot("google-user-99", 91));
  assert.equal((await readSnapshotFromIndexedDb(uid))?.inventory[0]?.quantity, 25);
  assert.equal((await readSnapshotFromIndexedDb("google-user-99"))?.inventory[0]?.quantity, 91);
});
