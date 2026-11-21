"""Custom areas: storage, binding upgrades and area legs."""

import asyncio
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError

import custom_components.matic_robot.area_geometry as area_geometry_module
import custom_components.matic_robot.plan_catalog as plan_catalog_module
import custom_components.matic_robot.plan_state as plan_state_module
from custom_components.matic_robot.area_binding import (
    area_binding_status,
    binding_for_area,
)
from custom_components.matic_robot.area_binding_formats import (
    AREA_SCHEMA_VERSION,
    MAP_BINDING_VERSION,
)
from custom_components.matic_robot.area_binding_geometry import floor_identity
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.managed_area import _async_run_area_leg
from custom_components.matic_robot.plan_model import (
    AreaBindingUpgradeResult,
    AreaLeg,
    PlanStopDecision,
    plan_area_fingerprint,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from tests import legacy_bindings
from tests.plans.fakes import memory_manager
from tests.session_fakes import FakeRobot


async def test_custom_areas_round_trip_by_id_and_name_without_snapshot(hass) -> None:
    manager = memory_manager(hass)
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (Room("room", "Room", "protocol", b"room", ((0, 0), (2, 0), (0, 2))),),
    )
    saved = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Litter box",
        "circles": [{"x": 0.5, "y": 0.5, "radius": 0.35}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
    }
    saved["map_binding"] = binding_for_area(floor_plan, saved["circles"])

    await manager.catalog.async_save_area("serial", "litter_box", saved)

    assert manager.catalog.area("serial", "litter_box") == {"id": "litter_box", **saved}
    assert manager.catalog.area("serial", "LITTER BOX") == {"id": "litter_box", **saved}
    assert manager.catalog.area("serial") == {"id": "litter_box", **saved}
    assert manager.catalog.areas("serial") == {"litter_box": saved}
    assert "areas" not in manager.history.snapshot("serial")
    assert manager.history.snapshot("serial")["selected_area_name"] == "Litter box"
    await manager.catalog.async_select_area("serial", "litter_box")
    with pytest.raises(KeyError):
        await manager.catalog.async_select_area("serial", "missing")
    with pytest.raises(KeyError):
        manager.catalog.area("serial", "missing")

    await manager.catalog.async_delete_area("serial", "litter_box")
    assert manager.catalog.areas("serial") == {}


async def test_saved_area_frame_point_limit_is_aggregate_and_replacement_safe(
    hass,
) -> None:
    manager = memory_manager(hass)
    floor = FloorPlan(
        42,
        "partition",
        b"partition",
        (
            Room(
                "room",
                "Room",
                "protocol",
                b"room",
                ((0, 0), (10, 0), (10, 10), (0, 10)),
            ),
        ),
    )
    circles = [{"x": 5.0, "y": 5.0, "radius": 0.2}]
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Area",
        "circles": circles,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding_for_area(floor, circles),
    }
    with patch.object(
        plan_catalog_module, "_MAX_PERSISTED_ROOM_FRAME_POINTS_PER_ROBOT", 8
    ):
        await manager.catalog.async_save_area("serial", "first", area)
        await manager.catalog.async_save_area("serial", "second", area)
        before = manager.catalog.areas("serial")
        with pytest.raises(ValueError, match="aggregate room frame"):
            await manager.catalog.async_save_area("serial", "third", area)
        assert manager.catalog.areas("serial") == before
        assert manager.repository.store.async_save.await_count == 2
        # Replacing an existing area subtracts its previous snapshot first.
        await manager.catalog.async_save_area("serial", "first", area)
    assert manager.repository.store.async_save.await_count == 3


