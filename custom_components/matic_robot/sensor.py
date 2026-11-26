"""Diagnostic sensors for Matic Hermes."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

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
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util
from homeassistant.util import slugify

from . import MaticConfigEntry
from .client import (
    ROBOT_ALERT_OPTIONS,
    CleaningPhase,
    CuesGestureStatus,
    CuesVoiceStatus,
    RobotActivity,
    Room,
)
from .entity import MaticEntity, MaticPlanDataEntity
from .native_completion import native_room_key
from .plan_model import plan_floor_token, room_cadence_identity
from .room_results import (
    native_statistics_blocked,
    room_statistics_result,
    room_statistics_source,
)
from .session import RobotSession
from .stores import Store
from .wifi_room_sensor import MaticRoomWifiSignalSensor

PARALLEL_UPDATES = 0

BATTERY_DESCRIPTION = SensorEntityDescription(
    key="battery",
    translation_key="battery",
    device_class=SensorDeviceClass.BATTERY,
    native_unit_of_measurement=PERCENTAGE,
)

ROBOT_ALERT_DESCRIPTION = SensorEntityDescription(
    key="robot_alert",
    translation_key="robot_alert",
    device_class=SensorDeviceClass.ENUM,
    options=list(ROBOT_ALERT_OPTIONS),
)

HISTORY_DESCRIPTION = SensorEntityDescription(
    key="cleaning_history",
    translation_key="cleaning_history",
)

ACTIVE_PLAN_DESCRIPTION = SensorEntityDescription(
    key="active_cleaning_plan",
    translation_key="active_cleaning_plan",
)

CURRENT_ROOM_TIMING_DESCRIPTIONS = (
    SensorEntityDescription(
        key="current_room_active_time",
        translation_key="current_room_active_time",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        suggested_unit_of_measurement=UnitOfTime.MINUTES,
    ),
    SensorEntityDescription(
        key="current_room_expected_duration",
        translation_key="current_room_expected_duration",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        suggested_unit_of_measurement=UnitOfTime.MINUTES,
    ),
    SensorEntityDescription(
        key="current_room_estimated_progress",
        translation_key="current_room_estimated_progress",
        native_unit_of_measurement=PERCENTAGE,
    ),
)

NEXT_ROOM_DESCRIPTION = SensorEntityDescription(
    key="next_cleaning_room",
    translation_key="next_cleaning_room",
)

FIRMWARE_COMPATIBILITY_DESCRIPTION = SensorEntityDescription(
    key="firmware_compatibility",
    translation_key="firmware_compatibility",
    device_class=SensorDeviceClass.ENUM,
    options=["pending", "baseline", "compatible", "regression", "current"],
    entity_category=EntityCategory.DIAGNOSTIC,
)

ROOM_DURATION_DESCRIPTION = SensorEntityDescription(
    key="room_clean_duration",
    translation_key="room_clean_duration",
    device_class=SensorDeviceClass.DURATION,
    native_unit_of_measurement=UnitOfTime.SECONDS,
    suggested_unit_of_measurement=UnitOfTime.MINUTES,
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
    """Describe one stable field read from one of the session's stores."""

    store: Literal["state", "telemetry", "progress", "history"]
    value_fn: Callable[[RobotSession], str | int | datetime | None]


