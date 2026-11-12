"""Tests for the authenticated private WebGL scene endpoints."""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from datetime import UTC, datetime
from functools import partial
from http import HTTPStatus
from time import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp.test_utils import make_mocked_request
from google.protobuf.message import DecodeError
from homeassistant.config_entries import ConfigEntryState
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot.area_binding import (
    AREA_SCHEMA_VERSION,
    area_binding_status,
    binding_for_area,
    binding_for_floor_plan,
)
from custom_components.matic_robot.area_geometry import RoomGeometryIndex
from custom_components.matic_robot.area_views import (
    MaticAreasView,
)
from custom_components.matic_robot.client.commands import CleaningMode, CoverageSetting
from custom_components.matic_robot.client.models import (
    FloorPlan,
    MappedFloor,
    MapZone,
    RobotPose,
    Room,
)
from custom_components.matic_robot.client.slam_tiles import decode_slam_tile
from custom_components.matic_robot.const import (
    CONF_LIVE_WORKSPACE_TRANSPORT,
    CONF_WORKSPACE_PUSH,
    DOMAIN,
)
from custom_components.matic_robot.frontend import DATA_SLAM_SCENE_VIEW
from custom_components.matic_robot.http import (
    AREAS_API_URL,
    CATALOG_API_URL,
    DELTA_API_URL,
    HISTORY_API_URL,
    HISTORY_EXPORT_API_URL,
    HISTORY_IMPORT_API_URL,
    HISTORY_MANAGE_API_URL,
    HISTORY_SCENE_API_URL,
    PLANS_API_URL,
    PRIVATE_NO_STORE_HEADERS,
    SCENE_API_URL,
    areas_api_url,
    delta_api_url,
    history_api_url,
    history_scene_api_url,
    plans_api_url,
    scene_api_url,
)
from custom_components.matic_robot.plan_model import (
    AreaFramePointLimitError,
    AreaInUseError,
    RoomSequenceLimitError,
    plan_floor_token,
    room_cadence_identity,
)
from custom_components.matic_robot.plan_repository import MetadataAdmissionClosedError
from custom_components.matic_robot.plan_views import (
    MaticPlansView,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.room_sequence import saved_plan_preview_token
from custom_components.matic_robot.session import RobotSession, Store
from custom_components.matic_robot.slam_catalog_view import MaticSlamCatalogView
from custom_components.matic_robot.slam_delta import encode_slam_scene_delta
from custom_components.matic_robot.slam_history import HistoryReadCapacityError
from custom_components.matic_robot.slam_history_view import (
    MaticSlamHistoryExportView,
    MaticSlamHistoryImportView,
    MaticSlamHistoryManageView,
    MaticSlamHistorySceneView,
    MaticSlamHistoryView,
    _history_error,
    _history_record_metadata,
)
from custom_components.matic_robot.slam_map_store import SlamMapIdentity
from custom_components.matic_robot.slam_scene import (
    MaticSlamDeltaView,
    MaticSlamSceneView,
)
from custom_components.matic_robot.slam_view_data import (
    _map_session_key,
    catalog_entry_projection,
    pose_projection,
)
from custom_components.matic_robot.workspace_socket import WorkspaceSocket
from tests.test_slam_map import synthetic_slam_entry


def _floor_plan() -> FloorPlan:
    return FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                "room-1",
                "Kitchen",
                "protocol-1",
                b"room",
                ((0.0, 0.0), (0.3, 0.0), (0.3, 0.3), (0.0, 0.3)),
            ),
        ),
        "Main floor",
        (MappedFloor(1, "Main floor", "synthetic-token"),),
    )


def _fresh_pose(x: float, y: float, z: float) -> RobotPose:
    return RobotPose(x, y, z, mission_id=1, observed_at=time(), heading=0.5)


def _pose_session(
    pose: RobotPose | None, floor_plan: FloorPlan | None = None
) -> SimpleNamespace:
    session = SimpleNamespace(
        info=SimpleNamespace(serial_number="synthetic-serial"),
        error=Store(None),
        floor=Store(floor_plan),
        state=Store(
            SimpleNamespace(
                operational=SimpleNamespace(current_area="Kitchen"),
                session_active=False,
            )
        ),
        telemetry=Store(SimpleNamespace(zones=())),
        poses=Store({} if pose is None else {1: pose}),
    )
    session.pose_on = partial(RobotSession.pose_on, session)
    return session


def _runtime(*, entries=None, revision: int = 7, pose=True) -> SimpleNamespace:
    floor_plan = _floor_plan()
    robot_pose = _fresh_pose(0.1, 0.2, 0.0) if pose else None
    map_entries = (
        entries
        if entries is not None
        else (synthetic_slam_entry(page_x=0, page_y=0, mission_id=1),)
    )
    identity = None
    if map_entries:
        tile = decode_slam_tile(map_entries[0])
        identity = SlamMapIdentity(tile.mission_token, tile.mission_id)
    slam_map = SimpleNamespace(
        revision=revision,
        mission_identity=identity,
        live_session_verified=True,
        map_complete=True,
        tile_count=2,
        structure_tile_count=1,
        health=SimpleNamespace(
            state="ready",
            complete=True,
            truncated=False,
            photo_tiles=2,
            structure_tiles=1,
            overlapping_tiles=1,
            layer_overlap=0.5,
            dropped_photo_tiles=0,
            dropped_structure_tiles=0,
            invalid_tiles=0,
            stream_state="connected",
            stream_failures=0,
            bootstrap_state="complete",
            bootstrap_photo_seen=True,
            bootstrap_structure_seen=True,
            bootstrap_failures=0,
        ),
        decoded_tiles=MagicMock(return_value=tuple(map(decode_slam_tile, map_entries))),
        async_add_listener=MagicMock(return_value=MagicMock()),
    )
    slam_map.floor_plan_is_current = MagicMock(
        side_effect=lambda candidate: (
            slam_map.mission_identity is not None
            and slam_map.mission_identity.matches_floor_plan(candidate)
        )
    )
    return SimpleNamespace(
        client=SimpleNamespace(),
        session=_pose_session(robot_pose, floor_plan),
        slam_map=slam_map,
        slam_history=SimpleNamespace(
            catalog=MagicMock(return_value=()),
            catalog_for_mission=MagicMock(return_value=()),
            catalogs_by_mission=MagicMock(return_value=()),
            async_scene=AsyncMock(return_value=None),
        ),
        cleaning_plans=SimpleNamespace(
            catalog=SimpleNamespace(
                areas=MagicMock(return_value={}),
                plans=MagicMock(return_value={}),
                selected_area=MagicMock(return_value=None),
                async_save_area=AsyncMock(),
                async_delete_area=AsyncMock(),
            ),
            planning=SimpleNamespace(preview=MagicMock(return_value={"rooms": []})),
            history=SimpleNamespace(
                snapshot=MagicMock(
                    return_value={"selected_plan": None, "active_plan": None}
                ),
            ),
            ledger=SimpleNamespace(
                pending_native_reconciliation=MagicMock(return_value=None),
            ),
            control=SimpleNamespace(
                lock=MagicMock(
                    return_value=SimpleNamespace(locked=MagicMock(return_value=False))
                ),
                stop_pending=MagicMock(return_value=False),
            ),
            cadence=SimpleNamespace(),
            repository=SimpleNamespace(),
        ),
    )


def _browser_session_key(runtime: SimpleNamespace) -> str:
    key = _map_session_key(runtime)
    assert key is not None
    return key


def test_map_session_key_tracks_floor_partition_not_stream_token() -> None:
    runtime = _runtime()
    original = _map_session_key(runtime)
    identity = runtime.slam_map.mission_identity
    assert original is not None
    assert identity is not None

    runtime.slam_map.mission_identity = SlamMapIdentity(
        "replacement-stream-token",
        identity.mission_id,
    )
    assert _map_session_key(runtime) == original

    floor_plan = runtime.session.floor.value
    assert floor_plan is not None
    runtime.session.floor.value = replace(
        floor_plan,
        partition_id_wire=b"replacement-partition",
    )
    assert _map_session_key(runtime) != original

    runtime.session.floor.value = replace(
        floor_plan,
        mission_id=floor_plan.mission_id + 1,
    )
    assert _map_session_key(runtime) is None


def _hass(entry) -> SimpleNamespace:
    return SimpleNamespace(
        config_entries=SimpleNamespace(
            async_get_entry=MagicMock(return_value=entry),
            async_entries=MagicMock(return_value=[] if entry is None else [entry]),
        ),
        async_add_executor_job=AsyncMock(side_effect=lambda target: target()),
    )


def _request(
    hass,
    *,
    etag: str | None = None,
    prefer_cached: bool = False,
    admin: bool = True,
    path: str = "/",
):
    headers = {}
    if etag is not None:
        headers["If-None-Match"] = etag
    if prefer_cached:
        headers["X-Matic-Prefer-Cached"] = "1"
    request = make_mocked_request("GET", path, headers=headers, app={KEY_HASS: hass})
    request["hass_user"] = SimpleNamespace(is_admin=admin)
    return request


def _json_request(
    hass,
    method: str,
    body: object,
    path: str = "/",
    *,
    content_length: int | None = None,
):
    encoded = json.dumps(body).encode()
    request = make_mocked_request(
        method,
        path,
        headers={
            "Content-Type": "application/json",
            "Content-Length": str(content_length or len(encoded)),
        },
        app={KEY_HASS: hass},
    )
    request["hass_user"] = SimpleNamespace(is_admin=True)
    request._read_bytes = encoded
    return request


def _scene_metadata(payload: bytes) -> dict[str, object]:
    metadata_bytes = int.from_bytes(payload[12:16], "little")
    return json.loads(payload[24 : 24 + metadata_bytes])


def _set_map_mission(runtime: SimpleNamespace, mission_id: int, revision: int) -> None:
    entry = synthetic_slam_entry(
        page_x=0,
        page_y=0,
        mission_id=mission_id,
    )
    tile = decode_slam_tile(entry)
    runtime.slam_map.mission_identity = SlamMapIdentity(
        tile.mission_token, tile.mission_id
    )
    runtime.slam_map.decoded_tiles.return_value = (tile,)
    runtime.slam_map.revision = revision


def _entry(
    runtime,
    *,
    domain: str = DOMAIN,
    state=ConfigEntryState.LOADED,
    entry_id: str = "entry",
    options: dict[str, object] | None = None,
):
    entry = SimpleNamespace(
        domain=domain,
        state=state,
        runtime_data=runtime,
        entry_id=entry_id,
        options={} if options is None else options,
    )
    return entry


async def test_scene_view_serves_and_etag_caches_compact_private_payload() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.OK
    assert response.content_type == "application/vnd.matic.slam-scene"
    assert response.body.startswith(b"MATIC3D\x00")
    assert response.headers["Cache-Control"] == "private, no-store, max-age=0"
    assert response.headers["Pragma"] == "no-cache"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    etag = response.headers["ETag"]

    cached = await view.get(_request(hass, etag=etag), "entry")

    assert cached.status == HTTPStatus.NOT_MODIFIED
    assert cached.headers["ETag"] == etag
    assert cached.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]
    hass.async_add_executor_job.assert_awaited_once()

    runtime.slam_map.revision = 8
    refreshed = await view.get(_request(hass), "entry")
    assert refreshed.status == HTTPStatus.OK
    assert hass.async_add_executor_job.await_count == 2


async def test_scene_withholds_floor_overlays_until_mission_identity_matches() -> None:
    runtime = _runtime()
    runtime.session.floor.value = replace(runtime.session.floor.value, mission_id=2)
    hass = _hass(_entry(runtime))

    response = await MaticSlamSceneView().get(_request(hass), "entry")
    pose = pose_projection("entry", runtime)
    areas_get = await MaticAreasView().get(_request(hass), "entry")
    areas_post = await MaticAreasView().post(
        _json_request(
            hass,
            "POST",
            {
                "name": "Synthetic area",
                "circles": [{"x": 0.1, "y": 0.1, "radius": 0.1}],
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            },
        ),
        "entry",
    )

    assert response.status == HTTPStatus.OK
    assert response.headers["X-Matic-Floor-Coherent"] == "0"
    assert _scene_metadata(response.body)["rooms"] == []
    assert pose["position"] is None
    assert pose["map_floor_coherent"] is False
    assert areas_get.status == HTTPStatus.CONFLICT
    assert areas_post.status == HTTPStatus.CONFLICT
    runtime.cleaning_plans.catalog.async_save_area.assert_not_awaited()


@pytest.mark.parametrize("first_change", ["floor", "slam"])
async def test_scene_generation_covers_both_multi_floor_transition_orders(
    first_change: str,
) -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    scene_view = MaticSlamSceneView()
    catalog_view = MaticSlamCatalogView(scene_view)

    initial = json.loads((await catalog_view.get(_request(hass))).body)["entries"][0]
    assert initial["map_revision"] == 7
    assert isinstance(initial["map_scene_epoch"], str)
    assert initial["map_floor_coherent"] is True

    if first_change == "floor":
        runtime.session.floor.value = replace(runtime.session.floor.value, mission_id=2)
    else:
        _set_map_mission(runtime, 2, 8)
    transition = json.loads((await catalog_view.get(_request(hass))).body)["entries"][0]
    assert transition["map_revision"] > initial["map_revision"]
    assert transition["map_floor_coherent"] is False

    if first_change == "floor":
        _set_map_mission(runtime, 2, 8)
    else:
        runtime.session.floor.value = replace(runtime.session.floor.value, mission_id=2)
    settled = json.loads((await catalog_view.get(_request(hass))).body)["entries"][0]
    assert settled["map_revision"] > transition["map_revision"]
    assert settled["map_scene_epoch"] == initial["map_scene_epoch"]
    assert settled["map_floor_coherent"] is True

    response = await scene_view.get(_request(hass), "entry")
    assert response.headers["X-Matic-Floor-Coherent"] == "1"
    assert len(_scene_metadata(response.body)["rooms"]) == 1


