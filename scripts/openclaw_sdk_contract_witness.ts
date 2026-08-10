import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { patchSessionEntry } from "openclaw/plugin-sdk/session-store-runtime";
import type {
  PluginHookBeforeModelResolveResult,
  PluginHookMessageSendingResult,
} from "openclaw/plugin-sdk/types";

const validModelResult: PluginHookBeforeModelResolveResult = {
  providerOverride: "openai-codex",
  modelOverride: "gpt-5.4",
};

const unsupportedAuthResult: PluginHookBeforeModelResolveResult = {
  // @ts-expect-error The exact host does not expose same-turn account routing.
  authProfileOverride: "openai-codex:default",
};

const validMessageResult: PluginHookMessageSendingResult = { content: "ok" };
const sessionPatchWitness = patchSessionEntry({
  agentId: "main",
  preserveActivity: true,
  sessionKey: "agent:main:main",
  update: (entry) => ({
    authProfileOverride: entry.authProfileOverride ?? "openai-codex:default",
    authProfileOverrideSource: "auto",
  }),
});
const entry = definePluginEntry({
  id: "zeroapi-contract-witness",
  name: "ZeroAPI contract witness",
  description: "Compile-only OpenClaw compatibility witness",
  register(api: OpenClawPluginApi) {
    api.on("before_model_resolve", async () => validModelResult);
    api.on("message_sending", async () => validMessageResult);
  },
});
void entry;
void sessionPatchWitness;
void unsupportedAuthResult;
