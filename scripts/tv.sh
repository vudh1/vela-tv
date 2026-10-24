#!/usr/bin/env bash
# Vela reversible installer and default-launcher diagnostic for Android TV.
# Deliberately NEVER disables, uninstalls or clears any Sony/Google system package.
set -euo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
ACTION="${1:-help}"
case "$ACTION" in
  help|-h|--help)
    cat <<'EOF'
Usage: bash scripts/tv.sh <action> TV_IP[:PORT]
Actions:
  inspect   Read Android version, storage, installed HOME candidates, current HOME
  diagnose  Read-only investigation of the Vela package, users and activities
  install   Install built Vela 2.5 for Android user 0
  home      Try Android HOME role + preferred HOME; keep Sony launcher enabled
  verify    Simulate remote Home and report HOME role, resolver, foreground app
  restore   Set the original Sony/Google HOME (from the saved backup)
  remove    Uninstall Vela only when no longer resolving as system HOME

Typical sequence: inspect -> install -> home -> verify -> test real remote/reboot.
Recovery: restore (or choose Sony Home in the app's Home settings).
EOF
    exit 0 ;;
  install|inspect|diagnose|home|verify|restore|remove) ;;
  *) echo "Unknown action: $ACTION" >&2; exit 2 ;;
esac
ENDPOINT="${2:-}"
if [[ ! "$ENDPOINT" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(:[0-9]{1,5})?$ ]]; then
  echo 'Supply the TV IPv4 address (e.g. 192.168.88.24)' >&2; exit 2
