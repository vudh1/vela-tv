#!/usr/bin/env bash
# Explicit multi-device build/install entrypoint. Never guesses TV platform.
set -euo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="${1:-}"
ACTION="${2:-}"
if [[ "$PLATFORM" == sony || "$PLATFORM" == android ]]; then
  case "$ACTION" in
    build) exec bash "$BASE/scripts/build.sh" ;;
    install|inspect|diagnose|home|verify|restore|remove)
      exec bash "$BASE/scripts/tv.sh" "$ACTION" "${3:-}" ;;
  esac
elif [[ "$PLATFORM" == samsung || "$PLATFORM" == tizen ]]; then
  case "$ACTION" in
    stage) exec bash "$BASE/scripts/build-tizen.sh" stage ;;
    build) exec bash "$BASE/scripts/build-tizen.sh" package ;;
    install)
      SERIAL="${3:-}"
      PACKAGE="${4:-}"
      [[ -n "$SERIAL" && "$PACKAGE" == *.wgt && -f "$PACKAGE" ]] || {
        echo 'Usage: bash scripts/device.sh samsung install TV_SERIAL /path/to/signed.wgt' >&2; exit 2;
      }
      command -v tizen >/dev/null || { echo 'Install Tizen Studio CLI first.' >&2; exit 1; }
      exec tizen install -s "$SERIAL" -n "$(basename "$PACKAGE")" -- "$(dirname "$PACKAGE")"
      ;;
  esac
fi
echo 'Usage: bash scripts/device.sh PLATFORM ACTION [TV_ADDRESS / SIGNED_WGT]' >&2
echo 'Sony:    build | inspect TV_IP | install TV_IP | home TV_IP | verify TV_IP | restore TV_IP' >&2
echo 'Samsung: stage | build (requires VELA_TIZEN_PROFILE) | install TV_SERIAL /path/to/file.wgt' >&2
exit 2
