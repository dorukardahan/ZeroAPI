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

    def test_skips_high_risk_messages(self):
        route = ZeroAPIRouter(CONFIG).resolve("deploy this to production", current_model="zai/glm-5.1")
        self.assertIsNone(route)

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

    def test_risk_levels_can_hold_a_category(self):
        config = {**CONFIG, "risk_levels": {"orchestration": "high"}}
        route = ZeroAPIRouter(config).resolve(
            "coordinate this workflow",
            current_model="openai-codex/gpt-5.4",
        )
        self.assertIsNone(route)

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


if __name__ == "__main__":
    unittest.main()
