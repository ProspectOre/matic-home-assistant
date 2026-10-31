"""Shared authorization and robot resolution for Matic LLM tools."""

from __future__ import annotations

from abc import abstractmethod
from typing import Any, override

import probatio
from homeassistant.components.homeassistant.exposed_entities import async_should_expose
from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import llm

from .const import DOMAIN
from .plans import CleaningPlanManager

NON_ADMIN_PROMPT = (
    "These tools are only for Home Assistant administrators. Ask an administrator."
)
_READ_ONLY = llm.ToolAnnotations(
    read_only=True, destructive=False, idempotent=True, open_world=False
)
_ERRORS = {
    "llm_admin_required": (
        "Only a Home Assistant administrator can use the robot tools."
    ),
    "llm_no_robot": (
        "No robot is set up in Home Assistant. Set up the robot, then try again."
    ),
    "llm_robot_required": (
        "More than one robot is set up. Name the robot to use, then try again."
    ),
    "llm_robot_ambiguous": (
        "More than one robot has that name. Use the robot's entry ID instead."
    ),
    "llm_robot_unknown": "No robot is named {robot}. Check the name, then try again.",
    "llm_robot_unavailable": (
        "The robot is unavailable. Check that it is on and connected, then try again."
    ),
    "llm_map_unavailable": (
        "The robot's room map is unavailable. Open Matic Map to check it, then "
        "try again."
    ),
    "llm_map_rechecking": (
        "The robot's room map is being checked. Try again in a moment."
    ),
    "llm_plan_ambiguous": (
        "More than one plan is named {plan}. Use the plan's ID instead."
    ),
    "llm_plan_unknown": "No plan is named {plan}. Check the name, then try again.",
    "llm_plan_unavailable": (
        "The plan can't be previewed. Open it in Matic Map to check it, then try "
        "again.\nDetails: {error}"
    ),
    "llm_room_required": "Name the room to reset, then try again.",
    "llm_room_unknown": "No room is named {room}. Check the name, then try again.",
    "llm_history_unavailable": (
        "The robot's cleaning history is unavailable. Check the robot, then try again."
    ),
    "llm_activity_session_required": (
        "To read older activity, also pass the observation ID from the first page."
    ),
    "llm_activity_restarted": (
        "The activity record restarted. Read the newest page, then continue."
    ),
    "llm_firmware_research_rejected": (
        "The firmware research request was rejected. Read the firmware reports "
        "again, then retry.\nDetails: {error}"
    ),
    "llm_nothing_to_stop": "The robot isn't cleaning, so there is nothing to stop.",
}


def _error(key: str, **placeholders: str) -> HomeAssistantError:
    """Create a translatable tool error that a model can relay to people."""
    return HomeAssistantError(
        _ERRORS[key].format(**placeholders),
        translation_domain=DOMAIN,
        translation_key=key,
        translation_placeholders=placeholders or None,
    )


async def _is_admin(hass: HomeAssistant, llm_context: llm.LLMContext) -> bool:
    """Return whether the request comes from a current administrator."""
    user_id = llm_context.context.user_id if llm_context.context else None
    user = await hass.auth.async_get_user(user_id) if user_id else None
    return user is not None and user.is_admin


async def _require_current_admin(
    hass: HomeAssistant, llm_context: llm.LLMContext
) -> None:
    """Fail closed when the caller is not an administrator now."""
    if not await _is_admin(hass, llm_context):
        raise _error("llm_admin_required")


class _AdministratorAPI(llm.API):
    """Offer tools to administrators and a plain prompt line to everyone else."""

    prompt: str

    @abstractmethod
    def tools(self) -> list[llm.Tool]:
        """Return this API's tools for an administrator."""

    @override
    async def async_get_api_instance(
        self, llm_context: llm.LLMContext
    ) -> llm.APIInstance:
        """Return the tools, or no tools and a prompt line for other users."""
        admin = await _is_admin(self.hass, llm_context)
        return llm.APIInstance(
            api=self,
            api_prompt=self.prompt if admin else NON_ADMIN_PROMPT,
            llm_context=llm_context,
            tools=self.tools() if admin else [],
        )