async def test_old_area_bindings_upgrade_automatically(hass) -> None:
    manager = memory_manager(hass)
    listener = MagicMock()
    manager.repository.async_add_listener("serial", listener)
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (Room("room", "Room", "protocol", b"room", ((0, 0), (2, 0), (0, 2))),),
    )
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.2}]
    robot = manager.repository.robot("serial")
    robot["areas"] = {
        "current": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": legacy_bindings.v4(floor_plan, circles),
        },
        "already_scoped": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": binding_for_area(floor_plan, circles),
        },
        "anchored": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": legacy_bindings.v3(floor_plan, circles),
        },
        "different_mission": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": legacy_bindings.v4(
                replace(floor_plan, mission_id=43), circles
            ),
        },
        "missing_circles": {
            "schema_version": AREA_SCHEMA_VERSION,
            "map_binding": legacy_bindings.v4(floor_plan, circles),
        },
        "invalid_circles": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": [{}],
            "map_binding": legacy_bindings.v4(floor_plan, circles),
        },
        "before_0_5": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": {"version": 1, **floor_identity(floor_plan)},
        },
        "unbound": {"schema_version": 0, "circles": circles},
        "list_version": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": {"version": []},
        },
        "object_version": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": {"version": {}},
        },
        "corrupt": "not-an-area",
    }
    current = {"fingerprint": plan_area_fingerprint(robot["areas"]["current"])}
    robot["area_history"] = {"current": dict(current)}
    robot["rotations"] = {
        "plan": {"areas": {"current": dict(current), "anchored": {}}},
        "rooms_only": {},
    }

    # The other floor's area stays as saved, so a later floor retries it.
    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", floor_plan
    ) == AreaBindingUpgradeResult(2, True)
    # Conversion keeps the geometry, so the area's run history follows it.
    converted = plan_area_fingerprint(robot["areas"]["current"])
    assert converted != current["fingerprint"]
    assert robot["area_history"]["current"]["fingerprint"] == converted
    assert robot["rotations"]["plan"]["areas"] == {
        "current": {"fingerprint": converted},
        "anchored": {},
    }
    assert robot["areas"]["current"]["map_binding"]["version"] == MAP_BINDING_VERSION
    assert robot["areas"]["anchored"]["map_binding"] == binding_for_area(
        floor_plan, circles
    )
    assert robot["areas"]["different_mission"]["map_binding"]["version"] == 4
    # A record older than 0.5 has no exact form and is left to be redrawn.
    assert robot["areas"]["before_0_5"]["map_binding"]["version"] == 1
    assert robot["areas"]["list_version"]["map_binding"]["version"] == []
    assert robot["areas"]["object_version"]["map_binding"]["version"] == {}
    manager.repository.store.async_save.assert_awaited_once()
    listener.assert_called_once()

    manager.repository.store.async_save.reset_mock()
    listener.reset_mock()
    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", floor_plan
    ) == AreaBindingUpgradeResult(0, True)
    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", None
    ) == AreaBindingUpgradeResult(0, True)
    manager.repository.store.async_save.assert_not_awaited()
    listener.assert_not_called()


async def test_area_binding_upgrade_shares_one_geometry_budget(hass) -> None:
    manager = memory_manager(hass)
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            Room("left", "Left", "left", b"left", ((0, 0), (2, 0), (0, 2))),
            Room("right", "Right", "right", b"right", ((3, 0), (5, 0), (3, 2))),
        ),
    )
    robot = manager.repository.robot("serial")
    robot["areas"] = {}
    for area_id, circle in (
        ("left", {"x": 0.5, "y": 0.5, "radius": 0.2}),
        ("right", {"x": 3.5, "y": 0.5, "radius": 0.2}),
    ):
        circles = [circle]
        robot["areas"][area_id] = {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": legacy_bindings.v4(floor_plan, circles),
        }

    original_index_factory = plan_catalog_module.binding_geometry._room_geometry_index
    statuses = []

    def check_status(*args, **kwargs):
        status = area_binding_status(*args, **kwargs)
        statuses.append(status)
        return status

    with (
        patch.object(
            plan_catalog_module.binding_geometry,
            "_room_geometry_index",
            side_effect=original_index_factory,
        ) as index_factory,
        patch.object(
            plan_catalog_module, "area_binding_status", side_effect=check_status
        ) as status_check,
        patch.object(
            plan_catalog_module, "binding_for_area", wraps=binding_for_area
        ) as bind_area,
    ):
        result = await manager.catalog.async_upgrade_area_bindings("serial", floor_plan)

    assert result == AreaBindingUpgradeResult(2, False), statuses

    assert index_factory.call_count == 1
    geometry_indexes = [
        call.kwargs["room_geometry"]
        for call in (*status_check.call_args_list, *bind_area.call_args_list)
    ]
    assert len(geometry_indexes) == 4
    assert all(index is geometry_indexes[0] for index in geometry_indexes)


