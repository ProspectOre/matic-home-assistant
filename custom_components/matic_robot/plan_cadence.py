"""Cadence policy, progress and reservations for prepared cleaning runs."""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import (
    Iterable,
    Mapping,
    MutableMapping,
    Sequence,
)
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, cast

from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError

from . import native_history, plan_timing
from .cadence import (
    CoverageCadenceRequiresVacuumError,
    cadence_snapshot,
    normalize_cadence_policy,
)
from .plan_model import (
    CleaningRoom,
    SharedRoomScheduleLockedError,
    SharedRoomScheduleMapChangedError,
    SharedRoomScheduleStaleError,
    _bounded_stop_threshold,
    _managed_stop_policy,
)
from .plan_repository import (
    PlanRepository,
    _MetadataLockLease,
)

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class _PreparedRunReservation:
    """Freeze every policy that governs one queued managed run."""

    plan_id: str
    run_id: str
    rooms: Mapping[str, tuple[str, str | None]]
    shared_schedule_rooms: frozenset[str]
    finish_current_room: bool
    finish_current_room_threshold: int


@dataclass(frozen=True, slots=True)
class _CadenceMutation:
    """Describe the persisted cadence rows currently being written."""

    plan_id: str
    plan_room_ids: frozenset[str]
    shared_room_ids: frozenset[str]
    deletes_plan: bool = False


def _unverified_cadence_modes(record: object, policy: Mapping[str, Any]) -> list[str]:
    """Return active cadence modes whose persisted progress needs owner reset."""
    raw_modes = record.get("unverified_modes") if isinstance(record, Mapping) else None
    if not isinstance(raw_modes, list):
        return []
    stored = {
        mode
        for mode in raw_modes
        if isinstance(mode, str) and mode in ("mop", "coverage")
    }
    return [
        mode
        for mode, field in (("mop", "mop_every_n"), ("coverage", "coverage_every_n"))
        if mode in stored and policy.get(field) is not None
    ]


