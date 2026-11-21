"""Saved cleaning plan and area definitions with durable edits."""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import (
    Callable,
    Mapping,
    MutableMapping,
    Sequence,
)
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, TypeIs, cast

from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from . import area_binding_geometry as binding_geometry
from . import native_history, plan_timing
from .area_binding import (
    AreaBindingStatus,
    area_binding_needs_geometry_index,
    area_binding_status,
    binding_for_area,
    current_binding,
    room_frame_point_count,
    total_room_frame_point_count,
    valid_binding,
)
from .area_geometry import GeometryTooComplex
from .cadence import (
    CoverageCadenceRequiresVacuumError,
    normalize_cadence_policy,
)
from .client import MAX_FLOOR_PLAN_BOUNDARY_POINTS, FloorPlan, is_sha256_hex
from .const import (
    MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE,
    MAX_ROOM_SEQUENCE_SIZE,
)
from .plan_cadence import (
    PlanCadence,
    _CadenceMutation,
)
from .plan_model import (
    MANUAL_ROOM_SEQUENCE_PLAN_NAME,
    AreaBindingUpgradeResult,
    AreaFramePointLimitError,
    AreaInUseError,
    CadenceBindingError,
    DuplicatePlanAreaError,
    PlanAreaLimitError,
    PlanAreaMissingError,
    RoomSequenceLimitError,
    _is_manual_room_sequence_plan_id,
    _next_manual_room_sequence_plan_id,
    _stored_entries,
    plan_area_fingerprint,
    plan_entries,
    relink_plan_rooms,
)
from .plan_repository import (
    PlanRepository,
    _MetadataLockLease,
)

_LOGGER = logging.getLogger(__name__)

MAX_SAVED_PLANS_PER_ROBOT = 256
# Bound the aggregate landmarks stored with one robot's saved areas.
_MAX_PERSISTED_ROOM_FRAME_POINTS_PER_ROBOT = MAX_FLOOR_PLAN_BOUNDARY_POINTS


class SavedPlanLimitError(HomeAssistantError):
    """Raised when a robot already has the maximum saved plans."""


