import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const { outputFiles } = await build({
  stdin: { contents: `
    import "./archive-workspace";
    import "./map-canvas";
    import { MAP_CANVAS_TAG } from "./element-tags";
    import { EffectController } from "./effects";
    import { WorkspaceStore } from "./state";
    import { syntheticEntry, syntheticScene, syntheticHistory, syntheticPose, syntheticPlans } from "../map-studio-v4-review/synthetic-fixtures";
    window.archiveHarness = { EffectController, WorkspaceStore, syntheticEntry, syntheticScene, syntheticHistory, syntheticPose, syntheticPlans, MAP_CANVAS_TAG };
  `, resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)), loader: "ts" },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
});
const id = (n) => n.toString(16).padStart(32, "0");

test.beforeEach(async ({ page }) => {
  await page.route("**/archive-workspace-test", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.route("**/archive-workspace-test.js", (route) => route.fulfill({ contentType: "text/javascript", body: outputFiles[0].text }));
  await page.goto("/archive-workspace-test");
  await page.evaluate(() => import("/archive-workspace-test.js"));
  await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, syntheticEntry, syntheticScene, syntheticHistory, syntheticPose, syntheticPlans, MAP_CANVAS_TAG } = window.archiveHarness;
    const id = (n) => n.toString(16).padStart(32, "0");
    const entry = { ...syntheticEntry(), deltaUrl: null };
    const rows = [1, 2].map((n) => ({ id: id(n), content_id: "a".repeat(24), created_at: "2026-10-31T10:00:00Z",
      revision: 7, point_count: 5300, scene_url: `/saved/${id(n)}`, name: `Saved ${n}`, retention: "automatic",
      deleted_until: null, imported: false, comparison_group: null, frame: null, compressed_bytes: 50 }));
    const wireCatalog = () => ({ generation: control.generation, capture_paused: control.capturePaused,
      capacity_blocked: control.capacityBlocked, records: rows,
      usage: { record_count: 2, automatic_count: 2, kept_count: 0, trash_count: 0, compressed_bytes: 100,
        active_compressed_bytes: 100, trash_compressed_bytes: 0, reserved_bytes: 0, reserved_count: 0 } });
    const history = syntheticHistory();
    history.floors = [history.floors[0]];
    history.floors[0].snapshots = rows.map((row) => ({ id: row.id, createdAt: row.created_at, revision: row.revision,
      pointCount: row.point_count, sceneUrl: row.scene_url }));
    const control = { deny: false, failReadback: false, ambiguousDelete: false, deleteApplied: false,
      capacityBlocked: false, capturePaused: false, generation: 7, acknowledged: false, exportGate: null,
      calls: [], sceneReads: [], events: [], downloads: [], urls: [] };
    const backend = {
      catalog: async () => [entry], history: async () => history,
      scene: async (path, _revision, _complete, source) => { control.sceneReads.push(path); return { scene: { ...syntheticScene(), source: source || "live" }, floorCoherent: true, revision: 7, notModified: false }; },
      pose: async () => syntheticPose(), plans: async () => syntheticPlans(), dispose() {},
      archiveRequest: async (entryId, operation, body, signal) => {
        control.calls.push({ entryId, operation, body, signal });
        if (operation === "export") return new Promise((resolve) => { control.exportGate = resolve; });
        if (control.deny) throw Object.assign(new Error("denied"), { status: 403 });
        if (body) {
          control.acknowledged = true;
          if (control.ambiguousDelete && (body.action === "delete" || body.action === "permanent_delete")) {
            const deleted = new Set(body.record_ids);
            rows.splice(0, rows.length, ...rows.filter((row) => !deleted.has(row.id)));
            history.floors[0].snapshots = history.floors[0].snapshots.filter((snapshot) => !deleted.has(snapshot.id));
            control.generation += 1;
            control.deleteApplied = true;
            throw new Error("connection lost after durable deletion");
          }
          return { generation: control.generation + 1, request_id: body.request_id };
        }
        if (control.acknowledged && control.failReadback) throw Object.assign(new Error("offline"), { status: 503 });
        return wireCatalog();
      },
    };
    const store = new WorkspaceStore();
    const effects = new EffectController(store, backend, null, false);
    effects.sync({ userKey: "owner-a", entryKey: entry.entryId, vacuumEntityId: "vacuum.test", activity: "idle",
      host: { ...store.value.host, connected: true, administrator: true, robotConnected: true, robotCount: 1 },
      robots: [{ entryId: entry.entryId, label: "Synthetic robot" }], language: "en" });
    await effects.refreshCatalog(true);
    await effects.openWorkflow("history");
    await effects.selectHistory(id(1));
    const element = document.createElement("matic-archive-workspace-v4");
    element.backend = backend; element.state = store.value;
    const mainCanvas = document.createElement(MAP_CANVAS_TAG);
    mainCanvas.style.cssText = "display:block;width:400px;height:240px";
    mainCanvas.state = store.value;
    element.emit = (intent) => {
      control.events.push(intent);
      if (intent.type === "invalidate-history") effects.invalidateHistory(intent.historyIds);
      if (intent.type === "archive-access-denied") effects.archiveAccessDenied();
      if (intent.type === "set-comparison-active") void effects.setComparisonActive(intent.value);
      if (intent.type === "refresh-history") void effects.refreshHistory(intent.historyId);
    };
    const unsubscribe = store.subscribe((state) => { element.state = state; mainCanvas.state = state; });
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = create(blob); control.urls.push(url); return url; };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { control.downloads.push({ href: this.href, download: this.download }); };
    document.body.append(mainCanvas, element);
    window.archiveRun = { element, mainCanvas, store, effects, control, backend,
      cleanup: () => { unsubscribe(); element.remove(); mainCanvas.remove(); effects.dispose(); URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; } };
    await element.updateComplete;
  });
  await expect(page.getByRole("heading", { name: "Maps & storage", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Saved 1", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.archiveRun.store.value.resources.scene.value?.source)).toBe("history");
});

test.afterEach(async ({ page }) => { await page.evaluate(() => window.archiveRun?.cleanup()); });

test("backend-shaped content IDs render storage management, while malformed catalog metadata prompts refresh", async ({ page }) => {
  await expect(page.locator("article.record")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Maps & storage", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const backend = window.archiveRun.backend;
    const original = backend.archiveRequest;
    backend.archiveRequest = async (...args) => {
      if (args[1] === "manage" && args[2] === undefined) {
        const value = await original(...args);
        value.records[0].content_id = "a".repeat(23);
        return value;
      }
      return original(...args);
    };
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Saved-map information could not be read. Refresh to try again.");
  await expect(page.getByRole("alert")).not.toContainText("can’t read this archive");
});

test("@safety revoked archive authorization clears catalog and main-scene resources", async ({ page }) => {
  await page.evaluate(() => { window.archiveRun.control.deny = true; });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.archiveRun.store.value.resources.scene.value)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.archiveRun.mainCanvas.rendererDiagnostics()?.sourcePoints)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.archiveRun.element._catalog)).toBeNull();
  await expect(page.locator("article.record")).toHaveCount(0);
  expect(await page.evaluate(() => window.archiveRun.control.events.some((event) => event.type === "archive-access-denied"))).toBe(true);
});

