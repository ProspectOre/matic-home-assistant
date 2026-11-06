import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const entry = (id, slug, session) => ({
  entry_id: id,
  scene_url: `/api/matic_robot/slam_scene/${slug}`,
  delta_url: null,
  pose_url: `/api/matic_robot/slam_pose/${slug}`,
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

const twoEntriesWithLayers = () => entries.slice(0, 2).map((item, index) => ({
  ...item,
  wifi_heatmap_url: `/api/matic_robot/wifi_heatmap/${index ? "synthetic-b" : "synthetic"}`,
  floor_layers_url: `/api/matic_robot/floor_layers/${index ? "synthetic-b" : "synthetic"}`,
  coverage_url: `/api/matic_robot/live_coverage/${index ? "synthetic-b" : "synthetic"}`,
}));

const dispatchIntent = (panel, detail) => panel.evaluate((element, intent) =>
  element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
    detail: intent, bubbles: true, composed: true,
  })), detail);

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

const mountLongNamePanel = async (page) => {
  const longName = "Downstairs Matic robot with a deliberately long household name";
  const longNameB = "Upstairs Matic robot with a deliberately long household name";
  const states = {
    "vacuum.downstairs": { state: "idle", attributes: { matic_entry_id: entries[0].entry_id, friendly_name: longName } },
    "vacuum.upstairs": { state: "docked", attributes: { matic_entry_id: entries[1].entry_id, friendly_name: longNameB } },
  };
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged", initialCatalogEntries: entries.slice(0, 2), initialRobotStates: states,
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const selector = panel.locator("select.robot-switcher");
  return { panel, selector, entries: entries.slice(0, 2), longName, longNameB };
};

test("native robot picker keeps long names keyboard reachable and clear at normal viewport widths", async ({ page }) => {
  const { panel, selector, entries: robotEntries, longName, longNameB } = await mountLongNamePanel(page);
  for (const width of [320, 390, 768, 1180]) {
    await page.setViewportSize({ width, height: 844 });
      const options = await selector.locator("option").evaluateAll((nodes) => nodes.map((option) => ({
        value: option.value, label: option.textContent.trim(),
      })));
      expect(options).toEqual([
        { value: robotEntries[0].entry_id, label: longName },
        { value: robotEntries[1].entry_id, label: longNameB },
      ]);

      const dimensions = await selector.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const other = element.getRootNode().querySelector(".toolbar-actions")?.getBoundingClientRect();
        const root = element.getRootNode().querySelector(".app").getBoundingClientRect();
        const overlaps = other && rect.left < other.right && rect.right > other.left
          && rect.top < other.bottom && rect.bottom > other.top;
        return { width: rect.width, height: rect.height, overlaps: Boolean(overlaps), visible: rect.width > 0 && rect.height > 0,
          clipped: rect.left < root.left || rect.right > root.right };
      });
      expect(dimensions.visible, `picker visible at ${width}px (normal)`).toBe(true);
      expect(dimensions.height, `44px touch target at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(dimensions.width, `44px inline touch target at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(dimensions.overlaps, `picker does not overlap toolbar actions at ${width}px`).toBe(false);
      expect(dimensions.clipped, `picker stays inside the app at ${width}px`).toBe(false);

      await selector.focus();
      await expect(selector).toBeFocused();
      await selector.press("u");
      await selector.press("Tab");
      await expect(selector).toHaveValue(robotEntries[1].entry_id);
      await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().selection.entryId))
        .toBe(robotEntries[1].entry_id);
      await selector.selectOption(robotEntries[0].entry_id);
      await expect(selector).toHaveValue(robotEntries[0].entry_id);
  }
});

test("native robot picker remains visible and separate from actions in actual fullscreen", async ({ page }) => {
  const { panel, selector } = await mountLongNamePanel(page);
  for (const width of [320, 390, 768, 1180]) {
    await page.setViewportSize({ width, height: 844 });
    await panel.locator("button.workspace-toggle").click();
    const enteredFullscreen = await page.waitForFunction(() => Boolean(document.fullscreenElement), null, { timeout: 3000 })
      .then(() => true, () => false);
    test.skip(!enteredFullscreen, `${test.info().project.name} headless browser refused native fullscreen`);
    await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().fullMap)).toBe(true);
    const dimensions = await selector.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const actions = element.getRootNode().querySelector(".toolbar-actions").getBoundingClientRect();
      const root = element.getRootNode().querySelector(".app").getBoundingClientRect();
      return { width: rect.width, height: rect.height,
        overlaps: rect.left < actions.right && rect.right > actions.left && rect.top < actions.bottom && rect.bottom > actions.top,
        clipped: rect.left < root.left || rect.right > root.right };
    });
    expect(dimensions.width).toBeGreaterThanOrEqual(44);
    expect(dimensions.height).toBeGreaterThanOrEqual(44);
    expect(dimensions.overlaps).toBe(false);
    expect(dimensions.clipped).toBe(false);
    await page.keyboard.press("Escape");
    await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().fullMap)).toBe(false);
  }
});

