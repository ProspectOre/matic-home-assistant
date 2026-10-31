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
        {
            "message",
            "all_day",
            "start_time",
            "end_time",
            "location",
            "matic_entry_id",
            "matic_next_run",
        }
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

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Give Matic Map the entry and the next run that hasn't started.

        The calendar's own event stays on a run for its nominal hour, and its
        start_time is a naive local string that a browser in another time zone
        would misread, so neither suits a "next clean" line.
        """
        now = dt_util.now()
        upcoming = next(
            (
                event
                for event in schedule_occurrences(
                    self.coordinator.data, now, now + _UPCOMING_WINDOW
                )
                if event.start_datetime_local.timestamp() > now.timestamp()
            ),
            None,
        )
        return {
            "matic_entry_id": self._config_entry.entry_id,
            "matic_next_run": (
                {
                    "name": upcoming.summary,
                    "start": upcoming.start_datetime_local.isoformat(),
                    "description": upcoming.description,
                }
                if upcoming
                else None
            ),
        }

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        """Return scheduled runs in the requested window."""
        return schedule_occurrences(self.coordinator.data, start_date, end_date)
