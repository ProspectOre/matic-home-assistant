import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { html as staticHtml, unsafeStatic } from "lit/static-html.js";
import { controls } from "./controls";
import { formControls } from "./form-controls";
import { mopControl } from "./mop-control";
import { base, tokens } from "./tokens";

import type { CleaningMode, CoverageSetting } from "./backend-contracts";
import {
  type DateFormat,
  type Localize,
  type ResourceState,
  type WorkspaceIntent,
  type WorkspaceState,
} from "./contracts";
import { PLAN_VIEWS_TAG, PRECISION_CONTROLS_TAG, ROOMS_VIEW_TAG, WORKFLOW_TAG } from "./element-tags";
import { WORKSPACE_INTENT_EVENT } from "./map-canvas";
import { deleteSubject, hasStoppableWork, initialWorkspaceState } from "./state";
import { heldReasonKey } from "./draw-tools";
import { formatDateTime, formatList, translate } from "./localize";
import { LazyChunk, chunkStatus } from "./lazy-chunk";
import { COVERAGES, MODES, coverageLabel, modeLabel, settingLabel } from "./plan-cadence";
import { homePinSwitch } from "./home-shortcuts";
import { icon, iconChevronRight, iconNoticeWarning, iconPlus } from "./icons";
import { formatNumber, plansWithArea, type Translate } from "./plan-copy";
// The plan picker, Run and Edit, and the Rooms view.
import "./plan-views";
import "./rooms-view";
// Draw's precision controls load with the other workflow tools; the shell
// renders them only in the draw workflow.
import "./precision-controls";
// The plan heading's tools, which the shell renders once these views load,
// and the shell's other plan-only pieces.
export { actionReason, drawCancel, drawExit, focusPlanTarget, planCancel, planTitle, planTools } from "./plan-heading";

// Dialogs that only these views' controls open carry their copy, launcher and
// confirm here.
export { confirmDialog, dialogCopy, dialogLauncher, dialogReturnTarget } from "./dialog-copy";
export { drawRecipes } from "./draw-recipes";
export { roomTapAnnouncement, roomsGripLine, roomsSummary } from "./rooms-view";
export { shellWorkflowStyles } from "./workflow-styles";
export { homeShortcuts } from "./home-shortcuts";

// One hint for the tool in hand, chosen by the pointer that will use it;
// Move map needs none (map-surfaces.md §6). The keyboard recipes are
// assistive text on the map (map-help.ts). The shell renders it under the
// phone sheet's tool rows; the panel renders it in the wide body.
export const drawHint = (t: Translate, state: WorkspaceState): string | null => {
  const { tool } = state.draw;
  if (tool === "pan") return null;
  const coarse = window.matchMedia("(any-pointer: coarse)").matches;
  if (tool === "outline") {
    return coarse
      ? t("v4_points_hint_touch", "Tap to add points · two fingers to move the map")
      : t("v4_points_hint_pointer", "Click to add points · right-drag to move the map");
  }
  if (tool === "erase") return coarse
    ? t("v4_erase_hint_touch", "Drag to erase · two fingers to move the map")
    : t("v4_erase_hint_pointer", "Drag to erase · right-drag or Space-drag to move the map");
  return coarse
    ? t("v4_draw_hint_touch", "Drag to paint · two fingers to move the map")
    : t("v4_draw_hint_pointer", "Drag to paint · right-drag or Space-drag to move the map");
};
export { formControls } from "./form-controls";

const planViewsTag = unsafeStatic(PLAN_VIEWS_TAG);
const roomsViewTag = unsafeStatic(ROOMS_VIEW_TAG);
const precisionControlsTag = unsafeStatic(PRECISION_CONTROLS_TAG);

const eventValue = (event: Event): string => (event.currentTarget as HTMLInputElement).value;

