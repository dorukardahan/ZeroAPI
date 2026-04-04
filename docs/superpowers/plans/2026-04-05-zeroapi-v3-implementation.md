# ZeroAPI v3.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a plugin + skill that routes each OpenClaw message to the optimal AI model based on benchmark data and available subscriptions.

**Architecture:** OpenClaw `before_model_resolve` plugin hook for per-message model selection (zero latency, same session). SKILL.md setup wizard generates `zeroapi-config.json` that the plugin reads. Two-stage routing: capability filter → benchmark ranking.

**Tech Stack:** TypeScript (plugin), Markdown (SKILL.md), JSON (config/benchmarks)

**Spec:** `docs/superpowers/specs/2026-04-04-zeroapi-v3-design.md`

---

## File Map

```
ZeroAPI/
├── plugin/                              # OpenClaw plugin (NEW)
│   ├── index.ts                         # Plugin entry, hook registration
│   ├── classifier.ts                    # Keyword/regex task classification
│   ├── filter.ts                        # Capability filter (stage 1)
│   ├── selector.ts                      # Benchmark-based model selection (stage 2)
│   ├── config.ts                        # Config loader + cache
│   ├── types.ts                         # TypeScript types
│   ├── logger.ts                        # Routing log writer
│   ├── package.json                     # Plugin metadata
│   └── __tests__/                       # Tests
│       ├── classifier.test.ts
│       ├── filter.test.ts
│       ├── selector.test.ts
│       └── integration.test.ts
├── SKILL.md                             # Setup wizard (REWRITE)
├── benchmarks.json                      # AA API data (DONE)
├── README.md                            # Overview + setup guide (REWRITE)
├── examples/                            # Example configs (REWRITE)
│   ├── README.md
│   ├── google-only.json
│   ├── google-openai.json
│   ├── google-openai-glm.json
│   ├── google-openai-glm-kimi.json
│   └── full-stack.json
├── references/                          # Provider docs (UPDATE)
│   ├── provider-config.md
│   ├── oauth-setup.md
│   └── troubleshooting.md
└── docs/
```

---

### Task 1: Plugin types and config schema

**Files:**
- Create: `plugin/types.ts`
- Create: `plugin/config.ts`

- [ ] **Step 1: Define TypeScript types**

```typescript
// plugin/types.ts

export type TaskCategory = "code" | "research" | "orchestration" | "math" | "fast" | "default";

export type RiskLevel = "low" | "medium" | "high";

export type ModelCapabilities = {
  context_window: number;
  supports_vision: boolean;
  speed_tps: number | null;
  ttft_seconds: number | null;
  benchmarks: Record<string, number>;
};

export type RoutingRule = {
  primary: string;
  fallbacks: string[];
};

export type ZeroAPIConfig = {
  version: string;
  generated: string;
  benchmarks_date: string;
  default_model: string;
  models: Record<string, ModelCapabilities>;
  routing_rules: Record<TaskCategory, RoutingRule>;
  workspace_hints: Record<string, TaskCategory[] | null>;
  keywords: Record<TaskCategory, string[]>;
  high_risk_keywords: string[];
  fast_ttft_max_seconds: number;
};

export type RoutingDecision = {
  category: TaskCategory;
  model: string | null;
  provider: string | null;
  reason: string;
  risk: RiskLevel;
};
```

- [ ] **Step 2: Write config loader**

```typescript
// plugin/config.ts

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
```

- [ ] **Step 3: Commit**

```bash
git add plugin/types.ts plugin/config.ts
git commit -m "feat(plugin): add types and config loader"
```

---

### Task 2: Task classifier

**Files:**
- Create: `plugin/classifier.ts`
- Create: `plugin/__tests__/classifier.test.ts`

- [ ] **Step 1: Write classifier tests**

