import type { DatabaseSync } from 'node:sqlite';
import { computeTrialBalance, type FinancialReportScopeOptions } from '../src/erp.ts';
import type { LedgerEntryRecord } from '../src/types.ts';
import { getFullWorkspaceBundle, withTransaction } from './sqliteDb.ts';

/** Journal projections are report inputs only. They must never be inserted in
 * ledger_entries, replayed against inventory, or offered as editable invoices. */
export function getTrialBalanceReport(db: DatabaseSync, workspace: string, options?: FinancialReportScopeOptions) {
  return withTransaction(db, () => {
    const bundle = getFullWorkspaceBundle(db, workspace);
    const legs = new Map<string, NonNullable<LedgerEntryRecord['journalLines']>>();
    for (const row of db.prepare('SELECT * FROM journal_entry_lines WHERE workspace_id=? ORDER BY id').all(workspace)) {
      const id = String(row.journal_id), list = legs.get(id) ?? [];
      list.push({accountId: String(row.account_id), debitMinor: Number(row.debit_minor), creditMinor: Number(row.credit_minor)});
      legs.set(id, list);
    }
    const journals: LedgerEntryRecord[] = db.prepare('SELECT * FROM journal_entries WHERE workspace_id=? ORDER BY entry_date, id').all(workspace).map(row => ({
      id: `journal:${row.id}`, ownerId: workspace, accountId: '', accountName: '',
      counterpartAccountId: '', counterpartAccountName: '', kind: 'simple-entry',
      typeLabel: 'قيد يومية', payment: 'balance', direction: 'debit',
      amount: Number(row.total_debit_minor) / 100, currency: String(row.currency), exchangeRate: Number(row.exchange_rate),
      details: String(row.description), documentNumber: '', warehouseId: '', warehouseName: '', invoiceContent: 'none',
      entryNumber: Number(row.entry_number), deleted: false, entryDate: String(row.entry_date),
      postingStatus: row.posting_status as LedgerEntryRecord['postingStatus'],
      journalLines: legs.get(String(row.id)) ?? [], createdAtMs: Date.parse(String(row.created_at)),
    }));
    return computeTrialBalance(bundle.accounts, [...bundle.ledger, ...journals], options);
  });
}
