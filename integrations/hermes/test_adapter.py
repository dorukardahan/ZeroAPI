import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


def _load_adapter():
    root = Path(__file__).parent
    spec = importlib.util.spec_from_file_location(
        "zeroapi_hermes_adapter",
        root / "__init__.py",
        submodule_search_locations=[str(root)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


adapter = _load_adapter()


class HermesAdapterPayloadTest(unittest.TestCase):
    def test_malformed_only_config_keeps_router_unset(self):
        malformed = {
            "version": "test", "default_model": "qwen/model", "models": {},
            "routing_rules": {"default": {"primary": "qwen/model", "fallbacks": []}},
            "keywords": {}, "high_risk_keywords": [],
            "subscription_catalog_version": "1.0.0",
            "subscription_inventory": {"version": "1.0.0", "accounts": None},
        }
        with tempfile.TemporaryDirectory(prefix="zeroapi-adapter-malformed-") as temp_dir:
            path = Path(temp_dir) / "zeroapi-config.json"
            original = json.dumps(malformed).encode()
            path.write_bytes(original)
            adapter._router = None
            with patch.dict(os.environ, {"ZEROAPI_CONFIG_PATH": str(path)}, clear=False):
                result = adapter._pre_model_route(user_message="implement this", provider="qwen", model="model")
            self.assertIsNone(result)
            self.assertIsNone(adapter._router)
            self.assertEqual(path.read_bytes(), original)

    def test_detects_image_parts_in_conversation_history(self):
        payload = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "buna bak"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}},
                ],
            }
        ]

        self.assertTrue(adapter._payload_has_image_attachment(payload))

    def test_detects_gateway_attachment_shapes(self):
        payload = {"message": {"attachments": [{"type": "image", "url": "https://example.test/a.png"}]}}

        self.assertTrue(adapter._payload_has_image_attachment(payload))

    def test_route_state_prefers_gateway_session_key(self):
        key = adapter._route_state_key(
            {
                "platform": "signal",
                "sender_id": "sender",
                "chat_id": "chat",
                "gateway_session_key": "agent:main:signal:dm:redacted",
            }
        )

        self.assertEqual(key, "gateway:agent:main:signal:dm:redacted:main")

    def test_route_state_is_bounded_and_lru(self):
        adapter._route_state.clear()
        original_max = adapter._MAX_ROUTE_STATE_ENTRIES
        adapter._MAX_ROUTE_STATE_ENTRIES = 3
        try:
            for i in range(6):
                adapter._record_route_state(f"s{i}", "code")
            # Capped: never grows past the limit no matter how many sessions appear.
            self.assertEqual(len(adapter._route_state), 3)
            # Oldest sessions evicted, newest retained.
            self.assertNotIn("s0", adapter._route_state)
            self.assertNotIn("s2", adapter._route_state)
            self.assertIn("s3", adapter._route_state)
            self.assertIn("s5", adapter._route_state)
            # Re-writing an existing key refreshes it so it is not evicted next.
            adapter._record_route_state("s3", "research")
            adapter._record_route_state("s6", "math")
            self.assertIn("s3", adapter._route_state)
            self.assertEqual(adapter._route_state["s3"], "research")
            self.assertLessEqual(len(adapter._route_state), 3)
        finally:
            adapter._MAX_ROUTE_STATE_ENTRIES = original_max
            adapter._route_state.clear()


if __name__ == "__main__":
    unittest.main()
