import { test } from "node:test";
import assert from "node:assert/strict";

import { buildDiscordMessage, COLORS } from "../src/transform.js";
import {
  statuspageIncident,
  statuspageIncidentResolved,
  statuspageIncidentCritical,
  statuspageMaintenance,
  statuspageComponent,
  statuspageComponentRecovered,
  instatusIncident,
  instatusComponent,
  unknownPayload,
  emptyPayload,
} from "./fixtures.js";

test("statuspage incident -> embed with status title, body, link and impact", () => {
  const msg = buildDiscordMessage(statuspageIncident, { name: "Proton" });
  const embed = msg.embeds[0];
  assert.equal(embed.title, "Investigating: Virginia Is Down");
  assert.equal(embed.description, "We are investigating elevated error rates.");
  assert.equal(embed.url, "https://stspg.io/MY9b");
  assert.equal(embed.color, COLORS.yellow); // minor impact
  assert.equal(embed.footer.text, "Proton");
  assert.deepEqual(embed.fields, [{ name: "Impact", value: "Minor", inline: true }]);
  assert.ok(embed.timestamp.endsWith("Z"), "timestamp normalized to ISO/UTC");
  assert.equal(msg.content, undefined, "no mention for a minor incident");
});

test("resolved critical incident is green and picks the newest update", () => {
  const msg = buildDiscordMessage(statuspageIncidentResolved, {
    name: "Status",
    mention: "<@&1>",
  });
  const embed = msg.embeds[0];
  assert.equal(embed.title, "Resolved: Database Outage");
  assert.equal(embed.color, COLORS.green, "resolved overrides critical -> green");
  assert.equal(embed.description, "The issue is resolved.", "newest update by created_at");
  assert.equal(msg.content, undefined, "no ping on recovery");
});

test("active critical incident is red and fires the configured mention", () => {
  const msg = buildDiscordMessage(statuspageIncidentCritical, { mention: "<@&999>" });
  const embed = msg.embeds[0];
  assert.equal(embed.color, COLORS.red);
  assert.equal(msg.content, "<@&999>");
});

test("scheduled maintenance (incident shape) is blue", () => {
  const msg = buildDiscordMessage(statuspageMaintenance);
  const embed = msg.embeds[0];
  assert.equal(embed.title, "Scheduled: Network Upgrade");
  assert.equal(embed.color, COLORS.blue);
  assert.deepEqual(embed.fields, [{ name: "Impact", value: "Maintenance", inline: true }]);
});

test("component outage -> red, describes the transition, and mentions", () => {
  const msg = buildDiscordMessage(statuspageComponent, { name: "API Status", mention: "<@&5>" });
  const embed = msg.embeds[0];
  assert.equal(embed.title, "API: Major Outage");
  assert.equal(embed.description, "Status changed from **Operational** to **Major Outage**.");
  assert.equal(embed.color, COLORS.red);
  assert.equal(msg.content, "<@&5>", "major_outage triggers mention");
});

test("component recovery -> green and no mention", () => {
  const msg = buildDiscordMessage(statuspageComponentRecovered, { mention: "<@&5>" });
  const embed = msg.embeds[0];
  assert.equal(embed.title, "API: Operational");
  assert.equal(embed.color, COLORS.green);
  assert.equal(msg.content, undefined);
});

test("instatus incident: UPPERCASE status and url field are handled", () => {
  const msg = buildDiscordMessage(instatusIncident, { mention: "<@&7>" });
  const embed = msg.embeds[0];
  assert.equal(embed.title, "Investigating: Elevated API Errors");
  assert.equal(embed.url, "https://status.example.com/incident/123", "falls back to incident.url");
  assert.equal(embed.color, COLORS.orange, "MAJOR impact -> orange");
  assert.equal(msg.content, "<@&7>", "major impact while active -> mention");
});

test("instatus component: UPPERCASE MAJOROUTAGE with no old_status", () => {
  const msg = buildDiscordMessage(instatusComponent);
  const embed = msg.embeds[0];
  assert.equal(embed.title, "Web App: Major Outage");
  assert.equal(embed.description, "Status is now **Major Outage**.");
  assert.equal(embed.color, COLORS.red);
});

test("unknown / empty / nullish payloads are not relayed", () => {
  assert.equal(buildDiscordMessage(unknownPayload), null);
  assert.equal(buildDiscordMessage(emptyPayload), null);
  assert.equal(buildDiscordMessage(null), null);
  assert.equal(buildDiscordMessage(undefined), null);
});

test("route username and avatar overrides are passed through", () => {
  const msg = buildDiscordMessage(statuspageIncident, {
    username: "Status Bot",
    avatar: "https://example.com/icon.png",
  });
  assert.equal(msg.username, "Status Bot");
  assert.equal(msg.avatar_url, "https://example.com/icon.png");
});

test("over-long fields are truncated to Discord limits", () => {
  const big = "x".repeat(5000);
  const payload = {
    incident: {
      name: big,
      status: "investigating",
      impact: "minor",
      incident_updates: [{ body: big, created_at: "2026-06-10T12:00:00Z", status: "investigating" }],
    },
  };
  const embed = buildDiscordMessage(payload).embeds[0];
  assert.ok(embed.title.length <= 256, "title within 256");
  assert.ok(embed.description.length <= 2000, "description within 2000");
  assert.ok(embed.title.endsWith("…"), "truncation marker present");
});

test("missing timestamps fall back to a valid ISO string", () => {
  const payload = {
    component_update: { new_status: "operational" },
    component: { name: "API" },
  };
  const embed = buildDiscordMessage(payload).embeds[0];
  assert.ok(!Number.isNaN(Date.parse(embed.timestamp)), "valid date");
});
