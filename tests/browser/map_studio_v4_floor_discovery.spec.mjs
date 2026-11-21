import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// The catalog row of one robot in a home with `floors` floors, on `floor`.
const entry = (floors, floor = 1) => ({
  entry_id: "synthetic-entry",
  scene_url: "/api/matic_robot/slam_scene/synthetic",
  history_url: "/api/matic_robot/slam_history/synthetic",
  areas_url: "/api/matic_robot/areas/synthetic",
  plans_url: "/api/matic_robot/plans/synthetic",
  map_revision: 7,
  map_floor_coherent: true,
  map_session_verified: true,
  map_session_key: (floor === 1 ? "a" : "c").repeat(64),
  map_complete: true,
  map_truncated: false,
  selected_floor_ordinal: floor,
  map_floor_ordinal: floor,
  history_count: 1,
  history_floor_count: floors,
  map_health: "ready",
  stream_failures: 0,
  bootstrap_state: "complete",
  bootstrap_photo_seen: true,
  bootstrap_structure_seen: true,
  bootstrap_failures: 0,
  runner_locked: false,
  stop_settle_pending: false,
  active_plan: false,
  native_reconciliation_pending: false,
  native_session_active: false,
});

const mount = async (page, floors, { beforeMount = () => undefined } = {}) => {
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialCatalogEntries: [entry(floors)] });
  await page.evaluate(beforeMount);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  return page.locator(fixture.panelTag);
};
const snapshot = (panel, read) => panel.evaluate((element, source) =>
  new Function("state", `return ${source}`)(element.getWorkspaceSnapshot()), read);
const historyReads = (page) => page.evaluate(() => window.__panelFixture.historyReads);
const floorOptions = (panel) => panel.locator("select.floor-switcher option");
const listed = async (panel) => {
  await expect(floorOptions(panel)).toHaveText(["Home", "Loft"]);
  await expect.poll(() => snapshot(panel, "state.resources.history.status")).toBe("ready");
};

test("a home with several floors lists them once the live map shows, without opening Map history", async ({ page }) => {
  const panel = await mount(page, 2, { beforeMount: () => window.__panelFixture.deferNextSceneRead() });
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingSceneReadCount())).toBe(1);
  // The floor list waits for the first map, however slow it is.
  await expect.poll(() => snapshot(panel, "state.optionalUiReady"), { timeout: 8_000 }).toBe(true);
  expect(await snapshot(panel, "[state.map.available, state.resources.history.status]")).toEqual([false, "idle"]);
  expect(await historyReads(page)).toBe(0);

  await page.evaluate(() => window.__panelFixture.releaseSceneRead());
  await listed(panel);
  await expect(panel.locator("select.floor-switcher")).toBeEnabled();
  await expect(panel.locator("select.floor-switcher")).toHaveValue("current");
  expect(await snapshot(panel, "[state.workflow, state.dataMode, state.floor.displayName]")).toEqual(["none", "live", "Home"]);
  expect(await historyReads(page)).toBe(1);
  // No saved map was read to learn the floors.
  expect(await page.evaluate(() => window.__panelFixture.pendingHistoryScenes.length)).toBe(0);
});

test("a home with one floor never reads the floor list for the live map", async ({ page }) => {
  const panel = await mount(page, 1);
  await expect.poll(() => snapshot(panel, "state.map.available && state.optionalUiReady")).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.openSubscriptions)).toBeGreaterThan(0);
  await page.evaluate(() => window.__panelFixture.announceHistory());
  // One catalog poll passes as well.
  const catalogReads = await page.evaluate(() => window.__panelFixture.catalogReads);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.catalogReads), { timeout: 8_000 }).toBeGreaterThan(catalogReads);
  expect(await historyReads(page)).toBe(0);
  expect(await snapshot(panel, "state.resources.history.status")).toBe("idle");
  await expect(floorOptions(panel)).toHaveCount(1);
  await expect(panel.locator("select.floor-switcher")).toBeDisabled();
});

test("a pushed saved-map change refreshes the floor list in place", async ({ page }) => {
  const panel = await mount(page, 2);
  await listed(panel);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.openSubscriptions)).toBeGreaterThan(0);
  const generation = await snapshot(panel, "state.generation");

  await page.evaluate(() => {
    const history = window.__panelFixture.getHistory();
    history.floors[1].snapshots = [];
    window.__panelFixture.setHistory(history);
    window.__panelFixture.announceHistory();
  });
  await expect(floorOptions(panel)).toHaveText(["Home", "Loft · No saved map for this floor yet"]);
  expect(await historyReads(page)).toBe(2);
  expect(await snapshot(panel, "state.generation")).toBe(generation);
  // Nothing reads the list again until the next change.
  const catalogReads = await page.evaluate(() => window.__panelFixture.catalogReads);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.catalogReads), { timeout: 8_000 }).toBeGreaterThan(catalogReads);
  expect(await historyReads(page)).toBe(2);
});

