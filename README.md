# Vela TV

Minimalist TV Home experience. One shared interface with platform-specific
integration and installation targets.

**FRIDAY:** [Integration ownership and compatibility](FRIDAY.md) · [Agent instructions](AGENTS.md).

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

The startup chooser uses a full-screen neutral graphite backdrop regardless of
the previously selected wallpaper, with large profile icons and names below.
It blocks Home until a profile is chosen; normal profile management remains
in the compact settings drawer.

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

The script checks certificate fingerprints and uploads **four encrypted Actions secrets**: `VELA_SIGNING_KEY_B64`, `VELA_STOREPASS`, `VELA_KEYPASS`, and `VELA_KEYALIAS`. Signing passwords and keystore contents must never be committed. To verify only the names were created: `gh secret list -R vudh1/velatv`.

## Updating the TV

When `production` receives a new commit, Actions builds and signs `Vela-release.apk`, publishes a GitHub Release, and Vela's **Gear → Updates** can check for new versions, download, verify SHA-256, and request installation. Android will prompt for installation approval; the app cannot silently install itself.

**Sony updater recovery:** Vela now opens Android's "Install unknown apps" setting at most once per install attempt. After enabling **Allow from this source** for Vela, press **Back** and the pending installation resumes automatically. The verified APK is staged with Android's `PackageInstaller.Session` and requires a visible Android confirmation; Android may block an install because of TV policy, insufficient storage, or a mismatched signing certificate. Vela surfaces the result rather than reopening settings indefinitely. The existing broken updater cannot repair itself on all Sony firmware: install the first fixed, signed GitHub APK manually **over** Vela (do not uninstall, since that can erase your on-TV data), then use Vela updates for later releases. This is local Sony update behavior only (**No FRIDAY impact, no new service or billing**). Physical TV confirmation remains required.

This repository is public, so TV clients can fetch signed GitHub Release assets anonymously. Keep the same signing key and never embed private GitHub credentials in Vela.

## Secure phone/web remote

The Sony web remote lives at **https://vudh1.github.io/velatv/remote/**. GitHub Pages must use **GitHub Actions** as its publishing source; [Publish Vela web remote](.github/workflows/deploy-pages.yml) stages only the public remote assets on pushes to `main` or a manual workflow run. The repository homepage redirects to `/remote/`. This is a mobile web app (also installable to a phone's Home screen). The UI and Cloudflare relay are separate; opening the URL alone cannot control a TV until Cloudflare and the updated Sony APK have been configured.

- **TV controls:** Vela Home, D-pad and OK/Back while Vela is foreground; volume via Android's chosen audio output. An optional accessibility service attempts focus navigation in other apps, but Netflix/YouTube can block those actions. For Sony BRAVIA TVs with **IP control + Pre-Shared Key** support, **Gear → Device & Support → Web remote → Sony native-app controls** provides an opt-in IRCC-IP path for D-pad/OK/Back, HDMI 1–4/input selection, discrete TV standby, and best-effort playback while a streaming app is foreground. The mobile **Settings** gear opens Vela Settings; **TV & Inputs** groups the HDMI and Wi-Fi actions. Wi-Fi opens Android TV's native network settings and changing networks can interrupt the remote. TV standby explicitly requires confirmation; powering on from full standby is **not supported** without an additional always-on local controller. The Vizio V51-H6 soundbar's input selection is **not** controlled by Sony HDMI input commands. Test on the physical TV: not all consumer apps honor Sony keys. The combined Play/Pause button alternates separate Sony Pause and Play requests (first press pauses); Vela cannot read streaming-app playback state.
- **Security:** the Sony TV generates a one-time 10-digit PIN within **Gear → Device & Support → Web remote**. No PIN is configured in GitHub Secrets or retained on the TV; Cloudflare consumes its salted hash at first pairing. The TV stores only an encrypted random device credential. A trusted phone stores a non-extractable WebCrypto signing key—not the PIN or Cloudflare bearer lease—so it can prove its identity and reconnect after mobile browser sleep or reload. Cloudflare checks that TV and phone share the same **public IPv4 address or IPv6 /64 network prefix** and grants a single short-lived controller lease. Regenerating a PIN or explicit disconnect revokes the paired phone.
- **Network:** the TV polls Cloudflare outbound over HTTPS. No router port forwarding, ADB server, or fixed local TV IP is needed. A public-address/prefix match is a useful household gate but does not mathematically prove both clients are on the same private LAN (VPN, CGNAT and different IPv4/IPv6 egress paths matter).
- **Privacy:** no PIN, calendar data, TV screen image, or streaming credentials are sent through the remote channel. Commands are strictly allowlisted. Optional **Type on TV** encrypts up to 160 characters on the phone with ephemeral P-256 ECDH and AES-GCM for the TV's public key; Cloudflare sees only a short-lived encrypted payload, not typed text. Vela's Android accessibility service sends decrypted text only to the currently focused editable **non-password** field, without reading the field. Apps may reject text actions. Do not use this feature for passwords or account secrets. The TV's text-decryption key is wrapped with Android Keystore and never sent to Cloudflare. No remote access works while the Worker is unconfigured or TV is offline.
- **Optional Sony IP control:** Enter the TV's PSK only in the Sony setup dialog on the TV. It is encrypted at rest using Android Keystore; Vela neither sends it to its web UI/Cloudflare nor logs it. Sony's IRCC-IP itself requires transmitting `X-Auth-PSK` in unencrypted HTTP; Vela restricts those requests to loopback or the TV's own active private IPv4 address. Android enables cleartext transport for this Sony API, so use only on a trusted home network. The setup test sends one Up command before saving the key. **Test Sony controls** repeats it; **Remove Sony key** deletes the stored credential. Existing web-remote pairing and volume continue to work if Sony IP control is unavailable. This is local TV integration only (**No FRIDAY impact**).

