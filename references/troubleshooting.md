# Troubleshooting

## Provider Exclusions

**Google (Gemini):** Removed in v3.1. Google declared CLI OAuth with third-party tools a ToS violation as of March 25, 2026. If you have Google OAuth profiles in your config, run `/zeroapi` to clean them up.

**Anthropic (Claude):** Removed in v3.0. Subscriptions no longer cover OpenClaw as of April 4, 2026.

## ZeroAPI Plugin Errors

### "zeroapi-config.json not found"

**Cause**: The plugin loaded but the config file does not exist yet.

**Fix**: Run `/zeroapi` to configure routing. The skill generates `~/.openclaw/zeroapi-config.json`.

```bash
# After running /zeroapi, verify the file exists
ls ~/.openclaw/zeroapi-config.json
```

---

### Anthropic OAuth profiles still in config (Extra Usage billing risk)

**Cause**: Legacy Anthropic OAuth profiles (`anthropic:user@email.com` with `mode: "oauth"`) remain in `openclaw.json` after the April 4, 2026 billing change. These profiles still work but now incur Extra Usage (per-token) charges instead of being covered by your Claude subscription.

**Check**:
```bash
cat ~/.openclaw/openclaw.json | grep -A2 '"anthropic'
```

**Fix**: Run `/zeroapi` — the setup wizard detects Anthropic OAuth profiles and offers three options: remove, keep, or migrate to API key. If you want to remove manually:

```bash
# 1. Open openclaw.json
# 2. Remove all "anthropic:*" entries from auth.profiles
# 3. Remove "anthropic" array from auth.order
# 4. Remove any anthropic/* model refs from agents.defaults.model.primary and fallbacks
# 5. Check each agent in agents.list for anthropic/* model assignments
# 6. Restart gateway
systemctl --user restart openclaw-gateway.service
# 7. Verify
openclaw models status | grep anthropic
# Should return nothing
```

---

### Google OAuth profiles still in config (ToS violation risk)

**Cause**: Legacy Google OAuth profiles (`google-gemini-cli`) remain in `openclaw.json` after the March 25, 2026 ToS change. Continued use risks account suspension.

**Check**:
```bash
cat ~/.openclaw/openclaw.json | grep -A2 '"google'
```

**Fix**: Run `/zeroapi` — the setup wizard detects Google OAuth profiles and offers removal. If you want to remove manually:

```bash
# 1. Open openclaw.json
# 2. Remove all "google*" entries from auth.profiles
# 3. Remove "google-gemini-cli" from auth.order
# 4. Remove any google-gemini-cli/* model refs from agents.defaults.model.primary and fallbacks
# 5. Check each agent in agents.list for google-gemini-cli/* model assignments
# 6. Remove per-agent models.json entries for google-gemini-cli
# 7. Restart gateway
systemctl --user restart openclaw-gateway.service
# 8. Verify
openclaw models status | grep google
# Should return nothing
```

---

### "ZeroAPI Router not loaded"

**Cause**: The plugin is not installed, failed to load at gateway start, or the install path/runtime load path is not what you expect.

**Fix**:

```bash
# Check if plugin is installed
openclaw plugins list | grep zeroapi-router

# If missing, install it
openclaw plugins install zeroapi-router

# Then restart the gateway
systemctl --user restart openclaw-gateway.service
```

Then verify runtime load explicitly:

```bash
grep -Rni "ZeroAPI Router" /tmp/openclaw /root/.openclaw/logs 2>/dev/null | tail -n 20
```

If config says the plugin is enabled but you cannot identify where it was loaded from, treat that as an install-path mismatch and fix it before debugging routing behavior.

If you want ZeroAPI to keep skill + plugin aligned automatically instead of only fixing the plugin path, switch to managed install:

```bash
node /path/to/ZeroAPI/scripts/managed_install.mjs --openclaw-dir ~/.openclaw
```

For a quick end-to-end sanity check from the repo checkout:

```bash
bash scripts-zeroapi-doctor.sh
```

---

### `/zeroapi` chat behavior looks stale after plugin update

**Cause**: the runtime plugin was updated but `~/.openclaw/skills/zeroapi` was left on an older repo snapshot, so the chat skill text and the actual router code drifted apart.

**Fix**:

Preferred:

```bash
node /path/to/ZeroAPI/scripts/managed_install.mjs --openclaw-dir ~/.openclaw
```

