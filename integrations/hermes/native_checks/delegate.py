"""Native child runtime acceptance; run through native_smoke.py."""

from types import SimpleNamespace

import importlib.util
if importlib.util.find_spec("tools.delegate_tool_config") is not None:
    import tools.delegate_tool_config as delegate_tool
else:
    import tools.delegate_tool as delegate_tool


def _normalizer():
    normalizer = getattr(delegate_tool, "_normalize_child_runtime_tuple", None)
    assert callable(normalizer), "child runtime normalization is missing"
    return normalizer


def test_inferred_child_provider_repairs_the_full_runtime_tuple(monkeypatch):
    monkeypatch.setattr(
        "hermes_cli.models.detect_provider_for_model",
        lambda model, provider: ("openai-codex", "gpt-5.6"),
    )
    monkeypatch.setattr(
        "hermes_cli.runtime_provider.resolve_runtime_provider",
        lambda **kwargs: {
            "provider": "openai-codex",
            "base_url": "https://example.invalid/codex",
            "api_key": "fresh-test-key",
            "api_mode": "responses",
        },
    )

    assert _normalizer()(
        provider="nous",
        model="gpt-5.6",
        base_url="https://example.invalid/nous",
        api_key="stale-test-key",
        api_mode="chat_completions",
        explicit_provider=False,
        explicit_base_url=False,
        acp_command=None,
    ) == (
        "openai-codex",
        "https://example.invalid/codex",
        "fresh-test-key",
        "responses",
    )


