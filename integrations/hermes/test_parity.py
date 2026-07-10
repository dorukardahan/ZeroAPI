"""Parity regression tests: pin the Hermes Python router to the canonical OpenClaw
TypeScript plugin behavior.

Each scenario was verified head-to-head against `resolveRoutingDecision` (TS). The
expected outcome encoded here is the TS-canonical result. These tests guard the five
divergences fixed for TS<->Python parity:

- D1: modifier account bonus (+0.15) for intendedUse-matched accounts (router.ts:163-191)
- D2: fast `ttft_missing` enforcement (filter.ts:24-26)
- D3: default-rule fallback when a category has no rule (selector.ts:9 / router.ts:205)
- D4: continuation trailing-whitespace strip uses \\s, not literal backslash/'s' (decision.ts:163)
- D5: catalog provider absent from subscription_profile.global is disabled (profile.ts:69)
- S1: high-risk keywords are diagnostic only and do NOT block routing (CHANGELOG 3.8.21)
"""
import copy
import json
import subprocess
import unittest
from pathlib import Path

from router import ZeroAPIRouter


def _m(ctx, vision, tps, ttft, **bm):
    return {"context_window": ctx, "supports_vision": vision, "speed_tps": tps, "ttft_seconds": ttft, "benchmarks": bm}


ZAI = _m(200000, False, 62, 0.9, intelligence=51, coding=43, terminalbench=0.43, scicode=0.40,
         tau2=0.97, ifbench=0.76, gpqa=0.50, hle=0.30, lcr=0.40, math=0.60, aime_25=0.50)
OPENAI = _m(272000, False, 72, 1.5, intelligence=57, coding=57, terminalbench=0.58, scicode=0.50,
            tau2=0.87, ifbench=0.73, gpqa=0.60, hle=0.40, lcr=0.50, math=0.70, aime_25=0.60)
KIMI_NO_TTFT = _m(262144, True, 32, None, intelligence=47, coding=40, terminalbench=0.35, scicode=0.30,
                  tau2=0.95, ifbench=0.70, gpqa=0.45, math=0.55)
KIMI_STRONG = _m(262144, False, 32, 2.4, intelligence=55, coding=60, terminalbench=0.62, scicode=0.55,
                 tau2=0.95, ifbench=0.70, gpqa=0.45, math=0.55)
TIE = dict(intelligence=51, coding=43, terminalbench=0.43, scicode=0.40)
ZAI_TIE = _m(200000, False, 62, 0.9, **TIE)
MINIMAX_TIE = _m(200000, False, 60, 0.9, **TIE)

# Regression fixtures (R1/R2/R3) — found by the adversarial parity-breaker, not the
# original 6 scenarios. Tuned so zai stays inside the research frontier for R2.
R_ZAI = _m(200000, False, 62, 0.9, intelligence=51, coding=43, terminalbench=0.43, scicode=0.40,
           tau2=0.977, ifbench=0.76, gpqa=0.87, hle=0.28, lcr=0.40, math=0.60, aime_25=0.50)
R_OPENAI = _m(272000, False, 72, 1.5, intelligence=57, coding=57, terminalbench=0.58, scicode=0.50,
              tau2=0.871, ifbench=0.73, gpqa=0.92, hle=0.42, lcr=0.50, math=0.70, aime_25=0.60)
R_KIMI = _m(262144, True, 32, 2.4, intelligence=47, coding=40, terminalbench=0.35, tau2=0.95, ifbench=0.70, gpqa=0.45)
R_XAI = _m(256000, True, 50, 1.0, intelligence=52, coding=45, terminalbench=0.45, gpqa=0.6)

KW = {
    "code": ["implement", "function", "refactor", "fix", "debug"],
    "research": ["research", "analyze", "investigate"],
    "math": ["solve", "equation", "calculate"],
    "fast": ["quick", "format", "convert"],
}
HIGH_RISK = ["deploy", "delete", "drop", "rm", "production", "credentials", "secret", "password"]


def _base(models, rules, **extra):
    cfg = {
        "version": "parity-test", "generated": "2026-05-30T00:00:00Z", "benchmarks_date": "2026-05-30",
        "routing_mode": "balanced", "default_model": extra.pop("default_model", "zai/glm-5.1"),
        "external_model_policy": "stay", "models": models, "routing_rules": rules,
        "workspace_hints": {}, "keywords": KW, "high_risk_keywords": HIGH_RISK, "fast_ttft_max_seconds": 5,
    }
    cfg.update(extra)
    return cfg


PROFILE_ALL = {"version": "1.0.0", "global": {
    "openai-codex": {"enabled": True, "tierId": "pro"},
    "zai": {"enabled": True, "tierId": "max"}}}


