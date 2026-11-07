import type { AreaOutline } from "./area-outline";
export const CATALOG_URL = "/api/matic_robot/slam_entries";
export const SCENE_HEADER_BYTES = 24;
export const SCENE_POINT_STRIDE = 8;
export const SCENE_MAX_POINTS = 1_500_000;
export const SCENE_MAX_BYTES = 16 * 1024 * 1024;
export const DELTA_HEADER_BYTES = 36;
export const DELTA_MAX_BYTES = 16 * 1024 * 1024;
export const SCENE_DELTA_DIRTY_BLOCK_BYTES = 65_536 as const;

export type LoadStatus = "idle" | "loading" | "ready" | "empty" | "error";
export type MapHealth = "ready" | "building" | "limited" | "problem" | "unknown";
export type MapBlockReason = "bootstrap_empty" | "map_session_unverified"
  | "floor_plan_unavailable" | "floor_plan_mismatch" | null;
export type MapBootstrapState = "not_started" | "running" | "complete" | "partial" | "failed";
export type CleaningMode = "vacuum" | "mop" | "vacuum_and_mop";
export type CoverageSetting = "quick" | "standard" | "heavy_duty";
export type AreaBindingStatus = "current" | "review" | "stale" | "unknown";

export interface MapEntry {
  readonly entryId: string;
  readonly liveWorkspaceTransportEnabled: boolean;
  readonly sceneUrl: string;
  readonly deltaUrl: string | null;
  readonly poseUrl: string;
  readonly historyUrl: string;
  readonly areasUrl: string;
  readonly plansUrl: string;
  /** Absent on integrations without the Wi-Fi survey. */
  readonly wifiHeatmapUrl: string | null;
  /** Absent on integrations without the carpet and vent layer. */
  readonly floorTypesUrl: string | null;
  readonly coverageUrl: string | null;
  readonly mapRevision: number;
  readonly mapSceneEpoch: string | null;
  readonly mapFloorCoherent: boolean;
  readonly mapSessionVerified: boolean;
  readonly mapSessionKey: string | null;
  readonly mapBlockReason: MapBlockReason;
  readonly runnerLocked: boolean;
  readonly stopSettlePending: boolean;
  readonly activePlan: boolean;
  readonly nativeReconciliationPending: boolean;
  readonly nativeSessionActive: boolean | null;
  readonly mapComplete: boolean;
  readonly mapTruncated: boolean;
  readonly selectedFloorOrdinal: number | null;
  readonly mapFloorOrdinal: number | null;
  readonly historyCount: number;
  readonly historyFloorCount: number;
  readonly health: MapHealth;
  readonly streamFailures: number;
  readonly bootstrapState: MapBootstrapState;
  readonly bootstrapPhotoSeen: boolean;
  readonly bootstrapStructureSeen: boolean;
  readonly bootstrapFailures: number;
}

// These private keys are shared by preview production and admission. Floor
// ordinals are positive, so zero represents an absent floor without collision.
export const entryFloorKey = (entry: MapEntry): string => [
  entry.selectedFloorOrdinal ?? 0,
  entry.mapFloorOrdinal ?? 0,
  entry.mapFloorCoherent,
].join(":");

export const entryMissionKey = (entry: MapEntry): string => [
  entry.mapFloorOrdinal ?? 0,
  entry.mapSessionVerified,
  entry.mapSessionKey ?? "",
].join(":");

export const entryCoherenceIdentity = (entry: MapEntry): string => [
  entry.entryId,
  entryFloorKey(entry),
  entryMissionKey(entry),
  entry.mapSceneEpoch ?? "",
].join("|");

export const entryManagedLock = (entry: MapEntry): boolean =>
  entry.runnerLocked
  || entry.stopSettlePending
  || entry.activePlan
  || entry.nativeReconciliationPending
  || entry.nativeSessionActive === true;

export const entryBoundaryKey = (entry: MapEntry): string => [
  entry.entryId,
  entry.selectedFloorOrdinal ?? 0,
  entry.mapFloorOrdinal ?? 0,
].join("|");

