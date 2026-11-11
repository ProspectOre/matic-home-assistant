"""Repairs notices for the entities and actions that 0.6 removes.

0.5.4 warns and 0.6 deletes, so this module goes away with them.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Coroutine, Iterator
from functools import wraps
from typing import Any

from homeassistant.components.automation import automations_with_entity
from homeassistant.components.automation.helpers import async_get_blueprints
from homeassistant.components.script import scripts_with_entity
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir

from .const import CONF_SERIAL_NUMBER, DOMAIN

RELEASE_NOTES_URL = (
    "https://github.com/ProspectOre/matic-home-assistant/"
    "blob/main/docs/release-notes-0.5.4.md#removed-in-06"
)
BLUEPRINT_ISSUE_ID = "removed_action_blueprints"

# Retired action -> Repairs notice.
_ACTION_NOTICES = {
    "intelligent_clean": "removed_plan_run_action",
    "clean_entire_plan": "removed_plan_run_action",
    "select_plan": "removed_select_plan_action",
    "save_plan_room": "removed_plan_room_action",
    "delete_plan_room": "removed_plan_room_action",
    "move_plan_room": "removed_plan_room_action",
}
# Retired plan-run action -> the Run plan cleaning order that matches it.
_RUN_BEHAVIOR = {"intelligent_clean": "intelligent", "clean_entire_plan": "ordered"}
# (domain, unique ID after the serial number) of a retired entity -> Repairs notice.
_ENTITY_NOTICES = {
    ("binary_sensor", "paused"): "removed_entity_state",
    ("binary_sensor", "returning"): "removed_entity_state",
    ("sensor", "activity"): "removed_entity_state",
    ("binary_sensor", "fully_charged"): "removed_entity_fully_charged",
    ("sensor", "rooms"): "removed_entity_rooms",
    ("sensor", "update_state"): "removed_entity_update",
    ("sensor", "update_channel"): "removed_entity_update",
    ("sensor", "scheduled_cleanings"): "removed_entity_scheduled_cleanings",
    ("sensor", "protocol_version"): "removed_entity_diagnostics",
    ("sensor", "dock_detections"): "removed_entity_diagnostics",
    ("sensor", "sink_summon_locations"): "removed_entity_diagnostics",
    ("button", "intelligent_clean"): "removed_entity_plan_button",
    ("button", "clean_entire_plan"): "removed_entity_plan_button",
    ("button", "stop_intelligent_cleaning"): "removed_entity_stop_button",
}

# Every released Matic blueprint started its plan with this action, passing
# `data` either as a mapping or as one template expression.
_BLUEPRINT_SOURCE = "prospectore/matic-home-assistant/"
_BLUEPRINT_ACTION = f"{DOMAIN}.intelligent_clean"
_EXPRESSION = re.compile(r"\{\{((?:(?!\{\{|\}\}).)+)\}\}", re.DOTALL)


def warn_of_removal[Result](
    hass: HomeAssistant,
    handler: Callable[[ServiceCall], Coroutine[Any, Any, Result]],
) -> Callable[[ServiceCall], Coroutine[Any, Any, Result]]:
    """Raise a Repairs notice each time a retired action runs."""

    @wraps(handler)
    async def async_warned(call: ServiceCall) -> Result:
        placeholders = {"action": f"{DOMAIN}.{call.service}"}
        if run_behavior := _RUN_BEHAVIOR.get(call.service):
            placeholders["run_behavior"] = run_behavior
        ir.async_create_issue(
            hass,
            DOMAIN,
            f"removed_action_{call.service}",
            is_fixable=False,
            learn_more_url=RELEASE_NOTES_URL,
            severity=ir.IssueSeverity.WARNING,
            translation_key=_ACTION_NOTICES[call.service],
            translation_placeholders=placeholders,
        )
        return await handler(call)

    return async_warned


async def async_warn_of_removals(hass: HomeAssistant) -> None:
    """Raise a notice for each retired entity and blueprint still in use."""
    registry = er.async_get(hass)
    for entry in hass.config_entries.async_entries(DOMAIN, include_ignore=False):
        serial_prefix = f"{entry.data[CONF_SERIAL_NUMBER]}_"
        for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
            notice = _ENTITY_NOTICES.get(
                (entity.domain, entity.unique_id.removeprefix(serial_prefix))
            )
            if (
                notice is None
                or entity.disabled
                or not (items := _users(hass, registry, entity.entity_id))
            ):
                continue
            ir.async_create_issue(
                hass,
                DOMAIN,
                f"removed_entity_{entity.entity_id}",
                is_fixable=False,
                learn_more_url=RELEASE_NOTES_URL,
                severity=ir.IssueSeverity.WARNING,
                translation_key=notice,
                translation_placeholders={
                    "entity_id": entity.entity_id,
                    "items": items,
                },
            )
    if blueprints := await async_update_blueprints(hass, save=False):
        ir.async_create_issue(
            hass,
            DOMAIN,
            BLUEPRINT_ISSUE_ID,
            is_fixable=True,
            learn_more_url=RELEASE_NOTES_URL,
            severity=ir.IssueSeverity.WARNING,
            translation_key="blueprints_use_removed_action",
            translation_placeholders={"blueprints": ", ".join(blueprints)},
        )


@callback
def _users(hass: HomeAssistant, registry: er.EntityRegistry, entity_id: str) -> str:
    """List the automations and scripts that use an entity, as edit links."""
    return "\n".join(
        f"- [{user.name or user.original_name or user_id}]"
        f"(/config/{user.domain}/edit/{user.unique_id})"
        if (user := registry.async_get(user_id))
        else f"- `{user_id}`"
        for user_id in (
            *automations_with_entity(hass, entity_id),
            *scripts_with_entity(hass, entity_id),
        )
    )


async def async_update_blueprints(hass: HomeAssistant, *, save: bool) -> list[str]:
    """Name the imported Matic blueprints that call a retired action.

    With `save`, also switch each one to Run plan with the same cleaning order,
    rewrite its file and reload the automations made from it.
    """
    blueprints = async_get_blueprints(hass)
    names = []
    for path, blueprint in sorted((await blueprints.async_get_blueprints()).items()):
        if (
            blueprint is None
            or isinstance(blueprint, Exception)
            or _BLUEPRINT_SOURCE
            not in str(blueprint.metadata.get("source_url")).lower()
            or not (calls := list(_retired_calls(blueprint.data)))
        ):
            continue
        names.append(blueprint.name)
        if save:
            for call in calls:
                call["action"] = f"{DOMAIN}.run_selected_plan"
                call["data"] = _with_smart_order(call.get("data", {}))
            await blueprints.async_add_blueprint(blueprint, path, allow_override=True)
    if save:
        # Anything else that still calls the action raises its notice again.
        ir.async_delete_issue(hass, DOMAIN, "removed_action_intelligent_clean")
    return names


def _retired_calls(node: Any) -> Iterator[dict[str, Any]]:
    """Yield each blueprint step that this module can switch to Run plan."""
    if isinstance(node, dict):
        if node.get("action") == _BLUEPRINT_ACTION:
            if _with_smart_order(node.get("data", {})) is not None:
                yield node
        else:
            for child in node.values():
                yield from _retired_calls(child)
    elif isinstance(node, list):
        for child in node:
            yield from _retired_calls(child)


def _with_smart_order(data: Any) -> Any:
    """Add the Smart Order choice to action data, or return None if unsure how."""
    if isinstance(data, dict):
        return {**data, "run_behavior": "intelligent"}
    if isinstance(data, str) and (match := _EXPRESSION.fullmatch(data.strip())):
        return f"{{{{ dict({match[1].strip()}, run_behavior='intelligent') }}}}"
    return None
