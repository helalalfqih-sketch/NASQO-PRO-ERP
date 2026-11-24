# Local workflow parity: workspace settings and cashbox documents

The React workspace settings save action now updates a validated SQLite state record, independent of imported archive metadata. Local snapshot assembly applies that override last. Company name, selected known currency and WhatsApp preferences are persisted in native exports. This does not implement native WhatsApp dispatch or fiscal-period locking.

The original customer/supplier and cashbox controls now remain on the invoice. Automatic posting settings map each imported cashbox to a distinct cash account, and optionally configure a default cash account where no cashbox is selected. Cash sale and purchase invoices record the customer/supplier side and its settlement, leaving the customer/supplier balance unchanged by the cash settlement. Stock and cost legs remain balanced. Returns use the original settlement account and box. Free cash invoices and cash vouchers also use the selected cashbox mapping. Balance vouchers use a separately approved clearing account. No account is created or inferred from a name. Old direct cash-account stock posting remains supported by the underlying command for compatibility, but the React form uses the original customer and cashbox flow.

A selected cashbox is stored in SQLite state per posted document, preserved by native exports, and included with historical cashbox entries in the cashbox report. Unlinked direct cash account postings are not counted as named box transactions. Stock return kind is normalized for old and new rows.

Regression tests check cash sale, partial return, free cash invoice, cash voucher, customer/cash balances, idempotency, and workspace settings. Actual device testing and full web parity remain outstanding.
