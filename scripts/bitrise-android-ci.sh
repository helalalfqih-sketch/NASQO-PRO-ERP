#!/usr/bin/env bash
# Shared by Bitrise and local validation; never reads a private source backup.
set -euo pipefail
umask 077
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
phase="${1:-}"
case "$phase" in web|prepare|test|apk) ;; *) echo 'Usage: bitrise-android-ci.sh web|prepare|test|apk' >&2; exit 2;; esac
: "${BITRISE_DEPLOY_DIR:?Set a private CI artifact directory}"
output="$BITRISE_DEPLOY_DIR/nasqo-ci"
mkdir -p "$output"
# pipefail propagates failed checks/builds; an old APK cannot survive a rerun.
exec > >(tee "$output/$phase.log") 2>&1

case "$phase" in
  web)
    rm -f "$output"/*.apk "$output"/*.apk.sha256 "$output/apk-identity.json"
    npm ci --no-audit --no-fund
    npm run check:runtime
    node scripts/guard-public-backups.mjs
    npm run sync:flutter-hybrid
    node --import tsx --test tests/hybrid.test.ts tests/hybrid-pending-submission.test.ts \
      tests/hybrid-resume-state.test.ts tests/document-references.test.ts \
      tests/workspace-isolation.test.ts tests/backupFormat.test.ts \
      tests/audit-repair-reports.test.ts
    git rev-parse HEAD > "$output/source-sha.txt"
    ;;
  prepare)
    test -s flutter_app/assets/web/hybrid-manifest.json
    test "$(flutter --version --machine | python3 -c 'import json,sys; print(json.load(sys.stdin)["frameworkVersion"])')" = 3.29.3
    cd flutter_app
    flutter create --platforms=android --org=com.indexesstore .
    node ../scripts/setup-android-hybrid.mjs
    flutter pub get
    ;;
  test)
    cd flutter_app
    flutter analyze --no-fatal-infos
    bash ../scripts/test-flutter-audit.sh
    ;;
  apk)
    # This is deliberately a debug artifact for a clean emulator, not a signed
    # production update. Signing secrets and cloud-service secrets are unused.
    rm -f "$output"/*.apk "$output"/*.apk.sha256 "$output/apk-identity.json"
    cd flutter_app
    bash ../scripts/build-android-with-retry.sh flutter build apk --debug
    source_apk=build/app/outputs/flutter-apk/app-debug.apk
    test -s "$source_apk"
    export NASQO_CI_APK="$root/flutter_app/$source_apk" NASQO_CI_OUTPUT="$output"
    python3 - <<'PY'
import hashlib, json, os, pathlib, re, shutil, subprocess
sdk = pathlib.Path(os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT'])
versions = sorted((sdk / 'build-tools').glob('*/aapt'),
                  key=lambda p: tuple(int(n) for n in re.findall(r'\d+', p.parent.name)))
if not versions:
    raise SystemExit('Android aapt is required to verify APK identity')
apk = pathlib.Path(os.environ['NASQO_CI_APK'])
badging = subprocess.check_output([str(versions[-1]), 'dump', 'badging', str(apk)], text=True)
if "package: name='com.indexesstore.nasqo_pro_erp'" not in badging:
    raise SystemExit('Unexpected APK package; refusing artifact export')
if "application-label:'نسقو برو'" not in badging:
    raise SystemExit('Arabic application label is missing')
if 'application-debuggable' not in badging:
    raise SystemExit('Expected an emulator-only debug APK')
sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
out = pathlib.Path(os.environ['NASQO_CI_OUTPUT'])
dest = out / f'NASQO-PRO-ERP-debug-{sha[:12]}.apk'
shutil.copyfile(apk, dest)
digest = hashlib.file_digest(dest.open('rb'), 'sha256').hexdigest()
dest.with_suffix('.apk.sha256').write_text(f'{digest}  {dest.name}\n')
(out / 'apk-identity.json').write_text(json.dumps({
    'sourceSha': sha, 'package': 'com.indexesstore.nasqo_pro_erp',
    'label': 'نسقو برو', 'variant': 'debug', 'sha256': digest,
    'productionUpgrade': False, 'deviceUiTestedByThisWorkflow': False,
}, ensure_ascii=False, indent=2) + '\n')
print('Verified private debug artifact:', dest.name)
PY
    ;;
esac
