import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { STARTUP_BUDGET_BYTES, startupGraph } from "../../scripts/startup_graph.mjs";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const COMPONENT_ASSETS = fileURLToPath(new URL("../../custom_components/matic_robot/", import.meta.url));
const QUEUE_PLAN = {
  id: "daily", name: "Daily clean", enabled: true, run_behavior: "intelligent",
  rooms: [{ room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" }],
  room_order: ["room-a"], return_to_base: true, finish_current_room: false, finish_current_room_threshold: 50,
};
const QUEUE_CATALOG = {
  rooms: [{ room_id: "room-a", name: "Kitchen", cleaning_mode: "vacuum", coverage_setting: "standard" }],
  plans: [QUEUE_PLAN], selected_plan: "daily",
};
const QUEUE_USER_DATA = {
  "matic_robot_home_shortcuts.synthetic-entry": { version: 2, pins: [{ kind: "plan", id: "daily" }], excluded: [] },
};
const CLEANING_ROBOT = {
  "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry" } },
};

function twoRobotEntries() {
  const entryA = {
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
    history_floor_count: 1,
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
  };
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
  return [entryA, entryB];
}

const TWO_ROBOT_STATES = {
  "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry" } },
  "vacuum.synthetic_b": { state: "docked", attributes: { matic_entry_id: "synthetic-entry-b" } },
};

