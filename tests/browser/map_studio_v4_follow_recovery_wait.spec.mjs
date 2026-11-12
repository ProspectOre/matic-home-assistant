import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadRecoveryHarness(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state"; export { workspacePoseConnection } from "./tests/browser/workspace_pose_connection.mjs";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "iife",
    globalName: "__followRecoveryWaitModules",
    write: false,
  });
  await page.route("**/follow-recovery-wait.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: "/follow-recovery-wait.js" });
}

async function startRecovery(page, failure = null) {
  await page.evaluate((failure) => {
    const { EffectController, WorkspaceStore, createGalleryState, workspacePoseConnection } = window.__followRecoveryWaitModules;
    const initial = createGalleryState("ready");
    const entryA = initial.resources.entry;
    const entryB = {
      ...entryA,
      entryId: "synthetic-entry-b",
      sceneUrl: "/synthetic-scene-b",
      historyUrl: "/synthetic-history-b",
      plansUrl: "/synthetic-plans-b",
      areasUrl: "/synthetic-areas-b",
      mapSessionKey: "b".repeat(64),
    };
    const savedHistory = {
      entryId: entryA.entryId,
      liveAvailable: true,
      floors: [{ id: "saved-1", active: false, readOnly: true, liveAvailable: false,
        label: "Saved floor", ordinal: 1, snapshots: [{ id: "saved-snapshot-a",
          createdAt: "2026-09-30T11:00:00Z", revision: 7, pointCount: 1,
          sceneUrl: "/synthetic-saved-scene-a" }] }],
    };
    const probe = window.__followRecoveryWait = {
      selectedId: entryA.entryId,
      sceneReads: { a: 0, b: 0 },
      followReads: { a: 0, b: 0 },
      followAborts: { a: 0, b: 0 },
      catalogReads: 0,
      cooldownTimers: 0,
      cooldownDelays: [],
      sceneFailuresRemaining: failure === "scene" ? 1 : 0,
      catalogFailuresRemaining: failure === "catalog" ? 1 : 0,
      replacementFollowFailuresRemaining: failure === "follow" ? 1 : 0,
      releaseA: null,
      failInitialFollow: null,
      catalogPending: false,
      before204: null,
    };
    const setTimeoutBase = window.__followRecoveryWaitSetTimeoutBase
      ?? (window.__followRecoveryWaitSetTimeoutBase = window.setTimeout.bind(window));
    window.setTimeout = (callback, delay, ...args) => {
      // Count only the spatial read recovery cooldown. A live pose also arms a
      // freshness expiry that can share the 5 s delay but is not a retry.
      if (typeof callback === "function" && String(callback).includes("retryTimer = null")) {
        window.__followRecoveryWait.cooldownTimers += 1;
        window.__followRecoveryWait.cooldownDelays.push(delay);
      }
      return setTimeoutBase(callback, delay, ...args);
    };
    const store = new WorkspaceStore({
      ...initial,
      resources: {
        ...initial.resources,
        catalog: { status: "ready", value: [entryA], problem: null },
        entry: entryA,
        history: { status: "ready", value: savedHistory, problem: null },
      },
    });
    const connection = workspacePoseConnection();
    const backend = {
      catalog: async (signal) => {
        probe.catalogReads += 1;
        if (failure === "queued-catalog" && probe.catalogReads === 2) {
          probe.catalogPending = true;
          await new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              probe.catalogPending = false;
              reject(new DOMException("Aborted", "AbortError"));
            }, { once: true });
          });
        }
        if (probe.catalogReads > 1 && probe.catalogFailuresRemaining > 0) {
          probe.catalogFailuresRemaining -= 1;
          throw new Error("synthetic terminal catalog failure");
        }
        return [probe.selectedId === entryA.entryId ? entryA : entryB];
      },
      // A scene with a manifest is followed: each later read waits on `since`.
      scene: async (url, revision, floorCoherent, _source, signal, follow = {}) => {
        if (follow.since !== undefined) return followScene(url, signal);
        const key = url === entryA.sceneUrl ? "a" : "b";
        probe.sceneReads[key] += 1;
        if (key === "a" && probe.sceneReads.a > 1 && probe.sceneFailuresRemaining > 0) {
          probe.sceneFailuresRemaining -= 1;
          throw new Error("synthetic terminal scene failure");
        }
        return { scene: { ...initial.resources.scene.value, manifest: new ArrayBuffer(1) }, revision, floorCoherent: true };
      },
      history: async () => savedHistory,
      plans: async () => initial.resources.plans.value,
      areas: async () => initial.resources.areas.value,
      dispose() {},
    };
    const followScene = async (url, signal) => {
      const key = url === entryA.sceneUrl ? "a" : "b";
      probe.followReads[key] += 1;
      if (key === "a" && probe.followReads.a === 1) {
        if (failure === "queued-catalog") {
          await new Promise((_resolve, reject) => {
            probe.failInitialFollow = () => reject(new Error("synthetic transient revision wait failure"));
          });
        }
        throw new Error("synthetic transient revision wait failure");
      }
      if (key === "a" && probe.replacementFollowFailuresRemaining > 0) {
        probe.replacementFollowFailuresRemaining -= 1;
        throw new Error("synthetic replacement revision wait failure");
      }
      if (key === "a" && probe.followReads.a >= 2) {
        return new Promise((resolve, reject) => {
          probe.releaseA = () => resolve({ notModified: true, scene: null, revision: entryA.mapRevision, floorCoherent: true });
          signal.addEventListener("abort", () => {
            probe.followAborts.a += 1;
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          probe.followAborts[key] += 1;
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    };
    const effects = new EffectController(store, backend, connection, true);

    const projection = {
      host: initial.host,
      activity: initial.activity,
      batteryPercent: initial.batteryPercent,
      robotLabel: initial.robotLabel,
      robots: [
        { entryId: entryA.entryId, label: "Robot A" },
        { entryId: entryB.entryId, label: "Robot B" },
      ],
      language: "en",
      userKey: "follow-recovery-test",
      entryKey: entryA.entryId,
      vacuumEntityId: "vacuum.synthetic",
    };
    effects.sync(projection);
    void effects.refreshCatalog(true);
    window.__followRecoveryWaitRun = { effects, store, projection, entryA, entryB, connection,
      position: initial.resources.pose.value.position };
  }, failure);
  if (failure === "queued-catalog") {
    await expect.poll(() => page.evaluate(() => typeof window.__followRecoveryWait.failInitialFollow)).toBe("function");
    return;
  }
  if (failure === "catalog") {
    await expect.poll(() => page.evaluate(() => window.__followRecoveryWaitRun.store.value.resources.catalog.status))
      .toBe("error");
  } else if (failure === "scene") {
    await expect.poll(() => page.evaluate(() => window.__followRecoveryWaitRun.store.value.resources.scene.status))
      .toBe("error");
  } else {
    await expect.poll(() => page.evaluate(() => window.__followRecoveryWait.followReads.a)).toBe(2);
  }
  if (failure !== null) {
    await expect.poll(() => page.evaluate(() => window.__followRecoveryWait.cooldownTimers)).toBe(1);
  }
}

test("@safety scene recovery waits for the replacement revision wait and treats delayed 204 as success", async ({ page }) => {
  const anchor = new Date("2026-09-30T12:00:00Z");
  await page.clock.install({ time: anchor });
  await page.clock.pauseAt(anchor);
  await loadRecoveryHarness(page);
  await startRecovery(page);

  const before = await page.evaluate(() => ({
    sceneReads: { ...window.__followRecoveryWait.sceneReads },
    followReads: { ...window.__followRecoveryWait.followReads },
    followAborts: { ...window.__followRecoveryWait.followAborts },
    releaseAvailable: typeof window.__followRecoveryWait.releaseA === "function",
  }));
  expect(before.sceneReads.a).toBe(2);
  expect(before.releaseAvailable).toBe(true);

  const before204 = await page.evaluate(() => {
    const { store } = window.__followRecoveryWaitRun;
    const state = store.value;
    window.__followRecoveryWait.before204 = {
      scene: state.resources.scene.value,
      pose: state.resources.pose.value,
      revision: state.resources.entry.mapRevision,
      exactPose: state.map.exactPose,
      floorCoherent: state.map.floorCoherent,
      sessionVerified: state.map.sessionVerified,
      coherence: state.coherence,
      floorReadOnly: state.floor.readOnly,
    };
    return {
      hasScene: state.resources.scene.value !== null,
      hasPose: state.resources.pose.value !== null,
      exactPose: state.map.exactPose,
      floorCoherent: state.map.floorCoherent,
      sessionVerified: state.map.sessionVerified,
    };
  });
  expect(before204).toEqual({
    hasScene: true,
    hasPose: true,
    exactPose: true,
    floorCoherent: true,
    sessionVerified: true,
  });
  await page.clock.fastForward(6_000);
  expect(await page.evaluate(() => ({
    sceneReads: window.__followRecoveryWait.sceneReads,
    followReads: window.__followRecoveryWait.followReads,
    followAborts: window.__followRecoveryWait.followAborts,
  }))).toEqual({
    sceneReads: { a: before.sceneReads.a, b: 0 },
    followReads: { a: before.followReads.a, b: 0 },
    followAborts: { a: 0, b: 0 },
  });

  await page.evaluate(() => window.__followRecoveryWait.releaseA());
  // A successful no-content response waits briefly before the next long-poll.
  await page.clock.fastForward(100);
  await expect.poll(() => page.evaluate(() => window.__followRecoveryWait.followReads.a)).toBeGreaterThan(2);
  expect(await page.evaluate(() => {
    const { store } = window.__followRecoveryWaitRun;
    const before = window.__followRecoveryWait.before204;
    const state = store.value;
    return {
      sameScene: state.resources.scene.value === before.scene,
      samePose: state.resources.pose.value === before.pose,
      sameRevision: state.resources.entry.mapRevision === before.revision,
      exactPose: state.map.exactPose === before.exactPose,
      floorCoherent: state.map.floorCoherent === before.floorCoherent,
      sessionVerified: state.map.sessionVerified === before.sessionVerified,
      coherence: state.coherence === before.coherence,
      floorReadOnly: state.floor.readOnly === before.floorReadOnly,
    };
  })).toEqual({
    sameScene: true,
    samePose: true,
    sameRevision: true,
    exactPose: true,
    floorCoherent: true,
    sessionVerified: true,
    coherence: true,
    floorReadOnly: true,
  });
  await page.clock.fastForward(6_000);
  expect(await page.evaluate(() => ({
    sceneReads: window.__followRecoveryWait.sceneReads,
    followAborts: window.__followRecoveryWait.followAborts,
  }))).toEqual({ sceneReads: { a: 2, b: 0 }, followAborts: { a: 0, b: 0 } });
  await page.evaluate(() => window.__followRecoveryWaitRun.effects.dispose());
});

for (const boundary of ["floor", "entry", "dispose"]) {
  test(`@safety a ${boundary} change cancels a recovery waiting on its replacement revision wait`, async ({ page }) => {
    const anchor = new Date("2026-09-30T12:00:00Z");
    await page.clock.install({ time: anchor });
    await page.clock.pauseAt(anchor);
    await loadRecoveryHarness(page);
    await startRecovery(page);
    const before = await page.evaluate(() => ({
      sceneReads: { ...window.__followRecoveryWait.sceneReads },
      followReads: { ...window.__followRecoveryWait.followReads },
      catalogReads: window.__followRecoveryWait.catalogReads,
    }));

    if (boundary === "floor") {
      await page.evaluate(() => window.__followRecoveryWaitRun.effects.openWorkflow("history"));
      await page.evaluate(() => window.__followRecoveryWaitRun.effects.selectFloor("saved-1"));
      await expect.poll(() => page.evaluate(() => window.__followRecoveryWaitRun.store.value.dataMode)).toBe("history");
    } else if (boundary === "entry") {
      await page.evaluate(() => {
        const run = window.__followRecoveryWaitRun;
        window.__followRecoveryWait.selectedId = run.entryB.entryId;
        run.effects.sync({
          ...run.projection,
          entryKey: run.entryB.entryId,
          vacuumEntityId: "vacuum.synthetic_b",
          activity: "docked",
        });
      });
      await expect.poll(() => page.evaluate(() => window.__followRecoveryWaitRun.store.value.selection.entryId))
        .toBe("synthetic-entry-b");
    } else {
      await page.evaluate(() => window.__followRecoveryWaitRun.effects.dispose());
    }

    await page.clock.fastForward(6_000);
    const after = await page.evaluate(() => ({
      sceneReads: window.__followRecoveryWait.sceneReads,
      followReads: window.__followRecoveryWait.followReads,
      followAborts: window.__followRecoveryWait.followAborts,
      catalogReads: window.__followRecoveryWait.catalogReads,
    }));
    expect(after.sceneReads.a).toBe(before.sceneReads.a);
    expect(after.followReads.a).toBe(before.followReads.a);
    expect(after.followAborts.a).toBe(1);
    if (boundary === "dispose") expect(after.catalogReads).toBe(before.catalogReads);
    if (boundary === "entry") {
      expect(after.sceneReads.b).toBeGreaterThan(0);
      expect(after.followReads.b).toBeGreaterThan(0);
    }
    await page.evaluate(() => window.__followRecoveryWaitRun.effects.dispose());
  });
}

test("@safety a pose mismatch during replacement revision-wait recovery releases the waiter for one cooldown retry", async ({ page }) => {
  const anchor = new Date("2026-09-30T12:00:00Z");
  await page.clock.install({ time: anchor });
  await page.clock.pauseAt(anchor);
  await loadRecoveryHarness(page);
  await startRecovery(page);

  // The workspace subscription opens after the map is drawn.
  await page.clock.runFor(100);
  const pushPose = (sessionKey) => page.evaluate((key) => {
    const { connection, position } = window.__followRecoveryWaitRun;
    connection.push({ position, map_session_key: key });
  }, sessionKey);
  await expect.poll(() => page.evaluate(() => window.__followRecoveryWaitRun.connection.subscribed())).toBe(true);
  await pushPose("c".repeat(64));
  await expect.poll(() => page.evaluate(() => window.__followRecoveryWait.followAborts.a)).toBe(1);
  const invalidated = await page.evaluate(() => ({
    sceneReads: { ...window.__followRecoveryWait.sceneReads },
    followReads: { ...window.__followRecoveryWait.followReads },
  }));
  expect(invalidated.sceneReads.a).toBe(2);
  expect(invalidated.followReads.a).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__followRecoveryWait.cooldownTimers)).toBe(1);

  // The robot's next position is on the admitted map again; the retry admits it.
  await pushPose(await page.evaluate(() => window.__followRecoveryWaitRun.entryA.mapSessionKey));
  await page.clock.fastForward(5_000);
  await expect.poll(() => page.evaluate(() => window.__followRecoveryWait.followReads.a)).toBe(3);
  const retried = await page.evaluate(() => ({
    sceneReads: { ...window.__followRecoveryWait.sceneReads },
    followAborts: { ...window.__followRecoveryWait.followAborts },
    cooldownTimers: window.__followRecoveryWait.cooldownTimers,
    releaseAvailable: typeof window.__followRecoveryWait.releaseA === "function",
  }));
  expect(retried.sceneReads.a).toBe(3);
  expect(retried.followAborts.a).toBe(1);
  expect(retried.cooldownTimers).toBe(1);
  expect(retried.releaseAvailable).toBe(true);

  await page.clock.fastForward(6_000);
  expect(await page.evaluate(() => ({
    sceneReads: window.__followRecoveryWait.sceneReads,
    followReads: window.__followRecoveryWait.followReads,
    followAborts: window.__followRecoveryWait.followAborts,
  }))).toEqual({
    sceneReads: { a: 3, b: 0 },
    followReads: { a: 3, b: 0 },
    followAborts: { a: 1, b: 0 },
  });
  await page.evaluate(() => {
    const probe = window.__followRecoveryWait;
    const run = window.__followRecoveryWaitRun;
    probe.releaseA();
    run.effects.dispose();
  });
});