```typescript
// plugin/__tests__/classifier.test.ts

import { describe, it, expect } from "vitest";
import { classifyTask } from "../classifier.js";

const defaultKeywords = {
  code: ["implement", "function", "class", "refactor", "fix", "test", "debug", "PR", "diff", "migration", "component", "endpoint", "deploy"],
  research: ["research", "analyze", "explain", "compare", "paper", "evidence", "investigate", "study"],
  orchestration: ["orchestrate", "coordinate", "pipeline", "workflow", "sequence", "parallel", "fan-out"],
  math: ["calculate", "solve", "equation", "proof", "integral", "probability", "optimize", "formula"],
  fast: ["quick", "simple", "format", "convert", "translate", "rename", "one-liner", "list"],
};

const highRisk = ["deploy", "delete", "drop", "rm", "production", "credentials", "secret", "password"];

describe("classifyTask", () => {
  it("classifies code tasks", () => {
    const result = classifyTask("refactor the auth module", defaultKeywords, highRisk);
    expect(result.category).toBe("code");
    expect(result.risk).toBe("medium");
  });

  it("classifies research tasks", () => {
    const result = classifyTask("research the differences between SQLite WAL modes", defaultKeywords, highRisk);
    expect(result.category).toBe("research");
  });

  it("classifies orchestration tasks", () => {
    const result = classifyTask("orchestrate a pipeline that fetches data then transforms it", defaultKeywords, highRisk);
    expect(result.category).toBe("orchestration");
  });

  it("classifies math tasks", () => {
    const result = classifyTask("solve this integral equation", defaultKeywords, highRisk);
    expect(result.category).toBe("math");
  });

  it("classifies fast tasks", () => {
    const result = classifyTask("quickly format this as a table", defaultKeywords, highRisk);
    expect(result.category).toBe("fast");
  });

  it("returns default for ambiguous input", () => {
    const result = classifyTask("buna bi bak", defaultKeywords, highRisk);
    expect(result.category).toBe("default");
  });

  it("returns default for empty input", () => {
    const result = classifyTask("", defaultKeywords, highRisk);
    expect(result.category).toBe("default");
  });

  it("detects high risk keywords", () => {
    const result = classifyTask("deploy this to production", defaultKeywords, highRisk);
    expect(result.risk).toBe("high");
  });

  it("code is medium risk by default", () => {
    const result = classifyTask("write a function that parses JSON", defaultKeywords, highRisk);
    expect(result.category).toBe("code");
    expect(result.risk).toBe("medium");
  });

  it("fast is low risk", () => {
    const result = classifyTask("convert this to markdown", defaultKeywords, highRisk);
    expect(result.risk).toBe("low");
  });

  it("handles Turkish text", () => {
    const result = classifyTask("bu fonksiyonu refactor et", defaultKeywords, highRisk);
    expect(result.category).toBe("code");
  });

  it("first keyword match wins for multi-category", () => {
    const result = classifyTask("research this API then implement a client", defaultKeywords, highRisk);
    // "research" appears first
    expect(result.category).toBe("research");
  });

  it("uses workspace hints when no keyword match", () => {
    const result = classifyTask("bunu düzelt", defaultKeywords, highRisk, ["code"]);
    expect(result.category).toBe("code");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd plugin && npx vitest run __tests__/classifier.test.ts`
Expected: FAIL — classifier.ts doesn't exist yet

- [ ] **Step 3: Write classifier implementation**

