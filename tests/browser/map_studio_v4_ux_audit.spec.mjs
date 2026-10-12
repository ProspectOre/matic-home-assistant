import AxeBuilder from "@axe-core/playwright";
import { test } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { STAMP_FILE, hashSources } from "../../scripts/source_stamp.mjs";

// Evidence harness, not a gate: `npm run audit:ux` captures every Map Studio v4
// gallery scenario and state at the contract widths, runs axe on each, and writes
// `manifest.json` + `summary.md` for the UX audit agents to cite. Excluded from
// default runs and CI by the `@audit` tag (see playwright.config.mjs).
// Everything is synthetic gallery data served by tests/browser/server.mjs.
// `UX_AUDIT_OUT_DIR` redirects the output root; it must stay under the git-ignored
// `tests/browser/.generated/` because every scenario deletes its own output directory.

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GENERATED_ROOT = resolve(REPOSITORY_ROOT, "tests/browser/.generated");
const OUTPUT_ROOT = resolve(
  REPOSITORY_ROOT,
  process.env.UX_AUDIT_OUT_DIR || "tests/browser/.generated/ux-audit",
);
const OUTPUT_GENERATED_PATH = relative(GENERATED_ROOT, OUTPUT_ROOT);
if (
  !OUTPUT_GENERATED_PATH ||
  OUTPUT_GENERATED_PATH.startsWith("..") ||
  OUTPUT_GENERATED_PATH.includes(`..${sep}`)
) {
  throw new Error(
    `UX_AUDIT_OUT_DIR must name a directory under tests/browser/.generated/ (got ${OUTPUT_ROOT})`,
  );
}
const OUTPUT_REPOSITORY_PATH = relative(REPOSITORY_ROOT, OUTPUT_ROOT).split(sep).join("/");
const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";
const AUDIT_PAGE = "/map-studio-v4-audit";
// The shell's own narrow rule (shell.ts ResizeObserver): width < 1024 || height < 480.
const NARROW_BELOW_WIDTH = 1024;
const NARROW_BELOW_HEIGHT = 480;
// Chromium cannot reliably encode screenshots much taller than this.
const MAX_FULL_PAGE_HEIGHT = 9000;
const SAMPLE_NOTICE = "Sample notice text";
const RTL_NOTE = "English copy under dir=rtl: bidi punctuation artifacts are not RTL-locale defects.";

