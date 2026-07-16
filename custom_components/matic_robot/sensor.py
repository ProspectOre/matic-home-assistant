"""Diagnostic sensors for Matic Hermes."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
)
from homeassistant.const import PERCENTAGE, EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.models import RobotState
from .entity import MaticEntity

PARALLEL_UPDATES = 0

HARDWARE_DESCRIPTION = SensorEntityDescription(
    key="hardware_revision",
    translation_key="hardware_revision",
    entity_category=EntityCategory.DIAGNOSTIC,
)

BATTERY_DESCRIPTION = SensorEntityDescription(
    key="battery",
    translation_key="battery",
    device_class=SensorDeviceClass.BATTERY,
    native_unit_of_measurement=PERCENTAGE,
)

ACTIVITY_DESCRIPTION = SensorEntityDescription(
    key="activity",
    translation_key="activity",
)

ROOMS_DESCRIPTION = SensorEntityDescription(
    key="rooms",
    translation_key="rooms",
)

HISTORY_DESCRIPTION = SensorEntityDescription(
    key="cleaning_history",
    translation_key="cleaning_history",
)

ACTIVE_PLAN_DESCRIPTION = SensorEntityDescription(
    key="active_cleaning_plan",
    translation_key="active_cleaning_plan",
)

NEXT_ROOM_DESCRIPTION = SensorEntityDescription(
    key="next_cleaning_room",
    translation_key="next_cleaning_room",
)

SOFTWARE_DESCRIPTION = SensorEntityDescription(
    key="software_version",
    translation_key="software_version",
    entity_category=EntityCategory.DIAGNOSTIC,
)


@dataclass(frozen=True, kw_only=True)
class MaticStateSensorDescription(SensorEntityDescription):
    """Describe one stable field on the coordinated robot state."""

    value_fn: Callable[[RobotState], str | int | None]


STATE_DESCRIPTIONS = (
    MaticStateSensorDescription(
        key="protocol_version",
        translation_key="protocol_version",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda state: state.telemetry.protocol_version,
    ),
    MaticStateSensorDescription(
        key="current_area",
        translation_key="current_area",
        value_fn=lambda state: state.operational.current_area,
    ),
    MaticStateSensorDescription(
        key="update_channel",
        translation_key="update_channel",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda state: (
            state.telemetry.update_channel or state.operational.release_channel
        ),
    ),
    MaticStateSensorDescription(
        key="update_state",
        translation_key="update_state",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda state: state.telemetry.update_state,
    ),
    MaticStateSensorDescription(
        key="wifi_state",
        translation_key="wifi_state",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda state: state.telemetry.wifi_state,
    ),
    MaticStateSensorDescription(
        key="scheduled_cleanings",
        translation_key="scheduled_cleanings",
        value_fn=lambda state: state.telemetry.scheduled_cleanings,
    ),
    MaticStateSensorDescription(
        key="local_cleaning_sessions",
        translation_key="local_cleaning_sessions",
        value_fn=lambda state: state.telemetry.local_cleaning_sessions,
    ),
    MaticStateSensorDescription(
        key="dock_detections",
        translation_key="dock_detections",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda state: state.telemetry.dock_detections,
    ),
    MaticStateSensorDescription(
        key="sink_summon_locations",
        translation_key="sink_summon_locations",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda state: state.telemetry.sink_summon_locations,
    ),
    MaticStateSensorDescription(
        key="coverage_time",
        translation_key="coverage_time",
        entity_category=EntityCategory.DIAGNOSTIC,
        native_unit_of_measurement="s",
        value_fn=lambda state: state.telemetry.coverage_time_seconds,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up Matic diagnostic sensors."""
    async_add_entities(
        [
            MaticActivitySensor(entry),
            MaticBatterySensor(entry),
            MaticHardwareRevisionSensor(entry),
            MaticRoomsSensor(entry),
            MaticCleaningHistorySensor(entry),
            MaticActiveCleaningPlanSensor(entry),
            MaticNextCleaningRoomSensor(entry),
            MaticSoftwareVersionSensor(entry),
            *(
                MaticStateSensor(entry, description)
                for description in STATE_DESCRIPTIONS
            ),
        ]
    )


