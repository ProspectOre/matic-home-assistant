import { LitElement, adoptStyles, nothing } from "lit";
import { shellStyles } from "./shell-styles";
import { html, unsafeStatic } from "lit/static-html.js";
import type { PropertyValues } from "lit";

import type {
  DateFormat,
  DeleteSharedCadenceAction,
  HomePin,
  Localize,
  NoticePlaceholders,
  NoticeTone,
  NoButtonAction,
  PrimaryAction,
  ResetCadenceAction,
  ColorScheme,
  SaveSettled,
  WorkspaceIntent,
  WorkspaceNotice,
  WorkspaceState,
  Workflow,
} from "./contracts";
import {
  MAP_CANVAS_TAG,
  PLAN_TOOLS_TAG,
  PRECISION_CONTROLS_TAG,
  SHELL_TAG,
  WORKFLOW_TAG,
} from "./element-tags";
import { heldReasonKey, renderDrawTools } from "./draw-tools";
import { LazyChunk, chunkStatus, reloadInto, takeResume, type ChunkStatus } from "./lazy-chunk";
import type { MapOptions } from "./map-options";
import { isNativeSelectControl } from "./gesture-controller";
import { RovingFocusController } from "./roving-focus";
import { opaque, readColors, resolveFill, resolveTone, rgba, watchTheme, type Channel } from "./theme-probe";
import {
  icon,
  iconBack,
  iconCharging,
  iconChevronDown,
  iconChevronRight,
  iconChevronUp,
  iconCleaning,
  iconClose,
  iconDiagnostics,
  iconHistory,
  iconMenu,
  iconPlan,
  iconNewArea,
  iconNoticeError,
  iconNoticeSuccess,
  iconNoticeWarning,
  iconOffline,
  iconOverflow,
  iconPaused,
  iconRobot,
  iconExitFullMap,
  iconFullMap,
} from "./icons";
import {
  WORKSPACE_ACTION_EVENT,
  WORKSPACE_INTENT_EVENT,
} from "./map-canvas";
import "./map-canvas";
import { translate } from "./localize";
import { needsDraftConfirmation } from "./draft-navigation";
import {
  canShowLiveMap,
  isReadOnlyWorkspace,
  deleteSubject,
  hasStoppableWork,
  initialWorkspaceState,
  isSelectedRobotUnavailable,
  selectStopSecondaryAction,
  selectPrimaryAction,
  savedMapPosition,
} from "./state";
import type { DialogPresentation } from "./dialog-copy";

const mapCanvasTag = unsafeStatic(MAP_CANVAS_TAG);
const precisionControlsTag = unsafeStatic(PRECISION_CONTROLS_TAG);
const workflowTag = unsafeStatic(WORKFLOW_TAG);

interface StatusPresentation {
  readonly title: string;
  readonly detail: string;
  readonly icon: string;
  /** True when the robot is doing something the workspace title alone would hide. */
  readonly notable: boolean;
  /** True for the idle "Map limited" row, whose sheet body offers Try again. */
  readonly recheck?: boolean;
}

// How managed_executor.py matches a firmware room phrase to a room's ID or
// name: case, spacing and a leading "the" aside.
const roomKey = (name: string | null): string => name?.toLowerCase().replace(/\s+/gu, " ").trim().replace(/^the /u, "") ?? "";

const statusCopy = (state: WorkspaceState, localize?: Localize, dates?: DateFormat): StatusPresentation => {
  const t = (key: string, fallback: string, placeholders?: NoticePlaceholders): string =>
    translate(localize, key, fallback, placeholders, dates);
  if (!state.host.connected) return { title: t("v4_reconnecting", "Reconnecting"), detail: t("v4_ha_offline", "Home Assistant is offline"), icon: iconOffline, notable: true };
  if (!state.host.administrator) return { title: t("v4_access_required", "Access required"), detail: t("v4_admin_only", "Administrator only"), icon: iconOffline, notable: true };
  if (state.host.robotCount === 0) return { title: t("v4_no_robot_short", "No robot"), detail: t("v4_set_up_robot", "Check the integration"), icon: iconOffline, notable: true };
  if (isSelectedRobotUnavailable(state)) return { title: t("v4_selected_robot_unavailable", "Selected robot unavailable"), detail: t("v4_choose_another_robot", "Choose another robot to open its map."), icon: iconOffline, notable: true };
  if (!state.host.robotConnected) return { title: t("v4_robot_offline", "Robot offline"), detail: t("v4_last_map_read_only", "Last known map · read only"), icon: iconOffline, notable: true };
  if (state.activity === "problem") return { title: t("v4_needs_attention", "Needs attention"), detail: t("v4_check_robot", "Check the robot"), icon: iconOffline, notable: true };
  // shell.md §4 row 15: from the press until the robot or the backend's fence settles.
  if (state.command === "settling" || state.activity === "stopping" || state.resources.entry?.stopSettlePending) {
    return { title: t("v4_stopping", "Stopping"), detail: t("v4_waiting_robot", "Waiting for the robot"), icon: iconPaused, notable: true };
  }
  if (state.dataMode === "history") {
    // shell.md §4 row 7: the date and place of the saved map, as the chip says.
    const saved = savedMapPosition(state);
    return {
      title: t("v4_saved_map", "Saved map"),
      detail: saved ? t("v4_saved_map_position", "{date} · {position} of {count}", { date: { date: saved.date }, position: saved.position, count: saved.count }) : "",
      icon: iconHistory,
      notable: false,
    };
  }
  if (state.coherence === "verifying" || state.coherence === "booting") {
    return { title: t("v4_locating", "Locating"), detail: t("v4_finding_map", "Finding the current map"), icon: iconRobot, notable: true };
  }
  if ((state.resources.entry?.activePlan || state.resources.entry?.runnerLocked)
    && (state.activity === "idle" || state.activity === "docked")) {
    return {
      title: t("v4_task_in_progress", "Run in progress"),
      detail: state.coherence === "unavailable" || state.coherence === "blocked"
        ? t("v4_task_map_unavailable", "The live map is unavailable; the current clean continues.")
        : state.activity === "docked"
        ? t("v4_task_docked", "Robot docked; the clean has not finished.")
        : t("v4_task_waiting", "Waiting for the clean to continue or finish."),
      icon: iconPlan,
      notable: true,
    };
  }
  if (state.command === "starting" && (state.activity === "idle" || state.activity === "docked")) {
    return { title: t("v4_action_starting", "Starting"), detail: t("v4_action_starting_detail", "Waiting for the robot to begin"), icon: iconRobot, notable: true };
  }
  const mapUnavailable = state.coherence === "unavailable" || state.coherence === "blocked";
  const battery = state.batteryPercent === null ? "" : t("v4_battery", "{percent}% battery", { percent: state.batteryPercent });
  if (state.activity === "cleaning") {
    // Row 11: the room the robot reports, when it is a room on this floor.
    const area = roomKey(state.currentArea);
    const room = area && state.resources.scene.value?.metadata.rooms.find((candidate) => roomKey(candidate.name) === area || roomKey(candidate.id) === area)?.name;
    const progress = state.lastRun?.outcome === "running" ? state.lastRun : null;
    return {
      title: t("v4_cleaning", "Cleaning"),
      detail: mapUnavailable ? t("v4_active_map_unavailable", "Live map unavailable") : progress
        ? t("v4_last_run_rooms", "{completed} of {total} rooms completed", { completed: progress.completedRoomCount, total: progress.roomCount })
          + (room ? ` · ${t("v4_cleaning_room", "In {room}", { room })}` : "")
        : room ? t("v4_cleaning_room", "In {room}", { room }) : battery,
      icon: iconCleaning,
      notable: true,
    };
  }
  if (state.activity === "recharging") return { title: t("v4_recharging", "Charging to resume"), detail: battery || t("v4_recharging_detail", "Will resume automatically when ready"), icon: iconCharging, notable: true };
  if (state.activity === "paused") return { title: t("v4_paused", "Paused"), detail: t("v4_can_resume", "Cleaning can resume"), icon: iconPaused, notable: true };
  if (state.activity === "returning") return { title: t("v4_returning", "Returning"), detail: t("v4_going_dock", "Going to the dock"), icon: iconCleaning, notable: true };
  if (mapUnavailable) return {
    title: t("v4_map_unavailable", "Map unavailable"),
    detail: t("v4_map_unavailable_status", "Home Assistant can't show the map right now, so cleaning can't start."),
    icon: iconOffline,
    notable: true,
  };
  // shell.md §4 row 8: a degraded map while idle can persist, so say so and
  // offer the recheck at once rather than a Ready beside "Finding the map".
  if (state.coherence === "degraded") return {
    title: t("v4_map_limited", "Map limited"),
    detail: state.rechecking
      ? t("v4_locating_rechecking", "Checking again")
      : t("v4_cleaning_blocked", "Cleaning can't start"),
    icon: iconRobot,
    notable: true,
    recheck: true,
  };
  if (state.lastRun && state.lastRun.outcome !== "running" && (state.activity === "docked" || state.activity === "idle")) {
    const run = state.lastRun;
    return {
      title: run.outcome === "unverified" ? t("v4_last_run_unverified", "Last run unverified") : t("v4_last_run_partial", "Last run did not finish"),
      detail: run.roomCount ? t("v4_last_run_rooms", "{completed} of {total} rooms completed", { completed: run.completedRoomCount, total: run.roomCount }) : "",
      icon: iconPlan,
      notable: true,
    };
  }
  return {
    title: state.activity === "docked" ? t("v4_docked", "Docked") : t("v4_ready", "Ready"),
    detail: battery,
    icon: iconRobot,
    notable: false,
  };
};

/**
 * Home's one state (home-rooms.md §4 H1-H11), checked in the strip's order.
 * Each state has one heading and at most one description; the cards and
 * the Maps group follow from it, so nothing is stated twice (MS-HOME-03).
 */
type HomeKind =
  | "ready" | "locating" | "busy" | "paused" | "problem" | "map-unavailable" | "map-limited"
  | "offline" | "reconnecting" | "administrator" | "robot-unavailable" | "read-only" | "setup";

// Home reads the catalog only once it is ready (home-rooms.md §4 H2): a read
// in flight or failed keeps the last catalog (loadPlans) but shows as such,
// as the picker's own loading and unavailable lines do.
const readyPlans = (state: WorkspaceState) => (state.resources.plans.status === "ready" ? state.resources.plans.value : null);

const homeState = (state: WorkspaceState): HomeKind => {
  const { host } = state;
  if (!host.connected) return "reconnecting";
  if (!host.administrator) return "administrator";
  if (host.robotCount === 0) return "setup";
  if (isSelectedRobotUnavailable(state)) return "robot-unavailable";
  if (!host.robotConnected) return "offline";
  if (isReadOnlyWorkspace(state)) return "read-only";
  if (state.activity === "problem") return "problem";
  if ((hasStoppableWork(state) && state.activity !== "paused")
    || state.activity === "stopping" || state.command === "settling"
    || state.resources.entry?.stopSettlePending === true) return "busy";
  if (state.activity === "paused") return "paused";
  if (state.coherence === "unavailable" || state.coherence === "blocked") return "map-unavailable";
  if (state.coherence === "degraded") return "map-limited";
  if (state.coherence === "verifying" || state.coherence === "booting") return "locating";
  return "ready";
};

