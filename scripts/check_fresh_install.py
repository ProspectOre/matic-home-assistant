#!/usr/bin/env python3
"""Unpack the release zip as HACS does and import its Home Assistant surface."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


class FreshInstallError(RuntimeError):
    """The zip could not be loaded as an installed integration."""


_PROBE = r"""
import json
from pathlib import Path

import custom_components.matic_robot as integration
from custom_components.matic_robot import (
    bluetooth_pairing,
    bluez_agent,
    config_flow,
    frontend,
)

root = Path(integration.__file__).resolve().parent
if Path.cwd().resolve() not in root.parents:
    raise RuntimeError(f"integration imported outside the unpacked zip: {root}")

manifest = json.loads((root / "manifest.json").read_text())
strings = json.loads((root / "strings.json").read_text())
translation = json.loads((root / "translations" / "en.json").read_text())
required = (
    root / "brand" / "icon.png",
    root / "client" / "matic_intermediate_ca.pem",
    root / "services.yaml",
)
if manifest["domain"] != "matic_robot":
    raise RuntimeError("installed manifest has the wrong domain")
if strings != translation:
    raise RuntimeError("installed English translation differs from strings.json")
if missing := [path.name for path in required if not path.is_file()]:
    raise RuntimeError(f"installed integration is missing runtime files: {missing}")
if not frontend.PANEL_BUILT:
    raise RuntimeError("installed integration has no built Matic Map")
if bluez_agent._AGENT_CAPABILITY != "KeyboardOnly":
    raise RuntimeError("installed BlueZ agent does not require passkey entry")
if not hasattr(bluetooth_pairing, "async_request_bluetooth_credential"):
    raise RuntimeError("installed Bluetooth credential entrypoint is missing")
if not hasattr(config_flow.MaticRobotConfigFlow, "async_step_pair"):
    raise RuntimeError("installed pairing config flow is missing")
print(f"Fresh integration import passed: {root}")
"""


def check_fresh_install(archive: Path) -> None:
    """Unpack the zip into an empty configuration directory and import it."""
    with tempfile.TemporaryDirectory(prefix="matic-fresh-install-") as temporary:
        components = Path(temporary) / "custom_components"
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(components / "matic_robot")
        # A package here outranks a checkout of this repository on the path.
        (components / "__init__.py").touch()
        try:
            subprocess.run(
                [sys.executable, "-c", _PROBE],
                check=True,
                cwd=temporary,
                env=os.environ | {"PYTHONPATH": temporary},
            )
        except subprocess.CalledProcessError as err:
            raise FreshInstallError(f"{archive} failed the import check") from err


def main() -> int:
    """Run the fresh-install release gate."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "archive", nargs="?", type=Path, default=Path("dist/matic_robot.zip")
    )
    check_fresh_install(parser.parse_args().archive)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
