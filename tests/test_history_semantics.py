"""Synthetic tests for canonical native history semantics."""

from __future__ import annotations

import struct

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client import history_semantics as semantics
from custom_components.matic_robot.client.history_semantics import (
    decode_history_semantics,
)
from custom_components.matic_robot.client.wire import WireField, WireFieldBudget
from tests.wire_builders import _bfield, _fixed64, _vfield


def _fixed32(number: int, value: int) -> bytes:
    return bytes(((number << 3) | 5,)) + struct.pack("<I", value)


def _uuid(high: int = 1, low: int = 2) -> bytes:
    return _fixed64(1, high) + _fixed64(2, low)


def _room(
    status: int = 2,
    mop_status: int | None = None,
    *,
    identity: bytes | None = None,
    name: bytes = b"Kitchen",
    duration: bytes | None = None,
    modes_override: bytes | None = None,
) -> bytes:
    duration = _vfield(1, 73) + _vfield(2, 0) if duration is None else duration
    mode_summary = _vfield(5, status) + _bfield(4, duration)
    modes = _bfield(2, _vfield(1, 0) + _bfield(2, mode_summary))
    if mop_status is not None:
        mop_summary = _vfield(5, mop_status)
        modes += _bfield(2, _vfield(1, 1) + _bfield(2, mop_summary))
    area = _bfield(1, name) + (modes if modes_override is None else modes_override)
    identity = _uuid() if identity is None else identity
    key = _bfield(2, _bfield(2, identity))
    return _bfield(1, key) + _bfield(2, area)


def _mode_entry(key: int = 0, status: int = 2, duration: bytes | None = None) -> bytes:
    summary = _vfield(5, status)
    if duration is not None:
        summary += _bfield(4, duration)
    return _bfield(2, _vfield(1, key) + _bfield(2, summary))


def _payload(
    *,
    stop: bytes | None = _bfield(5, _bfield(2, b"")),
    start_child: int = 1,
    schedule_name: bytes | None = None,
    vacuum_status: int = 2,
    mop_status: int | None = None,
    goals_field: int | tuple[int, ...] = 2,
    goal_ids: tuple[tuple[int, int], ...] = ((1, 2),),
    goal_geometry: bytes = b"",
    start_payload: bytes | None = None,
    reason_payload: bytes | None = None,
    event_entries: tuple[bytes, ...] | None = None,
    include_summary_reason: bool = True,
    modern_payload: bytes | None = None,
    omit_modern: bool = False,
    room_payload: bytes | None = None,
    timestamps: bytes = b"",
) -> bytes:
    # StartReason.User uses field 2; empty User denotes App.
    if schedule_name is not None:
        start_reason = _bfield(3, _bfield(2, schedule_name))
    elif start_child == 8:
        start_reason = _bfield(3, b"")
    else:
        user = _bfield(start_child, b"")
        start_reason = _bfield(2, user)
    goal_fields = (goals_field,) if isinstance(goals_field, int) else goals_field
    target = _bfield(2, _bfield(3, _bfield(2, goal_geometry))) if goal_geometry else b""
    goals = b"".join(
        _bfield(
            field,
            target + _bfield(7, _bfield(1, _bfield(1, _bfield(2, _uuid(*identity))))),
        )
        for identity in goal_ids
        for field in goal_fields
    )
    if reason_payload is not None:
        start_reason = reason_payload
    start = start_payload or (_bfield(1, goals) + _bfield(3, start_reason))
    if event_entries is None:
        event_entries = (_bfield(2, start),)
    elif start_payload is not None and not event_entries:
        event_entries = (_bfield(2, start),)
    log = b"".join(_bfield(1, event) for event in event_entries)
    room_payload = (
        _room(vacuum_status, mop_status) if room_payload is None else room_payload
    )
    modern = _bfield(1, room_payload) if modern_payload is None else modern_payload
    summary = timestamps + (_bfield(9, b"") if include_summary_reason else b"")
    if stop is not None:
        summary += _bfield(10, stop)
    if not omit_modern:
        summary += _bfield(11, modern)
    return _bfield(1, _fixed32(2, 44)) + _bfield(2, log) + _bfield(5, summary)