class MaticHardwareRevisionSensor(MaticEntity, SensorEntity):
    """Matic hardware revision."""

    entity_description = HARDWARE_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = (
            f"{self.coordinator.data.info.serial_number}_hardware_revision"
        )

    @property
    def native_value(self) -> str:
        """Return the hardware revision."""
        return self.coordinator.data.info.hardware_revision


class MaticBatterySensor(MaticEntity, SensorEntity):
    """Matic battery percentage."""

    entity_description = BATTERY_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_battery"

    @property
    def native_value(self) -> int | None:
        """Return the verified battery percentage."""
        return self.coordinator.data.operational.battery_percentage


class MaticActivitySensor(MaticEntity, SensorEntity):
    """Conservative high-level Matic activity."""

    entity_description = ACTIVITY_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_activity"

    @property
    def native_value(self) -> str:
        """Return the high-level activity."""
        return self.coordinator.data.operational.activity

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Expose protocol codes for transparent diagnostics."""
        state = self.coordinator.data.operational
        return {
            "hermes_state_codes": list(state.state_codes),
            "hermes_error_codes": list(state.error_codes),
            "errors": list(state.error_names),
            "primary_error": state.error_names[0] if state.error_names else None,
            "current_area": state.current_area,
        }


class MaticSoftwareVersionSensor(MaticEntity, SensorEntity):
    """Robot software version and build profile."""

    entity_description = SOFTWARE_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = (
            f"{self.coordinator.data.info.serial_number}_software_version"
        )

    @property
    def native_value(self) -> str | None:
        """Return the most specific verified local software version."""
        state = self.coordinator.data
        return state.telemetry.software_version or state.operational.software_version

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Expose safe build metadata for update-aware automations."""
        state = self.coordinator.data
        return {
            "firmware_profile": state.telemetry.software_profile,
            "robot_profile": state.operational.robot_profile,
            "release_channel": state.operational.release_channel,
            "supports_easter_event": state.telemetry.supports_easter_event,
            "timezone": state.telemetry.timezone,
        }


class MaticStateSensor(MaticEntity, SensorEntity):
    """A safe, independently addressable local telemetry field."""

    entity_description: MaticStateSensorDescription

    def __init__(
        self,
        entry: MaticConfigEntry,
        description: MaticStateSensorDescription,
    ) -> None:
        super().__init__(entry)
        self.entity_description = description
        self._attr_unique_id = (
            f"{self.coordinator.data.info.serial_number}_{description.key}"
        )

    @property
    def native_value(self) -> str | int | None:
        """Return the decoded field."""
        return self.entity_description.value_fn(self.coordinator.data)

    @property
    def extra_state_attributes(self) -> dict[str, object] | None:
        """Return context only where it materially improves automation."""
        state = self.coordinator.data
        key = self.entity_description.key
        if key == "current_area":
            return {"previous_area": state.operational.previous_area}
        if key == "wifi_state":
            telemetry = state.telemetry
            return {
                "ssid": telemetry.wifi_ssid,
                "signal_dbm": telemetry.wifi_signal_dbm,
                "known_networks": sum(
                    network.known for network in telemetry.wifi_networks
                ),
                "visible_networks": len(telemetry.wifi_networks),
                "networks": [
                    {
                        "ssid": network.ssid,
                        "signal_dbm": network.signal_dbm,
                        "connected": network.connected,
                        "known": network.known,
                    }
                    for network in telemetry.wifi_networks
                ],
            }
        if key == "scheduled_cleanings":
            room_names = (
                {room.protocol_id: room.name for room in state.floor_plan.rooms}
                if state.floor_plan is not None
                else {}
            )
            return {
                "schedules": [
                    {
                        "name": schedule.name,
                        "weekdays": list(schedule.weekdays),
                        "time": schedule.time,
                        "timezone": schedule.timezone,
                        "ordered": schedule.ordered,
                        "enabled": schedule.enabled,
                        "rooms": [
                            room_names[room_id]
                            for room_id in schedule.room_ids
                            if room_id in room_names
                        ],
                        "room_ids": [
                            room_id
                            for room_id in schedule.room_ids
                            if room_id in room_names
                        ],
                    }
                    for schedule in state.telemetry.schedules
                ]
            }
        if key == "local_cleaning_sessions":
            latest = state.telemetry.latest_session
            if latest is None:
                return None
            return {
                "latest_started_at": latest.started_at,
                "latest_ended_at": latest.ended_at,
                "latest_duration_seconds": latest.duration_seconds,
                "latest_rooms": list(latest.rooms),
                "latest_room_durations": dict(latest.room_durations),
                "latest_completed": latest.completed,
            }
        return None


