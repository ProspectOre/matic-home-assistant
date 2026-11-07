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
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status), {
    timeout: 15_000,
  }).toBe("ready");
  return panel;
};

test("The toolbar turns on Wi-Fi and reads the selected survey", async ({ page }) => {
  const panel = await mountPanel(page, SURVEY);
  await expect.poll(() => wifiRow(panel)).toEqual({ checked: "false", text: "Wi-Fi" });

  await panel.locator('[data-map-layer="wifi"]').click();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toEqual({
    status: "ready",
    surveying: true,
    cellSize: 0.3048,
    cells: [{ x: 0.152, y: 0.152, dbm: -48, size: 0.3048 }, { x: 0.457, y: 0.152, dbm: -88, size: 0.3048 }],
  });
  await expect.poll(() => wifiRow(panel)).toEqual({ checked: "true", text: "Wi-Fi" });

  await panel.locator('[data-map-layer="wifi"]').click();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toBeNull();
});

test("Wi-Fi colors can compare strong sampled spots without labeling them as poor signal", async ({ page }) => {
  test.setTimeout(60_000);
  const panel = await mountPanel(page, { enabled: true, cell_size: 0.3048, cells: [
    { x: 0.152, y: 0.152, dbm: -59 }, { x: 0.457, y: 0.152, dbm: -41.3 },
  ] }, "packaged");
  await expect.poll(() => wifiRow(panel)).not.toBeNull();
  await panel.locator('[data-map-layer="wifi"]').click();
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
  await panel.locator('[data-map-layer="wifi"]').click();
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
  await panel.locator('[data-map-layer="wifi"]').click();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.status)).toBe("ready");
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal.cells)).toEqual([]);

  await page.evaluate((survey) => { window.__wifiSignalReply = survey; }, SURVEY);
  await page.clock.fastForward(30_000);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal?.cells.length)).toBe(2);
});

test("a reattached panel keeps refreshing a layer left on", async ({ page }) => {
  await page.clock.install();
  const panel = await mountPanel(page, { enabled: true, cell_size: 0.5, cells: [] });
  await panel.locator('[data-map-layer="wifi"]').click();
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
  await panel.locator('[data-map-layer="wifi"]').click();
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
  await panel.locator('[data-map-layer="wifi"]').click();
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
  const wifi = panel.locator('[data-map-layer="wifi"]');
  await expect(wifi).toBeVisible();
  await wifi.click();
  await expect(wifi).toHaveAttribute("aria-pressed", "true");
  await expect(wifi).toHaveAttribute("data-detail", "No samples yet. Enable the survey in robot settings.");
  await expect(panel.locator('.map-layer-toolbar__note[role="status"]'))
    .toHaveText("No samples yet. Enable the survey in robot settings.");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toEqual({
    status: "ready", surveying: false, cellSize: 0.5, cells: [],
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

for (const count of [1261, 1500]) test(`large Wi-Fi surveys retain ${count} readings without crossing walls`, async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { buildWifiRaster } from "./frontend/map-studio-v4/wifi-raster"; export { parseWifiSignal } from "./frontend/map-studio-v4/wifi-signal";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/wifi-raster.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async (count) => {
    const { buildWifiRaster, parseWifiSignal } = await import("/wifi-raster.js");
    const width = 120, height = 100;
    const mask = new Uint8Array(Math.ceil(width * height / 8));
    const supported = (x, y) => x !== 6 && x !== 55 && !(x >= 20 && x < 24 && y >= 20 && y < 24);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if (!supported(x, y)) continue;
      const at = y * width + x;
      mask[at >>> 3] |= 1 << (at & 7);
    }
    const support = { version: 1, status: "verified", encoding: "bitset-little-v1", originCells: [0, 0],
      metersPerCell: 0.015, spanCells: [width, height], occupiedCells: width * height,
      maskSha256: "c".repeat(64), mask };
    const cells = [];
    for (let y = 10; y < 50; y += 1) for (let x = 10; x < 50; x += 1) {
      if (supported(x, y) && cells.length < count) cells.push({ x: (x + 0.5) * 0.015,
        y: (y + 0.5) * 0.015, dbm: x < 30 ? -42 : -84, size: 1 });
    }
    const layer = parseWifiSignal({ enabled: true, cell_size: 1, cells });
    const raster = buildWifiRaster(layer, support, "relative");
    if (!raster) return { visible: 0 };
    const pixels = raster.canvas.getContext("2d").getImageData(0, 0, raster.width, raster.height).data;
    const pixel = (x, y) => {
      if (x < raster.left || y < raster.top || x >= raster.left + raster.width || y >= raster.top + raster.height) return [0, 0, 0, 0];
      const offset = ((y - raster.top) * raster.width + x - raster.left) * 4;
      return [...pixels.slice(offset, offset + 4)];
    };
    let leaks = 0;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if ((!supported(x, y) || x < 6 || x > 55) && pixel(x, y)[3]) leaks += 1;
    }
    return { visible: cells.filter((cell) => pixel(Math.round(cell.x / 0.015 - 0.5), Math.round(cell.y / 0.015 - 0.5))[3] > 0).length,
      leaks, strong: pixel(15, 15), weak: pixel(45, 15), cached: buildWifiRaster(layer, support, "relative") === raster };
  }, count);
  expect(result.visible).toBe(count);
  expect(result.leaks).toBe(0);
  expect(result.strong[0]).toBeLessThan(result.weak[0]);
  expect(result.strong[2]).toBeGreaterThan(result.weak[2]);
  expect(result.cached).toBe(true);
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

test("Wi-Fi neighbors cannot tint a floor pixel across a wall corner", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { buildWifiRaster } from "./frontend/map-studio-v4/wifi-raster"; export { parseWifiSignal } from "./frontend/map-studio-v4/wifi-signal";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/wifi-corner.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { buildWifiRaster, parseWifiSignal } = await import("/wifi-corner.js");
    const width = 64, height = 40;
    const mask = new Uint8Array(Math.ceil(width * height / 8)).fill(255);
    for (let y = 12; y < height; y += 1) {
      const at = y * width + 28;
      mask[at >>> 3] &= ~(1 << (at & 7));
    }
    const support = { version: 1, status: "verified", encoding: "bitset-little-v1", originCells: [0, 0],
      metersPerCell: 0.015, spanCells: [width, height], occupiedCells: width * height - 28,
      maskSha256: "a".repeat(64), mask };
    const layer = parseWifiSignal({ enabled: true, cell_size: 0.3048, cells: [
      { x: 15.5 * 0.015, y: 10.5 * 0.015, dbm: -90, size: 0.6 },
      { x: 35.5 * 0.015, y: 10.5 * 0.015, dbm: -35, size: 0.15 },
    ] });
    const raster = buildWifiRaster(layer, support, "relative");
    const open = buildWifiRaster(layer, { ...support, mask: new Uint8Array(mask.length).fill(255) }, "relative");
    const pixel = (image, x, y) => [...image.canvas.getContext("2d").getImageData(x - image.left, y - image.top, 1, 1).data];
    return { reference: pixel(raster, 5, 25), blocked: pixel(raster, 17, 25),
      open: pixel(open, 17, 25), wall: pixel(raster, 28, 20) };
  });
  expect(result.blocked).toEqual(result.reference);
  expect(result.open).not.toEqual(result.reference);
  expect(result.blocked[3]).toBeGreaterThan(0);
  expect(result.wall[3]).toBe(0);
});