fi
IP="${ENDPOINT%%:*}"
IFS=. read -r A B C D <<< "$IP"
for O in "$A" "$B" "$C" "$D"; do
  if (( 10#$O > 255 )); then echo 'Invalid IPv4 octet' >&2; exit 2; fi
done
[[ "$ENDPOINT" == *:* ]] || ENDPOINT="$ENDPOINT:5555"
PORT="${ENDPOINT##*:}"
if (( 10#$PORT < 1 || 10#$PORT > 65535 )); then echo 'Invalid port' >&2; exit 2; fi
if command -v adb >/dev/null 2>&1; then
  ADB="$(command -v adb)"
elif [[ -x "$HOME/Library/Android/sdk/platform-tools/adb" ]]; then
  ADB="$HOME/Library/Android/sdk/platform-tools/adb"
else
  if [[ "$(uname -s)" != Darwin ]]; then
    echo 'Android platform-tools (adb) required.' >&2; exit 1
  fi
  mkdir -p "$BASE/.tools"
  if [[ ! -x "$BASE/.tools/platform-tools/adb" ]]; then
    echo 'Downloading official Android platform-tools from Google ...'
    curl -fL --retry 2 --connect-timeout 20 --max-time 300 \
       'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip' \
       -o "$BASE/.tools/platform-tools.zip"
    unzip -q -o "$BASE/.tools/platform-tools.zip" -d "$BASE/.tools"
  fi
  ADB="$BASE/.tools/platform-tools/adb"
fi
"$ADB" connect "$ENDPOINT"
if [[ "$("$ADB" -s "$ENDPOINT" get-state 2>/dev/null || true)" != device ]]; then
  echo 'ADB not connected. Authorize debugging on the TV then retry.' >&2; exit 1
fi
STATE="$BASE/.state/${IP}_${PORT}"
mkdir -p "$STATE"
APP='com.danielvu.quiethome'
OUR_HOME="$APP/.MainActivity"
adbtv() { "$ADB" -s "$ENDPOINT" "$@"; }
role_holders() {
  # Some OEM builds print 'Unknown command' with shell exit status 0.
  local result
  result="$(adbtv shell cmd role get-role-holders --user 0 android.app.role.HOME 2>/dev/null | tr -d '\r')" || return 1
  if [[ -z "$result" || "$result" == *'Unknown command'* ]]; then
    echo '(query not supported by Sony firmware)'
    return 0
  fi
  printf '%s\n' "$result"
}
home_resolved() {
  adbtv shell cmd package resolve-activity --brief \
     -a android.intent.action.MAIN -c android.intent.category.HOME 2>/dev/null \
     | tr -d '\r' | tail -n 1
}
valid_component() { [[ "$1" =~ ^[[:alnum:]_.]+/[[:alnum:]_.$]+$ ]]; }
installed() { adbtv shell pm list packages --user 0 | tr -d '\r' | grep -Fxq "package:$1"; }
show_app_diagnostics() {
  echo '--- Current Android user ---'
  adbtv shell am get-current-user || true
  echo '--- Android users ---'
  adbtv shell pm list users || true
  echo '--- Package matching Vela (user 0; includes uninstalled) ---'
  adbtv shell pm list packages -u -f --user 0 | tr -d '\r' | grep -i -E 'quiethome|danielvu' || echo '(none)'
  echo '--- Package matching Vela (all users; includes uninstalled) ---'
  adbtv shell pm list packages -u -f | tr -d '\r' | grep -i -E 'quiethome|danielvu' || echo '(none)'
  echo '--- Installed APK path for user 0 ---'
  adbtv shell pm path --user 0 "$APP" || true
  echo '--- Installed APK path (default user) ---'
  adbtv shell pm path "$APP" || true
  echo '--- Package manager details ---'
  adbtv shell dumpsys package "$APP" | tr -d '\r' \
    | grep -E -i 'Package \[|Package \{|codePath=|User [0-9]+:|installed=|enabled=|MainActivity|quiethome|unknown package|not found' \
    | head -n 35 || true
  echo '--- Vela launchable activities ---'
  adbtv shell cmd package query-activities --brief \
    -a android.intent.action.MAIN -c android.intent.category.HOME \
    | tr -d '\r' | grep -i -E 'quiethome|activities found|Activity #|\.MainActivity' || true
}

stock_package() {
  local pkg
  for pkg in com.google.android.apps.tv.launcherx com.google.android.tvlauncher com.google.android.leanbacklauncher; do
    if installed "$pkg"; then printf '%s\n' "$pkg"; return 0; fi
  done
  return 1
}
save_stock() {
  if [[ -f "$STATE/original-home.txt" ]]; then return 0; fi
  local original
  original="$(home_resolved)"
  if valid_component "$original" && [[ "$original" != "$APP/"* ]] && [[ "$original" != *ResolverActivity* ]]; then
    printf '%s\n' "$original" > "$STATE/original-home.txt"
    echo "Saved original HOME: $original"
  else
    local pkg
    if pkg="$(stock_package)"; then
      printf '%s\n' "$pkg" > "$STATE/original-home.txt"
      echo "Saved stock launcher package: $pkg"
    else
      echo 'Could not automatically back up stock Home. Run inspect before proceeding.' >&2
      return 1
    fi
  fi
}
case "$ACTION" in
  diagnose)
    show_app_diagnostics
    ;;
  inspect)
    echo '--- Device ---'
    adbtv shell getprop ro.product.model
    echo -n 'Android: '; adbtv shell getprop ro.build.version.release
    echo '--- Internal storage ---'
    adbtv shell df -h /data || true
    echo '--- HOME role holders (Android 10+) ---'
    role_holders || echo 'HOME role query unavailable on this firmware'
    echo '--- HOME candidates ---'
    adbtv shell cmd package query-activities --brief \
       -a android.intent.action.MAIN -c android.intent.category.HOME || true
    echo '--- Known stock packages ---'
    adbtv shell pm list packages | tr -d '\r' | grep -E 'launcherx|tvlauncher|leanbacklauncher|quiethome' || true
    echo '--- Disabled launcher packages ---'
    adbtv shell pm list packages -d | tr -d '\r' | grep -E 'launcherx|tvlauncher|leanbacklauncher' || true
    echo '--- Current HOME resolver ---'
    home_resolved
    echo '--- HOME preference details ---'
    adbtv shell dumpsys package preferred-activities | tr -d '\r' | grep -E -i -A 7 'quiethome|launcherx' | head -n 60 || true
    ;;
  install)
    # Never silently install the old 1.1 APK when a new source build fails.
    if [[ ! -f "$BASE/Vela-2.5.apk" ]]; then
      echo 'Vela 2.5 APK not built. Run bash scripts/build.sh after SDK setup.' >&2
      echo 'The legacy 1.1 APK is intentionally not an automatic fallback.' >&2
      exit 1
    fi
    APK="$BASE/Vela-2.5.apk"
    echo "Installing: $(basename "$APK")"
    echo 'Available internal TV storage:'; adbtv shell df -h /data || true
    save_stock || { echo 'Aborting installation: cannot establish a recovery path.' >&2; exit 1; }
    if ! adbtv install --no-incremental --user 0 -r "$APK"; then
      echo 'Install failed. If INSTALL_FAILED_INSUFFICIENT_STORAGE, free TV INTERNAL storage through Sony Settings and retry; do not delete user data automatically.' >&2
      exit 1
    fi
    # ADB's install success covers the package-install command only. Verify that
    # Android's active primary user can actually see and launch the package.
    if ! installed "$APP"; then
      echo 'ERROR: ADB install reported Success, but Vela is NOT listed as installed for Android user 0.' >&2
      echo 'This is a package-registration/user issue, NOT proof of a wrong activity name.' >&2
      show_app_diagnostics
      exit 1
    fi
    echo 'Package is visible for Android user 0.'
    echo 'Installed APK path:'
    adbtv shell pm path --user 0 "$APP" || true
    echo "Launching $OUR_HOME ..."
    if output="$(adbtv shell am start --user 0 -n "$OUR_HOME" 2>&1)"; then
      echo "$output"
      if printf '%s' "$output" | grep -Eq 'Error type|Error: Activity class|SecurityException|Exception occurred'; then
        echo 'ERROR: Launch failed even though adb shell returned success. Inspect the activity-registration diagnostics.' >&2
        show_app_diagnostics
        exit 1
      fi
      echo 'Install and launch command succeeded; visually confirm Vela opened before setting it as default.'
    else
      echo "$output" >&2
      echo 'ERROR: Vela was installed, but launching MainActivity failed.' >&2
      show_app_diagnostics
      exit 1
    fi
    ;;
  home)
    if ! installed "$APP"; then echo 'Install Vela first.' >&2; exit 1; fi
    save_stock || exit 1
    echo "Requesting HOME -> $OUR_HOME (Sony Home will remain enabled)"
    echo '--- Prior HOME role holders ---'
    role_holders || echo '(HOME role API unavailable)'
    echo '--- Assign Android HOME role ---'
    # On Android 12, the HOME role and preferred activity can differ. Use both,
    # and verify the result instead of trusting a zero exit status alone.
    if output="$(adbtv shell cmd role add-role-holder --user 0 android.app.role.HOME "$APP" 2>&1)"; then
      echo 'HOME role assignment returned success.'
    else
      echo "HOME role assignment was rejected or unavailable: $output" >&2
    fi
    echo '--- Assign preferred HOME activity ---'
    if output="$(adbtv shell cmd package set-home-activity --user 0 "$OUR_HOME" 2>&1)"; then
      echo "${output:-HOME preferred-activity assignment returned success.}"
    else
      echo "Preferred HOME assignment failed: $output" >&2
    fi
    echo '--- Result ---'
    actual="$(home_resolved)"
    echo "Resolved HOME: $actual"
    roles="$(role_holders || true)"
    echo "HOME role holders: ${roles:-(unavailable)}"
    if [[ "$actual" != "$APP/"* ]]; then
      echo 'WARNING: Sony/Google TV still resolves Home to a different launcher.' >&2
      echo 'The role may be unrecognized or superseded by OEM preferred activity priority.' >&2
      echo 'No system launcher was disabled. Run inspect and keep a recovery route.' >&2
      exit 1
    fi
    echo 'HOME resolver now points at Vela. Test verify, physical remote, and wake/reboot.'
    ;;
  verify)
    echo 'Sending Android KEYCODE_HOME via ADB ...'
    adbtv shell input keyevent 3
    sleep 2
    echo '--- HOME role holders ---'; role_holders || echo '(HOME role API unavailable)'
    echo '--- Current HOME resolver ---'; home_resolved
    echo '--- Foreground activity clues ---'
    adbtv shell dumpsys activity activities | tr -d '\r' \
       | grep -E 'mResumedActivity|topResumedActivity|ResumedActivity' | head -n 6 || true
    echo 'Physical Sony remote Home and warm/cold power-on still require on-device testing.'
    ;;
  restore)
    if [[ ! -s "$STATE/original-home.txt" ]]; then
      echo 'Original launcher backup missing; no changes made. Run inspect and identify the original HOME first.' >&2
      exit 1
    fi
    ORIGINAL="$(cat "$STATE/original-home.txt")"
    if valid_component "$ORIGINAL"; then
      STOCK_PKG="${ORIGINAL%%/*}"
    elif [[ "$ORIGINAL" =~ ^[[:alnum:]_.]+$ ]]; then
      STOCK_PKG="$ORIGINAL"
    else
      echo 'Invalid saved HOME identity, no changes made.' >&2; exit 1
    fi
    if ! installed "$STOCK_PKG"; then
      echo "Saved stock package $STOCK_PKG is missing. Do not uninstall Vela." >&2
      exit 1
    fi
    if adbtv shell pm list packages -d | tr -d '\r' | grep -Fxq "package:$STOCK_PKG"; then
      echo "Saved stock package $STOCK_PKG is disabled. Do not uninstall Vela. Re-enable it from ADB first." >&2
      exit 1
    fi
    echo "Restoring default HOME: $ORIGINAL"
    if output="$(adbtv shell cmd role add-role-holder --user 0 android.app.role.HOME "$STOCK_PKG" 2>&1)"; then
      echo 'Restored Android HOME role to Sony/Google TV.'
    else
      echo "Could not update HOME role (will attempt preferred activity): $output" >&2
    fi
    adbtv shell cmd package set-home-activity --user 0 "$ORIGINAL"
    if valid_component "$ORIGINAL"; then
      adbtv shell am start -n "$ORIGINAL" || true
    else
      adbtv shell am start -a android.intent.action.MAIN -c android.intent.category.HOME -p "$STOCK_PKG" || true
    fi
    echo 'Current resolver:'; home_resolved
    echo 'Current HOME role holders:'; role_holders || true
    echo 'Press the physical remote Home button to verify Sony Home.'
    ;;
  remove)
    if [[ "$(home_resolved)" == "$APP/"* ]]; then
      echo 'Vela appears to be active HOME. Run restore and verify before uninstalling.' >&2; exit 1
    fi
    if ! [[ -f "$STATE/original-home.txt" ]]; then
      echo 'No saved original launcher. Refusing uninstall until a recovery path is established.' >&2; exit 1
    fi
    adbtv uninstall "$APP"
    ;;
esac
