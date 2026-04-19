#!/usr/bin/env npx tsx

import { readFileSync } from "fs";
import { loadConfig } from "../plugin/config.js";
import { resolveRoutingDecision } from "../plugin/decision.js";
import { buildExplanationSummary } from "../plugin/explain.js";
import type { RoutingModifier } from "../plugin/types.js";

type CliOptions = {
  prompts: string[];
  promptsFile?: string;
  agentId?: string;
  currentModel?: string;
  openclawDir: string;
  json: boolean;
};

type VariantResult = {
  modifier: RoutingModifier | "balanced";
  action: "skip" | "stay" | "route";
  reason: string;
  selectedModel: string | null;
  authProfileOverride: string | null;
  selectedAccountId: string | null;
  category: string | null;
  summary: string;
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

function parsePromptLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    prompts: [],
    json: false,
    openclawDir: `${process.env.HOME ?? "/root"}/.openclaw`,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prompt" && argv[i + 1]) {
      options.prompts.push(argv[++i]);
      continue;
    }
    if (arg === "--prompts-file" && argv[i + 1]) {
      options.promptsFile = argv[++i];
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
  npx tsx scripts/compare_modifiers.ts --prompts-file prompts.txt
  echo "refactor auth module" | npx tsx scripts/compare_modifiers.ts

Options:
  --prompt <text>         Add a single prompt (repeatable)
  --prompts-file <path>   Read prompts from a text file, one prompt per line
  --agent <agentId>       Optional agent id for workspace hints
  --current-model <id>    Optional current runtime model
  --openclaw-dir <path>   Optional OpenClaw directory (default: ~/.openclaw)
  --json                  Emit machine-readable JSON
`);
      process.exit(0);
    }
    fail(`Unknown argument: ${arg}`);
  }

  if (options.promptsFile) {
    options.prompts.push(...parsePromptLines(readFileSync(options.promptsFile, "utf-8")));
  }

  if (options.prompts.length === 0) {
    options.prompts.push(...parsePromptLines(readStdin()));
  }

  if (options.prompts.length === 0) {
    fail("No prompts provided. Use --prompt, --prompts-file, or stdin.");
  }

  return options;
}

function toVariantResult(modifier: RoutingModifier | "balanced", result: ReturnType<typeof resolveRoutingDecision>): VariantResult {
  return {
    modifier,
    action: result.action,
    reason: result.reason,
    selectedModel: result.selectedModel,
    authProfileOverride: result.authProfileOverride,
    selectedAccountId: result.selectedAccountId,
    category: result.rawDecision?.category ?? null,
    summary: buildExplanationSummary(result).headline,
  };
}

function changedRelativeToBalanced(base: VariantResult, other: VariantResult): boolean {
  return (
    base.action !== other.action ||
    base.selectedModel !== other.selectedModel ||
    base.authProfileOverride !== other.authProfileOverride ||
    base.selectedAccountId !== other.selectedAccountId
  );
}

function renderText(report: {
  prompts: Array<{
    prompt: string;
    balanced: VariantResult;
    variants: VariantResult[];
  }>;
  summary: Record<string, { changed: number; total: number }>;
}): string {
  const lines = [
    "# ZeroAPI Modifier Comparison",
    "",
    `Prompts: ${report.prompts.length}`,
    "",
    "## Delta Vs Balanced",
  ];

  for (const [modifier, counts] of Object.entries(report.summary)) {
    lines.push(`- ${modifier}: ${counts.changed}/${counts.total} changed`);
  }

  const changedPrompts = report.prompts.filter((entry) =>
    entry.variants.some((variant) => changedRelativeToBalanced(entry.balanced, variant)),
  );

  if (changedPrompts.length === 0) {
    lines.push("");
    lines.push("No modifier changed the current prompt set relative to balanced.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("## Changed Prompts");

  for (const entry of changedPrompts) {
    lines.push("");
    lines.push(`Prompt: ${entry.prompt}`);
    lines.push(`  balanced -> ${entry.balanced.action} | ${entry.balanced.selectedModel ?? "stay"} | ${entry.balanced.summary}`);
    for (const variant of entry.variants) {
      if (!changedRelativeToBalanced(entry.balanced, variant)) continue;
      lines.push(`  ${variant.modifier} -> ${variant.action} | ${variant.selectedModel ?? "stay"} | ${variant.summary}`);
    }
  }

  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
const config = loadConfig(options.openclawDir);

if (!config) {
  fail(`Could not load valid zeroapi-config.json from ${options.openclawDir}`);
}

const modifiers: RoutingModifier[] = ["coding-aware", "research-aware", "speed-aware"];

const prompts = options.prompts.map((prompt) => {
  const balancedResult = resolveRoutingDecision(
    {
      ...config,
      routing_modifier: undefined,
    },
    {
      prompt,
      agentId: options.agentId,
      currentModel: options.currentModel ?? config.default_model,
      includeDiagnostics: true,
    },
  );

  const balanced = toVariantResult("balanced", balancedResult);
  const variants = modifiers.map((modifier) => toVariantResult(
    modifier,
    resolveRoutingDecision(
      {
        ...config,
        routing_modifier: modifier,
      },
      {
        prompt,
        agentId: options.agentId,
        currentModel: options.currentModel ?? config.default_model,
        includeDiagnostics: true,
      },
    ),
  ));

  return {
    prompt,
    balanced,
    variants,
  };
});

const summary = Object.fromEntries(
  modifiers.map((modifier) => [
    modifier,
    {
      changed: prompts.filter((entry) =>
        changedRelativeToBalanced(
          entry.balanced,
          entry.variants.find((variant) => variant.modifier === modifier)!,
        ),
      ).length,
      total: prompts.length,
    },
  ]),
);

if (options.json) {
  console.log(JSON.stringify({
    openclawDir: options.openclawDir,
    promptCount: prompts.length,
    summary,
    prompts,
  }, null, 2));
} else {
  console.log(renderText({ prompts, summary }));
}
