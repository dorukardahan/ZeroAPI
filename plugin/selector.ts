import type { ModelCapabilities, TaskCategory, RoutingRule } from "./types.js";

export function selectModel(
  category: TaskCategory,
  availableModels: Record<string, ModelCapabilities>,
  rules: Record<string, RoutingRule>,
  currentDefaultModel: string | null,
): string | null {
  const rule = rules[category] ?? rules["default"];
  if (!rule) return null;

  const candidates = [rule.primary, ...rule.fallbacks];

  for (const candidate of candidates) {
    if (candidate in availableModels) {
      if (candidate === currentDefaultModel) return null;
      return candidate;
    }
  }

  return null;
}
