#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.request import Request, urlopen

API_URL = "https://artificialanalysis.ai/api/v2/data/llms/models"
METHODOLOGY_URL = "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "benchmarks.json"
DEFAULT_PLUGIN_OUTPUT = Path(__file__).resolve().parents[1] / "plugin" / "benchmarks.json"
POLICY_FAMILIES_FILE = Path(__file__).resolve().parents[1] / "policy-families.json"
PLUGIN_PACKAGE_FILE = Path(__file__).resolve().parents[1] / "plugin" / "package.json"
PROVIDER_MAP = {
    "openai": "openai-codex",
    "kimi": "moonshot",
    "zai": "zai",
    "minimax": "minimax-portal",
    "alibaba": "qwen",
    "xai": "xai-oauth",
}
BENCHMARK_MAP = {
    "intelligence": "artificial_analysis_intelligence_index",
    "coding": "artificial_analysis_coding_index",
    "math": "artificial_analysis_math_index",
    "tau2": "tau2",
    "terminalbench": ("terminalbench_v2_1", "terminalbench_hard"),
    "ifbench": "ifbench",
    "gpqa": "gpqa",
    "lcr": "lcr",
    "hle": "hle",
    "scicode": "scicode",
    "livecodebench": "livecodebench",
    "mmlu_pro": "mmlu_pro",
    "aime_25": "aime_25",
    "math_500": "math_500",
    "aime": "aime",
}
def resolve_benchmark(evaluations: Dict[str, Any], source_spec: Any) -> Optional[float]:
    """Resolve a benchmark value from AA evaluations, supporting fallback chains.

    ``source_spec`` is normally a single AA field name string. For
    ``terminalbench`` it is a ``(preferred, fallback)`` tuple so that
    ``terminalbench_v2_1`` is preferred when available and falls back to
    ``terminalbench_hard`` for older snapshots.
    """
    if isinstance(source_spec, tuple):
        for key in source_spec:
            value = normalize_optional_number(evaluations.get(key))
            if value is not None:
                return value
        return None
    return normalize_optional_number(evaluations.get(source_spec))


EXCLUDED_SLUG_PATTERNS = ("realtime",)


def load_snapshot_version() -> str:
    package_json = json.loads(PLUGIN_PACKAGE_FILE.read_text())
    version = package_json.get("version")
    if not isinstance(version, str) or not version.strip():
        raise SystemExit("Could not resolve ZeroAPI version from plugin/package.json")
    return version.strip()


def read_key(args: argparse.Namespace) -> str:
    if args.api_key_file:
        return Path(args.api_key_file).read_text().strip()
    env_file = os.environ.get("AA_API_KEY_FILE")
    if env_file:
        return Path(env_file).read_text().strip()
    env_key = os.environ.get("AA_API_KEY")
    if env_key:
        return env_key.strip()
    raise SystemExit("AA API key missing. Use --api-key-file, AA_API_KEY_FILE, or AA_API_KEY.")


