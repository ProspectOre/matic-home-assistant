"""Shared counting uncertainty blocks dispatch until an explicit full reset."""

import json
from copy import deepcopy
from dataclasses import replace

import pytest
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.completion_ledger as ledger
from custom_components.matic_robot.plan_model import (
    CleaningRoom,
    plan_floor_token,
    room_cadence_identity,
)
from custom_components.matic_robot.plan_views import MaticPlansView
from tests.test_cadence_manager import _floor, _manager
from tests.test_completion_ledger import _snapshot
from tests.test_slam_scene import _entry, _hass, _request, _runtime


async def _configured(hass, count=1):
    floor = _floor()
    floor = replace(
        floor,
        rooms=tuple(
            replace(
                floor.rooms[0],
                id=f"room-{index}",
                name=f"Room {index}",
                protocol_id=f"protocol-{index}",
                id_wire=f"wire-{index}".encode(),
            )
            for index in range(count)
        ),
    )
    manager = _manager(hass)
    identities = {
        room.id: room_cadence_identity(floor, room.id) for room in floor.rooms
    }
    rooms = [
        CleaningRoom(room.id, room.name, "vacuum", "standard") for room in floor.rooms
    ]
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": room.cleaning_mode,
                    "coverage_setting": room.coverage_setting,
                    "cadence": {
                        "scope": "shared",
                        "mop_every_n": 5,
                        "coverage_every_n": 5,
                        "periodic_coverage_setting": "heavy_duty",
                    },
                }
                for room in rooms
            ],
        },
        floor_token=plan_floor_token(floor),
        room_identities=identities,
    )
    return manager, floor, rooms, identities


def _record(schedule, number, timestamp):
    return ledger.record_completion(
        schedule,
        f"{number:064x}",
        at=timestamp,
        source="managed",
        snapshot=_snapshot(scope="shared", mop_every_n=5, coverage_every_n=5),
        mode="vacuum",
    )


@pytest.mark.parametrize("borrow_shared", [False, True])
async def test_quarantine_blocks_shared_plan_and_one_off_preview(hass, borrow_shared):
    manager, _floor_value, rooms, identities = await _configured(hass)
    room = rooms[0]
    schedule = manager.repository.robot("serial")["shared_room_cadence"][room.room_id]
    schedule["accounting_unverified"] = True
    plan_id = "one-off" if borrow_shared else "home"

    with pytest.raises(ValueError, match="progress is unverified"):
        manager.cadence.resolve_cadence(
            "serial",
            plan_id,
            rooms,
            room_identities=identities,
            use_shared_schedule=borrow_shared,
        )
    editor = manager.cadence.cadence_editor_state(
        "serial",
        plan_id,
        room,
        identity=identities[room.room_id],
        use_shared_schedule=borrow_shared,
    )
    assert editor["cadence_progress"] is None
    assert editor["cadence_reasons"] == ["cadence_progress_unverified"]

    # An inactive policy does not block a plain clean on unrelated history.
    schedule["policy"]["mop_every_n"] = None
    schedule["policy"]["coverage_every_n"] = None
    _resolved, snapshots = manager.cadence.resolve_cadence(
        "serial",
        plan_id,
        rooms,
        room_identities=identities,
        use_shared_schedule=borrow_shared,
    )
    assert snapshots[room.room_id]["schedule_active"] is False


async def test_partial_overflow_reset_is_atomic_and_full_reset_recovers(
    hass, monkeypatch
):
    monkeypatch.setattr(ledger, "MAX_LEDGER_EVENTS", 2)
    manager, _floor_value, rooms, identities = await _configured(hass, count=2)
    schedules = manager.repository.robot("serial")["shared_room_cadence"]
    first, second = (schedules[room.room_id] for room in rooms)
    now = dt_util.utcnow().timestamp()
    assert _record(first, 1, now - 20)
    assert _record(second, 2, now - 20)
    assert _record(second, 3, now - 10)
    before = deepcopy(schedules)

    with pytest.raises(ValueError, match="reset mop and coverage"):
        await manager.cadence.async_reset_cadence("serial", "home", modes=["mop"])

    assert first == before[rooms[0].room_id]
    assert second["progress"] == before[rooms[1].room_id]["progress"]
    assert len(second["accounting"]["events"]) == 2
    assert second["accounting_unverified"] is True
    saved = manager.repository.store.async_save.await_args.args[0]
    assert (
        saved["robots"]["serial"]["shared_room_cadence"][rooms[1].room_id][
            "accounting_unverified"
        ]
        is True
    )

    await manager.cadence.async_reset_cadence("serial", "home")
    assert second["progress"] == {"mop": 0, "coverage": 0}
    assert "accounting_unverified" not in second
    assert _record(second, 4, now + 1)
    assert second["progress"] == {"mop": 1, "coverage": 1}
    manager.cadence.resolve_cadence("serial", "home", rooms, room_identities=identities)


@pytest.mark.parametrize("replace_identity", [False, True])
async def test_verified_rebind_replaces_quarantined_history(hass, replace_identity):
    manager, _floor_value, rooms, identities = await _configured(hass)
    room = rooms[0]
    schedule = manager.repository.robot("serial")["shared_room_cadence"][room.room_id]
    schedule["accounting_unverified"] = True
    new_identity = "f" * 64 if replace_identity else identities[room.room_id]

    await manager.catalog.async_save_plan(
        "serial",
        "home",
        manager.catalog.plan("serial", "home"),
        floor_token="a" * 64,
        room_identities={room.room_id: new_identity},
    )

    assert "accounting_unverified" not in schedule
    assert schedule["progress"] == {"mop": 0, "coverage": 0}


async def test_plans_view_holds_unverified_shared_progress_until_both_modes_reset(
    hass,
):
    runtime = _runtime()
    floor = runtime.session.floor.value
    room_id = floor.rooms[0].id
    manager = _manager(hass)
    runtime.cleaning_plans = manager
    await manager.catalog.async_save_plan(
        "synthetic-serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "shared",
                        "mop_every_n": 5,
                        "coverage_every_n": 5,
                        "periodic_coverage_setting": "heavy_duty",
                    },
                }
            ],
        },
        floor_token=plan_floor_token(floor),
        room_identities={room_id: room_cadence_identity(floor, room_id)},
    )
    schedule = manager.repository.robot("synthetic-serial")["shared_room_cadence"][
        room_id
    ]
    schedule["accounting_unverified"] = True
    view_hass = _hass(_entry(runtime))

    async def reasons():
        response = await MaticPlansView().get(_request(view_hass), "entry")
        body = json.loads(response.body)
        return (
            body["plans"][0]["rooms"][0]["cadence_reasons"],
            body["rooms"][0]["shared_cadence_reasons"],
        )

    unverified = ["cadence_progress_unverified"]
    assert await reasons() == (unverified, unverified)
    # One mode's reset leaves the whole schedule's counting unverified, so
    # Matic Map offers a single reset of both.
    await manager.cadence.async_reset_cadence(
        "synthetic-serial", "home", [room_id], modes=["mop"]
    )
    assert await reasons() == (unverified, unverified)
    await manager.cadence.async_reset_cadence(
        "synthetic-serial", "home", [room_id], modes=["mop", "coverage"]
    )
    assert await reasons() == ([], [])
