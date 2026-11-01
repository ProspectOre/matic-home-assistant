import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { controls } from "./controls";
import { formControls } from "./form-controls";
import { mopControl } from "./mop-control";
import { icon, iconChevronDown, iconChevronRight, iconChevronUp, iconDue, iconNoticeWarning } from "./icons";
import { base, tokens } from "./tokens";
import type { CadenceReason, CleaningMode, CoverageSetting, NextRunPreviewRoom } from "./backend-contracts";
import {
  MAX_ROOM_SEQUENCE_SIZE,
  type Localize,
  type WorkspaceIntent,
  type WorkspaceState,
} from "./contracts";
import { ROOMS_VIEW_TAG } from "./element-tags";
import { isNativeSelectControl } from "./gesture-controller";
import { WORKSPACE_INTENT_EVENT } from "./map-canvas";
import { formatList, translate } from "./localize";
import { COVERAGES, MODES, cadenceProblem, coverageLabel, modeLabel, settingLabel } from "./plan-cadence";
import { dueLines, formatNumber, type Translate } from "./plan-copy";
import { admittedManualRoomPreview, canSelectRooms, hasStoppableWork, initialWorkspaceState } from "./state";
import {
  dailyLimitHeldRoomCopy,
  dailyLimitHeldSummaryCopy,
  dailyLimitProgressCopy,
  dailyLimitStatusCopy,
} from "./daily-limit-copy";

const DUE: readonly CadenceReason[] = ["mop_due", "coverage_due"];

type CatalogRoom = NonNullable<WorkspaceState["resources"]["plans"]["value"]>["rooms"][number];

const roomName = (state: WorkspaceState, roomId: string): string | null =>
  state.resources.plans.value?.rooms.find((room) => room.roomId === roomId)?.name ?? null;

const catalogNames = (state: WorkspaceState, roomIds: readonly string[]): string[] =>
  roomIds.flatMap((roomId) => {
    const name = roomName(state, roomId);
    return name === null ? [] : [name];
  });

/** The catalog names of the selected rooms, in selection order, never a scene id (R9). */
export const selectedRoomNames = (state: WorkspaceState): string[] => catalogNames(state, state.selection.roomIds);

/** The grip line while rooms are selected: the count and the names (shell.md Sheet). */
export const roomsGripLine = (t: Translate, state: WorkspaceState): string | null => {
  const names = selectedRoomNames(state);
  if (names.length === 0) return null;
  return t("v4_rooms_selected_names", "{count} selected · {rooms}", {
    count: formatNumber(state.locale, names.length),
    rooms: formatList(state.locale, names),
  });
};

/**
 * The action bar's line: the rooms in preview order once a preview is
 * admitted, else selection order, as one list of up to three entries, then
 * the dock the request always returns to (home-rooms.md §5 Clean, §6).
 */
export const roomsSummary = (t: Translate, state: WorkspaceState): string => {
  const admitted = admittedManualRoomPreview(state)?.preview;
  const names = catalogNames(state, admitted ? admitted.rooms.map((room) => room.roomId) : state.selection.roomIds);
  if (names.length === 0) return "";
  const rooms = names.length <= 3
    ? formatList(state.locale, names)
    : formatList(state.locale, [...names.slice(0, 2), t("v4_rooms_more", "{count} more", { count: formatNumber(state.locale, names.length - 2) })]);
  return t("v4_clean_rooms_summary", "{rooms}, then back to the dock", { rooms });
};

/**
 * What the polite region says after a map tap (R7): a refused tap repeats the
 * rows' reason on screen (the description while work runs, else the held
 * reason), an accepted one names the change; a room with no catalog name, or
 * a tap that changed nothing (the limit's notice speaks), says nothing.
 */
export const roomTapAnnouncement = (t: Translate, before: WorkspaceState, after: WorkspaceState, roomId: string): string | null => {
  const name = roomName(after, roomId) ?? roomName(before, roomId);
  if (name === null) return null;
  if (!canSelectRooms(before)) {
    return hasStoppableWork(before)
      ? t("v4_rooms_busy", "Can't change rooms until the robot finishes or stops.")
      : t("v4_reason_clean_rooms_verification", "Waiting for the map to be ready.");
  }
  const was = before.selection.roomIds.includes(roomId);
  const is = after.selection.roomIds.includes(roomId);
  if (was === is) return null;
  return is ? t("v4_room_added", "{room} added", { room: name }) : t("v4_room_removed", "{room} removed", { room: name });
};

