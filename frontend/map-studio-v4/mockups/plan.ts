import { css, html, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import type { CleaningMode, CoverageSetting, PlanRoom, SavedPlan } from "../backend-contracts";
import { iconChevronRight, iconMoveDown, iconMoveUp, iconOverflow, iconPlus } from "../icons";
import { syntheticMockupFloor } from "../synthetic-fixtures";
import {
  ROTATION_LEVEL,
  levelWord,
  mopLabel,
  nextCleanLabel,
  num,
  roomSetting,
  rotationLabel,
  scheduleText,
  t,
  type RotationLevel,
} from "./copy";
import {
  MockScreen,
  chip,
  dueBlock,
  glyph,
  screenStyles,
  type MockAction,
  type ShellView,
} from "./frame";
import { glyphAlert, glyphMinus } from "./glyphs";
import { STATUS } from "./home";
import {
  CATALOG,
  DEFAULT_PLAN_ID,
  canBringForward,
  dueLines,
  orderFor,
  planById,
  planLine,
  planLine3,
  previewRooms,
  progressFor,
  roomName,
  runSummary,
  statusLine,
} from "./plan-data";

const planCss = css`
.plan-row .ms-row__body { display: grid; gap: 0.125rem; }
.plan-row .plan-title { display: flex; flex-wrap: wrap; gap: var(--ms-space-1) var(--ms-space-2); align-items: center; min-inline-size: 0; }
.plan-row .plan-title bdi { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-row .ms-row__body .warn-line { color: var(--ms-text); }
.empty-card { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-4); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); }
.empty-card h3 { margin: 0; font-size: var(--ms-t-md); }
.empty-card p { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-md); line-height: var(--ms-lh-normal); }
.empty-card .ms-btn { justify-self: start; }
.heading-text { display: inline; }
.heading-edit { flex: none; }
.run-summary { margin: 0 0 var(--ms-space-2); color: var(--ms-text-quiet); font-size: var(--ms-t-md); line-height: var(--ms-lh-snug); }
.run-caption { margin: 0 0 var(--ms-space-2); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
/* plan.md §3 Run: the due lines sit directly under the summary. */
.run-due { margin: 0 0 var(--ms-space-3); }
.run-list { gap: 0; margin-block-end: var(--ms-space-4); }
.run-row { display: flex; gap: var(--ms-space-3); align-items: flex-start; padding-block: var(--ms-space-2); border-block-end: 1px solid var(--ms-line); }
.run-row:last-child { border-block-end: 0; }
.run-row[data-break] { position: relative; margin-block-start: var(--ms-space-3); border-block-start: 2px dashed var(--ms-line-strong); padding-block-start: var(--ms-space-3); }
.run-row .row-lines { flex: 1; }
.enable-row { margin-block: var(--ms-space-2); }
.end-lines { display: grid; gap: var(--ms-space-1); margin-block-start: var(--ms-space-2); }
/* plan.md §3 Edit: the slider's label shows the live value and names it. */
.threshold-row { display: grid; gap: var(--ms-space-1); font-size: var(--ms-t-md); }
.edit-list { margin-block-start: var(--ms-space-1); }
.edit-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; padding: 0; }
/* plan.md §3: the "Include {room}" checkbox is its own 44 × 44 target; its <label> is the hit box. */
.edit-check { display: grid; place-items: center; inline-size: var(--ms-control); block-size: var(--ms-control); cursor: pointer; }
.edit-check input { inline-size: var(--ms-icon); block-size: var(--ms-icon); margin: 0; accent-color: var(--ms-indicator); cursor: pointer; }
.edit-check:has(:focus-visible) { outline: 2px solid var(--ms-indicator); outline-offset: -2px; border-radius: var(--ms-radius-sm); }
.edit-check input:focus-visible { outline: none; }
.edit-disclosure { display: flex; gap: var(--ms-space-2); align-items: center; min-inline-size: 0; min-block-size: var(--ms-control); padding: var(--ms-space-2) var(--ms-space-1); border: 0; border-radius: var(--ms-radius-sm); color: inherit; background: transparent; text-align: start; cursor: pointer; font-size: var(--ms-t-md); }
.edit-disclosure:focus-visible { outline: 2px solid var(--ms-indicator); outline-offset: -2px; }
.edit-disclosure .row-lines { flex: 1; }
.edit-name { padding-inline: var(--ms-space-1); font-size: var(--ms-t-md); }
.edit-moves { display: flex; }
.edit-row:not([data-selected]) { --ms-local: var(--ms-surface-card); }
.edit-row .row-expanded { border-block-start: 1px solid var(--ms-line); padding-block-start: var(--ms-space-3); }
.more-options .ms-disclosure, .advanced .ms-disclosure { padding-inline: 0; }
.more-options { margin-block-start: var(--ms-space-4); }
.ms-section-heading.sub { margin: 0; }
.schedule { display: grid; gap: var(--ms-space-3); }
.schedule-head { display: flex; align-items: center; gap: var(--ms-space-2); }
.schedule-head h3 { flex: 1; margin: 0; font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); }
/* room-schedule.md §3, §7: both rows are a label line, a control line and a status line. */
.sched-row { display: grid; gap: var(--ms-space-1); justify-items: start; }
.sched-label { font-size: var(--ms-t-md); font-weight: var(--ms-w-medium); }
/* The control line: row 2's level select (9 rem, 44 px) leads, and the stepper follows on the same
   line where the content is at least 9 rem + 12 px + 170 px = 326 px wide, else it wraps below. */
.sched-controls { display: flex; flex-wrap: wrap; gap: var(--ms-space-3); align-items: center; }
.sched-level { inline-size: 9rem; flex: none; font-size: var(--ms-t-md); }
.sched-status { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.sched-status.reason { display: flex; gap: var(--ms-space-1); color: var(--ms-text); }
.sched-status.reason .ms-icon { inline-size: 1rem; block-size: 1rem; color: var(--ms-warning); }
.schedule-note { margin: 0; font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.scope { display: grid; gap: 0; margin: 0; padding: 0; border: 0; }
.scope legend { padding: 0; }
.scope .ms-check { padding-inline: 0; }
`;

// ---- Picker (plan.md §3 Picker) ----------------------------------------------------

export class MockPlans extends MockScreen {
  static override styles = [...screenStyles, planCss];

  #row(plan: SavedPlan): TemplateResult {
    const order = orderFor(plan, this.variants, DEFAULT_PLAN_ID);
    const line3 = planLine3(plan, this.variants, DEFAULT_PLAN_ID);
    const target = plan.id === "weekend" ? "parts" : plan.enabled ? "ready" : "paused";
    return html`<li><button class="ms-row ms-row--card plan-row" type="button" @click=${() => this.emit({ screen: "plan", view: "run", state: target, origin: "plans" })}>
      <span class="ms-row__body">
        <strong class="plan-title"><bdi>${plan.name}</bdi>${plan.id === CATALOG.selectedPlan ? chip(t("v4_plan_default")) : nothing}${!plan.enabled ? chip(t("v4_paused"), "neutral") : nothing}</strong>
        <small>${planLine(plan, order)}</small>
        ${line3 === null
          ? nothing
          : "blocked" in line3
            ? html`<small class="warn-line">${glyph(glyphAlert)}<span>${line3.blocked}</span></small>`
            : dueBlock(line3.due)}
      </span>
      <span class="ms-row__trail">${glyph(iconChevronRight, true)}</span>
    </button></li>`;
  }

  protected override view(): ShellView {
    const empty = this.mockState === "empty";
    const plans = [...CATALOG.plans].sort((a, b) => Number(b.id === CATALOG.selectedPlan) - Number(a.id === CATALOG.selectedPlan));
    const body = empty
      ? html`<div class="empty-card">
          <h3>${t("v4_no_plans")}</h3>
          <p>${t("v4_no_plans_hint")}</p>
          <button class="ms-btn ms-btn--primary" type="button">${t("v4_create_plan")}</button>
        </div>`
      : html`<p class="panel-description">${t("v4_choose_plan_detail")}</p>
        <ul class="mock-stack">
          ${plans.map((plan) => this.#row(plan))}
          <li><button class="ms-row ms-row--card" type="button" @click=${() => this.emit({ screen: "plan", view: "edit", state: "new" })}>
            <span class="ms-row__lead">${glyph(iconPlus)}</span>
            <span class="ms-row__body"><strong>${t("v4_create_plan")}</strong></span>
          </button></li>
        </ul>`;
    return {
      workflow: "plans",
      status: STATUS.ready,
      back: { label: t("v4_back_to_all_tasks"), kind: "secondary", change: { screen: "home", state: "h1" } },
      heading: t("v4_your_plans"),
      body,
      map: { mode: "map", robot: "dock" },
    };
  }
}

