"""Reattach durable managed runs without replaying accepted robot commands."""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from functools import partial
from typing import TYPE_CHECKING, Any

from google.protobuf.message import DecodeError
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .client import (
    CleaningSessionRecord,
    MaticError,
    NativeHistoryIncompleteError,
    UserCommand,
    is_sha256_hex,
    native_session_hash,
    uuid_string,
)
from .const import DOMAIN
from .leg_settlement import LegSettlement
from .managed_dispatch import (
    async_managed_user_command,
    schedule_managed_dock_after_stop,
    schedule_run_dock_confirmation,
    shutdown_suspends_run,
)
from .managed_executor import async_execute_rooms, async_finish_plan_run
from .managed_leg import withheld_room_ids
from .managed_observation import (
    LEG_HANDOFF_TIMEOUT_SECONDS,
    async_verify_leg_completion,
    async_wait_for_settled_leg_handoff,
)
from .managed_run import (
    RECONNECT_SECONDS,
    PlanCancelledError,
    PreparedRoomDispatch,
    async_unless_cancelled,
)
from .native_completion import RobotEnded
from .plan_model import AreaLeg, CleaningRoom, PlanLeg, plan_floor_token
from .plan_records import LastRun, RecoveryCheckpoint
from .robot_port import RobotPort
from .room_coherence import current_floor_plan, room_completion_names_are_current
from .run_machine import (
    RUN_SETTLED_REASONS,
    Restarted,
    RoomVerified,
    Run,
    RunPhase,
    RunProgress,
    stored_instant,
    transition,
)
from .service_names import SERVICE_RUN_SELECTED_PLAN

if TYPE_CHECKING:
    from . import MaticConfigEntry, MaticRuntimeData
    from .plans import CleaningPlanManager

RECOVERY_RETRY_SECONDS = 2
RECOVERY_ATTEMPTS = RECONNECT_SECONDS // RECOVERY_RETRY_SECONDS
# Why a run ends when its checkpoint or vacuum entity cannot be used.
_CHECKPOINT_UNVERIFIED = "restart_checkpoint_unverified"
# Actions 0.6 removed, and the Run plan cleaning order each one stood for.
_REMOVED_RUN_BEHAVIOR = {
    "intelligent_clean": "intelligent",
    "clean_entire_plan": "ordered",
}


def _recovered_call(
    hass: HomeAssistant, run: LastRun, checkpoint: RecoveryCheckpoint
) -> ServiceCall:
    """Rebuild the action call that started a run, as 0.6 names it."""
    service, data = run.service, checkpoint.data
    if service is None or data is None:
        raise ValueError("the stored run cannot name its action call")
    data = dict(data)
    if run_behavior := _REMOVED_RUN_BEHAVIOR.get(service):
        service = SERVICE_RUN_SELECTED_PLAN
        data = {**data, "run_behavior": run_behavior}
    return ServiceCall(hass, DOMAIN, service, data)


def _matches_mixed_session_hash(identity: bytes, expected_hash: object) -> bool:
    """Compare a live opaque session to the generated mixed-session fingerprint."""
    if not is_sha256_hex(expected_hash):
        return False
    try:
        canonical_identity = uuid_string(identity)
    except DecodeError, ValueError:
        return False
    return hashlib.sha256(canonical_identity.encode("ascii")).hexdigest() == (
        expected_hash
    )


