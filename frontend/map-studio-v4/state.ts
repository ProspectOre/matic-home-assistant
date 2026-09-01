import {
  DRAW_BRUSH_MAX_METERS,
  DRAW_BRUSH_MIN_METERS,
  MAP_PIXELS_PER_METER_AT_100,
  MAP_ZOOM_MAX,
  MAP_ZOOM_MIN,
  type CommandState,
  type PrimaryAction,
  type ResourceStamp,
  type WorkspaceIntent,
  type WorkspaceState,
} from "./contracts";
import type { AreaCircle } from "./backend-contracts";
import type { CameraPreference } from "./contracts";

const emptyResource = <T>(): { status: "idle"; value: T | null; problem: null } => ({
  status: "idle",
  value: null,
  problem: null,
});

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const normalizeCamera = (camera: CameraPreference): CameraPreference => ({
  yaw: clamp(Number.isFinite(camera.yaw) ? camera.yaw : 0, -Math.PI, Math.PI),
  pitch: clamp(
    Number.isFinite(camera.pitch) ? camera.pitch : Math.PI / 2 - 0.018,
    0.18,
    Math.PI / 2 - 0.018,
  ),
  zoom: clamp(Number.isFinite(camera.zoom) ? camera.zoom : 1, 0.01, 100),
  targetX: clamp(Number.isFinite(camera.targetX) ? camera.targetX : 0, -10_000, 10_000),
  targetZ: clamp(Number.isFinite(camera.targetZ) ? camera.targetZ : 0, -10_000, 10_000),
});

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
  generation: 0,
  coherence: "verifying",
  dataMode: "live",
  activity: "unknown",
  workflow: "none",
  command: "idle",
  fullMap: false,
  precisionOpen: false,
  dialog: null,
  narrowHint: false,
  view: "top",
  appearance: "photo",
  labelsVisible: true,
  quality: "auto",
  cameras: {},
  managedLock: false,
  batteryPercent: null,
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
  selection: {
    entryId: null,
    floorId: "current",
    historyId: null,
    roomIds: [],
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
  },
  areaDraft: {
    id: null,
    name: "",
    cleaningMode: "vacuum",
    coverageSetting: "standard",
    status: "new",
    canRebind: false,
    dirty: false,
  },
  notice: null,
  robotLabel: "Matic robot",
  robots: [],
  locale: "en",
});

