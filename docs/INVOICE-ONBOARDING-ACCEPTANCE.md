# Invoice interaction and first-run setup

The invoice now searches a large catalog without doing an uninterrupted scan on
every keystroke. Search is debounced, cancellable and bounded to ten results;
explicit catalog-family links and warehouse ranking remain unchanged. The
dropdown overlays the table. Existing invoice colors, radii, padding, row and
control heights are retained. The app-owned modal measures its available height,
scrolls the body/focused field and keeps its header and actions visible.

Web and Android invoice drafts use the existing workspace/source-bound resume
store. Changes autosave after 200 ms and checkpoint on backgrounding/closing.
Storage and posting failures retain the form and expose retry. Successful posting
clears the draft; recovery recognizes an already-posted ID without replaying it.

The first-run wizard provisions zero-balance defaults in one transaction, using
existing masters where possible. Retrying the same setup does not duplicate
masters. Both HTTP/SQLite and the native bridge validate the full payload and
references. User theme, home columns, defaults, favorites and recent actions are
persisted in workspace settings and survive supported backup round trips.
Existing businesses enter the same settings explicitly; merely opening the
wizard never imports records or posts opening balances.

## Verification

- Node tests cover atomic setup/retry/rollback, reference deletion guards, backup
  validation, preferences, timezone dates, 20,000-item asynchronous lookup,
  cancellation and ranking parity, plus native bridge capability checks.
- Flutter tests cover native setup/retry, automatic posting roles, preferences,
  native backup and unified web-to-native restore without duplicate movements.
- Playwright uses an isolated SQLite database. It verifies first-run validation,
  failure/retry, actual persisted preferences, Arabic tax input, no duplicate
  defaults, locked invoice dimensions/colors, loading/empty/stale search,
  compact viewports, draft reload, failed posting and one successful purchase
  with exactly one stock update.
- The existing 28 protected mobile runtime files remain unchanged.

Real Android IME/process-restart acceptance is tracked separately from Chromium
viewport tests. Do not equate a simulated viewport with an Android device test.

## Supported setup boundaries

This change exposes the implemented Arabic interface and weighted-average
inventory costing. It does not add FIFO or translations. The branch and owner
names describe the existing primary workspace; they do not implement multiple
branch ledgers, independent users, RBAC or segregation of duties. A bank created
here is a real cash-account record usable by existing transfers/documents, not
bank-feed integration or statement reconciliation. Fiscal-year start is saved
metadata, not a new period-closing engine. Opening balances and existing-data
restore continue through their existing explicit operations. Backup reminders
and application notifications do not imply scheduled cloud backup or push setup.

These are not claims that every module in the broader ERP audit is complete or
that the application has production certification.
