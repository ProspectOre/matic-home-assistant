import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state"; export { syntheticEntry } from "./frontend/map-studio-v4/synthetic-fixtures";', resolveDir: process.cwd() },
  bundle: true, format: "esm", write: false,
});

test.beforeEach(async ({ browserName }) => {
  test.skip(browserName !== "chromium", "Workspace lifecycle runs once in Chromium");
});

test("legacy mode is inert and enabled mode follows admin, entry, and dispose lifecycle", async ({ page }) => {
  await page.route("**/lifecycle.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async () => {
    const { EffectController, WorkspaceStore } = await import("/lifecycle.js");
    const callbacks = [];
    let unsubscribed = 0;
    const connection = {
      subscribeMessage: async callback => { callbacks.push(callback); return () => { unsubscribed += 1; }; },
      sendMessagePromise: async message => ({ schema: 1, capabilities: {}, epoch: "e", sequence: 0, coherence_generation: 1,
        revisions: {}, entry_id: message.entry_id, identity: { entry_id: message.entry_id, floor_mission_id: null, floor_verified: false },
        status: { state: "ready", reason: null, retryable: false }, payload: { available: true } }),
    };
    const projection = entryKey => ({ host: { connected: true, administrator: true, robotConnected: true, robotCount: 1 }, activity: "idle",
      batteryPercent: 50, language: "en", userKey: "u", vacuumEntityId: "vacuum.x", entryKey, robotLabel: "Matic", robots: [{ entryId: entryKey, label: "Matic" }] });
    let catalogCalls = 0;
    const backend = { catalog: async () => { catalogCalls += 1; return []; }, dispose() {} };
    const legacy = new EffectController(new WorkspaceStore(), backend, connection);
    legacy.sync(projection("entry-a"), undefined);
    const legacySubscriptions = callbacks.length;
    legacy.dispose();
    const enabled = new EffectController(new WorkspaceStore(), backend, connection, true);
    enabled.sync(projection("entry-a"), undefined);
    const waitForSubscription = async (index) => {
      for (let attempt = 0; attempt < 20 && typeof callbacks[index] !== "function"; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (typeof callbacks[index] !== "function") throw new Error(`workspace subscription ${index} was not established`);
    };
    await waitForSubscription(0);
    const first = callbacks.length;
    const baselineCatalogCalls = catalogCalls;
    callbacks[0]({ type: "invalidate", ...({ schema: 1, capabilities: {}, epoch: "e", sequence: 1, coherence_generation: 1, revisions: { status: 1 }, resources: ["status"] }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    const afterInvalidation = catalogCalls;
    enabled.sync(projection("entry-b"), undefined);
    await waitForSubscription(1);
    const afterEntryChange = { subscriptions: callbacks.length, unsubscribed };
    callbacks[1]({ type: "resync", reason: "entry_removed" });
    await new Promise(resolve => setTimeout(resolve, 0));
    const afterEntryRemoved = unsubscribed;
    enabled.sync(projection("entry-c"), undefined);
    await waitForSubscription(2);
    const afterEntryRemovedReplacement = callbacks.length;
    enabled.sync({ ...projection("entry-c"), host: { ...projection("entry-c").host, administrator: false } }, undefined);
    const afterAuthorizationLoss = unsubscribed;
    enabled.sync({ ...projection("entry-c"), host: { ...projection("entry-c").host, connected: false } }, undefined);
    const afterDisconnect = unsubscribed;
    enabled.dispose(); enabled.dispose();
    window.lifecycleResult = { legacySubscriptions, first, baselineCatalogCalls, afterInvalidation, afterEntryChange, afterEntryRemoved, afterEntryRemovedReplacement, afterAuthorizationLoss, afterDisconnect, unsubscribed };
  });
  await expect.poll(() => page.evaluate(() => window.lifecycleResult)).toMatchObject({
    legacySubscriptions: 0,
    first: 1,
    afterEntryChange: { subscriptions: 2, unsubscribed: 1 },
    afterEntryRemoved: 2,
    afterEntryRemovedReplacement: 3,
    afterAuthorizationLoss: 3,
    afterDisconnect: 3,
    unsubscribed: 3,
  });
  const lifecycle = await page.evaluate(() => window.lifecycleResult);
  expect(lifecycle.afterInvalidation).toBe(lifecycle.baselineCatalogCalls);
});

/*
Paired receipt, same 10s/20Hz long-poll fixture: before routing, legacy was
3 catalog/2 full-scene/201 delta, while workspace-enabled was 203/202/1;
without DecompressionStream it was 203/202/0. After routing, workspace-enabled
was 3/2/201, and the unsupported-delta path was 3/4/0 via normal polling.
Reproduce with this test's fixed clock anchor, startup owner wait, and 200
50ms revisions; it asserts request parity, bounded single-owner work, and
final admitted revision rather than pinning timer-sensitive absolute totals.
*/
test("measures catalog reads and bounded work under synthetic 20 Hz scene revisions", async ({ page }) => {
  await page.route("**/lifecycle.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const clockAnchor = new Date("2026-09-28T12:00:00Z");
  await page.clock.install({ time: clockAnchor });
  await page.clock.pauseAt(clockAnchor);
  await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/lifecycle.js");
    const sampleCount = 200;
    const tickMs = 50;
    const base = createGalleryState("ready");
    const makeProjection = () => ({ host: base.host, activity: base.activity,
      batteryPercent: base.batteryPercent, language: "en", userKey: "synthetic-user",
      vacuumEntityId: "vacuum.synthetic", entryKey: base.resources.entry.entryId,
      robotLabel: "Matic", robots: base.robots });
    const makeRun = (enabled, holdCatalog = false) => {
      const entry = { ...base.resources.entry, deltaUrl: "/synthetic/delta" };
      const run = { catalogCalls: 0, activeCatalog: 0, maxActiveCatalog: 0,
        sceneCalls: 0, deltaCalls: 0, activeDelta: 0, maxActiveDelta: 0,
        revisions: 7, pendingCatalog: [], pendingDelta: [], deliveredEvents: 0, effects: null,
        store: null, holdCatalog, enabled };
      const backend = {
        dispose() {},
        catalog: async () => {
          run.catalogCalls += 1;
          run.activeCatalog += 1;
          run.maxActiveCatalog = Math.max(run.maxActiveCatalog, run.activeCatalog);
          const rows = [{ ...entry, mapRevision: run.revisions }];
          if (!holdCatalog) {
            run.activeCatalog -= 1;
            return rows;
          }
          return new Promise(resolve => run.pendingCatalog.push(() => {
            run.activeCatalog -= 1;
            resolve(rows);
          }));
        },
        scene: async (_url, revision) => {
          run.sceneCalls += 1;
          return { scene: { ...base.resources.scene.value, revision }, revision, floorCoherent: true };
        },
        sceneDelta: async (_url, scene, _floorCoherent, signal) => {
          run.deltaCalls += 1;
          run.activeDelta += 1;
          run.maxActiveDelta = Math.max(run.maxActiveDelta, run.activeDelta);
          return new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
              if (settled) return false;
              settled = true;
              run.activeDelta -= 1;
              signal?.removeEventListener("abort", abort);
              return true;
            };
            const abort = () => {
              if (!cleanup()) return;
              const index = run.pendingDelta.indexOf(complete);
              if (index >= 0) run.pendingDelta.splice(index, 1);
              reject(new DOMException("Aborted", "AbortError"));
            };
            const complete = () => {
              if (!cleanup()) return;
              if (run.revisions <= scene.revision) {
                resolve({ scene: null, revision: scene.revision, floorCoherent: true, notModified: true });
              } else {
                resolve({ scene: { ...scene, revision: run.revisions }, revision: run.revisions,
                  floorCoherent: true, notModified: false });
              }
            };
            if (signal?.aborted) abort();
            else {
              signal?.addEventListener("abort", abort, { once: true });
              run.pendingDelta.push(complete);
            }
          });
        },
        history: async () => base.resources.history.value,
        pose: async () => ({ ...base.resources.pose.value, mapSessionKey: entry.mapSessionKey }),
        plans: async () => base.resources.plans.value,
        areas: async () => base.resources.areas.value,
      };
      const callbacks = [];
      const connection = {
        subscribeMessage: async callback => { callbacks.push(callback); return () => {}; },
        sendMessagePromise: async message => ({ schema: 1, capabilities: { snapshot: 1 }, epoch: "synthetic-epoch",
          sequence: 0, coherence_generation: 1, revisions: { scene: 7 }, entry_id: message.entry_id,
          identity: { entry_id: message.entry_id, floor_mission_id: 1, floor_verified: true },
          status: { state: "ready", reason: null, retryable: false }, payload: { available: true, entry: null } }),
      };
      run.callbacks = callbacks;
      run.store = new WorkspaceStore();
      run.effects = new EffectController(run.store, backend, connection, enabled);
      run.effects.sync(makeProjection(), undefined);
      return run;
    };
    const flushStartup = async run => {
      for (let attempt = 0; attempt < 40 && run.callbacks.length === 0; attempt += 1) await Promise.resolve();
      if (run.enabled && run.callbacks.length !== 1) throw new Error("workspace listener was not established");
      if (!run.enabled && run.callbacks.length !== 0) throw new Error("disabled workspace transport subscribed");
      if (!run.holdCatalog) {
        for (let attempt = 0; attempt < 100 && run.store.value.resources.scene.status !== "ready"; attempt += 1) await Promise.resolve();
      }
      if (!run.holdCatalog && typeof window.DecompressionStream === "function") {
        for (let attempt = 0; attempt < 100 && run.pendingDelta.length === 0; attempt += 1) await Promise.resolve();
        if (run.pendingDelta.length !== 1) throw new Error("delta stream did not establish exactly one owner");
      }
    };
    const finishRun = run => run.effects.dispose();

    const immediateLegacy = makeRun(false);
    const immediateEnabled = makeRun(true);
    await flushStartup(immediateLegacy);
    await flushStartup(immediateEnabled);
    const heldLegacy = makeRun(false, true);
    const heldEnabled = makeRun(true, true);
    await flushStartup(heldLegacy);
    await flushStartup(heldEnabled);
    const decompressionDescriptor = Object.getOwnPropertyDescriptor(window, "DecompressionStream");
    Object.defineProperty(window, "DecompressionStream", { configurable: true, value: undefined });
    const fallbackEnabled = makeRun(true);
    await flushStartup(fallbackEnabled);
    const runs = { immediateLegacy, immediateEnabled, heldLegacy, heldEnabled, fallbackEnabled };
    window.workspaceMeasurement = {
      runs,
      restoreDecompressionStream() {
        if (decompressionDescriptor) Object.defineProperty(window, "DecompressionStream", decompressionDescriptor);
      },
      emit(index) {
        const revision = 7 + index;
        for (const run of Object.values(runs)) run.revisions = revision;
        for (const run of [immediateEnabled, heldEnabled, fallbackEnabled]) {
          run.callbacks[0]({ type: "invalidate", schema: 1, capabilities: { snapshot: 1 },
            epoch: "synthetic-epoch", sequence: index, coherence_generation: 1,
            revisions: { scene: revision }, resources: ["scene"] });
          run.deliveredEvents += 1;
        }
        for (const run of Object.values(runs)) run.pendingDelta.shift()?.();
      },
      release(runName) { runs[runName].pendingCatalog.shift()?.(); },
      measure() {
        return Object.fromEntries(Object.entries(runs).map(([name, run]) => [name, {
          catalogReads: run.catalogCalls,
          sceneReads: run.sceneCalls,
          deltaReads: run.deltaCalls,
          activeCatalogReads: run.activeCatalog,
          maxActiveCatalogReads: run.maxActiveCatalog,
          activeDeltaReads: run.activeDelta,
          maxActiveDeltaReads: run.maxActiveDelta,
          admittedSceneRevision: run.store.value.resources.scene.value?.revision ?? null,
          admittedEntryRevision: run.store.value.resources.entry?.mapRevision ?? null,
          workspaceEventsReceived: run.deliveredEvents,
          pendingCatalogResolutions: run.pendingCatalog.length,
        }]));
      },
      dispose() { for (const run of Object.values(runs)) finishRun(run); },
    };
    return window.workspaceMeasurement.measure();
  });
  for (let index = 1; index <= 200; index += 1) {
    await page.evaluate(index => window.workspaceMeasurement.emit(index), index);
    await page.clock.fastForward(50);
  }
  const beforeRelease = await page.evaluate(() => window.workspaceMeasurement.measure());
  for (const runName of ["heldLegacy", "heldEnabled"]) {
    await page.evaluate(runName => window.workspaceMeasurement.release(runName), runName);
  }
  await expect.poll(() => page.evaluate(() => window.workspaceMeasurement.measure().heldEnabled.activeCatalogReads)).toBe(0);
  const afterFirstRelease = await page.evaluate(() => window.workspaceMeasurement.measure());
  const immediateResult = await page.evaluate(() => window.workspaceMeasurement.measure());
  await page.evaluate(() => window.workspaceMeasurement.restoreDecompressionStream());
  await page.evaluate(() => window.workspaceMeasurement.dispose());
  const result = {
    conditions: { syntheticRevisions: 200, cadenceHz: 20, durationMs: 10_000, tickMs: 50,
      catalogResponse: "immediate in first pair; explicitly held until after stimulus in second pair",
      sceneDelta: "one pending synthetic long-poll resolves for each newer 50ms revision" },
    immediate: {
      legacyCatalogReads: immediateResult.immediateLegacy.catalogReads,
      workspaceEnabledCatalogReads: immediateResult.immediateEnabled.catalogReads,
      legacySceneReads: immediateResult.immediateLegacy.sceneReads,
      workspaceEnabledSceneReads: immediateResult.immediateEnabled.sceneReads,
      legacyDeltaReads: immediateResult.immediateLegacy.deltaReads,
      workspaceEnabledDeltaReads: immediateResult.immediateEnabled.deltaReads,
      workspaceEnabledMaxConcurrentDeltaReads: immediateResult.immediateEnabled.maxActiveDeltaReads,
      workspaceEnabledAdmittedSceneRevision: immediateResult.immediateEnabled.admittedSceneRevision,
      workspaceEnabledAdmittedEntryRevision: immediateResult.immediateEnabled.admittedEntryRevision,
      workspaceEventsReceived: immediateResult.immediateEnabled.workspaceEventsReceived,
      maxConcurrentCatalogReads: Math.max(immediateResult.immediateLegacy.maxActiveCatalogReads,
        immediateResult.immediateEnabled.maxActiveCatalogReads),
    },
    noDeltaFallback: {
      catalogReads: immediateResult.fallbackEnabled.catalogReads,
      sceneReads: immediateResult.fallbackEnabled.sceneReads,
      deltaReads: immediateResult.fallbackEnabled.deltaReads,
      maxConcurrentCatalogReads: immediateResult.fallbackEnabled.maxActiveCatalogReads,
      workspaceEventsReceived: immediateResult.fallbackEnabled.workspaceEventsReceived,
      admittedSceneRevision: immediateResult.fallbackEnabled.admittedSceneRevision,
      admittedEntryRevision: immediateResult.fallbackEnabled.admittedEntryRevision,
    },
    held: {
      beforeRelease: {
        legacyCatalogReads: beforeRelease.heldLegacy.catalogReads,
        workspaceEnabledCatalogReads: beforeRelease.heldEnabled.catalogReads,
        legacyInFlight: beforeRelease.heldLegacy.activeCatalogReads,
        workspaceEnabledInFlight: beforeRelease.heldEnabled.activeCatalogReads,
        workspaceEventsReceived: beforeRelease.heldEnabled.workspaceEventsReceived,
      },
      afterFirstRelease: {
        legacyCatalogReads: afterFirstRelease.heldLegacy.catalogReads,
        workspaceEnabledCatalogReads: afterFirstRelease.heldEnabled.catalogReads,
        workspaceEnabledInFlight: afterFirstRelease.heldEnabled.activeCatalogReads,
        maxConcurrentCatalogReads: Math.max(afterFirstRelease.heldLegacy.maxActiveCatalogReads,
          afterFirstRelease.heldEnabled.maxActiveCatalogReads),
      },
      finalLegacyCatalogReads: immediateResult.heldLegacy.catalogReads,
      finalCatalogReads: immediateResult.heldEnabled.catalogReads,
      maxConcurrentCatalogReads: Math.max(immediateResult.heldLegacy.maxActiveCatalogReads,
        immediateResult.heldEnabled.maxActiveCatalogReads),
    },
  };
  console.info("[workspace transport synthetic measurement]", JSON.stringify(result));
  expect(result.conditions).toMatchObject({
    syntheticRevisions: 200,
    cadenceHz: 20,
    durationMs: 10_000,
    tickMs: 50,
  });
  expect(result.immediate.workspaceEnabledCatalogReads).toBe(result.immediate.legacyCatalogReads);
  expect(result.immediate.workspaceEnabledSceneReads).toBe(result.immediate.legacySceneReads);
  expect(result.immediate).toMatchObject({
    workspaceEventsReceived: 200,
    maxConcurrentCatalogReads: 1,
    workspaceEnabledMaxConcurrentDeltaReads: 1,
    workspaceEnabledAdmittedSceneRevision: 207,
    workspaceEnabledAdmittedEntryRevision: 207,
  });
  expect(result.noDeltaFallback).toMatchObject({
    deltaReads: 0,
    workspaceEventsReceived: 200,
    maxConcurrentCatalogReads: 1,
    admittedSceneRevision: 207,
    admittedEntryRevision: 207,
  });
  expect(result.noDeltaFallback.catalogReads).toBeLessThanOrEqual(result.immediate.legacyCatalogReads + 1);
  expect(result.held.beforeRelease).toMatchObject({
    legacyCatalogReads: 1,
    workspaceEnabledCatalogReads: 1,
    legacyInFlight: 1,
    workspaceEnabledInFlight: 1,
    workspaceEventsReceived: 200,
  });
  expect(result.held.afterFirstRelease).toMatchObject({
    legacyCatalogReads: 1,
    workspaceEnabledCatalogReads: 1,
    maxConcurrentCatalogReads: 1,
  });
  expect(result.held.finalLegacyCatalogReads).toBe(1);
  expect(result.held.finalCatalogReads).toBe(1);
});

