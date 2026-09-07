#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const PACKAGE_URL = "https://clawhub.ai/api/v1/packages/zeroapi";
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

class PendingMetadata extends Error {
  constructor(message, delayMs = 0) {
    super(message);
    this.delayMs = delayMs;
  }
}

function requirePackage(value) {
  if (value?.name !== "zeroapi" || value?.family !== "code-plugin") {
    throw new Error("ClawHub returned a different package identity.");
  }
}

function latestIsReady(value, expected) {
  if (value === expected) return true;
  if (value == null) return false;
  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) {
    throw new Error("ClawHub returned invalid latest-version metadata.");
  }
  const current = value.split(".").map(Number);
  const target = expected.split(".").map(Number);
  for (let i = 0; i < target.length; i++) {
    if (current[i] < target[i]) return false;
    if (current[i] > target[i]) {
      throw new Error("ClawHub latest is newer than the intended release.");
    }
  }
  return false;
}

// Official source: openclaw/clawhub eb5ff207c4db8d1a045d0163f21be15befc0dd3e,
// docs/http-api.md and convex/httpApiV1/packagesV1.ts. The public /security
// response is the native install-consumer contract, including release moderation.
// No credential or saved CLI configuration is read by this verifier.
export async function waitForClawHubRelease(expected, {
  fetchImpl = fetch,
  wait = sleep,
  now = Date.now,
  timeoutMs = 300_000,
  intervalMs = 15_000,
  onPending = () => {},
} = {}) {
  if (typeof expected !== "string" || !VERSION_PATTERN.test(expected)) {
    throw new Error("A stable ZeroAPI release version is required.");
  }
  if (!(timeoutMs > 0) || !(intervalMs > 0)) throw new Error("Invalid polling limits.");
  const deadline = now() + timeoutMs;
  const observed = new Set();
  let attempts = 0;

  async function read(url) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error("ClawHub metadata verification timed out.");
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(10_000, remaining)),
      });
    } catch {
      throw new Error("ClawHub public metadata request failed.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404 && !observed.has(url)) {
        throw new PendingMetadata("The target release is not publicly visible yet.");
      }
      if (response.status === 429) {
        // ClawHub documents these response headers as delays in seconds.
        const delay = response.headers.get("retry-after") ?? response.headers.get("ratelimit-reset");
        if (delay !== null && /^\d+$/.test(delay)) {
          throw new PendingMetadata("ClawHub requested a rate-limit delay.", Number(delay) * 1000);
        }
      }
      throw new Error(`ClawHub metadata returned terminal HTTP ${response.status}.`);
    }
    observed.add(url);
    try {
      return await response.json();
    } catch {
      throw new Error("ClawHub returned invalid metadata JSON.");
    }
  }

  while (now() < deadline) {
    attempts++;
    let delayMs = intervalMs;
    try {
      const security = await read(`${PACKAGE_URL}/versions/${expected}/security`);
      requirePackage(security?.package);
      if (security?.release?.version !== expected) {
        throw new Error("ClawHub security metadata belongs to a different release.");
      }
      const trust = security.trust;
      if (!trust || typeof trust.pending !== "boolean" || typeof trust.stale !== "boolean"
          || typeof trust.blockedFromDownload !== "boolean"
          || ![null, "approved"].includes(trust.moderationState)
          || trust.blockedFromDownload || trust.stale) {
        throw new Error("ClawHub release trust is blocked, stale, moderated, or invalid.");
      }
      if (!["clean", "pending", "not-run"].includes(trust.scanStatus)
          || trust.pending !== (trust.scanStatus !== "clean")) {
        throw new Error("ClawHub exact release has a terminal or inconsistent scan status.");
      }
      const detail = await read(PACKAGE_URL);
      requirePackage(detail?.package);
      const latestReady = latestIsReady(detail.package.latestVersion, expected);
      if (trust.scanStatus === "clean" && latestReady) {
        return { package: "zeroapi", version: expected, scanStatus: "clean", attempts };
      }
      throw new PendingMetadata(trust.pending
        ? "The exact release scan is pending."
        : "The package latest version has not reached the target release yet.");
    } catch (error) {
      if (!(error instanceof PendingMetadata)) throw error;
      delayMs = Math.max(delayMs, error.delayMs);
      onPending(error.message);
    }
    const remaining = deadline - now();
    if (remaining > 0) await wait(Math.min(delayMs, remaining));
  }
  throw new Error("ClawHub metadata verification timed out before exact clean/latest agreement.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: verify_clawhub_release.mjs <version>");
    console.log(JSON.stringify(await waitForClawHubRelease(process.argv[2], {
      onPending: (message) => console.log(message),
    })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
