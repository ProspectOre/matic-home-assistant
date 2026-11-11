import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadPoseOrderingHarness(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "iife",
    globalName: "__poseOrderingModules",
    write: false,
  });
  await page.route("**/pose-ordering.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: "/pose-ordering.js" });
}

for (const scenario of [
  { name: "stale incoherent", sceneRevisionOffset: 0, sceneEpoch: "synthetic-scene-epoch", floorCoherent: false, mapSessionKey: null, invalidates: false },
  { name: "stale coherent", sceneRevisionOffset: 0, sceneEpoch: "synthetic-scene-epoch", floorCoherent: true, mapSessionKey: "b".repeat(64), invalidates: false },
  { name: "current incoherent with lower raw revision", rawRevision: 0, sceneRevisionOffset: 1, sceneEpoch: "synthetic-scene-epoch", floorCoherent: false, mapSessionKey: null, invalidates: true },
  { name: "older revision from another epoch", sceneRevisionOffset: 0, sceneEpoch: "previous-epoch", floorCoherent: false, mapSessionKey: null, invalidates: true },
  { name: "incoherent response without scene provenance", sceneRevisionOffset: null, sceneEpoch: null, floorCoherent: false, mapSessionKey: null, invalidates: true },
]) {
test(`${scenario.name} pose response is ordered against the admitted map revision`, async ({ page }) => {
  await loadPoseOrderingHarness(page);
  const result = await page.evaluate(async (scenario) => {
    const { EffectController, WorkspaceStore, createGalleryState } = window.__poseOrderingModules;
    const initial = createGalleryState("ready");
    const startRevision = initial.resources.entry.mapRevision;
    const entry = {
      ...initial.resources.entry,
      mapRevision: startRevision,
      mapSessionKey: "b".repeat(64),
      deltaUrl: "/pose-ordering-delta",
    };
    const store = new WorkspaceStore(initial);
    let releasePose;
    let admitDelta;
    let deltaRead = 0;
    const effects = new EffectController(store, {
      catalog: async () => [entry],
      scene: async () => ({ revision: startRevision, floorCoherent: true, scene: initial.resources.scene.value }),
      pose: async () => new Promise(resolve => { releasePose = () => resolve({
        ...initial.resources.pose.value,
        revision: scenario.rawRevision ?? startRevision,
        sceneRevision: scenario.sceneRevisionOffset === null
          ? null : startRevision + scenario.sceneRevisionOffset,
        sceneEpoch: scenario.sceneEpoch,
        floorCoherent: scenario.floorCoherent,
        mapSessionKey: scenario.mapSessionKey,
      }); }),
      sceneDelta: async () => {
        deltaRead += 1;
        if (deltaRead === 1) return new Promise(resolve => {
          admitDelta = () => resolve({ revision: startRevision + 1, floorCoherent: true,
            scene: { ...initial.resources.scene.value, advanced: true } });
        });
        return new Promise(() => {});
      },
      history: async () => initial.resources.history.value,
      plans: async () => initial.resources.plans.value,
      areas: async () => initial.resources.areas.value,
      dispose() {},
    });
    effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92,
      robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "pose-ordering",
      entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
    try {
      await effects.refreshCatalog(true);
      for (let i = 0; i < 100 && (!releasePose || !admitDelta); i++) await new Promise(resolve => setTimeout(resolve, 0));
      if (!releasePose || !admitDelta) throw new Error("pose or delta request did not start");
      admitDelta();
      for (let i = 0; i < 100 && store.value.resources.entry.mapRevision !== startRevision + 1; i++) await new Promise(resolve => setTimeout(resolve, 0));
      const admittedGeneration = store.value.generation;
      releasePose();
      for (let i = 0; i < 100 && store.value.generation === admittedGeneration; i++) await new Promise(resolve => setTimeout(resolve, 0));
      return {
        admittedRevision: store.value.resources.entry.mapRevision,
        coherence: store.value.coherence,
        readOnly: store.value.floor.readOnly,
        exactPose: store.value.map.exactPose,
        generation: store.value.generation,
        admittedGeneration,
      };
    } finally { effects.dispose(); }
  }, scenario);
  expect(result.admittedRevision).toBeGreaterThan(0);
  expect(result.generation !== result.admittedGeneration).toBe(scenario.invalidates);
  expect(result.readOnly).toBe(scenario.invalidates);
  if (scenario.floorCoherent) expect(result.exactPose).toBe(true);
});
}
