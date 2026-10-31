"""Room and custom-area rotation history, ownership and persistence."""

import asyncio
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from custom_components.matic_robot.plan_model import AreaLeg, plan_area_fingerprint
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.test_plan_entries import ROOM_MAP, SERIAL, _area, _floor, _mixed_manager


def _leg(manager, area_id="rug"):
    area = manager.catalog.areas(SERIAL)[area_id]
    return AreaLeg(
        area_id, area["name"], "vacuum", "quick", plan_area_fingerprint(area)
    )


async def _begin(manager, area, *, run_id="run", plan_id="mixed"):
    await manager.ledger.async_begin_run(
        SERIAL, plan_id, run_id, 3, trigger="user", service="run_selected_plan"
    )
    await manager.ledger.async_mark_area_started(SERIAL, plan_id, area, run_id=run_id)


async def _accept(manager, area, *, run_id="run", plan_id="mixed"):
    return await manager.ledger.async_mark_area_accepted(
        SERIAL, plan_id, area, run_id=run_id, acceptance_is_current=lambda: True
    )


async def _complete(manager, area, *, run_id="run"):
    return await manager.ledger.async_mark_area_finished(
        SERIAL, area, run_id=run_id, completed=True, completion_is_current=lambda: True
    )


def _history(manager, area_id="rug"):
    robot = manager.repository.robot(SERIAL)
    return robot["rotations"]["mixed"]["areas"][area_id], robot["area_history"][area_id]


async def test_dispatch_is_not_an_opportunity_and_completion_requires_acceptance(hass):
    manager = await _mixed_manager(hass, _floor())
    area = _leg(manager)
    await _begin(manager, area)
    assert manager.repository.robot(SERIAL)["area_history"] == {}
    assert not await _complete(manager, area)
    assert not await _accept(manager, area, run_id="stale")
    assert not await _accept(manager, area, plan_id="another")
    assert manager.repository.robot(SERIAL)["area_history"] == {}
    assert await _accept(manager, area)
    before = deepcopy(_history(manager))
    assert await _accept(manager, area)  # Recovery does not create a second attempt.
    assert _history(manager) == before
    for record in _history(manager):
        assert record["started_runs"] == 1
        assert record["last_result"] == "running"
        assert "last_completed" not in record
    assert await _complete(manager, area)
    before = deepcopy(_history(manager))
    assert not await _complete(manager, area)
    # Rejoining a previously credited area cannot increment its count either.
    await manager.ledger.async_mark_area_started(SERIAL, "mixed", area, run_id="run")
    await _accept(manager, area)
    assert await _complete(manager, area)
    assert _history(manager) == before
    for record in _history(manager):
        assert record["completed_runs"] == 1
        assert record["completion_basis"] == "owned_session_ended"
    assert manager.repository.robot(SERIAL)["rooms"] == {}
    assert manager.repository.robot(SERIAL)["plan_room_cadence"] == {"mixed": {}}
    preview = manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=_floor())
    rug = next(row for row in preview["rotation"] if row.get("area_id") == "rug")
    assert rug["last_result"] == "completed"
    assert rug["last_completion_basis"] == "owned_session_ended"


@pytest.mark.parametrize("phase", ["accept", "complete"])
async def test_failed_area_history_write_rolls_back_and_retry_counts_once(hass, phase):
    manager = await _mixed_manager(hass, _floor())
    area = _leg(manager)
    await _begin(manager, area)
    if phase == "complete":
        await _accept(manager, area)
    before = deepcopy(manager.repository.data)
    manager.repository.store.async_save.side_effect = OSError("synthetic disk failure")
    action = _accept if phase == "accept" else _complete
    with pytest.raises(OSError, match="disk failure"):
        await action(manager, area)
    assert manager.repository.data == before
    manager.repository.store.async_save.side_effect = None
    assert await action(manager, area)
    for record in _history(manager):
        assert record["started_runs"] == 1
        assert record.get("completed_runs", 0) == (1 if phase == "complete" else 0)


