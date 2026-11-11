// The owner walkthrough stage (docs/owner-walkthrough-0.5.md): one URL hash
// puts the real shell gallery into a matrix cell's scenario, dialog, size,
// theme, direction and language. Review only: served by
// tests/browser/gallery_server.mjs at /map-studio-v4-stage, never shipped.
// It imports "./review" so the production graph's chunks stay unchanged.
import "./review";
import type { DialogKind, Localize, WorkspaceState } from "../map-studio-v4/contracts";
import type { MaticMapStudioGalleryV4 } from "./gallery";
import { GALLERY_DIALOGS, GALLERY_SCENARIOS, type GalleryScenario } from "./gallery-state";
import { HA_THEMES } from "./mockups/themes";
// The walkthrough matrix (scripts/walkthrough_cells.json); only this
// review entry imports it, so it stays out of the panel's startup graph.
import WALKTHROUGH from "../../scripts/walkthrough_cells.json";

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";
const FRAME_PATH = "/map-studio-v4-stage-frame";
const STRINGS_PATH = "/map-studio-v4-stage/strings.json";
const PREFIX = "component.matic_robot.common.";

export interface StageStep {
  readonly scenario: GalleryScenario;
  readonly dialog: DialogKind | null;
  readonly label: string;
}

export interface StageParams {
  readonly cell: string;
  /** True only for a cell ID whose settings are exactly that matrix cell's. */
  readonly cellMatches: boolean;
  readonly steps: readonly StageStep[];
  /** Zero-based index into `steps`. */
  readonly step: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly theme: "light" | "dark";
  readonly dir: "ltr" | "rtl";
  /** `xa`: the synthetic pseudo-language built from strings.json `common`. */
  readonly lang: "en" | "xa";
  readonly contrast: "normal" | "forced";
  readonly motion: "normal" | "reduce";
  readonly input: "pointer" | "touch";
  readonly readout: "none" | "tree";
  readonly errors: readonly string[];
}

/**
 * The settings a matrix cell stages, as `key=value` pairs: its ID, its row's
 * steps and its column's setup (scripts/walkthrough.mjs cellHash), or null
 * for an ID not in the matrix.
 */
const cellSettings = (id: string): string[] | null => {
  const [rowId, columnId] = id.split("-");
  const row = WALKTHROUGH.rows.find((candidate) => candidate.id === rowId);
  const column = WALKTHROUGH.columns.find((candidate) => candidate.id === columnId);
  if (!row || !column || id !== `${row.id}-${column.id}`) return null;
  return [`cell=${id}`, `steps=${row.steps.join(",")}`, ...column.hash.split("&")];
};

const KNOWN_KEYS = ["cell", "steps", "step", "w", "h", "theme", "dir", "lang", "contrast", "motion", "input", "readout"];

