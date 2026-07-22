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
    _room_started_at: datetime | None = None
    _room_durations: dict[str, float] = field(default_factory=dict)
    _rooms: list[str] = field(default_factory=list)

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
            self.latest_session = _build_session(started_at, ended_at, durations, rooms)

    def update(
        self,
        *,
        cleaning: bool,
        current_area: str | None,
        room_names: tuple[str, ...],
        now: datetime,
    ) -> CleaningSession | None:
        """Observe one coordinator update and return the newest finished run."""
        room = _canonical_room(current_area, room_names)
        if cleaning:
            if self._started_at is None:
                self._started_at = now
                self._current_room = room
                self._room_started_at = now
                if room is not None:
                    self._rooms.append(room)
            elif room != self._current_room:
                self._finish_room(now)
                self._current_room = room
                self._room_started_at = now
                if room is not None and room not in self._rooms:
                    self._rooms.append(room)
            return self.latest_session

        if self._started_at is None:
            return self.latest_session

        self._finish_room(now)
        self.latest_session = _build_session(
            self._started_at, now, self._room_durations, self._rooms
        )
        self._reset_active()
        return self.latest_session

    def preferred_session(
        self, native_session: CleaningSession | None
    ) -> CleaningSession | None:
        """Prefer whichever robot-native or locally tracked session is newer."""
        tracked = self.latest_session
        if tracked is None:
            return native_session
        if native_session is None:
            return tracked
        native_started = _parse_timestamp(native_session.started_at)
        tracked_started = _parse_timestamp(tracked.started_at)
        if native_started > tracked_started:
            return native_session
        if (
            native_started == tracked_started
            and native_session.room_durations
            and not tracked.room_durations
        ):
            return native_session
        return tracked

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
        self._room_started_at = room_started_at
        self._room_durations = durations
        self._rooms = rooms

    def _finish_room(self, ended_at: datetime) -> None:
        """Accumulate the currently observed room segment."""
        if self._current_room is not None and self._room_started_at is not None:
            elapsed = max(0.0, (ended_at - self._room_started_at).total_seconds())
            self._room_durations[self._current_room] = (
                self._room_durations.get(self._current_room, 0.0) + elapsed
            )

    def _reset_active(self) -> None:
        """Clear the live accumulator after publishing a completed session."""
        self._started_at = None
        self._current_room = None
        self._room_started_at = None
        self._room_durations = {}
        self._rooms = []


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
    events = sorted(area_states, key=lambda item: item.last_updated)
    for state in events:
        if state.last_updated <= started_at:
            candidate = _canonical_room(state.state, room_names)
            if candidate is not None:
                current_room = candidate
            continue
        if state.last_updated > ended_at:
            break
        candidate = _canonical_room(state.state, room_names)
        if candidate is None or candidate == current_room:
            continue
        if current_room is not None:
            durations[current_room] = durations.get(current_room, 0.0) + max(
                0.0, (state.last_updated - cursor).total_seconds()
            )
            if current_room not in rooms:
                rooms.append(current_room)
        current_room = candidate
        cursor = state.last_updated

    if current_room is not None:
        durations[current_room] = durations.get(current_room, 0.0) + max(
            0.0, (ended_at - cursor).total_seconds()
        )
        if current_room not in rooms:
            rooms.append(current_room)
    return durations, rooms, current_room, cursor


def _canonical_room(value: str | None, room_names: tuple[str, ...]) -> str | None:
    """Map firmware phrases such as ``the Living Room`` to plan room names."""
    if value is None or value in {"unknown", "unavailable"}:
        return None
    normalized = _room_key(value)
    for name in room_names:
        if _room_key(name) == normalized:
            return name
    return None


def _room_key(value: str) -> str:
    """Return a comparison key for one firmware-provided area name."""
    normalized = " ".join(value.strip().casefold().split())
    return normalized.removeprefix("the ")


def _build_session(
    started_at: datetime,
    ended_at: datetime,
    durations: dict[str, float],
    rooms: list[str],
) -> CleaningSession:
    """Create one immutable public session from local tracking values."""
    return CleaningSession(
        started_at=started_at.isoformat(),
        ended_at=ended_at.isoformat(),
        duration_seconds=max(0, round((ended_at - started_at).total_seconds())),
        rooms=tuple(rooms),
        room_durations=tuple(
            (room, max(0, round(durations[room])))
            for room in rooms
            if room in durations
        ),
        completed=True,
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
