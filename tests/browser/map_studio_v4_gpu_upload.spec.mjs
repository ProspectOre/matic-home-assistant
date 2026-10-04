import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadRenderer(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/map-studio-v4-gpu-upload.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const constants = {
      ARRAY_BUFFER: 0x8892, DYNAMIC_DRAW: 0x88e8, STATIC_DRAW: 0x88e4,
      COPY_READ_BUFFER: 0x8f36, COPY_WRITE_BUFFER: 0x8f37, NO_ERROR: 0,
      OUT_OF_MEMORY: 0x0505,
      VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82, UNSIGNED_SHORT: 0x1403, UNSIGNED_BYTE: 0x1401,
      DEPTH_TEST: 0x0b71, LEQUAL: 0x0203, BLEND: 0x0be2, SRC_ALPHA: 0x0302,
      ONE_MINUS_SRC_ALPHA: 0x0303, COLOR_BUFFER_BIT: 0x4000,
      DEPTH_BUFFER_BIT: 0x0100, POINTS: 0x0000,
    };
    const contexts = [];
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    let frame = 0;
    window.requestAnimationFrame = (callback) => nativeRequestAnimationFrame((time) => {
      frame += 1;
      callback(time);
    });
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      if (kind !== "webgl2") return originalGetContext.call(this, kind, options);
      const context = {
        id: contexts.length + 1,
        calls: [],
        boundBuffer: null,
        currentVertexArray: null,
        vertexArrayBuffers: new Map(),
        initializedBytes: new Map(),
        buffers: new Map(),
        errors: [],
        failNextCreateBuffer: false,
        failNextAllocation: false,
        failNextSubData: false,
        createBuffer() {
          if (this.failNextCreateBuffer) {
            this.failNextCreateBuffer = false;
            return null;
          }
          const buffer = { context: this.id, id: `${this.id}:${this.calls.length}` };
          this.initializedBytes.set(buffer.id, 0);
          this.buffers.set(buffer.id, new Uint8Array());
          return buffer;
        },
        createVertexArray() { return { id: `${this.id}:vao:${this.calls.length}` }; },
        createShader() { return {}; },
        createProgram() { return {}; },
        getShaderParameter() { return true; },
        getProgramParameter() { return true; },
        getUniformLocation() { return {}; },
        bindVertexArray(vertexArray) { this.currentVertexArray = vertexArray; },
        bindBuffer(target, buffer) { this.boundBuffer = buffer; },
        vertexAttribIPointer() { if (this.currentVertexArray) this.vertexArrayBuffers.set(this.currentVertexArray.id, this.boundBuffer); },
        vertexAttribPointer() { if (this.currentVertexArray) this.vertexArrayBuffers.set(this.currentVertexArray.id, this.boundBuffer); },
        bufferData(target, data, usage) {
          const bytes = typeof data === "number" ? data : data.byteLength;
          if (this.failNextAllocation) {
            this.failNextAllocation = false;
            this.errors.push(constants.OUT_OF_MEMORY);
          } else {
            const storage = new Uint8Array(bytes);
            if (typeof data !== "number") storage.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            this.buffers.set(this.boundBuffer?.id, storage);
          }
          this.initializedBytes.set(this.boundBuffer?.id, 0);
          this.calls.push({ type: "allocate", buffer: this.boundBuffer?.id, bytes, frame });
        },
        bufferSubData(target, offset, data) {
          if (this.failNextSubData) {
            this.failNextSubData = false;
            this.errors.push(constants.OUT_OF_MEMORY);
            this.calls.push({ type: "chunk-error", buffer: this.boundBuffer?.id, offset, bytes: data.byteLength, frame });
            return;
          }
          const end = offset + data.byteLength;
          this.initializedBytes.set(this.boundBuffer?.id, Math.max(this.initializedBytes.get(this.boundBuffer?.id) ?? 0, end));
          this.buffers.get(this.boundBuffer?.id)?.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
          this.calls.push({ type: "chunk", buffer: this.boundBuffer?.id, offset, bytes: data.byteLength, frame });
        },
        copyBufferSubData(readTarget, writeTarget, readOffset, writeOffset, size) {
          const source = this.boundReadBuffer;
          const target = this.boundWriteBuffer;
          if (!source || !target || readOffset + size > (this.buffers.get(source.id)?.length ?? 0)
            || readOffset + size > (this.initializedBytes.get(source.id) ?? 0)
            || writeOffset + size > (this.buffers.get(target.id)?.length ?? 0)) {
            this.errors.push(constants.OUT_OF_MEMORY);
            return;
          }
          this.buffers.get(target.id).set(this.buffers.get(source.id).subarray(readOffset, readOffset + size), writeOffset);
          this.initializedBytes.set(target.id, Math.max(this.initializedBytes.get(target.id) ?? 0, writeOffset + size));
          this.calls.push({ type: "copy", source: source.id, buffer: target.id, offset: writeOffset, bytes: size, frame });
        },
        deleteBuffer(buffer) { this.calls.push({ type: "delete", buffer: buffer?.id, frame }); this.buffers.delete(buffer?.id); },
        getError() { return this.errors.shift() ?? constants.NO_ERROR; },
        get liveBufferCount() { return this.buffers.size; },
        drawArrays(mode, first, count) {
          const buffer = this.vertexArrayBuffers.get(this.currentVertexArray?.id);
          const initialized = this.initializedBytes.get(buffer?.id) ?? 0;
          this.calls.push({ type: "draw", first, count, valid: count === 0 || (first + count) * 8 <= initialized, frame });
        },
      };
      context.bindBuffer = (target, buffer) => {
        context.boundBuffer = buffer;
        if (target === constants.COPY_READ_BUFFER) context.boundReadBuffer = buffer;
        if (target === constants.COPY_WRITE_BUFFER) context.boundWriteBuffer = buffer;
      };
      const gl = new Proxy(context, { get(target, key) {
        if (key in target) return target[key];
        if (key in constants) return constants[key];
        return () => {};
      } });
      contexts.push(gl);
      return gl;
    };
    const { RendererController, createGalleryState } = await import("/map-studio-v4-gpu-upload.js");
    window.__gpuUploadHarness = { RendererController, createGalleryState, contexts };
  });
}

