#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Import the host only after creating synthetic state, never the operator's
// HOME, config, credentials, or session database.
const stagedPluginDir = resolve(process.argv[2] || "/tmp/zeroapi-staged");
const expectedLayout = process.argv[3] || "json";
const expectedDispatch = process.argv[4] || "callback";
const fixtureName = process.argv[5] || "legacy";
assert.ok(["json", "sqlite"].includes(expectedLayout), "unknown session layout");
assert.ok(["callback", "native", "source"].includes(expectedDispatch), "unknown hook dispatch mode");
if (expectedDispatch === "source") assert.ok(process.argv[6], "an audited source hook bundle is required");
assert.ok(["legacy", "current"].includes(fixtureName), "unknown synthetic fixture");
const entryPath = join(stagedPluginDir, "index.js");
assert.ok(existsSync(entryPath), "staged plugin entry is missing");
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__",
  fixtureName === "current" ? "openclaw-current" : "openclaw", "zeroapi-config.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const expectedProvider = fixtureName === "current" ? "openai" : "openai-codex";
const stateDir = mkdtempSync(join(tmpdir(), "zeroapi-openclaw-compat-"));
process.env.HOME = stateDir;
process.env.OPENCLAW_STATE_DIR = stateDir;
process.env.OPENCLAW_CONFIG_PATH = join(stateDir, "openclaw.json");
const hostConfig = {
  agents: { defaults: { model: { primary: fixture.default_model } } },
  plugins: { allow: ["zeroapi-router"], load: { paths: [stagedPluginDir] }, entries: {
    "zeroapi-router": { enabled: true, hooks: { allowConversationAccess: true } },
  } },
};
writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(hostConfig));
writeFileSync(join(stateDir, "zeroapi-config.json"), JSON.stringify(fixture));
const requireFromPlugin = createRequire(join(stagedPluginDir, "package.json"));
const importSdk = (name) => import(pathToFileURL(requireFromPlugin.resolve(`openclaw/plugin-sdk/${name}`)).href);
let resetHooks;
try {
  const sessionStoreRuntime = await importSdk("session-store-runtime");
  const sessionKey = "agent:main:main";
  const jsonStorePath = join(stateDir, "agents", "main", "sessions", "sessions.json");
  const authDatabasePath = join(stateDir, "agents", "main", "agent", "openclaw-agent.sqlite");
  mkdirSync(dirname(jsonStorePath), { recursive: true });
  mkdirSync(dirname(authDatabasePath), { recursive: true });
  const syntheticEntry = { sessionId: "zeroapi-openclaw-compat", updatedAt: Date.now() };
  if (typeof sessionStoreRuntime.upsertSessionEntry === "function") {
    await sessionStoreRuntime.upsertSessionEntry({ agentId: "main", sessionKey, entry: syntheticEntry });
  } else {
    const storePath = sessionStoreRuntime.resolveStorePath(undefined, { agentId: "main" });
    await sessionStoreRuntime.updateSessionStore(storePath, (store) => { store[sessionKey] = syntheticEntry; });
  }
  let staleJsonBefore;
  if (expectedLayout === "json") {
    writeFileSync(authDatabasePath, "SQLite format 3\u0000synthetic-auth-state", "latin1");
  } else {
    assert.ok(existsSync(authDatabasePath), "host did not create its canonical SQLite database");
    staleJsonBefore = '{"agent:main:main":{"sessionId":"stale-json"}}\n';
    writeFileSync(jsonStorePath, staleJsonBefore);
  }
  const warnings = [];
  function createRegistration(registrationMode) {
    const registered = new Map();
    const services = [];
    return { registered, services, api: {
      registrationMode, config: hostConfig,
      logger: { info() {}, warn(message) { warnings.push(String(message)); } },
      on(name, handler) {
        assert.ok(!registered.has(name), `duplicate hook: ${name}`);
        registered.set(name, handler);
      },
      registerService(service) { services.push(service); },
    } };
  }
  const plugin = (await import(pathToFileURL(entryPath).href)).default;
  assert.equal(typeof plugin?.register, "function", "staged entry is not registerable");
  const metadata = createRegistration("cli-metadata");
  plugin.register(metadata.api);
  assert.equal(metadata.registered.size, 0, "CLI metadata pass registered runtime hooks");
  assert.equal(metadata.services.length, 0, "CLI metadata pass registered background work");
  const first = createRegistration("discovery");
  plugin.register(first.api);
  plugin.register(first.api);
  const second = createRegistration("full");
  plugin.register(second.api);
  for (const registration of [first, second]) {
    assert.deepEqual([...registration.registered.keys()].sort(), ["before_model_resolve", "message_sending"]);
    assert.deepEqual(registration.services.map((service) => service.id), ["zeroapi-router-advisories"]);
  }
  // No service start: this proof needs no auth inventory, watcher, channel,
  // provider request, or external API call.
  let dispatch = (event, ctx) => second.registered.get("before_model_resolve")(event, ctx);
  if (expectedDispatch !== "callback") {
    const registry = {
      hooks: [], plugins: [{ id: "zeroapi-router", status: "loaded" }],
      typedHooks: [...second.registered].map(([hookName, handler]) => ({ pluginId: "zeroapi-router", hookName, handler })),
    };
    let runner;
    if (expectedDispatch === "source") {
      const source = await import(pathToFileURL(resolve(process.argv[6])).href);
      runner = source.createHookRunner(registry, { catchErrors: false });
    } else {
      const hooks = await importSdk("hook-runtime");
      const runtime = await importSdk("plugin-runtime");
      assert.equal(typeof runtime.getGlobalHookRunner, "function", "native hook runner is unavailable");
      hooks.initializeGlobalHookRunner(registry);
      resetHooks = hooks.resetGlobalHookRunner;
      runner = runtime.getGlobalHookRunner();
    }
    assert.ok(runner?.hasHooks("before_model_resolve"), "native host cannot see the route hook");
    dispatch = (event, ctx) => runner.runBeforeModelResolve(event, ctx);
  }
  const context = { agentId: "main", modelId: "glm-5.1", modelProviderId: "zai", sessionKey };
  const route = await dispatch({ prompt: "implement a compatibility regression test" }, context);
  assert.equal(route?.providerOverride, expectedProvider);
  assert.equal(route?.modelOverride, "gpt-5.4");
  if (expectedDispatch !== "callback") {
    assert.equal(Object.hasOwn(route, "authProfileOverride"), false,
      "the host's same-turn auth hook contract changed; review the adapter and witness");
  } else {
    assert.equal(route?.authProfileOverride, `${expectedProvider}:ci`,
      "the callback must retain the auth-profile extension for compatible hosts");
  }
  const persistedEntry = typeof sessionStoreRuntime.getSessionEntry === "function"
    ? sessionStoreRuntime.getSessionEntry({ agentId: "main", readConsistency: "latest", sessionKey })
    : sessionStoreRuntime.loadSessionStore(sessionStoreRuntime.resolveStorePath(undefined, { agentId: "main" }), { skipCache: true })[sessionKey];
  assert.equal(persistedEntry?.authProfileOverride, `${expectedProvider}:ci`);
  assert.equal(persistedEntry?.authProfileOverrideSource, "auto");
  if (expectedLayout === "json") {
    assert.equal(JSON.parse(readFileSync(jsonStorePath, "utf8"))[sessionKey]?.authProfileOverride, `${expectedProvider}:ci`);
  } else {
    assert.equal(readFileSync(jsonStorePath, "utf8"), staleJsonBefore, "SQLite route rewrote stale JSON");
  }
  if (fixtureName === "current") {
    const imageRoute = await dispatch({ prompt: "what is this?", attachments: [{ kind: "image", mimeType: "image/png" }] }, context);
    assert.equal(imageRoute?.providerOverride, expectedProvider, "image attachment was not routed to a vision model");
    assert.equal(imageRoute?.modelOverride, "gpt-5.4");
  }
  const alreadySelected = await dispatch({ prompt: "implement a compatibility regression test" }, {
    ...context, modelId: "gpt-5.4", modelProviderId: expectedProvider,
  });
  assert.ok(!alreadySelected?.modelOverride, "current-model route should stay unchanged");
  const external = await dispatch({ prompt: "implement a compatibility regression test" }, {
    ...context, modelId: "private-model", modelProviderId: "custom",
  });
  assert.ok(!external?.modelOverride, "external-model stay policy must remain effective");
  const { syncSessionAuthProfileOverride, createSessionEntryPatcher } = await import(
    pathToFileURL(join(stagedPluginDir, "session-auth.js")).href);
  const patchSessionEntry = createSessionEntryPatcher(sessionStoreRuntime);
  await patchSessionEntry({ agentId: "main", sessionKey, preserveActivity: true,
    update: () => ({ authProfileOverride: `${expectedProvider}:missing-user-pin`, authProfileOverrideSource: "user" }) });
  const pinned = await syncSessionAuthProfileOverride({ agentId: "main", sessionKey,
    authProfileOverride: `${expectedProvider}:ci`, patchSessionEntry });
  assert.equal(pinned.reason, "user_pinned_preserved");
  const pinnedEntry = typeof sessionStoreRuntime.getSessionEntry === "function"
    ? sessionStoreRuntime.getSessionEntry({ agentId: "main", readConsistency: "latest", sessionKey })
    : sessionStoreRuntime.loadSessionStore(sessionStoreRuntime.resolveStorePath(undefined, { agentId: "main" }), { skipCache: true })[sessionKey];
  assert.equal(pinnedEntry.authProfileOverride, `${expectedProvider}:missing-user-pin`);
  if (expectedDispatch === "native") {
    const { resolveAuthProfileOrder } = await importSdk("provider-auth");
    const store = { version: 1, profiles: {
      "openai:a": { type: "api_key", provider: "openai", key: "synthetic-a" },
      "openai:b": { type: "api_key", provider: "openai", key: "synthetic-b" },
    } };
    const ordered = (order) => resolveAuthProfileOrder({ provider: "openai", store,
      cfg: { auth: { order: { openai: order } } } });
    assert.deepEqual(ordered(["openai:b", "openai:a"]), ["openai:b", "openai:a"]);
    assert.deepEqual(ordered([]), [], "explicit empty account order must not borrow fallback accounts");
    assert.deepEqual(ordered(["openai:missing"]), [], "missing explicit account must not silently fall back");
    assert.deepEqual(resolveAuthProfileOrder({ provider: "openai",
      store: { version: 1, profiles: { "openai:a": store.profiles["openai:a"] } },
      cfg: { auth: { profiles: { "openai:a": { provider: "openai", mode: "oauth" } } } },
    }), [], "API-key credentials must not satisfy an OAuth-only profile");
  }
  console.log(JSON.stringify({
    status: "ok", hooks: [...second.registered.keys()].sort(), dispatch: expectedDispatch,
    route: { providerOverride: route.providerOverride, modelOverride: route.modelOverride },
    registration: { metadataInert: true, freshRegistries: 2, servicesDeferred: true },
    sessionStore: { accountRouting: "persisted", layout: expectedLayout, staleJsonUntouched: expectedLayout === "sqlite" ? true : undefined },
    imageRouting: fixtureName === "current" ? "passed" : "not-requested",
    stayAndPinnedProfile: "passed", nativeAuthOrder: expectedDispatch === "native" ? "passed" : "not-requested", warnings,
  }));
} finally {
  resetHooks?.();
  rmSync(stateDir, { recursive: true, force: true });
}