class PlanCadence:
    """Select cleaning cadence while guarding in-flight run reservations."""

    def __init__(self, repository: PlanRepository) -> None:
        self.repository = repository
        self.prepared_runs: dict[str, _PreparedRunReservation] = {}
        self.pending_cadence_mutations: dict[str, dict[object, _CadenceMutation]] = {}

    @callback
    def reserve_prepared_run(
        self,
        serial_number: str,
        plan_id: str,
        run_id: str,
        room_ids: Iterable[str],
        cadence_by_room: Mapping[str, Mapping[str, Any]] | None = None,
        *,
        finish_current_room: bool | None = None,
        finish_current_room_threshold: int | None = None,
    ) -> None:
        """Reserve queued room cadence before the executor's first await."""
        existing = self.prepared_runs.get(serial_number)
        if existing is not None:
            if existing.run_id == run_id:
                return
            raise HomeAssistantError("A managed cadence run already owns the robot")
        plan = self.repository.robot(serial_number)["plans"].get(plan_id, {})
        stop_enabled, stop_threshold = _managed_stop_policy(plan)
        if finish_current_room is not None:
            stop_enabled = finish_current_room
        if finish_current_room_threshold is not None:
            stop_threshold = _bounded_stop_threshold(finish_current_room_threshold)
        normalized_room_ids = tuple(dict.fromkeys(str(room_id) for room_id in room_ids))
        snapshots = cadence_by_room if isinstance(cadence_by_room, Mapping) else {}
        plan_rooms = {
            str(room.get("room_id")): room
            for room in plan.get("rooms", [])
            if isinstance(room, Mapping) and room.get("room_id")
        }
        reservations: dict[str, tuple[str, str | None]] = {}
        shared_schedule_rooms: set[str] = set()
        for room_id in normalized_room_ids:
            raw = plan_rooms.get(room_id, {})
            policy = raw.get("cadence") if isinstance(raw, Mapping) else None
            snapshot = snapshots.get(room_id)
            scope = snapshot.get("scope") if isinstance(snapshot, Mapping) else None
            if scope not in {"plan", "shared"}:
                scope = (
                    policy.get("scope")
                    if isinstance(policy, Mapping)
                    and policy.get("scope") in {"plan", "shared"}
                    else "plan"
                )
            identity = (
                snapshot.get("identity") if isinstance(snapshot, Mapping) else None
            )
            if not isinstance(identity, str):
                identity = (
                    raw.get("cadence_identity")
                    if isinstance(raw, Mapping)
                    and isinstance(raw.get("cadence_identity"), str)
                    else None
                )
            if identity is None and scope == "shared":
                schedule = self.repository.robot(serial_number)[
                    "shared_room_cadence"
                ].get(room_id)
                if isinstance(schedule, Mapping) and isinstance(
                    schedule.get("identity"), str
                ):
                    identity = schedule["identity"]
            reservations[room_id] = (str(scope), identity)
            if scope == "shared" or (
                isinstance(snapshot, Mapping)
                and snapshot.get("shared_schedule_participating") is True
            ):
                shared_schedule_rooms.add(room_id)
        for mutation in self.pending_cadence_mutations.get(serial_number, {}).values():
            if mutation.plan_id == plan_id and (
                mutation.deletes_plan
                or set(reservations).intersection(mutation.plan_room_ids)
            ):
                raise HomeAssistantError("Queued room cadence is being saved")
            if shared_schedule_rooms.intersection(mutation.shared_room_ids):
                raise HomeAssistantError("Queued shared cadence is being saved")
        self.prepared_runs[serial_number] = _PreparedRunReservation(
            plan_id,
            run_id,
            reservations,
            frozenset(shared_schedule_rooms),
            stop_enabled,
            stop_threshold,
        )

    @callback
    def restore_prepared_run(
        self,
        serial_number: str,
        plan_id: str,
        run_id: str,
        room_ids: Iterable[str],
        cadence_by_room: Mapping[str, Mapping[str, Any]] | None = None,
        *,
        finish_current_room: bool | None = None,
        finish_current_room_threshold: int | None = None,
    ) -> None:
        """Restore ownership from the durable recovery checkpoint."""
        if room_ids:
            self.reserve_prepared_run(
                serial_number,
                plan_id,
                run_id,
                room_ids,
                cadence_by_room,
                finish_current_room=finish_current_room,
                finish_current_room_threshold=finish_current_room_threshold,
            )

    @callback
    def release_prepared_run(self, serial_number: str, run_id: str) -> None:
        """Release only the reservation owned by the finishing managed run."""
        reservation = self.prepared_runs.get(serial_number)
        if reservation is not None and reservation.run_id == run_id:
            self.prepared_runs.pop(serial_number, None)

    @callback
    def prepared_run_stop_policy(
        self, serial_number: str, run_id: str
    ) -> tuple[bool, int]:
        """Read the stop policy captured during prepared-run admission."""
        reservation = self.prepared_runs.get(serial_number)
        if reservation is None or reservation.run_id != run_id:
            raise HomeAssistantError("Managed run does not own its prepared policy")
        return (
            reservation.finish_current_room,
            reservation.finish_current_room_threshold,
        )

    def begin_cadence_mutation(
        self,
        serial_number: str,
        mutation: _CadenceMutation,
    ) -> object:
        token = object()
        self.pending_cadence_mutations.setdefault(serial_number, {})[token] = mutation
        return token

    def end_cadence_mutation(self, serial_number: str, token: object) -> None:
        # Managed mutation workers are drained before robot removal clears
        # this registry, so every registered token has a corresponding owner.
        pending = self.pending_cadence_mutations[serial_number]
        pending.pop(token, None)
        if not pending:
            self.pending_cadence_mutations.pop(serial_number, None)

    def assert_cadence_reservation_edit_allowed(
        self,
        serial_number: str,
        plan_id: str,
        plan_room_ids: Iterable[str],
        shared_room_ids: Iterable[str],
        *,
        deletes_plan: bool = False,
    ) -> None:
        reservation = self.prepared_runs.get(serial_number)
        if reservation is None:
            return
        changed_plan_rooms = set(plan_room_ids)
        changed_shared_rooms = set(shared_room_ids)
        reserved_shared_rooms = reservation.shared_schedule_rooms
        if reservation.plan_id == plan_id and (
            deletes_plan or changed_plan_rooms.intersection(reservation.rooms)
        ):
            raise ValueError("room cadence is reserved by the queued managed run")
        if changed_shared_rooms.intersection(reserved_shared_rooms):
            raise ValueError(
                "shared room cadence is reserved by the queued managed run"
            )

    def resolve_cadence(
        self,
        serial_number: str,
        plan_id: str | None,
        rooms: Sequence[CleaningRoom],
        *,
        floor_token: str | None = None,
        room_identities: Mapping[str, str] | None = None,
        use_shared_schedule: bool = False,
        apply_due_settings: bool = True,
    ) -> tuple[list[CleaningRoom], dict[str, dict[str, Any]]]:
        """Resolve per-room effective settings from one durable policy source."""
        robot = self.repository.robot(serial_number)
        plan = robot["plans"].get(plan_id, {}) if plan_id is not None else {}
        plan_rooms = {
            str(raw.get("room_id")): raw
            for raw in plan.get("rooms", [])
            if isinstance(raw, Mapping) and raw.get("room_id")
        }
        schedules = robot.get("shared_room_cadence", {})
        room_identities = room_identities or {}
        resolved: list[CleaningRoom] = []
        snapshots: dict[str, dict[str, Any]] = {}
        for room in rooms:
            validation_mode = room.cleaning_mode if apply_due_settings else "vacuum"
            raw = plan_rooms.get(room.room_id, {})
            policy_value = raw.get("cadence") if isinstance(raw, Mapping) else None
            expected_identity = (
                room_identities.get(room.room_id) if room_identities else None
            )
            stored_identity = (
                raw.get("cadence_identity") if isinstance(raw, Mapping) else None
            )
            if (
                isinstance(stored_identity, str)
                and expected_identity is not None
                and stored_identity != expected_identity
                and isinstance(policy_value, Mapping)
            ):
                raise ValueError("room cadence belongs to a different map")
            policy: dict[str, Any] | None = None
            progress: Mapping[str, Any] | None = None
            if policy_value is not None and not isinstance(policy_value, Mapping):
                raise ValueError("room cadence must be an object")
            if (
                isinstance(policy_value, Mapping)
                and policy_value.get("scope") == "shared"
            ):
                schedule = (
                    schedules.get(room.room_id)
                    if isinstance(schedules, Mapping)
                    else None
                )
                if isinstance(schedule, Mapping) and isinstance(
                    schedule.get("policy"), Mapping
                ):
                    if (
                        expected_identity is not None
                        and schedule.get("identity") != expected_identity
                    ):
                        raise ValueError(
                            "shared room cadence belongs to a different map"
                        )
                    if (
                        floor_token is not None
                        and schedule.get("floor_token") is not None
                        and schedule.get("floor_token") != floor_token
                    ):
                        raise ValueError(
                            "shared room cadence belongs to a different map"
                        )
                    policy = normalize_cadence_policy(
                        {"scope": "shared", **schedule["policy"]},
                        # Shared schedules are defined against their saved normal
                        # vacuum mode. A one-time caller's selected mode is an
                        # override, not a redefinition of that schedule.
                        cleaning_mode=(
                            "vacuum"
                            if use_shared_schedule
                            else str(raw.get("cleaning_mode", "vacuum"))
                        ),
                        coverage_setting=room.coverage_setting,
                    )
                    progress = schedule.get("progress")
                elif (
                    policy_value.get("mop_every_n") is not None
                    or policy_value.get("coverage_every_n") is not None
                ):
                    raise ValueError("shared room cadence is unavailable")
            elif use_shared_schedule:
                schedule = (
                    schedules.get(room.room_id)
                    if isinstance(schedules, Mapping)
                    else None
                )
                if isinstance(schedule, Mapping) and isinstance(
                    schedule.get("policy"), Mapping
                ):
                    if (
                        expected_identity is not None
                        and schedule.get("identity") != expected_identity
                    ):
                        raise ValueError(
                            "shared room cadence belongs to a different map"
                        )
                    if (
                        floor_token is not None
                        and schedule.get("floor_token") is not None
                        and schedule.get("floor_token") != floor_token
                    ):
                        raise ValueError(
                            "shared room cadence belongs to a different map"
                        )
                    policy = normalize_cadence_policy(
                        {"scope": "shared", **schedule["policy"]},
                        # A manual one-time mode must not invalidate the shared
                        # schedule it is borrowing.
                        cleaning_mode="vacuum",
                        coverage_setting=room.coverage_setting,
                    )
                    progress = schedule.get("progress")
            elif isinstance(policy_value, Mapping) and plan_id is not None:
                policy = normalize_cadence_policy(
                    policy_value,
                    cleaning_mode=validation_mode,
                    coverage_setting=room.coverage_setting,
                )
                plan_records = robot["plan_room_cadence"].get(plan_id, {})
                progress_record = (
                    plan_records.get(room.room_id, {})
                    if isinstance(plan_records, Mapping)
                    else {}
                )
                if (
                    isinstance(progress_record, Mapping)
                    and expected_identity is not None
                    and progress_record.get("identity") not in {None, expected_identity}
                ):
                    raise ValueError("room cadence progress belongs to a different map")
                blocked_modes = _unverified_cadence_modes(progress_record, policy)
                if blocked_modes:
                    raise ValueError(
                        "room cadence progress is unverified; reset "
                        + " and ".join(blocked_modes)
                        + " before use"
                    )
                progress = (
                    progress_record.get("progress")
                    if isinstance(progress_record, Mapping)
                    else None
                )
            if policy is None:
                snapshots[room.room_id] = {
                    "scope": "plan",
                    "shared_schedule_participating": use_shared_schedule,
                    "mop_every_n": None,
                    "coverage_every_n": None,
                    "periodic_coverage_setting": None,
                    "mop_progress": 0,
                    "coverage_progress": 0,
                    "mop_due": False,
                    "coverage_due": False,
                    "effective_cleaning_mode": room.cleaning_mode,
                    "effective_coverage_setting": room.coverage_setting,
                    "next_mop_in": None,
                    "next_coverage_in": None,
                    "schedule_active": False,
                }
                resolved.append(room)
                continue
            snapshot = cadence_snapshot(
                policy,
                progress,
                cleaning_mode=room.cleaning_mode,
                coverage_setting=room.coverage_setting,
            )
            snapshot["shared_schedule_participating"] = (
                use_shared_schedule or snapshot.get("scope") == "shared"
            )
            if snapshot["effective_cleaning_mode"] == "mop":
                # A borrowed vacuum-strength schedule cannot change a mop-only
                # one-time run. Due coverage stays due for a vacuum run.
                snapshot["effective_coverage_setting"] = room.coverage_setting
            if not apply_due_settings:
                # A tracked one-off may explicitly keep its chosen settings.
                # Keep the shared due state in the checkpoint so compatible
                # verified work can satisfy it, while omitted due work stays due.
                snapshot["effective_cleaning_mode"] = room.cleaning_mode
                snapshot["effective_coverage_setting"] = room.coverage_setting
            snapshot["schedule_active"] = bool(
                policy["mop_every_n"] is not None
                or policy["coverage_every_n"] is not None
            )
            snapshots[room.room_id] = snapshot
            resolved.append(
                CleaningRoom(
                    room.room_id,
                    room.name,
                    str(snapshot["effective_cleaning_mode"]),
                    str(snapshot["effective_coverage_setting"]),
                )
            )
        return resolved, snapshots

    def cadence_progress(
        self, serial_number: str, plan_id: str, room_id: str
    ) -> dict[str, int]:
        """Return current bounded progress for one room's selected scope."""
        robot = self.repository.robot(serial_number)
        plan = robot["plans"].get(plan_id, {})
        room = next(
            (
                item
                for item in plan.get("rooms", [])
                if isinstance(item, Mapping) and item.get("room_id") == room_id
            ),
            {},
        )
        policy = room.get("cadence") if isinstance(room, Mapping) else None
        if isinstance(policy, Mapping) and policy.get("scope") == "shared":
            schedule = robot["shared_room_cadence"].get(room_id, {})
            progress = (
                schedule.get("progress", {}) if isinstance(schedule, Mapping) else {}
            )
        else:
            records = robot["plan_room_cadence"].get(plan_id, {})
            record = records.get(room_id, {}) if isinstance(records, Mapping) else {}
            progress = record.get("progress", {}) if isinstance(record, Mapping) else {}
        return {
            "mop": plan_timing._stored_count(progress, "mop"),
            "coverage": plan_timing._stored_count(progress, "coverage"),
        }

    def shared_cadence_delete_token(
        self, serial_number: str, room_id: str
    ) -> str | None:
        """Bind one shared-schedule deletion to its record and every consumer.

        A dialog must be refreshed if cadence progress, the schedule policy, or
        any consumer plan changes before deletion is confirmed.
        """
        robot = self.repository.robot(serial_number)
        schedule = robot.get("shared_room_cadence", {}).get(room_id)
        if not isinstance(schedule, Mapping):
            return None
        consumers = [
            {"plan_id": plan_id, "plan": plan}
            for plan_id, plan in sorted(robot["plans"].items())
            if isinstance(plan, Mapping)
            and any(
                isinstance(room, Mapping)
                and room.get("room_id") == room_id
                and isinstance(room.get("cadence"), Mapping)
                and room["cadence"].get("scope") == "shared"
                for room in plan.get("rooms", [])
            )
        ]
        payload = {"room_id": room_id, "schedule": schedule, "consumers": consumers}
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(b"matic-shared-cadence-delete-v1\0" + encoded).hexdigest()

    async def async_delete_room_schedule(
        self,
        serial_number: str,
        room_id: str,
        expected_token: str,
        *,
        floor_token: str,
        identity: str,
    ) -> dict[str, Any]:
        """Delete one shared schedule and detach every saved consumer atomically."""

        async def commit(_lease: _MetadataLockLease) -> dict[str, Any]:
            async with self.repository.user_metadata_store_transaction(serial_number):
                robot = self.repository.robot(serial_number)
                schedule = robot.get("shared_room_cadence", {}).get(room_id)
                if not isinstance(schedule, Mapping):
                    raise SharedRoomScheduleStaleError(
                        "shared room schedule no longer exists"
                    )
                if (
                    not isinstance(floor_token, str)
                    or len(floor_token) != 64
                    or not isinstance(identity, str)
                    or len(identity) != 64
                    or schedule.get("floor_token") != floor_token
                    or schedule.get("identity") != identity
                ):
                    raise SharedRoomScheduleMapChangedError(
                        "shared room schedule belongs to a different map"
                    )
                if (
                    self.shared_cadence_delete_token(serial_number, room_id)
                    != expected_token
                ):
                    raise SharedRoomScheduleStaleError(
                        "shared room schedule changed; refresh before deleting"
                    )

                active = robot.get("active_plan")
                pending = native_history._validated_native_reconciliation(
                    robot.get("pending_native_reconciliation")
                )
                if isinstance(active, Mapping) and active.get("room_id") == room_id:
                    raise SharedRoomScheduleLockedError(
                        "shared room schedule is in use by an active room"
                    )
                if pending is not None and pending.get("room_id") == room_id:
                    raise SharedRoomScheduleLockedError(
                        "shared room schedule is awaiting completion verification"
                    )
                reservation = self.prepared_runs.get(serial_number)
                if reservation is not None and (
                    room_id in reservation.shared_schedule_rooms
                    or (
                        reservation.plan_id
                        in {
                            plan_id
                            for plan_id, _room in self.shared_cadence_consumers(
                                robot, room_id
                            )
                        }
                        and room_id in reservation.rooms
                    )
                ):
                    raise SharedRoomScheduleLockedError(
                        "shared room schedule is reserved by a queued managed run"
                    )
                consumers = self.shared_cadence_consumers(robot, room_id)
                for mutation in self.pending_cadence_mutations.get(
                    serial_number, {}
                ).values():
                    if room_id in mutation.shared_room_ids or (
                        mutation.plan_id in {plan_id for plan_id, _room in consumers}
                        and room_id in mutation.plan_room_ids
                    ):
                        raise SharedRoomScheduleLockedError(
                            "shared room schedule is being saved"
                        )

                before = deepcopy(robot)
                shared = robot["shared_room_cadence"]
                shared.pop(room_id)
                plan_room_ids: dict[str, set[str]] = {}
                for plan_id, room in consumers:
                    room.pop("cadence", None)
                    room.pop("cadence_identity", None)
                    # A former private schedule may have left dormant counters.
                    # Removing its shared replacement must not resurrect them
                    # when this plan later creates a new private schedule.
                    private_records = robot["plan_room_cadence"].get(plan_id)
                    if isinstance(private_records, MutableMapping):
                        private_records.pop(room_id, None)
                    plan_room_ids.setdefault(plan_id, set()).add(room_id)
                mutation_tokens = [
                    self.begin_cadence_mutation(
                        serial_number,
                        _CadenceMutation(
                            plan_id,
                            frozenset(changed_rooms),
                            frozenset({room_id}),
                        ),
                    )
                    for plan_id, changed_rooms in sorted(plan_room_ids.items())
                ]
                if not mutation_tokens:
                    mutation_tokens.append(
                        self.begin_cadence_mutation(
                            serial_number,
                            _CadenceMutation("", frozenset(), frozenset({room_id})),
                        )
                    )
                try:
                    await self.repository.async_save_with_rollback(
                        serial_number, before
                    )
                finally:
                    for token in mutation_tokens:
                        self.end_cadence_mutation(serial_number, token)
                return {
                    "room_id": room_id,
                    "affected_plan_ids": sorted(plan_room_ids),
                }

        result = await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.repository.plan_write_lock(serial_number),),
            notify=True,
            reject_on_admission_close=True,
        )
        return cast(dict[str, Any], result)

    @staticmethod
    def shared_cadence_consumers(
        robot: Mapping[str, Any], room_id: str
    ) -> list[tuple[str, MutableMapping[str, Any]]]:
        """Return each mutable saved room that references a shared schedule."""
        consumers: list[tuple[str, MutableMapping[str, Any]]] = []
        plans = robot.get("plans", {})
        if not isinstance(plans, Mapping):
            return consumers
        for plan_id, plan in plans.items():
            if not isinstance(plan_id, str) or not isinstance(plan, MutableMapping):
                continue
            rooms = plan.get("rooms", [])
            if not isinstance(rooms, list):
                continue
            consumers.extend(
                (plan_id, room)
                for room in rooms
                if (
                    isinstance(room, MutableMapping)
                    and room.get("room_id") == room_id
                    and isinstance(room.get("cadence"), Mapping)
                    and room["cadence"].get("scope") == "shared"
                )
            )
        return consumers

    def cadence_editor_state(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        floor_token: str | None = None,
        identity: str | None = None,
        use_shared_schedule: bool = False,
    ) -> dict[str, Any]:
        """Project editable policy and effective cadence from one authority."""
        robot = self.repository.robot(serial_number)
        raw_room = next(
            (
                item
                for item in robot["plans"].get(plan_id, {}).get("rooms", [])
                if isinstance(item, Mapping) and item.get("room_id") == room.room_id
            ),
            None,
        )
        stored_policy = (
            raw_room.get("cadence") if isinstance(raw_room, Mapping) else None
        )
        shared_selected = use_shared_schedule or (
            isinstance(stored_policy, Mapping)
            and stored_policy.get("scope") == "shared"
        )
        if shared_selected:
            schedule = robot["shared_room_cadence"].get(room.room_id)
            if isinstance(schedule, Mapping) and isinstance(
                schedule.get("policy"), Mapping
            ):
                stored_policy = {"scope": "shared", **schedule["policy"]}
            elif use_shared_schedule:
                stored_policy = None
        policy: dict[str, Any] | None = None
        try:
            policy = (
                normalize_cadence_policy(
                    stored_policy,
                    cleaning_mode=(
                        str(raw_room.get("cleaning_mode", room.cleaning_mode))
                        if isinstance(raw_room, Mapping) and not use_shared_schedule
                        else room.cleaning_mode
                    ),
                    coverage_setting=(
                        str(raw_room.get("coverage_setting", room.coverage_setting))
                        if isinstance(raw_room, Mapping) and not use_shared_schedule
                        else room.coverage_setting
                    ),
                )
                if stored_policy is not None
                else None
            )
            if policy is not None and not shared_selected:
                records = robot["plan_room_cadence"].get(plan_id, {})
                record = (
                    records.get(room.room_id, {})
                    if isinstance(records, Mapping)
                    else {}
                )
                unverified_modes = _unverified_cadence_modes(record, policy)
                if unverified_modes:
                    return {
                        "cadence": policy,
                        "cadence_progress": None,
                        "cadence_reasons": [
                            f"{mode}_progress_unverified" for mode in unverified_modes
                        ],
                    }
            _effective, snapshots = self.resolve_cadence(
                serial_number,
                plan_id,
                [room],
                floor_token=floor_token,
                room_identities={room.room_id: identity} if identity else None,
                use_shared_schedule=use_shared_schedule,
            )
        except ValueError as err:
            message = str(err)
            if isinstance(err, CoverageCadenceRequiresVacuumError):
                # Preserve this otherwise valid policy in the editor so it
                # can be cleared or used after switching to a vacuum mode.
                policy = normalize_cadence_policy(
                    stored_policy,
                    cleaning_mode="vacuum",
                    coverage_setting=room.coverage_setting,
                )
            reason = (
                "coverage_requires_vacuum"
                if isinstance(err, CoverageCadenceRequiresVacuumError)
                else "identity_changed"
                if "different map" in message
                else "shared_schedule_unavailable"
                if "unavailable" in message
                else "cadence_progress_unverified"
                if "progress is unverified" in message
                else "invalid_cadence_policy"
            )
            return {
                "cadence": policy,
                "cadence_progress": None,
                "cadence_reasons": [reason],
            }
        progress = snapshots[room.room_id]
        return {
            "cadence": policy,
            "cadence_progress": progress,
            "cadence_reasons": [
                reason
                for reason, is_due in (
                    ("mop_due", progress["mop_due"]),
                    ("coverage_due", progress["coverage_due"]),
                )
                if is_due
            ],
        }

    async def async_reset_cadence(
        self,
        serial_number: str,
        plan_id: str,
        room_ids: Sequence[str] | None = None,
        *,
        modes: Sequence[str] | None = None,
    ) -> dict[str, list[str]]:
        """Reset selected cadence modes separately from cleaning history.

        Omitting ``modes`` preserves the original full-reset behavior. A caller
        can reset only mop or coverage cadence while retaining the other
        counter and its one-time due request.
        """

        async def commit(_lease: _MetadataLockLease) -> dict[str, list[str]]:
            async with self.repository.user_metadata_store_transaction(serial_number):
                return await self.async_reset_cadence_transaction(
                    serial_number,
                    plan_id,
                    room_ids,
                    modes=modes,
                )

        result = await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.repository.plan_write_lock(serial_number),),
            notify=True,
            reject_on_admission_close=True,
        )
        return cast(dict[str, list[str]], result)

    async def async_reset_cadence_transaction(
        self,
        serial_number: str,
        plan_id: str,
        room_ids: Sequence[str] | None = None,
        *,
        modes: Sequence[str] | None = None,
    ) -> dict[str, list[str]]:
        """Apply a cadence reset while holding the per-robot plan-write lock."""
        requested_modes = set(("mop", "coverage") if modes is None else modes)
        if not requested_modes or requested_modes - {"mop", "coverage"}:
            raise ValueError("cadence reset modes must be mop and/or coverage")
        reset_modes: list[str] = [
            mode for mode in ("mop", "coverage") if mode in requested_modes
        ]
        robot = self.repository.robot(serial_number)
        active = robot.get("active_plan")
        pending = native_history._validated_native_reconciliation(
            robot.get("pending_native_reconciliation")
        )
        selected = set(room_ids or ())
        plan = robot["plans"].get(plan_id, {})
        plan_rooms = {
            str(room.get("room_id")): room
            for room in plan.get("rooms", [])
            if isinstance(room, Mapping) and room.get("room_id")
        }
        target_ids = [
            room_id for room_id in plan_rooms if not selected or room_id in selected
        ]
        shared_ids = {
            room_id
            for room_id in target_ids
            if isinstance(plan_rooms.get(room_id), Mapping)
            and isinstance(plan_rooms[room_id].get("cadence"), Mapping)
            and plan_rooms[room_id]["cadence"].get("scope") == "shared"
        }
        if selected - set(plan_rooms):
            raise ValueError("room is not part of the selected plan")
        if (
            isinstance(active, Mapping)
            and active.get("room_id") in target_ids
            and (
                active.get("plan_id") == plan_id or active.get("room_id") in shared_ids
            )
        ):
            raise ValueError("room cadence cannot reset while its plan is running")
        if (
            pending is not None
            and pending["room_id"] in target_ids
            and (pending["plan_id"] == plan_id or pending["room_id"] in shared_ids)
        ):
            raise ValueError(
                "room cadence cannot reset while completion is being verified"
            )
        self.assert_cadence_reservation_edit_allowed(
            serial_number, plan_id, target_ids, shared_ids
        )
        before = deepcopy(robot)
        private = robot["plan_room_cadence"].setdefault(plan_id, {})
        shared = robot["shared_room_cadence"]
        for room_id in target_ids:
            raw = plan_rooms.get(room_id, {})
            policy = raw.get("cadence") if isinstance(raw, Mapping) else None
            if isinstance(policy, Mapping) and policy.get("scope") == "shared":
                schedule = shared.get(room_id)
                if isinstance(schedule, dict):
                    # _robot() has already normalized each persisted progress
                    # record before this policy mutation begins.
                    progress = schedule["progress"]
                    for mode in reset_modes:
                        progress[mode] = 0
                    policy = schedule.get("policy")
                    if isinstance(policy, dict):
                        for mode in reset_modes:
                            policy[f"do_{mode}_next"] = False
            else:
                record = private.get(room_id)
                if isinstance(record, dict):
                    progress = record["progress"]
                    for mode in reset_modes:
                        progress[mode] = 0
                    unverified = record.get("unverified_modes")
                    if isinstance(unverified, list):
                        remaining = [
                            mode
                            for mode in unverified
                            if isinstance(mode, str)
                            and mode in ("mop", "coverage")
                            and mode not in reset_modes
                        ]
                        if remaining:
                            record["unverified_modes"] = remaining
                        else:
                            record.pop("unverified_modes", None)
                policy = raw.get("cadence") if isinstance(raw, Mapping) else None
                if isinstance(policy, dict):
                    for mode in reset_modes:
                        policy[f"do_{mode}_next"] = False
        mutation_token = self.begin_cadence_mutation(
            serial_number,
            _CadenceMutation(
                plan_id,
                frozenset(set(target_ids) - shared_ids),
                frozenset(shared_ids),
            ),
        )
        try:
            await self.repository.async_save_with_rollback(serial_number, before)
        finally:
            self.end_cadence_mutation(serial_number, mutation_token)
        return {"reset_room_ids": target_ids, "reset_modes": reset_modes}

    def assert_cadence_edit_allowed(
        self,
        serial_number: str,
        plan_id: str,
        new_plan: Mapping[str, Any],
        shared_updates: Sequence[tuple[str, Mapping[str, Any]]],
        *,
        changed_plan_rooms: Iterable[str] = (),
    ) -> None:
        """Keep policy and frozen run settings stable through reconciliation."""
        robot = self.repository.robot(serial_number)
        self.assert_cadence_reservation_edit_allowed(
            serial_number,
            plan_id,
            changed_plan_rooms,
            (room_id for room_id, _policy in shared_updates),
        )
        active = robot.get("active_plan")
        pending = native_history._validated_native_reconciliation(
            robot.get("pending_native_reconciliation")
        )
        if isinstance(active, Mapping) and active.get("plan_id") == plan_id:
            active_room_id = active.get("room_id")
            old_plan = robot["plans"].get(plan_id, {})
            old_room = next(
                (
                    room
                    for room in old_plan.get("rooms", [])
                    if isinstance(room, Mapping)
                    and room.get("room_id") == active_room_id
                ),
                None,
            )
            new_room = next(
                (
                    room
                    for room in new_plan.get("rooms", [])
                    if isinstance(room, Mapping)
                    and room.get("room_id") == active_room_id
                ),
                None,
            )
            old_binding = (
                (old_room.get("cadence"), old_room.get("cadence_identity"))
                if isinstance(old_room, Mapping)
                else None
            )
            new_binding = (
                (new_room.get("cadence"), new_room.get("cadence_identity"))
                if isinstance(new_room, Mapping)
                else None
            )
            if old_binding != new_binding:
                raise ValueError("room cadence cannot change while its plan is running")
        if pending is not None and pending["plan_id"] == plan_id:
            room_id = pending["room_id"]
            old_plan = robot["plans"].get(plan_id, {})
            old_room = next(
                (
                    room
                    for room in old_plan.get("rooms", [])
                    if isinstance(room, Mapping) and room.get("room_id") == room_id
                ),
                None,
            )
            new_room = next(
                (
                    room
                    for room in new_plan.get("rooms", [])
                    if isinstance(room, Mapping) and room.get("room_id") == room_id
                ),
                None,
            )
            old_binding = (
                (old_room.get("cadence"), old_room.get("cadence_identity"))
                if isinstance(old_room, Mapping)
                else None
            )
            new_binding = (
                (new_room.get("cadence"), new_room.get("cadence_identity"))
                if isinstance(new_room, Mapping)
                else None
            )
            if old_binding != new_binding:
                raise ValueError(
                    "room cadence cannot change while completion is being verified"
                )
        if shared_updates and (
            (
                isinstance(active, Mapping)
                and active.get("room_id") in {room for room, _ in shared_updates}
            )
            or (
                pending is not None
                and pending["room_id"] in {room for room, _ in shared_updates}
            )
        ):
            raise ValueError("shared room cadence cannot change during a room run")
