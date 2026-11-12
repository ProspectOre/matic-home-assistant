"""Matic actions registered as platform entity services, through real core."""

from __future__ import annotations

from collections.abc import AsyncIterator
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import Context, HomeAssistant, SupportsResponse
from homeassistant.exceptions import ServiceValidationError, Unauthorized
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import DATA_DOMAIN_PLATFORM_ENTITIES
from homeassistant.helpers.service import batched_entity_service_call
from pytest_homeassistant_custom_component.common import MockConfigEntry, MockUser

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.service_context import register_robot_action
from tests.test_services import _registered_services

# Every action but the two firmware research actions, which work offline.
ROBOT_ACTIONS = {
    "clean",
    "clean_area",
    "clean_room_again",
    "clean_room_next",
    "clean_room_sequence",
    "delete_plan",
    "delete_room_schedule",
    "firmware_snapshot",
    "go_to_room",
    "inspect_hermes_endpoint",
    "list_plans",
    "photo_patrol",
    "preview_plan",
    "preview_room_sequence",
    "reset_plan_history",
    "reset_room_cadence",
    "run_selected_plan",
    "save_plan",
    "skip_room",
    "stop_intelligent_cleaning",
}
DOMAIN_ACTIONS = {"firmware_investigator", "firmware_notification"}


@pytest.fixture(autouse=True)
async def _unload(hass: HomeAssistant) -> AsyncIterator[None]:
    """Mark the stand-in entries unloaded so teardown does not unload them."""
    yield
    for entry in hass.config_entries.async_entries(DOMAIN):
        entry.mock_state(hass, ConfigEntryState.NOT_LOADED)


def _user(hass: HomeAssistant, policy: dict | None = None) -> MockUser:
    """Add an administrator, or a user with ``policy``."""
    user = MockUser(is_owner=policy is None).add_to_hass(hass)
    if policy is not None:
        user.mock_policy(policy)
    return user


async def _robots(hass: HomeAssistant, *available: bool) -> list[str]:
    """Add one loaded Matic vacuum per flag, each on its device in one area."""
    area = ar.async_get(hass).async_create("Upstairs")
    platform = hass.data.setdefault(DATA_DOMAIN_PLATFORM_ENTITIES, {}).setdefault(
        ("vacuum", DOMAIN), {}
    )
    entity_ids = []
    for index, up in enumerate(available):
        entry = MockConfigEntry(domain=DOMAIN, state=ConfigEntryState.LOADED)
        entry.add_to_hass(hass)
        device = dr.async_get(hass).async_get_or_create(
            config_entry_id=entry.entry_id, identifiers={(DOMAIN, f"robot-{index}")}
        )
        dr.async_get(hass).async_update_device(device.id, area_id=area.id)
        entity_id = (
            er.async_get(hass)
            .async_get_or_create(
                "vacuum",
                DOMAIN,
                f"robot-{index}",
                config_entry=entry,
                device_id=device.id,
            )
            .entity_id
        )
        hass.states.async_set(entity_id, "docked" if up else "unavailable")
        platform[entity_id] = SimpleNamespace(entity_id=entity_id, available=up)
        entity_ids.append(entity_id)
    return entity_ids


def _register(hass: HomeAssistant, *, admin_only: bool = False) -> AsyncMock:
    handler = AsyncMock(return_value={"run_id": "run-1"})
    register_robot_action(
        hass,
        "probe",
        handler,
        cv.make_entity_service_schema({}),
        supports_response=SupportsResponse.OPTIONAL,
        admin_only=admin_only,
    )
    return handler


async def _call(hass: HomeAssistant, target: dict, **kwargs) -> object:
    return await hass.services.async_call(
        DOMAIN, "probe", target, blocking=True, **kwargs
    )


async def test_every_robot_action_is_a_platform_entity_service() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    handlers = {
        item.args[1]: item.args[2] for item in services.async_register.call_args_list
    }

    assert set(handlers) == ROBOT_ACTIONS | DOMAIN_ACTIONS
    for name in ROBOT_ACTIONS:
        assert handlers[name].func is batched_entity_service_call, name
    for name in DOMAIN_ACTIONS:
        assert getattr(handlers[name], "func", None) is None, name


async def test_each_way_of_naming_the_robot_reaches_it_with_a_flat_response(
    hass: HomeAssistant,
) -> None:
    (entity_id,) = await _robots(hass, True)
    entity = er.async_get(hass).async_get(entity_id)
    device = dr.async_get(hass).async_get(entity.device_id)
    handler = _register(hass)

    for target in (
        {"entity_id": entity_id},
        {"device_id": device.id},
        {"area_id": device.area_id},
    ):
        assert await _call(hass, target, return_response=True) == {"run_id": "run-1"}
        call, entity_ids = handler.await_args.args
        assert entity_ids == [entity_id]
        assert "entity_id" not in call.data
    assert await _call(hass, {"entity_id": entity_id}) is None


async def test_an_unavailable_robot_in_the_target_refuses_the_whole_call(
    hass: HomeAssistant,
) -> None:
    """Core would act on the available robot; the action refuses as before."""
    up, down = await _robots(hass, True, False)
    handler = _register(hass)

    for target in ({"entity_id": [up, down]}, {"area_id": "upstairs"}):
        with pytest.raises(ServiceValidationError) as raised:
            await _call(hass, target)
        assert raised.value.translation_key == "robot_unavailable"
    handler.assert_not_awaited()

    await _call(hass, {"entity_id": up})
    assert handler.await_args.args[1] == [up]


@pytest.mark.parametrize("target", [{"entity_id": "all"}, {"entity_id": "light.x"}])
async def test_a_target_without_a_matic_robot_is_refused(
    hass: HomeAssistant, target: dict
) -> None:
    await _robots(hass, True)
    handler = _register(hass)

    with pytest.raises(ServiceValidationError) as raised:
        await _call(hass, target)
    assert raised.value.translation_key == "no_robot_target"
    handler.assert_not_awaited()


async def test_only_users_who_may_control_the_robot_reach_the_handler(
    hass: HomeAssistant,
) -> None:
    (entity_id,) = await _robots(hass, True)
    handler = _register(hass)
    user = _user(hass, {"entities": True})
    viewer = _user(hass, {"entities": {"all": {"read": True}}})

    with pytest.raises(Unauthorized):
        await _call(hass, {"entity_id": entity_id}, context=Context(user_id=viewer.id))
    handler.assert_not_awaited()
    await _call(hass, {"entity_id": entity_id}, context=Context(user_id=user.id))
    handler.assert_awaited_once()


async def test_an_administrator_action_refuses_users_and_system_calls(
    hass: HomeAssistant,
) -> None:
    (entity_id,) = await _robots(hass, True)
    handler = _register(hass, admin_only=True)
    user = _user(hass, {"entities": True})
    admin = _user(hass)

    for context in (Context(user_id=user.id), Context()):
        with pytest.raises(Unauthorized) as raised:
            await _call(hass, {"entity_id": entity_id}, context=context)
        assert raised.value.entity_id in (entity_id, None)
    handler.assert_not_awaited()
    await _call(hass, {"entity_id": entity_id}, context=Context(user_id=admin.id))
    handler.assert_awaited_once()