def write_json_atomic(path: Path, payload: Dict[str, Any], pretty: int) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(payload, indent=pretty, ensure_ascii=False) + "\n"
    temp_path = output_path.with_name(f".{output_path.name}.{os.getpid()}.tmp")
    try:
        with temp_path.open("w", encoding="utf-8") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        temp_path.replace(output_path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def write_snapshot_pair(root_path: Path, plugin_path: Path, payload: Dict[str, Any], pretty: int) -> None:
    """Serialize once and replace both snapshots as a rollback-safe pair."""
    data = json.dumps(payload, indent=pretty, ensure_ascii=False) + "\n"
    candidates = (Path(root_path), Path(plugin_path))

    # A final symlink has different replacement semantics from its resolved target.
    # Reject the whole pair before creating parents or artifacts.
    for candidate in candidates:
        if candidate.is_symlink():
            raise OSError(f"Refusing final-component snapshot symlink: {candidate}")

    paths: List[Path] = []
    resolved_paths = set()
    for candidate in candidates:
        resolved_path = candidate.resolve(strict=False)
        if resolved_path in resolved_paths:
            continue
        resolved_paths.add(resolved_path)
        paths.append(resolved_path)

    owned = {}
    temp_paths: List[Path] = []
    backup_paths: List[Optional[Path]] = []
    replaced = {}

    def matches_identity(current: os.stat_result, identity: tuple[int, int]) -> bool:
        return (current.st_dev, current.st_ino) == identity

    def cleanup_unhanded_identity(parent: Path, identity: tuple[int, int]) -> None:
        """Remove matching links in the artifact parent without following symlinks."""
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        directory_fd = os.open(str(parent), flags)
        try:
            with os.scandir(directory_fd) as entries:
                for entry in entries:
                    try:
                        current = entry.stat(follow_symlinks=False)
                    except FileNotFoundError:
                        continue
                    if not matches_identity(current, identity):
                        continue
                    try:
                        # Recheck through the held parent fd immediately before unlink.
                        current = os.stat(entry.name, dir_fd=directory_fd, follow_symlinks=False)
                        if matches_identity(current, identity):
                            os.unlink(entry.name, dir_fd=directory_fd)
                    except FileNotFoundError:
                        pass
        finally:
            os.close(directory_fd)

    def create_artifact(path: Path, suffix: str):
        fd, raw_path = tempfile.mkstemp(prefix=f".{path.name}.", suffix=suffix, dir=str(path.parent))
        try:
            artifact_path = Path(raw_path)
            artifact_stat = os.fstat(fd)
            # Hand off to inode-gated outer cleanup only after identity capture.
            owned[artifact_path] = (artifact_stat.st_dev, artifact_stat.st_ino)
            return fd, artifact_path
        except BaseException:
            # Retry once while the exclusive descriptor is still open. Without a
            # recovered identity, ownership is unknown and deleting any path could
            # remove a substitute installed by another actor.
            identity = None
            try:
                retry_stat = os.fstat(fd)
                identity = (retry_stat.st_dev, retry_stat.st_ino)
            except BaseException:
                pass
            finally:
                try:
                    os.close(fd)
                except OSError:
                    pass
            if identity is not None:
                try:
                    cleanup_unhanded_identity(path.parent, identity)
                except OSError:
                    # Preserve the original identity-capture error. Cleanup is
                    # best-effort under concurrent directory mutation.
                    pass
            raise

    def assert_owned(path: Path) -> None:
        identity = owned.get(path)
        current = path.lstat()
        if identity is None or not matches_identity(current, identity):
            raise OSError(f"Owned snapshot artifact changed unexpectedly: {path}")

    def cleanup_owned(path: Path) -> None:
        identity = owned.get(path)
        if identity is None:
            return
        try:
            current = path.lstat()
        except FileNotFoundError:
            return
        if matches_identity(current, identity):
            path.unlink()

    def replace_owned_destination(source: Path, destination: Path, identity: tuple[int, int]) -> bool:
        """Replace only if the destination still names this invocation's inode."""
        source_identity = owned.get(source)
        if source_identity is None:
            raise OSError(f"Snapshot backup ownership missing: {source}")
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        directory_fd = os.open(str(destination.parent), flags)
        try:
            try:
                current = os.stat(destination.name, dir_fd=directory_fd, follow_symlinks=False)
            except FileNotFoundError:
                return False
            if not matches_identity(current, identity):
                return False

            # Recheck the backup and destination through the held parent fd
            # immediately before the rename. Neither check follows symlinks.
            backup = os.stat(source.name, dir_fd=directory_fd, follow_symlinks=False)
            if not matches_identity(backup, source_identity):
                raise OSError(f"Owned snapshot artifact changed unexpectedly: {source}")
            current = os.stat(destination.name, dir_fd=directory_fd, follow_symlinks=False)
            if not matches_identity(current, identity):
                return False
            os.replace(
                source.name,
                destination.name,
                src_dir_fd=directory_fd,
                dst_dir_fd=directory_fd,
            )
        finally:
            os.close(directory_fd)
        owned.pop(source, None)
        return True

    def fsync_directory(path: Path) -> None:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        directory_fd = os.open(str(path), flags)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    try:
        for path in paths:
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.is_symlink():
                raise OSError(f"Refusing final-component snapshot symlink: {path}")
            try:
                target_stat = path.lstat()
            except FileNotFoundError:
                target_stat = None

            temp_fd, temp_path = create_artifact(path, ".tmp")
            temp_paths.append(temp_path)
            try:
                if target_stat is not None:
                    os.fchmod(temp_fd, stat.S_IMODE(target_stat.st_mode))
                with os.fdopen(temp_fd, "w", encoding="utf-8") as handle:
                    temp_fd = -1
                    handle.write(data)
                    handle.flush()
                    os.fsync(handle.fileno())
            finally:
                if temp_fd >= 0:
                    os.close(temp_fd)

            if target_stat is not None:
                backup_fd, backup_path = create_artifact(path, ".bak")
                backup_paths.append(backup_path)
                try:
                    if path.is_symlink():
                        raise OSError(f"Refusing final-component snapshot symlink: {path}")
                    with path.open("rb") as source_handle, os.fdopen(backup_fd, "wb") as backup_handle:
                        backup_fd = -1
                        shutil.copyfileobj(source_handle, backup_handle)
                        os.fchmod(backup_handle.fileno(), stat.S_IMODE(target_stat.st_mode))
                        backup_handle.flush()
                        os.fsync(backup_handle.fileno())
                finally:
                    if backup_fd >= 0:
                        os.close(backup_fd)
            else:
                backup_paths.append(None)

        for temp_path, path in zip(temp_paths, paths):
            if path.is_symlink():
                raise OSError(f"Refusing final-component snapshot symlink: {path}")
            assert_owned(temp_path)
            installed_identity = owned[temp_path]
            temp_path.replace(path)
            owned.pop(temp_path, None)
            replaced[path] = installed_identity
            fsync_directory(path.parent)
    except Exception:
        for path, backup_path in reversed(list(zip(paths, backup_paths))):
            if path not in replaced:
                continue
            if backup_path is not None:
                installed_identity = replaced[path]
                restored = replace_owned_destination(backup_path, path, installed_identity)
                if not restored:
                    try:
                        cleanup_unhanded_identity(path.parent, installed_identity)
                    except OSError:
                        # Preserve the original write failure and never touch an
                        # ownership-unknown rollback destination.
                        pass
            else:
                installed_identity = replaced[path]
                try:
                    current = path.lstat()
                except FileNotFoundError:
                    current = None
                if current is not None and matches_identity(current, installed_identity):
                    path.unlink()
            fsync_directory(path.parent)
        raise
    finally:
        # Only inode identities created exclusively above are eligible for removal.
        for cleanup_path in list(owned):
            cleanup_owned(cleanup_path)


def fetch_data(api_key: str) -> Dict[str, Any]:
    req = Request(API_URL, headers={"x-api-key": api_key, "Accept": "application/json"})
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def normalize_optional_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)) and value > 0:
        return round(float(value), 3)
    return None


