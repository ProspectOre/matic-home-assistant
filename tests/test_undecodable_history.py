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

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client import api
from custom_components.matic_robot.client.models import (
    CleaningSessionRecord,
    HermesCollectionEntry,
)
from custom_components.matic_robot.managed_executor import (
    NativeHistoryIncompleteBaselineError,
    _async_dispatch_leg_command,
    _async_run_leg,
    _async_verify_leg_completion,
    _failure_reason_code,
)
from custom_components.matic_robot.native_completion import (
    match_single_room_completions,
)
from tests.test_coverage_receipts import history_key
from tests.test_history_semantics import _payload
from tests.test_plans import (
    _call,
    _leg_manager,
    _leg_record,
    _leg_rooms,
    _room,
    fast_native_history_retries,  # noqa: F401 - autouse fixture
)

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
