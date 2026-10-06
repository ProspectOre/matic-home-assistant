"""Metadata admission and worker lifecycle invariants."""

from __future__ import annotations

import asyncio
import logging
from copy import deepcopy

import pytest
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot import plans as plans_module
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    MetadataAdmissionClosedError,
)

SERIAL = "synthetic-metadata-lifecycle-robot"
AREA = {
    "schema_version": 1,
    "name": "Lifecycle area",
    "circles": [{"x": 0.1, "y": 0.2, "radius": 0.3}],
    "cleaning_mode": "vacuum",
    "coverage_setting": "optimal",
    "map_binding": {"schema_version": 1, "mission_id": 42},
}


@pytest.fixture
def hass_storage() -> dict:
    """Use isolated real Store persistence for lifecycle assertions."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Keep Store files in the isolated test configuration directory."""
    return hass_tmp_config_dir


async def test_closed_metadata_admission_rejects_area_and_plan_writes(hass) -> None:
    """Unload closure rejects user writes before they change persisted state."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager.async_close_metadata_admission_and_wait(SERIAL)

    with pytest.raises(HomeAssistantError, match="unavailable during unload"):
        await manager.async_save_area(SERIAL, "area", AREA)
    with pytest.raises(HomeAssistantError, match="unavailable during unload"):
        await manager.async_save_plan(SERIAL, "plan", {"name": "Plan"})
    await manager.async_mark_stop_pending(SERIAL, run_id="closed-stop")

    assert not manager.areas(SERIAL)
    assert not manager._robot(SERIAL)["plans"]
    assert not manager.stop_pending(SERIAL)
    assert SERIAL not in manager._metadata_admissions
    assert SERIAL not in manager._metadata_persistence_tasks
    assert not manager.state_lock(SERIAL).locked()
    assert not manager.plan_write_lock(SERIAL).locked()

    # A failed unload reopens the same manager without retaining stale state.
    manager.reopen_metadata_admission(SERIAL)
    await manager.async_mark_stop_pending(SERIAL, run_id="late-stop")
    await manager.async_save_area(SERIAL, "area", AREA)
    await manager.async_save_plan(SERIAL, "plan", {"name": "Plan"})
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.areas(SERIAL)["area"] == AREA
    assert reloaded.plan(SERIAL, "plan")["name"] == "Plan"
    assert reloaded.pending_stop_run_id(SERIAL) is None
    assert reloaded._robot(SERIAL)[plans_module.STOP_FENCE_RUN_ID] == "late-stop"


async def test_admission_closed_while_plan_waits_for_domain_lock(hass) -> None:
    """A caller queued before unload closure is rejected before mutation."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    held = manager.plan_write_lock(SERIAL)
    await held.acquire()
    waiter = asyncio.create_task(
        manager.async_save_plan(SERIAL, "queued", {"name": "Queued"})
    )
    try:
        await asyncio.sleep(0)
        assert manager._metadata_admissions.get(SERIAL) == 1
        drain = asyncio.create_task(
            manager.async_close_metadata_admission_and_wait(SERIAL)
        )
        await asyncio.sleep(0)
        assert not drain.done()
        held.release()
        with pytest.raises(HomeAssistantError, match="unavailable during unload"):
            await waiter
        await asyncio.wait_for(drain, timeout=3)
    finally:
        if held.locked():
            held.release()
        if not waiter.done():
            waiter.cancel()
            await asyncio.gather(waiter, return_exceptions=True)

    assert "queued" not in manager._robot(SERIAL)["plans"]
    assert SERIAL not in manager._metadata_admissions
    assert SERIAL not in manager._metadata_persistence_tasks
    assert not manager.state_lock(SERIAL).locked()

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert "queued" not in reloaded._robot(SERIAL)["plans"]


