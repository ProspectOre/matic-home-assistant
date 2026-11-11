"""Put the client's activity observations on the event bus."""

from __future__ import annotations

import asyncio
from time import monotonic
from typing import Any

from homeassistant.core import HomeAssistant, callback

from .const import EVENT_ACTIVITY_OBSERVED

ACTIVITY_STATE_EVENT_MIN_INTERVAL_SECONDS = 1.0


class ActivityEvents:
    """Fire one event per observation, and at most one state event a second.

    A state observation that arrives sooner waits for the interval to end;
    a newer one replaces it. ``async_close`` fires a waiting one at once.
    """

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._hass = hass
        self._entry_id = entry_id
        self._next_state_event_at = 0.0
        self._pending: dict[str, Any] | None = None
        self._timer: asyncio.TimerHandle | None = None

    @callback
    def async_observe(self, observation: dict[str, Any]) -> None:
        """Fire ``observation``, or hold a state one until the interval ends."""
        if observation.get("kind") == "state":
            now = monotonic()
            if now < self._next_state_event_at:
                self._pending = dict(observation)
                if self._timer is None:
                    self._schedule(self._next_state_event_at - now)
                return
            self._next_state_event_at = now + ACTIVITY_STATE_EVENT_MIN_INTERVAL_SECONDS
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            self._pending = None
        self._fire(observation)

    @callback
    def async_close(self) -> None:
        """Stop the timer and fire a held observation."""
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        observation, self._pending = self._pending, None
        if observation is not None:
            self._fire(observation)

    def _schedule(self, delay: float) -> None:
        self._timer = self._hass.loop.call_later(delay, self._flush)

    def _flush(self) -> None:
        self._timer = None
        observation, self._pending = self._pending, None
        if observation is None:
            return
        now = monotonic()
        if now < self._next_state_event_at:
            self._schedule(self._next_state_event_at - now)
            self._pending = observation
            return
        self._next_state_event_at = now + ACTIVITY_STATE_EVENT_MIN_INTERVAL_SECONDS
        self._fire(observation)

    def _fire(self, observation: dict[str, Any]) -> None:
        self._hass.bus.async_fire(
            EVENT_ACTIVITY_OBSERVED, {"entry_id": self._entry_id, **observation}
        )
