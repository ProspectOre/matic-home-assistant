// The 0.5 sign-off mockups (Task B2): every redesigned screen and state from
// docs/ux-spec-0.5 on a resizable stage, with the variant toggles kept in the
// URL hash. Presentational only, like the screens it hosts: no effects, no
// hass, no dispatch, synthetic data only. Served by tests/browser/server.mjs
// at /map-studio-v4-mockups; never shipped (the build keeps it out of the
// production graph, and "./index" keeps that graph's chunks unchanged).
import "./index";
import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import { controls } from "./controls";
import { base, tokens } from "./tokens";
import { DEFAULT_VARIANTS, layoutFor } from "./mockups/frame";
import type { DetentChoice, MockChange, StageFrame, Variants } from "./mockups/frame";
import { MockHome, MockRooms, MockStatus } from "./mockups/home";
import { MockPlan, MockPlans, MockSchedule } from "./mockups/plan";
import { previewControls, previewTokens } from "./mockups/preview-styles";
import { MockSystem, MockThemePanel } from "./mockups/system";
import { D1_RESOLVED, HA_THEMES, RESOLVED_NAMES, type ThemeName } from "./mockups/themes";

const define = (tag: string, element: CustomElementConstructor): void => {
  if (!customElements.get(tag)) customElements.define(tag, element);
};

type ScreenId = "home" | "rooms" | "plans" | "plan" | "schedule" | "status" | "system";

interface StateEntry {
  readonly id: string;
  readonly label: string;
  readonly caption: string;
}

const entry = (id: string, label: string, caption: string): StateEntry => ({ id, label, caption });

const PLAN_RUN: readonly StateEntry[] = [
  entry("ready", "Daily clean", "plan.md §4 R1: the summary with about N min, the due lines directly under it, the next run with each room's effective setting and no due chips, and one When a run ends line (finish the room at 70 %). Numbers only in Saved order."),
  entry("parts", "In two parts", "plan.md §4 R1: a plan that runs in two parts, divided where the robot docks. The order toggle switches Intelligent rotation and Saved order."),
  entry("paused", "Paused plan", "plan.md §4 R2: the switch is off, the rooms are listed without numbers or chips, and Run plan is disabled with \"Can't run this plan until you turn it on.\" Opened from the home card (H1 Plan paused), it is Daily clean."),
  entry("blocked", "Needs attention", "plan.md §4 R3: Run plan disabled with its reason and a jump to the room."),
];

const PLAN_EDIT: readonly StateEntry[] = [
  entry("clean", "Clean edit", "plan.md §4 E1: nothing changed; Done is enabled and leaves without a dialog. Line 2 is the room's own mode and coverage; a room with schedules shows them as line 3 text; chips are status only."),
  entry("dirty", "Dirty edit", "plan.md §4 E2: the Unsaved changes chip; Cancel and Save stay pinned at the bottom."),
  entry("options", "When a run ends", "plan.md §3 Edit view: the When a run ends disclosure open: Return to the dock, Finish the current room with its hint, and the 70 % slider shown while that switch is on."),
  entry("menu", "Heading menu", "plan.md §3 Edit view: More actions holds Delete, disabled with its reason while there are changes."),
  entry("discard", "Discard dialog", "shell.md §5 dialogs: Cancel with changes asks before discarding: Keep editing, Save, Discard."),
  entry("new", "New plan", "plan.md §4 E3: New plan; Save is disabled with its reason until there is a name and a room."),
];

