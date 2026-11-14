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

function makeDocId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 14)
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export async function ensureWorkspaceSeeded(uid: string, displayName?: string | null): Promise<void> {
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
    { id: "inv_1", name: "ابجورة شكل قمر", unit: "حبة", quantity: 40, avgCost: 2200, warehouseId: "wh_3" },
    { id: "inv_2", name: "توصيلة تايب سي 2 متر", unit: "حبة", quantity: 120, avgCost: 1500, warehouseId: "wh_1" },
    { id: "inv_3", name: "بطارية جهاز كشف الذهب", unit: "حبة", quantity: 25, avgCost: 1500, warehouseId: "wh_1" },
    { id: "inv_4", name: "فواحة عطرية خازن", unit: "حبة", quantity: 35, avgCost: 3400, warehouseId: "wh_3" },
    { id: "inv_5", name: "مكينة خياطة كبير", unit: "حبة", quantity: 12, avgCost: 10000, warehouseId: "wh_1" },
    { id: "inv_6", name: "عازل سطوح 10 كيلو", unit: "كيلو", quantity: 18, avgCost: 33000, warehouseId: "wh_1" },
    { id: "inv_7", name: "فرامة لحم", unit: "حبة", quantity: 15, avgCost: 3000, warehouseId: "wh_4" },
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

  const starterLedger: Omit<LedgerEntryRecord, "ownerId" | "createdAtMs">[] = [
    { id: "ent_1108", accountId: "acc_barari", accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "voucher", typeLabel: "عليه", payment: "cash", direction: "debit", amount: 20000, currency: "ريال", exchangeRate: 1, details: "تسوية حساب مورد", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "none", entryNumber: 1108, deleted: false, entryDate: "2025-12-25" },
    { id: "ent_1136", accountId: "acc_barari", accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "فاتورة آجلة", payment: "credit", direction: "credit", amount: 4000, currency: "ريال", exchangeRate: 1, details: "زينة منازل شكل شجرة | 1 حبة", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1136, deleted: false, entryDate: "2025-12-26" },
    { id: "ent_1178", accountId: "acc_barari", accountName: "البراري للتوريد", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "فاتورة آجلة", payment: "credit", direction: "credit", amount: 33000, currency: "ريال", exchangeRate: 1, details: "عازل سطوح 10 كيلو | 1 كيلو", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1178, deleted: false, entryDate: "2025-12-28" },
    { id: "ent_1090", accountId: "acc_naqd_hilal", accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 17000, currency: "ريال", exchangeRate: 1, details: "فواحة عطرية خازن | 5 حبة", documentNumber: "", warehouseId: "wh_3", warehouseName: "مخازن بينون", invoiceContent: "items", entryNumber: 1090, deleted: false, entryDate: "2025-12-24" },
    { id: "ent_1140", accountId: "acc_naqd_hilal", accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 3000, currency: "ريال", exchangeRate: 1, details: "توصيلة تايب سي 2 متر | 1 حبة\nبطارية جهاز كشف الذهب | 1 حبة", documentNumber: "1140", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1140, deleted: false, entryDate: "2025-12-26" },
    { id: "ent_1218", accountId: "acc_naqd_hilal", accountName: "نقـد هلال", counterpartAccountId: "", counterpartAccountName: "", kind: "invoice", typeLabel: "ف.ش.نقدي", payment: "cash", direction: "credit", amount: 20000, currency: "ريال", exchangeRate: 1, details: "محلات بن عوضة\nمكينة خياطة كبير | 2 حبة", documentNumber: "", warehouseId: "wh_1", warehouseName: "المخزن الرئيسي", invoiceContent: "items", entryNumber: 1218, deleted: false, entryDate: "2025-12-29" },
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

export function subscribeWorkspace(
  uid: string,
  callbacks: {
    onWorkspace: (ws: WorkspaceSettings | null) => void;
    onAccounts: (accounts: AccountRecord[]) => void;
    onLedger: (entries: LedgerEntryRecord[]) => void;
    onWarehouses: (warehouses: WarehouseRecord[]) => void;
    onInventory: (items: InventoryItemRecord[]) => void;
  },
): () => void {
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
        const list: LedgerEntryRecord[] = snap.docs.map((d) => {
          const data = d.data();
          const ts = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
          return {
            id: d.id,
            ownerId: String(data.ownerId ?? uid),
            accountId: String(data.accountId ?? ""),
            accountName: String(data.accountName ?? ""),
            counterpartAccountId: String(data.counterpartAccountId ?? ""),
            counterpartAccountName: String(data.counterpartAccountName ?? ""),
            kind: data.kind ?? "voucher",
            typeLabel: String(data.typeLabel ?? "سند"),
            payment: data.payment ?? "cash",
            direction: data.direction === "credit" ? "credit" : "debit",
            amount: Number(data.amount ?? 0),
            currency: data.currency ?? "ريال",
            exchangeRate: Number(data.exchangeRate ?? 1),
            details: String(data.details ?? ""),
            documentNumber: String(data.documentNumber ?? ""),
            warehouseId: String(data.warehouseId ?? ""),
            warehouseName: String(data.warehouseName ?? ""),
            invoiceContent: data.invoiceContent ?? "none",
            entryNumber: Number(data.entryNumber ?? 1),
            deleted: Boolean(data.deleted),
            entryDate: String(data.entryDate ?? ""),
            createdAtMs: ts,
          };
        });
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
  const path = `workspaces/${uid}`;
  try {
    const clean = sanitizeWorkspacePayload({ ...updates, ownerId: uid });
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
  const path = `workspaces/${uid}/accounts/${id}`;
  const clean = sanitizeAccountPayload({ ...account, ownerId: uid });
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
  const path = `workspaces/${uid}/ledger/${id}`;
  const clean = sanitizeLedgerPayload({ ...entry, ownerId: uid });
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
  const path = `workspaces/${uid}/ledger/${entryId}`;
  const clean = sanitizeLedgerPayload({ ...entry, ownerId: uid });
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
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function setLedgerDeleted(uid: string, entryId: string, deleted: boolean): Promise<void> {
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
  const path = `workspaces/${uid}/warehouses/${id}`;
  const clean = sanitizeWarehousePayload({ ...warehouse, ownerId: uid });
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
  const path = `workspaces/${uid}/inventory/${id}`;
  const clean = sanitizeInventoryPayload({ ...item, ownerId: uid });
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
