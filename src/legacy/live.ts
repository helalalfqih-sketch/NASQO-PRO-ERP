/**
 * Conversion of the legacy model into NASQO Pro workspace records.
 * Pure functions (no I/O): every output record carries a stable id derived from the SHA-256 of the
 * source copy + table + original id, so re-running an import can never create duplicates.
 */
import { CURRENCIES, type AccountCategory, type AccountRecord, type CurrencyCode, type InventoryItemRecord, type LedgerEntryRecord, type WarehouseRecord } from "../types";
import { legacyRef, type Row, type Tables } from "./adapter";
import { normalizeName, num, text, type LedgerDraft } from "./analysis";

export const livePrefix = (sha256: string) => `lg${sha256.slice(0, 10)}`;
export const liveId = (sha256: string, kind: "acc" | "wh" | "inv" | "ent", id: number | string) => `${livePrefix(sha256)}_${kind}_${id}`;

export const GROUP_CATEGORY_BY_NAME: Record<string, AccountCategory> = {
  "المبيعات": "sales",
  "المشتريات": "purchases",
  "الموردين": "purchases",
  "العملاء": "clients",
  "الموظفين": "employees",
  "المحل": "shop",
};

export type GroupSuggestion = {
  groupId: number;
  groupName: string;
  accounts: number;
  category: AccountCategory;
  matchedByName: boolean;
};

/** customers.type ➜ boxes.id (verified by the adapter: identical id sets). */
export function suggestGroupCategories(tables: Tables): GroupSuggestion[] {
  const counts = new Map<number, number>();
  for (const c of tables.customers ?? []) counts.set(Number(c.type), (counts.get(Number(c.type)) ?? 0) + 1);
  const names = new Map((tables.boxes ?? []).map((b) => [Number(b.id), text(b.name)]));
  const ids = new Set<number>([...counts.keys(), ...names.keys()]);
  return [...ids]
    .sort((a, b) => a - b)
    .filter((id) => counts.has(id))
    .map((groupId) => {
      const groupName = names.get(groupId) ?? `مجموعة ${groupId}`;
      const mapped = GROUP_CATEGORY_BY_NAME[groupName];
      return { groupId, groupName, accounts: counts.get(groupId) ?? 0, category: mapped ?? "shop", matchedByName: Boolean(mapped) };
    });
}

export type MasterData = {
  accounts: AccountRecord[];
  warehouses: WarehouseRecord[];
  inventory: InventoryItemRecord[];
  idMap: { kind: "accounts" | "warehouses" | "inventory"; legacyId: number; liveId: string }[];
  notes: {
    unmatchedGroups: string[];
    warehouseInferredForProducts: number;
    warehouseFallbackForProducts: number;
    productsWithoutLines: number;
    phoneFallbackUsed: number;
  };
};

function positiveInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export function buildMasterData(
  tables: Tables,
  sha256: string,
  ownerId: string,
  groupCategories: Record<string, AccountCategory>,
): MasterData {
  const idMap: MasterData["idMap"] = [];
  const groupNames = new Map((tables.boxes ?? []).map((b) => [Number(b.id), text(b.name)]));
  const unmatched = new Set<string>();
  let phoneFallbackUsed = 0;

  const accounts: AccountRecord[] = [];
  for (const c of tables.customers ?? []) {
    const id = Number(c.id);
    const group = Number(c.type);
    const category = groupCategories[String(group)] ?? GROUP_CATEGORY_BY_NAME[groupNames.get(group) ?? ""] ?? "shop";
    if (!GROUP_CATEGORY_BY_NAME[groupNames.get(group) ?? ""] && !groupCategories[String(group)]) unmatched.add(groupNames.get(group) ?? String(group));
    let phone = text(c.phone);
    if (!phone && text(c.phon)) { phone = text(c.phon); phoneFallbackUsed += 1; }
    const limit = num(c.lim);
    const groupLabel = groupNames.get(group);
    const note = [text(c.details), groupLabel ? `المجموعة الأصلية: ${groupLabel}` : ""].filter(Boolean).join(" | ");
    const live = liveId(sha256, "acc", id);
    accounts.push({
      id: live,
      ownerId,
      name: text(c.name) || `حساب ${id}`,
      category,
      phone,
      creditLimit: limit !== null && limit >= 0 ? limit : 0,
      currency: "ريال",
      isCashAccount: false,
      accountImage: "1",
      sortOrder: id,
      settlement: false,
      documentNumberRequired: false,
      messageMethod: "sms",
      sendMode: "never",
      note,
      // The balance is deliberately NOT derived from a single field: see the reconciliation center.
      openingBalance: 0,
      openingDirection: "debit",
      codeNumber: id,
      legacyRef: legacyRef(sha256, "customers", id),
    });
    idMap.push({ kind: "accounts", legacyId: id, liveId: live });
  }

  const warehouses: WarehouseRecord[] = [];
  const storeIds = new Set<number>();
  for (const s of tables.stores ?? []) {
    const id = Number(s.id);
    storeIds.add(id);
    const live = liveId(sha256, "wh", id);
    warehouses.push({
      id: live,
      ownerId,
      name: text(s.name) || `مخزن ${id}`,
      details: text(s.details),
      isDefault: false,
      codeNumber: id,
      legacyRef: legacyRef(sha256, "stores", id),
    });
    idMap.push({ kind: "warehouses", legacyId: id, liveId: live });
  }

  // A product can only belong to one live warehouse: use the store of its document lines (majority).
  const storeVotes = new Map<number, Map<number, number>>();
  for (const l of tables.bill_details ?? []) {
    const p = positiveInt(l.prod_id);
    const s = positiveInt(l.store_id);
    if (p === null || s === null || !storeIds.has(s)) continue;
    const votes = storeVotes.get(p) ?? new Map<number, number>();
    votes.set(s, (votes.get(s) ?? 0) + 1);
    storeVotes.set(p, votes);
  }
  const fallbackStore = [...storeIds].sort((a, b) => a - b)[0];
  let inferred = 0;
  let fallback = 0;
  const inventory: InventoryItemRecord[] = [];
  for (const p of tables.products ?? []) {
    const id = Number(p.id);
    const votes = storeVotes.get(id);
    let store = fallbackStore;
    if (votes && votes.size) {
      store = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      inferred += 1;
    } else fallback += 1;
    const cost = num(p.price2);
    const live = liveId(sha256, "inv", id);
    inventory.push({
      id: live,
      ownerId,
      name: text(p.name) || `صنف ${id}`,
      unit: text(p.unit) || "حبة",
      // Never present 0 as an approved balance: the quantity is flagged for a manual stock count.
      quantity: 0,
      quantityUnverified: true,
      avgCost: cost !== null && cost >= 0 ? cost : 0,
      minThreshold: 0,
      ...(text(p.barcode) ? { sku: text(p.barcode) } : {}),
      warehouseId: store === undefined ? "" : liveId(sha256, "wh", store),
      legacyRef: legacyRef(sha256, "products", id),
    });
    idMap.push({ kind: "inventory", legacyId: id, liveId: live });
  }
  return {
    accounts,
    warehouses,
    inventory,
    idMap,
    notes: {
      unmatchedGroups: [...unmatched],
      warehouseInferredForProducts: inferred,
      warehouseFallbackForProducts: fallback,
      productsWithoutLines: fallback,
      phoneFallbackUsed,
    },
  };
}

export type LiveSnapshotLike = {
  accounts: readonly { id: string; name: string }[];
  warehouses: readonly { id: string; name: string }[];
  inventory: readonly { id: string; name: string; sku?: string }[];
  ledger: readonly { id: string }[];
};

export type MasterDiff = {
  accounts: { add: number; alreadyPresent: number; nameCollisions: string[] };
  warehouses: { add: number; alreadyPresent: number; nameCollisions: string[] };
  inventory: { add: number; alreadyPresent: number; nameCollisions: number; skuCollisions: number };
};

