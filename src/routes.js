// routes.js
//
// Route resolution. A "route" is the first path segment of the inbound URL
// (e.g. /proton) mapped to a Discord destination:
//
//   {
//     "url":      "https://discord.com/api/webhooks/...",  // required: the channel
//     "name":     "Proton",                                 // optional: footer label
//     "token":    "per-route-secret",                       // optional: overrides RELAY_TOKEN
//     "mention":  "<@&1234567890>",                         // optional: ping on high impact
//     "username": "Status Bot",                             // optional: Discord override
//     "avatar":   "https://.../icon.png"                    // optional: Discord override
//   }
//
// Two backing stores are supported:
//   - ROUTES      a JSON-string secret holding the whole { key: route } map.
//   - ROUTES_KV   a KV namespace with one entry per route under key `route:<key>`.
//
// KV wins when bound (it's the live, scalable store); otherwise we fall back to
// the JSON secret. This lets a deployment start on ROUTES and migrate to KV
// later with no code change.

/**
 * Resolve a route key to its config object.
 *
 * @param {object} env  Worker bindings (ROUTES string and/or ROUTES_KV namespace).
 * @param {string} key  First path segment of the request URL.
 * @returns {Promise<object|null>}  Route config, or null if not found.
 */
export async function resolveRoute(env, key) {
  if (!key) return null;

  // KV first, if a namespace is bound.
  if (env.ROUTES_KV && typeof env.ROUTES_KV.get === "function") {
    const fromKv = await env.ROUTES_KV.get(`route:${key}`, "json");
    if (fromKv) return fromKv;
  }

  // Fall back to the ROUTES JSON secret.
  if (env.ROUTES) {
    const table = parseRoutes(env.ROUTES);
    if (table && Object.prototype.hasOwnProperty.call(table, key)) {
      return table[key];
    }
  }

  return null;
}

// Parse the ROUTES secret into an object, tolerating bad config by returning null.
function parseRoutes(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export const _internal = { parseRoutes };
