import AxeBuilder from "@axe-core/playwright";
import { test } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Evidence harness, not a gate: `npm run audit:ux` captures every Map Studio v4
// gallery scenario and state at the contract widths, runs axe on each, and writes
// `manifest.json` + `summary.md` for the UX audit agents to cite. Excluded from
// default runs and CI by the `@audit` tag (see playwright.config.mjs).
// Everything is synthetic gallery data served by tests/browser/server.mjs.

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUTPUT_ROOT = fileURLToPath(new URL("./.generated/ux-audit/", import.meta.url));
const OUTPUT_REPOSITORY_PATH = "tests/browser/.generated/ux-audit";
const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";
const AUDIT_PAGE = "/map-studio-v4-audit";
// The shell's own narrow rule is `width < 1024` (shell.ts ResizeObserver).
const NARROW_BELOW = 1024;
// Chromium cannot reliably encode screenshots much taller than this.
const MAX_FULL_PAGE_HEIGHT = 9000;
const SAMPLE_NOTICE = "Sample notice text";

// The scenario, dialog, and tone lists come from the TypeScript source so the
// harness cannot drift from them. The browser runs the review bundle, so each
// test also verifies that bundle exposes the same lists (see `assertFreshBundle`).
const sourceModule = await build({
  stdin: {
    contents: 'export { GALLERY_SCENARIOS, GALLERY_DIALOGS, GALLERY_NOTICE_TONES } from "./frontend/map-studio-v4/gallery-state";',
    resolveDir: REPOSITORY_ROOT,
  },
  bundle: true,
  format: "esm",
  write: false,
});
const { GALLERY_SCENARIOS, GALLERY_DIALOGS, GALLERY_NOTICE_TONES } = await import(
  `data:text/javascript;base64,${Buffer.from(sourceModule.outputFiles[0].text).toString("base64")}`
);

const variant = (width, height, theme = "light", dir = "ltr", forced = false) => ({
  width,
  height,
  theme,
  dir,
  forced,
  narrow: width < NARROW_BELOW,
  name: `${width}x${height}-${theme}-${dir}${forced ? "-forced" : ""}`,
});

const LIGHT_VIEWPORTS = [
  [320, 844],
  [360, 844],
  [390, 844],
  [844, 390],
  [600, 1024],
  [768, 1024],
  [1024, 768],
  [1024, 900],
  [1440, 900],
];
const THEMED_VIEWPORTS = [[390, 844], [1024, 900]];

// Every scenario: nine light/LTR sizes, then dark, RTL, and forced-colors +
// reduced-motion at one phone and one desktop size.
const SCENARIO_VARIANTS = [
  ...LIGHT_VIEWPORTS.map(([width, height]) => variant(width, height)),
  ...THEMED_VIEWPORTS.flatMap(([width, height]) => [
    variant(width, height, "dark"),
    variant(width, height, "light", "rtl"),
    variant(width, height, "light", "ltr", true),
  ]),
];

// Dialogs, notices, and the help surface repeat the same base state, so they
// use a smaller set that still spans phone, landscape, tablet-wide, and desktop.
const EXTRA_VARIANTS = [
  variant(320, 844),
  variant(390, 844),
  variant(844, 390),
  variant(1024, 900),
  variant(1440, 900),
  variant(390, 844, "dark"),
  variant(1024, 900, "dark"),
  variant(390, 844, "light", "rtl"),
  variant(390, 844, "light", "ltr", true),
];

// A dialog is captured over the state a user would open it from.
const DIALOG_BASES = {
  discardDraft: "plan-dirty",
  confirmDeletePlan: "plan-saved-intelligent",
  confirmDeleteArea: "area-review-rebind",
  confirmResetCadence: "plan-cadence-shared",
  confirmStop: "cleaning",
  error: "ready",
};
const NOTICE_BASES = [
  ["rooms", "rooms"],
  ["plan", "plan-saved-intelligent"],
  ["none", "ready"],
];
const HELP_BASES = ["ready", "plan-saved-intelligent"];
// Scenarios whose collapsed "Room schedule" sections are the point of the state.
const OPEN_SCHEDULE_SCENARIOS = new Set(["plan-cadence-shared", "plan-cadence-blocked"]);

