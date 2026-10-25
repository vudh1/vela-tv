# Vela TV agent instructions

Before changes, read [README.md](README.md), [FRIDAY.md](FRIDAY.md), platform code, applicable workflows and [Samsung instructions](samsung/README.md). For web remote work also read [remote-worker/README.md](remote-worker/README.md).

## Device, privacy and release guarantees

- Sony Android TV and Samsung Tizen have materially different launcher, screensaver, pairing, key-control and installation capabilities. Never claim platform parity without testing.
- Preserve fast offline Home, D-pad navigation, TV profiles, last-good calendars and accessible ten-foot focus.
- Keep signing keys, private iCal URLs, PINs, device credentials and LAN addresses out of public source, logs and fixtures. A TV profile or PIN is not universal FRIDAY identity.
- Never change Sony package/signature or automatically advance `production` (signed APK release). Samsung builds require target-specific certificate/device validation. Build success is not hardware verification.
- Remote input is security-sensitive; follow current Cloudflare pairing/lease constraints and do not promise unsupported system-wide control.

## FRIDAY ecosystem compatibility

Vela owns TV/device behavior and presents only **authorized** information from other owning apps. [FRIDAY.md](FRIDAY.md) records actual versus proposed data paths; common contracts live in [vudh1/friday](https://github.com/vudh1/friday).

1. For every new feature, ask whether another FRIDAY app has a concrete use. If not, record **No FRIDAY impact**; avoid unnecessary shared abstractions.
2. Keep the owning app's data and operations authoritative. No other app may directly read its encrypted state branch.
3. For useful cross-app behavior, identify producer, consumer, minimal data, privacy classification, opt-in consent, revocation, narrow scopes, failure fallback and cost.
4. Propose a **versioned, backward-compatible contract** in [FRIDAY](https://github.com/vudh1/friday), with stable source-qualified IDs, timezone/DST, update/delete, retries, staleness and safe-error rules. Cross-app writes need explicit authorization.
5. Preserve offline/standalone function if FRIDAY or a provider is down; keep design semantically consistent without forcing one UI library.
6. Follow the owning repo's review and release gates; test authorization, revocation, duplicates and failure paths. Report proposed, implemented, tested, deployed and device-verified separately.

Shared TVs must hide private calendar/household content by default without explicit device- and profile-scoped grants. Existing direct Google and BallerWatch ICS subscriptions and cached views must survive any new FRIDAY adapter or outage.

## Verification

Use a focused PR; run applicable source validators/builds. Test timezone/DST, ongoing events, duplicate feeds, revocation, stale/offline behavior and display privacy for an integration. Distinguish source merge, signed artifact, cloud deployment, TV installation and actual Sony/Samsung feature verification. Never promote to production only for documentation changes.