const homeCopy = (kind: HomeKind, state: WorkspaceState, t: (key: string, fallback: string) => string): {
  readonly title: string;
  readonly description: string;
} => {
  switch (kind) {
    case "ready":
      return { title: t("v4_what_to_clean", "Choose what to clean"), description: "" };
    case "locating":
      return { title: t("v4_what_to_clean", "Choose what to clean"), description: t("v4_reason_locating", "Waiting for the robot to confirm which floor it is on.") };
    case "busy":
      return { title: t("v4_home_busy_title", "The robot is busy"), description: t("v4_home_busy_detail", "You can start a new clean when it's done.") };
    case "paused":
      return { title: t("v4_home_busy_title", "The robot is busy"), description: t("v4_home_paused_detail", "Resume or stop this clean before starting a new one.") };
    case "problem":
      return { title: t("v4_attention_title", "The robot needs attention"), description: t("v4_attention_body", "The robot reported a problem. Check it in the Matic app, then start a new clean.") };
    case "map-unavailable":
      return { title: t("v4_what_to_clean", "Choose what to clean"), description: t("v4_map_unavailable_status", "Home Assistant can't show the map right now, so cleaning can't start.") };
    case "map-limited":
      return { title: t("v4_what_to_clean", "Choose what to clean"), description: t("v4_map_limited_body", "Home Assistant can show this map but can't confirm it well enough to start cleaning.") };
    case "offline":
      return { title: t("v4_robot_offline_title", "Robot offline"), description: t("v4_robot_offline_body", "Showing the last known map. Cleaning comes back when the robot reconnects.") };
    case "reconnecting":
      return { title: t("v4_reconnecting_title", "Reconnecting to Home Assistant"), description: t("v4_reconnecting_body", "Waiting for Home Assistant to reconnect.") };
    case "administrator":
      return { title: t("v4_admin_title", "Administrator access required"), description: t("v4_admin_body", "Ask a Home Assistant administrator to open this map.") };
    case "robot-unavailable":
      return { title: t("v4_selected_robot_unavailable", "Selected robot unavailable"), description: t("v4_choose_another_robot", "Choose another robot to open its map.") };
    case "read-only":
      return {
        title: t("v4_saved_map_read_only_title", "Saved map is read only"),
        description: state.dataMode === "live"
          ? t("v4_map_recovery_automatic", "Cleaning becomes available automatically when the live map is ready.")
          : t("v4_saved_map_read_only_detail", "Return to the live map to choose rooms, run a plan, or draw a custom area."),
      };
    case "setup":
      return { title: t("v4_setup_title", "No robot available"), description: t("v4_no_robot_body", "Check the Matic (Unofficial) integration, or add it if you haven't set up a robot.") };
  }
};

const workflowCopy = (state: WorkspaceState, localize?: Localize): {
  readonly title: string;
  readonly description: string;
} => {
  const t = (key: string, fallback: string, placeholders?: NoticePlaceholders): string => translate(localize, key, fallback, placeholders);
  switch (state.workflow) {
    case "rooms":
      // The view renders its own description, so the rows can be described by it (R6).
      return { title: t("v4_choose_rooms", "Choose rooms"), description: "" };
    case "draw":
      return { title: t("v4_draw_area", "Draw an area"), description: t("v4_draw_area_detail", "Outline or paint the area, then review it before saving.") };
    case "plans":
      // An empty picker is its card alone (plan.md §3).
      return { title: t("v4_your_plans", "Your plans"), description: state.resources.plans.value?.plans.length === 0 ? "" : t("v4_choose_plan_detail", "Tap a plan to see its next run.") };
    case "areas":
      // The view renders its description, as Rooms does (R6).
      return { title: t("v4_your_areas", "Your areas"), description: "" };
    case "plan":
      // Run is titled with the plan's saved name: Run never shows a dirty draft.
      return {
        title: state.planView === "run" ? state.planDraft.name : state.planDraft.id ? t("v4_edit_plan", "Edit plan") : t("v4_new_plan", "New plan"),
        description: "",
      };
    case "areaReview": {
      // New: a name to give. Saved: its name; after a map change, a check (map-surfaces.md §4).
      const draft = state.areaDraft;
      if (draft.id === null) return { title: t("v4_name_this_area", "Name this area"), description: t("area_details_hint", "Name the area and choose cleaning settings.") };
      return { title: draft.canRebind || draft.status === "review" ? t("v4_check_area", "Check {name}", { name: draft.name }) : draft.name, description: "" };
    }
    case "history":
      return { title: t("v4_map_history", "Map history"), description: t("v4_map_history_detail", "Saved maps show one floor each. They can't be edited and never show where the robot is now.") };
    case "support":
      return { title: t("v4_map_diagnostics", "Map diagnostics"), description: t("v4_map_support_detail", "Details to share with support") };
    case "none":
      return homeCopy(homeState(state), state, t);
  }
};

type SheetDetent = "peek" | "half" | "full";

const DETENTS: readonly SheetDetent[] = ["peek", "half", "full"];
// A compact sheet (height < 480) has no half (design-system.md §7).
const COMPACT_DETENTS: readonly SheetDetent[] = ["peek", "full"];

// shell.md §4 notice rule: glyph per tone, and how long each toast stays.
const NOTICE_ICONS: Readonly<Record<NoticeTone, string>> = {
  info: iconDiagnostics,
  success: iconNoticeSuccess,
  warning: iconNoticeWarning,
  error: iconNoticeError,
};
const TOAST_MS: Readonly<Record<NoticeTone, number>> = { info: 6000, success: 4000, warning: 6000, error: 10000 };

// Where the sheet rests when a workflow or plan view opens (shell.md §5
// Sheet). The map is the document, so a drawing starts at peek; room and
// plan choices stay visible at half height, while the long forms (plan Edit,
// diagnostics) start at full height.
const DEFAULT_DETENT: Readonly<Record<Workflow, SheetDetent>> = {
  none: "half",
  rooms: "half",
  draw: "peek",
  plan: "half",
  plans: "half",
  areas: "half",
  areaReview: "half",
  history: "half",
  support: "full",
};
const startingDetent = (state: WorkspaceState, compact: boolean): SheetDetent =>
  compact ? /^(rooms|draw|areaReview|history)$/u.test(state.workflow) ? "peek" : "full"
  : state.workflow === "plan" && state.planView === "edit" ? "full" : DEFAULT_DETENT[state.workflow];

// Faster than this on release and the sheet goes to the next detent in the
// direction of travel regardless of where the finger let go.
const FLICK_VELOCITY = 0.5;
// Velocity is read over the samples from this many ms before release, not
// from the last pair of pointermoves alone: browsers deliver moves in bursts,
// and one late frame at the end of a real flick would otherwise read as a
// slow drag.
const FLICK_WINDOW_MS = 100;
const TAP_SLOP = 6;
const BODY_SWIPE_DISTANCE = 48;
// The panel's scrollers: the pinned top, capped on a sheet, and the body.
const SCROLLERS = ".panel-top, .sheet-body, .workflow-body";
const INTERACTIVE_SHEET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "label",
  "select",
  "textarea",
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="slider"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  // A scroller is a tab stop only so a keyboard can scroll it
  // (#syncScrollers); a swipe that starts on it still steps the sheet.
  `[tabindex]:not([tabindex="-1"]):not(${SCROLLERS})`,
].join(",");

interface SheetDrag {
  readonly pointerId: number;
  readonly startY: number;
  readonly startHeight: number;
  readonly heights: Readonly<Record<SheetDetent, number>>;
  samples: { y: number; t: number }[];
  moved: boolean;
}

interface BodySwipe {
  readonly pointerId: number;
  readonly startY: number;
  readonly scroller: HTMLElement | null;
  consumed: boolean;
}

const FOCUSABLE = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

// Whether Tab reaches anything inside `root`, open shadow roots included.
const hasFocusable = (root: ParentNode): boolean => Boolean(root.querySelector(FOCUSABLE))
  || [...root.querySelectorAll("*")].some((element) => element.shadowRoot !== null && hasFocusable(element.shadowRoot));

const deepActiveElement = (root: Document | ShadowRoot = document): HTMLElement | null => {
  let active = root.activeElement as HTMLElement | null;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement as HTMLElement;
  }
  return active;
};

const isVisible = (element: HTMLElement | null | undefined): element is HTMLElement =>
  Boolean(element && element.isConnected && element.offsetParent !== null);