test("@safety WebGL uploads use bounded aligned chunks and compatible scenes publish atomically", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const { RendererController, createGalleryState, contexts } = window.__gpuUploadHarness;
    const base = createGalleryState("ready");
    const makeScene = (total, revision, previous = null, dirtyBlocks = []) => {
      const pointOffset = 64;
      const buffer = new ArrayBuffer(pointOffset + total * 8);
      const points = new Uint8Array(buffer, pointOffset);
      if (previous) points.set(new Uint8Array(previous.buffer, previous.pointOffset, total * 8));
      else points.fill(revision);
      for (const block of dirtyBlocks) {
        const start = block * 65_536;
        points.fill(revision, start, Math.min(points.length, start + 65_536));
      }
      return {
        ...base.resources.scene.value,
        buffer,
        pointOffset,
        floorCount: Math.floor(total * 0.8),
        surfaceCount: total - Math.floor(total * 0.8),
        total,
        revision,
        metadata: {
          ...base.resources.scene.value.metadata,
          metersPerCell: 0.05,
          origin: [0, 0],
          span: [180, 140],
          rooms: base.resources.scene.value.metadata.rooms,
        },
        source: "live",
        ...(previous ? { deltaHint: { baseRevision: previous.revision, blockBytes: 65_536, dirtyBlocks } } : {}),
      };
    };
    const setScene = (state, scene, generation = state.generation) => ({
      ...state,
      generation,
      resources: { ...state.resources, scene: { status: "ready", value: scene, problem: null } },
    });
    const sceneCanvas = document.createElement("canvas");
    const overlayCanvas = document.createElement("canvas");
    for (const canvas of [sceneCanvas, overlayCanvas]) {
      Object.assign(canvas.style, { width: "700px", height: "500px" });
      document.body.append(canvas);
    }
    const renderer = new RendererController(sceneCanvas, overlayCanvas);
    const large = makeScene(1_000_000, 8);
    renderer.setState(setScene(base, large));
    const firstContext = contexts.at(-1);
    const waitFor = async (predicate, attempts = 240) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (predicate()) return true;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return predicate();
    };
    const initialComplete = await waitFor(() => {
      const state = renderer.diagnostics();
      return state.sceneRevision === 8 && state.renderedPoints === large.total;
    });
    const firstBuffer = firstContext.calls.find((call) => call.type === "chunk")?.buffer;
    const scene9 = makeScene(1_000_000, 9, large, [0, 8, 20]);
    const scene10 = makeScene(1_000_000, 10, scene9, [0, 50]);
    const scene11 = makeScene(1_000_000, 11, scene10, [8, 100]);
    renderer.setState(setScene(base, scene9));
    const firstPatchSubmitted = await waitFor(() => firstContext.calls.some((call) =>
      call.type === "chunk" && call.offset === 0 && call.buffer !== firstBuffer));
    const oldSceneBeforePublish = renderer.diagnostics().sceneRevision;
    renderer.setState(setScene(base, scene10));
    renderer.setState(setScene(base, scene11));
    const finalComplete = await waitFor(() => {
      const state = renderer.diagnostics();
      return state.sceneRevision === 11 && state.renderedPoints === scene11.total;
    });
    const targetBuffer = [...firstContext.vertexArrayBuffers.values()][0];
    const actual = firstContext.buffers.get(targetBuffer?.id);
    const expected = new Uint8Array(scene11.buffer, scene11.pointOffset, scene11.total * 8);
    const exactLatestBytes = Boolean(actual && actual.length === expected.length
      && actual.every((value, index) => value === expected[index]));
    const uploadCalls = firstContext.calls.filter((call) => call.type === "chunk" || call.type === "copy");
    const bytesByFrame = new Map();
    for (const call of uploadCalls) bytesByFrame.set(call.frame, (bytesByFrame.get(call.frame) ?? 0) + call.bytes);
    const allocations = firstContext.calls.filter((call) => call.type === "allocate");
    const invalidDraws = firstContext.calls.filter((call) => call.type === "draw" && !call.valid).length;
    const liveBuffers = firstContext.liveBufferCount;
    const completedScene = renderer.diagnostics().sceneRevision;
    renderer.dispose();
    sceneCanvas.remove();
    overlayCanvas.remove();
    return {
      initialComplete,
      firstPatchSubmitted,
      oldSceneBeforePublish,
      finalComplete,
      completedScene,
      exactLatestBytes,
      allocations,
      uploadCalls,
      bytesByFrame: [...bytesByFrame.values()],
      invalidDraws,
      liveBuffers,
      firstBuffer,
    };
  });

  expect(outcome.initialComplete).toBe(true);
  expect(outcome.firstPatchSubmitted).toBe(true);
  expect(outcome.oldSceneBeforePublish).toBe(8);
  expect(outcome.finalComplete).toBe(true);
  expect(outcome.completedScene).toBe(11);
  expect(outcome.exactLatestBytes).toBe(true);
  expect(outcome.allocations.filter((allocation) => allocation.bytes > 512 * 1024)).toHaveLength(2);
  expect(outcome.uploadCalls.every((call) => call.bytes <= 512 * 1024 && call.bytes % 8 === 0)).toBe(true);
  expect(outcome.bytesByFrame.every((bytes) => bytes <= 512 * 1024)).toBe(true);
  expect(outcome.invalidDraws).toBe(0);
  expect(outcome.liveBuffers).toBeLessThanOrEqual(2);
});

