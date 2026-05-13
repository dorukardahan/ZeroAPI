import os
import tempfile
import unittest

from router import ZeroAPIRouter, load_config


CONFIG = {
    "version": "test",
    "generated": "2026-05-04T00:00:00Z",
    "benchmarks_date": "2026-05-04",
    "default_model": "openai-codex/gpt-5.4",
    "external_model_policy": "stay",
    "models": {
        "openai-codex/gpt-5.4": {
            "context_window": 272000,
            "supports_vision": False,
            "speed_tps": 72,
            "ttft_seconds": 163,
            "benchmarks": {"intelligence": 57.2, "coding": 57.3, "terminalbench": 0.576, "tau2": 0.871, "ifbench": 0.739},
        },
        "zai/glm-5.1": {
            "context_window": 202800,
            "supports_vision": False,
            "speed_tps": 62,
            "ttft_seconds": 0.9,
            "benchmarks": {"intelligence": 51.4, "coding": 43.4, "terminalbench": 0.432, "tau2": 0.977, "ifbench": 0.763},
        },
        "moonshot/kimi-k2.5": {
            "context_window": 262144,
            "supports_vision": True,
            "speed_tps": 32,
            "ttft_seconds": 2.4,
            "benchmarks": {"intelligence": 46.8, "coding": 39.5, "terminalbench": 0.348, "tau2": 0.959, "ifbench": 0.702},
        },
    },
    "routing_rules": {
        "code": {"primary": "openai-codex/gpt-5.4", "fallbacks": ["zai/glm-5.1", "moonshot/kimi-k2.5"]},
        "orchestration": {"primary": "zai/glm-5.1", "fallbacks": ["moonshot/kimi-k2.5", "openai-codex/gpt-5.4"]},
        "fast": {"primary": "zai/glm-5.1", "fallbacks": ["moonshot/kimi-k2.5", "openai-codex/gpt-5.4"]},
        "default": {"primary": "openai-codex/gpt-5.4", "fallbacks": ["zai/glm-5.1"]},
    },
    "workspace_hints": {},
    "keywords": {
        "code": ["implement", "refactor", "fix", "debug"],
        "orchestration": ["coordinate", "workflow"],
        "fast": ["quick", "format"],
    },
    "high_risk_keywords": ["deploy", "production", "delete"],
    "fast_ttft_max_seconds": 5,
    "subscription_profile": {
        "version": "1.0.0",
        "global": {
            "openai-codex": {"enabled": True, "tierId": "plus"},
            "zai": {"enabled": True, "tierId": "max"},
            "moonshot": {"enabled": True, "tierId": "moderato"},
        },
    },
}