test("@safety a destructive acknowledgement invalidates the selected main history even when readback fails", async ({ page }) => {
  await page.evaluate(() => { window.archiveRun.control.failReadback = true; });
  await page.locator("article.record").first().getByRole("button", { name: "Move to Recently deleted", exact: true }).click();
  await page.getByRole("region", { name: "Move these saved maps to Recently deleted?" }).getByRole("button", { name: "Move to Recently deleted", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.archiveRun.control.acknowledged)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.archiveRun.store.value.resources.scene.value)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.archiveRun.mainCanvas.rendererDiagnostics()?.sourcePoints)).toBe(0);
  expect(await page.evaluate(() => window.archiveRun.store.value.selection.historyId)).toBe(id(1));
  await expect(page.getByRole("alert")).toContainText("could not be confirmed");
  expect(await page.evaluate(() => window.archiveRun.control.events.find((event) => event.type === "invalidate-history"))).toEqual({ type: "invalidate-history", historyIds: [id(1)] });
  expect(await page.evaluate(() => window.archiveRun.control.events.filter((event) => event.type === "refresh-history"))).toEqual([]);
});

test("@safety an ambiguous destructive response invalidates selected history and reconciles the catalog", async ({ page }) => {
  await page.evaluate(() => { window.archiveRun.control.ambiguousDelete = true; });
  await page.locator("article.record").first().getByRole("button", { name: "Move to Recently deleted", exact: true }).click();
  await page.getByRole("region", { name: "Move these saved maps to Recently deleted?" }).getByRole("button", { name: "Move to Recently deleted", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.archiveRun.control.deleteApplied)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.archiveRun.element._catalog?.records.map((row) => row.id))).toEqual([id(2)]);
  await expect.poll(() => page.evaluate(() => window.archiveRun.store.value.resources.scene.value)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.archiveRun.mainCanvas.rendererDiagnostics()?.sourcePoints)).toBe(0);
  await expect(page.getByRole("alert")).toContainText("could not be confirmed");
  const outcome = await page.evaluate(() => ({
    generation: window.archiveRun.element._catalog?.generation,
    historyId: window.archiveRun.store.value.selection.historyId,
    invalidations: window.archiveRun.control.events.filter((event) => event.type === "invalidate-history"),
    refreshes: window.archiveRun.control.events.filter((event) => event.type === "refresh-history"),
    catalogReads: window.archiveRun.control.calls.filter((call) => call.body === undefined).length,
  }));
  expect(outcome.generation).toBe(8);
  expect(outcome.historyId).toBe(id(1));
  expect(outcome.invalidations).toEqual([{ type: "invalidate-history", historyIds: [id(1)] }]);
  expect(outcome.refreshes).toEqual([{ type: "refresh-history" }]);
  expect(outcome.catalogReads).toBeGreaterThanOrEqual(2);
});

