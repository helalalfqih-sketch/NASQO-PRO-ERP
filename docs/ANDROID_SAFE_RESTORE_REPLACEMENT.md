# Local restore replacement

The native Android file picker performs SQLite or recognized native JSON restore without moving large base64 messages across the WebView. A SmartPro SQLite (.back) source can be restored into the working account register; review remains optional. One gzip compression layer is decoded into a private temporary file with a 32 MiB expanded-size limit. The decoded payload is the archived source. ZIP and arbitrary SQL execution are not enabled. Recognized SmartPro SQL literal dumps use the separate data-only parser.

When the working database contains rows, a local replacement requires:
1. Export all native working tables, including unsynchronized operations and the original archive, independently of any selected historical review.
2. Save the file through Android's document picker. The native host reopens the saved document and verifies its SHA-256 against the private export before reporting success.
3. Obtain separate explicit confirmation.
4. In the same SQLite transaction as the restore, compare the current full deterministic export hash against the saved export hash, reject changed data or any remote synchronization enrollment/history, delete dependent tables before parents, and validate the incoming records. A failure rolls back the entire transaction.

No remote resources are modified. Selected review archives remain stored; only the active-review pointer is removed after successful restore. The verified safety copy can be restored using the same procedure. Existing native imports from older schema versions remain supported. Replacement is not available if the backup is too large, a document provider cannot read back the saved copy, or the working database has synchronization history. This is not automatic historical stock valuation or a reconstruction of legacy double-entry legs.

Synthetic tests cover gzip equivalence, no implicit replacement, stale export rejection, rollback after invalid incoming account, enrollment protection, restoration while reviewing the source and restoring a saved native safety copy. Physical-device file provider behavior still requires acceptance testing.
