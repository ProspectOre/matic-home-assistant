import type {
  NextRunPreview,
  PlanRoom,
  PlansCatalog,
  RoomCadencePolicy,
  RoomCadenceProgress,
  SavedPlan,
} from "./backend-contracts";
import type { DialogKind, WorkspaceNotice, WorkspaceState } from "./contracts";
import { draftForPlan, initialWorkspaceState, manualRoomPreviewKey } from "./state";
import {
  syntheticAreas,
  syntheticEntry,
  syntheticHistory,
  syntheticPlans,
  syntheticPose,
  syntheticScene,
} from "./synthetic-fixtures";

export type GalleryScenario =
  | "ready"
  | "cleaning"
  | "paused"
  | "returning"
  | "recharging"
  | "rooms"
  | "draw"
  | "history"
  | "transition"
  | "problem"
  | "ha-offline"
  | "robot-offline"
  | "access"
  | "empty"
  | "unsupported"
  | "multi-robot"
  | "plans"
  | "plan-saved-intelligent"
  | "plan-saved-ordered"
  | "plan-new"
  | "plan-dirty"
  | "plan-cadence-shared"
  | "plan-cadence-blocked"
  | "plan-legacy-oversized"
  | "area-review-new"
  | "area-review-rebind"
  | "support"
  | "full-map"
  | "full-map-locating"
  | "starting"
  | "starting-command"
  | "stopping"
  | "stopping-command"
  | "task-in-progress"
  | "map-unavailable"
  | "map-limited"
  | "room-limit";

const verified = (): WorkspaceState => ({
  ...initialWorkspaceState(),
  coherence: "current",
  activity: "docked",
  batteryPercent: 92,
  robots: [{ entryId: "synthetic-entry", label: "Robot" }],
  host: {
    connected: true,
    administrator: true,
    robotConnected: true,
    robotCount: 1,
  },
  floor: {
    classifiedCount: 2,
    displayName: "House",
    readOnly: false,
  },
  map: {
    available: true,
    complete: true,
    floorCoherent: true,
    sessionVerified: true,
    exactPose: true,
  },
  resources: {
    catalog: { status: "ready", value: [syntheticEntry()], problem: null },
    entry: syntheticEntry(),
    scene: { status: "ready", value: syntheticScene(), problem: null },
    pose: { status: "ready", value: syntheticPose(), problem: null },
    history: { status: "ready", value: syntheticHistory(), problem: null },
    plans: { status: "ready", value: syntheticPlans(), problem: null },
    areas: { status: "ready", value: syntheticAreas(), problem: null },
  },
  selection: {
    ...initialWorkspaceState().selection,
    entryId: "synthetic-entry",
    planId: "daily",
  },
  planDraft: {
    ...initialWorkspaceState().planDraft,
    id: "daily",
    name: "Daily clean",
    rooms: syntheticPlans().plans[0]?.rooms || [],
  },
});

const requireFixture = <T>(value: T | undefined, name: string): T => {
  if (value === undefined) throw new Error(`Synthetic ${name} fixture is missing`);
  return value;
};

const savedDailyPlan = (): SavedPlan => requireFixture(syntheticPlans().plans[0], "plan");

/**
 * The synthetic catalog has four named rooms. Larger catalogs append plain
 * numbered rooms so limit states keep the same four named rooms first.
 */
const galleryRooms = (count: number): PlansCatalog["rooms"] => {
  const named = syntheticPlans().rooms;
  return Array.from({ length: count }, (_, index) =>
    named[index] ?? { roomId: `room-${index + 1}`, name: `Room ${index + 1}` });
};

const withPlans = (state: WorkspaceState, catalog: PlansCatalog): WorkspaceState => ({
  ...state,
  resources: {
    ...state.resources,
    plans: { status: "ready", value: catalog, problem: null },
  },
});

const catalogWith = (
  plans: readonly SavedPlan[],
  overrides: Partial<PlansCatalog> = {},
): PlansCatalog => ({
  ...syntheticPlans(),
  plans,
  selectedPlan: plans[0]?.id ?? null,
  ...overrides,
});

const planEditor = (
  state: WorkspaceState,
  plan: SavedPlan,
  catalog: PlansCatalog = catalogWith([plan]),
): WorkspaceState => ({
  ...withPlans(state, catalog),
  workflow: "plan",
  selection: { ...state.selection, planId: plan.id },
  planDraft: draftForPlan(plan),
});

