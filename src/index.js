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
    const key = url.pathname.split("/").filter(Boolean)[0];

    // Root: health check / browser hits.
    if (!key) {
      return text("statuspage-discord-relay: ok", 200);
    }

    const route = await resolveRoute(env, key);
    if (!route || !route.url) {
      return text(`No route configured for "${key}".`, 404);
    }

    // Auth: per-route token, else the global RELAY_TOKEN. Enforced only when
    // one is configured, accepted via ?token= or an Authorization: Bearer header.
    const expected = route.token ?? env.RELAY_TOKEN;
    if (expected) {
      const provided = url.searchParams.get("token") || bearer(request);
      if (!timingSafeEqual(provided, expected)) {
        return text("Forbidden", 403);
      }
    }

    // Non-POST (subscription verification GETs, health probes): acknowledge so
    // the source treats the endpoint as healthy.
    if (request.method !== "POST") {
      return text("ok", 200);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      // Not JSON (or empty test ping) — still ack so we stay subscribed.
      return text("ignored: invalid JSON", 200);
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
