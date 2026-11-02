"""Explicit, per-call AI analysis for immutable Matic photo snapshots."""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

import probatio
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv

from .client.snaps import RobotPhoto
from .const import DOMAIN
from .media_source import PhotoAttachmentUnavailable, photo_attachment_source

if TYPE_CHECKING:
    from . import MaticConfigEntry

MAX_QUESTION_LENGTH = 500
MAX_SUMMARY_LENGTH = 512
PHOTO_ANSWER_SCHEMA = probatio.Schema(
    {
        probatio.Required("problem"): cv.boolean,
        probatio.Required("summary"): probatio.All(
            cv.string, probatio.Length(min=1, max=MAX_SUMMARY_LENGTH)
        ),
    },
    extra=probatio.PREVENT_EXTRA,
)

AI_DISCLOSURE = (
    "The full photo and question were sent to the selected Home Assistant AI Task "
    "entity. Its provider may be cloud-based according to your Home Assistant setup."
)


async def async_answer_about_photo(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    photo: RobotPhoto,
    question: str,
    ai_task_entity_id: str,
    context: Context | None,
    attachment_generation: int | None = None,
) -> dict[str, Any]:
    """Send one immutable photo snapshot to the explicitly selected AI entity."""
    question = question.strip()
    if not question or len(question) > MAX_QUESTION_LENGTH:
        raise _error("photo_patrol_ai_question_invalid")
    if not ai_task_entity_id.startswith("ai_task."):
        raise _error("photo_patrol_ai_unavailable")

    source = photo_attachment_source(hass)
    if attachment_generation is None:
        try:
            attachment_generation = source.capture_entry_generation(entry.entry_id)
        except PhotoAttachmentUnavailable:
            raise _error("photo_patrol_ai_unavailable") from None
    try:
        media_source_id = await source.async_stage_photo(
            entry.entry_id,
            photo.photo_id,
            photo.image,
            expected_generation=attachment_generation,
        )
    except PhotoAttachmentUnavailable:
        raise _error("photo_patrol_ai_unavailable") from None
    try:
        result = await _async_generate_data(
            hass,
            task_name="Matic photo investigation",
            entity_id=ai_task_entity_id,
            instructions=(
                "Inspect the attached photo taken by a Matic robot. Answer the "
                "user's question using only visible evidence. If the image does not "
                "show enough to answer, say so in summary and set problem to false. "
                "Do not infer people, identities, intent, or events outside the "
                "image. User question: " + question
            ),
            structure=PHOTO_ANSWER_SCHEMA,
            attachments=[{"media_content_id": media_source_id}],
            context=context,
        )
    except Exception:
        # Provider exceptions may contain prompts or image-derived content.
        # Return a generic integration error and never log their details.
        raise _error("photo_patrol_ai_failed") from None
    finally:
        await source.async_release(media_source_id)

    data = result.data
    if (
        not isinstance(data, Mapping)
        or type(data.get("problem")) is not bool
        or not isinstance((summary := data.get("summary")), str)
        or not summary.strip()
        or len(summary) > MAX_SUMMARY_LENGTH
    ):
        raise _error("photo_patrol_ai_failed")
    return {
        "problem": data["problem"],
        "summary": summary.strip(),
        "ai_task_entity_id": ai_task_entity_id,
        "disclosure": AI_DISCLOSURE,
    }


async def _async_generate_data(hass: HomeAssistant, **kwargs: Any) -> Any:
    """Load the optional AI Task integration only for an explicit request."""
    from homeassistant.components.ai_task import async_generate_data

    return await async_generate_data(hass, **kwargs)


def validate_ai_task_entity(hass: HomeAssistant, entity_id: str) -> None:
    """Reject an unconfigured or unsuitable entity before moving the robot."""
    from homeassistant.components.ai_task.const import (
        DATA_COMPONENT as AI_TASK_DATA_COMPONENT,
    )
    from homeassistant.components.ai_task.const import (
        AITaskEntityFeature,
    )

    component = hass.data.get(AI_TASK_DATA_COMPONENT)
    entity = component.get_entity(entity_id) if component is not None else None
    if entity is None:
        raise _error("photo_patrol_ai_unavailable")
    if AITaskEntityFeature.GENERATE_DATA not in entity.supported_features:
        raise _error("photo_patrol_ai_unavailable")
    if AITaskEntityFeature.SUPPORT_ATTACHMENTS not in entity.supported_features:
        raise _error("photo_patrol_ai_unavailable")


def _error(key: str) -> HomeAssistantError:
    """Return a concise translated refusal without provider details."""
    return HomeAssistantError(
        "Matic photo analysis is unavailable",
        translation_domain=DOMAIN,
        translation_key=key,
    )