async def _async_stop_interrupted_mixed_dispatch(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    serial_number: str,
    run: LastRun,
    expected_hash: str,
    expected_identity: bytes,
    generation: int,
    cancel: asyncio.Event,
    floor_is_current: Callable[[], bool],
) -> str:
    """Stop only the exact initial mission from an interrupted mixed dispatch.

    The STOP intent and native-inactive fence are persisted before transmission.
    If HA then crashes, recovery never replays STOP; it resumes only the
    evidence-driven stop-settlement watcher. A locally rejected write rolls the
    intent back because the client can prove that no DATA was transmitted.
    """
    runtime = entry.runtime_data
    manager = runtime.cleaning_plans
    run_id = run.run_id
    assert run.checkpoint is not None
    entity_id = run.checkpoint.entity_id
    assert entity_id is not None
    token: int | None = None
    transmitted = False

    async with manager.control.external_command(serial_number):
        if (
            cancel.is_set()
            or manager.control.motion_generation(serial_number) != generation
            or not floor_is_current()
        ):
            return "restart_mixed_dispatch_superseded"
        current_identity = await runtime.client.async_get_cleaning_session_identity()
        if (
            cancel.is_set()
            or manager.control.motion_generation(serial_number) != generation
            or not floor_is_current()
            or current_identity != expected_identity
        ):
            return "restart_mixed_dispatch_superseded"
        token = manager.control.begin_managed_motion(serial_number)
        try:
            await manager.recovery.async_prepare_mixed_dispatch_stop(
                serial_number, run_id, expected_hash
            )
        except BaseException:
            try:
                await manager.recovery.async_rollback_mixed_dispatch_stop(
                    serial_number, run_id, expected_hash
                )
            finally:
                manager.control.end_managed_motion(serial_number, token)
            raise
        if (
            not manager.control.managed_motion_is_current(serial_number, token)
            or manager.control.motion_generation(serial_number) != token
            or not floor_is_current()
        ):
            await manager.recovery.async_rollback_mixed_dispatch_stop(
                serial_number, run_id, expected_hash
            )
            manager.control.end_managed_motion(serial_number, token)
            return "restart_mixed_dispatch_superseded"
        current_identity = await runtime.client.async_get_cleaning_session_identity()
        if (
            not manager.control.managed_motion_is_current(serial_number, token)
            or manager.control.motion_generation(serial_number) != token
            or not floor_is_current()
            or current_identity != expected_identity
        ):
            await manager.recovery.async_rollback_mixed_dispatch_stop(
                serial_number, run_id, expected_hash
            )
            manager.control.end_managed_motion(serial_number, token)
            return "restart_mixed_dispatch_superseded"

        def note_stop_transmitted() -> None:
            nonlocal transmitted
            transmitted = True

        try:
            await runtime.client.async_send_user_command(
                UserCommand.STOP, on_transmitted=note_stop_transmitted
            )
        except asyncio.CancelledError:
            if transmitted:
                manager.control.request_stop(serial_number)
                manager.control.end_managed_motion(serial_number, token)
                schedule_managed_dock_after_stop(
                    hass, entry, manager, serial_number, entity_id, run_id, None
                )
            else:
                await manager.recovery.async_rollback_mixed_dispatch_stop(
                    serial_number, run_id, expected_hash
                )
                manager.control.end_managed_motion(serial_number, token)
            raise
        except MaticError:
            if not transmitted:
                await manager.recovery.async_rollback_mixed_dispatch_stop(
                    serial_number, run_id, expected_hash
                )
                manager.control.end_managed_motion(serial_number, token)
                raise
        except Exception:
            if not transmitted:
                await manager.recovery.async_rollback_mixed_dispatch_stop(
                    serial_number, run_id, expected_hash
                )
                manager.control.end_managed_motion(serial_number, token)
                raise
        manager.control.request_stop(serial_number)
        manager.control.end_managed_motion(serial_number, token)
        schedule_managed_dock_after_stop(
            hass, entry, manager, serial_number, entity_id, run_id, None
        )
        await runtime.session.heartbeat.async_request_refresh()
    return "restart_mixed_dispatch_stop_requested"


def _vacuum_entity_id(hass: HomeAssistant, serial_number: str) -> str | None:
    """Return the robot's vacuum entity, which a run's commands go through."""
    return er.async_get(hass).async_get_entity_id(
        "vacuum", DOMAIN, f"{serial_number}_vacuum"
    )


def _restore_stop_settlement(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    serial_number: str,
    restored_owner: str | None,
) -> None:
    """Watch a stop that was pending before recovery until the robot settles."""
    manager = entry.runtime_data.cleaning_plans
    owner = manager.control.pending_stop_run_id(serial_number)
    entity_id = _vacuum_entity_id(hass, serial_number)
    if (
        owner is not None
        and owner == restored_owner
        and entity_id is not None
        and not manager.control.dock_reconciliation_active(serial_number)
    ):
        schedule_managed_dock_after_stop(
            hass, entry, manager, serial_number, entity_id, owner, None
        )


