import { LitElement, css } from "lit";
import { base, tokens } from "../map-studio-v4/tokens";
import { html, unsafeStatic } from "lit/static-html.js";
import type { PropertyValues } from "lit";

import type { DateFormat, Localize, WorkspaceAction, WorkspaceState } from "../map-studio-v4/contracts";
import { isWorkspaceIntent } from "../map-studio-v4/contracts";
import { SHELL_TAG } from "../map-studio-v4/element-tags";
import { GALLERY_SCENARIOS, type GalleryScenario } from "./gallery-scenarios";
import { createGalleryState, withGalleryRoomPreview } from "./gallery-state";
import "../map-studio-v4/shell";
import { WorkspaceStore, areaSelection } from "../map-studio-v4/state";

const shellTag = unsafeStatic(SHELL_TAG);

export class MaticMapStudioGalleryV4 extends LitElement {
  static override properties = {
    scenario: { type: String, reflect: true },
    narrow: { type: Boolean, reflect: true },
    controls: { type: Boolean, reflect: true },
    _workspace: { state: true },
    dates: { attribute: false },
    localize: { attribute: false },
  };

  static override styles = [tokens, base, css`
    :host {
      display: block;
      color-scheme: light dark;
      color: #1f2933;
      background: #e8edef;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }


    .gallery-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      padding: 0.65rem;
      border-block-end: 1px solid #ccd5da;
      background: #fff;
    }

    .gallery-controls button {
      min-block-size: 2.25rem;
      padding-inline: 0.65rem;
      border: 1px solid #c5cfd5;
      border-radius: 0.55rem;
      color: #26343c;
      background: #f7f9fa;
      cursor: pointer;
      font-size: 0.75rem;
    }

    .gallery-controls button[aria-pressed="true"] {
      color: white;
      border-color: #0678ce;
      background: #0678ce;
    }

    .stage {
      inline-size: 100%;
      block-size: min(46rem, calc(100dvh - 3.6rem));
      min-block-size: 36rem;
      margin: 0 auto;
      background: #f5f7f8;
    }

    :host([narrow]) .stage { max-inline-size: 24.375rem; block-size: 52.75rem; }
    .shell { block-size: 100%; }
  `];

  scenario: GalleryScenario = "ready";
  narrow = false;
  dates?: DateFormat;
  /** Home Assistant's `localize`; the walkthrough stage passes a synthetic language. */
  localize?: Localize;
  controls = true;
  /**
   * The walkthrough stage plays starts and stops as a robot would (pending,
   * starting, cleaning; settling, docked), so a run reads end to end with no
   * robot behind it. Tests leave it off and drive the state themselves.
   */
  simulateMotion = false;
  #motion: ReturnType<typeof setTimeout>[] = [];
  protected _workspace: WorkspaceState = { ...createGalleryState("ready"), optionalUiReady: true, queueControllerStatus: "ready" };