test("@safety a successor to an incomplete initial upload starts a full back buffer", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const { RendererController, createGalleryState, contexts } = window.__gpuUploadHarness;
    const base = createGalleryState("ready");
    const makeScene = (revision, previous = null) => {
      const source = base.resources.scene.value;
      const buffer = new ArrayBuffer(source.pointOffset + 1_000_000 * 8);
      const points = new Uint8Array(buffer, source.pointOffset);
      if (previous) {
        points.set(new Uint8Array(previous.buffer, previous.pointOffset, points.length));
        points.fill(revision, 0, 65_536);
      } else {
        points.fill(revision);
      }
      return {
        ...source,
        buffer,
        total: 1_000_000,
        floorCount: 800_000,
        surfaceCount: 200_000,
        revision,
        ...(previous ? { deltaHint: { baseRevision: previous.revision, blockBytes: 65_536, dirtyBlocks: [0] } } : {}),
      };
    };
    const stateFor = (scene) => ({
      ...base,
      resources: { ...base.resources, scene: { status: "ready", value: scene, problem: null } },
    });
    const canvases = Array.from({ length: 2 }, () => document.createElement("canvas"));
    canvases.forEach((canvas) => document.body.append(canvas));
    const renderer = new RendererController(...canvases);
    const initial = makeScene(50);
    renderer.setState(stateFor(initial));
    const context = contexts.at(-1);
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const waitFor = async (predicate, attempts = 240) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (predicate()) return true;
        await nextFrame();
      }
      return predicate();
    };
    const firstChunk = await waitFor(() => context.calls.some((call) => call.type === "chunk"));
    const initialBuffer = context.calls.find((call) => call.type === "chunk")?.buffer;
    const successor = makeScene(51, initial);
    renderer.setState(stateFor(successor));
    const backBufferStarted = await waitFor(() => context.calls.some((call) =>
      call.type === "chunk" && call.buffer !== initialBuffer));
    const oldRevisionWhileBackUploads = renderer.diagnostics().sceneRevision;
    const complete = await waitFor(() => {
      const state = renderer.diagnostics();
      return state.sceneRevision === successor.revision && state.renderedPoints === successor.total;
    });
    const front = [...context.vertexArrayBuffers.values()][0];
    const actual = context.buffers.get(front?.id);
    const expected = new Uint8Array(successor.buffer, successor.pointOffset, successor.total * 8);
    const exact = Boolean(actual && actual.length === expected.length
      && actual.every((value, index) => value === expected[index]));
    const allocations = context.calls.filter((call) => call.type === "allocate");
    renderer.dispose();
    canvases.forEach((canvas) => canvas.remove());
    return { firstChunk, backBufferStarted, oldRevisionWhileBackUploads, complete, exact, allocations };
  });

  expect(outcome.firstChunk).toBe(true);
  expect(outcome.backBufferStarted).toBe(true);
  expect(outcome.oldRevisionWhileBackUploads).toBe(50);
  expect(outcome.complete).toBe(true);
  expect(outcome.exact).toBe(true);
  expect(outcome.allocations.filter((allocation) => allocation.bytes > 512 * 1024)).toHaveLength(2);
});

