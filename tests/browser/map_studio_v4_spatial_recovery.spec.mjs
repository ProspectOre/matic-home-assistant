import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";
import { liveScene, pageId, sceneMetadata } from "./scene_manifest_fixture.mjs";

const sessionB = "b".repeat(64);

function entry(entryId, suffix, sessionKey) {
  return {
    entry_id: entryId,
    scene_url: `/api/matic_robot/slam_scene/${suffix}`,
    history_url: `/api/matic_robot/slam_history/${suffix}`,
    areas_url: `/api/matic_robot/areas/${suffix}`,
    plans_url: `/api/matic_robot/plans/${suffix}`,
    map_revision: 7,
    map_floor_coherent: true,
    map_session_verified: true,
    map_session_key: sessionKey,
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
  };
}

async function routeMotionSelector(page) {
  const bundle = await build({
    entryPoints: ["frontend/map-studio-v4/state.ts"],
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/state-selectors-probe.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
}

test("@safety pose and revision wait failures share one bounded recovery retry", async ({ page }) => {
  const anchor = new Date("2026-09-30T12:00:00Z");
  await page.clock.install({ time: anchor });
  await page.clock.pauseAt(anchor);
  await routeMotionSelector(page);
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    initialCatalogEntries: [entry("synthetic-entry", "synthetic", "a".repeat(64)),
      entry("synthetic-entry-b", "synthetic-b", sessionB)],
    initialRobotStates: {
      "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry" } },
      "vacuum.synthetic_b": { state: "docked", attributes: { matic_entry_id: "synthetic-entry-b" } },
    },
  });
  // Robot B's live scene is a manifest, so it is followed by revision waits.
  const sceneB = liveScene(sceneMetadata({ origin: [10, 10], span: [100, 80] }),
    [{ x: 0, y: 0, id: pageId(1), floor: 1, points: [[11, 11, 0, 90, 90, 90]] }]);
  await page.evaluate((sceneB) => {
    const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const panel = window.__panelFixture.createPanel();
    const originalFetch = panel.hass.fetchWithAuth;
    const pendingSceneReleases = [];
    const probe = window.__spatialRecoveryProbe = {
      followReads: 0,
      followFailures: 0,
      sceneReads: 0,
      sceneAborts: 0,
      sceneHolds: 0,
      failFollow: false,
      pendingSceneCount: () => pendingSceneReleases.length,
      releaseNextScene: () => {
        const release = pendingSceneReleases.shift();
        if (!release) throw new Error("no deferred replacement scene");
        release();
      },
    };
    panel.hass = {
      ...panel.hass,
      fetchWithAuth: async (path, init) => {
        const probe = window.__spatialRecoveryProbe;
        const requestPath = path.split("?", 1)[0];
        if (requestPath.endsWith("slam_scene/synthetic-b/pages")) {
          return new Response(decode(Object.values(sceneB.pages)[0]), { headers: { "Content-Type": "application/octet-stream" } });
        }
        if (requestPath.endsWith("slam_scene/synthetic-b") && path.includes("since=")) {
          probe.followReads += 1;
          const fail = probe.failFollow;
          if (fail) probe.followFailures += 1;
          return fail
            ? new Response("unavailable", { status: 503 })
            : new Response(null, { status: 204, headers: { "X-Matic-Revision": "7" } });
        }
        if (requestPath.endsWith("slam_scene/synthetic-b")) {
          probe.sceneReads += 1;
          init?.signal?.addEventListener("abort", () => { probe.sceneAborts += 1; }, { once: true });
          const response = new Response(decode(sceneB.manifest), {
            headers: { "Content-Type": "application/vnd.matic.slam-manifest", "X-Matic-Revision": "7" },
          });
          if (probe.sceneHolds > 0) {
            probe.sceneHolds -= 1;
            return new Promise((resolve) => pendingSceneReleases.push(() => resolve(response)));
          }
          return response;
        }
        return originalFetch(path, init);
      },
    };
    document.body.append(panel);
  }, sceneB);
  const panel = page.locator(fixture.panelTag);
  await expect(panel.locator("select.robot-switcher")).toHaveValue("synthetic-entry");
  await panel.locator("select.robot-switcher").selectOption("synthetic-entry-b");
  await expect(panel.locator("select.robot-switcher")).toHaveValue("synthetic-entry-b");
  await expect.poll(() => panel.evaluate((element) =>
    element.getWorkspaceSnapshot().resources.entry?.entryId)).toBe("synthetic-entry-b");
  // The workspace subscription, which brings the pose, opens once the map is drawn.
  await page.clock.runFor(2_100);
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.map.available && state.map.exactPose && state.resources.entry?.entryId === "synthetic-entry-b";
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__spatialRecoveryProbe.followReads)).toBeGreaterThan(0);
  const beforeFault = await page.evaluate(() => window.__panelFixture.catalogReads);
  const baselineFrame = await panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return { generation: state.generation, sceneReads: window.__spatialRecoveryProbe.sceneReads };
  });
  const mismatchedPose = () => page.evaluate(() => window.__panelFixture.pushPose([1, 1], { map_session_key: "c".repeat(64) }));
  // The robot keeps reporting, so the pose outlives fast-forwards past its freshness window.
  const robotReports = () => page.evaluate(() => window.__panelFixture.pushPose([1, 1]));
  await page.evaluate(() => {
    window.__spatialRecoveryProbe.failFollow = false;
    window.__spatialRecoveryProbe.sceneHolds = 1;
  });
  await mismatchedPose();
  await expect.poll(() => page.evaluate(() => window.__spatialRecoveryProbe.pendingSceneCount())).toBe(1);
  const oneRecoveryCatalog = await page.evaluate(() => window.__panelFixture.catalogReads);
  expect(oneRecoveryCatalog).toBeGreaterThan(beforeFault);
  const heldPoseAndScene = await panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return {
      generation: state.generation,
      available: state.map.available,
      readOnly: state.floor.readOnly,
      exactPose: state.map.exactPose,
      sceneReads: window.__spatialRecoveryProbe.sceneReads,
      sceneAborts: window.__spatialRecoveryProbe.sceneAborts,
    };
  });
  expect(heldPoseAndScene).toMatchObject({
    generation: expect.any(Number), available: true, readOnly: true, exactPose: false,
    sceneReads: baselineFrame.sceneReads + 1, sceneAborts: 0,
  });
  expect(heldPoseAndScene.generation).toBeGreaterThan(baselineFrame.generation);
  expect(await panel.evaluate(async (element) => {
    const { canStartMotion } = await import("/state-selectors-probe.js");
    return canStartMotion(element.getWorkspaceSnapshot());
  })).toBe(false);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);

  // The retry deadline may pass while the replacement scene is still being
  // built. It must keep that one owner alive instead of aborting and restarting.
  // A matching pose arrives while the replacement scene is pending. The marker
  // must remain hidden until the scene boundary is admitted.
  await page.evaluate(() => { window.__spatialRecoveryProbe.sceneHolds = 1; });
  await robotReports();
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.exactPose)).toBe(true);
  expect(await panel.evaluate(async (element) => {
    const { canShowExactPose, canStartMotion } = await import("/state-selectors-probe.js");
    const state = element.getWorkspaceSnapshot();
    return { readOnly: state.floor.readOnly, canShowExactPose: canShowExactPose(state), canStartMotion: canStartMotion(state) };
  })).toEqual({ readOnly: true, canShowExactPose: false, canStartMotion: false });

  await page.clock.fastForward(6_000);
  await robotReports();
  const heldPastRetryDeadline = await panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return {
      generation: state.generation,
      sceneReads: window.__spatialRecoveryProbe.sceneReads,
      sceneAborts: window.__spatialRecoveryProbe.sceneAborts,
      pendingSceneCount: window.__spatialRecoveryProbe.pendingSceneCount(),
      readOnly: state.floor.readOnly,
      exactPose: state.map.exactPose,
    };
  });
  expect(heldPastRetryDeadline).toMatchObject({
    generation: heldPoseAndScene.generation,
    sceneReads: heldPoseAndScene.sceneReads,
    sceneAborts: 0,
    pendingSceneCount: 1,
    readOnly: true,
    exactPose: true,
  });
  expect(await panel.evaluate(async (element) => {
    const { canShowExactPose, canStartMotion } = await import("/state-selectors-probe.js");
    const state = element.getWorkspaceSnapshot();
    return { canShowExactPose: canShowExactPose(state), canStartMotion: canStartMotion(state) };
  })).toEqual({ canShowExactPose: false, canStartMotion: false });
  await page.evaluate(() => window.__spatialRecoveryProbe.releaseNextScene());
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && !state.floor.readOnly
      && state.map.exactPose && state.coherence === "current";
  })).toBe(true);
  const verifiedReplacement = await panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return {
      generation: state.generation,
      coherence: state.coherence,
      exactPose: state.map.exactPose,
      readOnly: state.floor.readOnly,
      sceneReads: window.__spatialRecoveryProbe.sceneReads,
      followFailures: window.__spatialRecoveryProbe.followFailures,
    };
  });
  expect(verifiedReplacement).toMatchObject({
    generation: heldPoseAndScene.generation, coherence: "current", exactPose: true,
    readOnly: false, sceneReads: heldPoseAndScene.sceneReads,
  });
  expect(await panel.evaluate(async (element) => {
    const { canStartMotion } = await import("/state-selectors-probe.js");
    return canStartMotion(element.getWorkspaceSnapshot());
  })).toBe(true);
  await page.evaluate(() => {
    window.__spatialRecoveryProbe.sceneHolds = 1;
    window.__spatialRecoveryProbe.failFollow = true;
  });
  await page.clock.fastForward(200);
  await expect.poll(() => page.evaluate(() => window.__spatialRecoveryProbe.followFailures)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__spatialRecoveryProbe.pendingSceneCount())).toBe(1);
  const contentRecovery = await panel.evaluate(async (element) => {
    const { canStartMotion } = await import("/state-selectors-probe.js");
    const state = element.getWorkspaceSnapshot();
    return {
      generation: state.generation,
      coherence: state.coherence,
      available: state.map.available,
      readOnly: state.floor.readOnly,
      exactPose: state.map.exactPose,
      sceneReads: window.__spatialRecoveryProbe.sceneReads,
      sceneAborts: window.__spatialRecoveryProbe.sceneAborts,
      pendingSceneCount: window.__spatialRecoveryProbe.pendingSceneCount(),
      canStartMotion: canStartMotion(state),
    };
  });
  expect(contentRecovery).toMatchObject({
    generation: verifiedReplacement.generation,
    coherence: "current",
    available: true,
    readOnly: false,
    exactPose: true,
    sceneReads: verifiedReplacement.sceneReads + 1,
    sceneAborts: 0,
    pendingSceneCount: 1,
  });
  expect(contentRecovery.canStartMotion).toBe(true);
  await page.clock.fastForward(6_000);
  await robotReports();
  expect(await panel.evaluate(async (element) => {
    const { canStartMotion } = await import("/state-selectors-probe.js");
    const state = element.getWorkspaceSnapshot();
    return {
      generation: state.generation,
      coherence: state.coherence,
      available: state.map.available,
      readOnly: state.floor.readOnly,
      exactPose: state.map.exactPose,
      sceneReads: window.__spatialRecoveryProbe.sceneReads,
      sceneAborts: window.__spatialRecoveryProbe.sceneAborts,
      pendingSceneCount: window.__spatialRecoveryProbe.pendingSceneCount(),
      canStartMotion: canStartMotion(state),
    };
  })).toEqual(contentRecovery);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
  await page.evaluate(() => {
    window.__spatialRecoveryProbe.failFollow = false;
    window.__spatialRecoveryProbe.releaseNextScene();
  });
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.map.exactPose && state.coherence === "current";
  })).toBe(true);
  await panel.evaluate((element) => {
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "open-workflow", workflow: "history" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => panel.evaluate((element) =>
    element.getWorkspaceSnapshot().resources.history.status)).toBe("ready");
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);

  const beforeHistoryRecovery = await page.evaluate(() => window.__panelFixture.catalogReads);
  await page.evaluate(() => window.__panelFixture.deferNextCatalog());
  await page.evaluate(() => { window.__spatialRecoveryProbe.failFollow = false; });
  await mismatchedPose();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingCatalogCount())).toBe(1);
  await panel.evaluate((element) => {
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "set-floor", floorId: "saved-1" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.dataMode, state.selection.floorId];
  })).toEqual(["history", "saved-1"]);
  await page.evaluate(() => window.__panelFixture.releaseCatalog());
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.dataMode, state.selection.floorId];
  })).toEqual(["history", "saved-1"]);
  await panel.evaluate((element) => element.remove());
  const detached = await page.evaluate(() => ({
    catalogReads: window.__panelFixture.catalogReads,
    ...window.__spatialRecoveryProbe,
  }));
  await page.clock.fastForward(5_000);
  expect(await page.evaluate(() => ({
    catalogReads: window.__panelFixture.catalogReads,
    ...window.__spatialRecoveryProbe,
  }))).toEqual(detached);
  expect(detached.catalogReads).toBeGreaterThan(beforeHistoryRecovery);
});
