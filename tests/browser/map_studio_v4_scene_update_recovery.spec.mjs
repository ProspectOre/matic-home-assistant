import { expect, test } from "@playwright/test";
import { build } from "esbuild";

// A live manifest scene is updated when the workspace socket or the catalog
// poll announces a newer revision. These tests pin how a failed update read
// recovers, what cancels it, and how a panel without a socket catches up.

async function loadUpdateHarness(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state"; export { workspacePoseConnection } from "./tests/browser/workspace_pose_connection.mjs";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "iife",
    globalName: "__sceneUpdateModules",
    write: false,
  });
  await page.route("**/scene-update-recovery.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  const anchor = new Date("2026-09-30T12:00:00Z");
  await page.clock.install({ time: anchor });
  await page.clock.pauseAt(anchor);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: "/scene-update-recovery.js" });
}

// Opens robot A's live scene, then announces revision 8 on the socket. The
// first update read fails once; recovery reloads the scene and reads revision
// 8 again, which stays pending until `releaseUpdate`. `failure` adds one more
// failure: of the recovery's catalog read, its scene read, the second update
// read, or (`queued-catalog`) holds the first update read and the next poll.
async function startUpdate(page, failure = null, { socket = true } = {}) {
  await page.evaluate(({ failure, socket }) => {
    const { EffectController, WorkspaceStore, createGalleryState, workspacePoseConnection } = window.__sceneUpdateModules;
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
    const probe = window.__sceneUpdate = {
      selectedId: entryA.entryId,
      catalogRevision: entryA.mapRevision,
      sceneRevision: entryA.mapRevision,
      sceneReads: { a: 0, b: 0 },
      updateReads: { a: 0, b: 0 },
      updateAborts: { a: 0, b: 0 },
      catalogReads: 0,
      cooldownTimers: 0,
      sceneFailuresRemaining: failure === "scene" ? 1 : 0,
      catalogFailuresRemaining: failure === "catalog" ? 1 : 0,
      updateFailuresRemaining: failure === "update" ? 2 : 1,
      updateRevision: 8,
      releaseUpdate: null,
      failInitialUpdate: null,
      catalogPending: false,
    };
    const setTimeoutBase = window.__sceneUpdateSetTimeoutBase
      ?? (window.__sceneUpdateSetTimeoutBase = window.setTimeout.bind(window));
    window.setTimeout = (callback, delay, ...args) => {
      // Count only the spatial read recovery cooldown. A live pose also arms a
      // freshness expiry that can share the 5 s delay but is not a retry.
      if (typeof callback === "function" && String(callback).includes("retryTimer = null")) {
        window.__sceneUpdate.cooldownTimers += 1;
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
    const liveScene = (revision) => ({ ...initial.resources.scene.value, manifest: new ArrayBuffer(1), revision });
    const aborted = (key, signal, reject) => signal.addEventListener("abort", () => {
      probe.updateAborts[key] += 1;
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
    const updateScene = async (url, signal) => {
      const key = url === entryA.sceneUrl ? "a" : "b";
      probe.updateReads[key] += 1;
      if (key === "a" && probe.updateReads.a === 1 && failure === "queued-catalog") {
        await new Promise((_resolve, reject) => {
          probe.failInitialUpdate = () => reject(new Error("synthetic update failure"));
        });
      }
      if (key === "a" && probe.updateFailuresRemaining > 0) {
        probe.updateFailuresRemaining -= 1;
        throw new Error("synthetic update failure");
      }
      return new Promise((resolve, reject) => {
        const revision = probe.updateRevision;
        probe.releaseUpdate = () => resolve({ scene: liveScene(revision), revision, floorCoherent: true });
        aborted(key, signal, reject);
      });
    };
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
        return [probe.selectedId === entryA.entryId
          ? { ...entryA, mapRevision: probe.catalogRevision, sceneRevision: probe.sceneRevision } : entryB];
      },
      scene: async (url, revision, _floorCoherent, _source, signal, options = {}) => {
        if (options.latest) return updateScene(url, signal);
        const key = url === entryA.sceneUrl ? "a" : "b";
        probe.sceneReads[key] += 1;
        if (key === "a" && probe.sceneReads.a > 1 && probe.sceneFailuresRemaining > 0) {
          probe.sceneFailuresRemaining -= 1;
          throw new Error("synthetic terminal scene failure");
        }
        return { scene: liveScene(revision), revision, floorCoherent: true };
      },
      history: async () => savedHistory,
      plans: async () => initial.resources.plans.value,
      areas: async () => initial.resources.areas.value,
      dispose() {},
    };
    const effects = new EffectController(store, backend, socket ? connection : null, socket);
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
      userKey: "scene-update-test",
      entryKey: entryA.entryId,
      vacuumEntityId: "vacuum.synthetic",
    };
    effects.sync(projection);
    void effects.refreshCatalog(true);
    window.__sceneUpdateRun = { effects, store, projection, entryA, entryB, connection,
      position: initial.resources.pose.value.position };
  }, { failure, socket });
  if (!socket) return;
  // The workspace subscription opens once the map is drawn.
  await page.clock.runFor(100);
  await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.connection.subscribed())).toBe(true);
  await page.evaluate(() => window.__sceneUpdateRun.connection.invalidate({ scene: 8 }));
  if (failure === "queued-catalog") {
    await expect.poll(() => page.evaluate(() => typeof window.__sceneUpdate.failInitialUpdate)).toBe("function");
    return;
  }
  if (failure === "catalog") {
    await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.resources.catalog.status))
      .toBe("error");
  } else if (failure === "scene") {
    await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.resources.scene.status))
      .toBe("error");
  } else if (failure === "update") {
    await expect.poll(() => page.evaluate(() => window.__sceneUpdate.updateReads.a)).toBe(2);
  } else {
    await expect.poll(() => page.evaluate(() => typeof window.__sceneUpdate.releaseUpdate)).toBe("function");
  }
  if (failure !== null) {
    await expect.poll(() => page.evaluate(() => window.__sceneUpdate.cooldownTimers)).toBe(1);
  }
}