const SCREENS: Readonly<Record<ScreenId, { readonly label: string; readonly states: readonly StateEntry[] }>> = {
  home: {
    label: "Home",
    states: [
      entry("h1", "H1 Ready", "home-rooms.md §4 H1: the robot is docked and ready; three task cards and Maps. The plan card's line 3 holds the due lines, clamped to two."),
      entry("h1p", "H1 Plan paused", "home-rooms.md §6: the default plan is paused, so its card shows the Paused chip and no line 3; it still opens Run (plan.md R2)."),
      entry("h3", "H3 Locating", "home-rooms.md §4 H3: the heading stays, one reason line, and the cards are disabled with no per-card reasons. Status strip › Locating, after 20 s shows the escalation."),
      entry("h4", "H4 Cleaning", "home-rooms.md §4 H4: cleaning. Stop sits in the status strip beside an inspector, and in the action bar under a sheet."),
      entry("h7", "H7 Problem", "home-rooms.md §4 H7: the shell.md row 6 heading and body, Open map diagnostics, no cards, then Maps with diagnostics first."),
      entry("h10", "H10 No robot", "home-rooms.md §4 H10: no robot set up; Open integration is the one action."),
    ],
  },
  rooms: {
    label: "Rooms",
    states: [
      entry("r1", "R1 None selected", "home-rooms.md §4 R1: nothing selected; Clean rooms is disabled with its reason."),
      entry("r2", "R2 Checking", "home-rooms.md §4 R2: three rooms selected while the settings check runs; Clean 3 rooms disabled with its reason."),
      entry("r3", "R3 Selected, due lines", "home-rooms.md §4 R3: the due lines sit above the rows; selected rows show only their effective setting; the summary line sits over Clean 3 rooms."),
      entry("r3-room", "R3 Room open", "home-rooms.md §5: a room's Settings open; the row shows what will run, and the due lines above the rows say what is due."),
      entry("r3-settings", "Cleaning settings", "home-rooms.md §5: the Cleaning settings row open, with the due-work switch."),
      entry("r4", "R4 Check failed", "home-rooms.md §4 R4: the check failed; Try again, and Clean 3 rooms disabled with its reason."),
      entry("r9", "R9 Empty", "home-rooms.md §4 R9: no rooms; the description says so and there is no list."),
    ],
  },
  plans: {
    label: "Plan picker",
    states: [
      entry("ready", "Plans", "plan.md §3: the picker; line 3 shows the due lines (due glyph) or Needs attention (warning glyph)."),
      entry("empty", "No plans", "plan.md §3: no plans yet; Create plan is the only row."),
    ],
  },
  plan: { label: "Plan", states: PLAN_RUN },
  schedule: {
    label: "Room schedule",
    states: [
      entry("counting", "Counting", "room-schedule.md §4 S2: the Mop row and the vacuum rotation row share one shape, a label line, a control line (the level select beside the stepper at 390, stacked in the 360 px inspector) and a Due line; the next-clean switch names only the vacuum rotation, because Mop is already due next clean. The scope toggle switches Across all plans and In this plan only."),
      entry("next-clean", "Next clean on", "room-schedule.md §4 S4 and §5: the next-clean switch on; both rows read Due next clean, and the label keeps naming the work it brought forward."),
      entry("edited", "Edited", "room-schedule.md §4 S5: an edited interval restarts nothing; the status line reads Keeps the progress so far."),
      entry("available", "Shared available", "room-schedule.md §4 S6: a room with no schedule in this plan; the shared hint."),
      entry("joined", "Joined shared", "room-schedule.md §4 S7: the plan joins the room's shared schedule, read-only until saved."),
      entry("limits", "Limits", "room-schedule.md §5 Stepper: steppers at Off and at 100; the unavailable end carries its reason as screen-reader text and a tooltip, with no visible line. Advanced open."),
      entry("unconfirmed", "Can't confirm", "room-schedule.md §4 S11: progress can't be confirmed; the reason replaces the status line and Reset mopping shows inline."),
    ],
  },
  status: {
    label: "Status strip",
    states: [
      entry("ready", "Ready", "shell.md §4: Ready."),
      entry("cleaning", "Cleaning", "shell.md §4: Cleaning, with Stop."),
      entry("stopping", "Stopping", "shell.md §4: Stopping while it settles; Stop disabled with its reason."),
      entry("stopping-fence", "Stop settling", "shell.md §4: Stopping with stopSettlePending; Stop stays available."),
      entry("starting", "Starting", "shell.md §4: Starting."),
      entry("paused", "Paused", "shell.md §4: Paused, with Resume and Stop; when wide they share the strip's trailing slot on one row."),
      entry("problem", "Problem", "shell.md §4: Problem."),
      entry("offline", "Robot offline", "shell.md §4 row 5: Robot offline; the map is read only."),
      entry("map-unavailable", "Map unavailable", "shell.md §4: Map unavailable."),
      entry("notice", "Notice and toast", "shell.md §4 notice rule 2: the notice slot directly under the h2, and its toast."),
      entry("full-map", "Full map", "shell.md §3: Full map with the HUD."),
      entry("locating", "Locating", "shell.md §4 row 8: Full map while locating; the HUD keeps Exit and Stop."),
      entry("locating-slow", "Locating, after 20 s", "Decision shell D1: after 20 s. The sheet adds \"This is taking longer than usual.\" and Try again; in Full map (app bar) the HUD only swaps its detail, to \"Taking longer than usual\"."),
    ],
  },
  system: {
    label: "Design system",
    states: [
      entry("sheet", "Sheet", "design-system.md §4–§5: controls at rest, hover, focus and disabled with reason; tints in light and dark."),
      entry("targets", "Targets", "design-system.md §4: every target outlined, with the 44 px count."),
    ],
  },
};