test("same-generation snapshot map revisions wait for delta admission; new identity revalidates", async ({ page }) => {
  await page.route("**/lifecycle.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState, syntheticEntry } = await import("/lifecycle.js");
    const base = createGalleryState("ready");
    let catalogEntry = { ...syntheticEntry(), deltaUrl: "/synthetic/delta" };
    const callbacks = [];
    const pendingDeltas = [];
    const counts = { catalog: 0, scene: 0, delta: 0 };
    const wireEntry = entry => ({ entry_id: entry.entryId, scene_url: entry.sceneUrl,
      delta_url: entry.deltaUrl, pose_url: entry.poseUrl, history_url: entry.historyUrl,
      areas_url: entry.areasUrl, plans_url: entry.plansUrl, map_revision: entry.mapRevision,
      map_floor_coherent: entry.mapFloorCoherent, map_session_verified: entry.mapSessionVerified,
      map_session_key: entry.mapSessionKey, map_block_reason: entry.mapBlockReason,
      runner_locked: entry.runnerLocked, stop_settle_pending: entry.stopSettlePending,
      active_plan: entry.activePlan, native_reconciliation_pending: entry.nativeReconciliationPending,
      native_session_active: entry.nativeSessionActive, map_complete: entry.mapComplete,
      map_truncated: entry.mapTruncated, selected_floor_ordinal: entry.selectedFloorOrdinal,
      map_floor_ordinal: entry.mapFloorOrdinal, history_count: entry.historyCount,
      history_floor_count: entry.historyFloorCount, map_health: entry.health,
      stream_failures: entry.streamFailures, bootstrap_state: entry.bootstrapState,
      bootstrap_photo_seen: entry.bootstrapPhotoSeen, bootstrap_structure_seen: entry.bootstrapStructureSeen,
      bootstrap_failures: entry.bootstrapFailures });
    const snapshotFor = (entry, sequence, coherenceGeneration, sceneRevision) => ({
      schema: 1, capabilities: { snapshot: 1 }, epoch: "snapshot-test-epoch", sequence,
      coherence_generation: coherenceGeneration,
      revisions: { workspace: sequence, status: 0, scene: sceneRevision, plans: 0, areas: 0, history: 0 },
      entry_id: entry.entryId,
      identity: { entry_id: entry.entryId, floor_mission_id: entry.mapSessionKey ? 12 : null,
        floor_verified: Boolean(entry.mapSessionKey) },
      status: { state: "ready", reason: null, retryable: false },
      payload: { available: true, entry: wireEntry(entry) },
    });
    const connection = {
      subscribeMessage: async callback => { callbacks.push(callback); return () => {}; },
      sendMessagePromise: async () => snapshotFor(catalogEntry, 0, 1, catalogEntry.mapRevision),
    };
    const sceneFor = revision => ({ revision, source: "live", buffer: new ArrayBuffer(0), pointOffset: 0,
      floorCount: 0, surfaceCount: 0, total: 0, etag: null,
      metadata: { metersPerCell: 0.05, origin: [0, 0], span: [1, 1], sampleStep: 1, rooms: [] } });
    const backend = {
      dispose() {},
      catalog: async () => { counts.catalog += 1; return [{ ...catalogEntry }]; },
      scene: async (_url, revision) => { counts.scene += 1;
        return { scene: sceneFor(revision), revision, floorCoherent: true }; },
      sceneDelta: (_url, scene, _coherent, signal) => {
        counts.delta += 1;
        return new Promise(resolve => pendingDeltas.push({ scene, signal, resolve }));
      },
      history: async () => base.resources.history.value,
      pose: async () => null,
      plans: async () => base.resources.plans.value,
      areas: async () => base.resources.areas.value,
    };
    const projection = { host: base.host, activity: base.activity, batteryPercent: base.batteryPercent,
      language: "en", userKey: "synthetic-user", vacuumEntityId: "vacuum.synthetic",
      entryKey: catalogEntry.entryId, robotLabel: "Matic", robots: base.robots };
    const store = new WorkspaceStore();
    const controller = new EffectController(store, backend, connection, true);
    controller.sync(projection, undefined);
    window.snapshotHarness = { callbacks, pendingDeltas, counts, store, controller, catalogEntry, snapshotFor,
      setCatalogEntry: value => { catalogEntry = value; },
      measure: () => ({ ...counts, entryRevision: store.value.resources.entry?.mapRevision,
        sceneRevision: store.value.resources.scene.value?.revision, generation: store.value.generation,
        pending: pendingDeltas.length,
        activeDeltaCount: pendingDeltas.filter(delta => !delta.signal?.aborted).length }),
      dispose: () => controller.dispose() };
  });
  await expect.poll(() => page.evaluate(() => window.snapshotHarness.callbacks.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.snapshotHarness.measure().sceneRevision)).toBe(7);
  await expect.poll(() => page.evaluate(() => window.snapshotHarness.measure().activeDeltaCount)).toBe(1);
  await page.evaluate(() => {
    const h = window.snapshotHarness;
    h.beforeContentSnapshot = h.measure();
    h.setCatalogEntry({ ...h.catalogEntry, mapRevision: 8 });
    h.callbacks[0]({ type: "snapshot", ...h.snapshotFor(h.catalogEntry, 1, 1, 8) });
  });
  await expect.poll(() => page.evaluate(() => window.snapshotHarness.measure().entryRevision)).toBe(7);
  const beforeDelta = await page.evaluate(() => window.snapshotHarness.measure());
  const beforeContentSnapshot = await page.evaluate(() => window.snapshotHarness.beforeContentSnapshot);
  expect(beforeDelta).toMatchObject({
    catalog: beforeContentSnapshot.catalog, scene: beforeContentSnapshot.scene,
    delta: beforeContentSnapshot.delta, entryRevision: 7, sceneRevision: 7,
    generation: beforeContentSnapshot.generation,
  });
  await page.evaluate(() => window.snapshotHarness.pendingDeltas[0].resolve({
    scene: { ...window.snapshotHarness.pendingDeltas[0].scene, revision: 8 }, revision: 8,
    floorCoherent: true, notModified: false,
  }));
  await expect.poll(() => page.evaluate(() => window.snapshotHarness.measure().entryRevision)).toBe(8);
  const afterDelta = await page.evaluate(() => window.snapshotHarness.measure());
  expect(afterDelta).toMatchObject({
    catalog: beforeContentSnapshot.catalog, scene: beforeContentSnapshot.scene,
    entryRevision: 8, sceneRevision: 8, generation: beforeContentSnapshot.generation,
  });

  await page.evaluate(() => {
    const h = window.snapshotHarness;
    const changed = { ...h.catalogEntry, mapRevision: 9, mapSessionKey: "synthetic-next-session" };
    h.setCatalogEntry(changed);
    h.callbacks[0]({ type: "snapshot", ...h.snapshotFor(changed, 2, 2, 9) });
  });
  await expect.poll(() => page.evaluate(() => window.snapshotHarness.measure().sceneRevision)).toBe(9);
  const afterBoundary = await page.evaluate(() => window.snapshotHarness.measure());
  expect(afterBoundary).toMatchObject({
    catalog: afterDelta.catalog + 1, scene: afterDelta.scene + 1,
    entryRevision: 9, sceneRevision: 9,
  });
  expect(afterBoundary.generation).toBeGreaterThan(afterDelta.generation);
  const oldPendingDeltaIndex = await page.evaluate(() => window.snapshotHarness.pendingDeltas.findIndex(delta => delta.signal?.aborted));
  expect(oldPendingDeltaIndex).toBeGreaterThanOrEqual(0);
  await page.evaluate(index => {
    const delta = window.snapshotHarness.pendingDeltas[index];
    delta.resolve({ scene: { ...delta.scene, revision: 8 }, revision: 8, floorCoherent: true, notModified: false });
  }, oldPendingDeltaIndex);
  await page.waitForTimeout(0);
  await expect.poll(() => page.evaluate(() => window.snapshotHarness.measure())).toMatchObject({
    entryRevision: 9, sceneRevision: 9, generation: afterBoundary.generation,
  });
  await page.evaluate(() => window.snapshotHarness.dispose());
});
