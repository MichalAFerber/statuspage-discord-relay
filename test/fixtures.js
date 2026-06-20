// Sample inbound webhook payloads used by the tests. Field names mirror the
// real Atlassian Statuspage and Instatus subscriber webhook schemas.

export const statuspageIncident = {
  meta: {
    unsubscribe: "https://example.statuspage.io/?unsubscribe=abc",
    documentation: "https://doers.statuspage.io/customer-notifications/webhooks/",
  },
  page: {
    id: "j2mfxwj97wnj",
    status_indicator: "minor",
    status_description: "Partial System Outage",
  },
  incident: {
    backfilled: false,
    created_at: "2026-05-29T15:08:51-06:00",
    impact: "minor",
    name: "Virginia Is Down",
    resolved_at: null,
    shortlink: "https://stspg.io/MY9b",
    status: "investigating",
    updated_at: "2026-05-29T16:30:35-06:00",
    id: "lbkhbwn21v5q",
    incident_updates: [
      {
        body: "We are investigating elevated error rates.",
        created_at: "2026-05-29T16:30:35-06:00",
        status: "investigating",
        id: "drfcwbn5szu0",
        incident_id: "lbkhbwn21v5q",
      },
    ],
  },
};

// Resolved critical incident: status override should force green even though
// impact is critical, and no mention should fire on recovery.
export const statuspageIncidentResolved = {
  page: { id: "j2mfxwj97wnj", status_indicator: "critical" },
  incident: {
    impact: "critical",
    name: "Database Outage",
    status: "resolved",
    shortlink: "https://stspg.io/zzzz",
    updated_at: "2026-05-29T18:00:00-06:00",
    incident_updates: [
      { body: "Older update.", created_at: "2026-05-29T16:00:00-06:00", status: "monitoring" },
      { body: "The issue is resolved.", created_at: "2026-05-29T18:00:00-06:00", status: "resolved" },
    ],
  },
};

// Active critical incident: should be red and should fire a mention.
export const statuspageIncidentCritical = {
  incident: {
    impact: "critical",
    name: "Total Outage",
    status: "identified",
    shortlink: "https://stspg.io/crit",
    updated_at: "2026-05-29T17:00:00-06:00",
    incident_updates: [
      { body: "Root cause identified.", created_at: "2026-05-29T17:00:00-06:00", status: "identified" },
    ],
  },
};

// Scheduled maintenance rides the incident shape (impact "maintenance").
export const statuspageMaintenance = {
  incident: {
    impact: "maintenance",
    name: "Network Upgrade",
    status: "scheduled",
    shortlink: "https://stspg.io/maint",
    created_at: "2026-06-01T00:00:00Z",
    incident_updates: [
      { body: "Maintenance scheduled for tonight.", created_at: "2026-06-01T00:00:00Z", status: "scheduled" },
    ],
  },
};

export const statuspageComponent = {
  page: { id: "j2mfxwj97wnj", status_indicator: "major" },
  component_update: {
    created_at: "2026-05-29T21:32:28Z",
    new_status: "major_outage",
    old_status: "operational",
    id: "k7730b5v92bv",
    component_id: "rb5wq1dczvbm",
  },
  component: {
    created_at: "2026-05-29T21:32:28Z",
    id: "rb5wq1dczvbm",
    name: "API",
    status: "major_outage",
  },
};

export const statuspageComponentRecovered = {
  component_update: {
    created_at: "2026-05-29T22:00:00Z",
    new_status: "operational",
    old_status: "major_outage",
  },
  component: { name: "API", status: "operational" },
};

// Instatus: UPPERCASE statuses, `incident.url` instead of `shortlink`.
export const instatusIncident = {
  page: { id: "abc", status_indicator: "MAJOROUTAGE", url: "https://status.example.com" },
  incident: {
    name: "Elevated API Errors",
    status: "INVESTIGATING",
    impact: "MAJOR",
    url: "https://status.example.com/incident/123",
    updated_at: "2026-06-10T12:00:00Z",
    incident_updates: [
      { body: "We are looking into it.", created_at: "2026-06-10T12:00:00Z", status: "INVESTIGATING" },
    ],
  },
};

// Instatus component flip: UPPERCASE single-word status, no old_status.
export const instatusComponent = {
  component_update: {
    created_at: "2026-06-10T12:05:00Z",
    new_status: "MAJOROUTAGE",
    component_id: "xyz",
  },
  component: { name: "Web App", status: "MAJOROUTAGE" },
};

// Shapes we don't relay (subscription test pings, unknown bodies).
export const unknownPayload = { hello: "world" };
export const emptyPayload = {};
