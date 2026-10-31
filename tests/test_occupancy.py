"""Occupancy-aware plans hold occupied rooms out of a run."""

import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import probatio
import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.client.models import Room
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.occupancy import (
    area_occupancy_sensors,
    entry_vacuum_entity_id,
    occupancy_holds,
    plan_occupancy_sensors,
    room_area_ids,
)
from custom_components.matic_robot.plan_model import CleaningRoom, PlanRoomsHeldError
from custom_components.matic_robot.plan_views import (
    MaticPlansView,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.service_schemas import (
    SAVE_PLAN_SCHEMA,
    SAVED_PLAN_SERVICE_SCHEMA,
)
from tests.test_services import (
    _area_floor_plan,
    _registered_handler,
    _registered_services,
)
from tests.test_slam_scene import _entry as _scene_entry
from tests.test_slam_scene import _hass as _scene_hass
from tests.test_slam_scene import _request as _scene_request
from tests.test_slam_scene import _runtime as _scene_runtime

KITCHEN = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")
STUDY = CleaningRoom("room-study", "Study", "vacuum", "quick")
ROOM_MAP = {"room-kitchen": "Kitchen", "room-study": "Study"}


def _vacuum_with_mapping(hass, mapping: object) -> str:
    entry = er.async_get(hass).async_get_or_create(
        "vacuum", DOMAIN, "serial", suggested_object_id="matic"
    )
    er.async_get(hass).async_update_entity_options(
        entry.entity_id, "vacuum", {"area_mapping": mapping}
    )
    return entry.entity_id


def _sensor(
    hass,
    unique_id: str,
    *,
    area_id: str | None = None,
    device_area_id: str | None = None,
    device_class: str | None = "occupancy",
    override_class: str | None = None,
    disabled: bool = False,
) -> str:
    entities = er.async_get(hass)
    device_id = None
    if device_area_id is not None:
        config_entry = MockConfigEntry(domain="test")
        config_entry.add_to_hass(hass)
        device = dr.async_get(hass).async_get_or_create(
            config_entry_id=config_entry.entry_id, identifiers={("test", unique_id)}
        )
        dr.async_get(hass).async_update_device(device.id, area_id=device_area_id)
        device_id = device.id
    entry = entities.async_get_or_create(
        "binary_sensor",
        "test",
        unique_id,
        original_device_class=device_class,
        device_id=device_id,
        disabled_by=er.RegistryEntryDisabler.USER if disabled else None,
    )
    if area_id is not None or override_class is not None:
        entities.async_update_entity(
            entry.entity_id, area_id=area_id, device_class=override_class
        )
    return entry.entity_id


async def _manager(hass, **plan: object) -> CleaningPlanManager:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "enabled": True,
            "run_behavior": "ordered",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": room.cleaning_mode,
                    "coverage_setting": room.coverage_setting,
                }
                for room in (KITCHEN, STUDY)
            ],
            "return_to_base": True,
            **plan,
        },
    )
    return manager


def test_plan_occupancy_sensors_keeps_only_binary_sensor_overrides() -> None:
    assert plan_occupancy_sensors({}) == {}
    assert plan_occupancy_sensors({"occupancy_sensors": ["binary_sensor.x"]}) == {}
    assert plan_occupancy_sensors(
        {
            "occupancy_sensors": {
                "room-kitchen": "binary_sensor.kitchen",
                "room-study": "sensor.study",
                "room-hall": 3,
            }
        }
    ) == {"room-kitchen": "binary_sensor.kitchen"}


async def test_room_area_ids_reads_the_vacuum_area_mapping(hass) -> None:
    assert room_area_ids(hass, "vacuum.missing") == {}
    entity_id = _vacuum_with_mapping(hass, "not a mapping")
    assert room_area_ids(hass, entity_id) == {}
    er.async_get(hass).async_update_entity_options(entity_id, "vacuum", None)
    assert room_area_ids(hass, entity_id) == {}
    _vacuum_with_mapping(
        hass,
        {
            "kitchen": ["room-kitchen"],
            "den": "room-study",
            "study": ["room-study"],
            "dup": ["room-kitchen"],
        },
    )
    assert room_area_ids(hass, entity_id) == {
        "room-kitchen": "kitchen",
        "room-study": "study",
    }


