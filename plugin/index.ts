import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { loadConfig } from "./config.js";
import { resolveRoutingDecision } from "./decision.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { initLogger, logRouting, logRoutingEvent } from "./logger.js";

const PLUGIN_VERSION = "3.2.4";
const REGISTER_STATE_KEY = Symbol.for("zeroapi-router.register-state");

type RegisterState = {
  registered: boolean;
};

function getRegisterState(): RegisterState {
  const globalStore = globalThis as typeof globalThis & {
    [REGISTER_STATE_KEY]?: RegisterState;
  };
  globalStore[REGISTER_STATE_KEY] ??= { registered: false };
  return globalStore[REGISTER_STATE_KEY];
}

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

    const registerState = getRegisterState();
    if (registerState.registered) {
      return;
    }

    api.logger.info(
      `ZeroAPI Router v${PLUGIN_VERSION} loaded (policy config v${config.version}, ${Object.keys(config.models).length} models, benchmarks from ${config.benchmarks_date})`
    );

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
      const currentModel = ctx.modelId
        ? `${ctx.modelProviderId}/${ctx.modelId}`
        : config.default_model;
      const resolution = resolveRoutingDecision(config, {
        prompt: event.prompt,
        agentId: ctx.agentId,
        trigger: ctx.trigger,
        currentModel,
      });

      if (resolution.action === "skip") {
        logRoutingEvent({
          agentId: ctx.agentId,
          category: "system",
          reason: resolution.reason,
        });
        return;
      }

      if (!resolution.finalDecision) {
        return;
      }

      logRouting(ctx.agentId, resolution);
      if (resolution.action === "route") {
        return {
          providerOverride: resolution.providerOverride!,
          modelOverride: resolution.modelOverride!,
        };
      }
    });
    registerState.registered = true;
  },
});
