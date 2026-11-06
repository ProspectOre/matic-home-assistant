import { expect, test } from "@playwright/test";
import { build } from "esbuild";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// Turning on Wi-Fi in the toolbar loads the selected floor's survey.

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
    const row = root.querySelector('[data-map-layer="wifi"]');
    if (row) return { checked: row.getAttribute("aria-pressed"), text: row.querySelector(".map-layer-toolbar__label")?.textContent?.trim() };
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

test("The toolbar turns on Wi-Fi and reads the selected survey", async ({ page }) => {
  const panel = await mountPanel(page, SURVEY);
  await expect.poll(() => wifiRow(panel)).toEqual({ checked: "false", text: "Wi-Fi" });

  await clickInShadow(panel, '[data-map-layer=\"wifi\"]');
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toEqual({
    status: "ready",
    surveying: true,
    cellSize: 0.3048,
    cells: [{ x: 0.152, y: 0.152, dbm: -48, size: 0.3048 }, { x: 0.457, y: 0.152, dbm: -88, size: 0.3048 }],
  });
  await expect.poll(() => wifiRow(panel)).toEqual({ checked: "true", text: "Wi-Fi" });

  await clickInShadow(panel, '[data-map-layer=\"wifi\"]');
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toBeNull();
});

test("Wi-Fi colors can compare strong sampled spots without labeling them as poor signal", async ({ page }) => {
  test.setTimeout(60_000);
  const panel = await mountPanel(page, { enabled: true, cell_size: 0.3048, cells: [
    { x: 0.152, y: 0.152, dbm: -59 }, { x: 0.457, y: 0.152, dbm: -41.3 },
  ] }, "packaged");
  await expect.poll(() => wifiRow(panel)).not.toBeNull();
  await clickInShadow(panel, '[data-map-layer=\"wifi\"]');
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.status)).toBe("ready");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.cells.length)).toBe(2);
  const toolbar = panel.getByRole("group", { name: "Layers" });
  await expect(toolbar.locator('[data-wifi-scale="absolute"]')).toBeVisible();
  const absolute = toolbar.locator('[data-wifi-scale="absolute"]');
  const relative = toolbar.locator('[data-wifi-scale="relative"]');
  await expect(absolute).toHaveAttribute("aria-pressed", "true");
  await expect(toolbar.locator(".wifi-legend")).toContainText("-90 dBm");
  await expect(toolbar.locator(".wifi-legend")).toContainText("-35 dBm");
  await relative.click();
  await expect(relative).toHaveAttribute("aria-pressed", "true");
  await expect(absolute).toHaveAttribute("aria-pressed", "false");
  await expect(toolbar.locator(".wifi-legend")).toContainText("-59 dBm");
  await expect(toolbar.locator(".wifi-legend")).toContainText("-41.3 dBm");
  await expect(toolbar.locator(".map-layer-toolbar__wifi-range")).toContainText("-59 dBm – -41.3 dBm");
  await page.screenshot({ path: test.info().outputPath("wifi-relative-scale.png") });
  await page.evaluate(() => { window.__wifiSignalReply = { enabled: true, cell_size: 0.3048, cells: [
    { x: 0.152, y: 0.152, dbm: -58 }, { x: 0.457, y: 0.152, dbm: -42 },
  ] }; });
  await expect(toolbar.locator(".wifi-legend")).toContainText("-58 dBm", { timeout: 40_000 });
  await expect(relative).toHaveAttribute("aria-pressed", "true");
});

test("Wi-Fi colors stay available while docked on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await mountPanel(page, SURVEY, "packaged", { initialRobotStates: {
    "vacuum.synthetic": { state: "docked", attributes: { matic_entry_id: "synthetic-entry" } },
  } });
  await expect.poll(() => wifiRow(panel)).not.toBeNull();
  await clickInShadow(panel, '[data-map-layer=\"wifi\"]');
  const toolbar = panel.getByRole("group", { name: "Layers" });
  const relative = toolbar.locator('[data-wifi-scale="relative"]');
  await relative.scrollIntoViewIfNeeded();
  await relative.click();
  await expect(relative).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: test.info().outputPath("wifi-relative-mobile.png") });
});

test("the layer picks up new cells while it stays on", async ({ page }) => {
  await page.clock.install();
  const panel = await mountPanel(page, { enabled: true, cell_size: 0.5, cells: [] });
  await clickInShadow(panel, '[data-map-layer=\"wifi\"]');
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.status)).toBe("ready");
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal.cells)).toEqual([]);

  await page.evaluate((survey) => { window.__wifiSignalReply = survey; }, SURVEY);
  await page.clock.fastForward(30_000);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.cells.length)).toBe(2);
});

