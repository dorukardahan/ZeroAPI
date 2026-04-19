import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ZeroAPIConfig } from "./types.js";

let cachedConfig: ZeroAPIConfig | null = null;
let configPath: string | null = null;

function isValidConfig(obj: unknown): obj is ZeroAPIConfig {
  if (typeof obj !== "object" || obj === null) return false;
  const cfg = obj as Record<string, unknown>;
  const routingModeValid =
    cfg.routing_mode === undefined ||
    cfg.routing_mode === "balanced";
  const routingModifierValid =
    cfg.routing_modifier === undefined ||
    cfg.routing_modifier === "coding-aware" ||
    cfg.routing_modifier === "research-aware" ||
    cfg.routing_modifier === "speed-aware";
  const externalModelPolicyValid =
    cfg.external_model_policy === undefined ||
    cfg.external_model_policy === "stay" ||
    cfg.external_model_policy === "allow";
  const subscriptionProfileValid =
    cfg.subscription_profile === undefined ||
    (
      typeof cfg.subscription_profile === "object" &&
      cfg.subscription_profile !== null &&
      !Array.isArray(cfg.subscription_profile)
    );
  const subscriptionInventoryValid =
    cfg.subscription_inventory === undefined ||
    (
      typeof cfg.subscription_inventory === "object" &&
      cfg.subscription_inventory !== null &&
      !Array.isArray(cfg.subscription_inventory)
    );
  const visionKeywordsValid =
    cfg.vision_keywords === undefined || Array.isArray(cfg.vision_keywords);
  const workspaceHintsValid =
    cfg.workspace_hints === undefined ||
    (typeof cfg.workspace_hints === "object" && cfg.workspace_hints !== null && !Array.isArray(cfg.workspace_hints));
  const riskLevelsValid =
    cfg.risk_levels === undefined ||
    (typeof cfg.risk_levels === "object" && cfg.risk_levels !== null && !Array.isArray(cfg.risk_levels));

  return (
    typeof cfg.version === "string" &&
    typeof cfg.default_model === "string" &&
    routingModeValid &&
    routingModifierValid &&
    externalModelPolicyValid &&
    typeof cfg.models === "object" && cfg.models !== null &&
    typeof cfg.routing_rules === "object" && cfg.routing_rules !== null &&
    typeof cfg.keywords === "object" && cfg.keywords !== null &&
    Array.isArray(cfg.high_risk_keywords) &&
    typeof cfg.fast_ttft_max_seconds === "number" &&
    workspaceHintsValid &&
    visionKeywordsValid &&
    riskLevelsValid &&
    subscriptionProfileValid &&
    subscriptionInventoryValid
  );
}

export function loadConfig(openclawDir: string): ZeroAPIConfig | null {
  const path = join(openclawDir, "zeroapi-config.json");
  configPath = path;

  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isValidConfig(parsed)) {
      return null;
    }
    cachedConfig = {
      ...parsed,
      routing_mode: parsed.routing_mode ?? "balanced",
      external_model_policy: parsed.external_model_policy ?? "stay",
      workspace_hints: parsed.workspace_hints ?? {},
    };
    return cachedConfig;
  } catch {
    return null;
  }
}

export function getConfig(): ZeroAPIConfig | null {
  return cachedConfig;
}

export function getConfigPath(): string | null {
  return configPath;
}