test("@safety terminal recovery reads and a failed replacement revision wait release the waiter for one cooldown retry", async ({ page }) => {
  const anchor = new Date("2026-09-30T12:00:00Z");
  await page.clock.install({ time: anchor });
  await page.clock.pauseAt(anchor);
  await loadRecoveryHarness(page);
  const outcomes = [];
  for (const failure of ["catalog", "scene", "follow"]) {
    await startRecovery(page, failure);
    await page.clock.fastForward(5_000);
    await expect.poll(() => page.evaluate(() => window.__followRecoveryWait.releaseA !== null)).toBe(true);
    const retried = await page.evaluate(() => ({
      sceneReads: { ...window.__followRecoveryWait.sceneReads },
      followReads: { ...window.__followRecoveryWait.followReads },
      catalogReads: window.__followRecoveryWait.catalogReads,
      cooldownTimers: window.__followRecoveryWait.cooldownTimers,
      releaseAvailable: typeof window.__followRecoveryWait.releaseA === "function",
    }));
    expect(retried.releaseAvailable).toBe(true);
    expect(retried.cooldownTimers).toBe(1);
    if (failure === "catalog") {
      expect(retried.catalogReads).toBeGreaterThanOrEqual(3);
      expect(retried.sceneReads.a).toBe(2);
      expect(retried.followReads.a).toBe(2);
    } else if (failure === "scene") {
      expect(retried.sceneReads.a).toBe(3);
      expect(retried.followReads.a).toBe(2);
    } else {
      expect(retried.sceneReads.a).toBe(3);
      expect(retried.followReads.a).toBe(3);
    }
    await page.evaluate(() => window.__followRecoveryWait.releaseA());
    await page.clock.fastForward(100);
    await page.clock.fastForward(6_000);
    outcomes.push(await page.evaluate(() => ({
      sceneReads: { ...window.__followRecoveryWait.sceneReads },
      followAborts: { ...window.__followRecoveryWait.followAborts },
    })));
    await page.evaluate(() => window.__followRecoveryWaitRun.effects.dispose());
  }
  expect(outcomes).toEqual([
    { sceneReads: { a: 2, b: 0 }, followAborts: { a: 0, b: 0 } },
    { sceneReads: { a: 3, b: 0 }, followAborts: { a: 0, b: 0 } },
    { sceneReads: { a: 3, b: 0 }, followAborts: { a: 0, b: 0 } },
  ]);
});

