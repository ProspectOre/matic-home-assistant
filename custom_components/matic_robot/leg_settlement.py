"""Settle a room leg's rooms from what the robot's history said about its mission.

A leg the run watched to its end and a verifying leg a restart reread both
settle here, so each room is credited, skipped, cancelled or left due by the
same rules and announced once.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall

from .const import DOMAIN
from .coverage_accounting import async_confirm_completed_coverage
from .managed_run import PlanCancelledError
from .native_completion import RobotEnded
from .plan_model import CleaningRoom
from .plans import CleaningPlanManager
from .robot_port import RobotPort
from .run_machine import CheckpointWrite, RoomSettled, RunEvent

type RoomResult = Literal[
    "started",
    "completed",
    "skipped",
    "ended_unverified",
    "cancelled",
    "interrupted",
    "failed",
]

_OWNERSHIP_CHANGED = "Run ownership changed before the room result could be recorded"


def fire_room_event(
    hass: HomeAssistant,
    call: ServiceCall,
    entity_id: str,
    room: CleaningRoom,
    result: RoomResult,
    *,
    run_id: str | None,
    provenance: str,
    **fields: str,
) -> None:
    """Announce one room's outcome as the ``matic_robot_room_<result>`` event."""
    hass.bus.async_fire(
        f"{DOMAIN}_room_{result}",
        {
            ATTR_ENTITY_ID: entity_id,
            "plan_id": call.data["plan_id"],
            "room_id": room.room_id,
            "room": room.name,
            "cleaning_mode": room.cleaning_mode,
            "coverage_setting": room.coverage_setting,
            "run_id": run_id,
            "provenance": provenance,
            **fields,
        },
        context=call.context,
    )


@dataclass(frozen=True, slots=True, kw_only=True)
class LegSettlement:
    """An ended leg's history verdicts and the run that records them."""

    hass: HomeAssistant
    call: ServiceCall
    manager: CleaningPlanManager
    entity_id: str
    serial_number: str
    run_id: str | None
    provenance: str
    leg: Sequence[CleaningRoom]
    robot: RobotPort
    advance: Callable[[RunEvent], Awaitable[CheckpointWrite]]
    record_room_completed: Callable[[CleaningRoom], None] | None
    # Whether the run still owns the robot and floor a room result needs.
    evidence_is_current: Callable[[], bool]
    # Room id to the robot's (ended_at, duration_seconds) for its credit.
    credited: Mapping[str, tuple[str | None, int | None]]
    # Room id to how the robot left a room it finished its mission short of.
    robot_ended: Mapping[str, RobotEnded]
    completion_sessions: Sequence[str]
    # Whether a finish request or STOP ended the mission early, which drops
    # each room the robot had not entered.
    ending_early: Callable[[], bool]
    entered_room_ids: Collection[str]
    # Records a room the history left due; False when the run no longer owns it.
    record_unverified: Callable[[CleaningRoom], Awaitable[bool]]
    # Rooms a restarted run settled before Home Assistant stopped.
    settled_room_ids: Collection[str] = ()

    @property
    def plan_id(self) -> str:
        return str(self.call.data["plan_id"])

    def announce(self, room: CleaningRoom, result: RoomResult, **fields: str) -> None:
        fire_room_event(
            self.hass,
            self.call,
            self.entity_id,
            room,
            result,
            run_id=self.run_id,
            provenance=self.provenance,
            **fields,
        )

    async def async_settle_uncredited(
        self,
        room: CleaningRoom,
        result: Literal["skipped"] | RobotEnded,
        **fields: str,
    ) -> None:
        """Settle a room without credit, as a credit would, while the run owns it."""
        if not await self.manager.ledger.async_mark_settled(
            self.serial_number,
            self.plan_id,
            room,
            result,
            run_id=self.run_id,
            completion_is_current=self.evidence_is_current,
        ):
            raise PlanCancelledError(_OWNERSHIP_CHANGED)
        await self.advance(RoomSettled(room.room_id))
        self.announce(room, "skipped", **fields)

    async def async_settle(
        self, before_rooms: Callable[[], None] | None = None
    ) -> bool:
        """Credit, skip, cancel or leave due each room; return if all settled.

        ``before_rooms`` runs once the owner's skips are read, before the
        first room is recorded. Raises PlanCancelledError when the run loses
        the robot before a result is recorded.
        """
        credited = self.credited
        session_hash = (
            self.completion_sessions[-1] if self.completion_sessions else None
        )
        verified_coverage = (
            await async_confirm_completed_coverage(
                self.manager.recovery.coverage_receipt(self.serial_number, self.run_id),
                session_hash,
                self.robot.coverage_verifier,
            )
            if credited
            else None
        )
        # A one-room leg reads the owner's skips only when history left it due.
        skipped = (
            self.manager.ledger.skipped_room_ids(self.serial_number, self.run_id)
            if self.run_id is not None
            and len(credited) < len(self.leg)
            and not (len(self.leg) == 1 and self.robot_ended)
            else ()
        )
        if before_rooms is not None:
            before_rooms()
        ledger = self.manager.ledger
        for room in self.leg:
            if room.room_id in self.settled_room_ids:
                continue
            if room.room_id in credited:
                completed_at, duration_seconds = credited[room.room_id]
                if not await ledger.async_mark_completed(
                    self.serial_number,
                    self.plan_id,
                    room,
                    run_id=self.run_id,
                    completed_at=completed_at,
                    duration_seconds=duration_seconds,
                    verified_coverage_receipt=verified_coverage,
                    completion_session_hash=session_hash,
                    completion_is_current=self.evidence_is_current,
                ):
                    raise PlanCancelledError(_OWNERSHIP_CHANGED)
                self.robot.confirm_room_completed(room.name)
                if self.record_room_completed is not None:
                    self.record_room_completed(room)
                self.announce(room, "completed", reason_code="verified_completion")
            elif room.room_id in skipped:
                # Skipped without credit, but settled, so the run goes on.
                await self.async_settle_uncredited(
                    room, "skipped", reason_code="owner_skipped"
                )
            elif self.ending_early() and room.room_id not in self.entered_room_ids:
                if not await ledger.async_mark_cancelled(
                    self.serial_number,
                    self.plan_id,
                    room,
                    completion_is_current=self.evidence_is_current,
                ):
                    raise PlanCancelledError(_OWNERSHIP_CHANGED)
                self.announce(
                    room,
                    "cancelled",
                    reason_code="managed_cancelled",
                    cause="finish_current_room_or_stop",
                )
            elif ended := self.robot_ended.get(room.room_id):
                # The robot finished its mission without reaching or finishing
                # the room. Settle it without credit so it stays due; the run
                # goes on.
                await self.async_settle_uncredited(
                    room, ended, reason_code=f"room_{ended.result}", cause="robot"
                )
            else:
                if not await self.record_unverified(room):
                    raise PlanCancelledError(_OWNERSHIP_CHANGED)
                self.announce(
                    room,
                    "ended_unverified",
                    reason_code="unverified_completion",
                    cause="unknown",
                )
        return all(
            room.room_id in credited
            or room.room_id in skipped
            or room.room_id in self.robot_ended
            or room.room_id in self.settled_room_ids
            for room in self.leg
        )
