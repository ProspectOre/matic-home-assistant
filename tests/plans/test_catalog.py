"""Saved plans and rooms: resolution, validation, limits and loading."""

import asyncio
from datetime import timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.plan_model as plan_model_module
import custom_components.matic_robot.plan_state as plan_state_module
from custom_components.matic_robot.managed_executor import async_execute_rooms
from custom_components.matic_robot.plan_catalog import (
    MAX_SAVED_PLANS_PER_ROBOT,
    SavedPlanLimitError,
)
from custom_components.matic_robot.plan_model import (
    CleaningRoom,
    leg_groups,
    resolve_room_reference,
    resolve_rooms,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.plans.fakes import (
    memory_manager,
    plan_room,
    rotation_explanation,
    run_plan_call,
)
from tests.session_fakes import FakeRobot


def test_leg_groups_share_one_mission_across_settings_changes() -> None:
    quick = plan_room("Living Room", "room-a")
    standard = CleaningRoom("room-c", "Master Bedroom", "vacuum", "standard")
    mop = CleaningRoom("mop-a", "Mop A", "mop", "heavy_duty")

    assert leg_groups([quick, standard, mop]) == [[quick, standard, mop]]
    assert leg_groups([quick, standard, mop], single_room_missions=True) == [
        [quick],
        [standard],
        [mop],
    ]
    assert leg_groups([quick]) == [[quick]]
    assert leg_groups([]) == []
    assert leg_groups([], single_room_missions=True) == []


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


async def test_load_repairs_malformed_plan_storage_without_inventing_history(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(
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
                        "last_run": "not-a-run",
                    },
                }
            }
        ),
        async_save=AsyncMock(),
    )

    await manager.async_load()

    assert set(manager.repository.data["robots"]) == {"serial"}
    assert manager.repository.data["robots"]["serial"] == {
        "rotations": {
            "away": {"rooms": {}},
            "other": {"rooms": {}},
            "third": {"rooms": {}},
        },
        "rooms": {},
        "plans": {"valid": {"name": "Valid", "rooms": []}},
        "areas": {},
        "area_history": {},
        "rotation_resets": {},
        "shared_room_cadence": {},
        "plan_room_cadence": {},
        "managed_native_sessions": {},
        "native_completion_dedup": [],
        "selected_plan": "valid",
        "selected_area": None,
        "active_plan": None,
        "last_run": None,
    }
    manager.repository.store.async_save.assert_awaited_once_with(
        manager.repository.data
    )

    root_repair = CleaningPlanManager(hass)
    root_repair.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value={"robots": "not-a-container"}),
        async_save=AsyncMock(),
    )
    await root_repair.async_load()
    assert root_repair.repository.data == {"robots": {}}
    root_repair.repository.store.async_save.assert_awaited_once_with(
        root_repair.repository.data
    )


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
    manager.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=stored), async_save=AsyncMock()
    )

    await manager.async_load()

    snapshot = manager.history.snapshot("serial")
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
    manager.repository.store.async_save.assert_awaited_once_with(
        manager.repository.data
    )


