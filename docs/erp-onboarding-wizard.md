# ERP onboarding wizard

Status: specification only. Extends erp-first-run-configuration.md and erp-user-preferences.md; do not create parallel settings stores.

| Step | Commands | Validation / default |
|---|---|---|
| Welcome | first-install-wizard, app-onboarding | Resume existing draft or choose new company / existing data |
| Company | company-setup, business-type-setup | Confirm company identity and business type; editable template |
| Locale | language-setup, currency-setup, timezone-setup | Arabic RTL or supported locale; explicit ISO currency and precision; confirmed IANA timezone |
| Finance | fiscal-year-setup, default-coa, default-account-map | Valid periods, unique account codes, active control mappings |
| Organization | create-first-cashbox, create-first-bank, create-first-warehouse, create-first-branch | Active scoped references; at least one cashbox or bank, bank optional when not applicable |
| Policies | tax-setup, inventory-valuation-setup, default-units | Explicit tax applicability; preserve existing valuation; positive unit conversions |
| Trading | sales-setup, purchase-setup, payment-method-setup | Valid numbering, posting mappings and payment methods |
| Security | create-admin-user, default-roles | Authorized admin, secure credential handling, least privilege; no default password |
| Data | opening-balance-setup, import-existing-data | Preview, validate, reconcile, backup, atomic import; no duplicate openings or destructive reset |
| Personalization | theme-setup, dashboard-setup, notification-setup | User-scoped preferences; notifications optional and consent-based |
| Recovery | backup-setup | Verified backup and restore policy; cloud optional; no false success |
| Readiness | first-run-validation | PASS/MISSING/WARNING per actual configuration, blocking flags, remediation links |

Persist step progress and validation revision per workspace; resume after restart offline. Existing installations use non-destructive assessment rather than forced reset. Allow read-only access, setup and recovery while unsafe posting is blocked. Enforce readiness and permissions at service, native bridge and server boundaries. Do not require optional personalization or cloud features to post. Never infer historical currency or valuation. Test fresh install, interrupted setup, invalid inputs, existing-data upgrade, import rollback, duplicate prevention, authorization, RTL, Android and WebView 83. No implementation or test success claimed by this document.
