"""Saved plans whose rooms a map edit removed from the robot's map.

tests/e2e/test_plan_missing_rooms.py runs the whole path against the
simulated robot; these cover the branches it does not reach.
"""

from __future__ import annotations

import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import issue_registry as ir

from custom_components.matic_robot.client import FloorPlan, MappedFloor
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.execution_planning import _plan_rooms
from custom_components.matic_robot.plan_catalog import PlanCatalog
from custom_components.matic_robot.plan_model import (
    CadenceBindingError,
    CadenceRoomBusyError,
    DuplicateRoomError,
    PlanAreaMissingError,
    PlanRoomMissingError,
    PlanRoomsHeldError,
    SharedRoomScheduleLockedError,
    missing_plan_rooms,
    relink_plan_rooms,
    resolve_rooms,
)
from custom_components.matic_robot.plan_room_repairs import (
    PlanRoomRepairFlow,
    async_delete_plan_room_issue,
    async_sync_plan_room_issue,
    plan_room_issue_id,
)
from custom_components.matic_robot.plan_views import MaticPlansView
from custom_components.matic_robot.service_execution import _require_unchanged_plan
from custom_components.matic_robot.service_plans import normalize_saved_room
from tests.test_plan_entries import _floor, _room
from tests.test_slam_scene import _entry, _hass, _request
from tests.test_view_wire import _plans_runtime

# The Matic app re-created the study with a new ID and removed the hall.
EDITED_MAP = {"room-kitchen": "Kitchen", "room-study-2": "Study"}


def _edited_floor(*, floors: int = 1) -> FloorPlan:
    floor = _floor()
    return FloorPlan(
        floor.mission_id,
        floor.partition_protocol_id,
        floor.partition_id_wire,
        tuple(room for room in floor.rooms if room.id == "room-kitchen"),
        mapped_floors=tuple(
            MappedFloor(floor.mission_id + index, f"Floor {index}", f"token-{index}")
            for index in range(floors)
        )
        if floors > 1
        else (),
    )


def test_resolution_names_every_room_the_map_lost() -> None:
    raw = [_room("room-kitchen"), _room("room-study"), _room("room-hall")]

    with pytest.raises(PlanRoomMissingError) as raised:
        resolve_rooms(raw, EDITED_MAP)

    assert raised.value.room_ids == ("room-study", "room-hall")


def test_an_area_plan_with_corrupt_rooms_is_refused() -> None:
    with pytest.raises(ValueError, match="invalid room"):
        _plan_rooms({"rooms": "room-kitchen"}, EDITED_MAP, require_rooms=False)


def test_a_plan_left_with_no_room_runs_only_its_areas() -> None:
    plan = {"rooms": [_room("room-study"), _room("room-hall")]}

    assert _plan_rooms(plan, EDITED_MAP, require_rooms=False) == (
        [],
        {"room-study", "room-hall"},
    )
    with pytest.raises(PlanRoomMissingError):
        _plan_rooms(plan, EDITED_MAP, require_rooms=True)


def test_a_removed_room_is_offered_only_one_unclaimed_room_by_name() -> None:
    plan = {
        "rooms": [
            _room(room_id)
            for room_id in (
                "room-kitchen",
                "room-study",
                "room-pantry",
                "room-den-a",
                "room-den-b",
                "room-cellar",
            )
        ]
    }
    room_map = {**EDITED_MAP, "room-den": "Den"}
    known = {
        "room-study": "STUDY",
        # The kitchen is already in the plan, so the pantry cannot move there.
        "room-pantry": "Kitchen",
        # Two removed rooms want the one den: neither gets it.
        "room-den-a": "Den",
        "room-den-b": "den",
    }

    assert missing_plan_rooms(plan, room_map, known) == [
        {"room_id": "room-study", "name": "STUDY", "match_room_id": "room-study-2"},
        {"room_id": "room-pantry", "name": "Kitchen", "match_room_id": None},
        {"room_id": "room-den-a", "name": "Den", "match_room_id": None},
        {"room_id": "room-den-b", "name": "den", "match_room_id": None},
        {"room_id": "room-cellar", "name": None, "match_room_id": None},
    ]