test("capacity blocked is visible separately from user pause and clears on the next catalog read", async ({ page }) => {
  await page.evaluate(() => { window.archiveRun.control.capacityBlocked = true; });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const blocked = "Automatic history will resume when space is available.";
  await expect(page.getByText(blocked, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause automatic history", exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({
    capacityBlocked: window.archiveRun.element._catalog.capacityBlocked,
    capturePaused: window.archiveRun.element._catalog.capturePaused,
  }))).toEqual({ capacityBlocked: true, capturePaused: false });

  await page.evaluate(() => { window.archiveRun.control.capacityBlocked = false; });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(blocked, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause automatic history", exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({
    capacityBlocked: window.archiveRun.element._catalog.capacityBlocked,
    capturePaused: window.archiveRun.element._catalog.capturePaused,
  }))).toEqual({ capacityBlocked: false, capturePaused: false });

  await page.evaluate(() => {
    window.archiveRun.control.capacityBlocked = true;
    window.archiveRun.control.capturePaused = true;
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(blocked, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Automatic history is paused.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume automatic history", exact: true })).toBeVisible();
});

test("history invalidation immediately reads back simultaneous saved-map metadata and capacity changes", async ({ page }) => {
  await page.evaluate(() => {
    const { backend, control, effects } = window.archiveRun;
    control.generation = 8;
    control.capacityBlocked = true;
    // The harness keeps its wire rows in the archive request closure; mutate
    // that catalog through the same request surface used by archive readback.
    const original = backend.archiveRequest;
    backend.archiveRequest = async (entryId, operation, body, signal) => {
      if (!body) return {
        generation: control.generation,
        capture_paused: control.capturePaused,
        capacity_blocked: control.capacityBlocked,
        records: [{ id: "1".padStart(32, "0"), content_id: "a".repeat(24), created_at: "2026-10-31T10:00:00Z",
          revision: 7, point_count: 5300, scene_url: "/saved/one", name: "Renamed map", retention: "kept",
          deleted_until: null, imported: false, comparison_group: null, frame: null, compressed_bytes: 50 }],
        usage: { record_count: 1, automatic_count: 0, kept_count: 1, trash_count: 0, compressed_bytes: 50,
          active_compressed_bytes: 50, trash_compressed_bytes: 0, reserved_bytes: 0, reserved_count: 0 },
      };
      return original(entryId, operation, body, signal);
    };
    effects.refreshHistory();
  });
  await expect.poll(() => page.evaluate(() => window.archiveRun.element._catalog?.generation)).toBe(8);
  await expect(page.getByRole("checkbox", { name: "Renamed map", exact: true })).toBeVisible();
  await expect(page.locator("article.record").getByRole("button", { name: "Unkeep", exact: true })).toBeVisible();
  await expect(page.getByText("Automatic history will resume when space is available.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.archiveRun.element._catalog.records.map((row) => [row.name, row.retention])))
    .toEqual([["Renamed map", "kept"]]);
});

test("a pending invalidation readback is cancelled and cannot replace a new owner's catalog", async ({ page }) => {
  await page.evaluate(() => {
    const { backend, store, effects, control } = window.archiveRun;
    const original = backend.archiveRequest;
    control.generation = 8;
    let releaseOld;
    let oldStarted = false;
    const oldCatalog = {
      generation: 8, capture_paused: false, capacity_blocked: false,
      records: [{ id: "1".padStart(32, "0"), content_id: "a".repeat(24), created_at: "2026-10-31T10:00:00Z",
        revision: 7, point_count: 5300, scene_url: "/saved/one", name: "Stale owner row", retention: "automatic",
        deleted_until: null, imported: false, comparison_group: null, frame: null, compressed_bytes: 50 }],
      usage: { record_count: 1, automatic_count: 1, kept_count: 0, trash_count: 0, compressed_bytes: 50,
        active_compressed_bytes: 50, trash_compressed_bytes: 0, reserved_bytes: 0, reserved_count: 0 },
    };
    backend.archiveRequest = (entryId, operation, body, signal) => {
      if (!body && !oldStarted) {
        oldStarted = true;
        return new Promise((resolve) => { releaseOld = () => resolve(oldCatalog); });
      }
      if (!body) {
        return Promise.resolve({ ...oldCatalog, generation: 9, records: oldCatalog.records.map((row) => ({ ...row, name: "New owner row" })) });
      }
      return original(entryId, operation, body, signal);
    };
    effects.refreshHistory();
    control.releaseOldRead = () => releaseOld?.();
    control.oldReadStarted = () => oldStarted;
    control.changeOwner = () => store.patch({ owner: { ...store.value.owner, userKey: "owner-b" } });
  });
  await expect.poll(() => page.evaluate(() => window.archiveRun.control.oldReadStarted())).toBe(true);
  await page.evaluate(() => window.archiveRun.control.changeOwner());
  await expect.poll(() => page.evaluate(() => window.archiveRun.element._catalog?.generation)).toBe(9);
  await expect(page.getByRole("checkbox", { name: "New owner row", exact: true })).toBeVisible();
  await page.evaluate(() => window.archiveRun.control.releaseOldRead());
  await expect(page.getByRole("checkbox", { name: "New owner row", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Stale owner row", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.archiveRun.element._catalog.generation)).toBe(9);
});

test("an external history change superseding the archive's own refresh still gets an immediate catalog readback", async ({ page }) => {
  await page.evaluate(async () => {
    const { backend, effects, control } = window.archiveRun;
    const originalHistory = backend.history;
    const oldHistory = await originalHistory();
    let historyCalls = 0;
    let releaseOld;
    backend.history = async () => {
      historyCalls += 1;
      if (historyCalls === 1) return new Promise((resolve) => { releaseOld = () => resolve(oldHistory); });
      return { ...oldHistory, floors: oldHistory.floors.map((floor) => ({ ...floor,
        snapshots: floor.snapshots.map((snapshot) => ({ ...snapshot, name: "External rename" })) })) };
    };
    const originalArchiveRequest = backend.archiveRequest;
    let archiveReads = 0;
    backend.archiveRequest = (entryId, operation, body, signal) => {
      if (!body) {
        archiveReads += 1;
        return Promise.resolve({
          generation: 10, capture_paused: false, capacity_blocked: false,
          records: [{ id: "1".padStart(32, "0"), content_id: "a".repeat(24), created_at: "2026-10-31T10:00:00Z",
            revision: 7, point_count: 5300, scene_url: "/saved/one", name: "External rename", retention: "automatic",
            deleted_until: null, imported: false, comparison_group: null, frame: null, compressed_bytes: 50 }],
          usage: { record_count: 1, automatic_count: 1, kept_count: 0, trash_count: 0, compressed_bytes: 50,
            active_compressed_bytes: 50, trash_compressed_bytes: 0, reserved_bytes: 0, reserved_count: 0 },
        });
      }
      return originalArchiveRequest(entryId, operation, body, signal);
    };
    control.releaseSupersededHistory = () => releaseOld?.();
    control.historyCallCount = () => historyCalls;
    control.archiveReadCount = () => archiveReads;
    effects.refreshHistory("1".padStart(32, "0"));
  });
  await expect.poll(() => page.evaluate(() => window.archiveRun.control.historyCallCount())).toBe(1);
  await page.evaluate(() => window.archiveRun.effects.refreshHistory());
  await expect.poll(() => page.evaluate(() => window.archiveRun.control.historyCallCount())).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.archiveRun.element._catalog?.generation)).toBe(10);
  await expect(page.getByRole("checkbox", { name: "External rename", exact: true })).toBeVisible();
  await page.evaluate(() => window.archiveRun.control.releaseSupersededHistory());
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => ({
    generation: window.archiveRun.element._catalog.generation,
    reads: window.archiveRun.control.archiveReadCount(),
  }))).toEqual({ generation: 10, reads: 2 });
});

test("a queued automatic readback preserves a failed mutation/readback message", async ({ page }) => {
  await page.evaluate(() => {
    const { backend, control } = window.archiveRun;
    const original = backend.archiveRequest;
    let catalogReads = 0;
    let rejectFirst;
    backend.archiveRequest = (entryId, operation, body, signal) => {
      if (!body) {
        catalogReads += 1;
        if (catalogReads === 1) return new Promise((_resolve, reject) => {
          rejectFirst = () => reject(Object.assign(new Error("temporary catalog outage"), { status: 503 }));
        });
      }
      return original(entryId, operation, body, signal);
    };
    control.catalogReadCount = () => catalogReads;
    control.rejectFirstCatalogRead = () => rejectFirst?.();
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.archiveRun.control.catalogReadCount())).toBe(1);
  await page.evaluate(async () => {
    const { effects, store, element, control } = window.archiveRun;
    const previous = store.value.resources.history;
    void effects.refreshHistory();
    for (let attempt = 0; attempt < 100 && store.value.resources.history === previous; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await element.updateComplete;
    control.rejectFirstCatalogRead();
  });
  await expect.poll(() => page.evaluate(() => window.archiveRun.control.catalogReadCount())).toBe(2);
  await expect.poll(() => page.evaluate(() => window.archiveRun.element._error)).not.toBe("");
  const error = await page.evaluate(() => window.archiveRun.element._error);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.archiveRun.element._error)).toBe(error);
});

test("the scheduled automatic catalog refresh preserves the last mutation error", async ({ page }) => {
  await page.evaluate(() => {
    const { backend, control } = window.archiveRun;
    const original = backend.archiveRequest;
    let fail = true;
    let catalogReads = 0;
    let autoRefresh;
    const setTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 15_000) { autoRefresh = callback; return 999_999; }
      return setTimeout(callback, delay, ...args);
    };
    backend.archiveRequest = (entryId, operation, body, signal) => {
      if (!body) {
        catalogReads += 1;
        if (fail) {
          fail = false;
          return Promise.reject(Object.assign(new Error("temporary catalog outage"), { status: 503 }));
        }
      }
      return original(entryId, operation, body, signal);
    };
    control.fireAutoRefresh = () => { if (!autoRefresh) return false; autoRefresh(); return true; };
    control.autoCatalogReadCount = () => catalogReads;
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.archiveRun.element._error)).not.toBe("");
  const error = await page.evaluate(() => window.archiveRun.element._error);
  expect(await page.evaluate(() => window.archiveRun.control.fireAutoRefresh())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.archiveRun.control.autoCatalogReadCount())).toBe(2);
  await expect.poll(() => page.evaluate(() => window.archiveRun.element._catalog?.generation)).toBe(7);
  expect(await page.evaluate(() => window.archiveRun.element._error)).toBe(error);
});

