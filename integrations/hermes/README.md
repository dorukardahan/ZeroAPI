# ZeroAPI for Hermes Agent

This directory contains an experimental Hermes Agent adapter for ZeroAPI.

Hermes plugins are Python, so this adapter runs ZeroAPI policy directly in
Python instead of spawning Node on every message. It reads the same
`zeroapi-config.json` shape used by the OpenClaw plugin and returns a
`pre_model_route` proposal to Hermes.

## Requirements

- Hermes Agent with `pre_model_route` hook support.
- A ZeroAPI policy file at one of:
  - `$ZEROAPI_CONFIG_PATH`
  - `~/.hermes/zeroapi-config.json`
  - `~/.openclaw/zeroapi-config.json`

Until `pre_model_route` is available in a Hermes release, this adapter should
be treated as integration-ready source, not a guaranteed stable install path.

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

## Test

```bash
python3 integrations/hermes/test_router.py
```
