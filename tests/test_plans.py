"""Durable intelligent cleaning behavior."""

import asyncio
from dataclasses import replace
from datetime import UTC, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.area_binding import (
    AREA_SCHEMA_VERSION,
    HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    SCOPED_MAP_BINDING_VERSION,
    _hash_only_area_geometry_fingerprint,
    binding_for_area,
    binding_for_floor_plan,
)
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.plans import (
    MAX_SAVED_PLANS_PER_ROBOT,
    OEM_STOP_RECONCILIATION_SECONDS,
    PLAN_FLOOR_TOKEN,
    PLAN_MOTION_TOKEN,
    AreaBindingUpgradeResult,
    CleaningPlanManager,
    CleaningRoom,
    ManagedMotionReplacedError,
    PlanStopDecision,
    SavedPlanLimitError,
    _compatible_duration_history,
    _duration_history,
    _elapsed_seconds,
    _estimated_progress,
    _expected_duration,
    _latest_timestamp,
    _reconcile_pending_native_history,
    _record_native_completion,
    _stored_count,
    _validated_native_reconciliation,
    leg_groups,
    resolve_room_reference,
    resolve_rooms,
)
from custom_components.matic_robot.services import (
    SESSION_HISTORY_ATTEMPTS,
    PlanCancelledError,
    RoomInterruptedError,
    RoomRunOutcome,
    RoomTakenOverError,
    _async_active_session_state,
    _async_dispatch_leg_command,
    _async_execute_rooms,
    _async_run_leg,
    _async_run_room,
    _async_session_history_baseline,
    _async_verify_leg_completion,
    _async_verify_room_completion,
    _async_wait_for_active_session_resolution,
    _async_wait_for_room_outcome,
    _async_wait_for_vacuum_state,
    _entry_for_entity,
    _PreparedRoomDispatch,
)


def _heavy_room(name: str, room_id: str) -> CleaningRoom:
    return CleaningRoom(
        room_id=room_id,
        name=name,
        cleaning_mode="vacuum_and_mop",
        coverage_setting="heavy_duty",
    )


def _room(name: str, room_id: str) -> CleaningRoom:
    return CleaningRoom(
        room_id=room_id,
        name=name,
        cleaning_mode="vacuum_and_mop",
        coverage_setting="standard",
    )


def _call(hass, *, return_to_base: bool = False) -> ServiceCall:
    return ServiceCall(
        hass,
        DOMAIN,
        "intelligent_clean",
        {
            "plan_id": "away",
            "start_timeout": 120,
            "completion_timeout": 21600,
            "return_to_base": return_to_base,
        },
    )


def test_leg_groups_split_only_on_settings_changes() -> None:
    quick_a = _room("Living Room", "room-a")
    quick_b = _room("Dining Room", "room-b")
    standard = CleaningRoom(
        room_id="room-c",
        name="Master Bedroom",
        cleaning_mode="vacuum",
        coverage_setting="standard",
    )
    quick_c = _room("Guest Room", "room-d")

    assert leg_groups([quick_a, quick_b, standard, quick_c]) == [
        [quick_a, quick_b],
        [standard],
        [quick_c],
    ]
    assert leg_groups([quick_a]) == [[quick_a]]
    assert leg_groups([]) == []


async def test_leg_dispatch_sends_one_ordered_multi_room_mission(hass) -> None:
    captured = []

    async def send_command(call) -> None:
        captured.append(call.data)

    hass.services.async_register("vacuum", "send_command", send_command)
    rooms = [_room("Kitchen", "room-kitchen"), _room("Office", "room-office")]

    dispatch = await _async_dispatch_leg_command(
        hass,
        _call(hass),
        "vacuum.matic",
        rooms,
        7,
        None,
        floor_token="a" * 64,
    )

    assert dispatch.rooms == tuple(rooms)
    assert captured[0]["command"] == "clean_rooms"
    params = captured[0]["params"]
    assert params["rooms"] == ["room-kitchen", "room-office"]
    assert params["ordered"] is True
    assert params["cleaning_mode"] == "vacuum_and_mop"
    assert params["coverage"] == "standard"
    assert params[PLAN_MOTION_TOKEN] == 7
    assert params[PLAN_FLOOR_TOKEN] == "a" * 64


async def test_leg_dispatch_keeps_single_room_unordered(hass) -> None:
    captured = []

    async def send_command(call) -> None:
        captured.append(call.data)

    hass.services.async_register("vacuum", "send_command", send_command)

    dispatch = await _async_dispatch_leg_command(
        hass,
        _call(hass),
        "vacuum.matic",
        [_room("Kitchen", "room-kitchen")],
        None,
        None,
    )

    assert dispatch.rooms == (_room("Kitchen", "room-kitchen"),)
    params = captured[0]["params"]
    assert params["rooms"] == ["room-kitchen"]
    assert params["ordered"] is False
    assert PLAN_MOTION_TOKEN not in params
    assert PLAN_FLOOR_TOKEN not in params


async def test_mark_completed_accepts_native_evidence(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    await manager.async_mark_started("serial", "plan", room)

    await manager.async_mark_completed(
        "serial",
        "plan",
        room,
        completed_at="2026-08-20T04:16:13+00:00",
        duration_seconds=57,
    )

    snapshot = manager.snapshot("serial")
    record = snapshot["plan_history"]["plan"]["rooms"]["room-kitchen"]
    assert record["last_completed"] == "2026-08-20T04:16:13+00:00"
    assert record["last_duration_seconds"] == 57
    assert record["average_duration_seconds"] == 57
    by_room = snapshot["last_completed_by_room"]["room-kitchen"]
    assert by_room["at"] == "2026-08-20T04:16:13+00:00"
    assert snapshot["active_plan"] is None


def test_rooms_resolve_live_names_ids_and_individual_settings() -> None:
    rooms = resolve_rooms(
        [
            {
                "room": "Kitchen",
                "cleaning_mode": "vacuum_and_mop",
                "coverage_setting": "heavy_duty",
            },
            {
                "room_id": "room-study",
                "cleaning_mode": "vacuum",
                "coverage_setting": "quick",
            },
        ],
        {
            "room-kitchen": "Kitchen",
            "room-study": "Study",
            "room-omitted": "Garage",
        },
    )

    assert rooms == [
        CleaningRoom("room-kitchen", "Kitchen", "vacuum_and_mop", "heavy_duty"),
        CleaningRoom("room-study", "Study", "vacuum", "quick"),
    ]


@pytest.mark.parametrize("identifier", ["Unknown room", "Kitchen"])
def test_rooms_reject_unknown_or_duplicate_mapped_rooms(identifier) -> None:
    raw = [
        {
            "room": "Kitchen",
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
        },
        {
            "room": identifier,
            "cleaning_mode": "mop",
            "coverage_setting": "standard",
        },
    ]
    with pytest.raises(ValueError):
        resolve_rooms(raw, {"room-kitchen": "Kitchen"})


def test_rooms_fail_closed_for_ambiguous_live_names_but_keep_stable_ids() -> None:
    room_map = {
        "room-bedroom-east": "Bedroom",
        "room-bedroom-west": "BEDROOM",
    }
    settings = {
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
    }

    with pytest.raises(ValueError, match="ambiguous room name"):
        resolve_rooms([{"room": "Bedroom", **settings}], room_map)

    assert resolve_rooms([{"room_id": "room-bedroom-east", **settings}], room_map) == [
        CleaningRoom("room-bedroom-east", "Bedroom", "vacuum", "standard")
    ]

    with pytest.raises(ValueError, match="ambiguous room ID"):
        resolve_rooms(
            [{"room_id": "ROOM-BEDROOM-EAST", **settings}],
            {"room-bedroom-east": "East", "ROOM-BEDROOM-EAST": "West"},
        )


def test_rooms_follow_stable_id_across_map_rename_and_namespace_collision() -> None:
    settings = {"cleaning_mode": "mop", "coverage_setting": "quick"}
    rooms = resolve_rooms(
        [
            {
                "room_id": "stable-bedroom",
                "room": "Old bedroom name",
                **settings,
            },
            {"room": "stable-bedroom", **settings},
        ],
        {
            "stable-bedroom": "Primary Bedroom",
            "other-room": "stable-bedroom",
        },
    )

    assert rooms == [
        CleaningRoom("stable-bedroom", "Primary Bedroom", "mop", "quick"),
        CleaningRoom("other-room", "stable-bedroom", "mop", "quick"),
    ]


def test_room_reference_prefers_stable_ids_and_rejects_ambiguity() -> None:
    assert resolve_room_reference(
        " STABLE-BEDROOM ",
        {
            "stable-bedroom": "Primary Bedroom",
            "other-room": "stable-bedroom",
        },
    ) == ("stable-bedroom", "Primary Bedroom")
    assert resolve_room_reference(
        " primary bedroom ", {"stable-bedroom": "Primary Bedroom"}
    ) == ("stable-bedroom", "Primary Bedroom")

    with pytest.raises(ValueError, match="ambiguous room name"):
        resolve_room_reference(
            "Bedroom",
            {
                "room-bedroom-east": "Bedroom",
                "room-bedroom-west": "BEDROOM",
            },
        )
    with pytest.raises(ValueError, match="ambiguous room ID"):
        resolve_room_reference(
            "ROOM-BEDROOM",
            {"room-bedroom": "East", "ROOM-BEDROOM": "West"},
        )
    with pytest.raises(ValueError, match=r"^Missing$"):
        resolve_room_reference("Missing", {"room-bedroom": "Bedroom"})


async def test_custom_areas_round_trip_by_id_and_name_without_snapshot(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (Room("room", "Room", "protocol", b"room", ((0, 0), (2, 0), (0, 2))),),
    )
    saved = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Litter box",
        "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding_for_floor_plan(floor_plan),
    }

    await manager.async_save_area("serial", "litter_box", saved)

    assert manager.area("serial", "litter_box") == {"id": "litter_box", **saved}
    assert manager.area("serial", "LITTER BOX") == {"id": "litter_box", **saved}
    assert manager.area("serial") == {"id": "litter_box", **saved}
    assert manager.areas("serial") == {"litter_box": saved}
    assert "areas" not in manager.snapshot("serial")
    assert manager.snapshot("serial")["selected_area_name"] == "Litter box"
    await manager.async_select_area("serial", "litter_box")
    with pytest.raises(KeyError):
        await manager.async_select_area("serial", "missing")
    with pytest.raises(KeyError):
        manager.area("serial", "missing")

    await manager.async_delete_area("serial", "litter_box")
    assert manager.areas("serial") == {}


async def test_current_v1_area_bindings_upgrade_automatically(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    listener = MagicMock()
    manager.async_add_listener("serial", listener)
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (Room("room", "Room", "protocol", b"room", ((0, 0), (2, 0), (0, 2))),),
    )
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.2}]
    robot = manager._robot("serial")
    robot["areas"] = {
        "current": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": binding_for_floor_plan(floor_plan),
        },
        "already_scoped": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": binding_for_area(floor_plan, circles),
        },
        "hash_only_scoped": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": {
                **binding_for_floor_plan(floor_plan),
                "version": HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                "local_geometry_sha256": _hash_only_area_geometry_fingerprint(
                    floor_plan, circles
                ),
            },
        },
        "different_mission": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": binding_for_floor_plan(
                FloorPlan(
                    43,
                    floor_plan.partition_protocol_id,
                    floor_plan.partition_id_wire,
                    floor_plan.rooms,
                )
            ),
        },
        "missing_circles": {
            "schema_version": AREA_SCHEMA_VERSION,
            "map_binding": binding_for_floor_plan(floor_plan),
        },
        "invalid_circles": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": [{}],
            "map_binding": binding_for_floor_plan(floor_plan),
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

    assert await manager.async_upgrade_area_bindings(
        "serial", floor_plan
    ) == AreaBindingUpgradeResult(2, False)
    assert robot["areas"]["current"]["map_binding"]["version"] == (
        SCOPED_MAP_BINDING_VERSION
    )
    assert robot["areas"]["hash_only_scoped"]["map_binding"]["version"] == (
        SCOPED_MAP_BINDING_VERSION
    )
    assert robot["areas"]["list_version"]["map_binding"]["version"] == []
    assert robot["areas"]["object_version"]["map_binding"]["version"] == {}
    manager._store.async_save.assert_awaited_once()
    listener.assert_called_once()

    manager._store.async_save.reset_mock()
    listener.reset_mock()
    assert await manager.async_upgrade_area_bindings(
        "serial", floor_plan
    ) == AreaBindingUpgradeResult(0, False)
    assert await manager.async_upgrade_area_bindings(
        "serial", None
    ) == AreaBindingUpgradeResult(0, True)
    manager._store.async_save.assert_not_awaited()
    listener.assert_not_called()


async def test_area_binding_upgrade_stays_pending_for_partial_map(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
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
    manager._robot("serial")["areas"] = {
        "partial": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": circles,
            "map_binding": binding_for_floor_plan(complete),
        }
    }

    assert await manager.async_upgrade_area_bindings(
        "serial", partial
    ) == AreaBindingUpgradeResult(0, True)
    manager._store.async_save.assert_not_awaited()

    assert await manager.async_upgrade_area_bindings(
        "serial", complete
    ) == AreaBindingUpgradeResult(1, False)
    manager._store.async_save.assert_awaited_once()


async def test_area_binding_upgrade_ignores_malformed_area_record(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    manager._robot = MagicMock(return_value={"areas": {"corrupt": "not-an-area"}})

    assert await manager.async_upgrade_area_bindings(
        "serial", None
    ) == AreaBindingUpgradeResult(0, False)
    manager._store.async_save.assert_not_awaited()


async def test_native_history_import_records_activity_not_completion(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    listener = MagicMock()
    manager.async_add_listener("serial", listener)
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            Room("living", "Living Room", "living", b"living", ()),
            Room("hall", "Hallway", "hall", b"hall", ()),
            Room("office-a", "Office", "office-a", b"office-a", ()),
            Room("office-b", "The Office", "office-b", b"office-b", ()),
        ),
    )

    def record(
        key: bytes,
        ended_at: str | None,
        room: str,
        duration: int | float | bool,
        *,
        completed_rooms: tuple[str, ...],
    ) -> CleaningSessionRecord:
        return CleaningSessionRecord(
            key,
            CleaningSession(
                "2026-07-28T17:00:00+00:00",
                ended_at,
                600,
                (room,),
                ((room, duration),),
                True,
                completed_rooms,
            ),
        )

    manager._robot("serial")["rooms"]["hall"] = {
        "name": "Hallway",
        "last_completed": "2026-07-28T23:30:00+00:00",
        "last_duration_seconds": 77,
    }
    records = (
        record(
            b"living-old",
            "2026-07-28T18:00:00+00:00",
            "Living Room",
            100,
            completed_rooms=("Living Room",),
        ),
        record(
            b"living-new",
            "2026-07-28T19:00:00+00:00",
            "the Living Room",
            120.6,
            completed_rooms=("the Living Room",),
        ),
        record(
            b"attempted",
            "2026-07-28T20:00:00+00:00",
            "Living Room",
            180,
            completed_rooms=(),
        ),
        record(
            b"older-hall",
            "2026-07-28T22:00:00+00:00",
            "Hallway",
            90,
            completed_rooms=("Hallway",),
        ),
        record(
            b"ambiguous",
            "2026-07-28T22:00:00+00:00",
            "Office",
            90,
            completed_rooms=("Office",),
        ),
        record(
            b"unknown",
            "2026-07-28T22:00:00+00:00",
            "Garage",
            90,
            completed_rooms=("Garage",),
        ),
        record(
            b"invalid-duration",
            "2026-07-28T22:00:00+00:00",
            "Living Room",
            True,
            completed_rooms=("Living Room",),
        ),
        record(
            b"future",
            "2099-07-28T22:00:00+00:00",
            "Living Room",
            90,
            completed_rooms=("Living Room",),
        ),
        record(
            b"unfinished",
            None,
            "Living Room",
            90,
            completed_rooms=("Living Room",),
        ),
    )

    assert (
        await manager.async_import_native_history("serial", floor_plan, records) is True
    )
    history = manager.snapshot("serial")["last_completed_by_room"]
    # The robot's record cannot prove a room was finished, so importing it
    # never claims a completion: it only keeps rotation fairness current.
    assert history["living"]["at"] is None
    assert history["living"]["runs"] == 0
    assert history["living"]["name"] == "Living Room"
    assert history["hall"]["at"] == "2026-07-28T23:30:00+00:00"
    assert "office-a" not in history
    rooms = manager._robot("serial")["rooms"]
    # A record with no usable duration still proves the robot worked there,
    # so the newest such session is the room's latest opportunity.
    assert rooms["living"]["last_opportunity"] == "2026-07-28T22:00:00+00:00"
    assert "last_duration_seconds" not in rooms["living"]
    # A verified completion that is newer than the native evidence stands.
    assert "last_opportunity" not in rooms["hall"]
    manager._store.async_save.assert_awaited_once()
    listener.assert_called_once()

    manager._store.async_save.reset_mock()
    listener.reset_mock()
    assert (
        await manager.async_import_native_history("serial", floor_plan, records)
        is False
    )
    assert await manager.async_import_native_history("serial", None, records) is False
    manager._store.async_save.assert_not_awaited()
    listener.assert_not_called()


