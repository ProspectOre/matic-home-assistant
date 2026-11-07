import { FOCUSABLE } from "./shell-focus";
import { SheetController } from "./sheet-controller";
import { LitElement, adoptStyles, nothing } from "lit";
import { shellStyles } from "./shell-styles";
import { html, unsafeStatic } from "lit/static-html.js";
import type { PropertyValues } from "lit";

import type {
  DateFormat,
  AcknowledgeQueueUncertainAction,
  DeleteSharedCadenceAction,
  HomePin,
  Localize,
  NoticePlaceholders,
  NoticeTone,
  NoButtonAction,
  PrimaryAction,
  QueueChangeAction,
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

import { LazyChunk, chunkStatus, reloadInto, takeResume, type ChunkStatus, type ChunkStatusCopy } from "./lazy-chunk";
import type { MapOptions } from "./map-options";
import type { MaticBackend } from "./backend";
import { isNativeSelectControl } from "./gesture-controller";
import { RovingFocusController } from "./roving-focus";
import { opaque, readColors, resolveFill, resolveTone, rgba, watchTheme, type Channel } from "./theme-probe";
import {
  icon,
  iconBack,
  iconChevronDown,
  iconChevronRight,
  iconChevronUp,
  iconClose,
  iconDiagnostics,
  iconHistory,
  iconHelp,
  iconPlan,
  iconNewArea,
  iconNoticeError,
  iconNoticeSuccess,
  iconNoticeWarning,
  iconRobot,
  iconExitFullMap,
  iconFullMap,
} from "./icons";
import {
  type MaticMapCanvasV4,
  WORKSPACE_ACTION_EVENT,
  WORKSPACE_INTENT_EVENT,
} from "./map-canvas";
import "./map-canvas";
import { translate } from "./localize";
import type { RendererModuleStatus } from "./renderer-controller";

import { needsDraftConfirmation } from "./draft-navigation";
import {
  canShowLiveMap,
  deleteSubject,
  hasStoppableWork,
  heldReasonKey,
  initialWorkspaceState,
  isSelectedRobotUnavailable,
  selectGoToRoomAction,
  selectStopSecondaryAction,
  selectGlobalPrimaryAction,
} from "./state";
import type { DialogPresentation } from "./dialog-copy";
import { homeState, homeWorkflowCopy, readyPlans, statusCopy, type StatusPresentation } from "./shell-presentation";

type LoadedWorkflowModule = typeof import("./workflow-panel") & typeof import("./workflow-actions");

const DRAW_OVERLAY_STATUS_COPY: ChunkStatusCopy = {
  loading: { key: "v4_draw_overlay_loading", fallback: "Loading map drawing…" },
  failed: { key: "v4_draw_overlay_failed", fallback: "Map drawing isn't available, so edits are paused. Reload the page to try again." },
};
const AREA_PREVIEW_STATUS_COPY: ChunkStatusCopy = {
  loading: { key: "v4_area_preview_loading", fallback: "Loading the area preview…" },
  failed: { key: "v4_area_preview_failed", fallback: "The map preview isn't available, so you can't review or save this area. Reload the page to try again." },
};

const mapCanvasTag = unsafeStatic(MAP_CANVAS_TAG);
const precisionControlsTag = unsafeStatic(PRECISION_CONTROLS_TAG);
const workflowTag = unsafeStatic(WORKFLOW_TAG);

// shell.md §4 notice rule: glyph per tone, and how long each toast stays.
const NOTICE_ICONS: Readonly<Record<NoticeTone, string>> = {
  info: iconDiagnostics,
  success: iconNoticeSuccess,
  warning: iconNoticeWarning,
  error: iconNoticeError,
};
const TOAST_MS: Readonly<Record<NoticeTone, number>> = { info: 6000, success: 4000, warning: 6000, error: 10000 };

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
    backend: { attribute: false },
    localize: { attribute: false },
    dates: { attribute: false },
    scheme: { attribute: false },
    _helpOpen: { state: true },
    _polite: { state: true },
    _alert: { state: true },
    _toast: { state: true },
    _queueRoom: { state: true },
  };

  static override styles = shellStyles;

  state: WorkspaceState = initialWorkspaceState();
  backend: MaticBackend | null = null;
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

  readonly #sheet = new SheetController(this, {
    state: () => this.state,
    helpOpen: () => this._helpOpen,
    helpReturnsFull: () => this.#helpReturnsFull,
    focusPanel: () => this.#focusPanel(),
    announce: (detent) => this.#announce("_polite", detent === "peek" ? this.#t("v4_workspace_height_peek", "Cleaning panel, collapsed")
      : detent === "half" ? this.#t("v4_workspace_height_half", "Cleaning panel, half height")
      : this.#t("v4_workspace_height_full", "Cleaning panel, full height")),
  });

  readonly #t = (key: string, fallback: string, placeholders?: NoticePlaceholders): string =>
    translate(this.localize, key, fallback, placeholders, this.dates);
  // Keep the toolbar launcher for focus return after Escape or Close.
  protected _helpOpen = false;
  #helpLauncher: HTMLElement | null = null;
  #helpReturnsFull = false;
  // The two live regions (shell.md §4 rule 6). Each holds only its newest
  // message: the polite one for detent, status title and non-error notices,
  // the alert one for error notices.
  protected _polite = "";
  protected _alert = "";
  #statusRow: string | null = null;
  #drawOverlayStatus: ChunkStatus = "idle";
  #announced = new Set<"_polite" | "_alert">();
  protected _toast: WorkspaceNotice | null = null;
  // The room the Change this clean controls act on; "" follows the robot.
  protected _queueRoom = "";
  // A chunk loads when the first view that needs it opens: the workflow views
  // with any workflow, the outline editor with Draw. The shell builds the
  // editor and hands it to the canvas, so the sheet is the one place a failure
  // of either, building included, is said.
  readonly #views = new LazyChunk(this, () => this.#workflowModule());
  readonly #planViews = new LazyChunk(this, () => import("./plan-views"));
  readonly #candidates = new LazyChunk(this, async () => {
    const module = await import("./room-candidates");
    const root = this.renderRoot as ShadowRoot;
    adoptStyles(root, [...root.adoptedStyleSheets, module.roomCandidateStyles]);
    return module;
  });
  readonly #drawTools = new LazyChunk(this, () => import("./draw-tools"));
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
  readonly #layerToolbar = new LazyChunk(this, async () => {
    const controls = await import("./map-layer-toolbar");
    const root = this.renderRoot as ShadowRoot;
    adoptStyles(root, [...root.adoptedStyleSheets, controls.layerToolbarStyles]);
    return controls;
  });
  #optionsPending = false;
  // The workflow a Try again reload was pressed in (lazy-chunk.ts).
  #resume = takeResume();
  #toastTimer: ReturnType<typeof setTimeout> | undefined;
  #toastDeadline = 0;
  #toastRemaining = 0;
  #toastHover = false;
  #toastFocus = false;
  #unwatchTheme: (() => void) | null = null;
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
  #candidateFocusPending = false;

  #focusRoomCandidates(): void {
    const picker = this.#candidateFocusPending && this.state.roomCandidates.length
      ? this.renderRoot.querySelector<HTMLElement>("[data-room-candidate-picker]") : null;
    if (picker) { picker.focus(); this.#candidateFocusPending = false; }
  }

  // Workflow views bring their shell and form rules. The independent Map
  // options module renders its own menu and shared switch rules.
  async #workflowModule(): Promise<LoadedWorkflowModule> {
    const [views, actions] = await Promise.all([
      import("./workflow-panel"),
      import("./workflow-actions"),
    ]);
    if (!this.#workflowStyled) {
      this.#workflowStyled = true;
      const root = this.renderRoot as ShadowRoot;
      // Lazy loaders adopt their styles as soon as each module arrives. Keep
      // those sheets when workflow styles load concurrently; replacing the
      // full list here can drop the map toolbar sheet after it was adopted.
      adoptStyles(root, [...root.adoptedStyleSheets, views.shellWorkflowStyles, views.formControls]);
    }
    return { ...views, ...actions };
  }

  // D3 (map-surfaces.md §10): Full map asks the browser for full screen
  // and leaves it on exit; leaving the browser's full screen (its own
  // Escape, say) leaves Full map with the same focus return. A browser
  // that refuses keeps the panel-only Full map.
  readonly #fullscreenChange = (): void => {
    if (!document.fullscreenElement && this.state.fullMap) this.#intent({ type: "exit-full-map" });
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.#sheet.connect();
    if (this.hasUpdated) this.#sheet.measure(this.getBoundingClientRect());
    document.addEventListener("fullscreenchange", this.#fullscreenChange);
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
    this.#sheet.disconnect();
    this.#unwatchTheme?.();
    this.#unwatchTheme = null;
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
    this.#sheet.captureFocus();
    if (!changed.has("state")) return;
    // Home Assistant flips its narrow hint as the panel resizes, but the
    // ResizeObserver can report frames later. Measure now so this render
    // never lays out from the old size and moves a control under a key press.
    const previous = changed.get("state") as WorkspaceState | undefined;
    if (this.isConnected && (!previous || previous.narrowHint !== this.state.narrowHint)) {
      this.#sheet.measure(this.getBoundingClientRect());
    }
    if (!previous) this.#sheet.resetForWorkflow(this.state, false);
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
    this.#focusRoomCandidates();
    if (changed.has("scheme") && changed.get("scheme") !== undefined) this.#resolveTheme();
    this.#sheet.afterRender();
    if (this.#optionsPending && this.#options.status !== "loading") {
      this.#optionsPending = false;
      this.#options.value?.menu.toggle();
    }
    if (changed.has("state")) {
      // The home rows populate #launchers during render, so consume a reload
      // resume only after the current state has produced its eligible rows.
      this.#resumeWorkflow();
      const previous = changed.get("state") as WorkspaceState | undefined;
      if (this.state.comparisonActive && !previous?.comparisonActive) this.#sheet.setDetent("full");
      if (this.state.roomCandidates.length && !previous?.roomCandidates.length) {
        this.#candidateFocusPending = true;
        this.#focusRoomCandidates();
      } else if (!this.state.roomCandidates.length && previous?.roomCandidates.length) {
        this.#candidateFocusPending = false;
        this.renderRoot.querySelector(MAP_CANVAS_TAG)?.shadowRoot?.querySelector<HTMLElement>(".map-root")?.focus();
      }
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
              ?? this.renderRoot.querySelector<HTMLElement>(".overflow")
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
      if (previous && !this.#pinRun && (previous.workflow !== this.state.workflow || previous.planView !== this.state.planView)) {
        this.#sheet.resetForWorkflow(this.state, true);
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
    if (this.state.map.available && this.#drawOverlayStatus !== "ready"
      && (action.id === "review-area" || action.id === "save-area")) return;
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
    this.#resume = null;
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
    if (open !== "none") {
      this.#resume = null;
      return;
    }
    if (this.#launchers.has(workflow)) {
      this.#resume = null;
      this.#workflow(workflow as Workflow);
    } else if (workflow === "draw" && this.#launchers.has("areas")) {
      this.#resume = null;
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

  readonly #drawOverlayStatusChanged = (status: RendererModuleStatus): void => {
    if (this.#drawOverlayStatus === status) return;
    this.#drawOverlayStatus = status;
    this.requestUpdate();
  };

  // The worst of the chunks `workflow` needs, each requested as it opens.
  #tools(workflow: Workflow): ChunkStatus {
    this.#views.request();
    const statuses = [this.#views.status];
    if (workflow === "plans" || workflow === "plan") {
      this.#planViews.request();
      statuses.push(this.#planViews.status);
    }
    if (workflow === "draw") {
      this.#outline.request();
      this.#drawTools.request();
      statuses.push(this.#outline.status, this.#drawTools.status);
    }
    if ((workflow === "draw" || workflow === "areaReview") && this.state.map.available) {
      statuses.push(this.#drawOverlayStatus);
    }
    return statuses.includes("failed") ? "failed" : statuses.every((status) => status === "ready") ? "ready" : "loading";
  }

  #workflowStatusCopy(workflow: Workflow): ChunkStatusCopy | undefined {
    const copy = workflow === "draw" ? DRAW_OVERLAY_STATUS_COPY
      : workflow === "areaReview" ? AREA_PREVIEW_STATUS_COPY : undefined;
    if (!copy) return undefined;
    if (this.#drawOverlayStatus === "failed") return copy.failed ? { failed: copy.failed } : undefined;
    if (this.#drawOverlayStatus !== "ready") return copy.loading ? { loading: copy.loading } : undefined;
    return undefined;
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

  #dispatchAction(action: string | ResetCadenceAction | DeleteSharedCadenceAction | QueueChangeAction | AcknowledgeQueueUncertainAction, settled?: SaveSettled): void {
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

  // ---- App bar ------------------------------------------------------------

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
      options.toggle();
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
    else this.#openHelp(event.currentTarget as HTMLElement);
  };

  // Help owns its small lazy chunk, so opening it never loads workflow views.
  #openHelp(launcher: HTMLElement | null): void {
    this.#helpLauncher = launcher;
    this.#helpReturnsFull = !this.state.fullMap && this.#sheet.sheet()?.dataset.detent === "full";
    if (this.#helpReturnsFull) this.#sheet.setDetent("peek");
    this.#mapHelpView.request();
    this._helpOpen = true;
  }

  #closeHelp(restoreFocus: boolean): void {
    this._helpOpen = false;
    if (restoreFocus && this.#helpReturnsFull && this.#sheet.detent === "peek") this.#sheet.setDetent("full");
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
    if (this.#sheet.detent === "peek" && this.#sheet.sheet()) this.#sheet.setDetent(this.#sheet.compact ? "full" : "half");
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
          : action.id === "stop-now" ? this.#t("v4_action_stop_now_dock", "Stop now & dock")
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

  // While the robot cleans a room, any room of the floor can be skipped, moved
  // next or cleaned again (docs/queue-changes.md). The integration refuses a
  // change the robot's queue can't take, and the notice says why.
  #queueControls(state: WorkspaceState) {
    const rooms = readyPlans(state)?.rooms ?? [];
    const plansReady = state.resources.plans.status === "ready";
    if (state.activity !== "cleaning" || state.smartStop || (plansReady && rooms.length === 0)) {
      return nothing;
    }
    if (!state.optionalUiReady) {
      if (state.resources.scene.status === "error") return this.#queueHeld();
      return state.host.administrator && state.host.connected && state.pageActive
        ? this.#queueLoading() : nothing;
    }
    if (!state.map.available && state.resources.plans.status !== "error") return this.#queueHeld();
    const render = this.#views.value?.queueControls;
    if (render) {
      if (plansReady && state.queueControllerStatus !== "ready") {
        if (state.queueControllerStatus === "error") return this.#queueLoading(chunkStatus("failed", this.localize, this.#retry));
        if (state.queueControllerStatus === "loading") return this.#queueLoading();
        return this.#queueHeld();
      }
      return render({ state, roomId: this._queueRoom,
        ...(this.localize === undefined ? {} : { localize: this.localize }),
        ...(this.dates === undefined ? {} : { dates: this.dates }),
        setRoom: (roomId) => { this._queueRoom = roomId; }, currentState: () => this.state,
        dispatch: (action) => this.#dispatchAction(action), retry: this.#retry });
    }
    if (this.#views.status === "failed") {
      return chunkStatus(this.#views.status, this.localize, this.#retry);
    }
    if (this.#views.status === "idle") this.#views.request();
    return this.#queueLoading();
  }

  #queueLoading(status: unknown = chunkStatus("loading", this.localize, this.#retry)) {
    return html`<section class="queue" aria-labelledby="queue-heading">
      <h3 class="ms-section-heading" id="queue-heading">${this.#t("v4_queue_heading", "Change this clean")}</h3>
      ${status}
    </section>`;
  }

  #queueHeld() {
    return this.#queueLoading(html`<p class="loading" role="status">${this.#t("v4_queue_catalog_held", "Queue changes are unavailable until the current map and room list are ready.")}</p>`);
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
      const runs = this.#shelfRow(t("v4_cleaning_history", "Cleaning history"), iconPlan, "runs", statusCopy(state).history
        ? t("v4_runs_last_unfinished", "The last run didn't finish. See what happened.")
        : t("v4_runs_quick_detail", "See recent cleans and how they ended."));
      const history = this.#shelfRow(t("v4_map_history", "Map history"), iconHistory, "history", t("v4_history_quick_detail", "Browse earlier floor maps."));
      const diagnostics = this.#shelfRow(t("v4_map_diagnostics", "Map diagnostics"), iconDiagnostics, "support", t("v4_diagnostics_quick_detail", "Check the map and copy details for support."));
      return html`
        <h3 class="ms-section-heading">${t("v4_maps_heading", "Maps")}</h3>
        <div class="shelf maps">${diagnosticsFirst ? [diagnostics, runs, history] : [runs, history, diagnostics]}</div>
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
    const mapFailed = !state.map.available && state.resources.scene.status === "error";
    const retry = mapFailed || kind === "map-unavailable" || kind === "map-limited" ? html`
      <div class="home-actions">
        <button class="ms-btn ms-btn--secondary" type="button"
          aria-disabled=${state.rechecking ? "true" : nothing}
          @click=${() => { if (!this.state.rechecking) this.#dispatchAction("recheck-status"); }}
        >${t("v4_retry", "Try again")}</button>
      </div>` : nothing;
    const priorityMaps = held ? maps(kind === "map-unavailable") : nothing;
    const queue = kind === "busy" ? this.#queueControls(state) : nothing;
    const pins = state.homePins.pins;
    const waiting = (status: string) => status === "idle" || status === "loading";
    const pending = !mapFailed && (waiting(state.homePins.status) || state.homePins.status === "ready" && pins.some((pin) =>
      pin.kind === "plan"
        ? waiting(state.resources.plans.status) && !state.resources.plans.value?.plans.some((plan) => plan.id === pin.id)
        : waiting(state.resources.areas.status) && !state.resources.areas.value?.areas.some((area) => area.id === pin.id)));
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
      ${queue}
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
      canReorder: pins.every((pin) => (pin.kind === "plan"
        ? state.resources.plans : state.resources.areas).status === "ready"),
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
        : chunkStatus(tools, this.localize, this.#retry, this.#workflowStatusCopy(state.workflow));
    }
    return html`<${workflowTag}
      .state=${state}
      .backend=${this.backend}
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
    const title = this.#workflowCopy(state).title;
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
    const { description } = this.#workflowCopy(state);
    // Home's demoted cards need a reason even when its visible copy is concise.
    const heldReason = state.workflow === "none" && !description && state.smartStop
      ? homeState(state) === "read-only"
        ? this.#t("v4_live_read_only_held_reason", "Cleaning is unavailable while the map is read only.")
        : homeState(state) === "busy" && state.smartStop.phase === "returning_to_dock"
          ? this.#t("v4_returning_held_reason", "Wait until the robot returns to the dock before starting another clean.")
          : ""
      : "";
    return html`
      ${description ? html`<p class="panel-description" id=${state.workflow === "none" ? "home-reason" : nothing}>${description}</p>` : nothing}
      ${heldReason ? html`<span class="sr-only" id="home-reason">${heldReason}</span>` : nothing}
      ${this.#workflowBody(state, narrow)}
    `;
  }

  #homeSmartStopSummary(state: WorkspaceState): boolean {
    const kind = homeState(state);
    return state.workflow === "none" && state.smartStop !== null
      && (kind === "busy" || kind === "paused")
      && state.command !== "settling" && state.activity !== "stopping"
      && !state.resources.entry?.stopSettlePending;
  }

  #sheetStatus(state: WorkspaceState, status: StatusPresentation): string {
    const workflow = this.#workflowCopy(state);
    const line = (state.workflow === "rooms" ? this.#views.value?.roomsGripLine(this.#t, state) : null) ?? workflow.title;
    // With the body open the h2 already names the workflow, so the grip line
    // carries the robot instead of repeating the title directly above it.
    if (this.#sheet.detent !== "peek" && this.#homeSmartStopSummary(state)) {
      const target = state.activity !== "paused" && (state.smartStop?.phase === "finishing_room" || state.smartStop?.phase === "finishing_area")
        ? state.smartStop.target : null;
      return target ? `${status.title} · ${target}` : status.title;
    }
    if (this.#sheet.detent !== "peek" || state.activity === "cleaning" || state.smartStop) {
      return status.detail ? `${status.title} · ${status.detail}` : status.title;
    }
    return status.notable ? `${status.title} · ${line}` : line;
  }

  #workflowCopy(state: WorkspaceState): { readonly title: string; readonly description: string } {
    if (state.workflow === "none") return homeWorkflowCopy(state, this.localize);
    const copy = this.#views.value?.workflowCopy(state, this.localize);
    if (copy) return copy;
    const title = state.workflow === "plan"
      ? state.planView === "run" ? state.planDraft.name
        : state.planDraft.id ? this.#t("v4_edit_plan", "Edit plan") : this.#t("v4_new_plan", "New plan")
      : state.workflow === "rooms" ? this.#t("v4_choose_rooms", "Choose rooms")
        : state.workflow === "draw" ? this.#t("v4_draw_area", "Draw an area")
          : state.workflow === "plans" ? this.#t("v4_your_plans", "Your plans")
            : state.workflow === "areas" ? this.#t("v4_your_areas", "Your areas")
              : state.workflow === "areaReview" ? this.#t("v4_name_this_area", "Name this area")
                : state.workflow === "history" ? this.#t("v4_map_history", "Map history")
                  : state.workflow === "support" ? this.#t("v4_map_diagnostics", "Map diagnostics")
                    : this.#t("v4_cleaning_history", "Cleaning history");
    return { title, description: "" };
  }

  // Keep a single workflow panel: the same element is a wide grid column or
  // narrow bottom sheet. Duplicate hidden panels break launcher focus return
  // and make primary actions ambiguous.
  protected override render() {
    // Home stands in for the Run view while a shortcut's run starts (#pinRun).
    const state: WorkspaceState = this.#pinRun ? { ...this.state, workflow: "none" } : this.state;
    const narrow = this.#sheet.narrow ?? state.narrowHint;
    const compact = narrow && this.#sheet.compact;
    const mapReady = state.map.available && (canShowLiveMap(state) || state.dataMode === "history");
    const hasFloorChoices = Boolean(state.host.administrator && state.host.robotCount > 0
      && state.selection.entryId
      && state.resources.entry?.entryId === state.selection.entryId
      && state.robots.some((robot) => robot.entryId === state.selection.entryId)
      && ((state.resources.history.value?.floors.length ?? 0) > 1 || state.selection.floorId !== "current"));
    const showFloorSwitcher = (mapReady && state.optionalUiReady) || (!mapReady && hasFloorChoices);
    if (showFloorSwitcher || isSelectedRobotUnavailable(state)) this.#layerToolbar.request();
    const showView = mapReady && !state.comparisonActive;
    const options = this.#options.value;
    const status = statusCopy(state, this.localize, this.dates);
    const shortSmartStop = this.#homeSmartStopSummary(state);
    const statusDetail = shortSmartStop
      ? state.activity !== "paused" && (state.smartStop?.phase === "finishing_room" || state.smartStop?.phase === "finishing_area")
        ? state.smartStop.target : null
      : status.detail;
    const roomEstimate = status.estimate ? html`<small class="room-estimate">${status.estimate}</small>` : nothing;
    const selectedRobotUnavailable = isSelectedRobotUnavailable(state);
    const selectedPrimary: PrimaryAction | NoButtonAction = selectGlobalPrimaryAction(state)
      ?? this.#views.value?.selectPrimaryAction(state)
      ?? { id: "workflow-loading", enabled: false };
    const drawOverlayReady = !state.map.available || this.#drawOverlayStatus === "ready";
    const primary: typeof selectedPrimary = !drawOverlayReady && (selectedPrimary.id === "review-area" || selectedPrimary.id === "save-area")
      ? { ...selectedPrimary, enabled: false,
        reason: "Wait for map drawing to load before reviewing or saving this area.",
        reasonKey: "v4_draw_overlay_action_unavailable" } as typeof selectedPrimary
      : selectedPrimary;
    // Stop takes the bar when work is stoppable (shell.md §3) and Redraw moves
    // into the body; else the area review pairs Redraw with its primary, held
    // with the R12 reason (map-surfaces.md §4).
    const held = heldReasonKey(state);
    const redraw: PrimaryAction | null = state.workflow === "areaReview" && !hasStoppableWork(state)
      ? { id: "redraw", label: "Redraw", labelKey: "v4_edit_outline", kind: "neutral", enabled: !held, ...(held ?? {}) }
      : null;
    const secondary = selectStopSecondaryAction(state) ?? redraw ?? selectGoToRoomAction(state);
    const statusAction = !narrow && ["stop", "stop-now"].includes(primary.id)
      ? primary
      : !narrow && secondary && ["stop", "stop-now"].includes(secondary.id) ? secondary : null;
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
      : narrow ? `--map-sheet-offset:${this.#sheet.offset}px` : "--map-sheet-offset:0px";
    const showDrawTools = narrow && state.workflow === "draw";
    const help = !this._helpOpen ? null : this.#mapHelpView.value
      ? this.#mapHelpView.value.renderMapHelp({ state, coarse: window.matchMedia("(any-pointer: coarse)").matches, t: this.#t, close: () => this.#closeHelp(true) })
      : chunkStatus(this.#mapHelpView.status, this.localize, this.#retry);
    const drawReady = this.#views.status === "ready" && this.#outline.status === "ready"
      && this.#drawTools.status === "ready"
      && (!state.map.available || this.#drawOverlayStatus === "ready");
    const precisionOpen = drawReady && state.precisionOpen && state.workflow === "draw";
    // Success and error always toast; info and warning only while the slot is
    // off-screen (sheet at peek, or Full map).
    const toast = this._toast && (this._toast.tone === "success" || this._toast.tone === "error"
      || state.fullMap || (narrow && this.#sheet.detent === "peek")) ? this._toast : null;
    return html`
      <div class=${`root ${narrow ? "narrow" : "wide"}${compact ? " compact" : ""}`} ?data-dock=${!narrow && state.workflow === "draw"} @keydown=${this.#keyboard}>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#skipToMap}>${this.#t("v4_skip_to_map", "Skip to the map")}</button>
        <button class="skip-link ms-btn ms-btn--primary" type="button" @click=${this.#skipToWorkspace}>${this.#t("v4_skip_to_workspace", "Skip to the panel")}</button>
        <div class="app" ?inert=${Boolean(dialog)}>
          <header class="app-bar" data-map-toolbar>
            <div class="toolbar-row">
            <div class="toolbar-context">
            <h1 class="title">${this.#t("map_studio_title", "Matic Map")}</h1>
            ${state.robots.length > 1 || selectedRobotUnavailable ? html`
              <select
                class="ms-select context-switcher robot-switcher"
                name="matic-robot"
                title=${selectedRobotUnavailable ? this.#t("v4_selected_robot_unavailable", "Selected robot unavailable") : state.robots.find((robot) => robot.entryId === state.selection.entryId)?.label}
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

            ${showFloorSwitcher ? this.#layerToolbar.value?.renderFloorSwitcher(state, this.#intent, this.#t) : nothing}
            </div>
            ${showView ? this.#layerToolbar.value?.renderCameraToolbar(
              state, this.#intent, this.#t, () => this.renderRoot.querySelector<MaticMapCanvasV4>(MAP_CANVAS_TAG)?.fitMap(),
            ) : nothing}
            <div class="toolbar-actions">
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
                class="overflow ms-btn"
                type="button"
                aria-haspopup=${options?.popupRole ?? "menu"}
                aria-expanded=${String(options?.menu.open ?? false)}
                aria-controls="map-options"
                @click=${this.#toggleOptions}
              >${this.#t("v4_map_toolbar_tools", "Tools")}</button>
              ${options?.menu.open ? options.render({
                state,
                t: this.#t,
                intent: this.#intent,
                diagnostics: this.#openDiagnostics,
                navigation: narrow ? () => this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })) : undefined,
              }) : nothing}
            </div>
            ${mapReady ? html`<button class="help ms-btn ms-btn--icon" type="button"
              aria-label=${this.#t("v4_how_to_move", "How to move the map")} title=${this.#t("v4_how_to_move", "How to move the map")}
              aria-expanded=${String(this._helpOpen)} aria-controls="navigation-help" @click=${this.#mapHelp}>${icon(iconHelp)}</button>` : nothing}
            </div></div>
            ${mapReady ? this.#layerToolbar.value?.renderLayerToolbar(state, this.#intent, this.#t)
              ?? chunkStatus(this.#layerToolbar.status, this.localize, this.#retry) : nothing}
            ${help}
          </header>

          <main class=${`workspace ${state.fullMap ? "full-map" : ""} ${state.comparisonActive ? "comparison" : ""}`} style=${sheetOffset}>
            <div class="canvas">
              <${mapCanvasTag}
                class="map-canvas"
                style=${sheetOffset}
                @matic-workspace-intent=${this.#mapIntent}
                .state=${state}
                .scheme=${this.scheme}
                .localize=${this.localize}
                .dates=${this.dates}
                .outlineEditor=${this.#outline.value}
                .renderDrawTools=${this.#drawTools.value?.renderDrawTools}
                .drawReady=${drawReady}
                .onDrawOverlayStatus=${this.#drawOverlayStatusChanged}
                .retry=${this.#retry}
                .narrow=${narrow}
                ?data-short=${compact && !state.fullMap && this.#sheet.detent === "full"}
                .recipes=${state.workflow === "draw" ? this.#views.value?.drawRecipes(this.#t) ?? null : null}
              >
                ${narrow && !state.fullMap && this.#sheet.detent === "full" ? html`
                  <button
                    class="sheet-scrim"
                    slot="scrim"
                    data-map-control
                    type="button"
                    aria-label=${this.#t("v4_collapse_sheet", "Collapse panel")}
                    @click=${() => this.#sheet.setDetent("peek")}
                  ></button>
                ` : nothing}
              </${mapCanvasTag}>
              ${state.roomCandidates.length ? html`<div style="position:absolute;inset-block-start:4rem;inset-inline-start:.75rem;max-inline-size:calc(100% - 1.5rem);z-index:6"
                @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); this.#intent({ type: "show-room-candidates", roomIds: [] }); } }}
              >${(this.#candidates.request(), this.#candidates.value?.renderRoomCandidates(state, this.#intent, this.#t)) ?? nothing}</div>` : nothing}
            </div>

            <aside
              id="map-workspace"
              class=${narrow ? "inspector mobile-sheet" : "inspector"}
              data-detent=${narrow ? this.#sheet.detent : nothing}
              data-workflow=${state.workflow}
              aria-label=${this.#t("v4_map_workspace", "Cleaning panel")}
            >
              ${narrow ? html`
                <div
                  class="sheet-grip"
                  @pointerdown=${this.#sheet.gripDown}
                  @pointermove=${this.#sheet.gripMove}
                  @pointerup=${this.#sheet.gripUp}
                  @pointercancel=${this.#sheet.gripUp}
                >
                  <span class="sheet-handle" role="presentation"></span>
                  ${this.#sheet.detent === "peek" ? this.#back(state, true) : nothing}
                  <span class="sheet-status">${this.#sheetStatus(state, status)}${roomEstimate}</span>
                  ${compact ? this.#actionBar(state, footerPrimary, footerSecondary) : nothing}
                  ${/* step is always +1 or -1 */ (compact ? [this.#sheet.detent === "full" ? -1 : 1] as const : [1, -1] as const).map((step) => html`<button
                    class="ms-btn ms-btn--icon ms-btn--sm"
                    type="button"
                    aria-label=${step < 0 ? this.#t("v4_show_less", "Collapse panel") : this.#t("v4_show_more", "Expand panel")}
                    aria-controls="sheet-panel"
                    ?disabled=${this.#helpReturnsFull || this.#sheet.detent === (step < 0 ? "peek" : "full")}
                    @click=${() => this.#sheet.step(step)}
                  >${icon(step < 0 ? iconChevronDown : iconChevronUp)}</button>`)}
                </div>
                ${showDrawTools ? html`
                  <div class="sheet-tools">
                    ${chunkStatus(this.#tools("draw"), this.localize, this.#retry, this.#workflowStatusCopy("draw"))}
                    ${sheetHint ? html`<p class="draw-hint sheet-hint">${sheetHint}</p>` : nothing}
                    ${precisionOpen ? html`<${precisionControlsTag} class="sheet-precision" .state=${state} .localize=${this.localize}></${precisionControlsTag}>` : nothing}
                    ${drawReady ? this.#drawTools.value?.renderDrawTools(state, { intent: this.#intent, openBrush: () => this.#intent({ type: "set-precision-open", value: !this.state.precisionOpen }), t: this.#t }, "grid") : nothing}
                  </div>
                ` : nothing}
                <div
                  class="sheet-panel"
                  id="sheet-panel"
                  @pointerdown=${this.#sheet.bodyDown}
                  @pointermove=${this.#sheet.bodyMove}
                  @pointerup=${this.#sheet.bodyUp}
                  @pointercancel=${this.#sheet.bodyUp}
                >
                  ${this.#panelTop(state)}
                  <div class="sheet-body" role="region" aria-labelledby="workspace-title">${this.#panel(state, narrow)}</div>
                </div>
                ${compact ? nothing : this.#actionBar(state, footerPrimary, footerSecondary)}
              ` : html`
                <div class="status-strip">
                  <span class="status-icon" aria-hidden="true">${icon(status.icon)}</span>
                  <span class="status-copy"><strong>${status.title}</strong>${statusDetail ? html`<small>${statusDetail}</small>` : nothing}${roomEstimate}</span>
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
                <span class="hud-copy"><strong>${status.title}</strong><small>${status.detail}</small>${roomEstimate}</span>
                ${locatingInFullMap && !["stop", "stop-now"].includes(primary.id) ? nothing : this.#actionButton(primary, "ms-btn ms-btn--lg ms-btn--primary", "hud-reason")}
                ${secondary && ["stop", "stop-now"].includes(secondary.id)
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