@dataclass(frozen=True, slots=True)
class _Recovery:
    """A stored run, the leg it stopped in and the ownership recovery holds."""

    hass: HomeAssistant
    entry: MaticConfigEntry
    serial_number: str
    run: LastRun
    checkpoint: RecoveryCheckpoint
    cancel: asyncio.Event
    generation: int
    restarted: Run
    rooms: list[CleaningRoom]
    legs: list[PlanLeg]
    leg: PlanLeg
    # The fingerprint the live mission must match to be the run's own.
    expected_hash: Any
    entity_id: str
    floor_token: str

    @property
    def runtime(self) -> MaticRuntimeData:
        """Return the entry's client, session and plan manager."""
        return self.entry.runtime_data

    @property
    def manager(self) -> CleaningPlanManager:
        """Return the plan manager."""
        return self.entry.runtime_data.cleaning_plans

    def lost_ownership(self) -> bool:
        """Return whether a stop or another motion took the robot."""
        return (
            self.cancel.is_set()
            or self.manager.control.motion_generation(self.serial_number)
            != self.generation
        )

    def floor_is_current(self) -> bool:
        """Return whether the robot is on the floor the run was planned on."""
        floor = self.runtime.session.floor.value
        return (
            floor is not None
            and plan_floor_token(floor) == self.floor_token
            and self.runtime.slam_map.floor_plan_is_current(floor)
        )

    def completion_is_current(self) -> bool:
        """Return whether that floor still names the run's rooms as planned."""
        floor = self.runtime.session.floor.value
        return (
            floor is not None
            and self.floor_is_current()
            and room_completion_names_are_current(floor, self.rooms)
        )


@dataclass(frozen=True, slots=True)
class _Rejoined:
    """The live mission recovery verified, and what continues the run on it."""

    identity: bytes
    call: ServiceCall
    robot: RobotPort


async def _async_handoff_change(
    robot: RobotPort, checkpoint: RecoveryCheckpoint
) -> str | None:
    """Return why a saved leg handoff no longer holds; None while it does."""
    handoff_history = checkpoint.handoff_history
    if handoff_history is None or not all(
        is_sha256_hex(key) for key in handoff_history
    ):
        return "restart_handoff_history_unavailable"
    if checkpoint.handoff_revision_saved and (
        not is_sha256_hex(revision := checkpoint.handoff_revision)
        or await robot.handoff_revision() != revision
    ):
        return "restart_native_mission_changed_or_ended"
    expected = frozenset(handoff_history)
    keys = await robot.session_keys(
        session_hash=checkpoint.session_hash, expected_hashes=expected
    )
    if {hashlib.sha256(key).hexdigest() for key in keys} != expected:
        return "restart_handoff_history_changed"
    return None


async def _async_recovered_history(
    robot: RobotPort, checkpoint: RecoveryCheckpoint, identity: bytes
) -> tuple[frozenset[bytes] | None, str | None] | None:
    """Return a restarted dispatch's history baseline and session fingerprint.

    None means the checkpoint cannot resume. A dispatch that saved its own
    session must still be the robot's active one, and needs no baseline.
    """
    session_hash = checkpoint.session_hash
    if session_hash is not None and not is_sha256_hex(session_hash):
        return None
    active_hash = native_session_hash(identity, active=True) if identity else None
    if session_hash is not None and active_hash not in {None, session_hash}:
        return None
    hashes = checkpoint.history_baseline
    if not isinstance(hashes, list):
        return (None, session_hash) if hashes is None and session_hash else None
    records = await robot.session_history(session_hash=session_hash)
    baseline = frozenset(
        record.key
        for record in records
        if hashlib.sha256(record.key).hexdigest() in hashes
    )
    return baseline, session_hash or active_hash


