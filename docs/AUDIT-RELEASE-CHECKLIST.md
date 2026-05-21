# Audit and Release Checklist

Use this checklist before merging, tagging, publishing to ClawHub, or aligning a runtime host.

## Local audit

```bash
npm run audit
```

Optional Clawpatch smoke, using a local checkout of `openclaw/clawpatch`:

```bash
REQUIRE_CLAWPATCH=1 npm run audit
```

The Clawpatch smoke writes state outside the repo under `/tmp/zeroapi-clawpatch-smoke-*`.

## Release preflight

```bash
npm run release:check
```

This verifies:

- root package, plugin package, OpenClaw manifest, lockfile, skills, Hermes adapter and runtime banner use the same version;
- `activation.onStartup=true` stays present;
- ClawHub install metadata stays source-linked;
- staging uses lockfile-backed local `npm exec --no -- esbuild`;
- benchmark refresh does not accept raw `--api-key`;
- benchmark output keeps same-directory atomic replace semantics.

## Publish and runtime alignment

After a GitHub release or ClawHub workflow dispatch, verify:

- the GitHub release tag points at the intended commit;
- the `Publish ClawHub Plugin` workflow completed successfully;
- ClawHub latest and exact version metadata match the released version;
- exact `clawhub:zeroapi@VERSION` install smoke passed;
- Asuman OpenClaw install records, runtime package and manifest all report the same version;
- Hermes Dorry and Hermes Dobby `zeroapi-router/plugin.yaml` versions match the same version.

Never print API keys, tokens, private credentials or phone numbers while collecting verification evidence.