That re-syncs both the managed repo and the skill directory, then re-installs the plugin from the managed repo path.

Manual fallback:

```bash
rsync -a --delete --exclude '.git' /path/to/ZeroAPI/ ~/.openclaw/skills/zeroapi/
openclaw plugins install /path/to/ZeroAPI/plugin
systemctl --user restart openclaw-gateway.service
```

---

### Routing not triggering (model not switching as expected)

**Cause**: No keyword match, conservative skip, explicit user model selection, specialist-agent skip, trigger skip, or runtime/config mismatch.

**Check the routing log**:

```bash
tail -f ~/.openclaw/logs/zeroapi-routing.log
```

Log format:
```
2026-04-05T10:30:15Z agent=senti action=route category=code current=zai/glm-5.1 model=openai-codex/gpt-5.4 risk=medium reason=keyword:refactor candidates=openai-codex/gpt-5.4,zai/glm-5.1
2026-04-05T10:30:45Z agent=main action=stay category=default current=zai/glm-5.1 model=default risk=low reason=no_match
```

`reason=no_match` means no category was detected — the current runtime default/current model was used. `action=stay` means the plugin evaluated the prompt and intentionally kept the current model. Other skip reasons may appear as `skip:*`, `default_mismatch:*`, or `no_eligible_candidate`.

**Note**: The plugin never overrides explicit user model selections (`/model` or `#model:` directives). It also does not route messages from specialist agents (codex, glm) or cron/heartbeat triggers.

---

### Benchmark data is outdated

**Cause**: `benchmarks.json` has a `fetched` date older than 30 days.

| Age | Action |
|-----|--------|
| < 30 days | Proceed normally |
| 30-60 days | Warning shown — update recommended |
| > 60 days | Explicit override required to proceed |

**Fix**:

- If you are the maintainer, refresh with `python3 scripts/refresh_benchmarks.py --api-key-file /path/to/aa_api_key`, commit the new `benchmarks.json`, and cut a release.
- If you are the maintainer and prefer automation, set the private repo secret `AA_API_KEY` so the Sunday workflow can refresh `benchmarks.json` without exposing the key to public users.
- If you are a normal user, pull the latest ZeroAPI release instead of running the AA fetch yourself.
- After updating, re-run `/zeroapi` to regenerate config.

---

## OpenClaw Gateway Errors

### "No API provider registered for api: undefined"

**Cause**: The `api` field is missing from a custom provider entry.

**Fix**: Add the correct `api` field to each provider:

| Provider | Config location | Correct `api` value |
|----------|----------------|---------------------|
| `openai-codex` | `openclaw.json` | `"openai-responses"` |
| `moonshot` | `openclaw.json` | `"openai-completions"` |
| `zai` | `openclaw.json` | `"openai-completions"` |
| `minimax-portal` | `openclaw.json` | `"anthropic-messages"` |
| `qwen` | `openclaw.json` | `"openai-completions"` |

The `api` field is required for every custom provider (OpenClaw 2026.2.6+).

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

- **OpenAI Codex**: Use the tmux OAuth flow to run `openclaw onboard --auth-choice openai-codex`. See `references/oauth-setup.md`.
- **Kimi / GLM / Qwen**: API keys do not expire. If failing, verify the subscription is still active at the provider portal.
- **MiniMax**: Use the tmux OAuth flow with `--auth-choice minimax-global-oauth`.

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

### zeroapi-config.json and openclaw.json disagree

**Cause**: ZeroAPI policy config drifted away from OpenClaw runtime config.

**Check**:
```bash
python3 - <<'PY'
import json, pathlib
zcfg=json.loads(pathlib.Path.home().joinpath('.openclaw/zeroapi-config.json').read_text())
ocfg=json.loads(pathlib.Path.home().joinpath('.openclaw/openclaw.json').read_text())
print('zeroapi default:', zcfg.get('default_model'))
print('openclaw default:', ocfg.get('agents',{}).get('defaults',{}).get('model',{}).get('primary'))
PY
```

**Fix**: Decide which one is intended, then regenerate `/zeroapi` config or update `openclaw.json` so runtime and policy agree.

---

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

**Fix**: Run `openclaw models status` to verify provider auth. Ensure the sub-agent's config includes the provider. See `references/provider-config.md`.