async def test_plan_store_migrates_legacy_areas_without_fabricating_map_binding(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    assert manager._store.version == 1
    assert manager._store.minor_version == 4
    assert manager._store._private is True
    stored = {
        "robots": {
            "serial": {
                "rotations": {
                    "away": {
                        "rooms": {
                            "room": {"last_started": "2026-01-01T00:00:00+00:00"},
                            "corrupt": "not-a-record",
                        }
                    },
                    "corrupt": "not-a-rotation",
                },
                "rooms": {
                    "room": {"last_started": "2026-01-01T00:00:00+00:00"},
                    "corrupt": "not-a-record",
                },
                "areas": {
                    "legacy": {
                        "name": "Legacy",
                        "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
                    },
                    "bound": {"schema_version": AREA_SCHEMA_VERSION},
                    "corrupt": "not-a-record",
                },
            },
            "no_areas": {"areas": []},
            "corrupt": "not-a-robot",
        }
    }

    migrated = await manager._store._async_migrate_func(1, 1, stored)

    legacy = migrated["robots"]["serial"]["areas"]["legacy"]
    assert legacy["schema_version"] == 0
    assert "map_binding" not in legacy
    assert migrated["robots"]["serial"]["areas"]["bound"] == {
        "schema_version": AREA_SCHEMA_VERSION
    }
    assert migrated["robots"]["serial"]["areas"]["corrupt"] == "not-a-record"
    assert (
        migrated["robots"]["serial"]["rotations"]["away"]["rooms"]["room"][
            "last_opportunity"
        ]
        == "2026-01-01T00:00:00+00:00"
    )
    assert migrated["robots"]["serial"]["rooms"]["room"]["last_opportunity"] == (
        "2026-01-01T00:00:00+00:00"
    )

    version_two = {
        "robots": {
            "serial": {
                "areas": {"current": {}},
                "rooms": {"room": {"last_started": "legacy-attempt"}},
            }
        }
    }
    migrated_version_two = await manager._store._async_migrate_func(1, 2, version_two)
    assert migrated_version_two["robots"]["serial"]["areas"]["current"] == {}
    assert migrated_version_two["robots"]["serial"]["rooms"]["room"] == {
        "last_started": "legacy-attempt",
        "last_opportunity": "legacy-attempt",
    }

    with pytest.raises(ValueError, match="storage version"):
        await manager._store._async_migrate_func(2, 1, stored)
    with pytest.raises(ValueError, match="minor version"):
        await manager._store._async_migrate_func(1, 5, stored)


async def test_intelligent_order_avoids_restarting_with_the_same_room(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    kitchen = _room("Kitchen", "room-kitchen")
    study = _room("Study", "room-study")
    bedroom = _room("Bedroom", "room-bedroom")

    assert manager.choose("serial", "away", [kitchen, study, bedroom]) == [
        kitchen,
        study,
        bedroom,
    ]
    await manager.async_mark_started("serial", "away", kitchen)
    await manager.async_mark_completed("serial", "away", kitchen)

    assert manager.choose("serial", "away", [kitchen, study, bedroom]) == [
        study,
        bedroom,
        kitchen,
    ]
    snapshot = manager.snapshot("serial")
    assert snapshot["completed_runs"] == 1
    assert snapshot["last_completed_by_room"]["room-kitchen"]["runs"] == 1
    assert snapshot["active_plan"] is None


async def test_intelligent_order_includes_external_room_cleaning(hass) -> None:
    """Native activity outside this integration moves a room behind its peers."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    kitchen = _room("Kitchen", "room-kitchen")
    study = _room("Study", "room-study")
    manager._robot("serial")["rooms"]["room-kitchen"] = {
        "last_opportunity": "2026-08-31T12:00:00+00:00",
    }

    assert manager.choose("serial", "away", [kitchen, study]) == [study, kitchen]


async def test_unfinished_rooms_remain_due_without_monopolizing_rotation(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    kitchen = _room("Kitchen", "room-kitchen")
    study = _room("Study", "room-study")

    await manager.async_mark_started("serial", "away", kitchen)
    started_record = manager._robot("serial")["rotations"]["away"]["rooms"][
        kitchen.room_id
    ]
    assert "last_opportunity" not in started_record
    assert kitchen.room_id not in manager._robot("serial")["rooms"]
    await manager.async_mark_failed("serial", "away", kitchen, "dispatch rejected")
    assert manager.choose("serial", "away", [kitchen, study]) == [kitchen, study]

    await manager.async_mark_started("serial", "away", kitchen)
    await manager.async_mark_resumed("serial", "away", kitchen)
    confirmed_at = manager._robot("serial")["rotations"]["away"]["rooms"][
        kitchen.room_id
    ]["last_opportunity"]
    assert (
        manager._robot("serial")["rooms"][kitchen.room_id]["last_opportunity"]
        == confirmed_at
    )
    await manager.async_mark_resumed("serial", "away", kitchen)
    assert (
        manager._robot("serial")["rotations"]["away"]["rooms"][kitchen.room_id][
            "last_opportunity"
        ]
        == confirmed_at
    )
    await manager.async_mark_failed("serial", "away", kitchen, "robot error")
    assert manager.choose("serial", "away", [kitchen, study]) == [study, kitchen]

    await manager.async_mark_started("serial", "away", study)
    await manager.async_mark_resumed("serial", "away", study)
    await manager.async_mark_cancelled("serial", "away", study)
    snapshot = manager.snapshot("serial")
    assert snapshot["failed_runs"] == 2
    assert snapshot["cancelled_runs"] == 1
    assert manager.choose("serial", "away", [kitchen, study]) == [kitchen, study]


async def test_three_room_short_runs_cycle_after_terminal_outcomes(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    kitchen = _room("Kitchen", "room-kitchen")
    study = _room("Study", "room-study")
    bedroom = _room("Bedroom", "room-bedroom")
    rooms = [kitchen, study, bedroom]

    await manager.async_mark_started("serial", "away", kitchen)
    await manager.async_mark_resumed("serial", "away", kitchen)
    await manager.async_mark_failed("serial", "away", kitchen, "blocked")
    assert manager.choose("serial", "away", rooms)[0] == study

    await manager.async_mark_started("serial", "away", study)
    await manager.async_mark_resumed("serial", "away", study)
    await manager.async_mark_cancelled("serial", "away", study)
    assert manager.choose("serial", "away", rooms)[0] == bedroom

    await manager.async_mark_started("serial", "away", bedroom)
    await manager.async_mark_resumed("serial", "away", bedroom)
    await manager.async_mark_interrupted("serial", "away", bedroom, "offline")
    assert manager.choose("serial", "away", rooms)[0] == kitchen
    assert manager.snapshot("serial")["completed_runs"] == 0


async def test_fair_rotation_cycles_every_mapped_room_during_short_runs(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    rooms = [_room(f"Room {index}", f"room-{index}") for index in range(12)]
    base = dt_util.utcnow() - timedelta(hours=1)

    for index, expected in enumerate(rooms * 2):
        assert manager.choose("serial", "away", rooms)[0] == expected
        with patch(
            "custom_components.matic_robot.plans.dt_util.utcnow",
            return_value=base + timedelta(seconds=index),
        ):
            await manager.async_mark_started("serial", "away", expected)
            await manager.async_mark_resumed("serial", "away", expected)
            await manager.async_mark_failed("serial", "away", expected, "blocked")

    assert manager.snapshot("serial")["completed_runs"] == 0
    assert manager.snapshot("serial")["failed_runs"] == 24


async def test_new_plan_uses_global_room_completion_as_rotation_fallback(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    kitchen = _room("Kitchen", "room-kitchen")
    study = _room("Study", "room-study")

    await manager.async_mark_started("serial", "weekday", kitchen)
    await manager.async_mark_completed("serial", "weekday", kitchen)

    assert manager.choose("serial", "weekend", [kitchen, study]) == [study, kitchen]

    second_manager = CleaningPlanManager(hass)
    second_manager._store = SimpleNamespace(async_save=AsyncMock())
    await second_manager.async_mark_started("serial", "weekday", kitchen)
    await second_manager.async_mark_resumed("serial", "weekday", kitchen)
    await second_manager.async_mark_failed(
        "serial", "weekday", kitchen, "synthetic blockage"
    )
    assert second_manager.choose("serial", "weekend", [kitchen, study]) == [
        study,
        kitchen,
    ]


async def test_plan_reset_ignores_old_shared_history_but_accepts_new_activity(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    kitchen = _room("Kitchen", "room-kitchen")
    study = _room("Study", "room-study")
    rooms = [kitchen, study]
    base = dt_util.utcnow() - timedelta(minutes=3)

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.async_mark_started("serial", "weekday", kitchen)
        await manager.async_mark_completed("serial", "weekday", kitchen)
    assert manager.choose("serial", "weekend", rooms) == [study, kitchen]

    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(minutes=1),
    ):
        await manager.async_reset_history("serial", "weekend")
    assert manager.choose("serial", "weekend", rooms) == rooms

    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(minutes=2),
    ):
        await manager.async_mark_started("serial", "weekday", kitchen)
        await manager.async_mark_resumed("serial", "weekday", kitchen)
        await manager.async_mark_failed("serial", "weekday", kitchen, "blocked")
    assert manager.choose("serial", "weekend", rooms) == [study, kitchen]


async def test_plan_reset_discards_matching_native_reconciliation(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    kitchen = _room("Kitchen", "room-kitchen")
    dispatched_at = dt_util.utcnow()
    marker = {
        "plan_id": "away",
        "room_id": kitchen.room_id,
        "room": kitchen.name,
        "dispatched_at": dispatched_at.isoformat(),
    }

    await manager.async_mark_started("serial", "away", kitchen)
    await manager.async_mark_failed(
        "serial", "away", kitchen, "stopped", native_reconciliation=marker
    )
    watcher = asyncio.create_task(asyncio.Event().wait())
    manager.register_reconciliation_task("serial", watcher)

    await manager.async_reset_history("serial", "other")
    assert "pending_native_reconciliation" in manager._robot("serial")
    assert watcher.done() is False

    await manager.async_reset_history("serial", "away")
    await asyncio.gather(watcher, return_exceptions=True)
    assert watcher.cancelled()
    assert "pending_native_reconciliation" not in manager._robot("serial")
    assert "away" not in manager._robot("serial")["rotations"]
    assert not await manager.async_mark_native_completed(
        "serial",
        "away",
        kitchen,
        dispatched_at=dispatched_at,
        completed_at=dt_util.utcnow().isoformat(),
        duration_seconds=60,
    )
    assert "away" not in manager._robot("serial")["rotations"]

    await manager.async_mark_started("serial", "away", kitchen)
    await manager.async_mark_failed(
        "serial", "away", kitchen, "stopped", native_reconciliation=marker
    )
    second_watcher = asyncio.create_task(asyncio.Event().wait())
    manager.register_reconciliation_task("serial", second_watcher)
    await manager.async_reset_history("serial")
    await asyncio.gather(second_watcher, return_exceptions=True)
    assert second_watcher.cancelled()
    assert "pending_native_reconciliation" not in manager._robot("serial")
    assert manager._robot("serial")["rotations"] == {}


def test_rotation_recovers_from_corrupt_or_future_history(hass) -> None:
    manager = CleaningPlanManager(hass)
    kitchen = _room("Kitchen", "room-kitchen")
    study = _room("Study", "room-study")
    bedroom = _room("Bedroom", "room-bedroom")
    robot = manager._robot("serial")
    robot["rotations"]["away"] = {
        "rooms": {
            kitchen.room_id: {"last_opportunity": "not-a-timestamp"},
            study.room_id: {"last_opportunity": "2030-01-01T00:00:00+00:00"},
            bedroom.room_id: "corrupt-record",
        }
    }
    robot["rooms"] = "corrupt-global-history"

    assert manager.choose("serial", "away", [kitchen, study, bedroom]) == [
        kitchen,
        study,
        bedroom,
    ]


def test_latest_rotation_timestamp_rejects_untrusted_values() -> None:
    now = dt_util.parse_datetime("2026-01-03T00:00:00+00:00")
    assert now is not None
    assert (
        _latest_timestamp(
            None,
            123,
            "invalid",
            "2026-01-01T00:00:00",
            "2030-01-01T00:00:00+00:00",
            now=now,
        )
        is None
    )
    assert (
        _latest_timestamp(
            "2026-01-01T00:00:00+00:00",
            "2026-01-02T00:00:00+00:00",
            now=now,
        )
        == dt_util.parse_datetime("2026-01-02T00:00:00+00:00").timestamp()
    )

    invalid_datetime = MagicMock(tzinfo=UTC)
    invalid_datetime.timestamp.side_effect = OSError
    with patch(
        "custom_components.matic_robot.plans.dt_util.parse_datetime",
        return_value=invalid_datetime,
    ):
        assert _latest_timestamp("synthetic", now=now) is None


async def test_restart_recovers_interrupted_room(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(
        async_load=AsyncMock(return_value=None),
        async_save=AsyncMock(),
    )
    await manager.async_load()
    assert manager._data == {"robots": {}}

    room = _room("Kitchen", "room-kitchen")
    await manager.async_mark_started("serial", "away", room)
    recovering = CleaningPlanManager(hass)
    recovering._store = SimpleNamespace(
        async_load=AsyncMock(return_value=manager._data), async_save=AsyncMock()
    )
    await recovering.async_load()
    snapshot = recovering.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert snapshot["last_interrupted_plan"]["room"] == "Kitchen"
    assert (
        snapshot["plan_history"]["away"]["rooms"]["room-kitchen"]["last_result"]
        == "interrupted"
    )


async def test_load_repairs_malformed_plan_storage_without_inventing_history(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(
        async_load=AsyncMock(
            return_value={
                "robots": {
                    "discarded": "not-a-robot",
                    "serial": {
                        "rotations": {
                            "away": "not-a-rotation",
                            "other": {"rooms": {"corrupt": "not-a-record"}},
                            "third": {"rooms": "not-room-records"},
                        },
                        "rooms": {"corrupt": "not-room-history"},
                        "plans": {
                            "valid": {"name": "Valid", "rooms": []},
                            "corrupt": "not-a-plan",
                        },
                        "areas": {"corrupt": "not-an-area"},
                        "rotation_resets": {"away": 7},
                        "selected_plan": ["not", "hashable"],
                        "active_plan": {"plan_id": 7},
                    },
                }
            }
        ),
        async_save=AsyncMock(),
    )

    await manager.async_load()

    assert set(manager._data["robots"]) == {"serial"}
    assert manager._data["robots"]["serial"] == {
        "rotations": {
            "away": {"rooms": {}},
            "other": {"rooms": {}},
            "third": {"rooms": {}},
        },
        "rooms": {},
        "plans": {"valid": {"name": "Valid", "rooms": []}},
        "areas": {},
        "rotation_resets": {},
        "selected_plan": "valid",
        "selected_area": None,
        "active_plan": None,
    }
    manager._store.async_save.assert_awaited_once_with(manager._data)

    manager._data = {"robots": "not-a-container"}
    robot = manager._robot("serial")
    assert robot["rooms"] == {}
    assert manager._data["robots"] == {"serial": robot}

    root_repair = CleaningPlanManager(hass)
    root_repair._store = SimpleNamespace(
        async_load=AsyncMock(return_value={"robots": "not-a-container"}),
        async_save=AsyncMock(),
    )
    await root_repair.async_load()
    assert root_repair._data == {"robots": {}}
    root_repair._store.async_save.assert_awaited_once_with(root_repair._data)


async def test_load_backfills_verified_room_duration_from_plan_history(hass) -> None:
    manager = CleaningPlanManager(hass)
    stored = {
        "robots": {
            "serial": {
                "rotations": {
                    "away": {
                        "rooms": {
                            "room-living": {
                                "room_id": "room-living",
                                "name": "Living Room",
                                "last_result": "completed",
                                "last_completed": "2026-07-28T18:00:00+00:00",
                                "last_duration_seconds": 727.6,
                            },
                            "room-unverified": {
                                "room_id": "room-unverified",
                                "last_result": "ended_unverified",
                                "last_completed": "2026-07-28T19:00:00+00:00",
                                "last_duration_seconds": 100,
                            },
                            "room-newer-global": {
                                "room_id": "room-newer-global",
                                "name": "Newer global",
                                "last_result": "completed",
                                "last_completed": "2026-07-27T19:00:00+00:00",
                                "last_duration_seconds": 100,
                            },
                        }
                    }
                },
                "rooms": {
                    "room-living": {
                        "name": "Living Room",
                        "last_completed": "2026-07-26T18:00:00+00:00",
                        "last_duration_seconds": 1797,
                        "completed_runs": 3,
                    },
                    "room-newer-global": {
                        "name": "Newer global",
                        "last_completed": "2026-07-28T19:00:00+00:00",
                        "last_duration_seconds": 200,
                        "completed_runs": 1,
                    },
                },
                "plans": {},
                "areas": {},
                "rotation_resets": {},
            }
        }
    }
    manager._store = SimpleNamespace(
        async_load=AsyncMock(return_value=stored), async_save=AsyncMock()
    )

    await manager.async_load()

    snapshot = manager.snapshot("serial")
    assert snapshot["last_completed_by_room"]["room-living"] == {
        "name": "Living Room",
        "at": "2026-07-28T18:00:00+00:00",
        "duration_seconds": 728,
        "runs": 3,
    }
    assert "room-unverified" not in snapshot["last_completed_by_room"]
    assert snapshot["last_completed_by_room"]["room-newer-global"] == {
        "name": "Newer global",
        "at": "2026-07-28T19:00:00+00:00",
        "duration_seconds": 200,
        "runs": 1,
    }
    manager._store.async_save.assert_awaited_once_with(manager._data)


async def test_listener_lock_and_cancel_lifecycle(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    listener = MagicMock()
    remove = manager.async_add_listener("serial", listener)
    assert manager.lock("serial") is manager.lock("serial")
    assert manager.cancel("serial") is False

    lock = manager.lock("serial")
    await lock.acquire()
    event = manager.prepare_run("serial")
    assert manager.cancel("serial") is True
    assert event.is_set()
    lock.release()

    await manager.async_mark_started("serial", "away", _room("Kitchen", "one"))
    listener.assert_called_once()
    remove()
    await manager.async_mark_failed(
        "serial", "away", _room("Kitchen", "one"), "cancelled"
    )
    listener.assert_called_once()


async def test_motion_arbiter_revokes_and_serializes_managed_commands(hass) -> None:
    manager = CleaningPlanManager(hass)
    token = manager.begin_managed_motion("serial")

    assert manager.command_lock("serial") is manager.command_lock("serial")
    assert manager.managed_motion_is_current("serial", token) is True
    async with manager.managed_command("serial", token):
        assert manager.command_lock("serial").locked()

    async with manager.external_motion("serial"):
        assert manager.command_lock("serial").locked()
        assert manager.managed_motion_is_current("serial", token) is False

    with pytest.raises(ManagedMotionReplacedError):
        async with manager.managed_command("serial", token):
            pass

    newer = manager.begin_managed_motion("serial")
    manager.end_managed_motion("serial", token)
    assert manager.managed_motion_is_current("serial", newer) is True
    manager.end_managed_motion("serial", newer)
    assert manager.managed_motion_is_current("serial", newer) is False


async def test_replacement_motion_persists_reconciliation_removal_before_yield(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    marker = {
        "plan_id": "away",
        "room_id": room.room_id,
        "room": room.name,
        "dispatched_at": dt_util.utcnow().isoformat(),
    }

    async def add_marker() -> None:
        await manager.async_mark_started("serial", "away", room)
        await manager.async_mark_failed(
            "serial", "away", room, "error", native_reconciliation=marker
        )
        manager._store.async_save.reset_mock()

    await add_marker()
    async with manager.external_motion("serial"):
        assert "pending_native_reconciliation" not in manager._robot("serial")
        manager._store.async_save.assert_awaited_once()

    await add_marker()
    await manager.async_replace_managed_motion("serial")
    assert "pending_native_reconciliation" not in manager._robot("serial")
    manager._store.async_save.assert_awaited_once()

    await add_marker()
    token = manager.begin_managed_motion("serial")
    async with manager.managed_command("serial", token):
        assert "pending_native_reconciliation" not in manager._robot("serial")
        manager._store.async_save.assert_awaited_once()


@pytest.mark.parametrize(
    ("terminal_error", "translation_key", "last_result"),
    [
        (TimeoutError(), "plan_timeout", "failed"),
        (
            RoomInterruptedError("synthetic interruption"),
            "room_interrupted",
            "interrupted",
        ),
    ],
)
async def test_replaced_cleanup_cannot_recreate_native_reconciliation(
    hass,
    terminal_error: Exception,
    translation_key: str,
    last_result: str,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    token = manager.begin_managed_motion("serial")
    dispatched_at = dt_util.utcnow()
    sent: list[UserCommand] = []

    async def replace_during_cleanup(motion_token: int, command: UserCommand) -> None:
        assert motion_token == token
        sent.append(command)
        manager.replace_managed_motion("serial")
        raise ManagedMotionReplacedError("replacement won")

    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(side_effect=terminal_error),
        ),
        pytest.raises(ServiceValidationError) as failure,
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
            motion_token=token,
            session_history=AsyncMock(return_value=()),
            managed_user_command=replace_during_cleanup,
            prepared_dispatch=_PreparedRoomDispatch(
                (room,), frozenset(), dispatched_at
            ),
        )

    assert failure.value.translation_key == translation_key
    assert sent == [UserCommand.STOP]
    assert "pending_native_reconciliation" not in manager._robot("serial")
    assert "serial" not in manager._reconciliation_tasks
    record = manager.snapshot("serial")["plan_history"]["away"]["rooms"][room.room_id]
    assert record["last_result"] == last_result


async def test_suspended_and_interrupted_rooms_never_advance_history(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    await manager.async_mark_started("serial", "away", room)

    await manager.async_mark_suspended("serial", "away", room, "low_charge")
    snapshot = manager.snapshot("serial")
    record = snapshot["plan_history"]["away"]["rooms"]["room-kitchen"]
    assert record["last_result"] == "suspended"
    assert record["suspended_runs"] == 1
    assert snapshot["active_plan"]["status"] == "suspended"
    assert snapshot["completed_runs"] == 0
    assert snapshot["suspended_runs"] == 1

    await manager.async_mark_resumed("serial", "away", room)
    assert manager.snapshot("serial")["active_plan"]["status"] == "running"
    await manager.async_mark_interrupted("serial", "away", room, "unknown stop")
    snapshot = manager.snapshot("serial")
    record = snapshot["plan_history"]["away"]["rooms"]["room-kitchen"]
    assert record["last_result"] == "interrupted"
    assert record["interrupted_runs"] == 1
    assert snapshot["completed_runs"] == 0
    assert snapshot["interrupted_runs"] == 1
    assert snapshot["active_plan"] is None
    assert snapshot["last_interrupted_plan"]["room"] == "Kitchen"


async def test_pending_native_stop_completion_is_reconciled_on_history_import(
    hass,
) -> None:
    """A native session that finishes after STOP still credits the managed room."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()
    dispatched_at = (now - timedelta(seconds=5)).isoformat()
    await manager.async_mark_started("serial", "away", room)
    await manager.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": dispatched_at,
        },
    )
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                room.room_id,
                room.name,
                "protocol-kitchen",
                b"kitchen",
                ((0, 0), (1, 0), (1, 1), (0, 1)),
            ),
        ),
    )
    ended_at = (now - timedelta(seconds=1)).isoformat()
    record = CleaningSessionRecord(
        b"new-session",
        CleaningSession(
            (now - timedelta(seconds=10)).isoformat(),
            ended_at,
            9,
            (room.name,),
            ((room.name, 9),),
            True,
            (room.name,),
        ),
    )

    assert await manager.async_import_native_history("serial", floor_plan, [record])
    snapshot = manager.snapshot("serial")
    room_record = snapshot["plan_history"]["away"]["rooms"][room.room_id]
    assert room_record["last_result"] == "completed"
    assert room_record["completed_runs"] == 1
    assert room_record["last_duration_seconds"] == 9
    assert snapshot["native_reconciliation_pending"] is False


