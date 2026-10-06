"""Native Home Assistant maintenance options for Matic."""

from __future__ import annotations

from typing import Any, cast

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers import selector

from .const import CONF_LIVE_WORKSPACE_TRANSPORT
from .plans import CleaningPlanManager, MetadataAdmissionClosedError


class MaticRobotOptionsFlow(config_entries.OptionsFlow):
    """Expose only integration settings that are not owned by Map Studio."""

    def __init__(self) -> None:
        self._reset_plan_id: str | None = None

    @property
    def _serial_number(self) -> str:
        return str(self.config_entry.runtime_data.coordinator.data.info.serial_number)

    @property
    def _manager(self) -> CleaningPlanManager:
        return cast(CleaningPlanManager, self.config_entry.runtime_data.cleaning_plans)

    def _is_loaded(self) -> bool:
        return self.config_entry.state is config_entries.ConfigEntryState.LOADED

    def _entry_unavailable(self) -> config_entries.ConfigFlowResult:
        return self.async_abort(reason="entry_not_loaded")

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Direct plan and Area editing to the sole map workspace."""
        if not self._is_loaded():
            return self._entry_unavailable()
        options: list[str] = []
        plans = self._manager.plans(self._serial_number)
        if plans:
            options.extend(("default_plan", "reset_history"))
        options.append("workspace_transport")
        options.append("finish")
        return self.async_show_menu(
            step_id="init",
            menu_options=options,
            description_placeholders={"plan_count": str(len(plans))},
        )

    async def async_step_finish(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Close native settings without changing saved preferences."""
        if not self._is_loaded():
            return self._entry_unavailable()
        return self.async_create_entry(title="", data=dict(self.config_entry.options))

    async def async_step_default_plan(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Select an existing saved plan as the durable default."""
        if not self._is_loaded():
            return self._entry_unavailable()
        plans = self._manager.plans(self._serial_number)
        if not plans:
            return await self.async_step_init()
        errors: dict[str, str] = {}
        if user_input is not None:
            plan_id = user_input.get("plan")
            if not isinstance(plan_id, str) or plan_id not in plans:
                errors["base"] = "plan_unavailable"
            else:
                try:
                    await self._manager.async_select_plan(self._serial_number, plan_id)
                except MetadataAdmissionClosedError:
                    return self._entry_unavailable()
                except KeyError:
                    # The manager rechecks the ID after admission. If another
                    # client removed it, offer only the manager's fresh choices.
                    if not self._is_loaded():
                        return self._entry_unavailable()
                    errors["base"] = "plan_unavailable"
                else:
                    if not self._is_loaded():
                        return self._entry_unavailable()
                    return self.async_create_entry(
                        title="", data=dict(self.config_entry.options)
                    )
        plans = self._manager.plans(self._serial_number)
        if not plans:
            return await self.async_step_init()
        selected = self._manager.snapshot(self._serial_number).get("selected_plan")
        return self.async_show_form(
            step_id="default_plan",
            data_schema=self._plan_selection_schema(plans, selected),
            errors=errors,
        )

    async def async_step_reset_history(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Choose the named plan whose cleaning history will be reset."""
        if not self._is_loaded():
            return self._entry_unavailable()
        plans = self._manager.plans(self._serial_number)
        if not plans:
            return await self.async_step_init()
        errors: dict[str, str] = {}
        if user_input is not None:
            plan_id = user_input.get("plan")
            if not isinstance(plan_id, str) or plan_id not in plans:
                errors["base"] = "plan_unavailable"
            else:
                self._reset_plan_id = plan_id
                return await self.async_step_confirm_reset_history()
        return self._show_reset_plan_form(plans, errors=errors)

    def _plan_selection_schema(
        self, plans: dict[str, Any], selected: Any
    ) -> vol.Schema:
        """Build a current plan chooser after re-reading manager state."""
        default = (
            selected
            if isinstance(selected, str) and selected in plans
            else next(iter(plans))
        )
        return vol.Schema(
            {
                vol.Required("plan", default=default): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=[
                            selector.SelectOptionDict(
                                value=plan_id,
                                label=str(plan.get("name", plan_id)),
                            )
                            for plan_id, plan in plans.items()
                        ],
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    )
                )
            }
        )

    def _show_reset_plan_form(
        self,
        plans: dict[str, Any],
        *,
        errors: dict[str, str] | None = None,
    ) -> config_entries.ConfigFlowResult:
        """Return to the reset chooser using fresh manager options."""
        selected = self._manager.snapshot(self._serial_number).get("selected_plan")
        return self.async_show_form(
            step_id="reset_history",
            data_schema=self._plan_selection_schema(plans, selected),
            errors=errors or {},
        )

    async def async_step_confirm_reset_history(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Require a named confirmation before resetting rotation history."""
        if not self._is_loaded():
            return self._entry_unavailable()
        plans = self._manager.plans(self._serial_number)
        if self._reset_plan_id not in plans:
            self._reset_plan_id = None
            return await self.async_step_init()
        plan_id = self._reset_plan_id
        plan_name = str(plans[plan_id].get("name", plan_id))
        if user_input is not None:
            all_plans = user_input.get("all_plans")
            if type(all_plans) is not bool:
                return self.async_show_form(
                    step_id="confirm_reset_history",
                    data_schema=self._reset_history_schema(),
                    errors={"base": "invalid_reset_scope"},
                    description_placeholders={"plan_name": plan_name},
                )
            try:
                await self._manager.async_reset_history(
                    self._serial_number, None if all_plans else plan_id
                )
            except MetadataAdmissionClosedError:
                return self._entry_unavailable()
            except KeyError:
                if not self._is_loaded():
                    return self._entry_unavailable()
                self._reset_plan_id = None
                current_plans = self._manager.plans(self._serial_number)
                if not current_plans:
                    return await self.async_step_init()
                return self._show_reset_plan_form(
                    current_plans, errors={"base": "plan_unavailable"}
                )
            if not self._is_loaded():
                return self._entry_unavailable()
            self._reset_plan_id = None
            return self.async_create_entry(
                title="", data=dict(self.config_entry.options)
            )
        return self.async_show_form(
            step_id="confirm_reset_history",
            data_schema=self._reset_history_schema(),
            description_placeholders={"plan_name": plan_name},
        )

    @staticmethod
    def _reset_history_schema() -> vol.Schema:
        return vol.Schema(
            {vol.Required("all_plans", default=False): selector.BooleanSelector()}
        )

    async def async_step_workspace_transport(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Configure reversible live updates for the administrator workspace."""
        if not self._is_loaded():
            return self._entry_unavailable()
        errors: dict[str, str] = {}
        if user_input is not None:
            enabled = user_input.get(CONF_LIVE_WORKSPACE_TRANSPORT)
            if type(enabled) is not bool:
                errors["base"] = "invalid_workspace_transport"
            else:
                options = dict(self.config_entry.options)
                options[CONF_LIVE_WORKSPACE_TRANSPORT] = enabled
                return self.async_create_entry(title="", data=options)

        return self.async_show_form(
            step_id="workspace_transport",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_LIVE_WORKSPACE_TRANSPORT,
                        default=(
                            self.config_entry.options.get(CONF_LIVE_WORKSPACE_TRANSPORT)
                            is True
                        ),
                    ): selector.BooleanSelector()
                }
            ),
            errors=errors,
        )
