"""Diagnostic sensors for Matic Hermes."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from homeassistant.components.sensor import (
    RestoreSensor,
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import (
    PERCENTAGE,
    SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
    EntityCategory,
    UnitOfTime,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util
from homeassistant.util import slugify

from . import MaticConfigEntry
from .client.models import RobotState, Room
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

FIRMWARE_COMPATIBILITY_DESCRIPTION = SensorEntityDescription(
    key="firmware_compatibility",
    translation_key="firmware_compatibility",
    entity_category=EntityCategory.DIAGNOSTIC,
)

ROOM_DURATION_DESCRIPTION = SensorEntityDescription(
    key="room_clean_duration",
    translation_key="room_clean_duration",
    device_class=SensorDeviceClass.DURATION,
    native_unit_of_measurement=UnitOfTime.SECONDS,
    state_class=SensorStateClass.MEASUREMENT,
    entity_registry_enabled_default=False,
)

ROOM_LAST_CLEANED_DESCRIPTION = SensorEntityDescription(
    key="room_last_cleaned",
    translation_key="room_last_cleaned",
    device_class=SensorDeviceClass.TIMESTAMP,
    entity_registry_enabled_default=False,
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
        entity_registry_enabled_default=False,
        value_fn=lambda state: state.telemetry.wifi_state,
    ),
    MaticStateSensorDescription(
        key="scheduled_cleanings",
        translation_key="scheduled_cleanings",
        entity_registry_enabled_default=False,
        value_fn=lambda state: state.telemetry.scheduled_cleanings,
    ),
    MaticStateSensorDescription(
        key="local_cleaning_sessions",
        translation_key="local_cleaning_sessions",
        entity_registry_enabled_default=False,
        value_fn=lambda state: state.telemetry.local_cleaning_sessions,
    ),
    MaticStateSensorDescription(
        key="dock_detections",
        translation_key="dock_detections",
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        value_fn=lambda state: state.telemetry.dock_detections,
    ),
    MaticStateSensorDescription(
        key="sink_summon_locations",
        translation_key="sink_summon_locations",
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        value_fn=lambda state: state.telemetry.sink_summon_locations,
    ),
    MaticStateSensorDescription(
        key="coverage_time",
        translation_key="coverage_time",
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        native_unit_of_measurement="s",
        value_fn=lambda state: state.telemetry.coverage_time_seconds,
    ),
    MaticStateSensorDescription(
        key="last_run_duration",
        translation_key="last_run_duration",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda state: (
            state.telemetry.latest_session.duration_seconds
            if state.telemetry.latest_session is not None
            else None
        ),
    ),
    MaticStateSensorDescription(
        key="wifi_signal",
        translation_key="wifi_signal",
        device_class=SensorDeviceClass.SIGNAL_STRENGTH,
        native_unit_of_measurement=SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        value_fn=lambda state: state.telemetry.wifi_signal_dbm,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up Matic diagnostic sensors."""
    coordinator = entry.runtime_data.coordinator
    known_rooms: set[str] = set()

    def _new_room_entities() -> list[SensorEntity]:
        """Build opt-in statistics sensors for rooms not yet seen."""
        floor_plan = coordinator.data.floor_plan
        if floor_plan is None:
            return []
        new_rooms = [room for room in floor_plan.rooms if room.id not in known_rooms]
        known_rooms.update(room.id for room in new_rooms)
        return [
            entity
            for room in new_rooms
            for entity in (
                MaticRoomDurationSensor(entry, room),
                MaticRoomLastCleanedSensor(entry, room),
            )
        ]

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
            MaticFirmwareCompatibilitySensor(entry),
            *(
                MaticStateSensor(entry, description)
                for description in STATE_DESCRIPTIONS
            ),
            *_new_room_entities(),
        ]
    )

    @callback
    def _async_add_new_rooms() -> None:
        """Add statistics sensors when the floor plan grows a room."""
        if new_entities := _new_room_entities():
            async_add_entities(new_entities)

    entry.async_on_unload(coordinator.async_add_listener(_async_add_new_rooms))


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

    _unrecorded_attributes = frozenset({"timezone"})

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


