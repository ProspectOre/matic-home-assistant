import { LitElement, adoptStyles, css, html, nothing } from "lit";
import { controls } from "./controls";
import { renderDrawTools } from "./draw-tools";
import { icon, iconFit, iconHelp, iconOrbitLeft, iconOrbitRight, iconRoomNames, iconTiltDown, iconTiltUp } from "./icons";
import { RovingFocusController } from "./roving-focus";
import { readCanvasPalette, watchTheme } from "./theme-probe";
import { base, tokens } from "./tokens";
import type { PropertyValues, TemplateResult } from "lit";

import type { ColorScheme, DateFormat, Localize, NoticePlaceholders, WorkspaceIntent, WorkspaceState } from "./contracts";
import type { PoseModel } from "./backend-contracts";
import type { OutlineEditor } from "./outline-editor";
import { MAP_CANVAS_TAG } from "./element-tags";
import { GestureController, isNativeSelectControl } from "./gesture-controller";
import { RendererController, topView, type RendererDiagnostics } from "./renderer-controller";
import {
  canSelectRooms,
  canShowExactPose,
  canShowLiveMap,
  initialWorkspaceState,
  mapScale,
  savedMapPosition,
} from "./state";
import { translate } from "./localize";

export const WORKSPACE_INTENT_EVENT = "matic-workspace-intent";
export const WORKSPACE_ACTION_EVENT = "matic-workspace-action";
/** The "?" press, and Escape while help shows: the shell owns the popover. */
export const MAP_HELP_EVENT = "matic-map-help";

const NAVIGATION_HELP_ID = "navigation-help";

