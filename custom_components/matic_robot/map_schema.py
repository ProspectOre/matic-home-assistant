"""JSON the map views send and accept, as the views build it.

`scripts/contract_types.py` generates Matic Map's `backend-schema.ts` from
these types. Without `from __future__ import annotations`: the generator
reads `NotRequired` from the class, which postponed annotations hide.
"""

from typing import Literal, NotRequired, TypedDict

from .area_binding import AreaBindingStatus
from .client import CleaningMode, CoverageSetting

type MapHealthState = Literal[
    "empty", "collecting", "incomplete", "ready", "truncated", "degraded"
]
type MapStreamState = Literal["idle", "connecting", "connected", "retrying"]
type MapBootstrapState = Literal[
    "not_started", "running", "complete", "partial", "failed"
]
type MapBlockReason = Literal[
    "bootstrap_empty",
    "map_session_unverified",
    "floor_plan_unavailable",
    "floor_plan_mismatch",
]
type RunOutcome = Literal["running", "finished", "not_finished", "unknown"]
# Map metres, then the robot's own observation time of that pose in epoch
# seconds (latest_pose field 5). Points saved before times were kept have none.
type TrailPoint = tuple[float, float] | tuple[float, float, int]


class CatalogEntry(TypedDict):
    """One robot's map state, in the catalog and the workspace snapshot."""

    entry_id: str
    live_workspace_transport_enabled: bool
    scene_url: str
    history_url: str
    areas_url: str
    plans_url: str
    wifi_heatmap_url: str
    floor_layers_url: str
    history_count: int
    history_floor_count: int
    map_revision: int
    scene_revision: int | None
    map_scene_epoch: str | None
    map_floor_coherent: bool
    selected_floor_ordinal: int | None
    map_floor_ordinal: int | None
    map_session_verified: bool
    map_session_key: str | None
    map_block_reason: MapBlockReason | None
    runner_locked: bool
    stop_settle_pending: bool
    active_plan: bool
    native_reconciliation_pending: bool
    native_session_active: bool | None
    map_health: MapHealthState
    map_complete: bool
    map_truncated: bool
    stream_failures: int
    bootstrap_state: MapBootstrapState
    bootstrap_photo_seen: bool
    bootstrap_structure_seen: bool
    bootstrap_failures: int


class CatalogRow(CatalogEntry):
    """A catalog entry with the tile counts only the HTTP catalog carries."""

    cached_tiles: int
    structural_tiles: int
    overlapping_tiles: int
    layer_overlap: float
    dropped_photo_tiles: int
    dropped_structure_tiles: int
    invalid_tiles: int
    stream_state: MapStreamState


class Catalog(TypedDict):
    entries: list[CatalogRow]


class HistoryFrameCoverage(TypedDict):
    status: str
    observed_cells: int
    mask_sha256: str | None
    diff_eligible: bool


class HistoryFrame(TypedDict):
    """A saved map's frame, passed on as its record stores it.

    An imported map's coverage is the string `unknown`: it cannot be compared.
    """

    format_version: int
    coordinate_version: int
    origin_cells: list[int] | None
    meters_per_cell: float | None
    span_cells: list[int] | None
    coverage: HistoryFrameCoverage | Literal["unknown"]
    diff_eligible: bool


class HistoryMetadata(TypedDict):
    """A saved map's metadata, without its scene."""

    id: str
    content_id: str
    created_at: str
    revision: int
    point_count: int
    name: str | None
    retention: str
    deleted_until: str | None
    imported: bool
    comparison_group: str | None
    frame: HistoryFrame | None


class HistorySnapshot(HistoryMetadata):
    scene_url: str


class HistoryFloor(TypedDict):
    """The live floor has no ordinal; a saved floor has no live flag."""

    id: str
    active: bool
    read_only: bool
    live_available: NotRequired[bool]
    ordinal: NotRequired[int | None]
    label: str | None
    snapshots: list[HistorySnapshot]


class HistoryCatalog(TypedDict):
    entry_id: str
    live_available: bool
    snapshots: list[HistorySnapshot]
    floors: list[HistoryFloor]


class RunItem(TypedDict):
    name: str
    result: str


class RunEntry(TypedDict):
    """One clean; `ending` and item results pass on what the records hold."""

    id: str
    source: Literal["home_assistant", "robot"]
    started_at: str | None
    ended_at: str | None
    plan_name: str | None
    outcome: RunOutcome
    ending: str
    rooms: list[RunItem]
    areas: list[RunItem]
    thumbnail: str | None


