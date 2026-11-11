"""Base entity for Matic Hermes."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from homeassistant.core import callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import Entity
from homeassistant.util import slugify

from . import MaticConfigEntry
from .const import DOMAIN
from .stores import Store


def hostname_suffix(hostname: str) -> str:
    """Return the last four characters of a robot's bare host name."""
    return hostname.rstrip(".").removesuffix(".local")[-4:]


class MaticEntity(Entity):
    """Base Matic Hermes entity.

    It shows what the session's stores hold, writes its state when one it
    reads changes, and is unavailable while the robot cannot be reached.
    """

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry: MaticConfigEntry) -> None:
        self._config_entry = entry
        self.session = entry.runtime_data.session
        info = self.session.info
        device_info = DeviceInfo(
            identifiers={(DOMAIN, info.serial_number)},
            manufacturer="Matic",
            model="Robot",
            hw_version=str(info.hardware_revision),
            sw_version=(
                self.session.telemetry.value.software_version
                or self.session.state.value.operational.software_version
            ),
        )
        if info.name:
            device_info["name"] = info.name
        else:
            device_info["translation_key"] = "robot"
            device_info["translation_placeholders"] = {
                "suffix": hostname_suffix(info.hostname)
            }
        self._attr_device_info = device_info
        self._matic_serial = info.serial_number

    def _stores(self) -> Iterable[Store[Any]]:
        """Return the stores this entity shows; it is written when one changes."""
        return (self.session.state,)

    async def async_added_to_hass(self) -> None:
        """Follow the robot's reachability and the stores this entity shows."""
        await super().async_added_to_hass()
        stores = {id(store): store for store in (self.session.error, *self._stores())}
        for store in stores.values():
            self.async_on_remove(store.subscribe(self._handle_store_update))

    @callback
    def _handle_store_update(self) -> None:
        """Write the entity's state after a store it shows changed."""
        self.async_write_ha_state()

    async def async_update(self) -> None:
        """Read the robot again when Home Assistant asks for an update."""
        await self.session.heartbeat.async_request_refresh()

    @property
    def available(self) -> bool:
        """Return whether the robot can be reached."""
        return self.session.error.value is None

    @property
    def suggested_object_id(self) -> str | None:
        """Anchor object ids to stable keys instead of translated names.

        The registry prefixes the device name itself for named entities, so
        the returned id must stay unprefixed; the vacuum returns None so it
        becomes the bare device name.
        """
        unique_id = self.unique_id
        if unique_id is None:
            return None
        key = unique_id.removeprefix(f"{self._matic_serial}_")
        if key == "vacuum":
            return None
        return slugify(key)
