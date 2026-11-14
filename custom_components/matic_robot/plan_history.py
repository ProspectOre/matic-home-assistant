"""Read projections and duration estimates for managed cleaning history."""

from __future__ import annotations

from collections.abc import (
    Mapping,
    Sequence,
)
from copy import deepcopy
from typing import Any

from homeassistant.util import dt as dt_util

from . import plan_timing
from .client import CleaningSessionRecord
from .map_schema import RunEntry
from .plan_catalog import PlanCatalog
from .plan_model import (
    _is_manual_room_sequence_plan_id,
)
from .plan_repository import (
    PlanRepository,
)
from .run_control import (
    RunControl,
)
from .run_history import history_entries


class PlanHistory:
    """Project shared run state without writing accounting or recovery records."""

    def __init__(
        self,
        repository: PlanRepository,
        catalog: PlanCatalog,
        control: RunControl,
    ) -> None:
        self.repository = repository
        self.catalog = catalog
        self.control = control

    def current_room_timing(self, serial_number: str) -> dict[str, Any] | None:
        """Read the canonical active-time estimate for a confirmed managed room.

        This read never learns history, advances completion or writes storage.
        Stop uses the same calculation, including its unknown-baseline fallback.
        """
        robot = self.repository.robot(serial_number)
        active = robot.get("active_plan")
        run = robot.get("last_run")
        if (
            not isinstance(active, Mapping)
            or not isinstance(run, Mapping)
            or not isinstance(active.get("room_id"), str)
            or not active["room_id"]
            or not isinstance(active.get("run_id"), str)
            or not active["run_id"]
            or run.get("run_id") != active["run_id"]
            or run.get("plan_id") != active.get("plan_id")
            or run.get("outcome") != "running"
            or self.control.cancellation_reason(serial_number) == "motion_replaced"
            or active.get("status") not in {"running", "suspended"}
            or not isinstance(active.get("cleaning_started"), str)
        ):
            return None
        return {
            "run_id": active["run_id"],
            "room_id": active["room_id"],
            "room": active.get("room"),
            "status": active["status"],
            **plan_timing._room_timing(robot, active, dt_util.utcnow()),
        }

    def run_history(
        self,
        serial_number: str,
        native: Sequence[CleaningSessionRecord] = (),
    ) -> list[RunEntry]:
        """Return recent runs, newest first, with robot-started sessions merged in."""
        return history_entries(
            self.repository.robot(serial_number),
            native,
            manual=_is_manual_room_sequence_plan_id,
        )

    def snapshot(self, serial_number: str) -> dict[str, Any]:
        """Return compact, automation-friendly plan and room history state."""
        robot = self.repository.robot(serial_number)
        records = [
            record
            for rotation in robot["rotations"].values()
            for record in rotation["rooms"].values()
        ]
        completed_runs = sum(
            plan_timing._stored_count(item, "completed_runs") for item in records
        )
        failed_runs = sum(
            plan_timing._stored_count(item, "failed_runs") for item in records
        )
        cancelled_runs = sum(
            plan_timing._stored_count(item, "cancelled_runs") for item in records
        )
        interrupted_runs = sum(
            plan_timing._stored_count(item, "interrupted_runs") for item in records
        )
        suspended_runs = sum(
            plan_timing._stored_count(item, "suspended_runs") for item in records
        )
        unverified_runs = sum(
            plan_timing._stored_count(item, "unverified_runs") for item in records
        )
        skipped_runs = sum(
            plan_timing._stored_count(item, "skipped_runs") for item in records
        )
        last_completed = max(
            (
                str(item["last_completed"])
                for item in records
                if item.get("last_completed")
            ),
            default=None,
        )
        plans = {
            plan_id: {
                "name": plan.get("name", plan_id),
                "enabled": plan.get("enabled", True),
                "room_count": len(plan.get("rooms", [])),
            }
            for plan_id, plan in robot["plans"].items()
        }
        last_run = robot.get("last_run")
        checkpoint = (
            last_run.get("recovery_checkpoint")
            if isinstance(last_run, Mapping) and last_run.get("outcome") == "running"
            else None
        )
        pending_smart_stop = bool(
            isinstance(last_run, Mapping)
            and isinstance(last_run.get("run_id"), str)
            and isinstance(checkpoint, Mapping)
            and checkpoint.get("stop_intent") == "after_room"
            and self.control.finish_room_event(serial_number).is_set()
            and self.control.cancellation_reason(serial_number) != "motion_replaced"
        )
        active_plan = deepcopy(robot.get("active_plan"))
        if (
            pending_smart_stop
            and isinstance(last_run, Mapping)
            and isinstance(last_run.get("run_id"), str)
            and not isinstance(active_plan, dict)
        ):
            active_plan = {
                "run_id": last_run["run_id"],
                "plan_id": last_run.get("plan_id"),
                "plan_name": last_run.get("plan_name"),
                "status": "returning_to_dock",
            }
        if isinstance(active_plan, dict):
            active_plan["active_elapsed_seconds"] = plan_timing._active_elapsed_seconds(
                active_plan, dt_util.utcnow()
            )
            active_plan["smart_stop_pending"] = bool(
                pending_smart_stop
                and isinstance(last_run, Mapping)
                and active_plan.get("run_id") == last_run.get("run_id")
            )
            if active_plan["smart_stop_pending"]:
                active_plan["smart_stop_phase"] = (
                    "verifying_completion"
                    if active_plan.get("status") == "verifying"
                    else "finishing_room"
                    if isinstance(active_plan.get("room_id"), str)
                    else "finishing_area"
                    if isinstance(active_plan.get("area_id"), str)
                    else "returning_to_dock"
                )
        public_last_run = deepcopy(robot.get("last_run"))
        if isinstance(public_last_run, dict):
            public_last_run.pop("recovery_checkpoint", None)
        return {
            "completed_runs": completed_runs,
            "failed_runs": failed_runs,
            "cancelled_runs": cancelled_runs,
            "interrupted_runs": interrupted_runs,
            "suspended_runs": suspended_runs,
            "unverified_runs": unverified_runs,
            "skipped_runs": skipped_runs,
            "last_completed": last_completed,
            "last_completed_by_room": {
                room_id: {
                    "name": room.get("name"),
                    "at": room.get("last_completed"),
                    "duration_seconds": room.get("last_duration_seconds"),
                    "runs": plan_timing._stored_count(room, "completed_runs"),
                }
                for room_id, room in robot["rooms"].items()
            },
            "robot_reported_completed_by_room": {
                room_id: {
                    "name": room.get("name"),
                    "at": room.get("robot_last_completed"),
                    "duration_seconds": room.get("robot_last_duration_seconds"),
                    "floor_mission_id": room.get(
                        "robot_last_floor_id", room.get("robot_last_invalid_floor_id")
                    ),
                    "started_at": room.get("robot_last_session_started_at"),
                    "source": (
                        "robot_native_mode_result_room_name_match"
                        if isinstance(room.get("robot_last_completed"), str)
                        else "robot_native_mode_result_managed_session"
                        if room.get("robot_last_invalid_source") == "managed_session"
                        else "robot_native_mode_result_ambiguous"
                    ),
                    "excluded_modes": room.get("robot_last_conflicted_modes", []),
                }
                for room_id, room in robot["rooms"].items()
                if isinstance(room.get("robot_last_completed"), str)
                or isinstance(room.get("robot_last_invalidated_at"), str)
            },
            "native_reconciliation_pending": isinstance(
                robot.get("pending_native_reconciliation"), dict
            ),
            "plans": plans,
            "plan_history": deepcopy(robot["rotations"]),
            "selected_plan": robot.get("selected_plan"),
            "selected_plan_name": self.catalog.plan_name(
                serial_number, robot.get("selected_plan")
            ),
            "selected_area": robot.get("selected_area"),
            "selected_area_name": self.catalog.area_name(
                serial_number, robot.get("selected_area")
            ),
            "active_plan": active_plan,
            "last_interrupted_plan": deepcopy(robot.get("last_interrupted_plan")),
            "last_run": public_last_run,
        }

    def next_run_estimate_seconds(
        self, serial_number: str, rooms: Sequence[tuple[str, str, str]]
    ) -> int | None:
        """Sum confident per-room medians at the settings the next run uses."""
        if not rooms:
            return None
        robot = self.repository.robot(serial_number)
        total = 0
        for room_id, cleaning_mode, coverage_setting in rooms:
            history = plan_timing._compatible_duration_history(
                robot,
                room_id,
                {
                    "cleaning_mode": cleaning_mode,
                    "coverage_setting": coverage_setting,
                },
            )
            expected = plan_timing._expected_duration(
                {"duration_history_seconds": history}
            )
            if expected is None:
                return None
            total += expected
        return total
