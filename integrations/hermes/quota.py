"""Pure-Python ZeroAPI live quota normalization and policy.

Mirrors plugin/quota-normalize.ts and plugin/quota-policy.ts so the Hermes
Python adapter can apply the same live depletion factor as the OpenClaw
plugin without calling Node or external APIs.

This module is pure data transformation: no credentials, no network access.
"""

from __future__ import annotations

import math
import re
from typing import Any

SECRET_FIELD_PATTERNS = (
    "token", "secret", "cookie", "password", "credential",
    "api_key", "apikey", "access", "refresh", "bearer", "session",
    "email", "authorization",
)


def _is_secret_field(key: str) -> bool:
    lower = key.lower()
    return any(p in lower for p in SECRET_FIELD_PATTERNS)


def _assert_valid_ratio(value: float) -> None:
    if isinstance(value, bool):
        raise TypeError("remainingRatio must be numeric, got boolean")
    if not isinstance(value, (int, float)):
        raise TypeError("remainingRatio must be numeric")
    if math.isnan(value):
        raise ValueError("remainingRatio must not be NaN")
    if math.isinf(value):
        raise ValueError("remainingRatio must be finite")
    if value < 0 or value > 1:
        raise ValueError("remainingRatio must be in [0, 1]")


def _normalize_percentage(value: float) -> float | None:
    if isinstance(value, bool):
        return None
    if not isinstance(value, (int, float)) or math.isnan(value) or math.isinf(value):
        return None
    if value > 1:
        return value / 100
    if value < 0:
        return None
    return float(value)


def _map_window_kind(raw_kind: str) -> str:
    upper = raw_kind.upper()
    if "TOKEN" in upper:
        return "tokens_limit"
    if "REQUEST" in upper or "RPM" in upper:
        return "requests_limit"
    if "CREDIT" in upper:
        return "credits"
    if "MESSAGE" in upper:
        return "messages"
    if "TIME_LIMIT" in upper:
        return "time_limit"
    if "PERCENT" in upper or upper == "USAGE":
        return "percent"
    return "tokens_limit"


def normalize_window(
    raw_kind: str,
    *,
    remaining_ratio: float | None = None,
    used: float | None = None,
    limit: float | None = None,
    percentage_remaining: float | None = None,
    percentage_used: float | None = None,
    applies_to: str = "inference",
    model_ids: list[str] | None = None,
    window_seconds: float | None = None,
    reset_at: str | None = None,
) -> dict[str, Any]:
    kind = _map_window_kind(raw_kind)
    ratio: float | None = None

    if remaining_ratio is not None:
        if isinstance(remaining_ratio, bool):
            raise TypeError("remainingRatio must be numeric, got boolean")
        ratio = float(remaining_ratio)
    elif percentage_remaining is not None:
        ratio = _normalize_percentage(percentage_remaining)
    elif percentage_used is not None:
        used_pct = _normalize_percentage(percentage_used)
        if used_pct is not None:
            ratio = max(0.0, 1.0 - used_pct)
    elif used is not None and limit is not None and limit > 0 and math.isfinite(limit):
        ratio = max(0.0, 1.0 - used / limit)

    if ratio is None:
        raise ValueError(f"cannot derive remainingRatio for window kind '{raw_kind}'")

    _assert_valid_ratio(ratio)

    mids = model_ids or []
    if applies_to == "model" and len(mids) == 0:
        raise ValueError("model-scoped window requires at least one modelId")
    if applies_to != "model" and len(mids) > 0:
        raise ValueError("non-model window must not carry modelIds")

    window: dict[str, Any] = {
        "id": raw_kind,
        "kind": kind,
        "appliesTo": applies_to,
        "modelIds": mids,
        "remainingRatio": ratio,
    }
    if window_seconds is not None:
        window["windowSeconds"] = window_seconds
    if reset_at is not None:
        window["resetAt"] = reset_at
    return window


