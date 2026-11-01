import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadAreaMutationHarness(page) {
  const bundle = await build({
    stdin: {
      contents: `
        export { EffectController } from "./frontend/map-studio-v4/effects";
        export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { selectPrimaryAction } from "./frontend/map-studio-v4/workflow-actions";
        export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/area-mutation-ownership.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

async function createPendingAreaSave(page, { holdPlans = false, existingAreaId = null } = {}) {
  await loadAreaMutationHarness(page);
  await page.evaluate(async ({ holdPlans, existingAreaId }) => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/area-mutation-ownership.js");
    const base = createGalleryState("ready");
    const store = new WorkspaceStore();
    const run = window.__areaMutationOwnership = {
      entry: { ...base.resources.entry, deltaUrl: null },
      catalogCalls: 0,
      holdPlans,
      saves: [],
      store,
      effects: null,
    };
    const backend = {
      dispose() {},
      catalog: async () => { run.catalogCalls += 1; return [run.entry]; },
      scene: async (_url, revision) => ({
        revision,
        floorCoherent: true,
        scene: base.resources.scene.value,
      }),
      history: async () => base.resources.history.value,
      pose: async () => ({
        ...base.resources.pose.value,
        floorCoherent: true,
        mapSessionKey: run.entry.mapSessionKey,
      }),
      plans: (_url, signal) => run.holdPlans
        ? new Promise((resolve) => { run.pendingPlans = { signal, resolve }; })
        : Promise.resolve(base.resources.plans.value),
      areas: async () => base.resources.areas.value,
      saveArea: (_path, value, signal) => new Promise((resolve, reject) => {
        run.saves.push({ value, signal, resolve, reject });
      }),
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
    const current = store.value;
    store.patch({
      workflow: "areaReview",
      areaDraft: { ...current.areaDraft, id: existingAreaId, name: existingAreaId ? "Hallway" : "First area", status: existingAreaId ? "stale" : "new", canRebind: Boolean(existingAreaId), dirty: !existingAreaId },
      draw: { ...current.draw, circles: [{ x: 1, y: 1, radius: 0.2 }], dirty: true },
    });
    run.saving = run.effects.saveArea();
  }, { holdPlans, existingAreaId });
}

test("confirming a stale area writes its existing ID so the backend replaces its binding", async ({ page }) => {
  await createPendingAreaSave(page, { existingAreaId: "hallway-saved-id" });
  const result = await page.evaluate(() => {
    const run = window.__areaMutationOwnership;
    const request = run.saves[0].value;
    run.effects.dispose();
    return { areaId: request.areaId, name: request.name };
  });
  expect(result).toEqual({ areaId: "hallway-saved-id", name: "Hallway" });
});

async function replaceEntry(page, update) {
  const generation = await page.evaluate((changes) => {
    const run = window.__areaMutationOwnership;
    const before = run.store.value.generation;
    run.entry = { ...run.entry, ...changes };
    void run.effects.refreshCatalog(true);
    return before;
  }, update);
  await expect.poll(() => page.evaluate((before) =>
    window.__areaMutationOwnership.store.value.generation > before,
  generation)).toBe(true);
}

test.describe("area save ownership across map transitions", () => {
  for (const outcome of ["success", "error"]) {
    test(`same-floor map-session change suppresses a late ${outcome}`, async ({ page }) => {
      await createPendingAreaSave(page);
      await expect.poll(() => page.evaluate(() => window.__areaMutationOwnership.saves.length)).toBe(1);

      await replaceEntry(page, { mapRevision: 8, mapSessionKey: "b".repeat(64) });
      const result = await page.evaluate(async (outcome) => {
        const run = window.__areaMutationOwnership;
        const save = run.saves[0];
        const afterTransition = {
          aborted: save.signal.aborted,
          workflow: run.store.value.workflow,
          notice: run.store.value.notice?.key,
        };
        if (outcome === "success") save.resolve("old-session-area");
        else save.reject(new Error("late old-session failure"));
        await run.saving;
        const afterLateResult = {
          workflow: run.store.value.workflow,
          command: run.store.value.command,
          notice: run.store.value.notice?.key,
          areaId: run.store.value.areaDraft.id,
        };
        run.effects.dispose();
        return { afterTransition, afterLateResult };
      }, outcome);

      expect(result.afterTransition).toMatchObject({
        aborted: true,
        workflow: "none",
        notice: "v4_notice_map_changed",
      });
      expect(result.afterLateResult).toEqual({
        workflow: "none",
        command: "idle",
        notice: "v4_notice_map_changed",
        areaId: null,
      });
    });
  }

  test("same-session revision refresh keeps the pending area save valid", async ({ page }) => {
    await createPendingAreaSave(page);
    await replaceEntry(page, { mapRevision: 8 });
    const result = await page.evaluate(async () => {
      const run = window.__areaMutationOwnership;
      const save = run.saves[0];
      save.resolve("same-session-area");
      await run.saving;
      const value = {
        aborted: save.signal.aborted,
        workflow: run.store.value.workflow,
        notice: run.store.value.notice?.key,
        areaId: run.store.value.areaDraft.id,
        areaDirty: run.store.value.areaDraft.dirty,
      };
      run.effects.dispose();
      return value;
    });
    expect(result).toEqual({
      aborted: false,
      workflow: "areaReview",
      notice: "v4_notice_area_saved",
      areaId: "same-session-area",
      areaDirty: false,
    });
  });

  test("unverified same-floor transition keeps floor-scoped plans read in flight", async ({ page }) => {
    await createPendingAreaSave(page, { holdPlans: true });
    // Plans are lazy: explicitly start the read whose ownership this test exercises.
    await page.evaluate(() => { void window.__areaMutationOwnership.effects.loadPlans(); });
    await expect.poll(() => page.evaluate(() => Boolean(window.__areaMutationOwnership.pendingPlans))).toBe(true);

    await replaceEntry(page, { mapSessionVerified: false, mapSessionKey: null });
    const duringRecheck = await page.evaluate(() => {
      const run = window.__areaMutationOwnership;
      return {
        aborted: run.pendingPlans.signal.aborted,
        status: run.store.value.resources.plans.status,
      };
    });
    expect(duringRecheck).toEqual({ aborted: false, status: "loading" });

    await page.evaluate(() => {
      const run = window.__areaMutationOwnership;
      run.pendingPlans.resolve({
        rooms: [], plans: [], selectedPlan: null,
      });
    });
    await expect.poll(() => page.evaluate(() => window.__areaMutationOwnership.store.value.resources.plans.status)).toBe("ready");
    const result = await page.evaluate(async () => {
      const run = window.__areaMutationOwnership;
      run.saves[0].reject(new DOMException("Aborted", "AbortError"));
      await run.saving;
      const value = {
        aborted: run.pendingPlans.signal.aborted,
        status: run.store.value.resources.plans.status,
      };
      run.effects.dispose();
      return value;
    });
    expect(result).toEqual({ aborted: false, status: "ready" });
  });

  test("floor switch aborts the area save and preserves the transition notice", async ({ page }) => {
    await createPendingAreaSave(page);
    await replaceEntry(page, { selectedFloorOrdinal: 2, mapFloorOrdinal: 2, mapRevision: 8 });
    const result = await page.evaluate(async () => {
      const run = window.__areaMutationOwnership;
      const save = run.saves[0];
      save.reject(new Error("late old-floor failure"));
      await run.saving;
      const value = {
        aborted: save.signal.aborted,
        workflow: run.store.value.workflow,
        notice: run.store.value.notice?.key,
        areaId: run.store.value.areaDraft.id,
      };
      run.effects.dispose();
      return value;
    });
    expect(result).toEqual({
      aborted: true,
      workflow: "none",
      notice: "v4_notice_map_changed",
      areaId: null,
    });
  });

  test("late same-session save does not replace a later area draft", async ({ page }) => {
    await createPendingAreaSave(page);
    const result = await page.evaluate(async () => {
      const run = window.__areaMutationOwnership;
      const save = run.saves[0];
      const laterDraft = { ...run.store.value.areaDraft, name: "Later area", dirty: true };
      run.store.patch({ areaDraft: laterDraft });
      save.resolve("first-area");
      await run.saving;
      const value = {
        draft: run.store.value.areaDraft,
        notice: run.store.value.notice?.key,
        workflow: run.store.value.workflow,
      };
      run.effects.dispose();
      return value;
    });
    expect(result).toEqual({
      draft: expect.objectContaining({ id: null, name: "Later area", dirty: true }),
      notice: "v4_notice_area_saved",
      workflow: "areaReview",
    });
  });
});

// plan.md §9 and shell.md §6: a failed Home Assistant write returns `command`
// to idle with its notice, so "Check robot status" follows only a robot command.
test.describe("a failed area write", () => {
  for (const write of ["save", "delete"]) {
    test(`a failed area ${write} returns to idle and keeps the area review primary`, async ({ page }) => {
      await loadAreaMutationHarness(page);
      const result = await page.evaluate(async (write) => {
        const { EffectController, WorkspaceStore, createGalleryState, selectPrimaryAction } = await import("/area-mutation-ownership.js");
        const base = createGalleryState("ready");
        const store = new WorkspaceStore();
        const unavailable = async () => { throw new Error("Unavailable"); };
        const effects = new EffectController(store, {
          dispose() {},
          catalog: async () => [{ ...base.resources.entry, deltaUrl: null }],
          scene: async (_url, revision) => ({ revision, floorCoherent: true, scene: base.resources.scene.value }),
          history: async () => base.resources.history.value,
          pose: async () => ({ ...base.resources.pose.value, floorCoherent: true, mapSessionKey: base.resources.entry.mapSessionKey }),
          plans: async () => base.resources.plans.value,
          areas: async () => base.resources.areas.value,
          saveArea: unavailable,
          deleteArea: unavailable,
        });
        effects.sync({ userKey: "synthetic-user", entryKey: "synthetic-entry", host: base.host, activity: "docked", batteryPercent: 92,
          robotLabel: base.robotLabel, robots: base.robots, language: "en", vacuumEntityId: "vacuum.synthetic" });
        await effects.refreshCatalog(true);
        const current = store.value;
        if (write === "save") {
          store.patch({
            workflow: "areaReview",
            areaDraft: { ...current.areaDraft, id: null, name: "First area", dirty: true },
            draw: { ...current.draw, circles: [{ x: 1, y: 1, radius: 0.2 }], dirty: true },
          });
          await effects.saveArea();
        } else {
          store.patch({
            workflow: "areaReview",
            selection: { ...current.selection, areaId: "entryway" },
            areaDraft: { ...current.areaDraft, id: "entryway", name: "Entryway", status: "current", canRebind: false, dirty: false },
          });
          await effects.deleteArea();
        }
        const value = { command: store.value.command, notice: store.value.notice?.key, primary: selectPrimaryAction(store.value).id };
        effects.dispose();
        return value;
      }, write);
      expect(result).toEqual(write === "save"
        ? { command: "idle", notice: "v4_notice_area_save_failed", primary: "save-area" }
        : { command: "idle", notice: "v4_notice_area_delete_failed", primary: "run-area" });
    });
  }
});