async def test_worker_creation_failure_releases_admission_and_all_locks(
    hass, monkeypatch
) -> None:
    """Failure to start an owned worker leaves no phantom admission or lock."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    original_create_task = asyncio.create_task

    def fail_metadata_worker(coro, *args, **kwargs):
        code = getattr(coro, "cr_code", None)
        if code is not None and code.co_qualname.endswith(
            "CleaningPlanManager._async_run_owned_metadata.<locals>.run"
        ):
            coro.close()
            raise RuntimeError("synthetic worker scheduling failure")
        return original_create_task(coro, *args, **kwargs)

    monkeypatch.setattr(plans_module.asyncio, "create_task", fail_metadata_worker)
    with pytest.raises(RuntimeError, match="worker scheduling failure"):
        await manager.async_save_plan(SERIAL, "never-written", {"name": "No"})

    assert "never-written" not in manager._robot(SERIAL)["plans"]
    assert SERIAL not in manager._metadata_admissions
    assert SERIAL not in manager._metadata_persistence_tasks
    assert not manager.state_lock(SERIAL).locked()
    assert not manager.plan_write_lock(SERIAL).locked()

    monkeypatch.setattr(plans_module.asyncio, "create_task", original_create_task)
    await manager.async_save_plan(SERIAL, "after-failure", {"name": "After"})
    assert manager.plan(SERIAL, "after-failure")["name"] == "After"


async def test_stop_worker_creation_failure_releases_registered_ownership(
    hass, monkeypatch
) -> None:
    """An accepted STOP retains its safety fence and can retry persistence."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    state_lock = manager.state_lock(SERIAL)
    await state_lock.acquire()
    original_create_task = asyncio.create_task

    def fail_metadata_worker(coro, *args, **kwargs):
        code = getattr(coro, "cr_code", None)
        if code is not None and code.co_qualname.endswith(
            "CleaningPlanManager._async_run_owned_metadata.<locals>.run"
        ):
            coro.close()
            raise RuntimeError("synthetic STOP worker scheduling failure")
        return original_create_task(coro, *args, **kwargs)

    monkeypatch.setattr(plans_module.asyncio, "create_task", fail_metadata_worker)
    try:
        with pytest.raises(RuntimeError, match="STOP worker scheduling failure"):
            await manager.async_mark_stop_pending(SERIAL, run_id="accepted-stop")
        assert manager.stop_pending(SERIAL)
        assert manager._robot(SERIAL)[plans_module.STOP_FENCE_RUN_ID] == "accepted-stop"
        assert SERIAL not in manager._metadata_admissions
        assert SERIAL not in manager._metadata_persistence_tasks
        assert state_lock.locked()
    finally:
        state_lock.release()

    monkeypatch.setattr(plans_module.asyncio, "create_task", original_create_task)
    await manager.async_mark_stop_pending(SERIAL, run_id="accepted-stop")
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded._robot(SERIAL)[plans_module.STOP_FENCE_RUN_ID] == "accepted-stop"
    assert reloaded._robot(SERIAL)[plans_module.STOP_FENCE_EXPIRES_AT]
    assert not manager._metadata_admissions.get(SERIAL)
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    assert not state_lock.locked()


async def test_stale_dock_is_noop_and_matching_dock_commits(hass, monkeypatch) -> None:
    """Stale run/token callbacks do not save or notify; a match does both."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    manager._robot(SERIAL)["last_run"] = {
        "run_id": "current-run",
        "plan_id": "plan",
        "outcome": "cancelled",
        "provenance": "user",
    }
    manager.mark_stop_pending(SERIAL, run_id="current-run")
    token = manager.stop_fence_token(SERIAL)
    assert token is not None
    before = manager.snapshot(SERIAL)
    saves = 0
    original_save = manager._store.async_save
    events: list[object] = []
    manager.async_add_listener(SERIAL, lambda: events.append("listener"))
    hass.bus.async_listen(plans_module.EVENT_PLAN_DOCKED, events.append)

    async def count_saves(data) -> None:
        nonlocal saves
        saves += 1
        await original_save(data)

    monkeypatch.setattr(manager._store, "async_save", count_saves)
    assert not await manager.async_mark_run_docked(
        SERIAL, "stale-run", stop_fence_token=token
    )
    assert not await manager.async_mark_run_docked(
        SERIAL, "current-run", stop_fence_token=token + 1
    )
    assert saves == 0
    assert events == []
    assert manager.snapshot(SERIAL) == before

    assert await manager.async_mark_run_docked(
        SERIAL, "current-run", stop_fence_token=token
    )
    assert saves == 1
    assert len(events) == 2
    assert events[0] == "listener"
    assert events[1].data["run_id"] == "current-run"
    assert manager.snapshot(SERIAL)["last_run"]["outcome"] == "stopped_docked"
    assert not manager.stop_pending(SERIAL)

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.snapshot(SERIAL)["last_run"]["outcome"] == "stopped_docked"


async def test_matching_dock_after_metadata_shutdown_cannot_commit(hass, monkeypatch):
    """Even matching late evidence cannot mutate a closed entry or notify it."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    manager._robot(SERIAL)["last_run"] = {
        "run_id": "current-run",
        "plan_id": "plan",
        "outcome": "cancelled",
        "provenance": "user",
    }
    manager.mark_stop_pending(SERIAL, run_id="current-run")
    token = manager.stop_fence_token(SERIAL)
    assert token is not None
    await manager._store.async_save(manager._data)
    before = deepcopy(manager._data)
    notifications = []
    manager.async_add_listener(SERIAL, lambda: notifications.append("changed"))

    async def unexpected_save(_data):
        pytest.fail("A late dock callback wrote after metadata shutdown")

    monkeypatch.setattr(manager._store, "async_save", unexpected_save)
    await manager.async_close_metadata_admission_and_wait(SERIAL)
    assert not await manager.async_mark_run_docked(
        SERIAL, "current-run", stop_fence_token=token
    )
    assert manager._data == before
    assert notifications == []
    assert not manager._metadata_persistence_tasks

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.snapshot(SERIAL)["last_run"]["outcome"] == "cancelled"


