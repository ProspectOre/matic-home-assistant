"""Name the robot and link its device page in a Repair's text."""

from __future__ import annotations

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr

from .const import DOMAIN

FALLBACK_ROBOT_NAME = "Matic (Unofficial)"


@callback
def repair_placeholders(hass: HomeAssistant, entry_id: str) -> dict[str, str]:
    """Name the robot and link its device page in a Repair."""
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), entry_id)
    if devices:
        device = devices[0]
        return {
            "name": device.name_by_user or device.name or FALLBACK_ROBOT_NAME,
            "device_url": f"/config/devices/device/{device.id}",
        }
    entry = hass.config_entries.async_get_entry(entry_id)
    return {
        "name": entry.title if entry is not None else FALLBACK_ROBOT_NAME,
        "device_url": f"/config/integrations/integration/{DOMAIN}",
    }