async def test_room_native_plan_lifecycle_preview_selection_and_reset(hass) -> None:
    manager = memory_manager(hass)
    room_map = {"room-kitchen": "Kitchen", "room-study": "Study"}

    await manager.catalog.async_save_plan(
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
    assert list(manager.catalog.plans("serial")) == ["whole_home"]
    assert manager.catalog.plan("serial")["name"] == "Whole home"
    preview = manager.planning.preview("serial", room_map)
    assert [room["name"] for room in preview["rooms"]] == ["Kitchen", "Study"]
    assert preview["rotation_basis"] == "least_recent_opportunity"
    assert [item["room"] for item in preview["rotation"]] == [
        "Kitchen",
        "Study",
    ]
    assert all(
        item["selection_reason"] == "no_prior_opportunity"
        for item in preview["rotation"]
    )

    await manager.catalog.async_save_plan(
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
    await manager.catalog.async_select_plan("serial", "whole_home")
    assert manager.history.snapshot("serial")["selected_plan_name"] == "Whole home"
    await manager.ledger.async_mark_completed(
        "serial", "whole_home", plan_room("Kitchen", "room-kitchen")
    )
    assert manager.planning.preview("serial", room_map)["rooms"][0]["name"] == "Study"
    rotation = manager.planning.preview("serial", room_map)["rotation"]
    assert rotation[0]["room"] == "Study"
    assert rotation[0]["selection_reason"] == "no_prior_opportunity"
    assert rotation[1]["room"] == "Kitchen"
    assert rotation[1]["last_result"] == "completed"
    assert rotation[1]["last_opportunity_source"] == "plan"
    assert rotation[1]["last_completion"] is not None

    same_opportunity = (dt_util.utcnow() - timedelta(hours=1)).isoformat()
    robot = manager.repository.robot("serial")
    robot["rotations"]["whole_home"]["rooms"]["room-kitchen"]["last_opportunity"] = (
        same_opportunity
    )
    robot["rotations"]["whole_home"]["rooms"]["room-kitchen"]["last_completed"] = (
        same_opportunity
    )
    robot["rotations"]["whole_home"]["rooms"]["room-study"] = {
        "room_id": "room-study",
        "name": "Study",
        "cleaning_mode": "vacuum_and_mop",
        "coverage_setting": "standard",
        "last_opportunity": same_opportunity,
    }
    robot["rooms"]["room-kitchen"]["last_opportunity"] = same_opportunity
    robot["rooms"]["room-kitchen"]["last_completed"] = same_opportunity
    robot["rooms"]["room-study"] = {
        "name": "Study",
        "last_opportunity": same_opportunity,
    }
    tied_rotation = rotation_explanation(
        manager,
        "serial",
        "whole_home",
        [
            plan_room("Kitchen", "room-kitchen"),
            plan_room("Study", "room-study"),
        ],
    )
    assert tied_rotation[1]["selection_reason"] == "saved_order_tiebreak"
    manager.repository.robot("serial")["plans"]["whole_home"]["run_behavior"] = (
        "ordered"
    )
    ordered_preview = manager.planning.preview("serial", room_map)
    assert ordered_preview["rotation_basis"] == "saved_order"
    assert ordered_preview["rooms"][0]["name"] == "Kitchen"
    assert ordered_preview["rotation"][0]["last_completion"] is not None
    manager.repository.robot("serial")["plans"]["whole_home"]["run_behavior"] = (
        "intelligent"
    )
    await manager.ledger.async_reset_history("serial", "whole_home")
    assert manager.history.snapshot("serial")["completed_runs"] == 0
    reset_preview = manager.planning.preview("serial", room_map)
    assert reset_preview["rooms"][0]["name"] == "Kitchen"
    assert all(item["last_completion"] is None for item in reset_preview["rotation"])
    await manager.catalog.async_delete_plan("serial", "whole_home")
    assert manager.history.snapshot("serial")["selected_plan"] == "upstairs"
    await manager.ledger.async_reset_history("serial")


async def test_plan_validation_rejects_disabled_empty_unknown_and_missing(hass) -> None:
    manager = memory_manager(hass)
    await manager.catalog.async_save_plan(
        "serial", "disabled", {"name": "Disabled", "enabled": False, "rooms": []}
    )
    with pytest.raises(ValueError, match="disabled"):
        manager.planning.preview("serial", {}, "disabled")
    with pytest.raises(KeyError):
        manager.catalog.plan("serial", "missing")
    with pytest.raises(KeyError):
        await manager.catalog.async_select_plan("serial", "missing")

    await manager.catalog.async_save_plan(
        "serial", "empty", {"name": "Empty", "enabled": True, "rooms": []}
    )
    with pytest.raises(ValueError, match="no rooms"):
        manager.planning.preview("serial", {}, "empty")

    for rooms in ("room-kitchen", ["room-kitchen"]):
        with pytest.raises(ValueError, match="plan contains an invalid room"):
            await manager.catalog.async_save_plan(
                "serial",
                "corrupt",
                {"name": "Corrupt", "enabled": True, "rooms": rooms},
            )


async def test_reset_history_revalidates_plan_after_metadata_wait(hass) -> None:
    """A plan deleted at the metadata fence cannot receive a stale reset."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager.catalog.async_save_plan("serial", "selected", {"name": "Selected"})
    await manager.catalog.async_select_plan("serial", "selected")

    delete_write_started = asyncio.Event()
    allow_delete_write = asyncio.Event()
    original_save = manager.repository.store.async_save
    save_calls = 0

    async def hold_delete_write(data: dict[str, Any]) -> None:
        nonlocal save_calls
        save_calls += 1
        robot = data["robots"]["serial"]
        if "selected" not in robot["plans"]:
            delete_write_started.set()
            await allow_delete_write.wait()
        await original_save(data)

    manager.repository.store.async_save = hold_delete_write
    delete = asyncio.create_task(
        manager.catalog.async_delete_plan("serial", "selected")
    )
    reset = None
    try:
        await asyncio.wait_for(delete_write_started.wait(), timeout=2)
        assert "selected" in manager.repository.robot("serial")["plans"]
        assert manager.repository.state_lock("serial").locked()

        reset = asyncio.create_task(
            manager.ledger.async_reset_history("serial", "selected")
        )
        for _ in range(20):
            waiters = getattr(manager.repository.state_lock("serial"), "_waiters", None)
            if (
                manager.repository.metadata_admissions.get("serial") == 1
                and waiters
                and any(not waiter.done() for waiter in waiters)
            ):
                break
            await asyncio.sleep(0)
        assert manager.repository.metadata_admissions.get("serial") == 1
        assert waiters and any(not waiter.done() for waiter in waiters)

        allow_delete_write.set()
        await asyncio.wait_for(delete, timeout=3)
        with pytest.raises(KeyError, match="selected"):
            await asyncio.wait_for(reset, timeout=3)
    finally:
        allow_delete_write.set()
        if not delete.done():
            await asyncio.gather(delete, return_exceptions=True)
        if reset is not None and not reset.done():
            reset.cancel()
            await asyncio.gather(reset, return_exceptions=True)

    assert save_calls == 1
    robot = manager.repository.robot("serial")
    assert robot["selected_plan"] is None
    assert "selected" not in robot["plans"]
    assert "selected" not in robot["rotation_resets"]

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    persisted = reloaded.repository.robot("serial")
    assert persisted["selected_plan"] is None
    assert "selected" not in persisted["plans"]
    assert "selected" not in persisted["rotation_resets"]


def test_plan_preview_rejects_corrupt_room_records(hass) -> None:
    manager = memory_manager(hass)
    robot = manager.repository.robot("serial")
    robot["plans"]["corrupt"] = {
        "name": "Corrupt",
        "enabled": True,
        "rooms": ["room-kitchen"],
    }

    with pytest.raises(ValueError, match="plan contains an invalid room"):
        manager.planning.preview("serial", {"room-kitchen": "Kitchen"}, "corrupt")


async def test_saved_plan_limit_rejects_creation_but_allows_replacement(hass) -> None:
    manager = memory_manager(hass)
    plans = manager.repository.robot("serial")["plans"]
    plans.update(
        {
            f"plan-{index}": {"name": f"Plan {index}", "rooms": []}
            for index in range(MAX_SAVED_PLANS_PER_ROBOT)
        }
    )

    with pytest.raises(SavedPlanLimitError, match="at most"):
        await manager.catalog.async_save_plan(
            "serial", "new-plan", {"name": "New plan", "rooms": []}
        )

    assert "new-plan" not in plans
    assert len(plans) == MAX_SAVED_PLANS_PER_ROBOT
    manager.repository.store.async_save.assert_not_awaited()

    await manager.catalog.async_save_plan(
        "serial", "plan-0", {"name": "Replacement", "rooms": []}, select=False
    )

    assert plans["plan-0"]["name"] == "Replacement"
    manager.repository.store.async_save.assert_awaited_once_with(
        manager.repository.data
    )


async def test_saved_plan_zero_capacity_rejects_creation(hass, monkeypatch) -> None:
    monkeypatch.setattr(
        "custom_components.matic_robot.plan_catalog.MAX_SAVED_PLANS_PER_ROBOT", 0
    )
    manager = memory_manager(hass)

    with pytest.raises(SavedPlanLimitError, match="at most 0 saved plans"):
        await manager.catalog.async_save_plan(
            "serial", "first-plan", {"name": "First plan", "rooms": []}
        )

    assert manager.repository.robot("serial")["plans"] == {}
    manager.repository.store.async_save.assert_not_awaited()


@pytest.mark.parametrize(
    "other_name",
    ["Dining Room", "The Dining Room", " DINING  ROOM ", "the dining\troom"],
)
@pytest.mark.parametrize("preceding_leg", [False, True])
async def test_managed_plan_rejects_native_name_aliases_before_any_dispatch(
    hass, other_name: str, preceding_leg: bool
) -> None:
    """Completion aliases must not authorize an ambiguous room or queued leg."""
    robot = FakeRobot()
    manager = memory_manager(hass)
    robot.show("docked")
    rooms = [CleaningRoom("dining", "Dining Room", "vacuum", "quick")]
    if preceding_leg:
        rooms.insert(0, CleaningRoom("kitchen", "Kitchen", "mop", "optimal"))
    dispatch = AsyncMock(side_effect=AssertionError("ambiguous plan dispatched"))
    commands = AsyncMock()
    with (
        patch(
            "custom_components.matic_robot.managed_dispatch.async_dispatch_leg_command",
            dispatch,
        ),
        pytest.raises(ServiceValidationError) as failure,
    ):
        await async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            floor_token="floor",
            robot=robot.port(),
            mapped_room_names=("Kitchen", "Dining Room", other_name),
            managed_user_command=commands,
        )

    assert failure.value.translation_key == "ambiguous_room_name"
    dispatch.assert_not_awaited()
    commands.assert_not_awaited()
    assert manager.history.snapshot("serial")["last_run"]["completed_room_count"] == 0


def test_parse_renames_stored_one_time_room_runs() -> None:
    """Stores from 0.5 show one-time room runs under their current name."""
    manual_id = f"{plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID}_1"
    legacy_name = "Map Studio room clean"
    robot: dict[str, Any] = {
        "last_run": {
            "run_id": "run-one",
            "plan_id": manual_id,
            "plan_name": legacy_name,
            "outcome": "completed",
        },
        "active_plan": {
            "run_id": "run-one",
            "plan_id": manual_id,
            "plan_name": legacy_name,
            "room_id": "room-a",
        },
    }
    saved = {
        "last_run": {
            "run_id": "run-two",
            "plan_id": "saved",
            "plan_name": legacy_name,
            "outcome": "completed",
        }
    }

    assert plan_state_module.parse_robot(robot) is True
    plan_state_module.parse_robot(saved)

    assert robot["last_run"]["plan_name"] == "One-time room clean"
    assert robot["active_plan"]["plan_name"] == "One-time room clean"
    assert saved["last_run"]["plan_name"] == legacy_name
