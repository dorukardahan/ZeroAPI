"""Pure-Python ZeroAPI route resolver for Hermes Agent.

The OpenClaw plugin remains the primary runtime implementation. Hermes plugins
are Python, so this adapter mirrors the hot-path policy without calling Node,
LLMs, or external APIs on every message.
"""

from __future__ import annotations

import copy
import functools
import json
import math
import os
import re
from pathlib import Path
from typing import Any

TaskCategory = str
Config = dict[str, Any]

ENGLISH_VISION_KEYWORDS = [
    "image",
    "screenshot",
    "ss",
    "photo",
    "picture",
    "diagram",
    "chart",
    "graph",
    "visual",
    "vision",
    "logo",
    "icon",
    "ui",
    "mockup",
    "design",
]

LOCALIZED_VISION_KEYWORDS = [
    # Turkish image and screenshot phrasing.
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
    "tasarım",
    "tasarim",
]

VISION_KEYWORDS = ENGLISH_VISION_KEYWORDS + LOCALIZED_VISION_KEYWORDS

ENGLISH_CONTINUATION_KEYWORDS = [
    "continue",
    "keep going",
    "go on",
    "next",
    "proceed",
    "resume",
    "continue working",
    "go",
    "go go",
]

LOCALIZED_CONTINUATION_KEYWORDS = [
    # Turkish continuation acknowledgements used in chat channels.
    "devam",
    "devam et",
    "sürdür",
    "surdur",
    "ilerle",
    "başla",
    "basla",
    "yap",
    "hallet",
    "tamam",
    "tamamdır",
    "evet",
    "olur",
    "kabul",
]

CONTINUATION_KEYWORDS = ENGLISH_CONTINUATION_KEYWORDS + LOCALIZED_CONTINUATION_KEYWORDS

ENGLISH_SAFE_CREDENTIAL_CONTEXT_PATTERNS = [
    r"\b(do not|don't|dont|never|without|avoid|redact|mask|hide|prevent|must not|should not|shouldn't)\b",
    r"\b(not print|not log|not commit|not expose|not leak|not show|not display|not use|redacted)\b",
]

LOCALIZED_SAFE_CREDENTIAL_CONTEXT_PATTERNS = [
    # Turkish defensive phrasing, for example "do not show/log/use/share/leak".
    r"\b(asla|sakın|sakin|gizle|redakte|maskele|gösterme|gosterme|yazdırma|yazdirma|loglama|kullanma|paylaşma|paylasma|sızdırma|sizdirma)\b",
    r"\bcommit etme\b",
    # Spanish defensive phrasing.
    r"\b(no mostrar|no imprimir|no registrar|no usar|no exponer|no filtrar|redactar)\b",
    # French defensive phrasing.
    r"\b(ne pas afficher|ne pas imprimer|ne pas journaliser|ne pas utiliser|ne pas exposer|masquer)\b",
    # German defensive phrasing.
    r"\b(nicht anzeigen|nicht drucken|nicht protokollieren|nicht verwenden|nicht offenlegen|maskieren)\b",
    # Chinese, Japanese, Korean, and Hindi defensive phrasing.
    r"不要(显示|打印|记录|使用|提交|泄露)|请勿(显示|打印|记录|使用|提交|泄露)|脱敏|打码|隐藏",
    r"(表示|出力|記録|使用|コミット|漏洩|漏ら)しない|ログしない|マスク",
    r"(표시|출력|기록|사용|커밋|유출)하지\s*말|가려|마스킹",
    r"(मत\s*(दिखाओ|छापो|लॉग|लिखो|उपयोग|कमिट)|छुपा|मास्क)",
]

