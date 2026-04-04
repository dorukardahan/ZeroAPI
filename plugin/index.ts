import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { loadConfig } from "./config.js";
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
      // Skip routing for specialist agents (null = don't route)
      const agentId = ctx.agentId;
      if (agentId && config.workspace_hints[agentId] === null) {
        return;
      }

      // Skip routing for cron/heartbeat triggers
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

      // Detect likely vision tasks from prompt keywords
      const visionSignals = ["image", "screenshot", "photo", "picture", "diagram", "chart", "graph", "visual", "logo", "icon", "UI", "mockup", "design"];
      const likelyVision = visionSignals.some(s => event.prompt.toLowerCase().includes(s.toLowerCase()));

      // Stage 1: Capability filter
      const tokenEstimate = estimateTokens(event.prompt);
      const isFast = decision.category === "fast";
      const capable = filterCapableModels(config.models, {
        estimatedTokens: tokenEstimate,
        maxTtftSeconds: isFast ? config.fast_ttft_max_seconds : undefined,
        requiresVision: likelyVision,
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

      // Parse provider/model
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
