#!/usr/bin/env python3
"""Static constraints; TV frame rate and Android APK need physical testing."""
import subprocess
from pathlib import Path
from xml.etree import ElementTree as ET
r=Path(__file__).resolve().parents[1]
asset=r/'app/src/main/assets'
for f in ['app.js','style.css','index.html','weather.js','landscape.svg','landscape-1.svg','landscape-2.svg','landscape-3.svg']:
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
assert 'id="weatherCard"' in (asset/'index.html').read_text()
assert 'weatherReady:' in js and 'VelaWeatherClient.start()' in js
assert '.weather-card' in css and 'pointer-events:none' in css
weather_js=(asset/'weather.js').read_text()
assert "https://ip-info.com/json" in weather_js and "https://api.open-meteo.com/v1/forecast" in weather_js
assert 'MAX_AGE=90*60000' in weather_js and 'setTimeout(refresh,900)' in weather_js
assert 'window.location' not in weather_js and 'weather_snapshot_v1' in weather_js
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
subprocess.run(['node','--check',str(asset/'weather.js')],check=True)
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
assert 'Bitmap loadScenery()' in dream and 'getAssets().open(asset)' in dream
assert 'display.getMode().getPhysicalWidth()' in dream
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
assert 'final int size = 384' in main
assert 'Bitmap.CompressFormat.PNG' in main and 'Bitmap.CompressFormat.WEBP, 78' not in main
assert 'data:image/png;base64,' in main
assert 'new WebResourceResponse("image/png"' in main
assert '-hq384-v3.png' in main
assert '?quality=hq384-v3' in js
assert 'volumeSettings' in js and 'Home-only overlay' in js
assert 'SYSTEM_ALERT_WINDOW' not in ET.tostring(m,encoding='unicode')
print('PASS Home-only volume input handling, native streaming fallback, high-density lossless TV icons')

# 2026 usability update: standby-only profile picker, native screensaver events,
# sorted app histories and minimal remote navigation. Privacy constraints remain.
assert 'Intent.ACTION_SCREEN_OFF' in main and 'Intent.ACTION_SCREEN_ON' in main
assert 'profile_choose_on_next_home' in main and 'consumeWakeProfilePrompt()' in main
assert 'setWakeProfilePromptEnabled(boolean enabled)' in main
assert 'QH && QH.checkWakeProfilePrompt' in main
assert 'function checkWakeProfilePrompt()' in js
assert 'checkWakeProfilePrompt:checkWakeProfilePrompt' in js
assert "else if(type==='startupProfiles')" in js and "'Who is watching?'" in js
assert 'function goBack()' in js and "else if(key==='left'&&screen)goBack()" in js
for screen in ['homeSettings','lifeSettings','appsSettings','deviceSettings','appSort','homeApps','screensaverSettingsPanel']:
    assert "type==='"+screen+"'" in js
assert 'function orderedApps()' in js and 'p.usage.push({id:id,at:now})' in js
assert 'week' in js and 'month' in js and 'quarter' in js and 'sortLabel()' in js
assert 'Number(e.end)>Math.max(start,Date.now())' in js
assert "e.start<=n+3600000?'soon'" in js and 'e.start<=n+2*3600000?' in js
dream=(r/'app/src/main/java/com/danielvu/quiethome/VelaDreamService.java').read_text()
calendar=(r/'app/src/main/java/com/danielvu/quiethome/VelaCalendarController.java').read_text()
assert 'cachedEventsForDream(this, currentProfile())' in dream
assert 'positionContent()' in dream and 'Math.min(3, events.size())' in dream
assert 'VelaWeatherRepository.refresh' in dream and 'showWeather(' in dream
weather_native=(r/'app/src/main/java/com/danielvu/quiethome/VelaWeatherRepository.java').read_text()
assert 'weather_cache_v1' in weather_native and 'weather_location_v1' in weather_native
assert 'Executors.newSingleThreadExecutor' in weather_native and 'getApplicationContext()' in weather_native
assert 'setConnectTimeout(5500)' in weather_native and 'weather_data_v1' not in weather_native
assert 'requestWeather(boolean ignoredForce)' in main
assert 'Gravity.START | Gravity.BOTTOM' in dream and 'Gravity.END | Gravity.BOTTOM' in dream
assert 'eventBlock.setTranslationX(x)' in dream and 'clockGroup.setTranslationX(x)' in dream
assert 'static JSONArray cachedEventsForDream(Context ctx, String profile)' in calendar
assert 'success_'+ '"+profile' in calendar and 'day_'+ '"+profile' in calendar
assert 'url_'+ '"+profile' not in dream
assert 'wakeProfilePromptEnabled' in js and 'profile_prompt_enabled' in main
boot=(r/'app/src/main/java/com/danielvu/quiethome/VelaBootReceiver.java').read_text()
assert 'Intent.ACTION_BOOT_COMPLETED' in boot
assert any(x.get(a+'name')=='.VelaBootReceiver' for x in app.findall('receiver'))
assert 'android.permission.RECEIVE_BOOT_COMPLETED' in ET.tostring(m,encoding='unicode')
print('PASS grouped settings, wake profile choice, app sorting, ongoing events, screensaver privacy and remote left exit')