class PlanCatalog:
    """Manage saved definitions using one repository and cadence authority."""

    def __init__(self, cadence: PlanCadence, repository: PlanRepository) -> None:
        self.cadence = cadence
        self.repository = repository
        self.manual_room_sequence_reservations: dict[str, set[str]] = {}

    def plans(self, serial_number: str) -> dict[str, dict[str, Any]]:
        """Return a copy of all saved plan definitions."""
        return deepcopy(self.repository.robot(serial_number)["plans"])

    def reserve_manual_room_sequence_plan_id(self, serial_number: str) -> str:
        """Reserve an unsaved identity for a manual Map Studio room run."""
        robot = self.repository.robot(serial_number)
        reservations = self.manual_room_sequence_reservations.setdefault(
            serial_number, set()
        )
        unavailable = set(reservations)
        last_run = robot.get("last_run")
        if (
            isinstance(last_run, Mapping)
            and last_run.get("outcome") == "running"
            and _is_manual_room_sequence_plan_id(last_run.get("plan_id"))
        ):
            unavailable.add(str(last_run["plan_id"]))
        for owner in (
            robot.get("active_plan"),
            robot.get("pending_native_reconciliation"),
        ):
            if isinstance(owner, Mapping) and _is_manual_room_sequence_plan_id(
                owner.get("plan_id")
            ):
                unavailable.add(str(owner["plan_id"]))
        plan_id = _next_manual_room_sequence_plan_id(robot["plans"], unavailable)
        reservations.add(plan_id)
        return plan_id

    def release_manual_room_sequence_plan_id(
        self, serial_number: str, plan_id: str
    ) -> None:
        """Release the transient identity after its executor has fully settled."""
        reservations = self.manual_room_sequence_reservations.get(serial_number)
        if reservations is None:
            return
        reservations.discard(plan_id)
        if not reservations:
            self.manual_room_sequence_reservations.pop(serial_number, None)

    def areas(self, serial_number: str) -> dict[str, dict[str, Any]]:
        """Return a private copy of locally saved drawn areas."""
        return deepcopy(self.repository.robot(serial_number)["areas"])

    async def async_upgrade_area_bindings(
        self, serial_number: str, floor_plan: FloorPlan | None
    ) -> AreaBindingUpgradeResult:
        """Upgrade verified area bindings without rebasing tolerated drift."""

        async def commit(_lease: _MetadataLockLease) -> AreaBindingUpgradeResult:
            async with self.repository.commit(serial_number):
                return self.upgrade_area_bindings_transaction(serial_number, floor_plan)

        def notify_if_upgraded(result: AreaBindingUpgradeResult) -> None:
            if result.upgraded:
                self.repository.notify_listeners(serial_number)

        result = await self.repository.async_run_owned_metadata(
            serial_number, commit, after_commit=notify_if_upgraded
        )
        return cast(AreaBindingUpgradeResult, result)

    def upgrade_area_bindings_transaction(
        self, serial_number: str, floor_plan: FloorPlan | None
    ) -> AreaBindingUpgradeResult:
        """Convert bindings that verify on this floor, inside its commit.

        A binding 0.5 saved converts once it is CURRENT here, and stays as
        saved until then. On an unchanged map the area is bound afresh; after
        a tolerated change it takes its exact version 7 form, so drift is
        never rebased. A version 7 binding without room frames is bound afresh
        whenever it is CURRENT, as room frames may now fit.
        """
        pending = False
        room_geometry = None
        robot = self.repository.robot(serial_number)
        areas = robot["areas"]
        staged: list[tuple[str, MutableMapping[str, Any], dict[str, Any]]] = []
        for area_id, area in areas.items():
            if not isinstance(area, MutableMapping):
                continue
            binding = area.get("map_binding")
            if not isinstance(binding, Mapping) or not isinstance(
                area.get("circles"), list
            ):
                continue
            saved = current_binding(binding)
            old = not valid_binding(binding)
            if saved is None or (not old and "frame" in binding):
                continue
            if floor_plan is None:
                pending = True
                continue
            if room_geometry is None and area_binding_needs_geometry_index(area):
                room_geometry = binding_geometry._room_geometry_index(floor_plan)
            status = area_binding_status(area, floor_plan, room_geometry=room_geometry)
            if status is not AreaBindingStatus.CURRENT:
                pending = (
                    pending
                    or old
                    or status
                    in {
                        AreaBindingStatus.GEOMETRY_CHANGED,
                        AreaBindingStatus.INVALID,
                    }
                )
                continue
            try:
                upgraded = (
                    binding_for_area(
                        floor_plan, area["circles"], room_geometry=room_geometry
                    )
                    if saved["geometry_sha256"]
                    == binding_geometry.floor_plan_geometry_fingerprint(floor_plan)
                    else saved
                )
            except GeometryTooComplex:
                # Verification and conversion share one bounded index; retry
                # on a later map revision when conversion runs out of work.
                pending = True
                continue
            except KeyError, TypeError, ValueError:
                # The circles verified within the saved-center tolerance but
                # no longer bind exactly; keep the area as saved.
                continue
            if upgraded != binding:
                staged.append((area_id, area, upgraded))
        projected_points = total_room_frame_point_count(areas)
        for _, area, upgraded in staged:
            projected_points += room_frame_point_count(
                {"map_binding": upgraded}
            ) - room_frame_point_count(area)
        if projected_points > _MAX_PERSISTED_ROOM_FRAME_POINTS_PER_ROBOT:
            return AreaBindingUpgradeResult(0, True)
        run = robot.get("last_run")
        checkpoint = run.get("recovery_checkpoint") if isinstance(run, dict) else None
        entries = checkpoint.get("entries") if isinstance(checkpoint, dict) else None
        for area_id, area, upgraded in staged:
            before = plan_area_fingerprint(area)
            area["map_binding"] = upgraded
            after = plan_area_fingerprint(area)
            # The area's geometry is unchanged, so its run history and a run
            # that restart recovery resumes keep the area's identity.
            for record in (
                robot["area_history"].get(area_id),
                *(
                    rotation.get("areas", {}).get(area_id)
                    for rotation in robot["rotations"].values()
                ),
                *(
                    entry
                    for entry in (entries if isinstance(entries, list) else ())
                    if isinstance(entry, dict) and entry.get("area_id") == area_id
                ),
            ):
                if isinstance(record, dict) and record.get("fingerprint") == before:
                    record["fingerprint"] = after
        return AreaBindingUpgradeResult(len(staged), pending)

    def area(self, serial_number: str, reference: str | None = None) -> dict[str, Any]:
        """Return one locally saved area by stable ID or exact name."""
        robot = self.repository.robot(serial_number)
        areas = robot["areas"]
        requested = reference or robot.get("selected_area")
        if requested in areas:
            return {"id": requested, **deepcopy(areas[requested])}
        folded = (requested or "").casefold()
        for key, value in areas.items():
            if str(value.get("name", key)).casefold() == folded:
                return {"id": key, **deepcopy(value)}
        raise KeyError(requested)

    async def async_save_area(
        self,
        serial_number: str,
        area_id: str,
        area: Mapping[str, Any],
        *,
        precondition: Callable[[], None] | None = None,
    ) -> None:
        """Create or replace a private local drawn-area definition."""

        def save(robot: dict[str, Any]) -> None:
            areas = robot["areas"]
            projected_points = (
                total_room_frame_point_count(areas)
                - room_frame_point_count(areas.get(area_id, {}))
                + room_frame_point_count(area)
            )
            if projected_points > _MAX_PERSISTED_ROOM_FRAME_POINTS_PER_ROBOT:
                raise AreaFramePointLimitError(
                    "aggregate room frame boundary point limit exceeded"
                )
            robot["areas"][area_id] = deepcopy(dict(area))
            robot["selected_area"] = area_id

        await self.repository.async_mutate_area_metadata(
            serial_number, save, precondition=precondition
        )

    async def async_delete_area(self, serial_number: str, area_id: str) -> None:
        """Delete one local drawn area and every plan entry that names it.

        The area and its plan entries leave in one store commit. A plan that
        would be left with nothing to clean refuses the whole deletion.
        """

        async def commit(_lease: _MetadataLockLease) -> None:
            async with self.repository.commit(serial_number, user=True) as robot:
                using = self.plans_using_area(serial_number, area_id)
                emptied = [
                    str(robot["plans"][plan_id].get("name", plan_id))
                    for plan_id in using
                    if all(
                        entry.get("kind") == "area" and entry.get("area_id") == area_id
                        for entry in _stored_entries(robot["plans"][plan_id])
                    )
                ]
                if emptied:
                    raise AreaInUseError(emptied)
                for plan_id in using:
                    plan = robot["plans"][plan_id]
                    plan["entries"] = [
                        entry
                        for entry in plan["entries"]
                        if not (
                            isinstance(entry, Mapping)
                            and entry.get("kind") == "area"
                            and entry.get("area_id") == area_id
                        )
                    ]
                robot["areas"].pop(area_id, None)
                robot["area_history"].pop(area_id, None)
                for rotation in robot["rotations"].values():
                    rotation.get("areas", {}).pop(area_id, None)
                if robot.get("selected_area") == area_id:
                    robot["selected_area"] = next(iter(robot["areas"]), None)

        await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.repository.plan_write_lock(serial_number),),
            notify=True,
            reject_on_admission_close=True,
        )

    async def async_select_area(self, serial_number: str, area_id: str) -> None:
        """Persist the custom area used by native entities."""

        def select(robot: dict[str, Any]) -> None:
            if area_id not in robot["areas"]:
                raise KeyError(area_id)
            robot["selected_area"] = area_id

        await self.repository.async_mutate_area_metadata(serial_number, select)

    def plan(self, serial_number: str, plan_id: str | None = None) -> dict[str, Any]:
        """Return one saved plan by ID, name, or current selection."""
        robot = self.repository.robot(serial_number)
        plans = robot["plans"]
        requested = plan_id or robot.get("selected_plan")
        if requested in plans:
            return {"id": requested, **deepcopy(plans[requested])}
        folded = (requested or "").casefold()
        for key, value in plans.items():
            if str(value.get("name", key)).casefold() == folded:
                return {"id": key, **deepcopy(value)}
        raise KeyError(requested)

    async def async_save_plan(
        self,
        serial_number: str,
        plan_id: str,
        plan: Mapping[str, Any],
        *,
        select: bool = True,
        floor_token: str | None = None,
        room_identities: Mapping[str, str] | None = None,
    ) -> None:
        """Create or replace a validated room-native plan definition."""

        async def commit(_lease: _MetadataLockLease) -> None:
            async with self.cadence.cadence_commit(serial_number) as mutations:
                mutations.append(
                    self.save_plan_transaction(
                        serial_number,
                        plan_id,
                        plan,
                        select=select,
                        floor_token=floor_token,
                        room_identities=room_identities,
                    )
                )

        await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.repository.plan_write_lock(serial_number),),
            notify=True,
            reject_on_admission_close=True,
        )

    def save_plan_transaction(
        self,
        serial_number: str,
        plan_id: str,
        plan: Mapping[str, Any],
        *,
        select: bool,
        floor_token: str | None,
        room_identities: Mapping[str, str] | None,
    ) -> _CadenceMutation:
        """Write a validated room-native plan into the open commit."""
        robot = self.repository.robot(serial_number)
        plans = robot["plans"]
        if plan_id not in plans:
            _assert_plan_can_be_added(plans, plan_id)
        saved_plan = deepcopy(dict(plan))
        raw_rooms = saved_plan.get("rooms", [])
        previous_rooms: Sequence[object] = ()
        if _is_room_sequence(raw_rooms):
            previous_rooms = _stored_rooms(plans.get(plan_id, {}))
            _assert_room_count_allowed(raw_rooms, previous_rooms)
        save = _PlanSave(
            robot=robot,
            plan_id=plan_id,
            floor_token=floor_token,
            room_identities=room_identities or {},
            prior_rooms=_rooms_by_id(previous_rooms),
            shared_cadence=robot.get("shared_room_cadence", {}),
        )
        edits = _CadenceEdits()
        for raw_room in saved_plan.get("rooms", []):
            _normalize_room(save, edits, raw_room)
        saved_plan["rooms"] = edits.rooms
        saved_plan["entries"] = self.normalized_plan_entries(
            robot, saved_plan.get("entries"), edits.rooms
        )
        edits.reset_private_progress.update(
            set(save.prior_rooms) - {room["room_id"] for room in edits.rooms}
        )
        changed_plan_rooms = _changed_plan_rooms(save.prior_rooms, edits.rooms)
        changed_plan_rooms.update(edits.reset_private_progress)
        self.cadence.assert_cadence_edit_allowed(
            serial_number,
            plan_id,
            saved_plan,
            edits.shared_updates,
            changed_plan_rooms=changed_plan_rooms,
        )
        if edits.binding_error is not None:
            raise edits.binding_error
        _write_cadence_edits(save, edits)
        plans[plan_id] = saved_plan
        if select or robot.get("selected_plan") is None:
            robot["selected_plan"] = plan_id
        return _CadenceMutation(
            plan_id,
            frozenset(changed_plan_rooms),
            frozenset(room_id for room_id, _policy in edits.shared_updates),
        )

    @staticmethod
    def normalized_plan_entries(
        robot: Mapping[str, Any],
        raw_entries: object,
        rooms: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        """Validate the entry order against the saved rooms and areas."""
        entries = plan_entries({"rooms": list(rooms), "entries": raw_entries})
        area_ids = [entry["area_id"] for entry in entries if entry["kind"] == "area"]
        if len(area_ids) > MAX_ROOM_SEQUENCE_SIZE:
            raise PlanAreaLimitError(
                f"A plan can include at most {MAX_ROOM_SEQUENCE_SIZE} custom areas"
            )
        if len(set(area_ids)) != len(area_ids):
            raise DuplicatePlanAreaError("a custom area appears more than once")
        if any(area_id not in robot["areas"] for area_id in area_ids):
            raise PlanAreaMissingError("plan custom area is missing")
        return entries

    def plans_using_area(self, serial_number: str, area_id: str) -> list[str]:
        """Return the IDs of saved plans that clean one custom area."""
        return sorted(
            plan_id
            for plan_id, plan in self.repository.robot(serial_number)["plans"].items()
            if any(
                entry.get("kind") == "area" and entry.get("area_id") == area_id
                for entry in _stored_entries(plan)
            )
        )

    async def async_delete_plan(self, serial_number: str, plan_id: str) -> None:
        """Delete one saved plan without deleting unrelated history."""

        async def commit(_lease: _MetadataLockLease) -> None:
            async with self.cadence.cadence_commit(serial_number) as mutations:
                mutations.append(self.delete_plan_transaction(serial_number, plan_id))

        await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.repository.plan_write_lock(serial_number),),
            notify=True,
            reject_on_admission_close=True,
        )

    def delete_plan_transaction(
        self, serial_number: str, plan_id: str
    ) -> _CadenceMutation:
        """Delete one saved plan in the open commit, keeping unrelated history."""
        robot = self.repository.robot(serial_number)
        active = robot.get("active_plan")
        pending = native_history._validated_native_reconciliation(
            robot.get("pending_native_reconciliation")
        )
        if isinstance(active, Mapping) and active.get("plan_id") == plan_id:
            raise ValueError("plan cannot be deleted while it is running")
        if pending is not None and pending["plan_id"] == plan_id:
            raise ValueError(
                "plan cannot be deleted while completion is being verified"
            )
        self.cadence.assert_cadence_reservation_edit_allowed(
            serial_number,
            plan_id,
            (
                str(room.get("room_id"))
                for room in robot["plans"].get(plan_id, {}).get("rooms", [])
                if isinstance(room, Mapping) and room.get("room_id")
            ),
            (),
            deletes_plan=True,
        )
        plan_room_ids = frozenset(
            str(room.get("room_id"))
            for room in robot["plans"].get(plan_id, {}).get("rooms", [])
            if isinstance(room, Mapping) and room.get("room_id")
        )
        robot["plans"].pop(plan_id, None)
        robot["rotation_resets"].pop(plan_id, None)
        robot["plan_room_cadence"].pop(plan_id, None)
        if robot.get("selected_plan") == plan_id:
            robot["selected_plan"] = next(iter(robot["plans"]), None)
        return _CadenceMutation(plan_id, plan_room_ids, frozenset(), deletes_plan=True)

    async def async_select_plan(self, serial_number: str, plan_id: str) -> None:
        """Persist the selected plan used by native entities."""

        async def commit(_lease: _MetadataLockLease) -> None:
            async with self.repository.commit(serial_number, user=True) as robot:
                if plan_id not in robot["plans"]:
                    raise KeyError(plan_id)
                robot["selected_plan"] = plan_id

        await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.repository.plan_write_lock(serial_number),),
            notify=True,
            reject_on_admission_close=True,
        )

    def selected_area(self, serial_number: str) -> str | None:
        """Return the selected area id without copying the plan history."""
        selected: str | None = self.repository.robot(serial_number).get("selected_area")
        return selected

    def plan_name(self, serial_number: str, plan_id: str | None) -> str | None:
        if plan_id is None:
            return None
        plan = self.repository.robot(serial_number)["plans"].get(plan_id)
        if plan is None and _is_manual_room_sequence_plan_id(plan_id):
            return MANUAL_ROOM_SEQUENCE_PLAN_NAME
        return str(plan.get("name", plan_id)) if plan else plan_id

    def known_room_names(self, serial_number: str) -> dict[str, str]:
        """Return the last name the integration saw for each room ID."""
        return {
            room_id: record["name"]
            for room_id, record in self.repository.robot(serial_number)["rooms"].items()
            if isinstance(record, Mapping) and isinstance(record.get("name"), str)
        }

    async def async_relink_plan_rooms(
        self,
        serial_number: str,
        links: Mapping[str, Mapping[str, str]],
        *,
        floor_token: str | None,
        room_identities: Mapping[str, str],
    ) -> None:
        """Move plan rooms to new room IDs in one save, per plan ``links``.

        Every target must be on the current map. Each plan is read again under
        the write lock, so a room that is no longer in it fails the save.
        """
        if any(
            target not in room_identities
            for plan_links in links.values()
            for target in plan_links.values()
        ):
            raise ValueError("re-link target is not on the current map")

        async def commit(_lease: _MetadataLockLease) -> None:
            plans = self.repository.robot(serial_number)["plans"]
            if not set(links) <= set(plans):
                raise ValueError("re-link names a deleted plan")
            async with self.cadence.cadence_commit(serial_number) as mutations:
                for plan_id, plan_links in links.items():
                    mutations.append(
                        self.save_plan_transaction(
                            serial_number,
                            plan_id,
                            relink_plan_rooms(plans[plan_id], plan_links),
                            select=False,
                            floor_token=floor_token,
                            room_identities=room_identities,
                        )
                    )

        await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.repository.plan_write_lock(serial_number),),
            notify=True,
            reject_on_admission_close=True,
        )

    def area_name(self, serial_number: str, area_id: str | None) -> str | None:
        if area_id is None:
            return None
        area = self.repository.robot(serial_number)["areas"].get(area_id)
        return str(area.get("name", area_id)) if area else area_id


