import { expect, test } from "@playwright/test";
import { build } from "esbuild";

import { paintOverlayOnCanvas } from "./map_studio_v4_overlay_canvas.mjs";
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
  await panel.getByRole("button", { name: "Clean custom area Draw or choose a custom area", exact: true }).click();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areas");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.areas.value?.zones.length)).toBe(2);
  // Only the no-go zone counts; a robot-made zone of unknown kind does not.
  await expect.poll(() => rowTexts(panel)).toEqual([
    { id: "rug", overlap: "Overlaps a no-go zone · Matic skips that part" },
    { id: "desk", overlap: null },
  ]);
});

test("renderer shades no-go zones, only outlines robot-made zones and skips history maps", async ({ page }) => {
  await paintOverlayOnCanvas(page);
  const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
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
    const paints = [];
    const { fill, stroke, clearRect } = context;
    // Every redraw of the canvas starts by clearing it.
    context.clearRect = function(...args) { paints.length = 0; return clearRect.apply(this, args); };
    context.fill = function(rule, ...rest) { if (rule === "evenodd") paints.push(`fill ${this.fillStyle}`); return fill.call(this, rule, ...rest); };
    context.stroke = function(...args) { paints.push(`stroke ${this.strokeStyle}${this.getLineDash().length ? " dashed" : ""}`); return stroke.apply(this, args); };
    let layers = "idle";
    const renderer = new RendererController(scene, overlay, {
      onModuleStatus: (module, status) => { if (module === "renderer-layers") layers = status; },
    });
    renderer.setPalette({ accent: [12, 120, 200], onAccent: [255, 255, 255], text: [20, 30, 40], quiet: [70, 80, 90],
      plate: [250, 250, 250], roomFill: [231, 238, 242], forced: false });
    const initial = { ...createGalleryState("ready"), optionalUiReady: true, labelsVisible: false };
    const zone = (kind) => ({ kind, outline, holes: [[[1, 1], [1.2, 1], [1.2, 1.2]]], roomIds: [], areaIds: [] });
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const withZones = { ...initial, resources: { ...initial.resources, pose: { ...initial.resources.pose, value: null },
      areas: { status: "ready", problem: null,
        value: { ...initial.resources.areas.value, zones: [zone("no_go"), zone("unknown")] } } } };
    renderer.setState(withZones);
    for (let attempt = 0; attempt < 120 && layers !== "ready"; attempt += 1) await frame();
    renderer.requestRender();
    await frame();
    const live = [...paints];
    renderer.setState({ ...withZones, dataMode: "history" });
    await frame();
    renderer.dispose();
    return { live, history: paints };
  }, NO_GO);
  // The no-go zone is one even-odd fill around its hole and a solid outline;
  // the unknown zone is a dashed outline only.
  expect(result.live).toEqual([
    "fill rgba(20, 30, 40, 0.22)", "stroke rgba(20, 30, 40, 0.9)", "stroke rgba(20, 30, 40, 0.6) dashed",
  ]);
  // A history map draws neither.
  expect(result.history).toEqual([]);
});
