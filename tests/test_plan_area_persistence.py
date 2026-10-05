"""Area metadata commits stay durable across request cancellation."""

from __future__ import annotations

import asyncio
import json
import threading

import pytest
from homeassistant.core import CoreState
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util.file import WriteError

from custom_components.matic_robot import plans as plans_module
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    MetadataAdmissionClosedError,
)

SERIAL = "synthetic-robot"
EXISTING_AREA = {
    "schema_version": 1,
    "name": "Existing",
    "circles": [{"x": 0.1, "y": 0.2, "radius": 0.3}],
    "cleaning_mode": "vacuum",
    "coverage_setting": "optimal",
    "map_binding": {"schema_version": 1, "mission_id": 42},
}
OTHER_AREA = {**EXISTING_AREA, "name": "Other"}
UPDATED_AREA = {
    **EXISTING_AREA,
    "name": "Updated",
    "circles": [{"x": 0.4, "y": 0.5, "radius": 0.2}],
}
CREATED_AREA = {**EXISTING_AREA, "name": "Created"}


@pytest.fixture
def hass_storage():
    """Avoid pytest-homeassistant's in-memory Store mock for these tests."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir):
    """Use pytest's isolated config directory with real Store I/O."""
    return hass_tmp_config_dir


async def _manager_with_areas(hass) -> CleaningPlanManager:
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    await manager.async_save_area(SERIAL, "existing", EXISTING_AREA)
    await manager.async_save_area(SERIAL, "other", OTHER_AREA)
    await manager.async_select_area(SERIAL, "existing")
    return manager


@pytest.mark.parametrize("operation", ("create", "update", "delete", "select"))
async def test_cancelled_area_waiter_keeps_durable_commit_and_notifies(
    hass, monkeypatch, operation
):
    """Once an Area mutation is accepted, its owned Store write settles."""
    manager = await _manager_with_areas(hass)
    assert hass.state is CoreState.running
    assert not manager._store._read_only
    notifications = 0

    def notified() -> None:
        nonlocal notifications
        notifications += 1

    manager.async_add_listener(SERIAL, notified)
    loop = asyncio.get_running_loop()
    write_started = asyncio.Event()
    release_write = threading.Event()
    write_finished = asyncio.Event()
    original_write = Store._write_prepared_data

    def pause_real_store_write(store, mode: str, payload: str | bytes) -> None:
        if store is manager._store:
            loop.call_soon_threadsafe(write_started.set)
            if not release_write.wait(timeout=30):
                raise TimeoutError("test did not release the real Store write")
            try:
                original_write(store, mode, payload)
            finally:
                loop.call_soon_threadsafe(write_finished.set)
        else:
            original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", pause_real_store_write)
    if operation == "create":
        mutation = manager.async_save_area(SERIAL, "created", CREATED_AREA)
    elif operation == "update":
        mutation = manager.async_save_area(SERIAL, "existing", UPDATED_AREA)
    elif operation == "delete":
        mutation = manager.async_delete_area(SERIAL, "existing")
    else:
        mutation = manager.async_select_area(SERIAL, "other")
    waiter = asyncio.create_task(mutation)

    try:
        await asyncio.wait_for(write_started.wait(), timeout=3)
        assert not waiter.done()
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
    finally:
        release_write.set()
        if write_started.is_set():
            await asyncio.wait_for(write_finished.wait(), timeout=3)
        await manager._async_wait_metadata_persistence(SERIAL)

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    expected_areas = {"existing": EXISTING_AREA, "other": OTHER_AREA}
    expected_selected = "existing"
    if operation == "create":
        expected_areas["created"] = CREATED_AREA
        expected_selected = "created"
    elif operation == "update":
        expected_areas["existing"] = UPDATED_AREA
    elif operation == "delete":
        expected_areas.pop("existing")
        expected_selected = "other"
    elif operation == "select":
        expected_selected = "other"

    assert manager.areas(SERIAL) == expected_areas
    assert manager.snapshot(SERIAL)["selected_area"] == expected_selected
    assert reloaded.areas(SERIAL) == expected_areas
    assert reloaded.snapshot(SERIAL)["selected_area"] == expected_selected
    assert notifications == 1