async def async_recover_managed_run(
    hass: HomeAssistant, entry: MaticConfigEntry, serial_number: str
) -> None:
    """Validate the same native mission and rejoin the normal execution loop.

    Native identity bytes stay in memory. Only fingerprints are checkpointed.
    An ended or changed mission while HA was absent is deliberately not replayed:
    native history import can still credit rooms, but cannot prove continuous
    ownership of the remaining queue.
    """
    # A queued background recovery may first run after unload has begun.
    # Leave its checkpoint for the next setup instead of acquiring ownership
    # after the unload handler already checked for a registered task.
    if entry.state is ConfigEntryState.UNLOAD_IN_PROGRESS:
        return
    manager = entry.runtime_data.cleaning_plans
    restored_stop_owner = manager.control.pending_stop_run_id(serial_number)
    run = manager.recovery.recovery_run(serial_number)
    if run is None:
        _restore_stop_settlement(hass, entry, serial_number, restored_stop_owner)
        return
    manager.control.register_run_task(serial_number)
    cancel = manager.control.prepare_run(serial_number)
    generation = manager.control.motion_generation(serial_number)
    reason = _CHECKPOINT_UNVERIFIED
    try:
        reason = await _async_recovery_reason(
            hass, entry, serial_number, run, cancel, generation
        )
    except asyncio.CancelledError:
        if shutdown_suspends_run(hass, manager, serial_number):
            reason = "home_assistant_shutdown"
        raise
    except NativeHistoryIncompleteError:
        # Unlike a failed read, this holds until the robot drops the entry.
        reason = "restart_history_incomplete"
    except (
        HomeAssistantError,
        MaticError,
        KeyError,
        TypeError,
        ValueError,
        IndexError,
        TimeoutError,
    ):
        reason = "restart_recovery_unavailable"
    finally:
        if (
            reason != "home_assistant_shutdown"
            and not shutdown_suspends_run(hass, manager, serial_number)
            and manager.recovery.recovery_run(serial_number) is not None
        ):
            await _async_finish_recovered_run(hass, entry, serial_number, run, reason)
        shutdown_suspended = shutdown_suspends_run(hass, manager, serial_number)
        manager.control.unregister_run_task(serial_number)
        if not shutdown_suspended:
            _restore_stop_settlement(hass, entry, serial_number, restored_stop_owner)


async def _async_recovery_reason(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    serial_number: str,
    run: LastRun,
    cancel: asyncio.Event,
    generation: int,
) -> str:
    """Resume the stored run where it can go on and return why recovery ended."""
    manager = entry.runtime_data.cleaning_plans
    checkpoint = run.checkpoint
    assert checkpoint is not None
    if manager.control.pending_stop_run_id(serial_number) is not None:
        return "restart_stop_settlement_pending"
    restarted, _ = transition(Run(), Restarted(run))
    if restarted.ended is not None:
        return restarted.ended
    rooms = checkpoint.cleaning_rooms()
    legs = checkpoint.legs()
    leg = legs[restarted.leg_index]
    expected = (
        checkpoint.mixed_initial_session_hash
        if restarted.phase is RunPhase.DISPATCHING
        else checkpoint.native_identity_hash
    )
    entity_id = _vacuum_entity_id(hass, serial_number)
    if entity_id is None:
        return _CHECKPOINT_UNVERIFIED
    if checkpoint.floor_token is None:
        raise ValueError("checkpoint has no floor")
    if checkpoint.entity_id is None or run.started_at is None:
        raise ValueError("the stored run cannot name its vacuum or start time")
    recovery = _Recovery(
        hass,
        entry,
        serial_number,
        run,
        checkpoint,
        cancel,
        generation,
        restarted,
        rooms,
        legs,
        leg,
        expected,
        entity_id,
        checkpoint.floor_token,
    )
    identity: bytes | None
    for attempt in range(RECOVERY_ATTEMPTS):
        if recovery.lost_ownership():
            return "restart_recovery_cancelled"
        try:
            await recovery.runtime.session.heartbeat.async_request_refresh()
            identity = (
                await recovery.runtime.client.async_get_cleaning_session_identity()
            )
        except MaticError:
            identity = None
        if identity is not None and recovery.floor_is_current():
            return await _async_resume(recovery, identity)
        if attempt + 1 < RECOVERY_ATTEMPTS:
            await asyncio.sleep(RECOVERY_RETRY_SECONDS)
    return "restart_state_unavailable"


