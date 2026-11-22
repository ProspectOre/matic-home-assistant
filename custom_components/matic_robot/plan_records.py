"""Frozen views of a robot's stored active plan, last run and its checkpoint.

`plan_state` leaves an active plan with a plan ID and a room or area ID, and
a last run with a run and plan ID. These views read the rest once, so no
caller probes the stored mappings; a field of the wrong type reads as absent.
Writers edit the stored records inside the repository's commit.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from .plan_model import (
    CleaningRoom,
    PlanLeg,
    RunProvenance,
    bounded_stop_threshold,
    has_frozen_stop_policy,
    normalize_run_provenance,
    plan_legs,
    stored_count,
)
from .plan_schema import RunTarget


def _text(record: Mapping[str, Any], key: str) -> str | None:
    value = record.get(key)
    return value if isinstance(value, str) else None


def _texts(record: Mapping[str, Any], key: str) -> tuple[str, ...] | None:
    value = record.get(key)
    if not isinstance(value, list):
        return None
    return tuple(item for item in value if isinstance(item, str))


def _ids(record: Mapping[str, Any], key: str) -> frozenset[str]:
    return frozenset(_texts(record, key) or ())


def _stop_policy(record: Mapping[str, Any]) -> tuple[bool, int] | None:
    """Return the stop policy a run froze into this record, if it did."""
    if not has_frozen_stop_policy(record):
        return None
    return (
        record["finish_current_room"],
        bounded_stop_threshold(record["finish_current_room_threshold"]),
    )


@dataclass(frozen=True, slots=True)
class ActivePlan:
    """The room or custom area a managed run is cleaning now."""

    plan_id: str
    plan_name: str | None
    run_id: str | None
    room_id: str | None
    room: str | None
    area_id: str | None
    area: str | None
    status: str | None
    suspend_reason: str | None
    started: str | None
    cleaning_started: str | None
    # Seconds cleaned before the open segment: a finite, nonnegative number.
    elapsed_seconds: int | float
    segment_started: str | None
    stop_policy: tuple[bool, int] | None
    # The room, else the custom area; the one rule for both.
    target: RunTarget
    _stored: Mapping[str, Any] = field(repr=False, compare=False)

    @classmethod
    def parse(cls, record: Mapping[str, Any]) -> ActivePlan | None:
        """Read a stored active plan; None unless it names a plan and a target."""
        plan_id = record.get("plan_id")
        room_id = _text(record, "room_id")
        area_id = _text(record, "area_id")
        if not isinstance(plan_id, str):
            return None
        target: RunTarget
        if room_id is not None:
            target = {"kind": "room", "id": room_id, "name": _text(record, "room")}
        elif area_id is not None:
            target = {"kind": "area", "id": area_id, "name": _text(record, "area")}
        else:
            return None
        elapsed = record.get("active_elapsed_seconds", 0)
        if not isinstance(elapsed, int | float) or not (
            math.isfinite(elapsed) and elapsed >= 0
        ):
            elapsed = 0
        return cls(
            plan_id=plan_id,
            plan_name=_text(record, "plan_name"),
            run_id=_text(record, "run_id"),
            room_id=room_id,
            room=_text(record, "room"),
            area_id=area_id,
            area=_text(record, "area"),
            status=_text(record, "status"),
            suspend_reason=_text(record, "suspend_reason"),
            started=_text(record, "started"),
            cleaning_started=_text(record, "cleaning_started"),
            elapsed_seconds=elapsed,
            segment_started=_text(record, "active_segment_started"),
            stop_policy=_stop_policy(record),
            target=target,
            _stored=MappingProxyType(dict(record)),
        )

    def published(self) -> dict[str, Any]:
        """Return a copy of the stored form, which history publishes."""
        return dict(self._stored)


@dataclass(frozen=True, slots=True)
class RecoveryCheckpoint:
    """What a running run saved so a restart can resume it.

    ``rooms``, ``entries``, ``cadence_by_room`` and ``coverage_evidence`` stay
    in their stored form, which their own readers validate.
    """

    version: int | None
    # Whether the run sends each leg's settings with it; 0.5 and later do.
    mixed_settings: bool
    single_room_missions: bool
    entity_id: str | None
    floor_token: str | None
    data: Mapping[str, Any] | None
    phase: str | None
    leg_index: int | None
    stop_intent: str | None
    rooms: tuple[Any, ...] | None
    entries: Any
    cadence_by_room: Mapping[str, Any] | None
    coverage_evidence: Any
    finish_current_room: bool | None
    finish_current_room_threshold: int | None
    stop_policy: tuple[bool, int] | None
    completed_room_ids: frozenset[str]
    settled_room_ids: frozenset[str]
    finished_area_legs: frozenset[int]
    # None until the run starts a room, then the rooms it started, in order.
    started_room_ids: tuple[str, ...] | None
    dispatched_at: str | None
    completion_deadline: str | None
    verification_deadline: str | None
    native_identity_hash: str | None
    session_hash: str | None
    mixed_initial_session_hash: str | None
    # The stored list of history fingerprints; any other value is kept so
    # restart can refuse it.
    history_baseline: Any
    handoff_history: tuple[str, ...] | None
    handoff_revision: str | None
    # Whether a handoff saved its revision; a saved None means it was unread.
    handoff_revision_saved: bool
    _stored: Mapping[str, Any] = field(repr=False, compare=False)

    @classmethod
    def parse(cls, record: Mapping[str, Any]) -> RecoveryCheckpoint:
        record = deepcopy(dict(record))
        rooms, legs = record.get("rooms"), record.get("finished_area_legs")
        handoff = record.get("handoff_history")
        threshold = record.get("finish_current_room_threshold")
        finish = record.get("finish_current_room")
        data, cadence = record.get("data"), record.get("cadence_by_room")
        version, leg_index = record.get("version"), record.get("leg_index")
        return cls(
            version=version if isinstance(version, int) else None,
            mixed_settings=record.get("mixed_settings") is True,
            single_room_missions=record.get("single_room_missions") is True,
            entity_id=_text(record, "entity_id"),
            floor_token=_text(record, "floor_token"),
            data=MappingProxyType(data) if isinstance(data, dict) else None,
            phase=_text(record, "phase"),
            leg_index=leg_index if isinstance(leg_index, int) else None,
            stop_intent=_text(record, "stop_intent"),
            rooms=tuple(rooms) if isinstance(rooms, list) else None,
            entries=record.get("entries"),
            cadence_by_room=MappingProxyType(cadence)
            if isinstance(cadence, dict)
            else None,
            coverage_evidence=record.get("coverage_evidence"),
            finish_current_room=finish if isinstance(finish, bool) else None,
            finish_current_room_threshold=threshold
            if isinstance(threshold, int) and not isinstance(threshold, bool)
            else None,
            stop_policy=_stop_policy(record),
            completed_room_ids=_ids(record, "completed_room_ids"),
            settled_room_ids=_ids(record, "settled_room_ids"),
            finished_area_legs=frozenset(item for item in legs if isinstance(item, int))
            if isinstance(legs, list)
            else frozenset(),
            started_room_ids=_texts(record, "started_room_ids"),
            dispatched_at=_text(record, "dispatched_at"),
            completion_deadline=_text(record, "completion_deadline"),
            verification_deadline=_text(record, "verification_deadline"),
            native_identity_hash=_text(record, "native_identity_hash"),
            session_hash=_text(record, "session_hash"),
            mixed_initial_session_hash=_text(record, "mixed_initial_session_hash"),
            history_baseline=record.get("history_baseline"),
            handoff_history=tuple(handoff)
            if isinstance(handoff, list)
            and all(isinstance(item, str) for item in handoff)
            else None,
            handoff_revision=_text(record, "handoff_revision"),
            handoff_revision_saved="handoff_revision" in record,
            _stored=MappingProxyType(record),
        )

    def cleaning_rooms(self) -> list[CleaningRoom]:
        """Return the run's rooms; raises when the stored rooms are malformed."""
        if self.rooms is None:
            raise ValueError("checkpoint has no rooms")
        return [CleaningRoom(**room) for room in self.rooms]

    def legs(self) -> list[PlanLeg]:
        """Rebuild the run's legs; raises when its rooms or entries are malformed."""
        return plan_legs(
            self.cleaning_rooms(),
            self.entries,
            single_room_missions=self.single_room_missions,
        )

    def dispatching_room_leg(self) -> bool:
        """Whether the current leg is rooms, the only mixed dispatch."""
        if self.entries is None:
            # Without areas every room shares the one mixed first leg.
            return self.leg_index == 0
        try:
            legs = self.legs()
        except TypeError, ValueError:
            return False
        return (
            type(self.leg_index) is int
            and 0 <= self.leg_index < len(legs)
            and isinstance(legs[self.leg_index], list)
        )

    def stored(self) -> dict[str, Any]:
        """Return a copy of the stored form, which a checkpoint save writes."""
        return deepcopy(dict(self._stored))


