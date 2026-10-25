# Vela secure remote — first-time setup

This is a Cloudflare Worker + SQLite-backed Durable Object relay for one Sony Vela TV. GitHub Pages hosts the web UI in `../remote/`. Do not insert a Cloudflare API token or the PIN into the APK, frontend, repository, logs, or an issue.

## 1. GitHub Pages

In repository **Settings → Pages**, set **Deploy from a branch → main → /(root)** if not already configured. The resulting URL is `https://vudh1.github.io/velatv/remote/`. If the Pages deployment uses GitHub Actions, configure it to publish the `remote/` folder at that path instead. An HTML preview working on your laptop does **not** mean remote commands are enabled.

## 2. Cloudflare Worker (one-time)

Use the existing Cloudflare account with the `vudhone.workers.dev` subdomain. The built-in endpoint is exactly `https://velatv-remote.vudhone.workers.dev`; if your account uses a different subdomain, update the pinned `API` constants in `../remote/app.js`, `../remote/index.html` CSP, and `../app/src/main/java/com/danielvu/quiethome/VelaRemoteClient.java` **together**. Never allow arbitrary user-supplied API endpoints that could steal the PIN.

```bash
cd remote-worker
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put REMOTE_PIN
```

At the final prompt, enter your own random **8–12 digit PIN**. Cloudflare stores it as an encrypted Worker secret; it is not committed or echoed to the repo. The Worker intentionally returns `503 not_configured` before this secret exists. On the free plan, SQLite Durable Objects are supported; usage is metered, and the TV's adaptive polling avoids high request volume when idle.

Alternatively, set the following **GitHub Actions secrets** in `vudh1/velatv` and run the **Deploy Vela remote Worker** workflow manually: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `VELA_REMOTE_PIN`. The PIN should be long and randomly chosen, not a family birthday or easy sequence. Cloudflare's API token needs Workers script deployment and Durable Objects permissions for this account. The workflow syncs `VELA_REMOTE_PIN` into the Worker's private `REMOTE_PIN` secret.

## 3. Sony TV

1. Install a newly signed production Vela APK built from these changes using the **same signing certificate** as your existing Vela installation. Do not uninstall the old app or clear its data.
2. Open **Vela → Gear → Device & support → Web remote → Enable remote** and enter the *same* PIN. This creates a random device credential and enrolls this TV; the PIN is not retained on the TV.
3. Optional: open **Control other apps** and explicitly enable **Vela Remote navigation** in Sony Accessibility settings. Android will explain that an accessibility service can interact with the screen. Vela's implementation only inspects the focused accessibility node after an authorized button press and never stores screen text. Many streaming apps may still not support the navigation actions.
4. On a phone sharing the same home Internet connection, open `https://vudh1.github.io/velatv/remote/`, enter the PIN and try the D-pad on Vela Home.

**One controller:** a second device receives a busy message. Use **Disconnect** on the first, or wait ~22 seconds after its session expires. Closing the tab normally sends release immediately. If the TV changes networks, Cloudflare invalidates the old controller lease automatically. Turning off remote access on the TV revokes its enrollment and connected controllers; a failed network revocation must be resolved before enrolling a new TV.

## Security and physical-TV test checklist

- Wrong PIN five times → lockout; no secrets appear in browser storage, source, screenshots, or logs.
- Phone on mobile data/VPN/different public IP → remote connection denied.
- Concurrent PIN submissions from two devices → only one lease granted (serialized Durable Object).
- Stale session and expired commands → rejected; TV polls authenticate with its 256-bit credential.
- Commands outside the exact allowlist → rejected; worker origin/CORS allows only `https://vudh1.github.io`.
- Test Sony Vela focus movement, OK, Back, Home, soundbar/CEC volume, playback, standby/reboot, Wi-Fi change, and streaming-app focus separately. Do not label unsupported system actions as working.

This design enforces matching **public IP**, not identical private IP. Phones and TVs must generally have different private LAN addresses; comparing those for equality would reject a valid home network.
