import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import { iconChevronRight, iconOverflow, iconPlus } from "../icons";
import { roomSetting, t } from "./copy";
import { DEFAULT_VARIANTS, chip, dueBlock, glyph, screenStyles, toneGlyph, type StageFrame, type Tone, type Variants } from "./frame";
import { glyphClose, glyphMinus, glyphRobot } from "./glyphs";
import { themeStyle, type ThemeName } from "./themes";

// design-system.md §4–§5 as one sheet: every control at rest, hover, focus
// and disabled-with-reason; the tints and tone pairs in HA's light and dark
// palettes side by side; the type scale; and a live 44 px target count.
// Hover and focus are forced with data-force, whose rules below mirror the
// :hover and :focus-visible rules of controls.ts plus preview-styles.ts.

const forcedCss = css`
@media (hover: hover) { .force-note { display: none; } }
.ms-btn[data-force="hover"] { background: color-mix(in srgb, var(--ms-text) 7%, var(--ms-local)); }
.ms-btn--primary[data-force="hover"] { background: color-mix(in srgb, var(--ms-accent-fill) 86%, var(--ms-text)); }
.ms-btn--primary.ms-btn--danger[data-force="hover"] { background: color-mix(in srgb, var(--ms-danger-fill) 86%, var(--ms-text)); }
.ms-btn--danger:not(.ms-btn--primary)[data-force="hover"] { background: color-mix(in srgb, var(--ms-danger) 10%, var(--ms-local)); }
.ms-row[data-force="hover"] { border-color: color-mix(in srgb, var(--ms-accent) 45%, var(--ms-line)); background: color-mix(in srgb, var(--ms-text) 7%, var(--ms-local)); }
[data-force="focus"]:not(.ms-switch):not(.ms-stepper) { outline: 2px solid var(--ms-indicator); outline-offset: 2px; }
.ms-switch[data-force="focus"]::before { outline: 2px solid var(--ms-indicator); outline-offset: 2px; }
.ms-stepper[data-force="focus"] input { outline: 2px solid var(--ms-indicator); outline-offset: -2px; }
`;

const sheetCss = css`
:host { display: block; block-size: 100%; overflow: auto; color: var(--ms-text); background: var(--ms-surface-app); font-family: var(--ms-font); container-type: normal; }
.sheet { display: grid; gap: var(--ms-space-5); padding: var(--ms-space-4); container-type: inline-size; }
h1 { margin: 0; font-size: var(--ms-t-xl); letter-spacing: var(--ms-track-tight); }
h2 { margin: 0 0 var(--ms-space-2); font-size: var(--ms-t-lg); }
.lede { margin: var(--ms-space-1) 0 0; color: var(--ms-text-quiet); font-size: var(--ms-t-md); line-height: var(--ms-lh-normal); }
.matrix { display: grid; grid-template-columns: minmax(7rem, 9rem) repeat(4, minmax(0, 1fr)); gap: var(--ms-space-3) var(--ms-space-3); align-items: center; padding: var(--ms-space-4); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-lg); background: var(--ms-surface-card); --ms-local: var(--ms-surface-card); }
.matrix > .col-head { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); font-weight: var(--ms-w-bold); }
.matrix > .row-head { font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); }
.matrix > .row-head small { display: block; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); font-weight: var(--ms-w-regular); }
.cell { display: grid; gap: var(--ms-space-1); justify-items: start; min-inline-size: 0; }
.cell .action-reason, .cell .reason { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); text-align: start; }
.cell .ms-row { inline-size: 100%; }
.cell .ms-segment { inline-size: 100%; }
.cell .ms-segment .ms-btn { flex: 1; }
.cell label.ms-field { inline-size: 100%; }
.cell .check-host { inline-size: 100%; }
@container (max-width: 760px) { .matrix { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: var(--ms-space-3); } .matrix > .col-head, .matrix > .corner { display: none; } .matrix > .row-head { grid-column: 1 / -1; margin-block-start: var(--ms-space-3); } .cell::before { content: attr(data-label); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); } }
.schemes { display: grid; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); gap: var(--ms-space-3); }
.type-scale { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-4); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-lg); background: var(--ms-surface-card); }
.type-scale p { margin: 0; }
.targets { padding: var(--ms-space-3) var(--ms-space-4); border-radius: var(--ms-radius-md); background: var(--ms-tint-accent); font-size: var(--ms-t-md); line-height: var(--ms-lh-snug); }
.targets ul { margin: var(--ms-space-2) 0 0; padding-inline-start: var(--ms-space-5); font-size: var(--ms-t-xs); }
:host([data-outline]) :is(button, a, select, input, summary, label.ms-check) { outline: 1px dashed #c026d3 !important; outline-offset: 0 !important; }
`;

