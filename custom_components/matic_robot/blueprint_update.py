"""Repair for imported Matic blueprints that call an action 0.6 removed."""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any

from homeassistant.components.automation.helpers import async_get_blueprints
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from .const import DOMAIN

RELEASE_NOTES_URL = (
    "https://github.com/ProspectOre/matic-home-assistant/"
    "blob/main/docs/release-notes-0.5.4.md#removed-in-06"
)
BLUEPRINT_ISSUE_ID = "removed_action_blueprints"

# Every Matic blueprint released before 0.5.4 started its plan with this
# action, passing `data` either as a mapping or as one template expression.
_BLUEPRINT_SOURCE = "prospectore/matic-home-assistant/"
_BLUEPRINT_ACTION = f"{DOMAIN}.intelligent_clean"
_EXPRESSION = re.compile(r"\{\{((?:(?!\{\{|\}\}).)+)\}\}", re.DOTALL)


async def async_check_blueprints(hass: HomeAssistant) -> None:
    """Raise the Repair when an imported Matic blueprint calls the removed action."""
    if blueprints := await async_update_blueprints(hass, save=False):
        ir.async_create_issue(
            hass,
            DOMAIN,
            BLUEPRINT_ISSUE_ID,
            is_fixable=True,
            learn_more_url=RELEASE_NOTES_URL,
            severity=ir.IssueSeverity.ERROR,
            translation_key="blueprints_use_removed_action",
            translation_placeholders={"blueprints": ", ".join(blueprints)},
        )


async def async_update_blueprints(hass: HomeAssistant, *, save: bool) -> list[str]:
    """Name the imported Matic blueprints that call the removed action.

    With `save`, also switch each one to Run plan in Smart Order, rewrite its
    file and reload the automations made from it.
    """
    blueprints = async_get_blueprints(hass)
    names = []
    for path, blueprint in sorted((await blueprints.async_get_blueprints()).items()):
        if (
            blueprint is None
            or isinstance(blueprint, Exception)
            or _BLUEPRINT_SOURCE
            not in str(blueprint.metadata.get("source_url")).lower()
            or not (calls := list(_removed_calls(blueprint.data)))
        ):
            continue
        names.append(blueprint.name)
        if save:
            for call in calls:
                call["action"] = f"{DOMAIN}.run_selected_plan"
                call["data"] = _with_smart_order(call.get("data", {}))
            await blueprints.async_add_blueprint(blueprint, path, allow_override=True)
    return names


def _removed_calls(node: Any) -> Iterator[dict[str, Any]]:
    """Yield each blueprint step that can be switched to Run plan."""
    if isinstance(node, dict):
        if node.get("action") == _BLUEPRINT_ACTION:
            if _with_smart_order(node.get("data", {})) is not None:
                yield node
        else:
            for child in node.values():
                yield from _removed_calls(child)
    elif isinstance(node, list):
        for child in node:
            yield from _removed_calls(child)


def _with_smart_order(data: Any) -> Any:
    """Add the Smart Order choice to action data, or return None if unsure how."""
    if isinstance(data, dict):
        return {**data, "run_behavior": "intelligent"}
    if isinstance(data, str) and (match := _EXPRESSION.fullmatch(data.strip())):
        return f"{{{{ dict({match[1].strip()}, run_behavior='intelligent') }}}}"
    return None
