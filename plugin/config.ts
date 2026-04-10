import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ZeroAPIConfig } from "./types.js";

let cachedConfig: ZeroAPIConfig | null = null;
let configPath: string | null = null;

function isValidConfig(obj: unknown): obj is ZeroAPIConfig {
  if (typeof obj !== "object" || obj === null) return false;
  const cfg = obj as Record<string, unknown>;
  const subscriptionProfileValid =
    cfg.subscription_profile === undefined ||
    (typeof cfg.subscription_profile === "object" && cfg.subscription_profile !== null);
  const visionKeywordsValid =
    cfg.vision_keywords === undefined || Array.isArray(cfg.vision_keywords);
  const riskLevelsValid =
    cfg.risk_levels === undefined ||
    (typeof cfg.risk_levels === "object" && cfg.risk_levels !== null && !Array.isArray(cfg.risk_levels));

  return (
    typeof cfg.version === "string" &&
    typeof cfg.default_model === "string" &&
    typeof cfg.models === "object" && cfg.models !== null &&
    typeof cfg.routing_rules === "object" && cfg.routing_rules !== null &&
    typeof cfg.keywords === "object" && cfg.keywords !== null &&
    Array.isArray(cfg.high_risk_keywords) &&
    typeof cfg.fast_ttft_max_seconds === "number" &&
    visionKeywordsValid &&
    riskLevelsValid &&
    subscriptionProfileValid
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
    cachedConfig = parsed;
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
