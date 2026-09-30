import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadEffects(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore, captureCoordinateEdit, hasCoordinateEditAdmission, canEditCoordinates } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/content-revision-test.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

test("same-frame catalog revisions preserve drafts while stale scene stamps and frame changes are fenced @safety", async ({ page }) => {
  await loadEffects(page);
  await page.evaluate(async () => {
    const m = await import("/content-revision-test.js");
    const initial = m.createGalleryState("ready");
    const state = window.__contentRevision = {
      entry: { ...initial.resources.entry, deltaUrl: null },
      sceneCalls: 0,
      sceneSignals: [],
      releaseRevisionEight: null,
      store: new m.WorkspaceStore(initial),
    };
    state.effects = new m.EffectController(state.store, {
      catalog: async () => [state.entry],
      history: async () => initial.resources.history.value,
      scene: async (_url, revision, _floorCoherent, _mode, signal) => {
        const call = ++state.sceneCalls;
        state.sceneSignals.push(signal);
        if (call === 2) {
          return new Promise((resolve) => {
            state.releaseRevisionEight = () => resolve({
              scene: { ...initial.resources.scene.value, revision: 8 },
              revision: 8,
              floorCoherent: true,
            });
          });
        }
        return {
          scene: { ...initial.resources.scene.value, revision },
          revision,
          floorCoherent: true,
        };
      },
      pose: async () => initial.resources.pose.value,
      plans: async () => initial.resources.plans.value,
      areas: async () => initial.resources.areas.value,
      dispose() {},
    });
    state.projection = {
      host: initial.host,
      activity: initial.activity,
      batteryPercent: 92,
      robotLabel: "Synthetic",
      robots: initial.robots,
      language: "en",
      userKey: "content-revision-test",
      entryKey: initial.selection.entryId,
      vacuumEntityId: "vacuum.synthetic",
    };
    state.effects.sync(state.projection);
    await state.effects.refreshCatalog(true);
  });

  await expect.poll(() => page.evaluate(() => {
    const s = window.__contentRevision;
    return s.store.value.resources.scene.status === "ready" && s.sceneCalls >= 1;
  })).toBe(true);

  const duringContentRevision = await page.evaluate(async () => {
    const m = await import("/content-revision-test.js");
    const s = window.__contentRevision;
    const store = s.store;
    store.dispatch({ type: "open-workflow", workflow: "draw" });
    store.dispatch({
      type: "set-camera",
      view: "top",
      camera: { yaw: 0.4, pitch: 1.2, zoom: 1.7, targetX: 2, targetZ: -3 },
    });
    const initialCapture = m.captureCoordinateEdit(store.value, "paint");
    store.dispatch({
      type: "set-draft-circles",
      circles: [{ x: 1, y: 2, radius: 0.3 }],
      coordinateEdit: initialCapture,
    });
    const frameCapture = m.captureCoordinateEdit(store.value, "paint");
    const before = {
      generation: store.value.generation,
      revision: store.value.resources.entry.mapRevision,
      circles: store.value.draw.circles,
      camera: store.value.cameras.top,
      captureAdmitted: m.hasCoordinateEditAdmission(store.value, frameCapture),
    };
    s.entry = { ...s.entry, mapRevision: 8 };
    await s.effects.refreshCatalog();
    return {
      before,
      generation: store.value.generation,
      revision: store.value.resources.entry.mapRevision,
      sceneStatus: store.value.resources.scene.status,
      retainedSceneRevision: store.value.resources.scene.value?.revision,
      circles: store.value.draw.circles,
      camera: store.value.cameras.top,
      captureAdmitted: m.hasCoordinateEditAdmission(store.value, frameCapture),
      canEdit: m.canEditCoordinates(store.value),
      signalAborted: s.sceneSignals[1]?.aborted ?? null,
      releaseAvailable: typeof s.releaseRevisionEight === "function",
    };
  });

  expect(duringContentRevision.before.captureAdmitted).toBe(true);
  expect(duringContentRevision).toMatchObject({
    generation: duringContentRevision.before.generation,
    revision: 8,
    sceneStatus: "loading",
    retainedSceneRevision: duringContentRevision.before.revision,
    circles: [{ x: 1, y: 2, radius: 0.3 }],
    camera: { yaw: 0.4, pitch: 1.2, zoom: 1.7, targetX: 2, targetZ: -3 },
    captureAdmitted: true,
    canEdit: true,
    releaseAvailable: true,
  });

  const staleResult = await page.evaluate(async () => {
    const s = window.__contentRevision;
    // A preserved-generation catalog recovery advances R again while the R=8
    // scene request is held. Its late completion must not replace R=9.
    s.entry = { ...s.entry, mapRevision: 9 };
    await s.effects.refreshCatalog(true, false, true);
    const afterAdvance = {
      generation: s.store.value.generation,
      revision: s.store.value.resources.entry.mapRevision,
      sceneRevision: s.store.value.resources.scene.value?.revision,
      sceneStatus: s.store.value.resources.scene.status,
      oldSignalAborted: s.sceneSignals[1]?.aborted ?? null,
    };
    s.releaseRevisionEight();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return {
      afterAdvance,
      afterStaleCompletion: {
        generation: s.store.value.generation,
        revision: s.store.value.resources.entry.mapRevision,
        sceneRevision: s.store.value.resources.scene.value?.revision,
        sceneStatus: s.store.value.resources.scene.status,
      },
    };
  });

  expect(staleResult.afterAdvance).toMatchObject({
    generation: duringContentRevision.before.generation,
    revision: 9,
    sceneRevision: 9,
    sceneStatus: "ready",
    oldSignalAborted: true,
  });
  expect(staleResult.afterStaleCompletion).toMatchObject({
    generation: duringContentRevision.before.generation,
    revision: 9,
    sceneRevision: 9,
    sceneStatus: "ready",
  });
  await expect.poll(() => page.evaluate(() => {
    const s = window.__contentRevision;
    return s.store.value.resources.scene.status === "ready"
      && s.store.value.resources.scene.value?.revision === 9;
  })).toBe(true);

  const boundary = await page.evaluate(async () => {
    const m = await import("/content-revision-test.js");
    const s = window.__contentRevision;
    const store = s.store;
    const priorGeneration = store.value.generation;
    const priorCapture = m.captureCoordinateEdit(store.value, "paint");
    s.entry = {
      ...s.entry,
      selectedFloorOrdinal: 2,
      mapFloorOrdinal: 2,
      mapSessionKey: "b".repeat(64),
    };
    await s.effects.refreshCatalog(true);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const result = {
      priorGeneration,
      generation: store.value.generation,
      priorCaptureAdmitted: m.hasCoordinateEditAdmission(store.value, priorCapture),
      floorOrdinal: store.value.resources.entry.mapFloorOrdinal,
      draftCircles: store.value.draw.circles,
      camera: store.value.cameras.top,
    };
    s.effects.dispose();
    return result;
  });

  expect(boundary.generation).toBeGreaterThan(boundary.priorGeneration);
  expect(boundary).toMatchObject({
    priorCaptureAdmitted: false,
    floorOrdinal: 2,
    draftCircles: [],
    camera: { yaw: 0.4, pitch: 1.2, zoom: 1.7, targetX: 2, targetZ: -3 },
  });
});
