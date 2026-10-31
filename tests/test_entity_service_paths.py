"""Real HA platform/registry/dispatcher paths with an inert robot client.

Button domain services are local sinks: these tests qualify adapter routing,
not physical cleaning or the separate production managed-executor handlers.
"""

from collections.abc import AsyncIterator
from dataclasses import replace
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.components.recorder.history import get_last_state_changes
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import restore_state
from homeassistant.helpers.restore_state import RestoreStateData
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.components.recorder.common import (
    async_wait_recording_done,
)

from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    UserCommand,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    async_get_plan_manager,
)
from tests.test_entities import _entry

BUTTONS = (
    "run_selected_plan",
    "intelligent_clean",
    "clean_entire_plan",
    "stop_intelligent_cleaning",
    "clean_selected_area",
)
PLATFORMS = ["button", "select", "vacuum", "switch", "number"]


@pytest.fixture
def mock_recorder_before_hass(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Choose the test database before the Core fixture initializes."""
    if "recorder_mock" in request.fixturenames:
        # Python 3.14 evaluates TYPE_CHECKING-only names when the recorder
        # fixture autospecs its migration and session helpers.
        from homeassistant.components.recorder import Recorder, migration
        from homeassistant.helpers import recorder as recorder_helper
        from sqlalchemy.orm import Session

        monkeypatch.setattr(migration, "Recorder", Recorder, raising=False)
        monkeypatch.setattr(recorder_helper, "Session", Session, raising=False)
        request.getfixturevalue("recorder_db_url")


@pytest.fixture
async def platforms(hass: HomeAssistant) -> AsyncIterator[SimpleNamespace]:
    """Load production platforms into HA; fake only the robot dependency."""
    dependency = _entry(idle=True)
    coordinator = dependency.runtime_data.coordinator
    coordinator.hass = hass
    coordinator.data = replace(
        coordinator.data,
        operational=replace(
            coordinator.data.operational, charging=True, charging_idle=True
        ),
    )
    coordinator.client.async_get_active_cleaning_session_state = AsyncMock(
        return_value=False
    )
    coordinator.client.async_get_state = AsyncMock(side_effect=lambda: coordinator.data)
    assert await async_setup_component(hass, DOMAIN, {})
    manager = await async_get_plan_manager(hass)
    serial = coordinator.data.info.serial_number
    for plan_id, name in (("one", "First plan"), ("two", "Second plan")):
        await manager.catalog.async_save_plan(
            serial,
            plan_id,
            {
                "name": name,
                "enabled": True,
                "rooms": [
                    {
                        "room_id": "room-1",
                        "name": "Kitchen",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                    }
                ],
            },
        )
    for area_id, name in (("area-one", "First area"), ("area-two", "Second area")):
        await manager.catalog.async_save_area(serial, area_id, {"name": name})
    dependency.runtime_data.cleaning_plans = manager
    entry = MockConfigEntry(
        domain=DOMAIN, data={"serial_number": serial}, state=ConfigEntryState.LOADED
    )
    entry.runtime_data = dependency.runtime_data
    entry.add_to_hass(hass)
    registry = er.async_get(hass)
    for domain, suffix in [
        *(("button", key) for key in BUTTONS),
        ("select", "saved_cleaning_plan"),
        ("select", "custom_cleaning_area"),
    ]:
        registry.async_get_or_create(
            domain, DOMAIN, f"{serial}_{suffix}", config_entry=entry, disabled_by=None
        )
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await hass.async_block_till_done()
    entities = {
        entity.unique_id.removeprefix(serial + "_"): entity.entity_id
        for entity in er.async_entries_for_config_entry(registry, entry.entry_id)
    }
    assert all(
        hass.states.get(entities[key]) is not None
        for key in (
            *BUTTONS,
            "saved_cleaning_plan",
            "custom_cleaning_area",
            "vacuum",
            "cleaning_mode",
            "coverage",
        )
    )
    yield SimpleNamespace(
        entry=entry,
        coordinator=coordinator,
        manager=manager,
        serial=serial,
        entities=entities,
    )
    await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    await hass.async_block_till_done()
    entry.mock_state(hass, ConfigEntryState.NOT_LOADED)


async def test_select_service_updates_persistent_selection_and_display(
    hass: HomeAssistant, platforms: SimpleNamespace
) -> None:
    """Displayed names pass through HA validation into real manager storage."""
    for suffix, option, selected_key, expected in (
        ("saved_cleaning_plan", "First plan", "selected_plan", "one"),
        ("custom_cleaning_area", "First area", "selected_area", "area-one"),
    ):
        entity_id = platforms.entities[suffix]
        await hass.services.async_call(
            "select",
            "select_option",
            {"entity_id": entity_id, "option": option},
            blocking=True,
        )
        await hass.async_block_till_done()
        assert hass.states.get(entity_id).state == option
        assert (
            platforms.manager.ledger.snapshot(platforms.serial)[selected_key]
            == expected
        )
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.ledger.snapshot(platforms.serial)["selected_plan"] == "one"
    assert reloaded.ledger.snapshot(platforms.serial)["selected_area"] == "area-one"


async def test_config_select_service_updates_entry_and_native_preference(
    hass: HomeAssistant, platforms: SimpleNamespace
) -> None:
    for suffix, option, enum_value, option_key in (
        ("cleaning_mode", "mop", CleaningMode.MOP, "cleaning_mode"),
        ("coverage", "quick", CoverageSetting.QUICK, "coverage_setting"),
    ):
        entity_id = platforms.entities[suffix]
        await hass.services.async_call(
            "select",
            "select_option",
            {"entity_id": entity_id, "option": option},
            blocking=True,
        )
        assert hass.states.get(entity_id).state == option
        assert getattr(platforms.coordinator, option_key) == enum_value
        assert platforms.entry.options[option_key] == option
        assert er.async_get(hass).async_get(entity_id).entity_category.value == "config"


@pytest.mark.parametrize("button", BUTTONS)
async def test_button_press_reaches_owned_vacuum_service(
    hass: HomeAssistant, platforms: SimpleNamespace, button: str
) -> None:
    """Exercise native button.press, including the real ownership lookup."""
    service = "clean_area" if button == "clean_selected_area" else button
    calls: list[ServiceCall] = []

    async def record(call: ServiceCall) -> None:
        calls.append(call)

    hass.services.async_register(DOMAIN, service, record)
    snapshot = platforms.manager.ledger.snapshot(platforms.serial)
    if button == "stop_intelligent_cleaning":
        snapshot["active_plan"] = {"plan_id": "two"}
    with patch.object(platforms.manager.ledger, "snapshot", return_value=snapshot):
        await hass.services.async_call(
            "button", "press", {"entity_id": platforms.entities[button]}, blocking=True
        )
    assert len(calls) == 1
    expected: dict[str, Any] = {"entity_id": platforms.entities["vacuum"]}
    if service == "clean_area":
        expected["area"] = "area-two"
    assert calls[0].data == expected


@pytest.mark.parametrize(
    "service, command",
    [
        ("pause", UserCommand.PAUSE),
        ("stop", UserCommand.STOP),
        ("return_to_base", UserCommand.DOCK),
    ],
)
async def test_vacuum_service_reaches_transport_once(
    hass: HomeAssistant, platforms: SimpleNamespace, service: str, command: UserCommand
) -> None:
    """Use HA's native vacuum dispatcher instead of calling an entity method."""
    await hass.services.async_call(
        "vacuum", service, {"entity_id": platforms.entities["vacuum"]}, blocking=True
    )
    platforms.coordinator.client.async_send_user_command.assert_awaited_once_with(
        command
    )


async def test_vacuum_start_and_named_room_validation(
    hass: HomeAssistant, platforms: SimpleNamespace
) -> None:
    """Native dispatcher selects real protocol rooms and rejects missing names."""
    target = {"entity_id": platforms.entities["vacuum"]}
    client = platforms.coordinator.client
    await hass.services.async_call("vacuum", "start", target, blocking=True)
    assert client.async_start_coverage.await_args.args[1] == [
        "protocol-1",
        "protocol-2",
    ]
    client.async_start_coverage.reset_mock()
    await hass.services.async_call(
        "vacuum",
        "send_command",
        {**target, "command": "clean_rooms", "params": {"rooms": ["Study"]}},
        blocking=True,
    )
    assert client.async_start_coverage.await_args.args[1] == ["protocol-2"]
    client.async_start_coverage.reset_mock()
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            "vacuum",
            "send_command",
            {**target, "command": "clean_rooms", "params": {"rooms": ["Missing room"]}},
            blocking=True,
        )
    client.async_start_coverage.assert_not_awaited()


