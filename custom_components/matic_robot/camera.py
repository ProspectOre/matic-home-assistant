"""Local room and photorealistic map cameras for Matic Hermes."""

from __future__ import annotations

import asyncio
from functools import partial

from homeassistant.components.camera import Camera
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.floor_plan import (
    render_floor_plan,
    resolve_robot_map_position,
    robot_location_source,
)
from .client.models import HermesCollectionEntry, RobotState
from .client.slam_map import (
    decode_slam_structure_tile,
    decode_slam_tile,
    render_slam_map,
)
from .entity import MaticEntity
from .slam_map_store import SlamMapStore
from .slam_scene import pose_api_url, scene_api_url

PARALLEL_UPDATES = 0
MAX_CAMERA_DIMENSION = 4096


def _floor_render_identity(store: SlamMapStore, data: RobotState) -> tuple[object, ...]:
    """Return the private map identity that one camera render may disclose."""
    return (
        store.mission_identity,
        data.floor_plan,
        store.floor_plan_is_current(data.floor_plan),
    )


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
    _unrecorded_attributes = frozenset({"matic_entry_id"})

    def __init__(self, entry: MaticConfigEntry) -> None:
        Camera.__init__(self)
        MaticEntity.__init__(self, entry)
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_map"
        self._store = entry.runtime_data.slam_map
        self._published_floor_coherent = self._store.floor_plan_is_current(
            self.coordinator.data.floor_plan
        )
        self._cached_image_key: tuple[object, ...] | None = None
        self._cached_image: bytes | None = None

    async def async_added_to_hass(self) -> None:
        """Refresh the entity when map and floor identities become coherent."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self._store.async_add_listener(self._async_handle_store_update)
        )

    @callback
    def _handle_coordinator_update(self) -> None:
        """Publish coordinator state and remember its coherence classification."""
        self._published_floor_coherent = self._store.floor_plan_is_current(
            self.coordinator.data.floor_plan
        )
        super()._handle_coordinator_update()

    @callback
    def _async_handle_store_update(self) -> None:
        """Publish only store changes that cross the floor-coherence boundary."""
        floor_plan_coherent = self._store.floor_plan_is_current(
            self.coordinator.data.floor_plan
        )
        if floor_plan_coherent == self._published_floor_coherent:
            return
        self._published_floor_coherent = floor_plan_coherent
        self.async_write_ha_state()

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes:
        """Return the current labeled room map."""
        data = self.coordinator.data
        floor_plan_coherent = self._store.floor_plan_is_current(data.floor_plan)
        render_floor_identity = _floor_render_identity(self._store, data)
        requested_width = min(max(width or 1024, 256), MAX_CAMERA_DIMENSION)
        requested_height = min(max(height or 1024, 256), MAX_CAMERA_DIMENSION)
        cache_key = (
            id(data.floor_plan),
            floor_plan_coherent,
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
                data.floor_plan if floor_plan_coherent else None,
                data.pose if floor_plan_coherent else None,
                data.operational.current_area if floor_plan_coherent else None,
                width=requested_width,
                height=requested_height,
            )
        )
        if _floor_render_identity(self._store, self.coordinator.data) != (
            render_floor_identity
        ):
            self._cached_image_key = None
            self._cached_image = None
            return await self.hass.async_add_executor_job(
                partial(
                    render_floor_plan,
                    None,
                    None,
                    None,
                    width=requested_width,
                    height=requested_height,
                )
            )
        self._cached_image_key = cache_key
        self._cached_image = image
        return image

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Expose exact-position or non-positional room-presence availability."""
        data = self.coordinator.data
        floor_plan_coherent = self._store.floor_plan_is_current(data.floor_plan)
        return {
            "matic_entry_id": self._config_entry.entry_id,
            "map_floor_coherent": floor_plan_coherent,
            "map_session_verified": getattr(
                self._store, "live_session_verified", floor_plan_coherent
            ),
            "robot_location_source": robot_location_source(
                data.floor_plan if floor_plan_coherent else None,
                data.pose,
                data.operational.current_area,
            ),
            "source": "local_room_map",
        }