test("duplicate and missing friendly names stay distinct in native entry choices", async ({ page }) => {
  const cases = [
    {
      states: {
        "vacuum.downstairs": { state: "idle", attributes: { matic_entry_id: entries[0].entry_id, friendly_name: "Matic" } },
        "vacuum.upstairs": { state: "docked", attributes: { matic_entry_id: entries[1].entry_id, friendly_name: "Matic" } },
      },
      labels: ["downstairs · Matic", "upstairs · Matic"],
    },
    {
      states: {
        "vacuum.downstairs": { state: "idle", attributes: { matic_entry_id: entries[0].entry_id } },
        "vacuum.upstairs": { state: "docked", attributes: { matic_entry_id: entries[1].entry_id } },
      },
      labels: ["downstairs · Robot", "upstairs · Robot"],
    },
  ];
  for (const scenario of cases) {
    const fixture = await installPanelFixture(page, {
      moduleSource: "packaged", initialCatalogEntries: entries.slice(0, 2), initialRobotStates: scenario.states,
    });
    await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
    const panel = page.locator(fixture.panelTag);
    const options = panel.locator("select.robot-switcher option");
    await expect(options).toHaveCount(2);
    expect(await options.evaluateAll((nodes) => nodes.map((option) => [option.value, option.textContent.trim()])))
      .toEqual([[entries[0].entry_id, scenario.labels[0]], [entries[1].entry_id, scenario.labels[1]]]);
    await page.locator(fixture.panelTag).evaluate((element) => element.remove());
  }
});