async def test_scene_publishes_captured_snapshot_during_same_mission_churn() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()

    async def mutate_during_encode(target):
        encoded = target()
        runtime.slam_map.revision = 8
        return encoded

    hass.async_add_executor_job.side_effect = mutate_during_encode

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.OK
    assert hass.async_add_executor_job.await_count == 1
    assert view._cache["entry"].key == (
        7,
        runtime.slam_map.mission_identity,
        runtime.session.floor.value,
    )
    assert response.headers["X-Matic-Revision"] == "7"
    assert view.current_revision("entry", runtime) == 8


async def test_scene_retries_when_floor_changes_during_encoding() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    calls = 0

    async def mutate_during_first_encode(target):
        nonlocal calls
        encoded = target()
        calls += 1
        if calls == 1:
            runtime.session.floor.value = replace(_floor_plan(), mission_id=2)
        return encoded

    hass.async_add_executor_job.side_effect = mutate_during_first_encode

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.OK
    assert calls == 2
    assert view._cache["entry"].key == (
        runtime.slam_map.revision,
        runtime.slam_map.mission_identity,
        runtime.session.floor.value,
    )


async def test_scene_fails_closed_during_continuous_floor_updates() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()

    async def mutate_every_encode(target):
        encoded = target()
        runtime.session.floor.value = replace(
            runtime.session.floor.value,
            mission_id=runtime.session.floor.value.mission_id + 1,
        )
        return encoded

    hass.async_add_executor_job.side_effect = mutate_every_encode

    first = await view.get(_request(hass), "entry")
    second = await view.get(_request(hass), "entry")

    assert first.status == HTTPStatus.CONFLICT
    assert second.status == HTTPStatus.CONFLICT
    assert hass.async_add_executor_job.await_count == 4
    assert view._cache == {}
    assert runtime.session.floor.value.mission_id == 5


async def test_scene_revision_advances_when_room_metadata_changes() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    first = await view.get(_request(hass), "entry")
    original = runtime.session.floor.value
    runtime.session.floor.value = FloorPlan(
        original.mission_id,
        original.partition_protocol_id,
        original.partition_id_wire,
        (
            Room(
                "room-1",
                "Pantry",
                "protocol-1",
                b"room",
                original.rooms[0].boundary,
            ),
        ),
    )

    second = await view.get(_request(hass), "entry")

    assert first.headers["X-Matic-Revision"] == "7"
    assert second.headers["X-Matic-Revision"] == "8"
    assert first.body != second.body
    assert runtime.slam_map.revision == 7


async def test_scene_cache_retains_two_transport_revisions() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()

    for revision in (7, 8, 9):
        runtime.slam_map.revision = revision
        response = await view.get(_request(hass), "entry")
        assert response.headers["X-Matic-Revision"] == str(revision)

    assert view.scene_for_revision("entry", 7) is None
    assert view.scene_for_revision("entry", 8) is not None
    assert view.scene_for_revision("entry", 9) is not None


async def test_scene_retries_a_decode_failure_from_an_obsolete_snapshot() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    calls = 0

    async def stale_decode_failure(target):
        nonlocal calls
        calls += 1
        if calls == 1:
            runtime.slam_map.revision += 1
            raise DecodeError
        return target()

    hass.async_add_executor_job.side_effect = stale_decode_failure

    response = await MaticSlamSceneView().get(_request(hass), "entry")

    assert response.status == HTTPStatus.OK
    assert calls == 2


async def test_scene_bounds_retries_for_obsolete_decode_failures() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))

    async def changing_decode_failure(_target):
        runtime.slam_map.revision += 1
        raise DecodeError

    hass.async_add_executor_job.side_effect = changing_decode_failure

    response = await MaticSlamSceneView().get(_request(hass), "entry")

    assert response.status == HTTPStatus.CONFLICT
    assert hass.async_add_executor_job.await_count == 2


async def test_scene_view_coalesces_concurrent_encodes_during_revision_churn() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    started = asyncio.Event()
    release = asyncio.Event()

    calls = 0

    async def delayed_encode(target):
        nonlocal calls
        started.set()
        await release.wait()
        encoded = target()
        calls += 1
        if calls == 1:
            runtime.slam_map.revision += 1
        return encoded

    hass.async_add_executor_job.side_effect = delayed_encode
    requests = [
        asyncio.create_task(view.get(_request(hass), "entry")) for _index in range(24)
    ]
    await started.wait()
    await asyncio.sleep(0)
    release.set()

    responses = await asyncio.gather(*requests)

    assert [response.status for response in responses] == [HTTPStatus.OK] * 24
    assert hass.async_add_executor_job.await_count == 1
    assert {response.headers["X-Matic-Revision"] for response in responses} == {"7"}
    assert view.current_revision("entry", runtime) == 8


async def test_scene_view_serves_safe_cache_while_new_revision_encodes() -> None:
    """A reopened panel gets the last verified scene while its delta is built."""
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    first = await view.get(_request(hass), "entry")
    assert first.headers["X-Matic-Revision"] == "7"

    started = asyncio.Event()
    release = asyncio.Event()

    async def delayed_encode(target):
        started.set()
        await release.wait()
        return target()

    hass.async_add_executor_job.side_effect = delayed_encode
    runtime.slam_map.revision = 8

    reopened = await view.get(_request(hass, prefer_cached=True), "entry")
    await started.wait()

    assert reopened.status == HTTPStatus.OK
    assert reopened.headers["X-Matic-Revision"] == "7"
    assert view.current_revision("entry", runtime) == 8
    assert view.available_revision("entry", runtime) == 7
    assert "entry" in view._tasks

    task = view._tasks["entry"]
    release.set()
    completed = await task
    await asyncio.sleep(0)

    assert completed is not None
    assert completed.revision == 8
    assert view.current_revision("entry", runtime) == 8
    assert view.available_revision("entry", runtime) == 8
    assert hass.async_add_executor_job.await_count == 2


async def test_scene_build_survives_a_cancelled_http_waiter() -> None:
    """A browser timeout must not discard a large shared scene build."""
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    started = asyncio.Event()
    release = asyncio.Event()

    async def delayed_encode(target):
        started.set()
        await release.wait()
        return target()

    hass.async_add_executor_job.side_effect = delayed_encode
    timed_out = asyncio.create_task(view.get(_request(hass), "entry"))
    await started.wait()

    timed_out.cancel()
    with pytest.raises(asyncio.CancelledError):
        await timed_out

    replacement = asyncio.create_task(view.get(_request(hass), "entry"))
    await asyncio.sleep(0)
    assert hass.async_add_executor_job.await_count == 1
    assert "entry" in view._tasks

    release.set()
    response = await replacement
    await asyncio.sleep(0)

    assert response.status == HTTPStatus.OK
    assert hass.async_add_executor_job.await_count == 1
    assert "entry" in view._cache
    assert view._tasks == {}


async def test_scene_waiter_reuses_cache_if_revision_returns() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    assert (await view.get(_request(hass), "entry")).status == HTTPStatus.OK
    runtime.slam_map.revision = 8
    lock = view._locks["entry"]
    await lock.acquire()
    waiting = asyncio.create_task(view.get(_request(hass), "entry"))
    await asyncio.sleep(0)

    runtime.slam_map.revision = 7
    lock.release()
    response = await waiting

    assert response.status == HTTPStatus.OK
    hass.async_add_executor_job.assert_awaited_once()


async def test_scene_view_returns_conflict_until_photo_pages_exist() -> None:
    hass = _hass(_entry(_runtime(entries=())))

    response = await MaticSlamSceneView().get(_request(hass), "entry")

    assert response.status == HTTPStatus.CONFLICT
    assert (
        response.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]
    )


async def test_scene_view_withholds_a_cached_scene_until_map_is_live_again() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()

    assert (await view.get(_request(hass), "entry")).status == HTTPStatus.OK
    runtime.slam_map.live_session_verified = False

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.NOT_FOUND
    assert not view._cache
    assert not view._versions
    assert hass.async_add_executor_job.await_count == 1


async def test_scene_view_rechecks_live_session_after_waiting_for_the_encode_lock() -> (
    None
):
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    lock = asyncio.Lock()
    view._locks["entry"] = lock
    await lock.acquire()

    task = asyncio.create_task(view.get(_request(hass), "entry"))
    await asyncio.sleep(0)
    runtime.slam_map.live_session_verified = False
    lock.release()

    response = await task

    assert response.status == HTTPStatus.NOT_FOUND
    assert not view._cache
    hass.async_add_executor_job.assert_not_awaited()


async def test_scene_view_rechecks_runtime_after_waiting_for_the_encode_lock() -> None:
    runtime = _runtime()
    entry = _entry(runtime)
    hass = _hass(entry)
    view = MaticSlamSceneView()
    lock = asyncio.Lock()
    view._locks["entry"] = lock
    await lock.acquire()

    task = asyncio.create_task(view.get(_request(hass), "entry"))
    await asyncio.sleep(0)
    entry.runtime_data = _runtime()
    lock.release()

    response = await task

    assert response.status == HTTPStatus.NOT_FOUND
    assert not view._cache
    hass.async_add_executor_job.assert_not_awaited()


async def test_scene_waiter_returns_cache_published_while_waiting_for_lock() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    assert (await view.get(_request(hass), "entry")).status == HTTPStatus.OK
    completed_scene = view._cache.pop("entry")
    lock = view._locks["entry"]
    await lock.acquire()

    task = asyncio.create_task(view.get(_request(hass), "entry"))
    await asyncio.sleep(0)
    view._cache["entry"] = completed_scene
    lock.release()

    response = await task

    assert response.status == HTTPStatus.OK
    hass.async_add_executor_job.assert_awaited_once()


async def test_scene_view_rechecks_live_session_before_returning_waiter_cache() -> None:
    """A cache completed by another waiter cannot outlive map verification."""
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()

    assert (await view.get(_request(hass), "entry")).status == HTTPStatus.OK
    completed_scene = view._cache.pop("entry")
    lock = view._locks["entry"]
    await lock.acquire()

    task = asyncio.create_task(view.get(_request(hass), "entry"))
    await asyncio.sleep(0)
    # Simulate the lock holder completing an encode while this request waits.
    view._cache["entry"] = completed_scene
    runtime.slam_map.live_session_verified = False
    lock.release()

    response = await task

    assert response.status == HTTPStatus.NOT_FOUND
    assert not view._cache


async def test_scene_view_rechecks_live_session_before_encoding() -> None:
    """A session change after lock acquisition prevents a new scene encode."""
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    original_map = runtime.slam_map

    class _SessionVerificationFlip:
        """Expose a transition between the pre-lock and pre-encode checks."""

        def __init__(self) -> None:
            self.checks = 0

        @property
        def live_session_verified(self) -> bool:
            self.checks += 1
            return self.checks < 3

        def __getattr__(self, name: str):
            return getattr(original_map, name)

    runtime.slam_map = _SessionVerificationFlip()

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.NOT_FOUND
    assert runtime.slam_map.checks == 3
    assert not view._cache
    hass.async_add_executor_job.assert_not_awaited()


async def test_scene_view_requires_explicit_live_session_verification() -> None:
    """An adapter missing the production proof property fails closed."""
    runtime = _runtime()
    del runtime.slam_map.live_session_verified
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.NOT_FOUND
    assert not view._cache
    hass.async_add_executor_job.assert_not_awaited()


@pytest.mark.parametrize(
    "entry",
    [
        None,
        _entry(_runtime(), domain="other"),
        _entry(_runtime(), state=ConfigEntryState.NOT_LOADED),
    ],
)
async def test_scene_view_hides_missing_wrong_or_unloaded_entries(entry) -> None:
    hass = _hass(entry)

    response = await MaticSlamSceneView().get(_request(hass), "entry")

    assert response.status == HTTPStatus.NOT_FOUND
    assert (
        response.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]
    )


