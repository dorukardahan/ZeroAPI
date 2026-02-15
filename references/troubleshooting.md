# Troubleshooting

## Gateway crashes with "No API provider registered for api: undefined"

**Cause**: The `api` field is missing from a custom provider.

**Fix**: Add the correct `api` field:
- OpenAI Codex (in `openclaw.json`): `"api": "openai-responses"`
- Kimi (in `openclaw.json`): `"api": "openai-completions"`
- Google Gemini (in per-agent `models.json` ONLY): `"api": "google-gemini-cli"`

Do NOT use `"api": "google-generative-ai"` for subscription OAuth — that type sends auth via `x-goog-api-key` header which rejects OAuth tokens. Use `"google-gemini-cli"` instead.

## Google Gemini returns "API key not valid" with subscription

**Cause**: Gemini provider is using the wrong API type.

Two possible causes:
1. Provider is in `openclaw.json` with `"api": "google-generative-ai"` — move it to per-agent `models.json` with `"api": "google-gemini-cli"` instead.
2. Provider has a `baseUrl` set — remove it entirely. The `google-gemini-cli` stream function has the correct endpoint hardcoded.

See `references/provider-config.md` for the correct setup.

## Model shows `missing` in `openclaw models status`

**Cause**: The model ID does not match the provider's catalog.

For `gemini-2.5-flash-lite`: use the ID **without** `-preview` suffix (the `-preview` alias was deprecated Aug 2025). The model may show as `configured,missing` because OpenClaw's catalog hasn't added it yet (issue #10284, PR #10984 pending) — but it still works for API calls. The `normalizeGoogleModelId()` function only normalizes Gemini 3 model IDs — Gemini 2.5 IDs must match exactly.

## Codex stops working (401 Unauthorized)

**Cause**: The Codex OAuth token has expired and auto-refresh failed. This can happen if the refresh token itself expired (typically after 10+ days without use).

**Fix**: Guide the user through the OAuth flow described in `references/oauth-setup.md`. Use the tmux method to run `openclaw onboard --auth-choice openai-codex`, extract the URL, send it to the user, and paste back the redirect URL.

OpenClaw 2026.2.6+ auto-refreshes tokens automatically — this manual flow is only needed when auto-refresh fails. Note: the user's normal ChatGPT usage (web, mobile, Codex CLI, Codex app) does NOT cause this — tested Feb 2026.

## Sub-agent returns "Unknown model"

**Cause**: The model is registered in the main agent context but not available in sub-agent context.

**Fix**: Check that the model's provider has a valid auth-profile. Run `openclaw models status` to verify. Ensure the sub-agent's `models.json` includes the provider (see `references/provider-config.md` for Google Gemini's special per-agent setup).
