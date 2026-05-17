# ZeroAPI Router

ZeroAPI is an OpenClaw gateway plugin for transparent, subscription-aware model routing.

It reads your local OpenClaw model and auth-profile configuration, classifies each eligible turn with deterministic rules, and can return a per-turn model/provider override. There is no extra router LLM call in the hot path.

## What It Does

- Routes eligible OpenClaw turns across configured subscription providers.
- Chooses models from the user's `zeroapi-config.json` policy.
- Can select a matching auth profile when the configured account inventory includes one.
- Preserves fixed-model specialist agents unless the policy explicitly opts them into routing.
- Writes local routing and advisory state under the OpenClaw state directory.

## What It Reads

- `~/.openclaw/zeroapi-config.json`
- `~/.openclaw/openclaw.json`
- OpenClaw auth-profile inventory files
- OpenClaw agent/workspace metadata needed to identify the current agent/session

ZeroAPI does not read provider dashboards, live remaining quota, billing counters, OAuth token values, or private API keys.

## What It Writes

- local routing logs
- `zeroapi-advisories.json` when new supported providers/accounts are detected outside the current policy
- bounded advisory delivery metadata so the same advisory is not repeated every reply
- best-effort OpenClaw session auth-profile override state when a routed account has an auth profile

All writes are intended to stay inside the OpenClaw state directory.

## Channel Advisories

When ZeroAPI detects a supported provider or account that is not yet in the policy, it can prepend one compact notice to the next outgoing reply in each conversation. This is explicit product behavior so the operator knows to rerun `/zeroapi`.

Disable channel notices with:

```json
{
  "channel_advisories_enabled": false
}
```

or:

```bash
ZEROAPI_CHANNEL_ADVISORIES=false
```

The advisory file and logs can still be used for operators who do not want channel-visible notices.

## Install Safely

Install only from the source-linked package:

```bash
openclaw plugins install clawhub:zeroapi@3.8.32
```

Verify the package source points to:

- repo: `dorukardahan/ZeroAPI`
- source path: `plugin`
- source tag or commit matching the intended release

## Configure

Run `/zeroapi` in an OpenClaw channel, or use the repo-local setup flow if you are operating from a shell. The generated policy should describe only the subscriptions and accounts you want ZeroAPI to use.
