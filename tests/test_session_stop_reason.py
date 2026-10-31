"""Native session stop reasons from coverage_session_history."""

from __future__ import annotations

import pytest

from custom_components.matic_robot.client.api import _decode_cleaning_session
from tests.wire_builders import _bfield, _vfield

# Shapes match read-only reads on firmware v181.10: summary field 10 holds
# one oneof variant whose body was ``{1: {}}`` for both values seen.
_VARIANT_BODY = _bfield(1, b"")


def _session(stop_reason: bytes | None) -> bytes:
    summary = _bfield(3, _bfield(1, _vfield(1, 1_000)))
    summary += _bfield(4, _bfield(1, _vfield(1, 1_060)))
    if stop_reason is not None:
        summary += stop_reason
    return _bfield(5, summary)


@pytest.mark.parametrize(
    ("stop_reason", "code", "name"),
    [
        (_bfield(10, _bfield(8, _VARIANT_BODY)), 8, "stopped"),
        (_bfield(10, _bfield(5, _VARIANT_BODY)), 5, "finished"),
        (_bfield(10, _bfield(7, b"")), 7, "unknown"),
        (None, None, None),
        # Anything but exactly one embedded variant is not a stop reason.
        (_bfield(10, b""), None, None),
        (_bfield(10, _bfield(5, b"") + _bfield(8, b"")), None, None),
        (_bfield(10, _vfield(5, 1)), None, None),
        (_vfield(10, 5), None, None),
        (_bfield(10, b"\xff"), None, None),
        (_bfield(10, _bfield(5, b"")) + _bfield(10, _bfield(8, b"")), None, None),
    ],
)
def test_stop_reason_is_named_only_for_captured_values(
    stop_reason: bytes | None, code: int | None, name: str | None
) -> None:
    session = _decode_cleaning_session(_session(stop_reason))

    assert session is not None
    assert session.stop_reason_code == code
    assert session.stop_reason == name
