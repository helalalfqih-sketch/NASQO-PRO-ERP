# Local catalog parity

Original React currency/group, account, warehouse and inventory controls now have native transactional handlers. Mutable catalog metadata lives in backed-up SQLite state, not in the immutable source archive. Currency definitions currently support the engine's known base and supported foreign-currency identities; arbitrary-currency posting and foreign-currency stock remain out of scope. Account metadata edits do not change posted financial attributes. New account opening balances, settlement policies and full message dispatch require additional posting workflows.

Warehouse metadata can be edited. Catalog name, barcode, price, unit settings (if no stock history), minimum, activity and expiry fields can be changed without modifying inventory quantity or valuation. Batch imports and metadata changes use one atomic transaction; the bridge still has a bounded request size. Direct valuation changes are rejected; imported or movement-linked stock/accounts cannot be deleted. Unused new local accounts/items can be deleted with an audit operation. Local-only account deletion blocks subsequent account-only cloud sync until proper migration is available.

Tests check snapshot settings, group/currency changes, account metadata, warehouse edit, import and batch rollback, and protected quantities. No actual user data or cloud resources are changed.
