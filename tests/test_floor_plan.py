"""Synthetic fixtures for local Matic maps and room names."""

from __future__ import annotations

import struct
from io import BytesIO
from uuid import UUID

import pytest
from google.protobuf.message import DecodeError
from PIL import Image

from custom_components.matic_robot.client.floor_plan import (
    _polygon_center,
    decode_floor_plan,
    decode_pose,
    render_floor_plan,
)
from tests.wire_builders import _field, _fixed32, _fixed64, _varint_field

PARTITION_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
REGION_ID = UUID("11111111-1111-4111-8111-111111111111")
SECOND_REGION_ID = UUID("22222222-2222-4222-8222-222222222222")


def _uuid(value: UUID) -> bytes:
    raw = _fixed64(1, value.int >> 64) + _fixed64(2, value.int & ((1 << 64) - 1))
    return _field(2, raw)


def _floor_plan_payload() -> bytes:
    partition_id = _field(1, _uuid(PARTITION_ID))
    region_id = _field(2, _uuid(REGION_ID))
    points = b"".join(
        _field(1, _fixed32(1, x) + _fixed32(2, y))
        for x, y in ((0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0))
    )
    region = _field(9, b"Test room") + _field(10, _field(1, _field(2, points)))
    region_wire = _field(1, region_id) + _field(2, region)
    partition = partition_id + _field(3, _field(1, region_wire))
    return _field(10, _varint_field(1, 42) + _field(2, partition))


def _region_wire(
    region_id: UUID, name: str, points: tuple[tuple[float, float], ...]
) -> bytes:
    encoded_points = b"".join(
        _field(1, _fixed32(1, x) + _fixed32(2, y)) for x, y in points
    )
    region = _field(9, name.encode()) + _field(10, _field(1, _field(2, encoded_points)))
    return _field(1, _field(2, _uuid(region_id))) + _field(2, region)


def _plan_payload(*regions: bytes) -> bytes:
    partition = _field(1, _uuid(PARTITION_ID)) + _field(
        3, b"".join(_field(1, region) for region in regions)
    )
    return _field(10, _varint_field(1, 42) + _field(2, partition))


def test_decode_named_rooms_and_protocol_ids() -> None:
    floor_plan = decode_floor_plan(_floor_plan_payload())

    assert floor_plan.mission_id == 42
    assert floor_plan.partition_protocol_id == str(PARTITION_ID)
    assert len(floor_plan.rooms) == 1
    assert floor_plan.rooms[0].name == "Test room"
    assert floor_plan.rooms[0].protocol_id == str(REGION_ID)
    assert floor_plan.rooms[0].boundary[0] == (0.0, 0.0)


def test_decode_pose_and_render_local_png() -> None:
    pose_payload = _field(2, _field(1, _field(1, struct.pack("<3f", 2, 1, 0))))
    pose = decode_pose(pose_payload)
    image_bytes = render_floor_plan(
        decode_floor_plan(_floor_plan_payload()), pose, width=512, height=384
    )

    assert (pose.x, pose.y, pose.z) == (2.0, 1.0, 0.0)
    with Image.open(BytesIO(image_bytes)) as image:
        assert image.format == "PNG"
        assert image.size == (512, 384)


def test_decode_rejects_plan_without_standard_partition() -> None:
    with pytest.raises(DecodeError, match="no standard partition"):
        decode_floor_plan(b"")


def test_decode_skips_rooms_with_degenerate_outlines() -> None:
    payload = _plan_payload(
        _region_wire(REGION_ID, "Sliver", ((0.0, 0.0), (1.0, 0.0))),
        _region_wire(
            SECOND_REGION_ID,
            "Kitchen",
            ((0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0)),
        ),
    )

    floor_plan = decode_floor_plan(payload)

    assert [room.name for room in floor_plan.rooms] == ["Kitchen"]
    assert floor_plan.rooms[0].protocol_id == str(SECOND_REGION_ID)


def test_render_blends_semi_transparent_room_fill() -> None:
    from custom_components.matic_robot.client.floor_plan import (
        _BACKGROUND,
        _COLORS,
        _ROOM_FILL_ALPHA,
        _rgba,
    )

    payload = _plan_payload(
        _region_wire(
            REGION_ID,
            "Kitchen",
            ((0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0)),
        )
    )
    image_bytes = render_floor_plan(decode_floor_plan(payload), None)

    expected = (
        Image.alpha_composite(
            Image.new("RGBA", (1, 1), _BACKGROUND),
            Image.new("RGBA", (1, 1), _rgba(_COLORS[0], _ROOM_FILL_ALPHA)),
        )
        .convert("RGB")
        .getpixel((0, 0))
    )

    # A translucent fill must land between the background and the opaque color.
    assert expected != _BACKGROUND[:3]
    assert expected != _rgba(_COLORS[0], 0xFF)[:3]

    with Image.open(BytesIO(image_bytes)) as image:
        colors = {
            color for _count, color in image.convert("RGB").getcolors(maxcolors=1 << 24)
        }
    assert expected in colors


def test_render_placeholder_when_map_is_unavailable() -> None:
    image_bytes = render_floor_plan(None, None, width=256, height=128)

    with Image.open(BytesIO(image_bytes)) as image:
        assert image.format == "PNG"
        assert image.size == (256, 128)
        # The placeholder message is drawn over the flat background color.
        assert len(image.getcolors(maxcolors=4096)) > 1


def test_collinear_room_center_falls_back_to_vertex_average() -> None:
    assert _polygon_center(((0.0, 0.0), (2.0, 2.0), (4.0, 4.0))) == (2.0, 2.0)


def test_render_survives_collinear_room_boundary() -> None:
    payload = _plan_payload(
        _region_wire(REGION_ID, "Hallway", ((0.0, 0.0), (2.0, 2.0), (4.0, 4.0)))
    )

    image_bytes = render_floor_plan(decode_floor_plan(payload), None)

    with Image.open(BytesIO(image_bytes)) as image:
        assert image.format == "PNG"
        assert image.size == (1024, 1024)
