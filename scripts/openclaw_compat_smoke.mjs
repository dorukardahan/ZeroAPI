#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as sessionStoreRuntime from "openclaw/plugin-sdk/session-store-runtime";

function fail(message) {
  console.error(`OpenClaw compatibility smoke failed: ${message}`);
  process.exit(1);
}

const stagedPluginDir = resolve(process.argv[2] || "/tmp/zeroapi-staged");
const expectedLayout = process.argv[3] || "json";
if (expectedLayout !== "json" && expectedLayout !== "sqlite") {
  fail(`unsupported expected session layout: ${expectedLayout}`);
}
const entryPath = resolve(stagedPluginDir, "index.js");
if (!existsSync(entryPath)) {
  fail(`staged plugin entry is missing: ${entryPath}`);
}

const stateDir = resolve(process.env.OPENCLAW_STATE_DIR || "/tmp/zeroapi-openclaw-state");
const sessionKey = "agent:main:main";
const jsonStorePath = join(stateDir, "agents", "main", "sessions", "sessions.json");
const authDatabasePath = join(stateDir, "agents", "main", "agent", "openclaw-agent.sqlite");
mkdirSync(dirname(jsonStorePath), { recursive: true });
mkdirSync(dirname(authDatabasePath), { recursive: true });
const syntheticEntry = {
  sessionId: "zeroapi-openclaw-compat",
  updatedAt: Date.now(),
};
if (typeof sessionStoreRuntime.upsertSessionEntry === "function") {
  await sessionStoreRuntime.upsertSessionEntry({
    agentId: "main",
    sessionKey,
    entry: syntheticEntry,
  });
} else {
  const legacyStorePath = sessionStoreRuntime.resolveStorePath(undefined, { agentId: "main" });
  await sessionStoreRuntime.updateSessionStore(legacyStorePath, (store) => {
    store[sessionKey] = syntheticEntry;
  });
}
let staleJsonBefore;
if (expectedLayout === "json") {
  writeFileSync(authDatabasePath, "SQLite format 3\u0000synthetic-auth-state", "latin1");
} else {
  if (!existsSync(authDatabasePath)) {
    fail("SQLite host did not create its canonical agent database");
  }
  staleJsonBefore = '{"agent:main:main":{"sessionId":"stale-json"}}\n';
  writeFileSync(jsonStorePath, staleJsonBefore, "utf8");
}

const registered = new Map();
const warnings = [];
const api = {
  logger: {
    info: () => {},
    warn: (message) => warnings.push(String(message)),
  },
  on(name, handler) {
    if (registered.has(name)) {
      fail(`hook registered more than once: ${name}`);
    }
    registered.set(name, handler);
  },
};

const pluginModule = await import(pathToFileURL(entryPath).href);
const plugin = pluginModule.default;
if (!plugin || typeof plugin.register !== "function") {
  fail("staged entry did not expose a registerable plugin");
}
plugin.register(api);

for (const hookName of ["before_model_resolve", "message_sending"]) {
  if (typeof registered.get(hookName) !== "function") {
    fail(`typed hook was not registered: ${hookName}`);
  }
}

const route = await registered.get("before_model_resolve")(
  { prompt: "implement a compatibility regression test" },
  {
    agentId: "main",
    modelId: "glm-5.1",
    modelProviderId: "zai",
    sessionKey,
  },
);
if (route?.providerOverride !== "openai-codex" || route?.modelOverride !== "gpt-5.4") {
  fail(`unexpected route: ${JSON.stringify(route)}`);
}

const persistedEntry = typeof sessionStoreRuntime.getSessionEntry === "function"
  ? sessionStoreRuntime.getSessionEntry({
      agentId: "main",
      readConsistency: "latest",
      sessionKey,
    })
  : sessionStoreRuntime.loadSessionStore(
      sessionStoreRuntime.resolveStorePath(undefined, { agentId: "main" }),
      { skipCache: true },
    )[sessionKey];
if (
  persistedEntry?.authProfileOverride !== "openai-codex:ci" ||
  persistedEntry?.authProfileOverrideSource !== "auto"
) {
  fail("host session API did not persist the synthetic account route");
}
if (expectedLayout === "json") {
  if (!existsSync(jsonStorePath)) {
    fail("exact host did not use its documented sessions.json store layout");
  }
  const storedJson = JSON.parse(readFileSync(jsonStorePath, "utf8"));
  if (storedJson?.[sessionKey]?.authProfileOverride !== "openai-codex:ci") {
    fail("exact host JSON store does not contain the synthetic account route");
  }
} else if (readFileSync(jsonStorePath, "utf8") !== staleJsonBefore) {
  fail("SQLite host route mutated the stale sessions.json fixture");
}

console.log(
  JSON.stringify({
    status: "ok",
    hooks: [...registered.keys()].sort(),
    route: {
      providerOverride: route.providerOverride,
      modelOverride: route.modelOverride,
    },
    sessionStore: {
      accountRouting: "persisted",
      authDatabasePresent: existsSync(authDatabasePath),
      layout: expectedLayout === "json" ? "sessions.json" : "sqlite",
      staleJsonUntouched: expectedLayout === "sqlite" ? true : undefined,
    },
    warnings,
  }),
);
