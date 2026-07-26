"""Tests for the authenticated private WebGL scene endpoints."""

from __future__ import annotations

import json
from http import HTTPStatus
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp.test_utils import make_mocked_request
from homeassistant.config_entries import ConfigEntryState
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot.client.models import (
    FloorPlan,
    RobotPose,
    Room,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.slam_scene import (
    POSE_API_URL,
    SCENE_API_URL,
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
    return SimpleNamespace(
        slam_map=SimpleNamespace(
            revision=revision,
            entries=MagicMock(
                return_value=entries
                if entries is not None
                else (synthetic_slam_entry(page_x=0, page_y=0),)
            ),
        ),
        coordinator=SimpleNamespace(
            data=SimpleNamespace(
                floor_plan=floor_plan,
                pose=RobotPose(0.1, 0.2, 0.0) if pose else None,
                operational=SimpleNamespace(current_area="Kitchen"),
            )
        ),
    )


def _hass(entry) -> SimpleNamespace:
    return SimpleNamespace(
        config_entries=SimpleNamespace(async_get_entry=MagicMock(return_value=entry)),
        async_add_executor_job=AsyncMock(side_effect=lambda target: target()),
    )


def _request(hass, *, etag: str | None = None, admin: bool = True):
    headers = {"If-None-Match": etag} if etag is not None else None
    request = make_mocked_request("GET", "/", headers=headers, app={KEY_HASS: hass})
    request["hass_user"] = SimpleNamespace(is_admin=admin)
    return request


def _entry(runtime, *, domain: str = DOMAIN, state=ConfigEntryState.LOADED):
    return SimpleNamespace(domain=domain, state=state, runtime_data=runtime)


async def test_scene_view_serves_and_etag_caches_compact_private_payload() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()

    response = await view.get(_request(hass), "entry")

    assert response.status == HTTPStatus.OK
    assert response.content_type == "application/vnd.matic.slam-scene"
    assert response.body.startswith(b"MATIC3D\x00")
    assert response.headers["Cache-Control"] == "private, no-cache"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    etag = response.headers["ETag"]

    cached = await view.get(_request(hass, etag=etag), "entry")

    assert cached.status == HTTPStatus.NOT_MODIFIED
    assert cached.headers["ETag"] == etag
    hass.async_add_executor_job.assert_awaited_once()

    runtime.slam_map.revision = 8
    refreshed = await view.get(_request(hass), "entry")
    assert refreshed.status == HTTPStatus.OK
    assert hass.async_add_executor_job.await_count == 2


async def test_scene_view_returns_conflict_until_photo_pages_exist() -> None:
    hass = _hass(_entry(_runtime(entries=())))

    response = await MaticSlamSceneView().get(_request(hass), "entry")

    assert response.status == HTTPStatus.CONFLICT


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


async def test_pose_view_returns_exact_fallback_and_unavailable_positions() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamPoseView()

    exact = await view.get(_request(hass), "entry")
    assert exact.status == HTTPStatus.OK
    assert json.loads(exact.body) == {
        "position": [0.1, 0.2],
        "source": "exact_pose",
        "revision": 7,
    }
    assert exact.headers["Cache-Control"] == "private, no-store"

    runtime.coordinator.data.pose = None
    fallback = await view.get(_request(hass), "entry")
    assert json.loads(fallback.body)["source"] == "current_area"

    runtime.coordinator.data.floor_plan = None
    unavailable = await view.get(_request(hass), "entry")
    assert json.loads(unavailable.body) == {
        "position": None,
        "source": "unavailable",
        "revision": 7,
    }


async def test_pose_view_hides_missing_entry_and_requires_admin() -> None:
    hass = _hass(None)
    view = MaticSlamPoseView()

    assert (await view.get(_request(hass), "entry")).status == HTTPStatus.NOT_FOUND
    with pytest.raises(Unauthorized):
        await view.get(_request(hass, admin=False), "entry")


def test_scene_endpoint_paths_are_scoped_to_config_entry() -> None:
    assert scene_api_url("synthetic") == SCENE_API_URL.replace(
        "{entry_id}", "synthetic"
    )
    assert pose_api_url("synthetic") == POSE_API_URL.replace("{entry_id}", "synthetic")