async def test_expired_native_reconciliation_is_cleared_without_plan_credit(
    hass,
) -> None:
    """A later same-room OEM clean cannot satisfy an expired managed marker."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()
    await manager.async_mark_started("serial", "away", room)
    await manager.async_mark_failed(
        "serial",
        "away",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
        },
    )
    manager._robot("serial")["pending_native_reconciliation"]["expires_at"] = (
        now - timedelta(seconds=1)
    ).isoformat()
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                room.room_id,
                room.name,
                "protocol-kitchen",
                b"kitchen",
                ((0, 0), (1, 0), (1, 1), (0, 1)),
            ),
        ),
    )
    unrelated = CleaningSessionRecord(
        b"later-session",
        CleaningSession(
            (now - timedelta(seconds=4)).isoformat(),
            now.isoformat(),
            4,
            (room.name,),
            ((room.name, 4),),
            True,
            (room.name,),
        ),
    )

    assert await manager.async_import_native_history("serial", floor_plan, [unrelated])
    snapshot = manager.snapshot("serial")
    plan_record = snapshot["plan_history"]["away"]["rooms"][room.room_id]
    assert plan_record["last_result"] == "failed"
    assert plan_record.get("completed_runs", 0) == 0
    assert snapshot["native_reconciliation_pending"] is False


async def test_native_completion_guard_paths_and_marker_recovery(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()
    dispatched_at = now - timedelta(seconds=5)
    assert (
        await manager.async_mark_native_completed(
            "serial", "away", room, dispatched_at=dispatched_at
        )
        is False
    )
    marker = {
        "plan_id": "away",
        "room_id": room.room_id,
        "room": room.name,
        "dispatched_at": dispatched_at.isoformat(),
    }
    await manager.async_mark_started("serial", "away", room)
    await manager.async_mark_failed(
        "serial", "away", room, "error", native_reconciliation=marker
    )
    assert (
        await manager.async_mark_native_completed(
            "serial", "other", room, dispatched_at=dispatched_at
        )
        is False
    )
    assert manager.snapshot("serial")["native_reconciliation_pending"] is True
    manager._robot("serial")["rotations"]["away"]["rooms"][room.room_id][
        "last_result"
    ] = "completed"
    assert (
        await manager.async_mark_native_completed(
            "serial", "away", room, dispatched_at=dispatched_at
        )
        is False
    )
    await manager.async_mark_started("serial", "away", room)
    await manager.async_mark_interrupted(
        "serial", "away", room, "interrupted", native_reconciliation=marker
    )
    assert manager.snapshot("serial")["native_reconciliation_pending"] is True
    manager._robot("serial")["pending_native_reconciliation"]["expires_at"] = (
        now - timedelta(seconds=1)
    ).isoformat()
    assert (
        await manager.async_mark_native_completed(
            "serial", "away", room, dispatched_at=dispatched_at
        )
        is False
    )
    assert manager.snapshot("serial")["native_reconciliation_pending"] is False


async def test_stale_native_watcher_cannot_credit_new_same_room_marker(hass) -> None:
    """A superseded watcher cannot apply old settings to a newer dispatch."""
    manager = CleaningPlanManager(hass)
    save = AsyncMock()
    manager._store = SimpleNamespace(async_save=save)
    current_room = _room("Kitchen", "room-kitchen")
    stale_room = replace(current_room, cleaning_mode="vacuum")
    now = dt_util.utcnow()
    stale_dispatch = now - timedelta(minutes=1)
    current_dispatch = now - timedelta(seconds=5)
    await manager.async_mark_started("serial", "away", current_room)
    await manager.async_mark_failed(
        "serial",
        "away",
        current_room,
        "stopped",
        native_reconciliation={
            "plan_id": "away",
            "room_id": current_room.room_id,
            "room": current_room.name,
            "dispatched_at": current_dispatch.isoformat(),
        },
    )
    save.reset_mock()

    assert (
        await manager.async_mark_native_completed(
            "serial",
            "away",
            stale_room,
            dispatched_at=stale_dispatch,
            completed_at=now.isoformat(),
            duration_seconds=60,
        )
        is False
    )
    record = manager.snapshot("serial")["plan_history"]["away"]["rooms"][
        current_room.room_id
    ]
    assert record["last_result"] == "failed"
    assert record["cleaning_mode"] == current_room.cleaning_mode
    assert record.get("completed_runs", 0) == 0
    assert manager.snapshot("serial")["native_reconciliation_pending"] is True
    save.assert_not_awaited()


@pytest.mark.parametrize(
    "value",
    [
        None,
        {
            "plan_id": "",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
        },
        {
            "plan_id": "plan",
            "room_id": 1,
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": 1,
            "dispatched_at": "2026-01-01T00:00:00+00:00",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
            "expires_at": 1,
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
            "expires_at": "not-a-time",
        },
        {
            "plan_id": "plan",
            "room_id": "id",
            "room": "Room",
            "dispatched_at": "2026-01-01T00:00:00+00:00",
            "expires_at": "2026-01-01T00:12:00",
        },
    ],
)
def test_native_reconciliation_marker_validation_rejects_bad_shapes(value) -> None:
    assert _validated_native_reconciliation(value) is None


async def test_native_reconciliation_import_rejects_ambiguous_and_invalid_records(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                room.room_id,
                room.name,
                "protocol-kitchen",
                b"kitchen",
                ((0, 0), (1, 0), (1, 1), (0, 1)),
            ),
        ),
    )
    pending = {
        "plan_id": "away",
        "room_id": room.room_id,
        "room": room.name,
        "dispatched_at": (now - timedelta(seconds=5)).isoformat(),
        "expires_at": (
            now + timedelta(seconds=OEM_STOP_RECONCILIATION_SECONDS)
        ).isoformat(),
    }
    robot = manager._robot("serial")
    robot["pending_native_reconciliation"] = pending

    invalid = CleaningSession(None, None, None, (room.name,), (), False)
    malformed_time = CleaningSession(
        None,
        (now - timedelta(seconds=1)).isoformat(),
        1,
        (room.name,),
        ((room.name, 1),),
        True,
        (room.name,),
    )
    wrong_room = CleaningSession(
        (now - timedelta(seconds=10)).isoformat(),
        (now - timedelta(seconds=1)).isoformat(),
        1,
        ("Study",),
        (("Study", 1),),
        True,
        ("Study",),
    )
    missing_completion = CleaningSession(
        (now - timedelta(seconds=10)).isoformat(),
        (now - timedelta(seconds=1)).isoformat(),
        1,
        (room.name,),
        ((room.name, 1),),
        True,
        (),
    )
    for session in (invalid, malformed_time, wrong_room, missing_completion):
        assert not _reconcile_pending_native_history(
            robot, floor_plan, [CleaningSessionRecord(b"candidate", session)]
        )
        robot["pending_native_reconciliation"] = pending

    robot["pending_native_reconciliation"] = {
        **pending,
        "room_id": "missing-room",
    }
    assert not _reconcile_pending_native_history(robot, floor_plan, [])

    _record_native_completion(
        robot,
        "away",
        room,
        completed_at=now.isoformat(),
        duration_seconds=1,
    )


def test_oem_stop_fence_expires_only_after_settle_window(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.mark_stop_pending("serial")
    assert manager.stop_pending("serial") is True
    manager.clear_stop_pending("serial")
    assert manager.stop_pending("serial") is False


def test_oem_stop_fence_expiry_is_self_cleaning(hass) -> None:
    manager = CleaningPlanManager(hass)
    with patch("custom_components.matic_robot.plans.monotonic", side_effect=[0, 720]):
        manager.mark_stop_pending("serial")
        assert manager.stop_pending("serial") is False


async def test_plan_load_restores_pending_stop_and_removes_bad_marker(hass) -> None:
    now_value = dt_util.utcnow()
    now = now_value.isoformat()
    valid = {
        "plan_id": "away",
        "room_id": "room-kitchen",
        "room": "Kitchen",
        "dispatched_at": now,
        "expires_at": (now_value + timedelta(seconds=30)).isoformat(),
    }
    stored = {
        "robots": {
            "serial": {"pending_native_reconciliation": valid},
            "other": {"pending_native_reconciliation": {"plan_id": 1}},
            "generic": {
                "stop_fence_expires_at": (now_value + timedelta(seconds=45)).isoformat()
            },
            "bad-fence": {"stop_fence_expires_at": "not-a-timestamp"},
            "stale-fence": {
                "stop_fence_expires_at": (now_value - timedelta(seconds=1)).isoformat()
            },
            "stale": {
                "pending_native_reconciliation": {
                    **valid,
                    "expires_at": (now_value - timedelta(seconds=1)).isoformat(),
                }
            },
        }
    }
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(
        async_load=AsyncMock(return_value=stored), async_save=AsyncMock()
    )
    with (
        patch(
            "custom_components.matic_robot.plans.dt_util.utcnow",
            return_value=now_value,
        ),
        patch("custom_components.matic_robot.plans.monotonic", return_value=100.0),
    ):
        await manager.async_load()
        assert manager.stop_pending("serial") is True
        assert manager._stop_fences["serial"] == 130.0
        assert manager._robot("serial")["stop_fence_expires_at"] == valid["expires_at"]
        assert manager.stop_pending("generic") is True
        assert manager._stop_fences["generic"] == 145.0
        assert "stop_fence_expires_at" not in manager._robot("bad-fence")
        assert "stop_fence_expires_at" not in manager._robot("stale-fence")
        assert "pending_native_reconciliation" not in manager._robot("other")
        assert "pending_native_reconciliation" not in manager._robot("stale")
        assert manager.stop_pending("stale") is False
    manager._store.async_load.assert_awaited_once()
    manager._store.async_save.assert_awaited_once()


async def test_stop_policy_learns_room_duration_and_applies_threshold(hass) -> None:
    """A stop finishes only rooms at or above the plan's learned threshold."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial",
        "away",
        {
            "name": "Away",
            "enabled": True,
            "finish_current_room": True,
            "finish_current_room_threshold": 50,
            "rooms": [],
        },
    )
    room = _room("Kitchen", "room-kitchen")
    lock = manager.lock("serial")
    await lock.acquire()
    try:
        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        manager._data["robots"]["serial"]["plans"]["away"]["finish_current_room"] = (
            False
        )
        assert manager.request_stop("serial") == PlanStopDecision("immediate")

        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        plan = manager._data["robots"]["serial"]["plans"]["away"]
        plan["finish_current_room"] = True
        plan["finish_current_room_threshold"] = "invalid"
        assert manager.request_stop("serial") == PlanStopDecision(
            "after_room", None, 50
        )
        plan["finish_current_room_threshold"] = 50

        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        assert manager.request_stop("serial") == PlanStopDecision(
            "after_room", None, 50
        )

        for duration in (100, 105, 1000):
            manager.prepare_run("serial")
            await manager.async_mark_started("serial", "away", room)
            active = manager._data["robots"]["serial"]["active_plan"]
            active["active_elapsed_seconds"] = duration
            active["active_segment_started"] = None
            await manager.async_mark_completed("serial", "away", room)
        record = manager.snapshot("serial")["plan_history"]["away"]["rooms"][
            "room-kitchen"
        ]
        assert record["average_duration_seconds"] == 105
        assert record["duration_history_seconds"] == [100, 105, 1000]

        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        active = manager._data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 40
        active["active_segment_started"] = None
        assert manager.request_stop("serial") == PlanStopDecision("immediate", 38, 50)
        assert manager.cancellation_event("serial").is_set()

        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        active = manager._data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 60
        active["active_segment_started"] = None
        assert manager.request_stop("serial") == PlanStopDecision("after_room", 57, 50)
        assert manager.finish_room_event("serial").is_set()
        assert not manager.cancellation_event("serial").is_set()

        changed = CleaningRoom("room-kitchen", "Kitchen", "mop", "standard")
        await manager.async_mark_started("serial", "away", changed)
        changed_record = manager.snapshot("serial")["plan_history"]["away"]["rooms"][
            "room-kitchen"
        ]
        assert "average_duration_seconds" not in changed_record
    finally:
        lock.release()


