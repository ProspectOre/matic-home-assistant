"""Exercise native Home Assistant startup without a robot or test doubles."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import shutil
import tempfile
from importlib.metadata import version
from pathlib import Path

import aiohttp
from homeassistant import bootstrap, loader
from homeassistant.components import frontend
from homeassistant.core import HomeAssistant


class SetupErrors(logging.Handler):
    """Retain real setup exceptions so unrelated failures cannot satisfy the test."""

    def __init__(self) -> None:
        super().__init__()
        self.errors: list[BaseException] = []

    def emit(self, record: logging.LogRecord) -> None:
        if record.exc_info and record.exc_info[1]:
            self.errors.append(record.exc_info[1])


async def check(config_dir: Path, expect_safe_area_error: bool) -> None:
    """Boot native HA and check the integration, panel, services, and HTTP module."""
    hass = HomeAssistant(str(config_dir))
    loader.async_setup(hass)
    captured = SetupErrors()
    logging.getLogger("homeassistant.setup").addHandler(captured)
    try:
        configured = await bootstrap.async_from_config_dict(
            {
                "homeassistant": {
                    "name": "Matic setup acceptance",
                    "latitude": 0,
                    "longitude": 0,
                    "elevation": 0,
                    "unit_system": "metric",
                    "time_zone": "UTC",
                    "country": "US",
                },
                "http": {"server_host": "127.0.0.1", "server_port": 8123},
                "frontend": {},
                "matic_robot": {},
            },
            hass,
        )
        assert configured is hass, "Home Assistant bootstrap failed"
        assert "frontend" in hass.config.components, "Frontend did not load"
        loaded = "matic_robot" in hass.config.components
        safe_area_errors = [
            error
            for error in captured.errors
            if isinstance(error, TypeError)
            and "unexpected keyword argument 'handle_safe_area'" in str(error)
        ]
        report = {
            "homeassistant": version("homeassistant"),
            "integration_loaded": loaded,
            "safe_area_type_errors": len(safe_area_errors),
            "frontend_sha256": hashlib.sha256(
                (config_dir / "custom_components/matic_robot/frontend.py").read_bytes()
            ).hexdigest(),
        }
        if expect_safe_area_error:
            assert not loaded, "Broken baseline unexpectedly loaded"
            assert safe_area_errors, "Baseline did not reproduce the reported TypeError"
            assert not hass.services.async_services().get("matic_robot")
            report["result"] = "reported setup failure reproduced"
        else:
            assert loaded, "Matic component setup failed"
            assert not safe_area_errors, "Unexpected safe-area TypeError"
            from custom_components.matic_robot import frontend as matic_frontend
            from custom_components.matic_robot.const import DATA_LLM_API, DOMAIN

            assert Path(matic_frontend.__file__).is_relative_to(config_dir)
            panel = hass.data[frontend.DATA_PANELS]["matic-map"]
            panel_config = panel.config["_panel_custom"]
            assert panel.require_admin is True
            assert panel_config["name"] == matic_frontend.MATIC_MAP_PANEL_ELEMENT
            assert panel_config["module_url"] == matic_frontend.MATIC_MAP_STUDIO_V4_PATH
            ha_minor = tuple(map(int, version("homeassistant").split(".")[:2]))
            if ha_minor >= (2026, 9):
                assert panel_config["handle_safe_area"] is True
            else:
                assert "handle_safe_area" not in panel_config
            services = hass.services.async_services()[DOMAIN]
            assert len(services) == 20
            assert hass.data[DOMAIN][DATA_LLM_API].id == "matic_robot_operations"
            await hass.async_start()
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    "http://127.0.0.1:8123" + matic_frontend.MATIC_MAP_STUDIO_V4_PATH
                ) as response:
                    assert response.status == 200
                    body = await response.read()
            expected = (
                matic_frontend.MATIC_MAP_STUDIO_V4_DIRECTORY / "index.js"
            ).read_bytes()
            assert body == expected, "Served Map Studio module differs from source"
            report.update(
                result="native setup and HTTP module passed",
                services=len(services),
                handle_safe_area=panel_config.get("handle_safe_area"),
                module_sha256=hashlib.sha256(body).hexdigest(),
            )
        print(json.dumps(report, sort_keys=True), flush=True)
    finally:
        logging.getLogger("homeassistant.setup").removeHandler(captured)
        await hass.async_stop(force=True)


def main() -> None:
    """Use a fresh config directory and native dependencies for each source tree."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--components", type=Path, required=True)
    parser.add_argument("--expect-safe-area-error", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)
    with tempfile.TemporaryDirectory(prefix="matic-panel-acceptance-") as directory:
        config_dir = Path(directory)
        shutil.copytree(args.components, config_dir / "custom_components")
        asyncio.run(
            asyncio.wait_for(check(config_dir, args.expect_safe_area_error), 240)
        )


if __name__ == "__main__":
    main()
