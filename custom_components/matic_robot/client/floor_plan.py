"""Decode and render local floor-plan data."""

from __future__ import annotations

import math
from hashlib import sha256
from io import BytesIO

from google.protobuf.message import DecodeError
from PIL import Image, ImageDraw, ImageFont

from .models import FloorPlan, RobotPose, Room
from .wire import (
    bytes_fields,
    first_bytes,
    first_varint,
    packed_floats,
    point,
    uuid_string,
)

_COLORS = (
    "#5B8FF9",
    "#61DDAA",
    "#65789B",
    "#F6BD16",
    "#7262FD",
    "#78D3F8",
    "#9661BC",
    "#F6903D",
    "#008685",
    "#F08BB4",
    "#6DC8EC",
    "#FF99C3",
)
_BACKGROUND = (16, 21, 29, 255)  # "#10151D"
_ROOM_FILL_ALPHA = 0x99
_LABEL_BACKGROUND = (16, 21, 29, 0xCC)
_ROBOT_GLOW = (255, 255, 255, 0x44)


def _rgba(hex_color: str, alpha: int) -> tuple[int, int, int, int]:
    """Return an RGBA tuple for a ``#RRGGBB`` color with an explicit alpha."""
    value = hex_color.lstrip("#")
    red, green, blue = (int(value[index : index + 2], 16) for index in (0, 2, 4))
    return (red, green, blue, alpha)


def decode_floor_plan(payload: bytes) -> FloorPlan:
    """Decode the current standard partition and its named rooms."""
    partitions = bytes_fields(payload, 10)
    if not partitions:
        raise DecodeError("coverage plan has no standard partition")
    partition_map_entry = partitions[0]
    mission_id = first_varint(partition_map_entry, 1)
    partition = first_bytes(partition_map_entry, 2)
    partition_id_wire = first_bytes(partition, 1)
    region_collection = first_bytes(partition, 3)

    rooms: list[Room] = []
    for region_wire in bytes_fields(region_collection, 1):
        region_id_wire = first_bytes(region_wire, 1)
        region = first_bytes(region_wire, 2)
        names = bytes_fields(region, 9)
        name = names[0].decode("utf-8", errors="replace").strip() if names else ""
        border = first_bytes(first_bytes(region, 10), 1)
        walk = first_bytes(border, 2)
        boundary = tuple(point(value) for value in bytes_fields(walk, 1))
        if len(boundary) < 3:
            continue
        rooms.append(
            Room(
                id=f"room_{sha256(region_id_wire).hexdigest()[:16]}",
                name=name or f"Room {len(rooms) + 1}",
                protocol_id=uuid_string(region_id_wire),
                id_wire=region_id_wire,
                boundary=boundary,
            )
        )
    return FloorPlan(
        mission_id=mission_id,
        partition_protocol_id=uuid_string(partition_id_wire),
        partition_id_wire=partition_id_wire,
        rooms=tuple(rooms),
    )


def decode_pose(payload: bytes) -> RobotPose:
    """Decode the latest local robot translation."""
    add_message = first_bytes(payload, 2)
    pose_info = first_bytes(add_message, 1)
    translation = packed_floats(first_bytes(pose_info, 1), 3)
    return RobotPose(x=translation[0], y=translation[1], z=translation[2])