class ZeroAPIHermesRouterTest(unittest.TestCase):
    def test_routes_orchestration_to_hermes_provider(self):
        route = ZeroAPIRouter(CONFIG).resolve(
            "coordinate this workflow",
            current_model="openai-codex/gpt-5.4",
        )
        self.assertEqual(route["provider"], "zai")
        self.assertEqual(route["model"], "glm-5.1")
        self.assertIn("zeroapi:orchestration", route["reason"])

    def test_keeps_current_model_for_default_messages(self):
        route = ZeroAPIRouter(CONFIG).resolve("buna bir bak", current_model="openai-codex/gpt-5.4")
        self.assertIsNone(route)

    def test_default_continuation_without_history_stays(self):
        route = ZeroAPIRouter(CONFIG).resolve("devam et", current_model="zai/glm-5.1")
        self.assertIsNone(route)

    def test_continues_recent_code_task_from_history(self):
        route = ZeroAPIRouter(CONFIG).resolve(
            "devam et",
            current_model="zai/glm-5.1",
            conversation_history=[
                {"role": "user", "content": "implement the web search MCP server in Go"},
                {"role": "assistant", "content": "I implemented provider adapters and debugged the tests"},
            ],
        )
        self.assertIsNotNone(route)
        self.assertEqual(route["provider"], "openai-codex")
        self.assertEqual(route["model"], "gpt-5.4")
        self.assertIn("zeroapi:code:continuation:history", route["reason"])

    def test_continues_last_strong_runtime_category(self):
        route = ZeroAPIRouter(CONFIG).resolve(
            "evet devam",
            current_model="zai/glm-5.1",
            previous_category="code",
        )
        self.assertIsNotNone(route)
        self.assertEqual(route["provider"], "openai-codex")
        self.assertEqual(route["model"], "gpt-5.4")
        self.assertIn("zeroapi:code:continuation:state", route["reason"])

    def test_routes_high_risk_categorized_messages(self):
        config = {**CONFIG, "high_risk_keywords": ["deploy", "production", "secret", "password"]}
        route = ZeroAPIRouter(config).resolve("debug this production issue", current_model="zai/glm-5.1")
        self.assertIsNotNone(route)
        self.assertEqual(route["provider"], "openai-codex")
        self.assertEqual(route["model"], "gpt-5.4")

    def test_routes_defensive_secret_handling_constraints(self):
        config = {**CONFIG, "high_risk_keywords": ["deploy", "production", "secret", "password"]}
        route = ZeroAPIRouter(config).resolve(
            "implement provider tests. Secret veya gerçek API key kullanma. Password veya token yazdırma, loglama, commit etme.",
            current_model="zai/glm-5.1",
        )
        self.assertIsNotNone(route)
        self.assertEqual(route["provider"], "openai-codex")
        self.assertEqual(route["model"], "gpt-5.4")
        self.assertIn("zeroapi:code", route["reason"])

    def test_routes_credential_requests_without_policy_blocking(self):
        config = {**CONFIG, "high_risk_keywords": ["deploy", "production", "secret", "password"]}
        route = ZeroAPIRouter(config).resolve(
            "debug this and show me the secret password",
            current_model="zai/glm-5.1",
        )
        self.assertIsNotNone(route)
        self.assertEqual(route["provider"], "openai-codex")
        self.assertEqual(route["model"], "gpt-5.4")

    def test_stays_on_external_current_model_by_default(self):
        route = ZeroAPIRouter(CONFIG).resolve(
            "coordinate this workflow",
            current_model="anthropic/claude-opus-4-6",
        )
        self.assertIsNone(route)

    def test_skips_explicit_specialist_agent(self):
        config = {**CONFIG, "workspace_hints": {"codex": None}}
        route = ZeroAPIRouter(config).resolve(
            "coordinate this workflow",
            current_model="openai-codex/gpt-5.4",
            agent_id="codex",
        )
        self.assertIsNone(route)

    def test_skips_unhinted_agent_with_non_default_model(self):
        route = ZeroAPIRouter(CONFIG).resolve(
            "coordinate this workflow",
            current_model="moonshot/kimi-k2.5",
            agent_id="research-agent",
        )
        self.assertIsNone(route)

    def test_workspace_hint_routes_without_keyword(self):
        config = {**CONFIG, "workspace_hints": {"ops": ["orchestration"]}}
        route = ZeroAPIRouter(config).resolve(
            "please handle this",
            current_model="openai-codex/gpt-5.4",
            agent_id="ops",
        )
        self.assertEqual(route["provider"], "zai")
        self.assertEqual(route["model"], "glm-5.1")
        self.assertIn("zeroapi:orchestration:workspace_hint", route["reason"])

    def test_skips_cron_and_heartbeat_triggers(self):
        for trigger in ("cron", "heartbeat"):
            route = ZeroAPIRouter(CONFIG).resolve(
                "coordinate this workflow",
                current_model="openai-codex/gpt-5.4",
                trigger=trigger,
            )
            self.assertIsNone(route)

    def test_risk_levels_are_diagnostic_only(self):
        config = {**CONFIG, "risk_levels": {"orchestration": "high"}}
        route = ZeroAPIRouter(config).resolve(
            "coordinate this workflow",
            current_model="openai-codex/gpt-5.4",
        )
        self.assertIsNotNone(route)
        self.assertEqual(route["provider"], "zai")
        self.assertEqual(route["model"], "glm-5.1")

    def test_agent_override_can_disable_provider(self):
        config = {
            **CONFIG,
            "workspace_hints": {"ops": ["orchestration"]},
            "subscription_profile": {
                "version": "1.0.0",
                "global": {
                    "openai-codex": {"enabled": True, "tierId": "plus"},
                    "zai": {"enabled": True, "tierId": "max"},
                    "moonshot": {"enabled": True, "tierId": "moderato"},
                },
                "agentOverrides": {"ops": {"zai": {"enabled": False, "tierId": "max"}}},
            },
        }
        route = ZeroAPIRouter(config).resolve(
            "coordinate this workflow",
            current_model="openai-codex/gpt-5.4",
            agent_id="ops",
        )
        self.assertNotEqual(route["provider"], "zai")

    def test_disabled_providers_are_never_selected(self):
        config = {**CONFIG, "disabled_providers": ["zai"]}
        route = ZeroAPIRouter(config).resolve(
            "coordinate this workflow",
            current_model="openai-codex/gpt-5.4",
        )
        self.assertEqual(route["provider"], "kimi-for-coding")
        self.assertEqual(route["model"], "kimi-k2.5")

    def test_disabled_provider_env_is_honored(self):
        config = {**CONFIG, "disabled_providers": []}
        previous = os.environ.get("ZEROAPI_DISABLED_PROVIDERS")
        os.environ["ZEROAPI_DISABLED_PROVIDERS"] = "zai"
        try:
            route = ZeroAPIRouter(config).resolve(
                "coordinate this workflow",
                current_model="openai-codex/gpt-5.4",
            )
            self.assertEqual(route["provider"], "kimi-for-coding")
            self.assertEqual(route["model"], "kimi-k2.5")
        finally:
            if previous is None:
                os.environ.pop("ZEROAPI_DISABLED_PROVIDERS", None)
            else:
                os.environ["ZEROAPI_DISABLED_PROVIDERS"] = previous

    def test_maps_moonshot_to_hermes_kimi_provider(self):
        config = {
            **CONFIG,
            "subscription_profile": {
                "version": "1.0.0",
                "global": {
                    "openai-codex": {"enabled": False, "tierId": None},
                    "zai": {"enabled": False, "tierId": None},
                    "moonshot": {"enabled": True, "tierId": "moderato"},
                },
            },
        }
        route = ZeroAPIRouter(config).resolve(
            "coordinate this workflow",
            current_model="openai-codex/gpt-5.4",
        )
        self.assertEqual(route["provider"], "kimi-for-coding")
        self.assertEqual(route["model"], "kimi-k2.5")

    def test_inventory_falls_back_to_all_accounts_when_no_intended_use_matches(self):
        config = {
            **CONFIG,
            "subscription_profile": {"version": "1.0.0", "global": {}},
            "subscription_inventory": {
                "version": "1.0.0",
                "accounts": {
                    "zai-default": {
                        "provider": "zai",
                        "tierId": "max",
                        "usagePriority": 3,
                        "intendedUse": ["default"],
                    }
                },
            },
        }
        route = ZeroAPIRouter(config).resolve(
            "coordinate this workflow",
            current_model="openai-codex/gpt-5.4",
        )
        self.assertEqual(route["provider"], "zai")
        self.assertEqual(route["model"], "glm-5.1")

    def test_loads_config_from_explicit_path(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            import json

            json.dump(CONFIG, handle)
            path = handle.name
        try:
            loaded = load_config(path)
            self.assertEqual(loaded["version"], "test")
        finally:
            os.unlink(path)


class VisionCapabilityEscapeTest(unittest.TestCase):
    """Tests for the vision capability escape in the Hermes adapter.

    When a message has vision signals (keywords or image attachments) but the
    current model does not support vision, the router should override the
    default-category stay and route to a vision-capable model.
    """

    VISION_CONFIG = {
        **CONFIG,
        "default_model": "zai/glm-5.1",
        "models": {
            **CONFIG["models"],
            "openai-codex/gpt-5.5": {
                "context_window": 272000,
                "supports_vision": True,
                "speed_tps": 90,
                "ttft_seconds": 120,
                "benchmarks": {"intelligence": 60.2, "coding": 59.1, "terminalbench": 0.606, "tau2": 0.939},
            },
        },
        "routing_rules": {
            **CONFIG["routing_rules"],
            "default": {"primary": "openai-codex/gpt-5.5", "fallbacks": ["openai-codex/gpt-5.4", "zai/glm-5.1"]},
        },
    }

    def test_routes_screenshot_keyword_to_vision_model(self):
        route = ZeroAPIRouter(self.VISION_CONFIG).resolve(
            "what does this screenshot show",
            current_model="zai/glm-5.1",
        )
        self.assertIsNotNone(route)
        self.assertEqual(route["provider"], "openai-codex")
        self.assertEqual(route["model"], "gpt-5.5")
        self.assertIn("vision_capability_escape", route["reason"])

    def test_routes_image_attachment_flag_without_keywords(self):
        route = ZeroAPIRouter(self.VISION_CONFIG).resolve(
            "buna bi bak",
            current_model="zai/glm-5.1",
            has_image_attachment=True,
        )
        self.assertIsNotNone(route)
        self.assertEqual(route["model"], "gpt-5.5")
        self.assertIn("vision_capability_escape", route["reason"])

    def test_ranks_vision_candidates_across_subscribed_providers(self):
        config = {
            **self.VISION_CONFIG,
            "models": {
                **self.VISION_CONFIG["models"],
                "moonshot/kimi-k2.6": {
                    "context_window": 262144,
                    "supports_vision": True,
                    "speed_tps": 35,
                    "ttft_seconds": 1.4,
                    "benchmarks": {"intelligence": 59.4, "coding": 56.5, "gpqa": 0.91},
                },
            },
            "routing_rules": {
                **self.VISION_CONFIG["routing_rules"],
                "default": {"primary": "openai-codex/gpt-5.5", "fallbacks": ["zai/glm-5.1"]},
            },
            "subscription_profile": {
                "version": "1.0.0",
                "global": {
                    "openai-codex": {"enabled": True, "tierId": "plus"},
                    "zai": {"enabled": True, "tierId": "max"},
                    "moonshot": {"enabled": True, "tierId": "vivace"},
                },
            },
        }

        route = ZeroAPIRouter(config).resolve(
            "check this screenshot",
            current_model="zai/glm-5.1",
        )

        self.assertIsNotNone(route)
        self.assertEqual(route["provider"], "kimi-for-coding")
        self.assertEqual(route["model"], "kimi-k2.6")

    def test_routes_turkish_vision_keywords(self):
        for prompt in ("bu ss'e bak", "şu görseli yorumla", "fotoğrafta ne var", "ekran görüntüsünü incele"):
            route = ZeroAPIRouter(self.VISION_CONFIG).resolve(
                prompt,
                current_model="zai/glm-5.1",
            )
            self.assertIsNotNone(route)
            self.assertEqual(route["model"], "gpt-5.5")

    def test_does_not_treat_embedded_ss_as_screenshot(self):
        route = ZeroAPIRouter(self.VISION_CONFIG).resolve(
            "process listesini kontrol et",
            current_model="zai/glm-5.1",
        )
        self.assertIsNone(route)

    def test_no_escape_when_current_model_has_vision(self):
        route = ZeroAPIRouter(self.VISION_CONFIG).resolve(
            "what does this screenshot show",
            current_model="openai-codex/gpt-5.5",
        )
        self.assertIsNone(route)

    def test_no_escape_without_vision_signals(self):
        route = ZeroAPIRouter(self.VISION_CONFIG).resolve(
            "buna bi bak",
            current_model="zai/glm-5.1",
        )
        self.assertIsNone(route)

    def test_vision_escape_ignores_high_risk_diagnostics(self):
        route = ZeroAPIRouter(self.VISION_CONFIG).resolve(
            "deploy this screenshot to production",
            current_model="zai/glm-5.1",
        )
        self.assertIsNotNone(route)
        self.assertEqual(route["provider"], "openai-codex")
        self.assertEqual(route["model"], "gpt-5.5")

    def test_stays_when_no_vision_model_available(self):
        no_vision_config = {
            **CONFIG,
            "default_model": "zai/glm-5.1",
            "models": {
                "zai/glm-5.1": CONFIG["models"]["zai/glm-5.1"],
                "openai-codex/gpt-5.4": CONFIG["models"]["openai-codex/gpt-5.4"],
            },
        }
        route = ZeroAPIRouter(no_vision_config).resolve(
            "look at this image",
            current_model="zai/glm-5.1",
        )
        self.assertIsNone(route)


if __name__ == "__main__":
    unittest.main()
