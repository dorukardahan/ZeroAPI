"""Tests for ZeroAPI live quota normalization and policy (Python parity)."""

import math
import unittest

from quota import (
    normalize_window,
    validate_snapshot,
    normalize_snapshot,
    compute_quota_factor,
    compute_live_pressure,
    applicable_windows,
    account_headroom,
)


class TestNormalizeWindow(unittest.TestCase):

    def test_normalizes_tokens_limit_with_percentage(self):
        w = normalize_window("TOKENS_LIMIT", remaining_ratio=0.9888, window_seconds=5 * 3600)
        self.assertAlmostEqual(w["remainingRatio"], 0.9888)
        self.assertEqual(w["appliesTo"], "inference")

    def test_derives_ratio_from_usage_limit(self):
        w = normalize_window("PRIMARY", used=400, limit=800)
        self.assertAlmostEqual(w["remainingRatio"], 0.5)

    def test_rejects_nan(self):
        with self.assertRaises(ValueError):
            normalize_window("X", remaining_ratio=float("nan"))

    def test_rejects_infinity(self):
        with self.assertRaises(ValueError):
            normalize_window("X", remaining_ratio=float("inf"))

    def test_rejects_boolean(self):
        with self.assertRaises(TypeError):
            normalize_window("X", remaining_ratio=True)

    def test_rejects_over_one(self):
        with self.assertRaises(ValueError):
            normalize_window("X", remaining_ratio=1.01)

    def test_rejects_negative(self):
        with self.assertRaises(ValueError):
            normalize_window("X", remaining_ratio=-0.01)

    def test_model_scoped_requires_model_ids(self):
        with self.assertRaises(ValueError):
            normalize_window("M", applies_to="model", remaining_ratio=0.5)

    def test_non_model_rejects_model_ids(self):
        with self.assertRaises(ValueError):
            normalize_window("M", applies_to="inference", model_ids=["m1"], remaining_ratio=0.5)


class TestValidateSnapshot(unittest.TestCase):

    def _valid(self):
        return {
            "provider": "zai", "account": "zai#1", "status": "fresh",
            "windows": [{"id": "P", "kind": "tokens_limit", "appliesTo": "inference", "modelIds": [], "remainingRatio": 0.86}],
            "fetchedAt": "2026-07-24T17:00:00Z",
        }

    def test_accepts_valid_fresh(self):
        validate_snapshot(self._valid())

    def test_rejects_no_windows_fresh(self):
        with self.assertRaises(ValueError):
            validate_snapshot({**self._valid(), "windows": []})

    def test_rejects_stale_not_diagnostic(self):
        with self.assertRaises(ValueError):
            validate_snapshot({**self._valid(), "status": "stale"}, diagnostics_only=False)

    def test_accepts_stale_diagnostic(self):
        validate_snapshot({**self._valid(), "status": "stale"}, diagnostics_only=True)

    def test_rejects_provider_mismatch(self):
        with self.assertRaises(ValueError):
            validate_snapshot(self._valid(), expected_provider="openai")


class TestNormalizeSnapshot(unittest.TestCase):

    def test_zai_payload(self):
        snap = normalize_snapshot({
            "provider": "zai", "account": "zai#1",
            "raw": {"limits": [
                {"type": "TOKENS_LIMIT", "percentage": 0.9888, "next_reset_time": "2026-07-24T20:23:52Z"},
                {"type": "TOKENS_LIMIT", "percentage": 0.86, "next_reset_time": "2026-07-26T20:23:52Z"},
            ]},
            "fetchedAt": "2026-07-24T17:00:00Z",
        })
        self.assertEqual(snap["status"], "fresh")
        self.assertEqual(len(snap["windows"]), 2)
        self.assertAlmostEqual(snap["windows"][0]["remainingRatio"], 0.9888)

    def test_codex_payload(self):
        snap = normalize_snapshot({
            "provider": "openai-codex", "account": "openai#1",
            "raw": {"rate_limits": [
                {"label": "primary", "window_minutes": 300, "used_percent": 47},
                {"label": "secondary", "window_minutes": 10080, "used_percent": 12},
            ]},
            "fetchedAt": "2026-07-24T17:00:00Z",
        })
        self.assertEqual(len(snap["windows"]), 2)
        self.assertAlmostEqual(snap["windows"][0]["remainingRatio"], 0.53, places=1)

    def test_xai_payload(self):
        snap = normalize_snapshot({
            "provider": "xai", "account": "xai#1",
            "raw": {"remaining_percent": 100},
            "fetchedAt": "2026-07-24T17:00:00Z",
        })
        self.assertEqual(len(snap["windows"]), 1)
        self.assertEqual(snap["windows"][0]["remainingRatio"], 1.0)

    def test_unsupported_payload(self):
        snap = normalize_snapshot({
            "provider": "qwen-oauth", "account": "qwen#1",
            "raw": {},
            "fetchedAt": "2026-07-24T17:00:00Z",
        })
        self.assertEqual(snap["status"], "unsupported")

    def test_strips_secret_fields(self):
        snap = normalize_snapshot({
            "provider": "zai", "account": "zai#1",
            "raw": {
                "limits": [{"type": "T", "percentage": 0.9888}],
                "account_email": "secret@example.com",
                "access_token": "sk-secret",
            },
            "fetchedAt": "2026-07-24T17:00:00Z",
        })
        import json
        serialized = json.dumps(snap)
        self.assertNotIn("secret@example.com", serialized)
        self.assertNotIn("sk-secret", serialized)


