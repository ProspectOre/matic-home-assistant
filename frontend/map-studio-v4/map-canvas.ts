import { LitElement, css, html, nothing } from "lit";
import { controls } from "./controls";
import { renderDrawTools } from "./draw-tools";
import { icon, iconExitFullMap, iconFit, iconFullMap, iconHelp, iconOrbitLeft, iconOrbitRight, iconRoomNames, iconTiltDown, iconTiltUp } from "./icons";
import { RovingFocusController } from "./roving-focus";
import { readCanvasPalette } from "./theme-probe";
import { base, tokens } from "./tokens";
import type { PropertyValues } from "lit";

import type { Localize, WorkspaceIntent, WorkspaceState } from "./contracts";
import { MAP_CANVAS_TAG } from "./element-tags";
import { GestureController } from "./gesture-controller";
import { RendererController, type RendererDiagnostics } from "./renderer-controller";
import {
  canShowExactPose,
  canShowLiveMap,
  initialWorkspaceState,
  mapScale,
} from "./state";
import { translate } from "./localize";

export const WORKSPACE_INTENT_EVENT = "matic-workspace-intent";
export const WORKSPACE_ACTION_EVENT = "matic-workspace-action";

const NAVIGATION_HELP_ID = "navigation-help";

const describeMap = (state: WorkspaceState, localize?: Localize): string => {
  const t = (key: string, fallback: string, placeholders?: Record<string, string | number>): string =>
    translate(localize, key, fallback, placeholders);
  if (!canShowLiveMap(state)) return t("v4_private_map_unavailable", "The current private map is not available.");
  if (state.dataMode === "history") {
    return t(
      "v4_saved_map_description",
      "Saved read-only map for {floor}. Live robot position is hidden.",
      { floor: state.floor.displayName },
    );
  }
  const pose = canShowExactPose(state)
    ? t("v4_robot_position_verified", "The robot position is verified.")
    : t("v4_robot_position_hidden", "The robot position is not shown.");
  return t("v4_live_map_description", "Live map for {floor}. {pose}", {
    floor: state.floor.displayName,
    pose,
  });
};