export const entryIdentity = (entry: MapEntry): string => [
  entryCoherenceIdentity(entry),
  entry.mapRevision,
].join("|");

export interface SceneRoom {
  readonly id: string;
  readonly name: string;
  readonly boundary: readonly (readonly [number, number])[];
  readonly center: readonly [number, number];
}

export interface SceneComparisonCoverage {
  readonly version: 1;
  readonly status: string;
  readonly encoding: string;
  readonly originCells: readonly [number, number];
  readonly metersPerCell: number;
  readonly spanCells: readonly [number, number];
  readonly observedCells: number;
  readonly maskSha256: string;
  readonly maskZlibBase64: string;
  readonly diffEligible: boolean;
}

export interface SceneFloorSupport {
  readonly version: 1;
  readonly status: "verified";
  readonly encoding: "bitset-little-v1";
  readonly originCells: readonly [number, number];
  readonly metersPerCell: number;
  readonly spanCells: readonly [number, number];
  readonly occupiedCells: number;
  readonly maskSha256: string;
  readonly mask: Uint8Array;
}

export interface SceneMetadata {
  readonly metersPerCell: number;
  readonly origin: readonly [number, number];
  readonly span: readonly [number, number];
  readonly sampleStep: number;
  readonly rooms: readonly SceneRoom[];
  readonly coverage?: SceneComparisonCoverage;
  readonly floorSupport?: SceneFloorSupport;
}

/** Bounded contiguous point ranges grouped by their 32-cell source tile. */
export interface SceneTileIndex {
  /** Five uint32 values per run: [first, end, tileX, tileY, maximumHeight]. */
  readonly runs: Uint32Array;
  /** Number of leading runs belonging to the floor point range. */
  readonly floorRuns: number;
}

export interface SceneModel {
  /** Exact retained source when a saved map is displayed, including Live fallback. */
  readonly historyRecordId?: string;
  readonly buffer: ArrayBuffer;
  readonly pointOffset: number;
  readonly floorCount: number;
  readonly surfaceCount: number;
  readonly total: number;
  readonly revision: number;
  readonly etag: string | null;
  readonly metadata: SceneMetadata;
  /** Optional spatial acceleration; absence never removes scene geometry. */
  readonly tileIndex?: SceneTileIndex;
  readonly source: "live" | "history";
  readonly deltaHint?: SceneDeltaHint;
}

export interface SceneDeltaHint {
  readonly baseRevision: number;
  readonly blockBytes: 65_536;
  /** Point-data blocks relative to `pointOffset`, changed by this revision. */
  readonly dirtyBlocks: readonly number[];
}

export interface PoseModel {
  readonly position: readonly [number, number] | null;
  readonly source: string;
  readonly revision: number;
  readonly sceneRevision: number | null;
  readonly sceneEpoch: string | null;
  readonly poseRevision: number;
  /** Opaque proof epoch; changes even when localization returns to the same floor. */
  readonly poseFrameKey?: string | null;
  readonly floorCoherent: boolean;
  readonly mapSessionKey: string | null;
  readonly freshness: "live" | "coordinator_fallback" | "unavailable";
  /** Native observation age; undefined only for pre-age-field responses. */
  readonly nativeObservationAgeSeconds?: number | null;
  /** Server processing time before it measured that age. */
  readonly poseProcessingSeconds?: number;
  /** Server wall-clock time, validated by the optional clock calibration. */
  readonly poseMeasuredAt?: unknown;
  /** Map-frame yaw in radians when the pose carried a rotation. */
  readonly heading?: number | null;
}

export interface HistorySnapshot {
  readonly id: string;
  readonly contentId?: string | null;
  readonly createdAt: string;
  readonly revision: number;
  readonly pointCount: number;
  readonly sceneUrl: string;
  readonly name?: string | null;
  readonly imported?: boolean;
  readonly comparisonGroup?: string | null;
  readonly frame?: HistoryComparisonFrame | null;
}