class TestQuotaPolicy(unittest.TestCase):

    def test_compute_quota_factor(self):
        snap = {
            "provider": "zai", "account": "zai#1", "status": "fresh",
            "windows": [
                {"id": "5h", "kind": "tokens_limit", "appliesTo": "inference", "modelIds": [], "remainingRatio": 0.9888},
                {"id": "1w", "kind": "tokens_limit", "appliesTo": "inference", "modelIds": [], "remainingRatio": 0.86},
            ],
            "fetchedAt": "2026-07-24T17:00:00Z",
        }
        self.assertAlmostEqual(compute_quota_factor(snap, "zai/glm-5.2"), math.sqrt(0.86), places=4)

    def test_stale_returns_none(self):
        snap = {"provider": "zai", "account": "zai#1", "status": "stale", "windows": [], "fetchedAt": "2026-07-24T17:00:00Z"}
        self.assertIsNone(compute_quota_factor(snap, "zai/glm-5.2"))

    def test_depleted_returns_zero(self):
        snap = {
            "provider": "zai", "account": "zai#1", "status": "fresh",
            "windows": [{"id": "5h", "kind": "tokens_limit", "appliesTo": "inference", "modelIds": [], "remainingRatio": 0.0}],
            "fetchedAt": "2026-07-24T17:00:00Z",
        }
        self.assertEqual(compute_quota_factor(snap, "zai/glm-5.2"), 0.0)

    def test_mcp_excluded_from_inference(self):
        snap = {
            "provider": "zai", "account": "zai#1", "status": "fresh",
            "windows": [
                {"id": "MCP", "kind": "time_limit", "appliesTo": "mcp", "modelIds": [], "remainingRatio": 0.0},
                {"id": "5h", "kind": "tokens_limit", "appliesTo": "inference", "modelIds": [], "remainingRatio": 0.80},
            ],
            "fetchedAt": "2026-07-24T17:00:00Z",
        }
        self.assertAlmostEqual(compute_quota_factor(snap, "zai/glm-5.2"), math.sqrt(0.80), places=4)

    def test_model_scoped_only_affects_mapped(self):
        snap = {
            "provider": "mm", "account": "mm#1", "status": "fresh",
            "windows": [
                {"id": "INF", "kind": "tokens_limit", "appliesTo": "inference", "modelIds": [], "remainingRatio": 0.90},
                {"id": "M25", "kind": "tokens_limit", "appliesTo": "model", "modelIds": ["mm/m2.5"], "remainingRatio": 0.10},
            ],
            "fetchedAt": "2026-07-24T17:00:00Z",
        }
        self.assertAlmostEqual(compute_quota_factor(snap, "mm/m2.5"), math.sqrt(0.10), places=4)
        self.assertAlmostEqual(compute_quota_factor(snap, "mm/m2.7"), math.sqrt(0.90), places=4)

    def test_compute_live_pressure(self):
        snap = {
            "provider": "zai", "account": "zai#1", "status": "fresh",
            "windows": [{"id": "1w", "kind": "tokens_limit", "appliesTo": "inference", "modelIds": [], "remainingRatio": 0.86}],
            "fetchedAt": "2026-07-24T17:00:00Z",
        }
        result = compute_live_pressure(5.0, 1.25, snap, "zai/glm-5.2")
        self.assertAlmostEqual(result, 5.0 * 1.25 * math.sqrt(0.86), places=4)


if __name__ == "__main__":
    unittest.main()
