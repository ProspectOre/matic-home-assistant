import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadSurfaceRenderer(page, { slowDraws = 0 } = {}) {
  const bundle = await build({
    stdin: {
      contents: `export { RendererController } from "./frontend/map-studio-v4/renderer-controller";
        export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";
        export { parseSceneBuffer } from "./frontend/map-studio-v4/scene-parser";
        export { PERSPECTIVE_FIELD_OF_VIEW, lookAt, multiply, perspective } from "./frontend/map-studio-v4/renderer-math";`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/map-studio-v4-surface-geometry.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return page.evaluate(async (slowDrawCount) => {
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    const contexts = new WeakMap();
    window.__slowSurfaceDrawsRemaining = slowDrawCount;
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      if (kind === "webgl2") {
        const native = nativeGetContext.call(this, kind, { ...options, preserveDrawingBuffer: true });
        if (!native) return native;
        let wrapped = contexts.get(native);
        if (!wrapped) {
          wrapped = new Proxy(native, { get(target, property) {
            if (property === "drawArraysInstanced") return (...args) => {
              if (window.__slowSurfaceDrawsRemaining > 0) {
                window.__slowSurfaceDrawsRemaining -= 1;
                const until = performance.now() + 24;
                while (performance.now() < until) { /* simulate a slow submitted surface frame */ }
              }
              return target.drawArraysInstanced(...args);
            };
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          } });
          contexts.set(native, wrapped);
        }
        return wrapped;
      }
      return nativeGetContext.call(this, kind, options);
    };
    window.__surfaceGeometry = await import("/map-studio-v4-surface-geometry.js");
    const probeCanvas = document.createElement("canvas");
    const context = probeCanvas.getContext("webgl2");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  }, slowDraws);
}

const baseFloor = () => {
  const cells = [];
  for (let x = 24; x < 40; x += 1) {
    for (let y = 12; y < 26; y += 1) {
      if (x === 33 && y === 18) continue;
      cells.push({ x, y, color: x < 32 ? [230, 44, 28] : [28, 66, 238] });
    }
  }
  return cells;
};

async function renderFixture(page, { floorCells, surfaceCells = [], quality = "maximum", slowDraws = 0 }) {
  return page.evaluate(async ({ floorCells, surfaceCells, quality, slowDraws }) => {
    const { RendererController, createGalleryState, parseSceneBuffer } = window.__surfaceGeometry;
    const makeScene = (floor, surface, revision) => ({
      ...parseSceneBuffer(encodeScene(floor, surface)),
      revision,
      etag: null,
      source: "live",
    });
    const encodeScene = (floor, surface) => {
      const tileKey = (point) => `${Math.floor(point.x / 32)},${Math.floor(point.y / 32)}`;
      const orderedFloor = [...floor].sort((left, right) => tileKey(left).localeCompare(tileKey(right))
        || left.y - right.y || left.x - right.x);
      const orderedSurface = [...surface].sort((left, right) => tileKey(left).localeCompare(tileKey(right))
        || left.y - right.y || left.x - right.x || left.z - right.z);
      const metadata = new TextEncoder().encode(JSON.stringify({ meters_per_cell: 0.015,
        origin_cells: [0, 0], span_cells: [64, 32], sample_step: 1, rooms: [] }));
      const offset = 24 + metadata.byteLength;
      const buffer = new ArrayBuffer(offset + (orderedFloor.length + orderedSurface.length) * 8);
      const view = new DataView(buffer);
      new Uint8Array(buffer, 0, 8).set(new TextEncoder().encode("MATIC3D\0"));
      view.setUint16(8, 1, true); view.setUint16(10, 8, true);
      view.setUint32(12, metadata.byteLength, true);
      view.setUint32(16, orderedFloor.length, true); view.setUint32(20, orderedSurface.length, true);
      new Uint8Array(buffer, 24, metadata.byteLength).set(metadata);
      [...orderedFloor, ...orderedSurface].forEach((point, index) => {
        const pointOffset = offset + index * 8;
        view.setUint16(pointOffset, point.x, true); view.setUint16(pointOffset + 2, point.y, true);
        view.setUint8(pointOffset + 4, point.z ?? 0);
        view.setUint8(pointOffset + 5, point.color[0]); view.setUint8(pointOffset + 6, point.color[1]);
        view.setUint8(pointOffset + 7, point.color[2]);
      });
      return buffer;
    };
    const base = createGalleryState("ready");
    const scene = makeScene(floorCells, surfaceCells, 1);
    const container = document.createElement("div");
    Object.assign(container.style, { position: "relative", width: "800px", height: "600px" });
    document.body.append(container);
    const canvas = document.createElement("canvas");
    const overlay = document.createElement("canvas");
    for (const element of [canvas, overlay]) {
      Object.assign(element.style, { position: "absolute", inset: "0", width: "800px", height: "600px" });
      container.append(element);
    }
    let surfaceStatus = "idle";
    const renderer = new RendererController(canvas, overlay, {
      onModuleStatus(module, status) { if (module === "surface-geometry") surfaceStatus = status; },
    });
    const stateFor = (value, activeScene) => ({
      ...value,
      pageActive: true,
      optionalUiReady: true,
      view: "three",
      quality,
      appearance: "photo",
      resources: { ...value.resources, scene: { status: "ready", value: activeScene, problem: null },
        pose: { ...value.resources.pose, value: null } },
    });
    renderer.setState(stateFor(base, scene));
    const centerX = (31.5 - (64 - 1) / 2) * -0.015;
    const centerZ = (18.5 - (32 - 1) / 2) * 0.015;
    renderer.setCamera({ yaw: -Math.PI / 4, pitch: 0.8148, distance: 0.46,
      targetX: centerX, targetZ: centerZ, orthographic: false }, false);
    const gl = canvas.getContext("webgl2");
    const slowFrameSamples = [];
    let previousSlowDraws = window.__slowSurfaceDrawsRemaining;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const diagnostics = renderer.diagnostics();
      if (window.__slowSurfaceDrawsRemaining < previousSlowDraws && diagnostics.lastFrameMs > 18) {
        slowFrameSamples.push({ frameMs: diagnostics.lastFrameMs, slowFrames: diagnostics.slowFrames });
      }
      previousSlowDraws = window.__slowSurfaceDrawsRemaining;
      if (window.__slowSurfaceDrawsRemaining > 0) renderer.setCamera(renderer.camera, false);
      if (renderer.diagnostics().sceneRevision === 1 && renderer.diagnostics().renderedPoints >= scene.total
        && surfaceStatus === "ready" && window.__slowSurfaceDrawsRemaining === 0) break;
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    gl.finish();
    const initialPixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, initialPixels);
    const visiblePixels = Array.from({ length: initialPixels.length / 4 }, (_, index) => initialPixels[index * 4 + 3])
      .filter((alpha) => alpha > 0).length;
    window.__activeSurfaceFixture = { renderer, canvas, overlay, stateFor, base, scene, encodeScene, quality,
      get surfaceStatus() { return surfaceStatus; } };
    return { diagnostics: renderer.diagnostics(), surfaceStatus, visiblePixels, context: gl.getContextAttributes(),
      slowDrawsUsed: slowDraws - window.__slowSurfaceDrawsRemaining, slowFrameSamples };
  }, { floorCells, surfaceCells, quality, slowDraws });
}

for (const quality of ["maximum", "auto"]) {
  test(`@safety close oblique floor cells fill their measured area across a tile seam at ${quality} quality`, async ({ page }) => {
    const slowDraws = quality === "auto" ? 8 : 0;
    const webgl2Available = await loadSurfaceRenderer(page, { slowDraws });
    test.skip(!webgl2Available, "WebGL2 is unavailable in this browser project");
    const result = await renderFixture(page, { floorCells: baseFloor(), quality, slowDraws });
    expect(result.diagnostics.mode).toBe("webgl2");
    expect(result.surfaceStatus).toBe("ready");
    expect(result.visiblePixels).toBeGreaterThan(0);
    expect(result.context.preserveDrawingBuffer).toBe(true);
    if (quality === "auto") {
      expect(result.slowDrawsUsed).toBe(8);
      expect(result.slowFrameSamples.length, "Auto reduces detail after repeated slow surface frames")
        .toBeGreaterThanOrEqual(3);
    }
    const sampled = await page.evaluate(() => {
      const fixture = window.__activeSurfaceFixture;
      const { canvas, renderer } = fixture;
      const gl = canvas.getContext("webgl2");
      const meters = 0.015;
      const sample = (x, y) => {
        const screen = renderer.mapToScreen({ x: x * meters, y: y * meters });
        const rect = canvas.getBoundingClientRect();
        const px = Math.max(0, Math.min(canvas.width - 1, Math.floor(screen.x * canvas.width / rect.width)));
        const py = Math.max(0, Math.min(canvas.height - 1, canvas.height - 1 - Math.floor(screen.y * canvas.height / rect.height)));
        const color = new Uint8Array(4); gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, color);
        return [...color];
      };
      const probes = [];
      for (let x = 28; x <= 36; x += 1) {
        for (let y = 14; y <= 22; y += 1) {
          if (x === 33 && y === 18) continue;
          for (const dx of [-0.28, 0.28]) for (const dy of [-0.28, 0.28]) {
            probes.push({ x, y, side: x < 32 ? "red" : "blue", color: sample(x + dx, y + dy) });
          }
        }
      }
      const hole = [];
      for (const dx of [-0.28, 0, 0.28]) for (const dy of [-0.28, 0, 0.28]) hole.push(sample(33 + dx, 18 + dy));
      return { probes, hole, diagnostics: renderer.diagnostics() };
    });
    const covered = sampled.probes.filter(({ side, color }) => color[3] > 80
      && (side === "red" ? color[0] > color[2] * 1.8 : color[2] > color[0] * 1.8));
    expect(sampled.diagnostics.mode).toBe("webgl2");
    expect(sampled.diagnostics.renderedPoints).toBe(sampled.diagnostics.sourcePoints);
    expect(sampled.probes.length).toBeGreaterThan(250);
    expect(covered.length, `expected near-complete cell coverage, got ${covered.length}/${sampled.probes.length}`).toBeGreaterThanOrEqual(
      Math.floor(sampled.probes.length * 0.94),
    );
    expect(sampled.hole.every((color) => color[3] < 20), "the unobserved source cell remains a real hole").toBe(true);

    // Replace an edge cell with a differently colored observation and remove
    // its seam neighbor. With no lineage hint this exercises full-scene upload.
    const update = await page.evaluate(async () => {
      const fixture = window.__activeSurfaceFixture;
      const sample = (x, y) => {
        const screen = fixture.renderer.mapToScreen({ x: x * 0.015, y: y * 0.015 });
        const rect = fixture.canvas.getBoundingClientRect();
        const px = Math.floor(screen.x * fixture.canvas.width / rect.width);
        const py = fixture.canvas.height - 1 - Math.floor(screen.y * fixture.canvas.height / rect.height);
        const gl = fixture.canvas.getContext("webgl2");
        const color = new Uint8Array(4);
        gl.finish();
        gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, color);
        return [...color];
      };
      const floors = [];
      for (let x = 24; x < 40; x += 1) for (let y = 12; y < 26; y += 1) {
        if (x === 33 && y === 18 || x === 31 && y === 19) continue;
        floors.push({ x, y, color: x === 32 && y === 19 ? [30, 230, 45] : x < 32 ? [230, 44, 28] : [28, 66, 238] });
      }
      const metadataBuffer = fixture.encodeScene(floors, []);
      const parsed = window.__surfaceGeometry.parseSceneBuffer(metadataBuffer);
      const scene = { ...parsed, revision: 2, etag: null, source: "live" };
      fixture.renderer.setState(fixture.stateFor(fixture.base, scene));
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (fixture.renderer.diagnostics().sceneRevision === 2
          && fixture.renderer.diagnostics().renderedPoints >= scene.total
          && sample(32, 19)[1] > sample(32, 19)[0] * 1.5 && sample(31, 19)[3] < 20) break;
      }
      return { diagnostics: fixture.renderer.diagnostics(), changed: sample(32, 19), removed: sample(31, 19) };
    });
    expect(update.diagnostics.sceneRevision).toBe(2);
    expect(update.changed[3]).toBeGreaterThan(80);
    expect(update.changed[1]).toBeGreaterThan(update.changed[0] * 1.5);
    expect(update.removed[3], "removed floor cell clears after full replacement upload").toBeLessThan(20);
    await page.evaluate(() => window.__activeSurfaceFixture?.renderer.dispose());
  });
}