class MaticPhotorealisticMapCamera(MaticEntity, Camera):
    """Accumulate and render Matic's private local color SLAM tiles."""

    _attr_translation_key = "photorealistic_map"
    _attr_content_type = "image/png"
    _unrecorded_attributes = frozenset({"matic_entry_id"})
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
        self._published_floor_coherent = self._store.floor_plan_is_current(
            self.coordinator.data.floor_plan
        )
        self._cached_key: tuple[object, ...] | None = None
        self._cached_image: bytes | None = None
        self._render_lock = asyncio.Lock()

    async def async_added_to_hass(self) -> None:
        """Refresh the entity when map and floor identities become coherent."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self._store.async_add_listener(self._async_handle_store_update)
        )

    @callback
    def _handle_coordinator_update(self) -> None:
        """Publish coordinator state and remember its coherence classification."""
        self._published_floor_coherent = self._store.floor_plan_is_current(
            self.coordinator.data.floor_plan
        )
        super()._handle_coordinator_update()

    @callback
    def _async_handle_store_update(self) -> None:
        """Publish only store changes that cross the floor-coherence boundary."""
        floor_plan_coherent = self._store.floor_plan_is_current(
            self.coordinator.data.floor_plan
        )
        if floor_plan_coherent == self._published_floor_coherent:
            return
        self._published_floor_coherent = floor_plan_coherent
        self._cached_key = None
        self._cached_image = None
        self.async_write_ha_state()

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes:
        """Fetch one current tile and render the accumulated isometric map."""
        requested_width = min(max(width or 1024, 256), MAX_CAMERA_DIMENSION)
        requested_height = min(max(height or 1024, 256), MAX_CAMERA_DIMENSION)
        data = self.coordinator.data
        floor_plan_coherent = self._store.floor_plan_is_current(data.floor_plan)
        if not floor_plan_coherent:
            self._cached_key = None
            self._cached_image = None
            return await self.hass.async_add_executor_job(
                partial(
                    render_floor_plan,
                    None,
                    None,
                    None,
                    width=requested_width,
                    height=requested_height,
                )
            )
        key: tuple[object, ...] = (
            self._store.revision,
            id(data.floor_plan),
            floor_plan_coherent,
            data.pose,
            data.operational.current_area,
            requested_width,
            requested_height,
        )
        if key == self._cached_key and self._cached_image is not None:
            return self._cached_image
        async with self._render_lock:
            data = self.coordinator.data
            floor_plan_coherent = self._store.floor_plan_is_current(data.floor_plan)
            render_floor_identity = _floor_render_identity(self._store, data)
            key = (
                self._store.revision,
                id(data.floor_plan),
                floor_plan_coherent,
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
                    floor_plan_coherent=floor_plan_coherent,
                    width=requested_width,
                    height=requested_height,
                )
            )
            if _floor_render_identity(self._store, self.coordinator.data) != (
                render_floor_identity
            ):
                self._cached_key = None
                self._cached_image = None
                return await self.hass.async_add_executor_job(
                    partial(
                        render_floor_plan,
                        None,
                        None,
                        None,
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
        data = self.coordinator.data
        floor_plan_coherent = self._store.floor_plan_is_current(data.floor_plan)
        return {
            "matic_entry_id": self._config_entry.entry_id,
            "cached_tiles": self._store.tile_count,
            "structural_tiles": self._store.structure_tile_count,
            "map_complete": self._store.map_complete,
            "map_revision": self._store.revision,
            "map_floor_coherent": floor_plan_coherent,
            "map_session_verified": getattr(
                self._store, "live_session_verified", floor_plan_coherent
            ),
            "robot_location_source": robot_location_source(
                data.floor_plan if floor_plan_coherent else None,
                data.pose,
                data.operational.current_area,
            ),
            "source": "local_robot_slam",
            "scene_url": scene_api_url(self._config_entry.entry_id),
            "pose_url": pose_api_url(self._config_entry.entry_id),
        }


def _render_photorealistic_entries(
    entries: tuple[HermesCollectionEntry, ...],
    structure_entries: tuple[HermesCollectionEntry, ...],
    state: RobotState,
    *,
    floor_plan_coherent: bool,
    width: int,
    height: int,
) -> bytes:
    """Decode and render the full private map away from the event loop."""
    tiles = tuple(decode_slam_tile(entry) for entry in entries)
    structures = tuple(decode_slam_structure_tile(entry) for entry in structure_entries)
    floor_plan = state.floor_plan if floor_plan_coherent else None
    position = (
        resolve_robot_map_position(
            floor_plan, state.pose, state.operational.current_area
        )
        if floor_plan is not None
        else None
    )
    return render_slam_map(
        tiles,
        structure_tiles=structures,
        floor_plan=floor_plan,
        robot_position=position,
        width=width,
        height=height,
    )
