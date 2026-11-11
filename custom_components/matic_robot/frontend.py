"""Register the administrator-only local Map Studio frontend."""

from __future__ import annotations

import json
import logging
from hashlib import sha256
from inspect import signature
from pathlib import Path
from typing import Any

from homeassistant.components import frontend
from homeassistant.components.http import (  # type: ignore[attr-defined,unused-ignore]
    StaticPathConfig,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from .area_views import MaticAreasView
from .const import DOMAIN
from .daily_limit_view import MaticDailyLimitView
from .floor_layers import MaticFloorLayersView
from .photos import MaticRobotPhotoPreviewView, MaticRobotPhotoView
from .plan_views import MaticPlansView
from .run_thumbnails import MaticRunThumbnailView
from .slam_catalog_view import MaticSlamCatalogView
from .slam_history_view import (
    MaticSlamHistoryExportView,
    MaticSlamHistoryImportView,
    MaticSlamHistoryManageView,
    MaticSlamHistorySceneView,
    MaticSlamHistoryView,
)
from .slam_run_history_view import MaticRunHistoryView
from .slam_scene import MaticSlamDeltaView, MaticSlamSceneView
from .wifi_survey import MaticWifiHeatmapView
from .workspace_socket import async_register as async_register_workspace_socket

_LOGGER = logging.getLogger(__name__)
RELEASES_URL = "https://github.com/ProspectOre/matic-home-assistant/releases"
MATIC_ICONS_FILE = Path(__file__).with_name("matic_icons.js")
MATIC_MAP_STUDIO_V4_DIRECTORY = Path(__file__).with_name("map_studio_v4")
# A release zip holds the built panel. A source checkout or archive has none
# until `npm run build:map-studio-v4` runs, and registers no panel.
PANEL_BUILT = (
    MATIC_ICONS_FILE.is_file()
    and (MATIC_MAP_STUDIO_V4_DIRECTORY / "index.js").is_file()
)

# Keep the custom icons cache-busted by both integration and asset versions.
MANIFEST_VERSION = json.loads(
    Path(__file__).with_name("manifest.json").read_text(encoding="utf-8")
)["version"]
MATIC_ICONS_VERSION = sha256(
    MATIC_ICONS_FILE.read_bytes() if PANEL_BUILT else b""
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
DATA_FLOOR_LAYERS_VIEW = f"{__package__}_floor_layers_view"
DATA_RUN_THUMBNAIL_VIEW = f"{__package__}_run_thumbnail_view"


def clear_slam_scene_cache(hass: HomeAssistant, entry_id: str) -> None:
    """Purge private in-memory map data when an entry leaves service."""
    if scene_view := hass.data.get(DATA_SLAM_SCENE_VIEW):
        scene_view.clear_entry(entry_id)
    if floor_layers_view := hass.data.get(DATA_FLOOR_LAYERS_VIEW):
        floor_layers_view.clear_entry(entry_id)
    if run_thumbnail_view := hass.data.get(DATA_RUN_THUMBNAIL_VIEW):
        run_thumbnail_view.clear_entry(entry_id)


async def async_register_frontend(hass: HomeAssistant) -> None:
    """Serve the local Map Studio frontend and its private data views."""
    if "workspace_socket" not in hass.data.get(__package__, {}):
        await async_register_workspace_socket(hass)
    # Photo patrol links work in notifications without the frontend.
    hass.http.register_view(MaticRobotPhotoView)
    hass.http.register_view(MaticRobotPhotoPreviewView)
    if frontend.DATA_EXTRA_MODULE_URL not in hass.data:
        return
    if not PANEL_BUILT:
        _LOGGER.error(
            "This copy of the integration was installed without its Matic Map"
            " files, so the sidebar has no Matic Map. Download it again in HACS,"
            " or replace custom_components/matic_robot with the contents of"
            " matic_robot.zip from %s",
            RELEASES_URL,
        )
        ir.async_create_issue(
            hass,
            DOMAIN,
            "panel_missing",
            is_fixable=False,
            learn_more_url=RELEASES_URL,
            severity=ir.IssueSeverity.ERROR,
            translation_key="panel_missing",
        )
        return
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                MATIC_ICONS_PATH,
                str(MATIC_ICONS_FILE),
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
    hass.data[DATA_SLAM_SCENE_VIEW] = scene_view
    floor_layers_view = MaticFloorLayersView()
    hass.data[DATA_FLOOR_LAYERS_VIEW] = floor_layers_view
    run_thumbnail_view = MaticRunThumbnailView()
    hass.data[DATA_RUN_THUMBNAIL_VIEW] = run_thumbnail_view
    hass.http.register_view(scene_view)
    hass.http.register_view(MaticSlamDeltaView(scene_view))
    hass.http.register_view(MaticSlamHistoryView)
    hass.http.register_view(MaticSlamHistorySceneView)
    hass.http.register_view(MaticSlamHistoryManageView)
    hass.http.register_view(MaticSlamHistoryExportView)
    hass.http.register_view(MaticSlamHistoryImportView)
    hass.http.register_view(MaticSlamCatalogView(scene_view))
    hass.http.register_view(MaticAreasView)
    hass.http.register_view(MaticPlansView)
    hass.http.register_view(MaticDailyLimitView)
    hass.http.register_view(MaticRunHistoryView)
    hass.http.register_view(MaticWifiHeatmapView)
    hass.http.register_view(floor_layers_view)
    hass.http.register_view(run_thumbnail_view)
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
