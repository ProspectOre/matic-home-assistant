"""Capture complete, stable map revisions into private SLAM history."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from functools import partial

from google.protobuf.message import DecodeError
from homeassistant.core import HomeAssistant

from .client.models import FloorPlan
from .client.slam_scene import encode_slam_scene
from .client.slam_tiles import SlamStructureTile, SlamTile
from .slam_history import SlamHistoryStore
from .slam_map_store import MAP_SETTLE_SECONDS, SlamMapIdentity, SlamMapStore


async def async_collect_slam_history(
    hass: HomeAssistant,
    slam_map: SlamMapStore,
    history: SlamHistoryStore,
    floor_plan: Callable[[], FloorPlan | None],
    floor_plan_listener: Callable[[Callable[[], None]], Callable[[], None]]
    | None = None,
) -> None:
    """Capture a checkpoint after each stable, complete map revision."""
    changed = asyncio.Event()
    changed.set()
    remove_listeners = [slam_map.async_add_listener(changed.set)]
    if floor_plan_listener is not None:
        observed_floor_plan = floor_plan()

        def _floor_plan_changed() -> None:
            nonlocal observed_floor_plan
            current_floor_plan = floor_plan()
            if current_floor_plan is observed_floor_plan:
                return
            floor_plan_changed = current_floor_plan != observed_floor_plan
            observed_floor_plan = current_floor_plan
            if floor_plan_changed:
                changed.set()

        remove_listeners.append(floor_plan_listener(_floor_plan_changed))
    try:
        while True:
            await changed.wait()
            changed.clear()
            revision = slam_map.revision
            await asyncio.sleep(MAP_SETTLE_SECONDS)
            if revision != slam_map.revision:
                changed.set()
                continue
            if not slam_map.map_complete:
                continue
            identity = slam_map.mission_identity
            current_floor_plan = floor_plan()
            # ``map_complete`` is false until both live collections have
            # revalidated a persisted map for this process. Once complete,
            # retain only a mission-correlated snapshot.
            if not _mission_matches_floor_plan(identity, current_floor_plan):
                continue
            decoded = await slam_map.async_decoded_map()
            try:
                scene = await hass.async_add_executor_job(
                    partial(
                        _encode_history_scene,
                        decoded.tiles,
                        decoded.structure_tiles,
                        current_floor_plan,
                    )
                )
            except DecodeError:
                continue
            if (
                revision != slam_map.revision
                or identity != slam_map.mission_identity
                or current_floor_plan != floor_plan()
            ):
                changed.set()
                continue
            assert identity is not None
            await history.async_add(
                scene,
                revision,
                mission_token=identity.mission_token,
            )
    finally:
        for remove_listener in remove_listeners:
            remove_listener()


def _encode_history_scene(
    tiles: tuple[SlamTile, ...],
    structure_tiles: tuple[SlamStructureTile, ...],
    floor_plan: FloorPlan | None,
) -> bytes:
    return encode_slam_scene(
        tiles, floor_plan=floor_plan, structure_tiles=structure_tiles
    )


def _mission_matches_floor_plan(
    identity: SlamMapIdentity | None, floor_plan: FloorPlan | None
) -> bool:
    return identity is not None and identity.matches_floor_plan(floor_plan)
