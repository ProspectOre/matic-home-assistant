import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";

import type {
  Localize,
  PrimaryAction,
  WorkspaceIntent,
  WorkspaceState,
  Workflow,
} from "./contracts";
import {
  WORKSPACE_ACTION_EVENT,
  WORKSPACE_INTENT_EVENT,
} from "./map-canvas";
import "./map-canvas";
import "./precision-controls";
import { translate } from "./localize";
import {
  initialWorkspaceState,
  selectPausedSecondaryAction,
  selectPrimaryAction,
} from "./state";

const statusCopy = (state: WorkspaceState, localize?: Localize): { readonly title: string; readonly detail: string } => {
  const t = (key: string, fallback: string, placeholders?: Record<string, string | number>): string =>
    translate(localize, key, fallback, placeholders);
  if (!state.host.connected) return { title: t("v4_reconnecting", "Reconnecting"), detail: t("v4_ha_offline", "Home Assistant is offline") };
  if (!state.host.administrator) return { title: t("v4_access_required", "Access required"), detail: t("v4_admin_only", "Administrator only") };
  if (state.host.robotCount === 0) return { title: t("v4_no_robot_short", "No robot"), detail: t("v4_set_up_robot", "Set up a Matic robot") };
  if (!state.host.robotConnected) return { title: t("v4_robot_offline", "Robot offline"), detail: t("v4_last_map_read_only", "Last verified map · read only") };
  if (state.activity === "problem") return { title: t("v4_needs_attention", "Needs attention"), detail: t("v4_check_robot", "Check the robot") };
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
    };
  }
  if (state.coherence === "verifying" || state.coherence === "booting") {
    return { title: t("v4_locating", "Locating"), detail: t("v4_finding_map", "Finding the current map") };
  }
  if (state.activity === "cleaning") return { title: t("v4_cleaning", "Cleaning"), detail: t("v4_cleaning_progress", "Cleaning in progress") };
  if (state.activity === "paused") return { title: t("v4_paused", "Paused"), detail: t("v4_can_resume", "Cleaning can resume") };
  if (state.activity === "returning") return { title: t("v4_returning", "Returning"), detail: t("v4_going_dock", "Going to the dock") };
  if (state.activity === "stopping") return { title: t("v4_stopping", "Stopping"), detail: t("v4_waiting_robot", "Waiting for the robot") };
  const battery = state.batteryPercent === null
    ? t("v4_ready", "Ready")
    : t("v4_battery", "{percent}% battery", { percent: state.batteryPercent });
  return { title: state.activity === "docked" ? t("v4_docked", "Docked") : t("v4_ready", "Ready"), detail: battery };
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
      return { title: t("v4_plan", "Plan"), description: t("v4_plan_detail", "Review rooms and cleaning settings.") };
    case "areaReview":
      return { title: t("area_details", "Area details"), description: t("area_details_hint", "Name the area and choose cleaning settings.") };
    case "history":
      return { title: t("v4_map_history", "Map history"), description: t("v4_map_history_detail", "Saved maps are floor-scoped and read only.") };
    case "support":
      return { title: t("v4_map_support", "Map support"), description: t("v4_map_support_detail", "Private geometry is never included.") };
    case "none":
      return { title: t("v4_clean", "Start cleaning"), description: t("v4_clean_detail", "Choose rooms, a saved plan, or a custom area.") };
  }
};

type SheetDetent = "peek" | "half" | "full";

interface DialogPresentation {
  readonly title: string;
  readonly detail: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly action: "discard" | "delete-plan" | "delete-area" | "stop" | null;
}