def render_floor_plan(
    floor_plan: FloorPlan | None,
    pose: RobotPose | None,
    *,
    width: int = 1024,
    height: int = 1024,
) -> bytes:
    """Render a privacy-preserving, local PNG floor map."""
    image = Image.new("RGBA", (width, height), _BACKGROUND)
    draw = ImageDraw.Draw(image)
    font_size = max(13, min(width, height) // 42)
    label_font = ImageFont.load_default(size=font_size)
    if floor_plan is None or not floor_plan.rooms:
        message = "Matic map unavailable"
        box = draw.textbbox((0, 0), message, font=label_font)
        draw.text(
            ((width - box[2]) / 2, (height - box[3]) / 2),
            message,
            fill="#DDE6F3",
            font=label_font,
        )
        return _png(image)

    all_points = [point for room in floor_plan.rooms for point in room.boundary]
    min_x = min(point[0] for point in all_points)
    max_x = max(point[0] for point in all_points)
    min_y = min(point[1] for point in all_points)
    max_y = max(point[1] for point in all_points)
    padding = max(32, min(width, height) // 18)
    scale = min(
        (width - 2 * padding) / max(max_x - min_x, 0.1),
        (height - 2 * padding) / max(max_y - min_y, 0.1),
    )

    def project(value: tuple[float, float]) -> tuple[float, float]:
        x, y = value
        return (
            padding + (x - min_x) * scale,
            height - padding - (y - min_y) * scale,
        )

    # Semi-transparent fills only blend if drawn onto their own RGBA layer and
    # alpha-composited; painting them straight onto the base would drop alpha.
    rooms_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rooms_draw = ImageDraw.Draw(rooms_layer)
    for index, room in enumerate(floor_plan.rooms):
        polygon = [project(value) for value in room.boundary]
        color = _rgba(_COLORS[index % len(_COLORS)], _ROOM_FILL_ALPHA)
        rooms_draw.polygon(polygon, fill=color, outline="#E8F0FA", width=2)
    image = Image.alpha_composite(image, rooms_layer)

    labels_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    labels_draw = ImageDraw.Draw(labels_layer)
    for room in floor_plan.rooms:
        center = _polygon_center(room.boundary)
        label = room.name
        box = labels_draw.textbbox((0, 0), label, font=label_font)
        text_width = box[2] - box[0]
        text_height = box[3] - box[1]
        label_x, label_y = project(center)
        horizontal_padding = max(7, font_size // 2)
        vertical_padding = max(5, font_size // 3)
        labels_draw.rounded_rectangle(
            (
                label_x - text_width / 2 - horizontal_padding,
                label_y - text_height / 2 - vertical_padding,
                label_x + text_width / 2 + horizontal_padding,
                label_y + text_height / 2 + vertical_padding,
            ),
            radius=max(6, font_size // 3),
            fill=_LABEL_BACKGROUND,
        )
        labels_draw.text(
            (label_x - text_width / 2, label_y - text_height / 2),
            label,
            fill="white",
            font=label_font,
        )
    image = Image.alpha_composite(image, labels_layer)

    if pose is not None and all(math.isfinite(value) for value in (pose.x, pose.y)):
        robot_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        robot_draw = ImageDraw.Draw(robot_layer)
        robot_x, robot_y = project((pose.x, pose.y))
        radius = max(8, min(width, height) // 60)
        robot_draw.ellipse(
            (
                robot_x - radius * 1.7,
                robot_y - radius * 1.7,
                robot_x + radius * 1.7,
                robot_y + radius * 1.7,
            ),
            fill=_ROBOT_GLOW,
        )
        robot_draw.ellipse(
            (
                robot_x - radius,
                robot_y - radius,
                robot_x + radius,
                robot_y + radius,
            ),
            fill="#FFFFFF",
            outline="#10151D",
            width=3,
        )
        center_radius = max(2, radius // 4)
        robot_draw.ellipse(
            (
                robot_x - center_radius,
                robot_y - center_radius,
                robot_x + center_radius,
                robot_y + center_radius,
            ),
            fill="#10151D",
        )
        image = Image.alpha_composite(image, robot_layer)
    return _png(image)


def _polygon_center(points: tuple[tuple[float, float], ...]) -> tuple[float, float]:
    """Return the polygon centroid, falling back safely for degenerate rooms."""
    cross_sum = 0.0
    x_sum = 0.0
    y_sum = 0.0
    for current, following in zip(points, points[1:] + points[:1], strict=True):
        cross = current[0] * following[1] - following[0] * current[1]
        cross_sum += cross
        x_sum += (current[0] + following[0]) * cross
        y_sum += (current[1] + following[1]) * cross
    if abs(cross_sum) > 1e-9:
        return (x_sum / (3 * cross_sum), y_sum / (3 * cross_sum))
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


def _png(image: Image.Image) -> bytes:
    output = BytesIO()
    image.convert("RGB").save(output, "PNG", optimize=True)
    return output.getvalue()
