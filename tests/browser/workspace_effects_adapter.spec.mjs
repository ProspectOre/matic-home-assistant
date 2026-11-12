import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `export { EffectController } from "./frontend/map-studio-v4/effects";
    export { WorkspaceStore } from "./frontend/map-studio-v4/state";
    export { canEditCoordinates, canStartMotion } from "./frontend/map-studio-v4/state";
    export { BackendError } from "./frontend/map-studio-v4/backend";
    export { syntheticEntry, syntheticPlans, syntheticAreas, syntheticHistory } from "./frontend/map-studio-v4-review/synthetic-fixtures";`, resolveDir: process.cwd() },
  bundle: true, format: "esm", write: false,
});

test.beforeEach(async ({ browserName }) => {
  test.skip(browserName !== "chromium", "Workspace effects adapter runs once in Chromium");
});

const setup = async (page, deferInitialSnapshot = false) => {
  await page.route("**/adapter.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async (deferInitialSnapshot) => {
    const { EffectController, WorkspaceStore, canEditCoordinates, canStartMotion, BackendError, syntheticEntry, syntheticPlans, syntheticAreas, syntheticHistory } = await import("/adapter.js");
    const callbacks = [];
    const wireCatalogEntry = entry => ({ entry_id: entry.entryId, scene_url: entry.sceneUrl,
      history_url: entry.historyUrl,
      areas_url: entry.areasUrl, plans_url: entry.plansUrl, map_revision: entry.mapRevision,
      live_workspace_transport_enabled: entry.liveWorkspaceTransportEnabled,
      map_scene_epoch: entry.mapSceneEpoch,
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
    let initialSnapshotReject = null;
    let snapshotCalls = 0;
    const connection = { subscribeMessage: async callback => { callbacks.push(callback); return () => {}; },
      sendMessagePromise: async message => {
        // Home shortcuts read the user's frontend data on the same socket;
        // this harness has none to give (UX9).
        if (message.type?.startsWith("frontend/")) throw new Error("no user data in this harness");
        snapshotCalls += 1;
        return deferInitialSnapshot
          ? await new Promise((resolve, reject) => { initialSnapshotResolve = resolve; initialSnapshotReject = reject; })
          : snapshotFor(message.entry_id);
      } };
    const counts = { catalog: 0, plans: 0, areas: 0, history: 0, scene: 0 };
    // This adapter contract test exercises invalidation routing, not the
    // revision follow loop: the scene below has no manifest, so it is not followed.
    let catalogEntry = { ...syntheticEntry() };
    const backend = { catalog: async () => { counts.catalog += 1; return [catalogEntry]; },
      plans: async () => { counts.plans += 1; return syntheticPlans(); },
      areas: async () => { counts.areas += 1; return syntheticAreas(); },
      history: async () => { counts.history += 1; return syntheticHistory(); },
      scene: async () => { counts.scene += 1; return ({ scene: { revision: 7, source: "live", buffer: new ArrayBuffer(0), pointOffset: 0,
        floorCount: 0, surfaceCount: 0, total: 0, etag: null,
        metadata: { metersPerCell: 0.05, origin: [0, 0], span: [1, 1], sampleStep: 1, rooms: [] } },
        revision: 7, floorCoherent: true }); }, dispose() {},
      setAccessDeniedHandler(handler) { this.accessDenied = handler; } };
    const projection = entryKey => ({ host: { connected: true, administrator: true, robotConnected: true, robotCount: 1 },
      activity: "idle", batteryPercent: 50, language: "en", userKey: "u", vacuumEntityId: "vacuum.x", entryKey,
      robotLabel: "Matic", robots: [{ entryId: entryKey, label: "Matic" }] });
    const store = new WorkspaceStore();
    const controller = new EffectController(store, backend, connection, true);
    controller.sync(projection("synthetic-entry"));
    window.adapterHarness = { callbacks, counts, store, controller, projection, snapshotFor, backend, invalidation,
      get snapshotCalls() { return snapshotCalls; },
      initialSnapshotPending: () => initialSnapshotResolve !== null,
      resolveInitialSnapshot: value => { if (!initialSnapshotResolve) return false; initialSnapshotResolve(value); return true; },
      rejectInitialSnapshot: error => initialSnapshotReject?.(error),
      canEditCoordinates, canStartMotion, BackendError,
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
    // Exercise visible history and a pinned plan: hidden resources deliberately
    // no longer reload on every workspace invalidation.
    await h.controller.openWorkflow("history");
    h.store.replace({ ...h.store.value, homePins: { status: "ready", pins: [{ kind: "plan", id: "synthetic-plan" }] } });
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

test("a ready-looking shortcut state cannot mutate before its persistence loader is initialized", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const h = window.adapterHarness;
    h.controller.dispose();
    h.controller = new h.controller.constructor(h.store, h.backend, null, true);
    h.controller.sync(h.projection("synthetic-entry"));
    // Simulate a stale ready projection arriving before the new lazy module.
    h.store.replace({ ...h.store.value, homePins: { status: "ready", pins: [{ kind: "plan", id: "retained" }] } });
    const before = structuredClone(h.store.value.homePins);
    const accepted = h.controller.saveHomePin({ kind: "plan", id: "retained" }, false, before.pins);
    return { accepted, before, after: h.store.value.homePins, notice: h.store.value.notice?.key };
  });
  expect(result.accepted).toBe(false);
  expect(result.before).toEqual(result.after);
  expect(result.notice).toBe("v4_pins_unavailable");
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

test("authorization loss revokes retained floor proof before returning", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const h = window.adapterHarness;
    h.callbacks[0]({ type: "pose", pose: { position: [4.475, 3.475], heading: null, source: "exact_pose",
      scene_revision: 7, scene_epoch: null, map_floor_coherent: true,
      map_session_key: h.store.value.resources.entry.mapSessionKey, pose_age_seconds: 0 } });
  });
  await expect.poll(() => page.evaluate(() => window.adapterHarness.store.value.map.exactPose)).toBe(true);
  const before = await page.evaluate(() => {
    const h = window.adapterHarness;
    return { generation: h.store.value.generation, available: h.store.value.map.available,
      exactPose: h.store.value.map.exactPose, edit: h.canEditCoordinates(h.store.value),
      motion: h.canStartMotion(h.store.value), counts: { plans: h.counts.plans,
        areas: h.counts.areas, history: h.counts.history, scene: h.counts.scene } };
  });
  expect(before).toMatchObject({ exactPose: true, edit: true, motion: true });
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
    failedSnapshot.status = { state: "unavailable", reason: "authorization", retryable: false };
    failedSnapshot.payload.available = false;
    failedSnapshot.payload.entry = null;
    h.callbacks[0]({ type: "snapshot", snapshot: failedSnapshot });
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.adapterHarness.catalogResolve))).toBe(true);
  const fenced = await page.evaluate(() => {
    const h = window.adapterHarness;
    return { generation: h.store.value.generation, coherence: h.store.value.coherence,
      available: h.store.value.map.available, exactPose: h.store.value.map.exactPose,
      edit: h.canEditCoordinates(h.store.value), motion: h.canStartMotion(h.store.value),
      counts: { plans: h.counts.plans, areas: h.counts.areas,
        history: h.counts.history, scene: h.counts.scene } };
  });
  expect(fenced).toEqual({ generation: before.generation + 1, coherence: "verifying",
    available: before.available, exactPose: false, edit: false, motion: false, counts: before.counts });
  await page.evaluate(() => {
    const h = window.adapterHarness;
    h.catalogResolve([h.store.value.resources.entry]);
  });
  await expect.poll(() => page.evaluate(() => {
    const h = window.adapterHarness;
    return { coherence: h.store.value.coherence,
      edit: h.canEditCoordinates(h.store.value), motion: h.canStartMotion(h.store.value) };
  })).toEqual({ coherence: "current", edit: true, motion: true });
  await expect.poll(() => page.evaluate(counts => {
    const h = window.adapterHarness;
    return h.counts.plans > counts.plans && h.counts.areas > counts.areas
      && h.counts.scene > counts.scene;
  }, before.counts)).toBe(true);
  await page.evaluate(() => window.adapterHarness.controller.dispose());
});

