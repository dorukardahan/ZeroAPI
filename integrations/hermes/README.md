# ZeroAPI for Hermes Agent

This directory contains the Hermes Agent adapter for ZeroAPI.

Hermes plugins are Python, so this adapter runs ZeroAPI policy directly in
Python instead of spawning Node on every message. It reads the same
`zeroapi-config.json` shape used by the OpenClaw plugin and returns a
`pre_model_route` proposal to Hermes. Hermes still owns credential lookup,
provider normalization, base URLs, API modes, and model switching.

## Requirements

- Hermes Agent with a working `pre_model_route` runtime path.
- PyYAML 6.x for host-equivalent plugin manifest parsing. Hermes installations
  normally provide it; repository test environments can install the pinned test
  dependency from `integrations/hermes/requirements-test.txt`.
- A ZeroAPI policy file at one of:
  - `$ZEROAPI_CONFIG_PATH`
  - `~/.hermes/zeroapi-config.json`
  - `~/.openclaw/zeroapi-config.json`

The compatibility requirement is stricter than "the hook name exists."
Hermes must actually invoke `pre_model_route` during the agent turn, discover
plugins before invoking it, and rebuild the system prompt when a route switch
changes provider/model. Otherwise the model can route correctly at runtime while
the prompt still tells the agent it is running on the old model.

For multi-agent use, Hermes must also build delegated child agents with a
consistent `provider` / `model` / `base_url` / `api_mode` tuple. A parent turn
can route to the right model but still spawn a child that inherits the old
endpoint unless the delegation runtime path is normalized.

Do not work around missing runtime support by mutating private gateway internals
from `pre_gateway_dispatch`; that path is session-scoped and can leak across
turns. Use the doctor and optional runtime patch below until the behavior lands
in the Hermes release you use.

## Install

Historical Hermes source fixtures live under `tests/fixtures/`. This keeps them
available to the adapter's regression tests while letting the host classify
them as test data during deprecated-import scans. Runtime imports remain subject
to the host's normal compatibility and removal-date checks.

Use the transactional installer from a trusted checkout:

```bash
python3 integrations/hermes/install.py
```

The installer checks Hermes's bundled, user, and project plugin discovery roots
before mutation and refuses duplicate `zeroapi-router` names from
`plugin.yaml`, `plugin.yml`, or portable `plugin.json` manifests. YAML takes
precedence when a directory contains both formats, matching Hermes discovery.
Portable manifests require the Agent Plugins v1 schema and name rules.
For custom layouts, pass `--destination`, one or
more `--discovery-root` values, and `--backup-root` explicitly. Upgrade backups,
staged candidates, and rollback journals are stored under
`$HERMES_HOME/backups/zeroapi-router/`, outside plugin discovery roots and on the
same filesystem as the destination. They are never created as discoverable
sibling plugin directories.

