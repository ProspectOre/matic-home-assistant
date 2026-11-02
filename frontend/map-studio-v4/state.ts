import { clamp } from "./shared-primitives";
import { normalizeCamera, liveCameraKey, cameraPreferences } from "./camera-preferences";
import { isMapTask, taskPresentation } from "./task-presentation";
import { needsDraftConfirmation } from "./draft-navigation";
import {
  DRAW_BRUSH_MAX_METERS,
  DRAW_BRUSH_MIN_METERS,
  MAP_ZOOM_MAX,
  MAP_ZOOM_MIN,
  MAX_ROOM_SEQUENCE_SIZE,
  MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE,
  type CoordinateEditCapture,
  type CoordinateEditTool,
  type CommandState,
  type MapView,
  type NoButtonAction,
  type PlanOrigin,
  type PrimaryAction,
  type ResourceStamp,
  type AdmittedManualRoomPreview,
  type PlanDraftArea,
  type WorkspaceIntent,
  type WorkspaceState,
} from "./contracts";
import type { AreaCircle, SavedPlan } from "./backend-contracts";
import { entryFloorKey, entryMissionKey } from "./backend-contracts";
import { notice, readWorkspaceNotice } from "./contracts";

/** Task geometry stays top-down; the live overview keeps its own presentation. */
export const forcesTop = (state: WorkspaceState | null): boolean =>
  !!state && isMapTask(state.workflow);
export const topView = (state: WorkspaceState): MapView => forcesTop(state) ? "top" : state.view;

const emptyResource = <T>(): { status: "idle"; value: T | null; problem: null } => ({
  status: "idle",
  value: null,
  problem: null,
});

const readOnlyWorkflows = new Set<WorkspaceState["workflow"]>([
  "rooms",
  "plan",
  "plans",
  "areas",
  "draw",
  "areaReview",
]);

export const isReadOnlyWorkspace = (state: WorkspaceState): boolean =>
  state.dataMode === "history" || state.floor.readOnly;

export const normalizeZoom = (value: number): number =>
  Math.round(clamp(Number.isFinite(value) ? value : MAP_ZOOM_MIN, MAP_ZOOM_MIN, MAP_ZOOM_MAX));

export const normalizeBrush = (value: number): number =>
  Math.round(
    clamp(
      Number.isFinite(value) ? value : DRAW_BRUSH_MIN_METERS,
      DRAW_BRUSH_MIN_METERS,
      DRAW_BRUSH_MAX_METERS,
    ) * 100,
  ) / 100;

export const initialWorkspaceState = (): WorkspaceState => ({
  lastRun: null,
  nextSchedule: null,
  smartStop: null,
  trail: null,
  runThumbnails: {},
  pageActive: true,
  optionalUiReady: false,
  queueControllerStatus: "idle",
  queueScopeRevision: 0,
  owner: null,
  draftFloorOrdinal: null,
  draftMapSessionKey: null,
  generation: 0,
  coherence: "verifying",
  dataMode: "live",
  activity: "unknown",
  workflow: "none",
  command: "idle",
  planWriteBlock: null,
  rechecking: false,
  queuePending: false,
  queueUncertainToken: null,
  fullMap: false,
  precisionOpen: false,
  dialog: null,
  cadenceResetRequest: null,
  scheduleDeleteRequest: null,
  narrowHint: false,
  view: "three",
  appearance: "photo",
  labelsVisible: true,
  wifiSignal: null,
  wifiScale: "absolute",
  floorTypes: null,
  followMode: "off",
  comparisonActive: false,
  homePresentation: null,
  roomCandidates: [],
  quality: "auto",
  cameras: {},
  cameraKey: null,
  taskCameras: {},
  taskCameraKey: null,
  historyCameras: {},
  managedLock: false,
  batteryPercent: null,
  deepMop: null,
  currentArea: null,
  robotRun: null,
  floor: {
    classifiedCount: 1,
    displayName: "Current floor",
    readOnly: false,
  },
  map: {
    available: false,
    complete: false,
    floorCoherent: false,
    sessionVerified: false,
    exactPose: false,
  },
  host: {
    connected: true,
    administrator: true,
    robotConnected: false,
    robotCount: 0,
  },
  draw: {
    zoomPercent: MAP_ZOOM_MIN,
    zoomOriginX: 50,
    zoomOriginY: 50,
    brushMeters: 0.6,
    tool: "paint",
    dirty: false,
    strokeCount: 0,
    circles: [],
    undo: [],
    redo: [],
  },
  resources: {
    catalog: emptyResource(),
    entry: null,
    scene: emptyResource(),
    pose: emptyResource(),
    history: emptyResource(),
    plans: emptyResource(),
    areas: emptyResource(),
    runs: emptyResource(),
  },
  manualRoomPreview: emptyResource(),
  manualRoomPreviewRetry: 0,
  selection: {
    entryId: null,
    entrySource: "host",
    floorId: "current",
    historyId: null,
    roomIds: [],
    roomSettings: [],
    useRoomSchedule: true,
    cleaningMode: "vacuum",
    coverageSetting: "standard",
    planId: null,
    areaId: null,
  },
  planDraft: {
    id: null,
    name: "",
    enabled: true,
    runBehavior: "intelligent",
    rooms: [],
    returnToBase: true,
    finishCurrentRoom: false,
    finishCurrentRoomThreshold: 50,
    occupancyAware: false,
    occupancySensors: {},
    dirty: false,
    parkedRooms: [],
    areas: [],
  },
  planView: "run",
  planOrigin: "plans",
  pendingAction: null,
  expandedRoom: null,
  areaDraft: {
    id: null,
    name: "",
    cleaningMode: "vacuum",
    coverageSetting: "standard",
    status: "new",
    canRebind: false,
    dirty: false,
  },
  homePins: { status: "idle", pins: [] },
  notice: null,
  robotLabel: "Robot",
  robots: [],
  locale: "en",
});

/** Saved plans load for their editor, room selector, or pinned home shortcuts. */
export const needsPlanCatalog = (state: WorkspaceState): boolean =>
  state.workflow === "plan" || state.workflow === "plans" || state.workflow === "rooms"
  || state.homePins.pins.some((pin) => pin.kind === "plan")
  || (state.activity === "cleaning" && state.optionalUiReady && state.resources.plans.status !== "error"
    && canReadFloorResources(state));

/** History loads only when the user opens History or selects a saved floor. */
export const needsHistoryCatalog = (state: WorkspaceState): boolean =>
  state.workflow === "history" || state.dataMode === "history"
  || state.selection.floorId !== "current";