test("an authorization snapshot invalidates spatial caches even when its floor identity is unchanged", async ({ page }) => {
  await setup(page);
  const before = await page.evaluate(() => ({ generation: window.adapterHarness.store.value.generation,
    counts: { ...window.adapterHarness.counts }, edit: window.adapterHarness.canEditCoordinates(window.adapterHarness.store.value) }));
  expect(before.edit).toBe(true);
  await page.evaluate(() => {
    const h = window.adapterHarness;
    h.catalogResolve = null;
    h.backend.catalog = async () => {
      h.counts.catalog += 1;
      return await new Promise(resolve => { h.catalogResolve = resolve; });
    };
    const failedSnapshot = h.snapshotFor("synthetic-entry");
    failedSnapshot.status = { state: "unavailable", reason: "authorization", retryable: false };
    failedSnapshot.payload.available = false;
    failedSnapshot.payload.entry = null;
    // Keep the last floor identity intact. Authorization itself must revoke
    // cached spatial projections even when the identity comparison is stable.
    h.callbacks[0]({ type: "snapshot", snapshot: failedSnapshot });
  });
  await expect.poll(() => page.evaluate(() => ({ coherence: window.adapterHarness.store.value.coherence,
    generation: window.adapterHarness.store.value.generation }))).toMatchObject({ coherence: "verifying",
    generation: before.generation + 1 });
  await expect.poll(() => page.evaluate(() => Boolean(window.adapterHarness.catalogResolve))).toBe(true);
  const fenced = await page.evaluate(() => ({ edit: window.adapterHarness.canEditCoordinates(window.adapterHarness.store.value),
    motion: window.adapterHarness.canStartMotion(window.adapterHarness.store.value) }));
  expect(fenced).toMatchObject({ edit: false, motion: false });
  await page.evaluate(() => window.adapterHarness.catalogResolve([window.adapterHarness.store.value.resources.entry]));
  await expect.poll(() => page.evaluate(() => window.adapterHarness.counts.scene)).toBe(before.counts.scene + 1);
  const after = await page.evaluate(() => ({ ...window.adapterHarness.counts }));
  expect(after.plans).toBeGreaterThan(before.counts.plans);
  expect(after.areas).toBeGreaterThan(before.counts.areas);
  expect(after.history).toBeGreaterThan(before.counts.history);
  await expect.poll(() => page.evaluate(() => window.adapterHarness.store.value.coherence)).toBe("current");
  await page.evaluate(() => window.adapterHarness.controller.dispose());
});

  test("robot authorization notification revokes motion admission while Stop remains independent", async ({ page }) => {
    await setup(page);
    const before = await page.evaluate(() => {
      const h = window.adapterHarness;
      return { generation: h.store.value.generation, edit: h.canEditCoordinates(h.store.value),
        motion: h.canStartMotion(h.store.value) };
    });
    expect(before).toMatchObject({ edit: true, motion: true });
    const after = await page.evaluate(async () => {
      const h = window.adapterHarness;
      h.backend.catalog = async () => {
        h.counts.catalog += 1;
        return await new Promise(resolve => { h.catalogResolve = resolve; });
      };
      h.callbacks[0]({ type: "resync", reason: "authorization" });
      const fenced = { generation: h.store.value.generation, coherence: h.store.value.coherence,
        edit: h.canEditCoordinates(h.store.value), motion: h.canStartMotion(h.store.value) };
      const services = [];
      h.backend.service = async (...args) => { services.push(args); };
      h.store.replace({ ...h.store.value, activity: "cleaning" });
      await h.controller.executeAction("stop");
      const catalogStillPending = Boolean(h.catalogResolve);
      h.controller.dispose();
      return { fenced, services, catalogStillPending };
    });
    expect(after.fenced).toEqual({ generation: before.generation + 1, coherence: "verifying",
      edit: false, motion: false });
    expect(after.catalogStillPending).toBe(true);
    expect(after.services).toEqual([["matic_robot", "stop_intelligent_cleaning",
      { include_unmanaged: true }, "vacuum.x"]]);
  });

