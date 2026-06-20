// transform.js
//
// Pure functions that turn a status-page webhook payload into a Discord
// webhook message. Kept free of any runtime/IO so they can be unit-tested
// with plain Node.
//
// Supported inbound schemas (both are handled by one code path):
//   - Atlassian Statuspage : lowercase snake_case statuses, `incident.shortlink`
//   - Instatus             : UPPERCASE statuses, `incident.url`
//
// Scheduled maintenance arrives as an `incident` (impact "maintenance",
// statuses scheduled / in_progress / verifying / completed), so it needs no
// branch of its own.

/** Discord embed colors (decimal-encoded RGB). */
export const COLORS = {
  green: 0x2ecc71, // operational / resolved / good news
  yellow: 0xf1c40f, // minor degradation
  orange: 0xe67e22, // major / partial outage
  red: 0xe74c3c, // critical / major outage
  blue: 0x3498db, // maintenance
  grey: 0x95a5a6, // unknown
};

// Normalize a status / impact token to a lookup key: lowercase, no separators.
// "major_outage" -> "majoroutage", "MAJOROUTAGE" -> "majoroutage".
const norm = (s) =>
  (s == null ? "" : String(s)).toLowerCase().replace(/[\s_-]+/g, "");

// Component statuses (Statuspage snake_case + Instatus UPPERCASE collapse here).
const COMPONENT_STATUS = {
  operational: { color: COLORS.green, label: "Operational" },
  degradedperformance: { color: COLORS.yellow, label: "Degraded Performance" },
  partialoutage: { color: COLORS.orange, label: "Partial Outage" },
  majoroutage: { color: COLORS.red, label: "Major Outage" },
  undermaintenance: { color: COLORS.blue, label: "Under Maintenance" },
  maintenance: { color: COLORS.blue, label: "Maintenance" },
};

// Incident impact -> base color.
const IMPACT = {
  none: { color: COLORS.green, label: "None" },
  maintenance: { color: COLORS.blue, label: "Maintenance" },
  minor: { color: COLORS.yellow, label: "Minor" },
  major: { color: COLORS.orange, label: "Major" },
  critical: { color: COLORS.red, label: "Critical" },
};

// Incident status -> display label and an optional color override that wins
// over impact (e.g. a resolved critical incident should be green, not red).
const INCIDENT_STATUS = {
  investigating: { label: "Investigating" },
  identified: { label: "Identified" },
  monitoring: { label: "Monitoring" },
  resolved: { label: "Resolved", color: COLORS.green },
  postmortem: { label: "Postmortem", color: COLORS.green },
  scheduled: { label: "Scheduled", color: COLORS.blue },
  inprogress: { label: "In Progress", color: COLORS.blue },
  verifying: { label: "Verifying", color: COLORS.blue },
  completed: { label: "Completed", color: COLORS.green },
};

// Impacts/statuses that earn a role mention (only while still active — we stay
// quiet on recovery, which is good news and needs no ping).
const HIGH_IMPACT = new Set(["major", "critical"]);
const RESOLVED_STATUSES = new Set(["resolved", "completed", "postmortem"]);
const HIGH_COMPONENT = new Set(["majoroutage"]);

// Title-case fallback for tokens not in a registry: "some_new_state" -> "Some New State".
const titleCase = (s) =>
  (s == null ? "" : String(s))
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

// Truncate to a max length, leaving room for an ellipsis. Discord rejects
// embeds whose fields exceed documented limits, so every user-controlled
// string passes through here.
const truncate = (s, max) => {
  s = s == null ? "" : String(s);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

// Coerce a date string into a Discord-acceptable ISO 8601 timestamp, falling
// back to "now" for missing/garbage values so a bad date never voids the embed.
const toIso = (s) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
};

// Newest update from an incident_updates array, by created_at (defensive about
// ordering and missing timestamps).
const latestUpdate = (updates) => {
  if (!Array.isArray(updates) || updates.length === 0) return null;
  return [...updates].sort(
    (a, b) => (Date.parse(b?.created_at) || 0) - (Date.parse(a?.created_at) || 0),
  )[0];
};

/**
 * Build a Discord webhook message from a status-page payload.
 *
 * @param {any} payload  Parsed inbound JSON (Statuspage / Instatus shape).
 * @param {object} [route]  Matched route config: { name, mention, username, avatar }.
 * @returns {object|null}  Discord webhook body, or null for shapes we don't relay
 *                         (caller still answers 2xx so the subscription survives).
 */
export function buildDiscordMessage(payload, route = {}) {
  const source = route.name || "Status";
  let embed = null;
  let high = false;

  if (payload && payload.incident) {
    const inc = payload.incident;
    const update = latestUpdate(inc.incident_updates);
    const impactKey = norm(inc.impact);
    const statusKey = norm(inc.status);
    const impact = IMPACT[impactKey];
    const status = INCIDENT_STATUS[statusKey];

    const color = status?.color ?? impact?.color ?? COLORS.grey;
    const statusLabel = status?.label || titleCase(inc.status) || "Update";

    high = HIGH_IMPACT.has(impactKey) && !RESOLVED_STATUSES.has(statusKey);

    embed = {
      title: truncate(`${statusLabel}: ${inc.name || "Incident"}`, 256),
      description: truncate(update?.body, 2000) || undefined,
      url: inc.shortlink || inc.url || undefined,
      color,
      timestamp: toIso(update?.created_at || inc.updated_at || inc.created_at),
    };
    if (impact) {
      embed.fields = [{ name: "Impact", value: impact.label, inline: true }];
    }
  } else if (payload && payload.component_update && payload.component) {
    const cu = payload.component_update;
    const newKey = norm(cu.new_status);
    const oldKey = norm(cu.old_status);
    const meta = COMPONENT_STATUS[newKey];

    high = HIGH_COMPONENT.has(newKey);

    const newLabel = meta?.label || titleCase(cu.new_status) || "Updated";
    const oldLabel = COMPONENT_STATUS[oldKey]?.label || titleCase(cu.old_status);

    embed = {
      title: truncate(`${payload.component.name || "Component"}: ${newLabel}`, 256),
      description: oldLabel
        ? `Status changed from **${oldLabel}** to **${newLabel}**.`
        : `Status is now **${newLabel}**.`,
      color: meta?.color ?? COLORS.grey,
      timestamp: toIso(cu.created_at),
    };
  } else {
    return null; // Unknown / test-ping shape — skip, but caller still returns 200.
  }

  embed.footer = { text: truncate(source, 2048) };

  const message = { embeds: [embed] };
  if (route.username) message.username = truncate(route.username, 80);
  if (route.avatar) message.avatar_url = route.avatar;
  if (high && route.mention) message.content = truncate(route.mention, 2000);
  return message;
}

// Exported for focused unit tests.
export const _internal = { norm, titleCase, truncate, toIso, latestUpdate };