async def test_active_duration_excludes_suspension_and_cancel_is_not_learned(
    hass,
) -> None:
    """Only active cleaning segments feed successful duration estimates."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial", "away", {"name": "Away", "enabled": True, "rooms": []}
    )
    room = _room("Kitchen", "room-kitchen")
    base = dt_util.utcnow()

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.async_mark_started("serial", "away", room)
        await manager.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=30),
    ):
        await manager.async_mark_suspended("serial", "away", room, "low_charge")
    active = manager.snapshot("serial")["active_plan"]
    assert active["active_elapsed_seconds"] == 30
    assert active["active_segment_started"] is None
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(hours=1),
    ):
        await manager.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(hours=1, seconds=30),
    ):
        await manager.async_mark_completed("serial", "away", room)

    record = manager.snapshot("serial")["plan_history"]["away"]["rooms"][room.room_id]
    assert record["last_duration_seconds"] == 60
    assert record["duration_history_seconds"] == [60]
    assert manager.snapshot("serial")["last_completed_by_room"][room.room_id] == {
        "name": "Kitchen",
        "at": (base + timedelta(hours=1, seconds=30)).isoformat(),
        "duration_seconds": 60,
        "runs": 1,
    }

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.async_mark_started("serial", "away", room)
        await manager.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=15),
    ):
        await manager.async_mark_cancelled("serial", "away", room)
    cancelled = manager.snapshot("serial")["plan_history"]["away"]["rooms"][
        room.room_id
    ]
    assert cancelled["last_duration_seconds"] == 60
    assert cancelled["last_cancelled_duration_seconds"] == 15
    assert cancelled["duration_history_seconds"] == [60]

    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.async_mark_started("serial", "away", room)
        await manager.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=45),
    ):
        await manager.async_mark_ended_unverified("serial", "away", room)
    unverified = manager.snapshot("serial")
    unverified_record = unverified["plan_history"]["away"]["rooms"][room.room_id]
    assert unverified["completed_runs"] == 1
    assert unverified["unverified_runs"] == 1
    assert unverified_record["last_result"] == "ended_unverified"
    assert unverified_record["last_duration_seconds"] == 60
    assert unverified_record["last_unverified_duration_seconds"] == 45
    assert unverified_record["duration_history_seconds"] == [60]


def test_progress_estimate_rejects_missing_and_malformed_start_times() -> None:
    now = dt_util.utcnow()
    assert _elapsed_seconds(None, now) is None
    assert _elapsed_seconds("not-a-timestamp", now) is None
    assert _elapsed_seconds("2026-01-01T00:00:00", now) is None
    assert _elapsed_seconds((now - timedelta(seconds=5)).isoformat(), now) == 5
    assert _estimated_progress("not-a-timestamp", 100) is None


def test_persisted_duration_values_fail_closed() -> None:
    assert _stored_count({"count": 3}, "count") == 3
    for value in (-1, True, 1.5, "3", None):
        assert _stored_count({"count": value}, "count") == 0
    assert _duration_history(
        {"duration_history_seconds": [True, float("inf"), float("nan"), 42]}
    ) == [42]
    assert _duration_history(
        {"duration_samples": 3, "average_duration_seconds": 90}
    ) == [90, 90, 90]
    assert (
        _duration_history({"duration_samples": 2, "average_duration_seconds": 90}) == []
    )
    for average in (True, float("inf"), float("nan"), 0, -1, "90"):
        assert (
            _duration_history(
                {"duration_samples": 3, "average_duration_seconds": average}
            )
            == []
        )

    active = {
        "active_elapsed_seconds": float("inf"),
        "active_segment_started": "2026-01-01T00:00:00",
    }
    assert _estimated_progress(active, 100) == 0


def test_duration_estimator_is_recent_bounded_and_outlier_resistant() -> None:
    record = {"duration_history_seconds": [90, 91, 92, 93, 94, 95, 1000, 96]}
    assert _duration_history(record) == [91, 92, 93, 94, 95, 1000, 96]
    assert _expected_duration(record) == 94
    assert _expected_duration({"duration_history_seconds": [90, 100]}) is None


def test_compatible_duration_history_is_room_and_settings_scoped() -> None:
    now = dt_util.utcnow()
    robot = {
        "rotations": {
            "older": {
                "rooms": {
                    "room-hall": {
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                        "duration_history_seconds": [90, 91, 92],
                        "last_completed": (now - timedelta(days=1)).isoformat(),
                    }
                }
            },
            "newer": {
                "rooms": {
                    "room-hall": {
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                        "duration_history_seconds": [93, 94, 95, 96, 97],
                        "last_completed": now.isoformat(),
                    },
                    "different-room": {
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "quick",
                        "duration_history_seconds": [1, 1, 1],
                    },
                }
            },
            "different-settings": {
                "rooms": {
                    "room-hall": {
                        "cleaning_mode": "mop",
                        "coverage_setting": "quick",
                        "duration_history_seconds": [2, 2, 2],
                    }
                }
            },
            1: {"rooms": {}},
            "malformed": {"rooms": []},
        }
    }
    active = {"cleaning_mode": "vacuum", "coverage_setting": "quick"}
    assert _compatible_duration_history(robot, "room-hall", active) == [
        91,
        92,
        93,
        94,
        95,
        96,
        97,
    ]
    assert _compatible_duration_history(robot, "missing", active) == []
    assert _compatible_duration_history(robot, "room-hall", {}) == []
    assert _compatible_duration_history({"rotations": []}, "room-hall", active) == []


async def test_stop_policy_reuses_compatible_history_across_plans(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    for plan_id in ("source", "target"):
        await manager.async_save_plan(
            "serial",
            plan_id,
            {
                "name": plan_id.title(),
                "enabled": True,
                "finish_current_room": True,
                "finish_current_room_threshold": 50,
                "rooms": [],
            },
        )
    room = _room("Hallway", "room-hall")
    for duration in (90, 100, 110):
        await manager.async_mark_started("serial", "source", room)
        active = manager._data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = duration
        active["active_segment_started"] = None
        await manager.async_mark_completed("serial", "source", room)

    lock = manager.lock("serial")
    await lock.acquire()
    try:
        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "target", room)
        active = manager._data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 40
        active["active_segment_started"] = None
        assert manager.request_stop("serial") == PlanStopDecision("immediate", 40, 50)

        changed = CleaningRoom("room-hall", "Hallway", "mop", "quick")
        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "target", changed)
        assert manager.request_stop("serial") == PlanStopDecision(
            "after_room", None, 50
        )
    finally:
        lock.release()


async def test_verifying_state_closes_time_without_counting_suspension(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial", "away", {"name": "Away", "enabled": True, "rooms": []}
    )
    room = _room("Kitchen", "room-kitchen")
    base = dt_util.utcnow()
    with patch("custom_components.matic_robot.plans.dt_util.utcnow", return_value=base):
        await manager.async_mark_started("serial", "away", room)
        await manager.async_mark_resumed("serial", "away", room)
    with patch(
        "custom_components.matic_robot.plans.dt_util.utcnow",
        return_value=base + timedelta(seconds=20),
    ):
        await manager.async_mark_verifying("serial", "away", room)

    snapshot = manager.snapshot("serial")
    assert snapshot["active_plan"]["status"] == "verifying"
    assert snapshot["active_plan"]["active_elapsed_seconds"] == 20
    assert snapshot["suspended_runs"] == 0


async def test_room_native_plan_lifecycle_preview_selection_and_reset(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room_map = {"room-kitchen": "Kitchen", "room-study": "Study"}

    await manager.async_save_plan(
        "serial",
        "whole_home",
        {
            "name": "Whole home",
            "enabled": True,
            "run_behavior": "intelligent",
            "rooms": [
                {
                    "room_id": room_id,
                    "cleaning_mode": "vacuum_and_mop",
                    "coverage_setting": "standard",
                }
                for room_id in room_map
            ],
            "return_to_base": True,
        },
    )
    assert list(manager.plans("serial")) == ["whole_home"]
    assert manager.plan("serial")["name"] == "Whole home"
    preview = manager.preview("serial", room_map)
    assert [room["name"] for room in preview["rooms"]] == ["Kitchen", "Study"]
    assert preview["rotation_basis"] == "least_recent_opportunity"

    await manager.async_save_plan(
        "serial",
        "upstairs",
        {
            "name": "Upstairs",
            "enabled": True,
            "rooms": [
                {
                    "room_id": "room-study",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                }
            ],
            "return_to_base": False,
        },
    )
    await manager.async_select_plan("serial", "whole_home")
    assert manager.snapshot("serial")["selected_plan_name"] == "Whole home"
    await manager.async_mark_completed(
        "serial", "whole_home", _room("Kitchen", "room-kitchen")
    )
    assert manager.preview("serial", room_map)["rooms"][0]["name"] == "Study"
    manager._robot("serial")["plans"]["whole_home"]["run_behavior"] = "ordered"
    ordered_preview = manager.preview("serial", room_map)
    assert ordered_preview["rotation_basis"] == "saved_order"
    assert ordered_preview["rooms"][0]["name"] == "Kitchen"
    manager._robot("serial")["plans"]["whole_home"]["run_behavior"] = "intelligent"
    await manager.async_reset_history("serial", "whole_home")
    assert manager.snapshot("serial")["completed_runs"] == 0
    assert manager.preview("serial", room_map)["rooms"][0]["name"] == "Kitchen"
    await manager.async_delete_plan("serial", "whole_home")
    assert manager.snapshot("serial")["selected_plan"] == "upstairs"
    await manager.async_reset_history("serial")


async def test_plan_validation_rejects_disabled_empty_unknown_and_missing(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_save_plan(
        "serial", "disabled", {"name": "Disabled", "enabled": False, "rooms": []}
    )
    with pytest.raises(ValueError, match="disabled"):
        manager.rooms_for_plan("serial", {}, "disabled")
    with pytest.raises(KeyError):
        manager.plan("serial", "missing")
    with pytest.raises(KeyError):
        await manager.async_select_plan("serial", "missing")

    await manager.async_save_plan(
        "serial", "empty", {"name": "Empty", "enabled": True, "rooms": []}
    )
    with pytest.raises(ValueError, match="no rooms"):
        manager.rooms_for_plan("serial", {}, "empty")

    for rooms in ("room-kitchen", ["room-kitchen"]):
        await manager.async_save_plan(
            "serial",
            "corrupt",
            {"name": "Corrupt", "enabled": True, "rooms": rooms},
        )
        with pytest.raises(ValueError, match=r"plan (has no|contains an invalid) room"):
            manager.rooms_for_plan("serial", {}, "corrupt")


async def test_saved_plan_limit_rejects_creation_but_allows_replacement(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    plans = manager._robot("serial")["plans"]
    plans.update(
        {
            f"plan-{index}": {"name": f"Plan {index}", "rooms": []}
            for index in range(MAX_SAVED_PLANS_PER_ROBOT)
        }
    )

    with pytest.raises(SavedPlanLimitError, match="at most"):
        await manager.async_save_plan(
            "serial", "new-plan", {"name": "New plan", "rooms": []}
        )

    assert "new-plan" not in plans
    manager._store.async_save.assert_not_awaited()

    await manager.async_save_plan(
        "serial", "plan-0", {"name": "Replacement", "rooms": []}, select=False
    )

    assert plans["plan-0"]["name"] == "Replacement"
    manager._store.async_save.assert_awaited_once_with(manager._data)


async def test_room_execution_uses_its_individual_settings() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    room = CleaningRoom("room-study", "Study", "vacuum", "quick")

    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ) as wait,
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
            motion_token=3,
            active_session=AsyncMock(return_value=False),
        )

    assert services.async_call.await_args.args[2] == {
        "entity_id": "vacuum.matic",
        "command": "clean_rooms",
        "params": {
            "rooms": ["room-study"],
            "cleaning_mode": "vacuum",
            "coverage": "quick",
            "ordered": False,
            "_matic_plan_run": 3,
        },
    }
    assert wait.await_count == 1
    manager.async_mark_resumed.assert_awaited_once_with("serial", "away", room)
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()
    assert (
        bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_ended_unverified"
    )


async def test_room_timeout_is_failure_safe() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    sender = AsyncMock(side_effect=MaticError("synthetic cleanup failure"))
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(side_effect=TimeoutError),
        ),
        pytest.raises(
            ServiceValidationError, match="did not begin cleaning"
        ) as failure,
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
            motion_token=7,
            managed_user_command=sender,
        )
    sender.assert_awaited_once_with(7, UserCommand.STOP)
    assert failure.value.translation_key == "plan_start_timeout"
    manager.async_mark_failed.assert_awaited_once()
    assert (
        manager.async_mark_failed.await_args.args[3]
        == "The robot did not begin cleaning before the start timeout"
    )
    manager.async_mark_resumed.assert_not_awaited()
    manager.async_mark_completed.assert_not_awaited()
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_failed"


async def test_room_completion_timeout_is_failure_safe() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    room = _room("Kitchen", "room-kitchen")

    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(side_effect=TimeoutError),
        ),
        pytest.raises(ServiceValidationError, match="Timed out") as failure,
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
        )

    assert failure.value.translation_key == "plan_timeout"
    manager.async_mark_failed.assert_awaited_once()
    assert (
        manager.async_mark_failed.await_args.args[3]
        == "The managed room exceeded its completion timeout"
    )
    manager.async_mark_completed.assert_not_awaited()


async def test_room_takeover_during_verification_is_failure_safe() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    room = _room("Kitchen", "room-kitchen")

    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(side_effect=RoomTakenOverError("replacement task")),
        ),
        pytest.raises(ServiceValidationError) as failure,
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
        )

    assert failure.value.translation_key == "room_taken_over"
    manager.async_mark_interrupted.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()


async def test_room_recharge_waits_for_resume_before_unverified_handoff() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(side_effect=["cleaning", "cleaning"]),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(
                side_effect=[
                    RoomRunOutcome.SUSPENDED,
                    RoomRunOutcome.HANDOFF_CANDIDATE,
                ]
            ),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
            active_session=AsyncMock(return_value=False),
        )

    manager.async_mark_suspended.assert_awaited_once_with(
        "serial", "away", _room("Kitchen", "room-kitchen"), "low_charge"
    )
    assert manager.async_mark_resumed.await_count == 2
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()


async def test_active_session_clearing_at_dock_is_not_completion_credit() -> None:
    """Session disappearance permits handoff but never proves room completion."""
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    room = _room("Kitchen", "room-kitchen")
    reader = AsyncMock(side_effect=[True, False])
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
            active_session=reader,
        )

    manager.async_mark_suspended.assert_not_awaited()
    manager.async_mark_verifying.assert_awaited_once_with("serial", "away", room)
    assert manager.async_mark_resumed.await_count == 1
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()


async def test_new_native_completed_record_credits_only_after_manager_commit() -> None:
    """A new, overlapping, single-room native success is positive evidence."""
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    order: list[str] = []
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(
            side_effect=lambda *_args: order.append("manager_commit")
        ),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    now = dt_util.utcnow()
    old = CleaningSessionRecord(
        b"old-key",
        CleaningSession(
            (now - timedelta(hours=2)).isoformat(),
            (now - timedelta(hours=1)).isoformat(),
            60,
            ("Kitchen",),
            (("Kitchen", 60),),
            True,
        ),
    )
    history_reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal history_reads
        history_reads += 1
        if history_reads == 1:
            return (old,)
        ended = dt_util.utcnow()
        new = CleaningSessionRecord(
            b"new-key",
            CleaningSession(
                (ended - timedelta(seconds=5)).isoformat(),
                ended.isoformat(),
                5,
                ("Kitchen",),
                (("Kitchen", 5),),
                True,
            ),
        )
        return (old, new)

    confirm = MagicMock(side_effect=lambda *_args: order.append("tracker_confirm"))
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
            active_session=AsyncMock(return_value=False),
            session_history=history,
            confirm_room_completed=confirm,
        )

    manager.async_mark_verifying.assert_awaited_once()
    manager.async_mark_completed.assert_awaited_once()
    manager.async_mark_ended_unverified.assert_not_awaited()
    assert order == ["manager_commit", "tracker_confirm"]
    assert bus.async_fire.call_args_list[-1].args[0] == "matic_robot_room_completed"


async def test_managed_plan_rejects_duplicate_room_names_before_dispatch() -> None:
    """Native history names cannot safely distinguish duplicate mapped rooms."""
    hass = SimpleNamespace()
    with pytest.raises(ServiceValidationError) as failure:
        await _async_run_room(
            hass,
            _call(hass),
            SimpleNamespace(),
            "vacuum.matic",
            "serial",
            _room("Office", "room-office-a"),
            room_name_is_unique=False,
        )
    assert failure.value.translation_key == "ambiguous_room_name"


async def test_native_completion_evidence_fails_closed_on_errors_and_ambiguity() -> (
    None
):
    room = _room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()

    async def failing_reader() -> tuple[CleaningSessionRecord, ...]:
        raise MaticError("synthetic unavailable")

    assert await _async_session_history_baseline(failing_reader) is None
    assert (
        await _async_verify_room_completion(failing_reader, frozenset(), room, now)
        is False
    )

    def record(
        key: bytes,
        started: str | None,
        ended: str | None,
        *,
        completed: bool = True,
        room_name: str = "Kitchen",
        duration: int = 10,
    ) -> CleaningSessionRecord:
        return CleaningSessionRecord(
            key,
            CleaningSession(
                started,
                ended,
                duration,
                (room_name,),
                ((room_name, duration),),
                completed,
            ),
        )

    invalid = record(b"invalid", "bad", "also-bad")
    old = record(
        b"old",
        (now - timedelta(hours=3)).isoformat(),
        (now - timedelta(hours=2)).isoformat(),
    )
    valid_one = record(
        b"one",
        (now - timedelta(seconds=5)).isoformat(),
        now.isoformat(),
    )
    valid_two = record(
        b"two",
        (now - timedelta(seconds=4)).isoformat(),
        now.isoformat(),
    )
    reader = AsyncMock(side_effect=[(invalid, old), (valid_one, valid_two)])
    with patch("custom_components.matic_robot.services.asyncio.sleep", AsyncMock()):
        assert (
            await _async_verify_room_completion(reader, frozenset(), room, now) is False
        )

    interrupted = record(
        b"interrupted",
        (now - timedelta(seconds=5)).isoformat(),
        now.isoformat(),
        completed=False,
    )
    interrupted_reader = AsyncMock(return_value=(interrupted,))
    with patch("custom_components.matic_robot.services.asyncio.sleep", AsyncMock()):
        assert not await _async_verify_room_completion(
            interrupted_reader, frozenset(), room, now
        )

    empty = AsyncMock(return_value=())
    with patch("custom_components.matic_robot.services.asyncio.sleep", AsyncMock()):
        assert (
            await _async_verify_room_completion(empty, frozenset(), room, now) is False
        )
    assert empty.await_count == SESSION_HISTORY_ATTEMPTS

    cancel_event = asyncio.Event()

    async def cancel_during_retry() -> tuple[CleaningSessionRecord, ...]:
        asyncio.get_running_loop().call_soon(cancel_event.set)
        return ()

    with pytest.raises(PlanCancelledError):
        await _async_verify_room_completion(
            cancel_during_retry,
            frozenset(),
            room,
            now,
            cancel_event=cancel_event,
        )

    unset_cancel = asyncio.Event()
    with patch(
        "custom_components.matic_robot.services.SESSION_HISTORY_RETRY_SECONDS", 0
    ):
        assert not await _async_verify_room_completion(
            empty,
            frozenset(),
            room,
            now,
            cancel_event=unset_cancel,
        )

    already_cancelled = asyncio.Event()
    already_cancelled.set()
    with pytest.raises(PlanCancelledError):
        await _async_verify_room_completion(
            empty,
            frozenset(),
            room,
            now,
            cancel_event=already_cancelled,
        )

    cleaning_state = SimpleNamespace(state="cleaning")
    takeover_hass = SimpleNamespace(
        states=SimpleNamespace(get=MagicMock(return_value=cleaning_state))
    )
    with pytest.raises(RoomTakenOverError):
        await _async_verify_room_completion(
            empty,
            frozenset(),
            room,
            now,
            hass=takeover_hass,
            entity_id="vacuum.matic",
        )


async def test_active_session_can_resume_then_end_unverified() -> None:
    """A returning firmware session may resume before an unverified handoff."""
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    live_state = SimpleNamespace(state="cleaning")
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=live_state)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    room = _room("Kitchen", "room-kitchen")
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(
                side_effect=[
                    RoomRunOutcome.HANDOFF_CANDIDATE,
                    RoomRunOutcome.HANDOFF_CANDIDATE,
                ]
            ),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
            active_session=AsyncMock(side_effect=[True, False]),
        )

    manager.async_mark_suspended.assert_not_awaited()
    assert manager.async_mark_verifying.await_count == 2
    assert manager.async_mark_resumed.await_count == 2
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()


@pytest.mark.parametrize("use_session_reader", [False, True])
async def test_room_handoff_retries_prefetch_once_completion_is_verified(
    hass, use_session_reader: bool
) -> None:
    """An unavailable eager dispatch is retried after verified completion."""
    room = _room("Kitchen", "room-kitchen")
    next_room = _room("Study", "room-study")
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def finish_room() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Kitchen", "low_charge": False},
            )

        hass.async_create_task(finish_room(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    history_reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal history_reads
        history_reads += 1
        if history_reads == 1:
            return ()
        ended = dt_util.utcnow()
        return (
            CleaningSessionRecord(
                b"kitchen",
                CleaningSession(
                    (ended - timedelta(seconds=5)).isoformat(),
                    ended.isoformat(),
                    5,
                    ("Kitchen",),
                    (("Kitchen", 5),),
                    True,
                ),
            ),
        )

    prefetch_calls = 0

    async def prefetch() -> _PreparedRoomDispatch | None:
        # The eager dispatch at the observed return is unavailable once.
        nonlocal prefetch_calls
        prefetch_calls += 1
        if prefetch_calls == 1:
            return None
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Study"})
        return _PreparedRoomDispatch((next_room,), frozenset(), dt_util.utcnow())

    sender = AsyncMock()
    completed = await _async_run_room(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        room,
        session_history=history,
        managed_user_command=sender,
        prefetch_next=prefetch,
        active_session=(
            AsyncMock(side_effect=[True, False]) if use_session_reader else None
        ),
    )

    assert completed is True
    assert prefetch_calls == 2
    manager.async_mark_verifying.assert_awaited_once()
    manager.async_mark_completed.assert_awaited_once()
    sender.assert_not_awaited()


def _leg_manager(cancellation_reason: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
        async_mark_cancelled=AsyncMock(),
        cancellation_reason=MagicMock(return_value=cancellation_reason),
    )


def _leg_record(
    rooms: tuple[str, ...],
    completed_rooms: tuple[str, ...],
    *,
    completed: bool | None = True,
) -> CleaningSessionRecord:
    ended = dt_util.utcnow()
    return CleaningSessionRecord(
        b"leg-evidence",
        CleaningSession(
            (ended - timedelta(seconds=120)).isoformat(),
            ended.isoformat(),
            120,
            rooms,
            tuple((name, 57) for name in rooms),
            completed,
            completed_rooms,
        ),
    )


def _leg_call(hass, *, start_timeout: int = 120, completion_timeout: int = 21600):
    return ServiceCall(
        hass,
        DOMAIN,
        "intelligent_clean",
        {
            "plan_id": "away",
            "start_timeout": start_timeout,
            "completion_timeout": completion_timeout,
            "return_to_base": False,
        },
    )


def _leg_rooms() -> list[CleaningRoom]:
    return [_room("Kitchen", "room-kitchen"), _room("Office", "room-office")]


async def test_leg_rejects_duplicate_room_names(hass) -> None:
    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            _call(hass),
            _leg_manager(),
            "vacuum.matic",
            "serial",
            _leg_rooms(),
            room_name_is_unique=False,
        )


async def test_leg_uses_matching_prepared_dispatch_and_rejects_mismatch(hass) -> None:
    rooms = _leg_rooms()
    manager = _leg_manager()
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

    async def end_leg() -> None:
        await asyncio.sleep(0)
        hass.states.async_set(
            "vacuum.matic",
            "returning",
            {"current_area": "Kitchen", "low_charge": False},
        )

    hass.async_create_task(end_leg(), eager_start=True)

    async def history() -> tuple[CleaningSessionRecord, ...]:
        return (_leg_record(("Kitchen", "Office"), ("Kitchen", "Office")),)

    confirmed: list[str] = []
    prepared = _PreparedRoomDispatch(
        tuple(rooms), frozenset(), dt_util.utcnow() - timedelta(seconds=1)
    )
    completed = await _async_run_leg(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        session_history=history,
        confirm_room_completed=confirmed.append,
        prepared_dispatch=prepared,
    )
    assert completed is True
    assert confirmed == ["Kitchen", "Office"]

    with pytest.raises(ValueError):
        await _async_run_leg(
            hass,
            _call(hass),
            _leg_manager(),
            "vacuum.matic",
            "serial",
            rooms,
            prepared_dispatch=_PreparedRoomDispatch(
                (rooms[0],), frozenset(), dt_util.utcnow()
            ),
        )


async def test_leg_start_timeout_marks_failure_and_stops(hass) -> None:
    manager = _leg_manager()
    hass.states.async_set("vacuum.matic", "docked", {})
    hass.services.async_register("vacuum", "send_command", AsyncMock())
    sender = AsyncMock()

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            _leg_call(hass, start_timeout=0),
            manager,
            "vacuum.matic",
            "serial",
            _leg_rooms(),
            managed_user_command=sender,
            motion_token=7,
        )

    manager.async_mark_failed.assert_awaited_once()
    sender.assert_awaited_once_with(7, UserCommand.STOP)


async def test_leg_paused_start_suspends_until_cleaning(hass) -> None:
    rooms = _leg_rooms()
    manager = _leg_manager()

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "paused", {"current_area": "Kitchen"})

        async def resume() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": "Kitchen"}
            )
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Kitchen", "low_charge": False},
            )

        hass.async_create_task(resume(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (_leg_record(("Kitchen", "Office"), ("Kitchen", "Office")),)

    completed = await _async_run_leg(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        session_history=history,
    )

    assert completed is True
    manager.async_mark_suspended.assert_awaited_once()
    assert manager.async_mark_suspended.await_args.args[3] == "paused"


async def test_leg_suspension_mid_leg_resumes(hass) -> None:
    rooms = _leg_rooms()
    manager = _leg_manager()

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def recharge() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Kitchen", "low_charge": True},
            )
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": "Office"}
            )
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Office", "low_charge": False},
            )

        hass.async_create_task(recharge(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (_leg_record(("Kitchen", "Office"), ("Kitchen", "Office")),)

    completed = await _async_run_leg(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        session_history=history,
    )

    assert completed is True
    manager.async_mark_suspended.assert_awaited_once()
    assert manager.async_mark_suspended.await_args.args[3] == "low_charge"


async def test_leg_completion_timeout_fails(hass) -> None:
    manager = _leg_manager()

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

    hass.services.async_register("vacuum", "send_command", send_command)

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            _leg_call(hass, completion_timeout=0),
            manager,
            "vacuum.matic",
            "serial",
            _leg_rooms(),
        )

    manager.async_mark_failed.assert_awaited_once()
    assert "completion timeout" in manager.async_mark_failed.await_args.args[3]


async def test_leg_matic_error_dispatch_fails(hass) -> None:
    manager = _leg_manager()

    async def send_command(_call) -> None:
        raise MaticError("synthetic")

    hass.services.async_register("vacuum", "send_command", send_command)

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _leg_rooms(),
        )

    manager.async_mark_failed.assert_awaited_once()


async def test_leg_replaced_dispatch_cancels(hass) -> None:
    manager = _leg_manager()

    async def send_command(_call) -> None:
        raise ManagedMotionReplacedError("replaced")

    hass.services.async_register("vacuum", "send_command", send_command)

    with pytest.raises(PlanCancelledError):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _leg_rooms(),
        )

    manager.async_mark_cancelled.assert_awaited_once()


@pytest.mark.parametrize("reason", [None, "config_entry_unload"])
async def test_leg_cancellation_records_history(hass, reason: str | None) -> None:
    manager = _leg_manager(reason)
    cancel_event = asyncio.Event()

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def cancel() -> None:
            await asyncio.sleep(0)
            cancel_event.set()

        hass.async_create_task(cancel(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)

    with pytest.raises(PlanCancelledError):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _leg_rooms(),
            cancel_event=cancel_event,
        )

    if reason is None:
        manager.async_mark_cancelled.assert_awaited_once()
    else:
        manager.async_mark_interrupted.assert_awaited_once()


async def test_leg_error_state_raises_robot_error(hass) -> None:
    manager = _leg_manager()

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def fail() -> None:
            await asyncio.sleep(0)
            hass.states.async_set("vacuum.matic", "error", {})

        hass.async_create_task(fail(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _leg_rooms(),
        )

    manager.async_mark_failed.assert_awaited_once()


async def test_leg_takeover_during_verification_interrupts(hass) -> None:
    manager = _leg_manager()

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def end_leg() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Kitchen", "low_charge": False},
            )

        hass.async_create_task(end_leg(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)

    async def takeover(*_args, **_kwargs) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Den"})

    manager.async_mark_verifying = AsyncMock(side_effect=takeover)

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _leg_rooms(),
            session_history=AsyncMock(return_value=()),
        )

    manager.async_mark_interrupted.assert_awaited_once()


async def test_leg_without_history_reader_credits_nothing(hass) -> None:
    manager = _leg_manager()

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def end_leg() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Kitchen", "low_charge": False},
            )

        hass.async_create_task(end_leg(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)

    completed = await _async_run_leg(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        _leg_rooms(),
    )

    assert completed is False
    assert manager.async_mark_ended_unverified.await_count == 2
    manager.async_mark_completed.assert_not_awaited()


async def test_leg_that_ends_in_place_is_interrupted_without_credit(hass) -> None:
    """A leg stopped mid-mission never credits the room it stood in."""
    rooms = _leg_rooms()
    manager = _leg_manager()

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def stop_in_place() -> None:
            await asyncio.sleep(0)
            hass.states.async_set("vacuum.matic", "idle", {"current_area": "Kitchen"})

        hass.async_create_task(stop_in_place(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    record = _leg_record(("Kitchen",), ("Kitchen",))

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            session_history=AsyncMock(return_value=(record,)),
            motion_token=7,
        )

    manager.async_mark_completed.assert_not_awaited()
    assert (
        manager.async_mark_interrupted.await_count
        + manager.async_mark_failed.await_count
        == 1
    )


async def test_leg_partial_verification_stops_started_next_leg(hass) -> None:
    rooms = _leg_rooms()
    manager = _leg_manager()

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def end_leg() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Kitchen", "low_charge": False},
            )

        hass.async_create_task(end_leg(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (_leg_record(("Kitchen",), ("Kitchen",), completed=False),)

    async def prefetch() -> _PreparedRoomDispatch:
        return _PreparedRoomDispatch(
            (_heavy_room("Den", "room-den"),), frozenset(), dt_util.utcnow()
        )

    sender = AsyncMock()
    completed = await _async_run_leg(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        session_history=history,
        managed_user_command=sender,
        motion_token=7,
        prefetch_next=prefetch,
    )

    assert completed is False
    sender.assert_awaited_once_with(7, UserCommand.STOP)


async def test_leg_verifier_filters_bad_records_and_ambiguity(hass) -> None:
    rooms = _leg_rooms()
    now = dt_util.utcnow()
    dispatched_at = now - timedelta(seconds=60)

    def session(
        rooms_value: tuple[str, ...],
        *,
        started: str | None = None,
        ended: str | None = None,
        durations: tuple[tuple[str, int], ...] | None = None,
    ) -> CleaningSession:
        return CleaningSession(
            started
            if started is not None
            else (now - timedelta(seconds=30)).isoformat(),
            ended if ended is not None else (now - timedelta(seconds=5)).isoformat(),
            25,
            rooms_value,
            durations if durations is not None else tuple((n, 20) for n in rooms_value),
            True,
            rooms_value,
        )

    baseline_key = b"old"
    records = (
        CleaningSessionRecord(baseline_key, session(("Kitchen",))),
        CleaningSessionRecord(b"foreign", session(("Garage",))),
        CleaningSessionRecord(
            b"unparsable", session(("Kitchen",), started="", ended="")
        ),
        CleaningSessionRecord(
            b"inverted",
            session(
                ("Kitchen",),
                started=now.isoformat(),
                ended=(now - timedelta(seconds=90)).isoformat(),
            ),
        ),
        CleaningSessionRecord(
            b"stale",
            session(
                ("Kitchen",),
                started=(now - timedelta(seconds=300)).isoformat(),
                ended=(now - timedelta(seconds=200)).isoformat(),
            ),
        ),
        CleaningSessionRecord(
            b"good",
            session(
                ("Kitchen", "Office"),
                durations=(("Kitchen", 20), ("Office", 0)),
            ),
        ),
    )

    evidence = await _async_verify_leg_completion(
        AsyncMock(return_value=records),
        frozenset({baseline_key}),
        rooms,
        dispatched_at,
        attempts=1,
    )
    assert evidence == {"room-kitchen": (records[-1].session.ended_at, 20)}

    ambiguous = (*records, CleaningSessionRecord(b"twin", session(("Office",))))
    assert (
        await _async_verify_leg_completion(
            AsyncMock(return_value=ambiguous),
            frozenset({baseline_key}),
            rooms,
            dispatched_at,
            attempts=1,
        )
        is None
    )

    assert (
        await _async_verify_leg_completion(
            AsyncMock(side_effect=MaticError("gone")),
            frozenset(),
            rooms,
            dispatched_at,
            attempts=1,
        )
        is None
    )
    assert (
        await _async_verify_leg_completion(
            None, frozenset(), rooms, dispatched_at, attempts=1
        )
        is None
    )


async def test_leg_unclassified_error_reraises_after_failure_mark(hass) -> None:
    manager = _leg_manager()

    async def send_command(_call) -> None:
        raise HomeAssistantError("boom")

    hass.services.async_register("vacuum", "send_command", send_command)

    with pytest.raises(HomeAssistantError):
        await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _leg_rooms(),
        )

    manager.async_mark_failed.assert_awaited_once()
    assert manager.async_mark_failed.await_args.args[3] == "boom"


async def test_leg_verifier_retries_and_honors_cancellation(hass) -> None:
    rooms = _leg_rooms()
    dispatched_at = dt_util.utcnow()

    with patch(
        "custom_components.matic_robot.services.SESSION_HISTORY_RETRY_SECONDS", 0
    ):
        assert (
            await _async_verify_leg_completion(
                AsyncMock(return_value=()),
                frozenset(),
                rooms,
                dispatched_at,
                attempts=2,
            )
            is None
        )

        cancel_event = asyncio.Event()
        cancel_event.set()
        reader = AsyncMock(return_value=())
        with pytest.raises(PlanCancelledError):
            await _async_verify_leg_completion(
                reader,
                frozenset(),
                rooms,
                dispatched_at,
                cancel_event=cancel_event,
                attempts=2,
            )

        quiet_cancel = asyncio.Event()
        assert (
            await _async_verify_leg_completion(
                AsyncMock(return_value=()),
                frozenset(),
                rooms,
                dispatched_at,
                cancel_event=quiet_cancel,
                attempts=2,
            )
            is None
        )

    late_cancel = asyncio.Event()
    hass.loop.call_later(0.05, late_cancel.set)
    with (
        patch(
            "custom_components.matic_robot.services.SESSION_HISTORY_RETRY_SECONDS", 1
        ),
        pytest.raises(PlanCancelledError),
    ):
        await _async_verify_leg_completion(
            AsyncMock(return_value=()),
            frozenset(),
            rooms,
            dispatched_at,
            cancel_event=late_cancel,
            attempts=2,
        )


async def test_a_task_that_ends_in_place_is_not_a_completion_candidate(hass) -> None:
    """Ending in place is a stop; only a return can end a room normally.

    Live traces on firmware v172.12: a stopped task goes straight to ``idle``
    where it stood, while a finished one goes ``returning`` first.  The robot's
    own record calls both completed, so this transition is the only thing that
    distinguishes them.
    """
    room = _room("Kitchen", "room-kitchen")
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

    async def settle(state: str) -> None:
        await asyncio.sleep(0)
        hass.states.async_set("vacuum.matic", state, {"current_area": "Kitchen"})

    hass.async_create_task(settle("idle"), eager_start=True)
    assert (
        await _async_wait_for_room_outcome(hass, "vacuum.matic", room)
        is RoomRunOutcome.STOPPED_IN_PLACE
    )

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})
    hass.async_create_task(settle("returning"), eager_start=True)
    assert (
        await _async_wait_for_room_outcome(hass, "vacuum.matic", room)
        is RoomRunOutcome.HANDOFF_CANDIDATE
    )

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})
    hass.async_create_task(settle("docked"), eager_start=True)
    assert (
        await _async_wait_for_room_outcome(hass, "vacuum.matic", room)
        is RoomRunOutcome.HANDOFF_CANDIDATE
    )


@pytest.mark.parametrize("real_store", [False, True])
async def test_leg_runs_two_rooms_in_one_mission_without_redispatch(
    hass, real_store
) -> None:
    """One leg mission glides room to room; credit comes from one record."""
    rooms = [_room("Kitchen", "room-kitchen"), _room("Office", "room-office")]
    manager = CleaningPlanManager(hass) if real_store else _leg_manager()
    if real_store:
        await manager.async_load()
        manager.async_mark_completed = AsyncMock(wraps=manager.async_mark_completed)
    commands = []

    async def send_command(call) -> None:
        commands.append(call.data)
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def glide() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": "Office"}
            )
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Office", "low_charge": False},
            )

        hass.async_create_task(glide(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    record: CleaningSessionRecord | None = None
    reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads, record
        reads += 1
        if reads == 1:
            return ()
        if record is None:
            record = _leg_record(("Kitchen", "Office"), ("Kitchen", "Office"))
        return (record,)

    started_events = []
    completed_events = []
    hass.bus.async_listen(
        f"{DOMAIN}_room_started", lambda e: started_events.append(e.data["room"])
    )
    hass.bus.async_listen(
        f"{DOMAIN}_room_completed", lambda e: completed_events.append(e.data["room"])
    )
    sender = AsyncMock()

    completed = await _async_run_leg(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        refresh=AsyncMock(),
        session_history=history,
        managed_user_command=sender,
        motion_token=7,
    )
    await hass.async_block_till_done()

    assert completed is True
    assert len(commands) == 1
    assert commands[0]["params"]["rooms"] == ["room-kitchen", "room-office"]
    assert started_events == ["Kitchen", "Office"]
    assert sorted(completed_events) == ["Kitchen", "Office"]
    assert manager.async_mark_completed.await_count == 2
    assert record is not None
    for call_args in manager.async_mark_completed.await_args_list:
        assert call_args.kwargs["duration_seconds"] == 57
        assert call_args.kwargs["completed_at"] == record.session.ended_at
    sender.assert_not_awaited()


async def test_leg_partial_record_credits_only_verified_subset(hass) -> None:
    rooms = [_room("Kitchen", "room-kitchen"), _room("Office", "room-office")]
    manager = _leg_manager()

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def end_leg() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Kitchen", "low_charge": False},
            )

        hass.async_create_task(end_leg(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (_leg_record(("Kitchen",), ("Kitchen",), completed=False),)

    sender = AsyncMock()
    completed = await _async_run_leg(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        session_history=history,
        managed_user_command=sender,
        motion_token=7,
    )

    assert completed is False
    manager.async_mark_completed.assert_awaited_once()
    assert manager.async_mark_completed.await_args.args[2].name == "Kitchen"
    manager.async_mark_ended_unverified.assert_awaited_once()
    assert manager.async_mark_ended_unverified.await_args.args[2].name == "Office"


async def test_leg_boundary_stop_finishes_current_room_only(hass) -> None:
    """A finish-current-room stop sends STOP at the observed room boundary."""
    rooms = [_room("Kitchen", "room-kitchen"), _room("Office", "room-office")]
    manager = _leg_manager()
    finish_room_event = asyncio.Event()

    async def send_command(call) -> None:
        if call.data.get("command") != "clean_rooms":
            return
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def cross_boundary() -> None:
            await asyncio.sleep(0)
            finish_room_event.set()
            hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": "Office"}
            )

        hass.async_create_task(cross_boundary(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (_leg_record(("Kitchen",), ("Kitchen",), completed=False),)

    sender = AsyncMock()

    async def stop_then_return(token, command) -> None:
        assert command is UserCommand.STOP
        hass.states.async_set(
            "vacuum.matic",
            "returning",
            {"current_area": "Office", "low_charge": False},
        )

    sender.side_effect = stop_then_return

    completed = await _async_run_leg(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        session_history=history,
        managed_user_command=sender,
        motion_token=7,
        finish_room_event=finish_room_event,
    )

    assert completed is False
    sender.assert_awaited_once_with(7, UserCommand.STOP)
    manager.async_mark_completed.assert_awaited_once()
    assert manager.async_mark_completed.await_args.args[2].name == "Kitchen"
    manager.async_mark_cancelled.assert_awaited_once()
    assert manager.async_mark_cancelled.await_args.args[2].name == "Office"


async def test_room_handoff_dispatches_next_room_before_history_settles(hass) -> None:
    """The next room is commanded at the observed return, before verification."""
    room = _room("Kitchen", "room-kitchen")
    next_room = _room("Study", "room-study")
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def finish_room() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Kitchen", "low_charge": False},
            )

        hass.async_create_task(finish_room(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)
    prefetched = False

    async def history() -> tuple[CleaningSessionRecord, ...]:
        # The native record settles only after the next room is underway.
        if not prefetched:
            return ()
        ended = dt_util.utcnow()
        return (
            CleaningSessionRecord(
                b"kitchen",
                CleaningSession(
                    (ended - timedelta(seconds=5)).isoformat(),
                    ended.isoformat(),
                    5,
                    ("Kitchen",),
                    (("Kitchen", 5),),
                    True,
                ),
            ),
        )

    async def prefetch() -> _PreparedRoomDispatch:
        nonlocal prefetched
        prefetched = True
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Study"})
        return _PreparedRoomDispatch((next_room,), frozenset(), dt_util.utcnow())

    sender = AsyncMock()
    completed = await _async_run_room(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        room,
        session_history=history,
        managed_user_command=sender,
        prefetch_next=prefetch,
    )

    assert completed is True
    assert prefetched is True
    manager.async_mark_completed.assert_awaited_once()
    sender.assert_not_awaited()


async def test_room_unverified_eager_handoff_stops_the_started_next_room(
    hass,
) -> None:
    """An unverified current room stops its eagerly dispatched next room."""
    room = _room("Kitchen", "room-kitchen")
    next_room = _room("Study", "room-study")
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )

    async def send_command(_call) -> None:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def finish_room() -> None:
            await asyncio.sleep(0)
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": "Kitchen", "low_charge": False},
            )

        hass.async_create_task(finish_room(), eager_start=True)

    hass.services.async_register("vacuum", "send_command", send_command)

    async def prefetch() -> _PreparedRoomDispatch:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Study"})
        return _PreparedRoomDispatch((next_room,), frozenset(), dt_util.utcnow())

    sender = AsyncMock()
    with patch("custom_components.matic_robot.services.HANDOFF_HISTORY_ATTEMPTS", 1):
        completed = await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
            session_history=AsyncMock(return_value=()),
            managed_user_command=sender,
            motion_token=7,
            prefetch_next=prefetch,
        )

    assert completed is False
    sender.assert_awaited_once_with(7, UserCommand.STOP)
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()


async def test_room_accepts_only_matching_prepared_dispatch() -> None:
    room = _room("Kitchen", "room-kitchen")
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    hass = SimpleNamespace(
        services=SimpleNamespace(async_call=AsyncMock()),
        bus=SimpleNamespace(async_fire=MagicMock()),
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    prepared = _PreparedRoomDispatch((room,), None, dt_util.utcnow())
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
    ):
        assert not await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
            active_session=AsyncMock(return_value=False),
            prepared_dispatch=prepared,
        )

    wrong = _PreparedRoomDispatch(
        (_room("Study", "room-study"),), None, dt_util.utcnow()
    )
    with pytest.raises(ValueError, match="does not match"):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
            prepared_dispatch=wrong,
        )


@pytest.mark.parametrize("failure_stage", ["initial_unknown", "later_unknown"])
async def test_unknown_active_session_interrupts_without_room_credit(
    failure_stage,
) -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(
        services=services,
        bus=bus,
        states=SimpleNamespace(get=MagicMock(return_value=None)),
    )
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    reader = (
        AsyncMock(return_value=None)
        if failure_stage == "initial_unknown"
        else AsyncMock(side_effect=[True, None, None, None])
    )
    sender = AsyncMock()
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
        patch("custom_components.matic_robot.services.asyncio.sleep", AsyncMock()),
        pytest.raises(ServiceValidationError) as interrupted,
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
            active_session=reader,
            motion_token=10,
            managed_user_command=sender,
        )

    assert interrupted.value.translation_key == "room_interrupted"
    sender.assert_awaited_once_with(10, UserCommand.STOP)
    manager.async_mark_completed.assert_not_awaited()


async def test_room_starting_paused_is_suspended_until_resume() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    wait = AsyncMock(side_effect=["paused", "cleaning"])
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            wait,
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
            active_session=AsyncMock(return_value=False),
        )

    manager.async_mark_suspended.assert_awaited_once()
    assert wait.await_count == 2
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()


async def test_room_pause_and_resume_outcome() -> None:
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_suspended=AsyncMock(),
        async_mark_resumed=AsyncMock(),
    )
    room = _room("Kitchen", "room-kitchen")
    wait = AsyncMock(return_value="cleaning")
    run = _async_run_room(
        hass,
        _call(hass),
        manager,
        "vacuum.matic",
        "serial",
        room,
        active_session=AsyncMock(return_value=False),
    )
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            wait,
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(
                side_effect=[
                    RoomRunOutcome.PAUSED,
                    RoomRunOutcome.HANDOFF_CANDIDATE,
                ]
            ),
        ),
    ):
        await run

    manager.async_mark_suspended.assert_awaited_once_with(
        "serial", "away", room, "paused"
    )
    manager.async_mark_ended_unverified.assert_awaited_once()
    manager.async_mark_completed.assert_not_awaited()


async def test_room_interruption_and_replaced_dispatch_never_complete() -> None:
    room = _room("Kitchen", "room-kitchen")
    for interrupted in (True, False):
        services = SimpleNamespace(async_call=AsyncMock())
        bus = SimpleNamespace(async_fire=MagicMock())
        hass = SimpleNamespace(services=services, bus=bus)
        manager = SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_interrupted=AsyncMock(),
            async_mark_cancelled=AsyncMock(),
            async_mark_resumed=AsyncMock(),
            cancellation_reason=MagicMock(return_value=None),
        )
        if interrupted:
            outcome = AsyncMock(return_value=RoomRunOutcome.INTERRUPTED)
            state = AsyncMock(return_value="cleaning")
        else:
            services.async_call.side_effect = ManagedMotionReplacedError("replaced")
            outcome = AsyncMock()
            state = AsyncMock()
        sender = AsyncMock()
        with (
            patch(
                "custom_components.matic_robot.services._async_wait_for_room_outcome",
                outcome,
            ),
            patch(
                "custom_components.matic_robot.services._async_wait_for_vacuum_state",
                state,
            ),
            pytest.raises(
                ServiceValidationError if interrupted else PlanCancelledError
            ),
        ):
            await _async_run_room(
                hass,
                _call(hass),
                manager,
                "vacuum.matic",
                "serial",
                room,
                motion_token=4,
                managed_user_command=sender,
            )
        manager.async_mark_completed.assert_not_awaited()
        if interrupted:
            manager.async_mark_resumed.assert_awaited_once()
            manager.async_mark_interrupted.assert_awaited_once()
            assert (
                bus.async_fire.call_args_list[-1].args[0].endswith("room_interrupted")
            )
        else:
            manager.async_mark_resumed.assert_not_awaited()
            manager.async_mark_cancelled.assert_awaited_once()
            sender.assert_not_awaited()


async def test_unload_cancellation_stops_and_persists_interruption() -> None:
    """Config-entry unload stops accepted motion and never credits the room."""
    services = SimpleNamespace(async_call=AsyncMock())
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(),
        async_mark_completed=AsyncMock(),
        async_mark_ended_unverified=AsyncMock(),
        async_mark_verifying=AsyncMock(),
        async_mark_failed=AsyncMock(),
        async_mark_interrupted=AsyncMock(),
        async_mark_cancelled=AsyncMock(),
        async_mark_resumed=AsyncMock(),
        cancellation_reason=MagicMock(return_value="config_entry_unload"),
    )
    sender = AsyncMock()
    with (
        patch(
            "custom_components.matic_robot.services._async_wait_for_vacuum_state",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.services._async_wait_for_room_outcome",
            AsyncMock(side_effect=PlanCancelledError),
        ),
        pytest.raises(PlanCancelledError),
    ):
        await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            _room("Kitchen", "room-kitchen"),
            motion_token=8,
            managed_user_command=sender,
        )

    sender.assert_awaited_once_with(8, UserCommand.STOP)
    manager.async_mark_interrupted.assert_awaited_once()
    manager.async_mark_cancelled.assert_not_awaited()
    manager.async_mark_completed.assert_not_awaited()


async def test_wait_handles_error_unavailable_transition_and_cancel(hass) -> None:
    hass.states.async_set("vacuum.matic", "error")
    with pytest.raises(ServiceValidationError, match="error"):
        await _async_wait_for_vacuum_state(hass, "vacuum.matic", {"cleaning"}, 10)

    hass.states.async_set("vacuum.matic", "unavailable")
    waiting = asyncio.create_task(
        _async_wait_for_vacuum_state(hass, "vacuum.matic", {"cleaning"}, 10)
    )
    await asyncio.sleep(0)
    hass.states.async_set("vacuum.matic", "cleaning")
    assert await waiting == "cleaning"

    cancel = asyncio.Event()
    waiting = asyncio.create_task(
        _async_wait_for_vacuum_state(hass, "vacuum.matic", {"docked"}, 10, cancel)
    )
    await asyncio.sleep(0)
    cancel.set()
    with pytest.raises(PlanCancelledError):
        await waiting

    room = _room("Study", "room-study")
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})
    target_wait = asyncio.create_task(
        _async_wait_for_vacuum_state(hass, "vacuum.matic", {"cleaning"}, 10, room=room)
    )
    await asyncio.sleep(0)
    assert target_wait.done() is False
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": " The   Study "})
    assert await target_wait == "cleaning"


async def test_room_outcome_requires_target_evidence_and_classifies_recharge(
    hass,
) -> None:
    room = _room("Study", "room-study")
    hass.states.async_set("vacuum.matic", "returning", {"low_charge": False})
    assert (
        await _async_wait_for_room_outcome(hass, "vacuum.matic", room)
        is RoomRunOutcome.INTERRUPTED
    )

    hass.states.async_set(
        "vacuum.matic",
        "returning",
        {"current_area": "Study", "low_charge": True},
    )
    assert (
        await _async_wait_for_room_outcome(hass, "vacuum.matic", room)
        is RoomRunOutcome.SUSPENDED
    )

    hass.states.async_set("vacuum.matic", "paused", {"current_area": "Study"})
    assert (
        await _async_wait_for_room_outcome(hass, "vacuum.matic", room)
        is RoomRunOutcome.PAUSED
    )

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": None})
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room)
    )
    await asyncio.sleep(0)
    hass.states.async_set("vacuum.matic", "idle")
    assert await waiting is RoomRunOutcome.STOPPED_IN_PLACE

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "room-study"})
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room)
    )
    await asyncio.sleep(0)
    hass.states.async_set(
        "vacuum.matic",
        "returning",
        {"previous_area": "Study", "low_charge": False},
    )
    hass.states.async_set("vacuum.matic", "docked")
    assert await waiting is RoomRunOutcome.HANDOFF_CANDIDATE


async def test_room_outcome_propagates_errors_and_cancellation(hass) -> None:
    room = _room("Study", "room-study")
    hass.states.async_set("vacuum.matic", "error")
    with pytest.raises(ServiceValidationError, match="reported an error"):
        await _async_wait_for_room_outcome(hass, "vacuum.matic", room)

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Study"})
    cancel = asyncio.Event()
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room, cancel)
    )
    await asyncio.sleep(0)
    cancel.set()
    with pytest.raises(PlanCancelledError):
        await waiting

    cancel.clear()
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Study"})
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room, cancel)
    )
    await asyncio.sleep(0)
    hass.states.async_set("vacuum.matic", "returning", {"low_charge": False})
    assert await waiting is RoomRunOutcome.HANDOFF_CANDIDATE

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Study"})
    stopped = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room)
    )
    await asyncio.sleep(0)
    hass.states.async_set("vacuum.matic", "idle", {"current_area": "Study"})
    # Ending in place is a stop, never a finished room.
    assert await stopped is RoomRunOutcome.STOPPED_IN_PLACE


async def test_room_outcome_ignores_transit_through_other_mapped_rooms(hass) -> None:
    room = _room("Study", "room-study")
    rooms = {"room-study": "Study", "room-kitchen": "Kitchen"}
    hass.states.async_set(
        "vacuum.matic",
        "cleaning",
        {"current_area": "Study", "rooms": rooms},
    )
    waiting = asyncio.create_task(
        _async_wait_for_room_outcome(hass, "vacuum.matic", room)
    )
    await asyncio.sleep(0)
    hass.states.async_set(
        "vacuum.matic",
        "cleaning",
        {"current_area": None, "rooms": rooms},
    )
    await asyncio.sleep(0)
    assert waiting.done() is False
    hass.states.async_set(
        "vacuum.matic",
        "cleaning",
        {"current_area": "Hallway transit", "rooms": rooms},
    )
    await asyncio.sleep(0)
    assert waiting.done() is False
    hass.states.async_set(
        "vacuum.matic",
        "cleaning",
        {"current_area": "the Kitchen", "rooms": rooms},
    )
    await asyncio.sleep(0)
    assert waiting.done() is False
    hass.states.async_set(
        "vacuum.matic",
        "docked",
        {"current_area": "Kitchen", "rooms": rooms},
    )
    assert await waiting is RoomRunOutcome.HANDOFF_CANDIDATE


async def test_execute_rooms_rejects_overlap_handles_cancel_and_returns_home(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    call = _call(hass, return_to_base=True)
    lock = manager.lock("serial")
    await lock.acquire()
    try:
        with pytest.raises(ServiceValidationError, match="already running"):
            await _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                [room],
                intelligent=True,
            )
    finally:
        lock.release()

    with patch(
        "custom_components.matic_robot.services._async_run_room",
        AsyncMock(side_effect=PlanCancelledError),
    ):
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [room],
            intelligent=True,
        )

    service_call = AsyncMock()
    managed_command = AsyncMock()
    fake_hass = SimpleNamespace(
        services=SimpleNamespace(async_call=service_call),
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="idle"))
        ),
    )
    with patch(
        "custom_components.matic_robot.services._async_run_room", AsyncMock()
    ) as run:
        await _async_execute_rooms(
            fake_hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [room],
            intelligent=False,
            managed_user_command=managed_command,
        )
    run.assert_awaited_once()
    managed_command.assert_awaited_once()
    assert managed_command.await_args.args[1] is UserCommand.DOCK
    service_call.assert_not_awaited()
    service_call.assert_not_awaited()


async def test_execute_rooms_finishes_current_room_then_stops_and_docks(hass) -> None:
    """A graceful stop never dispatches the next room and always returns home."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    service_call = AsyncMock()
    managed_command = AsyncMock()
    fake_hass = SimpleNamespace(
        services=SimpleNamespace(async_call=service_call),
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="idle"))
        ),
    )
    call = _call(fake_hass, return_to_base=False)

    async def finish_then_stop(*_args, **_kwargs) -> bool:
        manager.finish_room_event("serial").set()
        return True

    with patch(
        "custom_components.matic_robot.services._async_run_leg",
        AsyncMock(side_effect=finish_then_stop),
    ) as run:
        await _async_execute_rooms(
            fake_hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [_room("Kitchen", "one"), _heavy_room("Study", "two")],
            intelligent=False,
            managed_user_command=managed_command,
        )

    run.assert_awaited_once()
    managed_command.assert_awaited_once()
    assert managed_command.await_args.args[1] is UserCommand.DOCK


