import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const entry = (entryId, slug, key) => ({
  entry_id: entryId,
  scene_url: `/api/matic_robot/slam_scene/${slug}`,
  delta_url: null,
  pose_url: `/api/matic_robot/slam_pose/${slug}`,
  history_url: `/api/matic_robot/slam_history/${slug}`,
  areas_url: `/api/matic_robot/areas/${slug}`,
  plans_url: `/api/matic_robot/plans/${slug}`,
  map_revision: 7,
  map_floor_coherent: true,
  map_session_verified: true,
  map_session_key: key.repeat(64),
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

async function mountPanel(page) {
  const entryA = entry("synthetic-entry", "synthetic", "a");
  const entryB = entry("synthetic-entry-b", "synthetic-b", "b");
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialCatalogEntries: [entryA, entryB],
    initialRobotStates: {
      "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: entryA.entry_id } },
      "vacuum.synthetic_b": { state: "docked", attributes: { matic_entry_id: entryB.entry_id } },
    },
  });
  const panel = page.locator(fixture.panelTag);
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    panel.panel = { ...panel.panel, config: { entry_id: "synthetic-entry" } };
    document.body.append(panel);
  });
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.entry?.entryId ?? null];
  })).toEqual(["synthetic-entry", "synthetic-entry"]);
  return { fixture, panel };
}

test("@safety reused panel follows a changed host-configured entry while selection source is host", async ({ page }) => {
  const { panel } = await mountPanel(page);

  await panel.evaluate((element) => {
    element.panel = { ...element.panel, config: { entry_id: "synthetic-entry-b" } };
    // A same-turn host refresh exercises the reentrant property update path.
    element.hass = { ...element.hass };
  });

  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.selection.entrySource, state.resources.entry?.entryId ?? null];
  })).toEqual(["synthetic-entry-b", "host", "synthetic-entry-b"]);
});

test("@safety pending user selection stays authoritative across a host-config refresh", async ({ page }) => {
  const { fixture, panel } = await mountPanel(page);
  await page.evaluate(() => window.__panelFixture.deferNextCatalog());
  await panel.locator("select.robot-switcher").selectOption("synthetic-entry-b");
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingCatalogCount())).toBe(1);
  await expect.poll(() => panel.evaluate((element) => {
    const { selection } = element.getWorkspaceSnapshot();
    return [selection.entryId, selection.entrySource];
  })).toEqual(["synthetic-entry-b", "user"]);

  await panel.evaluate((element) => {
    element.panel = { ...element.panel, config: { entry_id: "synthetic-entry" } };
    element.hass = { ...element.hass };
  });
  await page.evaluate(() => window.__panelFixture.releaseCatalog());

  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.selection.entrySource, state.resources.entry?.entryId ?? null];
  })).toEqual(["synthetic-entry-b", "user", "synthetic-entry-b"]);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
  expect(await page.evaluate(() => window.__panelFixture.catalogReads)).toBeGreaterThan(1);
});
