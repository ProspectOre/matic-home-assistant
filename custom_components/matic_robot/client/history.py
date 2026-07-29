"""Decode bounded local cleaning-history media and monthly summaries."""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from io import BytesIO

from google.protobuf.message import DecodeError
from PIL import Image, UnidentifiedImageError

from .models import HermesCollectionEntry
from .wire import WireField, decode_fields, uuid_string

MAX_SESSION_IMAGE_BYTES = 8 * 1024 * 1024
MAX_SESSION_IMAGE_PIXELS = 16_000_000
MAX_RECAP_PAYLOAD_BYTES = 4 * 1024
MAX_RECAP_AREA_M2 = 1_000_000.0
MAX_RECAP_DURATION_SECONDS = 366 * 24 * 60 * 60
MAX_RECAP_SESSION_COUNT = 1_000_000


@dataclass(frozen=True, slots=True)
class CleaningSessionImage:
    """One private session-map image joined by its opaque history key."""

    key: bytes
    image: bytes
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class MonthlyCleaningRecap:
    """Verified monthly cleaning totals retained by the robot."""

    month: int
    year: int
    sweep_area_m2: float
    mop_area_m2: float
    session_count: int
    sweep_duration_seconds: float
    mop_duration_seconds: float
    favorite_room_name: str | None


def decode_cleaning_session_image(entry: HermesCollectionEntry) -> CleaningSessionImage:
    """Decode one private WebP session map without exposing it through HA state."""
    if len(entry.key) != 22 or not entry.value:
        raise DecodeError("cleaning-session image entry has an invalid shape")
    if len(entry.value) > MAX_SESSION_IMAGE_BYTES + 64:
        raise DecodeError("cleaning-session image payload exceeds the size limit")

    fields = decode_fields(entry.value)
    wrappers = _bytes_values(fields, 2)
    if len(fields) != 1 or len(wrappers) != 1:
        raise DecodeError("cleaning-session image envelope has an invalid shape")
    image_fields = decode_fields(wrappers[0])
    images = _bytes_values(image_fields, 1)
    if len(image_fields) != 1 or len(images) != 1:
        raise DecodeError("cleaning-session image wrapper has an invalid shape")
    image = images[0]
    if not image or len(image) > MAX_SESSION_IMAGE_BYTES:
        raise DecodeError("cleaning-session image exceeds the size limit")

    try:
        with Image.open(BytesIO(image)) as decoded:
            image_format = decoded.format
            width, height = decoded.size
            if (
                image_format != "WEBP"
                or width < 1
                or height < 1
                or width * height > MAX_SESSION_IMAGE_PIXELS
            ):
                raise DecodeError("cleaning-session image has unsupported dimensions")
            decoded.verify()
    except (
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
    ) as err:
        raise DecodeError("cleaning-session image is malformed") from err

    return CleaningSessionImage(entry.key, image, width, height)


def decode_monthly_cleaning_recap(entry: HermesCollectionEntry) -> MonthlyCleaningRecap:
    """Decode one verified monthly recap while preserving protocol-native units."""
    if not entry.key or len(entry.key) > 64 or not entry.value:
        raise DecodeError("monthly recap entry is empty or oversized")
    if len(entry.value) > MAX_RECAP_PAYLOAD_BYTES:
        raise DecodeError("monthly recap payload exceeds the size limit")

    key_fields = decode_fields(entry.key)
    months = _varint_values(key_fields, 1)
    years = _varint_values(key_fields, 2)
    if (
        len(key_fields) != 2
        or len(months) != 1
        or len(years) != 1
        or not 1 <= months[0] <= 12
        or not 2000 <= years[0] <= 9999
    ):
        raise DecodeError("monthly recap key has an invalid shape")

    fields = decode_fields(entry.value)
    areas = _bytes_values(fields, 1)
    counts = _varint_values(fields, 2)
    favorites = _bytes_values(fields, 6)
    durations = _bytes_values(fields, 7)
    if (
        len(areas) != 1
        or len(counts) != 1
        or len(favorites) > 1
        or len(durations) != 1
        or len(fields) != 3 + len(favorites)
        or counts[0] > MAX_RECAP_SESSION_COUNT
    ):
        raise DecodeError("monthly recap has an invalid shape")

    sweep_area, mop_area = _decode_area(areas[0])
    sweep_duration, mop_duration = _decode_mode_durations(durations[0])
    favorite_name = _decode_favorite_room(favorites[0]) if favorites else None
    return MonthlyCleaningRecap(
        month=months[0],
        year=years[0],
        sweep_area_m2=sweep_area,
        mop_area_m2=mop_area,
        session_count=counts[0],
        sweep_duration_seconds=sweep_duration,
        mop_duration_seconds=mop_duration,
        favorite_room_name=favorite_name,
    )


