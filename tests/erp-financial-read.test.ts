import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { getTrialBalanceReport } from '../server/financialReports.ts';
import { mountSqliteApi } from '../server/sqliteApi.ts';
import { closeSqliteDb, getSqliteDb, ensureEmptyWorkspace, upsertAccountRow, upsertCurrencyRow,
  insertJournalEntryRow, reverseJournalEntryRow, insertLedgerEntryRow, exportWorkspaceJsonBackup,
  restoreUnifiedJsonBundle, setWorkspaceClosedUntilDate, DEFAULT_WORKSPACE_ID as w } from '../server/sqliteDb.ts';

async function fixture(run: (db: ReturnType<typeof getSqliteDb>) => void | Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasqo-journal-report-'));
  const previous = process.env.NASQO_SQLITE_PATH;
  process.env.NASQO_SQLITE_PATH = path.join(dir, 'qa.sqlite');
  closeSqliteDb();
  try { const db = getSqliteDb(); ensureEmptyWorkspace(db, w); await run(db); }
  finally { closeSqliteDb(); if (previous === undefined) delete process.env.NASQO_SQLITE_PATH; else process.env.NASQO_SQLITE_PATH = previous; fs.rmSync(dir, {recursive: true, force: true}); }
}
function setup(db: ReturnType<typeof getSqliteDb>) {
  const debit = upsertAccountRow(db, w, {name: 'QA Debit', category: 'shop', currency: 'ريال'});
  const credit = upsertAccountRow(db, w, {name: 'QA Credit', category: 'shop', currency: 'ريال'});
  const journal = {entryDate: '2026-11-01', currency: 'ريال', lines: [{accountId: debit.id, debit: 500}, {accountId: credit.id, credit: 500}]};
  return {debit, credit, journal};
}
const snapshot = (db: ReturnType<typeof getSqliteDb>) => exportWorkspaceJsonBackup(db, w).sqliteSnapshot;