test("@safety an export belonging to a retired owner cannot create a download or object URL", async ({ page }) => {
  await page.locator("article.record").first().getByRole("button", { name: "Export", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.archiveRun.control.exportGate))).toBe(true);
  await page.evaluate(async () => {
    const { store, element, control } = window.archiveRun;
    store.patch({ owner: { ...store.value.owner, userKey: "owner-b" } });
    await element.updateComplete;
    control.exportGate({ format: "matic-map-archive", version: 1, records: [{ source_id: "1".padStart(32, "0"),
      created_at: "2026-10-31T10:00:00Z", name: null, sha256: "a".repeat(64), scene_zlib_base64: "eA==", frame: null }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => window.archiveRun.control.downloads)).toEqual([]);
  expect(await page.evaluate(() => window.archiveRun.control.urls)).toEqual([]);
});

test("@safety opening comparison releases the main scene and closing re-admits the selected history", async ({ page }) => {
  await expect.poll(() => page.evaluate(() => window.archiveRun.mainCanvas.rendererDiagnostics()?.sourcePoints || 0)).toBeGreaterThan(0);
  await page.getByRole("checkbox", { name: "Saved 1", exact: true }).check();
  await page.getByRole("checkbox", { name: "Saved 2", exact: true }).check();
  await page.getByRole("button", { name: "Compare selected", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.archiveRun.store.value.comparisonActive)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.archiveRun.store.value.resources.scene.value)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.archiveRun.mainCanvas.rendererDiagnostics()?.sourcePoints)).toBe(0);
  await expect(page.getByRole("button", { name: "Close comparison", exact: true })).toBeVisible();
  await expect(page.getByText("These maps can be viewed side by side. They don't line up, so differences can't be counted.", { exact: true })).toBeVisible();
  const reads = await page.evaluate(() => window.archiveRun.control.sceneReads.length);
  await page.evaluate(async () => { await window.archiveRun.effects.refreshCatalog(true); });
  expect(await page.evaluate(() => window.archiveRun.store.value.resources.scene.value)).toBeNull();
  expect(await page.evaluate(() => window.archiveRun.control.sceneReads.length)).toBe(reads);
  await page.getByRole("button", { name: "Close comparison", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.archiveRun.store.value.comparisonActive)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.archiveRun.store.value.resources.scene.value?.source)).toBe("history");
  await expect.poll(() => page.evaluate(() => window.archiveRun.mainCanvas.rendererDiagnostics()?.sourcePoints || 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.archiveRun.store.value.selection.historyId)).toBe(id(1));
});

