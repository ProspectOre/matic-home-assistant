export const MAP_ZOOM_MIN = 100;
export const MAP_ZOOM_MAX = 1000;
export const DRAW_BRUSH_MIN_METERS = 0.2;
export const DRAW_BRUSH_MAX_METERS = 2.5;
export const MAP_PIXELS_PER_METER_AT_100 = 64;

export type CoherenceState =
  | "booting"
  | "verifying"
  | "current"
  | "degraded"
  | "blocked"
  | "unavailable";

export type DataMode = "live" | "history";
export type MapView = "three" | "top";
export type MapQuality = "auto" | "efficient" | "balanced" | "maximum";
export type MapAppearance = "photo" | "rooms";
export type Localize = (key: string, placeholders?: Record<string, unknown>) => string;

export interface RobotChoice {
  readonly entryId: string;
  readonly label: string;
}

export interface CameraPreference {
  readonly yaw: number;
  readonly pitch: number;
  readonly zoom: number;
  readonly targetX: number;
  readonly targetZ: number;
}

export type RobotActivity =
  | "idle"
  | "docked"
  | "starting"
  | "cleaning"
  | "paused"
  | "returning"
  | "recharging"
  | "stopping"
  | "problem"
  | "unknown";

export type Workflow =
  | "none"
  | "rooms"
  | "draw"
  | "plan"
  | "areaReview"
  | "history"
  | "support";

export type CommandState = "idle" | "pending" | "starting" | "settling" | "failed";
export type DrawTool = "paint" | "erase" | "pan";
export type DialogKind =
  | "discardDraft"
  | "confirmDeletePlan"
  | "confirmDeleteArea"
  | "confirmStop"
  | "error";

export interface ResourceStamp {
  readonly entryKey: string;
  readonly generation: number;
  readonly floorKey: string;
  readonly missionKey: string;
  readonly revision: number;
}

export interface FloorPresentation {
  readonly classifiedCount: number;
  readonly displayName: string;
  readonly readOnly: boolean;
}

export interface MapSafetyState {
  readonly available: boolean;
  readonly complete: boolean;
  readonly floorCoherent: boolean;
  readonly sessionVerified: boolean;
  readonly exactPose: boolean;
}

export interface HostState {
  readonly connected: boolean;
  readonly administrator: boolean;
  readonly robotConnected: boolean;
  readonly robotCount: number;
}

export interface DrawState {
  readonly zoomPercent: number;
  readonly zoomOriginX: number;
  readonly zoomOriginY: number;
  readonly brushMeters: number;
  readonly tool: DrawTool;
  readonly dirty: boolean;
  readonly strokeCount: number;
  readonly circles: readonly AreaCircle[];
  readonly undo: readonly (readonly AreaCircle[])[];
  readonly redo: readonly (readonly AreaCircle[])[];
}

export interface ResourceState<T> {
  readonly status: LoadStatus;
  readonly value: T | null;
  readonly problem: string | null;
}

export interface WorkspaceResources {
  readonly catalog: ResourceState<readonly MapEntry[]>;
  readonly entry: MapEntry | null;
  readonly scene: ResourceState<SceneModel>;
  readonly pose: ResourceState<PoseModel>;
  readonly history: ResourceState<HistoryCatalog>;
  readonly plans: ResourceState<PlansCatalog>;
  readonly areas: ResourceState<AreasCatalog>;
}

export interface PlanDraft {
  readonly id: string | null;
  readonly name: string;
  readonly enabled: boolean;
  readonly runBehavior: "intelligent" | "ordered";
  readonly rooms: readonly import("./backend-contracts").PlanRoom[];
  readonly returnToBase: boolean;
  readonly finishCurrentRoom: boolean;
  readonly finishCurrentRoomThreshold: number;
  readonly dirty: boolean;
}

export interface AreaDraft {
  readonly id: string | null;
  readonly name: string;
  readonly cleaningMode: CleaningMode;
  readonly coverageSetting: CoverageSetting;
  readonly status: "new" | "current" | "review" | "stale" | "unknown";
  readonly canRebind: boolean;
  readonly dirty: boolean;
}

export interface WorkspaceSelection {
  readonly entryId: string | null;
  readonly floorId: string;
  readonly historyId: string | null;
  readonly roomIds: readonly string[];
  readonly roomSettings: readonly import("./backend-contracts").PlanRoom[];
  readonly cleaningMode: CleaningMode;
  readonly coverageSetting: CoverageSetting;
  readonly planId: string | null;
  readonly areaId: string | null;
}

export interface WorkspaceNotice {
  readonly tone: "info" | "success" | "warning" | "error";
  readonly text: string;
}

export interface WorkspaceState {
  readonly generation: number;
  readonly coherence: CoherenceState;
  readonly dataMode: DataMode;
  readonly activity: RobotActivity;
  readonly workflow: Workflow;
  readonly command: CommandState;
  readonly fullMap: boolean;
  readonly precisionOpen: boolean;
  readonly dialog: DialogKind | null;
  readonly narrowHint: boolean;
  readonly view: MapView;
  readonly appearance: MapAppearance;
  readonly labelsVisible: boolean;
  readonly quality: MapQuality;
  readonly cameras: Readonly<Partial<Record<MapView, CameraPreference>>>;
  readonly managedLock: boolean;
  readonly batteryPercent: number | null;
  readonly floor: FloorPresentation;
  readonly map: MapSafetyState;
  readonly host: HostState;
  readonly draw: DrawState;
  readonly resources: WorkspaceResources;
  readonly selection: WorkspaceSelection;
  readonly planDraft: PlanDraft;
  readonly areaDraft: AreaDraft;
  readonly notice: WorkspaceNotice | null;
  readonly robotLabel: string;
  readonly robots: readonly RobotChoice[];
  readonly locale: string;
}

