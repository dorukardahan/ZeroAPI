# ZeroAPI Configuration Examples

Pick the example that matches your subscription setup. Each directory contains a ready-to-use `openclaw.json` fragment.

## Setup Options

| Directory | Subscriptions | Monthly Cost | Agents |
|-----------|--------------|-------------|--------|
| `claude-only/` | Claude Max 5x/20x | $100-200 | 1 (main) |
| `claude-codex/` | Claude Max + ChatGPT Plus | $220 | 2 (main, codex) |
| `claude-gemini/` | Claude Max + Gemini Advanced | $220 | 3 (main, gemini-researcher, gemini-fast) |
| `full-stack/` | Claude Max + ChatGPT + Gemini + Kimi | $250-430 | 5 (main, codex, gemini-researcher, gemini-fast, kimi-orchestrator) |

## How to Use

### 1. Copy the config

```bash
cp examples/<your-setup>/openclaw.json ~/.openclaw/openclaw.json
```

If you already have an `openclaw.json`, merge the `agents` and `models` sections into your existing config.

### 2. Set up Gemini provider (if using Gemini)

Google Gemini with subscription OAuth requires a per-agent `models.json` file (not in `openclaw.json`). Copy `gemini-models.json` to each agent that uses Gemini:

```bash
# For each Gemini-using agent:
cp examples/<your-setup>/gemini-models.json ~/.openclaw/agents/gemini-researcher/agent/models.json
cp examples/<your-setup>/gemini-models.json ~/.openclaw/agents/gemini-fast/agent/models.json
```

**Why?** The `google-gemini-cli` API type is not in OpenClaw's config schema validator. Putting it in `openclaw.json` crashes the gateway. Per-agent `models.json` files bypass schema validation.

### 3. Authenticate providers

```bash
# Anthropic (always needed)
openclaw onboard --auth-choice setup-token

# Google Gemini (subscription OAuth)
openclaw plugins enable google-gemini-cli-auth
openclaw models auth login --provider google-gemini-cli

# OpenAI Codex (ChatGPT OAuth)
openclaw onboard --auth-choice openai-codex

# Kimi (API key)
openclaw onboard --auth-choice kimi-code-api-key
```

### 4. Add the ZeroAPI skill

```json
{
  "skills": ["path/to/ZeroAPI/SKILL.md"]
}
```

### 5. Verify

```bash
openclaw models status
```

All models should show as available. Any model showing `missing` or `auth_expired` needs fixing before routing will work.

## Customizing

- **Workspace paths**: Change `~/.openclaw/workspace-*` to your preferred directories
- **Fallback chains**: Edit the `fallbacks` arrays to match your provider preference
- **Heartbeat model**: Set `agents.defaults.heartbeat.model` to a fast, cheap model
- **Agent names**: The `id` field can be anything — just update SKILL.md references to match

## Important: Per-Agent Fallback Behavior

In OpenClaw, when an agent uses the **object form** for model config:
```json
"model": { "primary": "openai-codex/gpt-5.3-codex" }
```
This **replaces** global fallbacks entirely. The agent has NO fallbacks unless you explicitly add them:
```json
"model": {
  "primary": "openai-codex/gpt-5.3-codex",
  "fallbacks": ["anthropic/claude-opus-4-6"]
}
```

The **string form** inherits global fallbacks:
```json
"model": "anthropic/claude-opus-4-6"
```

All examples in this directory use the object form with explicit fallbacks to avoid silent failures.