STATE_DESCRIPTIONS = (
    MaticStateSensorDescription(
        key="cues_voice_status",
        translation_key="cues_voice_status",
        device_class=SensorDeviceClass.ENUM,
        options=[status.value for status in CuesVoiceStatus],
        entity_category=EntityCategory.DIAGNOSTIC,
        store="state",
        value_fn=lambda session: session.state.value.operational.cues_voice_status,
    ),
    MaticStateSensorDescription(
        key="cues_gesture_status",
        translation_key="cues_gesture_status",
        device_class=SensorDeviceClass.ENUM,
        options=[status.value for status in CuesGestureStatus],
        entity_category=EntityCategory.DIAGNOSTIC,
        store="state",
        value_fn=lambda session: session.state.value.operational.cues_gesture_status,
    ),
    MaticStateSensorDescription(
        key="current_area",
        translation_key="current_area",
        store="state",
        value_fn=lambda session: session.state.value.operational.current_area,
    ),
    MaticStateSensorDescription(
        key="wifi_state",
        translation_key="wifi_state",
        device_class=SensorDeviceClass.ENUM,
        options=[
            "unknown",
            "connecting",
            "connected",
            "disconnected",
            "disconnecting",
            "roaming",
        ],
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        store="telemetry",
        value_fn=lambda session: session.telemetry.value.wifi_state,
    ),
    MaticStateSensorDescription(
        key="local_cleaning_sessions",
        translation_key="local_cleaning_sessions",
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        store="telemetry",
        value_fn=lambda session: session.telemetry.value.local_cleaning_sessions,
    ),
    MaticStateSensorDescription(
        key="coverage_time",
        translation_key="coverage_time",
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        suggested_unit_of_measurement=UnitOfTime.MINUTES,
        store="telemetry",
        value_fn=lambda session: session.telemetry.value.coverage_time_seconds,
    ),
    MaticStateSensorDescription(
        key="cleaning_phase",
        translation_key="cleaning_phase",
        device_class=SensorDeviceClass.ENUM,
        options=[phase.value for phase in CleaningPhase],
        store="state",
        value_fn=lambda session: session.state.value.operational.cleaning_phase,
    ),
    MaticStateSensorDescription(
        key="run_progress",
        translation_key="run_progress",
        native_unit_of_measurement=PERCENTAGE,
        store="progress",
        value_fn=lambda session: (
            session.progress.value.percent
            if session.progress.value is not None
            else None
        ),
    ),
    MaticStateSensorDescription(
        key="time_remaining",
        translation_key="time_remaining",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        suggested_unit_of_measurement=UnitOfTime.MINUTES,
        store="progress",
        value_fn=lambda session: (
            session.progress.value.remaining_seconds
            if session.progress.value is not None
            else None
        ),
    ),
    MaticStateSensorDescription(
        key="last_run_duration",
        translation_key="last_run_duration",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        suggested_unit_of_measurement=UnitOfTime.HOURS,
        state_class=SensorStateClass.MEASUREMENT,
        store="history",
        value_fn=lambda session: (
            session.history.value.latest_session.duration_seconds
            if session.history.value.latest_session is not None
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
        store="telemetry",
        value_fn=lambda session: session.telemetry.value.wifi_signal_dbm,
    ),
    MaticStateSensorDescription(
        key="bag_pass_expires",
        translation_key="bag_pass_expires",
        device_class=SensorDeviceClass.TIMESTAMP,
        store="telemetry",
        value_fn=lambda session: session.telemetry.value.bag_pass_expires_at,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up Matic diagnostic sensors."""
    session = entry.runtime_data.session
    room_timing = _RoomTimingPublisher(hass, entry)
    known_rooms: set[str] = set()

    def _new_room_entities() -> list[SensorEntity]:
        """Build opt-in statistics and Wi-Fi sensors for rooms not yet seen."""
        floor_plan = session.floor.value
        if floor_plan is None:
            return []
        new_rooms = [room for room in floor_plan.rooms if room.id not in known_rooms]
        known_rooms.update(room.id for room in new_rooms)
        kinds = (
            MaticRoomDurationSensor,
            MaticRoomLastCleanedSensor,
            MaticRoomWifiSignalSensor,
        )
        return [kind(entry, room) for room in new_rooms for kind in kinds]

    async_add_entities(
        [
            MaticRobotAlertSensor(entry),
            MaticBatterySensor(entry),
            MaticCleaningHistorySensor(entry),
            MaticActiveCleaningPlanSensor(entry),
            *(
                MaticCurrentRoomTimingSensor(entry, description, room_timing, field)
                for description, field in zip(
                    CURRENT_ROOM_TIMING_DESCRIPTIONS,
                    ("active_elapsed_seconds", "expected_seconds", "estimated_percent"),
                    strict=True,
                )
            ),
            MaticNextCleaningRoomSensor(entry),
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

    entry.async_on_unload(session.floor.subscribe(_async_add_new_rooms))


class MaticBatterySensor(MaticEntity, SensorEntity):
    """Matic battery percentage."""

    entity_description = BATTERY_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self.session.info.serial_number}_battery"

    @property
    def native_value(self) -> int | None:
        """Return the verified battery percentage."""
        return self.session.state.value.operational.battery_percentage


class MaticRobotAlertSensor(MaticEntity, SensorEntity):
    """The robot's current alert by name, or unknown with its raw code."""

    entity_description = ROBOT_ALERT_DESCRIPTION

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self.session.info.serial_number}_robot_alert"

    @property
    def native_value(self) -> str:
        """Return the first named alert, ``unknown``, or ``none``."""
        return self.session.state.value.operational.alert

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Expose every active alert and when unmapped codes were seen."""
        operational = self.session.state.value.operational
        return {
            "alerts": list(operational.alerts),
            "codes": list(operational.error_codes),
            "unknown_codes_seen": self.session.health.unknown_alert_codes,
        }


class MaticFirmwareCompatibilitySensor(MaticEntity, SensorEntity):
    """Persistent firmware and endpoint compatibility state."""

    entity_description = FIRMWARE_COMPATIBILITY_DESCRIPTION
    # Keep the bounded evidence inbox available to automations without exceeding
    # Recorder's state-attribute limit or duplicating the durable report store.
    _unrecorded_attributes = frozenset({"firmware_report"})

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._entry_id = entry.entry_id
        self._tracker = entry.runtime_data.firmware_tracker
        self._attr_unique_id = (
            f"{self.session.info.serial_number}_firmware_compatibility"
        )

    async def async_added_to_hass(self) -> None:
        """Subscribe to background snapshot completion."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self._tracker.async_add_listener(
                self._entry_id, self._async_firmware_updated
            )
        )

    def _stores(self) -> Iterable[Store[Any]]:
        return ()

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