async def test_stop_while_waiting_for_store_lock_prevents_completion_credit(hass):
    manager = await _mixed_manager(hass, _floor())
    area = _leg(manager)
    await _begin(manager, area)
    await _accept(manager, area)
    current = True
    async with manager.repository.store_lock:
        task = asyncio.create_task(
            manager.ledger.async_mark_area_finished(
                SERIAL,
                area,
                run_id="run",
                completed=True,
                completion_is_current=lambda: current,
            )
        )
        await asyncio.sleep(0)
        current = False
    assert not await task
    await manager.ledger.async_finish_run(SERIAL, "run", "cancelled", "managed_stop", 0)
    for record in _history(manager):
        assert record["last_result"] == "ended_unverified"
        assert "last_completed" not in record


async def test_wrong_fingerprint_or_stale_run_cannot_complete_an_area(hass):
    manager = await _mixed_manager(hass, _floor())
    area = _leg(manager)
    await _begin(manager, area)
    await _accept(manager, area)
    assert not await _complete(manager, replace(area, fingerprint="a" * 64))
    assert not await _complete(manager, area, run_id="stale")
    assert await _complete(manager, area)
    await _begin(manager, area, run_id="next")
    await _accept(manager, area, run_id="next")
    assert not await _complete(manager, area)
    for record in _history(manager):
        assert record["started_runs"] == 2
        assert record["completed_runs"] == 1


async def test_removal_while_area_history_waits_cannot_recreate_robot(hass):
    manager = await _mixed_manager(hass, _floor())
    area = _leg(manager)
    await _begin(manager, area)
    await _accept(manager, area)
    manager.repository.store.async_save.reset_mock()
    async with manager.repository.store_lock:
        completion = asyncio.create_task(_complete(manager, area))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        removal = asyncio.create_task(manager.async_remove_robot(SERIAL))
        await asyncio.sleep(0)
        assert SERIAL in manager.repository.removed_robots
        assert not completion.done()
    assert not await completion
    await removal
    assert SERIAL not in manager.repository.data["robots"]
    manager.repository.store.async_save.assert_awaited_once()


async def test_deleting_area_erases_shared_and_plan_history(hass):
    manager = await _mixed_manager(hass, _floor())
    area = _leg(manager)
    await _begin(manager, area)
    await _accept(manager, area)
    await _complete(manager, area)
    await manager.ledger.async_finish_run(
        SERIAL, "run", "completed", "all_rooms_verified", 3
    )
    assert all(record["completed_runs"] == 1 for record in _history(manager))
    await manager.catalog.async_delete_area(SERIAL, area.area_id)
    robot = manager.repository.robot(SERIAL)
    assert area.area_id not in robot["area_history"]
    assert all(
        area.area_id not in rotation.get("areas", {})
        for rotation in robot["rotations"].values()
    )
    assert area.area_id not in manager.catalog.areas(SERIAL)


@pytest.mark.parametrize("recoverable", [False, True])
async def test_area_history_survives_restart_without_inventing_completion(
    hass, recoverable
):
    manager = await _mixed_manager(hass, _floor())
    area = _leg(manager)
    await _begin(manager, area)
    await _accept(manager, area)
    opportunity = _history(manager)[0]["last_opportunity"]
    if recoverable:
        await manager.ledger.async_set_recovery_checkpoint(
            SERIAL, "run", {"version": 1, "rooms": [], "phase": "accepted"}
        )
    restored = CleaningPlanManager(hass)
    restored.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=deepcopy(manager.repository.data)),
        async_save=AsyncMock(),
    )
    await restored.async_load()
    for record in _history(restored):
        assert record["last_opportunity"] == opportunity
        assert record["started_runs"] == 1
        assert "last_completed" not in record
        assert record["last_result"] == (
            "running" if recoverable else "ended_unverified"
        )
    if recoverable:
        await _accept(restored, area)
        await _complete(restored, area)
        for record in _history(restored):
            assert record["started_runs"] == record["completed_runs"] == 1
    else:
        assert not await _complete(restored, area)


