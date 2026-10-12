"""Device triggers for Matic robot room, plan and cleaning events."""

from __future__ import annotations

from typing import Any

import probatio
from homeassistant.components.device_automation import DEVICE_TRIGGER_BASE_SCHEMA
from homeassistant.components.device_automation.exceptions import (
    InvalidDeviceAutomationConfig,
)
from homeassistant.components.homeassistant.triggers import event as event_trigger
from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.const import (
    ATTR_DEVICE_ID,
    ATTR_ENTITY_ID,
    CONF_DEVICE_ID,
    CONF_DOMAIN,
    CONF_EVENT_DATA,
    CONF_PLATFORM,
    CONF_TYPE,
)
from homeassistant.core import CALLBACK_TYPE, HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.trigger import TriggerActionType, TriggerInfo
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN

ROOM_COMPLETED = "room_completed"
PLAN_FINISHED = "plan_finished"
CLEANING_FINISHED = "cleaning_finished"
# Room and plan events name the robot's vacuum entity; the robot's own
# cleaning-run event names its device.
ENTITY_TRIGGER_TYPES = (ROOM_COMPLETED, PLAN_FINISHED)
TRIGGER_TYPES = (*ENTITY_TRIGGER_TYPES, CLEANING_FINISHED)

TRIGGER_SCHEMA = DEVICE_TRIGGER_BASE_SCHEMA.extend(
    {probatio.Required(CONF_TYPE): probatio.In(TRIGGER_TYPES)}
)


def _vacuum_entity_id(hass: HomeAssistant, device_id: str) -> str | None:
    """Return the robot's vacuum entity on one device, if it has one."""
    return next(
        (
            entry.entity_id
            for entry in er.async_entries_for_device(er.async_get(hass), device_id)
            if entry.platform == DOMAIN and entry.domain == VACUUM_DOMAIN
        ),
        None,
    )


async def async_get_triggers(
    hass: HomeAssistant, device_id: str
) -> list[dict[str, Any]]:
    """List the triggers a Matic robot device offers."""
    types = (
        TRIGGER_TYPES
        if _vacuum_entity_id(hass, device_id) is not None
        else (CLEANING_FINISHED,)
    )
    return [
        {
            CONF_PLATFORM: "device",
            CONF_DOMAIN: DOMAIN,
            CONF_DEVICE_ID: device_id,
            CONF_TYPE: trigger_type,
        }
        for trigger_type in types
    ]


async def async_attach_trigger(
    hass: HomeAssistant,
    config: ConfigType,
    action: TriggerActionType,
    trigger_info: TriggerInfo,
) -> CALLBACK_TYPE:
    """Listen for the robot event that matches one device trigger."""
    trigger_type = config[CONF_TYPE]
    device_id = config[CONF_DEVICE_ID]
    if trigger_type in ENTITY_TRIGGER_TYPES:
        entity_id = _vacuum_entity_id(hass, device_id)
        if entity_id is None:
            raise InvalidDeviceAutomationConfig(
                f"Device {device_id} has no Matic robot vacuum entity"
            )
        event_data = {ATTR_ENTITY_ID: entity_id}
    else:
        event_data = {ATTR_DEVICE_ID: device_id}
    event_config = event_trigger.TRIGGER_SCHEMA(
        {
            CONF_PLATFORM: "event",
            event_trigger.CONF_EVENT_TYPE: f"{DOMAIN}_{trigger_type}",
            CONF_EVENT_DATA: event_data,
        }
    )
    return await event_trigger.async_attach_trigger(
        hass, event_config, action, trigger_info, platform_type="device"
    )
