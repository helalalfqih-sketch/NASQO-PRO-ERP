# Large Excel item-card round trips

The reported inventory workbook was rejected by the old 2000-row/100-column range guard. NASQO could export more rows than its card reader and both database implementations accepted. Inventory report columns named purchase/sale contain aggregate amounts, whereas card import formerly interpreted those headers as unit prices.

The reader, SQLite server and native atomic commands now accept at most 10000 rows. Populated cells determine the read range, so a formatting-only extended Excel range does not reject a valid file. Actual oversized coordinates and columns, 8 MiB input files and 32 MiB expanded XLSX content remain bounded.

New catalog/inventory exports include a dedicated card sheet, automatically selected in review. It retains string barcodes, recorded reference prices, unit conversions, status, currency, expiry and reorder threshold. Product locations share one catalog card. Older NASQO inventory reports are recognized by report metadata and their header schema: only card metadata is read, with a visible explanation; stock quantities and aggregate prices never enter card writes. Existing cards are skipped. A failed new row rolls back the full transaction.

Validation used synthetic data; the screenshot's actual workbook was not attached:

- Parser: a 3001-row older inventory report yields 3000 unique cards without quantity/cost/price fields; conflicting source identities still fail. A new workbook round-trips 2501 cards and all supported metadata. 10000 item/account rows pass; 10001 fail. Numeric barcode formatting and inflated blank ranges are covered.
- Server SQLite: 3000 new cards, repeated skip, final-row rollback, and 3000 account cards preserve pre-existing data and create no journal entries. Audit records for new attempts remain distinct.
- Native SQLite: real 3000-card import, repeat and final-row rollback; 2501 account cards; no inventory movement or financial posting. Existing quantities and prices remain unchanged. Two small native backup restores remain exact.
- Built hybrid UI: nine Playwright scenarios, including large XLSX review, default card-sheet selection, invalid-sheet disablement, review reset, cancellation, duplicate-submit prevention and native error feedback. The browser host is synthetic; database persistence is covered separately.
- TypeScript, protected mobile-runtime integrity and offline hybrid build pass.

Signed Android verification and delivery are recorded after the CI candidate completes.

The first signed candidate (run 173) exposed a real-device timeout at 3000 rows and was withheld. The native insert-only paths were then changed to one validated transaction batch with preloaded identity indexes, preserving per-row validation, all-or-nothing rollback and duplicate skipping. The 10000-row native SQLite test passed in about 15 seconds locally; the next signed candidate must pass the real Android picker/import/reimport check before publication.

## Android transport acceptance

The signed Android check exposed independent 32 KiB limits in the Android listener and Dart protocol: valid card batches were discarded before their request ID was read, so the UI timed out without a correlated response. The corrected Android listener forwards at most 16 Mi UTF-16 code units; JavaScript and Dart apply matching action budgets (16 Mi for card batches, 2 Mi for structured CRUD/documents, 32 Ki for controls). Row/field validation and atomic SQLite transactions still apply. The client rejects oversized requests before sending; bounded native rejections retain their request ID.

Regression checks send 3,000 cards and 2,501 accounts through the real Dart protocol into SQLite, including repeated import and refreshed snapshots. Transport tests cover 10,000-card envelopes and immediate oversized-request rejection. Android candidates 1.0.173 and 1.0.175 were withheld after the live checks failed; neither is approved for publication.