# Matic Map finds these sensors by entry and key and shows their states.
_MAP_METRICS = frozenset(
    {"current_area", "cleaning_phase", "run_progress", "time_remaining"}
)


class MaticStateSensor(MaticEntity, SensorEntity):
    """A safe, independently addressable local telemetry field."""

    entity_description: MaticStateSensorDescription
    _unrecorded_attributes = frozenset(
        {
            "ssid",
            "latest_rooms",
            "latest_completed_rooms",
            "latest_room_durations",
            "latest_mode_results",
            "matic_entry_id",
            "matic_metric",
        }
    )

    def __init__(
        self,
        entry: MaticConfigEntry,
        description: MaticStateSensorDescription,
    ) -> None:
        super().__init__(entry)
        self.entity_description = description
        self._attr_unique_id = f"{self.session.info.serial_number}_{description.key}"

    def _stores(self) -> Iterable[Store[Any]]:
        stores: list[Store[Any]] = [
            getattr(self.session, self.entity_description.store)
        ]
        if self.entity_description.key == "local_cleaning_sessions":
            stores.append(self.session.history)
        return stores

    @property
    def native_value(self) -> str | int | datetime | None:
        """Return the decoded field."""
        return self.entity_description.value_fn(self.session)

    @property
    def extra_state_attributes(self) -> dict[str, object] | None:
        """Return context only where it materially improves automation."""
        key = self.entity_description.key
        if key in _MAP_METRICS:
            metric: dict[str, object] = {
                "matic_entry_id": self._config_entry.entry_id,
                "matic_metric": key,
            }
            if key == "current_area":
                metric["previous_area"] = (
                    self.session.state.value.operational.previous_area
                )
            return metric
        if key == "wifi_state":
            telemetry = self.session.telemetry.value
            return {
                "ssid": telemetry.wifi_ssid,
                "signal_dbm": telemetry.wifi_signal_dbm,
                "known_networks": sum(
                    network.known for network in telemetry.wifi_networks
                ),
                "visible_networks": len(telemetry.wifi_networks),
            }
        if key == "local_cleaning_sessions":
            latest = self.session.history.value.latest_session
            if latest is None:
                return None
            attributes: dict[str, object] = {
                "latest_started_at": latest.started_at,
                "latest_ended_at": latest.ended_at,
                "latest_duration_seconds": latest.duration_seconds,
                "latest_rooms": list(latest.visited_rooms),
                "latest_completed_rooms": list(latest.completed_rooms),
                "latest_room_durations": dict(latest.room_durations),
                "latest_completed": latest.completed,
                "latest_stop_reason": latest.stop_reason,
            }
            if latest.mode_results:
                attributes["latest_mode_results"] = [
                    {
                        "room": result.room,
                        "cleaning_mode": result.cleaning_mode,
                        "status": result.status,
                        "duration_seconds": result.duration_seconds,
                    }
                    for result in latest.mode_results
                ]
            return attributes
        return None


class _MaticPlanSensor(MaticPlanDataEntity, SensorEntity):
    """Base for storage-backed saved-plan sensors."""

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._serial_number = self.session.info.serial_number
        self._history = entry.runtime_data.cleaning_plans.history

    def _stores(self) -> Iterable[Store[Any]]:
        return ()

    @property
    def available(self) -> bool:
        """Keep locally persisted orchestration state available offline."""
        return True