test("@safety a staged scene persists camera preferences for the active view at publication", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const { RendererController, createGalleryState, contexts } = window.__gpuUploadHarness;
    const base = createGalleryState("ready");
    const topPreference = { yaw: 0.15, pitch: 1.553, zoom: 1, targetX: 0.2, targetZ: -0.1 };
    const threePreference = { yaw: -0.8, pitch: 0.9, zoom: 1.4, targetX: 0.3, targetZ: 0.4 };
    const baseWithCameras = { ...base, cameras: { top: topPreference, three: threePreference } };
    const makeScene = (revision, previous = null) => {
      const source = base.resources.scene.value;
      const buffer = new ArrayBuffer(source.pointOffset + 1_000_000 * 8);
      const points = new Uint8Array(buffer, source.pointOffset);
      if (previous) points.set(new Uint8Array(previous.buffer, previous.pointOffset, points.length));
      else points.fill(revision);
      if (previous) points.fill(revision, 0, 65_536);
      return {
        ...source,
        buffer,
        total: 1_000_000,
        floorCount: 800_000,
        surfaceCount: 200_000,
        revision,
        ...(previous ? { deltaHint: { baseRevision: previous.revision, blockBytes: 65_536, dirtyBlocks: [0] } } : {}),
      };
    };
    const stateFor = (scene, state = baseWithCameras) => ({
      ...state,
      resources: { ...state.resources, scene: { status: "ready", value: scene, problem: null } },
    });
    const canvases = Array.from({ length: 2 }, () => document.createElement("canvas"));
    canvases.forEach((canvas) => document.body.append(canvas));
    let savedPreferences = null;
    const renderer = new RendererController(...canvases, {
      onCameraPreferences: (cameras) => { savedPreferences = cameras; },
    });
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const waitFor = async (predicate, attempts = 240) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (predicate()) return true;
        await nextFrame();
      }
      return predicate();
    };
    const initial = makeScene(70);
    renderer.setState(stateFor(initial));
    const context = contexts.at(-1);
    const initialComplete = await waitFor(() => {
      const diagnostics = renderer.diagnostics();
      return diagnostics.sceneRevision === initial.revision
        && diagnostics.renderedPoints === initial.total;
    });
    const successor = makeScene(71, initial);
    renderer.setState(stateFor(successor));
    const stagingStarted = await waitFor(() => context.calls.some((call) => call.type === "copy"));
    const threeViewState = { ...baseWithCameras, view: "three" };
    renderer.setState(stateFor(successor, threeViewState));
    const cameraBeforePublish = renderer.camera;
    const complete = await waitFor(() => renderer.diagnostics().sceneRevision === successor.revision);
    renderer.dispose();
    canvases.forEach((canvas) => canvas.remove());
    return {
      stagingStarted,
      initialComplete,
      complete,
      cameraBeforePublish,
      savedTopYaw: savedPreferences?.top?.yaw,
      savedThreeYaw: savedPreferences?.three?.yaw,
      expectedTopYaw: topPreference.yaw,
    };
  });

  expect(outcome.initialComplete).toBe(true);
  expect(outcome.stagingStarted).toBe(true);
  expect(outcome.complete).toBe(true);
  expect(outcome.savedTopYaw).toBeCloseTo(outcome.expectedTopYaw, 5);
  expect(outcome.savedThreeYaw).toBeCloseTo(outcome.cameraBeforePublish.yaw, 5);
});

