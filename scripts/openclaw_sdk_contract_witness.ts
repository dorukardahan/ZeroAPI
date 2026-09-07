import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { patchSessionEntry } from "openclaw/plugin-sdk/session-store-runtime";
// Current hosts ship the broad `types` barrel as JavaScript without a .d.ts.
// Derive the exact hook result from the typed public registration API instead
// of silently treating a missing declaration as `any`.
declare const hookApi: OpenClawPluginApi;
type ModelHandler = Parameters<typeof hookApi.on<"before_model_resolve">>[1];
type MessageHandler = Parameters<typeof hookApi.on<"message_sending">>[1];
type PluginHookBeforeModelResolveResult = Exclude<Awaited<ReturnType<ModelHandler>>, void>;
type PluginHookMessageSendingResult = Exclude<Awaited<ReturnType<MessageHandler>>, void>;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const modelContractIsAny: IsAny<PluginHookBeforeModelResolveResult> = false;

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
    api.registerService({ id: "zeroapi-service-witness", start() {}, stop() {} });
    api.on("before_model_resolve", async () => validModelResult);
    api.on("message_sending", async () => validMessageResult);
  },
});
void entry;
void sessionPatchWitness;
void unsupportedAuthResult;
void modelContractIsAny;
