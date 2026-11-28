import assert from 'node:assert/strict';
import test from 'node:test';
import { closeSqliteDb, getSqliteDb, ensureEmptyWorkspace, upsertAccountRow,
  upsertWarehouseRow, insertInventoryItemRow, insertLedgerEntryRow, postDraftLedgerEntryRow,
  reverseLedgerEntryRow, reverseJournalEntryRow, exportWorkspaceJsonBackup, restoreUnifiedJsonBundle,
} from '../server/sqliteDb.ts';
import { getTrialBalanceReport } from '../server/financialReports.ts';

const ws = 'qa-stock-sale-journal';
function fixture(draft = false) {
  const db = getSqliteDb(':memory:');
  ensureEmptyWorkspace(db, ws);
  const customer = upsertAccountRow(db, ws, { name: 'QA Customer', category: 'clients', currency: 'ريال' });
  const shop = upsertWarehouseRow(db, ws, { name: 'QA Warehouse' });
  const item = insertInventoryItemRow(db, ws, { warehouseId: shop.id, name: 'QA product', quantity: 10, avgCost: 100, unit: 'حبة' });
  const invoice = { id: 'qa-stock-sale', idempotencyKey: 'qa-operation', accountId: customer.id, accountName: customer.name,
    kind: 'invoice' as const, direction: 'debit' as const, payment: 'credit' as const, currency: 'ريال',
    entryDate: '2026-11-27', amount: 300, invoiceContent: 'items' as const, warehouseId: shop.id,
    postingStatus: draft ? 'draft' as const : 'posted' as const,
    lines: [{ inventoryItemId: item.id, itemName: item.name, quantity: 2, price: 150, unit: 'حبة' }],
  };
  const quantity = () => db.prepare('SELECT quantity FROM inventory_items WHERE workspace_id=? AND id=?').get(ws, item.id)?.quantity;
  const rows = (table: 'journal_entries' | 'journal_entry_lines') => db.prepare(`SELECT * FROM ${table} WHERE workspace_id=? ORDER BY rowid`).all(ws);
  return { db, customer, item, invoice, quantity, rows };
}
for (const draft of [false, true]) test(draft ? 'posting a stock sale draft reaches GL exactly once' : 'posting a stock sale reaches GL exactly once', () => {
  const f = fixture(draft);
  try {
    const { db, invoice, quantity, rows, customer } = f;
    const entry = insertLedgerEntryRow(db, ws, invoice);
    if (draft) {
      assert.equal(quantity(), 10);
      assert.equal(rows('journal_entries').length, 0);
      postDraftLedgerEntryRow(db, ws, entry.id);
    }
    assert.equal(quantity(), 8);
    const journals = rows('journal_entries');
    assert.equal(journals.length, 1);
    assert.equal(journals[0].source_ledger_id, entry.id);
    const legs = db.prepare(`SELECT j.account_id, a.note, j.debit_minor, j.credit_minor FROM journal_entry_lines j
      JOIN accounts a ON a.id=j.account_id AND a.workspace_id=j.workspace_id WHERE j.workspace_id=?`).all(ws)
      .map(l => [l.account_id === customer.id ? 'AR' : l.note, l.debit_minor, l.credit_minor]).sort();
    assert.deepEqual(legs, [['AR', 30000, 0], ['nasqo:system:cost', 20000, 0], ['nasqo:system:inventory', 0, 20000], ['nasqo:system:revenue', 0, 30000]]);
    const check = () => getTrialBalanceReport(db, ws, {currency:'ريال', fromDate:'2026-11-27', toDate:'2026-11-27'});
    assert.equal(check().totalDebitTurnover, 500);
    assert.equal(check().totalCreditTurnover, 500);
    const snapshot = exportWorkspaceJsonBackup(db, ws);
    for (let i = 0; i < 3; i++) {
      assert.equal(insertLedgerEntryRow(db, ws, invoice).id, entry.id);
      if (draft) postDraftLedgerEntryRow(db, ws, entry.id);
    }
    assert.equal(quantity(), 8);
    assert.deepEqual(exportWorkspaceJsonBackup(db, ws).sqliteSnapshot, snapshot.sqliteSnapshot);
    restoreUnifiedJsonBundle(db, ws, snapshot);
    assert.equal(rows('journal_entries')[0].source_ledger_id, entry.id);
    assert.equal(check().netDifference, 0);
    assert.throws(() => reverseJournalEntryRow(db, ws, String(journals[0].id)), /المستند/);
    const { reversal } = reverseLedgerEntryRow(db, ws, entry.id, { reversalDate: '2026-11-28' });
    assert.equal(quantity(), 10);
    assert.equal(rows('journal_entries')[1].source_ledger_id, reversal.id);
    const reversed = getTrialBalanceReport(db, ws, { currency:'ريال' });
    assert.equal(reversed.totalClosingDebit, 0);
    assert.equal(reversed.totalClosingCredit, 0);
  } finally { closeSqliteDb(); }
});
test('journal line failure rolls back invoice and stock together', () => {
  const { db, invoice, quantity } = fixture();
  try {
    const before = exportWorkspaceJsonBackup(db, ws).sqliteSnapshot;
    db.exec("CREATE TRIGGER qa_fail_sale_journal BEFORE INSERT ON journal_entry_lines BEGIN SELECT RAISE(ABORT,'qa sale journal failure'); END");
    assert.throws(() => insertLedgerEntryRow(db, ws, invoice), /qa sale journal failure/);
    assert.equal(quantity(), 10);
    assert.deepEqual(exportWorkspaceJsonBackup(db, ws).sqliteSnapshot, before);
  } finally { closeSqliteDb(); }
});

test('a draft freezes current cost and protects unverified or changed valuation on reversal', () => {
  const { db, invoice, item, rows, quantity } = fixture(true);
  try {
    const draft = insertLedgerEntryRow(db, ws, invoice);
    db.prepare('UPDATE inventory_items SET avg_cost=125 WHERE id=?').run(item.id);
    postDraftLedgerEntryRow(db, ws, draft.id);
    assert.equal(rows('journal_entries')[0].total_debit_minor, 55000);
    assert.equal(db.prepare('SELECT unit_cost_at_sale FROM invoice_lines WHERE entry_id=?').get(draft.id)?.unit_cost_at_sale, 125);
    db.prepare('UPDATE inventory_items SET avg_cost=150 WHERE id=?').run(item.id);
    const before = exportWorkspaceJsonBackup(db, ws).sqliteSnapshot;
    assert.throws(() => reverseLedgerEntryRow(db, ws, draft.id, {reversalDate:'2026-11-28'}), /تقييم/);
    assert.equal(quantity(), 8);
    assert.deepEqual(exportWorkspaceJsonBackup(db, ws).sqliteSnapshot, before);
  } finally { closeSqliteDb(); }
});

test('a credit sale cannot bypass the accounting path with cash settlement or unverified stock', () => {
  const { db, invoice, item, quantity } = fixture();
  try {
    assert.throws(() => insertLedgerEntryRow(db, ws, {...invoice, settledOnReceipt:true}), /نقدية/);
    db.prepare('UPDATE inventory_items SET quantity_unverified=1 WHERE id=?').run(item.id);
    const before = exportWorkspaceJsonBackup(db, ws).sqliteSnapshot;
    assert.throws(() => insertLedgerEntryRow(db, ws, invoice), /اعتماد/);
    assert.equal(quantity(), 10);
    assert.deepEqual(exportWorkspaceJsonBackup(db, ws).sqliteSnapshot, before);
  } finally { closeSqliteDb(); }
});