@dataclass(frozen=True, slots=True)
class _PlanSave:
    """What one plan save reads and writes for every room."""

    robot: dict[str, Any]
    plan_id: str
    floor_token: str | None
    room_identities: Mapping[str, str]
    prior_rooms: Mapping[str, Mapping[str, Any]]
    shared_cadence: Mapping[str, Any]


@dataclass(slots=True)
class _CadenceEdits:
    """What the normalized rooms change beside the plan itself."""

    rooms: list[dict[str, Any]] = field(default_factory=list)
    shared_updates: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    reset_private_progress: set[str] = field(default_factory=set)
    binding_error: CadenceBindingError | None = None


@dataclass(frozen=True, slots=True)
class _RoomCadence:
    """One room with a cadence, and what it had before this save."""

    room_id: str
    room: dict[str, Any]
    inherited: Mapping[str, Any]
    identity: Any
    old_policy: dict[str, Any] | None
    schedule: Any

    @property
    def was_shared(self) -> bool:
        """Return whether the stored room followed the shared schedule."""
        stored = self.inherited.get("cadence")
        return isinstance(stored, Mapping) and stored.get("scope") == "shared"

    @property
    def schedule_fields(self) -> Mapping[str, Any]:
        """Return the shared schedule, empty when the room has none."""
        return self.schedule if isinstance(self.schedule, Mapping) else {}


