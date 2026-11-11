"""One sensor per room for the opt-in Wi-Fi survey."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import SIGNAL_STRENGTH_DECIBELS_MILLIWATT, EntityCategory
from homeassistant.util import slugify

from . import MaticConfigEntry
from .client.models import Room
from .entity import MaticEntity
from .wifi_survey import RoomSignal

ROOM_WIFI_SIGNAL_DESCRIPTION = SensorEntityDescription(
    key="room_wifi_signal",
    translation_key="room_wifi_signal",
    device_class=SensorDeviceClass.SIGNAL_STRENGTH,
    native_unit_of_measurement=SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
    state_class=SensorStateClass.MEASUREMENT,
    entity_category=EntityCategory.DIAGNOSTIC,
    entity_registry_enabled_default=False,
)


class MaticRoomWifiSignalSensor(MaticEntity, SensorEntity):
    """The mean surveyed signal of one room; unknown until a reading lies in it."""

    entity_description = ROOM_WIFI_SIGNAL_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry, room: Room) -> None:
        super().__init__(entry)
        self._room_id = room.id
        self._room_name = room.name
        self._attr_unique_id = f"{self._matic_serial}_room_{room.id}_wifi_signal"
        self._attr_translation_placeholders = {"room": room.name}

    @property
    def suggested_object_id(self) -> str | None:
        """Name the entity after the room, not its opaque identifier."""
        return slugify(f"{self._room_name}_wifi_signal")

    @property
    def available(self) -> bool:
        """Follow the robot, and retire a room the current map no longer has."""
        floor_plan = self.coordinator.data.floor_plan
        return (
            super().available
            and floor_plan is not None
            and any(room.id == self._room_id for room in floor_plan.rooms)
        )

    def _signal(self) -> RoomSignal | None:
        floor_plan = self.coordinator.data.floor_plan
        if floor_plan is None:
            return None
        survey = self._config_entry.runtime_data.wifi_survey
        return survey.room_signals(floor_plan).get(self._room_id)

    @property
    def native_value(self) -> float | None:
        """Return the room's mean signal in dBm."""
        signal = self._signal()
        return signal.dbm if signal is not None else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return the room's weakest cell and how many readings it rests on."""
        signal = self._signal()
        if signal is None:
            return None
        return {"weakest_dbm": signal.weakest, "samples": signal.samples}
