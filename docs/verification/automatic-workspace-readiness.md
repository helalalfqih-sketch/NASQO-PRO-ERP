# Immediate local operation after setup and restore

A fresh local business receives zero-opening system posting accounts, a default warehouse/cashbox and cash customer/supplier identities. Valid explicit posting mappings remain authoritative. Supported legacy restores prepare source-bound stock balances atomically; upgrades preserve prior counts and purchases. This is authorized by the owner's 2026-11-27 request to remove mandatory account and cost approval from ordinary operation.

The cutover records each product/warehouse once, using its original quantities or an existing counted baseline. Net purchase average determines opening cost when positive purchase quantity exists; otherwise the original catalog purchase price is used. Zero-price records remain zero, and negative quantities remain negative. Dedicated balanced opening entries do not replay historical invoices or transfers and do not alter existing party balances. Ambiguous references remain in the original archive and optional diagnostics. A negative balance receipt records any valuation variance explicitly. A first purchase in another warehouse creates a separate location without rebinding the original stock.

Initialization completes before the Android WebView requests its snapshot. Ordinary reports no longer show an expanded technical migration notice; stock review remains available. A new cashbox can create its own posting account. Native backup and Android file-picker bounds are 128 MiB, retaining checksums, size limits, source bytes and SQLite validation.

Validation before Android build:
- Synthetic SQLite tests: fresh purchase/sale, automatic cashbox setup, distinct warehouse receipt, repeated requests/startups, counted stock plus a later purchase, zero/negative stock, negative-balance purchase and return, balanced journals, native backup round trip.
- Existing stock invoice, restore, cashbox, quantity-review and import tests; changed tests now expect automatic defaults rather than a missing-setup error.
- Private original source, tested outside the repository: 1,445 product masters, 2,987 product/warehouse baselines, all 129 source accounts and 9,189 original register entries unchanged, no historical stock movement replay, successful new sale and native re-restore. Source bytes unchanged. Private files and financial values are not included here.
- TypeScript check, hybrid build/offline audit, runtime integrity, import/backup and document-reference Node tests.

The original archive is evidence, not a physical stocktake. Missing source warehouse references cannot be fabricated. Existing explicit account mappings and quantities remain preserved. Review-only imports stay read-only. No public deployment or Google Play rollout is performed by this change itself.
