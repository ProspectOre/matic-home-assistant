import { LitElement, css, html, nothing } from "lit";
import { controls } from "./controls";
import { base, tokens } from "./tokens";
import type { DateFormat, Localize, NoticePlaceholders, WorkspaceIntent, WorkspaceState } from "./contracts";
import { formatDateTime, formatDuration, formatList, translate } from "./localize";
import { initialWorkspaceState } from "./state";
import type { RunItem, RunItemResult, RunRecord } from "./run-history-data";

export const RUN_HISTORY_TAG = "matic-run-history-v4";

/**
 * Cleaning history (PRO-60): the last run explained first, then earlier runs
 * one tap away. It reads what Home Assistant and the robot recorded and says
 * "not reported" rather than guessing; nothing here starts a clean or marks a
 * room cleaned.
 */
export class MaticRunHistoryV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
    dates: { attribute: false },
    emit: { attribute: false },
    _open: { state: true },
  };

  static override styles = [tokens, base, controls, css`
:host { display: block; min-inline-size: 0; }
.stack { display: grid; gap: var(--ms-space-3); }
.subtle { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.run { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-3); border: 1px solid var(--ms-line); border-radius: var(--ms-radius-md); }
.run h3 { margin: 0; font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); }
.run p { margin: 0; font-size: var(--ms-t-sm); line-height: var(--ms-lh-snug); }
.items { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--ms-space-1) var(--ms-space-3); margin: 0; font-size: var(--ms-t-xs); }
.items dt { overflow-wrap: anywhere; }
.items dd { margin: 0; color: var(--ms-text-quiet); }
.items [data-done] { color: inherit; }
.list { display: grid; gap: var(--ms-space-2); }
.list .run { padding: 0; border: 0; }
.next p { white-space: pre-line; }
`];

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;
  dates?: DateFormat;
  /** The workflow panel's intent dispatch; keeps the map canvas module out of this chunk. */
  emit: (intent: WorkspaceIntent) => void = () => {};
  /** The earlier run whose details are open; one at a time. */
  _open: string | null = null;

  #t(key: string, fallback: string, placeholders?: NoticePlaceholders): string {
    return translate(this.localize, key, fallback, placeholders, this.dates);
  }

  #title(run: RunRecord): string {
    if (run.planName) return run.planName;
    const names = [...run.rooms, ...run.areas].map((item) => item.name);
    return names.length ? formatList(this.dates?.language || "en", names) : this.#t("v4_run_clean", "Clean");
  }

  #when(run: RunRecord): string {
    if (!run.startedAt) return this.#t("v4_run_time_unknown", "Time not reported");
    const started = formatDateTime(run.startedAt, this.dates);
    const seconds = run.endedAt ? (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000 : NaN;
    return seconds >= 0 ? `${started} · ${formatDuration(this.dates?.language || "en", seconds)}` : started;
  }

  #outcome(run: RunRecord): string {
    switch (run.ending) {
      case "running": return this.#t("v4_run_running", "In progress");
      case "finished": return this.#t("v4_run_finished", "Finished");
      case "stopped": return this.#t("v4_run_stopped", "Stopped before it finished");
      case "smart_stop": return this.#t("v4_run_smart_stop", "Smart Stop ended it after the current room");
      case "replaced": return this.#t("v4_run_replaced", "Another clean took over");
      case "low_battery": return this.#t("v4_run_low_battery", "Stopped because the battery was low");
      case "robot_problem": return this.#t("v4_run_robot_problem", "The robot reported a problem");
      case "taken_over": return this.#t("v4_run_taken_over", "The robot started a different task");
      case "home_assistant": return this.#t("v4_run_home_assistant", "Home Assistant restarted during the clean");
      case "interrupted": return this.#t("v4_run_interrupted", "Interrupted before it finished");
      case "unknown": return run.outcome === "not_finished"
        ? this.#t("v4_run_not_finished", "Didn't finish; the reason wasn't reported")
        : this.#t("v4_run_unknown", "Result not reported");
    }
  }

  // One next step, only where the record supports it.
  #nextStep(run: RunRecord): string | null {
    if (run.ending === "low_battery") return this.#t("v4_run_next_battery", "Let the robot charge, then clean the rest.");
    if (run.ending === "robot_problem") return this.#t("v4_run_next_problem", "Check the robot, then clean the rest.");
    const unfinished = [...run.rooms, ...run.areas].some((item) => item.result !== "completed");
    return run.source === "home_assistant" && run.outcome === "not_finished" && unfinished
      ? this.#t("v4_run_next_unfinished", "Rooms and areas that didn't finish weren't marked as cleaned.")
      : null;
  }

  #result(result: RunItemResult): string {
    switch (result) {
      case "completed": return this.#t("v4_run_item_completed", "Done");
      case "partial": return this.#t("v4_run_item_partial", "Partly done");
      case "stopped": return this.#t("v4_run_item_stopped", "Stopped");
      case "interrupted": return this.#t("v4_run_item_interrupted", "Interrupted");
      case "problem": return this.#t("v4_run_item_problem", "Problem");
      case "unconfirmed": return this.#t("v4_run_item_unconfirmed", "Not confirmed");
      case "skipped": return this.#t("v4_run_item_skipped", "Skipped");
      case "running": return this.#t("v4_run_item_running", "In progress");
      case "not_started": return this.#t("v4_run_item_not_started", "Not started");
      case "unknown": return this.#t("v4_run_item_unknown", "Not reported");
    }
  }

  #items(items: readonly RunItem[]) {
    return items.length ? html`<dl class="items">${items.map((item) => html`
      <dt>${item.name}</dt><dd ?data-done=${item.result === "completed"}>${this.#result(item.result)}</dd>`)}</dl>` : nothing;
  }

  // An earlier run's row already states its outcome, so its details do not.
  #details(run: RunRecord, outcome: boolean) {
    const shown = this.state.trail?.id === run.trail && run.trail !== null;
    const next = this.#nextStep(run);
    return html`
      ${outcome ? html`<p><strong>${this.#outcome(run)}</strong></p>` : nothing}
      ${run.source === "robot" ? html`<p class="subtle">${this.#t("v4_run_from_robot", "Started from the Matic app or the robot")}</p>` : nothing}
      ${run.rooms.length || run.areas.length ? this.#items([...run.rooms, ...run.areas])
        : html`<p class="subtle">${this.#t("v4_run_rooms_unknown", "Rooms not reported")}</p>`}
      ${next ? html`<p>${next}</p>` : nothing}
      ${run.trail && this.state.dataMode === "live" ? html`<div><button class="ms-btn ms-btn--secondary" type="button" aria-pressed=${String(shown)}
        @click=${() => this.emit({ type: "show-trail", trail: shown ? null : run.trail })}
      >${this.#t("v4_run_show_trail", "Show trail on map")}</button></div>` : nothing}
    `;
  }

  // The next run of a schedule set in the Matic app; read only, edited there.
  #next() {
    const next = this.state.nextSchedule;
    if (!next) return nothing;
    return html`
      <section class="run next" aria-labelledby="next-schedule">
        <h3 id="next-schedule">${this.#t("v4_schedule_next", "Next scheduled clean")}</h3>
        <p><strong>${next.name}</strong></p>
        <p class="subtle">${formatDateTime(next.startsAt, this.dates)}</p>
        ${next.detail ? html`<p>${next.detail}</p>` : nothing}
        <p class="subtle">${this.#t("v4_schedule_from_app", "Set in the Matic app")}</p>
      </section>
    `;
  }

  protected override render() {
    const resource = this.state.resources.runs;
    const history = resource.value?.entryId === this.state.resources.entry?.entryId ? resource.value : null;
    if (!history) {
      return html`<div class="stack">${this.#next()}${resource.status === "error"
        ? html`<p>${this.#t("v4_runs_unavailable", "Cleaning history isn't available right now.")}</p>
          <div><button class="ms-btn ms-btn--secondary" type="button" @click=${() => this.emit({ type: "open-workflow", workflow: "runs" })}>${this.#t("v4_retry", "Try again")}</button></div>`
        : html`<p class="subtle" role="status">${this.#t("v4_runs_loading", "Loading cleaning history…")}</p>`}</div>`;
    }
    const [last, ...earlier] = history.runs;
    return html`
      <div class="stack">
        ${this.#next()}
        ${history.robotHistory ? nothing : html`<p class="subtle">${this.#t("v4_runs_robot_unavailable", "Cleans started from the Matic app can't be read right now.")}</p>`}
        ${last ? html`
          <section class="run" aria-labelledby="last-run">
            <h3 id="last-run">${this.#title(last)}</h3>
            <p class="subtle">${this.#when(last)}</p>
            ${this.#details(last, true)}
          </section>
        ` : html`<p>${this.#t("v4_runs_empty", "No cleans yet. Each clean appears here once it starts.")}</p>`}
        ${earlier.length ? html`
          <h3 class="ms-section-heading" id="earlier-runs">${this.#t("v4_runs_earlier", "Earlier")}</h3>
          <div class="list" role="list" aria-labelledby="earlier-runs">
            ${earlier.map((run) => {
              const open = this._open === run.id;
              return html`<div class="run" role="listitem">
                <button class="ms-row" type="button" aria-expanded=${String(open)} @click=${() => { this._open = open ? null : run.id; }}>
                  <span class="ms-row__body"><strong>${this.#title(run)}</strong><small>${this.#when(run)} · ${this.#outcome(run)}</small></span>
                </button>
                ${open ? html`<div class="stack">${this.#details(run, false)}</div>` : nothing}
              </div>`;
            })}
          </div>
        ` : nothing}
      </div>
    `;
  }
}

if (!customElements.get(RUN_HISTORY_TAG)) {
  customElements.define(RUN_HISTORY_TAG, MaticRunHistoryV4);
}
