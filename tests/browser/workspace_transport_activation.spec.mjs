import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `export { WorkspaceSynchronizer } from "./frontend/map-studio-v4/workspace-synchronizer";
    export { WorkspaceStore, CoherenceMachine } from "./frontend/map-studio-v4/state";
    export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";`, resolveDir: process.cwd() },
  bundle: true, format: "esm", write: false,
});

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Workspace activation runs once in Chromium");
  await page.route("**/workspace-activation.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async () => {
    const { WorkspaceSynchronizer, WorkspaceStore, CoherenceMachine, createGalleryState } = await import("/workspace-activation.js");
    const initial = createGalleryState("ready");
    const entry = { ...initial.resources.entry, liveWorkspaceTransportEnabled: true };
    const store = new WorkspaceStore({ ...initial, resources: { ...initial.resources,
      entry, catalog: { status: "ready", value: [entry], problem: null } } });
    let projection = { host: initial.host, activity: initial.activity, batteryPercent: initial.batteryPercent,
      language: "en", userKey: "user-a", vacuumEntityId: "vacuum.synthetic", entryKey: entry.entryId,
      robotLabel: "Matic", robots: initial.robots };
    const pending = [], starts = [], transportCallbacks = [];
    const refreshWaiters = [];
    let boundaryRefreshes = 0;
    let catalogRequestGeneration = 1;
    let catalogSuccessfulGeneration = 1;
    let disposed = 0;
    class Transport {
      constructor(_connection, options) { this.entryId = options.entryId; transportCallbacks.push(options); }
      start() { starts.push(this.entryId); }
      dispose() { disposed += 1; }
      notifyReconnect() {}
    }
    const sync = new WorkspaceSynchronizer(store, new CoherenceMachine(), {}, undefined, {
      projection: () => projection, accessDenied() {},
      catalogRequestGeneration: () => catalogRequestGeneration,
      catalogSuccessfulGeneration: () => catalogSuccessfulGeneration,
      refreshSpatialBoundary() {
        boundaryRefreshes += 1;
        return new Promise(resolve => refreshWaiters.push(resolve));
      }, loadResources() {},
      spatialRecoveryBlocks: () => false,
      loadTransport: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    });
    const enable = value => {
      const current = { ...entry, liveWorkspaceTransportEnabled: value };
      store.patch({ resources: { ...store.value.resources, entry: current,
        catalog: { status: "ready", value: [current], problem: null } } });
    };
    window.activation = { store, sync, pending, starts, enable,
      run: () => sync.sync(projection),
      mapAvailable: value => store.patch({ map: { ...store.value.map, available: value } }),
      owner: changes => { projection = { ...projection, ...changes }; },
      emit: (index, event) => transportCallbacks[index]?.onEvent(event),
      freshCatalog: () => {
        const current = store.value.resources.entry;
        store.patch({ resources: { ...store.value.resources,
          catalog: { status: "ready", value: current ? [{ ...current }] : [], problem: null } } });
      },
      catalogStatus: status => {
        if (status === "loading") catalogRequestGeneration += 1;
        if (status === "ready") catalogSuccessfulGeneration = catalogRequestGeneration;
        const current = store.value.resources.catalog;
        const value = status === "ready" ? [{ ...(current.value?.[0] ?? entry) }] : current.value;
        store.patch({ resources: { ...store.value.resources, catalog: { status, value, problem: null } } });
      },
      completeRefresh: index => refreshWaiters[index]?.(),
      get boundaryRefreshes() { return boundaryRefreshes; },
      resolve: index => pending[index].resolve({ WorkspaceTransport: Transport }),
      get disposed() { return disposed; } };
  });
});

