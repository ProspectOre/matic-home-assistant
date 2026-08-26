"""Tests for the authenticated private WebGL scene endpoints."""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from datetime import UTC, datetime
from http import HTTPStatus
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
    binding_for_area,
    binding_for_floor_plan,
)
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import (
    FloorPlan,
    RobotPose,
    Room,
)
from custom_components.matic_robot.client.slam_map import decode_slam_tile
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.slam_map_store import SlamMapIdentity
from custom_components.matic_robot.slam_scene import (
    AREAS_API_URL,
    CATALOG_API_URL,
    DELTA_API_URL,
    HISTORY_API_URL,
    HISTORY_SCENE_API_URL,
    PLANS_API_URL,
    POSE_API_URL,
    PRIVATE_NO_STORE_HEADERS,
    SCENE_API_URL,
    MaticAreasView,
    MaticPlansView,
    MaticSlamCatalogView,
    MaticSlamDeltaView,
    MaticSlamHistorySceneView,
    MaticSlamHistoryView,
    MaticSlamPoseView,
    MaticSlamSceneView,
    areas_api_url,
    delta_api_url,
    history_api_url,
    history_scene_api_url,
    plans_api_url,
    pose_api_url,
    scene_api_url,
)
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
    )


def _runtime(*, entries=None, revision: int = 7, pose=True) -> SimpleNamespace:
    floor_plan = _floor_plan()
    robot_pose = RobotPose(0.1, 0.2, 0.0) if pose else None
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
        map_complete=True,
        tile_count=2,
        structure_tile_count=1,
        health=SimpleNamespace(
            state="ready",
            complete=True,
            truncated=False,
            photo_tiles=2,
            structure_tiles=1,
            dropped_photo_tiles=0,
            dropped_structure_tiles=0,
            invalid_tiles=0,
            stream_state="connected",
            stream_failures=0,
        ),
        entries=MagicMock(return_value=map_entries),
        async_add_listener=MagicMock(return_value=MagicMock()),
    )
    slam_map.floor_plan_is_current = MagicMock(
        side_effect=lambda candidate: (
            slam_map.mission_identity is not None
            and slam_map.mission_identity.matches_floor_plan(candidate)
        )
    )
    return SimpleNamespace(
        client=SimpleNamespace(async_get_pose=AsyncMock(return_value=robot_pose)),
        slam_map=slam_map,
        coordinator=SimpleNamespace(
            async_add_listener=MagicMock(return_value=MagicMock()),
            data=SimpleNamespace(
                info=SimpleNamespace(serial_number="synthetic-serial"),
                floor_plan=floor_plan,
                pose=robot_pose,
                operational=SimpleNamespace(current_area="Kitchen"),
            ),
        ),
        slam_history=SimpleNamespace(
            catalog=MagicMock(return_value=()),
            catalog_for_mission=MagicMock(return_value=()),
            catalogs_by_mission=MagicMock(return_value=()),
            async_scene=AsyncMock(return_value=None),
        ),
        cleaning_plans=SimpleNamespace(
            areas=MagicMock(return_value={}),
            plans=MagicMock(return_value={}),
            snapshot=MagicMock(return_value={"selected_plan": None}),
            async_save_area=AsyncMock(),
            async_delete_area=AsyncMock(),
        ),
    )


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
    admin: bool = True,
    path: str = "/",
):
    headers = {"If-None-Match": etag} if etag is not None else None
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
    runtime.slam_map.entries.return_value = (entry,)
    runtime.slam_map.revision = revision


