"""Decode photos the robot takes with its camera (``instamatic_snaps``)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO

from google.protobuf.message import DecodeError
from PIL import Image, UnidentifiedImageError

from .models import HermesCollectionEntry
from .wire import WireField, decode_fields, uuid_string

MAX_PHOTO_BYTES = 4 * 1024 * 1024
MAX_PHOTO_PIXELS = 16_000_000
# Room for the full image, its pixelated preview and the envelope.
MAX_ENTRY_BYTES = 2 * MAX_PHOTO_BYTES + 1024
MAX_PHOTO_FIELDS = 16
# Rejects zero and far-future capture times from a robot without a clock.
MIN_CAPTURE_SECONDS = 1_577_836_800  # 2020-01-01
MAX_CAPTURE_SECONDS = 4_102_444_800  # 2100-01-01


@dataclass(frozen=True, slots=True)
class RobotPhoto:
    """One photo from the robot's camera.

    ``preview`` is the pixelated copy the Matic app shows before the full image
    loads. Both images are WebP.
    """

    photo_id: str
    captured_at: datetime
    image: bytes
    preview: bytes | None
    width: int
    height: int


def decode_instamatic_snap(entry: HermesCollectionEntry) -> RobotPhoto:
    """Decode one ``InstamaticSnap`` entry.

    The value holds capture time in field 1, the full WebP in field 2.1 and a
    pixelated WebP in field 3.1. The key wraps a UUID.
    """
    if not entry.key or len(entry.key) > 64 or not entry.value:
        raise DecodeError("photo entry has an invalid shape")
    if len(entry.value) > MAX_ENTRY_BYTES:
        raise DecodeError("photo entry exceeds the size limit")
    photo_id = uuid_string(entry.key, max_fields=MAX_PHOTO_FIELDS)

    fields = decode_fields(entry.value, max_fields=MAX_PHOTO_FIELDS)
    captured = _single_bytes(fields, 1)
    images = _single_bytes(fields, 2)
    previews = _bytes_values(fields, 3)
    if captured is None or images is None or len(previews) > 1:
        raise DecodeError("photo entry is missing its time or image")

    image = _wrapped_webp(images)
    width, height = _webp_size(image)
    preview = _wrapped_webp(previews[0]) if previews else None
    if preview is not None:
        _webp_size(preview)
    return RobotPhoto(photo_id, _capture_time(captured), image, preview, width, height)


def _capture_time(payload: bytes) -> datetime:
    """Read a Timestamp, either bare or wrapped in field 1."""
    fields = decode_fields(payload, max_fields=MAX_PHOTO_FIELDS)
    wrapped = _single_bytes(fields, 1)
    if wrapped is not None:
        fields = decode_fields(wrapped, max_fields=MAX_PHOTO_FIELDS)
    seconds = _varint_values(fields, 1)
    nanos = _varint_values(fields, 2)
    if (
        len(seconds) != 1
        or len(nanos) > 1
        or not MIN_CAPTURE_SECONDS <= seconds[0] < MAX_CAPTURE_SECONDS
        or (nanos and nanos[0] >= 1_000_000_000)
    ):
        raise DecodeError("photo capture time is invalid")
    microseconds = nanos[0] // 1000 if nanos else 0
    return datetime.fromtimestamp(seconds[0], UTC).replace(microsecond=microseconds)


def _wrapped_webp(payload: bytes) -> bytes:
    image = _single_bytes(decode_fields(payload, max_fields=MAX_PHOTO_FIELDS), 1)
    if image is None or len(image) > MAX_PHOTO_BYTES:
        raise DecodeError("photo image is missing or too large")
    return image


def _webp_size(image: bytes) -> tuple[int, int]:
    if image[:4] != b"RIFF" or image[8:12] != b"WEBP":
        raise DecodeError("photo image is not WebP")
    try:
        with Image.open(BytesIO(image)) as decoded:
            width, height = decoded.size
            if width < 1 or height < 1 or width * height > MAX_PHOTO_PIXELS:
                raise DecodeError("photo image has unsupported dimensions")
            decoded.verify()
    except (
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
    ) as err:
        raise DecodeError("photo image is malformed") from err
    return width, height


def _single_bytes(fields: tuple[WireField, ...], number: int) -> bytes | None:
    values = _bytes_values(fields, number)
    return values[0] if len(values) == 1 else None


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
