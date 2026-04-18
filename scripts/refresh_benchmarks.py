#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.request import Request, urlopen

API_URL = "https://artificialanalysis.ai/api/v2/data/llms/models"
METHODOLOGY_URL = "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "benchmarks.json"
POLICY_FAMILIES_FILE = Path(__file__).resolve().parents[1] / "policy-families.json"
PROVIDER_MAP = {
    "openai": "openai-codex",
    "kimi": "moonshot",
    "zai": "zai",
    "minimax": "minimax-portal",
    "alibaba": "qwen",
}
BENCHMARK_MAP = {
    "intelligence": "artificial_analysis_intelligence_index",
    "coding": "artificial_analysis_coding_index",
    "math": "artificial_analysis_math_index",
    "tau2": "tau2",
    "terminalbench": "terminalbench_hard",
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
EXCLUDED_SLUG_PATTERNS = ("realtime",)


def read_key(args: argparse.Namespace) -> str:
    if args.api_key:
        return args.api_key.strip()
    if args.api_key_file:
        return Path(args.api_key_file).read_text().strip()
    env_key = os.environ.get("AA_API_KEY")
    if env_key:
        return env_key.strip()
    env_file = os.environ.get("AA_API_KEY_FILE")
    if env_file:
        return Path(env_file).read_text().strip()
    raise SystemExit(
        "AA API key missing. Use --api-key-file, --api-key, AA_API_KEY_FILE, or AA_API_KEY."
    )


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
                    output_key: normalize_optional_number(evaluations.get(source_key))
                    for output_key, source_key in BENCHMARK_MAP.items()
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh ZeroAPI benchmarks.json from Artificial Analysis API.")
    parser.add_argument("--api-key", help="Artificial Analysis API key. Prefer --api-key-file or AA_API_KEY.")
    parser.add_argument("--api-key-file", help="Path to a file containing the Artificial Analysis API key.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output path for benchmarks.json")
    parser.add_argument("--pretty", type=int, default=2, help="JSON indentation (default: 2)")
    parser.add_argument("--dry-run", action="store_true", help="Print summary only, do not write file.")
    args = parser.parse_args()

    api_key = read_key(args)
    response = fetch_data(api_key)
    prompt_options = response.get("prompt_options") or {}
    policy_families, policy_slug_map = load_policy_families()
    models = transform_models(response.get("data") or [], policy_slug_map)

    benchmark_categories = json.loads(DEFAULT_OUTPUT.read_text()).get("benchmark_categories")
    policy_family_included_count = sum(
        1 for model in models if model.get("policy_family", {}).get("included")
    )
    payload = {
        "version": "3.2.4",
        "source": "Artificial Analysis Data API v2",
        "api": API_URL,
        "fetched": datetime.now(timezone.utc).date().isoformat(),
        "methodology": METHODOLOGY_URL,
        "note": "Anthropic excluded: Claude subscriptions no longer cover third-party tools as of April 4, 2026. Google excluded: CLI OAuth with third-party tools declared ToS violation as of March 25, 2026. This file is a creator-scoped benchmark reference snapshot, not the exact routeable allowlist. Sources: https://x.com/bcherny/status/2040206440556826908",
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
    output_path.write_text(json.dumps(payload, indent=args.pretty, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
