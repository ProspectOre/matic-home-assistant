"""Canonical history projection and rejected-revision propagation."""

from dataclasses import replace
from unittest.mock import AsyncMock

from custom_components.matic_robot.client import api
from custom_components.matic_robot.client.history_semantics import (
    decode_history_semantics,
)
from custom_components.matic_robot.client.models import HermesCollectionEntry
from tests.test_coverage_receipts import history_key
from tests.test_history_semantics import _payload
from tests.wire_builders import _bfield


def test_canonical_projection_keeps_room_identity_and_stop_separate():
    session = api._decode_cleaning_session(_payload(mop_status=2))
    assert session is not None
    assert session.completed is True
    assert session.mission_id == 44
    assert session.mode_results[0].room_id
    assert session.combined_completed_rooms == ("Kitchen",)
    cancelled = api._decode_cleaning_session(_payload(stop=_bfield(8, _bfield(1, b""))))
    assert cancelled is not None
    assert cancelled.completed is False
    assert not cancelled.completed_rooms
    assert cancelled.mode_results[0].status == "completed"
    unknown = api._decode_cleaning_session(_payload(start_child=7))
    assert unknown is not None and unknown.completed is None
    assert not unknown.mode_results


def test_projection_handles_missing_outcomes_and_duplicate_display_names():
    semantics = decode_history_semantics(_payload())
    assert semantics is not None
    unknown = api._canonical_cleaning_session(
        replace(semantics, completion_kind=None), None, None
    )
    assert unknown.completed is None
    timed = api._canonical_cleaning_session(
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
    session = api._canonical_cleaning_session(duplicate, None, None)
    assert not session.completed_rooms
    assert not session.combined_completed_rooms
    assert not session.room_durations


async def test_corrupt_revision_keeps_exact_key_for_credit_retraction():
    client = api.MaticHermesClient("192.0.2.1", 16320)
    client.async_get_tracked_collection_entries = AsyncMock(
        return_value=(HermesCollectionEntry(history_key(), b"\xff"),)
    )
    records, revision = await client.async_get_cleaning_session_snapshot()
    assert len(records) == 1 and records[0].key == history_key()
    assert records[0].decoded is False
    assert records[0].session.completed is None
    assert revision != api._native_history_collection_revision(())
    # The key still names the session, so a strict read is complete.
    assert await client.async_get_cleaning_session_snapshot(strict=True) == (
        records,
        revision,
    )


async def test_non_room_and_unknown_modern_records_keep_strict_baselines():
    client = api.MaticHermesClient("192.0.2.1", 16320)
    key = history_key()
    for payload in (
        _payload(modern_payload=b""),
        _payload(start_payload=_bfield(1, b"") + _bfield(3, _bfield(2, b""))),
        _payload(start_child=7),
    ):
        client.async_get_tracked_collection_entries = AsyncMock(
            return_value=(HermesCollectionEntry(key, payload),)
        )
        records = await client.async_get_cleaning_session_records(strict=True)
        assert len(records) == 1 and records[0].key == key
        assert records[0].decoded is True
        assert records[0].session.completed is None
        assert not records[0].session.completed_rooms
        assert not records[0].session.mode_results


def test_conflicting_modern_envelopes_remain_undecodable():
    from tests.wire_builders import _vfield

    assert api._decode_cleaning_session(_bfield(5, _vfield(11, 1))) is None
    assert api._decode_cleaning_session(_bfield(5, _bfield(11, b"") * 2)) is None


async def test_managed_baseline_accepts_an_opaque_non_room_session():
    from functools import partial

    from custom_components.matic_robot.managed_executor import (
        _async_session_history_baseline,
    )

    client = api.MaticHermesClient("192.0.2.1", 16320)
    client.async_get_tracked_collection_entries = AsyncMock(
        return_value=(
            HermesCollectionEntry(history_key(), _payload(modern_payload=b"")),
        )
    )
    baseline = await _async_session_history_baseline(
        partial(client.async_get_cleaning_session_records, strict=True)
    )
    assert baseline is not None and set(baseline) == {history_key()}
