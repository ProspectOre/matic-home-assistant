"""Coordinator resilience tests."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.update_coordinator import UpdateFailed

from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
    MaticError,
)
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CuesGestureStatus,
    CuesIntent,
    CuesVoiceStatus,
    FloorPlan,
    RobotInfo,
    RobotOperationalState,
    RobotTelemetry,
    Room,
)
from custom_components.matic_robot.coordinator import MaticCoordinator, MaticCuesEvent


def _client() -> AsyncMock:
    client = AsyncMock()
    client.async_get_info.return_value = RobotInfo(
        "synthetic",
        "Test",
        "robot.invalid",
        16320,
        "192.0.2.1",
        "2001:db8::1",
        True,
        True,
        True,
        "test",
    )
    client.async_get_state.return_value = RobotOperationalState(
        50, (), (), False, False, False, False, False, False
    )
    client.async_get_floor_plan.return_value = None
    client.async_get_pose.return_value = None
    client.async_get_telemetry.return_value = RobotTelemetry(protocol_version=25)
    return client


def _tracking_entry() -> SimpleNamespace:
    entry = SimpleNamespace(async_on_unload=MagicMock(), entry_id="entry")
    entry.async_create_background_task = lambda hass, target, name: (
        hass.async_create_task(target, name)
    )
    return entry


def _coordinator(hass, client) -> MaticCoordinator:
    return MaticCoordinator(hass, client, config_entry=_tracking_entry())


def test_discard_current_room_delegates_to_session_tracker(hass) -> None:
    coordinator = _coordinator(hass, _client())
    now = datetime(2026, 7, 21, 2, tzinfo=UTC)

    with (
        patch(
            "custom_components.matic_robot.coordinator.CleaningSessionTracker.discard_current_room"
        ) as discard,
        patch(
            "custom_components.matic_robot.coordinator.dt_util.utcnow",
            return_value=now,
        ),
    ):
        coordinator.async_discard_current_room()

    discard.assert_called_once_with(now=now)


def test_confirm_completed_room_delegates_to_session_tracker(hass) -> None:
    coordinator = _coordinator(hass, _client())

    with patch(
        "custom_components.matic_robot.coordinator.CleaningSessionTracker.confirm_room_completed"
    ) as confirm:
        coordinator.async_confirm_room_completed("Living Room")

    confirm.assert_called_once_with("Living Room")


async def test_update_combines_required_and_optional_local_state(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)

    state = await coordinator._async_update_data()

    assert state.info.name == "Test"
    assert state.operational.battery_percentage == 50
    assert state.floor_plan is None
    assert state.pose is None
    assert state.telemetry.protocol_version == 25


async def test_live_cues_state_emits_safe_entity_and_bus_events(hass) -> None:
    from pytest_homeassistant_custom_component.common import async_capture_events

    from custom_components.matic_robot.const import EVENT_CUES

    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    entity_events: list[MaticCuesEvent] = []
    remove_listener = coordinator.async_add_cues_listener(entity_events.append)
    bus_events = async_capture_events(hass, EVENT_CUES)

    ready = replace(
        initial.operational,
        cues_voice_status=CuesVoiceStatus.LISTENING_FOR_WAKE_WORD,
    )
    coordinator.async_process_cues_state(ready)
    listening = replace(
        ready,
        cues_voice_status=CuesVoiceStatus.LISTENING_FOR_INTENT,
    )
    coordinator.async_process_cues_state(listening)
    classified = replace(
        listening,
        cues_voice_status=CuesVoiceStatus.CLASSIFIED,
        cues_voice_intent=CuesIntent.POINT_TO_CLEAN,
        cues_gesture_status=CuesGestureStatus.POINTED_TARGET_ACCEPTED,
        following_person=True,
    )
    coordinator.async_process_cues_state(classified)
    coordinator.async_process_cues_state(classified)
    await hass.async_block_till_done()

    assert [event.event_type for event in entity_events] == [
        "ready",
        "wake_word_detected",
        "intent_classified",
        "gesture_pointed_target_accepted",
        "following_started",
    ]
    assert entity_events[2].attributes == {"intent": "point_to_clean"}
    assert [event.data["event_type"] for event in bus_events] == [
        event.event_type for event in entity_events
    ]
    assert bus_events[2].data["intent"] == "point_to_clean"
    assert bus_events[2].data["entry_id"] == "entry"
    assert bus_events[2].data["device_id"] is None
    assert coordinator.data.operational.following_person is True

    remove_listener()
    coordinator.async_process_cues_state(replace(classified, following_person=False))
    assert entity_events[-1].event_type == "following_started"


@pytest.mark.parametrize(
    ("voice_status", "event_type"),
    [
        (CuesVoiceStatus.DISABLED, "disabled"),
        (CuesVoiceStatus.THINKING_FOR_INTENT, "intent_processing"),
        (CuesVoiceStatus.REJECTED, "intent_rejected"),
    ],
)
async def test_live_cues_remaining_voice_transitions(
    hass, voice_status: CuesVoiceStatus, event_type: str
) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    events: list[MaticCuesEvent] = []
    coordinator.async_add_cues_listener(events.append)

    coordinator.async_process_cues_state(
        replace(initial.operational, cues_voice_status=voice_status)
    )

    assert [event.event_type for event in events] == [event_type]


async def test_live_cues_classified_intent_can_change_in_place(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    classified = replace(
        initial.operational,
        cues_voice_status=CuesVoiceStatus.CLASSIFIED,
        cues_voice_intent=CuesIntent.CLEAN,
    )
    coordinator.async_set_updated_data(replace(initial, operational=classified))
    events: list[MaticCuesEvent] = []
    coordinator.async_add_cues_listener(events.append)

    coordinator.async_process_cues_state(
        replace(classified, cues_voice_intent=CuesIntent.CLEAN_ALL)
    )

    assert events == [MaticCuesEvent("intent_classified", {"intent": "clean_all"})]


async def test_live_cues_ignores_updates_before_initial_refresh(hass) -> None:
    coordinator = _coordinator(hass, _client())

    coordinator.async_process_cues_state(
        RobotOperationalState(50, (), (), False, False, False, False, False, False)
    )

    assert coordinator.data is None


async def test_cues_watcher_retries_transport_failures(hass) -> None:
    client = _client()

    async def failed_subscription():
        if False:
            yield client.async_get_state.return_value
        raise MaticError("offline")

    client.async_subscribe_state = failed_subscription
    coordinator = _coordinator(hass, client)

    with (
        patch(
            "custom_components.matic_robot.coordinator.asyncio.sleep",
            AsyncMock(side_effect=[None, asyncio.CancelledError]),
        ) as sleep,
        pytest.raises(asyncio.CancelledError),
    ):
        await coordinator.async_watch_cues()

    assert [args.args for args in sleep.await_args_list] == [(1,), (2,)]


async def test_cues_watcher_backs_off_after_initial_snapshots(hass) -> None:
    client = _client()
    attempts = 0

    async def short_lived_subscription():
        nonlocal attempts
        attempts += 1
        yield client.async_get_state.return_value
        if attempts == 3:
            yield client.async_get_state.return_value
        raise MaticError("stream closed")

    client.async_subscribe_state = short_lived_subscription
    coordinator = _coordinator(hass, client)

    with (
        patch(
            "custom_components.matic_robot.coordinator.asyncio.sleep",
            AsyncMock(side_effect=[None, None, asyncio.CancelledError]),
        ) as sleep,
        pytest.raises(asyncio.CancelledError),
    ):
        await coordinator.async_watch_cues()

    assert [args.args for args in sleep.await_args_list] == [(1,), (2,), (1,)]


async def test_cues_watcher_applies_updates_and_propagates_cancel(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    updated = replace(
        initial.operational,
        cues_voice_status=CuesVoiceStatus.LISTENING_FOR_INTENT,
    )

    async def subscription():
        yield updated
        raise asyncio.CancelledError

    client.async_subscribe_state = subscription

    with pytest.raises(asyncio.CancelledError):
        await coordinator.async_watch_cues()

    assert (
        coordinator.data.operational.cues_voice_status
        is CuesVoiceStatus.LISTENING_FOR_INTENT
    )


async def test_live_cues_push_wins_over_an_overlapping_poll(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    state_read_started = asyncio.Event()
    release_state_read = asyncio.Event()

    async def slow_state_read() -> RobotOperationalState:
        state_read_started.set()
        await release_state_read.wait()
        return initial.operational

    client.async_get_state.side_effect = slow_state_read
    poll = hass.async_create_task(coordinator._async_update_data())
    await state_read_started.wait()
    pushed = replace(
        initial.operational,
        cues_voice_status=CuesVoiceStatus.CLASSIFIED,
        cues_voice_intent=CuesIntent.CLEAN_ALL,
        following_person=True,
    )
    coordinator.async_process_cues_state(pushed)
    release_state_read.set()

    state = await poll

    assert state.operational.cues_voice_status is CuesVoiceStatus.CLASSIFIED
    assert state.operational.cues_voice_intent is CuesIntent.CLEAN_ALL
    assert state.operational.following_person is True


async def test_optional_map_failures_do_not_hide_core_state(hass) -> None:
    client = _client()
    client.async_get_floor_plan.side_effect = MaticError("no floor plan")
    client.async_get_pose.side_effect = MaticError("no pose")

    state = await _coordinator(hass, client)._async_update_data()

    assert state.floor_plan is None
    assert state.pose is None


async def test_required_state_failure_becomes_update_failed(hass) -> None:
    client = _client()
    client.async_get_state.side_effect = MaticError("offline")

    with pytest.raises(UpdateFailed, match="offline"):
        await _coordinator(hass, client)._async_update_data()


async def test_optional_telemetry_failure_does_not_hide_core_state(hass) -> None:
    client = _client()
    client.async_get_telemetry.side_effect = MaticError("no telemetry")

    state = await _coordinator(hass, client)._async_update_data()

    assert state.info.name == "Test"
    assert state.telemetry == RobotTelemetry()


async def test_transient_robot_errors_require_two_consecutive_polls(hass) -> None:
    client = _client()
    fault = replace(client.async_get_state.return_value, error_codes=(207,))
    client.async_get_state.return_value = fault
    coordinator = _coordinator(hass, client)

    first = await coordinator._async_update_data()
    second = await coordinator._async_update_data()
    client.async_get_state.return_value = replace(fault, error_codes=())
    cleared = await coordinator._async_update_data()
    client.async_get_state.return_value = fault
    repeated_once = await coordinator._async_update_data()

    assert first.operational.error_codes == ()
    assert second.operational.error_codes == (207,)
    assert cleared.operational.error_codes == ()
    assert repeated_once.operational.error_codes == ()


async def test_rejected_credential_starts_home_assistant_reauthentication(hass) -> None:
    client = _client()
    client.async_get_state.side_effect = AuthenticationRequiredError("expired")

    with pytest.raises(ConfigEntryAuthFailed, match="rejected"):
        await _coordinator(hass, client)._async_update_data()


async def test_coordinator_caches_slow_reads_and_can_force_them(hass) -> None:
    client = _client()
    client.async_get_floor_plan.return_value = FloorPlan(1, "partition", b"", ())
    coordinator = _coordinator(hass, client)

    await coordinator._async_update_data()
    await coordinator._async_update_data()

    assert client.async_get_info.await_count == 1
    assert client.async_get_floor_plan.await_count == 1
    assert client.async_get_telemetry.await_count == 1
    assert client.async_get_state.await_count == 2
    assert client.async_get_pose.await_count == 2

    coordinator.async_request_refresh = AsyncMock()
    await coordinator.async_request_full_refresh()
    coordinator.async_request_refresh.assert_awaited_once()
    await coordinator._async_update_data()
    assert client.async_get_floor_plan.await_count == 2
    assert client.async_get_telemetry.await_count == 2


async def test_coordinator_refreshes_floor_plan_without_invalidating_telemetry(
    hass,
) -> None:
    client = _client()
    client.async_get_floor_plan.return_value = FloorPlan(1, "partition", b"", ())
    coordinator = _coordinator(hass, client)

    await coordinator._async_update_data()
    await coordinator._async_update_data()
    assert client.async_get_floor_plan.await_count == 1
    assert client.async_get_telemetry.await_count == 1

    coordinator.async_request_refresh = AsyncMock()
    await coordinator.async_request_floor_plan_refresh(84)
    coordinator.async_request_refresh.assert_awaited_once()
    await coordinator._async_update_data()

    assert client.async_get_floor_plan.await_count == 2
    client.async_get_floor_plan.assert_awaited_with(expected_mission_id=84)
    assert client.async_get_telemetry.await_count == 1


async def test_slow_refresh_failure_retains_last_good_values(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    first = await coordinator._async_update_data()
    client.async_get_floor_plan.side_effect = MaticError("map drift")
    client.async_get_telemetry.side_effect = MaticError("telemetry drift")
    coordinator._force_full_refresh = True

    second = await coordinator._async_update_data()

    assert second.floor_plan is first.floor_plan
    assert second.telemetry is first.telemetry


async def test_coordinator_records_observed_firmware(hass) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", protocol_version=25
    )
    client.async_get_state.return_value = replace(
        client.async_get_state.return_value, software_version="fallback"
    )
    tracker = SimpleNamespace(
        async_observe_version=AsyncMock(), needs_snapshot=MagicMock(return_value=False)
    )
    entry = _tracking_entry()
    coordinator = MaticCoordinator(
        hass, client, config_entry=entry, firmware_tracker=tracker
    )

    await coordinator._async_update_data()

    tracker.async_observe_version.assert_awaited_once_with(
        "entry", "v168.11", 25, device_id=None
    )
    tracker.needs_snapshot.assert_called_once_with("entry", "v168.11", 25)


async def test_coordinator_snapshots_each_new_firmware_once_in_background(hass) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", protocol_version=25
    )
    tracker = SimpleNamespace(
        async_observe_version=AsyncMock(),
        needs_snapshot=MagicMock(return_value=True),
        async_record_snapshot=AsyncMock(),
    )
    coordinator = MaticCoordinator(
        hass, client, config_entry=_tracking_entry(), firmware_tracker=tracker
    )
    snapshot = {
        "firmware_version": "v168.11",
        "endpoint_count": 40,
        "failed_endpoints": 0,
    }

    with patch(
        "custom_components.matic_robot.coordinator.async_build_firmware_snapshot",
        AsyncMock(return_value=snapshot),
    ) as build:
        await coordinator._async_update_data()
        await hass.async_block_till_done()

    build.assert_awaited_once()
    tracker.async_record_snapshot.assert_awaited_once_with("entry", snapshot)
    assert coordinator._snapshot_versions_in_progress == set()
    assert coordinator._snapshot_attempts == {}


async def test_transient_sweep_failures_defer_then_record_degraded(hass) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", protocol_version=25
    )
    tracker = SimpleNamespace(
        async_observe_version=AsyncMock(),
        needs_snapshot=MagicMock(return_value=True),
        async_record_snapshot=AsyncMock(),
    )
    coordinator = MaticCoordinator(
        hass, client, config_entry=_tracking_entry(), firmware_tracker=tracker
    )
    snapshot = {
        "firmware_version": "v168.11",
        "endpoint_count": 40,
        "failed_endpoints": 40,
    }

    with patch(
        "custom_components.matic_robot.coordinator.async_build_firmware_snapshot",
        AsyncMock(return_value=snapshot),
    ):
        await coordinator._async_update_data()
        await hass.async_block_till_done()
        tracker.async_record_snapshot.assert_not_awaited()
        assert coordinator._snapshot_attempts == {"v168.11": 1}

        # The retry cooldown suppresses an immediate re-sweep.
        await coordinator._async_update_data()
        await hass.async_block_till_done()
        assert coordinator._snapshot_attempts == {"v168.11": 1}

        coordinator._snapshot_retry_after = 0.0
        await coordinator._async_update_data()
        await hass.async_block_till_done()
        tracker.async_record_snapshot.assert_not_awaited()

        coordinator._snapshot_retry_after = 0.0
        await coordinator._async_update_data()
        await hass.async_block_till_done()

    tracker.async_record_snapshot.assert_awaited_once_with("entry", snapshot)
    assert coordinator._snapshot_attempts == {}


async def test_cleaning_finished_event_fires_once_per_new_session(hass) -> None:
    from pytest_homeassistant_custom_component.common import async_capture_events

    from custom_components.matic_robot.const import EVENT_CLEANING_FINISHED

    def _session(suffix: str) -> CleaningSession:
        return CleaningSession(
            started_at=f"2026-07-20T0{suffix}:00:00+00:00",
            ended_at=f"2026-07-20T0{suffix}:30:00+00:00",
            duration_seconds=1800,
            rooms=("Study",),
            room_durations=(("Study", 1800),),
            completed=True,
            completed_rooms=("Study",),
        )

    client = _client()
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    coordinator = _coordinator(hass, client)

    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", latest_session=_session("1")
    )
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert not events

    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", latest_session=_session("2")
    )
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    await hass.async_block_till_done()

    assert len(events) == 1
    assert events[0].data["duration_seconds"] == 1800
    assert events[0].data["completed_rooms"] == ["Study"]
    assert events[0].data["room_durations"] == {"Study": 1800}
    assert events[0].data["firmware_version"] == "v168.11"
    assert events[0].data["entry_id"] == "entry"

    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11",
        latest_session=CleaningSession(
            started_at="2026-07-20T03:00:00+00:00",
            ended_at=None,
            duration_seconds=None,
            rooms=(),
            room_durations=(),
            completed=False,
        ),
    )
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert len(events) == 1


async def test_coordinator_recovers_newer_session_from_recorder(hass) -> None:
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
    client.async_get_telemetry.return_value = RobotTelemetry(latest_session=old_session)
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
            "custom_components.matic_robot.coordinator.dt_util.utcnow",
            return_value=start + timedelta(minutes=10),
        ),
        patch(
            "homeassistant.components.recorder.history.get_significant_states",
            return_value=recorded,
        ) as get_history,
        patch(
            "homeassistant.helpers.recorder.get_instance",
            return_value=recorder,
        ),
    ):
        state = await _coordinator(hass, client)._async_update_data()

    assert state.telemetry.latest_session is not None
    assert state.telemetry.latest_session.started_at == start.isoformat()
    assert state.telemetry.latest_session.duration_seconds == 300
    assert state.telemetry.latest_session.room_durations == ()
    assert state.telemetry.latest_session.rooms == ()
    assert state.telemetry.latest_session.completed is False
    get_history.assert_called_once()
    recorder.async_add_executor_job.assert_awaited_once()


async def test_recorder_recovery_failure_does_not_break_updates(hass) -> None:
    client = _client()
    registry = er.async_get(hass)
    registry.async_get_or_create("binary_sensor", "matic_robot", "synthetic_cleaning")
    registry.async_get_or_create("sensor", "matic_robot", "synthetic_current_area")

    coordinator = _coordinator(hass, client)
    with patch(
        "homeassistant.helpers.recorder.get_instance",
        side_effect=[
            RuntimeError("recorder unavailable"),
            SimpleNamespace(async_add_executor_job=AsyncMock(return_value={})),
        ],
    ) as get_recorder:
        state = await coordinator._async_update_data()
        assert coordinator._session_history_recovered is False
        await coordinator._async_update_data()

    assert state.info.serial_number == "synthetic"
    assert coordinator._session_history_recovered is True
    assert get_recorder.call_count == 2


async def test_recorder_recovery_retries_until_entities_are_registered(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)

    await coordinator._async_update_data()
    assert coordinator._session_history_recovered is False

    registry = er.async_get(hass)
    registry.async_get_or_create("binary_sensor", "matic_robot", "synthetic_cleaning")
    registry.async_get_or_create("sensor", "matic_robot", "synthetic_current_area")
    recorder = SimpleNamespace(async_add_executor_job=AsyncMock(return_value={}))
    with patch("homeassistant.helpers.recorder.get_instance", return_value=recorder):
        await coordinator._async_update_data()

    assert coordinator._session_history_recovered is True


async def test_identity_mismatch_raises_repair_until_recovery(hass) -> None:
    from homeassistant.helpers import issue_registry as ir

    from custom_components.matic_robot.client.exceptions import (
        CertificateMismatchError,
    )
    from custom_components.matic_robot.const import DOMAIN

    client = _client()
    coordinator = _coordinator(hass, client)
    client.async_get_state.side_effect = CertificateMismatchError("changed")

    with pytest.raises(UpdateFailed, match="TLS identity"):
        await coordinator._async_update_data()
    with pytest.raises(UpdateFailed, match="TLS identity"):
        await coordinator._async_update_data()

    registry = ir.async_get(hass)
    issue_id = "robot_identity_changed_entry"
    assert registry.async_get_issue(DOMAIN, issue_id) is not None

    client.async_get_state.side_effect = None
    await coordinator._async_update_data()
    assert registry.async_get_issue(DOMAIN, issue_id) is None
    await coordinator._async_update_data()
    assert registry.async_get_issue(DOMAIN, issue_id) is None


async def test_coordinator_updates_device_registry_firmware_once(hass) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", protocol_version=25
    )
    registry = SimpleNamespace(
        async_get_device=MagicMock(return_value=SimpleNamespace(id="device")),
        async_update_device=MagicMock(),
    )
    coordinator = _coordinator(hass, client)

    with patch(
        "custom_components.matic_robot.coordinator.dr.async_get",
        return_value=registry,
    ):
        await coordinator._async_update_data()
        await coordinator._async_update_data()

    registry.async_update_device.assert_called_once_with("device", sw_version="v168.11")
