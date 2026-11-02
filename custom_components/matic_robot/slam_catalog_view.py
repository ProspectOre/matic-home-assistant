"""List loaded robot map projections for administrator Map Studio clients."""

from __future__ import annotations

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .const import DOMAIN
from .http import CATALOG_API_URL, PRIVATE_NO_STORE_HEADERS, runtime_for_entry
from .slam_scene import MaticSlamSceneView
from .slam_view_data import catalog_entry_projection


class MaticSlamCatalogView(HomeAssistantView):
    """List private scene endpoints for loaded robots to administrators only."""

    url = CATALOG_API_URL
    name = "api:matic_robot:slam_entries"

    def __init__(self, scene_view: MaticSlamSceneView | None = None) -> None:
        """Initialize the catalog with its optional scene cache view."""
        self._scene_view = scene_view

    @require_admin
    async def get(self, request: web.Request) -> web.Response:
        """Return non-persistent discovery data for the admin-only map panel."""
        hass = request.app[KEY_HASS]
        entries = []
        for entry in hass.config_entries.async_entries(DOMAIN):
            runtime = runtime_for_entry(hass, entry.entry_id)
            if runtime is None:
                continue
            health = runtime.slam_map.health
            projection = catalog_entry_projection(
                entry.entry_id,
                runtime,
                self._scene_view,
            )
            entries.append(
                {
                    **projection,
                    "cached_tiles": health.photo_tiles,
                    "structural_tiles": health.structure_tiles,
                    "overlapping_tiles": health.overlapping_tiles,
                    "layer_overlap": round(health.layer_overlap, 4),
                    "dropped_photo_tiles": health.dropped_photo_tiles,
                    "dropped_structure_tiles": health.dropped_structure_tiles,
                    "invalid_tiles": health.invalid_tiles,
                    "stream_state": health.stream_state,
                    "stream_failures": health.stream_failures,
                    "bootstrap_state": getattr(
                        health, "bootstrap_state", "not_started"
                    ),
                    "bootstrap_photo_seen": getattr(
                        health, "bootstrap_photo_seen", False
                    ),
                    "bootstrap_structure_seen": getattr(
                        health, "bootstrap_structure_seen", False
                    ),
                    "bootstrap_failures": getattr(health, "bootstrap_failures", 0),
                }
            )
        return self.json({"entries": entries}, headers=PRIVATE_NO_STORE_HEADERS)