def test_a_relinked_room_keeps_its_settings_and_drops_its_identity() -> None:
    study = {
        **_room("room-study", "vacuum", "quick"),
        "cadence": {"scope": "plan", "coverage_every_n": 3},
        "cadence_identity": "old-identity",
    }
    plan = {
        "name": "Home",
        "rooms": [_room("room-kitchen"), study],
        "entries": [
            {"kind": "room", "room_id": "room-kitchen"},
            {
                "kind": "area",
                "area_id": "rug",
                "cleaning_mode": "vacuum",
                "coverage_setting": "quick",
            },
            {"kind": "room", "room_id": "room-study"},
        ],
        "room_order": ["room-kitchen", "room-study"],
        "occupancy_sensors": {"room-study": "binary_sensor.study"},
    }

    moved = relink_plan_rooms(plan, {"room-study": "room-study-2"})

    assert moved["rooms"][1] == {
        **_room("room-study-2", "vacuum", "quick"),
        "cadence": {"scope": "plan", "coverage_every_n": 3},
    }
    assert [entry.get("room_id") for entry in moved["entries"]] == [
        "room-kitchen",
        None,
        "room-study-2",
    ]
    assert moved["room_order"] == ["room-kitchen", "room-study-2"]
    assert moved["occupancy_sensors"] == {"room-study-2": "binary_sensor.study"}
    assert plan["rooms"][1]["room_id"] == "room-study"
    bare = relink_plan_rooms({"rooms": [study]}, {"room-study": "room-new"})
    assert set(bare) == {"rooms", "entries"}


@pytest.mark.parametrize(
    ("links", "error"),
    [
        ({"room-hall": "room-new"}, ValueError),
        ({"room-study": "room-new", "room-kitchen": "room-new"}, ValueError),
        ({"room-study": "room-kitchen"}, DuplicateRoomError),
    ],
)
def test_a_relink_that_does_not_fit_the_plan_is_refused(
    links: dict[str, str], error: type[Exception]
) -> None:
    plan = {"rooms": [_room("room-kitchen"), _room("room-study")]}

    with pytest.raises(error):
        relink_plan_rooms(plan, links)


def test_known_room_names_skip_records_without_one() -> None:
    catalog = MagicMock()
    catalog.repository.robot.return_value = {
        "rooms": {"room-study": {"name": "Study"}, "room-hall": {}, "junk": "x"}
    }

    assert PlanCatalog.known_room_names(catalog, "serial") == {"room-study": "Study"}


async def test_a_relink_to_a_room_off_the_map_is_refused() -> None:
    with pytest.raises(ValueError, match="not on the current map"):
        await PlanCatalog.async_relink_plan_rooms(
            MagicMock(),
            "serial",
            {"home": {"room-study": "room-gone"}},
            floor_token=None,
            room_identities={"room-kitchen": "identity"},
            precondition=lambda: None,
        )


async def test_a_relink_after_the_map_changed_saves_nothing() -> None:
    catalog = MagicMock()
    catalog.repository.robot.return_value = {"plans": {"home": {"rooms": []}}}

    async def run(_serial, commit, **_options):
        await commit(None)

    def map_changed() -> None:
        # The check runs once the storage commit holds its lock.
        catalog.cadence.cadence_commit.return_value.__aenter__.assert_awaited_once()
        raise ValueError("the map changed")

    catalog.repository.async_run_owned_metadata = run
    with pytest.raises(ValueError, match="map changed"):
        await PlanCatalog.async_relink_plan_rooms(
            catalog,
            "serial",
            {"home": {"room-study": "room-kitchen"}},
            floor_token=None,
            room_identities={"room-kitchen": "identity"},
            precondition=map_changed,
        )
    catalog.save_plan_transaction.assert_not_called()


async def test_a_relink_for_a_deleted_plan_is_refused() -> None:
    catalog = MagicMock()
    catalog.repository.robot.return_value = {"plans": {}}

    async def run(_serial, commit, **_options):
        await commit(None)

    catalog.repository.async_run_owned_metadata = run
    with pytest.raises(ValueError, match="deleted plan"):
        await PlanCatalog.async_relink_plan_rooms(
            catalog,
            "serial",
            {"home": {"room-study": "room-kitchen"}},
            floor_token=None,
            room_identities={"room-kitchen": "identity"},
            precondition=lambda: None,
        )


