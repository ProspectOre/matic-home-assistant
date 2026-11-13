"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

from collections.abc import (
    Callable,
    Coroutine,
    Mapping,
)
from dataclasses import dataclass
from functools import wraps
from typing import TYPE_CHECKING, Any

import probatio
from homeassistant.auth.permissions.const import POLICY_CONTROL
from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import (
    ATTR_AREA_ID,
    ATTR_DEVICE_ID,
    ATTR_ENTITY_ID,
    ATTR_FLOOR_ID,
    ATTR_LABEL_ID,
    STATE_UNAVAILABLE,
)
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    SupportsResponse,
)
from homeassistant.exceptions import (
    ServiceValidationError,
    Unauthorized,
    UnknownUser,
)
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import service, target
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.typing import VolSchemaType

from .const import (
    DOMAIN,
)
from .firmware import (
    FirmwareTracker,
)
from .managed_run import (
    _validation_error,
)
from .plans import CleaningPlanManager
from .room_coherence import current_floor_plan as _current_floor_plan

if TYPE_CHECKING:
    from . import MaticConfigEntry


@dataclass(frozen=True, slots=True)
class ServiceRuntime:
    """Dependencies shared by action registration domains."""

    hass: HomeAssistant
    manager: CleaningPlanManager
    firmware_tracker: FirmwareTracker


TARGET_KEYS = (
    ATTR_ENTITY_ID,
    ATTR_DEVICE_ID,
    ATTR_AREA_ID,
    ATTR_FLOOR_ID,
    ATTR_LABEL_ID,
)


def register_robot_action(
    hass: HomeAssistant,
    name: str,
    handler: Callable[[ServiceCall, list[str]], Coroutine[Any, Any, Any]],
    schema: VolSchemaType,
    *,
    supports_response: SupportsResponse = SupportsResponse.NONE,
    admin_only: bool = False,
) -> None:
    """Register an action on the Matic vacuums a call targets.

    Core resolves the target, refuses a user who may not control every entity
    it names, and hands over the available vacuums at once, so the handler sees
    the whole target and returns its own response. The schema first refuses a
    target with no loaded robot or with an unavailable one, as the domain
    actions did; core would skip such a robot and act on the rest.
    """

    def require_loaded_robots(data: dict[str, Any]) -> dict[str, Any]:
        _resolve_loaded_matic_vacuums(hass, data)
        return data

    async def async_call(entities: list[Entity], call: ServiceCall) -> Any:
        entity_ids = [entity.entity_id for entity in entities]
        if admin_only:
            await _async_require_admin(hass, call, lambda: entity_ids)
        return await handler(call, entity_ids)

    service.async_register_batched_platform_entity_service(
        hass,
        DOMAIN,
        name,
        entity_domain=VACUUM_DOMAIN,
        func=async_call,
        schema=probatio.All(schema, require_loaded_robots),
        supports_response=supports_response,
    )


def _require_matic_control[ServiceResult](
    hass: HomeAssistant,
    handler: Callable[[ServiceCall], Coroutine[Any, Any, ServiceResult]],
    *,
    allow_unavailable: bool = False,
) -> Callable[[ServiceCall], Coroutine[Any, Any, ServiceResult]]:
    """Apply Home Assistant's entity-control policy to a domain service."""

    @wraps(handler)
    async def async_authorized(call: ServiceCall) -> ServiceResult:
        user_id = call.context.user_id
        if user_id is not None:
            user = await hass.auth.async_get_user(user_id)
            if user is None:
                raise UnknownUser(context=call.context)
            if not user.is_admin:
                for entity_id in _resolve_loaded_matic_vacuums(
                    hass, call.data, require_available=not allow_unavailable
                ):
                    if not user.permissions.check_entity(entity_id, POLICY_CONTROL):
                        raise Unauthorized(
                            context=call.context,
                            entity_id=entity_id,
                            permission=POLICY_CONTROL,
                        )
        return await handler(call)

    return async_authorized