for (const recovery of ["explicit retry", "HA reconnect"]) {
test(`HA RPC denial clears protected data until ${recovery} authenticates`, async ({ page }) => {
  await setup(page, true);
  await page.evaluate(async () => {
    const h = window.adapterHarness;
    h.originalCatalog = h.backend.catalog;
    h.services = [];
    h.backend.service = async (...args) => { h.services.push(args); };
    h.rejectInitialSnapshot({ code: "unauthorized" });
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    h.controller.sync({ ...h.projection("synthetic-entry"), activity: "cleaning" });
    await h.controller.executeAction("stop");
    h.backend.catalog = async () => await new Promise((_resolve, reject) => { h.rejectCatalog = reject; });
    h.retry = h.controller.executeAction("recheck-status");
  });
  const protectedState = () => page.evaluate(() => {
    const h = window.adapterHarness;
    return { scene: h.store.value.resources.scene.value, plans: h.store.value.resources.plans.value,
      areas: h.store.value.resources.areas.value, history: h.store.value.resources.history.value,
      edit: h.canEditCoordinates(h.store.value), motion: h.canStartMotion(h.store.value),
      services: h.services, callbacks: h.callbacks.length };
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.adapterHarness.rejectCatalog))).toBe(true);
  expect(await protectedState()).toEqual({ scene: null, plans: null, areas: null, history: null,
    edit: false, motion: false, services: [], callbacks: 0 });
  await page.evaluate(async () => {
    const h = window.adapterHarness;
    h.rejectCatalog(new h.BackendError("request-failed", 403));
    await h.retry;
  });
  expect(await protectedState()).toEqual({ scene: null, plans: null, areas: null, history: null,
    edit: false, motion: false, services: [], callbacks: 0 });
  await page.evaluate(async recovery => {
    const h = window.adapterHarness;
    h.backend.catalog = async () => await new Promise(resolve => { h.resolveRecovery = resolve; });
    if (recovery === "explicit retry") h.retry = h.controller.executeAction("recheck-status");
    else {
      const projection = { ...h.projection("synthetic-entry"), activity: "cleaning" };
      h.controller.sync({ ...projection, host: { ...projection.host, connected: false } });
      h.controller.sync(projection);
    }
    await h.controller.executeAction("stop");
  }, recovery);
  await expect.poll(() => page.evaluate(() => Boolean(window.adapterHarness.resolveRecovery))).toBe(true);
  expect(await protectedState()).toEqual({ scene: null, plans: null, areas: null, history: null,
    edit: false, motion: false, services: [], callbacks: 0 });
  await page.evaluate(async () => {
    const h = window.adapterHarness;
    h.resolveRecovery(await h.originalCatalog());
  });
  await expect.poll(() => page.evaluate(() => window.adapterHarness.store.value.resources.scene.status)).toBe("ready");
  await page.evaluate(async () => {
    const h = window.adapterHarness;
    await h.controller.executeAction("stop");
    h.controller.dispose();
  });
  expect(await page.evaluate(() => window.adapterHarness.services)).toEqual([
    ["matic_robot", "stop_intelligent_cleaning", { include_unmanaged: true }, "vacuum.x"],
  ]);
});
}

