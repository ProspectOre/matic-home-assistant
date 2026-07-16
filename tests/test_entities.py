"""Behavior tests for every Home Assistant entity platform."""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest
from homeassistant.components.vacuum.const import VacuumActivity
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from custom_components.matic_robot import (
    binary_sensor,
    button,
    camera,
    number,
    select,
    sensor,
    switch,
    vacuum,
)
from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    UserCommand,
)
from custom_components.matic_robot.client.models import (
    CleaningSchedule,
    CleaningSession,
    FloorPlan,
    RobotInfo,
    RobotOperationalState,
    RobotPose,
    RobotState,
    RobotTelemetry,
    Room,
    WifiNetwork,
)
from custom_components.matic_robot.entity import MaticEntity


def _state(*, paused: bool = False, floor_plan: FloorPlan | None = None) -> RobotState:
    return RobotState(
        info=RobotInfo(
            serial_number="synthetic-serial",
            name="Test Robot",
            hostname="robot.invalid",
            port=16320,
            ip4_address="192.0.2.1",
            ip6_address="2001:db8::1",
            encrypted=True,
            requires_auth=True,
            network_auth=True,
            hardware_revision="test-hardware",
        ),
        operational=RobotOperationalState(
            battery_percentage=82,
            state_codes=(1, 2),
            error_codes=(),
            charging_idle=False,
            charging=False,
            low_charge=False,
            paused=paused,
            cleaning=not paused,
            returning=False,
        ),
        floor_plan=floor_plan,
        pose=RobotPose(1, 2, 0),
        telemetry=RobotTelemetry(
            software_version="v-test",
            software_profile="test-profile",
            protocol_version=25,
            supports_easter_event=True,
            update_channel="stable",
            update_state="idle",
            wifi_state="connected",
            timezone="Etc/UTC",
            scheduled_cleanings=3,
            local_cleaning_sessions=7,
            child_lock_enabled=False,
            pet_waste_enabled=True,
            voice_enabled=False,
            matter_pairing_enabled=False,
            deep_mop_enabled=False,
            water_flow_factor=1.0,
            dock_detections=4,
            sink_summon_locations=1,
            coverage_time_seconds=600,
            wifi_ssid="Test LAN",
            wifi_signal_dbm=-45,
            wifi_networks=(
                WifiNetwork("Test LAN", -45, True, True),
                WifiNetwork("Guest", -70, False, False),
            ),
            schedules=(
                CleaningSchedule(
                    "Morning",
                    ("monday",),
                    510,
                    "Etc/UTC",
                    True,
                    True,
                    ("protocol-1",),
                ),
            ),
            latest_session=CleaningSession(
                "2026-01-01T08:00:00+00:00",
                "2026-01-01T08:10:00+00:00",
                600,
                ("Kitchen",),
                (("Kitchen", 600),),
                True,
            ),
        ),
    )


def _floor_plan() -> FloorPlan:
    return FloorPlan(
        mission_id=7,
        partition_protocol_id="partition",
        partition_id_wire=b"partition",
        rooms=(
            Room("room-1", "Kitchen", "protocol-1", b"one", ((0, 0), (1, 1))),
            Room("room-2", "Study", "protocol-2", b"two", ((1, 1), (2, 2))),
        ),
    )


def _entry(*, paused: bool = False, with_floor_plan: bool = True):
    floor_plan = _floor_plan() if with_floor_plan else None
    coordinator = SimpleNamespace(
        data=_state(paused=paused, floor_plan=floor_plan),
        client=SimpleNamespace(
            async_send_user_command=AsyncMock(),
            async_start_coverage=AsyncMock(),
            async_set_binary_setting=AsyncMock(),
            async_set_deep_mop=AsyncMock(),
            async_set_water_flow=AsyncMock(),
        ),
        cleaning_mode=CleaningMode.BOTH,
        coverage_setting=CoverageSetting.STANDARD,
        async_request_refresh=AsyncMock(),
        last_update_success=True,
    )
    history = SimpleNamespace(
        snapshot=MagicMock(
            return_value={
                "completed_runs": 0,
                "failed_runs": 0,
                "last_completed": None,
                "last_completed_by_room": {},
                "plan_history": {},
                "plans": {
                    "whole_home": {
                        "name": "Whole home",
                        "enabled": True,
                        "room_count": 2,
                    }
                },
                "selected_plan": "whole_home",
                "selected_plan_name": "Whole home",
                "active_plan": None,
                "last_interrupted_plan": None,
            }
        ),
        plans=MagicMock(
            return_value={
                "whole_home": {
                    "name": "Whole home",
                    "enabled": True,
                }
            }
        ),
        plan=MagicMock(return_value={"id": "whole_home", "name": "Whole home"}),
        preview=MagicMock(
            return_value={
                "valid": True,
                "plan_name": "Whole home",
                "rooms": [{"name": "Kitchen", "room_id": "room-1"}],
            }
        ),
        async_select_plan=AsyncMock(),
        async_add_listener=MagicMock(return_value=MagicMock()),
    )
    return SimpleNamespace(
        runtime_data=SimpleNamespace(coordinator=coordinator, cleaning_plans=history),
        options={},
        entry_id="entry",
    )


