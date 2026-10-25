#!/usr/bin/env python3
"""Static constraints; TV frame rate and Android APK need physical testing."""
import subprocess
from pathlib import Path
from xml.etree import ElementTree as ET
r=Path(__file__).resolve().parents[1]
asset=r/'app/src/main/assets'
for f in ['app.js','style.css','index.html','landscape.svg','landscape-1.svg','landscape-2.svg','landscape-3.svg']:
    assert (asset/f).read_bytes()==(r/'preview'/f).read_bytes(),f
js=(asset/'app.js').read_text();css=(asset/'style.css').read_text()
assert 'favoritesEditor()' in js and "data-act=\\\"swap\\\"" not in js # controls generated dynamically
assert 'data-act="swap"' in js and "if(name==='swap')" in js
assert "if(name==='move')" not in js and "renderPanel('move')" not in js
assert '.overlay{position:fixed' in css and 'pointer-events:none' in css
assert 'width:min(470px,36vw)' in css
assert 'backdrop-filter:' not in css
assert 'function pause()' in js and 'profileNameReady' in js and 'profileDeleteConfirmed' in js and 'profile_data_v2' in js
assert 'gallery-grid' in css and 'profile-button' in css
assert (asset/'wallpapers/mist-lake.webp').exists() and (asset/'wallpapers/lavender-bay.webp').exists()
assert 'getCachedApps' in js and 'catalogRefreshed' in js
assert 'geometry=controls.map' in js
assert 'avatarSvg' in js and 'avatarPicker' in js
assert 'calendarPeek' in (asset/'index.html').read_text()
assert 'receiveCalendar' in js and 'calendarState' in js
assert 'app-monogram' not in js and 'vela-icons.local/icon/' in js
main=(r/'app/src/main/java/com/danielvu/quiethome/MainActivity.java').read_text()
assert 'getCachedApps()' in main and 'getCachedCatalogAt()' in main
assert 'profile_data_v2' in main and 'active_profile_v2' in main
assert 'cached_catalog' in main and 'getCacheDir(), "app-icons"' in main
assert 'Bitmap.CompressFormat.PNG' in main
assert 'shouldInterceptRequest' in main
assert 'VelaCalendarController' in main
assert 'now - lastKeyDown >= 24' in main
assert 'cmd package set-home-activity' not in main
m=ET.parse(r/'app/src/main/AndroidManifest.xml').getroot();a='{http://schemas.android.com/apk/res/android}'
app=m.find('application')
assert any(s.get(a+'name')=='.VelaApkProvider' for s in app.findall('provider'))
assert any(s.get(a+'name')=='.HomeRedirectService' for s in app.findall('service'))
assert any(s.get(a+'name')=='.VelaDreamService' for s in app.findall('service'))
for script in ['build.sh','tv.sh','profile.sh']:
    subprocess.run(['bash','-n',str(r/'scripts'/script)],check=True)
subprocess.run(['node','--check',str(asset/'app.js')],check=True)
assert 'Vela-2.5.apk' in (r/'scripts/build.sh').read_text()
assert 'Vela-2.5.apk' in (r/'scripts/tv.sh').read_text()
print('PASS static UI, native bridge, screensaver, updater, no-destructive-install and scripts')

# 2.2: profile-specific monitor toggle, gated Nanit quick-link, no background streaming.
assert 'monitorEnabled:p.monitorEnabled===true' in js
assert 'monitorEnabled=monitorEnabled' in js
assert "if(name==='monitorToggle')" in js
assert 'id="monitorButton"' in (asset/'index.html').read_text()
assert 'openNanitWeb()' in main and 'https://my.nanit.com' in main
assert 'TYPE_APPLICATION_OVERLAY' not in main
assert 'SYSTEM_ALERT_WINDOW' not in ET.tostring(m,encoding='unicode')
print('PASS monitor shortcut with zero background streams and profile isolation')

# Vela 2.3: volume is a non-blocking foreground-only feature.
assert 'id="volumeHud"' in (asset/'index.html').read_text()
assert 'function volumeChanged(payload,previewOnly)' in js and 'volumeSettings' in js and 'volumeDemo' in js
assert 'setCustomVolumeEnabled' in main and 'adjustVelaVolume' in main
assert 'AudioManager.STREAM_MUSIC' in main and 'a.isVolumeFixed()' in main
assert 'QH.volumeChanged' in main and 'sendToJs(' in main
assert 'FLAG_SHOW_UI' not in main.split('private boolean adjustVelaVolume')[1].split('@Override public boolean dispatchKeyEvent')[0].replace('// No FLAG_SHOW_UI','')
assert 'volume-hud' in css and 'backdrop-filter:' not in css
assert 'Vela-2.5.apk' in (r/'scripts/build.sh').read_text()
assert 'Vela-2.5.apk' in (r/'scripts/tv.sh').read_text()
print('PASS foreground-only volume UI, native audio fallback, Vela 2.4 build scripts')

# Vela 2.4: quick actions, profile-local recents, native clock formatting.
assert "function openAppMenu(id)" in js and "if(key==='longselect')" in js
assert "function recentApps()" in js and "if(name==='togglePin')" in js
assert "if(name==='clockFormat')" in js and 'function system24Hour()' in js
assert 'DateFormat.is24HourFormat' in main and "QH.remote('longselect')" in main
assert 'Settings.ACTION_APPLICATION_DETAILS_SETTINGS' in main
assert 'p.recent' in js and "if(profileId!=='guest')persistProfiles();" in js
assert 'Vela-2.5.apk' in (r/'scripts/build.sh').read_text()
assert 'Vela-2.5.apk' in (r/'scripts/tv.sh').read_text()
print('PASS Vela 2.4 TV clock, long-OK menu, per-profile app history')