async def test_area_occupancy_sensors_include_device_area_and_presence(hass) -> None:
    kitchen = ar.async_get(hass).async_create("Kitchen")
    other = ar.async_get(hass).async_create("Other")
    direct = _sensor(hass, "direct", area_id=kitchen.id)
    inherited = _sensor(
        hass, "inherited", device_area_id=kitchen.id, device_class="presence"
    )
    overridden = _sensor(
        hass,
        "overridden",
        area_id=kitchen.id,
        device_class="door",
        override_class="occupancy",
    )
    _sensor(hass, "motion", area_id=kitchen.id, device_class="motion")
    _sensor(hass, "elsewhere", area_id=other.id)
    _sensor(hass, "unplaced")
    _sensor(hass, "disabled", area_id=kitchen.id, disabled=True)
    er.async_get(hass).async_get_or_create(
        "sensor", "test", "not-binary", original_device_class="occupancy"
    )

    assert area_occupancy_sensors(hass, kitchen.id) == sorted(
        [direct, inherited, overridden]
    )


async def test_occupancy_holds_reads_area_sensors_and_overrides(hass) -> None:
    kitchen = ar.async_get(hass).async_create("Kitchen")
    study = ar.async_get(hass).async_create("Study")
    vacuum = _vacuum_with_mapping(
        hass, {kitchen.id: ["room-kitchen"], study.id: ["room-study"]}
    )
    first = _sensor(hass, "kitchen-a", area_id=kitchen.id)
    second = _sensor(hass, "kitchen-b", area_id=kitchen.id)
    study_sensor = _sensor(hass, "study", area_id=study.id)
    hass.states.async_set(first, "unavailable")
    hass.states.async_set(second, "on")
    hass.states.async_set(study_sensor, "on")
    plan = {
        "occupancy_aware": True,
        "rooms": [
            {"room_id": "room-kitchen"},
            {"room_id": "room-study"},
            {"room_id": "room-hall"},
            "bad",
        ],
    }

    assert occupancy_holds(hass, vacuum, {}, ROOM_MAP) == {}
    # A room on the map that the plan does not clean is never held.
    assert occupancy_holds(
        hass, vacuum, {**plan, "rooms": [{"room_id": "room-study"}]}, ROOM_MAP
    ) == {"room-study": {"reason": "occupied", "sensor": study_sensor}}
    assert occupancy_holds(hass, vacuum, {**plan, "rooms": None}, ROOM_MAP) == {}
    assert occupancy_holds(hass, vacuum, plan, [*ROOM_MAP, "room-hall"]) == {
        "room-kitchen": {"reason": "occupied", "sensor": second},
        "room-study": {"reason": "occupied", "sensor": study_sensor},
    }

    hass.states.async_set("binary_sensor.study_override", "off")
    overridden = {
        **plan,
        "occupancy_sensors": {"room-study": "binary_sensor.study_override"},
    }
    assert occupancy_holds(hass, vacuum, overridden, ROOM_MAP) == {
        "room-kitchen": {"reason": "occupied", "sensor": second},
    }

    for state in ("off", "unknown", "unavailable"):
        hass.states.async_set(second, state)
        hass.states.async_set(study_sensor, state)
        assert occupancy_holds(hass, vacuum, plan, ROOM_MAP) == {}
    hass.states.async_remove(second)
    hass.states.async_remove(study_sensor)
    assert occupancy_holds(hass, vacuum, plan, ROOM_MAP) == {}


async def test_preview_leaves_held_rooms_out_and_keeps_their_rotation(hass) -> None:
    manager = await _manager(hass, run_behavior="intelligent")
    await manager.ledger.async_mark_started("serial", "home", STUDY)
    await manager.ledger.async_mark_resumed("serial", "home", STUDY)
    await manager.ledger.async_mark_completed("serial", "home", STUDY)
    rotation_before = manager.repository.robot("serial")["rotations"]["home"]

    held = {"room-kitchen": {"reason": "occupied", "sensor": "binary_sensor.k"}}
    preview = manager.catalog.preview("serial", ROOM_MAP, "home", held_rooms=held)

    assert [room["room_id"] for room in preview["rooms"]] == ["room-study"]
    assert [entry["room_id"] for entry in preview["entries"]] == ["room-study"]
    assert preview["held_rooms"] == [
        {
            "room_id": "room-kitchen",
            "name": "Kitchen",
            "reason": "occupied",
            "sensor": "binary_sensor.k",
        }
    ]
    assert manager.repository.robot("serial")["rotations"]["home"] == rotation_before
    # Once the room clears, it is first in line again under Smart Order.
    assert [
        room["room_id"]
        for room in manager.catalog.preview("serial", ROOM_MAP, "home")["rooms"]
    ] == ["room-kitchen", "room-study"]
    assert "held_rooms" not in manager.catalog.preview("serial", ROOM_MAP, "home")

    with pytest.raises(PlanRoomsHeldError):
        manager.catalog.preview(
            "serial",
            ROOM_MAP,
            "home",
            held_rooms={
                **held,
                "room-study": {"reason": "occupied", "sensor": "binary_sensor.s"},
            },
        )