async def test_area_binding_upgrade_stays_pending_on_rebuild_budget_exhaustion(
    hass,
) -> None:
    manager = memory_manager(hass)
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (Room("room", "Room", "room", b"room", ((0, 0), (2, 0), (0, 2))),),
    )
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.2}]
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": circles,
        "map_binding": legacy_bindings.v4(floor_plan, circles),
    }
    manager.repository.robot("serial")["areas"] = {"old": area}
    plan_state_module.parse_robot(manager.repository.robot("serial"))

    with patch.object(
        plan_catalog_module,
        "binding_for_area",
        side_effect=area_geometry_module.GeometryTooComplex(
            "shared geometry budget exhausted"
        ),
    ) as rebuild:
        result = await manager.catalog.async_upgrade_area_bindings("serial", floor_plan)

    assert result == AreaBindingUpgradeResult(0, True)
    assert area["map_binding"]["version"] == 4
    rebuild.assert_called_once()
    manager.repository.store.async_save.assert_not_awaited()


async def test_area_binding_upgrade_stays_pending_for_partial_map(hass) -> None:
    manager = memory_manager(hass)
    first_room = Room(
        "first",
        "First",
        "first",
        b"first",
        ((0, 0), (1, 0), (0, 1)),
    )
    second_room = Room(
        "second",
        "Second",
        "second",
        b"second",
        ((2, 0), (3, 0), (2, 1)),
    )
    complete = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (first_room, second_room),
    )
    partial = replace(complete, rooms=(first_room,))
    circles = [{"x": 2.2, "y": 0.2, "radius": 0.1}]
    manager.repository.robot("serial")["areas"] = {
        "partial": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": legacy_bindings.v4(complete, circles),
        }
    }
    plan_state_module.parse_robot(manager.repository.robot("serial"))

    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", partial
    ) == AreaBindingUpgradeResult(0, True)
    manager.repository.store.async_save.assert_not_awaited()

    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", complete
    ) == AreaBindingUpgradeResult(1, False)
    manager.repository.store.async_save.assert_awaited_once()


async def test_area_binding_upgrade_ignores_malformed_area_record(hass) -> None:
    manager = memory_manager(hass)
    manager.repository.robot = MagicMock(
        return_value={"areas": {"corrupt": "not-an-area"}}
    )

    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", None
    ) == AreaBindingUpgradeResult(0, False)
    manager.repository.store.async_save.assert_not_awaited()


async def test_area_binding_upgrade_ignores_unknown_binding_version(hass) -> None:
    manager = memory_manager(hass)
    manager.repository.robot("serial")["areas"] = {
        "future": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": [],
            "map_binding": {"version": 99},
        }
    }
    plan_state_module.parse_robot(manager.repository.robot("serial"))

    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", None
    ) == AreaBindingUpgradeResult(0, False)
    manager.repository.store.async_save.assert_not_awaited()


async def test_dense_room_anchored_area_upgrade_is_a_noop(hass) -> None:
    manager = memory_manager(hass)
    base = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (Room("room", "Room", "protocol", b"room", ((0, 0), (1, 0), (0, 1))),),
    )
    boundary = [
        *((index / 75, 0.0) for index in range(75)),
        *((1.0, index / 75) for index in range(75)),
        *((1.0 - index / 75, 1.0) for index in range(75)),
        *((0.0, 1.0 - index / 75) for index in range(75)),
    ]
    floor_plan = replace(
        base,
        rooms=(replace(base.rooms[0], boundary=tuple(boundary)),),
    )
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.5}]
    binding = binding_for_area(floor_plan, circles)
    assert "sha256" in binding["local"]
    assert "frame" in binding
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": circles,
        "map_binding": binding,
    }
    manager.repository.robot("serial")["areas"] = {"dense": area}
    plan_state_module.parse_robot(manager.repository.robot("serial"))

    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", floor_plan
    ) == AreaBindingUpgradeResult(0, False)
    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", floor_plan
    ) == AreaBindingUpgradeResult(0, False)
    assert area["map_binding"] == binding
    manager.repository.store.async_save.assert_not_awaited()