export class MaticMapShellV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    dates: { attribute: false },
    scheme: { attribute: false },
    _measuredNarrow: { state: true },
    _compact: { state: true },
    _sheetOffset: { state: true },
    _helpOpen: { state: true },
    _sheetDetent: { state: true },
    _polite: { state: true },
    _alert: { state: true },
    _toast: { state: true },
  };

  static override styles = shellStyles;

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;
  /** How the panel shows timestamps; set by the panel, not part of the snapshot. */
  dates?: DateFormat;
  /**
   * The light or dark scheme the panel picked from Home Assistant ("" for the
   * device's). It changes no document attribute or media query, so watchTheme
   * misses it: a change re-resolves the theme colours here and in the map.
   */
  scheme: ColorScheme = "";

  constructor() {
    super();
    new RovingFocusController(this, {
      container: () => this.renderRoot?.querySelector<HTMLElement>(".draw-tools") ?? null,
      items: "button",
    });
  }

  readonly #t = (key: string, fallback: string, placeholders?: NoticePlaceholders): string =>
    translate(this.localize, key, fallback, placeholders, this.dates);
  // Unset until the host is measured; till then the host's narrow hint decides.
  protected _measuredNarrow?: boolean;
  protected _compact = false;
  protected _sheetOffset = 0;
  // The help popover (map-help.ts, in the views chunk) is the shell's: it
  // opens from the rail "?" and closes from Close, Escape (after the menu,
  // shell.md §5) or a change of workflow or Full map. The canvas renders it
  // beside its "?".
  protected _helpOpen = false;
  #helpLauncher: HTMLElement | null = null;
  #helpReturnsFull = false;
  protected _sheetDetent: SheetDetent = "half";
  // The two live regions (shell.md §4 rule 6). Each holds only its newest
  // message: the polite one for detent, status title and non-error notices,
  // the alert one for error notices.
  protected _polite = "";
  protected _alert = "";
  #statusRow: string | null = null;
  #announced = new Set<"_polite" | "_alert">();
  protected _toast: WorkspaceNotice | null = null;
  // A chunk loads when the first view that needs it opens: the workflow views
  // with any workflow, the outline editor with Draw. The shell builds the
  // editor and hands it to the canvas, so the sheet is the one place a failure
  // of either, building included, is said.
  readonly #views = new LazyChunk(this, () => this.#workflowModule());
  readonly #mapHelpView = new LazyChunk(this, async () => {
    const help = await import("./map-help");
    help.watchHelpDismissal(this, () => this._helpOpen, () => this.#helpLauncher, () => this.#closeHelp(false));
    return help;
  });
  readonly #outline = new LazyChunk(this, async () => {
    const [{ OutlineEditor }, geometry] = await Promise.all([
      import("./outline-editor"),
      import("./area-outline"),
    ]);
    return new OutlineEditor(geometry);
  });
  // The menu has its own small lazy module; the first press opens it once the
  // module and menu controller have settled.
  readonly #options: LazyChunk<MapOptions> = new LazyChunk(this, async () => {
    const { MapOptions } = await import("./map-options");
    return new MapOptions(this);
  });
  #optionsPending = false;
  // The workflow a Try again reload was pressed in (lazy-chunk.ts).
  #resume = takeResume();
  #toastTimer: ReturnType<typeof setTimeout> | undefined;
  #toastDeadline = 0;
  #toastRemaining = 0;
  #toastHover = false;
  #toastFocus = false;
  #focused: Element | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #sheetResizeObserver: ResizeObserver | null = null;
  #scrollerResizeObserver: ResizeObserver | null = null;
  #unwatchTheme: (() => void) | null = null;
  #observedSheet: Element | null = null;
  #dialogLauncher: HTMLElement | null = null;
  #workspaceLauncher: HTMLElement | null = null;
  // What Discard goes on to: the intent that asked, or Try again's reload.
  #pendingNavigation: WorkspaceIntent | "reload" | null = null;
  // The save Discard changes? started; only that save's own answer settles it.
  #dialogSave: object | null = null;
  // Where a saved dialog goes once the dialog has closed: two dismissals in
  // one task would race the browser history traversal the first one starts.
  #afterDialog: WorkspaceIntent | "reload" | null = null;
  // The workflows the entry screen's enabled rows offered at its last render
  // (#launch), plus Map diagnostics, which Map options offers on any screen.
  #launchers = new Set<string>();
  /** The home launcher last pressed; it takes focus back when its workflow closes (home-rooms.md §5 Keyboard). */
  #homeLauncher: string | null = null;
  // A plan shortcut's run, until it starts (then home) or its view is left.
  // Home stays on screen meanwhile (owner, 2026-10-14): Run plan needs the
  // plan's Run view in the store (effects.ts run-plan), never on screen.
  #pinRun: string | null = null;
  #editingHomeShortcuts = false;
  #shortcutsOwner: string | null = null;
  #workflowStyled = false;

  // Workflow views bring their shell and form rules. The independent Map
  // options module renders its own menu and shared switch rules.
  async #workflowModule(): Promise<typeof import("./workflow-panel")> {
    const views = await import("./workflow-panel");
    if (!this.#workflowStyled) {
      this.#workflowStyled = true;
      adoptStyles(this.renderRoot as ShadowRoot, [...shellStyles, views.shellWorkflowStyles, views.formControls]);
    }
    return views;
  }
  #drag: SheetDrag | null = null;
  #bodySwipe: BodySwipe | null = null;

  // D3 (map-surfaces.md §10): Full map asks the browser for full screen
  // and leaves it on exit; leaving the browser's full screen (its own
  // Escape, say) leaves Full map with the same focus return. A browser
  // that refuses keeps the panel-only Full map.
  readonly #fullscreenChange = (): void => {
    if (!document.fullscreenElement && this.state.fullMap) this.#intent({ type: "exit-full-map" });
  };

  // design-system.md §7: the inspector at 1024 and up, and from 768 in
  // landscape (the compact inspector); a sheet otherwise, compact when short.
  #measure({ width, height }: { width: number; height: number }): void {
    // A hidden panel measures 0 × 0; keep the layout it will come back to.
    if (!width || !height) return;
    const compact = height < 480;
    this._measuredNarrow = compact || width < 768 || (width < 1024 && width <= height);
    if (compact !== this._compact) {
      this._compact = compact;
      this._sheetDetent = startingDetent(this.state, compact);
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) this.#measure(entry.contentRect);
    });
    this.#resizeObserver.observe(this);
    document.addEventListener("fullscreenchange", this.#fullscreenChange);
    // Reads the box height, which a translateY drag does not change, so a
    // drag never relayouts the canvas. Only the committed detent does.
    this.#sheetResizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = Math.ceil(entry.target.getBoundingClientRect().height);
      if (next !== this._sheetOffset) this._sheetOffset = next;
    });
    this.#scrollerResizeObserver = new ResizeObserver(() => this.#syncScrollers());
    this.#resolveTheme();
    this.#unwatchTheme = watchTheme(() => this.#resolveTheme());
  }

  // MS-AXE-03 (design-system.md §5): semantic colours resolved from HA's
  // theme colours (theme-probe.ts): the primary and Stop fill pairs, the
  // focus and selection indicator (3:1 on the card and sunken surfaces) and
  // danger text (4.5:1 on resting, hovered and pressed rows). Forced colours bypass it.
  #resolveTheme(): void {
    const forced = window.matchMedia("(forced-colors: active)").matches;
    const read = readColors(this.renderRoot, {
      accent: "var(--ms-accent)", danger: "var(--ms-danger)", label: "var(--ms-on-accent)",
      card: "var(--ms-surface-card)", sunken: "var(--ms-surface-sunken)",
      hover: "color-mix(in srgb, var(--ms-text) 7%, var(--ms-surface-sunken))",
      pressed: "color-mix(in srgb, var(--ms-text) 14%, var(--ms-surface-sunken))",
    });
    // In the order read. A translucent colour has no single contrast, so it
    // resolves nothing.
    const [accent, danger, label, card, sunken, hover, pressed] = Object.values(read).map(opaque);
    const pair = (fill?: Channel | null) => (forced || !fill || !label ? [] : resolveFill(fill, label));
    const tone = (color: Channel | null | undefined, ratio: number, surface = card) =>
      (forced || !color || !card || !surface ? undefined : resolveTone(color, ratio, [card, surface]));
    // An empty value removes the property, so the CSS falls back to HA's colour.
    const value = (channel?: Channel): string => (channel ? rgba(channel, 1) : "");
    const [accentFill, onAccentFill] = pair(accent);
    const [dangerFill, onDangerFill] = pair(danger);
    const indicator = tone(accent, 3, sunken);
    this.style.setProperty("--ms-resolved-accent-fill", value(accentFill));
    this.style.setProperty("--ms-resolved-on-accent-fill", value(onAccentFill));
    this.style.setProperty("--ms-resolved-danger-fill", value(dangerFill));
    this.style.setProperty("--ms-resolved-on-danger-fill", value(onDangerFill));
    this.style.setProperty("--ms-resolved-indicator", value(indicator));
    this.style.setProperty("--ms-resolved-on-indicator", value(indicator && label ? resolveTone(label, 4.5, [indicator]) : undefined));
    this.style.setProperty("--ms-resolved-danger-text", value(!forced && danger && card && sunken && hover && pressed
      ? resolveTone(danger, 4.5, [card, sunken, hover, pressed]) : tone(danger, 4.5)));
  }

  override disconnectedCallback(): void {
    // Nothing re-arms a toast on reconnect, so it must not outlive the detach.
    this.#hideToast();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#sheetResizeObserver?.disconnect();
    this.#sheetResizeObserver = null;
    this.#scrollerResizeObserver?.disconnect();
    this.#scrollerResizeObserver = null;
    this.#unwatchTheme?.();
    this.#unwatchTheme = null;
    this.#observedSheet = null;
    document.removeEventListener("fullscreenchange", this.#fullscreenChange);
    super.disconnectedCallback();
  }

  // A live region speaks when its text changes, so the same message twice is
  // written as empty first and set again after that render. A region gets one
  // message per render; a second one waits for the next render, so both are
  // spoken in order.
  #announce(region: "_polite" | "_alert", text: string): void {
    if (this.#announced.has(region)) {
      void this.updateComplete.then(() => this.#announce(region, text));
      return;
    }
    this.#announced.add(region);
    const repeat = this[region] === text;
    this[region] = repeat ? "" : text;
    // Read after the write, so this is the render that shows it.
    void this.updateComplete.then(() => {
      this.#announced.delete(region);
      if (repeat && !this[region]) this.#announce(region, text);
    });
  }

  // A status title change, then each new notice object (never a re-render or
  // a language swap), is announced once; a new notice also restarts the toast
  // (shell.md §4 rules 3 and 6). Clearing a notice announces nothing.
  protected override willUpdate(changed: PropertyValues<this>): void {
    // The control holding focus before this render. If the render removes or
    // hides it (Stop on its "No button" row, a closed notice or toast),
    // updated() hands focus to the heading rather than let it fall to the
    // page (shell.md §5 Focus, MS-KEY-01).
    this.#focused = this.shadowRoot?.activeElement ?? null;
    if (!changed.has("state")) return;
    // Home Assistant flips its narrow hint as the panel resizes, but the
    // ResizeObserver can report frames later. Measure now so this render
    // never lays out from the old size and moves a control under a key press.
    const previous = changed.get("state") as WorkspaceState | undefined;
    if (previous && previous.narrowHint !== this.state.narrowHint && this.isConnected) {
      this.#measure(this.getBoundingClientRect());
    }
    // The untranslated title names the status row, so only a new row is
    // announced, in the current language.
    const row = statusCopy(this.state).title;
    if (this.#statusRow !== null && row !== this.#statusRow) {
      this.#announce("_polite", statusCopy(this.state, this.localize).title);
    }
    this.#statusRow = row;
    const next = this.state.notice;
    if (next === previous?.notice) return;
    // A workflow change clears a success notice from the slot, but a toast
    // already showing it finishes its timer (shell.md §4 rule 5).
    if (!next && previous?.notice?.tone === "success" && previous.workflow !== this.state.workflow) return;
    this.#hideToast();
    if (!next) return;
    this._toast = next;
    this.#toastRemaining = TOAST_MS[next.tone];
    this.#announce(next.tone === "error" ? "_alert" : "_polite", this.#t(next.key, next.fallback, next.placeholders));
    void this.updateComplete.then(() => {
      if (this.state.notice !== next) return;
      // A toast replaced in place gets no new pointerenter or focusin, so
      // read the live hover and focus before the timer starts.
      const toast = this.renderRoot.querySelector<HTMLElement>("[data-notice-toast]");
      this.#toastHover = Boolean(toast?.matches(":hover"));
      this.#toastFocus = Boolean(toast?.contains(this.shadowRoot?.activeElement ?? null));
      this.#armToast();
    });
  }

  #armToast(): void {
    if (!this._toast || this.#toastTimer !== undefined || this.#toastHover || this.#toastFocus) return;
    this.#toastDeadline = Date.now() + this.#toastRemaining;
    this.#toastTimer = setTimeout(this.#hideToast, this.#toastRemaining);
  }

  #stopToast(): void {
    clearTimeout(this.#toastTimer);
    this.#toastTimer = undefined;
  }

  // Hides only the toast; state.notice and the slot are untouched.
  readonly #hideToast = (): void => {
    this.#stopToast();
    this.#toastHover = false;
    this.#toastFocus = false;
    this._toast = null;
  };

  readonly #holdToast = (event: Event): void => {
    if (event.type === "pointerenter") this.#toastHover = true;
    else this.#toastFocus = true;
    if (this.#toastTimer === undefined) return;
    this.#stopToast();
    this.#toastRemaining = Math.max(0, this.#toastDeadline - Date.now());
  };

  readonly #releaseToast = (event: Event): void => {
    if (event.type === "pointerleave") this.#toastHover = false;
    else if (!(event.currentTarget as Node).contains((event as FocusEvent).relatedTarget as Node | null)) this.#toastFocus = false;
    this.#armToast();
  };

  readonly #closeToast = (): void => {
    this.#hideToast();
    void this.updateComplete.then(() => this.#focusPanel());
  };

  readonly #closeNotice = (): void => {
    this.#intent({ type: "set-notice", notice: null });
    void this.updateComplete.then(() => this.#focusPanel());
  };

  // The slot's Close clears the notice; the toast's control only hides the
  // toast, so it is named for that (shell.md §4 rule 3).
  #noticeBody(notice: WorkspaceNotice, close: () => void, label: string) {
    return html`${icon(NOTICE_ICONS[notice.tone])}<span class="notice-text">${this.#t(notice.key, notice.fallback, notice.placeholders)}</span><button
      class="ms-btn ms-btn--icon"
      type="button"
      aria-label=${label}
      @click=${close}
    >${icon(iconClose)}</button>`;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("scheme") && changed.get("scheme") !== undefined) this.#resolveTheme();
    const instant = this.renderRoot.querySelector<HTMLElement>(".mobile-sheet.instant");
    if (instant) {
      // Resolve the new height while transitions are off, so turning them
      // back on starts none; detent steps and drags ease as before.
      void getComputedStyle(instant).blockSize;
      instant.classList.remove("instant");
    }
    const focused = this.#focused;
    this.#focused = null;
    if (focused && (!focused.isConnected || focused.closest("[hidden]"))) this.#focusPanel();
    const sheet = this.renderRoot.querySelector(".mobile-sheet");
    if (sheet !== this.#observedSheet) {
      this.#sheetResizeObserver?.disconnect();
      this.#observedSheet = sheet;
      if (sheet) this.#sheetResizeObserver?.observe(sheet);
      else if (this._sheetOffset !== 0) this._sheetOffset = 0;
    }
    // Observing again reports each box once after this layout, and later
    // whenever a scroller or its content (the workflow view too) resizes.
    this.#scrollerResizeObserver?.disconnect();
    for (const scroller of this.renderRoot.querySelectorAll(SCROLLERS)) {
      for (const element of [scroller, ...scroller.children]) this.#scrollerResizeObserver?.observe(element);
    }
    if (this.#optionsPending && this.#options.status !== "loading") {
      this.#optionsPending = false;
      this.#options.value?.menu.toggle();
    }
    if (changed.has("state")) {
      this.#resumeWorkflow();
      const previous = changed.get("state") as WorkspaceState | undefined;
      // A shortcut's run returns home once it starts; one that is idle (its
      // check was refused, or nothing took the action) shows its Run view
      // with the reason, and a later Run plan there no longer jumps home.
      if (this.#pinRun && (this.state.workflow !== "plan" || this.state.selection.planId !== this.#pinRun)) this.#pinRun = null;
      else if (this.#pinRun && (this.state.command === "starting" || hasStoppableWork(this.state))) {
        this.#pinRun = null;
        this.#emit({ type: "open-workflow", workflow: "none" });
      } else if (this.#pinRun && this.state.command === "idle") this.#revealRun();
      if (previous?.precisionOpen && !this.state.precisionOpen) {
        this.#brushLauncher()?.focus();
      }
      if (this._helpOpen && previous && (previous.workflow !== this.state.workflow || previous.fullMap !== this.state.fullMap)) {
        this.#closeHelp(false);
      }
      if (previous?.fullMap && !this.state.fullMap) {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        const launcher = this.#workspaceLauncher;
        this.#workspaceLauncher = null;
        void this.updateComplete.then(() => {
          requestAnimationFrame(() => {
            const target = this.renderRoot.querySelector<HTMLElement>(".workspace-toggle")
              ?? this.renderRoot.querySelector<HTMLElement>(".nav--menu")
              ?? (launcher?.isConnected ? launcher : null);
            target?.focus({ preventScroll: true });
          });
        });
      }
      if (previous && !previous.fullMap && this.state.fullMap) {
        // Pointer activation does not focus buttons in Safari. Keep keyboard
        // dismissal inside this shell after the layout changes to full map.
        void this.updateComplete.then(() => {
          const launcher = this.#workspaceLauncher;
          requestAnimationFrame(() => {
            const target = this.renderRoot.querySelector<HTMLElement>(".workspace-toggle")
              ?? (launcher?.isConnected ? launcher : null);
            target?.focus({ preventScroll: true });
          });
        });
      }
      if (!previous?.dialog && this.state.dialog) {
        this.#afterDialog = null;
        if (this.state.dialog === "discardDraft" && !this.#pendingNavigation && previous) {
          // Browser Back opens this dialog in the history controller, outside
          // #intent. Capture the view Back was leaving before a save changes it.
          if (previous.workflow === "plan") {
            this.#pendingNavigation = previous.planDraft.id !== null && previous.planView === "edit"
              ? { type: "set-plan-view", view: "run" }
              : { type: "open-workflow", workflow: "plans" };
          } else {
            this.#pendingNavigation = { type: "dismiss-top-layer" };
          }
        }
        const active = deepActiveElement(this.shadowRoot || document);
        if (active?.hasAttribute("data-dialog-launcher")) this.#dialogLauncher = active;
        void this.updateComplete.then(() => {
          (this.renderRoot.querySelector<HTMLElement>(".dialog [data-dialog-initial-focus]")
            ?? this.renderRoot.querySelector<HTMLElement>(".dialog button"))?.focus();
        });
      } else if (previous?.dialog && !this.state.dialog) {
        if (previous.dialog === "discardDraft") {
          // Browser Back dismisses the dialog through the layer controller,
          // bypassing the button/keyboard handler. Clear the pending intent
          // and restore the native selector so it cannot show a floor that
          // the store did not select. A save in flight keeps it: its answer
          // decides whether the navigation goes on.
          if (!this.#dialogSave) this.#pendingNavigation = null;
          this.#restoreSelectors();
          const next = this.#afterDialog;
          this.#afterDialog = null;
          this.#continue(next);
        }
        // Safari does not focus a button on a pointing-device click. Use the
        // explicit workflow launcher if there was no nested active element.
        const launcher = this.#dialogReturn(previous);
        this.#dialogLauncher = null;
        // One rule: try the launcher, then, if closing the dialog left focus
        // on the page body (the launcher is gone or hidden, or Safari gave a
        // clicked Cancel no focus to move), hand it to the panel. Focus the
        // user moved elsewhere in the document is left alone.
        void this.updateComplete.then(() => {
          requestAnimationFrame(() => {
            const active = deepActiveElement(document);
            let target: Node | null = active;
            while (target && target !== this) {
              const root = target.getRootNode();
              target = root instanceof ShadowRoot ? root.host : null;
            }
            if (active && active !== document.body && target !== this) return;
            launcher?.focus({ preventScroll: true });
            const body = !document.activeElement || document.activeElement === document.body;
            if (!this.shadowRoot?.activeElement && body) this.#focusPanel();
          });
        });
      }
      if (!previous) {
        this._sheetDetent = startingDetent(this.state, this._compact);
      } else if (!this.#pinRun && (previous.workflow !== this.state.workflow || previous.planView !== this.state.planView)) {
        // Only on a workflow or view CHANGE: a state tick inside a view must
        // not yank the sheet back to its default while the user is reading.
        const detent = startingDetent(this.state, this._compact);
        if (detent !== this._sheetDetent) {
          // The view, not the user, moved the sheet: it lands at the new
          // height at once. An eased resize here would still be running
          // under the next click and hold that click's frame back a vsync.
          this.#sheet()?.classList.add("instant");
          this._sheetDetent = detent;
        }
        const state = this.state;
        // Leaving a plan view, the control that led there takes focus once
        // the views have rendered it (plan.md §5); else, at once, the heading,
        // so a key pressed straight away still reaches the shell.
        void this.updateComplete.then(() => {
          if (state.workflow === "none") return this.#focusHomeLauncher();
          if (previous.workflow !== "plan" && previous.workflow !== "draw" && previous.workflow !== "areaReview") return this.#focusPanel();
          requestAnimationFrame(() => {
            if (!this.#views.value?.focusPlanTarget(previous, state, this.renderRoot, isVisible)) this.#focusPanel();
          });
        });
      }
    }
  }

  // A refused shortcut run: the Run view home was standing in for takes the
  // panel (home and Run share a sheet height) and its heading takes focus.
  #revealRun(): void {
    this.#pinRun = null;
    this.requestUpdate();
    void this.updateComplete.then(() => this.#focusPanel());
  }

  // MS-AXE-02: a scroller that overflows with nothing inside to Tab to is
  // itself a tab stop, so a keyboard can scroll it. The pinned top is then a
  // group named by the h2; the body below it is already the region of that
  // name, and landmark names must be unique. A focused scroller
  // keeps its stop until it loses focus, so focus never falls to the page.
  #syncScrollers = (): void => {
    for (const scroller of this.renderRoot.querySelectorAll<HTMLElement>(SCROLLERS)) {
      const stop = scroller.scrollHeight > scroller.clientHeight && !hasFocusable(scroller);
      if (!stop && scroller.matches(":focus")) {
        scroller.addEventListener("blur", this.#syncScrollers, { once: true });
        continue;
      }
      const set = (name: string, value: string) => (stop ? scroller.setAttribute(name, value) : scroller.removeAttribute(name));
      set("tabindex", "0");
      if (scroller.classList.contains("panel-top")) {
        set("role", "group");
        set("aria-labelledby", "workspace-title");
      }
    }
  };

  // The heading, else the primary; in Full map neither shows, so the control
  // that leaves it, which Full map entry focuses too.
  #focusPanel(): void {
    [".panel-heading h2", ".action-bar .ms-btn--primary", ".workspace-toggle"]
      .map((selector) => this.renderRoot.querySelector<HTMLElement>(selector))
      .find(isVisible)?.focus({ preventScroll: true });
  }

  #brushLauncher(): HTMLElement | null {
    const own = this.renderRoot.querySelector<HTMLElement>(".draw-brush");
    if (isVisible(own)) return own;
    const canvas = this.renderRoot.querySelector<HTMLElement>(MAP_CANVAS_TAG);
    return canvas?.shadowRoot?.querySelector<HTMLElement>(".draw-brush") ?? null;
  }

  readonly #intent = (intent: WorkspaceIntent): void => {
    if (needsDraftConfirmation(this.state, intent)) {
      this.#pendingNavigation = intent;
      this.#intent({ type: "open-dialog", dialog: "discardDraft" });
      return;
    }
    this.#emit(intent);
  };

  #emit(intent: WorkspaceIntent): void {
    this.dispatchEvent(new CustomEvent<WorkspaceIntent>(WORKSPACE_INTENT_EVENT, {
      detail: intent,
      bubbles: true,
      composed: true,
    }));
  }

  #action(action: PrimaryAction): void {
    if (!action.enabled) return;
    if (action.id === "return-live") {
      this.#intent({ type: "set-history", historyId: null });
      return;
    }
    if (action.id === "redraw") {
      this.#intent({ type: "open-workflow", workflow: "draw" });
      return;
    }
    this.#dispatchAction(action.id);
  }

  // Opening a workflow any other way than from a home launcher clears the
  // launcher, so Back lands on the heading (home-rooms.md R18). Back does
  // not come through here.
  #workflow(workflow: Workflow, launcher?: EventTarget | null): void {
    this.#homeLauncher = null;
    this.#leave({ type: "open-workflow", workflow }, launcher);
  }

  #leave(intent: WorkspaceIntent, launcher?: EventTarget | null): void {
    // Retain a pointer launcher explicitly: Safari does not focus clicked
    // buttons, and the collapsed sheet's heading is not a visible fallback.
    if (launcher instanceof HTMLElement && needsDraftConfirmation(this.state, intent)) {
      this.#dialogLauncher = launcher;
    }
    this.#intent(intent);
  }

  // Once the floor is located, reopens the resumed workflow as a tap on its
  // entry row would, only while that row is offered; otherwise the user stays
  // on the entry screen. Opening anything first drops it.
  #resumeWorkflow(): void {
    const workflow = this.#resume;
    const { coherence, workflow: open } = this.state;
    if (!workflow || (open === "none" && (coherence === "booting" || coherence === "verifying"))) return;
    this.#resume = null;
    if (open !== "none") return;
    if (this.#launchers.has(workflow)) {
      this.#workflow(workflow as Workflow);
    } else if (workflow === "draw" && this.#launchers.has("areas")) {
      // A new drawing opens from Your areas' New area (UX9), so it resumes
      // the same road: Your areas, then Draw, with Back stepping through both.
      this.#workflow("areas");
      this.#homeLauncher = "areas";
      this.#intent({ type: "open-workflow", workflow: "draw" });
    }
  }

  // Every Try again (chunkStatus) reloads the page, which loses a dirty
  // draft, so it asks first, as every other way out of the workflow does.
  readonly #retry = (event: Event): void => {
    if (!needsDraftConfirmation(this.state, { type: "open-workflow", workflow: "none" })) {
      reloadInto(this.state.workflow);
      return;
    }
    this.#dialogLauncher = event.currentTarget as HTMLElement;
    this.#pendingNavigation = "reload";
    this.#intent({ type: "open-dialog", dialog: "discardDraft" });
  };

  // The worst of the chunks `workflow` needs, each requested as it opens.
  #tools(workflow: Workflow): ChunkStatus {
    this.#views.request();
    if (workflow !== "draw") return this.#views.status;
    this.#outline.request();
    const views = this.#views.status, outline = this.#outline.status;
    return views === "failed" || outline === "failed" ? "failed" : views === outline ? views : "loading";
  }

  #discardAndContinue(): void {
    const pending = this.#pendingNavigation;
    this.#pendingNavigation = null;
    if (pending === "reload") {
      reloadInto(this.state.workflow);
      return;
    }
    if (pending?.type === "select-plan" || pending?.type === "select-area") {
      this.#intent({ type: "patch-plan-draft", patch: { dirty: false } });
      this.#intent({ type: "patch-area-draft", patch: { dirty: false } });
      this.#intent({ type: "dismiss-top-layer" });
    } else {
      this.#intent({ type: "discard-draft" });
    }
    if (pending && pending.type !== "dismiss-top-layer") queueMicrotask(() => this.#emit(pending));
  }

  // shell.md §5: the save Discard changes? started has answered. Saved, the
  // dialog closes and the navigation that asked goes on without discarding;
  // not saved, it closes and the user stays with the draft. The answer comes
  // from inside the write, so this waits a task for the state it left.
  #dialogSaveSettled(token: object, saved: boolean): void {
    setTimeout(() => {
      if (this.#dialogSave !== token) return;
      this.#dialogSave = null;
      this.requestUpdate();
      const next = saved ? this.#pendingNavigation : null;
      this.#pendingNavigation = null;
      if (this.state.dialog !== "discardDraft") return this.#continue(next);
      this.#afterDialog = next;
      this.#dismissDialog();
    });
  }

  #continue(next: WorkspaceIntent | "reload" | null): void {
    if (next === "reload") reloadInto(this.state.workflow);
    // The draft this shell holds may still read dirty for a render, so the
    // intent skips the confirmation the saved draft no longer needs.
    else if (next) this.#emit(next);
  }

  #keepDraft(): void {
    // A save from the dialog is in flight; it closes the dialog itself.
    if (this.state.command === "pending" || this.#dialogSave) return;
    this.#pendingNavigation = null;
    this.#dismissDialog();
    this.#restoreSelectors();
  }

  #restoreSelectors(): void {
    void this.updateComplete.then(() => {
      const floor = this.renderRoot.querySelector<HTMLSelectElement>(".floor-switcher");
      if (floor) floor.value = this.state.selection.floorId;
      const robot = this.renderRoot.querySelector<HTMLSelectElement>(".robot-switcher");
      if (robot) robot.value = this.state.selection.entryId ?? "";
    });
  }

  #dismissDialog(): void {
    const launcher = this.#dialogReturn(this.state);
    this.#intent({ type: "dismiss-top-layer" });
    if (launcher) requestAnimationFrame(() => launcher.focus({ preventScroll: true }));
  }

  #dispatchAction(action: string | ResetCadenceAction | DeleteSharedCadenceAction, settled?: SaveSettled): void {
    this.dispatchEvent(new CustomEvent(WORKSPACE_ACTION_EVENT, {
      detail: typeof action === "string" ? { id: action, settled } : action,
      bubbles: true,
      composed: true,
    }));
  }

  // Every dialog but Discard changes? comes from the views, which confirm it.
  #confirmDialog(presentation: DialogPresentation): void {
    if (presentation.action === "discard") this.#discardAndContinue();
    else this.#views.value?.confirmDialog(this.state, presentation.action, this.#intent, (action) => this.#dispatchAction(action));
  }

  // ---- Bottom sheet -------------------------------------------------------

  #setDetent(detent: SheetDetent): void {
    if (this._helpOpen && this.#helpReturnsFull) detent = "peek";
    if (detent === this._sheetDetent) return;
    this._sheetDetent = detent;
    this.#announce("_polite", detent === "peek" ? this.#t("v4_workspace_height_peek", "Cleaning panel, collapsed")
      : detent === "half" ? this.#t("v4_workspace_height_half", "Cleaning panel, half height")
      : this.#t("v4_workspace_height_full", "Cleaning panel, full height"));
  }

  #detents(): readonly SheetDetent[] {
    return this._compact ? COMPACT_DETENTS : DETENTS;
  }

  #sheetStep(delta: 1 | -1, wrap = false): void {
    const detents = this.#detents();
    let next = detents.indexOf(this._sheetDetent) + delta;
    if (wrap && next >= detents.length) next = 0;
    this.#setDetent(detents[Math.max(0, Math.min(detents.length - 1, next))] ?? this._sheetDetent);
  }

  #detentHeights(sheet: HTMLElement): Readonly<Record<SheetDetent, number>> {
    const available = this.renderRoot.querySelector<HTMLElement>(".workspace")?.clientHeight
      ?? sheet.parentElement?.clientHeight
      ?? sheet.offsetHeight;
    const rem = parseFloat(getComputedStyle(this).fontSize) || 16;
    const chrome = [":scope>.sheet-grip", ":scope>.sheet-tools", ":scope>.action-bar"]
      .map((selector) => sheet.querySelector<HTMLElement>(selector)?.offsetHeight ?? 0)
      .reduce((sum, height) => sum + height, 0) + rem * 0.75;
    const full = this._compact ? available * 0.72 : Math.min(available * 0.92, available - rem * 9);
    const half = Math.min(available * 0.48, rem * 26, full);
    return { peek: Math.min(chrome, half), half, full };
  }

  #sheet(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(".mobile-sheet");
  }

  // A drag moves the sheet by transform only, so the toast, anchored to the
  // sheet's resting top edge, takes the same transform and rides with it.
  #translateSheet(sheet: HTMLElement, transform: string): void {
    sheet.style.transform = transform;
    const toast = this.renderRoot.querySelector<HTMLElement>("[data-notice-toast]");
    if (toast) toast.style.transform = transform;
  }

  #startsOnInteractiveSheetDescendant(event: PointerEvent): boolean {
    const currentTarget = event.currentTarget;
    for (const target of event.composedPath()) {
      if (target === currentTarget) return false;
      if (target instanceof Element && target.matches(INTERACTIVE_SHEET_SELECTOR)) return true;
    }
    return false;
  }

  #gripDown(event: PointerEvent): void {
    if (this.#helpReturnsFull) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (this.#startsOnInteractiveSheetDescendant(event)) return;
    const sheet = this.#sheet();
    if (!sheet || this.#drag) return;
    this.#drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: sheet.offsetHeight,
      heights: this.#detentHeights(sheet),
      samples: [{ y: event.clientY, t: event.timeStamp }],
      moved: false,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    sheet.classList.add("dragging");
  }

  #gripMove(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const sheet = this.#sheet();
    if (!sheet) return;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dy) > TAP_SLOP) drag.moved = true;
    drag.samples.push({ y: event.clientY, t: event.timeStamp });
    while (drag.samples.length > 2 && event.timeStamp - (drag.samples[1]?.t ?? 0) > FLICK_WINDOW_MS) drag.samples.shift();
    if (!drag.moved) return;
    // Positive = the sheet moves down. It may not rise above the full detent
    // or sink below peek. Translate, never resize: a height change here would
    // relayout the canvas on every frame.
    const min = drag.startHeight - drag.heights.full;
    const max = drag.startHeight - drag.heights.peek;
    const offset = Math.max(min, Math.min(max, dy));
    this.#translateSheet(sheet, `translateY(${offset}px)`);
  }

  #gripUp(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.#drag = null;
    const sheet = this.#sheet();
    if (sheet) {
      this.#translateSheet(sheet, "");
      sheet.classList.remove("dragging");
    }
    if (event.type === "pointercancel") return;
    if (!drag.moved) {
      this.#sheetStep(1, true);
      return;
    }
    const dy = event.clientY - drag.startY;
    const detents = this.#detents();
    const index = detents.indexOf(this._sheetDetent);
    const first = drag.samples[0];
    const last = drag.samples[drag.samples.length - 1];
    const velocity = first && last && last !== first ? (last.y - first.y) / Math.max(1, last.t - first.t) : 0;
    if (Math.abs(velocity) > FLICK_VELOCITY) {
      this.#setDetent(detents[Math.max(0, Math.min(detents.length - 1, index + (velocity < 0 ? 1 : -1)))] ?? this._sheetDetent);
      return;
    }
    const target = drag.startHeight - dy;
    let nearest: SheetDetent = this._sheetDetent;
    let distance = Number.POSITIVE_INFINITY;
    for (const detent of detents) {
      const gap = Math.abs(drag.heights[detent] - target);
      if (gap < distance) {
        distance = gap;
        nearest = detent;
      }
    }
    this.#setDetent(nearest);
  }

  // A swipe follows what the finger scrolls: the nearest scrollable ancestor
  // of where it starts inside the panel (the capped pinned top or the body).
  // It steps the sheet only while that scroller is at its top, or with none.
  #swipeScroller(event: PointerEvent): HTMLElement | null {
    for (const node of event.composedPath()) {
      if (node === event.currentTarget) break;
      if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight
        && /auto|scroll/u.test(getComputedStyle(node).overflowY)) return node;
    }
    return null;
  }

  #bodyDown(event: PointerEvent): void {
    if (event.pointerType === "mouse") return;
    if (this.#startsOnInteractiveSheetDescendant(event)) return;
    const scroller = this.#swipeScroller(event);
    this.#bodySwipe = scroller?.scrollTop ? null : {
      pointerId: event.pointerId,
      startY: event.clientY,
      scroller,
      consumed: false,
    };
  }

  #bodyMove(event: PointerEvent): void {
    const swipe = this.#bodySwipe;
    if (!swipe || swipe.consumed || event.pointerId !== swipe.pointerId) return;
    if (swipe.scroller?.scrollTop) {
      this.#bodySwipe = null;
      return;
    }
    if (event.clientY - swipe.startY < BODY_SWIPE_DISTANCE) return;
    swipe.consumed = true;
    this.#sheetStep(-1);
  }

  #bodyUp(): void {
    this.#bodySwipe = null;
  }

  // ---- App bar ------------------------------------------------------------

  #toggleNavigation(): void {
    this.dispatchEvent(new CustomEvent("hass-toggle-menu", {
      bubbles: true,
      composed: true,
    }));
  }

  #toggleWorkspace(event: Event): void {
    this.#workspaceLauncher = event.currentTarget as HTMLElement;
    if (this.state.fullMap) {
      this.#intent({ type: "exit-full-map" });
      return;
    }
    this.#intent({ type: "enter-full-map" });
    // The root, not .app: its dialogs and toasts are .app's siblings.
    Promise.resolve(this.renderRoot.querySelector<HTMLElement>(".root")?.requestFullscreen?.()).catch(() => undefined);
  }

  readonly #exitFullMap = (): void => {
    this.#intent({ type: "exit-full-map" });
  };

  // A failed menu load gets the chunk recovery every other chunk has.
  readonly #toggleOptions = (event: Event): void => {
    const options = this.#options.value;
    if (options) {
      options.menu.toggle();
      return;
    }
    if (this.#options.status === "failed") {
      this.#retry(event);
      return;
    }
    this.#optionsPending = true;
    this.#options.request();
  };

  readonly #openDiagnostics = (): void => {
    this.#workflow("support");
  };

  // The rail "?" toggles; Escape in the canvas while help shows closes.
  readonly #mapHelp = (event: Event): void => {
    if (this._helpOpen) this.#closeHelp(true);
    else this.#openHelp(event.composedPath()[0] as HTMLElement);
  };

  // Help owns its small lazy chunk, so opening it never loads workflow views.
  #openHelp(launcher: HTMLElement | null): void {
    this.#helpLauncher = launcher;
    this.#helpReturnsFull = !this.state.fullMap && this.#sheet()?.dataset.detent === "full";
    if (this.#helpReturnsFull) this.#setDetent("peek");
    this.#mapHelpView.request();
    this._helpOpen = true;
  }

  #closeHelp(restoreFocus: boolean): void {
    this._helpOpen = false;
    if (restoreFocus && this.#helpReturnsFull && this._sheetDetent === "peek") this.#setDetent("full");
    this.#helpReturnsFull = false;
    if (restoreFocus) this.#helpLauncher?.focus();
  }

  // Only the views send intents through here (dialog-copy.ts dialogLauncher).
  // A map tap in Rooms (R7) is announced once the host has handled the
  // intent and handed back the state (a task later, after its render): a
  // refused one repeats the reason on screen (the state is the same), an
  // accepted one names the change. The list's own controls speak for
  // themselves. This relies on the host dispatching the intent to its store
  // synchronously in its listener and setting `state` in its own render (a
  // microtask), so a macrotask always sees the handed-back state.
  readonly #mapIntent = (event: Event): void => {
    const intent = (event as CustomEvent<WorkspaceIntent>).detail;
    const before = this.state;
    if (before.workflow !== "rooms" || intent?.type !== "toggle-room") return;
    setTimeout(() => {
      const text = this.#views.value?.roomTapAnnouncement(this.#t, before, this.state, intent.roomId);
      if (text) this.#announce("_polite", text);
    });
  };

  #captureDialogLauncher(event: Event): void {
    const launcher = this.#views.value?.dialogLauncher(event, this.state, this.#intent);
    if (launcher) this.#dialogLauncher = launcher;
  }

  // Focus after a dialog: its launcher, else where the views say (a schedule
  // Reset's room), else the dialog's launcher found again.
  #dialogReturn(state: WorkspaceState): HTMLElement | null {
    if (!state.dialog) return null;
    return this.#dialogLauncher?.isConnected && this.#dialogLauncher.hasAttribute("data-dialog-launcher")
      ? this.#dialogLauncher
      : this.#views.value?.dialogReturnTarget(state, this.renderRoot) ?? this.#dialogLauncherFor(state.dialog);
  }

  #dialogLauncherFor(dialog: NonNullable<WorkspaceState["dialog"]>): HTMLElement | null {
    if (dialog === "confirmDeletePlan") {
      const tools = this.renderRoot.querySelector<HTMLElement>(PLAN_TOOLS_TAG);
      const launcher = tools?.shadowRoot?.querySelector<HTMLElement>(`[data-dialog-launcher="${dialog}"]`);
      if (launcher) return launcher;
    }
    const workflow = this.renderRoot.querySelector<HTMLElement>(WORKFLOW_TAG);
    return workflow?.shadowRoot?.querySelector<HTMLElement>(
      `[data-dialog-launcher="${dialog}"]`,
    ) ?? null;
  }

  #keyboard(event: KeyboardEvent): void {
    if (isNativeSelectControl(event)) return;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (this.#options.value?.menu.open) {
      this.#options.value.menu.close(true);
      return;
    }
    if (this._helpOpen) {
      this.#closeHelp(true);
      return;
    }
    if (this.state.dialog === "discardDraft") {
      this.#keepDraft();
      return;
    }
    this.#intent({ type: "dismiss-top-layer" });
  }

  #dialogKeyboard(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget as HTMLElement;
    const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusables[0];
    const last = focusables.at(-1);
    if (!first || !last) return;
    const active = this.shadowRoot?.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  #skipToMap(): void {
    const canvas = this.renderRoot.querySelector<HTMLElement>(MAP_CANVAS_TAG);
    const root = canvas?.shadowRoot?.querySelector<HTMLElement>(".map-root");
    (root ?? canvas)?.focus();
  }

  #skipToWorkspace(): void {
    if (this._sheetDetent === "peek" && this.#sheet()) this.#setDetent(this._compact ? "full" : "half");
    void this.updateComplete.then(() => this.#focusPanel());
  }

  // ---- Templates ----------------------------------------------------------

  #actionButton(action: PrimaryAction | NoButtonAction, classes: string, reasonId: string) {
    if (!("label" in action)) return nothing;
    const label = action.labelKey ? this.#t(action.labelKey, action.label, action.labelPlaceholders) : action.label;
    const reason = !action.enabled && action.reason
      ? (action.reasonKey
        ? this.#views.value?.actionReason(this.#t, action, reasonId === "primary-reason", this.#intent)
          ?? this.#t(action.reasonKey, action.reason, action.reasonPlaceholders)
        : action.reason)
      : null;
    // A link primary opens its page itself (home-rooms.md D2).
    if (action.kind === "link") return html`<a class=${classes} href=${action.href ?? "#"}>${label}</a>`;
    return html`
      <button
        class=${`${classes} ${action.kind === "danger" ? "ms-btn--danger" : ""}`}
        type="button"
        aria-disabled=${action.enabled ? nothing : "true"}
        aria-describedby=${reason ? reasonId : nothing}
        data-redraw=${action.id === "redraw" ? "" : nothing}
        aria-label=${action.id === "stop" ? this.#t("v4_stop_cleaning_label", "Stop cleaning")
          : action.id === "run-plan" ? this.#t("v4_action_run_plan_named", "Run plan {plan}", { plan: this.state.planDraft.name })
          : nothing}
        @click=${() => this.#action(action)}
      >${label}</button>
      ${reason ? html`<p class="action-reason" id=${reasonId}>${reason}</p>` : nothing}
    `;
  }


  #actionBar(state: WorkspaceState, primary: PrimaryAction | NoButtonAction | null, secondary: PrimaryAction | null) {
    // The rooms in run order, then the dock (home-rooms.md §5 Clean).
    const summary = primary?.enabled && state.workflow === "rooms" && primary.id === "clean-rooms"
      ? this.#views.value?.roomsSummary(this.#t, state) ?? ""
      : "";
    const editing = state.workflow === "plan" && state.planView === "edit";
    // Draw pairs Cancel with its primary too, unless Stop holds the bar's
    // second place (shell.md §3); Back in the heading then keeps the exit.
    const drawing = state.workflow === "draw" && !secondary;
    // The area review pairs Redraw, first, with its primary (map-surfaces.md §4).
    const reviewing = secondary?.id === "redraw";
    // No bar when it would be empty: idle home has none (home-rooms.md §3).
    if (!summary && !editing && !drawing && !(primary && "label" in primary) && !secondary) return nothing;
    const leave = (intent: WorkspaceIntent, launcher: EventTarget | null) => this.#leave(intent, launcher);
    const second = secondary ? this.#actionButton(secondary, "ms-btn ms-btn--block ms-btn--lg ms-btn--secondary", "secondary-reason") : nothing;
    return html`
      <div class=${editing || drawing || reviewing ? "action-bar paired" : "action-bar"}>
        ${summary ? html`<p class="action-summary">${summary}</p>` : nothing}
        ${editing ? this.#views.value?.planCancel(state, primary, this.#t, leave) : drawing ? this.#views.value?.drawCancel(state, this.#t, leave) : nothing}
        ${reviewing ? second : nothing}
        ${primary ? this.#actionButton(primary, "ms-btn ms-btn--block ms-btn--lg ms-btn--primary", "primary-reason") : nothing}
        ${reviewing ? nothing : second}
      </div>
    `;
  }

  // An entry row's tap; an enabled row also records it for a resumed Try again,
  // and the press records which launcher takes focus back.
  #launch(workflow: Workflow, disabled = false, launcher: string = workflow): () => void {
    if (!disabled) this.#launchers.add(workflow);
    return () => {
      if (disabled) return;
      this.#workflow(workflow);
      this.#homeLauncher = launcher;
    };
  }

  // Back on home: the launcher that opened the workflow, if it is still shown,
  // else the heading (shell.md §5 Focus).
  #focusHomeLauncher(): void {
    const key = this.#homeLauncher;
    this.#homeLauncher = null;
    const target = key ? this.renderRoot.querySelector<HTMLElement>(`[data-launcher="${CSS.escape(key)}"]`) : null;
    if (isVisible(target)) target.focus({ preventScroll: true });
    else this.#focusPanel();
  }

  // `described` links a held control to the home reason, which only the held
  // home states render (R12), so a row disabled on its own never points at it.
  #shelfRow(label: string, glyph: string, workflow: Workflow, detail?: string, disabled = false, described = false, classes = "ms-row") {
    return html`
      <button
        class=${classes}
        type="button"
        data-launcher=${workflow}
        aria-disabled=${disabled ? "true" : nothing}
        aria-describedby=${described ? "home-reason" : nothing}
        @click=${this.#launch(workflow, disabled)}
      >
        <span class="ms-row__lead">${icon(glyph)}</span>
        <span class="ms-row__body"><strong>${label}</strong>${detail ? html`<small>${detail}</small>` : nothing}</span>
        <span class="ms-row__trail">${icon(iconChevronRight, { directional: true })}</span>
      </button>
    `;
  }

  #floorSwitcher(state: WorkspaceState) {
    const historyFloors = state.resources.history.value?.floors || [];
    const floorChoices = historyFloors.length
      ? historyFloors.map((floor, index) => ({
        id: floor.active ? "current" : floor.id,
        label: `${floor.label || (floor.active
          ? this.#t("v4_current_floor", "Current floor")
          : this.#t("v4_saved_floor", "Saved floor {number}", { number: floor.ordinal ?? index + 1 }))}${
          !floor.active && floor.snapshots.length === 0
            ? ` · ${this.#t("v4_floor_not_captured", "No saved map for this floor yet")}`
            : ""
        }`,
        disabled: !floor.active && floor.snapshots.length === 0,
      }))
      : [{ id: state.selection.floorId, label: state.floor.displayName, disabled: false }];
    return html`
      <select
        class="ms-select context-switcher floor-switcher"
        slot="floor"
        data-map-control
        name="map-floor"
        aria-label=${this.#t("v4_choose_floor", "Choose floor")}
        ?disabled=${floorChoices.length <= 1}
        .value=${state.selection.floorId}
        @change=${(event: Event) => this.#intent({
          type: "set-floor",
          floorId: (event.currentTarget as HTMLSelectElement).value,
        })}
      >${floorChoices.map((floor) => html`
        <option value=${floor.id} ?selected=${floor.id === state.selection.floorId} ?disabled=${floor.disabled}>${floor.label}</option>
      `)}</select>
    `;
  }

  // Home (home-rooms.md §3): the heading and description come from homeCopy;
  // this is the body under them. Cards are demoted, never hidden, while the
  // robot is busy or the map is not ready, and they share the one reason the
  // description states (MS-HOME-03). Maps keeps history and diagnostics one
  // tap away; a map or robot problem lists diagnostics first.
  #entry(state: WorkspaceState) {
    const t = this.#t;
    this.#launchers = new Set(["support"]);
    const kind = homeState(state);
    // Built where shown, so only a shown row counts as a launcher.
    const maps = (diagnosticsFirst: boolean) => {
      const history = this.#shelfRow(t("v4_map_history", "Map history"), iconHistory, "history", t("v4_history_quick_detail", "Browse earlier floor maps."));
      const diagnostics = this.#shelfRow(t("v4_map_diagnostics", "Map diagnostics"), iconDiagnostics, "support", t("v4_diagnostics_quick_detail", "Check the map and copy details for support."));
      return html`
        <h3 class="ms-section-heading">${t("v4_maps_heading", "Maps")}</h3>
        <div class="shelf maps">${diagnosticsFirst ? [diagnostics, history] : [history, diagnostics]}</div>
      `;
    };
    switch (kind) {
      case "administrator":
      case "robot-unavailable":
      case "setup":
        return nothing;
      case "reconnecting":
      case "offline":
      case "read-only":
        if (canShowLiveMap(state) && state.host.robotCount > 0 && !isSelectedRobotUnavailable(state)) break;
        return kind === "reconnecting" ? nothing : maps(false);
      case "problem":
        return html`
          <div class="home-actions">
            <button class="ms-btn ms-btn--secondary" type="button" data-launcher="support-open" @click=${this.#launch("support", false, "support-open")}>${t("v4_open_diagnostics", "Open map diagnostics")}</button>
          </div>
          ${maps(true)}
        `;
      default:
        break;
    }
    const held = kind !== "ready";
    const retry = kind === "map-unavailable" || kind === "map-limited" ? html`
      <div class="home-actions">
        <button class="ms-btn ms-btn--secondary" type="button"
          aria-disabled=${state.rechecking ? "true" : nothing}
          @click=${() => { if (!this.state.rechecking) this.#dispatchAction("recheck-status"); }}
        >${t("v4_retry", "Try again")}</button>
      </div>` : nothing;
    const priorityMaps = held ? maps(kind === "map-unavailable") : nothing;
    const pins = state.homePins.pins;
    const waiting = (status: string) => status === "idle" || status === "loading";
    const pending = waiting(state.homePins.status) || state.homePins.status === "ready" && pins.some((pin) =>
      pin.kind === "plan"
        ? waiting(state.resources.plans.status) && !state.resources.plans.value?.plans.some((plan) => plan.id === pin.id)
        : waiting(state.resources.areas.status) && !state.resources.areas.value?.areas.some((area) => area.id === pin.id));
    const plans = readyPlans(state);
    const noRooms = plans !== null && plans.rooms.length === 0;
    const roomsDisabled = held || noRooms;
    // A card disabled on its own (no named rooms) carries its reason in its
    // detail; a held one is described by the home reason.
    const card = (launcher: Workflow, featured: boolean, glyph: string, disabled: boolean, title: string, detail: string) =>
      this.#shelfRow(title, glyph, launcher, detail, disabled, held, featured ? "ms-row ms-row--card ms-row--featured" : "ms-row ms-row--card");
    // Pinned shortcuts start cleaning in one tap, so they get their own
    // section first (owner, 2026-10-14); the cards below open a screen.
    const shortcuts = pending ? nothing : this.#shortcuts(state, held);
    return html`
      ${retry}
      ${priorityMaps}
      ${pending ? html`
        <div class="home-actions" role="status"><p>${t("v4_shortcuts_loading_catalogs", "Loading your saved home choices…")}</p></div>
      ` : html`
      ${shortcuts === nothing ? nothing : html`${shortcuts}<h3 class="ms-section-heading">${t("v4_more_ways_heading", "More ways to clean")}</h3>`}
      <div class="quick-actions" role="group" aria-label=${t("v4_cleaning_choices", "Cleaning choices")}>
        ${card("rooms", shortcuts === nothing, iconRobot, roomsDisabled,
          t("v4_clean_rooms", "Clean rooms"),
          !held && noRooms ? t("v4_no_rooms_reason", "Can't clean rooms until you name them in the Matic app.") : t("v4_rooms_quick_detail", "Pick rooms and clean them now."))}
        ${card("areas", false, iconNewArea, held,
          t("v4_custom_areas", "Clean custom area"),
          t("v4_areas_quick_detail", "Draw or choose a custom area"))}
        ${this.#shelfRow(t("v4_your_plans", "Your plans"), iconPlan, "plans", undefined, held, held)}
      </div>
      ${held ? nothing : maps(false)}
      `}
    `;
  }

  // The saved plans and areas this user pinned (owner, 2026-10-13), drawn by
  // the views chunk, which loads only when there is a shortcut or a failed
  // read to show. A shortcut's tap is its screen's own primary action.
  #shortcuts(state: WorkspaceState, held: boolean) {
    const { status, pins } = state.homePins;
    const owner = state.owner && state.selection.entryId ? JSON.stringify([state.owner.userKey, state.selection.entryId]) : null;
    if (owner !== this.#shortcutsOwner || !pins.length) this.#editingHomeShortcuts = false;
    this.#shortcutsOwner = owner;
    if (status !== "error" && !pins.length) return nothing;
    this.#views.request();
    return this.#views.value?.homeShortcuts({
      state,
      t: this.#t,
      held,
      editing: this.#editingHomeShortcuts,
      canReorder: state.resources.plans.status === "ready" && state.resources.areas.status === "ready",
      toggleEditing: () => { this.#editingHomeShortcuts = !this.#editingHomeShortcuts; this.requestUpdate(); },
      move: (pin, direction) => {
        this.#intent({ type: "move-home-pin", pin, direction });
        return this.updateComplete.then(() => undefined);
      },
      emit: this.#intent,
      run: (pin: HomePin) => {
        // Run plan needs its Run view (effects.ts run-plan), which home
        // stands in for until the run starts. Clean this area runs from here.
        if (pin.kind === "plan") {
          this.#pinRun = pin.id;
          this.#intent({ type: "select-plan", planId: pin.id, origin: "home" });
        } else this.#intent({ type: "select-area", areaId: pin.id });
        this.#homeLauncher = `run:${pin.kind}:${pin.id}`;
        this.#dispatchAction(pin.kind === "plan" ? "run-plan" : "run-area");
      },
    }) ?? nothing;
  }

  #workflowBody(state: WorkspaceState, narrow: boolean) {
    if (state.workflow === "none") return this.#entry(state);
    const tools = this.#tools(state.workflow);
    if (tools !== "ready") {
      // A phone's draw sheet rests at peek, with the body below it, so the
      // line, loading or failed, sits in .sheet-tools, above the drawing tools
      // so they stay put when it goes.
      return narrow && state.workflow === "draw"
        ? nothing
        : chunkStatus(tools, this.localize, this.#retry);
    }
    return html`<${workflowTag}
      .state=${state}
      .localize=${this.localize}
      .dates=${this.dates}
      .retry=${this.#retry}
      .narrow=${narrow}
      @matic-workspace-intent=${this.#captureDialogLauncher}
    ></${workflowTag}>`;
  }

  // The heading and notice slot sit outside the scroller, so they stay put
  // and never cover a control the body scrolls into view.
  // The back chevron, in the heading or, at peek, the grip. Run goes back to
  // the picker, every other workflow to all tasks; Edit has none, since
  // Cancel replaces it (plan.md §3).
  // Back from Run goes to where the plan was opened from: the picker, or home
  // for the home plan card (home-rooms.md §5 Cards; plan.md §5 Navigation).
  #back(state: WorkspaceState, grip: boolean) {
    if (state.workflow === "none" || (state.workflow === "plan" && state.planView === "edit")) return nothing;
    const plan = state.workflow === "plan" && state.planOrigin !== "home";
    const area = state.workflow === "draw" && state.areaDraft.id !== null ? state.areaDraft.name : null;
    // An area's screen and a new drawing step back to Your areas.
    const areas = area === null && (state.workflow === "areaReview" || state.workflow === "draw");
    const name = plan ? this.#t("v4_back_to_plans", "Back to plans")
      : area !== null ? this.#t("v4_back_to_area", "Back to {name}", { name: area })
        : areas ? this.#t("v4_back_to_areas", "Back to areas")
          : this.#t("v4_back_to_all_tasks", "Back to all tasks");
    return html`
      <button
        class=${grip ? "sheet-back ms-btn ms-btn--icon ms-btn--sm" : "panel-back ms-btn ms-btn--secondary"}
        type="button"
        aria-label=${name}
        title=${grip ? name : nothing}
        data-dialog-launcher="discardDraft"
        @click=${(event: Event) => this.#leave(
          plan || areas ? { type: "open-workflow", workflow: plan ? "plans" : "areas" }
            : area !== null ? { type: "select-area", areaId: state.areaDraft.id, workflow: "areaReview" }
              : { type: "open-workflow", workflow: "none" },
          event.currentTarget,
        )}
      >${icon(iconBack, { directional: true })}${grip ? nothing : html`<span class="ms-btn__label">${plan ? this.#t("v4_your_plans", "Your plans") : area !== null ? html`<bdi>${area}</bdi>` : areas ? this.#t("v4_your_areas", "Your areas") : this.#t("v4_all_tasks", "All tasks")}</span>`}</button>
    `;
  }

  #panelTop(state: WorkspaceState) {
    const plan = state.workflow === "plan";
    const title = workflowCopy(state, this.localize).title;
    return html`
      <div class="panel-top">
        <div class="panel-heading">
          ${this.#back(state, false)}
          <h2 id="workspace-title" tabindex="-1">${(plan && this.#views.value?.planTitle(state, title, this.#t)) || (state.workflow === "areaReview" && state.areaDraft.id !== null ? html`<bdi>${title}</bdi>` : title)}</h2>
          ${plan ? this.#views.value?.planTools(state, this.localize, this.#captureDialogLauncher) : nothing}
        </div>
        ${state.notice ? html`<div class="notice" data-notice-slot data-tone=${state.notice.tone}>${this.#noticeBody(state.notice, this.#closeNotice, this.#t("v4_close", "Close"))}</div>` : nothing}
      </div>
    `;
  }

  #panel(state: WorkspaceState, narrow: boolean) {
    const { description } = workflowCopy(state, this.localize);
    // Home's demoted cards are described by this one line (home-rooms.md §4).
    return html`
      ${description ? html`<p class="panel-description" id=${state.workflow === "none" ? "home-reason" : nothing}>${description}</p>` : nothing}
      ${this.#workflowBody(state, narrow)}
    `;
  }

  #sheetStatus(state: WorkspaceState, status: StatusPresentation): string {
    const workflow = workflowCopy(state, this.localize);
    const line = (state.workflow === "rooms" ? this.#views.value?.roomsGripLine(this.#t, state) : null) ?? workflow.title;
    // With the body open the h2 already names the workflow, so the grip line
    // carries the robot instead of repeating the title directly above it.
    if (this._sheetDetent !== "peek") return status.detail ? `${status.title} · ${status.detail}` : status.title;
    return status.notable ? `${status.title} · ${line}` : line;
  }

  // Keep a single workflow panel: the same element is a wide grid column or
  // narrow bottom sheet. Duplicate hidden panels break launcher focus return
  // and make primary actions ambiguous.
  protected override render() {
    // Home stands in for the Run view while a shortcut's run starts (#pinRun).
    const state: WorkspaceState = this.#pinRun ? { ...this.state, workflow: "none" } : this.state;
    const narrow = this._measuredNarrow ?? state.narrowHint;
    const compact = narrow && this._compact;
    const options = this.#options.value;
    const status = statusCopy(state, this.localize, this.dates);
    const selectedRobotUnavailable = isSelectedRobotUnavailable(state);
    const primary = selectPrimaryAction({ ...state, narrowHint: narrow });
    // Stop takes the bar when work is stoppable (shell.md §3) and Redraw moves
    // into the body; else the area review pairs Redraw with its primary, held
    // with the R12 reason (map-surfaces.md §4).
    const held = heldReasonKey(state);
    const redraw: PrimaryAction | null = state.workflow === "areaReview" && !hasStoppableWork(state)
      ? { id: "redraw", label: "Redraw", labelKey: "v4_edit_outline", kind: "neutral", enabled: !held, ...(held ?? {}) }
      : null;
    const secondary = selectStopSecondaryAction(state) ?? redraw;
    const statusAction = !narrow && primary.id === "stop"
      ? primary
      : !narrow && secondary?.id === "stop" ? secondary : null;
    const footerPrimary = statusAction && statusAction === primary ? null : primary;
    const footerSecondary = statusAction && statusAction === secondary ? null : secondary;
    const locatingInFullMap = state.fullMap
      && (state.coherence === "verifying" || state.coherence === "booting");
    // The one Draw hint, above the sheet's tool rows so it reads at peek. The
    // sheet grows upwards, so its arrival with the views chunk moves no tool.
    const sheetHint = narrow && state.workflow === "draw" && this.#views.value?.drawHint(this.#t, state);
    const canToggleWorkspace = state.fullMap || (
      state.host.administrator && state.host.robotCount > 0 && state.map.available
    );
    const plan = state.workflow === "plan";
    // The shell asks before a draft is lost, so its copy is here: a draft can
    // be dirty in Draw while the views chunk failed. Every other dialog opens
    // from a control in the views chunk, which carries its copy.
    const discard = state.dialog === "discardDraft";
    // shell.md §5: the saved plan or area by its saved name, else a new one.
    const saved = discard ? deleteSubject(state, plan ? "confirmDeletePlan" : "confirmDeleteArea")?.name : undefined;
    const dialog: DialogPresentation | undefined = discard ? {
      title: this.#t("v4_discard_title", "Discard changes?"),
      detail: saved === undefined
        ? plan
          ? this.#t("v4_discard_new_plan_detail", "This new plan hasn't been saved, and discarding it can't be undone.")
          : this.#t("v4_discard_new_area_detail", "This new area hasn't been saved, and discarding it can't be undone.")
        : plan
          ? this.#t("v4_discard_plan_detail", "Your changes to \"{name}\" haven't been saved, and discarding them can't be undone.", { name: saved })
          : this.#t("v4_discard_area_detail", "Your changes to \"{name}\" haven't been saved, and discarding them can't be undone.", { name: saved }),
      cancelLabel: this.#t("v4_keep_area_editing", "Keep editing"),
      confirmLabel: this.#t("v4_discard", "Discard"),
      action: "discard",
    } : state.dialog === null ? undefined : this.#views.value?.dialogCopy(state.dialog, state, this.localize);
    // Discard changes? offers the save the primary would make, and holds every
    // button while that save is in flight.
    const busy = discard && (state.command === "pending" || this.#dialogSave !== null);
    const save = discard && (primary.id === "save-plan" || primary.id === "save-area") && (primary.enabled || busy) ? primary.id : null;
    // The HUD takes the sheet's band in Full map, so the rail, dock and
    // scale lift above it as they do above the sheet (nothing is covered).
    const sheetOffset = state.fullMap ? "--map-sheet-offset:calc(var(--ms-control-lg) + 3 * var(--ms-space-3))"
      : narrow ? `--map-sheet-offset:${this._sheetOffset}px` : "--map-sheet-offset:0px";
    const showDrawTools = narrow && state.workflow === "draw";
    const help = !this._helpOpen ? null : this.#mapHelpView.value
      ? this.#mapHelpView.value.renderMapHelp({ state, coarse: window.matchMedia("(any-pointer: coarse)").matches, t: this.#t, close: () => this.#closeHelp(true) })
      : chunkStatus(this.#mapHelpView.status, this.localize, this.#retry);
    const precisionOpen = state.precisionOpen && state.workflow === "draw";
    // Success and error always toast; info and warning only while the slot is
    // off-screen (sheet at peek, or Full map).
    const toast = this._toast && (this._toast.tone === "success" || this._toast.tone === "error"
      || state.fullMap || (narrow && this._sheetDetent === "peek")) ? this._toast : null;
    return html`
      <div class=${`root ${narrow ? "narrow" : "wide"}${compact ? " compact" : ""}`} ?data-dock=${!narrow && state.workflow === "draw"} @keydown=${this.#keyboard}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#skipToMap}>${this.#t("v4_skip_to_map", "Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#skipToWorkspace}>${this.#t("v4_skip_to_workspace", "Skip to the panel")}</button>
        <div class="app" ?inert=${Boolean(dialog)}>
          <header class="app-bar">
            <button
              class="nav nav--menu ms-btn ms-btn--icon"
              type="button"
              aria-label=${this.#t("v4_open_navigation", "Open Home Assistant sidebar")}
              title=${this.#t("v4_open_navigation", "Open Home Assistant sidebar")}
              @click=${this.#toggleNavigation}
            >${icon(iconMenu)}</button>
            <h1 class="title">${this.#t("map_studio_title", "Matic Map")}</h1>
            ${state.robots.length > 1 || selectedRobotUnavailable ? html`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                aria-label=${this.#t("v4_choose_robot", "Choose robot")}
                .value=${state.selection.entryId || ""}
                @change=${(event: Event) => this.#intent({
                  type: "select-entry",
                  entryId: (event.currentTarget as HTMLSelectElement).value,
                })}
              >${selectedRobotUnavailable ? html`
                <option value=${state.selection.entryId || ""} selected disabled>${this.#t("v4_selected_robot_unavailable", "Selected robot unavailable")}</option>
              ` : nothing}${state.robots.map((robot) => html`
                <option value=${robot.entryId} ?selected=${robot.entryId === state.selection.entryId}>${robot.label}</option>
              `)}</select>
            ` : nothing}

            <span class="spacer"></span>
            ${canToggleWorkspace ? html`
              <button
                class="workspace-toggle ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#t("v4_full_map", "Full map")}
                aria-pressed=${String(state.fullMap)}
                title=${this.#t("v4_full_map", "Full map")}
                @click=${this.#toggleWorkspace}
              >${icon(iconFullMap)}</button>
            ` : nothing}
            <div class="overflow-wrap" @keydown=${options?.menu.keydown} @focusout=${options?.menu.focusout}>
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#t("v4_map_options", "Map options")}
                aria-haspopup="menu"
                aria-expanded=${String(options?.menu.open ?? false)}
                aria-controls="map-options"
                @click=${this.#toggleOptions}
              >${icon(iconOverflow)}</button>
              ${options?.menu.open ? options.render({
                state,
                narrow,
                t: this.#t,
                intent: this.#intent,
                diagnostics: this.#openDiagnostics,
              }) : nothing}
            </div>
          </header>

          <main class=${`workspace ${state.fullMap ? "full-map" : ""}`} style=${sheetOffset}>
            <div class="canvas">
              <${mapCanvasTag}
                class="map-canvas"
                style=${sheetOffset}
                @matic-workspace-intent=${this.#mapIntent}
                @matic-map-help=${this.#mapHelp}
                .state=${state}
                .scheme=${this.scheme}
                .localize=${this.localize}
                .dates=${this.dates}
                .outlineEditor=${this.#outline.value}
                .narrow=${narrow}
                ?data-short=${compact && !state.fullMap && this._sheetDetent === "full"}
                .help=${help}
                .recipes=${state.workflow === "draw" ? this.#views.value?.drawRecipes(this.#t) ?? null : null}
              >${this.#floorSwitcher(state)}
                ${narrow && !state.fullMap && this._sheetDetent === "full" ? html`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#t("v4_collapse_sheet", "Collapse panel")}
                    @click=${() => this.#setDetent("peek")}
                  ></button>
                ` : nothing}
              </${mapCanvasTag}>
            </div>

            <aside
              id="map-workspace"
              class=${narrow ? "inspector mobile-sheet" : "inspector"}
              data-detent=${narrow ? this._sheetDetent : nothing}
              data-workflow=${state.workflow}
              aria-label=${this.#t("v4_map_workspace", "Cleaning panel")}
            >
              ${narrow ? html`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#gripDown}
                  @pointermove=${this.#gripMove}
                  @pointerup=${this.#gripUp}
                  @pointercancel=${this.#gripUp}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${this._sheetDetent === "peek" ? this.#back(state, true) : nothing}
                  <span class="sheet-status">${this.#sheetStatus(state, status)}</span>
                  ${compact ? this.#actionBar(state, footerPrimary, footerSecondary) : nothing}
                  ${/* step is always +1 or -1 */ (compact ? [this._sheetDetent === "full" ? -1 : 1] as const : [1, -1] as const).map((step) => html`<button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${step < 0 ? this.#t("v4_show_less", "Collapse panel") : this.#t("v4_show_more", "Expand panel")}
                    aria-controls="sheet-panel"
                    ?disabled=${this.#helpReturnsFull || this._sheetDetent === (step < 0 ? "peek" : "full")}
                    @click=${() => this.#sheetStep(step)}
                  >${icon(step < 0 ? iconChevronDown : iconChevronUp)}</button>`)}
                </div>
                ${showDrawTools ? html`
                  <div class="sheet-tools">
                    ${chunkStatus(this.#tools("draw"), this.localize, this.#retry)}
                    ${sheetHint ? html`<p class="draw-hint sheet-hint">${sheetHint}</p>` : nothing}
                    ${precisionOpen ? html`<${precisionControlsTag} class="sheet-precision" .state=${state} .localize=${this.localize}></${precisionControlsTag}>` : nothing}
                    ${renderDrawTools(state, { intent: this.#intent, openBrush: () => this.#intent({ type: "set-precision-open", value: !this.state.precisionOpen }), t: this.#t }, "grid")}
                  </div>
                ` : nothing}
                <div
                  class="sheet-panel"
                  id="sheet-panel"
                  @pointerdown=${this.#bodyDown}
                  @pointermove=${this.#bodyMove}
                  @pointerup=${this.#bodyUp}
                  @pointercancel=${this.#bodyUp}
                >
                  ${this.#panelTop(state)}
                  <div class="sheet-body" role="region" aria-labelledby="workspace-title">${this.#panel(state, narrow)}</div>
                </div>
                ${compact ? nothing : this.#actionBar(state, footerPrimary, footerSecondary)}
              ` : html`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${icon(status.icon)}</span>
                  <span class="status-copy"><strong>${status.title}</strong>${status.detail ? html`<small>${status.detail}</small>` : nothing}</span>
                  ${statusAction
                    ? this.#actionButton(statusAction, "status-action ms-btn ms-btn--secondary", "status-reason")
                    : nothing}
                </div>
                <section class="workflow">
                  ${this.#panelTop(state)}
                  <div class="workflow-body" role="region" aria-labelledby="workspace-title">${this.#panel(state, narrow)}</div>
                  ${this.#actionBar(state, footerPrimary, footerSecondary)}
                </section>
              `}
            </aside>

            ${state.fullMap ? html`
              <section
                class="full-map-hud ms-surface ms-surface--floating"
                aria-label=${this.#t("v4_robot_status_and_action", "Robot status and action")}
              >
                <span class="hud-copy"><strong>${status.title}</strong><small>${status.detail}</small></span>
                ${locatingInFullMap && primary.id !== "stop" ? nothing : this.#actionButton(primary, "ms-btn ms-btn--lg ms-btn--primary", "hud-reason")}
                ${secondary?.id === "stop"
                  ? this.#actionButton(secondary, "ms-btn ms-btn--lg ms-btn--secondary", "hud-secondary-reason")
                  : nothing}
                <button
                  class="hud-exit ms-btn ms-btn--lg ms-btn--secondary"
                  type="button"
                  title=${this.#t("v4_exit_full_map", "Exit full map")}
                  @click=${this.#exitFullMap}
                >${icon(iconExitFullMap)}<span class="ms-btn__label">${this.#t("v4_exit_full_map", "Exit full map")}</span></button>
              </section>
            ` : nothing}
          </main>
        </div>

        <div
          class="notice notice-toast"
          data-notice-toast
          role="region"
          aria-label=${this.#t("v4_notifications", "Notifications")}
          data-tone=${toast?.tone ?? nothing}
          style=${sheetOffset}
          ?hidden=${!toast}
          ?inert=${Boolean(dialog)}
          @pointerenter=${this.#holdToast}
          @focusin=${this.#holdToast}
          @pointerleave=${this.#releaseToast}
          @focusout=${this.#releaseToast}
        >${toast ? this.#noticeBody(toast, this.#closeToast, this.#t("v4_hide_notification", "Hide notification")) : nothing}</div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${this._polite}</div>
        <div class="sr-only" role="alert" aria-atomic="true">${this._alert}</div>

        ${dialog ? html`
          <div class="dialog-backdrop">
            <section
              class="dialog ms-surface ms-surface--overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-detail"
              @keydown=${this.#dialogKeyboard}
            >
              <h2 id="dialog-title">${discard ? html`<bdi dir="auto">${dialog.title}</bdi>` : dialog.title}</h2>
              <div id="dialog-detail">
                <p>${dialog.detail}</p>
                ${dialog.consequence ? html`<p>${dialog.consequence}</p>` : nothing}
                ${busy ? html`<p id="dialog-saving" role="status">${this.#t("v4_notice_saving", "Saving…")}</p>` : nothing}
              </div>
              <div class="dialog-actions">
                <button
                  class=${discard ? "ms-btn" : "ms-btn ms-btn--secondary"}
                  type="button"
                  data-dialog-initial-focus
                  aria-disabled=${busy ? "true" : nothing}
                  aria-describedby=${busy ? "dialog-saving" : nothing}
                  @click=${discard ? this.#keepDraft : this.#dismissDialog}
                >${dialog.cancelLabel}</button>
                ${save ? html`<button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  aria-disabled=${busy ? "true" : nothing}
                  aria-describedby=${busy ? "dialog-saving" : nothing}
                  @click=${() => {
                    if (busy) return;
                    const token = {};
                    this.#dialogSave = token;
                    this.requestUpdate();
                    this.#dispatchAction(save, (saved) => this.#dialogSaveSettled(token, saved));
                  }}
                >${this.#t("v4_save", "Save")}</button>` : nothing}
                <button
                  class="discard ms-btn ms-btn--primary ms-btn--danger"
                  type="button"
                  aria-disabled=${busy ? "true" : nothing}
                  aria-describedby=${busy ? "dialog-saving" : nothing}
                  @click=${() => { if (!busy) this.#confirmDialog(dialog); }}
                >${dialog.confirmLabel}</button>
              </div>
            </section>
          </div>
        ` : nothing}
      </div>
    `;
  }
}

if (!customElements.get(SHELL_TAG)) {
  customElements.define(SHELL_TAG, MaticMapShellV4);
}
