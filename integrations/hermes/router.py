"""Pure-Python ZeroAPI route resolver for Hermes Agent.

The OpenClaw plugin remains the primary runtime implementation. Hermes plugins
are Python, so this adapter mirrors the hot-path policy without calling Node,
LLMs, or external APIs on every message.
"""

from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path
from typing import Any

TaskCategory = str
Config = dict[str, Any]

VISION_KEYWORDS = [
    "image",
    "screenshot",
    "ss",
    "photo",
    "picture",
    "foto",
    "fotoğraf",
    "fotoğrafı",
    "fotoğrafta",
    "fotoğrafa",
    "fotograf",
    "fotografi",
    "fotografta",
    "fotografa",
    "resim",
    "resmi",
    "resimde",
    "resme",
    "diagram",
    "chart",
    "graph",
    "visual",
    "vision",
    "görsel",
    "görseli",
    "görselde",
    "görsele",
    "gorsel",
    "gorseli",
    "gorselde",
    "gorsele",
    "ekran",
    "ekran görüntüsü",
    "ekran görüntüsünü",
    "ekran görüntüsünde",
    "ekran goruntusu",
    "ekran goruntusunu",
    "ekran goruntusunde",
    "logo",
    "icon",
    "ui",
    "mockup",
    "design",
    "tasarım",
    "tasarim",
]

CONTINUATION_KEYWORDS = [
    "continue",
    "keep going",
    "go on",
    "next",
    "proceed",
    "resume",
    "continue working",
    "devam",
    "devam et",
    "devam et kral",
    "devam et canım",
    "sürdür",
    "surdur",
    "ilerle",
    "başla",
    "basla",
    "yap",
    "hallet",
    "go",
    "go go",
    "tamam",
    "tamamdır",
    "evet",
    "olur",
    "kabul",
    "wp",
]

CONTINUATION_ROUTE_CATEGORIES = ["code", "research", "math"]

PROVIDER_CATALOG: dict[str, dict[str, Any]] = {
    "openai-codex": {
        "canonical": "openai-codex",
        "aliases": ["openai"],
        "tier_weights": {"plus": 1, "pro": 3},
        "bias": 0.7,
    },
    "moonshot": {
        "canonical": "moonshot",
        "aliases": ["kimi", "kimi-coding"],
        "tier_weights": {"moderato": 1, "allegretto": 2, "allegro": 3, "vivace": 4},
        "bias": 1.1,
    },
    "zai": {
        "canonical": "zai",
        "aliases": ["z-ai"],
        "tier_weights": {"lite": 1, "pro": 2, "max": 4},
        "bias": 1.25,
    },
    "minimax-portal": {
        "canonical": "minimax-portal",
        "aliases": ["minimax"],
        "tier_weights": {"starter": 1, "plus": 2, "max": 3, "ultra_hs": 4},
        "bias": 1.0,
    },
    "qwen-portal": {
        "canonical": "qwen-portal",
        "aliases": ["qwen", "qwen-dashscope", "alibaba"],
        "tier_weights": {"free": 1},
        "bias": 0.95,
    },
}

HERMES_PROVIDER_MAP = {
    "openai-codex": "openai-codex",
    "moonshot": "kimi-for-coding",
    "kimi": "kimi-for-coding",
    "kimi-coding": "kimi-for-coding",
    "zai": "zai",
    "minimax-portal": "minimax-oauth",
    "minimax": "minimax-oauth",
    "qwen-portal": "qwen-oauth",
    "qwen": "qwen-oauth",
    "qwen-dashscope": "alibaba-coding-plan",
}

DEFAULT_RISK_LEVELS: dict[str, str] = {
    "code": "medium",
    "research": "low",
    "orchestration": "medium",
    "math": "low",
    "fast": "low",
    "default": "low",
}


def load_config(path: str | None = None) -> Config | None:
    config_path = path or os.getenv("ZEROAPI_CONFIG_PATH")
    if not config_path:
        hermes_home = Path(os.getenv("HERMES_HOME", Path.home() / ".hermes"))
        candidates = [
            hermes_home / "zeroapi-config.json",
            Path.home() / ".openclaw" / "zeroapi-config.json",
        ]
    else:
        candidates = [Path(config_path)]

    for candidate in candidates:
        try:
            if candidate.exists():
                parsed = json.loads(candidate.read_text(encoding="utf-8"))
                if _valid_config(parsed):
                    return parsed
        except (OSError, json.JSONDecodeError):
            continue
    return None


