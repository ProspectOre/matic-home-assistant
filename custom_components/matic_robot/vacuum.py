"""Vacuum controls for Matic Hermes."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from homeassistant.components.vacuum import Segment, StateVacuumEntity
from homeassistant.components.vacuum.const import VacuumActivity, VacuumEntityFeature
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.commands import CleaningMode, CoverageSetting, UserCommand
from .client.models import FloorPlan, RobotActivity, Room
from .const import DOMAIN
from .entity import MaticEntity

PARALLEL_UPDATES = 1

SUPPORTED_FEATURES = (
    VacuumEntityFeature.STATE
    | VacuumEntityFeature.START
    | VacuumEntityFeature.PAUSE
    | VacuumEntityFeature.STOP
    | VacuumEntityFeature.RETURN_HOME
    | VacuumEntityFeature.CLEAN_AREA
    | VacuumEntityFeature.MAP
    | VacuumEntityFeature.SEND_COMMAND
)

ACTIVITY_MAP = {
    RobotActivity.ERROR: VacuumActivity.ERROR,
    RobotActivity.PAUSED: VacuumActivity.PAUSED,
    RobotActivity.CLEANING: VacuumActivity.CLEANING,
    RobotActivity.RETURNING: VacuumActivity.RETURNING,
    RobotActivity.CHARGING: VacuumActivity.DOCKED,
    RobotActivity.DOCKED: VacuumActivity.DOCKED,
    RobotActivity.READY: VacuumActivity.IDLE,
}

SegmentSignature = tuple[tuple[str, str, str | None], ...]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the Matic vacuum entity."""
    async_add_entities([MaticVacuum(entry)])