/** Differences computed BEFORE writing anything (identity = stable id, never the name). */
export function diffMasterAgainstLive(master: MasterData, live: LiveSnapshotLike): MasterDiff {
  const ids = (list: readonly { id: string }[]) => new Set(list.map((x) => x.id));
  const accIds = ids(live.accounts);
  const whIds = ids(live.warehouses);
  const invIds = ids(live.inventory);
  const liveAccNames = new Map(live.accounts.map((a) => [normalizeName(a.name), a.id]));
  const liveWhNames = new Map(live.warehouses.map((a) => [normalizeName(a.name), a.id]));
  const liveInvNames = new Set(live.inventory.map((a) => normalizeName(a.name)));
  const liveSkus = new Set(live.inventory.map((a) => a.sku).filter(Boolean) as string[]);
  const collide = (list: { id: string; name: string }[], names: Map<string, string>, present: Set<string>) =>
    list.filter((x) => !present.has(x.id) && names.has(normalizeName(x.name)) && names.get(normalizeName(x.name)) !== x.id).map((x) => x.name);
  return {
    accounts: {
      add: master.accounts.filter((a) => !accIds.has(a.id)).length,
      alreadyPresent: master.accounts.filter((a) => accIds.has(a.id)).length,
      nameCollisions: collide(master.accounts, liveAccNames, accIds),
    },
    warehouses: {
      add: master.warehouses.filter((a) => !whIds.has(a.id)).length,
      alreadyPresent: master.warehouses.filter((a) => whIds.has(a.id)).length,
      nameCollisions: collide(master.warehouses, liveWhNames, whIds),
    },
    inventory: {
      add: master.inventory.filter((a) => !invIds.has(a.id)).length,
      alreadyPresent: master.inventory.filter((a) => invIds.has(a.id)).length,
      nameCollisions: master.inventory.filter((a) => !invIds.has(a.id) && liveInvNames.has(normalizeName(a.name))).length,
      skuCollisions: master.inventory.filter((a) => !invIds.has(a.id) && a.sku && liveSkus.has(a.sku)).length,
    },
  };
}

export function isSupportedCurrency(name: string): name is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(name);
}

export function buildLedgerEntries(
  drafts: LedgerDraft[],
  sha256: string,
  ownerId: string,
  accountLiveIds: ReadonlyMap<number, string>,
  accountNames: ReadonlyMap<number, string>,
): LedgerEntryRecord[] {
  return drafts.map((d) => {
    if (!isSupportedCurrency(d.currencyName)) throw new Error(`عملة غير مدعومة: ${d.currencyName}`);
    const accountId = accountLiveIds.get(d.accountLegacyId);
    if (!accountId) throw new Error(`الحساب ${d.accountLegacyId} لم يُرحَّل بعد.`);
    const counterId = d.counterAccountLegacyId === null ? "" : accountLiveIds.get(d.counterAccountLegacyId) ?? "";
    return {
      id: liveId(sha256, "ent", d.moveId),
      ownerId,
      accountId,
      accountName: accountNames.get(d.accountLegacyId) ?? "",
      counterpartAccountId: counterId,
      counterpartAccountName: d.counterAccountLegacyId === null ? "" : accountNames.get(d.counterAccountLegacyId) ?? "",
      kind: "voucher",
      typeLabel: "قيد مرحّل من النظام القديم",
      payment: "balance",
      direction: d.direction,
      amount: d.amount,
      currency: d.currencyName,
      exchangeRate: 1,
      details: d.details || `قيد قديم رقم ${d.moveId}`,
      documentNumber: d.documentNumber || `قديم-${d.moveId}`,
      warehouseId: "",
      warehouseName: "",
      invoiceContent: "none",
      entryNumber: d.moveId,
      deleted: false,
      entryDate: d.date,
      createdAtMs: Date.parse(`${d.date}T00:00:00Z`) + d.moveId,
      legacyRef: legacyRef(sha256, "input_move", d.moveId),
    } satisfies LedgerEntryRecord;
  });
}

export type { Row };