for (const source of ["archive", "backend"]) {
test(`${source} access denial rejects old stream callbacks and late protected reads`, async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const h = window.adapterHarness;
    h.previousPlans = h.store.value.resources.plans.value;
    h.backend.plans = async () => await new Promise(resolve => { h.releasePlans = resolve; });
    h.callbacks[0](h.invalidation(1, ["plans"], { plans: 1 }));
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.adapterHarness.releasePlans))).toBe(true);
  await page.evaluate(async source => {
    const h = window.adapterHarness;
    if (source === "archive") h.controller.archiveAccessDenied();
    else h.backend.accessDenied();
    h.controller.sync({ ...h.projection("synthetic-entry"), activity: "cleaning" });
    const stale = h.snapshotFor("synthetic-entry");
    stale.sequence = 2;
    h.callbacks[0]({ type: "snapshot", snapshot: stale });
    h.callbacks[0](h.invalidation(3, ["plans", "areas", "history"], { plans: 2, areas: 1, history: 1 }));
    h.releasePlans(h.previousPlans);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
  }, source);
  expect(await page.evaluate(() => {
    const h = window.adapterHarness;
    return { scene: h.store.value.resources.scene.value, plans: h.store.value.resources.plans.value,
      areas: h.store.value.resources.areas.value, history: h.store.value.resources.history.value,
      catalog: h.store.value.resources.catalog.value, activity: h.store.value.activity,
      edit: h.canEditCoordinates(h.store.value), motion: h.canStartMotion(h.store.value) };
  })).toEqual({ scene: null, plans: null, areas: null, history: null, catalog: null,
    activity: "idle", edit: false, motion: false });
  await page.evaluate(() => window.adapterHarness.controller.dispose());
});
}