async def test_platform_setups_create_forty_four_entities(hass) -> None:
    entry = _entry()
    entities: list[object] = []
    platform_counts: dict[str, int] = {}

    async def add_platform(name: str, setup) -> None:
        added: list[object] = []
        await setup(hass, entry, lambda values: added.extend(values))
        platform_counts[name] = len(added)
        entities.extend(added)

    await add_platform("binary_sensor", binary_sensor.async_setup_entry)
    await add_platform("button", button.async_setup_entry)
    await add_platform("sensor", sensor.async_setup_entry)
    await add_platform("select", select.async_setup_entry)
    await add_platform("camera", camera.async_setup_entry)
    await add_platform("number", number.async_setup_entry)
    await add_platform("switch", switch.async_setup_entry)
    await add_platform("vacuum", vacuum.async_setup_entry)

    assert platform_counts == {
        "binary_sensor": 12,
        "button": 4,
        "camera": 1,
        "number": 1,
        "select": 3,
        "sensor": 18,
        "switch": 4,
        "vacuum": 1,
    }
    assert len(entities) == 44
    assert len({entity.unique_id for entity in entities}) == 44
    assert all(entity.device_info["manufacturer"] == "Matic" for entity in entities)


def test_sensor_and_binary_sensor_values() -> None:
    entry = _entry()
    fully_charged = next(
        description
        for description in binary_sensor.DESCRIPTIONS
        if description.key == "fully_charged"
    )
    assert fully_charged.device_class is None
    assert fully_charged.icon is None  # icons come from icons.json
    sensors = [
        sensor.MaticActivitySensor(entry),
        sensor.MaticBatterySensor(entry),
        sensor.MaticHardwareRevisionSensor(entry),
        sensor.MaticRoomsSensor(entry),
    ]

    assert [item.native_value for item in sensors] == [
        "cleaning",
        82,
        "test-hardware",
        2,
    ]
    assert sensors[0].extra_state_attributes == {
        "hermes_state_codes": [1, 2],
        "hermes_error_codes": [],
        "errors": [],
        "primary_error": None,
        "current_area": None,
    }
    assert sensors[3].extra_state_attributes == {
        "room_names": ["Kitchen", "Study"],
        "segments": {"room-1": "Kitchen", "room-2": "Study"},
    }
    history = sensor.MaticCleaningHistorySensor(entry)
    assert history.available is True
    assert history.native_value == 0
    assert history.extra_state_attributes["active_plan"] is None
    active_plan = sensor.MaticActiveCleaningPlanSensor(entry)
    next_room = sensor.MaticNextCleaningRoomSensor(entry)
    assert active_plan.native_value is None
    assert active_plan.extra_state_attributes is None
    assert next_room.native_value == "Kitchen"
    assert next_room.extra_state_attributes["valid"] is True
    assert [
        binary_sensor.MaticBinarySensor(entry, description).is_on
        for description in binary_sensor.DESCRIPTIONS
    ] == [
        False,
        False,
        True,
        False,
        False,
        False,
        False,
        False,
        False,
        None,
        None,
        None,
    ]

    no_map = sensor.MaticRoomsSensor(_entry(with_floor_plan=False))
    assert no_map.native_value is None
    assert no_map.extra_state_attributes is None
    no_map_next = sensor.MaticNextCleaningRoomSensor(_entry(with_floor_plan=False))
    assert no_map_next.native_value is None

    software = sensor.MaticSoftwareVersionSensor(entry)
    assert software.native_value == "v-test"
    assert software.extra_state_attributes == {
        "firmware_profile": "test-profile",
        "robot_profile": None,
        "release_channel": None,
        "supports_easter_event": True,
        "timezone": "Etc/UTC",
    }
    assert [
        sensor.MaticStateSensor(entry, description).native_value
        for description in sensor.STATE_DESCRIPTIONS
    ] == [25, None, "stable", "idle", "connected", 3, 7, 4, 1, 600]

    state_sensors = {
        description.key: sensor.MaticStateSensor(entry, description)
        for description in sensor.STATE_DESCRIPTIONS
    }
    assert state_sensors["current_area"].extra_state_attributes == {
        "previous_area": None
    }
    wifi = state_sensors["wifi_state"].extra_state_attributes
    assert wifi is not None
    assert wifi["ssid"] == "Test LAN"
    assert wifi["known_networks"] == 1
    assert len(wifi["networks"]) == 2
    schedules = state_sensors["scheduled_cleanings"].extra_state_attributes
    assert schedules is not None
    assert schedules["schedules"][0]["rooms"] == ["Kitchen"]
    sessions = state_sensors["local_cleaning_sessions"].extra_state_attributes
    assert sessions is not None
    assert sessions["latest_room_durations"] == {"Kitchen": 600}
    assert state_sensors["protocol_version"].extra_state_attributes is None