test("a reattached panel keeps refreshing a layer left on", async ({ page }) => {
  await page.clock.install();
  const panel = await mountPanel(page, { enabled: true, cell_size: 0.5, cells: [] });
  await clickInShadow(panel, '[data-map-layer=\"wifi\"]');
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
  await clickInShadow(panel, '[data-map-layer=\"wifi\"]');
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
  await clickInShadow(panel, '[data-map-layer=\"wifi\"]');
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
  await clickInShadow(panel, '[data-map-layer=\"wifi\"]');
  await expect.poll(() => wifiRow(panel)).toEqual({
    checked: "true",
    text: "Wi-Fi",
  });
});

test("the Wi-Fi layer explains when its endpoint is unavailable", async ({ page }) => {
  const panel = await mountPanel(page, null);
  const wifi = panel.locator('[data-map-layer="wifi"]');
  await expect(wifi).toHaveAttribute("aria-disabled", "true");
  await expect(wifi).toHaveAttribute("aria-pressed", "false");
  await expect(wifi).toHaveAttribute("data-detail", "Wi-Fi survey data is unavailable for this map.");
});

test("mixed one-foot and legacy Wi-Fi samples keep the raster and strong/weak spots", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { buildWifiRaster } from "./frontend/map-studio-v4/wifi-raster"; export { parseWifiSignal } from "./frontend/map-studio-v4/wifi-signal";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/wifi-raster.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { buildWifiRaster, parseWifiSignal } = await import("/wifi-raster.js");
    const width = 220, height = 220;
    const mask = new Uint8Array(Math.ceil(width * height / 8));
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      mask[at >>> 3] |= 1 << (at & 7);
    }
    const support = { version: 1, status: "verified", encoding: "bitset-little-v1", originCells: [0, 0],
      metersPerCell: 0.015, spanCells: [width, height], occupiedCells: width * height,
      maskSha256: "b".repeat(64), mask };
    const readings = [];
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
      readings.push({ x: (10.5 + x * 20.32) * 0.015, y: (10.5 + y * 20.32) * 0.015,
        dbm: x < 4 ? -42 : -84, size: 0.3048 });
    }
    const grid = parseWifiSignal({ enabled: true, cell_size: 0.3048, cells: readings });
    const mixed = parseWifiSignal({ enabled: true, cell_size: 0.3048, cells: [
      ...readings, { x: 160 * 0.015, y: 0.015, dbm: -60, size: 1.0 },
    ] });
    const gridRaster = buildWifiRaster(grid, support, "relative");
    const mixedRaster = buildWifiRaster(mixed, support, "relative");
    const samplePixel = (raster, x, y) => {
      if (!raster || x < raster.left || x >= raster.left + raster.width || y < raster.top || y >= raster.top + raster.height) return null;
      const pixels = raster.canvas.getContext("2d").getImageData(0, 0, raster.width, raster.height).data;
      const offset = ((y - raster.top) * raster.width + x - raster.left) * 4;
      return [...pixels.slice(offset, offset + 4)];
    };
    const alphaCount = (raster) => {
      if (!raster) return 0;
      const pixels = raster.canvas.getContext("2d").getImageData(0, 0, raster.width, raster.height).data;
      let count = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) count += 1;
      return count;
    };
    return { gridAlpha: alphaCount(gridRaster), mixedAlpha: alphaCount(mixedRaster),
      strong: samplePixel(mixedRaster, 51, 91), weak: samplePixel(mixedRaster, 152, 91) };
  });
  expect(result.gridAlpha).toBeGreaterThan(0);
  expect(result.mixedAlpha).toBeGreaterThanOrEqual(result.gridAlpha);
  expect(result.strong?.[3]).toBeGreaterThan(0);
  expect(result.weak?.[3]).toBeGreaterThan(0);
  expect(result.strong?.[0]).toBeLessThan(result.weak?.[0]);
  expect(result.strong?.[2]).toBeGreaterThan(result.weak?.[2]);
});

