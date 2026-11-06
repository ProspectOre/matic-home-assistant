import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const coverage = { active: true, map_session_key: "a".repeat(64), cell_size: 0.015, truncated: false, runs: [[2, 3, 4, 1], [7, 5, 2, 2]] };

const inShadow = (panel, selector, click = false) => panel.evaluate((element, { selector, click }) => {
  const find = (root) => {
    const match = root.querySelector(selector);
    if (match) return match;
    for (const child of root.querySelectorAll("*")) {
      const found = child.shadowRoot && find(child.shadowRoot);
      if (found) return found;
    }
    return null;
  };
  const match = find(element.shadowRoot);
  if (click) match?.click();
  return match?.getAttribute("aria-checked") ?? null;
}, { selector, click });

test("live coverage loads and vacuum and mop controls are independent", async ({ page }) => {
  const { panelTag } = await installPanelFixture(page, { cleaningCoverage: coverage });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    panel.dataset.testPanel = "true";
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(`${panelTag}[data-test-panel=true]`);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.runs.length)).toBe(2);
  await inShadow(panel, "[aria-controls=map-options]", true);
  await expect.poll(() => inShadow(panel, "[data-vacuum-coverage]")).toBe("true");
  await expect.poll(() => inShadow(panel, "[data-mop-coverage]")).toBe("true");
  await inShadow(panel, "[data-vacuum-coverage]", true);
  await expect.poll(() => inShadow(panel, "[data-vacuum-coverage]")).toBe("false");
  await expect.poll(() => inShadow(panel, "[data-mop-coverage]")).toBe("true");
});

test("incomplete live coverage is labeled for both cleaning modes", async ({ page }) => {
  const { panelTag } = await installPanelFixture(page, { cleaningCoverage: { ...coverage, truncated: true } });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.truncated)).toBe(true);
  await inShadow(panel, "[aria-controls=map-options]", true);
  await expect(panel.getByText("Coverage may be incomplete.")).toBeVisible();
});

test("coverage parser rejects malformed and unbounded runs", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { parseCleaningCoverage } from "./frontend/map-studio-v4/cleaning-coverage";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/coverage-parser.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const rejected = await page.evaluate(async (valid) => {
    const { parseCleaningCoverage } = await import("/coverage-parser.js");
    return [null, { ...valid, cell_size: 0 }, { ...valid, runs: [[0, 0, 33, 1]] },
      { ...valid, runs: [[0, 0, 1, 4]] }, { ...valid, runs: Array(20_001).fill([0, 0, 1, 1]) },
      { ...valid, map_session_key: null }, { ...valid, map_session_key: "not-a-session" },
    ].map((value) => { try { parseCleaningCoverage(value); return false; } catch { return true; } });
  }, coverage);
  expect(rejected).toEqual([true, true, true, true, true, true, true]);
});

test("coverage from a different map session is cleared until the matching frame returns", async ({ page }) => {
  await page.clock.install();
  const { panelTag } = await installPanelFixture(page, { cleaningCoverage: coverage });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(panelTag);
  const layer = () => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage);
  await expect.poll(async () => (await layer())?.runs.length).toBe(2);
  await page.evaluate(() => { window.__cleaningCoverageReply = { ...window.__cleaningCoverageReply, active: true,
    map_session_key: "b".repeat(64), cell_size: 0.015, truncated: false, runs: [[1, 1, 1, 2]] }; });
  await page.clock.fastForward(5_000);
  await expect.poll(layer).toBeNull();
  await page.evaluate(() => { delete window.__cleaningCoverageReply; });
  await page.clock.fastForward(5_000);
  await expect.poll(async () => (await layer())?.runs.length).toBe(2);
});

