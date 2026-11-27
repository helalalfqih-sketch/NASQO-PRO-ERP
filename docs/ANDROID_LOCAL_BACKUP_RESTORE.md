# Android local backup and restore

The native toolbar has Import and Export actions. The React restore menu also routes to the Android document picker. File content never travels through the JavaScript bridge. The file limit is 32 MiB. Native operational exports are unencrypted JSON with an integrity checksum; the checksum detects accidental corruption, not authenticity. Keep exports private.

## Formats
- NASQO Android native backup v1 (schema 7) or compatible complete native SQLite schema: all operational tables, journal, inventory and sync state are restored transactionally into an empty, unenrolled workspace. Existing records are not overwritten. Unknown schema, missing columns, foreign key violations and unbalanced journals fail closed.
- Existing NASQO web JSON exports v1/v2 and single-workspace unified SQLite, and legacy SQLite customers/stores/products/input_move or bounds: review import, not a live financial migration. Preserve original bytes in SQLite BLOB chunks with SHA-256; retain projected accounts, groups, currencies, warehouses, inventory, ledger and invoice details. Legacy stock quantity is unverified, and historical entries do not become posted journal legs. Return to live data via native toolbar. Original file can be exported exactly while reviewing. Other source tables remain in the original archive rather than being mapped into operational tables.
- Unsupported encrypted, SQL dump, ZIP/GZIP or unknown schema: reject. Do not execute imported SQL.

Native export includes operational tables, not a history of imported archive copies. Export a review source separately if needed. No automatic deletion of live records. No cloud calls or production deployment are needed for local import.

Tests use synthetic records and real SQLite. Before accepting legacy records as live financial balances, inspect the user's actual backup format and reconcile accounts, stock movements, raw debit/credit and all linked invoice lines. Android picker and large WebView snapshot transport require physical-device acceptance.
