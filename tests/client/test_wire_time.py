"""Synthetic tests for the protobuf Timestamp and Duration reader and its callers."""

from __future__ import annotations

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client.cleaning_session import (
    decode_cleaning_session,
    decode_nested_timestamp,
)
from custom_components.matic_robot.client.history_semantics import (
    MAX_DURATION_SECONDS,
)
from custom_components.matic_robot.client.operational_state import (
    decode_pose_observation_time,
)
from custom_components.matic_robot.client.wire import decode_fields, seconds_nanos
from tests.wire_builders import _bfield, _vfield

NEGATIVE_ONE = (1 << 64) - 1  # int64 -1 on the wire


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        (b"", (0, 0)),
        (_vfield(1, 5), (5, 0)),
        (_vfield(2, 7), (0, 7)),
        (_vfield(2, 7) + _vfield(1, 5) + _bfield(3, b"later"), (5, 7)),
        (
            _vfield(1, (1 << 63) - 1) + _vfield(2, 999_999_999),
            ((1 << 63) - 1, 999_999_999),
        ),
    ],
    ids=["empty", "seconds", "nanos", "any-order-unknown-skipped", "maximum"],
)
def test_seconds_nanos_reads_omitted_fields_as_zero(
    payload: bytes, expected: tuple[int, int]
) -> None:
    assert seconds_nanos(decode_fields(payload)) == expected
    assert seconds_nanos(decode_fields(memoryview(payload))) == expected


@pytest.mark.parametrize(
    "payload",
    [
        _vfield(1, 1) + _vfield(1, 1),
        _vfield(2, 1) + _vfield(2, 1),
        _bfield(1, b""),
        _vfield(1, 1) + _bfield(2, b""),
        _vfield(1, NEGATIVE_ONE),
        _vfield(1, 1 << 63),
        _vfield(2, 1_000_000_000),
        _vfield(2, NEGATIVE_ONE),
    ],
    ids=[
        "repeated-seconds",
        "repeated-nanos",
        "mistyped-seconds",
        "mistyped-nanos",
        "negative-seconds",
        "seconds-past-int64",
        "nanos-of-a-second",
        "negative-nanos",
    ],
)
def test_seconds_nanos_rejects_malformed_values(payload: bytes) -> None:
    with pytest.raises(DecodeError):
        seconds_nanos(decode_fields(payload))


def _session_time(timestamp: bytes) -> str | None:
    return decode_nested_timestamp(_bfield(3, _bfield(1, timestamp)), 3)


def test_session_time_reads_nanos_and_rejects_ambiguous_or_unset_values() -> None:
    assert (
        _session_time(_vfield(1, 1_700_000_000) + _vfield(2, 500_000_000))
        == "2023-11-14T22:13:20.500000+00:00"
    )
    # A repeated field used to resolve to its first copy.
    assert _session_time(_vfield(1, 1_700_000_000) + _vfield(1, 1)) is None
    assert _session_time(_vfield(1, 1_700_000_000) + _bfield(1, b"")) is None
    # An explicit zero used to read as 1970; an omitted one never did.
    assert _session_time(_vfield(1, 0)) is None
    assert _session_time(b"") is None
    assert _session_time(_vfield(1, NEGATIVE_ONE)) is None


def _legacy_room_durations(duration: bytes) -> tuple[tuple[str, int], ...]:
    details = _bfield(3, b"Kitchen") + _bfield(4, duration) + _vfield(5, 2)
    session = decode_cleaning_session(
        _bfield(5, _bfield(6, _bfield(1, _bfield(2, details))))
    )
    assert session is not None
    return session.room_durations


def test_legacy_room_duration_has_the_modern_bounds() -> None:
    assert _legacy_room_durations(_vfield(1, 600) + _vfield(2, 5)) == (
        ("Kitchen", 600),
    )
    assert _legacy_room_durations(b"") == (("Kitchen", 0),)
    # Each of these used to be credited: nanos went unread and seconds unbounded.
    for duration in (
        _vfield(1, 600) + _vfield(2, 1_000_000_000),
        _vfield(1, 600) + _vfield(2, 1) + _vfield(2, 1),
        _vfield(1, NEGATIVE_ONE),
        _vfield(1, MAX_DURATION_SECONDS + 1),
    ):
        assert _legacy_room_durations(duration) == ()


def _pose(timestamp: bytes) -> bytes:
    return _bfield(5, _bfield(1, timestamp))


def test_pose_time_accepts_omitted_nanos_and_rejects_an_unset_clock() -> None:
    # Protobuf omits zero nanos; a pose stamped on a whole second used to fail.
    assert (
        decode_pose_observation_time(_pose(_vfield(1, 1_800_000_000))) == 1_800_000_000
    )
    assert (
        decode_pose_observation_time(
            _pose(_vfield(1, 1_800_000_000) + _vfield(2, 250_000_000))
        )
        == 1_800_000_000.25
    )
    for timestamp in (
        _vfield(1, 0) + _vfield(2, 1),
        _vfield(1, 1_800_000_000) + _vfield(2, 0) + _bfield(2, b""),
    ):
        with pytest.raises(DecodeError):
            decode_pose_observation_time(_pose(timestamp))