def validate_snapshot(
    snapshot: dict[str, Any],
    expected_provider: str | None = None,
    diagnostics_only: bool = False,
) -> None:
    provider = snapshot.get("provider")
    account = snapshot.get("account")
    if not provider or not account:
        raise ValueError("snapshot provider and account are required")
    if expected_provider is not None and provider != expected_provider:
        raise ValueError(
            f'snapshot provider "{provider}" does not match expected "{expected_provider}"'
        )
    status = snapshot.get("status", "fresh")
    if not diagnostics_only and status != "fresh":
        raise ValueError(f'routing snapshot must be fresh, got "{status}"')
    if status == "fresh":
        windows = snapshot.get("windows", [])
        if len(windows) == 0:
            raise ValueError("fresh snapshot requires at least one window")
        for w in windows:
            _assert_valid_ratio(w["remainingRatio"])


def _parse_time_window_seconds(tw: str | None) -> float | None:
    if not tw:
        return None
    match = re.match(r"^(\d+(?:\.\d+)?)\s*(m|h|d|w)$", tw)
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2)
    if unit == "m":
        return value * 60
    if unit == "h":
        return value * 3600
    if unit == "d":
        return value * 86400
    if unit == "w":
        return value * 604800
    return None


def _parse_zai_windows(raw: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw, dict):
        return None
    limits = raw.get("limits")
    if not isinstance(limits, list):
        return None

    windows: list[dict[str, Any]] = []
    for limit in limits:
        if not isinstance(limit, dict):
            continue
        raw_kind = limit.get("type", limit.get("limit_id", "UNKNOWN"))
        window_seconds = _parse_time_window_seconds(limit.get("time_window"))
        reset_at = limit.get("next_reset_time")
        ratio: float | None = None

        if isinstance(limit.get("percentage"), (int, float)):
            ratio = _normalize_percentage(limit["percentage"])

        if ratio is None and isinstance(limit.get("usage"), dict):
            usage = limit["usage"]
            used = usage.get("current_value", usage.get("used", 0))
            limit_total = usage.get("number")
            if isinstance(limit_total, (int, float)) and limit_total > 0:
                ratio = max(0.0, 1.0 - used / limit_total)

        if ratio is None:
            continue

        applies_to = "mcp" if "TIME_LIMIT" in str(raw_kind).upper() else "inference"
        try:
            windows.append(normalize_window(
                raw_kind, remaining_ratio=ratio,
                applies_to=applies_to, window_seconds=window_seconds, reset_at=reset_at,
            ))
        except (ValueError, TypeError):
            continue

    return windows if windows else None


def _parse_codex_windows(raw: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw, dict):
        return None
    limits = raw.get("rate_limits")
    if not isinstance(limits, list):
        return None

    windows: list[dict[str, Any]] = []
    for limit in limits:
        if not isinstance(limit, dict):
            continue
        if not isinstance(limit.get("used_percent"), (int, float)):
            continue
        raw_kind = limit.get("label", "PRIMARY")
        window_seconds = limit.get("window_minutes")
        if isinstance(window_seconds, (int, float)):
            window_seconds = window_seconds * 60
        else:
            window_seconds = None
        try:
            windows.append(normalize_window(
                raw_kind, percentage_used=limit["used_percent"],
                window_seconds=window_seconds,
            ))
        except (ValueError, TypeError):
            continue

    return windows if windows else None


def _parse_xai_windows(raw: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw, dict):
        return None
    rp = raw.get("remaining_percent")
    if not isinstance(rp, (int, float)):
        return None
    ratio = _normalize_percentage(rp)
    if ratio is None:
        return None
    return [normalize_window("BILLING", remaining_ratio=ratio)]