async def test_scene_and_catalog_require_admin_and_loaded_catalog_entries() -> None:
    runtime = _runtime()
    loaded = _entry(runtime, options={CONF_LIVE_WORKSPACE_TRANSPORT: True})
    unloaded = _entry(
        _runtime(), state=ConfigEntryState.NOT_LOADED, entry_id="unloaded"
    )
    hass = _hass(loaded)
    hass.config_entries.async_entries.return_value = [loaded, unloaded]
    hass.config_entries.async_get_entry.side_effect = {
        "entry": loaded,
        "unloaded": unloaded,
    }.get

    with pytest.raises(Unauthorized):
        await MaticSlamSceneView().get(_request(hass, admin=False), "entry")
    with pytest.raises(Unauthorized):
        await MaticSlamCatalogView().get(_request(hass, admin=False))
    hass.config_entries.async_entries.assert_not_called()

    scene_view = MaticSlamSceneView()
    response = await MaticSlamCatalogView(scene_view).get(_request(hass))

    assert response.status == HTTPStatus.OK
    assert (
        response.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]
    )
    payload = json.loads(response.body)
    scene_epoch = payload["entries"][0].pop("map_scene_epoch")
    assert isinstance(scene_epoch, str) and len(scene_epoch) == 32
    assert all(character in "0123456789abcdef" for character in scene_epoch)
    assert payload == {
        "entries": [
            {
                "entry_id": loaded.entry_id,
                "live_workspace_transport_enabled": True,
                "scene_url": f"/api/matic_robot/slam_scene/{loaded.entry_id}",
                "delta_url": f"/api/matic_robot/slam_delta/{loaded.entry_id}",
                "history_url": f"/api/matic_robot/slam_history/{loaded.entry_id}",
                "areas_url": f"/api/matic_robot/areas/{loaded.entry_id}",
                "plans_url": f"/api/matic_robot/plans/{loaded.entry_id}",
                "wifi_heatmap_url": f"/api/matic_robot/wifi_heatmap/{loaded.entry_id}",
                "floor_layers_url": f"/api/matic_robot/floor_layers/{loaded.entry_id}",
                "history_count": 0,
                "history_floor_count": 0,
                "map_revision": 7,
                "map_floor_coherent": True,
                "selected_floor_ordinal": 1,
                "map_floor_ordinal": 1,
                "map_session_verified": True,
                "map_session_key": _browser_session_key(runtime),
                "map_block_reason": None,
                "runner_locked": False,
                "stop_settle_pending": False,
                "active_plan": False,
                "native_reconciliation_pending": False,
                "native_session_active": False,
                "map_health": "ready",
                "map_complete": True,
                "map_truncated": False,
                "cached_tiles": 2,
                "structural_tiles": 1,
                "overlapping_tiles": 1,
                "layer_overlap": 0.5,
                "dropped_photo_tiles": 0,
                "dropped_structure_tiles": 0,
                "invalid_tiles": 0,
                "stream_state": "connected",
                "stream_failures": 0,
                "bootstrap_state": "complete",
                "bootstrap_photo_seen": True,
                "bootstrap_structure_seen": True,
                "bootstrap_failures": 0,
            }
        ]
    }

    hass.data = {DATA_SLAM_SCENE_VIEW: scene_view}
    workspace_snapshot = WorkspaceSocket(hass).snapshot(loaded.entry_id)
    rest_entry = json.loads(response.body)["entries"][0]
    snapshot_entry = workspace_snapshot["payload"]["entry"]
    assert snapshot_entry is not None
    assert snapshot_entry == {key: rest_entry[key] for key in snapshot_entry}

    runtime.cleaning_plans.control.lock.return_value.locked.return_value = True
    runtime.cleaning_plans.control.stop_pending.return_value = True
    runtime.cleaning_plans.history.snapshot.return_value = {
        "active_plan": {"plan_id": "private-plan", "room_id": "private-room"}
    }
    runtime.cleaning_plans.ledger.pending_native_reconciliation.return_value = {
        "session_id": "private-session"
    }
    runtime.session.state.value.session_active = True
    blocked_response = await MaticSlamCatalogView().get(_request(hass))
    blocked_payload = json.loads(blocked_response.body)
    blocked_entry = blocked_payload["entries"][0]
    assert {
        "runner_locked": blocked_entry["runner_locked"],
        "stop_settle_pending": blocked_entry["stop_settle_pending"],
        "active_plan": blocked_entry["active_plan"],
        "native_reconciliation_pending": blocked_entry["native_reconciliation_pending"],
        "native_session_active": blocked_entry["native_session_active"],
    } == {
        "runner_locked": True,
        "stop_settle_pending": True,
        "active_plan": True,
        "native_reconciliation_pending": True,
        "native_session_active": True,
    }
    assert "private-plan" not in blocked_response.text
    assert "private-room" not in blocked_response.text
    assert "private-session" not in blocked_response.text

    runtime.slam_map.mission_identity = None
    assert _map_session_key(runtime) is None
    empty_identity = await MaticSlamCatalogView().get(_request(hass))
    empty_entry = json.loads(empty_identity.body)["entries"][0]
    assert empty_entry["history_count"] == 0
    assert empty_entry["map_floor_coherent"] is False
    assert empty_entry["map_session_key"] is None
    assert empty_entry["map_block_reason"] == "map_session_unverified"
    assert empty_entry["selected_floor_ordinal"] == 1
    assert empty_entry["map_floor_ordinal"] is None

    runtime.session.floor.value = None
    empty_plan = await MaticSlamCatalogView().get(_request(hass))
    empty_plan_entry = json.loads(empty_plan.body)["entries"][0]
    assert empty_plan_entry["selected_floor_ordinal"] is None
    assert empty_plan_entry["map_floor_ordinal"] is None
    assert empty_plan_entry["map_block_reason"] == "floor_plan_unavailable"

    runtime.session.floor.value = _floor_plan()
    runtime.slam_map.health.photo_tiles = 0
    runtime.slam_map.health.structure_tiles = 0
    runtime.slam_map.health.bootstrap_state = "complete"
    empty_bootstrap = await MaticSlamCatalogView().get(_request(hass))
    assert (
        json.loads(empty_bootstrap.body)["entries"][0]["map_block_reason"]
        == "bootstrap_empty"
    )

    runtime.slam_map.health.photo_tiles = 1
    runtime.slam_map.health.structure_tiles = 1
    runtime.slam_map.mission_identity = SlamMapIdentity("synthetic-other", 2)
    runtime.slam_map.live_session_verified = True
    mismatched = await MaticSlamCatalogView().get(_request(hass))
    assert (
        json.loads(mismatched.body)["entries"][0]["map_block_reason"]
        == "floor_plan_mismatch"
    )


@pytest.mark.parametrize(
    "options",
    [
        {},
        {CONF_LIVE_WORKSPACE_TRANSPORT: True},
        {CONF_LIVE_WORKSPACE_TRANSPORT: False},
        {CONF_LIVE_WORKSPACE_TRANSPORT: "true"},
        {CONF_LIVE_WORKSPACE_TRANSPORT: 1},
        {CONF_WORKSPACE_PUSH: True},
        {CONF_WORKSPACE_PUSH: False},
        {CONF_WORKSPACE_PUSH: "true"},
        {CONF_WORKSPACE_PUSH: 1},
    ],
)
async def test_admin_catalog_enables_workspace_push_and_ignores_legacy_options(
    options: dict[str, object],
) -> None:
    runtime = _runtime()
    loaded = _entry(runtime, options=options)
    response = await MaticSlamCatalogView().get(_request(_hass(loaded)))

    entry = json.loads(response.body)["entries"][0]
    assert entry["live_workspace_transport_enabled"] is True
    assert entry["delta_url"] == delta_api_url("entry")


async def test_catalog_push_is_enabled_independent_of_saved_options() -> None:
    runtime = _runtime()
    loaded = _entry(runtime)
    assert (
        catalog_entry_projection("entry", runtime)["live_workspace_transport_enabled"]
        is True
    )
    loaded.options = {CONF_WORKSPACE_PUSH: True}
    assert (
        catalog_entry_projection("entry", runtime)["live_workspace_transport_enabled"]
        is True
    )
    loaded.options = {CONF_WORKSPACE_PUSH: False}
    assert (
        catalog_entry_projection("entry", runtime)["live_workspace_transport_enabled"]
        is True
    )


async def test_area_workspace_lists_current_and_stale_private_areas() -> None:
    runtime = _runtime()
    circle = {"x": 0.1, "y": 0.1, "radius": 0.2}
    review_circle = {"x": 0.1, "y": 0.1, "radius": 0.1}
    current_binding = binding_for_area(runtime.session.floor.value, [circle])
    runtime.cleaning_plans.catalog.areas.return_value = {
        "table": {
            "name": "Table",
            "circles": [circle],
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
            "map_binding": current_binding,
            "schema_version": AREA_SCHEMA_VERSION,
        },
        "review": {
            "name": "Review",
            "circles": [review_circle],
            "cleaning_mode": "vacuum_and_mop",
            "coverage_setting": "standard",
            "map_binding": binding_for_floor_plan(
                replace(
                    runtime.session.floor.value,
                    rooms=(
                        replace(
                            runtime.session.floor.value.rooms[0],
                            boundary=(
                                (0.01, 0.0),
                                (0.3, 0.0),
                                (0.3, 0.3),
                                (0.0, 0.3),
                            ),
                        ),
                    ),
                )
            ),
            "schema_version": AREA_SCHEMA_VERSION,
        },
        "legacy": {"name": "Legacy"},
    }
    runtime.cleaning_plans.catalog.selected_area.return_value = "review"
    no_go = ((0.2, 0.2), (0.6, 0.2), (0.6, 0.6), (0.2, 0.6))
    runtime.session.telemetry.value.zones = (
        MapZone(1, "no_go", 1, no_go),
        # A zone from another mission never reaches this map.
        MapZone(2, "unknown", 0, no_go),
    )
    hass = _hass(_entry(runtime))
    view = MaticAreasView()

    with patch(
        "custom_components.matic_robot.area_views.area_binding_status",
        wraps=area_binding_status,
    ) as classify:
        response = await view.get(_request(hass), "entry")

    assert classify.call_count == 3
    # The selection is read directly; snapshot() deep-copies the plan history.
    runtime.cleaning_plans.catalog.selected_area.assert_called_once_with(
        "synthetic-serial"
    )
    runtime.cleaning_plans.history.snapshot.assert_not_called()
    room_geometry = classify.call_args_list[0].kwargs["room_geometry"]
    assert all(
        call.kwargs["room_geometry"] is room_geometry
        for call in classify.call_args_list
    )
    assert room_geometry._query_work_remaining < room_geometry._MAX_QUERY_WORK

    assert json.loads(response.body) == {
        "scene_url": "/api/matic_robot/slam_scene/entry",
        "rooms": [
            {
                "room_id": "room-1",
                "name": "Kitchen",
                "boundary": [[0.0, 0.0], [0.3, 0.0], [0.3, 0.3], [0.0, 0.3]],
            }
        ],
        "areas": [
            {
                "id": "table",
                "name": "Table",
                "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
                "cleaning_mode": "vacuum",
                "coverage_setting": "quick",
                "status": "current",
                "can_rebind": False,
            },
            {
                "id": "review",
                "name": "Review",
                "circles": [{"x": 0.1, "y": 0.1, "radius": 0.1}],
                "cleaning_mode": "vacuum_and_mop",
                "coverage_setting": "standard",
                "status": "geometry_changed",
                "can_rebind": True,
            },
            {
                "id": "legacy",
                "name": "Legacy",
                "circles": [],
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "status": "legacy",
                "can_rebind": False,
            },
        ],
        "selected_area": "review",
        "zones": [
            {
                "kind": "no_go",
                "outline": [[0.2, 0.2], [0.6, 0.2], [0.6, 0.6], [0.2, 0.6]],
                "holes": [],
                "room_ids": ["room-1"],
                "area_ids": ["table"],
            }
        ],
    }
    assert areas_api_url("entry") == AREAS_API_URL.format(entry_id="entry")
    with pytest.raises(Unauthorized):
        await view.get(_request(hass, admin=False), "entry")


async def test_area_workspace_does_not_index_geometry_without_saved_areas() -> None:
    runtime = _runtime()
    runtime.cleaning_plans.catalog.areas.return_value = {}
    hass = _hass(_entry(runtime))
    view = MaticAreasView()

    with patch("custom_components.matic_robot.area_views.RoomGeometryIndex") as index:
        response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.OK
    assert json.loads(response.body)["areas"] == []
    index.assert_not_called()


async def test_area_workspace_lazily_indexes_stale_area_for_rebinding() -> None:
    runtime = _runtime()
    circle = {"x": 0.1, "y": 0.1, "radius": 0.1}
    changed_floor = replace(
        runtime.session.floor.value,
        rooms=(
            replace(
                runtime.session.floor.value.rooms[0],
                boundary=((0.01, 0.0), (0.3, 0.0), (0.3, 0.3), (0.0, 0.3)),
            ),
        ),
    )
    runtime.cleaning_plans.catalog.areas.return_value = {
        "review": {
            "name": "Review",
            "circles": [circle],
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
            "map_binding": binding_for_floor_plan(changed_floor),
            "schema_version": AREA_SCHEMA_VERSION,
        }
    }
    hass = _hass(_entry(runtime))

    with patch(
        "custom_components.matic_robot.area_views.RoomGeometryIndex",
        wraps=RoomGeometryIndex,
    ) as index:
        response = await MaticAreasView().get(_request(hass), "entry")

    area = json.loads(response.body)["areas"][0]
    assert area["status"] == "geometry_changed"
    assert area["can_rebind"] is True
    index.assert_called_once()


