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
_route_state: dict[str, str] = {}


def _payload_has_image_attachment(value: Any, *, _depth: int = 0) -> bool:
    """Return True when a Hermes hook payload/history contains image parts."""
    if _depth > 8:
        return False
    if isinstance(value, list):
        return any(_payload_has_image_attachment(item, _depth=_depth + 1) for item in value)
    if not isinstance(value, dict):
        return False

    part_type = value.get("type")
    if part_type in {"image_url", "input_image", "image"}:
        return True

    for key in ("content", "parts", "attachments", "media", "images", "files", "message"):
        if key in value and _payload_has_image_attachment(value[key], _depth=_depth + 1):
            return True

    return False


def _route_state_key(kwargs: dict[str, Any]) -> str:
    platform = kwargs.get("platform") if isinstance(kwargs.get("platform"), str) else ""
    sender_id = kwargs.get("sender_id") if isinstance(kwargs.get("sender_id"), str) else ""
    agent_id = kwargs.get("agent_id") if isinstance(kwargs.get("agent_id"), str) else "main"
    session_id = kwargs.get("session_id") if isinstance(kwargs.get("session_id"), str) else ""
    gateway_session_key = kwargs.get("gateway_session_key") if isinstance(kwargs.get("gateway_session_key"), str) else ""
    chat_id = kwargs.get("chat_id") if isinstance(kwargs.get("chat_id"), str) else ""
    thread_id = kwargs.get("thread_id") if isinstance(kwargs.get("thread_id"), str) else ""
    # Prefer the sender/chat key over session_id so compression splits keep the
    # active task route. Fall back to session_id for non-channel use.
    if gateway_session_key:
        return f"gateway:{gateway_session_key}:{agent_id}"
    if platform and chat_id:
        return f"{platform}:chat:{chat_id}:{thread_id}:{agent_id}"
    if platform or sender_id:
        return f"{platform}:{sender_id}:{agent_id}"
    return f"session:{session_id}:{agent_id}"


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

    # Detect image attachments from the gateway hook payload. Hermes versions
    # differ on whether they pass a flag, a message object, or only structured
    # content in conversation_history, so inspect all available payload shapes.
    has_images = (
        bool(kwargs.get("has_images", False))
        or _payload_has_image_attachment(kwargs.get("message"))
        or _payload_has_image_attachment(kwargs.get("event"))
        or _payload_has_image_attachment(kwargs.get("conversation_history"))
    )
    state_key = _route_state_key(kwargs)

    route = router.resolve(
        prompt=user_message,
        current_model=_current_model_key(kwargs.get("provider"), kwargs.get("model")),
        platform=kwargs.get("platform") if isinstance(kwargs.get("platform"), str) else None,
        agent_id=kwargs.get("agent_id") if isinstance(kwargs.get("agent_id"), str) else None,
        trigger=kwargs.get("trigger") if isinstance(kwargs.get("trigger"), str) else None,
        has_image_attachment=has_images,
        conversation_history=kwargs.get("conversation_history") if isinstance(kwargs.get("conversation_history"), list) else None,
        previous_category=_route_state.get(state_key),
    )
    if route is None:
        return None

    category = route.get("category")
    if category in {"code", "research", "math"}:
        _route_state[state_key] = category

    return {
        "provider": route["provider"],
        "model": route["model"],
        "reason": route["reason"],
    }


def register(ctx: Any) -> None:
    ctx.register_hook("pre_model_route", _pre_model_route)
