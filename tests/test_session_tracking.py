"""Tests for HA-side cleaning session tracking and recovery."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from custom_components.matic_robot import session_tracking as session_tracking_module
from custom_components.matic_robot.client.models import CleaningSession
from custom_components.matic_robot.session_tracking import (
    CleaningSessionTracker,
    _build_session,
    _canonical_room,
    _parse_timestamp,
    _room_timeline,
    _sessions_overlap,
)


def _state(state: str, when: datetime) -> SimpleNamespace:
    return SimpleNamespace(state=state, last_updated=when)


def test_recovers_latest_completed_run_and_normalizes_room_names() -> None:
    start = datetime(2026, 7, 21, 1, tzinfo=UTC)
    tracker = CleaningSessionTracker()

    tracker.recover(
        [
            _state("off", start - timedelta(minutes=1)),
            _state("on", start),
            _state("unavailable", start + timedelta(minutes=2)),
            _state("on", start + timedelta(minutes=3)),
            _state("off", start + timedelta(minutes=10)),
        ],
        [
            _state("Office", start - timedelta(minutes=1)),
            _state("unavailable", start + timedelta(minutes=1)),
            _state("the Living   Room", start + timedelta(minutes=4)),
            _state("the Living Room", start + timedelta(minutes=5)),
            _state("the Kitchen", start + timedelta(minutes=8)),
            _state("Office", start + timedelta(minutes=11)),
        ],
        ("Office", "Living Room", "Kitchen"),
        now=start + timedelta(minutes=12),
    )

    assert tracker.latest_session == CleaningSession(
        started_at=start.isoformat(),
        ended_at=(start + timedelta(minutes=10)).isoformat(),
        duration_seconds=600,
        rooms=(),
        room_durations=(),
        completed=False,
    )


def test_live_tracking_handles_room_changes_and_idle_updates() -> None:
    start = datetime(2026, 7, 21, 2, tzinfo=UTC)
    tracker = CleaningSessionTracker()

    assert (
        tracker.update(
            cleaning=False,
            current_area="Office",
            room_names=("Office", "Living Room"),
            now=start,
        )
        is None
    )
    tracker.update(
        cleaning=True,
        current_area="Office",
        room_names=("Office", "Living Room"),
        now=start,
    )
    tracker.update(
        cleaning=True,
        current_area="the Living Room",
        room_names=("Office", "Living Room"),
        now=start + timedelta(minutes=2),
    )
    tracker.update(
        cleaning=True,
        current_area="the Living Room",
        room_names=("Office", "Living Room"),
        now=start + timedelta(minutes=3),
    )
    tracker.confirm_room_completed("Office")
    tracker.confirm_room_completed("the living room")
    result = tracker.update(
        cleaning=False,
        current_area="the Living Room",
        room_names=("Office", "Living Room"),
        now=start + timedelta(minutes=5),
    )

    assert result is not None
    assert result.duration_seconds == 300
    assert dict(result.room_durations) == {"Office": 120, "Living Room": 180}
    assert result.completed is True
    assert result.completed_rooms == ("Office", "Living Room")
    assert (
        tracker.update(
            cleaning=False,
            current_area=None,
            room_names=("Office",),
            now=start + timedelta(minutes=6),
        )
        is result
    )


def test_transit_rooms_and_interrupted_room_are_not_completed() -> None:
    start = datetime(2026, 7, 21, 2, tzinfo=UTC)
    tracker = CleaningSessionTracker()
    tracker.update(
        cleaning=True,
        current_area="Hallway",
        room_names=("Hallway", "Kitchen"),
        now=start,
    )
    tracker.update(
        cleaning=True,
        current_area="Kitchen",
        room_names=("Hallway", "Kitchen"),
        now=start + timedelta(seconds=30),
    )
    tracker.discard_current_room(now=start + timedelta(minutes=2))
    result = tracker.update(
        cleaning=False,
        current_area="Kitchen",
        room_names=("Hallway", "Kitchen"),
        now=start + timedelta(minutes=3),
    )

    assert result is not None
    assert result.duration_seconds == 120
    assert result.rooms == ()
    assert result.room_durations == ()
    tracker.discard_current_room()


def test_recovers_active_run_across_restart_without_double_counting() -> None:
    start = datetime(2026, 7, 21, 3, tzinfo=UTC)
    tracker = CleaningSessionTracker()
    tracker.recover(
        [_state("on", start)],
        [
            _state("Office", start - timedelta(seconds=1)),
            _state("the Kitchen", start + timedelta(minutes=2)),
        ],
        ("Office", "Kitchen"),
        now=start + timedelta(minutes=4),
    )

    result = tracker.update(
        cleaning=False,
        current_area="the Kitchen",
        room_names=("Office", "Kitchen"),
        now=start + timedelta(minutes=5),
    )

    assert result is not None
    assert result.duration_seconds == 300
    assert result.rooms == ()
    assert result.room_durations == ()
    assert result.completed is False


def test_session_preference_uses_newest_and_richer_source() -> None:
    tracked = CleaningSession(
        "2026-07-21T04:00:00+00:00",
        "2026-07-21T04:10:00+00:00",
        600,
        (),
        (),
        True,
    )
    older = CleaningSession("not-a-time", "2026-07-20T04:10:00+00:00", 10, (), (), True)
    richer_same_time = CleaningSession(
        tracked.started_at,
        tracked.ended_at,
        600,
        ("Office",),
        (("Office", 600),),
        True,
    )
    newer = CleaningSession(
        "2026-07-21T05:00:00+00:00",
        "2026-07-21T05:01:00+00:00",
        60,
        (),
        (),
        True,
    )
    tracker = CleaningSessionTracker(latest_session=tracked)

    assert tracker.preferred_session(None) is tracked
    assert tracker.preferred_session(older) is tracked
    assert tracker.preferred_session(richer_same_time) is tracked
    preferred_newer = tracker.preferred_session(newer)
    assert preferred_newer is not None
    assert preferred_newer.started_at == newer.started_at
    assert preferred_newer.completed is True
    only_native = CleaningSessionTracker().preferred_session(newer)
    assert only_native is not None
    assert only_native.completed is True

    unproven = CleaningSession(
        "2026-07-21T06:00:00+00:00",
        "2026-07-21T06:02:00+00:00",
        120,
        ("Office",),
        (("Office", 120),),
        False,
    )
    sanitized = CleaningSessionTracker().preferred_session(unproven)
    assert sanitized is not None
    assert sanitized.duration_seconds == 120
    assert sanitized.rooms == ("Office",)
    assert sanitized.room_durations == (("Office", 120),)
    assert sanitized.completed is False

    interrupted_same_run = replace(
        unproven,
        started_at=tracked.started_at,
        ended_at=tracked.ended_at,
    )
    assert tracker.preferred_session(interrupted_same_run) is interrupted_same_run

    # Interval overlap ties this native summary to the same run without
    # treating its end timestamp as successful room-completion evidence.
    overlapping_native = CleaningSession(
        "2026-07-21T03:59:30+00:00",
        "2026-07-21T04:09:30+00:00",
        999,
        ("Office",),
        (("Office", 600),),
        True,
        completed_rooms=("Office",),
    )
    assert tracker.preferred_session(overlapping_native) is tracked

    interrupted = CleaningSession(
        tracked.started_at,
        tracked.ended_at,
        480,
        (),
        (),
        False,
    )
    merged = CleaningSessionTracker(interrupted).preferred_session(overlapping_native)
    assert merged == CleaningSession(
        overlapping_native.started_at,
        overlapping_native.ended_at,
        interrupted.duration_seconds,
        overlapping_native.rooms,
        overlapping_native.room_durations,
        True,
        completed_rooms=("Office",),
    )
    assert (
        _sessions_overlap(
            overlapping_native,
            CleaningSession(
                tracked.started_at,
                None,
                None,
                (),
                (),
                False,
            ),
        )
        is False
    )


def test_pause_and_recharge_time_are_excluded_before_managed_confirmation() -> None:
    start = datetime(2026, 7, 21, 5, tzinfo=UTC)
    tracker = CleaningSessionTracker()

    tracker.update(
        cleaning=True,
        current_area="Office",
        room_names=("Office",),
        now=start,
    )
    tracker.update(
        cleaning=True,
        paused=True,
        current_area="Office",
        room_names=("Office",),
        now=start + timedelta(minutes=2),
    )
    tracker.update(
        cleaning=True,
        current_area="Office",
        room_names=("Office",),
        now=start + timedelta(minutes=7),
    )
    tracker.update(
        cleaning=False,
        returning=True,
        low_charge=True,
        current_area="Office",
        room_names=("Office",),
        now=start + timedelta(minutes=9),
    )
    tracker.update(
        cleaning=False,
        charging=True,
        current_area="Office",
        room_names=("Office",),
        now=start + timedelta(minutes=39),
    )
    tracker.update(
        cleaning=True,
        current_area="Office",
        room_names=("Office",),
        now=start + timedelta(minutes=40),
    )
    tracker.update(
        cleaning=False,
        returning=True,
        current_area="Office",
        room_names=("Office",),
        now=start + timedelta(minutes=41),
    )
    tracker.confirm_room_completed("Office")
    result = tracker.update(
        cleaning=False,
        charging=True,
        current_area="Office",
        room_names=("Office",),
        now=start + timedelta(minutes=42),
    )

    assert result is not None
    assert result.duration_seconds == 300
    assert result.room_durations == (("Office", 300),)
    assert result.completed is True
    assert result.completed_rooms == ("Office",)


def test_external_stop_keeps_run_duration_but_omits_unproven_room_credit() -> None:
    start = datetime(2026, 7, 21, 6, tzinfo=UTC)
    tracker = CleaningSessionTracker()
    tracker.update(
        cleaning=True,
        current_area="Office",
        room_names=("Office",),
        now=start,
    )

    result = tracker.update(
        cleaning=False,
        current_area="Office",
        room_names=("Office",),
        now=start + timedelta(minutes=3),
    )

    assert result is not None
    assert result.duration_seconds == 180
    assert result.rooms == ()
    assert result.room_durations == ()
    assert result.completed is False


def test_external_takeover_does_not_erase_a_previously_confirmed_room() -> None:
    start = datetime(2026, 7, 21, 7, tzinfo=UTC)
    tracker = CleaningSessionTracker()
    tracker.update(
        cleaning=True,
        current_area="Office",
        room_names=("Office", "Kitchen"),
        now=start,
    )
    tracker.update(
        cleaning=False,
        paused=True,
        current_area="Office",
        room_names=("Office", "Kitchen"),
        now=start + timedelta(minutes=2),
    )
    tracker.confirm_room_completed("Office")
    tracker.update(
        cleaning=True,
        current_area="Kitchen",
        room_names=("Office", "Kitchen"),
        now=start + timedelta(minutes=5),
    )

    result = tracker.update(
        cleaning=False,
        current_area="Kitchen",
        room_names=("Office", "Kitchen"),
        now=start + timedelta(minutes=7),
    )

    assert result is not None
    assert result.duration_seconds == 240
    assert result.rooms == ("Office",)
    assert result.room_durations == (("Office", 120),)
    assert result.completed_rooms == ("Office",)


def test_helpers_reject_non_rooms_and_handle_timestamp_edges() -> None:
    assert _canonical_room(None, ("Office",)) is None
    assert _canonical_room("unknown", ("Office",)) is None
    assert _canonical_room("Garage", ("Office",)) is None
    assert _parse_timestamp(None) == datetime.min.replace(tzinfo=UTC)
    assert _parse_timestamp("bad") == datetime.min.replace(tzinfo=UTC)
    assert _parse_timestamp("2026-01-01T00:00:00") == datetime(2026, 1, 1, tzinfo=UTC)
    assert _parse_timestamp("2025-12-31T16:00:00-08:00") == datetime(
        2026, 1, 1, tzinfo=UTC
    )

    reversed_session = _build_session(
        datetime(2026, 1, 2, tzinfo=UTC),
        datetime(2026, 1, 1, tzinfo=UTC),
        {"Office": -1},
        ["Office", "Missing"],
    )
    assert reversed_session.duration_seconds == 0
    assert reversed_session.room_durations == ()
    invalid_interval = CleaningSession("bad", "also-bad", 1, (), (), True)
    assert _sessions_overlap(invalid_interval, invalid_interval) is False


def test_room_timeline_normalizes_names_once_per_room_and_event(
    monkeypatch,
) -> None:
    start = datetime(2026, 7, 21, 8, tzinfo=UTC)
    room_names = tuple(f"Room {index}" for index in range(100))
    area_states = [
        _state(f"the Room {index}", start + timedelta(seconds=index + 1))
        for index in range(100)
    ]
    calls = 0
    original = session_tracking_module._room_key

    def counted_room_key(value: str) -> str:
        nonlocal calls
        calls += 1
        return original(value)

    monkeypatch.setattr(session_tracking_module, "_room_key", counted_room_key)

    durations, rooms, current_room, _cursor = _room_timeline(
        start,
        start + timedelta(seconds=101),
        area_states,
        room_names,
    )

    assert len(durations) == len(room_names)
    assert rooms == list(room_names)
    assert current_room == "Room 99"
    assert calls <= len(room_names) + len(area_states)
