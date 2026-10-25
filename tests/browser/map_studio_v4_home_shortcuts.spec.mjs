import { expect, test } from "@playwright/test";

import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const KEY = "matic_robot_home_shortcuts.synthetic-entry";
const dailyPlan = {
  id: "daily", name: "Daily clean", enabled: true, run_behavior: "intelligent",
  rooms: [{ room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" }],
  room_order: ["room-a"], return_to_base: true, finish_current_room: false,
  finish_current_room_threshold: 50,
};
const PLAN_CATALOG = {
  rooms: [{ room_id: "room-a", name: "Kitchen" }],
  plans: [
    dailyPlan,
    { ...dailyPlan, id: "weekend", name: "Weekend refresh" },
  ],
  selected_plan: "daily",
};
const AREA_CATALOG = {
  scene_url: "/api/matic_robot/slam_scene/synthetic",
  rooms: [],
  areas: [{ id: "entryway", name: "Entryway", circles: [{ x: 0, y: 0, radius: 0.2 }],
    cleaning_mode: "vacuum", coverage_setting: "standard", status: "current", can_rebind: false }],
  selected_area: null,
};
const SAVED_PINS = [{ kind: "plan", id: "daily" }, { kind: "area", id: "entryway" }];
const EXCLUDED_PINS = [{ kind: "plan", id: "weekend" }];

test("Home waits for deferred pins and catalogs before publishing stable wrapped choices", async ({ page }) => {
  const longName = "Daily clean — " + "Kitchen and dining room sequence ".repeat(3);
  const longPlan = { ...dailyPlan, name: longName.slice(0, 128) };
  const fixtureOptions = { initialPlanCatalog: { ...PLAN_CATALOG, plans: [longPlan] }, initialAreasCatalog: AREA_CATALOG,
    userData: { [KEY]: { version: 2, pins: SAVED_PINS, excluded: [] } } };
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", ...fixtureOptions });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => {
    window.__panelFixture.deferNextUserDataRead();
    window.__panelFixture.deferNextPlansRead();
    window.__panelFixture.deferNextAreasRead();
    window.__pinPanel = window.__panelFixture.createPanel();
    document.body.append(window.__pinPanel);
  });
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__pinPanel.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.map.exactPose;
  })).toBe(true);
  await expect(panel.getByRole("status")).toContainText("Loading your saved home choices");
  await expect(panel.locator("button.shortcut")).toHaveCount(0);
  await expect(panel.locator('[aria-label="Cleaning choices"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingUserDataReadCount())).toBe(1);
  await page.evaluate(() => window.__panelFixture.releaseUserDataRead());
  await expect.poll(() => page.evaluate(() => window.__pinPanel.getWorkspaceSnapshot().homePins.status)).toBe("ready");
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingPlanReadCount())).toBe(1);
  await expect(panel.locator("button.shortcut")).toHaveCount(0);
  await page.evaluate(() => window.__panelFixture.releasePlansRead());
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingAreasReadCount())).toBe(1);
  await expect(panel.locator("button.shortcut")).toHaveCount(0);
  await page.evaluate(() => window.__panelFixture.releaseAreasRead());
  await expect.poll(() => page.evaluate(() => window.__pinPanel.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
  await expect.poll(() => page.evaluate(() => window.__pinPanel.getWorkspaceSnapshot().resources.areas.status)).toBe("ready");
  await expect(panel.locator("button.shortcut")).toHaveCount(2);
  const name = panel.locator("button.shortcut .card-name").first();
  await expect(name).toContainText(longPlan.name);
  expect(await name.evaluate((node) => getComputedStyle(node).whiteSpace)).not.toBe("nowrap");
  expect(await name.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(await name.evaluate((node) => node.clientWidth));
  expect(await page.evaluate(() => window.__panelFixture.userDataCalls.length)).toBeGreaterThan(0);
});

test("failed optional pinned catalog leaves other Home choices usable with recovery", async ({ page }) => {
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", initialPlanCatalog: PLAN_CATALOG,
    initialAreasCatalog: AREA_CATALOG, userData: { [KEY]: { version: 2, pins: SAVED_PINS, excluded: [] } } });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => { window.__panelFixture.failNextPlansRead(); window.__pinPanel = window.__panelFixture.createPanel(); document.body.append(window.__pinPanel); });
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__pinPanel.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.map.exactPose;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__pinPanel.getWorkspaceSnapshot().homePins.status)).toBe("ready");
  await expect.poll(() => page.evaluate(() => window.__pinPanel.getWorkspaceSnapshot().resources.plans.status)).toBe("error");
  await expect(panel.locator("button.shortcut")).toHaveCount(1);
  await expect(panel.getByText("Saved plan shortcuts couldn't be loaded.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Clean rooms" })).toBeVisible();
  await panel.getByRole("button", { name: "Open Plans" }).click();
  await expect.poll(() => page.evaluate(() => window.__pinPanel.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
});

