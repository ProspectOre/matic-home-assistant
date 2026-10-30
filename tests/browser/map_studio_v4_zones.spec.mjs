import { expect, test } from "@playwright/test";
import { build } from "esbuild";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// Robot zones arrive with the areas catalog. No-go zones are drawn read-only
// and a saved area that reaches into one says so in Your areas.

const NO_GO = [[0.8, 0.8], [1.6, 0.8], [1.6, 1.6], [0.8, 1.6]];
const area = (id, name, x) => ({
  id,
  name,
  circles: [{ x, y: 1, radius: 0.2 }],
  outline: null,
  cleaning_mode: "vacuum",
  coverage_setting: "standard",
  status: "current",
  can_rebind: false,
});
const AREAS_CATALOG = {
  scene_url: "/api/matic_robot/slam_scene/synthetic",
  rooms: [],
  areas: [area("rug", "Rug", 1), area("desk", "Desk", 4)],
  selected_area: null,
  zones: [
    { kind: "no_go", outline: NO_GO, holes: [], room_ids: [], area_ids: ["rug"] },
    { kind: "unknown", outline: NO_GO, holes: [], room_ids: [], area_ids: ["desk"] },
  ],
};

const rowTexts = (panel) => panel.evaluate((element) => {
  const rows = [];
  const scan = (root) => {
    rows.push(...[...root.querySelectorAll("[data-area-row]")]
      .map((row) => ({ id: row.dataset.areaRow, overlap: row.querySelector("[data-zone-overlap]")?.textContent ?? null })));
    for (const child of root.querySelectorAll("*")) if (child.shadowRoot) scan(child.shadowRoot);
  };
  scan(element.shadowRoot);
  return rows;
});

test("Your areas notes a saved area that reaches into a no-go zone", async ({ page }) => {
  const { panelTag } = await installPanelFixture(page, { initialAreasCatalog: AREAS_CATALOG });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    panel.dataset.testPanel = "true";
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(`${panelTag}[data-test-panel=true]`);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  await panel.evaluate((element) => {
    const find = (root) => {
      for (const button of root.querySelectorAll("button")) {
        if (button.innerText.replace(/\s+/gu, " ").trim().startsWith("Clean custom area")) return button;
      }
      for (const child of root.querySelectorAll("*")) {
        const match = child.shadowRoot && find(child.shadowRoot);
        if (match) return match;
      }
      return null;
    };
    find(element.shadowRoot).click();
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areas");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.areas.value?.zones.length)).toBe(2);
  // Only the no-go zone counts; a robot-made zone of unknown kind does not.
  await expect.poll(() => rowTexts(panel)).toEqual([
    { id: "rug", overlap: "Overlaps a no-go zone · Matic skips that part" },
    { id: "desk", overlap: null },
  ]);
});

test("renderer shades no-go zones and only outlines robot-made zones", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/zones-renderer.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async (outline) => {
    const { RendererController, createGalleryState } = await import("/zones-renderer.js");
    const scene = document.createElement("canvas"), overlay = document.createElement("canvas");
    for (const canvas of [scene, overlay]) {
      Object.assign(canvas.style, { position: "absolute", width: "720px", height: "540px" });
      document.body.append(canvas);
    }
    const context = overlay.getContext("2d");
    const fills = [], dashes = [];
    const { fill, setLineDash } = context;
    context.fill = function(rule, ...rest) { if (typeof rule === "string") fills.push(rule); return fill.call(this, rule, ...rest); };
    context.setLineDash = function(segments) { dashes.push(segments.length); return setLineDash.call(this, segments); };
    const renderer = new RendererController(scene, overlay);
    const initial = createGalleryState("ready");
    const zone = (kind) => ({ kind, outline, holes: [[[1, 1], [1.2, 1], [1.2, 1.2]]], roomIds: [], areaIds: [] });
    renderer.setState({ ...initial, resources: { ...initial.resources, areas: { status: "ready", problem: null,
      value: { ...initial.resources.areas.value, zones: [zone("no_go"), zone("unknown")] } } } });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    renderer.dispose();
    return { fills, dashes };
  }, NO_GO);
  // One even-odd fill (the no-go zone with its hole); the unknown zone is a
  // dashed outline only.
  expect(result.fills).toEqual(["evenodd"]);
  expect(result.dashes).toEqual([0, 0, 2, 0]);
});