  readonly #store = new WorkspaceStore(this._workspace);
  #unsubscribe: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribe = this.#store.subscribe((state) => {
      this._workspace = state;
    });
  }

  override disconnectedCallback(): void {
    for (const timer of this.#motion.splice(0)) clearTimeout(timer);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("scenario")) {
      this.#store.replace({
        ...createGalleryState(this.scenario),
        narrowHint: this.narrow,
        optionalUiReady: true,
        queueControllerStatus: "ready",
      });
    } else if (changed.has("narrow")) {
      this.#store.dispatch({ type: "set-narrow-hint", value: this.narrow });
    }
  }

  setScenario(scenario: GalleryScenario): void {
    if (!GALLERY_SCENARIOS.includes(scenario)) return;
    this.scenario = scenario;
  }

  getWorkspaceSnapshot(): WorkspaceState {
    return structuredClone(this.#store.value);
  }

  replaceWorkspaceState(state: WorkspaceState): void {
    this.#store.replace(withGalleryRoomPreview(structuredClone(state)));
  }

  #intent(event: CustomEvent<unknown>): void {
    if (!isWorkspaceIntent(event.detail)) return;
    event.stopPropagation();
    // The effects' share of opening Draw (openWorkflow): a new drawing from
    // anywhere but an area's own screen starts with no area selected.
    const before = this.#store.value.workflow;
    if (event.detail.type === "open-workflow" && event.detail.workflow === "draw" && before !== "draw" && before !== "areaReview") {
      this.#store.replace({ ...this.#store.value, ...areaSelection(this.#store.value, null) });
    }
    this.#store.dispatch(event.detail);
    // The effects' share of an area selection, played on the synthetic catalog.
    if (event.detail.type === "select-area") {
      this.#store.replace({ ...this.#store.value, ...areaSelection(this.#store.value, event.detail.areaId) });
    }
    // The effects' share of a floor or saved-map choice (selectFloor,
    // selectHistory): the floor's read-only flag and, on a saved floor, its
    // newest map.
    const intent = event.detail;
    if (intent.type === "set-floor" || intent.type === "set-history") {
      const value = this.#store.value;
      const floors = value.resources.history.value?.floors ?? [];
      const floor = intent.type === "set-history"
        ? floors.find((candidate) => intent.historyId === null ? candidate.active : candidate.snapshots.some((snapshot) => snapshot.id === intent.historyId))
        : floors.find((candidate) => intent.floorId === "current" ? candidate.active : candidate.id === intent.floorId);
      if (floor) {
        const newest = floor.active ? null : [...floor.snapshots].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
        const historyId = intent.type === "set-history" ? intent.historyId : newest?.id ?? null;
        this.#store.replace({
          ...value,
          dataMode: historyId ? "history" : "live",
          floor: { ...value.floor, readOnly: Boolean(historyId) },
          selection: { ...value.selection, floorId: floor.id, historyId },
        });
      }
    }
    if (this.#store.value.workflow === "rooms") {
      this.#store.replace(withGalleryRoomPreview(this.#store.value));
    }
  }

  // The one action with no write behind it: Name and save / Done opens the
  // review. With simulateMotion, starts and Stop play out too.
  #action(event: CustomEvent<WorkspaceAction>): void {
    const id = event.detail?.id;
    if (this.simulateMotion && (id === "run-plan" || id === "run-area" || id === "clean-rooms" || id === "stop")) {
      event.stopPropagation();
      this.#simulate(id);
      return;
    }
    if (id !== "review-area") return;
    event.stopPropagation();
    this.#store.dispatch({ type: "open-workflow", workflow: "areaReview" });
  }

  #simulate(id: string): void {
    const value = this.#store.value;
    const later = (delay: number, patch: Partial<WorkspaceState>) => {
      this.#motion.push(setTimeout(() => this.#store.replace({ ...this.#store.value, ...patch }), delay));
    };
    if (id === "stop") {
      // A start still playing out is cancelled, as Stop cancels a real one.
      for (const timer of this.#motion.splice(0)) clearTimeout(timer);
      this.#store.replace({ ...value, command: "settling", pendingAction: null, notice: null });
      later(900, { command: "idle", activity: "returning", currentArea: null });
      later(2400, { activity: "docked" });
      return;
    }
    if (value.command !== "idle") return;
    // Run plan checks its preview first (pending), then every start settles.
    this.#store.replace(id === "run-plan"
      ? { ...value, command: "pending", pendingAction: "run-plan", notice: null }
      : { ...value, command: "starting", notice: null });
    if (id === "run-plan") later(500, { command: "starting", pendingAction: null });
    later(1500, { command: "idle", activity: "cleaning", currentArea: "Kitchen" });
  }

  protected override render() {
    return html`
      ${this.controls ? html`
        <nav class="gallery-controls" aria-label="Map Studio states">
          ${GALLERY_SCENARIOS.map((scenario) => html`
            <button
              type="button"
              aria-pressed=${String(this.scenario === scenario)}
              @click=${() => { this.scenario = scenario; }}
            >${scenario}</button>
          `)}
        </nav>
      ` : null}
      <div class="stage">
        <${shellTag}
          class="shell"
          .state=${this._workspace}
          .dates=${this.dates}
          .localize=${this.localize}
          @matic-workspace-intent=${this.#intent}
          @matic-workspace-action=${this.#action}
        ></${shellTag}>
      </div>
    `;
  }
}

if (!customElements.get("matic-map-studio-gallery-v0-4-0")) {
  customElements.define(
    "matic-map-studio-gallery-v0-4-0",
    MaticMapStudioGalleryV4,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "matic-map-studio-gallery-v0-4-0": MaticMapStudioGalleryV4;
  }
}