test("late Wi-Fi and floor material from robot A cannot replace robot B data", async ({ page }) => {
  const entriesWithLayers = twoEntriesWithLayers().map((item) => ({ ...item, native_session_active: true }));
  const wifiA = { enabled: true, cell_size: 0.5, cells: [{ x: 1, y: 2, dbm: -41 }] };
  const wifiB = { enabled: true, cell_size: 0.5, cells: [{ x: 8, y: 9, dbm: -82 }] };
  const materialsA = { entry_id: "synthetic", page_count: 1, truncated: false, layers: { carpet: [[[1, 1], [2, 1], [2, 2]]], vent: [] } };
  const materialsB = { entry_id: "synthetic-b", page_count: 1, truncated: false, layers: { carpet: [[[8, 8], [9, 8], [9, 9]]], vent: [] } };
  const coverageA = { active: true, map_session_key: "a".repeat(64), cell_size: 0.015, truncated: true,
    coverage_basis: "observed_changes", runs: [[1, 1, 1, 1]] };
  const coverageB = { active: true, map_session_key: "b".repeat(64), cell_size: 0.015, truncated: true,
    coverage_basis: "observed_changes", runs: [[8, 9, 1, 1]] };
  const cleaningStates = {
    "vacuum.robot_a": { state: "cleaning", attributes: { matic_entry_id: entries[0].entry_id } },
    "vacuum.robot_b": { state: "cleaning", attributes: { matic_entry_id: entries[1].entry_id } },
  };
  const trailA = { trail: "live", map_session_key: "a".repeat(64), segments: [[[1, 2], [2, 3]]] };
  const trailB = { trail: "live", map_session_key: "b".repeat(64), segments: [[[8, 9], [9, 10]]] };
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged", initialCatalogEntries: entriesWithLayers,
    initialRobotStates: cleaningStates,
    posePositionB: [8, 9], wifiSignal: wifiA, wifiSignalB: wifiB, floorTypes: materialsA, floorTypesB: materialsB,
    cleaningCoverage: coverageA, cleaningCoverageB: coverageB, runTrail: trailA, runTrailB: trailB,
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(fixture.panelTag);
  const selector = panel.locator("select.robot-switcher");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await page.evaluate(() => {
    window.__panelFixture.deferNextWifiRead();
    window.__panelFixture.deferNextFloorTypeRead();
  });
  await dispatchIntent(panel, { type: "toggle-wifi-signal" });
  await dispatchIntent(panel, { type: "toggle-floor-type", item: "carpet" });
  await dispatchIntent(panel, { type: "show-trail", trail: "live" });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().trail?.segments?.[0]?.[0]?.[0])).toBe(1);
  await expect.poll(() => panel.evaluate((element, prefix) => element.getWorkspaceSnapshot().liveCoverage?.frameKey?.startsWith(prefix),
    `${entries[0].entry_id}|`)).toBe(true);
  await expect.poll(() => page.evaluate(() => [
    window.__panelFixture.pendingWifiReadCount(), window.__panelFixture.pendingFloorTypeReadCount(),
  ])).toEqual([1, 1]);
  await page.evaluate(() => window.__panelFixture.deferNextCatalog());
  await selector.selectOption(entries[1].entry_id);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingCatalogCount())).toBe(1);
  const duringEntrySwitch = await panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    const entry = state.resources.entry;
    return {
      selection: state.selection.entryId,
      entryId: entry?.entryId ?? null,
      mapAvailable: state.map.available,
      wifi: state.wifiSignal,
      floorTypes: state.floorTypes,
      coverage: state.liveCoverage,
      trailCurrent: Boolean(state.trail && entry && state.trail.mapSessionKey === entry.mapSessionKey),
    };
  });
  expect(duringEntrySwitch).toEqual({ selection: entries[1].entry_id, entryId: null, mapAvailable: false,
    wifi: null, floorTypes: null, coverage: null, trailCurrent: false });
  await page.evaluate(() => { window.__holdCleaningCoverage = true; });
  await page.evaluate(() => window.__panelFixture.releaseCatalog());
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.entry?.entryId, state.map.available];
  })).toEqual([entries[1].entry_id, entries[1].entry_id, true]);
  const staleLayerProvenance = await panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    const entry = state.resources.entry;
    return {
      oldCoverageIsCurrent: Boolean(state.liveCoverage && entry
        && state.liveCoverage.frameKey.startsWith(`${entry.entryId}|`)),
      oldTrailIsCurrent: Boolean(state.trail && entry && state.trail.mapSessionKey === entry.mapSessionKey),
      oldMaterialWasCleared: state.floorTypes === null,
    };
  });
  expect(staleLayerProvenance).toEqual({ oldCoverageIsCurrent: false, oldTrailIsCurrent: false, oldMaterialWasCleared: true });
  await dispatchIntent(panel, { type: "toggle-wifi-signal" });
  await dispatchIntent(panel, { type: "toggle-floor-type", item: "carpet" });
  await dispatchIntent(panel, { type: "show-trail", trail: "live" });
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.resources.pose.value?.position, state.wifiSignal?.cells[0]?.x,
      state.floorTypes?.carpet?.[0]?.[0]?.[0], state.liveCoverage?.runs?.[0]?.[0],
      state.trail?.segments?.[0]?.[0]?.[0]];
  })).toEqual([[8, 9], 8, 8, undefined, 8]);
  expect(await panel.evaluate((element) => element.getWorkspaceSnapshot().liveCoverage)).toBeNull();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseCleaningCoverage)).toBe("function");
  await page.evaluate(() => {
    window.__holdCleaningCoverage = false;
    window.__releaseCleaningCoverage();
    delete window.__releaseCleaningCoverage;
  });
  await expect.poll(() => panel.evaluate((element, prefix) => {
    const coverage = element.getWorkspaceSnapshot().liveCoverage;
    return [coverage?.frameKey?.startsWith(prefix), coverage?.runs?.[0]?.[0]];
  }, `${entries[1].entry_id}|`)).toEqual([true, 8]);

  await page.evaluate(() => {
    window.__panelFixture.releaseWifiRead();
    window.__panelFixture.releaseFloorTypeRead();
  });
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.pose.value?.position,
      state.wifiSignal?.cells[0]?.x, state.floorTypes?.carpet?.[0]?.[0]?.[0],
      state.liveCoverage?.runs?.[0]?.[0], state.trail?.segments?.[0]?.[0]?.[0]];
  })).toEqual([entries[1].entry_id, [8, 9], 8, 8, 8, 8]);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});
