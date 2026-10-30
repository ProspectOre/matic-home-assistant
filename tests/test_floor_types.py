"""Tests for carpet and vent outlines from the robot's semantic map."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest
from aiohttp.test_utils import make_mocked_request
from google.protobuf.message import DecodeError
from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.floor_types import (
    MAX_FLOOR_TYPE_POINTS,
    SemanticKind,
    floor_type_layer,
    mission_token,
)
from custom_components.matic_robot.client.models import HermesCollectionEntry
from custom_components.matic_robot.client.slam_map import (
    SlamSemanticTile,
    decode_slam_semantic_tile,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.floor_layers import MaticFloorLayersView
from custom_components.matic_robot.slam_map_store import SlamMapIdentity

from .test_slam_map import synthetic_semantic_entry

MISSION = mission_token(0x1234ABCD)


def _page(
    cells: np.ndarray,
    *,
    page_x: int = 0,
    page_y: int = 0,
    mission: str = MISSION,
) -> SlamSemanticTile:
    return SlamSemanticTile(page_x, page_y, mission, cells.astype(np.uint8).tobytes())


def _blank() -> np.ndarray:
    return np.full((32, 32), SemanticKind.HARD_FLOOR, dtype=np.uint8)


def test_mission_token_matches_a_decoded_page_key() -> None:
    page = decode_slam_semantic_tile(synthetic_semantic_entry())
    assert page.mission_token == MISSION


def test_carpet_rectangle_becomes_one_outline_in_map_metres() -> None:
    cells = _blank()
    cells[4:12, 2:10] = SemanticKind.CARPET
    layer = floor_type_layer([_page(cells, page_x=1, page_y=-1)], mission=MISSION)

    assert layer.page_count == 1
    assert not layer.truncated
    assert layer.layers["vent"] == ()
    (outline,) = layer.layers["carpet"]
    xs = {point[0] for point in outline}
    ys = {point[1] for point in outline}
    # Page (1, -1) starts at cell (32, -32); cells are 1.5 cm.
    assert xs == {round((32 + 2) * 0.015, 3), round((32 + 10) * 0.015, 3)}
    assert ys == {round((-32 + 4) * 0.015, 3), round((-32 + 12) * 0.015, 3)}


def test_rug_with_a_hole_keeps_the_hole_as_its_own_outline() -> None:
    cells = _blank()
    cells[0:20, 0:20] = SemanticKind.CARPET
    cells[8:12, 8:12] = SemanticKind.HARD_FLOOR
    layer = floor_type_layer([_page(cells)], mission=MISSION)
    assert len(layer.layers["carpet"]) == 2


def test_vents_are_traced_and_specks_are_dropped() -> None:
    cells = _blank()
    cells[20:24, 20:28] = SemanticKind.VENT
    cells[0, 0] = SemanticKind.CARPET
    layer = floor_type_layer([_page(cells)], mission=MISSION)
    assert layer.layers["carpet"] == ()
    assert len(layer.layers["vent"]) == 1


def test_pages_from_other_floors_are_ignored() -> None:
    cells = np.full((32, 32), SemanticKind.CARPET, dtype=np.uint8)
    other = mission_token(7)
    layer = floor_type_layer(
        [_page(cells, mission=other)], [_page(cells, mission=other)], mission=MISSION
    )
    assert layer.page_count == 0
    assert layer.layers == {"carpet": (), "vent": ()}


def test_override_cells_replace_the_robot_classification() -> None:
    base = _blank()
    base[0:16, 0:16] = SemanticKind.CARPET
    override = np.zeros((32, 32), dtype=np.uint8)
    override[0:16, 0:16] = SemanticKind.HARD_FLOOR
    override[16:32, 16:32] = SemanticKind.CARPET
    added = np.zeros((32, 32), dtype=np.uint8)
    added[0:4, 0:4] = SemanticKind.VENT

    layer = floor_type_layer(
        [_page(base)],
        [_page(override), _page(added, page_x=1)],
        mission=MISSION,
    )

    assert layer.page_count == 2
    (carpet,) = layer.layers["carpet"]
    assert {point[0] for point in carpet} == {0.24, 0.48}
    assert len(layer.layers["vent"]) == 1


def test_outlines_stop_at_the_point_budget_largest_first() -> None:
    cells = _blank()
    cells[0:20, 0:20] = SemanticKind.CARPET
    cells[24:28, 24:28] = SemanticKind.CARPET
    with patch(
        "custom_components.matic_robot.client.floor_types.MAX_FLOOR_TYPE_POINTS", 5
    ):
        layer = floor_type_layer([_page(cells)], mission=MISSION)
    assert layer.truncated
    assert len(layer.layers["carpet"]) == 1
    assert MAX_FLOOR_TYPE_POINTS > 5


def test_a_class_with_too_many_edges_is_skipped() -> None:
    cells = _blank()
    cells[::4, ::4] = SemanticKind.CARPET
    cells[0:8, 0:8] = SemanticKind.VENT
    with patch(
        "custom_components.matic_robot.client.floor_types.MAX_FLOOR_TYPE_EDGES", 100
    ):
        layer = floor_type_layer([_page(cells)], mission=MISSION)
    assert layer.truncated
    assert layer.layers["carpet"] == ()
    assert len(layer.layers["vent"]) == 1


def test_page_and_raster_bounds_are_enforced() -> None:
    cells = _blank()
    with (
        patch("custom_components.matic_robot.client.floor_types.MAX_SLAM_TILES", 1),
        pytest.raises(DecodeError, match="too many"),
    ):
        floor_type_layer([_page(cells), _page(cells, page_x=1)], mission=MISSION)
    with pytest.raises(DecodeError, match="too large"):
        floor_type_layer(
            [_page(cells), _page(cells, page_x=4000, page_y=4000)], mission=MISSION
        )


def _semantic_entry(cells: np.ndarray) -> HermesCollectionEntry:
    entry = synthetic_semantic_entry(page_x=0, page_y=0)
    template = bytes(index % 7 for index in range(32 * 32))
    return HermesCollectionEntry(
        entry.key, entry.value.replace(template, cells.astype(np.uint8).tobytes())
    )


def _runtime(
    *, mission_id: int | None = 0x1234ABCD, read: AsyncMock | None = None
) -> SimpleNamespace:
    cells = _blank()
    cells[0:8, 0:8] = SemanticKind.CARPET
    pages = (_semantic_entry(cells), HermesCollectionEntry(b"bad", b"bad"))
    identity = None if mission_id is None else SlamMapIdentity(MISSION, mission_id)
    return SimpleNamespace(
        slam_map=SimpleNamespace(mission_identity=identity),
        client=SimpleNamespace(
            async_get_tracked_collection_entries=read
            or AsyncMock(
                side_effect=lambda name, limit: pages if name == "map_semantics" else ()
            )
        ),
    )


def _request(runtime, *, state=ConfigEntryState.LOADED):
    entry = SimpleNamespace(domain=DOMAIN, state=state, runtime_data=runtime)
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_get_entry=MagicMock(return_value=entry)),
        async_add_executor_job=AsyncMock(
            side_effect=lambda target, *args: target(*args)
        ),
    )
    request = make_mocked_request("GET", "/", app={KEY_HASS: hass})
    request["hass_user"] = SimpleNamespace(is_admin=True)
    return request


async def test_view_serves_outlines_and_caches_them_per_floor() -> None:
    runtime = _runtime()
    view = MaticFloorLayersView()

    response = await view.get(_request(runtime), "entry")
    assert response.status == 200
    assert response.headers["Cache-Control"].startswith("private, no-store")
    body = json.loads(response.body)
    assert body["entry_id"] == "entry"
    assert body["page_count"] == 1
    assert body["truncated"] is False
    assert len(body["layers"]["carpet"]) == 1
    assert body["layers"]["vent"] == []

    await view.get(_request(runtime), "entry")
    assert runtime.client.async_get_tracked_collection_entries.await_count == 2

    runtime.slam_map.mission_identity = SlamMapIdentity("other", 7)
    body = json.loads((await view.get(_request(runtime), "entry")).body)
    assert body["page_count"] == 0
    assert runtime.client.async_get_tracked_collection_entries.await_count == 4

    with patch(
        "custom_components.matic_robot.floor_layers.monotonic", return_value=1e12
    ):
        await view.get(_request(runtime), "entry")
    assert runtime.client.async_get_tracked_collection_entries.await_count == 6

    view.clear_entry("entry")
    await view.get(_request(runtime), "entry")
    assert runtime.client.async_get_tracked_collection_entries.await_count == 8


@pytest.mark.parametrize("known_floor", [False, True], ids=["unloaded", "no_floor"])
async def test_view_needs_a_loaded_entry_with_a_known_floor(known_floor) -> None:
    runtime = _runtime(mission_id=None) if known_floor else None
    response = await MaticFloorLayersView().get(_request(runtime), "entry")
    assert response.status == 404


async def test_view_reports_unavailable_when_the_read_fails() -> None:
    for error in (CannotConnectError("down"), TimeoutError()):
        runtime = _runtime(read=AsyncMock(side_effect=error))
        response = await MaticFloorLayersView().get(_request(runtime), "entry")
        assert response.status == 503


async def test_view_discards_a_layer_read_across_a_floor_change() -> None:
    runtime = _runtime()
    view = MaticFloorLayersView()
    request = _request(runtime)
    hass = request.app[KEY_HASS]
    reads = runtime.client.async_get_tracked_collection_entries.side_effect

    async def change_floor(name, limit):
        runtime.slam_map.mission_identity = SlamMapIdentity("other", 7)
        return reads(name, limit)

    runtime.client.async_get_tracked_collection_entries.side_effect = change_floor
    assert (await view.get(request, "entry")).status == 409

    replaced = _runtime()
    runtime.client.async_get_tracked_collection_entries.side_effect = reads

    async def replace_runtime(name, limit):
        hass.config_entries.async_get_entry.return_value = SimpleNamespace(
            domain=DOMAIN, state=ConfigEntryState.LOADED, runtime_data=replaced
        )
        return reads(name, limit)

    runtime.slam_map.mission_identity = SlamMapIdentity(MISSION, 0x1234ABCD)
    runtime.client.async_get_tracked_collection_entries.side_effect = replace_runtime
    assert (await view.get(request, "entry")).status == 409
    assert view._cache == {}


async def test_view_rechecks_the_floor_after_waiting_for_the_lock() -> None:
    runtime = _runtime()
    view = MaticFloorLayersView()
    lock = view._locks.setdefault("entry", asyncio.Lock())
    await lock.acquire()
    waiter = asyncio.create_task(view.get(_request(runtime), "entry"))
    await asyncio.sleep(0)
    runtime.slam_map.mission_identity = SlamMapIdentity("other", 7)
    lock.release()
    assert (await waiter).status == 409
    runtime.client.async_get_tracked_collection_entries.assert_not_awaited()


async def test_view_keeps_pages_a_later_read_did_not_replay() -> None:
    first = _blank()
    first[0:8, 0:8] = SemanticKind.CARPET
    second = _blank()
    second[0:8, 0:8] = SemanticKind.VENT
    later = HermesCollectionEntry(
        synthetic_semantic_entry(page_x=1, page_y=0).key,
        _semantic_entry(second).value,
    )
    reads = iter(((_semantic_entry(first),), (), (), (), (later,), ()))
    runtime = _runtime(read=AsyncMock(side_effect=lambda name, limit: next(reads)))
    view = MaticFloorLayersView()

    body = json.loads((await view.get(_request(runtime), "entry")).body)
    assert body["page_count"] == 1
    with patch(
        "custom_components.matic_robot.floor_layers.monotonic", return_value=1e12
    ):
        body = json.loads((await view.get(_request(runtime), "entry")).body)
    # The second read replayed nothing; the first page is kept.
    assert body["page_count"] == 1
    assert len(body["layers"]["carpet"]) == 1
    with patch(
        "custom_components.matic_robot.floor_layers.monotonic", return_value=2e12
    ):
        body = json.loads((await view.get(_request(runtime), "entry")).body)
    assert body["page_count"] == 2
    assert len(body["layers"]["vent"]) == 1


async def test_view_retries_an_empty_floor_sooner() -> None:
    runtime = _runtime(read=AsyncMock(return_value=()))
    view = MaticFloorLayersView()
    with patch(
        "custom_components.matic_robot.floor_layers.monotonic", return_value=0.0
    ):
        await view.get(_request(runtime), "entry")
    assert view._cache["entry"].expires_at == 30.0


async def test_view_rejects_too_many_pages() -> None:
    runtime = _runtime()
    with patch("custom_components.matic_robot.floor_layers.MAX_SLAM_TILES", 0):
        response = await MaticFloorLayersView().get(_request(runtime), "entry")
    assert response.status == 503


async def test_concurrent_requests_share_one_read() -> None:
    runtime = _runtime()
    view = MaticFloorLayersView()
    await asyncio.gather(
        view.get(_request(runtime), "entry"), view.get(_request(runtime), "entry")
    )
    assert runtime.client.async_get_tracked_collection_entries.await_count == 2
