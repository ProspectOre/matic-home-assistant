import { expect, test } from "@playwright/test";
import { build } from "esbuild";

// The frame-cost gate (docs/performance-frame-cost.md). How long a frame takes
// on a CI runner's software GL says little about a phone, so the gate counts
// what a frame does, which is the same on every machine, and puts a generous
// ceiling on the script time of a frame. Every layer is on.
test.skip(({ browserName }) => browserName !== "chromium", "The counts are the renderer's, not the browser's; one engine measures them");

// One animation frame while the camera moves.
const CAMERA_FRAME = {
  // The viewport comes from the resize observer.
  layoutReads: 0,
  // Matrices and overlay geometry are reused.
  typedArrays: 0,
  bufferUploads: 0,
  programCalls: 0,
  // The 2D canvas holds labels and markers, which follow the camera.
  overlayRedraws: 1,
  // The robot's mesh is one draw call and six WebGL calls.
  drawCalls: 40,
  glCalls: 385,
  textMeasures: 4,
};
// Median script time of a camera frame, in milliseconds. The container that
// set the counts measured a median of 0.5 and at most 4.8; half a 60 Hz frame
// leaves room for a loaded runner without hiding a frame that starts to do
// real work.
const CAMERA_FRAME_MS = 8;

async function loadRenderer(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/frame-cost.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    // Counts what runs inside animation-frame callbacks, per frame timestamp.
    const frames = new Map();
    let current = null;
    const nativeFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => nativeFrame((time) => {
      current = frames.get(time) ?? { layoutReads: 0, typedArrays: 0, bufferUploads: 0, programCalls: 0,
        overlayRedraws: 0, drawCalls: 0, glCalls: 0, textMeasures: 0, ms: 0 };
      frames.set(time, current);
      const started = performance.now();
      try {
        callback(time);
      } finally {
        current.ms += performance.now() - started;
        current = null;
      }
    });
    const count = (owner, name, ...keys) => {
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      const wrap = (original) => function (...args) {
        if (current) for (const key of keys) current[key] += 1;
        return original.apply(this, args);
      };
      Object.defineProperty(owner, name, descriptor.get
        ? { ...descriptor, get: wrap(descriptor.get) } : { ...descriptor, value: wrap(descriptor.value) });
    };
    for (const name of ["getBoundingClientRect", "getClientRects", "clientWidth", "clientHeight", "scrollWidth", "scrollHeight"]) {
      count(Element.prototype, name, "layoutReads");
    }
    for (const name of ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop"]) count(HTMLElement.prototype, name, "layoutReads");
    count(window, "getComputedStyle", "layoutReads");
    for (const name of ["Float32Array", "Float64Array", "Uint8Array", "Uint16Array", "Uint32Array", "Int32Array", "ArrayBuffer"]) {
      window[name] = new Proxy(window[name], { construct(target, args) {
        if (current) current.typedArrays += 1;
        return new target(...args);
      } });
    }
    const gl = WebGL2RenderingContext.prototype;
    const kinds = {
      drawCalls: ["drawArrays", "drawArraysInstanced", "drawElements", "drawElementsInstanced", "drawRangeElements"],
      bufferUploads: ["bufferData", "bufferSubData", "texImage2D", "texSubImage2D", "texStorage2D"],
      programCalls: ["createShader", "compileShader", "createProgram", "linkProgram", "getUniformLocation", "getAttribLocation"],
    };
    for (const name of Object.getOwnPropertyNames(gl)) {
      const descriptor = Object.getOwnPropertyDescriptor(gl, name);
      if (typeof descriptor.value !== "function" || name === "constructor") continue;
      count(gl, name, "glCalls", ...Object.keys(kinds).filter((kind) => kinds[kind].includes(name)));
    }
    count(CanvasRenderingContext2D.prototype, "measureText", "textMeasures");

    const { RendererController, createGalleryState } = await import("/frame-cost.js");
    const root = document.createElement("div");
    Object.assign(root.style, { position: "relative", width: "800px", height: "600px" });
    document.body.append(root);
    const canvases = Array.from({ length: 2 }, () => {
      const canvas = document.createElement("canvas");
      Object.assign(canvas.style, { position: "absolute", inset: "0", width: "800px", height: "600px" });
      root.append(canvas);
      return canvas;
    });
    // Every redraw of the 2D canvas starts by clearing it.
    const overlay = canvases[1].getContext("2d");
    const clearRect = overlay.clearRect;
    overlay.clearRect = function (...args) {
      if (current) current.overlayRedraws += 1;
      return clearRect.apply(this, args);
    };
    const statuses = new Map();
    const renderer = new RendererController(...canvases, {
      onModuleStatus: (module, status) => statuses.set(module, status),
    });
    const base = createGalleryState("ready");
    const key = base.resources.entry?.mapSessionKey ?? "frame";
    const ring = (x, y, width, height) => [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
    const cells = [];
    for (let x = 0; x < 8; x += 1) for (let y = 0; y < 5; y += 1) {
      cells.push({ x: 4.6 + x * 0.5, y: 3.9 + y * 0.5, dbm: -45 - x * 4 - y * 3, samples: 5, updatedAt: Date.now() / 1000 });
    }
    const state = {
      ...base, pageActive: true, optionalUiReady: true, labelsVisible: true, appearance: "photo", quality: "maximum",
      floorTypes: { status: "ready", carpet: [ring(1, 1, 2.2, 1.4), ring(1.5, 1.3, 0.6, 0.5)], vent: [ring(7.6, 0.8, 0.4, 0.25)] },
      wifiSignal: { status: "ready", surveying: false, cells, rooms: [] },
      trail: { id: "live", mapSessionKey: key, segments: [
        Array.from({ length: 160 }, (_, index) => [0.9 + index * 0.045, 2 + Math.sin(index / 7) * 0.9 + index * 0.02]),
        [[8.2, 2.2]],
      ] },
      resources: { ...base.resources,
        entry: base.resources.entry && { ...base.resources.entry, mapSessionKey: key },
        // A heading turns the robot's dot into its mesh.
        pose: { ...base.resources.pose, value: { ...base.resources.pose.value, heading: 0.6 } },
        areas: { ...base.resources.areas, value: { ...base.resources.areas.value, zones: [
          { kind: "no_go", outline: ring(5.2, 1, 1.6, 1.2), holes: [[[5.6, 1.3], [6.2, 1.3], [5.9, 1.8]]], roomIds: [], areaIds: [] },
          { kind: "unknown", outline: ring(1, 4, 1.6, 1.4), holes: [], roomIds: [], areaIds: [] },
        ] } } },
    };
    const frame = () => new Promise((resolve) => nativeFrame(() => resolve()));
    const settle = async () => {
      // Nothing left loading and two frames in a row with nothing drawn.
      for (let quiet = 0, attempt = 0; quiet < 2 && attempt < 600; attempt += 1) {
        const before = frames.size;
        await frame();
        quiet = frames.size === before && ![...statuses.values()].includes("loading") ? quiet + 1 : 0;
      }
    };
    // Runs `step` before each of `count` frames and returns what those frames did.
    const measure = async (count, step) => {
      const measured = [];
      for (let index = 0; index < count; index += 1) {
        const before = new Set(frames.keys());
        step(index);
        await frame();
        measured.push(...[...frames].filter(([time]) => !before.has(time)).map(([, counts]) => counts));
      }
      return measured;
    };
    window.__frameCost = { renderer, state, settle, measure, frame, statuses, frames };
  });
}

