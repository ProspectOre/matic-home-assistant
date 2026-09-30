import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { deflateSync } from "node:zlib";

const parserModule = "scene-delta-decoder.js";

async function loadModule(page, { fallback = false, backend = false } = {}) {
  if (fallback) await page.addInitScript(() => { window.Worker = undefined; });
  const contents = backend
    ? 'export { MaticBackend } from "./frontend/map-studio-v4/backend"; export { SceneParser } from "./frontend/map-studio-v4/scene-parser";'
    : 'export { SceneParser } from "./frontend/map-studio-v4/scene-parser";';
  const bundle = await build({
    stdin: { contents, resolveDir: process.cwd() },
    bundle: true,
    format: "esm",
    minify: true,
    write: false,
  });
  await page.route(`**/${parserModule}`, (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
}

function sceneBuffer({ pointCount = 8, floorCount = pointCount, surfaceCount = 0, origin = [10, 10] } = {}) {
  const metadata = Buffer.from(JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: origin,
    sample_step: 1,
    rooms: [],
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

function deltaBuffer(base, target, baseRevision = 10, revision = 11, overrides = {}) {
  const decodedLength = Math.max(base.byteLength, target.byteLength);
  const difference = Buffer.alloc(decodedLength);
  for (let index = 0; index < decodedLength; index += 1) {
    difference[index] = (base[index] ?? 0) ^ (target[index] ?? 0);
  }
  const compressed = deflateSync(difference);
  const payload = Buffer.alloc(36 + compressed.byteLength);
  payload.write(overrides.magic ?? "MATICDLT", 0, "binary");
  payload.writeUInt16LE(overrides.version ?? 1, 8);
  payload.writeUInt16LE(overrides.flags ?? 1, 10);
  payload.writeBigUInt64LE(BigInt(overrides.baseRevision ?? baseRevision), 12);
  payload.writeBigUInt64LE(BigInt(overrides.revision ?? revision), 20);
  payload.writeUInt32LE(overrides.sceneLength ?? target.byteLength, 28);
  payload.writeUInt32LE(overrides.compressedLength ?? compressed.byteLength, 32);
  compressed.copy(payload, 36);
  return payload;
}

const toBase64 = (buffer) => buffer.toString("base64");

test("@safety minified worker and unavailable-worker fallback decode identical dirty blocks without detaching the base", async ({ page }) => {
  const baseBytes = sceneBuffer({ pointCount: 20_000 });
  const targetBytes = Buffer.from(baseBytes);
  const pointOffset = 24 + JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: [10, 10],
    sample_step: 1,
    rooms: [],
  }).length;
  targetBytes[pointOffset + 2] ^= 0xff;
  targetBytes[pointOffset + 9] ^= 0x17;
  targetBytes[pointOffset + 65_536] ^= 0x81;
  targetBytes[pointOffset + 65_539] ^= 0x25;
  const delta = deltaBuffer(baseBytes, targetBytes);

  const run = async (targetPage, fallback) => {
    await loadModule(targetPage, { fallback });
    return targetPage.evaluate(async ({ module, base64, target64, delta64 }) => {
      const { SceneParser } = await import(module);
      const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
      const sameBytes = (left, right) => {
        const a = new Uint8Array(left);
        const b = new Uint8Array(right);
        return a.length === b.length && a.every((value, index) => value === b[index]);
      };
      const parser = new SceneParser();
      const input = fromBase64(base64);
      const parsedBase = await parser.parse(input);
      const base = { ...parsedBase, revision: 10, etag: "base", source: "live" };
      const baseLength = base.buffer.byteLength;
      const payload = fromBase64(delta64);
      const decoded = await parser.decodeDelta(payload, base);
      const result = {
        revision: decoded.revision,
        bytesMatch: sameBytes(decoded.parsed.buffer, fromBase64(target64)),
        dirtyHint: decoded.deltaHint,
        basePreserved: base.buffer.byteLength === baseLength && sameBytes(base.buffer, fromBase64(base64)),
        payloadLengthAfter: payload.byteLength,
        pointOffset: decoded.parsed.pointOffset,
        total: decoded.parsed.total,
      };
      parser.dispose();
      return result;
    }, {
      module: `/${parserModule}`,
      base64: toBase64(baseBytes),
      target64: toBase64(targetBytes),
      delta64: toBase64(delta),
    });
  };

  const workerResult = await run(page, false);
  const fallbackPage = await page.context().newPage();
  const fallbackResult = await run(fallbackPage, true);
  await fallbackPage.close();

  for (const result of [workerResult, fallbackResult]) {
    expect(result.revision).toBe(11);
    expect(result.bytesMatch).toBe(true);
    expect(result.basePreserved).toBe(true);
    expect(result.pointOffset).toBe(pointOffset);
    expect(result.total).toBe(20_000);
    expect(result.dirtyHint).toEqual({ baseRevision: 10, blockBytes: 65_536, dirtyBlocks: [0, 1] });
  }
  expect(workerResult.payloadLengthAfter).toBe(0);
  expect(fallbackResult.payloadLengthAfter).toBeGreaterThan(0);
});

test("@safety metadata-only and unchanged deltas report empty point hints while layout changes omit hints", async ({ page }) => {
  await page.addInitScript(() => { window.Worker = undefined; });
  await loadModule(page);
  const base = sceneBuffer({ pointCount: 4 });
  const metadataChanged = sceneBuffer({ pointCount: 4, origin: [11, 10] });
  const unchanged = Buffer.from(base);
  const changedCount = sceneBuffer({ pointCount: 5 });
  const changedPointOffset = sceneBuffer({ pointCount: 4, origin: [100, 10] });
  const changedFloorSurfaceLayout = sceneBuffer({ pointCount: 4, floorCount: 3, surfaceCount: 1 });
  const results = await page.evaluate(async ({ module, base64, targets, deltas }) => {
    const { SceneParser } = await import(module);
    const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
    const parser = new SceneParser();
    const parsed = await parser.parse(fromBase64(base64));
    const baseScene = { ...parsed, revision: 10, etag: null, source: "live" };
    const output = [];
    for (let index = 0; index < targets.length; index += 1) {
      const result = await parser.decodeDelta(fromBase64(deltas[index]), baseScene);
      const actual = new Uint8Array(result.parsed.buffer);
      const expected = new Uint8Array(fromBase64(targets[index]));
      output.push({
        targetMatches: actual.length === expected.length
          && actual.every((value, byteIndex) => value === expected[byteIndex]),
        hint: result.deltaHint ?? null,
      });
    }
    parser.dispose();
    return output;
  }, {
    module: `/${parserModule}`,
    base64: toBase64(base),
    targets: [metadataChanged, unchanged, changedCount, changedPointOffset, changedFloorSurfaceLayout].map(toBase64),
    deltas: [
      deltaBuffer(base, metadataChanged, 10, 11),
      deltaBuffer(base, unchanged, 10, 12),
      deltaBuffer(base, changedCount, 10, 13),
      deltaBuffer(base, changedPointOffset, 10, 14),
      deltaBuffer(base, changedFloorSurfaceLayout, 10, 15),
    ].map(toBase64),
  });
  expect(results).toEqual([
    { targetMatches: true, hint: { baseRevision: 10, blockBytes: 65_536, dirtyBlocks: [] } },
    { targetMatches: true, hint: { baseRevision: 10, blockBytes: 65_536, dirtyBlocks: [] } },
    { targetMatches: true, hint: null },
    { targetMatches: true, hint: null },
    { targetMatches: true, hint: null },
  ]);
});

test("@safety delta decoder rejects malformed envelopes and bounded inflate overflow", async ({ page }) => {
  await page.addInitScript(() => { window.Worker = undefined; });
  await loadModule(page);
  const base = sceneBuffer({ pointCount: 4 });
  const valid = deltaBuffer(base, Buffer.from(base));
  const badMagic = deltaBuffer(base, Buffer.from(base), 10, 11, { magic: "NOTADLT!" });
  const badBase = deltaBuffer(base, Buffer.from(base), 9, 11);
  const overflowDecoded = deflateSync(Buffer.alloc(base.byteLength + 1));
  const inflateBomb = Buffer.alloc(36 + overflowDecoded.byteLength);
  inflateBomb.write("MATICDLT", 0, "binary");
  inflateBomb.writeUInt16LE(1, 8);
  inflateBomb.writeUInt16LE(1, 10);
  inflateBomb.writeBigUInt64LE(10n, 12);
  inflateBomb.writeBigUInt64LE(11n, 20);
  inflateBomb.writeUInt32LE(base.byteLength, 28);
  inflateBomb.writeUInt32LE(overflowDecoded.byteLength, 32);
  overflowDecoded.copy(inflateBomb, 36);
  const truncated = Buffer.from(valid.subarray(0, valid.byteLength - 2));

  const errors = await page.evaluate(async ({ module, base64, payloads }) => {
    const { SceneParser } = await import(module);
    const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
    const parser = new SceneParser();
    const parsed = await parser.parse(fromBase64(base64));
    const baseScene = { ...parsed, revision: 10, etag: null, source: "live" };
    const output = [];
    for (const payload of payloads) {
      try {
        await parser.decodeDelta(fromBase64(payload), baseScene);
        output.push("none");
      } catch (error) {
        output.push(error.code || error.name);
      }
    }
    parser.dispose();
    return output;
  }, {
    module: `/${parserModule}`,
    base64: toBase64(base),
    payloads: [badMagic, badBase, inflateBomb, truncated].map(toBase64),
  });
  expect(errors).toEqual([
    "invalid-scene-delta",
    "invalid-scene-delta",
    "invalid-scene-delta",
    "invalid-scene-delta",
  ]);
});

test("@safety backend keeps delta response header checks and attaches the parser hint", async ({ page }) => {
  await loadModule(page, { backend: true });
  const baseBytes = sceneBuffer({ pointCount: 4 });
  const targetBytes = Buffer.from(baseBytes);
  const pointOffset = 24 + JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: [10, 10],
    sample_step: 1,
    rooms: [],
  }).length;
  targetBytes[pointOffset] ^= 0xff;
  const payload = deltaBuffer(baseBytes, targetBytes);
  const result = await page.evaluate(async ({ module, base64, target64, payload64 }) => {
    const { MaticBackend, SceneParser } = await import(module);
    const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
    let baseHeader = "10";
    let contentType = "application/vnd.matic.slam-delta";
    const backend = new MaticBackend(() => ({
      fetchWithAuth: async () => new Response(fromBase64(payload64), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "X-Matic-Revision": "11",
          "X-Matic-Base-Revision": baseHeader,
          "X-Matic-Floor-Coherent": "1",
        },
      }),
    }));
    const parser = new SceneParser();
    const parsed = await parser.parse(fromBase64(base64));
    const base = { ...parsed, revision: 10, etag: null, source: "live" };
    const baseBytesBefore = base.buffer.byteLength;
    const response = await backend.sceneDelta("/api/matic_robot/test/delta", base, true);
    let badHeader = "none";
    baseHeader = "9";
    try {
      await backend.sceneDelta("/api/matic_robot/test/delta", base, true);
    } catch (error) {
      badHeader = error.code || error.name;
    }
    let badType = "none";
    baseHeader = "10";
    contentType = "application/octet-stream";
    try {
      await backend.sceneDelta("/api/matic_robot/test/delta", base, true);
    } catch (error) {
      badType = error.code || error.name;
    }
    const answer = {
      revision: response.scene.revision,
      floorCoherent: response.floorCoherent,
      targetMatches: new Uint8Array(response.scene.buffer).every((value, index) =>
        value === new Uint8Array(fromBase64(target64))[index]),
      hint: response.scene.deltaHint,
      baseStillAttached: base.buffer.byteLength === baseBytesBefore,
      badHeader,
      badType,
    };
    backend.dispose();
    parser.dispose();
    return answer;
  }, {
    module: `/${parserModule}`,
    base64: toBase64(baseBytes),
    target64: toBase64(targetBytes),
    payload64: toBase64(payload),
  });
  expect(result).toEqual({
    revision: 11,
    floorCoherent: true,
    targetMatches: true,
    hint: { baseRevision: 10, blockBytes: 65_536, dirtyBlocks: [0] },
    baseStillAttached: true,
    badHeader: "invalid-scene-delta-base",
    badType: "invalid-scene-delta-content-type",
  });
});