const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};
// Stamps every record so a manifest says which code produced it: the commit,
// whether tracked files differ from it, and `sourceHash`, a digest of the exact
// sources the review bundle was compiled from plus this harness file. Two runs
// on the same dirty head with different edits therefore carry different stamps.
// The stamp is resolved lazily by `assertFreshBundle` so that non-audit runs,
// which only load this file, never need the review bundle.
const REVIEW_ROOT = resolve(GENERATED_ROOT, "map-studio-v4-review");
let SOURCE_STAMP = null;
async function loadSourceStamp() {
  if (SOURCE_STAMP) return SOURCE_STAMP;
  const stale = new Error(
    "The Map Studio review bundle is missing or its sources changed since it was built. Run `npm run build:map-studio-v4` (or `npm run audit:ux`, which builds first).",
  );
  let bundleStamp;
  try {
    bundleStamp = JSON.parse(await readFile(join(REVIEW_ROOT, STAMP_FILE), "utf8"));
  } catch {
    throw stale;
  }
  if (!Array.isArray(bundleStamp?.inputs) || typeof bundleStamp.sourceHash !== "string") throw stale;
  let current;
  try {
    current = await hashSources(REPOSITORY_ROOT, bundleStamp.inputs);
  } catch {
    throw stale;
  }
  if (current !== bundleStamp.sourceHash) throw stale;
  const harness = await readFile(fileURLToPath(import.meta.url));
  SOURCE_STAMP = {
    gitHead: git("rev-parse", "HEAD"),
    gitDirty: Boolean(git("status", "--porcelain", "--untracked-files=no")),
    sourceHash: createHash("sha256").update(bundleStamp.sourceHash).update("\0").update(harness).digest("hex"),
  };
  return SOURCE_STAMP;
}

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
  narrow: width < NARROW_BELOW_WIDTH || height < NARROW_BELOW_HEIGHT,
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
};
const NOTICE_BASES = [
  ["rooms", "rooms"],
  ["plan", "plan-saved-intelligent"],
  ["none", "ready"],
  ["plans", "plans"],
  ["draw", "draw"],
  ["history", "history"],
  ["support", "support"],
  ["area-review", "area-review-new"],
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
    scenario: DIALOG_BASES[kind],
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
    patch: { notice: { tone, key: "v4_notice_audit_sample", fallback: SAMPLE_NOTICE } },
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

// The bundle must have been compiled from the current sources (source stamp)
// and must expose the same lists as the TypeScript this harness imported.
async function assertFreshBundle(page) {
  await loadSourceStamp();
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
// The gallery stage is sized before the first render: the map fits its first
// layout, and a stage resized afterwards refits differently depending on which
// state changes follow (a wide map sat at x=66 in `ready` but x=2 after a
// scenario switch). Every capture therefore gets one first fit at final size.
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
    // Replace the page's own gallery (rendered at the default stage size) with
    // one whose stage override is adopted right after Lit creates the render
    // root and before its first update renders the stage.
    document.querySelector(tag).remove();
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.narrow = narrow;
    gallery.scenario = scenario;
    document.body.append(gallery);
    const stage = new CSSStyleSheet();
    stage.replaceSync(".stage{block-size:100dvh!important;min-block-size:0!important;max-inline-size:none!important}");
    gallery.shadowRoot.adoptedStyleSheets = [...gallery.shadowRoot.adoptedStyleSheets, stage];
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
      const loading = [root, workflow?.shadowRoot]
        .some((scope) => (scope?.querySelector(".loading")?.textContent ?? "").includes("Loading workspace tools"));
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

// Framing evidence: the leftmost viewport pixel the map canvases paint. It is the
// first column that differs between the shot and the same frame with the scene
// and overlay canvases hidden, so it is independent of theme and map colors.
// Auditors can compare it across scenarios at one size; a wide framing drift
// would show as a different value.
async function measureMapLeft(page, withMap) {
  const setHidden = (hidden) => page.evaluate(({ tag, hidden }) => {
    const shell = document.querySelector(tag).shadowRoot.querySelector(".stage").firstElementChild;
    const canvas = [...shell.shadowRoot.querySelectorAll("*")]
      .find((element) => element.localName.startsWith("matic-map-canvas-v4"));
    const scene = canvas?.shadowRoot?.querySelector(".scene-window");
    if (!scene) return null;
    for (const surface of scene.querySelectorAll("canvas")) surface.style.visibility = hidden ? "hidden" : "";
    const { left, top, width, height } = scene.getBoundingClientRect();
    return { left, top, width, height };
  }, { tag: GALLERY_TAG, hidden });
  const rect = await setHidden(true);
  if (!rect) return null;
  let without;
  try {
    await pause(80);
    without = await page.screenshot({ animations: "disabled", caret: "hide" });
  } finally {
    await setHidden(false);
  }
  return page.evaluate(async ({ before, after, rect }) => {
    const decode = async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [a, b] = [await decode(before), await decode(after)];
    const bottom = Math.min(a.height, Math.ceil(rect.top + rect.height));
    for (let x = Math.max(0, Math.floor(rect.left)); x < Math.min(a.width, Math.ceil(rect.left + rect.width)); x += 1) {
      for (let y = Math.max(0, Math.floor(rect.top)); y < bottom; y += 1) {
        const index = (y * a.width + x) * 4;
        const difference = Math.abs(a.data[index] - b.data[index])
          + Math.abs(a.data[index + 1] - b.data[index + 1])
          + Math.abs(a.data[index + 2] - b.data[index + 2]);
        if (difference > 24) return x;
      }
    }
    return null;
  }, { before: withMap.toString("base64"), after: without.toString("base64"), rect });
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

// Stamps a finished record with its time and source, and the RTL caveat.
const finalize = (record, size) => ({
  ...record,
  generatedAt: new Date().toISOString(),
  ...SOURCE_STAMP,
  ...(size.dir === "rtl" ? { note: [record.note, RTL_NOTE].filter(Boolean).join(" ") } : {}),
});

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
        return [finalize({ ...base, path: null, axeSerious: null, axeCritical: null, axeIds: [], skipped }, size)];
      }
    }
    const shot = await stableScreenshot(page);
    await writeCapture(directory, size.name, shot.png);
    const record = {
      ...base,
      path: toRepositoryPath(item.id, `${size.name}.png`),
      mapLeftPx: null,
      axeSerious: null,
      axeCritical: null,
      axeIds: [],
      ...(shot.stable ? {} : { note: "Screenshot did not reach two identical frames." }),
    };
    records.push(record);
    // Wide layouts only: on narrow ones the sheet covers the map's left edge.
    if (!size.narrow) {
      try {
        record.mapLeftPx = await measureMapLeft(page, shot.png);
      } catch {
        record.mapLeftPx = null;
      }
    }
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
  return records.map((record) => finalize(record, size));
}