def _assert_plan_can_be_added(plans: Mapping[str, Any], plan_id: str) -> None:
    """Reject a new plan with a reserved ID or beyond the per-robot limit."""
    if _is_manual_room_sequence_plan_id(plan_id):
        raise ValueError("This ID is reserved for manual Map Studio room runs")
    if len(plans) >= MAX_SAVED_PLANS_PER_ROBOT:
        raise SavedPlanLimitError(
            f"A Matic robot can have at most {MAX_SAVED_PLANS_PER_ROBOT} saved plans"
        )


def _is_room_sequence(value: object) -> TypeIs[Sequence[object]]:
    """Return whether a plan's rooms are a list rather than text."""
    return isinstance(value, Sequence) and not isinstance(value, (str, bytes))


def _stored_rooms(previous_plan: object) -> Sequence[object]:
    """Return the rooms of the plan being replaced."""
    rooms = previous_plan.get("rooms", []) if isinstance(previous_plan, Mapping) else []
    return rooms if _is_room_sequence(rooms) else ()


def _rooms_by_id(rooms: Sequence[object]) -> dict[str, Mapping[str, Any]]:
    """Return the well-formed stored rooms by room ID."""
    return {
        str(room.get("room_id")): room
        for room in rooms
        if isinstance(room, Mapping) and room.get("room_id")
    }