const SCREEN_IDS = Object.keys(SCREENS) as ScreenId[];

const statesFor = (screen: ScreenId, view: Variants["view"]): readonly StateEntry[] =>
  screen === "plan" && view === "edit" ? PLAN_EDIT : SCREENS[screen].states;

const SIZES: readonly (readonly [number, number])[] = [
  [320, 844], [390, 844], [600, 1024], [768, 1024], [844, 390], [1024, 768], [1440, 900],
];

const DETENTS: readonly DetentChoice[] = ["start", "peek", "half", "full"];

interface GalleryState extends Variants {
  readonly screen: ScreenId;
  readonly state: string;
  readonly detent: DetentChoice;
  readonly width: number;
  readonly height: number;
  readonly theme: ThemeName;
  readonly dir: "ltr" | "rtl";
  /** design-system.md Decision 1: the `--ms-resolved-*` fills in place of HA's. */
  readonly d1: boolean;
}

const DEFAULTS: GalleryState = {
  ...DEFAULT_VARIANTS,
  screen: "home",
  state: "h1",
  detent: "start",
  width: 390,
  height: 844,
  theme: "light",
  dir: "ltr",
  d1: false,
};

const clampSize = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(value)));

/** Keeps the state id valid for its screen and view. */
const normalise = (state: GalleryState): GalleryState => {
  const states = statesFor(state.screen, state.view);
  if (states.some((candidate) => candidate.id === state.state)) return state;
  return { ...state, state: states[0]?.id ?? "" };
};

const fromHash = (hash: string): GalleryState => {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key);
    return allowed.find((candidate) => candidate === value) ?? fallback;
  };
  const size = (key: string, fallback: number, min: number): number => {
    const value = Number(params.get(key));
    return Number.isFinite(value) && value > 0 ? clampSize(value, min, 6000) : fallback;
  };
  return normalise({
    screen: pick("screen", SCREEN_IDS, DEFAULTS.screen),
    state: params.get("state") ?? "",
    view: pick("view", ["run", "edit"], DEFAULTS.view),
    order: pick("order", ["intelligent", "ordered"], DEFAULTS.order),
    scope: pick("scope", ["shared", "plan"], DEFAULTS.scope),
    due: params.get("due") !== "0",
    origin: pick("origin", ["home", "plans"], DEFAULTS.origin),
    detent: pick("detent", DETENTS, DEFAULTS.detent),
    width: size("w", DEFAULTS.width, 280),
    height: size("h", DEFAULTS.height, 320),
    theme: pick("theme", ["light", "dark"], DEFAULTS.theme),
    dir: pick("dir", ["ltr", "rtl"], DEFAULTS.dir),
    d1: params.get("d1") === "1",
  });
};

const toHash = (state: GalleryState): string => new URLSearchParams({
  screen: state.screen,
  state: state.state,
  view: state.view,
  order: state.order,
  scope: state.scope,
  due: state.due ? "1" : "0",
  origin: state.origin,
  detent: state.detent,
  w: String(state.width),
  h: String(state.height),
  theme: state.theme,
  dir: state.dir,
  d1: state.d1 ? "1" : "0",
}).toString();

const galleryCss = css`
:host { display: block; min-block-size: 100%; color: var(--ms-text); background: var(--ms-surface-sunken); font-family: var(--ms-font); }
.toolbar { display: grid; gap: var(--ms-space-2); padding: var(--ms-space-3) var(--ms-space-4); border-block-end: 1px solid var(--ms-line); background: var(--ms-surface-card); --ms-local: var(--ms-surface-card); }
.group { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ms-space-1) var(--ms-space-2); }
.group > .name { min-inline-size: 5.5rem; color: var(--ms-text-quiet); font-size: var(--ms-t-xs); font-weight: var(--ms-w-bold); }
.group .ms-btn { min-block-size: 2rem; padding-inline: var(--ms-space-2); font-size: var(--ms-t-xs); }
.group .sep { inline-size: 1px; block-size: 1.25rem; background: var(--ms-line); }
.readout { font-size: var(--ms-t-xs); font-variant-numeric: tabular-nums; color: var(--ms-text-quiet); }
.caption { margin: 0; font-size: var(--ms-t-md); line-height: var(--ms-lh-snug); }
.caption strong { margin-inline-end: var(--ms-space-2); }
.applies { color: var(--ms-text-quiet); font-size: var(--ms-t-xs); }
.viewport { padding: var(--ms-space-4); overflow: auto; }
.stage { position: relative; box-sizing: content-box; overflow: hidden; resize: both; contain: layout paint; border: 1px solid var(--ms-line); border-radius: 4px; background: var(--primary-background-color); min-inline-size: 280px; min-block-size: 320px; }
.stage > * { display: block; inline-size: 100%; block-size: 100%; }
`;