test("@safety upload owner cancels on floor replacement and suspension, then restoration uploads only the latest frame", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const { RendererController, createGalleryState, contexts } = window.__gpuUploadHarness;
    const base = createGalleryState("ready");
    const makeScene = (revision, fill) => {
      const source = base.resources.scene.value;
      const buffer = new ArrayBuffer(source.pointOffset + 1_000_000 * 8);
      new Uint8Array(buffer, source.pointOffset).fill(fill);
      return { ...source, buffer, total: 1_000_000, floorCount: 900_000, surfaceCount: 100_000, revision };
    };
    const sceneState = (scene, changes = {}) => ({
      ...base,
      ...changes,
      resources: { ...base.resources, ...changes.resources,
        scene: { status: "ready", value: scene, problem: null } },
    });
    const canvases = Array.from({ length: 2 }, () => document.createElement("canvas"));
    canvases.forEach((canvas) => document.body.append(canvas));
    const renderer = new RendererController(...canvases);
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const waitFor = async (predicate, attempts = 240) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (predicate()) return true;
        await nextFrame();
      }
      return predicate();
    };
    const writeCount = (context) => context.calls.filter((call) => call.type === "chunk" || call.type === "copy").length;
    renderer.setState(sceneState(makeScene(20, 20)));
    const context = contexts.at(-1);
    await waitFor(() => writeCount(context) > 0);
    const beforeFloorWrites = writeCount(context);
    const nextEntry = {
      ...base.resources.entry,
      selectedFloorOrdinal: 2,
      mapFloorOrdinal: 2,
      mapSessionKey: "b".repeat(64),
    };
    const nextScene = {
      ...makeScene(21, 21),
      metadata: { ...base.resources.scene.value.metadata, origin: [2, 1], span: [200, 150] },
    };
    renderer.setState(sceneState(nextScene, {
      generation: base.generation + 1,
      selection: { ...base.selection, floorId: "floor-2" },
      resources: { ...base.resources, entry: nextEntry },
    }));
    await waitFor(() => writeCount(context) > beforeFloorWrites);
    const floorChanged = renderer.diagnostics();
    const firstTargetWrites = writeCount(context);

    const suspendedState = sceneState(nextScene, {
      generation: base.generation + 2,
      pageActive: false,
      selection: { ...base.selection, floorId: "floor-2" },
      resources: { ...base.resources, entry: nextEntry },
    });
    renderer.setState(suspendedState);
    const writesAtSuspend = writeCount(context);
    await nextFrame();
    await nextFrame();
    await nextFrame();
    const writesWhileSuspended = writeCount(context);
    renderer.setState({ ...suspendedState, pageActive: true });
    const resumeComplete = await waitFor(() => {
      const state = renderer.diagnostics();
      return state.sceneRevision === 21 && state.renderedPoints === 1_000_000;
    });
    const resumed = renderer.diagnostics();

    const currentContext = contexts.at(-1);
    const writesBeforeRevision22 = writeCount(currentContext);
    const beforeLossScene = makeScene(22, 22);
    renderer.setState(sceneState(beforeLossScene, {
      generation: base.generation + 3,
      selection: { ...base.selection, floorId: "floor-2" },
      resources: { ...base.resources, entry: nextEntry },
    }));
    await waitFor(() => writeCount(currentContext) > writesBeforeRevision22);
    const writesBeforeLoss = writeCount(currentContext);
    canvases[0].dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const lostContext = contexts.at(-1);
    const latestScene = makeScene(23, 23);
    renderer.setState(sceneState(latestScene, {
      generation: base.generation + 4,
      selection: { ...base.selection, floorId: "floor-2" },
      resources: { ...base.resources, entry: nextEntry },
    }));
    const fallbackModeAfterLoss = renderer.diagnostics().mode;
    canvases[0].dispatchEvent(new Event("webglcontextrestored"));
    const restoredComplete = await waitFor(() => {
      const state = renderer.diagnostics();
      return state.sceneRevision === 23 && state.renderedPoints === 1_000_000;
    });
    const restored = renderer.diagnostics();
    const restoredContext = contexts.at(-1);
    const restoredContexts = contexts.length;
    const staleAfterLoss = writeCount(currentContext) - writesBeforeLoss;

    const disposableCanvases = Array.from({ length: 2 }, () => document.createElement("canvas"));
    disposableCanvases.forEach((canvas) => document.body.append(canvas));
    const disposable = new RendererController(...disposableCanvases);
    disposable.setState(sceneState(makeScene(24, 24), {
      generation: base.generation + 5,
      selection: { ...base.selection, floorId: "floor-2" },
      resources: { ...base.resources, entry: nextEntry },
    }));
    const disposalContext = contexts.at(-1);
    await waitFor(() => writeCount(disposalContext) > 0);
    const writesAtDispose = writeCount(disposalContext);
    disposable.dispose();
    await nextFrame();
    await nextFrame();
    await nextFrame();
    const writesAfterDispose = writeCount(disposalContext);
    disposableCanvases.forEach((canvas) => canvas.remove());
    renderer.dispose();
    canvases.forEach((canvas) => canvas.remove());
    return {
      beforeFloorWrites,
      firstTargetWrites,
      floorChangedRevision: floorChanged.sceneRevision,
      floorChangedRendered: floorChanged.renderedPoints,
      writesAtSuspend,
      writesWhileSuspended,
      resumedRevision: resumed.sceneRevision,
      resumedPoints: resumed.renderedPoints,
      resumeComplete,
      staleAfterLoss,
      fallbackModeAfterLoss,
      restoredRevision: restored.sceneRevision,
      restoredPoints: restored.renderedPoints,
      restoredComplete,
      expectedPoints: latestScene.total,
      restoredContexts,
      restoredContextChunkBuffers: restoredContext.calls
        .filter((call) => call.type === "chunk" || call.type === "copy").map((call) => call.buffer),
      writesBeforeLoss,
      lostContextWrites: writeCount(lostContext),
      writesAtDispose,
      writesAfterDispose,
    };
  });

  expect(outcome.firstTargetWrites).toBeGreaterThan(outcome.beforeFloorWrites);
  expect(outcome.floorChangedRevision).toBe(21);
  expect(outcome.floorChangedRendered).toBeGreaterThan(0);
  expect(outcome.floorChangedRendered).toBeLessThan(outcome.expectedPoints);
  expect(outcome.writesWhileSuspended).toBe(outcome.writesAtSuspend);
  expect(outcome.resumedRevision).toBe(21);
  expect(outcome.resumeComplete).toBe(true);
  expect(outcome.resumedPoints).toBe(outcome.expectedPoints);
  expect(outcome.staleAfterLoss).toBe(0);
  expect(outcome.lostContextWrites).toBe(outcome.writesBeforeLoss);
  expect(outcome.fallbackModeAfterLoss).toBe("canvas2d");
  expect(outcome.restoredRevision).toBe(23);
  expect(outcome.restoredComplete).toBe(true);
  expect(outcome.restoredPoints).toBe(outcome.expectedPoints);
  expect(outcome.restoredContexts).toBe(2);
  expect(outcome.restoredContextChunkBuffers.length).toBeGreaterThan(0);
  expect(outcome.writesAfterDispose).toBe(outcome.writesAtDispose);
});

