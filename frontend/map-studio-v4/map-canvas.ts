import { OutlineEditor } from "./outline-editor";
import { LitElement, css, html, nothing } from "lit";
import { controls } from "./controls";
import { renderDrawTools } from "./draw-tools";
import { icon, iconFit, iconHelp, iconOrbitLeft, iconOrbitRight, iconRoomNames, iconTiltDown, iconTiltUp } from "./icons";
import { RovingFocusController } from "./roving-focus";
import { readCanvasPalette } from "./theme-probe";
import { base, tokens } from "./tokens";
import type { PropertyValues } from "lit";

import type { Localize, WorkspaceIntent, WorkspaceState } from "./contracts";
import { MAP_CANVAS_TAG } from "./element-tags";
import { GestureController, isNativeSelectControl } from "./gesture-controller";
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
  if (state.dataMode === "history") {
    if (!state.map.available) {
      return state.resources.scene.status === "loading"
        ? t("v4_saved_map_loading_description", "The saved map is loading.")
        : t("v4_saved_map_unavailable_description", "This saved map is unavailable.");
    }
    return t(
      "v4_saved_map_description",
      "Saved read-only map for {floor}. Live robot position is hidden.",
      { floor: state.floor.displayName },
    );
  }
  if (!canShowLiveMap(state)) return t("v4_private_map_unavailable", "The current private map is not available.");
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
    // names and help; the map keeps only view and fit.
    narrow: { type: Boolean, reflect: true },
  };

  static override styles = [tokens, base, controls, css`
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
      block-size: 100%;
      color: var(--ms-text);
    }


    button, input { font: inherit; }

    .map-root {
      position: relative;
      overflow: hidden;
      min-block-size: 22rem;
      block-size: 100%;
      outline: none;
      isolation: isolate;
      --ms-local: var(--ms-surface-sunken);
      background: var(--ms-local);
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

    /* Navigation has stable corners; only orbit controls follow the sheet. */
    .map-rail { --help-top: calc(44px + 2 * var(--ms-space-2)); --help-bottom: 116px; position: absolute; inset: 0.75rem; z-index: 4; pointer-events: none; }
    .map-rail > * { pointer-events: auto; }
    slot[name="scrim"] { display: contents; pointer-events: none; }
    ::slotted(.sheet-scrim) { pointer-events: auto; }
    .map-context { position: absolute; inset-block-start: 0; inset-inline-start: 0; display: flex; gap: var(--ms-space-2); align-items: center; max-inline-size: calc(100% - 60px); }
    ::slotted(.floor-switcher) { min-inline-size: 0; inline-size: 9rem; min-block-size: 44px; background-color: var(--ms-surface-card); color: var(--ms-text); }
    .view-switch { flex: none; }
    .map-tools { position: absolute; inset-block-start: 0; inset-inline-end: 0; }
    .map-extras { position: absolute; inset-block-end: calc(var(--map-sheet-offset, 0px) + 52px); inset-inline-end: 0; display: flex; }
    .appearance-switch { position: absolute; inset-block-start: calc(44px + 2 * var(--ms-space-2)); inset-inline-start: 0; }
    .camera-steps { position: absolute; inset-block-end: var(--map-sheet-offset, 0px); inset-inline-end: 0; }
    .map-root:has(.selection-chip) .camera-steps { inset-block-end: calc(var(--map-sheet-offset, 0px) + 4rem); }
    .map-root:has(.selection-chip) .map-extras { inset-block-end: calc(var(--map-sheet-offset, 0px) + 4rem + 52px); }
    .map-rail:has(.appearance-switch) { --help-top: calc(88px + 4 * var(--ms-space-2)); }
    .map-root:has(.selection-chip) .map-rail { --help-bottom: calc(116px + 4rem); }
    .navigation-help { position: absolute; inset-block-start: var(--help-top); inset-inline-end: 0; max-block-size: calc(100% - var(--help-top) - var(--help-bottom)); overflow: auto; box-sizing: border-box; }
    :host([narrow]) .map-context { max-inline-size: calc(100% - 52px); gap: var(--ms-space-1); }
    :host([narrow]) ::slotted(.floor-switcher) { inline-size: 7rem; }
    :host([narrow]) .fit { min-inline-size: 44px; padding-inline: var(--ms-space-2); }
    :host([narrow]) .fit .ms-btn__label { display: none; }

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
    .navigation-help dd { margin: 0; color: var(--ms-text-quiet); }

    .zone-overlay { position: absolute; inset: 0; z-index: 4; pointer-events: none; overflow: hidden; }
    .zone-overlay svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .zone-overlay path { stroke: var(--ms-accent); stroke-width: 2; fill-opacity: .08; }
    .zone-overlay path.invalid { stroke: var(--error-color, #b3261e); }
    .zone-point { position: absolute; translate: -50% -50%; width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: var(--ms-accent); pointer-events: auto; touch-action: none; cursor: grab; font: 700 12px system-ui; isolation: isolate; }
    .zone-point::before { content: ""; position: absolute; inset: 10px; z-index: -1; border-radius: 50%; background: var(--ms-surface-card); border: 2px solid var(--ms-accent); box-shadow: 0 1px 4px #0008; }
    .zone-point[data-selected="true"] { color: var(--ms-on-accent); }
    .zone-point[data-selected="true"]::before { background: var(--ms-accent); border-color: var(--ms-surface-card); }
    .zone-point:focus-visible { outline: 3px solid var(--ms-accent); outline-offset: 0; }
    .zone-midpoint { font-size: 18px; }
    .zone-midpoint::before { inset: 13px; background: var(--ms-surface-card); }
    .zone-midpoint { color: var(--ms-accent); }
    .zone-help { position: absolute; inset: auto auto 88px 50%; translate: -50% 0; width: max-content; max-width: calc(100% - 24px); display: grid; justify-items: center; gap: 6px; font-size: 12px; pointer-events: none; }
    .zone-point-actions, .zone-guidance { display: flex; align-items: center; gap: 4px; max-width: 100%; padding: 4px; border-radius: 14px; pointer-events: auto; }
    .zone-selection { padding-inline: 8px; color: var(--ms-text-quiet); white-space: nowrap; font-weight: 650; }
    .zone-point-actions .ms-btn { white-space: nowrap; padding-inline: 10px; border-radius: 10px; font-size: 12px; }
    .zone-point-actions .ms-btn + .ms-btn { border-inline-start: 1px solid var(--ms-line); }
    .zone-guidance { padding: 6px 12px; gap: 8px; color: var(--ms-text-quiet); line-height: 1.4; }
    .zone-guidance .ms-btn { flex-shrink: 0; }
    .zone-feedback { max-width: 100%; padding: 8px 12px; border-radius: 12px; color: var(--error-color, #b3261e); pointer-events: auto; }
    .zone-feedback[hidden] { display: none; }
    .map-root[data-narrow="true"] .zone-help { bottom: 12px; }
    .keyboard-aim { display: none; position: absolute; z-index: 3; inset: 50% auto auto 50%; inline-size: 20px; block-size: 20px; translate: -50% -50%; border: 2px solid white; outline: 2px solid #111; border-radius: 50%; pointer-events: none; }
    .keyboard-aim::after { content: "+"; position: absolute; inset: 50% auto auto 50%; translate: -50% -50%; color: #111; font: bold 20px/1 sans-serif; text-shadow: 0 0 2px white; }
    .map-root:focus-visible .keyboard-aim { display: block; }
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
      color: var(--ms-text-quiet);
      font-size: 0.7rem;
      font-weight: 650;
    }

    .map-root[data-draw-tool="outline"] .map-scale { inset-block-end: auto; inset-block-start: 76px; }

    .scale-line {
      inline-size: var(--scale-width);
      block-size: 0.42rem;
      border-inline: 2px solid currentColor;
      border-block-end: 2px solid currentColor;
    }

    .map-message {
      inset: calc((100% - var(--map-sheet-offset, 0px)) / 2) auto auto 50%;
      translate: -50% -50%;
      inline-size: min(22rem, calc(100% - 2rem));
      padding: 1rem 1.1rem;
      text-align: center;
    }

    .map-message strong { display: block; margin-block-end: 0.35rem; }
    .map-message span { color: var(--ms-text-quiet); font-size: 0.82rem; }

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
  #helpLauncher: HTMLElement | null = null;
  #renderer: RendererController | null = null;
  #gestures: GestureController | null = null;
  #navigationHelp = false;
  #focusHelpOnUpdate = false;
  #themeObserver: MutationObserver | null = null;
  #themeQueries: MediaQueryList[] = [];
  #paletteFrame: number | null = null;
  #paletteTimer: number | null = null;
  readonly #cancelSecondaryPointer = {
    capture: true,
    handleEvent: (event: PointerEvent) => { if (event.pointerType === "touch" && !event.isPrimary) this.#outlineEditor.cancel(); },
  };
  readonly #outlineEditor = new OutlineEditor(() => this.state, () => this.#renderer,
    (intent) => this.#intent(intent), () => this.requestUpdate(), (key, fallback) => this.#t(key, fallback),
    (index) => { void this.updateComplete.then(() => {
      const target = this.renderRoot.querySelector<HTMLElement>(`[data-zone-index="${index}"]`) ?? this.renderRoot.querySelector<HTMLElement>(".map-root");
      target?.focus({ preventScroll: true });
    }); });

  constructor() {
    super();
    new RovingFocusController(this, {
      container: () => this.renderRoot?.querySelector<HTMLElement>(".camera-steps") ?? null,
      items: "button",
    });
    new RovingFocusController(this, {
      container: () => this.renderRoot?.querySelector<HTMLElement>(".draw-tools") ?? null,
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
      onViewport: () => { this.#outlineEditor.cancel(); this.requestUpdate(); },
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
      onOutlinePoint: (point) => this.#outlineEditor.addPoint(point),
      onCircles: (circles, record, previous, previousOutline) => this.#intent({
        type: "set-draft-circles",
        circles,
        record,
        ...(previous ? { previous, previousOutline: previousOutline ?? null } : {}),
        ...(!record && previous ? { outline: previousOutline ?? null } : {}),
      }),
      onRoom: (roomId) => this.#intent({ type: "toggle-room", roomId }),
    });
    this.#renderer.setState(this.state);
    this.#schedulePalette();
  }

  override disconnectedCallback(): void {
    this.#unwatchTheme();
    this.#outlineEditor.cancel();
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
    this.#renderer?.setState(this.state);
    if (this.state.draw.tool === "outline") this.requestUpdate();
  }

  // Canvas 2D cannot read CSS custom properties, so the renderer is handed a
  // palette probed from the design tokens. The read is deferred until after
  // the next paint: firstUpdated and Home Assistant theme mutations both leave
  // styles dirty, so reading computed style synchronously there forces a full
  // layout before the browser can paint. The renderer's matching fallback
  // palette covers that first frame.
  #applyPalette(): void {
    const root = this.renderRoot?.querySelector<HTMLElement>(".map-root");
    if (!root || !this.#renderer) return;
    this.#renderer.setPalette(readCanvasPalette(root));
  }

  #schedulePalette(): void {
    this.#cancelScheduledPalette();
    this.#paletteFrame = window.requestAnimationFrame(() => {
      this.#paletteFrame = null;
      this.#paletteTimer = window.setTimeout(() => {
        this.#paletteTimer = null;
        this.#applyPalette();
      }, 0);
    });
  }

  #cancelScheduledPalette(): void {
    if (this.#paletteFrame !== null) window.cancelAnimationFrame(this.#paletteFrame);
    if (this.#paletteTimer !== null) window.clearTimeout(this.#paletteTimer);
    this.#paletteFrame = null;
    this.#paletteTimer = null;
  }

  readonly #onThemeChange = (): void => { this.#schedulePalette(); };

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
    this.#cancelScheduledPalette();
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
    if (isNativeSelectControl(event)) return;
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
    if (this.state.dataMode === "history") {
      if (!this.state.map.available && this.state.resources.scene.status === "loading") {
        return { title: this.#t("v4_loading_saved_map", "Loading saved map"), detail: this.#t("v4_loading_saved_map_detail", "This read-only snapshot is still preparing.") };
      }
      if (!this.state.map.available) {
        return { title: this.#t("v4_saved_map_unavailable", "Saved map unavailable"), detail: this.#t("v4_saved_map_unavailable_detail", "Choose another snapshot or return to the live map.") };
      }
      return null;
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
    // noise there; the sheet owns the tools on a phone. Both leave only Fit
    // in the map rail because workspace visibility belongs to the app bar.
    const showView = showScene && !draw;
    const showAppearance = showView && !narrow && state.view === "top";
    const showCamera = showView && state.view === "three";
    const showTools = !locating;
    const showExtras = !narrow && !draw;

    return html`
      <div class="map-rail" data-map-control>
        <div class="map-context"><slot name="floor"></slot>
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

        </div>
        ${showAppearance ? html`
          <div class="appearance-switch ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#t("map_style_label", "Map style")}>
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
            >${this.#t("map_style_room_colours", "Floor plan")}</button>
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
          </div>
        ` : nothing}
        ${!locating && showExtras ? html`
          <div class="map-extras ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#t("v4_map_display", "Map display")}>
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
            <span>${this.#t("v4_rooms_selected", "Rooms selected: {count}").replace("{count}", String(count))}</span>
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
        aria-describedby=${showDraw ? (state.draw.tool === "outline" ? "zone-keyboard-help" : "keyboard-draw-help") : nothing}
        data-full-map=${String(state.fullMap)}
        data-workflow=${state.workflow}
        data-draw-tool=${state.draw.tool}
        data-narrow=${this.narrow ? "true" : nothing}
        @keydown=${this.#keyboard}
        @pointerdown=${this.#cancelSecondaryPointer}
      >
        ${this.#renderRail(showScene, locating)}
        <slot name="scrim"></slot>

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!showScene}
          role=${showDraw ? "group" : "img"}
          aria-label=${describeMap(state, this.localize)}
        >
          ${showDraw ? html`<span class="keyboard-aim" aria-hidden="true"></span>` : nothing}
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
          ${showDraw ? this.#outlineEditor.render() : nothing}
        </div>

        ${showDraw ? html`
          <p id="zone-keyboard-help" class="sr-only">${this.#t("v4_zone_keyboard_help", "Focus the map, aim with arrow keys, and press Enter to place points. Select the first point to close. Tab to a point; arrows move it, Delete removes it, and Escape cancels a drag.")}</p>
          <p id="keyboard-draw-help" class="sr-only">${this.#t("v4_keyboard_draw_help", "Keyboard: focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")}</p>
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
