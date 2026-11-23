# Offline-first Android — Phase 2

Base: b700b48916a7d7c9e3581ed628d36f9723c0dace (work/flutter-hybrid-local-sqlite-20261123).

## Scope
Preserve main and cloud resources. Retain the existing Android PlatformView, local HTTPS asset loader, NasqoHome bridge and Dart read-only protocol. Financial mutations remain disabled until transactional persistence is verified.

## Review gates
- Build bundled React assets with npm run sync:flutter-hybrid; verify manifest and offline CSP.
- Generate Android scaffold using the existing preview workflow and setup-android-hybrid.mjs.
- Run Flutter analysis, unit tests and Android emulator smoke tests; verify cold launch in airplane mode.
- Verify local SQLite persistence across process death, clean initialization and non-destructive upgrades.
- Remove diagnostic logging of WebView content before production.
- Do not enable financial mutations until atomic ledger/inventory/outbox transactions and durable idempotency are implemented.
- Do not merge or deploy until reviewed. No cloud provisioning in this phase.

## Next phase
Implement incremental SQLite repositories, migrations, financial transaction engine, durable outbox and conflict handling. Preserve stable operation IDs across retries. Sync credentials and network operations belong to native code, not the WebView.

## Verification status
Source inspection only; APK and device tests are not yet verified by this review.