const describeMap = (state: WorkspaceState, localize?: Localize): string => {
  const t = (key: string, fallback: string, placeholders?: Record<string, string | number>): string =>
    translate(localize, key, fallback, placeholders);
  if (state.dataMode === "history" || state.floor.readOnly) {
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
    ? t("v4_robot_position_verified", "The robot's position is confirmed.")
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
    // Home Assistant's date language and time zone, for a notice's date.
    dates: { attribute: false },
    // Draw's point editor, loaded and built by the shell (shell.ts #outline).
    outlineEditor: { attribute: false },
    // Reflected so the stylesheet can anchor the rail with :host([narrow]).
    // On a phone the sheet owns the drawing tools, appearance switch and
    // room names; the map keeps view, fit and help.
    narrow: { type: Boolean, reflect: true },
    // The help popover (map-help.ts), rendered by the shell into the rail
    // so the "?" and its aria-controls share this root; null while closed.
    help: { attribute: false },
    // Draw's screen-reader recipes (map-help.ts drawRecipes), with the help
    // rows in the views chunk Draw loads anyway.
    recipes: { attribute: false },
    // The panel's light or dark scheme (shell.ts scheme); a change repaints
    // with the palette read for it.
    scheme: { attribute: false },
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

    /* An outline on .map-root repaints the whole page layer on every canvas
       frame; a positioned overlay keeps the ring out of the frame path. */
    .map-root:focus-visible::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 5;
      border: 3px solid var(--ms-resolved-indicator, var(--ms-accent));
      pointer-events: none;
    }

    /* Navigation has stable corners; only orbit controls follow the sheet. */
    .map-rail { --row: calc(44px + 2 * var(--ms-space-2)); position: absolute; inset: 0.75rem; inset-inline: max(0.75rem, var(--ms-safe-left)) max(0.75rem, var(--ms-safe-right)); z-index: 4; pointer-events: none; }
    .map-rail > * { pointer-events: auto; }
    slot[name="scrim"] { display: contents; pointer-events: none; }
    ::slotted(.sheet-scrim) { pointer-events: auto; }
    .map-context { position: absolute; inset-block-start: 0; inset-inline-start: 0; display: flex; gap: var(--ms-space-2); align-items: center; max-inline-size: calc(100% - 60px); }
    ::slotted(.floor-switcher) { min-inline-size: 0; inline-size: 9rem; min-block-size: 44px; background-color: var(--ms-surface-card); color: var(--ms-text); }
    .view-switch { flex: none; }
    .map-tools { position: absolute; inset-block-start: 0; inset-inline-end: 0; }
    .map-extras { position: absolute; inset-block-end: calc(var(--map-sheet-offset, 0px) + 52px); inset-inline-end: 0; display: flex; }
    .appearance-switch { position: absolute; inset-block-start: var(--row); inset-inline-start: 0; }
    .camera-steps { position: absolute; inset-block-end: var(--map-sheet-offset, 0px); inset-inline-end: 0; }
    .map-root:has(.selection-chip) .camera-steps { inset-block-end: calc(var(--map-sheet-offset, 0px) + 4rem); }
    .map-root:has(.selection-chip) .map-extras { inset-block-end: calc(var(--map-sheet-offset, 0px) + 4rem + 52px); }
    :host([narrow]) .map-context { max-inline-size: calc(100% - 52px); gap: var(--ms-space-1); }
    :host([narrow]) ::slotted(.floor-switcher) { inline-size: 7rem; }
    :host([narrow]) .fit { min-inline-size: 44px; padding-inline: var(--ms-space-2); }
    :host([narrow]) .fit .ms-btn__label { display: none; }
    /* Phone: the full detent leaves two rows, so "?" takes the bottom-left;
       its popover keeps the top-right slot under Fit, above the camera steps. */
    :host([narrow]) .map-extras { inset-inline-end: auto; inset-inline-start: 0; inset-block-end: var(--map-sheet-offset, 0px); }
    /* A compact full sheet leaves one visible rail row. Keep Help between the
       floor/view controls and Fit; the panel collapses while its popover is open. */
    :host([data-short]) .map-extras {
      inset-block: 0 auto;
      /* Fit is 44px wide with an 8px gap. */
      inset-inline: auto 52px;
    }
    :host([data-short]) .camera-steps { display: none; }

    .map-tools, .view-switch, .appearance-switch, .camera-steps { display: flex; }

    .map-dock, .map-scale, .map-message { position: absolute; z-index: 4; }
    /* The saved-map chip sits top centre under the rail's first row; the
       appearance switch steps down to make room (map-surfaces.md §4). */
    .map-chip { position: absolute; inset-block-start: var(--row); inset-inline: 0; margin-inline: auto; inline-size: fit-content; max-inline-size: 100%; padding: var(--ms-space-1) var(--ms-space-3); font-size: var(--ms-t-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
    .map-rail:has(.map-chip) .appearance-switch { inset-block-start: calc(2 * var(--row)); }
    .map-root:has(.map-chip) .scene-canvas { filter: saturate(0.35); }

    .map-dock {
      inset-inline: 0;
      inset-block-end: calc(0.75rem + var(--map-sheet-offset, 0px));
      margin-inline: auto;
      inline-size: fit-content;
      max-inline-size: calc(100% - 1rem);
    }
    .map-dock .draw-tools button { padding-inline: var(--ms-space-2); }
    @media (any-pointer: coarse) { .selection-chip .ms-btn--sm { min-inline-size: var(--ms-control); min-block-size: var(--ms-control); } }
    .selection-chip {
      display: flex;
      align-items: center;
      gap: var(--ms-space-3);
      padding: var(--ms-space-1) var(--ms-space-1) var(--ms-space-1) var(--ms-space-3);
      font-size: var(--ms-t-sm);
      font-weight: var(--ms-w-bold);
      white-space: nowrap;
    }


    .keyboard-aim { display: none; position: absolute; z-index: 3; inset: 50% auto auto 50%; inline-size: 20px; block-size: 20px; translate: -50% -50%; border: 2px solid #fff; outline: 2px solid #111; border-radius: 50%; pointer-events: none; }
    .keyboard-aim::after { content: "+"; position: absolute; inset: 50% auto auto 50%; translate: -50% -50%; color: #111; font: 700 20px/1 sans-serif; text-shadow: 0 0 2px white; }
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
      inset-inline-start: max(0.9rem, var(--ms-safe-left));
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
.map-tools button { padding-inline: 0; inline-size: var(--ms-control); }
}
/* Eight labelled tools need 49rem. Collapse the label to assistive text, never display:none. Hiding it would
   delete the accessible name and break every getByRole({ name }) query at
   narrow widths -- which is what the previous font-size:0 plus ::first-letter
   trick did, while also rendering the toolbar as "P E M U R D". */
@container (max-width: 49rem) {
.map-dock .draw-tools button { padding-inline: 0; inline-size: var(--ms-control); }
.map-dock .draw-tools .ms-btn__label { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
}
@media (forced-colors: active) {
/* The map is painted to canvas, so the UA would otherwise invert it. The
   previous block here targeted the mock-map layer that the renderer replaced,
   which meant the map had no forced-colors treatment at all. */
.scene-canvas, .overlay-canvas { forced-color-adjust: none; }
.map-root, .map-chip { border: 1px solid CanvasText; }
.map-root:focus-visible::after { border-color: Highlight; }
}
  `];

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;
  dates?: DateFormat;
  outlineEditor?: OutlineEditor;
  #zoneStyled = false;
  narrow = false;
  help: TemplateResult | typeof nothing | null = null;
  recipes: TemplateResult | null = null;
  scheme: ColorScheme = "";
  #renderer: RendererController | null = null;
  #gestures: GestureController | null = null;
  #unwatchTheme: (() => void) | null = null;
  #paletteFrame: number | null = null;
  #paletteTimer: number | null = null;
  readonly #cancelSecondaryPointer = {
    capture: true,
    handleEvent: (event: PointerEvent) => { if (event.pointerType === "touch" && !event.isPrimary) this.outlineEditor?.cancel(); },
  };

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

  #t(key: string, fallback: string, placeholders?: NoticePlaceholders): string {
    return translate(this.localize, key, fallback, placeholders, this.dates);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unwatchTheme ??= watchTheme(() => this.#schedulePalette());
    void this.updateComplete.then(() => this.#startControllers());
  }

  protected override firstUpdated(): void {
    this.#startControllers();
  }

  #startControllers(): void {
    if (!this.isConnected || this.#renderer || this.#gestures) return;
    const root = this.renderRoot.querySelector<HTMLElement>(".map-root");
    const scene = this.renderRoot.querySelector<HTMLCanvasElement>(".scene-canvas");
    const overlay = this.renderRoot.querySelector<HTMLCanvasElement>(".overlay-canvas");
    if (!root || !scene || !overlay) return;
    this.#renderer = new RendererController(scene, overlay, {
      onViewport: () => { this.outlineEditor?.cancel(); this.requestUpdate(); },
      onCamera: (camera, zoomPercent, origin) => {
        this.#intent({
          type: "set-camera",
          view: topView(this.state),
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
      onCameraPreferences: (cameras) => {
        for (const view of ["top", "three"] as const) {
          const camera = cameras[view];
          if (camera) this.#intent({ type: "set-camera", view, camera });
        }
      },
      onRoom: (roomId) => this.#intent({ type: "toggle-room", roomId }),
      onProblem: () => this.#action("renderer-problem"),
    });
    this.#gestures = new GestureController(root, this.#renderer, {
      state: () => this.state,
      onOutlinePoint: (point, coordinateEdit) => {
        this.outlineEditor?.addPoint(point, coordinateEdit);
      },
      onCircles: (circles, coordinateEdit) => this.#intent({
        type: "set-draft-circles",
        circles,
        coordinateEdit,
      }),
      onCirclePreview: (circles, coordinateEdit) => this.#renderer?.setCirclePreview(circles, coordinateEdit),
      onRoom: (roomId) => this.#intent({ type: "toggle-room", roomId }),
      onCameraGesture: () => this.#unfollow(),
    });
    this.#renderer.setState(this.state);
    this.#schedulePalette();
  }

  override disconnectedCallback(): void {
    this.#unwatchTheme?.();
    this.#unwatchTheme = null;
    this.#cancelScheduledPalette();
    this.outlineEditor?.cancel();
    this.#gestures?.dispose();
    this.#gestures = null;
    this.#renderer?.dispose();
    this.#renderer = null;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("outlineEditor")) this.outlineEditor?.attach(this, () => this.#renderer, (intent) => this.#intent(intent));
    // The editor's own rules (outline-editor.ts) arrive with it and are
    // adopted before its handles render, so startup does not carry them.
    if (this.outlineEditor && !this.#zoneStyled) {
      this.#zoneStyled = true;
      adoptStyles(this.renderRoot as ShadowRoot, [...MaticMapCanvasV4.styles, this.outlineEditor.styles]);
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("scheme") && changed.get("scheme") !== undefined) this.#schedulePalette();
    if (!changed.has("state")) return;
    this.#gestures?.observeState(this.state);
    this.outlineEditor?.observeState(this.state);
    this.#renderer?.setState(this.state);
    this.#follow();
  }

  #followed: PoseModel["position"] = null;

  // Recentre on each new pose while following, and once when it turns on.
  #follow(): void {
    const position = this.state.followRobot && canShowExactPose(this.state)
      ? this.state.resources.pose.value?.position : undefined;
    if (!position) {
      this.#followed = null;
      return;
    }
    if (position === this.#followed) return;
    this.#followed = position;
    this.#renderer?.centerOnMeters(position[0], position[1]);
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
    (event.currentTarget as HTMLElement).dispatchEvent(new CustomEvent(MAP_HELP_EVENT, { bubbles: true, composed: true }));
  }

  // Moving the map by hand, from a gesture or a map control, ends Follow the robot.
  #unfollow(): void {
    if (this.state.followRobot) this.#intent({ type: "set-follow-robot", value: false });
  }

  #orbit(horizontal: number, vertical: number): void {
    this.#unfollow();
    this.#renderer?.orbitBy(horizontal, vertical);
  }

  #keyboard(event: KeyboardEvent): void {
    if (isNativeSelectControl(event)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.help !== null) {
        this.#toggleHelp(event);
        return;
      }
      this.#intent({ type: "dismiss-top-layer" });
      return;
    }
  }

  rendererDiagnostics(): RendererDiagnostics | null {
    return this.#renderer?.diagnostics() ?? null;
  }

  zoomBy(factor: number): void {
    this.#unfollow();
    this.#renderer?.zoomAt(factor);
  }

  canvasIdentity(): { readonly scene: HTMLCanvasElement | null; readonly overlay: HTMLCanvasElement | null } {
    return {
      scene: this.renderRoot.querySelector<HTMLCanvasElement>(".scene-canvas"),
      overlay: this.renderRoot.querySelector<HTMLCanvasElement>(".overlay-canvas"),
    };
  }

  // The status strip and sheet explain recovery. Keep a retained scene
  // unobstructed; a centered message is for an absent map or a blocking problem.
  #message(showScene: boolean): string | null {
    const state = this.state;
    if (!state.host.connected && !showScene) return this.#t("v4_reconnecting", "Reconnecting");
    if (!state.host.administrator) return this.#t("v4_admin_required", "Administrator access required");
    if (state.host.robotCount === 0) return this.#t("v4_no_robot", "No robot available");
    if (showScene && state.activity !== "problem") return null;
    if (state.dataMode === "history") {
      return state.map.available ? null : state.resources.scene.status === "loading"
        ? this.#t("v4_loading_saved_map", "Loading saved map")
        : this.#t("v4_saved_map_unavailable", "Saved map unavailable");
    }
    if (!state.host.robotConnected) return this.#t("v4_robot_offline", "Robot offline");
    if (state.coherence === "verifying" || state.coherence === "booting") return this.#t("v4_locating_map", "Locating the current map");
    if (!state.map.available) return state.resources.scene.status === "loading"
      ? this.#t("v4_loading_verified_map", "Loading the current map")
      : this.#t("v4_map_unavailable", "Map unavailable");
    if (state.activity === "problem") return this.#t("v4_robot_attention", "Robot needs attention");
    return null;
  }

  #renderRail(showScene: boolean) {
    if (!showScene) return nothing;
    const state = this.state;
    const narrow = this.narrow;
    const draw = state.workflow === "draw";
    const saved = savedMapPosition(state);
    const helpTitle = this.#t("v4_how_to_move", "How to move the map");
    // Draw and the area review force the top view, so the view, appearance
    // and camera groups are noise there; the sheet owns the tools on a phone. Both leave Fit and
    // help in the map rail because workspace visibility belongs to the app
    // bar. Without a scene there is nothing to fit, switch or explain
    // (home-rooms.md §11 MS-HOME-04), so the rail keeps nothing. A phone's
    // Room names row is in Map options; its rail keeps the help "?".
    const showView = !draw && state.workflow !== "areaReview";
    const showAppearance = showView && !narrow && state.view === "top";
    const showCamera = showView && state.view === "three";
    const showLabels = !narrow && !draw;

    return html`
      <div class="map-rail" data-map-control>
        ${saved ? html`
          <div class="map-chip ms-surface ms-surface--floating">
            <span class="sr-only">${this.#t("v4_history_chip_label", "Saved map, read only, {date}, {position} of {count}", { date: { date: saved.date }, position: saved.position, count: saved.count })}</span>
            <span aria-hidden="true">${this.#t("v4_saved_map", "Saved map")}</span>
            <span aria-hidden="true"> · ${this.#t("v4_saved_map_position", "{date} · {position} of {count}", { date: { date: saved.date }, position: saved.position, count: saved.count })}</span>
          </div>
        ` : nothing}
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
            >${this.#t("v4_room_colours", "Room colors")}</button>
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

        <div class="map-tools ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#t("v4_map_tools", "Map tools")}>
              <button
                class="fit ms-btn"
                type="button"
                aria-label=${this.#t("v4_fit_map_hint", "Fit the whole map on screen")}
                @click=${() => {
                  this.#unfollow();
                  this.#renderer?.fit();
                  this.#intent({ type: "fit-map" });
                }}
                title=${this.#t("v4_fit_map", "Fit map")}
              >${icon(iconFit)}<span class="ms-btn__label">${this.#t("v4_fit_map", "Fit map")}</span></button>
          </div>
        <div class="map-extras ms-surface ms-surface--floating ms-segment" role="group" aria-label=${this.#t("v4_map_display", "Map display")}>
              ${showLabels ? html`
              <button
                class="labels ms-btn"
                type="button"
                aria-pressed=${String(state.labelsVisible)}
                @click=${() => this.#intent({ type: "toggle-labels" })}
                title=${this.#t("v4_room_names", "Room names")}
              >${icon(iconRoomNames)}<span class="ms-btn__label">${this.#t("v4_room_names", "Room names")}</span></button>
              ` : nothing}
              <button
                class="ms-btn ms-btn--icon"
                type="button"
                aria-label=${helpTitle}
                aria-expanded=${this.help !== null}
                aria-controls=${NAVIGATION_HELP_ID}
                @click=${this.#toggleHelp}
                title=${helpTitle}
              >${icon(iconHelp)}</button>
          </div>

        ${this.help ?? nothing}
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
            t: (key, fallback, placeholders) => this.#t(key, fallback, placeholders),
          }, "row")}
        </div>
      `;
    }
    // On a phone the sheet's grip line already reads "N rooms", so the map
    // chip would only duplicate it.
    const count = state.selection.roomIds.length;
    if (state.workflow === "rooms" && count > 0 && !this.narrow) {
      // Clear shares the rows' gate (home-rooms.md §5 Selection gate): while
      // the selection is held the chip keeps the count and the panel's Clear
      // says why (startup budget, Task 6 ruling).
      return html`
        <div class="map-dock ms-surface ms-surface--floating" data-map-control>
          <div class="selection-chip ms-surface ms-surface--floating" data-map-control>
            <span>${this.#t("v4_rooms_selected", "{count} selected", { count: new Intl.NumberFormat(state.locale).format(count) })}</span>
            ${canSelectRooms(state) ? html`<button class="ms-btn ms-btn--sm" type="button" @click=${() => this.#intent({ type: "clear-selection" })}>${this.#t("v4_clear", "Clear")}</button>` : nothing}
          </div>
        </div>
      `;
    }
    return nothing;
  }

  protected override render() {
    const state = this.state;
    const scale = mapScale(this.#renderer?.diagnostics().topPixelsPerMeter ?? 0);
    const showScene = state.map.available && (canShowLiveMap(state) || state.dataMode === "history");
    const message = this.#message(showScene);
    const showDraw = state.workflow === "draw" && showScene;
    return html`
      <section
        class="map-root"
        tabindex="0"
        aria-label=${this.#t("map_viewport_aria", "Interactive Matic 3D map")}
        aria-describedby=${showDraw ? (state.draw.tool === "outline" ? "zone-keyboard-help" : state.draw.tool === "pan" ? "keyboard-draw-pan-help" : "keyboard-draw-help") : nothing}
        data-full-map=${String(state.fullMap)}
        data-workflow=${state.workflow}
        data-draw-tool=${state.draw.tool}
        data-narrow=${this.narrow ? "true" : nothing}
        @keydown=${this.#keyboard}
        @pointerdown=${this.#cancelSecondaryPointer}
      >
        ${this.#renderRail(showScene)}
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
          ${showDraw ? this.outlineEditor?.render() ?? nothing : nothing}
        </div>

        ${showDraw ? html`
          ${this.recipes ?? nothing}
          ${scale ? html`<div class="map-scale" role="img" aria-label=${this.#t("v4_map_scale", "Scale {distance}", { distance: scale.label })}>
            <span class="scale-line" style=${`--scale-width:${scale.pixels}px`}></span>
            <span>${scale.label}</span>
          </div>` : nothing}
        ` : nothing}

        ${this.#renderDock(showScene)}

        ${message ? html`
          <div class="map-message ms-surface ms-surface--floating"><strong>${message}</strong></div>
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
