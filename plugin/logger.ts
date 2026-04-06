import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { RoutingDecision } from "./types.js";

let logPath: string | null = null;

type LogEntry = {
  agentId?: string;
  category: string;
  model?: string | null;
  risk?: string;
  reason: string;
};

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
  logRoutingEvent({
    agentId,
    category: decision.category,
    model: decision.model ?? "default",
    risk: decision.risk,
    reason: decision.reason,
  });
}

export function logRoutingEvent(entry: LogEntry): void {
  if (!logPath) return;

  const ts = new Date().toISOString();
  const line = `${ts} agent=${entry.agentId ?? "unknown"} category=${entry.category} model=${entry.model ?? "default"} risk=${entry.risk ?? "n/a"} reason=${entry.reason}\n`;

  try {
    appendFileSync(logPath, line);
  } catch {
    // logging failure should never break routing
  }
}
