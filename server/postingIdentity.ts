import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { SqliteValidationError } from './sqliteDb.ts';

type Values = Record<string, any>;
export function postingOperationKey(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > 128) throw new SqliteValidationError('معرّف الطلب غير صالح أو يتجاوز 128 حرفًا.');
  return value.trim() || null;
}

export function journalPostingFingerprint(header: Values, lines: readonly Values[]): string {
  return crypto.createHash('sha256').update(JSON.stringify({v: 1,
    header: ['entryDate', 'description', 'currency', 'exchangeRate', 'postingStatus'].map(key => header[key]),
    lines: lines.map(line => [line.accountId, line.debitMinor, line.creditMinor, line.description]),
  })).digest('hex');
}
/** Stable business intent. Generated IDs, timestamps and display names are
 * excluded; field names and order are versioned here. */
export function ledgerPostingFingerprint(header: Values, lines: readonly Values[]): string {
  const fields = ['accountId','counterpartAccountId','kind','payment','direction','currency','exchangeRate',
    'amount','discount','taxAmount','paidAmount','warehouseId','invoiceContent','entryDate','dueDate',
    'expenseCategory','documentNumber','details','entryNumber','docType','postingStatus','cashboxId','deleted'];
  const body = { v: 1, header: fields.map(key => header[key] ?? null),
    lines: lines.map(l => [l.inventoryItemId || null, l.warehouseId || header.warehouseId || null,
      l.quantity, l.price, l.total, l.discount ?? 0, l.bonus ?? 0, l.unitNum ?? 1, l.details || '']) };
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/** Older documents have no frozen request hash: compare persisted intent. */
export function storedLedgerFingerprint(db: DatabaseSync, workspace: string, row: Values): string {
  const lines = db.prepare(`SELECT inventory_item_id AS inventoryItemId, warehouse_id AS warehouseId,
    quantity,price,total,discount,bonus,unit_num AS unitNum,details FROM invoice_lines
    WHERE workspace_id=? AND entry_id=? ORDER BY id`).all(workspace, row.id);
  return ledgerPostingFingerprint({
    accountId: row.account_id, counterpartAccountId: row.counterpart_account_id, kind: row.kind,
    payment: row.payment, direction: row.direction, currency: row.currency, exchangeRate: row.exchange_rate,
    amount: row.amount, discount: row.discount, taxAmount: row.tax_amount, paidAmount: row.paid_amount,
    warehouseId: row.warehouse_id, invoiceContent: row.invoice_content, entryDate: row.entry_date,
    dueDate: row.due_date || null, expenseCategory: row.expense_category || null,
    documentNumber: row.document_number, details: row.details, entryNumber: row.entry_number,
    docType: row.doc_type, postingStatus: row.posting_status === 'reversed' ? 'posted' : row.posting_status,
    cashboxId: row.cashbox_id,
    deleted: Boolean(row.deleted),
  }, lines);
}
