#!/usr/bin/env npx tsx

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import {
  applyOpenClawAgentAlignment,
  auditOpenClawAgentModels,
  inferWorkspaceHintsFromOpenClawConfig,
  type OpenClawConfig,
} from "../plugin/agent-audit.js";
import {
  buildStarterConfig,
  deriveStarterDefaults,
  getStarterAuthCommands,
  getStarterProviders,
  getStarterTierChoices,
  summarizeStarterConfig,
  type StarterInventoryAccountInput,
  type StarterProviderSelection,
} from "../plugin/onboarding.js";
import { listPendingSubscriptionAdvisoryItems, readPendingSubscriptionAdvisory } from "../plugin/subscription-advisory.js";
import type { RoutingModifier, TaskCategory, ZeroAPIConfig } from "../plugin/types.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..");
const TASK_CATEGORIES: TaskCategory[] = ["code", "research", "orchestration", "math", "fast", "default"];
const MODIFIER_CHOICES: Array<{ label: string; value: RoutingModifier | undefined }> = [
  { label: "balanced (önerilen varsayılan)", value: undefined },
  { label: "coding-aware", value: "coding-aware" },
  { label: "research-aware", value: "research-aware" },
  { label: "speed-aware", value: "speed-aware" },
];

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let openclawDir = `${process.env.HOME ?? "/root"}/.openclaw`;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--openclaw-dir" && argv[index + 1]) {
      openclawDir = argv[++index];
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  npm run first-run
  npm run first-run -- --openclaw-dir ~/.openclaw

This interactive wizard writes a starter zeroapi-config.json for the selected providers.
`);
      process.exit(0);
    }
    fail(`Unknown argument: ${arg}`);
  }

  return { openclawDir: resolve(openclawDir) };
}

function parseMultiSelect(value: string, max: number): number[] {
  const indices = value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((item) => Number.isFinite(item) && item >= 1 && item <= max)
    .map((item) => item - 1);

  return Array.from(new Set(indices));
}

async function askNonEmpty(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  defaultValue?: string,
): Promise<string> {
  while (true) {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
    const value = answer || defaultValue;
    if (value && value.trim()) return value.trim();
    console.log("This value cannot be empty.");
  }
}

async function askYesNo(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  defaultValue = true,
): Promise<boolean> {
  const suffix = defaultValue ? " [Y/n]" : " [y/N]";
  while (true) {
    const answer = (await rl.question(`${prompt}${suffix}: `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    console.log("Please enter y or n.");
  }
}

async function askChoice<T>(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  options: Array<{ label: string; value: T }>,
): Promise<T> {
  console.log(`\n${prompt}`);
  options.forEach((option, index) => {
    console.log(`  ${index + 1}. ${option.label}`);
  });

  while (true) {
    const raw = (await rl.question("Seçim numarası: ")).trim();
    const index = Number.parseInt(raw, 10);
    if (Number.isFinite(index) && index >= 1 && index <= options.length) {
      return options[index - 1].value;
    }
    console.log("Geçerli bir numara gir.");
  }
}

async function askChoiceWithDefault<T>(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  options: Array<{ label: string; value: T }>,
  defaultValue: T,
): Promise<T> {
  console.log(`\n${prompt}`);
  let defaultIndex = -1;
  options.forEach((option, index) => {
    if (Object.is(option.value, defaultValue)) {
      defaultIndex = index;
    }
    console.log(`  ${index + 1}. ${option.label}`);
  });

  while (true) {
    const suffix = defaultIndex >= 0 ? ` [${defaultIndex + 1}]` : "";
    const raw = (await rl.question(`Seçim numarası${suffix}: `)).trim();
    if (!raw && defaultIndex >= 0) {
      return options[defaultIndex].value;
    }
    const index = Number.parseInt(raw, 10);
    if (Number.isFinite(index) && index >= 1 && index <= options.length) {
      return options[index - 1].value;
    }
    console.log("Geçerli bir numara gir.");
  }
}

async function askInt(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  defaultValue: number,
  min: number,
  max: number,
): Promise<number> {
  while (true) {
    const answer = (await rl.question(`${prompt} [${defaultValue}]: `)).trim();
    const value = answer ? Number.parseInt(answer, 10) : defaultValue;
    if (Number.isFinite(value) && value >= min && value <= max) {
      return value;
    }
    console.log(`Please enter a number between ${min} and ${max}.`);
  }
}

async function askOptional(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  defaultValue?: string,
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
  return answer || defaultValue || "";
}

function parseIntendedUse(value: string): TaskCategory[] | undefined {
  if (!value.trim()) return undefined;
  const normalized = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const categories = normalized.filter((item): item is TaskCategory =>
    TASK_CATEGORIES.includes(item as TaskCategory),
  );

  return categories.length > 0 ? Array.from(new Set(categories)) : undefined;
}

function formatIntendedUse(value?: TaskCategory[]): string | undefined {
  if (!value || value.length === 0) return undefined;
  return value.join(",");
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function readDetectedWorkspaceHints(openclawDir: string): Record<string, TaskCategory[] | null> {
  const openclawConfigPath = resolve(openclawDir, "openclaw.json");
  if (!existsSync(openclawConfigPath)) return {};

  try {
    const cfg = readJsonFile<OpenClawConfig>(openclawConfigPath);
    return inferWorkspaceHintsFromOpenClawConfig(cfg);
  } catch (error) {
    console.log(`\nOpenClaw agent model listesi okunamadı: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function commandExists(command: string): boolean {
  const result = spawnSync("bash", ["-c", `command -v ${command}`], { encoding: "utf-8" });
  return result.status === 0;
}

