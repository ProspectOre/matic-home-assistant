import { html, type ReactiveControllerHost } from "lit";
import { live } from "lit/directives/live.js";
import { MAP_ZOOM_MAX, MAP_ZOOM_MIN } from "./contracts";
import type { MaticMapCanvasV4 } from "./map-canvas";
import type { MenuController } from "./menu-controller";
import { canShowLiveMap } from "./state";

type Host = ReactiveControllerHost & HTMLElement & { readonly renderRoot: ParentNode };
type Translate = (key: string, fallback: string) => string;

/** Loaded with Map options; camera-only controls never dispatch robot commands. */
export class MapZoom {
  open = false;
  #value = "100";
  #editing = false;

  constructor(private readonly host: Host, private readonly menu: MenuController) {}

  #canvas(): MaticMapCanvasV4 | null {
    return this.host.renderRoot.querySelector<MaticMapCanvasV4>(".map-canvas");
  }

  available(): boolean {
    const canvas = this.#canvas();
    return !!canvas && canvas.state.map.available
      && (canShowLiveMap(canvas.state) || canvas.state.dataMode === "history")
      && canvas.rendererDiagnostics()?.sceneRevision != null;
  }

  #percent(): number {
    const diagnostics = this.#canvas()?.rendererDiagnostics();
    return diagnostics ? Math.round(diagnostics.fitDistance / diagnostics.cameraDistance * 100) : 100;
  }

  show(): void {
    if (!this.available()) return;
    this.open = true;
    this.#editing = false;
    this.host.requestUpdate();
    void this.host.updateComplete.then(() => this.host.renderRoot.querySelector<HTMLInputElement>("#map-zoom-value")?.focus());
  }

  #apply(value: number): void {
    if (!this.available() || !Number.isInteger(value) || value < MAP_ZOOM_MIN || value > MAP_ZOOM_MAX) return;
    const canvas = this.#canvas();
    const camera = canvas?.rendererDiagnostics();
    if (!camera || !canvas) return;
    canvas.zoomBy(value * camera.cameraDistance / (100 * camera.fitDistance));
    this.#editing = false;
    this.host.requestUpdate();
  }

  render(t: Translate) {
    const percent = this.#percent();
    if (!this.#editing) this.#value = percent >= MAP_ZOOM_MIN && percent <= MAP_ZOOM_MAX ? String(percent) : "";
    return html`
      <style>
        .map-zoom { display: grid; gap: var(--ms-space-3); padding: var(--ms-space-3); inline-size: min(20rem, calc(100vw - 2rem)); min-inline-size: 0; box-sizing: border-box; }
        .map-zoom p { margin: 0; white-space: normal; }
        .map-zoom .zoom-values, .map-zoom .zoom-actions { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
        .map-zoom input { box-sizing: border-box; min-block-size: 44px; }
        .map-zoom button { min-block-size: 44px; }
      </style>
      <form id="map-options" class="map-zoom ms-field overflow-menu ms-surface ms-surface--overlay" role="dialog" aria-label=${t("v4_map_zoom", "Map zoom")}
        @submit=${(event: SubmitEvent) => { event.preventDefault(); this.#apply(Number(this.#value)); }}>
        <p>${t("v4_map_zoom_current", "Current zoom")}: <output aria-label=${t("v4_map_zoom_current", "Current zoom")}>${percent}%</output></p>
        <label for="map-zoom-value">${t("v4_map_zoom_percent", "Map zoom percent")}</label>
        <input id="map-zoom-value" type="number" inputmode="numeric" min=${MAP_ZOOM_MIN} max=${MAP_ZOOM_MAX} step="1" required
          aria-describedby="map-zoom-help" .value=${live(this.#value)} ?disabled=${!this.available()}
          @input=${(event: Event) => { this.#editing = true; this.#value = (event.target as HTMLInputElement).value; }}>
        <p id="map-zoom-help">${t("v4_map_zoom_help", "Zoom is relative to Fit. Enter 100–1000%; larger values zoom closer without moving the map's center.")}</p>
        <div class="zoom-values" role="group" aria-label=${t("v4_map_zoom_presets", "Zoom presets")}>
          ${[100, 400, 1000].map((value) => html`<button class="ms-btn" type="button" ?disabled=${!this.available()} @click=${() => this.#apply(value)}>${value}%</button>`)}
        </div>
        <div class="zoom-actions">
          <button class="ms-btn ms-btn--primary" type="submit" ?disabled=${!this.available()}>${t("v4_map_zoom_apply", "Set zoom")}</button>
          <button class="ms-btn" type="button" @click=${() => this.menu.close(true)}>${t("v4_close", "Close")}</button>
        </div>
      </form>
    `;
  }
}
