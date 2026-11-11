import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadRenderer(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state"; export { SurfaceGeometry as RealSurfaceGeometry } from "./frontend/map-studio-v4/surface-geometry";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/surface-lifecycle.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const constants = {
      ARRAY_BUFFER: 0x8892, DYNAMIC_DRAW: 0x88e8, STATIC_DRAW: 0x88e4,
      COPY_READ_BUFFER: 0x8f36, COPY_WRITE_BUFFER: 0x8f37, NO_ERROR: 0,
      VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82, UNSIGNED_SHORT: 0x1403, UNSIGNED_BYTE: 0x1401,
      DEPTH_TEST: 0x0b71, LEQUAL: 0x0203, BLEND: 0x0be2, SRC_ALPHA: 0x0302,
      ONE_MINUS_SRC_ALPHA: 0x0303, ONE: 1, COLOR_BUFFER_BIT: 0x4000,
      DEPTH_BUFFER_BIT: 0x0100, POINTS: 0x0000, TRIANGLES: 0x0004,
    };
    const contexts = [];
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      if (kind !== "webgl2") return originalGetContext.call(this, kind, options);
      const id = contexts.length;
      const gl = {
        id,
        programs: [],
        deletedPrograms: [],
        pointDraws: [],
        instancedDraws: [],
        uploadedBytes: 0,
        createShader: (type) => ({ id: `${id}:shader:${type}` }),
        shaderSource() {}, compileShader() {}, getShaderParameter() { return true; }, deleteShader() {},
        createProgram() { const program = { id: `${id}:program:${this.programs.length}` }; this.programs.push(program); return program; },
        attachShader() {}, linkProgram() {}, getProgramParameter() { return true; },
        getUniformLocation: (_program, name) => ({ name }),
        deleteProgram(program) { this.deletedPrograms.push(program); },
        createBuffer: () => ({ id: `${id}:buffer` }), createVertexArray: () => ({ id: `${id}:vao` }),
        deleteBuffer() {}, deleteVertexArray() {},
        bufferData() {}, bufferSubData(_target, _offset, bytes) { this.uploadedBytes += bytes.byteLength; }, getError() { return 0; },
        drawArrays(_mode, first, count) { this.pointDraws.push({ first, count }); },
        drawArraysInstanced(_mode, _first, _vertices, count) {
          this.instancedDraws.push(count);
          if (window.__surfaceLifecycle?.slowDraw) {
            const deadline = performance.now() + 24;
            while (performance.now() < deadline) { /* exercise the real slow-frame policy */ }
          }
        },
      };
      const proxy = new Proxy(gl, { get(target, key) {
        if (key in target) return target[key];
        if (key in constants) return constants[key];
        return () => {};
      } });
      contexts.push(proxy);
      return proxy;
    };

    const { RendererController, createGalleryState, RealSurfaceGeometry } = await import("/surface-lifecycle.js");
    const constructed = [];
    const drawn = [];
    class SurfaceGeometry {
      constructor(gl) {
        this.gl = gl;
        this.program = gl.createProgram();
        constructed.push(gl.id);
      }
      draw({ scene }) {
        drawn.push(this.gl.id);
        return scene.total;
      }
      clearDetail() {}
      dispose() { this.gl.deleteProgram(this.program); }
    }
    window.__surfaceLifecycle = { RendererController, createGalleryState, contexts, constructed, drawn, SurfaceGeometry, RealSurfaceGeometry };
  });
}