/** Admit only known floors when no unsaved area drawing blocks navigation. */
export const floorSelectionAllowed = (state: WorkspaceState, floorId: string): boolean => {
  const history = state.resources.history.value;
  if (!history || !state.resources.entry) return false;
  if (floorId !== "current" && !history.floors.some((floor) => floor.id === floorId)) return false;
  return !((state.workflow === "draw" || state.workflow === "areaReview")
    && (state.draw.dirty || state.areaDraft.dirty));
};

/** Admit a known saved observation, or a valid return to the live floor. */
export const historySelectionAllowed = (state: WorkspaceState, snapshotId: string | null): boolean => {
  if (!snapshotId) return floorSelectionAllowed(state, "current");
  const floor = state.resources.history.value?.floors.find((candidate) =>
    candidate.snapshots.some((snapshot) => snapshot.id === snapshotId));
  return Boolean(floor && floorSelectionAllowed(state, floor.id));
};

/** Stable input identity; map pixel revisions do not invalidate a room preview. */
export const manualRoomPreviewKey = (state: WorkspaceState): string | null => {
  const entry = state.resources.entry;
  const entryId = state.selection.entryId;
  if (!entry || !entryId || entry.entryId !== entryId || state.selection.roomIds.length === 0
    || state.selection.roomIds.length > MAX_ROOM_SEQUENCE_SIZE) return null;
  const rooms = state.selection.roomIds.map((roomId) => {
    const settings = state.selection.roomSettings.find((room) => room.roomId === roomId);
    if (!settings) return null;
    return [roomId, settings.cleaningMode, settings.coverageSetting];
  });
  if (rooms.some((room) => room === null)) return null;
  return JSON.stringify([
    entryId,
    state.dataMode,
    state.selection.floorId,
    state.selection.historyId,
    state.draftFloorOrdinal,
    state.draftMapSessionKey,
    entry.selectedFloorOrdinal,
    entry.mapFloorOrdinal,
    entry.mapFloorCoherent,
    entry.mapSessionVerified,
    entry.mapSessionKey,
    state.selection.useRoomSchedule,
    rooms,
  ]);
};

/** The single admission check shared by motion, primary-action, and UI paths. */
export const admittedManualRoomPreview = (state: WorkspaceState): AdmittedManualRoomPreview | null => {
  const admitted = state.manualRoomPreview.status === "ready" ? state.manualRoomPreview.value : null;
  const entry = state.resources.entry;
  if (!admitted || !entry || admitted.key !== manualRoomPreviewKey(state)
    || admitted.generation !== state.generation
    || admitted.preview.entryId !== state.selection.entryId
    || admitted.floorKey !== entryFloorKey(entry)
    || admitted.missionKey !== entryMissionKey(entry)) return null;
  return admitted;
};

const updateDraw = (
  state: WorkspaceState,
  draw: Partial<WorkspaceState["draw"]>,
): WorkspaceState => ({
  ...state,
  draw: { ...state.draw, ...draw },
});

export const isLegacyPlanReduction = (
  state: WorkspaceState,
  rooms: WorkspaceState["planDraft"]["rooms"],
): boolean => {
  const savedPlan = state.resources.plans.value?.plans.find(
    (candidate) => candidate.id === state.planDraft.id,
  );
  if (!savedPlan
    || savedPlan.rooms.length <= MAX_ROOM_SEQUENCE_SIZE
    || savedPlan.rooms.length > MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE
    || rooms.length <= MAX_ROOM_SEQUENCE_SIZE
    || rooms.length >= savedPlan.rooms.length) return false;
  const savedRoomIds = new Set(savedPlan.rooms.map((room) => room.roomId));
  const draftRoomIds = new Set(rooms.map((room) => room.roomId));
  return draftRoomIds.size === rooms.length
    && [...draftRoomIds].every((roomId) => savedRoomIds.has(roomId));
};

export const draftForPlan = (plan: SavedPlan): WorkspaceState["planDraft"] => {
  let slot = 0;
  return {
    id: plan.id,
    name: plan.name,
    enabled: plan.enabled,
    runBehavior: plan.runBehavior,
    rooms: (plan.roomOrder.length
      ? plan.roomOrder.flatMap((roomId) => {
        const room = plan.rooms.find((candidate) => candidate.roomId === roomId);
        return room ? [room] : [];
      })
      : plan.rooms).map((room) => ({ ...room })),
    returnToBase: plan.returnToBase,
    finishCurrentRoom: plan.finishCurrentRoom,
    finishCurrentRoomThreshold: plan.finishCurrentRoomThreshold,
    occupancyAware: plan.occupancyAware,
    occupancySensors: plan.occupancySensors,
    dirty: false,
    parkedRooms: [],
    // The entries as sent: each custom area after the rooms before it. One
    // Matic Map can't read is left out, as the plan views leave it out.
    areas: (Array.isArray(plan.entries) ? plan.entries as (Record<string, unknown> | null)[] : []).flatMap((entry) => {
      if (entry?.kind !== "area") {
        slot += 1;
        return [];
      }
      const { area_id: areaId, name, cleaning_mode: cleaningMode, coverage_setting: coverageSetting } = entry;
      return typeof areaId === "string" && /^(vacuum|mop|vacuum_and_mop)$/u.test(String(cleaningMode))
        && /^(quick|standard|heavy_duty)$/u.test(String(coverageSetting))
        ? [{ areaId, name: typeof name === "string" && name ? name : areaId, cleaningMode, coverageSetting, slot } as PlanDraftArea]
        : [];
    }),
  };
};

/**
 * Opens a plan (plan.md §5 State): Create opens in Edit; another saved plan,
 * or entering the plan workflow, opens in Run. Reselecting the open plan, as a
 * reload after a write does, keeps the view, the open row and the origin.
 * The home plan card passes origin "home"; Back and Escape from Run return
 * there (home-rooms.md §5 Cards; plan.md §5 State).
 */
export const planSelection = (
  state: WorkspaceState,
  planId: string | null,
  preserveNotice: boolean,
  origin: PlanOrigin = "plans",
): Partial<WorkspaceState> => {
  const plan = state.resources.plans.value?.plans.find((candidate) => candidate.id === planId);
  const reselect = planId !== null && state.workflow === "plan" && state.selection.planId === planId;
  return {
    workflow: "plan",
    notice: !preserveNotice && state.notice?.tone === "success" ? null : state.notice,
    selection: { ...state.selection, planId },
    planDraft: plan ? draftForPlan(plan) : initialWorkspaceState().planDraft,
    planView: reselect ? state.planView : planId === null ? "edit" : "run",
    planOrigin: reselect ? state.planOrigin : origin,
    expandedRoom: reselect ? state.expandedRoom : null,
  };
};

