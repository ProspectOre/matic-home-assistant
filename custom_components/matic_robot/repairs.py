"""Repairs for the Matic Robot integration."""

from __future__ import annotations

from typing import Any

from homeassistant import config_entries
from homeassistant.components.repairs import RepairsFlow, RepairsFlowResult
from homeassistant.components.repairs.const import FlowType
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResultType
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


class RobotIdentityRepairFlow(RepairsFlow):
    """Explain identity recovery, then hand off to Reconfigure > Robot was reset."""

    def __init__(self, entry_id: str) -> None:
        self._entry_id = entry_id

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> RepairsFlowResult:
        """Confirm the fresh pairing, then open recovery in the entry's flow."""
        if user_input is None:
            return self.async_show_form(
                step_id="init",
                description_placeholders=repair_placeholders(self.hass, self._entry_id),
            )
        result = await self.hass.config_entries.flow.async_init(
            DOMAIN,
            context={
                "source": config_entries.SOURCE_RECONFIGURE,
                "entry_id": self._entry_id,
            },
            data={"recover_identity": True},
        )
        if result["type"] is not FlowResultType.FORM:
            # Recovery did not open (for example another dialog for this robot
            # is running); the abort text still names the manual path.
            return self.async_abort(reason="continue_in_reconfigure")
        return self.async_abort(
            reason="continue_in_reconfigure",
            next_flow=(FlowType.CONFIG_FLOW, result["flow_id"]),
        )


async def async_create_fix_flow(
    hass: HomeAssistant,
    issue_id: str,
    data: dict[str, str | int | float | None] | None,
) -> RepairsFlow:
    """Create the fix flow for a fixable Matic Repair."""
    del hass, issue_id
    assert data is not None
    return RobotIdentityRepairFlow(str(data["entry_id"]))