async def test_plan_workspace_lists_saved_plans_and_current_rooms() -> None:
    runtime = _runtime()
    runtime.cleaning_plans.catalog.plans.return_value = {
        "weekday": {
            "name": "Weekday",
            "enabled": True,
            "run_behavior": "intelligent",
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum_and_mop",
                    "coverage_setting": "standard",
                }
            ],
            "room_order": ["room-1"],
            "return_to_base": False,
            "finish_current_room": True,
            "finish_current_room_threshold": 60,
        }
    }
    runtime.cleaning_plans.history.snapshot.return_value = {"selected_plan": "weekday"}
    runtime.cleaning_plans.planning.preview.return_value = {
        "rooms": [
            {
                "room_id": "room-1",
                "name": "Kitchen",
                "cleaning_mode": "vacuum_and_mop",
                "coverage_setting": "standard",
                "cadence": {"mop_due": False, "coverage_due": False},
            }
        ]
    }
    runtime.cleaning_plans.planning.preview.side_effect = None
    hass = _hass(_entry(runtime))
    view = MaticPlansView()
    preview_token = saved_plan_preview_token(
        runtime.cleaning_plans.planning.preview.return_value,
        entry_id="entry",
        floor_token=plan_floor_token(runtime.session.floor.value),
        room_identities={
            room.id: room_cadence_identity(runtime.session.floor.value, room.id)
            for room in runtime.session.floor.value.rooms
        },
    )

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.OK
    assert (
        response.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]
    )
    assert json.loads(response.body) == {
        "entry_id": "entry",
        "floor_token": plan_floor_token(runtime.session.floor.value),
        "rooms": [{"room_id": "room-1", "name": "Kitchen"}],
        "plans": [
            {
                "id": "weekday",
                "name": "Weekday",
                "enabled": True,
                "run_behavior": "intelligent",
                "rooms": [
                    {
                        "room_id": "room-1",
                        "cleaning_mode": "vacuum_and_mop",
                        "coverage_setting": "standard",
                    }
                ],
                "room_order": ["room-1"],
                "entries": [{"kind": "room", "room_id": "room-1"}],
                "return_to_base": False,
                "finish_current_room": True,
                "finish_current_room_threshold": 60,
                "occupancy_aware": False,
                "occupancy_sensors": {},
                "next_run_preview": {
                    "rooms": [
                        {
                            "room_id": "room-1",
                            "name": "Kitchen",
                            "cleaning_mode": "vacuum_and_mop",
                            "coverage_setting": "standard",
                            "cadence_reasons": [],
                        }
                    ],
                    "entries": [
                        {
                            "kind": "room",
                            "room_id": "room-1",
                            "name": "Kitchen",
                            "cleaning_mode": "vacuum_and_mop",
                            "coverage_setting": "standard",
                            "cadence_reasons": [],
                        }
                    ],
                    "mission_boundaries": [],
                    "preview_token": preview_token,
                    "blocker": None,
                },
                "next_run_estimate_seconds": None,
            }
        ],
        "selected_plan": "weekday",
    }
    assert plans_api_url("entry") == PLANS_API_URL.format(entry_id="entry")
    with pytest.raises(Unauthorized):
        await view.get(_request(hass, admin=False), "entry")


async def test_plan_workspace_explains_legacy_room_limit() -> None:
    runtime = _runtime()
    runtime.cleaning_plans.catalog.plans.return_value = {
        "legacy": {
            "name": "Legacy",
            "enabled": True,
            "run_behavior": "ordered",
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
            "room_order": ["room-1"],
        }
    }
    runtime.cleaning_plans.planning.preview.side_effect = RoomSequenceLimitError(
        "A plan can include at most 100 rooms"
    )
    runtime.cleaning_plans.history.next_run_estimate_seconds = MagicMock(
        return_value=1980
    )
    hass = _hass(_entry(runtime))

    response = await MaticPlansView().get(_request(hass), "entry")

    plan = json.loads(response.body)["plans"][0]
    assert plan["next_run_preview"] == {
        "rooms": [],
        "mission_boundaries": [],
        "blocker": "plan_room_limit",
    }
    assert plan["next_run_estimate_seconds"] is None
    runtime.cleaning_plans.history.next_run_estimate_seconds.assert_not_called()


async def test_plan_workspace_projects_saved_and_shared_cadence_state() -> None:
    runtime = _runtime()
    runtime.cleaning_plans.cadence.shared_cadence_delete_token = MagicMock(
        return_value="d" * 64
    )
    runtime.cleaning_plans.catalog.plans.return_value = {
        "weekday": {
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ]
        }
    }
    runtime.cleaning_plans.cadence.cadence_editor_state = MagicMock(
        return_value={
            "cadence": {"scope": "plan", "mop_every_n": 3},
            "cadence_progress": {"mop": 2},
            "cadence_reasons": ["mop_due"],
        }
    )

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    payload = json.loads(response.body)
    assert payload["plans"][0]["rooms"][0] == {
        "room_id": "room-1",
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "cadence": {"scope": "plan", "mop_every_n": 3},
        "cadence_progress": {"mop": 2},
        "cadence_reasons": ["mop_due"],
    }
    assert payload["rooms"][0] == {
        "room_id": "room-1",
        "name": "Kitchen",
        "shared_cadence_delete_token": "d" * 64,
        "shared_cadence": {"scope": "plan", "mop_every_n": 3},
        "shared_cadence_progress": {"mop": 2},
        "shared_cadence_reasons": ["mop_due"],
    }
    assert runtime.cleaning_plans.cadence.cadence_editor_state.call_count == 2
    saved_call, shared_call = (
        runtime.cleaning_plans.cadence.cadence_editor_state.call_args_list
    )
    assert saved_call.kwargs["use_shared_schedule"] is False
    assert shared_call.kwargs["use_shared_schedule"] is True
    assert saved_call.kwargs["floor_token"] == shared_call.kwargs["floor_token"]
    assert saved_call.kwargs["identity"] == shared_call.kwargs["identity"]
    runtime.cleaning_plans.cadence.shared_cadence_delete_token.assert_called_once_with(
        "synthetic-serial", "room-1"
    )


async def test_plan_workspace_preserves_invalid_cadence_reasons_and_other_rooms() -> (
    None
):
    runtime = _runtime()
    room = {
        "room_id": "room-1",
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
    }
    runtime.cleaning_plans.catalog.plans.return_value = {
        "legacy": {"rooms": [room]},
        "unconfigured": {"rooms": [room]},
    }
    invalid = {
        "cadence": None,
        "cadence_progress": None,
        "cadence_reasons": ["invalid_cadence_policy"],
    }

    def cadence_state(_serial, plan_id, *_args, use_shared_schedule=False, **_kwargs):
        if plan_id == "legacy" or use_shared_schedule:
            return invalid
        return {"cadence": None}

    runtime.cleaning_plans.cadence.cadence_editor_state = MagicMock(
        side_effect=cadence_state
    )
    request_hass = _hass(_entry(runtime))

    response = await MaticPlansView().get(_request(request_hass), "entry")

    payload = json.loads(response.body)
    assert response.status == HTTPStatus.OK
    assert payload["plans"][0]["rooms"][0]["cadence_reasons"] == [
        "invalid_cadence_policy"
    ]
    assert payload["plans"][1]["rooms"][0] == room
    assert payload["rooms"][0]["shared_cadence_reasons"] == ["invalid_cadence_policy"]


async def test_plan_workspace_projects_malformed_persisted_cadence_safely(hass) -> None:
    runtime = _runtime()
    floor_plan = runtime.session.floor.value
    assert floor_plan is not None
    runtime.session.floor.value = replace(
        floor_plan,
        rooms=(
            *floor_plan.rooms,
            Room(
                "room-2",
                "Office",
                "protocol-2",
                b"room-2",
                ((1.0, 0.0), (1.3, 0.0), (1.3, 0.3), (1.0, 0.3)),
            ),
        ),
    )
    manager = CleaningPlanManager(hass)
    robot = manager.repository.robot("synthetic-serial")
    robot["plans"] = {
        "invalid-private": {
            "name": "Invalid private cadence",
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"do_mop_next": True},
                }
            ],
        },
        "healthy": {
            "name": "Healthy plan",
            "rooms": [
                {
                    "room_id": "room-2",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
        },
    }
    robot["shared_room_cadence"]["room-2"] = {
        "policy": {
            "coverage_every_n": 2,
            "periodic_coverage_setting": [],
        },
        "progress": {"mop": 0, "coverage": 1},
    }
    runtime.cleaning_plans = manager
    request_hass = _hass(_entry(runtime))

    response = await MaticPlansView().get(_request(request_hass), "entry")

    payload = json.loads(response.body)
    plans = {plan["id"]: plan for plan in payload["plans"]}
    assert response.status == HTTPStatus.OK
    assert plans["invalid-private"]["rooms"][0]["cadence_reasons"] == [
        "invalid_cadence_policy"
    ]
    assert plans["healthy"]["rooms"][0]["room_id"] == "room-2"
    assert payload["rooms"][1]["shared_cadence_reasons"] == ["invalid_cadence_policy"]


async def test_plan_workspace_projects_read_only_policy_preview_and_boundaries(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "custom_components.matic_robot.plan_model.leg_groups",
        lambda rooms, mixed_settings=False, **_kwargs: [[room] for room in rooms],
    )
    runtime = _runtime()
    runtime.cleaning_plans.catalog.plans.return_value = {
        "weekday": {
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                },
                {
                    "room_id": "room-2",
                    "cleaning_mode": "vacuum_and_mop",
                    "coverage_setting": "quick",
                },
            ],
            "room_order": ["room-1", "room-2"],
        }
    }
    runtime.session.floor.value = replace(
        runtime.session.floor.value,
        rooms=(
            *runtime.session.floor.value.rooms,
            Room(
                "room-2",
                "Study",
                "protocol-2",
                b"room-2",
                ((0.4, 0.0), (0.7, 0.0), (0.7, 0.3), (0.4, 0.3)),
            ),
        ),
    )
    runtime.slam_map.floor_plan_is_current.return_value = True
    preview_result = {
        "rooms": [
            {
                "room_id": "room-2",
                "name": "Study",
                "cleaning_mode": "vacuum_and_mop",
                "coverage_setting": "heavy_duty",
                "cadence": {"mop_due": True, "coverage_due": True},
            },
            {
                "room_id": "room-1",
                "name": "Kitchen",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"mop_due": False, "coverage_due": False},
            },
        ]
    }
    runtime.cleaning_plans.planning.preview.return_value = preview_result
    runtime.cleaning_plans.planning.preview.side_effect = None
    runtime.cleaning_plans.history.next_run_estimate_seconds = MagicMock(
        return_value=1980
    )
    request_hass = _hass(_entry(runtime))
    view = MaticPlansView()
    preview_token = saved_plan_preview_token(
        preview_result,
        entry_id="entry",
        floor_token=plan_floor_token(runtime.session.floor.value),
        room_identities={
            room.id: room_cadence_identity(runtime.session.floor.value, room.id)
            for room in runtime.session.floor.value.rooms
        },
    )

    first = await view.get(_request(request_hass), "entry")
    second = await view.get(_request(request_hass), "entry")

    projected = json.loads(first.body)["plans"][0]["next_run_preview"]
    assert projected == json.loads(second.body)["plans"][0]["next_run_preview"]
    projected_rooms = [
        {
            "room_id": "room-2",
            "name": "Study",
            "cleaning_mode": "vacuum_and_mop",
            "coverage_setting": "heavy_duty",
            "cadence_reasons": ["mop_due", "coverage_due"],
        },
        {
            "room_id": "room-1",
            "name": "Kitchen",
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "cadence_reasons": [],
        },
    ]
    assert projected == {
        "rooms": projected_rooms,
        "entries": [{"kind": "room", **room} for room in projected_rooms],
        "mission_boundaries": [1],
        "preview_token": preview_token,
        "blocker": None,
    }
    assert json.loads(first.body)["plans"][0]["next_run_estimate_seconds"] == 1980
    runtime.cleaning_plans.history.next_run_estimate_seconds.assert_called_with(
        "synthetic-serial",
        [
            ("room-2", "vacuum_and_mop", "heavy_duty"),
            ("room-1", "vacuum", "standard"),
        ],
    )
    runtime.cleaning_plans.planning.preview.assert_any_call(
        "synthetic-serial",
        {"room-1": "Kitchen", "room-2": "Study"},
        "weekday",
        floor_token=plan_floor_token(runtime.session.floor.value),
        room_identities={
            room.id: room_cadence_identity(runtime.session.floor.value, room.id)
            for room in runtime.session.floor.value.rooms
        },
        floor_plan=runtime.session.floor.value,
    )
    runtime.cleaning_plans.catalog.async_save_area.assert_not_awaited()
    runtime.cleaning_plans.catalog.async_delete_area.assert_not_awaited()


async def test_plan_workspace_reports_preview_unavailable() -> None:
    runtime = _runtime()
    runtime.cleaning_plans.catalog.plans.return_value = {
        "weekday": {
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
            "room_order": ["room-1"],
        }
    }
    runtime.slam_map.floor_plan_is_current.return_value = True
    runtime.cleaning_plans.planning.preview = None
    request_hass = _hass(_entry(runtime))

    response = await MaticPlansView().get(_request(request_hass), "entry")

    preview = json.loads(response.body)["plans"][0]["next_run_preview"]
    assert preview == {
        "rooms": [],
        "mission_boundaries": [],
        "blocker": "preview_unavailable",
    }


async def test_plan_workspace_shows_daily_limit_and_held_preview() -> None:
    runtime = _runtime()
    runtime.slam_map.floor_plan_is_current.return_value = True
    runtime.cleaning_plans.catalog.plans.return_value = {
        "home": {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
            "room_order": ["room-1"],
        }
    }
    state = {"limit": 1, "completed_today": 1, "reached": True}
    runtime.cleaning_plans.cadence.daily_limit_state = MagicMock(return_value=state)
    runtime.cleaning_plans.planning.preview.return_value = {
        "rooms": [],
        "entries": [],
        "daily_limit_held_rooms": [{"room_id": "room-1", **state}],
    }
    request_hass = _hass(_entry(runtime))
    response = await MaticPlansView().get(_request(request_hass), "entry")
    body = json.loads(response.body)
    assert body["plans"][0]["rooms"][0]["daily_limit"] == state
    assert body["rooms"][0]["daily_limit"] == state
    assert body["plans"][0]["next_run_preview"]["blocker"] == "daily_limit_reached"

    with patch(
        "custom_components.matic_robot.plan_views.room_cadence_identity",
        side_effect=ValueError("identity unavailable"),
    ):
        response = await MaticPlansView().get(_request(request_hass), "entry")
    assert json.loads(response.body)["rooms"][0]["daily_limit"] == state
    assert runtime.cleaning_plans.cadence.daily_limit_state.call_args.args[-1] is None


