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
from typing import Any, cast

from homeassistant.exceptions import HomeAssistantError

from . import area_binding_formats as binding_formats
from . import area_binding_geometry as binding_geometry
from . import native_history, plan_timing
from .area_binding import (
    AreaBindingStatus,
    area_binding_status,
    binding_for_area,
)
from .area_geometry import GeometryTooComplex
from .cadence import (
    CoverageCadenceRequiresVacuumError,
    normalize_cadence_policy,
)
from .client.floor_plan import MAX_FLOOR_PLAN_BOUNDARY_POINTS
from .client.models import FloorPlan
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
    plan_entries,
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
            async with self.repository.store_lock:
                areas_before = deepcopy(self.repository.robot(serial_number)["areas"])
                try:
                    result = await self.async_upgrade_area_bindings_transaction(
                        serial_number, floor_plan
                    )
                    if result.upgraded:
                        await self.repository.store.async_save(self.repository.data)
                except BaseException:
                    self.repository.robot(serial_number)["areas"] = areas_before
                    raise
                return result

        def notify_if_upgraded(result: AreaBindingUpgradeResult) -> None:
            if result.upgraded:
                self.repository.notify_listeners(serial_number)

        result = await self.repository.async_run_owned_metadata(
            serial_number, commit, after_commit=notify_if_upgraded
        )
        return cast(AreaBindingUpgradeResult, result)

    async def async_upgrade_area_bindings_transaction(
        self, serial_number: str, floor_plan: FloorPlan | None
    ) -> AreaBindingUpgradeResult:
        """Apply a verified Area binding migration inside its Store transaction."""
        upgraded = 0
        pending = False
        room_geometry = None
        areas = self.repository.robot(serial_number)["areas"]
        staged: list[tuple[MutableMapping[str, Any], dict[str, Any]]] = []
        for area in areas.values():
            if not isinstance(area, MutableMapping):
                continue
            binding = area.get("map_binding")
            if not isinstance(binding, Mapping):
                continue
            version = binding.get("version")
            if isinstance(version, bool) or not isinstance(version, int):
                continue
            if version not in {
                binding_formats.MAP_BINDING_VERSION,
                binding_formats.HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                binding_formats.BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                binding_formats.ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                binding_formats.SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                binding_formats.SCOPED_MAP_BINDING_VERSION,
            }:
                continue
            if version in {
                binding_formats.ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                binding_formats.SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            }:
                continue
            if version == binding_formats.SCOPED_MAP_BINDING_VERSION:
                anchors = binding.get("translation_room_anchors")
                if (
                    isinstance(anchors, list)
                    and anchors
                    and all(
                        isinstance(anchor, Mapping) and "boundary_mm" in anchor
                        for anchor in anchors
                    )
                ):
                    continue
            circles = area.get("circles")
            if not isinstance(circles, list):
                continue
            if floor_plan is None:
                pending = True
                continue
            if version in {
                binding_formats.HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                binding_formats.BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                binding_formats.SCOPED_MAP_BINDING_VERSION,
            }:
                if room_geometry is None:
                    room_geometry = binding_geometry._room_geometry_index(floor_plan)
                current_room_anchors: list[dict[str, Any]] = []
                status = area_binding_status(
                    area,
                    floor_plan,
                    room_geometry=room_geometry,
                    _current_room_anchors=current_room_anchors,
                )
            else:
                # Whole-map bindings can reject mission, partition, or map
                # changes without constructing any polygon geometry index.
                status = area_binding_status(area, floor_plan)
            if status is not AreaBindingStatus.CURRENT:
                pending = pending or status in {
                    AreaBindingStatus.GEOMETRY_CHANGED,
                    AreaBindingStatus.INVALID,
                }
                continue
            if version == binding_formats.SCOPED_MAP_BINDING_VERSION and str(
                binding.get("geometry_sha256", "")
            ).casefold() != binding_geometry.floor_plan_geometry_fingerprint(
                floor_plan
            ):
                try:
                    # Keep the index and work budget already used by status.
                    assert room_geometry is not None
                    grafted_binding = (
                        binding_geometry._graft_legacy_room_frame_boundaries(
                            binding,
                            current_room_anchors,
                            room_geometry=room_geometry,
                        )
                    )
                except GeometryTooComplex:
                    # Exact anchor-only migration shares the status query's
                    # request budget and fails closed when that budget ends.
                    return AreaBindingUpgradeResult(0, True)
                if grafted_binding is None:
                    # Do not partially commit another migration if a candidate
                    # legacy frame cannot be proven without rebasing.
                    return AreaBindingUpgradeResult(0, True)
                staged.append((area, grafted_binding))
                continue
            if room_geometry is None:
                room_geometry = binding_geometry._room_geometry_index(floor_plan)
            try:
                upgraded_binding = binding_for_area(
                    floor_plan, circles, room_geometry=room_geometry
                )
            except GeometryTooComplex:
                # Status verification and replacement share one bounded index.
                # If replacement exhausts it, keep the migration pending for a
                # later map revision instead of silently treating it as done.
                pending = True
                continue
            except KeyError, TypeError, ValueError:
                continue
            staged.append((area, upgraded_binding))
        projected_points = binding_geometry.total_room_frame_point_count(areas)
        for area, upgraded_binding in staged:
            projected_points += binding_geometry.room_frame_point_count(
                {"map_binding": upgraded_binding}
            ) - binding_geometry.room_frame_point_count(area)
        if projected_points > _MAX_PERSISTED_ROOM_FRAME_POINTS_PER_ROBOT:
            return AreaBindingUpgradeResult(0, True)
        for area, upgraded_binding in staged:
            area["map_binding"] = upgraded_binding
            upgraded += 1
        return AreaBindingUpgradeResult(upgraded, pending)

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
                binding_geometry.total_room_frame_point_count(areas)
                - binding_geometry.room_frame_point_count(areas.get(area_id, {}))
                + binding_geometry.room_frame_point_count(area)
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
            async with self.repository.user_metadata_store_transaction(serial_number):
                robot = self.repository.robot(serial_number)
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
                before = deepcopy(robot)
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
                await self.repository.async_save_with_rollback(serial_number, before)

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
            async with self.repository.user_metadata_store_transaction(serial_number):
                await self.async_save_plan_transaction(
                    serial_number,
                    plan_id,
                    plan,
                    select=select,
                    floor_token=floor_token,
                    room_identities=room_identities,
                )

        await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.repository.plan_write_lock(serial_number),),
            notify=True,
            reject_on_admission_close=True,
        )

    async def async_save_plan_transaction(
        self,
        serial_number: str,
        plan_id: str,
        plan: Mapping[str, Any],
        *,
        select: bool,
        floor_token: str | None,
        room_identities: Mapping[str, str] | None,
    ) -> None:
        """Create or replace a validated room-native plan definition."""
        robot = self.repository.robot(serial_number)
        before = deepcopy(robot)
        plans = robot["plans"]
        if plan_id not in plans and _is_manual_room_sequence_plan_id(plan_id):
            raise ValueError("This ID is reserved for manual Map Studio room runs")
        if plan_id not in plans and len(plans) >= MAX_SAVED_PLANS_PER_ROBOT:
            raise SavedPlanLimitError(
                "A Matic robot can have at most "
                f"{MAX_SAVED_PLANS_PER_ROBOT} saved plans"
            )
        saved_plan = deepcopy(dict(plan))
        raw_rooms = saved_plan.get("rooms", [])
        previous_rooms: Sequence[object] = ()
        if isinstance(raw_rooms, Sequence) and not isinstance(raw_rooms, (str, bytes)):
            previous_plan = plans.get(plan_id, {})
            raw_previous_rooms = (
                previous_plan.get("rooms", [])
                if isinstance(previous_plan, Mapping)
                else []
            )
            previous_rooms = (
                raw_previous_rooms
                if isinstance(raw_previous_rooms, Sequence)
                and not isinstance(raw_previous_rooms, (str, bytes))
                else ()
            )
            previous_count = len(previous_rooms)
            previous_room_ids = Counter(
                str(room["room_id"])
                for room in previous_rooms
                if isinstance(room, Mapping) and room.get("room_id")
            )
            raw_room_ids = [
                str(room["room_id"])
                for room in raw_rooms
                if isinstance(room, Mapping) and room.get("room_id")
            ]
            legacy_room_reduction = (
                MAX_ROOM_SEQUENCE_SIZE
                < len(raw_rooms)
                <= MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE
                and previous_count > MAX_ROOM_SEQUENCE_SIZE
                and len(raw_rooms) < previous_count
                and len(raw_room_ids) == len(raw_rooms)
                and len(set(raw_room_ids)) == len(raw_room_ids)
                and not (Counter(raw_room_ids) - previous_room_ids)
            )
            if len(raw_rooms) > MAX_ROOM_SEQUENCE_SIZE and not legacy_room_reduction:
                raise RoomSequenceLimitError(
                    f"A plan can include at most {MAX_ROOM_SEQUENCE_SIZE} rooms"
                )
        prior_rooms = {
            str(room.get("room_id")): room
            for room in previous_rooms
            if isinstance(room, Mapping) and room.get("room_id")
        }
        normalized_rooms: list[dict[str, Any]] = []
        shared_updates: list[tuple[str, dict[str, Any]]] = []
        reset_private_progress: set[str] = set()
        binding_error: CadenceBindingError | None = None
        shared_cadence = self.repository.robot(serial_number).get(
            "shared_room_cadence", {}
        )
        room_identities = room_identities or {}

        def valid_binding_token(value: object) -> bool:
            """Accept only tokens produced by the native binding helpers."""
            return (
                isinstance(value, str)
                and len(value) == 64
                and all(char in "0123456789abcdef" for char in value)
            )

        for raw_room in saved_plan.get("rooms", []):
            if not isinstance(raw_room, Mapping):
                raise ValueError("plan contains an invalid room")
            room = deepcopy(dict(raw_room))
            room_id = str(room.get("room_id", ""))
            inherited = prior_rooms.get(room_id, {})
            identity = room_identities.get(room_id) or inherited.get("cadence_identity")
            if (
                room_identities.get(room_id)
                and inherited.get("cadence_identity")
                and room_identities[room_id] != inherited["cadence_identity"]
            ):
                reset_private_progress.add(room_id)
            prior_cadence = (
                self.repository.robot(serial_number)["plan_room_cadence"]
                .get(plan_id, {})
                .get(room_id)
            )
            if (
                identity is not None
                and isinstance(prior_cadence, Mapping)
                and prior_cadence.get("identity") != identity
            ):
                # Legacy progress without a map binding cannot be adopted by
                # the first verified floor identity during an edit.
                reset_private_progress.add(room_id)
            old_policy = inherited.get("cadence")
            try:
                normalized_old_policy = (
                    normalize_cadence_policy(
                        old_policy,
                        cleaning_mode=str(inherited.get("cleaning_mode", "vacuum")),
                        coverage_setting=str(
                            inherited.get("coverage_setting", "standard")
                        ),
                    )
                    if old_policy is not None
                    else None
                )
            except CoverageCadenceRequiresVacuumError:
                # Keep the previous shared-policy comparison meaningful when
                # repairing only the room's incompatible cleaning mode.
                normalized_old_policy = normalize_cadence_policy(
                    old_policy,
                    cleaning_mode="vacuum",
                    coverage_setting=str(inherited.get("coverage_setting", "standard")),
                )
            except ValueError:
                normalized_old_policy = None
            # An omitted field must not silently discard an inherited policy
            # that is inapplicable to the selected mode. Explicitly clear it
            # or choose a compatible mode before saving the plan.
            cadence_value = room.get("cadence", normalized_old_policy)
            if cadence_value is not None:
                policy = normalize_cadence_policy(
                    cadence_value,
                    cleaning_mode=str(room.get("cleaning_mode", "vacuum")),
                    coverage_setting=str(room.get("coverage_setting", "standard")),
                )
                schedule = shared_cadence.get(room_id)
                policy_marker = {
                    key: value for key, value in policy.items() if key != "scope"
                }
                old_marker = (
                    {
                        key: value
                        for key, value in normalized_old_policy.items()
                        if key != "scope"
                    }
                    if normalized_old_policy is not None
                    else None
                )
                if (
                    policy["scope"] == "shared"
                    and isinstance(schedule, Mapping)
                    and isinstance(schedule.get("policy"), Mapping)
                    and (not identity or schedule.get("identity") in {None, identity})
                    and (
                        not isinstance(old_policy, Mapping)
                        or old_policy.get("scope") != "shared"
                        or policy_marker == old_marker
                    )
                ):
                    policy = normalize_cadence_policy(
                        {"scope": "shared", **schedule["policy"]},
                        cleaning_mode=str(room.get("cleaning_mode", "vacuum")),
                        coverage_setting=str(room.get("coverage_setting", "standard")),
                    )
                elif (
                    policy["scope"] == "plan"
                    and isinstance(old_policy, Mapping)
                    and old_policy.get("scope") == "shared"
                ):
                    reset_private_progress.add(room_id)
                active_shared = policy["scope"] == "shared" and (
                    policy["mop_every_n"] is not None
                    or policy["coverage_every_n"] is not None
                )
                if active_shared:
                    bound_identity = room_identities.get(room_id)
                    has_verified_binding = valid_binding_token(
                        floor_token
                    ) and valid_binding_token(bound_identity)
                    schedule_identity = (
                        schedule.get("identity")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    schedule_floor = (
                        schedule.get("floor_token")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    schedule_policy = (
                        schedule.get("policy")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    previously_bound_shared_room = (
                        isinstance(old_policy, Mapping)
                        and old_policy.get("scope") == "shared"
                        and valid_binding_token(inherited.get("cadence_identity"))
                        and inherited.get("cadence_identity") == schedule_identity
                    )
                    schedule_is_bound = (
                        valid_binding_token(schedule_identity)
                        and valid_binding_token(schedule_floor)
                        and floor_token is None
                        and bound_identity is None
                        and previously_bound_shared_room
                        and isinstance(schedule_policy, Mapping)
                        and dict(schedule_policy)
                        == {
                            key: value
                            for key, value in policy.items()
                            if key != "scope"
                        }
                    )
                    if not has_verified_binding and not schedule_is_bound:
                        binding_error = CadenceBindingError(
                            "active shared room cadence requires a verified floor "
                            "and room binding"
                        )
                elif policy["scope"] == "shared" and not isinstance(schedule, Mapping):
                    # A disabled shared policy is retained in the plan for
                    # compatibility, but it does not create an unbound shared
                    # schedule that a later run could mistake for durable state.
                    shared_updates = [
                        item for item in shared_updates if item[0] != room_id
                    ]
                room["cadence"] = policy
                if identity is not None:
                    room["cadence_identity"] = identity
                if policy["scope"] == "shared" and (
                    active_shared or isinstance(schedule, Mapping)
                ):
                    policy_marker = {
                        key: value for key, value in policy.items() if key != "scope"
                    }
                    schedule_policy = (
                        schedule.get("policy")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    schedule_identity = (
                        schedule.get("identity")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    schedule_floor = (
                        schedule.get("floor_token")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    if (
                        not isinstance(schedule_policy, Mapping)
                        or dict(schedule_policy) != policy_marker
                        or (identity is not None and schedule_identity != identity)
                        or (floor_token is not None and schedule_floor != floor_token)
                    ):
                        shared_updates.append((room_id, policy))
            normalized_rooms.append(room)
        saved_plan["rooms"] = normalized_rooms
        saved_plan["entries"] = self.normalized_plan_entries(
            robot, saved_plan.get("entries"), normalized_rooms
        )
        retained_room_ids = {room["room_id"] for room in normalized_rooms}
        reset_private_progress.update(set(prior_rooms) - retained_room_ids)
        changed_plan_rooms = {
            room_id
            for room_id in set(prior_rooms).union(
                room["room_id"] for room in normalized_rooms
            )
            if (
                prior_rooms.get(room_id, {}).get("cadence"),
                prior_rooms.get(room_id, {}).get("cadence_identity"),
            )
            != next(
                (
                    (room.get("cadence"), room.get("cadence_identity"))
                    for room in normalized_rooms
                    if room["room_id"] == room_id
                ),
                None,
            )
        }
        changed_plan_rooms.update(reset_private_progress)
        changed_shared_rooms = {room_id for room_id, _policy in shared_updates}
        self.cadence.assert_cadence_edit_allowed(
            serial_number,
            plan_id,
            saved_plan,
            shared_updates,
            changed_plan_rooms=changed_plan_rooms,
        )
        if binding_error is not None:
            raise binding_error
        private_records = (
            self.repository.robot(serial_number)
            .setdefault("plan_room_cadence", {})
            .setdefault(plan_id, {})
        )
        for room_id in reset_private_progress:
            private_records.pop(room_id, None)
        for room_id, policy in shared_updates:
            room_identity = room_identities.get(room_id)
            if room_identity is None:
                room_identity = next(
                    (
                        raw.get("cadence_identity")
                        for raw in normalized_rooms
                        if raw.get("room_id") == room_id
                    ),
                    None,
                )
            schedules = self.repository.robot(serial_number).setdefault(
                "shared_room_cadence", {}
            )
            schedule = schedules.get(room_id)
            if not isinstance(schedule, dict):
                schedule = {
                    "progress": {"mop": 0, "coverage": 0},
                    "identity": room_identity,
                }
                schedules[room_id] = schedule
            elif (
                room_identity is not None and schedule.get("identity") != room_identity
            ):
                # A reused room ID on a different native floor identity starts
                # a new shared schedule and cannot inherit ambiguous progress.
                schedule["progress"] = {"mop": 0, "coverage": 0}
                schedule["identity"] = room_identity
            elif floor_token is not None and schedule.get("floor_token") != floor_token:
                # A verified floor rebind must not carry progress from an
                # older map whose room identity happened to remain stable.
                schedule["progress"] = {"mop": 0, "coverage": 0}
            schedule["policy"] = {
                key: value for key, value in policy.items() if key != "scope"
            }
            if floor_token is not None:
                schedule["floor_token"] = floor_token
            schedule["revision"] = min(
                2_147_483_647, plan_timing._stored_count(schedule, "revision") + 1
            )
        plans[plan_id] = saved_plan
        if select or robot.get("selected_plan") is None:
            robot["selected_plan"] = plan_id
        mutation_token = self.cadence.begin_cadence_mutation(
            serial_number,
            _CadenceMutation(
                plan_id,
                frozenset(changed_plan_rooms),
                frozenset(changed_shared_rooms),
            ),
        )
        try:
            await self.repository.async_save_with_rollback(serial_number, before)
        finally:
            self.cadence.end_cadence_mutation(serial_number, mutation_token)

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
            async with self.repository.user_metadata_store_transaction(serial_number):
                await self.async_delete_plan_transaction(serial_number, plan_id)

        await self.repository.async_run_owned_metadata(
            serial_number,
            commit,
            domain_locks=(self.repository.plan_write_lock(serial_number),),
            notify=True,
            reject_on_admission_close=True,
        )

    async def async_delete_plan_transaction(
        self, serial_number: str, plan_id: str
    ) -> None:
        """Delete one saved plan without deleting unrelated history."""
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
        before = deepcopy(robot)
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
        mutation_token = self.cadence.begin_cadence_mutation(
            serial_number,
            _CadenceMutation(plan_id, plan_room_ids, frozenset(), deletes_plan=True),
        )
        try:
            await self.repository.async_save_with_rollback(serial_number, before)
        finally:
            self.cadence.end_cadence_mutation(serial_number, mutation_token)

    async def async_select_plan(self, serial_number: str, plan_id: str) -> None:
        """Persist the selected plan used by native entities."""

        async def commit(_lease: _MetadataLockLease) -> None:
            async with self.repository.user_metadata_store_transaction(serial_number):
                robot = self.repository.robot(serial_number)
                if plan_id not in robot["plans"]:
                    raise KeyError(plan_id)
                before = deepcopy(robot)
                robot["selected_plan"] = plan_id
                await self.repository.async_save_with_rollback(serial_number, before)

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

    def area_name(self, serial_number: str, area_id: str | None) -> str | None:
        if area_id is None:
            return None
        area = self.repository.robot(serial_number)["areas"].get(area_id)
        return str(area.get("name", area_id)) if area else area_id