def _parse_kimi_windows(raw: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw, dict):
        return None
    usages = raw.get("usages")
    if not isinstance(usages, list):
        return None

    windows: list[dict[str, Any]] = []
    for usage in usages:
        if not isinstance(usage, dict):
            continue
        raw_kind = usage.get("limit_id", usage.get("type", "UNKNOWN"))
        reset_at = usage.get("reset_at")
        ratio: float | None = None

        if isinstance(usage.get("percentage"), (int, float)):
            ratio = _normalize_percentage(usage["percentage"])
        if ratio is None and isinstance(usage.get("remaining"), (int, float)) and isinstance(usage.get("total"), (int, float)) and usage["total"] > 0:
            ratio = usage["remaining"] / usage["total"]
        if ratio is None and isinstance(usage.get("used"), (int, float)) and isinstance(usage.get("total"), (int, float)) and usage["total"] > 0:
            ratio = max(0.0, 1.0 - usage["used"] / usage["total"])
        if ratio is None:
            continue
        try:
            windows.append(normalize_window(raw_kind, remaining_ratio=ratio, reset_at=reset_at))
        except (ValueError, TypeError):
            continue

    return windows if windows else None


def _parse_minimax_windows(raw: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw, dict):
        return None
    remains = raw.get("remains", raw)
    if not isinstance(remains, dict):
        return None
    ratio: float | None = None

    if isinstance(remains.get("percentage"), (int, float)):
        ratio = _normalize_percentage(remains["percentage"])
    if ratio is None and isinstance(remains.get("remaining"), (int, float)) and isinstance(remains.get("total"), (int, float)) and remains["total"] > 0:
        ratio = remains["remaining"] / remains["total"]
    if ratio is None and isinstance(remains.get("used"), (int, float)) and isinstance(remains.get("total"), (int, float)) and remains["total"] > 0:
        ratio = max(0.0, 1.0 - remains["used"] / remains["total"])
    if ratio is None:
        return None
    return [normalize_window(
        remains.get("plan_type", "CODING_PLAN"),
        remaining_ratio=ratio, reset_at=remains.get("reset_at"),
    )]


def normalize_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    provider = payload["provider"]
    account = payload["account"]
    raw = payload.get("raw", {})
    fetched_at = payload.get("fetchedAt", "")

    windows: list[dict[str, Any]] | None = None
    status = "fresh"

    windows = _parse_zai_windows(raw)
    if windows is None:
        windows = _parse_codex_windows(raw)
    if windows is None:
        windows = _parse_xai_windows(raw)
    if windows is None:
        windows = _parse_kimi_windows(raw)
    if windows is None:
        windows = _parse_minimax_windows(raw)

    if windows is None or len(windows) == 0:
        status = "unsupported"
        windows = []

    snapshot = {
        "provider": provider,
        "account": account,
        "status": status,
        "windows": windows,
        "fetchedAt": fetched_at,
    }
    validate_snapshot(snapshot, diagnostics_only=True)
    return snapshot


# ── Policy ──

def applicable_windows(snapshot: dict[str, Any] | None, model: str) -> list[dict[str, Any]]:
    if not snapshot or snapshot.get("status") != "fresh":
        return []
    result = []
    for w in snapshot.get("windows", []):
        if w["appliesTo"] == "inference":
            result.append(w)
        elif w["appliesTo"] == "model" and model in w.get("modelIds", []):
            result.append(w)
    return result


def account_headroom(snapshot: dict[str, Any] | None, model: str) -> float | None:
    windows = applicable_windows(snapshot, model)
    if not windows:
        return None
    return min(w["remainingRatio"] for w in windows)


def compute_quota_factor(snapshot: dict[str, Any] | None, model: str) -> float | None:
    headroom = account_headroom(snapshot, model)
    if headroom is None:
        return None
    return math.sqrt(headroom)


def compute_live_pressure(
    static_pressure: float,
    provider_bias: float,
    snapshot: dict[str, Any] | None,
    model: str,
) -> float | None:
    factor = compute_quota_factor(snapshot, model)
    if factor is None:
        return None
    return static_pressure * provider_bias * factor