```typescript
// plugin/classifier.ts

import type { TaskCategory, RiskLevel, RoutingDecision } from "./types.js";

const RISK_MAP: Record<TaskCategory, RiskLevel> = {
  code: "medium",
  research: "low",
  orchestration: "medium",
  math: "low",
  fast: "low",
  default: "low",
};

export function classifyTask(
  prompt: string,
  keywords: Record<string, string[]>,
  highRiskKeywords: string[],
  workspaceHints?: TaskCategory[] | null,
): RoutingDecision {
  const lower = prompt.toLowerCase();

  if (!lower.trim()) {
    return { category: "default", model: null, provider: null, reason: "empty_prompt", risk: "low" };
  }

  // Check high-risk keywords first
  const isHighRisk = highRiskKeywords.some((kw) => lower.includes(kw.toLowerCase()));

  // Scan for category keywords — first match wins
  let matchedCategory: TaskCategory = "default";
  let matchedKeyword = "";
  let earliestIndex = Infinity;

  for (const [category, kws] of Object.entries(keywords)) {
    for (const kw of kws) {
      const idx = lower.indexOf(kw.toLowerCase());
      if (idx !== -1 && idx < earliestIndex) {
        earliestIndex = idx;
        matchedCategory = category as TaskCategory;
        matchedKeyword = kw;
      }
    }
  }

  // If no keyword match, try workspace hints
  if (matchedCategory === "default" && workspaceHints?.length) {
    matchedCategory = workspaceHints[0];
    matchedKeyword = `workspace_hint:${workspaceHints[0]}`;
  }

  const risk: RiskLevel = isHighRisk ? "high" : RISK_MAP[matchedCategory];

  return {
    category: matchedCategory,
    model: null, // filled by selector
    provider: null,
    reason: matchedKeyword ? `keyword:${matchedKeyword}` : "no_match",
    risk,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd plugin && npx vitest run __tests__/classifier.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/classifier.ts plugin/__tests__/classifier.test.ts
git commit -m "feat(plugin): task classifier with keyword matching"
```

---

### Task 3: Capability filter

**Files:**
- Create: `plugin/filter.ts`
- Create: `plugin/__tests__/filter.test.ts`

- [ ] **Step 1: Write filter tests**

```typescript
// plugin/__tests__/filter.test.ts

import { describe, it, expect } from "vitest";
import { filterCapableModels } from "../filter.js";
import type { ModelCapabilities } from "../types.js";

const models: Record<string, ModelCapabilities> = {
  "google/gemini-3.1-pro": {
    context_window: 1000000,
    supports_vision: true,
    speed_tps: 120,
    ttft_seconds: 20,
    benchmarks: { intelligence: 57.2, coding: 55.5 },
  },
  "openai-codex/gpt-5.4": {
    context_window: 1050000,
    supports_vision: false,
    speed_tps: 72,
    ttft_seconds: 163,
    benchmarks: { intelligence: 57.2, coding: 57.3 },
  },
  "zai/glm-5": {
    context_window: 200000,
    supports_vision: false,
    speed_tps: 62,
    ttft_seconds: 0.9,
    benchmarks: { intelligence: 49.8, tau2: 0.982 },
  },
};

describe("filterCapableModels", () => {
  it("returns all models when no constraints", () => {
    const result = filterCapableModels(models, { estimatedTokens: 1000 });
    expect(Object.keys(result)).toHaveLength(3);
  });

  it("filters by context window", () => {
    const result = filterCapableModels(models, { estimatedTokens: 500000 });
    expect(Object.keys(result)).toHaveLength(2); // gemini + gpt (both > 500K)
    expect(result["zai/glm-5"]).toBeUndefined(); // 200K < 500K
  });

  it("filters by vision requirement", () => {
    const result = filterCapableModels(models, { estimatedTokens: 1000, requiresVision: true });
    expect(Object.keys(result)).toHaveLength(1);
    expect(result["google/gemini-3.1-pro"]).toBeDefined();
  });

  it("filters by TTFT for fast tasks", () => {
    const result = filterCapableModels(models, { estimatedTokens: 1000, maxTtftSeconds: 5 });
    expect(Object.keys(result)).toHaveLength(1);
    expect(result["zai/glm-5"]).toBeDefined(); // 0.9s
  });

  it("returns empty when nothing fits", () => {
    const result = filterCapableModels(models, { estimatedTokens: 2000000 });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("excludes specific providers", () => {
    const result = filterCapableModels(models, {
      estimatedTokens: 1000,
      excludeProviders: ["openai-codex"],
    });
    expect(result["openai-codex/gpt-5.4"]).toBeUndefined();
    expect(Object.keys(result)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd plugin && npx vitest run __tests__/filter.test.ts`
Expected: FAIL

- [ ] **Step 3: Write filter implementation**

