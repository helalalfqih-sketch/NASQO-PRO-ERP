# ERP COMPLETENESS RULE

Umbrella scope: /erp-complete-system. Requirements only; implementation and acceptance tests pending. Extends existing ERP acceptance, onboarding, preferences and invoice specifications.

ONE MASTER RECORD = ONE SOURCE OF TRUTH. Shared customer, vendor, item, service, warehouse, branch, cashbox, bank, account, cost center, project, unit, currency, tax, payment method, employee and salesperson identities. Preserve historical document snapshots and reconcile legacy duplicates explicitly; never merge by name alone.

No isolated module. Source document -> business event -> versioned posting rule -> journal entry -> GL. Each posting atomically updates affected local authoritative records, subledgers, stock, cost layers and audit, with durable outbox and idempotency. Remote delivery is asynchronous and must expose pending/conflict states; do not claim distributed atomicity. Reports derive from committed records. Reconcile before declaring completion.

## Workflows
- Sales: quotation, order, reservation, delivery, invoice, return/credit note, receipt, aging, commission, GL and tax. Avoid duplicate COGS or revenue across stages.
- Purchase: request/requisition, approval, RFQ, quotation, order, goods receipt, vendor bill, return/debit note, payment, aging and GL. Reconcile receipt/bill differences.
- Inventory: multi-warehouse, transfer request/approval/issue/transit/partial receipt/completion, cancellation before issue, compensating reversal after issue; receipts, issues, adjustments, counts, reservations, available/on-hand/committed, lots, serials, expiry and bins. No direct undocumented balance mutation.
- Valuation: weighted average, FIFO, standard cost, layers, COGS, landed cost/freight allocation, revaluation, writeoff and inventory-to-GL reconciliation. Preserve historical valuation; require verified opening layers and approved policy changes.
- Cash/bank: multiple accounts, receipts/payments, transfers, opening/closing/count, shortage/overage, bank statement import, unmatched transactions, cheques and reconciliation.
- GL: chart, manual/automatic/recurring journals, accruals, prepayments, reversals, opening/closing, trial balance, balance sheet, P&L and cash flow; posting mappings for inventory, sales, purchase, cash, bank, tax, payroll and assets.
- Branches: scoped warehouses, cashboxes, banks, sales/purchases, profitability, interbranch transfers/accounting and reconciliation.
- Tax/FX: inclusive/exclusive VAT, input/output, exemption/groups, adjustment and reconciliation; base/transaction currency, historical rates, realized/unrealized FX, revaluation and rounding. Currency2 remains unresolved.
- Assets, expenses, petty cash, advances/custody, HR/payroll if in scope, cost/profit centers, projects, allocation and budgets with warnings/blocks.
- RBAC: module/action/record/branch/warehouse/cashbox/account scopes; view/create/edit/delete/post/reverse/approve/export; least privilege and segregation of duties. Enforce at service and server boundaries.
- Approvals: single/multi-level, amount/role/branch rules, delegation, approve/reject/return, history. Draft, submitted, pending approval, approved, posted, partially processed, completed, cancelled, reversed, closed; prohibit bypass of mandatory approval.
- Documents: scoped number series, fiscal year, attachments, notes and source/related links. Posted documents immutable; corrections via reversal.
- Notifications: approvals, stock, overdue AR/AP, closed periods, budgets and failed posting. Reporting: dashboard/KPIs, sales/purchases, inventory/aging, cash/bank, tax, profitability, branch, cost center and audit.
- Audit: actor, action, timestamp, before/after, document/status/approval/posting/reversal history; no silent edits.

## Completeness audit
Inventory actual modules, workflows, master data, permissions, approvals, posting rules and reconciliations. Identify orphan/disconnected modules and end-to-end gaps. Track evidence per commit and environment. Never mark a module complete solely because a screen or table exists. Preserve existing data, offline behavior and Android/WebView 83 compatibility. No production deployment or destructive migration without explicit authorization.
