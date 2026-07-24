"""Local room and photorealistic map cameras for Matic Hermes."""

from __future__ import annotations

from functools import partial
from time import monotonic

from google.protobuf.message import DecodeError
from homeassistant.components.camera import Camera
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.exceptions import MaticError
from .client.floor_plan import render_floor_plan, resolve_robot_map_position
from .client.slam_map import render_slam_map
from .const import UPDATE_INTERVAL_SECONDS
from .entity import MaticEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up both entirely local Matic map views."""
    async_add_entities([MaticMapCamera(entry), MaticPhotorealisticMapCamera(entry)])


class MaticMapCamera(MaticEntity, Camera):
    """Render the stable labeled room map."""

    _attr_translation_key = "map"
    _attr_content_type = "image/png"

    def __init__(self, entry: MaticConfigEntry) -> None:
        Camera.__init__(self)
        MaticEntity.__init__(self, entry)
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_map"
        self._cached_image_key: tuple[object, ...] | None = None
        self._cached_image: bytes | None = None

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes:
        """Return the current labeled room map."""
        data = self.coordinator.data
        requested_width = min(max(width or 1024, 256), 2048)
        requested_height = min(max(height or 1024, 256), 2048)
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


class MaticPhotorealisticMapCamera(MaticEntity, Camera):
    """Accumulate and render Matic's private local color SLAM tiles."""

    _attr_translation_key = "photorealistic_map"
    _attr_content_type = "image/png"

    def __init__(self, entry: MaticConfigEntry) -> None:
        Camera.__init__(self)
        MaticEntity.__init__(self, entry)
        self._attr_unique_id = (
            f"{self.coordinator.data.info.serial_number}_photorealistic_map"
        )
        self._store = entry.runtime_data.slam_map
        self._refresh_due = 0.0
        self._cached_key: tuple[int, int, int] | None = None
        self._cached_image: bytes | None = None

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes:
        """Fetch one current tile and render the accumulated isometric map."""
        requested_width = min(max(width or 1024, 256), 2048)
        requested_height = min(max(height or 1024, 256), 2048)
        now = monotonic()
        if now >= self._refresh_due:
            self._refresh_due = now + UPDATE_INTERVAL_SECONDS
            await self._async_refresh_tile()

        key = (self._store.revision, requested_width, requested_height)
        if key == self._cached_key and self._cached_image is not None:
            return self._cached_image
        tiles = self._store.decoded_tiles()
        image = await self.hass.async_add_executor_job(
            partial(
                render_slam_map,
                tiles,
                width=requested_width,
                height=requested_height,
            )
        )
        self._cached_key = key
        self._cached_image = image
        return image

    async def async_update(self) -> None:
        """Accumulate the latest tile while Home Assistant polls the camera."""
        now = monotonic()
        if now < self._refresh_due:
            return
        self._refresh_due = now + UPDATE_INTERVAL_SECONDS
        await self._async_refresh_tile()

    async def _async_refresh_tile(self) -> None:
        try:
            entry = await self.coordinator.client.async_get_slam_tile_entry()
            await self._store.async_add(entry)
        except DecodeError, MaticError:
            pass

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Expose cache readiness without exposing private map content."""
        return {
            "cached_tiles": self._store.tile_count,
            "source": "local_robot_slam",
        }
