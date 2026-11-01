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
    let savedPlans = syntheticPlans();
    const stats = { planCalls: 0, hassFetchWithAuthCalls: 0, rawFetchCalls: 0, snapshotCalls: 0, subscribeCalls: 0,
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
      plans: async () => { stats.planCalls += 1; return structuredClone(savedPlans); },
      areas: async () => syntheticAreas(),
      dispose: () => realBackend.dispose(),
    };
    const subscriptions = new Set();
    const connection = {
      sendMessagePromise: async message => {
        if (message.type?.startsWith("frontend/")) throw new Error("no user data in this harness");
        stats.snapshotCalls += 1;
        if (mode === "snapshot-unsupported") throw Object.assign(new Error("unsupported command"), { code: "unknown_command" });
        if (mode === "snapshot-pending") return await new Promise(() => {});
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
        if (mode === "subscription-pending") return await new Promise(() => {});
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
    controller.sync(projection);
    window.fallbackHarness = { controller, store, projection, stats, intervals, clearedIntervals,
      updateSavedPlan: (name, cleaningMode) => {
        savedPlans.plans[0].name = name;
        savedPlans.plans[0].nextRunPreview.rooms[0].cleaningMode = cleaningMode;
        const mopDue = cleaningMode === "vacuum_and_mop";
        savedPlans.plans[0].rooms[0].cadenceProgress = {
          mopProgress: mopDue ? 1 : 0, coverageProgress: 0, mopDue, coverageDue: false,
          nextMopIn: mopDue ? 1 : 2, nextCoverageIn: null,
          reasons: mopDue ? ["mop_due"] : [],
        };
      },
      invokeCatalogPoll: async () => {
        const interval = [...intervals.values()].find(item => item.delay === 5000);
        if (!interval) throw new Error("catalog polling interval was not registered");
        interval.callback();
        await new Promise(resolve => setTimeout(resolve, 0));
      },
      guards: () => ({ managedLock: store.value.managedLock,
        canEdit: canEditCoordinates(store.value), canStart: canStartMotion(store.value) }),
      loseAdministrator: () => controller.sync({ ...projection,
        host: { ...projection.host, administrator: false } }),
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

for (const held of ["snapshot-pending", "subscription-pending"]) {
  test(`${held} leaves authenticated polling active after its deadline`, async ({ page }) => {
    await page.clock.install();
    await setup(page, held);
    const before = await page.evaluate(() => ({ guards: window.fallbackHarness.guards(),
      restCalls: window.fallbackHarness.stats.hassFetchWithAuthCalls }));
    await page.clock.fastForward(10_001);
    await page.clock.fastForward(35_000);
    await page.evaluate(() => {
      const h = window.fallbackHarness;
      const poll = [...h.intervals.values()].find(item => item.delay === 5000);
      poll.callback();
    });
    await expect.poll(() => page.evaluate(() => window.fallbackHarness.stats.hassFetchWithAuthCalls)).toBeGreaterThan(before.restCalls);
    const after = await page.evaluate(() => {
      const h = window.fallbackHarness;
      return { guards: h.guards(), intervals: h.intervals.size, rawFetchCalls: h.stats.rawFetchCalls,
        snapshotCalls: h.stats.snapshotCalls, subscribeCalls: h.stats.subscribeCalls };
    });
    expect(after.guards).toEqual(before.guards);
    expect(after.intervals).toBe(2);
    expect(after.rawFetchCalls).toBe(0);
    expect(held === "snapshot-pending" ? after.snapshotCalls : after.subscribeCalls).toBe(1);
    await page.evaluate(() => window.fallbackHarness.dispose());
    expect(await page.evaluate(() => window.fallbackHarness.intervals.size)).toBe(0);
  });
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

for (const failureMode of ["snapshot-unsupported", "subscription-unsupported"]) {
  test(`${failureMode} polls saved plan cadence while preserving a dirty editor`, async ({ page }) => {
    await setup(page, failureMode);
    await page.evaluate(() => window.fallbackHarness.controller.openWorkflow("plans"));
    await expect.poll(() => page.evaluate(() => window.fallbackHarness.store.value.resources.plans.status)).toBe("ready");
    await page.evaluate(() => {
      const h = window.fallbackHarness;
      h.controller.selectPlan("daily");
      h.updateSavedPlan("Daily clean updated", "vacuum_and_mop");
    });
    const before = await page.evaluate(() => window.fallbackHarness.stats.planCalls);
    await page.evaluate(() => window.fallbackHarness.invokeCatalogPoll());
    await expect.poll(() => page.evaluate(() => window.fallbackHarness.store.value.planDraft.name)).toBe("Daily clean updated");
    expect(await page.evaluate(() => window.fallbackHarness.stats.planCalls)).toBe(before + 1);
    expect(await page.evaluate(() => window.fallbackHarness.store.value.resources.plans.value.plans[0].nextRunPreview.rooms[0].cleaningMode)).toBe("vacuum_and_mop");
    expect(await page.evaluate(() => window.fallbackHarness.store.value.planDraft.rooms[0].cadenceProgress))
      .toMatchObject({ mopProgress: 1, mopDue: true, nextMopIn: 1 });
    await page.evaluate(() => {
      const h = window.fallbackHarness;
      h.store.patch({ planDraft: { ...h.store.value.planDraft, name: "My unsaved edit", dirty: true } });
      h.updateSavedPlan("Changed elsewhere", "vacuum");
    });
    const draft = await page.evaluate(() => window.fallbackHarness.store.value.planDraft);
    await page.evaluate(() => window.fallbackHarness.invokeCatalogPoll());
    await expect.poll(() => page.evaluate(() => window.fallbackHarness.store.value.resources.plans.value.plans[0].name)).toBe("Changed elsewhere");
    expect(await page.evaluate(() => window.fallbackHarness.store.value.planDraft)).toEqual(draft);
    await page.evaluate(() => window.fallbackHarness.dispose());
  });
}
