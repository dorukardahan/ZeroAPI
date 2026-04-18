import type { ModelCapabilities } from "./types.js";

export type FilterOptions = {
  estimatedTokens: number;
  requiresVision?: boolean;
  maxTtftSeconds?: number;
  excludeProviders?: string[];
};

export function filterCapableModels(
  models: Record<string, ModelCapabilities>,
  options: FilterOptions,
): Record<string, ModelCapabilities> {
  const result: Record<string, ModelCapabilities> = {};

  for (const [modelId, caps] of Object.entries(models)) {
    if (caps.context_window < options.estimatedTokens) continue;
    if (options.requiresVision && !caps.supports_vision) continue;
    if (options.maxTtftSeconds != null) {
      if (caps.ttft_seconds == null) continue;
      if (caps.ttft_seconds > options.maxTtftSeconds) continue;
    }
    if (options.excludeProviders?.length) {
      const provider = modelId.split("/")[0];
      if (options.excludeProviders.includes(provider)) continue;
    }

    result[modelId] = caps;
  }

  return result;
}

export function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