test("default admitted capability loads once and failure waits for retry", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.activation;
    h.run();
    const beforeRenderOpportunity = h.pending.length;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    for (let tick = 0; tick < 20; tick += 1) h.run();
    const defaultLoads = h.pending.length;
    h.pending[0].reject(new Error("module unavailable"));
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    for (let tick = 0; tick < 20; tick += 1) h.run();
    const failedLoads = h.pending.length;
    const retainedScene = h.store.value.resources.scene.value !== null;
    h.sync.retry();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    h.resolve(1);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    h.sync.dispose();
    return { beforeRenderOpportunity, defaultLoads, failedLoads, retryLoads: h.pending.length,
      retainedScene, starts: h.starts.length, disposed: h.disposed };
  });
  expect(result).toEqual({ beforeRenderOpportunity: 0, defaultLoads: 1, failedLoads: 1, retryLoads: 2,
    retainedScene: true, starts: 1, disposed: 1 });
});

for (const boundary of ["opt-out", "entry", "user", "page", "access", "dispose"]) {
  test(`late optional module cannot activate across ${boundary}`, async ({ page }) => {
    const result = await page.evaluate(async boundary => {
      const h = window.activation;
      h.enable(true);
      h.run();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (boundary === "opt-out") h.enable(false);
      if (boundary === "entry") h.owner({ entryKey: "other-entry" });
      if (boundary === "user") h.owner({ userKey: "user-b" });
      if (boundary === "page") h.store.patch({ pageActive: false });
      if (boundary === "access") h.owner({ host: { ...h.store.value.host, administrator: false } });
      if (boundary === "dispose") h.sync.dispose();
      else h.run();
      h.resolve(0);
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
      const staleStarts = h.starts.length;
      if (boundary === "user") {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        h.resolve(1);
        for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
      }
      h.sync.dispose();
      return { staleStarts, currentStarts: h.starts.length };
    }, boundary);
    expect(result).toEqual({ staleStarts: 0, currentStarts: boundary === "user" ? 1 : 0 });
  });
}

test("unavailable map starts the admitted stream after the bounded fallback", async ({ page }) => {
  await page.clock.install();
  const result = await page.evaluate(async () => {
    const h = window.activation;
    h.mapAvailable(false);
    h.run();
    const beforeFallback = h.pending.length;
    await new Promise(resolve => setTimeout(resolve, 1_999));
    const justBeforeFallback = h.pending.length;
    await new Promise(resolve => setTimeout(resolve, 1));
    await Promise.resolve();
    return { beforeFallback, justBeforeFallback, afterFallback: h.pending.length };
  });
  expect(result).toEqual({ beforeFallback: 0, justBeforeFallback: 0, afterFallback: 1 });
  await page.evaluate(() => window.activation.sync.dispose());
});

test("entry removal waits for a post-event catalog success and ignores old-owner callbacks", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.activation;
    h.run();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    h.resolve(0);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    h.catalogStatus("loading"); // a forced catalog request was already in flight
    h.emit(0, { type: "resync", reason: "entry_removed" });
    h.catalogStatus("ready"); // its stale-but-successful result lands after removal
    for (let tick = 0; tick < 20; tick += 1) h.run();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const whileCatalogRefreshPending = h.pending.length;
    const refreshes = h.boundaryRefreshes;
    h.catalogStatus("loading"); // the queued post-event successor starts
    h.catalogStatus("error");
    h.completeRefresh(0);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    h.run();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const afterFailedSuccessor = h.pending.length;
    h.catalogStatus("loading");
    h.catalogStatus("ready"); // a later successful poll is newer than the retirement baseline
    h.run();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const afterFreshCatalog = h.pending.length;
    h.resolve(1);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    h.owner({ userKey: "user-b" });
    h.run();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    h.emit(0, { type: "resync", reason: "entry_removed" });
    h.resolve(2);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    h.sync.dispose();
    return { whileCatalogRefreshPending, refreshes, staleRefreshes: h.boundaryRefreshes,
      afterFailedSuccessor, afterFreshCatalog, pendingAfterOwnerChange: h.pending.length, starts: h.starts.length };
  });
  expect(result).toEqual({ whileCatalogRefreshPending: 1, refreshes: 1, staleRefreshes: 1,
    afterFailedSuccessor: 1, afterFreshCatalog: 2, pendingAfterOwnerChange: 3, starts: 3 });
});
