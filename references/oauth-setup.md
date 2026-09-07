# OAuth & Provider Auth Setup

## Provider Exclusions

Google and Anthropic remain outside ZeroAPI's automatic subscription routing. This is not a blanket claim that every provider subscription excludes third-party tools. The dated policy reasons and unimplemented runtime requirements are maintained in [provider-model-status.md](provider-model-status.md).

## Provider Auth Summary

| Provider | Auth Method | Setup Command | Token Lifetime |
|----------|-------------|---------------|----------------|
| OpenAI | OAuth PKCE via ChatGPT | `openclaw models auth login --provider openai` | Refreshable OAuth token |
| Kimi Coding membership | Membership API key | `openclaw onboard --auth-choice kimi-code-api-key` | Provider-managed key |
| Z AI (GLM) | Static API key | `openclaw onboard --auth-choice zai-coding-global` | Never expires |
| MiniMax | OAuth portal | `openclaw onboard --auth-choice minimax-global-oauth` | Refreshable OAuth token |
| xAI Grok OAuth | OpenClaw OAuth via SuperGrok, or Hermes legacy OAuth | `openclaw models auth login --provider xai --method oauth` / `hermes auth add xai-oauth` | Refreshable OAuth token |

Kimi membership and GLM Coding Plan use their own scoped keys; MiniMax and OpenAI OAuth can refresh. Current OpenClaw removed Qwen Portal and its onboarding command. Existing compatible Hermes/older-runtime accounts remain separate from Qwen Cloud credentials; legacy Portal OAuth profiles are not refreshable.

---

## OpenAI Codex OAuth - Multi-Device Safety

A common concern: will logging into ChatGPT on another device invalidate the agent's token?

**No.** Tested with these scenarios:

| Action | VPS Token Affected? |
|--------|---------------------|
| Log into ChatGPT web UI (browser) | No |
| Log into ChatGPT mobile app + chat | No |
| Use Codex desktop app + new session | No |
| Use Codex CLI in terminal + chat | No |

OpenClaw's auto-refresh handles renewal. Users can freely use ChatGPT and Codex on all devices without disrupting the agent.

---

## Static-Key Providers (Kimi / GLM)

These providers use static API keys. Setup is simpler:

```bash
# Kimi Coding membership
openclaw onboard --auth-choice kimi-code-api-key

# Z AI / GLM (Coding Plan endpoint)
openclaw onboard --auth-choice zai-coding-global
```

The wizard prompts for the API key and saves it to auth profiles. Never paste API keys into chat channels.

Kimi Coding uses the `kimi` provider in OpenClaw and `kimi-coding` in Hermes. A Moonshot API key belongs to the separately billed `moonshot` provider; do not rename its profile or treat it as a Kimi membership key.

---

## Portal and OAuth Providers

MiniMax uses the OpenClaw onboarding flow:

```bash
openclaw plugins enable minimax-portal-auth
openclaw onboard --auth-choice minimax-global-oauth
```

Qwen Portal is unavailable for fresh current-OpenClaw setup. Do not convert a Portal profile into Qwen Cloud or Token Plan access. Use the installed runtime's supported workflow for an existing compatible Portal account; see [provider-config.md](provider-config.md#qwen-compatibility-and-qwen-cloud).

OpenAI Codex also uses the model-auth flow:

```bash
openclaw models auth login --provider openai
```

Current OpenClaw SuperGrok uses provider-method OAuth:

```bash
openclaw models auth login --provider xai --method oauth
```

### Hermes-only xAI guidance

Hermes SuperGrok uses Hermes' own legacy adapter flow:

```bash
hermes auth add xai-oauth
```

`XAI_API_KEY` remains explicit API billing. ZeroAPI treats `xai/grok-4.3` as subscription-covered only when the user enables the `xai` SuperGrok subscription profile.

---

## OAuth Setup on Headless VPS

Some OAuth commands require an interactive TTY. On a headless VPS, run them in `tmux` or `screen`, send the browser URL to the user, then paste the localhost callback URL back into the TTY.

### If you are an OpenClaw agent with direct Bash access on VPS

```bash
# Step 1: Start a TTY session
tmux new-session -d -s oauth 'openclaw models auth login --provider openai'

# Step 2: Read the screen
tmux capture-pane -t oauth -p

# Step 3: Send the OAuth URL to the user.
# The user opens it, logs in, then sends back the full localhost callback URL.

# Step 4: Paste the callback URL into the TTY
tmux send-keys -t oauth 'THE_FULL_LOCALHOST_CALLBACK_URL_FROM_USER' Enter

# Step 5: Verify
openclaw models status
```

For MiniMax, use:

```bash
openclaw onboard --auth-choice minimax-global-oauth
```

### General principle

1. Wrap the auth command in `tmux` or `screen`
2. Extract the provider's browser URL
3. Ask the user to open it and send back the localhost callback URL
4. Paste the callback URL into the TTY
5. Verify with `openclaw models status`

Do not copy raw tokens, refresh tokens, API keys, or callback codes into logs, docs, or commits.

---

## Auth Status Monitoring

```bash
# Quick check - exit code 0=ok, 1=expired, 2=expiring soon
openclaw models status --check

# Detailed view - expiry times and quota
openclaw models status

# Full health check with repair suggestions
openclaw doctor
```

---

## Profile Drift Notes

OpenClaw can sync some external CLI profiles, for example Codex CLI or MiniMax CLI credentials. A historical Qwen CLI profile does not restore Portal support in current OpenClaw. If an unexpected `*:default` or CLI-derived profile appears, verify it with `openclaw models status`, then clean stale profiles through OpenClaw's auth/profile commands or the config store.

ZeroAPI should not assume every profile for a provider belongs in the routing pool. Prefer explicit `subscription_inventory.accounts[*].authProfile` for multi-account setups.
