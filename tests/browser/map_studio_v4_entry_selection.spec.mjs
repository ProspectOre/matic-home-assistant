import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const secondEntry = () => ({
  entry_id: "synthetic-entry-b",
  scene_url: "/api/matic_robot/slam_scene/synthetic-b",
  delta_url: null,
  pose_url: "/api/matic_robot/slam_pose/synthetic-b",
  history_url: "/api/matic_robot/slam_history/synthetic-b",
  areas_url: "/api/matic_robot/areas/synthetic-b",
  plans_url: "/api/matic_robot/plans/synthetic-b",
  map_revision: 7,
  map_floor_coherent: true,
  map_session_verified: true,
  map_session_key: "b".repeat(64),
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

async function mountTwoRobotPanel(page) {
  const entryB = secondEntry();
  const entryA = {
    ...entryB,
    entry_id: "synthetic-entry",
    map_session_key: "a".repeat(64),
    scene_url: entryB.scene_url.replace("synthetic-b", "synthetic"),
    pose_url: entryB.pose_url.replace("synthetic-b", "synthetic"),
    history_url: entryB.history_url.replace("synthetic-b", "synthetic"),
    areas_url: entryB.areas_url.replace("synthetic-b", "synthetic"),
    plans_url: entryB.plans_url.replace("synthetic-b", "synthetic"),
  };
  const robotStates = {
      "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry" } },
      "vacuum.synthetic_b": { state: "docked", attributes: { matic_entry_id: "synthetic-entry-b" } },
  };
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialCatalogEntries: [entryA, entryB],
    initialRobotStates: robotStates,
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const selector = page.locator("select.robot-switcher");
  await expect(selector.locator("option")).toHaveCount(2);
  await expect.poll(() => page.locator(fixture.panelTag).evaluate((panel) =>
    panel.getWorkspaceSnapshot().selection.entryId)).toBe("synthetic-entry");
  return { fixture, selector, entryA };
}

test("@safety robot selector follows the requested entry while its catalog is pending", async ({ page }) => {
  const { fixture, selector } = await mountTwoRobotPanel(page);
  const initialGeneration = await page.locator(fixture.panelTag).evaluate((panel) =>
    panel.getWorkspaceSnapshot().generation);

  await page.evaluate(() => window.__panelFixture.deferNextCatalog());
  await selector.selectOption("synthetic-entry-b");
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingCatalogCount())).toBe(1);

  await expect(selector).toHaveValue("synthetic-entry-b");
  const pending = await page.locator(fixture.panelTag).evaluate((panel) => panel.getWorkspaceSnapshot());
  expect(pending.selection.entryId).toBe("synthetic-entry-b");
  expect(pending.resources.entry).toBeNull();
  expect(pending.map.available).toBe(false);
  expect(pending.generation).toBeGreaterThan(initialGeneration);

  await page.evaluate(() => window.__panelFixture.releaseCatalog());
  await expect.poll(() => page.locator(fixture.panelTag).evaluate((panel) => {
    const state = panel.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.entry?.entryId];
  })).toEqual(["synthetic-entry-b", "synthetic-entry-b"]);
  await expect(selector).toHaveValue("synthetic-entry-b");
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});

test("@safety rapid switchback admits the latest requested entry after a stale catalog settles", async ({ page }) => {
  const { fixture, selector } = await mountTwoRobotPanel(page);
  await page.evaluate(() => window.__panelFixture.deferNextCatalog());
  await selector.selectOption("synthetic-entry-b");
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingCatalogCount())).toBe(1);

  await selector.selectOption("synthetic-entry");
  await expect(selector).toHaveValue("synthetic-entry");
  await page.evaluate(() => window.__panelFixture.releaseCatalog());

  await expect.poll(() => page.locator(fixture.panelTag).evaluate((panel) => {
    const state = panel.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.entry?.entryId];
  })).toEqual(["synthetic-entry", "synthetic-entry"]);
  await expect(selector).toHaveValue("synthetic-entry");
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});

test("@safety switching entries closes open layers without leaving phantom browser history", async ({ page }) => {
  const { fixture, selector } = await mountTwoRobotPanel(page);
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.available)).toBe(true);
  await panel.evaluate((element) => {
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "open-workflow", workflow: "rooms" }, bubbles: true, composed: true,
    }));
  });
  await panel.evaluate((element) => {
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "enter-full-map" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.workflow, state.fullMap];
  })).toEqual(["rooms", true]);
  await expect.poll(() => page.evaluate(() => history.state?.maticMapLayer?.depth ?? 0)).toBe(2);

  await selector.selectOption("synthetic-entry-b");
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.workflow, state.fullMap];
  })).toEqual(["synthetic-entry-b", "none", false]);
  await expect.poll(() => page.evaluate(() => history.state?.maticMapLayer?.depth ?? 0)).toBe(0);

  await page.evaluate(() => history.pushState({ selectionProbe: true }, "", `${location.pathname}#selection-probe`));
  await page.evaluate(async () => {
    const popped = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    history.back();
    await popped;
  });
  expect(await panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return { entryId: state.selection.entryId, workflow: state.workflow, fullMap: state.fullMap };
  })).toEqual({ entryId: "synthetic-entry-b", workflow: "none", fullMap: false });
  expect(await page.evaluate(() => history.state?.maticMapLayer ?? null)).toBeNull();
});

