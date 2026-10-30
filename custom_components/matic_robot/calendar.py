"""Read-only calendar of the robot's native weekly schedules."""

from __future__ import annotations

from datetime import datetime, timedelta

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from . import MaticConfigEntry
from .entity import MaticEntity
from .native_schedules import schedule_occurrences

PARALLEL_UPDATES = 0

_UPCOMING_WINDOW = timedelta(days=8)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the native schedule calendar."""
    async_add_entities([MaticScheduleCalendar(entry)])


class MaticScheduleCalendar(MaticEntity, CalendarEntity):
    """Show schedules set in the Matic app; editing stays in the app."""

    _attr_translation_key = "native_schedules"
    # Schedule definitions are live context, as on the scheduled cleanings
    # sensor, and stay out of Recorder.
    _unrecorded_attributes = frozenset(
        {"message", "all_day", "start_time", "end_time", "location"}
    )

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = (
            f"{self.coordinator.data.info.serial_number}_native_schedules"
        )

    @property
    def event(self) -> CalendarEvent | None:
        """Return the run in progress or the next one within a week."""
        now = dt_util.now()
        events = schedule_occurrences(
            self.coordinator.data, now, now + _UPCOMING_WINDOW
        )
        return events[0] if events else None

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        """Return scheduled runs in the requested window."""
        return schedule_occurrences(self.coordinator.data, start_date, end_date)