test("@safety maximum scene delta stays within 256 point blocks and malformed target size is rejected", async ({ page }) => {
  const base = sceneBuffer({ pointCount: 1_500_000 });
  const changed = Buffer.from(base);
  const metadataLength = 24 + JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: [10, 10],
    sample_step: 1,
    rooms: [],
  }).length;
  changed[metadataLength + 12_000_000 - 1] ^= 0x11;
  const validDelta = deltaBuffer(base, changed);
  const overLimit = deltaBuffer(base, changed, 10, 11, { sceneLength: 16 * 1024 * 1024 + 1 });
  await loadModule(page);
  const result = await page.evaluate(async ({ module, base64, target64, valid64, overLimit64 }) => {
    const { SceneParser } = await import(module);
    const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
    const parser = new SceneParser();
    const parsed = await parser.parse(fromBase64(base64));
    const baseScene = { ...parsed, revision: 10, etag: null, source: "live" };
    const decoded = await parser.decodeDelta(fromBase64(valid64), baseScene);
    const actual = new Uint8Array(decoded.parsed.buffer);
    const expected = new Uint8Array(fromBase64(target64));
    let overLimitError = "none";
    try {
      await parser.decodeDelta(fromBase64(overLimit64), baseScene);
    } catch (error) {
      overLimitError = error.code || error.name;
    }
    const answer = {
      total: decoded.parsed.total,
      matches: actual.length === expected.length && actual.every((value, index) => value === expected[index]),
      hint: decoded.deltaHint,
      overLimitError,
      baseStillAttached: baseScene.buffer.byteLength > 0,
    };
    parser.dispose();
    return answer;
  }, {
    module: `/${parserModule}`,
    base64: toBase64(base),
    target64: toBase64(changed),
    valid64: toBase64(validDelta),
    overLimit64: toBase64(overLimit),
  });
  expect(result.total).toBe(1_500_000);
  expect(result.matches).toBe(true);
  expect(result.hint.dirtyBlocks).toHaveLength(1);
  expect(result.hint.dirtyBlocks[0]).toBeLessThanOrEqual(255);
  expect(result.overLimitError).toBe("invalid-scene-delta");
  expect(result.baseStillAttached).toBe(true);
});

