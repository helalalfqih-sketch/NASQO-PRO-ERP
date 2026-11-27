# Imported stock reconciliation

The stock reconciliation screen provides an editable list of original products by warehouse, supports all warehouses in one review, and distinguishes suggested quantities, unresolved transfers, negative balances, missing movement evidence, invalid valuation, unsupported currencies and previously approved stock. Selecting all suggestions never posts anything. The operator must review the actual quantities and total cost, select accounts and explicitly confirm. The existing balanced per-location opening operations execute in one atomic batch (maximum 10,000 rows); the source fingerprint is checked inside the same transaction. Negative, missing or incomplete quantities are not converted to zero. An operator can explicitly enter a reconciled quantity/cost for exceptions.

React invoices show approved available stock only in the selected warehouse. Pending historical quantities are labeled as unapproved, with a direct link to the matching original product and warehouse in the reconciliation screen. Closing that screen refreshes the React snapshot without replacing the invoice draft. Approved zero stock remains zero and is never replaced by an older computed quantity. The source product retains pending reference quantities for other warehouses even after its primary warehouse is approved. Missing transfer archives remain flagged as incomplete.

The optional private-file test can run from flutter_app on a workstation with Flutter installed:
```sh
NASQO_PRIVATE_LEGACY_BACKUP="/path/to/private.back" flutter test test/legacy_actual_file_acceptance_test.dart
```
It uses a temporary database, checks source counts and raw ledger sides, and does not post opening journals or sync data. It is skipped without a supplied private file. No real data is included in CI. Device acceptance and physical inventory/accounting reconciliation remain required.