/** The gallery: toolbar, caption and the resizable stage. */
export class MapStudioMockups extends LitElement {
  static override properties = { _state: { state: true } };
  static override styles = [tokens, base, controls, previewTokens, previewControls, galleryCss];

  protected _state: GalleryState = fromHash(globalThis.location?.hash ?? "");
  #observer: ResizeObserver | null = null;
  #onHash = (): void => {
    const next = fromHash(location.hash);
    if (toHash(next) !== toHash(this._state)) this._state = next;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    addEventListener("hashchange", this.#onHash);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    removeEventListener("hashchange", this.#onHash);
    this.#observer?.disconnect();
    this.#observer = null;
  }

  #set(change: Partial<GalleryState>): void {
    const next = normalise({ ...this._state, ...change });
    this._state = next;
    history.replaceState(null, "", `#${toHash(next)}`);
  }

  #onMockChange = (event: Event): void => {
    const change = (event as CustomEvent<MockChange>).detail;
    const screen = SCREEN_IDS.find((id) => id === change.screen);
    const next: Partial<GalleryState> = {
      ...(screen ? { screen } : {}),
      ...(change.state !== undefined ? { state: change.state } : {}),
      ...(change.view !== undefined ? { view: change.view } : {}),
      ...(change.order !== undefined ? { order: change.order } : {}),
      ...(change.scope !== undefined ? { scope: change.scope } : {}),
      ...(change.due !== undefined ? { due: change.due } : {}),
      ...(change.origin !== undefined ? { origin: change.origin } : {}),
      ...(change.detent !== undefined ? { detent: change.detent } : {}),
    };
    this.#set(next);
  };

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    for (const [name, value] of Object.entries(HA_THEMES[this._state.theme])) this.style.setProperty(name, value);
    // Decision 1 writes only the six resolved properties on the host, as the
    // shell would; off, they are removed and the fills fall back to HA's.
    for (const name of RESOLVED_NAMES) {
      const value = this._state.d1 ? D1_RESOLVED[this._state.theme][name] : undefined;
      if (value) this.style.setProperty(name, value);
      else this.style.removeProperty(name);
    }
  }

  protected override firstUpdated(): void {
    const stage = this.renderRoot.querySelector<HTMLElement>(".stage");
    if (!stage) return;
    this.#observer = new ResizeObserver(([observed]) => {
      if (!observed) return;
      const width = Math.round(observed.contentRect.width);
      const height = Math.round(observed.contentRect.height);
      if (width > 0 && height > 0 && (width !== this._state.width || height !== this._state.height)) this.#set({ width, height });
    });
    this.#observer.observe(stage);
  }

  protected override async updated(changed: PropertyValues): Promise<void> {
    super.updated(changed);
    const key = toHash(this._state);
    const screen = this.renderRoot.querySelector<LitElement>("[data-screen]");
    await screen?.updateComplete;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (key === toHash(this._state)) this.dataset["mockKey"] = key;
  }

  #toggle<T extends string | boolean>(label: string, value: T, current: T, change: Partial<GalleryState>): TemplateResult {
    return html`<button class="ms-btn ms-btn--sm" type="button" aria-pressed=${String(value === current)} @click=${() => this.#set(change)}>${label}</button>`;
  }

  #screen(frame: StageFrame, variants: Variants): TemplateResult {
    const { screen, state } = this._state;
    switch (screen) {
      case "home":
        return html`<matic-mock-home data-screen .frame=${frame} .variants=${variants} .mockState=${state}></matic-mock-home>`;
      case "rooms":
        return html`<matic-mock-rooms data-screen .frame=${frame} .variants=${variants} .mockState=${state}></matic-mock-rooms>`;
      case "plans":
        return html`<matic-mock-plans data-screen .frame=${frame} .variants=${variants} .mockState=${state}></matic-mock-plans>`;
      case "plan":
        return html`<matic-mock-plan data-screen .frame=${frame} .variants=${variants} .mockState=${state}></matic-mock-plan>`;
      case "schedule":
        return html`<matic-mock-schedule data-screen .frame=${frame} .variants=${variants} .mockState=${state}></matic-mock-schedule>`;
      case "status":
        return html`<matic-mock-status data-screen .frame=${frame} .variants=${variants} .mockState=${state}></matic-mock-status>`;
      case "system":
        return html`<matic-mock-system data-screen .frame=${frame} .variants=${variants} .mockState=${state} .d1=${this._state.d1}></matic-mock-system>`;
    }
  }

  protected override render(): TemplateResult {
    const current = this._state;
    const variants: Variants = { view: current.view, order: current.order, scope: current.scope, due: current.due, origin: current.origin };
    const frame: StageFrame = { width: current.width, height: current.height, detent: current.detent };
    const states = statesFor(current.screen, current.view);
    const active = states.find((candidate) => candidate.id === current.state);
    const layout = layoutFor(current.width, current.height);
    return html`<div class="toolbar" role="group" aria-label="Mockup controls">
        <div class="group" role="group" aria-label="Screen">
          <span class="name">Screen</span>
          ${SCREEN_IDS.map((id) => this.#toggle(SCREENS[id].label, id, current.screen, { screen: id, state: "" }))}
        </div>
        <div class="group" role="group" aria-label="State">
          <span class="name">State</span>
          ${states.map((candidate) => this.#toggle(candidate.label, candidate.id, current.state, { state: candidate.id }))}
        </div>
        <div class="group" role="group" aria-label="Variants">
          <span class="name">Variants</span>
          ${this.#toggle("Run", "run", current.view, { view: "run" })}${this.#toggle("Edit", "edit", current.view, { view: "edit" })}
          <span class="sep"></span>
          ${this.#toggle("Intelligent", "intelligent", current.order, { order: "intelligent" })}${this.#toggle("Saved order", "ordered", current.order, { order: "ordered" })}
          <span class="sep"></span>
          ${this.#toggle("Across all plans", "shared", current.scope, { scope: "shared" })}${this.#toggle("In this plan only", "plan", current.scope, { scope: "plan" })}
          <span class="sep"></span>
          ${this.#toggle("Due", true, current.due, { due: true })}${this.#toggle("Not due", false, current.due, { due: false })}
          <span class="applies">Run/Edit: Plan. Order: Plan, and Daily clean on Home and the picker. Scope: Room schedule. Due: everywhere.</span>
        </div>
        <div class="group" role="group" aria-label="Stage">
          <span class="name">Stage</span>
          ${SIZES.map(([width, height]) => html`<button class="ms-btn ms-btn--sm" type="button" aria-pressed=${String(width === current.width && height === current.height)} @click=${() => this.#set({ width, height })}>${width === 844 ? "844×390" : String(width)}</button>`)}
          <span class="readout" aria-live="polite">${current.width} × ${current.height} · ${layout}</span>
          <span class="sep"></span>
          ${DETENTS.map((detent) => this.#toggle(detent === "start" ? "Starting detent" : detent, detent, current.detent, { detent }))}
          <span class="sep"></span>
          ${this.#toggle("Light", "light", current.theme, { theme: "light" })}${this.#toggle("Dark", "dark", current.theme, { theme: "dark" })}
          <span class="sep"></span>
          ${this.#toggle("HA fills", false, current.d1, { d1: false })}${this.#toggle("Decision 1", true, current.d1, { d1: true })}
          <span class="sep"></span>
          ${this.#toggle("LTR", "ltr", current.dir, { dir: "ltr" })}${this.#toggle("RTL", "rtl", current.dir, { dir: "rtl" })}
          <span class="applies">Dark sets HA's dark palette; the shadow tokens follow the OS colour scheme, as they do inside HA. Decision 1 swaps in the resolved fills, focus ring and danger text. RTL mirrors layout; English copy reorders.</span>
        </div>
        <p class="caption"><strong>${SCREENS[current.screen].label}${current.screen === "plan" ? ` · ${current.view === "run" ? "Run" : "Edit"}` : ""} · ${active?.label ?? ""}</strong>${active?.caption ?? nothing}</p>
      </div>
      <div class="viewport">
        <div
          class="stage"
          dir=${current.dir}
          style=${`inline-size: ${current.width}px; block-size: ${current.height}px; color-scheme: ${current.theme}`}
          @mockup-change=${this.#onMockChange}
        >${this.#screen(frame, variants)}</div>
      </div>`;
  }
}

define("matic-mock-home", MockHome);
define("matic-mock-rooms", MockRooms);
define("matic-mock-plans", MockPlans);
define("matic-mock-plan", MockPlan);
define("matic-mock-schedule", MockSchedule);
define("matic-mock-status", MockStatus);
define("matic-mock-theme-panel", MockThemePanel);
define("matic-mock-system", MockSystem);
define("matic-map-studio-mockups", MapStudioMockups);

declare global {
  interface HTMLElementTagNameMap {
    "matic-map-studio-mockups": MapStudioMockups;
  }
}
