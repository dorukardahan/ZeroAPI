#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
  console.error(`OpenClaw compatibility smoke failed: ${message}`);
  process.exit(1);
}

const stagedPluginDir = resolve(process.argv[2] || "/tmp/zeroapi-staged");
const entryPath = resolve(stagedPluginDir, "index.js");
if (!existsSync(entryPath)) {
  fail(`staged plugin entry is missing: ${entryPath}`);
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

const route = registered.get("before_model_resolve")(
  { prompt: "implement a compatibility regression test" },
  {
    agentId: "main",
    modelId: "glm-5.1",
    modelProviderId: "zai",
    sessionKey: "agent:main:main",
  },
);
if (route?.providerOverride !== "openai-codex" || route?.modelOverride !== "gpt-5.4") {
  fail(`unexpected route: ${JSON.stringify(route)}`);
}

console.log(
  JSON.stringify({
    status: "ok",
    hooks: [...registered.keys()].sort(),
    route: {
      providerOverride: route.providerOverride,
      modelOverride: route.modelOverride,
    },
    warnings,
  }),
);
