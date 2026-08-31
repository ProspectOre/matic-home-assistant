"""Synthetic fixtures for local Matic maps and room names."""

from __future__ import annotations

import struct
from io import BytesIO
from itertools import combinations
from time import perf_counter
from uuid import UUID

import pytest
from google.protobuf.message import DecodeError
from PIL import Image, ImageChops, ImageDraw

from custom_components.matic_robot.client import floor_plan as floor_plan_module
from custom_components.matic_robot.client.floor_plan import (
    _box_inside_mask,
    _boxes_overlap,
    _erode_room_mask,
    _layout_room_labels,
    _nearest_mask_point,
    _polygon_center,
    decode_floor_plan,
    decode_floor_plans,
    decode_pose,
    pose_vector_paths,
    render_floor_plan,
    resolve_robot_map_position,
    robot_location_source,
)
from custom_components.matic_robot.client.models import FloorPlan, RobotPose, Room
from tests.wire_builders import _field, _fixed32, _fixed64, _varint_field

PARTITION_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
REGION_ID = UUID("11111111-1111-4111-8111-111111111111")
SECOND_REGION_ID = UUID("22222222-2222-4222-8222-222222222222")


def _uuid(value: UUID) -> bytes:
    raw = _fixed64(1, value.int >> 64) + _fixed64(2, value.int & ((1 << 64) - 1))
    return _field(2, raw)


def _floor_plan_payload(mission_id: int = 42) -> bytes:
    partition_id = _field(1, _uuid(PARTITION_ID))
    region_id = _field(2, _uuid(REGION_ID))
    points = b"".join(
        _field(1, _fixed32(1, x) + _fixed32(2, y))
        for x, y in ((0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0))
    )
    region = _field(9, b"Test room") + _field(10, _field(1, _field(2, points)))
    region_wire = _field(1, region_id) + _field(2, region)
    partition = partition_id + _field(3, _field(1, region_wire))
    return _field(10, _varint_field(1, mission_id) + _field(2, partition))


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


def test_decode_all_mapped_floors_without_guessing_the_active_one() -> None:
    payload = _floor_plan_payload(42) + _floor_plan_payload(84)

    assert [plan.mission_id for plan in decode_floor_plans(payload)] == [42, 84]
    with pytest.raises(DecodeError, match="multiple mapped floors"):
        decode_floor_plan(payload)


def test_decode_mapped_floors_rejects_duplicate_or_excessive_identities(
    monkeypatch,
) -> None:
    duplicate = _floor_plan_payload(42) + _floor_plan_payload(42)
    with pytest.raises(DecodeError, match="repeats a mapped floor"):
        decode_floor_plans(duplicate)

    monkeypatch.setattr(floor_plan_module, "MAX_FLOOR_PLANS", 1)
    with pytest.raises(DecodeError, match="too many mapped floors"):
        decode_floor_plans(_floor_plan_payload(42) + _floor_plan_payload(84))


def test_decode_pose_and_render_local_png() -> None:
    pose_payload = _field(2, _field(1, _field(1, struct.pack("<3f", 2, 1, 0))))
    pose = decode_pose(pose_payload)
    image_bytes = render_floor_plan(
        decode_floor_plan(_floor_plan_payload()), pose, width=512, height=384
    )

    assert (pose.x, pose.y, pose.z) == (2.0, 1.0, 0.0)
    assert pose_vector_paths(pose_payload) == ((2, 1, 1),)
    with Image.open(BytesIO(image_bytes)) as image:
        assert image.format == "PNG"
        assert image.size == (512, 384)

    current_payload = _field(5, _field(1, struct.pack("<3f", 3, 2, 1)))
    assert decode_pose(current_payload) == RobotPose(3, 2, 1)

    repeated_components = _field(
        2,
        _field(
            1,
            _field(1, struct.pack("<f", -4.5))
            + _field(1, struct.pack("<f", 2.25))
            + _field(1, struct.pack("<f", 0.0)),
        ),
    )
    assert decode_pose(repeated_components) == RobotPose(-4.5, 2.25, 0.0)


def test_decode_pose_rejects_incomplete_repeated_translation() -> None:
    payload = _field(
        2,
        _field(
            1,
            _field(1, struct.pack("<f", 1.0)) + _field(1, struct.pack("<f", 2.0)),
        ),
    )

    with pytest.raises(DecodeError):
        decode_pose(payload)


def test_pose_vector_path_inspection_is_bounded_and_ignores_invalid_data() -> None:
    too_deep = struct.pack("<3f", 1, 2, 3)
    for _ in range(10):
        too_deep = _field(1, too_deep)
    payload = (
        _varint_field(4, 1)
        + _field(1, b"bad")
        + _field(2, struct.pack("<3f", float("nan"), 2, 3))
        + _field(3, too_deep)
    )

    assert pose_vector_paths(payload) == ()


