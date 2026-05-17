export type TaskCategory = "code" | "research" | "orchestration" | "math" | "fast" | "default";

export type RiskLevel = "low" | "medium" | "high";

export type RoutingMode = "balanced";
export type RoutingModifier = "coding-aware" | "research-aware" | "speed-aware";

export type ModelCapabilities = {
  context_window: number;
  supports_vision: boolean;
  speed_tps: number | null;
  ttft_seconds: number | null;
  benchmarks: Record<string, number>;
};

export type RoutingRule = {
  primary: string;
  fallbacks: string[];
};

export type ProviderSubscriptionSelection = {
  enabled?: boolean;
  tierId?: string | null;
};

export type SubscriptionProfile = {
  version: string;
  global: Record<string, ProviderSubscriptionSelection>;
  agentOverrides?: Record<string, Record<string, ProviderSubscriptionSelection>>;
};

export type SubscriptionAccount = {
  provider: string;
  tierId?: string | null;
  enabled?: boolean;
  authProfile?: string | null;
  usagePriority?: number;
  intendedUse?: TaskCategory[];
};

export type SubscriptionInventory = {
  version: string;
  accounts: Record<string, SubscriptionAccount>;
};

export type ZeroAPIConfig = {
  version: string;
  generated: string;
  benchmarks_date: string;
  default_model: string;
  routing_mode?: RoutingMode;
  routing_modifier?: RoutingModifier;
  external_model_policy?: "stay" | "allow";
  models: Record<string, ModelCapabilities>;
  routing_rules: Record<string, RoutingRule>;
  workspace_hints: Record<string, TaskCategory[] | null>;
  keywords: Record<string, string[]>;
  high_risk_keywords: string[];
  fast_ttft_max_seconds: number;
  vision_keywords?: string[];
  disabled_providers?: string[];
  risk_levels?: Partial<Record<TaskCategory, RiskLevel>>;
  subscription_catalog_version?: string;
  subscription_profile?: SubscriptionProfile;
  subscription_inventory?: SubscriptionInventory;
  continuation_keywords?: string[];
  continuation_route_categories?: TaskCategory[];
  channel_advisories_enabled?: boolean;
};

export type RoutingDecision = {
  category: TaskCategory;
  model: string | null;
  provider: string | null;
  reason: string;
  risk: RiskLevel;
};

export type ConversationMessage = {
  role?: string;
  content?: unknown;
};