export interface HistoryComparisonFrame {
  readonly formatVersion: 1;
  readonly coordinateVersion: 1;
  readonly originCells: readonly [number, number];
  readonly metersPerCell: number;
  readonly spanCells: readonly [number, number];
  readonly coverage: {
    readonly status: string;
    readonly observedCells: number;
    readonly maskSha256: string | null;
    readonly diffEligible: boolean;
  };
  readonly diffEligible: boolean;
}

export interface HistoryFloor {
  readonly id: string;
  readonly active: boolean;
  readonly readOnly: boolean;
  readonly liveAvailable: boolean;
  readonly label: string | null;
  readonly ordinal: number | null;
  readonly snapshots: readonly HistorySnapshot[];
}

export interface HistoryCatalog {
  readonly entryId: string;
  readonly liveAvailable: boolean;
  readonly floors: readonly HistoryFloor[];
}

export interface MapRoom {
  readonly roomId: string;
  readonly name: string;
  readonly boundary: readonly (readonly [number, number])[];
}

export interface AreaCircle {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface SavedArea {
  readonly outline?: AreaOutline | null;
  readonly id: string;
  readonly name: string;
  readonly circles: readonly AreaCircle[];
  readonly cleaningMode: CleaningMode;
  readonly coverageSetting: CoverageSetting;
  readonly status: AreaBindingStatus;
  readonly canRebind: boolean;
}

/** A zone the robot keeps, in map metres, and what it overlaps. */
export interface MapZoneOverlay {
  readonly kind: "no_go" | "unknown";
  readonly outline: readonly (readonly [number, number])[];
  readonly holes: readonly (readonly (readonly [number, number])[])[];
  readonly roomIds: readonly string[];
  readonly areaIds: readonly string[];
}

export interface AreasCatalog {
  readonly sceneUrl: string;
  readonly rooms: readonly MapRoom[];
  readonly areas: readonly SavedArea[];
  /** Robot zones on this map; empty when an older backend omits them. */
  readonly zones: readonly MapZoneOverlay[];
  /**
   * The area the "Custom cleaning area" select and Clean custom area button
   * use (`selected_area`); null when none is selected or an older backend omits it.
   */
  readonly selectedArea: string | null;
}

export interface PlanRoom {
  readonly roomId: string;
  readonly cleaningMode: CleaningMode;
  readonly coverageSetting: CoverageSetting;
  readonly cadence?: RoomCadencePolicy;
  readonly cadenceProgress?: RoomCadenceProgress;
  readonly cadenceReasons?: readonly CadenceReason[];
  readonly dailyLimit?: DailyRoomLimit;
}

export interface DailyRoomLimit {
  readonly limit: number | null;
  readonly completedToday: number;
  readonly reached: boolean;
  readonly reason?: string;
}

export interface DailyLimitHeldRoom extends DailyRoomLimit {
  readonly roomId: string;
  readonly name: string;
}

export type CadenceReason =
  | "coverage_requires_vacuum"
  | "mop_due"
  | "coverage_due"
  | "room_not_on_current_map"
  | "identity_changed"
  | "shared_schedule_unavailable"
  | "mop_progress_unverified"
  | "coverage_progress_unverified"
  | "invalid_cadence_policy";

export interface NextRunPreviewRoom {
  readonly roomId: string;
  readonly name: string;
  readonly cleaningMode: CleaningMode;
  readonly coverageSetting: CoverageSetting;
  readonly cadenceReasons: readonly CadenceReason[];
  readonly dailyLimit?: DailyRoomLimit;
}

export type NextRunPreviewBlocker =
  | "area_map_changed"
  | "area_missing"
  | "coverage_requires_vacuum"
  | "cadence_identity_unavailable"
  | "preview_unavailable"
  | "plan_disabled"
  | "plan_has_no_rooms"
  | "plan_room_limit"
  | "cadence_identity_changed"
  | "shared_schedule_unavailable"
  | "cadence_progress_unverified"
  | "invalid_cadence_policy"
  | "invalid_plan"
  | "plan_rooms_held"
  | "daily_limit_reached";

/** A saved custom area in a preview; areas run every time, so it has no cadence reasons. */
export interface NextRunPreviewArea extends Omit<NextRunPreviewRoom, "roomId"> {
  readonly areaId: string;
}

export type NextRunPreviewStep = NextRunPreviewRoom | NextRunPreviewArea;

/** A room an occupancy-aware plan leaves out of this run, and the sensor holding it. */
export interface NextRunHeldRoom {
  readonly roomId: string;
  readonly name: string;
  readonly sensor: string;
}

export interface NextRunPreview {
  readonly dailyLimitHeldRooms?: readonly DailyLimitHeldRoom[];
  readonly rooms: readonly NextRunPreviewRoom[];
  readonly heldRooms?: readonly NextRunHeldRoom[];
  /** Every step in run order, rooms and custom areas. Synthetic fixtures may leave it out; the steps are then `rooms`. */
  readonly steps?: readonly NextRunPreviewStep[];
  /** Offsets into `steps` when sent, else `rooms`. */
  readonly missionBoundaries: readonly number[];
  readonly blocker: NextRunPreviewBlocker | null;
  readonly previewToken?: string;
}

export interface ManualRoomSequencePreviewRoom extends NextRunPreviewRoom {
  readonly cadenceProgress?: RoomCadenceProgress;
}

export interface ManualRoomSequencePreview {
  readonly dailyLimitHeldRooms?: readonly DailyLimitHeldRoom[];
  readonly entryId: string;
  readonly floorToken: string;
  readonly previewToken: string;
  readonly rooms: readonly ManualRoomSequencePreviewRoom[];
  readonly missionBoundaries: readonly number[];
  readonly blocker: NextRunPreviewBlocker | null;
}

export interface RoomCadencePolicy {
  readonly scope: "plan" | "shared";
  readonly mopEveryN: number | null;
  readonly coverageEveryN: number | null;
  readonly periodicCoverageSetting: CoverageSetting | null;
  readonly doMopNext: boolean;
  readonly doCoverageNext: boolean;
}

export interface RoomCadenceProgress {
  readonly mopProgress: number;
  readonly coverageProgress: number;
  readonly mopDue: boolean;
  readonly coverageDue: boolean;
  readonly nextMopIn: number | null;
  readonly nextCoverageIn: number | null;
  readonly reasons: readonly CadenceReason[];
  readonly effectiveCleaningMode?: CleaningMode;
  readonly effectiveCoverageSetting?: CoverageSetting;
}

export interface SavedPlan {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly runBehavior: "intelligent" | "ordered";
  readonly rooms: readonly PlanRoom[];
  readonly roomOrder: readonly string[];
  readonly returnToBase: boolean;
  readonly finishCurrentRoom: boolean;
  readonly finishCurrentRoomThreshold: number;
  /** Hold occupied rooms: a run leaves out rooms whose occupancy sensor is on. */
  readonly occupancyAware: boolean;
  /** Room ID to the binary sensor that replaces its area's sensors; kept on save. */
  readonly occupancySensors: Readonly<Record<string, string>>;
  readonly nextRunPreview?: NextRunPreview;
  readonly nextRunEstimateSeconds: number | null;
  /**
   * The backend's ordered entries exactly as sent. The editor shows rooms
   * only, so a full-plan save reads its custom areas from here to keep them.
   */
  readonly entries?: unknown;
}

export interface PlansCatalog {
  readonly entryId?: string;
  readonly floorToken?: string;
  readonly rooms: readonly (Pick<MapRoom, "roomId" | "name"> & {
    readonly sharedCadence?: RoomCadencePolicy;
    readonly sharedCadenceProgress?: RoomCadenceProgress;
    readonly sharedCadenceReasons?: readonly CadenceReason[];
    readonly sharedDeleteToken?: string;
    readonly dailyLimit?: DailyRoomLimit;
  })[];
  readonly plans: readonly SavedPlan[];
  readonly selectedPlan: string | null;
}

export class ContractError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ContractError";
    this.code = code;
  }
}

