# ERP completeness audit and implementation contract

Baseline: `2276876510fb4a0c0b09731c4345b2fd446cf09f` (2026-11-27). User requested the complete suite, explicitly including warehouse transfers, stock in transit, reservations, traceability and accounting integration. Slash-prefixed names are requirements, not implemented commands.

This is a functional/code audit of three distinct execution paths: web SQLite, Android local SQLite, and the separately configured connected SmartPro service. A feature in the connected service does not imply it exists offline. Administrative CRUD is not proof of operational/accounting completion. No overall production-readiness percentage is inferred from screen or test counts.

## Reproduced baseline gaps

Run `node --import tsx scripts/audit-erp-completeness.ts --strict` against generated temporary databases. Exit 2 means unresolved invariants, not a passing suite. The script never opens the application's production database or a user backup.

| ID | Baseline observation | Required outcome |
| --- | --- | --- |
| sale-stock | Sale of 2 correctly changes quantity 10 → 8 | Retain atomic quantity handling |
| sale-to-gl | Web invoice marked posted; zero journal headers | Every new supported financial event produces balanced explicit legs atomically |
| identical-retry | Repeating the request leaves quantity 8 | Retain exact-once posting |
| changed-retry | Same request key with changed quantity accepted as prior success | Reject conflicting payloads without another write |
| warehouse-boundary | Invoice in B consumes A's stock, 8 → 6 | Reject mismatched locations; preserve every balance |
| journal-to-report | Posted 500/500 journal appears as 0/0 in normal trial-balance input | Report explicit journal legs once, including reversals |
| journal-backup-roundtrip | Exact journal legs survive table-snapshot backup/restore | Preserve this working mechanism |

Additional source findings: native advanced ERP actions throw in `src/hybrid/serviceAdapter.ts`; native stock posting currently supports base-currency invoices only; local fiscal locking is explicitly unavailable; web production updates quantities without a stock journal; financial reporting still infers some COGS from purchases. These require dedicated acceptance, not merely enabling hidden buttons.

## Coverage of the requested suite

`Partial` means an actual subset exists but the requested end-to-end behavior is not complete. `Absent` means no operational path was found in the inspected schema, commands, API and UI. `Audit` denotes a cross-cutting deliverable rather than a business transaction. Source references are relative to the repository.

