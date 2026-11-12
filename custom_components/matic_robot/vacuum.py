"""Vacuum controls for Matic Hermes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from typing import Any
from uuid import UUID

from homeassistant.components.vacuum import Segment, StateVacuumEntity
from homeassistant.components.vacuum.const import VacuumActivity, VacuumEntityFeature
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.commands import (
    CleaningMode,
    CoverageSetting,
    QueueAction,
    QueueChangeError,
    UserCommand,
)
from .client.exceptions import (
    MaticError,
    SinkLocationUnavailableError,
)
from .client.models import FloorPlan, RobotActivity, Room
from .const import DOMAIN
from .entity import MaticEntity
from .photo_patrol import ensure_current_room_allows_photo
from .plan_model import (
    PLAN_FLOOR_TOKEN,
    PLAN_MOTION_TOKEN,
    PLAN_SESSION_ID,
    plan_floor_token,
    resolve_room_reference,
)
from .robot_commands import RobotCommands, enum_option, validation_error
from .stores import Store
from .vacuum_catalog import FloorSegmentCatalog

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

_EMOTES = {
    "nod": UserCommand.EMOTE_NOD,
    "shake": UserCommand.EMOTE_SHAKE,
    "pirouette": UserCommand.EMOTE_PIROUETTE,
    "snap": UserCommand.EMOTE_SNAP,
}


# Sends one resolved navigation command for the floor current at send time.
type _Navigation = Callable[[FloorPlan], Awaitable[None]]


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
        {
            "matic_entry_id",
            "rooms",
            "current_area",
            "previous_area",
            "cleaning_phase",
            "run_progress",
            "time_remaining",
        }
    )

    def __init__(self, entry: MaticConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{self.session.info.serial_number}_vacuum"
        self._segment_catalog = FloorSegmentCatalog()
        self._plans = entry.runtime_data.cleaning_plans

    async def async_added_to_hass(self) -> None:
        """Auto-link unconfigured robot rooms to matching Home Assistant Areas."""
        await super().async_added_to_hass()
        self._sync_segments()

    def _stores(self) -> Iterable[Store[Any]]:
        return (self.session.state, self.session.floor, self.session.progress)

    @callback
    def _handle_store_update(self) -> None:
        self._sync_segments()
        super()._handle_store_update()

    def _sync_segments(self) -> None:
        """Detect room changes and retry safe exact-name auto-mapping."""
        floor_plan = self.session.floor.value
        self._segment_catalog.reconcile(
            self.hass, self.entity_id, floor_plan, self.async_create_segments_issue
        )
        self._segment_catalog.auto_map(self.hass, self.entity_id, floor_plan)

    @property
    def activity(self) -> VacuumActivity:
        """Return the verified high-level robot activity."""
        return ACTIVITY_MAP[self.session.state.value.operational.activity]

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        """Expose compact verified status for automations and templates."""
        state = self.session.state.value.operational
        floor_plan = self.session.floor.value
        progress = self.session.progress.value
        return {
            "matic_entry_id": self._config_entry.entry_id,
            "low_charge": state.low_charge,
            "recharge_and_resume": state.recharge_and_resume,
            "current_area": state.current_area,
            "previous_area": state.previous_area,
            "cleaning_phase": state.cleaning_phase,
            "run_progress": progress.percent if progress is not None else None,
            "time_remaining": (
                progress.remaining_seconds if progress is not None else None
            ),
            "rooms": (
                {room.id: room.name for room in floor_plan.rooms}
                if floor_plan is not None
                else {}
            ),
        }

    @property
    def _commands(self) -> RobotCommands:
        """The clean starts and checks this vacuum shares with plan runs."""
        return RobotCommands(self.hass, self._config_entry, self.entity_id)

    def _require_no_pending_stop_dispatch(self, serial_number: str) -> None:
        """Keep RESUME out of the gap between Stop acceptance and dispatch."""
        pending = getattr(self._plans.control, "stop_dispatch_pending", None)
        if callable(pending) and pending(serial_number) is True:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="robot_stop_pending",
            )

    async def _async_command(self, command: UserCommand) -> None:
        """Serialize a user command and immediately refresh state."""
        serial_number = self.session.info.serial_number
        if command is UserCommand.RESUME:
            self._require_no_pending_stop_dispatch(serial_number)
        generation = self._plans.control.motion_generation(serial_number)
        stop_request_generation = self._plans.control.stop_request_generation(
            serial_number
        )
        admission_epoch = self._plans.control.command_admission_epoch(serial_number)
        self._plans.control.require_command_admission(serial_number)
        await self._commands.async_ensure_stop_settled(serial_number)
        self._plans.control.require_command_admission(
            serial_number, expected_epoch=admission_epoch
        )
        async with self._plans.control.external_command(serial_number):
            if command is UserCommand.RESUME:
                self._require_no_pending_stop_dispatch(serial_number)
            await self._commands.async_ensure_stop_settled(serial_number)
            self._commands.require_motion_generation(serial_number, generation)
            self._commands.require_stop_request_generation(
                serial_number, stop_request_generation
            )
            await self._async_dispatch_admitted_command(command, run_id=None)

    async def _async_dispatch_admitted_command(
        self, command: UserCommand, *, run_id: str | None
    ) -> None:
        """Dispatch a command while the caller owns its command-lock lease."""
        serial_number = self.session.info.serial_number
        await self.session.client.async_send_user_command(command)
        if command is UserCommand.STOP:
            await self._plans.control.async_mark_stop_pending(
                serial_number, run_id=run_id
            )
        await self.session.heartbeat.async_request_refresh()

    async def async_start(self, **kwargs: object) -> None:
        """Resume a paused task or start a full-floor clean."""
        if self.session.state.value.operational.paused:
            await self._async_command(UserCommand.RESUME)
            return
        await self._commands.async_clean_rooms(list(self._commands.floor_plan().rooms))

    async def async_pause(self, **kwargs: object) -> None:
        """Pause the current task."""
        await self._async_command(UserCommand.PAUSE)

    async def async_stop(self, **kwargs: object) -> None:
        """Stop now or finish the active room according to the plan policy."""
        serial_number = self.session.info.serial_number
        run_id: str | None = None
        async with self._plans.control.external_command(serial_number):
            active_run_id = getattr(self._plans.ledger, "active_run_id", None)
            run_id = active_run_id(serial_number) if callable(active_run_id) else None
            decision = self._plans.control.request_stop(serial_number)
            expected_generation = self._plans.control.motion_generation(serial_number)
            expected_stop_generation = self._plans.control.stop_request_generation(
                serial_number
            )
            await self._plans.recovery.async_checkpoint_stop_intent(
                serial_number, decision.behavior, run_id=run_id
            )
            if decision.behavior == "after_room" or (
                self._plans.control.motion_generation(serial_number)
                != expected_generation
                or self._plans.control.stop_request_generation(serial_number)
                != expected_stop_generation
            ):
                return
            with self._plans.control.managed_stop_dispatch(serial_number):
                generation = await self._plans.control.async_replace_managed_motion(
                    serial_number
                )
            self._commands.require_motion_generation(serial_number, generation)
            self._commands.require_stop_request_generation(
                serial_number, expected_stop_generation
            )
            self.session.heartbeat.async_discard_current_room()
            await self._async_dispatch_admitted_command(UserCommand.STOP, run_id=run_id)
        self._commands.schedule_dock_after_stop(serial_number, run_id=run_id)

    async def async_return_to_base(self, **kwargs: object) -> None:
        """Send the robot to its dock and end any task driving it."""
        serial_number = self.session.info.serial_number
        active_run_id = getattr(self._plans.ledger, "active_run_id", None)
        run_id = active_run_id(serial_number) if callable(active_run_id) else None
        operational = self.session.state.value.operational
        # Display activity gives charging precedence; native task flags still
        # require STOP so DOCK cannot resume retained cleaning or paused work.
        stop_before_dock = (
            self._plans.control.has_managed_task(serial_number)
            or operational.cleaning
            or operational.paused
            or operational.returning
            or (bool(operational.error_codes) and not operational.is_charging)
            or (operational.low_charge and operational.is_charging)
        )
        managed_stop_generations = getattr(
            self._plans.control, "managed_stop_dispatch_generations", None
        )
        expected_generations = (
            managed_stop_generations(serial_number)
            if callable(managed_stop_generations)
            else None
        )
        expected_generation = (
            expected_generations[0]
            if expected_generations is not None
            else self._plans.control.motion_generation(serial_number)
        )
        stop_request_generation = (
            expected_generations[1]
            if expected_generations is not None
            else self._plans.control.stop_request_generation(serial_number)
        )
        async with self._plans.control.external_motion(
            serial_number,
            expected_generation=expected_generation,
            expected_stop_generation=stop_request_generation,
        ) as generation:
            if generation is None:
                if expected_generations is None:
                    self._commands.require_stop_request_generation(
                        serial_number, stop_request_generation
                    )
                    self._commands.require_motion_generation(
                        serial_number, expected_generation
                    )
                return
            self._commands.require_motion_generation(serial_number, generation)
            self._commands.require_stop_request_generation(
                serial_number, stop_request_generation
            )
            if stop_before_dock:
                # STOP is the OEM final-return command, and DOCK sent while the
                # task still runs is reinterpreted as recharge-and-resume, so
                # STOP owns the end of the task.  A watcher then docks the robot
                # as soon as that task actually settles instead of waiting out
                # firmware's ten-minute countdown.
                self.session.heartbeat.async_discard_current_room()
                await self.session.client.async_send_user_command(UserCommand.STOP)
                await self._plans.control.async_mark_stop_pending(
                    serial_number, run_id=run_id
                )
                await self.session.heartbeat.async_request_refresh()
                stopped = True
            else:
                await self.session.client.async_send_user_command(UserCommand.DOCK)
                await self.session.heartbeat.async_request_refresh()
                stopped = False
        if stopped:
            self._commands.schedule_dock_after_stop(serial_number, run_id=run_id)

    async def async_sink_summon(self) -> None:
        """Send the robot to its saved sink location to await a refill."""

        async def resolve(floor_plan: FloorPlan) -> _Navigation:
            try:
                posture = await self.session.client.async_get_sink_posture(floor_plan)
            except SinkLocationUnavailableError as err:
                raise validation_error(
                    "No sink location is saved for this floor",
                    "sink_location_unavailable",
                ) from err
            except (MaticError, ValueError) as err:
                raise _navigation_failed("sink") from err
            return lambda current: self.session.client.async_sink_summon(
                current, posture
            )

        await self._async_navigate(
            resolve, destination="sink", task_changed=_sink_task_changed
        )

    async def async_redo_last_clean(self) -> None:
        """Clean the most recent finished clean again, as the Matic app does."""
        serial_number = self.session.info.serial_number
        if self._plans.cadence.has_any_daily_limit(serial_number):
            raise validation_error(
                "Use a managed room sequence to respect room daily limits",
                "daily_room_limit_requires_managed",
            )
        request_generation = self._plans.control.motion_generation(serial_number)
        request_stop_generation = self._plans.control.stop_request_generation(
            serial_number
        )
        request_admission_epoch = self._plans.control.command_admission_epoch(
            serial_number
        )
        await self._commands.async_ensure_stop_settled(serial_number)
        self._commands.require_motion_generation(serial_number, request_generation)
        self._commands.require_stop_request_generation(
            serial_number, request_stop_generation
        )
        self._plans.control.require_command_admission(
            serial_number, expected_epoch=request_admission_epoch
        )
        if self._holds_task():
            raise validation_error(
                "The robot is busy; clean again starts only from the dock or idle",
                "redo_robot_busy",
            )
        try:
            records = await self.session.client.async_get_cleaning_session_records()
        except MaticError as err:
            raise HomeAssistantError(
                "The robot's cleaning history could not be read",
                translation_domain=DOMAIN,
                translation_key="robot_command_failed",
            ) from err
        # A record with no end time is a clean still open on the robot.
        finished = [record for record in records if record.session.ended_at]
        if not finished:
            raise validation_error(
                "The robot has no finished clean to repeat", "redo_no_previous_clean"
            )
        latest = max(finished, key=lambda item: item.session.ended_at or "")
        # Like any direct clean, the new clean takes ownership from a plan.
        async with self._plans.control.external_motion(
            serial_number,
            expected_generation=request_generation,
            expected_stop_generation=request_stop_generation,
        ) as generation:
            await self._commands.async_ensure_stop_settled(serial_number)
            self._commands.require_motion_generation(serial_number, generation)
            self._commands.require_stop_request_generation(
                serial_number, request_stop_generation
            )
            if self._holds_task():
                raise validation_error(
                    "The robot started a task before clean again was sent",
                    "redo_robot_busy",
                )
            if self._plans.cadence.has_any_daily_limit(serial_number):
                raise validation_error(
                    "Use a managed room sequence to respect room daily limits",
                    "daily_room_limit_requires_managed",
                )
            try:
                await self.session.client.async_redo_clean(latest.key)
            except (MaticError, ValueError) as err:
                raise HomeAssistantError(
                    "The robot could not clean again",
                    translation_domain=DOMAIN,
                    translation_key="robot_command_failed",
                ) from err
            await self.session.heartbeat.async_request_refresh()

    async def async_go_to_room(self, room: str) -> None:
        """Send the robot to one named room on this floor without cleaning it."""

        async def resolve(floor_plan: FloorPlan) -> _Navigation:
            target = _resolve_one_room(room, floor_plan)
            return lambda current: self.session.client.async_go_to_room(current, target)

        await self._async_navigate(
            resolve, destination="room", task_changed=_room_task_changed
        )

    async def async_change_queue(
        self,
        action: QueueAction,
        room: str,
        *,
        cleaning_mode: CleaningMode | None = None,
        coverage_setting: CoverageSetting | None = None,
    ) -> None:
        """Skip, bring forward or repeat a room in the clean that is running."""
        serial_number = self.session.info.serial_number
        floor_plan = self._commands.current_floor_plan()
        target = _resolve_one_room(room, floor_plan)
        if not self.session.state.value.operational.cleaning:
            raise _queue_error("no_clean_running", target)
        # The robot keeps the task, so the plan run driving it keeps ownership.
        async with self._plans.control.external_command(serial_number):
            if not self.session.state.value.operational.cleaning:
                raise _queue_error("no_clean_running", target)
            if action is not QueueAction.SKIP:
                self._commands.require_daily_room_dispatch(
                    self._commands.current_floor_plan(plan_floor_token(floor_plan)),
                    [target],
                    tracked=False,
                )
            try:
                await self.session.client.async_change_queue(
                    self._commands.current_floor_plan(plan_floor_token(floor_plan)),
                    action,
                    target,
                    cleaning_mode=cleaning_mode,
                    coverage_setting=coverage_setting,
                )
            except QueueChangeError as err:
                raise _queue_error(err.reason, target) from err
            except (MaticError, ValueError) as err:
                raise HomeAssistantError(
                    f"The robot did not take the change to {target.name}",
                    translation_domain=DOMAIN,
                    translation_key="queue_change_failed",
                    translation_placeholders={"room": target.name},
                ) from err
        run_id = self._plans.ledger.active_run_id(serial_number)
        if action is QueueAction.SKIP and run_id is not None:
            await self._plans.ledger.async_note_room_skipped(
                serial_number, run_id, target.id
            )
        self.hass.bus.async_fire(
            f"{DOMAIN}_queue_changed",
            {
                ATTR_ENTITY_ID: self.entity_id,
                "action": action.value,
                "room_id": target.id,
                "room": target.name,
                "run_id": run_id,
            },
        )
        await self.session.heartbeat.async_request_refresh()

    async def _async_navigate(
        self,
        resolve: Callable[[FloorPlan], Awaitable[_Navigation]],
        *,
        destination: str,
        task_changed: Callable[[], HomeAssistantError],
    ) -> None:
        """Send one navigation command under the sink summon's ownership rules."""
        serial_number = self.session.info.serial_number
        request_generation = self._plans.control.motion_generation(serial_number)
        request_stop_generation = self._plans.control.stop_request_generation(
            serial_number
        )
        request_admission_epoch = self._plans.control.command_admission_epoch(
            serial_number
        )
        await self._commands.async_ensure_stop_settled(serial_number)
        self._commands.require_motion_generation(serial_number, request_generation)
        self._commands.require_stop_request_generation(
            serial_number, request_stop_generation
        )
        self._plans.control.require_command_admission(
            serial_number, expected_epoch=request_admission_epoch
        )
        # Resolve the destination before taking any lease, so a floor without a
        # sink, an unknown room or a stale map never replaces the ownership of a
        # docked plan.
        floor_plan = self._commands.current_floor_plan()
        floor_token = plan_floor_token(floor_plan)
        send = await resolve(floor_plan)
        # The robot keeps a task it holds, and so the plan driving it, through
        # the visit and resumes it on Resume. Only navigation without a task
        # starts new motion, which takes ownership like any other direct clean.
        joins_task = self._holds_task()
        lease = (
            self._plans.control.external_command(serial_number)
            if joins_task
            else self._plans.control.external_motion(
                serial_number,
                expected_generation=request_generation,
                expected_stop_generation=request_stop_generation,
            )
        )
        async with lease as generation:
            await self._commands.async_ensure_stop_settled(serial_number)
            self._commands.require_motion_generation(
                serial_number, request_generation if joins_task else generation
            )
            self._commands.require_stop_request_generation(
                serial_number, request_stop_generation
            )
            floor_plan = self._commands.current_floor_plan(floor_token)
            if joins_task and not self._holds_task():
                # The task ended while this command waited, so only the motion
                # lease could own what it would start now.
                raise task_changed()
            try:
                await send(floor_plan)
            except (MaticError, ValueError) as err:
                raise _navigation_failed(destination) from err
            await self.session.heartbeat.async_request_refresh()

    def _holds_task(self) -> bool:
        """Return whether the robot holds a task a sink summon would join."""
        operational = self.session.state.value.operational
        return operational.cleaning or operational.paused or operational.returning

    async def async_get_segments(self) -> list[Segment]:
        """Return native Home Assistant cleaning areas for every named room."""
        return self._current_segments()

    def _current_segments(self) -> list[Segment]:
        """Return the currently available local room segments."""
        floor_plan = self.session.floor.value
        if floor_plan is None:
            return []
        return [
            Segment(room.id, room.name, "Current floor") for room in floor_plan.rooms
        ]

    async def async_clean_segments(self, segment_ids: list[str], **kwargs: Any) -> None:
        """Clean the selected native Home Assistant room segments."""
        rooms = self._commands.resolve_rooms(segment_ids)
        await self._commands.async_clean_rooms(rooms)

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
        if normalized == "redo_last_clean":
            await self.async_redo_last_clean()
            return
        if normalized == "sink_summon":
            await self.async_sink_summon()
            return
        if normalized == "go_to_room":
            room = params.get("room") if isinstance(params, dict) else None
            if not isinstance(room, str) or not room.strip():
                raise validation_error(
                    "go_to_room requires params.room as one room name or ID",
                    "go_to_room_room_required",
                )
            await self.async_go_to_room(room)
            return
        if normalized == "emote":
            kind = params.get("kind") if isinstance(params, dict) else None
            emote = _EMOTES.get(kind.strip().lower()) if isinstance(kind, str) else None
            if emote is None:
                raise validation_error(
                    "emote requires params.kind as nod, shake, pirouette, or snap",
                    "emote_kind_required",
                )
            if emote is UserCommand.EMOTE_SNAP:
                ensure_current_room_allows_photo(self._config_entry)
            await self._async_command(emote)
            return
        if normalized in _QUEUE_COMMANDS:
            room = params.get("room") if isinstance(params, dict) else None
            if (
                not isinstance(params, dict)
                or not isinstance(room, str)
                or not room.strip()
            ):
                raise validation_error(
                    f"{normalized} requires params.room as one room name or ID",
                    "queue_room_required",
                    {"command": normalized},
                )
            options = (
                self._queue_options(params)
                if _QUEUE_COMMANDS[normalized] is QueueAction.CLEAN_AGAIN
                else {}
            )
            await self.async_change_queue(_QUEUE_COMMANDS[normalized], room, **options)
            return
        simple_commands = {
            "pause": UserCommand.PAUSE,
            "resume": UserCommand.RESUME,
            "stay_put": UserCommand.STAY_PUT,
        }
        if normalized in simple_commands:
            await self._async_command(simple_commands[normalized])
            return
        if normalized in {"clean_all", "start"}:
            if self._managed_session_id(params) is not None:
                raise validation_error(
                    "A managed session ID requires a managed room command",
                    "invalid_plan_command",
                )
            options = self._commands.clean_options(params)
            options["motion_token"] = self._motion_token(params)
            options["expected_floor_token"] = self._floor_token(params)
            await self._commands.async_clean_rooms(
                list(self._commands.floor_plan().rooms), **options
            )
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
            options = self._commands.clean_options(params)
            motion_token = self._motion_token(params)
            managed_session_id = self._managed_session_id(params)
            if managed_session_id is not None and motion_token is None:
                raise validation_error(
                    "The managed session ID is invalid for this room command",
                    "invalid_plan_command",
                )
            if motion_token is not None and managed_session_id is None:
                raise validation_error(
                    "The managed room command has no session ID",
                    "invalid_plan_command",
                )
            options["motion_token"] = motion_token
            options["expected_floor_token"] = self._floor_token(params)
            options["managed_session_id"] = managed_session_id
            await self._commands.async_clean_rooms(
                self._commands.resolve_rooms(identifiers), **options
            )
            return
        if normalized == "clean_plan_area":
            # Integration-private: only a managed plan run sends this, with
            # its motion token, session ID and floor binding.
            motion_token = self._motion_token(params)
            managed_session_id = self._managed_session_id(params)
            floor_token = self._floor_token(params)
            area = (params or {}).get("area") if isinstance(params, dict) else None
            fingerprint = (
                (params or {}).get("fingerprint") if isinstance(params, dict) else None
            )
            if (
                motion_token is None
                or managed_session_id is None
                or floor_token is None
                or not isinstance(area, str)
                or not area
                or not isinstance(fingerprint, str)
            ):
                raise validation_error(
                    "A plan's custom area needs its managed run",
                    "invalid_plan_command",
                )
            options = self._commands.clean_options(params)
            await self._commands.async_clean_plan_area(
                area,
                fingerprint,
                cleaning_mode=options["cleaning_mode"],
                coverage_setting=options["coverage_setting"],
                motion_token=motion_token,
                expected_floor_token=floor_token,
                managed_session_id=managed_session_id,
            )
            return
        raise validation_error(
            "Unsupported Matic command. Use start, clean_all, clean_rooms, "
            "clean_segments, pause, resume, stop, stay_put, dock, return_home, "
            "sink_summon, go_to_room, redo_last_clean, skip_room, "
            "clean_room_next, clean_room_again or emote",
            "unsupported_command",
        )

    def _queue_options(self, params: dict[str, Any]) -> dict[str, Any]:
        """Read clean again's optional mode and coverage, keeping the room's own."""
        try:
            return {
                "cleaning_mode": enum_option(CleaningMode, params["cleaning_mode"])
                if params.get("cleaning_mode") is not None
                else None,
                "coverage_setting": enum_option(CoverageSetting, params["coverage"])
                if params.get("coverage") is not None
                else None,
            }
        except ValueError as err:
            raise validation_error(
                str(err), "invalid_cleaning_option", {"error": str(err)}
            ) from err

    @staticmethod
    def _motion_token(params: dict[str, Any] | list[Any] | None) -> int | None:
        """Read the integration-private generation marker from a plan command."""
        if not isinstance(params, dict) or PLAN_MOTION_TOKEN not in params:
            return None
        token = params[PLAN_MOTION_TOKEN]
        if not isinstance(token, int) or isinstance(token, bool):
            raise validation_error(
                "The managed plan command token is invalid", "invalid_plan_command"
            )
        return token

    @staticmethod
    def _floor_token(params: dict[str, Any] | list[Any] | None) -> str | None:
        """Read the opaque map binding from an integration-owned plan command."""
        if not isinstance(params, dict) or PLAN_FLOOR_TOKEN not in params:
            return None
        token = params[PLAN_FLOOR_TOKEN]
        if (
            not isinstance(token, str)
            or len(token) != 64
            or any(character not in "0123456789abcdef" for character in token)
        ):
            raise validation_error(
                "The managed plan floor token is invalid", "invalid_plan_command"
            )
        return token

    @staticmethod
    def _managed_session_id(params: dict[str, Any] | list[Any] | None) -> UUID | None:
        """Read the command correlation UUID supplied only by the managed runner."""
        if not isinstance(params, dict) or PLAN_SESSION_ID not in params:
            return None
        token = params[PLAN_SESSION_ID]
        if not isinstance(token, str):
            raise validation_error(
                "The managed session ID is invalid", "invalid_plan_command"
            )
        try:
            parsed = UUID(token)
        except ValueError as err:
            raise validation_error(
                "The managed session ID is invalid", "invalid_plan_command"
            ) from err
        if str(parsed) != token:
            raise validation_error(
                "The managed session ID is invalid", "invalid_plan_command"
            )
        return parsed