export class MaticMapCanvasV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    // Reflected so the stylesheet can anchor the rail with :host([narrow]).
    // On a phone the sheet owns the drawing tools, appearance switch, room
    // names and help; the map keeps only view, fit and full map.
    narrow: { type: Boolean, reflect: true },
  };

  static override styles = [tokens, base, controls, css`
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
      block-size: 100%;
      color: var(--primary-text-color, #1f2933);
    }


    button, input { font: inherit; }

    .map-root {
      position: relative;
      overflow: hidden;
      min-block-size: 22rem;
      block-size: 100%;
      outline: none;
      isolation: isolate;
      background: var(--secondary-background-color, #edf2f4);
      touch-action: none;
      cursor: grab;
      container-type: inline-size;
    }

    .map-root.navigating { cursor: grabbing; }
    .map-root[data-workflow="draw"][data-draw-tool="paint"],
    .map-root[data-workflow="draw"][data-draw-tool="erase"] { cursor: crosshair; }
    .map-root[data-workflow="draw"][data-draw-tool="pan"] { cursor: grab; }
    .map-root[data-workflow="draw"][data-draw-tool="pan"].navigating { cursor: grabbing; }

    .map-root:focus-visible {
      outline: 3px solid var(--primary-color, #03a9f4);
      outline-offset: -3px;
    }

    /* One self-packing rail replaces the old ladder of absolutely positioned
       siblings whose offsets (0.75 / 4.25 / 7.2rem) encoded which of the
       others happened to be visible. Groups simply stack; a hidden group
       leaves no hole. */
    .map-rail {
      position: absolute;
      z-index: 4;
      inset-block-start: 0.75rem;
      inset-inline-end: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: var(--ms-space-2);
      align-items: flex-end;
      max-inline-size: calc(100% - 1.5rem);
    }
    :host([narrow]) .map-rail,
    .map-root[data-narrow] .map-rail {
      inset-block-start: auto;
      inset-block-end: calc(0.75rem + var(--map-sheet-offset, 0px));
      inset-inline-end: 0.75rem;
    }

    .map-tools, .view-switch, .appearance-switch, .camera-steps { display: flex; }

    .map-dock, .map-scale, .map-message { position: absolute; z-index: 4; }

    .map-dock {
      inset-inline-start: 50%;
      inset-block-end: calc(0.75rem + var(--map-sheet-offset, 0px));
      translate: -50% 0;
      max-inline-size: calc(100% - 1rem);
    }
    .map-dock .draw-tools--row { flex-direction: row; gap: var(--ms-space-1); }
    .map-dock .draw-tools button { padding-inline: var(--ms-space-2); }
    .selection-chip {
      display: flex;
      align-items: center;
      gap: var(--ms-space-3);
      padding: var(--ms-space-1) var(--ms-space-1) var(--ms-space-1) var(--ms-space-3);
      font-size: var(--ms-t-sm);
      font-weight: var(--ms-w-bold);
      white-space: nowrap;
    }

    .navigation-help {
      inline-size: 22rem;
      max-inline-size: 100%;
      padding: 0.8rem 0.9rem;
      font-size: 0.74rem;
      line-height: 1.45;
    }
    .navigation-help header { display: flex; align-items: center; justify-content: space-between; gap: var(--ms-space-2); margin-block-end: 0.5rem; }
    .navigation-help h3 { margin: 0; font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
    .navigation-help dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.35rem 0.65rem; margin: 0; }
    .navigation-help dt { font-weight: 750; }
    .navigation-help dd { margin: 0; color: var(--secondary-text-color, #687984); }

    .scene-window {
      position: absolute;
      inset: 0;
      inset-block-end: var(--map-sheet-offset, 0px);
      overflow: hidden;
    }

    .scene-window[hidden] { display: none; }

    .scene-canvas,
    .overlay-canvas {
      position: absolute;
      inset: 0;
      inline-size: 100%;
      block-size: 100%;
    }

    .scene-canvas { z-index: 0; }
    .overlay-canvas { z-index: 1; pointer-events: none; }

    .map-scale {
      inset-inline-start: 0.9rem;
      inset-block-end: calc(5.2rem + var(--map-sheet-offset, 0px));
      display: grid;
      justify-items: start;
      gap: 0.25rem;
      border: 0;
      background: transparent;
      box-shadow: none;
      color: var(--secondary-text-color, #53636d);
      font-size: 0.7rem;
      font-weight: 650;
    }

    .scale-line {
      inline-size: var(--scale-width);
      block-size: 0.42rem;
      border-inline: 2px solid currentColor;
      border-block-end: 2px solid currentColor;
    }

    .map-message {
      inset: 50% auto auto 50%;
      translate: -50% -50%;
      inline-size: min(22rem, calc(100% - 2rem));
      padding: 1rem 1.1rem;
      text-align: center;
    }

    .map-message strong { display: block; margin-block-end: 0.35rem; }
    .map-message span { color: var(--secondary-text-color, #687984); font-size: 0.82rem; }

    .sr-only {
      position: absolute;
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

/* Four labelled buttons span most of the map at desktop width; icons with tooltips keep the rail a narrow column. */
.map-tools .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
@container (max-width: 29rem) {
.map-tools button, .map-dock .draw-tools button { padding-inline: 0; inline-size: var(--ms-control); }
/* Collapse the label to assistive text, never display:none. Hiding it would
   delete the accessible name and break every getByRole({ name }) query at
   narrow widths -- which is what the previous font-size:0 plus ::first-letter
   trick did, while also rendering the toolbar as "P E M U R D". */
.map-dock .draw-tools .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
}
@media (forced-colors: active) {
/* The map is painted to canvas, so the UA would otherwise invert it. The
   previous block here targeted the mock-map layer that the renderer replaced,
   which meant the map had no forced-colors treatment at all. */
.scene-canvas, .overlay-canvas { forced-color-adjust: none; }
.map-root { border: 1px solid CanvasText; }
}
  `];

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;
  narrow = false;
  #fullMapLauncher: HTMLElement | null = null;
  #helpLauncher: HTMLElement | null = null;
  #renderer: RendererController | null = null;
  #gestures: GestureController | null = null;
  #navigationHelp = false;
  #focusHelpOnUpdate = false;
  #themeObserver: MutationObserver | null = null;
  #themeQueries: MediaQueryList[] = [];

  constructor() {
    super();
    new RovingFocusController(this, {
      container: () => this.renderRoot?.querySelector<HTMLElement>(".camera-steps") ?? null,
      items: "button",
    });
  }

  #t(key: string, fallback: string, placeholders?: Record<string, string | number>): string {
    return translate(this.localize, key, fallback, placeholders);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#watchTheme();
  }

  protected override firstUpdated(): void {
    const root = this.renderRoot.querySelector<HTMLElement>(".map-root");
    const scene = this.renderRoot.querySelector<HTMLCanvasElement>(".scene-canvas");
    const overlay = this.renderRoot.querySelector<HTMLCanvasElement>(".overlay-canvas");
    if (!root || !scene || !overlay) return;
    this.#renderer = new RendererController(scene, overlay, {
      onCamera: (camera, zoomPercent, origin) => {
        this.#intent({
          type: "set-camera",
          view: this.state.workflow === "draw" ? "top" : this.state.view,
          camera: {
            yaw: camera.yaw,
            pitch: camera.pitch,
            zoom: zoomPercent / 100,
            targetX: camera.targetX,
            targetZ: camera.targetZ,
          },
        });
        if (this.state.workflow === "draw" && zoomPercent !== this.state.draw.zoomPercent) {
          this.#intent({
            type: "set-zoom",
            value: zoomPercent,
            ...(origin ? { originX: origin.xPercent, originY: origin.yPercent } : {}),
          });
        }
      },
      onRoom: (roomId) => this.#intent({ type: "toggle-room", roomId }),
      onProblem: () => this.#action("renderer-problem"),
    });
    this.#gestures = new GestureController(root, this.#renderer, {
      state: () => this.state,
      onCircles: (circles, record, previous) => this.#intent({
        type: "set-draft-circles",
        circles,
        record,
        ...(previous ? { previous } : {}),
      }),
      onRoom: (roomId) => this.#intent({ type: "toggle-room", roomId }),
    });
    this.#applyPalette();
    this.#renderer.setState(this.state);
  }

  override disconnectedCallback(): void {
    this.#unwatchTheme();
    this.#gestures?.dispose();
    this.#gestures = null;
    this.#renderer?.dispose();
    this.#renderer = null;
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (this.#focusHelpOnUpdate) {
      this.#focusHelpOnUpdate = false;
      this.renderRoot.querySelector<HTMLElement>(".navigation-help button")?.focus();
    }
    if (!changed.has("state")) return;
    const previous = changed.get("state") as WorkspaceState | undefined;
    if (previous?.fullMap && !this.state.fullMap && this.#fullMapLauncher) {
      this.#fullMapLauncher.focus();
    }
    this.#renderer?.setState(this.state);
  }

  // Canvas 2D cannot read CSS custom properties, so the renderer is handed a
  // palette probed from the design tokens. The probe span lives inside the
  // shadow root so the --ms-* tokens resolve; it is re-read whenever Home
  // Assistant rewrites its theme variables on <html>, or the OS flips colour
  // scheme / forced colours.
  #applyPalette(): void {
    const root = this.renderRoot?.querySelector<HTMLElement>(".map-root");
    if (!root || !this.#renderer) return;
    this.#renderer.setPalette(readCanvasPalette(root));
  }

  readonly #onThemeChange = (): void => { this.#applyPalette(); };

  #watchTheme(): void {
    if (typeof document === "undefined" || this.#themeObserver) return;
    this.#themeObserver = new MutationObserver(this.#onThemeChange);
    this.#themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    if (typeof window.matchMedia !== "function") return;
    this.#themeQueries = [
      window.matchMedia("(prefers-color-scheme: dark)"),
      window.matchMedia("(forced-colors: active)"),
    ];
    for (const query of this.#themeQueries) query.addEventListener("change", this.#onThemeChange);
  }

  #unwatchTheme(): void {
    this.#themeObserver?.disconnect();
    this.#themeObserver = null;
    for (const query of this.#themeQueries) query.removeEventListener("change", this.#onThemeChange);
    this.#themeQueries = [];
  }

  #intent(intent: WorkspaceIntent): void {
    this.dispatchEvent(new CustomEvent<WorkspaceIntent>(WORKSPACE_INTENT_EVENT, {
      detail: intent,
      bubbles: true,
      composed: true,
    }));
  }

  #action(id: string): void {
    this.dispatchEvent(new CustomEvent(WORKSPACE_ACTION_EVENT, {
      detail: { id },
      bubbles: true,
      composed: true,
    }));
  }

  #toggleFullMap(event: Event): void {
    this.#fullMapLauncher = event.currentTarget as HTMLElement;
    this.#intent({ type: this.state.fullMap ? "exit-full-map" : "enter-full-map" });
  }

  #toggleHelp(event: Event): void {
    this.#helpLauncher = event.currentTarget as HTMLElement;
    this.#navigationHelp = !this.#navigationHelp;
    this.#focusHelpOnUpdate = this.#navigationHelp;
    this.requestUpdate();
  }

  #closeHelp(): void {
    if (!this.#navigationHelp) return;
    this.#navigationHelp = false;
    this.requestUpdate();
    const launcher = this.#helpLauncher;
    if (launcher?.isConnected) launcher.focus();
  }

  #clearSelection(): void {
    // The store has no clear-selection intent; every room is toggled off.
    for (const roomId of this.state.selection.roomIds) {
      this.#intent({ type: "toggle-room", roomId });
    }
  }

  #orbit(horizontal: number, vertical: number): void {
    this.#renderer?.orbitBy(horizontal, vertical);
  }

  #keyboard(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.#navigationHelp) {
        this.#closeHelp();
        return;
      }
      this.#intent({ type: "dismiss-top-layer" });
      return;
    }
  }

  rendererDiagnostics(): RendererDiagnostics | null {
    return this.#renderer?.diagnostics() ?? null;
  }

  canvasIdentity(): { readonly scene: HTMLCanvasElement | null; readonly overlay: HTMLCanvasElement | null } {
    return {
      scene: this.renderRoot.querySelector<HTMLCanvasElement>(".scene-canvas"),
      overlay: this.renderRoot.querySelector<HTMLCanvasElement>(".overlay-canvas"),
    };
  }

  #message(): { readonly title: string; readonly detail: string } | null {
    if (!this.state.host.connected) {
      return { title: this.#t("v4_reconnecting", "Reconnecting"), detail: this.#t("v4_reconnecting_detail", "The verified map is read only until Home Assistant reconnects.") };
    }
    if (!this.state.host.administrator) {
      return { title: this.#t("v4_admin_required", "Administrator access required"), detail: this.#t("v4_private_map_hidden", "Private map data is hidden.") };
    }
    if (this.state.host.robotCount === 0) {
      return { title: this.#t("v4_no_robot", "No Matic robot set up"), detail: this.#t("v4_no_robot_detail", "Set up a robot before opening its map.") };
    }
    if (!this.state.host.robotConnected) {
      return { title: this.#t("v4_robot_offline", "Robot offline"), detail: this.#t("v4_robot_offline_detail", "The last verified map stays read only and has no live position.") };
    }
    if (this.state.coherence === "verifying" || this.state.coherence === "booting") {
      return { title: this.#t("v4_locating_map", "Locating the current map"), detail: this.#t("v4_locating_map_detail", "Map controls will return after the floor is verified.") };
    }
    if (!this.state.map.available && this.state.resources.scene.status === "loading") {
      return { title: this.#t("v4_loading_verified_map", "Loading the verified map"), detail: this.#t("v4_loading_verified_map_detail", "The current floor is verified. The private scene is still preparing.") };
    }
    if (!this.state.map.available) {
      return { title: this.#t("v4_map_unavailable", "Map unavailable"), detail: this.#t("v4_map_unavailable_detail", "The private scene is not ready. No map data is shown until it is verified.") };
    }
    if (this.state.activity === "problem") {
      return { title: this.#t("v4_robot_attention", "Robot needs attention"), detail: this.#t("v4_robot_attention_detail", "Check the robot before starting another task.") };
    }
    return null;
  }

  #renderRail(showScene: boolean, locating: boolean) {
    const state = this.state;
    const narrow = this.narrow;
    const draw = state.workflow === "draw";
    const helpTitle = this.#t("v4_how_to_move", "How to move the map");
    // Draw forces the top view, so the view, appearance and camera groups are
    // noise there; the sheet owns the tools on a phone. Both leave the rail
    // as [Fit] + [Full map].
    const showView = showScene && !draw;
    const showAppearance = showView && !narrow && state.view === "top";
    const showCamera = showView && state.view === "three";
    const showTools = !locating || state.fullMap;
    const showExtras = !narrow && !draw;
    if (!showView && !showTools) return nothing;
    return html`
      <div class="map-rail" data-map-control>
        ${showView ? html`
          <div class="view-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#t("map_view_label", "Map view")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(state.view === "three")}
              @click=${() => this.#intent({ type: "set-view", view: "three" })}
            >${this.#t("map_view_3d", "3D")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(state.view === "top")}
              @click=${() => this.#intent({ type: "set-view", view: "top" })}
            >${this.#t("map_view_top", "2D")}</button>
          </div>
        ` : nothing}

        ${showAppearance ? html`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#t("map_style_label", "2D map style")}>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(state.appearance === "photo")}
              @click=${() => this.#intent({ type: "set-appearance", appearance: "photo" })}
            >${this.#t("map_style_photo", "Photo")}</button>
            <button
              class="ms-btn"
              type="button"
              aria-pressed=${String(state.appearance === "rooms")}
              @click=${() => this.#intent({ type: "set-appearance", appearance: "rooms" })}
            >${this.#t("map_style_room_colours", "Room colours")}</button>
          </div>
        ` : nothing}

        ${showCamera ? html`
          <div class="camera-steps ms-surface ms-surface--floating ms-segment" role="toolbar" aria-orientation="horizontal" aria-label=${this.#t("map_camera_controls", "Map camera controls")}>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#t("map_rotate_left", "Rotate left")} aria-keyshortcuts="[" @click=${() => this.#orbit(-52, 0)}>${icon(iconOrbitLeft)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#t("map_tilt_down", "Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${() => this.#orbit(0, 30)}>${icon(iconTiltDown)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#t("map_tilt_up", "Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${() => this.#orbit(0, -30)}>${icon(iconTiltUp)}</button>
            <button class="ms-btn ms-btn--icon" type="button" aria-label=${this.#t("map_rotate_right", "Rotate right")} aria-keyshortcuts="]" @click=${() => this.#orbit(52, 0)}>${icon(iconOrbitRight)}</button>
          </div>
        ` : nothing}

        ${showTools ? html`
          <div class="map-tools ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#t("v4_map_tools", "Map tools")}>
            ${!locating ? html`
              <button
                class="fit ms-btn"
                type="button"
                aria-label=${this.#t("v4_fit_map_hint", "Fit the whole map on screen")}
                @click=${() => {
                  this.#renderer?.fit();
                  this.#intent({ type: "fit-map" });
                }}
                title=${this.#t("v4_fit_map", "Fit map")}
              >${icon(iconFit)}<span class="ms-btn__label">${this.#t("v4_fit_map", "Fit map")}</span></button>
            ` : nothing}
            ${!locating && showExtras ? html`
              <button
                class="labels ms-btn"
                type="button"
                aria-pressed=${String(state.labelsVisible)}
                @click=${() => this.#intent({ type: "toggle-labels" })}
                title=${this.#t("v4_room_names", "Room names")}
              >${icon(iconRoomNames)}<span class="ms-btn__label">${this.#t("v4_room_names", "Room names")}</span></button>
              <button
                class="help ms-btn ms-btn--icon"
                type="button"
                aria-label=${helpTitle}
                aria-expanded=${String(this.#navigationHelp)}
                aria-controls=${NAVIGATION_HELP_ID}
                @click=${this.#toggleHelp}
                title=${helpTitle}
              >${icon(iconHelp)}</button>
            ` : nothing}
            <button
              class="full-map ms-btn"
              type="button"
              aria-label=${this.#t("v4_full_map", "Full map")}
              aria-pressed=${String(state.fullMap)}
              @click=${this.#toggleFullMap}
              title=${state.fullMap ? this.#t("v4_exit_full_map", "Exit full map") : this.#t("v4_full_map", "Full map")}
            >${icon(state.fullMap ? iconExitFullMap : iconFullMap)}<span class="ms-btn__label">${state.fullMap ? this.#t("v4_exit_full_map", "Exit full map") : this.#t("v4_full_map", "Full map")}</span></button>
          </div>
        ` : nothing}

        ${this.#navigationHelp && showScene && showExtras ? html`
          <div
            id=${NAVIGATION_HELP_ID}
            class="navigation-help ms-surface ms-surface--floating"
            role="dialog"
            aria-modal="false"
            aria-label=${helpTitle}
          >
            <header>
              <h3>${helpTitle}</h3>
              <button class="ms-btn ms-btn--sm" type="button" @click=${() => this.#closeHelp()}>${this.#t("v4_close", "Close")}</button>
            </header>
            <dl>
              <dt>${this.#t("v4_trackpad", "Trackpad")}</dt>
              <dd>${this.#t("v4_trackpad_help", "Scroll to pan · pinch to zoom · twist to rotate")}</dd>
              <dt>${this.#t("v4_mouse", "Mouse")}</dt>
              <dd>${this.#t("v4_mouse_help", "Drag to orbit · Shift, middle, or right drag to pan · wheel to zoom")}</dd>
              <dt>${this.#t("v4_keyboard", "Keyboard")}</dt>
              <dd>${this.#t("v4_keyboard_help", "WASD to move · Q/E or arrows to orbit · +/− to zoom · 0 to fit")}</dd>
            </dl>
          </div>
        ` : nothing}
      </div>
    `;
  }

  #renderDock(showScene: boolean) {
    const state = this.state;
    if (!showScene) return nothing;
    if (state.workflow === "draw" && !this.narrow) {
      return html`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          ${renderDrawTools(state, {
            intent: (intent) => this.#intent(intent),
            openBrush: () => this.#intent({ type: "set-precision-open", value: !state.precisionOpen }),
            t: (key, fallback) => this.#t(key, fallback),
          }, "row")}
        </div>
      `;
    }
    // On a phone the sheet's grip line already reads "N rooms", so the map
    // chip would only duplicate it.
    const count = state.selection.roomIds.length;
    if (state.workflow === "rooms" && count > 0 && !this.narrow) {
      return html`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          <div class="selection-chip ms-surface ms-surface--floating" data-map-control>
            <span>${this.#t("v4_rooms_selected", "{count} rooms selected").replace("{count}", String(count))}</span>
            <button class="ms-btn ms-btn--sm" type="button" @click=${() => this.#clearSelection()}>${this.#t("v4_clear", "Clear")}</button>
          </div>
        </div>
      `;
    }
    return nothing;
  }

  protected override render() {
    const state = this.state;
    const scale = mapScale(state);
    const message = this.#message();
    const showScene = state.map.available && (canShowLiveMap(state) || state.dataMode === "history");
    const showDraw = state.workflow === "draw" && showScene;
    const locating = state.coherence === "verifying" || state.coherence === "booting";
    return html`
      <section
        class="map-root"
        tabindex="0"
        aria-label=${this.#t("map_viewport_aria", "Interactive Matic 3D map")}
        data-full-map=${String(state.fullMap)}
        data-workflow=${state.workflow}
        data-draw-tool=${state.draw.tool}
        data-narrow=${this.narrow ? "true" : nothing}
        @keydown=${this.#keyboard}
      >
        ${this.#renderRail(showScene, locating)}

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!showScene}
          role="img"
          aria-label=${describeMap(state, this.localize)}
        >
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
        </div>

        ${showDraw ? html`
          <div class="map-scale" aria-label=${`Scale ${scale.label}`}>
            <span class="scale-line" style=${`--scale-width:${scale.pixels}px`}></span>
            <span>${scale.label}</span>
          </div>
        ` : nothing}

        ${this.#renderDock(showScene)}

        ${message && !(state.fullMap && (locating || !state.host.administrator)) ? html`
          <div class="map-message ms-surface ms-surface--floating" role="status">
            <strong>${message.title}</strong>
            <span>${message.detail}</span>
          </div>
        ` : nothing}
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          ${describeMap(state, this.localize)}
        </div>
      </section>
    `;
  }
}

if (!customElements.get(MAP_CANVAS_TAG)) {
  customElements.define(MAP_CANVAS_TAG, MaticMapCanvasV4);
}
