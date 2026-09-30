import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadRecoveryHarness(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/delta-recovery-wait.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

async function startRecovery(page, failure = null) {
  await page.evaluate(async (failure) => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/delta-recovery-wait.js");
    const initial = createGalleryState("ready");
    const entryA = { ...initial.resources.entry, deltaUrl: "/synthetic-delta-a" };
    const entryB = {
      ...entryA,
      entryId: "synthetic-entry-b",
      sceneUrl: "/synthetic-scene-b",
      deltaUrl: "/synthetic-delta-b",
      poseUrl: "/synthetic-pose-b",
      historyUrl: "/synthetic-history-b",
      plansUrl: "/synthetic-plans-b",
      areasUrl: "/synthetic-areas-b",
      mapSessionKey: "b".repeat(64),
    };
    const probe = window.__deltaRecoveryWait = {
      selectedId: entryA.entryId,
      sceneReads: { a: 0, b: 0 },
      deltaReads: { a: 0, b: 0 },
      deltaAborts: { a: 0, b: 0 },
      catalogReads: 0,
      poseReads: 0,
      mismatchNextPose: false,
      cooldownTimers: 0,
      sceneFailuresRemaining: failure === "scene" ? 1 : 0,
      catalogFailuresRemaining: failure === "catalog" ? 1 : 0,
      replacementDeltaFailuresRemaining: failure === "delta" ? 1 : 0,
      releaseA: null,
      before204: null,
    };
    const setTimeoutBase = window.__deltaRecoveryWaitSetTimeoutBase
      ?? (window.__deltaRecoveryWaitSetTimeoutBase = window.setTimeout.bind(window));
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 5_000) window.__deltaRecoveryWait.cooldownTimers += 1;
      return setTimeoutBase(callback, delay, ...args);
    };
    const store = new WorkspaceStore({
      ...initial,
      resources: {
        ...initial.resources,
        catalog: { status: "ready", value: [entryA], problem: null },
        entry: entryA,
      },
    });
    const effects = new EffectController(store, {
      catalog: async () => {
        probe.catalogReads += 1;
        if (probe.catalogReads > 1 && probe.catalogFailuresRemaining > 0) {
          probe.catalogFailuresRemaining -= 1;
          throw new Error("synthetic terminal catalog failure");
        }
        return [probe.selectedId === entryA.entryId ? entryA : entryB];
      },
      scene: async (url, revision) => {
        const key = url === entryA.sceneUrl ? "a" : "b";
        probe.sceneReads[key] += 1;
        if (key === "a" && probe.sceneReads.a > 1 && probe.sceneFailuresRemaining > 0) {
          probe.sceneFailuresRemaining -= 1;
          throw new Error("synthetic terminal scene failure");
        }
        return { scene: initial.resources.scene.value, revision, floorCoherent: true };
      },
      pose: async () => {
        probe.poseReads += 1;
        if (probe.mismatchNextPose) {
          probe.mismatchNextPose = false;
          return { ...initial.resources.pose.value, mapSessionKey: "c".repeat(64) };
        }
        return initial.resources.pose.value;
      },
      history: async () => initial.resources.history.value,
      plans: async () => initial.resources.plans.value,
      areas: async () => initial.resources.areas.value,
      sceneDelta: async (url, _scene, _floorCoherent, signal) => {
        const key = url === entryA.deltaUrl ? "a" : "b";
        probe.deltaReads[key] += 1;
        if (key === "a" && probe.deltaReads.a === 1) throw new Error("synthetic transient delta failure");
        if (key === "a" && probe.replacementDeltaFailuresRemaining > 0) {
          probe.replacementDeltaFailuresRemaining -= 1;
          throw new Error("synthetic replacement delta failure");
        }
        if (key === "a" && probe.deltaReads.a >= 2) {
          return new Promise((resolve, reject) => {
            probe.releaseA = () => resolve({ notModified: true, scene: null, revision: entryA.mapRevision, floorCoherent: true });
            signal.addEventListener("abort", () => {
              probe.deltaAborts.a += 1;
              reject(new DOMException("Aborted", "AbortError"));
            }, { once: true });
          });
        }
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => {
            probe.deltaAborts[key] += 1;
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      },
      dispose() {},
    }, null, false);
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
      userKey: "delta-recovery-test",
      entryKey: entryA.entryId,
      vacuumEntityId: "vacuum.synthetic",
    };
    effects.sync(projection);
    void effects.refreshCatalog(true);
    window.__deltaRecoveryWaitRun = { effects, store, projection, entryA, entryB };
  }, failure);
  if (failure === "catalog") {
    await expect.poll(() => page.evaluate(() => window.__deltaRecoveryWaitRun.store.value.resources.catalog.status))
      .toBe("error");
  } else if (failure === "scene") {
    await expect.poll(() => page.evaluate(() => window.__deltaRecoveryWaitRun.store.value.resources.scene.status))
      .toBe("error");
  } else {
    await expect.poll(() => page.evaluate(() => window.__deltaRecoveryWait.deltaReads.a)).toBe(2);
  }
  if (failure !== null) {
    await expect.poll(() => page.evaluate(() => window.__deltaRecoveryWait.cooldownTimers)).toBe(1);
  }
}

