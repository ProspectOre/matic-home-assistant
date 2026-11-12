import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { compactJavaScript } from "../../scripts/compact_javascript.mjs";
import { liveScene, LIVE_SCENE_FETCH, pageId, sceneMetadata, syntheticPages } from "./scene_manifest_fixture.mjs";

const parserModule = "scene-codec.js";
async function loadModule(page, { fallback = false, backend = false, effects = false, productionCompact = false } = {}) {
  if (fallback) await page.addInitScript(() => { window.Worker = undefined; });
  const contents = effects
    ? `export { MaticBackend } from "./frontend/map-studio-v4/backend";
      export { EffectController } from "./frontend/map-studio-v4/effects";
      export { WorkspaceStore } from "./frontend/map-studio-v4/state";
      export { syntheticEntry } from "./frontend/map-studio-v4-review/synthetic-fixtures";`
    : backend
    ? 'export { MaticBackend } from "./frontend/map-studio-v4/backend"; export { SceneParser } from "./frontend/map-studio-v4/scene-parser";'
    : 'export { SceneParser } from "./frontend/map-studio-v4/scene-parser";';
  const bundle = await build({
    stdin: { contents, resolveDir: process.cwd() },
    bundle: true,
    format: "esm",
    minify: true,
    write: false,
  });
  const source = productionCompact
    ? await compactJavaScript(bundle.outputFiles[0].text)
    : bundle.outputFiles[0].text;
  await page.route(`**/${parserModule}`, (route) => route.fulfill({
    contentType: "text/javascript",
    body: source,
  }));
  await page.goto("/");
}

function sceneBuffer({ pointCount = 8, floorCount = pointCount, surfaceCount = 0, origin = [10, 10], coverage } = {}) {
  const metadata = Buffer.from(JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: origin,
    sample_step: 1,
    rooms: [],
    ...(coverage ? { coverage } : {}),
  }));
  const buffer = Buffer.alloc(24 + metadata.byteLength + pointCount * 8);
  buffer.write("MATIC3D\0", 0, "binary");
  buffer.writeUInt16LE(1, 8);
  buffer.writeUInt16LE(8, 10);
  buffer.writeUInt32LE(metadata.byteLength, 12);
  buffer.writeUInt32LE(floorCount, 16);
  buffer.writeUInt32LE(surfaceCount, 20);
  metadata.copy(buffer, 24);
  for (let index = 24 + metadata.byteLength; index < buffer.byteLength; index += 1) {
    buffer[index] = (index * 17) & 0xff;
  }
  return buffer;
}


const toBase64 = (buffer) => buffer.toString("base64");


test("@safety minified real Worker parses spatial data without retaining optional comparison coverage", async ({ page }) => {
  const mask = Buffer.alloc(1000);
  mask[0] = 1;
  const compressed = deflateSync(mask);
  const coverage = {
    version: 1, status: "verified", encoding: "zlib-bitset-little-v1", origin_cells: [10, 10],
    meters_per_cell: 0.015, span_cells: [100, 80], observed_cells: 1,
    mask_sha256: createHash("sha256").update(compressed).digest("hex"),
    mask_zlib_base64: compressed.toString("base64"), diff_eligible: true,
  };
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.codecWorkerReplies = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (event) => window.codecWorkerReplies.push(event.data.ok));
      }
    };
  });
  await loadModule(page, { productionCompact: true });
  const result = await page.evaluate(async ({ module, samples }) => {
    const { SceneParser } = await import(module);
    const parser = new SceneParser();
    const results = [];
    try {
      for (const sample of samples) {
        const input = Uint8Array.from(atob(sample), (value) => value.charCodeAt(0)).buffer;
        const parsed = await parser.parse(input);
        results.push({ transferred: input.byteLength === 0, total: parsed.total, coverage: parsed.metadata.coverage ?? null });
      }
      return { results, workerReplies: window.codecWorkerReplies };
    } finally { parser.dispose(); }
  }, { module: `/${parserModule}`, samples: [
    toBase64(sceneBuffer()), toBase64(sceneBuffer({ coverage })),
    toBase64(sceneBuffer({ coverage: { ...coverage, origin_cells: [11, 10] } })),
  ] });
  expect(result.workerReplies).toEqual([true, true, true]);
  expect(result.results.map(({ transferred }) => transferred)).toEqual([true, true, true]);
  expect(result.results.map(({ total }) => total)).toEqual([8, 8, 8]);
  expect(result.results.map(({ coverage }) => coverage)).toEqual([null, null, null]);
});


