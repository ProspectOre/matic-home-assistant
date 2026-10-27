import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { controls } from "./controls";
import { formControls } from "./form-controls";
import { mopControl } from "./mop-control";
import { icon, iconChevronRight, iconDue, iconMoveDown, iconMoveUp, iconNoticeWarning, iconPlus } from "./icons";
import { base, tokens } from "./tokens";
import type { CadenceReason, CleaningMode, CoverageSetting, PlanRoom, SavedArea, SavedPlan } from "./backend-contracts";
import { MAX_ROOM_SEQUENCE_SIZE, type Localize, type PlanDraftArea, type WorkspaceIntent, type WorkspaceState } from "./contracts";
import { COVERAGES, MODES, coverageLabel, modeLabel, scheduleBlock } from "./plan-cadence";
import { stepperStyles } from "./stepper";
import { PLAN_VIEWS_TAG } from "./element-tags";
import { MenuController } from "./menu-controller";
import { WORKSPACE_INTENT_EVENT } from "./map-canvas";
import {
  PLAN_BLOCKERS,
  PLAN_PREVIEW,
  canEditCoordinates,
  draftForPlan,
  hasStoppableWork,
  initialWorkspaceState,
  roomBlocker,
} from "./state";
import { formatDuration, translate } from "./localize";
import {
  draftSteps, dueLines, formatNumber, fromSteps, planAreas, planRowLine2, planRowLine3, roomsAndAreas, withPlanAreas,
} from "./plan-copy";
import { scheduleLine, settingLabel } from "./plan-cadence";
import { homePinSwitch } from "./home-shortcuts";

/** A plan holds up to 100 custom areas, as many as rooms (`save_plan`). */
const MAX_PLAN_AREAS = MAX_ROOM_SEQUENCE_SIZE;

/** The saved schedule reasons that keep a room's run from starting (plan.md R3). */
const BLOCKING: readonly CadenceReason[] = [
  "mop_progress_unverified", "coverage_progress_unverified", "identity_changed", "room_not_on_current_map",
  "shared_schedule_unavailable", "invalid_cadence_policy", "coverage_requires_vacuum",
];

/**
 * The plan picker and a plan's Run view (plan.md §3). Their rows and copy
 * load with the workflow views, since only the plan workflows show them.
 */
