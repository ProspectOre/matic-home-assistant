import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { html as staticHtml, unsafeStatic } from "lit/static-html.js";
import { controls } from "./controls";
import { icon, iconOverflow } from "./icons";
import { base, tokens } from "./tokens";
import type { Localize, NoButtonAction, PrimaryAction, WorkspaceIntent, WorkspaceState } from "./contracts";
import { PLAN_TOOLS_TAG, PLAN_VIEWS_TAG, WORKFLOW_TAG } from "./element-tags";
import { WORKSPACE_INTENT_EVENT } from "./map-canvas";
import { MenuController } from "./menu-controller";
import { deleteSubject, initialWorkspaceState } from "./state";
import { translate } from "./localize";

/**
 * The tools after a plan's heading (plan.md §3): Run's Edit button, or the
 * More actions menu of a saved plan's Edit. They show only inside the plan
 * workflow, so they load with its views.
 */
class MaticPlanToolsV4 extends LitElement {
  static override properties = {
    state: { attribute: false },
    localize: { attribute: false },
  };

  // `display: contents` lays the button and its reason line into the
  // heading's own row, so the line can wrap below the whole heading.
  static override styles = [tokens, base, controls, css`
:host { display: contents; }
.more { position: relative; margin-inline-start: auto; }
/* It opens in Edit's place, under the pointer that just pressed Edit: a hover
   fade would still be running when the next press lands. */
.more > .ms-btn { transition: none; }
.reason { flex-basis: 100%; margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); text-align: end; }
.menu { position: absolute; z-index: 18; inset-block-start: calc(100% + var(--ms-space-1)); inset-inline-end: 0; display: grid; min-inline-size: 14rem; padding: var(--ms-space-1); }
.menu .ms-row { justify-content: flex-start; inline-size: 100%; }
.menu .reason { padding: var(--ms-space-1) var(--ms-space-3); text-align: start; }
`];

  state: WorkspaceState = initialWorkspaceState();
  localize?: Localize;

