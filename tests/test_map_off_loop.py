"""Map, area and import work stays off the event loop; readers share a decode."""

from __future__ import annotations

import asyncio
import gc
import json
import weakref
from threading import get_ident
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from google.protobuf.message import DecodeError
from homeassistant.core import HomeAssistant
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot import slam_decoded_map as decoded_map
from custom_components.matic_robot import slam_map_store as storage
from custom_components.matic_robot.area_views import MaticAreasView
from custom_components.matic_robot.camera import _map_view, _render_photorealistic_tiles
from custom_components.matic_robot.client.models import (
    FloorPlan,
    HermesCollectionEntry,
    MappedFloor,
    Room,
)
from custom_components.matic_robot.client.slam_scene import encode_slam_scene
from custom_components.matic_robot.client.slam_tiles import (
    decode_slam_structure_tile,
    decode_slam_tile,
)
from custom_components.matic_robot.slam_decoded_map import decode_photo_page
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
        decoded = await store.async_decoded_map()

        assert decoded.revision == store.revision
        assert decoded.identity == store.mission_identity
        assert decoded.tiles == tiles
        assert decoded.structure_tiles == structure_tiles
        assert _encode_scene(decoded.tiles, plan).payload == encode_slam_scene(
            tiles, floor_plan=plan
        )
        assert _encode_history_scene(
            decoded.tiles, decoded.structure_tiles, plan
        ) == encode_slam_scene(tiles, floor_plan=plan, structure_tiles=structure_tiles)
        state = _map_view(_state(floor_plan=None))
        assert _render_photorealistic_tiles(
            decoded.tiles,
            decoded.structure_tiles,
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


async def test_pages_are_validated_and_digested_off_the_event_loop(
    hass: HomeAssistant,
) -> None:
    loop_thread = get_ident()
    threads: list[int] = []
    original = decoded_map.decode_photo_page

    def decode(entry):
        threads.append(get_ident())
        return original(entry)

    with patch.object(storage, "decode_photo_page", decode):
        store, photos, _structures = await _filled_store(hass, 2, 5)
        revision = store.revision
        await store.async_add(photos[0])

    assert len(threads) == len(photos) + 1
    assert loop_thread not in threads
    assert store.revision == revision
    await store.async_shutdown()


def _inline_executor(hass: HomeAssistant):
    """Run executor jobs on the loop for weak-reference checks.

    A pool worker keeps its last job, with its arguments and result, until it
    takes the next one, so a pooled job can briefly outlive every reader.
    """

    def run(target, *args):
        future = hass.loop.create_future()
        try:
            future.set_result(target(*args))
        except Exception as err:
            future.set_exception(err)
        return future

    return run


async def test_readers_of_one_revision_share_one_decode(hass: HomeAssistant) -> None:
    store, _photos, _structures = await _filled_store(hass, 2, 7)
    jobs: list[str] = []
    executor = _inline_executor(hass)

    def counting(target, *args):
        jobs.append(target.__name__)
        return executor(target, *args)

    with patch.object(hass, "async_add_executor_job", counting):
        readers = [asyncio.ensure_future(store.async_decoded_map()) for _ in range(3)]
        await asyncio.wait(readers)
        first = readers[0].result()
        assert all(reader.result() is first for reader in readers)
        assert await store.async_decoded_map() is first
        assert jobs == ["decode_map"]

        held = weakref.ref(first)
        del first, readers
        gc.collect()
        assert held() is None
        await store.async_decoded_map()
        assert jobs == ["decode_map", "decode_map"]

        await store.async_add(textured_photo_entry(9, 9, seed=1))
        assert (await store.async_decoded_map()).revision == store.revision
        assert jobs[-1] == "decode_map"
    await store.async_shutdown()


async def test_a_cancelled_reader_does_not_cancel_the_shared_decode(
    hass: HomeAssistant,
) -> None:
    store, _photos, _structures = await _filled_store(hass, 2, 9)
    reader = asyncio.create_task(store.async_decoded_map())
    await asyncio.sleep(0)
    reader.cancel()
    decoded = await store.async_decoded_map()
    assert decoded.revision == store.revision
    await store.async_shutdown()


async def test_a_stale_or_failed_decode_is_not_reused() -> None:
    jobs: list[asyncio.Future[decoded_map.DecodedMap]] = []

    def submit(_target, *_args):
        jobs.append(asyncio.get_running_loop().create_future())
        return jobs[-1]

    hass = SimpleNamespace(async_add_executor_job=submit)
    shared = decoded_map.SharedDecode()
    older = asyncio.ensure_future(shared.async_get(hass, 1, None, (), ()))
    newer = asyncio.ensure_future(shared.async_get(hass, 2, None, (), ()))
    await asyncio.sleep(0)
    jobs[0].set_result(decoded_map.DecodedMap(1, None, (), ()))
    assert (await older).revision == 1
    jobs[1].set_exception(DecodeError("bad page"))
    with pytest.raises(DecodeError):
        await newer

    retry = asyncio.ensure_future(shared.async_get(hass, 1, None, (), ()))
    await asyncio.sleep(0)
    assert len(jobs) == 3
    retry.cancel()


async def test_load_takes_digests_from_the_snapshot_decode(
    hass: HomeAssistant,
) -> None:
    store, photos, _structures = await _filled_store(hass, 2, 3)
    await store.async_shutdown()

    restored = storage.SlamMapStore(hass, "tile-cache-2-3")
    with patch.object(storage, "decode_photo_page", wraps=decode_photo_page) as page:
        await restored.async_load()
        revision = restored.revision
        await restored.async_add(photos[0])

    page.assert_called_once()
    assert restored.revision == revision
    await restored.async_remove()
    assert restored._digests.layer(False) == restored._digests.layer(True) == {}


class _TrackedEntry(HermesCollectionEntry):
    __slots__ = ("__weakref__",)


def _tracked(entry: HermesCollectionEntry) -> _TrackedEntry:
    return _TrackedEntry(entry.key, entry.value)


async def test_pages_leaving_their_layer_are_freed(hass: HomeAssistant) -> None:
    store = storage.SlamMapStore(hass, "tile-cache-free")
    replaced = _tracked(textured_photo_entry(0, 0, seed=1))
    discarded = _tracked(textured_photo_entry(0, 0, seed=2, mission_id=2))
    with patch.object(hass, "async_add_executor_job", _inline_executor(hass)):
        await store.async_add(replaced)
        for seed in range(3, 203):
            await store.async_add(textured_photo_entry(0, 0, seed=seed))
        await store.async_add(discarded)
    assert len(store._candidates) == 1
    refs = (weakref.ref(replaced), weakref.ref(discarded))
    del replaced, discarded

    store.set_expected_mission_id(3)
    gc.collect()

    assert [ref() for ref in refs] == [None, None]
    assert not store._candidates
    assert store._digests.layer(False).keys() == store._entries.keys()
    assert store.decoded_tiles() == (
        decode_slam_tile(textured_photo_entry(0, 0, seed=202)),
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