def normalize_pricing(pricing: Dict[str, Any]) -> Dict[str, Optional[float]]:
    return {
        "price_1m_blended_3_to_1": normalize_optional_number(pricing.get("price_1m_blended_3_to_1")),
        "price_1m_input_tokens": normalize_optional_number(pricing.get("price_1m_input_tokens")),
        "price_1m_output_tokens": normalize_optional_number(pricing.get("price_1m_output_tokens")),
    }


def should_include(item: Dict[str, Any]) -> bool:
    slug = (item.get("slug") or "").lower()
    if any(pattern in slug for pattern in EXCLUDED_SLUG_PATTERNS):
        return False
    creator_slug = ((item.get("model_creator") or {}).get("slug") or "").lower()
    return creator_slug in PROVIDER_MAP


def load_policy_families() -> tuple[Dict[str, Any], Dict[str, Dict[str, str]]]:
    policy_families = json.loads(POLICY_FAMILIES_FILE.read_text())
    slug_map: Dict[str, Dict[str, str]] = {}

    for family in policy_families.get("families", []):
        family_id = family["id"]
        provider = family["provider"]
        openclaw_model_ids = family.get("openclaw_model_ids", [])
        for index, slug in enumerate(family.get("benchmark_slugs", [])):
            if slug in slug_map:
                raise SystemExit(f"Duplicate benchmark slug in policy-families.json: {slug}")
            openclaw_model_id = None
            if index < len(openclaw_model_ids):
                openclaw_model_id = openclaw_model_ids[index]
            elif openclaw_model_ids:
                openclaw_model_id = openclaw_model_ids[0]
            slug_map[slug] = {
                "family_id": family_id,
                "provider": provider,
                "openclaw_model_id": openclaw_model_id,
            }

    return policy_families, slug_map