def _entry(
    runtime,
    *,
    domain: str = DOMAIN,
    state=ConfigEntryState.LOADED,
    entry_id: str = "entry",
):
    return SimpleNamespace(
        domain=domain, state=state, runtime_data=runtime, entry_id=entry_id
    )


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
    runtime.coordinator.data.floor_plan = replace(
        runtime.coordinator.data.floor_plan, mission_id=2
    )
    hass = _hass(_entry(runtime))

    response = await MaticSlamSceneView().get(_request(hass), "entry")
    pose = await MaticSlamPoseView().get(_request(hass), "entry")
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
    assert json.loads(pose.body)["position"] is None
    assert json.loads(pose.body)["map_floor_coherent"] is False
    assert areas_get.status == HTTPStatus.CONFLICT
    assert areas_post.status == HTTPStatus.CONFLICT
    runtime.cleaning_plans.async_save_area.assert_not_awaited()


@pytest.mark.parametrize("first_change", ["floor", "slam"])
async def test_scene_generation_covers_both_multi_floor_transition_orders(
    first_change: str,
) -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    scene_view = MaticSlamSceneView()
    catalog_view = MaticSlamCatalogView("/editor.js", scene_view)

    initial = json.loads((await catalog_view.get(_request(hass))).body)["entries"][0]
    assert initial["map_revision"] == 7
    assert initial["map_floor_coherent"] is True

    if first_change == "floor":
        runtime.coordinator.data.floor_plan = replace(
            runtime.coordinator.data.floor_plan, mission_id=2
        )
    else:
        _set_map_mission(runtime, 2, 8)
    transition = json.loads((await catalog_view.get(_request(hass))).body)["entries"][0]
    assert transition["map_revision"] > initial["map_revision"]
    assert transition["map_floor_coherent"] is False

    if first_change == "floor":
        _set_map_mission(runtime, 2, 8)
    else:
        runtime.coordinator.data.floor_plan = replace(
            runtime.coordinator.data.floor_plan, mission_id=2
        )
    settled = json.loads((await catalog_view.get(_request(hass))).body)["entries"][0]
    assert settled["map_revision"] > transition["map_revision"]
    assert settled["map_floor_coherent"] is True

    response = await scene_view.get(_request(hass), "entry")
    assert response.headers["X-Matic-Floor-Coherent"] == "1"
    assert len(_scene_metadata(response.body)["rooms"]) == 1


@pytest.mark.parametrize("change", ["revision", "floor"])
async def test_scene_serves_coherent_snapshot_when_live_identity_changes(
    change: str,
) -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    calls = 0

    async def mutate_during_first_encode(target):
        nonlocal calls
        encoded = target()
        calls += 1
        if calls == 1:
            if change == "revision":
                runtime.slam_map.revision = 8
            else:
                runtime.coordinator.data.floor_plan = replace(
                    _floor_plan(), mission_id=2
                )
        return encoded

    hass.async_add_executor_job.side_effect = mutate_during_first_encode

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.OK
    assert calls == 2
    assert view._cache["entry"].key == (
        runtime.slam_map.revision,
        runtime.slam_map.mission_identity,
        runtime.coordinator.data.floor_plan,
    )


async def test_scene_fails_closed_during_continuous_identity_updates() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()

    async def mutate_every_encode(target):
        encoded = target()
        runtime.slam_map.revision += 1
        return encoded

    hass.async_add_executor_job.side_effect = mutate_every_encode

    first = await view.get(_request(hass), "entry")
    second = await view.get(_request(hass), "entry")

    assert first.status == HTTPStatus.CONFLICT
    assert second.status == HTTPStatus.CONFLICT
    assert hass.async_add_executor_job.await_count == 4
    assert view._cache == {}
    assert runtime.slam_map.revision == 11


