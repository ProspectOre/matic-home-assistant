import { expect, test } from "@playwright/test";
import { build } from "esbuild";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// The Wi-Fi signal layer is off by default. Map options turns it on, which
// reads the current floor's survey; the row explains an empty survey.

const SURVEY = {
  enabled: true,
  cell_size: 0.5,
  cells: [
    { x: 0.75, y: 0.75, dbm: -48, samples: 3, updated_at: 1 },
    { x: 1.25, y: 0.75, dbm: -88, samples: 1, updated_at: 1 },
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

const mountPanel = async (page, wifiSignal) => {
  const { panelTag } = await installPanelFixture(page, { wifiSignal });
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
  await clickInShadow(panel, "[aria-controls=map-options]");
  await expect.poll(() => wifiRow(panel)).toEqual({ checked: "false", text: "Wi-Fi signal" });

  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toEqual({
    status: "ready",
    surveying: true,
    cellSize: 0.5,
    cells: [{ x: 0.75, y: 0.75, dbm: -48 }, { x: 1.25, y: 0.75, dbm: -88 }],
  });
  await expect.poll(() => wifiRow(panel)).toEqual({ checked: "true", text: "Wi-Fi signal Green is strong, red is weak" });

  await clickInShadow(panel, "[data-wifi-signal]");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().wifiSignal)).toBeNull();
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
  const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state"; export { parseWifiSignal } from "./frontend/map-studio-v4/wifi-signal";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
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
    const style = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "fillStyle");
    Object.defineProperty(context, "fillStyle", {
      get() { return style.get.call(this); },
      set(value) { if (String(value).startsWith("hsl(")) fills.push(value); style.set.call(this, value); },
    });
    const renderer = new RendererController(scene, overlay);
    const initial = createGalleryState("ready");
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const wifiSignal = parseWifiSignal(survey);
    renderer.setState({ ...initial, wifiSignal });
    await frame();
    const live = fills.splice(0);
    renderer.setState({ ...initial, wifiSignal, dataMode: "history" });
    await frame();
    const history = fills.splice(0);
    renderer.dispose();
    const rejected = [
      { enabled: "yes", cell_size: 0.5, cells: [] },
      { enabled: true, cell_size: 0.5, cells: [{ x: 0, y: 0, dbm: 3 }] },
      { enabled: true, cell_size: 0, cells: [] },
      { enabled: true, cell_size: 0.5, cells: [null] },
      null,
    ].map((value) => { try { parseWifiSignal(value); return false; } catch { return true; } });
    return { live, history, rejected };
  }, SURVEY);
  // -48 dBm is past the strong end of the scale and -88 past the weak end.
  expect(result.live).toEqual(["hsl(120 75% 45% / .45)", "hsl(0 75% 45% / .45)"]);
  expect(result.history).toEqual([]);
  expect(result.rejected).toEqual([true, true, true, true, true]);
});