const panelCss = css`
:host { display: block; block-size: auto; container-type: normal; padding: var(--ms-space-4); border-radius: var(--ms-radius-lg); color: var(--ms-text); background: var(--ms-surface-app); font-family: var(--ms-font); }
.panel { display: grid; gap: var(--ms-space-3); }
.panel h3 { margin: 0; font-size: var(--ms-t-md); }
.card { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-3); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); background: var(--ms-surface-card); --ms-local: var(--ms-surface-card); }
.swatches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ms-space-2); }
.swatch { display: grid; gap: 0.125rem; padding: var(--ms-space-2) var(--ms-space-3); border-radius: var(--ms-radius-sm); font-size: var(--ms-t-xs); }
.swatch strong { font-size: var(--ms-t-md); }
.buttons { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.mock-chips { display: flex; flex-wrap: wrap; gap: var(--ms-space-1); }
`;

const notice = (tone: Tone, text: string): TemplateResult => html`<div class="ms-notice" data-tone=${tone}>
  ${glyph(toneGlyph(tone))}<p>${text}</p>
  <button class="ms-btn ms-btn--icon" type="button" aria-label=${t("v4_close")}>${glyph(glyphClose)}</button>
</div>`;

/** One palette's tints, tone pairs and fills; its host carries the HA theme. */
export class MockThemePanel extends LitElement {
  static override properties = { theme: { type: String }, d1: { type: Boolean } };
  static override styles = [...screenStyles, panelCss];

  theme: ThemeName = "light";
  d1 = false;

  protected override render(): TemplateResult {
    const swatch = (name: string, token: string): TemplateResult => html`<span class="swatch" style=${`background: var(${token}); --ms-local: var(${token})`}><strong>${name}</strong><span>${token}</span></span>`;
    return html`<div class="panel">
      <h3>${this.theme === "light" ? "Light" : "Dark"} · HA default palette · ${this.d1 ? "Decision 1 fills" : "HA fills"}</h3>
      <div class="swatches">
        ${swatch("Accent tint", "--ms-tint-accent")}
        ${swatch("Danger tint", "--ms-tint-danger")}
        ${swatch("Warning tint", "--ms-tint-warning")}
        ${swatch("Success tint", "--ms-tint-success")}
      </div>
      ${notice("info", t("v4_notice_saving"))}
      ${notice("success", t("v4_notice_plan_on"))}
      ${notice("warning", t("v4_notice_recheck_failed"))}
      ${notice("error", t("v4_notice_stop_unconfirmed"))}
      <div class="card">
        <div class="mock-chips">${chip(t("v4_plan_default"))}${chip(t("v4_paused"), "neutral")}${chip(t("v4_needs_attention_chip"), "danger")}</div>
        ${dueBlock([t("v4_due_mop", { rooms: "Kitchen" })], { tag: "div" })}
        <div class="buttons">
          <button class="ms-btn ms-btn--primary" type="button">${t("v4_action_run_plan")}</button>
          <button class="ms-btn ms-btn--primary ms-btn--danger" type="button" aria-label=${t("v4_stop_cleaning_label")}>${t("v4_action_stop")}</button>
          <button class="ms-btn ms-btn--secondary" type="button">${t("v4_cancel")}</button>
          <button class="ms-btn ms-btn--danger" type="button">${t("v4_action_stop")}</button>
        </div>
        <div class="ms-row"><label class="ms-check"><input type="checkbox" checked @click=${(event: Event) => event.preventDefault()}><span>Kitchen</span></label></div>
        <button class="ms-row ms-row--card ms-row--featured" type="button">
          <span class="ms-row__lead">${glyph(glyphRobot)}</span>
          <span class="ms-row__body"><strong>${t("v4_clean_rooms")}</strong><small>${t("v4_rooms_quick_detail")}</small></span>
        </button>
      </div>
    </div>`;
  }
}

