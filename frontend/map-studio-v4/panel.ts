import { LitElement, html } from "lit";
import type { PropertyValues } from "lit";

import type {
  HassLike,
  HassProjection,
  PanelLike,
  RouteLike,
  WorkspaceState,
} from "./contracts";
import { isWorkspaceIntent } from "./contracts";
import { HassAdapter } from "./hass-adapter";
import { MaticBackend } from "./backend";
import { EffectController } from "./effects";
import { LayerHistoryController } from "./layer-history";
import {
  preferredFrontend,
  setPreferredFrontend,
  type MapPreferences,
} from "./preferences";
import "./shell";
import { initialWorkspaceState, WorkspaceStore } from "./state";

export class MaticMapPanelV4 extends LitElement {
  static override properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    route: { attribute: false },
    panel: { attribute: false },
    _workspace: { state: true },
    _classic: { state: true },
  };

  hass?: HassLike;
  narrow = false;
  route?: RouteLike;
  panel?: PanelLike;
  protected _workspace: WorkspaceState = initialWorkspaceState();
  protected _classic = false;

  readonly #adapter = new HassAdapter();
  readonly #store = new WorkspaceStore(this._workspace);
  #projection: HassProjection | null = null;
  #unsubscribe: (() => void) | null = null;
  #backend: MaticBackend | null = null;
  #effects: EffectController | null = null;
  #layers: LayerHistoryController | null = null;
  #preferenceSignature = "";

  override connectedCallback(): void {
    super.connectedCallback();
    this._classic = preferredFrontend() === "v3";
    this.#unsubscribe = this.#store.subscribe((state) => {
      this._workspace = state;
      this.#savePreferences(state);
    });
    if (!this._classic) this.#startControllers();
  }

  override disconnectedCallback(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#stopControllers();
    super.disconnectedCallback();
  }

  #startControllers(): void {
    if (this.#effects) return;
    this.#backend = new MaticBackend(() => this.hass);
    this.#effects = new EffectController(this.#store, this.#backend);
    this.#layers = new LayerHistoryController(this.#store);
    this.#layers.start();
    if (this.#projection) this.#effects.sync(this.#projection, this.panel);
  }

  #stopControllers(): void {
    this.#layers?.dispose();
    this.#layers = null;
    this.#effects?.dispose();
    this.#effects = null;
    this.#backend = null;
  }

  #savePreferences(state: WorkspaceState): void {
    if (!this.#effects) return;
    const preferences: MapPreferences = {
      version: 4,
      view: state.view,
      labels: state.labelsVisible,
      quality: state.quality,
      cameras: state.cameras,
    };
    const signature = JSON.stringify(preferences);
    if (signature === this.#preferenceSignature) return;
    this.#preferenceSignature = signature;
    this.#effects.schedulePreferences(preferences);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("hass") || changed.has("panel")) {
      const projection = this.#adapter.project(this.hass, this.panel);
      if (projection !== this.#projection) {
        this.#projection = projection;
        const coherence = !projection.host.connected
          ? "degraded"
          : projection.host.robotCount === 0
            ? "unavailable"
            : projection.host.administrator
              ? "verifying"
              : "blocked";
        this.#store.replace({
          ...this.#store.value,
          coherence,
          activity: projection.activity,
          batteryPercent: projection.batteryPercent,
          host: projection.host,
          fullMap: projection.host.administrator
            && projection.host.robotCount > 0
            && this.#store.value.fullMap,
          robotLabel: projection.robotLabel,
          locale: projection.language,
        });
      }
      if (!this._classic) this.#effects?.sync(projection, this.panel);
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
      return;
    }
    this.#store.dispatch(intent);
  }

  #action(event: CustomEvent<{ readonly id?: unknown }>): void {
    event.stopPropagation();
    if (typeof event.detail?.id !== "string") return;
    if (event.detail.id === "use-classic") {
      if (setPreferredFrontend("v3")) {
        this.#stopControllers();
        this._classic = true;
      }
      return;
    }
    void this.#effects?.executeAction(event.detail.id);
    this.dispatchEvent(new CustomEvent("matic-map-v4-action-requested", {
      detail: { id: event.detail.id },
      bubbles: true,
      composed: true,
    }));
  }

  #useV4(): void {
    if (!setPreferredFrontend("v4")) return;
    this._classic = false;
    this.#startControllers();
    this.requestUpdate();
  }

  protected override updated(): void {
    if (!this._classic) return;
    const classic = this.renderRoot.querySelector<HTMLElement & {
      hass: HassLike | undefined;
      narrow: boolean;
      route: RouteLike | undefined;
      panel: PanelLike | undefined;
    }>("matic-map-panel-v0-3-1");
    if (!classic) return;
    classic.hass = this.hass;
    classic.narrow = this.narrow;
    classic.route = this.route;
    classic.panel = this.panel;
  }

  getWorkspaceSnapshot(): WorkspaceState {
    return this.#store.value;
  }

  protected override render() {
    if (this._classic) {
      return html`
        <style>
          :host { display: block; block-size: 100%; }
          .classic { position: relative; block-size: 100%; }
          .return-v4 {
            position: absolute;
            z-index: 100;
            inset-block-start: max(0.65rem, env(safe-area-inset-top));
            inset-inline-end: max(0.65rem, env(safe-area-inset-right));
            min-block-size: 2.75rem;
            padding-inline: 0.85rem;
            border: 1px solid var(--divider-color, #c2c8cc);
            border-radius: 1.4rem;
            color: var(--primary-text-color, #263238);
            background: var(--card-background-color, #fff);
            box-shadow: 0 5px 18px rgb(31 41 51 / 18%);
            cursor: pointer;
          }
          matic-map-panel-v0-3-1 { display: block; block-size: 100%; }
        </style>
        <div class="classic">
          <button class="return-v4" type="button" @click=${this.#useV4}>Use Map Studio 0.4</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `;
    }
    return html`
      <matic-map-shell-v4
        .state=${this._workspace}
        @matic-workspace-intent=${this.#intent}
        @matic-workspace-action=${this.#action}
      ></matic-map-shell-v4>
    `;
  }
}

if (!customElements.get("matic-map-panel-v0-4-0")) {
  customElements.define("matic-map-panel-v0-4-0", MaticMapPanelV4);
}

declare global {
  interface HTMLElementTagNameMap {
    "matic-map-panel-v0-4-0": MaticMapPanelV4;
  }
}