def _valid_config(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("version"), str)
        and isinstance(value.get("default_model"), str)
        and isinstance(value.get("models"), dict)
        and isinstance(value.get("routing_rules"), dict)
        and isinstance(value.get("keywords"), dict)
        and isinstance(value.get("high_risk_keywords"), list)
    )


def _provider_id(model_key: str) -> str:
    return model_key.split("/", 1)[0] if "/" in model_key else ""


def _model_id(model_key: str) -> str:
    return model_key.split("/", 1)[1] if "/" in model_key else model_key


def _canonical_provider(provider: str) -> str:
    for canonical, entry in PROVIDER_CATALOG.items():
        if provider == canonical or provider in entry.get("aliases", []):
            return canonical
    return provider


def _disabled_providers(config: Config) -> set[str]:
    disabled: set[str] = set()
    configured = config.get("disabled_providers")
    if isinstance(configured, list):
        for provider in configured:
            if isinstance(provider, str) and provider.strip():
                disabled.add(_canonical_provider(provider.strip()))

    env_value = os.getenv("ZEROAPI_DISABLED_PROVIDERS", "")
    for provider in env_value.split(","):
        if provider.strip():
            disabled.add(_canonical_provider(provider.strip()))

    return disabled


def _provider_disabled(config: Config, provider: str) -> bool:
    return _canonical_provider(provider) in _disabled_providers(config)


def _hermes_provider(provider: str, config: Config) -> str:
    aliases = config.get("hermes_provider_map")
    if isinstance(aliases, dict):
        mapped = aliases.get(provider)
        if isinstance(mapped, str) and mapped.strip():
            return mapped.strip()
    return HERMES_PROVIDER_MAP.get(provider, provider)


def _estimate_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / 4))


def _keyword_regex(keyword: str) -> re.Pattern[str]:
    return re.compile(rf"(?<!\w){re.escape(keyword.lower())}(?!\w)")


def _has_keyword(text: str, keywords: list[Any]) -> bool:
    lower = text.lower()
    return any(isinstance(keyword, str) and _keyword_regex(keyword).search(lower) for keyword in keywords)


def _message_content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(_message_content_to_text(part) for part in content)
    if isinstance(content, dict):
        for key in ("text", "content", "output"):
            value = content.get(key)
            if isinstance(value, str):
                return value
        try:
            return json.dumps(content, ensure_ascii=False)
        except TypeError:
            return ""
    return "" if content is None else str(content)


def _is_continuation_prompt(config: Config, prompt: str) -> bool:
    compact = re.sub(r"[.!?…\\s]+$", "", prompt.lower().strip())
    if not compact:
        return False
    configured = config.get("continuation_keywords", CONTINUATION_KEYWORDS)
    keywords = configured if isinstance(configured, list) else CONTINUATION_KEYWORDS
    normalized = [kw.lower() for kw in keywords if isinstance(kw, str)]
    if compact in normalized:
        return True
    if len(compact) > 80:
        return False
    return any(_keyword_regex(keyword).search(compact) for keyword in normalized)


def _continuation_categories(config: Config) -> list[str]:
    configured = config.get("continuation_route_categories")
    if not isinstance(configured, list) or not configured:
        return CONTINUATION_ROUTE_CATEGORIES
    return [category for category in configured if isinstance(category, str)]


def _history_continuation_category(
    config: Config,
    conversation_history: list[Any] | None,
    allowed: list[str],
) -> tuple[str, str] | None:
    if not conversation_history:
        return None

    recent_parts: list[str] = []
    for message in conversation_history[-12:]:
        if isinstance(message, dict):
            recent_parts.append(_message_content_to_text(message.get("content")))
        else:
            recent_parts.append(_message_content_to_text(message))
    recent = "\n".join(part for part in recent_parts if part.strip())
    if not recent.strip():
        return None

    category, reason, risk = _classify(config, recent)
    if category != "default" and risk != "high" and category in allowed:
        return category, f"history:{reason}"
    return None


def _resolve_continuation_category(
    config: Config,
    prompt: str,
    conversation_history: list[Any] | None,
    previous_category: str | None,
) -> tuple[str, str] | None:
    if not _is_continuation_prompt(config, prompt):
        return None
    allowed = _continuation_categories(config)
    if previous_category in allowed:
        return previous_category, "state:last_strong_category"
    return _history_continuation_category(config, conversation_history, allowed)


