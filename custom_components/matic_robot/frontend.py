"""Register the cleaning-plan editor and optional local map workspace."""

from __future__ import annotations

import json
from hashlib import sha256
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

# Include both the packaged version and the editor content in the cache-buster.
# Both are loaded once at import time, off the event loop.
MANIFEST_VERSION = json.loads(
    Path(__file__).with_name("manifest.json").read_text(encoding="utf-8")
)["version"]
ROOM_PLAN_EDITOR_VERSION = sha256(
    Path(__file__).with_name("room_plan_editor.js").read_bytes()
).hexdigest()[:12]
ROOM_PLAN_EDITOR_PATH = (
    f"/matic_robot/{MANIFEST_VERSION}-{ROOM_PLAN_EDITOR_VERSION}/room-plan-editor.js"
)
MATIC_MAP_PANEL_ELEMENT = "matic-map-panel-v0-3-0"


async def async_register_room_plan_editor(hass: HomeAssistant) -> None:
    """Serve and load the room editor used by integration config flows."""
    if frontend.DATA_EXTRA_MODULE_URL not in hass.data:
        return
    path = Path(__file__).with_name("room_plan_editor.js")
    await hass.http.async_register_static_paths(
        [StaticPathConfig(ROOM_PLAN_EDITOR_PATH, str(path), cache_headers=True)]
    )
    frontend.add_extra_js_url(
        hass,
        ROOM_PLAN_EDITOR_PATH,
    )
    # Registering a custom panel only writes frontend metadata; panel_custom is
    # deliberately not a manifest dependency. The integration must remain
    # usable for config-flow tests and headless Home Assistant installs where
    # the frontend's optional Python package is unavailable.
    from homeassistant.components.panel_custom import async_register_panel

    if "matic-map" not in hass.data.get(frontend.DATA_PANELS, {}):
        await async_register_panel(
            hass,
            frontend_url_path="matic-map",
            webcomponent_name=MATIC_MAP_PANEL_ELEMENT,
            sidebar_title="Matic Map",
            sidebar_icon="mdi:robot-vacuum",
            module_url=ROOM_PLAN_EDITOR_PATH,
            require_admin=True,
        )
