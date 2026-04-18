import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { RoutingDecision } from "./types.js";

let logPath: string | null = null;

type LogEntry = {
  action?: string;
  agentId?: string;
  category: string;
  currentModel?: string | null;
  model?: string | null;
  candidates?: string[];
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
  routing: {
    action: "skip" | "stay" | "route";
    currentModel: string | null;
    weightedCandidates: string[];
    finalDecision: RoutingDecision | null;
  },
): void {
  if (!routing.finalDecision) return;

  logRoutingEvent({
    action: routing.action,
    agentId,
    category: routing.finalDecision.category,
    currentModel: routing.currentModel,
    model: routing.finalDecision.model ?? "default",
    candidates: routing.weightedCandidates.slice(0, 3),
    risk: routing.finalDecision.risk,
    reason: routing.finalDecision.reason,
  });
}

export function logRoutingEvent(entry: LogEntry): void {
  if (!logPath) return;

  const ts = new Date().toISOString();
  const parts = [
    ts,
    `agent=${entry.agentId ?? "unknown"}`,
    `action=${entry.action ?? "event"}`,
    `category=${entry.category}`,
    `current=${entry.currentModel ?? "n/a"}`,
    `model=${entry.model ?? "default"}`,
    `risk=${entry.risk ?? "n/a"}`,
    `reason=${entry.reason}`,
  ];

  if (entry.candidates?.length) {
    parts.push(`candidates=${entry.candidates.join(",")}`);
  }

  const line = `${parts.join(" ")}\n`;

  try {
    appendFileSync(logPath, line);
  } catch {
    // logging failure should never break routing
  }
}
