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
  status: ProviderCatalogStatus;
  authMode: "oauth" | "api_key" | "mixed";
  selectionMode: "single_tier";
  tiers: SubscriptionTier[];
  benchmarkRoutingBias?: number;
  notes?: string;
};

export const SUBSCRIPTION_CATALOG_VERSION = "1.0.0";

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
    openclawProviderId: "kimi-coding",
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
    openclawProviderId: "minimax",
    status: "active",
    authMode: "mixed",
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
    label: "Alibaba (Qwen)",
    openclawProviderId: "modelstudio",
    status: "active",
    authMode: "api_key",
    selectionMode: "single_tier",
    tiers: [
      { tierId: "lite", label: "Lite", monthlyPriceUsd: 10, annualEffectiveMonthlyUsd: null, availability: "closed", routingWeight: 1, recommendedUsage: "Legacy compatibility tier only, not for new subscriptions.", notes: "Closed to new subscriptions." },
      { tierId: "pro", label: "Pro", monthlyPriceUsd: 50, annualEffectiveMonthlyUsd: null, availability: "available", routingWeight: 3, recommendedUsage: "Primary Qwen subscription tier for routing." },
    ],
    benchmarkRoutingBias: 0.95,
  },
];

export function getProviderCatalogEntry(openclawProviderId: string): ProviderCatalogEntry | null {
  return SUBSCRIPTION_CATALOG.find((entry) => entry.openclawProviderId === openclawProviderId) ?? null;
}
