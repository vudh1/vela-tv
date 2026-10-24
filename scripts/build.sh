#!/usr/bin/env bash
# Reproducible minimal Android TV APK build, including the existing signing identity.
set -euo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
BT="$SDK/build-tools/35.0.0"
ANDROID_JAR="$SDK/platforms/android-35/android.jar"
OUT="$BASE/build/manual"
VERSION_CODE="${VELA_VERSION_CODE:-15}"
VERSION_NAME="${VELA_VERSION_NAME:-2.5}"
KEYFILE="${VELA_KEYSTORE:-$BASE/signing/quiet-home-dev.jks}"
STOREPASS="${VELA_STOREPASS:-android}"
KEYPASS="${VELA_KEYPASS:-$STOREPASS}"
KEYALIAS="${VELA_KEYALIAS:-quiet-home}"
command -v javac >/dev/null || { echo 'JDK 17 is required; configure JAVA_HOME for Android Studio.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'Python 3 is required.' >&2; exit 1; }
[[ -f "$ANDROID_JAR" && -x "$BT/aapt2" && -x "$BT/d8" ]] || { echo 'Install Android SDK Platform 35 and Build Tools 35.0.0.' >&2; exit 1; }
if [[ ! -f "$KEYFILE" && "$KEYFILE" == "$BASE/signing/quiet-home-dev.jks" ]]; then
  for PREV in \
    "$HOME/Desktop/Vela-2.3-Volume-Overlay/signing/quiet-home-dev.jks" \
    "$HOME/Desktop/Vela-2.2-Baby-Monitor/signing/quiet-home-dev.jks" \
    "$HOME/Desktop/Vela-2.1-Profiles-Phone-Calendar/signing/quiet-home-dev.jks" \
    "$HOME/Desktop/Vela-2.0-Icons-Avatars-Calendar/signing/quiet-home-dev.jks" \
    "$HOME/Desktop/Vela-1.9-Profiles-Wallpaper-Gallery/signing/quiet-home-dev.jks" \
    "$HOME/Desktop/Vela-1.8-Responsive-Launcher/signing/quiet-home-dev.jks" \
    "$HOME/Desktop/Vela-1.6-Source/signing/quiet-home-dev.jks"; do
    if [[ -f "$PREV" ]]; then
      mkdir -p "$BASE/signing"
      cp "$PREV" "$KEYFILE"
      chmod 600 "$KEYFILE"
      echo 'Reusing an existing Vela signing certificate (never include it in GitHub source).'
      break
    fi
  done
fi
[[ -f "$KEYFILE" ]] || { echo "Signing keystore missing at $KEYFILE. Copy the one from Vela-1.6-Source/signing/ to preserve the upgrade identity." >&2; exit 1; }
mkdir -p "$OUT/classes" "$OUT/dex"
python3 - "$BASE" "$OUT" "$VERSION_CODE" "$VERSION_NAME" <<'PY'
import sys, xml.etree.ElementTree as ET
from pathlib import Path
base,out=map(Path,sys.argv[1:3]); code,name=sys.argv[3:]
p=ET.parse(base/'app/src/main/AndroidManifest.xml');r=p.getroot();a='{http://schemas.android.com/apk/res/android}'
r.set('package','com.danielvu.quiethome');r.set(a+'versionCode',code);r.set(a+'versionName',name)
ET.SubElement(r,'uses-sdk',{a+'minSdkVersion':'26',a+'targetSdkVersion':'32'})
p.write(out/'AndroidManifest.xml')
PY
"$BT/aapt2" compile --dir "$BASE/app/src/main/res" -o "$OUT/resources.zip"
"$BT/aapt2" link -I "$ANDROID_JAR" -A "$BASE/app/src/main/assets" --manifest "$OUT/AndroidManifest.xml" -o "$OUT/unsigned.apk" "$OUT/resources.zip"
find "$OUT/classes" -type f -name '*.class' -delete
javac -source 8 -target 8 -classpath "$ANDROID_JAR" -d "$OUT/classes" "$BASE/app/src/main/java/com/danielvu/quiethome/"*.java
"$BT/d8" --lib "$ANDROID_JAR" --min-api 26 --output "$OUT/dex" $(find "$OUT/classes" -name '*.class' -print)
python3 - "$OUT" <<'PY'
import sys,zipfile
from pathlib import Path
out=Path(sys.argv[1]);
with zipfile.ZipFile(out/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:z.write(out/'dex/classes.dex','classes.dex')
PY
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
VELA_STOREPASS="$STOREPASS" VELA_KEYPASS="$KEYPASS" "$BT/apksigner" sign \
  --ks "$KEYFILE" --ks-key-alias "$KEYALIAS" --ks-pass env:VELA_STOREPASS \
  --key-pass env:VELA_KEYPASS --out "$BASE/Vela-2.5.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --verbose "$BASE/Vela-2.5.apk"
echo "Built Vela-2.5.apk ($VERSION_NAME, code $VERSION_CODE)"