async def test_scene_revision_advances_when_room_metadata_changes() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    first = await view.get(_request(hass), "entry")
    original = runtime.coordinator.data.floor_plan
    runtime.coordinator.data.floor_plan = FloorPlan(
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
    assert hass.async_add_executor_job.await_count == 2


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


async def test_pose_view_returns_exact_fallback_and_unavailable_positions() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamPoseView()

    with patch(
        "custom_components.matic_robot.slam_scene.monotonic",
        side_effect=(10.0, 10.0, 10.0, 10.0, 10.25, 10.25),
    ):
        exact = await view.get(_request(hass), "entry")
        cached = await view.get(_request(hass), "entry")
    assert exact.status == HTTPStatus.OK
    assert json.loads(exact.body) == {
        "position": [0.1, 0.2],
        "source": "exact_pose",
        "revision": 7,
        "map_floor_coherent": True,
        "pose_revision": 1,
        "pose_age_seconds": 0.0,
        "pose_freshness": "live",
    }
    assert json.loads(cached.body)["pose_age_seconds"] == 0.25
    runtime.client.async_get_pose.assert_awaited_once()
    assert exact.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]

    fallback_runtime = _runtime(pose=False)
    fallback_runtime.client.async_get_pose.side_effect = CannotConnectError("offline")
    fallback_hass = _hass(_entry(fallback_runtime))
    with patch("custom_components.matic_robot.slam_scene.monotonic", return_value=20.0):
        fallback = await MaticSlamPoseView().get(_request(fallback_hass), "entry")
    fallback_payload = json.loads(fallback.body)
    assert fallback_payload["source"] == "current_area"
    assert fallback_payload["pose_freshness"] == "coordinator_fallback"

    unavailable_runtime = _runtime(pose=False)
    unavailable_runtime.coordinator.data.floor_plan = None
    unavailable_hass = _hass(_entry(unavailable_runtime))
    with patch("custom_components.matic_robot.slam_scene.monotonic", return_value=30.0):
        unavailable = await MaticSlamPoseView().get(_request(unavailable_hass), "entry")
    assert json.loads(unavailable.body) == {
        "position": None,
        "source": "unavailable",
        "revision": 7,
        "map_floor_coherent": False,
        "pose_revision": 1,
        "pose_age_seconds": 0.0,
        "pose_freshness": "live",
    }


async def test_pose_view_coalesces_concurrent_live_reads_and_rechecks_runtime() -> None:
    runtime = _runtime()
    entry = _entry(runtime)
    hass = _hass(entry)
    view = MaticSlamPoseView()
    started = asyncio.Event()
    release = asyncio.Event()

    async def delayed_pose():
        started.set()
        await release.wait()
        return RobotPose(0.2, 0.3, 0.0)

    runtime.client.async_get_pose.side_effect = delayed_pose
    first = asyncio.create_task(view.get(_request(hass), "entry"))
    await started.wait()
    second = asyncio.create_task(view.get(_request(hass), "entry"))
    await asyncio.sleep(0)
    release.set()

    first_response, second_response = await asyncio.gather(first, second)

    assert first_response.status == HTTPStatus.OK
    assert second_response.status == HTTPStatus.OK
    runtime.client.async_get_pose.assert_awaited_once()

    replacement = _runtime()
    entry.runtime_data = replacement
    stale_runtime_response = await view.get(_request(hass), "entry")
    assert stale_runtime_response.status == HTTPStatus.OK
    replacement.client.async_get_pose.assert_awaited_once()


async def test_pose_view_discards_result_if_entry_unloads_during_read() -> None:
    runtime = _runtime()
    entry = _entry(runtime)
    hass = _hass(entry)
    view = MaticSlamPoseView()

    async def unload_during_read():
        entry.state = ConfigEntryState.NOT_LOADED
        return RobotPose(0.2, 0.3, 0.0)

    runtime.client.async_get_pose.side_effect = unload_during_read

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.NOT_FOUND
    assert view._cache == {}


async def test_pose_purge_during_live_read_does_not_retain_private_pose() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamPoseView()

    async def purge_while_reading():
        view.clear_entry("entry")
        return RobotPose(0.2, 0.3, 0.0)

    runtime.client.async_get_pose.side_effect = purge_while_reading

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.NOT_FOUND
    assert view._cache == {}
    assert view._locks == {}