def _classify(config: Config, prompt: str, workspace_hints: list[Any] | None = None) -> tuple[TaskCategory, str, str]:
    lower = prompt.lower().strip()
    if not lower:
        return "default", "empty_prompt", "low"

    matched_high_risk = ""
    for keyword in config.get("high_risk_keywords", []):
        if isinstance(keyword, str) and _keyword_regex(keyword).search(lower):
            matched_high_risk = keyword
            break

    best_category = "default"
    best_reason = "no_match"
    best_score = 0
    keywords = config.get("keywords", {})
    if isinstance(keywords, dict):
        for category, values in keywords.items():
            if not isinstance(category, str) or not isinstance(values, list):
                continue
            score = 0
            first = ""
            for keyword in values:
                if not isinstance(keyword, str):
                    continue
                matches = _keyword_regex(keyword).findall(lower)
                if matches:
                    score += len(matches)
                    first = first or keyword
            if score > best_score:
                best_category = category
                best_reason = f"keyword:{first}" if first else "no_match"
                best_score = score

    if best_score == 0 and workspace_hints and len(workspace_hints) == 1 and not matched_high_risk:
        hint = workspace_hints[0]
        if isinstance(hint, str) and hint:
            best_category = hint
            best_reason = f"workspace_hint:{hint}"

    risk_levels = {**DEFAULT_RISK_LEVELS}
    configured_risk_levels = config.get("risk_levels")
    if isinstance(configured_risk_levels, dict):
        for category, level in configured_risk_levels.items():
            if isinstance(category, str) and level in {"low", "medium", "high"}:
                risk_levels[category] = level

    risk = "high" if matched_high_risk else risk_levels.get(best_category, "low")
    if matched_high_risk:
        best_reason = f"{best_reason}:high_risk_keyword:{matched_high_risk}"

    return best_category, best_reason, risk


def _normalize_benchmark(value: Any) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    if value < 0:
        return None
    if value > 1:
        return float(value) / 100
    return float(value)


def _weighted_blend(entries: list[tuple[float | None, float]]) -> float:
    total = 0.0
    weight_sum = 0.0
    for value, weight in entries:
        if value is None:
            continue
        total += value * weight
        weight_sum += weight
    return total / weight_sum if weight_sum else 0.0


def _benchmark_strength(category: TaskCategory, caps: Config, modifier: str | None) -> float:
    benchmarks = caps.get("benchmarks", {})
    if not isinstance(benchmarks, dict):
        benchmarks = {}

    def metric(name: str) -> float | None:
        return _normalize_benchmark(benchmarks.get(name))

    intelligence = metric("intelligence")
    coding = metric("coding")
    terminalbench = metric("terminalbench")
    scicode = metric("scicode")
    gpqa = metric("gpqa")
    hle = metric("hle")
    lcr = metric("lcr")
    tau2 = metric("tau2")
    ifbench = metric("ifbench")
    math_score = metric("math")
    aime25 = metric("aime_25")

    if category == "code":
        if modifier == "coding-aware":
            return _weighted_blend([(terminalbench, 1.0), (scicode, 0.2), (coding, 0.55), (intelligence, 0.05)])
        return _weighted_blend([(terminalbench, 0.85), (scicode, 0.15), (coding, 0.35), (intelligence, 0.1)])
    if category == "research":
        if modifier == "research-aware":
            return _weighted_blend([(gpqa, 0.75), (hle, 0.35), (lcr, 0.25), (intelligence, 0.05)])
        return _weighted_blend([(gpqa, 0.6), (hle, 0.25), (lcr, 0.15), (intelligence, 0.1)])
    if category == "orchestration":
        return _weighted_blend([(tau2, 0.6), (ifbench, 0.4), (intelligence, 0.1)])
    if category == "math":
        return _weighted_blend([(math_score, 0.7), (aime25, 0.3), (intelligence, 0.1)])
    if category == "fast":
        speed = caps.get("speed_tps")
        ttft = caps.get("ttft_seconds")
        if not isinstance(speed, (int, float)) or not isinstance(ttft, (int, float)):
            return 0.0
        return math.log1p(max(float(speed), 0.0)) / max(float(ttft), 0.25)
    return _weighted_blend([(intelligence, 0.7), (coding, 0.2), (gpqa, 0.1)])


def _tier_weight(provider: str, tier: Any) -> float:
    entry = PROVIDER_CATALOG.get(_canonical_provider(provider))
    if not entry or not isinstance(tier, str):
        return 1.0
    return float(entry.get("tier_weights", {}).get(tier, 1))


