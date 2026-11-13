"""Single owner of durable plan state, its one commit and admitted writes."""

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
from contextvars import ContextVar
from copy import deepcopy
from typing import Any, TypeVar, cast

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from . import plan_state, plan_storage
from .plan_model import (
    AreaInUseError,
    AreaSavePreconditionError,
)

_LOGGER = logging.getLogger(__name__)

_DRAFT: ContextVar[dict[str, Any] | None] = ContextVar("matic_plan_draft", default=None)

_MISSING = object()


def _committed(
    live: dict[str, Any], draft: dict[str, Any], changed: set[str]
) -> dict[str, Any]:
    """Return the draft's changed fields and memory's others, in draft order."""
    robot = {
        key: draft[key] if key in changed else live[key]
        for key in draft
        if key in changed or key in live
    }
    robot.update(
        (key, value)
        for key, value in live.items()
        if key not in robot and key not in changed
    )
    return robot


def _merge(target: dict[str, Any], source: dict[str, Any]) -> None:
    """Make ``target`` equal ``source`` in place, keeping its nested dicts."""
    previous = dict(target)
    target.clear()
    for key, value in source.items():
        current = previous.get(key)
        if (
            isinstance(current, dict)
            and isinstance(value, dict)
            and current is not value
        ):
            _merge(current, value)
            value = current
        target[key] = value


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
        self.open_draft: tuple[str, dict[str, Any]] | None = None

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
        """Return the committed robot, or inside ``commit`` this task's draft."""
        # A task started inside the commit copies its context, so also check
        # that the commit is still open.
        if (
            self.open_draft is not None
            and self.open_draft[0] == serial_number
            and _DRAFT.get() is self.open_draft[1]
        ):
            return self.open_draft[1]
        return self._live(serial_number)

    def _live(self, serial_number: str) -> dict[str, Any]:
        """Return the committed robot, adding an empty one if it is new."""
        robots = self.data["robots"]
        robot = robots.get(serial_number)
        if robot is None:
            robot = {}
            plan_state._normalize_robot(robot)
            if serial_number not in self.removed_robots:
                robots[serial_number] = robot
        return cast(dict[str, Any], robot)

    @asynccontextmanager
    async def commit(
        self, serial_number: str, *, user: bool = False, always: bool = False
    ) -> AsyncIterator[dict[str, Any]]:
        """Write one robot on a draft, save it, then apply it to memory.

        Inside the block ``robot(serial_number)`` returns the draft. A block
        that raises saves nothing, nor does one that leaves the draft
        unchanged unless ``always`` is set. A failed save leaves memory as it
        was. The save and memory take the writer's changed fields and keep
        memory's own for the rest, so fence fields ride along and a fence set
        meanwhile stands. ``user`` applies the public-edit admission check
        under the lock.
        """
        async with self.store_lock:
            if user:
                self.metadata_write_rejected(
                    serial_number,
                    allow_removed=False,
                    allow_closed=False,
                    reject_on_admission_close=True,
                )
            robots = self.data["robots"]
            live = robots.get(serial_number)
            if live is None:
                live = {}
                plan_state._normalize_robot(live)
            base = dict(live)
            draft = deepcopy(live)
            token = _DRAFT.set(draft)
            self.open_draft = (serial_number, draft)
            try:
                yield draft
            finally:
                self.open_draft = None
                _DRAFT.reset(token)
            plan_state._normalize_robot(draft)
            changed = {
                key
                for key in base.keys() | draft.keys()
                if base.get(key, _MISSING) != draft.get(key, _MISSING)
            }
            if not (changed or always) or serial_number in self.removed_robots:
                return
            await self._async_write(
                {**robots, serial_number: _committed(live, draft, changed)}
            )
            _merge(
                robots.setdefault(serial_number, live),
                _committed(live, draft, changed),
            )

    def fence(self, serial_number: str, fields: dict[str, Any]) -> None:
        """Set stop-fence fields in memory now; the next commit saves them.

        A fence must hold at once, even when its save fails, so it cannot
        wait for a commit. Nothing else writes outside ``commit``.
        """
        self._live(serial_number).update(fields)

    def revoke(self, serial_number: str, *keys: str) -> bool:
        """Drop fence or ownership fields from memory now, like ``fence``.

        Returns whether any of the fields held a value.
        """
        robot = self.data["robots"].get(serial_number, {})
        values = [robot.pop(key, None) for key in keys]
        return any(value is not None for value in values)

    async def async_save_loaded(self) -> None:
        """Save what loading repaired."""
        async with self.store_lock:
            await self._async_write(self.data["robots"])

    async def async_remove(self, serial_number: str) -> bool:
        """Save the document without one robot, then forget it in memory."""
        async with self.store_lock:
            robots = self.data["robots"]
            if serial_number not in robots:
                return False
            remaining = {
                key: value for key, value in robots.items() if key != serial_number
            }
            await self._async_write(remaining)
            robots.pop(serial_number, None)
            return True

    async def async_save_fences(self, serial_number: str) -> None:
        """Save a robot with the fence fields memory holds, then notify."""

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.commit(serial_number, always=True):
                return serial_number not in self.removed_robots

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

    async def _async_write(self, robots: dict[str, Any]) -> None:
        """Save the document with these robots; the only plan-state save."""
        await self.store.async_save({**self.data, "robots": robots})

    async def async_mutate_and_save(
        self,
        serial_number: str,
        mutate: Callable[[], _MetadataResult],
        *,
        domain_locks: Sequence[asyncio.Lock] = (),
        after_commit: Callable[[_MetadataResult | None], None] | None = None,
        finish_during_unload: bool = False,
    ) -> _MetadataResult | None:
        """Commit a sticky robot mutation and notify unless it returns ``None``.

        ``finish_during_unload`` admits the write before its locks, so an
        unload that starts while it waits lets it finish.
        """

        async def commit(_lease: _MetadataLockLease) -> _MetadataResult | None:
            async with self.commit(serial_number):
                if serial_number in self.removed_robots:
                    return None
                return mutate()

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
            allow_closed=finish_during_unload,
            register_before_lock_wait=finish_during_unload,
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
            async with self.commit(serial_number, user=True) as robot:
                # The caller's synchronous guard and mutation share this
                # commit. No await may separate them.
                if precondition is not None:
                    precondition()
                mutate(robot)

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
        only needs each worker to finish and release the state lock before
        unloading or removing the robot.
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

    def notify_listeners(self, serial_number: str) -> None:
        for listener in tuple(self.listeners.get(serial_number, ())):
            try:
                listener()
            except Exception:
                _LOGGER.error("Cleaning plan listener failed")
