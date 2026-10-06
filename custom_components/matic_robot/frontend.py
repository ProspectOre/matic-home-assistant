"""Register the administrator-only local Map Studio frontend."""

from __future__ import annotations

import json
from hashlib import sha256
from inspect import signature
from pathlib import Path
from typing import Any

from homeassistant.components import frontend
from homeassistant.components.http import (  # type: ignore[attr-defined,unused-ignore]
    StaticPathConfig,
)
from homeassistant.core import HomeAssistant

from .slam_scene import (
    MaticAreasView,
    MaticPlansView,
    MaticSlamCatalogView,
    MaticSlamDeltaView,
    MaticSlamHistorySceneView,
    MaticSlamHistoryView,
    MaticSlamPoseView,
    MaticSlamSceneView,
)
from .workspace_socket import async_register as async_register_workspace_socket

# Keep the custom icons cache-busted by both integration and asset versions.
MANIFEST_VERSION = json.loads(
    Path(__file__).with_name("manifest.json").read_text(encoding="utf-8")
)["version"]
MATIC_ICONS_VERSION = sha256(
    Path(__file__).with_name("matic_icons.js").read_bytes()
).hexdigest()[:12]
MATIC_ICONS_PATH = f"/matic_robot/{MANIFEST_VERSION}-{MATIC_ICONS_VERSION}/icons.js"


def _tree_version(path: Path) -> str:
    """Return a deterministic cache key for one generated module tree."""
    digest = sha256()
    for child in sorted(
        candidate for candidate in path.rglob("*") if candidate.is_file()
    ):
        digest.update(child.relative_to(path).as_posix().encode())
        digest.update(b"\0")
        digest.update(child.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()[:12]


# Map Studio is a strict TypeScript/Lit module tree. Its entry and lazy
# workflow chunks share one content-bound URL root so an upgrade cannot mix
# generations.
MATIC_MAP_STUDIO_V4_DIRECTORY = Path(__file__).with_name("map_studio_v4")
MATIC_MAP_STUDIO_V4_VERSION = _tree_version(MATIC_MAP_STUDIO_V4_DIRECTORY)
MATIC_MAP_STUDIO_V4_ROOT_PATH = (
    f"/matic_robot/{MANIFEST_VERSION}-{MATIC_MAP_STUDIO_V4_VERSION}/map-studio-v4"
)
MATIC_MAP_STUDIO_V4_PATH = f"{MATIC_MAP_STUDIO_V4_ROOT_PATH}/index.js"
# The panel element name is versioned independently from the integration
# manifest.  Home Assistant keeps a custom-element registry alive while its
# SPA changes panels, so reusing the same tag can leave an older constructor
# serving a newly cache-busted module after an in-place integration reload.
MATIC_MAP_PANEL_ELEMENT = f"matic-map-panel-v0-4-0-{MATIC_MAP_STUDIO_V4_VERSION}"
DATA_SLAM_SCENE_VIEW = f"{__package__}_slam_scene_view"
DATA_SLAM_POSE_VIEW = f"{__package__}_slam_pose_view"


def clear_slam_scene_cache(hass: HomeAssistant, entry_id: str) -> None:
    """Purge private in-memory map data when an entry leaves service."""
    if scene_view := hass.data.get(DATA_SLAM_SCENE_VIEW):
        scene_view.clear_entry(entry_id)
    if pose_view := hass.data.get(DATA_SLAM_POSE_VIEW):
        pose_view.clear_entry(entry_id)


async def async_register_frontend(hass: HomeAssistant) -> None:
    """Serve the local Map Studio frontend and its private data views."""
    if "workspace_socket" not in hass.data.get(__package__, {}):
        await async_register_workspace_socket(hass)
    if frontend.DATA_EXTRA_MODULE_URL not in hass.data:
        return
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                MATIC_ICONS_PATH,
                str(Path(__file__).with_name("matic_icons.js")),
                cache_headers=True,
            ),
            StaticPathConfig(
                MATIC_MAP_STUDIO_V4_ROOT_PATH,
                str(MATIC_MAP_STUDIO_V4_DIRECTORY),
                cache_headers=True,
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
    hass.http.register_view(MaticSlamCatalogView(scene_view))
    hass.http.register_view(MaticAreasView)
    hass.http.register_view(MaticPlansView)
    frontend.add_extra_js_url(hass, MATIC_ICONS_PATH)
    # Keep panel_custom optional for headless installations.
    from homeassistant.components.panel_custom import async_register_panel

    if "matic-map" not in hass.data.get(frontend.DATA_PANELS, {}):
        # Home Assistant added this optional panel argument in 2026.9.
        panel_options: dict[str, Any] = {}
        if "handle_safe_area" in signature(async_register_panel).parameters:
            panel_options["handle_safe_area"] = True
        await async_register_panel(
            hass,
            frontend_url_path="matic-map",
            webcomponent_name=MATIC_MAP_PANEL_ELEMENT,
            sidebar_title="Matic Map",
            sidebar_icon="matic:robot",
            module_url=MATIC_MAP_STUDIO_V4_PATH,
            require_admin=True,
            **panel_options,
        )
