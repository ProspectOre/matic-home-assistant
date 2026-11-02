"""Canonical history projection and rejected-revision propagation."""

from dataclasses import replace
from unittest.mock import AsyncMock

import pytest

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
    assert api._decode_cleaning_session(_payload(start_child=7)) is None


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
    assert records[0].session.completed is None
    assert revision != api._native_history_collection_revision(())
    with pytest.raises(api.MaticError, match="undecodable"):
        await client.async_get_cleaning_session_snapshot(strict=True)
