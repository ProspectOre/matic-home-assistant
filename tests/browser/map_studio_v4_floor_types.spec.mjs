import { expect, test } from "@playwright/test";
import { build } from "esbuild";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// Carpet and vents are off by default. Map options turns the layer on, which
// reads the current floor's outlines; the row explains an empty floor.

const RUG = [[0.3, 0.3], [1.2, 0.3], [1.2, 0.9], [0.3, 0.9]];
const HOLE = [[0.6, 0.45], [0.6, 0.6], [0.75, 0.6], [0.75, 0.45]];
const VENT = [[1.5, 0.3], [1.8, 0.3], [1.8, 0.42], [1.5, 0.42]];
const LAYERS = { entry_id: "synthetic", page_count: 4, truncated: false, layers: { carpet: [RUG, HOLE], vent: [VENT] } };

const findInShadow = (panel, selector) => panel.evaluate((element, target) => {
  const scan = (root) => {
    const match = root.querySelector(target);
    if (match) return match;
    for (const child of root.querySelectorAll("*")) {
      const found = child.shadowRoot && scan(child.shadowRoot);
      if (found) return found;
    }
    return null;
  };
  const row = scan(element.shadowRoot);
  return row && { checked: row.getAttribute("aria-checked"), text: row.innerText.replace(/\s+/gu, " ").trim() };
}, selector);

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

const mountPanel = async (page, floorTypes) => {
  const { panelTag } = await installPanelFixture(page, { floorTypes });
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

const snapshot = (panel) => panel.evaluate((element) => element.getWorkspaceSnapshot().floorTypes);

test("Map options turns on carpet and vents and reads the outlines", async ({ page }) => {
  const panel = await mountPanel(page, LAYERS);
  await clickInShadow(panel, "[aria-controls=map-options]");
  await expect.poll(() => findInShadow(panel, "[data-floor-types]")).toEqual({ checked: "false", text: "Carpet and vents" });

  await clickInShadow(panel, "[data-floor-types]");
  await expect.poll(() => snapshot(panel)).toEqual({ status: "ready", carpet: [RUG, HOLE], vent: [VENT] });
  await expect.poll(() => findInShadow(panel, "[data-floor-types]")).toEqual({
    checked: "true", text: "Carpet and vents Brown is carpet, blue is a vent",
  });

  await clickInShadow(panel, "[data-floor-types]");
  await expect.poll(() => snapshot(panel)).toBeNull();
});

test("the layer picks up new outlines while it stays on", async ({ page }) => {
  await page.clock.install();
  const panel = await mountPanel(page, { ...LAYERS, layers: { carpet: [], vent: [] } });
  await clickInShadow(panel, "[aria-controls=map-options]");
  await clickInShadow(panel, "[data-floor-types]");
  await expect.poll(() => findInShadow(panel, "[data-floor-types]")).toEqual({
    checked: "true", text: "Carpet and vents None mapped yet · the robot finds them while cleaning",
  });

  await page.evaluate((layers) => { window.__floorTypesReply = layers; }, LAYERS);
  await page.clock.fastForward(60_000);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().floorTypes?.carpet.length)).toBe(2);
});

test("a new map session drops the old frame's outlines", async ({ page }) => {
  await page.clock.install();
  const panel = await mountPanel(page, LAYERS);
  await clickInShadow(panel, "[aria-controls=map-options]");
  await clickInShadow(panel, "[data-floor-types]");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().floorTypes?.carpet.length)).toBe(2);

  await panel.evaluate(async (element) => {
    const { entries } = await (await element.hass.fetchWithAuth("/api/matic_robot/slam_entries")).json();
    window.__panelFixture.setCatalogEntries(entries.map((entry) => ({ ...entry, map_session_key: "c".repeat(64) })));
    window.__floorTypesReply = { entry_id: "synthetic", page_count: 0, truncated: false, layers: { carpet: [], vent: [] } };
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-action", {
      detail: { id: "recheck-status" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => snapshot(panel)).toEqual({ status: "ready", carpet: [], vent: [] });
});

test("the row stays hidden without the endpoint", async ({ page }) => {
  const panel = await mountPanel(page, null);
  await clickInShadow(panel, "[aria-controls=map-options]");
  await expect.poll(() => panel.evaluate((element) => Boolean(element.shadowRoot))).toBe(true);
  expect(await findInShadow(panel, "[data-floor-types]")).toBeNull();
});

test("renderer fills carpet even-odd and vents on the live floor only", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state"; export { parseFloorTypes } from "./frontend/map-studio-v4/floor-types";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/floor-renderer.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async (layers) => {
    const { RendererController, createGalleryState, parseFloorTypes } = await import("/floor-renderer.js");
    const scene = document.createElement("canvas"), overlay = document.createElement("canvas");
    for (const canvas of [scene, overlay]) {
      Object.assign(canvas.style, { position: "absolute", width: "720px", height: "540px" });
      document.body.append(canvas);
    }
    const context = overlay.getContext("2d");
    const fills = [];
    const fill = context.fill.bind(context);
    context.fill = (...args) => {
      if (args[0] === "evenodd") fills.push(String(context.fillStyle));
      return fill(...args);
    };
    const renderer = new RendererController(scene, overlay);
    const initial = createGalleryState("ready");
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const floorTypes = parseFloorTypes(layers);
    renderer.setState({ ...initial, floorTypes });
    await frame();
    const live = fills.splice(0);
    renderer.setState({ ...initial, floorTypes, dataMode: "history" });
    await frame();
    const history = fills.splice(0);
    renderer.setState({ ...initial, floorTypes, floor: { ...initial.floor, readOnly: true } });
    await frame();
    const retained = fills.splice(0);
    renderer.dispose();
    const triangle = [[0, 0], [1, 0], [0, 1]];
    const rejected = [
      null,
      { layers: null },
      { layers: { carpet: [], vent: null } },
      { layers: { carpet: [[[0, 0], [1, 0]]], vent: [] } },
      { layers: { carpet: [[[0, 0], [1, "0"], [0, 1]]], vent: [] } },
      { layers: { carpet: Array.from({ length: 13_334 }, () => triangle), vent: [] } },
    ].map((value) => { try { parseFloorTypes(value); return false; } catch { return true; } });
    return { live, history, retained, rejected };
  }, LAYERS);
  // The canvas reports the hsl() colours as hex.
  expect(result.live).toHaveLength(2);
  expect(result.history).toEqual([]);
  expect(result.retained).toEqual([]);
  expect(result.rejected).toEqual([true, true, true, true, true, true]);
});