test("@safety the same user regains map access immediately after administrator access returns", async ({ page }) => {
  const clockAnchor = new Date("2026-09-30T12:00:00Z");
  await page.clock.install({ time: clockAnchor });
  await page.clock.pauseAt(clockAnchor);
  const { fixture } = await mountTwoRobotPanel(page);
  const panel = page.locator(fixture.panelTag);
  await panel.evaluate((element) => {
    element.hass = { ...element.hass, user: { ...element.hass.user, is_admin: false } };
  });
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.host.administrator, state.resources.entry, state.coherence];
  })).toEqual([false, null, "blocked"]);

  const readsBeforeRecovery = await page.evaluate(() => window.__panelFixture.catalogReads);
  await panel.evaluate((element) => {
    element.hass = { ...element.hass, user: { ...element.hass.user, is_admin: true } };
  });
  await expect.poll(() => page.evaluate(() => window.__panelFixture.catalogReads)).toBeGreaterThan(readsBeforeRecovery);
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.host.administrator, state.resources.entry?.entryId, state.resources.catalog.status];
  })).toEqual([true, "synthetic-entry", "ready"]);
});


test("@safety entry removal revokes a pending selection before its stale catalog returns", async ({ page }) => {
  const { fixture, selector, entryA } = await mountTwoRobotPanel(page);
  await page.evaluate(() => window.__panelFixture.deferNextCatalog());
  await selector.selectOption("synthetic-entry-b");
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingCatalogCount())).toBe(1);
  const selectedGeneration = await page.locator(fixture.panelTag).evaluate((panel) =>
    panel.getWorkspaceSnapshot().generation);

  await page.locator(fixture.panelTag).evaluate((panel, entry) => {
    window.__panelFixture.setCatalogEntries([entry]);
    panel.hass = { ...panel.hass, states: { "vacuum.synthetic": panel.hass.states["vacuum.synthetic"] } };
  }, entryA);
  await expect.poll(() => page.locator(fixture.panelTag).evaluate((panel) => {
    const state = panel.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.entry?.entryId ?? null];
  })).toEqual(["synthetic-entry-b", null]);
  const revoked = await page.locator(fixture.panelTag).evaluate((panel) => panel.getWorkspaceSnapshot());
  expect(revoked.generation).toBeGreaterThan(selectedGeneration);
  expect(revoked.map.available).toBe(false);

  await page.evaluate(() => window.__panelFixture.releaseCatalog());
  await expect.poll(() => page.locator(fixture.panelTag).evaluate((panel) => {
    const state = panel.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.entry?.entryId ?? null];
  })).toEqual(["synthetic-entry-b", null]);
  expect(await page.locator(fixture.panelTag).evaluate((panel) => panel.getWorkspaceSnapshot().map.available))
    .toBe(false);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});

test("@safety a removed requested robot never falls back to another loaded robot", async ({ page }) => {
  const anchor = new Date("2026-09-30T12:00:00Z");
  await page.clock.install({ time: anchor });
  await page.clock.pauseAt(anchor);
  const { fixture, selector, entryA } = await mountTwoRobotPanel(page);
  const panel = page.locator(fixture.panelTag);
  await selector.selectOption("synthetic-entry-b");
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.map.available && state.map.exactPose
      && state.resources.entry?.entryId === "synthetic-entry-b";
  })).toBe(true);

  await panel.evaluate((element) => {
    const originalFetch = element.hass.fetchWithAuth;
    window.__removedEntryProbe = { spatialReads: [] };
    element.hass = {
      ...element.hass,
      fetchWithAuth: async (path, init) => {
        if (/\/slam_(?:scene|pose)\//.test(path)) {
          window.__removedEntryProbe.spatialReads.push(path.split("?", 1)[0]);
        }
        return originalFetch(path, init);
      },
    };
  });

  const readsBeforeRemoval = await page.evaluate(() => window.__panelFixture.catalogReads);
  await page.locator(fixture.panelTag).evaluate((element, retainedEntry) => {
    window.__panelFixture.setCatalogEntries([retainedEntry]);
    element.hass = {
      ...element.hass,
      states: {
        "vacuum.synthetic": {
          state: "cleaning",
          attributes: { matic_entry_id: "synthetic-entry", friendly_name: "Unselected robot" },
        },
      },
    };
  }, entryA);
  await panel.evaluate((element) => {
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-action", {
      detail: { id: "recheck-status" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => page.evaluate(() => window.__panelFixture.catalogReads))
    .toBeGreaterThan(readsBeforeRemoval);
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.entry?.entryId ?? null];
  })).toEqual(["synthetic-entry-b", null]);

  const unavailable = await panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return {
      selectedEntryId: state.selection.entryId,
      resourceEntry: state.resources.entry,
      mapAvailable: state.map.available,
      exactPose: state.map.exactPose,
    };
  });
  expect(unavailable).toMatchObject({
    selectedEntryId: "synthetic-entry-b",
    resourceEntry: null,
    mapAvailable: false,
    exactPose: false,
  });
  const robotSwitcher = panel.locator("select.robot-switcher");
  await expect(robotSwitcher).toHaveValue("synthetic-entry-b");
  expect(await robotSwitcher.locator("option").evaluateAll((options) => options.map((option) => option.value)))
    .toEqual(["synthetic-entry-b", "synthetic-entry"]);

  await panel.evaluate((element) => {
    const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
    for (const id of ["stop", "save-area", "save-plan"]) {
      shell.dispatchEvent(new CustomEvent("matic-workspace-action", {
        detail: { id }, bubbles: true, composed: true,
      }));
    }
  });
  expect(await page.evaluate(() => window.__removedEntryProbe.spatialReads)).toEqual([]);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);

  await robotSwitcher.selectOption("synthetic-entry");
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.selection.entryId, state.resources.entry?.entryId ?? null];
  })).toEqual(["synthetic-entry", "synthetic-entry"]);
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.map.available && state.map.exactPose;
  })).toBe(true);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});
