"""Compare ZeroAPI duplicate discovery with the actual Hermes manifest reader."""

import importlib.util
import json
from pathlib import Path
import sys

import pytest


def _native_and_installer():
    if importlib.util.find_spec("hermes_cli.plugins_discovery") is None:
        pytest.skip("older Hermes has no split portable manifest discovery")
    from hermes_cli.agent_plugins import AgentPluginError, read_agent_plugin_manifest
    from hermes_cli.plugins_discovery import scan_directory

    path = Path(__file__).resolve().parents[1] / "install.py"
    spec = importlib.util.spec_from_file_location("_zeroapi_native_installer", path)
    installer = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = installer
    spec.loader.exec_module(installer)
    return installer, scan_directory, read_agent_plugin_manifest, AgentPluginError


def test_native_portable_discovery_and_yaml_precedence(tmp_path):
    installer, scan, _read, _error = _native_and_installer()
    portable = tmp_path / "category" / "portable"
    yaml = tmp_path / "yaml-wins"
    portable.mkdir(parents=True)
    yaml.mkdir()
    payload = {"$schema": installer._PORTABLE_SCHEMA, "name": "zeroapi-router", "version": "1.0.0"}
    for root in (portable, yaml):
        (root / "plugin.json").write_text(json.dumps(payload), encoding="utf-8")
    (yaml / "plugin.yml").write_text("name: yaml-wins\nversion: 1.0.0\n", encoding="utf-8")
    native = {manifest.name for manifest in scan(tmp_path, "user")}
    discovered = {installer._manifest_name(path) for path in installer.discover_plugin_manifests([tmp_path])}
    assert native == discovered == {"zeroapi-router", "yaml-wins"}


def test_native_portable_validation_rejects_the_same_invalid_names_and_fields(tmp_path):
    installer, _scan, read, error = _native_and_installer()
    path = tmp_path / "plugin.json"
    base = {"$schema": installer._PORTABLE_SCHEMA, "name": "zeroapi-router"}
    for override in (
        {"$schema": "unsupported"}, {"name": "bad--name"},
        {"version": 1}, {"keywords": "invalid"},
        {"author": {"unsupported": "value"}}, {"extensions": {"vendor": []}},
    ):
        path.write_text(json.dumps({**base, **override}), encoding="utf-8")
        with pytest.raises(error):
            read(tmp_path)
        with pytest.raises(ValueError):
            installer._manifest_name(path)
    # Native diagnostics ignore these fields without hiding a duplicate name.
    path.write_text(json.dumps({**base, "extensions": "ignored", "unknown": True}), encoding="utf-8")
    native_manifest, _diagnostics = read(tmp_path)
    assert native_manifest["name"] == installer._manifest_name(path) == "zeroapi-router"