// Discarding a saved plan's edits returns to its Run view; a new plan has
// none, so it returns to the picker (plan.md §5 Navigation).
const discardPlanDraft = (state: WorkspaceState): WorkspaceState => {
  const saved = state.resources.plans.value?.plans.find((plan) => plan.id === state.planDraft.id);
  return saved
    ? { ...state, planDraft: draftForPlan(saved), planView: "run", expandedRoom: null, dialog: null, precisionOpen: false }
    : {
      ...state,
      planDraft: initialWorkspaceState().planDraft,
      selection: { ...state.selection, planId: null },
      dialog: null,
      workflow: "plans",
      precisionOpen: false,
    };
};


export const reduceWorkspace = (
  state: WorkspaceState,
  intent: WorkspaceIntent,
): WorkspaceState => {
  switch (intent.type) {
    case "set-host":
      return {
        ...state,
        host: intent.host,
        fullMap: intent.host.administrator && intent.host.robotCount > 0
          ? state.fullMap
          : false,
      };
    case "set-operational-state":
      return {
        ...state,
        coherence: intent.coherence,
        activity: intent.activity,
        command: intent.command ?? state.command,
      };
    case "set-narrow-hint":
      return { ...state, narrowHint: intent.value };
    case "set-view":
      return forcesTop(state) ? state : { ...state, view: intent.view };
    case "set-appearance":
      return { ...state, appearance: intent.appearance };
    case "set-quality":
      return { ...state, quality: intent.quality };
    case "set-camera": {
      const camera = normalizeCamera(intent.camera);
      if (state.dataMode === "history") return {
        ...state,
        historyCameras: { ...state.historyCameras, [intent.view]: camera },
      };
      const cameraKey = liveCameraKey(state);
      if (!cameraKey) return state;
      if (isMapTask(state.workflow)) return {
        ...state,
        taskCameraKey: cameraKey,
        taskCameras: { ...cameraPreferences(state), [intent.view]: camera },
      };
      return {
        ...state,
        cameraKey,
        cameras: { ...cameraPreferences(state), [intent.view]: camera },
      };
    }
    case "toggle-labels":
      return { ...state, labelsVisible: !state.labelsVisible };
    case "toggle-wifi-signal":
      return { ...state, wifiSignal: state.wifiSignal ? null : { status: "loading", surveying: false, cellSize: 0, cells: [] } };
    case "set-wifi-scale":
      return { ...state, wifiScale: intent.scale === "relative" ? "relative" : "absolute" };
    case "set-follow-mode":
      if (intent.mode !== "off" && !canFollowRobot(state, intent.mode)) return state;
      return state.followMode === intent.mode ? state : {
        ...state,
        followMode: intent.mode,
        ...(intent.mode === "ride" ? { view: "three" as const } : {}),
      };
    case "show-room-candidates": {
      const rooms = [...(state.resources.plans.value?.rooms ?? []), ...(state.resources.areas.value?.rooms ?? [])];
      const ids = new Set(rooms.map((room) => room.roomId));
      return { ...state, roomCandidates: [...new Set(intent.roomIds)].filter((id) => ids.has(id)).slice(0, 100) };
    }
    case "set-room-daily-limit":
    case "refresh-history":
    case "invalidate-history":
    case "archive-access-denied":
    case "set-comparison-active":
      return state;
    case "toggle-floor-types":
      return { ...state, floorTypes: state.floorTypes ? null : { status: "loading", carpet: [], vent: [] } };
    case "open-workflow":
      if (isReadOnlyWorkspace(state) && readOnlyWorkflows.has(intent.workflow)) return state;
      return {
        ...state,
        workflow: intent.workflow,
        notice: state.notice?.tone === "success" ? null : state.notice,
        precisionOpen: false,
      };
    case "enter-full-map":
      return state.host.administrator
        && state.host.robotCount > 0
        && state.map.available
        ? { ...state, fullMap: true, precisionOpen: false }
        : state;
    case "exit-full-map":
      return { ...state, fullMap: false, precisionOpen: false };
    case "set-precision-open":
      return { ...state, precisionOpen: intent.value };
    case "set-zoom":
      return updateDraw(state, {
        zoomPercent: normalizeZoom(intent.value),
        ...(intent.originX === undefined
          ? {}
          : { zoomOriginX: clamp(intent.originX, 0, 100) }),
        ...(intent.originY === undefined
          ? {}
          : { zoomOriginY: clamp(intent.originY, 0, 100) }),
      });
    case "step-zoom":
      return updateDraw(state, {
        zoomPercent: normalizeZoom(state.draw.zoomPercent * intent.factor),
      });
    case "fit-map":
      return updateDraw(state, {
        zoomPercent: MAP_ZOOM_MIN,
        zoomOriginX: 50,
        zoomOriginY: 50,
      });
    case "set-brush":
      return updateDraw(state, { brushMeters: normalizeBrush(intent.value) });
    case "set-draw-tool":
      return updateDraw(state, { tool: intent.tool });
    case "mark-draft": {
      const strokeCount = Math.max(0, state.draw.strokeCount + intent.strokeDelta);
      return updateDraw(state, { dirty: strokeCount > 0, strokeCount });
    }
    case "undo-draft": {
      const previous = state.draw.undo.at(-1);
      if (!previous) return state;
      return updateDraw(state, {
        circles: previous,
        outline: state.draw.outlineUndo?.at(-1) ?? null,
        outlineUndo: state.draw.outlineUndo?.slice(0, -1) ?? [],
        outlineRedo: [...(state.draw.outlineRedo ?? []), state.draw.outline ?? null],
        undo: state.draw.undo.slice(0, -1),
        redo: [...state.draw.redo, state.draw.circles],
        dirty: true,
        strokeCount: Math.max(0, state.draw.strokeCount - 1),
      });
    }
    case "clear-draft":
      if (!state.draw.circles.length && !state.draw.outline?.points.length) return state;
      return updateDraw(state, {
        circles: [],
        outline: null,
        outlineUndo: [...(state.draw.outlineUndo ?? []).slice(-99), state.draw.outline ?? null],
        outlineRedo: [],
        undo: [...state.draw.undo.slice(-99), state.draw.circles],
        redo: [],
        dirty: true,
        strokeCount: state.draw.strokeCount + 1,
      });
    case "redo-draft": {
      const next = state.draw.redo.at(-1);
      if (!next) return state;
      return updateDraw(state, {
        circles: next,
        outline: state.draw.outlineRedo?.at(-1) ?? null,
        outlineUndo: [...(state.draw.outlineUndo ?? []), state.draw.outline ?? null],
        outlineRedo: state.draw.outlineRedo?.slice(0, -1) ?? [],
        undo: [...state.draw.undo, state.draw.circles],
        redo: state.draw.redo.slice(0, -1),
        dirty: true,
        strokeCount: state.draw.strokeCount + 1,
      });
    }
    case "set-draft-circles": {
      if (!hasCoordinateEditAdmission(state, intent.coordinateEdit)) return state;
      const circles: readonly AreaCircle[] = intent.circles.slice(0, 512).map((circle) => ({ ...circle }));
      return updateDraw(state, {
        circles,
        outline: intent.outline ?? null,
        outlineUndo: [...(state.draw.outlineUndo ?? []).slice(-99), state.draw.outline ?? null],
        outlineRedo: [],
        undo: [...state.draw.undo.slice(-99), state.draw.circles],
        redo: [],
        dirty: true,
        strokeCount: state.draw.strokeCount + 1,
      });
    }
    case "discard-draft":
      if (state.workflow === "plan") return discardPlanDraft(state);
      // A redraw's discard keeps the saved area and returns to its screen.
      if (state.workflow === "draw" && state.areaDraft.id !== null) {
        return { ...state, ...areaSelection(state, state.areaDraft.id), dialog: null, workflow: "areaReview", precisionOpen: false };
      }
      return {
        ...updateDraw(state, {
          dirty: false,
          strokeCount: 0,
          circles: [],
          outline: null, outlineUndo: [], outlineRedo: [],
          undo: [],
          redo: [],
        }),
        areaDraft: initialWorkspaceState().areaDraft,
        selection: { ...state.selection, areaId: null },
        dialog: null,
        // A discarded area draft returns to the saved areas (owner, 2026-10-13).
        workflow: "areas",
        precisionOpen: false,
      };
    case "toggle-room": {
      if (state.workflow === "plan") {
        // Map taps never change the plan in Run (plan.md §5 Map).
        if (state.planView === "run") return state;
        const { rooms, parkedRooms, areas } = state.planDraft;
        const room = rooms.find((candidate) => candidate.roomId === intent.roomId);
        if (!room && rooms.length >= MAX_ROOM_SEQUENCE_SIZE) return state;
        // An unticked room keeps its settings and schedule until Save, so
        // ticking it again restores them.
        const parked = parkedRooms.find((candidate) => candidate.roomId === intent.roomId);
        const others = (list: typeof rooms) => list.filter((candidate) => candidate.roomId !== intent.roomId);
        return {
          ...state,
          planDraft: {
            ...state.planDraft,
            dirty: true,
            rooms: room
              ? others(rooms)
              : [...rooms, parked ?? { roomId: intent.roomId, cleaningMode: "vacuum", coverageSetting: "standard" }],
            parkedRooms: room ? [...others(parkedRooms), room] : others(parkedRooms),
            // The custom areas after a removed room keep their place in the run.
            areas: room ? areas.map((area) => area.slot > rooms.indexOf(room) ? { ...area, slot: area.slot - 1 } : area) : areas,
          },
        };
      }
      if (state.workflow === "rooms" && !canSelectRooms(state)) return state;
      const selected = state.selection.roomIds.includes(intent.roomId);
      // A refused add says why in the slot; the list's rows are described by
      // the same line (home-rooms.md §4 R5).
      if (!selected && state.selection.roomIds.length >= MAX_ROOM_SEQUENCE_SIZE) {
        return state.workflow === "rooms"
          ? {
            ...state,
            notice: notice("info", "v4_room_limit_reached", "Up to {limit} rooms fit in one clean, so remove one to add another.", { limit: MAX_ROOM_SEQUENCE_SIZE }),
          }
          : state;
      }
      // A new room takes the whole-clean setting (home-rooms.md §5 Settings).
      return {
        ...state,
        selection: {
          ...state.selection,
          roomIds: selected
            ? state.selection.roomIds.filter((roomId) => roomId !== intent.roomId)
            : [...state.selection.roomIds, intent.roomId],
          roomSettings: selected
            ? state.selection.roomSettings.filter((room) => room.roomId !== intent.roomId)
            : [
              ...state.selection.roomSettings,
              {
                roomId: intent.roomId,
                cleaningMode: state.selection.cleaningMode,
                coverageSetting: state.selection.coverageSetting,
              },
            ],
        },
      };
    }
    // The rooms selection is locked while a clean runs or the map is not
    // ready: every change to it is refused, and Clear keeps the whole-clean
    // default (home-rooms.md §5 Selection gate).
    case "clear-selection":
      if (state.workflow !== "rooms" || !canSelectRooms(state)
        || (state.selection.roomIds.length === 0 && state.selection.roomSettings.length === 0)) {
        return state;
      }
      return {
        ...state,
        selection: {
          ...state.selection,
          roomIds: [],
          roomSettings: [],
        },
        manualRoomPreview: emptyResource<AdmittedManualRoomPreview>(),
      };
    case "patch-room-settings":
      if (state.workflow === "rooms" && !canSelectRooms(state)) return state;
      return {
        ...state,
        selection: {
          ...state.selection,
          roomSettings: state.selection.roomSettings.map((room) =>
            room.roomId === intent.roomId
              ? {
                ...room,
                ...(intent.cleaningMode ? { cleaningMode: intent.cleaningMode } : {}),
                ...(intent.coverageSetting ? { coverageSetting: intent.coverageSetting } : {}),
              }
              : room),
        },
      };
    case "set-clean-settings": {
      if (state.workflow !== "rooms" || !canSelectRooms(state)) return state;
      const cleaningMode = intent.cleaningMode ?? state.selection.cleaningMode;
      const coverageSetting = intent.coverageSetting ?? state.selection.coverageSetting;
      return {
        ...state,
        selection: {
          ...state.selection,
          cleaningMode,
          coverageSetting,
          roomSettings: state.selection.roomSettings.map((room) => ({ ...room, cleaningMode, coverageSetting })),
        },
      };
    }
    case "set-use-room-schedule":
      if (state.workflow === "rooms" && !canSelectRooms(state)) return state;
      return {
        ...state,
        selection: { ...state.selection, useRoomSchedule: intent.value },
      };
    case "retry-room-preview":
      return { ...state, manualRoomPreviewRetry: state.manualRoomPreviewRetry + 1 };
    case "request-room-cadence-reset":
      if (state.planDraft.id !== intent.planId || state.planDraft.dirty) return state;
      return {
        ...state,
        dialog: "confirmResetCadence",
        cadenceResetRequest: { planId: intent.planId, roomId: intent.roomId, mode: intent.mode },
      };
    case "request-schedule-delete": {
      const catalog = state.resources.plans.value;
      const consumers = catalog?.plans.filter((plan) =>
        plan.rooms.some((room) => room.roomId === intent.roomId && room.cadence?.scope === "shared")) ?? [];
      const request = {
        planId: intent.planId, roomId: intent.roomId, expectedToken: intent.expectedToken,
        roomName: catalog?.rooms.find((room) => room.roomId === intent.roomId)?.name ?? "",
        planNames: consumers.map((plan) => plan.name),
      };
      if (!sharedCadenceDeleteRequestIsCurrent(state, request)) return state;
      return { ...state, dialog: "confirmDeleteSchedule", scheduleDeleteRequest: request };
    }
    case "set-floor":
      return {
        ...state,
        dataMode: intent.floorId === "current" ? "live" : "history",
        selection: {
          ...state.selection,
          floorId: intent.floorId,
          historyId: null,
        },
      };
    case "select-entry":
      return (state.selection.entryId === intent.entryId && state.selection.entrySource === "user")
        || !state.robots.some((robot) => robot.entryId === intent.entryId)
        ? state
        : { ...state, wifiSignal: null, floorTypes: null, selection: { ...state.selection, entryId: intent.entryId, entrySource: "user" } };
    case "set-history":
      return {
        ...state,
        dataMode: intent.historyId ? "history" : "live",
        selection: { ...state.selection, historyId: intent.historyId },
      };
    case "select-plan":
      return { ...state, ...planSelection(state, intent.planId, false, intent.origin ?? "plans") };
    case "set-plan-view":
      if (state.workflow !== "plan") return state;
      if (intent.view === "edit") return {
        ...state,
        planView: "edit",
        expandedRoom: intent.roomId === undefined ? state.expandedRoom : intent.roomId,
      };
      // Run never shows a dirty or unsaved draft: Save or discard first.
      return state.planDraft.id !== null && !state.planDraft.dirty
        ? { ...state, planView: "run", expandedRoom: null }
        : state;
    case "set-plan-enabled":
      // Reflects the Run switch; the effect owns the request.
      return state.workflow === "plan" && state.planView === "run"
        && state.planDraft.id !== null && !state.planDraft.dirty
        ? { ...state, planDraft: { ...state.planDraft, enabled: intent.enabled, dirty: false } }
        : state;
    case "select-area":
      return {
        ...state,
        selection: { ...state.selection, areaId: intent.areaId },
        workflow: intent.workflow === "areaReview" ? "areaReview" : state.workflow,
      };
    case "patch-plan-draft":
      if (state.planWriteBlock) return state;
      if (intent.patch.rooms && intent.patch.rooms.length > MAX_ROOM_SEQUENCE_SIZE
        && !isLegacyPlanReduction(state, intent.patch.rooms)) return state;
      return {
        ...state,
        planDraft: {
          ...state.planDraft,
          ...intent.patch,
          dirty: intent.patch.dirty ?? true,
        },
      };
    case "patch-area-draft":
      return {
        ...state,
        areaDraft: {
          ...state.areaDraft,
          ...intent.patch,
          dirty: intent.patch.dirty ?? true,
        },
      };
    case "set-notice":
      // Validated where every notice is committed (WorkspaceStore.replace).
      return { ...state, notice: intent.notice };
    case "open-dialog":
      return { ...state, dialog: intent.dialog };
    case "dismiss-top-layer":
      if (state.dialog === "confirmResetCadence" || state.dialog === "confirmDeleteSchedule") {
        return { ...state, dialog: null, cadenceResetRequest: null, scheduleDeleteRequest: null };
      }
      if (needsDraftConfirmation(state, intent)) return { ...state, dialog: "discardDraft" };
      if (state.dialog) return { ...state, dialog: null };
      if (state.precisionOpen) return { ...state, precisionOpen: false };
      if (state.fullMap) return { ...state, fullMap: false };
      // A saved plan's Edit steps back to its Run view; Run and a new plan's
      // Edit step back to where the plan was opened from: the picker, or home
      // for the home plan card (home-rooms.md §5 Cards).
      if (state.workflow === "plan" && state.planView === "edit" && state.planDraft.id !== null) {
        return { ...state, planView: "run", expandedRoom: null };
      }
      // A custom area steps back as a plan does: a redraw to its screen, a
      // new drawing and an area's screen to Your areas, Your areas to home.
      if (state.workflow !== "none") {
        return {
          ...state,
          workflow: state.workflow === "plan" && state.planOrigin !== "home" ? "plans"
            : state.workflow === "draw" ? state.areaDraft.id === null ? "areas" : "areaReview"
              : state.workflow === "areaReview" ? "areas" : "none",
          precisionOpen: false,
        };
      }
      return state;
    case "set-home-pin": {
      // Shown at once; the effects write it and put it back if the write fails.
      if (state.homePins.status !== "ready") return state;
      const { kind, id } = intent.pin;
      if (state.homePins.pins.some((pin) => pin.kind === kind && pin.id === id) === intent.pinned) return state;
      const pins = state.homePins.pins.filter((pin) => pin.kind !== kind || pin.id !== id);
      return { ...state, homePins: { ...state.homePins, pins: intent.pinned ? [...pins, { kind, id }] : pins } };
    }
    case "return-live":
      return {
        ...state,
        dataMode: "live",
        workflow: "none",
        floor: { ...state.floor, readOnly: false },
      };
    default:
      // DOM events can come from outside the typed component graph.
      return state;
  }
};

