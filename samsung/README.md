# Samsung Tizen build (QN85QN85DDFXZA)

Samsung's consumer Tizen TV uses a signed **WGT Web app**, not the Android APK
used by Sony BRAVIA. The same HTML/CSS/JS lives in `app/src/main/assets`; the
Samsung build stages it with `samsung/config.xml` and `tizen-bridge.js`.

## Current capability scope

- Available in this source: offline wallpaper/clock, saved profiles, profile
  choice on Vela app launch, favorites, app browsing, per-profile usage sorting,
  Tizen application launch requests, and Samsung remote navigation.
- Not available on Samsung: replacement of Samsung Home, automatic visible
  launch on TV power-on, replacement of the system screensaver, Android-only
  volume overlay, the secure Android Google Calendar/iCal service, phone pairing,
  Nanit shortcut, Android recovery controls, and APK updater.
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

All bundled content, profiles, and sorting work offline. The app does not store
the router IP/SSID. The TV still needs to join the new Wi-Fi through Samsung
settings. For a future developer install, update Developer Mode's computer IP
if it changes. No app setting needs a hardcoded LAN address.
