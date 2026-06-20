import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import worker, { timingSafeEqual, deliver } from "../src/index.js";
import { statuspageIncident } from "./fixtures.js";

const ROUTES = JSON.stringify({
  proton: { url: "https://discord.test/webhook/proton", name: "Proton", token: "secret" },
  open: { url: "https://discord.test/webhook/open", name: "Open" }, // no token
});

// Stub global fetch to capture outbound Discord calls and drain ctx.waitUntil.
function harness() {
  const calls = [];
  const pending = [];
  let responder = () => new Response("ok", { status: 200 });
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : undefined });
    return responder(url, init);
  };
  return {
    calls,
    ctx: { waitUntil: (p) => pending.push(p) },
    setResponder: (fn) => { responder = fn; },
    settle: () => Promise.allSettled(pending),
    restore: () => { globalThis.fetch = real; },
  };
}

let h;
beforeEach(() => { h = harness(); });
afterEach(() => h.restore());

const post = (path, body) =>
  new Request(`https://relay.example.dev${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("root path is a 200 health check, posts nothing", async () => {
  const res = await worker.fetch(new Request("https://relay.example.dev/"), { ROUTES }, h.ctx);
  assert.equal(res.status, 200);
  await h.settle();
  assert.equal(h.calls.length, 0);
});

test("unknown route -> 404", async () => {
  const res = await worker.fetch(post("/nope", statuspageIncident), { ROUTES }, h.ctx);
  assert.equal(res.status, 404);
});

test("valid token + incident -> 200 and forwards a Discord embed", async () => {
  const res = await worker.fetch(post("/proton?token=secret", statuspageIncident), { ROUTES }, h.ctx);
  assert.equal(res.status, 200);
  await h.settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, "https://discord.test/webhook/proton");
  assert.equal(h.calls[0].body.embeds[0].title, "Investigating: Virginia Is Down");
  assert.equal(h.calls[0].body.embeds[0].footer.text, "Proton");
});

test("missing/wrong token -> 403 and no forward", async () => {
  const res = await worker.fetch(post("/proton?token=wrong", statuspageIncident), { ROUTES }, h.ctx);
  assert.equal(res.status, 403);
  await h.settle();
  assert.equal(h.calls.length, 0);
});

test("token may be supplied via Authorization: Bearer", async () => {
  const req = new Request("https://relay.example.dev/proton", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify(statuspageIncident),
  });
  const res = await worker.fetch(req, { ROUTES }, h.ctx);
  assert.equal(res.status, 200);
  await h.settle();
  assert.equal(h.calls.length, 1);
});

test("global RELAY_TOKEN applies when a route has no token", async () => {
  const ok = await worker.fetch(post("/open?token=global", statuspageIncident), { ROUTES, RELAY_TOKEN: "global" }, h.ctx);
  assert.equal(ok.status, 200);
  const bad = await worker.fetch(post("/open?token=nope", statuspageIncident), { ROUTES, RELAY_TOKEN: "global" }, h.ctx);
  assert.equal(bad.status, 403);
});

test("unknown payload shape -> 200 but nothing forwarded", async () => {
  const res = await worker.fetch(post("/open", { ping: true }), { ROUTES }, h.ctx);
  assert.equal(res.status, 200);
  await h.settle();
  assert.equal(h.calls.length, 0);
});

test("invalid JSON body -> 200 (stay subscribed), nothing forwarded", async () => {
  const req = new Request("https://relay.example.dev/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ not json",
  });
  const res = await worker.fetch(req, { ROUTES }, h.ctx);
  assert.equal(res.status, 200);
  await h.settle();
  assert.equal(h.calls.length, 0);
});

test("non-POST to a valid route -> 200 ack", async () => {
  const res = await worker.fetch(new Request("https://relay.example.dev/open"), { ROUTES }, h.ctx);
  assert.equal(res.status, 200);
});

test("timingSafeEqual basic behavior", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual(null, "abc"), false);
  assert.equal(timingSafeEqual(undefined, undefined), false);
});

test("deliver retries on 429 then succeeds", async () => {
  let n = 0;
  h.setResponder(() => {
    n += 1;
    if (n === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
    return new Response("ok", { status: 200 });
  });
  const res = await deliver("https://discord.test/webhook/x", { content: "hi" });
  assert.equal(res.status, 200);
  assert.equal(h.calls.length, 2, "one retry after the 429");
});

test("deliver retries on 5xx and gives up returning the last response", async () => {
  h.setResponder(() => new Response("boom", { status: 500 }));
  const res = await deliver("https://discord.test/webhook/x", { content: "hi" });
  assert.equal(res.status, 500);
  assert.equal(h.calls.length, 4, "MAX_ATTEMPTS total tries");
});