# Sony must show the chooser on cold process startup even when no screen-off
# broadcast was delivered; ordinary streaming-app returns should not re-arm it.
assert 'if (b == null) markNextViewingSession();' in main
assert 'if (!screenIsInteractive()) markNextViewingSession();' in main
onresume=main.split('@Override public void onResume()')[1].split('@Override protected void onPause()')[0]
assert 'markNextViewingSession();' in onresume
assert 'markNextViewingSession();' not in onresume.split('if (!screenIsInteractive())')[0]
assert 'Intent.ACTION_SCREEN_OFF' in main

# Samsung uses the same UI with a separate Tizen adapter, not Android APK APIs.
for f in ['app.js','style.css','index.html','weather.js','tizen-bridge.js','tizen-calendar.js','tizen-private-calendar.js']:
    assert (asset/f).read_bytes()==(r/'preview'/f).read_bytes(),f
tizen=(asset/'tizen-bridge.js').read_text()
assert "window.VelaPlatform = {kind:'tizen'}" in tizen
assert 'tizen.application.getAppsInfo' in tizen and 'tizen.application.launch' in tizen
assert '10009' in tizen and 'window.QH.remote(key)' in tizen
assert 'tizenMode' in js and 'tizenCalendarEntry' in js and 'saveTizenCalendar' in js
assert 'appLabels' in js and 'data-app-labels' in css
for stem in ['mist-lake','blue-coast','amber-dunes','lavender-bay']:
    for base in [asset/'wallpapers',r/'preview'/'wallpapers']:
        assert (base/(stem+'-4k.webp')).stat().st_size>100000
        assert (base/('thumb-'+stem+'.webp')).stat().st_size>10000
assert (r/'design'/'vela-icon.svg').exists() and (r/'design'/'vela-banner.svg').exists()
assert (r/'app/src/main/res/drawable/icon.png').stat().st_size>5000
assert (r/'app/src/main/res/drawable/banner.png').stat().st_size>5000
config=ET.parse(r/'samsung/config.xml').getroot()
t='{http://tizen.org/ns/widgets}'
assert config.find(t+'application') is not None
assert config.find(t+'profile').get('name')=='tv'
assert any(p.get('name')=='http://tizen.org/privilege/appmanager.launch' for p in config.findall(t+'privilege'))
assert any(p.get('name')=='http://tizen.org/privilege/internet' for p in config.findall(t+'privilege'))
assert not any(p.get('name')=='http://tizen.org/privilege/keymanager' for p in config.findall(t+'privilege'))
origins=[x.get('origin') for x in config.findall('{http://www.w3.org/ns/widgets}access')]
assert 'https://ip-info.com' in origins and 'https://api.open-meteo.com' in origins
subprocess.run(['bash','-n',str(r/'scripts/build-tizen.sh')],check=True)
subprocess.run(['bash','-n',str(r/'scripts/device.sh')],check=True)
print('PASS cold-process profile fallback, calm two-column screensaver and Samsung Tizen staging')

