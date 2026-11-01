"""Exercise three independent large-map stores during floor transitions."""

from __future__ import annotations

import asyncio
import gc
import json
import sys
from time import perf_counter

try:
    import resource
except ImportError:  # Windows does not expose process high-water RSS.
    resource = None

from custom_components.matic_robot import slam_map_store as storage
from custom_components.matic_robot.client.slam_tiles import decode_slam_tile
from custom_components.matic_robot.slam_map_store import (
    MAX_RESIDENT_BYTES,
    SlamMapStore,
)
from custom_components.matic_robot.slam_snapshot import stored_bytes
from tests.test_slam_map import synthetic_slam_entry, synthetic_structure_entry


def _peak_rss_bytes() -> int | None:
    if resource is None or sys.platform not in {"darwin", "linux"}:
        return None
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return value if sys.platform == "darwin" else value * 1024


async def test_resident_byte_accounting_survives_replacement_eviction_and_reload(
    hass, monkeypatch
):
    store = SlamMapStore(hass, "byte-accounting")
    store.set_expected_mission_id(1)

    def check() -> None:
        actual = stored_bytes(store._entries, store._structure_entries)
        for candidate in store._candidates.values():
            candidate_bytes = stored_bytes(
                candidate.entries, candidate.structure_entries
            )
            assert candidate.raw_bytes == candidate_bytes
            actual += candidate_bytes
        assert store.resident_bytes() == actual

    photo = synthetic_slam_entry(mission_id=1)
    await store.async_add(photo)
    await store.async_add_structure(synthetic_structure_entry(mission_id=1))
    check()
    await store.async_add(synthetic_slam_entry(mission_id=1, with_rgb=False))
    check()

    second_photo = synthetic_slam_entry(mission_id=2)
    second_structure = synthetic_structure_entry(mission_id=2)
    budget = len(second_photo.key) + len(second_photo.value)
    budget += len(second_structure.key) + len(second_structure.value)
    monkeypatch.setattr(storage, "MAX_CANDIDATE_BYTES", budget)
    await store.async_add(second_photo)
    await store.async_add_structure(second_structure)
    check()
    await store.async_add(synthetic_slam_entry(mission_id=3))
    check()
    await store.async_add_structure(synthetic_structure_entry(mission_id=3))
    check()
    store.set_expected_mission_id(3)
    check()

    monkeypatch.setattr(storage, "MAX_TILES", 1)
    await store.async_add(synthetic_slam_entry(page_x=10, mission_id=3))
    await store.async_add_structure(synthetic_structure_entry(page_x=10, mission_id=3))
    check()
    await store.async_shutdown()
    restored = SlamMapStore(hass, "byte-accounting")
    await restored.async_load()
    assert restored.resident_bytes() == stored_bytes(
        restored._entries, restored._structure_entries
    )
    await restored.async_remove()
    assert restored.resident_bytes() == 0


async def test_resident_byte_accounting_after_candidate_pruning_and_byte_eviction(
    hass, monkeypatch
):
    store = SlamMapStore(hass, "byte-pruning")
    store.set_expected_mission_id(1)
    await store.async_add(synthetic_slam_entry(mission_id=1))
    await store.async_add_structure(synthetic_structure_entry(mission_id=1))

    for mission in (2, 3, 4):
        await store.async_add(synthetic_slam_entry(mission_id=mission))
    assert [candidate.mission_id for candidate in store._candidates.values()] == [3, 4]
    assert store.resident_bytes() == stored_bytes(
        store._entries, store._structure_entries
    ) + sum(
        stored_bytes(candidate.entries, candidate.structure_entries)
        for candidate in store._candidates.values()
    )

    store.set_expected_mission_id(3)
    assert [candidate.mission_id for candidate in store._candidates.values()] == [3]
    structure = synthetic_structure_entry(mission_id=3)
    await store.async_add_structure(structure)
    assert store.mission_identity.mission_id == 3
    assert store.resident_bytes() == stored_bytes(
        store._entries, store._structure_entries
    )

    monkeypatch.setattr(storage, "MAX_STORED_BYTES", store.resident_bytes() - 1)
    await store.async_add_structure(structure)
    assert store.health.truncated
    assert (
        store.resident_bytes()
        == stored_bytes(store._entries, store._structure_entries)
        == 0
    )
    await store.async_shutdown()


