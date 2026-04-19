#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_DIR="${OPENCLAW_DIR:-${HOME}/.openclaw}"
ZEROAPI_CFG="$OPENCLAW_DIR/zeroapi-config.json"
OPENCLAW_CFG="$OPENCLAW_DIR/openclaw.json"

say() { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*"; exit 1; }

[ -f "$ZEROAPI_CFG" ] || fail "missing $ZEROAPI_CFG"
[ -f "$OPENCLAW_CFG" ] || fail "missing $OPENCLAW_CFG"

python3 - <<'PY'
import json, os, pathlib, sys
home = pathlib.Path(os.environ.get('OPENCLAW_DIR', str(pathlib.Path.home() / '.openclaw')))
zcfg = json.loads((home / 'zeroapi-config.json').read_text())
ocfg = json.loads((home / 'openclaw.json').read_text())

zero_default = zcfg.get('default_model')
routing_mode = zcfg.get('routing_mode') or 'balanced'
routing_modifier = zcfg.get('routing_modifier') or 'none'
runtime_default = ocfg.get('agents', {}).get('defaults', {}).get('model', {}).get('primary')
print(f'zeroapi.default_model={zero_default}')
print(f'zeroapi.routing_mode={routing_mode}')
print(f'zeroapi.routing_modifier={routing_modifier}')
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

profile = zcfg.get('subscription_profile')
inventory = zcfg.get('subscription_inventory')

enabled_profile = []
if isinstance(profile, dict):
    global_profile = profile.get('global')
    if isinstance(global_profile, dict) and global_profile:
        for provider, selection in global_profile.items():
            if isinstance(selection, dict) and selection.get('enabled') is True:
                enabled_profile.append(provider)
    print(f'subscription_profile.enabled={",".join(enabled_profile) if enabled_profile else "none"}')
else:
    print('subscription_profile.enabled=none')

inventory_accounts = []
inventory_accounts_with_auth = []
if isinstance(inventory, dict):
    accounts = inventory.get('accounts')
    if isinstance(accounts, dict):
        for account_id, account in accounts.items():
            if not isinstance(account, dict):
                continue
            if account.get('enabled') is False:
                continue
            provider = account.get('provider')
            if isinstance(provider, str) and provider:
                inventory_accounts.append(f'{account_id}:{provider}')
                auth_profile = account.get('authProfile')
                if isinstance(auth_profile, str) and auth_profile.strip():
                    inventory_accounts_with_auth.append(f'{account_id}:{auth_profile.strip()}')

print(f'subscription_inventory.accounts={",".join(inventory_accounts) if inventory_accounts else "none"}')
if inventory_accounts_with_auth:
    print(f'subscription_inventory.auth_profiles={",".join(inventory_accounts_with_auth)}')
    print('NOTE: authProfile inventory steering works best on newer OpenClaw runtimes, but ZeroAPI also has a best-effort session-store fallback for older builds.')

if not enabled_profile and not inventory_accounts:
    print('WARN: neither subscription_profile nor enabled subscription_inventory accounts are configured. Routing may silently filter out every provider.')
PY

if [ -d "$OPENCLAW_DIR/extensions/zeroapi-router" ]; then
  warn "manual extension directory detected at $OPENCLAW_DIR/extensions/zeroapi-router - this can shadow or duplicate plugin registry installs"
fi

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
