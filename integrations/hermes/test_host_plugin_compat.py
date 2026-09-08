"""Exercise the pinned host's real plugin scanner and date-based load gate."""

import datetime
import importlib.util
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from install import install_plugin


class HostPluginCompatibilityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = os.environ.get("ZEROAPI_HERMES_COMPAT_ROOT")
        if not source:
            raise unittest.SkipTest("Set ZEROAPI_HERMES_COMPAT_ROOT to the pinned Hermes source")
        path = Path(source) / "hermes_cli" / "plugin_compat.py"
        spec = importlib.util.spec_from_file_location("zeroapi_test_host_plugin_compat", path)
        cls.host = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.host
        cls.addClassCleanup(sys.modules.pop, spec.name, None)
        spec.loader.exec_module(cls.host)
        if not cls.host.load_manifest():
            raise AssertionError("Native compatibility manifest must be present and nonempty")

    def test_installed_plugin_passes_removal_gate_but_runtime_imports_still_fail(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            plugins = root / "plugins"
            destination = plugins / "zeroapi-router"
            install_plugin(
                source=Path(__file__).parent,
                destination=destination,
                discovery_roots=[plugins],
                backup_root=root / "backups",
            )
            manifest = SimpleNamespace(name="zeroapi-router", path=destination, source="user")
            # The old source remains useful regression data and is still detected
            # when scanned directly. Only its test-directory classification changes.
            fixture_hits = self.host.scan_plugin(destination / "tests" / "fixtures" / "v019")
            self.assertTrue(fixture_hits)
            self.assertEqual(self.host.scan_plugin(destination), [])
            removal = self.host.COMPAT_REMOVAL_DATE
            # Deny the bypass explicitly and avoid loading any operator config.
            with patch.object(self.host, "allow_deprecated_imports", return_value=False):
                for day in (removal - datetime.timedelta(days=1), removal,
                            removal + datetime.timedelta(days=1)):
                    with self.subTest(day=day):
                        self.assertIsNone(self.host.disable_reason(manifest, today=day))

                facade, _, name = fixture_hits[0].old.rpartition(".")
                (destination / "deprecated_runtime.py").write_text(
                    f"from {facade} import {name}\n", encoding="utf-8"
                )
                self.assertIsNotNone(self.host.disable_reason(manifest, today=removal))


if __name__ == "__main__":
    unittest.main()
