"""Import verified external room completions into shared cadence only."""

from __future__ import annotations

import hashlib
import itertools
import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from homeassistant.util import dt as dt_util

from .cadence import cadence_snapshot
from .client import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    native_session_hash,
)
from .completion_ledger import (
    MAX_LEDGER_EVENTS,
    record_completion,
    retract_completion,
)
from .room_identity import room_cadence_identity

# The client requests at most this many completed sessions per history read.
MAX_NATIVE_IMPORT_RECORDS = 64


@dataclass(frozen=True, slots=True)
class _ImportWindow:
    """When this import runs and which native sessions it may admit."""

    enabled: bool
    since: float | None
    now: float


@dataclass(frozen=True, slots=True)
class _SessionEvidence:
    """One history record's session, its times and whether it may earn credit."""

    session: CleaningSession
    session_hash: str
    started: float | None
    ended: float | None
    valid: bool


def _timestamp(value: object) -> float | None:
    if not isinstance(value, str):
        return None
    parsed = dt_util.parse_datetime(value)
    if parsed is None or parsed.tzinfo is None:
        return None
    return parsed.timestamp()


def import_native_cadence(
    robot: dict[str, Any], floor: FloorPlan, records: Iterable[CleaningSessionRecord]
) -> bool:
    """Reconcile observed revisions without treating retention loss as a retraction."""
    state = robot.get("native_cleanings", {})
    schedules = robot.get("shared_room_cadence", {})
    claims = robot.get("managed_native_sessions", {})
    window = _ImportWindow(
        enabled=isinstance(state, Mapping) and state.get("enabled") is True,
        since=_timestamp(state.get("since")) if isinstance(state, Mapping) else None,
        now=dt_util.utcnow().timestamp(),
    )
    changed = _bind_schedules(schedules, floor)
    # Sorting history is part of each import's cost. Refuse an oversized batch
    # as a unit so a truncated view cannot retract or silently omit revisions.
    bounded_records = list(itertools.islice(records, MAX_NATIVE_IMPORT_RECORDS + 1))
    if len(bounded_records) > MAX_NATIVE_IMPORT_RECORDS:
        for schedule in schedules.values():
            if isinstance(schedule, dict):
                changed = _quarantine(schedule) or changed
        return changed
    for record in sorted(bounded_records, key=lambda item: item.session.ended_at or ""):
        evidence = _session_evidence(record, claims, window.now)
        if evidence is None:
            continue
        for room_id, schedule in schedules.items():
            if isinstance(schedule, dict):
                changed = (
                    _reconcile_room(schedule, room_id, evidence, window) or changed
                )
    return changed


def _bind_schedules(schedules: Mapping[str, Any], floor: FloorPlan) -> bool:
    """Refresh each schedule's proof of the native room it stands for."""
    changed = False
    # The coverage plan carries inactive floors too. Bind schedules only through
    # the verified native floor/room identity, and retain that proof while the
    # robot is on another floor so delayed history can still be reconciled.
    for room_id, schedule in schedules.items():
        if not isinstance(schedule, dict):
            continue
        matches = [
            (candidate, room)
            for candidate in (floor.history_floor_plans or (floor,))
            for room in candidate.rooms
            if room.id == room_id
            and room_cadence_identity(candidate, room_id) == schedule.get("identity")
        ]
        if len(matches) == 1:
            candidate, room = matches[0]
            observed_binding = {
                "cadence_identity": schedule["identity"],
                "mission": candidate.mission_id,
                "partition": candidate.partition_protocol_id,
                "room_uuid": room.protocol_id,
            }
            if schedule.get("native_binding") != observed_binding:
                schedule["native_binding"] = observed_binding
                changed = True
    return changed


def _quarantine(schedule: dict[str, Any]) -> bool:
    """Mark the schedule's accounting unverified; say whether that is new."""
    if schedule.get("accounting_unverified") is True:
        return False
    schedule["accounting_unverified"] = True
    return True


def _session_evidence(
    record: CleaningSessionRecord, claims: Any, now: float
) -> _SessionEvidence | None:
    """Read one record's session, or None when its history key is not one."""
    session = record.session
    session_hash = native_session_hash(record.key)
    if session_hash is None:
        return None
    started = _timestamp(session.started_at)
    ended = _timestamp(session.ended_at)
    valid = (
        session_hash not in claims
        and session.initiator
        in {"app", "schedule", "atrium", "button", "matter", "voice", "gesture"}
        and session.stop_reason == "finished"
        and session.completion_kind == "completed"
        and started is not None
        and ended is not None
        and started <= ended <= now
    )
    return _SessionEvidence(session, session_hash, started, ended, valid)


