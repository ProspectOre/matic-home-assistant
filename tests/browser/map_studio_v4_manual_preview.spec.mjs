import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export { MaticBackend } from "./frontend/map-studio-v4/backend";
      export { EffectController } from "./frontend/map-studio-v4/effects";
      export { MAX_ROOM_SEQUENCE_SIZE } from "./frontend/map-studio-v4/contracts";
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

async function setupPreviewWireHarness(page, moduleName, deadlineDelays) {
  await page.route(`**/${moduleName}`, (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  await page.evaluate(async ({ moduleName, deadlineDelays }) => {
    const { MaticBackend } = await import(`/${moduleName}`);
    const nativeSetTimeout = window.setTimeout.bind(window);
    let deadlineCount = 0;
    window.setTimeout = ((callback, delay, ...args) => {
      if (delay !== 15_000) return nativeSetTimeout(callback, delay, ...args);
      const fastDelay = deadlineDelays[deadlineCount] ?? deadlineDelays.at(-1);
      deadlineCount += 1;
      return nativeSetTimeout(callback, fastDelay, ...args);
    });
    const calls = [];
    const pending = [];
    const response = (token) => ({ context: {}, response: {
      entry_id: "synthetic-entry", floor_token: "f".repeat(64), preview_token: token.repeat(64),
      rooms: [{ room_id: "room-a", name: "Kitchen", cleaning_mode: "vacuum", coverage_setting: "standard", cadence_reasons: [] }],
      mission_boundaries: [], blocker: null,
    } });
    const connection = { sendMessagePromise: async (message) => {
      calls.push(message);
      return await new Promise(resolve => pending.push(resolve));
    } };
    const args = ["vacuum.synthetic", [{ room: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" }], false];
    const waitForCalls = async (count) => {
      for (let i = 0; i < 200 && calls.length < count; i += 1) await new Promise(resolve => nativeSetTimeout(resolve, 1));
    };
    window.previewWireHarness = {
      createBackend: () => new MaticBackend(() => ({ connection })),
      calls, pending, response, args, waitForCalls,
      restore: () => { window.setTimeout = nativeSetTimeout; },
    };
  }, { moduleName, deadlineDelays });
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

test("@safety accepts 100 rooms and rejects larger preview requests before calling Home Assistant", async ({ page }) => {
  await page.route("**/room-limit-test.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { MAX_ROOM_SEQUENCE_SIZE, MaticBackend } = await import("/room-limit-test.js");
    const calls = [];
    const rooms = Array.from({ length: MAX_ROOM_SEQUENCE_SIZE }, (_, index) => ({
      room: `room-${index + 1}`, cleaning_mode: "vacuum", coverage_setting: "standard",
    }));
    const response = {
      context: {},
      response: {
        entry_id: "synthetic-entry", floor_token: "f".repeat(64), preview_token: "a".repeat(64),
        rooms: rooms.map((room, index) => ({
          room_id: room.room, name: `Room ${index + 1}`, cleaning_mode: room.cleaning_mode,
          coverage_setting: room.coverage_setting, cadence_reasons: [],
        })),
        mission_boundaries: [], blocker: null,
      },
    };
    const backend = new MaticBackend(() => ({ connection: { sendMessagePromise: async (message) => {
      calls.push(message);
      return response;
    } } }));
    await backend.previewRoomSequence("vacuum.synthetic", rooms, true);
    let errorCode = null;
    try {
      await backend.previewRoomSequence("vacuum.synthetic", [...rooms, {
        room: "room-over-limit", cleaning_mode: "vacuum", coverage_setting: "standard",
      }], true);
    } catch (error) {
      errorCode = error.code;
    }
    backend.dispose();
    return { limit: MAX_ROOM_SEQUENCE_SIZE, validCalls: calls.length, errorCode };
  });
  expect(result).toEqual({ limit: 100, validCalls: 1, errorCode: "invalid-room-sequence-preview-request" });
});

test("@safety keeps manual selection and plan drafts within the service room limit", async ({ page }) => {
  await page.route("**/room-state-limit-test.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { MAX_ROOM_SEQUENCE_SIZE, WorkspaceStore, createGalleryState } = await import("/room-state-limit-test.js");
    const room = (roomId) => ({ roomId, cleaningMode: "vacuum", coverageSetting: "standard" });
    const selected = Array.from({ length: MAX_ROOM_SEQUENCE_SIZE - 1 }, (_, index) => room(`room-${index + 1}`));
    const base = createGalleryState("ready");
    const manual = new WorkspaceStore({
      ...base,
      workflow: "rooms",
      selection: { ...base.selection, roomIds: selected.map((candidate) => candidate.roomId), roomSettings: selected },
    });
    manual.dispatch({ type: "toggle-room", roomId: "room-100" });
    manual.dispatch({ type: "toggle-room", roomId: "room-101" });

    const plan = new WorkspaceStore({
      ...base,
      workflow: "plan",
      planDraft: { ...base.planDraft, rooms: selected },
    });
    plan.dispatch({ type: "toggle-room", roomId: "room-100" });
    plan.dispatch({ type: "toggle-room", roomId: "room-101" });
    plan.dispatch({ type: "patch-plan-draft", patch: {
      rooms: [...plan.value.planDraft.rooms, room("room-101")],
    } });
    return {
      manualCount: manual.value.selection.roomIds.length,
      planCount: plan.value.planDraft.rooms.length,
      limit: MAX_ROOM_SEQUENCE_SIZE,
    };
  });
  expect(result).toEqual({ manualCount: 100, planCount: 100, limit: 100 });
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

test("@safety a timed-out preview releases its turn without letting its late response release a newer turn", async ({ page }) => {
  await setupPreviewWireHarness(page, "backend-preview-timeout-test.js", [30, 300, 300, 30, 300]);
  const result = await page.evaluate(async () => {
    const h = window.previewWireHarness;
    const backend = h.createBackend();
    const { args, calls, pending, response, waitForCalls } = h;
    try {
      const first = backend.previewRoomSequence(...args).then(() => "resolved", error => error.code ?? error.name);
      await waitForCalls(1);
      const second = backend.previewRoomSequence(...args).then(value => value.previewToken, error => error.code ?? error.name);
      const third = backend.previewRoomSequence(...args).then(value => value.previewToken, error => error.code ?? error.name);

      const firstError = await first;
      await waitForCalls(2);
      const callsAfterTimeout = calls.length;
      // Keep the first transport unresolved until the second turn is active.
      pending[0](response("a"));
      await new Promise(resolve => setTimeout(resolve, 5));
      const callsAfterLateFirst = calls.length;
      pending[1](response("b"));
      const secondToken = await second;
      await waitForCalls(3);
      pending[2](response("c"));
      const thirdToken = await third;

      const canceled = new AbortController();
      const fourth = backend.previewRoomSequence(...args, canceled.signal).then(() => "resolved", error => error.name);
      await waitForCalls(4);
      const fifth = backend.previewRoomSequence(...args).then(value => value.previewToken, error => error.code ?? error.name);
      canceled.abort();
      const fourthError = await fourth;
      await waitForCalls(5);
      const callsAfterAbortedDeadline = calls.length;
      pending[3](response("d"));
      await new Promise(resolve => setTimeout(resolve, 5));
      const callsAfterLateAbortedFirst = calls.length;
      pending[4](response("e"));
      const fifthToken = await fifth;
      return { firstError, callsAfterTimeout, callsAfterLateFirst, secondToken, thirdToken, fourthError,
        callsAfterAbortedDeadline, callsAfterLateAbortedFirst, fifthToken, totalCalls: calls.length };
    } finally {
      backend.dispose();
      h.restore();
    }
  });
  expect(result).toEqual({ firstError: "preview-timeout", callsAfterTimeout: 2,
    callsAfterLateFirst: 2, secondToken: "b".repeat(64), thirdToken: "c".repeat(64), fourthError: "AbortError",
    callsAfterAbortedDeadline: 5, callsAfterLateAbortedFirst: 5, fifthToken: "e".repeat(64), totalCalls: 5 });
});

test("@safety a queued preview deadline expires without breaking the FIFO reservation", async ({ page }) => {
  await setupPreviewWireHarness(page, "backend-queued-preview-timeout-test.js", [90, 25, 500, 500]);
  const result = await page.evaluate(async () => {
    const h = window.previewWireHarness;
    const backend = h.createBackend();
    const { args, calls, pending, response, waitForCalls } = h;
    try {
      const first = backend.previewRoomSequence(...args).then(() => "resolved", error => error.code ?? error.name);
      await waitForCalls(1);
      const second = backend.previewRoomSequence(...args).then(() => "resolved", error => error.code ?? error.name);
      const third = backend.previewRoomSequence(...args).then(value => value.previewToken, error => error.code ?? error.name);
      const secondError = await second;
      await new Promise(resolve => setTimeout(resolve, 5));
      const callsBeforeFirstDeadline = calls.length;
      const firstError = await first;
      await waitForCalls(2);
      const fourth = backend.previewRoomSequence(...args).then(value => value.previewToken, error => error.code ?? error.name);
      pending[0](response("a"));
      await new Promise(resolve => setTimeout(resolve, 5));
      const callsAfterLateFirst = calls.length;
      pending[1](response("c"));
      const thirdToken = await third;
      await waitForCalls(3);
      pending[2](response("d"));
      const fourthToken = await fourth;
      return { firstError, secondError, callsBeforeFirstDeadline, callsAfterLateFirst, thirdToken, fourthToken, totalCalls: calls.length };
    } finally {
      backend.dispose();
      h.restore();
    }
  });
  expect(result).toEqual({ firstError: "preview-timeout", secondError: "preview-timeout",
    callsBeforeFirstDeadline: 1, callsAfterLateFirst: 2, thirdToken: "c".repeat(64),
    fourthToken: "d".repeat(64), totalCalls: 3 });
});

test("@safety unresolved preview wires are capped per connection and a settled orphan frees a slot", async ({ page }) => {
  await setupPreviewWireHarness(page, "backend-preview-wire-cap-test.js", [30, 100, 300, 500]);
  const result = await page.evaluate(async () => {
    const h = window.previewWireHarness;
    const backend = h.createBackend();
    const { args, calls, pending, response, waitForCalls } = h;
    try {
      const first = backend.previewRoomSequence(...args).then(() => "resolved", error => error.code ?? error.name);
      await waitForCalls(1);
      const second = backend.previewRoomSequence(...args).then(() => "resolved", error => error.code ?? error.name);
      const third = backend.previewRoomSequence(...args).then(() => "resolved", error => error.code ?? error.name);
      const firstError = await first;
      const secondError = await second;
      const thirdError = await third;
      const callsAtWireLimit = calls.length;

      // Both timed-out transports remain outstanding until one settles.
      pending[0](response("a"));
      await new Promise(resolve => setTimeout(resolve, 0));
      const fresh = backend.previewRoomSequence(...args).then(value => value.previewToken, error => error.code ?? error.name);
      await waitForCalls(3);
      pending[2](response("d"));
      const freshToken = await fresh;
      return { firstError, secondError, thirdError, callsAtWireLimit, freshToken, totalCalls: calls.length };
    } finally {
      backend.dispose();
      h.restore();
    }
  });
  expect(result).toEqual({ firstError: "preview-timeout", secondError: "preview-timeout",
    thirdError: "preview-unavailable", callsAtWireLimit: 2, freshToken: "d".repeat(64), totalCalls: 3 });
});

test("@safety preview wire cap survives backend disposal while orphaned RPCs remain unresolved", async ({ page }) => {
  await setupPreviewWireHarness(page, "backend-preview-dispose-cap-test.js", [40, 120, 400, 600]);
  const result = await page.evaluate(async () => {
    const h = window.previewWireHarness;
    const { args, calls, pending, response, waitForCalls } = h;
    const backendA = h.createBackend();
    let backendB;
    try {
      const first = backendA.previewRoomSequence(...args).then(() => "resolved", error => error.code ?? error.name);
      await waitForCalls(1);
      const second = backendA.previewRoomSequence(...args).then(() => "resolved", error => error.code ?? error.name);
      const firstError = await first;
      const secondError = await second;
      backendA.dispose();

      backendB = h.createBackend();
      const blockedError = await backendB.previewRoomSequence(...args).then(() => "resolved", error => error.code ?? error.name);
      const callsAtCap = calls.length;
      pending[0](response("a"));
      await new Promise(resolve => setTimeout(resolve, 0));
      const fresh = backendB.previewRoomSequence(...args).then(value => value.previewToken, error => error.code ?? error.name);
      await waitForCalls(3);
      pending[2](response("d"));
      const freshToken = await fresh;
      return { firstError, secondError, blockedError, callsAtCap, freshToken, totalCalls: calls.length };
    } finally {
      backendA.dispose();
      backendB?.dispose();
      h.restore();
    }
  });
  expect(result).toEqual({ firstError: "preview-timeout", secondError: "preview-timeout",
    blockedError: "preview-unavailable", callsAtCap: 2, freshToken: "d".repeat(64), totalCalls: 3 });
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
