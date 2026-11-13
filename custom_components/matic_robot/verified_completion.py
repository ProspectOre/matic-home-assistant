"""One verified room completion and the stored projections it updates.

A room counts as cleaned only when the robot's own history confirms it, during
the run or reconciled afterwards. Each such confirmation becomes one
`VerifiedCompletion`, and `record_verified_completion` is the only code that
turns it into stored state: the daily-limit receipt, the plan's rotation row,
the room's statistics and the room schedule's cadence credit. The caller runs
it inside the repository commit that saves the result.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from homeassistant.util import dt as dt_util

from . import daily_room_limit
from .cadence_accounting import apply_verified_cadence
from .plan_model import CleaningRoom
from .plan_timing import _record_duration_sample, _stored_count


@dataclass(frozen=True, slots=True)
class VerifiedCompletion:
    """One room the robot's history confirmed clean for a plan run."""

    plan_id: str
    room_id: str
    name: str
    completed_at: str
    # The settings the robot cleaned with: the duration tier and the cadence
    # credit's mode. None when a late native record cannot prove them.
    settings: CleaningRoom | None
    duration_seconds: int | None
    identity: str | None
    run_id: str | None
    session_hash: str | None
    # Names this credit in the schedule's completion ledger: the run, or the
    # dispatch or completion time of a run without an id.
    cadence_key: str
    cadence_state: object
    verified_coverage: str | None
    # Native history can arrive after the room map changed; its cadence credit
    # then needs the schedule's room identity to still match.
    native: bool


def global_room(robot: dict[str, Any], room_id: str, name: str) -> dict[str, Any]:
    """Return the room's statistics row, created on first use."""
    records = robot["rooms"]
    record = records.get(room_id)
    if not isinstance(record, dict):
        record = {"name": name, "completed_runs": 0}
        records[room_id] = record
    return cast(dict[str, Any], record)


def record_verified_completion(
    robot: dict[str, Any],
    completion: VerifiedCompletion,
    rotation_record: dict[str, Any],
    *,
    now: datetime,
) -> None:
    """Write one verified completion into every projection that counts it."""
    daily_room_limit.record_completion(
        robot,
        completion.room_id,
        completion.identity,
        completion.completed_at,
        now=now,
        run_id=completion.run_id,
        session_hash=completion.session_hash,
    )
    duration = completion.duration_seconds
    if duration is not None:
        _record_duration_sample(
            rotation_record, completion.settings, duration, completion.completed_at
        )
    rotation_record["last_completed"] = completion.completed_at
    rotation_record["last_result"] = "completed"
    rotation_record["completed_runs"] = (
        _stored_count(rotation_record, "completed_runs") + 1
    )
    room = global_room(robot, completion.room_id, completion.name)
    room["name"] = completion.name
    room["last_completed"] = completion.completed_at
    if duration is not None:
        room["last_duration_seconds"] = duration
    room["completed_runs"] = _stored_count(room, "completed_runs") + 1
    if completion.settings is None:
        return
    apply_verified_cadence(
        robot,
        completion.plan_id,
        completion.settings,
        completion.cadence_state,
        completion_id=hashlib.sha256(
            f"{completion.cadence_key}:{completion.room_id}".encode()
        ).hexdigest(),
        completed_at=cast(
            datetime, dt_util.parse_datetime(completion.completed_at)
        ).timestamp(),
        current_identity=completion.identity if completion.native else None,
        validate_current_identity=completion.native,
        verified_coverage=completion.verified_coverage,
    )
