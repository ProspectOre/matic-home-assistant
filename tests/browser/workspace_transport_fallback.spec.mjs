import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `export { EffectController } from "./frontend/map-studio-v4/effects";
    export { WorkspaceStore, canEditCoordinates, canStartMotion } from "./frontend/map-studio-v4/state";
    export { MaticBackend } from "./frontend/map-studio-v4/backend";
    export { syntheticEntry, syntheticAreas, syntheticHistory, syntheticPlans, syntheticScene } from "./frontend/map-studio-v4/synthetic-fixtures";`, resolveDir: process.cwd() },
  bundle: true, format: "esm", write: false,
});

test.beforeEach(async ({ browserName }) => {
  test.skip(browserName !== "chromium", "Workspace fallback contract runs once in Chromium");
});

async function setup(page, failureMode) {
  await page.route("**/workspace-fallback.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async mode => {
    const { EffectController, WorkspaceStore, canEditCoordinates, canStartMotion, MaticBackend,
      syntheticEntry, syntheticAreas, syntheticHistory, syntheticPlans, syntheticScene } = await import("/workspace-fallback.js");
    const originalSetInterval = window.setInterval.bind(window);
    const originalClearInterval = window.clearInterval.bind(window);
    const originalFetch = window.fetch.bind(window);
    const intervals = new Map();
    const clearedIntervals = [];
    let nextInterval = 1;
    window.setInterval = (callback, delay) => {
      const id = nextInterval++;
      intervals.set(id, { callback, delay });
      return id;
    };
    window.clearInterval = id => {
      clearedIntervals.push(id);
      intervals.delete(id);
    };

    const entry = { ...syntheticEntry(), runnerLocked: true, activePlan: true };
    const wireEntry = {
      entry_id: entry.entryId, scene_url: entry.sceneUrl, delta_url: null, pose_url: entry.poseUrl,
      history_url: entry.historyUrl, areas_url: entry.areasUrl, plans_url: entry.plansUrl,
      map_revision: entry.mapRevision, map_floor_coherent: entry.mapFloorCoherent,
      map_session_verified: entry.mapSessionVerified, map_session_key: entry.mapSessionKey,
      map_block_reason: entry.mapBlockReason, runner_locked: true, stop_settle_pending: entry.stopSettlePending,
      active_plan: true, native_reconciliation_pending: entry.nativeReconciliationPending,
      native_session_active: entry.nativeSessionActive, map_complete: entry.mapComplete,
      map_truncated: entry.mapTruncated, selected_floor_ordinal: entry.selectedFloorOrdinal,
      map_floor_ordinal: entry.mapFloorOrdinal, history_count: entry.historyCount,
      history_floor_count: entry.historyFloorCount, map_health: entry.health,
      stream_failures: entry.streamFailures, bootstrap_state: entry.bootstrapState,
      bootstrap_photo_seen: entry.bootstrapPhotoSeen, bootstrap_structure_seen: entry.bootstrapStructureSeen,
      bootstrap_failures: entry.bootstrapFailures,
    };
    const stats = { hassFetchWithAuthCalls: 0, rawFetchCalls: 0, snapshotCalls: 0, subscribeCalls: 0,
      activeSubscriptions: 0, unsubscribeCalls: 0 };
    window.fetch = (...args) => {
      stats.rawFetchCalls += 1;
      return originalFetch(...args);
    };
    const realBackend = new MaticBackend(() => ({
      fetchWithAuth: async (path, init) => {
        stats.hassFetchWithAuthCalls += 1;
        if (init.credentials !== "same-origin" || init.cache !== "no-store") throw new Error("REST request omitted HA backend options");
        if (path !== "/api/matic_robot/slam_entries") throw new Error(`unexpected REST fallback path: ${path}`);
        return new Response(JSON.stringify({ entries: [wireEntry] }), { status: 200 });
      },
    }));
    // Keep the real authenticated REST catalog path while making unrelated map
    // resources deterministic and synthetic for this transport integration.
    const backend = {
      catalog: signal => realBackend.catalog(signal),
      scene: async () => ({ scene: syntheticScene(), revision: 7, floorCoherent: true, notModified: false }),
      pose: async () => null,
      history: async () => syntheticHistory(),
      plans: async () => syntheticPlans(),
      areas: async () => syntheticAreas(),
      dispose: () => realBackend.dispose(),
    };
    const subscriptions = new Set();
    const connection = {
      sendMessagePromise: async message => {
        stats.snapshotCalls += 1;
        if (mode === "snapshot-unsupported") throw Object.assign(new Error("unsupported command"), { code: "unknown_command" });
        return {
          schema: 1, capabilities: { snapshot: 1 }, epoch: "synthetic-epoch", sequence: 0,
          coherence_generation: 1, revisions: { workspace: 0, status: 0, scene: 7, plans: 0, areas: 0, history: 0 },
          entry_id: message.entry_id,
          identity: { entry_id: message.entry_id, floor_mission_id: 12, floor_verified: true },
          status: { state: "ready", reason: null, retryable: false },
          payload: { available: true, entry: wireEntry },
        };
      },
      subscribeMessage: async () => {
        stats.subscribeCalls += 1;
        if (mode === "subscription-unsupported") throw Object.assign(new Error("unsupported subscription"), { code: "unknown_command" });
        stats.activeSubscriptions += 1;
        const marker = {};
        subscriptions.add(marker);
        return () => {
          if (subscriptions.delete(marker)) {
            stats.activeSubscriptions -= 1;
            stats.unsubscribeCalls += 1;
          }
        };
      },
    };
    const projection = { host: { connected: true, administrator: true, robotConnected: true, robotCount: 1 },
      activity: "idle", batteryPercent: 50, language: "en", userKey: "synthetic-user",
      vacuumEntityId: "vacuum.synthetic", entryKey: entry.entryId, robotLabel: "Matic",
      robots: [{ entryId: entry.entryId, label: "Matic" }] };
    const store = new WorkspaceStore();
    const controller = new EffectController(store, backend, connection, true);
    controller.sync(projection, undefined);
    window.fallbackHarness = { controller, store, projection, stats, intervals, clearedIntervals,
      invokeCatalogPoll: async () => {
        const interval = [...intervals.values()].find(item => item.delay === 5000);
        if (!interval) throw new Error("catalog polling interval was not registered");
        interval.callback();
        await new Promise(resolve => setTimeout(resolve, 0));
      },
      guards: () => ({ managedLock: store.value.managedLock,
        canEdit: canEditCoordinates(store.value), canStart: canStartMotion(store.value) }),
      loseAdministrator: () => controller.sync({ ...projection,
        host: { ...projection.host, administrator: false } }, undefined),
      dispose: () => {
        controller.dispose();
        window.setInterval = originalSetInterval;
        window.clearInterval = originalClearInterval;
        window.fetch = originalFetch;
      } };
  }, failureMode);
  await expect.poll(() => page.evaluate(() => window.fallbackHarness.stats.hassFetchWithAuthCalls)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.fallbackHarness.store.value.resources.entry?.entryId)).toBe("synthetic-entry");
}

