# Drive connection browser acceptance

Result: 13/13 passed against the actual built `dist/hybrid` application and actual GoogleDriveModal. Environment: Chromium / Playwright with 412×915 viewport and a local synthetic native bridge. This is not an Android device test and not a real Google account login.

User route exercised for every case: dashboard → فتح القائمة → الإعدادات → Google Drive → Sign in with Google.

Verified distinct safe banners for missing configuration, provider configuration, network, missing scope, cancelled chooser, disabled Drive API, and denied Drive permissions. Additional cases cover a cancelled native profile, disconnected native profile, malformed truthy connected value, retry from network failure to explicit `connected:true`, a rapid double tap yielding exactly one native connect request, and safe/retryable initial status failure.

The synthetic host rejects upload, download/restore, creation/deletion and all financial operations. Every test asserts zero such commands. CSP disables external connections; Playwright separately aborts non-local-origin requests. Final run recorded zero attempted external requests, zero browser errors, and no forbidden commands.

`results.json` includes per-case command audit, screenshot filename and bundle-manifest SHA-256. Each screenshot is the actual application UI with synthetic fixture data. `double-tap-pending.png` records the disabled button while one synthetic native request is pending.

Repeat from /workspace/NASQO-drive-fix:

```sh
npm run check:runtime
npm run build:hybrid
PLAYWRIGHT_BROWSERS_PATH=/tmp/nasqo-playwright NASQO_ACCEPTANCE_OUT=/workspace/NASQO-evidence/drive-camera-1121/browser-drive ./node_modules/.bin/tsx scripts/verify-hybrid-drive.ts
```

Interactive local preview:

```sh
NASQO_PREVIEW_ONLY=1 NASQO_ACCEPTANCE_PORT=4188 ./node_modules/.bin/tsx scripts/verify-hybrid-drive.ts
```

Default preview simulates GOOGLE_NETWORK_ERROR; `?driveError=success` simulates explicit successful connection. No credentials or real Google services are used. A pre-fix run is preserved in sibling `browser-drive-before-status-redaction`: 11 passed and one failed because the initial status error rendered raw native error text. The final fixed run is separate and green.
