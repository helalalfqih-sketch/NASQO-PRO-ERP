# Data-management CRUD verification

The missing paths have been completed in the existing NASQO app, using the existing workspace, web SQLite API and native SQLite command bridge. No parallel database or production fixture is introduced.

| Data | Operations and persistence | Business rules |
| --- | --- | --- |
| Employees, attendance fields | Create, list/search/status filter, detail, edit, confirmed delete | Employee linked to leave cannot be deleted; account must exist |
| Leave requests | Create, list/search/status filter, detail, edit, delete | Approval, edited approved days, rejection and deletion adjust leave balance atomically, exactly once |
| Sales opportunities | Create, list/search/stage filter, detail, edit, delete | Customer and currency must match; converted invoices lock the source |
| Purchase orders | Create with editable lines, search/status filter, detail, edit, delete | Product/base unit, supplier, warehouse and currency validated; received orders protected |
| Bills of materials | Create with multiple components, search/detail/edit/delete | No self-component or duplicates; an in-use BOM cannot be rewritten or removed |
| Production orders | Create, search/status filter, detail, edit, delete | BOM/finished product/warehouse/cost center references checked; completed orders protected |
| Cost centers | Create, search/status filter, detail, edit, close/delete | Recorded spend cannot be edited as metadata; linked centers cannot be deleted |
| Account groups, warehouses, cashboxes | Existing create/edit/read/search plus missing confirmed delete paths | Referenced records protected, cashbox archive retained; no financial account is removed by deleting its unused box |
| Accounts, currencies, item cards | Existing CRUD reused and integration/reference checks strengthened | No cross-workspace update; references/defaults/history protected; card edits do not establish quantity or value |
| Financial documents, journals, transfers, quotes/orders | Existing draft/edit/post/reversal and historical read paths retained | Posted records use existing reversal/void mechanisms, never arbitrary CRUD deletion of financial history |
| Settings, reports, backups | Existing configuration, report filters and backup/restore reused | Reports are derived views. Backups are immutable files, not editable accounting rows |

The web ERP endpoint now accepts bounded record commands instead of replacing entire collections. Stale edits fail with 409; validation failures retain the form. Native commands retain idempotency keys, atomic commits and deletion tombstones. Deleted master IDs are never reused. All endpoints remain behind the existing local-owner/authenticated-server gate; native writes reject foreign/synchronized workspaces. The connected SmartPro server's separate roles/permissions are not replaced.

Existing web receiving, deal conversion, payroll and production buttons now execute single database transactions, so failure while updating their source cannot leave a partial stock/ledger write. Native *advanced posting buttons* remain subject to their existing capability restrictions; the native original invoice/voucher screens continue to handle financial posting. Administrative CRUD completion is not a claim that those separate advanced native workflows or every deployment integration are implemented.

## Executed checks

All database tests use isolated temporary databases and synthetic records. User backups and production data are neither imported nor deleted.

- 77 Node tests passed: ERP CRUD, stale edits, bad dates/units/currency/foreign references, protected deletes, failed-batch rollback, leave balances, web posting rollback/repeat safety, backup preservation, large Excel import and existing API behavior.
- Full Flutter suite: 104 passed, 2 existing skips. Native SQLite FFI executes all seven collections, repeated commands, tombstones, foreign workspace rejection, malformed batch rollback, reference guards and master CRUD. Independent restores of both populated and deleted states matched every table and left the source archives byte-identical. Existing native restore and accounting tests also passed.
- Built React UI → real HTTP API → on-disk SQLite: 19 scenarios passed for all seven collections and warehouses/groups/cashboxes/currencies, including read after reload, search/status filters, detail/edit/confirmed deletion and rejected referenced deletion. Arabic decimal input persisted exactly; phone, landscape and dark modal layouts inspected.
- TypeScript production build and protected mobile-runtime integrity checks passed. Direct `node server.ts` startup, authenticated remote access, role limits, CSRF checks, persistent-volume refusal and server restart/HTTP backup restore passed. The deployment image includes the shared source helpers used by the server.
- Signed Android UI/upgrade/import results are recorded with the release candidate. `verify-android-crud.py` uses a CI emulator only and checks employee CRUD through the actual UI and bridge, persisted SQLite revisions, cancellation and unchanged stock/financial history.

Reproduce with `node --import tsx --test tests/erp-crud.test.ts tests/erp-input.test.ts`, `flutter test` in `flutter_app`, and `npm run build && node --import tsx scripts/verify-crud-ui.ts`. The Android UI check is intentionally CI/emulator-gated.

Currency follow-up: server-side create no longer references a nonexistent update record. Create/read/rate-update/confirmed-delete ran through the rendered UI, HTTP and SQLite. Default and referenced currency deletion is rejected transactionally, including administrative/default references on Android; failed operations preserved the backup snapshot. Zero/invalid rates are rejected instead of silently replaced with 1. Server NodeNext type-check and direct production startup tests passed; the deployment archive now includes `src`, required by the shared server rules.

Integration follow-up before merging to main: browser acceptance uses the current Settings → Database restore review, durable safety download, cancellation and explicit replacement consent. Posted invoice edits/deletes are rejected with visible feedback and unchanged statement rows; draft and reversal accounting rules remain in the SQLite suite. Current inline filters, free invoice mode, catalog editor and VAT save completion are exercised instead of removed UI controls. Parked/exiting flow screens are inert; Back/focus and central-auth isolation passed before updating the single affected runtime lock hash. Android harnesses navigate the actually restored screen, rather than mistaking cached dashboard accessibility nodes for Home.
