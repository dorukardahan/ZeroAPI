import type { ModelCapabilities } from "./types.js";

export type FilterOptions = {
  estimatedTokens: number;
  requiresVision?: boolean;
  maxTtftSeconds?: number;
  excludeProviders?: string[];
};

export type CapabilityFilterFailure =
  | "context_window"
  | "vision_required"
  | "ttft_missing"
  | "ttft_exceeds_threshold"
  | "excluded_provider";

export function getCapabilityFilterFailure(
  modelId: string,
  caps: ModelCapabilities,
  options: FilterOptions,
): CapabilityFilterFailure | null {
  if (caps.context_window < options.estimatedTokens) return "context_window";
  if (options.requiresVision && !caps.supports_vision) return "vision_required";
  if (options.maxTtftSeconds != null) {
    if (caps.ttft_seconds == null) return "ttft_missing";
    if (caps.ttft_seconds > options.maxTtftSeconds) return "ttft_exceeds_threshold";
  }
  if (options.excludeProviders?.length) {
    const provider = modelId.split("/")[0];
    if (options.excludeProviders.includes(provider)) return "excluded_provider";
  }
  return null;
}

export function filterCapableModels(
  models: Record<string, ModelCapabilities>,
  options: FilterOptions,
): Record<string, ModelCapabilities> {
  const result: Record<string, ModelCapabilities> = {};

  for (const [modelId, caps] of Object.entries(models)) {
    const failure = getCapabilityFilterFailure(modelId, caps, options);
    if (failure) continue;

    result[modelId] = caps;
  }

  return result;
}

export function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