export class MaticMapWorkflowV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    dates: { attribute: false },
    _historyPreviewPosition: { state: true },
    narrow: { type: Boolean },
  };

  static override styles = [tokens, base, controls, formControls, css`
:host { display: block; min-inline-size: 0; container-type: inline-size; }
.ms-row--danger { color: var(--ms-resolved-danger-text, var(--ms-danger)); }
.sr-only { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; clip-path: inset(50%); white-space: nowrap; }
button, select, input[type="checkbox"] { cursor: pointer; }
.stack { display: grid; gap: var(--ms-space-3); }
.subtle { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.loading, .empty, .problem, .notice {
--ms-local: var(--ms-surface-sunken);
padding: var(--ms-space-3);
border-radius: var(--ms-radius-md);
background: var(--ms-local);
font-size: var(--ms-t-sm);
line-height: var(--ms-lh-snug);
}
/* As the shell's notices: the text keeps the primary colour on the tone tint. */
.problem, .notice[data-tone="warning"] { --ms-local: color-mix(in srgb, var(--notice-tone) 12%, var(--ms-surface-card)); color: var(--ms-text); }
.problem { --notice-tone: var(--ms-danger); }
.notice[data-tone="warning"] { --notice-tone: var(--ms-warning); }
.split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ms-space-2); }
.list { display: grid; gap: var(--ms-space-2); }
.group { display: grid; gap: var(--ms-space-2); }
.floor[aria-current="true"] { border-color: var(--ms-resolved-indicator, var(--ms-accent)); background: color-mix(in srgb, var(--ms-accent) 12%, var(--ms-local)); }
.problem p { margin: 0; }
@media (forced-colors: active) { .problem, .notice { border: 1px solid CanvasText; } .floor[aria-current="true"] { forced-color-adjust: none; color: HighlightText; background: Highlight; border-color: Highlight; } }
.toolbar { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.checkbox { display: flex; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control); font-size: var(--ms-t-xs); font-weight: var(--ms-w-medium); }
.checkbox input { inline-size: 1.2rem; block-size: 1.2rem; }
.floor small, .snapshot small, .list-button small { margin-inline-start: auto; color: color-mix(in srgb, var(--ms-text) 78%, var(--ms-local)); font-weight: var(--ms-w-regular); }
.timeline { display: grid; gap: var(--ms-space-2); }
.timeline-ends { display: flex; justify-content: space-between; margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
@media (max-width: 25rem) { .split { grid-template-columns: 1fr; } }
/* Your areas mirrors the plan picker (plan-views.ts): name, setting, a tone line. */
.area-row .ms-row__body { display: grid; gap: 0.125rem; }
.area-row bdi { overflow: hidden; min-inline-size: 0; text-overflow: ellipsis; white-space: nowrap; }
.area-row small { color: var(--ms-text-quiet); }
.area-row .ms-row__trail:dir(rtl) .ms-icon { scale: -1 1; }
.lines { display: grid; gap: 0.125rem; color: var(--ms-text); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.line { display: flex; gap: var(--ms-space-1); align-items: flex-start; }
.line .ms-icon { flex: none; inline-size: 1rem; block-size: 1rem; color: var(--ms-warning); }
.empty-card { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-4); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); }
.empty-card h3 { margin: 0; font-size: var(--ms-t-md); }
.empty-card p { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-md); line-height: var(--ms-lh-normal); }
.empty-card .ms-btn { justify-self: start; }
.switch-row { display: flex; gap: var(--ms-space-3); align-items: center; min-block-size: var(--ms-control); }
.switch-copy { display: grid; flex: 1; gap: 0.125rem; min-inline-size: 0; font-size: var(--ms-t-md); }
.switch-copy small, .reason { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
`];

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;
  // The phone sheet holds the brush settings itself, above the tool row.
  narrow = false;
  dates?: DateFormat;
  /** The shell's Try again (shell.ts #retry), for the diagnostics chunk. */
  retry!: (event: Event) => void;
  _historyPreviewPosition: number | null = null;
  readonly #diagnostics = new LazyChunk(this, () => import("./diagnostics-panel"));
  readonly #runHistory = new LazyChunk(this, () => import("./run-history"));
  #historySelectionKey = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("state")) return;
    const { workflow, selection } = this.state;
    const key = `${workflow}:${selection.floorId}:${selection.historyId ?? "live"}`;
    if (key !== this.#historySelectionKey) {
      this.#historySelectionKey = key;
      this._historyPreviewPosition = null;
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
  }

  #t(key: string, fallback: string, placeholders?: Readonly<Record<string, string | number>>): string {
    return translate(this.localize, key, fallback, placeholders);
  }

  // Why the rows wait while a command runs (R12), in the host's words.
  #heldReason(): string | null {
    const held = heldReasonKey(this.state);
    return held ? this.#t(held.reasonKey, held.reason) : null;
  }

  #modeLabel(mode: CleaningMode): string {
    return modeLabel(this.#tr, mode);
  }

  #coverageLabel(value: CoverageSetting): string {
    return coverageLabel(this.#tr, value);
  }

  readonly #tr = (key: string, fallback: string, placeholders?: Readonly<Record<string, string | number>>): string =>
    this.#t(key, fallback, placeholders);

  /**
   * The saved plans that clean a custom area, as one quiet line ("In 2 plans:
   * …"); none when no plan does or the plans aren't loaded.
   */
  #inPlans(areaId: string): string | null {
    const plans = plansWithArea(this.state.resources.plans.value?.plans, areaId);
    if (!plans.length) return null;
    const names = formatList(this.state.locale, plans);
    return plans.length === 1
      ? this.#t("v4_area_in_plans_one", "In 1 plan: {plans}", { plans: names })
      : this.#t("v4_area_in_plans", "In {count} plans: {plans}", { count: formatNumber(this.state.locale, plans.length), plans: names });
  }

  #line(text: string | null, tag: "small" | "p") {
    return text === null ? nothing : tag === "small" ? html`<small data-in-plans>${text}</small>` : html`<p class="subtle" data-in-plans>${text}</p>`;
  }



  readonly #emit = (intent: WorkspaceIntent): void => this.#intent(intent);

  #intent(intent: WorkspaceIntent): void {
    this.dispatchEvent(new CustomEvent(WORKSPACE_INTENT_EVENT, {
      detail: intent,
      bubbles: true,
      composed: true,
    }));
  }

  #resourceCopy(workflow: "rooms" | "plans" | "plan" | "areas" | "draw" | "areaReview" | "history"): { readonly loading: string; readonly unavailable: string; readonly empty: string } {
    switch (workflow) {
      case "rooms":
      case "plans":
      case "plan":
        return {
          loading: this.#t("v4_loading_rooms_plans", "Loading rooms and plans…"),
          unavailable: this.#t("v4_rooms_plans_unavailable", "Home Assistant couldn't load rooms and plans."),
          empty: this.#t("v4_no_rooms_plans", "This floor has no rooms yet. Name rooms in the Matic app to see them here."),
        };
      case "areas":
      case "draw":
      case "areaReview":
        return {
          loading: this.#t("v4_loading_areas", "Loading saved areas…"),
          unavailable: this.#t("v4_areas_unavailable", "Home Assistant couldn't load your saved areas."),
          empty: "",
        };
      case "history":
        return {
          loading: this.#t("v4_loading_history", "Loading map history…"),
          unavailable: this.#t("v4_history_unavailable", "Map history is unavailable right now."),
          empty: this.#t("v4_no_map_history", "No saved map snapshots yet."),
        };
    }
  }

  // A reload keeps showing what is already loaded; only an empty load waits.
  #resource({ status, value }: ResourceState<unknown>, body: unknown, workflow: "rooms" | "plans" | "plan" | "draw" | "areaReview" | "history") {
    const copy = this.#resourceCopy(workflow);
    if (value === null && (status === "idle" || status === "loading")) return html`<div class="loading" role="status">${copy.loading}</div>`;
    if (status === "error") {
      return html`
        <div class="stack">
          <div class="problem" role="alert">${copy.unavailable}</div>
          <div class="toolbar">
            <button class="ms-btn ms-btn--secondary" type="button" @click=${() => this.#intent({ type: "open-workflow", workflow })}>${this.#t("v4_retry", "Try again")}</button>
          </div>
        </div>
      `;
    }
    if (status === "empty") return html`<div class="empty">${copy.empty}</div>`;
    return body;
  }

  #rooms() {
    return this.#resource(this.state.resources.plans, staticHtml`<${roomsViewTag}
      .state=${this.state}
      .localize=${this.localize}
    ></${roomsViewTag}>`, "rooms");
  }

  #planViews() {
    const workflow = this.state.workflow === "plans" ? "plans" : "plan";
    return this.#resource(this.state.resources.plans, staticHtml`<${planViewsTag}
      .state=${this.state}
      .localize=${this.localize}
    ></${planViewsTag}>`, workflow);
  }

  #draw() {
    // On a phone the sheet shows the hint under its tool rows, where it is
    // read at peek; here it would hide until the sheet opens.
    const hint = this.narrow ? null : drawHint(this.#tr, this.state);
    // Draw only draws: the saved areas live in Your areas (owner, 2026-10-13).
    return html`
      <div class="stack">
        ${hint ? html`<p class="subtle draw-hint">${hint}</p>` : nothing}
        ${this.state.precisionOpen && !this.narrow ? staticHtml`<${precisionControlsTag} .state=${this.state} .localize=${this.localize}></${precisionControlsTag}>` : nothing}
      </div>
    `;
  }

  /**
   * Your areas (owner, 2026-10-13), as the plan picker: one row per saved
   * custom area on this floor with its setting and, when the map moved under
   * it, what it needs; New area last, the one way into Draw. Rows are held
   * while a command runs, with the toolbar's reason (R12).
   */
  #areas() {
    const { status, value } = this.state.resources.areas;
    const copy = this.#resourceCopy("areas");
    if (value === null && (status === "idle" || status === "loading")) return html`<div class="loading" role="status">${copy.loading}</div>`;
    const held = this.#heldReason();
    const heldBy = held ? "areas-held-reason" : nothing;
    const disabled = held ? "true" : nothing;
    const go = (intent: WorkspaceIntent) => () => { if (!held) this.#intent(intent); };
    const newArea = this.#t("area_new", "New area");
    const problem = status === "error" ? html`
      <div class="problem" role="alert">${copy.unavailable}</div>
      <div class="toolbar"><button class="ms-btn ms-btn--secondary" type="button" @click=${() => this.#intent({ type: "open-workflow", workflow: "areas" })}>${this.#t("v4_retry", "Try again")}</button></div>
    ` : nothing;
    const areas = value?.areas ?? [];
    if (!areas.length) {
      return html`<div class="stack">
        ${problem}
        ${value === null && status === "error" ? nothing : html`<div class="empty-card">
          <h3>${this.#t("v4_no_areas", "No custom areas yet")}</h3>
          <p>${this.#t("v4_no_areas_hint", "Draw an area on the map to clean just that spot.")}</p>
          <button class="ms-btn ms-btn--primary" type="button" data-area-new aria-disabled=${disabled} aria-describedby=${heldBy} @click=${go({ type: "open-workflow", workflow: "draw" })}>${newArea}</button>
        </div>`}
        ${held ? html`<p class="sr-only" id="areas-held-reason">${held}</p>` : nothing}
      </div>`;
    }
    return html`<div class="stack">
      ${problem}
      <p class="subtle">${this.#t("v4_choose_area_detail", "Tap an area to clean it or change it.")}</p>
      <div class="list" role="list">
        ${areas.map((area) => {
          // As the area's screen reads it (map-surfaces.md §4): changed, or unusable.
          const check = area.canRebind || area.status === "review";
          const redraw = !check && area.status !== "current";
          const noGo = value?.zones.some((zone) => zone.kind === "no_go" && zone.areaIds.includes(area.id));
          return html`<div role="listitem"><button
            class="ms-row ms-row--card area-row"
            type="button"
            data-area-row=${area.id}
            aria-disabled=${disabled}
            aria-describedby=${heldBy}
            @click=${go({ type: "select-area", areaId: area.id, workflow: "areaReview" })}
          >
            <span class="ms-row__body">
              <strong><bdi>${area.name}</bdi></strong>
              <small>${settingLabel(this.#tr, area)}</small>
              ${this.#line(this.#inPlans(area.id), "small")}
              ${check || redraw ? html`<span class="lines"><span class="line" data-tone="warning">${icon(iconNoticeWarning)}<span>${check
                ? this.#t("v4_area_row_check", "Map changed · Check it before cleaning")
                : this.#t("v4_area_row_redraw", "Redraw it before cleaning")}</span></span></span>` : nothing}
              ${noGo ? html`<small data-zone-overlap>${this.#t("v4_zone_overlap", "Overlaps a no-go zone · Matic skips that part")}</small>` : nothing}
            </span>
            <span class="ms-row__trail">${icon(iconChevronRight)}</span>
          </button></div>`;
        })}
        <div role="listitem"><button class="ms-row ms-row--card" type="button" data-area-new aria-disabled=${disabled} aria-describedby=${heldBy} @click=${go({ type: "open-workflow", workflow: "draw" })}>
          <span class="ms-row__lead">${icon(iconPlus)}</span>
          <span class="ms-row__body"><strong>${newArea}</strong></span>
        </button></div>
      </div>
      ${held ? html`<p class="sr-only" id="areas-held-reason">${held}</p>` : nothing}
    </div>`;
  }

  #areaReview() {
    const draft = this.state.areaDraft;
    const areas = this.state.resources.areas;
    const needsReview = draft.canRebind || draft.status === "review";
    const reviewHasOutline = this.state.draw.outline?.closed === true && this.state.draw.outline.points.length >= 3;
    const reviewHasCircles = this.state.draw.circles.length > 0;
    const stale = !needsReview && (draft.status === "stale" || draft.status === "unknown");
    // Held while a command runs (R12): fields stay focusable and say why.
    const held = this.#heldReason();
    const heldBy = held ? "review-held-reason" : nothing;
    const disabled = held ? "true" : nothing;
    // While Stop holds the bar, as primary or secondary, Redraw is a body
    // button (shell.md §3): Stop never shares its place with an edit.
    const bodyRedraw = hasStoppableWork(this.state);
    const canDelete = deleteSubject(this.state, "confirmDeleteArea") !== undefined;
    return html`
      <div class="stack">
        ${needsReview ? html`<div class="notice" data-tone="warning" role="status">${reviewHasOutline
          ? this.#t("area_review_outline_required", "The map changed since this area was saved. Inspect its outline and coverage on the current map, then confirm to update the saved map binding, or redraw it.")
          : reviewHasCircles
            ? this.#t("area_review_circles_required", "The map changed since this area was saved. Inspect its saved circle coverage on the current map, then confirm to update the saved map binding. Redraw it if the coverage is uncertain.")
            : this.#t("area_review_geometry_unavailable", "The map changed since this area was saved, but its saved coverage is unavailable to inspect. Redraw the area before confirming its map binding.")}</div>` : nothing}
        ${stale ? html`<div class="problem" role="alert">${this.#t("area_redraw_required", "Home Assistant can't use this area as it was saved, so redraw it.")}</div>` : nothing}
        ${areas.status === "error" ? html`
          <div class="stack">
            <div class="problem" role="alert">${this.#resourceCopy("areaReview").unavailable}</div>
            <div class="toolbar"><button class="ms-btn ms-btn--secondary" type="button" @click=${() => this.#intent({ type: "open-workflow", workflow: "areaReview" })}>${this.#t("v4_retry", "Try again")}</button></div>
          </div>
        ` : nothing}
        <label class="field ms-field">${this.#t("area_name", "Area name")}
          <input maxlength="128" autocomplete="off" .value=${draft.name} ?readonly=${Boolean(held)} aria-disabled=${disabled} aria-describedby=${heldBy} @input=${(event: Event) => { if (!held) this.#intent({ type: "patch-area-draft", patch: { name: eventValue(event) } }); }}>
        </label>
        <div class="split">
          <label class="field ms-field">${this.#t("v4_cleaning_system", "Cleaning mode")}
            <select .value=${draft.cleaningMode} aria-disabled=${disabled} aria-describedby=${heldBy} @change=${(event: Event) => {
              if (held) { (event.currentTarget as HTMLSelectElement).value = draft.cleaningMode; return; }
              this.#intent({ type: "patch-area-draft", patch: { cleaningMode: eventValue(event) as CleaningMode } });
            }}>${MODES.map((mode) => html`<option value=${mode} ?selected=${mode === draft.cleaningMode}>${this.#modeLabel(mode)}</option>`)}</select>
          </label>
          ${draft.cleaningMode === "mop" ? nothing : html`<label class="field ms-field">${this.#t("vacuum_coverage", "Vacuum coverage")}
            <select .value=${draft.coverageSetting} aria-disabled=${disabled} aria-describedby=${heldBy} @change=${(event: Event) => {
              if (held) { (event.currentTarget as HTMLSelectElement).value = draft.coverageSetting; return; }
              this.#intent({ type: "patch-area-draft", patch: { coverageSetting: eventValue(event) as CoverageSetting } });
            }}>${COVERAGES.map((option) => html`<option value=${option} ?selected=${option === draft.coverageSetting}>${this.#coverageLabel(option)}</option>`)}</select>
          </label>`}
        </div>
        ${mopControl(this.#tr, this.state, draft.cleaningMode, "area")}
        ${this.#line(draft.id === null ? null : this.#inPlans(draft.id), "p")}
        ${bodyRedraw ? html`
          <div class="toolbar">
            <button class="ms-btn ms-btn--secondary" type="button" data-redraw aria-disabled=${disabled} aria-describedby=${heldBy} @click=${() => { if (!held) this.#intent({ type: "open-workflow", workflow: "draw" }); }}>${this.#t("v4_edit_outline", "Redraw")}</button>
          </div>
        ` : nothing}
        ${held ? html`<p class="sr-only" id="review-held-reason">${held}</p>` : nothing}
        ${draft.id === null ? nothing : homePinSwitch(this.#tr, this.state, { kind: "area", id: draft.id }, (intent) => this.#intent(intent))}
        ${canDelete ? html`
          <button
            class="list-button ms-row ms-row--danger"
            type="button"
            data-dialog-launcher="confirmDeleteArea"
            aria-disabled=${disabled}
            aria-describedby=${heldBy}
            @click=${() => { if (!held) this.#intent({ type: "open-dialog", dialog: "confirmDeleteArea" }); }}
          >${this.#t("area_delete", "Delete")}</button>
        ` : nothing}
      </div>
    `;
  }

  #history() {
    const resource = this.state.resources.history;
    const catalog = resource.value;
    const floor = catalog?.floors.find((candidate) => candidate.id === this.state.selection.floorId)
      || catalog?.floors.find((candidate) => candidate.active)
      || catalog?.floors[0];
    const snapshots = floor?.snapshots || [];
    const position = this.state.selection.historyId
      ? Math.max(0, snapshots.findIndex((snapshot) => snapshot.id === this.state.selection.historyId))
      : snapshots.length;
    const live = this.#t("map_timeline_live_action", "Live");
    // Only the live floor has a live map, so only its scrubber ends at Live; a
    // saved floor's ends at its newest map and never changes floor under the thumb.
    const liveEnd = Boolean(floor?.active);
    const last = liveEnd ? snapshots.length : snapshots.length - 1;
    const displayPosition = Math.min(this._historyPreviewPosition ?? position, last);
    const selectedSnapshot = snapshots[displayPosition];
    // Held while a command runs (R12): rows and scrubber say why and change nothing.
    const held = this.#heldReason();
    const disabled = held ? "true" : nothing;
    const heldBy = held ? "history-held-reason" : nothing;
    // The live map could not be shown, so the last saved one is: the selectors
    // leave history without a branch, so the body carries the reason once.
    const readOnlyLive = this.state.dataMode === "live" && this.state.floor.readOnly;
    return this.#resource(resource, html`
      <div class="stack">
        ${readOnlyLive ? html`<p class="subtle">${this.#t("v4_reason_live_map_required", "Can't edit until you show the live map.")}</p>` : nothing}
        ${(catalog?.floors.length || 0) > 1 ? html`
          <div class="group">
            <h3 class="ms-section-heading" id="floors-heading">${this.#t("v4_mapped_floors", "Mapped floors")}</h3>
            <div class="list" role="group" aria-labelledby="floors-heading">
            ${(catalog?.floors || []).map((candidate, index) => html`
              <button
                class="floor ms-row"
                type="button"
                aria-current=${String(candidate.id === floor?.id)}
                aria-disabled=${disabled}
                aria-describedby=${heldBy}
                @click=${() => { if (!held) this.#intent({ type: "set-floor", floorId: candidate.id }); }}
              >
                <span>${candidate.label || (candidate.active
                  ? this.#t("v4_current_floor", "Current floor")
                  : this.#t("v4_saved_floor", "Saved floor {number}", { number: candidate.ordinal ?? index }))}</span>
                <small>${candidate.active ? live : this.#t("v4_saved_map", "Saved map")}</small>
              </button>
            `)}
            </div>
          </div>
        ` : nothing}
        <div class="timeline">
          ${snapshots.length >= 3 ? html`
            <label class="field ms-field">${this.#t("map_timeline_label", "Map timeline")}
              <input
                type="range"
                class="ms-range"
                min="0"
                max=${String(last)}
                step="1"
                .value=${String(displayPosition)}
                aria-valuetext=${selectedSnapshot ? formatDateTime(selectedSnapshot.createdAt, this.dates) : live}
                aria-disabled=${disabled}
                aria-describedby=${heldBy}
                @input=${(event: Event) => {
                  if (held) { (event.currentTarget as HTMLInputElement).value = String(position); return; }
                  this._historyPreviewPosition = Number(eventValue(event));
                }}
                @change=${(event: Event) => {
                  if (held) { (event.currentTarget as HTMLInputElement).value = String(position); return; }
                  const index = Number(eventValue(event));
                  this._historyPreviewPosition = null;
                  this.#intent({ type: "set-history", historyId: index === snapshots.length ? null : snapshots[index]?.id || null });
                }}
              >
            </label>
            <p class="timeline-ends" aria-hidden="true"><span>${this.#t("map_timeline_oldest", "Oldest")}</span><span>${liveEnd ? live : this.#t("map_timeline_newest", "Newest")}</span></p>
          ` : nothing}
          <div class="list">
            ${snapshots.map((snapshot, index) => html`
              <button class="snapshot ms-row" type="button" aria-current=${String(snapshot.id === this.state.selection.historyId)} aria-disabled=${disabled} aria-describedby=${heldBy} @click=${() => { if (!held) this.#intent({ type: "set-history", historyId: snapshot.id }); }}>
                <span>${formatDateTime(snapshot.createdAt, this.dates)}</span><small>${this.#t("v4_history_position", "{position} of {count}", { position: index + 1, count: snapshots.length })}</small>
              </button>
            `)}
          </div>
        </div>
        ${held ? html`<p class="sr-only" id="history-held-reason">${held}</p>` : nothing}
      </div>
    `, "history");
  }

  #support() {
    this.#diagnostics.request();
    if (this.#diagnostics.status !== "ready") return chunkStatus(this.#diagnostics.status, this.localize, this.retry);
    return html`<matic-map-diagnostics-v4
      .state=${this.state}
      .localize=${this.localize}
      .disabled=${this.state.command !== "idle" && this.state.command !== "failed"}
    ></matic-map-diagnostics-v4>`;
  }

  #runs() {
    this.#runHistory.request();
    if (this.#runHistory.status !== "ready") return chunkStatus(this.#runHistory.status, this.localize, this.retry);
    return html`<matic-run-history-v4 .state=${this.state} .localize=${this.localize} .dates=${this.dates} .emit=${this.#emit}></matic-run-history-v4>`;
  }

  protected override render() {
    switch (this.state.workflow) {
      case "rooms": return this.#rooms();
      case "plans":
      case "plan": return this.#planViews();
      case "areas": return this.#areas();
      case "draw": return this.#draw();
      case "areaReview": return this.#areaReview();
      case "history": return this.#history();
      case "support": return this.#support();
      case "runs": return this.#runs();
      case "none": return nothing;
    }
  }
}

if (!customElements.get(WORKFLOW_TAG)) {
  customElements.define(WORKFLOW_TAG, MaticMapWorkflowV4);
}