const reads = (page) => page.evaluate(() => ({
  sceneReads: { ...window.__sceneUpdate.sceneReads },
  updateReads: { ...window.__sceneUpdate.updateReads },
  updateAborts: { ...window.__sceneUpdate.updateAborts },
  catalogReads: window.__sceneUpdate.catalogReads,
}));

test("@safety a failed update read recovers with one scene reload, then reads the announced revision again", async ({ page }) => {
  await loadUpdateHarness(page);
  await startUpdate(page);

  const before = await page.evaluate(() => {
    const state = window.__sceneUpdateRun.store.value;
    window.__sceneUpdate.before = { scene: state.resources.scene.value, pose: state.resources.pose.value,
      generation: state.generation };
    return { revision: state.resources.entry.mapRevision, exactPose: state.map.exactPose,
      readOnly: state.floor.readOnly, coherence: state.coherence };
  });
  expect(before).toEqual({ revision: 7, exactPose: true, readOnly: false, coherence: "current" });
  expect(await reads(page)).toMatchObject({ sceneReads: { a: 2, b: 0 }, updateReads: { a: 2, b: 0 } });

  // The pending read is the recovery's replacement: no retry aborts it.
  await page.clock.fastForward(6_000);
  expect(await reads(page)).toMatchObject({
    sceneReads: { a: 2, b: 0 }, updateReads: { a: 2, b: 0 }, updateAborts: { a: 0, b: 0 },
  });
  expect(await page.evaluate(() => window.__sceneUpdate.cooldownTimers)).toBe(0);

  await page.evaluate(() => window.__sceneUpdate.releaseUpdate());
  await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.resources.entry.mapRevision)).toBe(8);
  expect(await page.evaluate(() => {
    const state = window.__sceneUpdateRun.store.value;
    const before = window.__sceneUpdate.before;
    return { sceneRevision: state.resources.scene.value.revision, samePose: state.resources.pose.value === before.pose,
      sameGeneration: state.generation === before.generation, exactPose: state.map.exactPose,
      readOnly: state.floor.readOnly, coherence: state.coherence };
  })).toEqual({ sceneRevision: 8, samePose: true, sameGeneration: true, exactPose: true,
    readOnly: false, coherence: "current" });
  await page.clock.fastForward(6_000);
  expect(await reads(page)).toMatchObject({ sceneReads: { a: 2, b: 0 }, updateReads: { a: 2, b: 0 } });
  await page.evaluate(() => window.__sceneUpdateRun.effects.dispose());
});