def test_a_map_edit_during_start_names_the_missing_rooms() -> None:
    preview = MagicMock(side_effect=PlanRoomMissingError(["room-study"]))

    with (
        patch(
            "custom_components.matic_robot.service_execution._current_floor_plan",
            return_value=_edited_floor(),
        ),
        pytest.raises(ServiceValidationError) as raised,
    ):
        _require_unchanged_plan(MagicMock(), preview, "token")

    assert raised.value.translation_key == "plan_room_missing"
    assert raised.value.translation_placeholders == {"rooms": "room-study"}


@pytest.mark.parametrize(
    ("error", "blocker"),
    [
        (PlanRoomMissingError(["room-2"]), "room_missing"),
        (PlanAreaMissingError("area gone"), "area_missing"),
    ],
)
async def test_matic_map_hears_which_rooms_stop_the_plan(
    error: ValueError, blocker: str
) -> None:
    runtime = _plans_runtime()
    runtime.cleaning_plans.planning.preview = MagicMock(side_effect=error)
    runtime.cleaning_plans.catalog.known_room_names = MagicMock(
        return_value={"room-2": "Study"}
    )
    floor = runtime.session.floor.value
    runtime.session.floor.value = replace(floor, rooms=floor.rooms[:1])

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    previews = {
        plan["id"]: plan["next_run_preview"]
        for plan in json.loads(response.body)["plans"]
    }
    assert {preview["blocker"] for preview in previews.values()} == {blocker}
    assert previews["weekday"]["missing_rooms"] == [
        {"room_id": "room-2", "name": "Study", "match_room_id": None}
    ]


async def test_another_floors_plan_is_not_offered_this_floors_rooms() -> None:
    runtime = _plans_runtime()
    runtime.cleaning_plans.planning.preview = MagicMock(
        side_effect=PlanRoomMissingError(["room-1", "room-2"])
    )
    floor = runtime.session.floor.value
    upstairs = next(room for room in floor.rooms if room.id == "room-1")
    # Both floors have a room with that name; this floor shows its own.
    runtime.cleaning_plans.catalog.known_room_names = MagicMock(
        return_value={"room-1": upstairs.name}
    )
    downstairs = replace(upstairs, id="room-down")
    runtime.cleaning_plans.cadence.daily_limit_state = MagicMock(
        return_value={"limit": None, "completed_today": 0, "reached": False}
    )
    mapped = tuple(
        MappedFloor(floor.mission_id + index, f"Floor {index}", f"token-{index}")
        for index in range(2)
    )
    runtime.session.floor.value = replace(
        floor, rooms=(downstairs,), mapped_floors=mapped
    )

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    weekday = next(
        plan["next_run_preview"]
        for plan in json.loads(response.body)["plans"]
        if plan["id"] == "weekday"
    )
    assert weekday["blocker"] == "room_missing"
    assert "missing_rooms" not in weekday
    # On a one-floor robot the same plan lost its rooms, and the match shows.
    runtime.session.floor.value = replace(floor, rooms=(downstairs,))
    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")
    weekday = next(
        plan["next_run_preview"]
        for plan in json.loads(response.body)["plans"]
        if plan["id"] == "weekday"
    )
    assert weekday["missing_rooms"][0]["match_room_id"] == "room-down"


def _plans(**overrides: object) -> dict:
    plans: dict[str, object] = {
        "home": {"name": "Home", "rooms": [_room("room-kitchen"), _room("room-study")]},
        "kitchen": {"name": "Kitchen only", "rooms": [_room("room-kitchen")]},
        "off": {"name": "Off", "enabled": False, "rooms": [_room("room-hall")]},
        "broken": {"name": "Broken", "rooms": "room-hall"},
        "junk": "not a plan",
    }
    plans.update(overrides)
    return plans


def _issue(hass) -> ir.IssueEntry | None:
    return ir.async_get(hass).async_get_issue(DOMAIN, plan_room_issue_id("entry"))


async def test_repair_names_plans_with_rooms_off_the_map(hass) -> None:
    async_sync_plan_room_issue(hass, "entry", _plans(), _edited_floor(), {})

    issue = _issue(hass)
    assert issue is not None
    assert issue.translation_key == "plan_room_missing"
    assert issue.translation_placeholders["plans"] == "Home"

    # Without a live map the issue stays as it was.
    async_sync_plan_room_issue(hass, "entry", {}, None, {})
    assert _issue(hass) is not None

    fixed = _plans(home={"name": "Home", "rooms": [_room("room-kitchen")]})
    async_sync_plan_room_issue(hass, "entry", fixed, _edited_floor(), {})
    assert _issue(hass) is None


