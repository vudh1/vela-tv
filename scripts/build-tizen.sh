#!/usr/bin/env bash
# Stage the shared Vela interface for Samsung Tizen; optionally sign a WGT.
# Usage: bash scripts/build-tizen.sh stage
#        VELA_TIZEN_PROFILE=mySamsungCert bash scripts/build-tizen.sh package
set -euo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$BASE/build/tizen"
MODE="${1:-stage}"
if [[ "$MODE" != stage && "$MODE" != package ]]; then
  echo 'Usage: build-tizen.sh [stage|package]' >&2
  exit 2
fi
mkdir -p "$TARGET"
cp -R "$BASE/app/src/main/assets/." "$TARGET/"
cp "$BASE/samsung/config.xml" "$TARGET/config.xml"
cp "$BASE/app/src/main/res/drawable/icon.png" "$TARGET/icon.png"
echo "Samsung Tizen sources staged in $TARGET"
if [[ "$MODE" == stage ]]; then exit 0; fi
command -v tizen >/dev/null || { echo 'Install Tizen Studio + Samsung TV extensions first.' >&2; exit 1; }
[[ -n "${VELA_TIZEN_PROFILE:-}" ]] || {
  echo 'Set VELA_TIZEN_PROFILE to a Samsung TV certificate profile with this TV DUID.' >&2
  exit 1
}
tizen build-web -- "$TARGET"
tizen package -t wgt -s "$VELA_TIZEN_PROFILE" -- "$TARGET/.buildResult"
echo "Signed WGT is in $TARGET/.buildResult. Install using Tizen Studio/CLI."
