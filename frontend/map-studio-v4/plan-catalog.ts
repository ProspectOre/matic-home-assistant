import { MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE, MAX_ROOM_SEQUENCE_SIZE } from "./contracts";
import {
  ContractError,
  booleanValue,
  boundedInteger,
  boundedNumber,
  boundedString,
  objectValue,
  privatePath,
  type CadenceReason,
  type DailyRoomLimit,
  type MapRoom,
  type NextRunHeldRoom,
  type NextRunPreview,
  type NextRunPreviewBlocker,
  type NextRunPreviewRoom,
  type NextRunPreviewStep,
  type PlanRoom,
  type PlansCatalog,
  type RoomCadencePolicy,
  type RoomCadenceProgress,
  type SavedPlan,
  type Unchecked,
} from "./backend-contracts";
import type * as wire from "./backend-schema";

const selectedId = (value: unknown, code: string): string | null =>
  value === null || value === undefined ? null : boundedString(value, 128, code);

const point = (value: unknown, code: string): readonly [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) throw new ContractError(code);
  return [boundedNumber(value[0], -1_000_000, 1_000_000, code), boundedNumber(value[1], -1_000_000, 1_000_000, code)];
};

const boundary = (value: unknown, code: string): readonly (readonly [number, number])[] => {
  if (!Array.isArray(value) || value.length < 3 || value.length > 8192) throw new ContractError(code);
  return value.map((candidate) => point(candidate, code));
};

const parseRooms = (value: unknown, includeBoundary: boolean): readonly MapRoom[] => {
  if (!Array.isArray(value) || value.length > 256) throw new ContractError("invalid-rooms");
  return value.map((candidate) => {
    const room: Unchecked<wire.MapRoom> = objectValue(candidate, "invalid-room");
    return {
      roomId: boundedString(room.room_id, 128, "invalid-room-id"),
      name: boundedString(room.name, 256, "invalid-room-name", true),
      boundary: includeBoundary ? boundary(room.boundary, "invalid-room-boundary") : [],
    };
  });
};

const parseCleaningMode = (value: unknown): "vacuum" | "mop" | "vacuum_and_mop" => {
  if (value === "vacuum" || value === "mop" || value === "vacuum_and_mop") return value;
  throw new ContractError("invalid-cleaning-mode");
};

const parseCoverage = (value: unknown): "quick" | "standard" | "heavy_duty" => {
  if (value === "quick" || value === "standard" || value === "heavy_duty") return value;
  throw new ContractError("invalid-coverage-setting");
};

const optionalBooleanDefaultFalse = (value: unknown, code: string): boolean =>
  value === undefined ? false : booleanValue(value, code);

const nullableInterval = (value: unknown, code: string): number | null =>
  value === null || value === undefined ? null : boundedInteger(value, 1, 100, code);

const parseCadenceReasons = (value: unknown): readonly CadenceReason[] => {
  if (value === undefined || value === null) return [];
  const validReasons: readonly CadenceReason[] = [
    "coverage_requires_vacuum", "mop_due", "coverage_due", "room_not_on_current_map", "identity_changed",
    "shared_schedule_unavailable", "mop_progress_unverified", "coverage_progress_unverified", "invalid_cadence_policy",
  ];
  if (!Array.isArray(value) || value.length > validReasons.length
    || value.some((reason) => !validReasons.includes(reason as CadenceReason))) {
    throw new ContractError("invalid-cadence-reasons");
  }
  return [...new Set(value as CadenceReason[])];
};

const parseCadencePolicy = (value: unknown): RoomCadencePolicy | undefined => {
  if (value === undefined || value === null) return undefined;
  const policy: Unchecked<wire.CadencePolicy> = objectValue(value, "invalid-room-cadence");
  const scope = policy.scope === undefined ? "plan" : policy.scope;
  if (scope !== "plan" && scope !== "shared") throw new ContractError("invalid-room-cadence-scope");
  const rawPeriodicCoverage = policy.periodic_coverage_setting;
  return {
    scope,
    mopEveryN: nullableInterval(policy.mop_every_n, "invalid-mop-interval"),
    coverageEveryN: nullableInterval(policy.coverage_every_n, "invalid-coverage-interval"),
    periodicCoverageSetting: rawPeriodicCoverage === null || rawPeriodicCoverage === undefined ? null : parseCoverage(rawPeriodicCoverage),
    doMopNext: optionalBooleanDefaultFalse(policy.do_mop_next, "invalid-do-mop-next"),
    doCoverageNext: optionalBooleanDefaultFalse(policy.do_coverage_next, "invalid-do-coverage-next"),
  };
};

