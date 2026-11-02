// Offline synthetic close-zoom surface qualification. This measures the
// checked-out production/review bundles in Chromium; it does not contact HA or
// robots and does not qualify host, mobile, physical-device, or GPU-driver use.
//
// Examples (after building and freezing the candidate bundles):
//   node scripts/measure_surface_capacity.mjs --smoke
//   node scripts/measure_surface_capacity.mjs --points 1200000 --cycles 20 --soak-seconds 1800
//   node scripts/measure_surface_capacity.mjs --points 1500000 --cycles 20
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus, loadavg, platform, arch } from "node:os";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { hashSources } from "./source_stamp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionPath = "custom_components/matic_robot/map_studio_v4";
const reviewPath = "tests/browser/.generated/map-studio-v4-review";
const tag = "matic-map-studio-gallery-v0-4-0";
const TILE_CELLS = 32;
const GRID_TILES = 32;
const SPAN_CELLS = GRID_TILES * TILE_CELLS;
const MAX_POINTS = 1_500_000;
const MAX_RUNS = 8_192;
const { values } = parseArgs({ options: {
  checkout: { type: "string", default: root },
  points: { type: "string", default: "1200000" },
  cycles: { type: "string", default: "20" },
  "soak-seconds": { type: "string", default: "0" },
  "sample-seconds": { type: "string", default: "60" },
  "wait-timeout-ms": { type: "string", default: "120000" },
  headed: { type: "boolean", default: false },
  smoke: { type: "boolean", default: false },
} });
const integer = (name, minimum, maximum) => {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${name}: ${values[name]}`);
  }
  return value;
};
const points = values.smoke ? 16_384 : integer("points", 1, MAX_POINTS);
if (!values.smoke && points !== 1_200_000 && points !== 1_500_000) {
  throw new Error("--points must be 1200000 or 1500000; use --smoke for a short check");
}
const cycles = values.smoke ? 1 : integer("cycles", 1, 100);
const soakSeconds = values.smoke ? 0 : integer("soak-seconds", 0, 1_800);
const sampleSeconds = integer("sample-seconds", 1, 300);
const waitTimeoutMs = values.smoke ? 30_000 : integer("wait-timeout-ms", 1_000, 300_000);
const checkout = resolve(values.checkout);
const headless = !values.headed;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashBundle = async (directory) => {
  const files = new Map();
  const visit = async (folder, prefix = "") => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(join(folder, entry.name), `${name}/`);
      else if (name.endsWith(".js")) files.set(name, await readFile(join(folder, entry.name)));
    }
  };
  await visit(directory);
  const hash = createHash("sha256");
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(name).update("\0").update(bytes).update("\0");
  }
  return { hash: hash.digest("hex"), files };
};

const production = await hashBundle(join(checkout, productionPath));
const review = await hashBundle(join(checkout, reviewPath));
const stamp = JSON.parse(await readFile(join(checkout, reviewPath, "source-stamp.json"), "utf8"));
const computedSourceHash = await hashSources(checkout, stamp.inputs);
if (computedSourceHash !== stamp.sourceHash) {
  throw new Error(`Review source stamp mismatch: expected ${stamp.sourceHash}, computed ${computedSourceHash}`);
}
for (const required of ["frontend/map-studio-v4/scene-parser.ts", "frontend/map-studio-v4/surface-geometry.ts"]) {
  if (!stamp.inputs.includes(required)) throw new Error(`Review source stamp omits ${required}`);
}

// Bundle the source parser in memory for fixture admission. The production and
// review renderer remain the installed bundles above; this parser bundle is a
// local validator and its source is bound to the same checked source stamp.
const parserBuild = await build({
  absWorkingDir: checkout,
  stdin: {
    contents: 'export { SceneParser } from "./frontend/map-studio-v4/scene-parser";',
    resolveDir: checkout,
    sourcefile: "capacity-parser-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
});

const fixture = (() => {
  const floorCount = Math.round(points * 0.68);
  const surfaceCount = points - floorCount;
  const activeTileCount = values.smoke ? 256 : GRID_TILES * GRID_TILES;
  const metadata = Buffer.from(JSON.stringify({
    meters_per_cell: 0.015,
    origin_cells: [0, 0],
    span_cells: [SPAN_CELLS, SPAN_CELLS],
    sample_step: 1,
    rooms: [],
  }));
  const pointOffset = 24 + metadata.byteLength;
  const buffer = Buffer.alloc(pointOffset + points * 8);
  buffer.write("MATIC3D\0", 0, "binary");
  buffer.writeUInt16LE(1, 8);
  buffer.writeUInt16LE(8, 10);
  buffer.writeUInt32LE(metadata.byteLength, 12);
  buffer.writeUInt32LE(floorCount, 16);
  buffer.writeUInt32LE(surfaceCount, 20);
  metadata.copy(buffer, 24);

  // Spread the short smoke fixture over the same 32-by-32 tile grid used by
  // the large fixtures. Full candidate runs exercise all 1,024 source tiles;
  // their two ordered ranges create 2,048 parser-index runs.
  const tileIds = Array.from({ length: activeTileCount }, (_, index) =>
    Math.floor(index * GRID_TILES * GRID_TILES / activeTileCount));
  const writeRange = (rangeStart, count, raised) => {
    const basePerTile = Math.floor(count / activeTileCount);
    const extraTiles = count % activeTileCount;
    let point = rangeStart;
    for (let ordinal = 0; ordinal < tileIds.length; ordinal += 1) {
      const tile = tileIds[ordinal];
      const tileX = tile % GRID_TILES;
      const tileY = Math.floor(tile / GRID_TILES);
      const tileCount = basePerTile + (ordinal < extraTiles ? 1 : 0);
      if (tileCount > TILE_CELLS * TILE_CELLS) throw new Error("Fixture density exceeds distinct per-tile cell slots");
      for (let local = 0; local < tileCount; local += 1) {
        // Use a deterministic permutation so each range occupies distinct
        // cells within its tile. Raised points can share XY with floor points,
        // as real floor/wall layers can, while remaining separately indexed.
        const cell = (local * 37 + (raised ? 199 : 0)) % (TILE_CELLS * TILE_CELLS);
        const x = tileX * TILE_CELLS + cell % TILE_CELLS;
        const y = tileY * TILE_CELLS + Math.floor(cell / TILE_CELLS);
        const offset = pointOffset + point * 8;
        buffer.writeUInt16LE(x, offset);
        buffer.writeUInt16LE(y, offset + 2);
        buffer[offset + 4] = raised ? 12 + ((local + tile * 7) % 53) : 0;
        buffer[offset + 5] = raised ? 115 + (tile % 55) : 178 + (tile % 42);
        buffer[offset + 6] = raised ? 129 + (local % 45) : 194 + (tile % 38);
        buffer[offset + 7] = raised ? 145 + (tile % 58) : 207 + (local % 32);
        point += 1;
      }
    }
    if (point !== rangeStart + count) throw new Error("Fixture point count mismatch");
  };
  writeRange(0, floorCount, false);
  writeRange(floorCount, surfaceCount, true);
  return {
    buffer,
    sha256: sha256(buffer),
    metadataSha256: sha256(metadata),
    bytes: buffer.byteLength,
    points,
    floorCount,
    surfaceCount,
    activeTiles: activeTileCount,
    spanCells: [SPAN_CELLS, SPAN_CELLS],
    metersPerCell: 0.015,
    sampleStep: 1,
    tileCells: TILE_CELLS,
    raisedHeightCells: [12, 64],
    indexRunLimit: MAX_RUNS,
  };
})();

const registration = JSON.parse(execFileSync(join(checkout, ".venv/bin/python"),
  [join(checkout, "scripts/frontend_assets.py")], { cwd: checkout, encoding: "utf8" }));
const registeredAssets = new Map();
for (const [url, path] of Object.entries(registration.staticPaths)) {
  const local = join(checkout, path);
  if ((await stat(local)).isDirectory()) {
    const result = await hashBundle(local);
    for (const [name, bytes] of result.files) registeredAssets.set(`${url}/${name}`, bytes);
  } else registeredAssets.set(url, await readFile(local));
}

const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  response.setHeader("Cache-Control", "no-store");
  if (path === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    const hostImports = registration.extraModuleUrls
      .map((url) => `import ${JSON.stringify(url)};`).join(" ");
    response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline close-zoom capacity lab</title><style>html,body{height:100%;margin:0}body{overflow:hidden}</style><body><script type="module">${hostImports}import "/candidate/index.js";import "/candidate/review.js";await customElements.whenDefined(${JSON.stringify(tag)});</script></body></html>`);
  } else if (path === "/__harness/scene-parser.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(parserBuild.outputFiles[0].contents);
  } else if (path === "/__harness/fixture.matic3d") {
    response.setHeader("Content-Type", "application/octet-stream");
    response.end(fixture.buffer);
  } else if (registeredAssets.has(path)) {
    response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "application/octet-stream");
    response.end(registeredAssets.get(path));
  } else {
    const parts = path.split("/");
    const variant = parts[1];
    const name = parts.slice(2).join("/");
    const known = variant === "candidate";
    if (known && !name) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end("<!doctype html>");
    } else if (known && production.files.has(name)) {
      response.setHeader("Content-Type", "text/javascript; charset=utf-8");
      response.end(production.files.get(name));
    } else if (known && review.files.has(name)) {
      response.setHeader("Content-Type", "text/javascript; charset=utf-8");
      response.end(review.files.get(name).toString().replaceAll('"/map_studio_v4/', '"/candidate/'));
    } else {
      response.writeHead(404);
      response.end();
    }
  }
});
await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = { page: [], console: [], request: [], gl: [] };
const cyclesResult = [];
const soak = [];
let finalResourceCounts = null;
let baselineResourceCounts = null;
let browserInfo = null;