async function armFirstMapOpportunity(page, panelTag) {
  const markerPath = `/__matic-first-map-${randomUUID()}`;
  const starts = [];
  let startsAtMarker = [];
  const isAssetPath = (path) => path === "/matic_icons.js"
    || path.startsWith("/map_studio_v4/") && path.endsWith(".js");
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === markerPath) {
      // Playwright delivers request-start events in issue order. Snapshotting
      // at the marker includes scripts still in flight at the first map frame.
      startsAtMarker = [...starts];
    } else if (isAssetPath(path)) starts.push(path);
  });
  await page.route(`**${markerPath}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ starts: startsAtMarker }),
  }));
  await page.evaluate(({ tag, markerPath }) => {
    window.__firstMapObservedResources = [];
    const observer = new PerformanceObserver((records) => {
      window.__firstMapObservedResources.push(...records.getEntries().map(({ name, startTime }) => ({ name, startTime })));
    });
    observer.observe({ type: "resource", buffered: true });
    window.__firstMapOpportunity = new Promise((resolve) => {
      const observe = () => {
        const element = document.querySelector(tag);
        if (!element?.getWorkspaceSnapshot().map.available) {
          requestAnimationFrame(observe);
          return;
        }
        const markerTime = performance.timeOrigin + performance.now();
        void fetch(markerPath, {
          method: "POST",
          cache: "no-store",
          body: JSON.stringify({ markerTime }),
        }).then((response) => response.json()).then(({ starts }) => {
          const completed = performance.getEntriesByType("resource")
            .filter(({ startTime }) => performance.timeOrigin + startTime <= markerTime)
            .map(({ name }) => new URL(name).pathname);
          const observed = window.__firstMapObservedResources
            .filter(({ startTime }) => performance.timeOrigin + startTime <= markerTime)
            .map(({ name }) => new URL(name).pathname);
          resolve([...new Set([...starts, ...completed, ...observed])]
            .filter((path) => path === "/matic_icons.js" || path.startsWith("/map_studio_v4/") && path.endsWith(".js"))
            .sort());
          observer.disconnect();
        });
      };
      requestAnimationFrame(observe);
    });
  }, { tag: panelTag, markerPath });
}

async function firstMapOpportunityPaths(page) {
  return page.evaluate(() => window.__firstMapOpportunity);
}

async function dispatchQueueAction(panel, change = "skip_room") {
  await panel.evaluate((element, actionChange) => {
    const state = element.getWorkspaceSnapshot();
    const catalog = state.resources.plans.status === "ready" ? state.resources.plans.value : null;
    const room = catalog?.rooms[0];
    if (!room || !catalog) throw new Error("queue action needs a ready room catalog");
    const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
    shell.dispatchEvent(new CustomEvent("matic-workspace-action", { bubbles: true, composed: true, detail: {
      id: "change-queue", change: actionChange, roomId: room.roomId, room: room.name,
      scope: {
        ownerUserKey: state.owner?.userKey ?? null,
        ownerEntryKey: state.owner?.entryKey ?? null,
        entryId: state.selection.entryId,
        floorId: state.selection.floorId,
        generation: state.generation,
        catalog,
        revision: state.queueScopeRevision,
      },
    } }));
  }, change);
}

test("Map Studio loads exactly its startup graph within budget and no legacy editor assets", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  await page.evaluate(async () => import("/matic_icons.js"));
  await armFirstMapOpportunity(page, fixture.panelTag);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const loaded = (await firstMapOpportunityPaths(page))
    .map((path) => path.slice(1)).sort();

  const scriptPaths = await page.evaluate(() => performance.getEntriesByType("resource")
    .map(({ name }) => new URL(name).pathname)
    .filter((path) => path.endsWith(".js")));
  expect(scriptPaths.some((path) => /room-plan-editor|matic_map_studio\.js/u.test(path))).toBe(false);
  expect(await page.evaluate(() => performance.getEntriesByType("resource")
    .filter(({ name }) => name.includes("robot-atlas.")))).toEqual([]);
  const graph = startupGraph();
  expect(loaded).toEqual(Object.keys(graph).sort());
  const total = Object.values(graph).reduce((sum, size) => sum + size, 0);
  expect(total, JSON.stringify(graph)).toBeLessThanOrEqual(STARTUP_BUDGET_BYTES);
});

test("two-robot startup keeps the native selector in the first-map budget on a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialCatalogEntries: twoRobotEntries(),
    initialRobotStates: TWO_ROBOT_STATES,
  });
  await page.evaluate(async () => import("/matic_icons.js"));
  await armFirstMapOpportunity(page, fixture.panelTag);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const loaded = (await firstMapOpportunityPaths(page)).sort();
  const graph = startupGraph();
  expect(loaded).toEqual(Object.keys(graph).map((path) => `/${path}`).sort());
  const total = Object.values(graph).reduce((sum, size) => sum + size, 0);
  expect(total, JSON.stringify(graph)).toBeLessThanOrEqual(STARTUP_BUDGET_BYTES);

  const panel = page.locator(fixture.panelTag);
  const selector = panel.locator("select.robot-switcher");
  await expect(selector).toBeVisible();
  await expect(selector.locator("option")).toHaveCount(2);
  expect(await selector.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await panel.evaluate((element) => {
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "enter-full-map" }, bubbles: true, composed: true,
    }));
  });
  await expect(selector).toBeVisible();
  expect(await selector.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
});

test("first-map capture includes a script request still in flight at the marker", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  const workflowPanel = readdirSync(join(COMPONENT_ASSETS, "map_studio_v4", "chunks"))
    .find((name) => /^workflow-panel-[^/]+\.js$/u.test(name));
  expect(workflowPanel).toBeTruthy();
  const heldPath = `/map_studio_v4/chunks/${workflowPanel}`;
  let releaseHeldResponse;
  let markHeldStarted;
  const heldStarted = new Promise((resolve) => { markHeldStarted = resolve; });
  await page.route((url) => {
    const parsed = new URL(url);
    return parsed.pathname === heldPath && parsed.searchParams.get("held-before-marker") === "1";
  }, (route) => new Promise((resolve) => {
    markHeldStarted();
    releaseHeldResponse = () => { void route.continue().finally(resolve); };
  }));
  await armFirstMapOpportunity(page, fixture.panelTag);
  await page.evaluate((path) => {
    window.__heldScriptResponse = fetch(`${path}?held-before-marker=1`).then((response) => response.status);
  }, heldPath);
  await heldStarted;
  await page.evaluate(() => import("/matic_icons.js"));
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  try {
    const firstFramePaths = await firstMapOpportunityPaths(page);
    expect(firstFramePaths).toContain(heldPath);
  } finally {
    releaseHeldResponse?.();
  }
  await expect.poll(() => page.evaluate(() => window.__heldScriptResponse)).toBe(200);
});

test("supported servers automatically load workspace push within the first-map gzip budget", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", workspacePush: true, userData: {} });
  await page.evaluate(() => import("/matic_icons.js"));
  await armFirstMapOpportunity(page, fixture.panelTag);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  // Observe map admission from inside the page's animation-frame loop. A
  // Playwright poll can run after both admission frames and hide early fetches.
  const firstFramePaths = await firstMapOpportunityPaths(page);
  const graph = startupGraph();
  expect(firstFramePaths).toEqual(Object.keys(graph).map((path) => `/${path}`).sort());
  const firstFrameBytes = firstFramePaths.reduce((total, path) =>
    total + gzipSync(readFileSync(join(COMPONENT_ASSETS, path.slice(1))), { level: 9 }).byteLength, 0);
  expect(firstFrameBytes, JSON.stringify(graph)).toBeLessThanOrEqual(STARTUP_BUDGET_BYTES);

  await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource")
    .some(({ name }) => /\/chunks\/workspace-transport-[^/]+\.js$/u.test(new URL(name).pathname)))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.workspaceCalls
    .some(({ type }) => type === "matic_robot/workspace_subscribe"))).toBe(true);
  const workspaceCalls = await page.evaluate(() => window.__panelFixture.workspaceCalls);
  expect(workspaceCalls.length).toBeGreaterThanOrEqual(2);
  expect(workspaceCalls.every(({ mapAvailable }) => mapAvailable)).toBe(true);

  const afterSubscriptionPaths = await page.evaluate(() => performance.getEntriesByType("resource")
    .map(({ name }) => new URL(name).pathname)
    .filter((path) => path === "/matic_icons.js" || path.startsWith("/map_studio_v4/") && path.endsWith(".js")));
  expect(afterSubscriptionPaths.some((path) => /\/chunks\/workspace-transport-[^/]+\.js$/u.test(path))).toBe(true);
  const afterSubscriptionBytes = afterSubscriptionPaths.reduce((total, path) => total
    + gzipSync(readFileSync(join(COMPONENT_ASSETS, path.slice(1))), { level: 9 }).byteLength, 0);
  const transportBytes = afterSubscriptionPaths.filter((path) => /\/chunks\/workspace-transport-[^/]+\.js$/u.test(path))
    .reduce((total, path) => total + gzipSync(readFileSync(join(COMPONENT_ASSETS, path.slice(1))), { level: 9 }).byteLength, 0);

  await page.waitForTimeout(2_200);
  const completePaths = await page.evaluate(() => performance.getEntriesByType("resource")
    .map(({ name }) => new URL(name).pathname)
    .filter((path) => path === "/matic_icons.js" || path.startsWith("/map_studio_v4/") && path.endsWith(".js")));
  const completeBytes = completePaths.reduce((total, path) => total
    + gzipSync(readFileSync(join(COMPONENT_ASSETS, path.slice(1))), { level: 9 }).byteLength, 0);
  const postOpportunityPaths = completePaths.filter((path) => !firstFramePaths.includes(path));
  const postOpportunityBytes = postOpportunityPaths.reduce((total, path) =>
    total + gzipSync(readFileSync(join(COMPONENT_ASSETS, path.slice(1))), { level: 9 }).byteLength, 0);
  const postSubscriptionPaths = completePaths.filter((path) => !afterSubscriptionPaths.includes(path));
  const postSubscriptionBytes = postSubscriptionPaths.reduce((total, path) =>
    total + gzipSync(readFileSync(join(COMPONENT_ASSETS, path.slice(1))), { level: 9 }).byteLength, 0);
  console.info("[workspace push first-frame and deferred bytes]", JSON.stringify({
    firstFrameBytes,
    firstFramePaths,
    afterSubscriptionBytes,
    transportBytes,
    postOpportunityBytes,
    postOpportunityPaths,
    postSubscriptionBytes,
    postSubscriptionPaths,
    completeRequestedBytes: completeBytes,
    completeRequestedPaths: completePaths,
  }));
  expect(completePaths).toEqual([...new Set(completePaths)]);
  expect(firstFrameBytes + postOpportunityBytes).toBe(completeBytes);
  expect(afterSubscriptionBytes + postSubscriptionBytes).toBe(completeBytes);
  expect(postOpportunityPaths.some((path) => /\/chunks\/home-pin-resources-[^/]+\.js$/u.test(path))).toBe(true);
});

test("cleaning startup keeps Stop in the first-map budget and loads queue controls after the first frame", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA,
    cleaningCoverage: { active: true, map_session_key: "a".repeat(64), cell_size: 0.015,
      runs: [[1, 1, 2, 1]], truncated: true, coverage_basis: "observed_changes" } });
  await page.evaluate(() => import("/matic_icons.js"));
  await armFirstMapOpportunity(page, fixture.panelTag);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const firstFramePaths = await firstMapOpportunityPaths(page);
  const graph = startupGraph();
  expect(firstFramePaths).toEqual(Object.keys(graph).map((path) => `/${path}`).sort());
  const firstFrameBytes = firstFramePaths.reduce((total, path) =>
    total + gzipSync(readFileSync(join(COMPONENT_ASSETS, path.slice(1))), { level: 9 }).byteLength, 0);
  expect(firstFrameBytes, JSON.stringify(graph)).toBeLessThanOrEqual(STARTUP_BUDGET_BYTES);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource")
    .some(({ name }) => /\/chunks\/map-layer-resources-[^/]+\.js$/u.test(new URL(name).pathname)))).toBe(true);
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeEnabled();
  await expect(panel.getByRole("region", { name: "Change this clean" })).toBeVisible();
  await expect(panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button")).toHaveText([
    "Skip", "Clean next", "Clean again",
  ]);
  const loadedPaths = await page.evaluate(() => performance.getEntriesByType("resource")
    .map(({ name }) => new URL(name).pathname));
  expect(loadedPaths.some((path) => /\/chunks\/workflow-panel-[^/]+\.js$/u.test(path))).toBe(true);
  expect(loadedPaths.filter((path) => /\/chunks\/workflow-panel-[^/]+\.js$/u.test(path))).toHaveLength(1);
});

test("a cold unavailable scene keeps Stop available and recovers queue controls when the map arrives", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => window.__panelFixture.deferNextSceneRead());
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingSceneReadCount())).toBe(1);
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeEnabled();
  await expect(panel.getByRole("region", { name: "Change this clean" }).getByRole("status")).toHaveText("Loading…");
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(false);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().resources.plans.status)).toBe("idle");
  expect(await page.evaluate(() => window.__panelFixture.planReads)).toBe(0);

  await page.evaluate(() => window.__panelFixture.releaseSceneRead());
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.planReads)).toBeGreaterThan(0);
  await expect(panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button")).toHaveText([
    "Skip", "Clean next", "Clean again",
  ]);
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeEnabled();
});

test("cleaning with an empty v2 shortcut set loads the verified room catalog after map admission", async ({ page }) => {
  await page.goto("/");
  const emptyShortcuts = { "matic_robot_home_shortcuts.synthetic-entry": { version: 2, pins: [], excluded: [] } };
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: emptyShortcuts });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.planReads)).toBeGreaterThan(0);
  await expect(panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button")).toHaveText([
    "Skip", "Clean next", "Clean again",
  ]);
  expect(await page.evaluate(() => window.__panelFixture.userDataCalls
    .some(({ type, key }) => type === "frontend/get_user_data" && key === "matic_robot_home_shortcuts.synthetic-entry"))).toBe(true);
});

test("a failed current room catalog read has reload recovery instead of loading forever", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => window.__panelFixture.failNextPlansRead());
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect(panel.getByRole("alert").filter({ hasText: "rooms for this clean couldn't be read" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  const firstReadCount = await page.evaluate(() => window.__panelFixture.planReads);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__panelFixture.planReads)).toBe(firstReadCount);
  const currentUrl = page.url();
  const navigation = page.waitForRequest((request) => request.isNavigationRequest() && request.url() === currentUrl);
  const response = navigation.then((request) => page.waitForResponse((candidate) => candidate.request() === request));
  await panel.getByRole("button", { name: "Try again", exact: true }).click();
  const result = await response;
  await result.finished();
  await page.waitForLoadState("load");
  await fixture.remount();
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const resumed = page.locator(fixture.panelTag);
  await expect(resumed.getByRole("group", { name: "Change Kitchen" })).toBeVisible();
});

test("push invalidation and periodic polling refresh the active clean room list without shortcuts", async ({ page }) => {
  await page.goto("/");
  const emptyShortcuts = { "matic_robot_home_shortcuts.synthetic-entry": { version: 2, pins: [], excluded: [] } };
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", workspacePush: true,
    initialPlanCatalog: QUEUE_CATALOG, initialRobotStates: CLEANING_ROBOT, userData: emptyShortcuts });
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    const connection = panel.hass.connection;
    const subscribe = connection.subscribeMessage.bind(connection);
    connection.subscribeMessage = (callback, message) => {
      if (message?.type === "matic_robot/workspace_subscribe") window.__workspaceQueueCallback = callback;
      return subscribe(callback, message);
    };
    document.body.append(panel);
  });
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await expect(panel.getByRole("group", { name: "Change Kitchen" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.planReads)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => typeof window.__workspaceQueueCallback)).toBe("function");

  const beforePush = await page.evaluate(() => window.__panelFixture.planReads);
  await page.evaluate((catalog) => {
    window.__panelFixture.setPlanCatalog({ ...catalog, rooms: [
      { room_id: "room-a", name: "Kitchen after push", cleaning_mode: "vacuum", coverage_setting: "standard" },
    ] });
    window.__workspaceQueueCallback({ type: "invalidate", invalidation: {
      epoch: "synthetic-workspace-epoch", sequence: 1, coherence_generation: 1,
      revisions: { plans: 1 }, resources: ["plans"],
    } });
  }, QUEUE_CATALOG);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.planReads)).toBeGreaterThan(beforePush);
  await expect(panel.getByRole("group", { name: "Change Kitchen after push" })).toBeVisible();

  const beforePoll = await page.evaluate(() => window.__panelFixture.planReads);
  await page.evaluate((catalog) => window.__panelFixture.setPlanCatalog({ ...catalog, rooms: [
    { room_id: "room-a", name: "Kitchen after poll", cleaning_mode: "vacuum", coverage_setting: "standard" },
  ] }), QUEUE_CATALOG);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.planReads), { timeout: 7_000 }).toBeGreaterThan(beforePoll);
  await expect(panel.getByRole("group", { name: "Change Kitchen after poll" })).toBeVisible();
});

test("a sent queue change stays pending across a catalog refresh and cannot be duplicated", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", workspacePush: true,
    initialPlanCatalog: QUEUE_CATALOG, initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    const connection = panel.hass.connection;
    const subscribe = connection.subscribeMessage.bind(connection);
    connection.subscribeMessage = (callback, message) => {
      if (message?.type === "matic_robot/workspace_subscribe") window.__workspaceQueueCallback = callback;
      return subscribe(callback, message);
    };
    document.body.append(panel);
  });
  const panel = page.locator(fixture.panelTag);
  await expect(panel.getByRole("group", { name: "Change Kitchen" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__workspaceQueueCallback)).toBe("function");
  await page.evaluate(() => window.__panelFixture.deferNextService());
  await panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingServiceCount())).toBe(1);
  const previousReads = await page.evaluate(() => window.__panelFixture.planReads);
  await page.evaluate((catalog) => {
    window.__panelFixture.setPlanCatalog({ ...catalog, rooms: [
      { room_id: "room-a", name: "Kitchen refreshed", cleaning_mode: "vacuum", coverage_setting: "standard" },
    ] });
    window.__workspaceQueueCallback({ type: "invalidate", invalidation: {
      epoch: "synthetic-workspace-epoch", sequence: 1, coherence_generation: 1,
      revisions: { plans: 1 }, resources: ["plans"],
    } });
  }, QUEUE_CATALOG);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.planReads)).toBeGreaterThan(previousReads);
  await expect(panel.getByRole("group", { name: "Change Kitchen refreshed" })).toBeVisible();
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(true);
  await panel.getByRole("group", { name: "Change Kitchen refreshed" }).getByRole("button", { name: "Clean next" })
    .evaluate((button) => button.click());
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls
    .filter(({ service }) => ["skip_room", "clean_room_next", "clean_room_again"].includes(service)).length)).toBe(1);
  await page.evaluate(() => window.__panelFixture.releaseService());
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(false);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().notice)).toBeNull();
});

test("a confirmed queue change remains visible during a live catalog refresh", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", workspacePush: true,
    initialPlanCatalog: QUEUE_CATALOG, initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    const connection = panel.hass.connection;
    const subscribe = connection.subscribeMessage.bind(connection);
    connection.subscribeMessage = (callback, message) => {
      if (message?.type === "matic_robot/workspace_subscribe") window.__workspaceQueueCallback = callback;
      return subscribe(callback, message);
    };
    document.body.append(panel);
  });
  const panel = page.locator(fixture.panelTag);
  await expect(panel.getByRole("group", { name: "Change Kitchen" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__workspaceQueueCallback)).toBe("function");
  await page.evaluate(() => window.__panelFixture.deferNextService());
  await panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingServiceCount())).toBe(1);
  await page.evaluate(() => {
    window.__panelFixture.deferNextPlansRead();
    window.__workspaceQueueCallback({ type: "invalidate", invalidation: {
      epoch: "synthetic-workspace-epoch", sequence: 1, coherence_generation: 1,
      revisions: { plans: 1 }, resources: ["plans"],
    } });
  });
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingPlanReadCount())).toBe(1);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.plans.status)).toBe("loading");
  await page.evaluate(() => window.__panelFixture.releaseService());
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(false);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().notice?.key)).toBe("v4_notice_queue_skipped");
  await page.evaluate(() => window.__panelFixture.releasePlansRead());
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
});

test("an equivalent refreshed room catalog still permits the sent queue result notice", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", workspacePush: true,
    initialPlanCatalog: QUEUE_CATALOG, initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    const connection = panel.hass.connection;
    const subscribe = connection.subscribeMessage.bind(connection);
    connection.subscribeMessage = (callback, message) => {
      if (message?.type === "matic_robot/workspace_subscribe") window.__workspaceQueueCallback = callback;
      return subscribe(callback, message);
    };
    document.body.append(panel);
  });
  const panel = page.locator(fixture.panelTag);
  await expect(panel.getByRole("group", { name: "Change Kitchen" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__workspaceQueueCallback)).toBe("function");
  await page.evaluate(() => window.__panelFixture.deferNextService());
  await panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingServiceCount())).toBe(1);
  const previousReads = await page.evaluate(() => window.__panelFixture.planReads);
  await page.evaluate((catalog) => {
    window.__panelFixture.setPlanCatalog(structuredClone(catalog));
    window.__workspaceQueueCallback({ type: "invalidate", invalidation: {
      epoch: "synthetic-workspace-epoch", sequence: 1, coherence_generation: 1,
      revisions: { plans: 1 }, resources: ["plans"],
    } });
  }, QUEUE_CATALOG);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.planReads)).toBeGreaterThan(previousReads);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(true);
  await page.evaluate(() => window.__panelFixture.releaseService());
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(false);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().notice?.key)).toBe("v4_notice_queue_skipped");
});

test("a connection replacement keeps the sent queue operation fenced across controller reload", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const skip = panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button", { name: "Skip" });
  await expect(skip).toBeVisible();
  await page.evaluate(() => window.__panelFixture.deferNextService());
  await skip.click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingServiceCount())).toBe(1);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(true);

  await panel.evaluate((element) => {
    element.hass = { ...element.hass, connection: { ...element.hass.connection } };
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queueControllerStatus)).toBe("ready");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(true);
  const next = panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button", { name: "Clean next" });
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await dispatchQueueAction(panel, "clean_room_next");
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls
    .filter(({ service }) => ["skip_room", "clean_room_next", "clean_room_again"].includes(service)).length)).toBe(1);

  await page.evaluate(() => window.__panelFixture.releaseService());
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(false);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().queueUncertainToken)).toBeNull();
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().notice?.key)).toBe("v4_notice_queue_skipped");
});

test("a no-map queue fallback waits two seconds without loading workflows, then loads queue controls after map admission", async ({ page }) => {
  let queueModuleRequests = 0;
  page.on("request", (request) => {
    if (/\/chunks\/workflow-panel-[^/]+\.js$/u.test(request.url())) queueModuleRequests += 1;
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => window.__panelFixture.deferNextSceneRead());
  await page.evaluate(() => {
    window.__observedAssetPaths = [];
    new PerformanceObserver((records) => {
      window.__observedAssetPaths.push(...records.getEntries().map(({ name }) => new URL(name).pathname));
    }).observe({ type: "resource", buffered: true });
  });
  await page.clock.install();
  await page.evaluate(() => import("/matic_icons.js"));
  await armFirstMapOpportunity(page, fixture.panelTag);
  await page.evaluate(() => {
    window.__queueAdmissionTimerStarts = [];
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((callback, delay, ...args) => {
      if (delay === 2_000) window.__queueAdmissionTimerStarts.push(performance.now());
      return nativeSetTimeout(callback, delay, ...args);
    });
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingSceneReadCount())).toBe(1);
  await expect(panel.getByRole("region", { name: "Change this clean" }).getByRole("status")).toHaveText("Loading…");
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(false);
  const beforeAdmission = await panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return { activity: state.activity, mapAvailable: state.map.available, plansStatus: state.resources.plans.status };
  });
  const admissionElapsed = await page.evaluate(() => {
    const startedAt = window.__queueAdmissionTimerStarts[0];
    if (typeof startedAt !== "number") throw new Error("queue admission timer was not scheduled");
    return performance.now() - startedAt;
  });
  await page.clock.runFor(Math.max(0, 1_999 - admissionElapsed));
  expect(queueModuleRequests).toBe(0);
  const beforeDeadline = await panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return { activity: state.activity, mapAvailable: state.map.available, plansStatus: state.resources.plans.status };
  });
  const elapsedAtBoundary = await page.evaluate(() => performance.now() - window.__queueAdmissionTimerStarts[0]);
  await page.clock.runFor(Math.max(0, 2_000 - elapsedAtBoundary));
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().optionalUiReady)).toBe(true);
  expect(queueModuleRequests).toBe(0);
  await expect(panel.getByRole("region", { name: "Change this clean" }).getByRole("status")).toContainText("unavailable");
  console.info("[workspace queue fallback admission]", JSON.stringify({ beforeAdmission, beforeDeadline, atDeadline: {
    queueModuleRequests, ...await panel.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      return { activity: state.activity, mapAvailable: state.map.available, plansStatus: state.resources.plans.status };
    }),
  } }));
  await page.evaluate(() => window.__panelFixture.releaseSceneRead());
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  const firstFramePaths = await firstMapOpportunityPaths(page);
  const firstFrameBytes = firstFramePaths.reduce((total, path) =>
    total + gzipSync(readFileSync(join(COMPONENT_ASSETS, path.slice(1))), { level: 9 }).byteLength, 0);
  const staticGraphBytes = Object.values(startupGraph()).reduce((total, size) => total + size, 0);
  await expect(panel.getByRole("group", { name: "Change Kitchen" })).toBeVisible();
  await expect.poll(() => queueModuleRequests).toBe(1);
  const allAssetPaths = await page.evaluate(() => [...new Set(window.__observedAssetPaths ?? [])]
    .filter((path) => path === "/matic_icons.js" || path.startsWith("/map_studio_v4/") && path.endsWith(".js"))
    .sort());
  const observedAfterMapPaths = allAssetPaths.filter((path) => !firstFramePaths.includes(path));
  const observedAfterMapBytes = observedAfterMapPaths.reduce((total, path) =>
    total + gzipSync(readFileSync(join(COMPONENT_ASSETS, path.slice(1))), { level: 9 }).byteLength, 0);
  const startupPaths = new Set(Object.keys(startupGraph()).map((path) => `/${path}`));
  const optionalPaths = allAssetPaths.filter((path) => !startupPaths.has(path));
  const optionalBytes = optionalPaths.reduce((total, path) =>
    total + gzipSync(readFileSync(join(COMPONENT_ASSETS, path.slice(1))), { level: 9 }).byteLength, 0);
  console.info("[workspace queue slow-map fallback bytes]", JSON.stringify({
    firstFrameBytes, staticGraphBytes, budget: STARTUP_BUDGET_BYTES, firstFramePaths,
    observedAfterMapBytes, observedAfterMapPaths, optionalBytes, optionalPaths, queueModuleRequests,
  }));
  expect(allAssetPaths.some((path) => /\/chunks\/workflow-panel-[^/]+\.js$/u.test(path))).toBe(true);
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
});

test("a failed room catalog keeps its retry visible when the map is unavailable", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", workspacePush: true,
    initialPlanCatalog: QUEUE_CATALOG, initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    const connection = panel.hass.connection;
    const subscribe = connection.subscribeMessage.bind(connection);
    connection.subscribeMessage = (callback, message) => {
      if (message?.type === "matic_robot/workspace_subscribe") window.__workspaceQueueCallback = callback;
      return subscribe(callback, message);
    };
    document.body.append(panel);
  });
  const panel = page.locator(fixture.panelTag);
  await expect(panel.getByRole("group", { name: "Change Kitchen" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__workspaceQueueCallback)).toBe("function");
  const previousReads = await page.evaluate(() => window.__panelFixture.planReads);
  await page.evaluate(() => {
    window.__panelFixture.failNextPlansRead();
    window.__workspaceQueueCallback({ type: "invalidate", invalidation: {
      epoch: "synthetic-workspace-epoch", sequence: 1, coherence_generation: 1,
      revisions: { plans: 1 }, resources: ["plans"],
    } });
  });
  await expect.poll(() => page.evaluate(() => window.__panelFixture.planReads)).toBeGreaterThan(previousReads);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.plans.status)).toBe("error");
  await panel.evaluate((element) => {
    element.getWorkspaceSnapshot().map.available = false;
    element.shadowRoot.querySelector("matic-map-shell-v4").requestUpdate();
  });
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(false);
  await expect(panel.getByRole("alert").filter({ hasText: "rooms for this clean couldn't be read" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeEnabled();
});

for (const change of ["robot", "user", "floor", "catalog"]) {
  test(`a retained queue button is inert after a synchronous ${change} change`, async ({ page }) => {
    await page.goto("/");
    const fixture = await installPanelFixture(page, { moduleSource: "typescript", initialPlanCatalog: QUEUE_CATALOG,
      initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const panel = page.locator(fixture.panelTag);
    await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
    await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
    await expect(panel.getByRole("region", { name: "Change this clean" })).toBeVisible();
    const staleButton = panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button", { name: "Skip" });
    await staleButton.evaluate((button, change) => {
      let host = button;
      while (host && typeof host.getWorkspaceSnapshot !== "function") host = host.getRootNode()?.host;
      const state = host.getWorkspaceSnapshot();
      if (change === "robot") state.owner = { ...state.owner, entryKey: "other-robot" };
      if (change === "user") state.owner = { ...state.owner, userKey: "other-user" };
      if (change === "floor") state.selection.floorId = "another-floor";
      if (change === "catalog") state.resources.plans = {
        status: "ready", problem: null, value: structuredClone(state.resources.plans.value),
      };
      // Dispatch before Lit's scheduled update can replace the retained DOM.
      button.click();
    }, change);
    expect(await page.evaluate(() => window.__panelFixture.serviceCalls
      .filter(({ service }) => ["skip_room", "clean_room_next", "clean_room_again"].includes(service)))).toEqual([]);
    expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(false);
  });
}

test("queue module failure keeps Stop available and explicit retry restores the queue", async ({ page }) => {
  let moduleAttempts = 0;
  let releaseModule;
  const pendingModule = new Promise((resolve) => { releaseModule = resolve; });
  await page.route("**/map_studio_v4/chunks/workflow-panel-*.js", async (route) => {
    moduleAttempts += 1;
    if (moduleAttempts === 1) {
      await pendingModule;
      await route.abort();
    } else await route.continue();
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
  await expect.poll(() => moduleAttempts).toBe(1);
  await expect(panel.getByRole("region", { name: "Change this clean" }).getByRole("status")).toBeVisible();
  await panel.getByRole("button", { name: "Stop cleaning" }).click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls
    .some(({ service }) => service === "stop_intelligent_cleaning"))).toBe(true);
  releaseModule();
  await expect(panel.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
  const reloaded = page.waitForEvent("load");
  await panel.getByRole("button", { name: "Try again" }).click();
  await reloaded;
  await fixture.remount();
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const resumed = page.locator(fixture.panelTag);
  await expect(resumed.getByRole("region", { name: "Change this clean" })).toBeVisible();
  await expect(resumed.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
  await expect(resumed.getByRole("group", { name: "Change Kitchen" }).getByRole("button", { name: "Skip" })).toBeVisible();
  expect(moduleAttempts).toBe(2);
});

test("queue writes load with the lazy workflow and never delay static Stop", async ({ page }) => {
  let releaseWrites;
  const pendingWrites = new Promise((resolve) => { releaseWrites = resolve; });
  let writeModuleRequests = 0;
  await page.route("**/map_studio_v4/chunks/catalog-writes-*.js", async (route) => {
    writeModuleRequests += 1;
    await pendingWrites;
    await route.abort();
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => import("/matic_icons.js"));
  await armFirstMapOpportunity(page, fixture.panelTag);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const firstMapPaths = await firstMapOpportunityPaths(page);
  expect(firstMapPaths.some((path) => /\/chunks\/catalog-writes-[^/]+\.js$/u.test(path))).toBe(false);
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
  await expect.poll(() => writeModuleRequests).toBe(1);
  await expect(panel.getByRole("region", { name: "Change this clean" }).getByRole("status")).toHaveText("Loading…");
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeEnabled();
  await panel.getByRole("button", { name: "Stop cleaning" }).click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls
    .some(({ service }) => service === "stop_intelligent_cleaning"))).toBe(true);
  releaseWrites();
  await expect(panel.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
});

test("queue actions wait for lazy writes, then a rapid duplicate tap sends one service call", async ({ page }) => {
  let releaseModule;
  let writeModuleRequests = 0;
  await page.route("**/map_studio_v4/chunks/catalog-writes-*.js", async (route) => {
    writeModuleRequests += 1;
    await new Promise((resolve) => { releaseModule = resolve; });
    await route.continue();
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await expect.poll(() => writeModuleRequests).toBe(1);
  await expect(panel.getByRole("region", { name: "Change this clean" }).getByRole("status")).toHaveText("Loading…");
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls
    .filter(({ service }) => service === "skip_room").length)).toBe(0);
  releaseModule();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queueControllerStatus)).toBe("ready");
  await page.evaluate(() => window.__panelFixture.deferNextService());
  await panel.evaluate((element) => {
    const button = element.shadowRoot.querySelector("matic-map-shell-v4")
      .shadowRoot.querySelector('[role="group"][aria-label="Change Kitchen"] button');
    button.click();
    button.click();
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls
    .filter(({ service }) => service === "skip_room").length)).toBe(1);
  await page.evaluate(() => window.__panelFixture.releaseService());
});

for (const change of ["owner", "floor"]) {
  test(`a ${change} change during delayed queue-write import sends no stale service`, async ({ page }) => {
    let releaseModule;
    let writeModuleRequests = 0;
    await page.route("**/map_studio_v4/chunks/catalog-writes-*.js", async (route) => {
      writeModuleRequests += 1;
      await new Promise((resolve) => { releaseModule = resolve; });
      await route.continue();
    });
    await page.goto("/");
    const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialPlanCatalog: QUEUE_CATALOG,
      initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const panel = page.locator(fixture.panelTag);
    await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
    await expect.poll(() => writeModuleRequests).toBe(1);
    await dispatchQueueAction(panel);
    if (change === "owner") {
      const originalUser = await panel.evaluate((element) => element.hass.user.id);
      await panel.evaluate((element) => { element.hass = { ...element.hass, user: { ...element.hass.user, id: "changed-user" } }; });
      await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().owner?.userKey)).not.toBe(originalUser);
      await panel.evaluate((element, id) => { element.hass = { ...element.hass, user: { ...element.hass.user, id } }; }, originalUser);
      await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().owner?.userKey)).toBe(originalUser);
    } else {
      const shell = panel.locator("matic-map-shell-v4");
      const intent = (detail) => shell.evaluate((element, value) => element.dispatchEvent(
        new CustomEvent("matic-workspace-intent", { detail: value, bubbles: true, composed: true }),
      ), detail);
      await intent({ type: "open-workflow", workflow: "history" });
      await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.history.status)).toBe("ready");
      await intent({ type: "set-floor", floorId: "saved-1" });
      await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().selection.floorId)).toBe("saved-1");
      await intent({ type: "set-floor", floorId: "current" });
      await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().selection.floorId)).toBe("current");
    }
    releaseModule();
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.__panelFixture.serviceCalls
      .filter(({ service }) => ["skip_room", "clean_room_next", "clean_room_again"].includes(service)))).toEqual([]);
    expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(false);
  });
}

test("battery-only updates preserve queue admission and a ready action", async ({ page }) => {
  let releaseModule;
  let writeModuleRequests = 0;
  await page.route("**/map_studio_v4/chunks/catalog-writes-*.js", async (route) => {
    writeModuleRequests += 1;
    await new Promise((resolve) => { releaseModule = resolve; });
    await route.continue();
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await expect.poll(() => writeModuleRequests).toBe(1);
  await expect(panel.getByRole("region", { name: "Change this clean" }).getByRole("status")).toHaveText("Loading…");
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls
    .filter(({ service }) => service === "skip_room").length)).toBe(0);
  await panel.evaluate((element) => {
    const state = element.hass.states["vacuum.synthetic"];
    element.hass = { ...element.hass, states: { ...element.hass.states,
      "vacuum.synthetic": { ...state, attributes: { ...state.attributes, battery_level: 51 } } } };
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().batteryPercent)).toBe(51);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls
    .filter(({ service }) => service === "skip_room").length)).toBe(0);
  releaseModule();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queueControllerStatus)).toBe("ready");
  const skipButton = panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button", { name: "Skip" });
  await expect(skipButton).toBeEnabled();
  const revisionBeforeBatteryUpdate = await panel.evaluate((element) => element.getWorkspaceSnapshot().queueScopeRevision);
  await panel.evaluate((element) => {
    const state = element.hass.states["vacuum.synthetic"];
    element.hass = { ...element.hass, states: { ...element.hass.states,
      "vacuum.synthetic": { ...state, attributes: { ...state.attributes, battery_level: 52 } } } };
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().batteryPercent)).toBe(52);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().queueScopeRevision)).toBe(revisionBeforeBatteryUpdate);
  await skipButton.click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls
    .filter(({ service }) => service === "skip_room").length)).toBe(1);
});

test("detaching the panel retires its delayed queue admission fence", async ({ page }) => {
  let releaseModule;
  let writeModuleRequests = 0;
  await page.route("**/map_studio_v4/chunks/catalog-writes-*.js", async (route) => {
    writeModuleRequests += 1;
    await new Promise((resolve) => { releaseModule = resolve; });
    await route.continue();
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await expect.poll(() => writeModuleRequests).toBe(1);
  await dispatchQueueAction(panel);
  await panel.evaluate((element) => element.remove());
  releaseModule();
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls
    .filter(({ service }) => ["skip_room", "clean_room_next", "clean_room_again"].includes(service)))).toEqual([]);
});

test("a floor change while the queue service is in flight clears its pending UI without a stale notice", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await page.evaluate(() => window.__panelFixture.deferNextService());
  await panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls
    .filter(({ service }) => service === "skip_room").length)).toBe(1);
  await panel.evaluate((element) => { element.getWorkspaceSnapshot().selection.floorId = "changed-floor"; });
  await page.evaluate(() => window.__panelFixture.releaseService());
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(false);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().notice)).toBeNull();
});

test("a sent queue change stays pending through a same-robot floor switch and return to Live", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "typescript", initialPlanCatalog: QUEUE_CATALOG,
    initialRobotStates: CLEANING_ROBOT, userData: QUEUE_USER_DATA });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect(panel.getByRole("group", { name: "Change Kitchen" })).toBeVisible();
  await page.evaluate(() => window.__panelFixture.deferNextService());
  await panel.getByRole("group", { name: "Change Kitchen" }).getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingServiceCount())).toBe(1);

  const shell = panel.locator("matic-map-shell-v4");
  const intent = (detail) => shell.evaluate((element, value) => element.dispatchEvent(
    new CustomEvent("matic-workspace-intent", { detail: value, bubbles: true, composed: true }),
  ), detail);
  await intent({ type: "open-workflow", workflow: "history" });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.history.status)).toBe("ready");
  await intent({ type: "set-floor", floorId: "saved-1" });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().selection.floorId)).toBe("saved-1");
  await intent({ type: "set-floor", floorId: "current" });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().selection.floorId)).toBe("current");
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(true);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls
    .filter(({ service }) => ["skip_room", "clean_room_next", "clean_room_again"].includes(service)).length)).toBe(1);

  await page.evaluate(() => window.__panelFixture.releaseService());
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().queuePending)).toBe(false);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().notice)).toBeNull();
});

test("room preview code is requested only when Rooms opens", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  const requests = [];
  page.on("request", (request) => {
    if (/\/chunks\/room-preview-controller-[^/]+\.js$/u.test(request.url())) requests.push(request.url());
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  await expect.poll(() => page.evaluate((tag) =>
    document.querySelector(tag).getWorkspaceSnapshot().map.available, fixture.panelTag)).toBe(true);
  expect(requests).toEqual([]);
  await page.locator(fixture.panelTag).locator("matic-map-shell-v4").evaluate((shell) => shell.dispatchEvent(
    new CustomEvent("matic-workspace-intent", { detail: { type: "open-workflow", workflow: "rooms" }, bubbles: true, composed: true }),
  ));
  await expect.poll(() => requests.length).toBe(1);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls.length)).toBe(0);
});

test("area catalogs stay deferred when their workflow closes during module loading", async ({ page }) => {
  let releaseAreaModule;
  const areaModuleRequest = new Promise((resolve) => {
    page.route("**/map_studio_v4/chunks/area-resources-*.js", (route) => {
      releaseAreaModule = () => resolve(route.continue());
      return new Promise(() => {});
    });
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  expect(await page.evaluate(() => window.__panelFixture.areaRequests)).toEqual([]);
  await panel.getByRole("button", { name: /^Clean custom area/ }).click();
  await expect.poll(() => typeof releaseAreaModule).toBe("function");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areas");
  await panel.getByRole("button", { name: "Back to all tasks", exact: true }).click();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("none");
  releaseAreaModule();
  await areaModuleRequest;
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__panelFixture.areaRequests)).toEqual([]);
});

test("a failed area module waits for explicit retry", async ({ page }) => {
  let areaModuleAttempts = 0;
  await page.route("**/map_studio_v4/chunks/area-resources-*.js", async (route) => {
    areaModuleAttempts += 1;
    if (areaModuleAttempts === 1) await route.abort();
    else await route.continue();
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await panel.getByRole("button", { name: /^Clean custom area/ }).click();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.areas.status)).toBe("error");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.areas.problem)).toBe("area-module-unavailable");
  await expect.poll(() => areaModuleAttempts).toBe(1);
  await page.waitForTimeout(100);
  expect(areaModuleAttempts).toBe(1);
  expect(await page.evaluate(() => window.__panelFixture.areaRequests)).toEqual([]);

  const pageUrl = page.url();
  const reloadRequest = page.waitForRequest((request) => request.isNavigationRequest() && request.url() === pageUrl);
  const reloadResponse = reloadRequest.then((request) => page.waitForResponse((candidate) => candidate.request() === request));
  await panel.getByRole("button", { name: "Try again", exact: true }).click();
  const response = await reloadResponse;
  await response.finished();
  await page.waitForLoadState("load");
  await fixture.remount();
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const resumedPanel = page.locator(fixture.panelTag);
  await expect.poll(() => resumedPanel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areas");
  await expect.poll(() => areaModuleAttempts).toBe(2);
  await expect.poll(() => resumedPanel.evaluate((element) => element.getWorkspaceSnapshot().resources.areas.status)).toBe("ready");
  expect(await page.evaluate(() => window.__panelFixture.areaRequests.map(({ method }) => method))).toEqual(["GET"]);
});

test("plan views load on demand and recover from a failed module", async ({ page }) => {
  let moduleAttempts = 0;
  await page.route("**/map_studio_v4/chunks/plan-views-*.js", async (route) => {
    moduleAttempts += 1;
    if (moduleAttempts === 1) await route.abort();
    else await route.continue();
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  expect(moduleAttempts).toBe(0);
  await panel.getByRole("button", { name: "Your plans", exact: true }).click();
  await expect.poll(() => moduleAttempts).toBe(1);
  await expect(panel.getByRole("button", { name: "Try again", exact: true })).toBeVisible();

  const pageUrl = page.url();
  const request = page.waitForRequest((candidate) => candidate.isNavigationRequest() && candidate.url() === pageUrl);
  const response = request.then((navigation) => page.waitForResponse((candidate) => candidate.request() === navigation));
  await panel.getByRole("button", { name: "Try again", exact: true }).click();
  const navigation = await response;
  await navigation.finished();
  await page.waitForLoadState("load");
  await fixture.remount();
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const resumed = page.locator(fixture.panelTag);
  await expect.poll(() => resumed.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("plans");
  await expect.poll(() => moduleAttempts).toBe(2);
  await expect(resumed.locator("matic-map-plan-views-v4")).toBeVisible();
});

test("a failed plan catalog chunk reloads the workflow on explicit retry", async ({ page }) => {
  let moduleAttempts = 0;
  await page.route("**/map_studio_v4/chunks/plan-catalog-resources-*.js", async (route) => {
    moduleAttempts += 1;
    if (moduleAttempts === 1) await route.abort();
    else await route.continue();
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  // With no persisted shortcuts the fixture has no "Open Plans" recovery
  // link; exercise the actual home task row that opens this catalog.
  await expect(panel.getByRole("button", { name: "Your plans", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Your plans", exact: true }).click();
  await expect.poll(() => moduleAttempts).toBe(1);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.plans.problem)).toBe("plan-module-unavailable");
  await expect(panel.getByRole("button", { name: "Try again", exact: true })).toBeVisible();

  const pageUrl = page.url();
  const request = page.waitForRequest((candidate) => candidate.isNavigationRequest() && candidate.url() === pageUrl);
  const response = request.then((navigation) => page.waitForResponse((candidate) => candidate.request() === navigation));
  await panel.getByRole("button", { name: "Try again", exact: true }).click();
  const navigation = await response;
  await navigation.finished();
  await page.waitForLoadState("load");
  await fixture.remount();
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const resumed = page.locator(fixture.panelTag);
  await expect.poll(() => resumed.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("plans");
  await expect.poll(() => moduleAttempts).toBe(2);
  await expect.poll(() => resumed.evaluate((element) => element.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
});

test("packaged draw overlay failure shows recovery and blocks map and point edits", async ({ page }) => {
  const failedRequests = [];
  await page.route("**/map_studio_v4/chunks/draw-overlays-*.js", async (route) => {
    failedRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await panel.getByRole("button", { name: /^Clean custom area/ }).click();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("areas");
  await panel.getByRole("button", { name: "New area", exact: true }).click();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().workflow)).toBe("draw");
  await expect.poll(() => failedRequests.length).toBe(1);
  const shell = panel.locator("matic-map-shell-v4");
  const canvas = shell.locator("matic-map-canvas-v4");
  await expect(shell.getByRole("alert").filter({ hasText: "Map drawing isn't available" })).toBeVisible();
  await expect(shell.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(canvas.getByRole("spinbutton", { name: /coordinate for point/u })).toHaveCount(0);

  const before = await panel.evaluate((element) => element.getWorkspaceSnapshot().draw);
  const map = canvas.locator(".map-root");
  const bounds = await map.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.55, { steps: 4 });
  await page.mouse.up();
  await map.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().draw)).toEqual(before);
});

test("Stop works when every optional JavaScript download fails @safety", async ({ page }) => {
  const startup = new Set(Object.keys(startupGraph()).map((path) => `/${path}`));
  await page.route("**/map_studio_v4/**/*.js", (route) => startup.has(new URL(route.request().url()).pathname)
    ? route.continue() : route.abort());
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialRobotStates: { "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry" } } },
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().activity)).toBe("cleaning");
  await panel.getByRole("button", { name: "Stop cleaning", exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.serviceCalls
    .filter(({ service }) => service === "stop_intelligent_cleaning").length)).toBe(1);
});