const previewFor = (
  rooms: readonly PlanRoom[],
  overrides: Partial<NextRunPreview> = {},
): NextRunPreview => ({
  previewToken: "e".repeat(64),
  rooms: rooms.map((room) => ({
    roomId: room.roomId,
    name: syntheticPlans().rooms.find((candidate) => candidate.roomId === room.roomId)?.name ?? room.roomId,
    cleaningMode: room.cleaningMode,
    coverageSetting: room.coverageSetting,
    cadenceReasons: room.cadenceReasons ?? [],
  })),
  missionBoundaries: [],
  blocker: null,
  ...overrides,
});

/** Replaces a plan's rooms and keeps its room order and next-run preview in step. */
const planWithRooms = (
  plan: SavedPlan,
  rooms: readonly PlanRoom[],
  overrides: Partial<SavedPlan> = {},
): SavedPlan => ({
  ...plan,
  rooms,
  roomOrder: rooms.map((room) => room.roomId),
  nextRunPreview: previewFor(rooms),
  ...overrides,
});

const sharedCadencePolicy = (): RoomCadencePolicy => ({
  scope: "shared",
  mopEveryN: 3,
  coverageEveryN: 2,
  periodicCoverageSetting: "heavy_duty",
  doMopNext: false,
  doCoverageNext: false,
});

const sharedCadenceProgress = (): RoomCadenceProgress => ({
  mopProgress: 1,
  coverageProgress: 1,
  mopDue: false,
  coverageDue: false,
  nextMopIn: 2,
  nextCoverageIn: 1,
  reasons: [],
});

const patchFirstRoom = (plan: SavedPlan, patch: Partial<PlanRoom>): SavedPlan => {
  const [first, ...rest] = plan.rooms;
  return planWithRooms(plan, [{ ...requireFixture(first, "plan room"), ...patch }, ...rest]);
};