  #t(key: string, fallback: string, placeholders?: Readonly<Record<string, string>>): string {
    return translate(this.localize, key, fallback, placeholders);
  }

  // Dispatched from `from` so the shell finds the launcher on the event path.
  #intent(intent: WorkspaceIntent, from: EventTarget = this): void {
    from.dispatchEvent(new CustomEvent(WORKSPACE_INTENT_EVENT, { detail: intent, bubbles: true, composed: true }));
  }

  readonly #menu = new MenuController(this, ".more", "> button");

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("state") && this.state.planView !== "edit") this.#menu.open = false;
  }

  // Delete waits for an unsaved edit and for any command still pending: a
  // write asked for then would be refused while the dialog closed as if it
  // had been sent.
  #deleteReason(): string | null {
    const { command, pendingAction, planDraft } = this.state;
    if (pendingAction === "save-plan") return this.#t("v4_reason_plan_saving", "Waiting for Home Assistant to save the plan.");
    if (planDraft.dirty) return this.#t("v4_delete_plan_unsaved", "Can't delete this plan until you save or cancel your changes.");
    return command === "pending" ? this.#t("v4_reason_robot_operation_waiting", "Waiting for the robot to finish what it's doing.") : null;
  }

  #delete(event: Event): void {
    if (this.#deleteReason()) return;
    const launcher = (event.currentTarget as HTMLElement).closest(".more")?.querySelector("button");
    this.#menu.close(false);
    this.#intent({ type: "open-dialog", dialog: "confirmDeletePlan" }, launcher ?? this);
  }

  protected override render() {
    const { planView, planDraft, pendingAction } = this.state;
    if (planView === "run") {
      const reason = pendingAction === "save-plan"
        ? this.#t("v4_reason_plan_saving", "Waiting for Home Assistant to save the plan.")
        : pendingAction === "run-plan"
          ? this.#t("v4_reason_run_plan_checking", "Waiting for Home Assistant to check the next run.")
          : null;
      return html`
        <button
          class="ms-btn ms-btn--secondary"
          type="button"
          aria-label=${this.#t("v4_edit_plan_named", "Edit {plan}", { plan: planDraft.name })}
          aria-disabled=${reason ? "true" : nothing}
          aria-describedby=${reason ? "edit-reason" : nothing}
          @click=${() => { if (!reason) this.#intent({ type: "set-plan-view", view: "edit" }); }}
        >${this.#t("v4_edit", "Edit")}</button>
        ${reason ? html`<p class="reason" id="edit-reason">${reason}</p>` : nothing}
      `;
    }
    // Its one action is Delete, so it shows only while the catalog holds the plan.
    if (!deleteSubject(this.state, "confirmDeletePlan")) return nothing;
    const held = this.#deleteReason();
    return html`
      <div class="more" @keydown=${this.#menu.keydown} @focusout=${this.#menu.focusout}>
        <button
          class="ms-btn ms-btn--icon"
          type="button"
          aria-label=${this.#t("v4_more_actions", "More actions")}
          aria-haspopup="menu"
          aria-expanded=${String(this.#menu.open)}
          data-dialog-launcher="confirmDeletePlan"
          @click=${() => this.#menu.toggle()}
        >${icon(iconOverflow)}</button>
        ${this.#menu.open ? html`
          <div class="menu ms-surface ms-surface--overlay" @mousedown=${(event: Event) => event.preventDefault()}>
            <div role="menu" aria-label=${this.#t("v4_more_actions", "More actions")}><button
              class="ms-row ms-row--menu"
              type="button"
              role="menuitem"
              tabindex="-1"
              aria-disabled=${held ? "true" : nothing}
              aria-describedby=${held ? "delete-reason" : nothing}
              @click=${this.#delete}
            >${this.#t("plan_delete", "Delete")}</button></div>
            ${held ? html`<p class="reason" id="delete-reason">${held}</p>` : nothing}
          </div>
        ` : nothing}
      </div>
    `;
  }
}

if (!customElements.get(PLAN_TOOLS_TAG)) customElements.define(PLAN_TOOLS_TAG, MaticPlanToolsV4);

// The shell's plan-only pieces load with these views, since only the plan
// workflow shows them.
type Translate = (key: string, fallback: string, placeholders?: Readonly<Record<string, string | number>>) => string;

// The plan's heading: Run's plan name isolated in <bdi>, and the chip that
// says the draft has unsaved changes (plan.md §3).
export const planTitle = (state: WorkspaceState, title: string, t: Translate) => html`${state.planView === "run" ? html`<bdi>${title}</bdi>` : title}${state.planDraft.dirty
  ? html` <span class="ms-chip">${t("v4_plan_unsaved", "Unsaved changes")}</span>` : nothing}`;

const planToolsTag = unsafeStatic(PLAN_TOOLS_TAG);

// The heading's tools; `capture` is the shell's launcher capture for the
// dialogs they open.
export const planTools = (state: WorkspaceState, localize: Localize | undefined, capture: (event: Event) => void) => staticHtml`<${planToolsTag}
  .state=${state}
  .localize=${localize}
  @matic-workspace-intent=${capture}
></${planToolsTag}>`;

// A translated sentence with the room it names isolated in <bdi>.
const named = (t: Translate, key: string, fallback: string, values?: Readonly<Record<string, string | number>>) => {
  const room = values?.room;
  if (room === undefined) return t(key, fallback, values);
  const [before, after] = t(key, fallback, { ...values, room: "\u0000" }).split("\u0000");
  return html`${before}<bdi>${room}</bdi>${after}`;
};

/**
 * A disabled action's reason, and in the action bar the link that opens the
 * room it names (plan.md R3). The HUD's reason is visually hidden, so a link
 * there would be a focus stop no one sees.
 */
export const actionReason = (t: Translate, action: PrimaryAction, link: boolean, emit: (intent: WorkspaceIntent) => void) => {
  const jump = link ? action.jump : undefined;
  return html`${named(t, action.reasonKey ?? "", action.reason ?? "", action.reasonPlaceholders)}${jump ? html` <button
    class="ms-btn action-jump"
    type="button"
    @click=${() => emit({ type: "set-plan-view", view: "edit", roomId: jump.roomId })}
  >${named(t, jump.labelKey, jump.label, jump.labelPlaceholders)}</button>` : nothing}`;
};

/**
 * Edit's Cancel (plan.md §3, E2-E6): back to Run, or to the picker for a new
 * plan, asking first when there are edits. Only a save in flight holds it,
 * and then Save's own reason line, when shown, is Cancel's too. With Stop in
 * the strip (E6) the primary's place says when Save comes back.
 */
export const planCancel = (
  state: WorkspaceState,
  primary: PrimaryAction | NoButtonAction | null,
  t: Translate,
  leave: (intent: WorkspaceIntent, launcher: EventTarget | null) => void,
) => {
  const busy = state.pendingAction === "save-plan";
  const reasonId = primary?.id === "save-plan" ? "primary-reason" : "cancel-reason";
  return html`
    <button
      class="ms-btn ms-btn--block ms-btn--lg ms-btn--secondary"
      type="button"
      data-dialog-launcher="discardDraft"
      aria-disabled=${busy ? "true" : nothing}
      aria-describedby=${busy ? reasonId : nothing}
      @click=${(event: Event) => {
        if (!busy) leave(state.planDraft.id ? { type: "set-plan-view", view: "run" } : { type: "open-workflow", workflow: "plans" }, event.currentTarget);
      }}
    >${t("v4_cancel", "Cancel")}</button>
    ${busy && reasonId === "cancel-reason" ? html`<p class="action-reason" id=${reasonId}>${t("v4_reason_plan_saving", "Waiting for Home Assistant to save the plan.")}</p>` : nothing}
    ${primary ? nothing : html`<p class="action-summary">${t("v4_plan_save_after_work", "You can save when the robot finishes.")}</p>`}
  `;
};

// Draw's Cancel (map-surfaces.md §4 R11): Your areas for a new area (its one
// way in, owner 2026-10-13), the area's review when it opened from Redraw,
// which also reloads the saved outline. Dirty drafts ask first through the
// launcher's discardDraft.
export const drawCancel = (
  state: WorkspaceState,
  t: Translate,
  leave: (intent: WorkspaceIntent, launcher: EventTarget | null) => void,
) => html`
    <button
      class="ms-btn ms-btn--block ms-btn--lg ms-btn--secondary"
      type="button"
      data-dialog-launcher="discardDraft"
      @click=${(event: Event) => leave(drawExit(state), event.currentTarget)}
    >${t("v4_cancel", "Cancel")}</button>
  `;

/** Where Draw's Back and Cancel go: the saved area's review, else Your areas. */
const drawExit = (state: WorkspaceState): WorkspaceIntent =>
  state.areaDraft.id !== null
    ? { type: "select-area", areaId: state.areaDraft.id, workflow: "areaReview" }
    : { type: "open-workflow", workflow: "areas" };

/**
 * Where focus goes after leaving a plan view (plan.md §5 Navigation and
 * focus): Review to the room it opened, a step back from Edit to Run's Edit
 * button, a step back to the picker to that plan's row. Anything else, or a
 * launcher that is gone, leaves the shell to take the heading.
 */
const planFocusTarget = (previous: WorkspaceState, state: WorkspaceState, root: ParentNode): HTMLElement | null | undefined => {
  const panel = root.querySelector(WORKFLOW_TAG)?.shadowRoot;
  // Done or Cancel from a redraw lands on the review's Redraw (map-surfaces.md §4).
  if (previous.workflow === "draw" && state.workflow === "areaReview") {
    return previous.areaDraft.id !== null
      ? root.querySelector("[data-redraw]") ?? panel?.querySelector("[data-redraw]")
      : null;
  }
  // Back to Your areas lands on the area it left, else on New area.
  if (state.workflow === "areas") {
    const area = previous.areaDraft.id;
    return (area && panel?.querySelector<HTMLElement>(`[data-area-row="${CSS.escape(area)}"]`)) || panel?.querySelector<HTMLElement>("[data-area-new]");
  }
  if (previous.workflow === "draw") return null;
  const views = panel?.querySelector(PLAN_VIEWS_TAG)?.shadowRoot;
  // Run's rows are never open, so an open row on entering Edit is Review's.
  if (state.workflow === "plan" && state.planView === "edit" && state.expandedRoom) {
    return views?.querySelector(`[data-room-disclosure="${CSS.escape(state.expandedRoom)}"]`);
  }
  if (state.workflow === "plan" && previous.planView === "edit") {
    return root.querySelector(PLAN_TOOLS_TAG)?.shadowRoot?.querySelector("button");
  }
  const row = previous.selection.planId;
  return state.workflow === "plans" && row ? views?.querySelector(`[data-plan-row="${CSS.escape(row)}"]`) : null;
};

/** Focuses that control when the shell's `visible` test passes; false leaves focus to the shell. */
export const focusPlanTarget = (
  previous: WorkspaceState,
  state: WorkspaceState,
  root: ParentNode,
  visible: (element: HTMLElement | null | undefined) => element is HTMLElement,
): boolean => {
  const target = planFocusTarget(previous, state, root);
  if (!visible(target)) return false;
  target.scrollIntoView({ block: "nearest" });
  target.focus({ preventScroll: true });
  return true;
};
