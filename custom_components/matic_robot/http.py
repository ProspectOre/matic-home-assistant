"""Shared private HTTP routes and loaded-entry lookup for local robot views."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from homeassistant.config_entries import ConfigEntryState

from .const import DOMAIN

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import MaticConfigEntry, MaticRuntimeData

SCENE_API_URL = "/api/matic_robot/slam_scene/{entry_id}"
POSE_API_URL = "/api/matic_robot/slam_pose/{entry_id}"
CATALOG_API_URL = "/api/matic_robot/slam_entries"
DELTA_API_URL = "/api/matic_robot/slam_delta/{entry_id}"
HISTORY_API_URL = "/api/matic_robot/slam_history/{entry_id}"
HISTORY_SCENE_API_URL = "/api/matic_robot/slam_history_scene/{entry_id}/{snapshot_id}"
AREAS_API_URL = "/api/matic_robot/areas/{entry_id}"
PLANS_API_URL = "/api/matic_robot/plans/{entry_id}"
RUNS_API_URL = "/api/matic_robot/runs/{entry_id}"
WIFI_HEATMAP_API_URL = "/api/matic_robot/wifi_heatmap/{entry_id}"
FLOOR_LAYERS_API_URL = "/api/matic_robot/floor_layers/{entry_id}"

PRIVATE_NO_STORE_HEADERS = {
    "Cache-Control": "private, no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
}


def scene_api_url(entry_id: str) -> str:
    """Return the authenticated scene URL for one config entry."""
    return SCENE_API_URL.format(entry_id=entry_id)


def pose_api_url(entry_id: str) -> str:
    """Return the authenticated live-pose URL for one config entry."""
    return POSE_API_URL.format(entry_id=entry_id)


def delta_api_url(entry_id: str) -> str:
    """Return the authenticated live-delta URL for one config entry."""
    return DELTA_API_URL.format(entry_id=entry_id)


def history_api_url(entry_id: str) -> str:
    """Return the authenticated history catalog URL for one config entry."""
    return HISTORY_API_URL.format(entry_id=entry_id)


def history_scene_api_url(entry_id: str, snapshot_id: str) -> str:
    """Return the authenticated URL for one retained scene."""
    return HISTORY_SCENE_API_URL.format(entry_id=entry_id, snapshot_id=snapshot_id)


def areas_api_url(entry_id: str) -> str:
    """Return the authenticated custom-area workspace URL for one entry."""
    return AREAS_API_URL.format(entry_id=entry_id)


def plans_api_url(entry_id: str) -> str:
    """Return the authenticated cleaning-plan workspace URL for one entry."""
    return PLANS_API_URL.format(entry_id=entry_id)


def runtime_for_entry(hass: HomeAssistant, entry_id: str) -> MaticRuntimeData | None:
    entry = hass.config_entries.async_get_entry(entry_id)
    if (
        entry is None
        or entry.domain != DOMAIN
        or entry.state is not ConfigEntryState.LOADED
    ):
        return None
    return cast("MaticConfigEntry", entry).runtime_data