def test_session_attributes_require_a_recorded_session() -> None:
    entry = _entry()
    coordinator = entry.runtime_data.coordinator
    coordinator.data = replace(
        coordinator.data,
        telemetry=replace(coordinator.data.telemetry, latest_session=None),
    )
    description = next(
        description
        for description in sensor.STATE_DESCRIPTIONS
        if description.key == "local_cleaning_sessions"
    )

    assert sensor.MaticStateSensor(entry, description).extra_state_attributes is None


def test_next_room_preview_hides_stale_plan_errors() -> None:
    for error in (KeyError("room-1"), ValueError("plan references retired rooms")):
        entry = _entry()
        entry.runtime_data.cleaning_plans.preview = MagicMock(side_effect=error)
        next_room = sensor.MaticNextCleaningRoomSensor(entry)

        assert next_room.native_value is None
        assert next_room.extra_state_attributes is None


async def test_storage_backed_sensors_track_history_and_stay_available() -> None:
    entry = _entry()
    history = entry.runtime_data.cleaning_plans
    history_sensor = sensor.MaticCleaningHistorySensor(entry)
    plan_sensor = sensor.MaticActiveCleaningPlanSensor(entry)

    with patch.object(MaticEntity, "async_added_to_hass", AsyncMock()):
        for entity in (history_sensor, plan_sensor):
            entity.async_write_ha_state = MagicMock()
            await entity.async_added_to_hass()

    assert history.async_add_listener.call_count == 2
    for entity, listener_call in zip(
        (history_sensor, plan_sensor),
        history.async_add_listener.call_args_list,
        strict=True,
    ):
        serial, listener = listener_call.args
        assert serial == "synthetic-serial"
        listener()
        entity.async_write_ha_state.assert_called_once()

    entry.runtime_data.coordinator.last_update_success = False
    assert history_sensor.available is True
    assert plan_sensor.available is True


async def test_verified_setting_entities_write_and_refresh() -> None:
    entry = _entry()
    coordinator = entry.runtime_data.coordinator
    switches = [
        switch.MaticSettingSwitch(entry, description)
        for description in switch.DESCRIPTIONS
    ]

    assert [entity.is_on for entity in switches] == [
        False,
        True,
        False,
        False,
    ]
    assert all(entity.available for entity in switches)

    await switches[0].async_turn_on()
    await switches[1].async_turn_off()
    await switches[2].async_turn_on()
    await switches[3].async_turn_on()

    assert coordinator.client.async_set_binary_setting.await_args_list == [
        call("child_lock", True),
        call("pet_waste", False),
        call("voice", True),
    ]
    coordinator.client.async_set_deep_mop.assert_awaited_once_with(True)

    water_flow = number.MaticWaterFlowNumber(entry)
    assert water_flow.native_value == 1.0
    assert water_flow.available is True
    await water_flow.async_set_native_value(1.4)
    coordinator.client.async_set_water_flow.assert_awaited_once_with(1.4)
    assert coordinator.async_request_refresh.await_count == 5