# QR pairing regressions: normal calendar refreshes must never cancel phone pairing.
pair_server=(r/'app/src/main/java/com/danielvu/quiethome/VelaPairingServer.java').read_text()
assert 'onPhoneCalendarSubmitted(profile)' in pair_server
assert '10*60*1000L' in pair_server and 'synchronized long expiresAt()' in pair_server
assert 'pairingCompleted:pairingCompleted' in js
assert "if(screen==='pairing'&&calConnected)" not in js
assert "if(type==='pairing')pairingTick()" in js
assert 'host.contains(el)' in js
assert '.overlay.pairing-panel .panel' in css and 'max-height:32vh' in css
assert 'QH.pairingReady(' in main and 'pairing.expiresAt()' in main
assert 'renewPair' in js and 'pair-countdown' in css
print('PASS QR pairing lifecycle, expiry countdown, renewal, and unclipped panel')

# Volume and scenic DreamService checks: no polling, no display blackout, TV fallback retained.
dream=(r/'app/src/main/java/com/danielvu/quiethome/VelaDreamService.java').read_text()
assert 'setScreenBright(true)' in dream and 'setScreenBright(false)' not in dream
assert 'getAssets().open(chooseWallpaper())' in dream
assert 'root.addView(scenery' in dream and 'clockGroup.addView(time' in dream
assert 'onDreamingStarted()' in dream and 'onDreamingStopped()' in dream
assert 'handler.postDelayed(this, 60000L' in dream
assert 'ContentObserver volumeObserver' in main
assert 'registerContentObserver(Settings.System.CONTENT_URI' in main
assert 'unregisterContentObserver(volumeObserver)' in main
assert 'sampleVolume(true)' in main
assert 'volumeSupportMessage()' in main
assert 'bridge.volumeSupportMessage' in js
assert "if(name==='volumeDemo')" in js
assert 'adjustStreamVolume(stream, direction, 0)' in main
assert 'TYPE_APPLICATION_OVERLAY' not in main
print('PASS native screensaver artwork + visible clock, event-driven audio observation, Sony fallback')

# Vela update and focus regressions: old scope must not remain selected;
# downloads are background-only until the user explicitly opens Android installer.
updater=(r/'app/src/main/java/com/danielvu/quiethome/VelaUpdateController.java').read_text()
assert 'focusedControl=null' in js and 'var old=focusedControl' in js and 'focusedControl=el' in js
assert 'var old=controls[cursor]' not in js
assert "if(name==='autoDownload')" in js and 'Download updates automatically' in js
assert 'setAutoDownload(boolean enabled)' in main
assert 'setAutoDownloadEnabled(boolean value)' in updater and 'update_auto_download' in updater
assert 'autoDownloadEnabled()' in updater and 'j.put("downloaded", downloaded)' in updater
assert 'private void prefetch()' in updater and 'private File cacheApk(' in updater
assert 'sha256(temp).equals(digest)' in updater
prefetch=updater.split('private void prefetch()')[1].split('private File cachedApk()')[0]
assert 'promptInstaller(' not in prefetch and 'cacheApk(address, digest, length)' in prefetch
assert 'activity.runOnUiThread(() -> promptInstaller(apk))' in updater.split('void install()')[1]
assert 's&&s.autoDownload===false' in js and 's.downloaded?' in js
print('PASS focus selection scope and opt-in Android installation after cached APK download')

# Sony volume indicator is owned by the OS. Avoid duplicate native + Vela popups.
# The one-time migration keeps all other preferences and permits later opt-in.
assert 'private volatile boolean customVolumeEnabled = false;' in main
assert 'sony_native_volume_hud_v1' in main
assert 'prefersNativeVolumeHud()' in main and 'info.contains("bravia")' in main
assert 'prefs.edit().putString("ui_volume_ui", "off")' in main
assert 'putBoolean("sony_native_volume_hud_v1", true)' in main
assert 'if (prefersNativeVolumeHud() && !prefs.getBoolean' in main
assert "if(volumeMode==='off'&&!previewOnly)return;" in js
assert "if(name==='volumeDemo'){volumeChanged(lastVolume,true);return;}" in js
assert "volumeMode==='off'?'Native only'" in js
assert 'Sony can still display its own indicator; Vela cannot hide system UI.' in main
assert 'setCustomVolumeEnabled(volumeMode!==\'off\')' in js
print('PASS Sony native volume HUD migration and opt-in Vela HUD preview')

# HQ icon rendering and Home-only key handling.
assert 'if (force && customVolumeEnabled && javascriptReady && web != null)' in main
assert 'if ((force || changed)' not in main
assert 'sampleVolume(false);' in main # still samples baseline, never draws system-triggered double popup
assert 'a.adjustStreamVolume(stream, direction, 0)' in main
assert 'if (consumedVolumePress) return true;' in main
assert 'return super.dispatchKeyEvent(e);' in main
assert 'stopVolumeObservation();' in main
assert 'getDrawableForDensity(' in main and 'DisplayMetrics.DENSITY_XXXHIGH' in main
assert 'final int size = 192' in main
assert 'Bitmap.CompressFormat.PNG' in main and 'Bitmap.CompressFormat.WEBP, 78' not in main
assert 'data:image/png;base64,' in main
assert 'new WebResourceResponse("image/png"' in main
assert '-hq192-v2.png' in main
assert '?quality=hq192-v2' in js
assert 'volumeSettings' in js and 'Home-only overlay' in js
assert 'SYSTEM_ALERT_WINDOW' not in ET.tostring(m,encoding='unicode')
print('PASS Home-only volume input handling, native streaming fallback, high-density lossless TV icons')