function runCommand(command: string, args: string[]) {
  return spawnSync(command, args, { stdio: "inherit" });
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rl = createInterface({ input, output });

  try {
    console.log("ZeroAPI First Run Wizard");
    console.log("This tool creates a working starter zeroapi-config.json.");

    if (!existsSync(args.openclawDir)) {
      const createDir = await askYesNo(
        rl,
        `${args.openclawDir} was not found. Create it?`,
        true,
      );
      if (!createDir) {
        fail("Cannot continue without an OpenClaw directory.");
      }
      mkdirSync(args.openclawDir, { recursive: true });
    }

    const targetFile = resolve(args.openclawDir, "zeroapi-config.json");
    let existingConfig: ZeroAPIConfig | null = null;
    let starterDefaults:
      | ReturnType<typeof deriveStarterDefaults>
      | null = null;
    if (existsSync(targetFile)) {
      try {
        existingConfig = readJsonFile<ZeroAPIConfig>(targetFile);
        starterDefaults = deriveStarterDefaults(existingConfig);
        const summary = summarizeStarterConfig(existingConfig);
        console.log("\nMevcut ZeroAPI durumu");
        console.log(`- provider'lar: ${summary.providerLabels.join(", ") || "yok"}`);
        console.log(`- modifier: ${summary.modifier}`);
        console.log(`- default_model: ${summary.defaultModel}`);
        console.log(`- inventory hesap sayısı: ${summary.inventoryAccountCount}`);
      } catch (error) {
        console.log(`\nMevcut config okunamadı: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const detectedWorkspaceHints = readDetectedWorkspaceHints(args.openclawDir);
    const workspaceHints = {
      ...detectedWorkspaceHints,
      ...(existingConfig?.workspace_hints ?? {}),
    };
    const protectedAgents = Object.entries(workspaceHints)
      .filter(([, hint]) => hint === null)
      .map(([agentId]) => agentId);
    if (protectedAgents.length > 0) {
      console.log(`\nKorunan agent model ayarları: ${protectedAgents.join(", ")}`);
      console.log("- Bu agent'lar OpenClaw'daki kendi model seçiminde kalır; route etmek istersen workspace_hints değerini kategori listesine çevir.");
    }
    const routedAgents = Object.entries(workspaceHints)
      .filter(([, hint]) => Array.isArray(hint) && hint.length > 0)
      .map(([agentId, hint]) => `${agentId} (${(hint as TaskCategory[]).join(",")})`);
    if (routedAgents.length > 0) {
      console.log(`\nZeroAPI-managed agent candidates: ${routedAgents.join(", ")}`);
      console.log("- OpenClaw model catalog entries and safe startup models can be aligned for these agents.");
    }

    const pendingAdvisory = readPendingSubscriptionAdvisory(args.openclawDir);
    if (pendingAdvisory) {
      console.log("\nZeroAPI detected new subscription drift for this rerun");
      for (const item of listPendingSubscriptionAdvisoryItems(pendingAdvisory)) {
        console.log(`- ${item}`);
      }
      console.log("- The policy will be updated to include these additions at the end of this run.");
    }

    if (existsSync(targetFile)) {
      const overwrite = await askYesNo(
        rl,
        `${targetFile} already exists. Regenerate and overwrite it?`,
        Boolean(pendingAdvisory),
      );
      if (!overwrite) {
        console.log("İptal edildi.");
        return;
      }
    }

    const providers = getStarterProviders();
    console.log("\nDesteklenen provider'lar:");
    providers.forEach((provider, index) => {
      const tiers = getStarterTierChoices(provider.openclawProviderId).map((tier) => tier.label).join(", ");
      console.log(`  ${index + 1}. ${provider.label} (${provider.openclawProviderId}) - ${provider.authMode} - tier'lar: ${tiers}`);
    });

    let selectedProviderIndexes: number[] = [];
    const defaultProviderIndexes = (starterDefaults?.providers ?? [])
      .map((selection) => providers.findIndex((provider) => provider.openclawProviderId === selection.providerId))
      .filter((index) => index >= 0);
    const defaultProviderAnswer =
      defaultProviderIndexes.length > 0
        ? defaultProviderIndexes.map((index) => `${index + 1}`).join(",")
        : undefined;
    while (selectedProviderIndexes.length === 0) {
      const suffix = defaultProviderAnswer ? ` [${defaultProviderAnswer}]` : "";
      const answer = (
        await rl.question(`\nHangi provider'ları starter havuza almak istiyorsun? (örn: 1,3)${suffix}: `)
      ).trim();
      selectedProviderIndexes = parseMultiSelect(answer || defaultProviderAnswer || "", providers.length);
      if (selectedProviderIndexes.length === 0) {
        console.log("En az bir provider seç.");
      }
    }

    const providerSelections: StarterProviderSelection[] = [];
    const inventoryAccounts: StarterInventoryAccountInput[] = [];
    const providerDefaults = new Map((starterDefaults?.providers ?? []).map((provider) => [provider.providerId, provider]));
    const inventoryDefaultsByProvider = new Map<string, StarterInventoryAccountInput[]>();
    for (const account of starterDefaults?.inventoryAccounts ?? []) {
      const next = inventoryDefaultsByProvider.get(account.providerId) ?? [];
      next.push(account);
      inventoryDefaultsByProvider.set(account.providerId, next);
    }

    for (const providerIndex of selectedProviderIndexes) {
      const provider = providers[providerIndex];
      const tierChoices = getStarterTierChoices(provider.openclawProviderId);
      if (tierChoices.length === 0) {
        fail(`No available tiers found for ${provider.label}.`);
      }

      const existingAccounts = inventoryDefaultsByProvider.get(provider.openclawProviderId) ?? [];
      const multiAccount = await askYesNo(
        rl,
        `${provider.label} için aynı provider altında birden fazla hesap kurmak istiyor musun?`,
        existingAccounts.length > 0,
      );

      if (!multiAccount) {
        const tierOptions = tierChoices.map((tier) => ({
          label: `${tier.label} (${tier.tierId})`,
          value: tier.tierId,
        }));
        const defaultTierId = providerDefaults.get(provider.openclawProviderId)?.tierId;
        const tierId = defaultTierId
          ? await askChoiceWithDefault(rl, `${provider.label} tier seç`, tierOptions, defaultTierId)
          : await askChoice(rl, `${provider.label} tier seç`, tierOptions);

        providerSelections.push({
          providerId: provider.openclawProviderId,
          tierId,
        });
        continue;
      }

      const accountCount = await askInt(
        rl,
        `${provider.label} için kaç hesap tanımlayacaksın?`,
        existingAccounts.length || 2,
        1,
        10,
      );

      const defaultInventoryTier =
        providerDefaults.get(provider.openclawProviderId)?.tierId ??
        tierChoices[tierChoices.length - 1]?.tierId ??
        tierChoices[0].tierId;
      providerSelections.push({
        providerId: provider.openclawProviderId,
        tierId: defaultInventoryTier,
      });

      for (let accountIndex = 0; accountIndex < accountCount; accountIndex++) {
        console.log(`\n${provider.label} hesap ${accountIndex + 1}/${accountCount}`);
        const accountDefaults = existingAccounts[accountIndex];
        const accountId = await askNonEmpty(
          rl,
          "accountId",
          accountDefaults?.accountId ?? `${provider.openclawProviderId}-account-${accountIndex + 1}`,
        );
        const tierOptions = tierChoices.map((tier) => ({
          label: `${tier.label} (${tier.tierId})`,
          value: tier.tierId,
        }));
        const tierId = accountDefaults?.tierId
          ? await askChoiceWithDefault(rl, "Tier seç", tierOptions, accountDefaults.tierId)
          : await askChoice(rl, "Tier seç", tierOptions);
        const authProfileRaw = await askOptional(
          rl,
          "authProfile (opsiyonel, boş bırak geç)",
          accountDefaults?.authProfile ?? undefined,
        );
        const usagePriority = await askInt(
          rl,
          "usagePriority (0-3, büyük = daha çok tercih)",
          accountDefaults?.usagePriority ?? 1,
          0,
          3,
        );
        const intendedUseRaw = await askOptional(
          rl,
          "intendedUse (virgülle ayır: code,research,fast,default,orchestration,math | boş = hepsi)",
          formatIntendedUse(accountDefaults?.intendedUse),
        );

        inventoryAccounts.push({
          accountId,
          providerId: provider.openclawProviderId,
          tierId,
          authProfile: authProfileRaw.trim() || undefined,
          usagePriority,
          intendedUse: parseIntendedUse(intendedUseRaw),
        });
      }
    }

    const effectiveRoutingModifier = existingConfig
      ? await askChoiceWithDefault(
          rl,
          "Varsayılan balanced üstüne modifier istiyor musun?",
          MODIFIER_CHOICES,
          starterDefaults?.routingModifier,
        )
      : await askChoice(
          rl,
          "Varsayılan balanced üstüne modifier istiyor musun?",
          MODIFIER_CHOICES,
        );

    const config = buildStarterConfig({
      providers: providerSelections,
      routingModifier: effectiveRoutingModifier,
      inventoryAccounts,
      workspaceHints,
    });

    console.log("\nÖzet");
    console.log(`- hedef dosya: ${targetFile}`);
    console.log(`- default_model: ${config.default_model}`);
    console.log(`- routing_mode: ${config.routing_mode}`);
    console.log(`- routing_modifier: ${config.routing_modifier ?? "balanced only"}`);
    console.log(`- provider sayısı: ${providerSelections.length}`);
    console.log(`- inventory hesap sayısı: ${inventoryAccounts.length}`);

    const writeNow = await askYesNo(rl, "Config dosyasını yazayım mı?", true);
    if (!writeNow) {
      console.log("Yazmadan çıktım.");
      return;
    }

    writeFileSync(targetFile, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    console.log(`\nYazıldı: ${targetFile}`);

    const openclawConfigPath = resolve(args.openclawDir, "openclaw.json");
    if (existsSync(openclawConfigPath)) {
      try {
        const openclawConfig = readJsonFile<OpenClawConfig>(openclawConfigPath);
        const agentReport = auditOpenClawAgentModels(config, openclawConfig);
        const needsAgentAlignment = agentReport.catalogMissing.length > 0 || agentReport.counts.change > 0;
        if (needsAgentAlignment) {
          console.log("\nOpenClaw agent/model alignment summary");
          console.log(`- missing model catalog entries: ${agentReport.catalogMissing.length}`);
          console.log(`- agent baseline changes: ${agentReport.counts.change}`);
          for (const item of agentReport.items.filter((entry) => entry.action === "change")) {
            console.log(`- ${item.id}: ${item.suggestedModel} (${item.suggestedFallbacks.join(", ") || "no fallbacks"})`);
          }
          const alignNow = await askYesNo(
            rl,
            "Align OpenClaw model catalog entries and routed agent startup models now?",
            true,
          );
          if (alignNow) {
            const result = applyOpenClawAgentAlignment(openclawConfig, agentReport);
            const backupPath = `${openclawConfigPath}.zeroapi-agent.${timestamp()}.bak`;
            copyFileSync(openclawConfigPath, backupPath);
            writeFileSync(openclawConfigPath, `${JSON.stringify(result.config, null, 2)}\n`, "utf-8");
            console.log(`- openclaw.json backup: ${backupPath}`);
            console.log(`- catalog entries added: ${result.catalogAdded.length}`);
            console.log(`- agents aligned: ${result.applied.length}`);
          }
        }
      } catch (error) {
        console.log(`\nOpenClaw agent/model alignment skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const selectedProviderIds = providerSelections.map((provider) => provider.providerId);
    const authCommands = getStarterAuthCommands(selectedProviderIds);
    if (authCommands.length > 0) {
      console.log("\nRequired auth commands:");
      authCommands.forEach((command) => console.log(`- ${command}`));
    }

    if (commandExists("openclaw")) {
      const managedInstall = await askYesNo(
        rl,
        "Install ZeroAPI in managed mode? This syncs the skill and plugin together and tries to install an automatic minor/patch update timer.",
        true,
      );

      if (managedInstall) {
        const result = runCommand(process.execPath, [resolve(REPO_ROOT, "scripts", "managed_install.mjs"), "--openclaw-dir", args.openclawDir]);
        if (result.status !== 0) {
          console.log("\nManaged install failed. Run this manually as a fallback:");
          console.log(`${process.execPath} ${resolve(REPO_ROOT, "scripts", "managed_install.mjs")} --openclaw-dir ${args.openclawDir}`);
        }
      } else {
        const installPlugin = await askYesNo(
          rl,
          "Install only the plugin from this repo's plugin directory now?",
          true,
        );

        if (installPlugin) {
          const result = runCommand("openclaw", ["plugins", "install", resolve(REPO_ROOT, "plugin")]);
          if (result.status !== 0) {
            console.log("\nPlugin install failed. Run this manually:");
            console.log(`openclaw plugins install ${resolve(REPO_ROOT, "plugin")}`);
          }
        }
      }
    } else {
      console.log("\nopenclaw CLI is not visible in PATH. Install the plugin manually later:");
      console.log(`openclaw plugins install ${resolve(REPO_ROOT, "plugin")}`);
    }

    console.log("\nNext steps");
    console.log("1. Connect the selected providers with the auth commands above.");
    console.log("2. openclaw models status");
    console.log("3. bash scripts-zeroapi-doctor.sh");
    console.log('4. npm run simulate -- --prompt "refactor the auth module"');
    console.log("5. Compare modifier behavior with compare_modifiers if needed.");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
