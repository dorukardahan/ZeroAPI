"""Pure-Python ZeroAPI quota normalization and pressure policy.

Provider HTTP/RPC parsing and credentials remain host-owned. This module
accepts only token-free, provider-neutral quantitative windows and mirrors
plugin/quota-normalize.ts + plugin/quota-policy.ts.
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any, TypeGuard

VALID_STATUSES = {
    "fresh",
    "stale",
    "auth_expired",
    "rate_limited",
    "network_error",
    "invalid_response",
    "unsupported",
}
VALID_WINDOW_KINDS = {
    "tokens_limit",
    "requests_limit",
    "credits",
    "messages",
    "compute",
    "time_limit",
    "percent",
}
VALID_APPLICABILITY = {"inference", "mcp", "model"}
TIMESTAMP_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$"
)


def _is_number(value: Any) -> TypeGuard[int | float]:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
    )


def _assert_finite_number(value: Any, label: str) -> None:
    if isinstance(value, bool):
        raise TypeError(f"{label} must be numeric, got boolean")
    if not isinstance(value, (int, float)):
        raise TypeError(f"{label} must be numeric")
    try:
        if math.isnan(value):
            raise ValueError(f"{label} must not be NaN")
        if math.isinf(value):
            raise ValueError(f"{label} must be finite")
    except OverflowError:
        raise ValueError(f"{label} is too large to represent as a finite number")


def _assert_valid_ratio(value: Any) -> None:
    _assert_finite_number(value, "remainingRatio")
    if value < 0 or value > 1:
        raise ValueError("remainingRatio must be in [0, 1]")


def _normalize_percentage(value: Any, label: str) -> float:
    _assert_finite_number(value, label)
    if value < 0 or value > 100:
        raise ValueError(f"{label} must be in [0, 100]")
    ratio = value / 100
    _assert_valid_ratio(ratio)
    return ratio


def _normalize_identifier(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{label} must be a string")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{label} must be non-empty")
    if len(normalized) > 256:
        raise ValueError(f"{label} is too long")
    if any(ord(char) < 32 or ord(char) == 127 for char in normalized):
        raise ValueError(f"{label} contains control characters")
    return normalized


def _normalize_timestamp(value: Any, label: str) -> str:
    normalized = _normalize_identifier(value, label)
    if TIMESTAMP_RE.fullmatch(normalized) is None:
        raise ValueError(f"{label} must be an ISO-8601 timestamp with timezone")
    try:
        datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} must contain a valid calendar date and time") from exc
    return normalized


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
    if "COMPUTE" in upper or "TIME" in upper:
        return "compute"
    if "PERCENT" in upper or upper in {"USAGE", "BILLING"}:
        return "percent"
    return "tokens_limit"


def normalize_window(
    raw_kind: Any,
    *,
    id: str | None = None,
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
    normalized_kind = _normalize_identifier(raw_kind, "raw_kind")
    window_id = _normalize_identifier(id if id is not None else normalized_kind, "window id")
    kind = _map_window_kind(normalized_kind)

    if remaining_ratio is not None:
        _assert_valid_ratio(remaining_ratio)
        ratio = float(remaining_ratio)
    elif percentage_remaining is not None:
        ratio = _normalize_percentage(percentage_remaining, "percentage_remaining")
    elif percentage_used is not None:
        ratio = max(0.0, 1.0 - _normalize_percentage(percentage_used, "percentage_used"))
    elif used is not None and limit is not None:
        _assert_finite_number(used, "used")
        _assert_finite_number(limit, "limit")
        if used < 0:
            raise ValueError("used must be non-negative")
        if limit <= 0:
            raise ValueError("limit must be positive")
        ratio = max(0.0, 1.0 - used / limit)
        _assert_valid_ratio(ratio)
    else:
        raise ValueError(f"cannot derive remainingRatio for window '{window_id}'")

    if applies_to not in {"inference", "mcp", "model"}:
        raise ValueError(f"unknown applies_to value '{applies_to}'")

    if model_ids is not None and not isinstance(model_ids, list):
        raise TypeError("modelIds must be a list")
    mids = [_normalize_identifier(model_id, "modelId") for model_id in (model_ids or [])]
    if len(set(mids)) != len(mids):
        raise ValueError("modelIds must be unique")
    if applies_to == "model" and not mids:
        raise ValueError("model-scoped window requires at least one modelId")
    if applies_to != "model" and mids:
        raise ValueError("non-model window must not carry modelIds")

    normalized_seconds: float | None = None
    if window_seconds is not None:
        _assert_finite_number(window_seconds, "windowSeconds")
        if window_seconds <= 0:
            raise ValueError("windowSeconds must be positive")
        normalized_seconds = float(window_seconds)

    normalized_reset = None if reset_at is None else _normalize_timestamp(reset_at, "resetAt")

    return {
        "id": window_id,
        "kind": kind,
        "appliesTo": applies_to,
        "modelIds": mids,
        "remainingRatio": ratio,
        **({"windowSeconds": normalized_seconds} if normalized_seconds is not None else {}),
        **({"resetAt": normalized_reset} if normalized_reset is not None else {}),
    }


def validate_snapshot(
    snapshot: dict[str, Any],
    expected_provider: str | None = None,
    diagnostics_only: bool = False,
) -> None:
    provider = _normalize_identifier(snapshot.get("provider"), "snapshot provider")
    _normalize_identifier(snapshot.get("account"), "snapshot account")
    _normalize_timestamp(snapshot.get("fetchedAt"), "fetchedAt")

    status = snapshot.get("status")
    if status not in VALID_STATUSES:
        raise ValueError(f"unknown snapshot status '{status}'")
    if expected_provider is not None and provider != expected_provider:
        raise ValueError(
            f'snapshot provider "{provider}" does not match expected "{expected_provider}"'
        )
    if not diagnostics_only and status != "fresh":
        raise ValueError(f'routing snapshot must be fresh, got "{status}"')

    windows = snapshot.get("windows")
    if not isinstance(windows, list):
        raise TypeError("snapshot windows must be a list")
    if status == "fresh" and not windows:
        raise ValueError("fresh snapshot requires at least one window")

    ids: set[str] = set()
    for window in windows:
        if not isinstance(window, dict):
            raise TypeError("window must be an object")
        _assert_valid_ratio(window.get("remainingRatio"))
        window_id = _normalize_identifier(window.get("id"), "window id")
        if window.get("kind") not in VALID_WINDOW_KINDS:
            raise ValueError(f'unknown window kind "{window.get("kind")}"')
        applies_to = window.get("appliesTo")
        if applies_to not in VALID_APPLICABILITY:
            raise ValueError(f'unknown appliesTo value "{applies_to}"')
        model_ids = window.get("modelIds")
        if not isinstance(model_ids, list):
            raise TypeError("modelIds must be a list")
        normalized_models = [_normalize_identifier(model_id, "modelId") for model_id in model_ids]
        if len(set(normalized_models)) != len(normalized_models):
            raise ValueError("modelIds must be unique")
        if applies_to == "model" and not normalized_models:
            raise ValueError("model-scoped window requires at least one modelId")
        if applies_to != "model" and normalized_models:
            raise ValueError("non-model window must not carry modelIds")
        if "windowSeconds" in window:
            seconds = window["windowSeconds"]
            _assert_finite_number(seconds, "windowSeconds")
            if seconds <= 0:
                raise ValueError("windowSeconds must be positive")
        if "resetAt" in window:
            _normalize_timestamp(window["resetAt"], "resetAt")
        if window_id in ids:
            raise ValueError(f'duplicate window id "{window_id}"')
        ids.add(window_id)


def _input_window(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise TypeError("window must be an object")
    return normalize_window(
        item.get("rawKind"),
        id=item.get("id"),
        remaining_ratio=item.get("remainingRatio"),
        used=item.get("used"),
        limit=item.get("limit"),
        percentage_remaining=item.get("percentageRemaining"),
        percentage_used=item.get("percentageUsed"),
        applies_to=item.get("appliesTo", "inference"),
        model_ids=item.get("modelIds"),
        window_seconds=item.get("windowSeconds"),
        reset_at=item.get("resetAt"),
    )


def normalize_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    provider = _normalize_identifier(payload.get("provider"), "provider")
    account = _normalize_identifier(payload.get("account"), "account")
    fetched_at = _normalize_timestamp(payload.get("fetchedAt"), "fetchedAt")
    requested_status = payload.get("status", "fresh")
    status = (
        requested_status
        if isinstance(requested_status, str) and requested_status in VALID_STATUSES
        else "invalid_response"
    )

    windows: list[dict[str, Any]] = []
    try:
        raw_windows = payload.get("windows")
        if not isinstance(raw_windows, list):
            raise TypeError("windows must be a list")
        windows = [_input_window(item) for item in raw_windows]
        ids = {window["id"] for window in windows}
        if len(ids) != len(windows):
            raise ValueError("window IDs must be unique")
    except (KeyError, TypeError, ValueError, OverflowError):
        windows = []
        status = "invalid_response"

    if status == "fresh" and not windows:
        status = "unsupported"

    snapshot = {
        "provider": provider,
        "account": account,
        "status": status,
        "windows": windows,
        "fetchedAt": fetched_at,
    }
    validate_snapshot(snapshot, diagnostics_only=True)
    return snapshot


# ── Routing policy ──────────────────────────────────────────────────────────

def applicable_windows(snapshot: dict[str, Any] | None, model: str) -> list[dict[str, Any]]:
    if not snapshot or snapshot.get("status") != "fresh":
        return []
    result = []
    for window in snapshot.get("windows", []):
        if window["appliesTo"] == "inference":
            result.append(window)
        elif window["appliesTo"] == "model" and model in window.get("modelIds", []):
            result.append(window)
    return result


def account_headroom(snapshot: dict[str, Any] | None, model: str) -> float | None:
    if not snapshot or snapshot.get("status") != "fresh":
        return None
    try:
        validate_snapshot(snapshot)
    except (KeyError, TypeError, ValueError):
        return None
    windows = applicable_windows(snapshot, model)
    if not windows:
        return None
    return min(window["remainingRatio"] for window in windows)


def compute_quota_factor(snapshot: dict[str, Any] | None, model: str) -> float | None:
    headroom = account_headroom(snapshot, model)
    if headroom is None:
        return None
    return math.sqrt(headroom)


def compute_live_pressure(
    tier_weight: float,
    provider_bias: float,
    snapshot: dict[str, Any] | None,
    model: str,
) -> float | None:
    factor = compute_quota_factor(snapshot, model)
    if factor is None:
        return None
    return tier_weight * provider_bias * factor
