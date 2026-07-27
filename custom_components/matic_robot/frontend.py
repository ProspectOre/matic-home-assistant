"""Register the cleaning-plan editor and optional local map workspace."""

from __future__ import annotations

import json
from hashlib import sha256
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .slam_scene import (
    MaticSlamCatalogView,
    MaticSlamDeltaView,
    MaticSlamHistorySceneView,
    MaticSlamHistoryView,
    MaticSlamPoseView,
    MaticSlamSceneView,
)

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
MATIC_MAP_STUDIO_VERSION = sha256(
    Path(__file__).with_name("matic_map_studio.js").read_bytes()
).hexdigest()[:12]
MATIC_MAP_STUDIO_PATH = (
    f"/matic_robot/{MANIFEST_VERSION}-{MATIC_MAP_STUDIO_VERSION}/matic-map-studio.js"
)
MATIC_MAP_PANEL_ELEMENT = "matic-map-panel-v0-3-0"
DATA_SLAM_SCENE_VIEW = f"{__package__}_slam_scene_view"
DATA_SLAM_POSE_VIEW = f"{__package__}_slam_pose_view"


def clear_slam_scene_cache(hass: HomeAssistant, entry_id: str) -> None:
    """Purge private in-memory map data when an entry leaves service."""
    if scene_view := hass.data.get(DATA_SLAM_SCENE_VIEW):
        scene_view.clear_entry(entry_id)
    if pose_view := hass.data.get(DATA_SLAM_POSE_VIEW):
        pose_view.clear_entry(entry_id)


async def async_register_room_plan_editor(hass: HomeAssistant) -> None:
    """Serve and load the room editor used by integration config flows."""
    if frontend.DATA_EXTRA_MODULE_URL not in hass.data:
        return
    path = Path(__file__).with_name("room_plan_editor.js")
    studio_path = Path(__file__).with_name("matic_map_studio.js")
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(ROOM_PLAN_EDITOR_PATH, str(path), cache_headers=True),
            StaticPathConfig(
                MATIC_MAP_STUDIO_PATH, str(studio_path), cache_headers=True
            ),
        ]
    )
    scene_view = MaticSlamSceneView()
    pose_view = MaticSlamPoseView()
    hass.data[DATA_SLAM_SCENE_VIEW] = scene_view
    hass.data[DATA_SLAM_POSE_VIEW] = pose_view
    hass.http.register_view(scene_view)
    hass.http.register_view(MaticSlamDeltaView(scene_view))
    hass.http.register_view(pose_view)
    hass.http.register_view(MaticSlamHistoryView)
    hass.http.register_view(MaticSlamHistorySceneView)
    hass.http.register_view(MaticSlamCatalogView)
    frontend.add_extra_js_url(
        hass,
        ROOM_PLAN_EDITOR_PATH,
    )
    # Keep panel_custom optional for config flows and headless installations.
    from homeassistant.components.panel_custom import async_register_panel

    if "matic-map" not in hass.data.get(frontend.DATA_PANELS, {}):
        await async_register_panel(
            hass,
            frontend_url_path="matic-map",
            webcomponent_name=MATIC_MAP_PANEL_ELEMENT,
            sidebar_title="Matic Map",
            sidebar_icon="mdi:robot-vacuum",
            module_url=MATIC_MAP_STUDIO_PATH,
            require_admin=True,
        )