- **Phone remote Settings:** The new one-tap gear button opens Vela's grouped Settings, including from streaming apps, without bypassing a pending profile chooser. It never opens Sony's global system settings. **No FRIDAY impact**.
- **Sony ARC volume feedback:** With Sony IP control configured, Vela sends Sony's official native Volume Up/Down/Mute IRCC codes before falling back to Android audio control. This gives the Sony/Vizio HDMI ARC path an opportunity to display its own indicator, but Sony's on-screen volume display is still firmware-dependent; never apply both volume steps. **No FRIDAY impact**.
- **Latency and cost:** Connected phones briefly arm fast (~180 ms) polling when the remote opens or keys are pressed. Polling returns to the economical rate after inactivity; a phone left open all night does not continuously fast-poll Cloudflare. A first press after a long idle can still be slower. **No FRIDAY impact**.

See [remote setup instructions](remote-worker/README.md) before enabling **Gear → Device & support → Web remote** on Sony. Samsung Tizen is not a remote-control target in this version.

## Security and compatibility

Never commit signing keystores (`*.jks`), APKs, calendar iCal URLs, access tokens or passwords. Preserve the app package name `com.danielvu.quiethome` and the existing signing certificate to allow Android upgrades. Keep the original APK as a recovery copy and the original signing key safely backed up.

## BallerWatch calendar subscription

Vela can subscribe to **both** a read-only Google Calendar secret iCalendar
(`.ics`) URL **and** the BallerWatch Worker feed at
`https://ballerwatch-web.vudhone.workers.dev/web/calendar.ics`. In BallerWatch,
open Settings → Share my calendar and copy the generated URL with your RATS,
pickup and watched professional-sports selections.

Go to **Gear → Daily life → Calendar**, then connect **Google Calendar** and
**BallerWatch** separately. You can replace or remove either source while
keeping the other. On Sony, scan the **Connect using phone** QR code or use
**Enter on TV** inside each source. On Samsung, paste each source's URL using
the remote keyboard. Each URL and cached feed is AES-GCM encrypted locally per
profile; there is no Google login, Cloudflare proxy or IPTV credential sharing.
Feeds refresh about every 15 minutes while Vela is active. Cross-origin HTTPS
may be blocked by Samsung/Google and must be verified on the actual television.

The **Calendar** page shows the next seven days, with **All**, **Playing**,
**Watching**, and **Life** filters. Every event displays its date and time.
BallerWatch `Playing · BallerWatch` events appear under Playing; `Watching ·
professional sports` events under Watching. Google birthdays, tasks and other
events appear under Life unless the iCal category explicitly says Playing or
Watching. The Home preview shows at most two events today; the Sony native
screensaver shows at most three ongoing or next-two-hour events. Both surfaces
hide full notes, fields and channel names to keep the design uncluttered.

Select an event in Calendar to see details. Playing events show their
**field/location**; watched events show a **TV channel** (when provided) and
can store the exact Drogon TV channel name **per profile and event**. Choose
**Open Perfect Player** to launch the installed app and then select the named
channel yourself. The current BallerWatch feed does **not** supply Drogon
channel mappings; Perfect Player has no verified public per-channel launch
interface, so Vela does not claim automatic tuning. Life events display the
normal iCal description, location and available link in their details.

To update your sports/team selection, copy the new BallerWatch URL and replace
just that source. Treat secret Google URLs as passwords; match-feed URLs can
encode your viewing preferences. Only the approved Google and BallerWatch
hosts can be used (including redirects).
