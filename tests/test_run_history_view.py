"""Tests for the cleaning history endpoint and the trail recorder hooks."""

from __future__ import annotations

import json
from http import HTTPStatus
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from aiohttp.test_utils import make_mocked_request
from homeassistant.core import HomeAssistant
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
)
from custom_components.matic_robot.plans import (
    MANUAL_ROOM_SEQUENCE_PLAN_ID,
    CleaningPlanManager,
)
from custom_components.matic_robot.run_history import LIVE_TRAIL_ID, RunTrails
from custom_components.matic_robot.slam_scene import (
    MaticRunHistoryView,
    MaticSlamPoseView,
    observe_coordinator_trail,
)
from tests.test_slam_scene import (
    _browser_session_key,
    _entry,
    _hass,
    _request,
    _runtime,
)


def _query(hass, query: str):
    request = make_mocked_request("GET", f"/{query}", app={KEY_HASS: hass})
    request["hass_user"] = SimpleNamespace(is_admin=True)
    return request


def _session(started_at: str, ended_at: str | None) -> CleaningSession:
    return CleaningSession(
        started_at=started_at,
        ended_at=ended_at,
        duration_seconds=None,
        rooms=("Den",),
        room_durations=(),
        completed=True,
    )


async def test_history_view_requires_a_loaded_robot_with_trails() -> None:
    view = MaticRunHistoryView()
    missing = await view.get(_request(_hass(None)), "entry")
    assert missing.status == HTTPStatus.NOT_FOUND
    without_trails = await view.get(_request(_hass(_entry(_runtime()))), "entry")
    assert without_trails.status == HTTPStatus.NOT_FOUND


async def test_history_view_lists_runs_with_trails_on_this_map(
    hass: HomeAssistant,
) -> None:
    runtime = _runtime()
    key = _browser_session_key(runtime)
    trails = RunTrails(hass, "entry")
    for point in ((0, 0), (1, 0), (2, 0)):
        trails.observe(run_id=None, native_active=True, map_key=key, point=point)
    trails.observe(run_id=None, native_active=False, map_key=key, point=None)
    for point in ((0, 1), (1, 1)):
        trails.observe(run_id="run-2", native_active=True, map_key=key, point=point)
    runtime.run_trails = trails
    robot_run = CleaningSessionRecord(
        b"robot", _session("2020-01-01T00:00:00+00:00", None)
    )
    runtime.client.async_get_cleaning_session_records = AsyncMock(
        return_value=(robot_run,)
    )
    stored = trails._data()["trails"][0]
    runtime.cleaning_plans.run_history = MagicMock(
        return_value=[
            {"id": "run-2", "source": "home_assistant"},
            {
                "id": "robot-1",
                "source": "robot",
                "started_at": stored["started_at"],
                "ended_at": None,
            },
            {
                "id": "robot-2",
                "source": "robot",
                "started_at": "2020-01-01T00:00:00+00:00",
                "ended_at": "2020-01-01T00:10:00+00:00",
            },
        ]
    )
    hass_stub = _hass(_entry(runtime))

    response = await MaticRunHistoryView().get(_request(hass_stub), "entry")
    payload = json.loads(response.body)
    assert response.headers["Cache-Control"] == "private, no-store, max-age=0"
    assert payload["entry_id"] == "entry"
    assert payload["map_session_key"] == key
    assert payload["robot_history"] is True
    assert [run["trail"] for run in payload["runs"]] == [
        LIVE_TRAIL_ID,
        stored["id"],
        None,
    ]
    runtime.cleaning_plans.run_history.assert_called_once_with(
        "synthetic-serial", (robot_run,)
    )

    trail = await MaticRunHistoryView().get(
        _query(hass_stub, f"?trail={stored['id']}"), "entry"
    )
    assert json.loads(trail.body) == {
        "trail": stored["id"],
        "map_session_key": key,
        "segments": [[[0, 0], [1, 0], [2, 0]]],
    }
    live = await MaticRunHistoryView().get(_query(hass_stub, "?trail=live"), "entry")
    assert json.loads(live.body)["segments"] == [[[0, 1], [1, 1]]]
    missing = await MaticRunHistoryView().get(_query(hass_stub, "?trail=gone"), "entry")
    assert missing.status == HTTPStatus.NOT_FOUND


async def test_history_view_still_lists_runs_when_robot_history_fails(
    hass: HomeAssistant,
) -> None:
    runtime = _runtime()
    runtime.run_trails = RunTrails(hass, "entry")
    runtime.cleaning_plans.run_history = MagicMock(return_value=[])
    for failure in (CannotConnectError("offline"), TimeoutError()):
        runtime.client.async_get_cleaning_session_records = AsyncMock(
            side_effect=failure
        )
        response = await MaticRunHistoryView().get(
            _request(_hass(_entry(runtime))), "entry"
        )
        payload = json.loads(response.body)
        assert payload["robot_history"] is False
        assert payload["runs"] == []
        runtime.cleaning_plans.run_history.assert_called_with("synthetic-serial", ())


async def test_live_pose_reads_feed_the_trail_recorder() -> None:
    runtime = _runtime()
    runtime.run_trails = MagicMock()
    runtime.cleaning_plans.active_run_id = MagicMock(return_value="run-1")
    hass = _hass(_entry(runtime))
    with patch(
        "custom_components.matic_robot.slam_scene.time",
        return_value=runtime.coordinator.data.pose.observed_at,
    ):
        await MaticSlamPoseView().get(_request(hass), "entry")
    runtime.run_trails.observe.assert_called_once_with(
        run_id="run-1",
        native_active=False,
        map_key=_browser_session_key(runtime),
        point=(0.1, 0.2),
    )

    fallback = _runtime(pose=False)
    fallback.run_trails = MagicMock()
    fallback.client.async_get_pose.side_effect = CannotConnectError("offline")
    await MaticSlamPoseView().get(_request(_hass(_entry(fallback))), "entry")
    fallback.run_trails.observe.assert_not_called()


def test_coordinator_updates_record_exact_poses_and_close_runs() -> None:
    runtime = _runtime()
    runtime.run_trails = MagicMock()
    runtime.cleaning_plans.active_run_id = MagicMock(return_value=None)
    observe_coordinator_trail(runtime)
    assert runtime.run_trails.observe.call_args.kwargs["point"] == (0.1, 0.2)

    runtime.slam_map.mission_identity = None
    observe_coordinator_trail(runtime)
    assert runtime.run_trails.observe.call_args.kwargs == {
        "run_id": None,
        "native_active": False,
        "map_key": None,
        "point": None,
    }
    observe_coordinator_trail(_runtime())


async def test_manager_history_freezes_runs_and_follows_a_late_dock(
    hass: HomeAssistant,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_begin_run(
        "serial",
        f"{MANUAL_ROOM_SEQUENCE_PLAN_ID}_x",
        "run-1",
        1,
        trigger="user",
        service="clean_room_sequence",
        provenance="user",
    )
    (running,) = manager.run_history("serial")
    assert (running["id"], running["outcome"]) == ("run-1", "running")
    assert running["plan_name"] is None

    await manager.async_finish_run(
        "serial", "run-1", "cancelled", "managed_stop", 0, terminal_activity="idle"
    )
    (stopped,) = manager.run_history("serial")
    assert (stopped["outcome"], stopped["ending"]) == ("not_finished", "stopped")
    assert await manager.async_mark_run_docked("serial", "run-1")
    (docked,) = manager.run_history("serial")
    assert docked["ending"] == "stopped"
    assert manager._robot("serial")["run_history"][0]["outcome"] == "stopped_docked"
