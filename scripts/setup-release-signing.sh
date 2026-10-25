#!/usr/bin/env bash
# One-time, local signing setup for vudh1/velatv.
# Usage: bash scripts/setup-release-signing.sh /path/to/quiet-home-dev.jks /path/to/installed-vela.apk
# Never commit or upload the original APK/keystore to repository source control.
set -euo pipefail
REPO="vudh1/velatv"
if [[ $# -ne 2 ]]; then
  echo "Usage: bash scripts/setup-release-signing.sh /path/to/quiet-home-dev.jks /path/to/vela.apk" >&2
  exit 2
fi
KEYFILE="$1"
APKFILE="$2"
[[ -f "$KEYFILE" ]] || { echo "Keystore not found: $KEYFILE" >&2; exit 1; }
[[ -f "$APKFILE" ]] || { echo "APK not found: $APKFILE" >&2; exit 1; }
command -v keytool >/dev/null || { echo "keytool not found; use Android Studio JDK." >&2; exit 1; }
command -v gh >/dev/null || { echo "GitHub CLI not found; install with brew install gh." >&2; exit 1; }
gh auth status >/dev/null || { echo "Log in using gh auth login." >&2; exit 1; }
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
APKSIGNER="$SDK/build-tools/35.0.0/apksigner"
[[ -x "$APKSIGNER" ]] || { echo "Missing $APKSIGNER; install Android Build Tools 35.0.0." >&2; exit 1; }
read -r -p "Keystore alias [quiet-home]: " KEYALIAS
KEYALIAS="${KEYALIAS:-quiet-home}"
read -r -s -p "Keystore password [android]: " VELA_STOREPASS
echo
VELA_STOREPASS="${VELA_STOREPASS:-android}"
read -r -s -p "Key password [same as keystore]: " VELA_KEYPASS
echo
VELA_KEYPASS="${VELA_KEYPASS:-$VELA_STOREPASS}"
export VELA_STOREPASS VELA_KEYPASS
trap 'unset VELA_STOREPASS VELA_KEYPASS' EXIT
# Validate the key before uploading it. keytool reads password via environment,
# not process-command arguments or saved plaintext files.
KEY_DETAILS="$(keytool -list -v -keystore "$KEYFILE" -alias "$KEYALIAS" -storepass:env VELA_STOREPASS)"
KEY_SHA="$(printf '%s\n' "$KEY_DETAILS" | sed -nE 's/^[[:space:]]*SHA256:[[:space:]]*([0-9A-Fa-f:]+).*/\1/p' | head -1 | tr -d ':' | tr '[:upper:]' '[:lower:]')"
APK_SHA="$("$APKSIGNER" verify --print-certs "$APKFILE" | sed -nE 's/^Signer #1 certificate SHA-256 digest: ([0-9A-Fa-f]{64}).*/\1/p' | head -1 | tr '[:upper:]' '[:lower:]')"
[[ "$KEY_SHA" =~ ^[0-9a-f]{64}$ && "$APK_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "Could not read certificate fingerprints. Nothing uploaded." >&2; exit 1; }
if [[ "$KEY_SHA" != "$APK_SHA" ]]; then
  echo "STOP: the keystore and supplied APK have different signing certificates." >&2
  echo "Use the original key and an APK signed with the same key as Vela installed on the TV." >&2
  exit 1
fi
echo "Verified: keystore signing certificate matches the selected APK."
echo "Uploading four encrypted GitHub Actions secrets to $REPO (not source files)."
base64 < "$KEYFILE" | tr -d '\n' | gh secret set VELA_SIGNING_KEY_B64 -R "$REPO"
printf '%s' "$VELA_STOREPASS" | gh secret set VELA_STOREPASS -R "$REPO"
printf '%s' "$VELA_KEYPASS" | gh secret set VELA_KEYPASS -R "$REPO"
printf '%s' "$KEYALIAS" | gh secret set VELA_KEYALIAS -R "$REPO"
echo "Secrets configured. Confirm names (not values) with: gh secret list -R $REPO"
echo "Production was NOT pushed, and no release has been triggered."