// ---- Run and Edit (plan.md §3–§5) ------------------------------------------------------

const modeSelect = (label: string, value: CleaningMode): TemplateResult => html`<label class="ms-field">${label}
  <select .value=${value}>
    <option value="vacuum">${t("vacuum")}</option>
    <option value="mop">${t("mop")}</option>
    <option value="vacuum_and_mop">${t("vacuum_and_mop")}</option>
  </select>
</label>`;

const coverageSelect = (label: string, value: CoverageSetting): TemplateResult => html`<label class="ms-field">${label}
  <select .value=${value}>
    <option value="quick">${t("quick")}</option>
    <option value="standard">${t("standard")}</option>
    <option value="heavy_duty">${t("heavy_duty")}</option>
  </select>
</label>`;

/** A switch named by its visible label, described by its hint. */
const switchRow = (id: string, label: string, hint: string | null, checked: boolean, options: { readonly readonly?: boolean } = {}): TemplateResult => html`<div class="switch-row">
  <span class="switch-copy"><span id=${`${id}-label`}>${label}</span>${hint ? html`<small id=${`${id}-hint`}>${hint}</small>` : nothing}</span>
  <button
    class="ms-switch"
    type="button"
    role="switch"
    aria-checked=${String(checked)}
    aria-readonly=${options.readonly ? "true" : nothing}
    aria-labelledby=${`${id}-label`}
    aria-describedby=${hint ? `${id}-hint` : nothing}
  ></button>
</div>`;

