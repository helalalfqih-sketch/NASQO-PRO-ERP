#!/usr/bin/env bash
# Run only in a trusted terminal controlled by the repository owner.
# Never commit the keystore, password file or encrypted backup.
set -euo pipefail
umask 077
REPO="helalalfqih-sketch/NASQO-PRO-ERP"
DIR="$HOME/.nasqo-android-signing"
KEY="$DIR/nasqo-release.jks"
PASS="$DIR/passwords"
ALIAS="nasqo-release"
BACKUP="$HOME/NASQO-signing-backup.tar.gpg"
require() {
  command -v "$1" >/dev/null || { echo "Missing command: $1" >&2; exit 1; }
}
fingerprint() {
  keytool -J-Duser.language=en -J-Duser.country=US -list -v -keystore "$KEY" -storetype JKS \
    -alias "$ALIAS" -storepass:env STORE_PASSWORD |
    awk '/SHA256:/{gsub(":","",$2); print tolower($2)}'
}
load_key() {
  test -f "$KEY" && test -f "$PASS" || { echo "Signing files missing. Restore your backup; never create a replacement for an existing release." >&2; exit 1; }
  { IFS= read -r STORE_PASSWORD; IFS= read -r KEY_PASSWORD; } < "$PASS"
  export STORE_PASSWORD KEY_PASSWORD
  CERT="$(fingerprint)"
  [[ "$CERT" =~ ^[0-9a-f]{64}$ ]] || { echo "Invalid certificate fingerprint." >&2; exit 1; }
}
case "${1:-}" in
  prepare)
    require keytool; require openssl; require gh
    gh auth status >/dev/null 2>&1 || { echo "Sign in first with gh auth login." >&2; exit 1; }
    [[ "$(gh repo view "$REPO" --json viewerPermission --jq .viewerPermission)" == ADMIN ]] ||
      { echo "Repository administrator required." >&2; exit 1; }
    # Never generate a second identity if a signing configuration already exists.
    existing="$(gh secret list --repo "$REPO")"
    variables="$(gh variable list --repo "$REPO")"
    releases="$(gh api --paginate "repos/$REPO/releases" --jq '.[].tag_name')"
    if grep -q 'NASQO_ANDROID_\(KEYSTORE_BASE64\|STORE_PASSWORD\|KEY_ALIAS\|KEY_PASSWORD\)' <<< "$existing" ||
       grep -q 'NASQO_ANDROID_CERT_SHA256' <<< "$variables" ||
       grep -q '^android-preview-v' <<< "$releases"; then
      echo "Signing configuration or releases already exist. Reuse the original key; refusing to generate another." >&2
      exit 1
    fi
    mkdir "$DIR" || { echo "Signing directory already exists. Do not overwrite it." >&2; exit 1; }
    export STORE_PASSWORD="$(openssl rand -hex 32)"
    export KEY_PASSWORD="$(openssl rand -hex 32)"
    printf '%s\n%s\n' "$STORE_PASSWORD" "$KEY_PASSWORD" > "$PASS"
    keytool -genkeypair -storetype JKS -keystore "$KEY" -alias "$ALIAS" \
      -keyalg RSA -keysize 3072 -validity 10000 \
      -dname "CN=NASQO PRO ERP Android Release" \
      -storepass:env STORE_PASSWORD -keypass:env KEY_PASSWORD
    load_key
    echo "Key created in $DIR"
    echo "Certificate SHA256: $CERT"
    echo "Next: run this script with backup."
    ;;
  backup)
    require gpg; require keytool; require tar
    load_key
    test ! -e "$BACKUP" || { echo "Backup already exists; refusing to overwrite." >&2; exit 1; }
    export GPG_TTY="$(tty)"
    tar -C "$DIR" -cf - nasqo-release.jks passwords |
      gpg --symmetric --cipher-algo AES256 --output "$BACKUP"
    echo "Encrypted backup: $BACKUP"
    echo "Store it independently with its encryption passphrase before configuring GitHub."
    ;;
  configure)
    require gh; require keytool; require base64; require gpg
    load_key
    test -s "$BACKUP" || { echo "Create and securely retain an encrypted backup first." >&2; exit 1; }
    gh auth status >/dev/null 2>&1
    [[ "$(gh repo view "$REPO" --json viewerPermission --jq .viewerPermission)" == ADMIN ]]
    read -r -p "Have you securely saved the encrypted backup and passphrase independently? Type YES: " confirmation
    [[ "$confirmation" == YES ]] || exit 1
    variables="$(gh variable list --repo "$REPO")"
    existing="$(gh secret list --repo "$REPO")"
    if grep -q 'NASQO_ANDROID_CERT_SHA256' <<< "$variables"; then
      configured="$(gh variable get NASQO_ANDROID_CERT_SHA256 --repo "$REPO" | tr -d ':' | tr '[:upper:]' '[:lower:]')"
      [[ "$configured" == "$CERT" ]] || { echo "Certificate mismatch. Refusing to replace existing signing identity." >&2; exit 1; }
    else
      if grep -q 'NASQO_ANDROID_\(KEYSTORE_BASE64\|STORE_PASSWORD\|KEY_ALIAS\|KEY_PASSWORD\)' <<< "$existing"; then
        echo "Existing signing secrets without a fingerprint; review them manually." >&2; exit 1
      fi
      releases="$(gh api --paginate "repos/$REPO/releases" --jq '.[].tag_name')"
      if grep -q '^android-preview-v' <<< "$releases"; then
        echo "Existing signed preview releases; recover the original key first." >&2; exit 1
      fi
      gh variable set NASQO_ANDROID_CERT_SHA256 --repo "$REPO" --body "$CERT"
    fi
    # Secret values pass through stdin and are never echoed.
    base64 -w0 "$KEY" | gh secret set NASQO_ANDROID_KEYSTORE_BASE64 --repo "$REPO"
    printf '%s' "$STORE_PASSWORD" | gh secret set NASQO_ANDROID_STORE_PASSWORD --repo "$REPO"
    printf '%s' "$KEY_PASSWORD" | gh secret set NASQO_ANDROID_KEY_PASSWORD --repo "$REPO"
    printf '%s' "$ALIAS" | gh secret set NASQO_ANDROID_KEY_ALIAS --repo "$REPO"
    gh variable set NASQO_ANDROID_PREVIEW_PUBLISH --repo "$REPO" --body true
    echo "Signing secrets configured; automated preview publishing enabled for subsequent successful branch builds."
    ;;
  *)
    echo "Usage: bash setup-android-release-key.sh {prepare|backup|configure}" >&2
    exit 2
    ;;
esac
