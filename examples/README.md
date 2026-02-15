# ZeroAPI Configuration Examples

Pick the example that matches your subscription setup. Each directory contains a ready-to-use `openclaw.json` fragment.

## Setup Options

| Directory | Subscriptions | Monthly Cost | Agents |
|-----------|--------------|-------------|--------|
| `claude-only/` | Claude Max 5x/20x | $100-200 | 1 (main) |
| `claude-codex/` | Claude Max + ChatGPT Plus | $220 | 2 (main, codex) |
| `claude-gemini/` | Claude Max + Gemini Advanced | $220 | 3 (main, gemini-researcher, gemini-fast) |
| `full-stack/` | Claude Max + ChatGPT + Gemini + Kimi | $250-430 | 5 (main, codex, gemini-researcher, gemini-fast, kimi-orchestrator) |
| `specialist-agents/` | Claude Max + ChatGPT + Gemini + Kimi | $250-430 | 9 (full-stack + devops, researcher, content-writer, community) |

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

## Specialist Agents (specialist-agents/)

The `specialist-agents/` example extends `full-stack/` with domain-specific agents. Each specialist has its own workspace and is optimized for a particular task type:

| Agent | Primary Model | Role |
|-------|--------------|------|
| `devops` | Codex | Infrastructure, deployment, shell scripts, monitoring |
| `researcher` | Gemini Pro | Deep research, fact-checking, long-context analysis |
| `content-writer` | Opus | Blog posts, documentation, copywriting |
| `community` | Flash | Community management, moderation, quick responses |

**When to use specialists vs core agents:**
- Core agents (codex, gemini-researcher, gemini-fast, kimi-orchestrator) are model-optimized — they pick the best model for a task type
- Specialist agents are domain-optimized — they have workspace isolation, custom skills, and context relevant to their domain
- Use specialists when you have distinct workspaces with different files, skills, or AGENTS.md instructions per domain

**Workspace isolation:** Each specialist gets its own workspace directory. This means separate MEMORY.md, AGENTS.md, and skill files per domain. The main orchestrator delegates to specialists via `sessions_spawn`.

This example also includes `imageModel` configuration (see below).

### Image Model Routing

The `specialist-agents/` example includes `imageModel` in the defaults block:

```json
"imageModel": {
  "primary": "google-gemini-cli/gemini-3-pro-preview",
  "fallbacks": [
    "google-gemini-cli/gemini-3-flash-preview",
    "anthropic/claude-opus-4-6"
  ]
}
```

This routes image analysis (vision) tasks to Gemini Pro first (multimodal, 1M context), with Flash and Opus as fallbacks. Set this in `agents.defaults` to apply to all agents, or per-agent for fine-grained control.

**Gemini setup for specialists:** Copy `gemini-models.json` to every agent that uses Gemini models:

```bash
# Core agents
cp examples/specialist-agents/gemini-models.json ~/.openclaw/agents/gemini-researcher/agent/models.json
cp examples/specialist-agents/gemini-models.json ~/.openclaw/agents/gemini-fast/agent/models.json

# Specialists that fall back to Gemini
cp examples/specialist-agents/gemini-models.json ~/.openclaw/agents/devops/agent/models.json
cp examples/specialist-agents/gemini-models.json ~/.openclaw/agents/researcher/agent/models.json
cp examples/specialist-agents/gemini-models.json ~/.openclaw/agents/content-writer/agent/models.json
cp examples/specialist-agents/gemini-models.json ~/.openclaw/agents/community/agent/models.json
```

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
