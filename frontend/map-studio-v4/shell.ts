import { LitElement, nothing } from "lit";
import { shellStyles } from "./shell-styles";
import { html, unsafeStatic } from "lit/static-html.js";
import type { PropertyValues } from "lit";
import { isWorkspaceIntent } from "./contracts";

import type {
  DateFormat,
  Localize,
  NoticePlaceholders,
  NoticeTone,
  NoButtonAction,
  PrimaryAction,
  ResetCadenceAction,
  WorkspaceIntent,
  WorkspaceNotice,
  WorkspaceState,
  Workflow,
} from "./contracts";
import {
  MAP_CANVAS_TAG,
  PRECISION_CONTROLS_TAG,
  SHELL_TAG,
  WORKFLOW_TAG,
} from "./element-tags";
import { renderDrawTools } from "./draw-tools";
import { LazyChunk, chunkStatus, reloadInto, takeResume, type ChunkStatus } from "./lazy-chunk";
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
  iconWorkspace,
} from "./icons";
import {
  WORKSPACE_ACTION_EVENT,
  WORKSPACE_INTENT_EVENT,
} from "./map-canvas";
import "./map-canvas";
import { formatList, translate } from "./localize";
import { needsDraftConfirmation } from "./draft-navigation";
import {
  deleteSubject,
  initialWorkspaceState,
  isSelectedRobotUnavailable,
  selectStopSecondaryAction,
  selectPrimaryAction,
  type DeleteSubject,
} from "./state";

const mapCanvasTag = unsafeStatic(MAP_CANVAS_TAG);
const precisionControlsTag = unsafeStatic(PRECISION_CONTROLS_TAG);
const workflowTag = unsafeStatic(WORKFLOW_TAG);

const isReadOnlyWorkspace = (state: WorkspaceState): boolean =>
  state.dataMode === "history" || state.floor.readOnly;

interface StatusPresentation {
  readonly title: string;
  readonly detail: string;
  readonly icon: string;
  /** True when the robot is doing something the workspace title alone would hide. */
  readonly notable: boolean;
  /** True for the idle "Map limited" row, whose sheet body offers Try again. */
  readonly recheck?: boolean;
}