test("@safety delta recovery waits for the replacement long-poll result and treats delayed 204 as success", async ({ page }) => {
  const anchor = new Date("2026-09-30T12:00:00Z");
  await page.clock.install({ time: anchor });
  await page.clock.pauseAt(anchor);
  await loadRecoveryHarness(page);
  await startRecovery(page);

  const before = await page.evaluate(() => ({
    sceneReads: { ...window.__deltaRecoveryWait.sceneReads },
    deltaReads: { ...window.__deltaRecoveryWait.deltaReads },
    deltaAborts: { ...window.__deltaRecoveryWait.deltaAborts },
    releaseAvailable: typeof window.__deltaRecoveryWait.releaseA === "function",
  }));
  expect(before.sceneReads.a).toBe(2);
  expect(before.releaseAvailable).toBe(true);

  const before204 = await page.evaluate(() => {
    const { store } = window.__deltaRecoveryWaitRun;
    const state = store.value;
    window.__deltaRecoveryWait.before204 = {
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
    sceneReads: window.__deltaRecoveryWait.sceneReads,
    deltaReads: window.__deltaRecoveryWait.deltaReads,
    deltaAborts: window.__deltaRecoveryWait.deltaAborts,
  }))).toEqual({
    sceneReads: { a: before.sceneReads.a, b: 0 },
    deltaReads: { a: before.deltaReads.a, b: 0 },
    deltaAborts: { a: 0, b: 0 },
  });

  await page.evaluate(() => window.__deltaRecoveryWait.releaseA());
  // A successful no-content response waits briefly before the next long-poll.
  await page.clock.fastForward(100);
  await expect.poll(() => page.evaluate(() => window.__deltaRecoveryWait.deltaReads.a)).toBeGreaterThan(2);
  expect(await page.evaluate(() => {
    const { store } = window.__deltaRecoveryWaitRun;
    const before = window.__deltaRecoveryWait.before204;
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
    sceneReads: window.__deltaRecoveryWait.sceneReads,
    deltaAborts: window.__deltaRecoveryWait.deltaAborts,
  }))).toEqual({ sceneReads: { a: 2, b: 0 }, deltaAborts: { a: 0, b: 0 } });
  await page.evaluate(() => window.__deltaRecoveryWaitRun.effects.dispose());
});

