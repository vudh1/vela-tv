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

You no longer configure a PIN on Cloudflare. The TV generates 10 random digits; Cloudflare receives them over TLS during enrollment, stores a salted hash, and never stores the plaintext PIN. The PIN hash is consumed when the first controller pairs. On the free plan, SQLite Durable Objects are supported; usage is metered, and the TV's adaptive polling avoids high request volume when idle.

Alternatively, set only the following **GitHub Actions secrets** in `vudh1/velatv` and run the **Deploy Vela remote Worker** workflow manually: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Cloudflare's API token needs Workers script deployment and Durable Objects permissions for this account. The old `VELA_REMOTE_PIN` repository secret is no longer used and can be deleted; after migrating all TVs, remove the obsolete `REMOTE_PIN` Worker secret too.

**Upgrade order:** deploy this Worker first, then promote and install the updated Sony APK. Older Sony builds that still ask you to type a Cloudflare PIN must update before they can register using a TV-generated code.

## 3. Sony TV

1. Install a newly signed production Vela APK built from these changes using the **same signing certificate** as your existing Vela installation. Do not uninstall the old app or clear its data.
2. Open **Vela → Gear → Device & Support → Web remote → Enable remote → Generate PIN**. The TV displays a 10-digit code once, creates an encrypted device credential, and registers a salted code hash at Cloudflare. Enter it on your phone to confirm the initial enrollment within **10 minutes**. After successful pairing, the PIN cannot be displayed or reused.
3. Your paired phone resumes automatically after idle, tab reload, or ordinary mobile browser suspension while both devices remain on the same home Internet connection. The phone stores a non-extractable signing key in IndexedDB, not a PIN or bearer lease. **Generate new PIN** revokes the previous phone and permits pairing a replacement. **Disable remote** revokes the TV enrollment and all sessions.
4. Optional: open **Control other apps** and explicitly enable **Vela Remote navigation** in Sony Accessibility settings. Android will explain that an accessibility service can interact with the screen. Vela's implementation only inspects the focused accessibility node after an authorized button press and never stores screen text. Many streaming apps may still not support the navigation actions.
5. On a phone sharing the same home Internet connection, open `https://vudh1.github.io/velatv/remote/`, enter the PIN and try the D-pad on Vela Home. The phone's **Settings** gear opens Vela's grouped settings, including from a streaming app. A pending startup profile choice must be completed first. **TV & Inputs** opens HDMI input choices, Android Wi-Fi settings, and a confirmed Sony standby command. **Type on TV** encrypts non-password search/form text on the phone; select an editable field on the TV first and enable Vela's separate Accessibility service. App compatibility varies.

### Optional Sony native-app navigation (Netflix / YouTube)

On supported BRAVIA models, enable **Sony Settings → Network & Internet → Home network → IP control** and its **Pre-Shared Key** authentication. Create a unique 8–20 character ASCII key on the TV. In Vela, open **Gear → Device & Support → Web remote → Sony native-app controls**, enter that same key directly on the TV, and select **Save & test**. This sends one Sony Up command; after confirmation, open a native streaming app and try the phone D-pad, OK, Back and Play/Pause. HDMI 1–4/input menu and standby also require this Sony key. Source switching controls TV HDMI inputs, not the separate Vizio soundbar input. The app cannot guarantee power-on from standby; the browser cannot access an offline local TV. Wi-Fi settings are launched by the Android TV Settings intent, not Sony IRCC. On Vela Home, its own navigation continues as before; volume/mute use Sony's IRCC command first and Android AudioManager fallback. No phone or Cloudflare configuration changes are needed.

The Sony key is encrypted on-device with Android Keystore, never present in the browser, Github, or Cloudflare. Sony IRCC-IP requires **unencrypted local HTTP**, including the `X-Auth-PSK` header; Vela only contacts this TV's own loopback or private-interface IP and never sends the key to another LAN device. Use only on a trusted network. **Test Sony controls** repeats the Up command; **Remove Sony key** deletes the saved key. Vela falls back to its optional Accessibility service if IRCC is unavailable. Consumer SONY firmware may reject on-device IRCC requests even when an external phone can send them: only a physical-device test can verify the feature. A combined Play/Pause remote button alternates Sony's separate Pause and Play codes, beginning with Pause, without knowledge of the current player state.

**One controller:** the trusted phone can reacquire an expired lease by signing a single-use challenge; a different phone cannot silently take over. On a different phone, generate a new PIN on the TV, which revokes the previous one. Explicit **Disconnect** removes the phone's saved signing key and revokes the lease. Closing/suspending a tab does **not** disconnect it. If the TV changes networks, Cloudflare invalidates the trusted-phone registration. Turning off remote access on the TV revokes enrollment and connected controllers; failed network revocation must be resolved before enrolling a new TV.

**Latency and ARC audio:** The phone briefly arms ~180 ms TV polling bursts on connection/return and recent commands; inactivity returns it to the economical rate so a tab left open does not continually fast-poll Cloudflare. A first command after extended inactivity can still be slower. Sony's IRCC Volume Up/Down/Mute commands are attempted first when configured, with Android audio as fallback; Sony/Vizio ARC volume indicator behavior still requires hardware verification. There is no FRIDAY identity or new cross-app contract.

**Encrypted phone typing:** When the TV polls, it announces its P-256 ECDH public key to the authenticated relay. The phone generates an ephemeral ECDH key and derives AES-GCM with the TV key. The Durable Object accepts only three ciphertext fields (`ephemeral`, `iv`, `cipher`) under the `type_text` command and discards the encrypted message after the next TV poll. The TV decrypts in memory and asks Android Accessibility to set only a focused editable non-password field. The private key is wrapped by the device's Android Keystore. No typed characters are logged or stored in readable form by the relay. TV text entry can still fail if a streaming app declines Accessibility text input; this is not a remote password-manager feature.

## Security and physical-TV test checklist

- Wrong PIN five times → lockout. The PIN is never persisted in browser storage, source, or logs; the browser stores only a non-extractable private signing key. Do not photograph or share the one-time code.
- PIN rotation invalidates the paired phone immediately. After successful pairing, Cloudflare clears the salted PIN hash; no reusable PIN remains.
- Phone on mobile data/VPN/different public IP → remote connection denied.
- Concurrent PIN submissions from two devices → only one lease granted (serialized Durable Object).
- Stale session and expired commands → rejected; TV polls authenticate with its 256-bit credential.
- Commands outside the exact allowlist → rejected; `type_text` rejects plaintext/extraneous fields and demands bounded encrypted payloads. Worker origin/CORS allows only `https://vudh1.github.io`.
- Test Sony Vela focus movement, OK, Back, Home, soundbar/CEC volume, playback, standby/reboot, Wi-Fi change, and streaming-app focus separately. Do not label unsupported system actions as working.

This design enforces a matching **public IPv4 address or IPv6 /64 prefix**, not identical private IP. Phones and TVs must generally have different private LAN addresses; comparing those for equality would reject a valid home network. If one client uses IPv4 and the other uses IPv6, Cloudflare cannot prove shared egress and will deny the connection rather than bypass the check.

**First-enrollment limitation:** without a separate owner login or pre-shared secret, Cloudflare cannot cryptographically prove that the first device attempting to enroll is *your* television. It cannot use that enrollment to send commands to a different TV, but a malicious first claimant could deny availability. An unconfirmed claim expires after 10 minutes, limiting accidental/one-shot squatting; confirmed enrollment requires the same public network and displayed code. If the room is taken by another device, recovery requires Cloudflare owner intervention. Add explicit owner identity for stronger multi-household FRIDAY-scale deployments.
