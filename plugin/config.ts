import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ZeroAPIConfig } from "./types.js";

let cachedConfig: ZeroAPIConfig | null = null;
let configPath: string | null = null;

export function loadConfig(openclawDir: string): ZeroAPIConfig | null {
  const path = join(openclawDir, "zeroapi-config.json");
  configPath = path;

  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    cachedConfig = JSON.parse(raw) as ZeroAPIConfig;
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