async def test_cancel_before_state_lock_does_not_accept_area_mutation(hass):
    """Cancellation before mutation admission leaves memory and disk unchanged."""
    manager = await _manager_with_areas(hass)
    before = manager.areas(SERIAL)
    before_selected = manager.snapshot(SERIAL)["selected_area"]
    notifications = 0

    def notified() -> None:
        nonlocal notifications
        notifications += 1

    manager.async_add_listener(SERIAL, notified)
    lock = manager.state_lock(SERIAL)
    await lock.acquire()
    try:
        waiter = asyncio.create_task(
            manager.async_save_area(SERIAL, "created", CREATED_AREA)
        )
        await asyncio.sleep(0)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
    finally:
        lock.release()

    assert manager.areas(SERIAL) == before
    assert manager.snapshot(SERIAL)["selected_area"] == before_selected
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.areas(SERIAL) == before
    assert notifications == 0


async def test_failed_store_commit_rolls_back_area_and_suppresses_notification(
    hass, monkeypatch
):
    """A real Store write rejection restores memory and leaves disk unchanged."""
    manager = await _manager_with_areas(hass)
    before = manager.areas(SERIAL)
    before_selected = manager.snapshot(SERIAL)["selected_area"]
    notifications = 0

    def notified() -> None:
        nonlocal notifications
        notifications += 1

    manager.async_add_listener(SERIAL, notified)
    loop = asyncio.get_running_loop()
    write_started = asyncio.Event()
    release_write = threading.Event()
    original_write = Store._write_prepared_data

    def reject_store_write(store, mode: str, payload: str | bytes) -> None:
        if store is manager._store:
            loop.call_soon_threadsafe(write_started.set)
            if not release_write.wait(timeout=30):
                raise TimeoutError("test did not release the failing Store write")
            raise WriteError("synthetic storage failure detail")
        original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", reject_store_write)
    mutation = asyncio.create_task(
        manager.async_save_area(SERIAL, "existing", UPDATED_AREA)
    )
    try:
        await asyncio.wait_for(write_started.wait(), timeout=3)
        robot = manager._data["robots"][SERIAL]
        robot["plans"]["concurrent-write"] = {"name": "Concurrent"}
        robot["rooms"]["concurrent-write"] = {"name": "Concurrent"}
        release_write.set()
        with pytest.raises(
            HomeAssistantError, match="Cleaning plan state could not be saved"
        ) as err:
            await mutation
    finally:
        release_write.set()
        await asyncio.gather(mutation, return_exceptions=True)

    assert str(err.value) == "Cleaning plan state could not be saved"
    assert manager.areas(SERIAL) == before
    assert manager.snapshot(SERIAL)["selected_area"] == before_selected
    assert manager._data["robots"][SERIAL]["plans"]["concurrent-write"] == {
        "name": "Concurrent"
    }
    assert manager._data["robots"][SERIAL]["rooms"]["concurrent-write"] == {
        "name": "Concurrent"
    }
    assert notifications == 0
    assert not manager.state_lock(SERIAL).locked()
    assert not manager._metadata_persistence_tasks.get(SERIAL)

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.areas(SERIAL) == before
    assert reloaded.snapshot(SERIAL)["selected_area"] == before_selected