interface StepperOptions {
  readonly id: string;
  readonly label: string;
  readonly value: number | null;
  readonly readonly?: boolean;
  readonly status?: string | null;
  readonly reason?: string;
  readonly reset?: string;
  /** room-schedule.md §3: row 2's level select leads the control line, before the stepper. */
  readonly level?: TemplateResult;
}

const stepperRow = (options: StepperOptions): TemplateResult => {
  const { id, label, value } = options;
  const labelId = `${id}-label`;
  const atOff = value === null;
  const atMax = value === 100;
  const minReason = atOff ? t("v4_cadence_stepper_off_reason") : undefined;
  const maxReason = atMax ? t("v4_cadence_stepper_max_reason") : undefined;
  const describedBy = options.reason ? `${id}-status` : options.status ? `${id}-status` : undefined;
  const field = html`<input
    id=${id}
    type="number"
    inputmode="numeric"
    min="1"
    max="100"
    step="1"
    ?readonly=${Boolean(options.readonly)}
    .value=${value === null ? "" : String(value)}
    placeholder=${t("v4_cadence_off")}
    aria-labelledby=${labelId}
    aria-describedby=${describedBy ?? nothing}
  >`;
  return html`<div class="sched-row">
    <span class="sched-label" id=${labelId}>${label}</span>
    <div class="sched-controls">
    ${options.level ?? nothing}
    ${options.readonly
      ? html`<span class="ms-stepper ms-stepper--readonly">${field}</span>`
      : html`<span class="ms-stepper">
        <button
          class="ms-btn ms-btn--icon"
          type="button"
          aria-label=${t("v4_stepper_decrease", { label })}
          aria-controls=${id}
          aria-disabled=${minReason ? "true" : nothing}
          aria-describedby=${minReason ? `${id}-min` : nothing}
          title=${minReason ?? nothing}
        >${glyph(glyphMinus)}</button>
        ${field}
        <button
          class="ms-btn ms-btn--icon"
          type="button"
          aria-label=${t("v4_stepper_increase", { label })}
          aria-controls=${id}
          aria-disabled=${maxReason ? "true" : nothing}
          aria-describedby=${maxReason ? `${id}-max` : nothing}
          title=${maxReason ?? nothing}
        >${glyph(iconPlus)}</button>
      </span>`}
    </div>
    ${options.reason
      ? html`<small class="sched-status reason" id=${`${id}-status`}>${glyph(glyphAlert)}<span>${options.reason}</span></small>
        ${options.reset ? html`<button class="ms-btn ms-btn--secondary" type="button">${options.reset}</button>` : nothing}`
      : options.status ? html`<small class="sched-status" id=${`${id}-status`}>${options.status}</small>` : nothing}
    ${minReason ? html`<span class="sr-only" id=${`${id}-min`}>${minReason}</span>` : nothing}
    ${maxReason ? html`<span class="sr-only" id=${`${id}-max`}>${maxReason}</span>` : nothing}
  </div>`;
};

/** room-schedule.md §3: the Schedule block inside an expanded Edit row. */
export interface ScheduleModel {
  readonly roomId: string;
  readonly mopEvery: number | null;
  /** The vacuum rotation: how often, and its level (kept while Off; default Heavy duty, D1). */
  readonly covEvery: number | null;
  readonly level: RotationLevel;
  readonly mopStatus: string | null;
  readonly covStatus: string | null;
  /** The next-clean switch is on (a flag is set). */
  readonly doNext: boolean;
  /** room-schedule.md §5: the work the switch brings forward, which its label names (on and not already due). */
  readonly bringMop: boolean;
  readonly bringCov: boolean;
  readonly scope: "shared" | "plan";
  readonly readonly?: boolean;
  readonly sharedHint?: boolean;
  readonly explanation?: string;
  readonly note?: string;
  readonly advancedOpen?: boolean;
  readonly mopReason?: string;
  /** room-schedule.md §3: the overflow's Reset items exist only for a schedule with progress. */
  readonly hasProgress?: boolean;
}

const LEVELS: readonly RotationLevel[] = ["quick", "optimal", "heavy"];

