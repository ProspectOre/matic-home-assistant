"""Local floor-map camera for Matic Hermes."""

from __future__ import annotations

from functools import partial

from homeassistant.components.camera import Camera
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.floor_plan import render_floor_plan, resolve_robot_map_position
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
        self._cached_image_key: tuple[object, ...] | None = None
        self._cached_image: bytes | None = None

    async def async_camera_image(
        self,
        width: int | None = None,
        height: int | None = None,
    ) -> bytes:
        """Return a current, entirely local map image."""
        data = self.coordinator.data
        requested_width = min(max(width or 1024, 256), 2048)
        requested_height = min(max(height or 1024, 256), 2048)
        # The floor plan object is cached by the coordinator between map
        # refreshes, so identity is stable; the pose is re-fetched every
        # cycle and must be compared by value.
        cache_key = (
            id(data.floor_plan),
            data.pose,
            data.operational.current_area,
            requested_width,
            requested_height,
        )
        if cache_key == self._cached_image_key and self._cached_image is not None:
            return self._cached_image
        image = await self.hass.async_add_executor_job(
            partial(
                render_floor_plan,
                data.floor_plan,
                data.pose,
                data.operational.current_area,
                width=requested_width,
                height=requested_height,
            )
        )
        self._cached_image_key = cache_key
        self._cached_image = image
        return image

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Expose whether the marker is exact or a room-level fallback."""
        data = self.coordinator.data
        position = resolve_robot_map_position(
            data.floor_plan, data.pose, data.operational.current_area
        )
        return {
            "robot_location_source": position[2]
            if position is not None
            else "unavailable"
        }
