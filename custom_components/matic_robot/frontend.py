"""Register the configuration-only cleaning-plan editor frontend module."""

from __future__ import annotations

import json
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

ROOM_PLAN_EDITOR_PATH = "/matic_robot/room-plan-editor.js"

# Tie the cache-buster to the packaged manifest so it can never drift from the
# shipped version. Loaded once at import time, off the event loop.
MANIFEST_VERSION = json.loads(
    Path(__file__).with_name("manifest.json").read_text(encoding="utf-8")
)["version"]


async def async_register_room_plan_editor(hass: HomeAssistant) -> None:
    """Serve and load the room editor used by integration config flows."""
    if frontend.DATA_EXTRA_MODULE_URL not in hass.data:
        return
    path = Path(__file__).with_name("room_plan_editor.js")
    await hass.http.async_register_static_paths(
        [StaticPathConfig(ROOM_PLAN_EDITOR_PATH, str(path), cache_headers=True)]
    )
    frontend.add_extra_js_url(hass, f"{ROOM_PLAN_EDITOR_PATH}?v={MANIFEST_VERSION}")