```typescript
// plugin/filter.ts

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
    // Context window check
    if (caps.context_window < options.estimatedTokens) continue;

    // Vision check
    if (options.requiresVision && !caps.supports_vision) continue;

    // TTFT check (for fast tasks)
    if (options.maxTtftSeconds != null && caps.ttft_seconds != null) {
      if (caps.ttft_seconds > options.maxTtftSeconds) continue;
    }

    // Provider exclusion
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
```

- [ ] **Step 4: Run tests**

Run: `cd plugin && npx vitest run __tests__/filter.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/filter.ts plugin/__tests__/filter.test.ts
git commit -m "feat(plugin): capability filter (context window, vision, TTFT)"
```

---

### Task 4: Benchmark-based model selector

**Files:**
- Create: `plugin/selector.ts`
- Create: `plugin/__tests__/selector.test.ts`

- [ ] **Step 1: Write selector tests**

```typescript
// plugin/__tests__/selector.test.ts

import { describe, it, expect } from "vitest";
import { selectModel } from "../selector.js";
import type { ModelCapabilities, TaskCategory, RoutingRule } from "../types.js";

const models: Record<string, ModelCapabilities> = {
  "openai-codex/gpt-5.4": {
    context_window: 1050000, supports_vision: false, speed_tps: 72, ttft_seconds: 163,
    benchmarks: { intelligence: 57.2, coding: 57.3, terminalbench: 0.576, tau2: 0.915, ifbench: 0.739 },
  },
  "google/gemini-3.1-pro": {
    context_window: 1000000, supports_vision: true, speed_tps: 120, ttft_seconds: 20,
    benchmarks: { intelligence: 57.2, coding: 55.5, terminalbench: 0.538, tau2: 0.956, ifbench: 0.771 },
  },
  "zai/glm-5": {
    context_window: 200000, supports_vision: false, speed_tps: 62, ttft_seconds: 0.9,
    benchmarks: { intelligence: 49.8, coding: 44.2, terminalbench: 0.432, tau2: 0.982, ifbench: 0.723 },
  },
};

const rules: Record<string, RoutingRule> = {
  code: { primary: "openai-codex/gpt-5.4", fallbacks: ["google/gemini-3.1-pro", "zai/glm-5"] },
  research: { primary: "google/gemini-3.1-pro", fallbacks: ["openai-codex/gpt-5.4"] },
  orchestration: { primary: "zai/glm-5", fallbacks: ["google/gemini-3.1-pro"] },
  fast: { primary: "zai/glm-5", fallbacks: ["google/gemini-3.1-pro"] },
  default: { primary: "google/gemini-3.1-pro", fallbacks: ["openai-codex/gpt-5.4", "zai/glm-5"] },
};

describe("selectModel", () => {
  it("selects primary for code tasks", () => {
    const result = selectModel("code", models, rules, null);
    expect(result).toBe("openai-codex/gpt-5.4");
  });

  it("selects primary for research tasks", () => {
    const result = selectModel("research", models, rules, null);
    expect(result).toBe("google/gemini-3.1-pro");
  });

  it("selects primary for orchestration tasks", () => {
    const result = selectModel("orchestration", models, rules, null);
    expect(result).toBe("zai/glm-5");
  });

  it("returns null when selected model equals current default", () => {
    const result = selectModel("research", models, rules, "google/gemini-3.1-pro");
    expect(result).toBeNull(); // already on the right model
  });

  it("falls back when primary not in available models", () => {
    const limited = { ...models };
    delete limited["openai-codex/gpt-5.4"];
    const result = selectModel("code", limited, rules, null);
    expect(result).toBe("google/gemini-3.1-pro"); // first fallback
  });

  it("returns default model when category has no rule", () => {
    const result = selectModel("math" as TaskCategory, models, rules, null);
    // math not in rules, falls to "default"
    expect(result).toBe("google/gemini-3.1-pro");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd plugin && npx vitest run __tests__/selector.test.ts`
Expected: FAIL

- [ ] **Step 3: Write selector implementation**

