import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";
import {
  sanitizeAccountPayload,
  sanitizeInventoryPayload,
  sanitizeLedgerPayload,
  sanitizeWarehousePayload,
  sanitizeWorkspacePayload,
} from "./accounting";
import type {
  AccountRecord,
  InventoryItemRecord,
  LedgerEntryRecord,
  WarehouseRecord,
  WorkspaceSettings,
} from "./types";
import {
  clearLocalDatabase,
  isIndexedDbAvailable,
  readSnapshotFromIndexedDb,
  writeSnapshotToIndexedDb,
} from "./utils/localDatabase";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
void testConnection();

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export const LOCAL_WORKSPACE_UID = "local-erp-workspace";
const LOCAL_WORKSPACE_STORAGE_KEY = "nasqo-local-workspace-v1";
const LOCAL_SESSION_STORAGE_KEY = "nasqo-local-session-active";

export function isLocalWorkspaceSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LOCAL_SESSION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLocalWorkspaceSession(active: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (active) {
      window.localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

type LocalWorkspaceSnapshot = {
  workspace: WorkspaceSettings;
  accounts: AccountRecord[];
  ledger: LedgerEntryRecord[];
  warehouses: WarehouseRecord[];
  inventory: InventoryItemRecord[];
  backups: { id: string; name: string; exportedAtIso: string }[];
};

type WorkspaceCallbacks = {
  onWorkspace: (ws: WorkspaceSettings | null) => void;
  onAccounts: (accounts: AccountRecord[]) => void;
  onLedger: (entries: LedgerEntryRecord[]) => void;
  onWarehouses: (warehouses: WarehouseRecord[]) => void;
  onInventory: (items: InventoryItemRecord[]) => void;
};

const localListeners = new Set<WorkspaceCallbacks>();

function buildStarterSnapshot(uid: string, displayName?: string | null): LocalWorkspaceSnapshot {
  const daysAgoIso = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const workspace: WorkspaceSettings = {
    id: uid,
    ownerId: uid,
    companyName: displayName ? `نشاط ${displayName}` : "نسقو برو ERP",
    defaultCurrency: "ريال",
    whatsappProvider: "nasqo",
    whatsappInstantEnabled: false,
    whatsappPhone: "",
  };

  const warehouses: WarehouseRecord[] = [
    { id: "wh_1", ownerId: uid, name: "المخزن الرئيسي", details: "المستودع الافتراضي", isDefault: true, codeNumber: 1 },
    { id: "wh_3", ownerId: uid, name: "مخازن بينون", details: "مستودع البضائع العام", isDefault: false, codeNumber: 3 },
    { id: "wh_4", ownerId: uid, name: "بينون", details: "فرع التوريد", isDefault: false, codeNumber: 4 },
  ];

  const inventory: InventoryItemRecord[] = [
    { id: "inv_1", ownerId: uid, name: "ابجورة شكل قمر", unit: "حبة", quantity: 40, avgCost: 2200, minThreshold: 25, sku: "SKU-1001", warehouseId: "wh_3" },
    { id: "inv_2", ownerId: uid, name: "توصيلة تايب سي 2 متر", unit: "حبة", quantity: 120, avgCost: 1500, minThreshold: 30, sku: "SKU-1002", warehouseId: "wh_1" },
    { id: "inv_3", ownerId: uid, name: "بطارية جهاز كشف الذهب", unit: "حبة", quantity: 25, avgCost: 1500, minThreshold: 25, sku: "SKU-1003", warehouseId: "wh_1" },
    { id: "inv_4", ownerId: uid, name: "فواحة عطرية خازن", unit: "حبة", quantity: 35, avgCost: 3400, minThreshold: 20, sku: "SKU-1004", warehouseId: "wh_3" },
    { id: "inv_5", ownerId: uid, name: "مكينة خياطة كبير", unit: "حبة", quantity: 12, avgCost: 10000, minThreshold: 25, sku: "SKU-1005", warehouseId: "wh_1" },
    { id: "inv_6", ownerId: uid, name: "عازل سطوح 10 كيلو", unit: "كيلو", quantity: 18, avgCost: 33000, minThreshold: 25, sku: "SKU-1006", warehouseId: "wh_1" },
    { id: "inv_7", ownerId: uid, name: "فرامة لحم", unit: "حبة", quantity: 15, avgCost: 3000, minThreshold: 25, sku: "SKU-1007", warehouseId: "wh_4" },
  ];

  const accounts: AccountRecord[] = [
    { id: "acc_barari", ownerId: uid, name: "البراري للتوريد", category: "purchases", phone: "055 832 1042", creditLimit: 1000000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 1, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 243450, openingDirection: "credit", codeNumber: 34 },
    { id: "acc_naqd_hilal", ownerId: uid, name: "نقـد هلال", category: "purchases", phone: "050 441 7731", creditLimit: 500000, currency: "ريال", isCashAccount: true, accountImage: "1", sortOrder: 2, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "حساب المشتريات النقدية", openingBalance: 0, openingDirection: "credit", codeNumber: 9 },
    { id: "acc_waha", ownerId: uid, name: "الواحة التجارية", category: "purchases", phone: "053 190 6208", creditLimit: 750000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 3, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 227601, openingDirection: "credit", codeNumber: 49 },
    { id: "acc_khatabi", ownerId: uid, name: "خطابي وشركاه", category: "purchases", phone: "056 710 8824", creditLimit: 250000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 4, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 64000, openingDirection: "debit", codeNumber: 53 },
    { id: "acc_bashar", ownerId: uid, name: "بشار العزي", category: "purchases", phone: "", creditLimit: 1000000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 5, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 227601, openingDirection: "credit", codeNumber: 6 },
    { id: "acc_client_noor", ownerId: uid, name: "شركة النور للتجارة", category: "clients", phone: "055 210 9934", creditLimit: 400000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 6, settlement: false, documentNumberRequired: false, messageMethod: "whatsapp", sendMode: "confirm", note: "عميل جملة رئيسي", openingBalance: 48500, openingDirection: "debit", codeNumber: 55 },
    { id: "acc_shop_main", ownerId: uid, name: "حساب المحل", category: "shop", phone: "", creditLimit: 500000, currency: "ريال", isCashAccount: false, accountImage: "2", sortOrder: 7, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "مصروفات وتشغيل المحل", openingBalance: 261100, openingDirection: "debit", codeNumber: 60 },
    { id: "acc_emp_1", ownerId: uid, name: "رواتب الموظفين", category: "employees", phone: "", creditLimit: 200000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 8, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 10500, openingDirection: "credit", codeNumber: 61 },
    { id: "acc_sales_1", ownerId: uid, name: "المبيعات العامة", category: "sales", phone: "", creditLimit: 2000000, currency: "ريال", isCashAccount: false, accountImage: "3", sortOrder: 9, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 172650, openingDirection: "debit", codeNumber: 62 },
  ];

  const baseMs = Date.now() - 20 * 86_400_000;
  const ledger: LedgerEntryRecord[] = [
    { id: "ent_1108", ownerId: uid, accountId: "acc_barari", accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "voucher", typeLabel: "عليه", payment: "cash", direction: "debit", amount: 20000, currency: "ريال", exchangeRate: 1, details: "تسوية حساب مورد", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "none", entryNumber: 1108, deleted: false, entryDate: daysAgoIso(18), expenseCategory: "مشتريات بضائع", deliveryDays: 3, createdAtMs: baseMs + 1000 },
    { id: "ent_1136", ownerId: uid, accountId: "acc_barari", accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "فاتورة آجلة", payment: "credit", direction: "credit", amount: 4000, currency: "ريال", exchangeRate: 1, details: "زينة منازل شكل شجرة | 1 حبة", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1136, deleted: false, entryDate: daysAgoIso(11), expenseCategory: "مشتريات بضائع", deliveryDays: 2, createdAtMs: baseMs + 2000 },
    { id: "ent_1178", ownerId: uid, accountId: "acc_barari", accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "فاتورة آجلة", payment: "credit", direction: "credit", amount: 33000, currency: "ريال", exchangeRate: 1, details: "عازل سطوح 10 كيلو | 1 كيلو", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1178, deleted: false, entryDate: daysAgoIso(5), dueDate: daysAgoIso(-3), expenseCategory: "مشتريات بضائع", deliveryDays: 4, createdAtMs: baseMs + 3000 },
    { id: "ent_1090", ownerId: uid, accountId: "acc_naqd_hilal", accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 17000, currency: "ريال", exchangeRate: 1, details: "فواحة عطرية خازن | 5 حبة", documentNumber: "", warehouseId: "wh_3", warehouseName: "مخازن بينون", invoiceContent: "items", entryNumber: 1090, deleted: false, entryDate: daysAgoIso(14), expenseCategory: "مشتريات بضائع", deliveryDays: 1, createdAtMs: baseMs + 4000 },
    { id: "ent_1140", ownerId: uid, accountId: "acc_naqd_hilal", accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 3000, currency: "ريال", exchangeRate: 1, details: "توصيلة تايب سي 2 متر | 1 حبة\nبطارية جهاز كشف الذهب | 1 حبة", documentNumber: "1140", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1140, deleted: false, entryDate: daysAgoIso(6), expenseCategory: "مشتريات بضائع", deliveryDays: 2, createdAtMs: baseMs + 5000 },
    { id: "ent_1218", ownerId: uid, accountId: "acc_naqd_hilal", accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 20000, currency: "ريال", exchangeRate: 1, details: "محلات بن عوضة\nمكينة خياطة كبير | 2 حبة", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1218, deleted: false, entryDate: daysAgoIso(3), expenseCategory: "شحن ونقل", deliveryDays: 2, createdAtMs: baseMs + 6000 },
    { id: "ent_1225", ownerId: uid, accountId: "acc_shop_main", accountName: "حساب المحل", counterpartAccountId: "", counterpartAccountName: "", kind: "voucher", typeLabel: "عليه (سند)", payment: "cash", direction: "debit", amount: 6500, currency: "ريال", exchangeRate: 1, details: "فاتورة كهرباء وصيانة مستودع", documentNumber: "1225", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "none", entryNumber: 1225, deleted: false, entryDate: daysAgoIso(4), expenseCategory: "صيانة ومرافق", createdAtMs: baseMs + 7000 },
    { id: "ent_1230", ownerId: uid, accountId: "acc_emp_1", accountName: "رواتب الموظفين", counterpartAccountId: "", counterpartAccountName: "", kind: "voucher", typeLabel: "عليه (سند)", payment: "cash", direction: "debit", amount: 12000, currency: "ريال", exchangeRate: 1, details: "دفعة رواتب شهرية", documentNumber: "1230", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "none", entryNumber: 1230, deleted: false, entryDate: daysAgoIso(2), expenseCategory: "رواتب وأجور", createdAtMs: baseMs + 8000 },
    { id: "ent_1235", ownerId: uid, accountId: "acc_sales_1", accountName: "المبيعات العامة", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "debit", amount: 24500, currency: "ريال", exchangeRate: 1, details: "مبيعات أجهزة وتجهيزات", documentNumber: "1235", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1235, deleted: false, entryDate: daysAgoIso(1), createdAtMs: baseMs + 9000 },
    { id: "ent_1236", ownerId: uid, accountId: "acc_sales_1", accountName: "المبيعات العامة", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "debit", amount: 18500, currency: "ريال", exchangeRate: 1, details: "مبيعات الجملة اليومية", documentNumber: "1236", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1236, deleted: false, entryDate: daysAgoIso(0), createdAtMs: baseMs + 10000 },
  ];

  return { workspace, accounts, ledger, warehouses, inventory, backups: [] };
}

function readLocalSnapshot(): LocalWorkspaceSnapshot {
  if (typeof window === "undefined") return buildStarterSnapshot(LOCAL_WORKSPACE_UID);
  try {
    const raw = window.localStorage.getItem(LOCAL_WORKSPACE_STORAGE_KEY);
    if (!raw) {
      const seeded = buildStarterSnapshot(LOCAL_WORKSPACE_UID);
      window.localStorage.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as Partial<LocalWorkspaceSnapshot>;
    const fallback = buildStarterSnapshot(LOCAL_WORKSPACE_UID);
    return {
      workspace: parsed.workspace ?? fallback.workspace,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : fallback.accounts,
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger : fallback.ledger,
      warehouses: Array.isArray(parsed.warehouses) ? parsed.warehouses : fallback.warehouses,
      inventory: Array.isArray(parsed.inventory) ? parsed.inventory : fallback.inventory,
      backups: Array.isArray(parsed.backups) ? parsed.backups : [],
    };
  } catch {
    return buildStarterSnapshot(LOCAL_WORKSPACE_UID);
  }
}

function notifyLocalListeners(snapshot: LocalWorkspaceSnapshot) {
  const sortedAccounts = [...snapshot.accounts].sort((a, b) => a.sortOrder - b.sortOrder || a.codeNumber - b.codeNumber);
  const sortedWarehouses = [...snapshot.warehouses].sort((a, b) => a.codeNumber - b.codeNumber);
  const sortedInventory = [...snapshot.inventory].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  for (const cb of localListeners) {
    cb.onWorkspace(snapshot.workspace);
    cb.onAccounts(sortedAccounts);
    cb.onLedger([...snapshot.ledger]);
    cb.onWarehouses(sortedWarehouses);
    cb.onInventory(sortedInventory);
  }
}

function writeLocalSnapshot(snapshot: LocalWorkspaceSnapshot) {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore quota issues
    }
    if (isIndexedDbAvailable()) {
      void writeSnapshotToIndexedDb(snapshot).catch(() => {});
    }
  }
  notifyLocalListeners(snapshot);
}

function makeDocId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 14)
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export async function ensureWorkspaceSeeded(uid: string, displayName?: string | null): Promise<void> {
  if (uid === LOCAL_WORKSPACE_UID) {
    const localSnap = readLocalSnapshot();
    if (isIndexedDbAvailable()) {
      try {
        const dbSnap = await readSnapshotFromIndexedDb(uid);
        if (dbSnap) {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(dbSnap));
          }
          notifyLocalListeners(dbSnap);
        } else {
          await writeSnapshotToIndexedDb(localSnap);
        }
      } catch {
        // Fallback cleanly to localStorage snapshot
      }
    }
    return;
  }
  const wsPath = `workspaces/${uid}`;
  const wsRef = doc(db, "workspaces", uid);

  try {
    const existingWs = await getDoc(wsRef);
    if (!existingWs.exists()) {
      const payload = sanitizeWorkspacePayload({
        ownerId: uid,
        companyName: displayName ? `نشاط ${displayName}` : "نسقو برو",
        defaultCurrency: "ريال",
        whatsappProvider: "nasqo",
        whatsappInstantEnabled: false,
        whatsappPhone: "",
      });
      await setDoc(wsRef, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, wsPath);
  }

  const accountsPath = `workspaces/${uid}/accounts`;
  try {
    const existingAccounts = await getDocs(
      query(collection(db, "workspaces", uid, "accounts"), where("ownerId", "==", uid), limit(1)),
    );
    if (!existingAccounts.empty) return;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, accountsPath);
  }

  // Seed initial chart of accounts, warehouses, inventory, and starter entries once for new workspaces.
  const batch = writeBatch(db);

  const starterWarehouses: (Omit<WarehouseRecord, "ownerId"> & { id: string })[] = [
    { id: "wh_1", name: "المخزن الرئيسي", details: "المستودع الافتراضي", isDefault: true, codeNumber: 1 },
    { id: "wh_3", name: "مخازن بينون", details: "مستودع البضائع العام", isDefault: false, codeNumber: 3 },
    { id: "wh_4", name: "بينون", details: "فرع التوريد", isDefault: false, codeNumber: 4 },
  ];
  for (const wh of starterWarehouses) {
    const payload = sanitizeWarehousePayload({ ...wh, ownerId: uid });
    batch.set(doc(db, "workspaces", uid, "warehouses", wh.id), {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const starterItems = [
    { id: "inv_1", name: "ابجورة شكل قمر", unit: "حبة", quantity: 40, avgCost: 2200, minThreshold: 25, sku: "SKU-1001", warehouseId: "wh_3" },
    { id: "inv_2", name: "توصيلة تايب سي 2 متر", unit: "حبة", quantity: 120, avgCost: 1500, minThreshold: 30, sku: "SKU-1002", warehouseId: "wh_1" },
    { id: "inv_3", name: "بطارية جهاز كشف الذهب", unit: "حبة", quantity: 25, avgCost: 1500, minThreshold: 25, sku: "SKU-1003", warehouseId: "wh_1" },
    { id: "inv_4", name: "فواحة عطرية خازن", unit: "حبة", quantity: 35, avgCost: 3400, minThreshold: 20, sku: "SKU-1004", warehouseId: "wh_3" },
    { id: "inv_5", name: "مكينة خياطة كبير", unit: "حبة", quantity: 12, avgCost: 10000, minThreshold: 25, sku: "SKU-1005", warehouseId: "wh_1" },
    { id: "inv_6", name: "عازل سطوح 10 كيلو", unit: "كيلو", quantity: 18, avgCost: 33000, minThreshold: 25, sku: "SKU-1006", warehouseId: "wh_1" },
    { id: "inv_7", name: "فرامة لحم", unit: "حبة", quantity: 15, avgCost: 3000, minThreshold: 25, sku: "SKU-1007", warehouseId: "wh_4" },
  ];
  for (const item of starterItems) {
    const payload = sanitizeInventoryPayload({ ...item, ownerId: uid });
    batch.set(doc(db, "workspaces", uid, "inventory", item.id), {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const starterAccounts: Omit<AccountRecord, "ownerId">[] = [
    { id: "acc_barari", name: "البراري للتوريد", category: "purchases", phone: "055 832 1042", creditLimit: 1000000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 1, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 243450, openingDirection: "credit", codeNumber: 34 },
    { id: "acc_naqd_hilal", name: "نقـد هلال", category: "purchases", phone: "050 441 7731", creditLimit: 500000, currency: "ريال", isCashAccount: true, accountImage: "1", sortOrder: 2, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "حساب المشتريات النقدية", openingBalance: 0, openingDirection: "credit", codeNumber: 9 },
    { id: "acc_waha", name: "الواحة التجارية", category: "purchases", phone: "053 190 6208", creditLimit: 750000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 3, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 227601, openingDirection: "credit", codeNumber: 49 },
    { id: "acc_khatabi", name: "خطابي وشركاه", category: "purchases", phone: "056 710 8824", creditLimit: 250000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 4, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 64000, openingDirection: "debit", codeNumber: 53 },
    { id: "acc_bashar", name: "بشار العزي", category: "purchases", phone: "", creditLimit: 1000000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 5, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 227601, openingDirection: "credit", codeNumber: 6 },
    { id: "acc_shop_main", name: "حساب المحل", category: "shop", phone: "", creditLimit: 500000, currency: "ريال", isCashAccount: false, accountImage: "2", sortOrder: 6, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "مصروفات وتشغيل المحل", openingBalance: 261100, openingDirection: "debit", codeNumber: 60 },
    { id: "acc_emp_1", name: "رواتب الموظفين", category: "employees", phone: "", creditLimit: 200000, currency: "ريال", isCashAccount: false, accountImage: "1", sortOrder: 7, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 10500, openingDirection: "credit", codeNumber: 61 },
    { id: "acc_sales_1", name: "المبيعات العامة", category: "sales", phone: "", creditLimit: 2000000, currency: "ريال", isCashAccount: false, accountImage: "3", sortOrder: 8, settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never", note: "", openingBalance: 172650, openingDirection: "debit", codeNumber: 62 },
  ];
  for (const acc of starterAccounts) {
    const payload = sanitizeAccountPayload({ ...acc, ownerId: uid });
    batch.set(doc(db, "workspaces", uid, "accounts", acc.id), {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const daysAgoIso = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const starterLedger: Omit<LedgerEntryRecord, "ownerId" | "createdAtMs">[] = [
    { id: "ent_1108", accountId: "acc_barari", accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "voucher", typeLabel: "عليه", payment: "cash", direction: "debit", amount: 20000, currency: "ريال", exchangeRate: 1, details: "تسوية حساب مورد", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "none", entryNumber: 1108, deleted: false, entryDate: daysAgoIso(18), expenseCategory: "مشتريات بضائع", deliveryDays: 3 },
    { id: "ent_1136", accountId: "acc_barari", accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "فاتورة آجلة", payment: "credit", direction: "credit", amount: 4000, currency: "ريال", exchangeRate: 1, details: "زينة منازل شكل شجرة | 1 حبة", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1136, deleted: false, entryDate: daysAgoIso(11), expenseCategory: "مشتريات بضائع", deliveryDays: 2 },
    { id: "ent_1178", accountId: "acc_barari", accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "فاتورة آجلة", payment: "credit", direction: "credit", amount: 33000, currency: "ريال", exchangeRate: 1, details: "عازل سطوح 10 كيلو | 1 كيلو", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1178, deleted: false, entryDate: daysAgoIso(5), dueDate: daysAgoIso(-3), expenseCategory: "مشتريات بضائع", deliveryDays: 4 },
    { id: "ent_1090", accountId: "acc_naqd_hilal", accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 17000, currency: "ريال", exchangeRate: 1, details: "فواحة عطرية خازن | 5 حبة", documentNumber: "", warehouseId: "wh_3", warehouseName: "مخازن بينون", invoiceContent: "items", entryNumber: 1090, deleted: false, entryDate: daysAgoIso(14), expenseCategory: "مشتريات بضائع", deliveryDays: 1 },
    { id: "ent_1140", accountId: "acc_naqd_hilal", accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 3000, currency: "ريال", exchangeRate: 1, details: "توصيلة تايب سي 2 متر | 1 حبة\nبطارية جهاز كشف الذهب | 1 حبة", documentNumber: "1140", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1140, deleted: false, entryDate: daysAgoIso(6), expenseCategory: "مشتريات بضائع", deliveryDays: 2 },
    { id: "ent_1218", accountId: "acc_naqd_hilal", accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 20000, currency: "ريال", exchangeRate: 1, details: "محلات بن عوضة\nمكينة خياطة كبير | 2 حبة", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1218, deleted: false, entryDate: daysAgoIso(3), expenseCategory: "شحن ونقل", deliveryDays: 2 },
    { id: "ent_1225", accountId: "acc_shop_main", accountName: "حساب المحل", counterpartAccountId: "", counterpartAccountName: "", kind: "voucher", typeLabel: "عليه (سند)", payment: "cash", direction: "debit", amount: 6500, currency: "ريال", exchangeRate: 1, details: "فاتورة كهرباء وصيانة مستودع", documentNumber: "1225", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "none", entryNumber: 1225, deleted: false, entryDate: daysAgoIso(4), expenseCategory: "صيانة ومرافق" },
    { id: "ent_1230", accountId: "acc_emp_1", accountName: "رواتب الموظفين", counterpartAccountId: "", counterpartAccountName: "", kind: "voucher", typeLabel: "عليه (سند)", payment: "cash", direction: "debit", amount: 12000, currency: "ريال", exchangeRate: 1, details: "دفعة رواتب شهرية", documentNumber: "1230", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "none", entryNumber: 1230, deleted: false, entryDate: daysAgoIso(2), expenseCategory: "رواتب وأجور" },
    { id: "ent_1235", accountId: "acc_sales_1", accountName: "المبيعات العامة", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "debit", amount: 24500, currency: "ريال", exchangeRate: 1, details: "مبيعات أجهزة وتجهيزات", documentNumber: "1235", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1235, deleted: false, entryDate: daysAgoIso(1) },
    { id: "ent_1236", accountId: "acc_sales_1", accountName: "المبيعات العامة", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "debit", amount: 18500, currency: "ريال", exchangeRate: 1, details: "مبيعات الجملة اليومية", documentNumber: "1236", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1236, deleted: false, entryDate: daysAgoIso(0) },
  ];
  for (const entry of starterLedger) {
    const payload = sanitizeLedgerPayload({ ...entry, ownerId: uid });
    batch.set(doc(db, "workspaces", uid, "ledger", entry.id), {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workspaces/${uid}/seed`);
  }
}

function mapLedgerDoc(id: string, uid: string, data: Record<string, unknown>): LedgerEntryRecord {
  const ts = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
  return {
    id,
    ownerId: String(data.ownerId ?? uid),
    accountId: String(data.accountId ?? ""),
    accountName: String(data.accountName ?? ""),
    counterpartAccountId: String(data.counterpartAccountId ?? ""),
    counterpartAccountName: String(data.counterpartAccountName ?? ""),
    kind: (data.kind as LedgerEntryRecord["kind"]) ?? "voucher",
    typeLabel: String(data.typeLabel ?? "سند"),
    payment: (data.payment as LedgerEntryRecord["payment"]) ?? "cash",
    direction: data.direction === "credit" ? "credit" : "debit",
    amount: Number(data.amount ?? 0),
    currency: (data.currency as LedgerEntryRecord["currency"]) ?? "ريال",
    exchangeRate: Number(data.exchangeRate ?? 1),
    details: String(data.details ?? ""),
    documentNumber: String(data.documentNumber ?? ""),
    warehouseId: String(data.warehouseId ?? ""),
    warehouseName: String(data.warehouseName ?? ""),
    invoiceContent: (data.invoiceContent as LedgerEntryRecord["invoiceContent"]) ?? "none",
    entryNumber: Number(data.entryNumber ?? 1),
    deleted: Boolean(data.deleted),
    entryDate: String(data.entryDate ?? ""),
    ...(typeof data.dueDate === "string" && data.dueDate ? { dueDate: data.dueDate } : {}),
    ...(typeof data.expenseCategory === "string" && data.expenseCategory
      ? { expenseCategory: data.expenseCategory }
      : {}),
    ...(typeof data.deliveryDays === "number" ? { deliveryDays: data.deliveryDays } : {}),
    createdAtMs: ts,
  };
}

export function subscribeWorkspace(
  uid: string,
  callbacks: WorkspaceCallbacks,
): () => void {
  if (uid === LOCAL_WORKSPACE_UID) {
    localListeners.add(callbacks);
    const snapshot = readLocalSnapshot();
    queueMicrotask(() => {
      callbacks.onWorkspace(snapshot.workspace);
      callbacks.onAccounts([...snapshot.accounts].sort((a, b) => a.sortOrder - b.sortOrder || a.codeNumber - b.codeNumber));
      callbacks.onLedger([...snapshot.ledger]);
      callbacks.onWarehouses([...snapshot.warehouses].sort((a, b) => a.codeNumber - b.codeNumber));
      callbacks.onInventory([...snapshot.inventory].sort((a, b) => a.name.localeCompare(b.name, "ar")));
    });
    return () => {
      localListeners.delete(callbacks);
    };
  }
  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      doc(db, "workspaces", uid),
      (snap) => {
        if (!snap.exists()) {
          callbacks.onWorkspace(null);
          return;
        }
        const d = snap.data();
        callbacks.onWorkspace({
          id: snap.id,
          ownerId: String(d.ownerId ?? uid),
          companyName: String(d.companyName ?? "نسقو برو"),
          defaultCurrency: d.defaultCurrency ?? "ريال",
          whatsappProvider: d.whatsappProvider === "external" ? "external" : "nasqo",
          whatsappInstantEnabled: Boolean(d.whatsappInstantEnabled),
          whatsappPhone: String(d.whatsappPhone ?? ""),
        });
      },
      (err) => handleFirestoreError(err, OperationType.GET, `workspaces/${uid}`),
    ),
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, "workspaces", uid, "accounts"), where("ownerId", "==", uid)),
      (snap) => {
        const list: AccountRecord[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId ?? uid),
            name: String(data.name ?? ""),
            category: data.category ?? "purchases",
            phone: String(data.phone ?? ""),
            creditLimit: Number(data.creditLimit ?? 0),
            currency: data.currency ?? "ريال",
            isCashAccount: Boolean(data.isCashAccount),
            accountImage: data.accountImage === "2" || data.accountImage === "3" ? data.accountImage : "1",
            sortOrder: Number(data.sortOrder ?? 1),
            settlement: Boolean(data.settlement),
            documentNumberRequired: Boolean(data.documentNumberRequired),
            messageMethod: data.messageMethod === "whatsapp" ? "whatsapp" : "sms",
            sendMode: data.sendMode === "auto" || data.sendMode === "confirm" ? data.sendMode : "never",
            note: String(data.note ?? ""),
            openingBalance: Number(data.openingBalance ?? 0),
            openingDirection: data.openingDirection === "credit" ? "credit" : "debit",
            codeNumber: Number(data.codeNumber ?? 1),
          };
        });
        list.sort((a, b) => a.sortOrder - b.sortOrder || a.codeNumber - b.codeNumber);
        callbacks.onAccounts(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `workspaces/${uid}/accounts`),
    ),
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, "workspaces", uid, "ledger"), where("ownerId", "==", uid)),
      (snap) => {
        const list: LedgerEntryRecord[] = snap.docs.map((d) => mapLedgerDoc(d.id, uid, d.data()));
        callbacks.onLedger(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `workspaces/${uid}/ledger`),
    ),
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, "workspaces", uid, "warehouses"), where("ownerId", "==", uid)),
      (snap) => {
        const list: WarehouseRecord[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId ?? uid),
            name: String(data.name ?? ""),
            details: String(data.details ?? ""),
            isDefault: Boolean(data.isDefault),
            codeNumber: Number(data.codeNumber ?? 1),
          };
        });
        list.sort((a, b) => a.codeNumber - b.codeNumber);
        callbacks.onWarehouses(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `workspaces/${uid}/warehouses`),
    ),
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, "workspaces", uid, "inventory"), where("ownerId", "==", uid)),
      (snap) => {
        const list: InventoryItemRecord[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId ?? uid),
            name: String(data.name ?? ""),
            unit: String(data.unit ?? "حبة"),
            quantity: Number(data.quantity ?? 0),
            avgCost: Number(data.avgCost ?? 0),
            minThreshold: typeof data.minThreshold === "number" ? data.minThreshold : 25,
            ...(typeof data.sku === "string" && data.sku ? { sku: data.sku } : {}),
            warehouseId: String(data.warehouseId ?? ""),
          };
        });
        list.sort((a, b) => a.name.localeCompare(b.name, "ar"));
        callbacks.onInventory(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `workspaces/${uid}/inventory`),
    ),
  );

  return () => {
    unsubs.forEach((u) => u());
  };
}

export async function saveWorkspaceSettings(
  uid: string,
  updates: Partial<Omit<WorkspaceSettings, "id" | "ownerId">> & WorkspaceSettings,
) {
  const clean = sanitizeWorkspacePayload({ ...updates, ownerId: uid });
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    snap.workspace = {
      id: uid,
      ownerId: uid,
      companyName: clean.companyName,
      defaultCurrency: clean.defaultCurrency,
      whatsappProvider: clean.whatsappProvider,
      whatsappInstantEnabled: clean.whatsappInstantEnabled,
      whatsappPhone: clean.whatsappPhone,
    };
    writeLocalSnapshot(snap);
    return;
  }
  const path = `workspaces/${uid}`;
  try {
    await updateDoc(doc(db, "workspaces", uid), {
      companyName: clean.companyName,
      defaultCurrency: clean.defaultCurrency,
      whatsappProvider: clean.whatsappProvider,
      whatsappInstantEnabled: clean.whatsappInstantEnabled,
      whatsappPhone: clean.whatsappPhone,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function createOrUpdateAccount(
  uid: string,
  account: Partial<AccountRecord> & { name: string },
  existingId?: string,
): Promise<string> {
  const id = existingId || makeDocId("acc");
  const clean = sanitizeAccountPayload({ ...account, ownerId: uid });
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    const record: AccountRecord = { id, ...clean };
    const idx = snap.accounts.findIndex((a) => a.id === id);
    if (idx >= 0) {
      snap.accounts[idx] = { ...snap.accounts[idx], ...record, codeNumber: snap.accounts[idx].codeNumber };
    } else {
      snap.accounts.push(record);
    }
    writeLocalSnapshot(snap);
    return id;
  }
  const path = `workspaces/${uid}/accounts/${id}`;
  try {
    if (existingId) {
      await updateDoc(doc(db, "workspaces", uid, "accounts", id), {
        name: clean.name,
        category: clean.category,
        phone: clean.phone,
        creditLimit: clean.creditLimit,
        currency: clean.currency,
        isCashAccount: clean.isCashAccount,
        accountImage: clean.accountImage,
        sortOrder: clean.sortOrder,
        settlement: clean.settlement,
        documentNumberRequired: clean.documentNumberRequired,
        messageMethod: clean.messageMethod,
        sendMode: clean.sendMode,
        note: clean.note,
        openingBalance: clean.openingBalance,
        openingDirection: clean.openingDirection,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, "workspaces", uid, "accounts", id), {
        ...clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return id;
  } catch (err) {
    handleFirestoreError(err, existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function createLedgerEntry(
  uid: string,
  entry: Partial<LedgerEntryRecord> & { accountId: string; accountName: string },
): Promise<string> {
  const id = makeDocId("ent");
  const clean = sanitizeLedgerPayload({ ...entry, ownerId: uid });
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    snap.ledger.push({ id, ...clean, createdAtMs: Date.now() });
    writeLocalSnapshot(snap);
    return id;
  }
  const path = `workspaces/${uid}/ledger/${id}`;
  try {
    await setDoc(doc(db, "workspaces", uid, "ledger", id), {
      ...clean,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateLedgerEntry(
  uid: string,
  entryId: string,
  entry: Partial<LedgerEntryRecord> & { accountId: string; accountName: string },
): Promise<void> {
  const clean = sanitizeLedgerPayload({ ...entry, ownerId: uid });
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    const idx = snap.ledger.findIndex((e) => e.id === entryId);
    if (idx >= 0) {
      snap.ledger[idx] = { ...snap.ledger[idx], ...clean };
      writeLocalSnapshot(snap);
    }
    return;
  }
  const path = `workspaces/${uid}/ledger/${entryId}`;
  try {
    await updateDoc(doc(db, "workspaces", uid, "ledger", entryId), {
      accountId: clean.accountId,
      accountName: clean.accountName,
      counterpartAccountId: clean.counterpartAccountId,
      counterpartAccountName: clean.counterpartAccountName,
      kind: clean.kind,
      typeLabel: clean.typeLabel,
      payment: clean.payment,
      direction: clean.direction,
      amount: clean.amount,
      currency: clean.currency,
      exchangeRate: clean.exchangeRate,
      details: clean.details,
      documentNumber: clean.documentNumber,
      warehouseId: clean.warehouseId,
      warehouseName: clean.warehouseName,
      invoiceContent: clean.invoiceContent,
      entryDate: clean.entryDate,
      ...(clean.dueDate ? { dueDate: clean.dueDate } : {}),
      ...(clean.expenseCategory ? { expenseCategory: clean.expenseCategory } : {}),
      ...(clean.deliveryDays !== undefined ? { deliveryDays: clean.deliveryDays } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function setLedgerDeleted(uid: string, entryId: string, deleted: boolean): Promise<void> {
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    const idx = snap.ledger.findIndex((e) => e.id === entryId);
    if (idx >= 0) {
      snap.ledger[idx] = { ...snap.ledger[idx], deleted };
      writeLocalSnapshot(snap);
    }
    return;
  }
  const path = `workspaces/${uid}/ledger/${entryId}`;
  try {
    await updateDoc(doc(db, "workspaces", uid, "ledger", entryId), {
      deleted,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function permanentlyDeleteLedger(uid: string, entryId: string): Promise<void> {
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    snap.ledger = snap.ledger.filter((e) => e.id !== entryId);
    writeLocalSnapshot(snap);
    return;
  }
  const path = `workspaces/${uid}/ledger/${entryId}`;
  try {
    await deleteDoc(doc(db, "workspaces", uid, "ledger", entryId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function saveWarehouse(
  uid: string,
  warehouse: Partial<WarehouseRecord> & { name: string },
  allWarehouses: readonly WarehouseRecord[],
  existingId?: string,
): Promise<string> {
  const id = existingId || makeDocId("wh");
  const clean = sanitizeWarehousePayload({ ...warehouse, ownerId: uid });
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    if (clean.isDefault) {
      snap.warehouses = snap.warehouses.map((w) => ({ ...w, isDefault: w.id === id }));
    }
    const idx = snap.warehouses.findIndex((w) => w.id === id);
    if (idx >= 0) {
      snap.warehouses[idx] = { ...snap.warehouses[idx], name: clean.name, details: clean.details, isDefault: clean.isDefault };
    } else {
      snap.warehouses.push({ id, ...clean });
    }
    writeLocalSnapshot(snap);
    return id;
  }
  const path = `workspaces/${uid}/warehouses/${id}`;
  try {
    const batch = writeBatch(db);
    if (clean.isDefault) {
      for (const other of allWarehouses) {
        if (other.id !== id && other.isDefault) {
          batch.update(doc(db, "workspaces", uid, "warehouses", other.id), {
            isDefault: false,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }
    if (existingId) {
      batch.update(doc(db, "workspaces", uid, "warehouses", id), {
        name: clean.name,
        details: clean.details,
        isDefault: clean.isDefault,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(doc(db, "workspaces", uid, "warehouses", id), {
        ...clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function createInventoryItem(
  uid: string,
  item: Partial<InventoryItemRecord> & { name: string; warehouseId: string },
): Promise<string> {
  const id = makeDocId("inv");
  const clean = sanitizeInventoryPayload({ ...item, ownerId: uid });
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    snap.inventory.push({ id, ...clean });
    writeLocalSnapshot(snap);
    return id;
  }
  const path = `workspaces/${uid}/inventory/${id}`;
  try {
    await setDoc(doc(db, "workspaces", uid, "inventory", id), {
      ...clean,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateInventoryItem(
  uid: string,
  itemId: string,
  item: Partial<InventoryItemRecord> & { name: string; warehouseId: string },
): Promise<void> {
  const clean = sanitizeInventoryPayload({ ...item, ownerId: uid });
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    const idx = snap.inventory.findIndex((i) => i.id === itemId);
    if (idx >= 0) {
      snap.inventory[idx] = { id: itemId, ...clean };
      writeLocalSnapshot(snap);
    }
    return;
  }
  const path = `workspaces/${uid}/inventory/${itemId}`;
  try {
    await updateDoc(doc(db, "workspaces", uid, "inventory", itemId), {
      name: clean.name,
      unit: clean.unit,
      quantity: clean.quantity,
      avgCost: clean.avgCost,
      minThreshold: clean.minThreshold,
      ...(clean.sku ? { sku: clean.sku } : {}),
      warehouseId: clean.warehouseId,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function batchUpdateInventoryItems(
  uid: string,
  updates: readonly {
    item: InventoryItemRecord;
    quantity?: number;
    avgCost?: number;
    minThreshold?: number;
  }[],
): Promise<void> {
  if (updates.length === 0) return;
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    for (const entry of updates) {
      const clean = sanitizeInventoryPayload({
        ...entry.item,
        ownerId: uid,
        quantity: entry.quantity ?? entry.item.quantity,
        avgCost: entry.avgCost ?? entry.item.avgCost,
        minThreshold: entry.minThreshold ?? entry.item.minThreshold,
      });
      const idx = snap.inventory.findIndex((i) => i.id === entry.item.id);
      if (idx >= 0) {
        snap.inventory[idx] = { id: entry.item.id, ...clean };
      }
    }
    writeLocalSnapshot(snap);
    return;
  }
  const path = `workspaces/${uid}/inventory/batch`;
  try {
    const batch = writeBatch(db);
    for (const entry of updates) {
      const clean = sanitizeInventoryPayload({
        ...entry.item,
        ownerId: uid,
        quantity: entry.quantity ?? entry.item.quantity,
        avgCost: entry.avgCost ?? entry.item.avgCost,
        minThreshold: entry.minThreshold ?? entry.item.minThreshold,
      });
      batch.update(doc(db, "workspaces", uid, "inventory", entry.item.id), {
        name: clean.name,
        unit: clean.unit,
        quantity: clean.quantity,
        avgCost: clean.avgCost,
        minThreshold: clean.minThreshold,
        ...(clean.sku ? { sku: clean.sku } : {}),
        warehouseId: clean.warehouseId,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function createCloudBackupRecord(
  uid: string,
  payload: {
    name: string;
    accountsCount: number;
    ledgerCount: number;
    warehousesCount: number;
    inventoryCount: number;
    exportedAtIso: string;
  },
): Promise<string> {
  const id = makeDocId("bkp");
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    snap.backups.push({
      id,
      name: String(payload.name || "نسخة احتياطية").trim().slice(0, 120) || "نسخة احتياطية",
      exportedAtIso: String(payload.exportedAtIso).slice(0, 40),
    });
    writeLocalSnapshot(snap);
    return id;
  }
  const path = `workspaces/${uid}/backups/${id}`;
  try {
    await setDoc(doc(db, "workspaces", uid, "backups", id), {
      ownerId: uid,
      name: String(payload.name || "نسخة احتياطية").trim().slice(0, 120) || "نسخة احتياطية",
      accountsCount: Math.max(0, Math.round(payload.accountsCount)),
      ledgerCount: Math.max(0, Math.round(payload.ledgerCount)),
      warehousesCount: Math.max(0, Math.round(payload.warehousesCount)),
      inventoryCount: Math.max(0, Math.round(payload.inventoryCount)),
      exportedAtIso: String(payload.exportedAtIso).slice(0, 40),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function syncLocalWorkspaceToIndexedDb(
  uid: string,
  liveData?: {
    workspace?: WorkspaceSettings | null;
    accounts: readonly AccountRecord[];
    ledger: readonly LedgerEntryRecord[];
    warehouses: readonly WarehouseRecord[];
    inventory: readonly InventoryItemRecord[];
  },
): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  if (uid === LOCAL_WORKSPACE_UID) {
    const snap = readLocalSnapshot();
    await writeSnapshotToIndexedDb(snap);
    return;
  }
  if (liveData?.workspace) {
    await writeSnapshotToIndexedDb({
      workspace: liveData.workspace,
      accounts: [...liveData.accounts],
      ledger: [...liveData.ledger],
      warehouses: [...liveData.warehouses],
      inventory: [...liveData.inventory],
      backups: [],
    });
  }
}

export async function resetLocalWorkspaceDatabase(): Promise<void> {
  const seeded = buildStarterSnapshot(LOCAL_WORKSPACE_UID);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(seeded));
    } catch {
      // Ignore quota issues
    }
  }
  if (isIndexedDbAvailable()) {
    try {
      await clearLocalDatabase();
      await writeSnapshotToIndexedDb(seeded);
    } catch {
      // Fallback cleanly
    }
  }
  notifyLocalListeners(seeded);
}

export async function fetchInvoiceFromDatabase(
  uid: string,
  entryId: string,
): Promise<LedgerEntryRecord | null> {
  const target = String(entryId || "").trim();
  if (!target) return null;

  if (uid === LOCAL_WORKSPACE_UID) {
    if (isIndexedDbAvailable()) {
      try {
        const dbSnap = await readSnapshotFromIndexedDb(uid);
        const match = dbSnap?.ledger.find(
          (e) => e.id === target || String(e.entryNumber) === target,
        );
        if (match) return match;
      } catch {
        // Fallback to localStorage snapshot below
      }
    }
    const localSnap = readLocalSnapshot();
    return (
      localSnap.ledger.find(
        (e) => e.id === target || String(e.entryNumber) === target,
      ) ?? null
    );
  }

  const validDocId = /^[a-zA-Z0-9_-]{1,128}$/.test(target);
  if (validDocId) {
    const docPath = `workspaces/${uid}/ledger/${target}`;
    try {
      const snap = await getDoc(doc(db, "workspaces", uid, "ledger", target));
      if (snap.exists()) {
        return mapLedgerDoc(snap.id, uid, snap.data());
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, docPath);
    }
  }

  const numericTarget = Number(target);
  if (Number.isFinite(numericTarget)) {
    const listPath = `workspaces/${uid}/ledger`;
    try {
      const q = query(
        collection(db, "workspaces", uid, "ledger"),
        where("ownerId", "==", uid),
        where("entryNumber", "==", numericTarget),
        limit(1),
      );
      const querySnap = await getDocs(q);
      if (!querySnap.empty) {
        const d = querySnap.docs[0];
        return mapLedgerDoc(d.id, uid, d.data());
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, listPath);
    }
  }

  return null;
}
