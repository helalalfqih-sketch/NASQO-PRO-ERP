# Synchronization pagination and cursor integrity

A sync cycle processes at most ten 100-operation push batches and ten pull pages. Every page is applied atomically with its cursor; remaining work stays queued for the next cycle. The HTTPS transport validates positive acknowledgements, canonical decimal revisions, contiguous workspace-specific operation revisions, unique operation IDs within each page, and exact cursor advancement. Invalid pages are rejected before applying any operation. No runtime enrollment or server-side domain support has been added.

The current runtime still permits only account.create and account.update against explicitly enrolled non-imported workspaces. Stock, invoices, historical imports, and cloud replacement require a separately designed and tested server transaction and workspace migration protocol. Nothing here deploys Cloud Run, starts Cloud SQL, changes Firebase, grants membership, or sends private business data.
