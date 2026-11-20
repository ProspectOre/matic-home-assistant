import { LitElement, css, html, nothing } from "lit";
import { controls } from "./controls";
import { formControls } from "./form-controls";
import { base, tokens } from "./tokens";

import {
  DRAW_BRUSH_MAX_METERS,
  DRAW_BRUSH_MIN_METERS,
  type Localize,
  type WorkspaceIntent,
  type WorkspaceState,
} from "./contracts";
import { icon, iconMinus, iconPlus } from "./icons";
import { WORKSPACE_INTENT_EVENT } from "./map-canvas";
import { PRECISION_CONTROLS_TAG } from "./element-tags";
import { initialWorkspaceState } from "./state";
import { translate } from "./localize";
import { stepperStyles } from "./stepper";

const MIN_CM = Math.round(DRAW_BRUSH_MIN_METERS * 100);
const MAX_CM = Math.round(DRAW_BRUSH_MAX_METERS * 100);
const STEP_CM = 5;

/** The brush in whole centimetres, clamped to the range. */
const brushCentimeters = (meters: number): number => Math.min(MAX_CM, Math.max(MIN_CM, Math.round(meters * 100)));

/** − and + move to the next 5 cm multiple, so a brush off the grid lands on it. */
const stepBrush = (cm: number, delta: -1 | 1): number =>
  delta > 0 ? Math.min(MAX_CM, Math.floor(cm / STEP_CM) * STEP_CM + STEP_CM) : Math.max(MIN_CM, Math.ceil(cm / STEP_CM) * STEP_CM - STEP_CM);

// Brush settings only, docked beside the Draw content: the stepper in centimetres and a range for a quick sweep. Zoom
// is served by pinch, the map's Fit button and the +/-/0 keys. Intents still
// carry metres, as the outline does.
class MaticPrecisionControlsV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
  };

  static override styles = [tokens, base, controls, formControls, stepperStyles, css`
:host { display: block; color: var(--ms-text); }
.controls { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-3); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); }
.row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--ms-space-2); }
.row > label { font-size: var(--ms-t-sm); font-weight: var(--ms-w-medium); }
.hint { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.sr-only { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; clip-path: inset(50%); white-space: nowrap; }
`];

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;

  #t(key: string, fallback: string, placeholders?: Readonly<Record<string, string | number>>): string {
    return translate(this.localize, key, fallback, placeholders);
  }

  #intent(intent: WorkspaceIntent): void {
    this.dispatchEvent(new CustomEvent<WorkspaceIntent>(WORKSPACE_INTENT_EVENT, {
      detail: intent,
      bubbles: true,
      composed: true,
    }));
  }

  #commit(cm: number): void {
    this.#intent({ type: "set-brush", value: cm / 100 });
  }

  // On blur and Enter a number snaps into 20 to 250; anything else keeps the value.
  #field(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const current = brushCentimeters(this.state.draw.brushMeters);
    const value = Number(input.value.trim());
    const next = input.validity.badInput || input.value.trim() === "" || !Number.isFinite(value) ? current : brushCentimeters(value / 100);
    input.value = String(next);
    if (next !== current) this.#commit(next);
  }

  #range(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value)) this.#commit(brushCentimeters(value / 100));
  }

  protected override render() {
    const cm = brushCentimeters(this.state.draw.brushMeters);
    const size = (value: number) => new Intl.NumberFormat(this.state.locale, { style: "unit", unit: "centimeter", unitDisplay: "short" }).format(value);
    const label = this.#t("brush_size", "Brush width");
    const end = (delta: -1 | 1) => {
      const reason = delta < 0
        ? cm <= MIN_CM ? this.#t("v4_brush_min_reason", "Can't make the brush narrower than {size}.", { size: size(MIN_CM) }) : null
        : cm >= MAX_CM ? this.#t("v4_brush_max_reason", "Can't make the brush wider than {size}.", { size: size(MAX_CM) }) : null;
      const endId = delta < 0 ? "brush-min" : "brush-max";
      return html`<button
        class="ms-btn ms-btn--icon"
        type="button"
        aria-label=${delta < 0 ? this.#t("v4_stepper_decrease", "Decrease {label}", { label }) : this.#t("v4_stepper_increase", "Increase {label}", { label })}
        aria-controls="brush"
        aria-disabled=${reason ? "true" : nothing}
        aria-describedby=${reason ? endId : nothing}
        title=${reason ?? nothing}
        @click=${() => { if (!reason) this.#commit(stepBrush(cm, delta)); }}
      >${icon(delta < 0 ? iconMinus : iconPlus)}${reason ? html`<span class="sr-only" id=${endId}>${reason}</span>` : nothing}</button>`;
    };
    return html`
      <div class="controls" role="group" aria-label=${this.#t("v4_drawing_precision", "Drawing precision")}>
        <div class="row">
          <label for="brush">${label}</label>
          <span class="ms-stepper">
            ${end(-1)}
            <input
              id="brush"
              type="number"
              inputmode="numeric"
              min=${MIN_CM}
              max=${MAX_CM}
              step="1"
              .value=${String(cm)}
              @change=${this.#field}
              aria-label=${this.#t("v4_brush_width_cm", "Brush width in centimeters")}
            />
            ${end(1)}
          </span>
        </div>
        <input
          class="ms-range"
          type="range"
          min=${MIN_CM}
          max=${MAX_CM}
          step="1"
          .value=${String(cm)}
          @input=${this.#range}
          aria-label=${this.#t("v4_brush_width_slider", "Brush width slider")}
          aria-valuetext=${size(cm)}
        />
        <p class="hint">${this.#t("v4_precision_hint", "Strokes follow the map's resolution. Zooming changes the view, not the area.")}</p>
      </div>
    `;
  }
}

if (!customElements.get(PRECISION_CONTROLS_TAG)) {
  customElements.define(PRECISION_CONTROLS_TAG, MaticPrecisionControlsV4);
}
