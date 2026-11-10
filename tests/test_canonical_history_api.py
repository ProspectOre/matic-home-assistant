"""Canonical history projection and rejected-revision propagation."""

import asyncio
import hashlib
from dataclasses import replace
from functools import partial
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.cleaning_session import (
    _canonical_cleaning_session,
    _native_history_collection_revision,
    decode_cleaning_session,
)
from custom_components.matic_robot.client.coverage_receipts import native_session_hash
from custom_components.matic_robot.client.exceptions import (
    CannotConnectError,
    NativeHistoryIncompleteError,
)
from custom_components.matic_robot.client.history_semantics import (
    MAX_HISTORY_BYTES,
    decode_history_semantics,
)
from custom_components.matic_robot.client.models import HermesCollectionEntry
from tests.test_coverage_receipts import history_key
from tests.test_history_semantics import _payload
from tests.wire_builders import _bfield, _fixed32


def test_canonical_projection_keeps_room_identity_and_stop_separate():
    session = decode_cleaning_session(_payload(mop_status=2))
    assert session is not None
    assert session.completed is True
    assert session.mission_id == 44
    assert session.mode_results[0].room_id
    assert session.combined_completed_rooms == ("Kitchen",)
    cancelled = decode_cleaning_session(_payload(stop=_bfield(8, _bfield(1, b""))))
    assert cancelled is not None
    assert cancelled.completed is False
    assert not cancelled.completed_rooms
    assert cancelled.mode_results[0].status == "completed"
    unknown = decode_cleaning_session(_payload(start_child=7))
    assert unknown is not None and unknown.completed is None
    assert not unknown.mode_results


async def test_geometry_heavy_history_retains_identity_and_per_mode_evidence():
    client = MaticHermesClient("192.0.2.1", 16320)
    circle = _bfield(1, _fixed32(1, 17.5) + _fixed32(2, 29.25)) + _fixed32(2, 0.2)
    circles = _bfield(1, circle) * 5000
    payload = _payload(
        goal_geometry=circles,
        goal_ids=((1, 2),) * 12,
        mop_status=1,
    )
    assert len(payload) > 256 * 1024
    read = AsyncMock(return_value=(HermesCollectionEntry(history_key(), payload),))
    client._collections.async_get_tracked_collection_entries = read

    (record,) = await client.async_get_cleaning_session_records(strict=True)
    session = record.session
    assert session.mission_id == 44
    assert session.partition_id == "00000000-0000-0001-0000-000000000002"
    assert session.initiator == "app"
    assert session.stop_reason == "finished"
    assert session.completed is False
    assert session.completed_rooms == ()
    assert session.combined_completed_rooms == ()
    assert [
        (result.cleaning_mode, result.status, result.duration_seconds)
        for result in session.mode_results
    ] == [("vacuum", "completed", 73), ("mop", "partial", None)]

    conflicting = _payload(
        goal_geometry=circles,
        goal_ids=((1, 2),) * 11 + ((3, 4),),
        mop_status=1,
    )
    read.return_value = (HermesCollectionEntry(history_key(), conflicting),)
    (revised,) = await client.async_get_cleaning_session_records()
    assert revised.key == record.key
    assert revised.session.partition_id is None
    assert revised.session.mode_results == ()


def test_large_history_requires_one_bounded_summary():
    geometry = _bfield(2, b"x" * (256 * 1024 + 1))
    assert decode_cleaning_session(geometry) is None
    assert decode_cleaning_session(geometry + _bfield(5, b"") * 2) is None
    assert decode_cleaning_session(b"x" * (MAX_HISTORY_BYTES + 1)) is None


async def test_owned_history_and_handoff_keys_wait_through_idle_gap():
    client = MaticHermesClient("192.0.2.1", 16320)
    old = HermesCollectionEntry(b"opaque-legacy-key", b"\xff")
    owned = HermesCollectionEntry(history_key(), _payload())

    async def stream(_collection):
        yield old
        await asyncio.sleep(0)
        yield owned

    client._collections.async_subscribe_collection_entries = stream
    client._collections.async_get_tracked_collection_entries = partial(
        client._collections.async_get_tracked_collection_entries, idle_timeout=0
    )
    with pytest.raises(NativeHistoryIncompleteError):
        await client.async_get_cleaning_session_records(strict=True)
    session_hash = native_session_hash(owned.key)
    (record,) = await client.async_get_cleaning_session_records(
        strict=True, session_hash=session_hash
    )
    assert record.key == owned.key and record.decoded
    assert await client.async_get_cleaning_session_keys(
        session_hash=session_hash,
        expected_hashes=frozenset({hashlib.sha256(owned.key).hexdigest()}),
    ) == {old.key, owned.key}


