"""Floor plans, coverage sessions and native history for the simulated robot.

The wire shapes follow the observed robot values the integration decodes:
``coverage_plan`` (floor at field 10, retained goals at 7/1/1),
``active_session_key`` (mission and session UUID) and
``coverage_session_history`` (goal snapshot at 2/1/2/1/2, summary at 5).
This module has its own small encoder and reader so the simulator does not
reuse the integration's codecs.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from uuid import UUID

# ``active_session_key`` while no task is held: Hermes' 16-byte tombstone.
IDLE_SESSION_KEY = bytes(16)

ROOM_STATUS_COMPLETED = 2
ROOM_STATUS_PARTIAL = 1


def varint(value: int) -> bytes:
    result = bytearray()
    while value > 0x7F:
        result.append((value & 0x7F) | 0x80)
        value >>= 7
    result.append(value)
    return bytes(result)


def bytes_field(number: int, value: bytes) -> bytes:
    return varint((number << 3) | 2) + varint(len(value)) + value


def varint_field(number: int, value: int) -> bytes:
    return varint(number << 3) + varint(value)


def fixed32_float(number: int, value: float) -> bytes:
    return varint((number << 3) | 5) + struct.pack("<f", value)


def fixed32_int(number: int, value: int) -> bytes:
    return varint((number << 3) | 5) + struct.pack("<I", value)


def fixed64(number: int, value: int) -> bytes:
    return varint((number << 3) | 1) + struct.pack("<Q", value)


def uuid_wire(value: UUID) -> bytes:
    """Matic's UUID message: two fixed64 halves wrapped in field 2."""
    halves = fixed64(1, value.int >> 64) + fixed64(2, value.int & ((1 << 64) - 1))
    return bytes_field(2, halves)


def read_fields(payload: bytes) -> list[tuple[int, int, bytes | int]]:
    """Read one protobuf message level as (number, wire type, value)."""
    fields: list[tuple[int, int, bytes | int]] = []
    index = 0

    def read_varint() -> int:
        nonlocal index
        shift = result = 0
        while True:
            byte = payload[index]
            index += 1
            result |= (byte & 0x7F) << shift
            if not byte & 0x80:
                return result
            shift += 7

    while index < len(payload):
        tag = read_varint()
        number, wire_type = tag >> 3, tag & 7
        value: bytes | int
        if wire_type == 0:
            value = read_varint()
        elif wire_type == 1:
            value = payload[index : index + 8]
            index += 8
        elif wire_type == 2:
            length = read_varint()
            value = payload[index : index + length]
            index += length
        elif wire_type == 5:
            value = payload[index : index + 4]
            index += 4
        else:
            raise ValueError(f"unsupported wire type {wire_type}")
        fields.append((number, wire_type, value))
    return fields


def messages(payload: bytes, number: int) -> list[bytes]:
    return [
        value
        for field_number, wire_type, value in read_fields(payload)
        if field_number == number and wire_type == 2 and isinstance(value, bytes)
    ]


def message(payload: bytes, *path: int) -> bytes | None:
    """Follow single nested messages by field number, or return None."""
    for number in path:
        found = messages(payload, number)
        if len(found) != 1:
            return None
        payload = found[0]
    return payload


def read_uuid(payload: bytes) -> UUID:
    inner = message(payload, 2)
    if inner is None:
        raise ValueError("not a UUID message")
    halves = {
        number: value
        for number, wire_type, value in read_fields(inner)
        if wire_type == 1 and isinstance(value, bytes)
    }
    high, low = struct.unpack("<QQ", halves[1] + halves[2])
    return UUID(int=(high << 64) | low)


@dataclass(frozen=True, slots=True)
class SimRoom:
    id: UUID
    name: str
    outline: tuple[tuple[float, float], ...]


@dataclass(frozen=True, slots=True)
class SimFloor:
    mission_id: int
    partition_id: UUID
    rooms: tuple[SimRoom, ...]

    def room(self, room_id: UUID) -> SimRoom:
        return next(room for room in self.rooms if room.id == room_id)

    def encode(self) -> bytes:
        """Encode the floor as it appears at ``coverage_plan`` field 10."""
        regions = b""
        for room in self.rooms:
            points = b"".join(
                bytes_field(1, fixed32_float(1, x) + fixed32_float(2, y))
                for x, y in room.outline
            )
            region = bytes_field(9, room.name.encode()) + bytes_field(
                10, bytes_field(1, bytes_field(2, points))
            )
            regions += bytes_field(
                1,
                bytes_field(1, bytes_field(2, uuid_wire(room.id)))
                + bytes_field(2, region),
            )
        partition = bytes_field(1, uuid_wire(self.partition_id)) + bytes_field(
            3, regions
        )
        return bytes_field(
            10, varint_field(1, self.mission_id) + bytes_field(2, partition)
        )


