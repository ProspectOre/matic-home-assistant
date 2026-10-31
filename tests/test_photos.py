"""Robot camera photos: decoding, the photo store and its entities."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from google.protobuf.message import DecodeError
from homeassistant.exceptions import HomeAssistantError
from PIL import Image

from custom_components.matic_robot import button, photos
from custom_components.matic_robot import image as image_platform
from custom_components.matic_robot.client import snaps
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import HermesCollectionEntry
from custom_components.matic_robot.client.snaps import decode_instamatic_snap
from custom_components.matic_robot.photos import RobotPhotoStore
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


def _client(*, entries=(), stream=None, retired: bool = True) -> SimpleNamespace:
    return SimpleNamespace(
        async_get_tracked_collection_entries=AsyncMock(return_value=tuple(entries)),
        async_subscribe_collection_entries=stream or MagicMock(),
        retired=retired,
    )


async def test_refresh_keeps_only_the_newest_photo_and_counts_the_rest() -> None:
    older = _snap(UUID(int=1), CAPTURED - 60)
    newer = _snap(UUID(int=2), CAPTURED)
    bad = HermesCollectionEntry(_key(UUID(int=3)), b"\x00")
    client = _client(entries=(newer, older, bad))
    store = RobotPhotoStore(client)
    listener = MagicMock()
    remove = store.async_add_listener(listener)

    assert store.latest is None and store.photo_count == 0
    assert await store.async_refresh() is True
    client.async_get_tracked_collection_entries.assert_awaited_once_with(
        "instamatic_snaps", limit=photos.MAX_PHOTO_ENTRIES
    )
    assert store.latest is not None
    assert store.latest.photo_id == str(UUID(int=2))
    assert store.photo_count == 2
    listener.assert_called_once()

    # The same read again changes nothing.
    assert await store.async_refresh() is False
    listener.assert_called_once()

    # A photo deleted in the app drops out and the older one becomes newest.
    client.async_get_tracked_collection_entries.return_value = (older,)
    assert await store.async_refresh() is False
    assert store.latest.photo_id == str(UUID(int=1))
    assert store.photo_count == 1
    assert listener.call_count == 2

    client.async_get_tracked_collection_entries.return_value = ()
    assert await store.async_refresh() is False
    assert store.latest is None
    assert listener.call_count == 3

    remove()
    client.async_get_tracked_collection_entries.return_value = (newer,)
    assert await store.async_refresh() is True
    assert listener.call_count == 3


async def test_refresh_keeps_the_last_photo_when_the_robot_is_unreachable() -> None:
    client = _client(entries=(_snap(),))
    store = RobotPhotoStore(client)
    await store.async_refresh()
    client.async_get_tracked_collection_entries.side_effect = CannotConnectError(
        "offline"
    )

    assert await store.async_refresh() is False
    assert store.latest is not None


async def test_refresh_after_snap_reads_until_the_new_photo_lands() -> None:
    store = RobotPhotoStore(_client())
    store.async_refresh = AsyncMock(side_effect=[False, True])
    with patch.object(photos.asyncio, "sleep", AsyncMock()) as sleep:
        await store.async_refresh_after_snap()
    assert [call.args[0] for call in sleep.await_args_list] == list(
        photos.SNAP_READ_DELAYS_SECONDS
    )
    assert store.async_refresh.await_count == 2

    store.async_refresh = AsyncMock(return_value=True)
    with patch.object(photos.asyncio, "sleep", AsyncMock()) as sleep:
        await store.async_refresh_after_snap()
    assert sleep.await_count == 1
    store.async_refresh.assert_awaited_once()


def _stream(*batches):
    """Return a subscription factory that yields each batch, then fails."""
    calls = iter(batches)

    async def subscribe(name: str):
        assert name == "instamatic_snaps"
        batch = next(calls)
        if isinstance(batch, BaseException):
            raise batch
        for entry in batch:
            yield entry

    return subscribe


async def test_watch_reconciles_on_reconnect_and_follows_new_photos() -> None:
    first = _snap(UUID(int=1), CAPTURED - 120)
    deleted = _snap(UUID(int=2), CAPTURED - 60)
    second = _snap(UUID(int=3), CAPTURED)
    client = _client(
        stream=_stream((first, deleted), (first, second), CannotConnectError("drop")),
        retired=False,
    )
    client.async_get_tracked_collection_entries.side_effect = [
        (first, deleted),
        (first,),
        (first, second),
    ]
    store = RobotPhotoStore(client)
    seen: list[tuple[str | None, int]] = []
    store.async_add_listener(
        lambda: seen.append(
            (store.latest.photo_id if store.latest else None, store.photo_count)
        )
    )
    sleeps: list[float] = []

    async def sleep(delay: float) -> None:
        sleeps.append(delay)
        if len(sleeps) == 2:
            client.retired = True

    with patch.object(photos.asyncio, "sleep", sleep):
        await store.async_watch()

    # The full read on reconnect drops the photo deleted in the app before
    # the stream adds the new one; replayed photos change nothing.
    assert seen == [
        (str(UUID(int=2)), 2),
        (str(UUID(int=1)), 1),
        (str(UUID(int=3)), 2),
    ]
    assert sleeps == [1, 1]


async def test_watch_stops_on_cancel() -> None:
    client = _client(stream=_stream(asyncio.CancelledError()), retired=False)
    with pytest.raises(asyncio.CancelledError):
        await RobotPhotoStore(client).async_watch()


async def test_latest_photo_image_follows_the_store(hass) -> None:
    store = RobotPhotoStore(_client(entries=(_snap(),)))
    entry = _entities_entry()
    entry.runtime_data.photos = store
    added: list[object] = []
    await image_platform.async_setup_entry(hass, entry, added.extend)
    entity = added[0]
    entity.hass = hass
    entity.entity_id = "image.test_robot_latest_photo"
    entity.async_write_ha_state = MagicMock()

    assert entity.unique_id == "synthetic-serial_latest_photo"
    assert entity.content_type == "image/webp"
    assert entity.image_last_updated is None
    assert await entity.async_image() is None
    assert entity.extra_state_attributes == {"photo_count": 0}

    await entity.async_added_to_hass()
    await store.async_refresh()

    entity.async_write_ha_state.assert_called_once()
    assert entity.image_last_updated == datetime(2026, 10, 31, 0, 40, 34, 500_000, UTC)
    assert entity.state == "2026-10-31T00:40:34.500000+00:00"
    assert await entity.async_image() == WEBP
    assert entity.extra_state_attributes == {"photo_count": 1}


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
    take_photo.hass.services.async_call.assert_awaited_once_with(
        "vacuum",
        "send_command",
        {
            "entity_id": "vacuum.test_robot",
            "command": "emote",
            "params": {"kind": "snap"},
        },
        blocking=True,
    )
    entry.runtime_data.photos.async_refresh_after_snap.assert_called_once_with()
    entry.async_create_background_task.assert_called_once()

    with (
        patch.object(button, "entry_vacuum_entity_id", return_value=None),
        pytest.raises(HomeAssistantError),
    ):
        await take_photo.async_press()
    take_photo.hass.services.async_call.assert_awaited_once()


async def test_a_read_at_the_entry_limit_only_adds_photos() -> None:
    newest = _snap(UUID(int=99), CAPTURED)
    client = _client(entries=(newest,))
    store = RobotPhotoStore(client)
    await store.async_refresh()
    listener = MagicMock()
    store.async_add_listener(listener)
    older = tuple(
        _snap(UUID(int=index), CAPTURED - 60 - index)
        for index in range(photos.MAX_PHOTO_ENTRIES)
    )
    client.async_get_tracked_collection_entries.return_value = older

    # The newest photo fell outside this batch but is kept.
    assert await store.async_refresh() is False
    assert store.latest.photo_id == str(UUID(int=99))
    assert store.photo_count == photos.MAX_PHOTO_ENTRIES + 1
    listener.assert_called_once()

    assert await store.async_refresh() is False
    listener.assert_called_once()
