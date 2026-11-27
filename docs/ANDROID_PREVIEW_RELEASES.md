# NASQO Android signed preview releases

The repository owner configures signing through `scripts/setup-android-release-key.sh` and keeps an independent encrypted backup of the original keystore and passwords. Never commit or share the private key, password file or GitHub secret values.

## Release lifecycle

- Source: `dev/offline-first-android-phase2`.
- Workflow: `.github/workflows/flutter-hybrid-preview.yml`.
- Publishing is opt-in using the repository variable `NASQO_ANDROID_PREVIEW_PUBLISH=true`.
- The build must pass React bridge tests and Flutter/SQLite analysis and tests before producing the signed release APK.
- The signing certificate must match `NASQO_ANDROID_CERT_SHA256`. Missing secrets or mismatched certificates fail the release rather than falling back to a debug key.
- Releases are named `android-preview-v<versionCode>`, with increasing version codes derived from the workflow run number. A published tag must not be overwritten.
- Each preview release contains `NASQO-PRO-ERP.apk` and its SHA-256 checksum.
- Release index: https://github.com/helalalfqih-sketch/NASQO-PRO-ERP/releases

## Installation and upgrades

The signed preview checks for newer eligible GitHub preview releases at startup and when resumed, subject to a 15-minute check interval. It offers an APK download link and never forces an update or blocks offline startup. The Android installer still requires the user's approval. Android enforces the application ID and signing certificate on upgrades.

The existing debug APK may use a different signing identity. Do not uninstall an existing installation containing important local records until a verified export and restore procedure is available. Signed preview releases with the same key and application ID are intended to support in-place upgrades; test this on a disposable installation with synthetic records before using real data.

## Acceptance checks

- First signed build succeeds, certificate matches and release assets are published.
- Install the first signed release on a test device.
- Publish a later signed release, observe the update notice and approve the upgrade.
- Confirm the installed build number increases, test data survives, and offline startup still works.
- Confirm the old release remains available and no silent downgrade occurs.

These builds remain development previews. Cloud synchronization, financial posting, and production data recovery are not yet certified. Do not use real financial data until release acceptance is complete. Cloud Run deployment and GitHub main are out of scope for this workflow.
