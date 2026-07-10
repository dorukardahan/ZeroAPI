export type SubscriptionTierAvailability = "available" | "legacy" | "closed" | "contact_sales";
export type ProviderCatalogStatus = "active" | "excluded" | "experimental";

export type SubscriptionTier = {
  tierId: string;
  label: string;
  monthlyPriceUsd: number | null;
  annualEffectiveMonthlyUsd: number | null;
  availability: SubscriptionTierAvailability;
  routingWeight: number;
  recommendedUsage: string;
  notes?: string;
};

export type ProviderCatalogEntry = {
  providerId: string;
  label: string;
  openclawProviderId: string;
  openclawProviderAliases?: string[];
  status: ProviderCatalogStatus;
  authMode: "oauth" | "api_key" | "mixed";
  selectionMode: "single_tier";
  tiers: SubscriptionTier[];
  benchmarkRoutingBias?: number;
  notes?: string;
};

export const SUBSCRIPTION_CATALOG_VERSION = "1.1.0";

export const SUBSCRIPTION_CATALOG: ProviderCatalogEntry[] = [
  {
    providerId: "openai",
    label: "OpenAI",
    openclawProviderId: "openai-codex",
    status: "active",
    authMode: "oauth",
    selectionMode: "single_tier",
    tiers: [
      {
        tierId: "plus",
        label: "Plus",
        monthlyPriceUsd: 20,
        annualEffectiveMonthlyUsd: null,
        availability: "available",
        routingWeight: 1,
        recommendedUsage: "Good default subscription tier with tighter usage headroom.",
      },
      {
        tierId: "pro",
        label: "Pro",
        monthlyPriceUsd: 200,
        annualEffectiveMonthlyUsd: null,
        availability: "available",
        routingWeight: 3,
        recommendedUsage: "Highest practical OpenAI subscription tier for heavy premium routing.",
      },
    ],
    benchmarkRoutingBias: 0.7,
    notes: "OpenAI tiers should be preferred only when benchmark advantage justifies subscription pressure.",
  },
  {
    providerId: "kimi",
    label: "Kimi",
    openclawProviderId: "moonshot",
    openclawProviderAliases: ["kimi", "kimi-coding"],
    status: "active",
    authMode: "api_key",
    selectionMode: "single_tier",
    tiers: [
      { tierId: "moderato", label: "Moderato", monthlyPriceUsd: 19, annualEffectiveMonthlyUsd: null, availability: "available", routingWeight: 1, recommendedUsage: "Entry subscription for lighter Kimi usage." },
      { tierId: "allegretto", label: "Allegretto", monthlyPriceUsd: 39, annualEffectiveMonthlyUsd: null, availability: "available", routingWeight: 2, recommendedUsage: "Mid-tier Kimi subscription for broader routing eligibility." },
      { tierId: "allegro", label: "Allegro", monthlyPriceUsd: 99, annualEffectiveMonthlyUsd: null, availability: "available", routingWeight: 3, recommendedUsage: "High-tier Kimi subscription for frequent use." },
      { tierId: "vivace", label: "Vivace", monthlyPriceUsd: 199, annualEffectiveMonthlyUsd: null, availability: "available", routingWeight: 4, recommendedUsage: "Top-tier Kimi subscription for aggressive routing allowance." },
    ],
    benchmarkRoutingBias: 1.1,
  },
  {
    providerId: "zai",
    label: "Z AI (GLM)",
    openclawProviderId: "zai",
    status: "active",
    authMode: "api_key",
    selectionMode: "single_tier",
    tiers: [
      { tierId: "lite", label: "Lite", monthlyPriceUsd: 10, annualEffectiveMonthlyUsd: null, availability: "available", routingWeight: 1, recommendedUsage: "Cost-efficient GLM access for lighter daily routing." },
      { tierId: "pro", label: "Pro", monthlyPriceUsd: 30, annualEffectiveMonthlyUsd: null, availability: "available", routingWeight: 2, recommendedUsage: "Balanced GLM tier for regular routing." },
      { tierId: "max", label: "Max", monthlyPriceUsd: 80, annualEffectiveMonthlyUsd: null, availability: "available", routingWeight: 4, recommendedUsage: "Preferred GLM-first tier for heavy default routing." },
    ],
    benchmarkRoutingBias: 1.25,
  },
  {
    providerId: "minimax",
    label: "MiniMax",
    openclawProviderId: "minimax-portal",
    openclawProviderAliases: ["minimax"],
    status: "active",
    authMode: "oauth",
    selectionMode: "single_tier",
    tiers: [
      { tierId: "starter", label: "Starter", monthlyPriceUsd: 10, annualEffectiveMonthlyUsd: null, availability: "available", routingWeight: 1, recommendedUsage: "Entry MiniMax access." },
      { tierId: "plus", label: "Plus", monthlyPriceUsd: 20, annualEffectiveMonthlyUsd: null, availability: "available", routingWeight: 2, recommendedUsage: "General MiniMax routing tier." },
      { tierId: "max", label: "Max", monthlyPriceUsd: 50, annualEffectiveMonthlyUsd: null, availability: "available", routingWeight: 3, recommendedUsage: "High-capacity MiniMax routing tier." },
      { tierId: "ultra_hs", label: "Ultra-HS", monthlyPriceUsd: 150, annualEffectiveMonthlyUsd: null, availability: "contact_sales", routingWeight: 4, recommendedUsage: "High-scale MiniMax plan when available." },
    ],
    benchmarkRoutingBias: 1,
  },
  {
    providerId: "alibaba",
    label: "Qwen Portal",
    openclawProviderId: "qwen-oauth",
    openclawProviderAliases: ["qwen-portal", "qwen-cli"],
    status: "active",
    authMode: "api_key",
    selectionMode: "single_tier",
    tiers: [
      { tierId: "free", label: "Portal token", monthlyPriceUsd: 0, annualEffectiveMonthlyUsd: 0, availability: "legacy", routingWeight: 1, recommendedUsage: "Existing Qwen Portal token and legacy OAuth migration surface; re-onboard with a current token when needed." },
    ],
    benchmarkRoutingBias: 0.95,
    notes: "Portal uses canonical qwen-oauth with qwen-portal and qwen-cli legacy aliases. Legacy OAuth profiles are not refreshable; re-run onboarding with a current Portal token. Qwen Cloud and Coding Plan remain separate providers.",
  },
  {
    providerId: "xai",
    label: "xAI Grok OAuth",
    openclawProviderId: "xai",
    openclawProviderAliases: ["xai-oauth", "grok-oauth", "x-ai-oauth", "xai-grok-oauth", "supergrok"],
    status: "active",
    authMode: "mixed",
    selectionMode: "single_tier",
    tiers: [
      {
        tierId: "supergrok",
        label: "SuperGrok",
        monthlyPriceUsd: null,
        annualEffectiveMonthlyUsd: null,
        availability: "available",
        routingWeight: 2,
        recommendedUsage: "Standalone SuperGrok subscription routed through Hermes xAI OAuth.",
        notes: "This is the browser OAuth path. The plain xAI API-key provider is not treated as subscription-covered.",
      },
    ],
    benchmarkRoutingBias: 0.85,
    notes: "Use `openclaw models auth login --provider xai --method oauth` or onboarding choice `xai-oauth` on current OpenClaw. Hermes legacy configs may still use `xai-oauth` as an alias. Only enable this provider for subscription-backed OAuth accounts; plain xAI API-key usage should stay outside ZeroAPI subscription routing.",
  },
  {
    providerId: "xai-api",
    label: "xAI API",
    openclawProviderId: "xai",
    status: "excluded",
    authMode: "api_key",
    selectionMode: "single_tier",
    tiers: [],
    notes: "Explicit API-key route. Not treated as subscription-covered SuperGrok OAuth.",
  },
];