// A second, fullPage capture when content is out of view: the document itself
// scrolls (for example landscape phones) or the full-height sheet body scrolls.
// The sheet scrolls inside a fixed box, so the viewport is grown until its
// whole body fits and the fullPage shot then shows every row. `height` stays
// the variant's viewport height; `grownViewportHeight` is the size captured.
async function captureFullPage(page, base, item, size, directory) {
  try {
    let scroll = await measureScroll(page);
    const sheetScrolls = size.narrow && scroll.detent === "full" && scroll.sheetOverflow > 1;
    if (scroll.documentOverflow <= 1 && !sheetScrolls) return [];
    let grownHeight = size.height;
    let capped = false;
    for (let pass = 0; sheetScrolls && pass < 4 && scroll.sheetOverflow > 1; pass += 1) {
      const next = Math.min(MAX_FULL_PAGE_HEIGHT, grownHeight + scroll.sheetOverflow + 4);
      capped = next === MAX_FULL_PAGE_HEIGHT;
      if (next === grownHeight) break;
      grownHeight = next;
      await page.setViewportSize({ width: size.width, height: grownHeight });
      await settle(page);
      scroll = await measureScroll(page);
    }
    const shot = await stableScreenshot(page, true);
    const name = `${size.name}-full`;
    await writeCapture(directory, name, shot.png);
    return [{
      ...base,
      variant: name,
      grownViewportHeight: grownHeight,
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

// Serializes index writers across workers with an atomic mkdir lock, so the
// last test to take it reads every finished scenario and writes the final files.
async function withIndexLock(action) {
  const lock = join(OUTPUT_ROOT, ".index.lock");
  for (let attempt = 0; ; attempt += 1) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST" || attempt >= 600) throw error;
      // A lock left behind by a killed run would block every later run.
      const held = await stat(lock).catch(() => null);
      if (held && Date.now() - held.mtimeMs > 30_000) await rm(lock, { recursive: true, force: true });
      await pause(100);
    }
  }
  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

// A record belongs to this run only when its source stamp equals the stamp of
// the code running now. Records left in OUTPUT_ROOT by an earlier run on another
// commit (or on a differently dirty tree) are stale and never enter the index.
const isCurrentRecord = (record) =>
  record?.gitHead === SOURCE_STAMP.gitHead && record?.sourceHash === SOURCE_STAMP.sourceHash;

// Rebuilds manifest.json and summary.md from every finished scenario. Each
// test calls this when it ends, under the lock; the rename keeps readers from
// ever seeing a half-written file.
async function writeIndex() {
  await withIndexLock(async () => {
    const present = new Set(await readdir(OUTPUT_ROOT).catch(() => []));
    const manifest = [];
    // A scenario with no output directory, or one without records.json, never
    // finished: it was not started, timed out, was dropped, or was still running
    // when this index was built. Every one is listed, so a partial run can never
    // read as complete.
    const unfinished = [];
    // A scenario whose records carry another source stamp came from an earlier
    // run that this one has not (yet) replaced; it is reported, never indexed.
    const stale = [];
    for (const item of ITEMS) {
      if (!present.has(item.id)) {
        unfinished.push(item.id);
        continue;
      }
      let records;
      try {
        records = JSON.parse(await readFile(join(OUTPUT_ROOT, item.id, "records.json"), "utf8"));
      } catch {
        unfinished.push(item.id);
        continue;
      }
      if (!Array.isArray(records) || !records.every(isCurrentRecord)) {
        stale.push(item.id);
        continue;
      }
      manifest.push(...records);
    }
    const replace = async (name, contents) => {
      const temporary = join(OUTPUT_ROOT, `.${name}.${process.pid}.tmp`);
      await writeFile(temporary, contents);
      await rename(temporary, join(OUTPUT_ROOT, name));
    };
    await replace("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
    await replace("summary.md", summarize(manifest, unfinished, stale));
  });
}

function summarize(manifest, unfinished = [], stale = []) {
  const captured = manifest.filter((entry) => entry.path);
  const failedCaptures = manifest.filter((entry) => entry.error);
  const errorScenarios = [...new Set([...failedCaptures.map((entry) => entry.scenario), ...unfinished])];
  const errorCount = failedCaptures.length + unfinished.length;
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
    "RTL captures render English copy under dir=rtl: bidi punctuation artifacts are not RTL-locale defects.",
    `Generated ${new Date().toISOString()} from commit ${SOURCE_STAMP.gitHead ?? "unknown"}${SOURCE_STAMP.gitDirty ? " (tracked changes present)" : ""}.`,
    "",
    `- Captures (PNG files): ${captured.length} (${captured.filter((entry) => entry.kind === "full-page").length} are full-page companions)`,
    `- Errors: ${errorCount}${errorScenarios.length ? ` (scenarios: ${errorScenarios.join(", ")})` : ""}`,
    `- Unfinished or not started (counted in Errors): ${unfinished.length}${unfinished.length ? ` (scenarios: ${unfinished.join(", ")})` : ""}`,
    `- Stale (recorded from other sources, excluded from this index): ${stale.length}${stale.length ? ` (scenarios: ${stale.join(", ")})` : ""}`,
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
  // Without `--project chromium`, a webkit worker would rewrite the same
  // output directories. The skip is evaluated per project at run time.
  test.skip(({ browserName }) => browserName !== "chromium", "audit captures are Chromium-only");
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