const drainGlErrors = (gl) => {
  const found = [];
  for (let index = 0; index < 32; index += 1) {
    const code = gl.getError();
    if (code === gl.NO_ERROR) break;
    found.push(code);
  }
  return found;
};

try {
  browser = await chromium.launch({
    headless,
    args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.console.push(message.text()); });
  page.on("requestfailed", (request) => errors.request.push(`${request.url()}: ${request.failure()?.errorText ?? "failed"}`));
  await page.addInitScript(() => {
    const state = {
      draws: { calls: 0, floorCalls: 0, surfaceCalls: 0, floorInstances: 0, surfaceInstances: 0 },
      resources: {
        created: { buffer: 0, vertexArray: 0, program: 0, shader: 0, texture: 0, framebuffer: 0, renderbuffer: 0 },
        deleted: { buffer: 0, vertexArray: 0, program: 0, shader: 0, texture: 0, framebuffer: 0, renderbuffer: 0 },
        live: { buffer: 0, vertexArray: 0, program: 0, shader: 0, texture: 0, framebuffer: 0, renderbuffer: 0 },
      },
      resourceIds: new WeakMap(),
      nextId: 1,
      instrumentationErrors: [],
    };
    window.__surfaceCapacityInstrumentation = state;
    const prototype = WebGL2RenderingContext.prototype;
    const resourceMethods = [
      ["createBuffer", "deleteBuffer", "buffer"],
      ["createVertexArray", "deleteVertexArray", "vertexArray"],
      ["createProgram", "deleteProgram", "program"],
      ["createShader", "deleteShader", "shader"],
      ["createTexture", "deleteTexture", "texture"],
      ["createFramebuffer", "deleteFramebuffer", "framebuffer"],
      ["createRenderbuffer", "deleteRenderbuffer", "renderbuffer"],
    ];
    for (const [createName, deleteName, kind] of resourceMethods) {
      const create = prototype[createName];
      const remove = prototype[deleteName];
      if (typeof create !== "function" || typeof remove !== "function") {
        state.instrumentationErrors.push(`missing ${createName}/${deleteName}`);
        continue;
      }
      prototype[createName] = function (...args) {
        const resource = create.apply(this, args);
        if (resource) {
          state.resourceIds.set(resource, { kind, id: state.nextId++, deleted: false });
          state.resources.created[kind] += 1;
          state.resources.live[kind] += 1;
        }
        return resource;
      };
      prototype[deleteName] = function (resource) {
        const record = resource && state.resourceIds.get(resource);
        if (record && !record.deleted) {
          record.deleted = true;
          state.resources.deleted[kind] += 1;
          state.resources.live[kind] = Math.max(0, state.resources.live[kind] - 1);
        }
        return remove.call(this, resource);
      };
    }
    const draw = prototype.drawArraysInstanced;
    if (typeof draw !== "function") state.instrumentationErrors.push("missing drawArraysInstanced");
    else prototype.drawArraysInstanced = function (mode, first, vertexCount, instances) {
      const stats = state.draws;
      if (mode === this.TRIANGLES && instances > 0) {
        stats.calls += 1;
        if (vertexCount === 6) { stats.floorCalls += 1; stats.floorInstances += instances; }
        if (vertexCount === 18) { stats.surfaceCalls += 1; stats.surfaceInstances += instances; }
      }
      return draw.call(this, mode, first, vertexCount, instances);
    };
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(`${origin}/`) || url.startsWith("blob:")) return route.continue();
    errors.request.push(`unexpected external origin: ${url}`);
    return route.abort();
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto(origin);
  await page.evaluate(async () => {
    const { SceneParser } = await import("/__harness/scene-parser.js");
    window.__surfaceCapacityParser = new SceneParser();
    await customElements.whenDefined("matic-map-studio-gallery-v0-4-0");
  });
  browserInfo = {
    version: browser.version(),
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? null,
    initialLoadAverage: loadavg(),
    viewport: "1280x900",
    dpr: 1,
    headless,
    renderer: "Chromium WebGL2 via ANGLE/SwiftShader where supported",
    network: "local loopback only; external origins blocked",
  };

  const mountAndDraw = async (cycle) => {
    const result = await page.evaluate(async ({ expectedPoints, expectedFloor, expectedSurface, timeoutMs, cycleIndex }) => {
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const afterRemoval = async () => {
        await waitFrame();
        await waitFrame();
        await new Promise((resolve) => setTimeout(resolve, 0));
      };
      const stats = window.__surfaceCapacityInstrumentation;
      if (stats.instrumentationErrors.length) throw new Error(`GL instrumentation unavailable: ${stats.instrumentationErrors.join(", ")}`);
      const existing = document.querySelector("matic-map-studio-gallery-v0-4-0");
      if (existing) {
        existing.remove();
        await afterRemoval();
      }
      const baselineAfterRemoval = structuredClone(stats.resources.live);
      const gallery = document.createElement("matic-map-studio-gallery-v0-4-0");
      gallery.controls = false;
      document.body.append(gallery);
      await gallery.updateComplete;

      const parser = window.__surfaceCapacityParser;
      const response = await fetch("/__harness/fixture.matic3d", { cache: "no-store" });
      if (!response.ok) throw new Error(`fixture request failed: ${response.status}`);
      const parsed = await parser.parse(await response.arrayBuffer());
      const tileIndex = parsed.tileIndex;
      const runCount = tileIndex?.runs.length / 5;
      if (parsed.total !== expectedPoints || parsed.floorCount !== expectedFloor || parsed.surfaceCount !== expectedSurface
        || !tileIndex || tileIndex.floorRuns < 1 || tileIndex.floorRuns >= runCount
        || runCount > 8192 || tileIndex.runs.length % 5 !== 0) {
        throw new Error(`invalid parsed fixture/index: ${JSON.stringify({ total: parsed.total, floor: parsed.floorCount, surface: parsed.surfaceCount, runCount, floorRuns: tileIndex?.floorRuns })}`);
      }
      let expectedStart = 0;
      for (let offset = 0; offset < tileIndex.runs.length; offset += 5) {
        const start = tileIndex.runs[offset];
        const end = tileIndex.runs[offset + 1];
        if (start !== expectedStart || end <= start) throw new Error(`invalid tile-index coverage at run ${offset / 5}`);
        expectedStart = end;
      }
      if (expectedStart !== expectedPoints) throw new Error("tile index did not cover all fixture points");

      const old = gallery.getWorkspaceSnapshot();
      const oldScene = old.resources.scene.value;
      const targetRevision = (oldScene?.revision ?? 0) + cycleIndex + 1;
      const nextScene = {
        ...parsed,
        revision: targetRevision,
        etag: null,
        source: "live",
      };
      const state = {
        ...old,
        dataMode: "live",
        coherence: "current",
        view: "three",
        quality: "maximum",
        appearance: "rooms",
        floor: { ...old.floor, readOnly: false },
        map: { ...old.map, available: true, complete: true, floorCoherent: true, sessionVerified: true, exactPose: false },
        // This is a surface-only fixture: omit the gallery's synthetic robot
        // pose so production does not request robot-model assets.
        resources: {
          ...old.resources,
          scene: { status: "ready", value: nextScene, problem: null },
          pose: { status: "idle", value: null, problem: null },
        },
      };
      const startedAt = performance.now();
      gallery.replaceWorkspaceState(state);
      await gallery.updateComplete;
      const findByPrefix = (root, prefix) => [...root.querySelectorAll("*")].find((element) => element.localName.startsWith(prefix));
      const shell = findByPrefix(gallery.shadowRoot, "matic-map-shell-v4");
      const mapCanvas = shell && findByPrefix(shell.shadowRoot, "matic-map-canvas-v4");
      if (!mapCanvas) throw new Error("production map canvas not found");
      const diagnostics = () => mapCanvas.rendererDiagnostics();
      let until = performance.now() + timeoutMs;
      let current = diagnostics();
      while ((!current || current.mode !== "webgl2" || current.sceneRevision !== targetRevision
        || current.sourcePoints !== expectedPoints || current.renderedPoints !== expectedPoints)
        && performance.now() < until) {
        await waitFrame();
        current = diagnostics();
      }
      if (!current || current.mode !== "webgl2" || current.sceneRevision !== targetRevision
        || current.sourcePoints !== expectedPoints || current.renderedPoints !== expectedPoints) {
        throw new Error(`Full-quality GPU upload/render frontier did not complete in ${timeoutMs}ms: ${JSON.stringify({
          expectedRevision: targetRevision, expectedPoints, diagnostics: current,
        })}`);
      }
      const uploadGate = {
        quality: "maximum",
        sceneRevision: current.sceneRevision,
        sourcePoints: current.sourcePoints,
        renderedPoints: current.renderedPoints,
        allAdmittedPointsRendered: current.renderedPoints === expectedPoints,
      };
      const sceneCanvas = mapCanvas.canvasIdentity().scene;
      const gl = sceneCanvas?.getContext("webgl2");
      if (!gl || gl.isContextLost()) throw new Error("production WebGL2 scene context unavailable or lost");
      gl.finish();
      const preZoomErrors = [];
      for (let index = 0; index < 32; index += 1) {
        const code = gl.getError();
        if (code === gl.NO_ERROR) break;
        preZoomErrors.push(code);
      }
      if (preZoomErrors.length) throw new Error(`WebGL errors before close zoom: ${preZoomErrors.join(",")}`);
      stats.draws = { calls: 0, floorCalls: 0, surfaceCalls: 0, floorInstances: 0, surfaceInstances: 0 };
      const zoomStarted = performance.now();
      const canvasBounds = sceneCanvas.getBoundingClientRect();
      const cellPixelsAtCurrentCamera = () => 0.015 * canvasBounds.height
        / (2 * diagnostics().cameraDistance * Math.tan(Math.PI / 3.15 / 2));
      let zoomSteps = 0;
      while (cellPixelsAtCurrentCamera() <= 2.5 && zoomSteps < 8) {
        mapCanvas.zoomBy(10);
        zoomSteps += 1;
      }
      current = diagnostics();
      until = performance.now() + timeoutMs;
      const closeZoomCellPixels = cellPixelsAtCurrentCamera();
      if (!(closeZoomCellPixels > 2.5)) {
        throw new Error(`bounded close zoom could not cross the production surface threshold: ${JSON.stringify({
          cameraDistance: current.cameraDistance, cellPixels: closeZoomCellPixels, zoomSteps,
        })}`);
      }
      while ((!stats.draws.surfaceCalls || !stats.draws.surfaceInstances || current?.renderedPoints <= 0)
        && performance.now() < until) {
        await waitFrame();
        current = diagnostics();
      }
      if (!stats.draws.surfaceCalls || !stats.draws.surfaceInstances || current?.renderedPoints <= 0) {
        throw new Error(`close zoom produced no instanced raised-surface draw: ${JSON.stringify({ diagnostics: current, draws: stats.draws })}`);
      }
      gl.finish();
      const glErrors = [];
      for (let index = 0; index < 32; index += 1) {
        const code = gl.getError();
        if (code === gl.NO_ERROR) break;
        glErrors.push(code);
      }
      if (glErrors.length) throw new Error(`WebGL errors after close zoom: ${glErrors.join(",")}`);
      if (gl.isContextLost()) throw new Error("WebGL context lost after close-zoom surface draw");
      const draw = structuredClone(stats.draws);
      const camera = mapCanvas.rendererController?.camera;
      const cellPixels = 0.015 * canvasBounds.height
        / (2 * current.cameraDistance * Math.tan(Math.PI / 3.15 / 2));
      if (!(cellPixels > 2.5)) throw new Error(`close zoom did not cross the production surface threshold: ${cellPixels}px/cell`);
      return {
        cycle: cycleIndex + 1,
        elapsedToSurfaceDrawMs: performance.now() - startedAt,
        elapsedZoomToSurfaceDrawMs: performance.now() - zoomStarted,
        sceneRevision: current.sceneRevision,
        uploadGate,
        sourcePoints: current.sourcePoints,
        renderedPoints: current.renderedPoints,
        mode: current.mode,
        cameraDistance: current.cameraDistance,
        fitDistance: current.fitDistance,
        closeZoomRatio: camera?.distance ? current.fitDistance / camera.distance : null,
        cellPixels,
        zoomSteps,
        draw,
        tileRuns: runCount,
        floorTileRuns: tileIndex.floorRuns,
        surfaceTileRuns: runCount - tileIndex.floorRuns,
        glErrors,
        resourcesBeforeMount: baselineAfterRemoval,
        resourcesAfterDraw: structuredClone(stats.resources.live),
      };
    }, { expectedPoints: points, expectedFloor: fixture.floorCount, expectedSurface: fixture.surfaceCount, timeoutMs: waitTimeoutMs, cycleIndex: cycle });
    return result;
  };

  const heapSample = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const usage = await cdp.send("Runtime.getHeapUsage");
    return { at: new Date().toISOString(), usedBytes: usage.usedSize, backingStorageBytes: usage.backingStorageSize ?? null,
      loadAverage: loadavg() };
  };
  const resourceSnapshot = async () => page.evaluate(() => structuredClone(window.__surfaceCapacityInstrumentation.resources));

  baselineResourceCounts = await resourceSnapshot();
  const baselineHeapBytes = await heapSample();
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const result = await mountAndDraw(cycle);
    cyclesResult.push({ ...result, heapBytes: await heapSample() });
  }

  const soakStarted = Date.now();
  while (Date.now() - soakStarted < soakSeconds * 1000) {
    const delay = Math.min(sampleSeconds * 1000, soakSeconds * 1000 - (Date.now() - soakStarted));
    if (delay > 0) await new Promise((done) => setTimeout(done, delay));
    soak.push({ elapsedSeconds: (Date.now() - soakStarted) / 1000, ...(await heapSample()),
      draws: await page.evaluate(() => structuredClone(window.__surfaceCapacityInstrumentation.draws)) });
  }

  // Explicitly detach the last production renderer, let its disconnect cleanup
  // run, then force JS GC and compare app-visible WebGL handles with baseline.
  await page.evaluate(async () => {
    const gallery = document.querySelector("matic-map-studio-gallery-v0-4-0");
    gallery?.remove();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.__surfaceCapacityParser?.dispose();
    window.__surfaceCapacityParser = null;
  });
  await cdp.send("HeapProfiler.collectGarbage");
  finalResourceCounts = await resourceSnapshot();
  const finalHeap = await heapSample();
  if (errors.page.length || errors.console.length || errors.request.length) {
    throw new Error(`Browser errors: ${JSON.stringify(errors)}`);
  }
  const liveResourcesReturned = Object.keys(baselineResourceCounts.live).every((kind) =>
    finalResourceCounts.live[kind] === baselineResourceCounts.live[kind]);
  if (!liveResourcesReturned) {
    throw new Error(`App-visible WebGL resource counts did not return to baseline: ${JSON.stringify({ baseline: baselineResourceCounts.live, final: finalResourceCounts.live })}`);
  }
  const timings = cyclesResult.map((sample) => sample.elapsedToSurfaceDrawMs).sort((a, b) => a - b);
  const quantile = (probability) => timings[Math.ceil(timings.length * probability) - 1] ?? null;
  const output = {
    schema: 1,
    measuredAt: new Date().toISOString(),
    checkout,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: checkout, encoding: "utf8" }).trim(),
    trackedWorktreeDirty: Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: checkout, encoding: "utf8" }).trim()),
    parserSourceStamp: { expected: stamp.sourceHash, recomputed: computedSourceHash, match: true,
      includesParserAndSurfaceRenderer: true },
    bundleHashes: { production: production.hash, review: review.hash },
    harnessSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    conditions: browserInfo,
    fixture: { ...fixture, buffer: undefined },
    independentRun: true,
    cycles,
    requestedSoakSeconds: soakSeconds,
    baselineHeapBytes,
    cyclesResult,
    soak,
    remountToSurfaceDrawMs: { samples: timings.length, p50: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99), max: quantile(1) },
    resources: { baseline: baselineResourceCounts, afterFinalDisposal: finalResourceCounts,
      returnedToBaseline: liveResourcesReturned, finalHeap, ownership: "WebGL handle create/delete calls visible to the page; driver allocation/reclamation is not observable" },
    errors,
    limits: [
      "Synthetic 32-cell tile fixture in Chromium only; no Home Assistant, robot, host CPU/memory, mobile device, or physical acceptance.",
      "WebGL2/SwiftShader execution and draw completion via gl.finish do not measure hardware GPU throughput, driver memory, or display presentation.",
      "Tracked WebGL handles are app-visible create/delete calls, not proof that a driver reclaimed backing allocations.",
      "Heap samples are Chromium forced-GC observations with no claim about host process memory or leak freedom beyond this bounded run.",
      "Each selected point tile is synthetic; this is close-zoom renderer capacity evidence, not real map fidelity or end-to-end protocol evidence.",
    ],
  };
  if (errors.gl.length) throw new Error(`WebGL errors: ${JSON.stringify(errors.gl)}`);
  console.log(JSON.stringify(output, null, 2));
  await context.close();
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
