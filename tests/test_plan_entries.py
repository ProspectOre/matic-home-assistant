"""Saved custom areas as typed entries inside cleaning plans."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import probatio
import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from custom_components.matic_robot.area_binding import (
    AREA_SCHEMA_VERSION,
    binding_for_floor_plan,
)
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.const import DOMAIN, MAX_ROOM_SEQUENCE_SIZE
from custom_components.matic_robot.plan_model import (
    AreaInUseError,
    AreaLeg,
    CleaningRoom,
    DuplicatePlanAreaError,
    EmptyPlanError,
    PlanAreaLimitError,
    PlanAreaMapChangedError,
    PlanAreaMissingError,
    PlanDisabledError,
    _dispatching_room_leg,
    checkpoint_legs,
    entry_mission_boundaries,
    leg_groups,
    plan_area_fingerprint,
    plan_entries,
    plan_floor_token,
    plan_legs,
    run_entries,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.room_sequence import saved_plan_preview_token
from custom_components.matic_robot.service_plans import (
    _plan_request_error,
)
from custom_components.matic_robot.service_schemas import (
    DELETE_PLAN_ROOM_SCHEMA,
    MOVE_PLAN_ROOM_SCHEMA,
    SAVE_PLAN_ROOM_SCHEMA,
    SAVE_PLAN_SCHEMA,
)
from tests.test_services import _registered_handler, _registered_services

SERIAL = "serial"
ROOM_MAP = {"room-kitchen": "Kitchen", "room-study": "Study", "room-hall": "Hall"}


def _floor(*, mission_id: int = 42) -> FloorPlan:
    return FloorPlan(
        mission_id,
        "synthetic-partition",
        b"synthetic-partition",
        tuple(
            Room(
                room_id,
                name,
                f"protocol-{room_id}",
                room_id.encode(),
                ((0, 0), (4, 0), (4, 4), (0, 4)),
            )
            for room_id, name in ROOM_MAP.items()
        ),
    )


def _area(floor: FloorPlan, name: str = "Rug", x: float = 1.0) -> dict:
    return {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": name,
        "circles": [{"x": x, "y": 2.0, "radius": 0.35}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding_for_floor_plan(floor),
    }


def _room(room_id: str, mode: str = "vacuum", coverage: str = "standard") -> dict:
    return {"room_id": room_id, "cleaning_mode": mode, "coverage_setting": coverage}


def _area_entry(area_id: str, mode: str = "vacuum", coverage: str = "quick") -> dict:
    return {
        "kind": "area",
        "area_id": area_id,
        "cleaning_mode": mode,
        "coverage_setting": coverage,
    }


def _room_entry(room_id: str) -> dict:
    return {"kind": "room", "room_id": room_id}


async def _manager(hass, floor: FloorPlan | None = None) -> CleaningPlanManager:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor = floor or _floor()
    await manager.catalog.async_save_area(SERIAL, "rug", _area(floor))
    await manager.catalog.async_save_area(SERIAL, "mat", _area(floor, "Mat", 2.0))
    return manager


def _entry(floor: FloorPlan) -> SimpleNamespace:
    return SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            coordinator=SimpleNamespace(data=SimpleNamespace(floor_plan=floor)),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )


# Storage -----------------------------------------------------------------


async def test_store_minor_eleven_stamps_existing_plan_entries_as_rooms(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    assert manager.repository.store.minor_version == 12
    stored = {
        "robots": {
            SERIAL: {
                "plans": {
                    "home": {
                        "name": "Home",
                        "rooms": [
                            _room("room-kitchen"),
                            "not-a-room",
                            {"room_id": ""},
                            _room("room-study"),
                        ],
                    },
                    "no_rooms": {"name": "Empty", "rooms": "corrupt"},
                    "stamped": {
                        "rooms": [_room("room-hall")],
                        "entries": [_room_entry("room-hall")],
                    },
                    "corrupt": "not-a-plan",
                },
            },
            "no_plans": {"plans": []},
            "corrupt": "not-a-robot",
        }
    }
    original_rooms = deepcopy(stored["robots"][SERIAL]["plans"]["home"]["rooms"])

    migrated = await manager.repository.store._async_migrate_func(1, 10, stored)

    plans = migrated["robots"][SERIAL]["plans"]
    assert plans["home"]["entries"] == [
        _room_entry("room-kitchen"),
        _room_entry("room-study"),
    ]
    # Room entries keep every stored byte; only the order list is added.
    assert plans["home"]["rooms"] == original_rooms
    assert plans["no_rooms"]["entries"] == []
    assert plans["stamped"]["entries"] == [_room_entry("room-hall")]
    assert plans["corrupt"] == "not-a-plan"
    with pytest.raises(ValueError, match="minor version"):
        await manager.repository.store._async_migrate_func(1, 13, stored)


async def test_room_only_save_stores_identical_rooms_and_room_entries(hass) -> None:
    manager = await _manager(hass)
    rooms = [_room("room-kitchen", "vacuum_and_mop"), _room("room-study")]

    await manager.catalog.async_save_plan(
        SERIAL, "home", {"name": "Home", "rooms": rooms}
    )

    plan = manager.catalog.plan(SERIAL, "home")
    assert plan["rooms"] == rooms
    assert plan["entries"] == [_room_entry("room-kitchen"), _room_entry("room-study")]
    assert plan_entries(plan) == plan["entries"]


async def test_save_accepts_area_only_and_mixed_plans(hass) -> None:
    manager = await _manager(hass)

    await manager.catalog.async_save_plan(
        SERIAL,
        "spots",
        {"name": "Spots", "rooms": [], "entries": [_area_entry("rug")]},
    )
    await manager.catalog.async_save_plan(
        SERIAL,
        "mixed",
        {
            "name": "Mixed",
            "rooms": [_room("room-kitchen"), _room("room-study")],
            "entries": [
                _room_entry("room-kitchen"),
                _area_entry("rug"),
                _room_entry("room-study"),
                _area_entry("mat", "mop", "standard"),
            ],
        },
    )

    assert manager.catalog.plan(SERIAL, "spots")["entries"] == [_area_entry("rug")]
    assert manager.catalog.plan(SERIAL, "spots")["rooms"] == []
    assert [
        entry["kind"] for entry in manager.catalog.plan(SERIAL, "mixed")["entries"]
    ] == [
        "room",
        "area",
        "room",
        "area",
    ]
    assert manager.catalog.plans_using_area(SERIAL, "rug") == ["mixed", "spots"]
    assert manager.catalog.plans_using_area(SERIAL, "mat") == ["mixed"]
    assert manager.catalog.plans_using_area(SERIAL, "missing") == []


@pytest.mark.parametrize(
    ("entries", "error", "message"),
    [
        ("not-a-list", ValueError, "entries are invalid"),
        (["not-an-entry"], ValueError, "entries are invalid"),
        ([{"kind": "zone"}], ValueError, "entries are invalid"),
        ([{"kind": "room", "room_id": ""}], ValueError, "entries are invalid"),
        (
            [{"kind": "room", "room_id": "room-kitchen", "cadence": {}}],
            ValueError,
            "entries are invalid",
        ),
        (
            [{**_area_entry("rug"), "cadence": {"mop_every_n": 2}}],
            ValueError,
            "entries are invalid",
        ),
        ([_area_entry("rug", "dust")], ValueError, "entries are invalid"),
        ([_area_entry("rug", "vacuum", "deep")], ValueError, "entries are invalid"),
        ([_area_entry("")], ValueError, "entries are invalid"),
        ([_room_entry("room-study")], ValueError, "do not match"),
        ([], ValueError, "do not match"),
        ([_area_entry("gone")], PlanAreaMissingError, "missing"),
        (
            [_area_entry("rug"), _area_entry("rug", "mop")],
            DuplicatePlanAreaError,
            "more than once",
        ),
    ],
)
async def test_save_rejects_invalid_entries_without_writing(
    hass, entries, error, message: str
) -> None:
    manager = await _manager(hass)
    manager.repository.store.async_save.reset_mock()
    areas_only = (
        isinstance(entries, list)
        and bool(entries)
        and all(
            isinstance(item, dict) and item.get("kind") == "area" for item in entries
        )
    )
    rooms = [] if areas_only else [_room("room-kitchen")]
    plan = {"name": "Home", "rooms": rooms, "entries": entries}

    with pytest.raises(error, match=message):
        await manager.catalog.async_save_plan(SERIAL, "home", plan)

    assert manager.catalog.plans(SERIAL) == {}
    manager.repository.store.async_save.assert_not_awaited()


async def test_save_rejects_more_areas_than_a_plan_can_hold(hass) -> None:
    manager = await _manager(hass)
    for index in range(MAX_ROOM_SEQUENCE_SIZE + 1):
        manager.repository.robot(SERIAL)["areas"][f"area-{index}"] = _area(_floor())
    entries = [_area_entry(f"area-{index}") for index in range(MAX_ROOM_SEQUENCE_SIZE)]

    await manager.catalog.async_save_plan(
        SERIAL, "many", {"name": "Many", "rooms": [], "entries": entries}
    )
    with pytest.raises(PlanAreaLimitError, match="at most 100 custom areas"):
        await manager.catalog.async_save_plan(
            SERIAL,
            "many",
            {
                "name": "Many",
                "rooms": [],
                "entries": [*entries, _area_entry(f"area-{MAX_ROOM_SEQUENCE_SIZE}")],
            },
        )
    assert (
        len(manager.catalog.plan(SERIAL, "many")["entries"]) == MAX_ROOM_SEQUENCE_SIZE
    )


def test_plan_entries_reads_unstamped_plans_and_rejects_corrupt_order() -> None:
    assert plan_entries({"rooms": [_room("room-kitchen"), "bad"]}) == [
        _room_entry("room-kitchen")
    ]
    assert plan_entries({}) == []
    assert plan_entries({"rooms": "corrupt"}) == []
    with pytest.raises(ValueError, match="do not match"):
        plan_entries({"rooms": [_room("room-kitchen")], "entries": []})
    with pytest.raises(ValueError, match="entries are invalid"):
        plan_entries({"rooms": [], "entries": [{"kind": "area"}]})


# Area deletion -------------------------------------------------------------


async def test_deleting_an_area_removes_it_from_every_plan_atomically(hass) -> None:
    manager = await _manager(hass)
    await manager.catalog.async_save_plan(
        SERIAL,
        "mixed",
        {
            "name": "Mixed",
            "rooms": [_room("room-kitchen")],
            "entries": [_area_entry("rug"), _room_entry("room-kitchen")],
        },
    )
    await manager.catalog.async_save_plan(
        SERIAL,
        "spots",
        {
            "name": "Spots",
            "rooms": [],
            "entries": [_area_entry("mat"), _area_entry("rug")],
        },
        select=False,
    )
    await manager.catalog.async_select_area(SERIAL, "rug")
    listener = MagicMock()
    manager.repository.async_add_listener(SERIAL, listener)

    await manager.catalog.async_delete_area(SERIAL, "rug")

    assert "rug" not in manager.catalog.areas(SERIAL)
    assert manager.catalog.plan(SERIAL, "mixed")["entries"] == [
        _room_entry("room-kitchen")
    ]
    assert manager.catalog.plan(SERIAL, "spots")["entries"] == [_area_entry("mat")]
    assert manager.catalog.plans_using_area(SERIAL, "rug") == []
    assert manager.ledger.snapshot(SERIAL)["selected_area"] == "mat"
    listener.assert_called()


async def test_deleting_an_area_refuses_to_empty_a_plan(hass, caplog) -> None:
    manager = await _manager(hass)
    await manager.catalog.async_save_plan(
        SERIAL,
        "spots",
        {"name": "Rug only", "rooms": [], "entries": [_area_entry("rug")]},
    )
    await manager.catalog.async_save_plan(
        SERIAL,
        "mixed",
        {
            "name": "Mixed",
            "rooms": [_room("room-kitchen")],
            "entries": [_room_entry("room-kitchen"), _area_entry("rug")],
        },
    )
    before = deepcopy(manager.repository.robot(SERIAL))
    manager.repository.store.async_save.reset_mock()

    with pytest.raises(AreaInUseError) as raised:
        await manager.catalog.async_delete_area(SERIAL, "rug")

    assert raised.value.plan_names == ("Rug only",)
    assert manager.repository.robot(SERIAL) == before
    manager.repository.store.async_save.assert_not_awaited()
    await hass.async_block_till_done()
    assert "Metadata persistence task failed" not in caplog.text


async def test_deleting_an_area_restores_plans_when_storage_fails(hass, caplog) -> None:
    manager = await _manager(hass)
    await manager.catalog.async_save_plan(
        SERIAL,
        "mixed",
        {
            "name": "Mixed",
            "rooms": [_room("room-kitchen")],
            "entries": [_room_entry("room-kitchen"), _area_entry("rug")],
        },
    )
    before = deepcopy(manager.repository.robot(SERIAL))
    manager.repository.store.async_save = AsyncMock(
        side_effect=HomeAssistantError("disk")
    )

    with pytest.raises(HomeAssistantError, match="disk"):
        await manager.catalog.async_delete_area(SERIAL, "rug")

    assert manager.repository.robot(SERIAL) == before
    await hass.async_block_till_done()
    assert "Metadata persistence task failed" in caplog.text


async def test_deleting_an_unused_area_keeps_plans_untouched(hass) -> None:
    manager = await _manager(hass)
    await manager.catalog.async_save_plan(
        SERIAL, "home", {"name": "Home", "rooms": [_room("room-kitchen")]}
    )
    manager.repository.robot(SERIAL)["plans"]["legacy"] = {"rooms": "corrupt"}
    plans = deepcopy(manager.catalog.plans(SERIAL))

    await manager.catalog.async_delete_area(SERIAL, "rug")

    assert "rug" not in manager.catalog.areas(SERIAL)
    assert manager.catalog.plans(SERIAL) == plans


# Preview -----------------------------------------------------------------


async def _mixed_manager(hass, floor: FloorPlan) -> CleaningPlanManager:
    manager = await _manager(hass, floor)
    await manager.catalog.async_save_plan(
        SERIAL,
        "mixed",
        {
            "name": "Mixed",
            "run_behavior": "intelligent",
            "rooms": [
                _room("room-kitchen"),
                _room("room-study", "mop"),
                _room("room-hall"),
            ],
            "entries": [
                _room_entry("room-kitchen"),
                _room_entry("room-study"),
                _area_entry("rug"),
                _area_entry("mat", "vacuum_and_mop", "heavy_duty"),
                _room_entry("room-hall"),
            ],
        },
    )
    return manager


async def test_preview_rotates_rooms_and_areas_together_but_saved_order_is_exact(hass):
    floor = _floor()
    manager = await _mixed_manager(hass, floor)
    robot = manager.repository.robot(SERIAL)
    robot["rooms"] = {
        "room-kitchen": {"last_opportunity": "2026-01-04T00:00:00+00:00"},
        "room-study": {"last_opportunity": "2026-01-02T00:00:00+00:00"},
    }
    robot["area_history"]["rug"] = {
        "fingerprint": plan_area_fingerprint(robot["areas"]["rug"]),
        "last_opportunity": "2026-01-03T00:00:00+00:00",
    }
    # Mat and Hall are unattempted, so their saved relative order breaks the tie.
    preview = manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)
    entries = preview["entries"]
    assert [e.get("room_id", e.get("area_id")) for e in entries] == [
        "mat",
        "room-hall",
        "room-study",
        "rug",
        "room-kitchen",
    ]
    assert [r["room_id"] for r in preview["rooms"]] == [
        "room-hall",
        "room-study",
        "room-kitchen",
    ]
    assert [r.get("room_id", r.get("area_id")) for r in preview["rotation"]] == [
        "mat",
        "room-hall",
        "room-study",
        "rug",
        "room-kitchen",
    ]
    assert entries[0]["cleaning_mode"] == "vacuum_and_mop"
    assert entries[3]["binding_fingerprint"] == plan_area_fingerprint(
        robot["areas"]["rug"]
    )
    assert preview["room_count"] == 3
    assert preview["area_count"] == 2
    assert entry_mission_boundaries(entries) == [1, 3, 4]
    # The executor receives exactly the preview's room order and area positions.
    legs = plan_legs(
        [
            CleaningRoom(
                **{
                    k: r[k]
                    for k in ("room_id", "name", "cleaning_mode", "coverage_setting")
                }
            )
            for r in preview["rooms"]
        ],
        run_entries(entries),
        mixed_settings=True,
    )
    assert [
        leg.area_id if isinstance(leg, AreaLeg) else [r.room_id for r in leg]
        for leg in legs
    ] == [
        "mat",
        ["room-hall", "room-study"],
        "rug",
        ["room-kitchen"],
    ]
    ordered = manager.catalog.preview(
        SERIAL, ROOM_MAP, "mixed", intelligent=False, floor_plan=floor
    )
    assert [e.get("room_id", e.get("area_id")) for e in ordered["entries"]] == [
        "room-kitchen",
        "room-study",
        "rug",
        "mat",
        "room-hall",
    ]
    assert all(r["selection_reason"] == "saved_order" for r in ordered["rotation"])


async def test_preview_supports_area_only_plans(hass) -> None:
    floor = _floor()
    manager = await _manager(hass, floor)
    await manager.catalog.async_save_plan(
        SERIAL,
        "spots",
        {"name": "Spots", "rooms": [], "entries": [_area_entry("rug")]},
    )

    preview = manager.catalog.preview(SERIAL, ROOM_MAP, "spots", floor_plan=floor)

    assert preview["rooms"] == []
    assert [entry["area_id"] for entry in preview["entries"]] == ["rug"]
    assert preview["room_count"] == 0
    assert preview["area_count"] == 1


async def test_room_only_preview_lists_room_entries_without_area_counts(
    hass,
) -> None:
    floor = _floor()
    manager = await _manager(hass, floor)
    await manager.catalog.async_save_plan(
        SERIAL, "home", {"name": "Home", "rooms": [_room("room-kitchen")]}
    )

    preview = manager.catalog.preview(SERIAL, ROOM_MAP, "home")

    assert preview["entries"] == [{"kind": "room", **preview["rooms"][0]}]
    assert "area_count" not in preview
    manager.repository.robot(SERIAL)["plans"]["home"]["rooms"] = []
    manager.repository.robot(SERIAL)["plans"]["home"]["entries"] = []
    with pytest.raises(EmptyPlanError):
        manager.catalog.preview(SERIAL, ROOM_MAP, "home")


async def test_preview_blocks_missing_and_stale_areas(hass) -> None:
    floor = _floor()
    manager = await _mixed_manager(hass, floor)

    with pytest.raises(PlanAreaMapChangedError):
        manager.catalog.preview(SERIAL, ROOM_MAP, "mixed")
    with pytest.raises(PlanAreaMapChangedError):
        manager.catalog.preview(
            SERIAL, ROOM_MAP, "mixed", floor_plan=_floor(mission_id=43)
        )
    manager.repository.robot(SERIAL)["areas"].pop("mat")
    with pytest.raises(PlanAreaMissingError):
        manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)
    manager.repository.robot(SERIAL)["areas"]["mat"] = "corrupt"
    with pytest.raises(PlanAreaMissingError):
        manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)
    manager.repository.robot(SERIAL)["plans"]["mixed"]["enabled"] = False
    with pytest.raises(PlanDisabledError):
        manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)
    manager.repository.robot(SERIAL)["plans"]["mixed"]["enabled"] = True
    manager.repository.robot(SERIAL)["plans"]["mixed"]["rooms"].append("corrupt")
    with pytest.raises(ValueError, match="invalid room"):
        manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)
    manager.repository.robot(SERIAL)["plans"]["mixed"]["rooms"] = "corrupt"
    manager.repository.robot(SERIAL)["plans"]["mixed"]["entries"] = [_area_entry("rug")]
    with pytest.raises(ValueError, match="invalid room"):
        manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)


async def test_preview_token_covers_area_binding_but_not_room_only_plans(
    hass,
) -> None:
    floor = _floor()
    manager = await _mixed_manager(hass, floor)
    token_inputs = {
        "entry_id": "entry",
        "floor_token": plan_floor_token(floor),
        "room_identities": {},
    }
    preview = manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)
    token = saved_plan_preview_token(preview, **token_inputs)

    # Room-only previews hash exactly what they hashed before entries existed.
    room_only = {
        **preview,
        "entries": [{"kind": "room", **room} for room in preview["rooms"]],
    }
    legacy = {key: value for key, value in room_only.items() if key != "entries"}
    assert saved_plan_preview_token(
        room_only, **token_inputs
    ) == saved_plan_preview_token(legacy, **token_inputs)
    assert token != saved_plan_preview_token(room_only, **token_inputs)

    redrawn = deepcopy(preview)
    redrawn["entries"][2]["binding_fingerprint"] = "0" * 64
    assert saved_plan_preview_token(redrawn, **token_inputs) != token
    restated = deepcopy(preview)
    restated["entries"][2]["binding_status"] = "geometry_changed"
    assert saved_plan_preview_token(restated, **token_inputs) != token

    await manager.catalog.async_save_area(SERIAL, "rug", _area(floor, "Rug", 3.0))
    moved = manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)
    assert saved_plan_preview_token(moved, **token_inputs) != token


def test_mission_boundaries_split_at_every_room_and_area_switch() -> None:
    rooms = [
        CleaningRoom("a", "A", "vacuum", "standard"),
        CleaningRoom("b", "B", "mop", "standard"),
    ]
    room_entries = [
        {
            "kind": "room",
            "room_id": room.room_id,
            "name": room.name,
            "cleaning_mode": room.cleaning_mode,
            "coverage_setting": room.coverage_setting,
        }
        for room in rooms
    ]
    expected_rooms_only = []
    offset = 0
    for group in leg_groups(rooms, mixed_settings=True)[:-1]:
        offset += len(group)
        expected_rooms_only.append(offset)
    assert entry_mission_boundaries(room_entries) == expected_rooms_only
    assert entry_mission_boundaries(room_entries, single_room_missions=True) == [1]
    area = {"kind": "area", "area_id": "rug"}
    assert entry_mission_boundaries([]) == []
    assert entry_mission_boundaries([area]) == []
    assert entry_mission_boundaries([area, area]) == [1]
    assert entry_mission_boundaries([room_entries[0], area, room_entries[1]]) == [1, 2]
    assert entry_mission_boundaries([area, *room_entries]) == [
        1,
        *[1 + value for value in expected_rooms_only],
    ]


# Services ----------------------------------------------------------------


def _context(floor: FloorPlan):
    return ("vacuum.test", _entry(floor), SERIAL, dict(ROOM_MAP))


def _call(hass, service: str, data: dict) -> ServiceCall:
    return ServiceCall(hass, DOMAIN, service, {"entity_id": ["vacuum.test"], **data})


async def _handler(hass, manager, service: str, schema, data: dict, floor=None):
    services = await _registered_services(hass, manager)
    floor = floor or _floor()
    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=_context(floor),
    ):
        return await _registered_handler(services, service)(
            _call(hass, service, schema({"entity_id": ["vacuum.test"], **data}))
        )


def test_entry_schemas_keep_room_and_area_exclusive() -> None:
    base = {"entity_id": ["vacuum.test"], "name": "Home"}
    parsed = SAVE_PLAN_SCHEMA(
        {
            **base,
            "rooms": [
                {"room": "Kitchen"},
                {"area": "Rug"},
                {"area": "Mat", "cleaning_mode": "mop", "coverage_setting": "quick"},
            ],
        }
    )
    assert parsed["rooms"][1] == {"area": "Rug"}
    assert parsed["rooms"][0]["cleaning_mode"] == "vacuum_and_mop"
    for invalid in (
        {"room": "Kitchen", "area": "Rug"},
        {"area": "Rug", "cadence": {"mop_every_n": 2}},
        {"area": ""},
        "Rug",
    ):
        with pytest.raises(probatio.Invalid):
            SAVE_PLAN_SCHEMA({**base, "rooms": [invalid]})
    with pytest.raises(probatio.Invalid):
        SAVE_PLAN_SCHEMA({**base, "rooms": []})
    with pytest.raises(probatio.Invalid):
        SAVE_PLAN_ROOM_SCHEMA(
            {
                "entity_id": ["vacuum.test"],
                "plan": "Home",
                "room": {"room": "Kitchen", "area": "Rug"},
            }
        )
    target = {"entity_id": ["vacuum.test"], "plan": "Home"}
    for schema, extra in (
        (DELETE_PLAN_ROOM_SCHEMA, {}),
        (MOVE_PLAN_ROOM_SCHEMA, {"new_position": 1}),
    ):
        assert schema({**target, **extra, "area": "Rug"})["area"] == "Rug"
        assert schema({**target, **extra, "room": "Kitchen"})["room"] == "Kitchen"
        with pytest.raises(probatio.Invalid):
            schema({**target, **extra})
        with pytest.raises(probatio.Invalid):
            schema({**target, **extra, "room": "Kitchen", "area": "Rug"})


async def test_save_plan_service_stores_areas_with_their_settings(hass) -> None:
    manager = await _manager(hass)

    saved = await _handler(
        hass,
        manager,
        "save_plan",
        SAVE_PLAN_SCHEMA,
        {
            "name": "Mixed",
            "rooms": [
                {"area": "Rug"},
                {"room": "Kitchen", "cleaning_mode": "vacuum"},
                {"area": "mat", "cleaning_mode": "mop", "coverage_setting": "quick"},
            ],
        },
    )
    spots = await _handler(
        hass,
        manager,
        "save_plan",
        SAVE_PLAN_SCHEMA,
        {"name": "Spots", "rooms": [{"area": "Rug"}]},
    )

    assert saved["plan"]["entries"] == [
        _area_entry("rug", "vacuum", "standard"),
        _room_entry("room-kitchen"),
        _area_entry("mat", "mop", "quick"),
    ]
    assert saved["plan"]["rooms"] == [
        {
            "room_id": "room-kitchen",
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        }
    ]
    assert saved["plan"]["room_order"] == ["room-kitchen"]
    assert spots["plan"]["rooms"] == []
    assert spots["plan"]["entries"] == [_area_entry("rug", "vacuum", "standard")]


@pytest.mark.parametrize(
    ("rooms", "floor", "key"),
    [
        ([{"area": "Missing"}], _floor(), "unknown_area"),
        ([{"area": "Rug"}], _floor(mission_id=43), "area_map_changed"),
        ([{"area": "Rug"}, {"area": "rug"}], _floor(), "duplicate_area"),
    ],
)
async def test_save_plan_service_rejects_unusable_areas(
    hass, rooms, floor, key: str
) -> None:
    manager = await _manager(hass)

    with pytest.raises(ServiceValidationError) as raised:
        await _handler(
            hass,
            manager,
            "save_plan",
            SAVE_PLAN_SCHEMA,
            {"name": "Spots", "rooms": rooms},
            floor,
        )

    assert raised.value.translation_key == key
    assert manager.catalog.plans(SERIAL) == {}


async def test_plan_area_crud_services_edit_one_ordered_list(hass) -> None:
    manager = await _manager(hass)
    await _handler(
        hass,
        manager,
        "save_plan",
        SAVE_PLAN_SCHEMA,
        {"name": "Home", "rooms": [{"room": "Kitchen"}, {"room": "Study"}]},
    )

    added = await _handler(
        hass,
        manager,
        "save_plan_room",
        SAVE_PLAN_ROOM_SCHEMA,
        {"plan": "Home", "room": {"area": "Rug"}},
    )
    assert added == {
        "plan_id": "home",
        "position": 3,
        "area": _area_entry("rug", "vacuum", "standard"),
    }
    updated = await _handler(
        hass,
        manager,
        "save_plan_room",
        SAVE_PLAN_ROOM_SCHEMA,
        {"plan": "Home", "room": {"area": "rug", "cleaning_mode": "mop"}},
    )
    assert updated["position"] == 3
    assert updated["area"]["cleaning_mode"] == "mop"

    moved = await _handler(
        hass,
        manager,
        "move_plan_room",
        MOVE_PLAN_ROOM_SCHEMA,
        {"plan": "Home", "area": "Rug", "new_position": 1},
    )
    assert moved == {
        "plan_id": "home",
        "previous_position": 3,
        "position": 1,
        "area": _area_entry("rug", "mop", "standard"),
    }
    moved_room = await _handler(
        hass,
        manager,
        "move_plan_room",
        MOVE_PLAN_ROOM_SCHEMA,
        {"plan": "Home", "room": "Study", "new_position": 1},
    )
    assert moved_room["previous_position"] == 3
    assert moved_room["room"]["room_id"] == "room-study"
    plan = manager.catalog.plan(SERIAL, "home")
    assert plan["entries"] == [
        _room_entry("room-study"),
        _area_entry("rug", "mop", "standard"),
        _room_entry("room-kitchen"),
    ]
    assert [room["room_id"] for room in plan["rooms"]] == [
        "room-study",
        "room-kitchen",
    ]

    added_room = await _handler(
        hass,
        manager,
        "save_plan_room",
        SAVE_PLAN_ROOM_SCHEMA,
        {"plan": "Home", "room": {"room": "Hall"}},
    )
    assert added_room["position"] == 4
    assert added_room["room"]["room_id"] == "room-hall"

    removed = await _handler(
        hass,
        manager,
        "delete_plan_room",
        DELETE_PLAN_ROOM_SCHEMA,
        {"plan": "Home", "area": "Rug"},
    )
    assert removed == {
        "plan_id": "home",
        "deleted": _area_entry("rug", "mop", "standard"),
    }
    for room in ("Study", "Kitchen", "Hall"):
        await _handler(
            hass,
            manager,
            "delete_plan_room",
            DELETE_PLAN_ROOM_SCHEMA,
            {"plan": "Home", "room": room},
        )
    emptied = manager.catalog.plan(SERIAL, "home")
    assert emptied["entries"] == []
    assert emptied["rooms"] == []
    assert emptied["enabled"] is False


async def test_removing_the_last_room_keeps_an_area_plan_enabled(hass) -> None:
    manager = await _manager(hass)
    await _handler(
        hass,
        manager,
        "save_plan",
        SAVE_PLAN_SCHEMA,
        {"name": "Home", "rooms": [{"room": "Kitchen"}, {"area": "Rug"}]},
    )

    await _handler(
        hass,
        manager,
        "delete_plan_room",
        DELETE_PLAN_ROOM_SCHEMA,
        {"plan": "Home", "room": "Kitchen"},
    )

    plan = manager.catalog.plan(SERIAL, "home")
    assert plan["enabled"] is True
    assert plan["entries"] == [_area_entry("rug", "vacuum", "standard")]


@pytest.mark.parametrize(
    ("service", "schema", "data", "key"),
    [
        (
            "delete_plan_room",
            DELETE_PLAN_ROOM_SCHEMA,
            {"area": "Mat"},
            "area_not_in_plan",
        ),
        (
            "delete_plan_room",
            DELETE_PLAN_ROOM_SCHEMA,
            {"area": "Missing"},
            "unknown_area",
        ),
        (
            "move_plan_room",
            MOVE_PLAN_ROOM_SCHEMA,
            {"area": "Mat", "new_position": 1},
            "area_not_in_plan",
        ),
        (
            "move_plan_room",
            MOVE_PLAN_ROOM_SCHEMA,
            {"area": "Rug", "new_position": 3},
            "invalid_room_position",
        ),
        (
            "save_plan_room",
            SAVE_PLAN_ROOM_SCHEMA,
            {"room": {"area": "Missing"}},
            "unknown_area",
        ),
    ],
)
async def test_plan_area_crud_reports_unknown_areas_and_positions(
    hass, service: str, schema, data: dict, key: str
) -> None:
    manager = await _manager(hass)
    await _handler(
        hass,
        manager,
        "save_plan",
        SAVE_PLAN_SCHEMA,
        {"name": "Home", "rooms": [{"room": "Kitchen"}, {"area": "Rug"}]},
    )
    before = manager.catalog.plan(SERIAL, "home")

    with pytest.raises(ServiceValidationError) as raised:
        await _handler(hass, manager, service, schema, {"plan": "Home", **data})

    assert raised.value.translation_key == key
    assert manager.catalog.plan(SERIAL, "home") == before


async def test_plan_area_crud_reaches_a_deleted_area_by_its_id(hass) -> None:
    manager = await _manager(hass)
    await _handler(
        hass,
        manager,
        "save_plan",
        SAVE_PLAN_SCHEMA,
        {"name": "Home", "rooms": [{"room": "Kitchen"}, {"area": "Rug"}]},
    )
    # A store written by another tool can still name an area that is gone.
    manager.repository.robot(SERIAL)["areas"].pop("rug")

    removed = await _handler(
        hass,
        manager,
        "delete_plan_room",
        DELETE_PLAN_ROOM_SCHEMA,
        {"plan": "Home", "area": "rug"},
    )

    assert removed["deleted"]["area_id"] == "rug"
    assert manager.catalog.plan(SERIAL, "home")["entries"] == [
        _room_entry("room-kitchen")
    ]


@pytest.mark.parametrize(
    ("service", "schema", "data"),
    [
        ("delete_plan_room", DELETE_PLAN_ROOM_SCHEMA, {"area": "rug"}),
        ("move_plan_room", MOVE_PLAN_ROOM_SCHEMA, {"area": "rug", "new_position": 1}),
    ],
)
async def test_plan_edits_report_another_missing_area(
    hass, service: str, schema, data: dict
) -> None:
    manager = await _manager(hass)
    await _handler(
        hass,
        manager,
        "save_plan",
        SAVE_PLAN_SCHEMA,
        {
            "name": "Home",
            "rooms": [{"room": "Kitchen"}, {"area": "Rug"}, {"area": "Mat"}],
        },
    )
    manager.repository.robot(SERIAL)["areas"].pop("mat")
    before = manager.catalog.plan(SERIAL, "home")

    with pytest.raises(ServiceValidationError) as raised:
        await _handler(hass, manager, service, schema, {"plan": "Home", **data})

    assert raised.value.translation_key == "plan_area_missing"
    assert manager.catalog.plan(SERIAL, "home") == before


async def test_plan_edits_report_a_corrupt_entry_order(hass) -> None:
    manager = await _manager(hass)
    await _handler(
        hass,
        manager,
        "save_plan",
        SAVE_PLAN_SCHEMA,
        {"name": "Home", "rooms": [{"room": "Kitchen"}]},
    )
    manager.repository.robot(SERIAL)["plans"]["home"]["entries"] = []

    with pytest.raises(ServiceValidationError) as raised:
        await _handler(
            hass,
            manager,
            "delete_plan_room",
            DELETE_PLAN_ROOM_SCHEMA,
            {"plan": "Home", "room": "Kitchen"},
        )

    assert raised.value.translation_key == "invalid_plan"


def test_plan_request_errors_translate_area_failures() -> None:
    assert _plan_request_error(PlanAreaMissingError("x")).translation_key == (
        "plan_area_missing"
    )
    assert _plan_request_error(PlanAreaMapChangedError("x")).translation_key == (
        "area_map_changed"
    )
    assert _plan_request_error(DuplicatePlanAreaError("x")).translation_key == (
        "duplicate_area"
    )
    limit = _plan_request_error(PlanAreaLimitError("x"))
    assert limit.translation_key == "plan_area_limit"
    assert limit.translation_placeholders == {"limit": str(MAX_ROOM_SEQUENCE_SIZE)}


@pytest.mark.parametrize(
    "service", ["run_selected_plan", "intelligent_clean", "clean_entire_plan"]
)
@pytest.mark.parametrize("plan", ["Mixed", "Spots"])
async def test_running_a_plan_with_areas_hands_its_run_order_to_the_executor(
    hass, service: str, plan: str
) -> None:
    floor = _floor()
    manager = await _mixed_manager(hass, floor)
    await manager.catalog.async_save_plan(
        SERIAL,
        "spots",
        {
            "name": "Spots",
            "rooms": [],
            "entries": [_area_entry("rug"), _area_entry("mat")],
        },
        select=False,
    )
    services = await _registered_services(hass, manager)
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            coordinator=MagicMock(data=SimpleNamespace(floor_plan=floor)),
            client=MagicMock(),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )

    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=("vacuum.test", entry, SERIAL, dict(ROOM_MAP)),
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(),
        ) as execute,
    ):
        await _registered_handler(services, service)(
            _call(hass, service, {"plan": plan})
        )

    execute.assert_awaited_once()
    rooms = execute.await_args.args[5]
    entries = execute.await_args.kwargs["entries"]
    kwargs = execute.await_args.kwargs
    # Every area entry carries its fingerprint, in the preview's run order.
    assert all(
        entry["binding_fingerprint"]
        == plan_area_fingerprint(manager.catalog.areas(SERIAL)[entry["area_id"]])
        for entry in entries
        if entry["kind"] == "area"
    )
    assert [entry["room_id"] for entry in entries if entry["kind"] == "room"] == [
        room.room_id for room in rooms
    ]
    if plan == "Spots":
        assert rooms == []
        assert [entry["area_id"] for entry in entries] == ["rug", "mat"]
    else:
        assert {room.room_id for room in rooms} == set(ROOM_MAP)
        assert [entry["kind"] for entry in entries].count("area") == 2
    assert kwargs["floor_token"] == plan_floor_token(floor)
    assert kwargs["floor_is_current"]() is True
    kwargs["validate_prepared_run"]()
    assert manager.ledger.snapshot(SERIAL)["active_plan"] is None


async def test_running_a_room_only_plan_keeps_its_legacy_executor_call(hass) -> None:
    floor = _floor()
    manager = await _manager(hass, floor)
    await manager.catalog.async_save_plan(
        SERIAL, "home", {"name": "Home", "rooms": [_room("room-kitchen")]}
    )
    services = await _registered_services(hass, manager)
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(
            coordinator=MagicMock(data=SimpleNamespace(floor_plan=floor)),
            client=MagicMock(),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    with (
        patch(
            "custom_components.matic_robot.services._saved_plan_context",
            return_value=("vacuum.test", entry, SERIAL, dict(ROOM_MAP)),
        ),
        patch(
            "custom_components.matic_robot.services._async_execute_rooms",
            AsyncMock(),
        ) as execute,
    ):
        await _registered_handler(services, "run_selected_plan")(
            _call(hass, "run_selected_plan", {"plan": "Home"})
        )

    assert execute.await_args.kwargs["entries"] is None
    assert [room.room_id for room in execute.await_args.args[5]] == ["room-kitchen"]


async def test_preview_plan_service_returns_typed_entries(hass) -> None:
    floor = _floor()
    manager = await _mixed_manager(hass, floor)
    services = await _registered_services(hass, manager)

    with patch(
        "custom_components.matic_robot.services._saved_plan_context",
        return_value=_context(floor),
    ):
        preview = await _registered_handler(services, "preview_plan")(
            _call(hass, "preview_plan", {"plan": "Mixed"})
        )

    assert [entry["kind"] for entry in preview["entries"]] == [
        "room",
        "room",
        "area",
        "area",
        "room",
    ]
    assert len(preview["preview_token"]) == 64


def test_move_reaches_every_position_of_a_full_mixed_plan() -> None:
    # The room limit and as many custom areas again.
    full = 2 * MAX_ROOM_SEQUENCE_SIZE
    move = {"entity_id": "vacuum.matic", "plan": "Home", "area": "rug"}
    assert MOVE_PLAN_ROOM_SCHEMA({**move, "new_position": full})["new_position"] == full
    with pytest.raises(probatio.Invalid):
        MOVE_PLAN_ROOM_SCHEMA({**move, "new_position": full + 1})


# Run legs ------------------------------------------------------------------

_FINGERPRINT = "f" * 64


def _run_area(area_id: str, mode: str = "vacuum", coverage: str = "quick") -> dict:
    return {
        "kind": "area",
        "area_id": area_id,
        "name": area_id.title(),
        "cleaning_mode": mode,
        "coverage_setting": coverage,
        "fingerprint": _FINGERPRINT,
    }


def _rooms() -> list[CleaningRoom]:
    return [
        CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard"),
        CleaningRoom("room-study", "Study", "mop", "standard"),
        CleaningRoom("room-hall", "Hall", "vacuum", "standard"),
    ]


def test_run_entries_keep_room_only_plans_on_their_legacy_checkpoint() -> None:
    assert run_entries(None) is None
    assert run_entries("corrupt") is None
    assert run_entries([_room_entry("room-kitchen"), "corrupt"]) is None

    preview_entries = [
        {"kind": "room", "room_id": "room-kitchen", "name": "Kitchen"},
        {
            "kind": "area",
            "area_id": "rug",
            "name": "Rug",
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
            "binding_status": "current",
            "binding_fingerprint": _FINGERPRINT,
        },
    ]
    assert run_entries(preview_entries) == [
        {"kind": "room", "room_id": "room-kitchen"},
        {**_run_area("rug"), "name": "Rug"},
    ]


def test_plan_legs_split_rooms_at_every_area_in_entry_order() -> None:
    rooms = _rooms()
    # Without areas the legs are exactly the room groups.
    assert plan_legs(rooms, None, mixed_settings=True) == list(
        leg_groups(rooms, mixed_settings=True)
    )
    assert plan_legs(rooms, None, preserve_legacy_settings=True) == list(
        leg_groups(rooms, preserve_legacy_settings=True)
    )

    entries = [
        _run_area("rug"),
        _room_entry("room-kitchen"),
        _room_entry("room-study"),
        _run_area("mat", "vacuum_and_mop", "heavy_duty"),
        _room_entry("room-hall"),
    ]
    legs = plan_legs(rooms, entries, mixed_settings=True)
    assert legs == [
        AreaLeg("rug", "Rug", "vacuum", "quick", _FINGERPRINT),
        rooms[:2],
        AreaLeg("mat", "Mat", "vacuum_and_mop", "heavy_duty", _FINGERPRINT),
        rooms[2:],
    ]
    # Legacy settings boundaries still split the rooms between two areas.
    assert plan_legs(rooms, entries, preserve_legacy_settings=True)[1:3] == [
        rooms[:1],
        rooms[1:2],
    ]
    assert plan_legs([], [_run_area("rug"), _run_area("mat")]) == [
        AreaLeg("rug", "Rug", "vacuum", "quick", _FINGERPRINT),
        AreaLeg("mat", "Mat", "vacuum", "quick", _FINGERPRINT),
    ]


@pytest.mark.parametrize(
    ("room_count", "entries", "message"),
    [
        (0, "corrupt", "invalid"),
        (0, ["corrupt"], "invalid"),
        (0, [{"kind": "zone"}], "invalid"),
        # Room entries must name the run's rooms, in order, exactly once.
        (1, [_room_entry("room-study")], "do not match"),
        (1, [_room_entry("room-kitchen")] * 2, "do not match"),
        (2, [_room_entry("room-kitchen")], "do not match"),
        (
            0,
            [{key: value for key, value in _run_area("rug").items() if key != "name"}],
            "invalid",
        ),
        (0, [{**_run_area("rug"), "extra": "x"}], "invalid"),
        (0, [{**_run_area("rug"), "name": ""}], "invalid"),
        (0, [{**_run_area("rug"), "name": 1}], "invalid"),
        (0, [_run_area("rug", "steam")], "invalid"),
        (0, [_run_area("rug", "vacuum", "deep")], "invalid"),
        (0, [{**_run_area("rug"), "fingerprint": "f" * 63}], "invalid"),
    ],
)
def test_plan_legs_reject_entries_that_do_not_describe_the_run(
    room_count, entries, message
) -> None:
    with pytest.raises(ValueError, match=message):
        plan_legs(_rooms()[:room_count], entries)


def test_checkpoint_legs_rebuild_the_runs_legs() -> None:
    rooms = _rooms()
    room_only_checkpoint = {
        "rooms": [
            {
                "room_id": room.room_id,
                "name": room.name,
                "cleaning_mode": room.cleaning_mode,
                "coverage_setting": room.coverage_setting,
            }
            for room in rooms
        ],
        "mixed_settings": True,
    }
    # RC40 checkpoints without the new marker retain their existing mixed
    # mission even when finish_current_room is enabled on the saved policy.
    assert checkpoint_legs(room_only_checkpoint) == [rooms]
    assert checkpoint_legs({**room_only_checkpoint, "single_room_missions": True}) == [
        [room] for room in rooms
    ]

    checkpoint = {
        "rooms": [
            {
                "room_id": room.room_id,
                "name": room.name,
                "cleaning_mode": room.cleaning_mode,
                "coverage_setting": room.coverage_setting,
            }
            for room in rooms
        ],
        "mixed_settings": True,
        "entries": [
            _room_entry("room-kitchen"),
            _run_area("rug"),
            _room_entry("room-study"),
            _room_entry("room-hall"),
        ],
    }
    assert checkpoint_legs(checkpoint) == [
        rooms[:1],
        AreaLeg("rug", "Rug", "vacuum", "quick", _FINGERPRINT),
        rooms[1:],
    ]
    legacy = {**checkpoint, "mixed_settings": False}
    legacy.pop("entries")
    assert checkpoint_legs(legacy) == list(
        leg_groups(rooms, preserve_legacy_settings=True)
    )
    smart_stop = {**checkpoint, "single_room_missions": True}
    assert checkpoint_legs(smart_stop) == [[room] for room in rooms[:1]] + [
        AreaLeg("rug", "Rug", "vacuum", "quick", _FINGERPRINT),
        *[[room] for room in rooms[1:]],
    ]


def test_single_room_mission_grouping_is_opt_in_and_keeps_area_boundaries() -> None:
    rooms = _rooms()
    assert leg_groups(rooms, mixed_settings=True, single_room_missions=True) == [
        [room] for room in rooms
    ]


@pytest.mark.parametrize(
    ("entries", "leg_index", "dispatching"),
    [
        (None, 0, True),
        (None, 1, False),
        ([_room_entry("room-kitchen"), _run_area("rug")], 0, True),
        ([_room_entry("room-kitchen"), _run_area("rug")], 1, False),
        ([_room_entry("room-kitchen"), _run_area("rug")], 2, False),
        ([_room_entry("room-kitchen"), _run_area("rug")], -1, False),
        ([_room_entry("room-kitchen"), _run_area("rug")], True, False),
        ([_run_area("rug")], 0, False),
        ("corrupt", 0, False),
    ],
)
def test_only_a_room_leg_is_a_mixed_dispatch(entries, leg_index, dispatching) -> None:
    checkpoint = {
        "rooms": [
            {
                "room_id": "room-kitchen",
                "name": "Kitchen",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            }
        ],
        "mixed_settings": True,
        "leg_index": leg_index,
    }
    if entries is not None:
        checkpoint["entries"] = entries
    assert _dispatching_room_leg(checkpoint) is dispatching