export const objectValue = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ContractError(code);
  return value as Record<string, unknown>;
};

export const boundedString = (value: unknown, maximum: number, code: string, utf8Bytes = false): string => {
  if (typeof value !== "string") throw new ContractError(code);
  const text = value.trim();
  const length = utf8Bytes ? new TextEncoder().encode(text).length : Array.from(text).length;
  if (!text || length > maximum || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new ContractError(code);
  }
  return text;
};

// Nullable opaque identities; absent or null means none.
export const selectedId = (value: unknown, code: string): string | null =>
  value === null || value === undefined ? null : boundedString(value, 128, code);

export const optionalLabel = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  try {
    return boundedString(value, 128, "invalid-floor-label");
  } catch {
    return null;
  }
};

export const boundedNumber = (
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ContractError(code);
  }
  return value;
};

export const boundedInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number => {
  const number = boundedNumber(value, minimum, maximum, code);
  if (!Number.isInteger(number)) throw new ContractError(code);
  return number;
};

export const nullableInteger = (value: unknown, maximum: number): number | null => {
  if (value === null || value === undefined) return null;
  return boundedInteger(value, 1, maximum, "invalid-floor-ordinal");
};

export const booleanValue = (value: unknown, code: string): boolean => {
  if (typeof value !== "boolean") throw new ContractError(code);
  return value;
};

