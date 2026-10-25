import { clamp } from "./numeric";
import { normalizeCamera, liveCameraKey, cameraPreferences } from "./camera-preferences";
import { needsDraftConfirmation } from "./draft-navigation";
import {
  DRAW_BRUSH_MAX_METERS,
  DRAW_BRUSH_MIN_METERS,
  MAP_PIXELS_PER_METER_AT_100,
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
import type { AreaCircle, CadenceReason, NextRunPreviewBlocker, SavedPlan } from "./backend-contracts";
import { entryFloorKey, entryMissionKey } from "./backend-contracts";
import { notice, readWorkspaceNotice } from "./contracts";

/** Draw and the area review look straight down; every other workflow keeps the user's view. */
export const forcesTop = (state: WorkspaceState | null): boolean =>
  state?.workflow === "draw" || state?.workflow === "areaReview";
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
  pageActive: true,
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
  fullMap: false,
  precisionOpen: false,
  dialog: null,
  cadenceResetRequest: null,
  scheduleDeleteRequest: null,
  narrowHint: false,
  view: "top",
  appearance: "photo",
  labelsVisible: true,
  quality: "auto",
  cameras: {},
  cameraKey: null,
  historyCameras: {},
  managedLock: false,
  batteryPercent: null,
  deepMop: null,
  currentArea: null,
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

const isLegacyPlanReduction = (
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
      return { ...state, view: intent.view };
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
      return {
        ...state,
        cameraKey,
        cameras: { ...cameraPreferences(state), [intent.view]: camera },
      };
    }
    case "toggle-labels":
      return { ...state, labelsVisible: !state.labelsVisible };
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
        : { ...state, selection: { ...state.selection, entryId: intent.entryId, entrySource: "user" } };
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
    const committed = missingSubject ? { ...noticed, dialog: null, scheduleDeleteRequest: null } : noticed;
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

const PLAN_SAVING: Reason = { reason: "Waiting for Home Assistant to save the plan.", reasonKey: "v4_reason_plan_saving" };

const motionBlockReason = (state: WorkspaceState): Reason => {
  if (!canEditCoordinates(state)) {
    return {
      reason: "Waiting for the map to be ready.",
      reasonKey: "v4_reason_clean_rooms_verification",
    };
  }
  if (state.resources.entry?.stopSettlePending === true) {
    return {
      reason: "Waiting for the robot to finish stopping.",
      reasonKey: "v4_reason_stop_settle_pending",
    };
  }
  return state.pendingAction === "run-plan"
    ? { reason: "Waiting for Home Assistant to check the next run.", reasonKey: "v4_reason_run_plan_checking" }
    : state.pendingAction === "save-plan"
      ? PLAN_SAVING
      : { reason: "Waiting for the robot to finish what it's doing.", reasonKey: "v4_reason_robot_operation_waiting" };
};

const PLAN_PAUSED: Reason = { reason: "Can't run this plan until you turn it on.", reasonKey: "v4_reason_run_plan_paused" };

export const PLAN_PREVIEW: Reason = {
  reason: "Can't run this plan until you retry its next-run preview.",
  reasonKey: "v4_reason_run_plan_preview",
};
const PLAN_IDENTITY: Reason = {
  reason: "Can't run this plan until Home Assistant can match its rooms to the current map.",
  reasonKey: "v4_preview_identity_unavailable",
};
/** Run plan's reason for a preview blocker that names no room (plan.md R4); others retry the preview. */
export const PLAN_BLOCKERS: Partial<Record<NextRunPreviewBlocker, Reason>> = {
  area_map_changed: { reason: "Can't run this plan until you review its custom areas on the current map.", reasonKey: "v4_preview_area_changed" },
  cadence_identity_unavailable: PLAN_IDENTITY,
  cadence_identity_changed: PLAN_IDENTITY,
  plan_has_no_rooms: { reason: "Can't run this plan until it has at least one room.", reasonKey: "v4_preview_no_rooms" },
  plan_room_limit: { reason: "Can't run this plan until it has 100 rooms or fewer.", reasonKey: "v4_preview_room_limit" },
  invalid_plan: { reason: "Can't run this plan until you open Edit and save it again.", reasonKey: "v4_preview_invalid" },
  // No `plan_disabled`: a paused draft gives PLAN_PAUSED first, and a preview
  // still paused after the switch turned it on is stale, so it is retried.
};

/** One room's blocking schedule reason, most specific first (plan.md R3), or null when it can run. */
export const roomBlockReason = (reasons: readonly CadenceReason[], room: string) => {
  const has = (...blocking: CadenceReason[]): boolean => blocking.some((reason) => reasons.includes(reason));
  return has("mop_progress_unverified", "coverage_progress_unverified")
    ? {
      reason: "Can't run this plan until you reset {room}'s schedule progress, which Home Assistant can't confirm.",
      reasonKey: "v4_reason_plan_room_progress",
      reasonPlaceholders: { room },
    }
    : has("identity_changed")
      ? {
        reason: "Can't run this plan until you review {room}'s schedule on this map.",
        reasonKey: "v4_reason_plan_room_map",
        reasonPlaceholders: { room },
      }
      : has("room_not_on_current_map")
        ? {
          reason: "Can't run this plan until {room} is on the current map or removed from the plan.",
          reasonKey: "v4_reason_plan_room_off_map",
          reasonPlaceholders: { room },
        }
        : has("shared_schedule_unavailable", "invalid_cadence_policy")
          ? { reason: "Can't run this plan until you fix {room}'s schedule.", reasonKey: "v4_reason_plan_room_schedule", reasonPlaceholders: { room } }
          : has("coverage_requires_vacuum")
            ? {
              reason: "Can't run this plan until {room} uses a vacuum mode or its vacuum rotation is off.",
              reasonKey: "v4_reason_plan_room_mode",
              reasonPlaceholders: { room },
            }
            : null;
};

/**
 * The first room in saved order whose schedule blocks the run, with its reason
 * and a link to it; null when none blocks or that room has no catalog name.
 */
export const roomBlocker = (state: WorkspaceState, plan: SavedPlan) => {
  const blocking = draftForPlan(plan).rooms.find(({ cadenceReasons = [] }) => roomBlockReason(cadenceReasons, ""));
  const room = blocking && state.resources.plans.value?.rooms.find((candidate) => candidate.roomId === blocking.roomId)?.name;
  return blocking && room
    ? {
      ...roomBlockReason(blocking.cadenceReasons ?? [], room),
      jump: { label: "Review {room}", labelKey: "v4_review_room", labelPlaceholders: { room }, roomId: blocking.roomId },
    }
    : null;
};

export const canResumeMotion = (state: WorkspaceState): boolean =>
  canEditCoordinates(state)
  && state.command === "idle"
  && state.activity === "paused"
  && state.resources.entry?.stopSettlePending !== true;

const disabledAction = (
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

const noButton = (id: string): NoButtonAction => ({ id, enabled: false });

export const hasStoppableWork = (state: WorkspaceState): boolean =>
  state.command === "starting"
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
  const enabled = canStopMotion(state);
  return {
    id: "stop",
    label: "Stop",
    labelKey: "v4_action_stop",
    kind: "danger",
    enabled,
    ...(enabled ? {} : { reason: "Waiting for the robot to stop.", reasonKey: "v4_reason_stop" }),
  };
};

export const selectPrimaryAction = (state: WorkspaceState): PrimaryAction | NoButtonAction => {
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
  if ((state.workflow === "plan" || state.workflow === "rooms")
    && state.resources.plans.status !== "ready") {
    const unavailable = state.resources.plans.status === "error" || state.resources.plans.status === "empty";
    return unavailable
      ? disabledAction(
        "plans-unavailable",
        "Rooms and plans unavailable",
        "Load the room and plan list before choosing a cleaning action.",
        "v4_plans_unavailable_action",
        "v4_plans_required_reason",
      )
      : disabledAction(
        "plans-unavailable",
        "Loading rooms and plans…",
        "Load the room and plan list before choosing a cleaning action.",
        "v4_loading_rooms_plans",
        "v4_plans_required_reason",
      );
  }
  if (state.workflow === "draw") {
    const drawFirst = { reason: "Can't save until you draw the area.", reasonKey: "v4_reason_save_area_draw" };
    const mapLimited = {
      reason: "Can't save until Home Assistant can confirm this map.",
      reasonKey: "v4_reason_save_area_map",
    };
    const hasCoverage = state.draw.circles.length > 0 && (!state.draw.outline || state.draw.outline.closed);
    const editable = canEditCoordinates(state);
    return {
      id: "review-area",
      // A saved area's redraw is Done; a new one is named next (R11).
      ...(state.areaDraft.id !== null
        ? { label: "Done", labelKey: "v4_action_done_outline" }
        : { label: "Name and save", labelKey: "v4_action_review_area" }),
      kind: "primary",
      enabled: hasCoverage && editable,
      ...(!hasCoverage ? drawFirst : editable ? {} : mapLimited),
    };
  }
  if (state.workflow === "rooms") {
    const count = state.selection.roomIds.length;
    const admitted = admittedManualRoomPreview(state);
    const previewCurrent = admitted !== null;
    const previewAllowed = previewCurrent && !admitted.preview.blocker && admitted.preview.rooms.length > 0;
    const ready = canStartMotion(state) && count > 0 && previewAllowed;
    return {
      id: "clean-rooms",
      ...(count === 0 ? { label: "Clean rooms", labelKey: "v4_action_clean_rooms" }
        : count === 1 ? { label: "Clean 1 room", labelKey: "v4_action_clean_rooms_count_one" }
        : { label: "Clean {count} rooms", labelKey: "v4_action_clean_rooms_count", labelPlaceholders: { count } }),
      kind: "primary",
      enabled: ready,
      ...(ready
        ? {}
        : !count
          ? { reason: "Can't start until you choose a named room.", reasonKey: "v4_reason_clean_rooms_empty" }
          : !canStartMotion(state)
            ? motionBlockReason(state)
            : state.manualRoomPreview.status === "error"
              ? { reason: "Can't start until Home Assistant checks the room settings.", reasonKey: "v4_reason_room_preview_unavailable" }
              : previewCurrent && admitted.preview.blocker
                ? { reason: "Can't start until you change the settings noted above.", reasonKey: "v4_reason_room_preview_blocked" }
                : { reason: "Waiting for the room settings check.", reasonKey: "v4_reason_room_preview_loading" }),
    };
  }
  if (state.workflow === "plan") {
    if (state.planView === "edit" || state.planDraft.dirty || !state.planDraft.id) {
      const legacyReduction = isLegacyPlanReduction(state, state.planDraft.rooms);
      const withinRoomLimit = state.planDraft.rooms.length <= MAX_ROOM_SEQUENCE_SIZE || legacyReduction;
      const editable = canEditCoordinates(state);
      // A changed plan can't save a custom area drawn on another map. One the
      // areas list doesn't hold is left to Home Assistant: the list may be older.
      const areaAttention = state.planDraft.dirty && Boolean(state.resources.areas.value?.areas
        .some((area) => area.status !== "current" && state.planDraft.areas.some(({ areaId }) => areaId === area.id)));
      // A plan of custom areas alone saves without rooms.
      const enabled = editable
        && state.planDraft.name.trim().length > 0
        && (state.planDraft.rooms.length > 0 || state.planDraft.areas.length > 0)
        && withinRoomLimit
        && !areaAttention
        && state.command !== "pending";
      return {
        id: "save-plan",
        // A clean saved plan has nothing to save: Done returns to Run (plan.md E1).
        ...(state.planDraft.id && !state.planDraft.dirty
          ? { label: "Done", labelKey: "v4_action_done" }
          : { label: "Save", labelKey: "v4_action_save_plan" }),
        kind: "primary",
        enabled,
        ...(enabled ? {} : state.command === "pending"
          ? PLAN_SAVING
          : !editable
            ? { reason: "Waiting for the map to be ready.", reasonKey: "v4_reason_save_plan_map" }
            : !withinRoomLimit
              ? {
                reason: "Can't save until the plan has 100 rooms or fewer.",
                reasonKey: "v4_reason_save_plan_room_limit",
              }
              : areaAttention
                ? { reason: "Can't save until you remove the custom areas that need attention.", reasonKey: "v4_reason_save_plan_areas" }
                : { reason: "Can't save until the plan has a name and at least one room or custom area.", reasonKey: "v4_reason_save_plan" }),
      };
    }
    const plan = state.resources.plans.value?.plans.find((candidate) => candidate.id === state.planDraft.id);
    const blocker = plan?.nextRunPreview?.blocker;
    const previewReady = Boolean(plan?.nextRunPreview && !blocker
      && /^[0-9a-f]{64}$/u.test(plan.nextRunPreview.previewToken ?? ""));
    return {
      id: "run-plan",
      label: "Run plan",
      labelKey: "v4_action_run_plan",
      kind: "primary",
      enabled: canStartMotion(state) && state.planDraft.enabled && previewReady,
      ...(!canStartMotion(state)
        ? motionBlockReason(state)
        : !state.planDraft.enabled
          ? PLAN_PAUSED
          : previewReady
            ? {}
            : (plan && blocker && (roomBlocker(state, plan) ?? PLAN_BLOCKERS[blocker])) || PLAN_PREVIEW),
    };
  }
  if (state.workflow === "areaReview") {
    if (state.areaDraft.dirty || state.draw.dirty || !state.areaDraft.id || state.areaDraft.canRebind) {
      const editable = canEditCoordinates(state);
      const drawn = state.draw.circles.length > 0;
      const named = state.areaDraft.name.trim().length > 0;
      const label = state.areaDraft.canRebind || state.areaDraft.status === "review"
        ? {
          label: "Confirm area on current map",
          labelKey: "v4_action_confirm_area_binding",
        }
        : { label: "Save area", labelKey: "v4_action_save_area" };
      return {
        id: "save-area",
        ...label,
        kind: "primary",
        enabled: editable && drawn && named,
        ...(!editable
          ? { reason: "Can't save until Home Assistant can confirm this map.", reasonKey: "v4_reason_save_area_map" }
          : !drawn
            ? { reason: "Can't save until you draw the area.", reasonKey: "v4_reason_save_area_draw" }
            : !named
              ? { reason: "Can't save until you name the area.", reasonKey: "v4_reason_save_area_details" }
              : {}),
      };
    }
    const current = state.areaDraft.status === "current";
    return {
      id: "run-area",
      label: "Clean this area",
      labelKey: "v4_action_run_area",
      kind: "primary",
      enabled: current && canStartMotion(state),
      // Save is never offered here (that is the branch above), so the fix for
      // a changed or unusable map is Redraw; a running command says it waits.
      ...(!current
        ? { reason: "Can't clean this area until you redraw it.", reasonKey: "v4_reason_run_area" }
        : canStartMotion(state)
          ? {}
          : heldReasonKey(state) ?? motionBlockReason(state)),
    };
  }
  return noButton("choose-cleaning");
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
): PrimaryAction | null => hasStoppableWork(state) && selectPrimaryAction(state).id !== "stop"
  ? stopAction(state) : null;

export const brushCursorPixels = (state: WorkspaceState): number =>
  state.draw.brushMeters
  * MAP_PIXELS_PER_METER_AT_100
  * (state.draw.zoomPercent / 100);

const SCALE_OPTIONS_METERS = [2, 1, 0.5, 0.25, 0.1, 0.05] as const;

export const mapScale = (
  state: WorkspaceState,
): { readonly meters: number; readonly pixels: number; readonly label: string } => {
  const pixelsPerMeter = MAP_PIXELS_PER_METER_AT_100
    * (state.draw.zoomPercent / 100);
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