def _provider_bias(provider: str) -> float:
    entry = PROVIDER_CATALOG.get(_canonical_provider(provider))
    return float(entry.get("bias", 1.0)) if entry else 1.0


def _usage_priority_factor(priority: Any) -> float:
    if not isinstance(priority, (int, float)):
        return 1.0
    bounded = min(3, max(0, float(priority)))
    return 0.8 + (0.2 * bounded)


def _capacity(config: Config, provider: str, category: TaskCategory, agent_id: str | None = None) -> tuple[bool, float]:
    canonical = _canonical_provider(provider)
    if _provider_disabled(config, provider):
        return False, 0.0

    inventory = config.get("subscription_inventory", {})
    accounts = inventory.get("accounts", {}) if isinstance(inventory, dict) else {}
    all_accounts: list[tuple[float, list[Any]]] = []

    if isinstance(accounts, dict):
        for account in accounts.values():
            if not isinstance(account, dict) or account.get("enabled") is False:
                continue
            if _canonical_provider(str(account.get("provider", ""))) != canonical:
                continue
            intended = account.get("intendedUse")
            all_accounts.append(
                (
                    _tier_weight(provider, account.get("tierId")) * _usage_priority_factor(account.get("usagePriority")),
                    intended if isinstance(intended, list) else [],
                )
            )

    if all_accounts:
        matched_accounts = [
            weight
            for weight, intended in all_accounts
            if not intended or category in intended
        ]
        scoring_accounts = matched_accounts or [weight for weight, _ in all_accounts]
        redundancy_bonus = min(1.0, 0.25 * max(0, len(scoring_accounts) - 1))
        return True, max(scoring_accounts) + redundancy_bonus

    entry = _profile_selection(config, provider, agent_id)
    if isinstance(entry, dict):
        if entry.get("enabled") is False:
            return False, 0.0
        return True, _tier_weight(provider, entry.get("tierId"))

    return True, 1.0


def _profile_selection(config: Config, provider: str, agent_id: str | None) -> dict[str, Any] | None:
    profile = config.get("subscription_profile", {})
    if not isinstance(profile, dict):
        return None

    canonical = _canonical_provider(provider)

    def find_selection(selections: Any) -> dict[str, Any] | None:
        if not isinstance(selections, dict):
            return None
        for key in {provider, canonical, *PROVIDER_CATALOG.get(canonical, {}).get("aliases", [])}:
            value = selections.get(key)
            if isinstance(value, dict):
                return value
        return None

    agent_overrides = profile.get("agentOverrides")
    override = None
    if agent_id and isinstance(agent_overrides, dict):
        override = find_selection(agent_overrides.get(agent_id))
    global_selection = find_selection(profile.get("global"))
    if override is None:
        return global_selection
    merged = dict(global_selection or {})
    merged.update(override)
    return merged


def _allowed_by_subscriptions(config: Config, model_key: str, agent_id: str | None) -> bool:
    provider = _provider_id(model_key)
    canonical = _canonical_provider(provider)
    if _provider_disabled(config, provider):
        return False

    inventory = config.get("subscription_inventory", {})
    accounts = inventory.get("accounts", {}) if isinstance(inventory, dict) else {}
    inventory_configured = False

    if isinstance(accounts, dict):
        for account in accounts.values():
            if isinstance(account, dict) and _canonical_provider(str(account.get("provider", ""))) == canonical:
                inventory_configured = True
                if account.get("enabled") is not False:
                    return True
        if inventory_configured:
            return False

    selection = _profile_selection(config, provider, agent_id)
    if selection is None:
        return True
    return selection.get("enabled") is not False


def _allowed_drop(tier_weight: float, provider_bias: float, category: TaskCategory, modifier: str | None) -> float:
    base = min(0.16, 0.05 + (max(0.0, tier_weight - 1) * 0.018) + (max(0.0, provider_bias - 1) * 0.07))
    if modifier == "coding-aware" and category == "code":
        return max(0.03, base - 0.025)
    if modifier == "research-aware" and category == "research":
        return max(0.03, base - 0.025)
    if modifier == "speed-aware" and category == "default":
        return min(0.2, base + 0.06)
    if modifier == "speed-aware" and category == "fast":
        return min(0.18, base + 0.015)
    if category == "default":
        return min(0.18, base + 0.04)
    return base


