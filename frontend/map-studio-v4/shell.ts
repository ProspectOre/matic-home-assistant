import { LitElement, nothing } from "lit";
import { shellStyles } from "./shell-styles";
import { html, unsafeStatic } from "lit/static-html.js";
import type { PropertyValues } from "lit";
import { isWorkspaceIntent } from "./contracts";

import type {
  Localize,
  PrimaryAction,
  WorkspaceIntent,
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
import { RovingFocusController } from "./roving-focus";
import {
  icon,
  iconBack,
  iconCharging,
  iconChevronDown,
  iconChevronRight,
  iconChevronUp,
  iconCleaning,
  iconDiagnostics,
  iconHistory,
  iconMenu,
  iconPlan,
  iconNewArea,
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
import "./precision-controls";
import "./workflow-panel";
import { translate } from "./localize";
import { needsDraftConfirmation } from "./draft-navigation";
import {
  initialWorkspaceState,
  selectStopSecondaryAction,
  selectPrimaryAction,
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
}

const statusCopy = (state: WorkspaceState, localize?: Localize): StatusPresentation => {
  const t = (key: string, fallback: string, placeholders?: Record<string, string | number>): string =>
    translate(localize, key, fallback, placeholders);
  if (!state.host.connected) return { title: t("v4_reconnecting", "Reconnecting"), detail: t("v4_ha_offline", "Home Assistant is offline"), icon: iconOffline, notable: true };
  if (!state.host.administrator) return { title: t("v4_access_required", "Access required"), detail: t("v4_admin_only", "Administrator only"), icon: iconOffline, notable: true };
  if (state.host.robotCount === 0) return { title: t("v4_no_robot_short", "No robot"), detail: t("v4_set_up_robot", "Set up a Matic robot"), icon: iconOffline, notable: true };
  if (!state.host.robotConnected) return { title: t("v4_robot_offline", "Robot offline"), detail: t("v4_last_map_read_only", "Last verified map · read only"), icon: iconOffline, notable: true };
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
      title: t("v4_task_in_progress", "Task in progress"),
      detail: state.activity === "docked"
        ? t("v4_task_docked", "Robot docked; the cleaning task has not finished.")
        : t("v4_task_waiting", "Waiting for the cleaning task to continue or finish."),
      icon: iconPlan,
      notable: true,
    };
  }
  if (state.command === "starting" && (state.activity === "idle" || state.activity === "docked")) {
    return { title: t("v4_action_starting", "Starting"), detail: t("v4_action_starting_detail", "Waiting for the robot to begin"), icon: iconRobot, notable: true };
  }
  if (state.activity === "cleaning") return { title: t("v4_cleaning", "Cleaning"), detail: t("v4_cleaning_progress", "Cleaning in progress"), icon: iconCleaning, notable: true };
  if (state.activity === "recharging") {
    const battery = state.batteryPercent === null
      ? t("v4_recharging_detail", "Will resume automatically when ready")
      : t("v4_recharging_battery", "Charging to resume · {percent}% battery", { percent: state.batteryPercent });
    return { title: t("v4_recharging", "Charging to resume"), detail: battery, icon: iconCharging, notable: true };
  }
  if (state.activity === "paused") return { title: t("v4_paused", "Paused"), detail: t("v4_can_resume", "Cleaning can resume"), icon: iconPaused, notable: true };
  if (state.activity === "returning") return { title: t("v4_returning", "Returning"), detail: t("v4_going_dock", "Going to the dock"), icon: iconCleaning, notable: true };
  if (state.activity === "stopping") return { title: t("v4_stopping", "Stopping"), detail: t("v4_waiting_robot", "Waiting for the robot"), icon: iconPaused, notable: true };
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
      return { title: t("v4_choose_rooms", "Choose rooms"), description: t("v4_choose_rooms_detail", "Select on the map or from the list.") };
    case "draw":
      return { title: t("v4_draw_area", "Draw an area"), description: t("v4_draw_area_detail", "Paint on the verified map, then review the details.") };
    case "plan":
      return { title: t("v4_cleaning_plan", "Cleaning plan"), description: t("v4_plan_detail", "Review rooms and cleaning settings.") };
    case "areaReview":
      return { title: t("v4_name_this_area", "Name this area"), description: t("area_details_hint", "Name the area and choose cleaning settings.") };
    case "history":
      return { title: t("v4_map_history", "Map history"), description: t("v4_map_history_detail", "Saved maps are floor-scoped and read only.") };
    case "support":
      return { title: t("v4_map_diagnostics", "Map diagnostics"), description: t("v4_map_support_detail", "Private geometry is never included.") };
    case "none":
      if (isReadOnlyWorkspace(state)) {
        return {
          title: t("v4_saved_map_read_only_title", "Saved map is read only"),
          description: t("v4_saved_map_read_only_detail", "Return to the live map to choose rooms, run a plan, or draw a custom area."),
        };
      }
      return { title: t("v4_what_to_clean", "What should the robot clean?"), description: t("v4_clean_detail", "Choose rooms, a saved plan, or a custom area.") };
  }
};

