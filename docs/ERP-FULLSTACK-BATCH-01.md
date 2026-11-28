# ERP Full Stack batch 01: SQLite credit stock sale to the general ledger

Baseline: review branch after dashboard compatibility at `e6b4a55`. Scope: existing **web SQLite** posting route, real temporary databases, no CSS or Android UI changes. This report does not assign a completion percentage. A module named below is not COMPLETE unless all stated boundaries and device checks are verified.

| Scope | Status | Evidence or remaining gap |
| --- | --- | --- |
| Tax-free, unpaid credit stock sale in YER at rate 1 | COMPLETE (this specific web path only) | `server/sqliteApi.ts` ledger routes call `server/sqliteDb.ts`. Direct post and draft post: stock 10→8; exactly one source-linked journal: AR debit 300, revenue credit 300, COGS debit 200, inventory credit 200. Retries do not add effects. |
| General ledger / trial balance / audit | PARTIAL | `server/financialReports.ts` counts a linked journal instead of the duplicate document projection. Legacy and standalone journals remain reportable. Local audit retained. Review other reports and posting routes independently. |
| Inventory / valuation / reconciliation | PARTIAL | Current WAC and base units are frozen for the supported sale. Invoice lines and stock are written together. Same-valuation reversal restores quantity and swaps journal legs; after a WAC change the reversal is rejected atomically pending a proper cost adjustment path. |
| AR / AP / sales / purchases / cashboxes / banks | PARTIAL | Existing documents and master data retained. Tax, cash sales, mixed or partial payment, purchasing GL parity, and end-to-end bank reconciliation are not covered by this batch. |
| Warehouse transfer / in-transit | MISSING (operational workflow) | Existing historical records are readable; request/issue/receive/partial/reversal are not proven. |
| Tax / multicurrency / branches / approvals / RBAC / segregation | PARTIAL | Existing scope, fiscal controls and local owner checks remain. No inference about currency2, true multi-branch authorization, or production permission approval. |
| Cost centers / project accounting / fixed assets / expenses / budgets | NOT TESTED | No completeness claim; verify source, command boundary, posting and reports per module. |
| Durable web sync outbox/inbox / offline Android parity | NOT TESTED | This is a local atomic web SQLite transaction. It neither adds a cross-database write nor claims sync or device acceptance. Android/home retains its separate CI evidence. |
| SQLite migration / backup | COMPLETE (tested structural slice) | Schema 6 adds nullable role, source journal link and posted base units with unique indexes. No historical backfill. Older snapshot versions remain accepted. Linked sale round-trips; simulated journal write failure rolls back invoice, stock and lazy control accounts. |
 
Reproduce on Node 24 with dependencies installed:
```sh
node --import tsx --test tests/erp-stock-sale-journal.test.ts tests/erp-posting-boundaries.test.ts tests/erp-financial-read.test.ts tests/home-dashboard.test.ts
node --import tsx scripts/audit-erp-completeness.ts --strict
```

Tests cover local posting, exact amounts, retry, reversal, WAC drift guard, report deduplication, backup and migration. No private data or signed release tested, no production deployment. Next dependency: complete account mapping and authoritative tax/settlement rules before extending sales posting; then repeat this audit for purchases and stock transfers.
