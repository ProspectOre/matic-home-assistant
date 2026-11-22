"""Undecodable and partial native history around owned plan dispatch.

Ported from the 0.5.3 to 0.5.5 history fixes. Payloads, keys and room names
are synthetic.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import replace
from datetime import timedelta
from functools import partial
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client import MaticHermesClient
from custom_components.matic_robot.client.cleaning_session import (
    _CLEANING_SESSION_MAX_BYTES,
    decode_cleaning_session,
)
from custom_components.matic_robot.client.coverage_receipts import native_session_hash
from custom_components.matic_robot.client.exceptions import (
    CannotConnectError,
    MaticError,
    NativeHistoryIncompleteError,
)
from custom_components.matic_robot.client.models import (
    CleaningSessionRecord,
    FloorPlan,
    HermesCollectionEntry,
    Room,
)
from custom_components.matic_robot.client.telemetry_fields import telemetry_bytes
from custom_components.matic_robot.managed_area import _async_wait_for_area_record
from custom_components.matic_robot.managed_dispatch import async_dispatch_leg_command
from custom_components.matic_robot.managed_leg import async_run_room_leg
from custom_components.matic_robot.managed_observation import (
    async_verify_leg_completion,
)
from custom_components.matic_robot.managed_run import (
    NativeHistoryIncompleteBaselineError,
    PlanCancelledError,
    PreparedRoomDispatch,
    RoomTakenOverError,
    failure_reason_code,
)
from custom_components.matic_robot.native_completion import (
    match_single_room_completions,
)
from custom_components.matic_robot.native_history import (
    reconcile_pending_native_history,
)
from custom_components.matic_robot.plan_model import plan_floor_token
from tests.client.test_coverage_receipts import history_key
from tests.client.test_history_semantics import _payload
from tests.plans.fakes import (
    kitchen_leg_ends,
    leg_manager,
    leg_record,
    leg_rooms,
    plan_room,
    run_plan_call,
)
from tests.session_fakes import FakeRobot, run_step
from tests.wire_builders import _bfield, _fixed32, _vfield

_undecodable = CleaningSessionRecord.undecodable
_BOTH = ("Kitchen", "Office")
_FOREIGN = history_key(UUID(int=1337))


def _oversized() -> bytes:
    return b"\x00" * (_CLEANING_SESSION_MAX_BYTES + 1)


def _client(entries: tuple[HermesCollectionEntry, ...]) -> MaticHermesClient:
    client = MaticHermesClient("192.0.2.1", 16320)
    client.async_get_tracked_collection_entries = AsyncMock(return_value=entries)
    return client


def _streaming(*entries: HermesCollectionEntry | None) -> MaticHermesClient:
    """Return a client whose history stream pauses at each None."""

    async def stream(_collection: str):
        for entry in entries:
            if entry is None:
                await asyncio.sleep(0)
            else:
                yield entry

    client = MaticHermesClient("192.0.2.1", 16320)
    client.async_subscribe_collection_entries = stream
    client.async_get_tracked_collection_entries = partial(
        client.async_get_tracked_collection_entries, idle_timeout=0
    )
    return client


def _kitchen(key: bytes) -> CleaningSessionRecord:
    return leg_record(("Kitchen",), ("Kitchen",), key=key)


def _owned(baseline: frozenset[bytes] | None, key: bytes) -> PreparedRoomDispatch:
    return PreparedRoomDispatch(
        (), baseline, dt_util.utcnow(), session_hash=native_session_hash(key)
    )


async def _dispatch(robot: FakeRobot, **kwargs: Any) -> PreparedRoomDispatch:
    return await async_dispatch_leg_command(
        robot.port(session_identity=robot.owned, **kwargs.pop("readers", {})),
        [plan_room("Kitchen", "room-kitchen")],
        7,
        floor_token="a" * 64,
        on_claim=AsyncMock(),
        **kwargs,
    )


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

    caplog.set_level(
        logging.DEBUG, logger="custom_components.matic_robot.client.cleaning_session"
    )
    unidentified = HermesCollectionEntry(b"", b"\xff")
    read = await _client((*entries, unidentified)).async_get_cleaning_session_records()
    assert read == records
    assert "kept 1 undecodable and dropped 1 unidentified of 3 entries" in caplog.text
    with pytest.raises(NativeHistoryIncompleteError):
        await _client((*entries, unidentified)).async_get_cleaning_session_records(
            strict=True
        )


async def test_oversized_pre_existing_record_does_not_block_a_handoff() -> None:
    client = _client((HermesCollectionEntry(history_key(), _oversized()),))
    robot = FakeRobot()

    dispatch = await _dispatch(
        robot,
        readers={"session_keys": client.async_get_cleaning_session_keys},
        expected_dispatch_history=frozenset(
            {hashlib.sha256(history_key()).hexdigest()}
        ),
    )

    assert len(robot.started) == 1
    assert dispatch.history_baseline == frozenset({history_key()})


async def test_entry_without_a_session_identity_blocks_dispatch_with_its_cause() -> (
    None
):
    client = _client((HermesCollectionEntry(b"", b"\xff"),))
    robot = FakeRobot()

    with pytest.raises(NativeHistoryIncompleteBaselineError) as raised:
        await _dispatch(
            robot,
            readers={"session_keys": client.async_get_cleaning_session_keys},
            expected_dispatch_history=frozenset(),
        )
    assert robot.started == []
    assert "doesn't identify its" in str(raised.value)
    assert failure_reason_code(raised.value) == "native_history_incomplete"


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
    partial_record = leg_record(_BOTH, ("Kitchen",), completed=False)
    reader = AsyncMock(
        side_effect=[(partial_record,), (partial_record, _undecodable(b"new"))]
    )

    evidence = await async_verify_leg_completion(
        reader,
        frozenset(),
        leg_rooms(),
        dt_util.utcnow() - timedelta(minutes=5),
        robot=FakeRobot().port(),
        attempts=2,
    )

    assert evidence is None
    assert reader.await_count == 2


async def _run_leg(hass, owned_records):
    """Run a tracked two-room leg whose history holds an unreadable old entry."""
    robot = FakeRobot()
    manager = leg_manager()
    robot.on_start = kitchen_leg_ends(hass, robot)

    async def history(**_: object) -> tuple[CleaningSessionRecord, ...]:
        # Built at read time so the records end after the leg was dispatched.
        return (_undecodable(_FOREIGN), *owned_records(robot.history_key()))

    completed = await async_run_room_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        leg_rooms(),
        robot.port(session_history=history, session_identity=robot.accepting),
        7,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )
    return completed, manager


async def test_unrelated_undecodable_record_does_not_block_leg_credit(
    hass, monkeypatch
) -> None:
    completed, manager = await _run_leg(
        hass, lambda key: (leg_record(_BOTH, _BOTH, key=key),)
    )

    assert completed is True
    assert manager.ledger.async_mark_completed.await_count == 2
    manager.ledger.async_mark_ended_unverified.assert_not_awaited()


async def test_undecodable_own_record_leaves_leg_rooms_unverified_and_due(
    hass, monkeypatch
) -> None:
    """No completion credit is recorded, so cadence progress and due state hold."""
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_ATTEMPTS", 2
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    completed, manager = await _run_leg(hass, lambda key: (_undecodable(key),))

    assert completed is False
    manager.ledger.async_mark_completed.assert_not_awaited()
    manager.ledger.async_mark_failed.assert_not_awaited()
    unverified = [
        call.args[2].name
        for call in manager.ledger.async_mark_ended_unverified.await_args_list
    ]
    assert unverified == ["Kitchen", "Office"]


async def test_tracked_dispatch_binds_history_to_its_echoed_session() -> None:
    robot = FakeRobot()
    history = AsyncMock(side_effect=AssertionError("must not read old history"))

    dispatch = await _dispatch(robot, readers={"session_history": history})

    history.assert_not_awaited()
    assert dispatch.history_baseline is None
    session_id = robot.started[0].session_id
    assert dispatch.session_hash == hashlib.sha256(str(session_id).encode()).hexdigest()
    assert dispatch.session_hash == native_session_hash(robot.history_key())


@pytest.mark.parametrize(
    "case", ["ours", "foreign", "unreadable", "duplicate", "baseline"]
)
async def test_partial_history_only_credits_the_dispatched_session(case) -> None:
    key = history_key()
    record = leg_record(_BOTH, _BOTH, key=key)
    foreign = replace(record, key=_FOREIGN)
    observations = {
        "ours": (record, _undecodable(_FOREIGN)),
        "foreign": (foreign,),
        "unreadable": (_undecodable(key), foreign),
        "duplicate": (record, _undecodable(key)),
        "baseline": (record,),
    }[case]
    credits = await async_verify_leg_completion(
        AsyncMock(return_value=observations),
        frozenset({key}) if case == "baseline" else frozenset(),
        leg_rooms(),
        dt_util.utcnow() - timedelta(minutes=5),
        robot=FakeRobot().port(),
        attempts=1,
        session_hash=native_session_hash(key),
    )
    assert bool(credits) is (case == "ours")


def test_single_room_ignores_unrelated_unreadable_history_for_owned_dispatch() -> None:
    key = history_key()
    now = dt_util.utcnow()
    matches = match_single_room_completions(
        (_undecodable(_FOREIGN), _kitchen(key)),
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
    foreign = HermesCollectionEntry(_FOREIGN, _oversized())
    wanted = HermesCollectionEntry(key, _payload())
    client = _streaming(foreign, None, wanted)

    ordinary = await client.async_get_cleaning_session_records(strict=True)
    assert [record.key for record in ordinary] == [foreign.key]
    targeted = await client.async_get_cleaning_session_records(
        strict=True, session_hash=native_session_hash(key)
    )
    assert [(record.key, record.decoded) for record in targeted] == [(key, True)]

    robot = FakeRobot().port(
        session_history=partial(client.async_get_cleaning_session_records, strict=True)
    )
    async with asyncio.timeout(1):
        await _async_wait_for_area_record(robot, _owned(None, key), asyncio.Event())


@pytest.mark.parametrize("external_clean", [False, True])
async def test_handoff_waits_for_known_keys_without_decoding_old_results(
    external_clean,
) -> None:
    old = HermesCollectionEntry(b"opaque-legacy-history-key", b"\xff")
    completed = HermesCollectionEntry(history_key(), _payload())
    foreign = HermesCollectionEntry(_FOREIGN, b"\xff")
    stream = (
        (old, None, foreign, completed) if external_clean else (old, None, completed)
    )
    client = _streaming(*stream)
    expected = frozenset(
        hashlib.sha256(row.key).hexdigest() for row in (old, completed)
    )
    robot = FakeRobot()
    run = partial(
        _dispatch,
        robot,
        readers={"session_keys": client.async_get_cleaning_session_keys},
        expected_dispatch_identity=b"",
        expected_dispatch_history=expected,
        expected_dispatch_revision="a" * 64,
    )

    if external_clean:
        with pytest.raises(RoomTakenOverError, match="Native history changed"):
            await run()
        assert robot.started == []
    else:
        keys = await client.async_get_cleaning_session_keys(
            session_hash=native_session_hash(completed.key)
        )
        assert keys == {old.key, completed.key}
        dispatch = await run()
        assert dispatch.history_baseline == keys
        assert [start.idle_revision for start in robot.started] == ["a" * 64]


async def test_unavailable_revision_is_unknown() -> None:
    robot = FakeRobot().port(
        idle_session_revision=AsyncMock(side_effect=CannotConnectError("offline"))
    )
    assert await robot.handoff_revision() is None


@pytest.mark.parametrize(
    "case", ["empty", "keyless", "duplicate", "limit", "unanchored"]
)
async def test_handoff_key_inventory_rejects_ambiguous_samples(case) -> None:
    key = history_key()
    rows = {
        "empty": (),
        "keyless": (HermesCollectionEntry(b"", b"bad"),),
        "duplicate": (HermesCollectionEntry(key, b"bad"),) * 2,
        "limit": tuple(
            HermesCollectionEntry(history_key(UUID(int=i)), b"bad") for i in range(64)
        ),
        "unanchored": (HermesCollectionEntry(_FOREIGN, b"bad"),),
    }[case]

    async def stream(_collection):
        for entry in rows:
            yield entry

    client = MaticHermesClient("192.0.2.1", 16320)
    client.async_subscribe_collection_entries = stream
    error = (
        NativeHistoryIncompleteError
        if case in {"keyless", "duplicate"}
        else CannotConnectError
    )
    with pytest.raises(error):
        await client.async_get_cleaning_session_keys(
            session_hash=native_session_hash(key) if case == "unanchored" else None
        )


async def test_large_owned_result_credits_only_its_own_room_evidence() -> None:
    now = dt_util.utcnow()
    started = now - timedelta(minutes=2)
    ended = started + timedelta(seconds=73)
    key = history_key()
    circle = _bfield(1, _fixed32(1, 1.0) + _fixed32(2, 2.0)) + _fixed32(2, 0.2)
    geometry = _bfield(1, circle) * 10_000

    def timed_payload(goal_ids: tuple[tuple[int, int], ...]) -> bytes:
        payload = _payload(goal_geometry=geometry, goal_ids=goal_ids)
        summary = telemetry_bytes(payload, 5, max_bytes=len(payload))
        envelope = _bfield(5, summary)
        assert payload.endswith(envelope)
        timestamps = _bfield(3, _bfield(1, _vfield(1, int(started.timestamp()))))
        timestamps += _bfield(4, _bfield(1, _vfield(1, int(ended.timestamp()))))
        return payload[: -len(envelope)] + _bfield(5, summary + timestamps)

    large = timed_payload(((1, 2),) * 12)
    assert len(large) > 2 * 1024 * 1024
    foreign = HermesCollectionEntry(_FOREIGN, _oversized())
    client = _client((foreign, HermesCollectionEntry(key, large)))
    verify = partial(
        async_verify_leg_completion,
        partial(client.async_get_cleaning_session_records, strict=True),
        None,
        [replace(plan_room("Kitchen", "room-kitchen"), cleaning_mode="vacuum")],
        started - timedelta(seconds=1),
        robot=FakeRobot().port(),
        attempts=1,
        session_hash=native_session_hash(key),
    )
    assert await verify() == {
        "room-kitchen": (ended.replace(microsecond=0).isoformat(), 73)
    }

    conflicting = timed_payload(((1, 2),) * 11 + ((3, 4),))
    client.async_get_tracked_collection_entries.return_value = (
        foreign,
        HermesCollectionEntry(key, conflicting),
    )
    assert await verify() is None


@pytest.mark.parametrize(
    "timestamp",
    [b"", _bfield(1, _vfield(1, 1) + _vfield(2, 1_000_000_000))],
)
def test_malformed_timestamp_cannot_prove_the_run_window(timestamp: bytes) -> None:
    payload = _payload()
    summary = telemetry_bytes(payload, 5)
    envelope = _bfield(5, summary)
    session = decode_cleaning_session(
        payload[: -len(envelope)] + _bfield(5, summary + _bfield(3, timestamp))
    )
    assert session is not None
    assert session.started_at is None


async def test_area_wait_requires_its_own_history_key() -> None:
    key = history_key()
    reader = AsyncMock(side_effect=[(_undecodable(_FOREIGN),), (_undecodable(key),)])
    await _async_wait_for_area_record(
        FakeRobot().port(session_history=reader),
        _owned(frozenset(), key),
        asyncio.Event(),
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
            "custom_components.matic_robot.managed_observation.SESSION_HISTORY_TIMEOUT_SECONDS",
            0.02,
        )
    if end == "already_cancelled":
        cancel.set()
    waiting = asyncio.create_task(
        _async_wait_for_area_record(
            FakeRobot().port(session_history=pending_read),
            _owned(frozenset(), history_key()),
            cancel,
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


async def test_area_record_waiter_is_bounded_and_honours_cancel(monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0.001,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_ATTEMPTS", 3
    )
    cancel = asyncio.Event()
    old = SimpleNamespace(key=b"synthetic-old")
    new = SimpleNamespace(key=b"synthetic-new")

    def wait(reader, baseline):
        dispatch = PreparedRoomDispatch((), baseline, dt_util.utcnow())
        return _async_wait_for_area_record(
            FakeRobot().port(session_history=reader), dispatch, cancel
        )

    # Nothing to wait for without a dispatch baseline or session.
    unused = AsyncMock()
    await wait(unused, None)
    unused.assert_not_awaited()

    arrives = AsyncMock(side_effect=[(old,), MaticError("busy"), (old, new)])
    await wait(arrives, frozenset({old.key}))
    assert arrives.await_count == 3

    # A record that never arrives leaves the next leg's fence to decide.
    never = AsyncMock(return_value=(old,))
    await wait(never, frozenset({old.key}))
    assert never.await_count == 3

    async def stopped(**_: object) -> tuple:
        cancel.set()
        return (old,)

    with pytest.raises(PlanCancelledError):
        await wait(stopped, frozenset({old.key}))


@pytest.mark.parametrize("marker", ["valid", "malformed", "other_floor"])
def test_persisted_reconciliation_only_credits_its_own_history(marker) -> None:
    key = history_key()
    now = dt_util.utcnow()
    floor = FloorPlan(
        42,
        "partition",
        b"partition",
        (Room("kitchen", "Kitchen", "kitchen", b"kitchen", ()),),
    )
    pending = {
        "plan_id": "away",
        "run_id": "run",
        "room_id": "kitchen",
        "room": "Kitchen",
        "cleaning_mode": "vacuum_and_mop",
        "dispatched_at": (now - timedelta(minutes=5)).isoformat(),
        "expires_at": (now + timedelta(minutes=5)).isoformat(),
        "session_hash": native_session_hash(key) if marker != "malformed" else "bad",
        "floor_token": plan_floor_token(floor) if marker != "other_floor" else "b" * 64,
    }
    robot: dict[str, Any] = {
        "rotations": {},
        "rooms": {},
        "pending_native_reconciliation": pending,
    }
    assert not reconcile_pending_native_history(robot, floor, [_kitchen(_FOREIGN)])
    owned = [_undecodable(_FOREIGN), _kitchen(key)]
    if marker == "valid":
        assert reconcile_pending_native_history(robot, floor, owned)
        assert "pending_native_reconciliation" not in robot
    else:
        assert not reconcile_pending_native_history(robot, floor, owned)
