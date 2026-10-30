import { liveCameraKey } from "./camera-preferences";
import type {
  AreasCatalog,
  CadenceReason,
  ManualRoomSequencePreview,
  NextRunPreview,
  NextRunPreviewBlocker,
  PlanRoom,
  PlansCatalog,
  RoomCadencePolicy,
  RoomCadenceProgress,
  SavedArea,
  SavedPlan,
} from "./backend-contracts";
import { notice, type DialogKind, type PlanView, type WorkspaceNotice, type WorkspaceState } from "./contracts";
import { entryFloorKey, entryMissionKey } from "./backend-contracts";
import { draftForPlan, initialWorkspaceState, manualRoomPreviewKey } from "./state";
import {
  syntheticAreas,
  syntheticEntry,
  syntheticHistory,
  syntheticPlans,
  syntheticPose,
  syntheticRuns,
  syntheticScene,
  syntheticTrail,
} from "./synthetic-fixtures";

export type GalleryScenario =
  | "ready"
  | "cleaning"
  | "paused"
  | "returning"
  | "recharging"
  | "rooms"
  | "draw"
  | "draw-points"
  | "draw-saved"
  | "draw-redraw"
  | "history"
  | "history-floors"
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
  | "plan-run-paused"
  | "plan-run-blocked"
  | "plan-run-parts"
  | "plan-edit-ordered"
  | "plan-new"
  | "plan-dirty"
  | "plan-cadence-shared"
  | "plan-cadence-blocked"
  | "plan-schedule-conflict"
  | "plan-schedule-available"
  | "plan-schedule-joining"
  | "plan-legacy-oversized"
  | "area-review-new"
  | "area-review-saved"
  | "area-review-rebind"
  | "area-review-stale"
  | "support"
  | "runs"
  | "full-map"
  | "full-map-cleaning"
  | "full-map-locating"
  | "starting"
  | "starting-command"
  | "stopping"
  | "stopping-command"
  | "task-in-progress"
  | "map-unavailable"
  | "map-limited"
  | "room-limit"
  | "rooms-ready"
  | "rooms-busy"
  | "rooms-failed"
  | "rooms-empty"
  | "home-plan-due"
  | "home-plan-paused"
  | "home-plan-blocked"
  | "home-plan-due-full"
  | "home-shortcuts"
  | "home-unpinned"
  | "home-shortcut-blocked"
  | "home-shortcut-running"
  | "home-pins-error"
  | "areas-list"
  | "areas-empty"
  | "areas-stale"
  | "plan-run-areas"
  | "plan-run-areas-only"
  | "plan-edit-areas"
  | "plan-edit-areas-rotation"
  | "plan-edit-area-stale"
  | "areas-in-plans"
  | "area-delete-refused"
  | "home-shortcut-areas";

