"""The robot's direct commands besides clean starts, for every caller.

The vacuum and the integration's own actions, Assist tools and buttons send
user commands, navigation, queue changes and the photo snap through here,
under the same leases and checks.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from .client.commands import (
    CleaningMode,
    CoverageSetting,
    QueueAction,
    QueueChangeError,
    UserCommand,
)
from .client.exceptions import MaticError, SinkLocationUnavailableError
from .client.models import FloorPlan, Room
from .const import CONF_PHOTO_PATROL_NO_PHOTO_ROOMS, DOMAIN
from .plan_model import plan_floor_token, resolve_room_reference
from .robot_commands import RobotCommands, enum_option, validation_error

if TYPE_CHECKING:
    from . import MaticConfigEntry

# Sends one resolved navigation command for the floor current at send time.
type _Navigation = Callable[[FloorPlan], Awaitable[None]]


class RobotControls(RobotCommands):
    """User commands, navigation, queue changes and the photo snap."""

    async def async_take_photo(self) -> None:
        """Snap a photo unless the robot's current room is a no-photo room."""
        ensure_current_room_allows_photo(self._entry)
        await self.async_send_user_command(UserCommand.EMOTE_SNAP)

    def _require_no_pending_stop_dispatch(self, serial_number: str) -> None:
        """Keep RESUME out of the gap between Stop acceptance and dispatch."""
        pending = getattr(self._plans.control, "stop_dispatch_pending", None)
        if callable(pending) and pending(serial_number) is True:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="robot_stop_pending",
            )

    async def async_send_user_command(self, command: UserCommand) -> None:
        """Serialize a user command and immediately refresh state."""
        serial_number = self._session.info.serial_number
        if command is UserCommand.RESUME:
            self._require_no_pending_stop_dispatch(serial_number)
        generation = self._plans.control.motion_generation(serial_number)
        stop_request_generation = self._plans.control.stop_request_generation(
            serial_number
        )
        admission_epoch = self._plans.control.command_admission_epoch(serial_number)
        self._plans.control.require_command_admission(serial_number)
        await self.async_ensure_stop_settled(serial_number)
        self._plans.control.require_command_admission(
            serial_number, expected_epoch=admission_epoch
        )
        async with self._plans.control.external_command(serial_number):
            if command is UserCommand.RESUME:
                self._require_no_pending_stop_dispatch(serial_number)
            await self.async_ensure_stop_settled(serial_number)
            self.require_motion_generation(serial_number, generation)
            self.require_stop_request_generation(serial_number, stop_request_generation)
            await self.async_dispatch_admitted_command(command, run_id=None)

    async def async_dispatch_admitted_command(
        self, command: UserCommand, *, run_id: str | None
    ) -> None:
        """Dispatch a command while the caller owns its command-lock lease."""
        serial_number = self._session.info.serial_number
        await self._session.client.async_send_user_command(command)
        if command is UserCommand.STOP:
            await self._plans.control.async_mark_stop_pending(
                serial_number, run_id=run_id
            )
        await self._session.heartbeat.async_request_refresh()

    def holds_task(self) -> bool:
        """Return whether the robot holds a task a sink summon would join."""
        operational = self._session.state.value.operational
        return operational.cleaning or operational.paused or operational.returning

    async def async_sink_summon(self) -> None:
        """Send the robot to its saved sink location to await a refill."""

        async def resolve(floor_plan: FloorPlan) -> _Navigation:
            try:
                posture = await self._session.client.async_get_sink_posture(floor_plan)
            except SinkLocationUnavailableError as err:
                raise validation_error(
                    "No sink location is saved for this floor",
                    "sink_location_unavailable",
                ) from err
            except (MaticError, ValueError) as err:
                raise _navigation_failed("sink") from err
            return lambda current: self._session.client.async_sink_summon(
                current, posture
            )

        await self._async_navigate(
            resolve, destination="sink", task_changed=_sink_task_changed
        )

    async def async_go_to_room(self, room: str) -> None:
        """Send the robot to one named room on this floor without cleaning it."""

        async def resolve(floor_plan: FloorPlan) -> _Navigation:
            target = _resolve_one_room(room, floor_plan)
            return lambda current: self._session.client.async_go_to_room(
                current, target
            )

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
        serial_number = self._session.info.serial_number
        floor_plan = self.current_floor_plan()
        target = _resolve_one_room(room, floor_plan)
        if not self._session.state.value.operational.cleaning:
            raise _queue_error("no_clean_running", target)
        # The robot keeps the task, so the plan run driving it keeps ownership.
        async with self._plans.control.external_command(serial_number):
            if not self._session.state.value.operational.cleaning:
                raise _queue_error("no_clean_running", target)
            if action is not QueueAction.SKIP:
                self.require_daily_room_dispatch(
                    self.current_floor_plan(plan_floor_token(floor_plan)),
                    [target],
                    tracked=False,
                )
            try:
                await self._session.client.async_change_queue(
                    self.current_floor_plan(plan_floor_token(floor_plan)),
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
        self._hass.bus.async_fire(
            f"{DOMAIN}_queue_changed",
            {
                ATTR_ENTITY_ID: self._entity_id,
                "action": action.value,
                "room_id": target.id,
                "room": target.name,
                "run_id": run_id,
            },
        )
        await self._session.heartbeat.async_request_refresh()

    async def _async_navigate(
        self,
        resolve: Callable[[FloorPlan], Awaitable[_Navigation]],
        *,
        destination: str,
        task_changed: Callable[[], HomeAssistantError],
    ) -> None:
        """Send one navigation command under the sink summon's ownership rules."""
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
        self.require_stop_request_generation(serial_number, request_stop_generation)
        self._plans.control.require_command_admission(
            serial_number, expected_epoch=request_admission_epoch
        )
        # Resolve the destination before taking any lease, so a floor without a
        # sink, an unknown room or a stale map never replaces the ownership of a
        # docked plan.
        floor_plan = self.current_floor_plan()
        floor_token = plan_floor_token(floor_plan)
        send = await resolve(floor_plan)
        # The robot keeps a task it holds, and so the plan driving it, through
        # the visit and resumes it on Resume. Only navigation without a task
        # starts new motion, which takes ownership like any other direct clean.
        joins_task = self.holds_task()
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
            await self.async_ensure_stop_settled(serial_number)
            self.require_motion_generation(
                serial_number, request_generation if joins_task else generation
            )
            self.require_stop_request_generation(serial_number, request_stop_generation)
            floor_plan = self.current_floor_plan(floor_token)
            if joins_task and not self.holds_task():
                # The task ended while this command waited, so only the motion
                # lease could own what it would start now.
                raise task_changed()
            try:
                await send(floor_plan)
            except (MaticError, ValueError) as err:
                raise _navigation_failed(destination) from err
            await self._session.heartbeat.async_request_refresh()


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


QUEUE_COMMANDS = {
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


def queue_options(params: dict[str, Any]) -> dict[str, Any]:
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


def ensure_current_room_allows_photo(entry: MaticConfigEntry) -> None:
    """Refuse manual snaps when the reported room is blocked or unverifiable."""
    forbidden = set(entry.options.get(CONF_PHOTO_PATROL_NO_PHOTO_ROOMS, ()))
    if not forbidden:
        return
    floor_plan = entry.runtime_data.session.floor.value
    if floor_plan is None or not entry.runtime_data.slam_map.floor_plan_is_current(
        floor_plan
    ):
        raise _photo_error("photo_patrol_rooms_unavailable")
    room_names = {room.id: room.name for room in floor_plan.rooms}
    if not forbidden <= set(room_names):
        raise _photo_error("photo_patrol_rooms_unavailable")
    area = entry.runtime_data.session.state.value.operational.current_area
    if not isinstance(area, str) or not area.strip():
        raise _photo_error("photo_patrol_rooms_unavailable")
    try:
        room_id, _name = resolve_room_reference(area, room_names)
    except ValueError as err:
        raise _photo_error("photo_patrol_rooms_unavailable") from err
    if room_id in forbidden:
        raise _photo_error("photo_patrol_room_blocked")


def _photo_error(key: str) -> HomeAssistantError:
    return HomeAssistantError(key, translation_domain=DOMAIN, translation_key=key)