for (const kind of ["plan", "area"]) {
  test(`a failed ${kind} catalog keeps recovery visible when no shortcut metadata survives`, async ({ page }) => {
    const fixture = await installPanelFixture(page, { initialPlanCatalog: PLAN_CATALOG, initialAreasCatalog: AREA_CATALOG });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const panel = page.locator(fixture.panelTag), shell = panel.locator("matic-map-shell-v4");
    await expect.poll(() => panel.evaluate(element => element.getWorkspaceSnapshot().coherence)).toBe("current");
    await shell.evaluate((element, kind) => {
      const state = element.state;
      const resource = kind === "plan" ? "plans" : "areas";
      element.state = { ...state,
        homePins: { status: "ready", pins: [{ kind, id: "unavailable" }] },
        resources: { ...state.resources, [resource]: { status: "error", value: null, problem: "synthetic" } },
      };
    }, kind);
    await expect(shell.locator(".home-shortcuts .pins-error")).toContainText(
      kind === "plan" ? "Saved plan shortcuts couldn't be loaded." : "Saved area shortcuts couldn't be loaded.");
    await expect(shell.getByRole("button", { name: kind === "plan" ? "Open Plans" : "Open Areas", exact: true })).toBeVisible();
    await expect(shell.getByRole("group", { name: "Cleaning choices" })).toBeVisible();
  });
}

test("removed pin IDs are reconciled without disturbing surviving shortcut order", async ({ page }) => {
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", initialPlanCatalog: PLAN_CATALOG,
    initialAreasCatalog: AREA_CATALOG, userData: { [KEY]: { version: 2,
      pins: [...SAVED_PINS, { kind: "plan", id: "removed-plan" }, { kind: "area", id: "removed-area" }], excluded: EXCLUDED_PINS } } });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => { window.__pinPanel = window.__panelFixture.createPanel(); document.body.append(window.__pinPanel); });
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__pinPanel.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.map.exactPose
      && state.homePins.status === "ready" && state.resources.plans.status === "ready" && state.resources.areas.status === "ready";
  })).toBe(true);
  await expect(panel.locator('.home-shortcuts button[data-launcher="run:plan:daily"]')).toBeVisible();
  await expect(panel.locator('.home-shortcuts button[data-launcher="run:area:entryway"]')).toBeVisible();
  await expect(panel.locator('.home-shortcuts button[data-launcher="run:plan:removed-plan"]')).toHaveCount(0);
  await expect(panel.locator('.home-shortcuts button[data-launcher="run:area:removed-area"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__panelFixture.userData()["matic_robot_home_shortcuts.synthetic-entry"].pins))
    .toEqual(SAVED_PINS);
});

test("entry change hides the previous entry choices until the new owner's pins settle", async ({ page }) => {
  const a = { entry_id: "synthetic-entry", scene_url: "/api/matic_robot/slam_scene/synthetic", delta_url: null,
    pose_url: "/api/matic_robot/slam_pose/synthetic", history_url: "/api/matic_robot/slam_history/synthetic",
    areas_url: "/api/matic_robot/areas/synthetic", plans_url: "/api/matic_robot/plans/synthetic", map_revision: 7,
    map_floor_coherent: true, map_session_verified: true, map_session_key: "a".repeat(64), map_complete: true,
    map_truncated: false, selected_floor_ordinal: 1, map_floor_ordinal: 1, history_count: 1, history_floor_count: 2,
    map_health: "ready", stream_failures: 0, bootstrap_state: "complete", bootstrap_photo_seen: true,
    bootstrap_structure_seen: true, bootstrap_failures: 0, runner_locked: false, stop_settle_pending: false,
    active_plan: false, native_reconciliation_pending: false, native_session_active: false };
  const b = { ...a, entry_id: "synthetic-entry-b", scene_url: a.scene_url.replace("synthetic", "synthetic-b"),
    pose_url: a.pose_url.replace("synthetic", "synthetic-b"), history_url: a.history_url.replace("synthetic", "synthetic-b"),
    areas_url: a.areas_url.replace("synthetic", "synthetic-b"), plans_url: a.plans_url.replace("synthetic", "synthetic-b"), map_session_key: "b".repeat(64) };
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", initialCatalogEntries: [a, b],
    initialRobotStates: { "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: a.entry_id } },
      "vacuum.synthetic_b": { state: "docked", attributes: { matic_entry_id: b.entry_id } } },
    initialPlanCatalog: PLAN_CATALOG, initialAreasCatalog: AREA_CATALOG,
    userData: { [KEY]: { version: 2, pins: SAVED_PINS, excluded: EXCLUDED_PINS },
      "matic_robot_home_shortcuts.synthetic-entry-b": { version: 2, pins: [], excluded: [] } } });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => { window.__pinPanel = window.__panelFixture.createPanel(); document.body.append(window.__pinPanel); });
  const panel = page.locator(fixture.panelTag);
  const selector = panel.locator("select.robot-switcher");
  await expect.poll(() => page.evaluate(() => {
    const state = window.__pinPanel.getWorkspaceSnapshot();
    return state.selection.entryId === "synthetic-entry" && state.homePins.status === "ready"
      && state.resources.plans.status === "ready" && state.resources.areas.status === "ready";
  })).toBe(true);
  await expect(panel.locator(".home-shortcuts button[data-launcher^='run:']")).toHaveCount(2);
  await page.evaluate(() => window.__panelFixture.deferNextUserDataRead());
  await selector.selectOption("synthetic-entry-b");
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingUserDataReadCount())).toBe(1);
  await expect(panel.getByText("Loading your saved home choices…")).toBeVisible();
  await expect(panel.locator(".home-shortcuts button[data-launcher^='run:']")).toHaveCount(0);
  await page.evaluate(() => window.__panelFixture.releaseUserDataRead());
  await expect.poll(() => page.evaluate(() => {
    const state = window.__pinPanel.getWorkspaceSnapshot();
    return state.selection.entryId === "synthetic-entry-b" && state.homePins.status === "ready"
      && !state.homePins.pins.some((pin) => pin.kind === "area" && pin.id === "entryway");
  })).toBe(true);
  await expect(panel.locator(".home-shortcuts button[data-launcher='run:area:entryway']")).toHaveCount(0);
});

