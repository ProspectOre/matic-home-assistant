import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const coverage = { active: true, map_session_key: "a".repeat(64), cell_size: 0.015, truncated: true,
  coverage_basis: "observed_changes", runs: [[2, 3, 4, 1], [7, 5, 2, 2]] };

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
  return match?.getAttribute("aria-pressed") ?? null;
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
  const vacuum = panel.locator('button[data-map-layer="vacuum"]');
  await expect(vacuum).toHaveCount(1);
  await expect(vacuum).toHaveAttribute("aria-disabled", "false");
  await expect.poll(() => inShadow(panel, '[data-map-layer="vacuum"]')).toBe("true");
  await expect.poll(() => inShadow(panel, '[data-map-layer="mop"]')).toBe("true");
  await vacuum.click();
  await expect.poll(() => inShadow(panel, '[data-map-layer="vacuum"]')).toBe("false");
  await expect.poll(() => inShadow(panel, '[data-map-layer="mop"]')).toBe("true");
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
  await expect.poll(() => inShadow(panel, '[data-map-layer="mop"]')).toBe("true");
  await expect(panel.getByText("Partial coverage. Showing changes observed since live tracking began.")).toBeVisible();
});

test("active coverage identifies its observed changes basis", async ({ page }) => {
  const { panelTag } = await installPanelFixture(page, {
    cleaningCoverage: { ...coverage, truncated: true, coverage_basis: "observed_changes" },
  });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.coverageBasis))
    .toBe("observed_changes");
  await expect.poll(() => inShadow(panel, '[data-map-layer="vacuum"]')).toBe("true");
  await expect(panel.getByText("Partial coverage. Showing changes observed since live tracking began.")).toBeVisible();
});

test("unverified live coverage is hidden with an explanation", async ({ page }) => {
  const { panelTag } = await installPanelFixture(page, { cleaningCoverage: {
    active: true, map_session_key: "a".repeat(64), cell_size: 0.015, runs: [], truncated: true,
    ownership_unverified: true,
  } });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.ownershipUnverified)).toBe(true);
  const mop = panel.locator('button[data-map-layer="mop"]');
  await expect(mop).toHaveAttribute("aria-disabled", "false");
  await expect(mop).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.runs.length)).toBe(0);
  await expect(panel.getByText("Live coverage is hidden until tracking can identify this clean.")).toBeVisible();
  await mop.click();
  await expect(mop).toHaveAttribute("aria-pressed", "false");
  await mop.click();
  await expect(mop).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.runs.length)).toBe(0);
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
      { ...valid, ownership_unverified: true }, { ...valid, ownership_unverified: "yes" },
      { ...valid, coverage_basis: "guess" },
      { ...valid, ownership_unverified: true, coverage_basis: "observed_changes" },
      { ...valid, coverage_basis: "observed_changes", truncated: false },
      { ...valid, coverage_basis: undefined },
      { ...valid, coverage_basis: undefined, truncated: false },
      { ...valid, active: false, map_session_key: undefined, runs: [[1, 1, 1, 1]] },
      { ...valid, active: false, map_session_key: undefined, truncated: true, runs: [], coverage_basis: "observed_changes" },
    ].map((value) => { try { parseCleaningCoverage(value); return false; } catch { return true; } });
  }, coverage);
  expect(rejected).toEqual(Array(16).fill(true));
});

test("an unmarked legacy reply clears previously drawn coverage", async ({ page }) => {
  await page.clock.install();
  const { panelTag } = await installPanelFixture(page, { cleaningCoverage: coverage });
  await page.evaluate(async (tag) => {
    const panel = window.__panelFixture.createPanel();
    document.body.append(panel);
    await customElements.whenDefined(tag);
    await panel.updateComplete;
  }, panelTag);
  const panel = page.locator(panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.runs.length)).toBe(2);
  await page.evaluate(() => { window.__cleaningCoverageReply = {
    active: true, map_session_key: "a".repeat(64), cell_size: 0.015, truncated: false, runs: [[2, 3, 4, 1]],
  }; });
  await page.clock.fastForward(5_000);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage)).toBeNull();
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
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage)).toBeNull();
});

