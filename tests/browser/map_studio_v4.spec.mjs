import { expect, test } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { build } from "esbuild";

import { pointer, touchDrag, twoFingerPinch } from "./touch.mjs";

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";

function syntheticScene(roomName, pointX) {
  const metadata = Buffer.from(JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: [10, 10],
    sample_step: 1,
    rooms: [{
      name: roomName,
      boundary: [[0, 0], [6, 0], [6, 5], [0, 5]],
      center: [3, 2.5],
    }],
  }));
  const scene = Buffer.alloc(24 + metadata.length + 8);
  scene.write("MATIC3D\0", 0, "binary");
  scene.writeUInt16LE(1, 8);
  scene.writeUInt16LE(8, 10);
  scene.writeUInt32LE(metadata.length, 12);
  scene.writeUInt32LE(1, 16);
  scene.writeUInt32LE(0, 20);
  metadata.copy(scene, 24);
  scene.writeUInt16LE(pointX, 24 + metadata.length);
  scene.writeUInt16LE(12, 26 + metadata.length);
  scene[28 + metadata.length] = 1;
  scene[29 + metadata.length] = 30;
  scene[30 + metadata.length] = 80;
  scene[31 + metadata.length] = 120;
  return scene;
}

function syntheticDelta(base, scene, baseRevision, revision) {
  const difference = Buffer.alloc(Math.max(base.length, scene.length));
  for (let index = 0; index < difference.length; index += 1) {
    difference[index] = (base[index] || 0) ^ (scene[index] || 0);
  }
  const compressed = deflateSync(difference);
  const header = Buffer.alloc(36);
  header.write("MATICDLT", 0, "binary");
  header.writeUInt16LE(1, 8);
  header.writeUInt16LE(1, 10);
  header.writeBigUInt64LE(BigInt(baseRevision), 12);
  header.writeBigUInt64LE(BigInt(revision), 20);
  header.writeUInt32LE(scene.length, 28);
  header.writeUInt32LE(compressed.length, 32);
  return Buffer.concat([header, compressed]);
}

async function loadGallery(page, { scenario = "ready", narrow = false } = {}) {
  await page.goto("/");
  await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
  await page.evaluate(async ({ tag, selectedScenario, selectedNarrow }) => {
    await customElements.whenDefined(tag);
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.scenario = selectedScenario;
    gallery.narrow = selectedNarrow;
    document.body.style.margin = "0";
    document.body.append(gallery);
  }, { tag: GALLERY_TAG, selectedScenario: scenario, selectedNarrow: narrow });
  return page.locator(GALLERY_TAG);
}