const ITEMS = [
  ...GALLERY_SCENARIOS.map((scenario) => ({
    id: scenario,
    scenario,
    variants: SCENARIO_VARIANTS,
    openSchedule: OPEN_SCHEDULE_SCENARIOS.has(scenario),
  })),
  ...GALLERY_DIALOGS.map((kind) => ({
    id: `dialog-${kind}`,
    scenario: DIALOG_BASES[kind] ?? "ready",
    variants: EXTRA_VARIANTS,
    patch: {
      dialog: kind,
      ...(kind === "confirmResetCadence"
        ? { cadenceResetRequest: { planId: "daily", roomId: "room-a", mode: "mop" } }
        : {}),
    },
  })),
  ...NOTICE_BASES.flatMap(([label, scenario]) => GALLERY_NOTICE_TONES.map((tone) => ({
    id: `notice-${label}-${tone}`,
    scenario,
    variants: EXTRA_VARIANTS,
    patch: { notice: { tone, text: SAMPLE_NOTICE } },
  }))),
  ...HELP_BASES.map((scenario) => ({
    id: `help-${scenario}`,
    scenario,
    variants: EXTRA_VARIANTS,
    help: true,
  })),
];

const toRepositoryPath = (...segments) => [OUTPUT_REPOSITORY_PATH, ...segments].join("/");

const errorText = (error) => String(error?.message ?? error).split("\n")[0].slice(0, 400);

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function assertFreshBundle(page) {
  const bundled = await page.evaluate(async () => {
    const module = await import("/map_studio_v4-review/review.js");
    return {
      scenarios: module.GALLERY_SCENARIOS,
      dialogs: module.GALLERY_DIALOGS,
      tones: module.GALLERY_NOTICE_TONES,
    };
  });
  const same = JSON.stringify(bundled) === JSON.stringify({
    scenarios: GALLERY_SCENARIOS,
    dialogs: GALLERY_DIALOGS,
    tones: GALLERY_NOTICE_TONES,
  });
  if (!same) {
    throw new Error("The Map Studio review bundle is stale. Run `npm run build:map-studio-v4` before `npm run audit:ux`.");
  }
}

// Loads a fresh gallery so every capture starts from the same detent, focus,
// and scroll state, then puts it into the requested scenario and variant.
async function openScenario(page, item, size) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.emulateMedia({
    colorScheme: size.theme,
    forcedColors: size.forced ? "active" : "none",
    reducedMotion: size.forced ? "reduce" : "no-preference",
  });
  await page.goto(AUDIT_PAGE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (tag) => Boolean(document.querySelector(tag)?.shadowRoot?.querySelector(".stage")),
    GALLERY_TAG,
  );
  // The panel fills the viewport in Home Assistant; hide the harness banner and
  // let the gallery stage do the same so each size shows the real layout.
  await page.addStyleTag({ content: "body > aside[role='note'] { display: none !important; }" });
  await page.evaluate(async ({ tag, scenario, narrow, dir, patch }) => {
    document.documentElement.dir = dir;
    const gallery = document.querySelector(tag);
    gallery.shadowRoot.querySelector(".stage").style.cssText =
      "block-size:100dvh;min-block-size:0;max-inline-size:none;";
    gallery.narrow = narrow;
    gallery.scenario = scenario;
    await gallery.updateComplete;
    if (patch) {
      gallery.replaceWorkspaceState({ ...gallery.getWorkspaceSnapshot(), ...patch });
      await gallery.updateComplete;
    }
  }, {
    tag: GALLERY_TAG,
    scenario: item.scenario,
    narrow: size.narrow,
    dir: size.dir,
    patch: item.patch ?? null,
  });
  await settle(page);
}

// Waits for lazy workflow chunks, Lit updates, and transitions to finish.
async function settle(page) {
  await page.evaluate(async (tag) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const gallery = document.querySelector(tag);
    const shell = gallery.shadowRoot.querySelector(".stage").firstElementChild;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      await gallery.updateComplete;
      await shell.updateComplete;
      const root = shell.shadowRoot;
      const workflow = [...root.querySelectorAll("*")]
        .find((element) => element.localName.startsWith("matic-map-workflow-v4"));
      if (workflow) await workflow.updateComplete;
      const loading = Boolean(root.querySelector(".workflow-loading"))
        || (workflow?.shadowRoot?.querySelector(".loading")?.textContent ?? "").includes("Loading workspace tools");
      if (!loading) break;
      await wait(50);
    }
    await frame();
    await frame();
    const transitions = document.getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.race([
      Promise.all(transitions.map((animation) => animation.finished.catch(() => undefined))),
      wait(2000),
    ]);
    await frame();
  }, GALLERY_TAG);
}

// The map paints through WebGL after the DOM settles, so keep sampling until
// two consecutive frames are byte-identical, and keep that frame as the capture.
async function stableScreenshot(page, fullPage = false) {
  let previous = null;
  let latest = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    latest = await page.screenshot({ fullPage, animations: "disabled", caret: "hide" });
    if (previous?.equals(latest)) return { png: latest, stable: true };
    previous = latest;
    await pause(120);
  }
  return { png: latest, stable: false };
}

async function runAxe(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.map(({ id, impact, help, helpUrl, nodes }) => ({
    id,
    impact,
    help,
    helpUrl,
    nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  }));
}

