import { expect, test } from "@playwright/test";
import { build } from "esbuild";

import { paintOverlayOnCanvas } from "./map_studio_v4_overlay_canvas.mjs";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// The Wi-Fi signal layer is off by default. Map options turns it on, which
// reads the current floor's survey; the row explains an empty survey.

const SURVEY = {
  enabled: true,
  cell_size: 0.3048,
  cells: [
    { x: 0.152, y: 0.152, dbm: -48, samples: 3, updated_at: 1 },
    { x: 0.457, y: 0.152, dbm: -88, samples: 1, updated_at: 1 },
  ],
};

const wifiRow = (panel) => panel.evaluate((element) => {
  const scan = (root) => {
    const row = root.querySelector("[data-wifi-signal]");
    if (row) return { checked: row.getAttribute("aria-checked"), text: row.innerText.replace(/\s+/gu, " ").trim() };
    for (const child of root.querySelectorAll("*")) {
      const match = child.shadowRoot && scan(child.shadowRoot);
      if (match) return match;
    }
    return null;
  };
  return scan(element.shadowRoot);
});

const clickInShadow = (panel, selector) => panel.evaluate((element, target) => {
  const scan = (root) => {
    const match = root.querySelector(target);
    if (match) return match;
    for (const child of root.querySelectorAll("*")) {
      const found = child.shadowRoot && scan(child.shadowRoot);
      if (found) return found;
    }
    return null;
  };
  scan(element.shadowRoot).click();
}, selector);

const mountPanel = async (page, wifiSignal, moduleSource = "typescript", options = {}) => {
  const { panelTag } = await installPanelFixture(page, { wifiSignal, moduleSource, ...options });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    panel.dataset.testPanel = "true";
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(`${panelTag}[data-test-panel=true]`);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  return panel;
};

test("Map options turns on the Wi-Fi signal layer and reads the survey", async ({ page }) => {
  const panel = await mountPanel(page, SURVEY);
  await expect(panel.getByRole("button", { name: "Map options" })).toHaveText("Layers");
  await clickInShadow(panel, "[aria-controls=map-options]");
  await expect.poll(() => wifiRow(panel)).toEqual({ checked: "false", text: "Wi-Fi signal" });

  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toEqual({
    status: "ready",
    surveying: true,
    cellSize: 0.3048,
    cells: [{ x: 0.152, y: 0.152, dbm: -48, size: 0.3048 }, { x: 0.457, y: 0.152, dbm: -88, size: 0.3048 }],
  });
  await expect.poll(() => wifiRow(panel)).toEqual({ checked: "true", text: "Wi-Fi signal Smoothed estimates within 2 feet of samples. Older readings are coarser; blank areas are unmeasured." });

  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toBeNull();
});