@pytest.mark.parametrize(
    "suffix, setting",
    [
        ("child_lock", "child_lock"),
        ("pet_waste_avoidance", "pet_waste"),
        ("voice_assistant", "voice"),
        ("deep_mop", "deep_mop"),
    ],
)
async def test_switch_services_reach_verified_setting_adapter(
    hass: HomeAssistant, platforms: SimpleNamespace, suffix: str, setting: str
) -> None:
    for enabled in (True, False):
        await hass.services.async_call(
            "switch",
            "turn_on" if enabled else "turn_off",
            {"entity_id": platforms.entities[suffix]},
            blocking=True,
        )
        client = platforms.coordinator.client
        if setting == "deep_mop":
            client.async_set_deep_mop.assert_awaited_with(enabled)
        else:
            client.async_set_binary_setting.assert_awaited_with(setting, enabled)
    assert platforms.coordinator.async_request_full_refresh.await_count == 2


async def test_number_service_rejects_out_of_range_before_transport(
    hass: HomeAssistant, platforms: SimpleNamespace
) -> None:
    target = {"entity_id": platforms.entities["water_flow"]}
    client = platforms.coordinator.client
    await hass.services.async_call(
        "number", "set_value", {**target, "value": 1.5}, blocking=True
    )
    client.async_set_water_flow.assert_awaited_once_with(1.5)
    client.async_set_water_flow.reset_mock()
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            "number", "set_value", {**target, "value": 3}, blocking=True
        )
    client.async_set_water_flow.assert_not_awaited()