for (const view of ["three", "top"]) {
  test(`a camera frame in the ${view === "three" ? "3D" : "top"} view stays within its cost with every layer on`, async ({ page }) => {
    await loadRenderer(page);
    const result = await page.evaluate(async (view) => {
      const { renderer, state, settle, measure, statuses } = window.__frameCost;
      // A map task forces the top view, so the 3D view is measured on the overview.
      renderer.setState({ ...state, view, workflow: view === "three" ? "home" : "rooms" });
      await settle();
      // The first zoom in the 3D view loads the close-zoom surfaces, once.
      renderer.zoomAt(1.02);
      await settle();
      renderer.zoomAt(1 / 1.02);
      await settle();
      const idle = await measure(5, () => {});
      // The camera alternates between two positions, so every frame draws the same things.
      const camera = await measure(60, (index) => renderer.panBy(index % 2 ? -3 : 3, index % 2 ? -2 : 2));
      const zoom = await measure(20, (index) => renderer.zoomAt(index % 2 ? 1 / 1.02 : 1.02));
      const cursor = await measure(10, (index) => renderer.setCursor({ x: 2 + index * 0.01, y: 2 }));
      return { mode: renderer.diagnostics().mode, layers: statuses.get("renderer-layers"), idle,
        camera: [...camera, ...zoom], cursor };
    }, view);
    expect(result.mode).toBe("webgl2");
    expect(result.layers).toBe("ready");
    expect(result.idle, "a still map draws nothing").toEqual([]);
    expect(result.camera).toHaveLength(80);
    for (const key of Object.keys(CAMERA_FRAME)) {
      const most = Math.max(...result.camera.map((frame) => frame[key]));
      expect(most, `${key} in a camera frame`).toBeLessThanOrEqual(CAMERA_FRAME[key]);
    }
    expect(new Set(result.camera.map((frame) => frame.drawCalls)).size, "every camera frame draws the same things").toBe(1);
    const times = result.camera.map((frame) => frame.ms).sort((left, right) => left - right);
    test.info().annotations.push({ type: "camera frame script ms",
      description: `median ${times[40].toFixed(2)}, p95 ${times[75].toFixed(2)}, max ${times[79].toFixed(2)}` });
    expect(times[40], "median script time of a camera frame").toBeLessThan(CAMERA_FRAME_MS);
    // A pointer that only moves the cursor mark leaves the WebGL canvas alone.
    expect(result.cursor).toHaveLength(10);
    for (const frame of result.cursor) expect(frame).toMatchObject({ glCalls: 0, overlayRedraws: 1, layoutReads: 0 });
  });
}