export const createGalleryState = (scenario: GalleryScenario): WorkspaceState => {
  const state = verified();
  switch (scenario) {
    case "ready":
      return state;
    case "cleaning":
      return { ...state, activity: "cleaning" };
    case "paused":
      return { ...state, activity: "paused" };
    case "returning":
      return { ...state, activity: "returning" };
    case "recharging":
      return { ...state, activity: "recharging", batteryPercent: 18 };
    case "rooms":
      return { ...state, workflow: "rooms" };
    case "draw":
      return {
        ...state,
        workflow: "draw",
        areaDraft: {
          ...state.areaDraft,
          id: "entryway",
          name: "Entryway",
          status: "current",
        },
        selection: { ...state.selection, areaId: "entryway" },
        draw: {
          ...state.draw,
          dirty: true,
          strokeCount: 3,
          circles: syntheticAreas().areas[0]?.circles || [],
        },
      };
    case "history":
      return {
        ...state,
        dataMode: "history",
        workflow: "history",
        floor: { ...state.floor, readOnly: true },
        map: { ...state.map, exactPose: false },
        selection: {
          ...state.selection,
          floorId: "saved-1",
          historyId: "saved-one",
        },
      };
    case "transition":
      return {
        ...state,
        coherence: "verifying",
        activity: "unknown",
        map: {
          available: false,
          complete: false,
          floorCoherent: false,
          sessionVerified: false,
          exactPose: false,
        },
      };
    case "problem":
      return { ...state, activity: "problem", coherence: "blocked" };
    case "ha-offline":
      return {
        ...state,
        coherence: "degraded",
        host: { ...state.host, connected: false },
        map: { ...state.map, exactPose: false },
      };
    case "robot-offline":
      return {
        ...state,
        coherence: "degraded",
        host: { ...state.host, robotConnected: false },
        map: { ...state.map, exactPose: false },
      };
    case "access":
      return {
        ...state,
        coherence: "blocked",
        host: { ...state.host, administrator: false },
        map: { ...state.map, available: false, exactPose: false },
      };
    case "empty":
      return {
        ...state,
        coherence: "unavailable",
        host: { ...state.host, robotConnected: false, robotCount: 0 },
        map: { ...state.map, available: false, exactPose: false },
      };
    case "unsupported":
      return {
        ...state,
        coherence: "blocked",
        map: { ...state.map, available: false, exactPose: false },
      };
    case "multi-robot":
      return {
        ...state,
        host: { ...state.host, robotCount: 2 },
        robots: [
          { entryId: "synthetic-entry", label: "Robot" },
          { entryId: "synthetic-entry-two", label: "Second robot" },
        ],
      };
    case "plans": {
      const daily = savedDailyPlan();
      const weekend = planWithRooms(
        { ...daily, id: "weekend", name: "Weekend refresh" },
        [
          { roomId: "room-b", cleaningMode: "vacuum_and_mop", coverageSetting: "heavy_duty" },
          { roomId: "room-d", cleaningMode: "vacuum", coverageSetting: "standard" },
        ],
        { runBehavior: "ordered" },
      );
      const guest = planWithRooms(
        { ...daily, id: "guest", name: "Guest prep", enabled: false },
        [{ roomId: "room-c", cleaningMode: "vacuum", coverageSetting: "quick" }],
      );
      return {
        ...withPlans(state, catalogWith([daily, weekend, guest])),
        workflow: "plans",
      };
    }
    case "plan-saved-intelligent":
      return planEditor(state, savedDailyPlan());
    case "plan-saved-ordered": {
      const daily = savedDailyPlan();
      const byId = new Map(daily.rooms.map((room) => [room.roomId, room]));
      const ordered = ["room-c", "room-a", "room-b"].flatMap((roomId) => {
        const room = byId.get(roomId);
        return room ? [room] : [];
      });
      return planEditor(state, planWithRooms(daily, ordered, { runBehavior: "ordered" }));
    }
    case "plan-new":
      return {
        ...withPlans(state, catalogWith([savedDailyPlan()])),
        workflow: "plan",
        selection: { ...state.selection, planId: null },
        planDraft: initialWorkspaceState().planDraft,
      };
    case "plan-dirty": {
      const edited = planEditor(state, savedDailyPlan());
      return {
        ...edited,
        planDraft: {
          ...edited.planDraft,
          dirty: true,
          rooms: [
            ...edited.planDraft.rooms,
            { roomId: "room-d", cleaningMode: "vacuum", coverageSetting: "standard" },
          ],
        },
      };
    }
    case "plan-cadence-shared": {
      const plan = patchFirstRoom(savedDailyPlan(), {
        cadence: sharedCadencePolicy(),
        cadenceProgress: sharedCadenceProgress(),
      });
      const catalog = catalogWith([plan]);
      return planEditor(state, plan, {
        ...catalog,
        rooms: catalog.rooms.map((room) => room.roomId === "room-a"
          ? { ...room, sharedCadence: sharedCadencePolicy(), sharedCadenceProgress: sharedCadenceProgress() }
          : room),
      });
    }
    case "plan-cadence-blocked": {
      const rooms = savedDailyPlan().rooms.map((room, index): PlanRoom => index === 0
        ? {
          ...room,
          cadence: { ...sharedCadencePolicy(), scope: "plan", coverageEveryN: null, periodicCoverageSetting: null },
          cadenceReasons: ["invalid_cadence_policy", "mop_progress_unverified"],
        }
        : room);
      return planEditor(state, planWithRooms(savedDailyPlan(), rooms, {
        nextRunPreview: previewFor(rooms, { blocker: "invalid_cadence_policy" }),
      }));
    }
    case "plan-legacy-oversized": {
      const catalogRooms = galleryRooms(101);
      const rooms = catalogRooms.map((room): PlanRoom => ({
        roomId: room.roomId,
        cleaningMode: "vacuum",
        coverageSetting: "standard",
      }));
      const plan = planWithRooms(savedDailyPlan(), rooms, {
        nextRunPreview: previewFor([], { blocker: "plan_room_limit" }),
      });
      return planEditor(state, plan, catalogWith([plan], { rooms: catalogRooms }));
    }
    case "area-review-new":
      return {
        ...state,
        workflow: "areaReview",
        areaDraft: { ...state.areaDraft, id: null, name: "", status: "new", canRebind: false, dirty: false },
        selection: { ...state.selection, areaId: null },
        draw: {
          ...state.draw,
          dirty: true,
          strokeCount: 3,
          circles: syntheticAreas().areas[0]?.circles || [],
        },
      };
    case "area-review-rebind": {
      const areas = syntheticAreas();
      const area = requireFixture(areas.areas[0], "area");
      return {
        ...state,
        workflow: "areaReview",
        resources: {
          ...state.resources,
          areas: {
            status: "ready",
            problem: null,
            value: { ...areas, areas: [{ ...area, status: "review", canRebind: true }] },
          },
        },
        areaDraft: {
          ...state.areaDraft,
          id: area.id,
          name: area.name,
          cleaningMode: area.cleaningMode,
          coverageSetting: area.coverageSetting,
          status: "review",
          canRebind: true,
          dirty: false,
        },
        selection: { ...state.selection, areaId: area.id },
        draw: { ...state.draw, dirty: false, strokeCount: 0, circles: area.circles },
      };
    }
    case "support":
      return { ...state, workflow: "support" };
    case "full-map":
      return { ...state, fullMap: true };
    case "full-map-locating":
      return { ...createGalleryState("transition"), fullMap: true };
    // The Home Assistant adapter never reports activity "starting" or
    // "stopping"; the live panel only shows those moments as a command state
    // over the last robot activity. The plain scenarios hold the literal
    // contract values, and the "-command" scenarios hold what the panel
    // actually produces while a start or stop request is in flight.
    case "starting":
      return { ...state, activity: "starting", command: "pending" };
    case "starting-command":
      return { ...state, activity: "docked", command: "starting" };
    case "stopping":
      return { ...state, activity: "stopping", command: "settling" };
    case "stopping-command":
      return { ...state, activity: "cleaning", command: "settling" };
    case "task-in-progress":
      return {
        ...state,
        activity: "docked",
        managedLock: true,
        resources: {
          ...state.resources,
          entry: state.resources.entry
            ? { ...state.resources.entry, runnerLocked: true, activePlan: true }
            : null,
        },
      };
    case "map-unavailable":
      return {
        ...state,
        coherence: "unavailable",
        map: { available: false, complete: false, floorCoherent: false, sessionVerified: true, exactPose: false },
        resources: {
          ...state.resources,
          entry: state.resources.entry
            ? { ...state.resources.entry, mapFloorCoherent: false, mapBlockReason: "floor_plan_unavailable", mapComplete: false }
            : null,
          scene: { status: "error", value: null, problem: "request-failed" },
        },
      };
    case "map-limited":
      return { ...state, coherence: "degraded" };
    case "room-limit": {
      const rooms = galleryRooms(100);
      const roomIds = rooms.map((room) => room.roomId);
      return withGalleryRoomPreview({
        ...withPlans(state, { ...syntheticPlans(), rooms }),
        workflow: "rooms",
        selection: {
          ...state.selection,
          roomIds,
          roomSettings: roomIds.map((roomId): PlanRoom => ({
            roomId,
            cleaningMode: "vacuum",
            coverageSetting: "standard",
          })),
        },
      });
    }
  }
};