async def test_room_statistics_record_and_restore_native_values(
    hass: HomeAssistant, recorder_mock: Any, platforms: SimpleNamespace
) -> None:
    """Record converted states, persist native restore data, then reload offline."""
    restore = restore_state.async_get(hass)
    # Core's test fixture makes its initial restore store read-only. Use a
    # fresh native Store so this case exercises serialization and reloading.
    restore.store = RestoreStateData(hass).store
    await restore.async_load()
    registry = er.async_get(hass)
    for suffix in ("clean_duration", "last_cleaned"):
        entity = registry.async_get_or_create(
            "sensor",
            DOMAIN,
            platforms.serial + "_room_room-1_" + suffix,
            config_entry=platforms.entry,
            disabled_by=None,
        )
        if suffix == "clean_duration":
            registry.async_update_entity_options(
                entity.entity_id, "sensor", {"unit_of_measurement": "min"}
            )
    await hass.config_entries.async_forward_entry_setups(platforms.entry, ["sensor"])
    await hass.async_block_till_done()
    duration = registry.async_get_entity_id(
        "sensor", DOMAIN, platforms.serial + "_room_room-1_clean_duration"
    )
    last_cleaned = registry.async_get_entity_id(
        "sensor", DOMAIN, platforms.serial + "_room_room-1_last_cleaned"
    )
    assert duration is not None and last_cleaned is not None
    room = CleaningRoom("room-1", "Kitchen", "vacuum", "quick")
    await platforms.manager.ledger.async_mark_started(platforms.serial, "one", room)
    assert await platforms.manager.ledger.async_mark_completed(
        platforms.serial, "one", room, duration_seconds=1738
    )
    await hass.async_block_till_done()
    state = hass.states.get(duration)
    assert state.attributes["unit_of_measurement"] == "min"
    assert float(state.state) == pytest.approx(1738 / 60)
    recorded_last_cleaned = hass.states.get(last_cleaned).state
    await async_wait_recording_done(hass)
    history = await hass.async_add_executor_job(
        get_last_state_changes, hass, 1, duration
    )
    assert history[duration][0].state == state.state
    assert history[duration][0].attributes["unit_of_measurement"] == "min"
    assert duration in restore.entities
    await restore.async_dump_states()
    saved_restore = await restore.store.async_load()
    assert saved_restore and any(
        item["state"]["entity_id"] == duration for item in saved_restore
    ), saved_restore
    await hass.config_entries.async_unload_platforms(platforms.entry, ["sensor"])
    await hass.async_block_till_done()
    # A cold robot/history source must not erase the restore-backed values.
    platforms.entry.runtime_data.cleaning_plans = CleaningPlanManager(hass)
    await restore.async_load()
    assert restore.last_states[duration].extra_data.as_dict()["native_value"] == 1738
    await hass.config_entries.async_forward_entry_setups(platforms.entry, ["sensor"])
    await hass.async_block_till_done()
    assert float(hass.states.get(duration).state) == pytest.approx(1738 / 60)
    assert hass.states.get(last_cleaned).state == recorded_last_cleaned
    await hass.config_entries.async_unload_platforms(platforms.entry, ["sensor"])
    await hass.async_block_till_done()
