"""Verified cadence accounting within the manager's durable transaction.

The manager owns locking, dispatch receipts, deduplication and persistence.
This module owns recovery-snapshot admission and applying one verified credit;
it has no transport, service, Home Assistant or execution dependencies.
"""

from collections.abc import Mapping
from typing import Any, Protocol

from .cadence import advance_cadence


class CadenceCompletion(Protocol):
    """The immutable room settings whose completion was verified by the runner."""

    @property
    def room_id(self) -> str: ...

    @property
    def cleaning_mode(self) -> str: ...


def _valid_room_identity(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(char in "0123456789abcdef" for char in value)
    )


def validated_cadence_snapshot(value: object) -> dict[str, Any] | None:
    """Keep bounded policy evidence and discard unsupported setting proofs."""
    if not isinstance(value, Mapping):
        return None
    scope = value.get("scope")
    if not isinstance(scope, str) or scope not in {"plan", "shared"}:
        return None
    result: dict[str, Any] = {
        "scope": scope,
        "schedule_active": value.get("schedule_active") is True,
    }
    for key in ("mop_every_n", "coverage_every_n"):
        interval = value.get(key)
        if interval is None:
            result[key] = None
        elif (
            isinstance(interval, int)
            and not isinstance(interval, bool)
            and 1 <= interval <= 100
        ):
            result[key] = interval
        else:
            return None
    coverage = value.get("periodic_coverage_setting")
    if coverage is not None and (
        not isinstance(coverage, str)
        or coverage not in {"quick", "standard", "heavy_duty"}
    ):
        return None
    result["periodic_coverage_setting"] = coverage
    mode = value.get("effective_cleaning_mode")
    coverage_setting = value.get("effective_coverage_setting")
    if not isinstance(mode, str) or mode not in {
        "vacuum",
        "mop",
        "vacuum_and_mop",
    }:
        return None
    if not isinstance(coverage_setting, str) or coverage_setting not in {
        "quick",
        "standard",
        "heavy_duty",
    }:
        return None
    result["effective_cleaning_mode"] = mode
    result["effective_coverage_setting"] = coverage_setting
    shared_participating = value.get("shared_schedule_participating")
    if isinstance(shared_participating, bool):
        result["shared_schedule_participating"] = shared_participating
    for key in ("mop_due", "coverage_due"):
        result[key] = value.get(key) is True
    if "identity" in value:
        identity = value.get("identity")
        if not _valid_room_identity(identity):
            return None
        result["identity"] = identity
    return result


def validated_cadence_snapshots(value: object) -> dict[str, dict[str, Any]] | None:
    """Normalize evidence while retaining minimal ownership from malformed rooms."""
    if not isinstance(value, Mapping):
        return None
    result: dict[str, dict[str, Any]] = {}
    for room_id, raw_snapshot in value.items():
        if not isinstance(room_id, str):
            continue
        snapshot = validated_cadence_snapshot(raw_snapshot)
        if snapshot is not None:
            result[room_id] = snapshot
            continue
        # Preserve only reservation ownership when an older or malformed
        # checkpoint lacks the evidence needed for cadence accounting.
        if not isinstance(raw_snapshot, Mapping):
            continue
        reservation: dict[str, Any] = {}
        scope = raw_snapshot.get("scope")
        if isinstance(scope, str) and scope in {"plan", "shared"}:
            reservation["scope"] = scope
        if raw_snapshot.get("shared_schedule_participating") is True:
            reservation["shared_schedule_participating"] = True
        identity = raw_snapshot.get("identity")
        if _valid_room_identity(identity):
            reservation["identity"] = identity
        if reservation:
            result[room_id] = reservation
    return result


def apply_verified_cadence(
    robot: dict[str, Any],
    plan_id: str,
    room: CadenceCompletion,
    cadence_state: object,
    *,
    current_identity: str | None = None,
    validate_current_identity: bool = False,
) -> bool:
    """Credit a managed completion; coverage stays due without causal proof."""
    if (
        not isinstance(cadence_state, Mapping)
        or cadence_state.get("schedule_active") is not True
    ):
        return False
    expected_identity = cadence_state.get("identity")
    if validate_current_identity and (
        not _valid_room_identity(expected_identity)
        or not _valid_room_identity(current_identity)
        or expected_identity != current_identity
    ):
        return False
    scope = cadence_state.get("scope")
    if scope == "shared":
        schedule = robot["shared_room_cadence"].get(room.room_id)
        if not isinstance(schedule, dict):
            return False
        identity = cadence_state.get("identity")
        if identity is not None and schedule.get("identity") != identity:
            return False
        progress = schedule.get("progress")
        policy = schedule.get("policy")
    elif scope == "plan":
        records = robot["plan_room_cadence"].setdefault(plan_id, {})
        record = records.setdefault(room.room_id, {})
        if not isinstance(record, dict):
            return False
        identity = cadence_state.get("identity")
        if identity is not None and record.get("identity") not in {None, identity}:
            return False
        if identity is not None:
            record["identity"] = identity
        progress = record.get("progress")
        policy = next(
            (
                item.get("cadence")
                for item in robot["plans"].get(plan_id, {}).get("rooms", [])
                if isinstance(item, dict) and item.get("room_id") == room.room_id
            ),
            None,
        )
    else:
        return False
    next_progress = advance_cadence(
        cadence_state,
        progress if isinstance(progress, Mapping) else None,
        verified_mode=room.cleaning_mode,
        # The current protocol cannot causally bind coverage_plan to this run.
        verified_coverage=None,
    )
    if scope == "shared":
        schedule["progress"] = next_progress
    else:
        record["progress"] = next_progress
    if isinstance(policy, dict):
        if (
            cadence_state.get("mop_due") is True
            and room.cleaning_mode == "vacuum_and_mop"
        ):
            policy["do_mop_next"] = False
    return True
