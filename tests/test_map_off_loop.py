"""Map pages decode once off the event loop; area and import work stay off it."""

from __future__ import annotations

import asyncio
import json
from threading import get_ident
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot import slam_map_store as storage
from custom_components.matic_robot import slam_tile_cache
from custom_components.matic_robot.area_views import MaticAreasView
from custom_components.matic_robot.camera import _map_view, _render_photorealistic_tiles
from custom_components.matic_robot.client.models import (
    FloorPlan,
    MappedFloor,
    Room,
)
from custom_components.matic_robot.client.slam_scene import encode_slam_scene
from custom_components.matic_robot.client.slam_tiles import (
    decode_slam_structure_tile,
    decode_slam_tile,
)
from custom_components.matic_robot.slam_history_collector import (
    _encode_history_scene,
)
from custom_components.matic_robot.slam_history_view import (
    MaticSlamHistoryImportView,
    _read_json_object,
)
from custom_components.matic_robot.slam_render import render_slam_map
from custom_components.matic_robot.slam_scene import _encode_scene
from tests.slam_textured_map import textured_map, textured_photo_entry
from tests.test_entities import _state
from tests.test_slam_scene import _entry, _hass, _json_request, _request, _runtime


def _plan() -> FloorPlan:
    return FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                "room-1",
                "Room A",
                "p1",
                b"a",
                ((-0.3, -0.3), (0.2, -0.3), (0.2, 0.2), (-0.3, 0.2)),
            ),
            Room(
                "room-2",
                "Room B",
                "p2",
                b"b",
                ((0.2, -0.3), (0.6, -0.3), (0.6, 0.4), (0.2, 0.4)),
            ),
        ),
        "Floor",
        (MappedFloor(1, "Floor", "token"),),
    )


async def _filled_store(hass: HomeAssistant, side: int, seed: int):
    photos, structures = textured_map(side, seed=seed)
    store = storage.SlamMapStore(hass, f"tile-cache-{side}-{seed}")
    for photo, structure in zip(photos, structures, strict=True):
        await store.async_add(photo)
        await store.async_add_structure(structure)
    return store, photos, structures


async def test_readers_match_the_full_decode_of_every_entry(
    hass: HomeAssistant,
) -> None:
    """Scene, history and camera bytes are unchanged for the same pages."""
    plan = _plan()
    for side, seed in ((3, 0), (8, 11)):
        store, photos, structures = await _filled_store(hass, side, seed)
        tiles = tuple(decode_slam_tile(entry) for entry in photos)
        structure_tiles = tuple(decode_slam_structure_tile(e) for e in structures)

        assert store.decoded_tiles() == tiles
        assert store.decoded_structure_tiles() == structure_tiles
        assert _encode_scene(store.decoded_tiles(), plan).payload == encode_slam_scene(
            tiles, floor_plan=plan
        )
        assert _encode_history_scene(
            store.decoded_tiles(), store.decoded_structure_tiles(), plan
        ) == encode_slam_scene(tiles, floor_plan=plan, structure_tiles=structure_tiles)
        state = _map_view(_state(floor_plan=None))
        assert _render_photorealistic_tiles(
            store.decoded_tiles(),
            store.decoded_structure_tiles(),
            state,
            floor_plan_coherent=False,
            width=320,
            height=240,
        ) == render_slam_map(
            tiles,
            structure_tiles=structure_tiles,
            floor_plan=None,
            robot_position=None,
            width=320,
            height=240,
        )
        await store.async_shutdown()


async def test_pages_decode_once_off_the_event_loop(hass: HomeAssistant) -> None:
    loop_thread = get_ident()
    decode_threads: list[int] = []
    original = storage.decode_slam_tile

    def decode(entry):
        decode_threads.append(get_ident())
        return original(entry)

    with patch.object(storage, "decode_slam_tile", decode):
        store, photos, _structures = await _filled_store(hass, 2, 5)
        first = store.decoded_tiles()
        assert store.decoded_tiles()[0] is first[0]
        await store.async_add(photos[0])

    assert len(decode_threads) == len(photos) + 1
    assert loop_thread not in decode_threads
    await store.async_shutdown()


