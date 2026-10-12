import type { AreaOutline } from "./area-outline";
import type { ManualRoomSequencePreview } from "./backend-contracts";
export const MAP_ZOOM_MIN = 100;
export const MAP_ZOOM_MAX = 1000;
export const MAX_ROOM_SEQUENCE_SIZE = 100;
export const MAX_LEGACY_PLAN_ROOM_SEQUENCE_SIZE = 256;
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
  | "plans"
  | "areaReview"
  | "history"
  | "support";

export type CommandState = "idle" | "pending" | "starting" | "settling" | "failed";
export type DrawTool = "paint" | "erase" | "pan" | "outline";
export type CoordinateEditTool = Extract<DrawTool, "paint" | "erase" | "outline">;

/** Captures the authority generation, tool, and immutable draft baseline that
 * admitted one coordinate edit, so stale commits are rejected before overwrite. */
export interface CoordinateEditCapture {
  readonly generation: number;
  readonly tool: CoordinateEditTool;
  readonly baselineCircles: readonly AreaCircle[];
  readonly baselineOutline: AreaOutline | null;
}

export type DialogKind =
  | "discardDraft"
  | "confirmDeletePlan"
  | "confirmDeleteArea"
  | "confirmResetCadence";

export interface ResetCadenceAction {
  readonly id: "reset-room-cadence";
  readonly planId: string;
  readonly roomId: string;
  readonly mode: "mop" | "coverage";
}

export type WorkspaceAction = { readonly id: string } | ResetCadenceAction;

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
  readonly outline?: AreaOutline | null;
  readonly outlineUndo?: readonly (AreaOutline | null)[];
  readonly outlineRedo?: readonly (AreaOutline | null)[];
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

export interface AdmittedManualRoomPreview {
  readonly key: string;
  readonly generation: number;
  readonly floorKey: string;
  readonly missionKey: string;
  readonly preview: ManualRoomSequencePreview;
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
  readonly entrySource: "host" | "user";
  readonly floorId: string;
  readonly historyId: string | null;
  readonly roomIds: readonly string[];
  readonly roomSettings: readonly import("./backend-contracts").PlanRoom[];
  readonly useRoomSchedule: boolean;
  readonly cleaningMode: CleaningMode;
  readonly coverageSetting: CoverageSetting;
  readonly planId: string | null;
  readonly areaId: string | null;
}

export type NoticeTone = "info" | "success" | "warning" | "error";
/** A timestamp a view formats as it renders, so a language change reaches it. */
export interface NoticeDate { readonly date: string }
export type NoticePlaceholders = Readonly<Record<string, string | number | NoticeDate>>;

/**
 * A workspace notice names its copy; views translate it at render time with
 * `translate(localize, key, fallback, placeholders, dates)`.
 */
export interface WorkspaceNotice {
  readonly tone: NoticeTone;
  readonly key: string;
  readonly fallback: string;
  readonly placeholders?: NoticePlaceholders;
}

export const notice = (
  tone: NoticeTone,
  key: string,
  fallback: string,
  placeholders?: NoticePlaceholders,
): WorkspaceNotice => placeholders ? { tone, key, fallback, placeholders } : { tone, key, fallback };

const NOTICE_TONES: ReadonlySet<unknown> = new Set<NoticeTone>(["info", "success", "warning", "error"]);
const NOTICE_KEY = /^v4_[a-z0-9_]+$/u;
const NOTICE_PLACEHOLDER = /^[a-z][a-z0-9_]*$/u;
const NOTICE_FALLBACK_MAX = 400;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

// Own data values only: an accessor has no `value` and is rejected.
const ownValue = (value: object, name: string): unknown => Object.getOwnPropertyDescriptor(value, name)?.value;

// Exactly `{ date }`, holding a timestamp `Date.parse` accepts.
const readNoticeDate = (value: unknown): NoticeDate | null => {
  if (!isPlainObject(value)) return null;
  const names = Reflect.ownKeys(value);
  const date = ownValue(value, "date");
  return names.length === 1 && typeof date === "string" && Number.isFinite(Date.parse(date))
    ? Object.freeze({ date })
    : null;
};

const readNoticePlaceholders = (value: unknown): NoticePlaceholders | null => {
  if (!isPlainObject(value)) return null;
  const values: Record<string, string | number | NoticeDate> = {};
  for (const name of Reflect.ownKeys(value)) {
    if (typeof name !== "string" || !NOTICE_PLACEHOLDER.test(name)) return null;
    const entry = ownValue(value, name);
    const read = typeof entry === "string" || (typeof entry === "number" && Number.isFinite(entry))
      ? entry
      : readNoticeDate(entry);
    if (read === null) return null;
    values[name] = read;
  }
  return Object.freeze(values);
};

/**
 * Reads each field of an untrusted notice once and returns a frozen copy built
 * from those reads, or null when any of them is invalid.
 */
export function readWorkspaceNotice(value: unknown): WorkspaceNotice | null {
  if (!isPlainObject(value)) return null;
  const { tone, key, fallback, placeholders } = value;
  if (!NOTICE_TONES.has(tone) || typeof key !== "string" || !NOTICE_KEY.test(key)
    || typeof fallback !== "string" || fallback.length === 0 || fallback.length > NOTICE_FALLBACK_MAX) return null;
  if (placeholders === undefined) return Object.freeze(notice(tone as NoticeTone, key, fallback));
  const values = readNoticePlaceholders(placeholders);
  return values && Object.freeze(notice(tone as NoticeTone, key, fallback, values));
}

