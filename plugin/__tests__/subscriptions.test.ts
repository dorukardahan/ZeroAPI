import { describe, expect, it } from "vitest";
import { isModelAllowedBySubscriptions } from "../inventory.js";
import { getStarterProviders } from "../onboarding.js";
import { isModelAllowedBySubscriptionProfile, resolveProviderSubscription } from "../profile.js";
import {
  getLegacyStructuralProviderId,
  getProviderCatalogEntry,
  getVersionAwareCanonicalProviderId,
  SUBSCRIPTION_CATALOG_VERSION,
} from "../subscriptions.js";

describe("subscription catalog", () => {
  it("publishes the July 2026 catalog contract version", () => {
    expect(SUBSCRIPTION_CATALOG_VERSION).toBe("1.1.0");
  });

  it("keeps fresh Qwen Cloud ids separate while migrating 1.0 Portal aliases", () => {
    for (const id of ["qwen-oauth", "qwen-portal", "qwen-cli"]) {
      expect(getProviderCatalogEntry(id)?.openclawProviderId).toBe("qwen-oauth");
    }
    expect(getProviderCatalogEntry("qwen")).toBeNull();
    expect(getProviderCatalogEntry("qwen-dashscope")).toBeNull();
    for (const id of ["qwen", "qwen-dashscope", "qwen-portal", "qwen-cli"]) {
      expect(getVersionAwareCanonicalProviderId(id, "1.0.0")).toBe("qwen-oauth");
    }
    expect(getVersionAwareCanonicalProviderId("qwen", "1.1.0")).toBe("qwen");
  });

  it("keeps non-Qwen legacy structural provider ids byte-for-byte", () => {
    for (const id of ["openai", "xai", "moonshot", "minimax-portal", "zai", " OpenAI "]) {
      expect(getLegacyStructuralProviderId(id, "1.0.0")).toBe(id);
    }
    for (const id of ["qwen", "qwen-dashscope", "qwen-portal", "qwen-cli"]) {
      expect(getLegacyStructuralProviderId(id, "1.0.0")).toBe("qwen-oauth");
    }
  });

  it("models Qwen Portal as a legacy token surface, not refreshable free OAuth", () => {
    const portal = getProviderCatalogEntry("qwen-oauth")!;
    expect(portal.authMode).toBe("api_key");
    expect(portal.tiers[0]).toMatchObject({ tierId: "free", label: "Portal token", availability: "legacy" });
    expect(portal.notes).toContain("not refreshable");
  });

  it("keeps active xAI OAuth separate from excluded xAI API billing", () => {
    expect(getProviderCatalogEntry("xai")?.status).toBe("active");
    expect(getProviderCatalogEntry("xai-api")?.status).toBe("excluded");
    expect(getStarterProviders().map((entry) => entry.providerId)).not.toContain("xai-api");
    expect(resolveProviderSubscription({ version: "1.1.0", global: { "xai-api": { enabled: true } } }, undefined, "xai-api")?.enabled).toBe(false);
    expect(isModelAllowedBySubscriptionProfile({ version: "1.1.0", global: { xai: { enabled: true } } }, undefined, "xai-api/grok-4.5")).toBe(false);
  });

  it("filters candidates by enabled subscription provider", () => {
    const profile = { version: "1.1.0", global: {
      "openai-codex": { enabled: true, tierId: "plus" },
      zai: { enabled: false, tierId: "max" },
    } };
    expect(isModelAllowedBySubscriptionProfile(profile, undefined, "openai/gpt-5.6-sol")).toBe(true);
    expect(isModelAllowedBySubscriptionProfile(profile, undefined, "zai/glm-5.2")).toBe(false);
  });

  it("fails closed for unknown providers once a ZeroAPI subscription pool exists", () => {
    const profile = { version: "1.1.0", global: { zai: { enabled: true, tierId: "max" } } };
    expect(isModelAllowedBySubscriptionProfile(profile, undefined, "unknown-provider/model")).toBe(false);
    expect(isModelAllowedBySubscriptions({ profile, inventory: undefined, agentId: undefined, modelKey: "unknown-provider/model" })).toBe(false);
    expect(isModelAllowedBySubscriptions({ profile: undefined, inventory: undefined, agentId: undefined, modelKey: "external/model" })).toBe(true);
  });

  it("keeps Anthropic and Google outside the active catalog", () => {
    expect(getProviderCatalogEntry("anthropic")).toBeNull();
    expect(getProviderCatalogEntry("google")).toBeNull();
    expect(getStarterProviders().map((entry) => entry.providerId)).not.toEqual(expect.arrayContaining(["anthropic", "google"]));
  });

  it("keeps legacy xAI and other provider aliases compatible", () => {
    expect(getProviderCatalogEntry("xai-oauth")?.openclawProviderId).toBe("xai");
    expect(getProviderCatalogEntry("kimi-coding")?.openclawProviderId).toBe("moonshot");
    expect(getProviderCatalogEntry("minimax")?.openclawProviderId).toBe("minimax-portal");
  });
});
