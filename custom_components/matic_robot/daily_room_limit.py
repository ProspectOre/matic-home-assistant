"""Bounded verified room completions and their local-day allowance."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, tzinfo
from typing import Any

from .client import is_sha256_hex
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


def _resolve_unknown_session_hold(
    row: dict[str, Any], session_hash: str | None
) -> bool:
    """Remove one session-bound hold after that session receives a valid time."""
    if not is_sha256_hex(session_hash):
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
    if is_sha256_hex(session_hash):
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
        if is_sha256_hex(session_hash):
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
                and not is_sha256_hex(item.get("identity"))
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
            and (item.get("identity") is None or is_sha256_hex(item.get("identity")))
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
    valid_session = session_hash if is_sha256_hex(session_hash) else None
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


@dataclass(frozen=True, slots=True)
class _LocalDay:
    """The instant an allowance is read at and the local day it falls on."""

    now: datetime
    timezone: tzinfo
    today: date

    def contains(self, stamp: datetime) -> bool | None:
        """Return whether the instant is in this day; None when it has no date."""
        try:
            return stamp.astimezone(self.timezone).date() == self.today
        except OverflowError:
            return None


@dataclass(frozen=True, slots=True)
class _DayCount:
    """The room's receipts for one local day, and whether they can be trusted."""

    completed: int
    verified: bool
    times: frozenset[datetime]


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
    if policies is None or (isinstance(policies, Mapping) and room_id not in policies):
        return {"limit": None, "completed_today": 0, "reached": False}
    policy = _valid_policy(policies, room_id)
    if policy is None:
        return _closed(None, "invalid_policy")
    limit: int = policy["limit"]
    if identity is None or policy.get("identity") != identity:
        return _closed(limit, "room_identity_unconfirmed")
    if timezone is None:
        return _closed(limit, "timezone_unavailable")
    now = now.astimezone(UTC)
    row = _completion_row(robot, room_id)
    if row is None or not _evidence_readable(row, now):
        return _closed(limit, "completion_history_unverified")
    day = _LocalDay(now, timezone, now.astimezone(timezone).date())
    count = _count_receipts(row.get("receipts", []), identity, day)
    overflow = _time(row.get("overflow_until"))
    if (
        not count.verified
        or _last_clean_uncounted(robot, room_id, count.times, day)
        or (overflow is not None and overflow > now)
    ):
        return _closed(limit, "completion_history_unverified", count.completed)
    return {
        "limit": limit,
        "completed_today": count.completed,
        "reached": count.completed >= limit,
    }


def _closed(
    limit: int | None, reason: DailyLimitReason, completed_today: int = 0
) -> DailyLimit:
    """Hold the allowance closed for a stated reason."""
    return {
        "limit": limit,
        "completed_today": completed_today,
        "reached": True,
        "reason": reason,
    }


def _valid_policy(policies: object, room_id: str) -> Mapping[str, Any] | None:
    """Return the room's stored policy when it and its limit are well formed."""
    policy = policies.get(room_id) if isinstance(policies, Mapping) else None
    limit = policy.get("limit") if isinstance(policy, Mapping) else None
    if (
        isinstance(limit, bool)
        or not isinstance(limit, int)
        or not 1 <= limit <= MAX_DAILY_ROOM_LIMIT
    ):
        return None
    return policy


def _completion_row(robot: Mapping[str, Any], room_id: str) -> Mapping[str, Any] | None:
    """Return the room's stored evidence, or None when it is not a mapping."""
    records = robot.get("daily_room_completions")
    if records is None:
        return {}
    if not isinstance(records, Mapping):
        return None
    row = records.get(room_id)
    if row is None:
        return {}
    return row if isinstance(row, Mapping) else None


def _evidence_readable(row: Mapping[str, Any], now: datetime) -> bool:
    """Return whether no hold is open and every stored field can be counted."""
    unknown_time = _time(row.get("unknown_time_until"))
    if "unknown_time_until" in row and (unknown_time is None or unknown_time > now):
        return False
    holds = row.get("unknown_time_holds", [])
    if not isinstance(holds, list) or len(holds) > MAX_RECENT_COMPLETIONS:
        return False
    if any(
        not isinstance(hold, Mapping)
        or (until := _time(hold.get("until"))) is None
        or until > now
        for hold in holds
    ):
        return False
    if "overflow_until" in row and _time(row.get("overflow_until")) is None:
        return False
    receipts = row.get("receipts", [])
    return isinstance(receipts, list) and len(receipts) <= MAX_RECENT_COMPLETIONS


def _count_receipts(receipts: list[Any], identity: str, day: _LocalDay) -> _DayCount:
    """Count the day's verified receipts for the room's current identity."""
    completed = 0
    verified = True
    times: set[datetime] = set()
    for receipt in receipts:
        if (
            not isinstance(receipt, Mapping)
            or (stamp := _time(receipt.get("at"))) is None
        ):
            return _DayCount(completed, False, frozenset(times))
        if stamp > day.now or (in_day := day.contains(stamp)) is None:
            verified = False
            continue
        if not in_day:
            continue
        times.add(stamp)
        if receipt.get("identity") is None:
            verified = False
        elif not is_sha256_hex(receipt.get("identity")):
            return _DayCount(completed, False, frozenset(times))
        elif receipt.get("identity") == identity:
            if receipt.get("unverified") in (None, False):
                completed += 1
            else:
                verified = False
    return _DayCount(completed, verified, frozenset(times))


def _last_clean_uncounted(
    robot: Mapping[str, Any],
    room_id: str,
    counted: frozenset[datetime],
    day: _LocalDay,
) -> bool:
    """Return whether the room's last recorded clean today has no receipt."""
    rooms = robot.get("rooms")
    room = rooms.get(room_id) if isinstance(rooms, Mapping) else None
    last_completed = (
        _time(room.get("last_completed")) if isinstance(room, Mapping) else None
    )
    if last_completed is None:
        return False
    # Old installations may have recorded only the most recent clean; do not
    # invent a complete daily count for that local day.
    in_day = day.contains(last_completed)
    return in_day is None or (in_day and last_completed not in counted)
