"""Home Assistant-side cleaning session tracking.

The robot's local ``coverage_session_history`` collection is not updated on
all firmware builds.  Track the verified cleaning/current-area state locally
so room statistics remain useful without relying on that stale collection.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from .client.models import CleaningSession

MIN_CLEANED_ROOM_SECONDS = 60


class _HistoryState(Protocol):
    """The small part of a recorder State used for recovery."""

    state: str
    last_updated: datetime


@dataclass(slots=True)
class CleaningSessionTracker:
    """Build completed sessions from live or recorded HA entity states."""

    latest_session: CleaningSession | None = None
    _started_at: datetime | None = None
    _current_room: str | None = None
    _active_started_at: datetime | None = None
    _active_seconds: float = 0.0
    _room_durations: dict[str, float] = field(default_factory=dict)
    _rooms: list[str] = field(default_factory=list)
    _confirmed_rooms: set[str] = field(default_factory=set)
    _recharge_suspended: bool = False

    def recover(
        self,
        cleaning_states: list[_HistoryState],
        area_states: list[_HistoryState],
        room_names: tuple[str, ...],
        *,
        now: datetime,
    ) -> None:
        """Recover the latest completed or active run from Recorder history."""
        active_start: datetime | None = None
        last_completed: tuple[datetime, datetime] | None = None
        for state in sorted(cleaning_states, key=lambda item: item.last_updated):
            if state.state == "on" and active_start is None:
                active_start = state.last_updated
            elif state.state == "off" and active_start is not None:
                last_completed = (active_start, state.last_updated)
                active_start = None

        if active_start is not None:
            self._restore_active(active_start, now, area_states, room_names)
        elif last_completed is not None:
            started_at, ended_at = last_completed
            durations, rooms, _, _ = _room_timeline(
                started_at, ended_at, area_states, room_names
            )
            self.latest_session = _build_session(
                started_at,
                ended_at,
                durations,
                rooms,
                confirmed_rooms=set(),
                duration_seconds=sum(durations.values()),
            )

    def update(
        self,
        *,
        cleaning: bool,
        paused: bool = False,
        returning: bool = False,
        charging: bool = False,
        low_charge: bool = False,
        current_area: str | None,
        room_names: tuple[str, ...],
        now: datetime,
    ) -> CleaningSession | None:
        """Observe one coordinator update and return the newest finished run."""
        room = _canonical_room(current_area, room_names)
        if cleaning and not paused and not returning and not charging:
            if self._started_at is None:
                self._started_at = now
                self._current_room = room
                self._active_started_at = now
                if room is not None:
                    self._rooms.append(room)
            else:
                self._recharge_suspended = False
                if self._active_started_at is None:
                    self._current_room = room
                    self._active_started_at = now
                    if room is not None and room not in self._rooms:
                        self._rooms.append(room)
                elif room != self._current_room:
                    self._finish_active(now)
                    self._current_room = room
                    self._active_started_at = now
                    if room is not None and room not in self._rooms:
                        self._rooms.append(room)
            return self.latest_session

        if self._started_at is None:
            return self.latest_session

        self._finish_active(now)
        if low_charge:
            self._recharge_suspended = True
        if paused or returning or (self._recharge_suspended and charging):
            return self.latest_session
        self.latest_session = _build_session(
            self._started_at,
            now,
            self._room_durations,
            self._rooms,
            confirmed_rooms=self._confirmed_rooms,
            duration_seconds=self._active_seconds,
        )
        self._reset_active()
        return self.latest_session

    def confirm_room_completed(self, room_name: str) -> None:
        """Record positive managed evidence that one observed room completed."""
        key = _room_key(room_name)
        room = next((item for item in self._rooms if _room_key(item) == key), None)
        if room is not None:
            self._confirmed_rooms.add(room)

    def preferred_session(
        self, native_session: CleaningSession | None
    ) -> CleaningSession | None:
        """Prefer whichever robot-native or locally tracked session is newer."""
        tracked = self.latest_session
        if tracked is None:
            return native_session
        if native_session is None:
            return tracked
        if _sessions_overlap(native_session, tracked):
            if native_session.completed is False:
                return native_session
            if tracked.completed is True:
                return tracked
            return CleaningSession(
                started_at=native_session.started_at,
                ended_at=native_session.ended_at,
                duration_seconds=tracked.duration_seconds,
                rooms=native_session.rooms,
                room_durations=native_session.room_durations,
                completed=native_session.completed,
                completed_rooms=native_session.completed_rooms,
                vacuum_completed_rooms=native_session.vacuum_completed_rooms,
            )
        native_started = _parse_timestamp(native_session.started_at)
        tracked_started = _parse_timestamp(tracked.started_at)
        if native_started > tracked_started:
            return native_session
        return tracked

    def discard_current_room(self, *, now: datetime | None = None) -> None:
        """Exclude an interrupted room while preserving active run duration."""
        if now is not None:
            self._finish_active(now)
        room = self._current_room
        if room is None:
            return
        self._room_durations.pop(room, None)
        self._rooms = [item for item in self._rooms if item != room]
        self._confirmed_rooms.discard(room)
        self._current_room = None
        self._active_started_at = None

    def _restore_active(
        self,
        started_at: datetime,
        now: datetime,
        area_states: list[_HistoryState],
        room_names: tuple[str, ...],
    ) -> None:
        """Restore an in-progress session across an integration or HA restart."""
        durations, rooms, current_room, room_started_at = _room_timeline(
            started_at, now, area_states, room_names
        )
        if current_room is not None:
            durations[current_room] = max(
                0.0,
                durations.get(current_room, 0.0)
                - (now - room_started_at).total_seconds(),
            )
        self._started_at = started_at
        self._current_room = current_room
        self._active_started_at = room_started_at
        self._active_seconds = sum(durations.values())
        self._room_durations = durations
        self._rooms = rooms

    def _finish_active(self, ended_at: datetime) -> None:
        """Accumulate one actively-cleaning segment, excluding suspensions."""
        if self._active_started_at is not None:
            elapsed = max(0.0, (ended_at - self._active_started_at).total_seconds())
            self._active_seconds += elapsed
            if self._current_room is not None:
                self._room_durations[self._current_room] = (
                    self._room_durations.get(self._current_room, 0.0) + elapsed
                )
            self._active_started_at = None

    def _reset_active(self) -> None:
        """Clear the live accumulator after publishing a completed session."""
        self._started_at = None
        self._current_room = None
        self._active_started_at = None
        self._active_seconds = 0.0
        self._room_durations = {}
        self._rooms = []
        self._confirmed_rooms = set()
        self._recharge_suspended = False


def _room_timeline(
    started_at: datetime,
    ended_at: datetime,
    area_states: list[_HistoryState],
    room_names: tuple[str, ...],
) -> tuple[dict[str, float], list[str], str | None, datetime]:
    """Integrate room occupancy across one recorded cleaning interval."""
    current_room: str | None = None
    cursor = started_at
    durations: dict[str, float] = {}
    rooms: list[str] = []
    seen_rooms: set[str] = set()
    room_lookup = _room_lookup(room_names)
    events = sorted(area_states, key=lambda item: item.last_updated)
    for state in events:
        if state.last_updated <= started_at:
            candidate = _canonical_room_from_lookup(state.state, room_lookup)
            if candidate is not None:
                current_room = candidate
            continue
        if state.last_updated > ended_at:
            break
        candidate = _canonical_room_from_lookup(state.state, room_lookup)
        if candidate is None or candidate == current_room:
            continue
        if current_room is not None:
            durations[current_room] = durations.get(current_room, 0.0) + max(
                0.0, (state.last_updated - cursor).total_seconds()
            )
            if current_room not in seen_rooms:
                seen_rooms.add(current_room)
                rooms.append(current_room)
        current_room = candidate
        cursor = state.last_updated

    if current_room is not None:
        durations[current_room] = durations.get(current_room, 0.0) + max(
            0.0, (ended_at - cursor).total_seconds()
        )
        if current_room not in seen_rooms:
            rooms.append(current_room)
    return durations, rooms, current_room, cursor


def _canonical_room(value: str | None, room_names: tuple[str, ...]) -> str | None:
    """Map firmware phrases such as ``the Living Room`` to plan room names."""
    return _canonical_room_from_lookup(value, _room_lookup(room_names))


def _room_lookup(room_names: tuple[str, ...]) -> dict[str, str]:
    """Index room names once for constant-time recorder event matching."""
    lookup: dict[str, str] = {}
    for name in room_names:
        lookup.setdefault(_room_key(name), name)
    return lookup


def _canonical_room_from_lookup(
    value: str | None, room_lookup: dict[str, str]
) -> str | None:
    """Map a firmware room phrase through a precomputed normalized index."""
    if value is None or value in {"unknown", "unavailable"}:
        return None
    return room_lookup.get(_room_key(value))


def _room_key(value: str) -> str:
    """Return a comparison key for one firmware-provided area name."""
    normalized = " ".join(value.strip().casefold().split())
    return normalized.removeprefix("the ")


def _build_session(
    started_at: datetime,
    ended_at: datetime,
    durations: dict[str, float],
    rooms: list[str],
    *,
    confirmed_rooms: set[str] | None = None,
    duration_seconds: float | None = None,
) -> CleaningSession:
    """Create one immutable public session from local tracking values."""
    confirmed = set(rooms) if confirmed_rooms is None else confirmed_rooms
    cleaned_rooms = [
        room
        for room in rooms
        if room in confirmed and durations.get(room, 0.0) >= MIN_CLEANED_ROOM_SECONDS
    ]
    return CleaningSession(
        started_at=started_at.isoformat(),
        ended_at=ended_at.isoformat(),
        duration_seconds=max(
            0,
            round(
                (ended_at - started_at).total_seconds()
                if duration_seconds is None
                else duration_seconds
            ),
        ),
        rooms=tuple(cleaned_rooms),
        room_durations=tuple(
            (room, max(0, round(durations[room]))) for room in cleaned_rooms
        ),
        completed=bool(cleaned_rooms),
        completed_rooms=tuple(cleaned_rooms),
    )


def _parse_timestamp(value: str | None) -> datetime:
    """Parse an optional session timestamp for deterministic comparison."""
    if value is None:
        return datetime.min.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _sessions_overlap(left: CleaningSession, right: CleaningSession) -> bool:
    """Return whether two bounded session intervals describe the same run."""
    if left.ended_at is None or right.ended_at is None:
        return False
    left_start = _parse_timestamp(left.started_at)
    left_end = _parse_timestamp(left.ended_at)
    right_start = _parse_timestamp(right.started_at)
    right_end = _parse_timestamp(right.ended_at)
    unknown = datetime.min.replace(tzinfo=UTC)
    if unknown in {left_start, left_end, right_start, right_end}:
        return False
    return max(left_start, right_start) < min(left_end, right_end)