async def test_plan_workspace_blocks_unverified_private_cadence() -> None:
    runtime = _runtime()
    runtime.cleaning_plans.catalog.plans.return_value = {
        "quick_clean": {
            "name": "Quick Clean",
            "enabled": True,
            "run_behavior": "intelligent",
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
            "room_order": ["room-1"],
        }
    }
    runtime.cleaning_plans.planning.preview.side_effect = ValueError(
        "room cadence progress is unverified; reset mop before use"
    )
    runtime.slam_map.floor_plan_is_current.return_value = True

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    preview = json.loads(response.body)["plans"][0]["next_run_preview"]
    assert preview == {
        "rooms": [],
        "mission_boundaries": [],
        "blocker": "cadence_progress_unverified",
    }


async def test_plan_workspace_keeps_inapplicable_mop_cadence_editable(hass) -> None:
    runtime = _runtime()
    manager = CleaningPlanManager(hass)
    robot = manager.repository.robot("synthetic-serial")
    robot["plans"]["legacy"] = {
        "name": "Legacy mop plan",
        "rooms": [
            {
                "room_id": "room-1",
                "cleaning_mode": "mop",
                "coverage_setting": "quick",
                "cadence": {
                    "coverage_every_n": 3,
                    "periodic_coverage_setting": "heavy_duty",
                },
            }
        ],
    }
    runtime.cleaning_plans = manager
    before = manager.catalog.plans("synthetic-serial")

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    assert response.status == HTTPStatus.OK
    plan = json.loads(response.body)["plans"][0]
    assert plan["next_run_preview"]["blocker"] == "coverage_requires_vacuum"
    assert plan["rooms"][0]["cadence_reasons"] == ["coverage_requires_vacuum"]
    assert plan["rooms"][0]["cadence"]["coverage_every_n"] == 3
    assert plan["rooms"][0]["cadence"]["periodic_coverage_setting"] == "heavy_duty"
    assert manager.catalog.plans("synthetic-serial") == before


async def test_plan_workspace_skips_malformed_rooms_and_uses_safe_defaults() -> None:
    runtime = _runtime()
    runtime.cleaning_plans.catalog.plans.return_value = {
        "legacy": {"rooms": [None, {}, {"room_id": ""}, {"room_id": "room-1"}]}
    }
    runtime.cleaning_plans.cadence.cadence_editor_state = MagicMock(
        return_value={"cadence": None}
    )

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    payload = json.loads(response.body)
    legacy = payload["plans"][0]
    assert legacy["enabled"] is True
    assert legacy["rooms"] == [
        {
            "room_id": "room-1",
            "cleaning_mode": CleaningMode.VACUUM.value,
            "coverage_setting": CoverageSetting.OPTIMAL.value,
        }
    ]
    calls = runtime.cleaning_plans.cadence.cadence_editor_state.call_args_list
    assert len(calls) == 2
    assert calls[0].args[1] == "legacy"
    assert calls[1].args[1] == "quick_clean"


async def test_plan_workspace_projects_unavailable_cadence_identity() -> None:
    runtime = _runtime()
    runtime.cleaning_plans.catalog.plans.return_value = {
        "weekday": {"rooms": [{"room_id": "room-1"}]}
    }
    runtime.cleaning_plans.cadence.cadence_editor_state = MagicMock(
        side_effect=AssertionError("unavailable identities must not be projected")
    )
    hass = _hass(_entry(runtime))

    with patch(
        "custom_components.matic_robot.plan_views.room_cadence_identity",
        side_effect=ValueError("room identity unavailable"),
    ):
        response = await MaticPlansView().get(_request(hass), "entry")

    payload = json.loads(response.body)
    assert payload["plans"][0]["rooms"][0] == {
        "room_id": "room-1",
        "cleaning_mode": CleaningMode.VACUUM.value,
        "coverage_setting": CoverageSetting.OPTIMAL.value,
        "cadence": None,
        "cadence_progress": None,
        "cadence_reasons": ["room_not_on_current_map"],
    }
    assert payload["rooms"][0] == {
        "room_id": "room-1",
        "name": "Kitchen",
        "shared_cadence_reasons": ["room_not_on_current_map"],
    }
    runtime.cleaning_plans.cadence.cadence_editor_state.assert_not_called()


async def test_plan_workspace_handles_missing_entry_and_floor_plan() -> None:
    view = MaticPlansView()
    assert (
        await view.get(_request(_hass(None)), "entry")
    ).status == HTTPStatus.NOT_FOUND

    runtime = _runtime()
    runtime.session.floor.value = None
    response = await view.get(_request(_hass(_entry(runtime))), "entry")
    assert response.status == HTTPStatus.CONFLICT
    assert response.headers["X-Matic-Plans-Conflict"] == "map-rechecking"
    runtime.session.floor.value = _floor_plan()
    runtime.slam_map.floor_plan_is_current.side_effect = None
    runtime.slam_map.floor_plan_is_current.return_value = False
    response = await view.get(_request(_hass(_entry(runtime))), "entry")
    assert response.status == HTTPStatus.CONFLICT
    assert response.headers["X-Matic-Plans-Conflict"] == "map-rechecking"
    runtime.session.floor.value = replace(_floor_plan(), rooms=())
    runtime.slam_map.floor_plan_is_current.return_value = True
    response = await view.get(_request(_hass(_entry(runtime))), "entry")
    assert response.status == HTTPStatus.CONFLICT
    assert response.headers["X-Matic-Plans-Conflict"] == "no-rooms"


async def test_area_workspace_distinguishes_revalidation_from_an_empty_floor() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticAreasView()
    runtime.session.floor.value = None
    response = await view.get(_request(hass), "entry")
    assert response.status == HTTPStatus.CONFLICT
    assert response.headers["X-Matic-Areas-Conflict"] == "map-rechecking"

    runtime.session.floor.value = _floor_plan()
    runtime.slam_map.floor_plan_is_current.side_effect = None
    runtime.slam_map.floor_plan_is_current.return_value = False
    response = await view.get(_request(hass), "entry")
    assert response.status == HTTPStatus.CONFLICT
    assert response.headers["X-Matic-Areas-Conflict"] == "map-rechecking"

    runtime.session.floor.value = replace(_floor_plan(), rooms=())
    runtime.slam_map.floor_plan_is_current.return_value = True
    response = await view.get(_request(hass), "entry")
    assert response.status == HTTPStatus.CONFLICT
    assert response.headers["X-Matic-Areas-Conflict"] == "no-rooms"


async def test_area_workspace_saves_updates_and_deletes_validated_areas() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticAreasView()
    values = {
        "name": "Under table",
        "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
        "cleaning_mode": "vacuum_and_mop",
        "coverage_setting": "standard",
    }

    created = await view.post(_json_request(hass, "POST", values), "entry")

    assert json.loads(created.body) == {"id": "under_table"}
    runtime.cleaning_plans.catalog.async_save_area.assert_awaited_once()
    saved_args = runtime.cleaning_plans.catalog.async_save_area.await_args
    assert saved_args.args == (
        "synthetic-serial",
        "under_table",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Under table",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
            "cleaning_mode": "vacuum_and_mop",
            "coverage_setting": "standard",
            "map_binding": binding_for_area(
                runtime.session.floor.value, values["circles"]
            ),
        },
    )
    assert callable(saved_args.kwargs["precondition"])

    runtime.cleaning_plans.catalog.areas.return_value = {
        "under_table": {"name": "Under table"}
    }
    updated = await view.post(
        _json_request(hass, "POST", {**values, "area_id": "under_table"}),
        "entry",
    )
    assert updated.status == HTTPStatus.OK

    deleted = await view.delete(_request(hass, path="/?area_id=under_table"), "entry")
    assert deleted.status == HTTPStatus.NO_CONTENT
    runtime.cleaning_plans.catalog.async_delete_area.assert_awaited_once_with(
        "synthetic-serial", "under_table"
    )


@pytest.mark.parametrize("operation", ("save", "delete"))
async def test_area_workspace_reports_metadata_admission_closed(operation) -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticAreasView()
    runtime.cleaning_plans.catalog.areas.return_value = (
        {"under_table": {"name": "Under table"}} if operation == "delete" else {}
    )
    runtime.cleaning_plans.catalog.async_save_area.side_effect = (
        MetadataAdmissionClosedError("Matic metadata is unavailable during unload")
    )
    runtime.cleaning_plans.catalog.async_delete_area.side_effect = (
        MetadataAdmissionClosedError("Matic metadata is unavailable during unload")
    )
    values = {
        "name": "Under table",
        "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
        "cleaning_mode": "vacuum_and_mop",
        "coverage_setting": "standard",
    }

    if operation == "save":
        response = await view.post(_json_request(hass, "POST", values), "entry")
        runtime.cleaning_plans.catalog.async_save_area.assert_awaited_once()
        runtime.cleaning_plans.catalog.async_delete_area.assert_not_awaited()
    else:
        response = await view.delete(
            _request(hass, path="/?area_id=under_table"), "entry"
        )
        runtime.cleaning_plans.catalog.async_delete_area.assert_awaited_once_with(
            "synthetic-serial", "under_table"
        )
        runtime.cleaning_plans.catalog.async_save_area.assert_not_awaited()

    assert response.status == HTTPStatus.SERVICE_UNAVAILABLE
    assert response.headers["Cache-Control"] == "private, no-store, max-age=0"


async def test_area_workspace_reports_room_frame_capacity_to_client() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticAreasView()
    runtime.cleaning_plans.catalog.async_save_area.side_effect = (
        AreaFramePointLimitError("aggregate room frame boundary point limit exceeded")
    )
    values = {
        "name": "Under table",
        "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
        "cleaning_mode": "vacuum_and_mop",
        "coverage_setting": "standard",
    }

    response = await view.post(_json_request(hass, "POST", values), "entry")

    assert response.status == HTTPStatus.REQUEST_ENTITY_TOO_LARGE
    assert json.loads(response.body) == {"error": "area_boundary_point_limit"}
    assert response.headers["Cache-Control"] == "private, no-store, max-age=0"
    runtime.cleaning_plans.catalog.async_save_area.assert_awaited_once()


async def test_area_mutations_require_admin_before_body_or_store_access() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticAreasView()
    request = _json_request(hass, "POST", {})
    request["hass_user"] = SimpleNamespace(is_admin=False)
    request.json = AsyncMock()

    with pytest.raises(Unauthorized):
        await view.post(request, "entry")

    request.json.assert_not_awaited()
    runtime.cleaning_plans.catalog.areas.assert_not_called()
    runtime.cleaning_plans.catalog.async_save_area.assert_not_awaited()

    with pytest.raises(Unauthorized):
        await view.delete(
            _request(hass, admin=False, path="/?area_id=under_table"), "entry"
        )

    runtime.cleaning_plans.catalog.areas.assert_not_called()
    runtime.cleaning_plans.catalog.async_delete_area.assert_not_awaited()


async def test_area_post_cancellation_during_body_read_does_not_reach_store() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    request = _json_request(
        hass,
        "POST",
        {
            "name": "Under table",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
            "cleaning_mode": "vacuum",
            "coverage_setting": CoverageSetting.OPTIMAL.value,
        },
    )
    body_started = asyncio.Event()
    body_cancelled = asyncio.Event()

    async def wait_for_body(**_kwargs):
        body_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            body_cancelled.set()
            raise

    request.json = AsyncMock(side_effect=wait_for_body)
    waiting = asyncio.create_task(MaticAreasView().post(request, "entry"))
    try:
        await asyncio.wait_for(body_started.wait(), timeout=1)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
    finally:
        if not waiting.done():
            waiting.cancel()
        try:
            await waiting
        except asyncio.CancelledError:
            pass

    assert body_cancelled.is_set()
    request.json.assert_awaited_once_with(loads=json.loads)
    runtime.cleaning_plans.catalog.areas.assert_not_called()
    runtime.cleaning_plans.catalog.async_save_area.assert_not_awaited()


async def test_area_workspace_rejects_floor_change_during_request_body_read() -> None:
    """A body authored for one floor cannot be rebound to a later selection."""
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    request = _json_request(
        hass,
        "POST",
        {
            "name": "Under table",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        },
    )
    original_floor = runtime.session.floor.value

    async def read_body_after_floor_change(**_kwargs):
        runtime.session.floor.value = replace(
            original_floor,
            partition_protocol_id="synthetic-replacement-partition",
            partition_id_wire=b"synthetic-replacement-partition",
        )
        return {
            "name": "Under table",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        }

    request.json = AsyncMock(side_effect=read_body_after_floor_change)

    response = await MaticAreasView().post(request, "entry")

    assert response.status == HTTPStatus.CONFLICT
    runtime.cleaning_plans.catalog.async_save_area.assert_not_awaited()


async def test_area_workspace_rejects_runtime_replacement_during_body_read() -> None:
    """A request cannot mutate a detached runtime after entry reload."""
    runtime = _runtime()
    entry = _entry(runtime)
    hass = _hass(entry)
    request = _json_request(
        hass,
        "POST",
        {
            "name": "Under table",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        },
    )

    async def read_body_after_entry_reload(**_kwargs):
        entry.runtime_data = _runtime()
        return {
            "name": "Under table",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        }

    request.json = AsyncMock(side_effect=read_body_after_entry_reload)

    response = await MaticAreasView().post(request, "entry")

    assert response.status == HTTPStatus.CONFLICT
    runtime.cleaning_plans.catalog.async_save_area.assert_not_awaited()
    entry.runtime_data.cleaning_plans.catalog.async_save_area.assert_not_awaited()