@pytest.mark.parametrize("lifecycle", ("unload", "remove"))
async def test_failed_accepted_area_write_does_not_abort_lifecycle_drain(
    hass, monkeypatch, lifecycle
):
    """A failed owned write rolls back, but does not strand lifecycle cleanup."""
    manager = await _manager_with_areas(hass)
    before = manager.areas(SERIAL)
    before_selected = manager.snapshot(SERIAL)["selected_area"]
    loop = asyncio.get_running_loop()
    write_started = asyncio.Event()
    release_write = threading.Event()
    original_write = Store._write_prepared_data
    write_count = 0

    def fail_first_store_write(store, mode: str, payload: str | bytes) -> None:
        nonlocal write_count
        if store is manager._store:
            write_count += 1
            if write_count == 1:
                loop.call_soon_threadsafe(write_started.set)
                if not release_write.wait(timeout=30):
                    raise TimeoutError("test did not release the failing Store write")
                raise WriteError("synthetic storage failure detail")
        original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", fail_first_store_write)
    mutation = asyncio.create_task(
        manager.async_save_area(SERIAL, "existing", UPDATED_AREA)
    )
    lifecycle_task = None
    try:
        await asyncio.wait_for(write_started.wait(), timeout=3)
        if lifecycle == "unload":
            lifecycle_task = asyncio.create_task(manager.async_cancel_and_wait(SERIAL))
        else:
            lifecycle_task = asyncio.create_task(manager.async_remove_robot(SERIAL))
        await asyncio.sleep(0)
        assert not lifecycle_task.done()
    finally:
        release_write.set()

    mutation_result, lifecycle_result = await asyncio.gather(
        mutation, lifecycle_task, return_exceptions=True
    )
    assert isinstance(mutation_result, HomeAssistantError)
    assert str(mutation_result) == "Cleaning plan state could not be saved"
    assert lifecycle_result is None
    assert not manager.state_lock(SERIAL).locked()
    assert not manager._metadata_persistence_tasks.get(SERIAL)

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    if lifecycle == "remove":
        assert SERIAL not in reloaded._data["robots"]
        assert write_count == 2  # failed area write, then successful removal write
    else:
        assert reloaded.areas(SERIAL) == before
        assert reloaded.snapshot(SERIAL)["selected_area"] == before_selected