export class MaticPlanViewsV4 extends LitElement {
  static override styles = [tokens, base, controls, formControls, stepperStyles, css`
:host { display: block; }
.plain { display: grid; gap: var(--ms-space-2); margin: 0; padding: 0; list-style: none; }
.plan-row .ms-row__body { display: grid; gap: 0.125rem; }
/* Beats controls' .ms-row__body strong; a long name ellipsizes and its chips stay on line 1. */
.plan-row .plan-title { display: flex; gap: var(--ms-space-1) var(--ms-space-2); align-items: center; min-inline-size: 0; }
.plan-row .plan-title bdi { overflow: hidden; min-inline-size: 0; text-overflow: ellipsis; white-space: nowrap; }
.plan-row .plan-title .ms-chip { flex: none; }
.chip-default { border-color: transparent; background: color-mix(in srgb, var(--ms-accent) 12%, var(--ms-surface-card)); }
.chip-attention { border-color: transparent; background: color-mix(in srgb, var(--ms-danger) 12%, var(--ms-surface-card)); }
/* Line 3 keeps the text colour; the glyph carries the tone (design-system.md §5). */
.lines { display: grid; gap: 0.125rem; margin: 0; color: var(--ms-text); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.line { display: flex; gap: var(--ms-space-1); align-items: flex-start; margin: 0; color: var(--ms-text); }
.line .ms-icon { inline-size: 1rem; block-size: 1rem; color: var(--ms-resolved-indicator, var(--ms-accent)); }
.line[data-tone="warning"] .ms-icon { color: var(--ms-warning); }
.plan-row .ms-row__trail:dir(rtl) .ms-icon { scale: -1 1; }
.empty-card { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-4); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); }
.empty-card h3 { margin: 0; font-size: var(--ms-t-md); }
.empty-card p { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-md); line-height: var(--ms-lh-normal); }
.empty-card .ms-btn { justify-self: start; }
.quiet { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.heading { margin: var(--ms-space-4) 0 var(--ms-space-2); color: var(--ms-text-quiet); font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); line-height: var(--ms-lh-tight); }
.summary { margin: 0 0 var(--ms-space-2); color: var(--ms-text-quiet); font-size: var(--ms-t-md); line-height: var(--ms-lh-snug); }
.run-list { display: grid; margin: 0 0 var(--ms-space-3); padding: 0; list-style: none; }
.run-row { display: flex; gap: var(--ms-space-3); align-items: flex-start; padding-block: var(--ms-space-2); border-block-end: 1px solid var(--ms-line); }
.run-row:last-child { border-block-end: 0; }
.run-row[data-break] { margin-block-start: var(--ms-space-3); padding-block-start: var(--ms-space-3); border-block-start: 2px dashed var(--ms-line-strong); }
.row-lines { display: grid; flex: 1; gap: 0.125rem; min-inline-size: 0; }
.row-lines bdi { font-weight: var(--ms-w-bold); overflow-wrap: anywhere; }
.row-lines small { color: color-mix(in srgb, var(--ms-text) 78%, var(--ms-local, var(--ms-surface-card))); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.row-lines .ms-chip { justify-self: start; }
.pos-badge { display: grid; flex: none; place-items: center; inline-size: 1.5rem; block-size: 1.5rem; border-radius: 50%; background: color-mix(in srgb, var(--ms-accent) 12%, var(--ms-surface-card)); font-size: var(--ms-t-xs); font-weight: var(--ms-w-bold); font-variant-numeric: tabular-nums; }
.problem { margin: 0 0 var(--ms-space-2); padding: var(--ms-space-3); border-radius: var(--ms-radius-md); background: color-mix(in srgb, var(--ms-danger) 12%, var(--ms-surface-card)); font-size: var(--ms-t-sm); line-height: var(--ms-lh-snug); }
.switch-row { display: flex; gap: var(--ms-space-3); align-items: center; min-block-size: var(--ms-control); }
.pin-setting { margin-block-start: var(--ms-space-3); }
.pin-setting:empty { display: none; }
.switch-copy { display: grid; flex: 1; gap: 0.125rem; min-inline-size: 0; font-size: var(--ms-t-md); }
.switch-copy small, .reason { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.sr-only { position: absolute; inset-block-start: 0; inset-inline-start: 0; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
/* Edit (plan.md §3, ported from mockups/plan.ts). */
.edit { display: grid; gap: var(--ms-space-3); }
.order { display: grid; gap: var(--ms-space-1); margin: 0; padding: 0; border: 0; font-size: var(--ms-t-sm); }
.order .ms-segment { padding: 0; }
.order .ms-btn { flex: 1; }
.list-header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ms-space-2); }
.list-header .heading { margin: 0; }
.list-header small { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
.edit-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; padding: 0; }
.edit-row:not([data-selected]) { --ms-local: var(--ms-surface-card); }
.edit-check { display: grid; place-items: center; inline-size: var(--ms-control); block-size: var(--ms-control); cursor: pointer; }
.edit-check input { inline-size: 1.2rem; block-size: 1.2rem; margin: 0; accent-color: var(--ms-resolved-indicator, var(--ms-accent)); cursor: pointer; }
.edit-disclosure { display: flex; gap: var(--ms-space-2); align-items: center; min-inline-size: 0; min-block-size: var(--ms-control); padding: var(--ms-space-2) var(--ms-space-1); border: 0; border-radius: var(--ms-radius-sm); color: inherit; background: transparent; font: inherit; text-align: start; cursor: pointer; }
.edit-disclosure:focus-visible { outline: 2px solid var(--ms-resolved-indicator, var(--ms-accent)); outline-offset: -2px; }
.edit-disclosure > .ms-icon { flex: none; transition: rotate 120ms; }
.edit-disclosure[aria-expanded="true"] > .ms-icon { rotate: 90deg; }
.edit-disclosure:dir(rtl) > .ms-icon { scale: -1 1; }
/* scale applies before rotate, so the mirrored chevron turns the other way to point down. */
.edit-disclosure[aria-expanded="true"]:dir(rtl) > .ms-icon { rotate: -90deg; }
.edit-name { display: grid; gap: 0.125rem; min-inline-size: 0; padding-inline: var(--ms-space-1); }
.edit-name small { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.edit-moves { display: flex; }
.row-expanded { display: grid; grid-column: 1 / -1; gap: var(--ms-space-2); padding: var(--ms-space-3); border-block-start: 1px solid var(--ms-line); }
.run-end { display: grid; gap: var(--ms-space-2); }
.run-end > summary { min-block-size: var(--ms-control); align-content: center; font-weight: var(--ms-w-bold); cursor: pointer; }
.threshold { display: grid; gap: var(--ms-space-1); font-size: var(--ms-t-md); }
.threshold input { inline-size: 100%; min-block-size: var(--ms-control-sm); accent-color: var(--ms-resolved-indicator, var(--ms-accent)); }
.subtle { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ms-space-2); }
/* The Schedule block (room-schedule.md §3, ported from mockups/plan.ts): the
   room card is its only border; groups are separated by space and a heading. */
.schedule { display: grid; gap: var(--ms-space-3); min-inline-size: 0; margin-block-start: var(--ms-space-2); }
.schedule-head { display: flex; align-items: center; gap: var(--ms-space-2); }
.schedule-head h3 { flex: 1; margin: 0; font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); }
/* Each row is a label line, a control line and a status line. */
.sched-row { display: grid; gap: var(--ms-space-1); justify-items: start; min-inline-size: 0; }
.sched-label { font-size: var(--ms-t-md); font-weight: var(--ms-w-medium); }
/* Row 2's level select (9 rem) leads and the stepper (170 px) follows on the
   same line when the content is at least 326 px wide, else it wraps below. */
.sched-controls { display: flex; flex-wrap: wrap; gap: var(--ms-space-3); align-items: center; }
.sched-level { flex: none; inline-size: 9rem; block-size: var(--ms-control); font-size: var(--ms-t-md); }
.sched-status { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
/* Reasons keep the text colour; the glyph carries the tone (design-system.md §5). */
.sched-reason { display: flex; gap: var(--ms-space-1); align-items: flex-start; color: var(--ms-text); }
.sched-reason .ms-icon { flex: none; inline-size: 1rem; block-size: 1rem; color: var(--ms-warning); }
.sched-off, .sched-row > .ms-btn { justify-self: start; }
/* "More for {room}": the plan tools' menu, anchored to the heading's end. */
.room-more { position: relative; }
.room-more .menu { position: absolute; z-index: 18; inset-block-start: calc(100% + var(--ms-space-1)); inset-inline-end: 0; display: grid; min-inline-size: 14rem; padding: var(--ms-space-1); }
.room-more .menu .ms-row { justify-content: flex-start; inline-size: 100%; }
.room-more .reason { padding: var(--ms-space-1) var(--ms-space-3); }
.ms-row--danger { color: var(--ms-resolved-danger-text, var(--ms-danger)); }
.room-more-divider { block-size: 1px; margin: var(--ms-space-1) var(--ms-space-2); background: var(--ms-line); }
/* Advanced: a 44 px disclosure with the ms-* chevron, opened without animation. */
.advanced > summary { display: flex; gap: var(--ms-space-2); align-items: center; min-block-size: var(--ms-control); font-weight: var(--ms-w-medium); list-style: none; cursor: pointer; }
.advanced > summary::-webkit-details-marker { display: none; }
.advanced > summary .ms-icon { inline-size: 1.25rem; block-size: 1.25rem; }
.advanced[open] > summary .ms-icon { rotate: 90deg; }
.advanced > summary:dir(rtl) .ms-icon { scale: -1 1; }
.advanced[open] > summary:dir(rtl) .ms-icon { rotate: -90deg; }
.advanced > summary:focus-visible { outline: 2px solid var(--ms-resolved-indicator, var(--ms-accent)); outline-offset: 2px; border-radius: var(--ms-radius-xs); }
.scope { display: grid; margin: 0 0 var(--ms-space-2); padding: 0; border: 0; }
.scope legend { padding: 0; font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
.scope-row { display: flex; gap: var(--ms-space-3); align-items: center; min-block-size: var(--ms-control); font-size: var(--ms-t-md); cursor: pointer; }
.scope-row input { flex: none; inline-size: 1.2rem; block-size: 1.2rem; margin: 0; accent-color: var(--ms-resolved-indicator, var(--ms-accent)); }
.schedule-note { margin: 0; color: var(--ms-text); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
/* A selected row is Highlight in forced colors; its open settings return to
   the system's own colours so their text stays readable. */
@media (forced-colors: active) { .problem { border: 1px solid CanvasText; } .row-expanded { forced-color-adjust: auto; color: CanvasText; background: Canvas; } .edit-row .row-lines small { color: inherit; } }
@media (max-width: 25rem) { .split { grid-template-columns: 1fr; } }
`];

  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    _moved: { state: true },
  };

  /** The last move, said once in the polite region (plan.md §5 Order). */
  protected _moved = "";
  /** The control a move or an area change was made from, focused again once the rows have moved. */
  #refocus: string | null = null;
  /** A vacuum rotation level chosen while the rotation is Off, by room: never a draft change. */
  readonly #offLevels = new Map<string, CoverageSetting>();
  /** The open room's "More for {room}" menu (room-schedule.md §3). */
  readonly #roomMenu = new MenuController(this, ".room-more", "> button");

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;

  readonly #t = (key: string, fallback: string, placeholders?: Readonly<Record<string, string | number>>): string =>
    translate(this.localize, key, fallback, placeholders);

  #intent(intent: WorkspaceIntent): void {
    this.dispatchEvent(new CustomEvent(WORKSPACE_INTENT_EVENT, { detail: intent, bubbles: true, composed: true }));
  }

  #count(value: number): string {
    return formatNumber(this.state.locale, value);
  }

  /** The tone lines under a row or a summary: the due work with the due glyph. */
  #lines(lines: readonly string[]) {
    return lines.length
      ? html`<span class="lines">${lines.map((line) => html`<span class="line">${icon(iconDue)}<span>${line}</span></span>`)}</span>`
      : nothing;
  }

  #planRow(plan: SavedPlan, isDefault: boolean) {
    // The home plan card shares these lines (home-rooms.md §5 Cards).
    const line2 = planRowLine2(this.#t, this.state.locale, plan);
    const third = planRowLine3(this.#t, this.state.locale, plan);
    // A paused plan shows one status, its chip (plan.md R2).
    const line3 = third === null
      ? nothing
      : "blocked" in third
        ? html`<span class="lines"><span class="line" data-tone="warning">${icon(iconNoticeWarning)}<span>${third.blocked}</span></span></span>`
        : this.#lines(third.due);
    const hint = this.#t("v4_plan_default_hint", "Home Assistant's plan button and plan select run this plan.");
    return html`<li>
      <button
        class="ms-row ms-row--card plan-row"
        type="button"
        data-plan-row=${plan.id}
        aria-describedby=${isDefault ? "default-hint" : nothing}
        @click=${() => this.#intent({ type: "select-plan", planId: plan.id })}
      >
        <span class="ms-row__body">
          <strong class="plan-title"><bdi>${plan.name}</bdi>${isDefault
            ? html`<span class="ms-chip chip-default" title=${hint}>${this.#t("v4_plan_default", "Default")}</span>`
            : nothing}${plan.enabled ? nothing : html`<span class="ms-chip">${this.#t("v4_paused", "Paused")}</span>`}</strong>
          <small><bdi dir="auto">${line2}</bdi></small>
          ${line3}
        </span>
        <span class="ms-row__trail">${icon(iconChevronRight)}</span>
      </button>
      ${isDefault ? html`<span class="sr-only" id="default-hint">${hint}</span>` : nothing}
    </li>`;
  }

  #picker() {
    const catalog = this.state.resources.plans.value;
    const create = this.#t("v4_create_plan", "Create a plan");
    if (!catalog?.plans.length) {
      return html`<div class="empty-card">
        <h3>${this.#t("v4_no_plans", "No plans yet")}</h3>
        <p>${this.#t("v4_no_plans_hint", "Save a plan to repeat a set of rooms.")}</p>
        <button class="ms-btn ms-btn--primary" type="button" @click=${() => this.#intent({ type: "select-plan", planId: null })}>${create}</button>
      </div>`;
    }
    // The default plan first, then the catalog's order (plan.md §3).
    const plans = [...catalog.plans].sort((a, b) => Number(b.id === catalog.selectedPlan) - Number(a.id === catalog.selectedPlan));
    return html`<ul class="plain">
      ${plans.map((plan) => this.#planRow(plan, plan.id === catalog.selectedPlan))}
      <li><button class="ms-row ms-row--card" type="button" @click=${() => this.#intent({ type: "select-plan", planId: null })}>
        <span class="ms-row__lead">${icon(iconPlus)}</span>
        <span class="ms-row__body"><strong>${create}</strong></span>
      </button></li>
    </ul>`;
  }

  #planChangeReason(): string {
    return this.state.planWriteBlock
      ? this.#t("v4_reason_plan_change_pending", "Waiting for Home Assistant to confirm the plan change.")
      : this.#t("v4_reason_plan_saving", "Waiting for Home Assistant to save the plan.");
  }

  /** Run's "Plan enabled" switch and why it is held (plan.md §5 Run switch, row RS). */
  #switchReason(): string | null {
    const state = this.state;
    if (state.pendingAction === "save-plan" || state.planWriteBlock) return this.#planChangeReason();
    if (state.pendingAction === "run-plan") return this.#t("v4_reason_run_plan_checking", "Waiting for Home Assistant to check the next run.");
    if (hasStoppableWork(state)) return this.#t("v4_reason_plan_switch_busy", "Can't change this until the robot finishes.");
    if (!state.host.connected || !state.host.robotConnected) {
      return this.#t("v4_reason_plan_switch_offline", "Waiting for Home Assistant to reach the robot again.");
    }
    return canEditCoordinates(state) ? null : this.#t("v4_reason_save_plan_map", "Waiting for the map to be ready.");
  }

  #switch() {
    const enabled = this.state.planDraft.enabled;
    const reason = this.#switchReason();
    return html`
      <div class="switch-row">
        <span class="switch-copy">
          <span id="enabled-label">${this.#t("v4_plan_can_run", "Plan enabled")}</span>
          <small id="enabled-hint">${this.#t("v4_plan_can_run_on", "When it's on, this plan can run from here, from automations and from Home Assistant actions.")}</small>
        </span>
        <button
          class="ms-switch"
          type="button"
          role="switch"
          aria-checked=${String(enabled)}
          aria-labelledby="enabled-label"
          aria-describedby=${reason ? "enabled-hint enabled-reason" : "enabled-hint"}
          aria-disabled=${reason ? "true" : nothing}
          @click=${() => { if (!reason) this.#intent({ type: "set-plan-enabled", enabled: !enabled }); }}
        ></button>
      </div>
      ${reason ? html`<p class="reason" id="enabled-reason">${reason}</p>` : nothing}
    `;
  }

  /** One Run row: the position in Saved order, the name, its setting, and "Needs attention" on the blocking room. */
  #runRow(name: string, setting: string, position: number | null, options: { readonly part?: number; readonly blocked?: boolean; readonly problem?: string | null } = {}) {
    return html`<li class="run-row" ?data-break=${options.part !== undefined}>
      ${options.part === undefined ? nothing : html`<span class="sr-only">${this.#t("v4_part_break", "Part {number} starts here; the robot may stop at the dock first", { number: this.#count(options.part) })}</span>`}
      ${position === null ? nothing : html`<span class="pos-badge" aria-hidden="true">${this.#count(position)}</span>`}
      <span class="row-lines">
        <bdi>${name}</bdi>
        <small>${setting}</small>
        ${options.problem ? html`<small class="problem">${options.problem}</small>` : nothing}
        ${options.blocked ? html`<span class="ms-chip chip-attention">${this.#t("v4_needs_attention", "Needs attention")}</span>` : nothing}
      </span>
    </li>`;
  }

  /** plan.md §3 Run view, rows R1-R4. */
  #run() {
    const state = this.state;
    const draft = state.planDraft;
    const catalog = state.resources.plans.value;
    const plan = catalog?.plans.find((candidate) => candidate.id === draft.id);
    if (!catalog || !plan) return nothing;
    const preview = plan.nextRunPreview;
    const blocker = preview?.blocker ?? null;
    const paused = !draft.enabled;
    const ready = !paused && Boolean(preview && !blocker && /^[0-9a-f]{64}$/u.test(preview.previewToken ?? ""));
    const ordered = plan.runBehavior === "ordered";
    const previewRooms = ready && preview ? preview.rooms : [];
    // The server preview orders every room and area; boundaries count both.
    const steps = ready && preview ? preview.steps ?? previewRooms : [];
    const areas = ready ? steps.length - previewRooms.length : planAreas(plan).length;
    const blockedRoom = !paused && blocker ? roomBlocker(state, plan)?.jump.roomId ?? null : null;
    // While a save is pending the preview is about to be read again, so it has no problem yet.
    const problem = paused || ready || blockedRoom || state.pendingAction === "save-plan"
      ? null
      : (blocker && PLAN_BLOCKERS[blocker]) || PLAN_PREVIEW;
    const count = ready ? previewRooms.length : plan.rooms.length;
    const seconds = ready ? plan.nextRunEstimateSeconds : null;
    const duration = seconds === null ? "" : formatDuration(state.locale, seconds);
    const rooms = count === 1
      ? this.#t("v4_plan_summary_rooms_one", "1 room")
      : this.#t("v4_plan_summary_rooms", "{count} rooms", { count: this.#count(count) });
    // A plan with a custom area has no estimate: the robot keeps no duration history for one.
    const summary = areas
      ? roomsAndAreas(this.#t, state.locale, count, areas)
      : seconds === null
        ? rooms
        : count === 1
          ? this.#t("v4_plan_summary_rooms_estimate_duration_one", "1 room · about {duration}", { duration })
          : this.#t("v4_plan_summary_rooms_estimate_duration", "{count} rooms · about {duration}", { count: this.#count(count), duration });
    const boundaries = ready && preview ? preview.missionBoundaries : [];
    const rows = ready
      ? steps.map((step, index) => {
        const part = boundaries.indexOf(index);
        return this.#runRow(step.name, settingLabel(this.#t, step), ordered ? index + 1 : null, part < 0 ? {} : { part: part + 2 });
      })
      : withPlanAreas(plan, draftForPlan(plan).rooms.map((room) => this.#runRow(
        catalog.rooms.find((candidate) => candidate.roomId === room.roomId)?.name ?? room.roomId,
        settingLabel(this.#t, room),
        null,
        { blocked: room.roomId === blockedRoom },
      )), (area) => this.#runRow(area.name, settingLabel(this.#t, area), null, {
        problem: problem && blocker === "area_map_changed" ? this.#areaProblem(area.areaId) : null,
      }));
    const end = draft.finishCurrentRoom
      ? this.#t("v4_plan_summary_finish", "Smart Stop finishes the room if you press Stop after {percent}% of its estimated time.", {
        percent: this.#count(draft.finishCurrentRoomThreshold),
      })
      : draft.returnToBase ? this.#t("v4_plan_summary_return", "Returns to the dock when finished") : null;
    return html`
      <p class="summary"><bdi dir="auto">${summary}</bdi></p>
      ${this.#lines(dueLines(this.#t, state.locale, previewRooms))}
      <h3 class="heading">${paused
        ? this.#t("v4_plan_rooms_heading", "In this plan")
        : state.resources.entry?.activePlan
          ? this.#t("v4_next_run_after_active", "After this run")
          : this.#t("v4_next_run_preview", "Next run")}</h3>
      ${ready && !ordered ? html`<p class="quiet">${this.#t("v4_plan_rotation_settings", "Smart Order cleans the rooms and areas that have waited longest first, checking again each time.")}</p>` : nothing}
      ${boundaries.length ? html`<p class="quiet">${this.#t("v4_room_parts", "The robot cleans in {count} parts and may stop at the dock between parts.", {
        count: this.#count(boundaries.length + 1),
      })}</p>` : nothing}
      ${problem ? html`<p class="problem">${this.#t(problem.reasonKey, problem.reason)}</p>
        ${blocker === "area_map_changed"
          ? html`<button class="ms-btn ms-btn--secondary" type="button" @click=${() => this.#intent({ type: "open-workflow", workflow: "areas" })}>${this.#t("v4_your_areas", "Your areas")}</button>`
          : html`<button class="ms-btn ms-btn--secondary" type="button" @click=${() => this.#intent({ type: "open-workflow", workflow: "plan" })}>${this.#t("v4_retry", "Try again")}</button>`}` : nothing}
      ${ready && ordered ? html`<ol class="run-list" role="list">${rows}</ol>` : html`<ul class="run-list" role="list">${rows}</ul>`}
      ${this.#switch()}
      ${end ? html`<p class="quiet">${end}</p>` : nothing}
      <div class="pin-setting">${homePinSwitch(this.#t, state, { kind: "plan", id: plan.id }, (intent) => this.#intent(intent))}</div>
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("state") && (this.state.workflow !== "plan" || this.state.planView !== "edit")) this._moved = "";
    // The menu belongs to the open room; it closes with it, and while a save holds Edit.
    const previous = changed.get("state") as WorkspaceState | undefined;
    if (previous && (previous.expandedRoom !== this.state.expandedRoom || this.state.planView !== "edit" || this.state.dialog || this.#held())) this.#roomMenu.open = false;
    // A level chosen while Off belongs to this draft: it is forgotten when
    // Edit is left (Cancel, Done), another plan opens, or the workflow changes.
    if (previous && (previous.planDraft.id !== this.state.planDraft.id || previous.workflow !== this.state.workflow || this.state.planView !== "edit")) this.#offLevels.clear();
  }

  // A keyed move re-inserts the row, which drops focus, so the arrow takes it
  // back once the moved draft arrives (not on the announcement's own render).
  // A custom area ticked or unticked moves between the lists: its checkbox
  // there takes focus, else the first checkbox of Edit.
  protected override updated(changed: PropertyValues<this>): void {
    if (!this.#refocus || !changed.has("state")) return;
    (this.renderRoot.querySelector<HTMLElement>(this.#refocus)
      ?? this.renderRoot.querySelector<HTMLElement>(".edit input[type=checkbox]"))?.focus();
    this.#refocus = null;
  }

  /** The id of the shared reason while a save holds every Edit control (plan.md §4 E5), else null. */
  #held(): string | null {
    return this.state.pendingAction === "save-plan" || this.state.planWriteBlock ? "edit-held" : null;
  }

  #patch(patch: Partial<WorkspaceState["planDraft"]>): void {
    if (!this.#held()) this.#intent({ type: "patch-plan-draft", patch });
  }

  #patchRoom(index: number, patch: Partial<PlanRoom>): void {
    this.#patch({ rooms: this.state.planDraft.rooms.map((room, at) => at === index ? { ...room, ...patch } : room) });
  }

  #patchArea(areaId: string, patch: Partial<PlanDraftArea>): void {
    this.#patch({ areas: this.state.planDraft.areas.map((area) => area.areaId === areaId ? { ...area, ...patch } : area) });
  }

  /**
   * Ticks a saved custom area into the plan, last in the run, or unticks one.
   * An unticked area keeps its settings until Save, as a room does, so
   * ticking it again restores them.
   */
  #toggleArea(areaId: string, saved?: SavedArea): void {
    const draft = this.state.planDraft;
    const parked = draft.parkedAreas ?? [];
    const others = (list: readonly PlanDraftArea[]) => list.filter((area) => area.areaId !== areaId);
    const area = draft.areas.find((candidate) => candidate.areaId === areaId);
    if (this.#held()) return;
    if (area) {
      this.#refocus = `[data-area-add="${CSS.escape(areaId)}"]`;
      this.#patch({ areas: others(draft.areas), parkedAreas: [...others(parked), area] });
      return;
    }
    if (!saved || draft.areas.length >= MAX_PLAN_AREAS) return;
    const kept = parked.find((candidate) => candidate.areaId === areaId);
    this.#refocus = `[data-area-check="${CSS.escape(areaId)}"]`;
    this.#patch({
      areas: [...draft.areas, {
        areaId,
        name: saved.name,
        cleaningMode: kept?.cleaningMode ?? saved.cleaningMode,
        coverageSetting: kept?.coverageSetting ?? saved.coverageSetting,
        slot: draft.rooms.length,
      }],
      parkedAreas: others(parked),
    });
  }

  /**
   * One place earlier or later in the run, rooms and custom areas alike;
   * focus stays on the arrow and the move is said once.
   */
  #move(index: number, delta: number, moved: (position: string) => string, arrow: string): void {
    const draft = this.state.planDraft;
    const steps = draftSteps(draft);
    const next = index + delta;
    if (this.#held() || next < 0 || next >= steps.length) return;
    const [step] = steps.splice(index, 1);
    if (!step) return;
    steps.splice(next, 0, step);
    this.#refocus = `[data-move="${CSS.escape(arrow)}"]`;
    this._moved = moved(this.#count(next + 1));
    const { rooms, areas } = fromSteps(steps);
    this.#intent({ type: "patch-plan-draft", patch: draft.areas.length ? { rooms, areas } : { rooms } });
  }

  /** A form control's hold: aria-disabled and the shared reason while a save runs. */
  #gate(held: string | null) {
    return { disabled: held ? "true" : nothing, described: held ?? nothing };
  }

  /** A move arrow; `key` is the room's ID, or "area:" and the custom area's. */
  #arrow(key: string, index: number, name: string, delta: -1 | 1, end: boolean, held: string | null, area = false) {
    const id = `${key}:${delta < 0 ? "up" : "down"}`;
    const label = area
      ? delta < 0
        ? this.#t("v4_move_area_up", "Move {area} earlier", { area: name })
        : this.#t("v4_move_area_down", "Move {area} later", { area: name })
      : delta < 0
        ? this.#t("move_room_up", "Move {room} earlier", { room: name })
        : this.#t("move_room_down", "Move {room} later", { room: name });
    const at = area
      ? delta < 0
        ? this.#t("v4_area_already_first", "{area} is already first", { area: name })
        : this.#t("v4_area_already_last", "{area} is already last", { area: name })
      : delta < 0
        ? this.#t("v4_room_already_first", "{room} is already first", { room: name })
        : this.#t("v4_room_already_last", "{room} is already last", { room: name });
    const moved = area
      ? (position: string) => this.#t("v4_area_moved", "{area} moved to position {position}", { area: name, position })
      : (position: string) => this.#t("v4_room_moved", "{room} moved to position {position}", { room: name, position });
    const reason = end ? `${id}-end` : held;
    return html`<button
        class="ms-btn ms-btn--icon"
        type="button"
        data-move=${id}
        aria-label=${label}
        title=${end ? at : label}
        aria-disabled=${end || held ? "true" : nothing}
        aria-describedby=${reason ?? nothing}
        @click=${() => { if (!end) this.#move(index, delta, moved, id); }}
      >${icon(delta < 0 ? iconMoveUp : iconMoveDown)}</button>
      ${end ? html`<span class="sr-only" id=${`${id}-end`}>${at}</span>` : nothing}`;
  }

  /**
   * One Edit room row (plan.md §3 Edit room row). `index` is the room's place
   * in the draft's rooms, `position` its place in the run with the plan's
   * custom areas, and `last` the run's last place.
   */
  #editRow(roomId: string, name: string, room: PlanRoom | null, index: number, position: number, last: number, ordered: boolean, atLimit: boolean, held: string | null) {
    const open = room !== null && this.state.expandedRoom === roomId;
    const gate = this.#gate(held);
    const limited = room === null && atLimit;
    const schedule = room ? scheduleLine(this.#t, this.state.locale, room.cadence) : null;
    const blocked = room?.cadenceReasons?.some((reason) => BLOCKING.includes(reason));
    // While the mop schedule is on, the mode stays Vacuum (room-schedule.md §4 S10).
    const modeLocked = Boolean(room?.cadence?.mopEveryN);
    return html`<li class="ms-row edit-row" data-selected=${room ? "true" : nothing}>
      <label class="edit-check"><input
        type="checkbox"
        .checked=${room !== null}
        aria-label=${this.#t("v4_room_include_named", "Include {room}", { room: name })}
        aria-disabled=${held || limited ? "true" : nothing}
        aria-describedby=${held ?? (limited ? "room-limit" : nothing)}
        @click=${(event: Event) => { if (held || limited) event.preventDefault(); }}
        @change=${() => this.#intent({ type: "toggle-room", roomId })}
      ></label>
      ${room ? html`<button
          class="edit-disclosure"
          type="button"
          data-room-disclosure=${roomId}
          aria-expanded=${String(open)}
          aria-label=${this.#t("v4_room_settings_named", "Settings for {room}", { room: name })}
          aria-disabled=${gate.disabled}
          aria-describedby=${gate.described}
          @click=${() => { if (!held) this.#intent({ type: "set-plan-view", view: "edit", roomId: open ? null : roomId }); }}
        >
          ${ordered ? html`<span class="pos-badge" aria-hidden="true">${this.#count(position + 1)}</span>` : nothing}
          <span class="row-lines">
            <bdi>${name}</bdi>
            <small>${settingLabel(this.#t, room)}</small>
            ${schedule ? html`<small>${schedule}</small>` : nothing}
            ${blocked ? html`<span class="ms-chip chip-attention">${this.#t("v4_needs_attention", "Needs attention")}</span>` : nothing}
          </span>
          ${icon(iconChevronRight)}
        </button>` : html`<span class="edit-name"><bdi>${name}</bdi></span>`}
      ${room && ordered ? html`<span class="edit-moves">
        ${this.#arrow(roomId, position, name, -1, position === 0, held)}
        ${this.#arrow(roomId, position, name, 1, position === last, held)}
      </span>` : html`<span></span>`}
      ${open && room ? html`<div class="row-expanded">
        <div class="split">
          <label class="field ms-field">${this.#t("v4_cleaning_system", "Cleaning mode")}
            <select
              aria-label=${this.#t("v4_room_cleaning_system_named", "Cleaning mode for {room}", { room: name })}
              aria-disabled=${gate.disabled}
              aria-describedby=${[held, modeLocked ? "mode-reason" : null].filter(Boolean).join(" ") || nothing}
              .value=${room.cleaningMode}
              @change=${(event: Event) => {
                const select = event.currentTarget as HTMLSelectElement;
                if (held) select.value = room.cleaningMode;
                else this.#patchRoom(index, { cleaningMode: select.value as CleaningMode });
              }}
            >${MODES.map((mode) => html`<option value=${mode} ?selected=${mode === room.cleaningMode} ?disabled=${modeLocked && mode !== "vacuum"}>${modeLabel(this.#t, mode)}</option>`)}</select>
          </label>
          ${room.cleaningMode === "mop" ? nothing : html`<label class="field ms-field">${this.#t("vacuum_coverage", "Vacuum coverage")}
            <select
              aria-label=${this.#t("v4_room_vacuum_coverage_named", "Vacuum coverage for {room}", { room: name })}
              aria-disabled=${gate.disabled}
              aria-describedby=${gate.described}
              .value=${room.coverageSetting}
              @change=${(event: Event) => {
                const select = event.currentTarget as HTMLSelectElement;
                if (held) select.value = room.coverageSetting;
                else this.#patchRoom(index, { coverageSetting: select.value as CoverageSetting });
              }}
            >${COVERAGES.map((option) => html`<option value=${option} ?selected=${option === room.coverageSetting}>${coverageLabel(this.#t, option)}</option>`)}</select>
          </label>`}
        </div>
        ${modeLocked ? html`<p class="schedule-note" id="mode-reason"><span>${this.#t("v4_cadence_clear_mop_to_change_normal", "Turn the mopping schedule off to change the cleaning mode.")}</span></p>` : nothing}
        ${mopControl(this.#t, this.state, room.cadence?.mopEveryN ? "vacuum_and_mop" : room.cleaningMode, `plan-room-${index}`)}
        ${scheduleBlock({
          t: this.#t,
          state: this.state,
          intent: (intent) => this.#intent(intent),
          held,
          offLevel: this.#offLevels.get(roomId) ?? null,
          setOffLevel: (level) => {
            if (level) this.#offLevels.set(roomId, level);
            else this.#offLevels.delete(roomId);
            this.requestUpdate();
          },
          menu: this.#roomMenu,
        }, room, index, name)}
      </div>` : nothing}
    </li>`;
  }

  /** A run-end switch (plan.md §3 When a run ends). */
  #endSwitch(id: string, label: string, hint: string | null, on: boolean, held: string | null, change: (on: boolean) => void) {
    const described = [hint ? `${id}-hint` : "", held ?? ""].filter(Boolean).join(" ");
    return html`<div class="switch-row">
      <span class="switch-copy">
        <span id=${`${id}-label`}>${label}</span>
        ${hint ? html`<small id=${`${id}-hint`}>${hint}</small>` : nothing}
      </span>
      <button
        class="ms-switch"
        type="button"
        role="switch"
        aria-checked=${String(on)}
        aria-labelledby=${`${id}-label`}
        aria-describedby=${described || nothing}
        aria-disabled=${held ? "true" : nothing}
        @click=${() => { if (!held) change(!on); }}
      ></button>
    </div>`;
  }

  /**
   * What a custom area in the plan needs before it can clean, as Your areas
   * says it: a check after the map changed or a redraw; one the saved areas
   * don't hold is taken out. Null while the saved areas are unknown.
   */
  #areaProblem(areaId: string): string | null {
    const known = this.state.resources.areas.value?.areas;
    const area = known?.find((candidate) => candidate.id === areaId);
    if (!known || area?.status === "current") return null;
    return !area
      ? this.#t("v4_plan_area_missing", "Not found · Remove it from this plan")
      : area.canRebind || area.status === "review"
        ? this.#t("v4_area_row_check", "Map changed · Check it before cleaning")
        : this.#t("v4_area_row_redraw", "Redraw it before cleaning");
  }

  /**
   * One custom area in Edit's run list: as a room row, with its cleaning mode
   * and vacuum coverage and no room schedule, since an area runs every time.
   */
  #areaRow(area: PlanDraftArea, position: number, last: number, ordered: boolean, held: string | null) {
    const key = `area:${area.areaId}`;
    const name = this.state.resources.areas.value?.areas.find((candidate) => candidate.id === area.areaId)?.name ?? area.name;
    const open = this.state.expandedRoom === key;
    const gate = this.#gate(held);
    const problem = this.#areaProblem(area.areaId);
    const problemId = `${key}-problem`;
    const described = [held, problem ? problemId : null].filter(Boolean).join(" ") || nothing;
    return html`<li class="ms-row edit-row" data-selected="true" data-plan-area=${area.areaId}>
      <label class="edit-check"><input
        type="checkbox"
        data-area-check=${area.areaId}
        .checked=${true}
        aria-label=${this.#t("v4_area_include_named", "Include {area}", { area: name })}
        aria-disabled=${gate.disabled}
        aria-describedby=${gate.described}
        @click=${(event: Event) => { if (held) event.preventDefault(); }}
        @change=${() => this.#toggleArea(area.areaId)}
      ></label>
      <button
        class="edit-disclosure"
        type="button"
        data-room-disclosure=${key}
        aria-expanded=${String(open)}
        aria-label=${this.#t("v4_area_settings_named", "Settings for {area}", { area: name })}
        aria-disabled=${gate.disabled}
        aria-describedby=${described}
        @click=${() => { if (!held) this.#intent({ type: "set-plan-view", view: "edit", roomId: open ? null : key }); }}
      >
        ${ordered ? html`<span class="pos-badge" aria-hidden="true">${this.#count(position + 1)}</span>` : nothing}
        <span class="row-lines">
          <bdi>${name}</bdi>
          <small>${settingLabel(this.#t, area)}</small>
          <small>${this.#t("v4_plan_area_every_run", "Custom area · Every run")}</small>
          ${problem ? html`<span class="ms-chip chip-attention">${this.#t("v4_needs_attention", "Needs attention")}</span>
            <small id=${problemId}>${problem}</small>` : nothing}
        </span>
        ${icon(iconChevronRight)}
      </button>
      ${ordered ? html`<span class="edit-moves">
        ${this.#arrow(key, position, name, -1, position === 0, held, true)}
        ${this.#arrow(key, position, name, 1, position === last, held, true)}
      </span>` : html`<span></span>`}
      ${open ? html`<div class="row-expanded">
        <div class="split">
          <label class="field ms-field">${this.#t("v4_cleaning_system", "Cleaning mode")}
            <select
              aria-label=${this.#t("v4_area_cleaning_mode_named", "Cleaning mode for {area}", { area: name })}
              aria-disabled=${gate.disabled}
              aria-describedby=${gate.described}
              .value=${area.cleaningMode}
              @change=${(event: Event) => {
                const select = event.currentTarget as HTMLSelectElement;
                if (held) select.value = area.cleaningMode;
                else this.#patchArea(area.areaId, { cleaningMode: select.value as CleaningMode });
              }}
            >${MODES.map((mode) => html`<option value=${mode} ?selected=${mode === area.cleaningMode}>${modeLabel(this.#t, mode)}</option>`)}</select>
          </label>
          ${area.cleaningMode === "mop" ? nothing : html`<label class="field ms-field">${this.#t("vacuum_coverage", "Vacuum coverage")}
            <select
              aria-label=${this.#t("v4_area_vacuum_coverage_named", "Vacuum coverage for {area}", { area: name })}
              aria-disabled=${gate.disabled}
              aria-describedby=${gate.described}
              .value=${area.coverageSetting}
              @change=${(event: Event) => {
                const select = event.currentTarget as HTMLSelectElement;
                if (held) select.value = area.coverageSetting;
                else this.#patchArea(area.areaId, { coverageSetting: select.value as CoverageSetting });
              }}
            >${COVERAGES.map((option) => html`<option value=${option} ?selected=${option === area.coverageSetting}>${coverageLabel(this.#t, option)}</option>`)}</select>
          </label>`}
        </div>
        ${mopControl(this.#t, this.state, area.cleaningMode, `plan-area-${position}`)}
      </div>` : nothing}
    </li>`;
  }

  /**
   * Edit's Custom areas: the saved areas on this map that are ready to clean
   * and not in the plan yet. Ticking one adds it last in the run; it then
   * moves to the run list above, where it is ordered and set like a room.
   */
  #areaChoices(held: string | null) {
    const draft = this.state.planDraft;
    const known = this.state.resources.areas.value?.areas;
    if (!known?.length && !draft.areas.length) return nothing;
    const choices = (known ?? []).filter((area) => area.status === "current"
      && !draft.areas.some((candidate) => candidate.areaId === area.id));
    const atLimit = draft.areas.length >= MAX_PLAN_AREAS;
    return html`
      <h3 class="heading" id="edit-areas">${this.#t("v4_plan_areas_heading", "Custom areas")}</h3>
      <p class="quiet">${choices.length
        ? this.#t("v4_plan_areas_add_hint", "Choose a custom area to clean it every time this plan runs.")
        : this.#t("v4_plan_areas_none", "No other custom areas are ready to add. Draw or redraw one in Your areas.")}</p>
      ${atLimit ? html`<p class="reason" id="area-limit">${this.#t("v4_plan_area_limit", "Can't add more custom areas until you remove one; a plan holds up to {limit}.", {
        limit: this.#count(MAX_PLAN_AREAS),
      })}</p>` : nothing}
      ${choices.length ? html`<ul class="plain" role="list" aria-labelledby="edit-areas">
        ${repeat(choices, (area) => area.id, (area) => html`<li class="ms-row edit-row">
          <label class="edit-check"><input
            type="checkbox"
            data-area-add=${area.id}
            .checked=${false}
            aria-label=${this.#t("v4_area_include_named", "Include {area}", { area: area.name })}
            aria-disabled=${held || atLimit ? "true" : nothing}
            aria-describedby=${held ?? (atLimit ? "area-limit" : nothing)}
            @click=${(event: Event) => { if (held || atLimit) event.preventDefault(); }}
            @change=${() => this.#toggleArea(area.id, area)}
          ></label>
          <span class="edit-name"><bdi>${area.name}</bdi><small>${settingLabel(this.#t, area)}</small></span>
          <span></span>
        </li>`)}
      </ul>` : nothing}
    `;
  }

  /** plan.md §3 Edit view. */
  #edit() {
    const state = this.state;
    const draft = state.planDraft;
    const catalog = state.resources.plans.value;
    if (!catalog) return nothing;
    const held = this.#held();
    const gate = this.#gate(held);
    const ordered = draft.runBehavior === "ordered";
    const atLimit = draft.rooms.length >= MAX_ROOM_SEQUENCE_SIZE;
    const nameOf = (roomId: string): string => catalog.rooms.find((room) => room.roomId === roomId)?.name ?? roomId;
    // The run in order, rooms and custom areas, then the rooms left out.
    const steps = draftSteps(draft);
    const last = steps.length - 1;
    const rows = [
      ...steps.map(({ room, area }, position) => room
        ? { key: room.roomId, room, area, index: draft.rooms.indexOf(room), position }
        : { key: `area:${area.areaId}`, room: null, area, index: -1, position }),
      ...catalog.rooms
        .filter((room) => !draft.rooms.some((candidate) => candidate.roomId === room.roomId))
        .map((room) => ({ key: room.roomId, room: null, area: undefined, index: -1, position: -1 })),
    ];
    const areas = draft.areas.length;
    const threshold = draft.finishCurrentRoomThreshold;
    const percent = this.#count(threshold);
    const order = (value: "intelligent" | "ordered", label: string) => html`<button
      class="ms-btn"
      type="button"
      aria-pressed=${String(draft.runBehavior === value)}
      aria-disabled=${gate.disabled}
      aria-describedby=${gate.described}
      @click=${() => this.#patch({ runBehavior: value })}
    >${label}</button>`;
    return html`<div class="edit">
      ${held ? html`<p class="reason" id="edit-held">${this.#planChangeReason()}</p>` : nothing}
      <label class="field ms-field">${this.#t("plan_name", "Plan name")}
        <input
          maxlength="128"
          autocomplete="off"
          ?readonly=${Boolean(held)}
          aria-disabled=${gate.disabled}
          aria-describedby=${gate.described}
          .value=${draft.name}
          @input=${(event: Event) => this.#patch({ name: (event.currentTarget as HTMLInputElement).value })}
        >
      </label>
      <div class="order" role="group" aria-labelledby="order-label">
        <span id="order-label">${this.#t("plan_run_behavior", "Cleaning order")}</span>
        <div class="ms-segment">
          ${order("intelligent", this.#t("plan_intelligent", "Smart Order"))}
          ${order("ordered", this.#t("plan_ordered", "Saved order"))}
        </div>
        <p class="quiet">${ordered
          ? this.#t("v4_plan_order_ordered_hint", "Top to bottom, as listed")
          : this.#t("v4_plan_order_intelligent_hint", "Longest-waiting first")}</p>
        ${areas && !ordered ? html`<p class="quiet">${this.#t("v4_plan_areas_rotation_hint", "Smart Order chooses the longest-waiting rooms and areas first. Saved order follows your list.")}</p>` : nothing}
      </div>
      <div class="list-header">
        <h3 class="heading" id="edit-rooms">${areas
          ? this.#t("v4_plan_steps_heading", "Rooms and custom areas")
          : this.#t("v4_rooms_heading", "Rooms")}</h3>
        <small><bdi dir="auto">${areas
          ? roomsAndAreas(this.#t, state.locale, draft.rooms.length, areas)
          : this.#t("v4_plan_rooms_selected", "{selected} of {total} selected", {
            selected: this.#count(draft.rooms.length),
            total: this.#count(catalog.rooms.length),
          })}</bdi></small>
      </div>
      ${atLimit ? html`<p class="reason" id="room-limit">${this.#t("v4_plan_room_limit", "Can't add more rooms until you remove one; a plan holds up to {limit}.", {
        limit: this.#count(MAX_ROOM_SEQUENCE_SIZE),
      })}</p>` : nothing}
      <ul class="plain" role="list" aria-labelledby="edit-rooms">
        ${repeat(rows, (row) => row.key, (row) => row.area
          ? this.#areaRow(row.area, row.position, last, ordered, held)
          : this.#editRow(row.key, nameOf(row.key), row.room, row.index, row.position, last, ordered, atLimit, held))}
      </ul>
      ${this.#areaChoices(held)}
      <span class="sr-only" role="status">${this._moved}</span>
      <details class="run-end">
        <summary>${this.#t("v4_run_end_options", "When a run ends")}</summary>
        ${this.#endSwitch("return-dock", this.#t("v4_plan_return_to_dock", "Return to the dock when finished"), null, draft.returnToBase, held,
          (on) => this.#patch({ returnToBase: on }))}
        ${this.#endSwitch("finish-room", this.#t("v4_plan_finish_room", "Smart Stop"),
          this.#t("v4_plan_finish_room_hint", "When you press Stop, finish the room if it's reached {percent}% of its estimated time. Areas and rooms without an estimate finish first. You can still stop now and dock.", { percent }),
          draft.finishCurrentRoom, held, (on) => this.#patch({ finishCurrentRoom: on }))}
        ${draft.finishCurrentRoom ? html`<div class="threshold">
          <span id="finish-threshold-label">${this.#t("v4_plan_finish_threshold", "Finish after {percent}% of estimated room time", { percent })}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            aria-labelledby="finish-threshold-label"
            aria-valuetext=${`${percent}%`}
            aria-disabled=${gate.disabled}
            aria-describedby=${gate.described}
            .value=${String(threshold)}
            @input=${(event: Event) => {
              const input = event.currentTarget as HTMLInputElement;
              if (held) input.value = String(threshold);
              else this.#patch({ finishCurrentRoomThreshold: Number(input.value) });
            }}
          >
        </div>` : nothing}
      </details>
    </div>`;
  }

  protected override render() {
    const { workflow, planView } = this.state;
    return workflow === "plans" ? this.#picker() : workflow !== "plan" ? nothing : planView === "run" ? this.#run() : this.#edit();
  }
}

if (!customElements.get(PLAN_VIEWS_TAG)) customElements.define(PLAN_VIEWS_TAG, MaticPlanViewsV4);
