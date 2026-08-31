import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";

import type {
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
import {
  selectPausedSecondaryAction,
  selectPrimaryAction,
} from "./state";

const statusCopy = (state: WorkspaceState): { readonly title: string; readonly detail: string } => {
  if (!state.host.connected) return { title: "Reconnecting", detail: "Home Assistant is offline" };
  if (!state.host.administrator) return { title: "Access required", detail: "Administrator only" };
  if (state.host.robotCount === 0) return { title: "No robot", detail: "Set up a Matic robot" };
  if (!state.host.robotConnected) return { title: "Robot offline", detail: "Last verified map · read only" };
  if (state.activity === "problem") return { title: "Needs attention", detail: "Check the robot" };
  if (state.dataMode === "history") {
    const floor = state.resources.history.value?.floors.find(
      (candidate) => candidate.id === state.selection.floorId,
    );
    const position = floor?.snapshots.findIndex(
      (snapshot) => snapshot.id === state.selection.historyId,
    ) ?? -1;
    const count = floor?.snapshots.length ?? 0;
    return {
      title: "Saved map",
      detail: position >= 0 ? `Read only · ${position + 1} of ${count}` : "Read only",
    };
  }
  if (state.coherence === "verifying" || state.coherence === "booting") {
    return { title: "Locating", detail: "Finding the current map" };
  }
  if (state.activity === "cleaning") return { title: "Cleaning", detail: "Cleaning in progress" };
  if (state.activity === "paused") return { title: "Paused", detail: "Cleaning can resume" };
  if (state.activity === "returning") return { title: "Returning", detail: "Going to the dock" };
  if (state.activity === "stopping") return { title: "Stopping", detail: "Waiting for the robot" };
  const battery = state.batteryPercent === null ? "Ready" : `${state.batteryPercent}% battery`;
  return { title: state.activity === "docked" ? "Docked" : "Ready", detail: battery };
};

const workflowCopy = (state: WorkspaceState): {
  readonly title: string;
  readonly description: string;
} => {
  switch (state.workflow) {
    case "rooms":
      return { title: "Choose rooms", description: "Select on the map or from the list." };
    case "draw":
      return { title: "Draw an area", description: "Paint on the verified map, then review the details." };
    case "plan":
      return { title: "Plan", description: "Review rooms and cleaning settings." };
    case "areaReview":
      return { title: "Area details", description: "Name the area and choose cleaning settings." };
    case "history":
      return { title: "Map history", description: "Saved maps are floor-scoped and read only." };
    case "support":
      return { title: "Map support", description: "Private geometry is never included." };
    case "none":
      return { title: "Clean", description: "Start with a saved plan, rooms, or an area." };
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

const dialogCopy = (dialog: WorkspaceState["dialog"]): DialogPresentation | null => {
  switch (dialog) {
    case "discardDraft":
      return {
        title: "Discard this area?",
        detail: "The outline has not been saved. You can keep drawing or discard it.",
        cancelLabel: "Keep drawing",
        confirmLabel: "Discard",
        action: "discard",
      };
    case "confirmDeletePlan":
      return {
        title: "Delete this plan?",
        detail: "This removes the saved plan from Home Assistant. The robot will not move.",
        cancelLabel: "Cancel",
        confirmLabel: "Delete plan",
        action: "delete-plan",
      };
    case "confirmDeleteArea":
      return {
        title: "Delete this area?",
        detail: "This removes the saved outline from Home Assistant. The robot will not move.",
        cancelLabel: "Cancel",
        confirmLabel: "Delete area",
        action: "delete-area",
      };
    case "confirmStop":
      return {
        title: "Stop cleaning?",
        detail: "The robot may take a moment to settle before another action is available.",
        cancelLabel: "Keep cleaning",
        confirmLabel: "Stop",
        action: "stop",
      };
    case "error":
      return {
        title: "Something went wrong",
        detail: "No action was started. Close this message and try again when the map is ready.",
        cancelLabel: "Close",
        confirmLabel: "Close",
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
    _measuredNarrow: { state: true },
    _sheetOffset: { state: true },
    _workflowReady: { state: true },
    _overflowOpen: { state: true },
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

    .quick-actions { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.55rem; }
    .quick-actions button, .room-row {
      min-block-size: 3.25rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 17%));
      border-radius: 0.75rem;
      color: inherit;
      background: var(--secondary-background-color, #f4f7f8);
    }

    .quick-actions button { cursor: pointer; font-size: 0.8rem; font-weight: 650; }
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
    .primary-action:disabled { cursor: default; opacity: 0.48; box-shadow: none; }
    .secondary-action { color: var(--error-color, #b73535); background: transparent; border: 1px solid currentColor; }

    .precision-docked { margin-block-end: 1rem; }

    .precision-popover {
      position: absolute;
      z-index: 9;
      inset-block-start: 4.2rem;
      inset-inline-end: 0.75rem;
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
    .narrow .header-state { display: none; }
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

  state!: WorkspaceState;
  protected _measuredNarrow = false;
  protected _sheetOffset = 0;
  protected _workflowReady = false;
  protected _overflowOpen = false;
  protected _sheetDetent: SheetDetent = "peek";
  #resizeObserver: ResizeObserver | null = null;
  #sheetResizeObserver: ResizeObserver | null = null;
  #observedSheet: Element | null = null;
  #precisionLauncher: HTMLElement | null = null;
  #dialogLauncher: HTMLElement | null = null;
  #pendingWorkflow: Workflow | null = null;

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
        this._sheetDetent = this.state.workflow === "none" ? "peek" : "half";
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

  #overflowAction(id: "support" | "classic"): void {
    this._overflowOpen = false;
    if (id === "support") {
      this.#workflow("support");
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
    return html`
      <button
        class=${`${className} ${action.kind === "danger" ? "danger" : ""}`}
        type="button"
        ?disabled=${!action.enabled}
        title=${action.reason ?? ""}
        @click=${() => this.#action(action)}
      >${action.label}</button>
    `;
  }

  #workflowBody(state: WorkspaceState) {
    if (state.workflow === "none") return html`
      <div class="quick-actions">
        <button type="button" @click=${() => this.#workflow("rooms")}>Rooms</button>
        <button type="button" @click=${() => this.#workflow("draw")}>Draw area</button>
        <button type="button" @click=${() => this.#workflow("plan")}>Plans</button>
        <button type="button" @click=${() => this.#workflow("history")}>History</button>
      </div>
    `;
    if (!this._workflowReady) return html`<div role="status">Loading workspace…</div>`;
    return html`<matic-map-workflow-v4 .state=${state}></matic-map-workflow-v4>`;
  }

  protected override render() {
    const state = this.state;
    const narrow = state.narrowHint || this._measuredNarrow;
    const status = statusCopy(state);
    const workflow = workflowCopy(state);
    const primary = selectPrimaryAction({ ...state, narrowHint: narrow });
    const secondary = selectPausedSecondaryAction(state);
    const compactPrecision = state.workflow === "draw" && (narrow || state.fullMap);
    const locatingInFullMap = state.fullMap
      && (state.coherence === "verifying" || state.coherence === "booting");
    const navigationBack = state.workflow !== "none" || state.fullMap || state.precisionOpen;
    const dialog = dialogCopy(state.dialog);
    return html`
      <div class=${`root ${narrow ? "narrow" : "wide"}`} @keydown=${this.#keyboard}>
        <div class="app">
          <header class="app-bar">
            <button
              class="nav"
              type="button"
              aria-label=${navigationBack ? "Back" : "Open navigation"}
              @click=${this.#navigation}
            >${navigationBack ? "←" : "☰"}</button>
            <h1 class="title">Matic Map</h1>
            ${state.host.robotCount > 1 ? html`
              <button class="robot-switcher" type="button">${state.robotLabel} ▾</button>
            ` : nothing}
            <span class="spacer"></span>
            <span class="header-state">${status.title}</span>
            <div class="overflow-wrap">
              <button
                class="overflow"
                type="button"
                aria-label="More map options"
                aria-expanded=${String(this._overflowOpen)}
                @click=${() => { this._overflowOpen = !this._overflowOpen; }}
              >⋮</button>
              ${this._overflowOpen ? html`
                <div class="overflow-menu" role="menu">
                  <button role="menuitem" type="button" @click=${() => this.#overflowAction("support")}>Map support</button>
                  <button role="menuitem" type="button" @click=${() => this.#overflowAction("classic")}>Use classic Map Studio</button>
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
                ${state.precisionOpen ? html`
                  <matic-precision-controls-v4 compact .state=${state}></matic-precision-controls-v4>
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
                aria-label=${`Map workspace, ${this._sheetDetent} height`}
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