@pytest.mark.parametrize("version", ["v4", "v7"])
async def test_current_area_binding_without_frames_upgrades_to_room_anchored(
    hass, version
) -> None:
    manager = memory_manager(hass)
    base = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (Room("room", "Room", "protocol", b"room", ((0, 0), (1, 0), (0, 1))),),
    )
    boundary = [
        *((index / 75, 0.0) for index in range(75)),
        *((1.0, index / 75) for index in range(75)),
        *((1.0 - index / 75, 1.0) for index in range(75)),
        *((0.0, 1.0 - index / 75) for index in range(75)),
    ]
    floor_plan = replace(
        base,
        rooms=(replace(base.rooms[0], boundary=tuple(boundary)),),
    )
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.5}]
    anchored_binding = binding_for_area(floor_plan, circles)
    binding = (
        legacy_bindings.v4(floor_plan, circles)
        if version == "v4"
        else {key: value for key, value in anchored_binding.items() if key != "frame"}
    )
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": circles,
        "map_binding": binding,
    }
    manager.repository.robot("serial")["areas"] = {"dense": area}

    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", floor_plan
    ) == AreaBindingUpgradeResult(1, False)
    assert area["map_binding"] == anchored_binding
    manager.repository.store.async_save.assert_awaited_once()

    # Where room frames still don't fit, rebinding gives the same record.
    area["map_binding"] = binding = binding_for_area(floor_plan, circles)
    del binding["frame"]
    with patch(
        "custom_components.matic_robot.area_binding_geometry._translation_room_anchors",
        return_value=[],
    ):
        assert await manager.catalog.async_upgrade_area_bindings(
            "serial", floor_plan
        ) == AreaBindingUpgradeResult(0, False)
    assert area["map_binding"] == binding


_AREA = AreaLeg("rug", "Rug", "vacuum", "quick", "f" * 64)


async def test_area_history_baseline_failure_never_stops_or_credits(hass) -> None:
    robot = FakeRobot()
    manager = memory_manager(hass)
    await manager.ledger.async_begin_run(
        "serial", "away", "run", 0, trigger="user", service="run_selected_plan"
    )
    motion_token = manager.control.begin_managed_motion("serial")
    sent = []

    async def send_command(command) -> None:
        sent.append(command)

    robot.on_start = send_command
    stop = AsyncMock()
    native_identity = MagicMock()
    call = ServiceCall(
        hass,
        "matic_robot",
        "run_selected_plan",
        {
            "plan_id": "away",
            "start_timeout": 30,
            "completion_timeout": 60,
            "return_to_base": True,
        },
    )

    with pytest.raises(HomeAssistantError, match="cleaning history could not be read"):
        await _async_run_area_leg(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            _AREA,
            robot.port(
                session_history=AsyncMock(side_effect=MaticError("offline")),
                session_identity=AsyncMock(return_value=b""),
            ),
            asyncio.Event(),
            motion_token,
            stop,
            prepared_dispatch=None,
            finish_room_event=manager.control.finish_room_event("serial"),
            floor_is_current=None,
            floor_token=None,
            expected_dispatch_identity=None,
            # Only a handoff reads history before a tracked start.
            expected_dispatch_history=frozenset(),
            expected_dispatch_revision=None,
            on_native_identity=native_identity,
            run_id="run",
            checkpoint_dispatch=None,
            provenance="user",
            settle_history=False,
        )

    assert sent == []
    stop.assert_not_awaited()
    native_identity.assert_not_called()
    assert manager.control.managed_motion_is_current("serial", motion_token)
    assert manager.repository.robot("serial")["rotations"] == {}
    assert manager.history.snapshot("serial")["native_reconciliation_pending"] is False


