#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const args = {
    root: join(dirname(fileURLToPath(import.meta.url)), ".."),
    asOf: new Date().toISOString().slice(0, 10),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--root" || value === "--as-of") {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} requires a value`);
      args[value === "--root" ? "root" : "asOf"] = next;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${value}`);
  }

  args.root = resolve(args.root);
  return args;
}

function markdownSection(markdown, heading) {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start < 0) return null;
  const contentStart = start + marker.length;
  const nextHeading = markdown.indexOf("\n## ", contentStart);
  return markdown.slice(contentStart, nextHeading < 0 ? markdown.length : nextHeading);
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed;
}

function parseReadmeProviders(readme, errors) {
  const section = markdownSection(readme, "Provider Exclusions");
  if (section === null) {
    errors.push("README: missing Provider Exclusions section");
    return [];
  }

  const providers = [];
  const seen = new Set();
  const pattern = /^\*\*([^*(]+?)\s*\(([^)]*)\):\*\*/gm;
  for (const match of section.matchAll(pattern)) {
    const provider = match[1].trim();
    const metadata = match[2].trim();
    if (seen.has(provider)) {
      errors.push(`${provider}: duplicate README provider exclusion`);
      continue;
    }
    seen.add(provider);
    const dates = metadata.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
    if (dates.length !== 1 || !parseIsoDate(dates[0])) {
      errors.push(`${provider}: malformed README review date`);
      providers.push({ provider, date: null });
      continue;
    }
    providers.push({ provider, date: dates[0] });
  }

  if (providers.length === 0) {
    errors.push("README: no provider exclusions found");
  }
  return providers;
}

function parseStatusReference(status, errors) {
  const section = markdownSection(status, "Provider policy review dates");
  if (section === null) {
    errors.push("provider-model-status: missing Provider policy review dates section");
    return { freshnessDays: null, rows: new Map() };
  }

  const intervalMatch = section.match(/Policy review freshness interval:\s*(\d+)\s+days\./);
  const freshnessDays = intervalMatch ? Number(intervalMatch[1]) : null;
  if (!Number.isInteger(freshnessDays) || freshnessDays <= 0) {
    errors.push("provider-model-status: malformed freshness interval");
  }

  const rows = new Map();
  for (const line of section.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2 || cells[0] === "Provider" || /^-+$/.test(cells[0])) continue;
    const [provider, date] = cells;
    if (!provider) continue;
    if (rows.has(provider)) {
      errors.push(`${provider}: duplicate provider policy review row`);
      continue;
    }
    rows.set(provider, date);
  }

  return { freshnessDays, rows };
}

export function checkProviderPolicyFreshness({ readme, status, asOf }) {
  const errors = [];
  const asOfDate = parseIsoDate(asOf);
  if (!asOfDate) {
    return [`as-of date is malformed: ${asOf}`];
  }

  const providers = parseReadmeProviders(readme, errors);
  const { freshnessDays, rows } = parseStatusReference(status, errors);

  for (const { provider, date: readmeDate } of providers) {
    if (!rows.has(provider)) {
      errors.push(`${provider}: missing provider policy review row`);
      continue;
    }

    const statusDate = rows.get(provider);
    const parsedStatusDate = parseIsoDate(statusDate);
    if (!parsedStatusDate) {
      errors.push(`${provider}: malformed review date ${statusDate || "(empty)"}`);
      continue;
    }

    if (readmeDate && readmeDate !== statusDate) {
      errors.push(`${provider}: README date ${readmeDate} does not match status date ${statusDate}`);
    }

    if (freshnessDays !== null) {
      const ageDays = Math.floor((asOfDate.getTime() - parsedStatusDate.getTime()) / DAY_MS);
      if (ageDays > freshnessDays) {
        errors.push(`${provider}: review date ${statusDate} is stale (${ageDays} days; limit ${freshnessDays})`);
      }
    }
  }

  return errors;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Provider policy freshness check failed:\n- ${error.message}`);
    return 1;
  }

  let readme;
  let status;
  try {
    readme = readFileSync(join(args.root, "README.md"), "utf8");
    status = readFileSync(join(args.root, "references", "provider-model-status.md"), "utf8");
  } catch (error) {
    console.error(`Provider policy freshness check failed:\n- ${error.message}`);
    return 1;
  }

  const errors = checkProviderPolicyFreshness({ readme, status, asOf: args.asOf });
  if (errors.length > 0) {
    console.error(`Provider policy freshness check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    return 1;
  }

  console.log(`Provider policy freshness check passed as of ${args.asOf}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
