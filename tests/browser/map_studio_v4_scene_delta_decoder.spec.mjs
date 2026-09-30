import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { deflateSync } from "node:zlib";

const parserModule = "scene-delta-decoder.js";

async function loadModule(page, { fallback = false, backend = false, effects = false } = {}) {
  if (fallback) await page.addInitScript(() => { window.Worker = undefined; });
  const contents = effects
    ? `export { MaticBackend } from "./frontend/map-studio-v4/backend";
      export { EffectController } from "./frontend/map-studio-v4/effects";
      export { WorkspaceStore } from "./frontend/map-studio-v4/state";
      export { syntheticEntry } from "./frontend/map-studio-v4/synthetic-fixtures";`
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

test("@safety one pending slot serializes parse/parse and parse/delta pairs in either order", async ({ page }) => {
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
    URL.createObjectURL = () => "blob:scene-delta-order-test";
    URL.revokeObjectURL = () => {};
  });
  await loadModule(page);
  const base = sceneBuffer({ pointCount: 8 });
  const parseTarget = sceneBuffer({ pointCount: 8, origin: [11, 10] });
  const firstTarget = Buffer.from(base);
  firstTarget[firstTarget.byteLength - 2] ^= 0x41;
  const secondTarget = Buffer.from(base);
  secondTarget[secondTarget.byteLength - 1] ^= 0x23;
  const result = await page.evaluate(async ({ module, base64, parse64, firstDelta64, secondDelta64, firstTarget64, secondTarget64 }) => {
    const { SceneParser } = await import(module);
    const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
    const sameBytes = (left, right) => {
      const a = new Uint8Array(left);
      const b = new Uint8Array(right);
      return a.length === b.length && a.every((value, index) => value === b[index]);
    };
    const assertPostedJob = (index, kind, expectedBytes) => {
      const { data, transferCount } = worker.messages[index];
      if (data.kind !== kind) throw new Error(`expected ${kind} job, received ${data.kind}`);
      if (kind === "parse") {
        if (!sameBytes(data.buffer, fromBase64(parse64)) || transferCount !== 1) {
          throw new Error("parse job payload or transfer list did not match");
        }
        return;
      }
      if (!data.base || data.base.revision !== baseScene.revision
        || data.base.pointOffset !== baseScene.pointOffset
        || data.base.floorCount !== baseScene.floorCount
        || data.base.surfaceCount !== baseScene.surfaceCount
        || !sameBytes(data.base.buffer, fromBase64(base64))
        || !sameBytes(data.payload, fromBase64(expectedBytes))
        || transferCount !== 2) {
        throw new Error("delta job payload, base revision/layout, or transfer list did not match");
      }
    };
    const parser = new SceneParser();
    const worker = window.workerInstances[0];
    let baseCloneCount = 0;
    const nativeSlice = ArrayBuffer.prototype.slice;
    ArrayBuffer.prototype.slice = function (...args) {
      baseCloneCount += 1;
      return nativeSlice.apply(this, args);
    };
    const reply = (index, output) => {
      const { data } = worker.messages[index];
      worker.onmessage({ data: { id: data.id, ok: true, parsed: {
        buffer: output,
        pointOffset: 24 + new DataView(output).getUint32(12, true),
        floorCount: new DataView(output).getUint32(16, true),
        surfaceCount: new DataView(output).getUint32(20, true),
        total: new DataView(output).getUint32(16, true) + new DataView(output).getUint32(20, true),
        metadata: { metersPerCell: 0.015, origin: [10, 10], span: [100, 80], sampleStep: 1, rooms: [] },
      } } });
    };
    const baseJob = parser.parse(fromBase64(base64));
    reply(0, fromBase64(base64));
    const parsedBase = await baseJob;
    const baseScene = { ...parsedBase, revision: 10, etag: null, source: "live" };
    const runPair = async (first, second, firstBytes, secondBytes, deltaTarget, revision) => {
      const start = worker.messages.length;
      const clonesBefore = baseCloneCount;
      const firstPromise = first === "parse"
        ? parser.parse(fromBase64(parse64))
        : parser.decodeDelta(fromBase64(firstBytes), baseScene);
      const secondPromise = second === "parse"
        ? parser.parse(fromBase64(parse64))
        : parser.decodeDelta(fromBase64(secondBytes), baseScene);
      const firstIndex = start;
      if (worker.messages.length !== start + 1) throw new Error("first job did not dispatch alone");
      assertPostedJob(firstIndex, first, first === "delta" ? firstBytes : null);
      if (baseCloneCount !== clonesBefore + (first === "delta" ? 1 : 0)) {
        throw new Error("queued delta cloned the base before admission");
      }
      if (first === "parse") reply(firstIndex, fromBase64(parse64));
      else {
        const target = fromBase64(deltaTarget);
        worker.onmessage({ data: { id: worker.messages[firstIndex].data.id, ok: true, parsed: {
          buffer: target,
          pointOffset: 24 + new DataView(target).getUint32(12, true),
          floorCount: new DataView(target).getUint32(16, true),
          surfaceCount: new DataView(target).getUint32(20, true),
          total: new DataView(target).getUint32(16, true) + new DataView(target).getUint32(20, true),
          metadata: { metersPerCell: 0.015, origin: [10, 10], span: [100, 80], sampleStep: 1, rooms: [] },
        }, revision, deltaHint: { pointStart: 0, pointEnd: 0 } } });
      }
      await Promise.resolve();
      if (worker.messages.length !== start + 2) throw new Error("queued job was not promoted serially");
      assertPostedJob(start + 1, second, second === "delta" ? secondBytes : null);
      if (baseCloneCount !== clonesBefore + (first === "delta" || second === "delta" ? 1 : 0)) {
        throw new Error("delta base clone count did not track dispatch");
      }
      const secondIndex = worker.messages.length - 1;
      if (second === "parse") reply(secondIndex, fromBase64(parse64));
      else {
        const target = fromBase64(deltaTarget);
        worker.onmessage({ data: { id: worker.messages[secondIndex].data.id, ok: true, parsed: {
          buffer: target, pointOffset: 24 + new DataView(target).getUint32(12, true),
          floorCount: new DataView(target).getUint32(16, true), surfaceCount: new DataView(target).getUint32(20, true),
          total: new DataView(target).getUint32(16, true) + new DataView(target).getUint32(20, true),
          metadata: { metersPerCell: 0.015, origin: [10, 10], span: [100, 80], sampleStep: 1, rooms: [] },
        }, revision, deltaHint: { pointStart: 0, pointEnd: 0 } } });
      }
      return Promise.all([firstPromise, secondPromise]);
    };
    const [parsedA, parsedB] = await runPair("parse", "parse", null, null, null, 0);
    const [parsedFirst, deltaSecond] = await runPair("parse", "delta", null, firstDelta64, firstTarget64, 11);
    const [deltaFirst, parsedSecond] = await runPair("delta", "parse", secondDelta64, null, secondTarget64, 12);
    const answer = {
      parseParseCount: parsedA.total + parsedB.total,
      parseDeltaParseCount: parsedFirst.total + parsedSecond.total,
      parseThenDelta: deltaSecond.revision === 11 && sameBytes(deltaSecond.parsed.buffer, fromBase64(firstTarget64)),
      deltaThenParse: deltaFirst.revision === 12 && sameBytes(deltaFirst.parsed.buffer, fromBase64(secondTarget64)),
      transferredInputs: worker.messages.every(({ transferCount }) => transferCount > 0),
      baseAttached: baseScene.buffer.byteLength > 0,
    };
    parser.dispose();
    return answer;
  }, {
    module: `/${parserModule}`,
    base64: toBase64(base),
    parse64: toBase64(parseTarget),
    firstDelta64: toBase64(deltaBuffer(base, firstTarget, 10, 11)),
    secondDelta64: toBase64(deltaBuffer(base, secondTarget, 10, 12)),
    firstTarget64: toBase64(firstTarget),
    secondTarget64: toBase64(secondTarget),
  });
  expect(result).toEqual({
    parseParseCount: 16,
    parseDeltaParseCount: 16,
    parseThenDelta: true,
    deltaThenParse: true,
    transferredInputs: true,
    baseAttached: true,
  });
});