def _rank_candidate_pool(
    config: Config,
    candidates: list[str],
    models: Config,
    category: TaskCategory,
    modifier: str | None,
    agent_id: str | None,
) -> list[str]:
    ranked: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates):
        caps = models.get(candidate)
        if not isinstance(caps, dict):
            continue
        provider = _provider_id(candidate)
        enabled, tier_weight = _capacity(config, provider, category, agent_id)
        if not enabled or tier_weight <= 0:
            continue

        bias = _provider_bias(provider)
        ranked.append(
            {
                "model_key": candidate,
                "index": index,
                "provider": provider,
                "tier_weight": tier_weight,
                "provider_bias": bias,
                "pressure": tier_weight * bias,
                "speed_priority": 0.0 if not isinstance(caps.get("ttft_seconds"), (int, float)) else 1 / max(float(caps["ttft_seconds"]), 0.25),
                "strength": _benchmark_strength(category, caps, modifier),
            }
        )

    if not ranked:
        return []

    strongest = max(item["strength"] for item in ranked)
    for item in ranked:
        allowed = _allowed_drop(item["tier_weight"], item["provider_bias"], category, modifier)
        item["within_frontier"] = item["index"] == 0 if strongest <= 0 else item["strength"] >= strongest * (1 - allowed)

    if modifier in {"coding-aware", "research-aware"} and category in {"code", "research"}:
        ranked.sort(
            key=lambda item: (
                0 if item["within_frontier"] else 1,
                -item["strength"],
                -item["pressure"] if item["within_frontier"] else item["index"],
                item["index"],
            )
        )
    elif modifier == "speed-aware" and category in {"fast", "default"}:
        ranked.sort(
            key=lambda item: (
                0 if item["within_frontier"] else 1,
                -item["speed_priority"] if item["within_frontier"] else -item["strength"],
                -item["pressure"] if item["within_frontier"] else item["index"],
                -item["strength"] if item["within_frontier"] else 0,
                item["index"],
            )
        )
    else:
        ranked.sort(
            key=lambda item: (
                0 if item["within_frontier"] else 1,
                -item["pressure"] if item["within_frontier"] else -item["strength"],
                -item["strength"] if item["within_frontier"] else item["index"],
                item["index"],
            )
        )

    return [item["model_key"] for item in ranked]


