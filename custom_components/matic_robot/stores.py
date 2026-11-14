"""The values a robot session keeps, each with its own change listeners."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from homeassistant.core import CALLBACK_TYPE, callback

from .client import CleaningSession, RobotOperationalState


class Store[T]:
    """The latest value of one kind of robot data, with change listeners."""

    def __init__(self, value: T) -> None:
        self.value = value
        self._listeners: list[Callable[[], None]] = []

    @callback
    def set(self, value: T) -> None:
        """Replace the value and tell the listeners, unless it is unchanged."""
        if value == self.value:
            return
        self.value = value
        for listener in tuple(self._listeners):
            listener()

    @callback
    def subscribe(self, listener: Callable[[], None]) -> CALLBACK_TYPE:
        """Call ``listener`` after each change; return its removal."""
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener)


@dataclass(frozen=True, slots=True)
class LiveState:
    """The robot's newest state snapshot as entities show it.

    ``session_active`` is the snapshot's task evidence, taken before
    unconfirmed error codes are hidden from ``operational``.
    """

    operational: RobotOperationalState
    session_active: bool | None


@dataclass(frozen=True, slots=True)
class CleaningHistory:
    """The newest cleaning session, as the robot records it and as shown.

    ``native_session`` is the robot's own newest record; events are built
    from it alone. ``latest_session`` is the newer of that record and the run
    Home Assistant watched, for display. ``revision`` names the snapshot of
    the robot's history collection both were read from.
    """

    native_session: CleaningSession | None = None
    latest_session: CleaningSession | None = None
    revision: str | None = None