def _reconcile_room(
    schedule: dict[str, Any],
    room_id: str,
    evidence: _SessionEvidence,
    window: _ImportWindow,
) -> bool:
    """Admit, correct or retract one session's completion of one room."""
    session = evidence.session
    event_id = hashlib.sha256(f"{evidence.session_hash}:{room_id}".encode()).hexdigest()
    admitted = schedule.get("native_events", {})
    if isinstance(admitted, dict) and len(admitted) > MAX_LEDGER_EVENTS:
        return _quarantine(schedule)
    prior = admitted.get(event_id) if isinstance(admitted, dict) else None
    binding = schedule.get("native_binding")
    if not isinstance(binding, dict) or binding.get("cadence_identity") != schedule.get(
        "identity"
    ):
        binding = {}
    protocol_id = (
        prior.get("room_uuid") if isinstance(prior, dict) else binding.get("room_uuid")
    )
    identity = {
        "mission": session.mission_id,
        "partition": session.partition_id,
        "cadence_identity": schedule.get("identity"),
        "room_uuid": protocol_id,
    }
    mode = _completed_mode(session, protocol_id)
    if prior is not None:
        if not _admission_stands(prior, identity, evidence, mode):
            return retract_completion(schedule, event_id)
        admission = prior
    else:
        cutoff = _admission_cutoff(schedule, window)
        if (
            not window.enabled
            or not evidence.valid
            or mode is None
            or evidence.started is None
            or evidence.started < cutoff
            or session.mission_id != binding.get("mission")
            or session.partition_id != binding.get("partition")
        ):
            return False
        admission = {**identity, "since": cutoff}
    at_capacity = (
        prior is None
        and isinstance(admitted, dict)
        and len(admitted) >= MAX_LEDGER_EVENTS
    )
    return _record_admission(
        schedule, event_id, evidence, mode, admission, at_capacity=at_capacity
    )


def _completed_mode(session: CleaningSession, protocol_id: object) -> str | None:
    """Return the cleaning mode the session completed in the room, if any."""
    results = [
        result
        for result in session.mode_results
        if protocol_id is not None and result.room_id == protocol_id
    ]
    modes = {
        result.cleaning_mode
        for result in results
        if result.status == "completed"
        and isinstance(result.duration_seconds, int)
        and not isinstance(result.duration_seconds, bool)
        and result.duration_seconds > 0
    }
    if len({result.cleaning_mode for result in results}) != len(results):
        modes.clear()
    if {"vacuum", "mop"} <= modes:
        return "vacuum_and_mop"
    return "vacuum" if "vacuum" in modes else "mop" if "mop" in modes else None


def _admission_stands(
    prior: object,
    identity: Mapping[str, Any],
    evidence: _SessionEvidence,
    mode: str | None,
) -> bool:
    """Return whether a revised session still earns the credit it was given."""
    if (
        not evidence.valid
        or mode is None
        or not isinstance(prior, dict)
        or any(prior.get(key) != value for key, value in identity.items())
        or evidence.started is None
    ):
        return False
    since = prior.get("since")
    return (
        isinstance(since, (int, float))
        and not isinstance(since, bool)
        and math.isfinite(since)
        and evidence.started >= since
    )


def _admission_cutoff(schedule: Mapping[str, Any], window: _ImportWindow) -> float:
    """Return the earliest session start the schedule may admit."""
    schedule_since = _timestamp(schedule.get("native_since"))
    since, now = window.since, window.now
    cutoff = max(since or now, schedule_since or since or now)
    accounting = schedule.get("accounting")
    reset_cutoff = accounting.get("cutoff") if isinstance(accounting, Mapping) else None
    if isinstance(reset_cutoff, (int, float)) and not isinstance(reset_cutoff, bool):
        # A full reset prunes old admission IDs. A later revision
        # of an old session must not revive its pre-reset work.
        try:
            if math.isfinite(reset_cutoff):
                cutoff = max(cutoff, reset_cutoff)
        except OverflowError:
            # The ledger validation rejects malformed stored data.
            pass
    return cutoff


def _record_admission(
    schedule: dict[str, Any],
    event_id: str,
    evidence: _SessionEvidence,
    mode: str | None,
    admission: object,
    *,
    at_capacity: bool,
) -> bool:
    """Credit the completion to the ledger and keep its admission row."""
    policy = schedule.get("policy")
    if not isinstance(policy, Mapping) or evidence.ended is None:
        return False
    snapshot = cadence_snapshot(
        {**policy, "scope": "shared"},
        schedule.get("progress"),
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    snapshot.update(
        schedule_active=True,
        normal_cleaning_mode="vacuum",
        normal_coverage_setting="standard",
    )
    if at_capacity:
        return _quarantine(schedule)
    was_unverified = schedule.get("accounting_unverified") is True
    if record_completion(
        schedule,
        event_id,
        at=evidence.ended,
        source="native",
        snapshot=snapshot,
        mode=mode,
    ):
        native_events = schedule.setdefault("native_events", {})
        if isinstance(native_events, dict):
            native_events[event_id] = admission
        return True
    # record_completion refuses new rows at capacity but leaves a quarantine
    # marker for the owning transaction to persist.
    return not was_unverified and schedule.get("accounting_unverified") is True
