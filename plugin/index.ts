import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { loadConfig } from "./config.js";
import { resolveRoutingDecision } from "./decision.js";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { initLogger, logRouting, logRoutingEvent } from "./logger.js";
import { syncSessionAuthProfileOverride } from "./session-auth.js";
import { startSubscriptionAdvisoryMonitor } from "./subscription-advisory.js";
import { maybePrefixChannelAdvisory } from "./advisory-delivery.js";
import type { TaskCategory } from "./types.js";

const PLUGIN_VERSION = "3.8.26";
const REGISTER_STATE_KEY = Symbol.for("zeroapi-router.register-state");

type RegisterState = {
  advisoryMonitorStarted?: boolean;
  registered: boolean;
  continuationState?: Map<string, { category: TaskCategory; updatedAt: number }>;
};

function getRegisterState(): RegisterState {
  const globalStore = globalThis as typeof globalThis & {
    [REGISTER_STATE_KEY]?: RegisterState;
  };
  globalStore[REGISTER_STATE_KEY] ??= { registered: false };
  return globalStore[REGISTER_STATE_KEY];
}

function resolveOpenClawDir(env: NodeJS.ProcessEnv = process.env): string {
  const stateDir = env.OPENCLAW_STATE_DIR?.trim();
  if (stateDir) {
    return stateDir;
  }

  const configPath = env.OPENCLAW_CONFIG_PATH?.trim();
  if (configPath) {
    return dirname(configPath);
  }

  return env.HOME ? `${env.HOME}/.openclaw` : "/root/.openclaw";
}

function getContinuationState(registerState: RegisterState): Map<string, { category: TaskCategory; updatedAt: number }> {
  registerState.continuationState ??= new Map();
  return registerState.continuationState;
}

function routeStateKey(ctx: Record<string, unknown>): string {
  const sessionKey = typeof ctx.sessionKey === "string" && ctx.sessionKey.trim()
    ? ctx.sessionKey.trim()
    : "";
  const agentId = typeof ctx.agentId === "string" && ctx.agentId.trim()
    ? ctx.agentId.trim()
    : "main";
  return sessionKey || `agent:${agentId}`;
}

function continuationCategories(config: { continuation_route_categories?: TaskCategory[] }): Set<TaskCategory> {
  return new Set(config.continuation_route_categories?.length
    ? config.continuation_route_categories
    : ["code", "research", "math"]);
}

export default definePluginEntry({
  id: "zeroapi-router",
  name: "ZeroAPI Router",
  description: "Balanced benchmark-aware model routing across subscription providers",

  register(api) {
    const openclawDir = resolveOpenClawDir();

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

    if (!registerState.advisoryMonitorStarted) {
      startSubscriptionAdvisoryMonitor({
        openclawDir,
        config,
        logger: api.logger,
      });
      registerState.advisoryMonitorStarted = true;
    }

    api.logger.info(
      `ZeroAPI Router v${PLUGIN_VERSION} loaded (policy config v${config.version}, mode=${config.routing_mode ?? "balanced"}${config.routing_modifier ? `, modifier=${config.routing_modifier}` : ""}, ${Object.keys(config.models).length} models, benchmarks from ${config.benchmarks_date})`
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
      const stateKey = routeStateKey(ctx as Record<string, unknown>);
      const state = getContinuationState(registerState);
      const previous = state.get(stateKey);
      const previousCategory = previous && Date.now() - previous.updatedAt < 1000 * 60 * 90
        ? previous.category
        : null;
      if (previous && previousCategory === null) {
        state.delete(stateKey);
      }
      const resolution = resolveRoutingDecision(config, {
        prompt: event.prompt,
        agentId: ctx.agentId,
        trigger: ctx.trigger,
        currentModel,
        previousCategory,
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
      let runtimeAuthProfileOverride = resolution.authProfileOverride;
      const shouldSyncSessionAuth =
        resolution.action === "route" ||
        (resolution.action === "stay" && resolution.reason.includes("no_switch_needed"));
      if (shouldSyncSessionAuth) {
        const syncResult = syncSessionAuthProfileOverride({
          openclawDir,
          agentId: ctx.agentId,
          sessionKey: "sessionKey" in ctx ? ctx.sessionKey : undefined,
          authProfileOverride: resolution.authProfileOverride,
        });
        if (syncResult.action === "blocked") {
          runtimeAuthProfileOverride = null;
          api.logger.warn(
            `ZeroAPI kept the user-pinned auth profile for ${syncResult.sessionKey ?? "unknown-session"} instead of replacing it with ${resolution.authProfileOverride ?? "none"}.`
          );
        }
        if (syncResult.reason === "user_pinned_preserved") {
          runtimeAuthProfileOverride = null;
        }
        if (
          syncResult.reason !== "already_current" &&
          syncResult.reason !== "no_auto_override_to_clear" &&
          syncResult.reason !== "user_pinned_preserved"
        ) {
          logRoutingEvent({
            agentId: ctx.agentId,
            category: "system",
            model: resolution.selectedModel,
            reason: `session_auth_sync:${syncResult.reason}`,
          });
        }
      }
      if (resolution.action === "route") {
        const categories = continuationCategories(config);
        if (resolution.finalDecision && categories.has(resolution.finalDecision.category)) {
          state.set(stateKey, {
            category: resolution.finalDecision.category,
            updatedAt: Date.now(),
          });
        }
        return {
          providerOverride: resolution.providerOverride!,
          modelOverride: resolution.modelOverride!,
          ...(runtimeAuthProfileOverride
            ? { authProfileOverride: runtimeAuthProfileOverride }
            : {}),
        };
      }
    });
    api.on("message_sending", (event, ctx) => {
      const content = maybePrefixChannelAdvisory(openclawDir, event, ctx);
      if (!content) {
        return;
      }
      return { content };
    });
    registerState.registered = true;
  },
});