async def test_three_large_maps_switch_floor_and_restore_independently(hass):
    """Interleave six full layers per floor and retain distinct robot maps."""
    page_count = 2050
    stores = [SlamMapStore(hass, f"scale-robot-{robot}") for robot in range(3)]
    started = perf_counter()
    baseline_rss = _peak_rss_bytes()
    for store in stores:
        store.set_expected_mission_id(1)

    async def add_floor(mission: int) -> None:
        for index in range(page_count):
            for robot, store in enumerate(stores):
                page_x = robot * 100 + index % 64
                page_y = index // 64
                photo = synthetic_slam_entry(
                    page_x=page_x, page_y=page_y, mission_id=mission
                )
                structure = synthetic_structure_entry(
                    page_x=page_x, page_y=page_y, mission_id=mission
                )
                await store.async_add(photo)
                await store.async_add_structure(structure)
            # Real subscription reads yield between messages. Interleave other
            # HA work instead of constructing an artificial uninterrupted burst.
            await asyncio.sleep(0)

    await add_floor(1)
    active_seconds = perf_counter() - started
    assert all(
        store.tile_count == store.structure_tile_count == page_count for store in stores
    )
    assert all(
        store.live_session_verified and not store.health.truncated for store in stores
    )
    active_bytes = sum(store.resident_bytes() for store in stores)
    active_peak_rss = _peak_rss_bytes()

    await add_floor(2)
    candidate_seconds = perf_counter() - started - active_seconds
    staged_bytes = sum(store.resident_bytes() for store in stores)
    staged_peak_rss = _peak_rss_bytes()
    assert staged_bytes > active_bytes
    assert all(store.resident_bytes() <= MAX_RESIDENT_BYTES for store in stores)
    assert all(store.mission_identity.mission_id == 1 for store in stores)
    assert all(not store.live_session_verified for store in stores)

    for robot, store in enumerate(stores):
        store.set_expected_mission_id(2)
        assert store.mission_identity.mission_id == 2
        assert store.tile_count == store.structure_tile_count == page_count
        assert not store.health.truncated
        for other in stores[robot + 1 :]:
            assert other.mission_identity.mission_id == 1

    for store in stores:
        await store.async_shutdown()
    stores.clear()
    del store
    gc.collect()
    restored = [SlamMapStore(hass, f"scale-robot-{robot}") for robot in range(3)]
    for robot, store in enumerate(restored):
        await store.async_load()
        assert store.mission_identity.mission_id == 2
        assert store.tile_count == store.structure_tile_count == page_count
        assert not store.live_session_verified and not store.health.truncated
        assert decode_slam_tile(store.entries()[0]).page_x == robot * 100
        await store.async_shutdown()

    print(
        "MULTI_ROBOT_CAPACITY "
        + json.dumps(
            {
                "robots": 3,
                "floors_per_robot": 2,
                "pages_per_layer": page_count,
                "active_raw_bytes": active_bytes,
                "staged_raw_bytes": staged_bytes,
                "peak_rss_before_bytes": baseline_rss,
                "peak_rss_active_bytes": active_peak_rss,
                "peak_rss_staged_bytes": staged_peak_rss,
                "peak_rss_after_bytes": _peak_rss_bytes(),
                "active_seconds": round(active_seconds, 3),
                "candidate_seconds": round(candidate_seconds, 3),
                "total_seconds": round(perf_counter() - started, 3),
            },
            sort_keys=True,
        )
    )