@pytest.mark.parametrize(
    "case", ["empty", "keyless", "duplicate", "limit", "unanchored"]
)
async def test_handoff_key_inventory_rejects_ambiguous_samples(case):
    client = MaticHermesClient("192.0.2.1", 16320)
    row = HermesCollectionEntry(history_key(), b"bad")
    rows = {
        "empty": (),
        "keyless": (HermesCollectionEntry(b"", b"bad"),),
        "duplicate": (row, row),
        "limit": tuple(
            HermesCollectionEntry(history_key(UUID(int=i)), b"bad") for i in range(64)
        ),
        "unanchored": (row,),
    }

    async def stream(_collection):
        for entry in rows[case]:
            yield entry

    client._collections.async_subscribe_collection_entries = stream
    expected = (
        NativeHistoryIncompleteError
        if case in {"keyless", "duplicate"}
        else CannotConnectError
    )
    with pytest.raises(expected):
        await client.async_get_cleaning_session_keys(
            session_hash="0" * 64 if case == "unanchored" else None
        )


def test_projection_handles_missing_outcomes_and_duplicate_display_names():
    semantics = decode_history_semantics(_payload())
    assert semantics is not None
    unknown = _canonical_cleaning_session(
        replace(semantics, completion_kind=None), None, None
    )
    assert unknown.completed is None
    timed = _canonical_cleaning_session(
        semantics, "2026-01-01T00:00:00+00:00", "2026-01-01T00:01:00+00:00"
    )
    assert timed.duration_seconds == 60
    duplicate = replace(
        semantics,
        mode_results=(
            semantics.mode_results[0],
            replace(
                semantics.mode_results[0], room_id="different", cleaning_mode="mop"
            ),
        ),
    )
    session = _canonical_cleaning_session(duplicate, None, None)
    assert not session.completed_rooms
    assert not session.combined_completed_rooms
    assert not session.room_durations


async def test_corrupt_revision_keeps_exact_key_for_credit_retraction():
    client = MaticHermesClient("192.0.2.1", 16320)
    client._collections.async_get_tracked_collection_entries = AsyncMock(
        return_value=(HermesCollectionEntry(history_key(), b"\xff"),)
    )
    records, revision = await client.async_get_cleaning_session_snapshot()
    assert len(records) == 1 and records[0].key == history_key()
    assert records[0].session.completed is None
    assert revision != _native_history_collection_revision(())
    assert not records[0].decoded
    assert await client.async_get_cleaning_session_snapshot(strict=True) == (
        records,
        revision,
    )


async def test_non_room_and_unknown_modern_records_keep_strict_baselines():
    client = MaticHermesClient("192.0.2.1", 16320)
    key = history_key()
    for payload in (
        _payload(modern_payload=b""),
        _payload(start_payload=_bfield(1, b"") + _bfield(3, _bfield(2, b""))),
        _payload(start_child=7),
    ):
        client._collections.async_get_tracked_collection_entries = AsyncMock(
            return_value=(HermesCollectionEntry(key, payload),)
        )
        records = await client.async_get_cleaning_session_records(strict=True)
        assert len(records) == 1 and records[0].key == key
        assert records[0].session.completed is None
        assert not records[0].session.completed_rooms
        assert not records[0].session.mode_results


def test_conflicting_modern_envelopes_remain_undecodable():
    from tests.wire_builders import _vfield

    assert decode_cleaning_session(_bfield(5, _vfield(11, 1))) is None
    assert decode_cleaning_session(_bfield(5, _bfield(11, b"") * 2)) is None


async def test_managed_baseline_accepts_an_opaque_non_room_session():
    from functools import partial

    from custom_components.matic_robot.managed_observation import (
        _async_session_history_baseline,
    )

    client = MaticHermesClient("192.0.2.1", 16320)
    client._collections.async_get_tracked_collection_entries = AsyncMock(
        return_value=(
            HermesCollectionEntry(history_key(), _payload(modern_payload=b"")),
        )
    )
    baseline = await _async_session_history_baseline(
        partial(client.async_get_cleaning_session_records, strict=True)
    )
    assert baseline is not None and set(baseline) == {history_key()}