class MaticFirmwareCompatibilitySensor(MaticEntity, SensorEntity):
    """Persistent firmware and endpoint compatibility state."""

    entity_description = FIRMWARE_COMPATIBILITY_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._entry_id = entry.entry_id
        self._tracker = entry.runtime_data.firmware_tracker
        self._attr_unique_id = (
            f"{self.coordinator.data.info.serial_number}_firmware_compatibility"
        )

    async def async_added_to_hass(self) -> None:
        """Subscribe to background snapshot completion."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self._tracker.async_add_listener(
                self._entry_id, self._async_firmware_updated
            )
        )

    @callback
    def _async_firmware_updated(self) -> None:
        self.async_write_ha_state()

    @property
    def available(self) -> bool:
        """Keep persisted compatibility visible while the robot is offline."""
        return True

    @property
    def native_value(self) -> str:
        """Return pending, baseline, compatible, or regression."""
        return str(self._tracker.summary(self._entry_id)["compatibility_status"])

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Return only payload-free snapshot counts and versions."""
        return self._tracker.summary(self._entry_id)


class MaticStateSensor(MaticEntity, SensorEntity):
    """A safe, independently addressable local telemetry field."""

    entity_description: MaticStateSensorDescription
    _unrecorded_attributes = frozenset(
        {"ssid", "schedules", "latest_rooms", "latest_room_durations"}
    )

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
    _unrecorded_attributes = frozenset({"room_names", "segments"})

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
    _unrecorded_attributes = frozenset(
        {
            "last_completed_by_room",
            "plans",
            "plan_history",
            "selected_plan",
            "selected_plan_name",
            "active_plan",
            "last_interrupted_plan",
        }
    )

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
        snapshot = self._history.snapshot(self._serial_number)
        return {
            **snapshot,
            "plan_count": len(snapshot["plans"]),
            "plan_running": snapshot["active_plan"] is not None,
        }


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
    _unrecorded_attributes = frozenset({"active"})

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
        return {"active": dict(active)} if active else None


class MaticNextCleaningRoomSensor(_MaticPlanSensor):
    """Preview the next room due in the selected saved plan."""

    entity_description = NEXT_ROOM_DESCRIPTION
    _unrecorded_attributes = frozenset({"preview"})

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
        preview = self._preview()
        return {"preview": preview} if preview else None


class _MaticRoomStatisticsSensor(MaticEntity, RestoreSensor):
    """Opt-in, restore-backed statistics for one named room.

    Values persist across restarts and robot outages so long-term
    statistics survive sessions the robot completes while HA is down.
    """

    def __init__(self, entry: MaticConfigEntry, room: Room) -> None:
        super().__init__(entry)
        self._room_id = room.id
        self._history = entry.runtime_data.cleaning_plans
        self._serial_number = self.coordinator.data.info.serial_number
        self._attr_translation_placeholders = {"room": room.name}
        self._suggested_suffix = room.name

    @property
    def suggested_object_id(self) -> str | None:
        """Name the entity after the room, not its opaque identifier."""
        suffix = self.entity_description.key.removeprefix("room_")
        return slugify(f"{self._suggested_suffix}_{suffix}")

    @property
    def available(self) -> bool:
        """Keep historical room facts visible while the robot is offline."""
        return True

    def _room_session_value(self) -> tuple[str, int] | None:
        """Return this room's (ended_at, seconds) from the latest session."""
        return self._room_session_result()[1]

    def _room_session_result(self) -> tuple[bool, tuple[str, int] | None]:
        """Return whether a managed run owns the session and its room result."""
        state = self.coordinator.data
        session = state.telemetry.latest_session
        if session is None or session.ended_at is None or state.floor_plan is None:
            return False, None
        room = next(
            (item for item in state.floor_plan.rooms if item.id == self._room_id),
            None,
        )
        if room is None:
            return False, None
        managed, managed_value = _managed_room_session_value(
            self._history.snapshot(self._serial_number),
            self._room_id,
            session.started_at,
            session.ended_at,
        )
        if managed:
            return True, managed_value
        durations = dict(session.room_durations)
        if room.name not in durations:
            return False, None
        return False, (session.ended_at, durations[room.name])

    @callback
    def _async_apply_session(self) -> None:
        """Apply the latest finished session that included this room."""

    @callback
    def _handle_coordinator_update(self) -> None:
        self._async_apply_session()
        super()._handle_coordinator_update()


