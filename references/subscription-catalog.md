# ZeroAPI Subscription Catalog v1

This document defines the provider and subscription catalog used by ZeroAPI for subscription-aware routing.

ZeroAPI does not read live provider quota or private usage telemetry. Catalog weights are static policy hints based on public/provider-declared tiers and account-quota shape.

## Goals

- Let users select from known subscription tiers instead of free-form text
- Keep personal/runtime-specific data out of the public repo
- Support a global profile plus agent-level partial overrides
- Enable benchmark-aware routing constrained by provider subscription reality

## Supported Providers in v1

ZeroAPI v1 subscription-aware routing supports exactly these subscription or account-quota providers:

1. OpenAI
2. Kimi
3. Z AI (GLM)
4. MiniMax
5. Qwen Portal
6. xAI Grok OAuth

Excluded from catalog:

- Anthropic, excluded for subscription coverage reasons
- Google/Gemini, excluded for OAuth/ToS reasons in third-party tool flows
- xAI API-key routes, excluded because plain `xai/*` models are separate API billing rather than SuperGrok subscription OAuth
- Any provider without a meaningful subscription, plan, or account-quota abstraction

## Design Principles

- Catalog data is public, generic, and vendor-level only
- No user API keys, auth tokens, local file paths, or machine-specific details
- Tier definitions are descriptive heuristics, not billing enforcement
- Routing uses benchmark/capability ranking first, then subscription constraints, then fallback rules
- Usage telemetry is intentionally out of scope for v1

## Provider Catalog Shape

Each provider entry should define:

- `providerId`, stable internal ID
- `label`, human-readable provider name
- `openclawProviderId`, provider slug used by OpenClaw
- `openclawProviderAliases`, optional legacy/runtime provider slugs that map to the same subscription
- `status`, one of `active`, `excluded`, `experimental`
- `authMode`, such as `oauth`, `api_key`, or `mixed`
- `selectionMode`, currently `single_tier`
- `tiers`, ordered from lowest to highest practical capability/limit envelope
- `notes`, optional public notes

Each tier should define:

- `tierId`
- `label`
- `monthlyPriceUsd`, nullable when unclear
- `annualEffectiveMonthlyUsd`, nullable when unclear
- `availability`, one of `available`, `legacy`, `closed`, `contact_sales`
- `routingWeight`, relative heuristic capacity score used for subscription-aware routing
- `recommendedUsage`, short descriptive guidance
- `notes`, optional public notes

## Proposed Tier Semantics

### OpenAI

- Plus
- Pro

### Kimi

- Moderato
- Allegretto
- Allegro
- Vivace

### Z AI (GLM)

- Lite
- Pro
- Max

### MiniMax

- Starter
- Plus
- Max
- Ultra-HS

### Qwen Portal

- Free OAuth

### xAI Grok OAuth

- SuperGrok

This entry applies to Hermes `xai-oauth`, which uses browser OAuth against a standalone SuperGrok subscription. It does not apply to OpenClaw's plain `xai` provider backed by `XAI_API_KEY`.

## User Profile Model

Users do not describe strategy in free text. They only declare which provider tiers they have.

For same-provider multi-account setups, ZeroAPI can also store an account inventory so one provider is not collapsed into a single tier.

### Global Profile

One persistent global profile stores the user's default subscription state.

### Agent Override

Agent-level partial overrides may override only changed providers.
Unspecified providers inherit from the global profile.

### Account Inventory

`subscription_inventory` is the preferred shape when a user has multiple accounts under the same provider.

Each account can carry:

- `provider`
- `tierId`
- `authProfile` (preferred OpenClaw auth profile id when that account wins)
- `usagePriority`
- `intendedUse`

Example:

- Global profile:
  - OpenAI: Pro
  - Z AI: Max
  - Kimi: none
- Agent override for `research-agent`:
  - OpenAI: none

Result:

- `research-agent` inherits Z AI: Max and Kimi: none
- only OpenAI changes for that agent

## Routing Intent

The router should decide using this order:

1. Explicit user/manual model override
2. Capability requirements
3. Benchmark strength for task category
4. Subscription eligibility from profile
5. Tier heuristic capacity
6. Provider benchmark bias
7. Provider/model fallback order

This means the user says what they have, not how to route.
ZeroAPI decides the route.

## Frontier Principle

Subscription-aware routing should not replace benchmark leadership with arbitrary preference.
It should only shape selection among benchmark-near candidates.

Practical intent:

- OpenAI may remain benchmark leader for many categories
- GLM Max may still deserve stronger routine preference if the user configured much more capacity there
- Lower-capacity configured subscriptions should not dominate every task just because they benchmark slightly higher

That is why catalog entries can carry a provider-level routing bias, while tiers carry a tier-level routing weight.
The router uses two layers:

1. Benchmark frontier:
   - every category computes a benchmark strength from the relevant metrics
   - each candidate gets a maximum allowed benchmark drop based on tier weight + provider bias
   - only candidates inside that drop window can compete for first place

2. Subscription pressure ordering:
   - inside the frontier, higher configured-capacity providers sort earlier
   - outside the frontier, candidates stay in benchmark order

The effective pressure signal is:

- provider enabled
- tier selected or account pool composition
- tier routing weight
- provider benchmark bias

This stays heuristic in v1. Real usage telemetry comes later, but the frontier rule keeps static tier/account hints from overwhelming benchmark quality.

## Files to Add in v1

- `references/subscription-catalog.md`, human-readable design/source-of-truth notes
- `plugin/inventory.ts`, same-provider account inventory resolution
- `plugin/subscriptions.ts`, typed built-in catalog data
- `plugin/profile.ts`, profile resolution logic for global + agent partial override
- `examples/subscription-profile.json`, public example config fragment

## Public Repo Safety

Never store in this catalog:

- API keys
- OAuth emails
- local directory names
- machine-specific paths
- private provider aliases
- usage logs from real users

Only public provider/tier abstractions belong here.