```typescript
// plugin/selector.ts

import type { ModelCapabilities, TaskCategory, RoutingRule } from "./types.js";

export function selectModel(
  category: TaskCategory,
  availableModels: Record<string, ModelCapabilities>,
  rules: Record<string, RoutingRule>,
  currentDefaultModel: string | null,
): string | null {
  const rule = rules[category] ?? rules["default"];
  if (!rule) return null;

  // Try primary first, then fallbacks
  const candidates = [rule.primary, ...rule.fallbacks];

  for (const candidate of candidates) {
    if (candidate in availableModels) {
      // If the best model is already the current default, skip switching
      if (candidate === currentDefaultModel) return null;
      return candidate;
    }
  }

  // No candidate available — stay on current model
  return null;
}
```

- [ ] **Step 4: Run tests**

Run: `cd plugin && npx vitest run __tests__/selector.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/selector.ts plugin/__tests__/selector.test.ts
git commit -m "feat(plugin): benchmark-based model selector"
```

---

### Task 5: Routing logger

**Files:**
- Create: `plugin/logger.ts`

- [ ] **Step 1: Write logger**

```typescript
// plugin/logger.ts

import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
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
```

- [ ] **Step 2: Commit**

```bash
git add plugin/logger.ts
git commit -m "feat(plugin): routing decision logger"
```

---

### Task 6: Plugin entry point and hook registration

**Files:**
- Create: `plugin/index.ts`
- Create: `plugin/package.json`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "zeroapi-router",
  "version": "3.0.0",
  "private": true,
  "description": "ZeroAPI — benchmark-driven model routing for OpenClaw",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"]
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Write plugin entry point**

```typescript
// plugin/index.ts

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { loadConfig, getConfig } from "./config.js";
import { classifyTask } from "./classifier.js";
import { filterCapableModels, estimateTokens } from "./filter.js";
import { selectModel } from "./selector.js";
import { initLogger, logRouting } from "./logger.js";

export default definePluginEntry({
  id: "zeroapi-router",
  name: "ZeroAPI Router",
  description: "Benchmark-driven model routing across subscription providers",

  register(api) {
    const openclawDir = process.env.HOME
      ? `${process.env.HOME}/.openclaw`
      : "/root/.openclaw";

    const config = loadConfig(openclawDir);
    if (!config) {
      api.logger.warn("zeroapi-config.json not found. Run /zeroapi to configure.");
      return;
    }

    initLogger(openclawDir);
    api.logger.info(`ZeroAPI Router v${config.version} loaded (${Object.keys(config.models).length} models, benchmarks from ${config.benchmarks_date})`);

    api.on("before_model_resolve", (event, ctx) => {
      // Skip routing for specialist agents (they have dedicated models)
      const agentId = ctx.agentId;
      if (agentId && config.workspace_hints[agentId] === null) {
        return; // null means "don't route this agent"
      }

      // Skip routing for cron triggers (cron models set in openclaw.json)
      if (ctx.trigger === "cron" || ctx.trigger === "heartbeat") {
        return;
      }

      // Classify the task
      const workspaceHints = agentId ? config.workspace_hints[agentId] : undefined;
      const decision = classifyTask(
        event.prompt,
        config.keywords,
        config.high_risk_keywords,
        workspaceHints,
      );

      // High-risk tasks stay on default model
      if (decision.risk === "high") {
        logRouting(agentId, { ...decision, model: null, reason: `high_risk:${decision.reason}` });
        return;
      }

      // No category detected — stay on default
      if (decision.category === "default") {
        logRouting(agentId, decision);
        return;
      }

      // Stage 1: Capability filter
      const tokenEstimate = estimateTokens(event.prompt);
      const isFast = decision.category === "fast";
      const capable = filterCapableModels(config.models, {
        estimatedTokens: tokenEstimate,
        maxTtftSeconds: isFast ? config.fast_ttft_max_seconds : undefined,
      });

      // Stage 2: Select best model from capable survivors
      const currentModel = ctx.modelId
        ? `${ctx.modelProviderId}/${ctx.modelId}`
        : config.default_model;
      const selectedModel = selectModel(
        decision.category,
        capable,
        config.routing_rules,
        currentModel,
      );

      if (!selectedModel) {
        logRouting(agentId, { ...decision, model: null, reason: `${decision.reason}:no_switch_needed` });
        return;
      }

      // Parse provider/model from the selected model ID
      const slashIdx = selectedModel.indexOf("/");
      const provider = selectedModel.substring(0, slashIdx);
      const model = selectedModel.substring(slashIdx + 1);

      decision.model = selectedModel;
      decision.provider = provider;
      logRouting(agentId, decision);

      return {
        providerOverride: provider,
        modelOverride: model,
      };
    });
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add plugin/index.ts plugin/package.json
git commit -m "feat(plugin): main entry with before_model_resolve hook"
```