/** The reasons travel next to the progress, as `cadence_reasons` or `shared_cadence_reasons`. */
const parseCadenceProgress = (value: unknown, reasonsValue: unknown): RoomCadenceProgress | undefined => {
  if (value === undefined || value === null) return undefined;
  const progress: Unchecked<wire.CadenceProgress> = objectValue(value, "invalid-room-cadence-progress");
  const effectiveMode = progress.effective_cleaning_mode;
  const effectiveCoverage = progress.effective_coverage_setting;
  const reasons = parseCadenceReasons(reasonsValue);
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

const parseDailyLimit = (value: unknown): DailyRoomLimit | undefined => {
  if (value === undefined) return undefined;
  const raw: Unchecked<wire.DailyLimit> = objectValue(value, "invalid-daily-limit");
  return {
    limit: raw.limit === null ? null : boundedInteger(raw.limit, 1, 100, "invalid-daily-limit"),
    completedToday: boundedInteger(raw.completed_today, 0, 1024, "invalid-daily-completions"),
    reached: booleanValue(raw.reached, "invalid-daily-limit-reached"),
    ...(raw.reason === undefined ? {} : { reason: boundedString(raw.reason, 128, "invalid-daily-limit-reason") }),
  };
};

const parseNextRunPreview = (value: unknown): NextRunPreview | undefined => {
  if (value === undefined || value === null) return undefined;
  const preview: Unchecked<wire.NextRunPreview> = objectValue(value, "invalid-plan-preview");
  const steps = preview.entries ?? preview.rooms;
  if (!Array.isArray(preview.rooms) || preview.rooms.length > MAX_ROOM_SEQUENCE_SIZE
    || !Array.isArray(steps) || steps.length > 2 * MAX_ROOM_SEQUENCE_SIZE
    || !Array.isArray(preview.mission_boundaries) || preview.mission_boundaries.length > steps.length) {
    throw new ContractError("invalid-plan-preview");
  }
  const stepCount = steps.length;
  const parsedSteps: NextRunPreviewStep[] = steps.map((candidate) => {
    const step: Unchecked<wire.PreviewRoomStep> & Unchecked<wire.PreviewAreaStep> = objectValue(candidate, "invalid-plan-preview-room");
    return {
      ...(step.kind === "area"
        ? { areaId: boundedString(step.area_id, 128, "invalid-plan-preview-room-id") }
        : { roomId: boundedString(step.room_id, 128, "invalid-plan-preview-room-id") }),
      name: boundedString(step.name, step.kind === "area" ? 128 : 256,
        "invalid-plan-preview-room-name", step.kind !== "area"),
      cleaningMode: parseCleaningMode(step.cleaning_mode),
      coverageSetting: parseCoverage(step.coverage_setting),
      cadenceReasons: parseCadenceReasons(step.cadence_reasons),
      ...(step.daily_limit === undefined ? {} : { dailyLimit: parseDailyLimit(step.daily_limit)! }),
    };
  });
  const rooms = parsedSteps.filter((step): step is NextRunPreviewRoom => "roomId" in step);
  const boundaries = preview.mission_boundaries.map((candidate) =>
    boundedInteger(candidate, 1, stepCount - 1, "invalid-plan-preview-boundary"));
  if (boundaries.some((value, index) => value <= (boundaries[index - 1] ?? 0))) {
    throw new ContractError("invalid-plan-preview-boundary-order");
  }
  const blockers: readonly NextRunPreviewBlocker[] = [
    "area_map_changed", "area_missing", "coverage_requires_vacuum", "cadence_identity_unavailable", "preview_unavailable",
    "plan_disabled", "plan_has_no_rooms", "plan_room_limit", "cadence_identity_changed", "shared_schedule_unavailable",
    "cadence_progress_unverified", "invalid_cadence_policy", "invalid_plan", "plan_rooms_held", "daily_limit_reached",
  ];
  const rawBlocker = preview.blocker;
  if (rawBlocker !== null && !blockers.includes(rawBlocker as NextRunPreviewBlocker)) {
    throw new ContractError("invalid-plan-preview-blocker");
  }
  if (rawBlocker === null && stepCount === 0) throw new ContractError("empty-plan-preview");
  const rawHeld = preview.held_rooms;
  if (rawHeld !== undefined && (!Array.isArray(rawHeld) || rawHeld.length > MAX_ROOM_SEQUENCE_SIZE)) {
    throw new ContractError("invalid-plan-preview-held");
  }
  const heldRooms = rawHeld?.map((candidate): NextRunHeldRoom => {
    const held: Unchecked<wire.HeldRoom> = objectValue(candidate, "invalid-plan-preview-held");
    return {
      roomId: boundedString(held.room_id, 128, "invalid-plan-preview-held"),
      name: boundedString(held.name, 256, "invalid-plan-preview-held", true),
      sensor: boundedString(held.sensor, 255, "invalid-plan-preview-held"),
    };
  });
  const previewToken = preview.preview_token;
  const dailyHeld = preview.daily_limit_held_rooms;
  if (dailyHeld !== undefined && (!Array.isArray(dailyHeld) || dailyHeld.length > MAX_ROOM_SEQUENCE_SIZE)) {
    throw new ContractError("invalid-daily-limit-held");
  }
  const dailyLimitHeldRooms = dailyHeld?.map((candidate) => {
    const raw: Unchecked<wire.DailyLimitHeldRoom> = objectValue(candidate, "invalid-daily-limit-held");
    return {
      ...parseDailyLimit(raw)!,
      roomId: boundedString(raw.room_id, 128, "invalid-daily-limit-room"),
      name: boundedString(raw.name, 256, "invalid-daily-limit-room-name", true),
    };
  });
  if (previewToken !== undefined && (typeof previewToken !== "string" || !/^[0-9a-f]{64}$/u.test(previewToken))) {
    throw new ContractError("invalid-plan-preview-token");
  }
  return {
    rooms, steps: parsedSteps, missionBoundaries: boundaries, blocker: rawBlocker as NextRunPreviewBlocker | null,
    ...(heldRooms?.length ? { heldRooms } : {}),
    ...(dailyLimitHeldRooms?.length ? { dailyLimitHeldRooms } : {}),
    ...(typeof previewToken === "string" ? { previewToken } : {}),
  };
};

export const roomPreviewHelpers = {
  ContractError, objectValue, boundedString, parseNextRunPreview, parseCadenceProgress, parseDailyLimit,
};

export const areaCatalogHelpers = {
  ContractError, objectValue, boundedString, boundedNumber, booleanValue,
  privatePath, parseRooms, parseCleaningMode, parseCoverage, selectedId,
};

const parsePlanRoom = (value: unknown): PlanRoom => {
  const room: Unchecked<wire.PlanRoom> = objectValue(value, "invalid-plan-room");
  const cadence = parseCadencePolicy(room.cadence);
  const cadenceProgress = parseCadenceProgress(room.cadence_progress, room.cadence_reasons);
  const cadenceReasons = parseCadenceReasons(room.cadence_reasons);
  const dailyLimit = parseDailyLimit(room.daily_limit);
  return {
    roomId: boundedString(room.room_id, 128, "invalid-plan-room-id"),
    cleaningMode: parseCleaningMode(room.cleaning_mode),
    coverageSetting: parseCoverage(room.coverage_setting),
    ...(cadence === undefined ? {} : { cadence }),
    ...(cadenceProgress === undefined ? {} : { cadenceProgress }),
    ...(cadenceReasons.length ? { cadenceReasons } : {}),
    ...(dailyLimit ? { dailyLimit } : {}),
  };
};

const occupancySensors = (value: unknown): Readonly<Record<string, string>> => {
  if (value === undefined) return {};
  const sensors = objectValue(value, "invalid-occupancy-sensors");
  const entries = Object.entries(sensors);
  if (entries.length > MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE) throw new ContractError("invalid-occupancy-sensors");
  return Object.fromEntries(entries.map(([roomId, sensor]) => [
    boundedString(roomId, 128, "invalid-occupancy-sensors"),
    boundedString(sensor, 255, "invalid-occupancy-sensors"),
  ]));
};

const estimateSeconds = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export const parsePlansCatalog = (value: unknown): PlansCatalog => {
  const payload: Unchecked<wire.PlansCatalog> = objectValue(value, "invalid-plans");
  if (!Array.isArray(payload.plans) || payload.plans.length > 256) throw new ContractError("invalid-plan-list");
  const rawRooms = payload.rooms;
  const rooms = parseRooms(rawRooms, false).map((room, index): PlansCatalog["rooms"][number] => {
    const raw = Array.isArray(rawRooms) ? rawRooms[index] : undefined;
    const row: Unchecked<wire.PlanCatalogRoom> = objectValue(raw, "invalid-room");
    const sharedCadence = parseCadencePolicy(row.shared_cadence);
    const sharedCadenceProgress = parseCadenceProgress(row.shared_cadence_progress, row.shared_cadence_reasons);
    const sharedCadenceReasons = parseCadenceReasons(row.shared_cadence_reasons);
    const sharedDeleteToken = row.shared_cadence_delete_token;
    if (sharedDeleteToken !== undefined && sharedDeleteToken !== null
      && (typeof sharedDeleteToken !== "string" || !/^[0-9a-f]{64}$/u.test(sharedDeleteToken))) {
      throw new ContractError("invalid-shared-cadence-delete-token");
    }
    return {
      roomId: room.roomId, name: room.name,
      ...(sharedCadence === undefined ? {} : { sharedCadence }),
      ...(sharedCadenceProgress === undefined ? {} : { sharedCadenceProgress }),
      ...(sharedCadenceReasons.length ? { sharedCadenceReasons } : {}),
      ...(typeof sharedDeleteToken === "string" ? { sharedDeleteToken } : {}),
      ...(row.daily_limit === undefined ? {} : { dailyLimit: parseDailyLimit(row.daily_limit)! }),
    };
  });
  return {
    rooms,
    ...(payload.entry_id === undefined ? {} : { entryId: boundedString(payload.entry_id, 128, "invalid-entry-id") }),
    ...(payload.floor_token === undefined ? {} : { floorToken: boundedString(payload.floor_token, 128, "invalid-floor-token") }),
    selectedPlan: selectedId(payload.selected_plan, "invalid-selected-plan"),
    plans: payload.plans.map((candidate) => {
      const plan: Unchecked<wire.SavedPlan> = objectValue(candidate, "invalid-plan");
      if (!Array.isArray(plan.rooms) || plan.rooms.length > MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE || !Array.isArray(plan.room_order)) {
        throw new ContractError("invalid-plan-rooms");
      }
      const runBehavior = plan.run_behavior;
      if (runBehavior !== "intelligent" && runBehavior !== "ordered") throw new ContractError("invalid-run-behavior");
      const nextRunPreview = parseNextRunPreview(plan.next_run_preview);
      return {
        id: boundedString(plan.id, 128, "invalid-plan-id"),
        name: boundedString(plan.name, 128, "invalid-plan-name"),
        enabled: booleanValue(plan.enabled, "invalid-plan-enabled"),
        runBehavior,
        rooms: plan.rooms.map(parsePlanRoom),
        roomOrder: plan.room_order.slice(0, MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE).map((roomId) =>
          boundedString(roomId, 128, "invalid-room-order")),
        returnToBase: booleanValue(plan.return_to_base, "invalid-return-to-base"),
        finishCurrentRoom: booleanValue(plan.finish_current_room, "invalid-finish-room"),
        finishCurrentRoomThreshold: boundedInteger(plan.finish_current_room_threshold, 0, 100, "invalid-finish-threshold"),
        occupancyAware: plan.occupancy_aware === undefined ? false : booleanValue(plan.occupancy_aware, "invalid-occupancy-aware"),
        occupancySensors: occupancySensors(plan.occupancy_sensors),
        ...(nextRunPreview === undefined ? {} : { nextRunPreview }),
        nextRunEstimateSeconds: estimateSeconds(plan.next_run_estimate_seconds),
        entries: plan.entries,
      } satisfies SavedPlan;
    }),
  };
};
