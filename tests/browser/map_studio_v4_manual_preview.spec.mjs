import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export { MaticBackend } from "./frontend/map-studio-v4/backend";
      export { EffectController } from "./frontend/map-studio-v4/effects";
      export { WorkspaceStore, manualRoomPreviewKey } from "./frontend/map-studio-v4/state";
      export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
      export { syntheticEntry } from "./frontend/map-studio-v4/synthetic-fixtures";`,
    resolveDir: process.cwd(),
  },
  bundle: true, format: "esm", write: false,
});

const preview = (entryId = "synthetic-entry", token = "a", mode = "vacuum") => ({
  entryId,
  floorToken: "f".repeat(64),
  previewToken: token.repeat(64),
  rooms: [{ roomId: "room-a", name: "Kitchen", cleaningMode: mode, coverageSetting: "standard", cadenceReasons: [] }],
  missionBoundaries: [],
  blocker: null,
});

async function setupEffects(page, { initialPreview = null, previewProvider } = {}) {
  await page.route("**/manual-preview-test.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  await page.evaluate(async ({ initialPreview, providerSource }) => {
    const { EffectController, WorkspaceStore, createGalleryState, manualRoomPreviewKey } = await import("/manual-preview-test.js");
    const galleryState = createGalleryState("rooms");
    const base = { ...galleryState, selection: {
      ...galleryState.selection,
      roomIds: ["room-a"],
      roomSettings: [{ roomId: "room-a", cleaningMode: "vacuum", coverageSetting: "standard" }],
    } };
    const state = {
      ...base,
      manualRoomPreview: initialPreview
        ? { status: "ready", value: {
            key: manualRoomPreviewKey(base),
            generation: base.generation, floorKey: "1:1:coherent",
            missionKey: `1:verified:${"a".repeat(64)}`, preview: initialPreview,
          }, problem: null }
        : { status: "idle", value: null, problem: null },
    };
    const store = new WorkspaceStore(state);
    const projection = { host: state.host, activity: state.activity, batteryPercent: 92, robotLabel: "Synthetic",
      robots: state.robots, language: "en", userKey: "manual-preview-test", entryKey: "synthetic-entry",
      vacuumEntityId: "vacuum.synthetic" };
    window.manualPreviewHarness = { state, store, projection, calls: [], previews: [], pending: [], previewCountAtService: [], effects: null };
    window.manualPreviewHarness.previewProvider = new Function(`return (${providerSource})`)();
    window.manualPreviewHarness.effects = new EffectController(store, {
      catalog: async () => new Promise(() => {}),
      history: async () => state.resources.history.value,
      plans: async () => state.resources.plans.value,
      areas: async () => state.resources.areas.value,
      scene: async () => ({ scene: state.resources.scene.value, revision: 7, floorCoherent: true }),
      pose: async () => state.resources.pose.value,
      previewRoomSequence: async (...args) => {
        const h = window.manualPreviewHarness;
        h.previews.push(args.slice(0, 3));
        return await h.previewProvider();
      },
      service: async (...args) => {
        const h = window.manualPreviewHarness;
        h.calls.push(args);
        h.previewCountAtService.push(h.previews.length);
      },
      dispose() {},
    });
    window.manualPreviewHarness.effects.sync(projection);
  }, { initialPreview, providerSource: previewProvider?.toString() ?? `async () => (${JSON.stringify(preview())})` });
  return page;
}

test("@safety uses the HA websocket response envelope and sends a read-only scheduled preview", async ({ page }) => {
  await page.route("**/backend-contract-test.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { MaticBackend } = await import("/backend-contract-test.js");
    let message;
    const hass = { connection: { sendMessagePromise: async (request) => {
      message = request;
      return { context: {}, response: {
        entry_id: "synthetic-entry", floor_token: "f".repeat(64), preview_token: "a".repeat(64),
        rooms: [{ room_id: "room-a", name: "Kitchen", cleaning_mode: "mop", coverage_setting: "heavy_duty", cadence_reasons: ["mop_due"] }],
        mission_boundaries: [], blocker: null,
      } };
    } } };
    const backend = new MaticBackend(() => hass);
    const parsed = await backend.previewRoomSequence("vacuum.synthetic", [
      { room: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" },
    ], true);
    backend.dispose();
    return { message, parsed };
  });
  expect(result.message).toEqual({
    type: "call_service", domain: "matic_robot", service: "preview_room_sequence",
    target: { entity_id: "vacuum.synthetic" },
    service_data: { rooms: [{ room: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" }],
      use_room_schedule: true, override_room_schedule: true },
    return_response: true,
  });
  expect(result.parsed.floorToken).toBe("f".repeat(64));
  expect(result.parsed.rooms[0]).toMatchObject({ roomId: "room-a", cleaningMode: "mop", coverageSetting: "heavy_duty", cadenceReasons: ["mop_due"] });
});

test("@safety serializes concurrent requests and skips an aborted queued waiter", async ({ page }) => {
  await page.route("**/backend-queue-test.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { MaticBackend } = await import("/backend-queue-test.js");
    const calls = [];
    const pending = [];
    let active = 0;
    let maximumActive = 0;
    const response = (token) => ({ context: {}, response: {
      entry_id: "synthetic-entry", floor_token: "f".repeat(64), preview_token: token.repeat(64),
      rooms: [{ room_id: "room-a", name: "Kitchen", cleaning_mode: "vacuum", coverage_setting: "standard", cadence_reasons: [] }],
      mission_boundaries: [], blocker: null,
    } });
    const connection = { sendMessagePromise: async (message) => {
      calls.push(message);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return await new Promise(resolve => pending.push(value => { active -= 1; resolve(value); }));
    } };
    const backend = new MaticBackend(() => ({ connection }));
    const args = ["vacuum.synthetic", [{ room: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" }], false];
    const a = backend.previewRoomSequence(...args);
    const canceled = new AbortController();
    const b = backend.previewRoomSequence(...args, canceled.signal).catch(error => error.name);
    const c = backend.previewRoomSequence(...args);
    await new Promise(resolve => setTimeout(resolve, 0));
    canceled.abort();
    pending[0](response("a"));
    await a;
    for (let i = 0; i < 20 && calls.length < 2; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    pending[1](response("c"));
    await Promise.all([b, c]);
    const afterCanceled = calls.length;

    const d = backend.previewRoomSequence(...args);
    const e = backend.previewRoomSequence(...args);
    const f = backend.previewRoomSequence(...args);
    for (let i = 0; i < 20 && calls.length < 3; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    pending[2](response("d"));
    await d;
    for (let i = 0; i < 20 && calls.length < 4; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    pending[3](response("e"));
    await e;
    for (let i = 0; i < 20 && calls.length < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    pending[4](response("f"));
    await f;
    backend.dispose();
    return { calls: calls.length, afterCanceled, maximumActive };
  });
  expect(result).toEqual({ calls: 5, afterCanceled: 2, maximumActive: 1 });
});

test("@safety a generation and selection change discard old responses before admitting the latest preview", async ({ page }) => {
  const completed = await setupEffects(page, { previewProvider: async () => new Promise(resolve => { window.manualPreviewHarness.pending.push(resolve); }) });
  const result = await completed.evaluate(async () => {
    const h = window.manualPreviewHarness;
    // Let the first request attach its resolver before invalidating its generation.
    for (let i = 0; i < 20 && h.pending.length < 1; i++) await new Promise(resolve => setTimeout(resolve, 0));
    const generation = h.store.value.generation;
    h.store.patch({ generation: generation + 1 });
    for (let i = 0; i < 20 && h.pending.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 0));
    h.pending[0]({ entryId: "synthetic-entry", floorToken: "f".repeat(64), previewToken: "b".repeat(64), rooms: [{ roomId: "room-a", name: "Kitchen", cleaningMode: "vacuum", coverageSetting: "standard", cadenceReasons: [] }], missionBoundaries: [], blocker: null });
    await new Promise(resolve => setTimeout(resolve, 0));
    const afterGenerationLate = h.store.value.manualRoomPreview.value?.preview.previewToken ?? null;
    h.store.patch({ selection: { ...h.store.value.selection,
      roomSettings: [{ roomId: "room-a", cleaningMode: "mop", coverageSetting: "standard" }] } });
    for (let i = 0; i < 20 && h.pending.length < 3; i++) await new Promise(resolve => setTimeout(resolve, 0));
    h.pending[1]({ entryId: "synthetic-entry", floorToken: "f".repeat(64), previewToken: "c".repeat(64), rooms: [{ roomId: "room-a", name: "Kitchen", cleaningMode: "vacuum", coverageSetting: "standard", cadenceReasons: [] }], missionBoundaries: [], blocker: null });
    await new Promise(resolve => setTimeout(resolve, 0));
    const afterSelectionLate = h.store.value.manualRoomPreview.value?.preview.previewToken ?? null;
    h.pending[2]({ entryId: "synthetic-entry", floorToken: "f".repeat(64), previewToken: "d".repeat(64), rooms: [{ roomId: "room-a", name: "Kitchen", cleaningMode: "mop", coverageSetting: "standard", cadenceReasons: [] }], missionBoundaries: [], blocker: null });
    for (let i = 0; i < 20 && h.store.value.manualRoomPreview.value?.preview.previewToken !== "d".repeat(64); i++) await new Promise(resolve => setTimeout(resolve, 0));
    const admitted = h.store.value.manualRoomPreview.value;
    h.effects.dispose();
    return { generationCalls: h.previews.length, afterGenerationLate, afterSelectionLate,
      admittedToken: admitted?.preview.previewToken, admittedGeneration: admitted?.generation,
      currentGeneration: h.store.value.generation };
  });
  expect(result).toMatchObject({ generationCalls: 3, afterGenerationLate: null, afterSelectionLate: null,
    admittedToken: "d".repeat(64), admittedGeneration: result.currentGeneration });
});

test("@safety preflight dispatches once with a fresh token when the effective preview is unchanged", async ({ page }) => {
  await setupEffects(page, { initialPreview: preview("synthetic-entry", "a"),
    previewProvider: async () => new Promise(resolve => { window.manualPreviewHarness.pending.push(resolve); }) });
  const result = await page.evaluate(async () => {
    const h = window.manualPreviewHarness;
    const first = h.effects.executeAction("clean-rooms");
    for (let i = 0; i < 20 && h.pending.length < 1; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    const second = h.effects.executeAction("clean-rooms");
    h.pending[0]({ entryId: "synthetic-entry", floorToken: "f".repeat(64), previewToken: "b".repeat(64), rooms: [{ roomId: "room-a", name: "Kitchen", cleaningMode: "vacuum", coverageSetting: "standard", cadenceReasons: [] }], missionBoundaries: [], blocker: null });
    await Promise.all([first, second]);
    const output = { previewCalls: h.previews.length, previewCountAtService: h.previewCountAtService[0], serviceCalls: h.calls.length,
      service: h.calls[0]?.[1], token: h.calls[0]?.[2]?.preview_token };
    h.effects.dispose();
    return output;
  });
  expect(result).toEqual({ previewCalls: 2, previewCountAtService: 1, serviceCalls: 1, service: "clean_room_sequence", token: "b".repeat(64) });
});

test("@safety changed server preview is shown and blocks motion", async ({ page }) => {
  await setupEffects(page, { initialPreview: preview("synthetic-entry", "a"),
    previewProvider: `async () => (${JSON.stringify(preview("synthetic-entry", "b", "mop"))})` });
  const result = await page.evaluate(async () => {
    const h = window.manualPreviewHarness;
    await h.effects.executeAction("clean-rooms");
    const output = { serviceCalls: h.calls.length, notice: h.store.value.notice?.text,
      mode: h.store.value.manualRoomPreview.value?.preview.rooms[0]?.cleaningMode };
    h.effects.dispose();
    return output;
  });
  expect(result).toEqual({ serviceCalls: 0, notice: "The room preview changed. Review the updated settings before starting.", mode: "mop" });
});

test("@safety administrator loss discards a late preview without state or notices", async ({ page }) => {
  await setupEffects(page, { previewProvider: async () => new Promise(resolve => { window.manualPreviewHarness.pending.push(resolve); }) });
  const result = await page.evaluate(async () => {
    const h = window.manualPreviewHarness;
    for (let i = 0; i < 20 && h.pending.length < 1; i++) await new Promise(resolve => setTimeout(resolve, 0));
    h.effects.sync({ ...h.projection, host: { ...h.projection.host, administrator: false } });
    h.pending[0]({ entryId: "synthetic-entry", floorToken: "f".repeat(64), previewToken: "c".repeat(64), rooms: [{ roomId: "room-a", name: "Kitchen", cleaningMode: "vacuum", coverageSetting: "standard", cadenceReasons: [] }], missionBoundaries: [], blocker: null });
    await new Promise(resolve => setTimeout(resolve, 0));
    const output = { status: h.store.value.manualRoomPreview.status,
      value: h.store.value.manualRoomPreview.value, notice: h.store.value.notice,
      calls: h.calls.length };
    h.effects.dispose();
    return output;
  });
  expect(result).toEqual({ status: "idle", value: null, notice: null, calls: 0 });
});

test("@safety retrying a failed preview admits a fresh response without exposing the raw error", async ({ page }) => {
  await setupEffects(page, { previewProvider: async () => {
    const h = window.manualPreviewHarness;
    h.attempts = (h.attempts ?? 0) + 1;
    if (h.attempts === 1) throw new Error("synthetic backend rejection detail");
    return { entryId: "synthetic-entry", floorToken: "f".repeat(64), previewToken: "d".repeat(64),
      rooms: [{ roomId: "room-a", name: "Kitchen", cleaningMode: "vacuum", coverageSetting: "standard", cadenceReasons: [] }],
      missionBoundaries: [], blocker: null };
  } });
  const result = await page.evaluate(async () => {
    const h = window.manualPreviewHarness;
    for (let i = 0; i < 20 && h.store.value.manualRoomPreview.status !== "error"; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    const before = h.store.value.manualRoomPreview;
    h.store.dispatch({ type: "retry-room-preview" });
    for (let i = 0; i < 20 && h.store.value.manualRoomPreview.status !== "ready"; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    const after = h.store.value.manualRoomPreview;
    const output = { before: before.status, attempts: h.attempts, after: after.status,
      token: after.value?.preview.previewToken, notice: h.store.value.notice?.text ?? null };
    h.effects.dispose();
    return output;
  });
  expect(result).toEqual({ before: "error", attempts: 2, after: "ready", token: "d".repeat(64), notice: null });
});

test("@safety saved-plan dispatch carries the refreshed authoritative preview token", async ({ page }) => {
  await page.route("**/saved-plan-token-test.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/saved-plan-token-test.js");
    const base = createGalleryState("ready");
    const token = "e".repeat(64);
    const catalog = {
      ...base.resources.plans.value,
      plans: base.resources.plans.value.plans.map((plan) => ({
        ...plan, nextRunPreview: { ...plan.nextRunPreview, previewToken: token },
      })),
    };
    const initial = { ...base, workflow: "plan", resources: {
      ...base.resources, plans: { status: "ready", value: catalog, problem: null },
    } };
    const store = new WorkspaceStore(initial);
    const calls = [];
    const effects = new EffectController(store, {
      catalog: async () => [initial.resources.entry],
      plans: async () => catalog,
      history: async () => initial.resources.history.value,
      scene: async () => { throw new DOMException("Aborted", "AbortError"); },
      pose: async () => { throw new DOMException("Aborted", "AbortError"); },
      service: async (...args) => calls.push(args),
      dispose() {},
    });
    effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92,
      robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test",
      entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
    try {
      await effects.refreshCatalog(true);
      await effects.executeAction("run-plan");
      return { calls, notice: store.value.notice?.text ?? null };
    } finally { effects.dispose(); }
  });
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0][1]).toBe("run_selected_plan");
  expect(result.calls[0][2]).toMatchObject({ plan: "daily", preview_token: "e".repeat(64) });
  expect(result.notice).toBeNull();
});

test("@safety a changed saved-plan preview token updates the preview without starting motion", async ({ page }) => {
  await page.route("**/saved-plan-token-change-test.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/saved-plan-token-change-test.js");
    const base = createGalleryState("ready");
    const withToken = (token) => ({ ...base.resources.plans.value, plans: base.resources.plans.value.plans.map((plan) => ({
      ...plan, nextRunPreview: { ...plan.nextRunPreview, previewToken: token },
    })) });
    const initialPlans = withToken("a".repeat(64));
    const refreshedPlans = withToken("b".repeat(64));
    const initial = { ...base, workflow: "plan", resources: {
      ...base.resources, plans: { status: "ready", value: initialPlans, problem: null },
    } };
    const store = new WorkspaceStore(initial);
    const calls = [];
    const effects = new EffectController(store, {
      catalog: async () => [initial.resources.entry], plans: async () => refreshedPlans,
      history: async () => initial.resources.history.value,
      scene: async () => { throw new DOMException("Aborted", "AbortError"); },
      pose: async () => { throw new DOMException("Aborted", "AbortError"); },
      service: async (...args) => calls.push(args), dispose() {},
    });
    effects.sync({ host: initial.host, activity: initial.activity, batteryPercent: 92,
      robotLabel: "Synthetic", robots: initial.robots, language: "en", userKey: "test",
      entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.synthetic" });
    try {
      await effects.refreshCatalog(true);
      await effects.executeAction("run-plan");
      return { calls, notice: store.value.notice?.text,
        token: store.value.resources.plans.value?.plans[0]?.nextRunPreview?.previewToken };
    } finally { effects.dispose(); }
  });
  expect(result).toEqual({ calls: [],
    notice: "The next-run preview changed. Review the updated settings before starting.",
    token: "b".repeat(64) });
});

test("@safety a saved-plan preview without an authoritative token cannot start", async ({ page }) => {
  await page.route("**/saved-plan-token-missing-test.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/saved-plan-token-missing-test.js");
    const base = createGalleryState("ready");
    const plans = { ...base.resources.plans.value, plans: base.resources.plans.value.plans.map((plan) => {
      const { previewToken, ...nextRunPreview } = plan.nextRunPreview;
      return { ...plan, nextRunPreview };
    }) };
    const initial = { ...base, workflow: "plan", resources: {
      ...base.resources, plans: { status: "ready", value: plans, problem: null },
    } };
    const store = new WorkspaceStore(initial);
    let calls = 0;
    const effects = new EffectController(store, { service: async () => { calls += 1; }, dispose() {} });
    try {
      await effects.executeAction("run-plan");
      return { calls, notice: store.value.notice?.text };
    } finally { effects.dispose(); }
  });
  expect(result).toEqual({ calls: 0,
    notice: "A verified next-run preview is unavailable. Refresh the saved plan before starting it." });
});
