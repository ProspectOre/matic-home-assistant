"""Vacuum controls for Matic Hermes."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from homeassistant.components.vacuum import Segment, StateVacuumEntity
from homeassistant.components.vacuum.const import VacuumActivity, VacuumEntityFeature
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .client.commands import QueueAction, UserCommand
from .client.exceptions import MaticError
from .client.models import RobotActivity
from .const import DOMAIN
from .entity import MaticEntity
from .robot_commands import validation_error
from .robot_controls import QUEUE_COMMANDS, RobotControls, queue_options
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
            "previous_area",
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
        return (self.session.state, self.session.floor)

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
        return {
            "matic_entry_id": self._config_entry.entry_id,
            "recharge_and_resume": state.recharge_and_resume,
            "previous_area": state.previous_area,
            "rooms": (
                {room.id: room.name for room in floor_plan.rooms}
                if floor_plan is not None
                else {}
            ),
        }

    @property
    def _commands(self) -> RobotControls:
        """The commands and checks this vacuum shares with plan runs and actions."""
        return RobotControls(self.hass, self._config_entry, self.entity_id)

    async def async_start(self, **kwargs: object) -> None:
        """Resume a paused task or start a full-floor clean."""
        if self.session.state.value.operational.paused:
            await self._commands.async_send_user_command(UserCommand.RESUME)
            return
        await self._commands.async_clean_rooms(list(self._commands.floor_plan().rooms))

    async def async_pause(self, **kwargs: object) -> None:
        """Pause the current task."""
        await self._commands.async_send_user_command(UserCommand.PAUSE)

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
            await self._commands.async_dispatch_admitted_command(
                UserCommand.STOP, run_id=run_id
            )
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
        if self._commands.holds_task():
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
            if self._commands.holds_task():
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
        """Run one of the documented Matic commands for scripts and dashboards."""
        normalized = command.strip().lower().replace("-", "_").replace(" ", "_")
        if normalized == "redo_last_clean":
            await self.async_redo_last_clean()
            return
        if normalized == "sink_summon":
            await self._commands.async_sink_summon()
            return
        if normalized == "go_to_room":
            room = params.get("room") if isinstance(params, dict) else None
            if not isinstance(room, str) or not room.strip():
                raise validation_error(
                    "go_to_room requires params.room as one room name or ID",
                    "go_to_room_room_required",
                )
            await self._commands.async_go_to_room(room)
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
                await self._commands.async_take_photo()
                return
            await self._commands.async_send_user_command(emote)
            return
        if normalized in QUEUE_COMMANDS:
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
                queue_options(params)
                if QUEUE_COMMANDS[normalized] is QueueAction.CLEAN_AGAIN
                else {}
            )
            await self._commands.async_change_queue(
                QUEUE_COMMANDS[normalized], room, **options
            )
            return
        simple_commands = {
            "resume": UserCommand.RESUME,
            "stay_put": UserCommand.STAY_PUT,
        }
        if normalized in simple_commands:
            await self._commands.async_send_user_command(simple_commands[normalized])
            return
        raise validation_error(
            "Unsupported Matic command. Use resume, stay_put, sink_summon, "
            "go_to_room, redo_last_clean, skip_room, clean_room_next, "
            "clean_room_again or emote",
            "unsupported_command",
        )