---

### Task 7: Plugin integration test

**Files:**
- Create: `plugin/__tests__/integration.test.ts`
- Create: `plugin/vitest.config.ts`

- [ ] **Step 1: Write vitest config**

```typescript
// plugin/vitest.config.ts

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write integration tests**

```typescript
// plugin/__tests__/integration.test.ts

import { describe, it, expect } from "vitest";
import { classifyTask } from "../classifier.js";
import { filterCapableModels, estimateTokens } from "../filter.js";
import { selectModel } from "../selector.js";
import type { ZeroAPIConfig } from "../types.js";

// Simulated full config
const config: ZeroAPIConfig = {
  version: "3.0.0",
  generated: "2026-04-05",
  benchmarks_date: "2026-04-04",
  default_model: "google-gemini-cli/gemini-3.1-pro-preview",
  models: {
    "google-gemini-cli/gemini-3.1-pro-preview": {
      context_window: 1000000, supports_vision: true, speed_tps: 120, ttft_seconds: 20,
      benchmarks: { intelligence: 57.2, coding: 55.5, tau2: 0.956 },
    },
    "openai-codex/gpt-5.4": {
      context_window: 1050000, supports_vision: false, speed_tps: 72, ttft_seconds: 163,
      benchmarks: { intelligence: 57.2, coding: 57.3, tau2: 0.915 },
    },
    "zai/glm-5": {
      context_window: 200000, supports_vision: false, speed_tps: 62, ttft_seconds: 0.9,
      benchmarks: { intelligence: 49.8, coding: 44.2, tau2: 0.982 },
    },
  },
  routing_rules: {
    code: { primary: "openai-codex/gpt-5.4", fallbacks: ["google-gemini-cli/gemini-3.1-pro-preview", "zai/glm-5"] },
    research: { primary: "google-gemini-cli/gemini-3.1-pro-preview", fallbacks: ["openai-codex/gpt-5.4"] },
    orchestration: { primary: "zai/glm-5", fallbacks: ["google-gemini-cli/gemini-3.1-pro-preview"] },
    math: { primary: "openai-codex/gpt-5.4", fallbacks: ["google-gemini-cli/gemini-3.1-pro-preview"] },
    fast: { primary: "zai/glm-5", fallbacks: ["google-gemini-cli/gemini-3.1-pro-preview"] },
    default: { primary: "google-gemini-cli/gemini-3.1-pro-preview", fallbacks: ["openai-codex/gpt-5.4", "zai/glm-5"] },
  },
  workspace_hints: { codex: null, gemini: null, senti: ["code", "research"] },
  keywords: {
    code: ["implement", "function", "class", "refactor", "fix", "test", "debug"],
    research: ["research", "analyze", "explain", "compare", "investigate"],
    orchestration: ["orchestrate", "coordinate", "pipeline", "workflow"],
    math: ["calculate", "solve", "equation", "proof"],
    fast: ["quick", "simple", "format", "convert", "translate"],
  },
  high_risk_keywords: ["deploy", "delete", "drop", "production", "credentials"],
  fast_ttft_max_seconds: 5,
};