/** Reads a stage hash; anything it can't use is reported in `errors`, never guessed. */
export const parseStageHash = (hash: string): StageParams => {
  const params = new URLSearchParams(hash.replace(/^#/u, ""));
  const errors: string[] = [];
  for (const key of params.keys()) {
    if (!KNOWN_KEYS.includes(key)) errors.push(`Unknown setting "${key}"`);
  }
  const choice = <T extends string>(key: string, allowed: readonly T[]): T => {
    const value = params.get(key);
    const found = allowed.find((candidate) => candidate === value);
    if (value !== null && !found) errors.push(`${key}=${value} is not one of ${allowed.join(", ")}`);
    return found ?? allowed[0]!;
  };
  const size = (key: string): number | null => {
    const raw = params.get(key);
    if (raw === null) return null;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 200 && value <= 4000) return value;
    errors.push(`${key}=${raw} is not a size from 200 to 4000`);
    return null;
  };
  // A cell ID names exactly one staged setup. A hash that adds, drops or
  // changes any of its settings is refused, so the owner never approves a
  // cell from a screen staged as something else.
  const cell = params.get("cell") ?? "";
  const cellErrors = errors.length;
  if (cell) {
    const expected = cellSettings(cell);
    const actual = [...params].filter(([key]) => key !== "step").map(([key, value]) => `${key}=${value}`);
    if (!expected) {
      errors.push(`${cell} is not a walkthrough cell`);
    } else if (expected.length !== actual.length || [...expected].sort().join("&") !== [...actual].sort().join("&")) {
      errors.push(`These settings do not match cell ${cell}; stage it with #${expected.join("&")}`);
    }
  }
  const cellErrorsAfter = errors.length;
  const steps: StageStep[] = [];
  for (const label of (params.get("steps") ?? "ready").split(",").map((part) => part.trim()).filter(Boolean)) {
    const [name, dialogName, ...rest] = label.split(":");
    const scenario = GALLERY_SCENARIOS.find((candidate) => candidate === name);
    const dialog = dialogName === undefined ? null : GALLERY_DIALOGS.find((candidate) => candidate === dialogName);
    if (!scenario || dialog === undefined || rest.length > 0) {
      errors.push(`Unknown step "${label}"`);
      continue;
    }
    steps.push({ scenario, dialog, label });
  }
  if (steps.length === 0) steps.push({ scenario: "ready", dialog: null, label: "ready" });
  const raw = params.get("step");
  const index = raw === null ? 1 : Number(raw);
  const inRange = Number.isInteger(index) && index >= 1 && index <= steps.length;
  if (!inRange) errors.push(`step=${raw} is not from 1 to ${steps.length}`);
  return {
    cell,
    cellMatches: cell !== "" && cellErrorsAfter === cellErrors,
    steps,
    step: inRange ? index - 1 : 0,
    width: size("w"),
    height: size("h"),
    theme: choice("theme", ["light", "dark"] as const),
    dir: choice("dir", ["ltr", "rtl"] as const),
    lang: choice("lang", ["en", "xa"] as const),
    contrast: choice("contrast", ["normal", "forced"] as const),
    motion: choice("motion", ["normal", "reduce"] as const),
    input: choice("input", ["pointer", "touch"] as const),
    readout: choice("readout", ["none", "tree"] as const),
    errors,
  };
};

const ACCENTS: Readonly<Record<string, string>> = {
  a: "å", b: "ƀ", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "î", j: "ĵ", k: "ķ", l: "ļ", m: "ɱ",
  n: "ñ", o: "ö", p: "þ", r: "ŕ", s: "š", t: "ţ", u: "û", w: "ŵ", y: "ý", z: "ž",
  A: "Å", C: "Ç", D: "Ð", E: "É", I: "Î", L: "Ļ", N: "Ñ", O: "Ö", R: "Ŕ", S: "Š", T: "Ţ", U: "Û", Y: "Ý", Z: "Ž",
};

/**
 * One string in the pseudo-language: accented, bracketed and about 30 %
 * longer, with `{placeholders}` untouched. Plain English left on a staged
 * screen is text that never went through a translation key.
 */
export const pseudoText = (text: string): string => {
  const accented = text.split(/(\{[a-z0-9_]+\})/u)
    .map((part, index) => index % 2 ? part : [...part].map((character) => ACCENTS[character] ?? character).join(""))
    .join("");
  return `[${accented}${"·".repeat(Math.max(1, Math.round(text.length * 0.3)))}]`;
};

/** A Home Assistant style `localize` over the pseudo-language; a key it lacks comes back unchanged, as in HA. */
export const pseudoLocalize = (common: Readonly<Record<string, string>>): Localize => {
  const table = new Map(Object.entries(common).map(([key, value]) => [key, pseudoText(value)]));
  return (key, placeholders) => {
    const template = key.startsWith(PREFIX) ? table.get(key.slice(PREFIX.length)) : undefined;
    if (template === undefined) return key;
    return template.replace(/\{([a-z0-9_]+)\}/gu, (match, name: string) =>
      placeholders && name in placeholders ? String(placeholders[name]) : match);
  };
};

const loadCommon = async (): Promise<Record<string, string>> => {
  const response = await fetch(STRINGS_PATH);
  const strings = await response.json() as { common: Record<string, string> };
  return strings.common;
};

/** Mounts the staged shell in the frame document, at the hash's step. */
export async function mountStageFrame(doc: Document): Promise<void> {
  const params = parseStageHash(doc.location.hash);
  const root = doc.documentElement;
  const view = doc.defaultView ?? window;
  root.dir = params.dir;
  root.lang = params.lang === "xa" ? "en-XA" : "en";
  const theme = HA_THEMES[params.theme];
  doc.body.style.background = theme["--primary-background-color"] ?? "";
  if (params.errors.length > 0) {
    root.dataset["stageError"] = params.errors.join("; ");
    const alert = doc.createElement("p");
    alert.setAttribute("role", "alert");
    alert.style.cssText = "margin:0;padding:6px 12px;background:#fde7e9;color:#5c0011;font:13px system-ui";
    alert.textContent = params.errors.join(". ");
    doc.body.append(alert);
  }
  const current = params.steps[params.step]!;
  const gallery = doc.createElement(GALLERY_TAG) as MaticMapStudioGalleryV4;
  gallery.controls = false;
  gallery.simulateMotion = true;
  // The first paint's hint; the shell then measures itself (design-system.md §7).
  const { innerWidth: width, innerHeight: height } = view;
  gallery.narrow = height < 480 || width < 768 || (width < 1024 && width <= height);
  for (const [name, value] of Object.entries(theme)) gallery.style.setProperty(name, value);
  // As the panel does from Home Assistant's theme (design-system.md Decision 3).
  gallery.style.colorScheme = params.theme;
  if (params.lang === "xa") gallery.localize = pseudoLocalize(await loadCommon());
  gallery.scenario = current.scenario;
  doc.body.append(gallery);
  // The panel fills the viewport in Home Assistant, so the stage does too.
  const fill = new CSSStyleSheet();
  fill.replaceSync(".stage{block-size:100dvh!important;min-block-size:0!important;max-inline-size:none!important}");
  const shadow = gallery.shadowRoot;
  if (shadow) shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, fill];
  await gallery.updateComplete;
  if (current.dialog) {
    const patch: Partial<WorkspaceState> = current.dialog === "confirmResetCadence"
      ? { dialog: current.dialog, cadenceResetRequest: { planId: "daily", roomId: "room-a", mode: "mop" } }
      : { dialog: current.dialog };
    gallery.replaceWorkspaceState({ ...gallery.getWorkspaceSnapshot(), ...patch });
    await gallery.updateComplete;
  }
  root.dataset["stageReady"] = "true";
}