class ZeroAPIRouter:
    def __init__(self, config: Config):
        self.config = config

    def resolve(
        self,
        prompt: str,
        current_model: str | None = None,
        platform: str | None = None,
        agent_id: str | None = None,
        trigger: str | None = None,
        has_image_attachment: bool = False,
        conversation_history: list[Any] | None = None,
        previous_category: str | None = None,
    ) -> dict[str, str] | None:
        configured_workspace_hints = self.config.get("workspace_hints", {})
        workspace_hints_by_agent = configured_workspace_hints if isinstance(configured_workspace_hints, dict) else {}
        workspace_hints = None
        if agent_id and isinstance(workspace_hints_by_agent, dict):
            workspace_hints = workspace_hints_by_agent.get(agent_id)

        if agent_id and workspace_hints is None and agent_id in workspace_hints_by_agent:
            return None

        if agent_id and workspace_hints is None and current_model and current_model != self.config.get("default_model"):
            return None

        if trigger in {"cron", "heartbeat"}:
            return None

        category, reason, risk = _classify(
            self.config,
            prompt,
            workspace_hints if isinstance(workspace_hints, list) else None,
        )

        # Detect vision signals early — needed for capability escape even when
        # the classifier falls back to "default" (e.g. short screenshot captions).
        likely_vision = _has_keyword(prompt, self.config.get("vision_keywords", VISION_KEYWORDS)) or has_image_attachment

        if risk == "high":
            return None

        if category == "default":
            continuation = _resolve_continuation_category(
                self.config,
                prompt,
                conversation_history,
                previous_category,
            )
            if continuation is not None:
                category, continuation_reason = continuation
                reason = f"continuation:{continuation_reason}"
                risk = "medium" if category == "code" else "low"

        # Vision capability escape: when vision is required (detected via keywords
        # or image attachment) but the current model does not support vision,
        # override the default-category stay and route to a vision-capable model.
        current = current_model or self.config.get("default_model")
        models = self.config.get("models", {})
        modifier = self.config.get("routing_modifier")
        modifier = modifier if isinstance(modifier, str) else None

        if category == "default" and likely_vision and current:
            current_caps = models.get(current)
            if isinstance(current_caps, dict) and not current_caps.get("supports_vision", False):
                vision_capable = []
                for model_key, caps in models.items():
                    if not isinstance(caps, dict) or not caps.get("supports_vision", False):
                        continue
                    if not _allowed_by_subscriptions(self.config, model_key, agent_id):
                        continue
                    vision_capable.append(model_key)

                if vision_capable:
                    ordered = _rank_candidate_pool(self.config, vision_capable, models, "default", modifier, agent_id)
                    if not ordered:
                        ordered = vision_capable
                    target = ordered[0] if ordered else vision_capable[0]
                    if target != current:
                        provider = _provider_id(target)
                        return {
                            "provider": _hermes_provider(provider, self.config),
                            "model": _model_id(target),
                            "reason": "zeroapi:default:vision_capability_escape",
                            "category": "default",
                        }

        if risk == "high" or category == "default":
            return None
        if (
            isinstance(current, str)
            and current
            and current not in models
            and self.config.get("external_model_policy", "stay") != "allow"
        ):
            return None

        rule = self.config.get("routing_rules", {}).get(category)
        if not isinstance(rule, dict):
            return None

        candidates = [rule.get("primary"), *rule.get("fallbacks", [])]
        token_estimate = _estimate_tokens(prompt)
        # likely_vision already computed above (includes has_image_attachment)

        ranked: list[dict[str, Any]] = []
        for index, candidate in enumerate(candidates):
            if not isinstance(candidate, str) or candidate not in models:
                continue
            if not _allowed_by_subscriptions(self.config, candidate, agent_id):
                continue
            caps = models[candidate]
            if not isinstance(caps, dict):
                continue
            if isinstance(caps.get("context_window"), (int, float)) and token_estimate > int(caps["context_window"]):
                continue
            if likely_vision and caps.get("supports_vision") is False:
                continue
            if category == "fast":
                max_ttft = self.config.get("fast_ttft_max_seconds")
                ttft = caps.get("ttft_seconds")
                if isinstance(max_ttft, (int, float)) and isinstance(ttft, (int, float)) and ttft > max_ttft:
                    continue

            provider = _provider_id(candidate)
            enabled, tier_weight = _capacity(self.config, provider, category, agent_id)
            if not enabled or tier_weight <= 0:
                continue

            bias = _provider_bias(provider)
            ranked.append(
                {
                    "model_key": candidate,
                    "index": index,
                    "provider": provider,
                    "tier_weight": tier_weight,
                    "provider_bias": bias,
                    "pressure": tier_weight * bias,
                    "speed_priority": 0.0 if not isinstance(caps.get("ttft_seconds"), (int, float)) else 1 / max(float(caps["ttft_seconds"]), 0.25),
                    "strength": _benchmark_strength(category, caps, modifier),
                }
            )

        if not ranked:
            return None

        strongest = max(item["strength"] for item in ranked)
        for item in ranked:
            allowed = _allowed_drop(item["tier_weight"], item["provider_bias"], category, modifier)
            item["within_frontier"] = item["index"] == 0 if strongest <= 0 else item["strength"] >= strongest * (1 - allowed)

        if modifier in {"coding-aware", "research-aware"} and category in {"code", "research"}:
            ranked.sort(
                key=lambda item: (
                    0 if item["within_frontier"] else 1,
                    -item["strength"],
                    -item["pressure"] if item["within_frontier"] else item["index"],
                    item["index"],
                )
            )
        elif modifier == "speed-aware" and category in {"fast", "default"}:
            ranked.sort(
                key=lambda item: (
                    0 if item["within_frontier"] else 1,
                    -item["speed_priority"] if item["within_frontier"] else -item["strength"],
                    -item["pressure"] if item["within_frontier"] else item["index"],
                    -item["strength"] if item["within_frontier"] else 0,
                    item["index"],
                )
            )
        else:
            ranked.sort(
                key=lambda item: (
                    0 if item["within_frontier"] else 1,
                    -item["pressure"] if item["within_frontier"] else -item["strength"],
                    -item["strength"] if item["within_frontier"] else item["index"],
                    item["index"],
                )
            )

        selected = ranked[0]["model_key"]
        if selected == current:
            return None

        provider = _provider_id(selected)
        return {
            "provider": _hermes_provider(provider, self.config),
            "model": _model_id(selected),
            "reason": f"zeroapi:{category}:{reason}",
            "category": category,
        }
