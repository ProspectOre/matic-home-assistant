import type { WorkspaceState } from "./contracts";
import { initialWorkspaceState } from "./state";
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
      return { ...state, host: { ...state.host, robotCount: 2 } };
  }
};

export const GALLERY_SCENARIOS: readonly GalleryScenario[] = [
  "ready",
  "cleaning",
  "paused",
  "returning",
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