class MaticRoomDurationSensor(_MaticRoomStatisticsSensor):
    """How long the robot spent in one room during its latest visit."""

    entity_description = ROOM_DURATION_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry, room: Room) -> None:
        super().__init__(entry, room)
        self._attr_unique_id = f"{self._matic_serial}_room_{room.id}_clean_duration"

    async def async_added_to_hass(self) -> None:
        """Restore the last known duration, then apply any newer session."""
        await super().async_added_to_hass()
        data = await self.async_get_last_sensor_data()
        if data is not None and isinstance(data.native_value, (int, float)):
            self._attr_native_value = int(data.native_value)
        self._async_apply_session()

    @callback
    def _async_apply_session(self) -> None:
        """Apply the latest finished session that included this room."""
        managed, value = self._room_session_result()
        if value is not None:
            self._attr_native_value = value[1]
        elif managed:
            self._attr_native_value = None


class MaticRoomLastCleanedSensor(_MaticRoomStatisticsSensor):
    """When the robot last finished a session that covered one room."""

    entity_description = ROOM_LAST_CLEANED_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry, room: Room) -> None:
        super().__init__(entry, room)
        self._attr_unique_id = f"{self._matic_serial}_room_{room.id}_last_cleaned"

    async def async_added_to_hass(self) -> None:
        """Restore the last known timestamp, then apply any newer session."""
        await super().async_added_to_hass()
        data = await self.async_get_last_sensor_data()
        if data is not None and isinstance(data.native_value, datetime):
            self._attr_native_value = data.native_value
        self._async_apply_session()

    @callback
    def _async_apply_session(self) -> None:
        """Apply the latest finished session that included this room."""
        managed, value = self._room_session_result()
        if value is not None:
            ended_at = dt_util.parse_datetime(value[0])
            if ended_at is not None:
                self._attr_native_value = dt_util.as_utc(ended_at)
        elif managed:
            self._attr_native_value = None


def _managed_room_session_value(
    snapshot: dict[str, Any],
    room_id: str,
    started_at: str | None,
    ended_at: str,
) -> tuple[bool, tuple[str, int] | None]:
    """Use exact plan outcomes when a managed run overlaps the session."""
    started = dt_util.parse_datetime(started_at) if started_at is not None else None
    ended = dt_util.parse_datetime(ended_at)
    if started is None or ended is None:
        return False, None

    records: list[dict[str, Any]] = []
    relevant: list[dict[str, Any]] = []
    for rotation in snapshot.get("plan_history", {}).values():
        for record in rotation.get("rooms", {}).values():
            records.append(record)
            raw_started = record.get("last_started")
            room_started = (
                dt_util.parse_datetime(raw_started)
                if isinstance(raw_started, str)
                else None
            )
            if (
                room_started is not None
                and started - timedelta(seconds=120) <= room_started <= ended
            ):
                relevant.append(record)
    if not relevant:
        return False, None

    matching = [record for record in relevant if record.get("room_id") == room_id]
    if matching:
        record = max(matching, key=lambda item: str(item.get("last_started", "")))
        duration = record.get("last_duration_seconds")
        completed = record.get("last_completed")
        if (
            record.get("last_result") == "completed"
            and isinstance(completed, str)
            and isinstance(duration, int | float)
        ):
            return True, (completed, max(0, round(duration)))

    historical = [
        (completed, max(0, round(duration)))
        for record in records
        if record.get("room_id") == room_id
        and isinstance((completed := record.get("last_completed")), str)
        and isinstance((duration := record.get("last_duration_seconds")), int | float)
    ]
    return True, max(historical, default=None, key=lambda item: item[0])