test("@safety context loss during compatible staging falls back to the latest admitted scene", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const { RendererController, createGalleryState, contexts } = window.__gpuUploadHarness;
    const base = createGalleryState("ready");
    const total = 100_000;
    const pointOffset = 64;
    const makeScene = (revision, previous = null) => {
      const buffer = previous ? previous.buffer.slice(0) : new ArrayBuffer(pointOffset + total * 8);
      const points = new DataView(buffer, pointOffset);
      if (!previous) {
        for (let index = 0; index < total; index += 1) {
          const offset = index * 8;
          points.setUint16(offset, 65_000, true);
          points.setUint16(offset + 2, 65_000, true);
          points.setUint8(offset + 5, 255);
        }
        points.setUint16(0, 100, true);
        points.setUint16(2, 100, true);
      } else {
        points.setUint16(0, 500, true);
        points.setUint16(2, 500, true);
        points.setUint8(5, 0);
        points.setUint8(6, 255);
      }
      return {
        ...base.resources.scene.value,
        buffer,
        pointOffset,
        floorCount: 90_000,
        surfaceCount: 10_000,
        total,
        revision,
        metadata: {
          ...base.resources.scene.value.metadata,
          metersPerCell: 0.05,
          origin: [0, 0],
          span: [1_000, 1_000],
          sampleStep: previous ? 3 : 1,
          rooms: previous ? [{
            id: "new-room", name: "Current scene room",
            boundary: [[10, 10], [20, 10], [20, 20], [10, 20]], center: [15, 15],
          }] : [{
            id: "old-room", name: "Prior scene room",
            boundary: [[30, 30], [40, 30], [40, 40], [30, 40]], center: [35, 35],
          }],
        },
        source: "live",
        ...(previous ? { deltaHint: { baseRevision: previous.revision, blockBytes: 65_536, dirtyBlocks: [0] } } : {}),
      };
    };
    const stateFor = (scene) => ({
      ...base,
      appearance: "photo",
      labelsVisible: false,
      resources: { ...base.resources, scene: { status: "ready", value: scene, problem: null } },
    });
    const canvases = Array.from({ length: 2 }, () => document.createElement("canvas"));
    canvases.forEach((canvas) => document.body.append(canvas));
    const created = document.createElement.bind(document);
    const fallbackCanvases = [];
    document.createElement = function (name, options) {
      const element = created(name, options);
      if (name.toLowerCase() === "canvas") fallbackCanvases.push(element);
      return element;
    };
    const renderer = new RendererController(...canvases);
    const context = contexts.at(-1);
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const waitFor = async (predicate, attempts = 120) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (predicate()) return true;
        await nextFrame();
      }
      return predicate();
    };
    const previous = makeScene(40);
    renderer.setState(stateFor(previous));
    const previousComplete = await waitFor(() => renderer.diagnostics().sceneRevision === 40
      && renderer.diagnostics().renderedPoints === total);
    const successor = makeScene(41, previous);
    renderer.setState(stateFor(successor));
    const stagingStarted = await waitFor(() => context.calls.some((call) => call.type === "copy"));
    const publishedBeforeLoss = renderer.diagnostics().sceneRevision;
    canvases[0].dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const fallbackComplete = await waitFor(() => renderer.diagnostics().mode === "canvas2d"
      && renderer.diagnostics().renderedPoints === 50_000);
    const fallbackCanvas = fallbackCanvases.at(-1);
    const pixel = fallbackCanvas?.getContext("2d")?.getImageData(512, 512, 1, 1).data;
    const obsoletePixel = fallbackCanvas?.getContext("2d")?.getImageData(102, 102, 1, 1).data;
    const diagnostics = renderer.diagnostics();
    document.createElement = created;
    renderer.dispose();
    canvases.forEach((canvas) => canvas.remove());
    return {
      previousComplete,
      stagingStarted,
      publishedBeforeLoss,
      fallbackComplete,
      mode: diagnostics.mode,
      sceneRevision: diagnostics.sceneRevision,
      sourcePoints: diagnostics.sourcePoints,
      renderedPoints: diagnostics.renderedPoints,
      currentPixel: pixel ? [...pixel] : null,
      obsoletePixel: obsoletePixel ? [...obsoletePixel] : null,
    };
  });

  expect(outcome.previousComplete).toBe(true);
  expect(outcome.stagingStarted).toBe(true);
  expect(outcome.publishedBeforeLoss).toBe(40);
  expect(outcome.fallbackComplete).toBe(true);
  expect(outcome.mode).toBe("canvas2d");
  expect(outcome.sceneRevision).toBe(41);
  expect(outcome.sourcePoints).toBe(100_000);
  expect(outcome.renderedPoints).toBe(50_000);
  expect(outcome.currentPixel?.[1]).toBeGreaterThan(240);
  expect(outcome.currentPixel?.[0]).toBeLessThan(10);
  expect(outcome.obsoletePixel?.[3]).toBe(0);
});