test("Unchanged Wi-Fi polls reuse raster work while changed readings and floors redraw", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { MapLayerResources } from "./frontend/map-studio-v4/map-layer-resources"; export { ResourceRequests } from "./frontend/map-studio-v4/resource-requests"; export { buildWifiRaster } from "./frontend/map-studio-v4/wifi-raster";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/wifi-polls.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { MapLayerResources, ResourceRequests, buildWifiRaster } = await import("/wifi-polls.js");
    const entry = { entryId: "robot-a", wifiHeatmapUrl: "/survey-a", mapSessionKey: "a" };
    const store = { value: { resources: { entry }, generation: 1, dataMode: "live", selection: { floorId: "current" },
      wifiSignal: { status: "loading", cells: [], cellSize: 0.3, surveying: false } },
      patch(change) { Object.assign(this.value, change); } };
    let reply = { enabled: true, cell_size: 0.3, cells: [{ x: 0.155, y: 0.155, dbm: -80 }] };
    let fail = false;
    const backend = { async mapLayer() { if (fail) throw new Error("offline"); return structuredClone(reply); } };
    const resources = new MapLayerResources(store, backend, new ResourceRequests(), { disposed: () => false, pageActive: () => true });
    const support = { version: 1, status: "verified", encoding: "bitset-little-v1", originCells: [0, 0],
      metersPerCell: 0.01, spanCells: [32, 32], occupiedCells: 1024, maskSha256: "a".repeat(64), mask: new Uint8Array(128).fill(255) };
    const raster = () => buildWifiRaster(store.value.wifiSignal, support, "absolute");
    await resources.reloadWifi(); const first = raster();
    await resources.reloadWifi(); const reused = raster() === first;
    reply.enabled = false;
    await resources.reloadWifi(); const metadataReused = raster() === first && !store.value.wifiSignal.surveying;
    fail = true; await resources.reloadWifi(); const failed = store.value.wifiSignal.status === "failed";
    fail = false; await resources.reloadWifi(); const recovered = store.value.wifiSignal.status === "ready" && raster() === first;
    reply.cells[0].dbm = -40;
    await resources.reloadWifi(); const changed = raster();
    const pixel = value => [...value.canvas.getContext("2d").getImageData(15 - value.left, 15 - value.top, 1, 1).data];
    const changedColor = JSON.stringify(pixel(first)) !== JSON.stringify(pixel(changed));
    const newSupport = { ...support, mask: support.mask.slice(), maskSha256: "b".repeat(64) };
    const newFloor = buildWifiRaster(store.value.wifiSignal, newSupport, "absolute") !== changed;
    const newScale = buildWifiRaster(store.value.wifiSignal, support, "relative") !== changed;
    // Entry switching clears optional state before the next robot's survey is admitted.
    store.value.resources.entry = { ...entry, entryId: "robot-b", wifiHeatmapUrl: "/survey-b", mapSessionKey: "b" };
    store.value.generation += 1;
    store.value.wifiSignal = { status: "loading", cells: [], cellSize: 0.3, surveying: false };
    await resources.reloadWifi();
    return { reused, metadataReused, failed, recovered, changedColor, changedRaster: changed !== first,
      newFloor, newScale, newRobot: raster() !== changed };
  });
  expect(result).toEqual({ reused: true, metadataReused: true, failed: true, recovered: true,
    changedColor: true, changedRaster: true, newFloor: true, newScale: true, newRobot: true });
});