for (const boundary of ["floor", "entry", "dispose"]) {
  test(`@safety a ${boundary} change cancels a recovery waiting on its replacement delta`, async ({ page }) => {
    const anchor = new Date("2026-09-30T12:00:00Z");
    await page.clock.install({ time: anchor });
    await page.clock.pauseAt(anchor);
    await loadRecoveryHarness(page);
    await startRecovery(page);
    const before = await page.evaluate(() => ({
      sceneReads: { ...window.__deltaRecoveryWait.sceneReads },
      deltaReads: { ...window.__deltaRecoveryWait.deltaReads },
      catalogReads: window.__deltaRecoveryWait.catalogReads,
    }));

    if (boundary === "floor") {
      await page.evaluate(() => window.__deltaRecoveryWaitRun.effects.selectFloor("saved-1"));
      await expect.poll(() => page.evaluate(() => window.__deltaRecoveryWaitRun.store.value.dataMode)).toBe("history");
    } else if (boundary === "entry") {
      await page.evaluate(() => {
        const run = window.__deltaRecoveryWaitRun;
        window.__deltaRecoveryWait.selectedId = run.entryB.entryId;
        run.effects.sync({
          ...run.projection,
          entryKey: run.entryB.entryId,
          vacuumEntityId: "vacuum.synthetic_b",
          activity: "docked",
        });
      });
      await expect.poll(() => page.evaluate(() => window.__deltaRecoveryWaitRun.store.value.selection.entryId))
        .toBe("synthetic-entry-b");
    } else {
      await page.evaluate(() => window.__deltaRecoveryWaitRun.effects.dispose());
    }

    await page.clock.fastForward(6_000);
    const after = await page.evaluate(() => ({
      sceneReads: window.__deltaRecoveryWait.sceneReads,
      deltaReads: window.__deltaRecoveryWait.deltaReads,
      deltaAborts: window.__deltaRecoveryWait.deltaAborts,
      catalogReads: window.__deltaRecoveryWait.catalogReads,
    }));
    expect(after.sceneReads.a).toBe(before.sceneReads.a);
    expect(after.deltaReads.a).toBe(before.deltaReads.a);
    expect(after.deltaAborts.a).toBe(1);
    if (boundary === "dispose") expect(after.catalogReads).toBe(before.catalogReads);
    if (boundary === "entry") {
      expect(after.sceneReads.b).toBeGreaterThan(0);
      expect(after.deltaReads.b).toBeGreaterThan(0);
    }
    await page.evaluate(() => window.__deltaRecoveryWaitRun.effects.dispose());
  });
}

test("@safety a pose mismatch during replacement delta recovery releases the waiter for one cooldown retry", async ({ page }) => {
  const anchor = new Date("2026-09-30T12:00:00Z");
  await page.clock.install({ time: anchor });
  await page.clock.pauseAt(anchor);
  await loadRecoveryHarness(page);
  await startRecovery(page);

  const poseReadsBeforeMismatch = await page.evaluate(() => window.__deltaRecoveryWait.poseReads);
  await page.evaluate(() => {
    const run = window.__deltaRecoveryWaitRun;
    window.__deltaRecoveryWait.mismatchNextPose = true;
    void run.effects.refreshPose();
  });
  await expect.poll(() => page.evaluate(() => window.__deltaRecoveryWait.deltaAborts.a)).toBe(1);
  const invalidated = await page.evaluate(() => ({
    sceneReads: { ...window.__deltaRecoveryWait.sceneReads },
    deltaReads: { ...window.__deltaRecoveryWait.deltaReads },
    poseReads: window.__deltaRecoveryWait.poseReads,
  }));
  expect(invalidated.sceneReads.a).toBe(2);
  expect(invalidated.deltaReads.a).toBe(2);
  expect(invalidated.poseReads).toBe(poseReadsBeforeMismatch + 1);
  await expect.poll(() => page.evaluate(() => window.__deltaRecoveryWait.cooldownTimers)).toBe(1);

  await page.clock.fastForward(5_000);
  await expect.poll(() => page.evaluate(() => window.__deltaRecoveryWait.deltaReads.a)).toBe(3);
  const retried = await page.evaluate(() => ({
    sceneReads: { ...window.__deltaRecoveryWait.sceneReads },
    deltaReads: { ...window.__deltaRecoveryWait.deltaReads },
    deltaAborts: { ...window.__deltaRecoveryWait.deltaAborts },
    poseReads: window.__deltaRecoveryWait.poseReads,
    cooldownTimers: window.__deltaRecoveryWait.cooldownTimers,
    releaseAvailable: typeof window.__deltaRecoveryWait.releaseA === "function",
  }));
  expect(retried.sceneReads.a).toBe(3);
  expect(retried.poseReads).toBe(invalidated.poseReads + 1);
  expect(retried.deltaAborts.a).toBe(1);
  expect(retried.cooldownTimers).toBe(1);
  expect(retried.releaseAvailable).toBe(true);

  await page.clock.fastForward(6_000);
  expect(await page.evaluate(() => ({
    sceneReads: window.__deltaRecoveryWait.sceneReads,
    deltaReads: window.__deltaRecoveryWait.deltaReads,
    deltaAborts: window.__deltaRecoveryWait.deltaAborts,
  }))).toEqual({
    sceneReads: { a: 3, b: 0 },
    deltaReads: { a: 3, b: 0 },
    deltaAborts: { a: 1, b: 0 },
  });
  await page.evaluate(() => {
    const probe = window.__deltaRecoveryWait;
    const run = window.__deltaRecoveryWaitRun;
    probe.releaseA();
    run.effects.dispose();
  });
});

