import { LitElement, css, html } from "lit";

import {
  DRAW_BRUSH_MAX_METERS,
  DRAW_BRUSH_MIN_METERS,
  MAP_ZOOM_MAX,
  MAP_ZOOM_MIN,
  type Localize,
  type WorkspaceIntent,
  type WorkspaceState,
} from "./contracts";
import { WORKSPACE_INTENT_EVENT } from "./map-canvas";
import { PRECISION_CONTROLS_TAG } from "./element-tags";
import { initialWorkspaceState } from "./state";
import { translate } from "./localize";

export class MaticPrecisionControlsV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    compact: { type: Boolean, reflect: true },
  };

  static override styles = css`
    :host { display: block; color: var(--primary-text-color, #1f2933); }
    * { box-sizing: border-box; }
    button, input { font: inherit; }

    .controls {
      display: grid;
      gap: 0.8rem;
      padding: 0.9rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 16%));
      border-radius: 0.85rem;
      background: var(--card-background-color, #fff);
    }

    .row { display: grid; gap: 0.42rem; }
    label { color: var(--secondary-text-color, #687984); font-size: 0.75rem; font-weight: 650; }

    .stepper {
      display: grid;
      grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem;
      gap: 0.35rem;
      align-items: stretch;
    }

    button, .number {
      min-block-size: 2.75rem;
      border: 1px solid var(--divider-color, rgb(60 75 85 / 20%));
      border-radius: 0.65rem;
      color: inherit;
      background: var(--secondary-background-color, #f3f6f7);
    }

    button { cursor: pointer; font-weight: 700; }
    button:hover { background: color-mix(in srgb, var(--primary-color, #0678ce) 9%, transparent); }

    .number {
      display: flex;
      align-items: center;
      min-inline-size: 0;
      padding-inline: 0.6rem;
      background: var(--card-background-color, #fff);
    }

    input {
      min-inline-size: 0;
      inline-size: 100%;
      border: 0;
      outline: 0;
      color: inherit;
      background: transparent;
      text-align: end;
      font-variant-numeric: tabular-nums;
    }

    .unit { margin-inline-start: 0.25rem; color: var(--secondary-text-color, #687984); font-size: 0.75rem; }
    .hint { margin: 0; color: var(--secondary-text-color, #687984); font-size: 0.72rem; line-height: 1.45; }

    :host([compact]) .controls {
      position: absolute;
      z-index: 8;
      inset-block-start: calc(100% + 0.4rem);
      inset-inline-end: 0;
      inline-size: min(18rem, calc(100vw - 1.5rem));
      box-shadow: 0 12px 32px rgb(31 41 51 / 20%);
    }

    @media (forced-colors: active) {
      button, .number, .controls { border-color: CanvasText; }
    }
  `;

  state: WorkspaceState = initialWorkspaceState();
  compact = false;
  localize?: Localize;

  #t(key: string, fallback: string): string {
    return translate(this.localize, key, fallback);
  }

  #intent(intent: WorkspaceIntent): void {
    this.dispatchEvent(new CustomEvent<WorkspaceIntent>(WORKSPACE_INTENT_EVENT, {
      detail: intent,
      bubbles: true,
      composed: true,
    }));
  }

  #numeric(event: Event, type: "zoom" | "brush"): void {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(value)) return;
    this.#intent(type === "zoom"
      ? { type: "set-zoom", value }
      : { type: "set-brush", value });
  }

  protected override render() {
    const { draw } = this.state;
    return html`
      <div class="controls" aria-label=${this.#t("v4_drawing_precision", "Drawing precision")}>
        <div class="row">
          <label for="zoom">${this.#t("v4_map_zoom", "Map zoom")}</label>
          <div class="stepper">
            <button
              type="button"
              aria-label=${this.#t("zoom_out", "Zoom out")}
              @click=${() => this.#intent({ type: "step-zoom", factor: 0.8 })}
            >−</button>
            <span class="number">
              <input
                id="zoom"
                inputmode="numeric"
                type="number"
                min=${MAP_ZOOM_MIN}
                max=${MAP_ZOOM_MAX}
                step="1"
                .value=${String(draw.zoomPercent)}
                @change=${(event: Event) => this.#numeric(event, "zoom")}
                aria-label=${this.#t("v4_map_zoom_percent", "Map zoom percent")}
              />
              <span class="unit">%</span>
            </span>
            <button
              type="button"
              aria-label=${this.#t("zoom_in", "Zoom in")}
              @click=${() => this.#intent({ type: "step-zoom", factor: 1.25 })}
            >+</button>
          </div>
        </div>

        <div class="row">
          <label for="brush">${this.#t("brush_size", "Brush width")}</label>
          <div class="stepper">
            <button
              type="button"
              aria-label=${this.#t("v4_narrower_brush", "Narrower brush")}
              @click=${() => this.#intent({
                type: "set-brush",
                value: draw.brushMeters / 1.25,
              })}
            >−</button>
            <span class="number">
              <input
                id="brush"
                inputmode="decimal"
                type="number"
                min=${DRAW_BRUSH_MIN_METERS}
                max=${DRAW_BRUSH_MAX_METERS}
                step="0.01"
                .value=${draw.brushMeters.toFixed(2)}
                @change=${(event: Event) => this.#numeric(event, "brush")}
                aria-label=${this.#t("v4_brush_width_meters", "Brush width in meters")}
              />
              <span class="unit">m</span>
            </span>
            <button
              type="button"
              aria-label=${this.#t("v4_wider_brush", "Wider brush")}
              @click=${() => this.#intent({
                type: "set-brush",
                value: draw.brushMeters * 1.25,
              })}
            >+</button>
          </div>
        </div>
        <p class="hint">${this.#t("v4_precision_hint", "Strokes follow the verified map resolution. Zoom changes the view, not the saved outline.")}</p>
      </div>
    `;
  }
}

if (!customElements.get(PRECISION_CONTROLS_TAG)) {
  customElements.define(PRECISION_CONTROLS_TAG, MaticPrecisionControlsV4);
}
