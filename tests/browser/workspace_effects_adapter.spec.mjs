import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `export { EffectController } from "./frontend/map-studio-v4/effects";
    export { WorkspaceStore } from "./frontend/map-studio-v4/state";
    export { canEditCoordinates, canStartMotion } from "./frontend/map-studio-v4/state";
    export { syntheticEntry, syntheticPlans, syntheticAreas, syntheticHistory } from "./frontend/map-studio-v4/synthetic-fixtures";`, resolveDir: process.cwd() },
  bundle: true, format: "esm", write: false,
});

test.beforeEach(async ({ browserName }) => {
  test.skip(browserName !== "chromium", "Workspace effects adapter runs once in Chromium");
});

const setup = async (page, deferInitialSnapshot = false) => {
  await page.route("**/adapter.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async (deferInitialSnapshot) => {
    const { EffectController, WorkspaceStore, canEditCoordinates, canStartMotion, syntheticEntry, syntheticPlans, syntheticAreas, syntheticHistory } = await import("/adapter.js");
    const callbacks = [];
    const wireCatalogEntry = entry => ({ entry_id: entry.entryId, scene_url: entry.sceneUrl,
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
    const snapshotFor = (entryId, projection = null) => ({ schema: 1, capabilities: { snapshot: 1 }, epoch: "epoch-a", sequence: 0,
      coherence_generation: 1, revisions: { workspace: 0, status: 0, scene: 7, plans: 0, areas: 0, history: 0 },
      entry_id: entryId, identity: { entry_id: entryId, floor_mission_id: 12, floor_verified: true },
      status: { state: "ready", reason: null, retryable: false }, payload: { available: true,
        entry: projection ? wireCatalogEntry(projection) : entryId === "synthetic-entry" ? wireCatalogEntry(syntheticEntry()) : null } });
    const revisionState = { workspace: 0, status: 0, scene: 7, plans: 0, areas: 0, history: 0 };
    const invalidation = (sequence, resources, revisions, generation = 1) => {
      Object.assign(revisionState, revisions, { workspace: sequence });
      return { type: "invalidate",
      schema: 1, capabilities: { snapshot: 1 }, epoch: "epoch-a", sequence, coherence_generation: generation,
      revisions: { ...revisionState }, resources };
    };
    let initialSnapshotResolve = null;
    const connection = { subscribeMessage: async callback => { callbacks.push(callback); return () => {}; },
      sendMessagePromise: async message => deferInitialSnapshot
        ? await new Promise(resolve => { initialSnapshotResolve = resolve; })
        : snapshotFor(message.entry_id) };
    const counts = { catalog: 0, plans: 0, areas: 0, history: 0, scene: 0 };
    // This adapter contract test exercises invalidation routing, not the
    // independent long-poll delta loop. Keep that loop out of the fixture so
    // a missing sceneDelta mock cannot trigger an immediate retry cycle.
    let catalogEntry = { ...syntheticEntry(), deltaUrl: null };
    const backend = { catalog: async () => { counts.catalog += 1; return [catalogEntry]; },
      plans: async () => { counts.plans += 1; return syntheticPlans(); },
      areas: async () => { counts.areas += 1; return syntheticAreas(); },
      history: async () => { counts.history += 1; return syntheticHistory(); },
      scene: async () => { counts.scene += 1; return ({ scene: { revision: 7, source: "live", buffer: new ArrayBuffer(0), pointOffset: 0,
        floorCount: 0, surfaceCount: 0, total: 0, etag: null,
        metadata: { metersPerCell: 0.05, origin: [0, 0], span: [1, 1], sampleStep: 1, rooms: [] } },
        revision: 7, floorCoherent: true }); }, pose: async () => null, dispose() {} };
    const projection = entryKey => ({ host: { connected: true, administrator: true, robotConnected: true, robotCount: 1 },
      activity: "idle", batteryPercent: 50, language: "en", userKey: "u", vacuumEntityId: "vacuum.x", entryKey,
      robotLabel: "Matic", robots: [{ entryId: entryKey, label: "Matic" }] });
    const store = new WorkspaceStore();
    const controller = new EffectController(store, backend, connection, true);
    controller.sync(projection("synthetic-entry"), undefined);
    window.adapterHarness = { callbacks, counts, store, controller, projection, snapshotFor, backend, invalidation,
      initialSnapshotPending: () => initialSnapshotResolve !== null,
      resolveInitialSnapshot: value => { if (!initialSnapshotResolve) return false; initialSnapshotResolve(value); return true; },
      canEditCoordinates, canStartMotion,
      setCatalogEntry: value => { catalogEntry = value; } };
  }, deferInitialSnapshot);
  await expect.poll(() => page.evaluate(() => window.adapterHarness.counts.catalog)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.adapterHarness.store.value.resources.entry?.entryId)).toBe("synthetic-entry");
  if (!deferInitialSnapshot) {
    await expect.poll(() => page.evaluate(() => window.adapterHarness.callbacks.length)).toBe(1);
  } else {
    await expect.poll(() => page.evaluate(() => window.adapterHarness.initialSnapshotPending())).toBe(true);
  }
  await expect.poll(() => page.evaluate(() => window.adapterHarness.store.value.map.floorCoherent)).toBe(true);
  if (deferInitialSnapshot) {
    await expect.poll(() => page.evaluate(() => window.adapterHarness.store.value.resources.scene.status)).toBe("ready");
  }
  await page.evaluate(async () => {
    const h = window.adapterHarness;
    h.preOpen = { coherence: h.store.value.coherence, map: h.store.value.map, host: h.store.value.host,
      floor: h.store.value.floor, plansStatus: h.store.value.resources.plans.status };
    await h.controller.openWorkflow("plans");
    await h.controller.openWorkflow("draw");
  });
}