// Runs `parser.assemble` in the page on base64 inputs and reports the result.
const assembleIn = (page, { manifest, batches, base = null, signal = false }) => page.evaluate(async ({ module, manifest, batches, base }) => {
  const { SceneParser } = await import(module);
  const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
  const encode = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let text = "";
    for (let start = 0; start < bytes.length; start += 32_768) text += String.fromCharCode(...bytes.subarray(start, start + 32_768));
    return btoa(text);
  };
  const parser = new SceneParser();
  try {
    let baseScene = null;
    if (base) {
      const assembled = await parser.assemble(decode(base.manifest), base.batches.map(({ ids, body }) => ({ ids, body: decode(body) })), null);
      baseScene = { ...assembled.parsed, revision: 10, etag: null, source: "live", manifest: decode(base.manifest) };
    }
    const baseBytes = baseScene?.buffer.byteLength ?? 0;
    const result = await parser.assemble(decode(manifest), batches.map(({ ids, body }) => ({ ids, body: decode(body) })), baseScene);
    const digest = await crypto.subtle.digest("SHA-256", result.parsed.buffer);
    return {
      scene: result.parsed.buffer.byteLength < 2_000_000 ? encode(result.parsed.buffer) : null,
      sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      total: result.parsed.total,
      hint: result.deltaHint ?? null,
      baseAttached: baseScene ? baseScene.buffer.byteLength === baseBytes : null,
    };
  } catch (error) {
    return { error: error.code || error.name };
  } finally {
    parser.dispose();
  }
}, { module: `/${parserModule}`, manifest, batches, base });

const batchOf = (scene, ids = Object.keys(scene.pages)) => ({
  ids,
  body: Buffer.concat(ids.map((id) => Buffer.from(scene.pages[id], "base64"))).toString("base64"),
});

for (const fallback of [false, true]) {
  const mode = fallback ? "without a worker" : "in the minified worker";

  test(`@safety ${mode}, pages from the Python encoder assemble its saved-map scene`, async ({ page }) => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/scene_manifest_v1.json", "utf8"));
    await loadModule(page, { fallback, productionCompact: true });
    const result = await assembleIn(page, { manifest: fixture.manifest, batches: [batchOf(fixture)] });
    expect(result.sha256).toBe(fixture.scene_sha256);
  });

  test(`@safety ${mode}, a revision takes unchanged and moved pages from the scene before it`, async ({ page }) => {
    await loadModule(page, { fallback, productionCompact: true });
    const pages = syntheticPages(3, { floor: 4, surface: 3 });
    const base = liveScene(sceneMetadata(), pages);
    const baseInput = { manifest: base.manifest, batches: [batchOf(base)] };

    const [changedPage] = syntheticPages(1, { floor: 4, surface: 3, seed: 5 });
    const sameLayout = liveScene(sceneMetadata(), [pages[0], { ...changedPage, x: 1 }, pages[2]]);
    const changed = await assembleIn(page, {
      manifest: sameLayout.manifest, batches: [batchOf(sameLayout, [changedPage.id])], base: baseInput,
    });
    expect(changed.scene).toBe(sameLayout.scene);
    expect(changed.hint).toEqual({ baseRevision: 10, blockBytes: 65_536, dirtyBlocks: [0] });
    expect(changed.baseAttached).toBe(true);

    const unchanged = await assembleIn(page, { manifest: base.manifest, batches: [], base: baseInput });
    expect(unchanged.scene).toBe(base.scene);
    expect(unchanged.hint.dirtyBlocks).toEqual([]);

    // A page added left of the map moves the origin; every kept page shifts.
    const [added] = syntheticPages(1, { seed: 6 });
    const moved = liveScene(sceneMetadata({ origin: [-32, 0] }), [{ ...added, x: -1 }, ...pages]);
    const shifted = await assembleIn(page, { manifest: moved.manifest, batches: [batchOf(moved, [added.id])], base: baseInput });
    expect(shifted.scene).toBe(moved.scene);
    expect(shifted.hint).toBeNull();

    const missing = await assembleIn(page, { manifest: moved.manifest, batches: [], base: baseInput });
    expect(missing.error).toBe("invalid-scene-pages");
  });
}

test("@safety the assembler rejects malformed manifests and pages", async ({ page }) => {
  await loadModule(page, { fallback: true });
  const pages = syntheticPages(2);
  const scene = liveScene(sceneMetadata(), pages);
  const manifest = Buffer.from(scene.manifest, "base64");
  const cases = {
    magic: { manifest: Buffer.concat([Buffer.from("MATICMX\0"), manifest.subarray(8)]), batches: [batchOf(scene)] },
    truncated: { manifest: manifest.subarray(0, manifest.length - 1), batches: [batchOf(scene)] },
    short: { manifest, batches: [{ ids: [pages[0].id], body: Buffer.from(scene.pages[pages[0].id], "base64").subarray(1).toString("base64") }] },
    unknown: { manifest, batches: [{ ids: [pageId(999)], body: "" }] },
    local: { pages: [{ ...pages[0], points: [[32, 0, 0, 1, 2, 3]], floor: 1 }] },
    span: { pages: [{ ...pages[0], x: 64, points: [[0, 0, 0, 1, 2, 3]], floor: 1 }] },
  };
  const errors = {};
  for (const [name, input] of Object.entries(cases)) {
    const built = input.pages ? liveScene(sceneMetadata(), input.pages) : null;
    const result = await assembleIn(page, built
      ? { manifest: built.manifest, batches: [batchOf(built)] }
      : { manifest: input.manifest.toString("base64"), batches: input.batches });
    errors[name] = result.error;
  }
  expect(errors).toEqual({
    magic: "invalid-scene-manifest",
    truncated: "invalid-scene-manifest",
    short: "invalid-scene-pages",
    unknown: "invalid-scene-pages",
    local: "invalid-scene-pages",
    span: "invalid-scene-pages",
  });
});