# What a stored run record says about how the run began, for plan_finished.
_STARTED = (
    "plan_id",
    "run_id",
    "trigger",
    "provenance",
    "service",
    "started_at",
    "room_count",
)


@dataclass(frozen=True, slots=True)
class LastRun:
    """The latest managed run: its identity, tally and recovery checkpoint."""

    run_id: str
    plan_id: str
    plan_name: str | None
    outcome: str | None
    service: str | None
    provenance: RunProvenance
    started_at: str | None
    room_count: int
    completed_room_count: int
    skipped_room_ids: frozenset[str]
    stop_policy: tuple[bool, int] | None
    checkpoint: RecoveryCheckpoint | None
    _stored: Mapping[str, Any] = field(repr=False, compare=False)

    @classmethod
    def parse(cls, record: Mapping[str, Any]) -> LastRun:
        checkpoint = record.get("recovery_checkpoint")
        return cls(
            run_id=record["run_id"],
            plan_id=record["plan_id"],
            plan_name=_text(record, "plan_name"),
            outcome=_text(record, "outcome"),
            service=_text(record, "service"),
            provenance=normalize_run_provenance(_text(record, "provenance")),
            started_at=_text(record, "started_at"),
            room_count=stored_count(record, "room_count"),
            completed_room_count=stored_count(record, "completed_room_count"),
            skipped_room_ids=_ids(record, "skipped_room_ids"),
            stop_policy=_stop_policy(record),
            checkpoint=RecoveryCheckpoint.parse(checkpoint)
            if isinstance(checkpoint, dict)
            else None,
            _stored=MappingProxyType(dict(record)),
        )

    @property
    def running(self) -> bool:
        """Whether the run is still going: the one rule for it."""
        return self.outcome == "running"

    @property
    def live_checkpoint(self) -> RecoveryCheckpoint | None:
        """Return the checkpoint while the run runs; a restart resumes from it."""
        return self.checkpoint if self.running else None

    def started(self) -> dict[str, Any]:
        """Name the run as it began, as plan_started did."""
        return {key: self._stored.get(key) for key in _STARTED}

    def published(self) -> dict[str, Any]:
        """Return a copy of the stored form without its recovery checkpoint."""
        return deepcopy(
            {k: v for k, v in self._stored.items() if k != "recovery_checkpoint"}
        )


def stored_active_plan(robot: Mapping[str, Any]) -> ActivePlan | None:
    """Parse a robot's stored active plan."""
    record = robot.get("active_plan")
    return ActivePlan.parse(record) if record is not None else None


def stored_last_run(robot: Mapping[str, Any]) -> LastRun | None:
    """Parse a robot's stored last run."""
    record = robot.get("last_run")
    return LastRun.parse(record) if record is not None else None
