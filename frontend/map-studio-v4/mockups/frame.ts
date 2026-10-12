// The shell frame every 0.5 mockup screen renders into: app bar, canvas,
// status strip or bottom sheet, pinned h2 and notice slot, action bar, HUD,
// toast and dialog, laid out by design-system.md §7 and shell.md §3. It is
// presentational only: no effects, no hass, no dispatch. Buttons either do
// nothing or change a mockup toggle through a `mockup-change` event.
//
// "../index" is imported for two reasons. It registers the real shell, whose
// static styles (tokens + base + controls + shell-styles.ts) this frame reuses
// as-is; and it keeps esbuild's chunk partition for the shipped bundle
// identical, which an entry that skipped it would not (see the B2 report).
import "../index";
import { LitElement, css, html, nothing } from "lit";
import type { CSSResultGroup, PropertyValues, TemplateResult } from "lit";
import { SHELL_TAG } from "../element-tags";
import { iconChevronDown, iconChevronRight, iconChevronUp, iconDiagnostics, iconHelp, iconMenu, iconOverflow } from "../icons";
import { syntheticMockupFloor, syntheticMockupRobot } from "../synthetic-fixtures";
import { t } from "./copy";
import {
  glyphAlert,
  glyphAlertCircle,
  glyphCheck,
  glyphChevronBack,
  glyphClose,
  glyphDue,
  glyphExitFullMap,
  glyphFitMap,
  glyphFullMap,
  glyphRobot,
} from "./glyphs";
import { previewChips, previewControls, previewShell, previewTokens } from "./preview-styles";

// ---- Toggles ---------------------------------------------------------------

export type Detent = "peek" | "half" | "full";
export type DetentChoice = "start" | Detent;
export type Workflow = "none" | "rooms" | "plans" | "plan-run" | "plan-edit";
export type ScreenLayout = "sheet" | "compact-sheet" | "compact-inspector" | "inspector";

export interface Variants {
  readonly view: "run" | "edit";
  readonly order: "intelligent" | "ordered";
  readonly scope: "shared" | "plan";
  readonly due: boolean;
  /** Where plan Run was opened from (plan.md §5 `planOrigin`): it names Back. */
  readonly origin: "home" | "plans";
}

export const DEFAULT_VARIANTS: Variants = { view: "run", order: "intelligent", scope: "shared", due: true, origin: "plans" };

export interface StageFrame {
  readonly width: number;
  readonly height: number;
  readonly detent: DetentChoice;
}

export interface MockToggles extends Variants {
  readonly screen: string;
  readonly state: string;
  readonly detent: DetentChoice;
}

export type MockChange = Partial<MockToggles>;

export const MOCKUP_CHANGE = "mockup-change";

/** design-system.md §7 layout classes (they replace the shell's `width < 1024 || height < 480`). */
export const layoutFor = (width: number, height: number): ScreenLayout => {
  if (height < 480) return "compact-sheet";
  if (width >= 1024) return "inspector";
  if (width >= 768 && width > height) return "compact-inspector";
  return "sheet";
};

export const isNarrowLayout = (layout: ScreenLayout): boolean => layout === "sheet" || layout === "compact-sheet";

/** shell.md §5 Sheet: starting detents, regular then compact. */
const START_DETENT: Readonly<Record<Workflow, readonly [Detent, Detent]>> = {
  none: ["half", "full"],
  rooms: ["half", "peek"],
  plans: ["half", "full"],
  "plan-run": ["half", "full"],
  "plan-edit": ["full", "full"],
};

// ---- View model ------------------------------------------------------------

export type ActionKind = "primary" | "stop" | "stop-outline" | "secondary" | "plain" | "link";

export interface MockAction {
  readonly label: string;
  readonly kind: ActionKind;
  readonly ariaLabel?: string;
  /** Present: the control is `aria-disabled` and described by this reason. */
  readonly reason?: string;
  /** A 44 px link inside the reason (`PrimaryAction.jump`, plan.md §5). */
  readonly jump?: string;
  readonly glyph?: string;
  /** What pressing it does here. Absent: nothing. */
  readonly change?: MockChange;
}

export interface StatusView {
  readonly glyph: string;
  readonly title: string;
  readonly detail: string;
}

export type Tone = "info" | "success" | "warning" | "error";

export interface NoticeView {
  readonly tone: Tone;
  readonly text: string;
  /** shell.md §4 rule 3: success and error always toast. */
  readonly toast?: boolean;
}

