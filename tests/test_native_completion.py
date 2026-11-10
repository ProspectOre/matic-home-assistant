"""Exact native-session matching for late room completions."""

from dataclasses import replace
from datetime import timedelta
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.commands import _wrapped_uuid
from custom_components.matic_robot.client.coverage_receipts import native_session_hash
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
)
from custom_components.matic_robot.managed_observation import (
    _async_verify_leg_completion,
)
from custom_components.matic_robot.native_completion import (
    NativeHistoryReader,
    match_session_room_completions,
    match_single_room_completions,
    read_handoff_revision,
)
from custom_components.matic_robot.plan_model import CleaningRoom
from tests.wire_builders import _field


def _record(
    *,
    session_id: int = 123,
    rooms: tuple[str, ...] = ("Kitchen", "Office"),
    completed_rooms: tuple[str, ...] = ("Kitchen", "Office"),
    mode: str = "vacuum",
    started_at: str | None = None,
    started_offset_minutes: int = -2,
    ended_at: str | None = None,
    ended_offset_minutes: int = -1,
    duration: int = 45,
) -> CleaningSessionRecord:
    now = dt_util.utcnow()
    session = CleaningSession(
        started_at=started_at
        or (now + timedelta(minutes=started_offset_minutes)).isoformat(),
        ended_at=ended_at
        or (now + timedelta(minutes=ended_offset_minutes)).isoformat(),
        duration_seconds=60,
        rooms=rooms,
        room_durations=(("Kitchen", duration), ("Office", duration)),
        completed=True,
        completed_rooms=completed_rooms,
        vacuum_completed_rooms=completed_rooms if mode == "vacuum" else (),
        mop_completed_rooms=completed_rooms if mode == "mop" else (),
        mode_results=(
            (
                CleaningModeResult("Kitchen", mode, "completed", duration),
                CleaningModeResult("Office", mode, "completed", duration),
            )
            if mode == "mop"
            else ()
        ),
    )
    key = _field(2, _wrapped_uuid(str(UUID(int=session_id))))
    return CleaningSessionRecord(key, session)


def _arguments(record: CleaningSessionRecord, *, session_hash: str | None = None):
    return {
        "room_name": "Kitchen",
        "cleaning_mode": "vacuum",
        "dispatched_at": dt_util.utcnow() - timedelta(minutes=3),
        "now": dt_util.utcnow(),
        "session_hash": session_hash or native_session_hash(record.key),
    }


def test_session_room_matcher_accepts_exact_room_in_multi_room_session():
    record = _record()

    matches = match_session_room_completions((record,), **_arguments(record))

    assert len(matches) == 1
    assert matches[0].record is record
    assert matches[0].duration_seconds == 45


@pytest.mark.parametrize(
    "changes,hash_override",
    [
        ({}, "0" * 64),
        ({"ended_offset_minutes": -4, "started_offset_minutes": -5}, None),
        ({"ended_offset_minutes": 1}, None),
        ({"mode": "mop"}, None),
        ({"completed_rooms": ("Office",)}, None),
        ({"rooms": ("Office",), "completed_rooms": ("Office",)}, None),
        ({"rooms": ("Kitchen", " kitchen ")}, None),
    ],
)
def test_session_room_matcher_rejects_wrong_session_time_mode_room_or_duplicates(
    changes, hash_override
):
    record = _record(**changes)

    assert (
        match_session_room_completions(
            (record,), **_arguments(record, session_hash=hash_override)
        )
        == ()
    )


def test_session_room_matcher_bounds_ambiguity_to_two_records():
    first = _record()
    second = replace(first, key=first.key)

    matches = match_session_room_completions((first, second), **_arguments(first))

    assert len(matches) == 2


@pytest.mark.parametrize(
    "changes",
    [
        {"started_at": "invalid"},
        {"ended_at": "invalid"},
        {"started_at": "2026-01-01T01:00:00"},
        {"ended_at": "2026-01-01T01:00:00"},
        {
            "started_at": "2026-01-01T01:00:00",
            "ended_at": "2026-01-01T01:01:00",
        },
    ],
)
def test_completion_matchers_reject_untrusted_session_clocks(changes):
    record = _record(rooms=("Kitchen",), **changes)
    arguments = _arguments(record)

    assert match_session_room_completions((record,), **arguments) == ()
    arguments.pop("session_hash")
    assert match_single_room_completions((record,), **arguments) == ()


@pytest.mark.parametrize(
    "sample", ["ours", "foreign", "unreadable", "duplicate", "baseline"]
)
async def test_grouped_verification_only_credits_its_session(sample):
    record = _record()
    foreign = _record(session_id=124)
    samples = {
        "ours": (record, replace(foreign, decoded=False)),
        "foreign": (foreign,),
        "unreadable": (replace(record, decoded=False), foreign),
        "duplicate": (record, replace(record, decoded=False)),
        "baseline": (record,),
    }
    read = AsyncMock(return_value=samples[sample])
    session_hash = native_session_hash(record.key)
    evidence = await _async_verify_leg_completion(
        NativeHistoryReader(read),
        frozenset({record.key}) if sample == "baseline" else None,
        (
            CleaningRoom("kitchen", "Kitchen", "vacuum", "quick"),
            CleaningRoom("office", "Office", "vacuum", "quick"),
        ),
        dt_util.utcnow() - timedelta(minutes=3),
        attempts=1,
        session_hash=session_hash,
    )
    if sample == "ours":
        assert evidence == {
            "kitchen": (record.session.ended_at, 45),
            "office": (record.session.ended_at, 45),
        }
    else:
        assert evidence is None
    read.assert_awaited_once_with(strict=True, session_hash=session_hash)


async def test_unavailable_robot_revision_is_missing_evidence():
    reader = NativeHistoryReader(
        AsyncMock(),
        read_idle_revision=AsyncMock(side_effect=CannotConnectError("offline")),
    )
    assert await read_handoff_revision(reader) is None


@pytest.mark.parametrize("completed_rooms", [("Kitchen",), ("Kitchen", "Office")])
async def test_grouped_verification_finishes_without_waiting_for_skipped_room(
    completed_rooms,
):
    import asyncio

    record = _record(completed_rooms=completed_rooms)
    rooms = (
        CleaningRoom("kitchen", "Kitchen", "vacuum", "quick"),
        CleaningRoom("office", "Office", "vacuum", "quick"),
    )
    reader = AsyncMock(return_value=(record,))
    evidence = await asyncio.wait_for(
        _async_verify_leg_completion(
            reader,
            frozenset(),
            rooms,
            dt_util.utcnow() - timedelta(minutes=3),
            attempts=3,
            skipped_room_ids=frozenset({"office"}),
        ),
        timeout=0.1,
    )

    assert evidence == {"kitchen": (record.session.ended_at, 45)}
    reader.assert_awaited_once()
