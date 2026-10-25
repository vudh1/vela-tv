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

## Safe future integration

- Only show data authorized for the active TV profile; a profile chooser or local PIN alone does not authorize household integration. Revoke access and remove cached private views within a tested window.
- Use concise **All / Playing / Watching / Life** calendar categories, sensible ongoing/next-event behavior, correct timezone/DST and source-qualified deduplication; no invented sports broadcast labels.
- Never commit private feed URLs, plaintext event caches, pairing secrets or device addresses.
- If a FRIDAY adapter is added, keep existing Google/BallerWatch ICS, offline cached views and remote navigation working without it.
- At design time, mark **No FRIDAY impact** if a feature is local. Otherwise document owner, consumer, scopes, permission, failure behavior, stable IDs/schema and rollback in a [FRIDAY issue](https://github.com/vudh1/friday/issues).

See [AGENTS.md](AGENTS.md), [FRIDAY architecture](https://github.com/vudh1/friday/blob/main/docs/ARCHITECTURE.md) and [design guidance](https://github.com/vudh1/friday/blob/main/docs/DESIGN_SYSTEM.md).
