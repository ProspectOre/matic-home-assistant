import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { deflateSync } from "node:zlib";

const modulePath = "scene-tile-index.js";

async function loadParser(page, fallback = false) {
  if (fallback) await page.addInitScript(() => { window.Worker = undefined; });
  const bundle = await build({
    stdin: { contents: 'export { SceneParser } from "./frontend/map-studio-v4/scene-parser";', resolveDir: process.cwd() },
    bundle: true, format: "esm", write: false,
  });
  await page.route(`**/${modulePath}`, route => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
}

function scene(points, floorCount, surfaceCount, span = [128, 128]) {
  const metadata = Buffer.from(JSON.stringify({ meters_per_cell: 0.015, span_cells: span,
    origin_cells: [0, 0], sample_step: 1, rooms: [] }));
  const bytes = Buffer.alloc(24 + metadata.length + points.length * 8);
  bytes.write("MATIC3D\0", 0, "binary");
  bytes.writeUInt16LE(1, 8); bytes.writeUInt16LE(8, 10);
  bytes.writeUInt32LE(metadata.length, 12); bytes.writeUInt32LE(floorCount, 16);
  bytes.writeUInt32LE(surfaceCount, 20); metadata.copy(bytes, 24);
  const offset = 24 + metadata.length;
  points.forEach(([x, y, z, r = 100, g = 110, b = 120], index) => {
    bytes.writeUInt16LE(x, offset + index * 8);
    bytes.writeUInt16LE(y, offset + index * 8 + 2);
    bytes[offset + index * 8 + 4] = z;
    bytes[offset + index * 8 + 5] = r;
    bytes[offset + index * 8 + 6] = g;
    bytes[offset + index * 8 + 7] = b;
  });
  return bytes;
}

function delta(base, target, baseRevision = 10, revision = 11) {
  const length = Math.max(base.length, target.length), xor = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) xor[i] = (base[i] ?? 0) ^ (target[i] ?? 0);
  const compressed = deflateSync(xor), payload = Buffer.alloc(36 + compressed.length);
  payload.write("MATICDLT", 0, "binary"); payload.writeUInt16LE(1, 8); payload.writeUInt16LE(1, 10);
  payload.writeBigUInt64LE(BigInt(baseRevision), 12); payload.writeBigUInt64LE(BigInt(revision), 20);
  payload.writeUInt32LE(target.length, 28); payload.writeUInt32LE(compressed.length, 32);
  compressed.copy(payload, 36);
  return payload;
}

const b64 = value => value.toString("base64");

test("@safety worker and fallback build bounded tile runs for floor and surface ranges", async ({ page }) => {
  const input = scene([
    [1, 1, 0], [31, 30, 0], [32, 1, 0],
    [1, 1, 3, 10, 20, 30], [64, 33, 4, 40, 50, 60], [65, 34, 9, 70, 80, 90],
  ], 3, 3);
  const collect = async (target, fallback) => {
    await loadParser(target, fallback);
    return target.evaluate(async ({ path, encoded }) => {
      const { SceneParser } = await import(path);
      const parser = new SceneParser();
      try {
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)).buffer;
        const parsed = await parser.parse(bytes);
        return { total: parsed.total, tileIndex: parsed.tileIndex && {
          floorRuns: parsed.tileIndex.floorRuns, runs: Array.from(parsed.tileIndex.runs),
          ownsArrayBuffer: parsed.tileIndex.runs.buffer instanceof ArrayBuffer
        } };
      } finally { parser.dispose(); }
    }, { path: `/${modulePath}`, encoded: b64(input) });
  };
  const worker = await collect(page, false);
  const fallbackPage = await page.context().newPage();
  const fallback = await collect(fallbackPage, true);
  await fallbackPage.close();
  const expected = { total: 6, tileIndex: { floorRuns: 2, runs: [
    0, 2, 0, 0, 0, 2, 3, 1, 0, 0,
    3, 4, 0, 0, 3, 4, 6, 2, 1, 9,
  ], ownsArrayBuffer: true } };
  expect(worker).toEqual(expected);
  expect(fallback).toEqual(expected);
});

test("@safety fractional cell spans are rejected before they can cause incorrect tile culling", async ({ page }) => {
  const encoded = b64(scene([[1, 0, 0]], 1, 0, [1.1, 1]));
  for (const fallback of [false, true]) {
    const target = fallback ? await page.context().newPage() : page;
    await loadParser(target, fallback);
    const result = await target.evaluate(async ({ path, encoded }) => {
      const { SceneParser } = await import(path);
      const parser = new SceneParser();
      try {
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)).buffer;
        await parser.parse(bytes);
        return "accepted";
      } catch (error) {
        return error.code ?? error.message;
      } finally { parser.dispose(); }
    }, { path: `/${modulePath}`, encoded });
    expect(result, fallback ? "fallback parser" : "worker parser").toBe("invalid-scene");
    if (fallback) await target.close();
  }
});