def two_room_floor() -> SimFloor:
    """A synthetic floor with a kitchen and a study side by side."""
    return SimFloor(
        mission_id=7,
        partition_id=UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        rooms=(
            SimRoom(
                UUID("11111111-1111-4111-8111-111111111111"),
                "Kitchen",
                ((0.0, 0.0), (2.0, 0.0), (2.0, 1.5), (0.0, 1.5)),
            ),
            SimRoom(
                UUID("22222222-2222-4222-8222-222222222222"),
                "Study",
                ((2.0, 0.0), (4.0, 0.0), (4.0, 1.5), (2.0, 1.5)),
            ),
        ),
    )


def three_room_floor() -> SimFloor:
    """The two-room floor with a hall added after the study."""
    floor = two_room_floor()
    hall = SimRoom(
        UUID("33333333-3333-4333-8333-333333333333"),
        "Hall",
        ((4.0, 0.0), (6.0, 0.0), (6.0, 1.5), (4.0, 1.5)),
    )
    return SimFloor(floor.mission_id, floor.partition_id, (*floor.rooms, hall))


def _timestamp(nanoseconds: int) -> bytes:
    """Matic's SystemTime wrapper around a seconds/nanos Timestamp."""
    seconds, nanos = divmod(nanoseconds, 1_000_000_000)
    return bytes_field(1, varint_field(1, seconds) + varint_field(2, nanos))


@dataclass(slots=True)
class Visit:
    """One room's consecutive goals in a task's plan, and when it finished."""

    room: UUID
    goals: list[bytes]
    passes: list[tuple[int, int]]  # (mode, coverage setting) per goal
    finished_at: int | None = None  # nanoseconds since the epoch

    @property
    def modes(self) -> set[int]:
        """0 for a vacuum pass, 1 for a mop pass."""
        return {mode for mode, _setting in self.passes}


@dataclass(slots=True)
class CoverageSession:
    """One native task started by a coverage command.

    The plan is a list of room visits. A room appears twice only when it was
    cleaned again after it finished.
    """

    session_wire: bytes
    mission_wire: bytes
    visits: list[Visit]
    started_at: int  # nanoseconds since the epoch
    ordered: bool = False  # goals came in the ordered list (field 1)

    @property
    def active_key(self) -> bytes:
        """The ``active_session_key`` envelope: mission, then session UUID."""
        return bytes_field(1, self.mission_wire) + bytes_field(2, self.session_wire)

    @property
    def goals(self) -> list[bytes]:
        return [goal for visit in self.visits for goal in visit.goals]

    @property
    def rooms(self) -> list[UUID]:
        """Rooms in plan order, each once."""
        return list(dict.fromkeys(visit.room for visit in self.visits))

    @property
    def current_visit(self) -> Visit | None:
        return next((visit for visit in self.visits if visit.finished_at is None), None)

    @property
    def current_room(self) -> UUID | None:
        visit = self.current_visit
        return visit.room if visit is not None else None

    def finish_current(self, at: int) -> None:
        visit = self.current_visit
        assert visit is not None, "no room left in the task"
        visit.finished_at = at

    def update(self, change: CoverageSession) -> None:
        """Apply an UPDATE: finished visits stay, the rest are replaced."""
        self.visits = [
            visit for visit in self.visits if visit.finished_at is not None
        ] + change.visits

    def retained_goals(self) -> bytes:
        """Goals as the robot retains them in ``coverage_plan`` field 7."""
        return bytes_field(
            7, bytes_field(1, b"".join(bytes_field(1, goal) for goal in self.goals))
        )

    def history_value(
        self, floor: SimFloor, ended_at: int, *, completed: bool
    ) -> bytes:
        """The ``coverage_session_history`` value written when the task ends.

        Each finished visit adds 300 s to the room's time in its modes.
        """
        snapshot = bytes_field(1, b"".join(bytes_field(2, goal) for goal in self.goals))
        request = bytes_field(1, bytes_field(1, b"")) + bytes_field(2, snapshot)
        summary = (
            bytes_field(3, _timestamp(self.started_at))
            + bytes_field(4, _timestamp(ended_at))
            + varint_field(5, 0 if completed else 1)
        )
        for group, mode in ((6, 0), (7, 1)):
            entries = b""
            for room_id in self.rooms:
                visits = [
                    visit
                    for visit in self.visits
                    if visit.room == room_id and mode in visit.modes
                ]
                if not visits:
                    continue
                seconds = 300 * sum(visit.finished_at is not None for visit in visits)
                details = (
                    bytes_field(3, floor.room(room_id).name.encode())
                    + bytes_field(4, varint_field(1, seconds))
                    + varint_field(
                        5, ROOM_STATUS_COMPLETED if seconds else ROOM_STATUS_PARTIAL
                    )
                )
                entries += bytes_field(
                    1, bytes_field(1, room_id.bytes) + bytes_field(2, details)
                )
            if entries:
                summary += bytes_field(group, entries)
        return bytes_field(2, bytes_field(1, request)) + bytes_field(5, summary)


