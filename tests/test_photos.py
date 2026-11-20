"""Robot camera photos: decoding, the photo store and its entities."""

from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from google.protobuf.message import DecodeError
from homeassistant.exceptions import HomeAssistantError
from PIL import Image

from custom_components.matic_robot import button
from custom_components.matic_robot.client import snaps
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.models import HermesCollectionEntry
from custom_components.matic_robot.client.snaps import decode_instamatic_snap
from tests.test_entities import _entry as _entities_entry
from tests.wire_builders import _bfield, _session_identity, _vfield

PHOTO_ID = UUID("12345678-1234-5678-1234-567812345678")
CAPTURED = 1_793_407_234  # 2026-10-31 00:40:34 UTC


def _webp(width: int = 4, height: int = 3) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), (40, 80, 120)).save(buffer, "WEBP")
    return buffer.getvalue()


WEBP = _webp()
PREVIEW = _webp(2, 2)


def _key(photo_id: UUID = PHOTO_ID) -> bytes:
    return _bfield(1, _bfield(2, _session_identity(photo_id)))


def _timestamp(seconds: int = CAPTURED, nanos: int | None = 500_000_000) -> bytes:
    return _vfield(1, seconds) + (_vfield(2, nanos) if nanos is not None else b"")


def _value(
    *,
    captured: bytes | None = None,
    image: bytes | None = WEBP,
    preview: bytes | None = PREVIEW,
) -> bytes:
    value = _bfield(1, _bfield(1, _timestamp()) if captured is None else captured)
    if image is not None:
        value += _bfield(2, _bfield(1, image))
    if preview is not None:
        value += _bfield(3, _bfield(1, preview))
    return value


def _snap(photo_id: UUID = PHOTO_ID, seconds: int = CAPTURED) -> HermesCollectionEntry:
    return HermesCollectionEntry(
        _key(photo_id), _value(captured=_bfield(1, _timestamp(seconds)))
    )


def test_decodes_a_photo_with_its_preview_and_capture_time() -> None:
    photo = decode_instamatic_snap(HermesCollectionEntry(_key(), _value()))

    assert photo.photo_id == str(PHOTO_ID)
    assert photo.captured_at == datetime(2026, 10, 31, 0, 40, 34, 500_000, UTC)
    assert photo.image == WEBP
    assert photo.preview == PREVIEW
    assert (photo.width, photo.height) == (4, 3)


def test_accepts_a_bare_timestamp_without_nanos_or_preview() -> None:
    photo = decode_instamatic_snap(
        HermesCollectionEntry(
            _key(), _value(captured=_timestamp(nanos=None), preview=None)
        )
    )

    assert photo.captured_at == datetime(2026, 10, 31, 0, 40, 34, tzinfo=UTC)
    assert photo.preview is None


@pytest.mark.parametrize(
    ("key", "value"),
    [
        (b"", _value()),
        (b"k" * 65, _value()),
        (_key(), b""),
        (_key(), b"x" * (snaps.MAX_ENTRY_BYTES + 1)),
        (_key(), _value(image=None)),
        (_key(), _value() + _bfield(3, _bfield(1, PREVIEW))),
        (_key(), _bfield(2, _bfield(1, WEBP))),
        (_key(), _value(captured=_timestamp(seconds=0))),
        (_key(), _value(captured=_timestamp(seconds=snaps.MAX_CAPTURE_SECONDS))),
        (_key(), _value(captured=_timestamp(nanos=1_000_000_000))),
        (_key(), _value(captured=_vfield(2, 1))),
        (_key(), _value(image=b"RIFF\0\0\0\0WEBPjunk")),
        (_key(), _value(image=b"\xff\xd8\xff\xe0 not webp")),
        (_key(), _value(preview=b"GIF89a")),
        (_key(), _value() + _bfield(2, _bfield(1, WEBP))),
    ],
)
def test_rejects_malformed_photos(key: bytes, value: bytes) -> None:
    with pytest.raises(DecodeError):
        decode_instamatic_snap(HermesCollectionEntry(key, value))


def test_rejects_oversized_and_oversized_pixel_images() -> None:
    entry = HermesCollectionEntry(_key(), _value())
    with (
        patch.object(snaps, "MAX_PHOTO_BYTES", len(WEBP) - 1),
        pytest.raises(DecodeError, match="too large"),
    ):
        decode_instamatic_snap(entry)
    with (
        patch.object(snaps, "MAX_PHOTO_PIXELS", 11),
        pytest.raises(DecodeError, match="dimensions"),
    ):
        decode_instamatic_snap(entry)


async def test_take_photo_button_sends_snap_and_reads_the_photo(hass) -> None:
    entry = _entities_entry()
    entry.async_create_background_task = MagicMock(
        side_effect=lambda _hass, coro, _name: coro.close()
    )
    take_photo = button.MaticTakePhotoButton(entry)
    take_photo.hass = SimpleNamespace(services=SimpleNamespace(async_call=AsyncMock()))

    assert take_photo.unique_id == "synthetic-serial_take_photo"
    with patch.object(
        button, "entry_vacuum_entity_id", return_value="vacuum.test_robot"
    ) as lookup:
        await take_photo.async_press()

    lookup.assert_called_once_with(take_photo.hass, "entry")
    send = entry.runtime_data.session.client.async_send_user_command
    send.assert_awaited_once_with(UserCommand.EMOTE_SNAP)
    entry.runtime_data.photos.async_expect_photo.assert_called_once_with("manual")
    entry.runtime_data.photos.async_refresh_after_snap.assert_called_once_with()
    entry.async_create_background_task.assert_called_once()

    with (
        patch.object(button, "entry_vacuum_entity_id", return_value=None),
        pytest.raises(HomeAssistantError),
    ):
        await take_photo.async_press()
    send.assert_awaited_once()
    take_photo.hass.services.async_call.assert_not_awaited()