export interface WorkspaceState {
  readonly pageActive: boolean;
  readonly owner: { readonly userKey: string; readonly entryKey: string | null } | null;
  readonly draftFloorOrdinal: number | null;
  readonly draftMapSessionKey: string | null;
  readonly generation: number;
  readonly coherence: CoherenceState;
  readonly dataMode: DataMode;
  readonly activity: RobotActivity;
  readonly workflow: Workflow;
  readonly command: CommandState;
  /** True while a recheck the user asked for ("Try again") reads the catalog. */
  readonly rechecking: boolean;
  readonly fullMap: boolean;
  readonly precisionOpen: boolean;
  readonly dialog: DialogKind | null;
  readonly cadenceResetRequest: { readonly planId: string; readonly roomId: string; readonly mode: "mop" | "coverage" } | null;
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
  readonly manualRoomPreview: ResourceState<AdmittedManualRoomPreview>;
  readonly manualRoomPreviewRetry: number;
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
      readonly outline?: AreaOutline | null;
      readonly circles: readonly AreaCircle[];
      readonly coordinateEdit: CoordinateEditCapture;
    }
  | { readonly type: "redo-draft" }
  | { readonly type: "toggle-room"; readonly roomId: string }
  | { readonly type: "clear-selection" }
  | {
      readonly type: "patch-room-settings";
      readonly roomId: string;
      readonly cleaningMode?: CleaningMode;
      readonly coverageSetting?: CoverageSetting;
    }
  | { readonly type: "set-use-room-schedule"; readonly value: boolean }
  | { readonly type: "retry-room-preview" }
  | { readonly type: "request-room-cadence-reset"; readonly planId: string; readonly roomId: string; readonly mode: "mop" | "coverage" }
  | { readonly type: "set-floor"; readonly floorId: string }
  | { readonly type: "select-entry"; readonly entryId: string }
  | { readonly type: "set-history"; readonly historyId: string | null }
  | { readonly type: "select-plan"; readonly planId: string | null }
  | { readonly type: "select-area"; readonly areaId: string | null; readonly workflow?: "areaReview" }
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
  /** Values for the `{name}` placeholders in `label`; passed to `t(labelKey, label, labelPlaceholders)`. */
  readonly labelPlaceholders?: Readonly<Record<string, string | number>>;
  /** Translation key for `reason`; the view resolves `t(reasonKey, reason)`. */
  readonly reasonKey?: string;
}

/**
 * A branch shell.md §2 marks "No button": the policy holds, the view renders
 * nothing (the strip, canvas and sheet say the state), so it carries no copy.
 */
export interface NoButtonAction {
  readonly id: string;
  readonly enabled: false;
}

export interface HassEntityLike {
  readonly state: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface HassLike {
  readonly connection?: import("./workspace-transport").WorkspaceConnection;
  readonly connected?: boolean;
  readonly language?: string;
  readonly selectedLanguage?: string;
  /** The user's number and date formatting; `time_zone: "server"` means config.time_zone. */
  readonly locale?: { readonly language?: string; readonly time_zone?: string };
  readonly config?: { readonly time_zone?: string };
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
    notifyOnError?: boolean,
    returnResponse?: boolean,
  ) => Promise<unknown>;
  readonly localize?: (key: string, placeholders?: Record<string, unknown>) => string;
  readonly loadBackendTranslation?: (
    category: string,
    integration?: string | readonly string[],
    configFlow?: boolean,
  ) => Promise<unknown>;
}

/**
 * Home Assistant's date language, and its time zone when the user picked the
 * server's (undefined is the browser's). Every timestamp the panel shows uses it.
 */
export interface DateFormat {
  readonly language: string;
  readonly timeZone: string | undefined;
}

export interface HassProjection {
  readonly host: HostState;
  readonly activity: RobotActivity;
  readonly batteryPercent: number | null;
  readonly language: string;
  readonly dates: DateFormat;
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

const workspaceIntentTypes: Readonly<Record<WorkspaceIntent["type"], true>> = {
  "set-host": true,
  "set-operational-state": true,
  "set-narrow-hint": true,
  "set-view": true,
  "set-appearance": true,
  "set-quality": true,
  "set-camera": true,
  "toggle-labels": true,
  "open-workflow": true,
  "enter-full-map": true,
  "exit-full-map": true,
  "set-precision-open": true,
  "set-zoom": true,
  "step-zoom": true,
  "fit-map": true,
  "set-brush": true,
  "set-draw-tool": true,
  "mark-draft": true,
  "undo-draft": true,
  "clear-draft": true,
  "discard-draft": true,
  "set-draft-circles": true,
  "redo-draft": true,
  "toggle-room": true,
  "clear-selection": true,
  "patch-room-settings": true,
  "set-use-room-schedule": true,
  "retry-room-preview": true,
  "request-room-cadence-reset": true,
  "set-floor": true,
  "select-entry": true,
  "set-history": true,
  "select-plan": true,
  "select-area": true,
  "patch-plan-draft": true,
  "patch-area-draft": true,
  "set-notice": true,
  "open-dialog": true,
  "dismiss-top-layer": true,
  "return-live": true,
};

export const isWorkspaceIntent = (value: unknown): value is WorkspaceIntent => {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && Object.hasOwn(workspaceIntentTypes, type);
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
