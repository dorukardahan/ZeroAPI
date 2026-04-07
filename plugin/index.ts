import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { loadConfig } from "./config.js";
import { classifyTask } from "./classifier.js";
import { filterCapableModels, estimateTokens } from "./filter.js";
import { selectModel } from "./selector.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { initLogger, logRouting, logRoutingEvent } from "./logger.js";
import { isModelAllowedBySubscriptionProfile } from "./profile.js";
import { getSubscriptionWeightedCandidates } from "./router.js";

export default definePluginEntry({
  id: "zeroapi-router",
  name: "ZeroAPI Router",
  description: "Benchmark-driven model routing across subscription providers",

  register(api) {
    const openclawDir = process.env.HOME
      ? `${process.env.HOME}/.openclaw`
      : "/root/.openclaw";

    const config = loadConfig(openclawDir);
    initLogger(openclawDir);

    if (!config) {
      api.logger.warn("zeroapi-config.json not found. Run /zeroapi to configure.");
      logRoutingEvent({ category: "system", reason: "config_missing" });
      return;
    }

    api.logger.info(`ZeroAPI Router v${config.version} loaded (${Object.keys(config.models).length} models, benchmarks from ${config.benchmarks_date})`);

    try {
      const openclawConfigPath = join(openclawDir, "openclaw.json");
      if (existsSync(openclawConfigPath)) {
        const openclawConfig = JSON.parse(readFileSync(openclawConfigPath, "utf-8"));
        const runtimeDefault = openclawConfig?.agents?.defaults?.model?.primary;
        if (typeof runtimeDefault === "string" && runtimeDefault !== config.default_model) {
          api.logger.warn(
            `ZeroAPI default_model (${config.default_model}) does not match openclaw.json runtime default (${runtimeDefault}). Routing policy and runtime default are out of sync.`
          );
          logRoutingEvent({
            category: "system",
            reason: `default_mismatch:${config.default_model}->${runtimeDefault}`,
            model: runtimeDefault,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      api.logger.warn(`ZeroAPI runtime config check failed: ${message}`);
      logRoutingEvent({ category: "system", reason: `runtime_config_check_failed:${message}` });
    }

    api.on("before_model_resolve", (event, ctx) => {
      const agentId = ctx.agentId;
      if (agentId && config.workspace_hints[agentId] === null) {
        logRoutingEvent({ agentId, category: "system", reason: "skip:specialist_agent" });
        return;
      }

      if (ctx.trigger === "cron" || ctx.trigger === "heartbeat") {
        logRoutingEvent({ agentId, category: "system", reason: `skip:trigger:${ctx.trigger}` });
        return;
      }

      const workspaceHints = agentId ? config.workspace_hints[agentId] : undefined;
      const decision = classifyTask(
        event.prompt,
        config.keywords,
        config.high_risk_keywords,
        workspaceHints,
      );

      if (decision.risk === "high") {
        logRouting(agentId, { ...decision, model: null, reason: `high_risk:${decision.reason}` });
        return;
      }

      if (decision.category === "default") {
        logRouting(agentId, decision);
        return;
      }

      const visionSignals = ["image", "screenshot", "photo", "picture", "diagram", "chart", "graph", "visual", "logo", "icon", "UI", "mockup", "design"];
      const likelyVision = visionSignals.some(s => event.prompt.toLowerCase().includes(s.toLowerCase()));

      const tokenEstimate = estimateTokens(event.prompt);
      const isFast = decision.category === "fast";
      const capable = Object.fromEntries(
        Object.entries(
          filterCapableModels(config.models, {
            estimatedTokens: tokenEstimate,
            maxTtftSeconds: isFast ? config.fast_ttft_max_seconds : undefined,
            requiresVision: likelyVision,
          }),
        ).filter(([modelKey]) =>
          isModelAllowedBySubscriptionProfile(config.subscription_profile, agentId, modelKey),
        ),
      );

      const currentModel = ctx.modelId
        ? `${ctx.modelProviderId}/${ctx.modelId}`
        : config.default_model;

      const weightedCandidates = getSubscriptionWeightedCandidates(
        decision.category,
        capable,
        config.routing_rules,
        config.subscription_profile,
        agentId,
      );

      const selectedModel = weightedCandidates.length > 0
        ? selectModel(
            decision.category,
            Object.fromEntries(weightedCandidates.map((candidate) => [candidate, capable[candidate]])),
            {
              ...config.routing_rules,
              [decision.category]: {
                primary: weightedCandidates[0],
                fallbacks: weightedCandidates.slice(1),
              },
            },
            currentModel,
          )
        : null;

      if (!selectedModel) {
        logRouting(agentId, { ...decision, model: null, reason: `${decision.reason}:no_switch_needed` });
        return;
      }

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
