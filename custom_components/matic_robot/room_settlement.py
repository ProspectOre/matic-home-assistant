"""Closing a plan room without completion credit.

A room the owner skipped, or one the robot finished its mission short of,
closes here. Nothing here counts the room as cleaned: it stays due. Work the
robot did start keeps the room's turn in the rotation and counts toward its
schedule as the modes it started; a room it never started gets its turn back.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import replace
from datetime import datetime
from typing import Any, Literal

from .cadence_accounting import apply_verified_cadence
from .native_completion import RobotEnded
from .plan_model import CleaningRoom, stored_count
from .plan_records import LastRun


def settle_room_record(
    record: dict[str, Any],
    global_room: dict[str, Any],
    result: str,
    *,
    run_id: str,
    settled_at: str,
) -> bool:
    """Close a room without credit; only work the robot did keeps its turn.

    Return False when this run already settled the room, so recovery that
    replays the settlement counts nothing twice.
    """
    if (
        run_id
        and record.get("settled_run_id") == run_id
        and record.get("last_result") == result
    ):
        return False
    if run_id:
        record["settled_run_id"] = run_id
    record["last_result"] = result
    record[f"last_{result}"] = settled_at
    record[f"{result}_runs"] = stored_count(record, f"{result}_runs") + 1
    if result != "partly_cleaned":
        _restore_opportunity(record, global_room, run_id=run_id)
    return True


def count_partial_work(
    robot: dict[str, Any],
    run: LastRun | None,
    plan_id: str,
    room: CleaningRoom,
    settled: Literal["skipped"] | RobotEnded,
    *,
    run_id: str | None,
    settled_at: datetime,
) -> None:
    """Count a partly cleaned room toward its schedule as the modes it started.

    A started mop counts as the due mop, even if the vacuum never ran. A
    vacuum level is never proven by partial work, so a due level stays due.
    """
    attempted = None if isinstance(settled, str) else settled.attempted_mode
    if (
        attempted is None
        or run is None
        or not run.running
        or run.run_id != run_id
        or run.plan_id != plan_id
        or run.checkpoint is None
        or run.checkpoint.cadence_by_room is None
    ):
        return
    mode = room.cleaning_mode if attempted in {"mop", "vacuum_and_mop"} else attempted
    apply_verified_cadence(
        robot,
        run.plan_id,
        replace(room, cleaning_mode=mode),
        run.checkpoint.cadence_by_room.get(room.room_id),
        completion_id=hashlib.sha256(f"{run_id}:{room.room_id}".encode()).hexdigest(),
        completed_at=settled_at.timestamp(),
    )


def _restore_opportunity(
    record: dict[str, Any], global_room: dict[str, Any], *, run_id: str
) -> None:
    """Give back the rotation turn this run took from a room it did not clean."""
    for target in (record, global_room):
        baseline = target.pop("opportunity_before_run", None)
        if not isinstance(baseline, Mapping) or baseline.get("run_id") != run_id:
            continue
        previous = baseline.get("value")
        if isinstance(previous, str):
            target["last_opportunity"] = previous
        else:
            target.pop("last_opportunity", None)