async def test_saved_plan_select_and_native_button() -> None:
    entry = _entry()
    plan_select = select.MaticSavedPlanSelect(entry)

    assert plan_select.options == ["Whole home"]
    assert plan_select.current_option == "Whole home"
    await plan_select.async_select_option("Whole home")
    entry.runtime_data.cleaning_plans.async_select_plan.assert_awaited_once_with(
        "synthetic-serial", "whole_home"
    )

    plan_button = button.MaticPlanButton(entry, "intelligent_clean")
    local_hass = SimpleNamespace(services=SimpleNamespace(async_call=AsyncMock()))
    plan_button.hass = local_hass
    with patch.object(
        plan_button, "_vacuum_entity_id", return_value="vacuum.test_robot"
    ):
        await plan_button.async_press()
    local_hass.services.async_call.assert_awaited_once_with(
        "matic_robot",
        "intelligent_clean",
        {"entity_id": "vacuum.test_robot"},
        blocking=True,
    )

    registry_entry = SimpleNamespace(
        domain="vacuum", platform="matic_robot", entity_id="vacuum.test_robot"
    )
    with (
        patch("custom_components.matic_robot.button.er.async_get"),
        patch(
            "custom_components.matic_robot.button.er.async_entries_for_config_entry",
            return_value=[registry_entry],
        ),
    ):
        assert plan_button._vacuum_entity_id() == "vacuum.test_robot"

    with (
        patch("custom_components.matic_robot.button.er.async_get"),
        patch(
            "custom_components.matic_robot.button.er.async_entries_for_config_entry",
            return_value=[],
        ),
        pytest.raises(HomeAssistantError, match="unavailable"),
    ):
        plan_button._vacuum_entity_id()


async def test_saved_plan_select_rerenders_when_plans_change() -> None:
    entry = _entry()
    history = entry.runtime_data.cleaning_plans
    plan_select = select.MaticSavedPlanSelect(entry)
    plan_select.async_write_ha_state = MagicMock()

    with patch.object(MaticEntity, "async_added_to_hass", AsyncMock()):
        await plan_select.async_added_to_hass()

    serial, listener = history.async_add_listener.call_args.args
    assert serial == "synthetic-serial"
    listener()
    plan_select.async_write_ha_state.assert_called_once()


async def test_selects_update_next_clean_preferences(hass) -> None:
    entry = _entry()
    mode = select.MaticCleaningModeSelect(entry)
    coverage = select.MaticCoverageSettingSelect(entry)
    mode.hass = hass
    coverage.hass = hass
    mode.async_write_ha_state = MagicMock()
    coverage.async_write_ha_state = MagicMock()
    hass.config_entries.async_update_entry = MagicMock(
        side_effect=lambda config_entry, **changes: setattr(
            config_entry, "options", changes["options"]
        )
    )

    await mode.async_select_option(CleaningMode.VACUUM.value)
    await coverage.async_select_option(CoverageSetting.QUICK.value)

    assert mode.current_option == CleaningMode.VACUUM.value
    assert coverage.current_option == CoverageSetting.QUICK.value
    assert entry.options == {
        "cleaning_mode": CleaningMode.VACUUM.value,
        "coverage_setting": CoverageSetting.QUICK.value,
    }
    mode.async_write_ha_state.assert_called_once()
    coverage.async_write_ha_state.assert_called_once()


async def test_camera_clamps_dimensions_and_renders_locally(hass) -> None:
    entity = camera.MaticMapCamera(_entry())
    entity.hass = hass
    with patch(
        "custom_components.matic_robot.camera.render_floor_plan",
        return_value=b"synthetic-png",
    ) as render:
        image = await entity.async_camera_image(width=1, height=9999)

    assert image == b"synthetic-png"
    assert render.call_args.kwargs == {"width": 256, "height": 2048}


async def test_vacuum_controls_refresh_and_preserve_room_order() -> None:
    entry = _entry()
    entity = vacuum.MaticVacuum(entry)
    coordinator = entry.runtime_data.coordinator

    assert entity.activity is VacuumActivity.CLEANING
    assert [segment.id for segment in await entity.async_get_segments()] == [
        "room-1",
        "room-2",
    ]

    await entity.async_pause()
    await entity.async_stop()
    await entity.async_return_to_base()
    commands = [
        call.args[0]
        for call in coordinator.client.async_send_user_command.await_args_list
    ]
    assert commands == [
        UserCommand.PAUSE,
        UserCommand.STOP,
        UserCommand.DOCK,
    ]

    await entity.async_clean_segments(["room-2"])
    coverage_call = coordinator.client.async_start_coverage.await_args
    assert coverage_call.args[1] == ["protocol-2"]
    assert coverage_call.kwargs == {
        "cleaning_mode": CleaningMode.BOTH,
        "coverage_setting": CoverageSetting.STANDARD,
        "ordered": False,
    }
    assert coordinator.async_request_refresh.await_count == 4


