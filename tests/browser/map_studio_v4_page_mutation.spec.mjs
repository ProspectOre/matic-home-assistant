import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadMutationHarness(page) {
  const bundle = await build({
    stdin: {
      contents: `
        export { EffectController } from "./frontend/map-studio-v4/effects";
        export { WorkspaceStore } from "./frontend/map-studio-v4/state";
        export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
        export { MaticBackend } from "./frontend/map-studio-v4/backend";
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/page-mutation-ownership.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

async function createPendingMutation(page, kind, { planId = "daily", planName = "Updated daily draft" } = {}) {
  await loadMutationHarness(page);
  await page.evaluate(async ({ kind, planId, planName }) => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/page-mutation-ownership.js");
    const base = createGalleryState("ready");
    const store = new WorkspaceStore();
    const run = window.__pageMutation = {
      entry: { ...base.resources.entry, deltaUrl: null },
      kind,
      writes: [],
      store,
      effects: null,
      pending: null,
      planCatalog: base.resources.plans.value,
      plansCallCount: 0,
      holdNextPlanRead: false,
      planRead: null,
    };
    const holdWrite = (write) => new Promise((resolve, reject) => {
      run.writes.push(write);
      run.pending = { resolve, reject };
    });
    const backend = {
      dispose() {},
      catalog: async () => [run.entry],
      scene: async (_url, revision) => ({ revision, floorCoherent: true, scene: base.resources.scene.value }),
      history: async () => base.resources.history.value,
      pose: async () => ({
        ...base.resources.pose.value,
        floorCoherent: true,
        mapSessionKey: run.entry.mapSessionKey,
      }),
      plans: async (_url, signal) => {
        run.plansCallCount += 1;
        if (run.holdNextPlanRead) {
          run.holdNextPlanRead = false;
          return new Promise((resolve) => { run.planRead = { signal, resolve }; });
        }
        return run.planCatalog;
      },
      areas: async () => base.resources.areas.value,
      saveArea: (url, value, signal) => holdWrite({ kind: "area", url, value, signal }),
      service: (domain, service, data, target) => holdWrite({ kind: "plan", domain, service, data, target }),
    };
    run.effects = new EffectController(store, backend);
    run.effects.sync({
      userKey: "synthetic-user",
      entryKey: "synthetic-entry",
      host: base.host,
      activity: "docked",
      batteryPercent: 92,
      robotLabel: base.robotLabel,
      robots: base.robots,
      language: "en",
      vacuumEntityId: "vacuum.synthetic",
    });
    await run.effects.refreshCatalog(true);
    if (kind === "area" || kind === "area-update") {
      const current = store.value;
      const updating = kind === "area-update";
      store.patch({
        workflow: "areaReview",
        selection: { ...current.selection, areaId: updating ? "entryway" : null },
        ...(updating ? {
          resources: {
            ...current.resources,
            areas: { status: "ready", value: base.resources.areas.value, problem: null },
          },
        } : {}),
        areaDraft: {
          ...current.areaDraft,
          id: updating ? "entryway" : null,
          name: updating ? "Updated entryway" : "New area draft",
          dirty: true,
        },
        draw: {
          ...current.draw,
          circles: updating ? [{ x: 2.4, y: 2.1, radius: 0.55 }] : [{ x: 1, y: 1, radius: 0.2 }],
          dirty: true,
        },
      });
      run.saving = run.effects.saveArea();
    } else if (kind === "reset-cadence") {
      const current = store.value;
      const staleRoom = {
        ...run.planCatalog.plans[0].rooms[0],
        cleaningMode: "vacuum",
        cadence: {
          scope: "plan",
          mopEveryN: 4,
          coverageEveryN: 6,
          periodicCoverageSetting: "standard",
          doMopNext: true,
          doCoverageNext: false,
        },
        cadenceProgress: {
          mopProgress: 3,
          coverageProgress: 2,
          mopDue: true,
          coverageDue: false,
          nextMopIn: 0,
          nextCoverageIn: 4,
          reasons: ["mop_due"],
        },
        cadenceReasons: ["mop_due"],
      };
      const stalePlan = {
        ...run.planCatalog.plans[0],
        name: "Stale cached plan name",
        rooms: [staleRoom],
      };
      run.planCatalog = {
        ...run.planCatalog,
        selectedPlan: "other",
        plans: [stalePlan, {
          ...stalePlan,
          id: "other",
          name: "Globally selected other plan",
          rooms: [staleRoom],
        }],
      };
      store.patch({
        workflow: "plan",
        selection: { ...current.selection, planId: "daily" },
        resources: {
          ...current.resources,
          plans: { ...current.resources.plans, value: run.planCatalog },
        },
        planDraft: {
          ...base.planDraft,
          name: "Retained clean editor",
          rooms: [staleRoom],
          dirty: false,
        },
      });
      run.holdNextPlanRead = true;
      run.prewriteRead = run.effects.loadPlans();
      // Keep the stale, previously admitted catalog available while the
      // independent pre-write read is outstanding.
      store.patch({
        resources: {
          ...store.value.resources,
          plans: { ...store.value.resources.plans, value: run.planCatalog },
        },
      });
      run.reset = run.effects.executeAction({
        id: "reset-room-cadence", planId: "daily", roomId: "room-a", mode: "mop",
      });
    } else {
      store.patch({
        workflow: "plan",
        planDraft: { ...base.planDraft, id: planId, name: planName, dirty: true },
      });
      run.saving = run.effects.savePlan();
    }
  }, { kind, planId, planName });
}

async function suspendPendingMutation(page) {
  await expect.poll(() => page.evaluate(() => window.__pageMutation.writes.length)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await page.clock.fastForward(5_000);
  return page.evaluate(() => {
    const run = window.__pageMutation;
    return {
      command: run.store.value.command,
      notice: run.store.value.notice?.text,
      writes: run.writes.length,
      aborted: run.pending.signal?.aborted ?? false,
      draft: run.kind === "area" || run.kind === "area-update"
        ? { id: run.store.value.areaDraft.id, name: run.store.value.areaDraft.name, dirty: run.store.value.areaDraft.dirty }
        : { id: run.store.value.planDraft.id, name: run.store.value.planDraft.name, dirty: run.store.value.planDraft.dirty },
    };
  });
}

test.describe("page suspension preserves transmitted map mutations", () => {
  for (const outcome of ["success", "failure"]) {
    test(`held Area save remains owned through pagehide and settles once (${outcome}) @safety`, async ({ page }) => {
      await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
      await page.clock.pauseAt(new Date("2026-09-30T12:00:00Z"));
      await createPendingMutation(page, "area");
      const suspended = await suspendPendingMutation(page);
      expect(suspended).toEqual({
        command: "pending",
        notice: "Saving area…",
        writes: 1,
        aborted: false,
        draft: { id: null, name: "New area draft", dirty: true },
      });

      const settled = await page.evaluate(async (outcome) => {
        const run = window.__pageMutation;
        if (outcome === "success") run.pending.resolve("created-area");
        else run.pending.reject(new Error("synthetic save failure"));
        await run.saving;
        const state = run.store.value;
        const value = {
          writes: run.writes.length,
          command: state.command,
          notice: state.notice?.text,
          draft: { id: state.areaDraft.id, name: state.areaDraft.name, dirty: state.areaDraft.dirty },
        };
        run.effects.dispose();
        return value;
      }, outcome);
      expect(settled.writes).toBe(1);
      if (outcome === "success") {
        expect(settled).toMatchObject({
          command: "idle",
          notice: "Area saved",
          draft: { id: "created-area", name: "New area draft", dirty: false },
        });
      } else {
        expect(settled).toMatchObject({
          command: "failed",
          notice: "Area could not be saved",
          draft: { id: null, name: "New area draft", dirty: true },
        });
      }
    });

    test(`held save_plan remains owned through pagehide and settles once (${outcome}) @safety`, async ({ page }) => {
      await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
      await page.clock.pauseAt(new Date("2026-09-30T12:00:00Z"));
      await createPendingMutation(page, "plan");
      const suspended = await suspendPendingMutation(page);
      expect(suspended).toEqual({
        command: "pending",
        notice: "Saving…",
        writes: 1,
        aborted: false,
        draft: { id: "daily", name: "Updated daily draft", dirty: true },
      });

      const settled = await page.evaluate(async (outcome) => {
        const run = window.__pageMutation;
        if (outcome === "success") run.pending.resolve(undefined);
        else run.pending.reject(new Error("synthetic save failure"));
        await run.saving;
        const state = run.store.value;
        const value = {
          writes: run.writes.length,
          write: run.writes[0],
          command: state.command,
          notice: state.notice?.text,
          draft: { id: state.planDraft.id, name: state.planDraft.name, dirty: state.planDraft.dirty },
        };
        run.effects.dispose();
        return value;
      }, outcome);
      expect(settled.writes).toBe(1);
      expect(settled.write).toMatchObject({
        kind: "plan",
        domain: "matic_robot",
        service: "save_plan",
        data: { plan_id: "daily", name: "Updated daily draft" },
      });
      if (outcome === "success") {
        expect(settled).toMatchObject({
          command: "idle",
          notice: "Plan saved",
          draft: { id: "daily", name: "Updated daily draft", dirty: false },
        });
      } else {
        expect(settled).toMatchObject({
          command: "failed",
          notice: "Plan save could not be confirmed. Check saved plans before trying again.",
          draft: { id: "daily", name: "Updated daily draft", dirty: true },
        });
      }
    });
  }

  test("new plan acknowledgement owns the created ID while hidden", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
    await page.clock.pauseAt(new Date("2026-09-30T12:00:00Z"));
    await createPendingMutation(page, "plan", { planId: null, planName: "New plan draft" });
    const suspended = await suspendPendingMutation(page);
    expect(suspended).toEqual({
      command: "pending",
      notice: "Saving…",
      writes: 1,
      aborted: false,
      draft: { id: null, name: "New plan draft", dirty: true },
    });

    const settled = await page.evaluate(async () => {
      const run = window.__pageMutation;
      // The cached catalog still selects "daily". Only the acknowledged
      // response owns the ID of a newly created plan while hidden.
      run.pending.resolve({ response: { plan: { id: "created-plan" } } });
      await run.saving;
      const state = run.store.value;
      const value = {
        writes: run.writes.length,
        write: run.writes[0],
        command: state.command,
        notice: state.notice?.text,
        selection: state.selection.planId,
        draft: { id: state.planDraft.id, name: state.planDraft.name, dirty: state.planDraft.dirty },
      };
      return value;
    });
    expect(settled.writes).toBe(1);
    expect(settled.write).toMatchObject({
      kind: "plan",
      domain: "matic_robot",
      service: "save_plan",
      data: { name: "New plan draft" },
    });
    expect(settled.write.data).not.toHaveProperty("plan_id");
    expect(settled).toMatchObject({
      command: "idle",
      notice: "Plan saved",
      selection: "created-plan",
      draft: { id: "created-plan", name: "New plan draft", dirty: false },
    });
  });

  test("hidden update-area acknowledgement keeps its saved name and geometry over stale catalog data @safety", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
    await page.clock.pauseAt(new Date("2026-09-30T12:00:00Z"));
    await createPendingMutation(page, "area-update");
    const suspended = await suspendPendingMutation(page);
    expect(suspended).toMatchObject({
      command: "pending",
      notice: "Saving area…",
      writes: 1,
      aborted: false,
      draft: { id: "entryway", name: "Updated entryway", dirty: true },
    });

    const settled = await page.evaluate(async () => {
      const run = window.__pageMutation;
      run.pending.resolve("entryway");
      await run.saving;
      const state = run.store.value;
      const value = {
        writes: run.writes.length,
        write: run.writes[0],
        command: state.command,
        notice: state.notice?.text,
        areaDraft: {
          id: state.areaDraft.id,
          name: state.areaDraft.name,
          dirty: state.areaDraft.dirty,
        },
        circles: state.draw.circles,
        drawDirty: state.draw.dirty,
        staleCatalogName: state.resources.areas.value?.areas.find((area) => area.id === "entryway")?.name,
      };
      run.effects.dispose();
      return value;
    });
    expect(settled.writes).toBe(1);
    expect(settled.write).toMatchObject({
      kind: "area",
      value: { areaId: "entryway", name: "Updated entryway", circles: [{ x: 2.4, y: 2.1, radius: 0.55 }] },
    });
    expect(settled).toMatchObject({
      command: "idle",
      notice: "Area saved",
      areaDraft: { id: "entryway", name: "Updated entryway", dirty: false },
      circles: [{ x: 2.4, y: 2.1, radius: 0.55 }],
      drawDirty: false,
      staleCatalogName: "Entryway",
    });
  });

  test("hidden reset cadence acknowledgement does not rehydrate its editor from a stale pre-write read @safety", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
    await page.clock.pauseAt(new Date("2026-09-30T12:00:00Z"));
    await createPendingMutation(page, "reset-cadence");
    await expect.poll(() => page.evaluate(() => Boolean(window.__pageMutation.planRead))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__pageMutation.writes.length)).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    const suspended = await page.evaluate(() => {
      const run = window.__pageMutation;
      return {
        command: run.store.value.command,
        readAborted: run.planRead.signal.aborted,
        catalogName: run.store.value.resources.plans.value?.plans[0]?.name,
        catalogSelection: run.store.value.resources.plans.value?.selectedPlan,
        draftName: run.store.value.planDraft.name,
        draftMopNext: run.store.value.planDraft.rooms[0]?.cadence?.doMopNext,
        draftMopProgress: run.store.value.planDraft.rooms[0]?.cadenceProgress?.mopProgress,
        plansCallCount: run.plansCallCount,
      };
    });
    expect(suspended).toEqual({
      command: "pending",
      readAborted: true,
      catalogName: "Stale cached plan name",
      catalogSelection: "other",
      draftName: "Retained clean editor",
      draftMopNext: true,
      draftMopProgress: 3,
      plansCallCount: expect.any(Number),
    });

    const settled = await page.evaluate(async () => {
      const run = window.__pageMutation;
      // A late result from a read begun before reset must not own reconciliation.
      run.planRead.resolve(run.planCatalog);
      await run.prewriteRead;
      run.pending.resolve(undefined);
      await run.reset;
      const state = run.store.value;
      const value = {
        writes: run.writes.length,
        write: run.writes[0],
        command: state.command,
        notice: state.notice?.text,
        draftName: state.planDraft.name,
        draftDirty: state.planDraft.dirty,
        draftRoomMode: state.planDraft.rooms[0]?.cleaningMode,
        catalogName: state.resources.plans.value?.plans[0]?.name,
        catalogSelection: state.resources.plans.value?.selectedPlan,
        draftMopNext: state.planDraft.rooms[0]?.cadence?.doMopNext,
        draftMopProgress: state.planDraft.rooms[0]?.cadenceProgress?.mopProgress,
        plansCallCount: run.plansCallCount,
      };
      return value;
    });
    expect(settled.writes).toBe(1);
    expect(settled.write).toMatchObject({
      kind: "plan",
      service: "reset_room_cadence",
      data: { plan: "daily", room_id: "room-a", modes: ["mop"] },
    });
    expect(settled).toEqual({
      writes: 1,
      write: expect.objectContaining({ service: "reset_room_cadence" }),
      command: "idle",
      notice: "Mopping progress reset",
      draftName: "Retained clean editor",
      draftDirty: false,
      draftRoomMode: "vacuum",
      catalogName: "Stale cached plan name",
      catalogSelection: "other",
      draftMopNext: true,
      draftMopProgress: 3,
      plansCallCount: suspended.plansCallCount,
    });

    await page.evaluate(() => {
      const run = window.__pageMutation;
      const daily = run.planCatalog.plans.find((plan) => plan.id === "daily");
      const updatedRoom = {
        ...daily.rooms[0],
        cadence: { ...daily.rooms[0].cadence, doMopNext: false },
        cadenceProgress: {
          ...daily.rooms[0].cadenceProgress,
          mopProgress: 0,
          mopDue: false,
          nextMopIn: 4,
          reasons: [],
        },
        cadenceReasons: [],
      };
      run.planCatalog = {
        ...run.planCatalog,
        selectedPlan: "other",
        plans: run.planCatalog.plans.map((plan) => plan.id === "daily"
          ? { ...plan, name: "Refreshed daily plan", rooms: [updatedRoom] }
          : plan),
      };
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await expect.poll(() => page.evaluate(() => {
      const state = window.__pageMutation.store.value;
      const room = state.planDraft.rooms[0];
      return {
        pageActive: state.pageActive,
        planStatus: state.resources.plans.status,
        selection: state.selection.planId,
        catalogSelection: state.resources.plans.value?.selectedPlan,
        draftName: state.planDraft.name,
        doMopNext: room?.cadence?.doMopNext,
        mopProgress: room?.cadenceProgress?.mopProgress,
        mopDue: room?.cadenceProgress?.mopDue,
      };
    })).toEqual({
      pageActive: true,
      planStatus: "ready",
      selection: "daily",
      catalogSelection: "other",
      draftName: "Refreshed daily plan",
      doMopNext: false,
      mopProgress: 0,
      mopDue: false,
    });
    await page.evaluate(() => window.__pageMutation.effects.dispose());
  });

  test("return-response plan saves request an acknowledgement and time out within the mutation bound", async ({ page }) => {
    await loadMutationHarness(page);
    await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
    await page.evaluate(async () => {
      const { MaticBackend } = await import("/page-mutation-ownership.js");
      const run = window.__backendDeadlineTest = {
        calls: [],
        timerIds: [],
        clearedTimerIds: [],
        nativeSetTimeout: window.setTimeout,
        nativeClearTimeout: window.clearTimeout,
        backend: null,
        pending: null,
      };
      window.setTimeout = ((callback, delay, ...args) => {
        const timerId = run.nativeSetTimeout(callback, delay, ...args);
        run.timerIds.push({ timerId, delay });
        return timerId;
      });
      window.clearTimeout = ((timerId) => {
        run.clearedTimerIds.push(timerId);
        return run.nativeClearTimeout(timerId);
      });
      run.backend = new MaticBackend(() => ({
        callService: (...args) => {
          run.calls.push(args);
          return new Promise(() => {});
        },
      }));
      run.pending = run.backend.service(
        "matic_robot",
        "save_plan",
        { name: "New plan draft" },
        "vacuum.synthetic",
        { returnResponse: true, acknowledgementTimeout: "mutation" },
      )
        .then(() => "resolved", (error) => error.code);
    });
    await page.clock.fastForward(20_000);
    const result = await page.evaluate(async () => {
      const run = window.__backendDeadlineTest;
      const error = await run.pending;
      run.backend.dispose();
      window.setTimeout = run.nativeSetTimeout;
      window.clearTimeout = run.nativeClearTimeout;
      return {
        error,
        calls: run.calls.map((args) => args.slice(0, 6)),
        timeoutCount: run.timerIds.filter(({ delay }) => delay === 20_000).length,
        timeoutCleared: run.timerIds.filter(({ delay, timerId }) => delay === 20_000
          && run.clearedTimerIds.includes(timerId)).length,
      };
    });
    expect(result.error).toBe("mutation-timeout");
    expect(result.calls).toEqual([[
      "matic_robot",
      "save_plan",
      { name: "New plan draft" },
      { entity_id: "vacuum.synthetic" },
      true,
      true,
    ]]);
    expect(result.timeoutCount).toBe(1);
    expect(result.timeoutCleared).toBe(1);
  });

  test("ordinary plan mutation times out once and ignores a late acknowledgement @safety", async ({ page }) => {
    await loadMutationHarness(page);
    await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
    await page.evaluate(async () => {
      const { EffectController, WorkspaceStore, createGalleryState, MaticBackend } = await import("/page-mutation-ownership.js");
      const base = createGalleryState("ready");
      const store = new WorkspaceStore();
      const run = window.__boundedPlanMutation = {
        calls: [],
        timerIds: [],
        clearedTimerIds: [],
        nativeSetTimeout: window.setTimeout,
        nativeClearTimeout: window.clearTimeout,
        resolveService: null,
        effects: null,
        backend: null,
        deleting: null,
        store,
      };
      window.setTimeout = ((callback, delay, ...args) => {
        const timerId = run.nativeSetTimeout(callback, delay, ...args);
        run.timerIds.push({ timerId, delay });
        return timerId;
      });
      window.clearTimeout = ((timerId) => {
        run.clearedTimerIds.push(timerId);
        return run.nativeClearTimeout(timerId);
      });
      const serviceBackend = new MaticBackend(() => ({
        callService: (...args) => {
          run.calls.push(args);
          return new Promise((resolve) => { run.resolveService = resolve; });
        },
      }));
      run.backend = {
        dispose: () => serviceBackend.dispose(),
        catalog: async () => [base.resources.entry],
        scene: async (_url, revision) => ({ revision, floorCoherent: true, scene: base.resources.scene.value }),
        history: async () => base.resources.history.value,
        pose: async () => ({ ...base.resources.pose.value, floorCoherent: true, mapSessionKey: base.resources.entry.mapSessionKey }),
        plans: async () => base.resources.plans.value,
        areas: async () => base.resources.areas.value,
        saveArea: async () => "unused-area",
        service: (...args) => serviceBackend.service(...args),
      };
      run.effects = new EffectController(store, run.backend);
      run.effects.sync({
        userKey: "synthetic-user",
        entryKey: "synthetic-entry",
        host: base.host,
        activity: "docked",
        batteryPercent: 92,
        robotLabel: base.robotLabel,
        robots: base.robots,
        language: "en",
        vacuumEntityId: "vacuum.synthetic",
      });
      await run.effects.refreshCatalog(true);
      store.patch({ selection: { ...store.value.selection, planId: "daily" } });
      run.deleting = run.effects.deletePlan();
    });
    await expect.poll(() => page.evaluate(() => window.__boundedPlanMutation.calls.length)).toBe(1);
    await page.clock.fastForward(20_000);
    await expect.poll(() => page.evaluate(() => window.__boundedPlanMutation.store.value.command)).toBe("failed");
    const timedOut = await page.evaluate(() => {
      const run = window.__boundedPlanMutation;
      return {
        command: run.store.value.command,
        notice: run.store.value.notice?.text,
        calls: run.calls.map((args) => args.slice()),
        timeoutCount: run.timerIds.filter(({ delay }) => delay === 20_000).length,
        timeoutCleared: run.timerIds.filter(({ delay, timerId }) => delay === 20_000
          && run.clearedTimerIds.includes(timerId)).length,
      };
    });
    expect(timedOut).toEqual({
      command: "failed",
      notice: "Plan could not be deleted",
      calls: [["matic_robot", "delete_plan", { plan: "daily" }, { entity_id: "vacuum.synthetic" }]],
      timeoutCount: 1,
      timeoutCleared: 1,
    });

    const afterLateAck = await page.evaluate(async () => {
      const run = window.__boundedPlanMutation;
      run.resolveService({});
      await run.deleting;
      const value = { command: run.store.value.command, notice: run.store.value.notice?.text, calls: run.calls.length };
      run.effects.dispose();
      window.setTimeout = run.nativeSetTimeout;
      window.clearTimeout = run.nativeClearTimeout;
      return value;
    });
    expect(afterLateAck).toEqual({ command: "failed", notice: "Plan could not be deleted", calls: 1 });
  });

  test("disposing a bounded service wait rejects with AbortError and clears its timer", async ({ page }) => {
    await loadMutationHarness(page);
    await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
    await page.evaluate(async () => {
      const { MaticBackend } = await import("/page-mutation-ownership.js");
      const run = window.__disposedServiceWait = {
        calls: [],
        timerIds: [],
        clearedTimerIds: [],
        nativeSetTimeout: window.setTimeout,
        nativeClearTimeout: window.clearTimeout,
        backend: null,
        pending: null,
      };
      window.setTimeout = ((callback, delay, ...args) => {
        const timerId = run.nativeSetTimeout(callback, delay, ...args);
        run.timerIds.push({ timerId, delay });
        return timerId;
      });
      window.clearTimeout = ((timerId) => {
        run.clearedTimerIds.push(timerId);
        return run.nativeClearTimeout(timerId);
      });
      run.backend = new MaticBackend(() => ({
        callService: (...args) => {
          run.calls.push(args);
          return new Promise(() => {});
        },
      }));
      run.pending = run.backend.service("matic_robot", "delete_plan", { plan: "daily" }, "vacuum.synthetic", {
        acknowledgementTimeout: "mutation",
      }).then(() => "resolved", (error) => error.name);
    });
    const result = await page.evaluate(async () => {
      const run = window.__disposedServiceWait;
      run.backend.dispose();
      const error = await run.pending;
      window.setTimeout = run.nativeSetTimeout;
      window.clearTimeout = run.nativeClearTimeout;
      return {
        error,
        calls: run.calls.map((args) => args.slice()),
        timeoutCount: run.timerIds.filter(({ delay }) => delay === 20_000).length,
        timeoutCleared: run.timerIds.filter(({ delay, timerId }) => delay === 20_000
          && run.clearedTimerIds.includes(timerId)).length,
      };
    });
    expect(result).toEqual({
      error: "AbortError",
      calls: [["matic_robot", "delete_plan", { plan: "daily" }, { entity_id: "vacuum.synthetic" }]],
      timeoutCount: 1,
      timeoutCleared: 1,
    });
  });

  test("managed service stays unbounded beyond the mutation deadline until acknowledged", async ({ page }) => {
    await loadMutationHarness(page);
    await page.clock.install({ time: new Date("2026-09-30T12:00:00Z") });
    await page.evaluate(async () => {
      const { MaticBackend } = await import("/page-mutation-ownership.js");
      const run = window.__unboundedManagedService = {
        calls: [],
        timerIds: [],
        nativeSetTimeout: window.setTimeout,
        nativeClearTimeout: window.clearTimeout,
        resolveService: null,
        backend: null,
        settled: false,
        pending: null,
      };
      window.setTimeout = ((callback, delay, ...args) => {
        const timerId = run.nativeSetTimeout(callback, delay, ...args);
        run.timerIds.push({ timerId, delay });
        return timerId;
      });
      run.backend = new MaticBackend(() => ({
        callService: (...args) => {
          run.calls.push(args);
          return new Promise((resolve) => { run.resolveService = resolve; });
        },
      }));
      run.pending = run.backend.service("matic_robot", "run_selected_plan", { plan: "daily" }, "vacuum.synthetic")
        .then((response) => { run.settled = true; return response; });
    });
    await page.clock.fastForward(25_000);
    const whilePending = await page.evaluate(() => ({
      settled: window.__unboundedManagedService.settled,
      callCount: window.__unboundedManagedService.calls.length,
      callArgCount: window.__unboundedManagedService.calls[0]?.length,
      timers: window.__unboundedManagedService.timerIds.length,
    }));
    expect(whilePending).toEqual({ settled: false, callCount: 1, callArgCount: 4, timers: 0 });
    const settled = await page.evaluate(async () => {
      const run = window.__unboundedManagedService;
      run.resolveService({ accepted: true });
      const response = await run.pending;
      run.backend.dispose();
      window.setTimeout = run.nativeSetTimeout;
      window.clearTimeout = run.nativeClearTimeout;
      return { settled: run.settled, response, callCount: run.calls.length };
    });
    expect(settled).toEqual({ settled: true, response: { accepted: true }, callCount: 1 });
  });
});
