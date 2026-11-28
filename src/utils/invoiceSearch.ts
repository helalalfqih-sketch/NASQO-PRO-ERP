import { normalizeArabicSearch } from '../accounting';
import type { InventoryItemRecord } from '../types';

type IndexedItem = { item: InventoryItemRecord; text: string; name: string };
const indexes = new WeakMap<readonly InventoryItemRecord[], IndexedItem[]>();
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const check = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError'); };

/** Local catalog search yields between bounded chunks. Cancellation stops both
 * indexing and searching; no query can post a document or alter inventory. */
export async function searchInvoiceItems(inventory: readonly InventoryItemRecord[], query: string,
  warehouseId: string, hybridLocal: boolean, signal?: AbortSignal): Promise<InventoryItemRecord[]> {
  check(signal);
  const normalized = normalizeArabicSearch(query), words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  let indexed = indexes.get(inventory);
  if (!indexed) {
    indexed = [];
    for (let offset = 0; offset < inventory.length; offset += 128) {
      await yieldTask(); check(signal);
      for (const item of inventory.slice(offset, offset + 128)) indexed.push({ item,
        name: normalizeArabicSearch(item.name),
        text: normalizeArabicSearch(`${item.name} ${item.sku ?? ''} ${item.legacyId ?? ''} ${item.id} ${item.legacySourceItemId ?? ''} ${item.unit} ${item.unit2 ?? ''} ${item.unit3 ?? ''}`) });
    }
    indexes.set(inventory, indexed);
  }
  const families = new Map<string, { best: IndexedItem; match: boolean }>();
  const rank = (item: InventoryItemRecord, family: string) => warehouseId && item.warehouseId === warehouseId
    ? item.quantityUnverified ? 1 : 0 : item.id === family ? 2 : 3;
  for (let offset = 0; offset < indexed.length; offset += 256) {
    await yieldTask(); check(signal);
    for (const candidate of indexed.slice(offset, offset + 256)) {
      const item = candidate.item;
      const family = hybridLocal ? item.catalogSourceItemId || item.legacySourceItemId || item.id : item.id;
      const found = families.get(family), match = words.every(word => candidate.text.includes(word));
      if (!found) families.set(family, { best: candidate, match });
      else {
        found.match ||= match;
        if (rank(item, family) < rank(found.best.item, family)) found.best = candidate;
      }
    }
  }
  check(signal);
  const exact = (i: InventoryItemRecord) => normalizeArabicSearch(i.sku ?? '') === normalized || String(i.legacyId ?? '') === normalized ? 0 : 1;
  const compare = (a: IndexedItem, b: IndexedItem) =>
    exact(a.item) - exact(b.item) || Number(b.name.startsWith(normalized)) - Number(a.name.startsWith(normalized)) ||
    Number(b.item.warehouseId === warehouseId) - Number(a.item.warehouseId === warehouseId);
  const top: IndexedItem[] = [];
  let count = 0;
  for (const family of families.values()) {
    if (++count % 256 === 0) { await yieldTask(); check(signal); }
    if (!family.match) continue;
    const index = top.findIndex(candidate => compare(family.best, candidate) < 0);
    if (index >= 0) top.splice(index, 0, family.best);
    else if (top.length < 10) top.push(family.best);
    if (top.length > 10) top.pop();
  }
  check(signal);
  return top.map(c => c.item);
}
