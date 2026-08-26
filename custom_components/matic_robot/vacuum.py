"""Vacuum controls for Matic Hermes."""

from __future__ import annotations

from dataclasses import asdict
from hashlib import sha256
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
from .plans import PLAN_MOTION_TOKEN, resolve_room_reference
from .stop_return import schedule_dock_after_stop

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

_FLOOR_SCOPE_OPTION = "matic_floor_scope"
_FLOOR_CATALOGS_OPTION = "matic_floor_catalogs"
_UNSCOPED_CATALOG_OPTION = "matic_unscoped_catalog"
_FLOOR_SCOPE_DOMAIN = b"matic-vacuum-floor-segments-v1\0"
_MAX_FLOOR_CATALOGS = 12


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
    _unrecorded_attributes = frozenset(
        {"matic_entry_id", "rooms", "current_area", "previous_area"}
    )

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self.coordinator.data.info.serial_number}_vacuum"
        self._reported_segment_change: SegmentSignature | None = None
        self._plans = entry.runtime_data.cleaning_plans

    async def async_added_to_hass(self) -> None:
        """Auto-link unconfigured robot rooms to matching Home Assistant Areas."""
        await super().async_added_to_hass()
        self._async_check_segment_changes()
        self._async_auto_map_rooms()

    @callback
    def _handle_coordinator_update(self) -> None:
        """Detect room changes and retry safe exact-name auto-mapping."""
        self._async_check_segment_changes()
        self._async_auto_map_rooms()
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
            "matic_entry_id": self._config_entry.entry_id,
            "low_charge": state.low_charge,
            "problem": bool(state.error_codes),
            "current_area": state.current_area,
            "previous_area": state.previous_area,
            "rooms": (
                {room.id: room.name for room in floor_plan.rooms}
                if floor_plan is not None
                else {}
            ),
        }

    async def _async_command(
        self, command: UserCommand, *, replace_plan: bool = False
    ) -> None:
        """Serialize a user command and immediately refresh state."""
        serial_number = self.coordinator.data.info.serial_number
        if command is not UserCommand.STOP:
            await self._async_ensure_stop_settled(serial_number)
        context = (
            self._plans.external_motion(serial_number)
            if replace_plan
            else self._plans.command_lock(serial_number)
        )
        async with context:
            if command is not UserCommand.STOP:
                await self._async_ensure_stop_settled(serial_number)
            await self.coordinator.client.async_send_user_command(command)
            if command is UserCommand.STOP:
                await self._plans.async_mark_stop_pending(serial_number)
            await self.coordinator.async_request_refresh()
        if command is UserCommand.STOP:
            self._schedule_dock_after_stop(serial_number)

    async def _async_ensure_stop_settled(self, serial_number: str) -> None:
        """Reject new motion while the firmware's graceful STOP is counting down."""
        pending = getattr(self._plans, "stop_pending", None)
        if not callable(pending) or not pending(serial_number):
            return
        if self.activity in {VacuumActivity.DOCKED, VacuumActivity.IDLE}:
            await self._plans.async_clear_stop_pending(serial_number)
            return
        raise ServiceValidationError(
            "Matic is completing its OEM stop countdown; wait until it docks",
            translation_domain=DOMAIN,
            translation_key="robot_stop_pending",
        )

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
        motion_token: int | None = None,
    ) -> None:
        floor_plan = self._floor_plan()
        serial_number = self.coordinator.data.info.serial_number
        await self._async_ensure_stop_settled(serial_number)
        context = (
            self._plans.managed_command(serial_number, motion_token)
            if motion_token is not None
            else self._plans.external_motion(serial_number)
        )
        async with context:
            await self._async_ensure_stop_settled(serial_number)
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
        """Stop now or finish the active room according to the plan policy."""
        decision = self._plans.request_stop(self.coordinator.data.info.serial_number)
        if decision.behavior == "after_room":
            return
        self.coordinator.async_discard_current_room()
        await self._async_command(UserCommand.STOP, replace_plan=True)

    async def async_return_to_base(self, **kwargs: object) -> None:
        """Send the robot to its dock and end any task driving it."""
        serial_number = self.coordinator.data.info.serial_number
        operational = self.coordinator.data.operational
        stop_before_dock = self._plans.has_managed_task(
            serial_number
        ) or self.activity in {
            VacuumActivity.CLEANING,
            VacuumActivity.ERROR,
            VacuumActivity.PAUSED,
            VacuumActivity.RETURNING,
        }
        stop_before_dock = stop_before_dock or (
            operational.low_charge and operational.is_charging
        )
        async with self._plans.external_motion(serial_number):
            if stop_before_dock:
                # STOP is the OEM final-return command, and DOCK sent while the
                # task still runs is reinterpreted as recharge-and-resume, so
                # STOP owns the end of the task.  A watcher then docks the robot
                # as soon as that task actually settles instead of waiting out
                # firmware's ten-minute countdown.
                self.coordinator.async_discard_current_room()
                await self.coordinator.client.async_send_user_command(UserCommand.STOP)
                await self._plans.async_mark_stop_pending(serial_number)
                await self.coordinator.async_request_refresh()
                stopped = True
            else:
                await self.coordinator.client.async_send_user_command(UserCommand.DOCK)
                await self.coordinator.async_request_refresh()
                stopped = False
        if stopped:
            self._schedule_dock_after_stop(serial_number)

    def _schedule_dock_after_stop(self, serial_number: str) -> None:
        """Dock the robot as soon as its accepted stop settles."""
        if self.entity_id is None:
            return
        schedule_dock_after_stop(
            self.hass,
            client=self.coordinator.client,
            refresh=self.coordinator.async_request_refresh,
            manager=self._plans,
            serial_number=serial_number,
            entity_id=self.entity_id,
        )

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
        scope = _floor_scope(self.coordinator.data.floor_plan)
        stored_scope = options.get(_FLOOR_SCOPE_OPTION)
        if isinstance(stored_scope, str) and stored_scope != scope:
            return
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
        options[_FLOOR_SCOPE_OPTION] = scope
        catalogs = _floor_catalogs(options)
        catalogs[scope] = _catalog_from_options(options)
        options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(catalogs, scope)
        entity_registry.async_update_entity_options(self.entity_id, "vacuum", options)

    @callback
    def _async_check_segment_changes(self) -> None:
        """Separate expected floor swaps from real same-floor room changes."""
        floor_plan = self.coordinator.data.floor_plan
        if self.entity_id is None or floor_plan is None:
            return
        entity_registry = er.async_get(self.hass)
        if (entity_entry := entity_registry.async_get(self.entity_id)) is None:
            return
        options = dict(entity_entry.options.get("vacuum", {}))
        current = self._current_segments()
        signature = _segment_signature(current)
        current_payload = [asdict(segment) for segment in current]
        current_scope = _floor_scope(floor_plan)
        stored_scope = options.get(_FLOOR_SCOPE_OPTION)
        configured = _segments_from_payload(options.get("last_seen_segments"))
        catalogs = _floor_catalogs(options)

        if not isinstance(stored_scope, str):
            if configured is not None and _segment_signature(configured) != signature:
                options[_UNSCOPED_CATALOG_OPTION] = _catalog_from_options(options)
                options.pop("area_mapping", None)
            options["last_seen_segments"] = current_payload
            options[_FLOOR_SCOPE_OPTION] = current_scope
            catalogs[current_scope] = _catalog_from_options(options)
            options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(
                catalogs, current_scope
            )
            entity_registry.async_update_entity_options(
                self.entity_id, "vacuum", options
            )
            self._reported_segment_change = None
            return

        if stored_scope != current_scope:
            if configured is not None:
                catalogs[stored_scope] = _catalog_from_options(options)
            target = catalogs.get(current_scope)
            unscoped = options.get(_UNSCOPED_CATALOG_OPTION)
            if target is None and isinstance(unscoped, dict):
                legacy_segments = _segments_from_payload(
                    unscoped.get("last_seen_segments")
                )
                if (
                    legacy_segments is not None
                    and _segment_signature(legacy_segments) == signature
                ):
                    target = dict(unscoped)
                    options.pop(_UNSCOPED_CATALOG_OPTION, None)
            if target is None:
                target = {"last_seen_segments": current_payload}
            catalogs[current_scope] = target
            _activate_floor_catalog(options, current_scope, target)
            options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(
                catalogs, current_scope
            )
            entity_registry.async_update_entity_options(
                self.entity_id, "vacuum", options
            )
            self._reported_segment_change = None
            return

        if configured is None:
            options["last_seen_segments"] = current_payload
            catalogs[current_scope] = _catalog_from_options(options)
            options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(
                catalogs, current_scope
            )
            entity_registry.async_update_entity_options(
                self.entity_id, "vacuum", options
            )
            self._reported_segment_change = None
            return

        if _segment_signature(configured) == signature:
            current_catalog = _catalog_from_options(options)
            if catalogs.get(current_scope) != current_catalog:
                catalogs[current_scope] = current_catalog
                options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(
                    catalogs, current_scope
                )
                entity_registry.async_update_entity_options(
                    self.entity_id, "vacuum", options
                )
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
        if normalized == "stop":
            await self.async_stop()
            return
        if normalized in {"dock", "return_home"}:
            await self.async_return_to_base()
            return
        simple_commands = {
            "pause": UserCommand.PAUSE,
            "resume": UserCommand.RESUME,
        }
        if normalized in simple_commands:
            await self._async_command(simple_commands[normalized])
            return
        if normalized in {"clean_all", "start"}:
            options = self._clean_options(params)
            options["motion_token"] = self._motion_token(params)
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
            options["motion_token"] = self._motion_token(params)
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
        room_map = {room.id: room.name for room in rooms}
        rooms_by_id = {room.id: room for room in rooms}
        resolved: list[Room] = []
        invalid: list[str] = []
        for identifier in identifiers:
            try:
                room_id, _room_name = resolve_room_reference(identifier, room_map)
            except ValueError as err:
                invalid.append(str(err))
                continue
            room = rooms_by_id[room_id]
            if room not in resolved:
                resolved.append(room)
        if invalid:
            invalid_names = ", ".join(invalid)
            raise _validation_error(
                f"Unknown Matic room(s): {invalid_names}",
                "unknown_rooms",
                {"rooms": invalid_names},
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

    @staticmethod
    def _motion_token(params: dict[str, Any] | list[Any] | None) -> int | None:
        """Read the integration-private generation marker from a plan command."""
        if not isinstance(params, dict) or PLAN_MOTION_TOKEN not in params:
            return None
        token = params[PLAN_MOTION_TOKEN]
        if not isinstance(token, int) or isinstance(token, bool):
            raise _validation_error(
                "The managed plan command token is invalid", "invalid_plan_command"
            )
        return token


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


def _floor_scope(floor_plan: FloorPlan) -> str:
    """Return a private stable token for one robot partition."""
    identity = floor_plan.partition_id_wire or floor_plan.partition_protocol_id.encode()
    return sha256(_FLOOR_SCOPE_DOMAIN + identity).hexdigest()[:24]


def _segments_from_payload(value: object) -> list[Segment] | None:
    """Decode Home Assistant's stored segment payload defensively."""
    if not isinstance(value, list):
        return None
    segments: list[Segment] = []
    for item in value:
        if not isinstance(item, dict):
            return None
        segment_id = item.get("id")
        name = item.get("name")
        group = item.get("group")
        if (
            not isinstance(segment_id, str)
            or not isinstance(name, str)
            or (group is not None and not isinstance(group, str))
        ):
            return None
        segments.append(Segment(segment_id, name, group))
    return segments


def _catalog_from_options(options: dict[str, Any]) -> dict[str, Any]:
    """Copy the active floor's HA-native mapping fields into its catalog."""
    catalog: dict[str, Any] = {
        "last_seen_segments": list(options.get("last_seen_segments", []))
    }
    if isinstance(options.get("area_mapping"), dict):
        catalog["area_mapping"] = dict(options["area_mapping"])
    return catalog


def _floor_catalogs(options: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return only structurally valid private floor catalogs."""
    raw = options.get(_FLOOR_CATALOGS_OPTION)
    if not isinstance(raw, dict):
        return {}
    return {
        scope: dict(catalog)
        for scope, catalog in raw.items()
        if isinstance(scope, str) and isinstance(catalog, dict)
    }


def _bounded_floor_catalogs(
    catalogs: dict[str, dict[str, Any]], current_scope: str
) -> dict[str, dict[str, Any]]:
    """Keep a bounded catalog while always retaining the active floor."""
    ordered = {
        scope: catalog for scope, catalog in catalogs.items() if scope != current_scope
    }
    ordered[current_scope] = catalogs[current_scope]
    while len(ordered) > _MAX_FLOOR_CATALOGS:
        ordered.pop(next(iter(ordered)))
    return ordered


def _activate_floor_catalog(
    options: dict[str, Any], scope: str, catalog: dict[str, Any]
) -> None:
    """Swap HA's single active mapping view to one known floor catalog."""
    segments = _segments_from_payload(catalog.get("last_seen_segments"))
    options["last_seen_segments"] = [asdict(segment) for segment in (segments or [])]
    mapping = catalog.get("area_mapping")
    if isinstance(mapping, dict):
        options["area_mapping"] = dict(mapping)
    else:
        options.pop("area_mapping", None)
    options[_FLOOR_SCOPE_OPTION] = scope


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
