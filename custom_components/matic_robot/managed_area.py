"""Saved-area mission execution with bounded native ownership checks."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError

from . import managed_dispatch as dispatch_control
from . import managed_observation as observation
from . import managed_run
from .client import (
    MaticError,
    RobotActivity,
    RobotOperationalState,
    UserCommand,
    native_session_hash,
)
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
from .run_control import evidence_is_current

_LOGGER = logging.getLogger(__name__)

_HOME_OR_IDLE = observation.HOME | {RobotActivity.READY}


def _running_area_state(
    robot: RobotPort, cancel_event: asyncio.Event
) -> RobotOperationalState | None:
    """Return the observed state unless a Stop or a robot error ended the area."""
    if cancel_event.is_set():
        raise PlanCancelledError
    state = robot.observed()
    if state is not None and state.activity is RobotActivity.ERROR:
        raise managed_run.validation_error(
            "The selected Matic robot reported an error", "robot_error"
        )
    return state


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
        _running_area_state(robot, cancel_event)
        identity = await observation._async_read_session_identity(
            robot.session_identity
        )
        # A Stop or error can arrive while the identity request is in flight.
        current = _running_area_state(robot, cancel_event)
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
                current = _running_area_state(robot, cancel_event)
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
    robot: RobotPort,
    dispatch: _PreparedRoomDispatch,
    cancel_event: asyncio.Event,
) -> None:
    """Wait, bounded, for an ended area mission's own history record.

    The next leg dispatches only while native history is unchanged since the
    handoff, and an area's record can land minutes after the area ends. With a
    verified session the wait is for that session's own key; otherwise this
    run owned the robot throughout, so any new key is the area's. A record that
    never arrives leaves that fence to fail closed.
    """
    baseline, session_hash = dispatch.history_baseline, dispatch.session_hash
    if baseline is None and session_hash is None:
        return
    if cancel_event.is_set():
        raise PlanCancelledError

    async def wait_for_record() -> None:
        for attempt in range(observation.SESSION_HISTORY_ATTEMPTS):
            keys = await robot.history_keys(session_hash=session_hash)
            new_keys = (keys or frozenset()) - (baseline or frozenset())
            if any(
                session_hash is None or native_session_hash(key) == session_hash
                for key in new_keys
            ):
                return
            if attempt + 1 < observation.SESSION_HISTORY_ATTEMPTS:
                await asyncio.sleep(observation.SESSION_HISTORY_RETRY_SECONDS)

    history = asyncio.create_task(wait_for_record())
    cancelled = asyncio.create_task(cancel_event.wait())
    try:
        async with asyncio.timeout(observation.SESSION_HISTORY_TIMEOUT_SECONDS):
            await asyncio.wait(
                {history, cancelled}, return_when=asyncio.FIRST_COMPLETED
            )
            if cancel_event.is_set():
                raise PlanCancelledError
            history.result()
    except TimeoutError:
        pass
    finally:
        history.cancel()
        cancelled.cancel()
        await asyncio.gather(history, cancelled, return_exceptions=True)


def _area_refused_before_start(error: BaseException) -> bool:
    """Whether the robot commands refused an area leg before sending its start."""
    return isinstance(error, ServiceValidationError) and error.translation_key in {
        "area_map_changed",
        "plan_area_missing",
        "room_plan_unavailable",
    }


def _area_failure_error(
    error: Exception, area: AreaLeg
) -> ServiceValidationError | None:
    """Return the service error a failed area raises, or None to re-raise it."""
    if isinstance(error, RoomTakenOverError):
        return managed_run.validation_error(
            "The original native cleaning task could no longer be verified",
            "room_taken_over",
            {"room": area.name},
        )
    if isinstance(error, ServiceValidationError):
        return None
    if isinstance(error, RoomStartTimeoutError):
        return managed_run.validation_error(
            f"The robot did not begin cleaning {area.name} before the start timeout",
            "plan_start_timeout",
            {"room": area.name},
        )
    if isinstance(error, TimeoutError):
        return managed_run.validation_error(
            f"Timed out while cleaning {area.name}",
            "plan_timeout",
            {"room": area.name},
        )
    if isinstance(error, MaticError):
        return managed_run.validation_error(
            "The robot could not complete the custom area",
            "robot_command_failed",
        )
    return None


@dataclass(slots=True, kw_only=True)
class _AreaLegRun:
    """One custom area's owned mission, from dispatch to credit or failure."""

    hass: HomeAssistant
    call: ServiceCall
    manager: CleaningPlanManager
    entity_id: str
    serial_number: str
    area: AreaLeg
    run_id: str
    provenance: str
    robot: RobotPort
    cancel_event: asyncio.Event
    motion_token: int
    floor_is_current: Callable[[], bool] | None
    on_native_identity: Callable[[bytes | None], None]
    checkpoint_dispatch: Callable[[_PreparedRoomDispatch], Awaitable[None]]
    # Whether a start may have reached the robot, so a failure must STOP it.
    dispatch_attempted: bool = False

    @property
    def plan_id(self) -> str:
        return str(self.call.data["plan_id"])

    def evidence_is_current(self) -> bool:
        """Whether this run still owns the motion and floor it credits."""
        return evidence_is_current(
            self.manager.control,
            self.serial_number,
            self.motion_token,
            self.cancel_event,
            self.floor_is_current,
        )

    def fire(self, outcome: str, reason_code: str | None = None) -> None:
        """Announce an area outcome on the event bus."""
        data = {
            "entity_id": self.entity_id,
            "plan_id": self.plan_id,
            "run_id": self.run_id,
            "area_id": self.area.area_id,
            "area": self.area.name,
            "cleaning_mode": self.area.cleaning_mode,
            "coverage_setting": self.area.coverage_setting,
            "provenance": self.provenance,
        }
        if reason_code is not None:
            data["reason_code"] = reason_code
        self.hass.bus.async_fire(
            f"{DOMAIN}_area_{outcome}", data, context=self.call.context
        )

    async def async_dispatch(
        self,
        prepared: _PreparedRoomDispatch | None,
        *,
        floor_token: str,
        expected_identity: bytes | None,
        expected_history: frozenset[str] | None,
        expected_revision: str | None,
    ) -> _PreparedRoomDispatch:
        """Start the area, or resume a recovered dispatch, and record it started."""
        self.dispatch_attempted = prepared is not None
        dispatch = prepared
        if dispatch is None:

            def mark_dispatch_attempted() -> None:
                self.dispatch_attempted = True
                self.on_native_identity(None)

            dispatch = await dispatch_control._async_dispatch_leg_command(
                self.robot,
                self.area,
                self.motion_token,
                floor_token=floor_token,
                floor_is_current=self.floor_is_current,
                on_dispatch=mark_dispatch_attempted,
                on_claim=lambda session_id: (
                    self.manager.ledger.async_claim_native_session(
                        self.serial_number, session_id, run_id=self.run_id
                    )
                ),
                on_identity=self.on_native_identity,
                expected_dispatch_identity=expected_identity,
                expected_dispatch_history=expected_history,
                expected_dispatch_revision=expected_revision,
            )
            await self.checkpoint_dispatch(dispatch)
        await self.manager.ledger.async_mark_area_started(
            self.serial_number, self.plan_id, self.area, run_id=self.run_id
        )
        if not dispatch.recovered:
            self.fire("started")
        return dispatch

    async def async_watch(
        self, dispatch: _PreparedRoomDispatch, *, settle_history: bool
    ) -> None:
        """Accept the owned start, then wait out the area's own session."""
        try:
            await observation._async_wait_for_owned_start(
                self.robot,
                int(self.call.data["start_timeout"]),
                self.cancel_event,
                None,
                self.on_native_identity,
                dispatch.native_identity_baseline,
                dispatch.native_identity,
                already_accepted=dispatch.recovered,
            )
        except TimeoutError as err:
            raise RoomStartTimeoutError from err
        if not await self.manager.ledger.async_mark_area_accepted(
            self.serial_number,
            self.plan_id,
            self.area,
            run_id=self.run_id,
            acceptance_is_current=self.evidence_is_current,
        ):
            raise PlanCancelledError
        budget = await managed_run._async_completion_budget(
            dispatch,
            int(self.call.data["completion_timeout"]),
            self.checkpoint_dispatch,
        )
        async with asyncio.timeout(budget):
            await _async_wait_for_area_end(
                self.robot, self.cancel_event, dispatch.native_identity
            )
        if settle_history:
            await _async_wait_for_area_record(self.robot, dispatch, self.cancel_event)

    async def async_credit(self) -> None:
        """Credit the area's owned end while this run still owns its evidence."""
        if not await self.manager.ledger.async_mark_area_finished(
            self.serial_number,
            self.area,
            run_id=self.run_id,
            completed=True,
            completion_is_current=self.evidence_is_current,
        ):
            raise PlanCancelledError
        self.fire("finished")

    async def async_close_failed(
        self,
        error: Exception,
        *,
        finish_room_event: asyncio.Event,
        managed_user_command: Callable[[int, UserCommand], Awaitable[None]] | None,
    ) -> ServiceValidationError | None:
        """Release a failed area; return its service error, or None to re-raise."""
        if isinstance(error, RoomTakenOverError):
            # A replaced task was never ours to stop.
            if dispatch_control._shutdown_suspends_run(
                self.hass, self.manager, self.serial_number
            ):
                return None
            reason_code = "native_task_taken_over"
        else:
            # A graceful stop cannot upgrade a failed area once it has failed.
            finish_room_event.clear()
            if not dispatch_control._managed_stop_fence_owned_by_run(
                self.manager, self.serial_number, self.run_id
            ):
                await dispatch_control._async_cleanup_managed_motion(
                    managed_user_command,
                    self.motion_token,
                    self.dispatch_attempted
                    and managed_run._coverage_guard_cause(error) is None
                    and not _area_refused_before_start(error),
                )
            reason_code = managed_run._failure_reason_code(error)
        await self.manager.ledger.async_mark_area_finished(
            self.serial_number, self.area, run_id=self.run_id
        )
        self.fire("failed", reason_code)
        return _area_failure_error(error, self.area)


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
    expected_dispatch_revision: str | None,
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
    leg = _AreaLegRun(
        hass=hass,
        call=call,
        manager=manager,
        entity_id=entity_id,
        serial_number=serial_number,
        area=area,
        run_id=run_id,
        provenance=provenance,
        robot=robot,
        cancel_event=cancel_event,
        motion_token=motion_token,
        floor_is_current=floor_is_current,
        on_native_identity=on_native_identity,
        checkpoint_dispatch=checkpoint_dispatch,
    )
    try:
        dispatch = await leg.async_dispatch(
            prepared_dispatch,
            floor_token=floor_token,
            expected_identity=expected_dispatch_identity,
            expected_history=expected_dispatch_history,
            expected_revision=expected_dispatch_revision,
        )
        await leg.async_watch(dispatch, settle_history=settle_history)
    except PlanCancelledError, asyncio.CancelledError:
        # Stop owns its own STOP.
        raise
    except Exception as err:
        error = await leg.async_close_failed(
            err,
            finish_room_event=finish_room_event,
            managed_user_command=managed_user_command,
        )
        if error is None:
            raise
        raise error from err
    await leg.async_credit()
    return True
