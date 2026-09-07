import test from "node:test";
import assert from "node:assert/strict";
import { waitForClawHubRelease } from "../verify_clawhub_release.mjs";

const expected = "3.11.0";
const packageInfo = { name: "zeroapi", family: "code-plugin" };
const metadata = (latestVersion = expected) => ({
  package: { ...packageInfo, latestVersion, verification: { scanStatus: "clean" } },
});
const security = (scanStatus = "clean", extra = {}) => ({
  package: packageInfo,
  release: { version: expected },
  trust: {
    scanStatus, moderationState: null, blockedFromDownload: false,
    pending: scanStatus === "pending" || scanStatus === "not-run", stale: false, ...extra,
  },
});
const json = (body) => new Response(JSON.stringify(body));

function harness(responses, options = {}) {
  let clock = 0;
  const requests = [];
  const waits = [];
  return {
    requests, waits,
    run: () => waitForClawHubRelease(expected, {
      timeoutMs: 50, intervalMs: 10,
      now: () => clock,
      wait: async (ms) => { waits.push(ms); clock += ms; },
      fetchImpl: async (url, request) => {
        requests.push(url);
        assert.deepEqual(request.headers, { Accept: "application/json" });
        assert.equal(request.redirect, "error");
        const next = responses.shift();
        assert.ok(next, "unexpected extra metadata request");
        if (next instanceof Error) throw next;
        return next;
      },
      ...options,
    }),
  };
}

test("waits for initial visibility, exact scan, and latest propagation separately", async () => {
  const check = harness([
    new Response("Version not found", { status: 404 }),
    json(security("pending")), json(metadata()),
    json(security()), json(metadata("3.10.3")),
    json(security()), json(metadata()),
  ]);
  assert.deepEqual(await check.run(), { package: "zeroapi", version: expected, scanStatus: "clean", attempts: 4 });
  assert.deepEqual(check.waits, [10, 10, 10]);
  assert.equal(check.requests[0], `https://clawhub.ai/api/v1/packages/zeroapi/versions/${expected}/security`);
  assert.equal(check.requests[2], "https://clawhub.ai/api/v1/packages/zeroapi");
});

test("a clean latest package cannot conceal a different exact security release", async () => {
  const check = harness([json({ ...security(), release: { version: "3.10.3" } }), json(metadata())]);
  await assert.rejects(check.run(), /different release/);
  assert.equal(check.requests.length, 1);
  assert.deepEqual(check.waits, []);
});

for (const [label, response] of [
  ["suspicious", security("suspicious")],
  ["malicious", security("malicious")],
  ["revoked", security("clean", { moderationState: "revoked" })],
  ["quarantined", security("clean", { moderationState: "quarantined" })],
  ["blocked", security("clean", { blockedFromDownload: true })],
  ["stale", security("clean", { stale: true })],
  ["unknown scan", security("unknown")],
  ["inconsistent pending", security("clean", { pending: true })],
  ["missing trust", { ...security(), trust: null }],
]) {
  test(`fails closed without retry for ${label}`, async () => {
    const check = harness([json(response)]);
    await assert.rejects(check.run(), /trust|scan status/);
    assert.equal(check.requests.length, 1);
    assert.deepEqual(check.waits, []);
  });
}

test("a newer latest release fails instead of accepting an older clean target", async () => {
  const check = harness([json(security()), json(metadata("3.12.0"))]);
  await assert.rejects(check.run(), /latest is newer/);
  assert.deepEqual(check.waits, []);
});

test("honors documented 429 Retry-After without sending credentials", async () => {
  const check = harness([
    new Response("Rate limit exceeded", { status: 429, headers: { "Retry-After": "2" } }),
    json(security()), json(metadata()),
  ], { timeoutMs: 3000 });
  assert.equal((await check.run()).attempts, 2);
  assert.deepEqual(check.waits, [2000]);
});

for (const status of [400, 401, 403, 500]) {
  test(`does not retry terminal HTTP ${status}`, async () => {
    const check = harness([new Response("Not metadata", { status })]);
    await assert.rejects(check.run(), new RegExp(`terminal HTTP ${status}`));
    assert.deepEqual(check.waits, []);
  });
}

test("a previously visible release disappearing is terminal", async () => {
  const check = harness([
    json(security("pending")), json(metadata()),
    new Response("Version not found", { status: 404 }),
  ]);
  await assert.rejects(check.run(), /terminal HTTP 404/);
  assert.deepEqual(check.waits, [10]);
});

test("invalid JSON and transport errors are terminal", async () => {
  for (const response of [new Response("not JSON"), new Error("synthetic transport failure")]) {
    const check = harness([response]);
    await assert.rejects(check.run(), /invalid metadata JSON|request failed/);
    assert.deepEqual(check.waits, []);
  }
});

test("pending scans and missing releases time out without authorizing install", async () => {
  for (const responses of [
    Array.from({ length: 3 }, () => new Response("Version not found", { status: 404 })),
    Array.from({ length: 3 }, () => [json(security("not-run")), json(metadata())]).flat(),
  ]) {
    const check = harness(responses, { timeoutMs: 30 });
    await assert.rejects(check.run(), /timed out/);
    assert.deepEqual(check.waits, [10, 10, 10]);
  }
});
