# Stock posting phase 3

Scope: Android local SQLite and React hybrid, development branch only.

- Cash stock invoices post directly to a selected cash account; credit invoices post to a customer or supplier account.
- Inventory is measured in whole base units. Unit 2 = count2 base units; unit 3 = count2 × count3 base units. Factors are captured in the posted line; returns use that snapshot.
- Invoice tax is a manually entered amount or an explicitly configured percentage (basis points, no default legal rate). Tax is posted separately.
- Partial returns reference a posted stock invoice, can be repeated up to remaining quantities, and allocate net, discount, tax and cost cumulatively to avoid rounding drift. Legacy full reversals remain closed.
- Sales returns can restore original cost after later stock movements. Purchase returns remove the original net acquisition cost from current inventory value; insufficient stock, negative value or nonzero value at zero quantity fail closed pending an approved variance-account workflow.
- Current limitations: integer unit quantities; single warehouse and currency; no split payments, cash service invoices or returns of fully discounted zero-value lines as standalone documents; no automatic statutory tax configuration.
- Cloud sync is not enabled by this change. Stock operations stay in the local outbox. Do not enable financial replication until backend validation, tenant provisioning, conflict policy, migration and deployment are verified. Existing Cloud SQL is stopped and the Cloud Run deployment is not confirmed ready for this API.
- Android signed APK publication remains gated by the existing test/build/sign/publish workflow.
