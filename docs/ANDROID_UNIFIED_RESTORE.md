# Unified web backup operational restore

The recognized NASQO web JSON v1/v2 exports and single-workspace unified SQLite exports are now eligible for the same explicit operational restore path as SmartPro. Android still reads the file natively and imports into its private SQLite database. This is a port of supported core fields, not an execution of the server's SQL or a claim of complete ERP feature parity.

- Preserve account IDs, groups, cashboxes, opening balances, document IDs, counterpart references, raw register sides, invoice details, and source status/deletion flags. Missing required references fail before commit.
- Preserve explicit balanced journal legs when provided within ledger records. Never synthesize historical legs from a single-sided register or send historical operations to the sync outbox.
- Preserve stock marked explicitly verified in the source when its base-currency quantity and cost fit local precision/range; do not replay its history or create a new opening journal. Unverified or unsupported quantities remain reference values and require reconciliation. Verified means the source export's flag, not a new physical count.
- Preserve normalized transfer and offer headers and lines using exact normalized references, not guessed SmartPro IDs. Absent transfer evidence is marked incomplete.
- Preserve original bytes and checksum. ERP modules not implemented by the local runtime, independent journal layouts, and other unsupported structured tables are not reconstructed. Separate unsupported journal tables are rejected rather than dropped silently.
- A populated destination still requires a verified safety backup, explicit confirmation and an in-transaction fingerprint match. Cloud-enrolled data remains protected. Posting roles are reset on a new imported workspace. Native restore retains the saved roles.

Tests use synthetic data and cover JSON activation, journal status preservation, verified/unverified stock, normalized transfers, new posting, rollback, and native round-trip. This is not yet acceptance on a physical Android phone.