test("routes independent resource invalidations after an active-entry snapshot", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const h = window.adapterHarness;
    await new Promise(resolve => setTimeout(resolve, 0));
    h.callbacks[0]({ type: "snapshot", ...h.snapshotFor("synthetic-entry") });
    await new Promise(resolve => setTimeout(resolve, 0));
    const before = { ...h.counts };
    h.callbacks[0](h.invalidation(1, ["plans"], { plans: 1 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    h.callbacks[0](h.invalidation(2, ["areas"], { areas: 1 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    h.callbacks[0](h.invalidation(3, ["history"], { history: 1 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    window.adapterHarness.result = { before, after: { ...h.counts }, generation: h.store.value.generation, preOpen: h.preOpen };
    h.controller.dispose();
  });
  const result = await page.evaluate(() => window.adapterHarness.result);
  expect(result.after.catalog).toBe(result.before.catalog);
  expect(result.after.plans).toBe(result.before.plans + 1);
  expect(result.after.areas).toBe(result.before.areas + 1);
  expect(result.after.history).toBe(result.before.history + 1);
  expect(result.generation).toBe(1);
});

test("queues one catalog follow-up when spatial invalidations arrive during a forced read", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const h = window.adapterHarness;
    await new Promise(resolve => setTimeout(resolve, 0));
    let resolveForced;
    let forcedCalls = 0;
    const baseline = h.counts.catalog;
    h.backend.catalog = async signal => {
      h.counts.catalog += 1;
      forcedCalls += 1;
      if (forcedCalls === 1) return await new Promise(resolve => { resolveForced = resolve; });
      return [h.store.value.resources.entry];
    };
    h.callbacks[0](h.invalidation(1, ["status"], { status: 1 }, 2));
    await new Promise(resolve => setTimeout(resolve, 0));
    const afterFirstForcedStart = h.counts.catalog;
    h.callbacks[0](h.invalidation(2, ["scene"], { scene: 8 }, 3));
    await new Promise(resolve => setTimeout(resolve, 0));
    const whileFirstForcedPending = h.counts.catalog;
    resolveForced([h.store.value.resources.entry]);
    for (let attempt = 0; attempt < 100 && forcedCalls < 2; attempt += 1) await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    window.adapterHarness.result = { baseline, afterFirstForcedStart, whileFirstForcedPending, afterFollowup: h.counts.catalog, forcedCalls };
    h.controller.dispose();
  });
  await expect.poll(() => page.evaluate(() => window.adapterHarness.result?.afterFollowup)).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => window.adapterHarness.result)).toEqual({ baseline: 1,
    afterFirstForcedStart: 2, whileFirstForcedPending: 2, afterFollowup: 3, forcedCalls: 2 });
});

test("status-only updates refresh the managed catalog without reloading spatial resources", async ({ page }) => {
  await setup(page);
  const baseline = await page.evaluate(() => ({ ...window.adapterHarness.counts,
    generation: window.adapterHarness.store.value.generation }));
  await page.evaluate(() => {
    const h = window.adapterHarness;
    h.callbacks[0](h.invalidation(1, ["status"], { status: 1 }, 1));
  });
  await expect.poll(() => page.evaluate(() => window.adapterHarness.counts.catalog)).toBe(baseline.catalog + 1);
  await new Promise(resolve => setTimeout(resolve, 50));
  const current = await page.evaluate(() => ({ ...window.adapterHarness.counts,
    generation: window.adapterHarness.store.value.generation }));
  expect(current.catalog).toBe(baseline.catalog + 1);
  expect(current.plans).toBe(baseline.plans);
  expect(current.areas).toBe(baseline.areas);
  expect(current.history).toBe(baseline.history);
  expect(current.scene).toBe(baseline.scene);
  expect(current.generation).toBe(baseline.generation);
  await page.evaluate(() => window.adapterHarness.controller.dispose());
});

test("snapshot catalog projection updates managed command guards without map reload", async ({ page }) => {
  await setup(page);
  const before = await page.evaluate(() => ({ ...window.adapterHarness.counts,
    generation: window.adapterHarness.store.value.generation }));
  await page.evaluate(() => {
    const h = window.adapterHarness;
    const entry = { ...h.store.value.resources.entry, runnerLocked: true, activePlan: true };
    h.callbacks[0]({ type: "snapshot", snapshot: h.snapshotFor("synthetic-entry", entry) });
  });
  await expect.poll(() => page.evaluate(() => window.adapterHarness.store.value.managedLock)).toBe(true);
  const after = await page.evaluate(() => ({ ...window.adapterHarness.counts,
    generation: window.adapterHarness.store.value.generation,
    entry: window.adapterHarness.store.value.resources.entry }));
  expect(after.entry.runnerLocked).toBe(true);
  expect(after.entry.activePlan).toBe(true);
  expect(after.catalog).toBe(before.catalog);
  expect(after.plans).toBe(before.plans);
  expect(after.areas).toBe(before.areas);
  expect(after.history).toBe(before.history);
  expect(after.scene).toBe(before.scene);
  expect(after.generation).toBe(before.generation);
  await page.evaluate(() => window.adapterHarness.controller.dispose());
});

test("an initial unverified empty snapshot fences the retained map and recovers from catalog revalidation", async ({ page }) => {
  await setup(page, true);
  const before = await page.evaluate(() => {
    const h = window.adapterHarness;
    return { generation: h.store.value.generation, catalog: h.counts.catalog, scene: h.counts.scene,
      available: h.store.value.map.available };
  });
  await page.evaluate(() => {
    const h = window.adapterHarness;
    h.catalogResolve = null;
    h.backend.catalog = async () => {
      h.counts.catalog += 1;
      return await new Promise(resolve => { h.catalogResolve = resolve; });
    };
    const failedSnapshot = h.snapshotFor("synthetic-entry");
    failedSnapshot.identity.floor_mission_id = null;
    failedSnapshot.identity.floor_verified = false;
    failedSnapshot.status = { state: "unavailable", reason: "snapshot_required", retryable: false };
    failedSnapshot.payload.available = false;
    failedSnapshot.payload.entry = null;
    h.initialSnapshotReleased = h.resolveInitialSnapshot(failedSnapshot);
  });
  await expect.poll(() => page.evaluate(() => ({ released: window.adapterHarness.initialSnapshotReleased,
    catalogResolve: Boolean(window.adapterHarness.catalogResolve), callbacks: window.adapterHarness.callbacks.length,
    generation: window.adapterHarness.store.value.generation, coherence: window.adapterHarness.store.value.coherence,
    catalogCalls: window.adapterHarness.counts.catalog }))).toMatchObject({ catalogResolve: true });
  await expect.poll(() => page.evaluate(() => window.adapterHarness.callbacks.length)).toBe(1);
  const fenced = await page.evaluate(() => {
    const h = window.adapterHarness;
    return { generation: h.store.value.generation, coherence: h.store.value.coherence,
      available: h.store.value.map.available, exactPose: h.store.value.map.exactPose,
      edit: h.canEditCoordinates(h.store.value), motion: h.canStartMotion(h.store.value),
      scene: h.counts.scene };
  });
  expect(fenced).toEqual({ generation: before.generation + 1, coherence: "verifying",
    available: before.available, exactPose: false, edit: false, motion: false, scene: before.scene });

  await page.evaluate(() => {
    const h = window.adapterHarness;
    h.catalogResolve([h.store.value.resources.entry]);
  });
  await expect.poll(() => page.evaluate(() => window.adapterHarness.counts.scene)).toBe(before.scene + 1);
  await expect.poll(() => page.evaluate(() => window.adapterHarness.store.value.resources.scene.status)).toBe("ready");
  const recovered = await page.evaluate(() => {
    const h = window.adapterHarness;
    return { coherence: h.store.value.coherence, exactPose: h.store.value.map.exactPose,
      edit: h.canEditCoordinates(h.store.value), motion: h.canStartMotion(h.store.value),
      health: h.store.value.resources.entry?.health, catalog: h.store.value.resources.catalog.status,
      scene: h.store.value.resources.scene.status, floorCoherent: h.store.value.map.floorCoherent,
      sessionVerified: h.store.value.map.sessionVerified };
  });
  expect(recovered).toMatchObject({ coherence: "current", exactPose: false, edit: true, motion: true,
    health: "ready", scene: "ready", floorCoherent: true, sessionVerified: true });

  const plansBefore = await page.evaluate(() => window.adapterHarness.counts.plans);
  await page.evaluate(() => window.adapterHarness.callbacks[0](window.adapterHarness.invalidation(1, ["plans"], { plans: 1 })));
  await expect.poll(() => page.evaluate(() => window.adapterHarness.counts.plans)).toBe(plansBefore + 1);
  await page.evaluate(() => window.adapterHarness.controller.dispose());
});

test("same-identity snapshot health changes immediately close edit and motion guards", async ({ page }) => {
  await setup(page);
  const before = await page.evaluate(() => {
    const h = window.adapterHarness;
    return { coherence: h.store.value.coherence, complete: h.store.value.map.complete,
      edit: h.canEditCoordinates(h.store.value), motion: h.canStartMotion(h.store.value),
      counts: { ...h.counts }, generation: h.store.value.generation };
  });
  expect(before).toMatchObject({ coherence: "current", complete: true, edit: true, motion: true });
  await page.evaluate(() => {
    const h = window.adapterHarness;
    const entry = { ...h.store.value.resources.entry, health: "limited", mapComplete: false };
    h.callbacks[0]({ type: "snapshot", snapshot: h.snapshotFor("synthetic-entry", entry) });
  });
  await expect.poll(() => page.evaluate(() => window.adapterHarness.store.value.coherence)).toBe("degraded");
  const after = await page.evaluate(() => {
    const h = window.adapterHarness;
    return { coherence: h.store.value.coherence, complete: h.store.value.map.complete,
      edit: h.canEditCoordinates(h.store.value), motion: h.canStartMotion(h.store.value),
      health: h.store.value.resources.entry.health, counts: { ...h.counts },
      generation: h.store.value.generation };
  });
  expect(after).toMatchObject({ coherence: "degraded", complete: false, edit: false, motion: false,
    health: "limited", counts: before.counts, generation: before.generation });
  await page.evaluate(() => window.adapterHarness.controller.dispose());
});

test("a stream resync reloads cached plan, area, and history projections", async ({ page }) => {
  await setup(page);
  const baseline = await page.evaluate(() => ({ ...window.adapterHarness.counts }));
  await page.evaluate(() => window.adapterHarness.callbacks[0]({ type: "resync", reason: "restart" }));
  await expect.poll(() => page.evaluate(() => window.adapterHarness.counts)).toEqual({
    catalog: baseline.catalog + 1,
    plans: baseline.plans + 1,
    areas: baseline.areas + 1,
    history: baseline.history + 1,
    scene: baseline.scene + 1,
  });
  await page.evaluate(() => window.adapterHarness.controller.dispose());
});

test("rejects delayed old-stream events after an entry switch", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const h = window.adapterHarness;
    const oldCallback = h.callbacks[0];
    h.setCatalogEntry({ ...h.store.value.resources.entry, entryId: "other-entry" });
    h.controller.sync(h.projection("other-entry"), undefined);
    await new Promise(resolve => setTimeout(resolve, 0));
    const before = { ...h.counts };
    oldCallback(h.invalidation(1, ["scene"], { scene: 8 }, 2));
    await new Promise(resolve => setTimeout(resolve, 0));
    window.adapterHarness.result = { before, after: { ...h.counts }, selected: h.store.value.resources.entry?.entryId };
    h.controller.dispose();
  });
  await expect.poll(() => page.evaluate(() => window.adapterHarness.result?.selected)).toBe("other-entry");
  const result = await page.evaluate(() => window.adapterHarness.result);
  expect(result.after).toEqual(result.before);
});