def _room_ids(rooms: Sequence[object]) -> list[str]:
    """Return the ID of each well-formed room, in order."""
    return [
        str(room["room_id"])
        for room in rooms
        if isinstance(room, Mapping) and room.get("room_id")
    ]


def _assert_room_count_allowed(
    raw_rooms: Sequence[object], previous_rooms: Sequence[object]
) -> None:
    """Hold a plan to the room limit unless it shrinks an older, larger one."""
    raw_room_ids = _room_ids(raw_rooms)
    legacy_room_reduction = (
        MAX_ROOM_SEQUENCE_SIZE < len(raw_rooms) <= MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE
        and len(previous_rooms) > MAX_ROOM_SEQUENCE_SIZE
        and len(raw_rooms) < len(previous_rooms)
        and len(raw_room_ids) == len(raw_rooms)
        and len(set(raw_room_ids)) == len(raw_room_ids)
        and not (Counter(raw_room_ids) - Counter(_room_ids(previous_rooms)))
    )
    if len(raw_rooms) > MAX_ROOM_SEQUENCE_SIZE and not legacy_room_reduction:
        raise RoomSequenceLimitError(
            f"A plan can include at most {MAX_ROOM_SEQUENCE_SIZE} rooms"
        )


def _normalize_room(save: _PlanSave, edits: _CadenceEdits, raw_room: object) -> None:
    """Add one normalized room and the cadence rows its edit touches."""
    if not isinstance(raw_room, Mapping):
        raise ValueError("plan contains an invalid room")
    room = deepcopy(dict(raw_room))
    room_id = str(room.get("room_id", ""))
    inherited = save.prior_rooms.get(room_id, {})
    bound_identity = save.room_identities.get(room_id)
    identity = bound_identity or inherited.get("cadence_identity")
    if (
        bound_identity
        and inherited.get("cadence_identity")
        and bound_identity != inherited["cadence_identity"]
    ):
        edits.reset_private_progress.add(room_id)
    prior_cadence = save.robot["plan_room_cadence"].get(save.plan_id, {}).get(room_id)
    if (
        identity is not None
        and isinstance(prior_cadence, Mapping)
        and prior_cadence.get("identity") != identity
    ):
        # Legacy progress without a map binding cannot be adopted by
        # the first verified floor identity during an edit.
        edits.reset_private_progress.add(room_id)
    old_policy = _inherited_policy(inherited)
    # An omitted field must not silently discard an inherited policy
    # that is inapplicable to the selected mode. Explicitly clear it
    # or choose a compatible mode before saving the plan.
    cadence_value = room.get("cadence", old_policy)
    if cadence_value is not None:
        policy = _room_policy(room, cadence_value)
        cadence = _RoomCadence(
            room_id=room_id,
            room=room,
            inherited=inherited,
            identity=identity,
            old_policy=old_policy,
            schedule=save.shared_cadence.get(room_id),
        )
        _apply_room_cadence(save, edits, cadence, policy)
    edits.rooms.append(room)


