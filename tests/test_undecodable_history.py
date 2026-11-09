"""Undecodable native history records and managed dispatch.

All payloads, keys and room names are synthetic.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import replace
from datetime import timedelta
from functools import partial
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client import api
from custom_components.matic_robot.client.coverage_receipts import native_session_hash
from custom_components.matic_robot.client.models import (
    CleaningSessionRecord,
    FloorPlan,
    HermesCollectionEntry,
    Room,
)
from custom_components.matic_robot.managed_executor import (
    NativeHistoryIncompleteBaselineError,
    PlanCancelledError,
    _async_dispatch_leg_command,
    _async_run_leg,
    _async_verify_leg_completion,
    _async_wait_for_area_record,
    _failure_reason_code,
)
from custom_components.matic_robot.native_completion import (
    NativeHistoryReader,
    match_single_room_completions,
)
from custom_components.matic_robot.plans import (
    PLAN_SESSION_ID,
    CleaningPlanManager,
    _reconcile_pending_native_history,
)
from tests.test_coverage_receipts import active_key, history_key
from tests.test_history_semantics import _payload
from tests.test_plans import (
    _call,
    _leg_manager,
    _leg_record,
    _leg_rooms,
    _room,
    fast_native_history_retries,  # noqa: F401 - autouse fixture
)
from tests.wire_builders import _bfield, _fixed32, _vfield

_undecodable = CleaningSessionRecord.undecodable
_BOTH = ("Kitchen", "Office")


def _oversized() -> bytes:
    return b"\x00" * (api._CLEANING_SESSION_MAX_BYTES + 1)


def _client(entries: tuple[HermesCollectionEntry, ...]) -> api.MaticHermesClient:
    client = api.MaticHermesClient("192.0.2.1", 16320)
    client.async_get_tracked_collection_entries = AsyncMock(return_value=entries)
    return client


def _kitchen(key: bytes) -> CleaningSessionRecord:
    return replace(_leg_record(("Kitchen",), ("Kitchen",)), key=key)


async def test_strict_read_keeps_undecodable_sessions_as_placeholders(
    caplog,
) -> None:
    entries = (
        HermesCollectionEntry(history_key(), _oversized()),
        HermesCollectionEntry(b"decodable-key", _payload()),
    )

    records = await _client(entries).async_get_cleaning_session_records(strict=True)

    assert records[0] == _undecodable(history_key())
    assert records[1].decoded is True
    assert records[1].session.completed_rooms == ("Kitchen",)

    caplog.set_level(logging.DEBUG, logger=api.__name__)
    unidentified = HermesCollectionEntry(b"", b"\xff")
    read = await _client((*entries, unidentified)).async_get_cleaning_session_records()
    assert read == records
    assert "kept 1 undecodable and dropped 1 unidentified of 3 entries" in caplog.text


async def test_oversized_pre_existing_record_does_not_block_dispatch(hass) -> None:
    client = _client((HermesCollectionEntry(history_key(), _oversized()),))
    reader = partial(client.async_get_cleaning_session_records, strict=True)

    captured = []

    async def send_command(call) -> None:
        captured.append(call.data)

    hass.services.async_register("vacuum", "send_command", send_command)

    dispatch = await _async_dispatch_leg_command(
        hass,
        _call(hass),
        "vacuum.matic",
        [_room("Kitchen", "room-kitchen")],
        None,
        reader,
    )

    assert captured[0]["command"] == "clean_rooms"
    assert dispatch.history_baseline == frozenset({history_key()})


async def test_entry_without_a_session_identity_blocks_dispatch_with_its_cause(
    hass,
) -> None:
    client = _client((HermesCollectionEntry(b"", b"\xff"),))
    send_command = AsyncMock()
    hass.services.async_register("vacuum", "send_command", send_command)

    with pytest.raises(NativeHistoryIncompleteBaselineError) as raised:
        await _async_dispatch_leg_command(
            hass,
            _call(hass),
            "vacuum.matic",
            [_room("Kitchen", "room-kitchen")],
            None,
            partial(client.async_get_cleaning_session_records, strict=True),
        )
    send_command.assert_not_awaited()
    assert "doesn't identify its" in str(raised.value)
    assert _failure_reason_code(raised.value) == "native_history_incomplete"


def test_single_room_match_holds_while_a_new_record_is_undecodable() -> None:
    good = _kitchen(b"good")
    old_decoded = _kitchen(b"old")
    now = dt_util.utcnow()
    match = partial(
        match_single_room_completions,
        room_name="Kitchen",
        cleaning_mode=None,
        dispatched_at=now - timedelta(minutes=5),
        now=now,
    )
    baseline = frozenset({b"old"})

    assert len(match((_undecodable(b"old"), good), baseline=baseline)) == 1
    assert match((_undecodable(b"new"), good), baseline=baseline) == ()
    # A record that predates dispatch is never this run's, even once it decodes.
    assert match((old_decoded,), baseline=baseline) == ()
    # History-only callers have no dispatch baseline; keep their behaviour.
    assert len(match((_undecodable(b"new"), good))) == 1


async def test_leg_credit_drops_earlier_evidence_when_a_new_record_is_undecodable() -> (
    None
):
    partial_record = _leg_record(("Kitchen", "Office"), ("Kitchen",), completed=False)
    reader = AsyncMock(
        side_effect=[(partial_record,), (partial_record, _undecodable(b"new"))]
    )

    evidence = await _async_verify_leg_completion(
        reader,
        frozenset(),
        _leg_rooms(),
        dt_util.utcnow() - timedelta(minutes=5),
        attempts=2,
    )

    assert evidence is None
    assert reader.await_count == 2


async def _run_leg(hass, new_records: Callable[[], tuple[CleaningSessionRecord, ...]]):
    rooms = _leg_rooms()
    manager = _leg_manager()

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def end_leg() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Kitchen", "low_charge": False},
            )

        hass.async_create_task(end_leg(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    reads = 0
    pre_existing = (_undecodable(b"old"),)

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        # Build new records at read time so they end after the leg was dispatched.
        return pre_existing if reads == 1 else (*pre_existing, *new_records())

    completed = await _async_run_leg(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        session_history=history,
        managed_user_command=AsyncMock(),
        motion_token=7,
    )
    return completed, manager


async def test_undecodable_pre_existing_record_does_not_block_leg_credit(hass) -> None:
    completed, manager = await _run_leg(hass, lambda: (_leg_record(_BOTH, _BOTH),))

    assert completed is True
    assert manager.async_mark_completed.await_count == 2
    manager.async_mark_ended_unverified.assert_not_awaited()


async def test_undecodable_new_record_leaves_leg_rooms_unverified_and_due(hass) -> None:
    """No completion credit is recorded, so cadence progress and due state hold."""
    completed, manager = await _run_leg(
        hass, lambda: (_leg_record(_BOTH, _BOTH), _undecodable(b"new"))
    )

    assert completed is False
    manager.async_mark_completed.assert_not_awaited()
    manager.async_mark_failed.assert_not_awaited()
    unverified = [
        call.args[2].name
        for call in manager.async_mark_ended_unverified.await_args_list
    ]
    assert unverified == ["Kitchen", "Office"]


async def test_dispatch_binds_history_to_echoed_command_id(hass) -> None:
    identity = b""
    claim = AsyncMock()
    history = AsyncMock(side_effect=AssertionError("must not read old history"))

    async def send_command(call) -> None:
        nonlocal identity
        session_id = call.data["params"][PLAN_SESSION_ID]
        claim.assert_awaited_once_with(session_id)
        identity = active_key(UUID(session_id))

    async def read_identity() -> bytes:
        return identity

    hass.services.async_register("vacuum", "send_command", send_command)
    dispatch = await _async_dispatch_leg_command(
        hass,
        _call(hass),
        "vacuum.matic",
        _leg_rooms(),
        7,
        history,
        floor_token="a" * 64,
        session_identity=read_identity,
        on_claim=claim,
    )
    history.assert_not_awaited()
    assert dispatch.history_baseline is None
    assert dispatch.session_hash is not None
    assert dispatch.session_hash == native_session_hash(identity, active=True)


@pytest.mark.parametrize(
    "case", ["ours", "foreign", "unreadable", "duplicate", "baseline"]
)
async def test_partial_history_only_credits_the_dispatched_session(case) -> None:
    key = history_key()
    foreign_key = history_key(UUID(int=1337))
    record = replace(_leg_record(_BOTH, _BOTH), key=key)
    foreign = replace(record, key=foreign_key)
    observations = {
        "ours": (record, _undecodable(foreign_key)),
        "foreign": (foreign,),
        "unreadable": (_undecodable(key), foreign),
        "duplicate": (record, _undecodable(key)),
        "baseline": (record,),
    }[case]
    credits = await _async_verify_leg_completion(
        AsyncMock(return_value=observations),
        frozenset({key}) if case == "baseline" else frozenset(),
        _leg_rooms(),
        dt_util.utcnow() - timedelta(minutes=5),
        attempts=1,
        session_hash=native_session_hash(key),
    )
    assert bool(credits) is (case == "ours")


def test_single_room_ignores_unrelated_unreadable_history_for_owned_dispatch() -> None:
    key = history_key()
    old_key = history_key(UUID(int=1337))
    now = dt_util.utcnow()
    matches = match_single_room_completions(
        (_undecodable(old_key), _kitchen(key)),
        room_name="Kitchen",
        cleaning_mode=None,
        dispatched_at=now - timedelta(minutes=5),
        now=now + timedelta(seconds=1),
        baseline=frozenset(),
        session_hash=native_session_hash(key),
    )
    assert [match.record.key for match in matches] == [key]


async def test_owned_lookup_waits_through_a_gap_and_returns_only_the_target() -> None:
    key = history_key()
    foreign = HermesCollectionEntry(history_key(UUID(int=1337)), _oversized())
    wanted = HermesCollectionEntry(key, _payload())

    async def stream(_collection):
        yield foreign
        await asyncio.sleep(0)
        yield wanted

    client = api.MaticHermesClient("192.0.2.1", 16320)
    client.async_subscribe_collection_entries = stream
    client.async_get_tracked_collection_entries = partial(
        client.async_get_tracked_collection_entries, idle_timeout=0
    )

    ordinary = await client.async_get_cleaning_session_records(strict=True)
    assert [record.key for record in ordinary] == [foreign.key]
    targeted = await client.async_get_cleaning_session_records(
        strict=True, session_hash=native_session_hash(key)
    )
    assert [(record.key, record.decoded) for record in targeted] == [(key, True)]

    async with asyncio.timeout(1):
        await _async_wait_for_area_record(
            NativeHistoryReader(client.async_get_cleaning_session_records),
            None,
            asyncio.Event(),
            session_hash=native_session_hash(key),
        )


async def test_large_owned_result_credits_only_its_canonical_room_evidence() -> None:
    now = dt_util.utcnow()
    started = now - timedelta(minutes=2)
    ended = started + timedelta(seconds=73)
    key = history_key()
    foreign_key = history_key(UUID(int=1337))
    circle = _bfield(1, _fixed32(1, 1.0) + _fixed32(2, 2.0)) + _fixed32(2, 0.2)
    geometry = _bfield(1, circle) * 10_000

    def timed_payload(goal_ids: tuple[tuple[int, int], ...]) -> bytes:
        payload = _payload(goal_geometry=geometry, goal_ids=goal_ids)
        summary = api._telemetry_bytes(payload, 5, max_bytes=len(payload))
        envelope = _bfield(5, summary)
        assert payload.endswith(envelope)
        timestamps = _bfield(3, _bfield(1, _vfield(1, int(started.timestamp()))))
        timestamps += _bfield(4, _bfield(1, _vfield(1, int(ended.timestamp()))))
        return payload[: -len(envelope)] + _bfield(5, summary + timestamps)

    large = timed_payload(((1, 2),) * 12)
    assert len(large) > 2 * 1024 * 1024
    foreign = HermesCollectionEntry(foreign_key, _oversized())
    client = _client((foreign, HermesCollectionEntry(key, large)))
    reader = NativeHistoryReader(client.async_get_cleaning_session_records)
    expected = await _async_verify_leg_completion(
        reader,
        None,
        [replace(_room("Kitchen", "room-kitchen"), cleaning_mode="vacuum")],
        started - timedelta(seconds=1),
        attempts=1,
        session_hash=native_session_hash(key),
    )
    assert expected == {"room-kitchen": (ended.replace(microsecond=0).isoformat(), 73)}

    conflicting = timed_payload(((1, 2),) * 11 + ((3, 4),))
    client.async_get_tracked_collection_entries.return_value = (
        foreign,
        HermesCollectionEntry(key, conflicting),
    )
    assert (
        await _async_verify_leg_completion(
            reader,
            None,
            [replace(_room("Kitchen", "room-kitchen"), cleaning_mode="vacuum")],
            started - timedelta(seconds=1),
            attempts=1,
            session_hash=native_session_hash(key),
        )
        is None
    )


@pytest.mark.parametrize(
    "timestamp",
    [b"", _bfield(1, _vfield(1, 1) + _vfield(2, 1_000_000_000))],
)
def test_malformed_canonical_timestamp_cannot_prove_the_run_window(
    timestamp: bytes,
) -> None:
    payload = _payload()
    summary = api._telemetry_bytes(payload, 5)
    envelope = _bfield(5, summary)
    session = api._decode_cleaning_session(
        payload[: -len(envelope)] + _bfield(5, summary + _bfield(3, timestamp))
    )
    assert session is not None
    assert session.started_at is None


async def test_area_wait_requires_its_own_history_key() -> None:
    key = history_key()
    foreign_key = history_key(UUID(int=1337))
    reader = AsyncMock(side_effect=[(_undecodable(foreign_key),), (_undecodable(key),)])
    await _async_wait_for_area_record(
        reader, frozenset(), asyncio.Event(), session_hash=native_session_hash(key)
    )
    assert reader.await_count == 2


@pytest.mark.parametrize("end", ["already_cancelled", "stop", "deadline"])
async def test_area_wait_interrupts_an_inflight_history_read(monkeypatch, end) -> None:
    cancel = asyncio.Event()
    started = asyncio.Event()
    closed = asyncio.Event()

    async def pending_read(**_kwargs):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            closed.set()

    if end == "deadline":
        monkeypatch.setattr(
            "custom_components.matic_robot.managed_executor.SESSION_HISTORY_TIMEOUT_SECONDS",
            0.02,
        )
    if end == "already_cancelled":
        cancel.set()
    key = history_key()
    waiting = asyncio.create_task(
        _async_wait_for_area_record(
            NativeHistoryReader(pending_read),
            frozenset(),
            cancel,
            session_hash=native_session_hash(key),
        )
    )
    async with asyncio.timeout(1):
        if end == "stop":
            await started.wait()
            cancel.set()
        if end == "deadline":
            await waiting
        else:
            with pytest.raises(PlanCancelledError):
                await waiting
    assert started.is_set() is (end != "already_cancelled")
    assert closed.is_set() is (end != "already_cancelled")


@pytest.mark.parametrize("marker", ["valid", "malformed"])
async def test_persisted_reconciliation_only_credits_its_own_history(
    hass, marker
) -> None:
    key = history_key()
    foreign_key = history_key(UUID(int=1337))
    now = dt_util.utcnow()
    floor = FloorPlan(
        42,
        "partition",
        b"partition",
        (Room("kitchen", "Kitchen", "kitchen", b"kitchen", ()),),
    )
    pending = {
        "plan_id": "away",
        "room_id": "kitchen",
        "room": "Kitchen",
        "dispatched_at": (now - timedelta(minutes=5)).isoformat(),
        "expires_at": (now + timedelta(minutes=5)).isoformat(),
        "session_hash": native_session_hash(key) if marker == "valid" else "invalid",
    }
    robot = CleaningPlanManager(hass)._robot("serial")
    robot["pending_native_reconciliation"] = pending
    assert not _reconcile_pending_native_history(robot, floor, [_kitchen(foreign_key)])
    if marker == "valid":
        assert _reconcile_pending_native_history(
            robot, floor, [_undecodable(foreign_key), _kitchen(key)]
        )
        assert "pending_native_reconciliation" not in robot
    else:
        assert not _reconcile_pending_native_history(robot, floor, [_kitchen(key)])
