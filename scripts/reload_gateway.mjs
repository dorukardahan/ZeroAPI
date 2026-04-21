#!/usr/bin/env node

import { resolve } from "node:path";
import { restartGatewayIfPossible } from "./managed-install-lib.mjs";

function parseArgs(argv) {
  let openclawDir = `${process.env.HOME ?? "/root"}/.openclaw`;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--openclaw-dir" && argv[index + 1]) {
      openclawDir = resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node scripts/reload_gateway.mjs
  node scripts/reload_gateway.mjs --openclaw-dir ~/.openclaw
`);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { openclawDir };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = restartGatewayIfPossible();
  if (!result.restarted) {
    throw new Error(`Gateway restart could not be scheduled for ${args.openclawDir}: ${result.reason}`);
  }

  console.log("ZeroAPI gateway reload scheduled.");
  console.log(`- openclaw dir: ${args.openclawDir}`);
  console.log(`- restart: ${result.reason ?? "scheduled"}`);
}

main();