test("Wi-Fi colors can compare strong sampled spots without labeling them as poor signal", async ({ page }) => {
  test.setTimeout(60_000);
  await paintOverlayOnCanvas(page);
  await page.addInitScript(() => {
    window.__wifiPaint = [];
    const original = CanvasGradient.prototype.addColorStop;
    CanvasGradient.prototype.addColorStop = function(offset, colour) {
      if (offset === 0 && colour.endsWith(",.65)")) window.__wifiPaint.push(colour);
      return original.call(this, offset, colour);
    };
  });
  const panel = await mountPanel(page, { enabled: true, cell_size: 0.3048, cells: [
    { x: 0.152, y: 0.152, dbm: -59 }, { x: 0.457, y: 0.152, dbm: -41.3 },
  ] }, "packaged");
  await clickInShadow(panel, "[aria-controls=map-options]");
  await expect.poll(() => wifiRow(panel)).not.toBeNull();
  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.status)).toBe("ready");
  const menu = panel.getByRole("menu", { name: "Map options" });
  await expect(menu.getByRole("menuitemradio", { name: "Signal strength" })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("img", { name: "Color scale: -90 dBm – -35 dBm" })).toBeVisible();
  // -59 dBm is hue 68 on the fixed scale and hue 0, the weakest, among the samples.
  await expect.poll(() => page.evaluate(() => window.__wifiPaint), { timeout: 15_000 }).toEqual(expect.arrayContaining([
    "rgba(178,201,29,.65)",
  ]));
  await page.evaluate(() => { window.__wifiPaint = []; });
  await menu.getByRole("menuitemradio", { name: "Compare sampled spots" }).click();
  await expect(menu.getByRole("menuitemradio", { name: "Compare sampled spots" })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio", { name: "Signal strength" })).toHaveAttribute("aria-checked", "false");
  await expect(menu.getByRole("menuitemradio", { name: "Signal strength" })).not.toHaveAttribute("data-selected", "true");
  await expect(menu.getByRole("menuitemradio", { name: "Compare sampled spots" })).toHaveAttribute("data-selected", "true");
  await expect(menu.getByRole("img", { name: "Color scale: -59 dBm – -41.3 dBm" })).toBeVisible();
  await expect(menu.getByText("Colors compare sampled spots, not absolute quality.")).toBeVisible();
  await expect(menu.getByText("Sampled range: -59 dBm – -41.3 dBm")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__wifiPaint), { timeout: 15_000 }).toEqual(expect.arrayContaining([
    "rgba(201,29,29,.65)",
  ]));
  await page.screenshot({ path: test.info().outputPath("wifi-relative-scale.png") });
  await page.evaluate(() => { window.__wifiSignalReply = { enabled: true, cell_size: 0.3048, cells: [
    { x: 0.152, y: 0.152, dbm: -58 }, { x: 0.457, y: 0.152, dbm: -42 },
  ] }; });
  await expect(menu.getByRole("img", { name: "Color scale: -58 dBm – -42 dBm" })).toBeVisible({ timeout: 40_000 });
  await expect(menu.getByRole("menuitemradio", { name: "Compare sampled spots" })).toHaveAttribute("aria-checked", "true");
});

test("Wi-Fi colors stay available while docked on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await mountPanel(page, SURVEY, "packaged", { initialRobotStates: {
    "vacuum.synthetic": { state: "docked", attributes: { matic_entry_id: "synthetic-entry" } },
  } });
  await clickInShadow(panel, "[aria-controls=map-options]");
  await expect.poll(() => wifiRow(panel)).not.toBeNull();
  await clickInShadow(panel, "[data-wifi-signal]");
  const menu = panel.getByRole("menu", { name: "Map options" });
  const relative = menu.getByRole("menuitemradio", { name: "Compare sampled spots" });
  await relative.scrollIntoViewIfNeeded();
  await relative.click();
  await expect(relative).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByText("Colors compare sampled spots, not absolute quality.")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("wifi-relative-mobile.png") });
});

test("the layer picks up new cells while it stays on", async ({ page }) => {
  await page.clock.install();
  const panel = await mountPanel(page, { enabled: true, cell_size: 0.5, cells: [] });
  await clickInShadow(panel, "[aria-controls=map-options]");
  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.status)).toBe("ready");
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal.cells)).toEqual([]);

  await page.evaluate((survey) => { window.__wifiSignalReply = survey; }, SURVEY);
  await page.clock.fastForward(30_000);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.cells.length)).toBe(2);
});

test("a reattached panel keeps refreshing a layer left on", async ({ page }) => {
  await page.clock.install();
  const panel = await mountPanel(page, { enabled: true, cell_size: 0.5, cells: [] });
  await clickInShadow(panel, "[aria-controls=map-options]");
  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.status)).toBe("ready");

  await panel.evaluate(async (element) => {
    element.remove();
    document.body.append(element);
    await element.updateComplete;
  });
  await page.evaluate((survey) => { window.__wifiSignalReply = survey; }, SURVEY);
  await page.clock.fastForward(30_000);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.cells.length)).toBe(2);
});