const eventValue = (event: Event): string => (event.currentTarget as HTMLSelectElement).value;

/**
 * The Rooms view (home-rooms.md §3 Rooms, §4 R1-R10, §5): the description,
 * the list header, the whole-clean Cleaning settings row, the check lines and
 * the room rows in catalog order. One disclosure is open at a time (`_open`:
 * "settings" or a room id). While the selection is locked (R10), every
 * control stays readable and focusable but changes nothing (R22).
 */
export class MaticRoomsViewV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    _open: { state: true },
  };

  static override styles = [tokens, base, controls, formControls, css`
:host { display: block; min-inline-size: 0; }
.stack { display: grid; gap: var(--ms-space-3); }
.description { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-sm); line-height: var(--ms-lh-normal); }
.sr-only { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
.list-header { display: flex; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control-sm); }
.list-header h3 { flex: 1; margin: 0; }
.list-header small { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
.limit { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
@media (any-pointer: coarse) { .clear { min-block-size: var(--ms-control); min-inline-size: var(--ms-control); } }
/* The settings row: a full-row disclosure, its body below (design-system.md §4). */
.settings-row { display: grid; padding: 0; }
.ms-disclosure { display: flex; gap: var(--ms-space-2); align-items: center; min-inline-size: 0; min-block-size: var(--ms-control); padding: var(--ms-space-2) var(--ms-space-3); border: 0; border-radius: var(--ms-radius-sm); color: inherit; background: transparent; font: inherit; font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); text-align: start; cursor: pointer; }
.ms-disclosure:focus-visible { outline: 2px solid var(--ms-resolved-indicator, var(--ms-accent)); outline-offset: -2px; }
.ms-disclosure > span:first-child { flex: 1; }
.ms-disclosure__value { overflow: hidden; color: var(--ms-text-quiet); font-weight: var(--ms-w-regular); font-size: var(--ms-t-sm); text-overflow: ellipsis; white-space: nowrap; }
.ms-disclosure > .ms-icon { flex: none; transition: rotate var(--ms-fast) var(--ms-ease); }
.ms-disclosure[aria-expanded="true"] > .ms-icon { rotate: 90deg; }
.ms-disclosure:dir(rtl) > .ms-icon { scale: -1 1; }
/* scale applies before rotate, so the mirrored chevron turns the other way to point down. */
.ms-disclosure[aria-expanded="true"]:dir(rtl) > .ms-icon { rotate: -90deg; }
.settings-body, .row-expanded { display: grid; gap: var(--ms-space-3); padding: var(--ms-space-3); border-block-start: 1px solid var(--ms-line); }
/* Field labels sit on the selected (or hovered) row tint, which drops quiet
   text under AA; pull them towards the body colour as the featured card does. */
.settings-body .ms-field, .row-expanded .ms-field { color: color-mix(in srgb, var(--ms-text-quiet) 70%, var(--ms-text)); }
.split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ms-space-2); }
@media (max-width: 25rem) { .split { grid-template-columns: 1fr; } }
.hint { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.switch-row { display: flex; gap: var(--ms-space-3); align-items: center; min-block-size: var(--ms-control); }
.switch-copy { display: grid; flex: 1; gap: 0.125rem; min-inline-size: 0; font-size: var(--ms-t-md); }
.switch-copy small { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
/* Check lines: the glyph carries the tone, the text keeps its colour (design-system.md §5). */
.check-lines { display: grid; gap: var(--ms-space-2); }
.line { display: flex; gap: var(--ms-space-2); align-items: flex-start; margin: 0; font-size: var(--ms-t-sm); line-height: var(--ms-lh-snug); }
.line .ms-icon { flex: none; inline-size: 1.125rem; block-size: 1.125rem; margin-block-start: 0.0625rem; }
.line[data-tone="warning"] .ms-icon { color: var(--ms-warning); }
.line > span { flex: 1; }
.line .ms-btn { flex: none; }
/* Room rows: the label is the target up to the Settings button (§8 Targets). */
.room-list { display: grid; gap: var(--ms-space-2); }
.room-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; padding: 0; --ms-local: var(--ms-surface-card); }
.room-row:has(.ms-check :checked) { --ms-local: color-mix(in srgb, var(--ms-accent) 10%, var(--ms-surface-sunken)); border-color: var(--ms-resolved-indicator, var(--ms-accent)); }
.ms-check { display: flex; gap: var(--ms-space-3); align-items: center; min-inline-size: 0; min-block-size: var(--ms-control); padding: var(--ms-space-2) var(--ms-space-3); cursor: pointer; }
.ms-check input { flex: none; inline-size: 1.25rem; block-size: 1.25rem; margin: 0; accent-color: var(--ms-resolved-indicator, var(--ms-accent)); cursor: pointer; }
.ms-check input[aria-disabled="true"] { cursor: not-allowed; }
/* A held row reads in the disabled colour, as a demoted card does. */
.ms-check:has(input[aria-disabled="true"]) :is(bdi, small) { color: var(--ms-text-disabled); }
.row-lines { display: grid; flex: 1; gap: 0.125rem; min-inline-size: 0; }
.row-lines bdi { overflow: hidden; font-weight: var(--ms-w-bold); text-overflow: ellipsis; white-space: nowrap; }
.row-lines small { color: color-mix(in srgb, var(--ms-text) 78%, var(--ms-local)); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.row-expanded .hint { color: color-mix(in srgb, var(--ms-text) 78%, var(--ms-local)); }
.problem-line { display: flex; gap: var(--ms-space-1); align-items: flex-start; color: var(--ms-text); }
.problem-line .ms-icon { flex: none; inline-size: 1rem; block-size: 1rem; color: var(--ms-warning); }
.room-settings { margin-inline-end: var(--ms-space-1); }
.row-expanded { grid-column: 1 / -1; }
@media (forced-colors: active) {
  .room-row:has(.ms-check :checked) { forced-color-adjust: none; color: HighlightText; background: Highlight; border-color: Highlight; }
  .room-row:has(.ms-check :checked) .row-lines small { color: HighlightText; }
  .room-row:has(.ms-check :checked) input, .room-row:has(.ms-check :checked) .room-settings { forced-color-adjust: auto; }
  .line .ms-icon, .problem-line .ms-icon { color: CanvasText; }
}
@media (prefers-reduced-motion: reduce) { .ms-disclosure > .ms-icon { transition: none; } }
`];

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;
  /** The open disclosure: "settings" or a selected room id, one at a time (§5). */
  protected _open: string | null = null;

  readonly #t: Translate = (key, fallback, placeholders) => translate(this.localize, key, fallback, placeholders);

  #intent(intent: WorkspaceIntent): void {
    this.dispatchEvent(new CustomEvent(WORKSPACE_INTENT_EVENT, { detail: intent, bubbles: true, composed: true }));
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("state")) return;
    // A deselected room's disclosure closes with it.
    if (this._open && this._open !== "settings" && !this.state.selection.roomIds.includes(this._open)) this._open = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.#keydown, true);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("keydown", this.#keydown, true);
    super.disconnectedCallback();
  }

  // An opened disclosure is brought into view: on a phone's half sheet its
  // controls would otherwise sit below the fold.
  protected override updated(changed: PropertyValues<this>): void {
    if ((changed as Map<string, unknown>).has("_open") && this._open !== null) this.renderRoot.querySelector(".settings-body, .row-expanded")?.scrollIntoView({ block: "nearest" });
  }

  // Escape closes the open disclosure and returns to its button before the
  // shell sees it (shell.md §5 Escape order), from anywhere in the shell
  // (the action bar, the closed Map options button after Escape 1 closed the
  // menu; Review Focus 4) unless an open top layer outside this view (a menu,
  // a dialog, an expanded launcher) is on the path. A native select keeps
  // Escape.
  readonly #keydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this._open === null || isNativeSelectControl(event)) return;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const path = event.composedPath();
    const panel = (this.getRootNode() as ShadowRoot).host;
    const shell = (panel.getRootNode() as ShadowRoot).host;
    if (!path.includes(shell)) return;
    const topLayer = (node: EventTarget): boolean => node instanceof HTMLElement && node.getRootNode() !== this.renderRoot
      && (node.getAttribute("role") === "menu" || node.getAttribute("role") === "dialog" || node.getAttribute("aria-expanded") === "true");
    if (path.some(topLayer)) return;
    event.preventDefault();
    const selector = this._open === "settings" ? '[data-disclosure="settings"]' : `[data-room-disclosure="${CSS.escape(this._open)}"]`;
    this._open = null;
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(selector)?.focus());
  };

  #toggle(id: string): void {
    this._open = this._open === id ? null : id;
  }

  // A held select (R22) keeps its value: the change is undone in place.
  #select(held: boolean, current: string, apply: (value: string) => void) {
    return (event: Event): void => {
      if (held) {
        (event.currentTarget as HTMLSelectElement).value = current;
        return;
      }
      apply(eventValue(event));
    };
  }

  #describe(...ids: (string | null | false | undefined)[]): string | typeof nothing {
    const list = ids.filter((id): id is string => Boolean(id));
    return list.length ? list.join(" ") : nothing;
  }

  #settingsRow(state: WorkspaceState, held: string | null, anyDue: boolean, preview: readonly NextRunPreviewRoom[] | null) {
    const t = this.#t;
    const open = this._open === "settings";
    const mode = state.selection.cleaningMode;
    const coverage = state.selection.coverageSetting;
    // The row's value is the whole-clean setting its selects show, unless a
    // selected room was changed on its own (home-rooms.md §5 Settings).
    const mixed = state.selection.roomSettings.some((room) => state.selection.roomIds.includes(room.roomId)
      && (room.cleaningMode !== mode || (mode !== "mop" && room.coverageSetting !== coverage)));
    const value = mixed
      ? t("v4_settings_mixed", "Different per room")
      : settingLabel(t, { cleaningMode: mode, coverageSetting: coverage });
    const mop = mode === "mop";
    const locked = held !== null;
    return html`
      <div class="ms-row settings-row">
        <button
          class="ms-disclosure"
          type="button"
          data-disclosure="settings"
          aria-expanded=${String(open)}
          aria-controls="clean-settings"
          @click=${() => this.#toggle("settings")}
        ><span>${t("v4_clean_settings", "Cleaning settings")}</span><span class="ms-disclosure__value">${value}</span>${icon(iconChevronRight)}</button>
        ${open ? html`
          <div id="clean-settings" class="settings-body">
            <div class="split">
              <label class="ms-field">${t("v4_cleaning_system", "Cleaning mode")}
                <select
                  class="ms-select"
                  aria-disabled=${locked ? "true" : nothing}
                  aria-describedby=${this.#describe(held)}
                  .value=${mode}
                  @change=${this.#select(locked, mode, (next) => this.#intent({ type: "set-clean-settings", cleaningMode: next as CleaningMode }))}
                >${MODES.map((option) => html`<option value=${option} ?selected=${option === mode}>${modeLabel(t, option)}</option>`)}</select>
              </label>
              ${mode === "mop" ? nothing : html`<label class="ms-field">${t("vacuum_coverage", "Vacuum coverage")}
                <select
                  class="ms-select"
                  aria-disabled=${locked || mop ? "true" : nothing}
                  aria-describedby=${this.#describe(held)}
                  .value=${coverage}
                  @change=${this.#select(locked || mop, coverage, (next) => this.#intent({ type: "set-clean-settings", coverageSetting: next as CoverageSetting }))}
                >${COVERAGES.map((option) => html`<option value=${option} ?selected=${option === coverage}>${coverageLabel(t, option)}</option>`)}</select>
              </label>`}
            </div>
            ${mopControl(t, state, preview?.some((room) => room.cleaningMode !== "vacuum") ? "vacuum_and_mop" : mode, "clean")}
            ${anyDue ? html`
              <div class="switch-row">
                <span class="switch-copy">
                  <span id="due-label">${t("v4_include_due_schedule", "Use room schedules")}</span>
                </span>
                <button
                  class="ms-switch"
                  type="button"
                  role="switch"
                  aria-checked=${String(state.selection.useRoomSchedule)}
                  aria-labelledby="due-label"
                  aria-describedby=${this.#describe(held)}
                  aria-disabled=${locked ? "true" : nothing}
                  @click=${() => { if (!locked) this.#intent({ type: "set-use-room-schedule", value: !state.selection.useRoomSchedule }); }}
                ></button>
              </div>
            ` : nothing}
          </div>
        ` : nothing}
      </div>
    `;
  }

  #checkLines(state: WorkspaceState, preview: readonly NextRunPreviewRoom[] | null, boundaries: number, blocker: string | null) {
    const t = this.#t;
    const failed = state.manualRoomPreview.status === "error";
    const due = preview ? dueLines(t, state.locale, preview) : [];
    const dailyHeld = admittedManualRoomPreview(state)?.preview.dailyLimitHeldRooms ?? [];
    const dailyHeldCopy = dailyHeld.length
      ? dailyLimitHeldSummaryCopy(formatList(state.locale, dailyHeld.map((room) => dailyLimitHeldRoomCopy(
        room, t, (value) => formatNumber(state.locale, value),
      ))), t)
      : null;
    const blockedLine = blocker === null ? null
      : blocker === "daily_limit_reached"
        ? t("v4_daily_limit_blocker", "Can't run while daily limits hold the selected rooms. Review the reasons, refresh the plan, or change the room limits.")
      : blocker === "invalid_cadence_policy" && state.selection.useRoomSchedule
        && state.selection.roomSettings.some((room) => room.cleaningMode !== "vacuum")
        ? t("v4_room_preview_schedule_override", "Turn off \"Use room schedules\" to use this cleaning mode.")
        : t("v4_room_preview_blocked", "These rooms can't be cleaned with the current settings. Change the settings or the rooms, then try again.");
    if (!due.length && !boundaries && !failed && !blockedLine && !dailyHeldCopy) return nothing;
    return html`
      <div class="check-lines">
        ${due.map((line) => html`<p class="line" data-tone="due">${icon(iconDue)}<span>${line}</span></p>`)}
        ${dailyHeldCopy ? html`<p class="line" data-tone="warning">${icon(iconNoticeWarning)}<span>${dailyHeldCopy}</span></p>` : nothing}
        ${boundaries ? html`<p class="line" data-tone="info">${icon(iconDue)}<span>${t("v4_room_parts", "The robot cleans in {count} parts and may stop at the dock between parts.", { count: formatNumber(state.locale, boundaries + 1) })}</span></p>` : nothing}
        ${failed ? html`
          <p class="line" data-tone="warning">${icon(iconNoticeWarning)}<span>${t("v4_room_preview_unavailable", "Home Assistant couldn't check the room settings.")}</span>
            <button class="ms-btn ms-btn--sm ms-btn--secondary" type="button" @click=${() => this.#intent({ type: "retry-room-preview" })}>${t("v4_retry", "Try again")}</button>
          </p>
        ` : nothing}
        ${blockedLine ? html`<p class="line" data-tone="warning">${icon(iconNoticeWarning)}<span>${blockedLine}</span></p>` : nothing}
      </div>
    `;
  }

  #row(state: WorkspaceState, room: CatalogRoom, index: number, held: string | null, atLimit: boolean, previewRoom: NextRunPreviewRoom | null) {
    const t = this.#t;
    const checked = state.selection.roomIds.includes(room.roomId);
    const settings = state.selection.roomSettings.find((candidate) => candidate.roomId === room.roomId)
      ?? { roomId: room.roomId, cleaningMode: state.selection.cleaningMode, coverageSetting: state.selection.coverageSetting };
    const limited = atLimit && !checked;
    const locked = held !== null;
    const loading = state.manualRoomPreview.status === "loading";
    const reasons = previewRoom?.cadenceReasons ?? room.sharedCadenceReasons ?? room.sharedCadenceProgress?.reasons ?? [];
    const problem = checked ? cadenceProblem(t, reasons) : null;
    const dailyLimit = admittedManualRoomPreview(state)?.preview.dailyLimitHeldRooms
      ?.find((candidate) => candidate.roomId === room.roomId)
      ?? previewRoom?.dailyLimit ?? room.dailyLimit;
    const open = this._open === room.roomId;
    const bodyId = `room-settings-${index}`;
    const mop = settings.cleaningMode === "mop";
    return html`
      <div class="ms-row room-row">
        <label class="ms-check">
          <input
            type="checkbox"
            .checked=${checked}
            aria-disabled=${locked || limited ? "true" : nothing}
            aria-describedby=${this.#describe(held ?? (limited && "rooms-limit"))}
            @click=${(event: Event) => { if (locked || limited) event.preventDefault(); }}
            @change=${() => this.#intent({ type: "toggle-room", roomId: room.roomId })}
          >
          <span class="row-lines">
            <bdi>${room.name}</bdi>
            ${checked ? html`<small>${loading ? t("v4_room_preview_loading", "Checking settings…") : settingLabel(t, previewRoom ?? settings)}</small>` : nothing}
            ${problem ? html`<small class="problem-line">${icon(iconNoticeWarning)}<span>${problem}</span></small>` : nothing}
            ${dailyLimit?.reached ? html`<small class="problem-line" data-daily-limit-reached>${icon(iconNoticeWarning)}<span>${dailyLimitStatusCopy(
              dailyLimit, t, (value) => formatNumber(state.locale, value),
            )}</span></small>` : dailyLimit?.limit !== null && dailyLimit?.limit !== undefined ? html`<small data-daily-limit-progress>${dailyLimitProgressCopy(
              dailyLimit, t, (value) => formatNumber(state.locale, value),
            )}</small>` : nothing}
          </span>
        </label>
        ${checked ? html`
          <button
            class="ms-btn ms-btn--icon room-settings"
            type="button"
            data-room-disclosure=${room.roomId}
            aria-label=${t("v4_room_settings_named", "Settings for {room}", { room: room.name })}
            aria-expanded=${String(open)}
            aria-controls=${bodyId}
            @click=${() => this.#toggle(room.roomId)}
          >${icon(open ? iconChevronUp : iconChevronDown)}</button>
        ` : nothing}
        ${open ? html`
          <div class="row-expanded" id=${bodyId}>
            <div class="split">
              <label class="ms-field">${t("v4_cleaning_system", "Cleaning mode")}
                <select
                  class="ms-select"
                  aria-label=${t("v4_room_cleaning_system_named", "Cleaning mode for {room}", { room: room.name })}
                  aria-disabled=${locked ? "true" : nothing}
                  aria-describedby=${this.#describe(held)}
                  .value=${settings.cleaningMode}
                  @change=${this.#select(locked, settings.cleaningMode, (next) => this.#intent({ type: "patch-room-settings", roomId: room.roomId, cleaningMode: next as CleaningMode }))}
                >${MODES.map((option) => html`<option value=${option} ?selected=${option === settings.cleaningMode}>${modeLabel(t, option)}</option>`)}</select>
              </label>
              ${settings.cleaningMode === "mop" ? nothing : html`<label class="ms-field">${t("vacuum_coverage", "Vacuum coverage")}
                <select
                  class="ms-select"
                  aria-label=${t("v4_room_vacuum_coverage_named", "Vacuum coverage for {room}", { room: room.name })}
                  aria-disabled=${locked || mop ? "true" : nothing}
                  aria-describedby=${this.#describe(held)}
                  .value=${settings.coverageSetting}
                  @change=${this.#select(locked || mop, settings.coverageSetting, (next) => this.#intent({ type: "patch-room-settings", roomId: room.roomId, coverageSetting: next as CoverageSetting }))}
                >${COVERAGES.map((option) => html`<option value=${option} ?selected=${option === settings.coverageSetting}>${coverageLabel(t, option)}</option>`)}</select>
              </label>`}
            </div>
            ${mopControl(t, state, settings.cleaningMode === "vacuum" ? previewRoom?.cleaningMode ?? "vacuum" : settings.cleaningMode, `room-${index}`)}
            <label class="ms-field">${t("v4_daily_limit_title", "Daily clean limit")}
              <select
                class="ms-select"
                data-daily-limit=${room.roomId}
                aria-label=${t("v4_daily_limit_room_named", "Daily clean limit for {room}", { room: room.name })}
                aria-disabled=${locked ? "true" : nothing}
                aria-describedby=${this.#describe(held)}
                .value=${room.dailyLimit?.limit === null || room.dailyLimit?.limit === undefined ? "" : String(room.dailyLimit.limit)}
                @change=${(event: Event) => {
                  const select = event.currentTarget as HTMLSelectElement;
                  if (locked) { select.value = room.dailyLimit?.limit == null ? "" : String(room.dailyLimit.limit); return; }
                  const raw = select.value;
                  this.#intent({ type: "set-room-daily-limit", roomId: room.roomId, limit: raw === "" ? null : Number(raw) });
                }}
              >
                <option value="">${t("v4_daily_limit_unlimited", "No daily limit")}</option>
                ${Array.from({ length: 100 }, (_, i) => i + 1).map((limit) => html`<option value=${String(limit)} ?selected=${room.dailyLimit?.limit === limit}>${t("v4_daily_limit_per_day", "{count} per day", { count: formatNumber(state.locale, limit) })}</option>`)}
              </select>
            </label>
            ${room.dailyLimit?.reached ? html`<p class="hint">${dailyLimitStatusCopy(
              room.dailyLimit, t, (value) => formatNumber(state.locale, value),
            )}</p>` : room.dailyLimit?.limit !== null && room.dailyLimit?.limit !== undefined ? html`<p class="hint">${dailyLimitProgressCopy(
              room.dailyLimit, t, (value) => formatNumber(state.locale, value),
            )}</p>` : nothing}
          </div>
        ` : nothing}
      </div>
    `;
  }

  protected override render() {
    const t = this.#t;
    const state = this.state;
    const rooms = state.resources.plans.value?.rooms ?? [];
    const empty = rooms.length === 0;
    const busy = hasStoppableWork(state);
    const locked = !canSelectRooms(state);
    // R22: the shared description while work runs, else an sr-only reason.
    const held = locked ? (busy ? "rooms-description" : "rooms-held") : null;
    const count = state.selection.roomIds.length;
    const atLimit = count >= MAX_ROOM_SEQUENCE_SIZE;
    const admitted = admittedManualRoomPreview(state)?.preview ?? null;
    const preview = admitted ? admitted.rooms.map((room) => ({ ...room, name: roomName(state, room.roomId) ?? room.name })) : null;
    const previewRoom = (roomId: string): NextRunPreviewRoom | null => preview?.find((room) => room.roomId === roomId) ?? null;
    const anyDue = (preview ?? []).some((room) => room.cadenceReasons.some((reason) => DUE.includes(reason)))
      || rooms.some((room) => state.selection.roomIds.includes(room.roomId)
        && (room.sharedCadenceProgress?.mopDue || room.sharedCadenceProgress?.coverageDue
          || (room.sharedCadenceReasons ?? room.sharedCadenceProgress?.reasons ?? []).some((reason) => DUE.includes(reason))));
    const description = busy
      ? t("v4_rooms_busy", "Can't change rooms until the robot finishes or stops.")
      : empty
        ? t("v4_no_rooms_plans", "This floor has no rooms yet. Name rooms in the Matic app to see them here.")
        : t("v4_choose_rooms_detail", "Choose rooms on the map or in the list.");
    return html`
      <div class="stack">
        <p class="description" id="rooms-description">${description}</p>
        ${locked && !busy ? html`<span class="sr-only" id="rooms-held">${t("v4_reason_clean_rooms_verification", "Waiting for the map to be ready.")}</span>` : nothing}
        ${empty ? nothing : html`
          <div class="list-header">
            <h3 class="ms-section-heading" id="rooms-heading">${t("v4_rooms_to_clean", "Rooms to clean")}</h3>
            ${count ? html`
              <small>${t("v4_rooms_selected", "{count} selected", { count: formatNumber(state.locale, count) })}</small>
              <button
                class="ms-btn ms-btn--sm ms-btn--secondary clear"
                type="button"
                aria-disabled=${locked ? "true" : nothing}
                aria-describedby=${this.#describe(held)}
                @click=${() => { if (!locked) this.#intent({ type: "clear-selection" }); }}
              >${t("v4_clear", "Clear")}</button>
            ` : nothing}
          </div>
          ${atLimit ? html`<p class="limit" id="rooms-limit">${t("v4_room_limit_reached", "Up to {limit} rooms fit in one clean, so remove one to add another.", { limit: MAX_ROOM_SEQUENCE_SIZE })}</p>` : nothing}
          ${this.#settingsRow(state, held, anyDue, preview)}
          ${this.#checkLines(state, preview, admitted?.missionBoundaries.length ?? 0, admitted?.blocker ?? null)}
          <div class="room-list" role="group" aria-labelledby="rooms-heading">
            ${rooms.map((room, index) => this.#row(state, room, index, held, atLimit, previewRoom(room.roomId)))}
          </div>
        `}
      </div>
    `;
  }
}


if (!customElements.get(ROOMS_VIEW_TAG)) customElements.define(ROOMS_VIEW_TAG, MaticRoomsViewV4);