test("surface geometry loads only on close zoom and status follows demand", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const harness = window.__surfaceLifecycle;
    let resolveLoad;
    let loads = 0;
    const deferred = new Promise((resolve) => { resolveLoad = resolve; });
    const created = await (async () => {
      const base = harness.createGalleryState("ready");
      const scene = { ...base.resources.scene.value, buffer: new ArrayBuffer(32), pointOffset: 0,
        total: 4, floorCount: 4, surfaceCount: 0, tileIndex: undefined,
        metadata: { ...base.resources.scene.value.metadata, metersPerCell: 0.05, span: [180, 140], rooms: [] } };
      let state = { ...base, view: "three", appearance: "photo", optionalUiReady: false, resources: { ...base.resources,
        scene: { ...base.resources.scene, value: scene }, pose: { ...base.resources.pose, value: null } } };
      const canvases = [document.createElement("canvas"), document.createElement("canvas")];
      canvases.forEach((canvas) => { Object.assign(canvas.style, { width: "480px", height: "320px" }); document.body.append(canvas); });
      const statuses = [];
      const renderer = new harness.RendererController(...canvases, {
        onModuleStatus: (module, status) => { if (module === "surface-geometry") statuses.push(status); },
        loadSurfaceGeometry: () => { loads += 1; return deferred; },
      });
      renderer.setState(state);
      return { renderer, canvases, statuses, state };
    })();
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    for (let index = 0; index < 12; index += 1) await frame();
    const overview = { loads, status: created.statuses.at(-1) ?? "idle" };
    created.state = { ...created.state, optionalUiReady: true };
    created.renderer.setState(created.state);
    created.renderer.setCamera({ ...created.renderer.camera, distance: 15 });
    for (let index = 0; index < 4; index += 1) await frame();
    const readyOverview = { loads, status: created.statuses.at(-1) ?? "idle" };
    created.renderer.setCamera({ ...created.renderer.camera, distance: 1.5 });
    for (let index = 0; index < 8 && loads === 0; index += 1) await frame();
    const loading = { loads, status: created.statuses.at(-1) };
    created.renderer.setCamera({ ...created.renderer.camera, distance: 15 });
    await frame();
    const hidden = created.statuses.at(-1);
    created.renderer.setCamera({ ...created.renderer.camera, distance: 1.5 });
    await frame();
    const returned = { loads, status: created.statuses.at(-1) };
    resolveLoad({ SurfaceGeometry: harness.SurfaceGeometry });
    for (let index = 0; index < 8 && created.statuses.at(-1) !== "ready"; index += 1) await frame();
    for (let index = 0; index < 4; index += 1) await frame();
    const ready = { loads, status: created.statuses.at(-1), draws: harness.drawn.length };
    created.renderer.dispose();
    created.canvases.forEach((canvas) => canvas.remove());
    return { overview, readyOverview, loading, hidden, returned, ready };
  });
  expect(outcome).toEqual({
    overview: { loads: 0, status: "idle" },
    readyOverview: { loads: 0, status: "idle" },
    loading: { loads: 1, status: "loading" },
    hidden: "idle",
    returned: { loads: 1, status: "loading" },
    ready: { loads: 1, status: "ready", draws: expect.any(Number) },
  });
  expect(outcome.ready.draws).toBeGreaterThan(0);
});

test("failed geometry keeps point fallback and is not re-imported after zoom cycling", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const harness = window.__surfaceLifecycle;
    const base = harness.createGalleryState("ready");
    const scene = { ...base.resources.scene.value, buffer: new ArrayBuffer(32), pointOffset: 0,
      total: 4, floorCount: 4, surfaceCount: 0, tileIndex: undefined,
      metadata: { ...base.resources.scene.value.metadata, metersPerCell: 0.05, span: [180, 140], rooms: [] } };
    const state = { ...base, view: "three", appearance: "photo", optionalUiReady: true, resources: { ...base.resources,
      scene: { ...base.resources.scene, value: scene }, pose: { ...base.resources.pose, value: null } } };
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    canvases.forEach((canvas) => { Object.assign(canvas.style, { width: "480px", height: "320px" }); document.body.append(canvas); });
    const statuses = [];
    let loads = 0;
    const renderer = new harness.RendererController(...canvases, {
      onModuleStatus: (module, status) => { if (module === "surface-geometry") statuses.push(status); },
      loadSurfaceGeometry: async () => { loads += 1; throw new Error("surface chunk unavailable"); },
    });
    renderer.setState(state);
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    renderer.setCamera({ ...renderer.camera, distance: 1.5 });
    for (let index = 0; index < 20 && statuses.at(-1) !== "failed"; index += 1) await frame();
    const failed = { loads, status: statuses.at(-1), mode: renderer.diagnostics().mode,
      renderedPoints: renderer.diagnostics().renderedPoints };
    renderer.setCamera({ ...renderer.camera, distance: 15 });
    await frame();
    const hidden = statuses.at(-1);
    renderer.setCamera({ ...renderer.camera, distance: 1.5 });
    await frame();
    const returned = { loads, status: statuses.at(-1) };
    renderer.dispose(); canvases.forEach((canvas) => canvas.remove());
    return { failed, hidden, returned };
  });
  expect(outcome.failed.loads).toBe(1);
  expect(outcome.failed.status).toBe("failed");
  expect(outcome.failed.mode).toBe("webgl2");
  expect(outcome.failed.renderedPoints).toBeGreaterThan(0);
  expect(outcome.hidden).toBe("idle");
  expect(outcome.returned).toEqual({ loads: 1, status: "failed" });
});