def transform_models(
    items: Iterable[Dict[str, Any]],
    policy_slug_map: Dict[str, Dict[str, str]],
) -> List[Dict[str, Any]]:
    transformed: List[Dict[str, Any]] = []
    for item in items:
        if not should_include(item):
            continue
        creator = item.get("model_creator") or {}
        evaluations = item.get("evaluations") or {}
        slug = item.get("slug")
        policy_family = policy_slug_map.get(slug, {})
        transformed.append(
            {
                "name": item.get("name"),
                "slug": slug,
                "id": item.get("id"),
                "creator": creator.get("name"),
                "openclaw_provider": PROVIDER_MAP[creator.get("slug")],
                "openclaw_model": policy_family.get("openclaw_model_id"),
                "release_date": item.get("release_date"),
                "speed_tps": normalize_optional_number(item.get("median_output_tokens_per_second")),
                "ttft_seconds": normalize_optional_number(item.get("median_time_to_first_token_seconds")),
                "ttfa_seconds": normalize_optional_number(item.get("median_time_to_first_answer_token")),
                "pricing": normalize_pricing(item.get("pricing") or {}),
                "policy_family": {
                    "included": bool(policy_family),
                    "family_id": policy_family.get("family_id"),
                },
                "benchmarks": {
                    output_key: resolve_benchmark(evaluations, source_keys)
                    for output_key, source_keys in BENCHMARK_MAP.items()
                },
            }
        )

    provider_order = {provider: index for index, provider in enumerate(PROVIDER_MAP.values())}

    def sort_key(model: Dict[str, Any]) -> Any:
        intelligence = model["benchmarks"].get("intelligence")
        coding = model["benchmarks"].get("coding")
        return (
            provider_order.get(model["openclaw_provider"], 999),
            -(intelligence if intelligence is not None else -1),
            -(coding if coding is not None else -1),
            model["name"] or "",
        )

    transformed.sort(key=sort_key)
    return transformed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Refresh ZeroAPI benchmarks.json from Artificial Analysis API.",
        allow_abbrev=False,
    )
    parser.add_argument("--api-key-file", help="Path to a file containing the Artificial Analysis API key.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output path for benchmarks.json")
    parser.add_argument("--plugin-output", default=str(DEFAULT_PLUGIN_OUTPUT), help="Synchronized plugin snapshot path")
    parser.add_argument("--reannotate", action="store_true", help="Remap an existing snapshot through current policy families without network access")
    parser.add_argument("--input", help="Existing snapshot used by --reannotate (defaults to --output)")
    parser.add_argument("--pretty", type=int, default=2, help="JSON indentation (default: 2)")
    parser.add_argument("--dry-run", action="store_true", help="Print summary only, do not write file.")
    return parser


