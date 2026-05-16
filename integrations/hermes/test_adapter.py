import importlib.util
from pathlib import Path
import sys
import unittest


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


if __name__ == "__main__":
    unittest.main()