/**
 * What a delete dialog names and changes (shell.md §5): the saved item, and,
 * when it is the default plan or the selected custom area, the one the backend
 * promotes in its place: the first remaining in saved order, or null for none
 * (plans.py:2623-2624, 2159-2160). Undefined while the catalog does not hold it.
 */
export interface DeleteSubject {
  readonly name: string;
  readonly successor?: string | null;
}

export const deleteSubject = (
  state: WorkspaceState,
  dialog: WorkspaceState["dialog"] = state.dialog,
): DeleteSubject | undefined => {
  const plans = state.resources.plans.value;
  const areas = state.resources.areas.value;
  const catalog = dialog === "confirmDeletePlan"
    ? { items: plans?.plans, id: state.planDraft.id, selected: plans?.selectedPlan }
    : dialog === "confirmDeleteArea"
      ? { items: areas?.areas, id: state.areaDraft.id, selected: areas?.selectedArea }
      : null;
  const items: readonly { readonly id: string; readonly name: string }[] = catalog?.items ?? [];
  const item = items.find((candidate) => candidate.id === catalog?.id);
  return item && (item.id === catalog?.selected
    ? { name: item.name, successor: items.find((candidate) => candidate !== item)?.name ?? null }
    : { name: item.name });
};

/** The server token binds the policy and complete consumer plans, including names. */
export const sharedCadenceDeleteRequestIsCurrent = (
  state: WorkspaceState,
  request: NonNullable<WorkspaceState["scheduleDeleteRequest"]>,
): boolean => {
  const catalog = state.resources.plans.value;
  const catalogRoom = catalog?.rooms.find((room) => room.roomId === request.roomId);
  const savedRoom = catalog?.plans.find((plan) => plan.id === request.planId)?.rooms.some((room) => room.roomId === request.roomId);
  return Boolean(
    state.workflow === "plan" && state.planView === "edit"
    && state.selection.planId === request.planId && state.planDraft.id === request.planId
    && !state.planDraft.dirty && state.dataMode === "live" && state.command === "idle"
    && !state.managedLock && (state.activity === "idle" || state.activity === "docked")
    && catalogRoom?.sharedDeleteToken === request.expectedToken && /^[0-9a-f]{64}$/u.test(request.expectedToken)
    && savedRoom && state.planDraft.rooms.some((room) => room.roomId === request.roomId)
    && request.roomName === catalogRoom.name
    && request.roomName.trim().length
  );
};