def reannotate_snapshot(
    snapshot: Dict[str, Any],
    policy_families: Dict[str, Any],
    slug_map: Dict[str, Dict[str, str]],
    snapshot_version: Optional[str] = None,
) -> Dict[str, Any]:
    models = snapshot.get("models") or []
    for model in models:
        mapping = slug_map.get(model.get("slug"), {})
        if mapping:
            model["openclaw_provider"] = mapping["provider"]
        elif model.get("openclaw_provider") == "qwen-portal":
            # Explicit creator-wide compatibility for old, unmapped Qwen rows.
            model["openclaw_provider"] = "qwen"
        model["openclaw_model"] = mapping.get("openclaw_model_id")
        model["policy_family"] = {
            "included": bool(mapping),
            "family_id": mapping.get("family_id"),
        }
    snapshot["version"] = snapshot_version or load_snapshot_version()
    snapshot["note"] = "Routeability and benchmark evidence are separate. Anthropic, Google, and API-only horizon providers are not auto-routed; see references/provider-model-status.md."
    snapshot["policy_families"] = {
        "version": policy_families.get("version"),
        "description": policy_families.get("description"),
        "included_model_count": sum(1 for model in models if model["policy_family"]["included"]),
        "families": policy_families.get("families", []),
    }
    snapshot["providers"] = list(PROVIDER_MAP.values())
    return snapshot


def read_existing_benchmark_categories(
    output_path: Path,
    default_path: Path = DEFAULT_OUTPUT,
) -> Any:
    """Source the round-tripped ``benchmark_categories`` block.

    Prefer the file actually being refreshed (``--output``) so a custom target is
    both the source and the destination; fall back to the canonical repo snapshot,
    and degrade to ``None`` when neither file exists (e.g. a first run writing to a
    brand-new ``--output`` path) instead of raising ``FileNotFoundError``.
    """
    source = output_path if output_path.exists() else default_path
    try:
        return json.loads(source.read_text()).get("benchmark_categories")
    except FileNotFoundError:
        return None


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    snapshot_version = load_snapshot_version()
    policy_families, policy_slug_map = load_policy_families()

    if args.reannotate:
        input_path = Path(args.input) if args.input else Path(args.output)
        payload = reannotate_snapshot(
            json.loads(input_path.read_text()),
            policy_families,
            policy_slug_map,
            snapshot_version,
        )
        print(f"Reannotated {len(payload.get('models') or [])} snapshot models")
        if not args.dry_run:
            write_snapshot_pair(Path(args.output), Path(args.plugin_output), payload, args.pretty)
        return

    api_key = read_key(args)
    response = fetch_data(api_key)
    prompt_options = response.get("prompt_options") or {}
    models = transform_models(response.get("data") or [], policy_slug_map)

    output_path = Path(args.output)
    benchmark_categories = read_existing_benchmark_categories(output_path)
    policy_family_included_count = sum(
        1 for model in models if model.get("policy_family", {}).get("included")
    )
    payload = {
        "version": snapshot_version,
        "source": "Artificial Analysis Data API v2",
        "api": API_URL,
        "fetched": datetime.now(timezone.utc).date().isoformat(),
        "methodology": METHODOLOGY_URL,
        "note": "Routeability and benchmark evidence are separate. Anthropic, Google, and API-only horizon providers are not auto-routed; see references/provider-model-status.md.",
        "prompt_options": prompt_options,
        "benchmark_categories": benchmark_categories,
        "policy_families": {
            "version": policy_families.get("version"),
            "description": policy_families.get("description"),
            "included_model_count": policy_family_included_count,
            "families": policy_families.get("families", []),
        },
        "providers": list(PROVIDER_MAP.values()),
        "models": models,
    }

    print(f"Fetched {len(response.get('data') or [])} API models")
    print(f"Kept {len(models)} ZeroAPI-supported models")
    print(f"Marked {policy_family_included_count} models as policy-family members")
    print(f"Output: {args.output}")

    if args.dry_run:
        return

    output_path = Path(args.output)
    write_snapshot_pair(output_path, Path(args.plugin_output), payload, args.pretty)


if __name__ == "__main__":
    main()