export interface MapView {
  readonly mode: "map" | "empty";
  readonly selected?: readonly string[];
  /** Room ids in run order; numbered only in Saved order. */
  readonly numbers?: readonly string[];
  readonly robot?: "dock" | "cleaning";
  readonly chip?: string;
  readonly chipClear?: boolean;
  readonly card?: { readonly glyph: string; readonly title: string };
  readonly rail?: boolean;
  /** False: rooms have no names yet (home-rooms.md R9). */
  readonly labels?: boolean;
}

export interface BarView {
  readonly primary?: MockAction;
  readonly secondary?: MockAction;
  readonly summary?: string;
  /** Shown in the wide bar while Stop holds the strip (plan.md E6). */
  readonly note?: string;
}

export interface MotionView {
  readonly stop: MockAction;
  readonly resume?: MockAction;
}

export interface DialogView {
  readonly title: string;
  readonly body: string;
  readonly actions: readonly MockAction[];
}

export interface ShellView {
  readonly workflow: Workflow;
  readonly status: StatusView;
  /** Grip line at peek, when it differs from the status line. */
  readonly peekLine?: string;
  readonly back?: MockAction;
  readonly heading: string | TemplateResult;
  readonly headingTrail?: TemplateResult;
  readonly notice?: NoticeView;
  readonly body: TemplateResult;
  readonly bar?: BarView;
  readonly motion?: MotionView;
  readonly map: MapView;
  /** `detail` replaces the HUD detail (shell.md §5: `v4_locating_slow_full` after 20 s). */
  readonly fullMap?: { readonly locating: boolean; readonly detail?: string };
  /** Present: the app bar's Full map button and the HUD's Exit toggle Full map here. */
  readonly onFullMap?: () => void;
  readonly dialog?: DialogView;
}

// ---- Small templates ---------------------------------------------------------

/** icons.ts `icon()` plus design-system.md §4's `directional` option. */
export const glyph = (path: string, directional = false, extra = ""): TemplateResult => html`<svg
  class=${`ms-icon${directional ? " ms-icon--dir" : ""}${extra ? ` ${extra}` : ""}`}
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
><path d=${path}></path></svg>`;

export type ChipTone = "accent" | "warning" | "danger" | "neutral";

export const chip = (text: string, tone: ChipTone = "accent"): TemplateResult =>
  html`<span class="ms-chip" data-tone=${tone === "accent" ? nothing : tone}>${text}</span>`;

const TONE_GLYPH: Readonly<Record<Tone, string>> = {
  info: iconDiagnostics,
  success: glyphCheck,
  warning: glyphAlert,
  error: glyphAlertCircle,
};

export const toneGlyph = (tone: Tone): string => TONE_GLYPH[tone];

const inert = (event: Event): void => event.preventDefault();

// ---- Map ---------------------------------------------------------------------

const FLOOR = syntheticMockupFloor();

const escapeXml = (text: string): string => text
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;");