@pytest.mark.parametrize("concurrent_update", (False, True))
async def test_failed_fresh_robot_commit_removes_only_empty_record(
    hass, monkeypatch, concurrent_update
):
    """Failed Area creation removes defaults but preserves concurrent metadata."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    assert SERIAL not in manager._data["robots"]
    notifications = 0

    def notified() -> None:
        nonlocal notifications
        notifications += 1

    manager.async_add_listener(SERIAL, notified)
    loop = asyncio.get_running_loop()
    write_started = asyncio.Event()
    release_write = threading.Event()
    original_write = Store._write_prepared_data

    def reject_store_write(store, mode: str, payload: str | bytes) -> None:
        if store is manager._store:
            loop.call_soon_threadsafe(write_started.set)
            if not release_write.wait(timeout=30):
                raise TimeoutError("test did not release the failing Store write")
            raise WriteError("synthetic storage failure detail")
        original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", reject_store_write)
    mutation = asyncio.create_task(
        manager.async_save_area(SERIAL, "created", CREATED_AREA)
    )
    try:
        await asyncio.wait_for(write_started.wait(), timeout=3)
        if concurrent_update:
            robot = manager._data["robots"][SERIAL]
            robot["plans"]["concurrent-write"] = {"name": "Concurrent"}
            robot["rooms"]["concurrent-write"] = {"name": "Concurrent"}
        release_write.set()
        with pytest.raises(
            HomeAssistantError, match="Cleaning plan state could not be saved"
        ):
            await mutation
    finally:
        release_write.set()
        await asyncio.gather(mutation, return_exceptions=True)

    if concurrent_update:
        robot = manager._data["robots"][SERIAL]
        assert robot["areas"] == {}
        assert robot["plans"]["concurrent-write"] == {"name": "Concurrent"}
        assert robot["rooms"]["concurrent-write"] == {"name": "Concurrent"}
    else:
        assert SERIAL not in manager._data["robots"]
    assert notifications == 0
    assert not manager.state_lock(SERIAL).locked()

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert SERIAL not in reloaded._data["robots"]


async def test_removed_robot_rejects_area_mutation(hass):
    """A robot already being removed does not accept new Area mutations."""
    manager = await _manager_with_areas(hass)
    before = manager.areas(SERIAL)
    selected = manager.snapshot(SERIAL)["selected_area"]
    manager._removed_robots.add(SERIAL)
    notifications = 0

    def notified() -> None:
        nonlocal notifications
        notifications += 1

    manager.async_add_listener(SERIAL, notified)
    with pytest.raises(MetadataAdmissionClosedError):
        await manager.async_save_area(SERIAL, "created", CREATED_AREA)

    assert manager.areas(SERIAL) == before
    assert manager.snapshot(SERIAL)["selected_area"] == selected
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    assert not manager.state_lock(SERIAL).locked()
    assert notifications == 0


async def test_missing_area_selection_restores_fresh_robot(hass):
    """A rejected select does not leave a newly created robot record behind."""
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    assert SERIAL not in manager._data["robots"]

    with pytest.raises(KeyError, match="missing-area"):
        await manager.async_select_area(SERIAL, "missing-area")

    assert SERIAL not in manager._data["robots"]
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    assert not manager.state_lock(SERIAL).locked()
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert SERIAL not in reloaded._data["robots"]


async def test_area_task_creation_failure_closes_worker_and_restores_state(
    hass, monkeypatch
):
    """Failure before task ownership leaves Area state unchanged."""
    manager = await _manager_with_areas(hass)
    before = manager.areas(SERIAL)
    selected = manager.snapshot(SERIAL)["selected_area"]
    original_create_task = asyncio.create_task

    def reject_area_worker(coroutine, *args, **kwargs):
        if getattr(coroutine, "cr_code", None) and coroutine.cr_code.co_name == "run":
            raise RuntimeError("synthetic task creation failure")
        return original_create_task(coroutine, *args, **kwargs)

    monkeypatch.setattr(plans_module.asyncio, "create_task", reject_area_worker)
    with pytest.raises(RuntimeError, match="synthetic task creation failure"):
        await manager.async_save_area(SERIAL, "existing", UPDATED_AREA)

    assert manager.areas(SERIAL) == before
    assert manager.snapshot(SERIAL)["selected_area"] == selected
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    assert not manager.state_lock(SERIAL).locked()
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.areas(SERIAL) == before
    assert reloaded.snapshot(SERIAL)["selected_area"] == selected


async def test_area_worker_cancelled_before_start_releases_state_lock(
    hass, monkeypatch
):
    """Pre-start owner cancellation changes no Area data and releases its fence."""
    manager = await _manager_with_areas(hass)
    before = manager.areas(SERIAL)
    selected = manager.snapshot(SERIAL)["selected_area"]
    original_create_task = asyncio.create_task

    def cancel_area_worker(coroutine, *args, **kwargs):
        if getattr(coroutine, "cr_code", None) and coroutine.cr_code.co_name == "run":
            task = original_create_task(coroutine, *args, **kwargs)
            task.cancel()
            return task
        return original_create_task(coroutine, *args, **kwargs)

    monkeypatch.setattr(plans_module.asyncio, "create_task", cancel_area_worker)
    with pytest.raises(asyncio.CancelledError):
        await manager.async_save_area(SERIAL, "existing", UPDATED_AREA)
    await asyncio.sleep(0)

    assert manager.areas(SERIAL) == before
    assert manager.snapshot(SERIAL)["selected_area"] == selected
    assert not manager.state_lock(SERIAL).locked()
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.areas(SERIAL) == before
    assert reloaded.snapshot(SERIAL)["selected_area"] == selected


async def test_area_commit_serializes_concurrent_mutation(hass, monkeypatch):
    """A later mutation cannot overtake the write holding the state fence."""
    manager = await _manager_with_areas(hass)
    notifications = 0

    def notified() -> None:
        nonlocal notifications
        notifications += 1

    manager.async_add_listener(SERIAL, notified)
    loop = asyncio.get_running_loop()
    write_started = asyncio.Event()
    release_write = threading.Event()
    write_finished = asyncio.Event()
    original_write = Store._write_prepared_data
    paused = False

    def pause_first_write(store, mode: str, payload: str | bytes) -> None:
        nonlocal paused
        if store is manager._store and not paused:
            paused = True
            loop.call_soon_threadsafe(write_started.set)
            if not release_write.wait(timeout=30):
                raise TimeoutError("test did not release the real Store write")
            try:
                original_write(store, mode, payload)
            finally:
                loop.call_soon_threadsafe(write_finished.set)
        else:
            original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", pause_first_write)
    first = asyncio.create_task(
        manager.async_save_area(SERIAL, "existing", UPDATED_AREA)
    )
    await asyncio.wait_for(write_started.wait(), timeout=3)
    second = asyncio.create_task(
        manager.async_save_area(SERIAL, "existing", CREATED_AREA)
    )
    await asyncio.sleep(0)
    assert not second.done()
    release_write.set()
    await first
    await second
    await asyncio.wait_for(write_finished.wait(), timeout=3)

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.areas(SERIAL)["existing"] == CREATED_AREA
    assert notifications == 2


@pytest.mark.parametrize("first_writer", ("other", "area"))
async def test_area_failure_cannot_leak_into_queued_other_robot_write(
    hass, monkeypatch, first_writer
):
    """A failed Area save cannot leak across either shared-lock ordering."""
    manager = await _manager_with_areas(hass)
    other_serial = "synthetic-other-robot"
    area_worker_waiting = asyncio.Event()
    original_area_worker = manager._async_persist_area_metadata

    async def observe_area_worker(serial_number, mutate) -> None:
        area_worker_waiting.set()
        await original_area_worker(serial_number, mutate)

    monkeypatch.setattr(manager, "_async_persist_area_metadata", observe_area_worker)
    await manager._store_lock.acquire()
    test_holds_store_lock = True
    other_write = None
    area_write = None
    if first_writer == "other":
        other_write = asyncio.create_task(
            manager.async_save_plan(other_serial, "prior-plan", {"name": "Prior"})
        )
        for _ in range(3):
            await asyncio.sleep(0)
        assert manager.state_lock(other_serial).locked()

    loop = asyncio.get_running_loop()
    first_write_started = asyncio.Event()
    release_first_write = threading.Event()
    first_write_finished = asyncio.Event()
    failed_area_write_started = asyncio.Event()
    original_write = Store._write_prepared_data
    write_count = 0
    payload_areas: list[dict] = []

    def serialize_then_fail_area_write(store, mode: str, payload: str | bytes) -> None:
        nonlocal write_count
        if store is manager._store:
            write_count += 1
            if write_count <= 2:
                envelope = json.loads(payload)
                payload_areas.append(
                    envelope["data"]["robots"][SERIAL]["areas"]["existing"]
                )
            if write_count == 1 and first_writer == "other":
                loop.call_soon_threadsafe(first_write_started.set)
                if not release_first_write.wait(timeout=30):
                    raise TimeoutError("test did not release the prior Store write")
                try:
                    original_write(store, mode, payload)
                finally:
                    loop.call_soon_threadsafe(first_write_finished.set)
                return
            if (write_count == 2 and first_writer == "other") or (
                write_count == 1 and first_writer == "area"
            ):
                loop.call_soon_threadsafe(failed_area_write_started.set)
                raise WriteError("synthetic area storage failure")
        original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", serialize_then_fail_area_write)
    if first_writer == "area":
        area_write = asyncio.create_task(
            manager.async_save_area(SERIAL, "existing", UPDATED_AREA)
        )
        await asyncio.wait_for(area_worker_waiting.wait(), timeout=3)
        other_write = asyncio.create_task(
            manager.async_save_plan(other_serial, "prior-plan", {"name": "Prior"})
        )
        for _ in range(3):
            await asyncio.sleep(0)
        assert manager.state_lock(other_serial).locked()
    else:
        area_write = asyncio.create_task(
            manager.async_save_area(SERIAL, "existing", UPDATED_AREA)
        )
        await asyncio.wait_for(area_worker_waiting.wait(), timeout=3)

    try:
        assert area_write is not None
        assert other_write is not None
        assert not other_write.done()
        if first_writer == "other":
            await asyncio.sleep(0)
            assert manager.areas(SERIAL)["existing"] == EXISTING_AREA
        assert not other_write.done()
        manager._store_lock.release()
        test_holds_store_lock = False
        if first_writer == "other":
            await asyncio.wait_for(first_write_started.wait(), timeout=3)
            assert payload_areas[0] == EXISTING_AREA
            release_first_write.set()
            await asyncio.wait_for(first_write_finished.wait(), timeout=3)
        await asyncio.wait_for(failed_area_write_started.wait(), timeout=3)
    finally:
        release_first_write.set()
        if test_holds_store_lock:
            manager._store_lock.release()
        other_result, area_result = await asyncio.gather(
            other_write, area_write, return_exceptions=True
        )

    assert other_result is None
    assert isinstance(area_result, HomeAssistantError)
    assert str(area_result) == "Cleaning plan state could not be saved"
    assert manager.areas(SERIAL)["existing"] == EXISTING_AREA
    assert (
        manager._data["robots"][other_serial]["plans"]["prior-plan"]["name"] == "Prior"
    )

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.areas(SERIAL)["existing"] == EXISTING_AREA
    assert (
        reloaded._data["robots"][other_serial]["plans"]["prior-plan"]["name"] == "Prior"
    )
    assert payload_areas[0] == (
        EXISTING_AREA if first_writer == "other" else UPDATED_AREA
    )
    if first_writer == "area":
        assert payload_areas[1] == EXISTING_AREA


async def test_unload_waits_for_accepted_area_commit(hass, monkeypatch):
    """Lifecycle drain waits for accepted writes before unloading proceeds."""
    manager = await _manager_with_areas(hass)
    notifications = 0

    def notified() -> None:
        nonlocal notifications
        notifications += 1

    manager.async_add_listener(SERIAL, notified)
    loop = asyncio.get_running_loop()
    write_started = asyncio.Event()
    release_write = threading.Event()
    write_finished = asyncio.Event()
    original_write = Store._write_prepared_data

    def pause_real_store_write(store, mode: str, payload: str | bytes) -> None:
        if store is manager._store:
            loop.call_soon_threadsafe(write_started.set)
            if not release_write.wait(timeout=30):
                raise TimeoutError("test did not release the real Store write")
            try:
                original_write(store, mode, payload)
            finally:
                loop.call_soon_threadsafe(write_finished.set)
        else:
            original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", pause_real_store_write)
    waiter = asyncio.create_task(
        manager.async_save_area(SERIAL, "existing", UPDATED_AREA)
    )

    await asyncio.wait_for(write_started.wait(), timeout=3)
    drain = asyncio.create_task(manager.async_close_metadata_admission_and_wait(SERIAL))
    await asyncio.sleep(0)
    assert not drain.done()
    drain.cancel()
    with pytest.raises(asyncio.CancelledError):
        await drain
    assert not waiter.done()
    release_write.set()
    await waiter
    await manager.async_close_metadata_admission_and_wait(SERIAL)
    await asyncio.wait_for(write_finished.wait(), timeout=3)
    assert notifications == 1
    assert not manager._metadata_persistence_tasks.get(SERIAL)


async def test_unload_drain_waits_for_pre_admitted_state_waiter(hass, monkeypatch):
    """Unload closes admission and drains callers queued before worker creation."""
    manager = await _manager_with_areas(hass)
    loop = asyncio.get_running_loop()
    write_started = asyncio.Event()
    release_write = threading.Event()
    original_write = Store._write_prepared_data

    def pause_real_store_write(store, mode: str, payload: str | bytes) -> None:
        if store is manager._store:
            loop.call_soon_threadsafe(write_started.set)
            if not release_write.wait(timeout=30):
                raise TimeoutError("test did not release the first Store write")
        original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", pause_real_store_write)
    first = asyncio.create_task(
        manager.async_save_area(SERIAL, "existing", UPDATED_AREA)
    )
    await asyncio.wait_for(write_started.wait(), timeout=3)
    second = asyncio.create_task(
        manager.async_save_area(SERIAL, "other", {**OTHER_AREA, "name": "Queued"})
    )
    await asyncio.sleep(0)
    assert manager._metadata_admissions.get(SERIAL) == 1

    drain = asyncio.create_task(manager.async_close_metadata_admission_and_wait(SERIAL))
    await asyncio.sleep(0)
    assert not drain.done()
    release_write.set()
    await first
    with pytest.raises(MetadataAdmissionClosedError):
        await second
    await drain

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.areas(SERIAL)["existing"] == UPDATED_AREA
    assert reloaded.areas(SERIAL)["other"] == OTHER_AREA
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    assert not manager._metadata_admissions.get(SERIAL)
    assert not manager.state_lock(SERIAL).locked()


async def test_accepted_stop_fence_save_survives_waiter_cancellation(hass, monkeypatch):
    """Immediate STOP ownership registers persistence before waiting on state."""
    manager = await _manager_with_areas(hass)
    loop = asyncio.get_running_loop()
    write_started = asyncio.Event()
    release_write = threading.Event()
    write_finished = asyncio.Event()
    original_write = Store._write_prepared_data

    def pause_real_store_write(store, mode: str, payload: str | bytes) -> None:
        if store is manager._store:
            loop.call_soon_threadsafe(write_started.set)
            if not release_write.wait(timeout=30):
                raise TimeoutError("test did not release the STOP Store write")
            try:
                original_write(store, mode, payload)
            finally:
                loop.call_soon_threadsafe(write_finished.set)
        else:
            original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", pause_real_store_write)
    state_lock = manager.state_lock(SERIAL)
    await state_lock.acquire()
    waiter = asyncio.create_task(manager.async_mark_stop_pending(SERIAL))
    await asyncio.sleep(0)
    assert manager.stop_pending(SERIAL)
    assert manager._metadata_persistence_tasks.get(SERIAL)
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter

    drain = asyncio.create_task(manager.async_close_metadata_admission_and_wait(SERIAL))
    await asyncio.sleep(0)
    assert not drain.done()
    state_lock.release()
    await asyncio.wait_for(write_started.wait(), timeout=3)
    assert not drain.done()
    release_write.set()
    await drain
    await asyncio.wait_for(write_finished.wait(), timeout=3)

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert reloaded.pending_stop_run_id(SERIAL) is None
    assert reloaded._robot(SERIAL)[plans_module.STOP_FENCE_EXPIRES_AT]
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    assert not manager.state_lock(SERIAL).locked()


async def test_robot_removal_waits_then_erases_area_commit(hass, monkeypatch):
    """Removal drains an accepted write before persisting robot deletion."""
    manager = await _manager_with_areas(hass)
    loop = asyncio.get_running_loop()
    write_started = asyncio.Event()
    release_write = threading.Event()
    write_finished = asyncio.Event()
    original_write = Store._write_prepared_data
    paused = False

    def pause_first_write(store, mode: str, payload: str | bytes) -> None:
        nonlocal paused
        if store is manager._store and not paused:
            paused = True
            loop.call_soon_threadsafe(write_started.set)
            if not release_write.wait(timeout=30):
                raise TimeoutError("test did not release the real Store write")
            try:
                original_write(store, mode, payload)
            finally:
                loop.call_soon_threadsafe(write_finished.set)
        else:
            original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", pause_first_write)
    waiter = asyncio.create_task(
        manager.async_save_area(SERIAL, "existing", UPDATED_AREA)
    )

    await asyncio.wait_for(write_started.wait(), timeout=3)
    removal = asyncio.create_task(manager.async_remove_robot(SERIAL))
    await asyncio.sleep(0)
    assert not removal.done()
    release_write.set()
    await waiter
    await removal
    await asyncio.wait_for(write_finished.wait(), timeout=3)

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert SERIAL not in reloaded._data["robots"]
    assert SERIAL in manager._removed_robots


async def test_robot_removal_store_write_survives_waiter_cancellation(
    hass, monkeypatch
):
    """Cancellation cannot release removal ownership during the Store write."""
    manager = await _manager_with_areas(hass)
    loop = asyncio.get_running_loop()
    write_started = asyncio.Event()
    release_write = threading.Event()
    write_finished = asyncio.Event()
    original_write = Store._write_prepared_data

    def pause_write(store, mode: str, payload: str | bytes) -> None:
        if store is manager._store:
            loop.call_soon_threadsafe(write_started.set)
            if not release_write.wait(timeout=30):
                raise TimeoutError("test did not release the removal Store write")
            try:
                original_write(store, mode, payload)
            finally:
                loop.call_soon_threadsafe(write_finished.set)
            return
        original_write(store, mode, payload)

    monkeypatch.setattr(Store, "_write_prepared_data", pause_write)
    removal = asyncio.create_task(manager.async_remove_robot(SERIAL))
    await asyncio.wait_for(write_started.wait(), timeout=3)
    removal.cancel()
    result = await asyncio.gather(removal, return_exceptions=True)
    assert isinstance(result[0], asyncio.CancelledError)
    assert manager._metadata_persistence_tasks.get(SERIAL)

    release_write.set()
    await manager._async_wait_metadata_persistence(SERIAL)
    await asyncio.wait_for(write_finished.wait(), timeout=3)

    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert SERIAL not in reloaded._data["robots"]
    assert SERIAL not in manager._listeners
    assert not manager.state_lock(SERIAL).locked()


async def test_removal_before_area_worker_mutation_rejects_accepted_task(
    hass, monkeypatch
):
    """A queued owned worker observes removal before applying its mutation."""
    manager = await _manager_with_areas(hass)
    before = manager.areas(SERIAL)
    selected = manager.snapshot(SERIAL)["selected_area"]
    notifications = 0

    def notified() -> None:
        nonlocal notifications
        notifications += 1

    manager.async_add_listener(SERIAL, notified)
    worker_started = asyncio.Event()
    release_worker = asyncio.Event()
    original_worker = manager._async_persist_area_metadata

    async def defer_worker(serial_number, mutate):
        worker_started.set()
        await release_worker.wait()
        await original_worker(serial_number, mutate)

    monkeypatch.setattr(manager, "_async_persist_area_metadata", defer_worker)
    waiter = asyncio.create_task(
        manager.async_save_area(SERIAL, "existing", UPDATED_AREA)
    )
    await asyncio.wait_for(worker_started.wait(), timeout=3)
    assert manager.areas(SERIAL) == before
    assert manager.snapshot(SERIAL)["selected_area"] == selected

    removal = asyncio.create_task(manager.async_remove_robot(SERIAL))
    try:
        await asyncio.sleep(0)
        assert SERIAL in manager._removed_robots
        assert not removal.done()
    finally:
        release_worker.set()
    with pytest.raises(MetadataAdmissionClosedError):
        await waiter
    await removal

    assert SERIAL not in manager._data["robots"]
    assert not manager.state_lock(SERIAL).locked()
    assert not manager._metadata_persistence_tasks.get(SERIAL)
    assert notifications == 0
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    assert SERIAL not in reloaded._data["robots"]