test("@safety abort terminates active worker and recreates it for the next request", async ({ page }) => {
  await page.addInitScript(() => {
    window.workerInstances = [];
    window.Worker = class {
      onmessage = null;
      onerror = null;
      onmessageerror = null;
      terminated = false;
      constructor() { window.workerInstances.push(this); }
      postMessage() {}
      terminate() { this.terminated = true; }
    };
    URL.createObjectURL = () => "blob:scene-delta-abort-test";
    URL.revokeObjectURL = () => {};
  });
  await loadModule(page);
  const result = await page.evaluate(async ({ module, base64 }) => {
    const { SceneParser } = await import(module);
    const parser = new SceneParser();
    const makeBuffer = () => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
    const outcomes = [];
    let staleErrorLeftReplacementAlive = false;
    let concurrentError = "none";
    for (let index = 0; index < 2; index += 1) {
      const controller = new AbortController();
      const pending = parser.parse(makeBuffer(), controller.signal).catch((error) => error.name);
      if (index === 0) {
        try {
          await parser.parse(makeBuffer());
        } catch (error) {
          concurrentError = error.code || error.name;
        }
      }
      if (index === 1) {
        window.workerInstances[0].onerror(new Error("late retired-worker error"));
        staleErrorLeftReplacementAlive = !window.workerInstances[1].terminated;
      }
      controller.abort();
      outcomes.push(await pending);
    }
    const answer = {
      outcomes,
      concurrentError,
      workerCount: window.workerInstances.length,
      allTerminated: window.workerInstances.every((worker) => worker.terminated),
      staleErrorLeftReplacementAlive,
    };
    parser.dispose();
    parser.dispose();
    return answer;
  }, { module: `/${parserModule}`, base64: toBase64(sceneBuffer()) });
  expect(result).toEqual({
    outcomes: ["AbortError", "AbortError"],
    concurrentError: "scene-parser-busy",
    workerCount: 2,
    allTerminated: true,
    staleErrorLeftReplacementAlive: true,
  });
});

