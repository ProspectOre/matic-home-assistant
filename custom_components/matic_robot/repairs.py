"""Repairs for the Matic Robot integration."""

from __future__ import annotations

from typing import Any

from homeassistant import config_entries
from homeassistant.components.repairs import (
    ConfirmRepairFlow,
    RepairsFlow,
    RepairsFlowResult,
)
from homeassistant.components.repairs.const import FlowType
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from .blueprint_update import BLUEPRINT_ISSUE_ID, async_update_blueprints
from .const import DOMAIN
from .plan_room_repairs import PlanRoomRepairFlow, plan_room_issue_id
from .repair_placeholders import repair_placeholders


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


class BlueprintRepairFlow(ConfirmRepairFlow):
    """Switch imported Matic blueprints off the action that 0.6 removed."""

    async def async_step_confirm(
        self, user_input: dict[str, str] | None = None
    ) -> RepairsFlowResult:
        """Name the blueprints, then rewrite them once the user confirms."""
        if user_input is not None:
            await async_update_blueprints(self.hass, save=True)
        return await super().async_step_confirm(user_input)


async def async_create_fix_flow(
    hass: HomeAssistant,
    issue_id: str,
    data: dict[str, str | int | float | None] | None,
) -> RepairsFlow:
    """Create the fix flow for a fixable Matic Repair."""
    del hass
    if issue_id == BLUEPRINT_ISSUE_ID:
        return BlueprintRepairFlow()
    assert data is not None
    if issue_id == plan_room_issue_id(str(data["entry_id"])):
        return PlanRoomRepairFlow(str(data["entry_id"]))
    return RobotIdentityRepairFlow(str(data["entry_id"]))