const describe = (params: StageParams): string => [
  params.width && params.height ? `${params.width} × ${params.height}` : "fills the window",
  params.theme === "dark" ? "dark" : "light",
  params.dir === "rtl" ? "right to left" : null,
  params.lang === "xa" ? "pseudo-language" : null,
  params.contrast === "forced" ? "forced colours" : null,
  params.motion === "reduce" ? "reduced motion" : null,
  params.input === "touch" ? "touch" : null,
  params.readout === "tree" ? "screen-reader read-out" : null,
].filter(Boolean).join(" · ");

/** The stage page: a banner naming the cell and its steps over a frame sized w × h. */
export function mountStagePage(doc: Document): void {
  const view = doc.defaultView ?? window;
  const banner = doc.createElement("header");
  banner.setAttribute("role", "note");
  banner.style.cssText = "display:grid;gap:6px;padding:8px 12px;background:#fff3cd;color:#3d2e00;font:13px/1.4 system-ui";
  doc.body.style.background = "#e8edef";
  doc.body.append(banner);
  let frame: HTMLIFrameElement | null = null;

  const line = (text: string, role?: string): HTMLElement => {
    const element = doc.createElement("p");
    element.style.margin = "0";
    if (role) element.setAttribute("role", role);
    element.textContent = text;
    return element;
  };

  const goTo = (step: number): void => {
    const parts = view.location.hash.replace(/^#/u, "").split("&").filter((part) => part && !part.startsWith("step="));
    view.location.hash = [...parts, `step=${step + 1}`].join("&");
  };

  const render = (): void => {
    const params = parseStageHash(view.location.hash);
    const title = doc.createElement("strong");
    title.textContent = !params.cell ? "Ad hoc stage" : params.cellMatches ? `Cell ${params.cell}` : `Not cell ${params.cell}`;
    const heading = line(" · Synthetic test harness, not live Home Assistant. No robot is connected.");
    heading.prepend(title);
    const children: HTMLElement[] = [heading, line(describe(params))];
    if (params.contrast === "forced" && !view.matchMedia("(forced-colors: active)").matches) {
      children.push(line("Forced colours are off in this browser. Stage this cell with npm run stage:walkthrough, which opens Chromium with forced colours."));
    }
    if (params.motion === "reduce" && !view.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      children.push(line("Reduced motion is off in this browser. Turn on Reduce motion in the system's accessibility settings, or stage with npm run stage:walkthrough."));
    }
    if (params.errors.length > 0) children.push(line(params.errors.join(". "), "alert"));
    const steps = doc.createElement("div");
    steps.setAttribute("role", "group");
    steps.setAttribute("aria-label", "Steps");
    steps.style.cssText = "display:flex;flex-wrap:wrap;gap:4px";
    params.steps.forEach((step, index) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = `${index + 1}. ${step.label}`;
      button.setAttribute("aria-pressed", String(index === params.step));
      button.style.cssText = `min-block-size:28px;font:12px system-ui;${index === params.step ? "font-weight:700" : ""}`;
      button.addEventListener("click", () => goTo(index));
      steps.append(button);
    });
    children.push(steps);
    banner.replaceChildren(...children);

    // A new frame per render: a fresh mount at its final size, as the audit does.
    frame?.remove();
    frame = doc.createElement("iframe");
    frame.title = "Staged Matic Map";
    frame.src = `${FRAME_PATH}${view.location.hash}`;
    const height = params.height ? `${params.height}px` : `${Math.max(320, view.innerHeight - banner.offsetHeight)}px`;
    frame.style.cssText = `display:block;border:0;inline-size:${params.width ? `${params.width}px` : "100%"};block-size:${height};margin:${params.width ? "12px" : "0"}`;
    doc.body.append(frame);
  };

  view.addEventListener("hashchange", render);
  render();
}
