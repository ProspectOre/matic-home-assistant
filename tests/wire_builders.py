"""Shared protobuf wire-encoding builders for synthetic test fixtures.

These are plain importable helpers (not pytest fixtures) used to assemble
byte-for-byte synthetic Hermes payloads. All data produced here is synthetic;
nothing in this module encodes a real robot credential, address, or map.
"""

from __future__ import annotations

from uuid import UUID

from tests.e2e import sim_mission

# One definition of each encoder, in the simulator harness: the upgrade drill
# copies tests/e2e alone into an older release's tree.
_varint = sim_mission.varint
_vfield = sim_mission.varint_field
_bfield = sim_mission.bytes_field
_fixed32 = sim_mission.fixed32_float
_fixed64 = sim_mission.fixed64
_sint32 = sim_mission.zigzag


def _session_identity(session_id: UUID) -> bytes:
    """Encode the synthetic UUID fields returned by native session reads."""
    return _fixed64(1, session_id.int >> 64) + _fixed64(
        2, session_id.int & ((1 << 64) - 1)
    )


# Aliases matching the historical names used by individual test modules.
_field = _bfield
_varint_field = _vfield
