"""ZeroAPI Hermes plugin adapter.

This adapter is intentionally small: it reads the same zeroapi-config.json
policy shape as the OpenClaw plugin and returns a Hermes pre_model_route
proposal. Hermes itself still owns provider credential resolution, model
normalization, transport setup, and credential rotation.
"""

from __future__ import annotations

import logging
from typing import Any

from .router import ZeroAPIRouter, load_config

logger = logging.getLogger(__name__)

_router: ZeroAPIRouter | None = None


def _get_router() -> ZeroAPIRouter | None:
    global _router
    if _router is not None:
        return _router

    config = load_config()
    if config is None:
        logger.warning("ZeroAPI Hermes config not found. Set ZEROAPI_CONFIG_PATH or create ~/.hermes/zeroapi-config.json.")
        return None

    _router = ZeroAPIRouter(config)
    logger.info(
        "ZeroAPI Hermes router loaded: policy=%s mode=%s models=%s",
        config.get("version", "unknown"),
        config.get("routing_mode", "balanced"),
        len(config.get("models", {})),
    )
    return _router


def _current_model_key(provider: Any, model: Any) -> str | None:
    if isinstance(provider, str) and provider.strip() and isinstance(model, str) and model.strip():
        return f"{provider.strip()}/{model.strip()}"
    if isinstance(model, str) and model.strip():
        return model.strip()
    return None


def _pre_model_route(**kwargs: Any) -> dict[str, str] | None:
    router = _get_router()
    if router is None:
        return None

    user_message = kwargs.get("user_message")
    if not isinstance(user_message, str):
        return None

    route = router.resolve(
        prompt=user_message,
        current_model=_current_model_key(kwargs.get("provider"), kwargs.get("model")),
        platform=kwargs.get("platform") if isinstance(kwargs.get("platform"), str) else None,
        agent_id=kwargs.get("agent_id") if isinstance(kwargs.get("agent_id"), str) else None,
        trigger=kwargs.get("trigger") if isinstance(kwargs.get("trigger"), str) else None,
    )
    if route is None:
        return None

    return {
        "provider": route["provider"],
        "model": route["model"],
        "reason": route["reason"],
    }


def register(ctx: Any) -> None:
    ctx.register_hook("pre_model_route", _pre_model_route)