for (const boundary of ["floor", "entry", "dispose"]) {
  test(`@safety a ${boundary} change cancels a pending update read`, async ({ page }) => {
    await loadUpdateHarness(page);
    await startUpdate(page);
    const before = await reads(page);

    if (boundary === "floor") {
      await page.evaluate(() => window.__sceneUpdateRun.effects.openWorkflow("history"));
      await page.evaluate(() => window.__sceneUpdateRun.effects.selectFloor("saved-1"));
      await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.dataMode)).toBe("history");
    } else if (boundary === "entry") {
      await page.evaluate(() => {
        const run = window.__sceneUpdateRun;
        window.__sceneUpdate.selectedId = run.entryB.entryId;
        run.connection.revisions = {};
        run.effects.sync({
          ...run.projection,
          entryKey: run.entryB.entryId,
          vacuumEntityId: "vacuum.synthetic_b",
          activity: "docked",
        });
      });
      await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.selection.entryId))
        .toBe("synthetic-entry-b");
    } else {
      await page.evaluate(() => window.__sceneUpdateRun.effects.dispose());
    }

    await page.clock.fastForward(6_000);
    const after = await reads(page);
    expect(after.sceneReads.a).toBe(before.sceneReads.a);
    expect(after.updateReads.a).toBe(before.updateReads.a);
    expect(after.updateAborts.a).toBe(1);
    if (boundary === "dispose") expect(after.catalogReads).toBe(before.catalogReads);
    if (boundary === "entry") {
      expect(after.sceneReads.b).toBeGreaterThan(0);
      // Robot B's scene has no announced revision to read.
      expect(after.updateReads.b).toBe(0);
    }
    await page.evaluate(() => window.__sceneUpdateRun.effects.dispose());
  });
}

test("@safety a pose mismatch during a pending update read releases it for one cooldown retry", async ({ page }) => {
  await loadUpdateHarness(page);
  await startUpdate(page);
  const pushPose = (sessionKey) => page.evaluate((key) => {
    const { connection, position } = window.__sceneUpdateRun;
    connection.push({ position, map_session_key: key });
  }, sessionKey);
  await pushPose("c".repeat(64));
  await expect.poll(() => page.evaluate(() => window.__sceneUpdate.updateAborts.a)).toBe(1);
  expect(await reads(page)).toMatchObject({ sceneReads: { a: 2, b: 0 }, updateReads: { a: 2, b: 0 } });
  await expect.poll(() => page.evaluate(() => window.__sceneUpdate.cooldownTimers)).toBe(1);

  // The robot's next position is on the admitted map again; the retry admits a
  // new frame, whose scene is read once.
  await pushPose(await page.evaluate(() => window.__sceneUpdateRun.entryA.mapSessionKey));
  await page.clock.fastForward(5_000);
  await expect.poll(() => page.evaluate(() => window.__sceneUpdate.sceneReads.a)).toBe(3);
  await page.clock.fastForward(6_000);
  expect(await reads(page)).toMatchObject({
    sceneReads: { a: 3, b: 0 }, updateReads: { a: 2, b: 0 }, updateAborts: { a: 1, b: 0 },
  });
  await pushPose(await page.evaluate(() => window.__sceneUpdateRun.entryA.mapSessionKey));
  expect(await page.evaluate(() => {
    const state = window.__sceneUpdateRun.store.value;
    return { exactPose: state.map.exactPose, readOnly: state.floor.readOnly, cooldownTimers: window.__sceneUpdate.cooldownTimers };
  })).toEqual({ exactPose: true, readOnly: false, cooldownTimers: 1 });
  await page.evaluate(() => window.__sceneUpdateRun.effects.dispose());
});

