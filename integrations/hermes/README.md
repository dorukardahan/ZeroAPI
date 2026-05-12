# ZeroAPI for Hermes Agent

This directory contains the Hermes Agent adapter for ZeroAPI.

Hermes plugins are Python, so this adapter runs ZeroAPI policy directly in
Python instead of spawning Node on every message. It reads the same
`zeroapi-config.json` shape used by the OpenClaw plugin and returns a
`pre_model_route` proposal to Hermes. Hermes still owns credential lookup,
provider normalization, base URLs, API modes, and model switching.

## Requirements

- Hermes Agent with `pre_model_route` hook support.
- A ZeroAPI policy file at one of:
  - `$ZEROAPI_CONFIG_PATH`
  - `~/.hermes/zeroapi-config.json`
  - `~/.openclaw/zeroapi-config.json`

Current upstream Hermes releases may not expose `pre_model_route` yet. Do not
work around that by mutating private gateway internals from
`pre_gateway_dispatch`; that path is session-scoped and can leak across turns.
Use the small Hermes core hook patch until the hook is released upstream.

## Install

Copy this directory into the Hermes plugin directory:

```bash
mkdir -p ~/.hermes/plugins/zeroapi-router
cp -R integrations/hermes/* ~/.hermes/plugins/zeroapi-router/
```

Then enable the plugin in `~/.hermes/config.yaml`:

```yaml
plugins:
  enabled:
    - zeroapi-router
```

Run the compatibility doctor from the Hermes environment:

```bash
python ~/.hermes/plugins/zeroapi-router/doctor.py
```

Expected output:

```text
OK Hermes exposes pre_model_route. ZeroAPI Hermes routing can be enabled.
```

## Provider Mapping

ZeroAPI config files may use OpenClaw provider IDs. The adapter maps those to
Hermes provider IDs before returning a route:

- `openai-codex` -> `openai-codex`
- `zai` -> `zai`
- `moonshot`, `kimi`, `kimi-coding` -> `kimi-for-coding`
- `minimax-portal`, `minimax` -> `minimax-oauth`
- `qwen-portal`, `qwen` -> `qwen-oauth`
- `qwen-dashscope` -> `alibaba-coding-plan`

You can override these defaults with a `hermes_provider_map` object in
`zeroapi-config.json`.

## Runtime Contract

ZeroAPI returns only:

```json
{"provider": "zai", "model": "glm-5.1", "reason": "zeroapi:orchestration:keyword:workflow"}
```

It never returns API keys, auth profiles, base URLs, or transport settings.
Hermes resolves those through its own model switch pipeline.

The adapter also mirrors the important OpenClaw safety gates:

- providers listed in `disabled_providers` or `ZEROAPI_DISABLED_PROVIDERS`
  are never selected
- explicit specialist agents in `workspace_hints` with `null` are skipped
- unhinted agents already running a non-default model are skipped
- `cron` and `heartbeat` triggers are skipped when Hermes supplies them
- high-risk messages stay on the current model
- external current models are left alone unless `external_model_policy` is `allow`

For emergency provider shutdowns, use either config or env:

```json
{
  "disabled_providers": ["openai-codex"]
}
```

```bash
export ZEROAPI_DISABLED_PROVIDERS=openai-codex
```

This is useful when an OAuth provider needs re-authorization. ZeroAPI does not
copy, refresh, or store OAuth tokens. Re-authorize every Hermes home separately;
do not copy one Hermes `auth.json` into another instance.

To check for accidental OAuth credential reuse across Hermes homes:

```bash
python3 integrations/hermes/auth_audit.py ~/.hermes /opt/other-hermes-home
```

## Vision Auxiliary Routing

Hermes image turns have two model decisions:

- the main reply model, routed by the `pre_model_route` hook
- the `vision_analyze` auxiliary model, configured under `auxiliary.vision`

If `auxiliary.vision.provider` is left as `auto`, Hermes can try the main
provider's own vision model before ZeroAPI gets a chance to route the main
turn. That is not always subscription-safe. For example, a Z.AI Coding Plan
subscription can include GLM text models without including GLM-5V-Turbo API
access.

Use the helper below to derive a safe `auxiliary.vision` override from the
same `zeroapi-config.json` policy:

```bash
python3 integrations/hermes/vision_aux.py \
  --hermes-config ~/.hermes/config.yaml \
  --zeroapi-config ~/.hermes/zeroapi-config.json
```

For a `zai/glm-5.1` main model with OpenAI Codex as the best eligible vision
subscription, this writes:

```yaml
auxiliary:
  vision:
    provider: openai-codex
    model: gpt-5.5
    timeout: 120
```

Run this after the ZeroAPI policy changes or after adding/removing a vision
capable subscription.

The helper does not hardcode OpenAI. It runs the same subscription-aware ZeroAPI
ranking as the hot-path router. If another configured provider has the best
eligible vision model, the helper writes that provider/model instead. Z.AI
Coding Plan text subscriptions do not make `glm-5v-turbo` eligible unless the
user explicitly adds a VLM/API route with image-capable runtime metadata.

## Test

```bash
python3 integrations/hermes/test_router.py
python3 integrations/hermes/test_auth_audit.py
python3 integrations/hermes/test_vision_aux.py
python3 integrations/hermes/doctor.py
```