test("Wi-Fi heatmap fills measured floor bins, clips walls, blends neighbors, and stays below coverage", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { buildWifiRaster, drawWifiRaster } from "./frontend/map-studio-v4/wifi-raster"; export { drawMapLayers } from "./frontend/map-studio-v4/renderer-layers"; export { entryCoherenceIdentity } from "./frontend/map-studio-v4/backend-contracts"; export { parseWifiSignal } from "./frontend/map-studio-v4/wifi-signal"; export { parseSceneBuffer } from "./frontend/map-studio-v4/scene-parser";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/wifi-raster.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { buildWifiRaster, drawWifiRaster, drawMapLayers, entryCoherenceIdentity, parseWifiSignal, parseSceneBuffer } = await import("/wifi-raster.js");
    const width = 64, height = 32;
    const mask = new Uint8Array(Math.ceil(width * height / 8));
    let occupiedCells = 0;
    const mark = (x, y) => { const at = y * width + x; mask[at >>> 3] |= 1 << (at & 7); occupiedCells += 1; };
    for (let y = 2; y < height - 2; y += 1) for (let x = 2; x < width - 2; x += 1) {
      if (x !== 20 && !(x === 35 && y === 19)) mark(x, y);
    }
    const support = { version: 1, status: "verified", encoding: "bitset-little-v1", originCells: [0, 0],
      metersPerCell: 0.015, spanCells: [width, height], occupiedCells,
      maskSha256: "a".repeat(64), mask };
    const payload = { meters_per_cell: 0.015, origin_cells: [0, 0], span_cells: [width, height], rooms: [],
      floor_support: { version: 1, status: "verified", encoding: "bitset-little-v1", origin_cells: [0, 0],
        meters_per_cell: 0.015, span_cells: [width, height], occupied_cells: occupiedCells,
        mask_sha256: "a".repeat(64), mask_base64: btoa(String.fromCharCode(...mask)) } };
    const metadata = new TextEncoder().encode(JSON.stringify(payload));
    const sceneBuffer = new ArrayBuffer(24 + metadata.length + 8);
    new Uint8Array(sceneBuffer, 0, 8).set(new TextEncoder().encode("MATIC3D\0"));
    const header = new DataView(sceneBuffer);
    header.setUint16(8, 1, true); header.setUint16(10, 8, true);
    header.setUint32(12, metadata.length, true); header.setUint32(16, 1, true);
    new Uint8Array(sceneBuffer, 24, metadata.length).set(metadata);
    const parsedSupport = parseSceneBuffer(sceneBuffer).metadata.floorSupport;
    const parserSupportValid = parsedSupport?.occupiedCells === occupiedCells
      && parsedSupport.mask.length === mask.length && parsedSupport.mask[20 >>> 3] === mask[20 >>> 3];
    const layer = parseWifiSignal({ enabled: true, cell_size: 0.3048, cells: [
      { x: 0.152, y: 0.3, dbm: -90, size: 0.3048 },
      { x: 0.457, y: 0.3, dbm: -35, size: 0.3048 },
    ] });
    const raster = buildWifiRaster(layer, support, "relative");
    const pixels = raster.canvas.getContext("2d").getImageData(0, 0, raster.width, raster.height);
    const alphaAt = (x, y) => x < raster.left || x >= raster.left + raster.width || y < raster.top || y >= raster.top + raster.height
      ? 0 : pixels.data[((y - raster.top) * raster.width + x - raster.left) * 4 + 3] || 0;
    const colorAt = (x, y) => [...pixels.data.slice(((y - raster.top) * raster.width + x - raster.left) * 4, ((y - raster.top) * raster.width + x - raster.left) * 4 + 3)];
    const red = colorAt(10, 19), green = colorAt(30, 19);
    const across = [];
    for (let x = 0; x < width; x += 1) across.push(alphaAt(x, 19) > 0);
    const cached = raster === buildWifiRaster(layer, support, "relative");
    const singleLayer = parseWifiSignal({ enabled: true, cell_size: 0.15, cells: [
      { x: 0.457, y: 0.3, dbm: -60, size: 0.15 },
    ] });
    const fullSupport = { ...support, mask: new Uint8Array(Math.ceil(width * height / 8)).fill(255) };
    const single = buildWifiRaster(singleLayer, fullSupport, "relative");
    const singlePixels = single.canvas.getContext("2d").getImageData(0, 0, single.width, single.height);
    const singlePoints = [];
    for (let y = 0; y < single.height; y += 1) for (let x = 0; x < single.width; x += 1) {
      if (singlePixels.data[(y * single.width + x) * 4 + 3]) singlePoints.push([x + single.left, y + single.top]);
    }
    const xs = singlePoints.map(([x]) => x), ys = singlePoints.map(([, y]) => y);
    const singleSquare = Math.max(...xs) - Math.min(...xs) === Math.max(...ys) - Math.min(...ys)
      && singlePoints.length === (Math.max(...xs) - Math.min(...xs) + 1) ** 2;
    const leftEdge = colorAt(19, 19), rightEdge = colorAt(21, 19);
    const coarseLayer = parseWifiSignal({ enabled: true, cell_size: 1.2, cells: [
      { x: 0.1575, y: 0.3, dbm: -60, size: 1.2 },
    ] });
    const coarse = buildWifiRaster(coarseLayer, support, "relative");
    const coarsePixels = coarse.canvas.getContext("2d").getImageData(0, 0, coarse.width, coarse.height);
    const coarseAlphaAt = (x, y) => x < coarse.left || x >= coarse.left + coarse.width
      || y < coarse.top || y >= coarse.top + coarse.height ? 0
      : coarsePixels.data[((y - coarse.top) * coarse.width + x - coarse.left) * 4 + 3] || 0;

    const projectedCanvas = document.createElement("canvas");
    projectedCanvas.width = 256; projectedCanvas.height = 160;
    const projectedContext = projectedCanvas.getContext("2d");
    projectedContext.scale(2, 2);
    const projectedState = { dataMode: "live", floor: { readOnly: false }, selection: { floorId: "current" }, view: "top",
      wifiScale: "relative", wifiSignal: layer, floorTypeModes: 0, floorTypes: null,
      resources: { scene: { value: { metadata: { floorSupport: support } } } }, liveCoverage: null, coverageModes: 0 };
    drawMapLayers(projectedContext, projectedState, (x, y) => ({ x: 20 + x * 50, y: 20 + y * 50 }));
    const renderedAlphaAt = (mapX, mapY) => {
      const pixel = projectedContext.getImageData(Math.floor(2 * (20 + mapX * 50)), Math.floor(2 * (20 + mapY * 50)), 1, 1);
      return pixel.data[3];
    };
    const renderedCellAlpha = (x, y) => renderedAlphaAt((x + 0.5) * 0.015, (y + 0.5) * 0.015);
    const projectedPixels = { floor: renderedCellAlpha(10, 19), wall: renderedCellAlpha(20, 19),
      exterior: renderedCellAlpha(0, 19), hole: renderedCellAlpha(35, 19) };

    const target = document.createElement("canvas");
    target.width = 256; target.height = 160;
    const context = target.getContext("2d");
    context.scale(2, 2);
    const drawOrder = [];
    const drawImage = context.drawImage.bind(context);
    context.drawImage = (...args) => { drawOrder.push("wifi"); return drawImage(...args); };
    const fill = context.fill.bind(context);
    context.fill = (...args) => { drawOrder.push("coverage"); return fill(...args); };
    const entry = { entryId: "entry", selectedFloorOrdinal: 1, mapFloorOrdinal: 1, mapFloorCoherent: true,
      mapSessionVerified: true, mapSessionKey: "session", mapSceneEpoch: "epoch", nativeSessionActive: true };
    const identity = entryCoherenceIdentity(entry);
    const state = { dataMode: "live", floor: { readOnly: false }, selection: { floorId: "current" }, view: "top",
      wifiScale: "relative", wifiSignal: layer, floorTypeModes: 0, floorTypes: null,
      resources: { entry, scene: { value: { metadata: { floorSupport: support } } } },
      liveCoverage: { active: true, frameKey: identity, mapSessionKey: "session", cellSize: 0.015,
        runs: [[0, 0, 1, 1]], truncated: true, ownershipUnverified: false, coverageBasis: "observed_changes" },
      coverageModes: 1 };
    drawMapLayers(context, state, (x, y) => ({ x: 20 + x * 50, y: 20 + y * 50 }));
    const dprPreserved = context.getTransform().a === 2 && context.getTransform().d === 2;
    state.view = "three";
    drawMapLayers(context, state, (x, y) => ({ x: 20 + x * 50, y: 20 + y * 50 }));
    const dprPreservedInThreeD = context.getTransform().a === 2 && context.getTransform().d === 2;
    return { red, green, across, cached, singleSquare, leftEdge, rightEdge,
      coarseNear: coarseAlphaAt(19, 19) > 0, coarseFar: coarseAlphaAt(21, 19) > 0,
      parserSupportValid, projectedPixels, dprPreserved, dprPreservedInThreeD, drawOrder };
  });
  expect(result.red[0]).toBeGreaterThan(result.green[0]);
  expect(result.green[2]).toBeGreaterThan(result.red[2]);
  expect(result.red).not.toEqual(result.green);
  expect(result.leftEdge).toEqual(result.red);
  expect(result.rightEdge).toEqual(result.green);
  expect(result.across[20]).toBe(false);
  expect(result.across[35]).toBe(false);
  expect(result.across[0]).toBe(false);
  expect(result.across[50]).toBe(false);
  expect(result.singleSquare).toBe(true);
  expect(result.coarseNear).toBe(true);
  expect(result.coarseFar).toBe(false);
  expect(result.parserSupportValid).toBe(true);
  expect(result.projectedPixels.floor).toBeGreaterThan(0);
  expect(result.projectedPixels.wall).toBe(0);
  expect(result.projectedPixels.exterior).toBe(0);
  expect(result.projectedPixels.hole).toBe(0);
  expect(result.cached).toBe(true);
  expect(result.dprPreserved).toBe(true);
  expect(result.dprPreservedInThreeD).toBe(true);
  expect(result.drawOrder).toEqual(["wifi", "coverage", "wifi", "coverage"]);
});
