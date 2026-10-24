# Vela TV

Minimalist Android TV launcher for Sony BRAVIA.

## Branches & releases

- `main`: development and review.
- `production`: signed release builds. A push to `production` should trigger GitHub Actions after the Vela source and workflow have been uploaded.
- Vela's **Gear → Updates** checks releases and offers **Download & install** through the Android package installer. Installation requires TV confirmation; it's not silent.

## Setup status

The project source, workflow, and signing secrets still need an initial upload/configuration from the Mac using the project-provided `scripts/bootstrap-github.sh`. This repository is currently **private**, so the TV cannot access release downloads anonymously. Use a reviewed public repository or a separate public binary distribution channel before expecting TV updates.

Never commit signing keystores (`*.jks`), APKs, calendar iCal URLs, access tokens or passwords. Android upgrades must reuse the same package name and signing certificate as the installed Vela APK.
