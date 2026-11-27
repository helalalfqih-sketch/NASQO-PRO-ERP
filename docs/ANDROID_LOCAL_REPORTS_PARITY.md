# Local stock reports

The original inventory movement and price-stat bridge actions now read SQLite snapshots and line evidence in the same transaction. Source invoice and transfer lines are read-only; approved balances are not reconstructed by adding old transactions to current stock. Opening counts form the local cutover. Historical quantities are estimates and are excluded from current stock valuation. Currency buckets stay separate; historical profits are estimates, and prior-date inventory valuation uses current cost. Missing transfer evidence and unmatched lines are disclosed. Detail lists are limited to the most recent 300 movements. This is not yet a full financial statement or fiscal-period engine.

Unified restore regression coverage checks approved and unverified stock, warehouse scope, price history, local sales and prior-date quantities.
