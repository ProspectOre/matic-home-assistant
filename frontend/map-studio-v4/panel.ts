import { css, LitElement, nothing } from "lit";
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
import {
  preferredFrontend,
  setPreferredFrontend,
} from "./preferences";
import "./shell";
import { initialWorkspaceState, WorkspaceStore } from "./state";
import { translate } from "./localize";

const shellTag = unsafeStatic(SHELL_TAG);

export class MaticMapPanelV4 extends LitElement {
  // The host must size itself on BOTH branches. This lived inside the classic
  // branch's <style>, so on the v0.4 path the host stayed display:inline with
  // auto height and the shell's block-size:100% resolved against nothing --
  // the panel fell back to its 36rem minimum instead of filling the viewport.
  static override styles = [tokens, base, css`
:host { display: block; block-size: 100%; }
.classic { position: relative; block-size: 100%; }
.return-v4 {
  position: absolute;
  z-index: 100;
  inset-block-start: max(0.65rem, var(--ms-safe-top));
  inset-inline-end: max(0.65rem, var(--ms-safe-right));
  min-block-size: 2.75rem;
  padding-inline: 0.85rem;
  border: 1px solid var(--divider-color, #c2c8cc);
  border-radius: 1.4rem;
  color: var(--primary-text-color, #263238);
  background: var(--card-background-color, #fff);
  box-shadow: 0 5px 18px rgb(31 41 51 / 18%);
  cursor: pointer;
}
.classic-load-status {
  position: absolute;
  z-index: 101;
  inset-block-start: max(0.65rem, var(--ms-safe-top));
  inset-inline-start: max(0.65rem, var(--ms-safe-left));
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-block-size: 2.75rem;
  padding: 0 0.85rem;
  border: 1px solid var(--divider-color, #c2c8cc);
  border-radius: 1.4rem;
  color: var(--primary-text-color, #263238);
  background: var(--card-background-color, #fff);
  box-shadow: 0 5px 18px rgb(31 41 51 / 18%);
}
.classic-load-status button {
  min-block-size: 2.25rem;
  padding: 0 0.65rem;
  border: 1px solid var(--divider-color, #c2c8cc);
  border-radius: 1.2rem;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
matic-map-panel-v0-3-1 { display: block; block-size: 100%; }
`];

  static override properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    route: { attribute: false },
    panel: { attribute: false },
    _workspace: { state: true },
    _classic: { state: true },
    _classicLoading: { state: true },
    _classicLoadError: { state: true },
    entryOverride: { state: true },
  };

  hass?: HassLike;
  narrow = false;
  route?: RouteLike;
  panel?: PanelLike;
  protected _workspace: WorkspaceState = initialWorkspaceState();
  protected _classic = false;
  protected _classicLoading = false;
  protected _classicLoadError = false;
  entryOverride: string | null = null;

  readonly #adapter = new HassAdapter();
  readonly #store = new WorkspaceStore(this._workspace);
  #projection: HassProjection | null = null;
  #unsubscribe: (() => void) | null = null;
  #backend: MaticBackend | null = null;
  #effects: EffectController | null = null;
  #layers: LayerHistoryController | null = null;
  #classicModulePromise: Promise<unknown> | null = null;
  #classicLoadGeneration = 0;
  #classicLoadAttempt = 0;

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    if (this._classic || !changed.has("hass")
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
    this._classic = false;
    this.#unsubscribe = this.#store.subscribe((state) => {
      this._workspace = state;
    });
    if (preferredFrontend() === "v3") void this.#loadClassic(true);
    else this.#startControllers();
  }

  override disconnectedCallback(): void {
    this.#classicLoadGeneration += 1;
    this._classicLoading = false;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#stopControllers();
    super.disconnectedCallback();
  }

  #startControllers(): void {
    if (this.#effects) return;
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
          robots: projection.robots,
          locale: projection.language,
        });
      }
      if (!this._classic && connectionChanged) {
        this.#stopControllers();
        this.#startControllers();
      } else if (!this._classic
        && (projectionChanged || changed.has("panel") || changed.has("entryOverride"))) {
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
    if (event.detail.id === "use-classic") {
      void this.#loadClassic(false);
      return;
    }
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

  #useV4(): void {
    if (!setPreferredFrontend("v4")) return;
    this.#classicLoadGeneration += 1;
    this._classicLoading = false;
    this._classicLoadError = false;
    this._classic = false;
    this.#startControllers();
    this.requestUpdate();
  }

  async #loadClassic(restorePreference: boolean): Promise<void> {
    if (this._classic || this._classicLoading) return;
    this._classicLoading = true;
    this._classicLoadError = false;
    const generation = ++this.#classicLoadGeneration;
    this.requestUpdate();
    try {
      if (!this.#classicModulePromise) {
        const configuredUrl = this.panel?.config?.classic_module_url;
        if (typeof configuredUrl !== "string" || !configuredUrl.startsWith("/")) {
          throw new Error("Classic module URL is unavailable");
        }
        const url = new URL(configuredUrl, window.location.href);
        if (url.origin !== window.location.origin) {
          throw new Error("Classic module must be served locally");
        }
        url.searchParams.set("load_attempt", String(++this.#classicLoadAttempt));
        this.#classicModulePromise = import(url.href).then(() =>
          customElements.whenDefined("matic-map-panel-v0-3-1"),
        );
      }
      await this.#classicModulePromise;
      if (!this.isConnected || generation !== this.#classicLoadGeneration) return;
      if (!restorePreference && !setPreferredFrontend("v3")) {
        throw new Error("Could not save the selected frontend");
      }
      this.#stopControllers();
      this._classic = true;
      this._classicLoadError = false;
    } catch {
      if (!this.isConnected || generation !== this.#classicLoadGeneration) return;
      this.#classicModulePromise = null;
      this._classicLoadError = true;
      // A saved classic preference must not leave the user with an inert panel
      // if the optional fallback asset cannot be fetched.
      this.#startControllers();
    } finally {
      if (generation === this.#classicLoadGeneration) {
        this._classicLoading = false;
        this.requestUpdate();
      }
    }
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
        <div class="classic">
          <button class="return-v4" type="button" @click=${this.#useV4}>${translate(this.hass?.localize, "v4_use_new", "Use Map Studio")}</button>
          <matic-map-panel-v0-3-1></matic-map-panel-v0-3-1>
        </div>
      `;
    }
    return html`
      ${this._classicLoading || this._classicLoadError ? html`
        <div class="classic-load-status" role=${this._classicLoadError ? "alert" : "status"} aria-live=${this._classicLoadError ? "assertive" : "polite"}>
          <span>${this._classicLoadError
            ? translate(this.hass?.localize, "v4_classic_load_failed", "Classic map could not open.")
            : translate(this.hass?.localize, "v4_classic_loading", "Loading classic map…")}</span>
          ${this._classicLoadError
            ? html`<button type="button" @click=${() => this.#loadClassic(false)}>${translate(this.hass?.localize, "v4_retry", "Retry")}</button>`
            : nothing}
        </div>
      ` : nothing}
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