async def test_execute_rooms_groups_same_settings_rooms_into_one_leg(hass) -> None:
    """Consecutive same-settings rooms run as one native mission leg."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        _room("Kitchen", "room-kitchen"),
        _room("Office", "room-office"),
        CleaningRoom(
            room_id="room-master",
            name="Master Bedroom",
            cleaning_mode="vacuum",
            coverage_setting="standard",
        ),
    ]
    fake_hass = SimpleNamespace(
        services=SimpleNamespace(async_call=AsyncMock()),
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="docked"))
        ),
    )
    legs_seen = []

    async def run_leg(*args, **kwargs) -> bool:
        legs_seen.append(args[5])
        return True

    with patch(
        "custom_components.matic_robot.services._async_run_leg",
        side_effect=run_leg,
    ):
        await _async_execute_rooms(
            fake_hass,
            _call(fake_hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
        )

    assert legs_seen == [[rooms[0], rooms[1]], [rooms[2]]]


async def test_execute_rooms_prepares_next_command_during_current_return(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        _room("Kitchen", "room-kitchen"),
        _heavy_room("Study", "room-study"),
    ]
    service_call = AsyncMock()
    managed_command = AsyncMock()
    fake_hass = SimpleNamespace(
        services=SimpleNamespace(async_call=service_call),
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="idle"))
        ),
    )
    prepared: _PreparedRoomDispatch | None = None

    async def run_leg(*args, **kwargs) -> bool:
        nonlocal prepared
        leg = args[5]
        if leg == [rooms[0]]:
            assert kwargs["prepared_dispatch"] is None
            prepared = await kwargs["prefetch_next"]()
            assert prepared is not None
            assert prepared.rooms == (rooms[1],)
            assert await kwargs["prefetch_next"]() == prepared
        else:
            assert leg == [rooms[1]]
            assert kwargs["prepared_dispatch"] == prepared
            assert kwargs["prefetch_next"] is None
        return True

    with patch(
        "custom_components.matic_robot.services._async_run_leg",
        side_effect=run_leg,
    ) as run:
        await _async_execute_rooms(
            fake_hass,
            _call(fake_hass, return_to_base=True),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
            session_history=AsyncMock(return_value=()),
            managed_user_command=managed_command,
        )

    assert run.await_count == 2
    service_call.assert_awaited_once()
    assert service_call.await_args.args[:2] == ("vacuum", "send_command")
    assert service_call.await_args.args[2]["params"]["rooms"] == ["room-study"]
    managed_command.assert_awaited_once_with(1, UserCommand.DOCK)


async def test_execute_rooms_cleans_up_prefetch_when_graceful_stop_arrives(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        _room("Kitchen", "room-kitchen"),
        _heavy_room("Study", "room-study"),
    ]
    fake_hass = SimpleNamespace(
        services=SimpleNamespace(async_call=AsyncMock()),
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="returning"))
        ),
    )
    managed_command = AsyncMock()

    async def run_leg(*_args, **kwargs) -> bool:
        assert await kwargs["prefetch_next"]() is not None
        manager.finish_room_event("serial").set()
        return True

    with patch(
        "custom_components.matic_robot.services._async_run_leg",
        side_effect=run_leg,
    ) as run:
        await _async_execute_rooms(
            fake_hass,
            _call(fake_hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
            session_history=AsyncMock(return_value=()),
            managed_user_command=managed_command,
        )

    run.assert_awaited_once()
    managed_command.assert_awaited_once_with(1, UserCommand.STOP)


async def test_execute_rooms_falls_back_when_prefetch_is_unavailable(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        _room("Kitchen", "room-kitchen"),
        _heavy_room("Study", "room-study"),
    ]
    fake_hass = SimpleNamespace(
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="returning"))
        )
    )

    async def run_leg(*_args, **kwargs) -> bool:
        assert await kwargs["prefetch_next"]() is None
        return False

    with (
        patch(
            "custom_components.matic_robot.services._async_run_leg",
            side_effect=run_leg,
        ) as run,
        patch(
            "custom_components.matic_robot.services._async_dispatch_leg_command",
            AsyncMock(side_effect=HomeAssistantError("synthetic failure")),
        ),
    ):
        await _async_execute_rooms(
            fake_hass,
            _call(fake_hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
        )

    run.assert_awaited_once()


async def test_execute_rooms_skips_prefetch_after_stop_request(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        _room("Kitchen", "room-kitchen"),
        _heavy_room("Study", "room-study"),
    ]
    managed_command = AsyncMock()
    fake_hass = SimpleNamespace(
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="returning"))
        )
    )

    async def run_leg(*_args, **kwargs) -> bool:
        manager.finish_room_event("serial").set()
        assert await kwargs["prefetch_next"]() is None
        return True

    with patch(
        "custom_components.matic_robot.services._async_run_leg",
        side_effect=run_leg,
    ):
        await _async_execute_rooms(
            fake_hass,
            _call(fake_hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
            managed_user_command=managed_command,
        )

    managed_command.assert_not_awaited()


async def test_execute_rooms_skips_prefetch_while_stop_fence_pending(hass) -> None:
    """No next room may be prepared while an OEM stop countdown settles."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        _room("Kitchen", "room-kitchen"),
        _heavy_room("Study", "room-study"),
    ]
    fake_hass = SimpleNamespace(
        services=SimpleNamespace(async_call=AsyncMock()),
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="returning"))
        ),
    )

    async def run_leg(*_args, **kwargs) -> bool:
        manager.mark_stop_pending("serial")
        assert await kwargs["prefetch_next"]() is None
        return False

    with patch(
        "custom_components.matic_robot.services._async_run_leg",
        side_effect=run_leg,
    ) as run:
        await _async_execute_rooms(
            fake_hass,
            _call(fake_hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
        )

    run.assert_awaited_once()
    fake_hass.services.async_call.assert_not_awaited()


async def test_execute_rooms_stops_after_unverified_room(hass) -> None:
    """A terminal room without native completion never dispatches the next room."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        _room("Kitchen", "room-kitchen"),
        _heavy_room("Study", "room-study"),
    ]
    managed_command = AsyncMock()
    hass.states.async_set("vacuum.matic", "idle")

    with patch(
        "custom_components.matic_robot.services._async_run_leg",
        AsyncMock(return_value=False),
    ) as run:
        await _async_execute_rooms(
            hass,
            _call(hass, return_to_base=True),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
            managed_user_command=managed_command,
        )

    run.assert_awaited_once()
    assert run.await_args.args[5] == [rooms[0]]
    managed_command.assert_awaited_once()
    assert managed_command.await_args.args[1] is UserCommand.DOCK


async def test_execute_rooms_rechecks_ownership_after_room_history_save(hass) -> None:
    """A replacement after room completion prevents the old plan from docking."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    managed_command = AsyncMock()
    fake_hass = SimpleNamespace(
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="idle"))
        )
    )

    async def replace_after_room(*_args, **_kwargs) -> bool:
        manager.replace_managed_motion("serial")
        return True

    with patch(
        "custom_components.matic_robot.services._async_run_room",
        AsyncMock(side_effect=replace_after_room),
    ):
        await _async_execute_rooms(
            fake_hass,
            _call(fake_hass, return_to_base=True),
            manager,
            "vacuum.matic",
            "serial",
            [_room("Kitchen", "one")],
            intelligent=False,
            managed_user_command=managed_command,
        )

    managed_command.assert_not_awaited()
    assert manager.lock("serial").locked() is False


