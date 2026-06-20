// index.js
//
// Cloudflare Worker entry point. One Worker fans many status pages out to many
// Discord channels:
//
//   <status page> --POST--> https://<worker>/<route>?token=<token> --> Discord
//
// The golden rule: answer the status page with a 2xx *fast and always*. Status
// pages deactivate webhook endpoints that return non-2xx (or time out), which
// is exactly the failure that motivated this relay. So we acknowledge first and
// deliver to Discord out of band via ctx.waitUntil.

import { resolveRoute } from "./routes.js";
import { buildDiscordMessage } from "./transform.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const key = segments[0];
    // The token may ride in the path (/route/<token>) — the most reliable
    // channel, since some webhook senders don't preserve query strings. A
    // ?token= query param and an Authorization: Bearer header also work.
    const pathToken = segments[1];

    // Root: health check / browser hits.
    if (!key) {
      return text("statuspage-discord-relay: ok", 200);
    }

    const route = await resolveRoute(env, key);
    if (!route || !route.url) {
      return text(`No route configured for "${key}".`, 404);
    }

    // Authentication gates whether we FORWARD to Discord — never the HTTP status.
    // A configured route must always answer 2xx or the status page deactivates
    // the subscription (the exact failure this project exists to prevent). So a
    // missing/invalid token is acknowledged with a 2xx but simply not relayed.
    const expected = route.token ?? env.RELAY_TOKEN;
    const provided = pathToken || url.searchParams.get("token") || bearer(request);
    const authed = !expected || timingSafeEqual(provided, expected);

    // Non-POST (verification GETs, health probes): acknowledge as healthy.
    if (request.method !== "POST") {
      return text("ok", 200);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      // Not JSON (e.g. a verification ping) — still ack so we stay subscribed.
      return text("ok", 200);
    }

    if (!authed) {
      // Acknowledge so the subscription survives, but don't relay unverified
      // posts. `wrangler tail` surfaces these for debugging a token mismatch.
      console.log(`relay: unauthenticated POST to /${key} — acknowledged, not relayed`);
      return text("ok (unauthenticated; not relayed)", 200);
    }

    const message = buildDiscordMessage(payload, route);
    if (message) {
      // Deliver after responding; never let Discord latency reach the source.
      ctx.waitUntil(deliver(route.url, message));
    }

    return text("ok", 200);
  },
};

// POST the message to Discord, retrying transient failures (429 / 5xx / network)
// with a short capped backoff. Runs inside waitUntil, so it can't slow the ack.
export async function deliver(webhookUrl, message, attempt = 0) {
  const MAX_ATTEMPTS = 4;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_ATTEMPTS - 1) {
      await sleep(backoffMs(res, attempt));
      return deliver(webhookUrl, message, attempt + 1);
    }
    return res;
  } catch (err) {
    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(backoffMs(null, attempt));
      return deliver(webhookUrl, message, attempt + 1);
    }
    throw err;
  }
}

// Honor Discord's Retry-After on 429s; otherwise exponential backoff. Capped so
// a stuck delivery never lingers.
function backoffMs(res, attempt) {
  const header = res && res.headers && res.headers.get("retry-after");
  const retryAfter = header == null ? NaN : Number(header);
  if (Number.isFinite(retryAfter)) return Math.min(retryAfter * 1000, 5000);
  return Math.min(250 * 2 ** attempt, 5000);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function text(body, status) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// Extract a bearer token from the Authorization header, if present.
function bearer(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

// Constant-time string comparison so token checks don't leak length or content
// through timing. Workers expose no crypto.timingSafeEqual, hence the manual loop.
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
