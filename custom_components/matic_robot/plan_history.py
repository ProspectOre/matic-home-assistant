"""Read projections and duration estimates for managed cleaning history."""

from __future__ import annotations

from collections.abc import Sequence
from copy import deepcopy
from typing import Any

from homeassistant.util import dt as dt_util

from . import plan_timing
from .client import CleaningSessionRecord
from .map_schema import RunEntry
from .plan_catalog import PlanCatalog
from .plan_model import (
    is_manual_room_sequence_plan_id,
    plan_setting,
    stored_count,
)
from .plan_records import ActivePlan
from .plan_repository import (
    PlanRepository,
)
from .plan_schema import RunSummary
from .run_control import (
    RunControl,
)
from .run_history import history_entries


def _room_fields(active: ActivePlan) -> dict[str, Any]:
    return {
        "run_id": active.run_id,
        "room_id": active.room_id,
        "room": active.room,
        "status": active.status,
    }


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

    def _confirmed_room(self, serial_number: str) -> ActivePlan | None:
        """Return the active plan when it is the running run's confirmed room."""
        active = self.repository.active_plan(serial_number)
        run = self.repository.last_run(serial_number)
        if (
            active is None
            or run is None
            or not run.running
            or not active.room_id
            or not active.run_id
            or run.run_id != active.run_id
            or run.plan_id != active.plan_id
            or self.control.cancellation_reason(serial_number) == "motion_replaced"
            or active.status not in {"running", "suspended"}
            or active.cleaning_started is None
        ):
            return None
        return active

    def current_room(self, serial_number: str) -> dict[str, Any] | None:
        """Return the confirmed managed room's run, room and status, or None."""
        active = self._confirmed_room(serial_number)
        return _room_fields(active) if active is not None else None

    def current_room_timing(self, serial_number: str) -> dict[str, Any] | None:
        """Read the canonical active-time estimate for the confirmed managed room.

        This read never learns history, advances completion or writes storage.
        Stop uses the same calculation, including its unknown-baseline fallback.
        """
        active = self._confirmed_room(serial_number)
        if active is None:
            return None
        return {
            **_room_fields(active),
            **plan_timing.room_timing(
                self.repository.robot(serial_number), active, dt_util.utcnow()
            ),
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
            manual=is_manual_room_sequence_plan_id,
        )

    def run_summary(self, serial_number: str) -> RunSummary | None:
        """Summarize the stored run; only the running run has a target or phase."""
        run = self.repository.last_run(serial_number)
        if run is None:
            return None
        active = self.repository.active_plan(serial_number)
        target = (
            active.target
            if run.running and active is not None and active.run_id == run.run_id
            else None
        )
        summary: RunSummary = {
            "run_id": run.run_id,
            "outcome": run.outcome,
            "completed_room_count": run.completed_room_count,
            "room_count": run.room_count,
            "target": target,
            "smart_stop_phase": self.control.smart_stop_phase(serial_number),
        }
        return summary

    def snapshot(self, serial_number: str) -> dict[str, Any]:
        """Return compact, automation-friendly plan and room history state."""
        robot = self.repository.robot(serial_number)
        records = [
            record
            for rotation in robot["rotations"].values()
            for record in rotation["rooms"].values()
        ]
        completed_runs = sum(stored_count(item, "completed_runs") for item in records)
        failed_runs = sum(stored_count(item, "failed_runs") for item in records)
        cancelled_runs = sum(stored_count(item, "cancelled_runs") for item in records)
        interrupted_runs = sum(
            stored_count(item, "interrupted_runs") for item in records
        )
        suspended_runs = sum(stored_count(item, "suspended_runs") for item in records)
        unverified_runs = sum(stored_count(item, "unverified_runs") for item in records)
        skipped_runs = sum(stored_count(item, "skipped_runs") for item in records)
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
                "enabled": plan_setting(plan, "enabled"),
                "room_count": len(plan.get("rooms", [])),
            }
            for plan_id, plan in robot["plans"].items()
        }
        smart_stop = self.control.smart_stop_phase(serial_number)
        active = self.repository.active_plan(serial_number)
        last_run = self.repository.last_run(serial_number)
        active_plan: dict[str, Any] | None = None
        if active is not None:
            active_plan = active.published()
            active_plan["active_elapsed_seconds"] = plan_timing.active_elapsed_seconds(
                active, dt_util.utcnow()
            )
        elif smart_stop is not None and last_run is not None:
            # Smart Stop docks after the run's last room or area ended.
            active_plan = {
                "run_id": last_run.run_id,
                "plan_id": last_run.plan_id,
                "plan_name": last_run.plan_name,
                "status": "returning_to_dock",
                "active_elapsed_seconds": 0,
            }
        if active_plan is not None:
            active_plan["smart_stop_pending"] = smart_stop is not None
            if smart_stop is not None:
                active_plan["smart_stop_phase"] = smart_stop
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
                    "runs": stored_count(room, "completed_runs"),
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
            "last_run": last_run.published() if last_run is not None else None,
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
            history = plan_timing.compatible_duration_history(
                robot,
                room_id,
                {
                    "cleaning_mode": cleaning_mode,
                    "coverage_setting": coverage_setting,
                },
            )
            expected = plan_timing.expected_duration(
                {"duration_history_seconds": history}
            )
            if expected is None:
                return None
            total += expected
        return total
