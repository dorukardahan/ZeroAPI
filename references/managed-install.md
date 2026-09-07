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
3. builds a runtime package under `~/.openclaw/zeroapi-managed/runtime-plugin`
4. installs that package with `openclaw plugins install <path> --force`
5. enables ZeroAPI and its conversation hook access with the OpenClaw CLI, then removes duplicate ZeroAPI development load paths through the same CLI
6. on Linux hosts with `systemctl --user`, enables `zeroapi-managed-update.timer`
7. writes managed install state
8. restarts `openclaw-gateway.service` when possible

The key contract is simple: **skill and plugin should come from the same managed repo snapshot**.

OpenClaw owns the package replacement and install record. Current hosts store
the installed index in shared SQLite machine state; older supported hosts use
their native legacy representation. ZeroAPI does not write
`plugins/installs.json`, the retired `plugins.installs` configuration field, or
SQLite rows itself. The native path install records the managed package as its
source, so later OpenClaw operations see the installed version and source.

The local-source `--force` flag acknowledges the selected source and permits
replacement. It does not bypass OpenClaw's capability consent or install policy.
A rejected native command stops the managed operation. ZeroAPI does not add
capability acceptance, policy-warning acknowledgements, or unsafe-install flags
automatically. Hosts that report legacy install metadata needing migration must
use their supported OpenClaw Doctor workflow before retrying.

Manual `managed_install.mjs` runs inherit terminal input and output, so OpenClaw
can display its native capability review and request consent. Run the command
in an interactive terminal and review those capabilities there. A redirected
or headless invocation still stops when consent is missing; rerun the same
command in a terminal to complete that native review. The scheduled
`managed_update.mjs` path stays noninteractive and stops if new capabilities
need approval. Review such an update through the manual managed-install command
from the intended, reviewed release checkout; the timer does not accept widened
capabilities on the user's behalf.

When user systemd is available, the gateway restart is scheduled about 20
seconds after the command returns. This gives chat-driven installs enough time
to report success before OpenClaw restarts.

The same delayed restart helper can be reused for policy-only reruns:

```bash
node /path/to/ZeroAPI/scripts/reload_gateway.mjs --openclaw-dir ~/.openclaw
```

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

Restoring the plugin also uses the native installer and can fail if the host
rejects the previous package. Such a failure is recorded as `rollback_failed`;
the updater does not replace host state manually. These backups cover the
managed repo and skill, not the host's complete configuration, credentials, or
session databases. Initial installation does not create an update rollback
snapshot.

For verified host versions, SDK boundaries, and reproducible compatibility
checks, see [OpenClaw compatibility](openclaw-compatibility.md).

## When to avoid managed install

Use raw plugin install only if the operator intentionally wants to manage:

- plugin path
- skill path
- update cadence
- rollback

manually.

That fallback still works, but it means drift between plugin and skill becomes the operator's problem again.
