# Troubleshooting

## ZeroAPI Plugin Errors

### "zeroapi-config.json not found"

**Cause**: The plugin loaded but the config file does not exist yet.

**Fix**: Run `/zeroapi` to configure routing. The skill generates `~/.openclaw/zeroapi-config.json`.

```bash
# After running /zeroapi, verify the file exists
ls ~/.openclaw/zeroapi-config.json
```

---

### "ZeroAPI Router not loaded"

**Cause**: The plugin is not installed or failed to load at gateway start.

**Fix**:

```bash
# Check if plugin is installed
openclaw plugins list | grep zeroapi-router

# If missing, install it
openclaw plugins install zeroapi-router

# Then restart the gateway
systemctl --user restart openclaw-gateway.service
```

If installed but still not loading, check `~/.openclaw/logs/openclaw-gateway.log` for plugin load errors.

---

### Routing not triggering (model not switching as expected)

**Cause**: No keyword match — the message did not contain signals for any routing category.

**Check the routing log**:

```bash
tail -f ~/.openclaw/logs/zeroapi-routing.log
```

Log format:
```
2026-04-05T10:30:15Z agent=senti category=code model=openai-codex/gpt-5.4 reason=keyword:refactor
2026-04-05T10:30:45Z agent=main category=default model=google-gemini-cli/gemini-3.1-pro-preview reason=no_match
```

`reason=no_match` means no category was detected — the default model was used. If this is unexpected, re-run `/zeroapi` to review keyword configuration.

**Note**: The plugin never overrides explicit user model selections (`/model` or `#model:` directives). It also does not route messages from specialist agents (codex, gemini, glm) or cron jobs.

---

### Benchmark data is outdated

**Cause**: `benchmarks.json` has a `fetched` date older than 30 days.

| Age | Action |
|-----|--------|
| < 30 days | Proceed normally |
| 30–60 days | Warning shown — update recommended |
| > 60 days | Explicit override required to proceed |

**Fix**: Pull the latest release from the ZeroAPI repo. The repo maintainer runs the AA API fetch script and commits updated `benchmarks.json` with each release. After pulling, re-run `/zeroapi` to regenerate config.

---

## OpenClaw Gateway Errors

### "No API provider registered for api: undefined"

**Cause**: The `api` field is missing from a custom provider entry.

**Fix**: Add the correct `api` field to each provider:

| Provider | Config location | Correct `api` value |
|----------|----------------|---------------------|
| `openai-codex` | `openclaw.json` | `"openai-responses"` |
| `kimi-coding` | `openclaw.json` | `"openai-completions"` |
| `zai` | `openclaw.json` | `"openai-completions"` |
| `minimax` | `openclaw.json` | `"openai-completions"` |
| `modelstudio` | `openclaw.json` | `"openai-completions"` |
| `google-gemini-cli` | per-agent `models.json` ONLY | `"google-gemini-cli"` |

The `api` field is required for every custom provider (OpenClaw 2026.2.6+).

---

### Google Gemini returns "API key not valid" with OAuth subscription

**Cause**: Wrong API type or wrong config location.

Two possible causes:

1. Provider is in `openclaw.json` with `"api": "google-generative-ai"` — this sends auth via `x-goog-api-key` header, which rejects OAuth tokens.
2. A `baseUrl` is set on the google-gemini-cli provider — remove it. The stream function has the correct endpoint hardcoded (`cloudcode-pa.googleapis.com`).

**Fix**: Move the google-gemini-cli provider to per-agent `models.json` with `"api": "google-gemini-cli"`. Do not set `baseUrl` or `apiKey`. See `references/provider-config.md`.

---

### Model unavailable / "model not found"

**Cause**: Model ID mismatch or provider catalog issue.

**Check available models**:

```bash
openclaw models status
```

Ensure the model ID in your config exactly matches the provider's catalog. Some model IDs are case-sensitive. If the model shows `configured,missing`, it may still work for API calls even if not in OpenClaw's local catalog.

---

### Auth expired (provider returns 401 Unauthorized)

**Cause**: OAuth token expired and auto-refresh failed (typically after 10+ days without use for Codex).

**By provider**:

- **Google**: Run `openclaw onboard --auth-choice google-gemini-cli` again. On headless VPS, use the tmux flow in `references/oauth-setup.md`.
- **OpenAI Codex**: Use the tmux OAuth flow to run `openclaw onboard --auth-choice openai-codex`. See `references/oauth-setup.md`.
- **Kimi / GLM / Qwen**: API keys do not expire. If failing, verify the subscription is still active at the provider portal.
- **MiniMax**: Use the tmux OAuth flow with `--auth-choice minimax-portal`.

After manual renewal, sync the new token across all locations. See `references/oauth-setup.md` → "Token Storage Architecture".

---

### Rate limited (429 Too Many Requests)

**Cause**: Subscription tier quota exceeded for the current billing period.

**Fix**: ZeroAPI's fallback chains automatically route around rate-limited providers. If a provider is persistently rate-limited:

1. Check quota usage at the provider portal
2. The plugin marks the provider as rate-limited and skips it for subsequent messages (cooldown state)
3. Upgrade subscription tier or wait for quota reset

---

### Token works for some agents but not others after manual renewal

**Cause**: Manual OAuth renewal (tmux flow) writes only to `auth-profiles.json`. Other agents may reference stale tokens from `openclaw.json`.

**Fix**: After manual renewal, sync the token across all locations. See `references/oauth-setup.md` → "Token Storage Architecture" for the sync script.

---

## OpenClaw Config Errors

### Config shows "invalid" after editing openclaw.json

**Cause**: OpenClaw uses strict Zod schema validation. Any unrecognized key in `openclaw.json` causes the entire config to be rejected.

**Fix**:

1. Remove keys not in the schema
2. Validate JSON syntax: `python3 -c "import json; json.load(open('openclaw.json'))"`
3. Always backup before editing: `cp openclaw.json openclaw.json.bak`
4. Do a full gateway restart after schema changes — hot-reload may not pick up all changes

---

### MEMORY.md or skill content is silently truncated

**Cause**: Bootstrap character limits. Files exceeding the per-file or total limit are truncated without warning.

**Fix**: Adjust the bootstrap budget in `openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "bootstrapTotalMaxChars": 50000,
      "bootstrapMaxChars": 30000
    }
  }
}
```

- `bootstrapMaxChars`: Max characters per single file (default: 20000)
- `bootstrapTotalMaxChars`: Total budget across all bootstrap files

Bootstrap load order: AGENTS → SOUL → TOOLS → IDENTITY → USER → HEARTBEAT → BOOTSTRAP → MEMORY. Earlier files consume budget first. Requires OpenClaw 2026.2.14+.

---

### systemd ExecStartPre fails with "too many arguments"

**Cause**: `ExecStartPre` does not run through a shell — shell operators like `|| true` are passed as literal arguments.

**Fix**: Use systemd's `-` prefix for error tolerance:

```ini
# WRONG
ExecStartPre=/usr/bin/fuser -k 8787/tcp || true

# CORRECT — "-" prefix ignores non-zero exit codes
ExecStartPre=-/usr/bin/fuser -k 8787/tcp
```

OpenClaw runs as a user service (`systemctl --user`), not a system service.

---

### Sub-agent returns "Unknown model"

**Cause**: Model is registered in main agent context but not available in sub-agent context.

**Fix**: Run `openclaw models status` to verify provider auth. Ensure the sub-agent's `models.json` includes the provider. For Google Gemini, each agent needs its own `models.json` entry — see `references/provider-config.md`.