@pytest.mark.parametrize(
    "body",
    [
        [],
        {},
        {
            "name": "",
            "circles": [],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        },
        {
            "name": "Bad geometry",
            "circles": [{"x": 2, "y": 2, "radius": 0.2}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        },
        {
            "name": "Bad mode",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
            "cleaning_mode": "invalid",
            "coverage_setting": "standard",
        },
    ],
)
async def test_area_workspace_rejects_malformed_saves(body) -> None:
    runtime = _runtime()
    response = await MaticAreasView().post(
        _json_request(_hass(_entry(runtime)), "POST", body), "entry"
    )
    assert response.status == HTTPStatus.BAD_REQUEST


async def test_area_workspace_handles_missing_maps_entries_and_conflicts() -> None:
    view = MaticAreasView()
    missing_hass = _hass(None)
    assert (await view.get(_request(missing_hass), "entry")).status == 404
    assert (
        await view.post(_json_request(missing_hass, "POST", {}), "entry")
    ).status == 404
    assert (
        await view.delete(_request(missing_hass, path="/?area_id=x"), "entry")
    ).status == 404

    runtime = _runtime()
    hass = _hass(_entry(runtime))
    runtime.session.floor.value = None
    assert MaticAreasView._rooms(None) == []
    assert (await view.get(_request(hass), "entry")).status == 409
    assert (await view.post(_json_request(hass, "POST", {}), "entry")).status == 409
    runtime.session.floor.value = _floor_plan()

    oversized = _json_request(hass, "POST", {}, content_length=131_073)
    assert (await view.post(oversized, "entry")).status == 413

    values = {
        "name": "Table",
        "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
    }
    runtime.cleaning_plans.catalog.areas.return_value = {"table": {"name": "Table"}}
    assert (await view.post(_json_request(hass, "POST", values), "entry")).status == 409
    assert (
        await view.post(
            _json_request(hass, "POST", {**values, "area_id": "missing"}),
            "entry",
        )
    ).status == 404
    runtime.cleaning_plans.catalog.areas.return_value = {
        "table": {"name": "Table"},
        "other": {"name": "Other"},
    }
    assert (
        await view.post(
            _json_request(
                hass,
                "POST",
                {**values, "name": "Other", "area_id": "table"},
            ),
            "entry",
        )
    ).status == 409
    assert (
        await view.delete(_request(hass, path="/?area_id=missing"), "entry")
    ).status == 404


def test_scene_view_can_purge_one_entries_private_cache() -> None:
    view = MaticSlamSceneView()
    view._cache["entry"] = SimpleNamespace()
    view._locks["entry"] = MagicMock()
    task = MagicMock()
    view._tasks["entry"] = task

    view.clear_entry("entry")
    view.clear_entry("missing")

    assert view._cache == {}
    assert view._locks == {}
    assert view._tasks == {}
    task.cancel.assert_called_once_with()
    assert view._epochs == {"entry": 1, "missing": 1}


async def test_scene_purge_during_encoding_does_not_retain_private_payload() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()

    async def purge_while_encoding(target):
        view.clear_entry("entry")
        return target()

    hass.async_add_executor_job.side_effect = purge_while_encoding

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.NOT_FOUND
    assert view._cache == {}
    assert view._tasks == {}


async def test_scene_purge_rejects_waiters_without_duplicate_encoding() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    started = asyncio.Event()
    release = asyncio.Event()

    async def delayed_encode(target):
        started.set()
        await release.wait()
        return target()

    hass.async_add_executor_job.side_effect = delayed_encode
    first = asyncio.create_task(view.get(_request(hass), "entry"))
    await started.wait()
    waiting = asyncio.create_task(view.get(_request(hass), "entry"))
    await asyncio.sleep(0)
    view.clear_entry("entry")
    release.set()

    first_response, waiting_response = await asyncio.gather(first, waiting)

    assert first_response.status == HTTPStatus.NOT_FOUND
    assert waiting_response.status == HTTPStatus.NOT_FOUND
    hass.async_add_executor_job.assert_awaited_once()
    assert view._cache == {}
    assert view._locks == {}
    assert view._tasks == {}


def test_scene_endpoint_paths_are_scoped_to_config_entry() -> None:
    assert CATALOG_API_URL == "/api/matic_robot/slam_entries"
    assert scene_api_url("synthetic") == SCENE_API_URL.replace(
        "{entry_id}", "synthetic"
    )
    assert delta_api_url("synthetic") == DELTA_API_URL.replace(
        "{entry_id}", "synthetic"
    )
    assert history_api_url("synthetic") == HISTORY_API_URL.replace(
        "{entry_id}", "synthetic"
    )
    assert history_scene_api_url(
        "synthetic", "snapshot"
    ) == HISTORY_SCENE_API_URL.replace("{entry_id}", "synthetic").replace(
        "{snapshot_id}", "snapshot"
    )


async def test_delta_view_streams_revision_change_and_full_fallback() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    scene_view = MaticSlamSceneView()
    await scene_view.get(_request(hass), "entry")
    runtime.slam_map.revision = 8
    runtime.slam_map.decoded_tiles.return_value = (
        decode_slam_tile(synthetic_slam_entry(page_x=0, page_y=0, surface_height=8)),
    )
    view = MaticSlamDeltaView(scene_view)

    delta = await view.get(_request(hass, path="/?since=7"), "entry")

    assert delta.status == HTTPStatus.OK
    assert delta.content_type == "application/vnd.matic.slam-delta"
    assert delta.body.startswith(b"MATICDLT")
    assert delta.headers["X-Matic-Base-Revision"] == "7"
    assert delta.headers["X-Matic-Revision"] == "8"

    fallback = await view.get(_request(hass, path="/?since=1"), "entry")
    assert fallback.status == HTTPStatus.OK
    assert fallback.content_type == "application/vnd.matic.slam-scene"
    assert fallback.body.startswith(b"MATIC3D\x00")


async def test_delta_view_discards_delta_after_live_session_invalidates() -> None:
    """A transition during delta encoding cannot publish retained map bytes."""
    runtime = _runtime()
    runtime.slam_map.live_session_verified = True
    hass = _hass(_entry(runtime))
    scene_view = MaticSlamSceneView()
    assert (await scene_view.get(_request(hass), "entry")).status == HTTPStatus.OK
    runtime.slam_map.revision = 8
    runtime.slam_map.decoded_tiles.return_value = (
        decode_slam_tile(synthetic_slam_entry(page_x=0, page_y=0, surface_height=8)),
    )

    async def invalidate_after_delta(target):
        result = target()
        if getattr(target, "func", None) is encode_slam_scene_delta:
            runtime.slam_map.live_session_verified = False
        return result

    hass.async_add_executor_job.side_effect = invalidate_after_delta

    response = await MaticSlamDeltaView(scene_view).get(
        _request(hass, path="/?since=7"), "entry"
    )

    assert response.status == HTTPStatus.NOT_FOUND


async def test_delta_view_publishes_during_same_mission_revision_churn() -> None:
    """Pixel refinements cannot starve an already coherent point-in-time delta."""
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    scene_view = MaticSlamSceneView()
    assert (await scene_view.get(_request(hass), "entry")).status == HTTPStatus.OK
    runtime.slam_map.revision = 8
    runtime.slam_map.decoded_tiles.return_value = (
        decode_slam_tile(synthetic_slam_entry(page_x=0, page_y=0, surface_height=8)),
    )

    async def refine_after_delta(target):
        result = target()
        if getattr(target, "func", None) is encode_slam_scene_delta:
            runtime.slam_map.revision = 9
        return result

    hass.async_add_executor_job.side_effect = refine_after_delta

    response = await MaticSlamDeltaView(scene_view).get(
        _request(hass, path="/?since=7"), "entry"
    )

    assert response.status == HTTPStatus.OK
    assert response.content_type == "application/vnd.matic.slam-delta"
    assert response.headers["X-Matic-Revision"] == "8"
    assert scene_view.current_revision("entry", runtime) == 9


async def test_delta_view_waits_bounds_query_and_handles_unload() -> None:
    runtime = _runtime()
    entry = _entry(runtime)
    hass = _hass(entry)
    view = MaticSlamDeltaView(MaticSlamSceneView())

    assert (
        await view.get(_request(hass, path="/?since=invalid"), "entry")
    ).status == HTTPStatus.BAD_REQUEST
    with pytest.raises(Unauthorized):
        await view.get(_request(hass, admin=False, path="/?since=7"), "entry")

    with patch("custom_components.matic_robot.slam_scene.DELTA_WAIT_SECONDS", 0):
        timeout = await view.get(_request(hass, path="/?since=7"), "entry")
    assert timeout.status == HTTPStatus.NO_CONTENT
    remove = runtime.slam_map.async_add_listener.return_value
    remove.assert_called_once()

    entry.state = ConfigEntryState.NOT_LOADED
    assert (
        await view.get(_request(hass, path="/?since=7"), "entry")
    ).status == HTTPStatus.NOT_FOUND


async def test_delta_view_cancellation_removes_long_poll_listeners() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    scene_view = MaticSlamSceneView()
    initial = await scene_view.get(_request(hass), "entry")
    assert initial.headers["X-Matic-Revision"] == "7"

    subscribed = asyncio.Event()
    map_listeners = set()

    def subscribe_map(listener):
        map_listeners.add(listener)

        def remove() -> None:
            map_listeners.discard(listener)

        return remove

    floor = runtime.session.floor
    subscribe_floor = floor.subscribe

    def subscribe_and_tell(listener):
        subscribed.set()
        return subscribe_floor(listener)

    floor.subscribe = subscribe_and_tell
    runtime.slam_map.async_add_listener.side_effect = subscribe_map
    waiting = asyncio.create_task(
        MaticSlamDeltaView(scene_view).get(_request(hass, path="/?since=7"), "entry")
    )
    try:
        await asyncio.wait_for(subscribed.wait(), timeout=1)
        assert len(map_listeners) == 1
        assert len(floor._listeners) == 1

        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
    finally:
        if not waiting.done():
            waiting.cancel()
        try:
            await waiting
        except asyncio.CancelledError:
            pass

    assert map_listeners == set()
    assert floor._listeners == []


async def test_delta_view_wakes_when_only_the_floor_plan_changes() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    scene_view = MaticSlamSceneView()
    initial = await scene_view.get(_request(hass), "entry")
    assert initial.headers["X-Matic-Revision"] == "7"
    subscribed = asyncio.Event()
    floor = runtime.session.floor
    subscribe_floor = floor.subscribe

    def subscribe(listener):
        subscribed.set()
        return subscribe_floor(listener)

    floor.subscribe = subscribe
    waiting = asyncio.create_task(
        MaticSlamDeltaView(scene_view).get(_request(hass, path="/?since=7"), "entry")
    )
    await asyncio.wait_for(subscribed.wait(), timeout=1)
    floor.set(replace(floor.value, mission_id=2))

    response = await asyncio.wait_for(waiting, timeout=1)

    assert response.status == HTTPStatus.OK
    assert response.headers["X-Matic-Revision"] == "8"
    assert response.headers["X-Matic-Floor-Coherent"] == "0"
    assert floor._listeners == []


@pytest.mark.parametrize(
    ("result", "status"),
    [(DecodeError(), HTTPStatus.CONFLICT), (None, HTTPStatus.NOT_FOUND)],
)
async def test_delta_view_handles_initial_scene_failure(result, status) -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    scene_view = SimpleNamespace(async_scene=AsyncMock())
    if isinstance(result, BaseException):
        scene_view.async_scene.side_effect = result
    else:
        scene_view.async_scene.return_value = result

    response = await MaticSlamDeltaView(scene_view).get(
        _request(hass, path="/?since=7"), "entry"
    )

    assert response.status == status


@pytest.mark.parametrize(
    ("second", "status"),
    [
        (DecodeError(), HTTPStatus.CONFLICT),
        (None, HTTPStatus.NOT_FOUND),
        ("same", HTTPStatus.NO_CONTENT),
    ],
)
async def test_delta_view_revalidates_scene_after_wakeup(second, status) -> None:
    runtime = _runtime()
    current = SimpleNamespace(revision=7, floor_plan_coherent=True)
    scene_view = SimpleNamespace(
        async_scene=AsyncMock(),
        scene_for_revision=MagicMock(),
    )
    if isinstance(second, BaseException):
        scene_view.async_scene.side_effect = [current, second]
    else:
        scene_view.async_scene.side_effect = [
            current,
            current if second == "same" else second,
        ]

    def wake(listener):
        listener()
        return MagicMock()

    runtime.slam_map.async_add_listener.side_effect = wake
    hass = _hass(_entry(runtime))

    response = await MaticSlamDeltaView(scene_view).get(
        _request(hass, path="/?since=7"), "entry"
    )

    assert response.status == status


async def test_delta_view_rejects_entry_unload_after_wakeup() -> None:
    runtime = _runtime()
    entry = _entry(runtime)
    current = SimpleNamespace(revision=7, floor_plan_coherent=True)
    scene_view = SimpleNamespace(async_scene=AsyncMock(return_value=current))

    def unload(listener):
        entry.state = ConfigEntryState.NOT_LOADED
        listener()
        return MagicMock()

    runtime.slam_map.async_add_listener.side_effect = unload
    hass = _hass(entry)

    response = await MaticSlamDeltaView(scene_view).get(
        _request(hass, path="/?since=7"), "entry"
    )

    assert response.status == HTTPStatus.NOT_FOUND


async def test_history_scene_cancellation_propagates_to_store_read() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    mission_token = runtime.slam_map.mission_identity.mission_token
    assert mission_token is not None
    snapshot = SimpleNamespace(
        snapshot_id="0123456789abcdef01234567",
        mission_token=mission_token,
    )
    runtime.slam_history.catalog.return_value = (snapshot,)
    read_started = asyncio.Event()
    read_cancelled = asyncio.Event()

    async def wait_for_scene(*_args, **_kwargs):
        read_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            read_cancelled.set()
            raise

    runtime.slam_history.async_scene.side_effect = wait_for_scene
    waiting = asyncio.create_task(
        MaticSlamHistorySceneView().get(_request(hass), "entry", snapshot.snapshot_id)
    )
    try:
        await asyncio.wait_for(read_started.wait(), timeout=1)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
    finally:
        if not waiting.done():
            waiting.cancel()
        try:
            await waiting
        except asyncio.CancelledError:
            pass

    assert read_cancelled.is_set()
    runtime.slam_history.async_scene.assert_awaited_once_with(snapshot.snapshot_id)


async def test_history_scene_capacity_returns_retryable_status() -> None:
    runtime = _runtime()
    snapshot = SimpleNamespace(
        record_id="a" * 32,
        snapshot_id="b" * 64,
        retention="automatic",
    )
    runtime.slam_history.catalog.return_value = (snapshot,)
    runtime.slam_history.async_scene.side_effect = HistoryReadCapacityError("busy")

    response = await MaticSlamHistorySceneView().get(
        _request(_hass(_entry(runtime))), "entry", snapshot.record_id
    )

    assert response.status == HTTPStatus.SERVICE_UNAVAILABLE
    assert response.headers["Retry-After"] == "1"
    assert (
        response.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]
    )
    assert json.loads(response.body) == {"error": "history-read-busy"}


