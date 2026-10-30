import type { AreaOutline } from "./area-outline";
import {
  MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE,
  MAX_ROOM_SEQUENCE_SIZE,
} from "./contracts";
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

export interface SceneRoom {
  readonly id: string;
  readonly name: string;
  readonly boundary: readonly (readonly [number, number])[];
  readonly center: readonly [number, number];
}

export interface SceneMetadata {
  readonly metersPerCell: number;
  readonly origin: readonly [number, number];
  readonly span: readonly [number, number];
  readonly sampleStep: number;
  readonly rooms: readonly SceneRoom[];
}

export interface SceneModel {
  readonly buffer: ArrayBuffer;
  readonly pointOffset: number;
  readonly floorCount: number;
  readonly surfaceCount: number;
  readonly total: number;
  readonly revision: number;
  readonly etag: string | null;
  readonly metadata: SceneMetadata;
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
  readonly floorCoherent: boolean;
  readonly mapSessionKey: string | null;
  readonly freshness: "live" | "coordinator_fallback" | "unavailable";
  /** Native observation age; undefined only for pre-age-field responses. */
  readonly nativeObservationAgeSeconds?: number | null;
}

export interface HistorySnapshot {
  readonly id: string;
  readonly createdAt: string;
  readonly revision: number;
  readonly pointCount: number;
  readonly sceneUrl: string;
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
  | "invalid_plan";

/** A saved custom area in a preview; areas run every time, so it has no cadence reasons. */
export interface NextRunPreviewArea extends Omit<NextRunPreviewRoom, "roomId"> {
  readonly areaId: string;
}

export type NextRunPreviewStep = NextRunPreviewRoom | NextRunPreviewArea;

export interface NextRunPreview {
  readonly rooms: readonly NextRunPreviewRoom[];
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
  readonly nextRunPreview?: NextRunPreview;
  readonly nextRunEstimateSeconds: number | null;
  /**
   * The backend's ordered entries exactly as sent. The editor shows rooms
   * only, so a full-plan save reads its custom areas from here to keep them.
   */
  readonly entries?: unknown;
}

export interface PlansCatalog {
  readonly rooms: readonly (Pick<MapRoom, "roomId" | "name"> & {
    readonly sharedCadence?: RoomCadencePolicy;
    readonly sharedCadenceProgress?: RoomCadenceProgress;
    readonly sharedCadenceReasons?: readonly CadenceReason[];
    readonly sharedDeleteToken?: string;
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

const objectValue = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ContractError(code);
  return value as Record<string, unknown>;
};

const boundedString = (value: unknown, maximum: number, code: string, utf8Bytes = false): string => {
  if (typeof value !== "string") throw new ContractError(code);
  const text = value.trim();
  const length = utf8Bytes ? new TextEncoder().encode(text).length : Array.from(text).length;
  if (!text || length > maximum || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new ContractError(code);
  }
  return text;
};

// Nullable opaque identities; absent or null means none.
const selectedId = (value: unknown, code: string): string | null =>
  value === null || value === undefined ? null : boundedString(value, 128, code);

const optionalLabel = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  try {
    return boundedString(value, 128, "invalid-floor-label");
  } catch {
    return null;
  }
};

const boundedNumber = (
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

const boundedInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number => {
  const number = boundedNumber(value, minimum, maximum, code);
  if (!Number.isInteger(number)) throw new ContractError(code);
  return number;
};

const nullableInteger = (value: unknown, maximum: number): number | null => {
  if (value === null || value === undefined) return null;
  return boundedInteger(value, 1, maximum, "invalid-floor-ordinal");
};

const booleanValue = (value: unknown, code: string): boolean => {
  if (typeof value !== "boolean") throw new ContractError(code);
  return value;
};

const optionalBooleanDefaultFalse = (value: unknown, code: string): boolean =>
  value === undefined ? false : booleanValue(value, code);

const nullableBoolean = (value: unknown, code: string): boolean | null => {
  if (value === null) return null;
  return booleanValue(value, code);
};

const mapSessionKey = (value: unknown): string | null => {
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

const privatePath = (value: unknown, code: string): string => {
  const path = boundedString(value, 512, code);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new ContractError(code);
  }
  return path;
};

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
      deltaUrl: entry.delta_url === undefined || entry.delta_url === null
        ? null
        : privatePath(entry.delta_url, "invalid-delta-url"),
      poseUrl: privatePath(entry.pose_url, "invalid-pose-url"),
      historyUrl: privatePath(entry.history_url, "invalid-history-url"),
      areasUrl: privatePath(entry.areas_url, "invalid-areas-url"),
      plansUrl: privatePath(entry.plans_url, "invalid-plans-url"),
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

const point = (value: unknown, code: string): readonly [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) throw new ContractError(code);
  return [
    boundedNumber(value[0], -1_000_000, 1_000_000, code),
    boundedNumber(value[1], -1_000_000, 1_000_000, code),
  ];
};

const boundary = (value: unknown, code: string): readonly (readonly [number, number])[] => {
  if (!Array.isArray(value) || value.length < 3 || value.length > 8192) {
    throw new ContractError(code);
  }
  return value.map((candidate) => point(candidate, code));
};

const parseRooms = (value: unknown, includeBoundary: boolean): readonly MapRoom[] => {
  if (!Array.isArray(value) || value.length > 256) throw new ContractError("invalid-rooms");
  return value.map((candidate) => {
    const room = objectValue(candidate, "invalid-room");
    return {
      roomId: boundedString(room.room_id, 128, "invalid-room-id"),
      name: boundedString(room.name, 256, "invalid-room-name", true),
      boundary: includeBoundary ? boundary(room.boundary, "invalid-room-boundary") : [],
    };
  });
};

const parseSnapshot = (value: unknown): HistorySnapshot => {
  const snapshot = objectValue(value, "invalid-history-snapshot");
  const createdAt = boundedString(snapshot.created_at, 64, "invalid-history-time");
  if (!Number.isFinite(Date.parse(createdAt))) throw new ContractError("invalid-history-time");
  return {
    id: boundedString(snapshot.id, 128, "invalid-history-id"),
    createdAt,
    revision: boundedInteger(snapshot.revision, 0, Number.MAX_SAFE_INTEGER, "invalid-history-revision"),
    pointCount: boundedInteger(snapshot.point_count, 1, SCENE_MAX_POINTS, "invalid-history-points"),
    sceneUrl: privatePath(snapshot.scene_url, "invalid-history-scene-url"),
  };
};

export const parseHistoryCatalog = (value: unknown): HistoryCatalog => {
  const payload = objectValue(value, "invalid-history");
  if (!Array.isArray(payload.floors) || payload.floors.length < 1 || payload.floors.length > 128) {
    throw new ContractError("invalid-history-floors");
  }
  return {
    entryId: boundedString(payload.entry_id, 128, "invalid-history-entry"),
    liveAvailable: booleanValue(payload.live_available, "invalid-history-live"),
    floors: payload.floors.map((candidate) => {
      const floor = objectValue(candidate, "invalid-history-floor");
      if (!Array.isArray(floor.snapshots) || floor.snapshots.length > 12) {
        throw new ContractError("invalid-history-snapshots");
      }
      return {
        id: boundedString(floor.id, 128, "invalid-history-floor-id"),
        active: booleanValue(floor.active, "invalid-history-floor-active"),
        readOnly: booleanValue(floor.read_only, "invalid-history-floor-read-only"),
        liveAvailable: floor.live_available === undefined
          ? false
          : booleanValue(floor.live_available, "invalid-history-floor-live"),
        label: optionalLabel(floor.label),
        ordinal: floor.ordinal === undefined ? null : nullableInteger(floor.ordinal, 128),
        snapshots: floor.snapshots.map(parseSnapshot),
      } satisfies HistoryFloor;
    }),
  };
};

const parseCleaningMode = (value: unknown): CleaningMode => {
  if (value === "vacuum" || value === "mop" || value === "vacuum_and_mop") return value;
  throw new ContractError("invalid-cleaning-mode");
};

const parseCoverage = (value: unknown): CoverageSetting => {
  if (value === "quick" || value === "standard" || value === "heavy_duty") return value;
  throw new ContractError("invalid-coverage-setting");
};

const nullableInterval = (value: unknown, code: string): number | null =>
  value === null || value === undefined
    ? null
    : boundedInteger(value, 1, 100, code);

const parseCadenceReasons = (value: unknown): readonly CadenceReason[] => {
  if (value === undefined || value === null) return [];
  const validReasons: readonly CadenceReason[] = [
    "coverage_requires_vacuum",
    "mop_due",
    "coverage_due",
    "room_not_on_current_map",
    "identity_changed",
    "shared_schedule_unavailable",
    "mop_progress_unverified",
    "coverage_progress_unverified",
    "invalid_cadence_policy",
  ];
  if (!Array.isArray(value) || value.length > validReasons.length
    || value.some((reason) => !validReasons.includes(reason as CadenceReason))) {
    throw new ContractError("invalid-cadence-reasons");
  }
  return [...new Set(value as CadenceReason[])];
};

const parseCadencePolicy = (value: unknown): RoomCadencePolicy | undefined => {
  if (value === undefined || value === null) return undefined;
  const policy = objectValue(value, "invalid-room-cadence");
  const scope = policy.scope === undefined ? "plan" : policy.scope;
  if (scope !== "plan" && scope !== "shared") throw new ContractError("invalid-room-cadence-scope");
  const rawPeriodicCoverage = policy.periodic_coverage_setting;
  return {
    scope,
    mopEveryN: nullableInterval(policy.mop_every_n, "invalid-mop-interval"),
    coverageEveryN: nullableInterval(policy.coverage_every_n, "invalid-coverage-interval"),
    periodicCoverageSetting: rawPeriodicCoverage === null || rawPeriodicCoverage === undefined
      ? null
      : parseCoverage(rawPeriodicCoverage),
    doMopNext: optionalBooleanDefaultFalse(policy.do_mop_next, "invalid-do-mop-next"),
    doCoverageNext: optionalBooleanDefaultFalse(policy.do_coverage_next, "invalid-do-coverage-next"),
  };
};

const parseCadenceProgress = (value: unknown, reasonsValue?: unknown): RoomCadenceProgress | undefined => {
  if (value === undefined || value === null) return undefined;
  const progress = objectValue(value, "invalid-room-cadence-progress");
  const effectiveMode = progress.effective_cleaning_mode;
  const effectiveCoverage = progress.effective_coverage_setting;
  const reasons = parseCadenceReasons(reasonsValue ?? progress.cadence_reasons);
  return {
    mopProgress: boundedInteger(progress.mop_progress ?? 0, 0, 100, "invalid-mop-progress"),
    coverageProgress: boundedInteger(progress.coverage_progress ?? 0, 0, 100, "invalid-coverage-progress"),
    mopDue: optionalBooleanDefaultFalse(progress.mop_due, "invalid-mop-due"),
    coverageDue: optionalBooleanDefaultFalse(progress.coverage_due, "invalid-coverage-due"),
    nextMopIn: nullableInterval(progress.next_mop_in, "invalid-next-mop"),
    nextCoverageIn: nullableInterval(progress.next_coverage_in, "invalid-next-coverage"),
    reasons,
    ...(effectiveMode === undefined ? {} : { effectiveCleaningMode: parseCleaningMode(effectiveMode) }),
    ...(effectiveCoverage === undefined ? {} : { effectiveCoverageSetting: parseCoverage(effectiveCoverage) }),
  };
};

const parsePlanRoom = (value: unknown): PlanRoom => {
  const room = objectValue(value, "invalid-plan-room");
  const cadence = parseCadencePolicy(room.cadence);
  const cadenceProgress = parseCadenceProgress(room.cadence_progress, room.cadence_reasons);
  const cadenceReasons = parseCadenceReasons(room.cadence_reasons);
  return {
    roomId: boundedString(room.room_id, 128, "invalid-plan-room-id"),
    cleaningMode: parseCleaningMode(room.cleaning_mode),
    coverageSetting: parseCoverage(room.coverage_setting),
    ...(cadence === undefined ? {} : { cadence }),
    ...(cadenceProgress === undefined ? {} : { cadenceProgress }),
    ...(cadenceReasons.length ? { cadenceReasons } : {}),
  };
};

const parseNextRunPreview = (value: unknown): NextRunPreview | undefined => {
  if (value === undefined || value === null) return undefined;
  const preview = objectValue(value, "invalid-plan-preview");
  // A plan holds up to the room limit and as many custom areas again.
  const steps = preview.entries ?? preview.rooms;
  if (!Array.isArray(preview.rooms) || preview.rooms.length > MAX_ROOM_SEQUENCE_SIZE
    || !Array.isArray(steps) || steps.length > 2 * MAX_ROOM_SEQUENCE_SIZE
    || !Array.isArray(preview.mission_boundaries)
    || preview.mission_boundaries.length > steps.length) {
    throw new ContractError("invalid-plan-preview");
  }
  const stepCount = steps.length;
  const parsedSteps: NextRunPreviewStep[] = steps.map((candidate) => {
    const step = objectValue(candidate, "invalid-plan-preview-room");
    return {
      ...(step.kind === "area"
        ? { areaId: boundedString(step.area_id, 128, "invalid-plan-preview-room-id") }
        : { roomId: boundedString(step.room_id, 128, "invalid-plan-preview-room-id") }),
      name: boundedString(step.name, step.kind === "area" ? 128 : 256,
        "invalid-plan-preview-room-name", step.kind !== "area"),
      cleaningMode: parseCleaningMode(step.cleaning_mode),
      coverageSetting: parseCoverage(step.coverage_setting),
      cadenceReasons: parseCadenceReasons(step.cadence_reasons),
    };
  });
  const rooms = parsedSteps.filter((step): step is NextRunPreviewRoom => "roomId" in step);
  // A boundary falls strictly inside the steps, so a single step has none.
  const boundaries = preview.mission_boundaries.map((value) =>
    boundedInteger(value, 1, stepCount - 1, "invalid-plan-preview-boundary"));
  if (boundaries.some((value, index) => value <= (boundaries[index - 1] ?? 0))) {
    throw new ContractError("invalid-plan-preview-boundary-order");
  }
  const blockers: readonly NextRunPreviewBlocker[] = [
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
  ];
  const rawBlocker = preview.blocker;
  if (rawBlocker !== null && !blockers.includes(rawBlocker as NextRunPreviewBlocker)) {
    throw new ContractError("invalid-plan-preview-blocker");
  }
  if (rawBlocker === null && stepCount === 0) throw new ContractError("empty-plan-preview");
  const previewToken = preview.preview_token;
  if (previewToken !== undefined && (typeof previewToken !== "string" || !/^[0-9a-f]{64}$/u.test(previewToken))) {
    throw new ContractError("invalid-plan-preview-token");
  }
  return {
    rooms,
    steps: parsedSteps,
    missionBoundaries: boundaries,
    blocker: rawBlocker as NextRunPreviewBlocker | null,
    ...(typeof previewToken === "string" ? { previewToken } : {}),
  };
};

/** Shared validators for the room-preview decoder loaded on a cleaning choice. */
export const roomPreviewHelpers = { ContractError, objectValue, boundedString, parseNextRunPreview, parseCadenceProgress };

/** Shared validators passed into the deferred custom-area decoder. */
export const areaCatalogHelpers = {
  ContractError, objectValue, boundedString, boundedNumber, booleanValue,
  privatePath, parseRooms, parseCleaningMode, parseCoverage, selectedId,
};

export const parseSavedPlanId = (value: unknown): string => {
  const result = objectValue(value, "invalid-plan-save-response");
  const response = objectValue(result.response, "invalid-plan-save-response");
  const plan = objectValue(response.plan, "invalid-plan-save-response");
  return boundedString(plan.id, 128, "invalid-plan-save-response");
};

const estimateSeconds = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export const parsePlansCatalog = (value: unknown): PlansCatalog => {
  const payload = objectValue(value, "invalid-plans");
  if (!Array.isArray(payload.plans) || payload.plans.length > 256) {
    throw new ContractError("invalid-plan-list");
  }
  const rawRooms = payload.rooms;
  const rooms = parseRooms(rawRooms, false).map((room, index): PlansCatalog["rooms"][number] => {
    const raw = Array.isArray(rawRooms) ? rawRooms[index] : undefined;
    const value = objectValue(raw, "invalid-room");
    const sharedCadence = parseCadencePolicy(value.shared_cadence);
    const sharedCadenceProgress = parseCadenceProgress(
      value.shared_cadence_progress,
      value.shared_cadence_reasons,
    );
    const sharedCadenceReasons = parseCadenceReasons(value.shared_cadence_reasons);
    const sharedDeleteToken = value.shared_cadence_delete_token;
    if (sharedDeleteToken !== undefined && sharedDeleteToken !== null
      && (typeof sharedDeleteToken !== "string" || !/^[0-9a-f]{64}$/u.test(sharedDeleteToken))) {
      throw new ContractError("invalid-shared-cadence-delete-token");
    }
    return {
      roomId: room.roomId,
      name: room.name,
      ...(sharedCadence === undefined ? {} : { sharedCadence }),
      ...(sharedCadenceProgress === undefined ? {} : { sharedCadenceProgress }),
      ...(sharedCadenceReasons.length ? { sharedCadenceReasons } : {}),
      ...(typeof sharedDeleteToken === "string" ? { sharedDeleteToken } : {}),
    };
  });
  return {
    rooms,
    selectedPlan: selectedId(payload.selected_plan, "invalid-selected-plan"),
    plans: payload.plans.map((candidate) => {
      const plan = objectValue(candidate, "invalid-plan");
      if (!Array.isArray(plan.rooms) || plan.rooms.length > MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE || !Array.isArray(plan.room_order)) {
        throw new ContractError("invalid-plan-rooms");
      }
      const runBehavior = plan.run_behavior;
      if (runBehavior !== "intelligent" && runBehavior !== "ordered") {
        throw new ContractError("invalid-run-behavior");
      }
      const nextRunPreview = parseNextRunPreview(plan.next_run_preview);
      return {
        id: boundedString(plan.id, 128, "invalid-plan-id"),
        name: boundedString(plan.name, 128, "invalid-plan-name"),
        enabled: booleanValue(plan.enabled, "invalid-plan-enabled"),
        runBehavior,
        rooms: plan.rooms.map((roomCandidate) => {
          return parsePlanRoom(roomCandidate);
        }),
        roomOrder: plan.room_order.slice(0, MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE).map((roomId) =>
          boundedString(roomId, 128, "invalid-room-order")),
        returnToBase: booleanValue(plan.return_to_base, "invalid-return-to-base"),
        finishCurrentRoom: booleanValue(plan.finish_current_room, "invalid-finish-room"),
        finishCurrentRoomThreshold: boundedInteger(
          plan.finish_current_room_threshold,
          0,
          100,
          "invalid-finish-threshold",
        ),
        ...(nextRunPreview === undefined ? {} : { nextRunPreview }),
        nextRunEstimateSeconds: estimateSeconds(plan.next_run_estimate_seconds),
        entries: plan.entries,
      } satisfies SavedPlan;
    }),
  };
};

export const parsePose = (value: unknown): PoseModel => {
  const payload = objectValue(value, "invalid-pose");
  const rawPosition = payload.position;
  const position = rawPosition === null
    ? null
    : point(rawPosition, "invalid-pose-position");
  const freshness = payload.pose_freshness;
  if (freshness !== "live" && freshness !== "coordinator_fallback") {
    throw new ContractError("invalid-pose-freshness");
  }
  const nativeObservationAgeSeconds = Object.hasOwn(payload, "pose_age_seconds")
    ? typeof payload.pose_age_seconds === "number" && Number.isFinite(payload.pose_age_seconds)
      && payload.pose_age_seconds >= -2 && payload.pose_age_seconds <= 5
      ? payload.pose_age_seconds
      : null
    : undefined;
  return {
    position,
    source: boundedString(payload.source, 64, "invalid-pose-source"),
    revision: boundedInteger(payload.revision, 0, Number.MAX_SAFE_INTEGER, "invalid-pose-revision"),
    sceneRevision: payload.scene_revision == null ? null
      : boundedInteger(payload.scene_revision, 0, Number.MAX_SAFE_INTEGER, "invalid-pose-revision"),
    sceneEpoch: selectedId(payload.scene_epoch, "invalid-scene-epoch"),
    poseRevision: boundedInteger(payload.pose_revision, 0, Number.MAX_SAFE_INTEGER, "invalid-pose-sequence"),
    floorCoherent: booleanValue(payload.map_floor_coherent, "invalid-pose-floor"),
    mapSessionKey: mapSessionKey(payload.map_session_key),
    freshness,
    ...(nativeObservationAgeSeconds === undefined ? {} : { nativeObservationAgeSeconds }),
  };
};

export const isPrivatePath = (value: unknown): value is string => {
  try {
    privatePath(value, "invalid-private-path");
    return true;
  } catch {
    return false;
  }
};