class HermesParityTest(unittest.TestCase):
    def test_P1_legacy_qwen_disabled_provider_matches_typescript(self):
        cfg = _base(
            {"qwen/coder-model": _m(1000000, False, 10, 1, intelligence=50, coding=50)},
            {"code": {"primary": "qwen-dashscope/coder-model", "fallbacks": ["qwen-cli/coder-model"]},
             "default": {"primary": "qwen-portal/coder-model", "fallbacks": []}},
            subscription_catalog_version="1.0.0", default_model="qwen/coder-model",
            disabled_providers=[
                " ZAI ", None, " qWeN ", "qwen-portal", "moonshot", "QWEN-DASHSCOPE",
                " qwen-cli ", "qwen-oauth", 17, {"provider": "qwen"}, "zai",
            ],
            subscription_profile={"version": "1.0.0", "global": {
                "qwen": {"enabled": True, "tierId": "free"}}},
            subscription_inventory={"version": "1.0.0", "accounts": {
                "portal": {"provider": "qwen-cli", "tierId": "free"}}})
        untouched = copy.deepcopy(cfg)
        python_router = ZeroAPIRouter(cfg)
        python_route = python_router.resolve("implement this feature", current_model="qwen-oauth/coder-model")

        repo_root = Path(__file__).resolve().parents[2]
        tsx = repo_root / "node_modules" / ".bin" / "tsx"
        script = """
import { migrateLegacyCatalogConfig } from './plugin/config.ts';
import { resolveRoutingDecision } from './plugin/decision.ts';
import { readFileSync } from 'node:fs';
const input = readFileSync(0, 'utf8');
const config = migrateLegacyCatalogConfig(JSON.parse(input));
const decision = resolveRoutingDecision(config, {
  prompt: 'implement this feature', currentModel: 'qwen-oauth/coder-model', includeDiagnostics: true,
});
process.stdout.write(JSON.stringify({
  disabled: config.disabled_providers,
  allowed: decision.selectedModel !== null,
  rejected: decision.subscriptionRejected.includes('qwen-oauth/coder-model'),
}));
"""
        completed = subprocess.run(
            [str(tsx), "--eval", script], cwd=repo_root, input=json.dumps(cfg), text=True,
            capture_output=True, check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        typescript = json.loads(completed.stdout)

        self.assertEqual(python_router.config["disabled_providers"], typescript["disabled"])
        self.assertEqual(python_route is not None, typescript["allowed"])
        self.assertTrue(typescript["rejected"])
        self.assertEqual(cfg, untouched)

    def test_S1_high_risk_still_routes(self):
        cfg = _base(
            {"zai/glm-5.1": ZAI, "openai-codex/gpt-5.4": OPENAI},
            {"code": {"primary": "openai-codex/gpt-5.4", "fallbacks": ["zai/glm-5.1"]},
             "default": {"primary": "openai-codex/gpt-5.4", "fallbacks": ["zai/glm-5.1"]}},
            subscription_profile=PROFILE_ALL)
        route = ZeroAPIRouter(cfg).resolve("deploy this refactor to production", current_model="zai/glm-5.1")
        self.assertIsNotNone(route, "high-risk must NOT block routing (diagnostic only)")
        self.assertEqual(route["model"], "gpt-5.4")
        self.assertIn("high_risk_keyword:deploy", route["reason"])

    def test_D3_default_rule_fallback(self):
        cfg = _base(
            {"zai/glm-5.1": ZAI, "openai-codex/gpt-5.4": OPENAI},
            {"code": {"primary": "openai-codex/gpt-5.4", "fallbacks": ["zai/glm-5.1"]},
             "default": {"primary": "openai-codex/gpt-5.4", "fallbacks": ["zai/glm-5.1"]}},
            subscription_profile=PROFILE_ALL)
        route = ZeroAPIRouter(cfg).resolve("solve this equation", current_model="zai/glm-5.1")
        self.assertIsNotNone(route, "math has no rule -> must fall back to default rule")
        self.assertEqual(route["model"], "gpt-5.4")
        self.assertEqual(route["category"], "math")

    def test_D4_continuation_regex_does_not_strip_s(self):
        cfg = _base(
            {"zai/glm-5.1": ZAI, "openai-codex/gpt-5.4": OPENAI},
            {"code": {"primary": "openai-codex/gpt-5.4", "fallbacks": ["zai/glm-5.1"]},
             "default": {"primary": "openai-codex/gpt-5.4", "fallbacks": ["zai/glm-5.1"]}},
            subscription_profile=PROFILE_ALL)
        route = ZeroAPIRouter(cfg).resolve("continues", current_model="zai/glm-5.1", previous_category="code")
        self.assertIsNone(route, "'continues' must NOT be treated as the continuation keyword 'continue'")

    def test_D5_unsubscribed_provider_is_disabled(self):
        cfg = _base(
            {"zai/glm-5.1": ZAI, "moonshot/kimi-k2.5": KIMI_STRONG},
            {"code": {"primary": "moonshot/kimi-k2.5", "fallbacks": ["zai/glm-5.1"]},
             "default": {"primary": "zai/glm-5.1", "fallbacks": []}},
            subscription_profile={"version": "1.0.0", "global": {"zai": {"enabled": True, "tierId": "lite"}}})
        route = ZeroAPIRouter(cfg).resolve("refactor the auth module", current_model="zai/glm-5.1")
        self.assertIsNone(route, "moonshot is not in subscription_profile.global -> must be filtered out")

    def test_D2_fast_drops_ttft_missing_model(self):
        cfg = _base(
            {"zai/glm-5.1": ZAI, "moonshot/kimi-k2.5": KIMI_NO_TTFT},
            {"fast": {"primary": "moonshot/kimi-k2.5", "fallbacks": []},
             "default": {"primary": "zai/glm-5.1", "fallbacks": []}},
            subscription_profile={"version": "1.0.0", "global": {
                "zai": {"enabled": True, "tierId": "lite"},
                "moonshot": {"enabled": True, "tierId": "moderato"}}})
        route = ZeroAPIRouter(cfg).resolve("quick format this list", current_model="zai/glm-5.1")
        self.assertIsNone(route, "fast task must drop a model with no measured TTFT")

    def test_D1_modifier_account_bonus_changes_winner(self):
        cfg = _base(
            {"zai/glm-5.1": ZAI_TIE, "minimax-portal/m2.7": MINIMAX_TIE},
            {"code": {"primary": "zai/glm-5.1", "fallbacks": ["minimax-portal/m2.7"]},
             "default": {"primary": "zai/glm-5.1", "fallbacks": ["minimax-portal/m2.7"]}},
            routing_modifier="coding-aware", default_model="minimax-portal/m2.7",
            subscription_inventory={"version": "1.0.0", "accounts": {
                "zai-main": {"provider": "zai", "tierId": "lite", "intendedUse": ["code"]},
                "mm-main": {"provider": "minimax-portal", "tierId": "starter", "usagePriority": 2.5, "intendedUse": []}}})
        route = ZeroAPIRouter(cfg).resolve("refactor this function", current_model="minimax-portal/m2.7")
        self.assertIsNotNone(route, "coding-aware +0.15 bonus must lift the intendedUse=code account")
        self.assertEqual(route["model"], "glm-5.1")

    def test_R1_agent_override_tier_not_inherited_from_global(self):
        # Agent override {enabled: True} with NO tierId must NOT inherit the global tierId
        # (TS profile.ts forces tierId->null when an override exists -> weight 0 -> filtered).
        cfg = _base(
            {"zai/glm-5.1": R_ZAI, "openai-codex/gpt-5.4": R_OPENAI},
            {"orchestration": {"primary": "zai/glm-5.1", "fallbacks": ["openai-codex/gpt-5.4"]},
             "default": {"primary": "zai/glm-5.1", "fallbacks": ["openai-codex/gpt-5.4"]}},
            default_model="openai-codex/gpt-5.4",
            subscription_profile={"version": "1.0.0",
                "global": {"zai": {"enabled": True, "tierId": "max"}, "openai-codex": {"enabled": True, "tierId": "pro"}},
                "agentOverrides": {"codex": {"zai": {"enabled": True}}}})
        route = ZeroAPIRouter(cfg).resolve("coordinate this workflow", agent_id="codex", current_model="openai-codex/gpt-5.4")
        self.assertIsNone(route, "zai override has no tierId -> weight 0 -> filtered -> stay on openai")

    def test_R2_cross_pair_modifier_uses_default_sort(self):
        # coding-aware modifier on a RESEARCH prompt is a cross-pair: it must use the default
        # pressure-first sort (TS), not the strength-first coding/research sort.
        cfg = _base(
            {"zai/glm-5.1": R_ZAI, "openai-codex/gpt-5.4": R_OPENAI, "moonshot/kimi-k2.5": R_KIMI},
            {"research": {"primary": "zai/glm-5.1", "fallbacks": ["openai-codex/gpt-5.4"]},
             "default": {"primary": "zai/glm-5.1", "fallbacks": []}},
            routing_modifier="coding-aware",
            subscription_profile={"version": "1.0.0", "global": {
                "zai": {"enabled": True, "tierId": "max"}, "openai-codex": {"enabled": True, "tierId": "pro"}}})
        route = ZeroAPIRouter(cfg).resolve("research and analyze this", current_model="moonshot/kimi-k2.5")
        self.assertIsNotNone(route)
        self.assertEqual(route["model"], "glm-5.1", "pressure-first sort must win zai for a research+coding-aware cross-pair")

    def test_R3_xai_provider_is_subscription_gated(self):
        # A bare xai/ model must be subscription-gated like TS (catalog providerId 'xai'),
        # not treated as an external-passthrough provider in the vision-escape path.
        cfg = _base(
            {"zai/glm-5.1": R_ZAI, "xai/grok-4.3": R_XAI},
            {"code": {"primary": "zai/glm-5.1", "fallbacks": []},
             "default": {"primary": "zai/glm-5.1", "fallbacks": []}},
            subscription_profile={"version": "1.0.0", "global": {"zai": {"enabled": True, "tierId": "max"}}})
        route = ZeroAPIRouter(cfg).resolve("bu resme bak", current_model="zai/glm-5.1", has_image_attachment=True)
        self.assertIsNone(route, "xai is not enabled in the profile -> must be filtered, not passed through")


if __name__ == "__main__":
    unittest.main()