async def test_execute_rooms_handles_final_ownership_and_dock_failures(hass) -> None:
    room = _room("Kitchen", "one")
    fake_hass = SimpleNamespace(
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="idle"))
        )
    )
    call = _call(fake_hass, return_to_base=True)

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    with (
        patch("custom_components.matic_robot.services._async_run_room", AsyncMock()),
        patch.object(
            manager,
            "managed_motion_is_current",
            MagicMock(side_effect=[True, True, False]),
        ),
    ):
        await _async_execute_rooms(
            fake_hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            [room],
            intelligent=False,
            managed_user_command=AsyncMock(),
        )

    for error in (
        ManagedMotionReplacedError("replaced"),
        MaticError("synthetic dock failure"),
    ):
        manager = CleaningPlanManager(hass)
        manager._store = SimpleNamespace(async_save=AsyncMock())
        sender = AsyncMock(side_effect=error)
        with patch(
            "custom_components.matic_robot.services._async_run_room", AsyncMock()
        ):
            run = _async_execute_rooms(
                fake_hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                [room],
                intelligent=False,
                managed_user_command=sender,
            )
            if isinstance(error, MaticError):
                with pytest.raises(ServiceValidationError) as failure:
                    await run
                assert failure.value.translation_key == "robot_command_failed"
            else:
                await run
        sender.assert_awaited_once()