test("@safety dispose aborts a no-worker fallback operation and remains idempotent", async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = undefined;
    window.__sceneDeltaInflaterStarted = false;
    window.__sceneDeltaInflaterCancelCount = 0;
    const NativeDecompressionStream = window.DecompressionStream;
    window.DecompressionStream = class {
      constructor(format) {
        const native = new NativeDecompressionStream(format);
        const nativeReader = native.readable.getReader();
        let release;
        let cancelled = false;
        const held = new Promise((resolve) => { release = resolve; });
        this.writable = native.writable;
        this.readable = new ReadableStream({
          async pull(controller) {
            window.__sceneDeltaInflaterStarted = true;
            await held;
            if (cancelled) return;
            const { done, value } = await nativeReader.read();
            if (done) controller.close();
            else controller.enqueue(value);
          },
          async cancel(reason) {
            cancelled = true;
            window.__sceneDeltaInflaterCancelCount += 1;
            release();
            await nativeReader.cancel(reason).catch(() => {});
          },
        }, { highWaterMark: 0 });
      }
    };
  });
  await loadModule(page);
  const base = sceneBuffer({ pointCount: 4 });
  const payload = deltaBuffer(base, Buffer.from(base));
  const result = await page.evaluate(async ({ module, base64, payload64 }) => {
    const { SceneParser } = await import(module);
    const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
    const parser = new SceneParser();
    const parsed = await parser.parse(fromBase64(base64));
    const baseScene = { ...parsed, revision: 10, etag: null, source: "live" };
    const pending = parser.decodeDelta(fromBase64(payload64), baseScene)
      .then(() => "none", (error) => error.name);
    while (!window.__sceneDeltaInflaterStarted) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    }
    parser.dispose();
    parser.dispose();
    return {
      result: await pending,
      streamStarted: window.__sceneDeltaInflaterStarted,
      streamCancelCount: window.__sceneDeltaInflaterCancelCount,
      baseAttached: baseScene.buffer.byteLength > 0,
    };
  }, { module: `/${parserModule}`, base64: toBase64(base), payload64: toBase64(payload) });
  expect(result).toEqual({
    result: "AbortError",
    streamStarted: true,
    streamCancelCount: 1,
    baseAttached: true,
  });
});