async def test_after_commit_callback_failure_preserves_durable_owner_result(
    hass, caplog
) -> None:
    """A failed post-commit callback cannot undo an owned durable mutation."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()

    async def commit(_lease) -> None:
        await manager._async_persist_area_metadata(
            SERIAL, lambda robot: robot["areas"].update({"committed": AREA})
        )

    def broken_callback(_result: None) -> None:
        raise RuntimeError("synthetic post-commit callback failure")

    with caplog.at_level(logging.ERROR):
        result = await manager._async_run_owned_metadata(
            SERIAL, commit, after_commit=broken_callback
        )

    assert result is None
    assert manager.areas(SERIAL)["committed"] == AREA
    assert "Metadata commit callback failed" in caplog.text
    assert "synthetic post-commit callback failure" not in caplog.text
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    assert not manager.state_lock(SERIAL).locked()

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.areas(SERIAL)["committed"] == AREA


async def test_robot_removal_wins_while_plan_waits_for_store_lock(hass) -> None:
    """A queued plan commit observes removal before it mutates shared state."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager._store_lock.acquire()
    waiter = asyncio.create_task(
        manager.async_save_plan(SERIAL, "queued", {"name": "Queued"})
    )
    removal = None
    try:
        for _ in range(20):
            await asyncio.sleep(0)
            if manager._metadata_persistence_tasks.get(SERIAL):
                break
        assert manager._metadata_persistence_tasks.get(SERIAL)
        assert manager.state_lock(SERIAL).locked()
        assert "queued" not in manager._robot(SERIAL)["plans"]

        removal = asyncio.create_task(manager.async_remove_robot(SERIAL))
        await asyncio.sleep(0)
        assert SERIAL in manager._removed_robots
        manager._store_lock.release()
        with pytest.raises(
            MetadataAdmissionClosedError, match="unavailable during unload"
        ):
            await asyncio.wait_for(waiter, timeout=3)
        await asyncio.wait_for(removal, timeout=3)
    finally:
        if manager._store_lock.locked():
            manager._store_lock.release()
        if not waiter.done():
            waiter.cancel()
            await asyncio.gather(waiter, return_exceptions=True)
        if removal is not None and not removal.done():
            await asyncio.gather(removal, return_exceptions=True)

    assert SERIAL not in manager._data["robots"]
    assert not manager._metadata_admissions.get(SERIAL)
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert SERIAL not in reloaded._data["robots"]


