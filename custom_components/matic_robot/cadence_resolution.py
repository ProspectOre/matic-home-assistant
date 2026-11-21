"""Resolve one room's effective cleaning settings from its cadence source."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .cadence import cadence_snapshot, normalize_cadence_policy
from .plan_model import (
    CadenceMapChangedError,
    CadencePolicyError,
    CadenceProgressUnverifiedError,
    CleaningRoom,
    SharedCadenceUnavailableError,
)

type _Cadence = tuple[dict[str, Any], Mapping[str, Any] | None]


@dataclass(frozen=True, slots=True)
class CadenceRequest:
    """The stored sources and caller choices one resolution reads."""

    robot: Mapping[str, Any]
    plan_id: str | None
    plan_rooms: Mapping[str, Mapping[str, Any]]
    schedules: object
    floor_token: str | None
    room_identities: Mapping[str, str]
    use_shared_schedule: bool
    apply_due_settings: bool


def unverified_cadence_modes(record: object, policy: Mapping[str, Any]) -> list[str]:
    """Return active cadence modes whose persisted progress needs owner reset."""
    raw_modes = (
        ["mop", "coverage"]
        if isinstance(record, Mapping) and record.get("accounting_unverified") is True
        else record.get("unverified_modes")
        if isinstance(record, Mapping)
        else None
    )
    if not isinstance(raw_modes, list):
        return []
    stored = {
        mode
        for mode in raw_modes
        if isinstance(mode, str) and mode in ("mop", "coverage")
    }
    return [
        mode
        for mode, field in (("mop", "mop_every_n"), ("coverage", "coverage_every_n"))
        if mode in stored and policy.get(field) is not None
    ]


def resolve_room_cadence(
    request: CadenceRequest, room: CleaningRoom
) -> tuple[CleaningRoom, dict[str, Any]]:
    """Return the room as it will be cleaned and its cadence snapshot."""
    cadence = _governing_cadence(request, room)
    if cadence is None:
        return room, _unscheduled_snapshot(room, request.use_shared_schedule)
    snapshot = _scheduled_snapshot(request, room, *cadence)
    effective = CleaningRoom(
        room.room_id,
        room.name,
        str(snapshot["effective_cleaning_mode"]),
        str(snapshot["effective_coverage_setting"]),
    )
    return effective, snapshot


def _governing_cadence(request: CadenceRequest, room: CleaningRoom) -> _Cadence | None:
    """Pick the one policy that governs the room, with its progress."""
    raw = request.plan_rooms.get(room.room_id, {})
    expected_identity = request.room_identities.get(room.room_id)
    plan_policy = _plan_room_policy(raw, expected_identity)
    if plan_policy is not None and plan_policy.get("scope") == "shared":
        # Shared schedules are defined against their saved normal vacuum mode.
        # A one-time caller's selected mode is an override, not a redefinition
        # of that schedule.
        saved_mode = (
            "vacuum"
            if request.use_shared_schedule
            else str(raw.get("cleaning_mode", "vacuum"))
        )
        shared = _shared_cadence(request, room, expected_identity, saved_mode)
        if shared is None and (
            plan_policy.get("mop_every_n") is not None
            or plan_policy.get("coverage_every_n") is not None
        ):
            raise SharedCadenceUnavailableError("shared room cadence is unavailable")
        return shared
    if request.use_shared_schedule:
        # A manual one-time mode must not invalidate the shared schedule it is
        # borrowing.
        return _shared_cadence(request, room, expected_identity, "vacuum")
    if plan_policy is not None and request.plan_id is not None:
        return _plan_cadence(request, room, plan_policy, expected_identity)
    return None


def _plan_room_policy(
    raw: Mapping[str, Any], expected_identity: str | None
) -> Mapping[str, Any] | None:
    """Return a plan room's stored policy once it is bound to this map."""
    policy = raw.get("cadence")
    stored_identity = raw.get("cadence_identity")
    if (
        isinstance(stored_identity, str)
        and expected_identity is not None
        and stored_identity != expected_identity
        and isinstance(policy, Mapping)
    ):
        raise CadenceMapChangedError("room cadence belongs to a different map")
    if policy is not None and not isinstance(policy, Mapping):
        raise CadencePolicyError("room cadence must be an object")
    return policy