def test_robot_position_requires_exact_coordinates_and_tracks_room_presence() -> None:
    floor_plan = decode_floor_plan(_floor_plan_payload())

    assert resolve_robot_map_position(floor_plan, RobotPose(2, 1, 0), "Test room") == (
        2,
        1,
        "exact_pose",
    )
    invalid_pose = RobotPose(float("nan"), 999, 0)
    assert (
        resolve_robot_map_position(floor_plan, invalid_pose, "the  Test room") is None
    )
    assert robot_location_source(floor_plan, invalid_pose, "the  Test room") == (
        "current_area"
    )
    assert robot_location_source(floor_plan, RobotPose(2, 1, 0), None) == ("exact_pose")
    assert robot_location_source(floor_plan, None, "Garage") == "unavailable"
    assert robot_location_source(floor_plan, None, None) == "unavailable"
    assert robot_location_source(None, None, "Test room") == "unavailable"
    assert resolve_robot_map_position(floor_plan, None, "Garage") is None
    assert resolve_robot_map_position(floor_plan, None, "   ") is None
    assert resolve_robot_map_position(None, None, "Test room") is None
    assert (
        resolve_robot_map_position(FloorPlan(1, "partition", b"", ()), None, None)
        is None
    )

    without_marker = render_floor_plan(floor_plan, None, width=256, height=256)
    fallback_marker = render_floor_plan(
        floor_plan, None, "the Test room", width=256, height=256
    )
    assert fallback_marker == without_marker


def test_robot_position_rejects_a_pose_in_a_different_reported_room() -> None:
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room("room-1", "Office", "one", b"one", ((0, 0), (2, 0), (2, 2), (0, 2))),
            Room(
                "room-2",
                "Living room",
                "two",
                b"two",
                ((3, 0), (5, 0), (5, 2), (3, 2)),
            ),
        ),
    )
    conflicting_pose = RobotPose(4, 1, 0)

    assert resolve_robot_map_position(floor_plan, conflicting_pose, "Office") is None
    assert robot_location_source(floor_plan, conflicting_pose, "Office") == (
        "current_area"
    )
    assert resolve_robot_map_position(
        floor_plan, conflicting_pose, "the Living room"
    ) == (4, 1, "exact_pose")
    assert resolve_robot_map_position(floor_plan, RobotPose(2, 1, 0), "Office") == (
        2,
        1,
        "exact_pose",
    )
    assert resolve_robot_map_position(floor_plan, RobotPose(2.5, 1, 0), None) is None
    assert resolve_robot_map_position(floor_plan, RobotPose(6, 1, 0), None) is None

    duplicate_vertex_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                "room-1",
                "Office",
                "one",
                b"one",
                ((0, 0), (0, 0), (2, 0), (2, 2), (0, 2)),
            ),
        ),
    )
    assert resolve_robot_map_position(
        duplicate_vertex_plan, RobotPose(1, 1, 0), "Office"
    ) == (1, 1, "exact_pose")

    incomplete_boundary_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (Room("room-1", "Office", "one", b"one", ((0, 0), (2, 2))),),
    )
    assert (
        resolve_robot_map_position(
            incomplete_boundary_plan, RobotPose(1, 1, 0), "Office"
        )
        is None
    )


def test_decode_rejects_plan_without_standard_partition() -> None:
    with pytest.raises(DecodeError, match="no standard partition"):
        decode_floor_plan(b"")


@pytest.mark.parametrize(
    ("limit_name", "limit", "message"),
    [
        ("MAX_FLOOR_PLAN_PAYLOAD_BYTES", 1, "byte limit"),
        ("MAX_FLOOR_PLAN_ROOMS", 0, "too many rooms"),
        ("MAX_ROOM_BOUNDARY_POINTS", 3, "room has too many"),
        ("MAX_FLOOR_PLAN_BOUNDARY_POINTS", 3, "too many boundary"),
        ("MAX_ROOM_NAME_BYTES", 1, "room name"),
        ("MAX_MAP_COORDINATE", 3.0, "boundary coordinate"),
    ],
)
def test_decode_floor_plan_enforces_geometry_budgets(
    monkeypatch, limit_name, limit, message
) -> None:
    monkeypatch.setattr(floor_plan_module, limit_name, limit)

    with pytest.raises(DecodeError, match=message):
        decode_floor_plan(_floor_plan_payload())


@pytest.mark.parametrize("coordinate", [float("nan"), float("inf")])
def test_decode_floor_plan_rejects_non_finite_coordinates(coordinate) -> None:
    payload = _plan_payload(
        _region_wire(
            REGION_ID,
            "Unsafe",
            ((0.0, 0.0), (coordinate, 0.0), (1.0, 1.0)),
        )
    )

    with pytest.raises(DecodeError, match="boundary coordinate"):
        decode_floor_plan(payload)


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


