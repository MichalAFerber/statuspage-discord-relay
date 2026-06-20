# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.1.0]

### Fixed
- **Never return a non-2xx to the status page.** Authentication now gates only
  whether a post is forwarded to Discord — a configured route always answers
  `2xx`. Previously a missing or invalid token returned `403`, which caused
  status pages to deactivate the webhook subscription (the exact failure this
  relay exists to prevent).

### Added
- **Path-based token auth** (`/<route>/<token>`), which is preserved by webhook
  senders that drop query strings. `?token=` and `Authorization: Bearer` still
  work.
- Unauthenticated posts to a configured route are acknowledged with a `2xx` but
  not relayed, and logged so `wrangler tail` surfaces token mismatches.

## [1.0.0]

### Added
- Initial release: one Cloudflare Worker relaying Atlassian Statuspage and
  Instatus webhook notifications into Discord.
- Path-based routing (`/<route>`) mapping each status page to its own Discord
  webhook via a single `ROUTES` JSON secret, with a Workers KV upgrade path.
- Always-`2xx` acknowledgement with out-of-band Discord delivery and capped
  retries on `429`/`5xx`.
- Per-route token auth with a global `RELAY_TOKEN` fallback.
- Role mentions on high-impact events; per-route username/avatar overrides.
- Incident, component, and scheduled-maintenance embeds with normalized status
  colors and labels across the Statuspage and Instatus schemas.