def _shared_cadence(
    request: CadenceRequest,
    room: CleaningRoom,
    expected_identity: str | None,
    cleaning_mode: str,
) -> _Cadence | None:
    """Return the room's shared schedule, or None when it has no policy."""
    schedules = request.schedules
    schedule = schedules.get(room.room_id) if isinstance(schedules, Mapping) else None
    if not isinstance(schedule, Mapping) or not isinstance(
        schedule.get("policy"), Mapping
    ):
        return None
    if (
        expected_identity is not None and schedule.get("identity") != expected_identity
    ) or (
        request.floor_token is not None
        and schedule.get("floor_token") is not None
        and schedule.get("floor_token") != request.floor_token
    ):
        raise CadenceMapChangedError("shared room cadence belongs to a different map")
    policy = normalize_cadence_policy(
        {"scope": "shared", **schedule["policy"]},
        cleaning_mode=cleaning_mode,
        coverage_setting=room.coverage_setting,
    )
    if unverified_cadence_modes(schedule, policy):
        raise CadenceProgressUnverifiedError(
            "room cadence progress is unverified; reset mop and coverage before use"
        )
    return policy, schedule.get("progress")


def _plan_cadence(
    request: CadenceRequest,
    room: CleaningRoom,
    plan_policy: Mapping[str, Any],
    expected_identity: str | None,
) -> _Cadence:
    """Return the plan's own policy for the room and its verified progress."""
    policy = normalize_cadence_policy(
        plan_policy,
        cleaning_mode=room.cleaning_mode if request.apply_due_settings else "vacuum",
        coverage_setting=room.coverage_setting,
    )
    records = request.robot["plan_room_cadence"].get(request.plan_id, {})
    record = records.get(room.room_id, {}) if isinstance(records, Mapping) else {}
    if (
        isinstance(record, Mapping)
        and expected_identity is not None
        and record.get("identity") not in {None, expected_identity}
    ):
        raise CadenceMapChangedError("room cadence progress belongs to a different map")
    blocked_modes = unverified_cadence_modes(record, policy)
    if blocked_modes:
        raise CadenceProgressUnverifiedError(
            "room cadence progress is unverified; reset "
            + " and ".join(blocked_modes)
            + " before use"
        )
    return policy, record.get("progress") if isinstance(record, Mapping) else None


def _unscheduled_snapshot(
    room: CleaningRoom, use_shared_schedule: bool
) -> dict[str, Any]:
    """Describe a room no cadence policy governs: it runs as requested."""
    return {
        "scope": "plan",
        "shared_schedule_participating": use_shared_schedule,
        "mop_every_n": None,
        "coverage_every_n": None,
        "periodic_coverage_setting": None,
        "mop_progress": 0,
        "coverage_progress": 0,
        "mop_due": False,
        "coverage_due": False,
        "effective_cleaning_mode": room.cleaning_mode,
        "effective_coverage_setting": room.coverage_setting,
        "next_mop_in": None,
        "next_coverage_in": None,
        "schedule_active": False,
    }


def _scheduled_snapshot(
    request: CadenceRequest,
    room: CleaningRoom,
    policy: dict[str, Any],
    progress: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Apply the policy's due work to the room's requested settings."""
    snapshot = cadence_snapshot(
        policy,
        progress,
        cleaning_mode=room.cleaning_mode,
        coverage_setting=room.coverage_setting,
    )
    snapshot["shared_schedule_participating"] = (
        request.use_shared_schedule or snapshot.get("scope") == "shared"
    )
    if snapshot["effective_cleaning_mode"] == "mop":
        # A borrowed vacuum-strength schedule cannot change a mop-only
        # one-time run. Due coverage stays due for a vacuum run.
        snapshot["effective_coverage_setting"] = room.coverage_setting
    if not request.apply_due_settings:
        # A tracked one-off may explicitly keep its chosen settings.
        # Keep the shared due state in the checkpoint so compatible
        # verified work can satisfy it, while omitted due work stays due.
        snapshot["effective_cleaning_mode"] = room.cleaning_mode
        snapshot["effective_coverage_setting"] = room.coverage_setting
    snapshot["schedule_active"] = bool(
        policy["mop_every_n"] is not None or policy["coverage_every_n"] is not None
    )
    return snapshot
