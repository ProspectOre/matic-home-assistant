import { expect, test } from "@playwright/test";
import { build } from "esbuild";

import { paintOverlayOnCanvas } from "./map_studio_v4_overlay_canvas.mjs";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// The Wi-Fi signal layer is off by default. Map options turns it on, which
// reads the current floor's survey; the row explains an empty survey, and a
// legend on the map names the bands, the weakest room and a tapped spot.

const SURVEY = {
  enabled: true,
  cell_size: 0.3048,
  cells: [
    { x: 0.152, y: 0.152, dbm: -48, samples: 3, updated_at: 1 },
    { x: 0.457, y: 0.152, dbm: -88, samples: 1, updated_at: 1 },
  ],
  rooms: [
    { name: "Kitchen", dbm: -52, weakest: -60, samples: 9 },
    { name: "Office", dbm: -74.4, weakest: -88, samples: 4 },
  ],
};

// Readings a metre apart over the whole synthetic map, so every spot in a room reads -62 dBm.
const COVERED = {
  enabled: true,
  cell_size: 0.3048,
  cells: Array.from({ length: 21 * 21 }, (_, index) => ({
    x: index % 21 - 10, y: Math.floor(index / 21) - 10, dbm: -62, samples: 2, updated_at: Math.round(Date.now() / 1000) - 3 * 86_400,
  })),
  rooms: SURVEY.rooms,
};

const legend = (panel) => panel.evaluate((element) => {
  const scan = (root) => {
    const match = root.querySelector(".wifi-legend");
    if (match) return match;
    for (const child of root.querySelectorAll("*")) {
      const found = child.shadowRoot && scan(child.shadowRoot);
      if (found) return found;
    }
    return null;
  };
  const found = scan(element.shadowRoot);
  if (!found) return null;
  const text = (selector) => found.querySelector(selector)?.innerText.replace(/\s+/gu, " ").trim() ?? null;
  const box = found.getBoundingClientRect();
  return { bands: text(".wifi-bands"), weakest: text("[data-weakest-room]"), spot: text("[data-wifi-spot]"),
    // Inside the closed disclosure, so read as text rather than as rendered.
    rooms: [...found.querySelectorAll("tr")].map((row) => [...row.cells].map((cell) => cell.textContent.trim()).join(" ")),
    inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight };
});

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
    cells: [{ x: 0.152, y: 0.152, dbm: -48, samples: 3, updatedAt: 1 }, { x: 0.457, y: 0.152, dbm: -88, samples: 1, updatedAt: 1 }],
    rooms: [{ name: "Office", dbm: -74.4, weakest: -88, samples: 4 }, { name: "Kitchen", dbm: -52, weakest: -60, samples: 9 }],
  });
  await expect.poll(() => wifiRow(panel)).toEqual({ checked: "true", text: "Wi-Fi signal Estimates within 1.5 m of a reading. Blank areas are unmeasured." });
  // Home Assistant set to US customary units states the reach in feet.
  await panel.evaluate((element) => { element.hass = { ...element.hass, config: { unit_system: { length: "mi" } } }; });
  await expect.poll(() => wifiRow(panel)).toEqual({ checked: "true", text: "Wi-Fi signal Estimates within 5 ft of a reading. Blank areas are unmeasured." });

  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toBeNull();
});

test("the legend on the map names the bands and the weakest room, and reads a tapped spot", async ({ page }) => {
  const panel = await mountPanel(page, COVERED, "packaged");
  await clickInShadow(panel, "[aria-controls=map-options]");
  await expect.poll(() => wifiRow(panel)).not.toBeNull();
  await clickInShadow(panel, "[data-wifi-signal]");
  await page.keyboard.press("Escape");
  await expect.poll(() => legend(panel)).toMatchObject({
    bands: "Strong -55 dBm and up Good -67 to -56 dBm Weak -80 to -68 dBm Dead zone Below -80 dBm",
    weakest: "Weakest room Office -74 dBm Weak",
    spot: "Tap or click a spot on the map to read it.",
    rooms: ["Office -74 dBm Weak", "Kitchen -52 dBm Strong"],
  });
  const canvas = panel.locator(".scene-canvas");
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Four readings lie within reach of any spot inside a room, each counted twice.
  await expect.poll(async () => (await legend(panel)).spot).toMatch(/^Selected spot -62 dBm Good \d+ readings 3 days ago$/u);
  await page.screenshot({ path: test.info().outputPath("wifi-legend.png") });

  await clickInShadow(panel, "[aria-controls=map-options]");
  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => legend(panel)).toBeNull();
});

test("the legend fits a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await mountPanel(page, SURVEY, "packaged");
  await clickInShadow(panel, "[aria-controls=map-options]");
  await expect.poll(() => wifiRow(panel)).not.toBeNull();
  await clickInShadow(panel, "[data-wifi-signal]");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await legend(panel))?.inside).toBe(true);
  await page.screenshot({ path: test.info().outputPath("wifi-legend-mobile.png") });
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
    status: "ready", surveying: true, cells: [], rooms: [],
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
    status: "ready", surveying: true, cells: [], rooms: [],
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

test("the renderer paints the surface on the live floor only, over room colours", async ({ page }) => {
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
    const painted = [];
    // The fallback raster redraws the overlay as each chunk lands, so keep the newest draw only.
    const clearRect = context.clearRect.bind(context);
    context.clearRect = (...args) => { painted.length = 0; return clearRect(...args); };
    const fill = context.fill.bind(context);
    context.fill = (...args) => { painted.push(String(context.fillStyle)); return fill(...args); };
    const drawImage = context.drawImage.bind(context);
    // The surface is drawn tile by tile from a canvas the size of its texture.
    context.drawImage = (image, ...args) => {
      if (image instanceof HTMLCanvasElement && image !== overlay && image.width < 720 && args.length === 8) painted.push("surface");
      return drawImage(image, ...args);
    };
    let status = "idle";
    const renderer = new RendererController(scene, overlay, {
      onModuleStatus: (module, next) => { if (module === "renderer-layers") status = next; },
    });
    const initial = createGalleryState("ready");
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const wifiSignal = parseWifiSignal(survey);
    const run = async (patch) => {
      painted.length = 0;
      renderer.setState({ ...initial, wifiSignal, ...patch });
      for (let attempt = 0; attempt < 120 && status !== "ready"; attempt += 1) await frame();
      renderer.requestRender();
      await frame();
      return painted.splice(0);
    };
    const live = (await run({})).filter((value) => value === "surface").length;
    const history = (await run({ dataMode: "history" })).includes("surface");
    const retained = (await run({ floor: { ...initial.floor, readOnly: true } })).includes("surface");
    const rooms = await run({ view: "top", appearance: "rooms" });
    renderer.dispose();
    return { live, history, retained, cellsAbove: rooms.indexOf("surface") > rooms.findLastIndex((value) => / 0\.94\)$/u.test(value)) };
  }, COVERED);
  expect(result.live).toBeGreaterThan(0);
  expect(result.history).toBe(false);
  // A retained read-only scene waits for the live one before readings draw.
  expect(result.retained).toBe(false);
  // Room colors fill rooms at 94% opacity; the surface must paint over them.
  expect(result.cellsAbove).toBe(true);
});