class MaticCleaningHistorySensor(_MaticPlanSensor):
    """Expose durable managed-plan outcomes for advanced automations."""

    entity_description = HISTORY_DESCRIPTION
    _unrecorded_attributes = frozenset(
        {
            "matic_entry_id",
            "last_completed_by_room",
            "robot_reported_completed_by_room",
            "plans",
            "plan_history",
            "selected_plan",
            "selected_plan_name",
            "active_plan",
            "last_interrupted_plan",
            "last_run",
            "run",
        }
    )

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self._serial_number}_cleaning_history"

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
            "matic_entry_id": self._config_entry.entry_id,
            "plan_count": len(snapshot["plans"]),
            "plan_running": self._history.running_run(self._serial_number) is not None,
            "run": self._history.run_summary(self._serial_number),
        }


class _RoomTimingPublisher:
    """Publish one local sample to all timing entities, without robot polling."""

    def __init__(self, hass: HomeAssistant, entry: MaticConfigEntry) -> None:
        self._entry = entry
        self._listeners: set[Callable[[], None]] = set()
        self._closed = False
        self.data: dict[str, Any] | None = None
        self.refresh()
        session = entry.runtime_data.session
        removers = (
            session.state.subscribe(self.refresh),
            session.error.subscribe(self.refresh),
            entry.runtime_data.cleaning_plans.repository.async_add_listener(
                session.info.serial_number, self.refresh
            ),
            async_track_time_interval(
                hass, self.refresh, timedelta(seconds=5), cancel_on_shutdown=True
            ),
        )

        @callback
        def close() -> None:
            self._closed = True
            self._listeners.clear()
            for remove in removers:
                remove()

        entry.async_on_unload(close)

    @callback
    def add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    @callback
    def refresh(self, _now: datetime | None = None) -> None:
        """Re-read ownership on every tick; never keep another run's estimate."""
        if self._closed:
            return
        session = self._entry.runtime_data.session
        data = None
        if session.error.value is None:
            state = session.state.value.operational
            if state.activity in {RobotActivity.CLEANING, RobotActivity.PAUSED}:
                candidate = (
                    self._entry.runtime_data.cleaning_plans.history.current_room_timing(
                        session.info.serial_number
                    )
                )
                if candidate is not None:
                    area = native_room_key(state.current_area or "")
                    matching_room = area and area in {
                        native_room_key(candidate["room_id"]),
                        native_room_key(candidate.get("room") or ""),
                    }
                    matching_phase = candidate["status"] == (
                        "suspended"
                        if state.activity == RobotActivity.PAUSED
                        else "running"
                    )
                    if matching_room and matching_phase:
                        data = candidate
        if data == self.data:
            return
        self.data = data
        for listener in tuple(self._listeners):
            listener()


class MaticCurrentRoomTimingSensor(MaticEntity, SensorEntity):
    """Expose one field from the same sampled current-room timing model."""

    _unrecorded_attributes = frozenset(
        {
            "matic_entry_id",
            "matic_metric",
            "run_id",
            "room_id",
            "room",
            "status",
            "active_elapsed_seconds",
            "expected_seconds",
            "estimated_percent",
            "baseline_samples",
        }
    )

    def __init__(
        self,
        entry: MaticConfigEntry,
        description: SensorEntityDescription,
        publisher: _RoomTimingPublisher,
        field: str,
    ) -> None:
        super().__init__(entry)
        self.entity_description = description
        self._publisher = publisher
        self._field = field
        self._attr_unique_id = f"{self._matic_serial}_{description.key}"

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self._publisher.add_listener(self.async_write_ha_state))

    def _stores(self) -> Iterable[Store[Any]]:
        return ()

    @property
    def native_value(self) -> int | None:
        return (self._publisher.data or {}).get(self._field)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "matic_entry_id": self._config_entry.entry_id,
            "matic_metric": self.entity_description.key,
            **(self._publisher.data or {}),
        }


class MaticActiveCleaningPlanSensor(_MaticPlanSensor):
    """Expose the running plan for the whole run and its current room."""

    entity_description = ACTIVE_PLAN_DESCRIPTION
    _unrecorded_attributes = frozenset({"active"})

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self._serial_number}_active_cleaning_plan"

    @property
    def native_value(self) -> str | None:
        """Return the running plan's name, between its rooms too."""
        run = self._history.running_run(self._serial_number)
        return run.plan_name if run is not None else None

    @property
    def extra_state_attributes(self) -> dict[str, object] | None:
        """Return the current room or area and its start; absent between them."""
        active = self._history.snapshot(self._serial_number)["active_plan"]
        return {"active": dict(active)} if active else None