const isSerious = (impact) => impact === "serious" || impact === "critical";

async function measureScroll(page) {
  return page.evaluate((tag) => {
    const shell = document.querySelector(tag).shadowRoot.querySelector(".stage").firstElementChild;
    const sheet = shell.shadowRoot.querySelector(".mobile-sheet");
    const body = shell.shadowRoot.querySelector(".sheet-body");
    return {
      documentOverflow: document.scrollingElement.scrollHeight - window.innerHeight,
      detent: sheet?.dataset.detent ?? null,
      sheetOverflow: body ? body.scrollHeight - body.clientHeight : 0,
    };
  }, GALLERY_TAG);
}

// Expands the first room's schedule (the room these states configure) and keeps
// the panel scrolled to the top so the capture starts at the plan heading.
async function openFirstSchedule(page) {
  await page.locator("details.cadence-config").first().evaluate((details) => { details.open = true; });
  await settle(page);
  await page.evaluate((tag) => {
    const shell = document.querySelector(tag).shadowRoot.querySelector(".stage").firstElementChild;
    for (const scroller of shell.shadowRoot.querySelectorAll(".sheet-body, .workflow-body, .inspector")) {
      scroller.scrollTop = 0;
    }
  }, GALLERY_TAG);
}

// Returns a reason string when the launcher is not reachable in this state.
async function openHelp(page) {
  const launcher = page.getByRole("button", { name: "How to move the map", exact: true });
  if (await launcher.count() === 0) return "The How to move the map launcher is not rendered in this state.";
  const target = launcher.first();
  if (!(await target.isVisible())) return "The How to move the map launcher is not visible in this state.";
  await target.click({ timeout: 5000 });
  await settle(page);
  if (await target.getAttribute("aria-expanded") !== "true") {
    throw new Error("The help surface did not report itself as open after the launcher click.");
  }
  return null;
}

async function writeCapture(directory, name, png) {
  await writeFile(join(directory, `${name}.png`), png);
}

async function captureVariant(page, item, size, directory) {
  const base = {
    scenario: item.id,
    variant: size.name,
    width: size.width,
    height: size.height,
    theme: size.theme,
    dir: size.dir,
    forced: size.forced,
    kind: "viewport",
  };
  const records = [];
  try {
    await openScenario(page, item, size);
    if (item.openSchedule) await openFirstSchedule(page);
    if (item.help) {
      const skipped = await openHelp(page);
      if (skipped) {
        return [{ ...base, path: null, axeSerious: null, axeCritical: null, axeIds: [], skipped }];
      }
    }
    const shot = await stableScreenshot(page);
    await writeCapture(directory, size.name, shot.png);
    const record = {
      ...base,
      path: toRepositoryPath(item.id, `${size.name}.png`),
      axeSerious: null,
      axeCritical: null,
      axeIds: [],
      ...(shot.stable ? {} : { note: "Screenshot did not reach two identical frames." }),
    };
    records.push(record);
    // Axe runs in light and dark only; forced-colors replaces the palette.
    if (!size.forced) {
      const violations = await runAxe(page);
      const serious = violations.filter(({ impact }) => isSerious(impact));
      record.axeSerious = serious.filter(({ impact }) => impact === "serious").length;
      record.axeCritical = serious.filter(({ impact }) => impact === "critical").length;
      record.axeIds = serious.map(({ id }) => id);
      record.axeOtherIds = violations.filter(({ impact }) => !isSerious(impact)).map(({ id }) => id);
      record.axePath = toRepositoryPath(item.id, `${size.name}-axe.json`);
      await writeFile(
        join(directory, `${size.name}-axe.json`),
        `${JSON.stringify({ scenario: item.id, variant: size.name, violations }, null, 2)}\n`,
      );
    }
    records.push(...await captureFullPage(page, base, item, size, directory));
  } catch (error) {
    records.push({
      ...base,
      path: null,
      axeSerious: null,
      axeCritical: null,
      axeIds: [],
      error: errorText(error),
    });
  }
  return records;
}