test("@safety terminal recovery reads and a failed replacement delta release the waiter for one cooldown retry", async ({ page }) => {
  const anchor = new Date("2026-09-30T12:00:00Z");
  await page.clock.install({ time: anchor });
  await page.clock.pauseAt(anchor);
  await loadRecoveryHarness(page);
  const outcomes = [];
  for (const failure of ["catalog", "scene", "delta"]) {
    await startRecovery(page, failure);
    await page.clock.fastForward(5_000);
    await expect.poll(() => page.evaluate(() => window.__deltaRecoveryWait.releaseA !== null)).toBe(true);
    const retried = await page.evaluate(() => ({
      sceneReads: { ...window.__deltaRecoveryWait.sceneReads },
      deltaReads: { ...window.__deltaRecoveryWait.deltaReads },
      catalogReads: window.__deltaRecoveryWait.catalogReads,
      cooldownTimers: window.__deltaRecoveryWait.cooldownTimers,
      releaseAvailable: typeof window.__deltaRecoveryWait.releaseA === "function",
    }));
    expect(retried.releaseAvailable).toBe(true);
    expect(retried.cooldownTimers).toBe(1);
    if (failure === "catalog") {
      expect(retried.catalogReads).toBeGreaterThanOrEqual(3);
      expect(retried.sceneReads.a).toBe(2);
      expect(retried.deltaReads.a).toBe(2);
    } else if (failure === "scene") {
      expect(retried.sceneReads.a).toBe(3);
      expect(retried.deltaReads.a).toBe(2);
    } else {
      expect(retried.sceneReads.a).toBe(3);
      expect(retried.deltaReads.a).toBe(3);
    }
    await page.evaluate(() => window.__deltaRecoveryWait.releaseA());
    await page.clock.fastForward(100);
    await page.clock.fastForward(6_000);
    outcomes.push(await page.evaluate(() => ({
      sceneReads: { ...window.__deltaRecoveryWait.sceneReads },
      deltaAborts: { ...window.__deltaRecoveryWait.deltaAborts },
    })));
    await page.evaluate(() => window.__deltaRecoveryWaitRun.effects.dispose());
  }
  expect(outcomes).toEqual([
    { sceneReads: { a: 2, b: 0 }, deltaAborts: { a: 0, b: 0 } },
    { sceneReads: { a: 3, b: 0 }, deltaAborts: { a: 0, b: 0 } },
    { sceneReads: { a: 3, b: 0 }, deltaAborts: { a: 0, b: 0 } },
  ]);
});