const optionalBooleanDefaultFalse = (value: unknown, code: string): boolean =>
  value === undefined ? false : booleanValue(value, code);

const nullableBoolean = (value: unknown, code: string): boolean | null => {
  if (value === null) return null;
  return booleanValue(value, code);
};

export const mapSessionKey = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const key = boundedString(value, 64, "invalid-map-session-key");
  if (!/^[0-9a-f]{64}$/u.test(key)) throw new ContractError("invalid-map-session-key");
  return key;
};

const blockReason = (value: unknown): MapBlockReason => {
  if (value === null || value === undefined) return null;
  if (
    value === "bootstrap_empty"
    || value === "map_session_unverified"
    || value === "floor_plan_unavailable"
    || value === "floor_plan_mismatch"
  ) return value;
  throw new ContractError("invalid-map-block-reason");
};

const bootstrapState = (value: unknown): MapBootstrapState => {
  if (value === undefined) return "not_started";
  if (
    value === "not_started"
    || value === "running"
    || value === "complete"
    || value === "partial"
    || value === "failed"
  ) return value;
  throw new ContractError("invalid-bootstrap-state");
};

export const privatePath = (value: unknown, code: string): string => {
  const path = boundedString(value, 512, code);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new ContractError(code);
  }
  return path;
};

const optionalPrivatePath = (value: unknown): string | null =>
  value == null ? null : privatePath(value, "invalid-private-path");

const healthValue = (entry: Record<string, unknown>): MapHealth => {
  const state = typeof entry.map_health === "string" ? entry.map_health.toLowerCase() : "";
  const stream = typeof entry.stream_state === "string" ? entry.stream_state.toLowerCase() : "";
  const invalid = typeof entry.invalid_tiles === "number" ? entry.invalid_tiles : 0;
  if (state.includes("error") || state.includes("fail") || state.includes("degrad") || invalid > 0) {
    return "problem";
  }
  if (entry.map_truncated === true || state.includes("truncat") || state.includes("limit")) {
    return "limited";
  }
  if (entry.map_complete === true) return "ready";
  if (stream.includes("connect") || stream.includes("collect") || stream.includes("run")) {
    return "building";
  }
  return "unknown";
};