| Requested capabilities (aliases retained) | Current web / Android | Main evidence and remaining integration |
| --- | --- | --- |
| full-erp-suite; erp-complete-system; erp-completeness-audit; module-gap-analysis; end-to-end-gap-analysis | Audit / Audit | This audit and executable probes; no claim of a complete ERP |
| master-data-unification | Partial / Partial | `src/types.ts`, `erpRecordRules.ts`, native `inventory_locations.dart`; stock-location cards still combine product and balance identity; party accounts and GL roles need explicit semantics |
| cross-module-integration; event-to-je | Partial / Partial | `server/erpActions.ts`, native document/stock commands; no common event journal across all workflows |
| general-ledger; erp-reporting | Partial / Partial | `server/sqliteDb.ts`, `src/erp.ts`, native `journal_posting.dart`; phase 1 connects web manual journals to the trial balance only; event posting and other statement bases remain incomplete |
| ar; ap | Partial / Partial | Invoices, account statements and due dates; allocation/open-item aging and settlement/revaluation lifecycle incomplete |
| inventory-core; warehouse-management; multi-warehouse | Partial / Partial | Item/warehouse CRUD, invoice stock posting, returns and historical reports; operational transfers and reservations incomplete |
| warehouse-transfer; inter-warehouse-transfer | Historical only / Historical only | Unified stock transfer tables/imports; `SmartProTransfersPanel.tsx` and `/warehouse/transfer` implement a separate connected single-step transfer |
| stock-transfer-request; stock-transfer-approval; stock-transfer-issue; stock-transfer-receipt; transfer-status | Absent / Absent | No request → approval → issue → receipt state machine in local commands/schema |
| in-transit-stock; partial-transfer; transfer-cancel; transfer-reversal | Absent / Absent | No durable transit quantity/value, partial receipt ledger or compensating transfer workflow |
| stock-receipt; stock-issue | Partial / Partial | Invoice/return movements exist; independent authorized receipt/issue documents with reason and GL impact are missing |
| stock-adjustment; stock-count; cycle-count; stock-reconciliation | Partial / Partial | Legacy opening review exists; web direct quantity edits bypass an adjustment document; no count freeze/recount/variance posting cycle |
| stock-reservation; stock-release; available-stock; on-hand-stock; committed-stock | On-hand only / On-hand only | No durable reservations/commitments linked to orders; available currently means operational on-hand |
| inventory-valuation; weighted-average | Partial / Partial | Weighted average on supported receipts; source/period/currency reconciliation and immutable valuation history need completion |
| fifo | Absent / Absent | No acquisition layers, layer-consumption links or FIFO reversal policy |
| batch-tracking; lot-tracking; serial-number-tracking | Absent / Absent | No stock identity dimension or movement-level allocation/uniqueness rules |
| expiry-tracking | Metadata only / Metadata only | Item/legacy line expiry field; no lot expiry enforcement, FEFO allocation or recall trace |
| location-bin-management | Absent / Absent | Warehouse identity exists; no warehouse/bin hierarchy or bin-level balances |
| sales-module; o2c | Partial / Partial | Quotes/orders/invoices/returns and account statements; no complete order reservation → delivery → invoice → allocated receipt lifecycle |
| purchase-module; p2p | Partial / Partial | PO CRUD and web full receipt; no separate partial GRN, invoice matching, supplier settlement lifecycle; native PO receipt blocked |
| inventory-to-gl; sales-to-gl; purchase-to-gl | Web gap / Supported invoice subset | Native stock invoice journals exist; web posted register is not an equivalent explicit GL journal |
| cash-management; cash-to-gl | Partial / Partial | Cashbox CRUD/report, vouchers; native balanced supported vouchers; web explicit GL integration incomplete |
| bank-management; bank-to-gl | Absent / Absent | Cashbox-like accounts are not a bank ledger, statement importer or matched reconciliation |
| multi-branch | Absent / Absent | Workspace/warehouse are not branch dimensions with access and interbranch clearing |
| tax-engine | Partial / Partial | VAT configuration/report and native invoice tax; no tax-code effective dates, exemptions, inclusive/exclusive policy and jurisdiction validation suite |
| multicurrency | Partial / Partial | Currency metadata/report filters; web rates, native limited posting; no full functional-currency GL/realized-unrealized FX lifecycle |
| cost-center | Partial / Partial | CRUD, category grouping and budget field; no consistent document/journal-line allocation dimension |
| project-accounting | Absent / Absent | No project master, committed/actual costs or project P&L |
| fixed-assets | Absent / Absent | No asset acquisition, capitalization, depreciation, disposal or reconciliation lifecycle |
| expense-management | Partial / Partial | Voucher expense categories and reporting; claims, approvals, reimbursements and allocation incomplete |
| budgeting | Metadata only / Metadata only | Cost-center budget value is not period/version budget control or encumbrance |
| rbac; sod | Owner gate / Owner gate | SQLite admin/local-owner and native workspace guards; separate SmartPro admin/editor/viewer roles; no per-operation/branch permissions or maker/checker separation |
| approval-engine | Partial / Partial | PO/leave status edits; no shared authenticated approval chain, thresholds or tamper-proof decision history |
| document-status | Partial / Partial | Draft/post/reversal/trash protections exist; no unified transition model for all requested modules |
| audit-trail | Partial / Partial | Web audit log, native idempotency/outbox; incomplete actor/reason/before-after semantics across modules |
| reconciliation | Partial / Partial | Some cash/inventory report comparisons and imported baseline diagnostics; no bank matching or complete subledger-to-GL reconciliation |

## Implementation order and acceptance gates

1. **Posting foundations:** strict stock-location and unit references, request payload identity, explicit event→journal links, journal-backed reports, fiscal periods, exact money/quantity arithmetic, backup parity. Preserve imported records; do not invent historical journals or replay stock.
2. **Unified masters and access:** stable product/family/location identity, existing account roles and currency definitions, branch/cost-center/project dimensions; authenticated actors, role permissions and maker/checker policy. Apply the readiness contract on the branch. Reuse safe existing defaults, and surface missing or invalid configuration before posting.
3. **Stock operations:** durable transfer request/approval/issue/receipt, immutable transit quantities/value, partial receipt/cancel/unshipped remainder, compensating reversal; then independent receipt/issue/adjustment and count/recount. Every transition is atomic and idempotent in web and native databases.
4. **Availability and valuation:** reservations linked to sales/production demand, explicit release/consumption, `available = onHand - activeReserved`; moving weighted average and FIFO policy with frozen historical layers/costs. Reject a silent cost-policy switch after movements.
5. **Traceability:** warehouse bins, lots, serials and expiry on movement allocations, not only item metadata; unique serial location/state, quantity reconciliation, trace/recall and partial transfer support.
6. **Commercial cycles:** quote→order→reservation→delivery→invoice→receipt and requisition→PO→receipt→supplier invoice→payment; partial quantities, returns, price/tax variances, open-item allocation and three-way matching.
7. **Finance extensions:** bank statements/reconciliation, tax codes, FX settlement/revaluation, budgets, expense claims, assets and projects, all using the same explicit GL posting boundary and dimensions.
8. **Release qualification:** UI→API/bridge→SQLite→restart→backup/restore acceptance on both platforms; denied roles, duplicate/stale requests, partial failure, reversals, period locks and concurrent consumption. Signed APK/AAB and public downloads only after required checks; no production test writes.