describe("full routing pipeline", () => {
  it("routes code task to Codex", () => {
    const decision = classifyTask("refactor the auth module", config.keywords, config.high_risk_keywords);
    expect(decision.category).toBe("code");

    const capable = filterCapableModels(config.models, { estimatedTokens: 1000 });
    const model = selectModel(decision.category, capable, config.routing_rules, config.default_model);
    expect(model).toBe("openai-codex/gpt-5.4");
  });

  it("routes research task — already on default, returns null", () => {
    const decision = classifyTask("analyze the performance data", config.keywords, config.high_risk_keywords);
    expect(decision.category).toBe("research");

    const capable = filterCapableModels(config.models, { estimatedTokens: 1000 });
    const model = selectModel(decision.category, capable, config.routing_rules, config.default_model);
    expect(model).toBeNull(); // already on gemini-3.1-pro
  });

  it("blocks high-risk tasks from routing", () => {
    const decision = classifyTask("deploy this to production", config.keywords, config.high_risk_keywords);
    expect(decision.risk).toBe("high");
    // plugin would return early, no model override
  });

  it("fast task filters by TTFT", () => {
    const decision = classifyTask("quickly format this list", config.keywords, config.high_risk_keywords);
    expect(decision.category).toBe("fast");

    const capable = filterCapableModels(config.models, {
      estimatedTokens: 100,
      maxTtftSeconds: config.fast_ttft_max_seconds,
    });
    // Only GLM-5 (0.9s) passes TTFT < 5s filter
    expect(capable["zai/glm-5"]).toBeDefined();
    expect(capable["openai-codex/gpt-5.4"]).toBeUndefined(); // 163s
    expect(capable["google-gemini-cli/gemini-3.1-pro-preview"]).toBeUndefined(); // 20s
  });

  it("large context filters out small-window models", () => {
    const capable = filterCapableModels(config.models, { estimatedTokens: 500000 });
    expect(capable["zai/glm-5"]).toBeUndefined(); // 200K window
    expect(Object.keys(capable)).toHaveLength(2);
  });

  it("ambiguous message stays on default", () => {
    const decision = classifyTask("buna bi bak", config.keywords, config.high_risk_keywords);
    expect(decision.category).toBe("default");
    // no override returned
  });

  it("workspace hints help classify ambiguous tasks", () => {
    const decision = classifyTask("bunu düzelt", config.keywords, config.high_risk_keywords, ["code"]);
    expect(decision.category).toBe("code");
  });

  it("estimates tokens from prompt length", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4
    expect(estimateTokens("a".repeat(400000))).toBe(100000); // 100K tokens
  });
});
```

- [ ] **Step 3: Install devDependencies and run all tests**

```bash
cd plugin && npm install && npx vitest run
```

Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add plugin/__tests__/integration.test.ts plugin/vitest.config.ts plugin/package-lock.json
git commit -m "test(plugin): integration tests for full routing pipeline"
```

---

### Task 8: SKILL.md rewrite

**Files:**
- Rewrite: `SKILL.md`

- [ ] **Step 1: Write the complete SKILL.md**

This is the largest single file. The skill:
1. Reads benchmarks.json
2. Asks subscriptions (or reads existing config)
3. Scans all workspaces and crons via SSH/local access
4. Generates zeroapi-config.json
5. Updates openclaw.json
6. Installs the plugin

The full SKILL.md content is too large to embed here. Write it following the structure in the design spec (10-step flow), referencing:
- benchmarks.json for model data
- plugin/types.ts for config schema
- Design spec for routing rules, benchmark composites, workspace hints

Key sections:
- Frontmatter (name, version, compatibility, metadata)
- First-time setup flow
- Re-run flow
- Provider table with pricing
- Benchmark composites (reweighted coding, orchestration)
- Config generation algorithm
- Cron model assignment logic
- Plugin installation instructions
- Anthropic exclusion notice with tweet reference
- Troubleshooting

- [ ] **Step 2: Commit**

```bash
git add SKILL.md
git commit -m "feat: rewrite SKILL.md for v3.0 plugin-based architecture"
```

---

### Task 9: Example configs

