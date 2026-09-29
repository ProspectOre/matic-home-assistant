import { css, LitElement } from "lit";
import { base, tokens } from "./tokens";
import { html, unsafeStatic } from "lit/static-html.js";
import type { PropertyValues } from "lit";

import type {
  HassLike,
  HassProjection,
  PanelLike,
  RouteLike,
  WorkspaceAction,
  WorkspaceState,
} from "./contracts";
import { isWorkspaceIntent } from "./contracts";
import { PANEL_TAG, SHELL_TAG } from "./element-tags";
import { HassAdapter } from "./hass-adapter";
import { MaticBackend } from "./backend";
import { EffectController } from "./effects";
import { LayerHistoryController } from "./layer-history";
import "./shell";
import { initialWorkspaceState, WorkspaceStore } from "./state";

const shellTag = unsafeStatic(SHELL_TAG);

export class MaticMapPanelV4 extends LitElement {
  static override styles = [tokens, base, css`
:host { display: block; block-size: 100%; }
`];

  static override properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    route: { attribute: false },
    panel: { attribute: false },
    _workspace: { state: true },
    entryOverride: { state: true },
  };

  hass?: HassLike;
  narrow = false;
  route?: RouteLike;
  panel?: PanelLike;
  protected _workspace: WorkspaceState = initialWorkspaceState();
  entryOverride: string | null = null;

  readonly #adapter = new HassAdapter();
  readonly #store = new WorkspaceStore(this._workspace);
  #projection: HassProjection | null = null;
  #unsubscribe: (() => void) | null = null;
  #backend: MaticBackend | null = null;
  #effects: EffectController | null = null;
  #layers: LayerHistoryController | null = null;

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    if (!changed.has("hass")
      || [...changed.keys()].some((property) => property !== "hass")) return true;
    const previousHass = changed.get("hass") as HassLike | undefined;
    // Connection replacement requires new HA subscriptions even when the
    // visible projection is unchanged. Localization can also change while the
    // selected language string remains stable.
    if (previousHass?.connection !== this.hass?.connection
      || previousHass?.localize !== this.hass?.localize) return true;
    return this.#adapter.project(this.hass, this.panel, this.entryOverride) !== this.#projection;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribe = this.#store.subscribe((state) => {
      this._workspace = state;
    });
    this.#startControllers();
  }

  override disconnectedCallback(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#stopControllers();
    super.disconnectedCallback();
  }

  #startControllers(): void {
    if (!this.isConnected || this.#effects) return;
    // A panel can be detached while Home Assistant updates its properties.
    // Recompute from the current values before deciding whether any private
    // request is safe; the last projection may still describe a connected
    // host from before the detach.
    this.#projection = this.#adapter.project(this.hass, this.panel, this.entryOverride);
    this.#backend = new MaticBackend(() => this.hass);
    this.#effects = new EffectController(this.#store, this.#backend, this.hass?.connection ?? null);
    this.#layers = new LayerHistoryController(this.#store);
    this.#layers.start();
    if (this.#projection) {
      this.#effects.sync(this.#projection, this.panel);
      // A detached panel keeps its last verified workspace state, but its
      // controllers and authenticated requests are intentionally disposed.
      // Revalidate the catalog on reattach so a reused DOM node cannot present
      // stale floor/session metadata as current.
      const { host } = this.#projection;
      if (host.connected && host.administrator && host.robotCount > 0) {
        // Historical floors are read-only and must remain selected while the
        // catalog is refreshed. The non-forced path updates catalog metadata
        // but intentionally leaves the history scene and selection untouched.
        void this.#effects.refreshCatalog(this.#store.value.selection.floorId === "current");
      }
    }
  }

  #stopControllers(): void {
    this.#layers?.dispose();
    this.#layers = null;
    this.#effects?.dispose();
    this.#effects = null;
    this.#backend = null;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("hass") || changed.has("panel") || changed.has("entryOverride")) {
      const previousHass = changed.get("hass") as HassLike | undefined;
      const connectionChanged = changed.has("hass")
        && previousHass?.connection !== this.hass?.connection;
      const projection = this.#adapter.project(this.hass, this.panel, this.entryOverride);
      const projectionChanged = projection !== this.#projection;
      if (projectionChanged) {
        this.#projection = projection;
      }
      if (connectionChanged) {
        this.#stopControllers();
        this.#startControllers();
      } else if (projectionChanged || changed.has("panel") || changed.has("entryOverride")) {
        this.#effects?.sync(projection, this.panel);
      }
    }
    if (changed.has("narrow") && this.#store.value.narrowHint !== this.narrow) {
      this.#store.dispatch({ type: "set-narrow-hint", value: this.narrow });
    }
  }

  #intent(event: CustomEvent<unknown>): void {
    if (!isWorkspaceIntent(event.detail)) return;
    event.stopPropagation();
    const intent = event.detail;
    if (intent.type === "dismiss-top-layer" || intent.type === "exit-full-map") {
      if (!this.#layers?.dismissTop()) this.#store.dispatch(intent);
      return;
    }
    if (intent.type === "open-workflow" && intent.workflow !== "none") {
      void this.#effects?.openWorkflow(intent.workflow);
      return;
    }
    if (intent.type === "set-floor") {
      void this.#effects?.selectFloor(intent.floorId);
      return;
    }
    if (intent.type === "select-entry") {
      if (!this._workspace.robots.some((robot) => robot.entryId === intent.entryId)) return;
      this.entryOverride = intent.entryId;
      return;
    }
    if (intent.type === "set-history") {
      void this.#effects?.selectHistory(intent.historyId);
      return;
    }
    if (intent.type === "select-plan") {
      this.#effects?.selectPlan(intent.planId);
      return;
    }
    if (intent.type === "select-area") {
      this.#effects?.selectArea(intent.areaId);
      if (intent.workflow === "areaReview") void this.#effects?.openWorkflow("areaReview");
      return;
    }
    this.#store.dispatch(intent);
  }

  #action(event: CustomEvent<WorkspaceAction>): void {
    event.stopPropagation();
    if (typeof event.detail?.id !== "string") return;
    if (event.detail.id === "reset-room-cadence" && "planId" in event.detail && "roomId" in event.detail && "mode" in event.detail) {
      void this.#effects?.executeAction(event.detail);
    } else {
      void this.#effects?.executeAction(event.detail.id);
    }
    this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested", {
      detail: { id: event.detail.id },
      bubbles: true,
      composed: true,
    }));
  }

  getWorkspaceSnapshot(): WorkspaceState {
    return this.#store.value;
  }

  protected override render() {
    return html`
      <${shellTag}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        @matic-workspace-intent=${this.#intent}
        @matic-workspace-action=${this.#action}
      ></${shellTag}>
    `;
  }
}

if (!customElements.get(PANEL_TAG)) {
  customElements.define(PANEL_TAG, MaticMapPanelV4);
}

export { PANEL_TAG as MATIC_MAP_PANEL_TAG };
