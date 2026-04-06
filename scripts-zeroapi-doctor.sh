#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_DIR="${HOME}/.openclaw"
ZEROAPI_CFG="$OPENCLAW_DIR/zeroapi-config.json"
OPENCLAW_CFG="$OPENCLAW_DIR/openclaw.json"

say() { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*"; exit 1; }

[ -f "$ZEROAPI_CFG" ] || fail "missing $ZEROAPI_CFG"
[ -f "$OPENCLAW_CFG" ] || fail "missing $OPENCLAW_CFG"

python3 - <<'PY'
import json, pathlib, sys
home = pathlib.Path.home() / '.openclaw'
zcfg = json.loads((home / 'zeroapi-config.json').read_text())
ocfg = json.loads((home / 'openclaw.json').read_text())

zero_default = zcfg.get('default_model')
runtime_default = ocfg.get('agents', {}).get('defaults', {}).get('model', {}).get('primary')
print(f'zeroapi.default_model={zero_default}')
print(f'openclaw.default_model={runtime_default}')
if zero_default != runtime_default:
    print('WARN: default model mismatch between zeroapi-config.json and openclaw.json')

models = set(zcfg.get('models', {}).keys())
for category, rule in zcfg.get('routing_rules', {}).items():
    primary = rule.get('primary')
    if primary not in models:
        print(f'WARN: routing_rules.{category}.primary missing from models: {primary}')
    for fb in rule.get('fallbacks', []):
        if fb not in models:
            print(f'WARN: routing_rules.{category}.fallback missing from models: {fb}')

workspace_hints = zcfg.get('workspace_hints', {})
for agent, hint in workspace_hints.items():
    if hint is not None and not isinstance(hint, list):
        print(f'WARN: workspace_hints.{agent} should be list|null, got {type(hint).__name__}')
PY

if command -v openclaw >/dev/null 2>&1; then
  say "--- openclaw plugins list ---"
  openclaw plugins list | grep zeroapi-router || warn "zeroapi-router not visible in plugin list"
  say "--- openclaw models status (summary) ---"
  openclaw models status | sed -n '1,80p'
else
  warn "openclaw CLI not available in PATH"
fi

say "--- runtime logs (last 20 ZeroAPI lines) ---"
grep -Rni "ZeroAPI Router\|default_mismatch\|skip:\|config_missing" /tmp/openclaw "$OPENCLAW_DIR/logs" 2>/dev/null | tail -n 20 || warn "no ZeroAPI log lines found"