test("@safety hidden context restoration stays idle then uploads the same admitted scene on resume", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const { RendererController, createGalleryState, contexts } = window.__gpuUploadHarness;
    const base = createGalleryState("ready");
    const source = base.resources.scene.value;
    const total = 4_096;
    const buffer = new ArrayBuffer(source.pointOffset + total * 8);
    const pointBytes = new Uint8Array(buffer, source.pointOffset);
    pointBytes.fill(0x3d);
    const scene = {
      ...source,
      buffer,
      floorCount: total,
      surfaceCount: 0,
      total,
      revision: 52,
      source: "live",
    };
    const stateFor = (pageActive) => ({
      ...base,
      pageActive,
      resources: { ...base.resources, scene: { status: "ready", value: scene, problem: null } },
    });
    const canvases = Array.from({ length: 2 }, () => document.createElement("canvas"));
    canvases.forEach((canvas) => document.body.append(canvas));
    const renderer = new RendererController(...canvases);
    const waitFor = async (predicate, attempts = 120) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (predicate()) return true;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return predicate();
    };
    renderer.setState(stateFor(true));
    const initialContext = contexts.at(-1);
    const initialComplete = await waitFor(() => renderer.diagnostics().sceneRevision === scene.revision
      && renderer.diagnostics().renderedPoints === total);

    renderer.setState(stateFor(false));
    canvases[0].dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvases[0].dispatchEvent(new Event("webglcontextrestored"));
    const restoredContext = contexts.at(-1);
    const hiddenFrame = renderer.diagnostics();
    const hiddenUploadCalls = restoredContext.calls.filter((call) => call.type === "chunk" || call.type === "copy").length;

    renderer.setState(stateFor(true));
    const resumeComplete = await waitFor(() => renderer.diagnostics().sceneRevision === scene.revision
      && renderer.diagnostics().renderedPoints === total);
    const front = [...restoredContext.vertexArrayBuffers.values()][0];
    const actual = restoredContext.buffers.get(front?.id);
    const expected = new Uint8Array(scene.buffer, scene.pointOffset, scene.total * 8);
    const exactRestoredBytes = Boolean(actual && actual.length === expected.length
      && actual.every((value, index) => value === expected[index]));
    const restoredUploadCalls = restoredContext.calls.filter((call) => call.type === "chunk" || call.type === "copy").length;
    renderer.dispose();
    canvases.forEach((canvas) => canvas.remove());
    return {
      initialComplete,
      initialContextCount: initialContext.calls.filter((call) => call.type === "chunk").length,
      restoredContextCount: contexts.length,
      hiddenRevision: hiddenFrame.sceneRevision,
      hiddenRenderedPoints: hiddenFrame.renderedPoints,
      hiddenUploadCalls,
      resumeComplete,
      restoredUploadCalls,
      exactRestoredBytes,
    };
  });

  expect(outcome.initialComplete).toBe(true);
  expect(outcome.initialContextCount).toBeGreaterThan(0);
  expect(outcome.restoredContextCount).toBe(2);
  expect(outcome.hiddenRevision).toBe(52);
  expect(outcome.hiddenRenderedPoints).toBe(0);
  expect(outcome.hiddenUploadCalls).toBe(0);
  expect(outcome.resumeComplete).toBe(true);
  expect(outcome.restoredUploadCalls).toBeGreaterThan(0);
  expect(outcome.exactRestoredBytes).toBe(true);
});