const verified = (): WorkspaceState => ({
  ...initialWorkspaceState(),
  deepMop: { entityId: "switch.synthetic_deep_mop", enabled: false },
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
    runs: { status: "ready", value: syntheticRuns(), problem: null },
  },
  // A user whose default plan was seeded as their first home shortcut.
  homePins: { status: "ready", pins: [{ kind: "plan", id: "daily" }] },
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

/** Your areas' catalog: the synthetic Entryway plus a mop area, a changed one and one that needs redrawing. */
const galleryAreas = (): AreasCatalog => {
  const catalog = syntheticAreas();
  const entryway = requireFixture(catalog.areas[0], "area");
  return {
    ...catalog,
    areas: [
      entryway,
      { ...entryway, id: "dining", name: "Under the dining table", cleaningMode: "mop", circles: [{ x: 5.5, y: 2, radius: 0.4 }] },
      { ...entryway, id: "hallway", name: "Hallway rug", coverageSetting: "heavy_duty", status: "review", canRebind: true, circles: [{ x: 4.4, y: 4.2, radius: 0.3 }] },
      { ...entryway, id: "porch", name: "Porch mat", status: "stale", circles: [{ x: 7.5, y: 5.5, radius: 0.3 }] },
    ],
  };
};

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

const openPlan = (
  state: WorkspaceState,
  plan: SavedPlan,
  planView: PlanView,
  catalog: PlansCatalog = catalogWith([plan]),
): WorkspaceState => ({
  ...withPlans(state, catalog),
  workflow: "plan",
  planView,
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

// Custom areas in plans: the plans list sends each plan's run order as
// entries, a room or a custom area with its own settings and name.
const roomEntry = (roomId: string) => ({ kind: "room", room_id: roomId });
const areaEntry = (area: SavedArea) => ({
  kind: "area", area_id: area.id, name: area.name, cleaning_mode: area.cleaningMode, coverage_setting: area.coverageSetting,
});
const areaStep = (area: SavedArea) => ({
  areaId: area.id, name: area.name, cleaningMode: area.cleaningMode, coverageSetting: area.coverageSetting, cadenceReasons: [],
});
const galleryArea = (id: string): SavedArea => requireFixture(galleryAreas().areas.find((area) => area.id === id), "area");

/**
 * Daily clean with Entryway after Kitchen and the dining table last. Rooms
 * and areas never share a part, and each area is a part of its own, so the
 * next run has four parts.
 */
const areasPlan = (runBehavior: SavedPlan["runBehavior"]): SavedPlan => {
  const daily = savedDailyPlan();
  const [kitchen, living, office] = previewFor(daily.rooms).rooms;
  const entryway = galleryArea("entryway");
  const dining = galleryArea("dining");
  return {
    ...daily,
    runBehavior,
    entries: [roomEntry("room-a"), areaEntry(entryway), roomEntry("room-b"), roomEntry("room-c"), areaEntry(dining)],
    nextRunPreview: previewFor(runBehavior === "intelligent" ? [...daily.rooms].reverse() : daily.rooms, {
      // Synthetic history: dining has waited longest, followed by Office.
      steps: (runBehavior === "intelligent"
        ? [areaStep(dining), office, areaStep(entryway), living, kitchen]
        : [kitchen, areaStep(entryway), living, office, areaStep(dining)]).filter((step) => step !== undefined),
      missionBoundaries: runBehavior === "intelligent" ? [1, 2, 3] : [1, 2, 4],
    }),
    nextRunEstimateSeconds: null,
  };
};

/** "Spots": a plan of two custom areas and no rooms, in Saved order. */
const spotsPlan = (): SavedPlan => {
  const entryway = galleryArea("entryway");
  const dining = galleryArea("dining");
  return {
    ...planWithRooms({ ...savedDailyPlan(), id: "spots", name: "Spots", runBehavior: "ordered" }, []),
    entries: [areaEntry(entryway), areaEntry(dining)],
    nextRunPreview: previewFor([], { steps: [areaStep(entryway), areaStep(dining)], missionBoundaries: [1] }),
    nextRunEstimateSeconds: null,
  };
};

/** The gallery's areas catalog beside a plans catalog. */
const withAreas = (state: WorkspaceState): WorkspaceState => ({
  ...state,
  resources: { ...state.resources, areas: { status: "ready", value: galleryAreas(), problem: null } },
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
  const base = verified();
  const state = { ...base, cameraKey: liveCameraKey(base) };
  switch (scenario) {
    case "ready":
      return state;
    case "cleaning":
      return { ...state, activity: "cleaning", currentArea: "Kitchen" };
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
        // A fresh draw from home with three strokes down; a redraw is reached
        // from area-review-rebind's Redraw.
        areaDraft: { ...state.areaDraft, id: null, name: "", status: "new", canRebind: false, dirty: false },
        selection: { ...state.selection, areaId: null },
        draw: {
          ...state.draw,
          dirty: true,
          strokeCount: 3,
          circles: syntheticAreas().areas[0]?.circles || [],
        },
      };
    case "draw-points": {
      // The same fresh draw with the Points tool chosen.
      const fresh = createGalleryState("draw");
      return { ...fresh, draw: { ...fresh.draw, tool: "outline" } };
    }
    case "draw-saved":
      // Redrawing the saved Entryway, dirty: the effects tests' subject.
      return {
        ...state,
        workflow: "draw",
        areaDraft: { ...state.areaDraft, id: "entryway", name: "Entryway", status: "current" },
        selection: { ...state.selection, areaId: "entryway" },
        draw: { ...state.draw, dirty: true, strokeCount: 3, circles: syntheticAreas().areas[0]?.circles || [] },
      };
    case "draw-redraw": {
      // Just after Redraw from the saved Entryway's review: its outline is on
      // the map and nothing has changed yet (Done, not Save area).
      const redraw = createGalleryState("draw-saved");
      return { ...redraw, draw: { ...redraw.draw, dirty: false, strokeCount: 0 } };
    }
    case "history":
      return {
        ...state,
        dataMode: "history",
        workflow: "history",
        floor: { ...state.floor, displayName: "Shed", readOnly: true },
        map: { ...state.map, exactPose: false },
        selection: {
          ...state.selection,
          floorId: "saved-1",
          historyId: "saved-one",
        },
      };
    case "history-floors":
      // Two unlabelled floors; four saved maps on the saved one, the second
      // on show (the scrubber needs three or more).
      return {
        ...createGalleryState("history"),
        floor: { ...state.floor, displayName: "Saved floor 1", readOnly: true },
        resources: {
          ...state.resources,
          history: { status: "ready", problem: null, value: {
            ...syntheticHistory(),
            floors: [
              { ...requireFixture(syntheticHistory().floors[0], "floor"), label: null },
              { ...requireFixture(syntheticHistory().floors[1], "floor"), label: null, ordinal: 1, snapshots: [
                { id: "saved-one", createdAt: "2026-08-25T09:00:00Z", revision: 3, pointCount: 3_100, sceneUrl: "/synthetic-history-saved" },
                { id: "saved-two", createdAt: "2026-08-26T10:15:00Z", revision: 4, pointCount: 3_100, sceneUrl: "/synthetic-history-saved" },
                { id: "saved-three", createdAt: "2026-08-27T18:40:00Z", revision: 5, pointCount: 3_100, sceneUrl: "/synthetic-history-saved" },
                { id: "saved-four", createdAt: "2026-08-28T11:30:00Z", revision: 6, pointCount: 3_100, sceneUrl: "/synthetic-history-saved" },
              ] },
            ],
          } },
        },
        selection: { ...state.selection, floorId: "saved-1", historyId: "saved-two" },
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
      // The picker's line 3 kinds (plan.md §3): due work, a blocked run, a paused plan.
      const saved = savedDailyPlan();
      // Two rooms share mop due work, so the line joins them (plan.md §3).
      const daily = planWithRooms(saved, saved.rooms.map((room, index): PlanRoom => index === 0
        ? { ...room, cadenceReasons: ["mop_due", "coverage_due"] }
        : index === 1 ? { ...room, cadenceReasons: ["mop_due"] } : room));
      const weekend = planWithRooms(
        { ...daily, id: "weekend", name: "Weekend refresh" },
        [
          { roomId: "room-b", cleaningMode: "vacuum_and_mop", coverageSetting: "heavy_duty" },
          { roomId: "room-d", cleaningMode: "vacuum", coverageSetting: "standard" },
        ],
        { runBehavior: "ordered", nextRunPreview: previewFor([], { blocker: "cadence_progress_unverified" }) },
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
      return openPlan(state, savedDailyPlan(), "run");
    case "plan-saved-ordered": {
      const daily = savedDailyPlan();
      const byId = new Map(daily.rooms.map((room) => [room.roomId, room]));
      const ordered = ["room-c", "room-a", "room-b"].flatMap((roomId) => {
        const room = byId.get(roomId);
        return room ? [room] : [];
      });
      return openPlan(state, planWithRooms(daily, ordered, { runBehavior: "ordered" }), "run");
    }
    case "plan-run-paused":
      return openPlan(state, {
        ...savedDailyPlan(),
        enabled: false,
        nextRunPreview: previewFor([], { blocker: "plan_disabled" }),
        nextRunEstimateSeconds: null,
      }, "run");
    case "plan-run-blocked": {
      const rooms = savedDailyPlan().rooms.map((room, index): PlanRoom => index === 1
        ? { ...room, cadenceReasons: ["mop_progress_unverified"] }
        : room);
      return openPlan(state, planWithRooms(savedDailyPlan(), rooms, {
        nextRunPreview: previewFor([], { blocker: "cadence_progress_unverified" }),
        nextRunEstimateSeconds: null,
      }), "run");
    }
    case "plan-run-parts": {
      // Saved order with a mode change after the first room (plan.md R1 parts).
      const rooms = savedDailyPlan().rooms.map((room, index): PlanRoom => index === 0
        ? { ...room, cleaningMode: "vacuum_and_mop", cadenceReasons: ["mop_due"] }
        : room);
      return openPlan(state, planWithRooms(savedDailyPlan(), rooms, {
        runBehavior: "ordered",
        nextRunPreview: previewFor(rooms, { missionBoundaries: [1] }),
      }), "run");
    }
    case "plan-edit-ordered":
      return openPlan(state, { ...savedDailyPlan(), runBehavior: "ordered" }, "edit");
    case "plan-new":
      return {
        ...withPlans(state, catalogWith([savedDailyPlan()])),
        workflow: "plan",
        planView: "edit",
        selection: { ...state.selection, planId: null },
        planDraft: initialWorkspaceState().planDraft,
      };
    case "plan-dirty": {
      const edited = openPlan(state, savedDailyPlan(), "edit");
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
      return {
        ...openPlan(state, plan, "edit", {
          ...catalog,
          rooms: catalog.rooms.map((room) => room.roomId === "room-a"
            ? { ...room, sharedCadence: sharedCadencePolicy(), sharedCadenceProgress: sharedCadenceProgress() }
            : room),
        }),
        expandedRoom: "room-a",
      };
    }
    case "plan-cadence-blocked": {
      const rooms = savedDailyPlan().rooms.map((room, index): PlanRoom => index === 0
        ? {
          ...room,
          cadence: { ...sharedCadencePolicy(), scope: "plan", coverageEveryN: null, periodicCoverageSetting: null },
          cadenceReasons: ["invalid_cadence_policy", "mop_progress_unverified"],
        }
        : room);
      return {
        ...openPlan(state, planWithRooms(savedDailyPlan(), rooms, {
          nextRunPreview: previewFor(rooms, { blocker: "invalid_cadence_policy" }),
        }), "edit"),
        expandedRoom: "room-a",
      };
    }
    case "plan-schedule-available":
    case "plan-schedule-joining": {
      // Office has a shared schedule this plan doesn't use yet (room-schedule.md §4 S6, S7).
      const catalog = catalogWith([savedDailyPlan()]);
      const available = {
        ...openPlan(state, savedDailyPlan(), "edit", {
          ...catalog,
          rooms: catalog.rooms.map((room) => room.roomId === "room-c"
            ? { ...room, sharedCadence: sharedCadencePolicy(), sharedCadenceProgress: sharedCadenceProgress() }
            : room),
        }),
        expandedRoom: "room-c",
      };
      return scenario === "plan-schedule-available" ? available : {
        ...available,
        planDraft: {
          ...available.planDraft,
          dirty: true,
          rooms: available.planDraft.rooms.map((room) => room.roomId === "room-c" ? { ...room, cadence: sharedCadencePolicy() } : room),
        },
      };
    }
    case "plan-schedule-conflict": {
      // A vacuum rotation left on a mop-only room (room-schedule.md §4 S10).
      const plan = patchFirstRoom(savedDailyPlan(), {
        cleaningMode: "mop",
        cadence: { ...sharedCadencePolicy(), scope: "plan", mopEveryN: null, coverageEveryN: 3 },
        cadenceReasons: ["coverage_requires_vacuum"],
      });
      return { ...openPlan(state, plan, "edit"), expandedRoom: "room-a" };
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
      return openPlan(state, plan, "edit", catalogWith([plan], { rooms: catalogRooms }));
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
    case "area-review-saved": {
      // The saved Entryway reopened from Custom areas: nothing to fix.
      const area = requireFixture(syntheticAreas().areas[0], "area");
      return {
        ...state,
        workflow: "areaReview",
        areaDraft: {
          ...state.areaDraft,
          id: area.id,
          name: area.name,
          cleaningMode: area.cleaningMode,
          coverageSetting: area.coverageSetting,
          status: "current",
          canRebind: false,
          dirty: false,
        },
        selection: { ...state.selection, areaId: area.id },
        draw: { ...state.draw, dirty: false, strokeCount: 0, circles: area.circles },
      };
    }
    case "area-review-stale": {
      // The saved Entryway can't be used on this map: redraw is the one fix.
      const review = createGalleryState("area-review-rebind");
      const areas = review.resources.areas.value;
      return {
        ...review,
        resources: {
          ...review.resources,
          areas: {
            ...review.resources.areas,
            value: areas ? { ...areas, areas: areas.areas.map((area) => ({ ...area, status: "stale", canRebind: false })) } : null,
          },
        },
        areaDraft: { ...review.areaDraft, status: "stale", canRebind: false },
      };
    }
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
    case "runs":
      return { ...state, workflow: "runs", trail: syntheticTrail() };
    case "full-map":
      return { ...state, fullMap: true };
    case "full-map-cleaning":
      // Full map while the robot works: Stop stays in the HUD.
      return { ...state, activity: "cleaning", fullMap: true };
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
    // The home plan card's third line kinds (home-rooms.md §5 Cards): due
    // work in two rooms, a paused plan, a blocked run.
    case "home-plan-due": {
      const saved = savedDailyPlan();
      const rooms = saved.rooms.map((room, index): PlanRoom => index === 0
        ? { ...room, cadenceReasons: ["mop_due"] }
        : index === 1 ? { ...room, coverageSetting: "heavy_duty", cadenceReasons: ["mop_due", "coverage_due"] } : room);
      return withPlans(state, catalogWith([planWithRooms(saved, rooms)]));
    }
    case "home-plan-paused":
      return withPlans(state, catalogWith([{
        ...savedDailyPlan(),
        enabled: false,
        nextRunPreview: previewFor([], { blocker: "plan_disabled" }),
        nextRunEstimateSeconds: null,
      }]));
    case "home-plan-blocked":
      return withPlans(state, catalogWith([planWithRooms(savedDailyPlan(), savedDailyPlan().rooms, {
        nextRunPreview: previewFor([], { blocker: "cadence_progress_unverified" }),
        nextRunEstimateSeconds: null,
      })]));
    case "home-plan-due-full": {
      // One line per due kind, four in all: none is cut (owner, 2026-10-13).
      const saved = savedDailyPlan();
      const rooms: PlanRoom[] = [
        { roomId: "room-a", cleaningMode: "vacuum", coverageSetting: "quick", cadenceReasons: ["mop_due", "coverage_due"] },
        { roomId: "room-b", cleaningMode: "vacuum", coverageSetting: "standard", cadenceReasons: ["mop_due", "coverage_due"] },
        { roomId: "room-c", cleaningMode: "vacuum", coverageSetting: "heavy_duty", cadenceReasons: ["coverage_due"] },
        { roomId: "room-d", cleaningMode: "vacuum", coverageSetting: "heavy_duty", cadenceReasons: ["mop_due", "coverage_due"] },
      ];
      return withPlans(state, catalogWith([planWithRooms(saved, rooms)]));
    }
    case "home-shortcuts": {
      // Two plans and an area pinned, in the order they were added.
      const plans = withPlans(state, catalogWith([savedDailyPlan(), { ...savedDailyPlan(), id: "weekend", name: "Weekend refresh" }]));
      return {
        ...plans,
        resources: { ...plans.resources, areas: { status: "ready", value: galleryAreas(), problem: null } },
        homePins: { status: "ready", pins: [{ kind: "plan", id: "daily" }, { kind: "area", id: "entryway" }, { kind: "plan", id: "weekend" }] },
      };
    }
    case "home-unpinned":
      return { ...state, homePins: { status: "ready", pins: [] } };
    case "home-shortcut-blocked": {
      // A plan Home Assistant can't run and an area the map moved under.
      const blocked = createGalleryState("home-plan-blocked");
      return {
        ...blocked,
        resources: { ...blocked.resources, areas: { status: "ready", value: galleryAreas(), problem: null } },
        homePins: { status: "ready", pins: [{ kind: "plan", id: "daily" }, { kind: "area", id: "hallway" }, { kind: "area", id: "porch" }] },
      };
    }
    case "home-shortcut-running": {
      // A pinned plan's run is under way: Stop holds the bar, shortcuts wait.
      const pinned = createGalleryState("home-shortcuts");
      return { ...pinned, activity: "cleaning", currentArea: "Kitchen", resources: { ...pinned.resources, entry: { ...syntheticEntry(), activePlan: true } } };
    }
    case "home-pins-error":
      return { ...state, homePins: { status: "error", pins: [] } };
    case "areas-list":
      return { ...state, workflow: "areas", resources: { ...state.resources, areas: { status: "ready", value: galleryAreas(), problem: null } } };
    case "areas-empty":
      return { ...state, workflow: "areas", resources: { ...state.resources, areas: { status: "ready", value: { ...syntheticAreas(), areas: [], selectedArea: null }, problem: null } } };
    case "areas-stale": {
      // One area the map changed under, one Home Assistant can't place.
      const areas = galleryAreas();
      return {
        ...state,
        workflow: "areas",
        resources: {
          ...state.resources,
          areas: { status: "ready", value: { ...areas, areas: areas.areas.map((area) => area.id === "entryway" ? { ...area, status: "review", canRebind: true } : area) }, problem: null },
        },
      };
    }
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
    // Rooms with four rooms selected (home-rooms.md §4 R3): Kitchen's mop is
    // due, Living room's heavy duty rotation is due, and the clean runs in
    // two parts.
    case "rooms-ready":
    case "rooms-busy":
    case "rooms-failed": {
      const roomIds = scenario === "rooms-failed" ? ["room-a", "room-b"] : ["room-a", "room-b", "room-c", "room-d"];
      const rooms: WorkspaceState = {
        ...state,
        workflow: "rooms",
        activity: scenario === "rooms-busy" ? "cleaning" : state.activity,
        selection: {
          ...state.selection,
          roomIds,
          roomSettings: roomIds.map((roomId): PlanRoom => ({ roomId, cleaningMode: "vacuum", coverageSetting: "standard" })),
        },
      };
      if (scenario === "rooms-failed") {
        return { ...rooms, manualRoomPreview: { status: "error", value: null, problem: "request-failed" } };
      }
      return withGalleryRoomPreview(rooms, {
        reasons: { "room-a": ["mop_due"], "room-b": ["coverage_due"] },
        effective: { "room-a": { cleaningMode: "vacuum_and_mop", coverageSetting: "standard" }, "room-b": { cleaningMode: "vacuum", coverageSetting: "heavy_duty" } },
        missionBoundaries: [2],
      });
    }
    case "rooms-empty":
      return { ...withPlans(state, { ...syntheticPlans(), rooms: [], plans: [], selectedPlan: null }), workflow: "rooms" };
    // Custom areas in plans. Run lists the areas in their places and parts.
    case "plan-run-areas":
      return openPlan(withAreas(state), areasPlan("ordered"), "run");
    case "plan-run-areas-only":
      return openPlan(withAreas(state), spotsPlan(), "run", catalogWith([savedDailyPlan(), spotsPlan()]));
    // Edit shows the saved tie-break order. Smart Order ranks all
    // entries from history when previewing a run, so editing shows no numbers.
    case "plan-edit-areas":
      return openPlan(withAreas(state), areasPlan("ordered"), "edit");
    case "plan-edit-areas-rotation":
      return openPlan(withAreas(state), areasPlan("intelligent"), "edit");
    case "plan-edit-area-stale": {
      // Porch mat was drawn on another map and Old rug was deleted: both
      // need attention, and the changed plan can't save until they go.
      const plan = areasPlan("ordered");
      const entries = [...plan.entries as unknown[], areaEntry(galleryArea("porch")),
        { kind: "area", area_id: "old-rug", name: "Old rug", cleaning_mode: "vacuum", coverage_setting: "quick" }];
      const edited = openPlan(withAreas(state), { ...plan, entries }, "edit");
      return { ...edited, planDraft: { ...edited.planDraft, dirty: true } };
    }
    case "areas-in-plans": {
      // Entryway and the dining table are in two plans each; Weekend refresh has rooms only.
      const weekend = { ...savedDailyPlan(), id: "weekend", name: "Weekend refresh" };
      return { ...withAreas(withPlans(state, catalogWith([areasPlan("ordered"), spotsPlan(), weekend]))), workflow: "areas" };
    }
    case "area-delete-refused": {
      // Delete was refused: Entryway is all that "Entryway only" cleans.
      const only = { ...spotsPlan(), id: "entryway-only", name: "Entryway only", entries: [areaEntry(galleryArea("entryway"))] };
      const review = createGalleryState("area-review-saved");
      return {
        ...withAreas(withPlans(review, catalogWith([savedDailyPlan(), only]))),
        notice: notice("error", "v4_notice_area_in_plans_one", "Can't delete this area because it's all that {plans} cleans. Edit or delete that plan first.", {
          plans: "\"Entryway only\"",
        }),
      };
    }
    case "home-shortcut-areas": {
      // A pinned plan of rooms and areas, and one of areas alone.
      const plans = withAreas(withPlans(state, catalogWith([areasPlan("intelligent"), spotsPlan()])));
      return { ...plans, homePins: { status: "ready", pins: [{ kind: "plan", id: "daily" }, { kind: "plan", id: "spots" }] } };
    }
  }
};

export interface GalleryPreviewOverrides {
  readonly reasons?: Readonly<Record<string, readonly CadenceReason[]>>;
  readonly effective?: Readonly<Record<string, Pick<PlanRoom, "cleaningMode" | "coverageSetting">>>;
  readonly missionBoundaries?: readonly number[];
  readonly blocker?: NextRunPreviewBlocker | null;
}

// The overrides a preview was built with, keyed by its token, so the preview
// keeps the backend's exact shape (effects compares previews by value) and
// survives the gallery's structuredClone. A preview without overrides keeps the
// plain gallery token.
const GALLERY_PREVIEW_TOKEN = "e".repeat(64);
const overridesByToken = new Map<string, GalleryPreviewOverrides>();
const hasOverrides = (overrides: GalleryPreviewOverrides): boolean => Object.values(overrides).some((value) => value !== undefined);
const tokenFor = (overrides: GalleryPreviewOverrides): string => {
  if (!hasOverrides(overrides)) return GALLERY_PREVIEW_TOKEN;
  const token = "e".repeat(56) + overridesByToken.size.toString(16).padStart(8, "0");
  overridesByToken.set(token, overrides);
  return token;
};

/**
 * The gallery's stand-in for the backend's room preview. The overrides (due
 * reasons, effective settings, parts and a blocker) are remembered by the
 * preview's token, so the gallery's re-application after every intent keeps
 * them, and later overrides merge over them; a loading or failed preview a
 * scenario or test set deliberately is left alone.
 */
export const withGalleryRoomPreview = (state: WorkspaceState, overrides?: GalleryPreviewOverrides): WorkspaceState => {
  if (state.workflow !== "rooms") {
    return { ...state, manualRoomPreview: { status: "idle", value: null, problem: null } };
  }
  if (!overrides && (state.manualRoomPreview.status === "loading" || state.manualRoomPreview.status === "error")) return state;
  const key = manualRoomPreviewKey(state);
  const entry = state.resources.entry;
  if (!entry || !key || !state.selection.entryId) return { ...state, manualRoomPreview: { status: "idle", value: null, problem: null } };
  const rooms = state.resources.plans.value?.rooms ?? [];
  // New overrides merge over the ones the preview carries, so a test can add
  // a blocker to a scenario's due work.
  const carriedToken = state.manualRoomPreview.value?.preview.previewToken ?? GALLERY_PREVIEW_TOKEN;
  const carried = overridesByToken.get(carriedToken) ?? {};
  const applied: GalleryPreviewOverrides = overrides ? { ...carried, ...overrides } : carried;
  const preview: ManualRoomSequencePreview = {
    entryId: state.selection.entryId,
    floorToken: "f".repeat(64),
    // A re-application without new overrides keeps its token.
    previewToken: overrides ? tokenFor(applied) : carriedToken,
    rooms: state.selection.roomIds.flatMap((roomId) => {
      const settings = state.selection.roomSettings.find((room) => room.roomId === roomId);
      if (!settings) return [];
      const effective = state.selection.useRoomSchedule ? applied.effective?.[roomId] : undefined;
      return [{
        roomId,
        name: rooms.find((room) => room.roomId === roomId)?.name ?? roomId,
        cleaningMode: effective?.cleaningMode ?? settings.cleaningMode,
        coverageSetting: effective?.coverageSetting ?? settings.coverageSetting,
        cadenceReasons: applied.reasons?.[roomId] ?? [],
      }];
    }),
    missionBoundaries: applied.missionBoundaries ?? [],
    blocker: applied.blocker ?? null,
  };
  return {
    ...state,
    manualRoomPreview: {
      status: "ready",
      problem: null,
      value: {
        key,
        generation: state.generation,
        floorKey: entryFloorKey(entry),
        missionKey: entryMissionKey(entry),
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
  "history-floors",
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
  "plan-run-paused",
  "plan-run-blocked",
  "plan-run-parts",
  "plan-edit-ordered",
  "plan-new",
  "plan-dirty",
  "plan-cadence-shared",
  "plan-cadence-blocked",
  "plan-schedule-conflict",
  "plan-schedule-available",
  "plan-schedule-joining",
  "plan-legacy-oversized",
  "draw-points",
  "draw-saved",
  "draw-redraw",
  "area-review-new",
  "area-review-saved",
  "area-review-rebind",
  "area-review-stale",
  "support",
  "runs",
  "full-map",
  "full-map-cleaning",
  "full-map-locating",
  "starting",
  "starting-command",
  "stopping",
  "stopping-command",
  "task-in-progress",
  "map-unavailable",
  "map-limited",
  "room-limit",
  "rooms-ready",
  "rooms-busy",
  "rooms-failed",
  "rooms-empty",
  "home-plan-due",
  "home-plan-paused",
  "home-plan-blocked",
  "home-plan-due-full",
  "home-shortcuts",
  "home-unpinned",
  "home-shortcut-blocked",
  "home-shortcut-running",
  "home-pins-error",
  "areas-list",
  "areas-empty",
  "areas-stale",
  "plan-run-areas",
  "plan-run-areas-only",
  "plan-edit-areas",
  "plan-edit-areas-rotation",
  "plan-edit-area-stale",
  "areas-in-plans",
  "area-delete-refused",
  "home-shortcut-areas",
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