const centre = (boundary: readonly (readonly [number, number])[]): readonly [number, number] => {
  const xs = boundary.map(([x]) => x);
  const ys = boundary.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

/**
 * The floor as SVG markup. It is bound through `.innerHTML` on the <svg>
 * root because Lit's `svg` tag (and nested html templates inside <svg>) would
 * pull another export out of a production chunk. Every value is synthetic.
 */
const mapMarkup = (view: MapView): string => {
  const selected = new Set(view.selected ?? []);
  const parts: string[] = [];
  for (const room of FLOOR) {
    const points = room.boundary.map(([x, y]) => `${x},${y}`).join(" ");
    parts.push(`<polygon class="room${selected.has(room.roomId) ? " room--selected" : ""}" points="${points}"></polygon>`);
  }
  for (const room of view.labels === false ? [] : FLOOR) {
    const [x, y] = centre(room.boundary);
    parts.push(`<text class="room-label" x="${x}" y="${y + 0.5}" text-anchor="middle">${escapeXml(room.name)}</text>`);
  }
  (view.numbers ?? []).forEach((roomId, index) => {
    const room = FLOOR.find((candidate) => candidate.roomId === roomId);
    if (!room) return;
    const [x, y] = centre(room.boundary);
    parts.push(`<g class="room-number"><circle cx="${x}" cy="${y - 0.3}" r="0.32"></circle><text x="${x}" y="${y - 0.2}" text-anchor="middle">${index + 1}</text></g>`);
  });
  const [dockX, dockY] = syntheticMockupRobot.dock;
  parts.push(`<rect class="dock" x="${dockX - 0.3}" y="${dockY + 0.18}" width="0.6" height="0.16" rx="0.05"></rect>`);
  if (view.robot) {
    const [x, y] = view.robot === "cleaning" ? syntheticMockupRobot.cleaning : syntheticMockupRobot.dock;
    parts.push(`<g class="robot" transform="translate(${x - 0.42} ${y - 0.42}) scale(0.035)"><circle cx="12" cy="12" r="13"></circle><path d="${glyphRobot}"></path></g>`);
  }
  return parts.join("");
};

// ---- Styles ------------------------------------------------------------------

const shellCss = (): CSSResultGroup => {
  const shell = customElements.get(SHELL_TAG) as (CustomElementConstructor & { styles?: CSSResultGroup }) | undefined;
  if (!shell?.styles) throw new Error("Map Studio shell styles are not registered; import ../index first.");
  return shell.styles;
};

// Mockup-only scaffolding: the schematic map, the rail and chip stand-ins,
// and the row layouts the specs describe in prose. Spec deltas to shipped
// CSS live in preview-styles.ts, not here.
const frameCss = css`
.mock-map { position: absolute; inset: 0; inset-block-end: var(--mock-sheet, 0px); overflow: hidden; background: var(--ms-surface-app); container-type: size; }
.mock-map__svg { display: block; inline-size: 100%; block-size: 100%; padding: min(4rem, 20cqh) var(--ms-space-4) min(var(--ms-space-4), 6cqh); direction: ltr; }
.room { fill: color-mix(in srgb, var(--ms-text) 5%, var(--ms-surface-card)); stroke: var(--ms-line-strong); stroke-width: 0.03; }
.room--selected { fill: var(--ms-tint-accent); stroke: var(--ms-indicator); stroke-width: 0.07; }
.room-label { fill: var(--ms-text); font: 700 0.3px var(--ms-font); }
.room-number circle { fill: var(--ms-surface-card); stroke: var(--ms-indicator); stroke-width: 0.05; }
.room-number text { fill: var(--ms-text); font: 700 0.3px var(--ms-font); }
.dock { fill: var(--ms-text-quiet); }
.robot circle { fill: var(--ms-surface-card); stroke: var(--ms-line-strong); stroke-width: 1; }
.robot path { fill: var(--ms-text); }
.mock-rail { position: absolute; z-index: 4; inset-block-start: var(--ms-space-3); inset-inline-start: var(--ms-space-3); display: grid; gap: var(--ms-space-1); padding: var(--ms-space-1); border-radius: var(--ms-radius-md); }
.mock-map-chip { position: absolute; z-index: 4; inset-block-start: var(--ms-space-3); inset-inline: 0; display: flex; align-items: center; gap: var(--ms-space-2); inline-size: max-content; max-inline-size: calc(100% - 8rem); min-block-size: var(--ms-control-sm); margin-inline: auto; padding-inline: var(--ms-space-3); border-radius: var(--ms-radius-pill); font-size: var(--ms-t-md); font-weight: var(--ms-w-bold); }
.mock-map-chip > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mock-map-chip .ms-btn { margin-inline-end: calc(-1 * var(--ms-space-2)); }
.mock-canvas-card { position: absolute; inset: 0; inset-block-end: var(--mock-sheet, 0px); display: grid; justify-items: center; gap: var(--ms-space-2); inline-size: max-content; block-size: max-content; margin: auto; padding: var(--ms-space-4) var(--ms-space-5); color: var(--ms-text); font-size: var(--ms-t-lg); font-weight: var(--ms-w-bold); }
.mock-canvas-card .ms-icon { inline-size: 2rem; block-size: 2rem; color: var(--ms-text-quiet); }
.ms-toast.mock-toast { inset-inline: 0; inset-block-end: var(--mock-toast, var(--ms-space-4)); margin-inline: auto; }
.panel-heading { position: relative; min-block-size: var(--ms-control); }
.panel-heading h2 { font-size: var(--ms-t-xl); }
.heading-menu { position: absolute; z-index: 18; inset-block-start: calc(100% + var(--ms-space-1)); inset-inline-end: 0; display: grid; gap: var(--ms-space-1); min-inline-size: 15rem; max-inline-size: 18rem; padding: var(--ms-space-1); }
.heading-menu .menu-reason { margin: 0; padding: 0 var(--ms-space-3) var(--ms-space-2); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.sheet-status { min-inline-size: 0; }
.hud-actions { display: contents; }
.sr-only { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
`;

// Rows and groups the screens share. Each follows a prose layout line in the
// specs (cited per rule); none of it is a proposal for shipped CSS on its own.
const bodyCss = css`
.mock-stack { display: grid; gap: var(--ms-space-2); margin: 0; padding: 0; list-style: none; }
.mock-group { display: grid; gap: var(--ms-space-3); }
.list-header { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ms-space-1) var(--ms-space-2); min-block-size: var(--ms-control); }
.list-header .ms-section-heading { flex: 1; margin: 0; }
.list-header small, .quiet { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.row-lines { display: grid; gap: 0.125rem; min-inline-size: 0; }
.row-lines bdi { overflow: hidden; font-weight: var(--ms-w-bold); text-overflow: ellipsis; white-space: nowrap; }
.row-lines small { color: color-mix(in srgb, var(--ms-text) 78%, var(--ms-local)); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.row-lines .mock-chips { margin: 0; }
.warn-line, .ms-row__body small.warn-line { display: flex; gap: var(--ms-space-1); align-items: flex-start; color: var(--ms-text); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.warn-line .ms-icon { inline-size: 1rem; block-size: 1rem; color: var(--ms-warning); }
/* plan.md §3, §6 and the index "Due work" rule: one due line per due kind,
   --ms-t-xs in --ms-text with the due glyph, no live role. The glyph hangs
   so a wrapped line aligns with the text. The home card clamps the block to
   two lines (home-rooms.md §6); the full text stays in the DOM, so it stays
   in the card's accessible name. */
.due-block { display: grid; gap: 0.125rem; margin: 0; color: var(--ms-text); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.due-line { display: block; padding-inline-start: 1.25rem; text-indent: -1.25rem; }
.due-line .ms-icon { display: inline-block; inline-size: 1rem; block-size: 1rem; margin-inline-end: 0.25rem; vertical-align: -0.1875rem; color: var(--ms-indicator); }
.due-block--clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.check-line { display: flex; flex-wrap: wrap; gap: var(--ms-space-2); align-items: center; margin: 0; font-size: var(--ms-t-md); line-height: var(--ms-lh-snug); }
.check-line > .ms-icon { color: var(--ms-warning); }
.check-line > span { flex: 1; min-inline-size: 12rem; }
.switch-row { display: flex; gap: var(--ms-space-3); align-items: center; min-block-size: var(--ms-control); }
.switch-copy { display: grid; flex: 1; gap: 0.125rem; min-inline-size: 0; font-size: var(--ms-t-md); }
.switch-copy small { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.mock-fields { display: grid; gap: var(--ms-space-3); }
.ms-field > input, .ms-field > select { font-size: var(--ms-t-md); }
.ms-field { font-size: var(--ms-t-xs); }
.field-hint { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
.ms-segment { padding: 0; }
.ms-segment > .ms-btn { flex: 1; white-space: normal; }
.quiet-line { margin: 0; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); line-height: var(--ms-lh-snug); }
details.mock-details { border-radius: var(--ms-radius-sm); }
button.ms-disclosure { inline-size: 100%; border: 0; border-radius: var(--ms-radius-sm); color: inherit; background: transparent; text-align: start; }
button.ms-disclosure > span:first-child { flex: 1; min-inline-size: 0; }
.ms-row--plain { --ms-local: var(--ms-surface-card); }
.room-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; padding: 0; }
.room-row > .ms-check { padding-block: var(--ms-space-2); }
.room-row > .ms-btn--icon { margin-inline-end: var(--ms-space-1); }
.row-expanded { display: grid; grid-column: 1 / -1; gap: var(--ms-space-3); padding: 0 var(--ms-space-3) var(--ms-space-3); }
.settings-row { display: grid; padding: 0; }
.settings-row > .ms-disclosure { padding-block: var(--ms-space-1); }
details.mock-details > .mock-details__body { display: grid; gap: var(--ms-space-3); padding: var(--ms-space-2) var(--ms-space-3) var(--ms-space-3); }
`;

export const screenStyles: CSSResultGroup[] = [shellCss(), previewTokens, previewControls, previewChips, previewShell, frameCss, bodyCss];

// ---- The frame -----------------------------------------------------------------

interface DetentHeights {
  readonly peek: number;
  readonly half: number;
  readonly full: number;
}

export abstract class MockScreen extends LitElement {
  static override properties = {
    frame: { attribute: false },
    variants: { attribute: false },
    mockState: { attribute: false },
    _chrome: { state: true },
  };

  frame: StageFrame = { width: 390, height: 844, detent: "start" };
  variants: Variants = DEFAULT_VARIANTS;
  mockState = "";
  /** Measured sheet chrome C (design-system.md §7), regular sheets only. */
  protected _chrome = 0;
  #scrolledKey = "";

  protected abstract view(): ShellView;

  protected emit(change: MockChange): void {
    this.dispatchEvent(new CustomEvent<MockChange>(MOCKUP_CHANGE, { detail: change, bubbles: true, composed: true }));
  }

  protected get layout(): ScreenLayout {
    return layoutFor(this.frame.width, this.frame.height);
  }

  protected get narrow(): boolean {
    return isNarrowLayout(this.layout);
  }

  #detent(workflow: Workflow): Detent {
    const compact = this.layout === "compact-sheet";
    const choice = this.frame.detent;
    if (choice === "start") return START_DETENT[workflow][compact ? 1 : 0];
    return compact && choice === "half" ? "full" : choice;
  }

  #heights(reason: boolean): DetentHeights {
    if (this.layout === "compact-sheet") {
      const workspace = this.frame.height - 48;
      const full = Math.round(0.72 * workspace);
      const peek = reason ? 92 : 72;
      return { peek, half: full, full };
    }
    const workspace = this.frame.height - 56;
    const chrome = this._chrome || 132;
    const full = Math.round(Math.min(0.72 * workspace, workspace - 192));
    const half = Math.round(Math.min(full, Math.max(Math.min(0.48 * workspace, 416), chrome + 60)));
    return { peek: Math.min(chrome, half), half, full };
  }

  #press(action: MockAction): void {
    if (action.change) this.emit(action.change);
  }

  protected actionButton(action: MockAction, placement: "bar" | "row" | "grip" | "strip" | "hud" | "inline", reasonId: string): TemplateResult {
    const variant = {
      primary: "ms-btn--primary",
      link: "ms-btn--primary",
      stop: "ms-btn--primary ms-btn--danger",
      "stop-outline": "ms-btn--danger",
      secondary: "ms-btn--secondary",
      plain: "",
    }[action.kind];
    const size = placement === "bar" ? "ms-btn--lg ms-btn--block" : placement === "row" || placement === "grip" || placement === "hud" ? "ms-btn--lg" : "";
    const classes = ["ms-btn", variant, size].filter(Boolean).join(" ");
    const content = html`${action.glyph ? glyph(action.glyph) : nothing}${action.label}`;
    if (action.kind === "link") {
      return html`<a class=${classes} href="#open-integration" @click=${inert}>${content}</a>`;
    }
    return html`<button
      class=${classes}
      type="button"
      aria-disabled=${action.reason ? "true" : nothing}
      aria-describedby=${action.reason ? reasonId : nothing}
      aria-label=${action.ariaLabel ?? nothing}
      @click=${() => this.#press(action)}
    >${content}</button>`;
  }

  protected reasonLine(action: MockAction, id: string, className = "action-reason"): TemplateResult | typeof nothing {
    if (!action.reason) return nothing;
    return html`<p class=${className} id=${id}>${action.reason}${action.jump
      ? html` <a href="#review-room" @click=${inert}>${action.jump}</a>`
      : nothing}</p>`;
  }

  /** The bar's buttons after Stop placement (shell.md §3): strip on wide, bar on narrow. */
  #barActions(view: ShellView): readonly MockAction[] {
    const bar = view.bar ?? {};
    if (view.motion && this.narrow) {
      return [bar.secondary, view.motion.resume, view.motion.stop].filter((item): item is MockAction => Boolean(item));
    }
    if (view.motion) return bar.secondary ? [bar.secondary] : [];
    return [bar.secondary, bar.primary].filter((item): item is MockAction => Boolean(item));
  }

  #actionBar(view: ShellView, placement: "bar" | "grip"): TemplateResult | typeof nothing {
    const actions = this.#barActions(view);
    const note = view.motion && !this.narrow ? view.bar?.note : undefined;
    const summary = !view.motion && placement === "bar" ? view.bar?.summary : undefined;
    if (!actions.length && !note) return nothing;
    const ids = actions.map((_, index) => `bar-reason-${index}`);
    const buttons = actions.map((action, index) => this.actionButton(action, actions.length > 1 && placement === "bar" ? "row" : placement, ids[index] ?? ""));
    if (placement === "grip") return html`<div class="action-bar">${buttons}</div>`;
    return html`<div class="action-bar">
      ${summary ? html`<p class="action-summary">${summary}</p>` : nothing}
      ${actions.length > 1 ? html`<div class="action-row">${buttons}</div>` : buttons}
      ${note ? html`<p class="action-reason">${note}</p>` : nothing}
      ${actions.map((action, index) => this.reasonLine(action, ids[index] ?? ""))}
    </div>`;
  }

  #notice(notice: NoticeView): TemplateResult {
    return html`<div class="ms-notice" data-tone=${notice.tone}>
      ${glyph(toneGlyph(notice.tone))}
      <p>${notice.text}</p>
      <button class="ms-btn ms-btn--icon" type="button" aria-label=${t("v4_close")}>${glyph(glyphClose)}</button>
    </div>`;
  }

  #heading(view: ShellView): TemplateResult {
    return html`<div class="panel-pinned">
      <div class="panel-heading">
        ${view.back ? html`<button
          class="panel-back ms-btn ms-btn--icon"
          type="button"
          aria-label=${view.back.label}
          title=${view.back.label}
          @click=${() => view.back && this.#press(view.back)}
        >${glyph(glyphChevronBack, true)}</button>` : nothing}
        <h2 tabindex="-1">${view.heading}</h2>
        ${view.headingTrail ?? nothing}
      </div>
      ${view.notice ? this.#notice(view.notice) : nothing}
    </div>`;
  }

  #strip(view: ShellView): TemplateResult {
    const motion = view.motion;
    const actions = motion ? [motion.resume, motion.stop].filter((item): item is MockAction => Boolean(item)) : [];
    return html`<div class="status-strip">
      <span class="status-icon" aria-hidden="true">${glyph(view.status.glyph)}</span>
      <span class="status-copy"><strong>${view.status.title}</strong><small>${view.status.detail}</small></span>
      ${actions.length ? html`<span class="status-actions">${actions.map((action, index) => this.actionButton(action, "strip", `status-reason-${index}`))}</span>` : nothing}
      ${actions.map((action, index) => this.reasonLine(action, `status-reason-${index}`))}
    </div>`;
  }

  #sheet(view: ShellView, detent: Detent, height: number): TemplateResult {
    const compact = this.layout === "compact-sheet";
    const expand = detent !== "full";
    const next: Detent = expand ? (detent === "peek" && !compact ? "half" : "full") : compact ? "peek" : "half";
    const gripReason = compact ? this.#barActions(view).find((action) => action.reason) : undefined;
    const line = detent === "peek" && view.peekLine
      ? view.peekLine
      : `${view.status.title} · ${view.status.detail}`;
    return html`<aside
      id="map-workspace"
      class="inspector mobile-sheet"
      data-detent=${detent}
      style=${`block-size:${height}px`}
      aria-label=${t("v4_panel_region")}
    >
      <div class="sheet-grip">
        <span class="sheet-handle" role="presentation"></span>
        ${detent === "peek" && view.back ? html`<button
          class="sheet-back ms-btn ms-btn--icon"
          type="button"
          aria-label=${view.back.label}
          @click=${() => view.back && this.#press(view.back)}
        >${glyph(glyphChevronBack, true)}</button>` : nothing}
        <span class="sheet-status">${line}</span>
        <button
          class="sheet-toggle ms-btn ms-btn--icon"
          type="button"
          aria-label=${expand ? t("v4_sheet_expand") : t("v4_sheet_collapse")}
          aria-controls="sheet-body"
          @click=${() => this.emit({ detent: next })}
        >${glyph(expand ? iconChevronUp : iconChevronDown)}</button>
        ${compact ? this.#actionBar(view, "grip") : nothing}
      </div>
      ${gripReason ? this.reasonLine(gripReason, "bar-reason-0", "grip-reason") : nothing}
      ${this.#heading(view)}
      <div class="sheet-body" id="sheet-body">${view.body}</div>
      ${compact ? nothing : this.#actionBar(view, "bar")}
    </aside>`;
  }

  #inspector(view: ShellView): TemplateResult {
    return html`<aside id="map-workspace" class="inspector" aria-label=${t("v4_panel_region")}>
      ${this.#strip(view)}
      <section class="workflow">
        ${this.#heading(view)}
        <div class="workflow-body">${view.body}</div>
        ${this.#actionBar(view, "bar")}
      </section>
    </aside>`;
  }

  #canvas(view: ShellView, sheet: number): TemplateResult {
    const map = view.map;
    const showMap = map.mode === "map";
    const count = map.selected?.length ?? 0;
    return html`<div class="canvas">
      <div class="mock-map" style=${`--mock-sheet:${sheet}px`}>
        ${showMap ? html`<svg
          class="mock-map__svg"
          viewBox="0 0 11 7.4"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Synthetic floor map"
          .innerHTML=${mapMarkup(map)}
        ></svg>` : nothing}
      </div>
      ${map.card ? html`<div class="mock-canvas-card ms-surface ms-surface--floating" style=${`--mock-sheet:${sheet}px`}>
        ${glyph(map.card.glyph)}<span>${map.card.title}</span>
      </div>` : nothing}
      ${showMap && map.rail !== false ? html`<div class="mock-rail ms-surface ms-surface--floating">
        <button class="ms-btn ms-btn--icon" type="button" aria-label=${t("v4_fit_map")} title=${t("v4_fit_map")}>${glyph(glyphFitMap)}</button>
        <button class="ms-btn ms-btn--icon" type="button" aria-label=${t("v4_how_to_move")} title=${t("v4_how_to_move")}>${glyph(iconHelp)}</button>
      </div>` : nothing}
      ${map.chip || (map.chipClear && count) ? html`<div class="mock-map-chip ms-surface ms-surface--floating">
        <span>${map.chip ?? t("v4_rooms_selected", { count })}</span>
        ${map.chipClear ? html`<button class="ms-btn" type="button">${t("v4_clear")}</button>` : nothing}
      </div>` : nothing}
      ${this.#toast(view, sheet)}
    </div>`;
  }

  #hud(view: ShellView): TemplateResult {
    const primary = view.motion?.stop ?? (view.fullMap?.locating ? undefined : view.bar?.primary);
    return html`<section class="full-map-hud ms-surface ms-surface--floating has-secondary" aria-label="Robot status and action">
      <span class="hud-copy"><strong>${view.status.title}</strong><small>${view.fullMap?.detail ?? view.status.detail}</small></span>
      ${primary ? this.actionButton(primary, "hud", "hud-reason") : nothing}
      <button class="ms-btn ms-btn--lg ms-btn--secondary" type="button" @click=${() => view.onFullMap?.()}>${glyph(glyphExitFullMap)}${t("v4_exit_full_map")}</button>
      ${primary ? this.reasonLine(primary, "hud-reason") : nothing}
    </section>`;
  }

  #toast(view: ShellView, sheet: number): TemplateResult | typeof nothing {
    const notice = view.notice;
    if (!notice?.toast) return nothing;
    const bottom = view.fullMap ? "6.5rem" : this.narrow ? `${sheet + 8}px` : "1rem";
    return html`<div class="ms-toast mock-toast" data-tone=${notice.tone} style=${`--mock-toast:${bottom}`}>
      ${glyph(toneGlyph(notice.tone))}
      <p>${notice.text}</p>
      <button class="ms-btn ms-btn--icon" type="button" aria-label=${t("v4_close")}>${glyph(glyphClose)}</button>
    </div>`;
  }

  #dialog(dialog: DialogView): TemplateResult {
    return html`<div class="dialog-backdrop">
      <section class="dialog ms-surface ms-surface--overlay" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-detail">
        <h2 id="dialog-title">${dialog.title}</h2>
        <p id="dialog-detail">${dialog.body}</p>
        <div class="dialog-actions">${dialog.actions.map((action, index) => this.actionButton(action, "inline", `dialog-reason-${index}`))}</div>
      </section>
    </div>`;
  }

  protected override render(): TemplateResult {
    const view = this.view();
    const layout = this.layout;
    const narrow = this.narrow;
    const detent = this.#detent(view.workflow);
    const reason = this.#barActions(view).some((action) => action.reason);
    const heights = this.#heights(reason);
    const sheet = narrow && !view.fullMap ? heights[detent] : 0;
    const rootClass = [
      "root",
      narrow ? "narrow" : "wide",
      layout === "compact-sheet" ? "compact" : "",
      layout === "compact-inspector" ? "compact-inspector" : "",
    ].join(" ");
    return html`<div class=${rootClass} data-layout=${layout} data-detent=${narrow ? detent : nothing}>
      <div class="app" ?inert=${Boolean(view.dialog)}>
        <header class="app-bar">
          <button class="nav nav--menu ms-btn ms-btn--icon" type="button" aria-label=${t("v4_open_navigation")} title=${t("v4_open_navigation")}>${glyph(iconMenu)}</button>
          <h1 class="title">${t("map_studio_title")}</h1>
          <span class="spacer"></span>
          ${view.map.mode === "map" ? html`<button
            class="ms-btn ms-btn--icon"
            type="button"
            aria-label=${t("v4_full_map")}
            title=${t("v4_full_map")}
            aria-pressed=${String(Boolean(view.fullMap))}
            @click=${() => view.onFullMap?.()}
          >${glyph(glyphFullMap)}</button>` : nothing}
          <div class="overflow-wrap">
            <button class="overflow ms-btn ms-btn--icon" type="button" aria-label=${t("v4_map_options")} title=${t("v4_map_options")} aria-expanded="false">${glyph(iconOverflow)}</button>
          </div>
        </header>
        <main class=${`workspace ${view.fullMap ? "full-map" : ""}`}>
          ${this.#canvas(view, sheet)}
          ${view.fullMap ? this.#hud(view) : narrow ? this.#sheet(view, detent, sheet) : this.#inspector(view)}
        </main>
      </div>
      ${view.dialog ? this.#dialog(view.dialog) : nothing}
    </div>`;
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (this.layout === "sheet") {
      const bar = this.renderRoot.querySelector<HTMLElement>(".mobile-sheet > .action-bar");
      const chrome = 60 + (bar?.offsetHeight ?? 0) + 12;
      if (chrome !== this._chrome) this._chrome = chrome;
    }
    const key = `${this.mockState}|${JSON.stringify(this.variants)}|${JSON.stringify(this.frame)}`;
    if (key === this.#scrolledKey) return;
    this.#scrolledKey = key;
    const body = this.renderRoot.querySelector<HTMLElement>(".sheet-body, .workflow-body");
    const target = body?.querySelector<HTMLElement>("[data-scroll-target]");
    if (!body) return;
    body.scrollTop = target
      ? body.scrollTop + target.getBoundingClientRect().top - body.getBoundingClientRect().top - 8
      : 0;
  }
}

