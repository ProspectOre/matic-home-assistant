"""Frozen views of a robot's stored active plan and last run.

`plan_state` leaves an active plan with a plan ID and a room or area ID, and
a last run with a run and plan ID. These views read the rest once, so no
caller probes the stored mappings. Writers still edit the stored records
inside the repository's commit.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from .plan_model import (
    bounded_stop_threshold,
    has_frozen_stop_policy,
    stored_count,
)
from .plan_schema import RunTarget


def _text(record: Mapping[str, Any], key: str) -> str | None:
    value = record.get(key)
    return value if isinstance(value, str) else None


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
class LastRun:
    """The identity and tally of the latest managed run.

    ``checkpoint`` is still the stored mapping; restart recovery and the run
    machine write it.
    """

    run_id: str
    plan_id: str
    plan_name: str | None
    outcome: str | None
    room_count: int
    completed_room_count: int
    skipped_room_ids: frozenset[str]
    checkpoint: Mapping[str, Any] | None
    _stored: Mapping[str, Any] = field(repr=False, compare=False)

    @classmethod
    def parse(cls, record: Mapping[str, Any]) -> LastRun:
        checkpoint = record.get("recovery_checkpoint")
        skipped = record.get("skipped_room_ids")
        return cls(
            run_id=record["run_id"],
            plan_id=record["plan_id"],
            plan_name=_text(record, "plan_name"),
            outcome=_text(record, "outcome"),
            room_count=stored_count(record, "room_count"),
            completed_room_count=stored_count(record, "completed_room_count"),
            skipped_room_ids=frozenset(
                item for item in skipped if isinstance(item, str)
            )
            if isinstance(skipped, list)
            else frozenset(),
            checkpoint=checkpoint if isinstance(checkpoint, dict) else None,
            _stored=MappingProxyType(dict(record)),
        )

    @property
    def running(self) -> bool:
        return self.outcome == "running"

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
