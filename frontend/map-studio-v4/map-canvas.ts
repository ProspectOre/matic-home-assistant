import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";

import type { Localize, WorkspaceIntent, WorkspaceState } from "./contracts";
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
  };

  static override styles = css`
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
      block-size: 100%;
      color: var(--primary-text-color, #1f2933);
    }

    * { box-sizing: border-box; }

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
      container-type: inline-size;
    }

    .map-root:focus-visible {
      outline: 3px solid var(--primary-color, #03a9f4);
      outline-offset: -3px;
    }

    .map-tools,
    .view-switch,
    .appearance-switch,
    .camera-steps,
    .draw-tools,
    .map-scale,
    .map-message {
      position: absolute;
      z-index: 4;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      background: var(--card-background-color, rgb(255 255 255 / 96%));
      box-shadow: 0 5px 18px rgb(31 41 51 / 12%);
    }

    .map-tools {
      inset-block-start: 0.75rem;
      inset-inline-end: 0.75rem;
      display: flex;
      gap: 0.2rem;
      padding: 0.2rem;
      border-radius: 0.85rem;
    }

    .map-tools button,
    .view-switch button,
    .appearance-switch button,
    .camera-steps button,
    .draw-tools button {
      border: 0;
      color: inherit;
      background: transparent;
      cursor: pointer;
    }

    .map-tools button {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      padding-inline: 0.55rem;
      border-radius: 0.65rem;
      font-size: 0.78rem;
      font-weight: 650;
    }

    .map-tools button[aria-pressed="true"],
    .view-switch button[aria-pressed="true"],
    .appearance-switch button[aria-pressed="true"],
    .draw-tools button[aria-checked="true"] {
      color: var(--primary-color, #0678ce);
      background: color-mix(in srgb, var(--primary-color, #0678ce) 11%, transparent);
    }

    .view-switch {
      inset-block-start: 4.25rem;
      inset-inline-end: 0.75rem;
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 0.18rem;
      border-radius: 0.75rem;
    }

    .appearance-switch,
    .camera-steps {
      position: absolute;
      z-index: 4;
      inset-block-start: 7.2rem;
      inset-inline-end: 0.75rem;
      display: grid;
      padding: 0.18rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      border-radius: 0.75rem;
      background: var(--card-background-color, rgb(255 255 255 / 96%));
      box-shadow: 0 5px 18px rgb(31 41 51 / 12%);
    }

    .appearance-switch { grid-template-columns: 1fr 1fr; }
    .camera-steps { grid-template-columns: repeat(2, 2.75rem); }

    .appearance-switch button,
    .camera-steps button {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      border: 0;
      border-radius: 0.58rem;
      color: inherit;
      background: transparent;
      cursor: pointer;
      font-size: 0.76rem;
      font-weight: 700;
    }

    .view-switch button {
      min-inline-size: 2.75rem;
      min-block-size: 2.25rem;
      border-radius: 0.58rem;
      font-size: 0.76rem;
      font-weight: 700;
    }

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

    .scene-geometry {
      position: absolute;
      inset: 12% 8% 17%;
      transform: scale(var(--map-zoom));
      transform-origin: var(--map-origin-x) var(--map-origin-y);
      transition: transform 120ms ease-out;
    }

    .scene-geometry svg { inline-size: 100%; block-size: 100%; overflow: visible; }
    .room { stroke: var(--divider-color, #b5c1c8); stroke-width: 1.5; }
    .room:nth-child(1) { fill: #dceef2; }
    .room:nth-child(2) { fill: #e4eaf5; }
    .room:nth-child(3) { fill: #e9f0df; }
    .room:nth-child(4) { fill: #f3e5e5; }

    .area-stroke {
      fill: none;
      stroke: var(--primary-color, #0678ce);
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.82;
    }

    .room-labels {
      position: absolute;
      inset: 0;
      z-index: 2;
      pointer-events: none;
    }

    .room-label {
      position: absolute;
      translate: -50% -50%;
      padding: 0.25rem 0.45rem;
      border-radius: 0.4rem;
      color: var(--primary-text-color, #263238);
      background: color-mix(in srgb, var(--card-background-color, white) 90%, transparent);
      box-shadow: 0 2px 8px rgb(31 41 51 / 11%);
      font-size: 0.72rem;
      font-weight: 650;
      white-space: nowrap;
    }

    .room-label:nth-child(1) { inset-inline-start: 31%; inset-block-start: 36%; }
    .room-label:nth-child(2) { inset-inline-start: 69%; inset-block-start: 39%; }
    .room-label:nth-child(3) { inset-inline-start: 36%; inset-block-start: 68%; }
    .room-label:nth-child(4) { inset-inline-start: 68%; inset-block-start: 68%; }

    .robot {
      position: absolute;
      z-index: 3;
      inset-inline-start: 53%;
      inset-block-start: 52%;
      inline-size: 1.15rem;
      block-size: 1.15rem;
      translate: -50% -50%;
      border: 3px solid white;
      border-radius: 50%;
      background: var(--primary-color, #0678ce);
      box-shadow: 0 2px 9px rgb(6 120 206 / 35%);
    }

    .brush-cursor {
      position: absolute;
      z-index: 3;
      inset-inline-start: 52%;
      inset-block-start: 49%;
      inline-size: var(--brush-size);
      block-size: var(--brush-size);
      translate: -50% -50%;
      border: 2px solid var(--primary-color, #0678ce);
      border-radius: 50%;
      background: color-mix(in srgb, var(--primary-color, #0678ce) 15%, transparent);
      pointer-events: none;
    }

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

    .draw-tools {
      inset-inline-start: 50%;
      inset-block-end: calc(0.75rem + var(--map-sheet-offset, 0px));
      translate: -50% 0;
      display: grid;
      grid-template-columns: repeat(6, minmax(2.75rem, auto));
      gap: 0.15rem;
      max-inline-size: calc(100% - 1rem);
      padding: 0.2rem;
      border-radius: 0.9rem;
    }

    .draw-tools button {
      min-inline-size: 2.75rem;
      min-block-size: 2.75rem;
      padding-inline: 0.5rem;
      border-radius: 0.65rem;
      font-size: 0.73rem;
      font-weight: 650;
      white-space: nowrap;
    }

    .draw-tools button:disabled { opacity: 0.42; cursor: default; }

    .map-root[data-full-map="true"] .draw-tools { inset-block-end: 5.75rem; }
    .map-root[data-full-map="true"] .map-scale { inset-block-end: 10rem; }

    .map-message {
      inset: 50% auto auto 50%;
      translate: -50% -50%;
      inline-size: min(22rem, calc(100% - 2rem));
      padding: 1rem 1.1rem;
      border-radius: 0.9rem;
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

    @container (max-width: 29rem) {
      .map-tools .labels { display: none; }
      .map-tools button { padding-inline: 0.35rem; }
      .draw-tools { grid-template-columns: repeat(6, 2.75rem); }
      .draw-tools button { padding: 0; font-size: 0; }
      .draw-tools button::first-letter { font-size: 1rem; }
    }

    @media (prefers-reduced-motion: reduce) {
      .scene-geometry { transition: none; }
    }

    @media (forced-colors: active) {
      .room, .area-stroke, .brush-cursor, .robot { forced-color-adjust: none; }
      .room { fill: Canvas; stroke: CanvasText; }
      .area-stroke, .brush-cursor { stroke: Highlight; }
      .robot { background: Highlight; border-color: Canvas; }
    }
  `;

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;
  #fullMapLauncher: HTMLElement | null = null;
  #renderer: RendererController | null = null;
  #gestures: GestureController | null = null;

  #t(key: string, fallback: string, placeholders?: Record<string, string | number>): string {
    return translate(this.localize, key, fallback, placeholders);
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
    this.#renderer.setState(this.state);
  }

  override disconnectedCallback(): void {
    this.#gestures?.dispose();
    this.#gestures = null;
    this.#renderer?.dispose();
    this.#renderer = null;
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has("state")) return;
    const previous = changed.get("state") as WorkspaceState | undefined;
    if (previous?.fullMap && !this.state.fullMap && this.#fullMapLauncher) {
      this.#fullMapLauncher.focus();
    }
    this.#renderer?.setState(this.state);
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

  #orbit(horizontal: number, vertical: number): void {
    this.#renderer?.orbitBy(horizontal, vertical);
  }

  #keyboard(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
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
        role="application"
        aria-label=${describeMap(state, this.localize)}
        data-full-map=${String(state.fullMap)}
        data-workflow=${state.workflow}
        @keydown=${this.#keyboard}
      >
        ${!locating || state.fullMap ? html`<nav class="map-tools" aria-label="Map tools">
          ${!locating ? html`
            <button type="button" @click=${() => {
              this.#renderer?.fit();
              this.#intent({ type: "fit-map" });
            }}>${this.#t("map_home_view", "Fit")}</button>
            <button
              class="labels"
              type="button"
              aria-pressed=${String(state.labelsVisible)}
              @click=${() => this.#intent({ type: "toggle-labels" })}
            >${this.#t("map_labels", "Labels")}</button>
          ` : nothing}
          <button
            class="full-map"
            type="button"
            aria-label=${this.#t("v4_full_map", "Full map")}
            aria-pressed=${String(state.fullMap)}
            @click=${this.#toggleFullMap}
          >${state.fullMap ? this.#t("v4_close", "Close") : this.#t("v4_full_map", "Full map")}</button>
        </nav>` : nothing}

        ${state.workflow !== "draw" && showScene ? html`
          <div class="view-switch" aria-label="Map view">
            <button
              type="button"
              aria-pressed=${String(state.view === "three")}
              @click=${() => this.#intent({ type: "set-view", view: "three" })}
            >${this.#t("map_view_3d", "3D")}</button>
            <button
              type="button"
              aria-pressed=${String(state.view === "top")}
              @click=${() => this.#intent({ type: "set-view", view: "top" })}
            >${this.#t("map_view_top", "2D")}</button>
          </div>
        ` : nothing}

        ${state.view === "top" && showScene ? html`
          <div class="appearance-switch" aria-label=${this.#t("map_style_label", "2D map style")}>
            <button
              type="button"
              aria-pressed=${String(state.appearance === "photo")}
              @click=${() => this.#intent({ type: "set-appearance", appearance: "photo" })}
            >${this.#t("map_style_photo", "Photo")}</button>
            <button
              type="button"
              aria-pressed=${String(state.appearance === "rooms")}
              @click=${() => this.#intent({ type: "set-appearance", appearance: "rooms" })}
            >${this.#t("map_view_rooms", "Rooms")}</button>
          </div>
        ` : nothing}

        ${state.view === "three" && showScene ? html`
          <div class="camera-steps" role="toolbar" aria-label=${this.#t("map_camera_controls", "Map camera controls")}>
            <button type="button" aria-label=${this.#t("map_rotate_left", "Rotate left")} aria-keyshortcuts="[" @click=${() => this.#orbit(-52, 0)}>↶</button>
            <button type="button" aria-label=${this.#t("map_tilt_down", "Lower viewing angle")} aria-keyshortcuts="PageDown" @click=${() => this.#orbit(0, 30)}>⌄</button>
            <button type="button" aria-label=${this.#t("map_tilt_up", "Raise viewing angle")} aria-keyshortcuts="PageUp" @click=${() => this.#orbit(0, -30)}>⌃</button>
            <button type="button" aria-label=${this.#t("map_rotate_right", "Rotate right")} aria-keyshortcuts="]" @click=${() => this.#orbit(52, 0)}>↷</button>
          </div>
        ` : nothing}

        <div
          class="scene-window"
          data-renderer-key="persistent-canvas-v4"
          ?hidden=${!showScene}
          aria-hidden="true"
        >
          <canvas class="scene-canvas"></canvas>
          <canvas class="overlay-canvas"></canvas>
        </div>

        ${showDraw ? html`
          <div class="map-scale" aria-label=${`Scale ${scale.label}`}>
            <span class="scale-line" style=${`--scale-width:${scale.pixels}px`}></span>
            <span>${scale.label}</span>
          </div>
          <div class="draw-tools" role="toolbar" aria-label="Draw area tools">
            ${(["paint", "erase", "pan"] as const).map((tool) => html`
              <button
                type="button"
                role="radio"
                aria-checked=${String(state.draw.tool === tool)}
                data-tool=${tool}
                @click=${() => this.#intent({ type: "set-draw-tool", tool })}
              >${tool === "paint" ? `✎ ${this.#t("area_paint", "Paint")}` : tool === "erase" ? `⌫ ${this.#t("area_erase", "Erase")}` : `✥ ${this.#t("move_map", "Move map")}`}</button>
            `)}
            <button
              type="button"
              ?disabled=${state.draw.strokeCount === 0}
              @click=${() => this.#intent({ type: "undo-draft" })}
            >↶ ${this.#t("undo", "Undo")}</button>
            <button
              type="button"
              ?disabled=${state.draw.redo.length === 0}
              @click=${() => this.#intent({ type: "redo-draft" })}
            >↷ ${this.#t("redo", "Redo")}</button>
            <button type="button" @click=${() => this.#action("review-area")}>✓ ${this.#t("done_editing", "Done editing")}</button>
          </div>
        ` : nothing}

        ${message && !(state.fullMap && (locating || !state.host.administrator)) ? html`
          <div class="map-message" role="status">
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

if (!customElements.get("matic-map-canvas-v4")) {
  customElements.define("matic-map-canvas-v4", MaticMapCanvasV4);
}

declare global {
  interface HTMLElementTagNameMap {
    "matic-map-canvas-v4": MaticMapCanvasV4;
  }
}