async def test_begin_run_records_held_rooms(hass) -> None:
    manager = await _manager(hass)
    held = [
        {
            "room_id": "room-kitchen",
            "name": "Kitchen",
            "reason": "occupied",
            "sensor": "binary_sensor.k",
        }
    ]
    await manager.ledger.async_begin_run(
        "serial", "home", "run-1", 1, trigger="manual", service="run_plan"
    )
    assert "held_rooms" not in manager.repository.robot("serial")["last_run"]
    await manager.ledger.async_begin_run(
        "serial",
        "home",
        "run-2",
        1,
        trigger="manual",
        service="run_plan",
        held_rooms=held,
    )
    assert manager.repository.robot("serial")["last_run"]["held_rooms"] == held


def test_save_plan_schema_accepts_occupancy_settings() -> None:
    base = {"entity_id": ["vacuum.test"], "name": "Home", "rooms": [{"room": "K"}]}
    defaults = SAVE_PLAN_SCHEMA(base)
    assert defaults["occupancy_aware"] is False
    assert defaults["occupancy_sensors"] == {}
    configured = SAVE_PLAN_SCHEMA(
        {
            **base,
            "occupancy_aware": True,
            "occupancy_sensors": {"room-kitchen": "binary_sensor.kitchen"},
        }
    )
    assert configured["occupancy_sensors"] == {"room-kitchen": "binary_sensor.kitchen"}
    with pytest.raises(probatio.Invalid):
        SAVE_PLAN_SCHEMA({**base, "occupancy_sensors": {"room-kitchen": "light.k"}})


async def test_save_plan_stores_occupancy_settings_for_its_rooms(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "save_plan",
        SAVE_PLAN_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "name": "Home",
                "rooms": [{"room": "Kitchen"}],
                "occupancy_aware": True,
                "occupancy_sensors": {
                    "room-kitchen": "binary_sensor.kitchen",
                    "room-gone": "binary_sensor.gone",
                },
            }
        ),
    )
    context = ("vacuum.test", SimpleNamespace(), "serial", {"room-kitchen": "Kitchen"})
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=context,
    ):
        result = await _registered_handler(services, "save_plan")(call)

    assert result["plan"]["occupancy_aware"] is True
    assert result["plan"]["occupancy_sensors"] == {
        "room-kitchen": "binary_sensor.kitchen"
    }


def _floor_plan():
    floor_plan = _area_floor_plan()
    boundary = floor_plan.rooms[0].boundary
    return replace(
        floor_plan,
        rooms=(
            Room("room-kitchen", "Kitchen", "protocol-kitchen", b"kitchen", boundary),
            Room("room-study", "Study", "protocol-study", b"study", boundary),
        ),
    )