class MaticRoomsSensor(MaticEntity, SensorEntity):
    """Expose the active floor's room inventory."""

    entity_description = ROOMS_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_rooms"

    @property
    def native_value(self) -> int | None:
        """Return the number of rooms on the active floor."""
        floor_plan = self.coordinator.data.floor_plan
        return len(floor_plan.rooms) if floor_plan is not None else None

    @property
    def extra_state_attributes(self) -> dict[str, object] | None:
        """Return names and stable segment identifiers."""
        floor_plan = self.coordinator.data.floor_plan
        if floor_plan is None:
            return None
        return {
            "room_names": [room.name for room in floor_plan.rooms],
            "segments": {room.id: room.name for room in floor_plan.rooms},
        }


class MaticCleaningHistorySensor(MaticEntity, SensorEntity):
    """Expose durable managed-plan outcomes for advanced automations."""

    entity_description = HISTORY_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._serial_number = self.coordinator.data.info.serial_number
        self._history = entry.runtime_data.cleaning_plans
        self._attr_unique_id = f"{self._serial_number}_cleaning_history"

    async def async_added_to_hass(self) -> None:
        """Subscribe to storage-backed history changes."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self._history.async_add_listener(
                self._serial_number, self._async_history_updated
            )
        )

    @callback
    def _async_history_updated(self) -> None:
        self.async_write_ha_state()

    @property
    def available(self) -> bool:
        """Keep local history available when the robot is temporarily offline."""
        return True

    @property
    def native_value(self) -> int:
        """Return the total number of successfully completed managed rooms."""
        return int(self._history.snapshot(self._serial_number)["completed_runs"])

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Return per-room timestamps, rotation records, and active plan."""
        return self._history.snapshot(self._serial_number)


class _MaticPlanSensor(MaticEntity, SensorEntity):
    """Base for storage-backed saved-plan sensors."""

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._serial_number = self.coordinator.data.info.serial_number
        self._history = entry.runtime_data.cleaning_plans

    async def async_added_to_hass(self) -> None:
        """Subscribe to plan and history changes."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self._history.async_add_listener(
                self._serial_number, self._async_history_updated
            )
        )

    @callback
    def _async_history_updated(self) -> None:
        self.async_write_ha_state()

    @property
    def available(self) -> bool:
        """Keep locally persisted orchestration state available offline."""
        return True


class MaticActiveCleaningPlanSensor(_MaticPlanSensor):
    """Expose the running plan and exact active room."""

    entity_description = ACTIVE_PLAN_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self._serial_number}_active_cleaning_plan"

    @property
    def native_value(self) -> str | None:
        """Return the active human-readable plan name."""
        active = self._history.snapshot(self._serial_number)["active_plan"]
        return active.get("plan_name") if active else None

    @property
    def extra_state_attributes(self) -> dict[str, object] | None:
        """Return the active room and start time."""
        active = self._history.snapshot(self._serial_number)["active_plan"]
        return dict(active) if active else None


class MaticNextCleaningRoomSensor(_MaticPlanSensor):
    """Preview the next room due in the selected saved plan."""

    entity_description = NEXT_ROOM_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self._serial_number}_next_cleaning_room"

    def _preview(self) -> dict[str, Any] | None:
        floor_plan = self.coordinator.data.floor_plan
        if floor_plan is None:
            return None
        try:
            return self._history.preview(
                self._serial_number,
                {room.id: room.name for room in floor_plan.rooms},
            )
        except KeyError, ValueError:
            return None

    @property
    def native_value(self) -> str | None:
        """Return the mapped name of the next due room."""
        preview = self._preview()
        if not preview or not preview["rooms"]:
            return None
        return str(preview["rooms"][0]["name"])

    @property
    def extra_state_attributes(self) -> dict[str, object] | None:
        """Return the complete dry-run preview for automation templates."""
        return self._preview()