for (const failureMode of ["snapshot-unsupported", "subscription-unsupported"]) {
  test(`${failureMode} keeps authenticated REST polling and command locks intact`, async ({ page }) => {
    await setup(page, failureMode);
    const before = await page.evaluate(() => ({ guards: window.fallbackHarness.guards(),
      restCalls: window.fallbackHarness.stats.hassFetchWithAuthCalls }));
    expect(before.guards).toEqual({ managedLock: true, canEdit: true, canStart: false });

    await page.evaluate(() => window.fallbackHarness.invokeCatalogPoll());
    await expect.poll(() => page.evaluate(() => window.fallbackHarness.stats.hassFetchWithAuthCalls)).toBeGreaterThan(before.restCalls);
    const afterPoll = await page.evaluate(() => ({ guards: window.fallbackHarness.guards(),
      restCalls: window.fallbackHarness.stats.hassFetchWithAuthCalls,
      rawFetchCalls: window.fallbackHarness.stats.rawFetchCalls }));
    expect(afterPoll.guards).toEqual(before.guards);
    expect(afterPoll.rawFetchCalls).toBe(0);

    await expect.poll(() => page.evaluate(() => window.fallbackHarness.stats.subscribeCalls
      + window.fallbackHarness.stats.snapshotCalls)).toBeGreaterThan(2);
    const stateBeforeDispose = await page.evaluate(() => ({ ...window.fallbackHarness.stats,
      intervalCount: window.fallbackHarness.intervals.size }));
    expect(stateBeforeDispose.intervalCount).toBe(2);
    await page.evaluate(() => window.fallbackHarness.loseAdministrator());
    const afterAuthorizationLoss = await page.evaluate(() => ({ ...window.fallbackHarness.stats,
      intervalCount: window.fallbackHarness.intervals.size,
      clearedIntervals: window.fallbackHarness.clearedIntervals.length }));
    expect(afterAuthorizationLoss.intervalCount).toBe(0);
    expect(afterAuthorizationLoss.clearedIntervals).toBe(2);
    expect(afterAuthorizationLoss.activeSubscriptions).toBe(0);
    await page.waitForTimeout(650);
    const afterRetryWindow = await page.evaluate(() => ({ ...window.fallbackHarness.stats,
      intervalCount: window.fallbackHarness.intervals.size,
      clearedIntervals: window.fallbackHarness.clearedIntervals.length }));
    expect(afterRetryWindow).toEqual(afterAuthorizationLoss);
    await page.evaluate(() => window.fallbackHarness.dispose());
    await page.evaluate(() => window.fallbackHarness.dispose());
    const disposed = await page.evaluate(() => ({ ...window.fallbackHarness.stats,
      intervalCount: window.fallbackHarness.intervals.size,
      clearedIntervals: window.fallbackHarness.clearedIntervals.length }));
    expect(disposed.intervalCount).toBe(0);
    expect(disposed.clearedIntervals).toBe(2);
    expect(disposed.activeSubscriptions).toBe(0);
    expect(disposed.unsubscribeCalls).toBe(failureMode === "snapshot-unsupported" ? 1 : 0);
  });
}
