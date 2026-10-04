import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const LIFECYCLE_MODULE = "/page-lifecycle-test.js";

async function routePageLifecycleModule(page) {
  const bundle = await build({
    entryPoints: ["frontend/map-studio-v4/page-lifecycle.ts"],
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route(`**${LIFECYCLE_MODULE}`, (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
}

function liveEntry({ delta = false } = {}) {
  return {
    entry_id: "synthetic-entry",
    scene_url: "/api/matic_robot/slam_scene/synthetic",
    delta_url: delta ? "/api/matic_robot/slam_delta/synthetic" : null,
    pose_url: "/api/matic_robot/slam_pose/synthetic",
    history_url: "/api/matic_robot/slam_history/synthetic",
    areas_url: "/api/matic_robot/areas/synthetic",
    plans_url: "/api/matic_robot/plans/synthetic",
    map_revision: 7,
    map_floor_coherent: true,
    map_session_verified: true,
    map_session_key: "a".repeat(64),
    map_complete: true,
    map_truncated: false,
    selected_floor_ordinal: 1,
    map_floor_ordinal: 1,
    history_count: 1,
    history_floor_count: 2,
    map_health: "ready",
    stream_failures: 0,
    bootstrap_state: "complete",
    bootstrap_photo_seen: true,
    bootstrap_structure_seen: true,
    bootstrap_failures: 0,
    runner_locked: false,
    stop_settle_pending: false,
    active_plan: false,
    native_reconciliation_pending: false,
    native_session_active: false,
  };
}

test("@safety PageLifecycle deduplicates visibility and BFCache signals and disposes its listeners", async ({ page }) => {
  await installPanelFixture(page, { moduleSource: "typescript" });
  await routePageLifecycleModule(page);

  const result = await page.evaluate(async (modulePath) => {
    const activeListeners = new Map();
    const isLifecycleSignal = (target, type) => (target === window
      && (type === "pagehide" || type === "pageshow"))
      || (target === document && type === "visibilitychange");
    const nativeAdd = EventTarget.prototype.addEventListener;
    const nativeRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (listener && isLifecycleSignal(this, type)) {
        const key = `${this === window ? "window" : "document"}:${type}`;
        const listeners = activeListeners.get(key) ?? new Set();
        listeners.add(listener);
        activeListeners.set(key, listeners);
      }
      return nativeAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (listener && isLifecycleSignal(this, type)) {
        const key = `${this === window ? "window" : "document"}:${type}`;
        activeListeners.get(key)?.delete(listener);
      }
      return nativeRemove.call(this, type, listener, options);
    };

    const { PageLifecycle } = await import(modulePath);
    const transitions = [];
    const lifecycle = new PageLifecycle({
      onSuspend: () => transitions.push("suspend"),
      onResume: () => transitions.push("resume"),
    });
    const initialActive = lifecycle.active;
    lifecycle.start();
    lifecycle.start();
    const afterVisibleStart = [...transitions];

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    const afterHiddenAndPagehide = [...transitions];

    // A persisted restore still revokes the previous generation before
    // announcing the resume, including if a second hide was never observed.
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    const afterPersistedRestore = [...transitions];
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    const afterDuplicatePersistedRestore = [...transitions];
    const listenerCountsBeforeDispose = [...activeListeners.values()].map((listeners) => listeners.size);
    lifecycle.dispose();
    lifecycle.dispose();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    document.dispatchEvent(new Event("visibilitychange"));

    return {
      initialActive,
      afterVisibleStart,
      afterHiddenAndPagehide,
      afterPersistedRestore,
      afterDuplicatePersistedRestore,
      afterDispose: [...transitions],
      listenerCountsBeforeDispose,
      listenerCountsAfterDispose: [...activeListeners.values()].map((listeners) => listeners.size),
      activeAfterDispose: lifecycle.active,
    };
  }, LIFECYCLE_MODULE);

  expect(result.initialActive).toBe(true);
  expect(result.afterVisibleStart).toEqual([]);
  expect(result.afterHiddenAndPagehide).toEqual(["suspend"]);
  expect(result.afterPersistedRestore).toEqual(["suspend", "resume"]);
  expect(result.afterDuplicatePersistedRestore).toEqual(["suspend", "resume", "suspend", "resume"]);
  expect(result.afterDispose).toEqual(result.afterDuplicatePersistedRestore);
  expect(result.listenerCountsBeforeDispose).toEqual([1, 1, 1]);
  expect(result.listenerCountsAfterDispose).toEqual([0, 0, 0]);
  expect(result.activeAfterDispose).toBe(true);
});

test("@safety synthetic page lifecycle revokes late live reads and revalidates before resume", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T12:00:00Z"));
  await page.addInitScript(() => {
    const tracked = new Map();
    const nativeAdd = EventTarget.prototype.addEventListener;
    const nativeRemove = EventTarget.prototype.removeEventListener;
    const keyFor = (target, type) => (target === window
      && (type === "pagehide" || type === "pageshow"))
      || (target === document && type === "visibilitychange")
      ? `${target === window ? "window" : "document"}:${type}` : null;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const key = listener && keyFor(this, type);
      if (key) {
        const listeners = tracked.get(key) ?? new Set();
        listeners.add(listener);
        tracked.set(key, listeners);
      }
      return nativeAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      const key = listener && keyFor(this, type);
      if (key) tracked.get(key)?.delete(listener);
      return nativeRemove.call(this, type, listener, options);
    };
    window.__pageLifecycleListeners = () => Object.fromEntries(
      [...tracked].map(([key, listeners]) => [key, listeners.size]),
    );
  });

  const fixture = await installPanelFixture(page, {
    moduleSource: "typescript",
    initialCatalogEntries: [liveEntry({ delta: true })],
  });
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    const originalFetch = panel.hass.fetchWithAuth;
    window.__pageLifecycleProbe = { hold: false, pending: [], deltaReads: 0, poseReads: 0 };
    panel.hass = {
      ...panel.hass,
      fetchWithAuth: async (path, init) => {
        const probe = window.__pageLifecycleProbe;
        const isPose = path.includes("slam_pose/");
        const isDelta = path.includes("slam_delta/");
        if (probe.hold && (isPose || isDelta)) {
          if (isPose) probe.poseReads += 1;
          if (isDelta) probe.deltaReads += 1;
          return new Promise((resolve) => {
            const pending = { path, resolve, aborted: false };
            probe.pending.push(pending);
            init?.signal?.addEventListener("abort", () => { pending.aborted = true; }, { once: true });
          });
        }
        if (isDelta) return new Response(null, { status: 204 });
        return originalFetch(path, init);
      },
    };
    document.body.append(panel);
  });
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.map.exactPose;
  })).toBe(true);
  const beforeSuspend = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  const generation = beforeSuspend.generation;
  const mapRoot = panel.locator("matic-map-shell-v4").locator("matic-map-canvas-v4").locator(".map-root");
  await mapRoot.focus();
  for (let index = 0; index < 4; index += 1) await page.keyboard.press("ArrowRight");
  const retainedCamera = await panel.evaluate((element) => {
    const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
    shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "mark-draft", strokeDelta: 2 }, bubbles: true, composed: true,
    }));
    return element.getWorkspaceSnapshot().cameras.top;
  });
  expect(retainedCamera).toBeTruthy();
  await page.evaluate(() => { window.__pageLifecycleProbe.hold = true; });
  await page.clock.fastForward(1_000);
  await expect.poll(() => page.evaluate(() => {
    const probe = window.__pageLifecycleProbe;
    return probe.poseReads > 0 && probe.deltaReads > 0;
  })).toBe(true);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().generation)).toBeGreaterThan(generation);
  const suspended = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  expect(suspended.map.exactPose).toBe(false);
  expect(suspended.coherence).not.toBe("current");
  expect(suspended.draw.strokeCount).toBe(2);
  expect(suspended.draw.dirty).toBe(true);
  expect(suspended.cameras.top).toEqual(retainedCamera);
  expect(await page.evaluate(() => window.__pageLifecycleProbe.pending.every((pending) => pending.aborted))).toBe(true);
  expect(await page.evaluate(() => window.__pageLifecycleListeners())).toEqual({
    "window:pagehide": 1,
    "window:pageshow": 1,
    "document:visibilitychange": 1,
  });

  // Late responses from the revoked generation must not re-admit pose or delta.
  await page.evaluate(() => {
    for (const pending of window.__pageLifecycleProbe.pending) {
      pending.resolve(pending.path.includes("slam_pose/")
        ? new Response(JSON.stringify({
          position: [1, 1], source: "latest_pose", revision: 7, pose_revision: 1,
          map_floor_coherent: true, map_session_key: "a".repeat(64), pose_freshness: "live",
        }), { headers: { "Content-Type": "application/json" } })
        : new Response(null, { status: 204 }));
    }
  });
  await page.clock.fastForward(0);
  const afterLateResponse = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  expect(afterLateResponse.generation).toBe(suspended.generation);
  expect(afterLateResponse.map.exactPose).toBe(false);

  const readsWhileSuspended = await page.evaluate(() => ({
    catalog: window.__panelFixture.catalogReads,
    pose: window.__pageLifecycleProbe.poseReads,
    delta: window.__pageLifecycleProbe.deltaReads,
  }));
  await page.clock.fastForward(5_000);
  expect(await page.evaluate(() => ({
    catalog: window.__panelFixture.catalogReads,
    pose: window.__pageLifecycleProbe.poseReads,
    delta: window.__pageLifecycleProbe.deltaReads,
  }))).toEqual(readsWhileSuspended);

  await page.evaluate(() => { window.__pageLifecycleProbe.hold = false; });
  await page.evaluate(() => window.__panelFixture.deferNextCatalog());
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingCatalogCount())).toBe(1);
  const whileCatalogHeld = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  expect(whileCatalogHeld.map.exactPose).toBe(false);
  expect(whileCatalogHeld.coherence).not.toBe("current");
  await page.evaluate(() => window.__panelFixture.releaseCatalog());
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.map.exactPose;
  })).toBe(true);
  const resumed = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  expect(resumed.draw.strokeCount).toBe(2);
  expect(resumed.cameras.top).toEqual(retainedCamera);
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);

  const pendingHistorySceneIndex = await page.evaluate(() => window.__panelFixture.pendingHistoryScenes.length);
  await panel.evaluate((element) => {
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "set-floor", floorId: "saved-1" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return [state.dataMode, state.selection.floorId];
  })).toEqual(["history", "saved-1"]);
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingHistoryScenes.length))
    .toBeGreaterThan(pendingHistorySceneIndex);
  await page.evaluate((index) => window.__panelFixture.pendingHistoryScenes[index](), pendingHistorySceneIndex);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  const historyBeforeSuspend = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  expect(historyBeforeSuspend.floor.readOnly).toBe(true);
  await page.evaluate(() => window.__panelFixture.deferNextCatalog());
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingCatalogCount())).toBe(1);
  const historyWhileCatalogHeld = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  expect(historyWhileCatalogHeld.dataMode).toBe("history");
  expect(historyWhileCatalogHeld.selection.floorId).toBe("saved-1");
  expect(historyWhileCatalogHeld.floor.readOnly).toBe(true);
  await page.evaluate(() => window.__panelFixture.releaseCatalog());
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.catalog.status)).toBe("ready");
  const historyAfterResume = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  expect(historyAfterResume.dataMode).toBe("history");
  expect(historyAfterResume.selection.floorId).toBe("saved-1");
  expect(historyAfterResume.floor.readOnly).toBe(true);

  // Repeated panel disconnection disposes all lifecycle listeners and prevents
  // future synthetic restore signals from scheduling more backend work.
  const readsAtDisconnect = await page.evaluate(() => window.__panelFixture.catalogReads);
  await panel.evaluate((element) => element.remove());
  expect(await page.evaluate(() => window.__pageLifecycleListeners())).toEqual({
    "window:pagehide": 0,
    "window:pageshow": 0,
    "document:visibilitychange": 0,
  });
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(5_000);
  expect(await page.evaluate(() => window.__panelFixture.catalogReads)).toBe(readsAtDisconnect);
});

