# Channel-First Onboarding

ZeroAPI is designed for **OpenClaw chat surfaces first**, not only for terminal users.

That means the real product contract is:

1. An operator installs the ZeroAPI gateway plugin once on the OpenClaw host
2. Users complete or re-run ZeroAPI setup from their normal chat channel
3. Terminal commands appear only when host access, provider auth, or verification is actually needed

## Surfaces

Primary surfaces:

- Slack
- Telegram
- WhatsApp
- Matrix
- Discord
- terminal chat
- any other OpenClaw text channel that can invoke skills

Entry points:

- `/zeroapi` when the channel exposes direct skill commands
- `/skill zeroapi` when the channel exposes only the generic skill runner
- `npx tsx scripts/first_run.ts` only as a terminal fallback

## Operator vs user responsibilities

### Operator

One-time host tasks:

- run managed install once, so ZeroAPI owns plugin + skill sync from the same repo snapshot
- make sure the gateway reloads the plugin
- keep provider auth profiles healthy

### Channel user

Normal day-to-day tasks:

- start `/zeroapi`
- answer short subscription and account questions
- confirm the summary
- re-run later when subscriptions, auth, or policy preferences change

## Chat UX contract

The `/zeroapi` flow should behave like a compact chat wizard:

- ask **one short question at a time**
- prefer **numbered options**
- do not dump giant benchmark tables into chat
- do not paste full JSON unless the user explicitly asks
- show a short summary before writing config
- keep re-run safe and resumable
- adapt the **first rerun question** to the detected drift kind instead of restarting from a generic provider survey
- when the user is only asking "what is this repo?", answer that neutrally before inspecting or mentioning the current host install

Good style:

```text
/zeroapi

I found an existing ZeroAPI config with OpenAI + GLM.
What should ZeroAPI manage now?
1. OpenAI
2. Kimi
3. Z AI
4. MiniMax
5. Qwen Portal
Reply with numbers.
```

Bad style:

- full benchmark dumps
- long shell transcripts
- raw config blobs by default
- asking users to paste secrets into chat

## Secrets and auth

Never ask users to paste API keys, refresh tokens, or raw OAuth secrets into chat.

If auth is missing, the chat flow should:

1. say which provider is missing
2. give the minimal host-side command or OAuth step
3. return to the chat wizard after auth is complete

Examples:

- `openclaw models auth login --provider openai-codex`
- `openclaw onboard --auth-choice moonshot-api-key`
- `openclaw models auth login --provider qwen-portal --set-default`

## Host-only follow-up steps

Sometimes the skill must ask for an operator step. Keep it short and explicit:

- run managed install or managed update
- restart gateway
- run verification commands
- complete provider auth

Channel users should still receive a short natural-language explanation of what is happening and why.

When a rerun changes `zeroapi-config.json` or `openclaw.json`, schedule a delayed gateway restart and end the turn. Do not keep running host commands after the reload is queued.

## Re-run behavior

Re-running `/zeroapi` should:

- detect existing `~/.openclaw/zeroapi-config.json`
- surface pending `zeroapi-advisories.json` items first when drift exists
- summarize current subscriptions and modifier state
- reuse current provider and modifier choices as the default answer when possible
- choose the first question from the drift-aware playbook in `references/chat-rerun-playbook.md`
- propose changes before writing
- avoid unrelated `openclaw.json` churn

## Terminal fallback

`scripts/first_run.ts` exists for:

- repo-local testing
- terminal-only operators
- cases where the plugin is not installed yet
- CI/demo flows that need a deterministic shell wizard

It is useful, but it is not the primary user experience.
