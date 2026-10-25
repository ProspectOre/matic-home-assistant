import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { icon, iconCleaning, iconDone, iconMoveDown, iconMoveUp, iconMenu, iconDue, iconNoticeWarning } from "./icons";
import type { SavedArea, SavedPlan } from "./backend-contracts";
import type { HomePin, PrimaryAction, WorkspaceIntent, WorkspaceState } from "./contracts";
import { areaSelection, draftForPlan, selectPrimaryAction } from "./state";
import { dueLines, planRowLine2, type Translate } from "./plan-copy";
import { settingLabel } from "./plan-cadence";
import { actionReason } from "./plan-heading";

/**
 * Home shortcuts (owner, 2026-10-13): a saved plan or custom area the user
 * chose "Show on home" for runs with one tap. Each is gated exactly as its
 * own screen's primary is: the shortcut asks `selectPrimaryAction` what that
 * screen would offer, so it runs only when Run plan or Clean this area would,
 * and otherwise shows that button's reason. The tap itself goes through the
 * same action (the shell's `run`), never a new command.
 */
export interface ShortcutHost {
  readonly state: WorkspaceState;
  readonly t: Translate;
  /** Home is held (busy, locating, map not ready): every card says why through the home reason. */
  readonly held: boolean;
  readonly editing: boolean;
  readonly canReorder: boolean;
  readonly toggleEditing: () => void;
  readonly move: (pin: HomePin, direction: -1 | 1) => Promise<void>;
  readonly run: (pin: HomePin) => void;
  readonly emit: (intent: WorkspaceIntent) => void;
}

/** What the plan's Run view would offer now (a list being reread or that failed holds it there too). */
export const planShortcutAction = (state: WorkspaceState, plan: SavedPlan) => selectPrimaryAction({
  ...state,
  workflow: "plan",
  planView: "run",
  selection: { ...state.selection, planId: plan.id },
  planDraft: draftForPlan(plan),
});

/** What the saved area's screen would offer now. */
export const areaShortcutAction = (state: WorkspaceState, area: SavedArea) => selectPrimaryAction({
  ...state,
  ...areaSelection(state, area.id),
  workflow: "areaReview",
});

// An area that needs checking offers Save area on its screen, not Clean, so
// the shortcut says what to do instead.
const CHECK_AREA = { label: "", kind: "primary", enabled: false, id: "check-area", reason: "Can't clean this area until you check it.", reasonKey: "v4_reason_check_area" } as const;