def test_inferred_provider_resolution_failure_keeps_original_runtime_tuple(monkeypatch):
    monkeypatch.setattr(
        "hermes_cli.models.detect_provider_for_model",
        lambda model, provider: ("openai-codex", "gpt-5.6"),
    )

    def _failed_resolution(**kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(
        "hermes_cli.runtime_provider.resolve_runtime_provider",
        _failed_resolution,
    )
    original = (
        "nous",
        "https://example.invalid/nous",
        "stale-test-key",
        "chat_completions",
    )

    assert _normalizer()(
        provider=original[0],
        model="gpt-5.6",
        base_url=original[1],
        api_key=original[2],
        api_mode=original[3],
        explicit_provider=False,
        explicit_base_url=False,
        acp_command=None,
    ) == original


def test_inferred_provider_partial_resolution_keeps_original_runtime_tuple(monkeypatch):
    monkeypatch.setattr(
        "hermes_cli.models.detect_provider_for_model",
        lambda model, provider: ("openai-codex", "gpt-5.6"),
    )
    monkeypatch.setattr(
        "hermes_cli.runtime_provider.resolve_runtime_provider",
        lambda **kwargs: {
            "provider": "openai-codex",
            "api_mode": "responses",
        },
    )
    original = (
        "nous",
        "https://example.invalid/nous",
        "stale-test-key",
        "chat_completions",
    )

    assert _normalizer()(
        provider=original[0],
        model="gpt-5.6",
        base_url=original[1],
        api_key=original[2],
        api_mode=original[3],
        explicit_provider=False,
        explicit_base_url=False,
        acp_command=None,
    ) == original


def test_explicit_direct_endpoint_is_never_rewritten(monkeypatch):
    def _unexpected(*args, **kwargs):
        raise AssertionError("runtime resolution must not run for an explicit endpoint")

    monkeypatch.setattr("hermes_cli.models.detect_provider_for_model", _unexpected)
    monkeypatch.setattr("hermes_cli.runtime_provider.resolve_runtime_provider", _unexpected)
    original = (
        "custom",
        "https://example.invalid/direct",
        "direct-test-key",
        "chat_completions",
    )

    assert _normalizer()(
        provider=original[0],
        model="private-model",
        base_url=original[1],
        api_key=original[2],
        api_mode=original[3],
        explicit_provider=True,
        explicit_base_url=True,
        acp_command=None,
    ) == original


def test_acp_transport_is_never_rewritten(monkeypatch):
    def _unexpected(*args, **kwargs):
        raise AssertionError("runtime resolution must not run for ACP")

    monkeypatch.setattr("hermes_cli.models.detect_provider_for_model", _unexpected)
    monkeypatch.setattr("hermes_cli.runtime_provider.resolve_runtime_provider", _unexpected)
    original = (
        "copilot-acp",
        "",
        "",
        "chat_completions",
    )

    assert _normalizer()(
        provider=original[0],
        model="gpt-5.6",
        base_url=original[1],
        api_key=original[2],
        api_mode=original[3],
        explicit_provider=False,
        explicit_base_url=False,
        acp_command="copilot",
    ) == original


def test_stale_parent_pool_is_not_shared_for_named_provider(monkeypatch):
    parent_pool = SimpleNamespace(provider="nous")
    replacement_pool = SimpleNamespace(provider="openai-codex", has_credentials=lambda: True)
    parent = SimpleNamespace(
        provider="openai-codex",
        base_url="https://example.invalid/codex",
        _credential_pool=parent_pool,
    )
    monkeypatch.setattr(
        "agent.credential_pool.load_pool",
        lambda provider: replacement_pool,
    )

    resolved = delegate_tool._resolve_child_credential_pool(
        "openai-codex",
        parent,
        "https://example.invalid/codex",
    )

    assert resolved is replacement_pool


def test_stale_parent_pool_is_not_shared_for_custom_endpoint(monkeypatch):
    parent_pool = SimpleNamespace(provider="custom:other")
    replacement_pool = SimpleNamespace(provider="custom:target", has_credentials=lambda: True)
    parent = SimpleNamespace(
        provider="custom",
        base_url="https://example.invalid/target",
        _credential_pool=parent_pool,
    )
    monkeypatch.setattr(
        "agent.credential_pool.get_custom_provider_pool_key",
        lambda base_url: "custom:target",
    )
    monkeypatch.setattr(
        "agent.credential_pool.load_pool",
        lambda provider: replacement_pool,
    )

    resolved = delegate_tool._resolve_child_credential_pool(
        "custom",
        parent,
        "https://example.invalid/target",
    )

    assert resolved is replacement_pool


def test_explicit_endpoint_preserves_callable_credential_without_evaluating(monkeypatch):
    calls = []

    def token_provider():
        calls.append(True)
        return "unused-test-token"

    def unexpected_resolution(**kwargs):
        raise AssertionError("explicit endpoint must not invoke runtime resolution")

    monkeypatch.setattr("hermes_cli.runtime_provider.resolve_runtime_provider", unexpected_resolution)
    result = _normalizer()(
        model="private-model", provider="custom", base_url="https://example.invalid/direct",
        api_key=token_provider, api_mode="chat_completions", explicit_provider=True,
        explicit_base_url=True, acp_command=None,
    )
    assert result[2] is token_provider
    assert calls == []


def test_inferred_runtime_preserves_resolved_callable_credential(monkeypatch):
    calls = []

    def token_provider():
        calls.append(True)
        return "unused-test-token"

    monkeypatch.setattr("hermes_cli.models.detect_provider_for_model",
                        lambda model, provider: ("openai-codex", model))
    monkeypatch.setattr("hermes_cli.runtime_provider.resolve_runtime_provider", lambda **kwargs: {
        "provider": "openai-codex", "base_url": "https://example.invalid/codex",
        "api_key": token_provider, "api_mode": "codex_responses",
    })
    result = _normalizer()(
        model="codex-child", provider="nous", base_url="https://example.invalid/old",
        api_key="old-test-key", api_mode="chat_completions", explicit_provider=False,
        explicit_base_url=False, acp_command=None,
    )
    assert result[:2] == ("openai-codex", "https://example.invalid/codex")
    assert result[2] is token_provider
    assert result[3] == "codex_responses"
    assert calls == []