An upgrade first records a durable journal, then moves the current tree to the
external transaction directory before activating the staged candidate. If the
process stops between those steps, the next installer invocation recovers the
exact pre-install tree before starting new work. Rollback uses the same journaled
rename choreography and resumes safely after an interruption.

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
OK Hermes runtime can apply ZeroAPI pre_model_route safely.
```

If the doctor fails on a Hermes install you control, preview the compatibility
patch:

```bash
python ~/.hermes/plugins/zeroapi-router/patch_runtime.py --dry-run
```

Apply source changes to an inactive staging checkout and validate it before
activating that release. If updating a checkout in place, stop Hermes and drain
its turns/workers first: per-file atomic replacement does not make a group of
Python modules safe to replace while they are being imported. Keep the previous
release and its runtime transaction available until acceptance passes.

From the target Hermes environment, apply the validated patch:

```bash
python ~/.hermes/plugins/zeroapi-router/patch_runtime.py
```

The patch supports these verified runtime layouts:

- the legacy monolithic turn loop in `run_agent.py`
- the modular turn loop in `agent/conversation_loop.py`
- Hermes v0.19's turn prologue in `agent/turn_context.py`
- the split `AIAgent` lazy forwarders and `TurnFacadeMixin` on upstream main
  [`693641aa`](https://github.com/NousResearch/hermes-agent/tree/693641aa8b4359c602283bdbbc14041e03bc47bc),
  checked on 2026-09-07

The current-main recipe adds `agent/model_routing.py` and patches the actual
turn, runtime-helper, delegate-config, and plugin-hook owners. It preserves
native model/provider resolution and capability propagation. Automatic routes
use `persist_primary=False` and `prune_fallback_chain=False`; a manual model
switch retains the host's persistent behavior. A routed continuation restores
the primary frozen prompt before selecting its route, keeps routed prompt bytes
out of the saved primary prompt, and restores the original prompt/static prefix
and plugin sections for the next turn. Real provider failures still obey native
fallback cooldowns.

Layout selection is structural and fail-closed. Every required source is read,
transformed, compiled, and checked with the doctor's AST/call-graph proof before
the first write. Changed files are staged beside their targets and committed with
atomic per-file replacements. If a handled commit failure occurs, already replaced
files are restored and verified from the transaction journal; a module created
by that transaction is removed on rollback. Unrelated changes made after
planning cause a refusal. A second successful
run is a no-op and creates no additional backup.

The recipe accepts only reviewed source blocks. An unknown or differently
customized runtime fails before writing. Already compatible split runtimes pass
the doctor and remain unchanged. The patch does not migrate Hermes configuration,
session databases, service units, memory providers, or channel bridges.

For staging, pass all three source selectors explicitly so auto-discovery cannot
mix the staged checkout with the installed interpreter's source:

```bash
python integrations/hermes/patch_runtime.py --dry-run \
  --run-agent /path/to/staged-hermes/run_agent.py \
  --plugins /path/to/staged-hermes/hermes_cli/plugins.py \
  --delegate-tool /path/to/staged-hermes/tools/delegate_tool.py \
  --backup-root /path/to/external-runtime-backups
```

Repeat without `--dry-run` only for the inactive checkout. The remaining module
paths are resolved beside the explicit `run_agent.py`.

Runtime originals and journals are stored under
`$HERMES_HOME/backups/zeroapi-router/`, outside plugin discovery roots. To restore
one committed runtime transaction:

```bash
python ~/.hermes/plugins/zeroapi-router/patch_runtime.py \
  --rollback-transaction "$HERMES_HOME/backups/zeroapi-router/<transaction>"
```

For a custom Hermes layout, repeat `--plugin-discovery-root` for every configured
plugin root when passing `--backup-root`. Backup isolation is validated before
recovery or mutation, and `--dry-run` never recovers or writes a transaction.

To restore a plugin upgrade, pass its external transaction directory to the
installer:

```bash
python ~/.hermes/plugins/zeroapi-router/install.py \
  --rollback "$HERMES_HOME/backups/zeroapi-router/<transaction>"
