# First production release

Current repo: `vudh1/velatv` (public; renamed October 2026).

### Mac one-time bootstrap

Install `git` and [GitHub CLI](https://cli.github.com/) on Mac, then run `gh auth login`. Ensure you have a prior signing key `signing/quiet-home-dev.jks` in one of your previous Vela folders, then run from the new project:

```bash
bash scripts/bootstrap-github.sh
```

This copies sanitized source into the repo, pushes `main`, installs GitHub Actions secrets via encrypted GitHub CLI transport, then fast-forwards `production`. The `production` push triggers the release workflow. Never paste the keystore or secret values in chat.

### Distribution decision

GitHub API `/repos/vudh1/velatv/releases/latest` serves publicly downloadable signed releases. If this repository becomes private, use a separate public binary distribution endpoint. Do not insert a personal GitHub token into Vela.

### Later updates

Push changes to `main`, review/test, then merge `main` to `production` on GitHub. Each production push creates a new signed APK release. On Vela: Gear → Updates → Check for updates → Download & install. Android prompts for approval, not silent installation.

### Failure checks

- GitHub Actions run failure: missing secrets, Actions permissions, or source/build failure.
- `403` creating a Release: Settings → Actions → General → Workflow permissions, or workflow differences between `production` and `main` (both must include the same workflow definition).
- `404` in TV Updates: source repo is still private or no published release.
- `App not installed`: wrong signing certificate, insufficient storage, or incompatibility; don't uninstall Vela before checking.
- Old TV app can't find update: launch Gear → Updates once and confirm a publicly accessible latest release.