def _room_policy(room: Mapping[str, Any], value: object) -> dict[str, Any]:
    """Normalize a cadence policy against the room's cleaning settings."""
    return normalize_cadence_policy(
        value,
        cleaning_mode=str(room.get("cleaning_mode", "vacuum")),
        coverage_setting=str(room.get("coverage_setting", "standard")),
    )


def _inherited_policy(inherited: Mapping[str, Any]) -> dict[str, Any] | None:
    """Return the stored room's policy, or None when it has none or is invalid."""
    old_policy = inherited.get("cadence")
    if old_policy is None:
        return None
    try:
        return _room_policy(inherited, old_policy)
    except CoverageCadenceRequiresVacuumError:
        # Keep the previous shared-policy comparison meaningful when
        # repairing only the room's incompatible cleaning mode.
        return normalize_cadence_policy(
            old_policy,
            cleaning_mode="vacuum",
            coverage_setting=str(inherited.get("coverage_setting", "standard")),
        )
    except ValueError:
        return None


def _without_scope(policy: Mapping[str, Any]) -> dict[str, Any]:
    """Return the part of a policy a shared schedule stores."""
    return {key: value for key, value in policy.items() if key != "scope"}


def _apply_room_cadence(
    save: _PlanSave,
    edits: _CadenceEdits,
    cadence: _RoomCadence,
    policy: dict[str, Any],
) -> None:
    """Settle one room's policy and what it asks of the shared schedule."""
    room, room_id, schedule = cadence.room, cadence.room_id, cadence.schedule
    if _adopts_shared_schedule(cadence, policy):
        policy = _room_policy(room, {"scope": "shared", **schedule["policy"]})
    elif policy["scope"] == "plan" and cadence.was_shared:
        edits.reset_private_progress.add(room_id)
    active_shared = policy["scope"] == "shared" and (
        policy["mop_every_n"] is not None or policy["coverage_every_n"] is not None
    )
    if active_shared:
        if not _shared_binding_holds(save, cadence, policy):
            edits.binding_error = CadenceBindingError(
                "active shared room cadence requires a verified floor and room binding"
            )
    elif policy["scope"] == "shared" and not isinstance(schedule, Mapping):
        # A disabled shared policy is retained in the plan for
        # compatibility, but it does not create an unbound shared
        # schedule that a later run could mistake for durable state.
        edits.shared_updates = [
            item for item in edits.shared_updates if item[0] != room_id
        ]
    room["cadence"] = policy
    if cadence.identity is not None:
        room["cadence_identity"] = cadence.identity
    if (
        policy["scope"] == "shared"
        and (active_shared or isinstance(schedule, Mapping))
        and _shared_schedule_differs(save, cadence, policy)
    ):
        edits.shared_updates.append((room_id, policy))