test("robot reauthentication immediately resumes an authorization-blocked workspace snapshot stream", async ({ page }) => {
  await setup(page);
  const initialSnapshots = await page.evaluate(() => window.adapterHarness.snapshotCalls);
  await page.evaluate(() => window.adapterHarness.callbacks[0]({ type: "resync", reason: "authorization" }));
  await page.evaluate(() => {
    const h = window.adapterHarness;
    h.controller.sync({ ...h.projection("synthetic-entry"), host: { ...h.projection("synthetic-entry").host,
      robotConnected: false } });
    h.controller.sync(h.projection("synthetic-entry"));
  });
  await expect.poll(() => page.evaluate(() => window.adapterHarness.snapshotCalls)).toBe(initialSnapshots + 1);

  const catalogBefore = await page.evaluate(() => window.adapterHarness.counts.catalog);
  await page.evaluate(() => window.adapterHarness.callbacks[0](window.adapterHarness.invalidation(1, ["status"], { status: 1 })));
  await expect.poll(() => page.evaluate(() => window.adapterHarness.counts.catalog)).toBe(catalogBefore + 1);
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
    h.controller.sync(h.projection("other-entry"));
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

test("entry removal waits through a pre-event catalog and failed forced successor", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const h = window.adapterHarness;
    const entry = h.store.value.resources.entry;
    const pendingCatalog = [];
    let holdNext = true;
    let failNext = false;
    h.backend.catalog = async () => {
      h.counts.catalog += 1;
      if (holdNext) {
        holdNext = false;
        return await new Promise(resolve => pendingCatalog.push(resolve));
      }
      if (failNext) {
        failNext = false;
        throw new h.BackendError("catalog-unavailable", 503);
      }
      return [entry];
    };

    const preEventRead = h.controller.refreshCatalog(true);
    for (let tick = 0; tick < 20 && pendingCatalog.length === 0; tick += 1) await Promise.resolve();
    if (pendingCatalog.length !== 1) throw new Error("pre-event catalog request did not start");
    h.callbacks[0]({ type: "resync", reason: "entry_removed" });
    failNext = true;
    pendingCatalog.shift()([entry]); // stale request succeeds after removal
    await preEventRead; // includes the forced successor queued by refreshBoundary
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const afterStaleAndFailedSuccessor = {
      subscriptions: h.callbacks.length,
      catalogStatus: h.store.value.resources.catalog.status,
    };

    await h.controller.refreshCatalog(true); // later successful poll is a fresh proof
    for (let tick = 0; tick < 40 && h.callbacks.length < 2; tick += 1) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const afterFreshProof = { subscriptions: h.callbacks.length, status: h.store.value.resources.catalog.status };

    holdNext = true;
    const disconnectedRead = h.controller.refreshCatalog(true);
    for (let tick = 0; tick < 20 && pendingCatalog.length === 0; tick += 1) await Promise.resolve();
    if (pendingCatalog.length !== 1) throw new Error("second pre-event catalog request did not start");
    h.callbacks[1]({ type: "resync", reason: "entry_removed" });
    const disconnected = h.projection("synthetic-entry");
    h.controller.sync({ ...disconnected, host: { ...disconnected.host, connected: false } });
    pendingCatalog.shift()([entry]);
    await disconnectedRead; // disconnect aborts the predecessor and cancels its queued successor
    holdNext = true;
    h.controller.sync(h.projection("synthetic-entry")); // reconnect starts a fresh proof request
    for (let tick = 0; tick < 20 && pendingCatalog.length === 0; tick += 1) await Promise.resolve();
    if (pendingCatalog.length !== 1) throw new Error("reconnect catalog request did not start");
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const afterReconnectBeforeFreshProof = h.callbacks.length;
    pendingCatalog.shift()([entry]);
    for (let tick = 0; tick < 40 && h.callbacks.length < 3; tick += 1) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const afterReconnectFreshProof = h.callbacks.length;
    h.controller.dispose();
    return { afterStaleAndFailedSuccessor, afterFreshProof, afterReconnectBeforeFreshProof, afterReconnectFreshProof };
  });
  expect(result).toEqual({
    afterStaleAndFailedSuccessor: { subscriptions: 1, catalogStatus: "error" },
    afterFreshProof: { subscriptions: 2, status: "ready" },
    afterReconnectBeforeFreshProof: 2,
    afterReconnectFreshProof: 3,
  });
});