async function loadEffectHarness(page) {
  const bundle = await build({
    stdin: {
    contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { LayerHistoryController } from "./frontend/map-studio-v4/layer-history"; export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
    resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/plan-recovery-test.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
}

async function snapshot(page) {
  return page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot(), GALLERY_TAG);
}

// Synthetic PointerEvents are not "active pointers", so the capture calls the
// shell and gesture controller make throw NotFoundError and abort the handler
// half-way. Same shim ui.spec.mjs uses for v0.3.
async function shimPointerCapture(page) {
  await page.addInitScript(() => {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  });
}

// Detent changes animate block-size; a drag that starts mid-animation reads
// the wrong start height. Wait until the sheet has held one height for a few
// frames before measuring or dragging again.
const settleSheet = (gallery) => gallery.locator(".mobile-sheet").evaluate((element) => new Promise((resolve) => {
  let last = -1;
  let stable = 0;
  const tick = () => {
    const height = element.getBoundingClientRect().height;
    stable = Math.abs(height - last) < 0.5 ? stable + 1 : 0;
    last = height;
    if (stable >= 4) resolve(height);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));

const sheetSeam = (gallery) => gallery.locator(".scene-window").evaluate((element) => {
  const bounds = element.getBoundingClientRect();
  const sheet = element.getRootNode().host.getRootNode().querySelector(".mobile-sheet")?.getBoundingClientRect();
  return sheet ? Math.abs(bounds.bottom - sheet.top) : Number.POSITIVE_INFINITY;
});

// A slow drag: 12px every 40ms (0.3 px/ms, under the 0.5 px/ms flick
// threshold) ending on a repeated point so the release velocity is zero.
function slowDrag(dy, x = 160, y = 20) {
  const steps = Math.ceil(Math.abs(dy) / 12);
  const points = [[x, y]];
  for (let index = 1; index <= steps; index += 1) points.push([x, y + (dy * index) / steps]);
  points.push([x, y + dy]);
  return points;
}

test.describe("Map Studio v0.4 foundation", () => {
  test("registers the sidebar robot before opening the map without replacing other icon sets", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.customIcons = { other: { getIcon: async () => ({ path: "M1 1H2" }) } };
    });
    await page.addScriptTag({ url: "/matic_icons.js", type: "module" });
    const result = await page.evaluate(async () => ({
      robot: await window.customIcons.matic.getIcon("robot"),
      unknown: await window.customIcons.matic.getIcon("unknown"),
      list: await window.customIcons.matic.getIconList(),
      other: await window.customIcons.other.getIcon("existing"),
      panelLoaded: !!customElements.get("matic-map-studio-gallery-v0-4-0"),
    }));
    expect(result.robot.viewBox).toBe("0 0 24 24");
    expect(result.robot.path).toContain("M4 4H20");
    expect(result.unknown.path).toBe("");
    expect(result.list).toEqual([{ name: "robot", keywords: ["robot", "vacuum", "matic"] }]);
    expect(result.other.path).toBe("M1 1H2");
    expect(result.panelLoaded).toBe(false);
  });

  for (const canRebind of [true, false]) {
    test(`shows one actionable area recovery instruction when review is ${canRebind}`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "ready" });
      await page.evaluate(({ tag, reviewable }) => {
        const element = document.querySelector(tag);
        const state = element.getWorkspaceSnapshot();
        element.replaceWorkspaceState({
          ...state,
          workflow: "areaReview",
          areaDraft: { ...state.areaDraft, status: "stale", canRebind: reviewable },
        });
      }, { tag: GALLERY_TAG, reviewable: canRebind });
      const review = gallery.getByText("Review the saved outline on this current map, then confirm it.", { exact: true });
      const redraw = gallery.getByText("This outline no longer matches the current room map. Redraw it before saving.", { exact: true });
      await expect(canRebind ? review : redraw).toBeVisible();
      await expect(canRebind ? redraw : review).toHaveCount(0);
    });
  }

  test("never offers a hidden stale plan while its catalog is loading or unavailable", async ({ page }) => {
    const gallery = await loadGallery(page);
    for (const workflow of ["plan", "rooms"]) {
      for (const status of ["loading", "error", "empty"]) {
        await page.evaluate(({ tag, workflow, status }) => {
          const element = document.querySelector(tag);
          const state = element.getWorkspaceSnapshot();
          element.replaceWorkspaceState({ ...state, workflow, resources: { ...state.resources, plans: { status, value: null, problem: status === "error" ? "request-failed" : null } } });
        }, { tag: GALLERY_TAG, workflow, status });
        await expect(gallery.locator(".action-bar button")).toHaveAttribute("aria-disabled", "true");
        await expect(gallery.locator(".action-bar")).not.toContainText("Run this plan");
      }
    }
  });
  test("recovers an uncertain action only after a successful status read without replaying it", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore({ ...initial, command: "failed" });
      let writes = 0;
      let reject = true;
      const effects = new EffectController(store, {
        catalog: async () => { if (reject) throw new Error("Offline"); return [initial.resources.entry]; },
        history: async () => initial.resources.history.value,
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => initial.resources.plans.value,
        service: async () => { writes += 1; },
        dispose() {},
      });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      try {
        await effects.executeAction("recheck-status");
        const failed = store.value.command;
        reject = false;
        await effects.executeAction("recheck-status");
        return { failed, recovered: store.value.command, writes };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ failed: "failed", recovered: "idle", writes: 0 });
  });
  for (const forced of [false, true]) {
    for (const succeeds of [false, true]) {
      test(`awaits ${forced ? "in-flight forced" : "queued forced"} status recovery when the read ${succeeds ? "succeeds" : "fails"}`, async ({ page }) => {
        await loadEffectHarness(page);
        await page.evaluate(async ({ forced }) => {
          const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
          const initial = createGalleryState("ready");
          const store = new WorkspaceStore({ ...initial, command: "failed" });
          const harness = { pending: [], settled: false, writes: 0, store, initial };
          let hold = false;
          const effects = new EffectController(store, {
            catalog: async (signal) => {
              if (!hold) return [initial.resources.entry];
              return new Promise((resolve, reject) => {
                harness.pending.push({ resolve, reject });
                signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
              });
            },
            history: async () => initial.resources.history.value,
            scene: async () => { throw new DOMException("Aborted", "AbortError"); },
            pose: async () => { throw new DOMException("Aborted", "AbortError"); },
            plans: async () => initial.resources.plans.value,
            service: async () => { harness.writes += 1; },
            dispose() {},
          });
          effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
          await effects.refreshCatalog(true);
          hold = true;
          void effects.refreshCatalog(forced);
          harness.effects = effects;
          harness.recovery = effects.executeAction("recheck-status").then(() => { harness.settled = true; });
          window.__statusRecovery = harness;
        }, { forced });
        await expect.poll(() => page.evaluate(() => window.__statusRecovery.pending.length)).toBe(forced ? 1 : 2);
        expect(await page.evaluate(() => {
          const h = window.__statusRecovery;
          return { settled: h.settled, command: h.store.value.command, writes: h.writes };
        })).toEqual({ settled: false, command: "failed", writes: 0 });
        const result = await page.evaluate(async ({ succeeds }) => {
          const h = window.__statusRecovery;
          const request = h.pending.at(-1);
          if (succeeds) request.resolve([h.initial.resources.entry]);
          else request.reject(new Error("Offline"));
          try {
            await h.recovery;
            return { command: h.store.value.command, writes: h.writes };
          } finally { h.effects.dispose(); }
        }, { succeeds });
        expect(result).toEqual({ command: succeeds ? "idle" : "failed", writes: 0 });
      });
    }
  }
  test("keeps Stop enabled after failed and accepted starts in every active state and layout", async ({ page }) => {
    const gallery = await loadGallery(page);
    for (const command of ["failed", "starting"]) {
      for (const activity of ["cleaning", "returning", "recharging", "paused"]) {
        for (const fullMap of [false, true]) {
          await page.evaluate(({ tag, activity, fullMap, command }) => {
            const element = document.querySelector(tag);
            element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), activity, command, fullMap });
          }, { tag: GALLERY_TAG, activity, fullMap, command });
          const stop = gallery.getByRole("button", { name: "Stop cleaning", exact: true });
          await expect(stop).toBeVisible();
          await expect(stop).not.toHaveAttribute("aria-disabled", "true");
        }
      }
    }
  });
  for (const mobile of [false, true]) {
    test(`keeps Stop reachable before vacuum state catches up${mobile ? " @mobile" : ""}`, async ({ page }) => {
      const gallery = await loadGallery(page, { narrow: mobile });
      for (const evidence of ["starting", "runnerLocked", "activePlan", "nativeSessionActive"]) {
        for (const fullMap of [false, true]) {
          await page.evaluate(({ tag, evidence, fullMap }) => {
            const element = document.querySelector(tag);
            const state = element.getWorkspaceSnapshot();
            element.replaceWorkspaceState({
              ...state, activity: "docked", command: evidence === "starting" ? "starting" : "idle",
              fullMap, coherence: "verifying",
              resources: { ...state.resources, entry: {
                ...state.resources.entry, runnerLocked: evidence === "runnerLocked",
                activePlan: evidence === "activePlan", nativeSessionActive: evidence === "nativeSessionActive",
              } },
            });
          }, { tag: GALLERY_TAG, evidence, fullMap });
          const stop = gallery.getByRole("button", { name: "Stop cleaning", exact: true });
          await expect(stop).toBeVisible();
          await expect(stop).not.toHaveAttribute("aria-disabled", "true");
        }
      }
    });
  }
  for (const startRejects of [false, true]) {
    for (const stopRejects of [false, true]) {
      test(`stops an unresolved start and preserves the ${stopRejects ? "failed" : "accepted"} Stop after a late ${startRejects ? "rejection" : "acknowledgement"}`, async ({ page }) => {
        await loadEffectHarness(page);
        const result = await page.evaluate(async ({ startRejects, stopRejects }) => {
          const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
          const initial = createGalleryState("ready");
          const store = new WorkspaceStore(initial);
          const calls = [];
          let completeStart;
          const effects = new EffectController(store, {
            catalog: async () => [initial.resources.entry],
            history: async () => initial.resources.history.value,
            scene: async () => { throw new DOMException("Aborted", "AbortError"); },
            pose: async () => { throw new DOMException("Aborted", "AbortError"); },
            plans: async () => initial.resources.plans.value,
            service: async (domain, service) => {
              calls.push(`${domain}.${service}`);
              if (calls.length === 1) return new Promise((resolve, reject) => {
                completeStart = () => startRejects ? reject(new Error("Late start error")) : resolve();
              });
              if (stopRejects) throw new Error("Stop acknowledgement lost");
            },
            dispose() {},
          });
          effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
          try {
            await effects.refreshCatalog(true);
            const start = effects.executeAction("run-plan");
            const whileStarting = store.value.command;
            await effects.executeAction("run-plan");
            await effects.executeAction("stop");
            const afterStop = { command: store.value.command, notice: store.value.notice };
            completeStart();
            await start;
            return { calls, whileStarting, preserved: JSON.stringify(afterStop) === JSON.stringify({ command: store.value.command, notice: store.value.notice }), command: store.value.command };
          } finally { effects.dispose(); }
        }, { startRejects, stopRejects });
        expect(result).toEqual({ calls: ["matic_robot.run_selected_plan", "matic_robot.stop_intelligent_cleaning"], whileStarting: "starting", preserved: true, command: stopRejects ? "failed" : "settling" });
      });
    }
  }
  for (const rejected of [false, true]) {
    for (const managed of [false, true]) {
      test(`allows ${managed ? "managed" : "direct"} Stop after a ${rejected ? "rejected" : "successful"} start acknowledgement without replaying Start`, async ({ page }) => {
        await loadEffectHarness(page);
        const result = await page.evaluate(async ({ managed, rejected }) => {
          const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
          const initial = createGalleryState("ready");
          const store = new WorkspaceStore({ ...initial, selection: { ...initial.selection, areaId: "entryway" } });
          const calls = [];
          const effects = new EffectController(store, {
            catalog: async () => [initial.resources.entry],
            history: async () => initial.resources.history.value,
            scene: async () => { throw new DOMException("Aborted", "AbortError"); },
            pose: async () => { throw new DOMException("Aborted", "AbortError"); },
            plans: async () => initial.resources.plans.value,
            service: async (domain, service) => {
              calls.push(`${domain}.${service}`);
              if (rejected && calls.length === 1) throw new Error("Acknowledgement lost");
            },
            dispose() {},
          });
          const projection = { host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
          effects.sync(projection);
          try {
            await effects.refreshCatalog(true);
            await effects.executeAction("run-area");
            const failed = store.value.command;
            effects.sync({ ...projection, activity: "cleaning" });
            store.patch({ resources: { ...store.value.resources, entry: { ...store.value.resources.entry, activePlan: managed, runnerLocked: managed } } });
            await effects.executeAction("run-area");
            const host = store.value.host;
            for (const key of ["connected", "administrator", "robotConnected"]) {
              store.patch({ host: { ...host, [key]: false } });
              await effects.executeAction("stop");
            }
            store.patch({ host });
            await effects.executeAction("stop");
            await effects.executeAction("stop");
            return { failed, calls, command: store.value.command };
          } finally { effects.dispose(); }
        }, { managed, rejected });
        expect(result).toEqual({ failed: rejected ? "failed" : "starting", calls: ["matic_robot.clean_area", "matic_robot.stop_intelligent_cleaning"], command: "settling" });
      });
    }
  }
  test("ignores an old start response after changing robots or closing the panel", async ({ page }) => {
    await loadEffectHarness(page);
    const results = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const results = [];
      for (const close of [false, true]) {
        for (const rejectLate of [false, true]) {
          const initial = createGalleryState("ready");
          const store = new WorkspaceStore(initial);
          const calls = [];
          let completeStart;
          const effects = new EffectController(store, {
            catalog: async () => [initial.resources.entry],
            history: async () => initial.resources.history.value,
            scene: async () => { throw new DOMException("Aborted", "AbortError"); },
            pose: async () => { throw new DOMException("Aborted", "AbortError"); },
            plans: async () => initial.resources.plans.value,
            service: (domain, service, data, entity) => {
              calls.push([service, entity]);
              return new Promise((resolve, reject) => {
                completeStart = () => rejectLate ? reject(new Error("Old response")) : resolve();
              });
            },
            dispose() {},
          });
          const projection = { host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
          effects.sync(projection);
          await effects.refreshCatalog(true);
          const start = effects.executeAction("run-plan");
          if (close) effects.dispose();
          else {
            effects.sync({ ...projection, entryKey: "other", vacuumEntityId: "vacuum.other", activity: "cleaning" });
            // The new robot's projection arrives before its catalog. Never
            // dispatch using the old robot's workspace and the new target.
            await effects.executeAction("stop");
            await effects.refreshCatalog(true);
          }
          const command = store.value.command;
          completeStart();
          await start;
          results.push({ calls, preserved: store.value.command === command });
          effects.dispose();
        }
      }
      return results;
    });
    expect(results).toEqual(Array.from({ length: 4 }, () => ({ calls: [["run_selected_plan", "vacuum.synthetic"]], preserved: true })));
  });
  test("ends Starting when a managed service returns at the end of its run", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore(initial);
      const calls = [];
      let finish;
      const effects = new EffectController(store, {
        catalog: async () => [initial.resources.entry],
        history: async () => initial.resources.history.value,
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => initial.resources.plans.value,
        service: async (domain, service) => {
          calls.push(service);
          await new Promise((resolve) => { finish = resolve; });
        },
        dispose() {},
      });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      const phases = [];
      try {
        for (const action of ["run-plan", "clean-rooms"]) {
          await effects.refreshCatalog(true);
          const room = initial.resources.plans.value.rooms[0];
          store.patch({ selection: { ...store.value.selection, roomSettings: [{ roomId: room.roomId, cleaningMode: "vacuum", coverageSetting: "quick" }] } });
          const run = effects.executeAction(action);
          phases.push(store.value.command);
          finish();
          await run;
          phases.push(store.value.command);
        }
        return { calls, phases };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ calls: ["run_selected_plan", "clean_room_sequence"], phases: ["starting", "idle", "starting", "idle"] });
  });
  test("resumes a paused managed task with the resume-only command", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("paused");
      const store = new WorkspaceStore({ ...initial, managedLock: true });
      const calls = [];
      const effects = new EffectController(store, {
        catalog: async () => [{ ...initial.resources.entry, runnerLocked: true, activePlan: true }],
        history: async () => initial.resources.history.value,
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => initial.resources.plans.value,
        service: async (...args) => { calls.push(args); },
        dispose() {},
      });
      const projection = { host: initial.host, activity: "paused", batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" };
      effects.sync(projection);
      try {
        await effects.refreshCatalog(true);
        const ready = store.value;
        for (const blocked of [
          { ...ready, activity: "docked" },
          { ...ready, coherence: "verifying" },
          { ...ready, dataMode: "history" },
          { ...ready, resources: { ...ready.resources, entry: { ...ready.resources.entry, stopSettlePending: true } } },
        ]) {
          store.replace(blocked);
          await effects.executeAction("resume");
        }
        store.replace(ready);
        await effects.executeAction("resume");
        await effects.executeAction("resume");
        return { calls, command: store.value.command };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ calls: [["vacuum", "send_command", { command: "resume" }, "vacuum.synthetic"]], command: "starting" });
  });
  test("clears a deleted dirty plan identity only after successful deletion", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore(initial);
      let reject = true;
      let deleted = false;
      const effects = new EffectController(store, {
        catalog: async () => [initial.resources.entry],
        history: async () => initial.resources.history.value,
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => deleted ? { ...initial.resources.plans.value, selectedPlan: null, plans: [] } : initial.resources.plans.value,
        service: async () => { if (reject) throw new Error("Offline"); deleted = true; },
        dispose() {},
      });
      effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
      try {
        await effects.refreshCatalog(true);
        store.patch({ planDraft: { ...store.value.planDraft, name: "Keep on failure", dirty: true } });
        await effects.deletePlan();
        const failed = { id: store.value.planDraft.id, dirty: store.value.planDraft.dirty, name: store.value.planDraft.name };
        reject = false;
        await effects.deletePlan();
        return { failed, deleted: { selected: store.value.selection.planId, id: store.value.planDraft.id, dirty: store.value.planDraft.dirty, name: store.value.planDraft.name } };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ failed: { id: "daily", dirty: true, name: "Keep on failure" }, deleted: { selected: null, id: null, dirty: false, name: "" } });
  });
  for (const pruned of ["snapshot", "floor", "all", "navigation"]) {
    test(`reconciles the scene and floor when history prunes the selected ${pruned}`, async ({ page }) => {
      await loadEffectHarness(page);
      const result = await page.evaluate(async ({ pruned }) => {
        const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
        const initial = createGalleryState("ready");
        initial.resources.entry = { ...initial.resources.entry, deltaUrl: null };
        const store = new WorkspaceStore(initial);
        let history = initial.resources.history.value;
        const effects = new EffectController(store, {
          catalog: async () => [initial.resources.entry],
          history: async () => history,
          scene: async (url, revision) => ({ scene: { ...initial.resources.scene.value, marker: url }, revision, floorCoherent: true }),
          pose: async () => { throw new DOMException("Aborted", "AbortError"); },
          plans: async () => initial.resources.plans.value,
          dispose() {},
        });
        effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
        try {
          await effects.refreshCatalog(true);
          await effects.selectFloor("saved-1");
          const staleMarker = store.value.resources.scene.value.marker;
          history = { ...history, floors: pruned === "all" ? [] : (pruned === "floor" || pruned === "navigation") ? history.floors.filter((floor) => floor.id !== "saved-1") : history.floors.map((floor) => floor.id !== "saved-1" ? floor : { ...floor, snapshots: [{ ...floor.snapshots[0], id: "replacement", sceneUrl: "/replacement-history", revision: 4 }] }) };
          const recovery = effects.openWorkflow("history");
          if (pruned === "navigation") {
            await Promise.resolve();
            store.dispatch({ type: "open-workflow", workflow: "support" });
          }
          await recovery;
          return { staleMarker, marker: store.value.resources.scene.value?.marker, floor: store.value.selection.floorId, snapshot: store.value.selection.historyId, dataMode: store.value.dataMode, readOnly: store.value.floor.readOnly, label: store.value.floor.displayName, workflow: store.value.workflow, liveUrl: initial.resources.entry.sceneUrl };
        } finally { effects.dispose(); }
      }, { pruned });
      expect(result.staleMarker).toBe("/synthetic-history-saved");
      expect(result.marker).toBe(pruned === "snapshot" ? "/replacement-history" : result.liveUrl);
      expect(result.floor).toBe(pruned === "snapshot" ? "saved-1" : "current");
      expect(result.snapshot).toBe(pruned === "snapshot" ? "replacement" : null);
      expect(result.dataMode).toBe(pruned === "snapshot" ? "history" : "live");
      expect(result.readOnly).toBe(pruned === "snapshot");
      expect(result.workflow).toBe(pruned === "navigation" ? "support" : "history");
      if (pruned !== "snapshot") expect(result.label).not.toBe("Shed");
    });
  }
  test("browser Back cancels draft confirmation without leaving the editor", async ({ page }) => {
    await loadEffectHarness(page);
    await page.evaluate(async () => {
      const { WorkspaceStore, LayerHistoryController, createGalleryState } = await import("/plan-recovery-test.js");
      const store = new WorkspaceStore(createGalleryState("ready"));
      const layers = new LayerHistoryController(store);
      layers.start();
      store.dispatch({ type: "open-workflow", workflow: "plan" });
      store.dispatch({ type: "patch-plan-draft", patch: { name: "Keep on Back" } });
      window.__draftNavigation = { store, layers };
      history.back();
    });
    await expect.poll(() => page.evaluate(() => window.__draftNavigation.store.value.dialog)).toBe("discardDraft");
    await page.evaluate(() => history.back());
    await expect.poll(() => page.evaluate(() => window.__draftNavigation.store.value.dialog)).toBe(null);
    expect(await page.evaluate(() => {
      const { store, layers } = window.__draftNavigation;
      layers.dispose();
      return { workflow: store.value.workflow, name: store.value.planDraft.name, dirty: store.value.planDraft.dirty };
    })).toEqual({ workflow: "plan", name: "Keep on Back", dirty: true });
  });
  test("keeps desktop plan actions visible while long forms scroll", async ({ page }) => {
    const gallery = await loadGallery(page);
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, workflow: "plan", planDraft: { ...state.planDraft, dirty: true } });
    }, GALLERY_TAG);
    const save = gallery.getByRole("button", { name: "Save plan", exact: true });
    await expect(save).toBeInViewport({ ratio: 1 });
    const body = gallery.locator(".workflow-body");
    expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(gallery.getByRole("button", { name: "Delete plan", exact: true })).toBeInViewport();
  });

  test("distinguishes setup, robot problems and unavailable maps from localization", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "empty" });
    await expect(gallery.locator(".action-bar")).toContainText("Set up a Matic robot");
    await page.evaluate((tag) => document.querySelector(tag).setScenario("problem"), GALLERY_TAG);
    await expect(gallery.locator(".action-bar")).toContainText("Check the robot");
    await page.evaluate((tag) => document.querySelector(tag).setScenario("unsupported"), GALLERY_TAG);
    await expect(gallery.locator(".action-bar")).toContainText("Map unavailable");
    await expect(gallery.locator(".action-bar")).not.toContainText("Finding the map");
  });
  test("retries history reads and retains the selected saved floor label", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore(initial);
      let reads = 0;
      const effects = new EffectController(store, {
        catalog: async () => [initial.resources.entry],
        history: async () => { if (++reads === 1) throw new Error("Offline"); return initial.resources.history.value; },
        // This test isolates catalog recovery from optional scene/pose reads.
        scene: async () => { throw new DOMException("Aborted", "AbortError"); },
        pose: async () => { throw new DOMException("Aborted", "AbortError"); },
        plans: async () => initial.resources.plans.value,
        dispose() {},
      });
      try {
        effects.sync({
          host: initial.host, activity: initial.activity, batteryPercent: 92,
          robotLabel: "Synthetic", robots: initial.robots, language: "en",
          userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
        });
        await effects.refreshCatalog(true);
        // Catalog starts its optional reads concurrently; wait for the failed
        // history request to settle before using the screen's retry action.
        for (let i = 0; i < 20 && store.value.resources.history.status !== "error"; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
        const failed = store.value.resources.history.status;
        await effects.openWorkflow("history");
        const retried = { status: store.value.resources.history.status, reads };
        await effects.selectFloor("saved-1");
        await effects.openWorkflow("history");
        return { failed, retried, floor: store.value.selection.floorId, label: store.value.floor.displayName, reads };
      } finally { effects.dispose(); }
    });
    expect(result).toEqual({ failed: "error", retried: { status: "ready", reads: 2 }, floor: "saved-1", label: "Shed", reads: 3 });
  });
  test("protects plan drafts across nested selectors, back navigation and floor changes", async ({ page }) => {
    const gallery = await loadGallery(page);
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, workflow: "plan", planDraft: { ...state.planDraft, name: "Keep these edits", dirty: true } });
    }, GALLERY_TAG);
    const dialog = gallery.getByRole("dialog", { name: "Discard plan changes?" });
    const plan = gallery.getByRole("combobox", { name: "Saved plan", exact: true });
    await plan.selectOption("");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(plan).toHaveValue("daily");
    await expect(gallery.getByRole("textbox", { name: "Plan name" })).toHaveValue("Keep these edits");
    await gallery.getByRole("button", { name: "Back to all tasks" }).click();
    await expect(dialog).toBeVisible();
    await dialog.press("Escape");
    await expect(gallery.getByRole("textbox", { name: "Plan name" })).toHaveValue("Keep these edits");
    await gallery.getByRole("combobox", { name: "Choose floor" }).selectOption("saved-1");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(gallery.getByRole("combobox", { name: "Choose floor" })).toHaveValue("current");
    await gallery.getByRole("button", { name: "New plan", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await snapshot(page)).toMatchObject({ workflow: "plan", selection: { planId: null }, planDraft: { dirty: false } });
  });

  test("preserves dirty drafts on browser-layer dismissal and freezes forms during a save", async ({ page }) => {
    const gallery = await loadGallery(page);
    await page.evaluate(async (tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      const { reduceWorkspace } = await import("/map_studio_v4/index.js");
      element.replaceWorkspaceState(reduceWorkspace({ ...state, workflow: "plan", planDraft: { ...state.planDraft, dirty: true } }, { type: "dismiss-top-layer" }));
    }, GALLERY_TAG);
    await expect(gallery.getByRole("dialog", { name: "Discard plan changes?" })).toBeVisible();
    await gallery.getByRole("button", { name: "Keep editing" }).click();
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), command: "pending" });
    }, GALLERY_TAG);
    await expect(gallery.getByRole("textbox", { name: "Plan name" })).toBeDisabled();
    await expect(gallery.getByRole("combobox", { name: "Saved plan", exact: true })).toBeDisabled();
    await expect(gallery.getByRole("combobox", { name: "Cleaning system for Kitchen", exact: true })).toBeDisabled();
  });
  test("preserves plan edits after a failed or blocked save and allows retry", async ({ page }) => {
    await loadEffectHarness(page);
    const result = await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState } = await import("/plan-recovery-test.js");
      const initial = createGalleryState("ready");
      const store = new WorkspaceStore(initial);
      let reject = true;
      let writes = 0;
      let reloads = 0;
      const effects = new EffectController(store, {
        service: async () => { writes += 1; if (reject) throw new Error("Unavailable"); },
        dispose() {},
      });
      effects.sync({
        host: initial.host, activity: initial.activity, batteryPercent: 92,
        robotLabel: "Synthetic", robots: initial.robots, language: "en",
        userKey: "test", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic",
      });
      const draft = { ...initial.planDraft, name: "Unsaved changes", dirty: true };
      store.patch({ planDraft: draft });
      effects.loadPlans = async () => {
        reloads += 1;
        store.patch({ planDraft: initial.planDraft });
      };
      try {
        await effects.savePlan();
        const failure = { draft: store.value.planDraft, command: store.value.command, reloads };
        store.patch({ command: "pending" });
        await effects.savePlan();
        const blocked = { draft: store.value.planDraft, writes, reloads };
        store.patch({ command: "failed" });
        reject = false;
        await effects.savePlan();
        const retry = { command: store.value.command, writes, reloads };
        return { draft, failure, blocked, retry };
      } finally { effects.dispose(); }
    });
    expect(result.failure).toEqual({ draft: result.draft, command: "failed", reloads: 0 });
    expect(result.blocked).toEqual({ draft: result.draft, writes: 1, reloads: 0 });
    expect(result.retry).toEqual({ command: "idle", writes: 2, reloads: 1 });
  });

  test("history exposes keyboard navigation buttons and meaningful timeline values", async ({ page, browserName }) => {
    const gallery = await loadGallery(page, { scenario: "history" });
    const floors = gallery.getByRole("group", { name: "Mapped floors" });
    const current = floors.getByRole("button", { name: "House Live" });
    const saved = floors.getByRole("button", { name: "Shed Read only" });
    await current.focus();
    // Safari's default keyboard preference uses Option-Tab for native buttons.
    await current.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(saved).toBeFocused();
    await expect(saved).toHaveAttribute("aria-current", "true");
    const timeline = gallery.getByRole("slider", { name: "Map timeline" });
    await expect(timeline).toHaveAttribute("aria-valuetext", /2026/);
    await expect(gallery.getByRole("button", { name: "Return to current floor Current" })).toBeVisible();
    await saved.press("Enter");
    expect((await snapshot(page)).selection.floorId).toBe("saved-1");
  });
  test("registers the v0.4 panel and gallery without replacing v0.3 tags", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });

    expect(await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      await customElements.whenDefined("matic-map-studio-gallery-v0-4-0");
      return {
        panelV4: Boolean(customElements.get("matic-map-panel-v0-4-0")),
        galleryV4: Boolean(customElements.get("matic-map-studio-gallery-v0-4-0")),
        panelV3: Boolean(customElements.get("matic-map-panel-v0-3-1")),
      };
    })).toEqual({ panelV4: true, galleryV4: true, panelV3: false });
  });

  test("registers isolated constructors for successive content-addressed builds", async ({ page }) => {
    await page.goto("/");
    const tags = await page.evaluate(async () => {
      const first = await import("/matic_robot/0.4.0b1-aaaaaaaaaaaa/map-studio-v4/index.js");
      const second = await import("/matic_robot/0.4.0b1-bbbbbbbbbbbb/map-studio-v4/index.js");
      return [first.MATIC_MAP_PANEL_TAG, second.MATIC_MAP_PANEL_TAG];
    });
    expect(tags).toEqual([
      "matic-map-panel-v0-4-0-aaaaaaaaaaaa",
      "matic-map-panel-v0-4-0-bbbbbbbbbbbb",
    ]);
    expect(await page.evaluate((names) => names.every((name) => Boolean(customElements.get(name))), tags))
      .toBe(true);
  });

  test("rebuilds the live workspace after a cold browser reload", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto("/map-studio-v4-audit");
    const gallery = page.locator(GALLERY_TAG);
    await expect(gallery).toBeVisible();
    await expect(gallery.getByRole("heading", { name: "What should the robot clean?" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "One-time clean" })).toBeVisible();

    await page.reload();
    const reloaded = page.locator(GALLERY_TAG);
    await expect(reloaded).toBeVisible();
    await expect(reloaded.getByRole("heading", { name: "What should the robot clean?" })).toBeVisible();
    await expect(reloaded.getByRole("button", { name: "One-time clean" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("disposes polling on unload and reattaches with fresh controllers", async ({ page }) => {
    const scene = syntheticScene("Room", 10);
    let catalogRequests = 0;
    let sceneRequests = 0;
    let poseRequests = 0;
    const entry = {
      entry_id: "synthetic-entry",
      scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
      pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
      history_url: "/api/matic_robot/slam_history/synthetic-entry",
      areas_url: "/api/matic_robot/areas/synthetic-entry",
      plans_url: "/api/matic_robot/plans/synthetic-entry",
      map_revision: 1,
      map_floor_coherent: true,
      map_session_verified: true,
      map_session_key: "a".repeat(64),
      runner_locked: false,
      stop_settle_pending: false,
      active_plan: false,
      native_reconciliation_pending: false,
      native_session_active: false,
      map_complete: true,
      map_truncated: false,
      selected_floor_ordinal: 1,
      map_floor_ordinal: 1,
      history_count: 0,
      history_floor_count: 1,
      map_health: "ready",
      stream_state: "connected",
      stream_failures: 0,
    };
    await page.route("**/api/matic_robot/slam_entries", (route) => {
      catalogRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: [entry] }),
      });
    });
    await page.route("**/api/matic_robot/slam_scene/synthetic-entry", (route) => {
      sceneRequests += 1;
      return route.fulfill({
        status: 200,
        body: scene,
        headers: {
          "Content-Type": "application/vnd.matic.slam-scene",
          "X-Matic-Revision": "1",
          "X-Matic-Floor-Coherent": "1",
        },
      });
    });
    await page.route("**/api/matic_robot/slam_pose/synthetic-entry", (route) => {
      poseRequests += 1;
      // Keep the first request open long enough for the one-second polling
      // tick to queue a retry. Removing the panel must abort that request and
      // clear the queued retry instead of issuing a pose read while detached.
      const response = {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          position: null,
          source: "current_area",
          revision: 1,
          pose_revision: poseRequests,
          map_floor_coherent: true,
          pose_freshness: "live",
          map_session_key: "a".repeat(64),
        }),
      };
      if (poseRequests === 1) {
        return new Promise((resolve) => {
          setTimeout(() => {
            void route.fulfill(response).catch(() => {});
            resolve();
          }, 1_500);
        });
      }
      return route.fulfill(response);
    });
    await page.route("**/api/matic_robot/slam_history/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entry_id: "synthetic-entry",
        live_available: true,
        floors: [
          { id: "current", active: true, read_only: false, live_available: true, snapshots: [] },
          {
            id: "saved-floor",
            active: false,
            read_only: true,
            live_available: false,
            label: "Saved floor",
            ordinal: 2,
            snapshots: [{
              id: "saved-snapshot",
              created_at: "2026-08-29T14:00:00Z",
              revision: 1,
              point_count: 4,
              scene_url: "/synthetic-history-saved",
            }],
          },
        ],
      }),
    }));
    await page.route("**/synthetic-history-saved", (route) => route.fulfill({
      status: 200,
      body: scene,
      headers: {
        "Content-Type": "application/vnd.matic.slam-scene",
        "X-Matic-Revision": "1",
        "X-Matic-Floor-Coherent": "1",
      },
    }));

    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        fetchWithAuth: (path, init) => fetch(path, init),
      };
      document.body.append(panel);
      window.__lifecyclePanel = panel;
    });

    await expect.poll(async () => page.evaluate(() => {
      const state = window.__lifecyclePanel.getWorkspaceSnapshot();
      return { coherence: state.coherence, scene: state.resources.scene.status };
    })).toEqual({ coherence: "current", scene: "ready" });
    const mounted = { catalogRequests, sceneRequests, poseRequests };

    await page.evaluate(() => window.__lifecyclePanel.remove());
    // Allow disconnectedCallback to abort the current requests and clear both
    // polling timers before checking that detached panels stay completely quiet.
    await page.waitForTimeout(1_200);
    const detached = { catalogRequests, sceneRequests, poseRequests };
    expect(detached).toEqual(mounted);

    await page.evaluate(() => document.body.append(window.__lifecyclePanel));
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__lifecyclePanel.getWorkspaceSnapshot();
      return {
        coherence: state.coherence,
        scene: state.resources.scene.status,
      };
    })).toMatchObject({ coherence: "current", scene: "ready" });
    // A retained scene can already be ready while the fresh controllers are
    // starting their reads. Wait for each request instead of treating that
    // retained render as proof that every asynchronous read has started.
    await expect.poll(() => catalogRequests).toBeGreaterThan(mounted.catalogRequests);
    await expect.poll(() => sceneRequests).toBeGreaterThan(mounted.sceneRequests);
    await expect.poll(() => poseRequests).toBeGreaterThan(mounted.poseRequests);

    await page.evaluate(() => {
      const shell = window.__lifecyclePanel.shadowRoot.querySelector("matic-map-shell-v4");
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "open-workflow", workflow: "rooms" },
        bubbles: true,
        composed: true,
      }));
    });
    await expect.poll(async () => page.evaluate(() =>
      window.__lifecyclePanel.getWorkspaceSnapshot().workflow)).toBe("rooms");

    await page.evaluate(() => {
      const shell = window.__lifecyclePanel.shadowRoot.querySelector("matic-map-shell-v4");
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-floor", floorId: "saved-floor" },
        bubbles: true,
        composed: true,
      }));
    });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__lifecyclePanel.getWorkspaceSnapshot();
      return {
        dataMode: state.dataMode,
        floorId: state.selection.floorId,
        workflow: state.workflow,
        scene: state.resources.scene.status,
      };
    })).toEqual({ dataMode: "history", floorId: "saved-floor", workflow: "none", scene: "ready" });
    const historical = { catalogRequests, sceneRequests, poseRequests };
    await page.evaluate(() => window.__lifecyclePanel.remove());
    await page.waitForTimeout(1_200);
    expect({ catalogRequests, sceneRequests, poseRequests }).toEqual(historical);
    await page.evaluate(() => document.body.append(window.__lifecyclePanel));
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__lifecyclePanel.getWorkspaceSnapshot();
      return {
        dataMode: state.dataMode,
        floorId: state.selection.floorId,
        scene: state.resources.scene.status,
      };
    })).toEqual({ dataMode: "history", floorId: "saved-floor", scene: "ready" });
    expect(catalogRequests).toBeGreaterThan(historical.catalogRequests);
    expect(sceneRequests).toBe(historical.sceneRequests);
    expect(poseRequests).toBe(historical.poseRequests);

    await page.evaluate(() => window.__lifecyclePanel.remove());
    const beforeOfflineReattach = { catalogRequests, sceneRequests, poseRequests };
    // Update the HA projection while the element is detached, then reattach it
    // synchronously so connectedCallback must use current properties rather
    // than the stale connected projection from its previous mount.
    await page.evaluate(() => {
      const panel = window.__lifecyclePanel;
      panel.hass = { ...panel.hass, connected: false };
      document.body.append(panel);
    });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__lifecyclePanel.getWorkspaceSnapshot();
      return { connected: state.host.connected, coherence: state.coherence };
    })).toEqual({ connected: false, coherence: "degraded" });
    await page.waitForTimeout(1_200);
    expect({ catalogRequests, sceneRequests, poseRequests }).toEqual(beforeOfflineReattach);
    await page.evaluate(() => window.__lifecyclePanel.remove());
  });

  test("projects the meter-space robot pose onto the scene center", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    const overlay = gallery.locator("matic-map-canvas-v4 .overlay-canvas");

    // Report the measured centroid instead of a bare boolean. "The marker was
    // never painted" and "the marker landed off centre" are different faults
    // that a true/false poll renders identically, which makes a failure here
    // impossible to diagnose from CI logs alone.
    let measured;
    await expect.poll(async () => {
      measured = await overlay.evaluate((canvas) => {
        const context = canvas.getContext("2d");
        if (!context) return { painted: false, reason: "no 2d context" };
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const points = [];
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            const offset = (y * canvas.width + x) * 4;
            if (pixels.data[offset] === 6
              && pixels.data[offset + 1] === 120
              && pixels.data[offset + 2] === 206
              && pixels.data[offset + 3] > 0) points.push([x, y]);
          }
        }
        const measured = {
          painted: points.length > 0,
          samples: points.length,
          canvas: `${canvas.width}x${canvas.height}`,
          dpr: window.devicePixelRatio,
        };
        if (!points.length) return { ...measured, reason: "no marker pixels" };
        const x = points.reduce((sum, point) => sum + point[0], 0) / points.length;
        const y = points.reduce((sum, point) => sum + point[1], 0) / points.length;
        // Allow one CSS pixel rather than one device pixel. The overlay is
        // sized to an odd number of device pixels (a 606.5 CSS-pixel viewport
        // at ratio 2), so the true centre falls on a half pixel while the
        // symmetric marker rasterises onto a whole one -- a structural ~1px
        // offset before any antialiasing. WebKit's arc antialiasing then
        // differs by a fraction of a pixel between platforms, which is enough
        // to cross a one-device-pixel bound. The meter-versus-cell conversion
        // this guards would be wrong by far more than a pixel.
        const tolerance = Math.max(1, window.devicePixelRatio || 1);
        return {
          ...measured,
          tolerance,
          offsetX: Math.round((x - canvas.width / 2) * 100) / 100,
          offsetY: Math.round((y - canvas.height / 2) * 100) / 100,
          centered: Math.abs(x - canvas.width / 2) <= tolerance
            && Math.abs(y - canvas.height / 2) <= tolerance,
        };
      });
      return measured.painted;
    }).toBe(true);
    expect(measured, `pose projection ${JSON.stringify(measured)}`)
      .toMatchObject({ centered: true });
  });

  test("fits the complete 3D scene inside the perspective viewport", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    const map = gallery.locator("matic-map-canvas-v4");
    const window = gallery.locator("matic-map-canvas-v4 .scene-window");

    const bounds = await window.boundingBox();
    expect(bounds).not.toBeNull();
    const aspect = bounds.width / bounds.height;
    const halfVertical = (Math.PI / 3.15) / 2;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
    const sceneRadius = Math.hypot(180 * 0.05, 140 * 0.05) / 2;
    const expectedFit = sceneRadius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.08;

    await expect.poll(async () => map.evaluate((element) => element.rendererDiagnostics()))
      .toMatchObject({ fitActive: true });
    const diagnostics = await map.evaluate((element) => element.rendererDiagnostics());
    expect(diagnostics.fitDistance).toBeCloseTo(expectedFit, 4);
    expect(diagnostics.cameraDistance).toBeCloseTo(diagnostics.fitDistance, 6);
  });

  test("keeps an off-screen room polygon intact while zooming", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      const scene = state.resources.scene.value;
      element.replaceWorkspaceState({
        ...state,
        resources: {
          ...state.resources,
          scene: {
            ...state.resources.scene,
            value: {
              ...scene,
              metadata: {
                ...scene.metadata,
                rooms: [{
                  id: "whole-floor",
                  name: "Whole floor",
                  boundary: [[0, 0], [180, 0], [180, 140], [0, 140]],
                  center: [90, 70],
                }],
              },
            },
          },
        },
      });
    }, GALLERY_TAG);

    await gallery.getByRole("button", { name: "2D", exact: true }).click();
    await gallery.getByRole("button", { name: "Floor plan", exact: true }).click();
    await gallery.getByRole("button", { name: "Room names", exact: true }).click();
    // Double-click the scene itself: the map root now also hosts the control
    // rail and dock, so its centre is not guaranteed to be bare map.
    const scene = gallery.locator("matic-map-canvas-v4 .scene-window");
    const box = await scene.boundingBox();
    expect(box).not.toBeNull();
    for (let index = 0; index < 4; index += 1) {
      await scene.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
    }

    const overlay = gallery.locator("matic-map-canvas-v4 .overlay-canvas");
    await expect.poll(async () => overlay.evaluate((canvas) => {
      const context = canvas.getContext("2d");
      if (!context) return false;
      const samples = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
      return samples.every(([x, y]) => context.getImageData(
        Math.floor(canvas.width * x),
        Math.floor(canvas.height * y),
        1,
        1,
      ).data[3] > 0);
    })).toBe(true);
  });

  test("upgrades a pre-existing shell without a blank first render", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.evaluate(() => {
      document.body.innerHTML = "<matic-map-shell-v4></matic-map-shell-v4>";
    });
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });

    await expect(page.locator("matic-map-shell-v4")).toContainText("Matic Map");
    expect(errors).toEqual([]);
  });

  test("rejects stale coherence generations and fails closed", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      const machine = new module.CoherenceMachine();
      const first = machine.begin("entry", "floor-a", "mission-a", 1);
      const second = machine.begin("entry", "floor-b", "mission-b", 2);
      const advanced = machine.advance(second, 3);
      const ready = module.createGalleryState("ready");
      const degraded = { ...ready, coherence: "degraded" };
      const transition = module.createGalleryState("transition");
      return {
        firstRejected: !machine.accepts(first),
        secondSuperseded: !machine.accepts(second),
        advancedAccepted: advanced ? machine.accepts(advanced) : false,
        ready: {
          show: module.canShowLiveMap(ready),
          pose: module.canShowExactPose(ready),
          edit: module.canEditCoordinates(ready),
          motion: module.canStartMotion(ready),
        },
        degraded: {
          show: module.canShowLiveMap(degraded),
          pose: module.canShowExactPose(degraded),
          edit: module.canEditCoordinates(degraded),
          motion: module.canStartMotion(degraded),
        },
        transition: {
          show: module.canShowLiveMap(transition),
          pose: module.canShowExactPose(transition),
          edit: module.canEditCoordinates(transition),
          motion: module.canStartMotion(transition),
        },
      };
    });

    expect(result).toEqual({
      firstRejected: true,
      secondSuperseded: true,
      advancedAccepted: true,
      ready: { show: true, pose: true, edit: true, motion: true },
      degraded: { show: true, pose: true, edit: false, motion: false },
      transition: { show: false, pose: false, edit: false, motion: false },
    });
  });

  test("dismisses dialog, precision, expanded map, and workflow one layer at a time", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      let state = {
        ...module.createGalleryState("draw"),
        fullMap: true,
        precisionOpen: true,
        dialog: "discardDraft",
      };
      const layers = [];
      for (let index = 0; index < 4; index += 1) {
        state = module.reduceWorkspace(state, { type: "dismiss-top-layer" });
        layers.push({
          dialog: state.dialog,
          precision: state.precisionOpen,
          fullMap: state.fullMap,
          workflow: state.workflow,
        });
      }
      return layers;
    });

    expect(result).toEqual([
      { dialog: null, precision: true, fullMap: true, workflow: "draw" },
      { dialog: null, precision: false, fullMap: true, workflow: "draw" },
      { dialog: null, precision: false, fullMap: false, workflow: "draw" },
      { dialog: "discardDraft", precision: false, fullMap: false, workflow: "draw" },
    ]);
  });

  test("opens History without hiding the live map and preserves a chosen saved map", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      const live = module.createGalleryState("ready");
      const opened = module.reduceWorkspace(live, { type: "open-workflow", workflow: "history" });
      const saved = {
        ...opened,
        dataMode: "history",
        selection: { ...opened.selection, floorId: "saved-floor", historyId: "saved-map" },
      };
      const closed = module.reduceWorkspace(saved, { type: "dismiss-top-layer" });
      return {
        openedMode: opened.dataMode,
        openedWorkflow: opened.workflow,
        closedMode: closed.dataMode,
        closedWorkflow: closed.workflow,
        closedHistory: closed.selection.historyId,
      };
    });

    expect(result).toEqual({
      openedMode: "live",
      openedWorkflow: "history",
      closedMode: "history",
      closedWorkflow: "none",
      closedHistory: "saved-map",
    });
  });

  test("describes saved maps as saved and gives history-specific recovery copy", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history" });
    const scene = gallery.locator("matic-map-canvas-v4 .scene-window");
    await expect(scene).toHaveAttribute(
      "aria-label",
      "Saved read-only map for House. Live robot position is hidden.",
    );
    await expect(gallery.getByText("The current private map is not available.", { exact: true })).toHaveCount(0);

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        map: { ...state.map, available: false },
        resources: {
          ...state.resources,
          scene: { ...state.resources.scene, status: "loading", value: null, problem: null },
        },
      });
    }, GALLERY_TAG);
    await expect(gallery.locator(".map-message")).toContainText("Loading saved map");
    await expect(scene).toHaveAttribute("aria-label", "The saved map is loading.");

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        resources: {
          ...state.resources,
          scene: { ...state.resources.scene, status: "error", value: null, problem: "request-failed" },
        },
      });
    }, GALLERY_TAG);
    await expect(gallery.locator(".map-message")).toContainText("Saved map unavailable");
    await expect(gallery.locator(".map-message")).toContainText("Choose another snapshot or return to the live map.");
    await expect(scene).toHaveAttribute("aria-label", "This saved map is unavailable.");
  });

  test("keeps saved floors view-only and never opens cleaning workflows", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, workflow: "none" });
    }, GALLERY_TAG);

    await expect(gallery.getByRole("heading", { name: "Saved map is read only" })).toBeVisible();
    await expect(gallery).toContainText("Return to the live map below to choose rooms, run a plan, or draw a custom area.");
    await expect(gallery.getByRole("button", { name: "One-time clean" })).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Run a plan" })).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Clean a custom area" })).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Return to the live map" })).toBeVisible();

    const workflows = await page.evaluate(async (tag) => {
      const module = await import("/map_studio_v4/index.js");
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      return ["rooms", "plan", "draw", "areaReview"].map((workflow) =>
        module.reduceWorkspace(state, { type: "open-workflow", workflow }).workflow,
      );
    }, GALLERY_TAG);
    expect(workflows).toEqual(["none", "none", "none", "none"]);
  });

  test("uses accessible peek, half, and full mobile sheet detents", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    const sheet = gallery.locator(".mobile-sheet");
    // The cycle toggle is gone: two explicit step buttons that disable at the
    // ends, plus a live region that announces the detent that was reached.
    const showMore = gallery.getByRole("button", { name: "Show more of the map workspace" });
    const showLess = gallery.getByRole("button", { name: "Show less of the map workspace" });
    const live = gallery.locator(".root > .sr-only[aria-live=polite]");

    await expect(sheet).toHaveAttribute("data-detent", "half");
    await expect(gallery.getByRole("banner").getByText("Docked", { exact: true })).toHaveCount(0);
    await expect.poll(async () => gallery.locator(".scene-window").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const sheetBounds = element.getRootNode().host.getRootNode().querySelector(".mobile-sheet")?.getBoundingClientRect();
      return sheetBounds ? Math.abs(bounds.bottom - sheetBounds.top) : Number.POSITIVE_INFINITY;
    })).toBeLessThanOrEqual(1);
    await expect(showMore).toHaveAttribute("aria-controls", "sheet-body");
    await expect(showMore).not.toHaveAttribute("aria-disabled", "true");
    await expect(showLess).not.toHaveAttribute("aria-disabled", "true");
    await showMore.click();
    await expect(sheet).toHaveAttribute("data-detent", "full");
    await expect(showMore).toHaveAttribute("aria-disabled", "true");
    await expect(live).toContainText("Map workspace, full height");
    await showLess.click();
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await showLess.click();
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    await expect(showLess).toHaveAttribute("aria-disabled", "true");
    await expect(live).toContainText("Map workspace, peek height");
    await expect(gallery.locator("#sheet-body")).toBeHidden();
    await showMore.click();
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await expect(gallery.locator("#sheet-body")).toBeVisible();

    // Each workflow opens at its own default detent: a task performed on the
    // map starts at peek, a form starts at full.
    await page.evaluate(async (tag) => {
      const module = await import("/map_studio_v4/index.js");
      document.querySelector(tag).replaceWorkspaceState(module.createGalleryState("rooms"));
    }, GALLERY_TAG);
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    await page.evaluate(async (tag) => {
      const module = await import("/map_studio_v4/index.js");
      document.querySelector(tag).replaceWorkspaceState({ ...module.createGalleryState("ready"), workflow: "plan" });
    }, GALLERY_TAG);
    await expect(sheet).toHaveAttribute("data-detent", "full");
  });

  test("confirms destructive plan deletion and restores focus when cancelled", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      window.__mapStudioActions = [];
      element.addEventListener("matic-workspace-action", (event) => {
        window.__mapStudioActions.push(event.detail?.id);
      });
    }, GALLERY_TAG);
    await gallery.getByRole("button", { name: /^Run a plan/ }).click();
    const deletePlan = gallery.getByRole("button", { name: "Delete plan" });
    await expect(deletePlan).toBeVisible();
    await deletePlan.click();
    await expect(gallery.getByRole("dialog", { name: "Delete this plan?" })).toBeVisible();
    expect(await page.evaluate(() => window.__mapStudioActions)).toEqual([]);
    await gallery.getByRole("button", { name: "Cancel" }).click();
    await expect(deletePlan).toBeFocused();

    await deletePlan.click();
    await gallery.getByRole("dialog", { name: "Delete this plan?" })
      .getByRole("button", { name: "Delete plan", exact: true }).click();
    await expect(gallery.getByRole("dialog", { name: "Delete this plan?" })).toHaveCount(0);
    expect(await page.evaluate(() => window.__mapStudioActions)).toEqual(["delete-plan"]);

    await page.evaluate(async (tag) => {
      const module = await import("/map_studio_v4/index.js");
      const galleryElement = document.querySelector(tag);
      galleryElement.replaceWorkspaceState({
        ...module.createGalleryState("draw"),
        workflow: "areaReview",
      });
    }, GALLERY_TAG);
    const deleteArea = gallery.getByRole("button", { name: "Delete area" });
    await deleteArea.click();
    await gallery.getByRole("button", { name: "Cancel" }).click();
    await expect(deleteArea).toBeFocused();
  });

  test("restores focus after a cancelled dialog on a phone", async ({ page }) => {
    // The desktop inspector and the mobile sheet were both rendered, one hidden
    // with display:none, so #dialogLauncherFor's querySelector picked the hidden
    // copy on narrow and focus() silently did nothing. The wide equivalent of
    // this test passed throughout, because it never ran at this size.
    await page.setViewportSize({ width: 390, height: 844 });
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    await expect(gallery.locator(".mobile-sheet")).toBeVisible();

    await gallery.getByRole("button", { name: /^Run a plan/ }).click();
    // Exactly one panel: two meant the launcher lookup could pick the hidden one.
    await expect(gallery.locator("matic-map-workflow-v4")).toHaveCount(1);
    const deletePlan = gallery.getByRole("button", { name: "Delete plan" });
    await expect(deletePlan).toBeVisible();
    await deletePlan.click();
    await expect(gallery.getByRole("dialog", { name: "Delete this plan?" })).toBeVisible();
    await gallery.getByRole("button", { name: "Cancel" }).click();
    await expect(deletePlan).toBeFocused();
  });

  test("preserves Draw state through the workspace toggle and restores focus in Escape order", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    const gallery = await loadGallery(page, { scenario: "draw" });
    // Precision is a brush popover opened from the dock's Brush button; the
    // zoom stepper and the "400% · 0.20 m" chip no longer exist. Zoom is a
    // view concern handled by the map itself.
    const brushButton = gallery.getByRole("button", { name: /^Brush width, 0\.60 m/ });
    await expect(brushButton).toHaveAttribute("aria-haspopup", "dialog");
    await expect(brushButton).toHaveAttribute("aria-expanded", "false");
    await expect(gallery.getByLabel("Map zoom percent")).toHaveCount(0);
    await brushButton.click();
    await expect(brushButton).toHaveAttribute("aria-expanded", "true");
    const brush = gallery.getByLabel("Brush width in meters");
    await expect(brush).toBeVisible();
    await expect(gallery.getByRole("slider", { name: "Brush width slider" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: /Zoom in|Zoom out/ })).toHaveCount(0);
    await brush.fill("0.20");
    await brush.press("Tab");
    await expect.poll(async () => (await snapshot(page)).draw.brushMeters).toBe(0.2);
    await brush.press("Escape");
    await expect.poll(async () => (await snapshot(page)).precisionOpen).toBe(false);
    await expect(gallery.getByRole("button", { name: /^Brush width, 0\.20 m/ })).toBeFocused();

    const workspaceToggle = gallery.locator(".workspace-toggle");
    await expect(workspaceToggle).toHaveAccessibleName("Hide workspace");
    await workspaceToggle.click();
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await expect(gallery.locator(".inspector")).toBeHidden();
    await expect(workspaceToggle).toHaveAccessibleName("Show workspace");
    const precision = gallery.getByRole("button", { name: /^Brush width, 0\.20 m/ });
    await expect(precision).toBeVisible();
    await precision.click();
    await expect.poll(async () => (await snapshot(page)).precisionOpen).toBe(true);

    // Escape order: brush field -> Brush button -> expanded map.
    await gallery.getByLabel("Brush width in meters").press("Escape");
    await expect.poll(async () => (await snapshot(page)).precisionOpen).toBe(false);
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await expect(precision).toBeFocused();

    await precision.press("Escape");
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(false);
    await expect.poll(async () => (await snapshot(page)).draw).toMatchObject({
      brushMeters: 0.2,
      dirty: true,
      strokeCount: 3,
    });
    await expect(workspaceToggle).toBeFocused();
  });

  test("owns trackpad pinch over the map and keeps focal zoom bounded", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const map = gallery.locator(".map-root");
    const before = (await snapshot(page)).draw.zoomPercent;
    const modifierPrevented = await map.evaluate((element) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -120,
        clientX: 200,
        clientY: 200,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(modifierPrevented).toBe(true);
    await expect.poll(async () => (await snapshot(page)).draw.zoomPercent).toBeGreaterThan(before);
    const afterPinch = (await snapshot(page)).draw.zoomPercent;

    const wheelPrevented = await map.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -280,
        clientX: bounds.left + bounds.width * 0.3,
        clientY: bounds.top + bounds.height * 0.7,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(wheelPrevented).toBe(true);
    await expect.poll(async () => (await snapshot(page)).draw.zoomPercent).toBeGreaterThan(afterPinch);
    const origin = (await snapshot(page)).draw;
    expect(Math.abs(origin.zoomOriginX - 30)).toBeLessThan(0.2);
    expect(Math.abs(origin.zoomOriginY - 70)).toBeLessThan(0.2);
  });

  test("restores native trackpad pinch and twist", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const map = gallery.locator(".map-root");
    const before = await snapshot(page);

    const prevented = await map.evaluate((element) => {
      const start = new Event("gesturestart", { bubbles: true, cancelable: true });
      Object.assign(start, { scale: 1, rotation: 0, clientX: 260, clientY: 220 });
      element.dispatchEvent(start);
      const change = new Event("gesturechange", { bubbles: true, cancelable: true });
      Object.assign(change, { scale: 1.35, rotation: 28, clientX: 260, clientY: 220 });
      element.dispatchEvent(change);
      const end = new Event("gestureend", { bubbles: true, cancelable: true });
      Object.assign(end, { scale: 1.35, rotation: 28 });
      element.dispatchEvent(end);
      return start.defaultPrevented && change.defaultPrevented && end.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await expect.poll(async () => (await snapshot(page)).draw.zoomPercent)
      .toBeGreaterThan(before.draw.zoomPercent);
    await expect.poll(async () => (await snapshot(page)).cameras.top?.yaw ?? 0)
      .not.toBeCloseTo(before.cameras.top?.yaw ?? 0, 4);

  });

  test("separates trackpad pan, mouse-wheel zoom, pinch zoom, and pitch", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    const map = gallery.locator(".map-root");
    await map.focus();

    await map.dispatchEvent("wheel", { deltaX: 32, deltaY: 18, deltaMode: 0 });
    await expect.poll(async () => Boolean((await snapshot(page)).cameras.three)).toBe(true);
    const afterTrackpad = (await snapshot(page)).cameras.three;
    expect(Math.hypot(afterTrackpad.targetX, afterTrackpad.targetZ)).toBeGreaterThan(0.01);
    expect(afterTrackpad.zoom).toBeCloseTo(1, 2);

    await map.dispatchEvent("wheel", { deltaX: 0, deltaY: -120, deltaMode: 0 });
    const afterWheel = (await snapshot(page)).cameras.three;
    expect(afterWheel.zoom).toBeGreaterThan(afterTrackpad.zoom);

    await map.dispatchEvent("wheel", {
      deltaX: 0,
      deltaY: -20,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 240,
      clientY: 210,
    });
    const afterPinch = (await snapshot(page)).cameras.three;
    expect(afterPinch.zoom).toBeGreaterThan(afterWheel.zoom);

    await map.dispatchEvent("wheel", { deltaX: 0, deltaY: 24, deltaMode: 0, altKey: true });
    const afterPitch = (await snapshot(page)).cameras.three;
    expect(afterPitch.pitch).not.toBeCloseTo(afterPinch.pitch, 4);
  });

  test("supports mouse orbit, modifier pan, double-click zoom, and keyboard flight", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    const map = gallery.locator(".map-root");
    const bounds = await map.boundingBox();
    expect(bounds).not.toBeNull();
    const centerX = bounds.x + bounds.width * 0.45;
    const centerY = bounds.y + bounds.height * 0.48;

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 90, centerY + 45, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Boolean((await snapshot(page)).cameras.three)).toBe(true);
    const afterOrbit = (await snapshot(page)).cameras.three;
    expect(afterOrbit.yaw).not.toBeCloseTo(-Math.PI / 4, 3);
    expect(afterOrbit.pitch).not.toBeCloseTo(0.82, 3);

    await page.keyboard.down("Shift");
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 70, centerY - 35, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    const afterPan = (await snapshot(page)).cameras.three;
    expect(Math.hypot(
      afterPan.targetX - afterOrbit.targetX,
      afterPan.targetZ - afterOrbit.targetZ,
    )).toBeGreaterThan(0.01);
    expect(afterPan.yaw).toBeCloseTo(afterOrbit.yaw, 3);

    const zoomBeforeDoubleClick = afterPan.zoom;
    await page.mouse.dblclick(centerX, centerY);
    await expect.poll(async () => (await snapshot(page)).cameras.three.zoom)
      .toBeGreaterThan(zoomBeforeDoubleClick);

    await map.focus();
    const beforeKeys = (await snapshot(page)).cameras.three;
    await page.keyboard.press("w");
    await page.keyboard.press("q");
    const afterKeys = (await snapshot(page)).cameras.three;
    expect(Math.hypot(
      afterKeys.targetX - beforeKeys.targetX,
      afterKeys.targetZ - beforeKeys.targetZ,
    )).toBeGreaterThan(0.01);
    expect(afterKeys.yaw).not.toBeCloseTo(beforeKeys.yaw, 4);
  });

  test("makes every navigation model discoverable without covering the map permanently", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    // Help is a non-modal dialog anchored to the rail, not a second
    // complementary landmark: the workspace aside is the only one.
    await expect(gallery.getByRole("complementary")).toHaveCount(1);
    await expect(gallery.getByRole("complementary", { name: "Map workspace" })).toBeVisible();
    const help = gallery.getByRole("button", { name: "How to move the map" });
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await expect(help).toHaveAttribute("aria-controls", "navigation-help");
    await help.click();
    await expect(help).toHaveAttribute("aria-expanded", "true");
    const panel = gallery.getByRole("dialog", { name: "How to move the map" });
    await expect(panel).toHaveAttribute("aria-modal", "false");
    await expect(panel).toContainText("Scroll to pan · pinch to zoom · twist to rotate");
    await expect(panel).toContainText("Shift, middle, or right drag to pan");
    await expect(panel).toContainText("WASD to move · Q/E or arrows to orbit");
    await expect(gallery.getByRole("complementary")).toHaveCount(1);
    const close = panel.getByRole("button", { name: "Close" });
    await expect(close).toBeFocused();
    await close.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(help).toBeFocused();
    await expect(help).toHaveAttribute("aria-expanded", "false");
  });

  test("keeps workflow navigation and Stop together in the inspector", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "cleaning" });
    await gallery.getByRole("button", { name: /^One-time clean/ }).click();
    const inspector = gallery.locator(".inspector");
    await expect(inspector.getByRole("button", { name: "Back to all tasks" })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Back to all tasks" })).toHaveText("All tasks");
    const stop = inspector.locator(".status-strip").getByRole("button", { name: "Stop cleaning" });
    await expect(stop).toBeVisible();
    await expect(stop).toHaveText("Stop");
    await expect(inspector.locator(".action-bar").getByRole("button", { name: /Stop/ })).toHaveCount(0);
    await expect(gallery.getByRole("banner").getByText("Cleaning", { exact: true })).toHaveCount(0);
  });

  test("uses one ordered room list for plan selection and per-room settings", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: /^Run a plan/ }).click();
    const inspector = gallery.locator(".inspector");
    // Groups are named by a visible h3 (aria-labelledby), not a bare
    // aria-label, so the outline is readable by sighted users as well.
    await expect(inspector.getByRole("heading", { name: "Plan rooms", level: 3 })).toBeVisible();
    const list = inspector.getByLabel("Plan rooms");
    await expect(list).toHaveCount(1);
    await expect(list).toHaveAttribute("aria-labelledby", "plan-rooms-heading");
    await expect(inspector.getByLabel("Room order and settings")).toHaveCount(0);
    await expect(list.locator(".room")).toHaveCount(4);
    await expect(list.locator('.room[data-selected="true"]')).toHaveCount(3);
    await expect(list.getByLabel("Cleaning system")).toHaveCount(3);
    await expect(inspector.locator("details")).toHaveCount(0);
    // Completion options now FOLLOW the room list: choose what to clean first,
    // then how the run should end.
    await expect(inspector.getByRole("heading", { name: "When a run ends", level: 3 })).toBeVisible();
    const options = inspector.locator(".plan-options");
    await expect(options).toHaveAttribute("role", "group");
    expect(await options.evaluate((element) =>
      Boolean(element.compareDocumentPosition(element.parentElement.querySelector('[aria-labelledby="plan-rooms-heading"]')) & Node.DOCUMENT_POSITION_PRECEDING),
    )).toBe(true);
  });

  test("keeps the saved-plan selector aligned with the loaded draft", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: /^Run a plan/ }).click();
    const selector = gallery.getByLabel("Saved plan");
    await expect(selector).toHaveValue("daily");
    await expect(selector.locator("option:checked")).toHaveText("Daily clean");
    await expect(selector.locator('option[value="daily"]')).toHaveAttribute("selected", "");

    await page.evaluate(async (tag) => {
      const module = await import("/map_studio_v4/index.js");
      const element = document.querySelector(tag);
      const current = element.getWorkspaceSnapshot();
      const ready = module.createGalleryState("ready");
      element.replaceWorkspaceState({
        ...current,
        resources: {
          ...current.resources,
          plans: { status: "loading", value: null, problem: null },
        },
      });
      await element.updateComplete;
      element.replaceWorkspaceState({
        ...current,
        resources: { ...current.resources, plans: ready.resources.plans },
      });
    }, GALLERY_TAG);
    await expect(selector).toHaveValue("daily");
    await expect(selector.locator("option:checked")).toHaveText("Daily clean");
  });

  test("uses task-specific loading, empty, and error messages", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        workflow: "plan",
        resources: { ...state.resources, plans: { status: "loading", value: null, problem: null } },
      });
    }, GALLERY_TAG);
    await expect(gallery.getByRole("status")).toContainText("Loading rooms and plans…");

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        workflow: "draw",
        resources: { ...state.resources, areas: { status: "empty", value: null, problem: null } },
      });
    }, GALLERY_TAG);
    await expect(gallery.getByText("No saved areas yet. Draw one on the map.", { exact: true })).toBeVisible();

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        workflow: "history",
        resources: { ...state.resources, history: { status: "error", value: null, problem: "request-failed" } },
      });
    }, GALLERY_TAG);
    await expect(gallery.getByRole("alert")).toContainText("Map history is unavailable right now. Try again shortly.");
  });

  test("keeps a saved-area destination intact through cancel and discard", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, resources: { ...state.resources, areas: { ...state.resources.areas, value: { ...state.resources.areas.value, areas: [...state.resources.areas.value.areas, { ...state.resources.areas.value.areas[0], id: "other-area", name: "Other area" }] } } } });
    }, GALLERY_TAG);
    const target = gallery.getByRole("button", { name: "Other area Ready", exact: true });
    await target.click();
    const dialog = gallery.getByRole("dialog", { name: "Discard area changes?" });
    await expect(dialog).toBeVisible();
    expect(await snapshot(page)).toMatchObject({ workflow: "draw", selection: { areaId: "entryway" }, draw: { dirty: true } });
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    expect(await snapshot(page)).toMatchObject({ workflow: "draw", selection: { areaId: "entryway" }, draw: { dirty: true } });
    await target.click();
    await dialog.getByRole("button", { name: "Discard", exact: true }).click();
    await expect.poll(async () => {
      const state = await snapshot(page);
      return { workflow: state.workflow, areaId: state.selection.areaId, dialog: state.dialog };
    }).toEqual({ workflow: "areaReview", areaId: "other-area", dialog: null });
  });

  test("asks before switching floors with an unsaved custom-area draft", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    const gallery = await loadGallery(page, { scenario: "draw" });
    const floor = gallery.getByLabel("Choose floor", { exact: true });
    await floor.selectOption("saved-1");

    await expect(gallery.getByRole("dialog", { name: "Discard area changes?" })).toBeVisible();
    expect(await snapshot(page)).toMatchObject({
      dataMode: "live",
      workflow: "draw",
      floor: { readOnly: false },
      draw: { dirty: true },
    });
    await gallery.getByRole("dialog", { name: "Discard area changes?" }).press("Escape");
    await expect(gallery.getByRole("dialog", { name: "Discard area changes?" })).toHaveCount(0);
    await expect(floor).toHaveValue("current");
    expect(await snapshot(page)).toMatchObject({
      dataMode: "live",
      workflow: "draw",
      draw: { dirty: true },
    });

    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        workflow: "areaReview",
        draw: { ...state.draw, dirty: false },
        areaDraft: { ...state.areaDraft, dirty: true },
      });
    }, GALLERY_TAG);
    await gallery.getByRole("button", { name: "Edit outline" }).click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
    await floor.selectOption("saved-1");
    await expect(gallery.getByRole("dialog", { name: "Discard area changes?" })).toBeVisible();
    await gallery.getByRole("button", { name: "Keep editing" }).click();
    await expect(floor).toHaveValue("current");
    expect(await snapshot(page)).toMatchObject({
      dataMode: "live",
      workflow: "draw",
      areaDraft: { dirty: true },
    });
  });

  test("falls back to selection copy when the Clipboard API rejects an HTTP origin", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate((tag) => {
      const element = document.querySelector(tag);
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({ ...state, workflow: "support" });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
      });
      window.__legacyCopies = [];
      document.execCommand = (command) => {
        const textarea = document.querySelector('textarea[aria-hidden="true"]');
        window.__legacyCopies.push({ command, value: textarea?.value || "" });
        return command === "copy";
      };
    }, GALLERY_TAG);
    const copyButton = gallery.getByRole("button", { name: "Copy summary" });
    await copyButton.click();
    await expect(gallery.getByRole("status")).toHaveText("Copied");
    await expect(copyButton).toBeFocused();
    expect(await page.evaluate(() => window.__legacyCopies)).toEqual([{
      command: "copy",
      value: expect.stringContaining("Connection: Connected"),
    }]);
    expect(await page.evaluate(() => ({
      temporaryTextareas: document.querySelectorAll('textarea[aria-hidden="true"]').length,
      containsPrivateNames: window.__legacyCopies[0].value.includes("House")
        || window.__legacyCopies[0].value.includes("Kitchen"),
    }))).toEqual({ temporaryTextareas: 0, containsPrivateNames: false });
  });

  test("opens Custom areas on a blank draft and preserves only an explicit edit", async ({ page }) => {
    const scene = syntheticScene("Room", 10);
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async (sceneBytes) => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const entry = {
        entry_id: "synthetic-entry",
        scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
        pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
        history_url: "/api/matic_robot/slam_history/synthetic-entry",
        areas_url: "/api/matic_robot/areas/synthetic-entry",
        plans_url: "/api/matic_robot/plans/synthetic-entry",
        map_revision: 1,
        map_floor_coherent: true,
        map_session_verified: true,
        map_session_key: "a".repeat(64),
        runner_locked: false,
        stop_settle_pending: false,
        active_plan: false,
        native_reconciliation_pending: false,
        native_session_active: false,
        map_complete: true,
        map_truncated: false,
        selected_floor_ordinal: 1,
        map_floor_ordinal: 1,
        history_count: 0,
        history_floor_count: 1,
        map_health: "ready",
        stream_state: "connected",
        stream_failures: 0,
      };
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        fetchWithAuth: async (path) => {
          if (path === "/api/matic_robot/slam_entries") {
            return new Response(JSON.stringify({ entries: [entry] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (path === entry.scene_url) {
            return new Response(new Uint8Array(sceneBytes), {
              status: 200,
              headers: {
                "Content-Type": "application/vnd.matic.slam-scene",
                "X-Matic-Revision": "1",
                "X-Matic-Floor-Coherent": "1",
              },
            });
          }
          if (path === entry.pose_url) {
            return new Response(JSON.stringify({
              position: null,
              source: "current_area",
              revision: 1,
              pose_revision: 1,
              map_floor_coherent: true,
              pose_freshness: "live",
              map_session_key: "a".repeat(64),
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (path === entry.history_url) {
            return new Response(JSON.stringify({
              entry_id: "synthetic-entry",
              live_available: true,
              floors: [{ id: "current", active: true, read_only: false, live_available: true, snapshots: [] }],
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (path === entry.areas_url) {
            return new Response(JSON.stringify({
              scene_url: entry.scene_url,
              rooms: [{
                room_id: "room-1",
                name: "Room",
                boundary: [[0, 0], [4, 0], [4, 4], [0, 4]],
              }],
              areas: [{
                id: "saved-area",
                name: "Saved area",
                circles: [{ x: 1, y: 1, radius: 0.3 }],
                cleaning_mode: "vacuum",
                coverage_setting: "standard",
                status: "current",
                can_rebind: false,
              }],
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response("", { status: 404 });
        },
      };
      document.body.append(panel);
      window.__areaPanel = panel;
    }, [...scene]);
    await expect.poll(async () => page.evaluate(() =>
      window.__areaPanel.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");

    const dispatch = (detail) => page.evaluate((intent) => {
      const shell = window.__areaPanel.shadowRoot.querySelector("matic-map-shell-v4");
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: intent,
        bubbles: true,
        composed: true,
      }));
    }, detail);

    await dispatch({ type: "open-workflow", workflow: "draw" });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__areaPanel.getWorkspaceSnapshot();
      return {
        status: state.resources.areas.status,
        areaId: state.selection.areaId,
        circles: state.draw.circles.length,
      };
    })).toEqual({ status: "ready", areaId: null, circles: 0 });

    await dispatch({ type: "select-area", areaId: "saved-area" });
    await dispatch({ type: "open-workflow", workflow: "areaReview" });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__areaPanel.getWorkspaceSnapshot();
      return { workflow: state.workflow, areaId: state.selection.areaId, circles: state.draw.circles.length };
    })).toEqual({ workflow: "areaReview", areaId: "saved-area", circles: 1 });

    await dispatch({ type: "open-workflow", workflow: "draw" });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__areaPanel.getWorkspaceSnapshot();
      return { workflow: state.workflow, areaId: state.selection.areaId, circles: state.draw.circles.length };
    })).toEqual({ workflow: "draw", areaId: "saved-area", circles: 1 });

    await dispatch({ type: "open-workflow", workflow: "none" });
    await dispatch({ type: "open-workflow", workflow: "draw" });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__areaPanel.getWorkspaceSnapshot();
      return { workflow: state.workflow, areaId: state.selection.areaId, circles: state.draw.circles.length };
    })).toEqual({ workflow: "draw", areaId: null, circles: 0 });
    await page.evaluate(() => window.__areaPanel.remove());
  });

  test("keeps Stop reachable while paused and strips transition expanded map to safety controls", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "paused" });
    await gallery.getByRole("button", { name: "Hide workspace" }).click();
    await expect(gallery.getByRole("button", { name: "Resume cleaning" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Stop cleaning" })).toBeVisible();

    await page.evaluate(async (tag) => {
      const module = await import("/map_studio_v4/index.js");
      const galleryElement = document.querySelector(tag);
      galleryElement.replaceWorkspaceState({
        ...module.createGalleryState("transition"),
        fullMap: true,
      });
    }, GALLERY_TAG);
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await expect(gallery.locator(".map-tools button")).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Show workspace" })).toBeVisible();
    await expect(gallery.locator(".full-map-hud")).toContainText("Locating");
    await expect(gallery.locator(".map-message")).toHaveCount(0);
  });

  test("uses identical map math for the brush cursor and scale", async ({ page }) => {
    await page.goto("/");
    const combinations = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      const samples = [
        [100, 0.2],
        [100, 2.5],
        [400, 0.2],
        [400, 2.5],
        [1000, 0.6],
        [1000, 2.5],
      ];
      return samples.map(([zoom, brush]) => {
        const base = module.createGalleryState("draw");
        const state = {
          ...base,
          draw: { ...base.draw, zoomPercent: zoom, brushMeters: brush },
        };
        const scale = module.mapScale(state);
        return {
          zoom,
          brush,
          cursor: module.brushCursorPixels(state),
          expected: brush * (scale.pixels / scale.meters),
        };
      });
    });

    for (const sample of combinations) {
      expect(sample.cursor).toBeCloseTo(sample.expected, 8);
    }
  });

  const DRAW_TOOL_NAMES = ["Paint", "Erase", "Move map", "Undo", "Redo", /^Brush width, 0\.60 m/];

  async function expectDrawTools(gallery, tools) {
    await expect(tools).toHaveCount(6);
    for (let index = 0; index < 6; index += 1) {
      const tool = tools.nth(index);
      await expect(tool).toHaveAccessibleName(DRAW_TOOL_NAMES[index]);
      const bounds = await tool.boundingBox();
      expect(bounds.width, `tool ${index} width`).toBeGreaterThanOrEqual(44);
      expect(bounds.height, `tool ${index} height`).toBeGreaterThanOrEqual(44);
    }
    // Paint, Erase and Move map are toggles (aria-pressed), never radios;
    // exactly one is pressed and Paint is the default.
    await expect(tools.locator('[aria-checked], [role="radio"]')).toHaveCount(0);
    await expect(gallery.locator('.draw-tools button[aria-pressed="true"]')).toHaveCount(1);
    await expect(gallery.locator('.draw-tools button[aria-pressed="true"]')).toHaveAccessibleName("Paint");
    await expect(gallery.getByRole("button", { name: "Done editing" })).toHaveCount(0);
  }

  for (const width of [320, 390]) {
    test(`fits all six 44px Draw tools inside the sheet without horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      const gallery = await loadGallery(page, { scenario: "draw", narrow: true });
      const toolbar = gallery.locator(".draw-tools");
      await expect(toolbar).toHaveCount(1);
      await expect(toolbar).toHaveRole("toolbar");
      await expect(toolbar).toHaveAccessibleName("Draw area tools");
      await expect(toolbar).toHaveClass(/draw-tools--grid/);
      await expectDrawTools(gallery, toolbar.locator("button"));
      expect(await page.evaluate((limit) => document.documentElement.scrollWidth <= limit, width)).toBe(true);
      // On a phone the sheet owns the tools: they live inside .mobile-sheet
      // (in .sheet-tools, above the body) rather than floating over the map.
      expect(await toolbar.evaluate((element) => Boolean(element.closest(".sheet-tools")?.closest(".mobile-sheet")))).toBe(true);
      const sheet = await gallery.locator(".mobile-sheet").boundingBox();
      const drawTools = await toolbar.boundingBox();
      expect(drawTools.y).toBeGreaterThanOrEqual(sheet.y - 1);
      expect(drawTools.y + drawTools.height).toBeLessThanOrEqual(sheet.y + sheet.height + 1);
      await expect(gallery.locator("matic-map-canvas-v4 .draw-tools")).toHaveCount(0);
    });
  }

  test("docks the six Draw tools on the map without overlapping the inspector at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    const gallery = await loadGallery(page, { scenario: "draw" });
    const dock = gallery.locator("matic-map-canvas-v4 .map-dock");
    await expect(dock).toHaveCount(1);
    const toolbar = dock.locator(".draw-tools");
    await expect(toolbar).toHaveRole("toolbar");
    await expect(toolbar).toHaveClass(/draw-tools--row/);
    await expectDrawTools(gallery, toolbar.locator("button"));
    await expect(gallery.locator(".sheet-tools")).toHaveCount(0);
    const dockBounds = await dock.boundingBox();
    const inspector = await gallery.locator(".inspector").boundingBox();
    const overlaps = dockBounds.x < inspector.x + inspector.width
      && dockBounds.x + dockBounds.width > inspector.x
      && dockBounds.y < inspector.y + inspector.height
      && dockBounds.y + dockBounds.height > inspector.y;
    expect(overlaps, `dock ${JSON.stringify(dockBounds)} vs inspector ${JSON.stringify(inspector)}`).toBe(false);
  });

  test("restores classic display controls without compromising the map-first shell", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });

    await gallery.getByRole("complementary", { name: "Map workspace" })
      .getByRole("button", { name: /^One-time clean Choose rooms for this run/ }).click();
    await gallery.getByRole("button", { name: "2D", exact: true }).click();
    const appearance = gallery.getByRole("group", { name: "Map style" });
    await expect(appearance.getByRole("button")).toHaveText(["Photo", "Floor plan"]);
    await appearance.getByRole("button", { name: "Floor plan", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).appearance).toBe("rooms");
    await expect(appearance.getByRole("button", { name: "Floor plan" })).toHaveAttribute("aria-pressed", "true");

    const options = gallery.getByRole("button", { name: "Map options" });
    await expect(options).toHaveAttribute("aria-controls", "map-options");
    await options.click();
    await expect(options).toHaveAttribute("aria-expanded", "true");
    await expect(gallery.getByRole("menu")).toHaveCount(0);
    await expect(gallery.getByRole("menuitem")).toHaveCount(0);
    await gallery.getByLabel("Scene detail").selectOption("maximum");
    await expect.poll(async () => (await snapshot(page)).quality).toBe("maximum");

    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    await gallery.getByRole("button", { name: "Rotate right" }).click();
    await expect.poll(async () => (await snapshot(page)).cameras.three?.yaw ?? null)
      .not.toBeNull();
  });

  test("makes the first cleaning decision explicit without a phantom Run plan action", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });

    const navigation = gallery.getByRole("button", { name: "Open navigation" });
    await expect(navigation).toBeVisible();
    await page.evaluate((tag) => {
      window.__navigationToggles = 0;
      document.querySelector(tag).addEventListener("hass-toggle-menu", () => {
        window.__navigationToggles += 1;
      });
    }, GALLERY_TAG);
    await navigation.click();
    expect(await page.evaluate(() => window.__navigationToggles)).toBe(1);

    await expect(gallery.getByRole("heading", { name: "What should the robot clean?", level: 2 })).toBeVisible();
    await expect(gallery.getByLabel("Choose robot")).toHaveCount(0);
    await expect(gallery.getByLabel("Choose floor", { exact: true })).toBeVisible();
    await expect(gallery.getByLabel("Choose floor", { exact: true })).toHaveAttribute("name", "map-floor");
    await expect(gallery.getByLabel("Choose floor", { exact: true })).toBeEnabled();
    await expect(gallery.getByLabel("Choose floor", { exact: true }).locator("option"))
      .toHaveText(["House", "Shed", "Annex · Visit floor to capture"]);
    await expect(gallery.getByLabel("Choose floor", { exact: true }).locator('option[value="saved-2"]'))
      .toBeDisabled();
    // Two featured choices, then a plainly named map-tools shelf. The entry never offers a
    // phantom "Run this plan" before a plan has been chosen.
    const quick = gallery.locator(".quick-actions").getByRole("button");
    await expect(quick).toHaveCount(2);
    await expect(quick.nth(0)).toHaveAccessibleName(/^One-time clean Choose rooms for this run/);
    await expect(quick.nth(0)).toHaveClass(/ms-row--featured/);
    await expect(quick.nth(1)).toHaveAccessibleName(/^Run a plan (1 saved routine|\d+ saved routines)/);
    await expect(gallery.getByRole("heading", { name: "Map tools", level: 3 })).toBeVisible();
    await expect(gallery.locator(".shelf").getByRole("button", { name: /^Clean a custom area Sketch a one-time zone on the map/ })).toBeVisible();
    await expect(gallery.locator(".shelf").getByRole("button", { name: /^Map history Saved maps are floor-scoped and read only/ })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Run this plan", exact: true })).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Run plan", exact: true })).toHaveCount(0);

    await gallery.getByLabel("Choose floor", { exact: true }).selectOption("saved-1");
    await expect.poll(async () => (await snapshot(page)).selection.floorId).toBe("saved-1");
    await gallery.getByLabel("Choose floor", { exact: true }).selectOption("current");
    await expect.poll(async () => (await snapshot(page)).selection.floorId).toBe("current");

    await gallery.getByRole("button", { name: /^One-time clean Choose rooms for this run/ }).click();
    await expect(gallery.getByRole("heading", { name: "Choose rooms" })).toBeVisible();
    // Disabled actions stay focusable and explain themselves: aria-disabled
    // plus an aria-describedby reason, which is stronger than `disabled`.
    const cleanRooms = gallery.getByRole("button", { name: "Clean selected rooms", exact: true });
    await expect(cleanRooms).toHaveAttribute("aria-disabled", "true");
    await expect(cleanRooms).toHaveAccessibleDescription(/room/i);
    await expect(cleanRooms).not.toHaveAttribute("disabled");
  });

  test("keeps the plan action honest while saved routines are loading", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate(async (tag) => {
      const module = await import("/map_studio_v4/index.js");
      const element = document.querySelector(tag);
      const state = module.createGalleryState("ready");
      element.replaceWorkspaceState({
        ...state,
        resources: {
          ...state.resources,
          plans: { status: "loading", value: null, problem: null },
        },
      });
    }, GALLERY_TAG);

    const planAction = gallery.getByRole("button", { name: /^Checking saved plans/ });
    await expect(planAction).toHaveAccessibleName("Checking saved plans Reading routines for this floor");
    await expect(gallery.getByRole("button", { name: /Create a plan/ })).toHaveCount(0);
  });

  test("retries a plan catalog after a transient floor-recheck conflict", async ({ page }) => {
    const scene = syntheticScene("Current room", 18);
    let plansRequests = 0;
    let releaseScene = () => {};
    const sceneReady = new Promise((resolve) => {
      releaseScene = resolve;
    });
    let releasePlanRecovery = () => {};
    const planRecovery = new Promise((resolve) => {
      releasePlanRecovery = resolve;
    });
    const entry = {
      entry_id: "synthetic-entry",
      scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
      pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
      history_url: "/api/matic_robot/slam_history/synthetic-entry",
      areas_url: "/api/matic_robot/areas/synthetic-entry",
      plans_url: "/api/matic_robot/plans/synthetic-entry",
      map_revision: 1,
      map_floor_coherent: true,
      map_session_verified: true,
      map_session_key: "a".repeat(64),
      runner_locked: false,
      stop_settle_pending: false,
      active_plan: false,
      native_reconciliation_pending: false,
      native_session_active: false,
      map_complete: true,
      map_truncated: false,
      selected_floor_ordinal: 1,
      map_floor_ordinal: 1,
      history_count: 0,
      history_floor_count: 1,
      map_health: "ready",
      stream_state: "connected",
      stream_failures: 0,
    };
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [entry] }),
    }));
    await page.route("**/api/matic_robot/slam_scene/synthetic-entry", async (route) => {
      await sceneReady;
      return route.fulfill({
        status: 200,
        body: scene,
        headers: {
          "Content-Type": "application/vnd.matic.slam-scene",
          "X-Matic-Revision": "1",
          "X-Matic-Floor-Coherent": "1",
        },
      });
    });
    await page.route("**/api/matic_robot/slam_pose/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        position: [18, 12],
        source: "latest_pose",
        revision: 1,
        pose_revision: 1,
        map_floor_coherent: true,
        pose_freshness: "live",
        map_session_key: "a".repeat(64),
      }),
    }));
    await page.route("**/api/matic_robot/slam_history/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entry_id: "synthetic-entry",
        live_available: true,
        floors: [{ id: "current", active: true, read_only: false, live_available: true, snapshots: [] }],
      }),
    }));
    await page.route("**/api/matic_robot/plans/synthetic-entry", async (route) => {
      if (plansRequests === 0) {
        plansRequests = 1;
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          headers: { "X-Matic-Plans-Conflict": "map-rechecking" },
          body: "{}",
        });
      }
      await planRecovery;
      plansRequests = 2;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rooms: [{ room_id: "room-1", name: "Current room" }],
          plans: [],
          selected_plan: null,
        }),
      });
    });
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        fetchWithAuth: (path, init) => fetch(path, init),
      };
      document.body.append(panel);
      window.__transientPlansPanel = panel;
    });
    // Let the scene settle only after the panel is mounted. The first plans
    // request starts from the scene's authoritative success path, so the
    // transient conflict cannot be hidden by a simultaneous retry.
    releaseScene();
    await expect.poll(() => plansRequests).toBe(1);
    await expect.poll(async () => page.evaluate(() =>
      window.__transientPlansPanel.getWorkspaceSnapshot().resources.plans.problem)).toBe("map-rechecking");
    // The catalog poll is the authoritative next coherence check. It should
    // recover the transient 409 without requiring the user to open the plan.
    // Hold the recovery response until the intermediate state is observed so
    // this assertion cannot race the production retry path.
    releasePlanRecovery();
    await expect.poll(() => plansRequests, { timeout: 8_000 }).toBe(2);
    await expect.poll(async () => page.evaluate(() =>
      window.__transientPlansPanel.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
    await page.evaluate(() => window.__transientPlansPanel.remove());
  });

  test("keeps first-use supporting copy at AA contrast in light and dark themes", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });

    const contrastRatios = async (selector) => gallery.locator(selector).evaluateAll((elements) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (color) => {
        const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
        const rgb = color.startsWith("color(srgb") ? values.map((value) => value * 255) : values;
        return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
      };
      // Walk up to the first ancestor that actually paints a background, so
      // text that sits directly on a surface (.action-reason, .action-summary,
      // .sheet-status) is measured against what it is really drawn over.
      const painted = (element) => {
        let node = element.closest("button, select") ?? element.parentElement;
        while (node && node !== document.body) {
          const color = getComputedStyle(node).backgroundColor;
          if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
          node = node.parentElement ?? node.getRootNode()?.host ?? null;
        }
        return "rgb(255, 255, 255)";
      };
      return elements.map((element) => {
        const foreground = luminance(getComputedStyle(element).color);
        const background = luminance(painted(element));
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
    });
    const expectContrast = async (selector) => {
      const ratios = await contrastRatios(selector);
      expect(ratios.length, `${selector} rendered`).toBeGreaterThan(0);
      expect(Math.min(...ratios), `${selector} contrast ${JSON.stringify(ratios)}`).toBeGreaterThanOrEqual(4.5);
    };
    const sweep = async () => {
      await gallery.evaluate((element) => element.setScenario("ready"));
      await expectContrast(".quick-actions .ms-row__body small");
      await expectContrast(".floor-switcher");
      await gallery.evaluate(async (element) => {
        const module = await import("/map_studio_v4/index.js");
        const rooms = module.createGalleryState("rooms");
        element.replaceWorkspaceState({ ...rooms, selection: { ...rooms.selection, roomIds: ["room-a", "room-b"] } });
      });
      await expectContrast(".action-summary");
      await gallery.evaluate(async (element) => {
        const module = await import("/map_studio_v4/index.js");
        const rooms = module.createGalleryState("rooms");
        element.replaceWorkspaceState({ ...rooms, selection: { ...rooms.selection, roomIds: [] } });
      });
      await expectContrast(".action-reason");
      await gallery.evaluate((element) => element.setScenario("draw"));
      await expectContrast(".list .ms-row small");
      await gallery.evaluate((element) => { element.narrow = true; element.setScenario("rooms"); });
      await expectContrast(".sheet-status");
      await gallery.evaluate((element) => { element.narrow = false; });
    };

    await sweep();
    await gallery.evaluate((element) => {
      element.style.setProperty("--card-background-color", "#11181c");
      element.style.setProperty("--secondary-background-color", "#192126");
      element.style.setProperty("--primary-text-color", "#f1f5f7");
      element.style.setProperty("--secondary-text-color", "#a8b5bc");
      element.style.setProperty("--primary-color", "#42a5f5");
    });
    await sweep();
  });

  test("honors reduced motion and announces a fail-closed map transition", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    await expect(gallery.locator(".mobile-sheet")).toHaveCSS("transition-duration", "0s");
    const mapLive = gallery.locator("matic-map-canvas-v4 [aria-live=polite]");
    await expect(mapLive).toContainText("Live map");

    await gallery.evaluate((element) => element.setScenario("transition"));
    await expect(gallery.getByRole("status")).toContainText("Locating");
    const locating = gallery.getByRole("button", { name: "Finding the map" });
    await expect(locating).toHaveAttribute("aria-disabled", "true");
    await expect(locating).toHaveAccessibleDescription("Waiting for the robot to confirm which floor it is on.");
    await expect(mapLive).toContainText("not available");
  });

  test("distinguishes selected rows in every list", async ({ page }) => {
    // Selected state lives on .ms-row[data-selected="true"], so a row that
    // misses the class keeps the attribute and loses the distinction. Counting
    // [data-selected] rows cannot see that, which is how the plan room list
    // shipped looking identical whether a room was in the plan or not.
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: /^Run a plan/ }).click();
    const inspector = gallery.locator(".inspector");
    const rows = inspector.locator(".plan-room");
    await expect(rows.first()).toBeVisible();
    const distinct = await rows.evaluateAll((elements) => {
      const shade = (element) => {
        const style = getComputedStyle(element);
        return `${style.backgroundColor}|${style.borderTopColor}`;
      };
      const on = elements.filter((element) => element.dataset.selected === "true").map(shade);
      const off = elements.filter((element) => element.dataset.selected !== "true").map(shade);
      return on.length > 0 && off.length > 0 && !on.some((value) => off.includes(value));
    });
    expect(distinct).toBe(true);
  });

  test("gives the map status overlay a readable surface", async ({ page }) => {
    // The overlay sits directly on the map, including the photo view, so it
    // needs its own background. It once inherited one from a shared rule that
    // also styled the toolbars; when that rule was replaced by a class, every
    // toolbar was updated and this was missed, and nothing failed because the
    // other assertions on .map-message only check presence and text.
    const gallery = await loadGallery(page, { scenario: "ha-offline" });
    const message = gallery.locator("matic-map-canvas-v4 .map-message");
    await expect(message).toBeVisible();
    const surface = await message.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        border: style.borderTopWidth,
        shadow: style.boxShadow,
      };
    });
    expect(surface.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(surface.border).not.toBe("0px");
    expect(surface.shadow).not.toBe("none");
  });

  test("uses a neutral map surface without a decorative glow", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await expect(gallery.locator(".map-root")).toHaveCSS("background-image", "none");
  });

  test("responds within one interaction budget and reads canvas geometry once per frame", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.getBoundingClientRect;
      window.__canvasRectReads = 0;
      HTMLCanvasElement.prototype.getBoundingClientRect = function measuredBounds() {
        window.__canvasRectReads += 1;
        return original.call(this);
      };
    });
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async (tag) => {
      await customElements.whenDefined(tag);
      const gallery = document.createElement(tag);
      gallery.controls = false;
      gallery.scenario = "ready";
      document.body.style.margin = "0";
      document.body.append(gallery);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.__canvasRectReads = 0;
    }, GALLERY_TAG);
    const gallery = page.locator(GALLERY_TAG);

    const geometryReads = await gallery.evaluate(async (element) => {
      const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
      const map = shell.shadowRoot.querySelector("matic-map-canvas-v4");
      window.__canvasRectReads = 0;
      map.shadowRoot.querySelector(".map-tools button").click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return window.__canvasRectReads;
    });
    expect(geometryReads).toBeLessThanOrEqual(2);

    const response = await gallery.evaluate(async (element) => {
      const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
      const rooms = shell.shadowRoot.querySelector(".quick-actions button");
      const started = performance.now();
      rooms.click();
      await shell.updateComplete;
      return {
        duration: performance.now() - started,
        workflow: element.getWorkspaceSnapshot().workflow,
      };
    });
    expect(response.workflow).toBe("rooms");
    expect(response.duration).toBeLessThan(100);
  });

  test("drags the sheet grip without re-reading canvas geometry", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await shimPointerCapture(page);
    await page.goto("/");
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.getBoundingClientRect;
      window.__canvasRectReads = 0;
      HTMLCanvasElement.prototype.getBoundingClientRect = function measuredBounds() {
        window.__canvasRectReads += 1;
        return original.call(this);
      };
    });
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async (tag) => {
      await customElements.whenDefined(tag);
      const gallery = document.createElement(tag);
      gallery.controls = false;
      gallery.scenario = "ready";
      gallery.narrow = true;
      document.body.style.margin = "0";
      document.body.append(gallery);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, GALLERY_TAG);
    const gallery = page.locator(GALLERY_TAG);
    await expect(gallery.locator(".sheet-grip")).toBeVisible();

    // Dispatched from inside the page: every Playwright locator action walks
    // the DOM and measures elements (canvases included), which would be
    // counted against the app. A drag translates the sheet; only the
    // committed detent on release may relayout the canvas.
    const reads = await gallery.evaluate(async (element) => {
      const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
      const grip = shell.shadowRoot.querySelector(".sheet-grip");
      const bounds = grip.getBoundingClientRect();
      const x = bounds.left + 160;
      const y = bounds.top + 20;
      const touch = (type, clientY) => grip.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 11, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY,
      }));
      const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await frames();
      window.__canvasRectReads = 0;
      touch("pointerdown", y);
      for (let index = 1; index <= 20; index += 1) touch("pointermove", y - index * 8);
      await frames();
      const duringDrag = window.__canvasRectReads;
      const transform = shell.shadowRoot.querySelector(".mobile-sheet").style.transform;
      touch("pointerup", y - 160);
      await frames();
      return { duringDrag, transform, afterRelease: window.__canvasRectReads - duringDrag };
    });
    expect(reads.transform).toMatch(/translateY\(-\d+/);
    expect(reads.duringDrag, JSON.stringify(reads)).toBeLessThanOrEqual(2);
    await expect(gallery.locator(".mobile-sheet")).toHaveAttribute("data-detent", "full");
  });

  test("clears a drawn area reversibly and exposes official cleaning-mode wording", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const before = await snapshot(page);
    expect(before.draw.circles.length).toBeGreaterThan(0);

    // "Clear drawing" is the draw workflow's secondary action in the action
    // bar; the toolbar itself no longer carries a Clear button.
    const clear = gallery.locator(".action-bar").getByRole("button", { name: "Clear drawing", exact: true });
    await expect(clear).not.toHaveAttribute("aria-disabled", "true");
    await clear.click();
    await expect.poll(async () => (await snapshot(page)).draw.circles.length).toBe(0);
    await expect(clear).toHaveAttribute("aria-disabled", "true");
    await gallery.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).draw.circles.length)
      .toBe(before.draw.circles.length);

    await gallery.evaluate((element) => element.setScenario("rooms"));
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("rooms");
    const inspector = gallery.locator(".inspector");
    await expect(inspector.getByLabel(/^Cleaning system for /)).toHaveCount(0);
    await inspector.getByRole("checkbox", { name: "Kitchen" }).check();
    await expect(inspector.getByLabel(/^Cleaning system for /)).toBeVisible();
    await expect(inspector.getByLabel(/^Cleaning system for /)).toHaveValue("vacuum");
    const mode = inspector.getByLabel(/^Cleaning mode for /);
    await expect(mode).toHaveValue("standard");
    await expect(mode.locator("option")).toHaveText(["Quick", "Optimal", "Heavy Duty"]);
  });

  test("selects a requested robot deterministically", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      const adapter = new module.HassAdapter();
      const hass = {
        connected: true,
        language: "en",
        user: { id: "user", is_admin: true },
        states: {
          "vacuum.first": { state: "docked", attributes: { matic_entry_id: "entry-a", friendly_name: "First" } },
          "vacuum.second": { state: "idle", attributes: { matic_entry_id: "entry-b", friendly_name: "Second" } },
          "sensor.stale_entry": { state: "ready", attributes: { matic_entry_id: "not-a-robot" } },
        },
      };
      const first = adapter.project(hass, undefined, "entry-a");
      const second = adapter.project(hass, undefined, "entry-b");
      return {
        first: [first.entryKey, first.robotLabel],
        second: [second.entryKey, second.robotLabel],
        robots: second.robots.map((robot) => robot.label),
        robotCount: second.host.robotCount,
      };
    });
    expect(result).toEqual({
      first: ["entry-a", "First"],
      second: ["entry-b", "Second"],
      robots: ["First", "Second"],
      robotCount: 2,
    });
  });

  test("shows recharge-and-resume as charging with Stop still available", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      const adapter = new module.HassAdapter();
      const projection = adapter.project({
        connected: true,
        language: "en",
        user: { id: "user", is_admin: true },
        states: {
          "vacuum.first": {
            state: "docked",
            attributes: {
              matic_entry_id: "entry-a",
              friendly_name: "First",
              battery_level: 18,
              charging: true,
              recharge_and_resume: true,
            },
          },
        },
      });
      const state = {
        ...module.createGalleryState("ready"),
        activity: projection.activity,
        batteryPercent: projection.batteryPercent,
      };
      return {
        activity: projection.activity,
        action: module.selectPrimaryAction(state),
        canStart: module.canStartMotion(state),
      };
    });
    expect(result).toEqual({
      activity: "recharging",
      action: { id: "stop", label: "Stop", labelKey: "v4_action_stop", kind: "danger", enabled: true },
      canStart: false,
    });

    const gallery = await loadGallery(page, { scenario: "recharging" });
    await expect(gallery).toContainText("Charging to resume");
    await expect(gallery).toContainText("18% battery");
    const stop = gallery.getByRole("button", { name: "Stop cleaning", exact: true });
    await expect(stop).toBeVisible();
    await expect(stop).toHaveText("Stop");
    await expect(stop).not.toHaveAttribute("aria-disabled", "true");
  });

  test("hides the robot selector when non-vacuum Matic entities have stale entry metadata", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(() => {
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "entry-a" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "user", is_admin: true },
        states: {
          "vacuum.first": { state: "docked", attributes: { matic_entry_id: "entry-a", friendly_name: "First" } },
          "sensor.stale_entry": { state: "ready", attributes: { matic_entry_id: "not-a-robot" } },
        },
      };
      document.body.append(panel);
    });
    await expect(page.getByLabel("Choose robot")).toHaveCount(0);
  });

  test("routes v0.4 copy through Home Assistant localization", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.evaluate((element) => {
      const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
      const strings = {
        map_studio_title: "Mapa Matic",
        v4_how_to_move: "Cómo mover el mapa",
        v4_hide_workspace: "Ocultar espacio de trabajo",
        v4_trackpad: "Panel táctil",
        v4_trackpad_help: "Desplázate para mover · pellizca para ampliar · gira para rotar",
        v4_clean_rooms: "Limpiar habitaciones",
        v4_action_clean_rooms: "Limpiar las habitaciones elegidas",
        v4_reason_clean_rooms_empty: "Elige al menos una habitación.",
      };
      shell.localize = (key) => strings[key.split(".").at(-1)] || key;
      shell.requestUpdate();
    });
    await expect(gallery.getByRole("heading", { name: "Mapa Matic" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Ocultar espacio de trabajo" })).toBeVisible();
    const help = gallery.getByRole("button", { name: "Cómo mover el mapa" });
    await help.click();
    await expect(gallery.getByRole("dialog", { name: "Cómo mover el mapa" }))
      .toContainText("Panel táctil");
    await expect(gallery.getByRole("dialog", { name: "Cómo mover el mapa" }))
      .toContainText("Desplázate para mover");
    await gallery.getByRole("dialog", { name: "Cómo mover el mapa" }).getByRole("button").press("Escape");
    // Action labels and their disabled reasons resolve through the same
    // localize hook, so a translated shell never mixes in English actions.
    await gallery.getByRole("button", { name: /^Limpiar habitaciones/ }).click();
    const clean = gallery.getByRole("button", { name: "Limpiar las habitaciones elegidas" });
    await expect(clean).toHaveAttribute("aria-disabled", "true");
    await expect(clean).toHaveAccessibleDescription("Elige al menos una habitación.");
  });

  test("keeps the mobile map usable in RTL", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/");
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate((tag) => {
      const gallery = document.createElement(tag);
      gallery.controls = false;
      gallery.scenario = "draw";
      gallery.narrow = true;
      document.body.style.margin = "0";
      document.body.append(gallery);
    }, GALLERY_TAG);
    const gallery = page.locator(GALLERY_TAG);
    await expect(gallery.getByRole("button", { name: "Clear drawing", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
  });

  test("keeps native browser fullscreen as an optional secondary control", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await page.evaluate(() => {
      window.__v4FullscreenRequested = false;
      Element.prototype.requestFullscreen = async function requestFullscreen() {
        window.__v4FullscreenRequested = this.classList.contains("app");
      };
    });
    await gallery.getByRole("button", { name: "Map options" }).click();
    // The overflow is a plain popover of buttons, not an ARIA menu.
    const menu = gallery.locator("#map-options");
    await expect(menu).not.toHaveAttribute("role", /menu/);
    await expect(menu.getByRole("menuitem")).toHaveCount(0);
    await expect(menu.getByRole("button")).toHaveText(["Map diagnostics", "Open classic map view", "Full screen"]);
    await menu.getByRole("button", { name: "Full screen", exact: true }).click();
    expect(await page.evaluate(() => window.__v4FullscreenRequested)).toBe(true);
  });

  test("projects unrelated Home Assistant updates without service calls", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    const result = await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      let calls = 0;
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      const relevant = {
        "vacuum.synthetic": {
          state: "docked",
          attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
        },
      };
      panel.hass = {
        connected: true,
        language: "en",
        user: { is_admin: true },
        states: relevant,
        callService: () => { calls += 1; },
      };
      document.body.append(panel);
      await panel.updateComplete;
      panel.hass = {
        ...panel.hass,
        states: { ...relevant, "sensor.unrelated": { state: "changed", attributes: {} } },
      };
      await panel.updateComplete;
      return { calls, defined: Boolean(customElements.get("matic-map-panel-v0-4-0")) };
    });
    expect(result).toEqual({ calls: 0, defined: true });
  });

  test("streams a bounded live delta without refetching the full scene", async ({ page }) => {
    const initial = syntheticScene("Initial room", 10);
    const updated = syntheticScene("Updated room", 24);
    const delta = syntheticDelta(initial, updated, 1, 2);
    let catalogRevision = 1;
    let catalogRequests = 0;
    let fullSceneRequests = 0;
    const fullScenePreferCached = [];
    let deltaRequests = 0;
    let failNextDelta = false;
    let poseSessionKey = "a".repeat(64);
    let posePosition = [10, 12];
    let poseFreshness = "live";
    let poseRequests = 0;
    let failNextPose = false;
    let holdDeltaRecoveryScene = false;
    let releaseDeltaRecoveryScene;
    const deltaRecoverySceneGate = new Promise((resolve) => { releaseDeltaRecoveryScene = resolve; });
    let holdNextFullScene = false;
    let releaseHeldFullScene;
    const heldFullSceneGate = new Promise((resolve) => { releaseHeldFullScene = resolve; });
    let releaseFirstDelta;
    const firstDeltaGate = new Promise((resolve) => { releaseFirstDelta = resolve; });
    const catalogEntry = () => ({
      entry_id: "synthetic-entry",
      scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
      delta_url: "/api/matic_robot/slam_delta/synthetic-entry",
      pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
      history_url: "/api/matic_robot/slam_history/synthetic-entry",
      areas_url: "/api/matic_robot/areas/synthetic-entry",
      plans_url: "/api/matic_robot/plans/synthetic-entry",
      map_revision: catalogRevision,
      map_floor_coherent: true,
      map_session_verified: true,
      map_session_key: "a".repeat(64),
      runner_locked: false,
      stop_settle_pending: false,
      active_plan: false,
      native_reconciliation_pending: false,
      native_session_active: false,
      map_complete: true,
      map_truncated: false,
      selected_floor_ordinal: 1,
      map_floor_ordinal: 1,
      history_count: 0,
      history_floor_count: 1,
      map_health: "ready",
      stream_state: "connected",
      stream_failures: 0,
    });
    await page.route("**/api/matic_robot/slam_entries", (route) => {
      catalogRequests += 1;
      const entry = catalogEntry();
      if (catalogRequests === 2) entry.map_revision = 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: [entry] }),
      });
    });
    await page.route("**/api/matic_robot/slam_scene/synthetic-entry", async (route) => {
      fullSceneRequests += 1;
      fullScenePreferCached.push(route.request().headers()["x-matic-prefer-cached"]);
      if (holdDeltaRecoveryScene && fullSceneRequests === 2) await deltaRecoverySceneGate;
      if (holdNextFullScene) await heldFullSceneGate;
      return route.fulfill({
        status: 200,
        body: catalogRevision === 1 ? initial : updated,
        headers: {
          "Content-Type": "application/vnd.matic.slam-scene",
          "X-Matic-Revision": String(catalogRevision),
          "X-Matic-Floor-Coherent": "1",
          ETag: `"scene-${catalogRevision}"`,
        },
      });
    });
    await page.route("**/api/matic_robot/slam_delta/synthetic-entry?since=*", async (route) => {
      deltaRequests += 1;
      if (failNextDelta) {
        failNextDelta = false;
        return route.fulfill({ status: 503, body: "temporary" });
      }
      if (deltaRequests === 1) {
        await firstDeltaGate;
        catalogRevision = 2;
        return route.fulfill({
          status: 200,
          body: delta,
          headers: {
            "Content-Type": "application/vnd.matic.slam-delta",
            "X-Matic-Base-Revision": "1",
            "X-Matic-Revision": "2",
            "X-Matic-Floor-Coherent": "1",
            ETag: '"scene-2"',
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      return route.fulfill({
        status: 204,
        headers: {
          "X-Matic-Revision": "2",
          "X-Matic-Floor-Coherent": "1",
        },
      });
    });
    await page.route("**/api/matic_robot/slam_pose/synthetic-entry", (route) => {
      poseRequests += 1;
      if (failNextPose) {
        failNextPose = false;
        return route.fulfill({ status: 503, body: "temporary" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          position: posePosition,
          source: posePosition ? "latest_pose" : "current_area",
          revision: catalogRevision + 100,
          pose_revision: poseRequests,
          map_floor_coherent: true,
          pose_freshness: poseFreshness,
          map_session_key: poseSessionKey,
        }),
      });
    });
    await page.route("**/api/matic_robot/slam_history/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entry_id: "synthetic-entry",
        live_available: true,
        floors: [{
          id: "current",
          active: true,
          read_only: false,
          live_available: true,
          label: "House",
          snapshots: [],
        }],
      }),
    }));

    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        fetchWithAuth: (path, init) => fetch(path, init),
      };
      document.body.append(panel);
      window.__deltaPanel = panel;
    });

    await expect.poll(async () => page.evaluate(() =>
      window.__deltaPanel.getWorkspaceSnapshot().map.exactPose)).toBe(true);
    await page.evaluate(() => {
      window.__poseStayedExact = new Promise((resolve) => {
        const deadline = performance.now() + 750;
        let stayedExact = true;
        const sample = () => {
          const state = window.__deltaPanel.getWorkspaceSnapshot();
          if ((state.resources.scene.value?.revision || 0) >= 2 && !state.map.exactPose) {
            stayedExact = false;
          }
          if (performance.now() >= deadline) resolve(stayedExact);
          else requestAnimationFrame(sample);
        };
        sample();
      });
    });
    releaseFirstDelta();
    await expect.poll(async () => page.evaluate(() => {
      const scene = window.__deltaPanel.getWorkspaceSnapshot().resources.scene.value;
      return { revision: scene?.revision, room: scene?.metadata.rooms[0]?.name };
    })).toEqual({ revision: 2, room: "Updated room" });
    expect(await page.evaluate(() => window.__poseStayedExact)).toBe(true);
    expect(fullSceneRequests).toBe(1);
    expect(fullScenePreferCached).toEqual(["1"]);
    expect(deltaRequests).toBeGreaterThanOrEqual(1);
    await expect.poll(() => catalogRequests, { timeout: 7_000 }).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { revision: state.resources.scene.value?.revision, exactPose: state.map.exactPose };
    })).toEqual({ revision: 2, exactPose: true });
    expect(fullSceneRequests).toBe(1);
    holdDeltaRecoveryScene = true;
    failNextDelta = true;
    await expect.poll(() => fullSceneRequests).toBe(2);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, position: state.resources.pose.value?.position };
    })).toEqual({ exactPose: true, position: [10, 12] });
    releaseDeltaRecoveryScene();
    expect(fullScenePreferCached).toEqual(["1", "1"]);
    await expect.poll(async () => page.evaluate(() =>
      window.__deltaPanel.getWorkspaceSnapshot().notice)).toBe(null);
    poseFreshness = "coordinator_fallback";
    posePosition = [11, 13];
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return {
        exactPose: state.map.exactPose,
        freshness: state.resources.pose.value?.freshness,
        position: state.resources.pose.value?.position,
      };
    }), { timeout: 5_000 }).toEqual({
      exactPose: true,
      freshness: "coordinator_fallback",
      position: [11, 13],
    });
    posePosition = null;
    const requestsBeforeMissingFallback = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeMissingFallback);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, position: state.resources.pose.value?.position };
    })).toEqual({ exactPose: true, position: [11, 13] });
    poseFreshness = "live";
    const requestsBeforeMissingLivePose = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeMissingLivePose);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return {
        exactPose: state.map.exactPose,
        freshness: state.resources.pose.value?.freshness,
        position: state.resources.pose.value?.position,
      };
    })).toEqual({ exactPose: true, freshness: "coordinator_fallback", position: [11, 13] });
    failNextPose = true;
    const requestsBeforeFailure = poseRequests;
    await expect.poll(() => poseRequests, { timeout: 5_000 }).toBeGreaterThan(requestsBeforeFailure);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return { exactPose: state.map.exactPose, position: state.resources.pose.value?.position };
    })).toEqual({ exactPose: true, position: [11, 13] });
    holdNextFullScene = true;
    catalogRevision = 3;
    await expect.poll(() => fullSceneRequests, { timeout: 7_000 }).toBe(3);
    expect(await page.evaluate(() => {
      const state = window.__deltaPanel.getWorkspaceSnapshot();
      return {
        exactPose: state.map.exactPose,
        pose: state.resources.pose.value?.position,
        sceneRevision: state.resources.scene.value?.revision,
        sceneStatus: state.resources.scene.status,
      };
    })).toEqual({
      exactPose: true,
      pose: [11, 13],
      sceneRevision: 2,
      sceneStatus: "loading",
    });
    releaseHeldFullScene();
    await expect.poll(async () => page.evaluate(() =>
      window.__deltaPanel.getWorkspaceSnapshot().resources.scene.value?.revision)).toBe(3);
    const requestsBeforeSessionChange = poseRequests;
    poseSessionKey = "b".repeat(64);
    await expect.poll(() => poseRequests, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeSessionChange);
    await expect.poll(async () => page.evaluate(() =>
      window.__deltaPanel.getWorkspaceSnapshot().map.exactPose), { timeout: 5_000 }).toBe(false);
    await page.evaluate(() => window.__deltaPanel.remove());
  });

  test("retains a verified same-floor scene while a new revision is built", async ({ page }) => {
    const first = syntheticScene("Current room", 10);
    const second = syntheticScene("Updated room", 24);
    let revision = 1;
    let mapComplete = false;
    let sessionVerified = true;
    let sceneRequests = 0;
    let releaseSecond;
    const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
    let plansRequests = 0;
    let releasePlans;
    const plansGate = new Promise((resolve) => { releasePlans = resolve; });
    const entry = () => ({
      entry_id: "synthetic-entry",
      scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
      pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
      history_url: "/api/matic_robot/slam_history/synthetic-entry",
      areas_url: "/api/matic_robot/areas/synthetic-entry",
      plans_url: "/api/matic_robot/plans/synthetic-entry",
      map_revision: revision,
      map_floor_coherent: true,
      map_session_verified: sessionVerified,
      map_session_key: sessionVerified ? "a".repeat(64) : null,
      runner_locked: false,
      stop_settle_pending: false,
      active_plan: false,
      native_reconciliation_pending: false,
      native_session_active: false,
      map_complete: mapComplete,
      map_truncated: false,
      selected_floor_ordinal: 1,
      map_floor_ordinal: 1,
      history_count: 0,
      history_floor_count: 1,
      map_health: mapComplete ? "ready" : "incomplete",
      stream_state: "connected",
      stream_failures: 0,
    });
    await page.route("**/api/matic_robot/slam_entries", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [entry()] }),
    }));
    await page.route("**/api/matic_robot/slam_scene/synthetic-entry", async (route) => {
      sceneRequests += 1;
      if (sceneRequests > 1) await secondGate;
      return route.fulfill({
        status: 200,
        body: sceneRequests === 1 ? first : second,
        headers: {
          "Content-Type": "application/vnd.matic.slam-scene",
          "X-Matic-Revision": String(sceneRequests === 1 ? 1 : 2),
          "X-Matic-Floor-Coherent": "1",
        },
      });
    });
    await page.route("**/api/matic_robot/slam_pose/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        position: null,
        source: "current_area",
        revision,
        pose_revision: revision,
        map_floor_coherent: true,
        pose_freshness: "live",
        map_session_key: "a".repeat(64),
      }),
    }));
    await page.route("**/api/matic_robot/slam_history/synthetic-entry", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entry_id: "synthetic-entry",
        live_available: true,
        floors: [{ id: "current", active: true, read_only: false, live_available: true, snapshots: [] }],
      }),
    }));
    await page.route("**/api/matic_robot/plans/synthetic-entry", async (route) => {
      plansRequests += 1;
      await plansGate;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rooms: [{ room_id: "room-1", name: "Room" }], plans: [], selected_plan: null }),
      });
    });
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        fetchWithAuth: (path, init) => fetch(path, init),
      };
      document.body.append(panel);
      window.__retainedScene = panel;
    });
    await expect.poll(async () => page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().resources.scene.value?.revision)).toBe(1);
    expect(await page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().map.complete)).toBe(false);
    await page.evaluate(() => {
      const shell = window.__retainedScene.shadowRoot.querySelector("matic-map-shell-v4");
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "open-workflow", workflow: "rooms" },
        bubbles: true,
        composed: true,
      }));
    });
    await expect.poll(() => plansRequests).toBe(1);
    expect(await page.evaluate(() => {
      const state = window.__retainedScene.getWorkspaceSnapshot();
      return {
        complete: state.map.complete,
        workflow: state.workflow,
        plans: state.resources.plans.status,
        selectedRooms: state.selection.roomIds.length,
      };
    })).toEqual({ complete: false, workflow: "rooms", plans: "loading", selectedRooms: 0 });
    mapComplete = true;
    await expect.poll(async () => page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().map.complete), { timeout: 10_000 }).toBe(true);
    sessionVerified = false;
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__retainedScene.getWorkspaceSnapshot();
      return { coherence: state.coherence, plans: state.resources.plans.status };
    }), { timeout: 10_000 }).toEqual({ coherence: "verifying", plans: "loading" });
    releasePlans();
    await expect.poll(async () => page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
    sessionVerified = true;
    revision = 2;
    await expect.poll(() => sceneRequests, { timeout: 10_000 }).toBe(2);
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__retainedScene.getWorkspaceSnapshot();
      return { workflow: state.workflow, plans: state.resources.plans.status };
    })).toEqual({ workflow: "rooms", plans: "ready" });
    expect(await page.evaluate(() => {
      const state = window.__retainedScene.getWorkspaceSnapshot();
      return {
        available: state.map.available,
        status: state.resources.scene.status,
        retainedRevision: state.resources.scene.value?.revision,
      };
    })).toEqual({ available: true, status: "loading", retainedRevision: 1 });
    releaseSecond();
    await expect.poll(async () => page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().resources.scene.value?.revision)).toBe(2);
    await page.evaluate(() => {
      window.__retainedScene.hass = { ...window.__retainedScene.hass, connected: false };
    });
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__retainedScene.getWorkspaceSnapshot();
      return {
        coherence: state.coherence,
        available: state.map.available,
        exactPose: state.map.exactPose,
        workflow: state.workflow,
        plans: state.resources.plans.status,
        revision: state.resources.scene.value?.revision,
      };
    })).toEqual({
      coherence: "degraded",
      available: true,
      exactPose: false,
      workflow: "rooms",
      plans: "ready",
      revision: 2,
    });
    await page.evaluate(() => {
      window.__retainedScene.hass = { ...window.__retainedScene.hass, connected: true };
    });
    await expect.poll(async () => page.evaluate(() =>
      window.__retainedScene.getWorkspaceSnapshot().coherence), { timeout: 10_000 }).toBe("current");
  });

  test("keeps one stable loading surface while a timed-out scene build is rejoined", async ({ page }) => {
    const scene = syntheticScene("Stable room", 18);
    await page.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
        callback,
        delay === 60_000 ? 25 : delay,
        ...args,
      );
    });
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async (sceneBytes) => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      let sceneRequests = 0;
      const entry = {
        entry_id: "synthetic-entry",
        scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
        pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
        history_url: "/api/matic_robot/slam_history/synthetic-entry",
        areas_url: "/api/matic_robot/areas/synthetic-entry",
        plans_url: "/api/matic_robot/plans/synthetic-entry",
        map_revision: 1,
        map_floor_coherent: true,
        map_session_verified: true,
        map_session_key: "a".repeat(64),
        runner_locked: false,
        stop_settle_pending: false,
        active_plan: false,
        native_reconciliation_pending: false,
        native_session_active: false,
        map_complete: true,
        map_truncated: false,
        selected_floor_ordinal: 1,
        map_floor_ordinal: 1,
        history_count: 0,
        history_floor_count: 1,
        map_health: "ready",
        stream_state: "connected",
        stream_failures: 0,
      };
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        fetchWithAuth: async (path, init) => {
          // Match Home Assistant's live auth boundary: a native Headers object
          // cannot be merged into the authenticated request, while a plain record
          // is accepted. This guards scene and delta requests against silent 401s.
          if (init?.headers instanceof Headers) {
            return new Response("", { status: 401 });
          }
          if (path === "/api/matic_robot/slam_entries") {
            return new Response(JSON.stringify({ entries: [entry] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (path === entry.scene_url) {
            sceneRequests += 1;
            if (sceneRequests === 1) {
              return new Promise((_resolve, reject) => {
                init.signal.addEventListener("abort", () => {
                  reject(new DOMException("Aborted", "AbortError"));
                }, { once: true });
              });
            }
            return new Response(new Uint8Array(sceneBytes), {
              status: 200,
              headers: {
                "Content-Type": "application/vnd.matic.slam-scene",
                "X-Matic-Revision": "1",
                "X-Matic-Floor-Coherent": "1",
              },
            });
          }
          if (path === entry.pose_url) {
            return new Response(JSON.stringify({
              position: null,
              source: "current_area",
              revision: 1,
              pose_revision: 1,
              map_floor_coherent: true,
              pose_freshness: "live",
              map_session_key: "a".repeat(64),
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (path === entry.history_url) {
            return new Response(JSON.stringify({
              entry_id: "synthetic-entry",
              live_available: true,
              floors: [{
                id: "current",
                active: true,
                read_only: false,
                live_available: true,
                label: "House",
                snapshots: [],
              }],
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response("", { status: 404 });
        },
      };
      document.body.append(panel);
      const samples = [];
      const sampler = window.setInterval(() => {
        const state = panel.getWorkspaceSnapshot();
        samples.push({
          scene: state.resources.scene.status,
          available: state.map.available,
        });
      }, 2);
      window.__slowScene = { panel, samples, sampler, get sceneRequests() { return sceneRequests; } };
    }, [...scene]);

    await expect.poll(async () => page.evaluate(() => {
      const state = window.__slowScene.panel.getWorkspaceSnapshot();
      return { status: state.resources.scene.status, available: state.map.available };
    })).toEqual({ status: "ready", available: true });

    const result = await page.evaluate(() => {
      window.clearInterval(window.__slowScene.sampler);
      return {
        requests: window.__slowScene.sceneRequests,
        samples: window.__slowScene.samples,
      };
    });
    expect(result.requests).toBe(2);
    expect(result.samples.some((sample) => sample.scene === "loading")).toBe(true);
    expect(result.samples.some((sample) => sample.scene === "error")).toBe(false);
    expect(result.samples.some((sample) => sample.available && sample.scene !== "ready")).toBe(false);
  });

  test("routes Stop through the server even when the catalog has no managed plan", async ({ page }) => {
    const scene = syntheticScene("Direct room", 18);
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async (sceneBytes) => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const calls = [];
      const entry = {
        entry_id: "synthetic-entry",
        scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
        pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
        history_url: "/api/matic_robot/slam_history/synthetic-entry",
        areas_url: "/api/matic_robot/areas/synthetic-entry",
        plans_url: "/api/matic_robot/plans/synthetic-entry",
        map_revision: 1,
        map_floor_coherent: true,
        map_session_verified: true,
        map_session_key: "a".repeat(64),
        runner_locked: false,
        stop_settle_pending: false,
        active_plan: false,
        native_reconciliation_pending: false,
        native_session_active: false,
        map_complete: true,
        map_truncated: false,
        selected_floor_ordinal: 1,
        map_floor_ordinal: 1,
        history_count: 0,
        history_floor_count: 1,
        map_health: "ready",
        stream_state: "connected",
        stream_failures: 0,
      };
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      const hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "cleaning",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        callService: async (...args) => { calls.push(args); },
        fetchWithAuth: async (path) => {
          if (path === "/api/matic_robot/slam_entries") {
            return new Response(JSON.stringify({ entries: [entry] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (path === entry.scene_url) {
            return new Response(new Uint8Array(sceneBytes), {
              status: 200,
              headers: {
                "Content-Type": "application/vnd.matic.slam-scene",
                "X-Matic-Revision": "1",
                "X-Matic-Floor-Coherent": "1",
              },
            });
          }
          if (path === entry.pose_url) {
            return new Response(JSON.stringify({
              position: null,
              source: "current_area",
              revision: 1,
              pose_revision: 1,
              map_floor_coherent: true,
              pose_freshness: "live",
              map_session_key: "a".repeat(64),
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (path === entry.history_url) {
            return new Response(JSON.stringify({
              entry_id: "synthetic-entry",
              live_available: true,
              floors: [{ id: "current", active: true, read_only: false, live_available: true, snapshots: [] }],
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response("", { status: 404 });
        },
      };
      panel.hass = hass;
      document.body.append(panel);
      window.__directStop = { panel, calls };
    }, [...scene]);

    await expect.poll(async () => page.evaluate(() =>
      window.__directStop.panel.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
    await page.evaluate(() => {
      const shell = window.__directStop.panel.shadowRoot.querySelector("matic-map-shell-v4");
      shell.dispatchEvent(new CustomEvent("matic-workspace-action", {
        detail: { id: "stop" },
        bubbles: true,
        composed: true,
      }));
    });
    await expect.poll(async () => page.evaluate(() => window.__directStop.calls.length)).toBe(1);
    expect(await page.evaluate(() => window.__directStop.calls[0].slice(0, 2)))
      .toEqual(["matic_robot", "stop_intelligent_cleaning"]);
    expect(await page.evaluate(() => window.__directStop.calls[0][2].include_unmanaged)).toBe(true);
  });

  test("fails motion closed when the private catalog reports managed work", async ({ page }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async () => {
      await customElements.whenDefined("matic-map-panel-v0-4-0");
      const panel = document.createElement("matic-map-panel-v0-4-0");
      panel.panel = { config: { entry_id: "synthetic-entry" } };
      panel.hass = {
        connected: true,
        language: "en",
        user: { id: "synthetic-user", is_admin: true },
        states: {
          "vacuum.synthetic": {
            state: "docked",
            attributes: { matic_entry_id: "synthetic-entry", battery_level: 91 },
          },
        },
        fetchWithAuth: async (path) => {
          if (path === "/api/matic_robot/slam_entries") {
            return new Response(JSON.stringify({ entries: [{
              entry_id: "synthetic-entry",
              scene_url: "/api/matic_robot/slam_scene/synthetic-entry",
              delta_url: "/api/matic_robot/slam_delta/synthetic-entry",
              pose_url: "/api/matic_robot/slam_pose/synthetic-entry",
              history_url: "/api/matic_robot/slam_history/synthetic-entry",
              areas_url: "/api/matic_robot/areas/synthetic-entry",
              plans_url: "/api/matic_robot/plans/synthetic-entry",
              map_revision: 7,
              map_floor_coherent: true,
              map_session_verified: true,
              map_session_key: "a".repeat(64),
              runner_locked: true,
              stop_settle_pending: false,
              active_plan: false,
              native_reconciliation_pending: false,
              native_session_active: false,
              map_complete: true,
              map_truncated: false,
              selected_floor_ordinal: 1,
              map_floor_ordinal: 1,
              history_count: 0,
              history_floor_count: 1,
              map_health: "ready",
              stream_state: "connected",
              stream_failures: 0,
            }] }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response("", { status: 503 });
        },
      };
      document.body.append(panel);
      window.__managedPanel = panel;
    });

    await expect.poll(async () => page.evaluate(() => ({
      catalog: window.__managedPanel.getWorkspaceSnapshot().resources.catalog.status,
      locked: window.__managedPanel.getWorkspaceSnapshot().managedLock,
    }))).toEqual({ catalog: "ready", locked: true });
    expect(await page.evaluate(async () => {
      const module = await import("/map_studio_v4/index.js");
      return module.canStartMotion(window.__managedPanel.getWorkspaceSnapshot());
    })).toBe(false);
  });
});

test.describe("Map Studio v0.4 on touch @mobile", () => {
  test("keeps offline status above the bottom sheet", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ha-offline", narrow: true });
    await settleSheet(gallery);
    const message = await gallery.locator(".map-message").boundingBox();
    const sheet = await gallery.locator(".mobile-sheet").boundingBox();
    expect(message.y).toBeGreaterThanOrEqual(0);
    expect(message.y + message.height).toBeLessThan(sheet.y);
  });

  // Runs on the iPhone 15 and Pixel 7 projects only (tag-selected). The
  // gallery's narrow stage is a fixed 390x844 frame for the desktop harness;
  // on a device the shell must fill the real viewport instead.
  async function loadPhone(page, { scenario = "ready", dir = "ltr" } = {}) {
    await shimPointerCapture(page);
    await page.goto("/");
    await page.evaluate((direction) => { document.documentElement.dir = direction; }, dir);
    await page.addScriptTag({ url: "/map_studio_v4/index.js", type: "module" });
    await page.evaluate(async ({ tag, selectedScenario }) => {
      await customElements.whenDefined(tag);
      const gallery = document.createElement(tag);
      gallery.controls = false;
      gallery.scenario = selectedScenario;
      gallery.narrow = true;
      document.body.style.margin = "0";
      document.body.append(gallery);
      await gallery.updateComplete;
      const stage = gallery.shadowRoot.querySelector(".stage");
      stage.style.blockSize = "100vh";
      stage.style.minBlockSize = "0";
      stage.style.maxInlineSize = "none";
    }, { tag: GALLERY_TAG, selectedScenario: scenario });
    const gallery = page.locator(GALLERY_TAG);
    await expect(gallery.locator(".mobile-sheet")).toBeVisible();
    return gallery;
  }

  async function replaceState(page, build) {
    await page.evaluate(async ({ tag, source }) => {
      const module = await import("/map_studio_v4/index.js");
      const build = new Function("module", "state", `return (${source})(module, state);`);
      const element = document.querySelector(tag);
      element.replaceWorkspaceState(build(module, element.getWorkspaceSnapshot()));
    }, { tag: GALLERY_TAG, source: build.toString() });
  }

  // The draw scenario ships with a saved outline; start every stroke test
  // from an empty draft so "nothing was painted" is unambiguous.
  const emptyDraw = (module) => {
    const draw = module.createGalleryState("draw");
    return { ...draw, draw: { ...draw.draw, circles: [], strokeCount: 0, dirty: false, redo: [] } };
  };

  async function sceneCentre(gallery) {
    const box = await gallery.locator(".scene-window").boundingBox();
    expect(box).not.toBeNull();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  }

  const dispatch = (locator, event) => locator.dispatchEvent(event.type, event.init);

  test("moves the sheet between detents by dragging the grip", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "ready" });
    const sheet = gallery.locator(".mobile-sheet");
    const grip = gallery.locator(".sheet-grip");
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await settleSheet(gallery);
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);

    await touchDrag(page, grip, slowDrag(-220), { stepMs: 40 });
    await expect(sheet).toHaveAttribute("data-detent", "full");
    await expect(sheet).not.toHaveClass(/dragging/);
    await settleSheet(gallery);
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);

    await touchDrag(page, grip, slowDrag(220), { stepMs: 40 });
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await settleSheet(gallery);
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);

    await touchDrag(page, grip, slowDrag(220), { stepMs: 40 });
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    await settleSheet(gallery);
    await expect(gallery.locator("#sheet-body")).toBeHidden();
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);
    expect(await sheet.evaluate((element) => element.style.transform)).toBe("");
  });

  test("lets a fast flick reach the next detent without covering the distance", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "ready" });
    const sheet = gallery.locator(".mobile-sheet");
    const grip = gallery.locator(".sheet-grip");
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await settleSheet(gallery);

    // 75px is nowhere near the full detent, but ~1.5 px/ms is a flick.
    // No spacing between moves: the flick is defined by wall-clock velocity,
    // and a slow CI runner must not turn it into a drag.
    await touchDrag(page, grip, [[160, 20], [160, -5], [160, -30], [160, -55]], { stepMs: 0 });
    await expect(sheet).toHaveAttribute("data-detent", "full");
    await settleSheet(gallery);
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);

    // A flick down from full is one step, to half, never straight to peek.
    await touchDrag(page, grip, [[160, 20], [160, 45], [160, 70], [160, 95]], { stepMs: 0 });
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await settleSheet(gallery);

    // Dragging the same 75px slowly snaps back to where it started.
    await touchDrag(page, grip, slowDrag(-75), { stepMs: 40 });
    await expect(sheet).toHaveAttribute("data-detent", "half");
  });

  test("does not paint when a second finger lands during the arming delay", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "draw" });
    await replaceState(page, emptyDraw);
    const root = gallery.locator(".map-root");
    const { x, y } = await sceneCentre(gallery);

    await dispatch(root, pointer("pointerdown", 11, x - 20, y));
    await page.waitForTimeout(60);
    await dispatch(root, pointer("pointerdown", 12, x + 20, y));
    for (let step = 1; step <= 6; step += 1) {
      await page.waitForTimeout(16);
      await dispatch(root, pointer("pointermove", 11, x - 20 - step * 12, y));
      await dispatch(root, pointer("pointermove", 12, x + 20 + step * 12, y));
    }
    await dispatch(root, pointer("pointerup", 11, x - 92, y));
    await dispatch(root, pointer("pointerup", 12, x + 92, y));
    await page.waitForTimeout(200);
    const after = await snapshot(page);
    expect(after.draw.circles.length).toBe(0);
    expect(after.draw.strokeCount).toBe(0);
  });

  test("paints once a single finger has rested for the arming delay", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "draw" });
    await replaceState(page, emptyDraw);
    const root = gallery.locator(".map-root");
    const { x, y } = await sceneCentre(gallery);

    await dispatch(root, pointer("pointerdown", 11, x, y));
    await page.waitForTimeout(150);
    await dispatch(root, pointer("pointermove", 11, x + 20, y));
    await page.waitForTimeout(16);
    await dispatch(root, pointer("pointermove", 11, x + 40, y));
    await dispatch(root, pointer("pointerup", 11, x + 40, y));
    await expect.poll(async () => (await snapshot(page)).draw.circles.length).toBeGreaterThan(0);
    await expect.poll(async () => (await snapshot(page)).draw.strokeCount).toBe(1);
  });

  // Finds a point over a room by tapping candidate spots and watching the
  // selection; the point is handed back unselected.
  async function findRoomPoint(page, gallery) {
    const root = gallery.locator(".map-root");
    const { box } = await sceneCentre(gallery);
    const candidates = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.4, 0.4], [0.6, 0.6], [0.5, 0.5]];
    for (const [fx, fy] of candidates) {
      const x = box.x + box.width * fx;
      const y = box.y + box.height * fy;
      await dispatch(root, pointer("pointerdown", 11, x, y));
      await dispatch(root, pointer("pointerup", 11, x, y));
      await page.waitForTimeout(50);
      const ids = (await snapshot(page)).selection.roomIds;
      if (ids.length === 1) {
        await dispatch(root, pointer("pointerdown", 11, x, y));
        await dispatch(root, pointer("pointerup", 11, x, y));
        await expect.poll(async () => (await snapshot(page)).selection.roomIds).toEqual([]);
        return { x, y, roomId: ids[0] };
      }
    }
    throw new Error("no candidate point landed on a room");
  }

  test("selects a room on a tap under 7px and ignores a 20px drag", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "rooms" });
    await gallery.getByRole("button", { name: "2D", exact: true }).click();
    await gallery.getByRole("button", { name: "Fit the whole map on screen" }).click();
    const root = gallery.locator(".map-root");
    const { x, y, roomId } = await findRoomPoint(page, gallery);

    // A 4px wobble is still a tap.
    await dispatch(root, pointer("pointerdown", 11, x, y));
    await page.waitForTimeout(30);
    await dispatch(root, pointer("pointermove", 11, x + 3, y + 2));
    await dispatch(root, pointer("pointerup", 11, x + 3, y + 2));
    await expect.poll(async () => (await snapshot(page)).selection.roomIds).toEqual([roomId]);

    // A 20px drag from the same spot pans; it must not toggle the room.
    await dispatch(root, pointer("pointerdown", 11, x, y));
    await page.waitForTimeout(30);
    await dispatch(root, pointer("pointermove", 11, x + 10, y + 5));
    await page.waitForTimeout(16);
    await dispatch(root, pointer("pointermove", 11, x + 20, y + 8));
    await dispatch(root, pointer("pointerup", 11, x + 20, y + 8));
    await page.waitForTimeout(150);
    expect((await snapshot(page)).selection.roomIds).toEqual([roomId]);
  });

  test("pinches the camera with two fingers without touching the drawn area", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "draw" });
    const root = gallery.locator(".map-root");
    const before = await snapshot(page);
    expect(before.draw.circles.length).toBeGreaterThan(0);
    const box = await root.boundingBox();
    const cx = box.width / 2;
    const cy = box.height * 0.4;

    await twoFingerPinch(page, root, { a: [cx - 30, cy], b: [cx + 30, cy] }, { a: [cx - 90, cy], b: [cx + 90, cy] });
    await expect.poll(async () => (await snapshot(page)).draw.zoomPercent).toBeGreaterThan(before.draw.zoomPercent);
    const after = await snapshot(page);
    expect(after.draw.circles).toEqual(before.draw.circles);
    expect(after.draw.strokeCount).toBe(before.draw.strokeCount);
  });

  test("keeps the primary action, Stop, and every draw tool within thumb reach", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "rooms" });
    const reach = async (locator, label) => {
      const height = await page.evaluate(() => window.innerHeight);
      const box = await locator.boundingBox();
      expect(box, `${label} has a box`).not.toBeNull();
      const centre = box.y + box.height / 2;
      expect(centre, `${label} centre ${centre} of ${height}`).toBeGreaterThanOrEqual(height * 0.45);
    };
    await replaceState(page, (module) => {
      const rooms = module.createGalleryState("rooms");
      return { ...rooms, selection: { ...rooms.selection, roomIds: ["room-a", "room-b"] } };
    });
    await reach(gallery.locator(".action-bar").getByRole("button", { name: "Clean 2 rooms" }), "Clean rooms");

    await gallery.evaluate((element) => element.setScenario("cleaning"));
    await reach(gallery.locator(".action-bar").getByRole("button", { name: "Stop cleaning" }), "Stop");

    await gallery.evaluate((element) => element.setScenario("draw"));
    const tools = gallery.locator(".sheet-tools .draw-tools button");
    await expect(tools).toHaveCount(6);
    for (let index = 0; index < 6; index += 1) await reach(tools.nth(index), `draw tool ${index}`);
  });

  for (const width of [320, 390]) {
    test(`gives every visible button a 44px target at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      const gallery = await loadPhone(page, { scenario: "ready" });
      const showMore = gallery.getByRole("button", { name: "Show more of the map workspace" });
      const allowed = [];
      const undersized = [];
      const sweep = async (label) => {
        // Open the sheet fully so the panel's own buttons are on screen too.
        for (let step = 0; step < 2; step += 1) {
          if (await showMore.getAttribute("aria-disabled") !== "true") await showMore.click();
        }
        const buttons = gallery.locator("button:visible");
        const count = await buttons.count();
        expect(count, `${label} renders buttons`).toBeGreaterThan(0);
        for (let index = 0; index < count; index += 1) {
          const button = buttons.nth(index);
          const box = await button.boundingBox();
          if (!box) continue;
          if (box.width < 44 || box.height < 44) {
            const name = await button.evaluate((element) => element.getAttribute("aria-label") || element.textContent.trim());
            if (allowed.some((pattern) => pattern.test(name))) continue;
            undersized.push(`${label}: "${name}" ${Math.round(box.width)}x${Math.round(box.height)}`);
          }
        }
      };
      await sweep("ready");
      for (const scenario of ["rooms", "draw", "cleaning", "history"]) {
        await gallery.evaluate((element, next) => element.setScenario(next), scenario);
        await sweep(scenario);
      }
      await replaceState(page, (module) => ({ ...module.createGalleryState("ready"), workflow: "plan" }));
      await sweep("plan");
      expect(undersized, undersized.join("\n")).toEqual([]);
    });
  }

  for (const dir of ["ltr", "rtl"]) {
    test(`never scrolls sideways at 320px in ${dir}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 740 });
      const gallery = await loadPhone(page, { scenario: "ready", dir });
      const overflow = () => page.evaluate((tag) => {
        const gallery = document.querySelector(tag);
        const shell = gallery.shadowRoot.querySelector("matic-map-shell-v4");
        return {
          document: document.documentElement.scrollWidth,
          gallery: gallery.scrollWidth,
          root: shell.shadowRoot.querySelector(".root").scrollWidth,
        };
      }, GALLERY_TAG);
      const check = async (label) => {
        const widths = await overflow();
        for (const [key, value] of Object.entries(widths)) {
          expect(value, `${label} ${dir} ${key} width`).toBeLessThanOrEqual(320);
        }
      };
      await check("ready");
      for (const scenario of ["rooms", "draw", "history"]) {
        await gallery.evaluate((element, next) => element.setScenario(next), scenario);
        await check(scenario);
      }
      await replaceState(page, (module) => ({ ...module.createGalleryState("ready"), workflow: "plan" }));
      await check("plan");
    });
  }

  test("collapses a full sheet from the scrim without toggling a room", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "rooms" });
    await replaceState(page, (module) => {
      const rooms = module.createGalleryState("rooms");
      return { ...rooms, selection: { ...rooms.selection, roomIds: ["room-a"] } };
    });
    const sheet = gallery.locator(".mobile-sheet");
    const showMore = gallery.getByRole("button", { name: "Show more of the map workspace" });
    await expect(gallery.getByRole("button", { name: "Collapse the map workspace" })).toHaveCount(0);
    await showMore.click();
    await showMore.click();
    await expect(sheet).toHaveAttribute("data-detent", "full");
    const scrim = gallery.getByRole("button", { name: "Collapse the map workspace" });
    await expect(scrim).toBeVisible();
    await scrim.click();
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    await expect(scrim).toHaveCount(0);
    await page.waitForTimeout(150);
    expect((await snapshot(page)).selection.roomIds).toEqual(["room-a"]);
  });

  test("pads the sheet for the home indicator", async ({ page }) => {
    const gallery = await loadPhone(page, { scenario: "ready" });
    const rules = await gallery.evaluate((element) => {
      const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
      const sheets = [...shell.shadowRoot.adoptedStyleSheets, ...shell.shadowRoot.styleSheets];
      const matches = [];
      for (const sheet of sheets) {
        for (const rule of sheet.cssRules) {
          if (!rule.selectorText?.includes(".mobile-sheet")) continue;
          const bottom = rule.style.getPropertyValue("padding-bottom") || rule.style.getPropertyValue("padding-block-end") || rule.style.getPropertyValue("padding");
          if (bottom.includes("env(safe-area-inset-bottom)")) matches.push(`${rule.selectorText} { ${bottom} }`);
        }
      }
      return matches;
    });
    expect(rules.length, "a .mobile-sheet rule pads the bottom with env(safe-area-inset-bottom)").toBeGreaterThan(0);
  });

  test("settles instantly under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const gallery = await loadPhone(page, { scenario: "ready" });
    const sheet = gallery.locator(".mobile-sheet");
    await expect(sheet).toHaveCSS("transition-duration", "0s");
    await settleSheet(gallery);
    const grip = gallery.locator(".sheet-grip");
    await touchDrag(page, grip, slowDrag(-220), { stepMs: 40 });
    await expect(sheet).toHaveAttribute("data-detent", "full");
    const immediate = await sheet.evaluate((element) => new Promise((resolve) => {
      requestAnimationFrame(() => resolve(element.getBoundingClientRect().height));
    }));
    await page.waitForTimeout(400);
    const settled = await sheet.evaluate((element) => element.getBoundingClientRect().height);
    expect(Math.abs(immediate - settled)).toBeLessThanOrEqual(1);
    await expect.poll(() => sheetSeam(gallery)).toBeLessThanOrEqual(1);
  });
});