test("@safety queued parse and delta results match the unavailable-worker fallback", async ({ page }) => {
  await page.addInitScript(() => { window.Worker = undefined; });
  await loadModule(page);
  const base = sceneBuffer({ pointCount: 8 });
  const target = Buffer.from(base);
  target[target.byteLength - 1] ^= 0x37;
  const result = await page.evaluate(async ({ module, base64, delta64, target64 }) => {
    const { SceneParser } = await import(module);
    const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
    const parser = new SceneParser();
    const parsedBase = await parser.parse(decode(base64));
    const baseScene = { ...parsedBase, revision: 10, etag: null, source: "live" };
    const parseThenDelta = await Promise.all([
      parser.parse(decode(base64)), parser.decodeDelta(decode(delta64), baseScene),
    ]);
    const deltaThenParse = await Promise.all([
      parser.decodeDelta(decode(delta64), baseScene), parser.parse(decode(base64)),
    ]);
    const targetBytes = new Uint8Array(decode(target64));
    const matches = (scene) => {
      const actual = new Uint8Array(scene.buffer);
      return actual.length === targetBytes.length && actual.every((byte, index) => byte === targetBytes[index]);
    };
    parser.dispose();
    return {
      parseThenDelta: parseThenDelta[1].revision === 11 && matches(parseThenDelta[1].parsed),
      deltaThenParse: deltaThenParse[0].revision === 11 && matches(deltaThenParse[0].parsed),
      baseAttached: baseScene.buffer.byteLength > 0,
    };
  }, {
    module: `/${parserModule}`,
    base64: toBase64(base),
    delta64: toBase64(deltaBuffer(base, target, 10, 11)),
    target64: toBase64(target),
  });
  expect(result).toEqual({ parseThenDelta: true, deltaThenParse: true, baseAttached: true });
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
    URL.createObjectURL = () => "blob:scene-delta-abort-test";
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

test("@safety malformed jobs and worker failures both drain the bounded pending slot", async ({ page }) => {
  await page.addInitScript(() => {
    window.workerInstances = [];
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
    URL.createObjectURL = () => "blob:scene-delta-drain-test";
    URL.revokeObjectURL = () => {};
  });
  await loadModule(page);
  const base = sceneBuffer({ pointCount: 8 });
  const malformed = deltaBuffer(base, Buffer.from(base), 10, 11, { magic: "BADDELTA" });
  const result = await page.evaluate(async ({ module, base64, malformed64 }) => {
    const { SceneParser } = await import(module);
    const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
    const makeParsed = (buffer) => {
      const view = new DataView(buffer);
      const floorCount = view.getUint32(16, true);
      const surfaceCount = view.getUint32(20, true);
      return {
        buffer,
        pointOffset: 24 + view.getUint32(12, true),
        floorCount,
        surfaceCount,
        total: floorCount + surfaceCount,
        metadata: { metersPerCell: 0.015, origin: [10, 10], span: [100, 80], sampleStep: 1, rooms: [] },
      };
    };
    const parser = new SceneParser();
    const baseBuffer = fromBase64(base64);
    const baseScene = { ...makeParsed(baseBuffer), revision: 10, etag: null, source: "live" };
    const malformedActive = parser.decodeDelta(fromBase64(malformed64), baseScene)
      .then(() => "none", (error) => error.code || error.name);
    const afterMalformed = parser.parse(fromBase64(base64));
    const worker = window.workerInstances[0];
    const malformedMessage = worker.messages[0].data;
    worker.onmessage({ data: { id: malformedMessage.id, ok: false, problem: "invalid-scene-delta" } });
    const malformedResult = await malformedActive;
    const malformedDrainMessage = worker.messages[1].data;
    worker.onmessage({ data: { id: malformedDrainMessage.id, ok: true, parsed: makeParsed(malformedDrainMessage.buffer) } });
    const drainedTotal = (await afterMalformed).total;

    const failedActive = parser.parse(fromBase64(base64))
      .then(() => "none", (error) => error.code || error.name);
    const afterFailure = parser.parse(fromBase64(base64));
    worker.onerror(new Error("synthetic worker failure"));
    const workerFailure = await failedActive;
    const fallbackTotal = (await afterFailure).total;
    const answer = {
      malformedResult,
      drainedTotal,
      workerFailure,
      fallbackTotal,
      postedBeforeFailure: worker.messages.length,
      workerTerminated: worker.terminated,
    };
    parser.dispose();
    return answer;
  }, { module: `/${parserModule}`, base64: toBase64(base), malformed64: toBase64(malformed) });
  expect(result).toEqual({
    malformedResult: "invalid-scene-delta",
    drainedTotal: 8,
    workerFailure: "scene-worker-failed",
    fallbackTotal: 8,
    postedBeforeFailure: 3,
    workerTerminated: true,
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
    URL.createObjectURL = () => "blob:scene-delta-dispose-queue-test";
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

test("@safety EffectController startup serializes live/history scenes and drops the replaced generation", async ({ page }) => {
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
    const firstEntry = { ...syntheticEntry(), deltaUrl: null, sceneUrl: "/api/matic_robot/slam_scene/old" };
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
      delta_url: entry.deltaUrl,
      pose_url: entry.poseUrl,
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

  await expect.poll(async () => (await readCounts()).scenePaths.filter((path) => path.includes("slam_scene/")).length).toBe(2);
  await releaseScene("/api/matic_robot/slam_scene/history", toBase64(oldScene), 6);
  await expect.poll(async () => (await readCounts()).workerMessages[0]).toBe(1);
  await releaseScene("/api/matic_robot/slam_scene/old", toBase64(oldLiveScene), 7);
  await page.waitForTimeout(0);
  expect(await readCounts()).toMatchObject({ workerMessages: [1] });

  await page.evaluate(() => window.effectsHarness.controller.refreshCatalog(true));
  await expect.poll(async () => (await readCounts()).scenePaths.filter((path) => path === "/api/matic_robot/slam_scene/history").length).toBe(2);
  await expect.poll(async () => (await readCounts()).scenePaths.includes("/api/matic_robot/slam_scene/new")).toBe(true);
  const replacedGenerationWorkers = await readCounts();
  expect(replacedGenerationWorkers).toMatchObject({
    workerCount: 2,
    workerMessages: [1, 1],
  });
  const oldHistoryWorkerIndex = replacedGenerationWorkers.workerInputs.findIndex((messages) =>
    messages.some((origin) => Array.isArray(origin) && origin[0] === 6 && origin[1] === 6));
  const oldLiveWorkerIndex = replacedGenerationWorkers.workerInputs.findIndex((messages) =>
    messages.some((origin) => Array.isArray(origin) && origin[0] === 7 && origin[1] === 7));
  expect(oldHistoryWorkerIndex).toBeGreaterThanOrEqual(0);
  expect(oldLiveWorkerIndex).toBeGreaterThanOrEqual(0);
  expect(oldHistoryWorkerIndex).not.toBe(oldLiveWorkerIndex);
  const oldGeneration = await page.evaluate((indices) => ({
    retiredWorkersTerminated: [
      window.workerInstances[indices[0]],
      window.workerInstances[indices[1]],
    ].every((worker) => worker.terminated),
    stateGeneration: window.effectsHarness.store.value.generation,
  }), [oldHistoryWorkerIndex, oldLiveWorkerIndex]);
  expect(oldGeneration.retiredWorkersTerminated).toBe(true);
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
  }, [oldHistoryWorkerIndex, oldLiveWorkerIndex]);
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
  await expect.poll(async () => (await readCounts()).workerCount).toBe(3);
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
      .then(() => "none", (error) => error.message);
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
    result: "scene-parser-disposed",
    streamStarted: true,
    streamCancelCount: 1,
    baseAttached: true,
  });
});