@pytest.mark.parametrize("operation", ("delete", "select", "history", "cadence"))
async def test_plan_mutation_waiting_for_store_rejects_after_removal(
    hass, monkeypatch, operation: str
) -> None:
    """Plan edits admitted before removal fail closed at the Store boundary."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager.async_save_plan(
        SERIAL, "plan", {"name": "Plan", "rooms": []}, select=False
    )
    await manager.async_save_plan(
        SERIAL, "other", {"name": "Other", "rooms": []}, select=True
    )
    before_plans = deepcopy(manager._robot(SERIAL)["plans"])
    before_selection = manager._robot(SERIAL)["selected_plan"]

    calls = {
        "delete": lambda: manager.async_delete_plan(SERIAL, "plan"),
        "select": lambda: manager.async_select_plan(SERIAL, "plan"),
        "history": lambda: manager.async_reset_history(SERIAL, "plan"),
        "cadence": lambda: manager.async_reset_cadence(SERIAL, "plan", []),
    }
    writes = 0
    original_save = manager._store.async_save

    async def count_saves(data) -> None:
        nonlocal writes
        writes += 1
        await original_save(data)

    monkeypatch.setattr(manager._store, "async_save", count_saves)
    await manager._store_lock.acquire()
    waiter = asyncio.create_task(calls[operation]())
    removal = None
    try:
        for _ in range(20):
            await asyncio.sleep(0)
            if manager._metadata_persistence_tasks.get(SERIAL):
                break
        assert manager._metadata_persistence_tasks.get(SERIAL)
        assert manager._robot(SERIAL)["plans"] == before_plans

        removal = asyncio.create_task(manager.async_remove_robot(SERIAL))
        await asyncio.sleep(0)
        assert SERIAL in manager._removed_robots
        assert manager._robot(SERIAL)["plans"] == before_plans
        assert manager._robot(SERIAL)["selected_plan"] == before_selection
        manager._store_lock.release()
        with pytest.raises(
            MetadataAdmissionClosedError, match="unavailable during unload"
        ):
            await asyncio.wait_for(waiter, timeout=3)
        await asyncio.wait_for(removal, timeout=3)
    finally:
        if manager._store_lock.locked():
            manager._store_lock.release()
        if not waiter.done():
            waiter.cancel()
            await asyncio.gather(waiter, return_exceptions=True)
        if removal is not None and not removal.done():
            await asyncio.gather(removal, return_exceptions=True)

    assert writes == 1  # Only robot deletion reaches Store.
    assert SERIAL not in manager._data["robots"]
    assert not manager._metadata_admissions.get(SERIAL)
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert SERIAL not in reloaded._data["robots"]


async def test_remove_robot_is_idempotent_when_robot_was_already_absent(
    hass, monkeypatch
) -> None:
    """Repeated unload cleanup of an absent robot is a durable no-op."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    writes = 0
    original_save = manager._store.async_save

    async def count_saves(data) -> None:
        nonlocal writes
        writes += 1
        await original_save(data)

    monkeypatch.setattr(manager._store, "async_save", count_saves)
    await manager.async_remove_robot(SERIAL)
    await manager.async_remove_robot(SERIAL)

    assert SERIAL not in manager._data["robots"]
    assert SERIAL in manager._removed_robots
    assert writes == 0
    assert not manager._metadata_admissions.get(SERIAL)
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    assert not manager.state_lock(SERIAL).locked()
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert SERIAL not in reloaded._data["robots"]


