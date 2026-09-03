import { LitElement, css, nothing } from "lit";
import { controls } from "./controls";
import { base, tokens } from "./tokens";
import { html, unsafeStatic } from "lit/static-html.js";

import type {
  CleaningMode,
  CoverageSetting,
  PlanRoom,
} from "./backend-contracts";
import type { Localize, WorkspaceIntent, WorkspaceState } from "./contracts";
import { PRECISION_CONTROLS_TAG, WORKFLOW_TAG } from "./element-tags";
import { WORKSPACE_INTENT_EVENT } from "./map-canvas";
import "./precision-controls";
import { initialWorkspaceState } from "./state";
import { translate } from "./localize";

const modes: readonly CleaningMode[] = ["vacuum", "mop", "vacuum_and_mop"];
const coverage: readonly CoverageSetting[] = ["quick", "standard", "heavy_duty"];

const eventValue = (event: Event): string => (event.currentTarget as HTMLInputElement).value;
const eventChecked = (event: Event): boolean => (event.currentTarget as HTMLInputElement).checked;
const precisionControlsTag = unsafeStatic(PRECISION_CONTROLS_TAG);

export class MaticMapWorkflowV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
  };

  static override styles = [tokens, base, controls, css`
:host { display: block; min-inline-size: 0; }
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
.problem, .notice[data-tone="error"] { --ms-local: color-mix(in srgb, var(--ms-danger) 9%, var(--ms-surface-card)); color: color-mix(in srgb, var(--ms-danger) 82%, var(--ms-text)); background: var(--ms-local); }
.notice[data-tone="success"] { --ms-local: color-mix(in srgb, var(--ms-success) 10%, var(--ms-surface-card)); color: color-mix(in srgb, var(--ms-success) 82%, var(--ms-text)); background: var(--ms-local); }
.notice[data-tone="warning"] { --ms-local: color-mix(in srgb, var(--ms-warning) 11%, var(--ms-surface-card)); color: color-mix(in srgb, var(--ms-warning) 82%, var(--ms-text)); background: var(--ms-local); }
.split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ms-space-2); }
.list { display: grid; gap: var(--ms-space-2); }
.room { display: grid; gap: var(--ms-space-2); }
.room-choice { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control-sm); }
.room-choice input { inline-size: 1.2rem; block-size: 1.2rem; }
.room-settings { padding-block-start: 0.125rem; padding-inline-start: 1.8rem; }
.plan-options { --ms-local: var(--ms-surface-sunken); display: grid; gap: var(--ms-space-2); padding: var(--ms-space-3); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); background: var(--ms-local); }
.plan-room { display: grid; gap: var(--ms-space-2); }
.toolbar { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.checkbox { display: flex; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control); font-size: var(--ms-t-xs); font-weight: var(--ms-w-medium); }
.checkbox input { inline-size: 1.2rem; block-size: 1.2rem; }
.floor small, .snapshot small, .list-button small { margin-inline-start: auto; color: color-mix(in srgb, var(--ms-text) 78%, var(--ms-local)); font-weight: var(--ms-w-regular); }
.timeline { display: grid; gap: var(--ms-space-2); }
.timeline input[type="range"] { inline-size: 100%; min-block-size: var(--ms-control); }
.diagnostics { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--ms-space-2) var(--ms-space-3); margin: 0; font-size: var(--ms-t-xs); }
.diagnostics dt { color: var(--ms-text-quiet); }
.diagnostics dd { margin: 0; font-weight: var(--ms-w-medium); }
@media (max-width: 25rem) { .split { grid-template-columns: 1fr; } }
`];

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;

  #t(key: string, fallback: string, placeholders?: Record<string, string | number>): string {
    return translate(this.localize, key, fallback, placeholders);
  }

  #modeLabel(mode: CleaningMode): string {
    if (mode === "vacuum") return this.#t("vacuum", "Vacuum");
    if (mode === "mop") return this.#t("mop", "Mop");
    return this.#t("vacuum_and_mop", "Vacuum + mop");
  }

  #coverageLabel(value: CoverageSetting): string {
    if (value === "quick") return this.#t("quick", "Quick");
    if (value === "standard") return this.#t("standard", "Optimal");
    return this.#t("heavy_duty", "Heavy Duty");
  }

  #intent(intent: WorkspaceIntent): void {
    this.dispatchEvent(new CustomEvent(WORKSPACE_INTENT_EVENT, {
      detail: intent,
      bubbles: true,
      composed: true,
    }));
  }

  #notice() {
    return this.state.notice ? html`
      <div class="notice" data-tone=${this.state.notice.tone} role=${this.state.notice.tone === "error" ? "alert" : "status"}>
        ${this.state.notice.text}
      </div>
    ` : nothing;
  }

  #resource(status: string, problem: string | null, body: unknown) {
    if (status === "loading" || status === "idle") return html`<div class="loading" role="status">${this.#t("map_loading", "Loading…")}</div>`;
    if (status === "error") return html`<div class="problem" role="alert">${this.#t("v4_workspace_unavailable", "This workspace is unavailable right now.")} ${problem === "request-failed" ? this.#t("v4_try_again", "Try again shortly.") : this.#t("v4_return_live_retry", "Return to the live map and retry.")}</div>`;
    if (status === "empty") return html`<div class="empty">${this.#t("v4_nothing_saved", "Nothing saved yet.")}</div>`;
    return body;
  }

  #rooms() {
    const plans = this.state.resources.plans;
    return this.#resource(plans.status, plans.problem, html`
      <div class="stack">
        <div class="list" role="group" aria-label=${this.#t("v4_rooms_to_clean", "Rooms to clean")}>
          ${(plans.value?.rooms || []).map((room) => {
            const checked = this.state.selection.roomIds.includes(room.roomId);
            return html`
              <div class="room ms-row ms-row--stack" data-selected=${String(checked)}>
                <label class="room-choice">
                  <input
                    type="checkbox"
                    .checked=${checked}
                    @change=${() => this.#intent({ type: "toggle-room", roomId: room.roomId })}
                  >
                  <strong>${room.name}</strong>
                  ${checked ? html`<small>${this.#t("v4_room_ready", "Ready")}</small>` : nothing}
                </label>
                ${checked ? this.#roomSettings(
                  room.roomId,
                  this.state.selection.roomSettings.find((candidate) => candidate.roomId === room.roomId)
                    || { roomId: room.roomId, cleaningMode: "vacuum", coverageSetting: "standard" },
                ) : nothing}
              </div>
            `;
          })}
        </div>
        <p class="subtle">${this.#t("v4_room_selection_hint", "Select rooms here or directly on the map. The map and list stay in sync.")}</p>
        ${this.#notice()}
      </div>
    `);
  }

  #roomSettings(roomId: string, room: PlanRoom) {
    return html`
      <div class="split room-settings">
        <label class="field ms-field">${this.#t("v4_cleaning_system", "Cleaning system")}
          <select
            aria-label=${this.#t("v4_room_cleaning_system", "Cleaning system for room")}
            .value=${room.cleaningMode}
            @change=${(event: Event) => this.#intent({
              type: "patch-room-settings",
              roomId,
              cleaningMode: eventValue(event) as CleaningMode,
            })}
          >${modes.map((mode) => html`<option value=${mode} ?selected=${mode === room.cleaningMode}>${this.#modeLabel(mode)}</option>`)}</select>
        </label>
        <label class="field ms-field">${this.#t("cleaning_mode", "Cleaning mode")}
          <select
            aria-label=${this.#t("v4_room_cleaning_mode", "Cleaning mode for room")}
            .value=${room.coverageSetting}
            @change=${(event: Event) => this.#intent({
              type: "patch-room-settings",
              roomId,
              coverageSetting: eventValue(event) as CoverageSetting,
            })}
          >${coverage.map((option) => html`<option value=${option} ?selected=${option === room.coverageSetting}>${this.#coverageLabel(option)}</option>`)}</select>
        </label>
      </div>
    `;
  }

  #togglePlanRoom(roomId: string): void {
    const current = this.state.planDraft.rooms;
    const existing = current.find((room) => room.roomId === roomId);
    const rooms = existing
      ? current.filter((room) => room.roomId !== roomId)
      : [...current, { roomId, cleaningMode: "vacuum", coverageSetting: "standard" } satisfies PlanRoom];
    this.#intent({ type: "patch-plan-draft", patch: { rooms } });
  }

  #patchPlanRoom(index: number, patch: Partial<PlanRoom>): void {
    const rooms = this.state.planDraft.rooms.map((room, candidate) =>
      candidate === index ? { ...room, ...patch } : room);
    this.#intent({ type: "patch-plan-draft", patch: { rooms } });
  }

  #movePlanRoom(index: number, delta: number): void {
    const next = index + delta;
    const rooms = [...this.state.planDraft.rooms];
    if (next < 0 || next >= rooms.length) return;
    const [room] = rooms.splice(index, 1);
    if (!room) return;
    rooms.splice(next, 0, room);
    this.#intent({ type: "patch-plan-draft", patch: { rooms } });
  }

  #plans() {
    const resource = this.state.resources.plans;
    const catalog = resource.value;
    const draft = this.state.planDraft;
    const selectedRows = draft.rooms.map((room) => ({
      room,
      label: catalog?.rooms.find((candidate) => candidate.roomId === room.roomId)?.name || "Room",
      selected: true,
    }));
    const availableRows = (catalog?.rooms || [])
      .filter((room) => !draft.rooms.some((candidate) => candidate.roomId === room.roomId))
      .map((room) => ({
        room: { roomId: room.roomId, cleaningMode: "vacuum", coverageSetting: "standard" } satisfies PlanRoom,
        label: room.name,
        selected: false,
      }));
    const roomRows = [...selectedRows, ...availableRows];
    return this.#resource(resource.status, resource.problem, html`
      <div class="stack">
        <div class="split">
          <label class="field ms-field">${this.#t("v4_saved_plan", "Saved plan")}
            <select
              .value=${this.state.selection.planId || ""}
              @change=${(event: Event) => this.#intent({ type: "select-plan", planId: eventValue(event) || null })}
            >
              <option value="">${this.#t("plan_new", "New plan")}</option>
              ${(catalog?.plans || []).map((plan) => html`<option value=${plan.id}>${plan.name}</option>`) }
            </select>
          </label>
          <button class="list-button ms-row ms-row" type="button" @click=${() => this.#intent({ type: "select-plan", planId: null })}>＋ ${this.#t("plan_new", "New plan")}</button>
        </div>
        <label class="field ms-field">${this.#t("plan_name", "Plan name")}
          <input
            maxlength="128"
            autocomplete="off"
            .value=${draft.name}
            @input=${(event: Event) => this.#intent({ type: "patch-plan-draft", patch: { name: eventValue(event) } })}
          >
        </label>
        <div class="split">
          <label class="field ms-field">${this.#t("plan_run_behavior", "Run order")}
            <select
              .value=${draft.runBehavior}
              @change=${(event: Event) => this.#intent({
                type: "patch-plan-draft",
                patch: { runBehavior: eventValue(event) === "ordered" ? "ordered" : "intelligent" },
              })}
            >
              <option value="intelligent">${this.#t("plan_intelligent", "Smart rotation")}</option>
              <option value="ordered">${this.#t("plan_ordered", "Listed order")}</option>
            </select>
          </label>
          <label class="checkbox"><input type="checkbox" .checked=${draft.enabled} @change=${(event: Event) => this.#intent({ type: "patch-plan-draft", patch: { enabled: eventChecked(event) } })}>${this.#t("plan_enabled", "Enabled")}</label>
        </div>
        <div class="plan-options" aria-label=${this.#t("v4_completion_options", "Completion options")}>
          <label class="checkbox"><input type="checkbox" .checked=${draft.returnToBase} @change=${(event: Event) => this.#intent({ type: "patch-plan-draft", patch: { returnToBase: eventChecked(event) } })}>${this.#t("plan_return_to_base", "Return to the dock when finished")}</label>
          <label class="checkbox"><input type="checkbox" .checked=${draft.finishCurrentRoom} @change=${(event: Event) => this.#intent({ type: "patch-plan-draft", patch: { finishCurrentRoom: eventChecked(event) } })}>${this.#t("plan_finish_room", "Finish the active room after Stop")}</label>
          ${draft.finishCurrentRoom ? html`<label class="field ms-field">${this.#t("plan_threshold", "Finish threshold")} · ${draft.finishCurrentRoomThreshold}%<input type="range" min="0" max="100" step="5" .value=${String(draft.finishCurrentRoomThreshold)} @input=${(event: Event) => this.#intent({ type: "patch-plan-draft", patch: { finishCurrentRoomThreshold: Number(eventValue(event)) } })}></label>` : nothing}
        </div>
        <div class="list" aria-label=${this.#t("plan_rooms", "Plan rooms")}>
          ${roomRows.map(({ room, label, selected }) => {
            const index = selected
              ? draft.rooms.findIndex((candidate) => candidate.roomId === room.roomId)
              : -1;
            return html`
              <div class="room plan-room" data-selected=${String(selected)}>
                <label class="room-choice">
                  <input type="checkbox" .checked=${selected} @change=${() => this.#togglePlanRoom(room.roomId)}>
                  <strong>${selected ? `${index + 1}. ` : ""}${label}</strong>
                  ${selected ? html`
                    <span>
                      <button class="icon-button ms-btn ms-btn--icon ms-btn--sm" type="button" aria-label=${this.#t("move_room_up", "Move {room} earlier", { room: label })} ?disabled=${index === 0} @click=${(event: Event) => { event.preventDefault(); this.#movePlanRoom(index, -1); }}>↑</button>
                      <button class="icon-button ms-btn ms-btn--icon ms-btn--sm" type="button" aria-label=${this.#t("move_room_down", "Move {room} later", { room: label })} ?disabled=${index === draft.rooms.length - 1} @click=${(event: Event) => { event.preventDefault(); this.#movePlanRoom(index, 1); }}>↓</button>
                    </span>
                  ` : nothing}
                </label>
                ${selected ? html`
                  <div class="split room-settings">
                    <label class="field ms-field">${this.#t("v4_cleaning_system", "Cleaning system")}
                      <select .value=${room.cleaningMode} @change=${(event: Event) => this.#patchPlanRoom(index, { cleaningMode: eventValue(event) as CleaningMode })}>${modes.map((mode) => html`<option value=${mode} ?selected=${mode === room.cleaningMode}>${this.#modeLabel(mode)}</option>`)}</select>
                    </label>
                    <label class="field ms-field">${this.#t("cleaning_mode", "Cleaning mode")}
                      <select .value=${room.coverageSetting} @change=${(event: Event) => this.#patchPlanRoom(index, { coverageSetting: eventValue(event) as CoverageSetting })}>${coverage.map((option) => html`<option value=${option} ?selected=${option === room.coverageSetting}>${this.#coverageLabel(option)}</option>`)}</select>
                    </label>
                  </div>
                ` : nothing}
              </div>
            `;
          })}
        </div>
        <div class="toolbar">
          ${draft.id ? html`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#t("plan_delete", "Delete plan")}
              data-dialog-launcher="confirmDeletePlan"
              @click=${() => this.#intent({ type: "open-dialog", dialog: "confirmDeletePlan" })}
            >${this.#t("plan_delete", "Delete")}</button>
          ` : nothing}
        </div>
        ${this.#notice()}
      </div>
    `);
  }

  #draw() {
    const areas = this.state.resources.areas;
    return html`
      <div class="stack">
        <${precisionControlsTag} .state=${this.state} .localize=${this.localize}></${precisionControlsTag}>
        <p class="subtle">${this.#t("v4_draw_floor_hint", "Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        <div class="toolbar">
          <button
            class="ms-btn ms-btn--secondary"
            type="button"
            ?disabled=${this.state.draw.circles.length === 0}
            @click=${() => this.#intent({ type: "clear-draft" })}
          >${this.#t("clear", "Clear")}</button>
        </div>
        ${this.#resource(areas.status, areas.problem, html`
          <div class="list" aria-label=${this.#t("area_workspace_title", "Saved custom areas")}>
            <button class="list-button ms-row ms-row" type="button" @click=${() => this.#intent({ type: "select-area", areaId: null })}>＋ ${this.#t("area_new", "New outline")}</button>
            ${(areas.value?.areas || []).map((area) => html`
              <button class="list-button ms-row ms-row" type="button" @click=${() => {
                this.#intent({ type: "select-area", areaId: area.id });
                this.#intent({ type: "open-workflow", workflow: "areaReview" });
              }}>
                <span>${area.name}</span>
                <small>${area.status === "current" ? this.#t("area_workspace_ready", "Ready") : this.#t("v4_review", "Review")}</small>
              </button>
            `)}
          </div>
        `)}
      </div>
    `;
  }

  #areaReview() {
    const draft = this.state.areaDraft;
    const needsReview = draft.canRebind || draft.status === "review";
    const stale = draft.status === "stale" || draft.status === "unknown";
    return html`
      <div class="stack">
        ${needsReview ? html`<div class="notice" data-tone="warning" role="status">${this.#t("area_review_required", "Review the saved outline on this current map, then confirm it.")}</div>` : nothing}
        ${stale ? html`<div class="problem" role="alert">${this.#t("area_redraw_required", "This outline no longer matches the current room map. Redraw it before saving.")}</div>` : nothing}
        <label class="field ms-field">${this.#t("area_name", "Area name")}
          <input maxlength="128" autocomplete="off" .value=${draft.name} @input=${(event: Event) => this.#intent({ type: "patch-area-draft", patch: { name: eventValue(event) } })}>
        </label>
        <div class="split">
          <label class="field ms-field">${this.#t("v4_cleaning_system", "Cleaning system")}
            <select .value=${draft.cleaningMode} @change=${(event: Event) => this.#intent({ type: "patch-area-draft", patch: { cleaningMode: eventValue(event) as CleaningMode } })}>${modes.map((mode) => html`<option value=${mode} ?selected=${mode === draft.cleaningMode}>${this.#modeLabel(mode)}</option>`)}</select>
          </label>
          <label class="field ms-field">${this.#t("cleaning_mode", "Cleaning mode")}
            <select .value=${draft.coverageSetting} @change=${(event: Event) => this.#intent({ type: "patch-area-draft", patch: { coverageSetting: eventValue(event) as CoverageSetting } })}>${coverage.map((option) => html`<option value=${option} ?selected=${option === draft.coverageSetting}>${this.#coverageLabel(option)}</option>`)}</select>
          </label>
        </div>
        <p class="subtle">${this.#t("v4_private_marks", "{count} map-space marks. The outline stays private and floor-bound.", { count: this.state.draw.circles.length })}</p>
        <div class="toolbar">
          <button class="ms-btn ms-btn--secondary" type="button" @click=${() => this.#intent({ type: "open-workflow", workflow: "draw" })}>${this.#t("v4_edit_outline", "Edit outline")}</button>
          ${draft.id ? html`
            <button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#t("area_delete", "Delete area")}
              data-dialog-launcher="confirmDeleteArea"
              @click=${() => this.#intent({ type: "open-dialog", dialog: "confirmDeleteArea" })}
            >${this.#t("area_delete", "Delete")}</button>
          ` : nothing}
        </div>
        ${this.#notice()}
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
    return this.#resource(resource.status, resource.problem, html`
      <div class="stack">
        ${(catalog?.floors.length || 0) > 1 ? html`
          <div class="list" role="listbox" aria-label=${this.#t("v4_mapped_floors", "Mapped floors")}>
            ${(catalog?.floors || []).map((candidate, index) => html`
              <button
                class="floor ms-row ms-row"
                type="button"
                role="option"
                aria-selected=${String(candidate.id === floor?.id)}
                aria-pressed=${String(candidate.id === floor?.id)}
                @click=${() => this.#intent({ type: "set-floor", floorId: candidate.id })}
              >
                <span>${candidate.label || (candidate.active
                  ? this.#t("v4_current_floor", "Current floor")
                  : this.#t("v4_saved_floor", "Saved floor {number}", { number: candidate.ordinal ?? index }))}</span>
                <small>${candidate.active ? this.#t("map_timeline_live_action", "Live") : this.#t("v4_read_only", "Read only")}</small>
              </button>
            `)}
          </div>
        ` : nothing}
        <div class="timeline">
          <label class="field ms-field">${this.#t("map_timeline_label", "Map timeline")}
            <input
              type="range"
              min="0"
              max=${String(snapshots.length)}
              step="1"
              .value=${String(position)}
              ?disabled=${!snapshots.length}
              @input=${(event: Event) => {
                const index = Number(eventValue(event));
                this.#intent({ type: "set-history", historyId: index === snapshots.length ? null : snapshots[index]?.id || null });
              }}
            >
          </label>
          <div class="list">
            <button class="snapshot ms-row ms-row" type="button" aria-current=${String(!this.state.selection.historyId)} @click=${() => this.#intent({ type: "set-history", historyId: null })}><span>${this.#t("map_timeline_live_action", "Live")}</span><small>${this.#t("v4_current", "Current")}</small></button>
            ${snapshots.map((snapshot, index) => html`
              <button class="snapshot ms-row ms-row" type="button" aria-current=${String(snapshot.id === this.state.selection.historyId)} @click=${() => this.#intent({ type: "set-history", historyId: snapshot.id })}>
                <span>${this.#formatTime(snapshot.createdAt)}</span><small>${index + 1} of ${snapshots.length}</small>
              </button>
            `)}
          </div>
        </div>
        <p class="subtle">${this.#t("v4_history_privacy", "Saved maps are floor-scoped and never show a live robot position.")}</p>
      </div>
    `);
  }

  #formatTime(value: string): string {
    try {
      return new Intl.DateTimeFormat(this.state.locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    } catch {
      return this.#t("v4_saved_map", "Saved map");
    }
  }

  #support() {
    const entry = this.state.resources.entry;
    return html`
      <div class="stack">
        <p class="subtle">${this.#t("v4_support_privacy", "This summary contains no map, coordinates, room or floor names, device identifiers, addresses, or credentials.")}</p>
        <dl class="diagnostics">
          <dt>${this.#t("v4_connection", "Connection")}</dt><dd>${this.state.host.connected ? this.#t("v4_connected", "Connected") : this.#t("v4_offline", "Offline")}</dd>
          <dt>${this.#t("v4_map_state", "Map state")}</dt><dd>${this.state.coherence}</dd>
          <dt>${this.#t("v4_floor_verified", "Floor verified")}</dt><dd>${this.state.map.floorCoherent ? this.#t("v4_yes", "Yes") : this.#t("v4_no", "No")}</dd>
          <dt>${this.#t("v4_session_verified", "Session verified")}</dt><dd>${this.state.map.sessionVerified ? this.#t("v4_yes", "Yes") : this.#t("v4_no", "No")}</dd>
          <dt>${this.#t("v4_map_complete", "Map complete")}</dt><dd>${this.state.map.complete ? this.#t("v4_yes", "Yes") : this.#t("v4_no", "No")}</dd>
          <dt>${this.#t("v4_map_health", "Map health")}</dt><dd>${entry?.health || this.#t("v4_unknown", "Unknown")}</dd>
          <dt>${this.#t("v4_blocked_by", "Blocked by")}</dt><dd>${entry?.mapBlockReason?.replaceAll("_", " ") || this.#t("v4_nothing", "Nothing")}</dd>
          <dt>${this.#t("v4_startup_map", "Startup map check")}</dt><dd>${entry?.bootstrapState?.replaceAll("_", " ") || this.#t("v4_unknown", "Unknown")}</dd>
          <dt>${this.#t("v4_startup_photo", "Startup photo layer")}</dt><dd>${entry?.bootstrapPhotoSeen ? this.#t("v4_seen", "Seen") : this.#t("v4_not_seen", "Not seen")}</dd>
          <dt>${this.#t("v4_startup_structure", "Startup structure layer")}</dt><dd>${entry?.bootstrapStructureSeen ? this.#t("v4_seen", "Seen") : this.#t("v4_not_seen", "Not seen")}</dd>
          <dt>${this.#t("v4_startup_failures", "Startup failures")}</dt><dd>${entry?.bootstrapFailures || 0}</dd>
          <dt>${this.#t("v4_stream_failures", "Stream failures")}</dt><dd>${entry?.streamFailures || 0}</dd>
          <dt>${this.#t("v4_saved_floor_count", "Saved floor count")}</dt><dd>${this.state.floor.classifiedCount}</dd>
        </dl>
      </div>
    `;
  }

  protected override render() {
    switch (this.state.workflow) {
      case "rooms": return this.#rooms();
      case "plan": return this.#plans();
      case "draw": return this.#draw();
      case "areaReview": return this.#areaReview();
      case "history": return this.#history();
      case "support": return this.#support();
      case "none": return nothing;
    }
  }
}

if (!customElements.get(WORKFLOW_TAG)) {
  customElements.define(WORKFLOW_TAG, MaticMapWorkflowV4);
}