SAFE_CREDENTIAL_CONTEXT_PATTERNS = [
    *ENGLISH_SAFE_CREDENTIAL_CONTEXT_PATTERNS,
    *LOCALIZED_SAFE_CREDENTIAL_CONTEXT_PATTERNS,
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
    "qwen-oauth": {
        "canonical": "qwen-oauth",
        "aliases": ["qwen-portal", "qwen-cli"],
        "tier_weights": {"free": 1},
        "bias": 0.95,
    },
    "xai-oauth": {
        "canonical": "xai-oauth",
        # "xai" must be an alias: TS subscriptions.ts keys this provider as openclawProviderId
        # "xai", so bare "xai/<model>" keys must resolve into this catalog entry (and thus be
        # subscription-gated), not fall through as an external-passthrough provider.
        "aliases": ["xai", "grok-oauth", "x-ai-oauth", "xai-grok-oauth", "supergrok"],
        "tier_weights": {"supergrok": 2},
        "bias": 0.85,
    },
}

HERMES_PROVIDER_MAP = {
    "openai": "openai-codex",
    "openai-codex": "openai-codex",
    "moonshot": "kimi-for-coding",
    "kimi": "kimi-for-coding",
    "kimi-coding": "kimi-for-coding",
    "zai": "zai",
    "minimax-portal": "minimax-oauth",
    "minimax": "minimax-oauth",
    "qwen-oauth": "qwen-oauth",
    "qwen-portal": "qwen-oauth",
    "qwen-cli": "qwen-oauth",
    "qwen": "alibaba-coding-plan",
    "qwen-dashscope": "alibaba-coding-plan",
    "xai-oauth": "xai-oauth",
    "grok-oauth": "xai-oauth",
    "x-ai-oauth": "xai-oauth",
    "xai-grok-oauth": "xai-oauth",
    "supergrok": "xai-oauth",
}

LEGACY_QWEN_PORTAL_IDS = {"qwen", "qwen-dashscope", "qwen-portal", "qwen-cli"}


def _catalog_version(config: Config) -> str | None:
    profile = config.get("subscription_profile")
    inventory = config.get("subscription_inventory")
    for candidate in (
        config.get("subscription_catalog_version"),
        profile.get("version") if isinstance(profile, dict) else None,
        inventory.get("version") if isinstance(inventory, dict) else None,
    ):
        if candidate is not None:
            # Match TypeScript's nullish precedence exactly: a malformed non-null
            # candidate wins this selection but cannot identify a legacy catalog.
            # In particular, do not fall through to a lower-priority valid string.
            return candidate if isinstance(candidate, str) else None
    return None


def _legacy_provider(provider: str, version: str | None) -> str:
    if isinstance(version, str) and re.match(r"^1\.0(?:\.|$)", version) and provider.strip().lower() in LEGACY_QWEN_PORTAL_IDS:
        return "qwen-oauth"
    return provider