async def test_geometry_change_reset_and_deletion_do_not_reuse_old_area_history(hass):
    floor = _floor()
    manager = await _mixed_manager(hass, floor)
    area = _leg(manager)
    await _begin(manager, area)
    await _accept(manager, area)
    await _complete(manager, area)
    await manager.ledger.async_finish_run(
        SERIAL, "run", "completed", "all_rooms_verified", 3
    )
    preview = manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)
    assert preview["entries"][-1]["area_id"] == "rug"
    # A rename keeps identity; a changed drawing gets no old opportunity/credit.
    renamed = {**manager.catalog.areas(SERIAL)["rug"], "name": "New name"}
    await manager.catalog.async_save_area(SERIAL, "rug", renamed)
    assert (
        manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)["entries"][
            -1
        ]["area_id"]
        == "rug"
    )
    await manager.catalog.async_save_area(SERIAL, "rug", _area(floor, x=1.5))
    preview = manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)
    rug = next(row for row in preview["rotation"] if row.get("area_id") == "rug")
    assert rug["last_opportunity"] is rug["last_completion"] is None
    area = _leg(manager)
    await _begin(manager, area, run_id="new-geometry")
    await _accept(manager, area, run_id="new-geometry")
    for record in _history(manager):
        assert record["started_runs"] == 1
        assert "completed_runs" not in record
    await manager.ledger.async_finish_run(
        SERIAL, "new-geometry", "cancelled", "managed_stop", 0
    )
    await manager.ledger.async_reset_history(SERIAL, "mixed")
    rug = next(
        row
        for row in manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)[
            "rotation"
        ]
        if row.get("area_id") == "rug"
    )
    assert rug["last_opportunity"] is rug["last_completion"] is None
    # Deleting and recreating even identical geometry cannot inherit history.
    await manager.catalog.async_delete_area(SERIAL, "rug")
    assert "rug" not in manager.repository.robot(SERIAL)["area_history"]
    await manager.catalog.async_save_area(SERIAL, "rug", _area(floor, x=1.5))
    areas = deepcopy(manager.catalog.areas(SERIAL))
    await manager.ledger.async_reset_history(SERIAL)
    assert manager.catalog.areas(SERIAL) == areas
    assert manager.repository.robot(SERIAL)["area_history"] == {}


async def test_shared_area_history_and_plan_reset_use_the_same_room_rotation_rules(
    hass,
):
    floor = _floor()
    manager = await _mixed_manager(hass, floor)
    area = _leg(manager)
    robot = manager.repository.robot(SERIAL)
    robot["rotations"]["mixed"] = {
        "rooms": {},
        "areas": {
            "rug": {
                "fingerprint": area.fingerprint,
                "last_completed": "2026-01-01T00:00:00+00:00",
            }
        },
    }
    robot["area_history"]["rug"] = {
        "fingerprint": area.fingerprint,
        "last_opportunity": "2026-01-02T00:00:00+00:00",
        "last_result": "interrupted",
    }
    preview = manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)
    rug = next(row for row in preview["rotation"] if row.get("area_id") == "rug")
    assert rug["last_opportunity_source"] == "global"
    assert rug["last_result"] == "interrupted"
    assert rug["last_completion"] == "2026-01-01T00:00:00+00:00"
    robot["area_history"]["rug"]["last_opportunity"] = "2999-01-01T00:00:00+00:00"
    preview = manager.catalog.preview(SERIAL, ROOM_MAP, "mixed", floor_plan=floor)
    rug = next(row for row in preview["rotation"] if row.get("area_id") == "rug")
    assert rug["last_opportunity_source"] == "plan"