class RunRecord(RunEntry):
    trail: str | None


class RunHistory(TypedDict):
    entry_id: str
    map_session_key: str | None
    robot_history: bool
    runs: list[RunRecord]


class RunTrail(TypedDict):
    trail: str
    map_session_key: str | None
    segments: list[list[TrailPoint]]


class MapRoom(TypedDict):
    room_id: str
    name: str
    boundary: list[list[float]]


class AreaCircle(TypedDict):
    x: float
    y: float
    radius: float


class AreaPoint(TypedDict):
    x: float
    y: float


class SavedArea(TypedDict):
    """A saved area; circles and outline are left out while it is unbound."""

    id: str
    name: str
    circles: list[AreaCircle]
    outline: NotRequired[list[AreaPoint]]
    cleaning_mode: CleaningMode
    coverage_setting: CoverageSetting
    status: AreaBindingStatus
    can_rebind: bool


class MapZoneOverlay(TypedDict):
    kind: str
    outline: list[list[float]]
    holes: list[list[list[float]]]
    room_ids: list[str]
    area_ids: list[str]


class AreasCatalog(TypedDict):
    scene_url: str
    rooms: list[MapRoom]
    areas: list[SavedArea]
    selected_area: str | None
    zones: list[MapZoneOverlay]


class AreaSave(TypedDict):
    """The body that creates (no `area_id`) or replaces an area."""

    area_id: NotRequired[str]
    name: str
    circles: list[AreaCircle]
    outline: NotRequired[list[AreaPoint]]
    cleaning_mode: CleaningMode
    coverage_setting: CoverageSetting


class AreaSaved(TypedDict):
    id: str


class AreaInUse(TypedDict):
    """A refused delete: the plans the area would leave with nothing to clean."""

    plans: list[str]


class FloorLayerOutlines(TypedDict):
    carpet: list[list[list[float]]]
    vent: list[list[list[float]]]


class FloorLayers(TypedDict):
    entry_id: str
    page_count: int
    truncated: bool
    layers: FloorLayerOutlines


class HistoryUsage(TypedDict):
    """Saved-map storage: counts and compressed bytes, active and in trash."""

    record_count: int
    automatic_count: int
    kept_count: int
    trash_count: int
    compressed_bytes: int
    active_compressed_bytes: int
    trash_compressed_bytes: int
    reserved_bytes: int
    reserved_count: int
    active_read_count: int
    active_read_bytes: int


class HistoryRecord(HistoryMetadata):
    """A saved map as the manager lists it; one in trash has no scene URL."""

    scene_url: str | None
    compressed_bytes: int


class HistoryManagement(TypedDict):
    generation: int
    capture_paused: bool
    capacity_blocked: bool
    usage: HistoryUsage
    records: list[HistoryRecord]


type HistoryAction = Literal[
    "keep",
    "unkeep",
    "rename",
    "delete",
    "restore",
    "permanent_delete",
    "pause_capture",
    "resume_capture",
]


class HistoryMutation(TypedDict):
    """A change to saved maps; the view also takes `trash` and `delete_all`."""

    action: HistoryAction
    record_ids: list[str]
    expected_generation: int
    request_id: str
    name: NotRequired[str]
    allow_kept: NotRequired[bool]


class HistoryAcknowledgement(TypedDict):
    """A committed change; an import names the records it added."""

    generation: int
    request_id: str
    record_ids: NotRequired[list[str]]


class HistoryExport(TypedDict):
    record_ids: list[str]
    expected_generation: int


class HistoryArchiveRecord(TypedDict):
    """One exported map. Import rebuilds the frame from the scene."""

    source_id: str
    created_at: str
    name: str | None
    sha256: str
    scene_zlib_base64: str
    frame: object


class HistoryArchive(TypedDict):
    format: Literal["matic-map-archive"]
    version: Literal[1]
    records: list[HistoryArchiveRecord]


class HistoryImport(TypedDict):
    archive: HistoryArchive
    expected_generation: int
    request_id: str


class HistoryError(TypedDict):
    error: str


class WifiCell(TypedDict):
    """A survey cell's centre and size in metres, and its mean signal in dBm."""

    x: float
    y: float
    size: float
    dbm: float
    samples: int
    updated_at: int


class WifiRoom(TypedDict):
    name: str
    dbm: float
    weakest: float
    samples: int


class WifiHeatmap(TypedDict):
    """The current floor's survey; it carries no network names."""

    enabled: bool
    cell_size: float
    cells: list[WifiCell]
    rooms: list[WifiRoom]
