"""Tests for bounded native cleaning-history decoders."""

from __future__ import annotations

import struct
from io import BytesIO

import pytest
from google.protobuf.message import DecodeError
from PIL import Image

from custom_components.matic_robot.client import history
from custom_components.matic_robot.client.history import (
    MAX_RECAP_AREA_M2,
    MAX_RECAP_DURATION_SECONDS,
    MAX_RECAP_PAYLOAD_BYTES,
    MAX_RECAP_SESSION_COUNT,
    MAX_SESSION_IMAGE_BYTES,
    decode_cleaning_session_image,
    decode_monthly_cleaning_recap,
)
from custom_components.matic_robot.client.models import HermesCollectionEntry
from tests.wire_builders import _bfield, _fixed64, _vfield


def _fixed32(number: int, value: float) -> bytes:
    return bytes(((number << 3) | 5,)) + struct.pack("<f", value)


def _webp() -> bytes:
    output = BytesIO()
    Image.new("RGB", (4, 3), (12, 34, 56)).save(output, format="WEBP")
    return output.getvalue()


def _image_entry(image: bytes | None = None, *, key: bytes = b"k" * 22):
    payload = _webp() if image is None else image
    return HermesCollectionEntry(key, _bfield(2, _bfield(1, payload)))


def _duration(seconds: int = 60, nanos: int = 0) -> bytes:
    return _vfield(1, seconds) + _vfield(2, nanos)


def _favorite(name: bytes = b"Office", *, identity: bytes | None = None) -> bytes:
    uuid = _fixed64(1, 1) + _fixed64(2, 2)
    return _bfield(1, identity if identity is not None else _bfield(2, uuid)) + _bfield(
        2, name
    )


def _recap_entry(
    *,
    key: bytes | None = None,
    area: bytes | None = None,
    count: int = 3,
    favorite: bytes | None = _favorite(),
    durations: bytes | None = None,
    suffix: bytes = b"",
) -> HermesCollectionEntry:
    key = _vfield(1, 7) + _vfield(2, 2026) if key is None else key
    area = _fixed32(1, 12.5) + _fixed32(2, 4.25) if area is None else area
    durations = (
        _bfield(1, _duration(120, 500_000_000)) + _bfield(2, _duration(30, 250_000_000))
        if durations is None
        else durations
    )
    value = _bfield(1, area) + _vfield(2, count)
    if favorite is not None:
        value += _bfield(6, favorite)
    value += _bfield(7, durations) + suffix
    return HermesCollectionEntry(key, value)


def test_decode_cleaning_session_image_preserves_private_webp() -> None:
    entry = _image_entry()

    decoded = decode_cleaning_session_image(entry)

    assert decoded.key == entry.key
    assert decoded.image.startswith(b"RIFF")
    assert (decoded.width, decoded.height) == (4, 3)


@pytest.mark.parametrize(
    ("entry", "message"),
    [
        (HermesCollectionEntry(b"short", b"value"), "invalid shape"),
        (HermesCollectionEntry(b"k" * 22, b""), "invalid shape"),
        (
            HermesCollectionEntry(b"k" * 22, b"x" * (MAX_SESSION_IMAGE_BYTES + 65)),
            "payload exceeds",
        ),
        (HermesCollectionEntry(b"k" * 22, _bfield(1, b"wrong")), "envelope"),
        (
            HermesCollectionEntry(
                b"k" * 22, _bfield(2, _bfield(1, b"one") + _bfield(1, b"two"))
            ),
            "wrapper",
        ),
        (_image_entry(b""), "size limit"),
        (_image_entry(b"not-a-webp"), "malformed"),
    ],
)
def test_decode_cleaning_session_image_rejects_invalid_entries(
    entry: HermesCollectionEntry, message: str
) -> None:
    with pytest.raises(DecodeError, match=message):
        decode_cleaning_session_image(entry)


def test_decode_cleaning_session_image_rejects_unsupported_format_and_size(
    monkeypatch,
) -> None:
    png = BytesIO()
    Image.new("RGB", (2, 2)).save(png, format="PNG")
    with pytest.raises(DecodeError, match="unsupported dimensions"):
        decode_cleaning_session_image(_image_entry(png.getvalue()))

    monkeypatch.setattr(history, "MAX_SESSION_IMAGE_PIXELS", 1)
    with pytest.raises(DecodeError, match="unsupported dimensions"):
        decode_cleaning_session_image(_image_entry())