test("@safety queued revision-wait recovery preserves the verified generation while superseding a catalog poll", async ({ page }) => {
  await loadRecoveryHarness(page);
  await startRecovery(page, "queued-catalog");
  const generation = await page.evaluate(() => window.__followRecoveryWaitRun.store.value.generation);
  await page.evaluate(() => { void window.__followRecoveryWaitRun.effects.refreshCatalog(); });
  await expect.poll(() => page.evaluate(() => window.__followRecoveryWait.catalogPending)).toBe(true);
  await page.evaluate(() => window.__followRecoveryWait.failInitialFollow());
  await expect.poll(() => page.evaluate(() => window.__followRecoveryWait.followReads.a)).toBe(2);
  expect(await page.evaluate(() => {
    const state = window.__followRecoveryWaitRun.store.value;
    return { generation: state.generation, exactPose: state.map.exactPose,
      floorReadOnly: state.floor.readOnly, sceneStatus: state.resources.scene.status };
  })).toEqual({ generation, exactPose: true, floorReadOnly: false, sceneStatus: "ready" });
  await page.evaluate(() => window.__followRecoveryWaitRun.effects.dispose());
});

test("active revision wait owns pixel admission across 204 gaps and catalog revisions", async ({ page }) => {
  await loadRecoveryHarness(page);
  await page.evaluate(async () => {
    const m = window.__followRecoveryWaitModules;
    const initial = m.createGalleryState("ready");
    const state = window.__followCatalogRace = {
      entry: { ...initial.resources.entry },
      sceneCalls: 0,
      followCalls: 0,
      release204: null,
      releaseFollow: null,
    };
    // A manifest scene is followed by revision waits.
    const liveScene = { ...initial.resources.scene.value, manifest: new ArrayBuffer(1) };
    const store = state.store = new m.WorkspaceStore(initial);
    const effects = state.effects = new m.EffectController(store, {
      catalog: async () => [state.entry],
      history: async () => initial.resources.history.value,
      scene: async (_url, revision, _floorCoherent, _source, signal, follow = {}) => {
        if (follow.since === undefined) {
          state.sceneCalls += 1;
          return { scene: liveScene, revision, floorCoherent: true };
        }
        const call = ++state.followCalls;
        if (call === 1) return new Promise((resolve) => {
          state.release204 = () => resolve({ revision: state.entry.mapRevision, floorCoherent: true, scene: null, notModified: true });
        });
        if (call === 2) return new Promise((resolve) => {
          state.releaseFollow = () => resolve({ revision: state.entry.mapRevision, floorCoherent: true, scene: liveScene });
        });
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      },
      pose: async () => initial.resources.pose.value,
      plans: async () => initial.resources.plans.value,
      dispose() {},
    });
    const projection = {
      host: initial.host, activity: initial.activity, batteryPercent: 92,
      robotLabel: "Synthetic", robots: initial.robots, language: "en",
      userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
    };
    effects.sync(projection);
    await effects.refreshCatalog(true);
  });
  await expect.poll(() => page.evaluate(() => window.__followCatalogRace.followCalls)).toBe(1);
  await page.evaluate(() => window.__followCatalogRace.release204());
  await expect.poll(() => page.evaluate(() => window.__followCatalogRace.followCalls)).toBe(2);

  const catalogDuringFollow = await page.evaluate(async () => {
    const s = window.__followCatalogRace;
    const revision = s.store.value.resources.entry.mapRevision;
    const generation = s.store.value.generation;
    s.entry = { ...s.entry, mapRevision: revision + 1 };
    await s.effects.refreshCatalog();
    return {
      generationBefore: generation,
      generationAfter: s.store.value.generation,
      revisionBefore: revision,
      revisionAfterCatalog: s.store.value.resources.entry.mapRevision,
      sceneCalls: s.sceneCalls,
    };
  });
  expect(catalogDuringFollow.generationAfter).toBe(catalogDuringFollow.generationBefore);
  expect(catalogDuringFollow.revisionAfterCatalog).toBe(catalogDuringFollow.revisionBefore);
  expect(catalogDuringFollow.sceneCalls).toBe(1);

  const advanced = await page.evaluate(async () => {
    const s = window.__followCatalogRace;
    s.releaseFollow();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const revision = s.store.value.resources.entry.mapRevision;
    const generation = s.store.value.generation;
    s.entry = { ...s.entry, mapRevision: revision + 1 };
    await s.effects.refreshCatalog();
    const ownerPreserved = {
      generationBefore: generation,
      generationAfter: s.store.value.generation,
      revisionBefore: revision,
      revisionAfterCatalog: s.store.value.resources.entry.mapRevision,
      sceneCalls: s.sceneCalls,
      followCalls: s.followCalls,
    };
    const boundaryGeneration = s.store.value.generation;
    s.entry = { ...s.entry, selectedFloorOrdinal: 2, mapFloorOrdinal: 2 };
    await s.effects.refreshCatalog(true);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const proofBoundary = {
      generationBefore: boundaryGeneration,
      generationAfter: s.store.value.generation,
      sceneCalls: s.sceneCalls,
    };
    s.effects.dispose();
    return { ownerPreserved, proofBoundary };
  });
  expect(advanced.ownerPreserved.generationAfter).toBe(advanced.ownerPreserved.generationBefore);
  expect(advanced.ownerPreserved.revisionAfterCatalog).toBe(advanced.ownerPreserved.revisionBefore);
  expect(advanced.ownerPreserved.sceneCalls).toBe(1);
  expect(advanced.ownerPreserved.followCalls).toBeGreaterThanOrEqual(3);
  expect(advanced.proofBoundary.generationAfter).toBeGreaterThan(advanced.proofBoundary.generationBefore);
  expect(advanced.proofBoundary.sceneCalls).toBe(2);
});