def test_decodes_canonical_identity_and_per_room_result() -> None:
    decoded = decode_history_semantics(_payload())

    assert decoded is not None
    assert decoded.mission_id == 44
    assert decoded.partition_id == "00000000-0000-0001-0000-000000000002"
    assert decoded.initiator == "app"
    assert decoded.stop_reason == "finished"
    assert decoded.completion_kind == "completed"
    assert decoded.mode_results[0].room == "Kitchen"
    assert decoded.mode_results[0].room_id == decoded.partition_id
    assert decoded.mode_results[0].duration_seconds == 73


@pytest.mark.parametrize(
    ("timestamp", "expected"),
    [
        (
            _bfield(1, _vfield(1, 60) + _vfield(2, 500_000_000)),
            "1970-01-01T00:01:00.500000+00:00",
        ),
        (_bfield(1, _vfield(1, 60) + _vfield(2, 1_000_000_000)), None),
        (_bfield(1, b"\xff"), None),
    ],
)
def test_summary_timestamps_require_valid_seconds_and_nanos(timestamp, expected):
    decoded = decode_history_semantics(_payload(timestamps=_bfield(3, timestamp)))

    assert decoded is not None
    assert decoded.started_at == expected


@pytest.mark.parametrize("payload", [b"", b"\xff", b"x" * (256 * 1024 + 1)])
def test_rejects_malformed_or_oversized_payload(payload: bytes) -> None:
    assert decode_history_semantics(payload) is None


def test_rejects_unknown_user_start_reason() -> None:
    assert decode_history_semantics(_payload(start_child=7)) is None


@pytest.mark.parametrize(
    "reason",
    [
        _bfield(2, _bfield(1, b"")) + _bfield(3, b""),
        _bfield(9, b""),
        _bfield(2, _bfield(1, b"") + _bfield(2, b"")),
        _bfield(2, b""),
        _bfield(2, _vfield(1, 1)),
    ],
)
def test_malformed_start_reason_cannot_establish_an_initiator(reason):
    assert decode_history_semantics(_payload(reason_payload=reason)) is None


def test_schedule_initiator_does_not_retain_schedule_name() -> None:
    decoded = decode_history_semantics(_payload(schedule_name=b"Synthetic schedule"))
    assert decoded is not None
    assert decoded.initiator == "schedule"
    assert "Synthetic schedule" not in repr(decoded)


def test_empty_schedule_initiator_is_supported() -> None:
    decoded = decode_history_semantics(_payload(start_child=8))
    assert decoded is not None
    assert decoded.initiator == "schedule"


@pytest.mark.parametrize("finished_variant", [1, 2])
def test_both_finished_markers_are_supported(finished_variant: int) -> None:
    decoded = decode_history_semantics(
        _payload(stop=_bfield(5, _bfield(finished_variant, b"")))
    )
    assert decoded is not None
    assert decoded.stop_reason == "finished"


def test_user_cancelled_can_coexist_with_completed_modes() -> None:
    decoded = decode_history_semantics(_payload(stop=_bfield(8, _bfield(1, b""))))
    assert decoded is not None
    assert decoded.stop_reason == "user_cancelled"
    assert decoded.completion_kind == "completed"


@pytest.mark.parametrize(
    ("vacuum_status", "mop_status", "expected"),
    [(2, 0, "incomplete"), (1, 2, "incomplete"), (2, 2, "completed")],
)
def test_mixed_mode_completion_is_conservative(
    vacuum_status: int, mop_status: int, expected: str
) -> None:
    decoded = decode_history_semantics(
        _payload(vacuum_status=vacuum_status, mop_status=mop_status)
    )
    assert decoded is not None
    assert decoded.completion_kind == expected


def test_missing_stop_reason_is_conservative_bot_cancelled() -> None:
    decoded = decode_history_semantics(_payload(stop=None))
    assert decoded is not None
    assert decoded.stop_reason == "bot_cancelled"