async def test_closed_mixed_stop_calls_preserve_checkpoint_and_fence(hass) -> None:
    """Unload-time STOP prepare and rollback leave their state untouched."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    prepare_serial = f"{SERIAL}-prepare"
    rollback_serial = f"{SERIAL}-rollback"
    session_hash = "a" * 64
    manager._robot(prepare_serial)["last_run"] = {
        "run_id": "prepare-run",
        "outcome": "running",
        "recovery_checkpoint": {
            "phase": "dispatching",
            "mixed_initial_session_hash": session_hash,
            "stop_intent": None,
        },
    }
    manager._robot(rollback_serial)["last_run"] = {
        "run_id": "rollback-run",
        "outcome": "running",
        "recovery_checkpoint": {
            "phase": "dispatching",
            "mixed_initial_session_hash": session_hash,
            "stop_intent": "immediate",
        },
    }
    manager.mark_stop_pending(rollback_serial, run_id="rollback-run")
    before_prepare = deepcopy(manager._robot(prepare_serial))
    before_rollback = deepcopy(manager._robot(rollback_serial))
    rollback_fence_token = manager.stop_fence_token(rollback_serial)
    assert rollback_fence_token is not None
    await manager.async_close_metadata_admission_and_wait(prepare_serial)
    await manager.async_close_metadata_admission_and_wait(rollback_serial)

    await manager.async_prepare_mixed_dispatch_stop(
        prepare_serial, "prepare-run", session_hash
    )
    await manager.async_rollback_mixed_dispatch_stop(
        rollback_serial, "rollback-run", session_hash
    )

    assert manager._robot(prepare_serial) == before_prepare
    assert manager._robot(rollback_serial) == before_rollback
    assert manager.stop_fence_token(rollback_serial) == rollback_fence_token
    assert not manager._metadata_admissions
    assert not manager._metadata_persistence_tasks


async def test_removal_skips_accepted_stop_waiting_for_store_lock(hass, monkeypatch):
    """A STOP accepted before removal cannot persist after removal starts."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager.async_save_area(SERIAL, "kept-until-removal", AREA)
    notifications: list[str] = []
    manager.async_add_listener(SERIAL, lambda: notifications.append("changed"))
    writes = 0
    original_save = manager._store.async_save

    async def count_saves(data) -> None:
        nonlocal writes
        writes += 1
        await original_save(data)

    monkeypatch.setattr(manager._store, "async_save", count_saves)
    await manager._store_lock.acquire()
    stop = asyncio.create_task(
        manager.async_mark_stop_pending(SERIAL, run_id="accepted-stop")
    )
    removal = None
    try:
        for _ in range(20):
            await asyncio.sleep(0)
            if manager._metadata_persistence_tasks.get(SERIAL):
                break
        assert manager._metadata_persistence_tasks.get(SERIAL)
        assert manager.stop_pending(SERIAL)
        removal = asyncio.create_task(manager.async_remove_robot(SERIAL))
        await asyncio.sleep(0)
        assert SERIAL in manager._removed_robots
        manager._store_lock.release()
        await asyncio.wait_for(stop, timeout=3)
        await asyncio.wait_for(removal, timeout=3)
    finally:
        if manager._store_lock.locked():
            manager._store_lock.release()
        if not stop.done():
            stop.cancel()
            await asyncio.gather(stop, return_exceptions=True)
        if removal is not None and not removal.done():
            await asyncio.gather(removal, return_exceptions=True)

    assert writes == 1  # Only robot deletion reaches Store.
    assert notifications == []
    assert SERIAL not in manager._data["robots"]
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert SERIAL not in reloaded._data["robots"]


async def test_removal_skips_queued_dock_mutation_and_callback(hass, monkeypatch):
    """A queued sticky dock result cannot mutate or emit after removal starts."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    manager._robot(SERIAL)["last_run"] = {
        "run_id": "cancelled-run",
        "plan_id": "plan",
        "outcome": "cancelled",
        "provenance": "user",
    }
    manager.mark_stop_pending(SERIAL, run_id="cancelled-run")
    token = manager.stop_fence_token(SERIAL)
    assert token is not None
    await manager._async_save_and_notify(SERIAL)
    before_run = deepcopy(manager._robot(SERIAL)["last_run"])
    events: list[object] = []
    manager.async_add_listener(SERIAL, lambda: events.append("listener"))
    hass.bus.async_listen(plans_module.EVENT_PLAN_DOCKED, events.append)
    writes = 0
    original_save = manager._store.async_save

    async def count_saves(data) -> None:
        nonlocal writes
        writes += 1
        await original_save(data)

    monkeypatch.setattr(manager._store, "async_save", count_saves)
    await manager._store_lock.acquire()
    dock = asyncio.create_task(
        manager.async_mark_run_docked(SERIAL, "cancelled-run", stop_fence_token=token)
    )
    removal = None
    try:
        for _ in range(20):
            await asyncio.sleep(0)
            if manager._metadata_persistence_tasks.get(SERIAL):
                break
        assert manager._metadata_persistence_tasks.get(SERIAL)
        removal = asyncio.create_task(manager.async_remove_robot(SERIAL))
        await asyncio.sleep(0)
        assert SERIAL in manager._removed_robots
        assert manager._robot(SERIAL)["last_run"] == before_run
        manager._store_lock.release()
        assert not await asyncio.wait_for(dock, timeout=3)
        await asyncio.wait_for(removal, timeout=3)
    finally:
        if manager._store_lock.locked():
            manager._store_lock.release()
        if not dock.done():
            dock.cancel()
            await asyncio.gather(dock, return_exceptions=True)
        if removal is not None and not removal.done():
            await asyncio.gather(removal, return_exceptions=True)

    assert writes == 1  # Only robot deletion reaches Store.
    assert events == []
    assert SERIAL not in manager._data["robots"]
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert SERIAL not in reloaded._data["robots"]


async def test_removal_skips_area_mutation_waiting_for_store_lock(hass, monkeypatch):
    """An admitted Area edit waiting on Store is discarded after removal."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager.async_save_area(SERIAL, "existing", AREA)
    notifications: list[str] = []
    manager.async_add_listener(SERIAL, lambda: notifications.append("changed"))
    writes = 0
    original_save = manager._store.async_save

    async def count_saves(data) -> None:
        nonlocal writes
        writes += 1
        await original_save(data)

    monkeypatch.setattr(manager._store, "async_save", count_saves)
    await manager._store_lock.acquire()
    edit = asyncio.create_task(manager.async_save_area(SERIAL, "new", AREA))
    removal = None
    try:
        for _ in range(20):
            await asyncio.sleep(0)
            if manager._metadata_persistence_tasks.get(SERIAL):
                break
        assert manager._metadata_persistence_tasks.get(SERIAL)
        assert "new" not in manager.areas(SERIAL)
        removal = asyncio.create_task(manager.async_remove_robot(SERIAL))
        await asyncio.sleep(0)
        assert SERIAL in manager._removed_robots
        manager._store_lock.release()
        with pytest.raises(
            MetadataAdmissionClosedError, match="unavailable during unload"
        ):
            await asyncio.wait_for(edit, timeout=3)
        await asyncio.wait_for(removal, timeout=3)
    finally:
        if manager._store_lock.locked():
            manager._store_lock.release()
        if not edit.done():
            edit.cancel()
            await asyncio.gather(edit, return_exceptions=True)
        if removal is not None and not removal.done():
            await asyncio.gather(removal, return_exceptions=True)

    assert writes == 1  # Only robot deletion reaches Store.
    assert notifications == []
    assert SERIAL not in manager._data["robots"]
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert SERIAL not in reloaded._data["robots"]


