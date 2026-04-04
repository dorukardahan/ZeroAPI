# OAuth & Provider Auth Setup

## Provider Auth Summary

| Provider | Auth Method | Setup Command | Token Lifetime |
|----------|-------------|---------------|----------------|
| Google | OAuth (gemini-cli auto-load) | `openclaw onboard --auth-choice google-gemini-cli` | Long-lived refresh token |
| OpenAI | OAuth PKCE via ChatGPT | `openclaw onboard --auth-choice openai-codex` | ~10 days without use |
| Kimi | Static API key | `openclaw onboard --auth-choice kimi-coding` | Never expires |
| Z AI (GLM) | Static API key | `openclaw onboard --auth-choice zai-coding-global` | Never expires |
| MiniMax | OAuth portal | `openclaw onboard --auth-choice minimax-portal` | Long-lived refresh token |
| Alibaba (Qwen) | Static API key | `openclaw onboard --auth-choice modelstudio` | Never expires |

**Reliability ranking**: Kimi / GLM / Qwen (static key, never expires) ≈ Google OAuth (auto-refresh, very stable) > MiniMax OAuth (auto-refresh) > Codex OAuth (auto-refresh works; see notes below).

---

## Google OAuth

Google OAuth issues long-lived refresh tokens. Auto-refresh is reliable — manual re-auth is rarely needed.

```bash
openclaw onboard --auth-choice google-gemini-cli
```

The wizard opens a browser OAuth flow. On headless VPS, use the tmux method below.

**Note**: The `google-gemini-cli-auth` plugin ID was removed in OpenClaw 2026.2.22. The provider auto-loads — no separate plugin enable step is needed.

---

## OpenAI Codex OAuth — Multi-Device Safety

A common concern: will logging into ChatGPT on another device invalidate the agent's token?

**No.** Tested with all four scenarios:

| Action | VPS Token Affected? |
|--------|---------------------|
| Log into ChatGPT web UI (browser) | No |
| Log into ChatGPT mobile app + chat | No |
| Use Codex desktop app + new session | No |
| Use Codex CLI in terminal + chat | No |

OpenClaw's auto-refresh handles renewal. Users can freely use ChatGPT and Codex on all devices without disrupting the agent. A dedicated OpenAI account for the VPS is not required.

**Token expiry**: Codex OAuth access tokens expire after ~10 days without use. If auto-refresh fails (e.g., the refresh token itself expired), use the tmux OAuth flow below.

---

## API Key Providers (Kimi / GLM / Qwen)

These providers use static API keys that never expire. Setup is simpler:

```bash
# Kimi
openclaw onboard --auth-choice kimi-coding

# Z AI / GLM (Coding Plan endpoint)
openclaw onboard --auth-choice zai-coding-global

# Alibaba Qwen (Coding Plan endpoint)
openclaw onboard --auth-choice modelstudio
```

The wizard prompts for the API key and saves it to auth-profiles. No browser flow needed. If a provider with a static key stops working, check that the subscription is still active — the key itself does not expire.

---

## MiniMax OAuth

MiniMax uses an OAuth portal flow similar to Google. Setup:

```bash
openclaw onboard --auth-choice minimax-portal
```

On headless VPS, use the tmux method below (change `--auth-choice` to `minimax-portal`).

---

## OAuth Setup on Headless VPS (No Browser)

`openclaw onboard` uses an interactive TUI. On a headless VPS, OpenClaw detects the lack of a browser and switches to a "paste-the-redirect-URL" flow. Use `tmux` to manage the TUI session.

### If you are an OpenClaw agent (direct Bash access on VPS)

```bash
# Step 1: Start the wizard in a tmux session
tmux new-session -d -s oauth 'openclaw onboard --auth-choice openai-codex --accept-risk'

# Step 2: Read the screen and navigate menus
tmux capture-pane -t oauth -p        # read current screen
tmux send-keys -t oauth Enter        # select highlighted option
# Repeat capture-pane + send-keys until you reach the OAuth URL screen

# Step 3: Extract the OAuth URL from the screen
# Look for: https://auth.openai.com/oauth/authorize?...
# Send this URL to the user via your channel (WhatsApp, Telegram, etc.)

# Step 4: Tell the user:
#   "Open this link in your browser, log in.
#    After login, your browser will try to load a localhost URL that won't work.
#    Copy that FULL URL from the address bar and send it back."

# Step 5: Paste the redirect URL the user sends back
tmux send-keys -t oauth 'THE_REDIRECT_URL_FROM_USER' Enter

# Step 6: Cancel remaining wizard steps
tmux send-keys -t oauth C-c

# Step 7: Verify
openclaw models status | grep openai-codex
```

For Google OAuth, replace `--auth-choice openai-codex` with `--auth-choice google-gemini-cli`. The flow is identical.

### If running from a local CLI (SSH to VPS)

```bash
ssh YOUR_VPS 'tmux new-session -d -s oauth "openclaw onboard --auth-choice openai-codex --accept-risk"'
ssh YOUR_VPS 'tmux capture-pane -t oauth -p'
ssh YOUR_VPS 'tmux send-keys -t oauth Enter'
# ... extract URL → user clicks → paste redirect URL back ...
ssh YOUR_VPS "tmux send-keys -t oauth 'REDIRECT_URL' Enter"
ssh YOUR_VPS 'tmux send-keys -t oauth C-c'
```

### General principle (any agent)

1. Wrap `openclaw onboard` in `tmux` or `screen`
2. Navigate menus with `send-keys`
3. Extract OAuth URL and send to user
4. Receive redirect URL from user and paste back
5. Verify with `openclaw models status`

---

## Auth Status Monitoring

```bash
# Quick check — exit code 0=ok, 1=expired, 2=expiring soon
openclaw models status --check

# Detailed view — expiry times and quota
openclaw models status

# Full health check with repair suggestions
openclaw doctor
```

---

## Token Storage Architecture

OAuth tokens are stored in 3 locations that do NOT auto-sync:

| Location | Purpose | Auto-Updated? |
|----------|---------|---------------|
| `credentials/oauth.json` | Raw OAuth output from initial onboard | Only on first onboard |
| `models.providers.<name>.apiKey` in `openclaw.json` | Runtime API calls | By auto-refresh |
| `agents/<id>/agent/auth-profiles.json` | Per-agent active tokens | By auto-refresh |

When you manually renew a token via the tmux flow, it is written only to `auth-profiles.json`. Other agents may reference stale tokens from `openclaw.json`.

**After manual renewal**, sync the new token. Example for Codex:

```bash
# Extract new access token from auth-profiles
NEW_TOKEN=$(python3 -c "
import json, glob
for f in glob.glob('$HOME/.openclaw/agents/*/agent/auth-profiles.json'):
    profiles = json.load(open(f))
    for p in profiles:
        if 'openai' in p.get('provider','').lower():
            print(p['access']); break
    else: continue
    break
")

# Update openclaw.json
python3 -c "
import json
c = json.load(open('$HOME/.openclaw/openclaw.json'))
c['models']['providers']['openai-codex']['apiKey'] = '$NEW_TOKEN'
json.dump(c, open('$HOME/.openclaw/openclaw.json','w'), indent=2)
"

# Restart gateway
systemctl --user restart openclaw-gateway.service
```

**Best practice**: Let auto-refresh handle renewal whenever possible. Use the manual tmux flow only when auto-refresh fails.