export function getProviderCatalogEntry(openclawProviderId: string): ProviderCatalogEntry | null {
  const normalized = openclawProviderId.trim().toLowerCase();
  return SUBSCRIPTION_CATALOG.find((entry) =>
    entry.providerId === normalized ||
    entry.openclawProviderId === normalized ||
    entry.openclawProviderAliases?.includes(normalized),
  ) ?? null;
}

export function getCanonicalOpenClawProviderId(providerId: string): string {
  return getProviderCatalogEntry(providerId)?.openclawProviderId ?? providerId;
}

const LEGACY_QWEN_PORTAL_IDS = new Set(["qwen", "qwen-dashscope", "qwen-portal", "qwen-cli"]);

export function isLegacySubscriptionCatalogVersion(version: string | undefined): boolean {
  return typeof version === "string" && /^1\.0(?:\.|$)/.test(version);
}

/** Rewrite only provider ids whose meaning changed in the 1.0 Qwen Portal split. */
export function getLegacyStructuralProviderId(providerId: string, version?: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (isLegacySubscriptionCatalogVersion(version) && LEGACY_QWEN_PORTAL_IDS.has(normalized)) {
    return "qwen-oauth";
  }
  return providerId;
}

export function getVersionAwareCanonicalProviderId(providerId: string, version?: string): string {
  return getCanonicalOpenClawProviderId(getLegacyStructuralProviderId(providerId, version));
}
