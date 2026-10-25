# Samsung Tizen build (QN85QN85DDFXZA)

Samsung's consumer Tizen TV uses a signed **WGT Web app**, not the Android APK
used by Sony BRAVIA. The same HTML/CSS/JS lives in `app/src/main/assets`; the
Samsung build stages it with `samsung/config.xml` and `tizen-bridge.js`.

## Current capability scope

- Available in this source: offline wallpaper/clock, saved profiles, profile
  choice on Vela app launch, favorites, app browsing, per-profile usage sorting,
  Tizen application launch requests, Samsung remote navigation, three app-label
  layouts, ambient IP-local weather, and encrypted private Google
  Calendar/BallerWatch iCal subscriptions.
- Like CleanFrame, Vela includes dock/list layouts, wallpaper gallery and
  rotation, light/dark contrast, app favorites, streaming-app discovery,
  per-profile appearance and app sorting. Built-in artwork has a UHD option;
  four SVG landscapes remain vector at any TV resolution.
- Not available on Samsung: replacement of Samsung Home, automatic visible
  launch on TV power-on, replacement of the system screensaver, Android-only
  volume overlay, phone pairing, Nanit shortcut, Android recovery controls,
  custom on-device photo picker, and APK updater.
- The Samsung calendar uses the Tizen KeyManager + AES-GCM to protect each
  saved private iCal link and cache on-device. **This is not Google OAuth:**
  choose Vela → Gear → Daily life → Calendar → Google Calendar, paste the
  secret Google iCal URL, then separately connect the BallerWatch iCal feed.
  Either source may be replaced or disconnected without affecting the other.
  The Calendar page filters a one-calendar-month list (Today, Tomorrow and later day dividers) by Playing, Watching or Life;
  it shows date/time in the list and full description, field/location and
  watched-TV channel only when the event is opened. Watched matches can store
  a manual Drogon TV channel name and launch installed Perfect Player; an
  automatic jump into a specific channel is not supported.
  Google and Samsung can restrict direct cross-origin HTTPS requests. The
  parser and encryption pass simulated-device tests, but **actual calendar
  downloads and UI behavior still need verification on this QN85 model**.
  If the TV blocks a feed, Vela keeps the encrypted link and last verified
  cache, and shows an unverified status; it does not silently use a proxy.
- Weather uses public-IP city detection and Open-Meteo's current conditions
  and near-term precipitation. Requests run after Home initializes, are
  cached, and cannot block opening an app. It is not the Samsung screensaver.
- Launching preinstalled streaming apps from another app is firmware-dependent;
  the application API may reject individual targets. If so, Samsung Home remains
  the way to open them.
- Samsung profile data is local to this TV and is **not** copied from Sony.
  Uninstalling the Samsung app erases this locally stored data.

## Build and install on your own Samsung TV

1. Install **Tizen Studio**, the **Samsung TV extension** and the Samsung TV
   **Certificate Manager** on your Mac/PC.
2. On the TV: Smart Hub → Apps → App Settings, enter `12345`, enable Developer
   Mode, add your *current* computer LAN IP, and restart the TV.
3. Put computer and TV on the same network, connect using Tizen Studio Device
   Manager, and create a Samsung TV distributor certificate containing the TV's
   device ID (DUID). Never commit your certificate/private keys.
4. In this repository, build and sign:

   ```bash
   bash scripts/build-tizen.sh stage
   VELA_TIZEN_PROFILE=YOUR_CERTIFICATE_PROFILE bash scripts/build-tizen.sh package
   ```

5. Find the generated `.wgt` under `build/tizen/.buildResult/` and install
   using Tizen Studio, or
   `bash scripts/device.sh samsung install TV_SERIAL /path/to/signed.wgt`.
   Launch Vela from Samsung Apps. Developer Mode/network access may be needed
   again for subsequent development installs.

Samsung does **not** allow normal USB installation of WGT packages and won't
let an independently installed consumer app take over the power-on Home screen.
An installable signed WGT needs the certificate for *your particular TV*; this
repository deliberately contains no credentials or pre-signed package.

## Moving to a different Wi-Fi/network

All bundled content, profiles, saved calendar links, and sorting remain local;
the app does not store the router IP/SSID. An already installed Vela does not
need reinstallation after moving house. Calendar updates resume when the TV
joins an Internet-connected Wi-Fi, subject to the same HTTPS/CORS restrictions.
The TV still needs to join the new Wi-Fi through Samsung settings. For a
future developer install, update Developer Mode's computer IP if it changes.
No app setting needs a hardcoded LAN address.

## Upstream inspiration and limits

The consumer-app filtering and interaction options draw on the public
[CleanFrame project](https://github.com/nthnclrk/CleanFrame). Vela keeps its
own visual design and assets. CleanFrame's firmware-specific, undocumented
native override of Samsung Home is intentionally **not included**: the
QN85QN85DDFXZA has not been validated for that modification, and a bad
system launcher override could leave the TV difficult to recover.
