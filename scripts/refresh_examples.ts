import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStarterConfig, type StarterConfigOptions } from "../plugin/onboarding.js";

const root = resolve(import.meta.dirname, "..");
const OPENAI_EXAMPLE_DISCOVERY = ["openai-codex/gpt-6.1-sol", "openai/gpt-6-sol"];
const OPENAI_PLUS = { providerId: "openai-codex", tierId: "plus", discoveredModels: OPENAI_EXAMPLE_DISCOVERY };
const presets: Record<string, StarterConfigOptions> = {
  "openai-only.json": { providers: [OPENAI_PLUS] },
  "subscription-profile.json": { providers: [OPENAI_PLUS] },
  "openai-multi-account.json": {
    providers: [],
    inventoryAccounts: [
      { accountId: "openai-personal", providerId: "openai-codex", tierId: "plus", authProfile: "openai:personal", usagePriority: 1, intendedUse: ["fast"], discoveredModels: OPENAI_EXAMPLE_DISCOVERY },
      { accountId: "openai-work", providerId: "openai-codex", tierId: "pro", authProfile: "openai:work", usagePriority: 2, intendedUse: ["code", "research"], discoveredModels: OPENAI_EXAMPLE_DISCOVERY },
    ],
  },
  "openai-glm.json": {
    providers: [OPENAI_PLUS, { providerId: "zai", tierId: "max" }],
  },
  "openai-glm-kimi.json": {
    providers: [
      OPENAI_PLUS,
      { providerId: "zai", tierId: "max" },
      { providerId: "kimi", tierId: "moderato" },
    ],
  },
  "grok-supergrok.json": {
    providers: [{ providerId: "xai", tierId: "supergrok" }],
  },
  "full-stack.json": {
    providers: [
      OPENAI_PLUS,
      { providerId: "zai", tierId: "max" },
      { providerId: "kimi", tierId: "moderato" },
      { providerId: "minimax-portal", tierId: "starter" },
      { providerId: "xai", tierId: "supergrok" },
    ],
  },
};

for (const [name, options] of Object.entries(presets)) {
  const config = buildStarterConfig(options);
  config.generated = `${config.benchmarks_date}T00:00:00.000Z`;
  writeFileSync(resolve(root, "examples", name), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`updated examples/${name}`);
}
