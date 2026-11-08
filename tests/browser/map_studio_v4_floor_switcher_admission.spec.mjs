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

test("history invalidations refresh saved-map availability without changing the floor count", async ({ page }) => {
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialCatalogEntries: [{ ...entry(2), live_workspace_transport_enabled: true }],
    workspacePush: true,
    userData: {},
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const selector = panel.locator("select.floor-switcher option");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await expect(selector).toHaveText(["Home", "Loft"]);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.historyReads)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.workspaceSubscriptions)).toBeGreaterThan(0);
  const generation = await panel.evaluate((element) => element.getWorkspaceSnapshot().generation);
  const savedSnapshots = await page.evaluate(() => window.__panelFixture.getHistory().floors[1].snapshots);

  await page.evaluate(() => {
    const fixture = window.__panelFixture;
    const updated = fixture.getHistory();
    updated.floors[1].snapshots = [];
    fixture.setHistory(updated);
    fixture.sendWorkspaceEnvelope({ type: "invalidate", invalidation: {
      epoch: "synthetic-workspace-epoch",
      sequence: 1,
      coherence_generation: 1,
      revisions: { workspace: 1, history: 1 },
      resources: ["history"],
    } });
  });
  await expect(selector).toHaveText(["Home", "Loft · No saved map for this floor yet"]);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.historyReads)).toBe(2);

  await page.evaluate((savedSnapshots) => {
    const fixture = window.__panelFixture;
    const updated = fixture.getHistory();
    updated.floors[1].snapshots = savedSnapshots;
    fixture.setHistory(updated);
    fixture.sendWorkspaceEnvelope({ type: "invalidate", invalidation: {
      epoch: "synthetic-workspace-epoch",
      sequence: 2,
      coherence_generation: 1,
      revisions: { workspace: 2, history: 2 },
      resources: ["history"],
    } });
  }, savedSnapshots);
  await expect(selector).toHaveText(["Home", "Loft"]);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.historyReads)).toBe(3);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().generation)).toBe(generation);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().resources.entry.historyFloorCount)).toBe(2);
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