```

Run the doctor again after restart. If a future Hermes release passes the doctor
without the patch, prefer the upstream runtime.

## Manual Model Selection Limitation

The verified v0.19 and main `693641aa` hook contracts do not expose public per-turn model-selection provenance or scope
to `pre_model_route`. The adapter can see the effective provider and model, but it
cannot distinguish a manual session selection or a one-turn `/model --once`
selection from an earlier automatic route. Therefore ZeroAPI cannot guarantee that
manual or one-turn model selections take precedence on this Hermes release.

ZeroAPI does not inspect or mutate private gateway/session override state as a
workaround. A reliable precedence contract requires Hermes to expose immutable
selection metadata (for example, source plus turn/session scope) or to suppress
automatic routing for explicitly selected turns. Until that public host contract
exists, manual and one-turn precedence are documented non-goals for this adapter.

## Provider Mapping

ZeroAPI config files may use OpenClaw provider IDs. The adapter maps those to
Hermes provider IDs before returning a route:

- `openai`, `openai-codex` -> `openai-codex`
- `zai` -> `zai`
- `kimi`, `kimi-coding` -> `kimi-coding`
- `moonshot` remains `moonshot` and is excluded from subscription routing;
  Moonshot API access is separate from Kimi Coding membership
- `minimax-portal`, `minimax` -> `minimax-oauth`
- `qwen-oauth`, `qwen-portal`, `qwen-cli` -> `qwen-oauth`
- `qwen`, `qwen-dashscope` -> `alibaba-coding-plan` (separate Qwen Cloud/Coding Plan; not Portal)

You can override these defaults with a `hermes_provider_map` object in
`zeroapi-config.json`.

Kimi Coding model IDs such as `k3-256k` and `kimi-for-coding` are model names,
not provider IDs. Legacy Moonshot policies or account profiles are not renamed
automatically. Qwen Portal remains supported on the verified Hermes runtime;
current OpenClaw has removed that provider, so new OpenClaw starters differ.

## Runtime Contract

ZeroAPI returns only:

```json
{"provider": "zai", "model": "glm-5.3", "reason": "zeroapi:orchestration:keyword:workflow"}
```

It never returns API keys, auth profiles, base URLs, or transport settings.
Hermes resolves those through its own model switch pipeline.

The adapter also mirrors the important OpenClaw routing gates:

- providers listed in `disabled_providers` or `ZEROAPI_DISABLED_PROVIDERS`
  are never selected
- explicit specialist agents in `workspace_hints` with `null` are skipped
- unhinted agents already running a non-default model are skipped
- `cron` and `heartbeat` triggers are skipped when Hermes supplies them
- high-risk keyword matches are diagnostic only and do not block routing
- external current models are left alone unless `external_model_policy` is `allow`

## Quota Signals and Adapter Difference

The full quota-signal provenance, privacy, normalization, and fallback contract is in [`references/routing-policy-spec.md`](../../references/routing-policy-spec.md#runtime-quota-signal-contract).

Hermes does not collect quota data for ZeroAPI. The adapter makes no provider-dashboard or quota-endpoint request, and `pre_model_route` has no quota-snapshot input. The shared policy file contains static subscription/account hints only. `quota.py` is a token-free normalization and pressure-math substrate for a future host integration; it does not log or persist snapshots, and `router.py` does not import or call it.

At the quota-module boundary, absent, non-`fresh` (including stale), malformed, and model-inapplicable observations return no live pressure, which means a caller must retain static pressure. Fresh valid observations use the same minimum-window and square-root factor as the TypeScript module. The adapter differs after that point: it has no quota-aware account-selector helper, so even confirmed depletion is not applied by the current Hermes router. All shipped Hermes routes therefore use configured tier, `usagePriority`, `intendedUse`, and account-count pressure exactly as they do when no runtime signal exists.

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

For a `zai/glm-5.2` main model with OpenAI Codex as the best eligible vision
subscription, this writes:

```yaml
auxiliary:
  vision:
    provider: openai-codex
    model: gpt-5.6-sol
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
python3 integrations/hermes/test_doctor.py
python3 integrations/hermes/test_runtime_patch.py
python3 integrations/hermes/test_install.py
```

The source compatibility suite can also use explicit public Hermes sources.
`ZEROAPI_HERMES_GIT_ROOT` enables tests against the pinned pristine main Git
objects, including real patch application, import of the new route module,
idempotency, rollback, and fault injection. `ZEROAPI_HERMES_SOURCE_ROOT` checks
an already compatible main checkout. These tests read an exact list of Python
source paths, never a runtime home.

```bash
PYTHONPATH=integrations/hermes \
ZEROAPI_HERMES_GIT_ROOT=/path/to/public-hermes-git \
python3 -m pytest integrations/hermes/test_upstream_source.py -q
```

Source proofs supplement native acceptance. Run the following with the staged
Hermes environment's own Python and dependencies, installed using its reviewed
lockfile. This performs real `AIAgent` imports, model switches, two-turn restores,
fresh-agent continuation against a temporary `SessionDB`, child provider/pool
normalization, callable credential identity, and native plugin-manifest parity.

```bash
/path/to/hermes/venv/bin/python -I -B \
  integrations/hermes/native_smoke.py --hermes-root /path/to/staged-hermes
```

The runner creates a temporary HOME/HERMES_HOME, passes a small explicit child
environment, disables plugin auto-discovery from operator directories, and
blocks network connections and child-process launches inside the tests. It
does not call a model API or contact a messaging channel. Portable manifest
tests are explicitly skipped on older Hermes versions without that module;
the routing and delegation tests remain required. Run it on both pristine-main
plus the proposed patch and any older runtime that will receive an upgrade.

If that native environment lacks pytest, `--test-deps /path/to/reviewed-test-deps`
can supply only its missing test dependencies. The directory is appended after
the native runtime's packages, so it cannot replace them. Use an isolated copy
of reviewed pytest dependencies, never another Hermes virtualenv's entire
`site-packages`, and keep production environments unchanged.