async def _async_resume(recovery: _Recovery, identity: bytes) -> str:
    """Check the live mission against the checkpoint and resume its phase."""
    phase, expected = recovery.restarted.phase, recovery.expected_hash
    if phase is RunPhase.DISPATCHING:
        if not identity or not _matches_mixed_session_hash(identity, expected):
            return "restart_mixed_native_mission_changed_or_ended"
        return await _async_stop_interrupted_mixed_dispatch(
            recovery.hass,
            recovery.entry,
            recovery.serial_number,
            recovery.run,
            expected,
            identity,
            recovery.generation,
            recovery.cancel,
            recovery.floor_is_current,
        )
    # Room labels authorize dispatch and credit, not STOP of an already
    # owned interrupted mission, which depends on native and floor identity.
    if not recovery.completion_is_current():
        return "restart_recovery_superseded"
    same_mission = bool(identity) and hashlib.sha256(identity).hexdigest() == expected
    ended = identity == b""
    if not (
        ended
        if phase is RunPhase.VERIFYING
        else same_mission or (phase is RunPhase.HANDOFF and ended)
    ):
        return "restart_native_mission_changed_or_ended"
    rejoined = _Rejoined(
        identity,
        _recovered_call(recovery.hass, recovery.run, recovery.checkpoint),
        RobotPort.for_entry(recovery.hass, recovery.entry, recovery.entity_id),
    )
    if phase is RunPhase.HANDOFF:
        return await _async_resume_handoff(recovery, rejoined)
    return await _async_resume_mission(recovery, rejoined)


async def _async_execute(
    recovery: _Recovery, rejoined: _Rejoined, **resume: Any
) -> str:
    """Continue in the loop a new run uses, from the restarted leg."""
    hass, manager, serial_number = (
        recovery.hass,
        recovery.manager,
        recovery.serial_number,
    )
    await async_execute_rooms(
        hass,
        rejoined.call,
        manager,
        recovery.entity_id,
        serial_number,
        recovery.rooms,
        robot=rejoined.robot,
        managed_user_command=partial(
            async_managed_user_command,
            hass,
            recovery.entry,
            manager,
            serial_number,
            recovery.entity_id,
            None,
        ),
        mapped_room_names=tuple(
            room.name for room in current_floor_plan(recovery.entry).rooms
        ),
        floor_is_current=recovery.completion_is_current,
        floor_token=recovery.floor_token,
        recovery=recovery.run,
        **resume,
    )
    return (
        "home_assistant_shutdown"
        if shutdown_suspends_run(hass, manager, serial_number)
        else "restart_execution_ended"
    )


async def _async_resume_handoff(recovery: _Recovery, rejoined: _Rejoined) -> str:
    """Settle the leg a shutdown interrupted between legs, then run the rest."""
    manager, serial_number = recovery.manager, recovery.serial_number
    identity = rejoined.identity
    if (
        changed := await async_unless_cancelled(
            _async_handoff_change(rejoined.robot, recovery.checkpoint),
            recovery.cancel,
        )
    ) is not None:
        return changed
    await manager.recovery.async_mark_recovery_status(
        serial_number, "running", reason="handoff_checkpoint_verified"
    )
    # Settle before the loop starts the next leg, as recovery always
    # has: the loop's own handoff may send that leg while the robot
    # still drives home.
    settled = await async_wait_for_settled_leg_handoff(
        rejoined.robot,
        recovery.cancel,
        expected_identity=identity if identity else None,
        reject_new_identity=not identity,
        timeout_seconds=LEG_HANDOFF_TIMEOUT_SECONDS,
        finish_room_event=manager.control.finish_room_event(serial_number),
    )
    if manager.control.finish_room_event(serial_number).is_set():
        return "restart_stop_requested"
    if not settled:
        return "restart_handoff_unsettled"
    if recovery.lost_ownership() or not recovery.completion_is_current():
        return "restart_recovery_cancelled"
    return await _async_execute(
        recovery,
        rejoined,
        recovered_dispatch=None,
        handoff_expected_identity=identity or b"",
    )


