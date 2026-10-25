#!/usr/bin/env bash
# Manual Sony updater recovery. Never uninstalls Vela or bypasses Android signing.
set -euo pipefail

if ! command -v adb >/dev/null 2>&1; then
  printf 'Android platform-tools (adb) are required. Install them on your Mac, then retry.\n' >&2
  exit 1
fi
if ! command -v shasum >/dev/null 2>&1; then
  printf 'shasum is required to verify the signed GitHub release download.\n' >&2
  exit 1
fi

requested_serial="${1:-}"
if [[ -n "$requested_serial" ]]; then
  if ! adb -s "$requested_serial" get-state 2>/dev/null | grep -qx device; then
    printf 'TV %s is not ready in adb. Check pairing/debugging and run adb devices.\n' "$requested_serial" >&2
    exit 1
  fi
  target_serial="$requested_serial"
else
  targets=()
  while IFS= read -r serial; do
    [[ -n "$serial" ]] && targets+=("$serial")
  done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  if [[ "${#targets[@]}" -ne 1 ]]; then
    printf 'Connect exactly one authorized Sony TV with adb, or pass its serial as the first argument.\n' >&2
    printf 'For network debugging use: adb connect TV_IP:5555\n' >&2
    printf 'Current adb devices:\n' >&2
    adb devices >&2
    exit 1
  fi
  target_serial="${targets[0]}"
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/vela-apk.XXXXXX")"
cd "$work_dir"
release_root='https://github.com/vudh1/velatv/releases/latest/download'
printf 'Downloading current signed Vela release into %s\n' "$work_dir"
curl --fail --location --retry 3 --silent --show-error \
  --output Vela-release.apk "$release_root/Vela-release.apk"
curl --fail --location --retry 3 --silent --show-error \
  --output Vela-release.apk.sha256 "$release_root/Vela-release.apk.sha256"

# Reject a malformed checksum file; only check the APK we just downloaded.
if [[ "$(wc -l < Vela-release.apk.sha256 | tr -d ' ')" -ne 1 ]] || \
   ! grep -Eq '^[0-9a-fA-F]{64}  \*?Vela-release\.apk$' Vela-release.apk.sha256; then
  printf 'The release checksum file is missing or malformed. Nothing installed.\n' >&2
  exit 1
fi
shasum -a 256 -c Vela-release.apk.sha256

printf 'Installing over existing Vela on %s (no uninstall, no data wipe)…\n' "$target_serial"
adb -s "$target_serial" install -r Vela-release.apk
printf 'Android reported success. If the TV was running Vela, reopen it to load the update.\n'
