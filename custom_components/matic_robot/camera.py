"""Local room and photorealistic map cameras for Matic Hermes."""

from __future__ import annotations

import asyncio
from functools import partial

from homeassistant.components.camera import Camera
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.floor_plan import render_floor_plan, resolve_robot_map_position
from .client.models import HermesCollectionEntry, RobotState
from .client.slam_map import (
    decode_slam_structure_tile,
    decode_slam_tile,
    render_slam_map,
)
from .entity import MaticEntity
from .slam_scene import pose_api_url, scene_api_url

PARALLEL_UPDATES = 0
MAX_CAMERA_DIMENSION = 4096


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
        requested_width = min(max(width or 1024, 256), MAX_CAMERA_DIMENSION)
        requested_height = min(max(height or 1024, 256), MAX_CAMERA_DIMENSION)
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
    # Unlike the geometric room map, this image can reveal the interior of a
    # home. Keep it out of the state machine and camera proxy unless an
    # administrator makes the explicit decision to enable it.
    _attr_entity_registry_enabled_default = False

    def __init__(self, entry: MaticConfigEntry) -> None:
        Camera.__init__(self)
        MaticEntity.__init__(self, entry)
        self._attr_unique_id = (
            f"{self.coordinator.data.info.serial_number}_photorealistic_map"
        )
        self._store = entry.runtime_data.slam_map
        self._cached_key: tuple[object, ...] | None = None
        self._cached_image: bytes | None = None
        self._render_lock = asyncio.Lock()

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes:
        """Fetch one current tile and render the accumulated isometric map."""
        requested_width = min(max(width or 1024, 256), MAX_CAMERA_DIMENSION)
        requested_height = min(max(height or 1024, 256), MAX_CAMERA_DIMENSION)
        data = self.coordinator.data
        key = (
            self._store.revision,
            id(data.floor_plan),
            data.pose,
            data.operational.current_area,
            requested_width,
            requested_height,
        )
        if key == self._cached_key and self._cached_image is not None:
            return self._cached_image
        async with self._render_lock:
            data = self.coordinator.data
            key = (
                self._store.revision,
                id(data.floor_plan),
                data.pose,
                data.operational.current_area,
                requested_width,
                requested_height,
            )
            if key == self._cached_key and self._cached_image is not None:
                return self._cached_image
            entries = self._store.entries()
            structure_entries = self._store.structure_entries()
            image = await self.hass.async_add_executor_job(
                partial(
                    _render_photorealistic_entries,
                    entries,
                    structure_entries,
                    data,
                    width=requested_width,
                    height=requested_height,
                )
            )
            self._cached_key = key
            self._cached_image = image
            return image

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Expose cache readiness without exposing private map content."""
        return {
            "cached_tiles": self._store.tile_count,
            "structural_tiles": self._store.structure_tile_count,
            "map_complete": self._store.map_complete,
            "map_revision": self._store.revision,
            "source": "local_robot_slam",
            "scene_url": scene_api_url(self._config_entry.entry_id),
            "pose_url": pose_api_url(self._config_entry.entry_id),
        }


def _render_photorealistic_entries(
    entries: tuple[HermesCollectionEntry, ...],
    structure_entries: tuple[HermesCollectionEntry, ...],
    state: RobotState,
    *,
    width: int,
    height: int,
) -> bytes:
    """Decode and render the full private map away from the event loop."""
    tiles = tuple(decode_slam_tile(entry) for entry in entries)
    structures = tuple(decode_slam_structure_tile(entry) for entry in structure_entries)
    position = resolve_robot_map_position(
        state.floor_plan, state.pose, state.operational.current_area
    )
    return render_slam_map(
        tiles,
        structure_tiles=structures,
        floor_plan=state.floor_plan,
        robot_position=position,
        width=width,
        height=height,
    )
