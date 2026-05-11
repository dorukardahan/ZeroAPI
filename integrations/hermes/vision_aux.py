"""Hermes auxiliary vision config helper for ZeroAPI.

Hermes has two separate model decisions for image turns:

- the main turn model, routed by ZeroAPI's ``pre_model_route`` hook
- the ``vision_analyze`` auxiliary model, chosen from ``auxiliary.vision``

When ``auxiliary.vision.provider`` is left as ``auto``, Hermes may try the
main provider's own vision model. That is not always subscription-safe; for
example, Z.AI Coding Plan text models do not imply GLM-5V-Turbo access.
This helper derives a safe auxiliary vision override from the same
``zeroapi-config.json`` policy that the router uses.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from router import ZeroAPIRouter, load_config

VISION_PROBE_PROMPT = "Please inspect the attached screenshot."


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _write_text(path: Path, value: str) -> None:
    path.write_text(value, encoding="utf-8")


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(_read_text(path))


def _extract_main_runtime(config_text: str) -> tuple[str | None, str | None]:
    """Extract ``model.provider`` and ``model.default`` from simple YAML.

    This intentionally avoids adding a PyYAML dependency to the adapter tests.
    Hermes' generated config stores the active runtime in this plain shape:

    model:
      provider: zai
      default: glm-5.1
    """
    in_model = False
    provider: str | None = None
    model: str | None = None
    for raw_line in config_text.splitlines():
        line = raw_line.rstrip()
        if line == "model:":
            in_model = True
            continue
        if in_model and line and not line.startswith(" "):
            break
        if not in_model:
            continue
        stripped = line.strip()
        if stripped.startswith("provider:"):
            provider = stripped.split(":", 1)[1].strip().strip("'\"") or None
        elif stripped.startswith("default:"):
            model = stripped.split(":", 1)[1].strip().strip("'\"") or None
    return provider, model


def _current_model_key(provider: str | None, model: str | None) -> str | None:
    if provider and model:
        return f"{provider}/{model}"
    return model


def resolve_auxiliary_vision_route(
    zeroapi_config: dict[str, Any],
    *,
    current_provider: str | None = None,
    current_model: str | None = None,
    agent_id: str | None = None,
) -> dict[str, str] | None:
    """Return a Hermes ``auxiliary.vision`` provider/model override.

    The route is selected through the regular ZeroAPI Hermes router using an
    image-attachment probe. If the current model already supports vision, the
    router may return ``None``; in that case no auxiliary override is needed.
    """
    route = ZeroAPIRouter(zeroapi_config).resolve(
        VISION_PROBE_PROMPT,
        current_model=_current_model_key(current_provider, current_model),
        platform="hermes",
        agent_id=agent_id,
        has_image_attachment=True,
    )
    if not route:
        return None
    return {
        "provider": route["provider"],
        "model": route["model"],
        "reason": route["reason"],
    }


def _replace_or_append_auxiliary_vision(config_text: str, provider: str, model: str) -> str:
    """Set top-level ``auxiliary.vision.provider/model`` in YAML text.

    The implementation only edits the narrow section it owns. It preserves the
    rest of ``config.yaml`` and appends a new section when none exists.
    """
    lines = config_text.splitlines()
    out: list[str] = []
    index = 0
    wrote_auxiliary = False

    while index < len(lines):
        line = lines[index]
        if line.startswith("auxiliary:"):
            wrote_auxiliary = True
            out.append(line)
            index += 1
            inserted_vision = False
            while index < len(lines):
                current = lines[index]
                if current and not current.startswith(" "):
                    break
                if current.startswith("  vision:"):
                    inserted_vision = True
                    out.append(current)
                    index += 1
                    seen_provider = False
                    seen_model = False
                    while index < len(lines):
                        nested = lines[index]
                        if nested.startswith("  ") and not nested.startswith("    ") and nested.strip():
                            break
                        if nested.startswith("    provider:"):
                            out.append(f"    provider: {provider}")
                            seen_provider = True
                        elif nested.startswith("    model:"):
                            out.append(f"    model: {model}")
                            seen_model = True
                        else:
                            out.append(nested)
                        index += 1
                    if not seen_provider:
                        out.append(f"    provider: {provider}")
                    if not seen_model:
                        out.append(f"    model: {model}")
                    continue
                out.append(current)
                index += 1
            if not inserted_vision:
                out.extend([
                    "  vision:",
                    f"    provider: {provider}",
                    f"    model: {model}",
                    "    timeout: 120",
                ])
            continue
        out.append(line)
        index += 1

    if not wrote_auxiliary:
        if out and out[-1].strip():
            out.append("")
        out.extend([
            "auxiliary:",
            "  vision:",
            f"    provider: {provider}",
            f"    model: {model}",
            "    timeout: 120",
        ])

    return "\n".join(out) + "\n"


def configure_auxiliary_vision(
    hermes_config_path: Path,
    *,
    zeroapi_config_path: Path | None = None,
    dry_run: bool = False,
) -> dict[str, str | bool | None]:
    """Apply the ZeroAPI-selected vision auxiliary override to Hermes config."""
    hermes_text = _read_text(hermes_config_path)
    current_provider, current_model = _extract_main_runtime(hermes_text)

    if zeroapi_config_path is not None:
        zeroapi_config = _load_json(zeroapi_config_path)
    else:
        loaded = load_config()
        if loaded is None:
            raise RuntimeError("ZeroAPI config not found")
        zeroapi_config = loaded

    route = resolve_auxiliary_vision_route(
        zeroapi_config,
        current_provider=current_provider,
        current_model=current_model,
    )
    if route is None:
        return {
            "changed": False,
            "provider": None,
            "model": None,
            "reason": "no_auxiliary_override_needed",
        }

    next_text = _replace_or_append_auxiliary_vision(
        hermes_text,
        route["provider"],
        route["model"],
    )
    changed = next_text != hermes_text
    if changed and not dry_run:
        _write_text(hermes_config_path, next_text)

    return {
        "changed": changed,
        "provider": route["provider"],
        "model": route["model"],
        "reason": route["reason"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Configure Hermes auxiliary vision from ZeroAPI policy.")
    parser.add_argument("--hermes-config", type=Path, default=Path.home() / ".hermes" / "config.yaml")
    parser.add_argument("--zeroapi-config", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = configure_auxiliary_vision(
        args.hermes_config,
        zeroapi_config_path=args.zeroapi_config,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