test("a late coverage response cannot enter a new run on the same floor", async ({ page }) => {
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
    window.__cleaningCoverageReply = { active: true, map_session_key: "a".repeat(64), cell_size: 0.015,
      runs: [[8, 8, 1, 2]], truncated: true, coverage_basis: "observed_changes" };
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
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage)).toBeNull();
  await page.evaluate(() => {
    window.__oldCoverageReply = window.__releaseCleaningCoverage;
    window.__releaseCleaningCoverage = null;
  });
  await panel.evaluate(async (element) => {
    const { entries } = await (await element.hass.fetchWithAuth("/api/matic_robot/slam_entries")).json();
    window.__panelFixture.setCatalogEntries(entries.map((entry) => ({ ...entry, native_session_active: true })));
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-action", {
      detail: { id: "recheck-status" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.entry?.nativeSessionActive)).toBe(true);
  await expect.poll(() => page.evaluate(() => typeof window.__releaseCleaningCoverage)).toBe("function");
  await page.evaluate(() => window.__oldCoverageReply());
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage)).toBeNull();
  await page.evaluate(() => {
    window.__cleaningCoverageReply = { active: true, map_session_key: "a".repeat(64), cell_size: 0.015,
      runs: [[9, 9, 2, 1]], truncated: true, coverage_basis: "observed_changes" };
    window.__releaseCleaningCoverage();
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage?.runs)).toEqual([[9, 9, 2, 1]]);
});

test("an ended session revokes coverage during a spatial recovery cooldown @safety", async ({ page }) => {
  const bundle = await build({ stdin: { contents: `
    export { CatalogResources } from "./frontend/map-studio-v4/catalog-resources";
    export { WorkspaceStore, CoherenceMachine } from "./frontend/map-studio-v4/state";
    export { ResourceRequests } from "./frontend/map-studio-v4/resource-requests";
    export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
  `, resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/coverage-cooldown.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { CatalogResources, WorkspaceStore, CoherenceMachine, ResourceRequests, createGalleryState } = await import("/coverage-cooldown.js");
    const initial = createGalleryState("ready");
    const entry = { ...initial.resources.entry, nativeSessionActive: true };
    const store = new WorkspaceStore();
    store.replace({ ...initial, liveCoverage: { active: true, runs: [[1, 1, 1, 1]] },
      resources: { ...initial.resources, entry } });
    const requests = new ResourceRequests();
    const oldRequest = requests.begin("cleaning-coverage");
    let active = false;
    let admissions = 0;
    const catalog = new CatalogResources(store, { catalog: async () => [{ ...entry, nativeSessionActive: active }] },
      new CoherenceMachine(), requests, {
        disposed: () => false, pageActive: () => true, recoveryPending: () => true,
        projection: () => ({ entryKey: entry.entryId, host: { administrator: true, connected: true, robotCount: 1 } }),
        admitSpatial: () => { admissions += 1; }, syncWorkspace: () => {},
      });
    await catalog.refreshCatalog();
    const stopped = { aborted: oldRequest.signal.aborted, layer: store.value.liveCoverage,
      active: store.value.resources.entry.nativeSessionActive };
    active = true;
    await catalog.refreshCatalog();
    return { stopped, admissions, afterRestart: store.value.liveCoverage,
      scenePreserved: store.value.resources.scene.value === initial.resources.scene.value };
  });
  expect(result).toEqual({ stopped: { aborted: true, layer: null, active: false },
    admissions: 0, afterRestart: null, scenePreserved: true });
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
      resources: { entry, scene: { value: null } }, floorTypes: null, wifiSignal: null, coverageModes: 3,
      liveCoverage: { active: true, frameKey: entryCoherenceIdentity(entry), cellSize: .015,
        truncated: true, coverageBasis: "observed_changes", runs: [[2, 3, 4, 1], [7, 5, 2, 2]] } };
    const fills = [];
    const context = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      fill() { fills.push(this.fillStyle); } };
    const draw = (candidate) => { drawMapLayers(context, candidate, (x, y) => ({ x, y })); return fills.splice(0); };
    return [draw(state), draw({ ...state, coverageModes: 1 }), draw({ ...state, dataMode: "history" }),
      draw({ ...state, resources: { ...state.resources, entry: { ...entry, mapSessionKey: "b" } } }),
      draw({ ...state, liveCoverage: { ...state.liveCoverage, ownershipUnverified: true } })];
  });
  expect(result).toEqual([["rgba(41, 142, 239, 0.35)", "rgba(29, 192, 157, 0.38)"],
    ["rgba(41, 142, 239, 0.35)"], [], [], []]);
});