test("@safety terminal recovery reads and a second failed update read keep one cooldown retry", async ({ page }) => {
  await loadUpdateHarness(page);
  const outcomes = {};
  for (const failure of ["catalog", "scene", "update"]) {
    await startUpdate(page, failure);
    await page.clock.fastForward(5_000);
    await expect.poll(() => page.evaluate(() => typeof window.__sceneUpdate.releaseUpdate)).toBe("function");
    const retried = { ...await reads(page), cooldownTimers: await page.evaluate(() => window.__sceneUpdate.cooldownTimers) };
    await page.evaluate(() => window.__sceneUpdate.releaseUpdate());
    await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.resources.entry.mapRevision)).toBe(8);
    await page.clock.fastForward(6_000);
    outcomes[failure] = { retried, settled: await reads(page) };
    await page.evaluate(() => window.__sceneUpdateRun.effects.dispose());
  }
  expect(outcomes.catalog.retried.catalogReads).toBeGreaterThanOrEqual(3);
  expect(outcomes.catalog.retried).toMatchObject({ sceneReads: { a: 2 }, updateReads: { a: 2 }, cooldownTimers: 1 });
  expect(outcomes.scene.retried).toMatchObject({ sceneReads: { a: 3 }, updateReads: { a: 2 }, cooldownTimers: 1 });
  expect(outcomes.update.retried).toMatchObject({ sceneReads: { a: 3 }, updateReads: { a: 3 }, cooldownTimers: 1 });
  for (const { retried, settled } of Object.values(outcomes)) {
    expect(settled.sceneReads).toEqual(retried.sceneReads);
    expect(settled.updateReads).toEqual(retried.updateReads);
    expect(settled.updateAborts).toEqual({ a: 0, b: 0 });
  }
});

test("@safety announcements during the recovery cooldown wait for it, then the newest one is read", async ({ page }) => {
  await loadUpdateHarness(page);
  await startUpdate(page, "update");
  const cooling = await reads(page);
  await page.evaluate(() => {
    window.__sceneUpdate.updateRevision = 10;
    for (const scene of [9, 10]) window.__sceneUpdateRun.connection.invalidate({ scene });
  });
  await page.clock.runFor(1_000);
  expect(await reads(page)).toEqual(cooling);
  await page.clock.fastForward(5_000);
  await expect.poll(() => page.evaluate(() => typeof window.__sceneUpdate.releaseUpdate)).toBe("function");
  expect(await reads(page)).toMatchObject({ sceneReads: { a: cooling.sceneReads.a + 1 },
    updateReads: { a: cooling.updateReads.a + 1 } });
  await page.evaluate(() => window.__sceneUpdate.releaseUpdate());
  await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.resources.entry.mapRevision)).toBe(10);
  await page.evaluate(() => window.__sceneUpdateRun.effects.dispose());
});

test("@safety a queued update recovery preserves the verified generation while superseding a catalog poll", async ({ page }) => {
  await loadUpdateHarness(page);
  await startUpdate(page, "queued-catalog");
  const generation = await page.evaluate(() => window.__sceneUpdateRun.store.value.generation);
  await page.evaluate(() => { void window.__sceneUpdateRun.effects.refreshCatalog(); });
  await expect.poll(() => page.evaluate(() => window.__sceneUpdate.catalogPending)).toBe(true);
  await page.evaluate(() => window.__sceneUpdate.failInitialUpdate());
  await expect.poll(() => page.evaluate(() => window.__sceneUpdate.updateReads.a)).toBe(2);
  expect(await page.evaluate(() => {
    const state = window.__sceneUpdateRun.store.value;
    return { generation: state.generation, exactPose: state.map.exactPose,
      floorReadOnly: state.floor.readOnly, sceneStatus: state.resources.scene.status };
  })).toEqual({ generation, exactPose: true, floorReadOnly: false, sceneStatus: "ready" });
  await page.evaluate(() => window.__sceneUpdateRun.effects.dispose());
});

test("@safety without a socket the catalog's scene revision updates a map its cached revision lags", async ({ page }) => {
  await loadUpdateHarness(page);
  await startUpdate(page, null, { socket: false });
  await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.resources.scene.status)).toBe("ready");
  // The server advertises its cached scene, revision 7, until revision 8 is
  // built, and only a manifest read starts that build.
  await page.evaluate(() => Object.assign(window.__sceneUpdate, { sceneRevision: 8, updateFailuresRemaining: 0 }));
  await page.clock.fastForward(5_000);
  await expect.poll(() => page.evaluate(() => typeof window.__sceneUpdate.releaseUpdate)).toBe("function");
  await page.evaluate(() => window.__sceneUpdate.releaseUpdate());
  await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.resources.entry.mapRevision)).toBe(8);
  expect(await reads(page)).toMatchObject({ sceneReads: { a: 1, b: 0 }, updateReads: { a: 1, b: 0 } });
  expect(await page.evaluate(() => window.__sceneUpdate.catalogRevision)).toBe(7);
  await page.evaluate(() => window.__sceneUpdateRun.effects.dispose());
});

