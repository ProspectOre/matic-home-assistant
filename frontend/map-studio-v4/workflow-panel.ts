import { LitElement, css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { controls } from "./controls";
import { icon, iconMoveDown, iconMoveUp, iconPlus } from "./icons";
import { base, tokens } from "./tokens";

import type {
  CleaningMode,
  CadenceReason,
  CoverageSetting,
  PlanRoom,
  RoomCadencePolicy,
} from "./backend-contracts";
import type { Localize, WorkspaceIntent, WorkspaceState } from "./contracts";
import { WORKFLOW_TAG } from "./element-tags";
import { WORKSPACE_INTENT_EVENT } from "./map-canvas";
import { admittedManualRoomPreview, initialWorkspaceState } from "./state";
import { translate } from "./localize";

const modes: readonly CleaningMode[] = ["vacuum", "mop", "vacuum_and_mop"];
const coverage: readonly CoverageSetting[] = ["quick", "standard", "heavy_duty"];

const eventValue = (event: Event): string => (event.currentTarget as HTMLInputElement).value;
const eventChecked = (event: Event): boolean => (event.currentTarget as HTMLInputElement).checked;

export class MaticMapWorkflowV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    _diagnosticsLoadFailed: { state: true },
  };

  static override styles = [tokens, base, controls, css`
.workflow-fields { border: 0; margin: 0; padding: 0; min-inline-size: 0; }
:host { display: block; min-inline-size: 0; container-type: inline-size; }
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
.group { display: grid; gap: var(--ms-space-2); }
.group-heading { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); font-weight: var(--ms-w-medium); letter-spacing: 0.04em; line-height: var(--ms-lh-snug); text-transform: uppercase; }
.floor[aria-current="true"] { border-color: var(--ms-accent); background: color-mix(in srgb, var(--ms-accent) 12%, var(--ms-local)); }
.problem p { margin: 0; }
@media (forced-colors: active) { .floor[aria-current="true"] { forced-color-adjust: none; color: HighlightText; background: Highlight; border-color: Highlight; } }
.room { display: grid; gap: var(--ms-space-2); }
.room-choice { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control-sm); }
.room-choice input { inline-size: 1.2rem; block-size: 1.2rem; }
.room-settings { padding-block-start: 0.125rem; padding-inline-start: 1.8rem; }
.plan-meta { align-items: stretch; }
.plan-active { min-inline-size: 0; }
.plan-active .ms-row__body strong { font-size: var(--ms-t-sm); white-space: nowrap; }
.plan-active .ms-row__body small { max-inline-size: 32ch; }
.plan-options { --ms-local: var(--ms-surface-sunken); display: grid; gap: var(--ms-space-3); padding: var(--ms-space-4); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); background: var(--ms-local); }
.plan-room .room-choice { grid-template-columns: minmax(0, 1fr) auto; }
.plan-room-label { display: flex; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control); }
.plan-room { display: grid; gap: var(--ms-space-2); }
.plan-option { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: var(--ms-space-2); }
.plan-option input[type="checkbox"] { inline-size: 1.2rem; block-size: 1.2rem; margin: 0.1rem 0 0; accent-color: var(--ms-accent); }
.plan-option-copy, .plan-threshold-copy { display: grid; gap: var(--ms-space-1); min-inline-size: 0; }
.cadence-config { grid-column: 1 / -1; grid-template-columns: minmax(0, 1fr); display: grid; gap: var(--ms-space-2); }
.cadence-config > summary { cursor: pointer; min-block-size: var(--ms-control-sm); font-weight: var(--ms-w-semibold); }
.cadence-fields { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--ms-space-2); min-inline-size: 0; }
.cadence-fields > .ms-field { min-inline-size: 0; }
.plan-option-copy strong, .plan-threshold-copy strong { font-size: var(--ms-t-sm); line-height: var(--ms-lh-snug); }
.plan-option-copy small, .plan-threshold-copy small { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); font-weight: var(--ms-w-regular); line-height: var(--ms-lh-snug); }
.plan-threshold { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--ms-space-1) var(--ms-space-3); align-items: start; }
.plan-threshold .plan-threshold-copy { grid-column: 1; }
.plan-threshold .threshold-value { color: var(--ms-text); font-size: var(--ms-t-sm); font-weight: var(--ms-w-bold); }
.plan-threshold > input[type="range"] { grid-column: 1 / -1; inline-size: 100%; min-block-size: var(--ms-control-sm); }
.toolbar { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); }
.checkbox { display: flex; align-items: center; gap: var(--ms-space-2); min-block-size: var(--ms-control); font-size: var(--ms-t-xs); font-weight: var(--ms-w-medium); }
.checkbox input { inline-size: 1.2rem; block-size: 1.2rem; }
.floor small, .snapshot small, .list-button small { margin-inline-start: auto; color: color-mix(in srgb, var(--ms-text) 78%, var(--ms-local)); font-weight: var(--ms-w-regular); }
.timeline { display: grid; gap: var(--ms-space-2); }
.timeline input[type="range"] { inline-size: 100%; min-block-size: var(--ms-control); }
@media (max-width: 25rem) { .split { grid-template-columns: 1fr; } }
@container (max-width: 38rem) { .plan-meta { grid-template-columns: 1fr; } }
`];

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;
  _diagnosticsLoadFailed = false;
  #diagnosticsLoad: Promise<void> | null = null;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
  }

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

  #cadenceReason(reason: string): string {
    if (reason === "mop_due") return this.#t("v4_cadence_mop_due_reason", "Vacuum and mop are due");
    if (reason === "coverage_due") return this.#t("v4_cadence_coverage_due_reason", "Periodic coverage is due");
    return this.#t("v4_cadence_due_unknown_reason", "Schedule setting due");
  }

  #previewBlocker(blocker: string): string {
    if (blocker === "plan_disabled") return this.#t("v4_preview_plan_disabled", "This plan is paused. Enable it to preview and run.");
    if (blocker === "shared_schedule_unavailable") return this.#t("v4_preview_shared_unavailable", "The shared room schedule cannot be verified on this map.");
    if (blocker === "cadence_identity_changed" || blocker === "cadence_identity_unavailable") return this.#t("v4_preview_identity_unavailable", "Room identity could not be verified. Check the current map before running.");
    if (blocker === "plan_has_no_rooms") return this.#t("v4_preview_no_rooms", "Add at least one room to this plan.");
    return this.#t("v4_preview_invalid", "The saved plan preview is invalid. Review the plan and try again.");
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

  #resourceCopy(): { readonly loading: string; readonly unavailable: string; readonly empty: string } {
    switch (this.state.workflow) {
      case "rooms":
      case "plans":
      case "plan":
        return {
          loading: this.#t("v4_loading_rooms_plans", "Loading rooms and plans…"),
          unavailable: this.#t("v4_rooms_plans_unavailable", "Rooms and plans are unavailable right now."),
          empty: this.#t("v4_no_rooms_plans", "No rooms or plans are available yet."),
        };
      case "draw":
      case "areaReview":
        return {
          loading: this.#t("v4_loading_areas", "Loading saved areas…"),
          unavailable: this.#t("v4_areas_unavailable", "Saved areas are unavailable right now."),
          empty: this.#t("v4_no_saved_areas", "No saved areas yet. Draw one on the map."),
        };
      case "history":
        return {
          loading: this.#t("v4_loading_history", "Loading map history…"),
          unavailable: this.#t("v4_history_unavailable", "Map history is unavailable right now."),
          empty: this.#t("v4_no_map_history", "No saved map snapshots yet."),
        };
      default:
        return {
          loading: this.#t("map_loading", "Loading…"),
          unavailable: this.#t("v4_workspace_unavailable", "This workspace is unavailable right now."),
          empty: this.#t("v4_nothing_saved", "Nothing saved yet."),
        };
    }
  }

  #resource(status: string, problem: string | null, body: unknown) {
    const copy = this.#resourceCopy();
    if (status === "loading" || status === "idle") return html`<div class="loading" role="status">${copy.loading}</div>`;
    if (status === "error") {
      const workflow = this.state.workflow;
      return html`
        <div class="stack">
          <div class="problem" role="alert">${copy.unavailable} ${problem === "request-failed" ? this.#t("v4_try_again", "Try again shortly.") : this.#t("v4_return_live_retry", "Return to the live map and retry.")}</div>
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
    const plans = this.state.resources.plans;
    const admitted = admittedManualRoomPreview(this.state);
    const previewCurrent = admitted !== null;
    return this.#resource(plans.status, plans.problem, html`
      <div class="stack">
        <h3 class="group-heading" id="rooms-heading">${this.#t("v4_rooms_to_clean", "Rooms to clean")}</h3>
        <div class="list" role="group" aria-labelledby="rooms-heading">
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
        <label class="plan-option">
          <input type="checkbox" .checked=${!this.state.selection.useRoomSchedule} @change=${(event: Event) => this.#intent({ type: "set-use-room-schedule", value: !eventChecked(event) })}>
          <span class="plan-option-copy">
            <strong>${this.#t("v4_override_room_schedule", "Override shared schedule settings")}</strong>
            <small>${this.#t("v4_override_room_schedule_hint", "By default, this clean applies the shared schedule. Turn this on to use the settings selected here. Omitted due work stays due, and compatible verified work still counts toward shared progress.")}</small>
          </span>
        </label>
        <div class="stack" aria-label=${this.#t("v4_shared_schedule_status", "Shared room schedule status")}>
          ${this.state.selection.roomIds.map((roomId) => {
            const room = plans.value?.rooms.find((candidate) => candidate.roomId === roomId);
            return room?.sharedCadence || room?.sharedCadenceProgress || room?.sharedCadenceReasons?.length
              ? html`<p class="subtle">${room.name}: ${this.#cadenceSummary(room.sharedCadence, room.sharedCadenceProgress, room.sharedCadenceReasons)}</p>`
              : nothing;
          })}
        </div>
        ${this.state.manualRoomPreview.status === "loading"
          ? html`<p role="status" class="subtle">${this.#t("v4_room_preview_loading", "Verifying the effective room settings…")}</p>`
          : nothing}
        ${this.state.manualRoomPreview.status === "error"
          ? html`<div class="stack">
            <div role="alert" class="problem">${this.#t("v4_room_preview_unavailable", "Your room selections are saved, but the effective settings could not be verified. Retry the preview to enable cleaning.")}</div>
            <div class="toolbar"><button class="ms-btn ms-btn--secondary" type="button" @click=${() => this.#intent({ type: "retry-room-preview" })}>${this.#t("v4_retry_preview", "Retry preview")}</button></div>
          </div>`
          : nothing}
        ${previewCurrent ? this.#manualRoomPreview(admitted.preview) : nothing}
        ${this.#notice()}
      </div>
    `);
  }

  #manualRoomPreview(preview: NonNullable<WorkspaceState["manualRoomPreview"]["value"]>["preview"]) {
    const boundaries = new Set(preview.missionBoundaries);
    return html`
      <section class="stack" aria-labelledby="effective-rooms-heading" aria-live="polite">
        <h3 class="group-heading" id="effective-rooms-heading">${this.#t("v4_effective_room_preview", "Effective cleaning preview")}</h3>
        ${preview.blocker
          ? html`<p class="problem" role="alert">${preview.blocker === "invalid_cadence_policy"
              && this.state.selection.useRoomSchedule
              && this.state.selection.roomSettings.some((room) => room.cleaningMode !== "vacuum")
              ? this.#t("v4_room_preview_schedule_override", "The shared schedule cannot apply this selected cleaning system. Turn on Override shared schedule settings or choose a compatible system.")
              : this.#t("v4_room_preview_blocked", "The effective room sequence is blocked. Review the selected rooms and shared schedule settings, then retry.")}</p>`
          : nothing}
        ${preview.rooms.length
          ? html`<ol class="list" aria-label=${this.#t("v4_effective_room_order", "Effective room order")}>
            ${preview.rooms.map((room, index) => html`
              <li class="ms-row ms-row--stack">
                ${boundaries.has(index) ? html`<strong>${this.#t("v4_room_mission_boundary", "New mission")}</strong>` : nothing}
                <strong>${room.name}</strong>
                <span class="subtle">${this.#modeLabel(room.cleaningMode)} · ${this.#coverageLabel(room.coverageSetting)}</span>
                ${room.cadenceReasons.length
                  ? html`<span class="subtle">${room.cadenceReasons.map((reason) => this.#cadenceReason(reason)).join("; ")}</span>`
                  : nothing}
              </li>
            `)}
          </ol>`
          : nothing}
      </section>
    `;
  }

  #roomSettings(roomId: string, room: PlanRoom) {
    const name = this.state.resources.plans.value?.rooms.find((candidate) => candidate.roomId === roomId)?.name || this.#t("v4_room", "Room");
    return html`
      <div class="split room-settings">
        <label class="field ms-field">${this.#t("v4_cleaning_system", "Cleaning system")}
          <select
            aria-label=${this.#t("v4_room_cleaning_system_named", "Cleaning system for {room}", { room: name })}
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
            aria-label=${this.#t("v4_room_cleaning_mode_named", "Cleaning mode for {room}", { room: name })}
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

  #cadenceFor(room: PlanRoom): RoomCadencePolicy {
    return room.cadence || {
      scope: "plan",
      mopEveryN: null,
      coverageEveryN: null,
      periodicCoverageSetting: null,
      doMopNext: false,
      doCoverageNext: false,
    };
  }

  #cadenceSummary(
    policy: RoomCadencePolicy | undefined,
    progress: PlanRoom["cadenceProgress"] | undefined,
    reasons: readonly CadenceReason[] = progress?.reasons || [],
  ): string {
    if (reasons.includes("identity_changed") || reasons.includes("room_not_on_current_map")) {
      return this.#t("v4_cadence_identity_blocked", "Schedule identity does not match the current room map. Review this room before cleaning.");
    }
    if (reasons.includes("shared_schedule_unavailable")) {
      return this.#t("v4_cadence_shared_unavailable", "The shared room schedule is unavailable. Review its settings before cleaning.");
    }
    if (reasons.includes("invalid_cadence_policy")) {
      return this.#t("v4_cadence_policy_invalid", "The room schedule needs review before it can be applied.");
    }
    if (!policy || (!policy.mopEveryN && !policy.coverageEveryN)) {
      return this.#t("v4_cadence_not_enabled", "No recurring room schedule is enabled.");
    }
    const parts: string[] = [];
    const mopDue = progress?.mopDue || progress?.reasons.includes("mop_due");
    const coverageDue = progress?.coverageDue || progress?.reasons.includes("coverage_due");
    if (policy.mopEveryN) {
      parts.push(mopDue
        ? this.#t("v4_cadence_mop_due", "Vacuum and mop is due on this clean.")
        : this.#t("v4_cadence_mop_progress", "Mop every {interval} cleans; {completed} qualifying cleans since the last mop.", {
          interval: policy.mopEveryN,
          completed: progress?.mopProgress ?? 0,
        }));
    }
    if (policy.coverageEveryN) {
      parts.push(coverageDue
        ? this.#t("v4_cadence_coverage_due", "{coverage} periodic coverage is due on this clean.", {
          coverage: this.#coverageLabel(policy.periodicCoverageSetting || "standard"),
        })
        : this.#t("v4_cadence_coverage_progress", "Periodic coverage every {interval} cleans; {completed} qualifying cleans so far.", {
          interval: policy.coverageEveryN,
          completed: progress?.coverageProgress ?? 0,
        }));
    }
    return parts.join(" ");
  }

  #patchPlanCadence(index: number, patch: Partial<RoomCadencePolicy>): void {
    const room = this.state.planDraft.rooms[index];
    if (!room) return;
    this.#patchPlanRoom(index, { cadence: { ...this.#cadenceFor(room), ...patch } });
  }

  #patchCadenceInterval(
    event: Event,
    index: number,
    field: "mopEveryN" | "coverageEveryN",
  ): void {
    const input = event.currentTarget as HTMLInputElement;
    const raw = input.value;
    if (raw === "") {
      this.#patchPlanCadence(index, { [field]: null });
      return;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      input.reportValidity();
      return;
    }
    const room = this.state.planDraft.rooms[index];
    if (!room) return;
    if (field === "coverageEveryN") {
      this.#patchPlanCadence(index, {
        coverageEveryN: value,
        periodicCoverageSetting: room.cadence?.periodicCoverageSetting || room.coverageSetting,
      });
      return;
    }
    this.#patchPlanCadence(index, { [field]: value });
  }

  #cadenceControls(room: PlanRoom, index: number, label: string) {
    const draft = this.state.planDraft;
    const policy = this.#cadenceFor(room);
    const progress = room.cadenceProgress;
    const savedRoom = draft.id
      ? this.state.resources.plans.value?.plans.find((plan) => plan.id === draft.id)
        ?.rooms.find((candidate) => candidate.roomId === room.roomId)
      : undefined;
    const previousScope = savedRoom?.cadence?.scope ?? null;
    const sharedRoom = this.state.resources.plans.value?.rooms.find(
      (candidate) => candidate.roomId === room.roomId,
    );
    const hasSharedSchedule = Boolean(sharedRoom?.sharedCadence || sharedRoom?.sharedCadenceProgress);
    const hasCadence = Boolean(policy.mopEveryN || policy.coverageEveryN);
    const hasMopProgress = Boolean(progress?.mopProgress || policy.doMopNext);
    const hasCoverageProgress = Boolean(progress?.coverageProgress || policy.doCoverageNext);
    const resetDisabled = draft.dirty || this.state.command !== "idle" || this.state.managedLock
      || (this.state.activity !== "idle" && this.state.activity !== "docked")
      || this.state.dataMode !== "live";
    const scopeExplanation = previousScope !== null && previousScope !== policy.scope
      ? policy.scope === "shared"
        ? this.#t("v4_cadence_shared_join_effect", "Saving makes this schedule shared across participating plans and opted-in room cleans. It adopts existing shared progress when available; a new shared schedule starts at zero.")
        : this.#t("v4_cadence_shared_leave_effect", "Saving starts fresh private progress for this plan. The existing shared schedule remains unchanged for other participating plans.")
      : previousScope === null && hasCadence
        ? policy.scope === "shared"
          ? hasSharedSchedule
            ? this.#t("v4_cadence_shared_join_effect", "Saving makes this schedule shared across participating plans and opted-in room cleans. It adopts existing shared progress when available; a new shared schedule starts at zero.")
            : this.#t("v4_cadence_new_shared_effect", "Saving creates a shared schedule for participating plans and opted-in room cleans. Its progress starts at zero.")
          : this.#t("v4_cadence_new_private_effect", "Saving creates private progress for this plan only. It starts at zero when enabled.")
        : this.#t("v4_cadence_existing_effect", "Interval edits keep progress, and disabling pauses it. Mopping and coverage have separate progress and resets.");
    const cadenceLabel = this.#t("v4_room_cadence_named", "Room schedule for {room}", { room: label });
    return html`
      <details class="plan-option cadence-config">
        <summary>${cadenceLabel}</summary>
        <p class="subtle">${this.#t("v4_cadence_description", "Only verified room cleans count toward these intervals. Due work stays due until it is verified.")}</p>
        <div class="cadence-fields">
          <label class="field ms-field">${this.#t("v4_cadence_scope", "Schedule scope")}
            <select aria-label=${this.#t("v4_cadence_scope_named", "Schedule scope for {room}", { room: label })} .value=${policy.scope} @change=${(event: Event) => this.#patchPlanCadence(index, { scope: eventValue(event) as RoomCadencePolicy["scope"] })}>
              <option value="plan" ?selected=${policy.scope === "plan"}>${this.#t("v4_cadence_this_plan", "This plan (private)")}</option>
              <option value="shared" ?selected=${policy.scope === "shared"}>${this.#t("v4_cadence_shared", "Shared for this room")}</option>
            </select>
          </label>
          <label class="field ms-field">${this.#t("v4_cadence_mop_interval", "Vacuum and mop every N cleans")}
            <input type="number" min="1" max="100" step="1" inputmode="numeric" aria-label=${this.#t("v4_cadence_mop_interval_named", "Vacuum and mop interval for {room}, from 1 to 100", { room: label })} .value=${policy.mopEveryN?.toString() || ""} ?disabled=${room.cleaningMode !== "vacuum"} @change=${(event: Event) => this.#patchCadenceInterval(event, index, "mopEveryN")}>
          </label>
          <label class="field ms-field">${this.#t("v4_cadence_coverage_interval", "Use periodic coverage every N cleans")}
            <input type="number" min="1" max="100" step="1" inputmode="numeric" aria-label=${this.#t("v4_cadence_coverage_interval_named", "Periodic coverage interval for {room}, from 1 to 100", { room: label })} .value=${policy.coverageEveryN?.toString() || ""} @change=${(event: Event) => this.#patchCadenceInterval(event, index, "coverageEveryN")}>
          </label>
          ${policy.coverageEveryN ? html`
            <label class="field ms-field">${this.#t("v4_cadence_periodic_coverage", "Periodic coverage setting")}
              <select aria-label=${this.#t("v4_cadence_periodic_coverage_named", "Periodic coverage setting for {room}", { room: label })} .value=${policy.periodicCoverageSetting || "standard"} @change=${(event: Event) => this.#patchPlanCadence(index, { periodicCoverageSetting: eventValue(event) as CoverageSetting })}>${coverage.map((option) => html`<option value=${option} ?selected=${option === policy.periodicCoverageSetting}>${this.#coverageLabel(option)}</option>`)}</select>
            </label>
          ` : nothing}
        </div>
        <p class="subtle" role="status">${scopeExplanation}</p>
        ${room.cleaningMode !== "vacuum" ? html`<p class="subtle">${this.#t("v4_cadence_mop_requires_vacuum", "Set this room's normal cleaning system to vacuum to enable periodic mopping.")}</p>` : nothing}
        ${policy.mopEveryN && room.cleaningMode === "vacuum" ? html`<p class="subtle">${this.#t("v4_cadence_clear_mop_to_change_normal", "Clear the mopping interval before changing this room's normal cleaning system.")}</p>` : nothing}
        <div class="plan-options" role="group" aria-label=${this.#t("v4_cadence_next_actions_named", "Next clean options for {room}", { room: label })}>
          <label class="plan-option"><input type="checkbox" aria-label=${this.#t("v4_cadence_do_mop_next_named", "Do vacuum and mop on the next clean for {room}", { room: label })} .checked=${policy.doMopNext} ?disabled=${!policy.mopEveryN} @change=${(event: Event) => this.#patchPlanCadence(index, { doMopNext: eventChecked(event) })}><span class="plan-option-copy"><strong>${this.#t("v4_cadence_do_mop_next", "Do vacuum and mop on the next clean")}</strong></span></label>
          <label class="plan-option"><input type="checkbox" aria-label=${this.#t("v4_cadence_do_coverage_next_named", "Use periodic coverage on the next clean for {room}", { room: label })} .checked=${policy.doCoverageNext} ?disabled=${!policy.coverageEveryN} @change=${(event: Event) => this.#patchPlanCadence(index, { doCoverageNext: eventChecked(event) })}><span class="plan-option-copy"><strong>${this.#t("v4_cadence_do_coverage_next", "Use periodic coverage on the next clean")}</strong></span></label>
        </div>
        <p class="subtle" aria-live="polite">${this.#cadenceSummary(policy, progress, room.cadenceReasons)}</p>
        ${draft.id && (policy.mopEveryN || policy.coverageEveryN || hasMopProgress || hasCoverageProgress) ? html`
          <div class="toolbar">
            ${policy.mopEveryN || hasMopProgress ? html`<button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#t("v4_reset_mop_cadence_button_named", "Reset mopping progress for {room}", { room: label })}
              data-dialog-launcher="confirmResetCadence"
              ?disabled=${resetDisabled}
              @click=${() => this.#intent({
                type: "request-room-cadence-reset",
                planId: draft.id as string,
                roomId: room.roomId,
                mode: "mop",
              })}
            >${this.#t("v4_reset_mop_cadence_button", "Reset mopping")}</button>` : nothing}
            ${policy.coverageEveryN || hasCoverageProgress ? html`<button
              class="danger ms-btn ms-btn--secondary ms-btn--danger"
              type="button"
              aria-label=${this.#t("v4_reset_coverage_cadence_button_named", "Reset coverage progress for {room}", { room: label })}
              data-dialog-launcher="confirmResetCadence"
              ?disabled=${resetDisabled}
              @click=${() => this.#intent({
                type: "request-room-cadence-reset",
                planId: draft.id as string,
                roomId: room.roomId,
                mode: "coverage",
              })}
            >${this.#t("v4_reset_coverage_cadence_button", "Reset coverage")}</button>` : nothing}
          </div>
          <p class="subtle">${this.#t("v4_reset_cadence_hint", "Reset is available for a saved plan while the robot is idle. Cleaning history is kept separately.")}</p>
        ` : nothing}
      </details>
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

  #planPicker() {
    const resource = this.state.resources.plans;
    return this.#resource(resource.status, resource.problem, html`
      <div class="stack">
        <button class="ms-btn ms-btn--primary" type="button" @click=${() => this.#intent({ type: "select-plan", planId: null })}>
          ${icon(iconPlus)}<span>${this.#t("v4_create_plan", "Create a plan")}</span>
        </button>
        ${(resource.value?.plans || []).map((plan) => html`
          <button class="ms-row ms-row--card" type="button" @click=${() => this.#intent({ type: "select-plan", planId: plan.id })}>
            <span class="ms-row__body"><strong>${plan.name}</strong>
              <small>${this.#t("v4_plan_room_count", "{count} rooms", { count: plan.rooms.length })}${plan.enabled ? "" : ` · ${this.#t("v4_paused", "paused")}`}</small>
            </span>
            <span class="ms-row__trail">${this.#t("v4_edit_plan", "Edit plan")}</span>
          </button>
        `)}
      </div>
    `);
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
    const mixedSettings = new Set(draft.rooms.map((room) => `${room.cleaningMode}:${room.coverageSetting}`)).size > 1;
    const savedPlan = draft.id ? catalog?.plans.find((plan) => plan.id === draft.id) : undefined;
    const nextRunPreview = savedPlan?.nextRunPreview;
    return this.#resource(resource.status, resource.problem, html`
      <div class="stack">
        <label class="field ms-field">${this.#t("plan_name", "Plan name")}
          <input
            maxlength="128"
            autocomplete="off"
            .value=${draft.name}
            @input=${(event: Event) => this.#intent({ type: "patch-plan-draft", patch: { name: eventValue(event) } })}
          >
        </label>
        <div class="split plan-meta">
          <label class="field ms-field">${this.#t("plan_run_behavior", "Cleaning order")}
            <select
              .value=${draft.runBehavior}
              @change=${(event: Event) => this.#intent({
                type: "patch-plan-draft",
                patch: { runBehavior: eventValue(event) === "ordered" ? "ordered" : "intelligent" },
              })}
            >
              <option value="intelligent">${this.#t("plan_intelligent", "Intelligent rotation")}</option>
              <option value="ordered">${this.#t("plan_ordered", "Saved order")}</option>
            </select>
          </label>
          <div class="ms-row plan-active" data-active=${String(draft.enabled)}>
            <div class="ms-row__body">
              <strong id="plan-active-title">${this.#t("v4_plan_can_run", "Plan enabled")}</strong>
              <small id="plan-active-desc">${draft.enabled
                ? this.#t("v4_plan_can_run_on", "Available from Run a plan, automations, and Home Assistant services.")
                : this.#t("v4_plan_can_run_off", "Paused. Turn this on to make the plan available.")}</small>
            </div>
            <button
              class="ms-switch"
              type="button"
              role="switch"
              aria-checked=${String(draft.enabled)}
              aria-labelledby="plan-active-title"
              aria-describedby="plan-active-desc"
              @click=${() => this.#intent({ type: "patch-plan-draft", patch: { enabled: !draft.enabled } })}
            ></button>
          </div>
        </div>
        <h3 class="group-heading" id="plan-rooms-heading">${this.#t("plan_rooms", "Plan rooms")}</h3>
        ${mixedSettings ? html`
          <p class="subtle plan-transition-hint">${this.#t("v4_plan_mixed_settings", "Rooms with different cleaning settings may need separate missions and dock visits.")}
            ${draft.runBehavior === "ordered"
              ? this.#t("v4_plan_group_settings", "Placing rooms with matching settings together can reduce transitions.")
              : this.#t("v4_plan_rotation_settings", "Intelligent rotation determines the room order.")}
          </p>
        ` : nothing}
        <div class="list" role="group" aria-labelledby="plan-rooms-heading">
          ${repeat(roomRows, ({ room }) => room.roomId, ({ room, label, selected }) => {
            const index = selected
              ? draft.rooms.findIndex((candidate) => candidate.roomId === room.roomId)
              : -1;
            return html`
              <div class="room plan-room ms-row ms-row--stack" data-selected=${String(selected)}>
                <div class="room-choice">
                  <label class="plan-room-label">
                  <input type="checkbox" .checked=${selected} @change=${() => this.#togglePlanRoom(room.roomId)}>
                  <strong>${selected ? `${index + 1}. ` : ""}${label}</strong>
                  </label>
                  ${selected ? html`
                    <span>
                      <button class="icon-button ms-btn ms-btn--icon" type="button" aria-label=${this.#t("move_room_up", "Move {room} earlier", { room: label })} ?disabled=${index === 0} @click=${(event: Event) => { event.preventDefault(); this.#movePlanRoom(index, -1); }}>${icon(iconMoveUp)}</button>
                      <button class="icon-button ms-btn ms-btn--icon" type="button" aria-label=${this.#t("move_room_down", "Move {room} later", { room: label })} ?disabled=${index === draft.rooms.length - 1} @click=${(event: Event) => { event.preventDefault(); this.#movePlanRoom(index, 1); }}>${icon(iconMoveDown)}</button>
                    </span>
                  ` : nothing}
                </div>
                ${selected ? html`
                  <div class="split room-settings">
                    <label class="field ms-field">${this.#t("v4_cleaning_system", "Cleaning system")}
                      <select aria-label=${this.#t("v4_room_cleaning_system_named", "Cleaning system for {room}", { room: label })} .value=${room.cleaningMode} @change=${(event: Event) => this.#patchPlanRoom(index, { cleaningMode: eventValue(event) as CleaningMode })}>${modes.map((mode) => html`<option value=${mode} ?selected=${mode === room.cleaningMode} ?disabled=${Boolean("cadence" in room && room.cadence?.mopEveryN && mode !== "vacuum")}>${this.#modeLabel(mode)}</option>`)}</select>
                    </label>
                    <label class="field ms-field">${this.#t("cleaning_mode", "Cleaning mode")}
                      <select aria-label=${this.#t("v4_room_cleaning_mode_named", "Cleaning mode for {room}", { room: label })} .value=${room.coverageSetting} @change=${(event: Event) => this.#patchPlanRoom(index, { coverageSetting: eventValue(event) as CoverageSetting })}>${coverage.map((option) => html`<option value=${option} ?selected=${option === room.coverageSetting}>${this.#coverageLabel(option)}</option>`)}</select>
                    </label>
                  </div>
                  ${this.#cadenceControls(room, index, label)}
                ` : nothing}
              </div>
            `;
          })}
        </div>
        <section class="stack" aria-labelledby="next-run-preview-heading">
          <h3 class="group-heading" id="next-run-preview-heading">${this.#t("v4_next_run_preview", "Next-run preview")}</h3>
          <p class="subtle">${this.#t("v4_next_run_preview_hint", "This is the next saved-plan run, separate from any current run. The backend refreshes it before dispatch.")}</p>
          ${!draft.id ? html`<p class="subtle">${this.#t("v4_next_run_preview_save_first", "Save this plan to calculate its exact room order and effective settings.")}</p>`
            : !nextRunPreview || !/^[0-9a-f]{64}$/u.test(nextRunPreview.previewToken ?? "") ? html`<p class="problem" role="status">${this.#t("v4_next_run_preview_unavailable", "A verified next-run preview is unavailable. Refresh the saved plan before starting it.")}</p>`
              : nextRunPreview.blocker ? html`<p class="problem" role="alert">${this.#previewBlocker(nextRunPreview.blocker)}</p>`
                : html`
                  ${draft.dirty ? html`<p class="notice" role="status">${this.#t("v4_next_run_preview_stale", "This preview shows the saved plan. Save your edits to calculate the updated order and settings before starting.")}</p>` : nothing}
                  <ol class="list" aria-label=${this.#t("v4_next_run_preview_order", "Next-run room order and effective settings")}>
                    ${nextRunPreview.rooms.map((previewRoom, roomIndex) => {
                      const mission = 1 + nextRunPreview.missionBoundaries.filter((boundary) => boundary <= roomIndex).length;
                      return html`<li class="ms-row ms-row--stack">
                        <span class="subtle">${this.#t("v4_next_run_mission", "Mission {number}", { number: mission })}</span>
                        <strong>${roomIndex + 1}. ${previewRoom.name}</strong>
                        <span>${this.#modeLabel(previewRoom.cleaningMode)} · ${this.#coverageLabel(previewRoom.coverageSetting)}</span>
                        ${previewRoom.cadenceReasons.length ? html`<small>${previewRoom.cadenceReasons.map((reason) => this.#cadenceReason(reason)).join(" · ")}</small>` : nothing}
                      </li>`;
                    })}
                  </ol>
                `}
        </section>
        <h3 class="group-heading" id="completion-heading">${this.#t("v4_completion_options", "When a run ends")}</h3>
        <div class="plan-options" role="group" aria-labelledby="completion-heading">
          <label class="plan-option">
            <input type="checkbox" .checked=${draft.returnToBase} @change=${(event: Event) => this.#intent({ type: "patch-plan-draft", patch: { returnToBase: eventChecked(event) } })}>
            <span class="plan-option-copy">
              <strong>${this.#t("plan_return_to_base", "Return to the dock when finished")}</strong>
              <small>${this.#t("plan_return_to_base_hint", "After the last selected room, the robot returns to the dock.")}</small>
            </span>
          </label>
          <label class="plan-option">
            <input type="checkbox" .checked=${draft.finishCurrentRoom} @change=${(event: Event) => this.#intent({ type: "patch-plan-draft", patch: { finishCurrentRoom: eventChecked(event) } })}>
            <span class="plan-option-copy">
              <strong>${this.#t("plan_finish_room", "Finish the current room after Stop")}</strong>
              <small>${this.#t("plan_finish_room_hint", "When enough of the room is complete, finish it before docking. Never start another room.")}</small>
            </span>
          </label>
          ${draft.finishCurrentRoom ? html`
            <label class="plan-threshold ms-field">
              <span class="plan-threshold-copy">
                <strong>${this.#t("plan_threshold", "Minimum room progress")}</strong>
                <small>${this.#t("plan_threshold_hint", "When Stop is requested, the robot checks this progress: below it stops now; at or above it finishes this room before docking.")}</small>
              </span>
              <span class="threshold-value">${draft.finishCurrentRoomThreshold}%</span>
              <input type="range" min="0" max="100" step="5" .value=${String(draft.finishCurrentRoomThreshold)} aria-label=${this.#t("plan_threshold", "Minimum room progress")} @input=${(event: Event) => this.#intent({ type: "patch-plan-draft", patch: { finishCurrentRoomThreshold: Number(eventValue(event)) } })}>
            </label>
          ` : nothing}
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
        <p class="subtle">${this.state.draw.tool === "outline" ? this.#t("v4_zone_coverage", "Place points around the zone. Shading shows cleaning coverage inside the perimeter; narrow edges may remain uncovered.") : this.#t("v4_draw_floor_hint", "Paint only on the mapped floor. Zoom and pan never change the saved outline.")}</p>
        ${this.state.draw.tool !== "outline" ? html`<p class="subtle">${this.#t("v4_keyboard_draw_help", "Keyboard: focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.")}</p>` : nothing}
        ${this.#resource(areas.status, areas.problem, html`
          <div class="group">
            <h3 class="group-heading" id="areas-heading">${this.#t("area_workspace_title", "Saved custom areas")}</h3>
            <div class="list" role="group" aria-labelledby="areas-heading">
            <button class="list-button ms-row ms-row" type="button" @click=${() => this.#intent({ type: "select-area", areaId: null })}>＋ ${this.#t("area_new", "New outline")}</button>
            ${(areas.value?.areas || []).map((area) => html`
              <button class="list-button ms-row ms-row" type="button" @click=${() => {
                this.#intent({ type: "select-area", areaId: area.id, workflow: "areaReview" });
              }}>
                <span>${area.name}</span>
                <small>${area.status === "current" ? this.#t("area_workspace_ready", "Ready") : this.#t("v4_review", "Review")}</small>
              </button>
            `)}
            </div>
          </div>
        `)}
      </div>
    `;
  }

  #areaReview() {
    const draft = this.state.areaDraft;
    const needsReview = draft.canRebind || draft.status === "review";
    const stale = !needsReview && (draft.status === "stale" || draft.status === "unknown");
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
    const liveLabel = floor?.active
      ? this.#t("map_timeline_live_action", "Live")
      : this.#t("v4_return_current_floor", "Return to current floor");
    const selectedSnapshot = snapshots[position];
    return this.#resource(resource.status, resource.problem, html`
      <div class="stack">
        ${(catalog?.floors.length || 0) > 1 ? html`
          <div class="group">
            <h3 class="group-heading" id="floors-heading">${this.#t("v4_mapped_floors", "Mapped floors")}</h3>
            <div class="list" role="group" aria-labelledby="floors-heading">
            ${(catalog?.floors || []).map((candidate, index) => html`
              <button
                class="floor ms-row ms-row"
                type="button"
                aria-current=${String(candidate.id === floor?.id)}
                @click=${() => this.#intent({ type: "set-floor", floorId: candidate.id })}
              >
                <span>${candidate.label || (candidate.active
                  ? this.#t("v4_current_floor", "Current floor")
                  : this.#t("v4_saved_floor", "Saved floor {number}", { number: candidate.ordinal ?? index }))}</span>
                <small>${candidate.active ? this.#t("map_timeline_live_action", "Live") : this.#t("v4_read_only", "Read only")}</small>
              </button>
            `)}
            </div>
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
              aria-valuetext=${selectedSnapshot ? this.#formatTime(selectedSnapshot.createdAt) : liveLabel}
              ?disabled=${!snapshots.length}
              @input=${(event: Event) => {
                const index = Number(eventValue(event));
                this.#intent({ type: "set-history", historyId: index === snapshots.length ? null : snapshots[index]?.id || null });
              }}
            >
          </label>
          <div class="list">
            <button class="snapshot ms-row ms-row" type="button" aria-current=${String(!this.state.selection.historyId && Boolean(floor?.active))} @click=${() => this.#intent({ type: "set-history", historyId: null })}><span>${liveLabel}</span><small>${this.#t("v4_current", "Current")}</small></button>
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

  #loadDiagnostics(): void {
    if (this.#diagnosticsLoad || customElements.get("matic-map-diagnostics-v4")) return;
    this._diagnosticsLoadFailed = false;
    this.#diagnosticsLoad = import("./diagnostics-panel")
      .then(() => {
        this.#diagnosticsLoad = null;
        this.requestUpdate();
      })
      .catch(() => {
        this.#diagnosticsLoad = null;
        this._diagnosticsLoadFailed = true;
      });
  }

  #support() {
    if (customElements.get("matic-map-diagnostics-v4")) {
      return html`<matic-map-diagnostics-v4
        .state=${this.state}
        .localize=${this.localize}
        .disabled=${this.state.command !== "idle" && this.state.command !== "failed"}
      ></matic-map-diagnostics-v4>`;
    }
    if (this._diagnosticsLoadFailed) {
      return html`<div class="problem" role="alert">
        <p>${this.#t("v4_workflow_load_failed", "Workspace tools could not be loaded.")}</p>
        <button class="ms-btn ms-btn--secondary" type="button" @click=${this.#loadDiagnostics}>
          ${this.#t("v4_retry", "Try again")}
        </button>
      </div>`;
    }
    this.#loadDiagnostics();
    return html`<p class="loading" role="status" aria-live="polite">${this.#t("v4_workflow_loading", "Loading workspace tools…")}</p>`;
  }

  protected override render() {
    return html`<fieldset class="workflow-fields" ?disabled=${this.state.command !== "idle" && this.state.command !== "failed"}>${this.#body()}</fieldset>`;
  }

  #body() {
    switch (this.state.workflow) {
      case "rooms": return this.#rooms();
      case "plans": return this.#planPicker();
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
