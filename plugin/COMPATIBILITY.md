# ZeroAPI × OpenClaw Compatibility

## Supported OpenClaw versions

ZeroAPI is tested and compatible with OpenClaw `>=2026.5.2`. The latest audited
version at time of writing is `2026.7.1-2`.

## What works

### Model/provider routing — 🟢 Fully compatible

ZeroAPI's `before_model_resolve` hook returns `{ providerOverride, modelOverride }`.
OpenClaw's public hook contract supports both fields natively. This is the primary
routing surface and is fully supported across all OpenClaw versions in range.

### Channel advisory prefix — 🟢 Fully compatible

The `message_sending` hook is a stable public hook used for subscription quota
advisories. No compatibility issues observed.

## Known limitations

### Auth-profile/account routing — 🟡 Best-effort, not same-turn

OpenClaw's public `PluginHookBeforeModelResolveResult` type defines only
`providerOverride` and `modelOverride`. It does **not** include `authProfileOverride`.

ZeroAPI returns `authProfileOverride` in the hook result, but OpenClaw core's
merge logic in `resolveHookModelSelection()` ignores it.

To work around this, ZeroAPI writes the desired auth profile into
`agents/<id>/sessions/sessions.json` before returning from the hook. This has
three consequences:

1. **Not same-turn:** OpenClaw resolves `authProfileId` *before* invoking the
   embedded agent runner where `before_model_resolve` executes. The session-store
   write takes effect on the *next* turn, not the current one.
2. **Race risk:** The write bypasses OpenClaw's session-store lock and cache
   (default TTL: 45s). Under concurrent access or compaction flush, the write
   can be lost or delayed.
3. **Not future-proof:** Upstream OpenClaw `main` has migrated sessions to
   SQLite. When this reaches a stable release, the JSON-only read/write will
   silently fail (`readSessionStore` returns `null` → `session_store_unavailable`).

### What ZeroAPI does about it

Starting from this version, ZeroAPI explicitly detects non-JSON session backends:

- If `openclaw.json` → `session.store` contains a SQLite/database URI or a
  `.sqlite`/`.db` file extension, auth-profile routing is **disabled gracefully**
  with a clear warning log.
- Model routing continues to work normally.
- The `session_auth_sync:session_store_non_json_backend` reason is logged.

### Recommended upstream fix

The preferred long-term solution is for OpenClaw to either:

1. Add `authProfileOverride` to the public `PluginHookBeforeModelResolveResult`
   type, so plugins can select auth profile same-turn; or
2. Expose a public, storage-backend-independent, locked session-entry mutation
   API that plugins can call safely.

Until then, auth-profile routing remains a best-effort, next-turn mechanism.

## CI

The `openclaw-compat` CI job pins an exact OpenClaw version, installs the staged
ClawHub artifact, typechecks against the real SDK, and runs a runtime inspect.
This catches contract drift before release.

When upgrading the pinned OpenClaw version in CI:

1. Update the version in `.github/workflows/test.yml` (`openclaw-compat` job).
2. Update `openclaw.build.lastAuditedOpenClaw` in `plugin/package.json`.
3. Run a local audit using the procedure in the `zeroapi` skill
   (`OpenClaw compatibility gate` section).