async def test_pose_purge_rejects_reads_waiting_on_an_invalidated_lock() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamPoseView()
    started = asyncio.Event()
    release = asyncio.Event()

    async def delayed_pose():
        started.set()
        await release.wait()
        return RobotPose(0.2, 0.3, 0.0)

    runtime.client.async_get_pose.side_effect = delayed_pose
    first = asyncio.create_task(view.get(_request(hass), "entry"))
    await started.wait()
    waiting = asyncio.create_task(view.get(_request(hass), "entry"))
    await asyncio.sleep(0)
    view.clear_entry("entry")
    release.set()

    first_response, waiting_response = await asyncio.gather(first, waiting)

    assert first_response.status == HTTPStatus.NOT_FOUND
    assert waiting_response.status == HTTPStatus.NOT_FOUND
    runtime.client.async_get_pose.assert_awaited_once()
    assert view._cache == {}
    assert view._locks == {}


async def test_pose_view_hides_missing_entry_and_requires_admin() -> None:
    hass = _hass(None)
    view = MaticSlamPoseView()

    assert (await view.get(_request(hass), "entry")).status == HTTPStatus.NOT_FOUND
    with pytest.raises(Unauthorized):
        await view.get(_request(hass, admin=False), "entry")


async def test_scene_and_catalog_require_admin_and_loaded_catalog_entries() -> None:
    runtime = _runtime()
    loaded = _entry(runtime)
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
        await MaticSlamCatalogView("/matic_robot/test/room-plan-editor.js").get(
            _request(hass, admin=False)
        )

    response = await MaticSlamCatalogView("/matic_robot/test/room-plan-editor.js").get(
        _request(hass)
    )

    assert response.status == HTTPStatus.OK
    assert (
        response.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]
    )
    assert json.loads(response.body) == {
        "entries": [
            {
                "entry_id": loaded.entry_id,
                "scene_url": f"/api/matic_robot/slam_scene/{loaded.entry_id}",
                "delta_url": f"/api/matic_robot/slam_delta/{loaded.entry_id}",
                "pose_url": f"/api/matic_robot/slam_pose/{loaded.entry_id}",
                "history_url": f"/api/matic_robot/slam_history/{loaded.entry_id}",
                "areas_url": f"/api/matic_robot/areas/{loaded.entry_id}",
                "plans_url": f"/api/matic_robot/plans/{loaded.entry_id}",
                "area_editor_url": "/matic_robot/test/room-plan-editor.js",
                "history_count": 0,
                "history_floor_count": 0,
                "map_revision": 7,
                "map_floor_coherent": True,
                "map_health": "ready",
                "map_complete": True,
                "map_truncated": False,
                "cached_tiles": 2,
                "structural_tiles": 1,
                "dropped_photo_tiles": 0,
                "dropped_structure_tiles": 0,
                "invalid_tiles": 0,
                "stream_state": "connected",
                "stream_failures": 0,
            }
        ]
    }


