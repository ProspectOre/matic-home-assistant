"""Tests for HA-side cleaning session tracking and recovery."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from custom_components.matic_robot.client.models import CleaningSession
from custom_components.matic_robot.session_tracking import (
    CleaningSessionTracker,
    _build_session,
    _canonical_room,
    _parse_timestamp,
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
        rooms=("Office", "Living Room", "Kitchen"),
        room_durations=(("Office", 240), ("Living Room", 240), ("Kitchen", 120)),
        completed=True,
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
    result = tracker.update(
        cleaning=False,
        current_area="the Living Room",
        room_names=("Office", "Living Room"),
        now=start + timedelta(minutes=5),
    )

    assert result is not None
    assert result.duration_seconds == 300
    assert dict(result.room_durations) == {"Office": 120, "Living Room": 180}
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
    tracker.discard_current_room()
    result = tracker.update(
        cleaning=False,
        current_area="Kitchen",
        room_names=("Hallway", "Kitchen"),
        now=start + timedelta(minutes=3),
    )

    assert result is not None
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
    assert dict(result.room_durations) == {"Office": 120, "Kitchen": 180}


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
    assert tracker.preferred_session(richer_same_time) is richer_same_time
    assert tracker.preferred_session(newer) is newer
    assert CleaningSessionTracker().preferred_session(newer) is newer


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
