import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export { EffectController } from "./frontend/map-studio-v4/effects";
      export { MaticBackend } from "./frontend/map-studio-v4/backend";
      export { WorkspaceStore } from "./frontend/map-studio-v4/state";
      export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";`,
    resolveDir: process.cwd(),
  },
  bundle: true, format: "esm", write: false,
});

async function load(page, { status = 409, conflict = "map-rechecking", failures = 1 } = {}) {
  await page.route("**/area-recovery-test.js", route => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  // Catalog recovery is driven explicitly below, without racing the 5s poll.
  await page.clock.pauseAt(new Date());
  await page.evaluate(async ({ status, conflict, failures }) => {
    const m = await import("/area-recovery-test.js");
    const initial = m.createGalleryState("ready");
    const entry = { ...initial.resources.entry, deltaUrl: null };
    const store = new m.WorkspaceStore();
    store.replace({
      ...initial,
      resources: { ...initial.resources,
        scene: { status: "idle", value: null, problem: null },
        areas: { status: "idle", value: null, problem: null },
      },
      map: { ...initial.map, available: false },
    });
    let releaseScene;
    const sceneReady = new Promise(resolve => { releaseScene = resolve; });
    const harness = { store, entry, calls: 0, failures, status, conflict, rechecking: false };
    const wire = new m.MaticBackend(() => ({
      fetchWithAuth: async () => {
        harness.calls += 1;
        const held = harness.holdNext;
        if (held) {
          harness.holdNext = false;
          // Deliberately ignore AbortSignal, like a host fetch wrapper can.
          await new Promise(resolve => { harness.releaseArea = resolve; });
        }
        if (harness.failures !== 0) {
          if (harness.failures > 0) harness.failures -= 1;
          return new Response("{}", { status: harness.status,
            headers: { "X-Matic-Areas-Conflict": harness.conflict },
          });
        }
        return new Response(JSON.stringify({ scene_url: held ? "/api/matic_robot/slam_scene/old" : entry.sceneUrl,
          rooms: [], areas: [], selected_area: null,
        }), { headers: { "Content-Type": "application/json" } });
      },
    }));
    const backend = {
      dispose: () => wire.dispose(),
      catalog: async () => [{ ...entry,
        mapFloorCoherent: !harness.rechecking, mapSessionVerified: !harness.rechecking,
      }],
      scene: async () => { await sceneReady; return {
        revision: entry.mapRevision, floorCoherent: true, scene: initial.resources.scene.value,
      }; },
      history: async () => initial.resources.history.value,
      pose: async () => initial.resources.pose.value,
      plans: async () => initial.resources.plans.value,
      areas: async (...args) => {
        if (harness.ignoreAbort && harness.holdNext) {
          harness.calls += 1;
          harness.holdNext = false;
          await new Promise(resolve => { harness.releaseArea = resolve; });
          return { sceneUrl: "/api/matic_robot/slam_scene/old", rooms: [], areas: [] };
        }
        return wire.areas(...args);
      },
    };
    const effects = new m.EffectController(store, backend);
    // Keep one shared mutable object for the synthetic endpoint and assertions.
    Object.assign(harness, { effects });
    window.__areaRecovery = harness;
    effects.sync({ userKey: "synthetic-user", entryKey: entry.entryId,
      host: initial.host, activity: initial.activity, batteryPercent: initial.batteryPercent,
      robotLabel: initial.robotLabel, robots: initial.robots, language: "en",
    }, undefined);
    await effects.refreshCatalog(true);
    await effects.openWorkflow("areas");
    releaseScene();
  }, { status, conflict, failures });
  await expect.poll(() => page.evaluate(() =>
    window.__areaRecovery.store.value.resources.areas.status)).toBe("error");
  expect(await page.evaluate(() => window.__areaRecovery.calls)).toBe(1);
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__areaRecovery?.effects.dispose());
});

test("saved areas recover after a map-rechecking conflict without Try again @safety", async ({ page }) => {
  await load(page);
  expect(await page.evaluate(() =>
    window.__areaRecovery.store.value.resources.areas.problem)).toBe("map-rechecking");
  await page.evaluate(() => window.__areaRecovery.effects.refreshCatalog());
  await expect.poll(() => page.evaluate(() =>
    window.__areaRecovery.store.value.resources.areas.status)).toBe("ready");
  expect(await page.evaluate(() => window.__areaRecovery.calls)).toBe(2);
  await page.evaluate(() => window.__areaRecovery.effects.refreshCatalog());
  expect(await page.evaluate(() => window.__areaRecovery.calls)).toBe(2);
});

test("persistent area revalidation retries once per recovery episode @safety", async ({ page }) => {
  await load(page, { failures: -1 });
  for (let i = 0; i < 4; i += 1) {
    await page.evaluate(() => window.__areaRecovery.effects.refreshCatalog());
    await expect.poll(() => page.evaluate(() =>
      window.__areaRecovery.store.value.resources.areas.status)).toBe("error");
  }
  expect(await page.evaluate(() => window.__areaRecovery.calls)).toBe(2);
  // A real loss and recovery permits one fresh attempt in the same floor.
  await page.evaluate(async () => {
    const h = window.__areaRecovery;
    h.rechecking = true;
    await h.effects.refreshCatalog();
    h.rechecking = false;
    h.failures = 0;
    await h.effects.refreshCatalog();
  });
  await expect.poll(() => page.evaluate(() =>
    window.__areaRecovery.store.value.resources.areas.status)).toBe("ready");
  expect(await page.evaluate(() => window.__areaRecovery.calls)).toBe(3);
});

for (const ignoreAbort of [false, true]) {
  test(`a late area ${ignoreAbort ? "adapter" : "fetch"} cannot replace the recovered catalog @safety`, async ({ page }) => {
    await load(page);
    await page.evaluate(async (ignoreAbort) => {
      const h = window.__areaRecovery;
      h.ignoreAbort = ignoreAbort;
      h.holdNext = true;
      await h.effects.refreshCatalog();
    }, ignoreAbort);
    await expect.poll(() => page.evaluate(() => window.__areaRecovery.calls)).toBe(2);
    await page.evaluate(async () => {
      const h = window.__areaRecovery;
      h.rechecking = true;
      await h.effects.refreshCatalog();
    });
    await expect.poll(() => page.evaluate(() =>
      window.__areaRecovery.store.value.resources.areas.status)).toBe("idle");
    await page.evaluate(async () => {
      const h = window.__areaRecovery;
      h.rechecking = false;
      await h.effects.refreshCatalog();
    });
    await expect.poll(() => page.evaluate(() =>
      window.__areaRecovery.store.value.resources.areas.status)).toBe("ready");
    await page.evaluate(() => window.__areaRecovery.releaseArea());
    await page.clock.runFor(1);
    expect(await page.evaluate(() => window.__areaRecovery.calls)).toBe(3);
    expect(await page.evaluate(() =>
      window.__areaRecovery.store.value.resources.areas.status)).toBe("ready");
  });
}

for (const [status, conflict] of [[409, "no-rooms"], [503, "map-rechecking"]]) {
  test(`area ${status}/${conflict} stays an explicit error @safety`, async ({ page }) => {
    await load(page, { status, conflict });
    await page.evaluate(async () => {
      await window.__areaRecovery.effects.refreshCatalog();
      await window.__areaRecovery.effects.refreshCatalog();
    });
    expect(await page.evaluate(() => window.__areaRecovery.calls)).toBe(1);
    expect(await page.evaluate(() =>
      window.__areaRecovery.store.value.resources.areas.status)).toBe("error");
  });
}