test("frames that only advance a scene upload leave the 2D canvas alone", async ({ page }) => {
  await loadRenderer(page);
  const result = await page.evaluate(async () => {
    const { renderer, state, settle, frame, frames } = window.__frameCost;
    renderer.setState(state);
    await settle();
    // 400,000 points are 3.2 MB, seven frames of the 512 KB a frame may upload.
    const scene = state.resources.scene.value;
    const total = 400_000;
    const next = { ...scene, buffer: new ArrayBuffer(total * 8), pointOffset: 0, total, floorCount: total, surfaceCount: 0,
      revision: scene.revision + 1 };
    const before = new Set(frames.keys());
    renderer.setState({ ...state, resources: { ...state.resources, scene: { ...state.resources.scene, value: next } } });
    for (let attempt = 0; attempt < 600 && renderer.diagnostics().sceneRevision !== next.revision; attempt += 1) await frame();
    await settle();
    return { revision: renderer.diagnostics().sceneRevision === next.revision,
      upload: [...frames].filter(([time]) => !before.has(time)).map(([, counts]) => counts) };
  });
  expect(result.revision).toBe(true);
  const uploads = result.upload.filter((frame) => frame.bufferUploads > 0);
  expect(uploads.length).toBeGreaterThanOrEqual(7);
  // The 2D canvas is redrawn for the new state and for the published scene.
  expect(result.upload.reduce((sum, frame) => sum + frame.overlayRedraws, 0)).toBeLessThanOrEqual(2);
  for (const frame of result.upload) expect(frame.layoutReads).toBe(0);
});
