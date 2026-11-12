"""Saved-area mission execution with bounded native ownership checks."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError

from . import managed_dispatch as dispatch_control
from . import managed_observation as observation
from . import managed_run
from .client.commands import UserCommand
from .client.exceptions import MaticError
from .client.models import CleaningSessionRecord, RobotActivity
from .const import DOMAIN
from .managed_run import (
    PlanCancelledError,
    RoomStartTimeoutError,
    RoomTakenOverError,
    _PreparedRoomDispatch,
)
from .plan_model import (
    AreaLeg,
)
from .plans import CleaningPlanManager
from .robot_port import RobotPort

_LOGGER = logging.getLogger(__name__)

_HOME_OR_IDLE = observation.HOME | {RobotActivity.READY}


async def _async_wait_for_area_end(
    robot: RobotPort,
    cancel_event: asyncio.Event,
    expected: bytes | None,
) -> None:
    """Wait until a plan custom area's own native mission ends.

    The robot reports no result for a drawn area, so the end of the area's
    session is the end of the area (not coverage evidence). A replaced or
    unreadable session fails closed and a robot error is terminal. Firmware
    can keep an ended mission's identity while the robot is home, so an
    inactive session when docked or idle also ends it. A low-charge return
    keeps the same session and is waited out.
    """
    if not expected:
        raise RoomTakenOverError(
            "The custom area's native task could not be identified"
        )
    unknown_reads = 0
    while True:
        if cancel_event.is_set():
            raise PlanCancelledError
        state = robot.observed()
        if state is not None and state.activity is RobotActivity.ERROR:
            raise managed_run._validation_error(
                "The selected Matic robot reported an error", "robot_error"
            )
        identity = await observation._async_read_session_identity(
            robot.session_identity
        )
        # A Stop or error can arrive while the identity request is in flight.
        if cancel_event.is_set():
            raise PlanCancelledError
        current = robot.observed()
        if current is not None and current.activity is RobotActivity.ERROR:
            raise managed_run._validation_error(
                "The selected Matic robot reported an error", "robot_error"
            )
        if identity is None:
            unknown_reads += 1
            if unknown_reads >= observation.ACTIVE_SESSION_UNKNOWN_ATTEMPTS:
                raise RoomTakenOverError(
                    "The native task ownership could not be verified"
                )
        elif identity == b"":
            if unknown_reads:
                raise RoomTakenOverError(
                    "The custom area ended while native task ownership was unknown"
                )
            return
        elif identity != expected:
            raise RoomTakenOverError("The native cleaning task was replaced")
        else:
            unknown_reads = 0
            if current is not None and current.activity in _HOME_OR_IDLE:
                active = await observation._async_active_session_state(
                    robot.active_session
                )
                # The robot can stop, fail or resume during this second read.
                if cancel_event.is_set():
                    raise PlanCancelledError
                current = robot.observed()
                if current is not None and current.activity is RobotActivity.ERROR:
                    raise managed_run._validation_error(
                        "The selected Matic robot reported an error", "robot_error"
                    )
                if (
                    active is False
                    and current is not None
                    and current.activity in _HOME_OR_IDLE
                ):
                    return
        with suppress(TimeoutError):
            async with asyncio.timeout(observation.ROOM_STATUS_REFRESH_SECONDS):
                await cancel_event.wait()


async def _async_wait_for_area_record(
    reader: Callable[[], Awaitable[tuple[CleaningSessionRecord, ...]]],
    baseline: frozenset[bytes] | None,
    cancel_event: asyncio.Event,
) -> None:
    """Wait, bounded, for an ended area mission's own history record.

    The next leg dispatches only while native history is unchanged since the
    handoff, and an area's record can land minutes after the area ends. This
    run owned the robot throughout, so any new record is the area's own. A
    record that never arrives leaves that fence to fail closed.
    """
    if baseline is None:
        return
    for _attempt in range(observation.SESSION_HISTORY_ATTEMPTS):
        if cancel_event.is_set():
            raise PlanCancelledError
        keys = await observation._async_session_history_baseline(reader)
        if keys is not None and keys - baseline:
            return
        with suppress(TimeoutError):
            async with asyncio.timeout(observation.SESSION_HISTORY_RETRY_SECONDS):
                await cancel_event.wait()


def _area_refused_before_start(error: BaseException) -> bool:
    """Whether the robot commands refused an area leg before sending its start."""
    return isinstance(error, ServiceValidationError) and error.translation_key in {
        "area_map_changed",
        "invalid_area",
        "plan_area_missing",
        "room_plan_unavailable",
    }


async def _async_run_area_leg(
    hass: HomeAssistant,
    call: ServiceCall,
    manager: CleaningPlanManager,
    entity_id: str,
    serial_number: str,
    area: AreaLeg,
    robot: RobotPort,
    cancel_event: asyncio.Event,
    motion_token: int,
    managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None,
    *,
    prepared_dispatch: _PreparedRoomDispatch | None,
    finish_room_event: asyncio.Event,
    floor_is_current: Callable[[], bool] | None,
    floor_token: str,
    expected_dispatch_identity: bytes | None,
    expected_dispatch_history: frozenset[str] | None,
    on_native_identity: Callable[[bytes | None], None],
    run_id: str,
    checkpoint_dispatch: Callable[[_PreparedRoomDispatch], Awaitable[None]],
    provenance: str,
    settle_history: bool,
) -> bool:
    """Clean one plan custom area as its own owned native mission.

    The start must carry the session ID this run minted, as a room leg's does;
    the area then runs until that session ends. Accepted starts and normal
    owned session ends update area rotation history, never room cadence.
    """
    plan_id = str(call.data["plan_id"])
    event_data = {
        "entity_id": entity_id,
        "plan_id": plan_id,
        "run_id": run_id,
        "area_id": area.area_id,
        "area": area.name,
        "cleaning_mode": area.cleaning_mode,
        "coverage_setting": area.coverage_setting,
        "provenance": provenance,
    }

    def evidence_is_current() -> bool:
        return (
            not cancel_event.is_set()
            and manager.control.managed_motion_is_current(serial_number, motion_token)
            and (floor_is_current is None or floor_is_current())
        )

    dispatch = prepared_dispatch
    dispatch_attempted = dispatch is not None

    def mark_dispatch_attempted() -> None:
        nonlocal dispatch_attempted
        dispatch_attempted = True
        on_native_identity(None)

    try:
        if dispatch is None:
            dispatch = await dispatch_control._async_dispatch_leg_command(
                robot,
                area,
                motion_token,
                floor_token=floor_token,
                floor_is_current=floor_is_current,
                on_dispatch=mark_dispatch_attempted,
                on_claim=lambda session_id: manager.ledger.async_claim_native_session(
                    serial_number, session_id, run_id=run_id
                ),
                on_identity=on_native_identity,
                expected_dispatch_identity=expected_dispatch_identity,
                expected_dispatch_history=expected_dispatch_history,
            )
            await checkpoint_dispatch(dispatch)
        await manager.ledger.async_mark_area_started(
            serial_number, plan_id, area, run_id=run_id
        )
        if not dispatch.recovered:
            hass.bus.async_fire(
                f"{DOMAIN}_area_started", event_data, context=call.context
            )
        try:
            await observation._async_wait_for_owned_start(
                robot,
                int(call.data["start_timeout"]),
                cancel_event,
                None,
                on_native_identity,
                dispatch.native_identity_baseline,
                dispatch.native_identity,
                already_accepted=dispatch.recovered,
            )
        except TimeoutError as err:
            raise RoomStartTimeoutError from err
        if not await manager.ledger.async_mark_area_accepted(
            serial_number,
            plan_id,
            area,
            run_id=run_id,
            acceptance_is_current=evidence_is_current,
        ):
            raise PlanCancelledError
        budget = await managed_run._async_completion_budget(
            dispatch, int(call.data["completion_timeout"]), checkpoint_dispatch
        )
        async with asyncio.timeout(budget):
            await _async_wait_for_area_end(
                robot, cancel_event, dispatch.native_identity
            )
        if settle_history:
            await _async_wait_for_area_record(
                robot.session_history, dispatch.history_baseline, cancel_event
            )
    except PlanCancelledError, asyncio.CancelledError:
        # Stop owns its own STOP.
        raise
    except RoomTakenOverError as err:
        # A replaced task was never ours to stop.
        if dispatch_control._shutdown_suspends_run(hass, manager, serial_number):
            raise
        await manager.ledger.async_mark_area_finished(
            serial_number, area, run_id=run_id
        )
        hass.bus.async_fire(
            f"{DOMAIN}_area_failed",
            {**event_data, "reason_code": "native_task_taken_over"},
            context=call.context,
        )
        raise managed_run._validation_error(
            "The original native cleaning task could no longer be verified",
            "room_taken_over",
            {"room": area.name},
        ) from err
    except Exception as err:
        # A graceful stop cannot upgrade a failed area once it has failed.
        finish_room_event.clear()
        if not dispatch_control._managed_stop_fence_owned_by_run(
            manager, serial_number, run_id
        ):
            await dispatch_control._async_cleanup_managed_motion(
                managed_user_command,
                motion_token,
                dispatch_attempted
                and managed_run._coverage_guard_cause(err) is None
                and not _area_refused_before_start(err),
            )
        await manager.ledger.async_mark_area_finished(
            serial_number, area, run_id=run_id
        )
        hass.bus.async_fire(
            f"{DOMAIN}_area_failed",
            {**event_data, "reason_code": managed_run._failure_reason_code(err)},
            context=call.context,
        )
        if isinstance(err, ServiceValidationError):
            raise
        if isinstance(err, RoomStartTimeoutError):
            raise managed_run._validation_error(
                f"The robot did not begin cleaning {area.name} before the "
                "start timeout",
                "plan_start_timeout",
                {"room": area.name},
            ) from err
        if isinstance(err, TimeoutError):
            raise managed_run._validation_error(
                f"Timed out while cleaning {area.name}",
                "plan_timeout",
                {"room": area.name},
            ) from err
        if isinstance(err, MaticError):
            raise managed_run._validation_error(
                "The robot could not complete the custom area",
                "robot_command_failed",
            ) from err
        raise
    if not await manager.ledger.async_mark_area_finished(
        serial_number,
        area,
        run_id=run_id,
        completed=True,
        completion_is_current=evidence_is_current,
    ):
        raise PlanCancelledError
    hass.bus.async_fire(f"{DOMAIN}_area_finished", event_data, context=call.context)
    return True