async def test_repair_skips_plans_for_another_mapped_floor(hass) -> None:
    upstairs = {"upstairs": {"name": "Upstairs", "rooms": [_room("room-attic")]}}

    async_sync_plan_room_issue(hass, "entry", upstairs, _edited_floor(floors=2), {})
    assert _issue(hass) is None

    # On a robot with one floor, the same plan has lost every room.
    async_sync_plan_room_issue(hass, "entry", upstairs, _edited_floor(), {})
    assert _issue(hass) is not None

    async_delete_plan_room_issue(hass, "entry")
    assert _issue(hass) is None


async def test_the_repair_flow_waits_for_the_robot_and_a_steady_plan(hass) -> None:
    flow = PlanRoomRepairFlow("missing")
    flow.hass = hass
    assert (await flow.async_step_init())["reason"] == "robot_unavailable"

    floor = _floor()
    study = next(room for room in floor.rooms if room.id == "room-study")
    catalog = MagicMock()
    catalog.plans.return_value = {
        "home": {"name": "Home", "rooms": [_room("room-kitchen"), _room("room-old")]}
    }
    catalog.known_room_names.return_value = {"room-old": study.name}
    catalog.async_relink_plan_rooms = AsyncMock(side_effect=ValueError("changed"))
    entry = MagicMock()
    entry.runtime_data = SimpleNamespace(
        session=SimpleNamespace(
            floor=SimpleNamespace(value=floor),
            info=SimpleNamespace(serial_number="serial"),
        ),
        cleaning_plans=SimpleNamespace(catalog=catalog),
        slam_map=SimpleNamespace(floor_plan_is_current=lambda _floor: True),
    )
    entry.state = ConfigEntryState.NOT_LOADED
    flow = PlanRoomRepairFlow("entry")
    flow.hass = MagicMock()
    flow.hass.config_entries.async_get_entry.return_value = entry
    # An unloaded entry has no robot to read; a loaded one may have no map yet.
    assert (await flow.async_step_init())["reason"] == "robot_unavailable"
    entry.state = ConfigEntryState.LOADED
    entry.runtime_data.session.floor.value = None
    assert (await flow.async_step_init())["reason"] == "robot_unavailable"
    entry.runtime_data.session.floor.value = floor

    with patch(
        "custom_components.matic_robot.plan_room_repairs.repair_placeholders",
        return_value={"name": "Matic"},
    ):
        form = await flow.async_step_init()
        assert form["description_placeholders"]["rooms"] == f"- Home: {study.name}"
        # A plan that gained a removed room after the form opened is shown
        # before anything is saved.
        catalog.plans.return_value["away"] = {
            "name": "Away",
            "rooms": [_room("room-old")],
        }
        form = await flow.async_step_init({})
        catalog.async_relink_plan_rooms.assert_not_awaited()
        assert form["description_placeholders"]["rooms"] == (
            f"- Home: {study.name}\n- Away: {study.name}"
        )
        del catalog.plans.return_value["away"]
        form = await flow.async_step_init({})
        catalog.async_relink_plan_rooms.assert_not_awaited()
    assert (await flow.async_step_init({}))["reason"] == "plan_changed"
    # A run that owns a room, or a schedule the map doesn't confirm, says so.
    for error, reason in (
        (CadenceRoomBusyError("running"), "room_busy"),
        (SharedRoomScheduleLockedError("locked"), "room_busy"),
        (CadenceBindingError("unbound"), "schedule_unconfirmed"),
    ):
        catalog.async_relink_plan_rooms.side_effect = error
        assert (await flow.async_step_init({}))["reason"] == reason
    links = catalog.async_relink_plan_rooms.await_args
    assert links.args == ("serial", {"home": {"room-old": "room-study"}})
    # The save checks, under its locks, that the map is still the one shown.
    links.kwargs["precondition"]()
    entry.runtime_data.session.floor.value = replace(floor, rooms=floor.rooms[:1])
    with pytest.raises(ValueError, match="map changed"):
        links.kwargs["precondition"]()
    entry.runtime_data.session.floor.value = None
    with pytest.raises(ValueError, match="map changed"):
        links.kwargs["precondition"]()
    entry.runtime_data.session.floor.value = floor
    entry.runtime_data.slam_map.floor_plan_is_current = lambda _floor: False
    with pytest.raises(ValueError, match="map changed"):
        links.kwargs["precondition"]()
    entry.runtime_data.slam_map.floor_plan_is_current = lambda _floor: True
    entry.state = ConfigEntryState.UNLOAD_IN_PROGRESS
    with pytest.raises(ValueError, match="unloaded"):
        links.kwargs["precondition"]()
    entry.state = ConfigEntryState.LOADED

    # A re-link that leaves no removed room finishes, so the Repair clears.
    entry.runtime_data.session.floor.value = floor
    home = catalog.plans.return_value["home"]
    catalog.async_relink_plan_rooms = AsyncMock(
        side_effect=lambda *_, **__: home.update(
            rooms=[_room("room-kitchen"), _room("room-study")]
        )
    )
    flow = PlanRoomRepairFlow("entry")
    flow.hass = MagicMock()
    flow.hass.config_entries.async_get_entry.return_value = entry
    with patch(
        "custom_components.matic_robot.plan_room_repairs.repair_placeholders",
        return_value={"name": "Matic"},
    ):
        await flow.async_step_init()
    assert (await flow.async_step_init({}))["type"] == "create_entry"


