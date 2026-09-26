import type { WorkspaceState } from "./contracts";
import { initialWorkspaceState, manualRoomPreviewKey } from "./state";
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
  | "multi-robot";

const verified = (): WorkspaceState => ({
  ...initialWorkspaceState(),
  coherence: "current",
  activity: "docked",
  batteryPercent: 92,
  robots: [{ entryId: "synthetic-entry", label: "Matic robot" }],
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
          { entryId: "synthetic-entry", label: "Matic robot" },
          { entryId: "synthetic-entry-two", label: "Second robot" },
        ],
      };
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
];
