import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import type { SubscriptionInventory } from "../types.js";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(pluginRoot, "..");
const examplePath = join(repoRoot, "examples", "grok-supergrok.json");

/**
 * Issue #98 regression coverage: the committed SuperGrok example must satisfy
 * the same config contract the runtime consumes (loadConfig validation), and
 * its canonical xAI route refs must survive the subscription-weighted router
 * with subscription inventory attached. Also pins the eligibility boundary the
 * example documents: a plain xAI API-key provider entry is not SuperGrok
 * subscription coverage.
 */
describe("grok-supergrok example", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "zeroapi-grok-example-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("loads through the runtime config consumer, not just as standalone JSON", async () => {
    copyFileSync(examplePath, join(testDir, "zeroapi-config.json"));
    const { loadConfig, getConfigLoadStatus } = await import("../config.js");
    const config = loadConfig(testDir);
    expect(config).not.toBeNull();
    expect(getConfigLoadStatus()).toBe("ok");
  });

  it("declares the SuperGrok subscription surface with canonical xAI route refs only", () => {
    const example = JSON.parse(readFileSync(examplePath, "utf-8"));
    expect(example.subscription_profile?.global?.xai).toEqual({ enabled: true, tierId: "supergrok" });
    expect(example.external_model_policy).toBe("stay");
    expect(example.routing_mode).toBe("balanced");
    const routeRefs = Object.keys(example.models);
    expect(routeRefs.length).toBeGreaterThan(0);
    for (const routeRef of routeRefs) {
      expect(routeRef.startsWith("xai/")).toBe(true);
    }
    // Canonical Grok 4.7 starter refs must all be present.
    for (const starterRef of ["xai/grok-4.7", "xai/grok-4.6", "xai/grok-4.5", "xai/grok-build-0.1", "xai/grok-4.3"]) {
      expect(routeRefs).toContain(starterRef);
    }
    // The excluded API-key provider id must never appear as a route ref.
    expect(routeRefs).not.toContain("xai-api/grok-4.5");
  });

  it("keeps every routing rule inside the example's own model set", () => {
    const example = JSON.parse(readFileSync(examplePath, "utf-8"));
    const routeRefs = new Set(Object.keys(example.models));
    expect(routeRefs.has(example.default_model)).toBe(true);
    for (const rule of Object.values<any>(example.routing_rules)) {
      expect(routeRefs.has(rule.primary)).toBe(true);
      for (const fallback of rule.fallbacks ?? []) {
        expect(routeRefs.has(fallback)).toBe(true);
      }
    }
  });

  it("routes through the subscription-weighted router with SuperGrok subscription inventory", async () => {
    copyFileSync(examplePath, join(testDir, "zeroapi-config.json"));
    const { loadConfig } = await import("../config.js");
    const example = loadConfig(testDir)!;
    expect(example).not.toBeNull();
    const { getSubscriptionWeightedCandidates } = await import("../router.js");
    const inventory: SubscriptionInventory = {
      version: "1.2.0",
      accounts: {
        "xai-supergrok": {
          provider: "xai",
          tierId: "supergrok",
          authProfile: "xai:supergrok",
          usagePriority: 1,
          intendedUse: ["code", "research", "default"],
        },
      },
    };
    for (const category of ["code", "research", "default"] as const) {
      const candidates = getSubscriptionWeightedCandidates(
        category,
        example.models,
        example.routing_rules,
        example.subscription_profile,
        inventory,
        undefined,
        example.routing_mode ?? "balanced",
      );
      expect(candidates.length).toBeGreaterThan(0);
      for (const candidate of candidates) {
        expect(candidate.startsWith("xai/")).toBe(true);
      }
    }
  });

  it("does not treat xAI API-key entries as SuperGrok subscription coverage", async () => {
    const { isModelAllowedBySubscriptionProfile } = await import("../profile.js");
    const example = JSON.parse(readFileSync(examplePath, "utf-8"));

    // The committed SuperGrok profile does not cover xai-api/* models.
    expect(isModelAllowedBySubscriptionProfile(example.subscription_profile, undefined, "xai-api/grok-4.5")).toBe(false);

    // An API-key-only profile (no browser OAuth subscription) is not the
    // SuperGrok surface either: it must not enable the xai subscription routes.
    const apiKeyOnlyProfile = {
      version: "1.2.0",
      global: { "xai-api": { enabled: true } },
    };
    expect(isModelAllowedBySubscriptionProfile(apiKeyOnlyProfile, undefined, "xai/grok-4.6")).toBe(false);
  });

  it("stays byte-identical to regenerating it from the onboarding starter", async () => {
    const { buildStarterConfig } = await import("../onboarding.js");
    const committed = readFileSync(examplePath, "utf-8");
    const regenerated = buildStarterConfig({ providers: [{ providerId: "xai", tierId: "supergrok" }] });
    regenerated.generated = `${regenerated.benchmarks_date}T00:00:00.000Z`;
    expect(`${JSON.stringify(regenerated, null, 2)}\n`).toBe(committed);
  });

  it("is rejected by the starter builder when SuperGrok tier eligibility is missing", async () => {
    const { buildStarterConfig } = await import("../onboarding.js");
    // xai-api is excluded from starter routing entirely, so no tier of it can
    // back a SuperGrok-style example.
    expect(() =>
      buildStarterConfig({ providers: [{ providerId: "xai-api" as any, tierId: "supergrok" as any }] }),
    ).toThrow(/not eligible for subscription starter routing/);
  });

  it("keeps the committed example parseable by the config validator even with disabled-providers env set", async () => {
    copyFileSync(examplePath, join(testDir, "zeroapi-config.json"));
    vi.stubEnv("ZEROAPI_DISABLED_PROVIDERS", "moonshot");
    const { loadConfig } = await import("../config.js");
    const config = loadConfig(testDir);
    expect(config).not.toBeNull();
    expect(config?.models["xai/grok-4.7"]).toBeDefined();
  });
});