def test_rejects_duplicate_mission_identity() -> None:
    payload = _payload() + _bfield(1, _fixed32(2, 45))
    assert decode_history_semantics(payload) is None


@pytest.mark.parametrize("goals_field", [1, 2])
def test_supported_goal_map_field_variants(goals_field: int) -> None:
    decoded = decode_history_semantics(_payload(goals_field=goals_field))
    assert decoded is not None
    assert decoded.partition_id == "00000000-0000-0001-0000-000000000002"


def test_rejects_ambiguous_goal_map_field_variants() -> None:
    assert decode_history_semantics(_payload(goals_field=(1, 2))) is None


def test_rejects_missing_or_multiple_initial_start_events() -> None:
    start = _bfield(2, _bfield(1, b""))
    assert decode_history_semantics(_payload(event_entries=(b"",))) is None
    assert (
        decode_history_semantics(
            _payload(event_entries=(_bfield(2, start), _bfield(2, start)))
        )
        is None
    )


def test_rejects_empty_goals_and_conflicting_partition_ids() -> None:
    start = _bfield(1, b"") + _bfield(3, _bfield(2, _bfield(1, b"")))
    assert decode_history_semantics(_payload(start_payload=start)) is None
    assert decode_history_semantics(_payload(goal_ids=((1, 2), (3, 4)))) is None


def test_rejects_missing_summary_fields() -> None:
    assert decode_history_semantics(_payload(include_summary_reason=False)) is None
    assert decode_history_semantics(_payload(omit_modern=True)) is None


