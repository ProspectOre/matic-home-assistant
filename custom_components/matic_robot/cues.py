"""Cues voice, gesture and follow-me events taken from robot state."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr

from .client import CuesVoiceStatus, RobotOperationalState
from .const import CUES_EVENT_TYPES, DOMAIN, EVENT_CUES
from .stores import LiveState, Store

if TYPE_CHECKING:
    from . import MaticConfigEntry


@dataclass(frozen=True, slots=True)
class MaticCuesEvent:
    """One privacy-safe Cues lifecycle event."""

    event_type: str
    attributes: dict[str, str]


type _OnCuesEvent = Callable[[MaticCuesEvent], None]


def cues_events(
    previous: RobotOperationalState, current: RobotOperationalState
) -> tuple[MaticCuesEvent, ...]:
    """Return safe automation events represented by one Cues transition."""
    events: list[MaticCuesEvent] = []
    if previous.cues_voice_status != current.cues_voice_status:
        voice_event = None
        if current.cues_voice_status is not None:
            voice_event = {
                CuesVoiceStatus.DISABLED: "disabled",
                CuesVoiceStatus.LISTENING_FOR_WAKE_WORD: "ready",
                CuesVoiceStatus.LISTENING_FOR_INTENT: "wake_word_detected",
                CuesVoiceStatus.THINKING_FOR_INTENT: "intent_processing",
                CuesVoiceStatus.CLASSIFIED: "intent_classified",
                CuesVoiceStatus.REJECTED: "intent_rejected",
            }.get(current.cues_voice_status)
        if voice_event is not None:
            attributes = {}
            if (
                current.cues_voice_status is CuesVoiceStatus.CLASSIFIED
                and current.cues_voice_intent is not None
            ):
                attributes["intent"] = current.cues_voice_intent.value
            events.append(MaticCuesEvent(voice_event, attributes))
    elif (
        current.cues_voice_status is CuesVoiceStatus.CLASSIFIED
        and previous.cues_voice_intent != current.cues_voice_intent
    ):
        attributes = (
            {"intent": current.cues_voice_intent.value}
            if current.cues_voice_intent is not None
            else {}
        )
        events.append(MaticCuesEvent("intent_classified", attributes))

    if previous.cues_gesture_status != current.cues_gesture_status:
        if current.cues_gesture_status is not None:
            events.append(
                MaticCuesEvent(
                    f"gesture_{current.cues_gesture_status.value}",
                    {},
                )
            )
    if previous.following_person != current.following_person:
        if current.following_person is True:
            events.append(MaticCuesEvent("following_started", {}))
        elif previous.following_person is True and current.following_person is False:
            events.append(
                MaticCuesEvent(
                    "following_stopped",
                    {},
                )
            )
    return tuple(events)


class CuesTransitions:
    """Call ``on_event`` for each Cues event in the state store's changes."""

    def __init__(self, state: Store[LiveState], on_event: _OnCuesEvent) -> None:
        self._state = state
        self._on_event = on_event
        self._previous = state.value.operational

    @callback
    def subscribe(self) -> CALLBACK_TYPE:
        """Start following the store; return the removal."""
        self._previous = self._state.value.operational
        return self._state.subscribe(self._async_changed)

    @callback
    def _async_changed(self) -> None:
        previous, self._previous = self._previous, self._state.value.operational
        for event in cues_events(previous, self._previous):
            self._on_event(event)


@callback
def async_fire_cues_events(
    hass: HomeAssistant, entry: MaticConfigEntry, state: Store[LiveState], serial: str
) -> CALLBACK_TYPE:
    """Put each Cues transition on the event bus; return the removal."""

    @callback
    def _async_fire(event: MaticCuesEvent) -> None:
        assert event.event_type in CUES_EVENT_TYPES
        device = dr.async_get(hass).async_get_device_by_identifier(
            (DOMAIN, serial), entry.entry_id
        )
        hass.bus.async_fire(
            EVENT_CUES,
            {
                "entry_id": entry.entry_id,
                "device_id": device.id if device is not None else None,
                "event_type": event.event_type,
                **event.attributes,
            },
        )

    return CuesTransitions(state, _async_fire).subscribe()