test("@safety close oblique surface voxels form an occluding wall face instead of isolated samples", async ({ page }) => {
  const webgl2Available = await loadSurfaceRenderer(page);
  test.skip(!webgl2Available, "WebGL2 is unavailable in this browser project");
  const floor = baseFloor();
  const surface = [];
  // A contiguous wall crossing x=32 makes face coverage include a real
  // source-tile seam. The upper yellow voxel sits over four blue levels and
  // the source floor, testing the visible top face and depth ordering.
  for (let x = 31; x <= 32; x += 1) {
    for (let y = 12; y < 26; y += 1) {
      for (let z = 0; z < 4; z += 1) surface.push({ x, y, z, color: [24, 48, 245] });
    }
  }
  const topVoxel = { x: 31, y: 18, z: 4, color: [248, 222, 20] };
  surface.push(topVoxel);
  await renderFixture(page, { floorCells: floor, surfaceCells: surface, quality: "maximum" });
  const result = await page.evaluate(({ topVoxel }) => {
    const fixture = window.__activeSurfaceFixture;
    const { PERSPECTIVE_FIELD_OF_VIEW, lookAt, multiply, perspective } = window.__surfaceGeometry;
    const { renderer, canvas } = fixture;
    const gl = canvas.getContext("webgl2");
    const camera = renderer.camera;
    const meters = 0.015;
    const span = [64, 32];
    const horizontal = Math.cos(camera.pitch) * camera.distance;
    const eye = [camera.targetX + Math.sin(camera.yaw) * horizontal,
      Math.sin(camera.pitch) * camera.distance, camera.targetZ + Math.cos(camera.yaw) * horizontal];
    const matrix = multiply(perspective(PERSPECTIVE_FIELD_OF_VIEW, canvas.width / canvas.height, 0.02, 60),
      lookAt(eye, [camera.targetX, 0, camera.targetZ]));
    const project = ([x, y, z]) => {
      const world = [-(x - (span[0] - 1) / 2) * meters, y * meters, (z - (span[1] - 1) / 2) * meters];
      const clipX = matrix[0] * world[0] + matrix[4] * world[1] + matrix[8] * world[2] + matrix[12];
      const clipY = matrix[1] * world[0] + matrix[5] * world[1] + matrix[9] * world[2] + matrix[13];
      const clipW = matrix[3] * world[0] + matrix[7] * world[1] + matrix[11] * world[2] + matrix[15];
      return [(clipX / clipW * 0.5 + 0.5) * canvas.width, (-clipY / clipW * 0.5 + 0.5) * canvas.height];
    };
    const read = (x, y) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.round(x), canvas.height - 1 - Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    };
    const samples = [];
    for (const dy of [-0.32, -0.16, 0, 0.16, 0.32]) for (const dx of [-0.32, -0.16, 0, 0.16, 0.32]) {
      samples.push(read(...project([topVoxel.x + dx, topVoxel.z + 0.5, topVoxel.y + dy])));
    }
    return { samples, diagnostics: renderer.diagnostics() };
  }, { topVoxel });
  expect(result.diagnostics.mode).toBe("webgl2");
  const yellow = result.samples.filter((pixel) => pixel[3] > 80 && pixel[0] > pixel[2] * 1.8 && pixel[1] > pixel[2] * 1.8);
  const blue = result.samples.filter((pixel) => pixel[3] > 80 && pixel[2] > pixel[0] * 1.8);
  expect(yellow.length, "connected voxel top face covers its measured interior").toBeGreaterThanOrEqual(20);
  expect(blue.length, "upper wall voxel and its depth-tested face occlude lower levels").toBe(0);
  await page.evaluate(() => window.__activeSurfaceFixture?.renderer.dispose());
});
