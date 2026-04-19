#!/usr/bin/env npx tsx

import { readFileSync } from "fs";
import { loadConfig } from "../plugin/config.js";
import { resolveRoutingDecision } from "../plugin/decision.js";
import { buildExplanationSummary } from "../plugin/explain.js";

type CliOptions = {
  prompt: string;
  agentId?: string;
  currentModel?: string;
  trigger?: string;
  json: boolean;
  openclawDir: string;
};

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf-8").trim();
  } catch {
    return "";
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    prompt: "",
    json: false,
    openclawDir: `${process.env.HOME ?? "/root"}/.openclaw`,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prompt" && argv[i + 1]) {
      options.prompt = argv[++i];
      continue;
    }
    if (arg === "--agent" && argv[i + 1]) {
      options.agentId = argv[++i];
      continue;
    }
    if (arg === "--current-model" && argv[i + 1]) {
      options.currentModel = argv[++i];
      continue;
    }
    if (arg === "--trigger" && argv[i + 1]) {
      options.trigger = argv[++i];
      continue;
    }
    if (arg === "--openclaw-dir" && argv[i + 1]) {
      options.openclawDir = argv[++i];
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  npx tsx scripts/simulate.ts --prompt "refactor auth module"
  echo "refactor auth module" | npx tsx scripts/simulate.ts --agent codex

Options:
  --prompt <text>         Prompt to classify and route
  --agent <agentId>       Optional agent id for workspace hints / overrides
  --current-model <id>    Optional current runtime model (provider/model)
  --trigger <name>        Optional trigger (cron, heartbeat, user, etc.)
  --openclaw-dir <path>   Optional OpenClaw directory (default: ~/.openclaw)
  --json                  Emit machine-readable JSON
`);
      process.exit(0);
    }
    fail(`Unknown argument: ${arg}`);
  }

  if (!options.prompt) {
    options.prompt = readStdin();
  }

  if (!options.prompt) {
    fail("No prompt provided. Use --prompt or pipe text via stdin.");
  }

  return options;
}

function renderText(result: ReturnType<typeof resolveRoutingDecision>, prompt: string): string {
  const explanation = buildExplanationSummary(result);
  const lines = [
    "# ZeroAPI Simulation",
    "",
    `Prompt: ${prompt}`,
    `Action: ${result.action}`,
    `Reason: ${result.reason}`,
    `Summary: ${explanation.headline}`,
    `Current model: ${result.currentModel ?? "none"}`,
  ];

  if (result.rawDecision) {
    lines.push(`Category: ${result.rawDecision.category}`);
    lines.push(`Risk: ${result.rawDecision.risk}`);
  }

  if (result.agentId) {
    lines.push(`Agent: ${result.agentId}`);
  }

  if (result.trigger) {
    lines.push(`Trigger: ${result.trigger}`);
  }

  if (result.workspaceHints !== undefined) {
    const hintText = result.workspaceHints === null
      ? "specialist/null"
      : (result.workspaceHints.length > 0 ? result.workspaceHints.join(", ") : "none");
    lines.push(`Workspace hints: ${hintText}`);
  }

  if (result.tokenEstimate != null) {
    lines.push(`Estimated tokens: ${result.tokenEstimate}`);
    lines.push(`Likely vision: ${result.likelyVision ? "yes" : "no"}`);
  }

  lines.push(`Selected model: ${result.selectedModel ?? "stay on current/default"}`);
  lines.push(`Capable models: ${result.capableModels.length > 0 ? result.capableModels.join(", ") : "none"}`);
  lines.push(`Weighted candidates: ${result.weightedCandidates.length > 0 ? result.weightedCandidates.join(", ") : "none"}`);
  lines.push("Explanation details:");
  lines.push(...explanation.details.map((detail) => `- ${detail}`));

  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
const config = loadConfig(options.openclawDir);

if (!config) {
  fail(`Could not load valid zeroapi-config.json from ${options.openclawDir}`);
}

const result = resolveRoutingDecision(config, {
  prompt: options.prompt,
  agentId: options.agentId,
  currentModel: options.currentModel,
  trigger: options.trigger,
});
const explanation = buildExplanationSummary(result);

if (options.json) {
  console.log(JSON.stringify({
    prompt: options.prompt,
    configVersion: config.version,
    explanation,
    ...result,
  }, null, 2));
} else {
  console.log(renderText(result, options.prompt));
}