def test_render_centers_a_narrow_floor_plan_in_a_wide_viewport() -> None:
    from custom_components.matic_robot.client.floor_plan import _BACKGROUND

    payload = _plan_payload(
        _region_wire(
            REGION_ID,
            "Hallway",
            ((0.0, 0.0), (1.0, 0.0), (1.0, 6.0), (0.0, 6.0)),
        )
    )
    image_bytes = render_floor_plan(
        decode_floor_plan(payload),
        None,
        width=640,
        height=320,
    )

    with Image.open(BytesIO(image_bytes)).convert("RGB") as image:
        background = Image.new("RGB", image.size, _BACKGROUND[:3])
        bounds = ImageChops.difference(image, background).getbbox()

    assert bounds is not None
    assert abs(bounds[0] - (640 - bounds[2])) <= 2


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


def test_room_labels_wrap_and_scale_to_stay_inside_tight_rooms() -> None:
    rooms = (
        ("Bathroom", ((20.0, 20.0), (92.0, 20.0), (92.0, 145.0), (20.0, 145.0))),
        (
            "Guest Room",
            ((92.0, 20.0), (260.0, 20.0), (260.0, 180.0), (92.0, 180.0)),
        ),
        (
            "Master Bathroom",
            ((270.0, 20.0), (360.0, 20.0), (360.0, 220.0), (270.0, 220.0)),
        ),
        (
            "Laundry Room",
            ((20.0, 170.0), (145.0, 170.0), (145.0, 280.0), (20.0, 280.0)),
        ),
        (
            "Open Plan Dining Room",
            (
                (155.0, 200.0),
                (365.0, 200.0),
                (365.0, 370.0),
                (155.0, 370.0),
            ),
        ),
    )

    layouts = _layout_room_labels(rooms, width=400, height=400, font_size=24)

    assert len(layouts) == len(rooms)
    assert layouts[0].font_size < 24
    assert layouts[2].lines == ("Master", "Bathroom")
    for layout in layouts:
        mask = Image.new("L", (400, 400), 0)
        ImageDraw.Draw(mask).polygon(rooms[layout.room_index][1], fill=255)
        assert _box_inside_mask(layout.box, mask)
    assert all(
        not _boxes_overlap(first.box, second.box)
        for first, second in combinations(layouts, 2)
    )


def test_room_label_layout_avoids_collisions_between_overlapping_regions() -> None:
    polygon = ((20.0, 20.0), (240.0, 20.0), (240.0, 160.0), (20.0, 160.0))

    layouts = _layout_room_labels(
        (("Bathroom", polygon), ("Guest Room", polygon)),
        width=260,
        height=180,
        font_size=24,
    )

    assert len(layouts) == 2
    assert not _boxes_overlap(layouts[0].box, layouts[1].box, gap=3)


def test_room_label_layout_moves_out_of_a_concave_room_cutout() -> None:
    polygon = (
        (20.0, 20.0),
        (240.0, 20.0),
        (240.0, 70.0),
        (70.0, 70.0),
        (70.0, 240.0),
        (20.0, 240.0),
    )

    layouts = _layout_room_labels(
        (("Kitchen", polygon),), width=260, height=260, font_size=24
    )

    assert len(layouts) == 1
    mask = Image.new("L", (260, 260), 0)
    ImageDraw.Draw(mask).polygon(polygon, fill=255)
    assert _box_inside_mask(layouts[0].box, mask)


def test_room_label_layout_omits_a_physically_impossible_label() -> None:
    rooms = (("Bathroom", ((20.0, 20.0), (25.0, 20.0), (25.0, 370.0), (20.0, 370.0))),)

    assert _layout_room_labels(rooms, width=400, height=400, font_size=24) == ()


def test_room_label_containment_rejects_boxes_outside_the_image() -> None:
    mask = Image.new("L", (20, 20), 255)

    assert not _box_inside_mask((-1, 1, 10, 10), mask)
    assert _erode_room_mask(mask, 21, 1).getbbox() is None

    sparse_mask = Image.new("L", (5, 5), 0)
    sparse_mask.putpixel((0, 0), 255)
    sparse_mask.putpixel((4, 4), 255)
    assert _nearest_mask_point(sparse_mask, (2.0, 2.0)) == (0, 0)


def test_large_sparse_room_label_layout_has_bounded_runtime() -> None:
    diagonal_corridor = (
        (20.0, 80.0),
        (50.0, 50.0),
        (1000.0, 950.0),
        (970.0, 980.0),
    )
    l_shaped_hallway = (
        (10.0, 10.0),
        (1014.0, 10.0),
        (1014.0, 40.0),
        (40.0, 40.0),
        (40.0, 1014.0),
        (10.0, 1014.0),
    )

    started = perf_counter()
    layouts = _layout_room_labels(
        (
            ("Diagonal Corridor", diagonal_corridor),
            ("Long Hallway", l_shaped_hallway),
        ),
        width=1024,
        height=1024,
        font_size=24,
    )
    elapsed = perf_counter() - started

    assert elapsed < 2.0
    assert [layout.room_index for layout in layouts] == [1]
    mask = Image.new("L", (1024, 1024), 0)
    ImageDraw.Draw(mask).polygon(l_shaped_hallway, fill=255)
    assert _box_inside_mask(layouts[0].box, mask)