async def _plan_services(hass, manager):
    services = await _registered_services(hass, manager)
    floor_plan = _floor_plan()
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(
                data=SimpleNamespace(floor_plan=floor_plan),
                async_request_refresh=AsyncMock(),
                async_confirm_room_completed=MagicMock(),
            ),
            client=SimpleNamespace(
                async_get_active_cleaning_session_state=AsyncMock(),
                async_get_cleaning_session_records=AsyncMock(),
                async_get_cleaning_session_identity=AsyncMock(),
                async_send_user_command=AsyncMock(),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    return services, ("vacuum.matic", entry, "serial", ROOM_MAP)


def _plan_call(hass, service: str) -> ServiceCall:
    return ServiceCall(
        hass,
        DOMAIN,
        service,
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.matic"], "plan": "Home"}),
    )


async def test_preview_and_run_hold_occupied_rooms(hass) -> None:
    manager = await _manager(hass, occupancy_aware=True)
    services, context = await _plan_services(hass, manager)
    holds = {"room-kitchen": {"reason": "occupied", "sensor": "binary_sensor.k"}}
    read_holds = MagicMock(return_value=holds)
    validations = []

    async def execute(*args, **kwargs) -> None:
        # The room clearing while the run waits does not change the run.
        read_holds.return_value = {}
        kwargs["validate_prepared_run"]()
        validations.append(args[5])

    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_plans.occupancy_holds", read_holds
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(side_effect=execute),
        ) as run,
    ):
        preview = await _registered_handler(services, "preview_plan")(
            _plan_call(hass, "preview_plan")
        )
        read_holds.return_value = holds
        await _registered_handler(services, "run_selected_plan")(
            _plan_call(hass, "run_selected_plan")
        )

    assert [room["room_id"] for room in preview["rooms"]] == ["room-study"]
    assert preview["held_rooms"][0]["room_id"] == "room-kitchen"
    assert validations == [[STUDY]]
    assert run.await_args.kwargs["held_rooms"] == preview["held_rooms"]
    assert read_holds.call_args.args[1:3] == (
        "vacuum.matic",
        manager.catalog.plan("serial", "home"),
    )


async def test_run_refuses_when_every_room_is_held(hass) -> None:
    manager = await _manager(hass, occupancy_aware=True)
    services, context = await _plan_services(hass, manager)
    holds = {
        room_id: {"reason": "occupied", "sensor": "binary_sensor.x"}
        for room_id in ROOM_MAP
    }
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch(
            "custom_components.matic_robot.service_plans.occupancy_holds",
            return_value=holds,
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(),
        ) as run,
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "run_selected_plan")(
            _plan_call(hass, "run_selected_plan")
        )
    assert raised.value.translation_key == "plan_rooms_held"
    run.assert_not_awaited()


async def test_preview_of_unknown_plan_reads_no_occupancy(hass) -> None:
    manager = await _manager(hass, occupancy_aware=True)
    services, context = await _plan_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "preview_plan",
        SAVED_PLAN_SERVICE_SCHEMA({"entity_id": ["vacuum.matic"], "plan": "Nope"}),
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=context,
        ),
        patch("custom_components.matic_robot.service_plans.occupancy_holds") as read,
        pytest.raises(ServiceValidationError) as raised,
    ):
        await _registered_handler(services, "preview_plan")(call)
    assert raised.value.translation_key == "unknown_plan"
    read.assert_not_called()


async def test_executor_fires_room_held_with_the_run_id(hass) -> None:
    manager = await _manager(hass)
    events = []
    hass.bus.async_listen(f"{DOMAIN}_room_held", events.append)
    held = [
        {
            "room_id": "room-kitchen",
            "name": "Kitchen",
            "reason": "occupied",
            "sensor": "binary_sensor.k",
        }
    ]
    call = ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {
            "plan_id": "home",
            "start_timeout": 120,
            "completion_timeout": 600,
            "return_to_base": False,
        },
    )
    with (
        patch(
            "custom_components.matic_robot.managed_leg._async_run_leg",
            AsyncMock(side_effect=RuntimeError("stop after admission")),
        ),
        pytest.raises(RuntimeError),
    ):
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [STUDY],
            held_rooms=held,
        )
    await hass.async_block_till_done()

    assert [event.data for event in events] == [
        {
            "entity_id": "vacuum.matic",
            "plan_id": "home",
            "room_id": "room-kitchen",
            "room": "Kitchen",
            "run_id": events[0].data["run_id"],
            "provenance": "external_unknown",
            "reason_code": "occupied",
            "sensor": "binary_sensor.k",
        }
    ]
    assert manager.repository.robot("serial")["last_run"]["held_rooms"] == held


async def test_entry_vacuum_entity_id_finds_the_entry_vacuum(hass) -> None:
    config_entry = MockConfigEntry(domain=DOMAIN)
    config_entry.add_to_hass(hass)
    assert entry_vacuum_entity_id(hass, config_entry.entry_id) is None
    entities = er.async_get(hass)
    entities.async_get_or_create(
        "camera", DOMAIN, "serial-camera", config_entry=config_entry
    )
    vacuum = entities.async_get_or_create(
        "vacuum", DOMAIN, "serial", config_entry=config_entry
    )
    assert entry_vacuum_entity_id(hass, config_entry.entry_id) == vacuum.entity_id


