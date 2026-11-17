# SmartPro → NASQO PRO central cutover: operational readiness

Date: 2026-11-17. This file contains **no** customer data or credentials.

## Facts confirmed in isolated MariaDB stage
- Source dump SHA-256: `184d9aa1284c0fbcb604b4babd32f9c5dbac15cc8a551b81c8bbab4e924cc258`.
- Original schema has 20 business tables. The stage also contains `nasqo_access_roles`, `nasqo_audit_log`, and the additive `nasqo_invoice_requests`.
- 127 accounts, 1,425 products, 5 warehouses, 8,967 accounting documents, 13,861 standard invoice lines at import.
- Source documents with `doc_type=2` match sale-line price patterns; `doc_type=3` match purchase-line price patterns.
- Refunds (likely `doc_type=4,5`) and store-transfer semantics require **separate acceptance tests**.
- A simplistic net-quantity estimate from bill line types 2/3/4/5 (not including opening stock and transfer logic) yields 26 negative product balances among 1,353 referenced products. These **are not authoritative negative stock**. Historical stock reconciliation is required.
- 25 warehouse-transfer headers and 1,373 transfer detail lines exist. Store transfer `type` values include 1 and 3.
- Actual SQL insertion of `bounds`, `bill_details`, and audit log inside a transaction succeeded in stage and was rolled back; no test invoice was committed.
- Duplicate invoice request-key constraint and rollback were tested on stage.
- No changes to the Windows SmartPro database were made during this development.

## Implementation status
- Verified Google/Firebase authentication, role checks, record CRUD and audit log are available in the central API.
- Direct row writes to accounting document tables are blocked; they must use transaction-aware workflows.
- New sale/purchase invoice creation workflow posts header, items, audit entries and idempotency claim in one InnoDB transaction.
- Invoice item decimal arithmetic uses 4-digit fixed point; native SmartPro data columns are strings.
- A new invoice form is reachable from central SmartPro management.
- These are **incremental modules**, NOT a claim that all NASQO Finance, POS, Procurement, HR and Manufacturing screens are migrated.

## Deployment gates (all disabled by default)
- SMARTPRO_DB_HOST, SMARTPRO_DB_USER, SMARTPRO_DB_PASSWORD, SMARTPRO_DB_NAME
- SMARTPRO_FIREBASE_PROJECT_ID, SMARTPRO_ADMIN_EMAILS
- SMARTPRO_WRITE_ENABLED=1 for authenticated record changes.
- SMARTPRO_POSTING_USER_ID must map API postings to an approved legacy user reference; preserve modern actor in audit.
- SMARTPRO_INVOICE_WRITE_ENABLED=1 for atomic invoice posting.
- SMARTPRO_INVENTORY_RECONCILED=1 before sale invoices.
- SMARTPRO_PRIMARY_ENABLED=1 switches the application into the central-only UI. **Do not set this until all full ERP workflows are implemented and tested.**

## Still required for complete cutover
1. Reconstruct and reconcile per-warehouse inventory including document types 2/3/4/5, transfer types 1/3, opening stock, unit conversions and original SmartPro reports.
2. Implement transactional sale return, purchase return, invoice edit/cancel, transfers, journals, settlements and trial-balance reporting.
3. Move the existing NASQO screens (not just the central administration screen) off IndexedDB/Firestore and onto the authenticated MariaDB domain API.
4. Validate all role workflows, duplicate request retries, decimal/currency cases, authorization and audit snapshots under realistic concurrency.
5. Preserve pre-cutover backup and tested rollback; verify with an accountant before production switch.

**Neither the migrated SQL nor credentials may be placed in public web assets or source control.**