async def test_area_start_publishes_the_area_without_touching_room_records(
    hass,
) -> None:
    manager = memory_manager(hass)
    await manager.catalog.async_save_plan(
        "serial", "away", {"name": "Away", "rooms": []}, select=False
    )

    # Nothing is published without the run that owns the area.
    await manager.ledger.async_mark_area_started("serial", "away", _AREA, run_id="run")
    assert manager.history.snapshot("serial")["active_plan"] is None
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "run",
        0,
        trigger="user",
        service="run_selected_plan",
        finish_current_room=True,
        finish_current_room_threshold=40,
    )
    await manager.ledger.async_mark_area_started(
        "serial", "away", _AREA, run_id="other"
    )
    assert manager.history.snapshot("serial")["active_plan"] is None

    await manager.ledger.async_mark_area_started("serial", "away", _AREA, run_id="run")
    active = manager.repository.robot("serial")["active_plan"]
    assert active == {
        "plan_id": "away",
        "plan_name": "Away",
        "area_id": "rug",
        "area": "Rug",
        "started": active["started"],
        "status": "running",
        "run_id": "run",
        "finish_current_room": True,
        "finish_current_room_threshold": 40,
    }
    assert "room_id" not in active
    assert manager.repository.robot("serial")["rotations"] == {}

    # Rejoining the same area keeps its start; the next area starts anew.
    manager.repository.robot("serial")["active_plan"]["started"] = (
        "2026-01-01T00:00:00+00:00"
    )
    await manager.ledger.async_mark_area_started("serial", "away", _AREA, run_id="run")
    assert manager.history.snapshot("serial")["active_plan"]["started"] == (
        "2026-01-01T00:00:00+00:00"
    )
    mat = AreaLeg("mat", "Mat", "vacuum", "quick", "f" * 64)
    await manager.ledger.async_mark_area_started("serial", "away", mat, run_id="run")
    assert manager.history.snapshot("serial")["active_plan"]["started"] != (
        "2026-01-01T00:00:00+00:00"
    )

    # Only the same run's same area can clear it.
    await manager.ledger.async_mark_area_finished("serial", _AREA, run_id="run")
    await manager.ledger.async_mark_area_finished("serial", mat, run_id="other")
    assert manager.history.snapshot("serial")["active_plan"]["area_id"] == "mat"
    await manager.ledger.async_mark_area_finished("serial", mat, run_id="run")
    assert manager.history.snapshot("serial")["active_plan"] is None
    await manager.ledger.async_mark_area_finished("serial", mat, run_id="run")
    assert manager.history.snapshot("serial")["active_plan"] is None


async def test_area_start_without_frozen_stop_policy_omits_it(hass) -> None:
    manager = memory_manager(hass)
    await manager.ledger.async_begin_run(
        "serial", "away", "run", 0, trigger="user", service="run_selected_plan"
    )
    manager.repository.robot("serial")["last_run"].pop("finish_current_room")
    await manager.ledger.async_mark_area_started("serial", "away", _AREA, run_id="run")
    assert (
        "finish_current_room" not in manager.history.snapshot("serial")["active_plan"]
    )


@pytest.mark.parametrize("recoverable", [False, True])
async def test_restart_keeps_an_active_area_without_inventing_a_room(
    hass, recoverable
) -> None:
    manager = memory_manager(hass)
    await manager.ledger.async_begin_run(
        "serial", "away", "run", 0, trigger="user", service="run_selected_plan"
    )
    await manager.ledger.async_mark_area_started("serial", "away", _AREA, run_id="run")
    if recoverable:
        await manager.recovery.async_set_recovery_checkpoint(
            "serial", "run", {"version": 1, "rooms": [], "phase": "accepted"}
        )
    recovering = CleaningPlanManager(hass)
    recovering.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=deepcopy(manager.repository.data)),
        async_save=AsyncMock(),
    )

    await recovering.async_load()

    robot = recovering.repository.robot("serial")
    if recoverable:
        assert robot["active_plan"]["area_id"] == "rug"
        assert robot["active_plan"]["status"] == "recovering"
    else:
        assert robot["active_plan"] is None
        assert robot["last_interrupted_plan"]["area"] == "Rug"
    assert robot["rotations"] == {}


@pytest.mark.parametrize("finish_current_room", [False, True])
async def test_stop_during_an_area_finishes_the_area_or_stops_now(
    hass, finish_current_room
) -> None:
    manager = memory_manager(hass)
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "run",
        0,
        trigger="user",
        service="run_selected_plan",
        finish_current_room=finish_current_room,
        finish_current_room_threshold=30,
    )
    await manager.ledger.async_mark_area_started("serial", "away", _AREA, run_id="run")
    cancel = manager.control.prepare_run("serial")
    lock = manager.control.lock("serial")
    await lock.acquire()
    try:
        decision = manager.control.request_stop("serial")
    finally:
        lock.release()

    if finish_current_room:
        # No duration history exists for an area: finish it, then stop.
        assert decision == PlanStopDecision("after_room", None, 30)
        assert manager.control.finish_room_event("serial").is_set()
        assert not cancel.is_set()
    else:
        assert decision == PlanStopDecision("immediate")
        assert cancel.is_set()
