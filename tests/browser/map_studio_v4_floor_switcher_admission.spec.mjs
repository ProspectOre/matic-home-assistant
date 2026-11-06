import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const entry = (historyFloorCount) => ({
  entry_id: "synthetic-entry",
  scene_url: "/api/matic_robot/slam_scene/synthetic",
  delta_url: null,
  pose_url: "/api/matic_robot/slam_pose/synthetic",
  history_url: "/api/matic_robot/slam_history/synthetic",
  areas_url: "/api/matic_robot/areas/synthetic",
  plans_url: "/api/matic_robot/plans/synthetic",
  map_revision: 7,
  map_floor_coherent: true,
  map_session_verified: true,
  map_session_key: "a".repeat(64),
  map_complete: true,
  map_truncated: false,
  selected_floor_ordinal: 1,
  map_floor_ordinal: 1,
  history_count: 1,
  history_floor_count: historyFloorCount,
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

const mountPanel = async (page, options = {}) => {
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", ...options });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  return { fixture, panel: page.locator(fixture.panelTag) };
};

test("a multi-floor home discovers floors from the main toolbar after live map admission", async ({ page }) => {
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialCatalogEntries: [entry(2)] });
  await page.evaluate(() => window.__panelFixture.deferNextSceneRead());
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingSceneReadCount())).toBe(1);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(false);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().resources.history.status)).toBe("idle");
  await page.evaluate(() => window.__panelFixture.releaseSceneRead());
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.history.status)).toBe("ready");
  const selector = panel.locator("select.floor-switcher");
  await expect(selector).toBeVisible();
  await expect(selector.locator("option")).toHaveText(["Home", "Loft"]);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("none");
  expect(await page.evaluate(() => window.__panelFixture.pendingHistoryScenes.length)).toBe(0);
});

test("single-floor homes keep saved-floor metadata lazy", async ({ page }) => {
  const { panel } = await mountPanel(page, { initialCatalogEntries: [entry(1)] });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.history.status)).toBe("idle");
  await expect(panel.locator("select.floor-switcher")).toHaveCount(1);
  await expect(panel.locator("select.floor-switcher option")).toHaveCount(1);
});

test("the toolbar can return to Current after a saved floor scene fails", async ({ page }) => {
  const { panel } = await mountPanel(page, { historySceneStatus: 503 });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.history.status)).toBe("ready");
  const selector = panel.locator("select.floor-switcher");
  await expect(selector).toBeVisible();
  await selector.selectOption("saved-1");
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.dataMode, state.selection.floorId, state.resources.scene.status];
  })).toEqual(["history", "saved-1", "error"]);

  await expect(selector).toBeVisible();
  await selector.selectOption("current");
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.dataMode, state.selection.floorId, state.resources.scene.status, state.map.available];
  })).toEqual(["live", "current", "ready", true]);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.value?.source)).toBe("live");
});

test("floor metadata follows each selected robot after first-map admission", async ({ page }) => {
  const entryA = entry(2);
  const entryB = {
    ...entryA,
    entry_id: "synthetic-entry-b",
    scene_url: entryA.scene_url.replace("/synthetic", "/synthetic-b"),
    pose_url: entryA.pose_url.replace("/synthetic", "/synthetic-b"),
    history_url: entryA.history_url.replace("/synthetic", "/synthetic-b"),
    areas_url: entryA.areas_url.replace("/synthetic", "/synthetic-b"),
    plans_url: entryA.plans_url.replace("/synthetic", "/synthetic-b"),
    map_session_key: "b".repeat(64),
  };
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialCatalogEntries: [entryA, entryB],
    initialRobotStates: {
      "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry" } },
      "vacuum.synthetic_b": { state: "docked", attributes: { matic_entry_id: "synthetic-entry-b" } },
    },
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const robotSelector = panel.locator("select.robot-switcher");
  const floorSelector = panel.locator("select.floor-switcher");

  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.map.available && state.resources.history.value?.entryId;
  })).toBe("synthetic-entry");
  await expect(floorSelector.locator("option")).toHaveText(["Home", "Loft"]);

  await robotSelector.selectOption("synthetic-entry-b");
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.map.available && state.resources.history.value?.entryId;
  })).toBe("synthetic-entry-b");
  await expect(floorSelector.locator("option")).toHaveText(["Home", "Loft"]);

  await robotSelector.selectOption("synthetic-entry");
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.map.available && state.resources.history.value?.entryId;
  })).toBe("synthetic-entry");
  await expect(floorSelector.locator("option")).toHaveText(["Home", "Loft"]);
});