test("@safety page suspension aborts saved-plan preflight and preserves its draft", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T12:00:00Z"));
  const fixture = await installPanelFixture(page, {
    moduleSource: "typescript",
    initialPlanCatalog: {
      rooms: [{ room_id: "room-a", name: "Kitchen" }],
      selected_plan: "daily",
      plans: [{
        id: "daily",
        name: "Daily clean",
        enabled: true,
        run_behavior: "intelligent",
        rooms: [{ room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" }],
        room_order: ["room-a"],
        return_to_base: true,
        finish_current_room: false,
        finish_current_room_threshold: 50,
        next_run_preview: {
          preview_token: "e".repeat(64),
          rooms: [{
            room_id: "room-a", name: "Kitchen", cleaning_mode: "vacuum",
            coverage_setting: "standard", cadence_reasons: [],
          }],
          mission_boundaries: [],
          blocker: null,
        },
      }],
    },
  });
  await page.evaluate(() => {
    const panel = window.__panelFixture.createPanel();
    const originalFetch = panel.hass.fetchWithAuth;
    window.__planLifecycleProbe = { armed: false, pending: null };
    panel.hass = {
      ...panel.hass,
      fetchWithAuth: (path, init) => {
        const probe = window.__planLifecycleProbe;
        if (probe.armed && path.endsWith("plans/synthetic")) {
          probe.armed = false;
          return new Promise((resolve) => {
            const pending = { resolve, aborted: false };
            probe.pending = pending;
            init?.signal?.addEventListener("abort", () => { pending.aborted = true; }, { once: true });
          });
        }
        return originalFetch(path, init);
      },
    };
    document.body.append(panel);
  });

  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.map.exactPose
      && state.resources.plans.status === "ready";
  })).toBe(true);
  await panel.evaluate((element) => {
    const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
    shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "open-workflow", workflow: "plan" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.workflow === "plan" && state.resources.plans.status === "ready";
  })).toBe(true);
  await panel.evaluate((element) => {
    const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
    shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "patch-plan-draft", patch: { name: "Unsaved daily draft" } },
      bubbles: true, composed: true,
    }));
  });
  const beforePreflight = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  expect(beforePreflight.planDraft.dirty).toBe(true);
  expect(beforePreflight.planDraft.name).toBe("Unsaved daily draft");
  await page.evaluate(() => { window.__planLifecycleProbe.armed = true; });
  await panel.evaluate((element) => {
    element.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-action", {
      detail: { id: "run-plan" }, bubbles: true, composed: true,
    }));
  });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().command)).toBe("pending");
  await expect.poll(() => page.evaluate(() => window.__planLifecycleProbe.pending !== null)).toBe(true);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect.poll(() => panel.evaluate((element) => {
    const state = element.getWorkspaceSnapshot();
    return state.generation > 0 && state.command === "idle";
  })).toBe(true);
  expect(await page.evaluate(() => window.__planLifecycleProbe.pending.aborted)).toBe(true);
  const suspended = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  expect(suspended.command).toBe("idle");
  expect(suspended.planDraft.dirty).toBe(true);
  expect(suspended.planDraft.name).toBe("Unsaved daily draft");

  // Deliver a valid but stale preflight result after suspension. The aborted
  // generation must not turn it into a robot service call.
  await page.evaluate(() => {
    window.__planLifecycleProbe.pending.resolve(new Response(JSON.stringify({
      rooms: [{ room_id: "room-a", name: "Kitchen" }],
      selected_plan: "daily",
      plans: [{
        id: "daily",
        name: "Daily clean",
        enabled: true,
        run_behavior: "intelligent",
        rooms: [{ room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" }],
        room_order: ["room-a"],
        return_to_base: true,
        finish_current_room: false,
        finish_current_room_threshold: 50,
        next_run_preview: {
          preview_token: "e".repeat(64),
          rooms: [{ room_id: "room-a", name: "Kitchen", cleaning_mode: "vacuum",
            coverage_setting: "standard", cadence_reasons: [] }],
          mission_boundaries: [],
          blocker: null,
        },
      }],
    }), { headers: { "Content-Type": "application/json" } }));
  });
  await page.clock.fastForward(0);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().command)).toBe("idle");
  const afterLateRead = await panel.evaluate((element) => element.getWorkspaceSnapshot());
  expect(afterLateRead.generation).toBe(suspended.generation);
  expect(afterLateRead.planDraft.dirty).toBe(true);
  expect(afterLateRead.planDraft.name).toBe("Unsaved daily draft");
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);
});
