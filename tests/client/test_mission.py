"""Synthetic coverage for mapped-floor mission state."""

from __future__ import annotations

import hashlib
import struct

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client import mission as mission_module
from custom_components.matic_robot.client.mission import decode_mission_client_state
from tests.wire_builders import _bfield, _vfield


def _mission(mission_id: int) -> bytes:
    return b"\x15" + struct.pack("<I", mission_id)


def _labeled(mission_id: int, label: bytes | int) -> bytes:
    encoded = _vfield(1, label) if isinstance(label, int) else _bfield(2, label)
    return _bfield(1, _mission(mission_id)) + _bfield(2, encoded)


def _state(
    *,
    active: bytes | None,
    canonical: tuple[bytes, ...],
    active_variant: int = 4,
) -> bytes:
    payload = _vfield(3, 1) + _bfield(4, _bfield(1, b""))
    if active is not None:
        payload += _bfield(5, _bfield(active_variant, active))
    return payload + _bfield(6, b"".join(_bfield(1, item) for item in canonical))


def test_decode_active_floor_and_customer_labels() -> None:
    first = _labeled(42, b"Main")
    second = _labeled(84, b"Workshop")

    state = decode_mission_client_state(
        _state(active=second, canonical=(first, second))
    )

    assert state.active_floor == state.mapped_floors[1]
    assert [floor.label for floor in state.mapped_floors] == ["Main", "Workshop"]
    assert state.active_floor.mission_token == hashlib.sha256(_mission(84)).hexdigest()


def test_decode_unknown_active_variant_fails_closed() -> None:
    floor = _labeled(42, b"Main")

    state = decode_mission_client_state(
        _state(active=floor, canonical=(floor,), active_variant=3)
    )

    assert state.active_floor is None


@pytest.mark.parametrize("active_index", [0, 3])
def test_decode_four_floors_with_a_numeric_only_label(active_index: int) -> None:
    """A synthetic four-floor snapshot retains the reported 08 05 label form."""
    floors = tuple(
        _labeled(mission_id, label)
        for mission_id, label in (
            (42, b"Main"),
            (84, b"Study"),
            (126, b"Loft"),
            (168, 5),
        )
    )
    assert floors[-1].endswith(b"\x12\x02\x08\x05")

    state = decode_mission_client_state(
        _state(active=floors[active_index], canonical=floors)
    )

    assert state.active_floor is state.mapped_floors[active_index]
    assert [floor.label for floor in state.mapped_floors] == [
        "Main",
        "Study",
        "Loft",
        "Floor",
    ]
    assert [floor.mission_id for floor in state.mapped_floors] == [42, 84, 126, 168]
    for floor in state.mapped_floors:
        assert (
            floor.mission_token
            == hashlib.sha256(_mission(floor.mission_id)).hexdigest()
        )


@pytest.mark.parametrize("label", [0, 5, 127, 2**64 - 1, b"Main"])
def test_decode_labels_accepts_bounded_additive_metadata(label: bytes | int) -> None:
    encoded = _vfield(1, label) if isinstance(label, int) else _bfield(2, label)
    canonical = (
        _bfield(1, _mission(42))
        + _bfield(2, encoded + _bfield(3, b"future label metadata"))
        + _vfield(3, 1)
    )
    state = decode_mission_client_state(
        _state(active=_labeled(42, label), canonical=(canonical,))
    )
    assert state.active_floor is state.mapped_floors[0]
    assert state.active_floor.label == ("Main" if isinstance(label, bytes) else "Floor")


@pytest.mark.parametrize("other_label", [6, b"Floor"])
def test_numeric_label_does_not_hide_active_canonical_disagreement(
    other_label: bytes | int,
) -> None:
    with pytest.raises(DecodeError, match="does not match"):
        decode_mission_client_state(
            _state(active=_labeled(42, 5), canonical=(_labeled(42, other_label),))
        )


@pytest.mark.parametrize(
    "label",
    [
        b"",
        _vfield(3, 5),
        _bfield(1, b"bad"),
        _vfield(2, 5),
        _vfield(1, 5) * 2,
        _bfield(2, b"Main") * 2,
        _vfield(1, 5) + _bfield(2, b"Main"),
        _vfield(1, 5) + _bfield(1, b"bad"),
        _bfield(2, b"Main") + _vfield(2, 5),
    ],
)
def test_decode_rejects_missing_ambiguous_or_wrong_wire_label(label: bytes) -> None:
    floor = _bfield(1, _mission(42)) + _bfield(2, label)
    with pytest.raises(DecodeError, match=r"floor label.*shape"):
        decode_mission_client_state(_state(active=floor, canonical=(floor,)))


