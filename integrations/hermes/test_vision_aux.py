import json
import tempfile
import unittest
from pathlib import Path

from test_router import CONFIG
from vision_aux import configure_auxiliary_vision, resolve_auxiliary_vision_route


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


class HermesVisionAuxiliaryConfigTest(unittest.TestCase):
    def test_resolves_vision_auxiliary_from_zeroapi_policy(self):
        route = resolve_auxiliary_vision_route(
            VISION_CONFIG,
            current_provider="zai",
            current_model="glm-5.1",
        )

        self.assertEqual(route["provider"], "openai-codex")
        self.assertEqual(route["model"], "gpt-5.5")
        self.assertIn("vision_capability_escape", route["reason"])

    def test_resolves_best_subscribed_vision_auxiliary_not_just_openai(self):
        config = {
            **VISION_CONFIG,
            "models": {
                **VISION_CONFIG["models"],
                "moonshot/kimi-k2.6": {
                    "context_window": 262144,
                    "supports_vision": True,
                    "speed_tps": 35,
                    "ttft_seconds": 1.4,
                    "benchmarks": {"intelligence": 59.4, "coding": 56.5, "gpqa": 0.91},
                },
            },
            "routing_rules": {
                **VISION_CONFIG["routing_rules"],
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

        route = resolve_auxiliary_vision_route(
            config,
            current_provider="zai",
            current_model="glm-5.1",
        )

        self.assertEqual(route["provider"], "kimi-for-coding")
        self.assertEqual(route["model"], "kimi-k2.6")

    def test_updates_existing_auxiliary_vision_auto_section(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hermes_config = root / "config.yaml"
            zeroapi_config = root / "zeroapi-config.json"
            hermes_config.write_text(
                "\n".join([
                    "model:",
                    "  provider: zai",
                    "  default: glm-5.1",
                    "auxiliary:",
                    "  vision:",
                    "    provider: auto",
                    "    model: ''",
                    "    timeout: 120",
                    "memory:",
                    "  provider: noldomem",
                    "",
                ]),
                encoding="utf-8",
            )
            zeroapi_config.write_text(json.dumps(VISION_CONFIG), encoding="utf-8")

            result = configure_auxiliary_vision(hermes_config, zeroapi_config_path=zeroapi_config)
            text = hermes_config.read_text(encoding="utf-8")

            self.assertTrue(result["changed"])
            self.assertIn("provider: openai-codex", text)
            self.assertIn("model: gpt-5.5", text)
            self.assertIn("memory:\n  provider: noldomem", text)

    def test_appends_auxiliary_section_when_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hermes_config = root / "config.yaml"
            zeroapi_config = root / "zeroapi-config.json"
            hermes_config.write_text(
                "\n".join([
                    "model:",
                    "  provider: zai",
                    "  default: glm-5.1",
                    "plugins:",
                    "  enabled:",
                    "  - zeroapi-router",
                    "",
                ]),
                encoding="utf-8",
            )
            zeroapi_config.write_text(json.dumps(VISION_CONFIG), encoding="utf-8")

            result = configure_auxiliary_vision(hermes_config, zeroapi_config_path=zeroapi_config)
            text = hermes_config.read_text(encoding="utf-8")

            self.assertTrue(result["changed"])
            self.assertTrue(text.endswith("    timeout: 120\n"))
            self.assertIn("auxiliary:\n  vision:\n    provider: openai-codex\n    model: gpt-5.5", text)

    def test_no_change_when_no_vision_route_is_needed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hermes_config = root / "config.yaml"
            zeroapi_config = root / "zeroapi-config.json"
            hermes_config.write_text(
                "\n".join([
                    "model:",
                    "  provider: openai-codex",
                    "  default: gpt-5.5",
                    "",
                ]),
                encoding="utf-8",
            )
            zeroapi_config.write_text(json.dumps(VISION_CONFIG), encoding="utf-8")

            result = configure_auxiliary_vision(hermes_config, zeroapi_config_path=zeroapi_config)

            self.assertFalse(result["changed"])
            self.assertEqual(result["reason"], "no_auxiliary_override_needed")


if __name__ == "__main__":
    unittest.main()