def _remap_selections(selections: dict[str, Any], version: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for provider, selection in selections.items():
        canonical = _legacy_provider(provider, version)
        if canonical not in result or provider == canonical:
            result[canonical] = selection
    return result


def _migrate_legacy_config(config: Config) -> Config:
    version = _catalog_version(config)
    if not isinstance(version, str) or not re.match(r"^1\.0(?:\.|$)", version):
        return config
    migrated = copy.deepcopy(config)

    def model_ref(value: str) -> str:
        if not isinstance(value, str):
            raise TypeError("legacy model references must be strings")
        if "/" not in value:
            return value
        provider, model = value.split("/", 1)
        return f"{_legacy_provider(provider, version)}/{model}"

    migrated["default_model"] = model_ref(migrated["default_model"])
    migrated["models"] = {model_ref(key): value for key, value in migrated["models"].items()}
    for rule in migrated["routing_rules"].values():
        if not isinstance(rule, dict):
            raise TypeError("legacy routing rules must be objects")
        fallbacks = rule.get("fallbacks", [])
        if not isinstance(fallbacks, list):
            raise TypeError("legacy routing rule fallbacks must be arrays")
        rule["primary"] = model_ref(rule.get("primary", ""))
        rule["fallbacks"] = [model_ref(item) for item in fallbacks]
    profile = migrated.get("subscription_profile")
    if isinstance(profile, dict):
        values = profile.get("global")
        if isinstance(values, dict):
            profile["global"] = _remap_selections(values, version)
        overrides = profile.get("agentOverrides")
        if isinstance(overrides, dict):
            for agent_id, values in overrides.items():
                if isinstance(values, dict):
                    overrides[agent_id] = _remap_selections(values, version)
    inventory = migrated.get("subscription_inventory")
    if isinstance(inventory, dict):
        accounts = inventory.get("accounts")
        if isinstance(accounts, dict):
            for account in accounts.values():
                if isinstance(account, dict) and isinstance(account.get("provider"), str):
                    account["provider"] = _legacy_provider(account["provider"], version)
    disabled = migrated.get("disabled_providers")
    if isinstance(disabled, list):
        migrated_disabled: list[str] = []
        seen_disabled: set[str] = set()
        for provider in disabled:
            if not isinstance(provider, str) or not provider.strip():
                continue
            canonical = _canonical_provider(_legacy_provider(provider, version).strip().lower())
            if canonical not in seen_disabled:
                seen_disabled.add(canonical)
                migrated_disabled.append(canonical)
        migrated["disabled_providers"] = migrated_disabled
    return migrated

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
            if not candidate.exists():
                continue
            parsed = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if _valid_config(parsed):
            return _migrate_legacy_config(parsed)
    return None


def _valid_routing_rules(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    for rule in value.values():
        if not isinstance(rule, dict):
            return False
        fallbacks = rule.get("fallbacks")
        if not isinstance(rule.get("primary"), str) or not isinstance(fallbacks, list):
            return False
        if not all(isinstance(model_ref, str) for model_ref in fallbacks):
            return False
    return True


def _valid_models(value: Any) -> bool:
    return isinstance(value, dict) and all(
        isinstance(capabilities, dict) for capabilities in value.values()
    )


def _valid_subscription_profile(value: Any) -> bool:
    if not isinstance(value, dict) or "global" not in value:
        return False
    selections = value["global"]
    if not isinstance(selections, dict) or not all(
        isinstance(selection, dict) for selection in selections.values()
    ):
        return False
    if "agentOverrides" not in value:
        return True
    overrides = value["agentOverrides"]
    return isinstance(overrides, dict) and all(
        isinstance(agent_selections, dict) and all(
            isinstance(selection, dict) for selection in agent_selections.values()
        )
        for agent_selections in overrides.values()
    )


def _valid_subscription_inventory(value: Any) -> bool:
    if not isinstance(value, dict) or "accounts" not in value:
        return False
    accounts = value["accounts"]
    if not isinstance(accounts, dict):
        return False
    return all(
        isinstance(account, dict) and isinstance(account.get("provider"), str)
        for account in accounts.values()
    )


def _valid_optional_string_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _valid_config(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    return (
        isinstance(value.get("version"), str)
        and isinstance(value.get("default_model"), str)
        and _valid_models(value.get("models"))
        and _valid_routing_rules(value.get("routing_rules"))
        and isinstance(value.get("keywords"), dict)
        and isinstance(value.get("high_risk_keywords"), list)
        and (
            "subscription_profile" not in value
            or _valid_subscription_profile(value["subscription_profile"])
        )
        and (
            "subscription_inventory" not in value
            or _valid_subscription_inventory(value["subscription_inventory"])
        )
        and (
            "disabled_providers" not in value
            or _valid_optional_string_list(value["disabled_providers"])
        )
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


def _comparison_model_ref(model_ref: str) -> str:
    """Canonicalize provider aliases only for ephemeral model identity checks."""
    if "/" not in model_ref:
        return model_ref
    provider, model = model_ref.split("/", 1)
    return f"{_canonical_provider(provider)}/{model}"


def _disabled_provider_list(config: Config) -> list[str]:
    disabled: list[str] = []
    seen: set[str] = set()
    version = _catalog_version(config)
    configured = config.get("disabled_providers")
    if isinstance(configured, list):
        for provider in configured:
            if isinstance(provider, str) and provider.strip():
                canonical = _canonical_provider(_legacy_provider(provider, version).strip().lower())
                if canonical not in seen:
                    seen.add(canonical)
                    disabled.append(canonical)

    env_value = os.getenv("ZEROAPI_DISABLED_PROVIDERS", "")
    for provider in env_value.split(","):
        if provider.strip():
            canonical = _canonical_provider(_legacy_provider(provider, version).strip().lower())
            if canonical not in seen:
                seen.add(canonical)
                disabled.append(canonical)

    return disabled


def _disabled_providers(config: Config) -> set[str]:
    return set(_disabled_provider_list(config))


def _provider_disabled(config: Config, provider: str) -> bool:
    return _canonical_provider(provider) in _disabled_providers(config)


def _hermes_provider(provider: str, config: Config) -> str:
    provider = _legacy_provider(provider, _catalog_version(config))
    aliases = config.get("hermes_provider_map")
    if isinstance(aliases, dict):
        for candidate in (provider, _canonical_provider(provider)):
            mapped = aliases.get(candidate)
            if isinstance(mapped, str) and mapped.strip():
                return mapped.strip()
    canonical = _canonical_provider(provider)
    return HERMES_PROVIDER_MAP.get(provider) or HERMES_PROVIDER_MAP.get(canonical, provider)


def _estimate_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / 4))


@functools.lru_cache(maxsize=2048)
def _keyword_regex(keyword: str) -> re.Pattern[str]:
    # Memoize compiled patterns: keyword scans run on every eligible turn, and re.Pattern
    # objects are stateless for search/findall/finditer, so caching is behavior-preserving.
    return re.compile(rf"(?<!\w){re.escape(keyword.lower())}(?!\w)")


SAFE_CREDENTIAL_RISK_KEYWORDS = {
    "credential",
    "credentials",
    "secret",
    "secrets",
    "password",
    "passwords",
}


def _is_credential_risk_keyword(keyword: str) -> bool:
    return keyword.lower() in SAFE_CREDENTIAL_RISK_KEYWORDS


def _has_safe_credential_handling_context(lower: str, index: int, keyword: str) -> bool:
    before = lower[max(0, index - 90):index]
    after = lower[index + len(keyword):index + len(keyword) + 140]
    around = f"{before} {after}"
    return any(re.search(pattern, around) for pattern in SAFE_CREDENTIAL_CONTEXT_PATTERNS)


def _matched_high_risk_keyword(lower: str, keywords: list[Any]) -> str:
    for keyword in keywords:
        if not isinstance(keyword, str):
            continue
        for match in _keyword_regex(keyword).finditer(lower):
            if _is_credential_risk_keyword(keyword) and _has_safe_credential_handling_context(lower, match.start(), keyword):
                continue
            return keyword
    return ""


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
    compact = re.sub(r"[.!?…\s]+$", "", prompt.lower().strip())
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
    if category != "default" and category in allowed:
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

    matched_high_risk = _matched_high_risk_keyword(lower, config.get("high_risk_keywords", []))

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

    if best_score == 0 and workspace_hints and len(workspace_hints) == 1:
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


MODIFIER_TARGET_CATEGORIES: dict[str, list[str]] = {
    "coding-aware": ["code"],
    "research-aware": ["research"],
    "speed-aware": ["fast", "default"],
}


def _is_modifier_relevant(modifier: str | None, category: TaskCategory) -> bool:
    return bool(modifier) and category in MODIFIER_TARGET_CATEGORIES.get(modifier or "", [])


def _catalog_entry(provider: str) -> dict[str, Any] | None:
    """Mirror subscriptions.ts getProviderCatalogEntry: resolve by canonical id or alias."""
    if not isinstance(provider, str):
        return None
    needle = provider.strip().lower()
    for canonical, entry in PROVIDER_CATALOG.items():
        if needle == canonical or needle in entry.get("aliases", []):
            return entry
    return None


def _resolve_provider_subscription(config: Config, provider: str, agent_id: str | None) -> dict[str, Any] | None:
    """Mirror profile.ts resolveProviderSubscription with FIELD-LEVEL (not merged)
    resolution. Returns None when the provider is not in the subscription catalog
    (external passthrough). ``enabled`` defaults to False unless explicitly enabled.

    tierId resolution mirrors profile.ts:70-73 exactly: when an agent override selection
    EXISTS for the provider, its tierId is authoritative (None if the override omits it,
    matching normalizeSelection forcing tierId:null); only when there is no override
    selection at all does tierId fall back to the global selection. A naive dict-merge
    (override over global) would wrongly inherit the global tierId for an override like
    {"enabled": true}, yielding a non-zero weight where TS yields 0."""
    entry = _catalog_entry(provider)
    if entry is None:
        return None

    profile = config.get("subscription_profile", {})
    profile = profile if isinstance(profile, dict) else {}
    canonical = _canonical_provider(provider)
    keys = {provider, canonical, *entry.get("aliases", [])}

    def find(selections: Any) -> dict[str, Any] | None:
        if not isinstance(selections, dict):
            return None
        for key in keys:
            value = selections.get(key)
            if isinstance(value, dict):
                return value
        return None

    global_sel = find(profile.get("global"))
    override_sel = None
    agent_overrides = profile.get("agentOverrides")
    if agent_id and isinstance(agent_overrides, dict):
        override_sel = find(agent_overrides.get(agent_id))

    ov_enabled = override_sel.get("enabled") if isinstance(override_sel, dict) else None
    gl_enabled = global_sel.get("enabled") if isinstance(global_sel, dict) else None
    enabled = (ov_enabled if ov_enabled is not None else gl_enabled) is True

    if override_sel is not None:
        tier_id = override_sel.get("tierId")
    else:
        tier_id = global_sel.get("tierId") if isinstance(global_sel, dict) else None

    weight = 0.0
    if enabled and isinstance(tier_id, str):
        tier_weights = entry.get("tier_weights", {})
        weight = float(tier_weights[tier_id]) if tier_id in tier_weights else 0.0
    return {"enabled": enabled, "routing_weight": weight, "preferred_account_id": None, "preferred_auth_profile": None}


def _resolve_inventory_capacity(provider: str, canonical: str, accounts: dict[str, Any], category: TaskCategory | None) -> dict[str, Any]:
    enabled_accounts: list[tuple[str, float, str | None, list[Any]]] = []
    for account_id, account in accounts.items():
        if not isinstance(account, dict) or account.get("enabled") is False:
            continue
        if _canonical_provider(str(account.get("provider", ""))) != canonical:
            continue
        intended = account.get("intendedUse")
        intended = intended if isinstance(intended, list) else []
        weight = _tier_weight(provider, account.get("tierId")) * _usage_priority_factor(account.get("usagePriority"))
        auth = account.get("authProfile")
        auth = auth.strip() if isinstance(auth, str) and auth.strip() else None
        enabled_accounts.append((str(account_id), weight, auth, intended))

    if not enabled_accounts:
        return {"enabled": False, "routing_weight": 0.0, "preferred_account_id": None, "preferred_auth_profile": None}

    if category:
        matched = [a for a in enabled_accounts if not a[3] or category in a[3]]
        scoring = matched or enabled_accounts
    else:
        scoring = enabled_accounts

    strongest = max(a[1] for a in scoring)
    redundancy = min(1.0, 0.25 * max(0, len(scoring) - 1))
    # Preferred account: highest weight, then lexicographically smallest accountId
    # (deterministic, matching inventory.ts:116-121).
    preferred = sorted(scoring, key=lambda a: (-a[1], a[0]))[0]
    return {
        "enabled": True,
        "routing_weight": strongest + redundancy,
        "preferred_account_id": preferred[0],
        "preferred_auth_profile": preferred[2],
    }


def _resolve_capacity(config: Config, provider: str, category: TaskCategory | None, agent_id: str | None) -> dict[str, Any] | None:
    """Unified capacity resolver mirroring inventory.ts resolveProviderCapacity. Returns
    None only when the provider is outside the subscription catalog and has no inventory
    (external passthrough); otherwise returns enabled/routing_weight/preferred account."""
    if _provider_disabled(config, provider):
        return {"enabled": False, "routing_weight": 0.0, "preferred_account_id": None, "preferred_auth_profile": None}

    # Inventory is subscription capacity, not an alternate provider catalog. Require
    # an active catalog entry before inspecting raw account provider strings.
    entry = _catalog_entry(provider)
    if entry is None:
        return None
    canonical = str(entry["canonical"])
    inventory = config.get("subscription_inventory", {})
    accounts = inventory.get("accounts", {}) if isinstance(inventory, dict) else {}
    inventory_configured = isinstance(accounts, dict) and any(
        isinstance(a, dict) and _canonical_provider(str(a.get("provider", ""))) == canonical
        for a in accounts.values()
    )
    if inventory_configured:
        return _resolve_inventory_capacity(provider, canonical, accounts, category)

    return _resolve_provider_subscription(config, provider, agent_id)


def _modifier_account_bonus(config: Config, modifier: str | None, category: TaskCategory, preferred_account_id: str | None) -> float:
    """Mirror router.ts getModifierAccountBonus: +0.15 when the preferred account's
    intendedUse matches the active modifier domain."""
    if not modifier or not preferred_account_id or not _is_modifier_relevant(modifier, category):
        return 0.0
    inventory = config.get("subscription_inventory", {})
    accounts = inventory.get("accounts", {}) if isinstance(inventory, dict) else {}
    account = accounts.get(preferred_account_id) if isinstance(accounts, dict) else None
    if not isinstance(account, dict):
        return 0.0
    intended = account.get("intendedUse") or []
    if modifier == "coding-aware" and "code" in intended:
        return 0.15
    if modifier == "research-aware" and "research" in intended:
        return 0.15
    if modifier == "speed-aware" and ("fast" in intended or "default" in intended):
        return 0.15
    return 0.0


def _allowed_by_subscriptions(config: Config, model_key: str, agent_id: str | None) -> bool:
    provider = _provider_id(model_key)
    if _provider_disabled(config, provider):
        return False
    resolved = _resolve_capacity(config, provider, None, agent_id)
    if resolved is None:
        # Unknown providers fail closed once a ZeroAPI subscription candidate pool exists.
        return not isinstance(config.get("subscription_profile"), dict) and not isinstance(config.get("subscription_inventory"), dict)
    return bool(resolved["enabled"])


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


def _sort_ranked(ranked: list[dict[str, Any]], modifier: str | None, category: TaskCategory) -> None:
    """Shared frontier sort used by both ranking call sites (parity with router.ts:271-323).
    In-frontier ordering uses effective pressure (raw pressure + modifier account bonus)."""
    # Exact (modifier, category) pairing — mirrors router.ts:277-308. A Cartesian guard
    # (modifier in {...} and category in {...}) would wrongly apply the strength-first sort
    # to cross-pairs like (coding-aware, research), where TS falls through to the default
    # pressure-first sort.
    if (modifier == "coding-aware" and category == "code") or (modifier == "research-aware" and category == "research"):
        ranked.sort(
            key=lambda item: (
                0 if item["within_frontier"] else 1,
                -item["strength"],
                -item["effective_pressure"] if item["within_frontier"] else item["index"],
                item["index"],
            )
        )
    elif modifier == "speed-aware" and category in {"fast", "default"}:
        ranked.sort(
            key=lambda item: (
                0 if item["within_frontier"] else 1,
                -item["speed_priority"] if item["within_frontier"] else -item["strength"],
                -item["effective_pressure"] if item["within_frontier"] else item["index"],
                -item["strength"] if item["within_frontier"] else 0,
                item["index"],
            )
        )
    else:
        ranked.sort(
            key=lambda item: (
                0 if item["within_frontier"] else 1,
                -item["effective_pressure"] if item["within_frontier"] else -item["strength"],
                -item["strength"] if item["within_frontier"] else item["index"],
                item["index"],
            )
        )


def _build_ranked_item(
    config: Config,
    candidate: str,
    index: int,
    caps: Config,
    category: TaskCategory,
    modifier: str | None,
    agent_id: str | None,
) -> dict[str, Any] | None:
    """Resolve capacity + benchmark strength for one candidate; None when ineligible
    (no positive routing weight). Shared by both ranking call sites so eligibility and
    scoring stay identical, mirroring router.ts:208-246."""
    provider = _provider_id(candidate)
    cap = _resolve_capacity(config, provider, category, agent_id)
    if cap is None or not cap.get("enabled") or float(cap.get("routing_weight", 0.0)) <= 0:
        return None
    tier_weight = float(cap["routing_weight"])
    bias = _provider_bias(provider)
    pressure = tier_weight * bias
    bonus = _modifier_account_bonus(config, modifier, category, cap.get("preferred_account_id"))
    ttft = caps.get("ttft_seconds")
    return {
        "model_key": candidate,
        "index": index,
        "provider": provider,
        "tier_weight": tier_weight,
        "provider_bias": bias,
        "pressure": pressure,
        "effective_pressure": pressure + bonus,
        "speed_priority": 0.0 if not isinstance(ttft, (int, float)) else 1 / max(float(ttft), 0.25),
        "strength": _benchmark_strength(category, caps, modifier),
    }


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
        item = _build_ranked_item(config, candidate, index, caps, category, modifier, agent_id)
        if item is not None:
            ranked.append(item)

    if not ranked:
        return []

    strongest = max(item["strength"] for item in ranked)
    for item in ranked:
        allowed = _allowed_drop(item["tier_weight"], item["provider_bias"], category, modifier)
        item["within_frontier"] = item["index"] == 0 if strongest <= 0 else item["strength"] >= strongest * (1 - allowed)

    _sort_ranked(ranked, modifier, category)
    return [item["model_key"] for item in ranked]


class ZeroAPIRouter:
    def __init__(self, config: Config):
        self.config = _migrate_legacy_config(config)

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

        if (
            agent_id and workspace_hints is None and current_model
            and _comparison_model_ref(current_model)
            != _comparison_model_ref(self.config.get("default_model", ""))
        ):
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
        comparison_models = {
            _comparison_model_ref(model_key): (model_key, capabilities)
            for model_key, capabilities in models.items()
        }
        current_identity = _comparison_model_ref(current) if isinstance(current, str) else None
        modifier = self.config.get("routing_modifier")
        modifier = modifier if isinstance(modifier, str) else None

        if category == "default" and likely_vision and current:
            current_entry = comparison_models.get(current_identity) if current_identity else None
            current_caps = current_entry[1] if current_entry else None
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
                    if _comparison_model_ref(target) != current_identity:
                        provider = _provider_id(target)
                        return {
                            "provider": _hermes_provider(provider, self.config),
                            "model": _model_id(target),
                            "reason": "zeroapi:default:vision_capability_escape",
                            "category": "default",
                        }

        if category == "default":
            return None
        if (
            isinstance(current, str)
            and current
            and current_identity not in comparison_models
            and self.config.get("external_model_policy", "stay") != "allow"
        ):
            return None

        rules = self.config.get("routing_rules", {})
        rule = rules.get(category) if isinstance(rules, dict) else None
        if not isinstance(rule, dict) and isinstance(rules, dict):
            # Parity with selector.ts:9 / router.ts:205 — fall back to the default rule
            # when the classified category has no dedicated routing rule.
            rule = rules.get("default")
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
                if isinstance(max_ttft, (int, float)):
                    ttft = caps.get("ttft_seconds")
                    if not isinstance(ttft, (int, float)):
                        # ttft_missing: drop latency-unknown models for fast tasks
                        # (parity with filter.ts:24-26).
                        continue
                    if ttft > max_ttft:
                        continue

            item = _build_ranked_item(self.config, candidate, index, caps, category, modifier, agent_id)
            if item is not None:
                ranked.append(item)

        if not ranked:
            return None

        strongest = max(item["strength"] for item in ranked)
        for item in ranked:
            allowed = _allowed_drop(item["tier_weight"], item["provider_bias"], category, modifier)
            item["within_frontier"] = item["index"] == 0 if strongest <= 0 else item["strength"] >= strongest * (1 - allowed)

        _sort_ranked(ranked, modifier, category)

        selected = ranked[0]["model_key"]
        if _comparison_model_ref(selected) == current_identity:
            return None

        provider = _provider_id(selected)
        return {
            "provider": _hermes_provider(provider, self.config),
            "model": _model_id(selected),
            "reason": f"zeroapi:{category}:{reason}",
            "category": category,
        }
