import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStarterConfig, type StarterConfigOptions } from "../plugin/onboarding.js";

const root = resolve(import.meta.dirname, "..");
const presets: Record<string, StarterConfigOptions> = {
  "openai-only.json": { providers: [{ providerId: "openai-codex", tierId: "plus" }] },
  "subscription-profile.json": { providers: [{ providerId: "openai-codex", tierId: "plus" }] },
  "openai-multi-account.json": {
    providers: [],
    inventoryAccounts: [
      { accountId: "openai-personal", providerId: "openai-codex", tierId: "plus", authProfile: "openai:personal", usagePriority: 1, intendedUse: ["fast"] },
      { accountId: "openai-work", providerId: "openai-codex", tierId: "pro", authProfile: "openai:work", usagePriority: 2, intendedUse: ["code", "research"] },
    ],
  },
  "openai-glm.json": {
    providers: [{ providerId: "openai-codex", tierId: "plus" }, { providerId: "zai", tierId: "max" }],
  },
  "openai-glm-kimi.json": {
    providers: [
      { providerId: "openai-codex", tierId: "plus" },
      { providerId: "zai", tierId: "max" },
      { providerId: "moonshot", tierId: "moderato" },
    ],
  },
  "full-stack.json": {
    providers: [
      { providerId: "openai-codex", tierId: "plus" },
      { providerId: "zai", tierId: "max" },
      { providerId: "moonshot", tierId: "moderato" },
      { providerId: "minimax-portal", tierId: "starter" },
      { providerId: "qwen-oauth", tierId: "free" },
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
