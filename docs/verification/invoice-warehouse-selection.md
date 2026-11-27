# Invoice warehouse selection

An Android invoice could keep a line's original inventory-location ID after the user changed its warehouse. The resulting mismatch blocked a sale even when an existing balance for the same product was available in the newly selected warehouse. Search results also reported an unspecified linkage error when the selected warehouse had no balance.

Warehouse changes now resolve each unsaved line through its explicit imported/catalog source link. They retain entered quantities, prices and discounts. Cashier product selection uses the same resolution. Identical names or barcodes never establish a relationship. Incompatible unit definitions require replacing the line; no conversion or stock transfer is inferred.

Unavailable stock messages identify the selected warehouse and list known positive, usable balances elsewhere. Invoice posting still requires the inventory record to belong to the submitted warehouse. Selecting or changing a warehouse performs no database mutation.

Validation uses synthetic data:

- Seven catalog tests cover imported and native location links, unrelated barcode matches, available balances, and unit compatibility.
- The built offline React UI passes all 16 invoice/catalog scenarios, including the three warehouse regressions. Requests identify the selected location, and entered sale values survive warehouse changes. No stock mutation occurs during selection.
- The Flutter SQLite readiness test rejects a sale against the wrong warehouse with byte-identical database export, then posts once against the correct location without changing the other warehouse's balance. Repeating the operation remains idempotent.
- TypeScript and protected mobile runtime checks pass. No private backup, customer fixture or production database is included.

Commands:

```sh
npx tsx --test tests/invoiceCatalog.test.ts
npm run lint
npm run check:runtime
npm run build:hybrid
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npx tsx scripts/verify-hybrid-invoice-catalog.ts
cd flutter_app
flutter test test/automatic_workspace_readiness_test.dart
```

The browser host validates UI requests; it does not emulate the accounting engine. The separate SQLite test verifies persistence and stock isolation. Android release availability is recorded in GitHub Releases, not implied by these local checks.
