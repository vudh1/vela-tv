# Vela TV

Minimalist TV Home experience. One shared interface with platform-specific
integration and installation targets.

## Ambient weather

Vela Home shows a small, non-interactive weather card with current
temperature/conditions, approximate city/region, precipitation now and the
next-hour rain probability. On Sony, the **native Vela Clock screensaver** also
shows the weather near the upper-right, leaving the clock at the lower-left
and calendar events at the lower-right. On Samsung, weather appears within
the Vela app; Samsung's system screensaver remains unchanged.

Weather is approximate, based on the TV's **public internet IP** (not GPS or
the router's private 192.168.x.x address). It may identify a neighboring city
or VPN/ISP exit point. Vela refreshes asynchronously every 10–15 minutes and
rechecks its IP location about every 30 minutes, so changing Wi-Fi or moving
does not require reconfiguration. Weather never intercepts remote focus, delays
app launch, or shows a network-error modal. The last verified conditions can
appear briefly while refreshing and are hidden when older than 90 minutes.

IP geolocation comes from [IP Info](https://ip-info.com/), and weather from
[Open-Meteo](https://open-meteo.com/) (CC BY 4.0 attribution). Provider credit
is kept here and in About, not on Home or screensaver surfaces. No public IP
address, credentials, or ISP/network identifier is persisted.

| Device | Target | Build | Capability |
| --- | --- | --- | --- |
| Sony BRAVIA / Android TV | Signed `.apk` | `bash scripts/build.sh` | Launcher, native clock/screensaver, private calendar, updater |
| Samsung Neo QLED / Tizen | Signed `.wgt` | `bash scripts/build-tizen.sh package` | Regular TV app: Home dashboard, profiles, favorites, app browser, encrypted private iCal |

For Samsung setup, certificate signing, developer installation and its
platform limitations, see [Samsung Tizen instructions](samsung/README.md).
The Android APK **cannot** be installed on a Samsung Tizen TV.

The platform-aware command is `scripts/device.sh`:

```bash
bash scripts/device.sh sony build
bash scripts/device.sh sony install TV_IP
bash scripts/device.sh samsung stage
VELA_TIZEN_PROFILE=YOUR_PROFILE bash scripts/device.sh samsung build
bash scripts/device.sh samsung install TV_SERIAL /path/to/signed.wgt
```

Android and Tizen signing credentials are separate. Neither the TV's own
network address nor the signing certificate is committed to the repository.

### Profiles after power-on

On Sony, a new Vela launcher process asks for a profile; screen-off and reboot
signals also arm the chooser. Returning from an app to an existing Vela process
does not. Some TV firmware hides standby signals, and Android killing the
launcher during streaming can create an extra cold-start prompt. A third-party
app cannot guarantee detecting every physical Sony power wake.

On consumer Samsung TVs, Vela cannot replace the system Home or automatically
appear at power-on. It can ask for a profile when the user opens the Vela app.

### Changing your home Wi-Fi

Vela keeps its profiles, favorites, artwork and history on the TV. Its Sony
calendar subscription and encrypted cache are tied to the Android app's local
keystore, not to a Wi-Fi name, router, or fixed TV address; they refresh when
the TV has Internet access. Pairing generates a fresh private-LAN address every
time. App update checks use HTTPS, not your home-network IP.

**You still must connect the TV itself to the new network** if its SSID or
password changes. Using the same SSID/password on the new router can avoid
that step, provided the TV joins successfully. Phone pairing and developer
installation require the phone/computer to be on the appropriate local network.
No re-entry of the saved Google iCal secret is required solely because Wi-Fi
changes. Samsung's encrypted calendar also stays saved on the TV; any feed
still requires Internet and Tizen's cross-origin HTTPS access to work.

### High-resolution artwork

The four native SVG wallpapers scale cleanly at any screen size. The four
photographic wallpapers have 3840×2160 WebP exports alongside lightweight
720p fallbacks, with updated gallery thumbnails. These are high-quality
resampled exports of generated illustrations, **not photographs with genuine
4K source detail**. Vela selects higher-resolution assets on larger TV modes;
the Android screensaver also checks physical display resolution rather than
always decoding a quarter-sized image. App logos are losslessly cached as
384px PNGs on Android, the Vela icon is 512px, and the TV banner is 1280×720.
Other installed apps supply their own icon source quality, which Vela cannot
improve beyond the underlying artwork. Sony's optional personal wallpaper
now preserves images up to 3840×2160 at higher JPEG quality; the TV's image
decoder still limits what is actually displayed.

## Release branches

- `main`: source changes, testing and review.
- `production`: builds and publishes a signed APK release on push via [GitHub Actions](.github/workflows/production-apk.yml).
- [Draft release PR](../../pull/1): stage source and signing configuration safely before the first deployment.

## One-time signing setup

The first production build must use the **same signing certificate** as the Vela APK already installed on the TV. From your Mac (with Android SDK Build Tools 35.0.0 and GitHub CLI installed):

```bash
gh auth login
bash scripts/setup-release-signing.sh "/path/to/quiet-home-dev.jks" "/path/to/your-existing-vela.apk"
```

The script checks certificate fingerprints and uploads **four encrypted Actions secrets**: `VELA_SIGNING_KEY_B64`, `VELA_STOREPASS`, `VELA_KEYPASS`, and `VELA_KEYALIAS`. Signing passwords and keystore contents must never be committed. To verify only the names were created: `gh secret list -R vudh1/vela-tv`.

## Updating the TV

When `production` receives a new commit, Actions builds and signs `Vela-release.apk`, publishes a GitHub Release, and Vela's **Gear → Updates** can check for new versions, download, verify SHA-256, and request installation. Android will prompt for installation approval; the app cannot silently install itself.

**Current limitation:** this source repository is private. Its GitHub Releases cannot be fetched anonymously from the TV. Complete public binary distribution configuration, or audit and change repository visibility, **before** relying on TV self-updates. Do not expose private credentials to the TV.

## Security and compatibility

Never commit signing keystores (`*.jks`), APKs, calendar iCal URLs, access tokens or passwords. Preserve the app package name `com.danielvu.quiethome` and the existing signing certificate to allow Android upgrades. Keep the original APK as a recovery copy and the original signing key safely backed up.

## BallerWatch calendar subscription

Vela accepts a read-only iCalendar (`.ics`) URL from the existing Google Calendar
secret-feed format **or** from the BallerWatch Worker at
`https://ballerwatch-web.vudhone.workers.dev/web/calendar.ics`. In BallerWatch,
open Settings → Share my calendar and copy the generated URL with your RATS,
pickup and watched professional-sports selections.

On Sony, choose **Gear → Daily life → Calendar → Connect with phone** (or
Enter on TV) and paste the URL. Vela verifies the feed over HTTPS, keeps the
address in encrypted per-profile native preferences, and refreshes about every
15 minutes. On Samsung, use **Gear → Daily life → Calendar → Connect private
calendar** to paste the secret URL with the Samsung keyboard; it is encrypted
under Tizen KeyManager, and refreshes directly over HTTPS. Cross-origin
requests may be blocked by Samsung/Google and require a test on the actual TV.
There is no Google login or paid provider.

Current limitation: Vela stores one calendar subscription per profile;
adding BallerWatch replaces that profile's prior Google iCal subscription.
To change the teams published by BallerWatch, copy and paste the updated feed
URL again. Match feeds are public fixtures only; do not put private details in
a calendar URL. Vela accepts only the approved Google and BallerWatch hosts,
with no redirects to arbitrary external services.