async def _async_resume_mission(recovery: _Recovery, rejoined: _Rejoined) -> str:
    """Rejoin an accepted mission, or finish the history read of an ended one."""
    manager, serial_number = recovery.manager, recovery.serial_number
    checkpoint, identity = recovery.checkpoint, rejoined.identity
    dispatched_at = stored_instant(checkpoint.dispatched_at)
    assert dispatched_at is not None
    recovered = await async_unless_cancelled(
        _async_recovered_history(rejoined.robot, checkpoint, identity),
        recovery.cancel,
    )
    if recovered is None:
        return _CHECKPOINT_UNVERIFIED
    baseline, session_hash = recovered
    # Recheck after I/O: Stop, takeover, and map transitions win recovery.
    if (
        recovery.lost_ownership()
        or not recovery.completion_is_current()
        or await recovery.runtime.client.async_get_cleaning_session_identity()
        not in {identity, b""}
    ):
        return "restart_recovery_superseded"
    # The same mission was verified above. An explicit end during the
    # history read is a terminal handoff, not a takeover; the executor still
    # requires normal return and native room evidence before crediting it.
    await manager.recovery.async_mark_recovery_status(
        serial_number, "running", reason="same_native_mission_verified"
    )
    if recovery.lost_ownership():
        return "restart_recovery_cancelled"
    leg = recovery.leg
    if recovery.restarted.phase is RunPhase.ACCEPTED:
        return await _async_execute(
            recovery,
            rejoined,
            recovered_dispatch=PreparedRoomDispatch(
                () if isinstance(leg, AreaLeg) else tuple(leg),
                baseline,
                dispatched_at,
                native_identity=identity,
                recovered=True,
                completion_deadline=stored_instant(checkpoint.completion_deadline),
                session_hash=session_hash,
            ),
        )
    # The mission end was observed and saved before shutdown. Only its
    # bounded history read resumes here, outside the loop: the loop would
    # go on to dock the robot or start the next leg, which recovery never
    # authorizes after a verifying checkpoint.
    assert isinstance(leg, list)
    return await _async_verify_ended_leg(
        recovery, rejoined, leg, baseline, dispatched_at, session_hash
    )


async def _async_verify_ended_leg(
    recovery: _Recovery,
    rejoined: _Rejoined,
    leg: list[CleaningRoom],
    baseline: frozenset[bytes] | None,
    dispatched_at: datetime,
    session_hash: str | None,
) -> str:
    """Read the ended leg's history within its saved budget and credit it."""
    manager, serial_number = recovery.manager, recovery.serial_number
    runtime = recovery.runtime
    verification_deadline = stored_instant(recovery.checkpoint.verification_deadline)
    assert verification_deadline is not None
    remaining = (verification_deadline - dt_util.utcnow()).total_seconds()
    if remaining <= 0:
        return "restart_verification_expired"
    await manager.recovery.async_mark_recovery_status(
        serial_number, "verifying", reason="native_end_previously_observed"
    )

    async def read_history(
        *, session_hash: str | None = None
    ) -> tuple[CleaningSessionRecord, ...]:
        # A new entry without a session identity must hold credit, not
        # vanish from the read.
        records = await rejoined.robot.session_history(session_hash=session_hash)
        if (
            recovery.lost_ownership()
            or not recovery.completion_is_current()
            or await runtime.client.async_get_cleaning_session_identity() != b""
        ):
            raise HomeAssistantError(
                "Completion recovery was superseded",
                translation_domain=DOMAIN,
                translation_key="run_changed",
            )
        return records

    completion_sessions: list[str] = []
    robot_ended: dict[str, RobotEnded] = {}
    evidence = await async_verify_leg_completion(
        read_history,
        baseline,
        leg,
        dispatched_at,
        robot=rejoined.robot,
        cancel_event=recovery.cancel,
        timeout_seconds=remaining,
        on_verified_session=completion_sessions.append,
        skipped_room_ids=_withheld_room_ids(recovery, leg),
        on_robot_ended=robot_ended.update,
        session_hash=session_hash,
    )
    if recovery.lost_ownership() or not recovery.completion_is_current():
        return "restart_recovery_superseded"
    return await _async_settle_ended_leg(
        recovery, rejoined, leg, evidence or {}, robot_ended, completion_sessions
    )


def _withheld_room_ids(recovery: _Recovery, leg: list[CleaningRoom]) -> set[str]:
    """Return the rooms the run kept the robot from, as the leg runner does.

    The owner's skips, and on a Smart Stop each room the robot never started:
    the robot dropped those from its mission.
    """
    return withheld_room_ids(
        recovery.manager.ledger.skipped_room_ids(
            recovery.serial_number, recovery.run.run_id
        ),
        leg,
        _entered_room_ids(recovery.checkpoint),
    )


def _entered_room_ids(checkpoint: RecoveryCheckpoint) -> tuple[str, ...] | None:
    """Return the rooms the robot entered once a Smart Stop ended its mission."""
    return (
        checkpoint.started_room_ids if checkpoint.stop_intent == "after_room" else None
    )