test("@safety revoked access clears both loaded comparison panes", async ({ page }) => {
  await page.getByRole("checkbox", { name: "Saved 1", exact: true }).check();
  await page.getByRole("checkbox", { name: "Saved 2", exact: true }).check();
  await page.getByRole("button", { name: "Compare selected", exact: true }).click();
  await expect(page.getByText("These maps can be viewed side by side. They don't line up, so differences can't be counted.", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const store = window.archiveRun.store;
    store.patch({ host: { ...store.value.host, administrator: false } });
  });
  await expect(page.locator("matic-map-comparison-v4")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.archiveRun.element._pair)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.archiveRun.element._catalog)).toBeNull();
  expect(await page.evaluate(() => window.archiveRun.store.value.comparisonActive)).toBe(false);
  expect(await page.evaluate(() => window.archiveRun.store.value.resources.scene.value)).toBeNull();
});

test("retry access performs a new catalog read after a server denial", async ({ page }) => {
  // Keep the wrapper mounted on History to exercise its own denied-key retry;
  // the full host clears its main scene through archive-access-denied above.
  await page.evaluate(() => { window.archiveRun.element.emit = (event) => window.archiveRun.control.events.push(event); window.archiveRun.control.deny = true; });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry access", exact: true })).toBeVisible();
  await page.evaluate(() => { window.archiveRun.control.deny = false; });
  await page.getByRole("button", { name: "Retry access", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Saved 1", exact: true })).toBeVisible();
});


test("@safety an old catalog denial cannot clear a new owner before the next render", async ({ page }) => {
  await page.evaluate(() => {
    const { backend, control } = window.archiveRun;
    const original = backend.archiveRequest;
    backend.archiveRequest = (...args) => {
      backend.archiveRequest = original;
      return new Promise((_resolve, reject) => { control.catalogReject = reject; });
    };
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.archiveRun.control.catalogReject))).toBe(true);
  const result = await page.evaluate(async () => {
    const { element, store, control } = window.archiveRun;
    const schedule = element.scheduleUpdate;
    let release;
    const suspended = new Promise((resolve) => { release = resolve; });
    element.scheduleUpdate = async () => { await suspended; return schedule.call(element); };
    try {
      store.patch({ owner: { ...store.value.owner, userKey: "owner-b" } });
      control.catalogReject(Object.assign(new Error("old owner denied"), { status: 403 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        denied: control.events.some((event) => event.type === "archive-access-denied"),
        source: store.value.resources.scene.value?.source,
      };
    } finally {
      element.scheduleUpdate = schedule;
      release();
      await element.updateComplete;
    }
  });
  expect(result).toEqual({ denied: false, source: "history" });
});


for (const change of ["leave history", "select another map", "newer View request"]) {
  test(`@safety a pending saved-map View respects ${change}`, async ({ page }) => {
    const result = await page.evaluate(async (change) => {
      const { backend, effects, store } = window.archiveRun;
      const id = (n) => n.toString(16).padStart(32, "0");
      const original = backend.history;
      const gates = [];
      const admit = [];
      const admitted = [0, 1].map((index) => new Promise((resolve) => { admit[index] = resolve; }));
      backend.history = () => new Promise((resolve) => {
        const index = gates.length;
        gates.push(resolve);
        admit[index]();
      });
      const pending = effects.refreshHistory(id(2));
      // The controller may load lazily; establish the pending read before changing its context.
      await admitted[0];
      if (change === "leave history") await effects.openWorkflow("none");
      if (change === "select another map") await effects.selectHistory(id(1));
      const newer = change === "newer View request" ? effects.refreshHistory(id(1)) : null;
      if (newer) await admitted[1];
      gates[0](await original());
      await pending;
      const afterOld = { selected: store.value.selection.historyId, workflow: store.value.workflow };
      if (newer) { gates[1](await original()); await newer; }
      backend.history = original;
      return { afterOld, selected: store.value.selection.historyId };
    }, change);
    expect(result.afterOld).toEqual({ selected: id(1), workflow: change === "leave history" ? "none" : "history" });
    expect(result.selected).toBe(id(1));
  });
}


test("@safety deleting the Live fallback source externally clears it without substituting another saved map", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { backend, effects, store, control } = window.archiveRun;
    const id = (n) => n.toString(16).padStart(32, "0");
    const history = await backend.history();
    let snapshots = history.floors[0].snapshots.map((snapshot, index) => ({
      ...snapshot, createdAt: `2026-10-${30 + index}T10:00:00Z`,
    }));
    backend.history = async () => ({ ...history, floors: [{ ...history.floors[0], snapshots }] });
    store.patch({ dataMode: "live", selection: { ...store.value.selection, floorId: "current", historyId: null },
      resources: { ...store.value.resources, scene: { status: "idle", value: null, problem: null } },
      map: { ...store.value.map, available: false, exactPose: false } });
    await effects.refreshHistory();
    const source = store.value.resources.scene.value?.historyRecordId;
    effects.invalidateHistory([id(1)]);
    const unrelatedRetained = store.value.resources.scene.value?.historyRecordId;
    snapshots = snapshots.filter((snapshot) => snapshot.id !== id(2));
    await effects.refreshHistory();
    const deleted = { scene: store.value.resources.scene.value, problem: store.value.resources.scene.problem };
    const reads = control.sceneReads.length;
    await effects.refreshHistory();
    return { source, unrelatedRetained, deleted, afterNextPoll: store.value.resources.scene.value,
      extraReads: control.sceneReads.length - reads, mode: store.value.dataMode };
  });
  expect(result).toEqual({ source: id(2), unrelatedRetained: id(2),
    deleted: { scene: null, problem: "history-source-missing" }, afterNextPoll: null, extraReads: 0, mode: "live" });
  await expect.poll(() => page.evaluate(() => window.archiveRun.mainCanvas.rendererDiagnostics()?.sourcePoints)).toBe(0);
});
