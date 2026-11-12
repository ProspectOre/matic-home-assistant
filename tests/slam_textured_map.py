"""Seeded synthetic SLAM pages with varied texture, voxels and colour."""

from __future__ import annotations

import struct

import numpy as np

from custom_components.matic_robot.client.models import HermesCollectionEntry
from custom_components.matic_robot.client.slam_tiles import SURFACE_BYTES
from tests.test_slam_map import _bytes_field, _sint32, _varint_field


def _mission(mission_id: int) -> bytes:
    return bytes((2 << 3 | 5,)) + struct.pack("<I", mission_id)


def _page_key(page_x: int, page_y: int, mission: bytes) -> bytes:
    page = _varint_field(3, _sint32(page_x)) + _varint_field(4, _sint32(page_y))
    return _bytes_field(1, page) + _bytes_field(2, mission)


def _dimensions(values: tuple[int, int, int, int]) -> bytes:
    return b"".join(
        _varint_field(number, value) for number, value in enumerate(values, start=1)
    )


def textured_photo_entry(
    page_x: int, page_y: int, *, seed: int, mission_id: int = 1
) -> HermesCollectionEntry:
    """Build one photographic page with seeded floor texture and voxels."""
    rng = np.random.default_rng(seed)
    mission = _mission(mission_id)
    surface = np.packbits(rng.random(SURFACE_BYTES * 8) < 0.08).tobytes()
    rgb = rng.integers(0, 256, sum(byte.bit_count() for byte in surface) * 3)
    floor = rng.integers(0, 256, (4, 32, 32)).astype("<f2")
    floor[3][rng.random((32, 32)) < 0.2] = 0
    surface_envelope = _bytes_field(2, _dimensions((1, 32, 32, 24))) + _bytes_field(
        3, _bytes_field(1, surface)
    )
    floor_envelope = _bytes_field(4, _dimensions((1, 4, 32, 32))) + _bytes_field(
        5, _bytes_field(1, floor.tobytes())
    )
    value = b"".join(
        (
            _bytes_field(2, b"\x00\x00"),
            _bytes_field(4, surface_envelope),
            _bytes_field(5, mission),
            _bytes_field(6, _bytes_field(1, rgb.astype(np.uint8).tobytes())),
            _bytes_field(7, _bytes_field(1, _bytes_field(1, floor_envelope))),
        )
    )
    return HermesCollectionEntry(_page_key(page_x, page_y, mission), value)


def textured_structure_entry(
    page_x: int, page_y: int, *, seed: int, mission_id: int = 1
) -> HermesCollectionEntry:
    """Build one integrated page with seeded occupancy and semantics."""
    rng = np.random.default_rng(seed)
    mission = _mission(mission_id)
    surface_envelope = _bytes_field(2, _dimensions((1, 32, 32, 24))) + _bytes_field(
        3, _bytes_field(1, bytes(SURFACE_BYTES))
    )
    occupancy = rng.integers(0, 256, 512, dtype=np.uint8).tobytes()
    semantics = rng.integers(0, 256, 512, dtype=np.uint8).tobytes()
    value = (
        _bytes_field(5, surface_envelope)
        + _bytes_field(6, mission)
        + _bytes_field(7, _bytes_field(1, occupancy))
        + _bytes_field(8, _bytes_field(1, semantics))
        + _bytes_field(9, _bytes_field(1, bytes(512)))
    )
    return HermesCollectionEntry(_page_key(page_x, page_y, mission), value)


def textured_map(
    side: int, *, seed: int = 0, mission_id: int = 1
) -> tuple[tuple[HermesCollectionEntry, ...], tuple[HermesCollectionEntry, ...]]:
    """Return a side-by-side square of photographic and integrated pages."""
    pages = [(x - side // 2, y - side // 2) for y in range(side) for x in range(side)]
    return (
        tuple(
            textured_photo_entry(x, y, seed=seed + index, mission_id=mission_id)
            for index, (x, y) in enumerate(pages)
        ),
        tuple(
            textured_structure_entry(
                x, y, seed=seed + 7919 + index, mission_id=mission_id
            )
            for index, (x, y) in enumerate(pages)
        ),
    )
