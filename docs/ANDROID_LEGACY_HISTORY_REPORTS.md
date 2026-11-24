# Historical restore follow-up

The primary action for a SmartPro SQLite backup is now operational account restore, with review-only still available. It remains explicitly confirmed and restricted to an empty local working database; no existing working data is overwritten.

The native history screen makes transfer headers and lines, offers and their lines, deleted-document archives and alerts available from the persisted original source. Older archives without the structured collections can reconstruct these views in an app-private temporary file after SHA-256 verification, without modifying the working database.

The stock opening screen combines invoice-derived quantities with fully resolved historical transfers as a reconciliation reference. A transfer whose source/destination, product or unit cannot be resolved is excluded and explicitly reported. A nonnegative integral historical quantity may be copied into the count field as an optional suggestion, but never silently approved. Operational stock and cost still require confirmation and do not create duplicate historical entries.

The existing React cashbox report now has a local bridge implementation for historical register cash movements. The original web direction rules and date/currency filters are preserved. Unknown currencies and mismatched cashbox currencies are not merged into the base currency or into an incompatible box. Modern GL cash accounts continue to be reported separately; this historical report is not a certificate of balance-sheet equivalence.

No real backup content is committed. Synthetic tests cover transfer conservation, unresolved references, original archive fallback, historical cash directions, currency/date filtering and bridge response.
