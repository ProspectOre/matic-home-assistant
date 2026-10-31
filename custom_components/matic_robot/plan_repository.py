"""Single owner of durable plan state and admitted metadata transactions."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import (
    AsyncIterator,
    Callable,
    Coroutine,
    Sequence,
)
from contextlib import asynccontextmanager
from copy import deepcopy
from typing import Any, TypeVar, cast

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from . import plan_storage
from .plan_model import (
    AreaInUseError,
    AreaSavePreconditionError,
)

_LOGGER = logging.getLogger(__name__)


class _MetadataLockLease:
    """Track precisely which transaction locks are still owned by a worker."""

    def __init__(self) -> None:
        self._locks: list[asyncio.Lock] = []

    def add(self, lock: asyncio.Lock) -> None:
        self._locks.append(lock)

    def release(self, lock: asyncio.Lock) -> None:
        if lock in self._locks:
            self._locks.remove(lock)
            lock.release()

    def release_all(self) -> None:
        while self._locks:
            self._locks.pop().release()


_MetadataResult = TypeVar("_MetadataResult")


class MetadataAdmissionClosedError(HomeAssistantError):
    """Raised when a user metadata write reaches an unloading robot."""


class PlanRepository:
    """Serialize the shared Store and retain admitted writes through cancellation."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = plan_storage._CleaningPlanStore(
            hass,
            plan_storage.STORAGE_VERSION,
            plan_storage.STORAGE_KEY,
            private=True,
            minor_version=plan_storage.STORAGE_MINOR_VERSION,
        )
        self.data: dict[str, Any] = self.empty_data()
        self.listeners: dict[str, set[Callable[[], None]]] = {}
        self.native_history_locks: dict[str, asyncio.Lock] = {}
        self.state_locks: dict[str, asyncio.Lock] = {}
        self.plan_write_locks: dict[str, asyncio.Lock] = {}
        self.store_lock = asyncio.Lock()
        self.native_history_saves: dict[str, set[asyncio.Event]] = {}
        self.metadata_persistence_tasks: dict[str, set[asyncio.Task[Any]]] = {}
        self.metadata_admissions: dict[str, int] = {}
        self.metadata_admission_idle: dict[str, asyncio.Event] = {}
        self.metadata_admission_closed: set[str] = set()
        self.reconciliation_removal_pending: set[str] = set()
        self.removed_robots: set[str] = set()

    @staticmethod
    def empty_data() -> dict[str, Any]:
        return {"robots": {}}

    def native_history_lock(self, serial_number: str) -> asyncio.Lock:
        """Serialize native-history persistence without claiming plan ownership."""
        return self.native_history_locks.setdefault(serial_number, asyncio.Lock())

    def state_lock(self, serial_number: str) -> asyncio.Lock:
        """Serialize persisted state changes with robot removal."""
        return self.state_locks.setdefault(serial_number, asyncio.Lock())

    def plan_write_lock(self, serial_number: str) -> asyncio.Lock:
        """Serialize saved-plan and cadence edits through their storage commit."""
        return self.plan_write_locks.setdefault(serial_number, asyncio.Lock())

    async def async_close_metadata_admission_and_wait(self, serial_number: str) -> None:
        """Reject new metadata work and drain every caller admitted before closure."""
        self.metadata_admission_closed.add(serial_number)
        await self.async_wait_metadata_persistence(serial_number)

    @callback
    def async_add_listener(
        self, serial_number: str, listener: Callable[[], None]
    ) -> Callable[[], None]:
        """Subscribe an entity to plan or history changes for one robot."""
        listeners = self.listeners.setdefault(serial_number, set())
        listeners.add(listener)

        @callback
        def remove_listener() -> None:
            listeners.discard(listener)

        return remove_listener

    def robot(self, serial_number: str) -> dict[str, Any]:
        robots = self.data.get("robots")
        if not isinstance(robots, dict):
            robots = {}
            self.data["robots"] = robots
        robot_value = robots.get(serial_number)
        if not isinstance(robot_value, dict):
            robot_value = {}
            if serial_number not in self.removed_robots:
                robots[serial_number] = robot_value
        robot = cast(dict[str, Any], robot_value)
        plan_storage._normalize_robot(robot)
        return robot

    async def async_save_and_notify(self, serial_number: str) -> None:
        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.store_lock:
                if serial_number in self.removed_robots:
                    return False
                await self.store.async_save(self.data)
            return True

        def notify_if_saved(saved: bool) -> None:
            if saved:
                self.notify_listeners(serial_number)

        await self.async_run_owned_metadata(
            serial_number,
            commit,
            after_commit=notify_if_saved,
            allow_closed=True,
            register_before_lock_wait=True,
        )

    async def async_mutate_and_save(
        self,
        serial_number: str,
        mutate: Callable[[], _MetadataResult],
        *,
        domain_locks: Sequence[asyncio.Lock] = (),
        after_commit: Callable[[_MetadataResult | None], None] | None = None,
    ) -> _MetadataResult | None:
        """Serialize a sticky robot mutation before exposing it to Store."""

        async def commit(_lease: _MetadataLockLease) -> _MetadataResult | None:
            async with self.store_lock:
                if serial_number in self.removed_robots:
                    return None
                result = mutate()
                if result is None:
                    return None
                await self.store.async_save(self.data)
            return result

        def after_saved(result: _MetadataResult | None) -> None:
            if result is None:
                return
            self.notify_listeners(serial_number)
            if after_commit is not None:
                after_commit(result)

        return await self.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=domain_locks,
            after_commit=after_saved,
        )

    async def async_mutate_area_metadata(
        self,
        serial_number: str,
        mutate: Callable[[dict[str, Any]], None],
        *,
        precondition: Callable[[], None] | None = None,
    ) -> None:
        """Own an admitted Area metadata commit independently of its waiter."""

        async def persist(_lease: _MetadataLockLease) -> None:
            await self.async_persist_area_metadata(
                serial_number, mutate, precondition=precondition
            )

        await self.async_run_owned_metadata(
            serial_number,
            persist,
            notify=True,
            reject_on_admission_close=True,
        )

    def register_metadata_task(
        self,
        serial_number: str,
        task: asyncio.Task[Any],
        on_done: Callable[[], None] | None = None,
    ) -> None:
        """Track an accepted metadata worker until its commit settles."""
        tasks = self.metadata_persistence_tasks.setdefault(serial_number, set())
        tasks.add(task)
        task.add_done_callback(
            lambda completed: self.metadata_task_done(serial_number, completed, on_done)
        )

    def begin_metadata_admission(self, serial_number: str) -> None:
        """Count a caller after admission policy passes and before it queues."""
        idle = self.metadata_admission_idle.get(serial_number)
        if idle is None:
            idle = asyncio.Event()
            idle.set()
            self.metadata_admission_idle[serial_number] = idle
        self.metadata_admissions[serial_number] = (
            self.metadata_admissions.get(serial_number, 0) + 1
        )
        idle.clear()

    def end_metadata_admission(self, serial_number: str) -> None:
        remaining = self.metadata_admissions.get(serial_number, 0) - 1
        if remaining <= 0:
            self.metadata_admissions.pop(serial_number, None)
            self.metadata_admission_idle[serial_number].set()
        else:
            self.metadata_admissions[serial_number] = remaining

    def metadata_write_rejected(
        self,
        serial_number: str,
        *,
        allow_removed: bool,
        allow_closed: bool,
        reject_on_admission_close: bool,
    ) -> bool:
        """Apply the public-write rejection policy at every admission gate."""
        rejected = (serial_number in self.removed_robots and not allow_removed) or (
            serial_number in self.metadata_admission_closed and not allow_closed
        )
        if rejected and reject_on_admission_close:
            raise MetadataAdmissionClosedError(
                "Matic metadata is unavailable during unload"
            )
        return rejected

    @asynccontextmanager
    async def user_metadata_store_transaction(
        self, serial_number: str
    ) -> AsyncIterator[None]:
        """Acquire the shared Store and recheck admission before a public edit."""
        async with self.store_lock:
            self.metadata_write_rejected(
                serial_number,
                allow_removed=False,
                allow_closed=False,
                reject_on_admission_close=True,
            )
            yield

    async def async_run_owned_metadata(
        self,
        serial_number: str,
        operation: Callable[[_MetadataLockLease], Coroutine[Any, Any, _MetadataResult]],
        *,
        domain_locks: Sequence[asyncio.Lock] = (),
        notify: bool = False,
        after_commit: Callable[[_MetadataResult], None] | None = None,
        allow_removed: bool = False,
        allow_closed: bool = False,
        register_before_lock_wait: bool = False,
        reject_on_admission_close: bool = False,
    ) -> _MetadataResult | None:
        """Admit mutation after cancellable locks, then own it through settlement."""
        lease = _MetadataLockLease()
        effective_allow_closed = allow_closed and not register_before_lock_wait
        if self.metadata_write_rejected(
            serial_number,
            allow_removed=allow_removed,
            allow_closed=effective_allow_closed,
            reject_on_admission_close=reject_on_admission_close,
        ):
            return None
        self.begin_metadata_admission(serial_number)

        async def acquire_owned_locks() -> None:
            for lock in (*domain_locks, self.state_lock(serial_number)):
                await lock.acquire()
                lease.add(lock)

        async def run() -> _MetadataResult | None:
            try:
                if register_before_lock_wait:
                    await acquire_owned_locks()
                if self.metadata_write_rejected(
                    serial_number,
                    allow_removed=allow_removed,
                    allow_closed=allow_closed,
                    reject_on_admission_close=reject_on_admission_close,
                ):
                    return None
                result = await operation(lease)
                lease.release_all()
                if notify:
                    self.notify_listeners(serial_number)
                if after_commit is not None:
                    try:
                        after_commit(result)
                    except Exception:
                        _LOGGER.error("Metadata commit callback failed")
                return result
            finally:
                lease.release_all()

        if register_before_lock_wait:
            runner = run()
            try:
                task = asyncio.create_task(runner)
            except BaseException:
                runner.close()
                lease.release_all()
                self.end_metadata_admission(serial_number)
                raise
            self.register_metadata_task(serial_number, task, lease.release_all)
            self.end_metadata_admission(serial_number)
            return await asyncio.shield(task)

        lease_transferred = False
        try:
            await acquire_owned_locks()
            if self.metadata_write_rejected(
                serial_number,
                allow_removed=allow_removed,
                allow_closed=allow_closed,
                reject_on_admission_close=reject_on_admission_close,
            ):
                return None
            runner = run()
            try:
                task = asyncio.create_task(runner)
            except BaseException:
                runner.close()
                raise
            self.register_metadata_task(serial_number, task, lease.release_all)
            lease_transferred = True
        finally:
            if not lease_transferred:
                lease.release_all()
            self.end_metadata_admission(serial_number)
        return await asyncio.shield(task)

    async def async_persist_area_metadata(
        self,
        serial_number: str,
        mutate: Callable[[dict[str, Any]], None],
        *,
        precondition: Callable[[], None] | None = None,
    ) -> None:
        """Persist current shared state while retaining its per-robot fence."""
        async with self.user_metadata_store_transaction(serial_number):
            # Do not expose an uncommitted Area change to another robot's
            # whole-root Store serialization while it is queued here.
            robots = self.data["robots"]
            robot_was_present = serial_number in robots
            robot = self.robot(serial_number)
            area_keys = ("areas", "selected_area")
            before = {key: deepcopy(robot[key]) for key in area_keys if key in robot}
            try:
                # The caller's synchronous guard and mutation share this locked
                # transaction. No await may separate them.
                if precondition is not None:
                    precondition()
                mutate(robot)
            except BaseException:
                current = {
                    key: deepcopy(robot[key]) for key in area_keys if key in robot
                }
                plan_storage._restore_unsaved_changes(robot, before, current)
                if not robot_was_present:
                    robots.pop(serial_number, None)
                raise
            applied = {key: deepcopy(robot[key]) for key in area_keys if key in robot}
            try:
                await self.store.async_save(self.data)
            except Exception:
                plan_storage._restore_unsaved_changes(robot, before, applied)
                if not robot_was_present:
                    empty_robot: dict[str, Any] = {}
                    plan_storage._normalize_robot(empty_robot)
                    if robot == empty_robot:
                        robots.pop(serial_number, None)
                raise

    def metadata_task_done(
        self,
        serial_number: str,
        task: asyncio.Task[Any],
        on_done: Callable[[], None] | None = None,
    ) -> None:
        """Retrieve errors from commits whose request waiter was cancelled."""
        if on_done is not None:
            on_done()
        tasks = self.metadata_persistence_tasks.get(serial_number)
        if tasks is not None:
            tasks.discard(task)
            if not tasks:
                self.metadata_persistence_tasks.pop(serial_number, None)
        if task.cancelled():
            _LOGGER.error("Metadata persistence task was cancelled")
        elif task.exception() is not None and not isinstance(
            task.exception(), (AreaSavePreconditionError, AreaInUseError)
        ):
            _LOGGER.error("Metadata persistence task failed")

    async def async_wait_metadata_persistence(self, serial_number: str) -> None:
        """Wait until all accepted metadata commits for a robot have settled.

        Mutation waiters receive their commit errors, while lifecycle cleanup
        only needs each worker to finish its rollback and release the state
        lock before unloading or removing the robot.
        """
        idle = self.metadata_admission_idle.get(serial_number)
        while True:
            if idle is not None:
                await idle.wait()
            tasks = tuple(self.metadata_persistence_tasks.get(serial_number, ()))
            if not tasks and not self.metadata_admissions.get(serial_number):
                return
            if tasks:
                await asyncio.gather(
                    *(asyncio.shield(task) for task in tasks), return_exceptions=True
                )

    async def async_save_with_rollback(
        self,
        serial_number: str,
        before: dict[str, Any],
    ) -> None:
        """Restore this failed mutation without reverting later writers."""
        robot = self.robot(serial_number)
        applied = deepcopy(robot)
        try:
            await self.store.async_save(self.data)
        except Exception, asyncio.CancelledError:
            plan_storage._restore_unsaved_changes(robot, before, applied)
            raise

    def notify_listeners(self, serial_number: str) -> None:
        for listener in tuple(self.listeners.get(serial_number, ())):
            try:
                listener()
            except Exception:
                _LOGGER.error("Cleaning plan listener failed")