test("@safety WebGL allocation and subdata errors fall back to the latest admitted scene", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const { RendererController, createGalleryState, contexts } = window.__gpuUploadHarness;
    const base = createGalleryState("ready");
    const makeScene = (revision, total = 4096) => {
      const source = base.resources.scene.value;
      const buffer = new ArrayBuffer(source.pointOffset + total * 8);
      new Uint8Array(buffer, source.pointOffset).fill(revision);
      return { ...source, buffer, total, floorCount: total, surfaceCount: 0, revision };
    };
    const stateFor = (scene) => ({
      ...base,
      resources: { ...base.resources, scene: { status: "ready", value: scene, problem: null } },
    });
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const waitFor = async (predicate, attempts = 120) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (predicate()) return true;
        await nextFrame();
      }
      return predicate();
    };

    const nullCanvases = Array.from({ length: 2 }, () => document.createElement("canvas"));
    nullCanvases.forEach((canvas) => document.body.append(canvas));
    const nullRenderer = new RendererController(...nullCanvases);
    nullRenderer.setState(stateFor(makeScene(29)));
    const nullContext = contexts.at(-1);
    await waitFor(() => nullRenderer.diagnostics().sceneRevision === 29
      && nullRenderer.diagnostics().renderedPoints === 4096);
    nullContext.failNextCreateBuffer = true;
    nullRenderer.setState(stateFor(makeScene(30)));
    const nullFallback = await waitFor(() => nullRenderer.diagnostics().mode === "canvas2d");
    const nullResult = nullRenderer.diagnostics();
    nullRenderer.dispose();
    nullCanvases.forEach((canvas) => canvas.remove());

    const allocationCanvases = Array.from({ length: 2 }, () => document.createElement("canvas"));
    allocationCanvases.forEach((canvas) => document.body.append(canvas));
    const allocationRenderer = new RendererController(...allocationCanvases);
    allocationRenderer.setState(stateFor(makeScene(30)));
    const allocationContext = contexts.at(-1);
    await waitFor(() => allocationRenderer.diagnostics().sceneRevision === 30
      && allocationRenderer.diagnostics().renderedPoints === 4096);
    allocationContext.failNextAllocation = true;
    allocationRenderer.setState(stateFor(makeScene(31)));
    const allocationFallback = await waitFor(() => allocationRenderer.diagnostics().mode === "canvas2d");
    const allocationResult = allocationRenderer.diagnostics();
    const allocationCalls = allocationContext.calls.length;
    allocationRenderer.dispose();
    allocationCanvases.forEach((canvas) => canvas.remove());

    const subdataCanvases = Array.from({ length: 2 }, () => document.createElement("canvas"));
    subdataCanvases.forEach((canvas) => document.body.append(canvas));
    const subdataRenderer = new RendererController(...subdataCanvases);
    const subdataScene = makeScene(40, 100_000);
    subdataRenderer.setState(stateFor(subdataScene));
    const subdataContext = contexts.at(-1);
    subdataContext.failNextSubData = true;
    const subdataFallback = await waitFor(() => subdataRenderer.diagnostics().mode === "canvas2d");
    const subdataResult = subdataRenderer.diagnostics();
    const callsAtFallback = subdataContext.calls.length;
    await nextFrame();
    await nextFrame();
    const callsAfterFallback = subdataContext.calls.length;
    subdataRenderer.dispose();
    subdataCanvases.forEach((canvas) => canvas.remove());
    return {
      nullFallback,
      nullMode: nullResult.mode,
      nullRevision: nullResult.sceneRevision,
      allocationFallback,
      allocationMode: allocationResult.mode,
      allocationRevision: allocationResult.sceneRevision,
      allocationCalls,
      subdataFallback,
      subdataMode: subdataResult.mode,
      subdataRevision: subdataResult.sceneRevision,
      subdataCallsAtFallback: callsAtFallback,
      subdataCallsAfterFallback: callsAfterFallback,
    };
  });

  expect(outcome.nullFallback).toBe(true);
  expect(outcome.nullMode).toBe("canvas2d");
  expect(outcome.nullRevision).toBe(30);
  expect(outcome.allocationFallback).toBe(true);
  expect(outcome.allocationMode).toBe("canvas2d");
  expect(outcome.allocationRevision).toBe(31);
  expect(outcome.subdataFallback).toBe(true);
  expect(outcome.subdataMode).toBe("canvas2d");
  expect(outcome.subdataRevision).toBe(40);
  expect(outcome.subdataCallsAfterFallback).toBe(outcome.subdataCallsAtFallback);
});

test("@safety point-layout changes revoke the old front and use a bounded full upload", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const { RendererController, createGalleryState, contexts } = window.__gpuUploadHarness;
    const base = createGalleryState("ready");
    const makeScene = (revision, total) => {
      const source = base.resources.scene.value;
      const buffer = new ArrayBuffer(source.pointOffset + total * 8);
      new Uint8Array(buffer, source.pointOffset).fill(revision);
      return { ...source, buffer, total, floorCount: total, surfaceCount: 0, revision };
    };
    const stateFor = (scene) => ({
      ...base,
      resources: { ...base.resources, scene: { status: "ready", value: scene, problem: null } },
    });
    const canvases = Array.from({ length: 2 }, () => document.createElement("canvas"));
    canvases.forEach((canvas) => document.body.append(canvas));
    const renderer = new RendererController(...canvases);
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const waitFor = async (predicate, attempts = 120) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (predicate()) return true;
        await nextFrame();
      }
      return predicate();
    };
    const initial = makeScene(60, 100_000);
    renderer.setState(stateFor(initial));
    const context = contexts.at(-1);
    const initialComplete = await waitFor(() => renderer.diagnostics().sceneRevision === 60
      && renderer.diagnostics().renderedPoints === initial.total);
    const replacement = makeScene(61, 120_000);
    const beforeWrites = context.calls.filter((call) => call.type === "chunk").length;
    renderer.setState(stateFor(replacement));
    const firstReplacementWrite = await waitFor(() =>
      context.calls.filter((call) => call.type === "chunk").length > beforeWrites);
    const replacementPartial = renderer.diagnostics();
    const complete = await waitFor(() => renderer.diagnostics().sceneRevision === 61
      && renderer.diagnostics().renderedPoints === replacement.total);
    const copies = context.calls.filter((call) => call.type === "copy").length;
    const liveBuffers = context.liveBufferCount;
    renderer.dispose();
    canvases.forEach((canvas) => canvas.remove());
    return {
      initialComplete,
      firstReplacementWrite,
      replacementRevision: replacementPartial.sceneRevision,
      replacementPoints: replacementPartial.renderedPoints,
      complete,
      copies,
      liveBuffers,
    };
  });

  expect(outcome.initialComplete).toBe(true);
  expect(outcome.firstReplacementWrite).toBe(true);
  expect(outcome.replacementRevision).toBe(61);
  expect(outcome.replacementPoints).toBeGreaterThan(0);
  expect(outcome.replacementPoints).toBeLessThan(120_000);
  expect(outcome.complete).toBe(true);
  expect(outcome.copies).toBe(0);
  expect(outcome.liveBuffers).toBeLessThanOrEqual(2);
});
