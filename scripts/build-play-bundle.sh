#!/usr/bin/env bash
set -euo pipefail
# Invoked from flutter_app while the existing temporary signing key is present.
: "${NASQO_ANDROID_KEYSTORE_PATH:?}"
: "${NASQO_ANDROID_CERT_SHA256:?}"
CODE=$((1000 + GITHUB_RUN_NUMBER))
bash ../scripts/build-android-with-retry.sh flutter build appbundle --release \
  --build-name="1.0.$GITHUB_RUN_NUMBER" --build-number="$CODE" \
  --dart-define=NASQO_ANDROID_PREVIEW=false \
  --dart-define=NASQO_ANDROID_BUILD_NUMBER="$CODE" \
  --dart-define=NASQO_FIREBASE_API_KEY="$NASQO_FIREBASE_API_KEY" \
  --dart-define=NASQO_SYNC_ENDPOINT="$NASQO_SYNC_ENDPOINT"
mkdir -p play-output
BUNDLE=play-output/NASQO-PRO-ERP.aab
cp build/app/outputs/bundle/release/app-release.aab "$BUNDLE"
LC_ALL=C jarsigner -verify "$BUNDLE" > play-output/jar-verification.txt
grep -Fq 'jar verified.' play-output/jar-verification.txt
ACTUAL=$(LC_ALL=C keytool -printcert -jarfile "$BUNDLE" | sed -n 's/^[[:space:]]*SHA256: //p' | tr -d ':' | tr '[:upper:]' '[:lower:]')
EXPECTED=$(printf '%s' "$NASQO_ANDROID_CERT_SHA256" | tr -d ':' | tr '[:upper:]' '[:lower:]')
test -n "$ACTUAL" && test "$ACTUAL" = "$EXPECTED"
# Public certificate only; the private keystore never enters the artifact.
keytool -exportcert -rfc -keystore "$NASQO_ANDROID_KEYSTORE_PATH" \
  -storepass:env NASQO_ANDROID_STORE_PASSWORD -alias "$NASQO_ANDROID_KEY_ALIAS" \
  -file play-output/nasqo-signing-certificate.pem
BUNDLETOOL="$RUNNER_TEMP/bundletool-1.18.3.jar"
curl --fail --location --retry 3 --output "$BUNDLETOOL" \
  https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar
printf '%s  %s\n' a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29 "$BUNDLETOOL" | sha256sum -c -
java -jar "$BUNDLETOOL" validate --bundle="$BUNDLE" > play-output/bundle-validation.txt
java -jar "$BUNDLETOOL" dump manifest --bundle="$BUNDLE" --module=base > play-output/AndroidManifest.xml
java -jar "$BUNDLETOOL" dump config --bundle="$BUNDLE" > play-output/bundle-config.txt
python3 ../scripts/verify-play-bundle.py "$BUNDLE" play-output/AndroidManifest.xml \
  play-output/bundle-config.txt play-output/verification.json "$CODE"
(cd play-output && sha256sum NASQO-PRO-ERP.aab > NASQO-PRO-ERP.aab.sha256)
printf '%s\n' "$GITHUB_SHA" > play-output/source-sha.txt