test("a floor change from the catalog drops the old floor's cells", async ({ page }) => {
  await page.clock.install();
  const panel = await mountPanel(page, SURVEY);
  await clickInShadow(panel, "[aria-controls=map-options]");
  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.cells.length)).toBe(2);

  await panel.evaluate(async (element) => {
    const { entries } = await (await element.hass.fetchWithAuth("/api/matic_robot/slam_entries")).json();
    window.__panelFixture.setCatalogEntries(entries.map((entry) => ({
      ...entry, selected_floor_ordinal: 2, map_floor_ordinal: 2,
    })));
    window.__wifiSignalReply = { enabled: true, cell_size: 0.5, cells: [] };
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-action", {
      detail: { id: "recheck-status" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toEqual({
    status: "ready", surveying: true, cellSize: 0.5, cells: [],
  });
});

test("a new map session on the same floor drops the old frame's cells", async ({ page }) => {
  await page.clock.install();
  const panel = await mountPanel(page, SURVEY);
  await clickInShadow(panel, "[aria-controls=map-options]");
  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.cells.length)).toBe(2);

  await panel.evaluate(async (element) => {
    const { entries } = await (await element.hass.fetchWithAuth("/api/matic_robot/slam_entries")).json();
    window.__panelFixture.setCatalogEntries(entries.map((entry) => ({ ...entry, map_session_key: "c".repeat(64) })));
    window.__wifiSignalReply = { enabled: true, cell_size: 0.5, cells: [] };
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-action", {
      detail: { id: "recheck-status" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toEqual({
    status: "ready", surveying: true, cellSize: 0.5, cells: [],
  });
});

test("an empty survey says how to start one", async ({ page }) => {
  const panel = await mountPanel(page, { enabled: false, cell_size: 0.5, cells: [] });
  await clickInShadow(panel, "[aria-controls=map-options]");
  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => wifiRow(panel)).toEqual({
    checked: "true",
    text: "Wi-Fi signal Turn on Wi-Fi survey in the robot's settings",
  });
});

test("the row stays hidden without a survey endpoint", async ({ page }) => {
  const panel = await mountPanel(page, null);
  await clickInShadow(panel, "[aria-controls=map-options]");
  await expect.poll(() => panel.evaluate((element) => Boolean(element.shadowRoot))).toBe(true);
  expect(await wifiRow(panel)).toBeNull();
});

test("renderer colours each surveyed cell by signal on the live floor only", async ({ page }) => {
  await paintOverlayOnCanvas(page);
  const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state"; export { parseWifiSignal } from "./frontend/map-studio-v4/wifi-signal";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/wifi-renderer.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async (survey) => {
    const { RendererController, createGalleryState, parseWifiSignal } = await import("/wifi-renderer.js");
    const scene = document.createElement("canvas"), overlay = document.createElement("canvas");
    for (const canvas of [scene, overlay]) {
      Object.assign(canvas.style, { position: "absolute", width: "720px", height: "540px" });
      document.body.append(canvas);
    }
    const context = overlay.getContext("2d");
    const fills = [];
    // The fallback raster redraws the overlay as each chunk lands, so keep the newest draw only.
    const clearRect = context.clearRect.bind(context);
    context.clearRect = (...args) => { fills.length = 0; return clearRect(...args); };
    const wifiGradients = new WeakSet();
    const addColorStop = CanvasGradient.prototype.addColorStop;
    // The hue of each cell's centre colour.
    const hue = (colour) => {
      const [red, green, blue] = colour.match(/\d+/gu).map(Number);
      const max = Math.max(red, green, blue), range = max - Math.min(red, green, blue);
      const sector = max === red ? (green - blue) / range % 6 : max === green ? (blue - red) / range + 2 : (red - green) / range + 4;
      return Math.round((sector * 60 + 360) % 360);
    };
    CanvasGradient.prototype.addColorStop = function(offset, colour) {
      if (offset === 0 && colour.endsWith(",.65)")) { fills.push(hue(colour)); wifiGradients.add(this); }
      return addColorStop.call(this, offset, colour);
    };
    let status = "idle";
    const renderer = new RendererController(scene, overlay, {
      onModuleStatus: (module, next) => { if (module === "renderer-layers") status = next; },
    });
    const initial = createGalleryState("ready");
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const wifiSignal = parseWifiSignal(survey);
    renderer.setState({ ...initial, wifiSignal });
    for (let attempt = 0; attempt < 120 && status !== "ready"; attempt += 1) await frame();
    fills.length = 0;
    renderer.requestRender();
    await frame();
    const live = fills.splice(0);
    const strong = parseWifiSignal({ enabled: true, cell_size: 0.3048, cells: [
      { x: 0.152, y: 0.152, dbm: -59 }, { x: 0.457, y: 0.152, dbm: -41.3 },
    ] });
    renderer.setState({ ...initial, wifiSignal: strong });
    await frame();
    const absoluteStrong = fills.splice(0);
    renderer.setState({ ...initial, wifiSignal: strong, wifiScale: "relative" });
    await frame();
    const relativeStrong = fills.splice(0);
    const uniform = parseWifiSignal({ enabled: true, cell_size: 0.3048, cells: [
      { x: 0.152, y: 0.152, dbm: -55 }, { x: 0.457, y: 0.152, dbm: -54.8 },
    ] });
    renderer.setState({ ...initial, wifiSignal: uniform, wifiScale: "relative" });
    await frame();
    const relativeUniform = fills.splice(0);
    renderer.setState({ ...initial, wifiSignal, dataMode: "history" });
    await frame();
    const history = fills.splice(0);
    renderer.setState({ ...initial, wifiSignal, floor: { ...initial.floor, readOnly: true } });
    await frame();
    const retained = fills.splice(0);
    const painted = [];
    const fill = context.fill.bind(context);
    context.fill = (...args) => { painted.push(String(context.fillStyle)); return fill(...args); };
    const fillRect = context.fillRect.bind(context);
    context.fillRect = (...args) => { if (wifiGradients.has(context.fillStyle)) painted.push("wifi-gradient"); return fillRect(...args); };
    renderer.setState({ ...initial, wifiSignal, view: "top", appearance: "rooms" });
    await frame();
    renderer.dispose();
    const lastRoomFill = painted.findLastIndex((value) => / 0\.94\)$/u.test(value));
    const firstCell = painted.indexOf("wifi-gradient");
    const roomColours = { roomFills: lastRoomFill >= 0, cellsAbove: firstCell > lastRoomFill };
    const rejected = [
      { enabled: "yes", cell_size: 0.5, cells: [] },
      { enabled: true, cell_size: 0.5, cells: [{ x: 0, y: 0, dbm: 3 }] },
      { enabled: true, cell_size: 0.5, cells: [{ x: 0, y: 0, dbm: -50, size: -1 }] },
      { enabled: true, cell_size: 0, cells: [] },
      { enabled: true, cell_size: 0.5, cells: [null] },
      null,
    ].map((value) => { try { parseWifiSignal(value); return false; } catch { return true; } });
    return { live, absoluteStrong, relativeStrong, relativeUniform, history, retained, rejected, roomColours };
  }, SURVEY);
  // The fixed scale distinguishes strong readings without saturating at -50 dBm.
  expect(result.live).toEqual([92, 4]);
  expect(result.absoluteStrong).toEqual([68, 106]);
  expect(result.relativeStrong).toEqual([0, 120]);
  expect(result.relativeUniform).toEqual([58, 62]);
  expect(result.history).toEqual([]);
  // A retained read-only scene waits for the live one before cells draw.
  expect(result.retained).toEqual([]);
  // Room colors fill rooms at 94% opacity; the cells must paint over them.
  expect(result.roomColours).toEqual({ roomFills: true, cellsAbove: true });
  expect(result.rejected).toEqual([true, true, true, true, true, true]);
});