def test_rejects_nested_message_and_shared_field_budget_limits() -> None:
    oversized_child = _bfield(99, b"x" * (semantics.MAX_NESTED_BYTES + 1))
    assert decode_history_semantics(_payload(modern_payload=oversized_child)) is None

    noisy_events = tuple(
        _bfield(3, b"") for _ in range(semantics.MAX_HISTORY_FIELDS // 2 + 16)
    )
    assert decode_history_semantics(_payload(event_entries=noisy_events)) is None


@pytest.mark.parametrize(
    "identity",
    [b"\x00" * 16, _fixed64(1, 0) + _fixed64(2, 0), _vfield(1, 1) + _fixed64(2, 2)],
)
def test_rejects_malformed_and_zero_room_identities(identity: bytes) -> None:
    assert (
        decode_history_semantics(_payload(room_payload=_room(identity=identity)))
        is None
    )


def test_rejects_duplicate_room_ids_and_malformed_room_names() -> None:
    room = _room()
    assert (
        decode_history_semantics(
            _payload(modern_payload=_bfield(1, room) + _bfield(1, room))
        )
        is None
    )
    assert decode_history_semantics(_payload(room_payload=_room(name=b"\xff"))) is None
    assert (
        decode_history_semantics(_payload(room_payload=_room(name=b"x" * 129))) is None
    )
    assert (
        decode_history_semantics(
            _payload(room_payload=_room(name=b"x" * (semantics.MAX_NAME_BYTES + 1)))
        )
        is None
    )


def test_rejects_missing_rooms_names_and_modes() -> None:
    assert decode_history_semantics(_payload(modern_payload=b"")) is None
    missing_name = _bfield(1, _bfield(2, _bfield(2, _uuid()))) + _bfield(2, b"")
    assert decode_history_semantics(_payload(room_payload=missing_name)) is None
    no_modes = _bfield(1, _bfield(2, _bfield(2, _uuid()))) + _bfield(
        2, _bfield(1, b"Kitchen")
    )
    assert decode_history_semantics(_payload(room_payload=no_modes)) is None


@pytest.mark.parametrize(
    "modes",
    [
        _mode_entry(key=2),
        _mode_entry() + _mode_entry(),
    ],
)
def test_rejects_unknown_or_duplicate_mode_keys(modes: bytes) -> None:
    assert (
        decode_history_semantics(_payload(room_payload=_room(modes_override=modes)))
        is None
    )


def test_unknown_status_has_no_completion_credit() -> None:
    decoded = decode_history_semantics(_payload(vacuum_status=9))
    assert decoded is not None
    assert decoded.mode_results[0].status is None
    assert decoded.completion_kind is None


@pytest.mark.parametrize(
    "duration",
    [_vfield(1, semantics.MAX_DURATION_SECONDS + 1), _vfield(2, 1_000_000_000)],
)
def test_rejects_out_of_bounds_durations(duration: bytes) -> None:
    room = _room(duration=duration)
    assert decode_history_semantics(_payload(room_payload=room)) is None


def test_stop_reason_rejects_ambiguous_and_malformed_values() -> None:
    assert (
        decode_history_semantics(
            _payload(stop=_bfield(5, _bfield(2, b"")) + _bfield(8, _bfield(1, b"")))
        )
        is None
    )
    assert decode_history_semantics(_payload(stop=_bfield(5, b"invalid"))) is None
    assert decode_history_semantics(_payload(stop=_bfield(5, b""))) is None
    decoded = decode_history_semantics(_payload(stop=_bfield(11, b"unknown")))
    assert decoded is not None
    assert decoded.stop_reason is None


def test_schedule_label_rejects_invalid_utf8_and_excessive_length() -> None:
    assert decode_history_semantics(_payload(schedule_name=b"\xff")) is None
    assert decode_history_semantics(_payload(schedule_name=b"x" * 129)) is None
    assert (
        decode_history_semantics(
            _payload(schedule_name=b"x" * (semantics.MAX_NAME_BYTES + 1))
        )
        is None
    )


def test_wire_helpers_reject_wrong_types_duplicates_and_missing_fields() -> None:
    budget = WireFieldBudget(100)
    with pytest.raises(DecodeError):
        semantics._known((WireField(1, 2, b""),), 1, 0)
    with pytest.raises(DecodeError):
        semantics._known((WireField(1, 0, 1), WireField(1, 0, 2)), 1, 0)
    with pytest.raises(DecodeError):
        semantics._required_varint((), 1)
    assert semantics._required_varint((WireField(1, 0, 9),), 1) == 9
    assert semantics._optional_varint((), 1) is None
    with pytest.raises(DecodeError):
        semantics._optional_varint((WireField(1, 2, b""),), 1)
    with pytest.raises(DecodeError):
        semantics._optional_varint((WireField(1, 0, b"bad"),), 1)
    with pytest.raises(DecodeError):
        semantics._messages((WireField(1, 0, 1),), 1)
    with pytest.raises(DecodeError):
        semantics._required_message((), 1)
    assert semantics._optional_message((), 1) is None
    with pytest.raises(DecodeError):
        semantics._optional_message((WireField(1, 0, 1),), 1)
    with pytest.raises(DecodeError):
        semantics._optional_message((WireField(1, 2, 1),), 1)
    with pytest.raises(DecodeError):
        semantics._required_fixed64((), 1)
    with pytest.raises(DecodeError):
        semantics._required_fixed64((WireField(1, 1, b"1234567"),), 1)
    with pytest.raises(DecodeError):
        semantics._required_fixed32((), 1)
    assert semantics._decode_duration(b"", budget) == 0


@pytest.mark.parametrize(
    "reason",
    [
        b"",
        _bfield(2, b"") + _bfield(3, b""),
        _bfield(2, b""),
        _bfield(2, _bfield(1, b"") + _bfield(2, b"")),
        _bfield(2, _vfield(1, 1)),
        _bfield(2, _bfield(7, b"")),
    ],
)
def test_initiator_rejects_unsupported_or_malformed_shapes(reason: bytes) -> None:
    with pytest.raises(DecodeError):
        semantics._decode_initiator((WireField(3, 2, reason),), WireFieldBudget(100))


def test_completion_kind_handles_all_unattempted_and_empty_inputs() -> None:
    assert semantics._completion_kind(()) is None
    assert (
        semantics._completion_kind(
            (semantics.CleaningModeResult("Room", "vacuum", "unattempted", 0),)
        )
        == "not_started"
    )
