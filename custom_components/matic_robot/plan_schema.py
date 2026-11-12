"""JSON the plans and daily limit views send and accept.

`scripts/contract_types.py` generates Matic Map's types from these, as from
`map_schema`; for the same reason this module does not postpone annotations.
Cleaning modes and coverage settings are passed on as plans store them, so
they are plain strings here.
"""

from typing import Literal, NotRequired, TypedDict

type CadenceReason = Literal[
    "coverage_requires_vacuum",
    "mop_due",
    "coverage_due",
    "room_not_on_current_map",
    "identity_changed",
    "shared_schedule_unavailable",
    "mop_progress_unverified",
    "coverage_progress_unverified",
    "cadence_progress_unverified",
    "invalid_cadence_policy",
]
type PlanBlocker = Literal[
    "area_map_changed",
    "area_missing",
    "coverage_requires_vacuum",
    "cadence_identity_unavailable",
    "preview_unavailable",
    "plan_disabled",
    "plan_has_no_rooms",
    "plan_room_limit",
    "cadence_identity_changed",
    "shared_schedule_unavailable",
    "cadence_progress_unverified",
    "invalid_cadence_policy",
    "invalid_plan",
    "plan_rooms_held",
    "daily_limit_reached",
]
type DailyLimitReason = Literal[
    "invalid_policy",
    "room_identity_unconfirmed",
    "timezone_unavailable",
    "completion_history_unverified",
]
type DailyLimitRefusal = Literal[
    "invalid_json",
    "invalid_request",
    "map_rechecking",
    "room_identity_unconfirmed",
    "room_reserved",
    "runtime_unloading",
]


class DailyLimit(TypedDict):
    """A room's daily cap and today's verified cleans; `reason` when unsure."""

    limit: int | None
    completed_today: int
    reached: bool
    reason: NotRequired[DailyLimitReason]


class DailyLimitHeldRoom(DailyLimit):
    room_id: str
    name: str


class DailyLimitSet(TypedDict):
    """The body that sets (`limit`) or clears (`null`) a room's daily cap."""

    room_id: str
    floor_token: str
    limit: int | None


class DailyLimitRefused(TypedDict):
    error: DailyLimitRefusal


class CadencePolicy(TypedDict):
    scope: Literal["plan", "shared"]
    mop_every_n: int | None
    coverage_every_n: int | None
    periodic_coverage_setting: str | None
    do_mop_next: bool
    do_coverage_next: bool


class CadenceProgress(CadencePolicy):
    """A policy with its counts and the settings the next clean takes."""

    mop_progress: int
    coverage_progress: int
    mop_due: bool
    coverage_due: bool
    effective_cleaning_mode: str
    effective_coverage_setting: str
    next_mop_in: int | None
    next_coverage_in: int | None


class PlanRoom(TypedDict):
    room_id: str
    cleaning_mode: str
    coverage_setting: str
    daily_limit: NotRequired[DailyLimit]
    cadence: NotRequired[CadencePolicy | None]
    cadence_progress: NotRequired[CadenceProgress | None]
    cadence_reasons: NotRequired[list[CadenceReason]]


class PlanRoomEntry(TypedDict):
    kind: Literal["room"]
    room_id: str


class PlanAreaEntry(TypedDict):
    kind: Literal["area"]
    area_id: str
    cleaning_mode: str
    coverage_setting: str
    name: str


class PreviewRoom(TypedDict):
    room_id: str
    name: str
    cleaning_mode: str
    coverage_setting: str
    cadence_reasons: list[CadenceReason]
    daily_limit: NotRequired[DailyLimit]


class PreviewRoomStep(PreviewRoom):
    kind: Literal["room"]


class PreviewAreaStep(TypedDict):
    """A custom area in a preview; areas run every time, so no reasons."""

    kind: Literal["area"]
    area_id: str
    name: str
    cleaning_mode: str
    coverage_setting: str
    cadence_reasons: list[CadenceReason]


class HeldRoom(TypedDict):
    """A room an occupancy sensor holds out of this run."""

    room_id: str
    name: str
    reason: str
    sensor: str


class NextRunPreview(TypedDict):
    """The next run in order; a blocked preview names its `blocker`."""

    rooms: list[PreviewRoom]
    entries: NotRequired[list[PreviewRoomStep | PreviewAreaStep]]
    mission_boundaries: list[int]
    daily_limit_held_rooms: NotRequired[list[DailyLimitHeldRoom]]
    held_rooms: NotRequired[list[HeldRoom]]
    preview_token: NotRequired[str]
    blocker: PlanBlocker | None


class SavedPlan(TypedDict):
    id: str
    name: str
    enabled: bool
    run_behavior: str
    rooms: list[PlanRoom]
    room_order: list[str]
    entries: list[PlanRoomEntry | PlanAreaEntry]
    return_to_base: bool
    finish_current_room: bool
    finish_current_room_threshold: int
    occupancy_aware: bool
    occupancy_sensors: dict[str, str]
    next_run_preview: NextRunPreview
    next_run_estimate_seconds: int | None


class PlanCatalogRoom(TypedDict):
    """A room on the current map, with its shared schedule and daily cap."""

    room_id: str
    name: str
    daily_limit: NotRequired[DailyLimit]
    shared_cadence_delete_token: NotRequired[str]
    shared_cadence: NotRequired[CadencePolicy]
    shared_cadence_progress: NotRequired[CadenceProgress | None]
    shared_cadence_reasons: NotRequired[list[CadenceReason]]


class PlansCatalog(TypedDict):
    entry_id: str
    floor_token: str
    rooms: list[PlanCatalogRoom]
    plans: list[SavedPlan]
    selected_plan: str | None
