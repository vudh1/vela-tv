# Vela TV

> **Release status (October 26, 2026 UTC):** Quiet Glass v1 is merged and the
> [signed Sony v22601 APK](https://github.com/vudh1/velatv/releases/tag/v22601)
> was published by a [successful production workflow](https://github.com/vudh1/velatv/actions/runs/40285377312).
> The [web remote Pages workflow](https://github.com/vudh1/velatv/actions/runs/40283859156)
> also succeeded. Neither proves installation or correct operation on an actual
> Sony/iPhone, and **no signed Samsung WGT/device validation is recorded**.
> See the [design review](docs/QUIET_GLASS_V1_REVIEW.md) and
> [issue #50 acceptance matrix](docs/ISSUE_50_DEVICE_QA.md) for remaining gates.

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

The startup chooser uses an opaque near-black cinematic backdrop regardless of
the previously selected wallpaper, with circular translucent profile medallions,
original two-tone 64-unit vector illustrations, no enclosing shelf or selection
outlines, and names below. Focus gently brightens only the chosen medallion with
a soft colored glow. Saved avatar selections remain compatible. It blocks Home until a profile is
chosen; normal profile management remains in the compact settings drawer.
The glass effect uses layered translucency without runtime blur on TV hardware.
Settings headings and action labels use consistent Title Case. This visual-only
change has **No FRIDAY impact** and adds no network or billing dependency.

The profile icon in the upper-left corner of Home opens this same full-screen
selector, with equally spaced profile circles, names beneath them, and the same
remote-focus glow. Back closes this manual selector without changing profiles;
the power-on selector continues to require a selection. Profile names, icons,
and the profile list are edited in Settings → Home & Profiles → Profiles.

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
- Sony `v22601` is the last release verified by this dated audit; always check
  [GitHub Releases](https://github.com/vudh1/velatv/releases) for later versions.
- `production` is not a Samsung release or an installed-device verification.

## One-time signing setup

The first production build must use the **same signing certificate** as the Vela APK already installed on the TV. From your Mac (with Android SDK Build Tools 35.0.0 and GitHub CLI installed):

```bash
gh auth login
bash scripts/setup-release-signing.sh "/path/to/quiet-home-dev.jks" "/path/to/your-existing-vela.apk"
```

The script checks certificate fingerprints and uploads **four encrypted Actions secrets**: `VELA_SIGNING_KEY_B64`, `VELA_STOREPASS`, `VELA_KEYPASS`, and `VELA_KEYALIAS`. Signing passwords and keystore contents must never be committed. To verify only the names were created: `gh secret list -R vudh1/velatv`.

## Updating the TV

When `production` receives a new commit, Actions builds and signs `Vela-release.apk`, publishes a GitHub Release, and Vela's **Gear → Updates** can check for new versions, download, verify SHA-256, and request installation. Android will prompt for installation approval; the app cannot silently install itself.

**Sony updater recovery:** **Open Android installer** first downloads and verifies the APK, then hands its read-only `content://` URI directly to Sony's visible Android package installer. Android still requires your approval and can demand **Allow from this source** for Vela. If that first installer does not appear, choose **Alternative installer** on Vela's Updates page; that method stages the verified APK with `PackageInstaller.Session` and explicitly requests a system confirmation. Returning from an unsuccessful direct install clears Vela's waiting state and presents an explanation; neither method silently installs or loops forever through unknown-app settings. Sony firmware may still block either method, and Android rejects mismatched signing certificates. The running older build cannot repair itself until a signed newer APK is installed **over** it (never uninstall or clear data).

**Reusable Mac/ADB fallback for every release:** Install Android platform-tools (`adb`), enable/authorize ADB debugging on the Sony TV and connect from your Mac (`adb connect TV_IP:5555` if using TCP). Then run:

```bash
curl -fsSLo install-latest-tv.sh https://raw.githubusercontent.com/vudh1/velatv/main/scripts/install-latest-tv.sh
bash install-latest-tv.sh
```

The script selects exactly one authorized TV (or accepts its ADB serial as an argument), downloads the newest production APK and matching published checksum, verifies SHA-256, and calls `adb install -r`. It preserves the app's package name and existing data. Every signed GitHub Release includes these manual-recovery instructions. **No FRIDAY impact, no new service or billing.** A successful CI build or command execution still does not prove that Sony's built-in installer displays correctly on all firmware versions.

This repository is public, so TV clients can fetch signed GitHub Release assets anonymously. Keep the same signing key and never embed private GitHub credentials in Vela.

## Secure phone/web remote

The Sony web remote lives at **https://vudh1.github.io/velatv/remote/**. GitHub Pages must use **GitHub Actions** as its publishing source; [Publish Vela web remote](.github/workflows/deploy-pages.yml) stages only the public remote assets on pushes to `main` or a manual workflow run. The repository homepage redirects to `/remote/`. This is a mobile web app (also installable to a phone's Home screen). The UI and Cloudflare relay are separate; opening the URL alone cannot control a TV until Cloudflare and the updated Sony APK have been configured.

- **TV controls:** Vela Home, D-pad and OK/Back while Vela is foreground; volume via Android's chosen audio output. An optional accessibility service attempts focus navigation in other apps, but Netflix/YouTube can block those actions. With owner-enabled Sony **IP control + Pre-Shared Key**, the web remote can issue IRCC commands for native-app navigation and Sony's official Power toggle. The minimal phone UI shows **Home / Back / Power**, D-pad, volume/mute and Play/Pause; it no longer displays Settings, Input, **TV options**, or **Type on TV**. Older clients retain their allowlisted commands for compatibility. The Power toggle only reaches the TV while Vela's relay is reachable; waking from standby is **not guaranteed** and normally needs an always-on controller. Test on the physical TV: not all consumer apps honor Sony keys. The Play/Pause control alternates separate Sony Pause and Play requests (first press pauses); Vela cannot read the player state.
- **Security:** each Sony TV generates a one-time 10-digit PIN within **Gear → Device & Support → Web Remote**. No PIN is configured in GitHub Secrets or retained on the TV; Cloudflare consumes its salted hash at first pairing. The TV stores only an encrypted random device credential. Each trusted phone stores its own non-extractable WebCrypto signing key per TV—not the PIN or Cloudflare bearer lease—to reconnect after mobile browser sleep or reload. Normal pairing checks the same **public IPv4 address or IPv6 /64 network prefix**. If iCloud Private Relay hides that match, the phone requires an additional **explicit approval on the Sony TV** and proves it holds the matching signing key before authenticating across IP changes. This optional trust permits controlling the TV even away from home until revoked. Up to **four independent short-lived controller leases per TV** are allowed. **Add Another Remote** preserves other pairings; **Paired Phones** lets the TV owner revoke one phone; **Disconnect** removes the selected phone, while **Disable Remote** revokes all phones on that TV.
- **Network:** the TV polls Cloudflare outbound over HTTPS. No router port forwarding, ADB server, or fixed local TV IP is needed. A public-address/prefix match is a useful household gate but does not mathematically prove both clients are on the same private LAN. An IP-mismatched phone needs on-TV consent and a signed browser key; no browser-reported LAN address is trusted. This is an explicit trusted-device exception, **not proof of sharing Wi-Fi**.
- **Privacy:** no PIN, calendar data, TV screen image, or streaming credentials are sent through the remote channel. Commands are strictly allowlisted. The phone typing UI is removed; existing encrypted-text relay handling remains only to avoid breaking older clients. The TV's text-decryption key is wrapped with Android Keystore and never sent to Cloudflare. The TV publishes its ordinary manufacturer/model (not serial number or LAN address) to label paired phones. No remote access works while the Worker is unconfigured or TV is offline.
- **Optional Sony IP control:** Enter the TV's PSK only in the Sony setup dialog on the TV. It is encrypted at rest using Android Keystore; Vela neither sends it to its web UI/Cloudflare nor logs it. Sony's IRCC-IP itself requires transmitting `X-Auth-PSK` in unencrypted HTTP; Vela restricts those requests to loopback or the TV's own active private IPv4 address. Android enables cleartext transport for this Sony API, so use only on a trusted home network. The setup test sends one Up command before saving the key. **Test Sony controls** repeats it; **Remove Sony key** deletes the stored credential. Existing web-remote pairing and volume continue to work if Sony IP control is unavailable. This is local TV integration only (**No FRIDAY impact**).

- **Phone remote Power:** The one-tap Power button uses an authenticated, owner-configured Sony IRCC toggle. A relay queue acknowledgment does not prove the TV changed state. The Settings/Input menu UI buttons are removed, but older commands remain allowlisted for backward compatibility. **No FRIDAY impact**.
- **Sony ARC volume feedback:** With Sony IP control configured, Vela sends Sony's official native Volume Up/Down/Mute IRCC codes before falling back to Android audio control. This gives the Sony/Vizio HDMI ARC path an opportunity to display its own indicator, but Sony's on-screen volume display is still firmware-dependent; never apply both volume steps. **No FRIDAY impact**.
- **Latency and cost:** The selected TV briefly arms fast (~180 ms) polling when the remote opens or keys are pressed. Idle Sony TV polling is ~2.5 seconds; only the selected TV on each phone gets a ~40-second heartbeat. A phone left open all night does not continuously fast-poll Cloudflare. A first press after a long idle can still be slower. **No FRIDAY impact**.
- **Phone app-switch behavior:** Each pointer gesture sends one immediate key action; the browser's follow-on click cannot send a duplicate. For supported directional and volume buttons, deliberate long presses still repeat, but losing tab focus, switching iPhone apps, suspending Safari or switching the selected TV immediately cancels repetition. Delayed synthetic clicks after returning to Safari are ignored. **No FRIDAY impact or billing change.**

**Two TVs per phone, four phones per TV:** The existing `primary-tv` Durable Object isolates up to **two Sony TVs on the same home Internet network**. One phone can pair with both and use the pill labeled from each TV's Android manufacturer/model (e.g. **Sony BRAVIA 4K VH2**); identical models get a **(2)** suffix. Previously paired phones learn the new label through status without re-pairing, once both Worker and TV are upgraded. Buttons never broadcast to both TVs. Each TV independently supports four signed phone remotes at once, with its own command queue and disconnect/revocation. The entire iPhone remote fits one locked viewport without page scrolling. A fifth phone on either TV must free that TV's registration slot. Cloudflare Free usage remains metered: two always-connected TVs may approach the daily free request limit, so monitor usage and stop or reduce polling if necessary; do not upgrade to paid Workers automatically.

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

The **Calendar** list shows ongoing and upcoming events up to one calendar month ahead, with subtle **Today**, **Tomorrow**, and dated dividers, plus **All**, **Playing**,
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

## License and attribution

Original Vela TV code and documentation are licensed under the [Apache License 2.0](LICENSE) (`Apache-2.0`). Copyright © 2026 Duong Vu and contributors. Bundled QR implementation, external weather data, reference projects and wallpaper provenance have separate notices in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and [WALLPAPER-CREDITS.md](WALLPAPER-CREDITS.md). No trademark, third-party asset, private calendar or device credential rights are granted by the source license. See [FRIDAY's policy](https://github.com/vudh1/friday/blob/main/docs/LICENSING.md).
