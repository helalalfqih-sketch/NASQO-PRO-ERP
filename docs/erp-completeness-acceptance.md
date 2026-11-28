# ERP completeness acceptance gates

Baseline: 2561ac0389420c1c8ec84d957c7d6cc4539fc472. This is a requirements and evidence register, not a claim of implementation. Preserve existing data and historical valuations. No production deployment or destructive migration.

| Scope | Acceptance gate | Status |
|---|---|---|
| ERP audit, master data, cross-module integration | Stable shared IDs; no duplicate balance sources; module and end-to-end evidence register | Pending |
| GL, AR, AP, multicurrency | Balanced multi-line entries; subledger reconciliation per currency; configured minor units; retry safety | Pending |
| Inventory, warehouses, transfers | Request, approve, issue, partial receipt, in-transit balance, cancellation before issue, compensating reversal after issue | Pending |
| Stock receipt, issue, adjustment, count, cycle count, reconciliation | Atomic movement and balance changes; approved count differences; rollback tests | Pending |
| Reservations, release, available/on-hand/committed | All issue paths enforce reservations; no double counting; concurrent issue tests | Pending |
| Batch, lot, serial, expiry, bins | Unique serials; traceable lot and location; expiry policy; migration preserves untracked legacy stock | Pending |
| Valuation, FIFO, weighted average | Preserve existing weighted average; FIFO requires verified opening layers; transfers preserve value | Pending |
| Sales O2C, purchase P2P | Order, approval, fulfillment, invoice, settlement; partial and reversal tests | Pending |
| Cash, bank, branches, tax | Balanced transfers, bank reconciliation, branch scope, configured tax rules | Pending |
| Cost centers, projects, assets, expenses, budgets | Valid dimensions; depreciation and budget controls; GL reconciliation | Pending |
| RBAC, SoD, approvals, document status, audit | Server-side authorization; distinct approver where required; immutable posted documents; audit trail | Pending |
| Reporting and event-to-JE, inventory/sales/purchase/cash/bank-to-GL | Atomic posting, idempotency, source document traceability, per-currency reconciliation | Pending |
| Offline and cloud sync | Workspace isolation; replay and conflict tests; no duplicate postings | Pending |
| SQLite, Android, WebView 83 | Non-destructive upgrade tests, backup/restore round trip, real Android acceptance, CI evidence tied to commit | Pending |

## Existing integration points
- `flutter_app/lib/services/local_database.dart`: SQLite and operation transactions.
- `flutter_app/lib/services/inventory_locations.dart`: warehouse-specific item identity.
- `flutter_app/lib/services/stock_invoice_commands.dart`: stock movements and weighted average valuation.
- `flutter_app/lib/services/journal_posting.dart`: experimental balanced multi-line journal API.

Do not mark a gate passed without a reproducible test and commit-specific evidence. Currency2 identity and precision remain unresolved. Existing historical test reports are not evidence for new changes.