test("Tilted Wi-Fi patches stay within a quarter backing pixel of the floor projection", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { drawWifiRaster } from "./frontend/map-studio-v4/wifi-raster";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/wifi-projection.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { drawWifiRaster } = await import("/wifi-projection.js");
    const source = document.createElement("canvas"); source.width = 96; source.height = 96;
    const ink = source.getContext("2d"); ink.fillStyle = "rgba(40,80,200,0.65)";
    ink.fillRect(1, 1, 94, 94); ink.clearRect(47, 0, 1, 96); ink.clearRect(68, 68, 8, 8);
    const raster = { canvas: source, left: 0, top: 0, width: 96, height: 96, patches: [[0, 0], [1, 0], [0, 1], [1, 1]] };
    const support = { originCells: [0, 0], metersPerCell: 0.01 };
    const target = document.createElement("canvas"); target.width = 1100; target.height = 1100;
    const context = target.getContext("2d"); context.scale(2, 2);
    const project = (x, y) => {
      const depth = 1 - 0.45 * x - 0.15 * y;
      return { x: 20 + (160 * x + 20 * y) / depth, y: 20 + (10 * x + 150 * y) / depth, depth };
    };
    let area = 0, maxError = 0, leaves = 0;
    const covered = new Uint8Array(96 * 96);
    const draw = context.drawImage.bind(context);
    context.drawImage = (image, x, y, width, height, ...destination) => {
      leaves += 1; area += width * height;
      const transform = context.getTransform();
      for (let v = 0; v <= 8; v += 1) for (let u = 0; u <= 8; u += 1) {
        const a = x + width * u / 8, b = y + height * v / 8;
        const actual = transform.transformPoint({ x: a, y: b }), exact = project(a * 0.01, b * 0.01);
        maxError = Math.max(maxError, Math.hypot(actual.x - exact.x * 2, actual.y - exact.y * 2));
      }
      for (let iy = Math.ceil(y - 0.5); iy + 0.5 < y + height; iy += 1) {
        for (let ix = Math.ceil(x - 0.5); ix + 0.5 < x + width; ix += 1) covered[iy * 96 + ix] += 1;
      }
      return draw(image, x, y, width, height, ...destination);
    };
    drawWifiRaster(context, raster, support, project, true);
    const transform = context.getTransform();
    const preserved = transform.a === 2 && transform.d === 2 && transform.e === 0 && transform.f === 0;
    const pixel = (x, y) => { const p = project((x + 0.5) * 0.01, (y + 0.5) * 0.01);
      return context.getImageData(Math.floor(p.x * 2), Math.floor(p.y * 2), 1, 1).data[3]; };
    const visible = pixel(20, 20), wall = pixel(47, 60), hole = pixel(72, 72), outside = pixel(98, 50);
    let affineDraws = 0;
    context.drawImage = (...args) => { affineDraws += 1; return draw(...args); };
    drawWifiRaster(context, raster, support, (x, y) => ({ x: 20 + x * 100, y: 20 + y * 100 }), false);
    return { maxError, area, leaves, once: [...covered].every(count => count === 1),
      preserved, visible, wall, hole, outside, affineDraws };
  });
  expect(result.maxError).toBeLessThanOrEqual(0.25);
  expect(result.area).toBe(96 * 96);
  expect(result.leaves).toBeGreaterThan(4);
  expect(result.leaves).toBeLessThan(16_384);
  expect(result.once).toBe(true);
  expect(result.preserved).toBe(true);
  expect(result.visible).toBeGreaterThan(0);
  expect(result.wall).toBe(0);
  expect(result.hole).toBe(0);
  expect(result.outside).toBe(0);
  expect(result.affineDraws).toBe(1);
});
