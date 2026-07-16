"""Local floor-map camera for Matic Hermes."""

from __future__ import annotations

from functools import partial

from homeassistant.components.camera import Camera
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.floor_plan import render_floor_plan
from .entity import MaticEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the local Matic map."""
    async_add_entities([MaticMapCamera(entry)])


class MaticMapCamera(MaticEntity, Camera):
    """Render Matic's local room polygons and latest pose."""

    _attr_translation_key = "map"
    _attr_content_type = "image/png"

    def __init__(self, entry: MaticConfigEntry) -> None:
        # Camera does not call super(), so initialize both sides of the mixin.
        Camera.__init__(self)
        MaticEntity.__init__(self, entry)
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_map"

    async def async_camera_image(
        self,
        width: int | None = None,
        height: int | None = None,
    ) -> bytes:
        """Return a current, entirely local map image."""
        data = self.coordinator.data
        requested_width = min(max(width or 1024, 256), 2048)
        requested_height = min(max(height or 1024, 256), 2048)
        return await self.hass.async_add_executor_job(
            partial(
                render_floor_plan,
                data.floor_plan,
                data.pose,
                width=requested_width,
                height=requested_height,
            )
        )