const scheduleBlock = (model: ScheduleModel, onScope: (scope: "shared" | "plan") => void, scrollTarget = false): TemplateResult => {
  const name = roomName(model.roomId);
  const id = model.roomId;
  // room-schedule.md §3, §8: the label line is text by level and value; the
  // select shows only the level name and is named "Vacuum level for {room}".
  // Joined (read-only), the label line carries the level and there is no select.
  const levelControl = model.readonly
    ? undefined
    : html`<select class="ms-select sched-level" id=${`${id}-level`} aria-label=${t("v4_cadence_level_named", { room: name })}>
        ${LEVELS.map((level) => html`<option value=${level} ?selected=${level === model.level}>${levelWord(level)}</option>`)}
      </select>`;
  return html`<section class="schedule" role="group" aria-label=${t("v4_room_cadence_named", { room: name })} ?data-scroll-target=${scrollTarget}>
    <div class="schedule-head">
      <h3>${t("v4_room_schedule")}</h3>
      ${model.hasProgress
        ? html`<button class="ms-btn ms-btn--icon" type="button" aria-label=${t("v4_room_more_named", { room: name })} title=${t("v4_room_more_named", { room: name })}>${glyph(iconOverflow)}</button>`
        : nothing}
    </div>
    ${model.sharedHint ? html`<p class="schedule-note">${t("v4_cadence_shared_available", { room: name })}</p>` : nothing}
    ${stepperRow({
      id: `${id}-mop`,
      label: mopLabel(model.mopEvery),
      value: model.mopEvery,
      status: model.mopStatus,
      ...(model.readonly ? { readonly: true } : {}),
      ...(model.mopReason ? { reason: model.mopReason, reset: t("v4_reset_mop_cadence_button") } : {}),
    })}
    ${stepperRow({
      id: `${id}-cov`,
      label: rotationLabel(model.level, model.covEvery),
      value: model.covEvery,
      status: model.covStatus,
      ...(levelControl ? { level: levelControl } : {}),
      ...(model.readonly ? { readonly: true } : {}),
    })}
    ${model.bringMop || model.bringCov
      ? switchRow(`${id}-next`, nextCleanLabel(model.bringMop, model.bringCov ? model.level : null), t("v4_cadence_next_hint"), model.doNext, model.readonly ? { readonly: true } : {})
      : nothing}
    ${model.note ? html`<p class="schedule-note">${model.note}</p>` : nothing}
    ${model.explanation ? html`<p class="schedule-note">${model.explanation}</p>` : nothing}
    <details class="mock-details advanced" ?open=${Boolean(model.advancedOpen)}>
      <summary class="ms-disclosure"><span>${t("v4_advanced")}</span>${glyph(iconChevronRight, true, "chev")}</summary>
      <div class="mock-details__body">
        <fieldset class="scope">
          <legend class="ms-section-heading sub">${t("v4_cadence_scope")}</legend>
          <label class="ms-check"><input type="radio" name=${`${id}-scope`} .checked=${model.scope === "shared"} @change=${() => onScope("shared")}>${t("v4_cadence_shared")}</label>
          <label class="ms-check"><input type="radio" name=${`${id}-scope`} .checked=${model.scope === "plan"} @change=${() => onScope("plan")}>${t("v4_cadence_this_plan")}</label>
        </fieldset>
        <p class="quiet-line">${t("v4_cadence_description")}</p>
      </div>
    </details>
  </section>`;
};

type RunState = "ready" | "parts" | "paused" | "blocked";
type EditState = "clean" | "dirty" | "options" | "menu" | "discard" | "new";

interface EditOptions {
  readonly plan: SavedPlan;
  readonly state: EditState;
  readonly expanded?: { readonly roomId: string; readonly schedule: ScheduleModel };
  readonly dirty: boolean;
}

export class MockPlan extends MockScreen {
  static override properties = { ...MockScreen.properties, _menuOpen: { state: true } };
  static override styles = [...screenStyles, planCss];

