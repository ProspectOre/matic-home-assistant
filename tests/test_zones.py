"""Robot zone decoding and overlap checks."""

from __future__ import annotations

import struct

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client.models import HermesCollectionEntry, MapZone
from custom_components.matic_robot.client.zones import (
    MAX_ZONES,
    decode_zone,
    decode_zones,
    zone_overlaps_circle,
    zone_overlaps_polygon,
)
from tests.wire_builders import _bfield, _fixed32, _varint, _vfield

SQUARE = ((0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0))
HOLE = ((0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5))


def _key(mission_id: int, class_value: int | None = None) -> bytes:
    mission = _varint((2 << 3) | 5) + struct.pack("<I", mission_id)
    key = _bfield(1, mission)
    return key if class_value is None else key + _vfield(2, class_value)


def _ring(points: tuple[tuple[float, float], ...]) -> bytes:
    return b"".join(_bfield(1, _fixed32(1, x) + _fixed32(2, y)) for x, y in points)


def _value(
    outline: tuple[tuple[float, float], ...] = SQUARE,
    holes: tuple[tuple[tuple[float, float], ...], ...] = (),
) -> bytes:
    border = _bfield(2, _ring(outline)) + b"".join(
        _bfield(3, _ring(hole)) for hole in holes
    )
    # Value field 2 -> 4 is an empty message on every recorded zone.
    return _bfield(1, border) + _bfield(2, _bfield(4, b""))


def _zone(
    outline: tuple[tuple[float, float], ...] = SQUARE,
    holes: tuple[tuple[tuple[float, float], ...], ...] = (),
) -> MapZone:
    return MapZone(7, "no_go", 1, outline, holes)


def test_decode_zone_reads_class_from_the_key_and_keeps_holes() -> None:
    # The owner's app-drawn no-go area (firmware v181.10) has key field 2 = 1
    # and comes back as an outer border with one hole.
    no_go = decode_zone(HermesCollectionEntry(_key(42, 1), _value(holes=(HOLE,))))
    assert no_go == MapZone(42, "no_go", 1, SQUARE, (HOLE,))

    # A robot-made zone on an older mission has no class field.
    robot_made = decode_zone(HermesCollectionEntry(_key(41), _value()))
    assert (robot_made.kind, robot_made.class_value, robot_made.holes) == (
        "unknown",
        0,
        (),
    )
    assert decode_zone(HermesCollectionEntry(_key(41, 3), _value())).kind == "unknown"


@pytest.mark.parametrize(
    "entry",
    [
        HermesCollectionEntry(_key(1, 1) + _vfield(2, 1), _value()),
        HermesCollectionEntry(b"", _value()),
        HermesCollectionEntry(_key(1), b""),
        HermesCollectionEntry(_key(1), _bfield(1, b"")),
        HermesCollectionEntry(_key(1), _bfield(1, _bfield(2, _ring(SQUARE)) * 2)),
        HermesCollectionEntry(_key(1), _value(outline=SQUARE[:2])),
        HermesCollectionEntry(_key(1), _value(outline=((float("nan"), 0.0),) * 3)),
        HermesCollectionEntry(_key(1), _value(outline=((20_000.0, 0.0),) * 3)),
        HermesCollectionEntry(_key(1), _value(holes=(HOLE[:2],))),
        HermesCollectionEntry(_key(1), b"\x0a" + _varint(300_000) + b"\x00" * 300_000),
    ],
)
def test_decode_zone_rejects_malformed_entries(entry: HermesCollectionEntry) -> None:
    with pytest.raises(DecodeError):
        decode_zone(entry)


def test_decode_zones_skips_bad_entries_and_bounds_the_count() -> None:
    good = HermesCollectionEntry(_key(1, 1), _value())
    bad = HermesCollectionEntry(_key(1), b"")

    assert decode_zones((bad, good)) == (decode_zone(good),)
    assert len(decode_zones((good,) * (MAX_ZONES + 5))) == MAX_ZONES


def test_zone_overlap_with_rooms_respects_holes() -> None:
    zone = _zone(holes=(HOLE,))

    assert zone_overlaps_polygon(zone, ((1.5, 1.5), (3.0, 1.5), (3.0, 3.0)))
    # A room covering the whole zone, and a room crossing it with no vertex
    # inside either shape.
    assert zone_overlaps_polygon(zone, ((-1.0, -1.0), (3.0, -1.0), (3.0, 3.0)))
    assert zone_overlaps_polygon(
        _zone(), ((-1.0, 0.5), (3.0, 0.5), (3.0, 1.0), (-1.0, 1.0))
    )
    # Fully inside the hole, fully outside, or degenerate.
    assert not zone_overlaps_polygon(zone, ((0.8, 0.8), (1.2, 0.8), (1.2, 1.2)))
    assert not zone_overlaps_polygon(zone, ((5.0, 5.0), (6.0, 5.0), (6.0, 6.0)))
    assert not zone_overlaps_polygon(zone, ((1.0, 1.0), (2.0, 2.0)))


@pytest.mark.parametrize(
    ("room", "overlaps"),
    [
        # Aligned edges with no vertex strictly inside the other shape.
        (((3.0, 0.0), (3.0, 2.0), (1.0, 2.0), (1.0, 0.0)), True),
        (SQUARE, True),
        (((0.0, 0.0), (1.0, 0.0), (1.0, 2.0), (0.0, 2.0), (0.0, 2.0)), True),
        # Sharing an edge or a corner from outside is not shared area.
        (((2.0, 0.0), (3.0, 0.0), (3.0, 2.0), (2.0, 2.0)), False),
        (((2.0, 2.0), (3.0, 2.0), (3.0, 3.0)), False),
        (((0.0, 0.0), (-1.0, 0.0), (-1.0, -1.0)), False),
        # The zone sits inside the room, touching no room edge.
        (((-1.0, -1.0), (3.0, -1.0), (3.0, 3.0), (-1.0, 3.0)), True),
        # The bounds overlap but the room wraps around the zone's corner.
        (
            (
                (2.5, -1.0),
                (2.5, 2.5),
                (-1.0, 2.5),
                (-1.0, 2.2),
                (2.2, 2.2),
                (2.2, -1.0),
            ),
            False,
        ),
    ],
)
def test_zone_overlap_counts_only_shared_area(room, overlaps) -> None:
    assert zone_overlaps_polygon(_zone(), room) is overlaps


def test_zone_overlap_with_cleaning_circles() -> None:
    zone = _zone(holes=(HOLE,))

    assert zone_overlaps_circle(zone, (0.25, 0.25), 0.1)
    assert zone_overlaps_circle(zone, (2.2, 1.0), 0.3)
    assert zone_overlaps_circle(zone, (1.0, 1.0), 0.6)
    assert not zone_overlaps_circle(zone, (1.0, 1.0), 0.3)
    assert not zone_overlaps_circle(zone, (3.0, 3.0), 0.5)
    # A zero-length edge still measures distance to its point.
    pinched = _zone(outline=((0.0, 0.0), (0.0, 0.0), (2.0, 0.0), (2.0, 2.0)))
    assert zone_overlaps_circle(pinched, (-0.1, -0.1), 0.2)
