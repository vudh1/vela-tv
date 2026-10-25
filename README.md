# Vela TV

Minimalist Android TV launcher for Sony BRAVIA.

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

On the TV, choose **Gear → Calendar → Connect with phone** (or Enter on TV)
and paste the URL. Vela verifies the feed over HTTPS, keeps the address in
encrypted per-profile native preferences, and refreshes about every 15 minutes.
There is no Google login, paid provider or additional TV permission required.

Current limitation: Vela stores one calendar subscription per profile;
adding BallerWatch replaces that profile's prior Google iCal subscription.
To change the teams published by BallerWatch, copy and paste the updated feed
URL again. Match feeds are public fixtures only; do not put private details in
a calendar URL. Vela accepts only the approved Google and BallerWatch hosts,
with no redirects to arbitrary external services.
