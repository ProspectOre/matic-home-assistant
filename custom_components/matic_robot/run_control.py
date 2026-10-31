"""Runtime command ownership, cancellation and graceful-stop fences."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import (
    AsyncIterator,
    Callable,
    Iterator,
    Mapping,
)
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass
from datetime import timedelta
from time import monotonic
from typing import Any, Literal, cast

from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from . import native_history, plan_storage, plan_timing
from .plan_model import (
    PlanStopDecision,
    _has_frozen_stop_policy,
    _managed_stop_policy,
)
from .plan_repository import (
    PlanRepository,
)

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class _StopFence:
    """One live native STOP fence and the identity of its accepted command."""

    deadline: float
    token: int


_CommandAdmission = tuple[Literal["open", "managed_only", "closed"], int]


_OPEN_COMMAND_ADMISSION: _CommandAdmission = ("open", 0)


class ManagedMotionReplacedError(HomeAssistantError):
    """A newer command superseded a managed plan command."""


class RunControl:
    """Fence robot commands and own managed task lifetimes."""

    def __init__(self, repository: PlanRepository) -> None:
        self.repository = repository
        self.locks: dict[str, asyncio.Lock] = {}
        self.cancel_events: dict[str, asyncio.Event] = {}
        self.finish_room_events: dict[str, asyncio.Event] = {}
        self.command_locks: dict[str, asyncio.Lock] = {}
        self.motion_generations: dict[str, int] = {}
        self.stop_request_generations: dict[str, int] = {}
        self.managed_motion: dict[str, int] = {}
        self.stop_dispatch_reservations: dict[str, tuple[int, int]] = {}
        self.run_tasks: dict[str, asyncio.Task[None]] = {}
        self.reconciliation_tasks: dict[str, set[asyncio.Task[None]]] = {}
        self.dock_reconciliation_tasks: dict[str, set[asyncio.Task[None]]] = {}
        self.dock_reconciliation_run_ids: dict[
            str, dict[asyncio.Task[None], str | None]
        ] = {}
        self.dock_scope_cleanups: dict[
            str,
            dict[
                str,
                tuple[Callable[[str | None], None], Callable[[], str | None] | None],
            ],
        ] = {}
        self.command_admission: dict[str, _CommandAdmission] = {}
        self.robot_generations: dict[str, int] = {}
        self.cancellation_reasons: dict[str, str] = {}
        self.managed_stop_dispatch_transaction: ContextVar[
            tuple[str, int | None, int | None] | None
        ] = ContextVar(f"matic_managed_stop_dispatch_{id(self)}", default=None)
        self.stop_fences: dict[str, _StopFence] = {}
        self.stop_fence_sequence = 0

    def lock(self, serial_number: str) -> asyncio.Lock:
        """Return the single-flight plan lock for one robot."""
        return self.locks.setdefault(serial_number, asyncio.Lock())

    def command_lock(self, serial_number: str) -> asyncio.Lock:
        """Serialize commands that can change one robot's active task."""
        return self.command_locks.setdefault(serial_number, asyncio.Lock())

    @callback
    def mark_stop_pending(
        self,
        serial_number: str,
        duration_seconds: float = native_history.OEM_STOP_FENCE_SECONDS,
        *,
        run_id: str | None = None,
    ) -> None:
        """Fence replacement motion while Matic's native STOP settles."""
        self.arm_stop_pending(serial_number, duration_seconds, renew=True)
        self.repository.robot(serial_number)[plan_storage.STOP_FENCE_EXPIRES_AT] = (
            dt_util.utcnow() + timedelta(seconds=duration_seconds)
        ).isoformat()
        robot = self.repository.robot(serial_number)
        robot.pop(plan_storage.STOP_FENCE_RUN_ID, None)
        if run_id is not None:
            robot[plan_storage.STOP_FENCE_RUN_ID] = run_id

    async def async_mark_stop_pending(
        self,
        serial_number: str,
        duration_seconds: float = native_history.OEM_STOP_FENCE_SECONDS,
        *,
        run_id: str | None = None,
    ) -> None:
        """Persist an accepted OEM STOP before releasing command ownership."""
        if serial_number in self.repository.metadata_admission_closed:
            return
        self.mark_stop_pending(serial_number, duration_seconds, run_id=run_id)
        await self.repository.async_save_and_notify(serial_number)

    @callback
    def stop_pending(self, serial_number: str) -> bool:
        """Return whether an OEM stop countdown is still in its settle window."""
        fence = self.stop_fences.get(serial_number)
        if fence is None:
            return False
        if monotonic() >= fence.deadline:
            self.stop_fences.pop(serial_number, None)
            self.repository.robot(serial_number).pop(
                plan_storage.STOP_FENCE_EXPIRES_AT, None
            )
            self.repository.robot(serial_number).pop(
                plan_storage.STOP_FENCE_RUN_ID, None
            )
            return False
        return True

    @callback
    def clear_stop_pending(self, serial_number: str) -> bool:
        """Clear a completed OEM stop fence after the robot reaches a stable state."""
        removed = self.stop_fences.pop(serial_number, None) is not None
        owner_removed = (
            self.repository.robot(serial_number).pop(
                plan_storage.STOP_FENCE_RUN_ID, None
            )
            is not None
        )
        return (
            self.repository.robot(serial_number).pop(
                plan_storage.STOP_FENCE_EXPIRES_AT, None
            )
            is not None
            or removed
            or owner_removed
        )

    def stop_fence_token(self, serial_number: str) -> int | None:
        """Return the identity of the current live STOP fence, if any."""
        if not self.stop_pending(serial_number):
            return None
        fence = self.stop_fences.get(serial_number)
        return fence.token if fence is not None else None

    def pending_stop_run_id(self, serial_number: str) -> str | None:
        """Restore only a live stop fence still belonging to the last managed run."""
        robot = self.repository.robot(serial_number)
        owner = robot.get(plan_storage.STOP_FENCE_RUN_ID)
        run = robot.get("last_run")
        if (
            self.stop_pending(serial_number)
            and isinstance(owner, str)
            and isinstance(run, dict)
            and run.get("run_id") == owner
            and run.get("outcome") in {"running", "cancelled", "unverified", "failed"}
        ):
            return owner
        return None

    async def async_clear_stop_pending(
        self, serial_number: str, *, run_id: str | None = None
    ) -> None:
        """Persist removal of a fence after the robot becomes stable.

        When ``run_id`` is supplied, only that run may roll back its fence.
        This keeps a failed STOP from clearing a newer run's accepted fence.
        """
        if serial_number in self.repository.metadata_admission_closed or (
            run_id is not None
            and self.repository.robot(serial_number).get(plan_storage.STOP_FENCE_RUN_ID)
            != run_id
        ):
            return
        if self.clear_stop_pending(serial_number):
            await self.repository.async_save_and_notify(serial_number)

    async def async_clear_stop_pending_if_token(
        self, serial_number: str, stop_fence_token: int, *, run_id: str | None
    ) -> bool:
        """Clear an observed stop only if its original fence still owns it."""
        if serial_number in self.repository.metadata_admission_closed or (
            self.stop_fence_token(serial_number) != stop_fence_token
            or self.repository.robot(serial_number).get(plan_storage.STOP_FENCE_RUN_ID)
            != run_id
        ):
            return False
        self.clear_stop_pending(serial_number)
        await self.repository.async_save_and_notify(serial_number)
        return True

    @callback
    def arm_stop_pending(
        self, serial_number: str, duration_seconds: float, *, renew: bool = False
    ) -> None:
        """Restore one monotonic fence without changing its wall-clock expiry."""
        deadline = monotonic() + duration_seconds
        current = self.stop_fences.get(serial_number)
        if current is not None:
            deadline = max(deadline, current.deadline)
            if not renew:
                if deadline != current.deadline:
                    self.stop_fences[serial_number] = _StopFence(
                        deadline=deadline, token=current.token
                    )
                return
        self.stop_fence_sequence += 1
        self.stop_fences[serial_number] = _StopFence(
            deadline=deadline, token=self.stop_fence_sequence
        )

    @callback
    def motion_generation(self, serial_number: str) -> int:
        """Read the ordering fence for a command that has not dispatched yet."""
        return self.motion_generations.get(serial_number, 0)

    @callback
    def stop_request_generation(self, serial_number: str) -> int:
        """Read the fence for direct motion queued before a Stop request."""
        return self.stop_request_generations.get(serial_number, 0)

    @callback
    def begin_managed_motion(self, serial_number: str) -> int:
        """Claim a generation token for one managed plan run."""
        self.require_command_admission(serial_number)
        generation = self.motion_generations.get(serial_number, 0) + 1
        self.motion_generations[serial_number] = generation
        self.managed_motion[serial_number] = generation
        return generation

    @callback
    def managed_motion_is_current(self, serial_number: str, token: int) -> bool:
        """Return whether a plan still owns the robot's motion generation."""
        return self.managed_motion.get(serial_number) == token

    @callback
    def has_managed_task(self, serial_number: str) -> bool:
        """Return whether a plan run or persisted active room still exists."""
        return self.lock(serial_number).locked() or bool(
            self.repository.robot(serial_number).get("active_plan")
        )

    @callback
    def end_managed_motion(self, serial_number: str, token: int) -> None:
        """Release ownership without disturbing a newer replacement command."""
        if self.managed_motion.get(serial_number) == token:
            self.managed_motion.pop(serial_number, None)

    @callback
    def replace_managed_motion(self, serial_number: str) -> bool:
        """Transfer motion ownership to an admitted independent command."""
        replaced = False
        if self.cancel(serial_number) or self.recovery_run(serial_number) is not None:
            self.cancellation_event(serial_number).set()
            dispatch = self.managed_stop_dispatch_transaction.get()
            if dispatch is None or dispatch[0] != serial_number:
                self.cancellation_reasons[serial_number] = "motion_replaced"
                replaced = True
        self.cancel_reconciliation_tasks(serial_number)
        # Keep the settle countdown active, but revoke its persisted run owner:
        # replacement motion must not resume an obsolete dock watcher after a
        # Home Assistant restart.
        stop_owner_removed = (
            self.repository.robot(serial_number).pop(
                plan_storage.STOP_FENCE_RUN_ID, None
            )
            is not None
        )
        reconciliation_removed = (
            self.repository.robot(serial_number).pop(
                "pending_native_reconciliation", None
            )
            is not None
        ) or bool(self.repository.native_history_saves.get(serial_number))
        reconciliation_removed = stop_owner_removed or reconciliation_removed
        if reconciliation_removed:
            self.repository.reconciliation_removal_pending.add(serial_number)
        self.motion_generations[serial_number] = (
            self.motion_generations.get(serial_number, 0) + 1
        )
        self.managed_motion.pop(serial_number, None)
        active = self.repository.robot(serial_number).get("active_plan")
        if replaced and isinstance(active, Mapping) and active.get("room_id"):
            self.repository.notify_listeners(serial_number)
        return reconciliation_removed

    @contextmanager
    def managed_stop_dispatch(
        self,
        serial_number: str,
        *,
        expected_generation: int | None = None,
        expected_stop_generation: int | None = None,
    ) -> Iterator[None]:
        """Keep an admitted physical Stop scoped to its original owner."""
        token = self.managed_stop_dispatch_transaction.set(
            (serial_number, expected_generation, expected_stop_generation)
        )
        try:
            yield
        finally:
            self.managed_stop_dispatch_transaction.reset(token)

    @callback
    def managed_stop_dispatch_generations(
        self, serial_number: str
    ) -> tuple[int, int] | None:
        """Return the expected generations for this task's managed Stop."""
        dispatch = self.managed_stop_dispatch_transaction.get()
        if (
            dispatch is None
            or dispatch[0] != serial_number
            or dispatch[1] is None
            or dispatch[2] is None
        ):
            return None
        return dispatch[1], dispatch[2]

    @callback
    def reserve_stop_dispatch(
        self,
        serial_number: str,
        *,
        expected_generation: int,
        expected_stop_generation: int,
    ) -> None:
        """Block RESUME until this accepted Stop reaches its dispatch path."""
        self.stop_dispatch_reservations[serial_number] = (
            expected_generation,
            expected_stop_generation,
        )

    @callback
    def release_stop_dispatch(
        self,
        serial_number: str,
        *,
        expected_generation: int,
        expected_stop_generation: int,
    ) -> None:
        """Release only the reservation owned by this Stop request."""
        expected = (expected_generation, expected_stop_generation)
        if self.stop_dispatch_reservations.get(serial_number) == expected:
            self.stop_dispatch_reservations.pop(serial_number, None)

    @callback
    def stop_dispatch_pending(self, serial_number: str) -> bool:
        """Return whether an accepted Stop is still crossing the HA service boundary."""
        return serial_number in self.stop_dispatch_reservations

    async def async_replace_managed_motion(self, serial_number: str) -> int:
        """Persist replacement ownership before its independent command runs."""
        reconciliation_removed = self.replace_managed_motion(serial_number)
        generation = self.motion_generation(serial_number)
        await self.async_persist_reconciliation_removal(
            serial_number, reconciliation_removed
        )
        return generation

    @callback
    def register_run_task(self, serial_number: str) -> None:
        """Tie the current managed run to config-entry lifecycle cleanup."""
        task = asyncio.current_task()
        if task is None:
            raise RuntimeError("managed plan has no current task")
        self.run_tasks[serial_number] = cast(asyncio.Task[None], task)

    @callback
    def unregister_run_task(self, serial_number: str) -> None:
        """Forget only the current run task, preserving a newer replacement."""
        if self.run_tasks.get(serial_number) is asyncio.current_task():
            self.run_tasks.pop(serial_number, None)
        self.cancellation_reasons.pop(serial_number, None)

    @callback
    def register_reconciliation_task(
        self,
        serial_number: str,
        task: asyncio.Task[None],
        *,
        dock: bool = False,
        run_id: str | None = None,
    ) -> None:
        """Tie a late native-completion watcher to this robot's lifecycle."""
        tasks = self.reconciliation_tasks.setdefault(serial_number, set())
        tasks.add(task)
        if dock:
            self.dock_reconciliation_tasks.setdefault(serial_number, set()).add(task)
            self.dock_reconciliation_run_ids.setdefault(serial_number, {})[task] = (
                run_id
            )

        def _discard(done: asyncio.Task[None]) -> None:
            current = self.reconciliation_tasks.get(serial_number)
            if current is None:
                return
            current.discard(done)
            if not current:
                self.reconciliation_tasks.pop(serial_number, None)
            if dock:
                dock_current = self.dock_reconciliation_tasks.get(serial_number)
                if dock_current is not None:
                    dock_current.discard(done)
                if not dock_current:
                    self.dock_reconciliation_tasks.pop(serial_number, None)
                    self.dock_reconciliation_run_ids.pop(serial_number, None)
                    cleanup = (
                        self.dock_scope_cleanups.pop(serial_number, {}).get(run_id)
                        if run_id is not None
                        else None
                    )
                    if cleanup is not None:
                        set_scope, get_scope = cleanup
                        if get_scope is None or get_scope() == run_id:
                            set_scope(None)
                else:
                    run_ids = self.dock_reconciliation_run_ids.get(serial_number)
                    if run_ids is not None:
                        run_ids.pop(done, None)

        task.add_done_callback(_discard)

    @callback
    def dock_reconciliation_active(self, serial_number: str) -> bool:
        """Return whether a dock watcher still owns this robot's scope."""
        return bool(self.dock_reconciliation_tasks.get(serial_number))

    @callback
    def defer_activity_scope_cleanup(
        self,
        serial_number: str,
        run_id: str,
        set_run_id: Callable[[str | None], None],
        get_run_id: Callable[[], str | None] | None,
    ) -> bool:
        """Release a run scope when its specific dock watcher terminates."""
        run_ids = self.dock_reconciliation_run_ids.get(serial_number, {})
        tasks = tuple(
            task
            for task in self.dock_reconciliation_tasks.get(serial_number, ())
            if run_ids.get(task) == run_id
        )
        if not tasks or (get_run_id is not None and get_run_id() not in {None, run_id}):
            return False
        if get_run_id is not None and get_run_id() is None:
            set_run_id(run_id)

        remaining = set(tasks)

        def _release(done: asyncio.Task[None]) -> None:
            remaining.discard(done)
            if not remaining and (get_run_id is None or get_run_id() == run_id):
                set_run_id(None)

        for task in tasks:
            task.add_done_callback(_release)
        self.dock_scope_cleanups.setdefault(serial_number, {})[run_id] = (
            set_run_id,
            get_run_id,
        )
        return True

    @callback
    def cancel_reconciliation_tasks(self, serial_number: str) -> None:
        """Cancel obsolete late-completion watchers without blocking."""
        for task in tuple(self.reconciliation_tasks.pop(serial_number, set())):
            task.cancel()
        self.dock_reconciliation_tasks.pop(serial_number, None)
        self.dock_reconciliation_run_ids.pop(serial_number, None)
        self.dock_scope_cleanups.pop(serial_number, None)

    def cancellation_reason(self, serial_number: str) -> str | None:
        """Return the lifecycle reason attached to the current cancellation."""
        return self.cancellation_reasons.get(serial_number)

    @callback
    def mark_managed_stop(self, serial_number: str) -> None:
        """Authorize an in-flight dock upgrade for a graceful managed stop."""
        self.cancellation_reasons[serial_number] = "managed_stop"

    async def async_cancel_and_wait(
        self, serial_number: str, *, preserve_run: bool = False
    ) -> None:
        """Interrupt a managed run and wait before its client can be closed."""
        task = self.run_tasks.get(serial_number)
        if task is not None and not task.done():
            if self.cancellation_reasons.get(serial_number) not in {
                "managed_stop",
                "motion_replaced",
            }:
                self.cancellation_reasons[serial_number] = (
                    "home_assistant_shutdown" if preserve_run else "config_entry_unload"
                )
            self.finish_room_event(serial_number).clear()
            self.cancellation_event(serial_number).set()
            if task is not asyncio.current_task():
                await asyncio.gather(task, return_exceptions=True)

        reconciliation_tasks = tuple(
            self.reconciliation_tasks.pop(serial_number, set())
        )
        self.dock_reconciliation_tasks.pop(serial_number, None)
        for reconciliation_task in reconciliation_tasks:
            reconciliation_task.cancel()
        if reconciliation_tasks:
            await asyncio.gather(*reconciliation_tasks, return_exceptions=True)

        await self.repository.async_wait_metadata_persistence(serial_number)

    async def async_close_command_admission_and_wait(self, serial_number: str) -> None:
        """Reject new external commands and wait for the current owner to exit."""
        _state, epoch = self.command_admission.get(
            serial_number, _OPEN_COMMAND_ADMISSION
        )
        self.command_admission[serial_number] = ("closed", epoch + 1)
        async with self.command_lock(serial_number):
            pass

    @callback
    def begin_command_teardown(self, serial_number: str) -> None:
        """Fence external commands while current managed work settles."""
        state, epoch = self.command_admission.get(
            serial_number, _OPEN_COMMAND_ADMISSION
        )
        if state == "open":
            self.command_admission[serial_number] = ("managed_only", epoch + 1)

    @callback
    def command_admission_open(self, serial_number: str) -> bool:
        """Return whether an external command may dispatch for this entry."""
        return (
            self.command_admission.get(serial_number, _OPEN_COMMAND_ADMISSION)[0]
            == "open"
            and serial_number not in self.repository.removed_robots
        )

    @callback
    def command_admission_epoch(self, serial_number: str) -> int:
        """Return the current epoch for binding an admitted dispatch."""
        return self.command_admission.get(serial_number, _OPEN_COMMAND_ADMISSION)[1]

    def require_command_admission(
        self,
        serial_number: str,
        *,
        managed_owner: bool = False,
        expected_epoch: int | None = None,
    ) -> None:
        """Raise when a command reaches dispatch after its owner has closed."""
        admission, epoch = self.command_admission.get(
            serial_number, _OPEN_COMMAND_ADMISSION
        )
        if (
            (expected_epoch is not None and expected_epoch != epoch)
            or serial_number in self.repository.removed_robots
            or admission == "closed"
            or (admission == "managed_only" and not managed_owner)
        ):
            raise HomeAssistantError("Matic commands are unavailable during unload")

    @asynccontextmanager
    async def external_command(self, serial_number: str) -> AsyncIterator[None]:
        """Admit one external command while holding its dispatch lock."""
        _admission, epoch = self.command_admission.get(
            serial_number, _OPEN_COMMAND_ADMISSION
        )
        self.require_command_admission(serial_number, expected_epoch=epoch)
        async with self.command_lock(serial_number):
            self.require_command_admission(serial_number, expected_epoch=epoch)
            yield

    @callback
    def reopen_metadata_admission(self, serial_number: str) -> None:
        """Reopen command and metadata admission after a failed config-entry unload."""
        self.repository.metadata_admission_closed.discard(serial_number)
        _state, epoch = self.command_admission.get(
            serial_number, _OPEN_COMMAND_ADMISSION
        )
        self.command_admission[serial_number] = ("open", epoch + 1)

    @callback
    def activate_robot(self, serial_number: str) -> int:
        """Clear removal state when a config entry activates this robot."""
        self.repository.removed_robots.discard(serial_number)
        self.repository.metadata_admission_closed.discard(serial_number)
        _state, epoch = self.command_admission.get(
            serial_number, _OPEN_COMMAND_ADMISSION
        )
        self.command_admission[serial_number] = ("open", epoch + 1)
        generation = self.robot_generations.get(serial_number, 0) + 1
        self.robot_generations[serial_number] = generation
        return generation

    def robot_generation(self, serial_number: str) -> int:
        """Return the current config-entry generation for a robot."""
        return self.robot_generations.get(serial_number, 0)

    @asynccontextmanager
    async def external_motion(
        self,
        serial_number: str,
        *,
        expected_generation: int | None = None,
        expected_stop_generation: int | None = None,
    ) -> AsyncIterator[int | None]:
        """Replace managed ownership only for an admitted, current command."""
        _admission, epoch = self.command_admission.get(
            serial_number, _OPEN_COMMAND_ADMISSION
        )
        self.require_command_admission(serial_number, expected_epoch=epoch)
        async with self.command_lock(serial_number):
            self.require_command_admission(serial_number, expected_epoch=epoch)
            if (
                expected_generation is not None
                and self.motion_generation(serial_number) != expected_generation
            ) or (
                expected_stop_generation is not None
                and self.stop_request_generation(serial_number)
                != expected_stop_generation
            ):
                yield None
            else:
                reconciliation_removed = self.replace_managed_motion(serial_number)
                generation = self.motion_generation(serial_number)
                await self.async_persist_reconciliation_removal(
                    serial_number, reconciliation_removed
                )
                yield generation

    @asynccontextmanager
    async def managed_command(
        self,
        serial_number: str,
        token: int,
        *,
        teardown_cleanup: bool = False,
    ) -> AsyncIterator[None]:
        """Serialize a plan command and reject a superseded generation."""
        async with self.command_lock(serial_number):
            self.require_command_admission(
                serial_number, managed_owner=teardown_cleanup
            )
            if not self.managed_motion_is_current(serial_number, token):
                raise ManagedMotionReplacedError("managed motion was replaced")
            reconciliation_removed = (
                self.repository.robot(serial_number).pop(
                    "pending_native_reconciliation", None
                )
                is not None
            )
            await self.async_persist_reconciliation_removal(
                serial_number, reconciliation_removed
            )
            self.require_command_admission(
                serial_number, managed_owner=teardown_cleanup
            )
            if not self.managed_motion_is_current(serial_number, token):
                raise ManagedMotionReplacedError("managed motion was replaced")
            yield

    @asynccontextmanager
    async def managed_reconciliation(
        self, serial_number: str, token: int
    ) -> AsyncIterator[bool]:
        """Serialize a late-completion marker and report current ownership."""
        async with self.command_lock(serial_number):
            yield self.managed_motion_is_current(serial_number, token)

    def cancellation_event(self, serial_number: str) -> asyncio.Event:
        """Return the cancellation signal for the current managed run."""
        return self.cancel_events.setdefault(serial_number, asyncio.Event())

    def finish_room_event(self, serial_number: str) -> asyncio.Event:
        """Return the graceful-stop signal for the current managed run."""
        return self.finish_room_events.setdefault(serial_number, asyncio.Event())

    @callback
    def prepare_run(self, serial_number: str) -> asyncio.Event:
        """Clear and return the cancellation signal for a new managed run."""
        event = self.cancellation_event(serial_number)
        event.clear()
        self.cancellation_reasons.pop(serial_number, None)
        self.finish_room_event(serial_number).clear()
        return event

    @callback
    def cancel(self, serial_number: str) -> bool:
        """Request cancellation and report whether a plan is active."""
        if not self.lock(serial_number).locked():
            return False
        self.finish_room_event(serial_number).clear()
        self.cancellation_event(serial_number).set()
        return True

    @callback
    def request_stop(
        self, serial_number: str, *, stop_now: bool = False
    ) -> PlanStopDecision:
        """Apply the active plan's immediate-or-after-room stop policy."""
        self.stop_request_generations[serial_number] = (
            self.stop_request_generation(serial_number) + 1
        )

        def fence_new_motion() -> None:
            self.motion_generations[serial_number] = (
                self.motion_generation(serial_number) + 1
            )

        if stop_now:
            robot = self.repository.robot(serial_number)
            active = robot.get("active_plan")
            last_run = robot.get("last_run")
            checkpoint = (
                last_run.get("recovery_checkpoint")
                if isinstance(last_run, Mapping)
                and last_run.get("outcome") == "running"
                and isinstance(active, Mapping)
                and last_run.get("run_id") == active.get("run_id")
                else None
            )
            if (
                not isinstance(active, Mapping)
                or not (active.get("room_id") or active.get("area_id"))
                or active.get("status") == "verifying"
                or not isinstance(checkpoint, Mapping)
                or checkpoint.get("stop_intent") != "after_room"
                or not self.finish_room_event(serial_number).is_set()
                or self.cancellation_reason(serial_number) == "motion_replaced"
            ):
                # The current room may have completed between the UI read and
                # the explicit override. Keep the accepted graceful stop and
                # let its existing dock path finish without a duplicate dock.
                return PlanStopDecision("after_room")

        # Fence undispatched direct starts/resumes even if no managed lock is
        # held yet. A graceful stop keeps the current managed owner intact so
        # its active room can reach the room-boundary STOP.
        if not self.lock(serial_number).locked():
            fence_new_motion()
            if stop_now:
                self.finish_room_event(serial_number).clear()
                self.cancellation_event(serial_number).set()
                self.cancellation_reasons[serial_number] = "managed_stop"
                return PlanStopDecision("immediate")
            if self.recovery_run(serial_number) is not None:
                self.cancellation_event(serial_number).set()
                self.cancellation_reasons[serial_number] = "managed_stop"
                return PlanStopDecision("immediate")
            return PlanStopDecision("not_running")

        robot = self.repository.robot(serial_number)
        active = robot.get("active_plan")
        if active is None:
            fence_new_motion()
            self.cancel(serial_number)
            self.cancellation_reasons.setdefault(serial_number, "managed_stop")
            return PlanStopDecision("immediate")
        if self.cancellation_reasons.get(serial_number) == "motion_replaced":
            # An external command may already have replaced this persisted
            # plan's owner while its executor is still unwinding. In that
            # interval the active-plan snapshot is stale: honoring its
            # after-room policy would return without stopping the new owner.
            fence_new_motion()
            self.cancel(serial_number)
            return PlanStopDecision("immediate")
        if stop_now:
            fence_new_motion()
            self.finish_room_event(serial_number).clear()
            self.cancellation_event(serial_number).set()
            self.cancellation_reasons[serial_number] = "managed_stop"
            return PlanStopDecision("immediate")
        if self.finish_room_event(serial_number).is_set():
            return PlanStopDecision("after_room")
        frozen_policy = active if _has_frozen_stop_policy(active) else None
        last_run = robot.get("last_run")
        checkpoint = (
            last_run.get("recovery_checkpoint")
            if isinstance(last_run, Mapping)
            and last_run.get("run_id") == active.get("run_id")
            else None
        )
        if frozen_policy is None and _has_frozen_stop_policy(checkpoint):
            frozen_policy = checkpoint
        if frozen_policy is None:
            frozen_policy = robot["plans"].get(active["plan_id"], {})
        finish_current_room, threshold = _managed_stop_policy(frozen_policy)
        if not finish_current_room:
            fence_new_motion()
            self.cancel(serial_number)
            self.cancellation_reasons.setdefault(serial_number, "managed_stop")
            return PlanStopDecision("immediate")
        if "room_id" not in active:
            # A custom area has no duration history to estimate progress from,
            # so finishing the current entry means finishing the area.
            self.cancellation_event(serial_number).clear()
            self.finish_room_event(serial_number).set()
            return PlanStopDecision("after_room", None, threshold)
        progress = plan_timing._room_timing(robot, active, dt_util.utcnow())[
            "estimated_percent"
        ]
        if progress is not None and progress < threshold:
            fence_new_motion()
            self.cancel(serial_number)
            self.cancellation_reasons.setdefault(serial_number, "managed_stop")
            return PlanStopDecision("immediate", progress, threshold)

        self.cancellation_event(serial_number).clear()
        self.finish_room_event(serial_number).set()
        return PlanStopDecision("after_room", progress, threshold)

    def recovery_run(self, serial_number: str) -> dict[str, Any] | None:
        """Return private local recovery state, never exposed by entity snapshots."""
        run = self.repository.robot(serial_number).get("last_run")
        if isinstance(run, dict) and run.get("outcome") == "running":
            if isinstance(run.get("recovery_checkpoint"), dict):
                return deepcopy(run)
        return None

    async def async_persist_reconciliation_removal(
        self, serial_number: str, removed: bool
    ) -> None:
        """Save a durable-marker removal before replacement motion dispatches."""
        pending_saves = tuple(
            self.repository.native_history_saves.get(serial_number, ())
        )
        if removed or pending_saves:
            self.repository.reconciliation_removal_pending.add(serial_number)
        if serial_number in self.repository.reconciliation_removal_pending:
            for done in pending_saves:
                await done.wait()
            # A failed same-generation import can restore its marker while
            # this command waits. Remove it again before persisting ownership.
            self.repository.robot(serial_number).pop(
                "pending_native_reconciliation", None
            )
            await self.repository.async_save_and_notify(serial_number)
            self.repository.reconciliation_removal_pending.discard(serial_number)
