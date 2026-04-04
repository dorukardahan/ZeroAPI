import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { RoutingDecision } from "./types.js";

let logPath: string | null = null;

export function initLogger(openclawDir: string): void {
  const logsDir = join(openclawDir, "logs");
  try {
    mkdirSync(logsDir, { recursive: true });
  } catch {
    // dir may exist
  }
  logPath = join(logsDir, "zeroapi-routing.log");
}

export function logRouting(
  agentId: string | undefined,
  decision: RoutingDecision,
): void {
  if (!logPath) return;

  const ts = new Date().toISOString();
  const line = `${ts} agent=${agentId ?? "unknown"} category=${decision.category} model=${decision.model ?? "default"} risk=${decision.risk} reason=${decision.reason}\n`;

  try {
    appendFileSync(logPath, line);
  } catch {
    // logging failure should never break routing
  }
}
