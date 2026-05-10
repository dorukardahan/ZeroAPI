"""Audit Hermes auth stores for unsafe OAuth credential reuse.

The script redacts all token material. It only reports provider, label, and
which auth stores share the same OAuth token material.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CredentialRef:
    auth_path: Path
    provider: str
    label: str
    token_kind: str
    digest: str


def _auth_path(path: Path) -> Path:
    if path.is_dir():
        return path / "auth.json"
    return path


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _credential_label(credential: dict[str, Any], index: int) -> str:
    for key in ("label", "id", "name", "email"):
        value = credential.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return f"credential[{index}]"


def collect_credentials(paths: list[Path]) -> list[CredentialRef]:
    refs: list[CredentialRef] = []
    for raw_path in paths:
        path = _auth_path(raw_path)
        if not path.exists():
            raise FileNotFoundError(f"missing auth store: {path}")

        data = json.loads(path.read_text(encoding="utf-8"))
        credential_pool = data.get("credential_pool", {})
        if not isinstance(credential_pool, dict):
            continue

        for provider, credentials in credential_pool.items():
            if not isinstance(provider, str) or not isinstance(credentials, list):
                continue
            for index, credential in enumerate(credentials):
                if not isinstance(credential, dict):
                    continue
                if credential.get("auth_type") != "oauth":
                    continue
                label = _credential_label(credential, index)
                for token_kind in ("access_token", "refresh_token"):
                    value = credential.get(token_kind)
                    if isinstance(value, str) and value:
                        refs.append(
                            CredentialRef(
                                auth_path=path,
                                provider=provider,
                                label=label,
                                token_kind=token_kind,
                                digest=_digest(value),
                            )
                        )
    return refs


def duplicate_groups(refs: list[CredentialRef]) -> dict[tuple[str, str, str], list[CredentialRef]]:
    grouped: dict[tuple[str, str, str], list[CredentialRef]] = {}
    for ref in refs:
        key = (ref.provider, ref.token_kind, ref.digest)
        grouped.setdefault(key, []).append(ref)
    return {
        key: values
        for key, values in grouped.items()
        if len({value.auth_path for value in values}) > 1
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Hermes auth.json files for copied OAuth credentials.")
    parser.add_argument("paths", nargs="+", type=Path, help="Hermes home directories or auth.json files")
    args = parser.parse_args()

    refs = collect_credentials(args.paths)
    duplicates = duplicate_groups(refs)
    if not duplicates:
        print("OK: no OAuth credential reuse found across the provided Hermes auth stores.")
        return 0

    print("WARN: OAuth credential reuse found across Hermes auth stores.")
    for (provider, token_kind, _digest_value), values in sorted(duplicates.items()):
        print(f"- provider={provider} token={token_kind}")
        for value in sorted(values, key=lambda item: (str(item.auth_path), item.label)):
            print(f"  - {value.auth_path} label={value.label}")
    print("Fix: re-authorize each Hermes home separately, or disable that provider until re-auth is complete.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
