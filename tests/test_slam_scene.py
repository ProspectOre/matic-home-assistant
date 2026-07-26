"""Tests for the authenticated private WebGL scene endpoints."""

from __future__ import annotations

import asyncio
import json
from http import HTTPStatus
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp.test_utils import make_mocked_request
from google.protobuf.message import DecodeError
from homeassistant.config_entries import ConfigEntryState
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import (
    FloorPlan,
    RobotPose,
    Room,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.slam_scene import (
    CATALOG_API_URL,
    POSE_API_URL,
    PRIVATE_NO_STORE_HEADERS,
    SCENE_API_URL,
    MaticSlamCatalogView,
    MaticSlamPoseView,
    MaticSlamSceneView,
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
    return SimpleNamespace(
        client=SimpleNamespace(async_get_pose=AsyncMock(return_value=robot_pose)),
        slam_map=SimpleNamespace(
            revision=revision,
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
            entries=MagicMock(
                return_value=entries
                if entries is not None
                else (synthetic_slam_entry(page_x=0, page_y=0),)
            ),
        ),
        coordinator=SimpleNamespace(
            data=SimpleNamespace(
                floor_plan=floor_plan,
                pose=robot_pose,
                operational=SimpleNamespace(current_area="Kitchen"),
            )
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


def _request(hass, *, etag: str | None = None, admin: bool = True):
    headers = {"If-None-Match": etag} if etag is not None else None
    request = make_mocked_request("GET", "/", headers=headers, app={KEY_HASS: hass})
    request["hass_user"] = SimpleNamespace(is_admin=admin)
    return request


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


@pytest.mark.parametrize("change", ["revision", "floor"])
async def test_scene_serves_coherent_snapshot_when_live_identity_changes(
    change: str,
) -> None:
    runtime = _runtime()
    captured_floor_plan = runtime.coordinator.data.floor_plan
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
                runtime.coordinator.data.floor_plan = _floor_plan()
        return encoded

    hass.async_add_executor_job.side_effect = mutate_during_first_encode

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.OK
    assert calls == 1
    assert view._cache["entry"].key == (7, id(captured_floor_plan))


async def test_scene_advances_coherent_snapshots_during_continuous_updates() -> None:
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

    assert first.status == HTTPStatus.OK
    assert second.status == HTTPStatus.OK
    assert hass.async_add_executor_job.await_count == 2
    assert view._cache["entry"].key[0] == 8
    assert runtime.slam_map.revision == 9


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


async def test_scene_view_coalesces_concurrent_encodes() -> None:
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
    second = asyncio.create_task(view.get(_request(hass), "entry"))
    await asyncio.sleep(0)
    release.set()

    responses = await asyncio.gather(first, second)

    assert [response.status for response in responses] == [HTTPStatus.OK] * 2
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
        await MaticSlamCatalogView().get(_request(hass, admin=False))

    response = await MaticSlamCatalogView().get(_request(hass))

    assert response.status == HTTPStatus.OK
    assert (
        response.headers["Cache-Control"] == PRIVATE_NO_STORE_HEADERS["Cache-Control"]
    )
    assert json.loads(response.body) == {
        "entries": [
            {
                "entry_id": loaded.entry_id,
                "scene_url": f"/api/matic_robot/slam_scene/{loaded.entry_id}",
                "pose_url": f"/api/matic_robot/slam_pose/{loaded.entry_id}",
                "map_revision": 7,
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


def test_scene_endpoint_paths_are_scoped_to_config_entry() -> None:
    assert CATALOG_API_URL == "/api/matic_robot/slam_entries"
    assert scene_api_url("synthetic") == SCENE_API_URL.replace(
        "{entry_id}", "synthetic"
    )
    assert pose_api_url("synthetic") == POSE_API_URL.replace("{entry_id}", "synthetic")