export const parseCatalog = (value: unknown): readonly MapEntry[] => {
  const root = objectValue(value, "invalid-catalog");
  if (!Array.isArray(root.entries) || root.entries.length > 64) {
    throw new ContractError("invalid-catalog-entries");
  }
  return root.entries.map((candidate) => {
    const entry = objectValue(candidate, "invalid-catalog-entry");
    const mapRevision = boundedInteger(entry.map_revision, 0, Number.MAX_SAFE_INTEGER, "invalid-map-revision");
    return {
      entryId: boundedString(entry.entry_id, 128, "invalid-entry-id"),
      liveWorkspaceTransportEnabled: optionalBooleanDefaultFalse(
        entry.live_workspace_transport_enabled,
        "invalid-live-workspace-transport",
      ),
      sceneUrl: privatePath(entry.scene_url, "invalid-scene-url"),
      deltaUrl: optionalPrivatePath(entry.delta_url),
      poseUrl: privatePath(entry.pose_url, "invalid-pose-url"),
      historyUrl: privatePath(entry.history_url, "invalid-history-url"),
      areasUrl: privatePath(entry.areas_url, "invalid-areas-url"),
      plansUrl: privatePath(entry.plans_url, "invalid-plans-url"),
      wifiHeatmapUrl: optionalPrivatePath(entry.wifi_heatmap_url),
      floorTypesUrl: optionalPrivatePath(entry.floor_layers_url),
      coverageUrl: optionalPrivatePath(entry.coverage_url),
      mapRevision,
      mapSceneEpoch: selectedId(entry.map_scene_epoch, "invalid-scene-epoch"),
      mapFloorCoherent: booleanValue(entry.map_floor_coherent, "invalid-floor-coherence"),
      mapSessionVerified: booleanValue(entry.map_session_verified, "invalid-session-state"),
      mapSessionKey: mapSessionKey(entry.map_session_key),
      mapBlockReason: blockReason(entry.map_block_reason),
      runnerLocked: booleanValue(entry.runner_locked, "invalid-runner-lock"),
      stopSettlePending: booleanValue(entry.stop_settle_pending, "invalid-stop-settle"),
      activePlan: booleanValue(entry.active_plan, "invalid-active-plan"),
      nativeReconciliationPending: booleanValue(
        entry.native_reconciliation_pending,
        "invalid-native-reconciliation",
      ),
      nativeSessionActive: nullableBoolean(
        entry.native_session_active,
        "invalid-native-session",
      ),
      mapComplete: booleanValue(entry.map_complete, "invalid-map-complete"),
      mapTruncated: booleanValue(entry.map_truncated, "invalid-map-truncated"),
      selectedFloorOrdinal: nullableInteger(entry.selected_floor_ordinal, 128),
      mapFloorOrdinal: nullableInteger(entry.map_floor_ordinal, 128),
      historyCount: boundedInteger(entry.history_count, 0, 12, "invalid-history-count"),
      historyFloorCount: boundedInteger(entry.history_floor_count, 0, 128, "invalid-floor-count"),
      health: healthValue(entry),
      streamFailures: boundedInteger(entry.stream_failures, 0, Number.MAX_SAFE_INTEGER, "invalid-stream-failures"),
      bootstrapState: bootstrapState(entry.bootstrap_state),
      bootstrapPhotoSeen: entry.bootstrap_photo_seen === undefined
        ? false
        : booleanValue(entry.bootstrap_photo_seen, "invalid-bootstrap-photo"),
      bootstrapStructureSeen: entry.bootstrap_structure_seen === undefined
        ? false
        : booleanValue(entry.bootstrap_structure_seen, "invalid-bootstrap-structure"),
      bootstrapFailures: entry.bootstrap_failures === undefined
        ? 0
        : boundedInteger(entry.bootstrap_failures, 0, 2, "invalid-bootstrap-failures"),
    } satisfies MapEntry;
  });
};

export const parseSavedPlanId = (value: unknown): string => {
  const result = objectValue(value, "invalid-plan-save-response");
  const response = objectValue(result.response, "invalid-plan-save-response");
  const plan = objectValue(response.plan, "invalid-plan-save-response");
  return boundedString(plan.id, 128, "invalid-plan-save-response");
};

export const isPrivatePath = (value: unknown): value is string => {
  try {
    privatePath(value, "invalid-private-path");
    return true;
  } catch {
    return false;
  }
};