test("@safety without a socket the catalog poll updates the map; a resubscribe snapshot reads what moved meanwhile", async ({ page }) => {
  await loadUpdateHarness(page);
  await startUpdate(page, null, { socket: false });
  await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.resources.scene.status)).toBe("ready");
  const generation = await page.evaluate(() => window.__sceneUpdateRun.store.value.generation);
  // The catalog shows revision 8: the next poll reads it as an update, not a reload.
  await page.evaluate(() => Object.assign(window.__sceneUpdate, { catalogRevision: 8, sceneRevision: 8, updateFailuresRemaining: 0 }));
  await page.clock.fastForward(5_000);
  await expect.poll(() => page.evaluate(() => typeof window.__sceneUpdate.releaseUpdate)).toBe("function");
  expect(await page.evaluate(() => window.__sceneUpdateRun.store.value.resources.entry.mapRevision)).toBe(7);
  await page.evaluate(() => window.__sceneUpdate.releaseUpdate());
  await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.resources.entry.mapRevision)).toBe(8);
  expect(await reads(page)).toMatchObject({ sceneReads: { a: 1, b: 0 }, updateReads: { a: 1, b: 0 } });
  expect(await page.evaluate(() => window.__sceneUpdateRun.store.value.generation)).toBe(generation);
  // A new floor is a new frame: it reloads the scene in a new generation.
  await page.evaluate(async () => {
    const { entryA } = window.__sceneUpdateRun;
    entryA.selectedFloorOrdinal = 2;
    entryA.mapFloorOrdinal = 2;
    await window.__sceneUpdateRun.effects.refreshCatalog(true);
  });
  await expect.poll(async () => (await reads(page)).sceneReads.a).toBe(2);
  expect(await page.evaluate(() => window.__sceneUpdateRun.store.value.generation)).toBeGreaterThan(generation);
  await page.evaluate(() => window.__sceneUpdateRun.effects.dispose());

  // With the socket: Home Assistant's connection drops, which the panel shows
  // as a degraded map, and the map moves to revision 9 meanwhile. Reconnecting
  // reloads the scene from a fresh catalog, and the resubscribe snapshot's
  // scene revision reads revision 9.
  await startUpdate(page, null, { socket: true });
  await page.evaluate(() => window.__sceneUpdate.releaseUpdate());
  await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.store.value.resources.entry.mapRevision)).toBe(8);
  await page.evaluate(() => {
    const { effects, connection, projection } = window.__sceneUpdateRun;
    effects.sync({ ...projection, host: { ...projection.host, connected: false } });
    connection.revisions = { scene: 9 };
    window.__sceneUpdate.updateRevision = 9;
  });
  expect(await page.evaluate(() => {
    const state = window.__sceneUpdateRun.store.value;
    return { coherence: state.coherence, available: state.map.available, subscribed: window.__sceneUpdateRun.connection.subscribed() };
  })).toEqual({ coherence: "degraded", available: true, subscribed: false });
  const beforeReconnect = await reads(page);
  await page.evaluate(() => window.__sceneUpdateRun.effects.sync(window.__sceneUpdateRun.projection));
  await page.clock.runFor(100);
  await expect.poll(() => page.evaluate(() => window.__sceneUpdateRun.connection.subscribed())).toBe(true);
  await expect.poll(async () => (await reads(page)).updateReads.a).toBe(beforeReconnect.updateReads.a + 1);
  expect((await reads(page)).sceneReads.a).toBe(beforeReconnect.sceneReads.a + 1);
  await page.evaluate(() => window.__sceneUpdate.releaseUpdate());
  await expect.poll(() => page.evaluate(() => {
    const state = window.__sceneUpdateRun.store.value;
    return [state.resources.entry.mapRevision, state.coherence];
  })).toEqual([9, "current"]);
  await page.evaluate(() => window.__sceneUpdateRun.effects.dispose());
});