type SheetDetent = "peek" | "half" | "full";

const DETENTS: readonly SheetDetent[] = ["peek", "half", "full"];

// Where the sheet rests when a workflow opens. The map is the document, so a
// drawing starts at peek; room choices stay visible at half height, while
// longer forms (plans, diagnostics) start at full height.
const DEFAULT_DETENT: Readonly<Record<Workflow, SheetDetent>> = {
  none: "half",
  rooms: "half",
  draw: "peek",
  plan: "full",
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
  readonly atTop: boolean;
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

interface DialogPresentation {
  readonly title: string;
  readonly detail: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly action: "discard" | "delete-plan" | "delete-area" | "stop" | null;
}

const dialogCopy = (dialog: WorkspaceState["dialog"], localize?: Localize, plan = false): DialogPresentation | null => {
  const t = (key: string, fallback: string): string => translate(localize, key, fallback);
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
      return {
        title: t("v4_delete_plan", "Delete this plan?"),
        detail: t("v4_delete_plan_detail", "This removes the saved plan from Home Assistant. The robot will not move."),
        cancelLabel: t("v4_cancel", "Cancel"),
        confirmLabel: t("plan_delete", "Delete plan"),
        action: "delete-plan",
      };
    case "confirmDeleteArea":
      return {
        title: t("v4_delete_area", "Delete this area?"),
        detail: t("v4_delete_area_detail", "This removes the saved outline from Home Assistant. The robot will not move."),
        cancelLabel: t("v4_cancel", "Cancel"),
        confirmLabel: t("area_delete", "Delete area"),
        action: "delete-area",
      };
    case "confirmStop":
      return {
        title: t("v4_stop_cleaning", "Stop cleaning?"),
        detail: t("v4_stop_cleaning_detail", "The robot may take a moment to settle before another action is available."),
        cancelLabel: t("v4_keep_cleaning", "Keep cleaning"),
        confirmLabel: t("v4_stop", "Stop"),
        action: "stop",
      };
    case "error":
      return {
        title: t("v4_error", "Something went wrong"),
        detail: t("v4_error_detail", "No action was started. Close this message and try again when the map is ready."),
        cancelLabel: t("v4_close", "Close"),
        confirmLabel: t("v4_close", "Close"),
        action: null,
      };
    case null:
      return null;
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
    _measuredNarrow: { state: true },
    _sheetOffset: { state: true },
    _overflowOpen: { state: true },
    _helpOpen: { state: true },
    _browserFullscreen: { state: true },
    _sheetDetent: { state: true },
    _announcement: { state: true },
  };

  static override styles = shellStyles;

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;

  constructor() {
    super();
    new RovingFocusController(this, {
      container: () => this.renderRoot?.querySelector<HTMLElement>(".draw-tools") ?? null,
      items: "button",
    });
  }

  #t(key: string, fallback: string, placeholders?: Record<string, string | number>): string {
    return translate(this.localize, key, fallback, placeholders);
  }
  protected _measuredNarrow = false;
  protected _sheetOffset = 0;
  protected _overflowOpen = false;
  protected _helpOpen = false;
  protected _browserFullscreen = false;
  protected _sheetDetent: SheetDetent = "half";
  protected _announcement = "";
  #resizeObserver: ResizeObserver | null = null;
  #sheetResizeObserver: ResizeObserver | null = null;
  #observedSheet: Element | null = null;
  #dialogLauncher: HTMLElement | null = null;
  #workspaceLauncher: HTMLElement | null = null;
  #helpLauncher: HTMLElement | null = null;
  #pendingNavigation: WorkspaceIntent | null = null;
  #drag: SheetDrag | null = null;
  #bodySwipe: BodySwipe | null = null;

  readonly #fullscreenChange = (): void => {
    this._browserFullscreen = document.fullscreenElement === this.renderRoot.querySelector(".app");
  };

  readonly #outsidePointer = (event: PointerEvent): void => {
    if (!this._overflowOpen) return;
    const overflow = this.renderRoot.querySelector(".overflow-wrap");
    if (!overflow || !event.composedPath().includes(overflow)) this._overflowOpen = false;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = entry.contentRect.width < 768 || entry.contentRect.height < 480;
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
  }

  override disconnectedCallback(): void {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#sheetResizeObserver?.disconnect();
    this.#sheetResizeObserver = null;
    this.#observedSheet = null;
    window.removeEventListener("pointerdown", this.#outsidePointer, true);
    document.removeEventListener("fullscreenchange", this.#fullscreenChange);
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    // Protected reactive fields are not in `keyof this`, so the map is read
    // through the untyped view for those.
    const local = changed as PropertyValues;
    const sheet = this.renderRoot.querySelector(".mobile-sheet");
    if (sheet !== this.#observedSheet) {
      this.#sheetResizeObserver?.disconnect();
      this.#observedSheet = sheet;
      if (sheet) this.#sheetResizeObserver?.observe(sheet);
      else if (this._sheetOffset !== 0) this._sheetOffset = 0;
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
        void this.updateComplete.then(() => {
          requestAnimationFrame(() => launcher?.focus({ preventScroll: true }));
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

  #focusPanel(): void {
    const heading = this.renderRoot.querySelector<HTMLElement>(".panel-heading h2");
    if (isVisible(heading)) {
      heading.focus({ preventScroll: true });
      return;
    }
    const primary = this.renderRoot.querySelector<HTMLElement>(".action-bar .ms-btn--primary");
    if (isVisible(primary)) primary.focus({ preventScroll: true });
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

  #discardAndContinue(): void {
    const pending = this.#pendingNavigation;
    this.#pendingNavigation = null;
    if (pending?.type === "select-plan" || pending?.type === "select-area") {
      this.#intent({ type: "patch-plan-draft", patch: { dirty: false } });
      this.#intent({ type: "patch-area-draft", patch: { dirty: false } });
      this.#intent({ type: "dismiss-top-layer" });
    } else {
      this.#intent({ type: "discard-draft" });
    }
    if (pending) queueMicrotask(() => this.dispatchEvent(new CustomEvent<WorkspaceIntent>(WORKSPACE_INTENT_EVENT, {
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
      const workflow = this.renderRoot.querySelector<HTMLElement>(WORKFLOW_TAG);
      const plan = workflow?.shadowRoot?.querySelector<HTMLSelectElement>('[name="saved-plan"]');
      if (plan) plan.value = this.state.selection.planId ?? "";
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

  #dispatchAction(id: string): void {
    this.dispatchEvent(new CustomEvent(WORKSPACE_ACTION_EVENT, {
      detail: { id },
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
    this.#intent({ type: "dismiss-top-layer" });
    if (presentation.action === "stop") this.#dispatchAction("stop");
  }

  // ---- Bottom sheet -------------------------------------------------------

  #setDetent(detent: SheetDetent): void {
    if (detent === this._sheetDetent) return;
    this._sheetDetent = detent;
    this._announcement = this.#t("v4_workspace_height", "Map workspace, {height} height", { height: detent });
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

  #gripDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest("button, select, input, a")) return;
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
    sheet.style.transform = `translateY(${offset}px)`;
  }

  #gripUp(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.#drag = null;
    const sheet = this.#sheet();
    if (sheet) {
      sheet.style.transform = "";
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

  #bodyDown(event: PointerEvent): void {
    if (event.pointerType === "mouse") return;
    const body = event.currentTarget as HTMLElement;
    this.#bodySwipe = {
      pointerId: event.pointerId,
      startY: event.clientY,
      atTop: body.scrollTop === 0,
      consumed: false,
    };
  }

  #bodyMove(event: PointerEvent): void {
    const swipe = this.#bodySwipe;
    if (!swipe || swipe.consumed || !swipe.atTop || event.pointerId !== swipe.pointerId) return;
    const body = event.currentTarget as HTMLElement;
    if (body.scrollTop > 0) {
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

  #overflowAction(id: "support" | "classic" | "fullscreen"): void {
    this.#closeOverflow(id === "fullscreen");
    if (id === "support") {
      this.#workflow("support");
      return;
    }
    if (id === "fullscreen") {
      const app = this.renderRoot.querySelector<HTMLElement>(".app");
      if (document.fullscreenElement) void document.exitFullscreen();
      else void app?.requestFullscreen();
      return;
    }
    this.dispatchEvent(new CustomEvent(WORKSPACE_ACTION_EVENT, {
      detail: { id: "use-classic" },
      bubbles: true,
      composed: true,
    }));
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

  #actionButton(action: PrimaryAction, classes: string, reasonId: string) {
    if (action.id === "choose-cleaning") return nothing;
    const label = action.labelKey ? this.#t(action.labelKey, action.label) : action.label;
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

  #roomNames(state: WorkspaceState): string[] {
    const rooms = state.resources.plans.value?.rooms
      ?? state.resources.areas.value?.rooms
      ?? [];
    return state.selection.roomIds.map((roomId) =>
      rooms.find((room) => room.roomId === roomId)?.name ?? roomId);
  }

  #actionBar(state: WorkspaceState, primary: PrimaryAction | null, secondary: PrimaryAction | null) {
    const summary = primary?.enabled && state.workflow === "rooms" && primary.id === "clean-rooms"
      ? [
        this.#roomNames(state).join(", "),
        state.planDraft.returnToBase ? this.#t("v4_returns_to_dock", "returns to the dock") : "",
      ].filter(Boolean).join(" · ")
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

  #shelfRow(label: string, glyph: string, onClick: () => void, detail?: string, disabled = false) {
    return html`
      <button
        class="ms-row"
        type="button"
        aria-disabled=${disabled ? "true" : nothing}
        @click=${() => { if (!disabled) onClick(); }}
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
            ? ` · ${this.#t("v4_floor_not_captured", "Visit floor to capture")}`
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

  #entry(state: WorkspaceState, narrow: boolean) {
    const t = (key: string, fallback: string, placeholders?: Record<string, string | number>): string =>
      this.#t(key, fallback, placeholders);
    const historyRow = this.#shelfRow(
      t("v4_map_history", "Map history"),
      iconHistory,
      () => this.#workflow("history"),
      t("v4_map_history_detail", "Saved maps are floor-scoped and read only."),
    );
    const diagnosticsRow = this.#shelfRow(
      t("v4_map_diagnostics", "Map diagnostics"),
      iconDiagnostics,
      () => this.#workflow("support"),
      t("v4_map_support_detail", "Private geometry is never included."),
    );
    const { host } = state;
    if (!host.connected) return this.#hostState(t("v4_reconnecting_title", "Reconnecting to Home Assistant"), t("v4_reconnecting_body", "The last verified map stays read-only until the connection returns."));
    if (!host.administrator) return this.#hostState(t("v4_admin_title", "Administrator access required"), t("v4_admin_body", "Ask a Home Assistant administrator to open this map."));
    if (host.robotCount === 0) {
      return this.#hostState(
        t("v4_no_robot_title", "No Matic robot set up"),
        t("v4_no_robot_body", "Add the Matic integration to see a map here."),
        html`<a class="ms-btn ms-btn--secondary" href="/config/integrations/integration/matic_robot">${t("v4_open_integration", "Open the Matic integration")}</a>`,
      );
    }
    if (!host.robotConnected) {
      return html`
        ${this.#hostState(t("v4_robot_offline_title", "Robot offline"), t("v4_robot_offline_body", "Showing the last verified map. Cleaning is unavailable until the robot reconnects."))}
        <h3 class="shelf-heading">${t("v4_more", "Map tools")}</h3>
        <div class="shelf">${historyRow}${diagnosticsRow}</div>
      `;
    }
    if (isReadOnlyWorkspace(state)) {
      return html`
        ${this.#hostState(
          t("v4_saved_map_read_only_notice", "Cleaning is unavailable on a saved map"),
          t("v4_saved_map_read_only_notice_detail", "Saved maps are view only. Return to the live map below to choose rooms, run a plan, or draw a custom area."),
        )}
        <h3 class="shelf-heading">${t("v4_more", "Map tools")}</h3>
        <div class="shelf">
          ${historyRow}
          ${diagnosticsRow}

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
      : noRooms ? t("v4_no_rooms_reason", "This floor has no named rooms yet.") : null;
    const planReason = locating
      ? t("v4_reason_locating", "Waiting for the robot to confirm which floor it is on.")
      : null;
    const customAreaReason = locating
      ? t("v4_reason_locating", "Waiting for the robot to confirm which floor it is on.")
      : t("v4_areas_quick_detail", "Sketch a one-time zone on the map");
    return html`
      ${state.activity === "problem"
        ? this.#hostState(t("v4_attention_title", "The robot needs attention"), t("v4_attention_body", "Check the robot, then start a new task."))
        : html`
          <div class="quick-actions" aria-label=${t("v4_cleaning_choices", "Cleaning choices")}>
            <button
              class="ms-row ms-row--card ms-row--featured"
              type="button"
              aria-disabled=${roomsDisabled ? "true" : nothing}
              @click=${() => { if (!roomsDisabled) this.#workflow("rooms"); }}
            >
              <span class="ms-row__lead">${icon(iconRobot)}</span>
              <span class="ms-row__body">
                <strong>${t("v4_clean_rooms", "One-time clean")}</strong>
                <small>${roomsReason ?? t("v4_clean_rooms_hint", "Choose rooms for this run")}</small>
              </span>
              <span class="ms-row__trail">${icon(iconChevronRight)}</span>
            </button>
            <button
              class="ms-row ms-row--card"
              type="button"
              aria-disabled=${locating ? "true" : nothing}
              @click=${() => { if (!locating) this.#workflow("plan"); }}
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
                  ? t("v4_plans_loading_hint", "Reading routines for this floor")
                  : plansUnavailable
                    ? t("v4_plans_unavailable_hint", "Try again to load saved routines")
                    : planCount
                      ? planCount === 1 ? t("v4_saved_routine", "1 saved routine") : t("v4_saved_routines", "{count} saved routines", { count: planCount })
                      : t("v4_no_plans_hint", "Save a room routine you can repeat"))}</small>
              </span>
              <span class="ms-row__trail">${icon(iconChevronRight)}</span>
            </button>
          </div>
        `}
      <h3 class="shelf-heading">${t("v4_more", "Map tools")}</h3>
      <div class="shelf">
        ${this.#shelfRow(
          t("v4_custom_areas", "Clean a custom area"),
          iconNewArea,
          () => this.#workflow("draw"),
          customAreaReason,
          locating,
        )}
        ${historyRow}

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
            >${t("v4_room_colours", "Floor plan")}</button>
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

  #workflowBody(state: WorkspaceState, narrow: boolean) {
    if (state.workflow === "none") return this.#entry(state, narrow);
    return html`<${workflowTag}
      .state=${state}
      .localize=${this.localize}
      @matic-workspace-intent=${this.#captureDialogLauncher}
    ></${workflowTag}>`;
  }

  #panel(state: WorkspaceState, narrow: boolean) {
    const workflow = workflowCopy(state, this.localize);
    return html`
      <div class="panel-heading">
        ${state.workflow !== "none" ? html`
          <button
            class="panel-back ms-btn ms-btn--secondary"
            type="button"
            aria-label=${this.#t("v4_back_to_all_tasks", "Back to all tasks")}
            data-dialog-launcher="discardDraft"
            @click=${(event: Event) => this.#workflow("none", event.currentTarget)}
          >${icon(iconBack)}<span class="ms-btn__label">${this.#t("v4_all_tasks", "All tasks")}</span></button>
        ` : nothing}
        <h2 tabindex="-1">${workflow.title}</h2>
      </div>
      <p class="panel-description">${workflow.description}</p>
      ${this.#workflowBody(state, narrow)}
    `;
  }

  #sheetStatus(state: WorkspaceState, status: StatusPresentation): string {
    const workflow = workflowCopy(state, this.localize);
    let line = workflow.title;
    if (state.workflow === "rooms" && state.selection.roomIds.length) {
      line = `${this.#t("v4_rooms_selected", "Rooms selected: {count}", { count: state.selection.roomIds.length })} · ${this.#roomNames(state).join(", ")}`;
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
    const primary = selectPrimaryAction({ ...state, narrowHint: narrow });
    const secondary = selectStopSecondaryAction(state);
    const statusAction = !narrow && primary.id === "stop"
      ? primary
      : !narrow && secondary?.id === "stop" ? secondary : null;
    const footerPrimary = statusAction && statusAction === primary ? null : primary;
    const clearDrawing: PrimaryAction | null = state.workflow === "draw" && state.dataMode === "live"
      ? {
        id: "clear-draft",
        label: "Clear drawing",
        labelKey: "v4_clear_drawing",
        kind: "neutral",
        enabled: state.draw.circles.length > 0,
      }
      : null;
    const footerSecondary = statusAction && statusAction === secondary ? null : (secondary ?? clearDrawing);
    const locatingInFullMap = state.fullMap
      && (state.coherence === "verifying" || state.coherence === "booting");
    const canToggleWorkspace = state.fullMap || (
      state.host.administrator && state.host.robotCount > 0 && state.map.available
    );
    const dialog = dialogCopy(state.dialog, this.localize, state.workflow === "plan");
    const sheetOffset = narrow && !state.fullMap ? `--map-sheet-offset:${this._sheetOffset}px` : "--map-sheet-offset:0px";
    const showDrawTools = narrow && state.workflow === "draw";
    const precisionOpen = state.precisionOpen && state.workflow === "draw";
    return html`
      <div class=${`root ${narrow ? "narrow" : "wide"}`} @keydown=${this.#keyboard}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#skipToMap}>${this.#t("v4_skip_to_map", "Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#skipToWorkspace}>${this.#t("v4_skip_to_workspace", "Skip to the map workspace")}</button>
        <div class="app" ?inert=${Boolean(dialog) || this._helpOpen}>
          <header class="app-bar">
            ${state.precisionOpen ? html`
              <button
                class="nav ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#t("v4_back", "Back")}
                @click=${() => this.#intent({ type: "dismiss-top-layer" })}
              >${icon(iconBack)}</button>
            ` : nothing}
            <h1 class="title">${this.#t("map_studio_title", "Matic Map")}</h1>
            ${state.robots.length > 1 ? html`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                aria-label=${this.#t("v4_choose_robot", "Choose robot")}
                .value=${state.selection.entryId || ""}
                @change=${(event: Event) => this.#intent({
                  type: "select-entry",
                  entryId: (event.currentTarget as HTMLSelectElement).value,
                })}
              >${state.robots.map((robot) => html`
                <option value=${robot.entryId} ?selected=${robot.entryId === state.selection.entryId}>${robot.label}</option>
              `)}</select>
            ` : nothing}

            <span class="spacer"></span>
            ${canToggleWorkspace ? html`
              <button
                class="workspace-toggle ms-btn ms-btn--icon"
                type="button"
                aria-label=${state.fullMap
                  ? this.#t("v4_show_workspace", "Show workspace")
                  : this.#t("v4_hide_workspace", "Hide workspace")}
                aria-controls="map-workspace"
                aria-expanded=${String(!state.fullMap)}
                title=${state.fullMap
                  ? this.#t("v4_show_workspace", "Show workspace")
                  : this.#t("v4_hide_workspace", "Hide workspace")}
                @click=${this.#toggleWorkspace}
              >${icon(iconWorkspace)}</button>
            ` : nothing}
            ${!state.precisionOpen ? html`
              <button
                class="nav nav--menu ms-btn ms-btn--icon"
                type="button"
                aria-label=${this.#t("v4_open_navigation", "Open navigation")}
                title=${this.#t("v4_open_navigation", "Open navigation")}
                @click=${this.#toggleNavigation}
              >${icon(iconMenu)}</button>
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
                  <label class="overflow-field ms-field">${this.#t("map_quality_label", "Scene detail")}
                    <select
                      aria-label=${this.#t("map_quality_label", "Scene detail")}
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
                  <button class="ms-row ms-row--menu" type="button" @click=${() => this.#overflowAction("classic")}>${this.#t("v4_switch_classic", "Open classic map view")}</button>
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
                .narrow=${narrow}
              >${this.#floorSwitcher(state)}</${mapCanvasTag}>
              ${!narrow && precisionOpen ? html`
                <div class="precision-popover">
                  <${precisionControlsTag} compact .state=${state} .localize=${this.localize}></${precisionControlsTag}>
                </div>
              ` : nothing}
            </div>

            ${narrow && !state.fullMap && this._sheetDetent === "full" ? html`
              <button
                class="sheet-scrim"
                type="button"
                aria-label=${this.#t("v4_collapse_sheet", "Collapse the map workspace")}
                @click=${() => this.#setDetent("peek")}
              ></button>
            ` : nothing}

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
              aria-label="Map workspace"
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
                      aria-label=${this.#t("v4_back_to_all_tasks", "Back to all tasks")}
                      title=${this.#t("v4_back_to_all_tasks", "Back to all tasks")}
                      data-dialog-launcher="discardDraft"
                      @click=${(event: Event) => this.#workflow("none", event.currentTarget)}
                    >${icon(iconBack)}</button>
                  ` : nothing}
                  <span class="sheet-status">${this.#sheetStatus(state, status)}</span>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#t("v4_show_more", "Show more of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent === "full" ? "true" : nothing}
                    @click=${() => this.#sheetStep(1)}
                  >${icon(iconChevronUp)}</button>
                  <button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${this.#t("v4_show_less", "Show less of the map workspace")}
                    aria-controls="sheet-body"
                    aria-disabled=${this._sheetDetent === "peek" ? "true" : nothing}
                    @click=${() => this.#sheetStep(-1)}
                  >${icon(iconChevronDown)}</button>
                </div>
                ${showDrawTools ? html`
                  <div class="sheet-tools">
                    ${renderDrawTools(state, { intent: (intent) => this.#intent(intent), openBrush: () => this.#openBrush(), t: (key, fallback) => this.#t(key, fallback) }, "grid")}
                    ${precisionOpen ? html`
                      <div class="precision-popover">
                        <${precisionControlsTag} compact inline .state=${state} .localize=${this.localize}></${precisionControlsTag}>
                      </div>
                    ` : nothing}
                  </div>
                ` : nothing}
                <div
                  class="sheet-body"
                  id="sheet-body"
                  @pointerdown=${this.#bodyDown}
                  @pointermove=${this.#bodyMove}
                  @pointerup=${this.#bodyUp}
                  @pointercancel=${this.#bodyUp}
                >
                  ${this.#panel(state, narrow)}
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
                  <div class="workflow-body">${this.#panel(state, narrow)}</div>
                  ${this.#actionBar(state, footerPrimary, footerSecondary)}
                </section>
              `}
            </aside>

            ${state.fullMap ? html`
              <section
                class=${`full-map-hud ms-surface ms-surface--floating ${secondary ? "has-secondary" : ""} ${!narrow && (state.workflow === "draw" || (state.workflow === "rooms" && state.selection.roomIds.length > 0)) ? "above-dock" : ""}`}
                aria-label="Robot status and action"
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

        <div class="sr-only" aria-live="polite" aria-atomic="true">${[this._announcement, state.notice?.text ?? ""].filter(Boolean).join(" ")}</div>

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
              <p id="dialog-detail">${dialog.detail}</p>
              <div class="dialog-actions">
                <button
                  class="ms-btn ms-btn--secondary"
                  type="button"
                  data-dialog-initial-focus
                  @click=${state.dialog === "discardDraft"
                    ? this.#keepDraft
                    : this.#dismissDialog}
                >${dialog.cancelLabel}</button>
                ${dialog.action === null ? nothing : html`
                  <button
                    class="discard ms-btn ms-btn--primary ms-btn--danger"
                    type="button"
                    @click=${() => this.#confirmDialog(dialog)}
                  >${dialog.confirmLabel}</button>
                `}
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