test('trial balance includes journals once, excludes drafts and preserves all stored rows', async () => fixture(db => {
  const {debit, credit, journal} = setup(db);
  insertJournalEntryRow(db, w, journal);
  insertJournalEntryRow(db, w, {...journal, postingStatus: 'draft'});
  insertLedgerEntryRow(db, w, {accountId: debit.id, accountName: debit.name, counterpartAccountId: credit.id, counterpartAccountName: credit.name,
    kind: 'simple-entry', amount: 100, direction: 'debit', payment: 'balance', currency: 'ريال', entryDate: journal.entryDate});
  const before = snapshot(db);
  for (let i = 0; i < 3; i++) {
    const report = getTrialBalanceReport(db, w, {currency: 'ريال'});
    assert.equal(report.totalDebitTurnover, 600); assert.equal(report.totalCreditTurnover, 600); assert.equal(report.netDifference, 0);
  }
  assert.deepEqual(snapshot(db), before);
}));
test('journal reversal uses its own date; period opening and closing keep both legs', async () => fixture(db => {
  const {journal} = setup(db);
  const original = insertJournalEntryRow(db, w, journal);
  reverseJournalEntryRow(db, w, original.id, {reversalDate: '2026-11-10'});
  const beforeReverse = getTrialBalanceReport(db, w, {currency: 'ريال', toDate: '2026-11-09'});
  assert.equal(beforeReverse.totalClosingDebit, 500); assert.equal(beforeReverse.totalClosingCredit, 500);
  const period = getTrialBalanceReport(db, w, {currency: 'ريال', fromDate: '2026-11-10', toDate: '2026-11-10'});
  assert.equal(period.totalDebitTurnover, 500); assert.equal(period.totalCreditTurnover, 500);
  assert.equal(period.totalClosingDebit, 0); assert.equal(period.totalClosingCredit, 0);
}));
test('journal retry requires identical business input, including after reversal and restore', async () => fixture(db => {
  const {journal} = setup(db);
  const request = {...journal, id: 'qa-journal', idempotencyKey: 'qa-journal-key'};
  const original = insertJournalEntryRow(db, w, request);
  setWorkspaceClosedUntilDate(db, w, '2026-11-05');
  assert.equal(insertJournalEntryRow(db, w, request).id, original.id);
  const before = snapshot(db);
  for (const change of [{description: 'changed'}, {exchangeRate: 2}, {entryDate: '2026-11-02'}, {entryNumber: 99},
    {lines: request.lines.map(line => ({...line, debit: line.debit ? 600 : 0, credit: line.credit ? 600 : 0}))}]) {
    assert.throws(() => insertJournalEntryRow(db, w, {...request, ...change}), /معرّف الطلب/);
  }
  assert.deepEqual(snapshot(db), before);
  assert.throws(() => insertJournalEntryRow(db, w, {...request, id: 'different-document'}), /معرّف الطلب/);
  reverseJournalEntryRow(db, w, original.id, {reversalDate: '2026-11-10'});
  restoreUnifiedJsonBundle(db, w, exportWorkspaceJsonBackup(db, w));
  assert.equal(insertJournalEntryRow(db, w, request).id, original.id);
  assert.equal(getTrialBalanceReport(db, w, {currency: 'ريال'}).totalClosingDebit, 0);
}));
test('schema v3 backup remains restorable and legacy requests compare persisted intent', async () => fixture(db => {
  const {debit, journal} = setup(db);
  const request = {...journal, idempotencyKey: 'old-journal'};
  insertJournalEntryRow(db, w, request);
  const invoice = {accountId: debit.id, accountName: debit.name, kind: 'invoice' as const, amount: 100,
    direction: 'debit' as const, payment: 'credit' as const, currency: 'ريال', entryDate: '2026-11-01', idempotencyKey: 'old-invoice'};
  insertLedgerEntryRow(db, w, invoice);
  const backup = exportWorkspaceJsonBackup(db, w), tables = backup.sqliteSnapshot.tables;
  for (const row of [...tables.ledger_entries, ...tables.journal_entries]) delete row.request_fingerprint;
  const payload = {format: backup.sqliteSnapshot.format, schemaVersion: 3, tables};
  backup.sqliteSnapshot = {...payload, sha256: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
  restoreUnifiedJsonBundle(db, w, backup);
  const before = snapshot(db);
  insertJournalEntryRow(db, w, request); insertLedgerEntryRow(db, w, invoice);
  assert.throws(() => insertJournalEntryRow(db, w, {...request, description: 'different'}), /معرّف الطلب/);
  assert.throws(() => insertLedgerEntryRow(db, w, {...invoice, amount: 101}), /معرّف الطلب/);
  assert.deepEqual(snapshot(db), before);
}));
test('oversized keys are rejected instead of truncated into an existing operation', async () => fixture(db => {
  const {debit, journal} = setup(db);
  const before = snapshot(db);
  assert.throws(() => insertJournalEntryRow(db, w, {...journal, idempotencyKey: 'a'.repeat(129)}), /128/);
  assert.throws(() => insertLedgerEntryRow(db, w, {accountId: debit.id, accountName: debit.name, amount: 1, idempotencyKey: 'a'.repeat(129)}), /128/);
  assert.deepEqual(snapshot(db), before);
}));
test('opening a schema v3 database upgrades additively without replacing business rows', async () => fixture(db => {
  const {journal} = setup(db);
  const saved = insertJournalEntryRow(db, w, {...journal, idempotencyKey: 'migration-request'});
  const before = db.prepare('SELECT * FROM journal_entry_lines').all();
  db.exec('ALTER TABLE ledger_entries DROP COLUMN request_fingerprint; ALTER TABLE journal_entries DROP COLUMN request_fingerprint; PRAGMA user_version=3;');
  closeSqliteDb();
  const upgraded = getSqliteDb();
  assert.equal(upgraded.prepare('PRAGMA user_version').get()?.user_version, 4);
  assert.deepEqual(upgraded.prepare('SELECT * FROM journal_entry_lines').all(), before);
  assert.equal(insertJournalEntryRow(upgraded, w, {...journal, idempotencyKey: 'migration-request'}).id, saved.id);
}));
test('HTTP report and posting use real SQLite with scope validation, CSRF and conflict status', async () => fixture(async db => {
  const {debit, journal} = setup(db);
  const app = express(); app.use(express.json()); mountSqliteApi(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as {port: number}).port}/api/db/workspace/${w}`;
  const headers = {'content-type': 'application/json', 'x-nasqo-csrf': '1'};
  try {
    const request = {...journal, idempotencyKey: 'http-journal'};
    assert.equal((await fetch(`${url}/journals`, {method: 'POST', headers, body: JSON.stringify(request)})).status, 201);
    assert.equal((await fetch(`${url}/journals`, {method: 'POST', headers, body: JSON.stringify({...request, description: 'changed'})})).status, 409);
    assert.equal((await fetch(`${url}/journals`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(request)})).status, 403);
    const reportResponse = await fetch(`${url}/reports/trial-balance?currency=${encodeURIComponent('ريال')}`);
    assert.equal(reportResponse.status, 200);
    assert.equal((await reportResponse.json() as any).totalDebitTurnover, 500);
    assert.equal((await fetch(`${url}/reports/trial-balance?fromDate=2026-02-30`)).status, 400);
    assert.equal((await fetch(`${url}/reports/trial-balance?fromDate=2026-12-01&toDate=2026-11-01`)).status, 400);
    const sale = {accountId: debit.id, accountName: debit.name, amount: 50, kind: 'invoice', idempotencyKey: 'http-sale'};
    assert.equal((await fetch(`${url}/ledger`, {method: 'POST', headers, body: JSON.stringify({entry: sale})})).status, 201);
    assert.equal((await fetch(`${url}/ledger`, {method: 'POST', headers, body: JSON.stringify({entry: {...sale, amount: 60}})})).status, 409);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}));