class MaticNextCleaningRoomSensor(_MaticPlanSensor):
    """Preview the next room due in the selected saved plan."""

    entity_description = NEXT_ROOM_DESCRIPTION
    _unrecorded_attributes = frozenset({"preview"})

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self._serial_number}_next_cleaning_room"

    def _stores(self) -> Iterable[Store[Any]]:
        return (self.session.floor,)

    def _preview(self) -> dict[str, Any] | None:
        floor_plan = self.session.floor.value
        if floor_plan is None:
            return None
        if not self._config_entry.runtime_data.slam_map.floor_plan_is_current(
            floor_plan
        ):
            return None
        try:
            return self._config_entry.runtime_data.cleaning_plans.planning.preview(
                self._serial_number,
                {room.id: room.name for room in floor_plan.rooms},
                floor_token=plan_floor_token(floor_plan),
                room_identities={
                    room.id: room_cadence_identity(floor_plan, room.id)
                    for room in floor_plan.rooms
                },
                floor_plan=floor_plan,
            )
        except KeyError, ValueError:
            return None

    @property
    def native_value(self) -> str | None:
        """Return the name of the next room, or custom area, the plan cleans."""
        preview = self._preview()
        steps = (preview.get("entries") or preview["rooms"]) if preview else None
        if not steps:
            return None
        return str(steps[0]["name"])

    @property
    def extra_state_attributes(self) -> dict[str, object] | None:
        """Return the complete dry-run preview for automation templates."""
        preview = self._preview()
        return {"preview": preview} if preview else None


class _MaticRoomStatisticsSensor(MaticPlanDataEntity, RestoreSensor):
    """Opt-in, restore-backed statistics for one named room.

    Values persist across restarts and robot outages so long-term
    statistics survive sessions the robot completes while HA is down.
    """

    def __init__(self, entry: MaticConfigEntry, room: Room) -> None:
        super().__init__(entry)
        self._room_id = room.id
        self._history = entry.runtime_data.cleaning_plans.history
        self._serial_number = self.session.info.serial_number
        self._attr_translation_placeholders = {"room": room.name}
        self._suggested_suffix = room.name

    @property
    def suggested_object_id(self) -> str | None:
        """Name the entity after the room, not its opaque identifier."""
        suffix = self.entity_description.key.removeprefix("room_")
        return slugify(f"{self._suggested_suffix}_{suffix}")

    @callback
    def _handle_plan_data_update(self) -> None:
        """Apply verified managed-room outcomes before publishing."""
        self._async_apply_session()
        super()._handle_plan_data_update()

    @property
    def available(self) -> bool:
        """Keep history offline, but retire rooms removed from the active map."""
        floor_plan = self.session.floor.value
        return floor_plan is None or any(
            room.id == self._room_id for room in floor_plan.rooms
        )

    def _room_session_result(self) -> tuple[bool, tuple[str, int] | None]:
        """Return whether a managed run owns the session and its room result."""
        return room_statistics_result(
            self._history.snapshot(self._serial_number),
            self._room_id,
            self.session.floor.value,
            self.session.history.value.latest_session,
        )

    @property
    def extra_state_attributes(self) -> dict[str, str]:
        """Identify the value's source and explain withheld app-started results."""
        floor_plan = self.session.floor.value
        snapshot = self._history.snapshot(self._serial_number)
        source = room_statistics_source(
            snapshot,
            self._room_id,
            floor_plan,
            self._room_session_result(),
            restored=self.native_value is not None,
        )
        attributes = {"statistics_source": source} if source is not None else {}
        if native_statistics_blocked(snapshot, self._room_id, floor_plan):
            attributes["native_statistics_blocked_reason"] = (
                "App-started room statistics are unavailable because native "
                "history lacks verified floor identity."
            )
        return attributes

    @callback
    def _async_apply_session(self) -> None:
        """Apply the latest finished session that included this room."""

    def _stores(self) -> Iterable[Store[Any]]:
        return (self.session.floor, self.session.history)

    @callback
    def _handle_store_update(self) -> None:
        self._async_apply_session()
        super()._handle_store_update()


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
