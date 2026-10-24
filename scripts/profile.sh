#!/usr/bin/env bash
# Non-destructive on-device profiling; run only after Vela is installed/open.
set -euo pipefail
ENDPOINT="${1:-192.168.88.24}"
[[ "$ENDPOINT" == *:* ]] || ENDPOINT="$ENDPOINT:5555"
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
command -v adb >/dev/null 2>&1 && ADB="$(command -v adb)"
if [[ ! -x "$ADB" ]]; then echo 'Android platform-tools adb is required.' >&2; exit 1; fi
"$ADB" connect "$ENDPOINT"
DEVICE=("$ADB" -s "$ENDPOINT")
APP='com.danielvu.quiethome'
echo '--- Window/activity ---'
"${DEVICE[@]}" shell dumpsys activity activities | grep -E 'mResumedActivity|ResumedActivity' | head -n 4 || true
echo '--- Vela renderer frame stats (before synthetic navigation) ---'
"${DEVICE[@]}" shell dumpsys gfxinfo "$APP" | head -n 60 || true
echo '--- Sending 40 repeated DPAD_RIGHT and DPAD_LEFT events (may move UI focus) ---'
"${DEVICE[@]}" shell dumpsys gfxinfo "$APP" reset >/dev/null || true
for i in $(seq 1 20); do
 "${DEVICE[@]}" shell input keyevent 22 >/dev/null
 "${DEVICE[@]}" shell input keyevent 21 >/dev/null
done
echo '--- Vela renderer frame stats after synthetic navigation ---'
"${DEVICE[@]}" shell dumpsys gfxinfo "$APP" | head -n 90 || true
cat <<'NOTE'
These are device-dependent frame stats, not a validated speedup claim.
For a baseline, run the same test on Vela 1.5 and compare its frame/jank percentiles.
WebView GPU/compositor work may not be fully accounted for by gfxinfo; use Perfetto for deep analysis.
NOTE