async def _async_settle_ended_leg(
    recovery: _Recovery,
    rejoined: _Rejoined,
    leg: list[CleaningRoom],
    evidence: dict[str, tuple[str, int]],
    robot_ended: dict[str, RobotEnded],
    completion_sessions: list[str],
) -> str:
    """Settle the leg's rooms as the leg runner does and say if the run settled.

    Rooms the run settled before the restart keep their results.
    """
    run, restarted, checkpoint = recovery.run, recovery.restarted, recovery.checkpoint
    manager, serial_number = recovery.manager, recovery.serial_number
    progress = RunProgress(
        restarted,
        checkpoint,
        partial(
            manager.recovery.async_set_recovery_checkpoint, serial_number, run.run_id
        ),
    )
    entered = _entered_room_ids(checkpoint)

    def still_owned() -> bool:
        return not recovery.lost_ownership() and recovery.completion_is_current()

    def record_room_completed(_room: CleaningRoom) -> None:
        progress.apply(
            RoomVerified(manager.recovery.counted_room_ids(serial_number, run.run_id))
        )

    try:
        await LegSettlement(
            hass=recovery.hass,
            call=rejoined.call,
            manager=manager,
            entity_id=recovery.entity_id,
            serial_number=serial_number,
            run_id=run.run_id,
            provenance=run.provenance,
            leg=leg,
            robot=rejoined.robot,
            advance=progress.advance,
            record_room_completed=record_room_completed,
            evidence_is_current=still_owned,
            credited=evidence,
            robot_ended=robot_ended,
            completion_sessions=completion_sessions,
            ending_early=lambda: entered is not None,
            entered_room_ids=entered or (),
            record_unverified=partial(
                manager.ledger.async_mark_ended_unverified, serial_number, run.plan_id
            ),
            settled_room_ids=restarted.completed_room_ids | restarted.settled_room_ids,
        ).async_settle()
    except PlanCancelledError:
        return "restart_recovery_superseded"
    return (
        progress.run.end_reason
        if progress.run.all_settled(
            {room.room_id for room in recovery.rooms},
            {
                index
                for index, item in enumerate(recovery.legs)
                if isinstance(item, AreaLeg)
            },
        )
        else "restart_remaining_queue_unverified"
    )


async def _async_finish_recovered_run(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    serial_number: str,
    run: LastRun,
    reason: str,
) -> None:
    """End the run as stopped, replaced, completed or unverified.

    A run a Smart Stop ended between rooms is then closed at the dock, as the
    executor closes one; recovery sends the robot nothing.
    """
    manager = entry.runtime_data.cleaning_plans
    checkpoint = run.checkpoint
    assert checkpoint is not None
    completed = reason in RUN_SETTLED_REASONS
    cancellation = manager.control.cancellation_reason(serial_number)
    replaced = cancellation == "motion_replaced"
    smart_stopped = (
        checkpoint.phase in {RunPhase.VERIFYING, RunPhase.HANDOFF}
        and checkpoint.stop_intent == "after_room"
        and not completed
    )
    stopped = (
        cancellation == "managed_stop"
        or reason == "restart_stop_requested"
        or checkpoint.stop_intent in {"immediate", "not_running"}
        or smart_stopped
    )
    if cancellation == "config_entry_unload":
        reason = "config_entry_unload"
    stored = manager.repository.run_record(serial_number, run.run_id)
    await async_finish_plan_run(
        hass,
        manager,
        serial_number,
        checkpoint.entity_id,
        run.started(),
        "cancelled"
        if replaced or stopped
        else "completed"
        if completed
        else "unverified",
        "managed_replaced" if replaced else "managed_stop" if stopped else reason,
        "replacement"
        if replaced
        else "managed_cancellation"
        if stopped
        else "verified_completion"
        if completed
        else "home_assistant",
        stored.completed_room_count if stored is not None else 0,
    )
    entity_id = checkpoint.entity_id
    if (
        smart_stopped
        and entity_id is not None
        and cancellation is None
        and not manager.control.stop_pending(serial_number)
    ):
        schedule_run_dock_confirmation(
            hass,
            manager,
            RobotPort.for_entry(hass, entry, entity_id),
            serial_number,
            entity_id,
            run.run_id,
            None,
        )
