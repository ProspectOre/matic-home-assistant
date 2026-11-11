"""Listeners on a session's stores: Cues, firmware, time zone, finished runs."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.helpers import issue_registry as ir
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSchedule,
    CleaningSession,
    CuesGestureStatus,
    CuesIntent,
    CuesVoiceStatus,
    RobotOperationalState,
    RobotTelemetry,
)
from custom_components.matic_robot.const import (
    DOMAIN,
    EVENT_CLEANING_FINISHED,
    EVENT_CUES,
)
from custom_components.matic_robot.cues import CuesTransitions, MaticCuesEvent
from custom_components.matic_robot.session import RobotSession
from custom_components.matic_robot.session_listeners import (
    FIRMWARE_CHECK_SECONDS,
    _FirmwareWatch,
    _TimeZoneCheck,
    async_listen,
)
from tests.session_fakes import (
    SYNTHETIC_INFO,
    push_state,
    session_entry,
    start_session,
)

IDLE = RobotOperationalState(50, (), (), False, False, False, False, False, False)
LISTENERS = "custom_components.matic_robot.session_listeners"
TIME_ZONE_ISSUE = "time_zone_mismatch_entry"


def _client(telemetry: RobotTelemetry | None = None) -> AsyncMock:
    client = AsyncMock()
    client.async_get_info.return_value = SYNTHETIC_INFO
    client.async_get_state.return_value = IDLE
    client.async_get_floor_plan.return_value = None
    client.async_get_telemetry.return_value = telemetry or RobotTelemetry(
        protocol_version=25
    )
    client.add_connection_listener = MagicMock()
    return client


def _tracker(**methods: object) -> SimpleNamespace:
    return SimpleNamespace(
        **{
            "async_observe_version": AsyncMock(return_value=False),
            "needs_snapshot": MagicMock(return_value=False),
            **methods,
        }
    )


async def _listening(
    hass, client: AsyncMock, tracker: SimpleNamespace | None = None, now=None
) -> RobotSession:
    """Start a session on ``client`` and every listener on its stores."""
    entry = session_entry()
    session = await start_session(hass, client, entry)
    with patch(f"{LISTENERS}.dt_util.utcnow", return_value=now or dt_util.utcnow()):
        async_listen(hass, entry, session, tracker or _tracker())
    await hass.async_block_till_done()
    return session


async def _read(hass, session: RobotSession, telemetry: RobotTelemetry) -> None:
    """Have the heartbeat read ``telemetry`` now, past its cache."""
    session.client.async_get_telemetry.return_value = telemetry
    session.heartbeat._force_full_refresh = True
    await session.heartbeat.async_refresh()
    await hass.async_block_till_done()


async def _watching_firmware(
    hass, client: AsyncMock, tracker: SimpleNamespace
) -> tuple[RobotSession, _FirmwareWatch]:
    entry = session_entry()
    session = await start_session(hass, client, entry)
    watch = _FirmwareWatch(hass, entry, session, tracker)
    watch.async_start()
    await hass.async_block_till_done()
    return session, watch


def _firmware(version: str, protocol: int) -> RobotTelemetry:
    return RobotTelemetry(software_version=version, protocol_version=protocol)


async def test_unloading_the_entry_removes_every_listener(hass) -> None:
    client = _client(_firmware("v168.11", 25))
    entry = session_entry()
    session = await start_session(hass, client, entry)
    tracker = _tracker()
    async_listen(hass, entry, session, tracker)
    await hass.async_block_till_done()
    tracker.async_observe_version.assert_awaited_once()
    events = async_capture_events(hass, EVENT_CUES)

    entry.unload()
    await push_state(
        session,
        replace(IDLE, cues_voice_status=CuesVoiceStatus.LISTENING_FOR_WAKE_WORD),
    )
    await _read(hass, session, _firmware("v168.12", 26))
    async_fire_time_changed(
        hass, dt_util.utcnow() + timedelta(seconds=FIRMWARE_CHECK_SECONDS + 1)
    )
    await hass.async_block_till_done()

    assert events == []
    tracker.async_observe_version.assert_awaited_once()
    await session.async_stop()


async def test_live_cues_state_emits_safe_entity_and_bus_events(hass) -> None:
    session = await _listening(hass, _client())
    entity_events: list[MaticCuesEvent] = []
    remove_listener = CuesTransitions(session.state, entity_events.append).subscribe()
    bus_events = async_capture_events(hass, EVENT_CUES)

    ready = replace(IDLE, cues_voice_status=CuesVoiceStatus.LISTENING_FOR_WAKE_WORD)
    await push_state(session, ready)
    listening = replace(ready, cues_voice_status=CuesVoiceStatus.LISTENING_FOR_INTENT)
    await push_state(session, listening)
    classified = replace(
        listening,
        cues_voice_status=CuesVoiceStatus.CLASSIFIED,
        cues_voice_intent=CuesIntent.POINT_TO_CLEAN,
        cues_gesture_status=CuesGestureStatus.POINTED_TARGET_ACCEPTED,
        following_person=True,
    )
    await push_state(session, classified)
    await push_state(session, classified)
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
    assert session.state.value.operational.following_person is True

    remove_listener()
    await push_state(session, replace(classified, following_person=False))
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
    session = await start_session(hass, _client())
    events: list[MaticCuesEvent] = []
    CuesTransitions(session.state, events.append).subscribe()

    await push_state(session, replace(IDLE, cues_voice_status=voice_status))

    assert [event.event_type for event in events] == [event_type]


async def test_live_cues_classified_intent_can_change_in_place(hass) -> None:
    client = _client()
    classified = replace(
        IDLE,
        cues_voice_status=CuesVoiceStatus.CLASSIFIED,
        cues_voice_intent=CuesIntent.CLEAN,
    )
    client.async_get_state.return_value = classified
    session = await start_session(hass, client)
    events: list[MaticCuesEvent] = []
    CuesTransitions(session.state, events.append).subscribe()

    await push_state(
        session, replace(classified, cues_voice_intent=CuesIntent.CLEAN_ALL)
    )

    assert events == [MaticCuesEvent("intent_classified", {"intent": "clean_all"})]


async def test_observed_firmware_is_recorded(hass) -> None:
    client = _client(_firmware("v168.11", 25))
    client.async_get_state.return_value = replace(IDLE, software_version="fallback")
    tracker = _tracker()

    await _listening(hass, client, tracker)

    tracker.async_observe_version.assert_awaited_once_with(
        "entry", "v168.11", 25, device_id=None
    )
    tracker.needs_snapshot.assert_called_once_with(
        "entry", "v168.11", 25, context="ready"
    )


async def test_a_change_during_a_check_is_checked_after_it(hass) -> None:
    client = _client(_firmware("v168.11", 25))
    release = asyncio.Event()
    versions: list[str | None] = []

    async def observe(_entry_id, version, _protocol, *, device_id):
        versions.append(version)
        await release.wait()
        return False

    tracker = _tracker(async_observe_version=AsyncMock(side_effect=observe))
    entry = session_entry()
    session = await start_session(hass, client, entry)
    _FirmwareWatch(hass, entry, session, tracker).async_start()
    await asyncio.sleep(0)
    session.heartbeat._force_full_refresh = True
    client.async_get_telemetry.return_value = _firmware("v168.12", 25)
    await session.heartbeat.async_refresh()
    await push_state(session, replace(IDLE, cleaning=True))
    release.set()
    await hass.async_block_till_done()

    # Two changes arrived during the first check; one more check covers both.
    assert versions == ["v168.11", "v168.12"]


async def test_each_new_firmware_is_snapshotted_once_in_background(hass) -> None:
    client = _client(_firmware("v168.11", 25))
    tracker = _tracker(
        needs_snapshot=MagicMock(return_value=True),
        occurrence_generation=MagicMock(return_value=7),
        async_record_snapshot=AsyncMock(return_value={}),
    )
    snapshot = {"firmware_version": "v168.11", "endpoint_count": 40}

    with patch(
        f"{LISTENERS}.async_build_firmware_snapshot", AsyncMock(return_value=snapshot)
    ) as build:
        session, watch = await _watching_firmware(hass, client, tracker)

    build.assert_awaited_once_with(session)
    tracker.async_record_snapshot.assert_awaited_once_with(
        "entry", snapshot, occurrence_generation=7
    )
    assert watch._snapshots_in_progress == set()
    assert watch._snapshot_retry_after[("v168.11", 25)] > 0


def _snapshot_tracker(changed: list[bool]) -> SimpleNamespace:
    return _tracker(
        async_observe_version=AsyncMock(side_effect=changed),
        needs_snapshot=MagicMock(return_value=True),
        occurrence_generation=MagicMock(side_effect=range(len(changed))),
        async_record_snapshot=AsyncMock(return_value={}),
    )


def _recording_build(snapshots: list[tuple[str | None, int | None]]) -> AsyncMock:
    async def build_snapshot(session):
        telemetry = session.telemetry.value
        snapshots.append((telemetry.software_version, telemetry.protocol_version))
        return {"firmware_version": telemetry.software_version}

    return AsyncMock(side_effect=build_snapshot)


@pytest.mark.parametrize(
    ("firmware_version", "protocol_version"),
    [("v168.12", 26), ("v168.11", 26)],
)
async def test_new_firmware_identity_bypasses_snapshot_cooldown(
    hass, firmware_version, protocol_version
) -> None:
    client = _client(_firmware("v168.11", 25))
    tracker = _snapshot_tracker([False, True])
    snapshots: list[tuple[str | None, int | None]] = []

    with patch(
        f"{LISTENERS}.async_build_firmware_snapshot", _recording_build(snapshots)
    ):
        session, watch = await _watching_firmware(hass, client, tracker)
        # A same-identity retry is throttled, but the next firmware/protocol
        # identity gets its initial snapshot immediately.
        await _read(hass, session, _firmware(firmware_version, protocol_version))

    assert snapshots == [("v168.11", 25), (firmware_version, protocol_version)]
    assert tracker.async_record_snapshot.await_count == 2
    assert watch._snapshots_in_progress == set()


async def test_returning_to_firmware_identity_bypasses_old_cooldown(hass) -> None:
    client = _client(_firmware("v168.11", 25))
    tracker = _snapshot_tracker([False, True, True])
    snapshots: list[tuple[str | None, int | None]] = []

    with patch(
        f"{LISTENERS}.async_build_firmware_snapshot", _recording_build(snapshots)
    ):
        session, watch = await _watching_firmware(hass, client, tracker)
        await _read(hass, session, _firmware("v168.12", 26))
        await _read(hass, session, _firmware("v168.11", 25))

    assert snapshots == [("v168.11", 25), ("v168.12", 26), ("v168.11", 25)]
    assert tracker.async_record_snapshot.await_count == 3
    assert watch._snapshot_retry_after[("v168.11", 25)] > 0


async def test_snapshot_failure_cooldown_defers_the_scheduled_retry(hass) -> None:
    client = _client(_firmware("v168.11", 25))
    tracker = _tracker(
        needs_snapshot=MagicMock(return_value=True),
        occurrence_generation=MagicMock(return_value=0),
        async_record_snapshot=AsyncMock(return_value={}),
    )
    snapshot = {"firmware_version": "v168.11", "failed_endpoints": 40}
    now = dt_util.utcnow()

    with patch(
        f"{LISTENERS}.async_build_firmware_snapshot", AsyncMock(return_value=snapshot)
    ) as build:
        _session, watch = await _watching_firmware(hass, client, tracker)
        tracker.async_record_snapshot.assert_awaited_once_with(
            "entry", snapshot, occurrence_generation=0
        )
        retry_key = ("v168.11", 25)
        assert watch._snapshot_retry_after[retry_key] > 0

        # The retry cooldown suppresses the next scheduled check's sweep.
        now += timedelta(seconds=FIRMWARE_CHECK_SECONDS + 1)
        async_fire_time_changed(hass, now)
        await hass.async_block_till_done()
        assert tracker.async_observe_version.await_count == 2
        assert build.await_count == 1

        watch._snapshot_retry_after[retry_key] = 0.0
        now += timedelta(seconds=FIRMWARE_CHECK_SECONDS + 1)
        async_fire_time_changed(hass, now)
        await hass.async_block_till_done()
        assert build.await_count == 2
    assert watch._snapshots_in_progress == set()


async def test_superseded_snapshot_clears_its_retry_cooldown(hass) -> None:
    tracker = _tracker(
        async_record_snapshot=AsyncMock(
            return_value={"discarded": True, "reason": "snapshot_occurrence_superseded"}
        )
    )
    session, watch = await _watching_firmware(hass, _client(), tracker)
    identity = ("v168.11", 25)
    watch._snapshot_retry_after[identity] = 100.0

    with patch(
        f"{LISTENERS}.async_build_firmware_snapshot",
        AsyncMock(return_value={"firmware_version": "v168.11"}),
    ):
        await watch._async_capture_snapshot(identity, 0)

    tracker.async_record_snapshot.assert_awaited_once_with(
        "entry", {"firmware_version": "v168.11"}, occurrence_generation=0
    )
    assert identity not in watch._snapshot_retry_after
    assert session.telemetry.value.software_version is None


async def test_device_registry_firmware_is_updated_once_per_version(hass) -> None:
    client = _client(_firmware("v168.11", 25))
    registry = SimpleNamespace(
        async_get_device_by_identifier=MagicMock(
            return_value=SimpleNamespace(id="device")
        ),
        async_update_device=MagicMock(),
    )

    with patch(f"{LISTENERS}.dr.async_get", return_value=registry):
        session = await _listening(hass, client)
        await push_state(session, replace(IDLE, battery_percentage=49))
        await _read(hass, session, replace(_firmware("v168.11", 25), wifi_state="up"))

    registry.async_get_device_by_identifier.assert_called_with(
        (DOMAIN, "synthetic"), "entry"
    )
    registry.async_update_device.assert_called_once_with("device", sw_version="v168.11")


def _zone(timezone: str | None, *schedules: CleaningSchedule) -> RobotTelemetry:
    return RobotTelemetry(protocol_version=25, timezone=timezone, schedules=schedules)


async def test_time_zone_mismatch_raises_repair_until_clocks_match(hass) -> None:
    registry = ir.async_get(hass)
    await hass.config.async_update(time_zone="America/Los_Angeles")
    client = _client(_zone("America/New_York"))

    with patch.object(
        ir, "async_create_issue", wraps=ir.async_create_issue
    ) as create_issue:
        session = await _listening(hass, client)
        await _read(hass, session, replace(_zone("America/New_York"), wifi_state="up"))
    create_issue.assert_called_once()
    issue = registry.async_get_issue(DOMAIN, TIME_ZONE_ISSUE)
    assert issue is not None
    assert issue.translation_key == "time_zone_mismatch"
    assert issue.translation_placeholders["robot_time_zone"] == "America/New_York"
    assert issue.translation_placeholders["home_time_zone"] == "America/Los_Angeles"

    # A failed optional read keeps the last decision.
    await _read(hass, session, _zone(None))
    assert registry.async_get_issue(DOMAIN, TIME_ZONE_ISSUE) is not None

    # So does a zone name Python can't resolve.
    await _read(hass, session, _zone("Not/A_Zone"))
    assert registry.async_get_issue(DOMAIN, TIME_ZONE_ISSUE) is not None

    # An alias of the same clock clears it.
    await _read(hass, session, _zone("US/Pacific"))
    assert registry.async_get_issue(DOMAIN, TIME_ZONE_ISSUE) is None

    # Home Assistant's own zone is checked again when it changes.
    await hass.config.async_update(time_zone="Europe/Paris")
    await hass.async_block_till_done()
    assert registry.async_get_issue(DOMAIN, TIME_ZONE_ISSUE) is not None


async def test_time_zone_repair_follows_each_enabled_schedule_zone(hass) -> None:
    def schedule(zone: str | None, enabled: bool | None = True) -> CleaningSchedule:
        return CleaningSchedule("Daily", ("mon",), 630, zone, False, enabled, ())

    await hass.config.async_update(time_zone="America/Los_Angeles")
    entry = session_entry()
    session = await start_session(hass, _client(), entry)
    check_zone = _TimeZoneCheck(hass, entry, session)
    check_zone.async_start()
    registry = ir.async_get(hass)

    async def check(
        *schedules: CleaningSchedule, robot: str | None = "America/New_York"
    ) -> ir.IssueEntry | None:
        await _read(hass, session, _zone(robot, *schedules))
        return registry.async_get_issue(DOMAIN, TIME_ZONE_ISSUE)

    # Schedules written in Home Assistant's zone run at the expected hour,
    # and a disabled schedule never runs.
    assert (
        await check(schedule("America/Los_Angeles"), schedule(None, enabled=False))
        is None
    )
    # A schedule without its own zone uses the robot's.
    issue = await check(schedule("America/Los_Angeles"), schedule(None))
    assert issue is not None
    assert issue.translation_placeholders["robot_time_zone"] == "America/New_York"
    # An unresolvable schedule zone falls back to the robot's, as the calendar
    # does, and then to Home Assistant's.
    assert await check(schedule("Not/A_Zone")) is not None
    assert await check(schedule("Not/A_Zone"), robot=None) is None
    # With no enabled schedule, an unresolvable robot zone keeps the decision.
    assert await check(robot="America/New_York") is not None
    assert await check(robot="Not/A_Zone") is not None
    # So does a zone pair that can't be compared.
    with patch(f"{LISTENERS}.time_zones_differ", return_value=None):
        assert await check(schedule("America/Chicago")) is not None

    # Scans are kept for one UTC day only.
    with patch(
        f"{LISTENERS}.dt_util.utcnow", return_value=datetime(2030, 1, 1, tzinfo=UTC)
    ):
        assert await check(schedule("America/Los_Angeles")) is None
    assert {day for _, _, day in check_zone._scans} == {datetime(2030, 1, 1).date()}


async def test_time_zone_repair_from_before_a_reload_clears_on_match(hass) -> None:
    ir.async_create_issue(
        hass,
        DOMAIN,
        TIME_ZONE_ISSUE,
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="time_zone_mismatch",
    )
    await hass.config.async_update(time_zone="America/Los_Angeles")

    await _listening(hass, _client(_zone("America/Los_Angeles")))

    assert ir.async_get(hass).async_get_issue(DOMAIN, TIME_ZONE_ISSUE) is None


async def test_cleaning_finished_reports_mode_counts_without_calling_vacuum_failed(
    hass,
) -> None:
    from custom_components.matic_robot.client.cleaning_session import (
        decode_cleaning_session,
    )
    from custom_components.matic_robot.llm import MaticRobotStatusAPI
    from tests.wire_builders import _bfield, _vfield

    session = await _listening(
        hass, _client(), now=datetime(2026, 7, 20, 1, tzinfo=UTC)
    )
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    summary = _bfield(3, _bfield(1, _vfield(1, 1784509800))) + _bfield(
        4, _bfield(1, _vfield(1, 1784511000))
    )
    for name, status, duration in (
        ("Study", 2, 120),
        ("Gallery", 1, 300),
        ("Den", 0, 0),
    ):
        detail = (
            _bfield(3, name.encode())
            + _bfield(4, _vfield(1, duration))
            + _vfield(5, status)
        )
        summary += _bfield(6, _bfield(1, _bfield(2, detail)))
    summary += _bfield(10, _bfield(8, _bfield(1, b"")))
    finished = decode_cleaning_session(_bfield(5, summary))
    assert finished.completed_rooms == ("Study",)
    assert finished.combined_completed_rooms == ()

    await _read(hass, session, RobotTelemetry(latest_session=finished))

    assert len(events) == 1
    event = events[0]
    assert event.data["completed_rooms"] == ["Study"]
    assert event.data["completion_scope"] == "native_room_summary"
    assert event.data["vacuum_completed_room_count"] == 1
    assert event.data["mop_completed_room_count"] == 0
    assert event.data["combined_completed_room_count"] == 0
    assert event.data["stop_reason"] == "stopped"
    api = MaticRobotStatusAPI(hass)
    api._async_capture_event(event)
    assert api.recent_events[-1]["data"]["vacuum_completed_room_count"] == 1
    assert api.recent_events[-1]["data"]["completion_scope"] == "native_room_summary"
    assert api.recent_events[-1]["data"]["stop_reason"] == "stopped"
    assert "Study" not in str(api.recent_events)


def _finished(hour: str) -> CleaningSession:
    return CleaningSession(
        started_at=f"2026-07-20T0{hour}:00:00+00:00",
        ended_at=f"2026-07-20T0{hour}:30:00+00:00",
        duration_seconds=1800,
        rooms=("Study",),
        room_durations=(("Study", 1800),),
        completed=True,
        completed_rooms=("Study",),
    )


async def test_cleaning_finished_event_fires_once_per_new_session(hass) -> None:
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    session = await _listening(
        hass, _client(), now=datetime(2026, 7, 20, 1, 45, tzinfo=UTC)
    )

    await _read(
        hass,
        session,
        RobotTelemetry(software_version="v168.11", latest_session=_finished("1")),
    )
    assert not events

    second = RobotTelemetry(software_version="v168.11", latest_session=_finished("2"))
    await _read(hass, session, second)
    await _read(hass, session, replace(second, wifi_state="up"))

    assert len(events) == 1
    assert events[0].data["duration_seconds"] == 1800
    assert events[0].data["completed_rooms"] == ["Study"]
    assert events[0].data["completion_scope"] == "legacy"
    assert events[0].data["room_durations"] == {"Study": 1800}
    assert events[0].data["firmware_version"] == "v168.11"
    assert events[0].data["entry_id"] == "entry"

    # Delayed native evidence describes the same physical run with more
    # accurate timestamps, not a second completed cleaning session.
    refined = replace(
        _finished("2"),
        started_at="2026-07-20T02:00:31+00:00",
        ended_at="2026-07-20T02:29:45+00:00",
    )
    await _read(hass, session, RobotTelemetry(latest_session=refined))
    assert len(events) == 1

    started = CleaningSession("2026-07-20T03:00:00+00:00", None, None, (), (), False)
    await _read(
        hass,
        session,
        RobotTelemetry(software_version="v168.11", latest_session=started),
    )
    # A partial snapshot naming an older active run does not replace it.
    older = replace(started, started_at="2026-07-20T02:45:00+00:00")
    await _read(hass, session, RobotTelemetry(latest_session=older))
    assert len(events) == 1

    await _read(hass, session, RobotTelemetry(latest_session=_finished("3")))
    assert len(events) == 2
    assert events[-1].data["started_at"] == "2026-07-20T03:00:00+00:00"


@pytest.mark.parametrize("empty_history", [False, True, None])
async def test_finished_event_waits_for_native_history_after_local_end(
    hass, empty_history
) -> None:
    """A local end must not consume the eventual native completion event."""
    session = await _listening(
        hass, _client(), now=datetime(2026, 7, 19, 12, tzinfo=UTC)
    )
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    previous = CleaningSession(
        "2026-07-19T01:00:00+00:00", "2026-07-19T01:10:00+00:00", 600, (), (), False
    )
    native = CleaningSession(
        "2026-07-20T01:00:00+00:00",
        "2026-07-20T01:30:00+00:00",
        1800,
        ("Study", "Den"),
        (("Study", 800), ("Den", 700)),
        True,
        ("Study", "Den"),
    )
    await _read(
        hass,
        session,
        RobotTelemetry(
            latest_session=previous if empty_history is False else None,
            local_cleaning_sessions=(
                None if empty_history is None else 0 if empty_history else 1
            ),
        ),
    )
    session.heartbeat._session_tracker.latest_session = replace(
        native,
        started_at="2026-07-20T01:00:30+00:00",
        ended_at="2026-07-20T01:30:02+00:00",
        completed=False,
        rooms=(),
        completed_rooms=(),
        room_durations=(),
    )
    await session.heartbeat.async_refresh()
    await hass.async_block_till_done()
    assert session.history.value.latest_session is not None
    assert not events

    await _read(hass, session, RobotTelemetry(latest_session=native))
    assert len(events) == 1
    assert events[0].data["completed"] is True
    assert events[0].data["completed_rooms"] == ["Study", "Den"]
    assert events[0].data["room_durations"] == {"Study": 800, "Den": 700}
    assert events[0].data["duration_seconds"] == 1800

    # A partial history snapshot must neither replay an older session nor
    # roll the deduplication cursor back and replay the completed run.
    for recorded in (previous, native):
        await _read(hass, session, RobotTelemetry(latest_session=recorded))
    assert len(events) == 1


@pytest.mark.parametrize("active_at_startup", [False, True])
async def test_finished_event_rejects_partial_startup_history(hass, active_at_startup):
    session = await _listening(
        hass, _client(), now=datetime(2026, 7, 20, 1, 45, tzinfo=UTC)
    )
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    active = CleaningSession("2026-07-20T01:40:00+00:00", None, None, (), (), False)
    await _read(
        hass,
        session,
        RobotTelemetry(
            latest_session=active if active_at_startup else None,
            local_cleaning_sessions=1 if active_at_startup else 0,
        ),
    )
    # An empty startup snapshot can omit a completed historical run. An
    # active startup cursor must also reject older starts even if their
    # reported end timestamp is newer than the listener's start.
    old = CleaningSession(
        "2026-07-20T01:00:00+00:00",
        "2026-07-20T01:50:00+00:00"
        if active_at_startup
        else "2026-07-20T01:30:00+00:00",
        1800,
        (),
        (),
        False,
    )
    await _read(hass, session, RobotTelemetry(latest_session=old))
    assert not events
    await _read(
        hass,
        session,
        RobotTelemetry(
            latest_session=replace(active, ended_at="2026-07-20T02:00:00+00:00")
        ),
    )
    assert len(events) == 1
    assert events[0].data["completed"] is False


async def test_finished_event_observed_native_run_ignores_host_clock_skew(hass):
    session = await _listening(hass, _client())
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    active = CleaningSession("2001-01-01T01:00:00+00:00", None, None, (), (), False)
    await _read(hass, session, RobotTelemetry(latest_session=active))
    await _read(
        hass,
        session,
        RobotTelemetry(
            latest_session=replace(
                active, ended_at="2001-01-01T01:00:01+00:00", completed=True
            )
        ),
    )
    assert len(events) == 1
    assert events[0].data["completed"] is True


async def test_native_finished_event_excludes_unattempted_room_scope(hass):
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    session = await _listening(
        hass, _client(), now=datetime(2026, 7, 20, 1, 45, tzinfo=UTC)
    )
    finished = CleaningSession(
        "2026-07-20T02:00:00+00:00",
        "2026-07-20T02:30:00+00:00",
        1800,
        ("Study", "Store", "Unknown"),
        (("Study", 30),),
        False,
        mode_results=(
            CleaningModeResult("Study", "mop", "partial", 30),
            CleaningModeResult("Store", "mop", "unattempted", 0),
            CleaningModeResult("Unknown", "mop", None, None),
        ),
    )
    await _read(hass, session, RobotTelemetry(latest_session=finished))
    assert len(events) == 1
    assert events[0].data["rooms"] == ["Study"]
    assert events[0].data["completed_rooms"] == []
    assert events[0].data["completed"] is False