// A shortcut is one button that runs (owner, 2026-10-14): it leads with the
// play glyph, so it reads as "starts now", unlike the cards that open a
// screen. Changing a plan or area is Your plans' or Your areas' job.
const shortcut = (host: ShortcutHost, pin: HomePin, name: string, title: string, lines: unknown, action: PrimaryAction | null, run: string, chip: unknown, position: number, total: number) => {
  const { t, held } = host;
  const enabled = !held && action?.id === run && action.enabled;
  const reasonAction = held || enabled ? null : action;
  const [before = "", after = ""] = host.editing ? ["", ""] : title.split("\u0000");
  const body = html`${host.editing ? nothing : html`<span class="ms-row__lead">${icon(iconCleaning)}</span>`}<span class="ms-row__body">
    <strong class="card-title"><span class="card-name">${before}<bdi>${name}</bdi>${after}</span>${chip}</strong>
    ${lines}
    ${reasonAction?.reason ? html`<span class="card-lines"><span class="line" data-tone="warning">${icon(iconNoticeWarning)}${actionReason(t, reasonAction, false, host.emit)}</span></span>` : nothing}
  </span>`;
  if (host.editing) {
    const move = (event: Event, direction: -1 | 1) => {
      const control = event.currentTarget as HTMLButtonElement;
      const group = control.closest(".home-shortcuts");
      const root = group?.getRootNode();
      const rootHost = root instanceof ShadowRoot ? root.host : null;
      const focused = control.matches(":focus");
      void host.move(pin, direction).then(() => {
        if (!focused || !group?.isConnected) return;
        let active: Element | null = document.activeElement;
        while (active instanceof HTMLElement && active.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        if (active && active !== document.body && active !== rootHost && active !== control) return;
        const target = [...group.querySelectorAll<HTMLButtonElement>("button[data-shortcut-kind]")]
          .find((candidate) => candidate.dataset.shortcutKind === pin.kind
            && candidate.dataset.shortcutId === pin.id
            && candidate.dataset.moveDirection === (direction < 0 ? "up" : "down"));
        target?.focus({ preventScroll: true });
      });
    };
    const atStart = position === 0;
    const atEnd = position === total - 1;
    return html`<div class="ms-row ms-row--card shortcut shortcut-edit">${body}${host.canReorder ? html`<span class="shortcut-order">
      <button class="ms-btn ms-btn--icon" type="button" data-shortcut-kind=${pin.kind} data-shortcut-id=${pin.id} data-move-direction="up" aria-label=${t("v4_move_shortcut_up", "Move {shortcut} up", { shortcut: name })} aria-disabled=${String(atStart)} @click=${(event: Event) => { if (!atStart) move(event, -1); }}>${icon(iconMoveUp)}</button>
      <button class="ms-btn ms-btn--icon" type="button" data-shortcut-kind=${pin.kind} data-shortcut-id=${pin.id} data-move-direction="down" aria-label=${t("v4_move_shortcut_down", "Move {shortcut} down", { shortcut: name })} aria-disabled=${String(atEnd)} @click=${(event: Event) => { if (!atEnd) move(event, 1); }}>${icon(iconMoveDown)}</button>
    </span>` : nothing}</div>`;
  }
  return html`<button class="ms-row ms-row--card shortcut" type="button" data-launcher=${`run:${pin.kind}:${pin.id}`} aria-disabled=${enabled ? nothing : "true"}
    aria-describedby=${held ? "home-reason" : nothing} @click=${() => { if (enabled) host.run(pin); }}>${body}</button>`;
};

const planShortcut = (host: ShortcutHost, pin: HomePin, plan: SavedPlan, position: number, total: number) => {
  const { t, state } = host;
  const action = planShortcutAction(state, plan);
  const due = plan.enabled ? dueLines(t, state.locale, plan.nextRunPreview?.rooms ?? []) : [];
  return shortcut(host, pin, plan.name, t("v4_run_named_plan", "Run {plan}", { plan: "\u0000" }),
    html`<small><bdi dir="auto">${planRowLine2(t, state.locale, plan)}</bdi></small>${due.length ? html`<span class="card-lines">${due.map((line) => html`<span class="line">${icon(iconDue)}${line}</span>`)}</span>` : nothing}`,
    "label" in action ? action : null, "run-plan", plan.enabled ? nothing : html`<span class="ms-chip">${t("v4_paused", "Paused")}</span>`, position, total);
};

const areaShortcut = (host: ShortcutHost, pin: HomePin, area: SavedArea, position: number, total: number) => {
  const { t, state } = host;
  const action = areaShortcutAction(state, area);
  return shortcut(host, pin, area.name, t("v4_clean_named_area", "Clean {area}", { area: "\u0000" }), html`<small>${settingLabel(t, area)}</small>`,
    !("label" in action) ? null : action.id === "save-area" ? CHECK_AREA : action, "run-area", nothing, position, total);
};

/** The ordered home shortcuts and their accessible edit/reorder controls. */
export const homeShortcuts = (host: ShortcutHost) => {
  const { state, t } = host;
  const plans = state.resources.plans.value?.plans ?? [];
  const areas = state.resources.areas.value?.areas ?? [];
  const visiblePins = state.homePins.pins.filter((pin) => pin.kind === "plan"
    ? plans.some((candidate) => candidate.id === pin.id) : areas.some((candidate) => candidate.id === pin.id));
  const canReorder = host.canReorder && visiblePins.length === state.homePins.pins.length;
  const rowHost = { ...host, canReorder };
  const rows = repeat(visiblePins, (pin) => `${pin.kind}:${pin.id}`, (pin, index) => {
    if (pin.kind === "plan") {
      const plan = plans.find((candidate) => candidate.id === pin.id);
      return plan ? planShortcut(rowHost, pin, plan, index, visiblePins.length) : nothing;
    }
    const area = areas.find((candidate) => candidate.id === pin.id);
    return area ? areaShortcut(rowHost, pin, area, index, visiblePins.length) : nothing;
  });
  const planError = state.homePins.status === "ready" && state.homePins.pins.some((pin) => pin.kind === "plan") && state.resources.plans.status === "error";
  const areaError = state.homePins.status === "ready" && state.homePins.pins.some((pin) => pin.kind === "area") && state.resources.areas.status === "error";
  if (!visiblePins.length && state.homePins.status !== "error" && !planError && !areaError) return nothing;
  const heading = t("v4_shortcuts_heading", "Shortcuts");
  return html`<h3 class="ms-section-heading home-shortcuts-heading" id="shortcuts-heading">${heading}<button class="ms-btn ms-btn--icon" type="button"
    aria-label=${host.editing ? t("v4_done_editing_home_shortcuts", "Done editing shortcuts") : t("v4_edit_home_shortcuts", "Edit shortcuts")}
    ?disabled=${!host.editing && !canReorder} @click=${host.toggleEditing}>${icon(host.editing ? iconDone : iconMenu)}</button></h3>
    <div class="quick-actions home-shortcuts" role="group" aria-labelledby="shortcuts-heading">${rows}${state.homePins.status === "error" ? html`<p class="pins-error">${t("v4_shortcuts_unavailable", "Home Assistant couldn't load your home shortcuts.")} <button class="ms-btn ms-btn--secondary" type="button" @click=${() => host.emit({ type: "reload-home-pins" })}>${t("v4_retry", "Try again")}</button></p>` : nothing}
      ${planError ? html`<p class="pins-error">${t("v4_shortcuts_plans_unavailable", "Saved plan shortcuts couldn't be loaded.")} <button class="ms-btn ms-btn--secondary" type="button" @click=${() => host.emit({ type: "open-workflow", workflow: "plans" })}>${t("v4_shortcuts_open_plans", "Open Plans")}</button></p>` : nothing}
      ${areaError ? html`<p class="pins-error">${t("v4_shortcuts_areas_unavailable", "Saved area shortcuts couldn't be loaded.")} <button class="ms-btn ms-btn--secondary" type="button" @click=${() => host.emit({ type: "open-workflow", workflow: "areas" })}>${t("v4_shortcuts_open_areas", "Open Areas")}</button></p>` : nothing}
    </div>`;
};

/**
 * "Show on home" on a saved plan's Run view and a saved area's screen. It
 * waits while the shortcuts load, says why it can't change after a failed
 * read, and is absent where Home Assistant has no user data to keep it in.
 */
export const homePinSwitch = (t: Translate, state: WorkspaceState, pin: HomePin, emit: (intent: WorkspaceIntent) => void) => {
  const { status, pins } = state.homePins;
  if (status === "unavailable") return nothing;
  const pinned = pins.some((candidate) => candidate.kind === pin.kind && candidate.id === pin.id);
  const reason = status === "ready" ? null
    : status === "error"
      ? t("v4_reason_shortcuts_unavailable", "Can't change this until you choose Try again on the home screen.")
      : t("v4_reason_shortcuts_loading", "Waiting for Home Assistant to load your home shortcuts.");
  return html`
    <div class="switch-row">
      <span class="switch-copy">
        <span id="pin-label">${t("v4_show_on_home", "Show on home")}</span>
        <small id="pin-hint">${pin.kind === "plan"
          ? t("v4_show_plan_on_home_hint", "Adds a one-tap button for this plan to the Matic Map home screen.")
          : t("v4_show_area_on_home_hint", "Adds a one-tap button for this area to the Matic Map home screen.")}</small>
      </span>
      <button
        class="ms-switch"
        type="button"
        role="switch"
        aria-checked=${String(pinned)}
        aria-labelledby="pin-label"
        aria-describedby=${reason ? "pin-hint pin-reason" : "pin-hint"}
        aria-disabled=${reason ? "true" : nothing}
        @click=${() => { if (!reason) emit({ type: "set-home-pin", pin, pinned: !pinned }); }}
      ></button>
    </div>
    ${reason ? html`<p class="reason" id="pin-reason">${reason}</p>` : nothing}
  `;
};