async def test_vacuum_start_resumes_or_cleans_all_rooms() -> None:
    paused_entry = _entry(paused=True)
    await vacuum.MaticVacuum(paused_entry).async_start()
    paused_entry.runtime_data.coordinator.client.async_send_user_command.assert_awaited_once_with(
        UserCommand.RESUME
    )

    ready_entry = _entry()
    await vacuum.MaticVacuum(ready_entry).async_start()
    start_call = (
        ready_entry.runtime_data.coordinator.client.async_start_coverage.await_args
    )
    assert start_call.args[1] == [
        "protocol-1",
        "protocol-2",
    ]


async def test_clean_action_supports_the_complete_verified_option_matrix() -> None:
    entry = _entry()
    entity = vacuum.MaticVacuum(entry)

    await entity.async_send_command(
        "clean_rooms",
        {
            "rooms": ["Study", "room-1"],
            "cleaning_mode": "mop",
            "coverage": "quick",
            "ordered": True,
        },
    )

    call = entry.runtime_data.coordinator.client.async_start_coverage.await_args
    assert call.args[1] == ["protocol-2", "protocol-1"]
    assert call.kwargs == {
        "cleaning_mode": CleaningMode.MOP,
        "coverage_setting": CoverageSetting.QUICK,
        "ordered": True,
    }

    await entity.async_send_command(
        "clean_all",
        {
            "cleaning_mode": "vacuum_and_mop",
            "coverage": "standard",
        },
    )
    call = entry.runtime_data.coordinator.client.async_start_coverage.await_args
    assert call.kwargs == {
        "cleaning_mode": CleaningMode.BOTH,
        "coverage_setting": CoverageSetting.STANDARD,
        "ordered": False,
    }


async def test_vacuum_attributes_and_segments_survive_a_missing_floor_plan() -> None:
    entity = vacuum.MaticVacuum(_entry())
    assert entity.extra_state_attributes == {
        "low_charge": False,
        "problem": False,
        "rooms": {"room-1": "Kitchen", "room-2": "Study"},
    }

    bare = vacuum.MaticVacuum(_entry(with_floor_plan=False))
    assert bare.extra_state_attributes == {
        "low_charge": False,
        "problem": False,
        "rooms": {},
    }
    assert await bare.async_get_segments() == []


async def test_send_command_defaults_and_option_type_validation() -> None:
    entry = _entry()
    entity = vacuum.MaticVacuum(entry)

    await entity.async_send_command("clean_all")
    coverage_call = (
        entry.runtime_data.coordinator.client.async_start_coverage.await_args
    )
    assert coverage_call.args[1] == ["protocol-1", "protocol-2"]
    assert coverage_call.kwargs == {
        "cleaning_mode": CleaningMode.BOTH,
        "coverage_setting": CoverageSetting.STANDARD,
        "ordered": False,
    }

    await entity.async_send_command("clean_segments", ["Study"])
    coverage_call = (
        entry.runtime_data.coordinator.client.async_start_coverage.await_args
    )
    assert coverage_call.args[1] == ["protocol-2"]
    assert coverage_call.kwargs["ordered"] is False

    with pytest.raises(ServiceValidationError, match="CleaningMode must be a string"):
        await entity.async_send_command("clean_all", {"cleaning_mode": 5})


async def test_vacuum_named_commands_and_validation() -> None:
    entry = _entry()
    entity = vacuum.MaticVacuum(entry)

    await entity.async_send_command("return home")
    await entity.async_send_command(
        "clean_rooms",
        {
            "rooms": ["Study", "room-1", "Study"],
            "cleaning_mode": "vacuum",
            "coverage": "quick",
            "ordered": True,
        },
    )
    call = entry.runtime_data.coordinator.client.async_start_coverage.await_args
    assert call.args[1] == ["protocol-2", "protocol-1"]
    assert call.kwargs == {
        "cleaning_mode": CleaningMode.VACUUM,
        "coverage_setting": CoverageSetting.QUICK,
        "ordered": True,
    }

    for command, params, message in (
        ("clean_rooms", {"rooms": []}, "Select at least one"),
        ("clean_rooms", {"rooms": ["Garage"]}, "Unknown Matic room"),
        ("clean_rooms", {"rooms": "Kitchen"}, "requires params.rooms"),
        ("clean_all", {"ordered": "yes"}, "ordered must be"),
        ("clean_all", {"coverage": "unknown"}, "Invalid CoverageSetting"),
        ("unknown", None, "Unsupported Matic command"),
    ):
        with pytest.raises(ServiceValidationError, match=message):
            await entity.async_send_command(command, params)

    with pytest.raises(ServiceValidationError, match="room plan is unavailable"):
        await vacuum.MaticVacuum(_entry(with_floor_plan=False)).async_start()
