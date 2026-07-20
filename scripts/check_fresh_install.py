#!/usr/bin/env python3
"""Install the built wheel into a clean environment and import its HA surface."""

from __future__ import annotations

import argparse
import os
import site
import subprocess
import tempfile
import venv
from pathlib import Path


class FreshInstallError(RuntimeError):
    """The built integration could not be loaded from a fresh installation."""


_PROBE = r"""
import json
import sys
from pathlib import Path

import custom_components.matic_robot as integration
from custom_components.matic_robot import bluetooth_pairing, bluez_agent, config_flow

root = Path(integration.__file__).resolve().parent
environment = Path(sys.prefix).resolve()
if not root.is_relative_to(environment):
    raise RuntimeError(f"integration imported outside fresh environment: {root}")

manifest = json.loads((root / "manifest.json").read_text())
strings = json.loads((root / "strings.json").read_text())
translation = json.loads((root / "translations" / "en.json").read_text())
required = (
    root / "brand" / "icon.png",
    root / "client" / "matic_intermediate_ca.pem",
    root / "room_plan_editor.js",
    root / "services.yaml",
)
if manifest["domain"] != "matic_robot":
    raise RuntimeError("installed manifest has the wrong domain")
if strings != translation:
    raise RuntimeError("installed English translation differs from strings.json")
if missing := [path.name for path in required if not path.is_file()]:
    raise RuntimeError(f"installed integration is missing runtime files: {missing}")
if bluez_agent._AGENT_CAPABILITY != "KeyboardOnly":
    raise RuntimeError("installed BlueZ agent does not require passkey entry")
if not hasattr(bluetooth_pairing, "async_request_bluetooth_credential"):
    raise RuntimeError("installed Bluetooth credential entrypoint is missing")
if not hasattr(config_flow.MaticRobotConfigFlow, "async_step_pair"):
    raise RuntimeError("installed pairing config flow is missing")
print(f"Fresh integration import passed: {root}")
"""


def _environment_python(environment: Path) -> Path:
    """Return the virtual environment's Python executable."""
    directory = "Scripts" if os.name == "nt" else "bin"
    executable = "python.exe" if os.name == "nt" else "python"
    return environment / directory / executable


def check_fresh_install(directory: Path) -> None:
    """Install the one built wheel and verify its shipped Home Assistant surface."""
    wheels = sorted(directory.glob("*.whl"))
    if len(wheels) != 1:
        raise FreshInstallError(
            f"Expected exactly one wheel in {directory}; found {len(wheels)}"
        )

    with tempfile.TemporaryDirectory(prefix="matic-fresh-install-") as temporary:
        temporary_path = Path(temporary)
        environment = temporary_path / "venv"
        venv.EnvBuilder(with_pip=True).create(environment)
        python = _environment_python(environment)
        clean_environment = os.environ.copy()
        clean_environment.pop("PYTHONPATH", None)
        clean_environment["PYTHONNOUSERSITE"] = "1"
        try:
            environment_site = Path(
                subprocess.run(
                    [
                        str(python),
                        "-c",
                        "import site; print(site.getsitepackages()[0])",
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                    cwd=temporary_path,
                    env=clean_environment,
                ).stdout.strip()
            )
            runtime_paths = [
                path
                for value in site.getsitepackages()
                if (path := Path(value).resolve()).is_dir()
            ]
            (environment_site / "home_assistant_runtime.pth").write_text(
                "".join(f"{path}\n" for path in runtime_paths),
                encoding="utf-8",
            )
            subprocess.run(
                [
                    str(python),
                    "-m",
                    "pip",
                    "--disable-pip-version-check",
                    "install",
                    "--no-deps",
                    "--ignore-installed",
                    str(wheels[0].resolve()),
                ],
                check=True,
                cwd=temporary_path,
                env=clean_environment,
            )
            subprocess.run(
                [str(python), "-c", _PROBE],
                check=True,
                cwd=temporary_path,
                env=clean_environment,
            )
        except subprocess.CalledProcessError as err:
            raise FreshInstallError("Fresh integration installation failed") from err


def main() -> int:
    """Run the fresh-install release gate."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=Path("dist"))
    args = parser.parse_args()
    check_fresh_install(args.directory)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
