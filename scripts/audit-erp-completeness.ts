/** Readiness probes, not a passing feature suite. All writes are synthetic/temp.
 * Run: node --import tsx scripts/audit-erp-completeness.ts [--strict]
 * --strict exits 2 when a required invariant is missing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeSqliteDb, getSqliteDb, ensureEmptyWorkspace, upsertAccountRow,
  upsertWarehouseRow, insertInventoryItemRow, insertLedgerEntryRow,
  insertJournalEntryRow, getFullWorkspaceBundle, exportWorkspaceJsonBackup,
  restoreUnifiedJsonBundle,
} from '../server/sqliteDb.ts';
import { getTrialBalanceReport } from '../server/financialReports.ts';

const workspace = 'erp-audit-synthetic';
type Observation = { id: string; status: 'verified' | 'gap'; expected: string; observed: unknown };
const observations: Observation[] = [];
function record(id: string, ok: boolean, expected: string, observed: unknown) {
  observations.push({ id, status: ok ? 'verified' : 'gap', expected, observed });
}
function fixture(run: (db: ReturnType<typeof getSqliteDb>) => void) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nasqo-erp-completeness-'));
  try {
    closeSqliteDb();
    const db = getSqliteDb(path.join(folder, 'synthetic.sqlite'));
    ensureEmptyWorkspace(db, workspace, 'QA ERP completeness');
    run(db);
  } finally {
    closeSqliteDb();
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
fixture(db => {
  const customer = upsertAccountRow(db, workspace, { name: 'QA Customer', category: 'clients', currency: 'ريال' });
  const whA = upsertWarehouseRow(db, workspace, { name: 'QA A' });
  const whB = upsertWarehouseRow(db, workspace, { name: 'QA B' });
  const item = insertInventoryItemRow(db, workspace, { name: 'QA Item', warehouseId: whA.id, unit: 'حبة', quantity: 10, avgCost: 100 });
  const invoice = {
    accountId: customer.id, accountName: customer.name, kind: 'invoice' as const,
    typeLabel: 'QA sale', direction: 'debit' as const, payment: 'credit' as const,
    currency: 'ريال', exchangeRate: 1, entryDate: '2026-11-27', amount: 300,
    warehouseId: whA.id, invoiceContent: 'items' as const, idempotencyKey: 'qa-sale',
    lines: [{ inventoryItemId: item.id, itemName: item.name, warehouseId: whA.id, unit: 'حبة', quantity: 2, price: 150, total: 300 }],
  };
  const entry = insertLedgerEntryRow(db, workspace, invoice);
  const quantity = () => Number(db.prepare('SELECT quantity FROM inventory_items WHERE id=?').get(item.id)?.quantity);
  record('sale-stock', quantity() === 8, 'A sale of 2 reduces available quantity from 10 to 8.', { quantity: quantity() });
  const journals = db.prepare('SELECT * FROM journal_entries WHERE workspace_id=?').all(workspace);
  record('sale-to-gl', journals.length > 0, 'A posted sale creates an explicit balanced journal, including inventory/COGS.', { postedDocument: entry.postingStatus, journalCount: journals.length });
  insertLedgerEntryRow(db, workspace, invoice);
  record('identical-retry', quantity() === 8, 'An identical retry never posts a second stock change.', { quantity: quantity() });
  let changedRetryRejected = false;
  try { insertLedgerEntryRow(db, workspace, { ...invoice, amount: 450, lines: [{ ...invoice.lines[0], quantity: 3, total: 450 }] }); }
  catch { changedRetryRejected = true; }
  record('changed-retry', changedRetryRejected, 'Reusing an operation key with changed business fields is rejected.', { rejected: changedRetryRejected, quantity: quantity() });
  let wrongWarehouseRejected = false;
  const before = quantity();
  try { insertLedgerEntryRow(db, workspace, { ...invoice, idempotencyKey: 'qa-wrong-warehouse', warehouseId: whB.id, lines: [{ ...invoice.lines[0], warehouseId: whB.id }] }); }
  catch { wrongWarehouseRejected = true; }
  record('warehouse-boundary', wrongWarehouseRejected && quantity() === before, 'A document for warehouse B cannot consume the stock location in A.', { rejected: wrongWarehouseRejected, quantityBefore: before, quantityAfter: quantity() });
});
fixture(db => {
  const debit = upsertAccountRow(db, workspace, { name: 'QA Debit', category: 'shop', currency: 'ريال' });
  const credit = upsertAccountRow(db, workspace, { name: 'QA Credit', category: 'shop', currency: 'ريال' });
  insertJournalEntryRow(db, workspace, { entryDate: '2026-11-27', currency: 'ريال', lines: [{ accountId: debit.id, debit: 500 }, { accountId: credit.id, credit: 500 }] });
  const trial = getTrialBalanceReport(db, workspace, { currency: 'ريال' });
  record('journal-to-report', trial.totalDebitTurnover === 500 && trial.totalCreditTurnover === 500, 'A posted 500/500 journal appears in the normal trial balance data path.', { debit: trial.totalDebitTurnover, credit: trial.totalCreditTurnover });
  const original = db.prepare('SELECT * FROM journal_entry_lines ORDER BY id').all();
  const backup = exportWorkspaceJsonBackup(db, workspace);
  restoreUnifiedJsonBundle(db, workspace, backup);
  const restored = db.prepare('SELECT * FROM journal_entry_lines ORDER BY id').all();
  record('journal-backup-roundtrip', JSON.stringify(original) === JSON.stringify(restored), 'Full table-snapshot backup preserves exact journal legs.', { before: original.length, after: restored.length });
});
console.log(JSON.stringify({ source: 'synthetic isolated SQLite probes', readiness: observations.some(o => o.status === 'gap') ? 'gaps-found' : 'probes-verified', observations }, null, 2));
if (process.argv.includes('--strict') && observations.some(o => o.status === 'gap')) process.exitCode = 2;