def _require_matic_admin[ServiceResult](
    hass: HomeAssistant,
    handler: Callable[[ServiceCall], Coroutine[Any, Any, ServiceResult]],
) -> Callable[[ServiceCall], Coroutine[Any, Any, ServiceResult]]:
    """Require an administrator for research routing."""

    @wraps(handler)
    async def async_authorized(call: ServiceCall) -> ServiceResult:
        await _async_require_admin(
            hass, call, lambda: _resolve_loaded_matic_vacuums(hass, call.data)
        )
        return await handler(call)

    return async_authorized


async def _async_require_admin(
    hass: HomeAssistant, call: ServiceCall, entity_ids: Callable[[], list[str]]
) -> None:
    """Refuse a call that no current administrator made."""
    user_id = call.context.user_id
    if user_id is None:
        raise Unauthorized(context=call.context, permission=POLICY_CONTROL)
    user = await hass.auth.async_get_user(user_id)
    if user is None:
        raise UnknownUser(context=call.context)
    if not user.is_admin:
        targets = entity_ids()
        raise Unauthorized(
            context=call.context,
            entity_id=targets[0] if targets else None,
            permission=POLICY_CONTROL,
        )


def _saved_plan_context(
    hass: HomeAssistant,
    entity_ids: list[str],
    *,
    require_rooms: bool = True,
    require_current_floor: bool = False,
) -> tuple[str, MaticConfigEntry, str, dict[str, str]]:
    """Return the one targeted robot and its current stable room inventory."""
    if len(entity_ids) != 1:
        raise _validation_error(
            "Saved cleaning plans require exactly one Matic robot",
            "single_robot_required",
        )
    entity_id = entity_ids[0]
    entry = _entry_for_entity(hass, entity_id)
    session = entry.runtime_data.session
    floor_plan = (
        _current_floor_plan(entry) if require_current_floor else session.floor.value
    )
    serial_number = session.info.serial_number
    room_map = (
        {room.id: room.name for room in floor_plan.rooms}
        if floor_plan is not None
        else {}
    )
    if require_rooms and not room_map:
        raise _validation_error(
            "The robot's room map is unavailable", "room_plan_unavailable"
        )
    return entity_id, entry, serial_number, room_map


def _resolve_loaded_matic_vacuums(
    hass: HomeAssistant, data: Mapping[str, Any], *, require_available: bool = True
) -> list[str]:
    """Resolve every target form and reject missing or unloaded robots."""
    selection = target.TargetSelection(
        {key: data[key] for key in TARGET_KEYS if key in data}
    )
    referenced = target.async_extract_referenced_entity_ids(hass, selection, True)
    requested = referenced.referenced | referenced.indirectly_referenced
    registry = er.async_get(hass)
    entity_ids: list[str] = []
    for entity_id in requested:
        entity = registry.async_get(entity_id)
        if (
            entity is None
            or entity.platform != DOMAIN
            or not entity_id.startswith(f"{VACUUM_DOMAIN}.")
        ):
            continue
        entry = (
            hass.config_entries.async_get_entry(entity.config_entry_id)
            if entity.config_entry_id
            else None
        )
        state = hass.states.get(entity_id)
        if (
            entry is None
            or entry.state is not ConfigEntryState.LOADED
            or (
                require_available
                and (state is None or state.state == STATE_UNAVAILABLE)
            )
        ):
            raise ServiceValidationError(
                "The selected Matic robot is unavailable",
                translation_domain=DOMAIN,
                translation_key="robot_unavailable",
            )
        entity_ids.append(entity_id)

    if not entity_ids:
        raise ServiceValidationError(
            "Select at least one loaded Matic vacuum",
            translation_domain=DOMAIN,
            translation_key="no_robot_target",
        )
    return entity_ids


def _entry_for_entity(hass: HomeAssistant, entity_id: str) -> MaticConfigEntry:
    """Return the loaded typed Matic config entry behind a vacuum entity."""
    registry_entry = er.async_get(hass).async_get(entity_id)
    if registry_entry is None or registry_entry.config_entry_id is None:
        raise _validation_error(
            "The selected Matic robot is unavailable", "robot_unavailable"
        )
    entry = hass.config_entries.async_get_entry(registry_entry.config_entry_id)
    if entry is None:
        raise _validation_error(
            "The selected Matic robot is unavailable", "robot_unavailable"
        )
    return entry