# Web remote is opt-in; do not regress to a local unauthenticated command server.
remote_native=(r/'app/src/main/java/com/danielvu/quiethome/VelaRemoteClient.java').read_text()
remote_page=(r/'remote/index.html').read_text()
remote_js=(r/'remote/app.js').read_text()
remote_worker=(r/'remote-worker/src/index.js').read_text()
assert "row('remoteSettings'" in js and "QH.remoteStatusReady(" in main
assert 'VelaRemoteClient.get(this).start()' in main
assert 'VelaRemoteAccessibilityService' in ET.tostring(m,encoding='unicode')
assert 'AndroidKeyStore' in remote_native and 'AES/GCM/NoPadding' in remote_native
assert 'https://velatv-remote.vudhone.workers.dev' in remote_native
assert 'vudh1.github.io/velatv/remote' in js
assert 'https://vudh1.github.io' in remote_worker and 'MAX_FAILED = 5' in remote_worker
assert 'sameNetwork' in remote_worker and 'controllerHash' in remote_worker
assert 'pinHash' in remote_worker and 'pinSalt' in remote_worker
assert 'generatePin(' in remote_native and 'remove("pin_encrypted")' in remote_native
assert '.putString("pin_encrypted"' not in remote_native
assert "row('remoteRotate'" in js and "row('remoteShowPin'" not in js
assert 'showWebRemotePin' not in main and 'remoteHasPin' not in main
assert 'VELA_REMOTE_PIN' not in (r/'.github/workflows/deploy-remote.yml').read_text()
assert 'REMOTE_PIN' not in remote_worker
assert 'sessionStorage.setItem' not in remote_js and 'localStorage.setItem' not in remote_js
assert 'indexedDB' in remote_js and 'crypto.subtle.sign' in remote_js
assert "'/api/challenge'" in remote_js and "'/api/resume'" in remote_js
assert "path === '/api/resume'" in remote_worker and 'pairedKeyId' in remote_worker
assert "addEventListener('pagehide'" not in remote_js
assert 'content-security-policy' in remote_page.lower()
subprocess.run(['node','--check',str(r/'remote/app.js')],check=True)
subprocess.run(['node','--check',str(r/'remote-worker/src/index.js')],check=True)
print('PASS one-time TV PIN, encrypted controller signing key, Cloudflare replay-safe reconnect')

# Web remote onboarding and honest cross-app capabilities.
assert 'static void remoteControllerConnected()' in main
assert 'remotePinDialog.dismiss()' in main and 'remotePinDialog.isShowing()' in main
assert 'MainActivity.remoteControllerConnected();' in remote_native
assert 'audio.adjustVolume(direction, AudioManager.FLAG_SHOW_UI)' in remote_native
assert 'audio.isVolumeFixed()' in remote_native
navigation=(r/'app/src/main/java/com/danielvu/quiethome/VelaRemoteAccessibilityService.java').read_text()
assert 'ACTION_ACCESSIBILITY_FOCUS' in navigation and 'node.isClickable()' in navigation
assert 'ACTION_SCROLL_FORWARD' in navigation and 'ACTION_SCROLL_BACKWARD' in navigation

# A standby profile choice must never expose Home behind a translucent drawer.
assert '<body class="booting">' in (asset/'index.html').read_text()
assert 'body.booting .scene,body.booting .page{visibility:hidden}' in css
assert '.overlay.startup-panel{z-index:80;background:#1c292d' in css
assert 'width:100vw;min-width:0;height:100vh' in css
assert 'startup-avatar-grid' in js and 'startup-profile-name' in js
assert "if(screen==='startupProfiles')return;" in js
assert "document.body.classList.remove('booting')" in js
assert "document.body.classList.remove('booting');listDirty=true;activeList()" in js

# A refresh is not verified just because an older cache succeeded today.
assert 'CalendarIcs.upcoming(feed,zone,day,30)' in calendar
assert 'refreshed==total' in calendar and 'Refresh failed · showing saved calendar events' in calendar
assert 'now+30*86400000' in js
print('PASS remote auto-dismiss, best-effort native control, immersive startup profiles and 30-day calendar refresh')

# Sony IRCC keys are never in the public browser assets or Cloudflare relay.
sony=(r/'app/src/main/java/com/danielvu/quiethome/VelaSonyIpControl.java').read_text()
codes=(r/'app/src/main/java/com/danielvu/quiethome/SonyIrccMessage.java').read_text()
assert "row('sonyIpSetup'" in js and 'configureSonyIpControl' in main
assert 'sonyIpControlEnabled' in main and 'removeSonyIpControl' in main
assert 'VelaSonyIpControl.get(context).send(key' in remote_native
assert 'VelaRemoteClient.encrypt(psk)' in sony and 'psk_encrypted' in sony
assert 'X-Auth-PSK' in sony and 'setInstanceFollowRedirects(false)' in sony
assert '127.0.0.1' in sony and 'ip.isSiteLocalAddress()' in sony
assert 'getActiveNetwork()' in sony and 'TRANSPORT_VPN' in sony
assert 'http://' in sony and 'https://' not in sony
assert 'play_pause' in codes and 'X_SendIRCC' in codes
assert 'sonyIpSetup' not in remote_js and 'X-Auth-PSK' not in remote_js+remote_worker
assert 'android.permission.ACCESS_NETWORK_STATE' in ET.tostring(m,encoding='unicode')
assert 'usesCleartextTraffic' in ET.tostring(m,encoding='unicode')
print('PASS Sony on-device PSK isolation, restricted HTTP hosts, opt-in IRCC and offline fallback')