def _adopts_shared_schedule(cadence: _RoomCadence, policy: Mapping[str, Any]) -> bool:
    """Return whether a room joining a shared schedule takes its policy."""
    schedule, identity = cadence.schedule, cadence.identity
    return (
        policy["scope"] == "shared"
        and isinstance(schedule, Mapping)
        and isinstance(schedule.get("policy"), Mapping)
        and (not identity or schedule.get("identity") in {None, identity})
        and (
            not cadence.was_shared
            or (
                cadence.old_policy is not None
                and _without_scope(policy) == _without_scope(cadence.old_policy)
            )
        )
    )


def _shared_binding_holds(
    save: _PlanSave, cadence: _RoomCadence, policy: Mapping[str, Any]
) -> bool:
    """Return whether an active shared policy has a verified or kept binding."""
    bound_identity = save.room_identities.get(cadence.room_id)
    if is_sha256_hex(save.floor_token) and is_sha256_hex(bound_identity):
        return True
    fields = cadence.schedule_fields
    schedule_identity = fields.get("identity")
    schedule_policy = fields.get("policy")
    stored_identity = cadence.inherited.get("cadence_identity")
    return (
        is_sha256_hex(schedule_identity)
        and is_sha256_hex(fields.get("floor_token"))
        and save.floor_token is None
        and bound_identity is None
        and cadence.was_shared
        and is_sha256_hex(stored_identity)
        and stored_identity == schedule_identity
        and isinstance(schedule_policy, Mapping)
        and dict(schedule_policy) == _without_scope(policy)
    )


