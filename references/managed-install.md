# Managed Install

ZeroAPI now has a preferred **managed install** mode for OpenClaw hosts.

Use:

```bash
node /path/to/ZeroAPI/scripts/managed_install.mjs --openclaw-dir ~/.openclaw
```

## What managed install does

It installs ZeroAPI as a single managed unit:

1. copies the current repo snapshot to `~/.openclaw/zeroapi-managed/repo`
2. syncs `~/.openclaw/skills/zeroapi` from the same snapshot
3. installs the plugin from `~/.openclaw/zeroapi-managed/repo/plugin`
4. writes `~/.openclaw/zeroapi-managed-install.json`
5. on Linux hosts with `systemctl --user`, enables `zeroapi-managed-update.timer`
6. writes managed install state
7. restarts `openclaw-gateway.service` when possible

The key contract is simple: **skill and plugin should come from the same managed repo snapshot**.

When user systemd is available, the gateway restart is scheduled a couple of
seconds after the command returns. This keeps chat-driven installs from killing
the OpenClaw agent before it can report success.

## Managed state file

State lives at:

```text
~/.openclaw/zeroapi-managed-install.json
```

It records:

- installed ZeroAPI version
- managed repo path
- skill path
- plugin path
- update policy
- last check/apply status
- pending major versions
- last error if an update failed

## Auto-update behavior

The updater is conservative:

- checks GitHub tags in the background
- auto-applies **patch** and **minor** releases
- skips **major** releases and records them as pending
- creates backups before replacing repo/skill content
- reinstalls the plugin from the new managed repo
- restarts the gateway when possible
- rolls back to the previous snapshot if the update fails

Manual run:

```bash
node ~/.openclaw/zeroapi-managed/repo/scripts/managed_update.mjs --openclaw-dir ~/.openclaw
```

## Timer behavior

When the host supports user systemd, managed install creates:

- `~/.config/systemd/user/zeroapi-managed-update.service`
- `~/.config/systemd/user/zeroapi-managed-update.timer`

Current schedule:

- daily at `09:00`
- `RandomizedDelaySec=45m`
- `Persistent=true`

## Backup and rollback

Backups are stored under:

```text
~/.openclaw/zeroapi-managed/backups/
```

Each update keeps a timestamped snapshot of:

- previous managed repo
- previous skill directory

Only the latest 3 backup sets are kept.

If a patch/minor update fails after backup creation, ZeroAPI restores the previous repo + skill snapshot and re-installs the previous plugin path.

## When to avoid managed install

Use raw plugin install only if the operator intentionally wants to manage:

- plugin path
- skill path
- update cadence
- rollback

manually.

That fallback still works, but it means drift between plugin and skill becomes the operator's problem again.
