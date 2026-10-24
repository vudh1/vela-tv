# First production release

Current repo: `vudh1/vela-tv` (PRIVATE at time of preparation).

### Mac one-time bootstrap

Install `git` and [GitHub CLI](https://cli.github.com/) on Mac, then run `gh auth login`. Ensure you have a prior signing key `signing/quiet-home-dev.jks` in one of your previous Vela folders, then run from the new project:

```bash
bash scripts/bootstrap-github.sh
```

This copies sanitized source into the repo, pushes `main`, installs GitHub Actions secrets via encrypted GitHub CLI transport, then fast-forwards `production`. The `production` push triggers the release workflow. Never paste the keystore or secret values in chat.

### Distribution decision

GitHub API `/repos/vudh1/vela-tv/releases/latest` returns a 404 to unauthenticated TV clients if the source repository remains private. Making *reviewed and sanitized* `vela-tv` public is the least complicated way to enable direct TV updates. Otherwise set up a separately public release distribution repository or endpoint and change the updater URL before building. Do not insert a personal GitHub token into Vela.

### Later updates

Push changes to `main`, review/test, then merge `main` to `production` on GitHub. Each production push creates a new signed APK release. On Vela: Gear → Updates → Check for updates → Download & install. Android prompts for approval, not silent installation.

### Failure checks

- GitHub Actions run failure: missing secrets, Actions permissions, or source/build failure.
- `403` creating a Release: Settings → Actions → General → Workflow permissions, or workflow differences between `production` and `main` (both must include the same workflow definition).
- `404` in TV Updates: source repo is still private or no published release.
- `App not installed`: wrong signing certificate, insufficient storage, or incompatibility; don't uninstall Vela before checking.
- Old TV app can't find update: launch Gear → Updates once and confirm a publicly accessible latest release.