  protected _menuOpen = false;
  /** The Room schedule screen opens with the open room's schedule block in view, not its row. */
  protected scrollToSchedule = false;

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has("mockState") || changed.has("variants")) this._menuOpen = this.mockState === "menu";
  }

  protected planFor(state: string): SavedPlan {
    if (state === "parts") return planById("weekend");
    // home-rooms.md §6: the home card of a paused default plan opens its Run (plan.md R2).
    if (state === "paused") return this.variants.origin === "home" ? { ...planById(DEFAULT_PLAN_ID), enabled: false } : planById("guest");
    return planById(DEFAULT_PLAN_ID);
  }

  /** plan.md §3 Run row: the name and its effective setting; "Needs attention" is the only chip. */
  #runRow(room: { readonly roomId: string; readonly name: string; readonly cleaningMode: CleaningMode; readonly coverageSetting: CoverageSetting }, index: number | null, options: { readonly blocked?: boolean; readonly partBreak?: number }): TemplateResult {
    return html`<li class="run-row" data-break=${options.partBreak ? "" : nothing}>
      ${options.partBreak ? html`<span class="sr-only">${t("v4_part_break", { number: num(options.partBreak) })}</span>` : nothing}
      ${index === null ? nothing : html`<span class="ms-badge" aria-hidden="true">${num(index + 1)}</span>`}
      <span class="row-lines">
        <bdi>${room.name}</bdi>
        <small>${roomSetting(room.cleaningMode, room.coverageSetting)}</small>
        ${options.blocked ? html`<span class="mock-chips">${chip(t("v4_needs_attention_chip"), "danger")}</span>` : nothing}
      </span>
    </li>`;
  }

  #run(state: RunState): ShellView {
    const plan = this.planFor(state);
    const order = orderFor(plan, this.variants, plan.id);
    const ordered = order === "ordered";
    const paused = state === "paused";
    const blocked = state === "blocked";
    const rooms = previewRooms(plan, this.variants, plan.id);
    const boundaries = plan.nextRunPreview?.missionBoundaries ?? [];
    const savedRooms = plan.roomOrder.map((roomId) => {
      const own = plan.rooms.find((room) => room.roomId === roomId);
      return {
        roomId,
        name: roomName(roomId),
        cleaningMode: own?.cleaningMode ?? "vacuum",
        coverageSetting: own?.coverageSetting ?? "standard",
      };
    });
    const ListTag = ordered && !paused && !blocked ? "ol" : "ul";
    const listRows = paused || blocked
      ? savedRooms.map((room) => this.#runRow(room, null, { blocked: blocked && room.roomId === "room-kitchen" }))
      : rooms.map((room, index) => {
        const breakAt = boundaries.indexOf(index);
        return this.#runRow(room, ordered ? index : null, breakAt >= 0 ? { partBreak: breakAt + 2 } : {});
      });
    const due = paused || blocked ? [] : dueLines(rooms);
    const list = ListTag === "ol"
      ? html`<ol class="mock-stack run-list">${listRows}</ol>`
      : html`<ul class="mock-stack run-list">${listRows}</ul>`;
    // plan.md §6: one "When a run ends" line: the finish sentence while
    // finish-room is on, else the return line while return-to-dock is on.
    const endLine = plan.finishCurrentRoom
      ? t("v4_plan_summary_finish", { percent: num(plan.finishCurrentRoomThreshold) })
      : plan.returnToBase ? t("v4_plan_summary_return") : null;
    const body = html`
      <p class="run-summary">${runSummary(plan, !paused && !blocked)}</p>
      ${due.length ? html`<div class="run-due">${dueBlock(due, { tag: "div" })}</div>` : nothing}
      <h3 class="ms-section-heading">${paused ? t("v4_plan_rooms_heading") : t("v4_next_run_preview")}</h3>
      ${!paused && !blocked && !ordered ? html`<p class="run-caption">${t("v4_plan_rotation_settings")}</p>` : nothing}
      ${!paused && !blocked && boundaries.length ? html`<p class="run-caption">${t("v4_room_parts", { count: num(boundaries.length + 1) })}</p>` : nothing}
      ${list}
      <div class="enable-row">${switchRow("plan-enabled", t("v4_plan_can_run"), t("v4_plan_can_run_on"), plan.enabled)}</div>
      ${endLine ? html`<div class="end-lines"><p class="quiet-line">${endLine}</p></div>` : nothing}`;
    const start: MockAction = {
      label: t("v4_action_run_plan"),
      kind: "primary",
      ariaLabel: t("v4_action_run_plan_named", { plan: plan.name }),
      ...(paused ? { reason: t("v4_reason_run_plan_paused") } : {}),
      ...(blocked ? { reason: t("v4_reason_plan_room_progress", { room: roomName("room-kitchen") }), jump: t("v4_review_room", { room: roomName("room-kitchen") }) } : {}),
    };
    const ids = paused || blocked ? savedRooms.map((room) => room.roomId) : rooms.map((room) => room.roomId);
    return {
      workflow: "plan-run",
      status: STATUS.ready,
      // plan.md §3, §5: Back is named by `planOrigin`, and returns there.
      back: this.variants.origin === "home"
        ? { label: t("v4_back_to_all_tasks"), kind: "secondary", change: { screen: "home", state: "h1" } }
        : { label: t("v4_back_to_plans"), kind: "secondary", change: { screen: "plans", state: "ready" } },
      heading: plan.name,
      headingTrail: html`<button
        class="ms-btn heading-edit"
        type="button"
        aria-label=${t("v4_edit_plan_named", { plan: plan.name })}
        @click=${() => this.emit({ view: "edit", state: "clean" })}
      >${t("v4_edit")}</button>`,
      body,
      bar: { primary: start },
      map: { mode: "map", robot: "dock", selected: ids, ...(ordered && !paused && !blocked ? { numbers: ids } : {}) },
    };
  }

  #editRow(roomId: string, index: number, selected: boolean, ordered: boolean, last: number, plan: SavedPlan, expanded: EditOptions["expanded"]): TemplateResult {
    const name = roomName(roomId);
    const own: PlanRoom | undefined = plan.rooms.find((room) => room.roomId === roomId);
    const open = expanded?.roomId === roomId;
    // plan.md §3 Edit room row: line 2 is the room's own cleaning mode and
    // vacuum coverage from the draft, not the preview's effective setting.
    const line = own ? roomSetting(own.cleaningMode, own.coverageSetting) : "";
    // plan.md §3 Edit room row: line 3 is the schedule text (`v4_room_schedules_*`),
    // from the open draft when this row is expanded, else from the saved cadence.
    const schedules = open && expanded
      ? scheduleText(expanded.schedule.mopEvery, expanded.schedule.covEvery, expanded.schedule.level)
      : own?.cadence
        ? scheduleText(own.cadence.mopEveryN, own.cadence.coverageEveryN, ROTATION_LEVEL[own.cadence.periodicCoverageSetting ?? "heavy_duty"])
        : null;
    const first = index === 0;
    const isLast = index === last;
    return html`<li class="ms-row edit-row" data-selected=${selected ? "true" : nothing} ?data-scroll-target=${open && !this.scrollToSchedule}>
      <label class="edit-check"><input
        type="checkbox"
        .checked=${selected}
        aria-label=${t("v4_room_include_named", { room: name })}
        @click=${(event: Event) => event.preventDefault()}
      ></label>
      ${selected ? html`<button class="edit-disclosure" type="button" aria-expanded=${String(open)} aria-label=${t("v4_room_settings_named", { room: name })}>
          ${ordered ? html`<span class="ms-badge" aria-hidden="true">${num(index + 1)}</span>` : nothing}
          <span class="row-lines">
            <bdi>${name}</bdi>
            <small>${line}</small>
            ${schedules ? html`<small>${schedules}</small>` : nothing}
          </span>
          ${glyph(iconChevronRight, true, "chev")}
        </button>` : html`<span class="edit-name"><bdi>${name}</bdi></span>`}
      ${selected && ordered ? html`<span class="edit-moves">
        <button
          class="ms-btn ms-btn--icon"
          type="button"
          aria-label=${t("move_room_up", { room: name })}
          title=${first ? t("v4_room_already_first", { room: name }) : t("move_room_up", { room: name })}
          aria-disabled=${first ? "true" : nothing}
          aria-describedby=${first ? `${roomId}-first` : nothing}
        >${glyph(iconMoveUp)}</button>
        <button
          class="ms-btn ms-btn--icon"
          type="button"
          aria-label=${t("move_room_down", { room: name })}
          title=${isLast ? t("v4_room_already_last", { room: name }) : t("move_room_down", { room: name })}
          aria-disabled=${isLast ? "true" : nothing}
          aria-describedby=${isLast ? `${roomId}-last` : nothing}
        >${glyph(iconMoveDown)}</button>
        ${first ? html`<span class="sr-only" id=${`${roomId}-first`}>${t("v4_room_already_first", { room: name })}</span>` : nothing}
        ${isLast ? html`<span class="sr-only" id=${`${roomId}-last`}>${t("v4_room_already_last", { room: name })}</span>` : nothing}
      </span>` : html`<span></span>`}
      ${open && expanded && own ? html`<div class="row-expanded">
        ${modeSelect(t("v4_room_cleaning_system_named", { room: name }), own.cleaningMode)}
        ${coverageSelect(t("v4_vacuum_coverage"), own.coverageSetting)}
        ${scheduleBlock(expanded.schedule, (scope) => this.emit({ scope }), this.scrollToSchedule)}
      </div>` : nothing}
    </li>`;
  }

  protected edit(options: EditOptions): ShellView {
    const { plan, state } = options;
    const isNew = state === "new";
    const order = isNew ? this.variants.order : orderFor(plan, this.variants, plan.id);
    const ordered = order === "ordered";
    const floor = syntheticMockupFloor();
    const selectedIds = isNew ? [] : plan.roomOrder;
    const rest = floor.map((room) => room.roomId).filter((roomId) => !selectedIds.includes(roomId));
    const dirty = options.dirty;
    const title = isNew ? t("v4_new_plan") : t("v4_edit_plan");
    const menu = this._menuOpen && !isNew;
    const trail = isNew ? nothing : html`<button
        class="ms-btn ms-btn--icon"
        type="button"
        aria-label=${t("v4_more_actions")}
        title=${t("v4_more_actions")}
        aria-expanded=${String(menu)}
        aria-controls="plan-actions"
        @click=${() => { this._menuOpen = !menu; }}
      >${glyph(iconOverflow)}</button>
      ${menu ? html`<div class="heading-menu ms-surface ms-surface--overlay" id="plan-actions" role="menu">
        <button
          class="ms-row ms-row--menu"
          type="button"
          role="menuitem"
          aria-disabled=${dirty ? "true" : nothing}
          aria-describedby=${dirty ? "delete-reason" : nothing}
        >${t("plan_delete")}</button>
        ${dirty ? html`<p class="menu-reason" id="delete-reason">${t("v4_delete_plan_unsaved")}</p>` : nothing}
      </div>` : nothing}`;
    const body = html`
      <div class="mock-fields">
        <label class="ms-field">${t("v4_plan_name")}<input type="text" .value=${isNew ? "" : plan.name}></label>
        <div class="ms-field" role="group" aria-labelledby="order-label">
          <span id="order-label">${t("v4_cleaning_order")}</span>
          <div class="ms-segment">
            <button class="ms-btn" type="button" aria-pressed=${String(!ordered)} @click=${() => this.emit({ order: "intelligent" })}>${t("v4_order_intelligent")}</button>
            <button class="ms-btn" type="button" aria-pressed=${String(ordered)} @click=${() => this.emit({ order: "ordered" })}>${t("v4_order_ordered")}</button>
          </div>
          <p class="field-hint">${ordered ? t("v4_plan_order_ordered_hint") : t("v4_plan_order_intelligent_hint")}</p>
        </div>
      </div>
      <div class="list-header">
        <h3 class="ms-section-heading">${t("v4_rooms_heading")}</h3>
        <small>${t("v4_plan_rooms_selected", { selected: num(selectedIds.length), total: num(floor.length) })}</small>
      </div>
      <ul class="mock-stack edit-list">
        ${selectedIds.map((roomId, index) => this.#editRow(roomId, index, true, ordered, selectedIds.length - 1, plan, options.expanded))}
        ${rest.map((roomId, index) => this.#editRow(roomId, index, false, ordered, -1, plan, undefined))}
      </ul>
      <details class="mock-details more-options" ?open=${state === "options"} ?data-scroll-target=${state === "options"}>
        <summary class="ms-disclosure"><span>${t("v4_run_end_options")}</span>${glyph(iconChevronRight, true, "chev")}</summary>
        <div class="mock-details__body">
          ${switchRow("return-dock", t("v4_plan_return_to_dock"), null, plan.returnToBase)}
          ${switchRow("finish-room", t("v4_plan_finish_room"), t("v4_plan_finish_room_hint", { percent: num(plan.finishCurrentRoomThreshold) }), plan.finishCurrentRoom)}
          ${plan.finishCurrentRoom ? html`<div class="threshold-row">
            <span id="finish-threshold-label">${t("v4_plan_finish_threshold", { percent: num(plan.finishCurrentRoomThreshold) })}</span>
            <input
              class="ms-range"
              type="range"
              min="0"
              max="100"
              step="5"
              aria-labelledby="finish-threshold-label"
              aria-valuetext=${`${num(plan.finishCurrentRoomThreshold)}%`}
              .value=${String(plan.finishCurrentRoomThreshold)}
            >
          </div>` : nothing}
        </div>
      </details>`;
    const primary: MockAction = {
      label: dirty || isNew ? t("v4_action_save_plan") : t("v4_action_done"),
      kind: "primary",
      ...(isNew ? { reason: t("v4_reason_save_plan") } : {}),
      ...(dirty || isNew ? {} : { change: { view: "run", state: "ready" } }),
    };
    const cancel: MockAction = {
      label: t("v4_cancel"),
      kind: "secondary",
      change: dirty ? { state: "discard" } : isNew ? { screen: "plans", state: "ready" } : { view: "run", state: "ready" },
    };
    const mapIds = selectedIds;
    return {
      workflow: "plan-edit",
      status: STATUS.ready,
      heading: html`<span class="heading-text">${title}</span>${dirty ? chip(t("v4_plan_unsaved"), "neutral") : nothing}`,
      headingTrail: html`${trail}`,
      body,
      bar: { secondary: cancel, primary },
      map: { mode: "map", robot: "dock", selected: mapIds, ...(ordered ? { numbers: mapIds } : {}) },
      ...(state === "discard" ? {
        dialog: {
          title: t("v4_discard_plan"),
          body: t("v4_discard_plan_detail", { name: plan.name }),
          actions: [
            { label: t("v4_keep_area_editing"), kind: "plain", change: { state: "dirty" } },
            { label: t("v4_save"), kind: "secondary" },
            { label: t("v4_discard"), kind: "stop", change: { view: "run", state: "ready" } },
          ],
        },
      } : {}),
    };
  }

  protected override view(): ShellView {
    if (this.variants.view === "run") {
      const state = (["ready", "parts", "paused", "blocked"].includes(this.mockState) ? this.mockState : "ready") as RunState;
      return this.#run(state);
    }
    const state = (["clean", "dirty", "options", "menu", "discard", "new"].includes(this.mockState) ? this.mockState : "clean") as EditState;
    return this.edit({ plan: planById(DEFAULT_PLAN_ID), state, dirty: state === "dirty" || state === "menu" || state === "discard" });
  }
}