def _workspace_runtime(plan: dict[str, object]):
    runtime = _scene_runtime()
    runtime.cleaning_plans.catalog.plans.return_value = {
        "weekday": {
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
            "room_order": ["room-1"],
            **plan,
        }
    }
    runtime.slam_map.floor_plan_is_current.return_value = True
    return runtime


async def _workspace_plan(runtime) -> dict[str, object]:
    response = await MaticPlansView().get(
        _scene_request(_scene_hass(_scene_entry(runtime))), "entry"
    )
    return json.loads(response.body)["plans"][0]


async def test_plan_workspace_projects_occupancy_settings_and_held_rooms() -> None:
    held = {"room-2": {"reason": "occupied", "sensor": "binary_sensor.study"}}
    runtime = _workspace_runtime(
        {
            "occupancy_aware": True,
            "occupancy_sensors": {"room-2": "binary_sensor.study", "room-3": "x"},
        }
    )
    runtime.cleaning_plans.catalog.preview.side_effect = None
    runtime.cleaning_plans.catalog.preview.return_value = {
        "rooms": [
            {
                "room_id": "room-1",
                "name": "Kitchen",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {},
            }
        ],
        "held_rooms": [{"room_id": "room-2", "name": "Study", **held["room-2"]}],
    }
    with (
        patch(
            "custom_components.matic_robot.plan_views.entry_vacuum_entity_id",
            return_value="vacuum.matic",
        ),
        patch(
            "custom_components.matic_robot.plan_views.occupancy_holds",
            return_value=held,
        ) as holds,
    ):
        plan = await _workspace_plan(runtime)

    assert plan["occupancy_aware"] is True
    assert plan["occupancy_sensors"] == {"room-2": "binary_sensor.study"}
    assert plan["next_run_preview"]["held_rooms"] == [
        {
            "room_id": "room-2",
            "name": "Study",
            "reason": "occupied",
            "sensor": "binary_sensor.study",
        }
    ]
    assert holds.call_args.args[1] == "vacuum.matic"
    assert runtime.cleaning_plans.catalog.preview.call_args.kwargs["held_rooms"] == held


async def test_plan_workspace_reports_every_room_held() -> None:
    held = {"room-1": {"reason": "occupied", "sensor": "binary_sensor.kitchen"}}
    runtime = _workspace_runtime({"occupancy_aware": True})
    runtime.cleaning_plans.catalog.preview.side_effect = PlanRoomsHeldError("all held")
    with (
        patch(
            "custom_components.matic_robot.plan_views.entry_vacuum_entity_id",
            return_value="vacuum.matic",
        ),
        patch(
            "custom_components.matic_robot.plan_views.occupancy_holds",
            return_value=held,
        ),
    ):
        plan = await _workspace_plan(runtime)

    assert plan["next_run_preview"] == {
        "rooms": [],
        "mission_boundaries": [],
        "blocker": "plan_rooms_held",
        "held_rooms": [
            {
                "room_id": "room-1",
                "name": "Kitchen",
                "reason": "occupied",
                "sensor": "binary_sensor.kitchen",
            }
        ],
    }


async def test_plan_workspace_reads_no_occupancy_without_a_vacuum() -> None:
    runtime = _workspace_runtime({"occupancy_aware": True})
    runtime.cleaning_plans.catalog.preview.side_effect = None
    runtime.cleaning_plans.catalog.preview.return_value = {
        "rooms": [
            {
                "room_id": "room-1",
                "name": "Kitchen",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {},
            }
        ]
    }
    with (
        patch(
            "custom_components.matic_robot.plan_views.entry_vacuum_entity_id",
            return_value=None,
        ),
        patch("custom_components.matic_robot.plan_views.occupancy_holds") as holds,
    ):
        plan = await _workspace_plan(runtime)

    holds.assert_not_called()
    assert "held_rooms" not in plan["next_run_preview"]
    assert "held_rooms" not in runtime.cleaning_plans.catalog.preview.call_args.kwargs