async def test_area_workspace_lists_current_and_stale_private_areas() -> None:
    runtime = _runtime()
    current_binding = binding_for_floor_plan(runtime.coordinator.data.floor_plan)
    runtime.cleaning_plans.areas.return_value = {
        "table": {
            "name": "Table",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
            "map_binding": current_binding,
            "schema_version": AREA_SCHEMA_VERSION,
        },
        "review": {
            "name": "Review",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.1}],
            "cleaning_mode": "vacuum_and_mop",
            "coverage_setting": "standard",
            "map_binding": binding_for_floor_plan(
                replace(
                    runtime.coordinator.data.floor_plan,
                    rooms=(
                        replace(
                            runtime.coordinator.data.floor_plan.rooms[0],
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
    hass = _hass(_entry(runtime))
    view = MaticAreasView()

    response = await view.get(_request(hass), "entry")

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
    }
    assert areas_api_url("entry") == AREAS_API_URL.format(entry_id="entry")
    with pytest.raises(Unauthorized):
        await view.get(_request(hass, admin=False), "entry")


async def test_plan_workspace_lists_saved_plans_and_current_rooms() -> None:
    runtime = _runtime()
    runtime.cleaning_plans.plans.return_value = {
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
    runtime.cleaning_plans.snapshot.return_value = {"selected_plan": "weekday"}
    hass = _hass(_entry(runtime))
    view = MaticPlansView()

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.OK
    assert (
        response.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]
    )
    assert json.loads(response.body) == {
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
                "return_to_base": False,
                "finish_current_room": True,
                "finish_current_room_threshold": 60,
            }
        ],
        "selected_plan": "weekday",
    }
    assert plans_api_url("entry") == PLANS_API_URL.format(entry_id="entry")
    with pytest.raises(Unauthorized):
        await view.get(_request(hass, admin=False), "entry")


async def test_plan_workspace_handles_missing_entry_and_floor_plan() -> None:
    view = MaticPlansView()
    assert (
        await view.get(_request(_hass(None)), "entry")
    ).status == HTTPStatus.NOT_FOUND

    runtime = _runtime()
    runtime.coordinator.data.floor_plan = None
    assert (
        await view.get(_request(_hass(_entry(runtime))), "entry")
    ).status == HTTPStatus.CONFLICT


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
    runtime.cleaning_plans.async_save_area.assert_awaited_once_with(
        "synthetic-serial",
        "under_table",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Under table",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
            "cleaning_mode": "vacuum_and_mop",
            "coverage_setting": "standard",
            "map_binding": binding_for_area(
                runtime.coordinator.data.floor_plan, values["circles"]
            ),
        },
    )

    runtime.cleaning_plans.areas.return_value = {"under_table": {"name": "Under table"}}
    updated = await view.post(
        _json_request(hass, "POST", {**values, "area_id": "under_table"}),
        "entry",
    )
    assert updated.status == HTTPStatus.OK

    deleted = await view.delete(_request(hass, path="/?area_id=under_table"), "entry")
    assert deleted.status == HTTPStatus.NO_CONTENT
    runtime.cleaning_plans.async_delete_area.assert_awaited_once_with(
        "synthetic-serial", "under_table"
    )


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
    runtime.coordinator.data.floor_plan = None
    assert MaticAreasView._rooms(runtime) == []
    assert (await view.get(_request(hass), "entry")).status == 409
    assert (await view.post(_json_request(hass, "POST", {}), "entry")).status == 409
    runtime.coordinator.data.floor_plan = _floor_plan()

    oversized = _json_request(hass, "POST", {}, content_length=131_073)
    assert (await view.post(oversized, "entry")).status == 413

    values = {
        "name": "Table",
        "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
    }
    runtime.cleaning_plans.areas.return_value = {"table": {"name": "Table"}}
    assert (await view.post(_json_request(hass, "POST", values), "entry")).status == 409
    assert (
        await view.post(
            _json_request(hass, "POST", {**values, "area_id": "missing"}),
            "entry",
        )
    ).status == 404
    runtime.cleaning_plans.areas.return_value = {
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

    view.clear_entry("entry")
    view.clear_entry("missing")

    assert view._cache == {}
    assert view._locks == {}
    assert view._epochs == {"entry": 1, "missing": 1}


def test_pose_view_can_purge_one_entries_private_cache() -> None:
    view = MaticSlamPoseView()
    view._cache["entry"] = SimpleNamespace()
    view._locks["entry"] = MagicMock()

    view.clear_entry("entry")
    view.clear_entry("missing")

    assert view._cache == {}
    assert view._locks == {}
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


def test_scene_endpoint_paths_are_scoped_to_config_entry() -> None:
    assert CATALOG_API_URL == "/api/matic_robot/slam_entries"
    assert scene_api_url("synthetic") == SCENE_API_URL.replace(
        "{entry_id}", "synthetic"
    )
    assert pose_api_url("synthetic") == POSE_API_URL.replace("{entry_id}", "synthetic")
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
    runtime.slam_map.entries.return_value = (
        synthetic_slam_entry(page_x=0, page_y=0, surface_height=8),
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


async def test_delta_view_wakes_when_only_the_floor_plan_changes() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    scene_view = MaticSlamSceneView()
    initial = await scene_view.get(_request(hass), "entry")
    assert initial.headers["X-Matic-Revision"] == "7"
    subscribed = asyncio.Event()
    floor_listener = None
    remove_floor_listener = MagicMock()

    def subscribe(listener):
        nonlocal floor_listener
        floor_listener = listener
        subscribed.set()
        return remove_floor_listener

    runtime.coordinator.async_add_listener.side_effect = subscribe
    waiting = asyncio.create_task(
        MaticSlamDeltaView(scene_view).get(_request(hass, path="/?since=7"), "entry")
    )
    await asyncio.wait_for(subscribed.wait(), timeout=1)
    runtime.coordinator.data.floor_plan = replace(
        runtime.coordinator.data.floor_plan, mission_id=2
    )
    assert floor_listener is not None
    floor_listener()

    response = await asyncio.wait_for(waiting, timeout=1)

    assert response.status == HTTPStatus.OK
    assert response.headers["X-Matic-Revision"] == "8"
    assert response.headers["X-Matic-Floor-Coherent"] == "0"
    remove_floor_listener.assert_called_once()


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
    runtime.slam_history.catalog_for_mission.return_value = (snapshot,)
    runtime.slam_history.catalog.return_value = (snapshot, saved_snapshot)
    runtime.slam_history.catalogs_by_mission.return_value = (
        (current_token, (snapshot,)),
        (saved_snapshot.mission_token, (saved_snapshot,)),
    )
    scene = (
        await MaticSlamSceneView().get(_request(_hass(_entry(runtime))), "entry")
    ).body
    runtime.slam_history.async_scene.side_effect = lambda snapshot_id, **_kwargs: (
        scene
        if snapshot_id in {snapshot.snapshot_id, saved_snapshot.snapshot_id}
        else None
    )
    hass = _hass(_entry(runtime))

    catalog = await MaticSlamHistoryView().get(_request(hass), "entry")
    assert json.loads(catalog.body) == {
        "entry_id": "entry",
        "snapshots": [
            {
                "id": snapshot.snapshot_id,
                "created_at": "2026-07-26T12:00:00+00:00",
                "revision": 5,
                "point_count": 1025,
                "scene_url": (
                    "/api/matic_robot/slam_history_scene/entry/0123456789abcdef01234567"
                ),
            }
        ],
        "floors": [
            {
                "id": "current",
                "active": True,
                "read_only": False,
                "snapshots": [
                    {
                        "id": snapshot.snapshot_id,
                        "created_at": "2026-07-26T12:00:00+00:00",
                        "revision": 5,
                        "point_count": 1025,
                        "scene_url": (
                            "/api/matic_robot/slam_history_scene/entry/"
                            "0123456789abcdef01234567"
                        ),
                    }
                ],
            },
            {
                "id": "saved-1",
                "active": False,
                "read_only": True,
                "ordinal": 1,
                "snapshots": [
                    {
                        "id": saved_snapshot.snapshot_id,
                        "created_at": "2026-07-25T12:00:00+00:00",
                        "revision": 3,
                        "point_count": 512,
                        "scene_url": (
                            "/api/matic_robot/slam_history_scene/entry/"
                            "89abcdef0123456701234567"
                        ),
                    }
                ],
            },
        ],
    }
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
    runtime.slam_history.async_scene.assert_awaited_with(
        saved_snapshot.snapshot_id,
        mission_token=saved_snapshot.mission_token,
    )
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
    assert json.loads(no_active_floor.body)["snapshots"] == []

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
