"""The heartbeat's reads of what the robot does not push."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import (
    CleaningSession,
    FloorPlan,
    RobotOperationalState,
    RobotTelemetry,
    Room,
    RunProgress,
)
from custom_components.matic_robot.heartbeat import REQUEST_REFRESH_COOLDOWN_SECONDS
from tests.session_fakes import (
    SYNTHETIC_INFO,
    push_state,
    session_entry,
    start_session,
)

IDLE = RobotOperationalState(50, (), (), False, False, False, False, False, False)
CLEANING = RobotOperationalState(
    50, (119, 101, 132), (), False, False, False, False, True, False
)


def _client() -> AsyncMock:
    client = AsyncMock()
    client.async_get_info.return_value = SYNTHETIC_INFO
    client.async_get_state.return_value = IDLE
    client.async_get_floor_plan.return_value = None
    client.async_get_telemetry.return_value = RobotTelemetry(protocol_version=25)
    client.add_connection_listener = MagicMock()
    return client


async def test_discard_current_room_delegates_to_session_tracker(hass) -> None:
    session = await start_session(hass, _client())
    now = datetime(2026, 7, 21, 2, tzinfo=UTC)

    with (
        patch(
            "custom_components.matic_robot.heartbeat.CleaningSessionTracker.discard_current_room"
        ) as discard,
        patch(
            "custom_components.matic_robot.heartbeat.dt_util.utcnow", return_value=now
        ),
    ):
        session.heartbeat.async_discard_current_room()

    discard.assert_called_once_with(now=now)


async def test_confirm_completed_room_delegates_to_session_tracker(hass) -> None:
    session = await start_session(hass, _client())

    with patch(
        "custom_components.matic_robot.heartbeat.CleaningSessionTracker.confirm_room_completed"
    ) as confirm:
        session.heartbeat.async_confirm_room_completed("Living Room")

    confirm.assert_called_once_with("Living Room")


async def test_start_reads_the_floor_and_telemetry_and_watches_the_display(
    hass,
) -> None:
    client = _client()
    floor = FloorPlan(42, "partition", b"", ())
    client.async_get_floor_plan.return_value = floor

    session = await start_session(hass, client)

    assert session.info.name == "Test"
    assert session.floor.value is floor
    assert session.telemetry.value.protocol_version == 25
    assert session.progress.value is None
    client.async_get_floor_plan.assert_awaited_once_with(expected_mission_id=None)
    assert client.async_watch.call_args.args[0] == "displayed_mission"


async def test_a_state_pushed_during_a_heartbeat_outlives_it(hass) -> None:
    client = _client()
    session = await start_session(hass, client)
    read_started = asyncio.Event()
    release_read = asyncio.Event()

    async def held_read() -> RobotTelemetry:
        read_started.set()
        await release_read.wait()
        return RobotTelemetry(protocol_version=26)

    client.async_get_telemetry.side_effect = held_read
    session.heartbeat._slow_refresh_due = 0.0
    heartbeat = asyncio.create_task(session.heartbeat.async_refresh())
    await read_started.wait()
    await push_state(session, replace(IDLE, battery_percentage=47, cleaning=True))
    release_read.set()
    await heartbeat

    assert session.state.value.operational.battery_percentage == 47
    assert session.state.value.session_active is True
    assert session.telemetry.value.protocol_version == 26
    client.async_get_state.assert_awaited_once()


async def test_nothing_is_read_while_the_robot_cannot_be_reached(hass) -> None:
    client = _client()
    session = await start_session(hass, client)
    connection_changed = client.add_connection_listener.call_args.args[0]
    reads = client.async_get_telemetry.await_count

    client.connection_error = MaticError("offline")
    connection_changed()
    session.heartbeat._slow_refresh_due = 0.0
    await session.heartbeat.async_refresh()

    assert str(session.error.value) == "offline"
    assert client.async_get_telemetry.await_count == reads

    await push_state(session, replace(IDLE, battery_percentage=49))
    assert session.error.value is None
    await session.heartbeat.async_refresh()
    assert client.async_get_telemetry.await_count == reads + 1


async def test_an_outage_found_during_a_heartbeat_discards_its_reads(hass) -> None:
    client = _client()
    session = await start_session(hass, client)
    connection_changed = client.add_connection_listener.call_args.args[0]
    telemetry = session.telemetry.value

    async def read_that_finds_the_robot_gone() -> RobotTelemetry:
        client.connection_error = MaticError("offline")
        connection_changed()
        return RobotTelemetry(protocol_version=26)

    client.async_get_telemetry.side_effect = read_that_finds_the_robot_gone
    client.async_get_floor_plan.return_value = FloorPlan(42, "partition", b"", ())
    session.heartbeat._slow_refresh_due = 0.0
    session.heartbeat._map_refresh_due = 0.0
    await session.heartbeat.async_refresh()

    assert str(session.error.value) == "offline"
    assert session.telemetry.value is telemetry
    assert session.floor.value is None


async def test_the_heartbeat_is_slow_on_the_dock_and_restarts_when_that_changes(
    hass,
) -> None:
    client = _client()
    docked = replace(IDLE, charging_idle=True)
    client.async_get_state.return_value = docked
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    assert heartbeat.interval == timedelta(seconds=300)
    client.async_get_telemetry.reset_mock()
    heartbeat._slow_refresh_due = 0.0

    await push_state(session, replace(docked, battery_percentage=49))
    await hass.async_block_till_done()
    client.async_get_telemetry.assert_not_awaited()

    await push_state(session, replace(docked, charging_idle=False, cleaning=True))
    await hass.async_block_till_done()
    assert heartbeat.interval == timedelta(seconds=30)
    client.async_get_telemetry.assert_awaited_once()

    # The next read comes one interval after the last.
    heartbeat._slow_refresh_due = 0.0
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=31))
    await hass.async_block_till_done()
    assert client.async_get_telemetry.await_count == 2
    await session.async_stop()


async def test_requests_in_a_burst_cost_one_read_now_and_one_after(hass) -> None:
    client = _client()
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    heartbeat._slow_refresh_due = 0.0
    client.async_get_telemetry.reset_mock()

    await heartbeat.async_request_refresh()
    heartbeat._slow_refresh_due = 0.0
    await heartbeat.async_request_refresh()
    await heartbeat.async_request_refresh()
    assert client.async_get_telemetry.await_count == 1

    async_fire_time_changed(
        hass,
        dt_util.utcnow() + timedelta(seconds=REQUEST_REFRESH_COOLDOWN_SECONDS + 1),
    )
    await hass.async_block_till_done()
    assert client.async_get_telemetry.await_count == 2
    await session.async_stop()


async def test_no_heartbeat_is_scheduled_while_polling_is_disabled(hass) -> None:
    client = _client()
    entry = session_entry()
    entry.pref_disable_polling = True
    session = await start_session(hass, client, entry)
    client.async_get_telemetry.reset_mock()
    session.heartbeat._slow_refresh_due = 0.0

    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=301))
    await hass.async_block_till_done()

    client.async_get_telemetry.assert_not_awaited()
    assert session.heartbeat._timer is None


async def test_run_progress_is_read_only_during_a_clean(hass) -> None:
    client = _client()
    client.async_get_run_progress.return_value = RunProgress(600, 1800)
    session = await start_session(hass, client)
    heartbeat = session.heartbeat

    assert session.progress.value is None
    assert session.state.value.session_active is False
    client.async_get_run_progress.assert_not_awaited()

    await push_state(session, CLEANING)
    await heartbeat.async_refresh()
    assert session.state.value.session_active is True
    assert session.progress.value == RunProgress(600, 1800)

    client.async_get_run_progress.side_effect = MaticError("busy")
    await heartbeat.async_refresh()
    assert session.progress.value is None
    assert session.state.value.operational.cleaning

    # Progress belongs to the clean: it goes when the clean does.
    client.async_get_run_progress.side_effect = None
    await heartbeat.async_refresh()
    assert session.progress.value == RunProgress(600, 1800)
    await push_state(session, replace(IDLE, state_codes=(106,), charging_idle=True))
    assert session.state.value.session_active is False
    assert session.progress.value is None
    await session.async_stop()


async def test_optional_read_failures_do_not_hide_core_state(hass) -> None:
    client = _client()
    client.async_get_floor_plan.side_effect = MaticError("no floor plan")
    client.async_get_telemetry.side_effect = MaticError("no telemetry")

    session = await start_session(hass, client)

    assert session.floor.value is None
    assert session.telemetry.value == RobotTelemetry()
    assert session.state.value.operational == IDLE
    assert session.error.value is None


async def test_the_heartbeat_caches_slow_reads_and_can_force_them(hass) -> None:
    client = _client()
    client.async_get_floor_plan.return_value = FloorPlan(1, "partition", b"", ())
    session = await start_session(hass, client)

    await session.heartbeat.async_refresh()

    assert client.async_get_info.await_count == 1
    assert client.async_get_floor_plan.await_count == 1
    assert client.async_get_telemetry.await_count == 1
    assert client.async_get_state.await_count == 1

    await session.heartbeat.async_request_full_refresh()
    assert client.async_get_floor_plan.await_count == 2
    assert client.async_get_telemetry.await_count == 2
    assert session.heartbeat._force_full_refresh is False


async def test_pushed_task_evidence_changes_while_settings_remain_cached(hass) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(software_version="test")
    session = await start_session(hass, client)

    await push_state(session, replace(IDLE, cleaning=True))
    await session.heartbeat.async_refresh()

    assert session.state.value.session_active is True
    assert session.telemetry.value.software_version == "test"
    assert client.async_get_telemetry.await_count == 1
    client.async_get_active_cleaning_session_state.assert_not_awaited()


async def test_unknown_native_task_state_stays_unknown(hass) -> None:
    client = _client()
    session = await start_session(hass, client)
    session.heartbeat._force_full_refresh = True
    client.async_get_telemetry.side_effect = MaticError("settings unavailable")

    await push_state(session, replace(IDLE, charging=True, error_codes=(999,)))
    await session.heartbeat.async_refresh()

    # Hiding an unconfirmed error is presentation only; task evidence stays
    # unknown from the raw snapshot, not false from the normalized charging state.
    assert session.state.value.operational.error_codes == ()
    assert session.state.value.session_active is None
    client.async_get_active_cleaning_session_state.assert_not_awaited()


async def test_a_floor_refresh_leaves_telemetry_cached(hass) -> None:
    client = _client()
    client.async_get_floor_plan.return_value = FloorPlan(1, "partition", b"", ())
    session = await start_session(hass, client)
    heartbeat = session.heartbeat

    await heartbeat.async_refresh()
    assert client.async_get_floor_plan.await_count == 1

    heartbeat.async_request_refresh = AsyncMock()
    await heartbeat.async_request_floor_plan_refresh(84)
    heartbeat.async_request_refresh.assert_awaited_once()
    assert heartbeat.floor_read_generation == 1
    assert heartbeat.expected_floor_mission_id == 84
    await heartbeat.async_request_floor_plan_refresh(84)
    assert heartbeat.floor_read_generation == 1
    await heartbeat.async_refresh()

    assert client.async_get_floor_plan.await_count == 2
    client.async_get_floor_plan.assert_awaited_with(expected_mission_id=84)
    assert client.async_get_telemetry.await_count == 1


async def test_slow_refresh_failure_retains_last_good_values(hass) -> None:
    client = _client()
    client.async_get_floor_plan.return_value = FloorPlan(1, "partition", b"", ())
    session = await start_session(hass, client)
    floor, telemetry = session.floor.value, session.telemetry.value
    client.async_get_floor_plan.side_effect = MaticError("map drift")
    client.async_get_telemetry.side_effect = MaticError("telemetry drift")
    session.heartbeat._force_full_refresh = True

    await session.heartbeat.async_refresh()

    assert session.floor.value is floor is not None
    assert session.telemetry.value is telemetry


async def test_history_shows_the_newer_of_native_and_watched_runs(hass) -> None:
    client = _client()
    room = Room("room", "Living Room", "protocol", b"room", ())
    client.async_get_floor_plan.return_value = FloorPlan(
        1, "partition", b"partition", (room,)
    )
    old_session = CleaningSession(
        "2026-07-14T01:00:00+00:00",
        "2026-07-14T01:01:00+00:00",
        60,
        ("Living Room",),
        (),
        True,
    )
    client.async_get_telemetry.return_value = RobotTelemetry(
        latest_session=old_session, native_history_revision="r1"
    )
    registry = er.async_get(hass)
    cleaning_entity = registry.async_get_or_create(
        "binary_sensor", "matic_robot", "synthetic_cleaning"
    ).entity_id
    area_entity = registry.async_get_or_create(
        "sensor", "matic_robot", "synthetic_current_area"
    ).entity_id
    start = datetime(2026, 7, 21, 4, tzinfo=UTC)
    recorded = {
        cleaning_entity: [
            SimpleNamespace(state="on", last_updated=start),
            SimpleNamespace(state="off", last_updated=start + timedelta(minutes=5)),
        ],
        area_entity: [
            SimpleNamespace(
                state="the Living Room", last_updated=start - timedelta(seconds=1)
            )
        ],
    }
    recorder = SimpleNamespace(
        async_add_executor_job=AsyncMock(side_effect=lambda target: target())
    )

    with (
        patch(
            "custom_components.matic_robot.heartbeat.dt_util.utcnow",
            return_value=start + timedelta(minutes=10),
        ),
        patch(
            "homeassistant.components.recorder.history.get_significant_states",
            return_value=recorded,
        ) as get_history,
        patch("homeassistant.helpers.recorder.get_instance", return_value=recorder),
    ):
        session = await start_session(hass, client)

    history = session.history.value
    assert history.native_session is old_session
    assert history.revision == "r1"
    latest = history.latest_session
    assert latest is not None
    assert latest.started_at == start.isoformat()
    assert latest.duration_seconds == 300
    assert latest.room_durations == ()
    assert latest.rooms == ()
    assert latest.completed is False
    get_history.assert_called_once()
    recorder.async_add_executor_job.assert_awaited_once()


async def test_recorder_recovery_failure_does_not_break_reads(hass) -> None:
    client = _client()
    registry = er.async_get(hass)
    registry.async_get_or_create("binary_sensor", "matic_robot", "synthetic_cleaning")
    registry.async_get_or_create("sensor", "matic_robot", "synthetic_current_area")

    with patch(
        "homeassistant.helpers.recorder.get_instance",
        side_effect=[
            RuntimeError("recorder unavailable"),
            SimpleNamespace(async_add_executor_job=AsyncMock(return_value={})),
        ],
    ) as get_recorder:
        session = await start_session(hass, client)
        assert session.heartbeat._session_history_recovered is False
        assert session.telemetry.value.protocol_version == 25
        await session.heartbeat.async_refresh()

    assert session.heartbeat._session_history_recovered is True
    assert get_recorder.call_count == 2


async def test_recorder_recovery_retries_until_entities_are_registered(hass) -> None:
    client = _client()
    session = await start_session(hass, client)
    assert session.heartbeat._session_history_recovered is False

    registry = er.async_get(hass)
    registry.async_get_or_create("binary_sensor", "matic_robot", "synthetic_cleaning")
    registry.async_get_or_create("sensor", "matic_robot", "synthetic_current_area")
    recorder = SimpleNamespace(async_add_executor_job=AsyncMock(return_value={}))
    with patch("homeassistant.helpers.recorder.get_instance", return_value=recorder):
        await session.heartbeat.async_refresh()
        await session.heartbeat.async_refresh()

    assert session.heartbeat._session_history_recovered is True
    # Recovered history is read once, not on every heartbeat.
    recorder.async_add_executor_job.assert_awaited_once()


async def test_stopping_cancels_the_next_heartbeat(hass) -> None:
    client = _client()
    session = await start_session(hass, client)
    assert session.heartbeat._timer is not None

    await session.async_stop()
    client.async_get_telemetry.reset_mock()
    session.heartbeat._slow_refresh_due = 0.0
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=301))
    await hass.async_block_till_done()

    assert session.heartbeat._timer is None
    client.async_get_telemetry.assert_not_awaited()
