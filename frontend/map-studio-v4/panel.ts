import { css, LitElement } from "lit";
import { base, tokens } from "./tokens";
import { html, unsafeStatic } from "lit/static-html.js";
import type { PropertyValues } from "lit";

import type {
  HassLike,
  ColorScheme,
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

// Home Assistant never loads an integration's `common` translations for a
// custom panel, so the panel asks once per connection and language. A rejected
// load keeps its pair recorded and is asked again 30 s later, so while loads
// keep rejecting the panel sends one request every 30 s, with one retry timer
// at a time; a detached panel waits until it is attached again. Hass updates
// never ask more often, and a load that never settles is left alone.
// One request per (connection, language) is enough because Home Assistant's
// frontend changes language in one synchronous call: `_selectLanguage`
// (src/state/translations-mixin.ts) writes the language into hass through
// `_updateHass` (src/state/hass-base-mixin.ts, synchronous assignment) and then
// clears its loaded-integration cache via `_refetchCachedHassTranslations`,
// before Lit delivers that hass to this panel. A request for the new language
// therefore always reaches the backend; no localize-identity guard is needed.
const commonTranslationsRequested = new WeakMap<object, string>();
const NO_CONNECTION: object = {};
const COMMON_RETRY_MS = 30_000;
// Forgets a failed pair so the next update asks again, unless a newer
// language has already replaced it (that load may still be pending).
const forgetFailedPair = (owner: object, language: string): void => {
  if (commonTranslationsRequested.get(owner) === language) commonTranslationsRequested.delete(owner);
};

export class MaticMapPanelV4 extends LitElement {
  static override styles = [tokens, base, css`
:host { display: block; block-size: 100%; color-scheme: light dark; }
`];

  static override properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    route: { attribute: false },
    panel: { attribute: false },
    _workspace: { state: true },
  };

  hass?: HassLike;
  narrow = false;
  route?: RouteLike;
  panel?: PanelLike;
  protected _workspace: WorkspaceState = initialWorkspaceState();

  readonly #adapter = new HassAdapter();
  readonly #store = new WorkspaceStore(this._workspace);
  #projection: HassProjection | null = null;
  #unsubscribe: (() => void) | null = null;
  #backend: MaticBackend | null = null;
  #effects: EffectController | null = null;
  #layers: LayerHistoryController | null = null;
  #stopViewport: (() => void) | null = null;
  // HA's layout viewport can extend below Safari's visible viewport. Cap only
  // this panel, preserving smaller embeds and allowing it to grow again.
  #fitViewport = (): void => {
    if (!this.isConnected) return;
    const viewport = window.visualViewport;
    this.style.maxBlockSize = `${Math.max(0,
      (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0) - this.getBoundingClientRect().top,
    )}px`;
  };
  #commonRetry: {
    readonly owner: object;
    readonly language: string;
    readonly timer: ReturnType<typeof setTimeout>;
  } | null = null;

  #project(
    hass: HassLike | undefined = this.hass,
    panel: PanelLike | undefined = this.panel,
  ): HassProjection {
    const selection = this.#store.value.selection;
    return selection.entrySource === "user"
      ? this.#adapter.project(hass, panel, selection.entryId)
      : this.#adapter.project(hass, panel);
  }

  #requestCommonTranslations(): void {
    const hass = this.hass;
    const load = hass?.loadBackendTranslation;
    if (!hass || typeof load !== "function") return;
    const owner = hass.connection ?? NO_CONNECTION;
    const language = hass.language ?? "";
    if (commonTranslationsRequested.get(owner) === language) return;
    commonTranslationsRequested.set(owner, language);
    void Promise.resolve().then(() => load.call(hass, "common", "matic_robot")).catch(() => {
      if (commonTranslationsRequested.get(owner) !== language) return;
      // A detached panel cannot retry, so it forgets the pair for its reattach.
      if (!this.isConnected) {
        forgetFailedPair(owner, language);
        return;
      }
      // The newest failure owns the one retry timer.
      if (this.#commonRetry) clearTimeout(this.#commonRetry.timer);
      this.#commonRetry = {
        owner,
        language,
        timer: setTimeout(() => {
          this.#commonRetry = null;
          forgetFailedPair(owner, language);
          this.#requestCommonTranslations();
        }, COMMON_RETRY_MS),
      };
    });
  }

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    this.#requestCommonTranslations();
    if (!changed.has("hass")
      || [...changed.keys()].some((property) => property !== "hass")) return true;
    const previousHass = changed.get("hass") as HassLike | undefined;
    // Connection replacement requires new HA subscriptions even when the
    // visible projection is unchanged. Localization can also change while the
    // selected language string remains stable.
    if (previousHass?.connection !== this.hass?.connection
      || previousHass?.localize !== this.hass?.localize) return true;
    return this.#project() !== this.#projection;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const events = new AbortController();
    const observer = new ResizeObserver(this.#fitViewport);
    this.#stopViewport = () => { events.abort(); observer.disconnect(); };
    const options = { signal: events.signal, capture: true };
    for (const target of [window, window.visualViewport]) {
      for (const type of ["resize", "scroll"]) target?.addEventListener(type, this.#fitViewport, options);
    }
    document.addEventListener("fullscreenchange", this.#fitViewport, options);
    observer.observe(this);
    this.#fitViewport();
    this.#requestCommonTranslations();
    this.#unsubscribe = this.#store.subscribe((state) => {
      this._workspace = state;
      if (state.selection.entryId !== this.#projection?.entryKey) {
        const projection = this.#project();
        if (projection !== this.#projection) {
          this.#projection = projection;
          this.#effects?.sync(projection);
        }
      }
    });
    this.#startControllers();
  }

  override disconnectedCallback(): void {
    this.#stopViewport?.();
    this.#stopViewport = null;
    // A detached panel drops its waiting retry and the failed pair with it, so
    // reattaching asks again.
    if (this.#commonRetry) {
      clearTimeout(this.#commonRetry.timer);
      forgetFailedPair(this.#commonRetry.owner, this.#commonRetry.language);
      this.#commonRetry = null;
    }
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
    this.#projection = this.#project();
    this.#backend = new MaticBackend(() => this.hass);
    this.#effects = new EffectController(this.#store, this.#backend, this.hass?.connection ?? null);
    this.#layers = new LayerHistoryController(this.#store);
    this.#layers.start();
    if (this.#projection) {
      this.#effects.sync(this.#projection);
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

  // The colour scheme willUpdate picks; the shell and map re-read their
  // theme colours when it changes (theme-probe.ts watches only the document).
  #scheme: ColorScheme = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Light or dark follows Home Assistant's theme; the device only when HA
    // gives no answer (design-system.md Decision 3). Every shadow root inherits it.
    const dark = this.hass?.themes?.darkMode;
    this.#scheme = dark === true ? "dark" : dark === false ? "light" : "";
    this.style.colorScheme = this.#scheme;
    if (changed.has("hass") || changed.has("panel")) {
      const previousHass = changed.get("hass") as HassLike | undefined;
      const connectionChanged = changed.has("hass")
        && previousHass?.connection !== this.hass?.connection;
      const projection = this.#project();
      const projectionChanged = projection !== this.#projection;
      if (projectionChanged) {
        this.#projection = projection;
      }
      if (connectionChanged) {
        this.#stopControllers();
        this.#startControllers();
      } else if (projectionChanged || changed.has("panel")) {
        this.#effects?.sync(projection);
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
      if (this.#adapter.project(this.hass, this.panel, intent.entryId).entryKey !== intent.entryId) return;
      this.#store.dispatch(intent);
      return;
    }
    if (intent.type === "set-history") {
      void this.#effects?.selectHistory(intent.historyId);
      return;
    }
    if (intent.type === "select-plan") {
      this.#effects?.selectPlan(intent.planId, false, intent.origin);
      return;
    }
    if (intent.type === "set-plan-enabled") {
      void this.#effects?.setPlanEnabled(intent.enabled);
      return;
    }
    if (intent.type === "set-home-pin") {
      const before = this.#store.value;
      if (before.homePins.status === "ready"
        && before.homePins.pins.some((pin) => pin.kind === intent.pin.kind && pin.id === intent.pin.id) !== intent.pinned) {
        // Update the follower's exclusions before dispatch notifies it; otherwise
        // its synchronous catalog reconciliation can undo this explicit choice.
        this.#effects?.saveHomePin(intent.pin, intent.pinned, before.homePins.pins);
        this.#store.dispatch(intent);
      }
      return;
    }
    if (intent.type === "move-home-pin") {
      this.#effects?.moveHomePin(intent.pin, intent.direction);
      return;
    }
    if (intent.type === "reload-home-pins") {
      void this.#effects?.loadHomePins();
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
    if ("planId" in event.detail && "roomId" in event.detail) {
      void this.#effects?.executeAction(event.detail);
    } else {
      void this.#effects?.executeAction(event.detail.id, "settled" in event.detail ? event.detail.settled : undefined);
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

  /** Content-free, on-demand measurements for this controller lifetime. */
  getRequestDiagnostics() {
    return Object.freeze({
      http: this.#backend?.requestDiagnostics() ?? null,
      workspace: this.#effects?.workspaceDiagnostics() ?? null,
    });
  }

  protected override render() {
    return html`
      <${shellTag}
        .state=${this._workspace}
        .localize=${this.hass?.localize}
        .dates=${this.#projection?.dates}
        .scheme=${this.#scheme}
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