test("the live view follows the robot to another floor and names it", async ({ page }) => {
  const panel = await mount(page, 2);
  await listed(panel);
  const generation = await snapshot(panel, "state.generation");

  await page.evaluate((moved) => {
    const history = window.__panelFixture.getHistory();
    const [home, loft] = history.floors;
    window.__panelFixture.setHistory({ ...history, floors: [
      { ...loft, id: "current", active: true, read_only: false, live_available: true, ordinal: null },
      { ...home, id: "saved-0", active: false, read_only: true, live_available: false, ordinal: 1,
        snapshots: loft.snapshots.map((saved) => ({ ...saved, id: "saved-home" })) },
    ] });
    window.__panelFixture.setCatalogEntries([moved]);
  }, entry(2, 2));
  // The next catalog poll reports the floor the robot is on now.
  await expect(floorOptions(panel)).toHaveText(["Loft", "Home"], { timeout: 8_000 });
  await expect(panel.locator("select.floor-switcher")).toHaveValue("current");
  await expect.poll(() => snapshot(panel,
    "[state.dataMode, state.floor.displayName, state.floor.readOnly, state.resources.scene.value?.source, state.generation > " + generation + "]"))
    .toEqual(["live", "Loft", false, "live", true]);
  expect(await historyReads(page)).toBe(2);
});

test("a floor mapped or removed since the last read updates the list on the next catalog read", async ({ page }) => {
  const panel = await mount(page, 2);
  await listed(panel);
  const generation = await snapshot(panel, "state.generation");

  await page.evaluate((grown) => {
    const history = window.__panelFixture.getHistory();
    history.floors.push({ ...history.floors[1], id: "saved-2", ordinal: 3, label: "Basement", snapshots: [] });
    window.__panelFixture.setHistory(history);
    window.__panelFixture.setCatalogEntries([grown]);
  }, entry(3));
  await expect(floorOptions(panel)).toHaveText(["Home", "Loft", "Basement · No saved map for this floor yet"], { timeout: 8_000 });
  expect(await historyReads(page)).toBe(2);

  await page.evaluate((shrunk) => {
    const history = window.__panelFixture.getHistory();
    history.floors.length = 1;
    window.__panelFixture.setHistory(history);
    window.__panelFixture.setCatalogEntries([shrunk]);
  }, entry(1));
  await expect(floorOptions(panel)).toHaveCount(1, { timeout: 8_000 });
  await expect(panel.locator("select.floor-switcher")).toBeDisabled();
  expect(await snapshot(panel, "state.generation")).toBe(generation);
});

// Fail the first `failures` reads of the floor list.
const failFloorList = (failures) => {
  window.__floorListFailures = failures;
  const { createPanel } = window.__panelFixture;
  window.__panelFixture.createPanel = () => {
    const panel = createPanel();
    const original = panel.hass.fetchWithAuth.bind(panel.hass);
    panel.hass = { ...panel.hass, fetchWithAuth: async (path, ...args) => {
      if (/slam_history\/synthetic$/.test(path) && window.__floorListFailures > 0) {
        window.__floorListFailures -= 1;
        window.__floorListFailed = (window.__floorListFailed ?? 0) + 1;
        return new Response(null, { status: 503 });
      }
      return original(path, ...args);
    } };
    return panel;
  };
};

test("a failed floor list read is tried again without the user", async ({ page }) => {
  await page.addInitScript(() => { window.__floorListFailures = 0; });
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialCatalogEntries: [entry(2)] });
  await page.evaluate(failFloorList, 1);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => window.__floorListFailed)).toBe(1);
  await expect(floorOptions(panel)).toHaveText(["Home", "Loft"], { timeout: 10_000 });
  expect(await historyReads(page)).toBe(1);
});

test("a floor list that keeps failing is read three times, then when Map history opens", async ({ page }) => {
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialCatalogEntries: [entry(2)] });
  await page.evaluate(failFloorList, 3);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => window.__floorListFailed), { timeout: 20_000 }).toBe(3);
  await expect.poll(() => snapshot(panel, "state.resources.history.status")).toBe("error");
  // Two more catalog polls bring no fourth read.
  const catalogReads = await page.evaluate(() => window.__panelFixture.catalogReads);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.catalogReads), { timeout: 15_000 }).toBeGreaterThan(catalogReads + 1);
  expect(await historyReads(page)).toBe(0);
  await expect(floorOptions(panel)).toHaveCount(1);

  await panel.getByRole("button", { name: /^Map history/u }).click();
  await listed(panel);
  expect(await historyReads(page)).toBe(1);
});
