"""Compare ZeroAPI duplicate discovery with the actual Hermes manifest reader."""

import importlib.util
import json
from pathlib import Path
import sys
import os

import pytest


def test_real_installer_loader_and_route_callback(monkeypatch):
    from hermes_cli import plugins
    installer, _scan, _read, _error = _native_and_installer()
    home = Path(os.environ["HERMES_HOME"])
    destination = home / "plugins" / "zeroapi-router"
    installer.install_plugin(source=Path(__file__).resolve().parents[1],
                             destination=destination,
                             discovery_roots=[destination.parent],
                             backup_root=home / "backups")
    policy = Path(__file__).resolve().parents[3] / "scripts/__fixtures__/openclaw-current/zeroapi-config.json"
    monkeypatch.setenv("ZEROAPI_CONFIG_PATH", str(policy))
    monkeypatch.setattr(plugins, "_get_enabled_plugins", lambda: {"zeroapi-router"})
    monkeypatch.setattr(plugins, "_get_disabled_plugins", lambda: set())
    manager = plugins.PluginManager()
    manager.discover_and_load()
    manager.discover_and_load()
    matches = [p for p in manager.list_plugins() if p["name"] == "zeroapi-router"]
    assert len(matches) == 1
    assert matches[0]["enabled"] is True
    assert matches[0]["hooks"] == 1
    callbacks = manager._hooks["pre_model_route"]
    assert len(callbacks) == 1
    args = dict(user_message="implement a compatibility regression test", provider="zai",
                model="glm-5.1", agent_id="main", session_id="synthetic-loader")
    routes = manager.invoke_hook("pre_model_route", **args)
    assert len(routes) == 1
    assert routes[0]["model"] == "gpt-5.4"
    assert routes[0]["provider"] == "openai-codex"
    assert manager.invoke_hook("pre_model_route", **{**args, **routes[0]}) == []


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