// ---- Room schedule (room-schedule.md) ------------------------------------------------------

type ScheduleState = "counting" | "next-clean" | "edited" | "available" | "joined" | "limits" | "unconfirmed";

const levelOf = (setting: CoverageSetting | null | undefined): RotationLevel => ROTATION_LEVEL[setting ?? "heavy_duty"];

export class MockSchedule extends MockPlan {
  protected override scrollToSchedule = true;

  #kitchen(state: ScheduleState): { schedule: ScheduleModel; dirty: boolean } {
    const plan = planById(DEFAULT_PLAN_ID);
    const room = plan.rooms.find((candidate) => candidate.roomId === "room-kitchen");
    const cadence = room?.cadence;
    const progress = progressFor(room?.cadenceProgress, cadence, this.variants.due);
    const mopEvery = state === "edited" ? 4 : cadence?.mopEveryN ?? null;
    const covEvery = cadence?.coverageEveryN ?? null;
    // An edited interval keeps the progress, so the next due follows cadence.py:122
    // (interval − count) rather than the saved schedule's value.
    const mopNextIn = state === "edited" && mopEvery !== null && progress
      ? Math.max(1, mopEvery - progress.mopProgress)
      : progress?.nextMopIn ?? null;
    const covNextIn = progress?.nextCoverageIn ?? null;
    // room-schedule.md §5: the switch names only work that is on and not already due.
    const bringMop = canBringForward(mopEvery, mopNextIn);
    const bringCov = canBringForward(covEvery, covNextIn);
    const doNext = state === "next-clean";
    const leaving = this.variants.scope === "plan";
    const mopStatus = state === "edited"
      ? t("v4_cadence_status_edited")
      : statusLine(mopEvery, mopNextIn, doNext && bringMop);
    const covStatus = statusLine(covEvery, covNextIn, doNext && bringCov);
    const explanation = state === "edited"
      ? t("v4_cadence_existing_effect")
      : leaving ? t("v4_cadence_shared_leave_effect") : t("v4_cadence_shared_edit_effect", { room: roomName("room-kitchen") });
    return {
      // S11's inline Reset needs a clean draft (room-schedule.md §4 S13), so only
      // the switch, an edited interval or a scope change make the draft dirty.
      dirty: state === "next-clean" || state === "edited" || leaving,
      schedule: {
        roomId: "room-kitchen",
        mopEvery,
        covEvery,
        mopStatus,
        covStatus,
        level: levelOf(cadence?.periodicCoverageSetting),
        doNext,
        bringMop,
        bringCov,
        scope: this.variants.scope,
        explanation,
        advancedOpen: leaving,
        hasProgress: true,
        ...(state === "unconfirmed" ? { mopReason: t("v4_cadence_mop_progress_unverified") } : {}),
      },
    };
  }

  #study(state: "available" | "joined"): { schedule: ScheduleModel; dirty: boolean } {
    const shared = CATALOG.rooms.find((room) => room.roomId === "room-study");
    const policy = shared?.sharedCadence;
    const progress = shared?.sharedCadenceProgress;
    if (state === "available") {
      return {
        dirty: false,
        schedule: {
          roomId: "room-study",
          mopEvery: null,
          covEvery: null,
          level: "heavy",
          mopStatus: statusLine(null, null, false),
          covStatus: statusLine(null, null, false),
          doNext: false,
          bringMop: false,
          bringCov: false,
          scope: "shared",
          sharedHint: true,
        },
      };
    }
    const mopEvery = policy?.mopEveryN ?? null;
    const covEvery = policy?.coverageEveryN ?? null;
    return {
      dirty: true,
      schedule: {
        roomId: "room-study",
        mopEvery,
        covEvery,
        level: levelOf(policy?.periodicCoverageSetting),
        mopStatus: statusLine(mopEvery, progress?.nextMopIn ?? null, Boolean(policy?.doMopNext)),
        covStatus: statusLine(covEvery, progress?.nextCoverageIn ?? null, Boolean(policy?.doCoverageNext)),
        doNext: Boolean(policy?.doMopNext || policy?.doCoverageNext),
        bringMop: canBringForward(mopEvery, progress?.nextMopIn ?? null),
        bringCov: canBringForward(covEvery, progress?.nextCoverageIn ?? null),
        scope: "shared",
        readonly: true,
        note: t("v4_cadence_join_pending", { room: roomName("room-study") }),
        explanation: t("v4_cadence_shared_join_effect"),
      },
    };
  }

  #hallway(): { schedule: ScheduleModel; dirty: boolean } {
    // A new, unsaved rotation has no server progress yet, so no status line;
    // the explanation says it starts from zero.
    return {
      dirty: true,
      schedule: {
        roomId: "room-hallway",
        mopEvery: null,
        covEvery: 100,
        level: "heavy",
        mopStatus: statusLine(null, null, false),
        covStatus: null,
        doNext: false,
        bringMop: false,
        bringCov: canBringForward(100, null),
        scope: "shared",
        explanation: t("v4_cadence_new_shared_effect"),
        advancedOpen: true,
      },
    };
  }

  protected override view(): ShellView {
    const state = (["counting", "next-clean", "edited", "available", "joined", "limits", "unconfirmed"].includes(this.mockState)
      ? this.mockState
      : "counting") as ScheduleState;
    const model = state === "available" || state === "joined"
      ? this.#study(state)
      : state === "limits" ? this.#hallway() : this.#kitchen(state);
    const plan = planById(DEFAULT_PLAN_ID);
    return this.edit({
      plan,
      state: model.dirty ? "dirty" : "clean",
      dirty: model.dirty,
      expanded: { roomId: model.schedule.roomId, schedule: model.schedule },
    });
  }
}
