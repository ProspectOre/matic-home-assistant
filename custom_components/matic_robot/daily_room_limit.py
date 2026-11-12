"""Bounded verified room completions and their local-day allowance."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from copy import deepcopy
from datetime import UTC, datetime, timedelta, tzinfo
from typing import Any

from .plan_schema import DailyLimit, DailyLimitReason

MAX_DAILY_ROOM_LIMIT = 100
MAX_RECENT_COMPLETIONS = 1024
RECEIPT_RETENTION = timedelta(hours=72)


def _time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.astimezone(UTC) if parsed.tzinfo is not None else None
    except ValueError, OverflowError:
        return None


def _valid_identity(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(char in "0123456789abcdef" for char in value)
    )


def _valid_session_hash(value: object) -> bool:
    return _valid_identity(value)


def _resolve_unknown_session_hold(
    row: dict[str, Any], session_hash: str | None
) -> bool:
    """Remove one session-bound hold after that session receives a valid time."""
    if not _valid_session_hash(session_hash):
        return False
    holds = row.get("unknown_time_holds")
    if not isinstance(holds, list) or len(holds) > MAX_RECENT_COMPLETIONS:
        return False
    retained = [
        hold
        for hold in holds
        if not isinstance(hold, Mapping) or hold.get("session_hash") != session_hash
    ]
    if len(retained) == len(holds):
        return False
    if retained:
        row["unknown_time_holds"] = retained
    else:
        row.pop("unknown_time_holds", None)
    return True


def _mark_unknown_hold_overflow(row: dict[str, Any], now: datetime) -> bool:
    """Collapse malformed or oversized holds into a bounded fail-closed timer."""
    changed = row.get("unknown_time_holds") != []
    row["unknown_time_holds"] = []
    current_expiry = _time(row.get("overflow_until"))
    target_expiry = now + RECEIPT_RETENTION
    if current_expiry is None or current_expiry < target_expiry - timedelta(hours=1):
        row["overflow_until"] = target_expiry.isoformat()
        changed = True
    return changed


def record_unknown_completion_time(
    robot: dict[str, Any],
    room_id: str,
    *,
    now: datetime,
    session_hash: str | None = None,
) -> bool:
    """Hold an unresolved completion, binding native evidence to its session."""
    records = robot.setdefault("daily_room_completions", {})
    if not isinstance(records, dict):
        return False
    row = records.setdefault(room_id, {})
    if not isinstance(row, dict):
        return False
    now = now.astimezone(UTC)
    if _valid_session_hash(session_hash):
        holds = row.get("unknown_time_holds", [])
        if not isinstance(holds, list) or len(holds) > MAX_RECENT_COMPLETIONS:
            return _mark_unknown_hold_overflow(row, now)
        if any(
            not isinstance(hold, Mapping) or _time(hold.get("until")) is None
            for hold in holds
        ):
            return _mark_unknown_hold_overflow(row, now)
        holds = [
            hold
            for hold in holds
            if (until := _time(hold.get("until"))) is not None and until > now
        ]
        prior = next(
            (hold for hold in holds if hold.get("session_hash") == session_hash),
            None,
        )
        expiry = _time(prior.get("until")) if prior is not None else None
        if expiry is not None and expiry > now + RECEIPT_RETENTION - timedelta(hours=1):
            return False
        holds = [hold for hold in holds if hold.get("session_hash") != session_hash]
        holds.append(
            {
                "session_hash": session_hash,
                "until": (now + RECEIPT_RETENTION).isoformat(),
            }
        )
        if len(holds) > MAX_RECENT_COMPLETIONS:
            row["unknown_time_holds"] = holds[:-1]
            return _mark_unknown_hold_overflow(row, now)
        row["unknown_time_holds"] = holds
        return True
    expiry = _time(row.get("unknown_time_until"))
    if expiry is not None and expiry > now + RECEIPT_RETENTION - timedelta(hours=1):
        return False
    row["unknown_time_until"] = (now + RECEIPT_RETENTION).isoformat()
    return True


def record_completion(
    robot: dict[str, Any],
    room_id: str,
    identity: str | None,
    completed_at: str,
    *,
    now: datetime,
    run_id: str | None = None,
    session_hash: str | None = None,
    unverified: bool = False,
) -> bool:
    """Record bounded verified or ambiguous evidence in its owning transaction."""
    completed = _time(completed_at)
    if completed is None:
        return False
    now = now.astimezone(UTC)
    if completed > now:
        # A completion timestamp ahead of Home Assistant is not proof that a
        # room completed today. Keep the allowance closed for a bounded window
        # instead of counting it on either the current or a future local day.
        return record_unknown_completion_time(
            robot, room_id, now=now, session_hash=session_hash
        )
    if completed < now - RECEIPT_RETENTION:
        records = robot.get("daily_room_completions")
        row = records.get(room_id) if isinstance(records, dict) else None
        if not isinstance(row, dict):
            return False
        changed = _resolve_unknown_session_hold(row, session_hash)
        if _valid_session_hash(session_hash):
            receipts = row.get("receipts")
            if isinstance(receipts, list) and len(receipts) <= MAX_RECENT_COMPLETIONS:
                prior = next(
                    (
                        item
                        for item in receipts
                        if isinstance(item, dict)
                        and item.get("session_hash") == session_hash
                        and item.get("unverified") is True
                    ),
                    None,
                )
                if prior is not None and prior.get("at") != completed.isoformat():
                    prior["at"] = completed.isoformat()
                    changed = True
        return changed
    records = robot.setdefault("daily_room_completions", {})
    if not isinstance(records, dict):
        return False
    row = records.setdefault(room_id, {})
    if not isinstance(row, dict):
        return False
    before = deepcopy(row)
    resolved_unknown = _resolve_unknown_session_hold(row, session_hash)
    existing = row.get("receipts")
    too_many = isinstance(existing, list) and len(existing) > MAX_RECENT_COMPLETIONS
    if isinstance(existing, list) and too_many:
        existing = existing[-MAX_RECENT_COMPLETIONS:]
    invalid = "receipts" in row and (
        not isinstance(existing, list)
        or any(
            not isinstance(item, dict)
            or _time(item.get("at")) is None
            or (
                item.get("identity") is not None
                and not _valid_identity(item.get("identity"))
            )
            for item in existing
        )
    )
    receipts = (
        [
            item
            for item in existing
            if isinstance(item, dict)
            and (stamp := _time(item.get("at"))) is not None
            and stamp >= now - RECEIPT_RETENTION
            and (item.get("identity") is None or _valid_identity(item.get("identity")))
        ]
        if isinstance(existing, list)
        else []
    )
    if invalid or too_many:
        row["overflow_until"] = (now + RECEIPT_RETENTION).isoformat()
    proof = (
        hashlib.sha256((run_id + "\0" + room_id).encode()).hexdigest()
        if isinstance(run_id, str) and run_id
        else None
    )
    valid_session = (
        session_hash
        if isinstance(session_hash, str)
        and len(session_hash) == 64
        and all(char in "0123456789abcdef" for char in session_hash)
        else None
    )
    prior = next(
        (
            item
            for item in receipts
            if (proof is not None and item.get("proof") == proof)
            or (
                valid_session is not None
                and item.get("session_hash") == valid_session
                and (item.get("identity") == identity or item.get("identity") is None)
            )
        ),
        None,
    )
    if prior is not None:
        if not unverified:
            if prior.get("identity") is None and identity is not None:
                prior["identity"] = identity
            prior["at"] = completed.isoformat()
            prior.pop("unverified", None)
            if valid_session is not None:
                prior["session_hash"] = valid_session
            if proof is not None:
                prior["proof"] = proof
        elif prior.get("unverified") is True:
            # A later revision may correct this native session's timestamp.
            # Managed, verified receipts keep their original trusted instant.
            prior["at"] = completed.isoformat()
        row["receipts"] = receipts
        return row != before or resolved_unknown
    receipt: dict[str, Any] = {"at": completed.isoformat(), "identity": identity}
    if proof is not None:
        receipt["proof"] = proof
    if valid_session is not None:
        receipt["session_hash"] = valid_session
    if unverified:
        receipt["unverified"] = True
    receipts.append(receipt)
    if invalid or too_many or len(receipts) > MAX_RECENT_COMPLETIONS:
        # A bounded overflow must not silently permit a clean under the cap.
        row["overflow_until"] = (now + RECEIPT_RETENTION).isoformat()
        receipts = receipts[-MAX_RECENT_COMPLETIONS:]
    row["receipts"] = receipts
    expiry = _time(row.get("overflow_until"))
    if expiry is not None and expiry <= now:
        row.pop("overflow_until", None)
    return row != before or resolved_unknown


def daily_state(
    robot: Mapping[str, Any],
    room_id: str,
    identity: str | None,
    *,
    now: datetime,
    timezone: tzinfo | None,
) -> DailyLimit:
    """Project a bound policy against verified completions in the local day."""
    policies = robot.get("daily_room_limits")
    if policies is not None and not isinstance(policies, Mapping):
        return {
            "limit": None,
            "completed_today": 0,
            "reached": True,
            "reason": "invalid_policy",
        }
    policy = policies.get(room_id) if isinstance(policies, Mapping) else None
    if not isinstance(policy, Mapping):
        if isinstance(policies, Mapping) and room_id in policies:
            return {
                "limit": None,
                "completed_today": 0,
                "reached": True,
                "reason": "invalid_policy",
            }
        return {"limit": None, "completed_today": 0, "reached": False}
    limit = policy.get("limit")
    if (
        isinstance(limit, bool)
        or not isinstance(limit, int)
        or not 1 <= limit <= MAX_DAILY_ROOM_LIMIT
    ):
        return {
            "limit": None,
            "completed_today": 0,
            "reached": True,
            "reason": "invalid_policy",
        }
    if identity is None or policy.get("identity") != identity:
        return {
            "limit": limit,
            "completed_today": 0,
            "reached": True,
            "reason": "room_identity_unconfirmed",
        }
    if timezone is None:
        return {
            "limit": limit,
            "completed_today": 0,
            "reached": True,
            "reason": "timezone_unavailable",
        }
    now = now.astimezone(UTC)
    records = robot.get("daily_room_completions")
    if records is not None and not isinstance(records, Mapping):
        return {
            "limit": limit,
            "completed_today": 0,
            "reached": True,
            "reason": "completion_history_unverified",
        }
    row = records.get(room_id) if isinstance(records, Mapping) else None
    if row is not None and not isinstance(row, Mapping):
        return {
            "limit": limit,
            "completed_today": 0,
            "reached": True,
            "reason": "completion_history_unverified",
        }
    if not isinstance(row, Mapping):
        row = {}
    unknown_time = _time(row.get("unknown_time_until"))
    if "unknown_time_until" in row and (unknown_time is None or unknown_time > now):
        return {
            "limit": limit,
            "completed_today": 0,
            "reached": True,
            "reason": "completion_history_unverified",
        }
    holds = row.get("unknown_time_holds", [])
    if not isinstance(holds, list) or len(holds) > MAX_RECENT_COMPLETIONS:
        return {
            "limit": limit,
            "completed_today": 0,
            "reached": True,
            "reason": "completion_history_unverified",
        }
    for hold in holds:
        if (
            not isinstance(hold, Mapping)
            or (hold_until := _time(hold.get("until"))) is None
        ):
            return {
                "limit": limit,
                "completed_today": 0,
                "reached": True,
                "reason": "completion_history_unverified",
            }
        if hold_until > now and not _valid_session_hash(hold.get("session_hash")):
            return {
                "limit": limit,
                "completed_today": 0,
                "reached": True,
                "reason": "completion_history_unverified",
            }
        if hold_until > now:
            return {
                "limit": limit,
                "completed_today": 0,
                "reached": True,
                "reason": "completion_history_unverified",
            }
    overflow = _time(row.get("overflow_until"))
    if "overflow_until" in row and overflow is None:
        return {
            "limit": limit,
            "completed_today": 0,
            "reached": True,
            "reason": "completion_history_unverified",
        }
    receipts = row.get("receipts", [])
    if not isinstance(receipts, list) or len(receipts) > MAX_RECENT_COMPLETIONS:
        return {
            "limit": limit,
            "completed_today": 0,
            "reached": True,
            "reason": "completion_history_unverified",
        }
    count = 0
    ambiguous = False
    today = now.astimezone(timezone).date()
    recorded_times: set[datetime] = set()
    for receipt in receipts:
        if (
            not isinstance(receipt, Mapping)
            or (stamp := _time(receipt.get("at"))) is None
        ):
            return {
                "limit": limit,
                "completed_today": count,
                "reached": True,
                "reason": "completion_history_unverified",
            }
        if stamp > now:
            ambiguous = True
            continue
        try:
            completed_day = stamp.astimezone(timezone).date()
        except OverflowError:
            ambiguous = True
            continue
        if completed_day != today:
            continue
        recorded_times.add(stamp)
        if receipt.get("identity") is None:
            ambiguous = True
        elif not _valid_identity(receipt.get("identity")):
            return {
                "limit": limit,
                "completed_today": count,
                "reached": True,
                "reason": "completion_history_unverified",
            }
        elif receipt.get("identity") == identity:
            if receipt.get("unverified") is True:
                ambiguous = True
            elif receipt.get("unverified") not in (None, False):
                ambiguous = True
            else:
                count += 1
    rooms = robot.get("rooms")
    global_room = rooms.get(room_id) if isinstance(rooms, Mapping) else None
    last_completed = (
        _time(global_room.get("last_completed"))
        if isinstance(global_room, Mapping)
        else None
    )
    if last_completed is not None:
        try:
            last_completed_day = last_completed.astimezone(timezone).date()
        except OverflowError:
            ambiguous = True
        else:
            if last_completed_day == today and last_completed not in recorded_times:
                # Old installations may have recorded only the most recent clean;
                # do not invent a complete daily count for that local day.
                ambiguous = True
    reason: DailyLimitReason | None = (
        "completion_history_unverified"
        if ambiguous or (overflow is not None and overflow > now)
        else None
    )
    result: DailyLimit = {
        "limit": limit,
        "completed_today": count,
        "reached": count >= limit or reason is not None,
    }
    if reason:
        result["reason"] = reason
    return result