def _bytes_values(fields: tuple[WireField, ...], number: int) -> tuple[bytes, ...]:
    return tuple(
        field.value
        for field in fields
        if field.number == number
        and field.wire_type == 2
        and isinstance(field.value, bytes)
    )


def _varint_values(fields: tuple[WireField, ...], number: int) -> tuple[int, ...]:
    return tuple(
        field.value
        for field in fields
        if field.number == number
        and field.wire_type == 0
        and isinstance(field.value, int)
    )


def _fixed32_values(fields: tuple[WireField, ...], number: int) -> tuple[bytes, ...]:
    return tuple(
        field.value
        for field in fields
        if field.number == number
        and field.wire_type == 5
        and isinstance(field.value, bytes)
    )


def _decode_area(payload: bytes) -> tuple[float, float]:
    fields = decode_fields(payload)
    sweep = _fixed32_values(fields, 1)
    mop = _fixed32_values(fields, 2)
    if len(fields) != 2 or len(sweep) != 1 or len(mop) != 1:
        raise DecodeError("monthly recap area has an invalid shape")
    values = (struct.unpack("<f", sweep[0])[0], struct.unpack("<f", mop[0])[0])
    if not all(
        math.isfinite(value) and 0 <= value <= MAX_RECAP_AREA_M2 for value in values
    ):
        raise DecodeError("monthly recap area is outside safe bounds")
    return values


def _decode_mode_durations(payload: bytes) -> tuple[float, float]:
    fields = decode_fields(payload)
    sweep = _bytes_values(fields, 1)
    mop = _bytes_values(fields, 2)
    if len(fields) != 2 or len(sweep) != 1 or len(mop) != 1:
        raise DecodeError("monthly recap durations have an invalid shape")
    return _decode_duration(sweep[0]), _decode_duration(mop[0])


def _decode_duration(payload: bytes) -> float:
    fields = decode_fields(payload)
    seconds = _varint_values(fields, 1)
    nanos = _varint_values(fields, 2)
    if len(seconds) > 1 or len(nanos) > 1 or len(fields) != len(seconds) + len(nanos):
        raise DecodeError("monthly recap duration has an invalid shape")
    second_value = seconds[0] if seconds else 0
    nano_value = nanos[0] if nanos else 0
    if second_value > MAX_RECAP_DURATION_SECONDS or nano_value > 999_999_999:
        raise DecodeError("monthly recap duration is outside safe bounds")
    return second_value + nano_value / 1_000_000_000


def _decode_favorite_room(payload: bytes) -> str | None:
    fields = decode_fields(payload)
    identities = _bytes_values(fields, 1)
    names = _bytes_values(fields, 2)
    if len(fields) != 2 or len(identities) != 1 or len(names) != 1:
        raise DecodeError("monthly recap favorite room has an invalid shape")
    if len(identities[0]) > 128 or len(names[0]) > 256:
        raise DecodeError("monthly recap favorite room exceeds the size limit")
    try:
        uuid_string(identities[0])
    except DecodeError as err:
        raise DecodeError("monthly recap favorite room identity is malformed") from err
    try:
        name = names[0].decode("utf-8").strip()
    except UnicodeDecodeError as err:
        raise DecodeError("monthly recap favorite room name is malformed") from err
    if len(name) > 128 or any(not character.isprintable() for character in name):
        raise DecodeError("monthly recap favorite room name is malformed")
    return name or None