const statusCopy = (state: WorkspaceState, localize?: Localize): StatusPresentation => {
  const t = (key: string, fallback: string, placeholders?: Record<string, string | number>): string =>
    translate(localize, key, fallback, placeholders);
  if (!state.host.connected) return { title: t("v4_reconnecting", "Reconnecting"), detail: t("v4_ha_offline", "Home Assistant is offline"), icon: iconOffline, notable: true };
  if (!state.host.administrator) return { title: t("v4_access_required", "Access required"), detail: t("v4_admin_only", "Administrator only"), icon: iconOffline, notable: true };
  if (state.host.robotCount === 0) return { title: t("v4_no_robot_short", "No robot"), detail: t("v4_set_up_robot", "Set up a robot"), icon: iconOffline, notable: true };
  if (isSelectedRobotUnavailable(state)) return { title: t("v4_selected_robot_unavailable", "Selected robot unavailable"), detail: t("v4_choose_another_robot", "Choose another robot to open its map."), icon: iconOffline, notable: true };
  if (!state.host.robotConnected) return { title: t("v4_robot_offline", "Robot offline"), detail: t("v4_last_map_read_only", "Last known map · read only"), icon: iconOffline, notable: true };
  if (state.activity === "problem") return { title: t("v4_needs_attention", "Needs attention"), detail: t("v4_check_robot", "Check the robot"), icon: iconOffline, notable: true };
  if (state.dataMode === "history") {
    const floor = state.resources.history.value?.floors.find(
      (candidate) => candidate.id === state.selection.floorId,
    );
    const position = floor?.snapshots.findIndex(
      (snapshot) => snapshot.id === state.selection.historyId,
    ) ?? -1;
    const count = floor?.snapshots.length ?? 0;
    return {
      title: t("v4_saved_map", "Saved map"),
      detail: position >= 0
        ? t("v4_read_only_position", "Read only · {position} of {count}", { position: position + 1, count })
        : t("v4_read_only", "Read only"),
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
  const mapUnavailableDetail = t("v4_active_map_unavailable", "The live map is unavailable; new cleaning is disabled.");
  const withMapConsequence = (detail: string): string => mapUnavailable ? `${detail} · ${mapUnavailableDetail}` : detail;
  if (state.activity === "cleaning") return { title: t("v4_cleaning", "Cleaning"), detail: withMapConsequence(t("v4_cleaning_progress", "Cleaning in progress")), icon: iconCleaning, notable: true };
  if (state.activity === "recharging") {
    const battery = state.batteryPercent === null
      ? t("v4_recharging_detail", "Will resume automatically when ready")
      : t("v4_recharging_battery", "Charging to resume · {percent}% battery", { percent: state.batteryPercent });
    return { title: t("v4_recharging", "Charging to resume"), detail: withMapConsequence(battery), icon: iconCharging, notable: true };
  }
  if (state.activity === "paused") return { title: t("v4_paused", "Paused"), detail: withMapConsequence(t("v4_can_resume", "Cleaning can resume")), icon: iconPaused, notable: true };
  if (state.activity === "returning") return { title: t("v4_returning", "Returning"), detail: withMapConsequence(t("v4_going_dock", "Going to the dock")), icon: iconCleaning, notable: true };
  if (state.activity === "stopping") return { title: t("v4_stopping", "Stopping"), detail: withMapConsequence(t("v4_waiting_robot", "Waiting for the robot")), icon: iconPaused, notable: true };
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
  const battery = state.batteryPercent === null
    ? t("v4_ready", "Ready")
    : t("v4_battery", "{percent}% battery", { percent: state.batteryPercent });
  return {
    title: state.activity === "docked" ? t("v4_docked", "Docked") : t("v4_ready", "Ready"),
    detail: battery,
    icon: iconRobot,
    notable: false,
  };
};

const workflowCopy = (state: WorkspaceState, localize?: Localize): {
  readonly title: string;
  readonly description: string;
} => {
  const t = (key: string, fallback: string): string => translate(localize, key, fallback);
  switch (state.workflow) {
    case "rooms":
      return { title: t("v4_choose_rooms", "Choose rooms"), description: t("v4_choose_rooms_detail", "Choose rooms on the map or in the list.") };
    case "draw":
      return { title: t("v4_draw_area", "Draw an area"), description: t("v4_draw_area_detail", "Outline or paint the area, then review it before saving.") };
    case "plans":
      return { title: t("v4_your_plans", "Your plans"), description: t("v4_choose_plan_detail", "Choose a plan to edit or run, or create a new one.") };
    case "plan":
      return { title: state.planDraft.id ? t("v4_edit_plan", "Edit plan") : t("v4_create_plan", "Create a plan"), description: t("v4_plan_detail", "Review rooms and cleaning settings.") };
    case "areaReview":
      return { title: t("v4_name_this_area", "Name this area"), description: t("area_details_hint", "Name the area and choose cleaning settings.") };
    case "history":
      return { title: t("v4_map_history", "Map history"), description: t("v4_map_history_detail", "Saved maps show one floor each. They can't be edited and never show where the robot is now.") };
    case "support":
      return { title: t("v4_map_diagnostics", "Map diagnostics"), description: t("v4_map_support_detail", "Details to share with support") };
    case "none":
      if (isReadOnlyWorkspace(state)) {
        return {
          title: t("v4_saved_map_read_only_title", "Saved map is read only"),
          description: state.dataMode === "live"
            ? t("v4_map_recovery_automatic", "Cleaning controls return automatically when the live map is ready.")
            : t("v4_saved_map_read_only_detail", "Return to the live map to choose rooms, run a plan, or draw a custom area."),
        };
      }
      return { title: t("v4_what_to_clean", "Choose what to clean"), description: t("v4_clean_detail", "Choose rooms, a saved plan, or a custom area.") };
  }
};

type SheetDetent = "peek" | "half" | "full";

const DETENTS: readonly SheetDetent[] = ["peek", "half", "full"];

// shell.md §4 notice rule: glyph per tone, and how long each toast stays.
const NOTICE_ICONS: Readonly<Record<NoticeTone, string>> = {
  info: iconDiagnostics,
  success: iconNoticeSuccess,
  warning: iconNoticeWarning,
  error: iconNoticeError,
};
const TOAST_MS: Readonly<Record<NoticeTone, number>> = { info: 6000, success: 4000, warning: 6000, error: 10000 };

// Where the sheet rests when a workflow opens. The map is the document, so a
// drawing starts at peek; room choices stay visible at half height, while
// longer forms (plans, diagnostics) start at full height.
const DEFAULT_DETENT: Readonly<Record<Workflow, SheetDetent>> = {
  none: "half",
  rooms: "half",
  draw: "peek",
  plan: "full",
  plans: "full",
  areaReview: "half",
  history: "half",
  support: "full",
};

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

interface DialogPresentation {
  readonly title: string;
  readonly detail: string;
  /** What else the delete changes: the default plan or the selected custom area. */
  readonly consequence?: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly action: "discard" | "delete-plan" | "delete-area" | "reset-room-cadence";
}

const dialogCopy = (
  dialog: WorkspaceState["dialog"],
  localize?: Localize,
  plan = false,
  resetRoomName = "room",
  sharedCadence = false,
  resetMode: "mop" | "coverage" = "mop",
  subject?: DeleteSubject,
): DialogPresentation | undefined => {
  const t = (key: string, fallback: string, placeholders?: Record<string, string | number>): string =>
    translate(localize, key, fallback, placeholders);
  switch (dialog) {
    case "discardDraft":
      return {
        title: plan ? t("v4_discard_plan", "Discard plan changes?") : t("v4_discard_area", "Discard area changes?"),
        detail: plan ? t("v4_discard_plan_detail", "Your plan changes have not been saved. Keep editing or discard them.") : t("v4_discard_area_detail", "Your area changes have not been saved. Keep editing or discard them."),
        cancelLabel: t("v4_keep_area_editing", "Keep editing"),
        confirmLabel: t("v4_discard", "Discard"),
        action: "discard",
      };
    case "confirmDeletePlan":
      return subject && {
        title: t("v4_delete_plan", "Delete plan?"),
        detail: t("v4_delete_plan_detail", "Automations that run \"{name}\" will stop working, and the robot won't move.", { name: subject.name }),
        ...(subject.successor === undefined ? {} : {
          consequence: subject.successor === null
            ? t("v4_delete_plan_none", "You'll have no default plan.")
            : t("v4_delete_plan_default", "{new_default} becomes your default plan.", { new_default: subject.successor }),
        }),
        cancelLabel: t("v4_cancel", "Cancel"),
        confirmLabel: t("plan_delete", "Delete"),
        action: "delete-plan",
      };
    case "confirmDeleteArea":
      return subject && {
        title: t("v4_delete_area", "Delete area?"),
        detail: t("v4_delete_area_detail", "Automations that clean \"{name}\" will stop working, and the robot won't move.", { name: subject.name }),
        ...(subject.successor === undefined ? {} : {
          consequence: subject.successor === null
            ? t("v4_delete_area_none", "No custom area will be selected.")
            : t("v4_delete_area_selected", "{area} becomes the selected custom area.", { area: subject.successor }),
        }),
        cancelLabel: t("v4_cancel", "Cancel"),
        confirmLabel: t("area_delete", "Delete"),
        action: "delete-area",
      };
    case "confirmResetCadence":
      return {
        title: resetMode === "mop"
          ? t("v4_reset_mop_cadence_title", "Reset mopping progress?")
          : t("v4_reset_coverage_cadence_title", "Reset vacuum rotation progress?"),
        detail: sharedCadence
          ? t("v4_reset_shared_cadence_detail", "The count for {room} starts again in every plan that shares its schedule, and work brought forward to the next clean goes back to its schedule. Other work and cleaning history don't change.", { room: resetRoomName })
          : t("v4_reset_private_cadence_detail", "The count for {room} starts again in this plan only, and work brought forward to the next clean goes back to its schedule. Other work and cleaning history don't change.", { room: resetRoomName }),
        cancelLabel: t("v4_cancel", "Cancel"),
        confirmLabel: t("v4_reset", "Reset"),
        action: "reset-room-cadence",
      };
    case null:
      return undefined;
  }
};

const deepActiveElement = (root: Document | ShadowRoot = document): HTMLElement | null => {
  let active = root.activeElement as HTMLElement | null;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement as HTMLElement;
  }
  return active;
};

const isVisible = (element: HTMLElement | null): element is HTMLElement =>
  Boolean(element && element.isConnected && element.offsetParent !== null);

export class MaticMapShellV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    dates: { attribute: false },
    _measuredNarrow: { state: true },
    _sheetOffset: { state: true },
    _overflowOpen: { state: true },
    _helpOpen: { state: true },
    _browserFullscreen: { state: true },
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

  constructor() {
    super();
    new RovingFocusController(this, {
      container: () => this.renderRoot?.querySelector<HTMLElement>(".draw-tools") ?? null,
      items: "button",
    });
  }

  #t(key: string, fallback: string, placeholders?: NoticePlaceholders): string {
    return translate(this.localize, key, fallback, placeholders, this.dates);
  }
  protected _measuredNarrow = false;
  protected _sheetOffset = 0;
  protected _overflowOpen = false;
  protected _helpOpen = false;
  protected _browserFullscreen = false;
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
  readonly #views = new LazyChunk(this, () => import("./workflow-panel"));
  readonly #outline = new LazyChunk(this, async () => new (await import("./outline-editor")).OutlineEditor());
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
  #helpLauncher: HTMLElement | null = null;
  // What Discard goes on to: the intent that asked, or Try again's reload.
  #pendingNavigation: WorkspaceIntent | "reload" | null = null;
  // The workflows the entry screen's enabled rows offered at its last render
  // (#launch), plus Map diagnostics, which Map options offers on any screen.
  #launchers = new Set<string>();
  #drag: SheetDrag | null = null;
  #bodySwipe: BodySwipe | null = null;

  #fullscreenElement(): Element | null {
    const root = this.renderRoot;
    return root instanceof ShadowRoot
      ? root.fullscreenElement ?? document.fullscreenElement
      : document.fullscreenElement;
  }

  readonly #fullscreenChange = (): void => {
    this._browserFullscreen = this.#isAppFullscreen();
  };

  #isAppFullscreen(): boolean {
    const root = this.renderRoot;
    const app = root.querySelector(".app");
    const scopedFullscreenElement = root instanceof ShadowRoot ? root.fullscreenElement : null;
    if (scopedFullscreenElement) return scopedFullscreenElement === app;

    const documentFullscreenElement = document.fullscreenElement;
    for (let current: Node | null = this; current;) {
      if (current === documentFullscreenElement) return true;
      const tree = current.getRootNode();
      current = tree instanceof ShadowRoot ? tree.host : null;
    }
    return false;
  }

  readonly #outsidePointer = (event: PointerEvent): void => {
    if (!this._overflowOpen) return;
    const overflow = this.renderRoot.querySelector(".overflow-wrap");
    if (!overflow || !event.composedPath().includes(overflow)) this._overflowOpen = false;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = entry.contentRect.width < 1024 || entry.contentRect.height < 480;
      if (next !== this._measuredNarrow) this._measuredNarrow = next;
    });
    this.#resizeObserver.observe(this);
    window.addEventListener("pointerdown", this.#outsidePointer, true);
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

  // MS-AXE-03 (design-system.md §5): the six D1 colours, resolved from HA's
  // theme colours (theme-probe.ts): the primary and Stop fill pairs, the
  // focus and selection indicator (3:1 on the card and sunken surfaces) and
  // danger text (4.5:1 on the card). Forced colours bypass it.
  #resolveTheme(): void {
    const forced = window.matchMedia("(forced-colors: active)").matches;
    const read = readColors(this.renderRoot, {
      accent: "var(--ms-accent)", danger: "var(--ms-danger)", label: "var(--ms-on-accent)",
      card: "var(--ms-surface-card)", sunken: "var(--ms-surface-sunken)",
    });
    // In the order read. A translucent colour has no single contrast, so it
    // resolves nothing.
    const [accent, danger, label, card, sunken] = Object.values(read).map(opaque);
    const pair = (fill?: Channel | null) => (forced || !fill || !label ? [] : resolveFill(fill, label));
    const tone = (color: Channel | null | undefined, ratio: number, surface = card) =>
      (forced || !color || !card || !surface ? undefined : resolveTone(color, ratio, [card, surface]));
    // An empty value removes the property, so the CSS falls back to HA's colour.
    const value = (channel?: Channel): string => (channel ? rgba(channel, 1) : "");
    const [accentFill, onAccentFill] = pair(accent);
    const [dangerFill, onDangerFill] = pair(danger);
    this.style.setProperty("--ms-resolved-accent-fill", value(accentFill));
    this.style.setProperty("--ms-resolved-on-accent-fill", value(onAccentFill));
    this.style.setProperty("--ms-resolved-danger-fill", value(dangerFill));
    this.style.setProperty("--ms-resolved-on-danger-fill", value(onDangerFill));
    this.style.setProperty("--ms-resolved-indicator", value(tone(accent, 3, sunken)));
    this.style.setProperty("--ms-resolved-danger-text", value(tone(danger, 4.5)));
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
    window.removeEventListener("pointerdown", this.#outsidePointer, true);
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
    // The untranslated title names the status row, so only a new row is
    // announced, in the current language.
    const row = statusCopy(this.state).title;
    if (this.#statusRow !== null && row !== this.#statusRow) {
      this.#announce("_polite", statusCopy(this.state, this.localize).title);
    }
    this.#statusRow = row;
    const next = this.state.notice;
    const previous = changed.get("state") as WorkspaceState | undefined;
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
    // Protected reactive fields are not in `keyof this`, so the map is read
    // through the untyped view for those.
    const local = changed as PropertyValues;
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
    if (local.has("_overflowOpen") && this._overflowOpen) {
      void this.updateComplete.then(() => {
        this.renderRoot.querySelector<HTMLElement>("#map-options select, #map-options button")?.focus();
      });
    }
    if (local.has("_helpOpen")) {
      if (this._helpOpen) {
        void this.updateComplete.then(() => {
          this.renderRoot.querySelector<HTMLElement>(".help-dialog [data-dialog-initial-focus]")?.focus();
        });
      } else if (local.get("_helpOpen")) {
        const launcher = this.#helpLauncher;
        this.#helpLauncher = null;
        void this.updateComplete.then(() => {
          requestAnimationFrame(() => launcher?.focus({ preventScroll: true }));
        });
      }
    }
    if (changed.has("state")) {
      this.#resumeWorkflow();
      const previous = changed.get("state") as WorkspaceState | undefined;
      if (previous?.precisionOpen && !this.state.precisionOpen) {
        this.#brushLauncher()?.focus();
      }
      if (previous?.fullMap && !this.state.fullMap) {
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
          // the store did not select.
          this.#pendingNavigation = null;
          this.#restoreSelectors();
        }
        // Safari does not focus a button on a pointing-device click. Use the
        // explicit workflow launcher if there was no nested active element.
        const launcher = this.#dialogLauncher?.isConnected
          && this.#dialogLauncher.hasAttribute("data-dialog-launcher")
          ? this.#dialogLauncher
          : this.#dialogLauncherFor(previous.dialog);
        this.#dialogLauncher = null;
        // One rule: try the launcher, then, if closing the dialog left focus
        // on the page body (the launcher is gone or hidden, or Safari gave a
        // clicked Cancel no focus to move), hand it to the panel. Focus the
        // user moved elsewhere in the document is left alone.
        void this.updateComplete.then(() => {
          requestAnimationFrame(() => {
            launcher?.focus({ preventScroll: true });
            const body = !document.activeElement || document.activeElement === document.body;
            if (!this.shadowRoot?.activeElement && body) this.#focusPanel();
          });
        });
      }
      if (!previous) {
        this._sheetDetent = DEFAULT_DETENT[this.state.workflow];
      } else if (previous.workflow !== this.state.workflow) {
        // Only on a workflow CHANGE: a state tick inside a workflow must not
        // yank the sheet back to its default while the user is reading.
        this._sheetDetent = DEFAULT_DETENT[this.state.workflow];
        void this.updateComplete.then(() => this.#focusPanel());
      }
    }
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

  #intent(intent: WorkspaceIntent): void {
    if (needsDraftConfirmation(this.state, intent)) {
      this.#pendingNavigation = intent;
      this.#intent({ type: "open-dialog", dialog: "discardDraft" });
      return;
    }
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
    if (action.id === "clear-draft") {
      this.#intent({ type: "clear-draft" });
      return;
    }
    this.#dispatchAction(action.id);
  }

  #workflow(workflow: Workflow, launcher?: EventTarget | null): void {
    const intent: WorkspaceIntent = { type: "open-workflow", workflow };
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
    if (open === "none" && this.#launchers.has(workflow)) this.#workflow(workflow as Workflow);
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
    if (pending && pending.type !== "dismiss-top-layer") queueMicrotask(() => this.dispatchEvent(new CustomEvent<WorkspaceIntent>(WORKSPACE_INTENT_EVENT, {
      detail: pending, bubbles: true, composed: true,
    })));
  }

  #keepDraft(): void {
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
    const dialog = this.state.dialog;
    const launcher = dialog && this.#dialogLauncher?.isConnected
      && this.#dialogLauncher.hasAttribute("data-dialog-launcher")
      ? this.#dialogLauncher
      : dialog ? this.#dialogLauncherFor(dialog) : null;
    this.#intent({ type: "dismiss-top-layer" });
    if (launcher) requestAnimationFrame(() => launcher.focus({ preventScroll: true }));
  }

  #dispatchAction(action: string | ResetCadenceAction): void {
    this.dispatchEvent(new CustomEvent(WORKSPACE_ACTION_EVENT, {
      detail: typeof action === "string" ? { id: action } : action,
      bubbles: true,
      composed: true,
    }));
  }

  #confirmDelete(id: "delete-plan" | "delete-area"): void {
    this.#intent({ type: "dismiss-top-layer" });
    this.#dispatchAction(id);
  }

  #confirmDialog(presentation: DialogPresentation): void {
    if (presentation.action === "discard") {
      this.#discardAndContinue();
      return;
    }
    if (presentation.action === "delete-plan" || presentation.action === "delete-area") {
      this.#confirmDelete(presentation.action);
      return;
    }
    const resetRequest = this.state.cadenceResetRequest;
    this.#intent({ type: "dismiss-top-layer" });
    if (resetRequest) this.#dispatchAction({
      id: "reset-room-cadence",
      planId: resetRequest.planId,
      roomId: resetRequest.roomId,
      mode: resetRequest.mode,
    });
  }

  // ---- Bottom sheet -------------------------------------------------------

  #setDetent(detent: SheetDetent): void {
    if (detent === this._sheetDetent) return;
    this._sheetDetent = detent;
    this.#announce("_polite", detent === "peek" ? this.#t("v4_workspace_height_peek", "Cleaning panel, collapsed")
      : detent === "half" ? this.#t("v4_workspace_height_half", "Cleaning panel, half height")
      : this.#t("v4_workspace_height_full", "Cleaning panel, full height"));
  }

  #sheetStep(delta: 1 | -1, wrap = false): void {
    const index = DETENTS.indexOf(this._sheetDetent);
    let next = index + delta;
    if (wrap && next >= DETENTS.length) next = 0;
    next = Math.max(0, Math.min(DETENTS.length - 1, next));
    this.#setDetent(DETENTS[next] ?? this._sheetDetent);
  }

  #detentHeights(sheet: HTMLElement): Readonly<Record<SheetDetent, number>> {
    const available = this.renderRoot.querySelector<HTMLElement>(".workspace")?.clientHeight
      ?? sheet.parentElement?.clientHeight
      ?? sheet.offsetHeight;
    const rem = parseFloat(getComputedStyle(this).fontSize) || 16;
    const chrome = [".sheet-grip", ".sheet-tools", ".action-bar"]
      .map((selector) => sheet.querySelector<HTMLElement>(selector)?.offsetHeight ?? 0)
      .reduce((sum, height) => sum + height, 0) + rem * 0.75;
    const full = Math.min(available * 0.92, available - rem * 9);
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
    const index = DETENTS.indexOf(this._sheetDetent);
    const first = drag.samples[0];
    const last = drag.samples[drag.samples.length - 1];
    const velocity = first && last && last !== first ? (last.y - first.y) / Math.max(1, last.t - first.t) : 0;
    if (Math.abs(velocity) > FLICK_VELOCITY) {
      const next = Math.max(0, Math.min(DETENTS.length - 1, index + (velocity < 0 ? 1 : -1)));
      this.#setDetent(DETENTS[next] ?? this._sheetDetent);
      return;
    }
    const target = drag.startHeight - dy;
    let nearest: SheetDetent = this._sheetDetent;
    let distance = Number.POSITIVE_INFINITY;
    for (const detent of DETENTS) {
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
    this.#intent({ type: this.state.fullMap ? "exit-full-map" : "enter-full-map" });
  }

  #closeOverflow(restoreFocus: boolean): void {
    this._overflowOpen = false;
    if (restoreFocus) {
      void this.updateComplete.then(() => {
        this.renderRoot.querySelector<HTMLElement>(".overflow")?.focus();
      });
    }
  }

  #overflowAction(id: "support" | "fullscreen"): void {
    this.#closeOverflow(id === "fullscreen");
    if (id === "support") {
      this.#workflow("support");
      return;
    }
    const app = this.renderRoot.querySelector<HTMLElement>(".app");
    if (this.#fullscreenElement()) void document.exitFullscreen();
    else void app?.requestFullscreen();
  }

  #openBrush(): void {
    this.#intent({
      type: "set-precision-open",
      value: !this.state.precisionOpen,
    });
  }

  #openHelp(event: Event): void {
    this.#helpLauncher = event.currentTarget as HTMLElement;
    this._helpOpen = true;
  }

  #captureDialogLauncher(event: Event): void {
    const intent = event as CustomEvent<WorkspaceIntent>;
    if (!isWorkspaceIntent(intent.detail)) return;
    if (needsDraftConfirmation(this.state, intent.detail)) {
      event.stopPropagation();
      this.#intent(intent.detail);
      return;
    }
    if (intent.detail?.type !== "open-dialog") return;
    // Safari does not focus a button when it is clicked with a pointing device.
    // The composed path may be retargeted, so keep only an explicit launcher.
    const launcher = intent.composedPath().find((candidate) => candidate instanceof HTMLElement
      && candidate.hasAttribute("data-dialog-launcher"));
    if (launcher instanceof HTMLElement) this.#dialogLauncher = launcher;
  }

  #dialogLauncherFor(dialog: NonNullable<WorkspaceState["dialog"]>): HTMLElement | null {
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
    if (this._overflowOpen) {
      this.#closeOverflow(true);
      return;
    }
    if (this._helpOpen) {
      this._helpOpen = false;
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
    if (this._sheetDetent === "peek" && this.#sheet()) this.#setDetent("half");
    void this.updateComplete.then(() => this.#focusPanel());
  }

  // ---- Templates ----------------------------------------------------------

  #actionButton(action: PrimaryAction | NoButtonAction, classes: string, reasonId: string) {
    if (!("label" in action)) return nothing;
    const label = action.labelKey ? this.#t(action.labelKey, action.label, action.labelPlaceholders) : action.label;
    const reason = !action.enabled && action.reason
      ? (action.reasonKey ? this.#t(action.reasonKey, action.reason) : action.reason)
      : null;
    const stop = action.id === "stop";
    return html`
      <button
        class=${`${classes} ${action.kind === "danger" ? "ms-btn--danger" : ""}`}
        type="button"
        aria-disabled=${action.enabled ? nothing : "true"}
        aria-describedby=${reason ? reasonId : nothing}
        aria-label=${stop ? this.#t("v4_stop_cleaning_label", "Stop cleaning") : nothing}
        @click=${() => this.#action(action)}
      >${label}</button>
      ${reason ? html`<p class="action-reason" id=${reasonId}>${reason}</p>` : nothing}
    `;
  }

  #rooms(state: WorkspaceState): string {
    const rooms = state.resources.plans.value?.rooms
      ?? state.resources.areas.value?.rooms
      ?? [];
    return formatList(state.locale, state.selection.roomIds.map((roomId) =>
      rooms.find((room) => room.roomId === roomId)?.name ?? roomId));
  }

  #actionBar(state: WorkspaceState, primary: PrimaryAction | NoButtonAction | null, secondary: PrimaryAction | null) {
    const rooms = this.#rooms(state);
    const summary = primary?.enabled && state.workflow === "rooms" && primary.id === "clean-rooms"
      ? (state.planDraft.returnToBase && rooms
        ? this.#t("v4_rooms_summary_dock", "{rooms} · returns to the dock", { rooms })
        : rooms)
      : "";
    return html`
      <div class="action-bar">
        ${summary ? html`<p class="action-summary">${summary}</p>` : nothing}
        ${primary ? this.#actionButton(primary, "ms-btn ms-btn--block ms-btn--lg ms-btn--primary", "primary-reason") : nothing}
        ${secondary ? this.#actionButton(secondary, "ms-btn ms-btn--block ms-btn--lg ms-btn--secondary", "secondary-reason") : nothing}
      </div>
    `;
  }

  #hostState(title: string, body: string, extra: unknown = nothing) {
    return html`
      <div class="host-state">
        <h3>${title}</h3>
        <p>${body}</p>
        ${extra}
      </div>
    `;
  }

  // An entry row's tap; an enabled row also records it for a resumed Try again.
  #launch(workflow: Workflow, disabled = false): () => void {
    if (!disabled) this.#launchers.add(workflow);
    return () => { if (!disabled) this.#workflow(workflow); };
  }

  #shelfRow(label: string, glyph: string, workflow: Workflow, detail?: string, disabled = false) {
    return html`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${disabled ? "true" : nothing}
        @click=${this.#launch(workflow, disabled)}
      >
        <span class="ms-row__lead">${icon(glyph)}</span>
        <span class="ms-row__body"><strong>${label}</strong>${detail ? html`<small>${detail}</small>` : nothing}</span>
        <span class="ms-row__trail">${icon(iconChevronRight)}</span>
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

  #entry(state: WorkspaceState, narrow: boolean, status: StatusPresentation) {
    const t = (key: string, fallback: string, placeholders?: Record<string, string | number>): string =>
      this.#t(key, fallback, placeholders);
    this.#launchers = new Set(["support"]);
    // Built where shown, so only a shown row counts as a launcher.
    const historyRow = () => this.#shelfRow(
      t("v4_map_history", "Map history"),
      iconHistory,
      "history",
      t("v4_map_history_detail", "Saved maps show one floor each. They can't be edited and never show where the robot is now."),
    );
    const diagnosticsRow = () => this.#shelfRow(
      t("v4_map_diagnostics", "Map diagnostics"),
      iconDiagnostics,
      "support",
      t("v4_map_support_detail", "Details to share with support"),
    );
    const { host } = state;
    if (!host.connected) return this.#hostState(t("v4_reconnecting_title", "Reconnecting to Home Assistant"), t("v4_reconnecting_body", "Cleaning controls come back when Home Assistant reconnects."));
    if (!host.administrator) return this.#hostState(t("v4_admin_title", "Administrator access required"), t("v4_admin_body", "Ask a Home Assistant administrator to open this map."));
    if (host.robotCount === 0) {
      return this.#hostState(
        t("v4_no_robot_title", "No robot set up"),
        t("v4_no_robot_body", "Add the Matic (Unofficial) integration to see a map here."),
        html`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${t("v4_open_integration", "Open integration")}</a>`,
      );
    }
    if (isSelectedRobotUnavailable(state)) {
      return this.#hostState(t("v4_selected_robot_unavailable", "Selected robot unavailable"), t("v4_choose_another_robot", "Choose another robot to open its map."));
    }
    if (!host.robotConnected) {
      return html`
        ${this.#hostState(t("v4_robot_offline_title", "Robot offline"), t("v4_robot_offline_body", "Showing the last known map. Cleaning comes back when the robot reconnects."))}
        <h3 class="shelf-heading">${t("v4_more", "Map tools")}</h3>
        <div class="shelf">${historyRow()}${diagnosticsRow()}</div>
      `;
    }
    if (isReadOnlyWorkspace(state)) {
      return html`
        <h3 class="shelf-heading">${t("v4_more", "Map tools")}</h3>
        <div class="shelf">
          ${historyRow()}
          ${diagnosticsRow()}
        </div>
      `;
    }
    const locating = state.coherence === "verifying" || state.coherence === "booting";
    const plansResource = state.resources.plans;
    const plans = plansResource.value;
    const noRooms = plans !== null && plans.rooms.length === 0;
    const planCount = plans?.plans.length ?? 0;
    const plansLoading = plansResource.status === "loading";
    const plansUnavailable = plansResource.status === "error";
    const roomsDisabled = locating || noRooms;
    const roomsReason = locating
      ? t("v4_reason_locating", "Waiting for the robot to confirm which floor it is on.")
      : noRooms ? t("v4_no_rooms_reason", "Can't clean rooms until you name them in the Matic app.") : null;
    const planReason = locating
      ? t("v4_reason_locating", "Waiting for the robot to confirm which floor it is on.")
      : null;
    const customAreaReason = locating
      ? t("v4_reason_locating", "Waiting for the robot to confirm which floor it is on.")
      : t("v4_areas_quick_detail", "Draw or choose a custom area");
    return html`
      ${state.activity === "problem"
        ? this.#hostState(t("v4_attention_title", "The robot needs attention"), t("v4_attention_body", "The robot reported a problem. Check it in the Matic app, then start a new clean."))
        : status.recheck ? html`
          <div class="host-state">
            <p>${t("v4_map_limited_body", "Home Assistant can show this map but can't confirm it well enough to start cleaning.")}</p>
            <button
              class="ms-btn ms-btn--secondary"
              type="button"
              aria-disabled=${state.rechecking ? "true" : nothing}
              @click=${() => { if (!this.state.rechecking) this.#dispatchAction("recheck-status"); }}
            >${t("v4_retry", "Try again")}</button>
          </div>
        ` : html`
          <div class="quick-actions" role="group" aria-label=${t("v4_cleaning_choices", "Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${roomsDisabled ? "true" : nothing}
              @click=${this.#launch("rooms", roomsDisabled)}
            >
              <span class="ms-row__lead">${icon(iconRobot)}</span>
              <span class="ms-row__body">
                <strong>${t("v4_clean_rooms", "Clean rooms")}</strong>
                <small>${roomsReason ?? t("v4_clean_rooms_hint", "Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${icon(iconChevronRight)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${locating ? "true" : nothing}
              @click=${this.#launch("plans", locating)}
            >
              <span class="ms-row__lead">${icon(iconPlan)}</span>
              <span class="ms-row__body">
                <strong>${plansLoading
                  ? t("v4_plans_loading", "Checking saved plans")
                  : plansUnavailable
                    ? t("v4_plans_unavailable", "Plans unavailable")
                    : planCount
                      ? t("v4_run_a_plan", "Run a plan")
                      : t("v4_create_plan", "Create a plan")}</strong>
                <small>${planReason ?? (plansLoading
                  ? t("v4_plans_loading_hint", "Reading plans for this floor")
                  : plansUnavailable
                    ? t("v4_plans_unavailable_hint", "Try again to load your plans.")
                    : planCount
                      ? planCount === 1 ? t("v4_saved_routine", "1 saved plan") : t("v4_saved_routines", "{count} saved plans", { count: planCount })
                      : t("v4_no_plans_hint", "Save a plan to repeat a set of rooms"))}</small>
              </span>
              <span class="ms-row__trail">${icon(iconChevronRight)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${t("v4_more", "Map tools")}</h3>
      <div class="shelf">
        ${this.#shelfRow(
          t("v4_custom_areas", "Clean custom area"),
          iconNewArea,
          "draw",
          customAreaReason,
          locating,
        )}
        ${historyRow()}

      </div>
      ${narrow ? html`
        <h3 class="shelf-heading" id="map-display-heading">${t("v4_map_display", "Map display")}</h3>
        <div class="map-display">
          <div class="ms-segment" role="group" aria-labelledby="map-display-heading">
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(state.appearance === "photo")}
              @click=${() => this.#intent({ type: "set-appearance", appearance: "photo" })}
            >${t("map_style_photo", "Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(state.appearance === "rooms")}
              @click=${() => this.#intent({ type: "set-appearance", appearance: "rooms" })}
            >${t("v4_room_colours", "Room colors")}</button>
          </div>
          <label class="ms-checkbox">
            <input type="checkbox" .checked=${state.labelsVisible} @change=${() => this.#intent({ type: "toggle-labels" })}>
            ${t("v4_room_names", "Room names")}
          </label>
          <button
            class="ms-btn ms-btn--secondary help-launcher"
            type="button"
            aria-haspopup="dialog"
            aria-expanded=${String(this._helpOpen)}
            @click=${this.#openHelp}
          >${t("v4_how_to_move", "How to move the map")}</button>
        </div>
      ` : nothing}
    `;
  }

  #workflowBody(state: WorkspaceState, narrow: boolean, status: StatusPresentation) {
    if (state.workflow === "none") return this.#entry(state, narrow, status);
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
      @matic-workspace-intent=${this.#captureDialogLauncher}
    ></${workflowTag}>`;
  }

  // The heading and notice slot sit outside the scroller, so they stay put
  // and never cover a control the body scrolls into view.
  #panelTop(state: WorkspaceState) {
    return html`
      <div class="panel-top">
        <div class="panel-heading">
          ${state.workflow !== "none" ? html`
            <button
              class="panel-back ms-btn ms-btn--secondary"
              type="button"
              aria-label=${state.workflow === "plan" ? this.#t("v4_back_to_plans", "Back to plans") : this.#t("v4_back_to_all_tasks", "Back to all tasks")}
              data-dialog-launcher="discardDraft"
              @click=${(event: Event) => this.#workflow(state.workflow === "plan" ? "plans" : "none", event.currentTarget)}
            >${icon(iconBack)}<span class="ms-btn__label">${state.workflow === "plan" ? this.#t("v4_your_plans", "Your plans") : this.#t("v4_all_tasks", "All tasks")}</span></button>
          ` : nothing}
          <h2 id="workspace-title" tabindex="-1">${workflowCopy(state, this.localize).title}</h2>
        </div>
        ${state.notice ? html`<div class="notice" data-notice-slot data-tone=${state.notice.tone}>${this.#noticeBody(state.notice, this.#closeNotice, this.#t("v4_close", "Close"))}</div>` : nothing}
      </div>
    `;
  }

  #panel(state: WorkspaceState, narrow: boolean, status: StatusPresentation) {
    return html`
      <p class="panel-description">${workflowCopy(state, this.localize).description}</p>
      ${this.#workflowBody(state, narrow, status)}
    `;
  }

  #sheetStatus(state: WorkspaceState, status: StatusPresentation): string {
    const workflow = workflowCopy(state, this.localize);
    let line = workflow.title;
    if (state.workflow === "rooms" && state.selection.roomIds.length) {
      line = this.#t("v4_rooms_selected_names", "{count} selected · {rooms}", {
        count: state.selection.roomIds.length,
        rooms: this.#rooms(state),
      });
    }
    // With the body open the h2 already names the workflow, so the grip line
    // carries the robot instead of repeating the title directly above it.
    if (this._sheetDetent !== "peek") return status.detail ? `${status.title} · ${status.detail}` : status.title;
    return status.notable ? `${status.title} · ${line}` : line;
  }

  #helpDialog() {
    const t = (key: string, fallback: string): string => this.#t(key, fallback);
    return html`
      <div class="dialog-backdrop" @click=${(event: Event) => { if (event.target === event.currentTarget) this._helpOpen = false; }}>
        <section
          class="dialog help-dialog ms-surface ms-surface--overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          @keydown=${this.#dialogKeyboard}
        >
          <h2 id="help-title">${t("v4_how_to_move", "How to move the map")}</h2>
          <dl>
            <dt>${t("v4_touch", "Touch")}</dt>
            <dd>${t("v4_touch_help", "Drag to explore · pinch to zoom · twist two fingers to rotate")}</dd>
            <dt>${t("v4_trackpad", "Trackpad")}</dt>
            <dd>${t("v4_trackpad_help", "Scroll to pan · pinch to zoom · twist to rotate")}</dd>
            <dt>${t("v4_mouse", "Mouse")}</dt>
            <dd>${t("v4_mouse_help", "Drag to orbit · Shift, middle, or right drag to pan · wheel to zoom")}</dd>
            <dt>${t("v4_keyboard", "Keyboard")}</dt>
            <dd>${t("v4_keyboard_help", "WASD to move · Q/E or arrows to orbit · +/− to zoom · 0 to fit")}</dd>
          </dl>
          <div class="dialog-actions">
            <button
              class="ms-btn ms-btn--secondary"
              type="button"
              data-dialog-initial-focus
              @click=${() => { this._helpOpen = false; }}
            >${t("v4_close", "Close")}</button>
          </div>
        </section>
      </div>
    `;
  }

  protected override render() {
    const state = this.state;
    const narrow = state.narrowHint || this._measuredNarrow;
    const status = statusCopy(state, this.localize);
    const selectedRobotUnavailable = isSelectedRobotUnavailable(state);
    const primary = selectPrimaryAction({ ...state, narrowHint: narrow });
    const secondary = selectStopSecondaryAction(state);
    const statusAction = !narrow && primary.id === "stop"
      ? primary
      : !narrow && secondary?.id === "stop" ? secondary : null;
    const footerPrimary = statusAction && statusAction === primary ? null : primary;
    const clearDrawing: PrimaryAction | null = state.workflow === "draw" && state.dataMode === "live"
      ? {
        id: "clear-draft",
        label: "Clear",
        labelKey: "v4_clear_drawing",
        kind: "neutral",
        enabled: state.draw.circles.length > 0 || Boolean(state.draw.outline?.points.length),
      }
      : null;
    const footerSecondary = statusAction && statusAction === secondary ? null : (secondary ?? clearDrawing);
    const locatingInFullMap = state.fullMap
      && (state.coherence === "verifying" || state.coherence === "booting");
    const canToggleWorkspace = state.fullMap || (
      state.host.administrator && state.host.robotCount > 0 && state.map.available
    );
    const resetRoom = state.cadenceResetRequest
      ? state.resources.plans.value?.rooms.find((room) => room.roomId === state.cadenceResetRequest?.roomId)
      : undefined;
    const resetPlanRoom = state.cadenceResetRequest
      ? state.resources.plans.value?.plans.find((plan) => plan.id === state.cadenceResetRequest?.planId)
        ?.rooms.find((room) => room.roomId === state.cadenceResetRequest?.roomId)
      : undefined;
    const dialog = dialogCopy(
      state.dialog,
      this.localize,
      state.workflow === "plan",
      resetRoom?.name || state.cadenceResetRequest?.roomId || "room",
      resetPlanRoom?.cadence?.scope === "shared",
      state.cadenceResetRequest?.mode,
      // Automations name the saved plan or area, never an unsaved rename.
      deleteSubject(state),
    );
    const sheetOffset = narrow && !state.fullMap ? `--map-sheet-offset:${this._sheetOffset}px` : "--map-sheet-offset:0px";
    const showDrawTools = narrow && state.workflow === "draw";
    const precisionOpen = state.precisionOpen && state.workflow === "draw";
    // Success and error always toast; info and warning only while the slot is
    // off-screen (sheet at peek, or Full map).
    const toast = this._toast && (this._toast.tone === "success" || this._toast.tone === "error"
      || state.fullMap || (narrow && this._sheetDetent === "peek")) ? this._toast : null;
    return html`
      <div class=${`root ${narrow ? "narrow" : "wide"}`} @keydown=${this.#keyboard}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#skipToMap}>${this.#t("v4_skip_to_map", "Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#skipToWorkspace}>${this.#t("v4_skip_to_workspace", "Skip to the panel")}</button>
        <div class="app" ?inert=${Boolean(dialog) || this._helpOpen}>
          <header class="app-bar">
            ${!state.precisionOpen ? html`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#t("v4_open_navigation", "Open Home Assistant sidebar")}
                title=${this.#t("v4_open_navigation", "Open Home Assistant sidebar")}
                @click=${this.#toggleNavigation}
              >${icon(iconMenu)}</button>
            ` : nothing}

            ${state.precisionOpen ? html`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#t("v4_back", "Back")}
                @click=${() => this.#intent({ type: "dismiss-top-layer" })}
              >${icon(iconBack)}</button>
            ` : nothing}
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
                aria-label=${state.fullMap
                  ? this.#t("v4_show_workspace", "Show cleaning panel")
                  : this.#t("v4_hide_workspace", "Hide cleaning panel")}
                aria-controls="map-workspace"
                aria-expanded=${String(!state.fullMap)}
                title=${state.fullMap
                  ? this.#t("v4_show_workspace", "Show cleaning panel")
                  : this.#t("v4_hide_workspace", "Hide cleaning panel")}
                @click=${this.#toggleWorkspace}
              >${icon(iconWorkspace)}</button>
            ` : nothing}
            <div class="overflow-wrap">
              <button
                class="overflow ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#t("v4_map_options", "Map options")}
                aria-expanded=${String(this._overflowOpen)}
                aria-controls="map-options"
                @click=${() => { this._overflowOpen = !this._overflowOpen; }}
              >${icon(iconOverflow)}</button>
              ${this._overflowOpen ? html`
                <div id="map-options" class="overflow-menu ms-surface ms-surface--overlay">
                  <label class="overflow-field ms-field">${this.#t("map_quality_label", "Map detail")}
                    <select
                      aria-label=${this.#t("map_quality_label", "Map detail")}
                      .value=${state.quality}
                      @change=${(event: Event) => this.#intent({
                        type: "set-quality",
                        quality: (event.currentTarget as HTMLSelectElement).value as WorkspaceState["quality"],
                      })}
                    >
                      <option value="auto">${this.#t("map_quality_auto", "Auto detail")}</option>
                      <option value="efficient">${this.#t("map_quality_efficient", "Efficient")}</option>
                      <option value="balanced">${this.#t("map_quality_balanced", "Balanced")}</option>
                      <option value="maximum">${this.#t("map_quality_maximum", "Maximum")}</option>
                    </select>
                  </label>
                  <button class="ms-row ms-row--menu" type="button" @click=${() => this.#overflowAction("support")}>${this.#t("v4_map_diagnostics", "Map diagnostics")}</button>
                  <button class="ms-row ms-row--menu" type="button" @click=${() => this.#overflowAction("fullscreen")}>${this._browserFullscreen ? this.#t("v4_leave_full_screen", "Leave full screen") : this.#t("v4_full_screen", "Full screen")}</button>
                </div>
              ` : nothing}
            </div>
          </header>

          <main class=${`workspace ${state.fullMap ? "full-map" : ""}`} style=${sheetOffset}>
            <div class="canvas">
              <${mapCanvasTag}
                class="map-canvas"
                style=${sheetOffset}
                .state=${state}
                .localize=${this.localize}
                .dates=${this.dates}
                .outlineEditor=${this.#outline.value}
                .narrow=${narrow}
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
              ${!narrow && precisionOpen ? html`
                <div class="precision-popover">
                  <${precisionControlsTag} compact .state=${state} .localize=${this.localize}></${precisionControlsTag}>
                </div>
              ` : nothing}
            </div>

            <!--
              One panel element, not two. It is a grid column when wide and a
              bottom sheet when narrow. Rendering both and hiding one with
              display:none meant two live workflow panels at all times, which
              made #dialogLauncherFor pick the hidden copy on narrow -- so
              cancelling a delete dialog on a phone restored focus to nothing --
              and left every primary action ambiguous under Playwright's strict
              mode.
            -->
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
                  ${state.workflow !== "none" && this._sheetDetent === "peek" ? html`
                    <button
                      class="sheet-back ms-btn ms-btn--icon ms-btn--sm"
                      type="button"
                      aria-label=${state.workflow === "plan" ? this.#t("v4_back_to_plans", "Back to plans") : this.#t("v4_back_to_all_tasks", "Back to all tasks")}
                      title=${state.workflow === "plan" ? this.#t("v4_back_to_plans", "Back to plans") : this.#t("v4_back_to_all_tasks", "Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${(event: Event) => this.#workflow(state.workflow === "plan" ? "plans" : "none", event.currentTarget)}
                    >${icon(iconBack)}</button>
                  ` : nothing}
                  <span class="sheet-status">${this.#sheetStatus(state, status)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#t("v4_show_more", "Expand panel")}
                    aria-controls="sheet-panel"
                    aria-disabled=${this._sheetDetent === "full" ? "true" : nothing}
                    @click=${() => this.#sheetStep(1)}
                  >${icon(iconChevronUp)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#t("v4_show_less", "Collapse panel")}
                    aria-controls="sheet-panel"
                    aria-disabled=${this._sheetDetent === "peek" ? "true" : nothing}
                    @click=${() => this.#sheetStep(-1)}
                  >${icon(iconChevronDown)}</button>
                </div>
                ${showDrawTools ? html`
                  <div class="sheet-tools">
                    ${chunkStatus(this.#tools("draw"), this.localize, this.#retry)}
                    ${renderDrawTools(state, { intent: (intent) => this.#intent(intent), openBrush: () => this.#openBrush(), t: (key, fallback, placeholders) => this.#t(key, fallback, placeholders) }, "grid")}
                    ${precisionOpen ? html`
                      <div class="precision-popover">
                        <${precisionControlsTag} compact inline .state=${state} .localize=${this.localize}></${precisionControlsTag}>
                      </div>
                    ` : nothing}
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
                  <div class="sheet-body" role="region" aria-labelledby="workspace-title">${this.#panel(state, narrow, status)}</div>
                </div>
                ${this.#actionBar(state, footerPrimary, footerSecondary)}
              ` : html`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${icon(status.icon)}</span>
                  <span class="status-copy"><strong>${status.title}</strong><small>${status.detail}</small></span>
                  ${statusAction
                    ? this.#actionButton(statusAction, "status-action ms-btn ms-btn--secondary", "status-reason")
                    : nothing}
                </div>
                <section class="workflow">
                  ${this.#panelTop(state)}
                  <div class="workflow-body" role="region" aria-labelledby="workspace-title">${this.#panel(state, narrow, status)}</div>
                  ${this.#actionBar(state, footerPrimary, footerSecondary)}
                </section>
              `}
            </aside>

            ${state.fullMap ? html`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${secondary ? "has-secondary" : ""} ${!narrow && (state.workflow === "draw" || (state.workflow === "rooms" && state.selection.roomIds.length > 0)) ? "above-dock" : ""}`}
                aria-label=${this.#t("v4_robot_status_and_action", "Robot status and action")}
              >
                <span class="hud-copy"><strong>${status.title}</strong><small>${status.detail}</small></span>
                ${locatingInFullMap && primary.id !== "stop" ? nothing : this.#actionButton(primary, "ms-btn ms-btn--lg ms-btn--primary", "hud-reason")}
                ${secondary && (!locatingInFullMap || secondary.id === "stop")
                  ? this.#actionButton(secondary, "ms-btn ms-btn--lg ms-btn--secondary", "hud-secondary-reason")
                  : nothing}
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
          ?inert=${Boolean(dialog) || this._helpOpen}
          @pointerenter=${this.#holdToast}
          @focusin=${this.#holdToast}
          @pointerleave=${this.#releaseToast}
          @focusout=${this.#releaseToast}
        >${toast ? this.#noticeBody(toast, this.#closeToast, this.#t("v4_hide_notification", "Hide notification")) : nothing}</div>

        <div class="sr-only" aria-live="polite" aria-atomic="true">${this._polite}</div>
        <div class="sr-only" role="alert" aria-atomic="true">${this._alert}</div>

        ${this._helpOpen ? this.#helpDialog() : nothing}

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
              <h2 id="dialog-title">${dialog.title}</h2>
              <div id="dialog-detail">
                <p>${dialog.detail}</p>
                ${dialog.consequence ? html`<p>${dialog.consequence}</p>` : nothing}
              </div>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${state.dialog === "discardDraft"
                    ? this.#keepDraft
                    : this.#dismissDialog}
                >${dialog.cancelLabel}</button>
                <button
                  class="discard ms-btn ms-btn--primary ms-btn--danger"
                  type="button"
                  @click=${() => this.#confirmDialog(dialog)}
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
