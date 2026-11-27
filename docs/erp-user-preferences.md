# User preferences

Requirements only; implementation pending. Reuse existing home layout and settings persistence where possible. Scope preferences by workspace and authenticated user (or explicit local profile). Never change company defaults, base currency, posting rules or historical records through preferences.

- Theme: light, dark, system; preserve RTL and accessibility.
- Home layout: reorder and hide authorized cards, restore defaults.
- Default branch, warehouse, cashbox, currency: validate active references, workspace membership, branch compatibility and permissions at selection and use. Fall back to valid company defaults or require selection; never silently change posted documents.
- Favorite actions: stable action IDs, deduplicated, permission filtered.
- Recent actions: bounded list of action IDs and timestamps, no financial payloads or search text; allow clearing.
- Save atomically, restore after restart, isolate users, support offline operation. Sync only within authorized user scope; resolve preference conflicts independently from financial data.
- Preferences cannot bypass first-run readiness, RBAC, approvals or posting validation.

Acceptance: restart persistence, user/workspace isolation, invalid/deactivated references, revoked permissions, theme and RTL, layout restoration, favorites/recent deduplication, offline behavior, Android/WebView 83 compatibility. Existing installations must retain their data and valid preferences. No implementation claim until tests pass.