const dialogCopy = (dialog: WorkspaceState["dialog"], localize?: Localize): DialogPresentation | null => {
  const t = (key: string, fallback: string): string => translate(localize, key, fallback);
  switch (dialog) {
    case "discardDraft":
      return {
        title: t("v4_discard_area", "Discard this area?"),
        detail: t("v4_discard_area_detail", "The outline has not been saved. You can keep drawing or discard it."),
        cancelLabel: t("v4_keep_drawing", "Keep drawing"),
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

export class MaticMapShellV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    _measuredNarrow: { state: true },
    _sheetOffset: { state: true },
    _workflowReady: { state: true },
    _overflowOpen: { state: true },
    _browserFullscreen: { state: true },
    _sheetDetent: { state: true },
  };

  static override styles = css`
    :host {
      display: block;
      min-inline-size: 0;
      min-block-size: 0;
      block-size: 100%;
      color: var(--primary-text-color, #1f2933);
      background: var(--primary-background-color, #f5f7f8);
      container-type: size;
    }

    * { box-sizing: border-box; }
    button { font: inherit; }

    .root { min-block-size: 0; block-size: 100%; }

    .app {
      display: grid;
      grid-template-rows: 3.5rem minmax(0, 1fr);
      min-block-size: 36rem;
      block-size: 100%;
      background: var(--primary-background-color, #f5f7f8);
    }

    .app-bar {
      position: relative;
      z-index: 12;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-inline-size: 0;
      padding-inline: max(0.75rem, env(safe-area-inset-left)) max(0.75rem, env(safe-area-inset-right));
      border-block-end: 1px solid var(--divider-color, rgb(60 75 85 / 14%));
      background: var(--app-header-background-color, var(--card-background-color, #fff));
      box-shadow: 0 1px 5px rgb(31 41 51 / 8%);
    }

    .nav, .overflow, .robot-switcher {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      border: 0;
      border-radius: 0.7rem;
      color: inherit;
      background: transparent;
      cursor: pointer;
    }

    select.robot-switcher {
      max-inline-size: 11rem;
      padding-inline: 0.55rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      background: var(--card-background-color, #fff);
      text-overflow: ellipsis;
    }

    .title {
      overflow: hidden;
      min-inline-size: 0;
      margin: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 1rem;
      font-weight: 730;
      letter-spacing: -0.015em;
    }

    .spacer { flex: 1; }

    .overflow-wrap { position: relative; }
    .overflow-menu {
      position: absolute;
      z-index: 18;
      inset-block-start: calc(100% + 0.35rem);
      inset-inline-end: 0;
      display: grid;
      gap: 0.2rem;
      min-inline-size: 13rem;
      padding: 0.35rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      border-radius: 0.75rem;
      background: var(--card-background-color, #fff);
      box-shadow: 0 12px 32px rgb(31 41 51 / 20%);
    }
    .overflow-menu button {
      min-block-size: 2.75rem;
      padding-inline: 0.75rem;
      border: 0;
      border-radius: 0.55rem;
      color: inherit;
      background: transparent;
      text-align: start;
      cursor: pointer;
    }
    .overflow-menu button:hover { background: var(--secondary-background-color, #f3f6f7); }
    .overflow-field {
      display: grid;
      gap: 0.25rem;
      padding: 0.45rem 0.75rem;
      color: var(--secondary-text-color, #60717c);
      font-size: 0.72rem;
      font-weight: 650;
    }
    .overflow-field select {
      min-block-size: 2.5rem;
      padding-inline: 0.55rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 18%));
      border-radius: 0.55rem;
      color: var(--primary-text-color, #1f2933);
      background: var(--card-background-color, #fff);
      font: inherit;
    }

    .header-state {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-inline-size: 0;
      color: var(--secondary-text-color, #60717c);
      font-size: 0.78rem;
      font-weight: 650;
      white-space: nowrap;
    }

    .header-state::before {
      content: "";
      inline-size: 0.48rem;
      block-size: 0.48rem;
      border-radius: 50%;
      background: var(--success-color, #2f9e61);
    }

    .workspace {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(19rem, 22.5rem);
      min-inline-size: 0;
      min-block-size: 0;
    }

    .workspace.full-map { grid-template-columns: minmax(0, 1fr); }
    .workspace.full-map .inspector,
    .workspace.full-map .mobile-sheet { display: none; }

    .canvas { min-inline-size: 0; min-block-size: 0; }
    matic-map-canvas-v4 { block-size: 100%; }

    .inspector {
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
      min-block-size: 0;
      border-inline-start: 1px solid var(--divider-color, rgb(60 75 85 / 14%));
      background: var(--card-background-color, #fff);
    }

    .status-strip {
      display: grid;
      grid-template-columns: 2.35rem minmax(0, 1fr);
      gap: 0.7rem;
      align-items: center;
      padding: 0.85rem 1rem;
      border-block-end: 1px solid var(--divider-color, rgb(60 75 85 / 12%));
    }

    .status-icon {
      display: grid;
      place-items: center;
      inline-size: 2.35rem;
      block-size: 2.35rem;
      border-radius: 50%;
      color: var(--primary-color, #0678ce);
      background: color-mix(in srgb, var(--primary-color, #0678ce) 11%, transparent);
    }

    .status-strip strong, .status-strip small { display: block; }
    .status-strip strong { font-size: 0.82rem; }
    .status-strip small { margin-block-start: 0.12rem; color: var(--secondary-text-color, #687984); font-size: 0.72rem; }

    .workflow {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-block-size: 0;
      padding: 1.15rem;
      overflow: auto;
    }

    .workflow h2 { margin: 0; font-size: 1.15rem; letter-spacing: -0.02em; }
    .workflow > p { margin: 0.35rem 0 1rem; color: var(--secondary-text-color, #687984); font-size: 0.8rem; line-height: 1.48; }

    .quick-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
    .quick-actions button, .room-row {
      min-block-size: 3.25rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 17%));
      border-radius: 0.75rem;
      color: inherit;
      background: var(--secondary-background-color, #f4f7f8);
    }

    .quick-actions button {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.55rem;
      align-items: center;
      min-block-size: 4.4rem;
      padding: 0.72rem 0.8rem;
      cursor: pointer;
      text-align: start;
    }
    .quick-actions button:hover { border-color: color-mix(in srgb, var(--primary-color, #0678ce) 42%, transparent); }
    .quick-actions button:focus-visible { outline: 2px solid var(--primary-color, #0678ce); outline-offset: 2px; }
    .quick-actions button.featured {
      border-color: color-mix(in srgb, var(--primary-color, #0678ce) 30%, transparent);
      background: color-mix(in srgb, var(--primary-color, #0678ce) 9%, var(--card-background-color, #fff));
    }
    .quick-copy { min-inline-size: 0; }
    .quick-copy strong, .quick-copy small { display: block; }
    .quick-copy strong { font-size: 0.82rem; font-weight: 720; }
    .quick-copy small { margin-block-start: 0.18rem; color: var(--secondary-text-color, #687984); font-size: 0.7rem; line-height: 1.35; }
    .quick-arrow { color: var(--secondary-text-color, #687984); font-size: 1rem; }
    .room-list { display: grid; gap: 0.5rem; }
    .room-row { display: flex; align-items: center; gap: 0.65rem; padding-inline: 0.8rem; font-size: 0.8rem; }
    .check { color: var(--primary-color, #0678ce); font-weight: 800; }

    .primary-stack { display: grid; gap: 0.5rem; margin-block-start: auto; padding-block-start: 1rem; }
    .primary-action, .secondary-action {
      min-block-size: 2.75rem;
      border: 0;
      border-radius: 0.72rem;
      cursor: pointer;
      font-weight: 720;
    }

    .primary-action {
      color: white;
      background: var(--primary-color, #0678ce);
      box-shadow: 0 6px 16px rgb(6 120 206 / 20%);
    }

    .primary-action.danger { background: var(--error-color, #c43b3b); }
    .primary-action:disabled {
      cursor: default;
      opacity: 1;
      color: var(--disabled-text-color, #89969e);
      background: var(--disabled-color, var(--secondary-background-color, #e8edef));
      box-shadow: none;
    }
    .secondary-action { color: var(--error-color, #b73535); background: transparent; border: 1px solid currentColor; }

    .precision-docked { margin-block-end: 1rem; }

    .precision-popover {
      position: absolute;
      z-index: 9;
      inset-block-start: 4.2rem;
      inset-inline-end: 0.75rem;
      display: flex;
      gap: 0.4rem;
    }

    .precision-chip {
      min-block-size: 2.75rem;
      padding-inline: 0.8rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 17%));
      border-radius: 1.4rem;
      color: inherit;
      background: var(--card-background-color, #fff);
      box-shadow: 0 5px 18px rgb(31 41 51 / 12%);
      cursor: pointer;
      font-size: 0.76rem;
      font-weight: 700;
    }

    .full-map-hud {
      position: absolute;
      z-index: 9;
      inset-inline-end: 0.75rem;
      inset-block-end: max(0.75rem, env(safe-area-inset-bottom));
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.75rem;
      align-items: center;
      inline-size: min(24rem, calc(100% - 1.5rem));
      padding: 0.7rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      border-radius: 0.9rem;
      background: var(--card-background-color, rgb(255 255 255 / 96%));
      box-shadow: 0 10px 28px rgb(31 41 51 / 18%);
    }

    .full-map-hud.has-secondary {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }

    .hud-copy { min-inline-size: 0; }
    .hud-copy strong, .hud-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hud-copy strong { font-size: 0.8rem; }
    .hud-copy small { color: var(--secondary-text-color, #687984); font-size: 0.7rem; }
    .full-map-hud .primary-action { min-inline-size: 6rem; padding-inline: 0.8rem; }
    .full-map-hud .secondary-action { min-inline-size: 4.5rem; padding-inline: 0.65rem; }

    .mobile-sheet { display: none; }

    .dialog-backdrop {
      position: fixed;
      z-index: 30;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 1rem;
      background: rgb(0 0 0 / 38%);
    }

    .dialog {
      inline-size: min(24rem, 100%);
      padding: 1.2rem;
      border-radius: 0.9rem;
      color: var(--primary-text-color, #1f2933);
      background: var(--card-background-color, #fff);
      box-shadow: 0 20px 50px rgb(0 0 0 / 25%);
    }

    .dialog h2 { margin: 0; font-size: 1.08rem; }
    .dialog p { color: var(--secondary-text-color, #687984); font-size: 0.82rem; line-height: 1.5; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
    .dialog-actions button { min-block-size: 2.75rem; padding-inline: 1rem; border: 0; border-radius: 0.65rem; cursor: pointer; }
    .dialog-actions .discard { color: white; background: var(--error-color, #c43b3b); }

    .narrow .app { grid-template-rows: 3.35rem minmax(0, 1fr); min-block-size: 28rem; }
    .narrow .workspace { grid-template-columns: minmax(0, 1fr); }
    .narrow .inspector { display: none; }
    .narrow .mobile-sheet {
      position: absolute;
      z-index: 7;
      inset-inline: 0;
      inset-block-end: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      block-size: min(52%, 30rem);
      padding: 0.6rem max(0.75rem, env(safe-area-inset-right)) max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
      border-start-start-radius: 1rem;
      border-start-end-radius: 1rem;
      background: var(--card-background-color, #fff);
      box-shadow: 0 -8px 26px rgb(31 41 51 / 14%);
      overflow: hidden;
      transition: block-size 180ms ease-out;
    }

    .narrow .mobile-sheet[data-detent="peek"] { block-size: 10.5rem; }
    .narrow .mobile-sheet[data-detent="full"] { block-size: calc(100% - 0.5rem); }
    .narrow .sheet-toggle {
      display: grid;
      min-block-size: 2.75rem;
      padding: 0 0 0.45rem;
      border: 0;
      color: inherit;
      background: transparent;
      text-align: start;
      cursor: pointer;
    }
    .narrow .sheet-handle { inline-size: 2.5rem; block-size: 0.25rem; margin: 0 auto 0.55rem; border-radius: 1rem; background: var(--divider-color, #bcc6cc); }
    .narrow .sheet-title { font-size: 1rem; font-weight: 730; }
    .narrow .sheet-description { margin-block-start: 0.2rem; color: var(--secondary-text-color, #687984); font-size: 0.75rem; }
    .narrow .sheet-body { min-block-size: 0; padding-block: 0.25rem; overflow: auto; }
    .narrow .mobile-sheet[data-detent="peek"] .sheet-body { display: none; }
    .narrow .mobile-sheet .primary-stack { margin-block-start: 0; padding-block-start: 0.55rem; }
    .narrow .quick-actions { grid-template-columns: minmax(0, 1fr); }
    .narrow .quick-actions button { min-block-size: 3.8rem; }
    .narrow .header-state {
      display: inline-flex;
      overflow: hidden;
      max-inline-size: 5.5rem;
      font-size: 0.7rem;
      text-overflow: ellipsis;
    }
    .narrow .title { font-size: 0.95rem; }
    .narrow .robot-switcher { max-inline-size: 6rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .narrow .full-map-hud { inset-block-end: max(0.75rem, env(safe-area-inset-bottom)); }
    .narrow .workspace.full-map .mobile-sheet { display: none; }

    @media (forced-colors: active) {
      .primary-action, .secondary-action, .dialog, .full-map-hud { border: 1px solid CanvasText; }
    }

    @media (prefers-reduced-motion: reduce) {
      .narrow .mobile-sheet { transition: none; }
    }
  `;

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;

  #t(key: string, fallback: string, placeholders?: Record<string, string | number>): string {
    return translate(this.localize, key, fallback, placeholders);
  }
  protected _measuredNarrow = false;
  protected _sheetOffset = 0;
  protected _workflowReady = false;
  protected _overflowOpen = false;
  protected _browserFullscreen = false;
  protected _sheetDetent: SheetDetent = "half";
  #resizeObserver: ResizeObserver | null = null;
  #sheetResizeObserver: ResizeObserver | null = null;
  #observedSheet: Element | null = null;
  #precisionLauncher: HTMLElement | null = null;
  #dialogLauncher: HTMLElement | null = null;
  #pendingWorkflow: Workflow | null = null;

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
    const sheet = this.renderRoot.querySelector(".mobile-sheet");
    if (sheet !== this.#observedSheet) {
      this.#sheetResizeObserver?.disconnect();
      this.#observedSheet = sheet;
      if (sheet) this.#sheetResizeObserver?.observe(sheet);
    }
    if (changed.has("state")) {
      const previous = changed.get("state") as WorkspaceState | undefined;
      if (previous?.precisionOpen && !this.state.precisionOpen) {
        this.#precisionLauncher?.focus();
      }
      if (!previous?.dialog && this.state.dialog) {
        this.#dialogLauncher = deepActiveElement(this.shadowRoot || document);
        void this.updateComplete.then(() => {
          this.renderRoot.querySelector<HTMLElement>(".dialog button")?.focus();
        });
      } else if (previous?.dialog && !this.state.dialog) {
        this.#dialogLauncher?.focus();
        this.#dialogLauncher = null;
      }
      if (this.state.workflow !== "none" && !this._workflowReady) {
        void import("./workflow-panel").then(() => {
          this._workflowReady = true;
        });
      }
      if (!previous || previous.workflow !== this.state.workflow) {
        this._sheetDetent = "half";
      }
    }
  }

  #intent(intent: WorkspaceIntent): void {
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
    this.#dispatchAction(action.id);
  }

  #workflow(workflow: Workflow): void {
    if (this.state.workflow === "draw"
      && this.state.draw.dirty
      && workflow !== "draw"
      && workflow !== "areaReview") {
      this.#pendingWorkflow = workflow;
      this.#intent({ type: "open-dialog", dialog: "discardDraft" });
      return;
    }
    this.#intent({ type: "open-workflow", workflow });
  }

  #discardAndContinue(): void {
    const pending = this.#pendingWorkflow;
    this.#pendingWorkflow = null;
    this.#intent({ type: "discard-draft" });
    if (pending) {
      queueMicrotask(() => this.#intent({ type: "open-workflow", workflow: pending }));
    }
  }

  #keepDraft(): void {
    this.#pendingWorkflow = null;
    this.#intent({ type: "dismiss-top-layer" });
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

  #cycleSheet(): void {
    this._sheetDetent = this._sheetDetent === "peek"
      ? "half"
      : this._sheetDetent === "half" ? "full" : "peek";
  }

  #navigation(): void {
    if (this.state.precisionOpen || this.state.fullMap) {
      this.#intent({ type: "dismiss-top-layer" });
      return;
    }
    if (this.state.workflow !== "none") {
      this.#workflow("none");
      return;
    }
    this.#toggleNavigation();
  }

  #toggleNavigation(): void {
    this.dispatchEvent(new CustomEvent("hass-toggle-menu", {
      bubbles: true,
      composed: true,
    }));
  }

  #overflowAction(id: "support" | "classic" | "fullscreen"): void {
    this._overflowOpen = false;
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

  #togglePrecision(event: Event): void {
    this.#precisionLauncher = event.currentTarget as HTMLElement;
    this.#intent({
      type: "set-precision-open",
      value: !this.state.precisionOpen,
    });
  }

  #keyboard(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (this._overflowOpen) {
      this._overflowOpen = false;
      return;
    }
    this.#intent({ type: "dismiss-top-layer" });
  }

  #dialogKeyboard(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const buttons = [...this.renderRoot.querySelectorAll<HTMLElement>(
      ".dialog button:not(:disabled)",
    )];
    const first = buttons[0];
    const last = buttons.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && this.shadowRoot?.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.shadowRoot?.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  #primaryButton(action: PrimaryAction, className = "primary-action") {
    if (action.id === "choose-cleaning") return nothing;
    const labels: Readonly<Record<string, [string, string]>> = {
      stop: ["v4_stop", "Stop"],
      resume: ["v4_resume", "Resume"],
      "review-area": ["v4_review_details", "Review details"],
      "save-area": ["area_save", "Save area"],
      "run-area": ["area_run", "Clean area"],
      "save-plan": ["plan_save", "Save plan"],
      "run-plan": ["plan_run", "Run plan"],
    };
    const translated = labels[action.id];
    const label = action.id === "clean-rooms"
      ? action.label
      : translated ? this.#t(translated[0], translated[1]) : action.label;
    return html`
      <button
        class=${`${className} ${action.kind === "danger" ? "danger" : ""}`}
        type="button"
        ?disabled=${!action.enabled}
        title=${action.reason ?? ""}
        @click=${() => this.#action(action)}
      >${label}</button>
    `;
  }

  #workflowBody(state: WorkspaceState) {
    if (state.workflow === "none") return html`
      <div class="quick-actions" aria-label=${this.#t("v4_cleaning_choices", "Cleaning choices")}>
        <button class="featured" type="button" @click=${() => this.#workflow("rooms")}>
          <span class="quick-copy"><strong>${this.#t("map_rooms", "Rooms")}</strong><small>${this.#t("v4_rooms_quick_detail", "Pick rooms and clean them now.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" @click=${() => this.#workflow("plan")}>
          <span class="quick-copy"><strong>${this.#t("cleaning_workspace_plans", "Plans")}</strong><small>${this.#t("v4_plans_quick_detail", "Run or edit a saved routine.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" @click=${() => this.#workflow("draw")}>
          <span class="quick-copy"><strong>${this.#t("area_workspace_title", "Custom areas")}</strong><small>${this.#t("v4_areas_quick_detail", "Use or draw a precise outline.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
        <button type="button" @click=${() => this.#workflow("history")}>
          <span class="quick-copy"><strong>${this.#t("map_timeline_history", "History")}</strong><small>${this.#t("v4_history_quick_detail", "Browse earlier floor maps.")}</small></span><span class="quick-arrow" aria-hidden="true">›</span>
        </button>
      </div>
    `;
    if (!this._workflowReady) return html`<div role="status">${this.#t("v4_loading_workspace", "Loading workspace…")}</div>`;
    return html`<matic-map-workflow-v4 .state=${state} .localize=${this.localize}></matic-map-workflow-v4>`;
  }

  protected override render() {
    const state = this.state;
    const narrow = state.narrowHint || this._measuredNarrow;
    const status = statusCopy(state, this.localize);
    const workflow = workflowCopy(state, this.localize);
    const primary = selectPrimaryAction({ ...state, narrowHint: narrow });
    const secondary = selectPausedSecondaryAction(state);
    const compactPrecision = state.workflow === "draw" && (narrow || state.fullMap);
    const locatingInFullMap = state.fullMap
      && (state.coherence === "verifying" || state.coherence === "booting");
    const navigationBack = state.workflow !== "none" || state.fullMap || state.precisionOpen;
    const dialog = dialogCopy(state.dialog, this.localize);
    return html`
      <div class=${`root ${narrow ? "narrow" : "wide"}`} @keydown=${this.#keyboard}>
        <div class="app">
          <header class="app-bar">
            <button
              class="nav"
              type="button"
              aria-label=${navigationBack ? this.#t("v4_back", "Back") : this.#t("v4_open_navigation", "Open navigation")}
              @click=${this.#navigation}
            >${navigationBack ? "←" : "☰"}</button>
            <h1 class="title">${this.#t("map_studio_title", "Matic Map")}</h1>
            ${state.host.robotCount > 1 ? html`
              <select
                class="robot-switcher"
                aria-label=${this.#t("v4_choose_robot", "Choose robot")}
                .value=${state.selection.entryId || ""}
                @change=${(event: Event) => this.#intent({
                  type: "select-entry",
                  entryId: (event.currentTarget as HTMLSelectElement).value,
                })}
              >${state.robots.map((robot) => html`
                <option value=${robot.entryId}>${robot.label}</option>
              `)}</select>
            ` : nothing}
            <span class="spacer"></span>
            <span class="header-state">${status.title}</span>
            <div class="overflow-wrap">
              <button
                class="overflow"
                type="button"
                aria-label=${this.#t("map_more", "More map options")}
                aria-expanded=${String(this._overflowOpen)}
                @click=${() => { this._overflowOpen = !this._overflowOpen; }}
              >⋮</button>
              ${this._overflowOpen ? html`
                <div class="overflow-menu" role="menu">
                  <label class="overflow-field">${this.#t("map_quality_label", "Scene detail")}
                    <select
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
                  <button role="menuitem" type="button" @click=${() => this.#overflowAction("fullscreen")}>${this._browserFullscreen ? this.#t("exit_fullscreen", "Exit full screen") : this.#t("expand_map", "Browser full screen")}</button>
                  <button role="menuitem" type="button" @click=${() => this.#overflowAction("support")}>${this.#t("v4_map_support", "Map support")}</button>
                  <button role="menuitem" type="button" @click=${() => this.#overflowAction("classic")}>${this.#t("v4_use_classic", "Use classic Map Studio")}</button>
                </div>
              ` : nothing}
            </div>
          </header>

          <main class=${`workspace ${state.fullMap ? "full-map" : ""}`}>
            <div class="canvas">
              <matic-map-canvas-v4
                style=${narrow && !state.fullMap
                  ? `--map-sheet-offset:${this._sheetOffset}px`
                  : "--map-sheet-offset:0px"}
                .state=${state}
                .localize=${this.localize}
              ></matic-map-canvas-v4>
            </div>

            ${compactPrecision ? html`
              <div class="precision-popover">
                <button
                  class="precision-chip"
                  type="button"
                  aria-expanded=${String(state.precisionOpen)}
                  @click=${this.#togglePrecision}
                >${state.draw.zoomPercent}% · ${state.draw.brushMeters.toFixed(2)} m</button>
                <button
                  class="precision-chip"
                  type="button"
                  ?disabled=${state.draw.circles.length === 0}
                  @click=${() => this.#intent({ type: "clear-draft" })}
                >${this.#t("clear", "Clear")}</button>
                ${state.precisionOpen ? html`
                  <matic-precision-controls-v4 compact .state=${state} .localize=${this.localize}></matic-precision-controls-v4>
                ` : nothing}
              </div>
            ` : nothing}

            <aside class="inspector" aria-label="Map workspace">
              <div class="status-strip">
                <span class="status-icon" aria-hidden="true">◆</span>
                <span><strong>${status.title}</strong><small>${status.detail}</small></span>
              </div>
              <section class="workflow">
                <h2 tabindex="-1">${workflow.title}</h2>
                <p>${workflow.description}</p>
                ${this.#workflowBody(state)}
                <div class="primary-stack">
                  ${this.#primaryButton(primary)}
                  ${secondary ? this.#primaryButton(secondary, "secondary-action") : nothing}
                </div>
              </section>
            </aside>

            <section
              class="mobile-sheet"
              data-detent=${this._sheetDetent}
              aria-label="Map workspace"
            >
              <button
                class="sheet-toggle"
                type="button"
                aria-label=${this.#t("v4_workspace_height", "Map workspace, {height} height", { height: this._sheetDetent })}
                aria-expanded=${String(this._sheetDetent !== "peek")}
                @click=${this.#cycleSheet}
              >
                <span class="sheet-handle" aria-hidden="true"></span>
                <span class="sheet-title">${workflow.title}</span>
                <span class="sheet-description">${workflow.description}</span>
              </button>
              <div class="sheet-body">
                ${state.workflow === "draw" ? nothing : this.#workflowBody(state)}
              </div>
              <div class="primary-stack">
                ${this.#primaryButton(primary)}
                ${secondary ? this.#primaryButton(secondary, "secondary-action") : nothing}
              </div>
            </section>

            ${state.fullMap ? html`
              <section
                class=${`full-map-hud ${secondary ? "has-secondary" : ""}`}
                aria-label="Robot status and action"
              >
                <span class="hud-copy"><strong>${status.title}</strong><small>${status.detail}</small></span>
                ${locatingInFullMap ? nothing : this.#primaryButton(primary)}
                ${!locatingInFullMap && secondary
                  ? this.#primaryButton(secondary, "secondary-action")
                  : nothing}
              </section>
            ` : nothing}
          </main>
        </div>

        ${dialog ? html`
          <div class="dialog-backdrop">
            <section
              class="dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              @keydown=${this.#dialogKeyboard}
            >
              <h2 id="dialog-title">${dialog.title}</h2>
              <p>${dialog.detail}</p>
              <div class="dialog-actions">
                <button
                  type="button"
                  @click=${state.dialog === "discardDraft"
                    ? this.#keepDraft
                    : () => this.#intent({ type: "dismiss-top-layer" })}
                >${dialog.cancelLabel}</button>
                ${dialog.action === null ? nothing : html`
                  <button
                    class="discard"
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

if (!customElements.get("matic-map-shell-v4")) {
  customElements.define("matic-map-shell-v4", MaticMapShellV4);
}

declare global {
  interface HTMLElementTagNameMap {
    "matic-map-shell-v4": MaticMapShellV4;
  }
}