test("@safety zero-length ranges, ungrouped points and the run cap never discard points", async ({ page }) => {
  await loadParser(page, true);
  const cases = [
    { name: "floor only", bytes: scene([[1, 1, 0], [33, 1, 0]], 2, 0), total: 2, floorRuns: 2 },
    { name: "surface only", bytes: scene([[1, 1, 2], [33, 1, 4]], 0, 2), total: 2, floorRuns: 0 },
    { name: "ungrouped", bytes: scene([[1, 1, 0], [33, 1, 0], [2, 2, 0]], 3, 0), total: 3, absent: true },
    { name: "outside span", bytes: scene([[32, 1, 0]], 1, 0, [32, 32]), total: 1, absent: true },
    { name: "run cap", bytes: scene(Array.from({ length: 8_193 }, (_, i) => [
      (i % 128) * 32, Math.floor(i / 128) * 32, i % 255,
    ]), 8_193, 0, [4_096, 2_080]), total: 8_193, absent: true },
  ];
  const result = await page.evaluate(async ({ path, samples }) => {
    const { SceneParser } = await import(path);
    const parser = new SceneParser();
    try {
      const results = [];
      for (const sample of samples) {
        const bytes = Uint8Array.from(atob(sample.encoded), char => char.charCodeAt(0)).buffer;
        const parsed = await parser.parse(bytes);
        results.push({ name: sample.name, total: parsed.total,
          floorRuns: parsed.tileIndex?.floorRuns ?? null,
          runCount: parsed.tileIndex ? parsed.tileIndex.runs.length / 5 : null });
      }
      return results;
    } finally { parser.dispose(); }
  }, { path: `/${modulePath}`, samples: cases.map(value => ({ name: value.name, encoded: b64(value.bytes) })) });
  expect(result.map(({ name, total }) => [name, total])).toEqual(cases.map(({ name, total }) => [name, total]));
  expect(result[0]).toMatchObject({ floorRuns: 2, runCount: 2 });
  expect(result[1]).toMatchObject({ floorRuns: 0, runCount: 2 });
  expect(result.slice(2).every(value => value.floorRuns === null && value.runCount === null)).toBe(true);
});

test("@safety maximum admitted point count still produces only a bounded tile index", async ({ page }) => {
  await loadParser(page);
  const result = await page.evaluate(async path => {
    const { SceneParser } = await import(path);
    const metadata = new TextEncoder().encode(JSON.stringify({ meters_per_cell: 0.015,
      span_cells: [32, 32], origin_cells: [0, 0], sample_step: 1, rooms: [] }));
    const total = 1_500_000;
    const pointOffset = 24 + metadata.byteLength;
    const buffer = new ArrayBuffer(pointOffset + total * 8);
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    bytes.set(new TextEncoder().encode("MATIC3D\0"), 0);
    view.setUint16(8, 1, true); view.setUint16(10, 8, true);
    view.setUint32(12, metadata.byteLength, true); view.setUint32(16, total, true);
    view.setUint32(20, 0, true); bytes.set(metadata, 24);
    for (let i = 0; i < total; i += 1) {
      const offset = pointOffset + i * 8;
      view.setUint16(offset, 31, true); view.setUint16(offset + 2, 31, true);
      view.setUint8(offset + 4, i % 256);
    }
    const parser = new SceneParser();
    try {
      const parsed = await parser.parse(buffer);
      return { total: parsed.total, runs: Array.from(parsed.tileIndex.runs),
        floorRuns: parsed.tileIndex.floorRuns, indexBytes: parsed.tileIndex.runs.byteLength,
        sceneBytes: parsed.buffer.byteLength };
    } finally { parser.dispose(); }
  }, `/${modulePath}`);
  expect(result).toEqual({ total: 1_500_000, runs: [0, 1_500_000, 0, 0, 255],
    floorRuns: 1, indexBytes: 20, sceneBytes: expect.any(Number) });
});

test("@safety delta relocation rebuilds worker and fallback tile runs from the changed coordinates", async ({ page }) => {
  const base = scene([[1, 1, 0], [2, 1, 0], [33, 1, 1]], 3, 0);
  const target = scene([[1, 1, 0], [65, 1, 7], [33, 1, 1]], 3, 0);
  const payload = delta(base, target);
  const decode = async (targetPage, fallback) => {
    await loadParser(targetPage, fallback);
    return targetPage.evaluate(async ({ path, base64, delta64 }) => {
      const { SceneParser } = await import(path);
      const parser = new SceneParser();
      try {
        const from64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0)).buffer;
        const parsed = await parser.parse(from64(base64));
        const decoded = await parser.decodeDelta(from64(delta64), {
          ...parsed, revision: 10, etag: "base", source: "live",
        });
        return { revision: decoded.revision, total: decoded.parsed.total,
          floorRuns: decoded.parsed.tileIndex?.floorRuns ?? null,
          runs: decoded.parsed.tileIndex ? Array.from(decoded.parsed.tileIndex.runs) : null };
      } finally { parser.dispose(); }
    }, { path: `/${modulePath}`, base64: b64(base), delta64: b64(payload) });
  };
  const worker = await decode(page, false);
  const fallbackPage = await page.context().newPage();
  const fallback = await decode(fallbackPage, true);
  await fallbackPage.close();
  const expected = { revision: 11, total: 3, floorRuns: 3, runs: [
    0, 1, 0, 0, 0, 1, 2, 2, 0, 7, 2, 3, 1, 0, 1,
  ] };
  expect(worker).toEqual(expected);
  expect(fallback).toEqual(expected);
});