// ---- Shared builders ---------------------------------------------------------------

/** The due lines (plan.md §6 `v4_due_*`), each with the due glyph; `clamp` is the home card's two-line clamp. */
export const dueBlock = (lines: readonly string[], options: { readonly clamp?: boolean; readonly tag?: "span" | "div" } = {}): TemplateResult | typeof nothing => {
  if (!lines.length) return nothing;
  const content = lines.map((line) => html`<span class="due-line">${glyph(glyphDue)}${line}</span>`);
  const cls = `due-block${options.clamp ? " due-block--clamp" : ""}`;
  return options.tag === "div" ? html`<div class=${cls}>${content}</div>` : html`<span class=${cls}>${content}</span>`;
};

/** A Maps-group or home card row (`.ms-row--card`), as shell.ts renders them. */
export const cardRow = (options: {
  readonly lead: string;
  readonly title: string;
  /** A status chip on the title line (home-rooms.md §6: a paused default plan's "Paused"). */
  readonly titleExtra?: TemplateResult;
  readonly detail?: string;
  readonly extra?: TemplateResult | typeof nothing;
  readonly featured?: boolean;
  readonly disabledBy?: string;
  readonly onPress?: () => void;
}): TemplateResult => html`<button
  class=${`ms-row ms-row--card ${options.featured ? "ms-row--featured" : ""}`}
  type="button"
  aria-disabled=${options.disabledBy ? "true" : nothing}
  aria-describedby=${options.disabledBy ?? nothing}
  @click=${() => { if (!options.disabledBy) options.onPress?.(); }}
>
  <span class="ms-row__lead">${glyph(options.lead)}</span>
  <span class="ms-row__body">${options.titleExtra
    ? html`<strong class="card-title"><bdi>${options.title}</bdi>${options.titleExtra}</strong>`
    : html`<strong>${options.title}</strong>`}${options.detail ? html`<small>${options.detail}</small>` : nothing}${options.extra ?? nothing}</span>
  <span class="ms-row__trail">${glyph(iconChevronRight, true)}</span>
</button>`;
