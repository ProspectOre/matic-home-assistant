"""The newest photo from the robot's camera."""

from __future__ import annotations

from homeassistant.components.image import ImageEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import MaticConfigEntry
from .entity import MaticEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the latest robot photo."""
    async_add_entities([MaticLatestPhotoImage(hass, entry)])


class MaticLatestPhotoImage(MaticEntity, ImageEntity):
    """Show the newest photo the robot took.

    The state is the capture time, so a new photo is a state change that
    automations can trigger on.
    """

    _attr_translation_key = "latest_photo"
    _attr_content_type = "image/webp"
    _unrecorded_attributes = frozenset({"photo_count"})

    def __init__(self, hass: HomeAssistant, entry: MaticConfigEntry) -> None:
        MaticEntity.__init__(self, entry)
        ImageEntity.__init__(self, hass)
        self._photos = entry.runtime_data.photos
        self._attr_unique_id = (
            f"{self.coordinator.data.info.serial_number}_latest_photo"
        )
        self._sync_photo()

    async def async_added_to_hass(self) -> None:
        """Follow new photos."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self._photos.async_add_listener(self._async_photos_updated)
        )

    @property
    def extra_state_attributes(self) -> dict[str, int]:
        """Return how many photos the robot holds."""
        return {"photo_count": self._photos.photo_count}

    async def async_image(self) -> bytes | None:
        """Return the newest photo as WebP."""
        photo = self._photos.latest
        return photo.image if photo is not None else None

    @callback
    def _async_photos_updated(self) -> None:
        self._sync_photo()
        self.async_write_ha_state()

    def _sync_photo(self) -> None:
        photo = self._photos.latest
        self._attr_image_last_updated = photo.captured_at if photo is not None else None
