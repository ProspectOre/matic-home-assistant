"""Stable native room identity shared by cadence import and dispatch."""

import hashlib
import struct

from .client import FloorPlan


def room_cadence_identity(floor_plan: FloorPlan, room_id: str) -> str:
    """Bind cadence to robot-owned floor and room IDs, excluding room labels.

    Mission, partition, and native room identity prevent a reused room ID on
    another mapped floor from inheriting progress. Geometry and names remain
    free to change without affecting the schedule identity.
    """
    room = next(
        (candidate for candidate in floor_plan.rooms if candidate.id == room_id), None
    )
    if room is None:
        raise ValueError("room is not present on the current map")
    digest = hashlib.sha256(b"matic-room-cadence-identity-v1\0")
    digest.update(struct.pack(">q", floor_plan.mission_id))
    for value in (
        floor_plan.partition_id_wire,
        floor_plan.partition_protocol_id.encode(),
        room.id_wire,
        room.protocol_id.encode(),
        room.id.encode(),
    ):
        digest.update(struct.pack(">I", len(value)))
        digest.update(value)
    return digest.hexdigest()
