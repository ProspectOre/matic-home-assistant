import { LitElement, css, html } from "lit";
import { controls } from "./controls";
import { base, tokens } from "./tokens";

import {
  DRAW_BRUSH_MAX_METERS,
  DRAW_BRUSH_MIN_METERS,
  type Localize,
  type WorkspaceIntent,
  type WorkspaceState,
} from "./contracts";
import { WORKSPACE_INTENT_EVENT } from "./map-canvas";
import { PRECISION_CONTROLS_TAG } from "./element-tags";
import { initialWorkspaceState } from "./state";
import { translate } from "./localize";

// Brush settings only. Zoom is served by pinch, the map's Fit button and the
// +/-/0 keys, so the stepper it used to carry here was a third zoom control
// that also lied about what the saved outline depends on.
export class MaticPrecisionControlsV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    compact: { type: Boolean, reflect: true },
    inline: { type: Boolean, reflect: true },
  };

  static override styles = [tokens, base, controls, css`
:host { display: block; color: var(--ms-text); }
.controls { display: grid; gap: var(--ms-space-3); padding: var(--ms-space-3); }
.stepper { display: grid; grid-template-columns: var(--ms-control) minmax(0, 1fr) var(--ms-control); gap: var(--ms-space-1); align-items: stretch; }
.number { --ms-local: var(--ms-surface-card); display: flex; align-items: center; min-inline-size: 0; min-block-size: var(--ms-control); padding-inline: var(--ms-space-2); border: 1px solid var(--ms-line-strong); border-radius: var(--ms-radius-sm); background: var(--ms-local); }
.number:focus-within { outline: 2px solid var(--ms-accent); outline-offset: 1px; border-color: var(--ms-accent); }
.number input { min-inline-size: 0; inline-size: 100%; border: 0; outline: 0; color: inherit; background: transparent; text-align: end; font-size: var(--ms-t-sm); font-variant-numeric: tabular-nums; }
.unit { margin-inline-start: var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
.slider { display: block; inline-size: 100%; min-block-size: var(--ms-control); margin: 0; accent-color: var(--ms-accent); }
.slider:focus-visible { outline: 2px solid var(--ms-accent); outline-offset: 2px; }
.hint { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
:host([compact]:not([inline])) .controls {
position: absolute;
z-index: 8;
inset-block-end: calc(100% + var(--ms-space-1));
inset-inline-end: 0;
inline-size: min(18rem, calc(100vw - 1.5rem));
}
:host([compact][inline]) { margin-block-start: var(--ms-space-2); }
`];

  state: WorkspaceState = initialWorkspaceState();
  compact = false;
  inline = false;
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

  #brush(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(value)) return;
    this.#intent({ type: "set-brush", value });
  }

  protected override render() {
    const { draw } = this.state;
    return html`
      <div class="controls ms-surface ms-surface--overlay" aria-label=${this.#t("v4_drawing_precision", "Drawing precision")}>
        <div class="row ms-field">
          <label for="brush">${this.#t("brush_size", "Brush width")}</label>
          <div class="stepper">
            <button
              class="ms-btn ms-btn--secondary ms-btn--icon"
              type="button"
              aria-label=${this.#t("v4_narrower_brush", "Narrower brush")}
              @click=${() => this.#intent({
                type: "set-brush",
                value: draw.brushMeters / 1.25,
              })}
            >&minus;</button>
            <span class="number">
              <input
                id="brush"
                inputmode="decimal"
                type="number"
                min=${DRAW_BRUSH_MIN_METERS}
                max=${DRAW_BRUSH_MAX_METERS}
                step="0.01"
                .value=${draw.brushMeters.toFixed(2)}
                @change=${this.#brush}
                aria-label=${this.#t("v4_brush_width_meters", "Brush width in meters")}
              />
              <span class="unit">m</span>
            </span>
            <button
              class="ms-btn ms-btn--secondary ms-btn--icon"
              type="button"
              aria-label=${this.#t("v4_wider_brush", "Wider brush")}
              @click=${() => this.#intent({
                type: "set-brush",
                value: draw.brushMeters * 1.25,
              })}
            >+</button>
          </div>
          <input
            class="slider"
            type="range"
            min=${DRAW_BRUSH_MIN_METERS}
            max=${DRAW_BRUSH_MAX_METERS}
            step="0.01"
            .value=${draw.brushMeters.toFixed(2)}
            @input=${this.#brush}
            aria-label=${this.#t("v4_brush_width_slider", "Brush width slider")}
            aria-valuetext=${`${draw.brushMeters.toFixed(2)} m`}
          />
        </div>
        <p class="hint">${this.#t("v4_precision_hint", "Strokes follow the verified map resolution. Zoom changes the view, not the saved outline.")}</p>
      </div>
    `;
  }
}

if (!customElements.get(PRECISION_CONTROLS_TAG)) {
  customElements.define(PRECISION_CONTROLS_TAG, MaticPrecisionControlsV4);
}
