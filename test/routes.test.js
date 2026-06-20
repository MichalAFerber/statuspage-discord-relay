import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveRoute } from "../src/routes.js";

const ROUTES = JSON.stringify({
  proton: { url: "https://discord.com/api/webhooks/1/a", name: "Proton", token: "t1" },
  github: { url: "https://discord.com/api/webhooks/2/b", name: "GitHub" },
});

test("resolves a known key from the ROUTES JSON secret", async () => {
  const route = await resolveRoute({ ROUTES }, "proton");
  assert.equal(route.name, "Proton");
  assert.equal(route.token, "t1");
});

test("returns null for unknown keys and empty key", async () => {
  assert.equal(await resolveRoute({ ROUTES }, "nope"), null);
  assert.equal(await resolveRoute({ ROUTES }, ""), null);
  assert.equal(await resolveRoute({ ROUTES }, undefined), null);
});

test("tolerates malformed ROUTES without throwing", async () => {
  assert.equal(await resolveRoute({ ROUTES: "{not json" }, "proton"), null);
  assert.equal(await resolveRoute({}, "proton"), null);
});

test("KV namespace takes precedence over the JSON secret", async () => {
  const env = {
    ROUTES,
    ROUTES_KV: {
      async get(key, type) {
        assert.equal(key, "route:proton");
        assert.equal(type, "json");
        return { url: "https://discord.com/api/webhooks/kv/x", name: "From KV" };
      },
    },
  };
  const route = await resolveRoute(env, "proton");
  assert.equal(route.name, "From KV");
});

test("falls back to JSON when KV has no entry", async () => {
  const env = {
    ROUTES,
    ROUTES_KV: { async get() { return null; } },
  };
  const route = await resolveRoute(env, "github");
  assert.equal(route.name, "GitHub");
});