async def test_history_views_list_serve_hide_and_require_admin() -> None:
    runtime = _runtime()
    current_token = runtime.slam_map.mission_identity.mission_token
    snapshot = SimpleNamespace(
        snapshot_id="0123456789abcdef01234567",
        created_at=datetime(2026, 7, 26, 12, 0, tzinfo=UTC),
        revision=5,
        point_count=1025,
        mission_token=current_token,
    )
    saved_snapshot = SimpleNamespace(
        snapshot_id="89abcdef0123456701234567",
        created_at=datetime(2026, 7, 25, 12, 0, tzinfo=UTC),
        revision=3,
        point_count=512,
        mission_token="1" * 64,
    )
    archive_snapshot = SimpleNamespace(
        record_id="a" * 32,
        snapshot_id="c" * 64,
        created_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
        revision=1,
        point_count=256,
        mission_token=None,
        imported=True,
        retention="kept",
        name="Imported kitchen",
        comparison_group=None,
        frame={"diff_eligible": False},
    )
    runtime.slam_history.public_group = MagicMock(
        side_effect=lambda token: {
            current_token: "b" * 64,
            saved_snapshot.mission_token: "a" * 64,
            "2" * 64: "d" * 64,
        }.get(token)
    )
    runtime.session.floor.value = replace(
        runtime.session.floor.value,
        floor_label="Main",
        mapped_floors=(
            MappedFloor(1, "Main", current_token),
            MappedFloor(2, "Workshop", saved_snapshot.mission_token),
            MappedFloor(3, "Annex", "2" * 64),
        ),
    )
    runtime.slam_history.catalog_for_mission.return_value = (snapshot,)
    runtime.slam_history.catalog.return_value = (
        snapshot,
        saved_snapshot,
        archive_snapshot,
    )
    runtime.slam_history.catalogs_by_mission.return_value = (
        (current_token, (snapshot,)),
        (saved_snapshot.mission_token, (saved_snapshot,)),
    )
    scene = (
        await MaticSlamSceneView().get(_request(_hass(_entry(runtime))), "entry")
    ).body
    runtime.slam_history.async_scene.side_effect = lambda snapshot_id, **_kwargs: (
        scene
        if snapshot_id
        in {
            snapshot.snapshot_id,
            saved_snapshot.snapshot_id,
            archive_snapshot.record_id,
        }
        else None
    )
    hass = _hass(_entry(runtime))

    catalog = await MaticSlamHistoryView().get(_request(hass), "entry")
    payload = json.loads(catalog.body)
    assert payload["entry_id"] == "entry"
    assert payload["live_available"] is True
    assert [floor["id"] for floor in payload["floors"]] == [
        "saved-" + "b" * 64,
        "saved-" + "a" * 64,
        "saved-" + "d" * 64,
        "archive",
    ]
    record = payload["snapshots"][0]
    assert record == {
        "id": snapshot.snapshot_id,
        "content_id": snapshot.snapshot_id,
        "created_at": "2026-07-26T12:00:00+00:00",
        "revision": 5,
        "point_count": 1025,
        "scene_url": (
            "/api/matic_robot/slam_history_scene/entry/0123456789abcdef01234567"
        ),
        "name": None,
        "retention": "automatic",
        "deleted_until": None,
        "imported": False,
        "comparison_group": None,
        "frame": None,
    }
    assert payload["floors"][0]["snapshots"] == [record]
    assert payload["floors"][1]["snapshots"][0]["id"] == saved_snapshot.snapshot_id
    assert payload["floors"][2]["snapshots"] == []
    assert payload["floors"][3]["label"] == "Imported maps"
    assert payload["floors"][3]["active"] is False
    assert payload["floors"][3]["read_only"] is True
    assert payload["floors"][3]["live_available"] is False
    assert payload["floors"][3]["snapshots"][0]["id"] == archive_snapshot.record_id
    stable_saved_floor_id = payload["floors"][1]["id"]
    runtime.session.floor.value = replace(
        runtime.session.floor.value,
        mapped_floors=(
            MappedFloor(1, "Main", current_token),
            MappedFloor(2, "Workshop", saved_snapshot.mission_token),
        ),
    )
    after_other_floor_removed = json.loads(
        (await MaticSlamHistoryView().get(_request(hass), "entry")).body
    )
    assert any(
        floor["id"] == stable_saved_floor_id
        and floor["snapshots"][0]["id"] == saved_snapshot.snapshot_id
        for floor in after_other_floor_removed["floors"]
    )
    runtime.session.floor.value = replace(
        runtime.session.floor.value,
        mapped_floors=(
            MappedFloor(1, "Main", current_token),
            MappedFloor(2, "Workshop", saved_snapshot.mission_token),
            MappedFloor(3, "Annex", "2" * 64),
        ),
    )
    response = await MaticSlamHistorySceneView().get(
        _request(hass), "entry", snapshot.snapshot_id
    )
    assert response.status == HTTPStatus.OK
    assert response.body == scene
    assert response.headers["ETag"] == f'"{snapshot.snapshot_id}"'
    saved_response = await MaticSlamHistorySceneView().get(
        _request(hass), "entry", saved_snapshot.snapshot_id
    )
    assert saved_response.status == HTTPStatus.OK
    runtime.slam_history.async_scene.assert_awaited_with(saved_snapshot.snapshot_id)
    archive_response = await MaticSlamHistorySceneView().get(
        _request(hass), "entry", archive_snapshot.record_id
    )
    assert archive_response.status == HTTPStatus.OK
    runtime.slam_history.async_scene.assert_awaited_with(archive_snapshot.record_id)
    runtime.slam_history.async_scene.side_effect = None
    runtime.slam_history.async_scene.return_value = None
    assert (
        await MaticSlamHistorySceneView().get(
            _request(hass), "entry", snapshot.snapshot_id
        )
    ).status == HTTPStatus.NOT_FOUND
    assert (
        await MaticSlamHistorySceneView().get(_request(hass), "entry", "missing")
    ).status == HTTPStatus.NOT_FOUND

    runtime.slam_map.mission_identity = None
    no_active_floor = await MaticSlamHistoryView().get(_request(hass), "entry")
    no_active_payload = json.loads(no_active_floor.body)
    assert no_active_payload["live_available"] is False
    assert no_active_payload["snapshots"] == []
    assert no_active_payload["floors"][0] == {
        "id": "current",
        "active": True,
        "read_only": False,
        "live_available": False,
        "label": None,
        "snapshots": [],
    }
    assert [floor["id"] for floor in no_active_payload["floors"][1:]] == [
        "saved-" + "b" * 64,
        "saved-" + "a" * 64,
        "saved-" + "d" * 64,
        "archive",
    ]

    with pytest.raises(Unauthorized):
        await MaticSlamHistoryView().get(_request(hass, admin=False), "entry")
    with pytest.raises(Unauthorized):
        await MaticSlamHistorySceneView().get(
            _request(hass, admin=False), "entry", snapshot.snapshot_id
        )

    hass.config_entries.async_get_entry.return_value = None
    assert (
        await MaticSlamHistoryView().get(_request(hass), "entry")
    ).status == HTTPStatus.NOT_FOUND
    assert (
        await MaticSlamHistorySceneView().get(
            _request(hass), "entry", snapshot.snapshot_id
        )
    ).status == HTTPStatus.NOT_FOUND


async def test_history_management_views_use_bounded_contracts() -> None:
    runtime = _runtime()
    record = SimpleNamespace(
        record_id="a" * 32,
        snapshot_id="b" * 64,
        created_at=datetime(2026, 7, 26, 12, 0, tzinfo=UTC),
        revision=3,
        point_count=20,
        mission_token=None,
        name="Saved floor",
        retention="kept",
        deleted_until=None,
        imported=True,
        comparison_group=None,
        frame={"diff_eligible": False},
        compressed=b"compressed",
    )
    runtime.slam_history.generation = 7
    runtime.slam_history.capture_paused = True
    runtime.slam_history.capacity_blocked = False
    runtime.slam_history.usage = MagicMock(
        return_value={"record_count": 1, "compressed_bytes": 100}
    )
    runtime.slam_history.catalog.return_value = (record,)
    runtime.slam_history.async_mutate = AsyncMock(
        return_value={"generation": 8, "request_id": "rename-1"}
    )
    runtime.slam_history.async_export = AsyncMock(
        return_value={"format": "matic-map-archive", "version": 1, "records": []}
    )
    runtime.slam_history.async_import = AsyncMock(
        return_value={
            "generation": 9,
            "request_id": "import-1",
            "record_ids": ["c" * 32],
        }
    )
    hass = _hass(_entry(runtime))

    managed = await MaticSlamHistoryManageView().get(_request(hass), "entry")
    managed_payload = json.loads(managed.body)
    assert managed_payload["generation"] == 7
    assert managed_payload["capture_paused"] is True
    assert managed_payload["usage"] == {"record_count": 1, "compressed_bytes": 100}
    assert managed_payload["records"][0]["id"] == "a" * 32
    assert managed_payload["records"][0]["content_id"] == "b" * 64
    assert managed_payload["records"][0]["compressed_bytes"] == len(b"compressed")
    assert managed_payload["records"][0]["scene_url"].endswith("/" + "a" * 32)
    assert managed.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]

    mutation = {
        "action": "rename",
        "record_ids": ["a" * 32],
        "expected_generation": 7,
        "request_id": "rename-1",
        "name": "Renamed floor",
    }
    changed = await MaticSlamHistoryManageView().post(
        _json_request(hass, "POST", mutation, HISTORY_MANAGE_API_URL), "entry"
    )
    assert changed.status == HTTPStatus.OK
    runtime.slam_history.async_mutate.assert_awaited_with(
        "rename",
        ["a" * 32],
        expected_generation=7,
        request_id="rename-1",
        name="Renamed floor",
        allow_kept=False,
    )
    malformed = await MaticSlamHistoryManageView().post(
        _json_request(hass, "POST", {**mutation, "surprise": True}), "entry"
    )
    assert malformed.status == HTTPStatus.BAD_REQUEST

    exported = await MaticSlamHistoryExportView().post(
        _json_request(
            hass,
            "POST",
            {"record_ids": ["a" * 32], "expected_generation": 7},
            HISTORY_EXPORT_API_URL,
        ),
        "entry",
    )
    assert json.loads(exported.body)["format"] == "matic-map-archive"
    runtime.slam_history.async_export.assert_awaited_with(
        ["a" * 32], expected_generation=7
    )

    archive = {"format": "matic-map-archive", "version": 1, "records": []}
    imported = await MaticSlamHistoryImportView().post(
        _json_request(
            hass,
            "POST",
            {
                "archive": archive,
                "expected_generation": 8,
                "request_id": "import-1",
            },
            HISTORY_IMPORT_API_URL,
        ),
        "entry",
    )
    assert json.loads(imported.body)["record_ids"] == ["c" * 32]
    runtime.slam_history.async_import.assert_awaited_with(
        archive, expected_generation=8, request_id="import-1"
    )


async def test_area_workspace_preserves_perimeter_and_rejects_excess_coverage() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticAreasView()
    outline = [
        {"x": 0, "y": 0},
        {"x": 0.3, "y": 0},
        {"x": 0.3, "y": 0.3},
        {"x": 0, "y": 0.3},
    ]
    body = {
        "name": "Zone",
        "circles": [{"x": 0.15, "y": 0.15, "radius": 0.1}],
        "outline": outline,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
    }
    response = await view.post(_json_request(hass, "POST", body), "entry")
    assert response.status == HTTPStatus.OK
    saved = runtime.cleaning_plans.catalog.async_save_area.await_args.args[2]
    assert saved["outline"] == outline
    runtime.cleaning_plans.catalog.areas.return_value = {"zone": saved}
    response = await view.get(_request(hass), "entry")
    assert json.loads(response.body)["areas"][0]["outline"] == outline
    # The authenticated read must withhold perimeter coordinates with stale circles.
    runtime.cleaning_plans.catalog.areas.return_value = {
        "zone": {**saved, "map_binding": None}
    }
    response = await view.get(_request(hass), "entry")
    assert "outline" not in json.loads(response.body)["areas"][0]
    runtime.cleaning_plans.catalog.async_save_area.reset_mock()
    response = await view.post(
        _json_request(
            hass, "POST", {**body, "circles": [{"x": 0.15, "y": 0.15, "radius": 0.2}]}
        ),
        "entry",
    )
    assert response.status == HTTPStatus.BAD_REQUEST
    runtime.cleaning_plans.catalog.async_save_area.assert_not_awaited()