// A second, fullPage capture when content is out of view: the document itself
// scrolls (for example landscape phones) or the full-height sheet body scrolls.
// The sheet scrolls inside a fixed box, so the viewport is grown until its
// whole body fits and the fullPage shot then shows every row.
async function captureFullPage(page, base, item, size, directory) {
  try {
    let scroll = await measureScroll(page);
    const sheetScrolls = size.narrow && scroll.detent === "full" && scroll.sheetOverflow > 1;
    if (scroll.documentOverflow <= 1 && !sheetScrolls) return [];
    let height = size.height;
    let capped = false;
    for (let pass = 0; sheetScrolls && pass < 4 && scroll.sheetOverflow > 1; pass += 1) {
      const next = Math.min(MAX_FULL_PAGE_HEIGHT, height + scroll.sheetOverflow + 4);
      capped = next === MAX_FULL_PAGE_HEIGHT;
      if (next === height) break;
      height = next;
      await page.setViewportSize({ width: size.width, height });
      await settle(page);
      scroll = await measureScroll(page);
    }
    const shot = await stableScreenshot(page, true);
    const name = `${size.name}-full`;
    await writeCapture(directory, name, shot.png);
    return [{
      ...base,
      variant: name,
      height,
      kind: "full-page",
      path: toRepositoryPath(item.id, `${name}.png`),
      axeSerious: null,
      axeCritical: null,
      axeIds: [],
      ...(capped && scroll.sheetOverflow > 1 ? { note: `Capped at ${MAX_FULL_PAGE_HEIGHT}px; ${scroll.sheetOverflow}px of the sheet still scrolls.` } : {}),
    }];
  } catch (error) {
    return [{
      ...base,
      variant: `${size.name}-full`,
      kind: "full-page",
      path: null,
      axeSerious: null,
      axeCritical: null,
      axeIds: [],
      error: errorText(error),
    }];
  }
}

// Rebuilds manifest.json and summary.md from every finished scenario. Each
// test calls this when it ends, so the last one to finish writes the final
// files; the rename keeps concurrent writers from leaving a half-written file.
async function writeIndex() {
  const present = new Set(await readdir(OUTPUT_ROOT).catch(() => []));
  const manifest = [];
  for (const item of ITEMS) {
    if (!present.has(item.id)) continue;
    try {
      manifest.push(...JSON.parse(await readFile(join(OUTPUT_ROOT, item.id, "records.json"), "utf8")));
    } catch {
      // A scenario still running has no records yet.
    }
  }
  const replace = async (name, contents) => {
    const temporary = join(OUTPUT_ROOT, `.${name}.${process.pid}.tmp`);
    await writeFile(temporary, contents);
    await rename(temporary, join(OUTPUT_ROOT, name));
  };
  await replace("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await replace("summary.md", summarize(manifest));
}

function summarize(manifest) {
  const captured = manifest.filter((entry) => entry.path);
  const sum = (entries, field) => entries.reduce((total, entry) => total + (entry[field] ?? 0), 0);
  const rows = ITEMS.map(({ id }) => {
    const entries = manifest.filter((entry) => entry.scenario === id);
    if (!entries.length) return null;
    return `| ${id} | ${entries.filter((entry) => entry.path && entry.kind === "viewport").length} | ${entries.filter((entry) => entry.path && entry.kind === "full-page").length} | ${entries.filter((entry) => entry.error).length} | ${entries.filter((entry) => entry.skipped).length} | ${sum(entries, "axeSerious")} | ${sum(entries, "axeCritical")} |`;
  }).filter(Boolean);
  const idCounts = new Map();
  for (const entry of manifest) {
    for (const id of entry.axeIds ?? []) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  const ids = [...idCounts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id, count]) => `| ${id} | ${count} |`);
  return [
    "# Map Studio UX audit capture summary",
    "",
    "Synthetic gallery fixtures only; not live Home Assistant. Screenshots are",
    "a desktop Chromium profile resized to each width (no touch emulation).",
    "Paths are relative to the repository root; see `manifest.json` for every capture.",
    "",
    `- Captures (PNG files): ${captured.length} (${captured.filter((entry) => entry.kind === "full-page").length} are full-page companions)`,
    `- Errors: ${manifest.filter((entry) => entry.error).length}`,
    `- Skipped: ${manifest.filter((entry) => entry.skipped).length}`,
    `- Axe serious (rule count across captures): ${sum(manifest, "axeSerious")}`,
    `- Axe critical (rule count across captures): ${sum(manifest, "axeCritical")}`,
    "",
    "## Per scenario",
    "",
    "| scenario | viewport captures | full-page | errors | skipped | axe serious | axe critical |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Serious and critical axe rules (captures affected)",
    "",
    ids.length ? "| rule | captures |\n| --- | --- |" : "None.",
    ...ids,
    "",
  ].join("\n");
}

test.describe("@audit Map Studio UX capture", () => {
  for (const item of ITEMS) {
    test(`captures ${item.id}`, async ({ page }) => {
      test.setTimeout(600_000);
      const directory = join(OUTPUT_ROOT, item.id);
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
      await page.goto(AUDIT_PAGE, { waitUntil: "domcontentloaded" });
      await assertFreshBundle(page);
      const records = [];
      for (const size of item.variants) {
        records.push(...await captureVariant(page, item, size, directory));
      }
      await writeFile(join(directory, "records.json"), `${JSON.stringify(records, null, 2)}\n`);
      await writeIndex();
    });
  }
});
