"""Import verified external room completions into shared cadence only."""

from __future__ import annotations

import hashlib
import itertools
import math
from collections.abc import Iterable, Mapping
from typing import Any

from homeassistant.util import dt as dt_util

from .cadence import cadence_snapshot
from .client import CleaningSessionRecord, FloorPlan, native_session_hash
from .completion_ledger import (
    MAX_LEDGER_EVENTS,
    record_completion,
    retract_completion,
)
from .room_identity import room_cadence_identity

# The client requests at most this many completed sessions per history read.
MAX_NATIVE_IMPORT_RECORDS = 64


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
    since = _timestamp(state.get("since")) if isinstance(state, Mapping) else None
    enabled = isinstance(state, Mapping) and state.get("enabled") is True
    schedules = robot.get("shared_room_cadence", {})
    claims = robot.get("managed_native_sessions", {})
    changed = False
    now = dt_util.utcnow().timestamp()
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
    # Sorting history is part of each import's cost. Refuse an oversized batch
    # as a unit so a truncated view cannot retract or silently omit revisions.
    bounded_records = list(itertools.islice(records, MAX_NATIVE_IMPORT_RECORDS + 1))
    if len(bounded_records) > MAX_NATIVE_IMPORT_RECORDS:
        for schedule in schedules.values():
            if (
                isinstance(schedule, dict)
                and schedule.get("accounting_unverified") is not True
            ):
                schedule["accounting_unverified"] = True
                changed = True
        return changed
    for record in sorted(bounded_records, key=lambda item: item.session.ended_at or ""):
        session = record.session
        session_hash = native_session_hash(record.key)
        if session_hash is None:
            continue
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
        for room_id, schedule in schedules.items():
            if not isinstance(schedule, dict):
                continue
            event_id = hashlib.sha256(f"{session_hash}:{room_id}".encode()).hexdigest()
            admitted = schedule.get("native_events", {})
            if isinstance(admitted, dict) and len(admitted) > MAX_LEDGER_EVENTS:
                if schedule.get("accounting_unverified") is not True:
                    schedule["accounting_unverified"] = True
                    changed = True
                continue
            prior = admitted.get(event_id) if isinstance(admitted, dict) else None
            binding = schedule.get("native_binding")
            if not isinstance(binding, dict) or binding.get(
                "cadence_identity"
            ) != schedule.get("identity"):
                binding = {}
            protocol_id = (
                prior.get("room_uuid")
                if isinstance(prior, dict)
                else binding.get("room_uuid")
            )
            identity = {
                "mission": session.mission_id,
                "partition": session.partition_id,
                "cadence_identity": schedule.get("identity"),
                "room_uuid": protocol_id,
            }
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
            mode = (
                "vacuum_and_mop"
                if {"vacuum", "mop"} <= modes
                else (
                    "vacuum" if "vacuum" in modes else "mop" if "mop" in modes else None
                )
            )
            if prior is not None:
                if (
                    not valid
                    or mode is None
                    or not isinstance(prior, dict)
                    or any(prior.get(key) != value for key, value in identity.items())
                    or started is None
                    or not isinstance(prior.get("since"), (int, float))
                    or isinstance(prior["since"], bool)
                    or not math.isfinite(prior["since"])
                    or started < prior["since"]
                ):
                    changed = retract_completion(schedule, event_id) or changed
                    continue
            else:
                schedule_since = _timestamp(schedule.get("native_since"))
                cutoff = max(since or now, schedule_since or since or now)
                accounting = schedule.get("accounting")
                reset_cutoff = (
                    accounting.get("cutoff")
                    if isinstance(accounting, Mapping)
                    else None
                )
                if isinstance(reset_cutoff, (int, float)) and not isinstance(
                    reset_cutoff, bool
                ):
                    # A full reset prunes old admission IDs. A later revision
                    # of an old session must not revive its pre-reset work.
                    try:
                        if math.isfinite(reset_cutoff):
                            cutoff = max(cutoff, reset_cutoff)
                    except OverflowError:
                        # The ledger validation rejects malformed stored data.
                        pass
                if (
                    not enabled
                    or not valid
                    or mode is None
                    or started is None
                    or started < cutoff
                ):
                    continue
                if session.mission_id != binding.get(
                    "mission"
                ) or session.partition_id != binding.get("partition"):
                    continue
            policy = schedule.get("policy")
            if not isinstance(policy, Mapping) or ended is None:
                continue
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
            if (
                prior is None
                and isinstance(admitted, dict)
                and len(admitted) >= MAX_LEDGER_EVENTS
            ):
                if schedule.get("accounting_unverified") is not True:
                    schedule["accounting_unverified"] = True
                    changed = True
                continue
            was_unverified = schedule.get("accounting_unverified") is True
            if record_completion(
                schedule,
                event_id,
                at=ended,
                source="native",
                snapshot=snapshot,
                mode=mode,
            ):
                native_events = schedule.setdefault("native_events", {})
                if isinstance(native_events, dict):
                    native_events[event_id] = (
                        prior if prior is not None else {**identity, "since": cutoff}
                    )
                changed = True
            elif not was_unverified and schedule.get("accounting_unverified") is True:
                # record_completion refuses new rows at capacity but leaves a
                # quarantine marker for the owning transaction to persist.
                changed = True
    return changed
