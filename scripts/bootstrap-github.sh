#!/usr/bin/env bash
# One-time Mac setup; uploads no signing keys and never force-pushes.
set -euo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
REPO='vudh1/velatv'
command -v gh >/dev/null || { echo 'Install GitHub CLI (brew install gh), then gh auth login.' >&2; exit 1; }
command -v git >/dev/null || { echo 'Git is required.' >&2; exit 1; }
command -v rsync >/dev/null || { echo 'rsync is required.' >&2; exit 1; }
gh auth status >/dev/null || { echo 'Run gh auth login first.' >&2; exit 1; }
KEYFILE="${VELA_KEYSTORE:-$BASE/signing/quiet-home-dev.jks}"
if [[ ! -f "$KEYFILE" ]]; then
  for PRIOR in Vela-2.4-Refinements Vela-2.3-Volume-Overlay Vela-2.2-Baby-Monitor Vela-2.1-Profiles-Phone-Calendar Vela-2.0-Icons-Avatars-Calendar Vela-1.9-Profiles-Wallpaper-Gallery Vela-1.8-Responsive-Launcher Vela-1.6-Source; do
    test ! -f "$HOME/Desktop/$PRIOR/signing/quiet-home-dev.jks" || { KEYFILE="$HOME/Desktop/$PRIOR/signing/quiet-home-dev.jks"; break; }
  done
fi
[[ -f "$KEYFILE" ]] || { echo 'Original Vela signing key not found. Set VELA_KEYSTORE=/path/to/original/quiet-home-dev.jks.' >&2; exit 1; }
printf 'Original signing key found (will NOT be committed).\n'
WORK="$(mktemp -d "${TMPDIR:-/tmp}/vela-release.XXXXXXXX")"
trap 'rm -rf "$WORK"' EXIT
# gh auth setup-git configures a credential helper, not a source-code secret.
gh auth setup-git >/dev/null
git clone "https://github.com/$REPO.git" "$WORK/repo"
DEST="$WORK/repo"
# Only copy specifically approved content from the release package.
for file in README.md THIRD-PARTY-NOTICES.md WALLPAPER-CREDITS.md build.gradle settings.gradle .gitignore; do
  cp "$BASE/$file" "$DEST/$file"
done
for folder in app tests scripts preview .github; do
  mkdir -p "$DEST/$folder"
  rsync -a --exclude '*.apk' --exclude '*.jks' --exclude 'build/' --exclude '.tools/' --exclude '.state/' --exclude '__pycache__/' "$BASE/$folder/" "$DEST/$folder/"
done
# Fail closed if any signing credential, binaries, or local setup data appear in Git's index.
git -C "$DEST" add README.md THIRD-PARTY-NOTICES.md WALLPAPER-CREDITS.md build.gradle settings.gradle .gitignore app tests scripts preview .github
if git -C "$DEST" diff --cached --name-only | grep -Ei '(^|/)(signing|\.state|\.tools|local\.properties)(/|$)|\.(jks|keystore|p12|apk|idsig)$'; then
  echo 'Sensitive or binary build files staged! Aborting.' >&2; exit 1
fi
if ! git -C "$DEST" diff --cached --quiet; then
  git -C "$DEST" commit -m 'Vela 2.5: production APK pipeline and on-TV updater'
  git -C "$DEST" push origin main
else
  echo 'main is already up to date.'
fi
# Keep release signing secrets out of shell history and repository files.
STOREPASS="${VELA_STOREPASS:-android}"
KEYPASS="${VELA_KEYPASS:-$STOREPASS}"
KEYALIAS="${VELA_KEYALIAS:-quiet-home}"
base64 < "$KEYFILE" | tr -d '\n' | gh secret set VELA_SIGNING_KEY_B64 -R "$REPO"
printf '%s' "$STOREPASS" | gh secret set VELA_STOREPASS -R "$REPO"
printf '%s' "$KEYPASS" | gh secret set VELA_KEYPASS -R "$REPO"
printf '%s' "$KEYALIAS" | gh secret set VELA_KEYALIAS -R "$REPO"
echo 'Configured the four signing secrets securely.'
# Do not force push. If production exists, require a fast-forward from main.
git -C "$DEST" fetch origin production 2>/dev/null || true
if git -C "$DEST" show-ref --quiet refs/remotes/origin/production; then
  git -C "$DEST" checkout -B production origin/production
  git -C "$DEST" merge --ff-only main || { echo 'production diverged. Review and merge main via a PR, then push production.' >&2; exit 1; }
else
  git -C "$DEST" checkout -b production main
fi
git -C "$DEST" push -u origin production
cat <<'EOF'
Success: Vela project and workflow pushed. Check GitHub Actions for the release build.
IMPORTANT: This source repo is PRIVATE. The TV cannot read private GitHub releases
without credentials. For the simplest TV self-update, audit the repo and make it public,
or configure a separate public binary distribution channel.
EOF