interface Target {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export class MockSystem extends LitElement {
  static override properties = {
    frame: { attribute: false },
    variants: { attribute: false },
    mockState: { attribute: false },
    d1: { attribute: false },
    _small: { state: true },
    _count: { state: true },
  };

  static override styles = [...screenStyles, forcedCss, sheetCss];

  frame: StageFrame = { width: 1024, height: 768, detent: "start" };
  variants: Variants = DEFAULT_VARIANTS;
  mockState = "sheet";
  /** design-system.md Decision 1 (the gallery's `d1` toggle). */
  d1 = false;
  protected _small: readonly Target[] = [];
  protected _count = 0;

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has("mockState")) this.toggleAttribute("data-outline", this.mockState === "targets");
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const root = this.renderRoot.querySelector(".matrix");
    if (!root) return;
    const candidates = [...root.querySelectorAll<HTMLElement>("button, a, select, summary, label.ms-check, input:not([type=checkbox]):not([type=radio])")]
      .filter((element) => !element.closest("[data-exempt]"));
    const small = candidates
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { name: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 32) || element.tagName.toLowerCase(), width: Math.round(box.width), height: Math.round(box.height) };
      })
      .filter((target) => target.width < 44 || target.height < 44);
    if (candidates.length !== this._count || JSON.stringify(small) !== JSON.stringify(this._small)) {
      this._count = candidates.length;
      this._small = small;
    }
  }

  #row(name: string, note: string, cell: (state: "rest" | "hover" | "focus" | "disabled") => TemplateResult): TemplateResult {
    return html`<div class="row-head">${name}<small>${note}</small></div>
      <div class="cell" data-label="Rest">${cell("rest")}</div>
      <div class="cell" data-label="Hover">${cell("hover")}</div>
      <div class="cell" data-label="Focus">${cell("focus")}</div>
      <div class="cell" data-label="Disabled with reason">${cell("disabled")}</div>`;
  }

  #button(classes: string, label: string, state: "rest" | "hover" | "focus" | "disabled", reason: string, id: string, extra: TemplateResult | typeof nothing = nothing, ariaLabel?: string): TemplateResult {
    const disabled = state === "disabled";
    return html`<button
      class=${classes}
      type="button"
      data-force=${state === "hover" || state === "focus" ? state : nothing}
      aria-disabled=${disabled ? "true" : nothing}
      aria-describedby=${disabled ? id : nothing}
      aria-label=${ariaLabel ?? nothing}
    >${extra}${label}</button>${disabled ? html`<p class="reason" id=${id}>${reason}</p>` : nothing}`;
  }

  protected override render(): TemplateResult {
    const force = (state: string): string | typeof nothing => state === "hover" || state === "focus" ? state : nothing;
    return html`<div class="sheet">
      <header>
        <h1>Design system</h1>
        <p class="lede">design-system.md §4–§5 with HA's default palette. Hover and focus columns are forced; disabled controls are <code>aria-disabled</code>, stay focusable and are described by their reason: a visible line under a button, row or switch, and screen-reader text plus a tooltip at a range end (stepper ends, first and last reorder arrows), with no visible line.</p>
        <p class="lede"><strong>Fills: HA defaults (Run plan 3.26:1, Stop 4.29:1) · Decision 1 resolved (≥4.5:1).</strong> Showing: ${this.d1
          ? "Decision 1 resolved: accent fill #007b9f, danger fill #d04134, indicator #008bb3 light / #009ac7 dark, danger text #d04134 light / #df574b dark."
          : "HA defaults, before Decision 1 (--primary-color #009ac7, --error-color #db4437)."}</p>
        <p class="lede">Pixel-identical before Decision 1, so not mocked: (a) the <code>:active</code> mix, (b) the field and switch focus ring, (f) the checked switch knob colour. Not mocked: (e) the inspector's 19rem minimum (the stage keeps 22.5rem).</p>
      </header>
      <section>
        <h2>Controls</h2>
        <div class="matrix">
          <span class="corner"></span><span class="col-head">Rest</span><span class="col-head">Hover</span><span class="col-head">Focus</span><span class="col-head">Disabled with reason</span>
          ${this.#row("Primary", ".ms-btn--primary.--lg", (state) => this.#button("ms-btn ms-btn--primary ms-btn--lg", t("v4_action_run_plan"), state, t("v4_reason_run_plan_paused"), `p-${state}`))}
          ${this.#row("Stop", "danger fill", (state) => this.#button("ms-btn ms-btn--primary ms-btn--danger ms-btn--lg", t("v4_action_stop"), state, t("v4_reason_stop"), `s-${state}`, nothing, t("v4_stop_cleaning_label")))}
          ${this.#row("Secondary", ".ms-btn--secondary", (state) => this.#button("ms-btn ms-btn--secondary", t("v4_cancel"), state, t("v4_reason_plan_saving"), `c-${state}`))}
          ${this.#row("Stop beside Resume", "outline danger", (state) => this.#button("ms-btn ms-btn--danger", t("v4_action_stop"), state, t("v4_reason_stop"), `o-${state}`, nothing, t("v4_stop_cleaning_label")))}
          ${this.#row("Icon", "44 × 44", (state) => this.#button("ms-btn ms-btn--icon", "", state, t("v4_delete_plan_unsaved"), `i-${state}`, glyph(iconOverflow), t("v4_more_actions")))}
          ${this.#row("Small", "--sm: 36 fine, 44 coarse", (state) => html`<span data-exempt>${this.#button("ms-btn ms-btn--sm", t("v4_clear"), state, t("v4_rooms_busy"), `sm-${state}`)}</span>`)}
          ${this.#row("Card row", ".ms-row--card", (state) => html`<button
              class="ms-row ms-row--card"
              type="button"
              data-force=${force(state)}
              aria-disabled=${state === "disabled" ? "true" : nothing}
              aria-describedby=${state === "disabled" ? `r-${state}` : nothing}
            ><span class="ms-row__lead">${glyph(glyphRobot)}</span><span class="ms-row__body"><strong>${t("v4_clean_rooms")}</strong><small>${t("v4_rooms_quick_detail")}</small></span><span class="ms-row__trail">${glyph(iconChevronRight, true)}</span></button>
            ${state === "disabled" ? html`<p class="reason" id=${`r-${state}`}>${t("v4_home_busy_detail")}</p>` : nothing}`)}
          ${this.#row("Check row", ".ms-check in .ms-row", (state) => html`<div class="ms-row check-host" data-force=${state === "hover" ? "hover" : nothing}>
              <label class="ms-check" data-force=${state === "focus" ? "focus" : nothing}><input type="checkbox" ?checked=${state !== "rest"} ?disabled=${state === "disabled"} aria-describedby=${state === "disabled" ? "k-reason" : nothing} @click=${(event: Event) => event.preventDefault()}><span class="row-lines"><bdi>Kitchen</bdi><small>${roomSetting("vacuum", "standard")}</small></span></label>
            </div>
            ${state === "disabled" ? html`<p class="reason" id="k-reason">${t("v4_rooms_busy")}</p>` : nothing}`)}
          ${this.#row("Disclosure", ".ms-disclosure", (state) => html`<button class="ms-disclosure" type="button" data-force=${force(state)} aria-expanded=${String(state === "focus")} aria-disabled=${state === "disabled" ? "true" : nothing}><span>${t("v4_advanced")}</span>${glyph(iconChevronRight, true, "chev")}</button>
            ${state === "disabled" ? html`<p class="reason">Disclosures are never disabled.</p>` : nothing}`)}
          ${this.#row("Switch", ".ms-switch", (state) => html`<span class="switch-row"><button
              class="ms-switch"
              type="button"
              role="switch"
              aria-checked=${String(state !== "rest")}
              aria-label=${t("v4_plan_can_run")}
              data-force=${force(state)}
              aria-disabled=${state === "disabled" ? "true" : nothing}
              aria-describedby=${state === "disabled" ? "sw-reason" : nothing}
            ></button><span>${t("v4_plan_can_run")}</span></span>
            ${state === "disabled" ? html`<p class="reason" id="sw-reason">${t("v4_reason_plan_switch_busy")}</p>` : nothing}`)}
          ${this.#row("Stepper", ".ms-stepper; a range end: sr-only reason + title, no visible line", (state) => {
            const value = state === "disabled" ? null : 3;
            const reason = value === null ? t("v4_cadence_stepper_off_reason") : undefined;
            return html`<span class="ms-stepper" data-force=${force(state)}>
                <button class="ms-btn ms-btn--icon" type="button" aria-label=${t("v4_stepper_decrease", { label: "Mop every 3 cleans" })} aria-disabled=${reason ? "true" : nothing} aria-describedby=${reason ? "st-min" : nothing} title=${reason ?? nothing}>${glyph(glyphMinus)}</button>
                <input type="number" inputmode="numeric" min="1" max="100" .value=${value === null ? "" : String(value)} placeholder=${t("v4_cadence_off")} aria-label="Mop every 3 cleans">
                <button class="ms-btn ms-btn--icon" type="button" aria-label=${t("v4_stepper_increase", { label: "Mop every 3 cleans" })}>${glyph(iconPlus)}</button>
              </span>
              ${reason ? html`<span class="sr-only" id="st-min">${reason}</span>` : nothing}`;
          })}
          ${this.#row("Select", ".ms-field > select", (state) => html`<label class="ms-field">${t("v4_cleaning_system")}
              <select data-force=${force(state)} ?disabled=${state === "disabled"} aria-describedby=${state === "disabled" ? "sel-reason" : nothing}><option>${t("vacuum")}</option><option>${t("vacuum_and_mop")}</option></select>
            </label>${state === "disabled" ? html`<p class="reason" id="sel-reason">${t("v4_cadence_clear_mop_to_change_normal")}</p>` : nothing}`)}
          ${this.#row("Segmented", "aria-pressed pair", (state) => html`<div class="ms-segment" role="group" aria-label=${t("v4_cleaning_order")}>
              <button class="ms-btn" type="button" aria-pressed="true" data-force=${force(state)} aria-disabled=${state === "disabled" ? "true" : nothing}>${t("v4_order_intelligent")}</button>
              <button class="ms-btn" type="button" aria-pressed="false" aria-disabled=${state === "disabled" ? "true" : nothing}>${t("v4_order_ordered")}</button>
            </div>${state === "disabled" ? html`<p class="reason">${t("v4_reason_plan_saving")}</p>` : nothing}`)}
          ${this.#row("Range", ".ms-range", (state) => html`<input class="ms-range" type="range" min="0" max="100" .value=${"50"} aria-label=${t("v4_plan_finish_threshold", { percent: 50 })} aria-valuetext="50%" data-force=${force(state)} ?disabled=${state === "disabled"}>`)}
        </div>
      </section>
      <section>
        <h2>Tints and tones in light and dark</h2>
        <div class="schemes">
          <matic-mock-theme-panel theme="light" .d1=${this.d1} style=${themeStyle("light", this.d1)}></matic-mock-theme-panel>
          <matic-mock-theme-panel theme="dark" .d1=${this.d1} style=${themeStyle("dark", this.d1)}></matic-mock-theme-panel>
        </div>
      </section>
      <section>
        <h2>Type scale</h2>
        <div class="type-scale">
          <p style="font-size: var(--ms-t-xl); font-weight: var(--ms-w-bold); letter-spacing: var(--ms-track-tight)">20 / 700 · workflow h2 · ${t("v4_what_to_clean")}</p>
          <p style="font-size: var(--ms-t-lg); font-weight: var(--ms-w-bold)">16 / 700 · app title, dialog title, sheet status · ${t("map_studio_title")}</p>
          <p style="font-size: var(--ms-t-md); font-weight: var(--ms-w-bold)">14 / 700 · row titles, buttons, section headings · ${t("v4_maps_heading")}</p>
          <p style="font-size: var(--ms-t-md)">14 / 400 · body, notices, fields · ${t("v4_choose_rooms_detail")}</p>
          <p style="font-size: var(--ms-t-xs); color: var(--ms-text-quiet)">12 / 400 · second lines, hints, captions · ${t("v4_history_quick_detail")}</p>
        </div>
      </section>
      <section>
        <h2>44 px targets</h2>
        <div class="targets" role="status">
          ${this._small.length
            ? html`${this._count} targets in the controls matrix; ${this._small.length} under 44 × 44 (the --sm sample is exempt):
              <ul>${this._small.map((target) => html`<li>${target.name}: ${target.width} × ${target.height}</li>`)}</ul>`
            : html`All ${this._count} targets in the controls matrix are at least 44 × 44 (the --sm sample is exempt; it is 36 on a fine pointer by design).`}
        </div>
      </section>
    </div>`;
  }
}
