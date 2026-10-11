import { css, html, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import type { CleaningMode, CoverageSetting, NextRunPreviewRoom } from "../backend-contracts";
import {
  iconChevronDown,
  iconChevronRight,
  iconChevronUp,
  iconCleaning,
  iconDiagnostics,
  iconHistory,
  iconNewArea,
  iconOffline,
  iconPlan,
} from "../icons";
import { syntheticMockupFloor, syntheticMockupRobot } from "../synthetic-fixtures";
import { cleanRoomsLabel, listOf, num, roomSetting, roomsSummary, t } from "./copy";
import {
  MockScreen,
  cardRow,
  chip,
  glyph,
  screenStyles,
  type MapView,
  type MockAction,
  type MockChange,
  type MotionView,
  type NoticeView,
  type ShellView,
  type StatusView,
  type Variants,
} from "./frame";
import {
  glyphAlert,
  glyphClock,
  glyphHand,
  glyphLanDisconnect,
  glyphMapSearch,
  glyphRobot,
  glyphRobotOff,
  glyphStopping,
  glyphVacuumAlert,
} from "./glyphs";
import { DEFAULT_PLAN_ID, orderFor, planAttention, planById, planLine, previewRooms } from "./plan-data";

// ---- Status rows (shell.md §4) ------------------------------------------------

const battery = t("v4_battery", { percent: num(syntheticMockupRobot.batteryPercent) });

export const STATUS = {
  ready: { glyph: glyphRobot, title: t("v4_ready"), detail: battery },
  cleaning: { glyph: iconCleaning, title: t("v4_cleaning"), detail: t("v4_cleaning_room", { room: syntheticMockupRobot.currentRoom }) },
  stopping: { glyph: glyphStopping, title: t("v4_stopping"), detail: t("v4_waiting_robot") },
  starting: { glyph: glyphClock, title: t("v4_action_starting"), detail: t("v4_action_starting_detail") },
  paused: { glyph: glyphHand, title: t("v4_paused"), detail: t("v4_can_resume") },
  problem: { glyph: glyphVacuumAlert, title: t("v4_needs_attention"), detail: t("v4_check_robot") },
  offline: { glyph: glyphLanDisconnect, title: t("v4_robot_offline"), detail: t("v4_map_read_only") },
  mapUnavailable: { glyph: iconOffline, title: t("v4_map_unavailable"), detail: t("v4_cleaning_blocked") },
  locating: { glyph: glyphMapSearch, title: t("v4_locating"), detail: t("v4_finding_map") },
  noRobot: { glyph: glyphRobotOff, title: t("v4_no_robot_short"), detail: t("v4_no_robot_detail") },
} as const satisfies Readonly<Record<string, StatusView>>;

export const stopAction = (reason?: string, outline = false): MockAction => ({
  label: t("v4_action_stop"),
  kind: outline ? "stop-outline" : "stop",
  ariaLabel: t("v4_stop_cleaning_label"),
  ...(reason ? { reason } : {}),
});

export const working = (reason?: string): MotionView => ({ stop: stopAction(reason) });

// ---- Home panel (home-rooms.md §3–§4) ------------------------------------------

type HomeKind = "ready" | "busy" | "paused" | "problem" | "offline" | "map-unavailable" | "no-robot";

const homeCss = css`
.quick-actions .ms-row__body .warn-line { color: var(--ms-text); }
.home-recovery { justify-self: start; margin-block-end: var(--ms-space-4); }
.host-actions { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); margin-block-end: var(--ms-space-2); }
`;

const mapsGroup = (diagnosticsFirst: boolean): TemplateResult => {
  const history = cardRow({ lead: iconHistory, title: t("v4_map_history"), detail: t("v4_history_quick_detail") });
  const diagnostics = cardRow({ lead: iconDiagnostics, title: t("v4_map_diagnostics"), detail: t("v4_diagnostics_quick_detail") });
  return html`<h3 class="ms-section-heading">${t("v4_maps_heading")}</h3>
    <div class="shelf">${diagnosticsFirst ? [diagnostics, history] : [history, diagnostics]}</div>`;
};

const homeCards = (variants: Variants, disabledBy: string | undefined, go: (change: MockChange) => void): TemplateResult => {
  const plan = planById(DEFAULT_PLAN_ID);
  const attention = planAttention(plan, variants, DEFAULT_PLAN_ID);
  return html`<div class="quick-actions" role="group" aria-label=${t("v4_cleaning_choices")}>
    ${cardRow({
      lead: glyphRobot,
      title: t("v4_clean_rooms"),
      detail: t("v4_rooms_quick_detail"),
      featured: true,
      ...(disabledBy ? { disabledBy } : {}),
      onPress: () => go({ screen: "rooms", state: "r1" }),
    })}
    ${cardRow({
      lead: iconPlan,
      title: t("v4_run_named_plan", { plan: plan.name }),
      detail: planLine(plan, orderFor(plan, variants, DEFAULT_PLAN_ID)),
      ...(attention ? { extra: html`<small class="warn-line">${glyph(glyphAlert)}<span>${attention}</span></small>` } : {}),
      ...(disabledBy ? { disabledBy } : {}),
      onPress: () => go({ screen: "plan", state: "ready", view: "run" }),
    })}
    ${cardRow({
      lead: iconNewArea,
      title: t("v4_custom_areas"),
      detail: t("v4_areas_quick_detail"),
      ...(disabledBy ? { disabledBy } : {}),
    })}
  </div>`;
};

const homePanel = (kind: HomeKind, variants: Variants, go: (change: MockChange) => void): { heading: string; body: TemplateResult } => {
  switch (kind) {
    case "ready":
      return { heading: t("v4_what_to_clean"), body: html`${homeCards(variants, undefined, go)}${mapsGroup(false)}` };
    case "busy":
    case "paused":
      return {
        heading: t("v4_home_busy_title"),
        body: html`<p class="panel-description" id="home-reason">${t(kind === "busy" ? "v4_home_busy_detail" : "v4_home_paused_detail")}</p>
          ${homeCards(variants, "home-reason", go)}${mapsGroup(false)}`,
      };
    case "problem":
      return {
        heading: t("v4_attention_title"),
        body: html`<p class="panel-description">${t("v4_attention_body")}</p>
          <div class="host-actions"><button class="ms-btn ms-btn--secondary" type="button">${t("v4_open_diagnostics")}</button></div>
          ${mapsGroup(false)}`,
      };
    case "offline":
      return {
        heading: t("v4_robot_offline"),
        body: html`<p class="panel-description">${t("v4_robot_offline_body")}</p>${mapsGroup(false)}`,
      };
    case "map-unavailable":
      return {
        heading: t("v4_what_to_clean"),
        body: html`<p class="panel-description" id="home-reason">${t("v4_map_unavailable_status")}</p>
          <div class="host-actions"><button class="ms-btn ms-btn--secondary" type="button">${t("v4_retry")}</button></div>
          ${homeCards(variants, "home-reason", go)}${mapsGroup(true)}`,
      };
    case "no-robot":
      return {
        heading: t("v4_setup_title"),
        body: html`<p class="panel-description">${t("v4_no_robot_body")}</p>`,
      };
  }
};

interface HomeState {
  readonly kind: HomeKind;
  readonly status: StatusView;
  readonly motion?: MotionView;
  readonly map: MapView;
  readonly notice?: NoticeView;
  readonly fullMap?: { readonly locating: boolean };
  readonly bar?: { readonly primary: MockAction };
}

const atDock: MapView = { mode: "map", robot: "dock" };
const cleaningMap: MapView = { mode: "map", robot: "cleaning" };

const HOME_STATES: Readonly<Record<string, HomeState>> = {
  ready: { kind: "ready", status: STATUS.ready, map: atDock },
  cleaning: { kind: "busy", status: STATUS.cleaning, motion: working(), map: cleaningMap },
  stopping: { kind: "busy", status: STATUS.stopping, motion: working(t("v4_reason_stop")), map: cleaningMap },
  "stopping-fence": { kind: "busy", status: STATUS.stopping, motion: working(), map: cleaningMap },
  starting: { kind: "busy", status: STATUS.starting, motion: working(), map: atDock },
  paused: {
    kind: "paused",
    status: STATUS.paused,
    motion: { resume: { label: t("v4_action_resume"), kind: "primary" }, stop: stopAction(undefined, true) },
    map: cleaningMap,
  },
  problem: { kind: "problem", status: STATUS.problem, map: { ...atDock, chip: t("v4_needs_attention") } },
  offline: { kind: "offline", status: STATUS.offline, map: { ...atDock, dim: true, chip: t("v4_robot_offline") } },
  "map-unavailable": {
    kind: "map-unavailable",
    status: STATUS.mapUnavailable,
    map: { mode: "empty", card: { glyph: iconOffline, title: t("v4_map_unavailable") } },
  },
  "no-robot": {
    kind: "no-robot",
    status: STATUS.noRobot,
    map: { mode: "empty", card: { glyph: glyphRobotOff, title: t("v4_no_robot_short") } },
    bar: { primary: { label: t("v4_open_integration"), kind: "link" } },
  },
  notice: {
    kind: "busy",
    status: STATUS.cleaning,
    motion: working(),
    map: cleaningMap,
    notice: { tone: "error", text: t("v4_notice_stop_unconfirmed"), toast: true },
  },
  "full-map": { kind: "busy", status: STATUS.cleaning, motion: working(), map: cleaningMap, fullMap: { locating: false } },
  locating: {
    kind: "busy",
    status: STATUS.locating,
    motion: working(),
    map: { ...cleaningMap, dim: true, chip: t("v4_locating") },
    fullMap: { locating: true },
  },
};

/** Home and status screens share one builder; the state id picks the row. */
abstract class HomeLike extends MockScreen {
  static override styles = [...screenStyles, homeCss];

  protected abstract readonly stateMap: Readonly<Record<string, string>>;

  protected override view(): ShellView {
    const id = this.stateMap[this.mockState] ?? "ready";
    const state = HOME_STATES[id] ?? HOME_STATES["ready"];
    if (!state) throw new Error("missing home state");
    const panel = homePanel(state.kind, this.variants, (change) => this.emit(change));
    return {
      workflow: "none",
      status: state.status,
      heading: panel.heading,
      body: panel.body,
      map: state.map,
      ...(state.motion ? { motion: state.motion } : {}),
      ...(state.notice ? { notice: state.notice } : {}),
      ...(state.fullMap ? { fullMap: state.fullMap } : {}),
      ...(state.bar ? { bar: state.bar } : {}),
    };
  }
}

export class MockHome extends HomeLike {
  protected readonly stateMap = { h1: "ready", h4: "cleaning", h7: "problem", h10: "no-robot" };
}

export class MockStatus extends HomeLike {
  protected readonly stateMap: Readonly<Record<string, string>> = Object.fromEntries(
    Object.keys(HOME_STATES).filter((id) => id !== "no-robot").map((id) => [id, id]),
  );
}

// ---- Rooms (home-rooms.md §3–§5) ------------------------------------------------

const roomsCss = css`
.rooms-header small { font-variant-numeric: tabular-nums; }
.rooms-header .ms-btn--sm { margin-inline-start: auto; }
.room-list { margin-block-start: var(--ms-space-2); }
.settings-body { display: grid; gap: var(--ms-space-3); padding: 0 var(--ms-space-3) var(--ms-space-3); }
.due-changes { margin: 0; font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.check-line { margin-block: var(--ms-space-2); }
`;

type RoomsState = "r1" | "r2" | "r3" | "r3-room" | "r3-settings" | "r4" | "r9";

const SELECTED = ["room-kitchen", "room-living", "room-study"] as const;
const WHOLE_MODE: CleaningMode = "vacuum";
const WHOLE_COVERAGE: CoverageSetting = "standard";

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

export const dueChips = (reasons: readonly string[]): TemplateResult[] => [
  ...(reasons.includes("mop_due") ? [chip(t("v4_cadence_mop_due_reason"), "warning")] : []),
  ...(reasons.includes("coverage_due") ? [chip(t("v4_cadence_coverage_due_reason"), "warning")] : []),
];

export class MockRooms extends MockScreen {
  static override properties = { ...MockScreen.properties, _openRoom: { state: true }, _settingsOpen: { state: true } };
  static override styles = [...screenStyles, roomsCss];

  protected _openRoom: string | null = null;
  protected _settingsOpen = false;

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has("mockState")) {
      this._openRoom = this.mockState === "r3-room" ? "room-kitchen" : null;
      this._settingsOpen = this.mockState === "r3-settings";
    }
  }

  #preview(): readonly NextRunPreviewRoom[] {
    // The whole-clean setting is Vacuum · Optimal; due work changes Kitchen
    // and Living room, as the daily plan's preview does.
    return previewRooms(planById(DEFAULT_PLAN_ID), { ...this.variants, order: "intelligent" }, DEFAULT_PLAN_ID)
      .filter((room) => (SELECTED as readonly string[]).includes(room.roomId));
  }

  #settingsRow(due: boolean): TemplateResult {
    const open = this._settingsOpen;
    return html`<div class="ms-row settings-row">
      <button class="ms-disclosure" type="button" aria-expanded=${String(open)} aria-controls="clean-settings" @click=${() => { this._settingsOpen = !open; }}>
        <span>${t("v4_clean_settings")}</span>
        <span class="ms-disclosure__value">${roomSetting(WHOLE_MODE, WHOLE_COVERAGE)}</span>
        ${glyph(iconChevronRight, true, "chev")}
      </button>
      ${open ? html`<div class="settings-body" id="clean-settings">
        ${modeSelect(t("v4_cleaning_system"), WHOLE_MODE)}
        ${coverageSelect(t("v4_vacuum_coverage"), WHOLE_COVERAGE)}
        ${due ? html`<div class="switch-row">
          <span class="switch-copy"><span id="due-switch-label">${t("v4_include_due_schedule")}</span><small id="due-switch-hint">${t("v4_include_due_schedule_hint")}</small></span>
          <button class="ms-switch" type="button" role="switch" aria-checked="true" aria-labelledby="due-switch-label" aria-describedby="due-switch-hint"></button>
        </div>` : nothing}
      </div>` : nothing}
    </div>`;
  }

  #row(roomId: string, name: string, selected: boolean, line: string | null, reasons: readonly string[], changed: boolean): TemplateResult {
    const open = selected && this._openRoom === roomId;
    const chips = selected ? dueChips(reasons) : [];
    return html`<li class="ms-row room-row">
      <label class="ms-check">
        <input type="checkbox" .checked=${selected} @click=${(event: Event) => event.preventDefault()}>
        <span class="row-lines">
          <bdi>${name}</bdi>
          ${selected && line ? html`<small>${line}</small>` : nothing}
          ${chips.length ? html`<span class="mock-chips">${chips}</span>` : nothing}
        </span>
      </label>
      ${selected ? html`<button
        class="ms-btn ms-btn--icon"
        type="button"
        aria-label=${t("v4_room_settings_named", { room: name })}
        aria-expanded=${String(open)}
        aria-controls=${`settings-${roomId}`}
        @click=${() => { this._openRoom = open ? null : roomId; }}
      >${glyph(open ? iconChevronUp : iconChevronDown)}</button>` : nothing}
      ${open ? html`<div class="row-expanded" id=${`settings-${roomId}`}>
        ${modeSelect(t("v4_room_cleaning_system_named", { room: name }), WHOLE_MODE)}
        ${coverageSelect(t("v4_vacuum_coverage"), WHOLE_COVERAGE)}
        ${changed ? html`<p class="due-changes">${t("v4_room_due_changes")}</p>` : nothing}
      </div>` : nothing}
    </li>`;
  }

  protected override view(): ShellView {
    const state = (this.mockState || "r1") as RoomsState;
    const floor = syntheticMockupFloor();
    const empty = state === "r9";
    const selected: readonly string[] = state === "r1" || empty ? [] : SELECTED;
    const preview = this.#preview();
    const ready = state === "r3" || state === "r3-room" || state === "r3-settings";
    const anyDue = ready && preview.some((room) => room.cadenceReasons.length > 0);
    const back: MockAction = { label: t("v4_back_to_all_tasks"), kind: "secondary", change: { screen: "home", state: "h1" } };
    const lineFor = (roomId: string): { line: string | null; reasons: readonly string[]; changed: boolean } => {
      if (state === "r2") return { line: t("v4_room_preview_loading"), reasons: [], changed: false };
      if (!ready) return { line: roomSetting(WHOLE_MODE, WHOLE_COVERAGE), reasons: [], changed: false };
      const room = preview.find((candidate) => candidate.roomId === roomId);
      if (!room) return { line: null, reasons: [], changed: false };
      return {
        line: roomSetting(room.cleaningMode, room.coverageSetting),
        reasons: room.cadenceReasons,
        changed: room.cleaningMode !== WHOLE_MODE || room.coverageSetting !== WHOLE_COVERAGE,
      };
    };
    const count = selected.length;
    const primary: MockAction = {
      label: cleanRoomsLabel(count),
      kind: "primary",
      ...(count === 0
        ? { reason: t("v4_reason_clean_rooms_empty") }
        : state === "r2"
          ? { reason: t("v4_reason_room_preview_loading") }
          : state === "r4"
            ? { reason: t("v4_reason_room_preview_unavailable") }
            : {}),
    };
    const names = preview.map((room) => room.name);
    const body = empty
      ? html`<p class="panel-description">${t("v4_no_rooms_plans")}</p>`
      : html`<p class="panel-description">${t("v4_choose_rooms_detail")}</p>
        <div class="list-header rooms-header">
          <h3 class="ms-section-heading">${t("v4_rooms_to_clean")}</h3>
          ${count ? html`<small>${t("v4_rooms_selected", { count: num(count) })}</small>
            <button class="ms-btn ms-btn--sm" type="button">${t("v4_clear")}</button>` : nothing}
        </div>
        ${this.#settingsRow(anyDue)}
        ${state === "r4" ? html`<p class="check-line">${glyph(glyphAlert)}<span>${t("v4_room_preview_unavailable")}</span>
          <button class="ms-btn ms-btn--secondary" type="button">${t("v4_retry")}</button></p>` : nothing}
        <ul class="mock-stack room-list" role="group" aria-label=${t("v4_rooms_to_clean")}>
          ${floor.map((room) => {
            const isSelected = selected.includes(room.roomId);
            const info = isSelected ? lineFor(room.roomId) : { line: null, reasons: [], changed: false };
            return this.#row(room.roomId, room.name, isSelected, info.line, info.reasons, info.changed);
          })}
        </ul>`;
    return {
      workflow: "rooms",
      status: STATUS.ready,
      ...(count ? { peekLine: `${t("v4_rooms_selected", { count: num(count) })} · ${listOf(names)}` } : {}),
      back,
      heading: t("v4_choose_rooms"),
      body,
      bar: {
        primary,
        ...(ready && !this.narrowCompact ? { summary: roomsSummary(names) } : {}),
      },
      map: {
        mode: "map",
        robot: "dock",
        selected,
        chipClear: true,
        ...(empty ? { labels: false } : {}),
      },
    };
  }

  private get narrowCompact(): boolean {
    return this.layout === "compact-sheet";
  }
}
