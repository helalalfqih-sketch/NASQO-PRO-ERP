# SmartPro → NASQO PRO: central MariaDB cutover verification

Date: 2026-11-17. No client rows, credentials or private backups are committed here.

## Confirmed source and staging facts
- Export SHA-256: `184d9aa1284c0fbcb604b4babd32f9c5dbac15cc8a551b81c8bbab4e924cc258`.
- Original SmartPro export: 20 business tables; imported privately into isolated MariaDB.
- Imported counts: 127 accounts, 1,425 products, 5 warehouses (2 active), 8,967 documents, 13,861 invoice lines, 25 warehouse transfers and 1,373 transfer details.
- Migration adds separate NASQO tables for authorization/audit, invoice retry keys, stock-transfer retry keys, return linkage/quantities, and voucher retry keys.
- Native warehouse references `2` and `3` are absent. There are 2 transfers with a missing source warehouse and 4 with a missing destination warehouse. A `store_id1=0` row for a type-3 movement may be opening/adjustment, not necessarily a missing warehouse.
- Full movement reconstruction (invoices 2,3,4,5 and transfer types 1,3) yields 3,336 product/warehouse positions, 294 negative estimated positions affecting 269 products, and **3 negative estimated positions at active warehouses**. There are 447 unresolved positions with missing warehouse references. These are NOT certified stock balances.
- Direct historical writes are unchanged. Transactional stage tests for invoices, returns, warehouse transfers, and cashbox vouchers were fully rolled back. Historical source counts were rechecked afterward.

## Implemented in NASQO's central-only mode
- Firebase/Google verified user authorization, admin/editor/viewer roles, audited CRUD and legacy password protection.
- Atomic sales/purchase invoices: native `bounds` and `bill_details`, audit, idempotency, exact decimal validation and warehouse/product checks.
- Sales cannot post without reconciliation flag; when enabled, they also check current reconstructed stock for each line.
- Safe return workflows: sales-return type 4 and purchase-return type 5, linked to an original **NASQO-created** invoice and original line. Double-return prevention; purchase return checks stock availability after reconciliation. Legacy returns remain historical, not silently relinked.
- Warehouse transfer type 1 from a known active store to another active store, with stock availability checks, audit and idempotency.
- Cashbox-linked type-1 account voucher (single `dain` or `madin` amount), audited and idempotent. This is NOT a validated multi-line general journal.
- Authenticated reports: source-type document totals, original account statements by currency/period and detailed per-warehouse inventory movement with unresolved-reference diagnostics. Reports explicitly distinguish estimates from certified balances.
- Prevent generic row edits to financial document tables, and protect legacy warehouse/cashbox/currency identifiers against deletion while referenced by historic records.
- Corresponding invoice, returns, warehouse transfer, voucher, reports and administrator views.

## Rollout gates — disabled on production until financial acceptance
- `SMARTPRO_DB_HOST`, `SMARTPRO_DB_USER`, `SMARTPRO_DB_PASSWORD`, `SMARTPRO_DB_NAME`.
- `SMARTPRO_FIREBASE_PROJECT_ID`, `SMARTPRO_ADMIN_EMAILS`.
- `SMARTPRO_WRITE_ENABLED=1` enables authenticated general record operations.
- `SMARTPRO_POSTING_USER_ID` identifies the approved SmartPro legacy user reference; Firebase actor remains in NASQO audit.
- `SMARTPRO_INVOICE_WRITE_ENABLED=1`, `SMARTPRO_RETURN_WRITE_ENABLED=1`, `SMARTPRO_STOCK_WRITE_ENABLED=1`, `SMARTPRO_VOUCHER_WRITE_ENABLED=1`: independent write gates.
- `SMARTPRO_INVENTORY_RECONCILED=1` must remain disabled until inventory balances, opening adjustments, missing warehouse references and unit conversions have been checked.
- `SMARTPRO_PRIMARY_ENABLED=1` disables legacy/Firestore user workflows; **do not enable until the full NASQO functional migration is completed**.

## Still needed for production-wide cutover
1. Reconcile stock against signed warehouse opening counts, retired warehouses 2/3, all returns, and SmartPro's original per-product stock reports. Do not resolve discrepancies by inventing quantity.
2. Certify native document-type meanings and all financial totals/currency conversion conventions with a domain owner.
3. Build and acceptance-test compound journal entries, payment settlements, invoice edits/cancellations, inventory adjustments, stocktakes and trial balance.
4. Migrate remaining NASQO HR, payroll, CRM, manufacturing, procurement and reporting screens to the same authenticated MariaDB domain API. Existing IndexedDB/Firestore screens must not remain active when central primary mode is enabled.
5. Verify authentication, concurrent retries, ownership, audit durability, pre-cutover backup and full rollback procedure before switching production.

**Never commit the source SQL/backup or database credentials to GitHub or public app assets.**
