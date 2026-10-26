# Issue #50 — Quiet Glass device acceptance and release evidence

**Audit date:** October 26, 2026 UTC (October 25 in Pacific time).  
**Scope:** [Vela #50](https://github.com/vudh1/velatv/issues/50), Sony Android/Google TV, iPhone web remote and separately scoped Samsung Tizen.  
**Verdict:** Source and release evidence exists; **physical acceptance is not complete**. No claim of a tested installation, iOS Safari run, Sony updater success, Cloudflare Worker deployment or Samsung certification is made by this document.

Status legend: **PASS (source)** means automated/local logic was exercised, **PASS (published)** means the linked GitHub gate completed, **OPEN (hardware)** means no real-device observation is attached, and **BLOCKED (tooling)** means the local environment could not execute a check. Passing source tests cannot turn a hardware row green.

## Verified release baseline

| Gate | Evidence | Result |
| --- | --- | --- |
| Quiet Glass source | [PR #46](https://github.com/vudh1/velatv/pull/46), [Sony promotion #48](https://github.com/vudh1/velatv/pull/48) | Merged |
| Sony DreamService return fix | [PR #47](https://github.com/vudh1/velatv/pull/47), [source CI #131](https://github.com/vudh1/velatv/actions/runs/40283985083) | Merged; CI success |
| Sony production branch | [PR #49](https://github.com/vudh1/velatv/pull/49), production commit `93a292ba63fa9293e016254195a4ca12855072d1` | Merged |
| Sony signed artifact | [Production run #26](https://github.com/vudh1/velatv/actions/runs/40285377312), [v22601](https://github.com/vudh1/velatv/releases/tag/v22601) with `Vela-release.apk` and `.sha256` | Workflow success; release published |
| Phone web remote | [Pages run #8](https://github.com/vudh1/velatv/actions/runs/40283859156) | Workflow success; Pages publication, **not iPhone QA** |
| Cloudflare remote Worker | Source and local tests under `remote-worker/`; deployment may be independent of GitHub Pages | **Deployment not independently verified in this audit** |
| Samsung WGT | `scripts/build-tizen.sh stage` builds web-app staging input only | **Unsigned; not installed, certified or device-tested** |

The release APK asset has a GitHub-published SHA-256 digest; the production job runs `apksigner verify` and `sha256sum -c`. These gates say nothing about compatibility with the certificate **currently installed on a physical TV**, user authorization of the package installer, or successful upgrade on that TV.

## Acceptance matrix

| Requirement | Source/pre-release evidence | Physical result / next proof |
| --- | --- | --- |
| Sony v22601 installed, selected as Home; cold/warm Home and 10-foot D-pad/Back | Android launcher, Dream return policy test and source CI: **PASS (source/published)** | **OPEN (hardware):** installation receipt, actual version, Sony firmware, 1080p/4K focus and Back video |
| Screensaver wake under Vela vs streaming app | Dream policy regression on CI: **PASS (source)** | **OPEN (hardware):** wait for ambient mode in both contexts; return to Vela only if Vela was underneath, never steal streaming app focus |
| Offline Home, startup latency, artwork and memory | Bundled assets, icon caching and local checks: **PASS (source)** | **OPEN (hardware):** Wi-Fi off/reboot/resume, measured first key and app launch, native icon legibility, memory observation |
| Circular/equal-gap profiles, Guest privacy | `profile_ui_test.js`, local cache isolation and synthetic capture assertions: **PASS (source)** | **OPEN (hardware):** cold/manual chooser, previous-profile flash check, Guest without saved apps/calendar/monitor events, screen saver as Guest |
| Weather, Google + legacy BallerWatch ICS, privacy | `calendar_ui_test.js`, `tizen_calendar_test.js`, `weather_test.js`: **PASS (source)** | **OPEN (hardware):** opt-in consent, offline/stale, duplicate, cancellation, DST repeated hour, ongoing overnight, long events; show only authorized summary on Home/saver |
| Two TVs per phone, four independent phones per TV, branded labels | Worker multi-TV/lease tests and `remote_phone_test.js`: **PASS (source)** | **OPEN (hardware):** physically pair two iPhones to one Sony, then four; pair one iPhone to two Sonys; verify model labels and independent queues |
| Network pairing, disconnect and TV-side revoke | Worker network, token, challenge and registration tests: **PASS (source)** | **OPEN (hardware):** dual-stack IPv4/IPv6, differing egress/VPN, fifth controller denial, phone Disconnect → TV list/count, TV Revoke/Disable → phone reconnect denied. Report any stale state, not success by assumption |
| No ghost/duplicate button after app switch | Pointer/visibility regression: **PASS (source)** | **OPEN (hardware):** hold Up/Volume, switch iOS apps, return after 3–10 s, count actions and inspect one unique key per tap. Do not capture tokens/PINs |
| iPhone layout, 200% text, safe area, reduced motion | Chromium synthetic 320–430 px assertions in optional capture script; script *not rerun on this host* | **OPEN (hardware):** Safari & Home Screen PWA at 200% text, notch/safe areas, 320/375/390/430 widths, no clipping/scroll, long TV model names |
| Native audio/video overlays and command support | Sony IRCC allowlist, optional PSK and foreground volume HUD tested in source | **OPEN (hardware):** HDMI ARC with Vizio, only one volume step/indicator, Power wake limits, Play/Pause/Back inside Netflix and YouTube |
| Sony updater / manual recovery | Updater permission/state and checksum installer scripts: **PASS (source)** | **OPEN (hardware):** try both on-TV installers with approval and matching cert; record error or success. Until verified, use [manual ADB fallback](../scripts/install-latest-tv.sh) to install latest signed release *over* existing app |
| Samsung QN85 WGT, navigation, install, APIs | Tizen bridge/calendar tests, local stage: **PASS (source)** | **OPEN (hardware):** target-specific Samsung certificate/DUID, signed WGT install, D-pad/Back, app launching, CORS feeds, offline and Guest; no Sony system parity claim |
| Figma synthetic fixture date | [Editable Figma review](https://www.figma.com/design/fOsOBZmiRUjxo2Xm1Rhhqh) Home idle/focus top dates changed to Sunday, October 25; source clock fixed at Oct 26 03:42 UTC = Oct 25 20:42 Pacific | **PASS (design fixture only)**; screenshot capture now asserts date and time in both DPR modes. Not a real TV clock test |

### Local checks from the issue #50 audit

- **PASS:** `python3 tests/validate.py`; `node tests/calendar_ui_test.js`, `tests/profile_ui_test.js`, `tests/focus_navigation_test.js`, `tests/weather_test.js`, `tests/tizen_bridge_test.js`, `tests/tizen_calendar_test.js`.
- **PASS:** `node --test remote-worker/test/*.test.js`, `node tests/remote_phone_test.js`, `python3 tests/install_latest_script_test.py`, `bash scripts/build-tizen.sh stage`.
- **BLOCKED (tooling):** `python3 tests/pairing_http_test.py` could not start `javac` on this runner. Prior linked GitHub source CI succeeded with Java 17 and Android 35; it is not a substitute for running the missing local check.
- **NOT RUN:** optional real Chromium screenshot capture (`scripts/capture-quiet-glass.cjs`) because this runner has no Chrome/Chromium binary, and no Android SDK/authorized physical TV or paired iPhone was available here.

## Owner device-test procedure

1. **Inventory without secrets:** record device manufacturer/model, Android/Tizen firmware, iOS version and Safari/PWA mode, installed Vela version, approximate test date/time and network type. Never publish a serial, TV LAN address, PIN, PSK, token, private ICS URL, personal profile contents or identifiable calendar title.
2. **Sony:** install [v22601](https://github.com/vudh1/velatv/releases/tag/v22601) with the existing signing identity; confirm version in Vela About. Verify Home and streaming-app round trips, Vela Clock after 30 minutes, and standby/wake separately. Use guest/synthetic accounts for public video.
3. **Profiles/calendar:** switch Duong → Guest → saved profile; assert Guest has no cached private calendar on Home **or** screensaver. Disconnect Internet and reopen Home; inject only test ICS events covering two sources, a duplicate, a cancelled event, a fall-back DST repeated hour and an event spanning midnight. Verify source removal clears its cache without affecting the other source. Do not share screenshots with real household entries.
4. **iPhones:** with the Sony remote already enabled, select **Add Another Remote** for the second phone (not Disable); use a fresh PIN. Test on one Wi-Fi, then compare IPv4-only and IPv6/dual-stack paths. Add up to four distinct controllers. Exercise one phone controlling two independent Sony TVs if a second TV is actually available. For revocation, capture the *before/after count* at the TV and the phone's failed reauthorization; do not count a visual button disappearing as a server acknowledgment.
5. **Safari edge cases:** hold Up while app-switching; return after 3, 10 and 60 seconds; tap once and count TV actions. Repeat with volume. Check 200% text/reduced motion, landscape/small-height view, status-bar and Home indicator safe areas, long TV model names, ARC/native overlay conflicts and media keys inside actual streaming apps.
6. **Sony updater:** from an older same-signed Vela build, use **Gear → Updates → Open Android installer** with `Allow from this source` if required, then try Alternative installer if the first is blocked. Record system error text and whether the version changed. Do not uninstall or clear app data. If using ADB, run the checked-in latest-install script; keep the connected TV selection explicit and record only a redacted result.
7. **Samsung separately:** use [Samsung installation guidance](../samsung/README.md). Build/sign with your own Samsung device certificate and DUID; test on the target QN85. Verify regular-app launch, focus/Back, selected app launch support, cache/CORS behavior, profiles and offline. Do not attempt a system Home/screensaver replacement or Sony phone pairing on Tizen.

### Evidence template (attach redacted media to the issue)

| Test ID | Device and OS | Vela version/build | Observed result | PASS / FAIL / NOT RUN | Redacted screenshot/video/log link |
| --- | --- | --- | --- | --- | --- |
| SONY-HOME-01 | e.g. Sony BRAVIA, Android version (no serial) | v22601 if installed | pending | NOT RUN | — |
| SONY-DREAM-02 | | | pending | NOT RUN | — |
| PHONE-PAIR-03 | iPhone A/B, iOS/Safari | Pages/Worker revisions when known | pending | NOT RUN | — |
| PHONE-REVOKE-04 | | | pending | NOT RUN | — |
| SAMSUNG-WGT-05 | QN85, Tizen version (no DUID) | signed WGT build | pending | NOT RUN | — |

Never upload raw `adb logcat`, Cloudflare logs, browser storage, screen recordings containing private events or network identifiers. Extract only timestamp, command class, anonymized device slot and observed result. Include a clear **FAIL** entry for any real pairing mismatch, stale revocation, duplicate press or installer failure instead of marking the code path green.

## Rollback and platform limits

- Sony: if Vela cannot navigate, choose the stock Google TV launcher as Home and keep Vela's app data. Restore last known-good source through a reviewed PR and publish a **higher-versionCode**, same-package, same-signed APK. An old release APK may fail Android downgrade checks. Retain the currently installed package until a safe replacement is verified.
- Remote: disconnect individual phone leases or use TV-side Disable for all controllers. If Worker behavior regresses, revert its deployment through the existing Cloudflare workflow, not by exposing a private key or bypassing network/PIN checks. The TV Home remains usable offline. Check Free-tier request use; do not enable a paid plan automatically.
- Samsung: Tizen WGT identity and certificate chain are independent of Android; uninstalling may erase local settings. Do not promise launcher or screensaver control, native IRCC, Sony remote support, silent updates or streaming-app control without device-specific proof.
- FRIDAY: **No contract, data, billing, or Kept reminder feed changes** in this audit. Google and BallerWatch ICS remain independent opt-in sources. Kept private sharing remains off.

Issue #50 stays open until real Sony/iPhone acceptance and separate Samsung disposition have owner-approved, redacted evidence.