export const withGalleryRoomPreview = (state: WorkspaceState): WorkspaceState => {
  if (state.workflow !== "rooms") {
    return { ...state, manualRoomPreview: { status: "idle", value: null, problem: null } };
  }
  const key = manualRoomPreviewKey(state);
  if (!key || !state.selection.entryId) return { ...state, manualRoomPreview: { status: "idle", value: null, problem: null } };
  const entry = state.resources.entry;
  const rooms = state.resources.plans.value?.rooms ?? [];
  const preview = {
    entryId: state.selection.entryId,
    floorToken: "f".repeat(64),
    previewToken: "e".repeat(64),
    rooms: state.selection.roomIds.flatMap((roomId) => {
      const settings = state.selection.roomSettings.find((room) => room.roomId === roomId);
      if (!settings) return [];
      return [{
        roomId,
        name: rooms.find((room) => room.roomId === roomId)?.name ?? roomId,
        cleaningMode: settings.cleaningMode,
        coverageSetting: settings.coverageSetting,
        cadenceReasons: [],
      }];
    }),
    missionBoundaries: [],
    blocker: null,
  } as const;
  return {
    ...state,
    manualRoomPreview: {
      status: "ready",
      problem: null,
      value: {
        key,
        generation: state.generation,
        floorKey: [entry?.selectedFloorOrdinal ?? "none", entry?.mapFloorOrdinal ?? "none", entry?.mapFloorCoherent ? "coherent" : "transition"].join(":"),
        missionKey: [entry?.mapFloorOrdinal ?? "none", entry?.mapSessionVerified ? "verified" : "unverified", entry?.mapSessionKey ?? "no-session"].join(":"),
        preview,
      },
    },
  };
};

export const GALLERY_SCENARIOS: readonly GalleryScenario[] = [
  "ready",
  "cleaning",
  "paused",
  "returning",
  "recharging",
  "rooms",
  "draw",
  "history",
  "transition",
  "problem",
  "ha-offline",
  "robot-offline",
  "access",
  "empty",
  "unsupported",
  "multi-robot",
  "plans",
  "plan-saved-intelligent",
  "plan-saved-ordered",
  "plan-new",
  "plan-dirty",
  "plan-cadence-shared",
  "plan-cadence-blocked",
  "plan-legacy-oversized",
  "area-review-new",
  "area-review-rebind",
  "support",
  "full-map",
  "full-map-locating",
  "starting",
  "starting-command",
  "stopping",
  "stopping-command",
  "task-in-progress",
  "map-unavailable",
  "map-limited",
  "room-limit",
];

/** Every dialog the shell can show; the UX audit captures each one. */
export const GALLERY_DIALOGS: readonly DialogKind[] = [
  "discardDraft",
  "confirmDeletePlan",
  "confirmDeleteArea",
  "confirmResetCadence",
];

/** Every notice tone the workflow panels render. */
export const GALLERY_NOTICE_TONES: readonly WorkspaceNotice["tone"][] = [
  "info",
  "success",
  "warning",
  "error",
];