export type WorkspaceIntent =
  | { readonly type: "set-host"; readonly host: HostState }
  | {
      readonly type: "set-operational-state";
      readonly coherence: CoherenceState;
      readonly activity: RobotActivity;
      readonly command?: CommandState;
    }
  | { readonly type: "set-narrow-hint"; readonly value: boolean }
  | { readonly type: "set-view"; readonly view: MapView }
  | { readonly type: "set-appearance"; readonly appearance: MapAppearance }
  | { readonly type: "set-quality"; readonly quality: MapQuality }
  | {
      readonly type: "set-camera";
      readonly view: MapView;
      readonly camera: CameraPreference;
    }
  | { readonly type: "toggle-labels" }
  | { readonly type: "open-workflow"; readonly workflow: Workflow }
  | { readonly type: "enter-full-map" }
  | { readonly type: "exit-full-map" }
  | { readonly type: "set-precision-open"; readonly value: boolean }
  | {
      readonly type: "set-zoom";
      readonly value: number;
      readonly originX?: number;
      readonly originY?: number;
    }
  | { readonly type: "step-zoom"; readonly factor: number }
  | { readonly type: "fit-map" }
  | { readonly type: "set-brush"; readonly value: number }
  | { readonly type: "set-draw-tool"; readonly tool: DrawTool }
  | { readonly type: "mark-draft"; readonly strokeDelta: number }
  | { readonly type: "undo-draft" }
  | { readonly type: "clear-draft" }
  | { readonly type: "discard-draft" }
  | {
      readonly type: "set-draft-circles";
      readonly circles: readonly AreaCircle[];
      readonly record?: boolean;
      readonly previous?: readonly AreaCircle[];
    }
  | { readonly type: "redo-draft" }
  | { readonly type: "toggle-room"; readonly roomId: string }
  | {
      readonly type: "patch-room-settings";
      readonly roomId: string;
      readonly cleaningMode?: CleaningMode;
      readonly coverageSetting?: CoverageSetting;
    }
  | { readonly type: "set-floor"; readonly floorId: string }
  | { readonly type: "select-entry"; readonly entryId: string }
  | { readonly type: "set-history"; readonly historyId: string | null }
  | { readonly type: "select-plan"; readonly planId: string | null }
  | { readonly type: "select-area"; readonly areaId: string | null }
  | { readonly type: "patch-plan-draft"; readonly patch: Partial<PlanDraft> }
  | { readonly type: "patch-area-draft"; readonly patch: Partial<AreaDraft> }
  | { readonly type: "set-notice"; readonly notice: WorkspaceNotice | null }
  | { readonly type: "open-dialog"; readonly dialog: DialogKind }
  | { readonly type: "dismiss-top-layer" }
  | { readonly type: "return-live" };

export type PrimaryActionKind = "primary" | "danger" | "neutral";

export interface PrimaryAction {
  readonly id: string;
  readonly label: string;
  readonly kind: PrimaryActionKind;
  readonly enabled: boolean;
  readonly reason?: string;
  /** Translation key for `label`; the view resolves `t(labelKey, label)`. */
  readonly labelKey?: string;
  /** Translation key for `reason`; the view resolves `t(reasonKey, reason)`. */
  readonly reasonKey?: string;
}

export interface HassEntityLike {
  readonly state: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface HassLike {
  readonly connected?: boolean;
  readonly language?: string;
  readonly selectedLanguage?: string;
  readonly states?: Readonly<Record<string, HassEntityLike>>;
  readonly user?: {
    readonly id?: string;
    readonly is_admin?: boolean;
  };
  readonly auth?: {
    readonly accessToken?: string;
    readonly data?: { readonly access_token?: string };
  };
  readonly fetchWithAuth?: (path: string, init?: RequestInit) => Promise<Response>;
  readonly hassUrl?: (path: string) => string;
  readonly callService?: (
    domain: string,
    service: string,
    data?: Readonly<Record<string, unknown>>,
    target?: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
  readonly localize?: (key: string, placeholders?: Record<string, unknown>) => string;
}

export interface HassProjection {
  readonly host: HostState;
  readonly activity: RobotActivity;
  readonly batteryPercent: number | null;
  readonly language: string;
  readonly userKey: string;
  readonly vacuumEntityId: string | null;
  readonly entryKey: string | null;
  readonly robotLabel: string;
  readonly robots: readonly RobotChoice[];
}

export interface PanelLike {
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface RouteLike {
  readonly path?: string;
  readonly prefix?: string;
}

export const isWorkspaceIntent = (value: unknown): value is WorkspaceIntent => {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { type?: unknown }).type === "string";
};
import type {
  AreaCircle,
  AreasCatalog,
  CleaningMode,
  CoverageSetting,
  HistoryCatalog,
  LoadStatus,
  MapEntry,
  PlansCatalog,
  PoseModel,
  SceneModel,
} from "./backend-contracts";