async def test_matic_map_hears_which_rooms_a_run_skips() -> None:
    runtime = _plans_runtime()
    planning = runtime.cleaning_plans.planning
    preview = planning.preview
    skipped = {"room_id": "room-9", "name": "Study", "match_room_id": "room-2"}
    planning.preview = MagicMock(
        side_effect=lambda *args, **kwargs: {
            **preview(*args, **kwargs),
            "missing_rooms": [skipped],
        }
    )

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    ready = [
        plan["next_run_preview"]
        for plan in json.loads(response.body)["plans"]
        if plan["next_run_preview"]["blocker"] is None
    ]
    assert ready
    assert all(preview["missing_rooms"] == [skipped] for preview in ready)
    capped = [
        plan["next_run_preview"]
        for plan in json.loads(response.body)["plans"]
        if plan["next_run_preview"]["blocker"] == "daily_limit_reached"
    ]
    assert capped
    assert all(preview["missing_rooms"] == [skipped] for preview in capped)


async def test_a_plan_with_every_room_held_still_names_the_removed_ones() -> None:
    runtime = _plans_runtime()
    runtime.cleaning_plans.planning.preview = MagicMock(
        side_effect=PlanRoomsHeldError("all held")
    )
    runtime.cleaning_plans.catalog.known_room_names = MagicMock(
        return_value={"room-2": "Study"}
    )
    floor = runtime.session.floor.value
    runtime.session.floor.value = replace(floor, rooms=floor.rooms[:1])

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    previews = {
        plan["id"]: plan["next_run_preview"]
        for plan in json.loads(response.body)["plans"]
    }
    assert previews["weekday"]["blocker"] == "plan_rooms_held"
    assert previews["weekday"]["missing_rooms"] == [
        {"room_id": "room-2", "name": "Study", "match_room_id": None}
    ]


def test_a_removed_room_keeps_its_saved_settings_through_a_save() -> None:
    policy = {
        "scope": "plan",
        "coverage_every_n": 3,
        "periodic_coverage_setting": "heavy_duty",
    }
    stored = {"room_id": "room-gone", "coverage_setting": "quick", "cadence": policy}
    kept = {"room-gone": stored}
    same = {"room": "room-gone", "cleaning_mode": "vacuum", "coverage_setting": "quick"}

    assert normalize_saved_room(same, {}, kept)["room_id"] == "room-gone"
    assert normalize_saved_room({**same, "cadence": dict(policy)}, {}, kept)
    for changed in (
        {**same, "coverage_setting": "standard"},
        {**same, "cadence": {**policy, "coverage_every_n": 4}},
        {**same, "cadence": {"scope": "nowhere"}},
    ):
        with pytest.raises(ServiceValidationError) as raised:
            normalize_saved_room(changed, {}, kept)
        assert raised.value.translation_key == "plan_room_off_map_settings"
