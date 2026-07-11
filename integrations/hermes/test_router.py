import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from router import (
    HERMES_PROVIDER_MAP,
    ZeroAPIRouter,
    _allowed_by_subscriptions,
    _hermes_provider,
    _resolve_capacity,
    _valid_config,
    load_config,
)


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

    def test_maps_openclaw_2026_5_openai_model_ids_to_hermes_codex_provider(self):
        config = {
            **CONFIG,
            "default_model": "zai/glm-5.1",
            "models": {
                "openai/gpt-5.5": {
                    "context_window": 272000,
                    "supports_vision": True,
                    "speed_tps": 90,
                    "ttft_seconds": 120,
                    "benchmarks": {"intelligence": 60.2, "coding": 59.1, "terminalbench": 0.606},
                },
                "zai/glm-5.1": CONFIG["models"]["zai/glm-5.1"],
            },
            "routing_rules": {
                **CONFIG["routing_rules"],
                "code": {"primary": "openai/gpt-5.5", "fallbacks": ["zai/glm-5.1"]},
            },
            "subscription_profile": {
                "version": "1.0.0",
                "global": {
                    "openai-codex": {"enabled": True, "tierId": "pro"},
                    "zai": {"enabled": True, "tierId": "max"},
                },
            },
        }

        route = ZeroAPIRouter(config).resolve("implement this feature", current_model="zai/glm-5.1")
        self.assertIsNotNone(route)
        self.assertEqual(route["provider"], "openai-codex")
        self.assertEqual(route["model"], "gpt-5.5")

    def test_migrates_legacy_qwen_portal_config_in_memory(self):
        legacy = {
            **CONFIG,
            "subscription_catalog_version": "1.0.0",
            "default_model": "qwen/coder-model",
            "models": {
                "qwen/coder-model": {
                    "context_window": 1000000, "supports_vision": False,
                    "speed_tps": 10, "ttft_seconds": 1,
                    "benchmarks": {"intelligence": 50},
                },
            },
            "routing_rules": {
                "default": {"primary": "qwen-dashscope/coder-model", "fallbacks": ["qwen-cli/coder-model"]},
            },
            "subscription_profile": {
                "version": "1.0.0",
                "global": {"qwen": {"enabled": True, "tierId": "free"}},
            },
            "subscription_inventory": {
                "version": "1.0.0",
                "accounts": {"portal": {"provider": "qwen-portal", "tierId": "free"}},
            },
        }
        router = ZeroAPIRouter(legacy)
        self.assertEqual(router.config["default_model"], "qwen-oauth/coder-model")
        self.assertIn("qwen-oauth/coder-model", router.config["models"])
        self.assertIn("qwen-oauth", router.config["subscription_profile"]["global"])
        self.assertEqual(router.config["subscription_inventory"]["accounts"]["portal"]["provider"], "qwen-oauth")
        self.assertEqual(legacy["default_model"], "qwen/coder-model")

    def test_legacy_selection_collisions_prefer_explicit_qwen_oauth_in_both_orders(self):
        canonical = {"enabled": True, "tierId": "canonical-tier", "tag": "canonical"}
        alias = {"enabled": False, "tierId": "alias-tier", "tag": "alias"}
        preserved = {"enabled": True, "tierId": "pro", "tag": "preserved"}

        for label, collision_entries in (
            ("canonical-first", [("qwen-oauth", canonical), ("qwen", alias)]),
            ("alias-first", [("qwen", alias), ("qwen-oauth", canonical)]),
        ):
            with self.subTest(order=label):
                legacy = {
                    **CONFIG,
                    "subscription_catalog_version": "1.0.0",
                    "subscription_profile": {
                        "version": "1.0.0",
                        "global": dict([("openai", preserved), *collision_entries]),
                        "agentOverrides": {
                            "worker": dict([("zai", preserved), *collision_entries]),
                        },
                    },
                }
                untouched = copy.deepcopy(legacy)

                migrated = ZeroAPIRouter(legacy).config

                self.assertEqual(migrated["subscription_profile"]["global"], {
                    "openai": preserved,
                    "qwen-oauth": canonical,
                })
                self.assertEqual(migrated["subscription_profile"]["agentOverrides"]["worker"], {
                    "zai": preserved,
                    "qwen-oauth": canonical,
                })
                self.assertEqual(legacy, untouched)

    def test_migrates_legacy_qwen_portal_disabled_aliases_and_denies_route(self):
        legacy = {
            **CONFIG,
            "subscription_catalog_version": "1.0.0",
            "default_model": "qwen/coder-model",
            "disabled_providers": [
                " ZAI ", None, " qWeN ", "qwen-portal", "moonshot",
                "QWEN-DASHSCOPE", " qwen-cli ", "qwen-oauth", 17,
                {"provider": "qwen"}, "zai",
            ],
            "models": {
                "qwen/coder-model": {
                    "context_window": 1000000, "supports_vision": False,
                    "speed_tps": 10, "ttft_seconds": 1,
                    "benchmarks": {"intelligence": 50, "coding": 50},
                },
            },
            "routing_rules": {
                "code": {"primary": "qwen-dashscope/coder-model", "fallbacks": ["qwen-cli/coder-model"]},
                "default": {"primary": "qwen-portal/coder-model", "fallbacks": []},
            },
            "subscription_profile": {
                "version": "1.0.0",
                "global": {"qwen": {"enabled": True, "tierId": "free"}},
            },
            "subscription_inventory": {
                "version": "1.0.0",
                "accounts": {"portal": {"provider": "qwen-cli", "tierId": "free"}},
            },
        }
        untouched = copy.deepcopy(legacy)

        router = ZeroAPIRouter(legacy)

        self.assertEqual(router.config["disabled_providers"], ["zai", "qwen-oauth", "moonshot"])
        self.assertIsNone(router.resolve("implement this feature", current_model="qwen/coder-model"))
        self.assertEqual(legacy, untouched)

    def test_fresh_and_unversioned_qwen_disables_do_not_disable_portal(self):
        for label, version_fields in (
            ("fresh", {"subscription_catalog_version": "1.1.0"}),
            ("unversioned", {
                "subscription_profile": {"global": {
                    "qwen": {"enabled": True, "tierId": "free"},
                    "qwen-oauth": {"enabled": True, "tierId": "free"},
                }},
            }),
        ):
            with self.subTest(label=label):
                config = {
                    **CONFIG,
                    **version_fields,
                    "default_model": "qwen-oauth/coder-model",
                    "disabled_providers": ["qwen"],
                    "models": {
                        "qwen/coder-model": {
                            "context_window": 1000000, "supports_vision": False,
                            "speed_tps": 10, "ttft_seconds": 1,
                            "benchmarks": {"intelligence": 49, "coding": 49},
                        },
                        "qwen-oauth/coder-model": {
                            "context_window": 1000000, "supports_vision": False,
                            "speed_tps": 10, "ttft_seconds": 1,
                            "benchmarks": {"intelligence": 50, "coding": 50},
                        },
                    },
                    "routing_rules": {
                        "code": {"primary": "qwen-oauth/coder-model", "fallbacks": ["qwen/coder-model"]},
                        "default": {"primary": "qwen-oauth/coder-model", "fallbacks": []},
                    },
                    "subscription_profile": version_fields.get("subscription_profile", {
                        "version": version_fields.get("subscription_catalog_version"),
                        "global": {
                            "qwen": {"enabled": True, "tierId": "free"},
                            "qwen-oauth": {"enabled": True, "tierId": "free"},
                        },
                    }),
                }
                route = ZeroAPIRouter(config).resolve(
                    "implement this feature", current_model="qwen/coder-model",
                )
                assert route is not None
                self.assertEqual(route["provider"], "qwen-oauth")
                self.assertEqual(config["disabled_providers"], ["qwen"])

    def test_keeps_fresh_qwen_cloud_on_alibaba_coding_plan(self):
        fresh = {**CONFIG, "subscription_catalog_version": "1.1.0"}
        self.assertEqual(HERMES_PROVIDER_MAP["qwen"], "alibaba-coding-plan")
        router = ZeroAPIRouter(fresh)
        self.assertIs(router.config, fresh)

    def test_fresh_qwen_cloud_inventory_cannot_create_subscription_capacity(self):
        qwen_model = copy.deepcopy(CONFIG["models"]["zai/glm-5.1"])
        fresh = {
            **CONFIG,
            "subscription_catalog_version": "1.1.0",
            "default_model": "qwen/cloud-model",
            "models": {"qwen/cloud-model": qwen_model},
            "routing_rules": {
                "code": {"primary": "qwen/cloud-model", "fallbacks": []},
                "default": {"primary": "qwen/cloud-model", "fallbacks": []},
            },
            "subscription_profile": {"version": "1.1.0", "global": {}},
            "subscription_inventory": {"version": "1.1.0", "accounts": {
                "cloud": {"provider": "qwen", "enabled": True, "tierId": "free",
                          "authProfile": "must-not-leak", "usagePriority": 99},
            }},
        }
        router = ZeroAPIRouter(fresh)
        self.assertIsNone(_resolve_capacity(router.config, "qwen", "code", None))
        self.assertFalse(_allowed_by_subscriptions(router.config, "qwen/cloud-model", None))
        self.assertIsNone(router.resolve("implement this feature", current_model="openai/current"))

    def test_fresh_qwen_cloud_profile_only_is_rejected(self):
        fresh = {
            **CONFIG,
            "subscription_catalog_version": "1.1.0",
            "subscription_profile": {"version": "1.1.0", "global": {
                "qwen": {"enabled": True, "tierId": "free"},
            }},
        }
        self.assertIsNone(_resolve_capacity(fresh, "qwen", None, None))
        self.assertFalse(_allowed_by_subscriptions(fresh, "qwen/cloud-model", None))

    def test_mixed_inventory_routes_active_provider_without_qwen_provenance(self):
        mixed = {
            **CONFIG,
            "subscription_catalog_version": "1.1.0",
            "subscription_profile": {"version": "1.1.0", "global": {}},
            "subscription_inventory": {"version": "1.1.0", "accounts": {
                "cloud": {"provider": "qwen", "enabled": True, "tierId": "free",
                          "authProfile": "must-not-leak", "usagePriority": 99},
                "codex": {"provider": "openai-codex", "enabled": True, "tierId": "plus",
                          "authProfile": "codex-main", "usagePriority": 1},
            }},
        }
        self.assertIsNone(_resolve_capacity(mixed, "qwen", "code", None))
        active = _resolve_capacity(mixed, "openai-codex", "code", None)
        self.assertEqual(active["preferred_account_id"], "codex")
        self.assertEqual(active["preferred_auth_profile"], "codex-main")
        route = ZeroAPIRouter(mixed).resolve("implement this feature", current_model="zai/glm-5.1")
        self.assertIsNotNone(route)
        self.assertEqual(route["provider"], "openai-codex")

    def test_qwen_direct_mapping_remains_available_without_subscription_pool(self):
        qwen_model = copy.deepcopy(CONFIG["models"]["zai/glm-5.1"])
        direct = {
            **CONFIG,
            "default_model": "qwen/cloud-model",
            "models": {"qwen/cloud-model": qwen_model},
            "routing_rules": {"code": {"primary": "qwen/cloud-model", "fallbacks": []},
                              "default": {"primary": "qwen/cloud-model", "fallbacks": []}},
        }
        direct.pop("subscription_profile", None)
        self.assertTrue(_allowed_by_subscriptions(direct, "qwen/cloud-model", None))
        self.assertEqual(_hermes_provider("qwen", direct), "alibaba-coding-plan")

    def test_keeps_qwen_portal_and_cloud_provider_ids_separate(self):
        for provider in ("qwen-oauth", "qwen-portal", "qwen-cli"):
            self.assertEqual(HERMES_PROVIDER_MAP[provider], "qwen-oauth")
        for provider in ("qwen", "qwen-dashscope"):
            self.assertEqual(HERMES_PROVIDER_MAP[provider], "alibaba-coding-plan")

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

    def test_alias_equivalent_current_is_in_pool_and_routes_to_deterministic_target(self):
        config = copy.deepcopy(CONFIG)
        sol = copy.deepcopy(config["models"]["openai-codex/gpt-5.4"])
        luna = copy.deepcopy(sol)
        luna["benchmarks"]["coding"] = 99
        config["default_model"] = "openai/gpt-5.6-sol"
        config["models"] = {"openai/gpt-5.6-sol": sol, "openai/gpt-5.6-luna": luna}
        config["routing_rules"]["code"] = {
            "primary": "openai/gpt-5.6-luna", "fallbacks": ["openai/gpt-5.6-sol"],
        }
        route = ZeroAPIRouter(config).resolve(
            "implement this feature", current_model="openai-codex/gpt-5.6-sol",
        )
        self.assertIsNotNone(route)
        self.assertEqual((route["provider"], route["model"]), ("openai-codex", "gpt-5.6-luna"))

    def test_alias_equivalent_selected_model_does_not_redundantly_switch(self):
        config = copy.deepcopy(CONFIG)
        config["models"] = {"openai/gpt-5.4": config["models"]["openai-codex/gpt-5.4"]}
        config["routing_rules"]["code"] = {"primary": "openai/gpt-5.4", "fallbacks": []}
        self.assertIsNone(ZeroAPIRouter(config).resolve(
            "implement this feature", current_model="openai-codex/gpt-5.4",
        ))

    def test_non_openai_catalog_alias_uses_same_comparison_identity(self):
        config = copy.deepcopy(CONFIG)
        config["models"] = {"moonshot/synthetic-model": config["models"]["moonshot/kimi-k2.5"]}
        config["routing_rules"]["code"] = {"primary": "moonshot/synthetic-model", "fallbacks": []}
        self.assertIsNone(ZeroAPIRouter(config).resolve(
            "implement this feature", current_model="kimi/synthetic-model",
        ))

    def test_alias_collision_with_conflicting_capabilities_fails_closed_in_both_orders(self):
        blind = copy.deepcopy(CONFIG["models"]["openai-codex/gpt-5.4"])
        sighted = copy.deepcopy(blind)
        sighted["supports_vision"] = True
        for entries in (
            [("openai/gpt-collision", blind), ("openai-codex/gpt-collision", sighted)],
            [("openai-codex/gpt-collision", sighted), ("openai/gpt-collision", blind)],
        ):
            with self.subTest(order=[key for key, _ in entries]):
                config = copy.deepcopy(CONFIG)
                config["models"] = dict([*entries, ("moonshot/kimi-k2.5", CONFIG["models"]["moonshot/kimi-k2.5"])])
                config["default_model"] = entries[0][0]
                config["routing_rules"]["default"] = {"primary": "moonshot/kimi-k2.5", "fallbacks": []}
                self.assertIsNone(ZeroAPIRouter(config).resolve(
                    "inspect this screenshot", current_model="openai/gpt-collision",
                ))

    def test_identical_alias_duplicate_is_rejected_not_silently_deduplicated(self):
        # Duplicate canonical identities are invalid even when capability records
        # currently match; rejecting them prevents later edits becoming ambiguous.
        capabilities = copy.deepcopy(CONFIG["models"]["openai-codex/gpt-5.4"])
        config = copy.deepcopy(CONFIG)
        config["models"] = {
            "openai/gpt-collision": capabilities,
            "openai-codex/gpt-collision": copy.deepcopy(capabilities),
        }
        config["routing_rules"]["code"] = {"primary": "openai/gpt-collision", "fallbacks": []}
        self.assertIsNone(ZeroAPIRouter(config).resolve(
            "implement this feature", current_model="openai/gpt-collision",
        ))

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

    def test_maps_supergrok_subscription_to_hermes_xai_oauth_provider(self):
        config = {
            **CONFIG,
            "models": {
                **CONFIG["models"],
                "xai-oauth/grok-4.3": {
                    "context_window": 1000000,
                    "supports_vision": True,
                    "speed_tps": 114,
                    "ttft_seconds": 6.6,
                    "benchmarks": {"intelligence": 53.2, "coding": 41.0, "tau2": 0.976, "ifbench": 0.813},
                },
            },
            "routing_rules": {
                **CONFIG["routing_rules"],
                "orchestration": {"primary": "xai-oauth/grok-4.3", "fallbacks": ["zai/glm-5.1"]},
            },
            "subscription_profile": {
                "version": "1.0.0",
                "global": {
                    "zai": {"enabled": False, "tierId": "max"},
                    "xai-oauth": {"enabled": True, "tierId": "supergrok"},
                },
            },
        }
        route = ZeroAPIRouter(config).resolve(
            "coordinate this workflow",
            current_model="zai/glm-5.1",
        )

        self.assertEqual(route["provider"], "xai-oauth")
        self.assertEqual(route["model"], "grok-4.3")

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
            json.dump(CONFIG, handle)
            path = handle.name
        try:
            loaded = load_config(path)
            self.assertEqual(loaded["version"], "test")
        finally:
            os.unlink(path)

    def test_malformed_nested_configs_fail_closed_without_rewriting(self):
        malformed_cases = (
            ("model capability non-object", {"models": {"qwen/model": None}}),
            ("routing rule non-object", {"routing_rules": {"default": None}}),
            ("primary non-string", {"routing_rules": {"default": {"primary": 17, "fallbacks": []}}}),
            ("fallbacks non-array", {"routing_rules": {"default": {"primary": "qwen/model", "fallbacks": {}}}}),
            ("fallback member non-string", {"routing_rules": {"default": {"primary": "qwen/model", "fallbacks": [None]}}}),
            ("profile non-object", {"subscription_profile": []}),
            ("profile missing global", {"subscription_profile": {"version": "1.0.0"}}),
            ("profile global non-object", {"subscription_profile": {"version": "1.0.0", "global": []}}),
            ("agentOverrides non-object", {"subscription_profile": {"version": "1.0.0", "global": {}, "agentOverrides": []}}),
            ("per-agent selections non-object", {"subscription_profile": {"version": "1.0.0", "global": {}, "agentOverrides": {"worker": None}}}),
            ("inventory non-object", {"subscription_inventory": []}),
            ("inventory missing accounts", {"subscription_inventory": {"version": "1.0.0"}}),
            ("accounts non-object", {"subscription_inventory": {"version": "1.0.0", "accounts": None}}),
            ("account non-object", {"subscription_inventory": {"version": "1.0.0", "accounts": {"portal": []}}}),
            ("account provider non-string", {"subscription_inventory": {"version": "1.0.0", "accounts": {"portal": {"provider": {"id": "qwen"}}}}}),
            ("disabled providers non-array", {"disabled_providers": "qwen"}),
            ("disabled provider non-string", {"disabled_providers": ["qwen", None]}),
            *((f"global selection {value!r}", {"subscription_profile": {
                "version": "1.0.0", "global": {"qwen": value},
            }}) for value in (None, [], "selection", 17, True)),
            *((f"override selection {value!r}", {"subscription_profile": {
                "version": "1.0.0", "global": {},
                "agentOverrides": {"worker": {"qwen": value}},
            }}) for value in (None, [], "selection", 17, True)),
        )
        for label, replacement in malformed_cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory(prefix="zeroapi-malformed-") as temp_dir:
                path = Path(temp_dir) / "zeroapi-config.json"
                malformed = {
                    **CONFIG,
                    "subscription_catalog_version": "1.0.0",
                    **replacement,
                }
                original = json.dumps(malformed, separators=(",", ":")).encode()
                path.write_bytes(original)

                self.assertIsNone(load_config(str(path)))
                self.assertEqual(path.read_bytes(), original)

    def test_validator_is_total_for_arbitrary_json_values(self):
        for value in (None, True, 17, "config", [], [None], {"version": "test"}):
            with self.subTest(value=value):
                self.assertFalse(_valid_config(value))

    def test_default_candidates_continue_after_malformed_legacy_config(self):
        with tempfile.TemporaryDirectory(prefix="zeroapi-home-") as temp_dir:
            home = Path(temp_dir)
            hermes_path = home / ".hermes" / "zeroapi-config.json"
            openclaw_path = home / ".openclaw" / "zeroapi-config.json"
            hermes_path.parent.mkdir()
            openclaw_path.parent.mkdir()
            malformed = {
                **CONFIG,
                "subscription_catalog_version": "1.0.0",
                "subscription_inventory": {"version": "1.0.0"},
            }
            malformed_bytes = json.dumps(malformed).encode()
            hermes_path.write_bytes(malformed_bytes)
            later = {**CONFIG, "version": "later-valid"}
            openclaw_path.write_text(json.dumps(later), encoding="utf-8")

            with patch.dict(os.environ, {"HOME": str(home), "HERMES_HOME": str(home / ".hermes")}, clear=False):
                loaded = load_config()

            self.assertIsNotNone(loaded)
            assert loaded is not None
            self.assertEqual(loaded["version"], "later-valid")
            self.assertEqual(hermes_path.read_bytes(), malformed_bytes)

    def test_validator_and_migration_programmer_errors_propagate(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(CONFIG, handle)
            path = handle.name
        try:
            for target in ("router._valid_config", "router._migrate_legacy_config"):
                for error_type in (
                    TypeError, ValueError, KeyError, AttributeError, RuntimeError,
                    KeyboardInterrupt, SystemExit, MemoryError,
                ):
                    with self.subTest(target=target, error=error_type.__name__):
                        with patch(target, side_effect=error_type("sentinel")):
                            with self.assertRaises(error_type):
                                load_config(path)
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
