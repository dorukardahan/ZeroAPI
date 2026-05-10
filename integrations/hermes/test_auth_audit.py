import json
import tempfile
import unittest
from pathlib import Path

from auth_audit import collect_credentials, duplicate_groups


def write_auth(home: Path, refresh_token: str) -> Path:
    home.mkdir(parents=True, exist_ok=True)
    auth_path = home / "auth.json"
    auth_path.write_text(
        json.dumps(
            {
                "version": 1,
                "credential_pool": {
                    "openai-codex": [
                        {
                            "id": "work",
                            "label": "work",
                            "auth_type": "oauth",
                            "access_token": f"access-{refresh_token}",
                            "refresh_token": refresh_token,
                        }
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    return auth_path


class HermesAuthAuditTest(unittest.TestCase):
    def test_detects_oauth_reuse_across_homes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            refs = collect_credentials([
                write_auth(root / "dobby", "same-refresh-token"),
                write_auth(root / "dorry", "same-refresh-token"),
            ])
            duplicates = duplicate_groups(refs)
            self.assertTrue(any(key[0] == "openai-codex" and key[1] == "refresh_token" for key in duplicates))

    def test_allows_distinct_oauth_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            refs = collect_credentials([
                write_auth(root / "dobby", "refresh-token-a"),
                write_auth(root / "dorry", "refresh-token-b"),
            ])
            self.assertEqual(duplicate_groups(refs), {})


if __name__ == "__main__":
    unittest.main()