def _navigation_failed(destination: str) -> HomeAssistantError:
    """Create the error for a navigation command the robot could not take."""
    return HomeAssistantError(
        f"The robot could not be sent to the {destination}",
        translation_domain=DOMAIN,
        translation_key="robot_command_failed",
    )


def _sink_task_changed() -> HomeAssistantError:
    """Create the error for a task that ended while a sink summon waited."""
    return HomeAssistantError(
        "The robot's task ended before the sink summon was sent",
        translation_domain=DOMAIN,
        translation_key="robot_task_changed",
    )


def _room_task_changed() -> HomeAssistantError:
    """Create the error for a task that ended while go to room waited."""
    return HomeAssistantError(
        "The robot's task ended before it was sent to the room",
        translation_domain=DOMAIN,
        translation_key="go_to_room_task_changed",
    )


_QUEUE_COMMANDS = {
    "skip_room": QueueAction.SKIP,
    "clean_room_next": QueueAction.CLEAN_NEXT,
    "clean_room_again": QueueAction.CLEAN_AGAIN,
}


def _queue_error(reason: str, room: Room) -> ServiceValidationError:
    """Create the error for a queue change the running clean cannot take."""
    return _QUEUE_ERRORS[reason]({"room": room.name})


_QUEUE_ERRORS: dict[str, Callable[[dict[str, str]], ServiceValidationError]] = {
    "no_clean_running": lambda room: validation_error(
        "A room can only be changed while the robot is cleaning",
        "queue_no_clean_running",
        room,
    ),
    "current_room_unknown": lambda room: validation_error(
        "The robot isn't in a room on this map", "queue_current_room_unknown", room
    ),
    "plan_unreadable": lambda room: validation_error(
        "The running clean's plan can't be read", "queue_plan_unreadable", room
    ),
    "room_not_queued": lambda room: validation_error(
        "The room isn't waiting in this clean", "queue_room_not_queued", room
    ),
    "last_room": lambda room: validation_error(
        "The room is the only one left", "queue_last_room", room
    ),
    "room_settings_unknown": lambda room: validation_error(
        "The room's settings in this clean are unknown",
        "queue_room_settings_unknown",
        room,
    ),
    "already_next": lambda room: validation_error(
        "The room is already current or next", "queue_already_next", room
    ),
}


def _resolve_one_room(identifier: str, floor_plan: FloorPlan) -> Room:
    """Resolve one room by ID or name, refusing an ambiguous name."""
    rooms_by_id = {room.id: room for room in floor_plan.rooms}
    try:
        room_id, _room_name = resolve_room_reference(
            identifier, {room.id: room.name for room in floor_plan.rooms}
        )
    except ValueError as err:
        if str(err).startswith("ambiguous room"):
            raise validation_error(
                f"More than one room matches {identifier}",
                "ambiguous_room",
                {"room": identifier},
            ) from err
        raise validation_error(
            f"Unknown Matic room(s): {identifier}",
            "unknown_rooms",
            {"rooms": identifier},
        ) from err
    return rooms_by_id[room_id]
