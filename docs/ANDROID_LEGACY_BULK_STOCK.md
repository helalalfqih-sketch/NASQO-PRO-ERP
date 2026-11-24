# Bulk legacy stock reconciliation

The bulk screen proposes a draft per warehouse from historical invoices plus fully mapped transfer movements, using the historical unit catalog cost for an estimated total. It excludes incomplete transfer references, unsupported currencies, negative quantities or quantities beyond three decimal places, unpriced positive quantities and already approved pairs. Drafts can be edited or replaced with actual counted quantity and total cost rows. They are never automatically posted. Explicit confirmation is required for the complete batch. Each row uses the original opening journal, idempotency and inventory rules in one encompassing transaction, so any rejected row rolls back the entire batch.

Cloud-enrolled workspaces remain excluded from replacement. No cloud resources, actual backup content or main branch are changed.