async def test_config_unload_waits_for_managed_runner(hass) -> None:
    """Entry teardown cannot close the client while its runner is still live."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    entered = asyncio.Event()

    async def wait_for_cancel(*_args, **_kwargs) -> None:
        entered.set()
        await manager.cancellation_event("serial").wait()
        raise PlanCancelledError

    fake_hass = SimpleNamespace(
        states=SimpleNamespace(
            get=MagicMock(return_value=SimpleNamespace(state="idle"))
        )
    )
    with patch(
        "custom_components.matic_robot.services._async_run_room",
        AsyncMock(side_effect=wait_for_cancel),
    ):
        task = asyncio.create_task(
            _async_execute_rooms(
                fake_hass,
                _call(fake_hass),
                manager,
                "vacuum.matic",
                "serial",
                [_room("Kitchen", "one")],
                intelligent=False,
            )
        )
        await entered.wait()
        await manager.async_cancel_and_wait("serial")

    assert task.done()
    assert manager.lock("serial").locked() is False


async def test_run_task_lifecycle_edge_cases(hass) -> None:
    manager = CleaningPlanManager(hass)
    assert manager.cancellation_reason("serial") is None
    await manager.async_cancel_and_wait("serial")
    with (
        patch(
            "custom_components.matic_robot.plans.asyncio.current_task",
            return_value=None,
        ),
        pytest.raises(RuntimeError, match="no current task"),
    ):
        manager.register_run_task("serial")

    manager.register_run_task("serial")
    await manager.async_cancel_and_wait("serial")
    manager.unregister_run_task("serial")


async def test_reconciliation_tasks_are_lifecycle_bound(hass) -> None:
    manager = CleaningPlanManager(hass)
    started = asyncio.Event()

    async def reconcile() -> None:
        started.set()
        await asyncio.Event().wait()

    task = asyncio.create_task(reconcile())
    manager.register_reconciliation_task("serial", task)
    await started.wait()
    await manager.async_cancel_and_wait("serial")
    assert task.cancelled()
    assert "serial" not in manager._reconciliation_tasks

    finished = asyncio.create_task(asyncio.sleep(0))
    manager.register_reconciliation_task("serial", finished)
    await finished
    await asyncio.sleep(0)
    assert "serial" not in manager._reconciliation_tasks


async def test_replacing_motion_cancels_obsolete_reconciliation(hass) -> None:
    manager = CleaningPlanManager(hass)
    task = asyncio.create_task(asyncio.Event().wait())
    manager.register_reconciliation_task("serial", task)
    manager.replace_managed_motion("serial")
    await asyncio.gather(task, return_exceptions=True)
    assert task.cancelled()


async def test_active_session_readers_are_bounded_and_cancel_safe(hass) -> None:
    assert await _async_active_session_state(None) is None
    with patch("custom_components.matic_robot.services.asyncio.sleep", AsyncMock()):
        assert (
            await _async_active_session_state(
                AsyncMock(side_effect=[None, None, False])
            )
            is False
        )
        assert (
            await _async_active_session_state(
                AsyncMock(side_effect=[MaticError("temporary"), False])
            )
            is False
        )

    hass.states.async_set("vacuum.matic", "cleaning")
    assert (
        await _async_wait_for_active_session_resolution(
            hass, "vacuum.matic", AsyncMock(return_value=True)
        )
        is True
    )
    hass.states.async_set("vacuum.matic", "error")
    with pytest.raises(ServiceValidationError, match="reported an error"):
        await _async_wait_for_active_session_resolution(
            hass, "vacuum.matic", AsyncMock(return_value=True)
        )

    hass.states.async_set("vacuum.matic", "returning")
    with patch("custom_components.matic_robot.services.asyncio.sleep", AsyncMock()):
        assert (
            await _async_wait_for_active_session_resolution(
                hass, "vacuum.matic", AsyncMock(return_value=None)
            )
            is None
        )
        assert (
            await _async_wait_for_active_session_resolution(
                hass,
                "vacuum.matic",
                AsyncMock(side_effect=[MaticError("temporary"), False]),
            )
            is False
        )
    assert (
        await _async_wait_for_active_session_resolution(hass, "vacuum.matic", None)
        is None
    )

    cancelled = asyncio.Event()
    cancelled.set()
    with pytest.raises(PlanCancelledError):
        await _async_wait_for_active_session_resolution(
            hass, "vacuum.matic", AsyncMock(return_value=True), cancelled
        )

    cancelled.clear()

    async def set_cancel() -> bool:
        cancelled.set()
        return True

    with pytest.raises(PlanCancelledError):
        await _async_wait_for_active_session_resolution(
            hass, "vacuum.matic", set_cancel, cancelled
        )

    with patch(
        "custom_components.matic_robot.services.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0,
    ):
        assert (
            await _async_wait_for_active_session_resolution(
                hass,
                "vacuum.matic",
                AsyncMock(side_effect=[True, False]),
                asyncio.Event(),
            )
            is False
        )


def test_entry_lookup_rejects_missing_registry_entry() -> None:
    registry = SimpleNamespace(async_get=MagicMock(return_value=None))
    with (
        patch(
            "custom_components.matic_robot.services.er.async_get",
            return_value=registry,
        ),
        pytest.raises(ServiceValidationError, match="unavailable"),
    ):
        _entry_for_entity(SimpleNamespace(), "vacuum.matic")


async def test_finish_room_threshold_never_rounds_progress_up(hass) -> None:
    """Just-below progress stops now; the exact threshold finishes the room."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    await manager.async_save_plan(
        "serial",
        "away",
        {
            "name": "Away",
            "finish_current_room": True,
            "finish_current_room_threshold": 50,
            "rooms": [],
        },
    )
    for _ in range(3):
        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        await manager.async_mark_completed("serial", "away", room, duration_seconds=100)

    lock = manager.lock("serial")
    await lock.acquire()
    try:
        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        active = manager._data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 49.9
        active["active_segment_started"] = None

        assert manager.request_stop("serial") == PlanStopDecision("immediate", 49, 50)
        assert manager.cancellation_event("serial").is_set()

        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        active = manager._data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 50.0
        active["active_segment_started"] = None

        assert manager.request_stop("serial") == PlanStopDecision("after_room", 50, 50)
        assert manager.finish_room_event("serial").is_set()
        assert not manager.cancellation_event("serial").is_set()
    finally:
        lock.release()


