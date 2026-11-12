"""Messages the administrator-only workspace socket sends and accepts.

`scripts/contract_types.py` generates Matic Map's types from these, as from
`map_schema`; for the same reason this module does not postpone annotations.
"""

from typing import Literal, NotRequired, TypedDict

from .map_schema import CatalogEntry

type RecoveryReason = Literal[
    "gap",
    "overflow",
    "restart",
    "entry_removed",
    "authorization",
    "snapshot_required",
]


class WorkspaceSnapshotRequest(TypedDict):
    type: Literal["matic_robot/workspace_snapshot"]
    version: int
    entry_id: str


class WorkspaceSubscribeRequest(TypedDict):
    type: Literal["matic_robot/workspace_subscribe"]
    version: int
    entry_id: str
    poses: NotRequired[bool]


class WorkspaceIdentity(TypedDict):
    entry_id: str
    floor_mission_id: int | None
    floor_verified: bool


class WorkspaceStatus(TypedDict):
    state: Literal["ready", "stale", "unavailable"]
    reason: RecoveryReason | None
    retryable: bool


class WorkspacePayload(TypedDict):
    available: bool
    entry: CatalogEntry | None


class WorkspaceSnapshot(TypedDict):
    """The reply to a snapshot request; revisions are named per resource."""

    schema: int
    capabilities: dict[str, int]
    epoch: str
    sequence: int
    coherence_generation: int
    entry_id: str
    identity: WorkspaceIdentity
    status: WorkspaceStatus
    revisions: dict[str, int]
    payload: WorkspacePayload


class WorkspaceSubscribed(TypedDict):
    """The reply to a subscribe request, before its events."""

    version: int
    epoch: str
    sequence: int
    queue_limit: int


class WorkspaceInvalidation(TypedDict):
    epoch: str
    sequence: int
    coherence_generation: int
    revisions: dict[str, int]
    resources: list[str]


class PoseUpdate(TypedDict):
    """The robot's position on the current map, in map metres and radians."""

    position: list[float] | None
    heading: float | None
    source: str
    scene_revision: int | None
    scene_epoch: str | None
    map_floor_coherent: bool
    map_session_key: str | None
    pose_age_seconds: float | None
    observed_at: float | None


class InvalidateEvent(TypedDict):
    type: Literal["invalidate"]
    invalidation: WorkspaceInvalidation


class ResyncEvent(TypedDict):
    type: Literal["resync"]
    reason: RecoveryReason


class PoseEvent(TypedDict):
    type: Literal["pose"]
    pose: PoseUpdate


type WorkspaceEvent = InvalidateEvent | ResyncEvent | PoseEvent
