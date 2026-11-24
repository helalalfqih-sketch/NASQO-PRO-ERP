# Historical backup readiness report

The backup review toolbar now provides a locally generated diagnostic report. It checks duplicate/missing identifiers, account/group/cashbox/warehouse/item references, currency references, numeric fields, invoice details, unverified inventory, and ambiguous historical debit/credit amounts. It also detects existing operational records that prevent replacement. Only aggregate counts and format are copied; no names or identifiers are included.

This is not a financial certification and deliberately never changes the reviewed data, invents a balancing entry, promotes an unverified backup, or clears a live workspace. A clean structural report is not evidence of reconciled historical accounting. Use the original source or a de-identified representative test backup to compare web and Android balances before implementing/authorizing full historical activation.