async def test_load_reuses_the_snapshot_decode(hass: HomeAssistant) -> None:
    store, photos, structures = await _filled_store(hass, 2, 3)
    await store.async_shutdown()

    restored = storage.SlamMapStore(hass, "tile-cache-2-3")
    await restored.async_load()

    assert restored.decoded_tiles() == tuple(map(decode_slam_tile, photos))
    assert restored.decoded_structure_tiles() == tuple(
        map(decode_slam_structure_tile, structures)
    )
    await restored.async_remove()
    assert restored.decoded_tiles() == ()
    assert restored._photo_tiles._tiles == {}


async def test_replaced_pages_are_pruned(hass: HomeAssistant) -> None:
    store = storage.SlamMapStore(hass, "tile-cache-prune")
    for seed in range(200):
        await store.async_add(textured_photo_entry(0, 0, seed=seed))
        await store.async_add(textured_photo_entry(1, 0, seed=seed))

    assert len(store._photo_tiles._tiles) <= 2 + slam_tile_cache._STALE_SLACK + 1
    assert store.decoded_tiles() == (
        decode_slam_tile(textured_photo_entry(0, 0, seed=199)),
        decode_slam_tile(textured_photo_entry(1, 0, seed=199)),
    )
    await store.async_shutdown()


async def test_areas_view_binds_off_the_event_loop() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    loop_thread = get_ident()
    threads: list[int] = []

    def run(target):
        threads.append(get_ident())
        return target()

    async def in_thread(target):
        return await asyncio.to_thread(run, target)

    hass.async_add_executor_job.side_effect = in_thread
    response = await MaticAreasView().get(_request(hass), "entry")

    assert response.status == 200
    assert json.loads(response.body)["rooms"][0]["room_id"] == "room-1"
    assert len(threads) == 1
    assert threads[0] != loop_thread


async def test_areas_view_rechecks_the_floor_after_binding() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    original = runtime.session.floor.value

    async def floor_changes(target):
        result = target()
        runtime.session.floor.value = None
        return result

    hass.async_add_executor_job.side_effect = floor_changes
    response = await MaticAreasView().get(_request(hass), "entry")

    assert response.status == 409
    assert response.headers["X-Matic-Areas-Conflict"] == "map-rechecking"
    assert original is not None


async def test_history_import_parses_the_archive_off_the_event_loop() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    jobs: list[str] = []

    async def record(target):
        jobs.append(target.func.__name__)
        return target()

    hass.async_add_executor_job.side_effect = record
    runtime.slam_history.async_import = AsyncMock(return_value={"generation": 1})
    response = await MaticSlamHistoryImportView().post(
        _json_request(
            hass,
            "POST",
            {"archive": {}, "expected_generation": 0, "request_id": "r"},
        ),
        "entry",
    )

    assert response.status == 200
    assert jobs == ["loads"]


async def test_history_json_reader_bounds_stream_and_rejects_invalid_json() -> None:
    class Chunks:
        def __init__(self, values):
            self.values = list(values)

        async def readany(self):
            return self.values.pop(0) if self.values else b""

    app = {KEY_HASS: _hass(None)}

    with pytest.raises(ValueError, match="request-too-large"):
        await _read_json_object(
            SimpleNamespace(content_length=11, _read_bytes=None), 10
        )
    with pytest.raises(ValueError, match="request-too-large"):
        await _read_json_object(
            SimpleNamespace(content_length=None, _read_bytes=b" " * 11), 10
        )
    with pytest.raises(ValueError, match="request-too-large"):
        await _read_json_object(
            SimpleNamespace(
                content_length=None,
                content=Chunks([b"{" + b" " * 10, b"}"]),
            ),
            10,
        )
    for raw in (b"{", b"\xff", b"[]"):
        with pytest.raises(ValueError, match="invalid-json"):
            await _read_json_object(
                SimpleNamespace(content_length=None, content=Chunks([raw]), app=app), 10
            )
    assert await _read_json_object(
        SimpleNamespace(content_length=None, content=Chunks([b'{"ok":true}']), app=app),
        20,
    ) == {"ok": True}
