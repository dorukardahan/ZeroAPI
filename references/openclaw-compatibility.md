# OpenClaw compatibility

The 2026-09-06 review checked the deployed OpenClaw `2026.9.1` package and the
minimum supported `2026.5.2` package. The 2026-09-07 refresh checked upstream main
at `6223cf8b74800e22b85f16c71cfd002965d426e0` (package version `2026.9.2`).

| Host | Runtime proof | Session store |
| --- | --- | --- |
| `2026.5.2` | Native CLI import/activation and registered callback dispatch | Native public JSON store |
| `2026.9.1` | Native CLI import/activation and native hook runner | Native public SQLite store |
| Main `6223cf8b74800e22b85f16c71cfd002965d426e0` | Actual pinned source hook runner, bundled without changing upstream | `2026.9.1` public SQLite runtime, with source contract comparison |

The main check executes the current native hook dispatcher. It does not claim a
complete main gateway build, provider request, channel delivery, or migration of
an existing production database. Stable and main hook declarations match for
the model/provider routing result. Changes to the public session patch API are
additive; ZeroAPI delegates storage to that API.

The refresh covers relevant changes in 809 commits since `2d361a8c`. The routing
event/result declarations, hook runner, public session patch entry point and
SDK exports used by ZeroAPI are unchanged. Registry/service internals were
refactored; their public registration methods remain compatible. SQLite adds
server-owned fields that ZeroAPI leaves to the native session API.

Provider discovery became stricter: xAI OAuth no longer seeds a failed live
catalog with static model rows, and OpenAI/MiniMax keep discovery tied to the
selected auth profile. An unavailable catalog or static fallback is not model
entitlement evidence. This preserves the requirement to verify Astra in every
selected account's live catalog.

The fresh ZeroAPI `3.11.0` artifact passed the new source runner, bundled from
148 official source files with the reviewed `2026.9.1` dependencies. Coding and
image routing, registry isolation, persisted account selection and unchanged
legacy JSON passed without warnings or an adapter change. Main's dependency
lock changed; this focused proof does not substitute those dependencies or
claim execution of main's SQLite implementation.

## Runtime boundaries

- The official native `before_model_resolve` contract consumes only
  `modelOverride` and `providerOverride`. ZeroAPI's callback also retains an
  optional `authProfileOverride` extension for hosts that support it. An
  unmodified native runner drops that extra field. ZeroAPI separately saves
  account pins using the public session API; native-host tests verify this
  persistence without claiming guaranteed same-turn account selection.
- Image attachments use the host's typed attachment metadata. Hosts that omit
  it keep the earlier prompt-based behavior.
- Registration is scoped to the host API registry. CLI metadata/setup passes
  stay inert, and background monitoring uses the public service lifecycle.
- The host supplies resolved configuration. A configured custom session store
  is resolved with the official SDK helper before a session patch.
- Installation and installed-index changes use the host CLI. See
  [managed install](managed-install.md) for consent and rollback boundaries.

## Reproduce the checks

Use reviewed dependencies installed with lifecycle scripts disabled. The
following commands assume an exact OpenClaw package is already installed at
`node_modules/openclaw`. Verify its registry integrity against the CI pin before
installation. The scripts do not install dependencies or modify the upstream
checkout.

```bash
node scripts/stage_clawhub_plugin.mjs /tmp/zeroapi-staged
mkdir -p /tmp/zeroapi-staged/node_modules
ln -s "$PWD/node_modules/openclaw" /tmp/zeroapi-staged/node_modules/openclaw

# With the current stable package:
node node_modules/typescript/bin/tsc --project tsconfig.openclaw-compat.json
node scripts/openclaw_compat_smoke.mjs /tmp/zeroapi-staged sqlite native current

# In a separate lane with the minimum supported package:
node scripts/openclaw_compat_smoke.mjs /tmp/zeroapi-staged json callback legacy
```

For current main, check out the exact reviewed official commit in a separate
directory and reuse the installed `2026.9.1` package's dependencies:

```bash
OPENCLAW_MAIN_SHA=6223cf8b74800e22b85f16c71cfd002965d426e0
test "$(git -C /tmp/openclaw-main rev-parse HEAD)" = "$OPENCLAW_MAIN_SHA"
node scripts/openclaw_source_hooks.mjs \
  /tmp/openclaw-main "$OPENCLAW_MAIN_SHA" \
  "$PWD/node_modules/openclaw" /tmp/openclaw-main-hooks
node scripts/openclaw_compat_smoke.mjs \
  /tmp/zeroapi-staged sqlite source current /tmp/openclaw-main-hooks/hooks.mjs
```

The smoke creates and removes its own synthetic HOME, configuration, policy,
and session state. It verifies routing, the absence of native same-turn auth
overrides, persisted account selection, fresh registry registration, and image
routing. SQLite lanes also verify that an obsolete JSON session file is left
unchanged. Services are registered but not started, and no model/provider call
is made. The checked-in model scores are synthetic test data, not current
Artificial Analysis measurements.