test("disposal fences a late geometry import and its status callback", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const harness = window.__surfaceLifecycle;
    const base = harness.createGalleryState("ready");
    const scene = { ...base.resources.scene.value, buffer: new ArrayBuffer(32), pointOffset: 0,
      total: 4, floorCount: 4, surfaceCount: 0, tileIndex: undefined,
      metadata: { ...base.resources.scene.value.metadata, metersPerCell: 0.05, span: [180, 140], rooms: [] } };
    const state = { ...base, view: "three", appearance: "photo", optionalUiReady: true, resources: { ...base.resources,
      scene: { ...base.resources.scene, value: scene }, pose: { ...base.resources.pose, value: null } } };
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    canvases.forEach((canvas) => { Object.assign(canvas.style, { width: "480px", height: "320px" }); document.body.append(canvas); });
    const statuses = [];
    let resolveLoad;
    const deferred = new Promise((resolve) => { resolveLoad = resolve; });
    const renderer = new harness.RendererController(...canvases, {
      onModuleStatus: (module, status) => { if (module === "surface-geometry") statuses.push(status); },
      loadSurfaceGeometry: () => deferred,
    });
    renderer.setState(state);
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    renderer.setCamera({ ...renderer.camera, distance: 1.5 });
    for (let index = 0; index < 10 && statuses.at(-1) !== "loading"; index += 1) await frame();
    renderer.dispose();
    const afterDispose = [...statuses];
    resolveLoad({ SurfaceGeometry: harness.SurfaceGeometry });
    await Promise.resolve(); await Promise.resolve(); await frame();
    canvases.forEach((canvas) => canvas.remove());
    return { statuses, afterDispose, constructions: harness.constructed.length };
  });
  expect(outcome.afterDispose).toContain("loading");
  expect(outcome.statuses).toEqual(outcome.afterDispose);
  expect(outcome.statuses).not.toContain("ready");
  expect(outcome.constructions).toBe(0);
});

test("context restoration disposes old geometry and draws only with the restored context", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const harness = window.__surfaceLifecycle;
    const base = harness.createGalleryState("ready");
    const scene = { ...base.resources.scene.value, buffer: new ArrayBuffer(32), pointOffset: 0,
      total: 4, floorCount: 4, surfaceCount: 0, tileIndex: undefined,
      metadata: { ...base.resources.scene.value.metadata, metersPerCell: 0.05, span: [180, 140], rooms: [] } };
    const state = { ...base, view: "three", appearance: "photo", optionalUiReady: true, resources: { ...base.resources,
      scene: { ...base.resources.scene, value: scene }, pose: { ...base.resources.pose, value: null } } };
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    canvases.forEach((canvas) => { Object.assign(canvas.style, { width: "480px", height: "320px" }); document.body.append(canvas); });
    const renderer = new harness.RendererController(...canvases, {
      loadSurfaceGeometry: async () => ({ SurfaceGeometry: harness.SurfaceGeometry }),
    });
    renderer.setState(state);
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    renderer.setCamera({ ...renderer.camera, distance: 1.5 });
    for (let index = 0; index < 20 && harness.constructed.length < 1; index += 1) await frame();
    const firstCanvas = canvases[0];
    firstCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const oldContextDisposedOnLoss = harness.contexts[0].deletedPrograms.some((program) => program.id === "0:program:1");
    firstCanvas.dispatchEvent(new Event("webglcontextrestored"));
    for (let index = 0; index < 24 && harness.drawn.at(-1) !== 1; index += 1) await frame();
    const afterRestore = { contexts: [...harness.constructed], draws: [...harness.drawn],
      oldContextDisposedOnLoss, currentContextCount: harness.contexts.length };
    renderer.dispose(); canvases.forEach((canvas) => canvas.remove());
    return { afterRestore, deleted: harness.contexts.map((context) => context.deletedPrograms.map((program) => program.id)) };
  });
  expect(outcome.afterRestore).toEqual({ contexts: [0, 1], draws: expect.arrayContaining([0, 1]),
    oldContextDisposedOnLoss: true, currentContextCount: 2 });
  expect(outcome.afterRestore.draws.at(-1)).toBe(1);
  expect(outcome.deleted[0]).toContain("0:program:1");
  expect(outcome.deleted[1]).toContain("1:program:1");
});