test("@safety a one-page change to a large scene dirties only its blocks", async ({ page }) => {
  await loadModule(page, { productionCompact: true });
  const pages = syntheticPages(40, { floor: 7_000, surface: 8_000 });
  const metadata = sceneMetadata();
  const base = liveScene(metadata, pages);
  const [replacement] = syntheticPages(1, { floor: 7_000, surface: 8_000, seed: 9 });
  const next = liveScene(metadata, pages.map((value, index) => index === 20 ? { ...replacement, x: 20 } : value));
  const result = await assembleIn(page, {
    manifest: next.manifest,
    batches: [batchOf(next, [replacement.id])],
    base: { manifest: base.manifest, batches: [batchOf(base)] },
  });
  expect(result.total).toBe(600_000);
  expect(result.sha256).toBe(createHash("sha256").update(Buffer.from(next.scene, "base64")).digest("hex"));
  expect(result.hint.dirtyBlocks.length).toBeGreaterThan(0);
  expect(result.hint.dirtyBlocks.length).toBeLessThanOrEqual(4);
});

test("@safety backend fetches only the pages its scene lacks, 256 to a request, and follows revisions", async ({ page }) => {
  await loadModule(page, { backend: true });
  const pages = syntheticPages(300, { floor: 1, surface: 1 });
  const first = liveScene(sceneMetadata({ span: [9_600, 64] }), pages);
  const [replacement] = syntheticPages(1, { floor: 1, surface: 1, seed: 3 });
  const second = liveScene(sceneMetadata({ span: [9_600, 64] }), [{ ...replacement, x: 0 }, ...pages.slice(1)]);
  const result = await page.evaluate(async ({ module, first, second, fetchSource }) => {
    const { MaticBackend } = await import(module);
    const serve = eval(`(${fetchSource})`);
    window.__sceneRequests = [];
    window.__liveScene = first;
    const backend = new MaticBackend(() => ({ fetchWithAuth: (path) => serve(path) }));
    const sceneUrl = "/api/matic_robot/slam_scene/synthetic";
    const initial = await backend.scene(sceneUrl, 7, true, "live");
    const initialRequests = [...window.__sceneRequests];
    window.__sceneRequests = [];
    const unchanged = await backend.scene(sceneUrl, 7, true, "live", undefined, { since: 7, base: initial.scene });
    window.__liveScene = second;
    window.__liveSceneRevision = 8;
    const next = await backend.scene(sceneUrl, 7, true, "live", undefined, { since: 7, base: initial.scene });
    const followRequests = [...window.__sceneRequests];
    window.__liveScene = { ...second, pages: {} };
    let gone = null;
    try {
      await backend.scene(sceneUrl, 8, true, "live");
    } catch (error) {
      gone = error.code;
    }
    backend.dispose();
    return {
      initialRequests: initialRequests.map((path) => path.replace(/ids=([0-9a-f]+,?)+/u, (ids) => `ids:${ids.split(",").length}`)),
      unchanged: unchanged.notModified,
      followRequests: followRequests.map((path) => path.replace(/ids=.*/u, (ids) => `ids:${ids.split(",").length}`)),
      revision: next.scene.revision,
      hint: next.scene.deltaHint,
      total: next.scene.total,
      gone,
    };
  }, { module: `/${parserModule}`, first, second, fetchSource: LIVE_SCENE_FETCH });
  expect(result).toEqual({
    initialRequests: [
      "/api/matic_robot/slam_scene/synthetic",
      "/api/matic_robot/slam_scene/synthetic/pages?ids:256",
      "/api/matic_robot/slam_scene/synthetic/pages?ids:44",
    ],
    unchanged: true,
    followRequests: [
      "/api/matic_robot/slam_scene/synthetic?since=7",
      "/api/matic_robot/slam_scene/synthetic?since=7",
      "/api/matic_robot/slam_scene/synthetic/pages?ids:1",
    ],
    revision: 8,
    hint: { baseRevision: 7, blockBytes: 65_536, dirtyBlocks: [0] },
    total: 600,
    gone: "scene-pages-request-failed",
  });
});

