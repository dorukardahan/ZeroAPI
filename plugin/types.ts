export type TaskCategory = "code" | "research" | "orchestration" | "math" | "fast" | "default";

export type RiskLevel = "low" | "medium" | "high";

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

export type ZeroAPIConfig = {
  version: string;
  generated: string;
  benchmarks_date: string;
  default_model: string;
  models: Record<string, ModelCapabilities>;
  routing_rules: Record<string, RoutingRule>;
  workspace_hints: Record<string, TaskCategory[] | null>;
  keywords: Record<string, string[]>;
  high_risk_keywords: string[];
  fast_ttft_max_seconds: number;
};

export type RoutingDecision = {
  category: TaskCategory;
  model: string | null;
  provider: string | null;
  reason: string;
  risk: RiskLevel;
};