class _MaticTool(llm.Tool):
    """A Matic tool that only a current administrator can call.

    Tools handed to Assist see only robots whose vacuum is exposed to the
    calling assistant; an unexposed robot is treated as absent.
    """

    integration = DOMAIN

    def __init__(self, *, exposed_only: bool = False) -> None:
        self.exposed_only = exposed_only

    def entries(
        self, hass: HomeAssistant, llm_context: llm.LLMContext
    ) -> list[ConfigEntry[Any]]:
        """Return the loaded robots this caller may see, or a plain error."""
        entries = hass.config_entries.async_loaded_entries(DOMAIN)
        if self.exposed_only:
            entries = [
                entry
                for entry in entries
                if _exposed_to(hass, llm_context.assistant, entry)
            ]
        if not entries:
            raise _error("llm_no_robot")
        return entries

    def resolve_entry(
        self,
        hass: HomeAssistant,
        llm_context: llm.LLMContext,
        reference: str | None,
    ) -> ConfigEntry[Any]:
        """Resolve one visible robot without accepting its serial number."""
        return _resolve_entry(self.entries(hass, llm_context), reference)

    @abstractmethod
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        """Run the tool for an administrator."""

    @override
    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        await _require_current_admin(hass, llm_context)
        return await self.async_run(
            hass, self.parameters(tool_input.tool_args), llm_context
        )


_ROBOT_FIELD: dict[probatio.Marker, Any] = {
    probatio.Optional("robot"): probatio.All(cv.string, probatio.Length(min=1, max=128))
}


def _exposed_to(hass: HomeAssistant, assistant: str, entry: ConfigEntry[Any]) -> bool:
    """Return whether the robot's vacuum is exposed to the assistant."""
    return any(
        async_should_expose(hass, assistant, entity.entity_id)
        for entity in er.async_entries_for_config_entry(
            er.async_get(hass), entry.entry_id
        )
        if entity.domain == VACUUM_DOMAIN
    )


def _robot_identifiers(
    hass: HomeAssistant, entries: list[ConfigEntry[Any]]
) -> set[str]:
    """Return the entry, device and entity ids that identify these robots."""
    registry = er.async_get(hass)
    identifiers: set[str] = set()
    for entry in entries:
        identifiers.add(entry.entry_id)
        for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
            identifiers.add(entity.entity_id)
            if entity.device_id is not None:
                identifiers.add(entity.device_id)
    return identifiers


def _resolve_entry(
    entries: list[ConfigEntry[Any]], reference: str | None
) -> ConfigEntry[Any]:
    """Resolve one robot without exposing or accepting its serial number."""
    if reference is None:
        if len(entries) != 1:
            raise _error("llm_robot_required")
        return entries[0]
    folded = reference.casefold()
    for entry in entries:
        if folded == entry.entry_id.casefold():
            return entry
    matches = [
        entry
        for entry in entries
        if folded
        in {
            entry.title.casefold(),
            _entry_name(entry).casefold(),
        }
    ]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise _error("llm_robot_ambiguous")
    raise _error("llm_robot_unknown", robot=reference)


def _entry_name(entry: ConfigEntry[Any]) -> str:
    """Return the local robot display name with a config-entry fallback."""
    name = entry.runtime_data.coordinator.data.info.name
    return name if name else entry.title


def _resolve_plan_id(
    manager: CleaningPlanManager,
    serial_number: str,
    requested: str | None,
) -> str | None:
    """Resolve an explicit plan name without selecting an ambiguous match."""
    if requested is None:
        return None
    plans = manager.catalog.plans(serial_number)
    if requested in plans:
        return requested
    folded = requested.casefold()
    matches = [
        plan_id
        for plan_id, plan in plans.items()
        if str(plan.get("name", plan_id)).casefold() == folded
    ]
    if len(matches) > 1:
        raise _error("llm_plan_ambiguous", plan=requested)
    if matches:
        return matches[0]
    raise _error("llm_plan_unknown", plan=requested)