test("@safety one pending slot runs a parse and an assembly in turn and copies the base for the worker", async ({ page }) => {
  await page.addInitScript(() => {
    window.workerInstances = [];
    window.Worker = class {
      onmessage = null; onerror = null; onmessageerror = null; messages = [];
      constructor() { window.workerInstances.push(this); }
      postMessage(data, transfer) {
        this.messages.push({ data: structuredClone(data, { transfer }), transferCount: transfer.length });
      }
      terminate() {}
    };
    URL.createObjectURL = () => "blob:scene-codec-order-test";
    URL.revokeObjectURL = () => {};
  });
  await loadModule(page);
  const scene = liveScene(sceneMetadata(), syntheticPages(2));
  const result = await page.evaluate(async ({ module, scene }) => {
    const { SceneParser } = await import(module);
    const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
    const parser = new SceneParser();
    const worker = window.workerInstances[0];
    const parsed = (buffer) => {
      const view = new DataView(buffer);
      return {
        buffer, pointOffset: 24 + view.getUint32(12, true), floorCount: view.getUint32(16, true),
        surfaceCount: view.getUint32(20, true), total: view.getUint32(16, true) + view.getUint32(20, true),
        metadata: { metersPerCell: 0.015, origin: [0, 0], span: [2048, 64], sampleStep: 1, rooms: [] },
      };
    };
    const manifest = decode(scene.manifest);
    const base = { ...parsed(decode(scene.scene)), revision: 10, etag: null, source: "live", manifest };
    const parse = parser.parse(decode(scene.scene));
    const assemble = parser.assemble(decode(scene.manifest), [{ ids: [], body: new ArrayBuffer(0) }], base);
    const queuedBeforeReply = worker.messages.length;
    worker.onmessage({ data: { id: worker.messages[0].data.id, ok: true, parsed: parsed(worker.messages[0].data.buffer) } });
    await parse;
    await Promise.resolve();
    const job = worker.messages[1];
    worker.onmessage({ data: { id: job.data.id, ok: true, parsed: parsed(decode(scene.scene)), deltaHint: { baseRevision: 10, blockBytes: 65_536, dirtyBlocks: [] } } });
    const assembled = await assemble;
    parser.dispose();
    return {
      queuedBeforeReply,
      kind: job.data.kind,
      transferCount: job.transferCount,
      baseRevision: job.data.base.revision,
      baseAttached: base.buffer.byteLength > 0 && base.manifest.byteLength > 0,
      manifestAttached: manifest.byteLength > 0,
      hint: assembled.deltaHint,
    };
  }, { module: `/${parserModule}`, scene });
  expect(result).toEqual({
    queuedBeforeReply: 1,
    kind: "assemble",
    transferCount: 2,
    baseRevision: 10,
    baseAttached: true,
    manifestAttached: true,
    hint: { baseRevision: 10, blockBytes: 65_536, dirtyBlocks: [] },
  });
});

test("@safety a failed assembly and a worker failure both drain the pending slot", async ({ page }) => {
  await page.addInitScript(() => {
    window.workerInstances = [];
    window.Worker = class {
      onmessage = null; onerror = null; onmessageerror = null; messages = []; terminated = false;
      constructor() { window.workerInstances.push(this); }
      postMessage(data, transfer) { this.messages.push({ data: structuredClone(data, { transfer }) }); }
      terminate() { this.terminated = true; }
    };
    URL.createObjectURL = () => "blob:scene-codec-drain-test";
    URL.revokeObjectURL = () => {};
  });
  await loadModule(page);
  const scene = liveScene(sceneMetadata(), syntheticPages(1));
  const result = await page.evaluate(async ({ module, scene }) => {
    const { SceneParser } = await import(module);
    const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
    const parser = new SceneParser();
    const failed = parser.assemble(decode(scene.manifest), [], null).then(() => "none", (error) => error.code || error.name);
    const afterFailure = parser.parse(decode(scene.scene));
    const worker = window.workerInstances[0];
    worker.onmessage({ data: { id: worker.messages[0].data.id, ok: false, problem: "invalid-scene-pages" } });
    const failure = await failed;
    const drain = worker.messages[1].data;
    const view = new DataView(drain.buffer);
    worker.onmessage({ data: { id: drain.id, ok: true, parsed: {
      buffer: drain.buffer, pointOffset: 24 + view.getUint32(12, true), floorCount: view.getUint32(16, true),
      surfaceCount: view.getUint32(20, true), total: view.getUint32(16, true) + view.getUint32(20, true),
      metadata: { metersPerCell: 0.015, origin: [0, 0], span: [2048, 64], sampleStep: 1, rooms: [] },
    } } });
    const drainedTotal = (await afterFailure).total;
    const crashed = parser.assemble(decode(scene.manifest), [], null).then(() => "none", (error) => error.code || error.name);
    const afterCrash = parser.parse(decode(scene.scene));
    worker.onerror(new Error("synthetic worker failure"));
    const answer = { failure, drainedTotal, crash: await crashed, fallbackTotal: (await afterCrash).total, terminated: worker.terminated };
    parser.dispose();
    return answer;
  }, { module: `/${parserModule}`, scene });
  expect(result).toEqual({
    failure: "invalid-scene-pages",
    drainedTotal: 5,
    crash: "scene-worker-failed",
    fallbackTotal: 5,
    terminated: true,
  });
});

test("@safety dispose settles a no-worker fallback assembly and remains idempotent", async ({ page }) => {
  await loadModule(page, { fallback: true });
  const scene = liveScene(sceneMetadata(), syntheticPages(1));
  const result = await page.evaluate(async ({ module, scene }) => {
    const { SceneParser } = await import(module);
    const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
    const parser = new SceneParser();
    const pending = parser.assemble(decode(scene.manifest), [], null).then(() => "none", (error) => error.code || error.name);
    parser.dispose();
    parser.dispose();
    return pending;
  }, { module: `/${parserModule}`, scene });
  expect(result).toBe("scene-parser-disposed");
});

