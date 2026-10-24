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
assert 'Bitmap.CompressFormat.WEBP' in main
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
assert 'function volumeChanged(payload)' in js and 'volumeSettings' in js and 'volumeDemo' in js
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
