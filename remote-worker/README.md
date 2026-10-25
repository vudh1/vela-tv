# Vela secure remote — first-time setup

This is a Cloudflare Worker + SQLite-backed Durable Object relay for one Sony Vela TV. GitHub Pages hosts the web UI in `../remote/`. The PIN is **generated on the TV**, never configured in GitHub Secrets. Do not insert a Cloudflare API token or the PIN into the APK source, frontend, repository, logs, or an issue.

## 1. GitHub Pages

In repository **Settings → Pages**, set **Build and deployment → Source → GitHub Actions**. Run the **Publish Vela web remote** workflow once if it has not yet run. On every later change to `remote/` or `pages/` merged into `main`, it publishes only the public remote files at `https://vudh1.github.io/velatv/remote/`. The repository homepage also redirects there. The separate **Deploy Vela remote Worker** action only deploys the API; it does not publish GitHub Pages. An HTML preview working on your laptop does **not** mean remote commands are enabled.

## 2. Cloudflare Worker (one-time)

Use the existing Cloudflare account with the `vudhone.workers.dev` subdomain. The built-in endpoint is exactly `https://velatv-remote.vudhone.workers.dev`; if your account uses a different subdomain, update the pinned `API` constants in `../remote/app.js`, `../remote/index.html` CSP, and `../app/src/main/java/com/danielvu/quiethome/VelaRemoteClient.java` **together**. Never allow arbitrary user-supplied API endpoints that could steal the PIN.

```bash
cd remote-worker
npm install
npx wrangler login
npx wrangler deploy
```

You no longer configure a PIN on Cloudflare. The TV generates 10 random digits; Cloudflare receives them over TLS during enrollment, stores a salted hash, and never stores the plaintext PIN. On the free plan, SQLite Durable Objects are supported; usage is metered, and the TV's adaptive polling avoids high request volume when idle.

Alternatively, set only the following **GitHub Actions secrets** in `vudh1/velatv` and run the **Deploy Vela remote Worker** workflow manually: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Cloudflare's API token needs Workers script deployment and Durable Objects permissions for this account. The old `VELA_REMOTE_PIN` repository secret is no longer used and can be deleted; after migrating all TVs, remove the obsolete `REMOTE_PIN` Worker secret too.

**Upgrade order:** deploy this Worker first, then promote and install the updated Sony APK. Older Sony builds that still ask you to type a Cloudflare PIN must update before they can register using a TV-generated code.

## 3. Sony TV

1. Install a newly signed production Vela APK built from these changes using the **same signing certificate** as your existing Vela installation. Do not uninstall the old app or clear its data.
2. Open **Vela → Gear → Device & support → Web remote → Enable remote → Generate PIN**. The TV generates and displays a 10-digit code, creates a random device credential, and registers a salted code hash at Cloudflare. This PIN is encrypted locally on the TV by Android Keystore so it can be displayed again under **Show PIN**. Enter it on the phone within **10 minutes** to confirm the very first enrollment; afterward, the same PIN remains usable until you regenerate it.
3. Later use **Show PIN** to reconnect a phone, or **Regenerate PIN** to replace the code and immediately disconnect the old controller. Disable remote entirely to revoke the TV enrollment and all sessions.
4. Optional: open **Control other apps** and explicitly enable **Vela Remote navigation** in Sony Accessibility settings. Android will explain that an accessibility service can interact with the screen. Vela's implementation only inspects the focused accessibility node after an authorized button press and never stores screen text. Many streaming apps may still not support the navigation actions.
5. On a phone sharing the same home Internet connection, open `https://vudh1.github.io/velatv/remote/`, enter the PIN and try the D-pad on Vela Home.

**One controller:** a second device receives a busy message. Use **Disconnect** on the first, or wait ~22 seconds after its session expires. Closing the tab normally sends release immediately. If the TV changes networks, Cloudflare invalidates the old controller lease automatically. Turning off remote access on the TV revokes its enrollment and connected controllers; a failed network revocation must be resolved before enrolling a new TV.

## Security and physical-TV test checklist

- Wrong PIN five times → lockout; no secrets appear in browser storage, source, or logs. PIN displayed intentionally on the TV should not be photographed or shared.
- Rotation invalidates any active phone controller immediately. The stored server-side value is a salted PIN hash and no longer depends on GitHub Secrets.
- Phone on mobile data/VPN/different public IP → remote connection denied.
- Concurrent PIN submissions from two devices → only one lease granted (serialized Durable Object).
- Stale session and expired commands → rejected; TV polls authenticate with its 256-bit credential.
- Commands outside the exact allowlist → rejected; worker origin/CORS allows only `https://vudh1.github.io`.
- Test Sony Vela focus movement, OK, Back, Home, soundbar/CEC volume, playback, standby/reboot, Wi-Fi change, and streaming-app focus separately. Do not label unsupported system actions as working.

This design enforces a matching **public IPv4 address or IPv6 /64 prefix**, not identical private IP. Phones and TVs must generally have different private LAN addresses; comparing those for equality would reject a valid home network. If one client uses IPv4 and the other uses IPv6, Cloudflare cannot prove shared egress and will deny the connection rather than bypass the check.

**First-enrollment limitation:** without a separate owner login or pre-shared secret, Cloudflare cannot cryptographically prove that the first device attempting to enroll is *your* television. It cannot use that enrollment to send commands to a different TV, but a malicious first claimant could deny availability. An unconfirmed claim expires after 10 minutes, limiting accidental/one-shot squatting; confirmed enrollment requires the same public network and displayed code. If the room is taken by another device, recovery requires Cloudflare owner intervention. Add explicit owner identity for stronger multi-household FRIDAY-scale deployments.
