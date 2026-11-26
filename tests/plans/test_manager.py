"""Plan manager setup, robot removal and the lifetime of its tasks."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.exceptions import ServiceValidationError

import custom_components.matic_robot.plans as plans_module
from custom_components.matic_robot.client.models import FloorPlan
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_executor import async_execute_rooms
from custom_components.matic_robot.managed_run import PlanCancelledError
from custom_components.matic_robot.plan_repository import MetadataAdmissionClosedError
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.service_context import entry_for_entity
from tests.plans.fakes import memory_manager, plan_room, run_plan_call
from tests.session_fakes import FakeRobot


async def test_remove_robot_erases_only_its_persisted_data(hass) -> None:
    """Removing an entry must not leave its private data or erase another robot."""
    manager = memory_manager(hass)
    manager.repository.data = {
        "robots": {
            "removed": {"plans": {"private": {"name": "Bedroom"}}},
            "retained": {"plans": {"shared": {"name": "Kitchen"}}},
        }
    }
    manager.control.async_cancel_and_wait = AsyncMock()

    await manager.async_remove_robot("removed")

    manager.control.async_cancel_and_wait.assert_awaited_once_with("removed")
    assert manager.repository.data == {
        "robots": {
            "retained": {"plans": {"shared": {"name": "Kitchen"}}},
        }
    }
    manager.repository.store.async_save.assert_awaited_once_with(
        manager.repository.data
    )


async def test_remove_robot_restores_data_when_persist_fails(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.data = {"robots": {"removed": {"plans": {"private": {}}}}}
    manager.control.async_cancel_and_wait = AsyncMock()
    manager.repository.store = SimpleNamespace(
        async_save=AsyncMock(side_effect=OSError)
    )

    with pytest.raises(OSError):
        await manager.async_remove_robot("removed")

    assert "removed" in manager.repository.data["robots"]


async def test_late_plan_save_cannot_recreate_robot_during_removal(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.data = {"robots": {"removed": {"plans": {}}}}
    manager.control.async_cancel_and_wait = AsyncMock()
    save_started = asyncio.Event()
    release_save = asyncio.Event()
    save_count = 0

    async def save(_data) -> None:
        nonlocal save_count
        save_count += 1
        save_started.set()
        await release_save.wait()

    manager.repository.store = SimpleNamespace(async_save=save)
    removal = asyncio.create_task(manager.async_remove_robot("removed"))
    await save_started.wait()

    late_save = asyncio.create_task(
        manager.catalog.async_save_plan("removed", "late", {"name": "Late"})
    )
    try:
        await asyncio.sleep(0)
        assert late_save.done()
        with pytest.raises(MetadataAdmissionClosedError):
            await late_save
        assert "removed" in manager.repository.data["robots"]
    finally:
        release_save.set()
    await removal

    assert "removed" not in manager.repository.data["robots"]
    assert save_count == 1


async def test_robot_removal_serializes_store_writes_across_robots(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.data = {
        "robots": {
            "removed": {"plans": {"private": {}}},
            "retained": {"plans": {"shared": {}}},
        }
    }
    manager.control.async_cancel_and_wait = AsyncMock()
    save_started = asyncio.Event()
    release_save = asyncio.Event()
    completed_saves: list[dict] = []
    save_count = 0

    async def save(data) -> None:
        nonlocal save_count
        save_count += 1
        snapshot = deepcopy(data)
        if save_count == 1:
            save_started.set()
            await release_save.wait()
        completed_saves.append(snapshot)

    manager.repository.store = SimpleNamespace(async_save=save)
    retained_save = asyncio.create_task(
        manager.ledger.async_set_native_cleanings_enabled("retained", True)
    )
    await save_started.wait()

    removal = asyncio.create_task(manager.async_remove_robot("removed"))
    await asyncio.sleep(0)
    assert not removal.done()
    assert "removed" in manager.repository.data["robots"]

    release_save.set()
    await retained_save
    await removal

    assert save_count == 2
    assert "removed" in completed_saves[0]["robots"]
    assert "removed" not in completed_saves[-1]["robots"]


async def test_removed_entry_generation_stays_fenced_after_reactivation(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.data = {"robots": {"serial": {}}}
    old_generation = manager.control.activate_robot("serial")
    await manager.async_remove_robot("serial")
    manager.control.activate_robot("serial")

    floor_plan = FloorPlan(1, "partition", b"partition", ())

    assert (
        await manager.ledger.async_import_native_history(
            "serial", floor_plan, (), generation=old_generation
        )
        is None
    )


async def test_native_history_after_robot_removal_cannot_recreate_data(hass) -> None:
    """A late cleaning-finished callback must stay fenced after unload."""
    manager = memory_manager(hass)
    manager.repository.data = {"robots": {"removed": {"plans": {"private": {}}}}}
    manager.control.async_cancel_and_wait = AsyncMock()

    await manager.async_remove_robot("removed")

    assert (
        await manager.ledger.async_import_native_history("removed", None, ())
    ) is None
    assert "removed" not in manager.repository.data["robots"]


async def test_robot_activation_clears_removal_tombstone(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.removed_robots.add("serial")

    manager.control.activate_robot("serial")

    assert "serial" not in manager.repository.removed_robots


async def test_native_history_rechecks_removal_after_waiting_for_lock(hass) -> None:
    manager = memory_manager(hass)
    manager.repository.data = {"robots": {"serial": {}}}
    manager.control.async_cancel_and_wait = AsyncMock()
    floor_plan = FloorPlan(1, "partition", b"partition", ())
    native_history_lock = manager.repository.native_history_lock("serial")
    await native_history_lock.acquire()
    importing = asyncio.create_task(
        manager.ledger.async_import_native_history("serial", floor_plan, ())
    )
    await asyncio.sleep(0)
    removing = asyncio.create_task(manager.async_remove_robot("serial"))
    await asyncio.sleep(0)

    assert "serial" in manager.repository.removed_robots
    native_history_lock.release()

    assert await importing is None
    await removing
    assert "serial" not in manager.repository.data["robots"]


async def test_native_history_lock_does_not_claim_managed_plan(hass) -> None:
    manager = CleaningPlanManager(hass)

    async with manager.repository.native_history_lock("serial"):
        assert manager.control.has_managed_task("serial") is False


async def test_remove_robot_waits_for_pending_native_history_save(hass) -> None:
    manager = memory_manager(hass)
    manager.repository.data = {"robots": {"removed": {}}}
    manager.control.async_cancel_and_wait = AsyncMock()
    pending = asyncio.Event()
    manager.repository.native_history_saves["removed"] = {pending}

    removal = asyncio.create_task(manager.async_remove_robot("removed"))
    await asyncio.sleep(0)
    assert not removal.done()
    pending.set()
    await removal


async def test_config_unload_waits_for_managed_runner(hass) -> None:
    """Entry teardown cannot close the client while its runner is still live."""
    manager = memory_manager(hass)
    entered = asyncio.Event()

    async def wait_for_cancel(*_args, **_kwargs) -> None:
        entered.set()
        await manager.control.cancellation_event("serial").wait()
        raise PlanCancelledError

    robot = FakeRobot()
    robot.show("idle")
    with patch(
        "custom_components.matic_robot.managed_leg.async_run_room_leg",
        AsyncMock(side_effect=wait_for_cancel),
    ):
        task = asyncio.create_task(
            async_execute_rooms(
                hass,
                run_plan_call(hass),
                manager,
                "vacuum.matic",
                "serial",
                [plan_room("Kitchen", "one")],
                floor_token="floor",
                robot=robot.port(),
            )
        )
        await entered.wait()
        await manager.control.async_cancel_and_wait("serial")

    assert task.done()
    assert manager.control.lock("serial").locked() is False


async def test_run_task_lifecycle_edge_cases(hass) -> None:
    manager = CleaningPlanManager(hass)
    assert manager.control.cancellation_reason("serial") is None
    await manager.control.async_cancel_and_wait("serial")
    with (
        patch(
            "custom_components.matic_robot.plans.asyncio.current_task",
            return_value=None,
        ),
        pytest.raises(RuntimeError, match="no current task"),
    ):
        manager.control.register_run_task("serial")

    manager.control.register_run_task("serial")
    await manager.control.async_cancel_and_wait("serial")
    manager.control.unregister_run_task("serial")


async def test_reconciliation_tasks_are_lifecycle_bound(hass) -> None:
    manager = CleaningPlanManager(hass)
    started = asyncio.Event()

    async def reconcile() -> None:
        started.set()
        await asyncio.Event().wait()

    task = asyncio.create_task(reconcile())
    manager.control.register_reconciliation_task("serial", task)
    assert manager.control.actor("serial").reconciliation_tasks
    await started.wait()
    await manager.control.async_cancel_and_wait("serial")
    assert task.cancelled()
    assert manager.control.dock_reconciliation_active("serial") is False
    assert not manager.control.actor("serial").reconciliation_tasks

    finished = asyncio.create_task(asyncio.sleep(0))
    manager.control.register_reconciliation_task("serial", finished)
    await finished
    await asyncio.sleep(0)
    assert manager.control.dock_reconciliation_active("serial") is False
    assert not manager.control.actor("serial").reconciliation_tasks


async def test_a_cancelled_unload_waiter_still_ends_the_run_and_cleans_up(
    hass,
) -> None:
    """Cancelling the caller neither cancels the run nor skips its cleanup."""
    manager = CleaningPlanManager(hass)
    control = manager.control
    cancel = control.prepare_run("serial")
    ending = asyncio.Event()
    release = asyncio.Event()

    async def run() -> str:
        control.register_run_task("serial")
        await cancel.wait()
        # The run records how it ended, which takes a moment.
        ending.set()
        await release.wait()
        return "ended on its cancel event"

    run_task = asyncio.create_task(run())
    watcher = asyncio.create_task(asyncio.Event().wait())
    control.register_reconciliation_task("serial", watcher)
    await asyncio.sleep(0)
    metadata_settled = asyncio.Event()

    async def settle_metadata(_serial_number: str) -> None:
        metadata_settled.set()

    with patch.object(
        manager.repository, "async_wait_metadata_persistence", settle_metadata
    ):
        waiter = asyncio.create_task(control.async_cancel_and_wait("serial"))
        await ending.wait()
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        assert not run_task.done()
        assert not watcher.done()

        release.set()
        assert await run_task == "ended on its cancel event"
        async with asyncio.timeout(1):
            await metadata_settled.wait()
    await asyncio.sleep(0)
    assert watcher.cancelled()
    assert not control.actor("serial").reconciliation_tasks
    assert control.cancellation_reason("serial") == "config_entry_unload"
    assert not control.actor("serial").teardowns


async def test_metadata_wait_returns_before_a_finished_worker_is_forgotten(
    hass,
) -> None:
    """A worker that finished, but whose done callback is still queued, is settled."""
    manager = CleaningPlanManager(hass)
    repository = manager.repository
    worker = asyncio.create_task(asyncio.sleep(0))
    await worker
    # Registering a finished task queues its done callback for a later step.
    repository.register_metadata_task("serial", worker)
    assert repository.metadata_persistence_tasks["serial"] == {worker}
    gather = asyncio.gather
    calls = 0

    def bounded_gather(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls > 3:
            raise AssertionError("the wait kept awaiting the finished worker")
        return gather(*args, **kwargs)

    with patch("asyncio.gather", bounded_gather):
        await repository.async_wait_metadata_persistence("serial")
    await asyncio.sleep(0)
    assert "serial" not in repository.metadata_persistence_tasks


async def test_dock_scope_cleanup_claims_unset_run_id(hass) -> None:
    """A live dock watcher claims an otherwise-unset activity scope."""
    manager = CleaningPlanManager(hass)
    task = asyncio.create_task(asyncio.Event().wait())
    manager.control.register_reconciliation_task(
        "serial", task, dock=True, run_id="run-1"
    )
    scope: dict[str, str | None] = {"run_id": None}

    def set_scope(run_id: str | None) -> None:
        scope["run_id"] = run_id

    assert manager.control.defer_activity_scope_cleanup(
        "serial", "run-1", set_scope, lambda: scope["run_id"]
    )
    assert scope["run_id"] == "run-1"
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert scope["run_id"] is None


async def test_replacing_motion_cancels_obsolete_reconciliation(hass) -> None:
    manager = CleaningPlanManager(hass)
    task = asyncio.create_task(asyncio.Event().wait())
    manager.control.register_reconciliation_task("serial", task)
    manager.control.replace_managed_motion("serial")
    await asyncio.gather(task, return_exceptions=True)
    assert task.cancelled()


def test_entry_lookup_rejects_missing_registry_entry() -> None:
    registry = SimpleNamespace(async_get=MagicMock(return_value=None))
    with (
        patch(
            "custom_components.matic_robot.service_context.er.async_get",
            return_value=registry,
        ),
        pytest.raises(ServiceValidationError, match="unavailable"),
    ):
        entry_for_entity(SimpleNamespace(), "vacuum.matic")


async def test_plan_manager_initialization_is_shared_before_storage_load(hass) -> None:
    started = asyncio.Event()
    finish_load = asyncio.Event()

    async def load_store() -> None:
        started.set()
        await finish_load.wait()

    manager = SimpleNamespace(async_load=AsyncMock(side_effect=load_store))
    with patch.object(
        plans_module, "CleaningPlanManager", return_value=manager
    ) as manager_factory:
        first = asyncio.create_task(plans_module.async_get_plan_manager(hass))
        await started.wait()
        second = asyncio.create_task(plans_module.async_get_plan_manager(hass))
        await asyncio.sleep(0)

        assert manager_factory.call_count == 1
        assert hass.data[DOMAIN][plans_module.DATA_PLAN_MANAGER] is manager

        finish_load.set()
        assert await asyncio.gather(first, second) == [manager, manager]

    manager.async_load.assert_awaited_once()


async def test_plan_manager_initialization_clears_failed_manager(hass) -> None:
    manager = SimpleNamespace(async_load=AsyncMock(side_effect=RuntimeError("load")))
    with (
        patch.object(plans_module, "CleaningPlanManager", return_value=manager),
        pytest.raises(RuntimeError, match="load"),
    ):
        await plans_module.async_get_plan_manager(hass)

    assert plans_module.DATA_PLAN_MANAGER not in hass.data[DOMAIN]