def parse_coverage_command(payload: bytes, started_at: int) -> CoverageSession | None:
    """Read a START or UPDATE coverage command, or None for anything else."""
    try:
        coverage = message(payload, 15, 1, 3)
    except IndexError, ValueError:
        return None
    if coverage is None:
        return None
    mission_wire = message(coverage, 3)
    session_wire = message(coverage, 6)
    if mission_wire is None or session_wire is None:
        return None
    ordered: list[bytes] = []
    unordered: list[bytes] = []
    for container in messages(coverage, 5):
        ordered.extend(messages(container, 1))
        unordered.extend(messages(container, 2))
    visits: list[Visit] = []
    for goal in ordered + unordered:
        region = message(goal, 7, 3, 3, 2)
        spec = message(goal, 6, 3)
        if region is None or spec is None:
            return None
        room_id = read_uuid(region)
        values = {
            number: value
            for number, wire_type, value in read_fields(spec)
            if wire_type == 0 and isinstance(value, int)
        }
        if not visits or visits[-1].room != room_id:
            visits.append(Visit(room_id, [], []))
        visits[-1].goals.append(goal)
        visits[-1].passes.append((values.get(4, 0), values.get(1, 0)))
    return CoverageSession(
        session_wire,
        mission_wire,
        visits,
        started_at,
        ordered=bool(ordered) and not unordered,
    )


@dataclass(frozen=True, slots=True)
class Navigation:
    """A NavigateTo command: a room goal, or a saved posture to wait at."""

    mission_wire: bytes
    room: UUID | None
    posture: bytes | None
    waits: bool  # a wait task, such as the sink refill


def parse_navigation(payload: bytes) -> Navigation | None:
    """Read a NavigateTo user command, or None for anything else."""
    try:
        navigate = message(payload, 2, 4)
        if navigate is None:
            return None
        mission = message(navigate, 2)
        region = message(navigate, 5, 4, 2)
        posture = message(navigate, 1)
        if mission is None or (region is None and posture is None):
            return None
        return Navigation(
            mission,
            read_uuid(region) if region is not None else None,
            posture,
            message(navigate, 4) is not None,
        )
    except IndexError, ValueError:
        return None


_TILE_SIDE = 32
_TILE_HEIGHT = 24
_VOXEL_METERS = 0.015


def _dimensions(*values: int) -> bytes:
    return b"".join(
        varint_field(number, value) for number, value in enumerate(values, 1)
    )


def map_pages(
    floor: SimFloor,
) -> tuple[list[tuple[bytes, bytes]], list[tuple[bytes, bytes]]]:
    """Photographic and structural pages covering every room of a floor.

    Returns ``(map_compressed_rgb entries, map_integrated entries)``. Each page
    is flat grey floor with one surface column. Matic Map clips rooms to mapped
    floor, so the pages must cover the rooms for them to appear.
    """
    page_meters = _TILE_SIDE * _VOXEL_METERS
    points = [point for room in floor.rooms for point in room.outline]
    pages_x = range(
        math.floor(min(x for x, _ in points) / page_meters),
        math.ceil(max(x for x, _ in points) / page_meters),
    )
    pages_y = range(
        math.floor(min(y for _, y in points) / page_meters),
        math.ceil(max(y for _, y in points) / page_meters),
    )
    mission = fixed32_int(2, floor.mission_id)
    surface_bits = bytearray(_TILE_SIDE * _TILE_SIDE * _TILE_HEIGHT // 8)
    surface_bits[0] = 0x80
    surface = bytes_field(
        2, _dimensions(1, _TILE_SIDE, _TILE_SIDE, _TILE_HEIGHT)
    ) + bytes_field(3, bytes_field(1, bytes(surface_bits)))
    grey = struct.pack("<e", 128.0) * (_TILE_SIDE * _TILE_SIDE * 4)
    floor_texture = bytes_field(
        4, _dimensions(1, 4, _TILE_SIDE, _TILE_SIDE)
    ) + bytes_field(5, bytes_field(1, grey))
    photo = (
        bytes_field(4, surface)
        + bytes_field(5, mission)
        + bytes_field(6, bytes_field(1, bytes((96, 96, 96))))
        + bytes_field(7, bytes_field(1, bytes_field(1, floor_texture)))
    )
    plane = bytes(_TILE_SIDE * _TILE_SIDE // 2)
    structure = (
        bytes_field(5, surface)
        + bytes_field(6, mission)
        + bytes_field(7, bytes_field(1, plane))
        + bytes_field(8, bytes_field(1, plane))
    )
    keys = [
        bytes_field(1, varint_field(3, _zigzag(x)) + varint_field(4, _zigzag(y)))
        for x in pages_x
        for y in pages_y
    ]
    return [(key, photo) for key in keys], [(key, structure) for key in keys]


def _zigzag(value: int) -> int:
    return (value << 1) ^ (value >> 31)


def earlier_session(floor: SimFloor, ended_at: int) -> tuple[bytes, bytes]:
    """A finished whole-floor vacuum session, so history has a baseline."""
    session = CoverageSession(
        session_wire=bytes_field(2, uuid_wire(UUID(int=floor.mission_id))),
        mission_wire=fixed32_int(2, floor.mission_id),
        visits=[Visit(room.id, [], [(0, 1)], ended_at) for room in floor.rooms],
        started_at=ended_at - 900_000_000_000,
    )
    return session.session_wire, session.history_value(floor, ended_at, completed=True)