class MaticVacuum(MaticEntity, StateVacuumEntity):
    """Authenticated local Matic vacuum controls."""

    _attr_supported_features = SUPPORTED_FEATURES

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_vacuum"
        self._reported_segment_change: SegmentSignature | None = None
        self._plans = entry.runtime_data.cleaning_plans

    @callback
    def _async_cancel_managed_plan(self) -> None:
        """End any managed plan run so a user stop or dock is final.

        The plan runner reads a docked robot as room completion and would
        otherwise dispatch the next room, sending the robot straight back
        out after the user told it to stop.
        """
        self._plans.cancel(self.coordinator.data.info.serial_number)

    async def async_added_to_hass(self) -> None:
        """Auto-link unconfigured robot rooms to matching Home Assistant Areas."""
        await super().async_added_to_hass()
        self._async_auto_map_rooms()
        self._async_check_segment_changes()

    @callback
    def _handle_coordinator_update(self) -> None:
        """Detect room changes and retry safe exact-name auto-mapping."""
        self._async_auto_map_rooms()
        self._async_check_segment_changes()
        super()._handle_coordinator_update()

    @property
    def activity(self) -> VacuumActivity:
        """Return the verified high-level robot activity."""
        return ACTIVITY_MAP[self.coordinator.data.operational.activity]

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Expose compact verified status for automations and templates."""
        state = self.coordinator.data.operational
        floor_plan = self.coordinator.data.floor_plan
        return {
            "low_charge": state.low_charge,
            "problem": bool(state.error_codes),
            "rooms": (
                {room.id: room.name for room in floor_plan.rooms}
                if floor_plan is not None
                else {}
            ),
        }

    async def _async_command(self, command: UserCommand) -> None:
        """Send a command and immediately refresh state."""
        await self.coordinator.client.async_send_user_command(command)
        await self.coordinator.async_request_refresh()

    def _floor_plan(self) -> FloorPlan:
        floor_plan = self.coordinator.data.floor_plan
        if floor_plan is None or not floor_plan.rooms:
            raise _validation_error(
                "The robot's room map is unavailable", "room_plan_unavailable"
            )
        return floor_plan

    async def _async_clean_rooms(
        self,
        rooms: list[Room],
        *,
        cleaning_mode: CleaningMode | None = None,
        coverage_setting: CoverageSetting | None = None,
        ordered: bool = False,
    ) -> None:
        floor_plan = self._floor_plan()
        await self.coordinator.client.async_start_coverage(
            floor_plan,
            [room.protocol_id for room in rooms],
            cleaning_mode=cleaning_mode or self.coordinator.cleaning_mode,
            coverage_setting=coverage_setting or self.coordinator.coverage_setting,
            ordered=ordered,
        )
        await self.coordinator.async_request_refresh()

    async def async_start(self, **kwargs: object) -> None:
        """Resume a paused task or start a full-floor clean."""
        if self.coordinator.data.operational.paused:
            await self._async_command(UserCommand.RESUME)
            return
        await self._async_clean_rooms(list(self._floor_plan().rooms))

    async def async_pause(self, **kwargs: object) -> None:
        """Pause the current task."""
        await self._async_command(UserCommand.PAUSE)

    async def async_stop(self, **kwargs: object) -> None:
        """Stop the current task and any managed plan driving it."""
        self._async_cancel_managed_plan()
        await self._async_command(UserCommand.STOP)

    async def async_return_to_base(self, **kwargs: object) -> None:
        """Send the robot to its dock and end any task driving it."""
        self._async_cancel_managed_plan()
        if self.activity in {VacuumActivity.CLEANING, VacuumActivity.PAUSED}:
            # The robot treats docking mid-task as recharge-and-resume and
            # heads back out afterwards; stop the task first so a
            # user-requested dock is final.
            await self._async_command(UserCommand.STOP)
        await self._async_command(UserCommand.DOCK)

    async def async_get_segments(self) -> list[Segment]:
        """Return native Home Assistant cleaning areas for every named room."""
        return self._current_segments()

    def _current_segments(self) -> list[Segment]:
        """Return the currently available local room segments."""
        floor_plan = self.coordinator.data.floor_plan
        if floor_plan is None:
            return []
        return [
            Segment(room.id, room.name, "Current floor") for room in floor_plan.rooms
        ]

    @callback
    def _async_auto_map_rooms(self) -> None:
        """Map exact existing HA Area names once without overriding user choices."""
        if self.entity_id is None or self.coordinator.data.floor_plan is None:
            return
        entity_registry = er.async_get(self.hass)
        if (entity_entry := entity_registry.async_get(self.entity_id)) is None:
            return
        options = dict(entity_entry.options.get("vacuum", {}))
        if "area_mapping" in options:
            return
        segments = self._current_segments()
        mapping = _matching_area_mapping(
            self.coordinator.data.floor_plan.rooms,
            ar.async_get(self.hass),
        )
        if not mapping:
            return
        options.update(
            {
                "area_mapping": mapping,
                "last_seen_segments": [asdict(segment) for segment in segments],
            }
        )
        entity_registry.async_update_entity_options(self.entity_id, "vacuum", options)

    @callback
    def _async_check_segment_changes(self) -> None:
        """Raise Home Assistant's native repair when configured rooms change."""
        if self.coordinator.data.floor_plan is None:
            return
        current = self._current_segments()
        signature = _segment_signature(current)
        configured = self.last_seen_segments
        if configured is None or _segment_signature(configured) == signature:
            self._reported_segment_change = None
            return
        if self._reported_segment_change != signature:
            self.async_create_segments_issue()
            self._reported_segment_change = signature

    async def async_clean_segments(self, segment_ids: list[str], **kwargs: Any) -> None:
        """Clean the selected native Home Assistant room segments."""
        rooms = self._resolve_rooms(segment_ids)
        await self._async_clean_rooms(rooms)

    async def async_send_command(
        self,
        command: str,
        params: dict[str, Any] | list[Any] | None = None,
        **kwargs: Any,
    ) -> None:
        """Expose safe named commands for scripts and advanced dashboards."""
        normalized = command.strip().lower().replace("-", "_").replace(" ", "_")
        simple_commands = {
            "pause": UserCommand.PAUSE,
            "resume": UserCommand.RESUME,
            "stop": UserCommand.STOP,
            "dock": UserCommand.DOCK,
            "return_home": UserCommand.DOCK,
        }
        if normalized in simple_commands:
            await self._async_command(simple_commands[normalized])
            return
        if normalized in {"clean_all", "start"}:
            options = self._clean_options(params)
            await self._async_clean_rooms(list(self._floor_plan().rooms), **options)
            return
        if normalized in {"clean_rooms", "clean_segments"}:
            identifiers = (
                params
                if isinstance(params, list)
                else (params or {}).get("rooms", (params or {}).get("segments", []))
            )
            if not isinstance(identifiers, list) or not all(
                isinstance(value, str) for value in identifiers
            ):
                raise ServiceValidationError(
                    "clean_rooms requires params.rooms as a list of room names or IDs",
                    translation_domain=DOMAIN,
                    translation_key="rooms_must_be_list",
                )
            options = self._clean_options(params)
            await self._async_clean_rooms(self._resolve_rooms(identifiers), **options)
            return
        raise _validation_error(
            "Unsupported Matic command. Use start, clean_all, clean_rooms, "
            "clean_segments, pause, resume, stop, dock, or return_home",
            "unsupported_command",
        )

    def _resolve_rooms(self, identifiers: list[str]) -> list[Room]:
        if not identifiers:
            raise _validation_error("Select at least one Matic room", "no_rooms")
        rooms = self._floor_plan().rooms
        lookup = {
            key: room
            for room in rooms
            for key in (room.id.casefold(), room.name.casefold())
        }
        resolved: list[Room] = []
        missing: list[str] = []
        for identifier in identifiers:
            room = lookup.get(identifier.casefold())
            if room is None:
                missing.append(identifier)
            elif room not in resolved:
                resolved.append(room)
        if missing:
            missing_names = ", ".join(missing)
            raise _validation_error(
                f"Unknown Matic room(s): {missing_names}",
                "unknown_rooms",
                {"rooms": missing_names},
            )
        return resolved

    def _clean_options(
        self, params: dict[str, Any] | list[Any] | None
    ) -> dict[str, Any]:
        if not isinstance(params, dict):
            return {}
        try:
            mode = _enum_option(
                CleaningMode,
                params.get("cleaning_mode", self.coordinator.cleaning_mode),
            )
            coverage = _enum_option(
                CoverageSetting,
                params.get("coverage", self.coordinator.coverage_setting),
            )
        except ValueError as err:
            raise _validation_error(
                str(err), "invalid_cleaning_option", {"error": str(err)}
            ) from err
        ordered = params.get("ordered", False)
        if not isinstance(ordered, bool):
            raise _validation_error(
                "ordered must be true or false", "ordered_must_be_boolean"
            )
        return {
            "cleaning_mode": mode,
            "coverage_setting": coverage,
            "ordered": ordered,
        }