test("coverage stays visible during page churn but clears when the session is unavailable", async ({ page }) => {
  await page.clock.install();
  const { panelTag } = await installPanelFixture(page, { cleaningCoverage: coverage });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    panel.dataset.testPanel = "true";
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(`${panelTag}[data-test-panel=true]`);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.runs.length)).toBe(2);
  await page.evaluate(() => { window.__cleaningCoverageStatus = 409; });
  await page.clock.fastForward(5_000);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.runs.length)).toBe(2);
  await page.evaluate(() => { window.__cleaningCoverageStatus = 503; });
  await page.clock.fastForward(5_000);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage)).toBeNull();
});

test("coverage clears when the robot stops its native session", async ({ page }) => {
  await page.clock.install();
  const { panelTag } = await installPanelFixture(page, { cleaningCoverage: coverage });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    panel.dataset.testPanel = "true";
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(`${panelTag}[data-test-panel=true]`);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.runs.length)).toBe(2);
  await panel.evaluate(async (element) => {
    const { entries } = await (await element.hass.fetchWithAuth("/api/matic_robot/slam_entries")).json();
    window.__panelFixture.setCatalogEntries(entries.map((entry) => ({ ...entry, native_session_active: false })));
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-action", {
      detail: { id: "recheck-status" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.entry?.nativeSessionActive)).toBe(false);
  await page.clock.fastForward(5_000);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage)).toBeNull();
});

test("a late coverage response cannot revive an ended session", async ({ page }) => {
  await page.clock.install();
  const { panelTag } = await installPanelFixture(page, { cleaningCoverage: coverage });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    panel.dataset.testPanel = "true";
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(`${panelTag}[data-test-panel=true]`);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.runs.length)).toBe(2);
  await page.evaluate(() => {
    window.__holdCleaningCoverage = true;
    window.__cleaningCoverageReply = { active: true, map_session_key: "a".repeat(64), cell_size: 0.015, runs: [[8, 8, 1, 2]], truncated: false };
  });
  await page.clock.fastForward(5_000);
  await expect.poll(() => page.evaluate(() => typeof window.__releaseCleaningCoverage)).toBe("function");
  await panel.evaluate(async (element) => {
    const { entries } = await (await element.hass.fetchWithAuth("/api/matic_robot/slam_entries")).json();
    window.__panelFixture.setCatalogEntries(entries.map((entry) => ({ ...entry, native_session_active: false })));
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-action", {
      detail: { id: "recheck-status" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.entry?.nativeSessionActive)).toBe(false);
  await page.evaluate(() => window.__releaseCleaningCoverage());
  await page.clock.fastForward(5_000);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage)).toBeNull();
});

test("coverage renders its selected modes only on the matching live frame", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { drawMapLayers } from "./frontend/map-studio-v4/renderer-layers"; export { entryCoherenceIdentity } from "./frontend/map-studio-v4/backend-contracts";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/coverage-renderer.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { drawMapLayers, entryCoherenceIdentity } = await import("/coverage-renderer.js");
    const entry = { entryId: "robot", mapSessionKey: "a", mapFloorCoherent: true,
      mapSessionVerified: true, nativeSessionActive: true };
    const state = { dataMode: "live", floor: { readOnly: false }, selection: { floorId: "current" },
      resources: { entry }, floorTypes: null, wifiSignal: null, coverageModes: 3,
      liveCoverage: { active: true, frameKey: entryCoherenceIdentity(entry), cellSize: .015,
        runs: [[2, 3, 4, 1], [7, 5, 2, 2]] } };
    const fills = [];
    const context = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      fill() { fills.push(this.fillStyle); } };
    const draw = (candidate) => { drawMapLayers(context, candidate, (x, y) => ({ x, y })); return fills.splice(0); };
    return [draw(state), draw({ ...state, coverageModes: 1 }), draw({ ...state, dataMode: "history" }),
      draw({ ...state, resources: { entry: { ...entry, mapSessionKey: "b" } } })];
  });
  expect(result).toEqual([["rgba(41, 142, 239, 0.35)", "rgba(29, 192, 157, 0.38)"],
    ["rgba(41, 142, 239, 0.35)"], [], []]);
});