@pytest.mark.parametrize("worker_before_lock_wait", (False, True))
async def test_admitted_operation_closed_before_mutation_returns_none(
    hass, monkeypatch, worker_before_lock_wait: bool
) -> None:
    """Both real admission interleavings close before the mutation runs."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    held = manager.plan_write_lock(SERIAL)
    await held.acquire()
    invoked = False

    async def operation(_lease):
        nonlocal invoked
        invoked = True
        return True

    original_create_task = asyncio.create_task

    def close_before_worker_starts(coro, *args, **kwargs):
        code = getattr(coro, "cr_code", None)
        if (
            worker_before_lock_wait
            and code is not None
            and code.co_qualname.endswith(
                "CleaningPlanManager._async_run_owned_metadata.<locals>.run"
            )
        ):
            manager._metadata_admission_closed.add(SERIAL)
        return original_create_task(coro, *args, **kwargs)

    if worker_before_lock_wait:
        monkeypatch.setattr(
            plans_module.asyncio, "create_task", close_before_worker_starts
        )
    task = asyncio.create_task(
        manager._async_run_owned_metadata(
            SERIAL,
            operation,
            domain_locks=(held,),
            register_before_lock_wait=worker_before_lock_wait,
        )
    )
    try:
        for _ in range(20):
            await asyncio.sleep(0)
            admitted = (
                manager._metadata_persistence_tasks.get(SERIAL)
                if worker_before_lock_wait
                else manager._metadata_admissions.get(SERIAL)
            )
            if admitted:
                break
        if worker_before_lock_wait:
            assert manager._metadata_persistence_tasks.get(SERIAL)
        else:
            assert manager._metadata_admissions.get(SERIAL) == 1
        assert not invoked
        drain = asyncio.create_task(
            manager.async_close_metadata_admission_and_wait(SERIAL)
        )
        await asyncio.sleep(0)
        if not worker_before_lock_wait:
            assert not drain.done()
        # In the worker case the admission closed synchronously in the
        # create_task seam, before the queued worker can enter its mutation.
        held.release()
        assert await asyncio.wait_for(task, timeout=3) is None
        await asyncio.wait_for(drain, timeout=3)
    finally:
        if held.locked():
            held.release()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    assert not invoked
    assert SERIAL not in manager._metadata_admissions
    assert SERIAL not in manager._metadata_persistence_tasks
    assert not manager.state_lock(SERIAL).locked()
