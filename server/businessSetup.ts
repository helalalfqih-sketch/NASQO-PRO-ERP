import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ACTION_LABELS, validateBusinessSetup, validatePreferenceReferences } from '../src/utils/businessSetup.ts';
import { ensureEmptyWorkspace, getFullWorkspaceBundle, saveWorkspaceSettingsRow, upsertAccountRow, upsertWarehouseRow, withTransaction, writeAudit, SqliteValidationError } from './sqliteDb.ts';
import { saveCashboxRecord } from './masterCrud.ts';

/** One transaction, no opening journals, imports, or updates to existing masters. */
export function completeBusinessSetup(db: DatabaseSync, workspace: string, input: unknown) {
  try { validateBusinessSetup(input); } catch (e) { throw new SqliteValidationError((e as Error).message); }
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return withTransaction(db, () => {
    ensureEmptyWorkspace(db, workspace);
    const prior = db.prepare('SELECT setup_fingerprint FROM workspaces WHERE id=?').get(workspace);
    if (prior?.setup_fingerprint) {
      if (prior.setup_fingerprint !== fingerprint) throw new SqliteValidationError('اكتملت التهيئة؛ عدّل التفضيلات من الإعدادات.');
      return getFullWorkspaceBundle(db, workspace);
    }
    const initial = getFullWorkspaceBundle(db, workspace);
    if(initial.workspace.businessProfile) throw new SqliteValidationError("اكتملت التهيئة؛ عدّل التفضيلات من الإعدادات.");
    if (!initial.currencies.some(c => c.name === input.currency)) throw new SqliteValidationError('اختر عملة موجودة.');
    const prefs = { ...input.preferences };
    const warehouse = initial.warehouses[0] ?? upsertWarehouseRow(db, workspace, { name: input.warehouseName, details: '', isDefault: true });
    const cashbox = initial.cashboxes.find(b => b.currencyCode === input.currency && b.state !== 0 && b.isActive !== false) ??
      saveCashboxRecord(db, workspace, { name: input.cashboxName, currencyCode: input.currency });
    if (input.bankName.trim()) {
      // A bank account uses the existing cash-transfer/document balance machinery.
      const found = initial.cashboxes.find(b => b.name === input.bankName.trim());
      if (found && (found.currencyCode !== input.currency || found.boxType !== 2)) throw new SqliteValidationError('اسم البنك مستخدم لصندوق آخر.');
      if (!found) {
        const bank = saveCashboxRecord(db, workspace, { name: input.bankName, currencyCode: input.currency });
        db.prepare('UPDATE cashboxes SET box_type=2 WHERE workspace_id=? AND id=?').run(workspace, bank.id);
      }
    }
    const defaults = initial.workspace.referenceDefaults;
    const party = (role: string, name: string, category: 'clients' | 'purchases') => initial.accounts.find(a => a.currency === input.currency && a.note === `nasqo:default:${role}`) ??
      upsertAccountRow(db, workspace, { name, category, currency: input.currency, isCashAccount: false, openingBalance: 0, note: `nasqo:default:${role}` });
    const customer = party('cash-customer', 'عميل نقد', 'clients');
    party('cash-supplier', 'مورد نقد', 'purchases');
    const current = getFullWorkspaceBundle(db, workspace);
    prefs.defaultWarehouseId ||= defaults?.warehouseId || warehouse.id;
    prefs.defaultCashboxId ??= defaults?.systemCashboxes[input.currency] ?? cashbox.id;
    validatePreferenceReferences(prefs, current.currencies.map(c => c.name), current.warehouses, current.cashboxes);
    const profile = { ...input.profile, completedAt: new Date().toISOString() };
    db.prepare('UPDATE workspaces SET business_profile_json=?,setup_fingerprint=? WHERE id=?').run(JSON.stringify(profile), fingerprint, workspace);
    saveWorkspaceSettingsRow(db, workspace, { companyName: input.companyName, defaultCurrency: input.currency, userPreferences: prefs,
      ...(!defaults ? { referenceDefaults: { warehouseId: warehouse.id, accountId: customer.id, systemCashboxes: { [input.currency]: cashbox.id }, accountCashboxes: {}, groupCashboxes: {} } } : {}) });
    writeAudit(db, workspace, workspace, 'workspaces', workspace, 'setup', { version: 1 });
    return getFullWorkspaceBundle(db, workspace);
  });
}

export function recordRecentAction(db: DatabaseSync, workspace: string, action: unknown) {
  if (typeof action !== 'string' || !Object.hasOwn(ACTION_LABELS, action)) throw new SqliteValidationError('إجراء غير صالح.');
  return withTransaction(db, () => {
    const current = getFullWorkspaceBundle(db, workspace).workspace;
    if (!current.userPreferences) return current;
    const p=current.userPreferences;
    return saveWorkspaceSettingsRow(db,workspace,{userPreferences:{...p,recentActions:[action as keyof typeof ACTION_LABELS,...p.recentActions.filter(a=>a!==action)].slice(0,5)}});
  });
}
