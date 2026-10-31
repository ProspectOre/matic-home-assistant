"""Native Home Assistant maintenance options for Matic."""

from __future__ import annotations

from typing import Any, cast

import probatio
from homeassistant import config_entries
from homeassistant.helpers import selector

from .const import (
    CONF_PHOTO_PATROL_ALLOW_UNATTENDED,
    CONF_PHOTO_PATROL_COOLDOWN_SECONDS,
    CONF_PHOTO_PATROL_NO_PHOTO_ROOMS,
)
from .plan_repository import MetadataAdmissionClosedError
from .plans import CleaningPlanManager


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

    def _done(
        self, reason: str, *, plan_name: str | None = None
    ) -> config_entries.ConfigFlowResult:
        """End with a message naming what changed.

        Home Assistant shows no step text for an options flow's create entry, so
        completed changes end in a translated abort, like reconfigure_successful.
        """
        return self.async_abort(
            reason=reason,
            description_placeholders=(
                None if plan_name is None else {"plan_name": plan_name}
            ),
        )

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Direct plan and Area editing to the sole map workspace."""
        if not self._is_loaded():
            return self._entry_unavailable()
        options: list[str] = []
        plans = self._manager.catalog.plans(self._serial_number)
        if plans:
            options.extend(
                ("default_plan", "reset_history", "confirm_reset_all_history")
            )
        options.extend(("photo_patrol_settings", "finish"))
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

    async def async_step_photo_patrol_settings(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Set photo-patrol permission, blocked rooms and cooldown."""
        if not self._is_loaded():
            return self._entry_unavailable()
        options = dict(self.config_entry.options)
        floor_plan = self.config_entry.runtime_data.coordinator.data.floor_plan
        current_rooms = (
            {room.id: room.name for room in floor_plan.rooms}
            if floor_plan is not None
            else {}
        )
        if user_input is not None:
            blocked = user_input.get(CONF_PHOTO_PATROL_NO_PHOTO_ROOMS, [])
            if not isinstance(blocked, list) or not set(blocked) <= set(current_rooms):
                return self.async_abort(reason="photo_patrol_rooms_unavailable")
            options[CONF_PHOTO_PATROL_ALLOW_UNATTENDED] = bool(
                user_input.get(CONF_PHOTO_PATROL_ALLOW_UNATTENDED, False)
            )
            options[CONF_PHOTO_PATROL_NO_PHOTO_ROOMS] = blocked
            options[CONF_PHOTO_PATROL_COOLDOWN_SECONDS] = int(
                user_input.get(CONF_PHOTO_PATROL_COOLDOWN_SECONDS, 900)
            )
            if not self._is_loaded():
                return self._entry_unavailable()
            return self.async_create_entry(title="", data=options)

        default_rooms = list(options.get(CONF_PHOTO_PATROL_NO_PHOTO_ROOMS, ()))
        room_options = [
            selector.SelectOptionDict(value=room_id, label=name)
            for room_id, name in sorted(current_rooms.items())
        ]
        room_options.extend(
            selector.SelectOptionDict(
                value=room_id, label=f"Unavailable on current map: {room_id}"
            )
            for room_id in sorted(set(default_rooms) - set(current_rooms))
        )
        return self.async_show_form(
            step_id="photo_patrol_settings",
            data_schema=probatio.Schema(
                {
                    probatio.Required(
                        CONF_PHOTO_PATROL_ALLOW_UNATTENDED,
                        default=bool(
                            options.get(CONF_PHOTO_PATROL_ALLOW_UNATTENDED, False)
                        ),
                    ): selector.BooleanSelector(),
                    probatio.Required(
                        CONF_PHOTO_PATROL_NO_PHOTO_ROOMS, default=default_rooms
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=room_options,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                            multiple=True,
                        )
                    ),
                    probatio.Required(
                        CONF_PHOTO_PATROL_COOLDOWN_SECONDS,
                        default=int(
                            options.get(CONF_PHOTO_PATROL_COOLDOWN_SECONDS, 900)
                        ),
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=0,
                            max=86400,
                            step=60,
                            mode=selector.NumberSelectorMode.SLIDER,
                            unit_of_measurement="s",
                        )
                    ),
                }
            ),
        )

    async def async_step_default_plan(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Select an existing saved plan as the durable default."""
        if not self._is_loaded():
            return self._entry_unavailable()
        plans = self._manager.catalog.plans(self._serial_number)
        if not plans:
            return await self.async_step_init()
        errors: dict[str, str] = {}
        if user_input is not None:
            plan_id = user_input.get("plan")
            if not isinstance(plan_id, str) or plan_id not in plans:
                errors["base"] = "plan_unavailable"
            else:
                try:
                    await self._manager.catalog.async_select_plan(
                        self._serial_number, plan_id
                    )
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
                    return self._done(
                        "default_plan_set",
                        plan_name=str(plans[plan_id].get("name", plan_id)),
                    )
        plans = self._manager.catalog.plans(self._serial_number)
        if not plans:
            return await self.async_step_init()
        selected = self._manager.ledger.snapshot(self._serial_number).get(
            "selected_plan"
        )
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
        plans = self._manager.catalog.plans(self._serial_number)
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
    ) -> probatio.Schema:
        """Build a current plan chooser after re-reading manager state."""
        default = (
            selected
            if isinstance(selected, str) and selected in plans
            else next(iter(plans))
        )
        return probatio.Schema(
            {
                probatio.Required("plan", default=default): selector.SelectSelector(
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
        selected = self._manager.ledger.snapshot(self._serial_number).get(
            "selected_plan"
        )
        return self.async_show_form(
            step_id="reset_history",
            data_schema=self._plan_selection_schema(plans, selected),
            errors=errors or {},
        )

    async def async_step_confirm_reset_history(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Ask by name before resetting one plan's room cleaning history."""
        if not self._is_loaded():
            return self._entry_unavailable()
        plans = self._manager.catalog.plans(self._serial_number)
        if self._reset_plan_id not in plans:
            self._reset_plan_id = None
            return await self.async_step_init()
        plan_id = self._reset_plan_id
        plan_name = str(plans[plan_id].get("name", plan_id))
        if user_input is None:
            return self.async_show_form(
                step_id="confirm_reset_history",
                description_placeholders={"plan_name": plan_name},
            )
        try:
            await self._manager.ledger.async_reset_history(self._serial_number, plan_id)
        except MetadataAdmissionClosedError:
            return self._entry_unavailable()
        except KeyError:
            if not self._is_loaded():
                return self._entry_unavailable()
            self._reset_plan_id = None
            current_plans = self._manager.catalog.plans(self._serial_number)
            if not current_plans:
                return await self.async_step_init()
            return self._show_reset_plan_form(
                current_plans, errors={"base": "plan_unavailable"}
            )
        if not self._is_loaded():
            return self._entry_unavailable()
        self._reset_plan_id = None
        return self._done("history_reset", plan_name=plan_name)

    async def async_step_confirm_reset_all_history(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Ask once before resetting room cleaning history for every plan."""
        if not self._is_loaded():
            return self._entry_unavailable()
        if not self._manager.catalog.plans(self._serial_number):
            return await self.async_step_init()
        if user_input is None:
            return self.async_show_form(step_id="confirm_reset_all_history")
        try:
            await self._manager.ledger.async_reset_history(self._serial_number)
        except MetadataAdmissionClosedError:
            return self._entry_unavailable()
        if not self._is_loaded():
            return self._entry_unavailable()
        return self._done("all_history_reset")
