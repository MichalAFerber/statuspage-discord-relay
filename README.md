# statuspage-discord-relay

A tiny [Cloudflare Worker](https://workers.cloudflare.com/) that relays
[Atlassian Statuspage](https://www.atlassian.com/software/statuspage) and
[Instatus](https://instatus.com/) webhook notifications into **Discord** — one
Worker, many status pages, many channels.

```
┌────────────┐   webhook POST    ┌─────────────────────────┐   Discord embed   ┌──────────────┐
│ Status page │ ───────────────▶ │  statuspage-discord-relay │ ───────────────▶ │ Discord channel │
│ (Statuspage,│  /proton?token=… │      (Cloudflare Worker)  │  reshaped JSON   │  (one webhook) │
│  Instatus…) │                  └─────────────────────────┘                   └──────────────┘
```

## Why this exists

You **cannot** point a Statuspage webhook straight at a Discord webhook URL.
Statuspage POSTs its own JSON shape (an `incident` or `component_update`
object); Discord only accepts `{ content, embeds, … }`. Discord rejects the
unrecognized body with a `4xx`, Statuspage sees repeated non-2xx responses, and
**deactivates the subscription**. (If you got an email titled *"Webhook problem
detected"*, that's exactly what happened.)

This Worker is the translator in the middle. It:

- accepts the status page's POST and **always answers `2xx` immediately**, so the
  subscription stays healthy;
- reshapes the payload into a Discord embed and forwards it out of band;
- routes each status page to a **different Discord server/channel** by URL path;
- protects each endpoint with a **shared-secret token**;
- optionally **@-mentions a role** only on high-impact events.

## How routing works

A Discord webhook URL *is* the binding to one channel in one server — so there's
nothing extra to "pass." The only routing question is: *which inbound status
page maps to which Discord webhook?* That's keyed off the **first path segment**
of the URL each page subscribes to:

```
https://<worker>/proton/<token>       →  ROUTES["proton"].url    (a Discord channel)
https://<worker>/github/<token>       →  ROUTES["github"].url     (another channel)
```

The routing table lives in a **single JSON secret** (`ROUTES`), not a committed
YAML file — because Discord webhook URLs are secrets (anyone holding one can post
to that channel) and Workers don't read config files at runtime. `wrangler
secret put ROUTES` updates routing live, with nothing sensitive in git. For
larger setups there's a [KV upgrade path](#scaling-up-with-kv).

## Supported status pages

| Provider                 | Supported | Notes                                                              |
| ------------------------ | :-------: | ------------------------------------------------------------------ |
| **Atlassian Statuspage** |     ✅     | Canonical schema. Incidents, components, and scheduled maintenance. |
| **Instatus**             |     ✅     | Same schema with `UPPERCASE` statuses and `incident.url`; normalized automatically. |
| Others (Better Stack, …) |    ➖     | Unknown shapes are safely ignored with a `2xx` (no Discord spam). Open an issue/PR with a sample payload to add one. |

Both incident updates and bare component-status flips are handled. Scheduled
maintenance arrives as an `incident` (impact `maintenance`, statuses
`scheduled` / `in_progress` / `verifying` / `completed`) and is colored blue.

## Quick start

Requires Node 20+ and a Cloudflare account.

```bash
git clone https://github.com/MichalAFerber/statuspage-discord-relay.git
cd statuspage-discord-relay
npm install                      # installs wrangler (the only dependency)

# 1. Create your routing table from the example and fill in real values
cp routes.example.json routes.json   # routes.json is gitignored
#    edit routes.json: Discord webhook URLs, names, per-route tokens, mentions

# 2. Push it as a secret (paste the file contents when prompted)
npx wrangler secret put ROUTES < routes.json
#    optional global fallback token for routes without their own:
npx wrangler secret put RELAY_TOKEN

# 3. Deploy
npx wrangler deploy
```

Then for each status page, subscribe its webhook to your Worker URL with the
route key and token in the path — **not** the Discord URL:

```
https://statuspage-discord-relay.<your-subdomain>.workers.dev/proton/<that route's token>
```

On Statuspage: **Manage subscribers → Webhook**, or use the re-subscribe link in
the "Webhook problem detected" email.

## Route configuration

`ROUTES` is a JSON object mapping a route key to a destination:

```jsonc
{
  "proton": {
    "url": "https://discord.com/api/webhooks/123/abc", // required: which channel
    "name": "Proton",                                  // optional: footer label
    "token": "long-random-string-1",                   // optional: per-route secret
    "mention": "<@&123456789012345678>",               // optional: ping on high impact
    "username": "Status Relay",                         // optional: override Discord name
    "avatar": "https://example.com/icon.png"            // optional: override Discord avatar
  }
}
```

| Field      | Required | Purpose                                                                                      |
| ---------- | :------: | -------------------------------------------------------------------------------------------- |
| `url`      |    ✅     | The Discord webhook URL — this *is* the target server + channel.                              |
| `name`     |          | Shown in the embed footer (e.g. the page's name).                                            |
| `token`    |          | Per-route shared secret; overrides `RELAY_TOKEN`. Supplied in the URL **path** (`/route/<token>`, recommended), or via `?token=` / `Authorization: Bearer`. |
| `mention`  |          | Content pinged **only** on major/critical incidents and `major_outage` components. e.g. `<@&ROLE_ID>` or `@here`. |
| `username` |          | Overrides the Discord webhook's display name for this source.                                |
| `avatar`   |          | Overrides the Discord webhook's avatar (image URL).                                          |

Adding a new page is a one-line edit to the JSON plus
`wrangler secret put ROUTES` — **no code change**.

## Security

Statuspage does **not** sign subscriber webhooks (there's no HMAC on public-page
subscriptions), so anyone who discovers your Worker URL could otherwise spray
fake embeds into your channel. Guard against it with a token:

- Set a per-route `token` in `ROUTES`, and/or a global `RELAY_TOKEN`.
- The route's own `token` takes precedence; `RELAY_TOKEN` is the fallback.
- If neither is set for a route, that route relays any POST (handy for testing,
  **not** recommended for production).
- The token is compared in constant time and may be supplied three ways:
  in the URL **path** (`/route/<token>`), as `?token=…`, or as an
  `Authorization: Bearer …` header.

**Put the token in the path** (`https://<host>/<route>/<token>`). The token
gates *whether the post is relayed to Discord* — it never changes the HTTP
status. A configured route **always answers `2xx`**, even on a missing/invalid
token (the request is acknowledged but not forwarded). This is deliberate:
status pages deactivate any endpoint that returns a non-2xx, so a `403` would
get the subscription killed — the precise failure this relay exists to prevent.
Some senders also drop query strings, which would silently strip a `?token=`;
the path survives. An unauthenticated POST is logged (visible via
`wrangler tail`) so a token mismatch is easy to spot.

Keep `ROUTES`, `routes.json`, and `.dev.vars` out of git — they're already in
`.gitignore`. They contain live Discord webhook URLs, which are themselves
secrets.

## Mentions

To keep channels quiet during routine green flips, a route's `mention` is only
attached when something actually needs attention:

- **Incidents** with impact `major` or `critical` that are still active (not yet
  `resolved` / `completed`).
- **Components** transitioning to `major_outage`.

Recovery and resolution post a green embed with **no** ping.

## Color & status mapping

| State                                         | Color  |
| --------------------------------------------- | ------ |
| Operational / Resolved / Completed            | Green  |
| Minor impact / Degraded performance           | Yellow |
| Major impact / Partial outage                 | Orange |
| Critical impact / Major outage                | Red    |
| Maintenance (scheduled/in progress)           | Blue   |
| Unknown                                       | Grey   |

Status tokens are normalized (lowercased, separators stripped), so Statuspage's
`major_outage` and Instatus's `MAJOROUTAGE` map to the same thing.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in a ROUTES line (and RELAY_TOKEN if you want)
npm run dev                      # wrangler dev on http://localhost:8787
```

Send it a sample payload:

```bash
curl -X POST 'http://localhost:8787/proton/dev-token' \
  -H 'content-type: application/json' \
  -d '{"incident":{"name":"Test","status":"investigating","impact":"minor",
       "shortlink":"https://stspg.io/x",
       "incident_updates":[{"body":"Looking into it.","created_at":"2026-06-01T00:00:00Z","status":"investigating"}]}}'
```

## Testing

The suite uses **Node's built-in test runner** — zero test dependencies, nothing
to install:

```bash
npm test          # node --test
npm run test:watch
```

It covers payload transformation (Statuspage + Instatus, incidents, components,
maintenance, truncation), route resolution (JSON + KV), auth, and the
always-`2xx` / retry behavior. CI runs the same command on every push and PR.

## Scaling up with KV

Re-pasting the whole `ROUTES` blob to change one route gets old past a couple
dozen pages. Move the table to [Workers KV](https://developers.cloudflare.com/kv/):

```bash
npx wrangler kv namespace create ROUTES_KV
#   add the printed binding to wrangler.jsonc (a commented block is ready there)

npx wrangler kv key put --binding=ROUTES_KV "route:proton" \
  '{"url":"https://discord.com/api/webhooks/123/abc","name":"Proton","token":"…"}'
```

When `ROUTES_KV` is bound it takes precedence over the `ROUTES` secret, looked up
per route under the key `route:<route>` — **no code change** to switch.

## Project structure

```
src/
  index.js       Worker entry: routing, auth, always-2xx, Discord delivery + retries
  routes.js      Route resolution from the ROUTES secret or KV
  transform.js   Pure payload → Discord embed mapping (Statuspage + Instatus)
test/            Node --test suites and sample payload fixtures
routes.example.json   Template for your ROUTES secret
wrangler.jsonc        Worker config (with the KV upgrade block commented in)
```

## License

[MIT](./LICENSE)
