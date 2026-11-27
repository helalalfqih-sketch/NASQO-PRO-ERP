# Mandatory ERP first-run configuration

Status: requirements only; implementation and tests pending.

On first installation, route to a resumable setup wizard. Each step explains requirements, offers editable recommended defaults, validates before completion, persists progress atomically, supports resume, and identifies missing critical configuration. Never silently seed financial transactions or overwrite existing company data.

| Step | Required validation | Recommended default |
|---|---|---|
| Company profile | Nonempty legal/display name and stable company identity | Blank until confirmed |
| Base currency | Explicit ISO currency and minor-unit precision | User-confirmed local currency |
| Fiscal year | Valid start/end dates, no overlapping periods | Calendar year, editable |
| Chart of accounts | Valid unique codes, hierarchy and posting accounts | Editable template, no opening balances |
| Control accounts | Valid active posting accounts for AR/AP, inventory, COGS, revenue, cash/bank and applicable taxes | Map explicitly to template |
| Default warehouse | Existing active warehouse in company scope | Main warehouse |
| Cashbox or bank | Active account with valid GL mapping and currency | Main cashbox |
| Inventory valuation | Explicit supported method and verified opening valuation | Existing weighted-average policy; FIFO only with verified layers |
| Tax | Explicit applicability; valid rules and mappings when applicable | No tax only after explicit confirmation |
| Document numbering | Unique scoped sequences and collision checks | Separate sequence per document type |
| Roles and permissions | Authorized administrator, least privilege and enforced permissions | Admin, accountant, inventory, sales, purchasing, viewer templates |

## Enforcement
Persist versioned setup state per company/workspace in existing authoritative storage. Derive readiness from actual records, not a wizard completion flag. Revalidate in the same transaction as posting, including native bridge and server endpoints. Block unsafe financial and stock postings when critical checks fail; allow setup, read-only reports, backup and safe recovery. Do not lock users out of their historical records. Existing installations require non-destructive assessment and explicit remediation; do not reset or silently change currency, fiscal periods, numbering or valuation.

## Readiness report
Each check returns PASS, MISSING or WARNING, stable check ID, explanation, remediation route and blocking flag. Critical MISSING or blocking WARNING prevents posting. Report overall readiness, company/workspace, configuration revision and evaluation time. Warnings cannot bypass critical requirements. Tax not applicable is PASS only after explicit confirmation.

## Acceptance tests
Fresh installation cannot post before setup; each step persists across restart; invalid data cannot advance; direct service and bridge calls cannot bypass gate; missing/deactivated control accounts invalidate readiness; existing data survives migration; completed valid setup enables authorized posting; tax applicability and numbering collisions are tested; offline resume and server-side authorization are verified. No gate may be marked implemented until commit-specific tests pass.
