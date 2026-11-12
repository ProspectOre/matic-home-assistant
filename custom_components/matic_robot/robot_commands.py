"""Start cleans on the robot: the vacuum's starts and a plan run's legs."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from .area_binding import AreaBindingStatus, area_binding_status
from .client.commands import CleaningMode, CoverageSetting
from .client.exceptions import CoverageGuardError, MaticError
from .client.models import FloorPlan, Room
from .const import DOMAIN, MAX_ROOM_SEQUENCE_SIZE
from .plan_model import (
    plan_area_fingerprint,
    plan_floor_token,
    resolve_room_reference,
    room_cadence_identity,
)
from .stop_return import (
    async_clear_ownerless_stop_if_settled,
    schedule_dock_after_stop,
)

if TYPE_CHECKING:
    from . import MaticConfigEntry, MaticRuntimeData
    from .plans import CleaningPlanManager
    from .session import RobotSession


@dataclass(frozen=True, slots=True, kw_only=True)
class CleanRooms:
    """Start a plan leg's rooms as one native mission the run owns.

    ``rooms`` holds room IDs. ``room_coverage`` and ``room_modes`` are set
    only when the rooms' settings differ.
    """

    rooms: tuple[str, ...]
    cleaning_mode: str
    coverage: str
    ordered: bool
    room_coverage: tuple[str, ...] | None = None
    room_modes: tuple[str, ...] | None = None
    motion_token: int
    session_id: UUID
    floor_token: str


@dataclass(frozen=True, slots=True, kw_only=True)
class CleanPlanArea:
    """Start a plan's custom area as its own native mission the run owns."""

    area_id: str
    fingerprint: str
    cleaning_mode: str
    coverage: str
    motion_token: int
    session_id: UUID
    floor_token: str


type PlanStart = CleanRooms | CleanPlanArea


