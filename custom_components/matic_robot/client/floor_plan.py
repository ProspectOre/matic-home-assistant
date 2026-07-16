"""Decode and render local floor-plan data."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from itertools import combinations

from google.protobuf.message import DecodeError
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

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
_OPAQUE_ONLY = (0,) * 255 + (255,)

_Point = tuple[float, float]
_Box = tuple[int, int, int, int]


@dataclass(frozen=True, slots=True)
class _LabelLayout:
    """A room label that fits inside its room without touching another label."""

    room_index: int
    lines: tuple[str, ...]
    font_size: int
    box: _Box
    text_box: _Box
    spacing: int


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
    projected_rooms = tuple(
        (room.name, tuple(project(value) for value in room.boundary))
        for room in floor_plan.rooms
    )
    for index, (_name, polygon) in enumerate(projected_rooms):
        color = _rgba(_COLORS[index % len(_COLORS)], _ROOM_FILL_ALPHA)
        rooms_draw.polygon(polygon, fill=color, outline="#E8F0FA", width=2)
    image = Image.alpha_composite(image, rooms_layer)

    labels_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    labels_draw = ImageDraw.Draw(labels_layer)
    for layout in _layout_room_labels(
        projected_rooms,
        width=width,
        height=height,
        font_size=font_size,
    ):
        label_font = ImageFont.load_default(size=layout.font_size)
        text = "\n".join(layout.lines)
        text_width = layout.text_box[2] - layout.text_box[0]
        text_height = layout.text_box[3] - layout.text_box[1]
        label_width = layout.box[2] - layout.box[0]
        label_height = layout.box[3] - layout.box[1]
        labels_draw.rounded_rectangle(
            (
                layout.box[0],
                layout.box[1],
                layout.box[2] - 1,
                layout.box[3] - 1,
            ),
            radius=max(4, layout.font_size // 3),
            fill=_LABEL_BACKGROUND,
        )
        labels_draw.multiline_text(
            (
                layout.box[0] + (label_width - text_width) / 2 - layout.text_box[0],
                layout.box[1] + (label_height - text_height) / 2 - layout.text_box[1],
            ),
            text,
            fill="white",
            font=label_font,
            spacing=layout.spacing,
            align="center",
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


def _layout_room_labels(
    rooms: Sequence[tuple[str, tuple[_Point, ...]]],
    *,
    width: int,
    height: int,
    font_size: int,
) -> tuple[_LabelLayout, ...]:
    """Fit readable labels inside rooms, prioritizing the tightest spaces."""
    measure_image = Image.new("L", (1, 1))
    measure_draw = ImageDraw.Draw(measure_image)
    occupied: list[_Box] = []
    layouts: list[_LabelLayout] = []

    room_order = sorted(
        range(len(rooms)),
        key=lambda index: _polygon_area(rooms[index][1]),
    )
    for room_index in room_order:
        label, polygon = rooms[room_index]
        if _polygon_area(polygon) < 1:
            continue
        room_mask = Image.new("L", (width, height), 0)
        ImageDraw.Draw(room_mask).polygon(polygon, fill=255)
        preferred = _polygon_center(polygon)

        layout = _fit_room_label(
            room_index,
            label,
            polygon,
            room_mask,
            preferred,
            occupied,
            measure_draw,
            font_size,
        )
        if layout is not None:
            layouts.append(layout)
            occupied.append(layout.box)

    return tuple(sorted(layouts, key=lambda layout: layout.room_index))


def _fit_room_label(
    room_index: int,
    label: str,
    polygon: tuple[_Point, ...],
    room_mask: Image.Image,
    preferred: _Point,
    occupied: Sequence[_Box],
    draw: ImageDraw.ImageDraw,
    font_size: int,
) -> _LabelLayout | None:
    """Return the largest collision-free label that fits inside a room."""
    minimum_font_size = max(10, font_size // 3)
    variants = _label_line_variants(label)
    for candidate_font_size in range(font_size, minimum_font_size - 1, -1):
        font = ImageFont.load_default(size=candidate_font_size)
        spacing = max(1, candidate_font_size // 8)
        measured_variants: list[tuple[tuple[str, ...], _Box]] = []
        for lines in variants:
            measured_box = draw.multiline_textbbox(
                (0, 0),
                "\n".join(lines),
                font=font,
                spacing=spacing,
                align="center",
            )
            text_box = (
                math.floor(measured_box[0]),
                math.floor(measured_box[1]),
                math.ceil(measured_box[2]),
                math.ceil(measured_box[3]),
            )
            measured_variants.append((lines, text_box))
        measured_variants.sort(
            key=lambda value: (
                len(value[0]),
                _line_width_spread(draw, value[0], font),
            )
        )

        for lines, text_box in measured_variants:
            text_width = text_box[2] - text_box[0]
            text_height = text_box[3] - text_box[1]
            horizontal_padding = max(4, candidate_font_size // 3)
            vertical_padding = max(3, candidate_font_size // 5)
            label_width = text_width + 2 * horizontal_padding
            label_height = text_height + 2 * vertical_padding
            room_margin = max(1, candidate_font_size // 10)
            required_area = (label_width + 2 * room_margin) * (
                label_height + 2 * room_margin
            )
            if _polygon_area(polygon) < required_area:
                continue

            available_centers = _erode_room_mask(
                room_mask,
                label_width + 2 * room_margin,
                label_height + 2 * room_margin,
            )
            collision_gap = max(2, candidate_font_size // 6)
            available_centers = _exclude_label_collisions(
                available_centers,
                occupied,
                label_width,
                label_height,
                collision_gap,
            )
            center = _nearest_mask_point(available_centers, preferred)
            if center is None:
                continue
            return _LabelLayout(
                room_index=room_index,
                lines=lines,
                font_size=candidate_font_size,
                box=_centered_box(center, label_width, label_height),
                text_box=text_box,
                spacing=spacing,
            )
    return None


def _label_line_variants(label: str) -> tuple[tuple[str, ...], ...]:
    """Return natural one-, two-, and three-line variants of a room name."""
    words = tuple(label.split())
    if len(words) < 2:
        return ((label,),)

    variants: list[tuple[str, ...]] = [(" ".join(words),)]
    for line_count in range(2, min(3, len(words)) + 1):
        for breaks in combinations(range(1, len(words)), line_count - 1):
            boundaries = (0, *breaks, len(words))
            variants.append(
                tuple(
                    " ".join(words[boundaries[index] : boundaries[index + 1]])
                    for index in range(line_count)
                )
            )
    return tuple(variants)


def _line_width_spread(
    draw: ImageDraw.ImageDraw,
    lines: tuple[str, ...],
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont,
) -> int:
    """Measure how unevenly a wrapped label uses its lines."""
    widths = [draw.textlength(line, font=font) for line in lines]
    return round(max(widths) - min(widths))


def _erode_room_mask(mask: Image.Image, box_width: int, box_height: int) -> Image.Image:
    """Return every center where the complete rectangular label fits."""
    if box_width > mask.width or box_height > mask.height:
        return Image.new("L", mask.size, 0)

    horizontal = mask
    horizontal_radius = (box_width - 1) // 2
    if horizontal_radius:
        horizontal = horizontal.filter(
            ImageFilter.BoxBlur((horizontal_radius, 0))
        ).point(_OPAQUE_ONLY)
    if box_width % 2 == 0:
        horizontal = ImageChops.darker(
            horizontal,
            _shift_mask(mask, x_offset=box_width // 2),
        )

    vertical = horizontal
    vertical_radius = (box_height - 1) // 2
    if vertical_radius:
        vertical = vertical.filter(ImageFilter.BoxBlur((0, vertical_radius))).point(
            _OPAQUE_ONLY
        )
    if box_height % 2 == 0:
        vertical = ImageChops.darker(
            vertical,
            _shift_mask(horizontal, y_offset=box_height // 2),
        )
    return vertical


def _shift_mask(
    mask: Image.Image, *, x_offset: int = 0, y_offset: int = 0
) -> Image.Image:
    """Shift a mask without wrapping pixels around the image edges."""
    shifted = Image.new("L", mask.size, 0)
    shifted.paste(mask, (x_offset, y_offset))
    return shifted


def _exclude_label_collisions(
    mask: Image.Image,
    occupied: Sequence[_Box],
    label_width: int,
    label_height: int,
    gap: int,
) -> Image.Image:
    """Remove centers whose label box would collide with an existing label."""
    if not occupied:
        return mask

    available = mask.copy()
    draw = ImageDraw.Draw(available)
    left_half = label_width // 2
    right_half = label_width - left_half
    top_half = label_height // 2
    bottom_half = label_height - top_half
    for box in occupied:
        draw.rectangle(
            (
                box[0] - right_half - gap + 1,
                box[1] - bottom_half - gap + 1,
                box[2] + left_half + gap - 1,
                box[3] + top_half + gap - 1,
            ),
            fill=0,
        )
    return available


def _nearest_mask_point(mask: Image.Image, preferred: _Point) -> tuple[int, int] | None:
    """Find a bounded center-out candidate without materializing a pixel grid."""
    bounds = mask.getbbox()
    if bounds is None:
        return None

    preferred_x = min(max(round(preferred[0]), bounds[0]), bounds[2] - 1)
    preferred_y = min(max(round(preferred[1]), bounds[1]), bounds[3] - 1)
    if mask.getpixel((preferred_x, preferred_y)) == 255:
        return (preferred_x, preferred_y)

    max_radius = max(
        preferred_x - bounds[0],
        bounds[2] - preferred_x,
        preferred_y - bounds[1],
        bounds[3] - preferred_y,
    )
    radius = 4
    while radius < max_radius:
        search_box = (
            max(bounds[0], preferred_x - radius),
            max(bounds[1], preferred_y - radius),
            min(bounds[2], preferred_x + radius + 1),
            min(bounds[3], preferred_y + radius + 1),
        )
        if (candidate := _first_mask_point(mask, search_box)) is not None:
            return candidate
        radius *= 2
    return _first_mask_point(mask, bounds)


def _first_mask_point(mask: Image.Image, box: _Box) -> tuple[int, int] | None:
    """Return the first available point in a cropped mask region."""
    cropped = mask.crop(box)
    offset = cropped.tobytes().find(b"\xff")
    if offset < 0:
        return None
    return (
        box[0] + offset % cropped.width,
        box[1] + offset // cropped.width,
    )


def _centered_box(center: tuple[int, int], width: int, height: int) -> _Box:
    """Return an integer image box centered on a candidate point."""
    left = center[0] - width // 2
    top = center[1] - height // 2
    return (left, top, left + width, top + height)


def _box_inside_mask(box: _Box, mask: Image.Image, margin: int = 0) -> bool:
    """Return whether a box and optional margin are fully inside a room mask."""
    expanded = (
        box[0] - margin,
        box[1] - margin,
        box[2] + margin,
        box[3] + margin,
    )
    if (
        expanded[0] < 0
        or expanded[1] < 0
        or expanded[2] > mask.width
        or expanded[3] > mask.height
    ):
        return False
    return mask.crop(expanded).getextrema() == (255, 255)


def _boxes_overlap(first: _Box, second: _Box, *, gap: int = 0) -> bool:
    """Return whether two label boxes overlap or violate their visual gap."""
    return not (
        first[2] + gap <= second[0]
        or second[2] + gap <= first[0]
        or first[3] + gap <= second[1]
        or second[3] + gap <= first[1]
    )


def _polygon_area(points: tuple[_Point, ...]) -> float:
    """Return the absolute area of a polygon."""
    return abs(
        sum(
            current[0] * following[1] - following[0] * current[1]
            for current, following in zip(points, points[1:] + points[:1], strict=True)
        )
        / 2
    )


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
