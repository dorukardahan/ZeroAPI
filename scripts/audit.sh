#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CI_MODE=0
REQUIRE_CLAWPATCH="${REQUIRE_CLAWPATCH:-0}"

for arg in "$@"; do
  case "$arg" in
    --ci) CI_MODE=1 ;;
    --clawpatch) REQUIRE_CLAWPATCH=1 ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

run() {
  echo "+ $*"
  "$@"
}

run npm run release:check
run npm test

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ "$CI_MODE" -eq 1 ]; then
    if [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ] && [ -n "${GITHUB_BASE_REF:-}" ] && git rev-parse "origin/${GITHUB_BASE_REF}" >/dev/null 2>&1; then
      run git diff --check "origin/${GITHUB_BASE_REF}...HEAD"
    elif git rev-parse --verify HEAD^ >/dev/null 2>&1; then
      run git show --check --format=fuller --no-renames HEAD
    else
      run git diff --check
    fi
  else
    run git diff --check
  fi
fi

CLAWPATCH_BIN="${CLAWPATCH_BIN:-/tmp/clawpatch-main/dist/cli.js}"
if [ "$REQUIRE_CLAWPATCH" = "1" ]; then
  if [ ! -f "$CLAWPATCH_BIN" ]; then
    echo "clawpatch binary not found: $CLAWPATCH_BIN" >&2
    exit 1
  fi
  STATE_DIR="${CLAWPATCH_STATE_DIR:-/tmp/zeroapi-clawpatch-smoke-state}"
  MAP_OUT="${CLAWPATCH_MAP_OUT:-/tmp/zeroapi-clawpatch-smoke-map.json}"
  STATUS_OUT="${CLAWPATCH_STATUS_OUT:-/tmp/zeroapi-clawpatch-smoke-status.json}"
  rm -rf "$STATE_DIR"
  run node "$CLAWPATCH_BIN" --root "$ROOT" --state-dir "$STATE_DIR" --no-color --no-input init
  echo "+ node $CLAWPATCH_BIN --root $ROOT --state-dir $STATE_DIR --no-color --no-input map --source heuristic --json > $MAP_OUT"
  node "$CLAWPATCH_BIN" --root "$ROOT" --state-dir "$STATE_DIR" --no-color --no-input map --source heuristic --json > "$MAP_OUT"
  echo "+ node $CLAWPATCH_BIN --root $ROOT --state-dir $STATE_DIR --no-color --no-input status --json > $STATUS_OUT"
  node "$CLAWPATCH_BIN" --root "$ROOT" --state-dir "$STATE_DIR" --no-color --no-input status --json > "$STATUS_OUT"
  echo "clawpatch smoke outputs: $MAP_OUT $STATUS_OUT"
else
  echo "clawpatch smoke skipped; pass --clawpatch or REQUIRE_CLAWPATCH=1 to enable"
fi