class RobotCommands:
    """The checks and commands that start a clean, under the plan run's locks.

    ``entity_id`` is the robot's vacuum entity, which stop settlement
    watches; it is None before the vacuum is added.
    """

    def __init__(
        self, hass: HomeAssistant, entry: MaticConfigEntry, entity_id: str | None
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._entity_id = entity_id

    @property
    def _runtime(self) -> MaticRuntimeData:
        return self._entry.runtime_data

    @property
    def _session(self) -> RobotSession:
        return self._entry.runtime_data.session

    @property
    def _plans(self) -> CleaningPlanManager:
        return self._entry.runtime_data.cleaning_plans

    async def async_start_plan_leg(self, command: PlanStart) -> None:
        """Start one leg of a plan run, read as the vacuum reads its command.

        Like a vacuum action, it sends nothing while the robot cannot be
        reached; the run's readback then finds no new task.
        """
        if self._session.error.value is not None:
            return
        params: dict[str, Any] = {
            "cleaning_mode": command.cleaning_mode,
            "coverage": command.coverage,
        }
        if isinstance(command, CleanPlanArea):
            options = self.clean_options(params)
            await self.async_clean_plan_area(
                command.area_id,
                command.fingerprint,
                cleaning_mode=options["cleaning_mode"],
                coverage_setting=options["coverage_setting"],
                motion_token=command.motion_token,
                expected_floor_token=command.floor_token,
                managed_session_id=command.session_id,
            )
            return
        params["ordered"] = command.ordered
        if command.room_coverage is not None:
            params["room_coverage"] = list(command.room_coverage)
        if command.room_modes is not None:
            params["room_modes"] = list(command.room_modes)
        options = self.clean_options(params)
        await self.async_clean_rooms(
            self.resolve_rooms(list(command.rooms)),
            **options,
            motion_token=command.motion_token,
            expected_floor_token=command.floor_token,
            managed_session_id=command.session_id,
        )

    def require_motion_generation(
        self, serial_number: str, generation: int | None
    ) -> None:
        """Reject an old request without clearing a newer Stop's fence."""
        if self._plans.control.motion_generation(serial_number) != generation:
            raise validation_error(
                "The command was superseded before it could run", "command_superseded"
            )

    def require_stop_request_generation(
        self, serial_number: str, generation: int
    ) -> None:
        """Reject a direct request queued before a newer Stop decision."""
        if self._plans.control.stop_request_generation(serial_number) != generation:
            raise validation_error(
                "The command was superseded before it could run", "command_superseded"
            )

    def require_daily_room_dispatch(
        self, floor_plan: FloorPlan, rooms: list[Room], *, tracked: bool
    ) -> None:
        """Keep untracked or exhausted room requests from bypassing limits."""
        serial_number = self._session.info.serial_number
        for room in rooms:
            if not self._plans.cadence.has_daily_limit(serial_number, room.id):
                continue
            try:
                identity = room_cadence_identity(floor_plan, room.id)
            except ValueError:
                identity = None
            state = self._plans.cadence.daily_limit_state(
                serial_number, room.id, identity
            )
            if state["reached"]:
                raise validation_error(
                    "This room has reached its daily cleaning limit or needs review",
                    "daily_room_limit_reached",
                )
            if not tracked:
                raise validation_error(
                    "Use a managed room sequence to respect this room's daily limit",
                    "daily_room_limit_requires_managed",
                )

    async def async_ensure_stop_settled(self, serial_number: str) -> None:
        """Reject new motion while the firmware's graceful STOP is counting down."""
        pending = getattr(self._plans.control, "stop_pending", None)
        if not callable(pending) or not pending(serial_number):
            return
        if self._entity_id is not None and await async_clear_ownerless_stop_if_settled(
            self._hass,
            native_active=self._session.client.async_get_active_cleaning_session_state,
            fresh_state=self._session.client.async_get_state,
            manager=self._plans,
            serial_number=serial_number,
            entity_id=self._entity_id,
        ):
            return
        raise ServiceValidationError(
            "The robot is stopping; wait until it docks",
            translation_domain=DOMAIN,
            translation_key="robot_stop_pending",
        )

    def floor_plan(self) -> FloorPlan:
        floor_plan = self._session.floor.value
        if floor_plan is None or not floor_plan.rooms:
            raise validation_error(
                "The robot's room map is unavailable", "room_plan_unavailable"
            )
        return floor_plan

    def current_floor_plan(self, expected_floor_token: str | None = None) -> FloorPlan:
        """Return only the coherent floor expected by a queued room command."""
        floor_plan = self.floor_plan()
        if not self._runtime.slam_map.floor_plan_is_current(floor_plan) or (
            expected_floor_token is not None
            and plan_floor_token(floor_plan) != expected_floor_token
        ):
            raise validation_error(
                "The robot's room map is unavailable", "room_plan_unavailable"
            )
        return floor_plan

    async def async_clean_rooms(
        self,
        rooms: list[Room],
        *,
        cleaning_mode: CleaningMode | None = None,
        coverage_setting: CoverageSetting | None = None,
        ordered: bool = False,
        motion_token: int | None = None,
        expected_floor_token: str | None = None,
        managed_session_id: UUID | None = None,
        room_coverage: list[CoverageSetting] | None = None,
        room_modes: list[CleaningMode] | None = None,
    ) -> None:
        if (room_coverage is not None or room_modes is not None) and (
            motion_token is None
            or not ordered
            or room_coverage is None
            or room_modes is None
            or len(room_coverage) != len(rooms)
            or len(room_modes) != len(rooms)
            or len(rooms) < 2
        ):
            raise validation_error(
                "Mixed coverage requires an owned ordered plan with per-room settings",
                "mixed_coverage_needs_plan",
            )
        floor_plan = self.current_floor_plan(expected_floor_token)
        self.require_daily_room_dispatch(
            floor_plan, rooms, tracked=motion_token is not None
        )
        command_floor_token = expected_floor_token or plan_floor_token(floor_plan)
        serial_number = self._session.info.serial_number
        request_generation = self._plans.control.motion_generation(serial_number)
        request_stop_generation = self._plans.control.stop_request_generation(
            serial_number
        )
        request_admission_epoch = self._plans.control.command_admission_epoch(
            serial_number
        )
        await self.async_ensure_stop_settled(serial_number)
        self.require_motion_generation(serial_number, request_generation)
        if motion_token is None:
            self.require_stop_request_generation(serial_number, request_stop_generation)
        self._plans.control.require_command_admission(
            serial_number, expected_epoch=request_admission_epoch
        )
        context = (
            self._plans.control.managed_command(serial_number, motion_token)
            if motion_token is not None
            else self._plans.control.external_motion(
                serial_number,
                expected_generation=request_generation,
                expected_stop_generation=request_stop_generation,
            )
        )
        async with context as dispatch_generation:
            if (
                motion_token is None
                and dispatch_generation is None
                and self._plans.control.motion_generation(serial_number)
                == request_generation
            ):
                self.require_stop_request_generation(
                    serial_number, request_stop_generation
                )
            expected_generation = (
                request_generation
                if motion_token is not None or dispatch_generation is None
                else dispatch_generation
            )
            await self.async_ensure_stop_settled(serial_number)
            self.require_motion_generation(serial_number, expected_generation)
            if motion_token is None:
                self.require_stop_request_generation(
                    serial_number, request_stop_generation
                )
            floor_plan = self.current_floor_plan(command_floor_token)

            def require_current_dispatch() -> None:
                self.require_motion_generation(serial_number, expected_generation)
                if motion_token is None:
                    self.require_stop_request_generation(
                        serial_number, request_stop_generation
                    )
                current_floor = self.current_floor_plan(command_floor_token)
                self.require_daily_room_dispatch(
                    current_floor, rooms, tracked=motion_token is not None
                )
                if (
                    motion_token is not None
                    and self._plans.control.cancellation_event(serial_number).is_set()
                ):
                    raise HomeAssistantError(
                        "Managed coverage was stopped before dispatch",
                        translation_domain=DOMAIN,
                        translation_key="coverage_stopped_before_start",
                    )

            receipt = None
            receipt_run_id = self._plans.ledger.active_run_id(serial_number)
            if room_coverage is not None:
                assert room_modes is not None

                def require_owned() -> None:
                    self.require_motion_generation(serial_number, expected_generation)

                stop_fence_run_id: str | None = None

                async def prepare_stop() -> None:
                    nonlocal stop_fence_run_id
                    run_id = self._plans.ledger.active_run_id(serial_number)
                    stop_fence_run_id = run_id
                    try:
                        await self._plans.control.async_mark_stop_pending(
                            serial_number, run_id=run_id
                        )
                    except BaseException:
                        await self._plans.control.async_clear_stop_pending(
                            serial_number, run_id=run_id
                        )
                        raise

                async def rollback_stop() -> None:
                    await self._plans.control.async_clear_stop_pending(
                        serial_number, run_id=stop_fence_run_id
                    )

                def recovery_stop_transmitted() -> None:
                    # The client invokes this only after STOP bytes reached the
                    # transport. Start settlement watching before the partial
                    # dispatch error unwinds to managed-plan cleanup.
                    self.schedule_dock_after_stop(
                        serial_number, run_id=stop_fence_run_id
                    )

                run_id = self._plans.ledger.active_run_id(serial_number)
                try:
                    receipt = await self._session.client.async_start_mixed_coverage(
                        floor_plan,
                        [room.protocol_id for room in rooms],
                        room_coverage,
                        room_modes,
                        first_room_name=rooms[0].name,
                        session_id=managed_session_id,
                        require_current=require_current_dispatch,
                        require_owned=require_owned,
                        prepare_stop=prepare_stop,
                        rollback_stop=rollback_stop,
                        on_recovery_stop_transmitted=recovery_stop_transmitted,
                        checkpoint_initial_session=(
                            partial(
                                self._plans.recovery.async_checkpoint_mixed_session,
                                serial_number,
                                run_id,
                            )
                            if run_id is not None
                            else None
                        ),
                    )
                except CoverageGuardError as err:
                    raise ServiceValidationError(
                        err.safe_message,
                        translation_domain=DOMAIN,
                        translation_key=err.reason_code,
                    ) from err
                except (MaticError, TimeoutError) as err:
                    raise HomeAssistantError(
                        "Mixed coverage dispatch could not be verified",
                        translation_domain=DOMAIN,
                        translation_key="coverage_start_unconfirmed",
                    ) from err
            else:
                command_rooms = [room.protocol_id for room in rooms]
                mode = cleaning_mode or self._runtime.cleaning_mode
                setting = coverage_setting or self._runtime.coverage_setting
                if motion_token is not None:
                    receipt = await self._session.client.async_start_coverage(
                        floor_plan,
                        command_rooms,
                        cleaning_mode=mode,
                        coverage_setting=setting,
                        ordered=ordered,
                        require_settings_readback=True,
                        session_id=managed_session_id,
                        require_current=require_current_dispatch,
                    )
                else:
                    # Direct HA starts have no managed cadence accounting. Own
                    # their UUID before transmission so later history cannot
                    # mistake them for an app-started cleaning.
                    direct_session_id = uuid4()
                    await self._plans.ledger.async_claim_native_session(
                        serial_number, str(direct_session_id)
                    )
                    require_current_dispatch()
                    await self._session.client.async_start_coverage(
                        floor_plan,
                        command_rooms,
                        cleaning_mode=mode,
                        coverage_setting=setting,
                        ordered=ordered,
                        session_id=direct_session_id,
                        require_current=require_current_dispatch,
                    )
            if (
                receipt is not None
                and motion_token is not None
                and receipt_run_id is not None
                and managed_session_id is not None
            ):
                require_current_dispatch()
                await self._plans.recovery.async_checkpoint_coverage_receipt(
                    serial_number,
                    receipt_run_id,
                    receipt,
                    floor_plan=floor_plan,
                    room_ids=[room.id for room in rooms],
                    session_id=managed_session_id,
                )
            await self._session.heartbeat.async_request_refresh()

    async def async_clean_plan_area(
        self,
        area_id: str,
        fingerprint: str,
        *,
        cleaning_mode: CleaningMode,
        coverage_setting: CoverageSetting,
        motion_token: int,
        expected_floor_token: str,
        managed_session_id: UUID,
    ) -> None:
        """Start one managed plan's custom area as its own owned mission.

        The area is checked again under the managed command lock: it must
        still be the geometry the run was prepared with, on the current map.
        """
        serial_number = self._session.info.serial_number
        request_generation = self._plans.control.motion_generation(serial_number)
        request_admission_epoch = self._plans.control.command_admission_epoch(
            serial_number
        )
        await self.async_ensure_stop_settled(serial_number)
        self.require_motion_generation(serial_number, request_generation)
        self._plans.control.require_command_admission(
            serial_number, expected_epoch=request_admission_epoch
        )
        async with self._plans.control.managed_command(serial_number, motion_token):
            await self.async_ensure_stop_settled(serial_number)
            self.require_motion_generation(serial_number, request_generation)
            floor_plan = self.current_floor_plan(expected_floor_token)
            area = self._plans.catalog.areas(serial_number).get(area_id)
            if not isinstance(area, dict):
                raise validation_error(
                    "A custom area in this plan was deleted", "plan_area_missing"
                )
            if (
                plan_area_fingerprint(area) != fingerprint
                or area_binding_status(area, floor_plan)
                is not AreaBindingStatus.CURRENT
            ):
                raise validation_error(
                    "A custom area in this plan changed or is not on this map",
                    "area_map_changed",
                )
            try:
                circles = [
                    (float(c["x"]), float(c["y"]), float(c["radius"]))
                    for c in area["circles"]
                ]
            except (KeyError, TypeError, ValueError) as err:
                raise validation_error(
                    "The saved custom area is invalid", "invalid_area"
                ) from err

            def require_current_dispatch() -> None:
                self.require_motion_generation(serial_number, request_generation)
                self.current_floor_plan(expected_floor_token)
                if self._plans.control.cancellation_event(serial_number).is_set():
                    raise HomeAssistantError(
                        "Managed coverage was stopped before dispatch",
                        translation_domain=DOMAIN,
                        translation_key="coverage_stopped_before_start",
                    )

            try:
                await self._session.client.async_start_custom_coverage(
                    floor_plan,
                    circles,
                    cleaning_mode=cleaning_mode,
                    coverage_setting=coverage_setting,
                    session_id=managed_session_id,
                    require_current=require_current_dispatch,
                )
            except CoverageGuardError as err:
                raise ServiceValidationError(
                    err.safe_message,
                    translation_domain=DOMAIN,
                    translation_key=err.reason_code,
                ) from err
            except (MaticError, ValueError) as err:
                raise HomeAssistantError(
                    "The robot could not start the custom-area clean",
                    translation_domain=DOMAIN,
                    translation_key="robot_command_failed",
                ) from err
            await self._session.heartbeat.async_request_refresh()

    def schedule_dock_after_stop(
        self, serial_number: str, *, run_id: str | None = None
    ) -> None:
        """Dock the robot as soon as its accepted stop settles."""
        if self._entity_id is None:
            return
        on_docked: Callable[[], Awaitable[bool | None]] | None = None
        if run_id is not None:
            stop_fence_token_reader = getattr(
                self._plans.control, "stop_fence_token", None
            )
            stop_fence_token = (
                stop_fence_token_reader(serial_number)
                if callable(stop_fence_token_reader)
                else None
            )

            async def mark_docked() -> bool:
                return await self._plans.ledger.async_mark_run_docked(
                    serial_number,
                    run_id,
                    entity_id=self._entity_id,
                    stop_fence_token=stop_fence_token,
                )

            on_docked = mark_docked
        schedule_dock_after_stop(
            self._hass,
            client=self._session.client,
            refresh=self._session.heartbeat.async_request_refresh,
            manager=self._plans,
            serial_number=serial_number,
            entity_id=self._entity_id,
            run_id=run_id,
            set_run_id=getattr(
                getattr(self._session.client, "activity_journal", None),
                "set_run_id",
                None,
            ),
            get_run_id=getattr(
                getattr(self._session.client, "activity_journal", None),
                "current_run_id",
                None,
            ),
            on_docked=on_docked,
        )

    def resolve_rooms(self, identifiers: list[str]) -> list[Room]:
        if not identifiers:
            raise validation_error("Select at least one Matic room", "no_rooms")
        if len(identifiers) > MAX_ROOM_SEQUENCE_SIZE:
            raise validation_error(
                f"Select at most {MAX_ROOM_SEQUENCE_SIZE} rooms at a time",
                "room_sequence_limit",
                {"limit": str(MAX_ROOM_SEQUENCE_SIZE)},
            )
        rooms = self.floor_plan().rooms
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
            raise validation_error(
                f"Unknown Matic room(s): {invalid_names}",
                "unknown_rooms",
                {"rooms": invalid_names},
            )
        return resolved

    def clean_options(
        self, params: dict[str, Any] | list[Any] | None
    ) -> dict[str, Any]:
        if not isinstance(params, dict):
            return {}
        runtime = self._runtime
        try:
            mode = enum_option(
                CleaningMode, params.get("cleaning_mode", runtime.cleaning_mode)
            )
            coverage = enum_option(
                CoverageSetting, params.get("coverage", runtime.coverage_setting)
            )
        except ValueError as err:
            raise validation_error(
                str(err), "invalid_cleaning_option", {"error": str(err)}
            ) from err
        ordered = params.get("ordered", False)
        if not isinstance(ordered, bool):
            raise validation_error(
                "ordered must be true or false", "ordered_must_be_boolean"
            )
        result = {
            "cleaning_mode": mode,
            "coverage_setting": coverage,
            "ordered": ordered,
        }
        for key in ("room_coverage", "room_modes"):
            if key in params:
                values = params[key]
                if not isinstance(values, list):
                    raise validation_error(
                        f"{key} must be a list", "invalid_room_setting"
                    )
                try:
                    result[key] = [
                        enum_option(CoverageSetting, value)
                        if key == "room_coverage"
                        else enum_option(CleaningMode, value)
                        for value in values
                    ]
                except ValueError as err:
                    raise validation_error(
                        "Invalid per-room setting", "invalid_room_setting"
                    ) from err
        return result


_OPTION_LABELS: dict[type[CleaningMode | CoverageSetting], str] = {
    CleaningMode: "Cleaning mode",
    CoverageSetting: "Vacuum coverage",
}


def enum_option[CleaningOptionT: (CleaningMode, CoverageSetting)](
    enum_type: type[CleaningOptionT], value: Any
) -> CleaningOptionT:
    if isinstance(value, enum_type):
        return value
    if isinstance(value, str):
        normalized = value.strip().casefold().replace("_", " ").replace("-", " ")
        for option in enum_type:
            names = {
                option.name.casefold().replace("_", " "),
                option.value.casefold().replace("_", " ").replace("-", " "),
            }
            if normalized in names:
                return option
    choices = ", ".join(option.value for option in enum_type)
    raise ValueError(f"{_OPTION_LABELS[enum_type]} must be one of: {choices}.")


def validation_error(
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
