import { describe, expect, it } from "vitest";
import { getProviderCatalogEntry, SUBSCRIPTION_CATALOG_VERSION } from "../subscriptions.js";

describe("subscription catalog", () => {
  it("publishes the July 2026 catalog contract version", () => {
    expect(SUBSCRIPTION_CATALOG_VERSION).toBe("1.1.0");
  });

  it("canonicalizes current and legacy Qwen Portal ids without conflating Qwen Cloud", () => {
    for (const id of ["qwen-oauth", "qwen-portal", "qwen-cli"]) {
      expect(getProviderCatalogEntry(id)?.openclawProviderId).toBe("qwen-oauth");
    }
    expect(getProviderCatalogEntry("qwen")).toBeNull();
    expect(getProviderCatalogEntry("qwen-dashscope")).toBeNull();
  });

  it("keeps legacy xAI and other provider aliases compatible", () => {
    expect(getProviderCatalogEntry("xai-oauth")?.openclawProviderId).toBe("xai");
    expect(getProviderCatalogEntry("kimi-coding")?.openclawProviderId).toBe("moonshot");
    expect(getProviderCatalogEntry("minimax")?.openclawProviderId).toBe("minimax-portal");
  });
});
