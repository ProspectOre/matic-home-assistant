import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

async function openWorkflow(page, workflow) {
  await page.evaluate((selected) => {
    const panel = window.__resourcePanel;
    const shell = panel.shadowRoot.querySelector("matic-map-shell-v4");
    shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "open-workflow", workflow: selected }, bubbles: true, composed: true,
    }));
  }, workflow);
}

async function mountPanelWithFailedRequest(page, resource) {
  await page.evaluate((resource) => {
    const panel = window.__panelFixture.createPanel();
    const original = panel.hass.fetchWithAuth.bind(panel.hass);
    const state = { failed: false, calls: 0, armed: false };
    const suffix = resource === "areas" ? "/areas/synthetic" : "/plans/synthetic";
    panel.hass = {
      ...panel.hass,
      fetchWithAuth: async (path, ...args) => {
        if (path.endsWith(suffix)) {
          if (state.armed) state.calls += 1;
          if (state.armed && !state.failed) {
            state.failed = true;
            return new Response("unavailable", { status: 503 });
          }
        }
        return original(path, ...args);
      },
    };
    window.__resourceRetry = state;
    window.__resourcePanel = panel;
    document.body.append(panel);
  }, resource);
  // Map pins read both catalogs once the map is in, so arm the failure after that read.
  await expect.poll(() => page.evaluate((name) => window.__resourcePanel.getWorkspaceSnapshot().resources[name].status, resource)).toBe("ready");
}

test("area review reports a failed reload and Try again recovers", async ({ page }) => {
  await installPanelFixture(page, { moduleSource: "packaged" });
  await mountPanelWithFailedRequest(page, "areas");
  await expect.poll(() => page.evaluate(() => window.__resourcePanel.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  await page.evaluate(() => { window.__resourceRetry.armed = true; });
  await openWorkflow(page, "areaReview");

  const alert = page.getByRole("alert").filter({ hasText: "Home Assistant couldn't load your saved areas." });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveText("Home Assistant couldn't load your saved areas.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => page.evaluate(() => window.__resourcePanel.getWorkspaceSnapshot().resources.areas.status)).toBe("ready");
  await expect(alert).toHaveCount(0);
  expect(await page.evaluate(() => window.__resourceRetry.calls)).toBe(2);
});

test("plan resource problem box contains only its unavailable sentence", async ({ page }) => {
  await installPanelFixture(page, { moduleSource: "packaged" });
  await mountPanelWithFailedRequest(page, "plans");
  await expect.poll(() => page.evaluate(() => window.__resourcePanel.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  await page.evaluate(() => { window.__resourceRetry.armed = true; });
  await openWorkflow(page, "plans");

  const alert = page.getByRole("alert").filter({ hasText: "Home Assistant couldn't load rooms and plans." });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveText("Home Assistant couldn't load rooms and plans.");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => page.evaluate(() => window.__resourcePanel.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
  expect(await page.evaluate(() => window.__resourceRetry.calls)).toBe(2);
});

const QUEUE_PLAN = {
  id: "daily", name: "Daily clean", enabled: true, run_behavior: "intelligent",
  rooms: [{ room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" }],
  room_order: ["room-a"], return_to_base: true, finish_current_room: false, finish_current_room_threshold: 50,
};

// The first live map read fails; a saved map stands in for it only when `savedMap`.
async function mountPanelWithFailedFirstMap(page, robotState, savedMap = false) {
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialPlanCatalog: {
      rooms: [{ room_id: "room-a", name: "Kitchen", cleaning_mode: "vacuum", coverage_setting: "standard" }],
      plans: [QUEUE_PLAN], selected_plan: "daily",
    },
    initialRobotStates: { "vacuum.synthetic": { state: robotState, attributes: { matic_entry_id: "synthetic-entry" } } },
    userData: { "matic_robot_home_shortcuts.synthetic-entry": { version: 2, pins: [{ kind: "plan", id: "daily" }], excluded: [] } },
  });
  await page.evaluate((savedMap) => {
    const panel = window.__panelFixture.createPanel();
    const original = panel.hass.fetchWithAuth.bind(panel.hass);
    window.__firstMap = { fail: true, reads: 0 };
    panel.hass = {
      ...panel.hass,
      fetchWithAuth: async (path, ...args) => {
        if (/slam_scene\/synthetic$/.test(path)) {
          window.__firstMap.reads += 1;
          if (window.__firstMap.fail) return new Response(null, { status: 503 });
        }
        if (!savedMap && path.endsWith("slam_scene/history")) return new Response(null, { status: 404 });
        return original(path, ...args);
      },
    };
    document.body.append(panel);
  }, savedMap);
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("error");
  return panel;
}

for (const robotState of ["cleaning", "docked"]) {
  test(`a failed first map says so and Try again reads it again while ${robotState}`, async ({ page }) => {
    const panel = await mountPanelWithFailedFirstMap(page, robotState);
    const problem = panel.getByRole("alert").filter({ hasText: "Home Assistant couldn't load the map." });
    await expect(problem).toBeVisible();
    await expect(panel.getByText("Loading your saved home choices…")).toHaveCount(0);
    await expect(panel.getByText("Loading the current map")).toHaveCount(0);
    if (robotState === "cleaning") await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeEnabled();
    const reads = await page.evaluate(() => window.__firstMap.reads);
    expect(await page.evaluate(() => window.__panelFixture.planReads)).toBe(0);

    await page.evaluate(() => { window.__firstMap.fail = false; });
    await problem.getByRole("button", { name: "Try again", exact: true }).click();
    await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
    expect(await page.evaluate(() => window.__firstMap.reads)).toBe(reads + 1);
    await expect(problem).toHaveCount(0);
    await expect(panel.getByText("Loading your saved home choices…")).toHaveCount(0);
    if (robotState === "cleaning") {
      await expect(panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button")).toHaveText([
        "Skip", "Clean next", "Clean again",
      ]);
    }
  });
}

test("a saved map shown for a failed live map keeps Try again until the live map loads", async ({ page }) => {
  const panel = await mountPanelWithFailedFirstMap(page, "cleaning", true);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingHistoryScenes.length)).toBe(1);
  await page.evaluate(() => window.__panelFixture.pendingHistoryScenes.shift()());
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.map.available, state.floor.readOnly, state.resources.scene.value?.source];
  })).toEqual([true, true, "history"]);
  const problem = panel.getByRole("alert").filter({ hasText: "Home Assistant couldn't load the map." });
  await expect(problem).toBeVisible();
  await expect(panel.getByText("Loading your saved home choices…")).toHaveCount(0);

  await page.evaluate(() => { window.__firstMap.fail = false; });
  await problem.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.floor.readOnly, state.resources.scene.value?.source];
  })).toEqual([false, "live"]);
  await expect(problem).toHaveCount(0);
  await expect(panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button")).toHaveText([
    "Skip", "Clean next", "Clean again",
  ]);
});
