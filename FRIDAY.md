# Vela TV × FRIDAY

Vela owns TV launcher/navigation, device settings, profiles, screen presentation and remote controls—not BallerWatch sports records or Kept tasks. [FRIDAY](https://github.com/vudh1/friday) coordinates optional permissions, contracts and design.

## Integration register

| Capability | Status | Rule |
| --- | --- | --- |
| Google and BallerWatch ICS subscriptions | **Implemented in Vela source** | Preserve direct feeds, encrypted local cache and independent/offline operation; platform network behavior still requires device testing. |
| Sony/Samsung TV Home, profiles and ambient information | **Existing, platform-dependent** | Native capabilities are not identical; opening Home must not need FRIDAY. |
| Sony web remote + Cloudflare relay | **Implemented in source; deployment/pairing must be verified separately** | Vela owns PIN/device credential/controller lease boundaries, not FRIDAY identity. |
| Kept Life reminders | **Proposed** | Private information off on shared displays until explicit profile/device consent. |
| Normalized FRIDAY events and handoff | **Proposed** | Versioned authorized summaries, source app owns details; direct feeds remain fallback. |
| BallerWatch stable read-only profile ICS (v1) | **Staged consumer on source branch; producer not activated** | Per non-Guest Vela profile only; no BallerWatch management scope. 404/410 revokes local protected cache; 503 retains last-good data. Google and parameterized ICS survive. |

## Cost boundary

The [FRIDAY cardless rule](https://github.com/vudh1/friday/blob/main/docs/COST_POLICY.md) blocks new payment credentials, billed/free-converting plans and $0 tiers requiring a card until a specific owner exception. Confirm TV relay traffic, cloud/AI free limits and degradation behavior before new integrations; source and CI do not show actual billing. Kept-to-Vela Life reminder sharing stays off until a no-card, profile-scoped authorization path is security-reviewed. **No billing impact** from this documentation change.

## Safe future integration

- Only show data authorized for the active TV profile; a profile chooser or local PIN alone does not authorize household integration. Revoke access and remove cached private views within a tested window.
- Use concise **All / Playing / Watching / Life** calendar categories, sensible ongoing/next-event behavior, correct timezone/DST and source-qualified deduplication; no invented sports broadcast labels.
- Never commit private feed URLs, plaintext event caches, pairing secrets or device addresses.
- If a FRIDAY adapter is added, keep existing Google/BallerWatch ICS, offline cached views and remote navigation working without it.
- The optional BallerWatch accountless stable feed is an independent read capability, not universal identity or the proposed FRIDAY JSON event protocol. Its D1/key and production activation are gated by BallerWatch; Vela only stages the read-only client.
- At design time, mark **No FRIDAY impact** if a feature is local. Otherwise document owner, consumer, scopes, permission, failure behavior, stable IDs/schema and rollback in a [FRIDAY issue](https://github.com/vudh1/friday/issues).

See [AGENTS.md](AGENTS.md), [FRIDAY architecture](https://github.com/vudh1/friday/blob/main/docs/ARCHITECTURE.md) and [design guidance](https://github.com/vudh1/friday/blob/main/docs/DESIGN_SYSTEM.md).