Transfer invariants: issue removes source on-hand and adds transit; receipt removes transit and adds destination at the issue's carried cost; receipt cannot exceed outstanding issue; cancellation never erases issued stock; reversal is a new linked compensating document; source+transit+destination quantity/value are conserved absent an explicit valued loss/adjustment. Do not label a single-step transfer as this complete lifecycle.

The full suite remains incomplete until these operational gates pass. An audit, a CRUD form, an imported historical table, or a successful isolated arithmetic test does not mark a missing module as delivered.

## Implemented phase 1 (2026-11-28)

- Web SQLite now rejects cross-warehouse item posting, missing item/warehouse references, inactive new-sale items and undefined units. A pristine unassigned card binds to its first explicit purchase warehouse inside the same transaction; even a late audit-write failure rolls back the binding, stock and document.
- Ledger and journal operation keys now compare normalized business input and reject conflicts with HTTP 409. Identical retries remain safe after reversal, period closure and backup/restore. Oversized keys are rejected, not truncated. Schema v4 adds nullable request fingerprints; v3 databases and table-snapshot backups remain supported without historical reposting.
- The actual finance trial-balance screen and Excel export use `GET /api/db/workspace/:uid/reports/trial-balance`. Standalone journal legs enter the report once, with period/currency filters and dated reversals. Report projections never become invoice records or stock movements. Read failures hide incomplete results and offer Retry. Native reports reuse their already journal-enriched snapshot.
- Added isolated database, HTTP and rendered-browser regression coverage; corrected older test fixtures that used mismatched warehouse/currency identities or treated an altered request as an identical retry. The new suites can be run with the commands below.

`phase1-probes.json` records six verified invariants and the remaining `sale-to-gl` gap. The strict completeness probe intentionally still exits 2. This is **not** a completed posting foundation or ERP release: automatic web invoice→journal posting, full GL/COGS/balance-sheet reconciliation, native advanced command parity and the later phases above remain outstanding. Web posting against unverified legacy stock also needs operational initialization; the existing quantity-update bypass is not proof of successful stock posting. No private backup or production database was used by this phase's tests.

Verification commands:

```sh
node --import tsx --test tests/erp-posting-boundaries.test.ts tests/erp-financial-read.test.ts tests/accounting-audit-25.test.ts tests/unified-sqlite.test.ts tests/sqlite-local-production.test.mjs tests/workspace-isolation.test.ts tests/erp-crud.test.ts tests/import-restore-safety.test.ts tests/hybrid.test.ts
npx playwright test tests/erp-financial-ui.spec.ts
npm run lint
npx tsc -p tsconfig.server.json --noEmit
npm run check:runtime
```

## Priorities on agent/erp-complete-system

| Priority | Area | Remaining acceptance work |
| --- | --- | --- |
| P0 | Posting, GL, currency and fiscal control | The web trial balance now includes explicit journals. Automatic invoice, stock and cash journals, control mapping, currency precision, subledger reconciliation and Android fiscal enforcement remain open. |
| P0 | First run, authorization and approvals | Add persisted setup and PASS / MISSING / WARNING results from actual records. Gate posting transactionally on both runtimes. Implement scoped permissions and approval history. |
| P0 | Inventory transfers and master identity | Implement canonical product/location links and authorized request, issue, transit, partial receipt and reversal with carried cost and accounting. |
| P0 | Offline sync and recovery | Verify replay, conflicts, durable acknowledgements and backup/restore through the real Android bridge. |
| P1 | Commercial, stock and cash operations | Integrate order/fulfillment/settlement, procurement/receipt/matching, reservations, counts, reconciliation, tax and FX after shared posting rules. |
| P2 | Extended ERP | Connect fixed assets, budgets, projects, payroll and advanced stock tracking to shared masters, workflows and the GL. |

The working branch also repairs currency creation while preserving existing currency names as financial identities. Web fiscal checks compare calendar dates, reject invalid dates when a lock applies, and require an explicit unlock on the fiscal-lock endpoint. The current strict probe still reports that a posted web sale creates zero journal headers. Current build evidence covers the hybrid bundle, not an actual Android/WebView 83 device.