const updateDraw = (
  state: WorkspaceState,
  draw: Partial<WorkspaceState["draw"]>,
): WorkspaceState => ({
  ...state,
  draw: { ...state.draw, ...draw },
});

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
    case "set-camera":
      return {
        ...state,
        cameras: { ...state.cameras, [intent.view]: normalizeCamera(intent.camera) },
      };
    case "toggle-labels":
      return { ...state, labelsVisible: !state.labelsVisible };
    case "open-workflow":
      return {
        ...state,
        workflow: intent.workflow,
        precisionOpen: false,
      };
    case "enter-full-map":
      return state.host.administrator
        && state.host.robotCount > 0
        && state.map.available
        ? { ...state, fullMap: true }
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
        undo: state.draw.undo.slice(0, -1),
        redo: [...state.draw.redo, state.draw.circles],
        dirty: true,
        strokeCount: Math.max(0, state.draw.strokeCount - 1),
      });
    }
    case "clear-draft":
      if (!state.draw.circles.length) return state;
      return updateDraw(state, {
        circles: [],
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
        undo: [...state.draw.undo, state.draw.circles],
        redo: state.draw.redo.slice(0, -1),
        dirty: true,
        strokeCount: state.draw.strokeCount + 1,
      });
    }
    case "set-draft-circles": {
      const circles: readonly AreaCircle[] = intent.circles.slice(0, 512).map((circle) => ({ ...circle }));
      const record = intent.record !== false;
      return updateDraw(state, {
        circles,
        undo: record
          ? [...state.draw.undo.slice(-99), intent.previous ?? state.draw.circles]
          : state.draw.undo,
        redo: record ? [] : state.draw.redo,
        dirty: true,
        strokeCount: record ? state.draw.strokeCount + 1 : state.draw.strokeCount,
      });
    }
    case "discard-draft":
      return {
        ...updateDraw(state, {
          dirty: false,
          strokeCount: 0,
          circles: [],
          undo: [],
          redo: [],
        }),
        dialog: null,
        workflow: "none",
        precisionOpen: false,
      };
    case "toggle-room": {
      const selected = state.selection.roomIds.includes(intent.roomId);
      return {
        ...state,
        selection: {
          ...state.selection,
          roomIds: selected
            ? state.selection.roomIds.filter((roomId) => roomId !== intent.roomId)
            : [...state.selection.roomIds, intent.roomId],
        },
      };
    }
    case "patch-room-settings":
      return {
        ...state,
        selection: {
          ...state.selection,
          ...(intent.cleaningMode ? { cleaningMode: intent.cleaningMode } : {}),
          ...(intent.coverageSetting ? { coverageSetting: intent.coverageSetting } : {}),
        },
      };
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
      return state;
    case "set-history":
      return {
        ...state,
        dataMode: intent.historyId ? "history" : "live",
        selection: { ...state.selection, historyId: intent.historyId },
      };
    case "select-plan":
      return { ...state, selection: { ...state.selection, planId: intent.planId } };
    case "select-area":
      return { ...state, selection: { ...state.selection, areaId: intent.areaId } };
    case "patch-plan-draft":
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
      return { ...state, notice: intent.notice };
    case "open-dialog":
      return { ...state, dialog: intent.dialog };
    case "dismiss-top-layer":
      if (state.dialog) return { ...state, dialog: null };
      if (state.precisionOpen) return { ...state, precisionOpen: false };
      if (state.fullMap) return { ...state, fullMap: false };
      if (state.workflow !== "none") {
        return {
          ...state,
          workflow: "none",
          precisionOpen: false,
        };
      }
      return state;
    case "return-live":
      return {
        ...state,
        dataMode: "live",
        workflow: "none",
        floor: { ...state.floor, readOnly: false },
      };
  }
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
    const next = reduceWorkspace(this.#state, intent);
    if (next === this.#state) return next;
    this.#state = next;
    for (const listener of this.#listeners) listener(next);
    return next;
  }

  replace(next: WorkspaceState): void {
    if (next === this.#state) return;
    this.#state = next;
    for (const listener of this.#listeners) listener(next);
  }

  patch(patch: Partial<WorkspaceState>): WorkspaceState {
    const next = { ...this.#state, ...patch };
    this.replace(next);
    return next;
  }

  subscribe(listener: (state: WorkspaceState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }
}

export class CoherenceMachine {
  #stamp: ResourceStamp | null = null;
  #generation = 0;

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
  && (state.coherence === "current" || state.coherence === "degraded")
  && state.host.administrator;

export const canShowExactPose = (state: WorkspaceState): boolean =>
  canShowLiveMap(state)
  // A degraded map stream can still have an independently verified floor,
  // session, and exact pose. Keep that last proven marker visible while the
  // retained scene is read only; coordinate editing and motion remain gated
  // on fully current coherence below. A real floor/session transition still
  // clears the marker through these explicit identity checks.
  && (state.coherence === "current" || state.coherence === "degraded")
  && state.map.floorCoherent
  && state.map.sessionVerified
  && state.map.exactPose
  && state.host.connected
  && state.host.robotConnected;

export const canEditCoordinates = (state: WorkspaceState): boolean =>
  canShowLiveMap(state)
  && state.coherence === "current"
  && state.map.complete
  && state.map.floorCoherent
  && state.map.sessionVerified
  && state.host.connected
  && state.host.robotConnected
  && !state.floor.readOnly;

/**
 * Floor-scoped metadata is safe to fetch before the rendered scene is fully
 * complete. Keep this read capability separate from coordinate edits and
 * motion, which continue to require canEditCoordinates/canStartMotion.
 */
export const canReadFloorResources = (state: WorkspaceState): boolean =>
  canShowLiveMap(state)
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

const disabledAction = (id: string, label: string, reason: string): PrimaryAction => ({
  id,
  label,
  kind: "neutral",
  enabled: false,
  reason,
});

export const selectPrimaryAction = (state: WorkspaceState): PrimaryAction => {
  if (state.dataMode === "history") {
    return { id: "return-live", label: "Return to Live", kind: "primary", enabled: true };
  }
  if (state.activity === "cleaning" || state.activity === "returning") {
    return { id: "stop", label: "Stop", kind: "danger", enabled: state.command === "idle" };
  }
  if (state.activity === "stopping" || state.command === "settling") {
    return disabledAction("stopping", "Stopping…", "Waiting for the robot to settle");
  }
  if (state.activity === "paused") {
    return { id: "resume", label: "Resume", kind: "primary", enabled: state.command === "idle" };
  }
  if (!state.host.connected) {
    return disabledAction("reconnecting", "Reconnecting…", "Home Assistant is offline");
  }
  if (!state.host.administrator) {
    return disabledAction("administrator", "Administrator required", "This map is private");
  }
  if (!state.host.robotConnected) {
    return disabledAction("robot-offline", "Robot offline", "Reconnect the robot first");
  }
  if (state.coherence !== "current") {
    return disabledAction("locating", "Locating…", "Waiting for the current map");
  }
  if (state.workflow === "draw") {
    if (state.fullMap || state.narrowHint) {
      return {
        id: "review-area",
        label: "Review details",
        kind: "primary",
        enabled: state.draw.dirty,
        ...(state.draw.dirty ? {} : { reason: "Draw an area first" }),
      };
    }
    return {
      id: "save-area",
      label: "Save area",
      kind: "primary",
      enabled: state.draw.dirty && canEditCoordinates(state),
      ...(state.draw.dirty ? {} : { reason: "Draw an area first" }),
    };
  }
  if (state.workflow === "rooms") {
    const ready = canStartMotion(state) && state.selection.roomIds.length > 0;
    return {
      id: "clean-rooms",
      label: state.selection.roomIds.length
        ? `Clean ${state.selection.roomIds.length} room${state.selection.roomIds.length === 1 ? "" : "s"}`
        : "Choose rooms",
      kind: "primary",
      enabled: ready,
      ...(ready ? {} : { reason: state.selection.roomIds.length ? "Map verification is required" : "Select at least one room" }),
    };
  }
  if (state.workflow === "plan") {
    if (state.planDraft.dirty || !state.planDraft.id) {
      const valid = canEditCoordinates(state)
        && state.planDraft.name.trim().length > 0
        && state.planDraft.rooms.length > 0;
      return {
        id: "save-plan",
        label: "Save plan",
        kind: "primary",
        enabled: valid,
        ...(valid ? {} : { reason: "Add a name and at least one room" }),
      };
    }
    return {
      id: "run-plan",
      label: "Run plan",
      kind: "primary",
      enabled: canStartMotion(state) && state.planDraft.enabled,
      ...(canStartMotion(state) ? {} : { reason: "Map verification is required" }),
    };
  }
  if (state.workflow === "areaReview") {
    if (state.areaDraft.dirty || state.draw.dirty || !state.areaDraft.id || state.areaDraft.canRebind) {
      const valid = canEditCoordinates(state)
        && state.areaDraft.name.trim().length > 0
        && state.draw.circles.length > 0;
      return {
        id: "save-area",
        label: state.areaDraft.canRebind ? "Confirm on this map" : "Save area",
        kind: "primary",
        enabled: valid,
        ...(valid ? {} : { reason: "Add a name and at least one mark" }),
      };
    }
    const current = state.areaDraft.status === "current";
    return {
      id: "run-area",
      label: "Clean area",
      kind: "primary",
      enabled: current && canStartMotion(state),
      ...(current ? {} : { reason: "Review or redraw this area first" }),
    };
  }
  return {
    id: "choose-cleaning",
    label: "Choose what to clean",
    kind: "neutral",
    enabled: false,
    reason: "Choose rooms, a plan, or a custom area",
  };
};

export const selectPausedSecondaryAction = (
  state: WorkspaceState,
): PrimaryAction | null => state.activity === "paused"
  ? { id: "stop", label: "Stop", kind: "danger", enabled: state.command === "idle" }
  : null;

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