@pytest.mark.parametrize(
    "extra", [_vfield(1, 42), _bfield(1, _mission(42)), _vfield(2, 5), _bfield(2, b"")]
)
def test_additive_metadata_does_not_hide_repeated_known_mission_fields(extra: bytes):
    floor = _labeled(42, 5) + extra
    with pytest.raises(DecodeError, match=r"labeled mission.*shape"):
        decode_mission_client_state(_state(active=floor, canonical=(floor,)))


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (_bfield(6, b"") + _bfield(6, b""), "invalid root shape"),
        (_bfield(6, b""), "invalid floor count"),
        (
            _state(
                active=_labeled(42, b"Main"),
                canonical=(_labeled(42, b"Main"), _labeled(42, b"Main")),
            ),
            "repeats a floor identity",
        ),
        (
            _state(
                active=_labeled(42, b"Other"),
                canonical=(_labeled(42, b"Main"),),
            ),
            "does not match",
        ),
        (
            _state(active=_labeled(42, 5), canonical=(_labeled(84, 5),)),
            "does not match",
        ),
        (
            _state(active=b"bad", canonical=(_labeled(42, b"Main"),)),
            "labeled mission",
        ),
        (
            _state(
                active=_labeled(42, b"Main"),
                canonical=(_bfield(1, b"bad") + _bfield(2, _bfield(2, b"Main")),),
            ),
            "invalid identity",
        ),
        (
            _state(
                active=_labeled(42, b"Main"),
                canonical=(_labeled(42, b""),),
            ),
            "byte bounds",
        ),
        (
            _state(
                active=_labeled(42, b"Main"),
                canonical=(_labeled(42, b"\xff"),),
            ),
            "valid UTF-8",
        ),
        (
            _state(
                active=_labeled(42, b"Main"),
                canonical=(_labeled(42, b"bad\nlabel"),),
            ),
            "safe to display",
        ),
    ],
)
def test_decode_mission_state_rejects_ambiguous_or_unsafe_payloads(
    payload: bytes, message: str
) -> None:
    with pytest.raises(DecodeError, match=message):
        decode_mission_client_state(payload)


def test_decode_mission_state_enforces_floor_and_label_bounds(monkeypatch) -> None:
    floor = _labeled(42, b"Main")
    monkeypatch.setattr(mission_module, "MAX_MAPPED_FLOORS", 0)
    with pytest.raises(DecodeError, match="floor count"):
        decode_mission_client_state(_state(active=floor, canonical=(floor,)))

    monkeypatch.setattr(mission_module, "MAX_MAPPED_FLOORS", 64)
    monkeypatch.setattr(mission_module, "MAX_FLOOR_LABEL_BYTES", 1)
    with pytest.raises(DecodeError, match="byte bounds"):
        decode_mission_client_state(_state(active=floor, canonical=(floor,)))

    monkeypatch.setattr(mission_module, "MAX_FLOOR_LABEL_BYTES", 256)
    monkeypatch.setattr(mission_module, "MAX_FLOOR_LABEL_CHARACTERS", 1)
    with pytest.raises(DecodeError, match="safe to display"):
        decode_mission_client_state(_state(active=floor, canonical=(floor,)))


def test_decode_mission_state_rejects_invalid_label_wrapper() -> None:
    malformed = _bfield(1, _mission(42)) + _bfield(2, _bfield(1, b"Main"))
    with pytest.raises(DecodeError, match=r"floor label.*shape"):
        decode_mission_client_state(_state(active=malformed, canonical=(malformed,)))


def test_decode_mission_state_rejects_oversized_payload_before_parsing(
    monkeypatch,
) -> None:
    monkeypatch.setattr(mission_module, "MAX_MISSION_CLIENT_STATE_BYTES", 3)
    with pytest.raises(DecodeError, match="byte limit"):
        decode_mission_client_state(b"\x08\x00" * 2)


@pytest.mark.parametrize(
    "payload",
    [
        b"\x08\x00" * 5,
        _bfield(6, b"\x08\x00" * 5),
        _state(active=_labeled(42, b"Main"), canonical=(b"\x08\x00" * 5,)),
        _state(
            active=b"\x08\x00" * 5,
            canonical=(_labeled(42, b"Main"),),
        ),
    ],
)
def test_decode_mission_state_bounds_every_message_field_count(
    monkeypatch, payload: bytes
) -> None:
    monkeypatch.setattr(mission_module, "MAX_MISSION_MESSAGE_FIELDS", 4)
    with pytest.raises(DecodeError, match="field limit"):
        decode_mission_client_state(payload)


def test_decode_mission_state_bounds_nested_identity_size(monkeypatch) -> None:
    floor = _labeled(42, b"Main")
    monkeypatch.setattr(mission_module, "MAX_MISSION_IDENTITY_BYTES", 4)
    with pytest.raises(DecodeError, match="invalid identity"):
        decode_mission_client_state(_state(active=floor, canonical=(floor,)))