@pytest.mark.parametrize("invalidation", ["unload", "runtime", "history"])
async def test_history_scene_read_rechecks_entry_runtime_and_store(
    invalidation,
) -> None:
    runtime = _runtime()
    snapshot = SimpleNamespace(
        snapshot_id="0123456789abcdef01234567",
        mission_token=runtime.slam_map.mission_identity.mission_token,
    )
    runtime.slam_history.catalog.return_value = (snapshot,)
    entry = _entry(runtime)
    hass = _hass(entry)
    started, release = asyncio.Event(), asyncio.Event()

    async def delayed(*args, **kwargs):
        started.set()
        await release.wait()
        return b"synthetic-private-scene"

    runtime.slam_history.async_scene.side_effect = delayed
    task = asyncio.create_task(
        MaticSlamHistorySceneView().get(_request(hass), "entry", snapshot.snapshot_id)
    )
    await started.wait()
    if invalidation == "unload":
        entry.state = ConfigEntryState.NOT_LOADED
    elif invalidation == "runtime":
        entry.runtime_data = _runtime()
    else:
        runtime.slam_history = _runtime().slam_history
    release.set()
    response = await task
    assert response.status == HTTPStatus.NOT_FOUND
    assert (
        response.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]
    )
    assert response.body != b"synthetic-private-scene"


def _saved_area(floor_plan: FloorPlan, name: str) -> dict[str, object]:
    return {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": name,
        "circles": [{"x": 0.1, "y": 0.1, "radius": 0.1}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding_for_floor_plan(floor_plan),
    }


def _area_entry(area_id: str) -> dict[str, str]:
    return {
        "kind": "area",
        "area_id": area_id,
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
    }


async def test_plan_workspace_projects_area_entries_and_mission_boundaries(
    hass,
) -> None:
    runtime = _runtime()
    floor_plan = runtime.session.floor.value
    second_room = replace(
        floor_plan.rooms[0],
        id="room-2",
        name="Office",
        protocol_id="protocol-2",
        id_wire=b"room-2",
    )
    floor_plan = replace(floor_plan, rooms=(*floor_plan.rooms, second_room))
    runtime.session.floor.value = floor_plan
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    serial = "synthetic-serial"
    await manager.catalog.async_save_area(serial, "rug", _saved_area(floor_plan, "Rug"))
    await manager.catalog.async_save_area(serial, "mat", _saved_area(floor_plan, "Mat"))
    await manager.catalog.async_save_plan(
        serial,
        "mixed",
        {
            "name": "Mixed",
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
            "entries": [
                _area_entry("rug"),
                {"kind": "room", "room_id": "room-1"},
                _area_entry("mat"),
            ],
        },
    )
    await manager.catalog.async_save_plan(
        serial,
        "spots",
        {"name": "Spots", "rooms": [], "entries": [_area_entry("rug")]},
        select=False,
    )
    await manager.catalog.async_save_plan(
        serial,
        "smart-stop",
        {
            "name": "Smart Stop",
            "finish_current_room": True,
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
                {
                    "room_id": "room-2",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
            ],
        },
        select=False,
    )
    manager.repository.robot(serial)["plans"]["corrupt"] = {
        "name": "Corrupt",
        "rooms": [
            {
                "room_id": "room-1",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            }
        ],
        "entries": [],
    }
    runtime.cleaning_plans = manager
    hass_view = _hass(_entry(runtime))
    token_inputs = {
        "entry_id": "entry",
        "floor_token": plan_floor_token(floor_plan),
        "room_identities": {
            room.id: room_cadence_identity(floor_plan, room.id)
            for room in floor_plan.rooms
        },
    }

    response = await MaticPlansView().get(_request(hass_view), "entry")

    plans = {plan["id"]: plan for plan in json.loads(response.body)["plans"]}
    mixed = plans["mixed"]
    # Stored entries keep only area IDs; the editor model names each area.
    assert mixed["entries"] == [
        {**_area_entry("rug"), "name": "Rug"},
        {"kind": "room", "room_id": "room-1"},
        {**_area_entry("mat"), "name": "Mat"},
    ]
    assert "name" not in manager.catalog.plan(serial, "mixed")["entries"][0]
    area_projection = {
        "kind": "area",
        "area_id": "rug",
        "name": "Rug",
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
        "cadence_reasons": [],
    }
    room_projection = {
        "room_id": "room-1",
        "name": "Kitchen",
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "cadence_reasons": [],
    }
    assert mixed["next_run_preview"] == {
        "rooms": [room_projection],
        "entries": [
            area_projection,
            {"kind": "room", **room_projection},
            {**area_projection, "area_id": "mat", "name": "Mat"},
        ],
        "mission_boundaries": [1, 2],
        "preview_token": saved_plan_preview_token(
            manager.planning.preview(
                serial,
                {"room-1": "Kitchen"},
                "mixed",
                floor_token=token_inputs["floor_token"],
                room_identities=token_inputs["room_identities"],
                floor_plan=floor_plan,
            ),
            **token_inputs,
        ),
        "blocker": None,
    }
    assert mixed["next_run_estimate_seconds"] is None
    smart_stop = plans["smart-stop"]["next_run_preview"]
    assert smart_stop["mission_boundaries"] == [1]
    assert smart_stop["preview_token"] == saved_plan_preview_token(
        manager.planning.preview(
            serial,
            {"room-1": "Kitchen", "room-2": "Office"},
            "smart-stop",
            floor_token=token_inputs["floor_token"],
            room_identities=token_inputs["room_identities"],
            floor_plan=floor_plan,
        ),
        **token_inputs,
    )
    spots = plans["spots"]["next_run_preview"]
    assert spots["rooms"] == []
    assert spots["entries"] == [area_projection]
    assert spots["mission_boundaries"] == []
    assert plans["spots"]["entries"] == [{**_area_entry("rug"), "name": "Rug"}]
    assert plans["corrupt"]["entries"] == [{"kind": "room", "room_id": "room-1"}]
    assert plans["corrupt"]["next_run_preview"]["blocker"] == "invalid_plan"

    # A redrawn map or a missing area blocks the plan before anything runs.
    manager.repository.robot(serial)["areas"]["mat"]["map_binding"] = (
        binding_for_floor_plan(
            replace(floor_plan, mission_id=floor_plan.mission_id + 1)
        )
    )
    manager.repository.robot(serial)["areas"].pop("rug")
    manager.repository.robot(serial)["areas"]["mat"]["name"] = None
    response = await MaticPlansView().get(_request(hass_view), "entry")
    plans = {plan["id"]: plan for plan in json.loads(response.body)["plans"]}
    # A deleted or unnamed area is still listed, under its ID.
    assert [entry.get("name") for entry in plans["mixed"]["entries"]] == [
        "rug",
        None,
        "mat",
    ]
    assert plans["mixed"]["next_run_preview"]["blocker"] == "area_missing"
    assert plans["spots"]["next_run_preview"] == {
        "rooms": [],
        "mission_boundaries": [],
        "blocker": "area_missing",
    }
    await manager.catalog.async_save_area(serial, "rug", _saved_area(floor_plan, "Rug"))
    response = await MaticPlansView().get(_request(hass_view), "entry")
    plans = {plan["id"]: plan for plan in json.loads(response.body)["plans"]}
    assert plans["mixed"]["next_run_preview"]["blocker"] == "area_map_changed"
    assert plans["spots"]["next_run_preview"]["blocker"] is None


async def test_area_delete_keeps_the_area_and_plans_a_delete_would_empty(
    hass,
) -> None:
    runtime = _runtime()
    floor_plan = runtime.session.floor.value
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    serial = "synthetic-serial"
    await manager.catalog.async_save_area(serial, "rug", _saved_area(floor_plan, "Rug"))
    for plan_id, name in (("spots", "Spots"), ("rug-only", "Rug only")):
        await manager.catalog.async_save_plan(
            serial,
            plan_id,
            {"name": name, "rooms": [], "entries": [_area_entry("rug")]},
            select=False,
        )
    runtime.cleaning_plans = manager
    saves = manager.repository.store.async_save.await_count

    response = await MaticAreasView().delete(
        _request(_hass(_entry(runtime)), path="/?area_id=rug"), "entry"
    )

    assert response.status == HTTPStatus.CONFLICT
    assert response.headers["X-Matic-Areas-Conflict"] == "plan-would-be-empty"
    assert sorted(json.loads(response.body)["plans"]) == ["Rug only", "Spots"]
    assert "rug" in manager.catalog.areas(serial)
    plans = manager.repository.robot(serial)["plans"]
    assert all(plans[plan_id]["entries"] == [_area_entry("rug")] for plan_id in plans)
    assert manager.repository.store.async_save.await_count == saves


async def test_area_delete_reports_the_plans_it_would_empty() -> None:
    runtime = _runtime()
    runtime.cleaning_plans.catalog.areas.return_value = {"rug": {"name": "Rug"}}
    runtime.cleaning_plans.catalog.async_delete_area.side_effect = AreaInUseError(
        ["Rug only"]
    )
    hass = _hass(_entry(runtime))

    response = await MaticAreasView().delete(
        _request(hass, path="/?area_id=rug"), "entry"
    )

    assert response.status == HTTPStatus.CONFLICT
    assert response.headers["X-Matic-Areas-Conflict"] == "plan-would-be-empty"
    assert json.loads(response.body) == {"plans": ["Rug only"]}


async def test_history_management_and_archive_views_report_bounded_input_errors() -> (
    None
):
    runtime = _runtime()
    runtime.slam_history.async_export = AsyncMock(return_value={})
    runtime.slam_history.async_import = AsyncMock(return_value={})
    hass = _hass(_entry(runtime))

    manage = MaticSlamHistoryManageView()
    valid_mutation = {
        "action": "rename",
        "record_ids": ["a" * 32],
        "expected_generation": 1,
        "request_id": "req",
    }
    malformed_mutation = await manage.post(
        _json_request(
            hass,
            "POST",
            {**valid_mutation, "expected_generation": True},
            HISTORY_MANAGE_API_URL,
        ),
        "entry",
    )
    assert malformed_mutation.status == HTTPStatus.BAD_REQUEST
    assert json.loads(malformed_mutation.body) == {"error": "invalid-history-mutation"}

    export = MaticSlamHistoryExportView()
    malformed_export = await export.post(
        _json_request(
            hass,
            "POST",
            {"record_ids": "not-list", "expected_generation": 1},
            HISTORY_EXPORT_API_URL,
        ),
        "entry",
    )
    assert malformed_export.status == HTTPStatus.BAD_REQUEST
    runtime.slam_history.async_export.side_effect = ValueError(
        "history-generation-conflict"
    )
    conflict = await export.post(
        _json_request(
            hass,
            "POST",
            {"record_ids": ["a" * 32], "expected_generation": 1},
            HISTORY_EXPORT_API_URL,
        ),
        "entry",
    )
    assert conflict.status == HTTPStatus.CONFLICT

    import_view = MaticSlamHistoryImportView()
    malformed_import = await import_view.post(
        _json_request(
            hass,
            "POST",
            {"archive": [], "expected_generation": 1, "request_id": "req"},
            HISTORY_IMPORT_API_URL,
        ),
        "entry",
    )
    assert malformed_import.status == HTTPStatus.BAD_REQUEST
    runtime.slam_history.async_import.side_effect = ValueError(
        "history-request-too-large"
    )
    too_large = await import_view.post(
        _json_request(
            hass,
            "POST",
            {
                "archive": {},
                "expected_generation": 1,
                "request_id": "req",
            },
            HISTORY_IMPORT_API_URL,
        ),
        "entry",
    )
    assert too_large.status == HTTPStatus.REQUEST_ENTITY_TOO_LARGE

    hass.config_entries.async_get_entry.return_value = None
    assert (await manage.get(_request(hass), "entry")).status == HTTPStatus.NOT_FOUND
    assert (
        await manage.post(
            _json_request(hass, "POST", valid_mutation, HISTORY_MANAGE_API_URL),
            "entry",
        )
    ).status == HTTPStatus.NOT_FOUND
    assert (
        await export.post(
            _json_request(
                hass,
                "POST",
                {"record_ids": ["a" * 32], "expected_generation": 1},
                HISTORY_EXPORT_API_URL,
            ),
            "entry",
        )
    ).status == HTTPStatus.NOT_FOUND
    assert (
        await import_view.post(
            _json_request(
                hass,
                "POST",
                {"archive": {}, "expected_generation": 1, "request_id": "req"},
                HISTORY_IMPORT_API_URL,
            ),
            "entry",
        )
    ).status == HTTPStatus.NOT_FOUND


def test_history_record_trash_metadata_omits_scene_url_and_errors_map_statuses() -> (
    None
):
    record = SimpleNamespace(
        record_id="a" * 32,
        snapshot_id="b" * 24,
        created_at=datetime(2026, 7, 26, tzinfo=UTC),
        revision=1,
        point_count=1,
        compressed=b"abc",
        retention="trash",
        deleted_until=datetime(2026, 7, 27, tzinfo=UTC),
        imported=False,
    )
    metadata = _history_record_metadata("entry", record)
    assert metadata["scene_url"] is None
    assert metadata["compressed_bytes"] == 3
    for error, expected in (
        ("history-generation-conflict", HTTPStatus.CONFLICT),
        ("history-request-id-reused", HTTPStatus.CONFLICT),
        ("history-record-not-found", HTTPStatus.NOT_FOUND),
        ("history-request-too-large", HTTPStatus.REQUEST_ENTITY_TOO_LARGE),
        ("invalid-history-name", HTTPStatus.BAD_REQUEST),
    ):
        response = _history_error(ValueError(error))
        assert response.status == expected
        assert json.loads(response.body) == {"error": error}