test("large unindexed scenes keep the simplified point fallback instead of loading geometry", async ({ page }) => {
  await loadRenderer(page);
  const outcome = await page.evaluate(async () => {
    const harness = window.__surfaceLifecycle;
    const base = harness.createGalleryState("ready");
    const total = 350_001;
    const scene = { ...base.resources.scene.value, buffer: new ArrayBuffer(total * 8), pointOffset: 0,
      total, floorCount: total, surfaceCount: 0, tileIndex: undefined,
      metadata: { ...base.resources.scene.value.metadata, metersPerCell: 0.05, span: [180, 140], rooms: [] } };
    const state = { ...base, view: "three", appearance: "photo", quality: "efficient", optionalUiReady: true, resources: { ...base.resources,
      scene: { ...base.resources.scene, value: scene }, pose: { ...base.resources.pose, value: null } } };
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    canvases.forEach((canvas) => { Object.assign(canvas.style, { width: "480px", height: "320px" }); document.body.append(canvas); });
    const statuses = [];
    let loads = 0;
    const renderer = new harness.RendererController(...canvases, {
      onModuleStatus: (module, status) => { if (module === "surface-geometry") statuses.push(status); },
      loadSurfaceGeometry: async () => { loads += 1; return { SurfaceGeometry: harness.SurfaceGeometry }; },
    });
    renderer.setState(state);
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    renderer.setCamera({ ...renderer.camera, distance: 1.5 });
    for (let index = 0; index < 60 && renderer.diagnostics().renderedPoints === 0; index += 1) await frame();
    const result = { loads, status: statuses.at(-1), mode: renderer.diagnostics().mode,
      renderedPoints: renderer.diagnostics().renderedPoints, total, pointDrawCount: harness.contexts[0].pointDraws.at(-1)?.count ?? 0 };
    renderer.dispose(); canvases.forEach((canvas) => canvas.remove());
    return result;
  });
  expect(outcome.loads).toBe(0);
  expect(outcome.status).toBe("failed");
  expect(outcome.mode).toBe("webgl2");
  expect(outcome.renderedPoints).toBeGreaterThan(0);
  expect(outcome.renderedPoints).toBeLessThan(outcome.total);
  expect(outcome.pointDrawCount).toBeLessThan(outcome.total);
});

for (const touch of [false, true]) {
  test(`Auto reduces a large close surface after sustained slow frames on ${touch ? "touch" : "desktop"}`, async ({ page }) => {
    await page.addInitScript((coarse) => {
      const match = window.matchMedia.bind(window);
      window.matchMedia = (query) => query === "(any-pointer: coarse)"
        ? { matches: coarse, media: query, addEventListener() {}, removeEventListener() {} } : match(query);
    }, touch);
    await loadRenderer(page);
    const outcome = await page.evaluate(async () => {
      const harness = window.__surfaceLifecycle;
      const base = harness.createGalleryState("ready");
      const total = 600_000;
      const scene = { ...base.resources.scene.value, buffer: new ArrayBuffer(total * 8), pointOffset: 0,
        total, floorCount: total, surfaceCount: 0,
        tileIndex: { runs: new Uint32Array([0, total, 0, 0, 0]), floorRuns: 1 },
        metadata: { ...base.resources.scene.value.metadata, metersPerCell: 0.05, span: [32, 32], sampleStep: 1, rooms: [] } };
      const state = { ...base, pageActive: true, view: "three", appearance: "photo", quality: "auto", optionalUiReady: true,
        resources: { ...base.resources, scene: { ...base.resources.scene, value: scene }, pose: { ...base.resources.pose, value: null } } };
      const canvases = [document.createElement("canvas"), document.createElement("canvas")];
      canvases.forEach((canvas) => { Object.assign(canvas.style, { width: "480px", height: "320px" }); document.body.append(canvas); });
      const details = [];
      const renderer = new harness.RendererController(...canvases, {
        loadSurfaceGeometry: async () => ({ SurfaceGeometry: harness.RealSurfaceGeometry }),
        onSurfaceDetail: (detail) => details.push(detail),
      });
      renderer.setState(state);
      renderer.setCamera({ ...renderer.camera, distance: 1.5, targetX: 0, targetZ: 0 });
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      for (let index = 0; index < 120; index += 1) {
        await frame();
        if (harness.contexts[0].uploadedBytes >= total * 8 && harness.contexts[0].instancedDraws.length) break;
      }
      await frame();
      const before = harness.contexts[0].instancedDraws.at(-1) ?? 0;
      harness.slowDraw = true;
      for (let index = 0; index < 9; index += 1) { renderer.requestRender(); await frame(); }
      const after = harness.contexts[0].instancedDraws.at(-1) ?? 0;
      const frameMs = renderer.diagnostics().lastFrameMs;
      renderer.dispose();
      canvases.forEach((canvas) => canvas.remove());
      return { before, after, frameMs, uploadedBytes: harness.contexts[0].uploadedBytes, details };
    });
    expect(outcome.uploadedBytes).toBeGreaterThanOrEqual(600_000 * 8);
    expect(outcome.before).toBe(touch ? 300_000 : 600_000);
    expect(outcome.frameMs).toBeGreaterThan(18);
    expect(outcome.after).toBeGreaterThan(0);
    expect(outcome.after).toBeLessThan(outcome.before);
    expect(outcome.details).toContain("limited");
  });
}
