"""Initialize and register Matic Home Assistant actions."""

from __future__ import annotations

from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import HomeAssistant, callback

from .const import DATA_FIRMWARE_TRACKER, DOMAIN
from .firmware import FirmwareTracker
from .plans import CleaningPlanManager, async_get_plan_manager
from .service_context import ServiceRuntime
from .service_controls import register_controls_services
from .service_editing import register_editing_services
from .service_execution import register_execution_services
from .service_firmware import register_firmware_services


async def async_register_services(hass: HomeAssistant) -> None:
    """Initialize shared action dependencies and register each domain."""
    manager = await async_get_plan_manager(hass, manager_factory=CleaningPlanManager)
    firmware_tracker = FirmwareTracker(hass)
    await firmware_tracker.async_load()
    hass.data[DOMAIN][DATA_FIRMWARE_TRACKER] = firmware_tracker
    if hass.is_running:
        firmware_tracker.replay_reports()
    else:

        @callback
        def _async_replay_firmware_reports(_event: object) -> None:
            firmware_tracker.replay_reports()

        hass.bus.async_listen_once(
            EVENT_HOMEASSISTANT_STARTED, _async_replay_firmware_reports
        )
    runtime = ServiceRuntime(hass, manager, firmware_tracker)
    register_firmware_services(runtime)
    register_controls_services(runtime)
    register_execution_services(runtime)
    register_editing_services(runtime)
