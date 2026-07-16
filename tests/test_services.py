"""Automation action coverage for room-native cleaning plans."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import HermesCollectionEntry
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.plans import CleaningPlanManager, CleaningRoom
from custom_components.matic_robot.services import (
    DELETE_PLAN_ROOM_SCHEMA,
    MOVE_PLAN_ROOM_SCHEMA,
    PLAN_REFERENCE_SCHEMA,
    SAVE_PLAN_ROOM_SCHEMA,
    SAVE_PLAN_SCHEMA,
    SAVED_PLAN_SERVICE_SCHEMA,
    PlanCancelledError,
    _async_execute_rooms,
    _async_run_room,
    _async_wait_for_vacuum_state,
    _entry_for_entity,
    _resolve_loaded_matic_vacuums,
    _saved_plan_context,
    async_register_services,
)


def _registered_handler(services, service: str):
    return next(
        item.args[2]
        for item in services.async_register.call_args_list
        if item.args[1] == service
    )


async def _registered_services(hass, manager=None):
    services = SimpleNamespace(async_register=MagicMock(), async_call=AsyncMock())
    hass.services = services
    replacement = manager or SimpleNamespace(async_load=AsyncMock())
    if manager is not None:
        replacement.async_load = AsyncMock()
    with patch(
        "custom_components.matic_robot.services.CleaningPlanManager",
        return_value=replacement,
    ):
        await async_register_services(hass)
    return services


def _execution_call(hass) -> ServiceCall:
    return ServiceCall(
        hass,
        DOMAIN,
        "intelligent_clean",
        {
            "plan_id": "away",
            "start_timeout": 120,
            "completion_timeout": 21600,
            "return_to_base": False,
        },
    )


async def test_clean_action_routes_every_verified_preference() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean",
        {
            "entity_id": ["vacuum.test"],
            "rooms": ["Study", "Kitchen"],
            "cleaning_mode": "mop",
            "coverage_setting": "quick",
            "ordered": True,
        },
    )
    with patch(
        "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
        return_value=["vacuum.test"],
    ):
        await _registered_handler(services, "clean")(call)

    services.async_call.assert_awaited_once_with(
        "vacuum",
        "send_command",
        {
            "entity_id": ["vacuum.test"],
            "command": "clean_rooms",
            "params": {
                "rooms": ["Study", "Kitchen"],
                "cleaning_mode": "mop",
                "coverage": "quick",
                "ordered": True,
            },
        },
        blocking=True,
        context=call.context,
    )


async def test_clean_action_without_rooms_targets_entire_floor() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    call = ServiceCall(
        hass, DOMAIN, "clean", {"entity_id": ["vacuum.test"], "ordered": False}
    )
    with patch(
        "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
        return_value=["vacuum.test"],
    ):
        await _registered_handler(services, "clean")(call)
    assert services.async_call.await_args.args[2]["command"] == "clean_all"


async def test_intelligent_exact_preview_stop_and_reset_actions(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "upstairs",
        {
            "name": "Upstairs",
            "enabled": True,
            "run_behavior": "ordered",
            "rooms": [
                {
                    "room_id": "room-study",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
            "return_to_base": True,
        },
    )
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", SimpleNamespace(), "serial", {"room-study": "Study"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "intelligent_clean",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Upstairs"}),
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms", AsyncMock()
        ) as execute,
    ):
        await _registered_handler(services, "intelligent_clean")(call)
        await _registered_handler(services, "clean_entire_plan")(call)
        await _registered_handler(services, "run_selected_plan")(call)
        preview = await _registered_handler(services, "preview_plan")(call)

    assert execute.await_count == 3
    assert execute.await_args_list[0].kwargs["intelligent"] is True
    assert execute.await_args_list[1].kwargs["intelligent"] is False
    assert execute.await_args_list[2].kwargs["intelligent"] is False
    assert preview["plan_name"] == "Upstairs"
    assert preview["run_behavior"] == "ordered"
    assert preview["rooms"][0]["room_id"] == "room-study"

    lock = manager.lock("serial")
    await lock.acquire()
    manager.prepare_run("serial")
    stop = ServiceCall(
        hass, DOMAIN, "stop_intelligent_cleaning", {"entity_id": ["vacuum.test"]}
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        await _registered_handler(services, "stop_intelligent_cleaning")(stop)
    assert manager.cancellation_event("serial").is_set()
    lock.release()
    services.async_call.assert_awaited_with(
        "vacuum",
        "return_to_base",
        {"entity_id": "vacuum.test"},
        blocking=True,
        context=stop.context,
    )

    reset = ServiceCall(
        hass,
        DOMAIN,
        "reset_plan_history",
        {"entity_id": ["vacuum.test"], "plan": "Upstairs", "all_plans": False},
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        await _registered_handler(services, "reset_plan_history")(reset)


async def test_managed_actions_report_missing_plan_and_inactive_run(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "disabled",
        {"name": "Disabled", "enabled": False, "rooms": []},
    )
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", SimpleNamespace(), "serial", {"one": "Kitchen"})
    missing = ServiceCall(
        hass,
        DOMAIN,
        "preview_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Missing"}),
    )
    stop = ServiceCall(
        hass, DOMAIN, "stop_intelligent_cleaning", {"entity_id": ["vacuum.test"]}
    )
    reset_missing = ServiceCall(
        hass,
        DOMAIN,
        "reset_plan_history",
        {"entity_id": ["vacuum.test"], "plan": "Missing", "all_plans": False},
    )
    disabled = ServiceCall(
        hass,
        DOMAIN,
        "preview_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Disabled"}),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError, match="Unknown"):
            await _registered_handler(services, "preview_plan")(missing)
        with pytest.raises(ServiceValidationError, match="Unknown"):
            await _registered_handler(services, "intelligent_clean")(missing)
        with pytest.raises(ServiceValidationError, match="Unknown"):
            await _registered_handler(services, "reset_plan_history")(reset_missing)
        with pytest.raises(ServiceValidationError, match="disabled"):
            await _registered_handler(services, "preview_plan")(disabled)
        with pytest.raises(ServiceValidationError, match="No managed"):
            await _registered_handler(services, "stop_intelligent_cleaning")(stop)


async def test_room_native_plan_crud_is_complete(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    context = (
        "vacuum.test",
        SimpleNamespace(),
        "serial",
        {"room-kitchen": "Kitchen", "room-study": "Study"},
    )
    save = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "Away cleaning",
                "rooms": [
                    {
                        "room": "Kitchen",
                        "cleaning_mode": "vacuum_and_mop",
                        "coverage_setting": "standard",
                    }
                ],
            }
        ),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        saved = await _registered_handler(services, "save_plan")(save)
    assert saved["plan"]["id"] == "away_cleaning"
    assert saved["plan"]["rooms"][0]["room_id"] == "room-kitchen"

    add = ServiceCall(
        hass,
        DOMAIN,
        "save_plan_room",
        SAVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Away cleaning",
                "room": {
                    "room": "Study",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                },
            }
        ),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        added = await _registered_handler(services, "save_plan_room")(add)
    assert added["position"] == 2

    move = ServiceCall(
        hass,
        DOMAIN,
        "move_plan_room",
        MOVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "away_cleaning",
                "room": "Study",
                "new_position": 1,
            }
        ),
    )
    listing = ServiceCall(hass, DOMAIN, "list_plans", {"entity_id": ["vacuum.test"]})
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        moved = await _registered_handler(services, "move_plan_room")(move)
        plans = await _registered_handler(services, "list_plans")(listing)
    assert moved["room"]["room_id"] == "room-study"
    assert [room["room_id"] for room in plans["plans"][0]["rooms"]] == [
        "room-study",
        "room-kitchen",
    ]

    remove = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan_room",
        DELETE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Away cleaning",
                "room": "Kitchen",
            }
        ),
    )
    select = ServiceCall(
        hass,
        DOMAIN,
        "select_plan",
        PLAN_REFERENCE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Away cleaning"}),
    )
    delete = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan",
        PLAN_REFERENCE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Away cleaning"}),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        removed = await _registered_handler(services, "delete_plan_room")(remove)
        selected = await _registered_handler(services, "select_plan")(select)
        deleted = await _registered_handler(services, "delete_plan")(delete)
    assert removed["deleted"]["room_id"] == "room-kitchen"
    assert selected["selected_plan_id"] == "away_cleaning"
    assert deleted["deleted_plan_id"] == "away_cleaning"
    assert manager.plans("serial") == {}


async def test_room_crud_rejects_unknown_rooms_membership_and_positions(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "test",
        {
            "name": "Test",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    services = await _registered_services(hass, manager)
    context = (
        "vacuum.test",
        SimpleNamespace(),
        "serial",
        {"room-kitchen": "Kitchen", "room-study": "Study"},
    )
    bad_room = ServiceCall(
        hass,
        DOMAIN,
        "save_plan_room",
        SAVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Test",
                "room": {"room": "Missing"},
            }
        ),
    )
    bad_delete = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan_room",
        DELETE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Test",
                "room": "Study",
            }
        ),
    )
    bad_move = ServiceCall(
        hass,
        DOMAIN,
        "move_plan_room",
        MOVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Test",
                "room": "Kitchen",
                "new_position": 2,
            }
        ),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError, match="Unknown Matic room"):
            await _registered_handler(services, "save_plan_room")(bad_room)
        with pytest.raises(ServiceValidationError, match="not part"):
            await _registered_handler(services, "delete_plan_room")(bad_delete)
        with pytest.raises(ServiceValidationError, match="position 2 is invalid"):
            await _registered_handler(services, "move_plan_room")(bad_move)

        update = ServiceCall(
            hass,
            DOMAIN,
            "save_plan_room",
            SAVE_PLAN_ROOM_SCHEMA(
                {
                    "entity_id": ["vacuum.test"],
                    "plan": "Test",
                    "room": {
                        "room": "Kitchen",
                        "cleaning_mode": "mop",
                        "coverage_setting": "standard",
                    },
                }
            ),
        )
        result = await _registered_handler(services, "save_plan_room")(update)
        assert result["position"] == 1
        assert manager.plan("serial", "test")["rooms"][0]["cleaning_mode"] == "mop"

        unknown = ServiceCall(
            hass,
            DOMAIN,
            "select_plan",
            PLAN_REFERENCE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Missing"}),
        )
        with pytest.raises(ServiceValidationError, match="Unknown Matic cleaning"):
            await _registered_handler(services, "select_plan")(unknown)


def test_saved_plan_context_requires_one_robot_and_live_rooms() -> None:
    call = MagicMock()
    state = SimpleNamespace(attributes={"rooms": {"one": "Kitchen"}})
    hass = SimpleNamespace(states=SimpleNamespace(get=MagicMock(return_value=state)))
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(
                data=SimpleNamespace(
                    info=SimpleNamespace(serial_number="synthetic-serial")
                )
            )
        )
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.services._entry_for_entity",
            return_value=entry,
        ),
    ):
        assert _saved_plan_context(hass, call)[2:] == (
            "synthetic-serial",
            {"one": "Kitchen"},
        )
        state.attributes["rooms"] = {}
        with pytest.raises(ServiceValidationError, match="room plan"):
            _saved_plan_context(hass, call)
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one", "vacuum.two"],
        ),
        pytest.raises(ServiceValidationError, match="exactly one"),
    ):
        _saved_plan_context(hass, call)


def _resolution_hass(*, loaded: bool = True, available: bool = True):
    entity = SimpleNamespace(platform=DOMAIN, config_entry_id="entry")
    registry = SimpleNamespace(async_get=MagicMock(return_value=entity))
    entry = SimpleNamespace(
        state=ConfigEntryState.LOADED if loaded else ConfigEntryState.SETUP_RETRY
    )
    state = SimpleNamespace(state="docked" if available else "unavailable")
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_get_entry=MagicMock(return_value=entry)),
        states=SimpleNamespace(get=MagicMock(return_value=state)),
    )
    call = ServiceCall(
        hass, DOMAIN, "clean", {"entity_id": ["vacuum.test"], "ordered": False}
    )
    referenced = SimpleNamespace(
        referenced={"vacuum.test"}, indirectly_referenced=set()
    )
    return hass, call, registry, referenced


def test_action_target_resolution_accepts_loaded_matic_vacuum() -> None:
    hass, call, registry, referenced = _resolution_hass()
    with (
        patch(
            "custom_components.matic_robot.services.target.async_extract_referenced_entity_ids",
            return_value=referenced,
        ),
        patch(
            "custom_components.matic_robot.services.er.async_get",
            return_value=registry,
        ),
    ):
        assert _resolve_loaded_matic_vacuums(hass, call) == ["vacuum.test"]


@pytest.mark.parametrize(("loaded", "available"), [(False, True), (True, False)])
def test_action_target_resolution_rejects_unavailable_robot(loaded, available) -> None:
    hass, call, registry, referenced = _resolution_hass(
        loaded=loaded, available=available
    )
    with (
        patch(
            "custom_components.matic_robot.services.target.async_extract_referenced_entity_ids",
            return_value=referenced,
        ),
        patch(
            "custom_components.matic_robot.services.er.async_get",
            return_value=registry,
        ),
        pytest.raises(ServiceValidationError, match="unavailable"),
    ):
        _resolve_loaded_matic_vacuums(hass, call)


def test_action_target_resolution_rejects_non_matic_target() -> None:
    hass, call, registry, referenced = _resolution_hass()
    registry.async_get.return_value = SimpleNamespace(
        platform="other", config_entry_id="entry"
    )
    with (
        patch(
            "custom_components.matic_robot.services.target.async_extract_referenced_entity_ids",
            return_value=referenced,
        ),
        patch(
            "custom_components.matic_robot.services.er.async_get",
            return_value=registry,
        ),
        pytest.raises(ServiceValidationError, match="Select at least one"),
    ):
        _resolve_loaded_matic_vacuums(hass, call)


async def test_fetch_hermes_collection_returns_bounded_raw_snapshot() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    client = SimpleNamespace(
        async_get_collection_entries=AsyncMock(
            return_value=(HermesCollectionEntry(b"key", b"payload"),)
        )
    )
    entry = SimpleNamespace(runtime_data=SimpleNamespace(client=client))
    call = ServiceCall(
        hass,
        DOMAIN,
        "fetch_hermes_collection",
        {
            "entity_id": ["vacuum.test"],
            "collection": "wifi_status",
            "limit": 1,
            "include_payload": True,
            "payload_format": "hex",
            "max_bytes": 4,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.services._entry_for_entity",
            return_value=entry,
        ),
    ):
        response = await _registered_handler(services, "fetch_hermes_collection")(call)
    assert response["entries"][0]["key"] == "6b6579"
    assert response["entries"][0]["value"] == "7061796c"
    assert response["entries"][0]["value_truncated"] is True


async def test_fetch_hermes_collection_requires_exactly_one_robot() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "fetch_hermes_collection",
        {
            "entity_id": ["vacuum.one", "vacuum.two"],
            "collection": "wifi_status",
            "limit": 1,
            "include_payload": False,
            "payload_format": "base64",
            "max_bytes": 65536,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one", "vacuum.two"],
        ),
        pytest.raises(ServiceValidationError, match="exactly one"),
    ):
        await _registered_handler(services, "fetch_hermes_collection")(call)


async def test_fetch_hermes_collection_encodes_base64_payloads() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    client = SimpleNamespace(
        async_get_collection_entries=AsyncMock(
            return_value=(HermesCollectionEntry(b"key", b"payload"),)
        )
    )
    entry = SimpleNamespace(runtime_data=SimpleNamespace(client=client))
    call = ServiceCall(
        hass,
        DOMAIN,
        "fetch_hermes_collection",
        {
            "entity_id": ["vacuum.test"],
            "collection": "wifi_status",
            "limit": 1,
            "include_payload": True,
            "payload_format": "base64",
            "max_bytes": 64,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.services._entry_for_entity",
            return_value=entry,
        ),
    ):
        response = await _registered_handler(services, "fetch_hermes_collection")(call)
    assert response["entries"][0]["key"] == "a2V5"
    assert response["entries"][0]["value"] == "cGF5bG9hZA=="
    assert response["entries"][0]["key_truncated"] is False
    assert response["entries"][0]["value_truncated"] is False


async def test_plan_runs_reject_disabled_plans_and_unknown_selection(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial", "disabled", {"name": "Disabled", "enabled": False, "rooms": []}
    )
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", SimpleNamespace(), "serial", {"one": "Kitchen"})
    disabled = ServiceCall(
        hass,
        DOMAIN,
        "intelligent_clean",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Disabled"}),
    )
    missing = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.test"], "plan": "Missing"}),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError, match="disabled"):
            await _registered_handler(services, "intelligent_clean")(disabled)
        with pytest.raises(ServiceValidationError, match="Unknown Matic cleaning"):
            await _registered_handler(services, "run_selected_plan")(missing)


async def test_save_plan_rejects_names_that_produce_no_plan_id(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", SimpleNamespace(), "serial", {"room-kitchen": "Kitchen"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "???",
                "rooms": [{"room": "Kitchen"}],
            }
        ),
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        pytest.raises(ServiceValidationError) as excinfo,
    ):
        await _registered_handler(services, "save_plan")(call)
    assert "Plan ID is empty" in str(excinfo.value)
    assert excinfo.value.translation_key == "invalid_plan"
    assert excinfo.value.translation_placeholders == {"error": "Plan ID is empty"}
    assert manager.plans("serial") == {}


async def test_deleting_the_last_room_disables_the_plan(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "solo",
        {
            "name": "Solo",
            "enabled": True,
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    services = await _registered_services(hass, manager)
    context = ("vacuum.test", SimpleNamespace(), "serial", {"room-kitchen": "Kitchen"})
    call = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan_room",
        DELETE_PLAN_ROOM_SCHEMA(
            {"entity_id": ["vacuum.test"], "plan": "Solo", "room": "Kitchen"}
        ),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        removed = await _registered_handler(services, "delete_plan_room")(call)
    assert removed["deleted"]["room_id"] == "room-kitchen"
    saved = manager.plan("serial", "solo")
    assert saved["rooms"] == []
    assert saved["enabled"] is False


async def test_room_edits_reject_rooms_outside_the_plan_or_map(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "test",
        {
            "name": "Test",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
        },
    )
    services = await _registered_services(hass, manager)
    context = (
        "vacuum.test",
        SimpleNamespace(),
        "serial",
        {"room-kitchen": "Kitchen", "room-study": "Study"},
    )
    outside_plan = ServiceCall(
        hass,
        DOMAIN,
        "move_plan_room",
        MOVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Test",
                "room": "Study",
                "new_position": 1,
            }
        ),
    )
    unmapped = ServiceCall(
        hass,
        DOMAIN,
        "delete_plan_room",
        DELETE_PLAN_ROOM_SCHEMA(
            {"entity_id": ["vacuum.test"], "plan": "Test", "room": "Nowhere"}
        ),
    )
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        with pytest.raises(ServiceValidationError, match="not part of this plan"):
            await _registered_handler(services, "move_plan_room")(outside_plan)
        with pytest.raises(ServiceValidationError, match="Unknown Matic room: Nowhere"):
            await _registered_handler(services, "delete_plan_room")(unmapped)
    assert manager.plan("serial", "test")["rooms"][0]["room_id"] == "room-kitchen"


async def test_room_cancellation_records_history_and_reraises() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_cancelled=AsyncMock(),
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(side_effect=PlanCancelledError),
        ),
        pytest.raises(PlanCancelledError),
    ):
        await _async_run_room(
            hass, _execution_call(hass), manager, "vacuum.test", "serial", room
        )
    manager.async_mark_cancelled.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_cancelled"


@pytest.mark.parametrize(
    "error",
    [MaticError("robot rejected the command"), HomeAssistantError("call failed")],
)
async def test_room_failures_reraise_native_errors_unchanged(error) -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_failed=AsyncMock(),
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(side_effect=error),
        ),
        pytest.raises(type(error)) as excinfo,
    ):
        await _async_run_room(
            hass, _execution_call(hass), manager, "vacuum.test", "serial", room
        )
    assert excinfo.value is error
    manager.async_mark_failed.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_failed"


async def test_wait_returns_immediately_when_state_is_already_desired(hass) -> None:
    hass.states.async_set("vacuum.test", "cleaning")
    state = await _async_wait_for_vacuum_state(hass, "vacuum.test", {"cleaning"}, 10)
    assert state == "cleaning"


async def test_wait_ignores_removed_entities_and_fails_on_error_transition(
    hass,
) -> None:
    hass.states.async_set("vacuum.test", "idle")
    waiting = asyncio.create_task(
        _async_wait_for_vacuum_state(hass, "vacuum.test", {"cleaning"}, 10)
    )
    await asyncio.sleep(0)
    hass.states.async_remove("vacuum.test")
    await asyncio.sleep(0)
    assert not waiting.done()
    hass.states.async_set("vacuum.test", "error")
    with pytest.raises(ServiceValidationError, match="reported an error"):
        await waiting


async def test_wait_returns_reached_state_while_cancel_stays_pending(hass) -> None:
    hass.states.async_set("vacuum.test", "cleaning")
    cancel = asyncio.Event()
    waiting = asyncio.create_task(
        _async_wait_for_vacuum_state(hass, "vacuum.test", {"docked"}, 10, cancel)
    )
    await asyncio.sleep(0)
    hass.states.async_set("vacuum.test", "docked")
    assert await waiting == "docked"
    assert not cancel.is_set()


async def test_execute_rooms_skips_every_room_once_cancellation_is_set() -> None:
    cancel_event = asyncio.Event()
    cancel_event.set()
    manager = SimpleNamespace(
        lock=MagicMock(return_value=asyncio.Lock()),
        prepare_run=MagicMock(return_value=cancel_event),
    )
    hass = SimpleNamespace()
    call = ServiceCall(
        hass,
        DOMAIN,
        "clean_entire_plan",
        {
            "plan_id": "away",
            "start_timeout": 120,
            "completion_timeout": 21600,
            "return_to_base": True,
        },
    )
    room = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "quick")
    with patch(
        "custom_components.matic_robot.services._async_run_room", AsyncMock()
    ) as run:
        await _async_execute_rooms(
            hass, call, manager, "vacuum.test", "serial", [room], intelligent=False
        )
    run.assert_not_awaited()


def test_entry_lookup_returns_loaded_entry_and_rejects_stale_references() -> None:
    registry = SimpleNamespace(
        async_get=MagicMock(return_value=SimpleNamespace(config_entry_id="entry"))
    )
    entry = SimpleNamespace()
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_get_entry=MagicMock(return_value=entry))
    )
    with patch(
        "custom_components.matic_robot.services.er.async_get", return_value=registry
    ):
        assert _entry_for_entity(hass, "vacuum.test") is entry
        hass.config_entries.async_get_entry.return_value = None
        with pytest.raises(ServiceValidationError, match="unavailable"):
            _entry_for_entity(hass, "vacuum.test")