test("@safety pending admission is bounded, abortable, and recreates the worker after an active abort", async ({ page }) => {
  await page.addInitScript(() => {
    window.workerInstances = [];
    window.Worker = class {
      onmessage = null;
      onerror = null;
      onmessageerror = null;
      messages = [];
      terminated = false;
      constructor() { window.workerInstances.push(this); }
      postMessage(data, transfer) { this.messages.push({ data: structuredClone(data, { transfer }), transferCount: transfer.length }); }
      terminate() { this.terminated = true; }
    };
    URL.createObjectURL = () => "blob:scene-codec-abort-test";
    URL.revokeObjectURL = () => {};
  });
  await loadModule(page);
  const result = await page.evaluate(async ({ module, base64 }) => {
    const { SceneParser } = await import(module);
    const parser = new SceneParser();
    const makeBuffer = () => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
    const activeController = new AbortController();
    const active = parser.parse(makeBuffer(), activeController.signal)
      .then(() => "none", (error) => error.name);
    const queuedController = new AbortController();
    const queuedBuffer = makeBuffer();
    const queued = parser.parse(queuedBuffer, queuedController.signal)
      .then(() => "none", (error) => error.name);
    const overflowBuffer = makeBuffer();
    const overflow = await parser.parse(overflowBuffer)
      .then(() => "none", (error) => error.code || error.name);
    const activeMessagesBeforeAbort = window.workerInstances[0].messages.length;
    const activeTransferCount = window.workerInstances[0].messages[0].transferCount;
    queuedController.abort();
    const queuedResult = await queued;
    const queuedMessagesAfterAbort = window.workerInstances[0].messages.length;

    const freshBuffer = makeBuffer();
    const fresh = parser.parse(freshBuffer);
    activeController.abort();
    const activeResult = await active;
    const staleWorker = window.workerInstances[0];
    const replacementWorker = window.workerInstances[1];
    const retiredMessage = staleWorker.messages[0].data;
    staleWorker.onmessage({ data: { id: retiredMessage.id, ok: true, parsed: {
      buffer: retiredMessage.buffer, pointOffset: 24, floorCount: 0, surfaceCount: 8, total: 8,
      metadata: { metersPerCell: 0.015, origin: [10, 10], span: [100, 80], sampleStep: 1, rooms: [] },
    } } });
    staleWorker.onmessageerror(new Error("late retired-worker message"));
    staleWorker.onerror(new Error("late retired-worker error"));
    const staleErrorLeftReplacementAlive = !replacementWorker.terminated;
    const freshMessage = replacementWorker.messages[0].data;
    const view = new DataView(freshMessage.buffer);
    replacementWorker.onmessage({ data: { id: freshMessage.id, ok: true, parsed: {
      buffer: freshMessage.buffer,
      pointOffset: 24 + view.getUint32(12, true),
      floorCount: view.getUint32(16, true),
      surfaceCount: view.getUint32(20, true),
      total: view.getUint32(16, true) + view.getUint32(20, true),
      metadata: { metersPerCell: 0.015, origin: [10, 10], span: [100, 80], sampleStep: 1, rooms: [] },
    } } });
    const freshResult = await fresh;
    const answer = {
      activeResult,
      queuedResult,
      overflow,
      activeMessagesBeforeAbort,
      activeTransferCount,
      queuedMessagesAfterAbort,
      queuedBufferAttached: queuedBuffer.byteLength > 0,
      overflowBufferAttached: overflowBuffer.byteLength > 0,
      workerCount: window.workerInstances.length,
      freshTotal: freshResult.total,
      activeWorkerTerminated: staleWorker.terminated,
      staleErrorLeftReplacementAlive,
    };
    parser.dispose();
    answer.allTerminated = window.workerInstances.every((worker) => worker.terminated);
    return answer;
  }, { module: `/${parserModule}`, base64: toBase64(sceneBuffer()) });
  expect(result).toEqual({
    activeResult: "AbortError",
    queuedResult: "AbortError",
    overflow: "scene-parser-busy",
    activeMessagesBeforeAbort: 1,
    activeTransferCount: 1,
    queuedMessagesAfterAbort: 1,
    queuedBufferAttached: true,
    overflowBufferAttached: true,
    workerCount: 2,
    freshTotal: 8,
    activeWorkerTerminated: true,
    staleErrorLeftReplacementAlive: true,
    allTerminated: true,
  });
});


test("@safety dispose settles both active and queued worker operations", async ({ page }) => {
  await page.addInitScript(() => {
    window.workerInstances = [];
    window.Worker = class {
      onmessage = null;
      onerror = null;
      onmessageerror = null;
      messages = [];
      terminated = false;
      constructor() { window.workerInstances.push(this); }
      postMessage(data, transfer) { this.messages.push(structuredClone(data, { transfer })); }
      terminate() { this.terminated = true; }
    };
    URL.createObjectURL = () => "blob:scene-codec-dispose-queue-test";
    URL.revokeObjectURL = () => {};
  });
  await loadModule(page);
  const result = await page.evaluate(async ({ module, base64 }) => {
    const { SceneParser } = await import(module);
    const makeBuffer = () => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
    const parser = new SceneParser();
    const activeBuffer = makeBuffer();
    const queuedBuffer = makeBuffer();
    const active = parser.parse(activeBuffer).then(() => "none", (error) => error.code || error.name);
    const queued = parser.parse(queuedBuffer).then(() => "none", (error) => error.code || error.name);
    parser.dispose();
    parser.dispose();
    return {
      active: await active,
      queued: await queued,
      queuedAttached: queuedBuffer.byteLength > 0,
      activeWorkerTerminated: window.workerInstances[0].terminated,
      workerMessages: window.workerInstances[0].messages.length,
    };
  }, { module: `/${parserModule}`, base64: toBase64(sceneBuffer()) });
  expect(result).toEqual({
    active: "scene-parser-disposed",
    queued: "scene-parser-disposed",
    queuedAttached: true,
    activeWorkerTerminated: true,
    workerMessages: 1,
  });
});