def test_decode_monthly_cleaning_recap_preserves_si_units() -> None:
    recap = decode_monthly_cleaning_recap(_recap_entry())

    assert (recap.month, recap.year) == (7, 2026)
    assert recap.sweep_area_m2 == 12.5
    assert recap.mop_area_m2 == 4.25
    assert recap.session_count == 3
    assert recap.sweep_duration_seconds == 120.5
    assert recap.mop_duration_seconds == 30.25
    assert recap.favorite_room_name == "Office"

    without_favorite = decode_monthly_cleaning_recap(_recap_entry(favorite=None))
    assert without_favorite.favorite_room_name is None


@pytest.mark.parametrize(
    ("entry", "message"),
    [
        (HermesCollectionEntry(b"", b"value"), "empty or oversized"),
        (HermesCollectionEntry(b"k" * 65, b"value"), "empty or oversized"),
        (HermesCollectionEntry(b"key", b""), "empty or oversized"),
        (
            HermesCollectionEntry(b"key", b"x" * (MAX_RECAP_PAYLOAD_BYTES + 1)),
            "payload exceeds",
        ),
        (_recap_entry(key=_vfield(1, 0) + _vfield(2, 2026)), "key"),
        (_recap_entry(key=_vfield(1, 7) + _vfield(2, 1999)), "key"),
        (_recap_entry(suffix=_vfield(9, 1)), "invalid shape"),
        (_recap_entry(count=MAX_RECAP_SESSION_COUNT + 1), "invalid shape"),
    ],
)
def test_decode_monthly_cleaning_recap_rejects_invalid_envelopes(
    entry: HermesCollectionEntry, message: str
) -> None:
    with pytest.raises(DecodeError, match=message):
        decode_monthly_cleaning_recap(entry)


@pytest.mark.parametrize(
    "area",
    [
        _fixed32(1, 1.0),
        _fixed32(1, -1.0) + _fixed32(2, 1.0),
        _fixed32(1, float("nan")) + _fixed32(2, 1.0),
        _fixed32(1, MAX_RECAP_AREA_M2 + 1.0) + _fixed32(2, 1.0),
    ],
)
def test_decode_monthly_cleaning_recap_rejects_invalid_area(area: bytes) -> None:
    with pytest.raises(DecodeError, match="area"):
        decode_monthly_cleaning_recap(_recap_entry(area=area))


@pytest.mark.parametrize(
    "durations",
    [
        _bfield(1, _duration()),
        _bfield(1, _duration()) + _bfield(2, _duration()) + _bfield(3, b"extra"),
        _bfield(1, _vfield(1, 1) + _vfield(1, 2)) + _bfield(2, _duration()),
        _bfield(1, _duration(MAX_RECAP_DURATION_SECONDS + 1)) + _bfield(2, _duration()),
        _bfield(1, _duration(1, 1_000_000_000)) + _bfield(2, _duration()),
    ],
)
def test_decode_monthly_cleaning_recap_rejects_invalid_durations(
    durations: bytes,
) -> None:
    with pytest.raises(DecodeError, match="duration"):
        decode_monthly_cleaning_recap(_recap_entry(durations=durations))


def test_decode_monthly_cleaning_recap_accepts_default_duration_fields() -> None:
    recap = decode_monthly_cleaning_recap(
        _recap_entry(durations=_bfield(1, b"") + _bfield(2, b""))
    )
    assert recap.sweep_duration_seconds == 0
    assert recap.mop_duration_seconds == 0


@pytest.mark.parametrize(
    "favorite",
    [
        _bfield(2, b"Office"),
        _favorite(identity=b"bad-uuid"),
        _favorite(b"x" * 257),
        _favorite(b"\xff"),
        _favorite(b"Office\nSecond line"),
        _favorite(b"x" * 129),
    ],
)
def test_decode_monthly_cleaning_recap_rejects_invalid_favorite_room(
    favorite: bytes,
) -> None:
    with pytest.raises(DecodeError, match=r"favorite|UUID"):
        decode_monthly_cleaning_recap(_recap_entry(favorite=favorite))


def test_decode_monthly_cleaning_recap_accepts_empty_favorite_name() -> None:
    recap = decode_monthly_cleaning_recap(_recap_entry(favorite=_favorite(b"  ")))
    assert recap.favorite_room_name is None
