import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const entry = (id, slug, session) => ({
  entry_id: id,
  scene_url: `/api/matic_robot/slam_scene/${slug}`,
  delta_url: null,
  history_url: `/api/matic_robot/slam_history/${slug}`,
  areas_url: `/api/matic_robot/areas/${slug}`,
  plans_url: `/api/matic_robot/plans/${slug}`,
  map_revision: 7,
  map_floor_coherent: true,
  map_session_verified: true,
  map_session_key: session.repeat(64),
  map_complete: true,
  map_truncated: false,
  selected_floor_ordinal: 1,
  map_floor_ordinal: 1,
  history_count: 1,
  history_floor_count: 2,
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

const entries = [
  entry("synthetic-entry", "synthetic", "a"),
  entry("synthetic-entry-b", "synthetic-b", "b"),
  // The fixture maps both non-primary entries to its second synthetic data
  // source. Distinct session keys still exercise per-entry workspace identity.
  entry("synthetic-entry-c", "synthetic-b", "c"),
];

const robotStates = Object.fromEntries(entries.map((item, index) => [
  `vacuum.robot_${String.fromCharCode(97 + index)}`,
  { state: index ? "docked" : "idle", attributes: { matic_entry_id: item.entry_id } },
]));

test("three robot identities keep floor and saved-map selection isolated across large catalogs and stale responses", async ({ page }) => {
  const largeRooms = Array.from({ length: 250 }, (_, index) => ({
    id: `scene-room-${index}`,
    name: `Room ${index}`,
    center: [index * 3, index * 2],
    boundary: [[index, index], [index + 1, index], [index + 1, index + 1], [index, index + 1]],
  }));
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialCatalogEntries: entries,
    initialRobotStates: robotStates,
    sceneRooms: largeRooms,
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const selector = panel.locator("select.robot-switcher");
  await expect(selector.locator("option")).toHaveCount(3);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);

  // Select a saved floor and its snapshot, then ensure entry changes clear the
  // old selection and do not let it leak into another robot's workspace.
  await panel.evaluate((element) => element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(
    new CustomEvent("matic-workspace-intent", { detail: { type: "open-workflow", workflow: "history" }, bubbles: true, composed: true }),
  ));
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.history.status)).toBe("ready");
  await panel.evaluate((element) => element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(
    new CustomEvent("matic-workspace-intent", { detail: { type: "set-history", historyId: "saved-shot" }, bubbles: true, composed: true }),
  ));
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.selection.floorId, state.selection.historyId, state.dataMode];
  })).toEqual(["synthetic-entry", "saved-1", "saved-shot", "history"]);

  await page.evaluate(() => window.__panelFixture.deferNextCatalog());
  await selector.selectOption("synthetic-entry-b");
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingCatalogCount())).toBe(1);
  await selector.selectOption("synthetic-entry-c");
  await page.evaluate(() => window.__panelFixture.releaseCatalog());
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.entry?.entryId ?? null, state.selection.floorId, state.selection.historyId];
  })).toEqual(["synthetic-entry-c", "synthetic-entry-c", "current", null]);

  await selector.selectOption("synthetic-entry");
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.entry?.entryId ?? null, state.selection.floorId, state.selection.historyId];
  })).toEqual(["synthetic-entry", "synthetic-entry", "current", null]);
  // Entry selection and the scene request settle independently. Require the
  // selected robot's scene to finish loading before asserting its room count.
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.entry?.entryId ?? null,
      state.resources.scene.status, state.resources.scene.value?.metadata.rooms.length ?? 0];
  })).toEqual(["synthetic-entry", "synthetic-entry", "ready", 250]);
});