test("same entry recovery restores the saved home shortcuts without writing user data", async ({ page }) => {
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialPlanCatalog: PLAN_CATALOG,
    initialAreasCatalog: AREA_CATALOG,
    userData: { [KEY]: { version: 2, pins: SAVED_PINS, excluded: EXCLUDED_PINS } },
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => {
    window.__pinPanel = window.__panelFixture.createPanel();
    document.body.append(window.__pinPanel);
  });
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__pinPanel.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.map.exactPose;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__pinPanel.getWorkspaceSnapshot().homePins))
    .toEqual({ status: "ready", pins: SAVED_PINS });
  await expect(panel.getByRole("heading", { level: 3, name: "Shortcuts" })).toBeVisible();
  await expect(panel.locator("button.shortcut")).toHaveCount(2);

  const baseline = await page.evaluate(() => ({
    userDataCalls: window.__panelFixture.userDataCalls.length,
    serviceCalls: window.__panelFixture.serviceCalls.length,
  }));
  expect(baseline.userDataCalls).toBe(1);

  // Mirror an integration reload while the panel remains mounted: the robot
  // temporarily has no entry in the coordinator catalog or HA state.
  await page.evaluate(() => {
    window.__panelFixture.setCatalogEntries([]);
    const { hass } = window.__pinPanel;
    window.__pinPanel.hass = { ...hass, states: {} };
  });
  await expect.poll(() => page.evaluate(() => window.__pinPanel.getWorkspaceSnapshot().homePins.status)).toBe("idle");
  await expect(panel.getByRole("heading", { level: 3, name: "Shortcuts" })).toHaveCount(0);

  // The same entry and catalog return without reloading the page.
  await page.evaluate(() => {
    const entry = {
      entry_id: "synthetic-entry", scene_url: "/api/matic_robot/slam_scene/synthetic", delta_url: null,
      pose_url: "/api/matic_robot/slam_pose/synthetic", history_url: "/api/matic_robot/slam_history/synthetic",
      areas_url: "/api/matic_robot/areas/synthetic", plans_url: "/api/matic_robot/plans/synthetic",
      map_revision: 7, map_floor_coherent: true, map_session_verified: true, map_session_key: "a".repeat(64),
      map_complete: true, map_truncated: false, selected_floor_ordinal: 1, map_floor_ordinal: 1,
      history_count: 1, history_floor_count: 2, map_health: "ready", stream_failures: 0,
      bootstrap_state: "complete", bootstrap_photo_seen: true, bootstrap_structure_seen: true,
      bootstrap_failures: 0, runner_locked: false, stop_settle_pending: false, active_plan: false,
      native_reconciliation_pending: false, native_session_active: false,
    };
    window.__panelFixture.setCatalogEntries([entry]);
    const { hass } = window.__pinPanel;
    window.__pinPanel.hass = { ...hass, states: {
      "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry" } },
    } };
  });

  await expect.poll(() => page.evaluate(() => window.__pinPanel.getWorkspaceSnapshot().homePins))
    .toEqual({ status: "ready", pins: SAVED_PINS });
  await expect(panel.getByRole("heading", { level: 3, name: "Shortcuts" })).toBeVisible();
  await expect(panel.locator("button.shortcut")).toHaveCount(2);
  expect(await page.evaluate(() => window.__panelFixture.userDataCalls.filter((call) => call.type === "frontend/get_user_data").length)).toBe(2);
  expect(await page.evaluate(() => window.__panelFixture.userDataCalls.filter((call) => call.type === "frontend/set_user_data").length)).toBe(0);
  expect(await page.evaluate(() => window.__panelFixture.userData()["matic_robot_home_shortcuts.synthetic-entry"]))
    .toEqual({ version: 2, pins: SAVED_PINS, excluded: EXCLUDED_PINS });
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(baseline.serviceCalls);
});
