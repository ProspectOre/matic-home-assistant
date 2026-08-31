export const CATALOG_URL = "/api/matic_robot/slam_entries";
export const SCENE_HEADER_BYTES = 24;
export const SCENE_POINT_STRIDE = 8;
export const SCENE_MAX_POINTS = 1_500_000;
export const SCENE_MAX_BYTES = 16 * 1024 * 1024;

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
  readonly sceneUrl: string;
  readonly deltaUrl: string | null;
  readonly poseUrl: string;
  readonly historyUrl: string;
  readonly areasUrl: string;
  readonly plansUrl: string;
  readonly mapRevision: number;
  readonly mapFloorCoherent: boolean;
  readonly mapSessionVerified: boolean;
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
}

export interface PoseModel {
  readonly position: readonly [number, number] | null;
  readonly source: string;
  readonly revision: number;
  readonly poseRevision: number;
  readonly floorCoherent: boolean;
  readonly freshness: "live" | "coordinator_fallback" | "unavailable";
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
  readonly id: string;
  readonly name: string;
  readonly circles: readonly AreaCircle[];
  readonly cleaningMode: CleaningMode;
  readonly coverageSetting: CoverageSetting;
  readonly status: AreaBindingStatus;
  readonly canRebind: boolean;
}

export interface AreasCatalog {
  readonly sceneUrl: string;
  readonly rooms: readonly MapRoom[];
  readonly areas: readonly SavedArea[];
}

export interface PlanRoom {
  readonly roomId: string;
  readonly cleaningMode: CleaningMode;
  readonly coverageSetting: CoverageSetting;
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
}

export interface PlansCatalog {
  readonly rooms: readonly Pick<MapRoom, "roomId" | "name">[];
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

const boundedString = (value: unknown, maximum: number, code: string): string => {
  if (typeof value !== "string") throw new ContractError(code);
  const text = value.trim();
  if (!text || Array.from(text).length > maximum || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new ContractError(code);
  }
  return text;
};

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

const nullableBoolean = (value: unknown, code: string): boolean | null => {
  if (value === null) return null;
  return booleanValue(value, code);
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
      sceneUrl: privatePath(entry.scene_url, "invalid-scene-url"),
      deltaUrl: entry.delta_url === undefined || entry.delta_url === null
        ? null
        : privatePath(entry.delta_url, "invalid-delta-url"),
      poseUrl: privatePath(entry.pose_url, "invalid-pose-url"),
      historyUrl: privatePath(entry.history_url, "invalid-history-url"),
      areasUrl: privatePath(entry.areas_url, "invalid-areas-url"),
      plansUrl: privatePath(entry.plans_url, "invalid-plans-url"),
      mapRevision,
      mapFloorCoherent: booleanValue(entry.map_floor_coherent, "invalid-floor-coherence"),
      mapSessionVerified: booleanValue(entry.map_session_verified, "invalid-session-state"),
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
      name: boundedString(room.name, 128, "invalid-room-name"),
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

const parseCircle = (value: unknown): AreaCircle => {
  const circle = objectValue(value, "invalid-area-circle");
  return {
    x: boundedNumber(circle.x, -1_000_000, 1_000_000, "invalid-area-circle"),
    y: boundedNumber(circle.y, -1_000_000, 1_000_000, "invalid-area-circle"),
    radius: boundedNumber(circle.radius, 0.05, 2.5, "invalid-area-circle"),
  };
};

const bindingStatus = (value: unknown): AreaBindingStatus => {
  if (value === "current" || value === "review" || value === "stale") return value;
  return "unknown";
};

export const parseAreasCatalog = (value: unknown): AreasCatalog => {
  const payload = objectValue(value, "invalid-areas");
  if (!Array.isArray(payload.areas) || payload.areas.length > 256) {
    throw new ContractError("invalid-area-list");
  }
  return {
    sceneUrl: privatePath(payload.scene_url, "invalid-area-scene-url"),
    rooms: parseRooms(payload.rooms, true),
    areas: payload.areas.map((candidate) => {
      const area = objectValue(candidate, "invalid-area");
      if (!Array.isArray(area.circles) || area.circles.length > 512) {
        throw new ContractError("invalid-area-circles");
      }
      return {
        id: boundedString(area.id, 128, "invalid-area-id"),
        name: boundedString(area.name, 128, "invalid-area-name"),
        circles: area.circles.map(parseCircle),
        cleaningMode: parseCleaningMode(area.cleaning_mode),
        coverageSetting: parseCoverage(area.coverage_setting),
        status: bindingStatus(area.status),
        canRebind: booleanValue(area.can_rebind, "invalid-area-rebind"),
      } satisfies SavedArea;
    }),
  };
};

export const parsePlansCatalog = (value: unknown): PlansCatalog => {
  const payload = objectValue(value, "invalid-plans");
  if (!Array.isArray(payload.plans) || payload.plans.length > 256) {
    throw new ContractError("invalid-plan-list");
  }
  const rooms = parseRooms(payload.rooms, false).map(({ roomId, name }) => ({ roomId, name }));
  return {
    rooms,
    selectedPlan: payload.selected_plan === null || payload.selected_plan === undefined
      ? null
      : boundedString(payload.selected_plan, 128, "invalid-selected-plan"),
    plans: payload.plans.map((candidate) => {
      const plan = objectValue(candidate, "invalid-plan");
      if (!Array.isArray(plan.rooms) || plan.rooms.length > 256 || !Array.isArray(plan.room_order)) {
        throw new ContractError("invalid-plan-rooms");
      }
      const runBehavior = plan.run_behavior;
      if (runBehavior !== "intelligent" && runBehavior !== "ordered") {
        throw new ContractError("invalid-run-behavior");
      }
      return {
        id: boundedString(plan.id, 128, "invalid-plan-id"),
        name: boundedString(plan.name, 128, "invalid-plan-name"),
        enabled: booleanValue(plan.enabled, "invalid-plan-enabled"),
        runBehavior,
        rooms: plan.rooms.map((roomCandidate) => {
          const room = objectValue(roomCandidate, "invalid-plan-room");
          return {
            roomId: boundedString(room.room_id, 128, "invalid-plan-room-id"),
            cleaningMode: parseCleaningMode(room.cleaning_mode),
            coverageSetting: parseCoverage(room.coverage_setting),
          } satisfies PlanRoom;
        }),
        roomOrder: plan.room_order.slice(0, 256).map((roomId) =>
          boundedString(roomId, 128, "invalid-room-order")),
        returnToBase: booleanValue(plan.return_to_base, "invalid-return-to-base"),
        finishCurrentRoom: booleanValue(plan.finish_current_room, "invalid-finish-room"),
        finishCurrentRoomThreshold: boundedInteger(
          plan.finish_current_room_threshold,
          0,
          100,
          "invalid-finish-threshold",
        ),
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
  return {
    position,
    source: boundedString(payload.source, 64, "invalid-pose-source"),
    revision: boundedInteger(payload.revision, 0, Number.MAX_SAFE_INTEGER, "invalid-pose-revision"),
    poseRevision: boundedInteger(payload.pose_revision, 0, Number.MAX_SAFE_INTEGER, "invalid-pose-sequence"),
    floorCoherent: booleanValue(payload.map_floor_coherent, "invalid-pose-floor"),
    freshness,
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