const mountHistoryProbe = async (page, { hold = false, failures = 0, wrongEntry = 0 } = {}) => {
  const fixture = await installPanelFixture(page, { moduleSource: "packaged", initialCatalogEntries: [entry(2)] });
  await page.evaluate(({ hold, failures, wrongEntry }) => {
    const panel = window.__panelFixture.createPanel();
    const original = panel.hass.fetchWithAuth;
    const probe = window.__historyProbe = { hold, failures, wrongEntry, count: 2, reads: 0, aborted: 0 };
    panel.hass = { ...panel.hass, fetchWithAuth: async (path, init) => {
      if (!path.includes("slam_history/")) return original(path, init);
      probe.reads += 1;
      if (probe.failures > 0) { probe.failures -= 1; return new Response(null, { status: 503 }); }
      if (probe.hold) return new Promise((resolve, reject) => {
        probe.release = () => resolve(original(path, init));
        init?.signal?.addEventListener("abort", () => { probe.aborted += 1; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
      const response = await original(path, init);
      const data = await response.json();
      if (probe.wrongEntry > 0) {
        probe.wrongEntry -= 1;
        data.entry_id = "other-robot";
        data.floors[1].label = "Other robot's floor";
      }
      if (probe.count === 1) data.floors = data.floors.slice(0, 1);
      if (probe.count === 3) data.floors.push({ ...data.floors[1], id: "saved-2", ordinal: 3, label: "Basement", snapshots: [] });
      return Response.json(data);
    } };
    document.body.append(panel);
  }, { hold, failures, wrongEntry });
  return page.locator(fixture.panelTag);
};

test("pending floor discovery survives repeated Home Assistant updates", async ({ page }) => {
  const panel = await mountHistoryProbe(page, { hold: true });
  await expect.poll(() => page.evaluate(() => window.__historyProbe.reads)).toBe(1);
  await expect.poll(() => panel.evaluate(element => element.getWorkspaceSnapshot().resources.history.status)).toBe("loading");
  await panel.evaluate(async element => {
    for (let index = 0; index < 10; index += 1) {
      element.hass = { ...element.hass, states: { ...element.hass.states } };
      await element.updateComplete;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  });
  expect(await page.evaluate(() => [window.__historyProbe.reads, window.__historyProbe.aborted])).toEqual([1, 0]);
  await page.evaluate(() => { window.__historyProbe.hold = false; window.__historyProbe.release(); });
  await expect(panel.locator("select.floor-switcher option")).toHaveText(["Home", "Loft"]);
});

test("floor discovery retries a transient history response", async ({ page }) => {
  const panel = await mountHistoryProbe(page, { failures: 1 });
  await expect.poll(() => panel.evaluate(element => element.getWorkspaceSnapshot().resources.history.status)).toBe("ready");
  await expect(panel.locator("select.floor-switcher option")).toHaveText(["Home", "Loft"]);
  expect(await page.evaluate(() => window.__historyProbe.reads)).toBe(2);
});

test("floor discovery rejects another robot's reply and retries the selected robot", async ({ page }) => {
  const panel = await mountHistoryProbe(page, { wrongEntry: 1 });
  await expect.poll(() => panel.evaluate(element => element.getWorkspaceSnapshot().resources.history.status)).toBe("error");
  expect(await panel.evaluate(element => element.getWorkspaceSnapshot().resources.history.value)).toBeNull();
  await expect(panel.locator("select.floor-switcher option")).not.toHaveText(["Home", "Other robot's floor"]);
  await expect(panel.locator("select.floor-switcher option")).toHaveText(["Home", "Loft"]);
  expect(await page.evaluate(() => window.__historyProbe.reads)).toBe(2);
});

test("catalog polling refreshes added and removed floors without changing the live frame", async ({ page }) => {
  test.setTimeout(40_000);
  const panel = await mountHistoryProbe(page);
  const selector = panel.locator("select.floor-switcher option");
  await expect(selector).toHaveText(["Home", "Loft"]);
  const generation = await panel.evaluate(element => element.getWorkspaceSnapshot().generation);
  for (const [count, labels] of [[3, ["Home", "Loft", "Basement · No saved map for this floor yet"]], [1, ["Home"]]]) {
    await page.evaluate(({ catalogEntry, count }) => {
      window.__historyProbe.count = count;
      window.__panelFixture.setCatalogEntries([catalogEntry]);
    }, { catalogEntry: entry(count), count });
    await expect(selector).toHaveText(labels, { timeout: 15_000 });
    expect(await panel.evaluate(element => element.getWorkspaceSnapshot().generation)).toBe(generation);
  }
  expect(await page.evaluate(() => window.__historyProbe.reads)).toBe(3);
});

test("failed floor discovery stops automatic retries and allows an explicit retry", async ({ page }) => {
  const panel = await mountHistoryProbe(page, { failures: 10 });
  await expect.poll(() => page.evaluate(() => window.__historyProbe.reads), { timeout: 8000 }).toBe(3);
  await expect.poll(() => panel.evaluate(element => element.getWorkspaceSnapshot().resources.history.status)).toBe("error");
  await page.clock.install();
  await page.clock.runFor(10_000);
  expect(await page.evaluate(() => window.__historyProbe.reads)).toBe(3);
  await page.evaluate(() => { window.__historyProbe.failures = 0; });
  await panel.locator("matic-map-shell-v4").evaluate(element => element.dispatchEvent(new CustomEvent("matic-workspace-intent", {
    detail: { type: "refresh-history" }, bubbles: true, composed: true,
  })));
  await page.clock.runFor(100);
  await expect.poll(() => panel.evaluate(element => element.getWorkspaceSnapshot().resources.history.status)).toBe("ready");
  expect(await page.evaluate(() => window.__historyProbe.reads)).toBe(4);
});
