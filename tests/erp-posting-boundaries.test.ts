import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeSqliteDb, getSqliteDb, ensureEmptyWorkspace, upsertAccountRow,
  upsertWarehouseRow, insertInventoryItemRow, insertLedgerEntryRow,
  exportWorkspaceJsonBackup, postDraftLedgerEntryRow, restoreUnifiedJsonBundle,
} from '../server/sqliteDb.ts';
const w = 'qa-erp-posting';
function fixture(run: (db: ReturnType<typeof getSqliteDb>, data: ReturnType<typeof seed>) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasqo-posting-boundaries-'));
  try { closeSqliteDb(); const db = getSqliteDb(path.join(dir, 'qa.sqlite')); ensureEmptyWorkspace(db, w); run(db, seed(db)); }
  finally { closeSqliteDb(); fs.rmSync(dir, { recursive: true, force: true }); }
}
function seed(db: ReturnType<typeof getSqliteDb>) {
  const account = upsertAccountRow(db, w, { name: 'QA Account', category: 'clients', currency: 'ريال' });
  const a = upsertWarehouseRow(db, w, { name: 'QA A' }), b = upsertWarehouseRow(db, w, { name: 'QA B' });
  const item = insertInventoryItemRow(db, w, { name: 'QA Item', unit: 'حبة', quantity: 10, avgCost: 100, warehouseId: a.id });
  const sale = { accountId: account.id, accountName: account.name, kind: 'invoice' as const, direction: 'debit' as const, payment: 'credit' as const,
    entryDate: '2026-11-27', currency: 'ريال', amount: 300, invoiceContent: 'items' as const, warehouseId: a.id,
    lines: [{ inventoryItemId: item.id, itemName: item.name, warehouseId: a.id, unit: 'حبة', quantity: 2, price: 150, total: 300 }] };
  return { account, a, b, item, sale };
}
function snapshot(db: ReturnType<typeof getSqliteDb>) { return JSON.stringify(exportWorkspaceJsonBackup(db, w).sqliteSnapshot); }

test('posting cannot consume another warehouse and rejected writes preserve all tables', () => fixture((db, s) => {
  const before = snapshot(db);
  assert.throws(() => insertLedgerEntryRow(db, w, { ...s.sale, warehouseId: s.b.id, lines: [{ ...s.sale.lines[0], warehouseId: s.b.id }] }), /مخزن/);
  assert.equal(snapshot(db), before);
  assert.throws(() => insertLedgerEntryRow(db, w, { ...s.sale, warehouseId: s.b.id }), /مخزن/);
  assert.equal(snapshot(db), before);
}));
test('missing or foreign item references never silently turn into free invoice lines', () => fixture((db, s) => {
  const before = snapshot(db);
  assert.throws(() => insertLedgerEntryRow(db, w, { ...s.sale, lines: [{ ...s.sale.lines[0], inventoryItemId: 'not-in-this-workspace' }] }), /الصنف/);
  assert.equal(snapshot(db), before);
}));
test('undefined optional units and inactive cards cannot post', () => fixture((db, s) => {
  const before = snapshot(db);
  assert.throws(() => insertLedgerEntryRow(db, w, { ...s.sale, lines: [{ ...s.sale.lines[0], unitNum: 2 }] }), /وحدة/);
  assert.throws(() => insertLedgerEntryRow(db, w, { ...s.sale, lines: [{ ...s.sale.lines[0], unitNum: 4 }] }), /وحدة/);
  assert.equal(snapshot(db), before);
  db.prepare('UPDATE inventory_items SET bstate=0 WHERE id=?').run(s.item.id);
  const inactive = snapshot(db);
  assert.throws(() => insertLedgerEntryRow(db, w, s.sale), /نشط/);
  assert.equal(snapshot(db), inactive);
}));
test('posting a saved draft revalidates current warehouse and leaves the draft intact on rejection', () => fixture((db, s) => {
  const draft = insertLedgerEntryRow(db, w, { ...s.sale, postingStatus: 'draft' });
  db.prepare('UPDATE inventory_items SET warehouse_id=? WHERE id=?').run(s.b.id, s.item.id);
  const before = snapshot(db);
  assert.throws(() => postDraftLedgerEntryRow(db, w, draft.id), /مخزن/);
  assert.equal(snapshot(db), before);
}));
test('first purchase binds only a pristine zero-stock local card, and the binding rolls back on later failure', () => fixture((db, s) => {
  const card = insertInventoryItemRow(db, w, { name: 'QA New Card', unit: 'حبة', quantity: 0, avgCost: 0 });
  const purchase = { ...s.sale, direction: 'credit' as const, idempotencyKey: 'first-receipt', lines: [{ ...s.sale.lines[0], inventoryItemId: card.id, itemName: card.name }] };
  insertLedgerEntryRow(db, w, purchase);
  assert.deepEqual({ ...db.prepare('SELECT warehouse_id,quantity,avg_cost FROM inventory_items WHERE id=?').get(card.id) }, { warehouse_id: s.a.id, quantity: 2, avg_cost: 150 });
  insertLedgerEntryRow(db, w, purchase);
  assert.equal(db.prepare('SELECT quantity FROM inventory_items WHERE id=?').get(card.id)?.quantity, 2);
  const other = insertInventoryItemRow(db, w, { name: 'QA Rollback Card', unit: 'حبة', quantity: 0, avgCost: 0 });
  const before = snapshot(db);
  assert.throws(() => insertLedgerEntryRow(db, w, { ...purchase, idempotencyKey: 'rejected-receipt', amount: 600, lines: [
    { ...purchase.lines[0], inventoryItemId: other.id, itemName: other.name },
    { ...purchase.lines[0], inventoryItemId: s.item.id, warehouseId: s.b.id },
  ] }), /مخزن/);
  assert.equal(snapshot(db), before);
  db.exec("CREATE TRIGGER fail_post_audit BEFORE INSERT ON audit_log WHEN NEW.table_name='ledger_entries' BEGIN SELECT RAISE(ABORT,'qa late write failure'); END");
  try {
    assert.throws(() => insertLedgerEntryRow(db, w, {...purchase, idempotencyKey: 'late-failure', lines: [{...purchase.lines[0], inventoryItemId: other.id, itemName: other.name}]}), /qa late write failure/);
    assert.equal(snapshot(db), before);
  } finally { db.exec('DROP TRIGGER fail_post_audit'); }
}));
test('an operation key or explicit document ID cannot acknowledge different financial input', () => fixture((db, s) => {
  const request = { ...s.sale, id: 'qa-fixed-document', idempotencyKey: 'qa-fixed-request' };
  const entry = insertLedgerEntryRow(db, w, request), before = snapshot(db);
  assert.equal(insertLedgerEntryRow(db, w, request).id, entry.id);
  for (const patch of [
    { amount: 450, lines: [{ ...request.lines[0], quantity: 3, total: 450 }] },
    { currency: 'دولار' }, { warehouseId: s.b.id }, { payment: 'cash' as const },
    { lines: [{ ...request.lines[0], unitNum: 2 }] },
  ]) assert.throws(() => insertLedgerEntryRow(db, w, { ...request, ...patch }), /طلب|تكرار/);
  assert.equal(snapshot(db), before);
  restoreUnifiedJsonBundle(db, w, exportWorkspaceJsonBackup(db, w));
  assert.equal(insertLedgerEntryRow(db, w, request).id, entry.id);
  assert.throws(() => insertLedgerEntryRow(db, w, { ...request, payment: 'cash' }), /طلب|تكرار/);
  assert.throws(() => insertLedgerEntryRow(db, w, { ...request, id: 'another-document' }), /طلب/);
}));
