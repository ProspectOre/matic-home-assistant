"""Durable, named, room-aware cleaning plans for Matic robots."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import (
    Callable,
    Mapping,
)
from copy import deepcopy
from typing import cast

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from . import native_history, plan_storage
from .const import (
    DATA_PLAN_MANAGER,
    DOMAIN,
)
from .plan_cadence import (
    PlanCadence,
)
from .plan_catalog import PlanCatalog
from .plan_ledger import (
    PlanLedger,
    _close_unfinished_area_records,
    _close_unfinished_room_records,
)
from .plan_repository import (
    PlanRepository,
    _MetadataLockLease,
)
from .run_control import (
    RunControl,
)

_LOGGER = logging.getLogger(__name__)


class CleaningPlanManager:
    """Compose plan storage, policy, run control and durable accounting."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.repository = PlanRepository(hass)
        self.cadence = PlanCadence(self.repository)
        self.catalog = PlanCatalog(self.cadence, self.repository)
        self.control = RunControl(self.repository)
        self.ledger = PlanLedger(
            self.cadence, self.catalog, self.control, self.repository
        )

    async def async_load(self) -> None:
        """Load current room-native state and recover interrupted work."""
        stored = await self.repository.store.async_load()
        self.repository.data = (
            stored if isinstance(stored, dict) else self.repository.empty_data()
        )

        recovered = stored is not None and not isinstance(stored, dict)
        robots = self.repository.data.get("robots")
        if not isinstance(robots, dict):
            robots = {}
            self.repository.data["robots"] = robots
            recovered = True
        for serial_number, robot in tuple(robots.items()):
            if not isinstance(robot, dict):
                robots.pop(serial_number)
                recovered = True
                continue
            recovered = plan_storage._normalize_robot(robot) or recovered
            last_run = robot.get("last_run")
            if isinstance(last_run, dict) and last_run.get("outcome") == "running":
                if not isinstance(last_run.get("recovery_checkpoint"), dict):
                    last_run.update(
                        {
                            "outcome": "unverified",
                            "reason_code": "home_assistant_restart",
                            "cause": "home_assistant",
                            "ended_at": None,
                            "recovered_at": dt_util.utcnow().isoformat(),
                        }
                    )
                    recovered = True
                else:
                    last_run.update(
                        {
                            "reason_code": "home_assistant_restart",
                            "cause": "home_assistant",
                            "recovery_status": "recovering",
                            "recovered_at": dt_util.utcnow().isoformat(),
                        }
                    )
                    recovered = True
            fence_value = robot.get(plan_storage.STOP_FENCE_EXPIRES_AT)
            fence_remaining = native_history._stop_fence_remaining_seconds(fence_value)
            if fence_value is not None:
                if fence_remaining is None or fence_remaining <= 0:
                    robot.pop(plan_storage.STOP_FENCE_EXPIRES_AT, None)
                    robot.pop(plan_storage.STOP_FENCE_RUN_ID, None)
                    fence_remaining = None
                    recovered = True
                else:
                    self.control.arm_stop_pending(str(serial_number), fence_remaining)
            pending = native_history._validated_native_reconciliation(
                robot.get("pending_native_reconciliation")
            )
            if pending is not None:
                remaining = native_history._native_reconciliation_remaining_seconds(
                    pending
                )
                if remaining <= 0:
                    robot.pop("pending_native_reconciliation", None)
                    recovered = True
                else:
                    self.control.arm_stop_pending(str(serial_number), remaining)
                    if fence_remaining is None or remaining > fence_remaining:
                        robot[plan_storage.STOP_FENCE_EXPIRES_AT] = pending[
                            "expires_at"
                        ]
                        fence_remaining = remaining
                        recovered = True
            active = robot.get("active_plan")
            recoverable = (
                isinstance(last_run, dict)
                and last_run.get("outcome") == "running"
                and isinstance(last_run.get("recovery_checkpoint"), dict)
            )
            if recoverable and isinstance(last_run, dict):
                checkpoint = last_run["recovery_checkpoint"]
                if checkpoint.get("stop_intent") == "after_room":
                    self.control.finish_room_event(str(serial_number)).set()
                room_records = checkpoint.get("rooms", [])
                self.cadence.restore_prepared_run(
                    str(serial_number),
                    str(last_run["plan_id"]),
                    str(last_run["run_id"]),
                    [
                        str(room["room_id"])
                        for room in room_records
                        if isinstance(room, Mapping) and room.get("room_id")
                    ],
                    checkpoint.get("cadence_by_room")
                    if isinstance(checkpoint.get("cadence_by_room"), Mapping)
                    else None,
                    finish_current_room=(
                        checkpoint.get("finish_current_room")
                        if isinstance(checkpoint.get("finish_current_room"), bool)
                        else None
                    ),
                    finish_current_room_threshold=(
                        checkpoint.get("finish_current_room_threshold")
                        if isinstance(
                            checkpoint.get("finish_current_room_threshold"), int
                        )
                        and not isinstance(
                            checkpoint.get("finish_current_room_threshold"), bool
                        )
                        else None
                    ),
                )
            if (
                active
                and recoverable
                and isinstance(last_run, dict)
                and active.get("run_id") == last_run.get("run_id")
                and active.get("plan_id") == last_run.get("plan_id")
            ):
                active["status"] = "recovering"
                recovered = True
            elif active:
                if "room_id" in active:
                    # A custom area keeps no per-room record to interrupt.
                    rotation = robot["rotations"].setdefault(
                        active["plan_id"], {"rooms": {}}
                    )
                    record = rotation["rooms"].setdefault(active["room_id"], {})
                    record.update(
                        {
                            "last_result": "interrupted",
                            "last_interrupted": dt_util.utcnow().isoformat(),
                            "last_error": (
                                "Home Assistant restarted while cleaning this room"
                            ),
                        }
                    )
                robot["last_interrupted_plan"] = deepcopy(active)
                robot["active_plan"] = None
                recovered = True
            if not recoverable and _close_unfinished_room_records(
                robot, recovered_at=dt_util.utcnow().isoformat()
            ):
                recovered = True
            if not recoverable and _close_unfinished_area_records(
                robot, ended_at=dt_util.utcnow().isoformat()
            ):
                recovered = True
        if recovered:
            async with self.repository.store_lock:
                await self.repository.store.async_save(self.repository.data)

    async def async_remove_robot(self, serial_number: str) -> None:
        """Cancel work and erase one robot's private persisted planning data."""
        self.repository.removed_robots.add(serial_number)
        await self.control.async_cancel_and_wait(serial_number)
        await self.control.async_close_command_admission_and_wait(serial_number)
        await self.repository.async_close_metadata_admission_and_wait(serial_number)
        for done in tuple(self.repository.native_history_saves.get(serial_number, ())):
            await done.wait()

        async def commit(_lease: _MetadataLockLease) -> bool:
            async with self.repository.store_lock:
                robots = self.repository.data.get("robots")
                if isinstance(robots, dict):
                    removed = robots.pop(serial_number, None)
                    if removed is not None:
                        try:
                            await self.repository.store.async_save(self.repository.data)
                        except BaseException:
                            robots[serial_number] = removed
                            raise
                        return True
                return False

        def forget_runtime_state(_removed: bool) -> None:
            self.repository.listeners.pop(serial_number, None)
            self.control.stop_fences.pop(serial_number, None)
            self.control.stop_dispatch_reservations.pop(serial_number, None)
            self.repository.reconciliation_removal_pending.discard(serial_number)
            self.cadence.prepared_runs.pop(serial_number, None)
            self.cadence.pending_cadence_mutations.pop(serial_number, None)

        await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(
                self.repository.native_history_lock(serial_number),
                self.control.lock(serial_number),
                self.control.command_lock(serial_number),
            ),
            after_commit=forget_runtime_state,
            allow_removed=True,
            allow_closed=True,
        )


async def async_get_plan_manager(
    hass: HomeAssistant,
    *,
    manager_factory: Callable[[HomeAssistant], CleaningPlanManager] | None = None,
) -> CleaningPlanManager:
    """Return the shared plan manager, publishing it before storage load awaits."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    lock = domain_data.setdefault("_plan_manager_init_lock", asyncio.Lock())
    async with lock:
        manager = domain_data.get(DATA_PLAN_MANAGER)
        if manager is not None:
            return cast(CleaningPlanManager, manager)
        manager = (manager_factory or CleaningPlanManager)(hass)
        domain_data[DATA_PLAN_MANAGER] = manager
        try:
            await manager.async_load()
        except BaseException:
            if domain_data.get(DATA_PLAN_MANAGER) is manager:
                domain_data.pop(DATA_PLAN_MANAGER, None)
            raise
        return manager
