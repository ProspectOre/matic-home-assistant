"""Client activity observations reach the bus, state ones at most once a second."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from custom_components.matic_robot.activity_events import (
    ACTIVITY_STATE_EVENT_MIN_INTERVAL_SECONDS,
    ActivityEvents,
)


def _observed(**observation: object) -> call:
    return call("matic_robot_activity_observed", {"entry_id": "entry", **observation})


def test_state_observations_are_throttled_and_flushed_on_close() -> None:
    flushes: list[SimpleNamespace] = []

    def call_later(delay, callback):
        handle = SimpleNamespace(cancel=MagicMock(), callback=callback, delay=delay)
        flushes.append(handle)
        return handle

    hass = SimpleNamespace(
        loop=SimpleNamespace(call_later=call_later),
        bus=SimpleNamespace(async_fire=MagicMock()),
    )
    events = ActivityEvents(hass, "entry")

    events.async_observe({"kind": "started"})
    with patch(
        "custom_components.matic_robot.activity_events.monotonic",
        side_effect=[100.0, 100.5, 100.75, 101.5, 102.0, 103.0, 103.1],
    ):
        events.async_observe({"kind": "state", "state_codes": [106]})
        # 107 waits, and is replaced by 108 once the interval has passed.
        events.async_observe({"kind": "state", "state_codes": [107]})
        flushes[0].callback()
        events.async_observe({"kind": "state", "state_codes": [108]})
        flushes[1].callback()
        events.async_observe({"kind": "state", "state_codes": [109]})
        flushes[2].callback()
        events.async_observe({"kind": "state", "state_codes": [110]})
        events.async_close()

    assert ACTIVITY_STATE_EVENT_MIN_INTERVAL_SECONDS == 1.0
    assert hass.bus.async_fire.call_args_list == [
        _observed(kind="started"),
        _observed(kind="state", state_codes=[106]),
        _observed(kind="state", state_codes=[108]),
        _observed(kind="state", state_codes=[109]),
        _observed(kind="state", state_codes=[110]),
    ]
    assert len(flushes) == 4
    flushes[1].cancel.assert_called_once_with()
    flushes[3].cancel.assert_called_once_with()
