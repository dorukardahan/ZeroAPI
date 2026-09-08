import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import * as sessionStoreRuntime from "openclaw/plugin-sdk/session-store-runtime";
import { loadConfig, getConfigLoadStatus } from "./config.js";
import { resolveRoutingDecision } from "./decision.js";
import { dirname } from "path";
import { initLogger, logRouting, logRoutingEvent } from "./logger.js";
import {
  createSessionEntryPatcher,
  syncSessionAuthProfileOverride,
  type HostSessionStoreRuntime,
} from "./session-auth.js";
import { startSubscriptionAdvisoryMonitor } from "./subscription-advisory.js";
import { maybePrefixChannelAdvisory } from "./advisory-delivery.js";
import { readPreviousCategory, recordRouteCategory } from "./route-state.js";
import type { TaskCategory } from "./types.js";

const PLUGIN_VERSION = "3.11.1";
const REGISTER_STATE_KEY = Symbol.for("zeroapi-router.register-state");

type RegisterState = {
  registered: boolean;
  continuationState?: Map<string, { category: TaskCategory; updatedAt: number }>;
};

function getRegisterState(api: object): RegisterState {
  const globalStore = globalThis as typeof globalThis & {
    [REGISTER_STATE_KEY]?: WeakMap<object, RegisterState>;
  };
  // A discovery pass and a replacement runtime own different registries, even
  // when OpenClaw reuses this module in the same process.
  if (!(globalStore[REGISTER_STATE_KEY] instanceof WeakMap)) {
    globalStore[REGISTER_STATE_KEY] = new WeakMap();
  }
  const states = globalStore[REGISTER_STATE_KEY];
  let state = states.get(api);
  if (!state) {
    state = { registered: false };
    states.set(api, state);
  }
  return state;
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
    if (["cli-metadata", "setup-only", "setup-runtime"].includes(api.registrationMode)) {
      return;
    }
    const registerState = getRegisterState(api);
    if (registerState.registered) {
      return;
    }
    const openclawDir = resolveOpenClawDir();
    const hostConfig = api.config;
    const configuredSessionStore = typeof hostConfig?.session?.store === "string"
      ? hostConfig.session.store
      : undefined;
    const patchSessionEntry = createSessionEntryPatcher(
      sessionStoreRuntime as unknown as HostSessionStoreRuntime,
      configuredSessionStore,
    );

    const config = loadConfig(openclawDir);
    const isRuntimeRegistration = !api.registrationMode || api.registrationMode === "full";
    if (isRuntimeRegistration) {
      initLogger(openclawDir);
    }

    if (!config) {
      const status = getConfigLoadStatus();
      if (status === "invalid" || status === "parse_error") {
        api.logger.warn(
          `zeroapi-config.json failed to load (${status}); routing is disabled until it is fixed. Run /zeroapi to regenerate.`
        );
        if (isRuntimeRegistration) {
          logRoutingEvent({ category: "system", reason: `config_${status}` });
        }
      } else {
        api.logger.warn("zeroapi-config.json not found. Run /zeroapi to configure.");
        if (isRuntimeRegistration) {
          logRoutingEvent({ category: "system", reason: "config_missing" });
        }
      }
      return;
    }

    let monitor: ReturnType<typeof startSubscriptionAdvisoryMonitor> | undefined;
    api.registerService({
      id: "zeroapi-router-advisories",
      start() {
        initLogger(openclawDir);
        monitor ??= startSubscriptionAdvisoryMonitor({ openclawDir, config, logger: api.logger });
      },
      stop() {
        monitor?.stop();
        monitor = undefined;
      },
    });

    api.logger.info(
      `ZeroAPI Router v${PLUGIN_VERSION} loaded (policy config v${config.version}, mode=${config.routing_mode ?? "balanced"}${config.routing_modifier ? `, modifier=${config.routing_modifier}` : ""}, ${Object.keys(config.models).length} models, benchmarks from ${config.benchmarks_date})`
    );

    const hostDefault = hostConfig?.agents?.defaults?.model;
    const runtimeDefault = typeof hostDefault === "string" ? hostDefault : hostDefault?.primary;
    if (typeof runtimeDefault === "string" && runtimeDefault !== config.default_model) {
      api.logger.warn(
        `ZeroAPI default_model (${config.default_model}) does not match the OpenClaw runtime default (${runtimeDefault}). Routing policy and runtime default are out of sync.`
      );
      if (isRuntimeRegistration) {
        logRoutingEvent({
          category: "system",
          reason: `default_mismatch:${config.default_model}->${runtimeDefault}`,
          model: runtimeDefault,
        });
      }
    }

    api.on("before_model_resolve", async (event, ctx) => {
      const currentModel = ctx.modelId
        ? `${ctx.modelProviderId}/${ctx.modelId}`
        : config.default_model;
      const stateKey = routeStateKey(ctx as Record<string, unknown>);
      const state = getContinuationState(registerState);
      const previousCategory = readPreviousCategory(state, stateKey, Date.now());
      const resolution = resolveRoutingDecision(config, {
        prompt: event.prompt,
        // Older supported hosts omit attachments. Only actual images assert
        // the vision requirement; a PDF/audio attachment is not an image.
        hasImageAttachment: "attachments" in event && Array.isArray(event.attachments)
          ? event.attachments.some((attachment) => attachment?.kind === "image")
          : false,
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
        const syncResult = await syncSessionAuthProfileOverride({
          agentId: ctx.agentId,
          sessionKey: "sessionKey" in ctx ? ctx.sessionKey : undefined,
          authProfileOverride: resolution.authProfileOverride,
          patchSessionEntry,
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
        if (syncResult.reason === "session_store_update_failed") {
          runtimeAuthProfileOverride = null;
          api.logger.warn(
            "ZeroAPI could not persist the auth-profile override through OpenClaw's session API; model routing remains active."
          );
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
          recordRouteCategory(state, stateKey, resolution.finalDecision.category, Date.now());
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
    if (config.channel_advisories_enabled !== false) {
      api.on("message_sending", (event, ctx) => {
        const content = maybePrefixChannelAdvisory(openclawDir, event, ctx);
        if (!content) {
          return;
        }
        return { content };
      });
    }
    registerState.registered = true;
  },
});