def _enum_option[CleaningOptionT: (CleaningMode, CoverageSetting)](
    enum_type: type[CleaningOptionT], value: Any
) -> CleaningOptionT:
    if isinstance(value, enum_type):
        return value
    if not isinstance(value, str):
        raise ValueError(f"{enum_type.__name__} must be a string")
    normalized = value.strip().casefold().replace("_", " ").replace("-", " ")
    for option in enum_type:
        names = {
            option.name.casefold().replace("_", " "),
            option.value.casefold().replace("_", " ").replace("-", " "),
        }
        if normalized in names:
            return option
    choices = ", ".join(option.value for option in enum_type)
    raise ValueError(f"Invalid {enum_type.__name__}; choose {choices}")


def _validation_error(
    message: str,
    translation_key: str,
    placeholders: dict[str, str] | None = None,
) -> ServiceValidationError:
    """Create a user-facing and fully translatable action error."""
    return ServiceValidationError(
        message,
        translation_domain=DOMAIN,
        translation_key=translation_key,
        translation_placeholders=placeholders,
    )


def _matching_area_mapping(
    rooms: tuple[Room, ...], area_registry: ar.AreaRegistry
) -> dict[str, list[str]]:
    """Return deterministic exact-name and unique-alias room mappings."""
    mapping: dict[str, list[str]] = {}
    for room in rooms:
        area = area_registry.async_get_area_by_name(room.name)
        if area is None:
            aliases = area_registry.async_get_areas_by_alias(room.name)
            area = aliases[0] if len(aliases) == 1 else None
        if area is not None:
            mapping.setdefault(area.id, []).append(room.id)
    return mapping


def _segment_signature(segments: list[Segment]) -> SegmentSignature:
    """Return an ordered, comparable room signature."""
    return tuple((segment.id, segment.name, segment.group) for segment in segments)