// Selecting a saved area loads its draft and saved geometry; null starts a
// fresh one. Pure, so the review gallery can play it without the effects.
export const areaSelection = (state: WorkspaceState, areaId: string | null): Pick<WorkspaceState, "selection" | "areaDraft" | "draw"> => {
  const area = state.resources.areas.value?.areas.find((candidate) => candidate.id === areaId);
  return {
    selection: { ...state.selection, areaId },
    areaDraft: area
      ? { id: area.id, name: area.name, cleaningMode: area.cleaningMode, coverageSetting: area.coverageSetting, status: area.status, canRebind: area.canRebind, dirty: false }
      : initialWorkspaceState().areaDraft,
    draw: {
      ...state.draw,
      circles: area?.circles || [],
      outline: area?.outline ?? null,
      outlineUndo: [], outlineRedo: [],
      tool: !area || area.outline ? "outline" : "paint",
      undo: [],
      redo: [],
      dirty: false,
      strokeCount: 0,
    },
  };
};

export class WorkspaceStore {
  readonly #listeners = new Set<(state: WorkspaceState) => void>();
  #state: WorkspaceState;

  constructor(initialState: WorkspaceState = initialWorkspaceState()) {
    this.#state = initialState;
  }

  get value(): WorkspaceState {
    return this.#state;
  }

