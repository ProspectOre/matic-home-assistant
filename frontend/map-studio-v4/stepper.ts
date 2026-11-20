import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { icon, iconMinus, iconPlus } from "./icons";
import type { Translate } from "./plan-copy";

const INTERVAL_MIN = 1;
export const MOP_INTERVAL_MIN = 2;
const INTERVAL_MAX = 100;

/** What a committed field becomes: bad input keeps the value, empty is Off, numbers snap into the allowed interval. */
export const snapInterval = (raw: string, badInput: boolean, current: number | null, minimum = INTERVAL_MIN): number | null => {
  if (badInput) return current;
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? Math.min(INTERVAL_MAX, Math.max(minimum, Math.round(value))) : current;
};

/** Below the minimum is Off; a legacy value increases to the new minimum. */
export const stepInterval = (current: number | null, delta: -1 | 1, minimum = INTERVAL_MIN): number | null =>
  current === null
    ? delta > 0 ? minimum : null
    : current + delta < minimum ? delta > 0 ? minimum : null : Math.min(INTERVAL_MAX, current + delta);

/**
 * `ms-stepper` (design-system.md §4): [− 44×44][number field][+ 44×44] in one
 * bordered box. Only room schedules use it, so it loads with the plan views
 * rather than with the shell's controls.
 */
export const stepperStyles = css`
.ms-stepper { --ms-local: var(--ms-surface-card); display: inline-grid; flex: none; grid-template-columns: var(--ms-control) minmax(3rem, 4.5rem) var(--ms-control); gap: var(--ms-space-1); align-items: center; border: 1px solid var(--ms-line-strong); border-radius: var(--ms-radius-sm); background: var(--ms-local); }
.ms-stepper--readonly { grid-template-columns: minmax(3rem, 4.5rem); }
.ms-stepper .ms-btn { border-radius: calc(var(--ms-radius-sm) - 1px); }
.ms-stepper input { inline-size: 100%; min-inline-size: 0; min-block-size: var(--ms-control); margin: 0; padding: 0; border: 0; border-radius: var(--ms-radius-xs); color: var(--ms-text); background: transparent; font: inherit; font-size: var(--ms-t-md); font-weight: var(--ms-w-medium); font-variant-numeric: tabular-nums; text-align: center; appearance: textfield; -moz-appearance: textfield; }
/* Only − and + step the value: the browser's own spin buttons are hidden. */
.ms-stepper input::-webkit-inner-spin-button, .ms-stepper input::-webkit-outer-spin-button { margin: 0; appearance: none; -webkit-appearance: none; }
.ms-stepper input::placeholder { color: var(--ms-text-quiet); font-weight: var(--ms-w-medium); opacity: 1; }
.ms-stepper input:focus-visible { outline: 2px solid var(--ms-resolved-indicator, var(--ms-accent)); outline-offset: -2px; }
.ms-stepper input[readonly] { color: var(--ms-text-quiet); }
@media (forced-colors: active) { .ms-stepper { border: 1px solid CanvasText; } }
`;

interface StepperOptions {
  /** The field's id; − and + control it. */
  readonly id: string;
  /** The visible label line's id, which names the field. */
  readonly labelId: string;
  /** The label line's text, for "Decrease {label}" and "Increase {label}". */
  readonly label: string;
  readonly value: number | null;
  readonly minimum?: number;
  /** The status or reason line, and the hold's reason while one applies. */
  readonly describedBy: string | null;
  /** Why − and + can't act now (a hold or a mode conflict); null while they can. */
  readonly heldBy: string | null;
  /** A joined schedule: the field is read-only and − and + are gone. */
  readonly readonly: boolean;
  readonly t: Translate;
  readonly commit: (value: number | null) => void;
}

/** One schedule's stepper (room-schedule.md §5 Stepper). */
export const stepper = (o: StepperOptions): TemplateResult => {
  const { id, t, value } = o;
  const held = o.heldBy !== null;
  const minimum = o.minimum ?? INTERVAL_MIN;
  const field = html`<input
    id=${id}
    type="number"
    inputmode="numeric"
    min=${minimum}
    max=${INTERVAL_MAX}
    step="1"
    placeholder=${t("v4_cadence_off", "Off")}
    aria-labelledby=${o.labelId}
    aria-describedby=${o.describedBy ?? nothing}
    aria-disabled=${held && !o.readonly ? "true" : nothing}
    ?readonly=${o.readonly || held}
    .value=${value === null ? "" : String(value)}
    @change=${(event: Event) => {
      const input = event.currentTarget as HTMLInputElement;
      const next = o.readonly || held ? value : snapInterval(input.value, input.validity.badInput, value, minimum);
      input.value = next === null ? "" : String(next);
      if (next !== value) o.commit(next);
    }}
  >`;
  if (o.readonly) return html`<span class="ms-stepper ms-stepper--readonly">${field}</span>`;
  const end = (delta: -1 | 1) => {
    const atEnd = delta < 0 ? value === null : value === INTERVAL_MAX;
    const reason = atEnd
      ? delta < 0
        ? t("v4_cadence_stepper_off_reason", "This schedule is already off.")
        : t("v4_cadence_stepper_max_reason", "Every 100 cleans is the longest schedule.")
      : null;
    const endId = `${id}-${delta < 0 ? "min" : "max"}`;
    const name = delta < 0
      ? t("v4_stepper_decrease", "Decrease {label}", { label: o.label })
      : t("v4_stepper_increase", "Increase {label}", { label: o.label });
    return html`<button
      class="ms-btn ms-btn--icon"
      type="button"
      aria-label=${name}
      aria-controls=${id}
      aria-disabled=${reason || held ? "true" : nothing}
      aria-describedby=${[reason ? endId : null, o.heldBy].filter(Boolean).join(" ") || nothing}
      title=${reason ?? nothing}
      @click=${() => { if (!reason && !held) o.commit(stepInterval(value, delta, minimum)); }}
    >${icon(delta < 0 ? iconMinus : iconPlus)}${reason ? html`<span class="sr-only" id=${endId}>${reason}</span>` : nothing}</button>`;
  };
  return html`<span class="ms-stepper">${end(-1)}${field}${end(1)}</span>`;
};
