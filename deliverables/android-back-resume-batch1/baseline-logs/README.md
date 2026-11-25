# Baseline verification — Android back/resume batch 1

Repository: helalalfqih-sketch/NASQO-PRO-ERP

Exact source: 741a4dc8a5099448dea0cfb2f7973baace184a2c (dev/offline-first-android-phase2)

Detached isolated worktree: /workspace/NASQO-baseline. No tracked baseline source or lockfile was changed. All tests used generated synthetic/temp data. The private legacy-backup environment variable was not set.

| Check | Result | Log |
|---|---|---|
| npm ci | FAILED: existing package-lock.json/package.json mismatch (missing Cairo/IBM fonts, pg/drizzle/xlsx and transitive packages) | npm-ci.log |
| npm install --package-lock=false | PASS; lockfile preserved | npm-install.log |
| npm run check:runtime | PASS, 28 protected files | runtime-check.log |
| npm run build | PASS (TypeScript + Vite + Sites packaging) | npm-build.log |
| npm run build:hybrid | PASS; 61 files, zero security/offline violations | hybrid-build.log |
| tsx --test tests/hybrid.test.ts | PASS, 17 tests | hybrid-test.log |
| flutter analyze --no-fatal-infos --no-fatal-warnings | PASS, no issues | flutter-analyze.log |
| flutter test --reporter expanded | PASS, 46 passed; 1 private backup acceptance skipped | flutter-test.log |

The npm lock mismatch is pre-existing and has not been repaired as part of the navigation/resume batch. Existing build commands succeed after dependency installation used by CI. No Android APK compilation or Android UI test was performed: Android SDK, adb, emulator and /dev/kvm are absent. No physical device was accessed, and no production data was used.

## Toolchain

Node v24.22.3; npm 11.19.1; Java 21.0.13.

Flutter 3.29.3 provisioned from official flutter/flutter git tag at /workspace/toolchains/flutter; framework ea121f8859e4b13e47a8f845e4586164519588bc, engine cf56914b326edb0ccb123ffdc60f00060bd513fa; Dart 3.7.2.

Official archive/release metadata endpoints returned HTTP 404; source bootstrap succeeded and downloaded Dart/Flutter artifacts from the configured official storage.

## Repeat commands

From /workspace/NASQO-baseline:

```sh
npm install --package-lock=false --cache /workspace/toolchains/npm-cache --no-audit --no-fund
npm run check:runtime
npm run build
npm run build:hybrid
./node_modules/.bin/tsx --test tests/hybrid.test.ts
```

From flutter_app (after mkdir -p assets/web/assets), prefix Flutter commands with:

```sh
CI=true PUB_CACHE=/workspace/toolchains/pub-cache XDG_CONFIG_HOME=/workspace/toolchains/config FLUTTER_SUPPRESS_ANALYTICS=true DART_SUPPRESS_ANALYTICS=true LD_LIBRARY_PATH=/workspace/toolchains/lib /workspace/toolchains/flutter/bin/flutter
```

Then run `pub get`, `analyze --no-fatal-infos --no-fatal-warnings` and `test --reporter expanded`. Analyzer cache needs write access to /home/agent/.dartServer. The local /workspace/toolchains/lib/libsqlite3.so is a symlink to the already installed /usr/lib/x86_64-linux-gnu/libsqlite3.so.0, because the environment has no development soname. Initial attempts failing due to cache permissions and SQLite soname were environment setup failures, not code regressions; final logs above record the corrected runs.

These baseline automated checks do not establish Android hardware-back, gesture-back, IME, file-picker/share-sheet cancellation or process recreation UI behavior.