def _shared_schedule_differs(
    save: _PlanSave, cadence: _RoomCadence, policy: Mapping[str, Any]
) -> bool:
    """Return whether the room's policy or binding changes its shared schedule."""
    fields = cadence.schedule_fields
    schedule_policy = fields.get("policy")
    return (
        not isinstance(schedule_policy, Mapping)
        or dict(schedule_policy) != _without_scope(policy)
        or (cadence.identity is not None and fields.get("identity") != cadence.identity)
        or (
            save.floor_token is not None
            and fields.get("floor_token") != save.floor_token
        )
    )


def _changed_plan_rooms(
    prior_rooms: Mapping[str, Mapping[str, Any]], rooms: Sequence[Mapping[str, Any]]
) -> set[str]:
    """Return the rooms whose stored policy or identity the save changes."""
    return {
        room_id
        for room_id in set(prior_rooms).union(room["room_id"] for room in rooms)
        if (
            prior_rooms.get(room_id, {}).get("cadence"),
            prior_rooms.get(room_id, {}).get("cadence_identity"),
        )
        != next(
            (
                (room.get("cadence"), room.get("cadence_identity"))
                for room in rooms
                if room["room_id"] == room_id
            ),
            None,
        )
    }


def _write_cadence_edits(save: _PlanSave, edits: _CadenceEdits) -> None:
    """Drop the reset private progress and write the shared schedules."""
    private_records = save.robot.setdefault("plan_room_cadence", {}).setdefault(
        save.plan_id, {}
    )
    for room_id in edits.reset_private_progress:
        private_records.pop(room_id, None)
    for room_id, policy in edits.shared_updates:
        room_identity = save.room_identities.get(room_id)
        if room_identity is None:
            room_identity = next(
                (
                    room.get("cadence_identity")
                    for room in edits.rooms
                    if room.get("room_id") == room_id
                ),
                None,
            )
        _write_shared_schedule(
            save.robot.setdefault("shared_room_cadence", {}),
            room_id,
            policy,
            room_identity=room_identity,
            floor_token=save.floor_token,
        )


def _write_shared_schedule(
    schedules: dict[str, Any],
    room_id: str,
    policy: Mapping[str, Any],
    *,
    room_identity: str | None,
    floor_token: str | None,
) -> None:
    """Store one room's shared policy, restarting progress on a new binding."""
    schedule = schedules.get(room_id)
    if not isinstance(schedule, dict):
        schedule = {
            "progress": {"mop": 0, "coverage": 0},
            "identity": room_identity,
            "native_since": dt_util.utcnow().isoformat(),
        }
        schedules[room_id] = schedule
    elif room_identity is not None and schedule.get("identity") != room_identity:
        # A reused room ID on a different native floor identity starts
        # a new shared schedule and cannot inherit ambiguous progress.
        _restart_shared_progress(schedule, room_identity)
    elif floor_token is not None and schedule.get("floor_token") != floor_token:
        # A verified floor rebind must not carry progress from an
        # older map whose room identity happened to remain stable.
        _restart_shared_progress(schedule)
    schedule["policy"] = _without_scope(policy)
    if floor_token is not None:
        schedule["floor_token"] = floor_token
    schedule["revision"] = min(
        2_147_483_647, plan_timing._stored_count(schedule, "revision") + 1
    )


def _restart_shared_progress(
    schedule: dict[str, Any], identity: str | None = None
) -> None:
    """Zero a shared schedule's progress, under a new identity when given."""
    schedule["progress"] = {"mop": 0, "coverage": 0}
    if identity is not None:
        schedule["identity"] = identity
    schedule["native_since"] = dt_util.utcnow().isoformat()
    schedule.pop("accounting", None)
    schedule.pop("native_events", None)
    schedule.pop("native_binding", None)
    schedule.pop("accounting_unverified", None)
