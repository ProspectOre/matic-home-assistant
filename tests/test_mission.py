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


def _labeled(mission_id: int, label: bytes) -> bytes:
    return _bfield(1, _mission(mission_id)) + _bfield(2, _bfield(2, label))


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
            _state(active=b"bad", canonical=(_labeled(42, b"Main"),)),
            "labeled mission",
        ),
        (
            _state(
                active=_labeled(42, b"Main"),
                canonical=(_labeled(42, b"Main") + _vfield(3, 1),),
            ),
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