@pytest.mark.parametrize("failure", [RuntimeError, asyncio.CancelledError])
@pytest.mark.parametrize("still_cleaning", [False, True])
async def test_execute_history_failure_does_not_orphan_verifying_room(
    hass, failure, still_cleaning
):
    """The real runner must retire ownership even when verification aborts."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    rooms = _leg_rooms()
    reads = 0

    async def send_command(_call):
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Kitchen"})

        async def finish():
            await asyncio.sleep(0)
            hass.states.async_set("vacuum.matic", "docked", {"current_area": "Kitchen"})

        hass.async_create_task(finish(), eager_start=True)

    async def history():
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        assert manager.snapshot("serial")["active_plan"]["status"] == "verifying"
        if still_cleaning:
            hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": "Kitchen"}
            )
        raise failure("synthetic verification abort")

    hass.services.async_register("vacuum", "send_command", send_command)
    sender = AsyncMock()
    with pytest.raises(failure):
        await _async_execute_rooms(
            hass,
            _leg_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            intelligent=False,
            session_history=history,
            managed_user_command=sender,
        )
    assert not manager.lock("serial").locked()
    snapshot = manager.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert snapshot["completed_runs"] == 0
    assert snapshot["interrupted_runs"] == 1
    restored = CleaningPlanManager(hass)
    await restored.async_load()
    assert restored.snapshot("serial")["active_plan"] is None
    if still_cleaning:
        assert sender.await_count == 1
        assert sender.await_args.args[1] is UserCommand.STOP
    else:
        sender.assert_not_awaited()