test("@safety EffectController serializes requested history/live scenes and drops the replaced generation", async ({ page }) => {
  await page.addInitScript(() => {
    window.workerInstances = [];
    window.sceneCalls = [];
    window.Worker = class {
      onmessage = null;
      onerror = null;
      onmessageerror = null;
      messages = [];
      terminated = false;
      constructor() { window.workerInstances.push(this); }
      postMessage(data, transfer) { this.messages.push({ data: structuredClone(data, { transfer }) }); }
      terminate() { this.terminated = true; }
    };
    URL.createObjectURL = () => "blob:scene-effects-overlap-test";
    URL.revokeObjectURL = () => {};
  });
  await loadModule(page, { effects: true });
  const oldScene = sceneBuffer({ pointCount: 8, origin: [6, 6] });
  const oldLiveScene = sceneBuffer({ pointCount: 8, origin: [7, 7] });
  const nextHistoryScene = sceneBuffer({ pointCount: 8, origin: [9, 9] });
  const nextLiveScene = sceneBuffer({ pointCount: 8, origin: [8, 8] });
  await page.evaluate(async ({ module }) => {
    const { EffectController, WorkspaceStore, MaticBackend, syntheticEntry } = await import(module);
    const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
    const firstEntry = { ...syntheticEntry(), sceneUrl: "/api/matic_robot/slam_scene/old" };
    const nextEntry = {
      ...firstEntry,
      sceneUrl: "/api/matic_robot/slam_scene/new",
      mapRevision: 8,
      selectedFloorOrdinal: 2,
      mapFloorOrdinal: 2,
      mapSessionKey: "f".repeat(64),
    };
    const wireEntry = (entry) => ({
      entry_id: entry.entryId,
      scene_url: entry.sceneUrl,
      history_url: entry.historyUrl,
      areas_url: entry.areasUrl,
      plans_url: entry.plansUrl,
      map_revision: entry.mapRevision,
      map_floor_coherent: entry.mapFloorCoherent,
      map_session_verified: entry.mapSessionVerified,
      map_session_key: entry.mapSessionKey,
      map_block_reason: entry.mapBlockReason,
      runner_locked: entry.runnerLocked,
      stop_settle_pending: entry.stopSettlePending,
      active_plan: entry.activePlan,
      native_reconciliation_pending: entry.nativeReconciliationPending,
      native_session_active: entry.nativeSessionActive,
      map_complete: entry.mapComplete,
      map_truncated: entry.mapTruncated,
      selected_floor_ordinal: entry.selectedFloorOrdinal,
      map_floor_ordinal: entry.mapFloorOrdinal,
      history_count: entry.historyCount,
      history_floor_count: entry.historyFloorCount,
      map_health: entry.health,
      stream_failures: entry.streamFailures,
      bootstrap_state: entry.bootstrapState,
      bootstrap_photo_seen: entry.bootstrapPhotoSeen,
      bootstrap_structure_seen: entry.bootstrapStructureSeen,
      bootstrap_failures: entry.bootstrapFailures,
    });
    const historyPayload = {
      entry_id: firstEntry.entryId,
      live_available: true,
      floors: [{
        id: "current",
        active: true,
        read_only: false,
        live_available: true,
        label: "House",
        ordinal: null,
        snapshots: [{
          id: "startup-snapshot",
          created_at: "2026-08-29T16:12:00Z",
          revision: 6,
          point_count: 8,
          scene_url: "/api/matic_robot/slam_scene/history",
        }],
      }],
    };
    let catalogReads = 0;
    const backend = new MaticBackend(() => ({
      fetchWithAuth: async (path) => {
        if (path === "/api/matic_robot/slam_entries") {
          catalogReads += 1;
          return jsonResponse({ entries: [wireEntry(catalogReads === 1 ? firstEntry : nextEntry)] });
        }
        if (path === firstEntry.historyUrl) return jsonResponse(historyPayload);
        if (path === firstEntry.sceneUrl || path === "/api/matic_robot/slam_scene/history"
          || path === nextEntry.sceneUrl) {
          return new Promise((resolve) => window.sceneCalls.push({ path, resolve }));
        }
        return jsonResponse({ message: "synthetic unsupported endpoint" }, 404);
      },
    }));
    const store = new WorkspaceStore();
    const controller = new EffectController(store, backend);
    controller.sync({
      host: { connected: true, administrator: true, robotConnected: true, robotCount: 1 },
      activity: "idle",
      batteryPercent: 50,
      language: "en",
      userKey: "test-user",
      vacuumEntityId: "vacuum.synthetic",
      entryKey: firstEntry.entryId,
      robotLabel: "Matic",
      robots: [{ entryId: firstEntry.entryId, label: "Matic" }],
    });
    window.effectsHarness = { store, controller };
  }, { module: `/${parserModule}` });

  const releaseScene = async (path, base64, revision) => page.evaluate(({ path, base64, revision }) => {
    const pending = window.sceneCalls.find((call) => call.path === path && !call.released);
    if (!pending) throw new Error(`missing deferred scene request: ${path}`);
    pending.released = true;
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    pending.resolve(new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.matic.slam-scene",
        "X-Matic-Revision": String(revision),
        "X-Matic-Floor-Coherent": "1",
      },
    }));
  }, { path, base64, revision });
  const readCounts = () => page.evaluate(() => ({
    scenePaths: window.sceneCalls.map((call) => call.path),
    workerCount: window.workerInstances.length,
    workerMessages: window.workerInstances.map((worker) => worker.messages.length),
    workerInputs: window.workerInstances.map((worker) => worker.messages.map(({ data }) => {
      if (data.kind !== "parse" || !(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength < 24) return data.kind;
      const view = new DataView(data.buffer);
      const metadataBytes = view.getUint32(12, true);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(data.buffer, 24, metadataBytes))).origin_cells;
    })),
  }));

  await expect.poll(async () => (await readCounts()).scenePaths.filter((path) => path === "/api/matic_robot/slam_scene/old").length).toBe(1);
  // History is a user-requested resource, not a first-map startup read. Start
  // it while the live scene is still pending so this test still exercises the
  // request and parser ordering when both reads overlap.
  await page.evaluate(() => { void window.effectsHarness.controller.refreshHistory(); });
  await expect.poll(async () => (await readCounts()).scenePaths.filter((path) => path.includes("slam_scene/")).length).toBe(2);
  await releaseScene("/api/matic_robot/slam_scene/history", toBase64(oldScene), 6);
  await expect.poll(async () => (await readCounts()).workerMessages[0]).toBe(1);
  await releaseScene("/api/matic_robot/slam_scene/old", toBase64(oldLiveScene), 7);
  await page.waitForTimeout(0);
  expect(await readCounts()).toMatchObject({ workerMessages: [1] });

  await page.evaluate(async () => {
    await window.effectsHarness.controller.refreshCatalog(true);
  });
  await expect.poll(async () => (await readCounts()).scenePaths.includes("/api/matic_robot/slam_scene/new")).toBe(true);
  // The replacement generation also needs an explicit History read; the
  // first-map path intentionally leaves this catalog deferred.
  await page.evaluate(() => { void window.effectsHarness.controller.refreshHistory(); });
  await expect.poll(async () => (await readCounts()).scenePaths.filter((path) => path === "/api/matic_robot/slam_scene/history").length).toBe(2);
  const replacedGenerationWorkers = await readCounts();
  expect(replacedGenerationWorkers).toMatchObject({
    workerCount: 1,
    workerMessages: [1],
  });
  const oldHistoryWorkerIndex = replacedGenerationWorkers.workerInputs.findIndex((messages) =>
    messages.some((origin) => Array.isArray(origin) && origin[0] === 6 && origin[1] === 6));
  const oldLiveWorkerIndex = replacedGenerationWorkers.workerInputs.findIndex((messages) =>
    messages.some((origin) => Array.isArray(origin) && origin[0] === 7 && origin[1] === 7));
  expect(oldHistoryWorkerIndex).toBeGreaterThanOrEqual(0);
  // The parser has one active worker and one queued slot. Replacing the
  // generation can cancel queued live bytes before they need a Worker; only
  // Workers actually created for the retired generation must be terminated.
  expect(oldLiveWorkerIndex).toBe(-1);
  const oldGeneration = await page.evaluate((indices) => ({
    retiredWorkersTerminated: indices.every((index) => window.workerInstances[index].terminated),
    stateGeneration: window.effectsHarness.store.value.generation,
    oldLiveInputAdmitted: window.workerInstances.some((worker) => worker.messages.some(({ data }) => {
      if (data.kind !== "parse" || !(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength < 24) return false;
      const view = new DataView(data.buffer);
      const metadataBytes = view.getUint32(12, true);
      const origin = JSON.parse(new TextDecoder().decode(new Uint8Array(data.buffer, 24, metadataBytes))).origin_cells;
      return origin[0] === 7 && origin[1] === 7;
    })),
  }), [oldHistoryWorkerIndex]);
  expect(oldGeneration.retiredWorkersTerminated).toBe(true);
  expect(oldGeneration.oldLiveInputAdmitted).toBe(false);
  expect(oldGeneration.stateGeneration).toBe(2);

  const beforeRetiredMessages = await page.evaluate(() => {
    const state = window.effectsHarness.store.value;
    return {
      generation: state.generation,
      scene: {
        status: state.resources.scene.status,
        problem: state.resources.scene.problem,
        revision: state.resources.scene.value?.revision ?? null,
        source: state.resources.scene.value?.source ?? null,
      },
      history: {
        status: state.resources.history.status,
        problem: state.resources.history.problem,
        entryId: state.resources.history.value?.entryId ?? null,
        snapshotIds: state.resources.history.value?.floors.flatMap((floor) => floor.snapshots.map((snapshot) => snapshot.id)) ?? [],
      },
      workflow: state.workflow,
      selection: state.selection,
      command: state.command,
      notice: state.notice,
    };
  });
  expect(beforeRetiredMessages.generation).toBe(2);
  expect(beforeRetiredMessages.scene.revision).toBeNull();

  await page.evaluate((indices) => {
    for (const index of indices) {
      const retired = window.workerInstances[index];
      const { data } = retired.messages[0];
      const view = new DataView(data.buffer);
      retired.onmessage({ data: { id: data.id, ok: true, parsed: {
        buffer: data.buffer,
        pointOffset: 24 + view.getUint32(12, true),
        floorCount: view.getUint32(16, true),
        surfaceCount: view.getUint32(20, true),
        total: view.getUint32(16, true) + view.getUint32(20, true),
        metadata: { metersPerCell: 0.015, origin: [10, 10], span: [100, 80], sampleStep: 1, rooms: [] },
      } } });
      retired.onmessageerror(new Error("late retired worker message"));
      retired.onerror(new Error("late retired worker error"));
    }
  }, [oldHistoryWorkerIndex]);
  const afterRetiredMessages = await page.evaluate(() => {
    const state = window.effectsHarness.store.value;
    return {
      generation: state.generation,
      scene: {
        status: state.resources.scene.status,
        problem: state.resources.scene.problem,
        revision: state.resources.scene.value?.revision ?? null,
        source: state.resources.scene.value?.source ?? null,
      },
      history: {
        status: state.resources.history.status,
        problem: state.resources.history.problem,
        entryId: state.resources.history.value?.entryId ?? null,
        snapshotIds: state.resources.history.value?.floors.flatMap((floor) => floor.snapshots.map((snapshot) => snapshot.id)) ?? [],
      },
      workflow: state.workflow,
      selection: state.selection,
      command: state.command,
      notice: state.notice,
    };
  });
  expect(afterRetiredMessages).toEqual(beforeRetiredMessages);

  await releaseScene("/api/matic_robot/slam_scene/history", toBase64(nextHistoryScene), 6);
  await expect.poll(async () => (await readCounts()).workerCount).toBe(2);
  await expect.poll(async () => (await readCounts()).workerInputs.flat().some((origin) =>
    Array.isArray(origin) && origin[0] === 9 && origin[1] === 9)).toBe(true);
  const newHistoryWorkerIndex = (await readCounts()).workerInputs.findIndex((messages) =>
    messages.some((origin) => Array.isArray(origin) && origin[0] === 9 && origin[1] === 9));
  expect(newHistoryWorkerIndex).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => (await readCounts()).scenePaths.includes("/api/matic_robot/slam_scene/new")).toBe(true);

  const replyToParse = (workerIndex, messageIndex = 0) => page.evaluate(({ workerIndex, messageIndex }) => {
    const worker = window.workerInstances[workerIndex];
    const { data } = worker.messages[messageIndex];
    const view = new DataView(data.buffer);
    const floorCount = view.getUint32(16, true);
    const surfaceCount = view.getUint32(20, true);
    worker.onmessage({ data: { id: data.id, ok: true, parsed: {
      buffer: data.buffer,
      pointOffset: 24 + view.getUint32(12, true),
      floorCount,
      surfaceCount,
      total: floorCount + surfaceCount,
      metadata: { metersPerCell: 0.015, origin: [10, 10], span: [100, 80], sampleStep: 1, rooms: [] },
    } } });
  }, { workerIndex, messageIndex });
  await releaseScene("/api/matic_robot/slam_scene/new", toBase64(nextLiveScene), 8);
  await page.waitForTimeout(0);
  expect((await readCounts()).workerMessages[newHistoryWorkerIndex]).toBe(1);
  await replyToParse(newHistoryWorkerIndex);
  await expect.poll(async () => (await readCounts()).workerInputs[newHistoryWorkerIndex]).toEqual([[9, 9], [8, 8]]);
  await replyToParse(newHistoryWorkerIndex, 1);

  await expect.poll(() => page.evaluate(() => ({
    generation: window.effectsHarness.store.value.generation,
    history: window.effectsHarness.store.value.resources.history.status,
    scene: window.effectsHarness.store.value.resources.scene.status,
    sceneRevision: window.effectsHarness.store.value.resources.scene.value?.revision,
    sceneSource: window.effectsHarness.store.value.resources.scene.value?.source,
  }))).toEqual({ generation: 2, history: "ready", scene: "ready", sceneRevision: 8, sceneSource: "live" });
  const allWorkersTerminated = await page.evaluate(() => {
    window.effectsHarness.controller.dispose();
    return window.workerInstances.every((worker) => worker.terminated);
  });
  expect(allWorkersTerminated).toBe(true);
});
