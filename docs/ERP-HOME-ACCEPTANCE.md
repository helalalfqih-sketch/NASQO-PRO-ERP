# Existing ERP home integration — 2026-11-28

The current home route now orders four financial KPIs, five working quick actions, eight core destinations, up to five alerts and five recent posted transactions. Other tools remain in More → extended work tools. The user's latest correction takes precedence over the proposed palette: existing `smart-tile`, `exec-kpi-card`, saved colors, corner radii and padding are reused.

## Data and behavior

- Web reads one SQLite WAL snapshot in a bounded read-only worker. Native reads one actual SQLite snapshot through the existing bridge. Both use the shared projection and existing cash/account calculations. Reading Home creates no records or financial postings.
- Sales/purchases net returns and reversals on their effective date; stock invoices use recorded net-before-tax value. Drafts, quotes, deleted and historical unposted documents do not enter financial KPIs. Standalone posted journals contribute to account balances and open their actual lines from recent activity.
- Currency is explicit; no implicit conversion or cross-currency total. Dates use the business timezone and fiscal start. Warehouse filters apply to attributed documents/stock; cash and receivables explicitly show company balances across warehouses through the selected date.
- Preferences save only the current proprietor's personal settings. References are validated. Theme/layout/defaults/favorites survive SQLite reopen; company accounting settings remain unchanged.
- Last successful summaries are scoped to proprietor, restored source, filters and default settings, with visible freshness. Failures show the error and cached value rather than fabricated zeros. Generation guards reject stale responses; commits refresh the summary without a full-page reload.

## Verified locally

- 10 Playwright scenarios: actual HTTP/SQLite values and drill-down, five correct workflow forms, all eight destinations, persistence/failure handling, offline fallback, exact journal lines, preserved card appearance, first-run and actual invoice posting/recovery.
- Light/dark RTL at 320, 360, 412 and 768 px, plus enlarged text; no horizontal overflow.
- 19 existing rendered CRUD scenarios through More, actual HTTP and isolated SQLite, including reference-protected deletion.
- 107 Flutter tests passed; two existing deferred tests remain skipped. Native dashboard boundary verifies one snapshot, committed cash and invalid/foreign scopes.
- Financial, setup, bridge and SQLite regressions passed, including returns/reversals, independent cash/trial-balance reconciliation and unchanged source rows.
- Frontend/server TypeScript, web/hybrid builds and the protected runtime lock passed. No production or private backup data used.

Android API 30 / WebView 83 and API 36 acceptance is defined in `scripts/verify-android-home.ts` and the preview workflow. CI outcome is reported separately; a build or JavaScript syntax audit alone is not device acceptance.

## Existing capability limits

- Authentication currently represents one local workspace proprietor. Six role projections are tested and reject inappropriate totals/actions, but employee authentication and enforceable branch/warehouse grants do not exist yet. There is no pretend role switch in preferences. Only the real current branch is selectable.
- The current warehouse-transfer data is historical/read-only. The existing remittance form is financial, so it is not presented as a working stock-transfer action. Home exposes five implemented actions; adding stock transfer requires a real issue/receipt workflow.
- These limits mean this change alone is not certification of the entire ERP for production or multi-user permission isolation. It does not publish or replace the Google Play release.
