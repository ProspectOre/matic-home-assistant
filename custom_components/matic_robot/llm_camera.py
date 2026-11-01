"""Administrator-only photo and photo-investigation Assist tools."""

from __future__ import annotations

from typing import Any, cast, override

import probatio
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import llm

from .const import DOMAIN
from .llm_common import _ROBOT_FIELD, _MaticTool
from .llm_control import _async_service_refusal, _PanelRobot

_PHOTO_ACTION_DESCRIPTION = (
    "The robot travels to the named room, takes one photo and returns to its dock. "
    "The configured no-photo rooms and unattended photo opt-in apply. Photos are "
    "kept only in Home Assistant's bounded in-memory cache; never put a photo or "
    "photo URL in logs or persistent state."
)
_AI_DISCLOSURE = (
    "When investigating, the full photo and question go to the explicitly selected "
    "Home Assistant AI Task entity, which may use a cloud provider according to "
    "the owner's configuration. Do not choose an entity on the owner's behalf."
)


class MaticTakePhotoTool(_MaticTool):
    """Take and return a pixelated preview from a named room."""

    name = "MaticTakePhoto"
    title = "Take a photo"
    description = _PHOTO_ACTION_DESCRIPTION
    annotations = llm.ToolAnnotations(destructive=False, open_world=False)
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Required("room"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
            ),
        }
    )

    @override
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        robot = _PanelRobot(
            hass, self.resolve_entry(hass, llm_context, args.get("robot"))
        )
        try:
            response = await hass.services.async_call(
                DOMAIN,
                "photo_patrol",
                {ATTR_ENTITY_ID: robot.entity_id, "rooms": [args["room"]]},
                blocking=True,
                context=llm_context.context,
                return_response=True,
            )
        except HomeAssistantError as err:
            return await _async_service_refusal(hass, llm_context, err)
        photo = _first_photo(cast(dict[str, Any], response))
        return llm.ToolResult(
            data={"taken": photo is not None, "photo": photo, "preview_only": True}
        )


class MaticInvestigateTool(_MaticTool):
    """Take a photo of a named room and ask one selected AI Task entity."""

    name = "MaticInvestigate"
    title = "Investigate with a photo"
    description = f"{_PHOTO_ACTION_DESCRIPTION} {_AI_DISCLOSURE}"
    annotations = llm.ToolAnnotations(destructive=False, open_world=False)
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Required("room"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
            ),
            probatio.Required("question"): probatio.All(
                cv.string, probatio.Length(min=1, max=500)
            ),
            probatio.Required("ai_task_entity_id"): cv.entity_id,
        }
    )

    @override
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        robot = _PanelRobot(
            hass, self.resolve_entry(hass, llm_context, args.get("robot"))
        )
        try:
            response = await hass.services.async_call(
                DOMAIN,
                "photo_patrol",
                {
                    ATTR_ENTITY_ID: robot.entity_id,
                    "rooms": [args["room"]],
                    "question": args["question"],
                    "ai_task_entity_id": args["ai_task_entity_id"],
                },
                blocking=True,
                context=llm_context.context,
                return_response=True,
            )
        except HomeAssistantError as err:
            return await _async_service_refusal(hass, llm_context, err)
        photo = _first_photo(cast(dict[str, Any], response))
        if photo is None or not isinstance(photo.get("analysis"), dict):
            return llm.ToolResult(
                data={
                    "done": False,
                    "reason": "The photo investigation returned no answer.",
                },
                error=True,
            )
        return llm.ToolResult(
            data={
                "done": True,
                "photo_id": photo.get("photo_id"),
                "preview_url": photo.get("preview_url"),
                "analysis": photo["analysis"],
            }
        )


def _first_photo(response: dict[str, Any]) -> dict[str, Any] | None:
    """Extract the first bounded patrol photo without echoing full URLs."""
    robots = response.get("robots")
    if not isinstance(robots, list) or not robots or not isinstance(robots[0], dict):
        return None
    photos = robots[0].get("photos")
    if not isinstance(photos, list) or not photos or not isinstance(photos[0], dict):
        return None
    photo = photos[0]
    return {
        key: photo[key]
        for key in ("photo_id", "captured_at", "preview_url", "analysis")
        if key in photo
    }
