"""Pure helpers for grouped native session reconciliation."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import datetime
from typing import Any

from homeassistant.util import dt as dt_util

from .client.coverage_receipts import native_session_hash
from .client.models import CleaningSessionRecord
from .native_completion import (
    NativeRoomCompletion,
    match_session_room_completions,
    match_single_room_completions,
    native_room_key,
)


def build_grouped_native_reconciliation(
    plan_id: str,
    rooms: Sequence[Mapping[str, str]],
    dispatched_at: datetime | None,
    native_identity: bytes | None,
    floor_token: str | None,
    run_id: str | None,
) -> dict[str, Any] | None:
    """Freeze observed rooms and identity from one native grouped dispatch."""
    session_hash = native_session_hash(native_identity or b"", active=True)
    if (
        not rooms
        or dispatched_at is None
        or session_hash is None
        or not floor_token
        or not run_id
    ):
        return None
    children = [dict(room) for room in rooms]
    return {
        **children[0],
        "plan_id": plan_id,
        "run_id": run_id,
        "dispatched_at": dispatched_at.isoformat(),
        "session_hash": session_hash,
        "floor_token": floor_token,
        "rooms": children,
    }


def validated_grouped_rooms(
    value: Mapping[str, Any],
    *,
    validate_room: Callable[[object], dict[str, Any] | None],
    max_rooms: int,
) -> list[dict[str, Any]] | None:
    """Validate bounded grouped children and their envelope identity."""
    raw_rooms = value.get("rooms")
    if not isinstance(raw_rooms, list) or not 1 <= len(raw_rooms) <= max_rooms:
        return None
    envelope = {
        key: value[key]
        for key in (
            "plan_id",
            "run_id",
            "dispatched_at",
            "expires_at",
            "session_hash",
            "floor_token",
        )
    }
    rooms: list[dict[str, Any]] = []
    for raw_room in raw_rooms:
        if not isinstance(raw_room, Mapping) or "rooms" in raw_room:
            return None
        child = validate_room({**raw_room, **envelope})
        if child is None:
            return None
        rooms.append(child)
    if len({room["room_id"] for room in rooms}) != len(rooms) or len(
        {native_room_key(room["room"]) for room in rooms}
    ) != len(rooms):
        return None
    if rooms[0]["room_id"] != value.get("room_id") or rooms[0]["room"] != value.get(
        "room"
    ):
        return None
    return rooms


def match_native_reconciliation_room(
    records: Iterable[CleaningSessionRecord], pending: Mapping[str, Any], now: datetime
) -> tuple[NativeRoomCompletion, ...]:
    """Match exact session evidence for a grouped child or legacy marker."""
    dispatched_at = dt_util.parse_datetime(str(pending["dispatched_at"]))
    assert dispatched_at is not None
    if "session_hash" in pending:
        return match_session_room_completions(
            records,
            room_name=str(pending["room"]),
            cleaning_mode=str(pending["cleaning_mode"]),
            dispatched_at=dispatched_at,
            now=now,
            session_hash=str(pending["session_hash"]),
        )
    return match_single_room_completions(
        records,
        room_name=str(pending["room"]),
        cleaning_mode=(
            str(pending["cleaning_mode"])
            if pending.get("cleaning_mode") is not None
            else None
        ),
        dispatched_at=dispatched_at,
        now=now,
        legacy_policy="room_list",
    )