**Files:**
- Create: `examples/google-only.json`
- Create: `examples/google-openai.json`
- Create: `examples/google-openai-glm.json`
- Create: `examples/google-openai-glm-kimi.json`
- Create: `examples/full-stack.json`
- Rewrite: `examples/README.md`

- [ ] **Step 1: Write example configs**

Each example is a complete `zeroapi-config.json` for that provider combination. Generate from benchmarks.json by filtering to available providers and running the selection algorithm.

- [ ] **Step 2: Write examples README**

Setup instructions per combination: which subscriptions needed, expected cost, how to install.

- [ ] **Step 3: Remove old examples**

```bash
rm -rf examples/claude-only examples/claude-codex examples/claude-gemini examples/full-stack examples/specialist-agents
```

- [ ] **Step 4: Commit**

```bash
git add examples/
git commit -m "feat: example configs for all provider combinations"
```

---

### Task 10: README.md rewrite

**Files:**
- Rewrite: `README.md`

- [ ] **Step 1: Write README**

Sections:
- What ZeroAPI does (1 paragraph)
- How it works (plugin + skill diagram)
- Supported providers table (6 providers, no Anthropic, with pricing)
- Quick start (install plugin → run /zeroapi → done)
- Benchmark data source (AA API v2)
- Cost summary table
- Repo structure
- Anthropic notice with tweet reference
- Contributing / License

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for v3.0"
```

---

### Task 11: Update references

**Files:**
- Rewrite: `references/provider-config.md`
- Rewrite: `references/oauth-setup.md`
- Rewrite: `references/troubleshooting.md`

- [ ] **Step 1: Update provider-config.md**

Remove Anthropic. Add GLM (zai-coding-global), MiniMax (minimax-portal), Qwen (modelstudio). Update Google Gemini section (google-gemini-cli-auth removed, auto-load instead). Update OpenAI Codex section for GPT-5.4. Add plugin installation section.

- [ ] **Step 2: Update oauth-setup.md**

Remove Anthropic token sections. Update Codex OAuth for GPT-5.4. Add GLM/MiniMax/Qwen auth flows. Keep headless VPS tmux flow but update for current providers.

- [ ] **Step 3: Update troubleshooting.md**

Remove Anthropic errors. Add plugin-specific errors (zeroapi-config.json not found, plugin not loaded, routing log location). Add model availability check (`openclaw models status`). Add benchmark staleness warning.

- [ ] **Step 4: Commit**

```bash
git add references/
git commit -m "docs: update references for v3.0 (6 providers, plugin-based)"
```

---

### Task 12: Clean up old files

**Files:**
- Delete: `content/` references in README
- Delete: old example directories

- [ ] **Step 1: Remove deprecated content**

```bash
# Remove old example configs that reference Anthropic
rm -rf examples/claude-only examples/claude-codex examples/claude-gemini
rm -rf examples/full-stack/openclaw.json examples/full-stack/gemini-models.json
rm -rf examples/specialist-agents
```

- [ ] **Step 2: Update .gitignore if needed**

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: remove deprecated v2 files and Anthropic references"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run all plugin tests**

```bash
cd plugin && npx vitest run
```

Expected: ALL PASS

- [ ] **Step 2: Verify repo structure matches spec**

```bash
ls -R ZeroAPI/
```

- [ ] **Step 3: Verify no Anthropic references in active files**

```bash
grep -r "anthropic\|claude" --include="*.ts" --include="*.json" --include="*.md" | grep -v "docs/review-prompts" | grep -v "docs/superpowers" | grep -v "node_modules"
```

Expected: Only the exclusion notice in README.md and SKILL.md

- [ ] **Step 4: Verify benchmarks.json is valid**

```bash
python3 -c "import json; d=json.load(open('benchmarks.json')); print(f'{len(d[\"models\"])} models, version {d[\"version\"]}')"
```

Expected: `201 models, version 3.0.0`

- [ ] **Step 5: Tag release**

```bash
git tag -a v3.0.0 -m "ZeroAPI v3.0.0 — plugin-based benchmark-driven routing"
```
