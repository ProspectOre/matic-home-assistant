import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadStopHarness(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore, canStopMotion, initialWorkspaceState, selectPrimaryAction } from "./frontend/map-studio-v4/state"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/stop-identity-test.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

test("@safety active selected vacuum remains stoppable when its catalog is unavailable", async ({ page }) => {
  await loadStopHarness(page);
  const result = await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, canStopMotion, initialWorkspaceState, selectPrimaryAction } =
      await import("/stop-identity-test.js");
    const initial = initialWorkspaceState();
    const selectedEntryId = "synthetic-entry-b";
    const robots = [
      { entryId: "synthetic-entry", label: "Robot A" },
      { entryId: selectedEntryId, label: "Robot B" },
    ];
    const host = { ...initial.host, connected: true, administrator: true, robotConnected: true, robotCount: 2 };
    const store = new WorkspaceStore({
      ...initial,
      activity: "cleaning",
      host,
      robots,
      resources: {
        ...initial.resources,
        catalog: { status: "error", value: null, problem: "catalog-unavailable" },
        entry: null,
      },
    });
    const calls = [];
    let catalogReads = 0;
    const effects = new EffectController(store, {
      catalog: async () => {
        catalogReads += 1;
        throw new Error("synthetic catalog unavailable");
      },
      service: async (domain, service, data, entityId) => calls.push({ domain, service, data, entityId }),
      dispose() {},
    }, null, false);
    const projection = {
      host,
      activity: "cleaning",
      batteryPercent: 61,
      robotLabel: "Robot B",
      robots,
      language: "en",
      userKey: "stop-identity-test",
      entryKey: selectedEntryId,
      vacuumEntityId: "vacuum.synthetic_b",
    };
    try {
      effects.sync(projection);
      await effects.refreshCatalog(true);
      const action = selectPrimaryAction(store.value);
      const reachable = canStopMotion(store.value);
      await effects.executeAction("stop");
      return {
        catalogStatus: store.value.resources.catalog.status,
        catalogReads,
        selectedEntryId: store.value.selection.entryId,
        resourceEntry: store.value.resources.entry?.entryId ?? null,
        reachable,
        action: { id: action.id, enabled: action.enabled },
        calls,
      };
    } finally {
      effects.dispose();
    }
  });

  expect(result).toMatchObject({
    catalogStatus: "error",
    catalogReads: 1,
    selectedEntryId: "synthetic-entry-b",
    resourceEntry: null,
    reachable: true,
    action: { id: "stop", enabled: true },
    calls: [{
      domain: "matic_robot",
      service: "stop_intelligent_cleaning",
      data: { include_unmanaged: true },
      entityId: "vacuum.synthetic_b",
    }],
  });
  expect(result.calls).toHaveLength(1);
});

test("@safety stale catalog work cannot stop idle B, while active B stops only B", async ({ page }) => {
  await loadStopHarness(page);
  const result = await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, canStopMotion, createGalleryState, selectPrimaryAction } =
      await import("/stop-identity-test.js");
    const gallery = createGalleryState("ready");
    const initial = { ...gallery, selection: { ...gallery.selection, entryId: null } };
    const selectedEntryId = "synthetic-entry-b";
    const robots = [
      { entryId: "synthetic-entry", label: "Robot A" },
      { entryId: selectedEntryId, label: "Robot B" },
    ];
    const host = { ...initial.host, connected: true, administrator: true, robotConnected: true, robotCount: 2 };
    const staleCatalogEntry = {
      ...initial.resources.entry,
      entryId: "synthetic-entry",
      activePlan: true,
      runnerLocked: true,
    };
    const store = new WorkspaceStore({
      ...initial,
      activity: "docked",
      host,
      robots,
      resources: { ...initial.resources, entry: staleCatalogEntry },
    });
    const calls = [];
    const effects = new EffectController(store, {
      catalog: async () => [staleCatalogEntry],
      service: async (domain, service, data, entityId) => calls.push({ domain, service, data, entityId }),
      dispose() {},
    }, null, false);
    const projection = {
      host,
      activity: "docked",
      batteryPercent: 61,
      robotLabel: "Robot B",
      robots,
      language: "en",
      userKey: "stop-identity-test",
      entryKey: selectedEntryId,
      vacuumEntityId: "vacuum.synthetic_b",
    };
    try {
      effects.sync(projection);
      const idle = {
        allowed: canStopMotion(store.value),
        action: selectPrimaryAction(store.value),
        selectedEntryId: store.value.selection.entryId,
        resourceEntryId: store.value.resources.entry?.entryId ?? null,
      };
      await effects.executeAction("stop");
      effects.sync({ ...projection, activity: "cleaning" });
      const active = {
        allowed: canStopMotion(store.value),
        action: selectPrimaryAction(store.value),
        selectedEntryId: store.value.selection.entryId,
        resourceEntryId: store.value.resources.entry?.entryId ?? null,
      };
      await effects.executeAction("stop");
      return {
        idle: { ...idle, action: { id: idle.action.id, enabled: idle.action.enabled } },
        active: { ...active, action: { id: active.action.id, enabled: active.action.enabled } },
        calls,
      };
    } finally {
      effects.dispose();
    }
  });

  expect(result.idle.allowed).toBe(false);
  expect(result.idle.action.id).not.toBe("stop");
  expect(result.idle.selectedEntryId).toBe("synthetic-entry-b");
  expect(result.idle.resourceEntryId).toBe("synthetic-entry");
  expect(result.calls).toHaveLength(1);
  expect(result.active).toMatchObject({
    allowed: true,
    action: { id: "stop", enabled: true },
    selectedEntryId: "synthetic-entry-b",
    resourceEntryId: "synthetic-entry",
  });
  expect(result.calls).toEqual([{
    domain: "matic_robot",
    service: "stop_intelligent_cleaning",
    data: { include_unmanaged: true },
    entityId: "vacuum.synthetic_b",
  }]);
});