  dispatch(intent: WorkspaceIntent): WorkspaceState {
    return this.replace(reduceWorkspace(this.#state, intent));
  }

  // The one place a notice is validated. Every notice committed in place of
  // another is its own frozen object, so a repeated notice toasts and
  // announces again (shell.md §4 rule 1); an invalid one is ignored and the
  // current notice stays. A delete dialog stands only while the catalog holds
  // the saved item it names (copy-style-0.5.md:90, 96). A reload, failed or
  // not, keeps the last catalog (effects.ts loadPlans, loadAreas), so only a
  // ready read without the item, or a reset that empties the catalog, closes
  // it; a dialog left with nothing to name would block the workspace unseen.
  // Every way out of the plan workflow, an effect's included, resets its view
  // to Run with no open row (plan.md §5 State). A pending action names only a
  // pending command, so every way a command settles or is cancelled clears it.
  replace(next: WorkspaceState): WorkspaceState {
    if (next === this.#state) return next;
    const settled = next.pendingAction && next.command !== "pending" ? { ...next, pendingAction: null } : next;
    const left = settled.workflow !== "plan"
      && (settled.planView !== "run" || settled.expandedRoom !== null || settled.planOrigin !== "plans")
      ? { ...settled, planView: "run" as const, planOrigin: "plans" as const, expandedRoom: null }
      : settled;
    const noticed = left.notice && left.notice !== this.#state.notice
      ? { ...left, notice: readWorkspaceNotice(left.notice) ?? this.#state.notice }
      : left;
    const missingSubject = noticed.dialog === "confirmDeleteSchedule"
      ? !noticed.scheduleDeleteRequest || !sharedCadenceDeleteRequestIsCurrent(noticed, noticed.scheduleDeleteRequest)
      : noticed.dialog?.startsWith("confirmDelete") && !deleteSubject(noticed);
    const presented = taskPresentation(this.#state, missingSubject ? { ...noticed, dialog: null, scheduleDeleteRequest: null } : noticed);
    const committed = presented.followMode !== "off" && !canFollowRobot(presented, presented.followMode)
      ? { ...presented, followMode: "off" as const } : presented;
    this.#state = committed;
    this.#publish();
    return committed;
  }

  #publish(): void {
    const state = this.#state;
    for (const listener of this.#listeners) {
      listener(state);
      // A listener may commit a new state reentrantly. Its nested publication
      // already reached every subscriber, so do not deliver this stale snapshot
      // to the remaining subscribers.
      if (state !== this.#state) return;
    }
  }

  patch(patch: Partial<WorkspaceState>): WorkspaceState {
    return this.replace({ ...this.#state, ...patch });
  }

  subscribe(listener: (state: WorkspaceState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }
}

export class CoherenceMachine {
  #stamp: ResourceStamp | null = null;
  #generation: number;

  constructor(initialGeneration = 0) {
    this.#generation = Number.isSafeInteger(initialGeneration) && initialGeneration >= 0
      ? initialGeneration
      : 0;
  }

  get generation(): number {
    return this.#generation;
  }

  begin(
    entryKey: string,
    floorKey: string,
    missionKey: string,
    revision: number,
  ): ResourceStamp {
    this.#generation += 1;
    this.#stamp = {
      entryKey,
      generation: this.#generation,
      floorKey,
      missionKey,
      revision,
    };
    return this.#stamp;
  }

  current(): ResourceStamp | null {
    return this.#stamp;
  }

  accepts(candidate: ResourceStamp): boolean {
    const current = this.#stamp;
    return Boolean(
      current
      && candidate.entryKey === current.entryKey
      && candidate.generation === current.generation
      && candidate.floorKey === current.floorKey
      && candidate.missionKey === current.missionKey
      && candidate.revision === current.revision,
    );
  }

  advance(candidate: ResourceStamp, revision: number): ResourceStamp | null {
    if (!this.accepts(candidate)
      || !Number.isSafeInteger(revision)
      || revision <= candidate.revision) return null;
    this.#stamp = { ...candidate, revision };
    return this.#stamp;
  }

  invalidate(): number {
    this.#generation += 1;
    this.#stamp = null;
    return this.#generation;
  }
}

export const canShowLiveMap = (state: WorkspaceState): boolean =>
  state.dataMode === "live"
  && state.map.available
  && (state.coherence === "current" || state.coherence === "degraded" || state.coherence === "verifying")
  && state.host.administrator;

export const isSelectedRobotUnavailable = (state: WorkspaceState): boolean =>
  state.selection.entryId !== null && state.robots.length > 0
  && !state.robots.some((robot) => robot.entryId === state.selection.entryId);

export const canShowExactPose = (state: WorkspaceState): boolean =>
  canShowLiveMap(state)
  && !state.floor.readOnly
  // A degraded map stream can still have an independently verified floor,
  // session, and exact pose. Keep that marker only on a verified live scene;
  // a read-only snapshot must wait for its replacement even if pose arrives
  // first. Coordinate editing and motion require fully current coherence.
  && (state.coherence === "current" || state.coherence === "degraded")
  && state.map.floorCoherent
  && state.map.sessionVerified
  && state.map.exactPose
  && state.host.connected
  && state.host.robotConnected;

export const canFollowRobot = (state: WorkspaceState, mode: "follow" | "ride"): boolean => {
  const pose = state.resources.pose.value;
  return state.pageActive && !forcesTop(state) && canShowExactPose(state)
    && state.resources.scene.value?.source === "live" && pose?.freshness === "live"
    && pose.position !== null && pose.floorCoherent && pose.mapSessionKey !== null
    && pose.mapSessionKey === state.resources.entry?.mapSessionKey
    && (mode !== "ride" || (typeof pose.heading === "number" && Number.isFinite(pose.heading)));
};

/** Robot-wide settings do not depend on the selected map or floor. */
export const canChangeRobotSetting = (state: WorkspaceState): boolean =>
  state.pageActive && state.host.administrator && state.host.connected
  && state.host.robotConnected && state.command === "idle"
  && state.deepMop != null && state.deepMop.enabled !== null
  && !state.managedLock && !hasStoppableWork(state);

export const canEditCoordinates = (state: WorkspaceState): boolean =>
  !state.planWriteBlock && state.map.complete && canReadFloorResources(state);

const coordinateEditAllowed = (state: WorkspaceState, tool: CoordinateEditTool): boolean =>
  state.workflow === "draw"
  && state.draw.tool === tool
  && state.dialog === null
  && (state.command === "idle" || state.command === "failed")
  && canEditCoordinates(state);

export const captureCoordinateEdit = (
  state: WorkspaceState,
  tool: CoordinateEditTool,
): CoordinateEditCapture | null => coordinateEditAllowed(state, tool)
  ? {
    generation: state.generation,
    tool,
    baselineCircles: state.draw.circles,
    baselineOutline: state.draw.outline ?? null,
  }
  : null;

export const hasCoordinateEditAdmission = (
  state: WorkspaceState,
  capture: CoordinateEditCapture | null,
): capture is CoordinateEditCapture => capture !== null
  && state.generation === capture.generation
  && state.draw.circles === capture.baselineCircles
  && (state.draw.outline ?? null) === capture.baselineOutline
  && coordinateEditAllowed(state, capture.tool);

/**
 * Floor-scoped metadata is safe to fetch before the rendered scene is fully
 * complete. Keep this read capability separate from coordinate edits and
 * motion, which continue to require canEditCoordinates/canStartMotion.
 */
export const canReadFloorResources = (state: WorkspaceState): boolean =>
  state.pageActive && canShowLiveMap(state)
  && state.coherence === "current"
  && state.map.floorCoherent
  && state.map.sessionVerified
  && state.host.connected
  && state.host.robotConnected
  && !state.floor.readOnly;

export const canStartMotion = (state: WorkspaceState): boolean =>
  canEditCoordinates(state)
  && !state.managedLock
  && state.command === "idle"
  && (state.activity === "idle" || state.activity === "docked");

type Reason = { readonly reason: string; readonly reasonKey: string };

// While a command runs, the edits that would race it are held and say why
// (shell.md §5); choosing a tool stays open, since painting is refused anyway.
export const heldReasonKey = (state: WorkspaceState): Reason | null =>
  state.command === "pending" || state.planWriteBlock ? { reason: "Waiting for the current change to finish.", reasonKey: "v4_reason_stop_busy" }
    : state.command === "starting" ? { reason: "Waiting for the robot to begin.", reasonKey: "v4_reason_starting" }
      : state.command === "settling" ? { reason: "Waiting for the robot to stop.", reasonKey: "v4_reason_stop" }
        : null;

export const canResumeMotion = (state: WorkspaceState): boolean =>
  canEditCoordinates(state)
  && state.command === "idle"
  && state.activity === "paused"
  && state.resources.entry?.stopSettlePending !== true;

export const disabledAction = (
  id: string,
  label: string,
  reason: string,
  labelKey: string,
  reasonKey: string,
): PrimaryAction => ({
  id,
  label,
  labelKey,
  kind: "neutral",
  enabled: false,
  reason,
  reasonKey,
});

export const noButton = (id: string): NoButtonAction => ({ id, enabled: false });

export const hasStoppableWork = (state: WorkspaceState): boolean =>
  state.command === "starting"
  || state.smartStop !== null
  || state.activity === "cleaning" || state.activity === "paused"
  || state.activity === "returning" || state.activity === "recharging"
  || (state.resources.entry?.entryId === state.selection.entryId
    && (state.resources.entry?.runnerLocked === true
      || state.resources.entry?.activePlan === true
      || state.resources.entry?.nativeSessionActive === true));

/** Rooms can be picked only on an editable map with no robot work to stop (home-rooms.md §5). */
export const canSelectRooms = (state: WorkspaceState): boolean => canEditCoordinates(state) && !hasStoppableWork(state);

export const canStopMotion = (state: WorkspaceState): boolean =>
  state.pageActive && state.host.connected && state.host.administrator && state.host.robotConnected
  && (state.command === "idle" || state.command === "failed" || state.command === "starting")
  && hasStoppableWork(state);

const stopAction = (state: WorkspaceState): PrimaryAction => {
  const immediate = state.smartStop !== null;
  const checking = state.smartStop?.phase === "verifying_completion";
  const returning = state.smartStop?.phase === "returning_to_dock";
  const enabled = canStopMotion(state) && !checking && !returning;
  return {
    ...(immediate
      ? { id: "stop-now", label: "Stop now & dock", labelKey: "v4_action_stop_now_dock" }
      : { id: "stop", label: "Stop", labelKey: "v4_action_stop" }),
    kind: "danger",
    enabled,
    ...(enabled ? {} : checking
      ? { reason: "Checking the result before docking.", reasonKey: "v4_smart_stop_checking_reason" }
      : returning
        ? { reason: "Smart Stop is returning to the dock.", reasonKey: "v4_smart_stop_returning_detail" }
        : { reason: "Waiting for the robot to stop.", reasonKey: "v4_reason_stop" }),
  };
};

/** Motion, account and map decisions stay available without the workflow UI chunk. */
export const selectGlobalPrimaryAction = (state: WorkspaceState): PrimaryAction | NoButtonAction | null => {
  if (state.dataMode === "history") {
    return {
      id: "return-live",
      label: "Show live map",
      labelKey: "v4_action_return_live",
      kind: "primary",
      enabled: true,
    };
  }
  if (state.floor.readOnly && readOnlyWorkflows.has(state.workflow)) {
    return disabledAction(
      "read-only",
      "Live map required",
      "Can't edit until you show the live map.",
      "v4_action_live_map_required",
      "v4_reason_live_map_required",
    );
  }
  if (state.activity !== "paused" && hasStoppableWork(state)) {
    return stopAction(state);
  }
  const editingDraft = (state.workflow === "plan" && state.planDraft.dirty)
    || ((state.workflow === "draw" || state.workflow === "areaReview")
      && (state.draw.dirty || state.areaDraft.dirty));
  if (state.command === "failed" && !editingDraft) {
    return {
      id: "recheck-status",
      label: "Check robot status",
      labelKey: "v4_recheck_robot",
      kind: "primary",
      enabled: state.host.connected && state.host.administrator && state.host.robotConnected,
      reason: "Refresh the robot state before trying the action again.",
      reasonKey: "v4_recheck_robot_reason",
    };
  }
  if (state.activity === "stopping" || state.command === "settling") {
    return noButton("stopping");
  }
  if (state.command === "starting") {
    return disabledAction("starting", "Starting", "Waiting for the robot to begin.", "v4_action_starting", "v4_reason_starting");
  }
  if (state.activity === "paused") {
    return {
      id: "resume",
      label: "Resume cleaning",
      labelKey: "v4_action_resume",
      kind: "primary",
      enabled: canResumeMotion(state),
    };
  }
  if (!state.host.connected) {
    return noButton("reconnecting");
  }
  if (!state.host.administrator) {
    return noButton("administrator");
  }
  if (state.host.robotCount === 0) {
    // The one primary that is a link: it opens the integration page, so the
    // view renders an anchor and never dispatches it (home-rooms.md D2).
    return {
      id: "setup",
      label: "Open integration",
      labelKey: "v4_open_integration",
      kind: "link",
      href: "/config/integrations/integration/matic_robot",
      enabled: true,
    };
  }
  if (isSelectedRobotUnavailable(state)) {
    return noButton("choose-robot");
  }
  if (state.activity === "problem") {
    return noButton("problem");
  }
  if (!state.host.robotConnected) {
    return noButton("robot-offline");
  }
  if (state.coherence === "unavailable" || state.coherence === "blocked") {
    return noButton("map-unavailable");
  }
  if (state.coherence !== "current") {
    return noButton("locating");
  }
  if (state.workflow === "none") return noButton("choose-cleaning");
  return null;
};

/** The saved map on show: its time and place among the floor's snapshots (map-surfaces.md §4). */
export const savedMapPosition = (state: WorkspaceState): { readonly date: string; readonly position: number; readonly count: number } | null => {
  if (state.dataMode !== "history") return null;
  const snapshots = state.resources.history.value?.floors.find((floor) => floor.id === state.selection.floorId)?.snapshots ?? [];
  const index = snapshots.findIndex((snapshot) => snapshot.id === state.selection.historyId);
  return index < 0 ? null : { date: snapshots[index]!.createdAt, position: index + 1, count: snapshots.length };
};

export const selectStopSecondaryAction = (
  state: WorkspaceState,
): PrimaryAction | null => hasStoppableWork(state)
  && !["stop", "stop-now"].includes(selectGlobalPrimaryAction(state)?.id ?? "")
  ? stopAction(state) : null;

/** Go to room sits beside Clean when one room is picked and the robot can move. */
export const selectGoToRoomAction = (state: WorkspaceState): PrimaryAction | null =>
  state.workflow === "rooms" && state.dataMode === "live" && !state.floor.readOnly
  && state.selection.roomIds.length === 1 && canStartMotion(state)
    ? { id: "go-to-room", label: "Go to room", labelKey: "v4_action_go_to_room", kind: "neutral", enabled: true }
    : null;

const SCALE_OPTIONS_METERS = [2, 1, 0.5, 0.25, 0.1, 0.05] as const;

export const mapScale = (
  pixelsPerMeter: number,
): { readonly meters: number; readonly pixels: number; readonly label: string } | null => {
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) return null;
  const meters = SCALE_OPTIONS_METERS.reduce((best, candidate) => {
    const distance = Math.abs(candidate * pixelsPerMeter - 64);
    const bestDistance = Math.abs(best * pixelsPerMeter - 64);
    return distance < bestDistance ? candidate : best;
  });
  return {
    meters,
    pixels: meters * pixelsPerMeter,
    label: meters < 1 ? `${Math.round(meters * 100)} cm` : `${meters} m`,
  };
};

export const commandState = (
  state: WorkspaceState,
  command: CommandState,
): WorkspaceState => ({ ...state, command });
