import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { comparisonDecision, classifyStructuralGrid, decodeCoverageMask, enrichComparisonScene, framesRegistered, synchronizedCamera } from "./map-comparison"; export { parseSceneBuffer } from "./scene-parser";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { comparisonDecision, classifyStructuralGrid, decodeCoverageMask, enrichComparisonScene, framesRegistered, synchronizedCamera, parseSceneBuffer } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`,
);

const frame = (overrides = {}) => ({
  formatVersion: 1, coordinateVersion: 1, originCells: [0, 0], metersPerCell: 0.015,
  spanCells: [2, 1], coverage: { status: "verified", observedCells: 2,
    maskSha256: "a".repeat(64), diffEligible: true }, diffEligible: true, ...overrides,
});
const record = (id, overrides = {}) => ({ id, imported: false, comparisonGroup: "b".repeat(64), frame: frame(), ...overrides });

test("only same-group, same-frame records with verified coverage permit metric comparison", () => {
  assert.deepEqual(comparisonDecision(record("a"), record("b")), { eligible: true });
  assert.deepEqual(comparisonDecision(record("a"), record("b", { comparisonGroup: "c".repeat(64) })),
    { eligible: false, reason: "different-group" });
  assert.deepEqual(comparisonDecision(record("a"), record("b", { frame: null })),
    { eligible: false, reason: "frame-unverified" });
  assert.deepEqual(comparisonDecision(record("a"), record("b", {
    frame: frame({ coverage: { ...frame().coverage, observedCells: 0 } }),
  })), { eligible: false, reason: "coverage-unverified" });
  assert.deepEqual(comparisonDecision(record("a"), record("b", { imported: true })),
    { eligible: false, reason: "different-group" });
});

test("coverage decode validates compressed digest, bounded size and observed count", async () => {
  const mask = Buffer.from([0b00000101]);
  const compressed = deflateSync(mask);
  const coverage = {
    version: 1, status: "verified", encoding: "zlib-bitset-little-v1",
    originCells: [0, 0], metersPerCell: 0.015, spanCells: [3, 1], observedCells: 2,
    maskSha256: createHash("sha256").update(compressed).digest("hex"),
    maskZlibBase64: compressed.toString("base64"), diffEligible: true,
  };
  assert.deepEqual([...await decodeCoverageMask(coverage)], [0b00000101]);
  await assert.rejects(decodeCoverageMask({ ...coverage, maskSha256: "f".repeat(64) }), /coverage-digest/u);
  await assert.rejects(decodeCoverageMask({ ...coverage, observedCells: 1 }), /coverage-count/u);
  await assert.rejects(decodeCoverageMask({ ...coverage, spanCells: [4 * 1024 * 1024 + 1, 1] }), /coverage-bounds/u);
  await assert.rejects(decodeCoverageMask({ ...coverage, maskZlibBase64: "A".repeat(600_000) }), /invalid-coverage-mask/u);
  const oversizedOutput = deflateSync(Buffer.alloc(16, 0xff));
  await assert.rejects(decodeCoverageMask({ ...coverage,
    maskSha256: createHash("sha256").update(oversizedOutput).digest("hex"),
    maskZlibBase64: oversizedOutput.toString("base64"),
  }), /coverage-size/u);
});

const scene = ({ origin, span, floor, coverage }) => {
  const buffer = new ArrayBuffer(floor.length * 8);
  const view = new DataView(buffer);
  floor.forEach(([x, y], index) => {
    view.setUint16(index * 8, x, true);
    view.setUint16(index * 8 + 2, y, true);
  });
  return { buffer, pointOffset: 0, floorCount: floor.length, surfaceCount: 0,
    total: floor.length, revision: 1, etag: null, source: "history",
    metadata: { metersPerCell: 0.015, origin, span, sampleStep: 1, rooms: [], coverage } };
};
const bitmap = (...indexes) => {
  const bytes = new Uint8Array(1);
  for (const index of indexes) bytes[index >>> 3] |= 1 << (index & 7);
  return bytes;
};

test("shifted origins normalize into a shared grid; unsupported cells remain Unknown", () => {
  const aCoverage = { version: 1, status: "verified", encoding: "zlib-bitset-little-v1",
    originCells: [0, 0], metersPerCell: 0.015, spanCells: [3, 1], observedCells: 3,
    maskSha256: "a".repeat(64), maskZlibBase64: "", diffEligible: true };
  const bCoverage = { ...aCoverage, originCells: [1, 0], spanCells: [3, 1] };
  const a = scene({ origin: [0, 0], span: [3, 1], floor: [[0, 0], [1, 0]], coverage: aCoverage });
  const b = scene({ origin: [1, 0], span: [3, 1], floor: [[0, 0], [1, 0]], coverage: bCoverage });
  const result = classifyStructuralGrid(a, b, bitmap(0, 1, 2), bitmap(0, 1, 2));
  assert.deepEqual({ minX: result.minX, minY: result.minY, width: result.width, height: result.height,
    changed: result.changed, unchanged: result.unchanged, unknown: result.unknown },
  { minX: 0, minY: 0, width: 4, height: 1, changed: 1, unchanged: 1, unknown: 2 });
  assert.deepEqual([...result.cells], [0, 1, 2, 0]);
});

test("only a registered comparison frame synchronizes camera center and zoom", () => {
  const source = { origin: [0, 0], span: [10, 8], metersPerCell: 0.015 };
  const target = { origin: [4, -1], span: [6, 12], metersPerCell: 0.015 };
  const camera = { yaw: 0.4, pitch: 0.8, distance: 10, targetX: 0.1, targetZ: -0.2, orthographic: false };
  const aligned = synchronizedCamera(camera, source, target, 2, true, 20);
  assert.ok(aligned);
  assert.deepEqual({ yaw: aligned.yaw, pitch: aligned.pitch, orthographic: aligned.orthographic, distance: aligned.distance },
    { yaw: camera.yaw, pitch: camera.pitch, orthographic: false, distance: 10 });
  assert.notEqual(aligned.targetX, camera.targetX);
  assert.notEqual(aligned.targetZ, camera.targetZ);
  assert.equal(synchronizedCamera(camera, source, target, 2, false, 20), null);
  assert.equal(synchronizedCamera(camera, source, { ...target, metersPerCell: 0.02 }, 2, true, 20), null);
});

const compressedCoverage = deflateSync(Buffer.from([1]));
const wireCoverage = { version: 1, status: "verified", encoding: "zlib-bitset-little-v1",
  origin_cells: [4, 8], meters_per_cell: 0.015, span_cells: [1, 1], observed_cells: 1,
  mask_sha256: createHash("sha256").update(compressedCoverage).digest("hex"),
  mask_zlib_base64: compressedCoverage.toString("base64"), diff_eligible: true };
const encodedScene = (extra = {}) => {
  const metadata = new TextEncoder().encode(JSON.stringify({ origin_cells: [4, 8], span_cells: [1, 1],
    meters_per_cell: 0.015, rooms: [], ...extra }));
  const buffer = new ArrayBuffer(24 + metadata.length + 8);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("MATIC3D\0"));
  const header = new DataView(buffer);
  header.setUint16(8, 1, true); header.setUint16(10, 8, true);
  header.setUint32(12, metadata.length, true); header.setUint32(16, 1, true); header.setUint32(20, 0, true);
  bytes.set(metadata, 24);
  return buffer;
};
const parsedScene = (extra = {}) => ({ ...parseSceneBuffer(encodedScene(extra)), revision: 1, etag: null, source: "history" });

test("only lazy comparison enrichment retains bounded coverage without copying or mutating spatial data", async () => {
  const parsed = parsedScene({ coverage: wireCoverage });
  assert.equal(parsed.metadata.coverage, undefined);
  const originalMetadata = structuredClone(parsed.metadata);
  const originalBytes = new Uint8Array(parsed.buffer).slice();
  // Full scene copies are not needed to read the bounded metadata header.
  parsed.buffer.slice = () => { throw new Error("unexpected full buffer copy"); };
  const enriched = enrichComparisonScene(parsed);
  assert.notEqual(enriched, parsed);
  assert.notEqual(enriched.metadata, parsed.metadata);
  assert.equal(enriched.buffer, parsed.buffer);
  assert.equal(enriched.pointOffset, parsed.pointOffset);
  assert.equal(enriched.metadata.rooms, parsed.metadata.rooms);
  assert.deepEqual(parsed.metadata, originalMetadata);
  assert.deepEqual(new Uint8Array(parsed.buffer), originalBytes);
  assert.deepEqual(enriched.metadata.coverage, {
    version: 1, status: "verified", encoding: "zlib-bitset-little-v1", originCells: [4, 8],
    metersPerCell: 0.015, spanCells: [1, 1], observedCells: 1,
    maskSha256: wireCoverage.mask_sha256, maskZlibBase64: wireCoverage.mask_zlib_base64, diffEligible: true,
  });
  assert.deepEqual([...await decodeCoverageMask(enriched.metadata.coverage)], [1]);
});

test("comparison coverage enrichment rejects unsupported, mismatched or excessive claims", () => {
  for (const coverage of [undefined, null, [], {},
    { ...wireCoverage, version: 2 }, { ...wireCoverage, status: "unknown" },
    { ...wireCoverage, encoding: "unknown" }, { ...wireCoverage, diff_eligible: false },
    { ...wireCoverage, origin_cells: [100, 8] }, { ...wireCoverage, origin_cells: [4] },
    { ...wireCoverage, span_cells: [2, 1] }, { ...wireCoverage, span_cells: [1] },
    { ...wireCoverage, meters_per_cell: 0.02 }, { ...wireCoverage, observed_cells: 0 },
    { ...wireCoverage, observed_cells: 2 }, { ...wireCoverage, observed_cells: 0.5 },
    { ...wireCoverage, mask_sha256: "A".repeat(64) }, { ...wireCoverage, mask_sha256: "a" },
    { ...wireCoverage, mask_zlib_base64: "not-base64!" }, { ...wireCoverage, mask_zlib_base64: "" },
    { ...wireCoverage, mask_zlib_base64: "A".repeat(524292) },
  ]) {
    const parsed = parsedScene({ coverage });
    assert.equal(parsed.metadata.coverage, undefined);
    assert.equal(enrichComparisonScene(parsed).metadata.coverage, undefined, JSON.stringify(coverage)?.slice(0, 200));
  }
  const fractionalSpan = [1.5, 1];
  const fractionalBytes = encodedScene({ span_cells: fractionalSpan,
    coverage: { ...wireCoverage, span_cells: fractionalSpan } });
  assert.throws(() => parseSceneBuffer(fractionalBytes), { code: "invalid-scene" });
  const valid = parsedScene();
  assert.equal(enrichComparisonScene({ ...valid, buffer: fractionalBytes,
    pointOffset: 24 + new DataView(fractionalBytes).getUint32(12, true),
    metadata: { ...valid.metadata, span: fractionalSpan } }).metadata.coverage, undefined);
  const excessiveSpan = [65536, 65];
  const excessive = parsedScene({ span_cells: excessiveSpan, coverage: { ...wireCoverage, span_cells: excessiveSpan } });
  assert.equal(enrichComparisonScene(excessive).metadata.coverage, undefined);
  const fractionalOrigin = [4.5, 8];
  assert.equal(enrichComparisonScene(parsedScene({ origin_cells: fractionalOrigin,
    coverage: { ...wireCoverage, origin_cells: fractionalOrigin } })).metadata.coverage, undefined);
  const mismatch = parsedScene({ coverage: wireCoverage });
  assert.equal(enrichComparisonScene({ ...mismatch, metadata: { ...mismatch.metadata, metersPerCell: 0.02 } }).metadata.coverage, undefined);
});

test("comparison enrichment bounds header reads and drops previously attached coverage on malformed input", () => {
  const enriched = enrichComparisonScene(parsedScene({ coverage: wireCoverage }));
  assert.ok(enriched.metadata.coverage);
  assert.equal(enrichComparisonScene({ ...enriched, pointOffset: enriched.pointOffset + 1 }).metadata.coverage, undefined);
  for (const size of [0, 23, 16 * 1024 * 1024 + 1]) {
    assert.equal(enrichComparisonScene({ ...enriched, buffer: new ArrayBuffer(size) }).metadata.coverage, undefined);
  }
  const oversizedHeader = new ArrayBuffer(24 + 1024 * 1024 + 1 + 8);
  new DataView(oversizedHeader).setUint32(12, 1024 * 1024 + 1, true);
  assert.equal(enrichComparisonScene({ ...enriched, buffer: oversizedHeader, pointOffset: 24 + 1024 * 1024 + 1 }).metadata.coverage, undefined);
  const corrupt = parsedScene({ coverage: wireCoverage });
  new Uint8Array(corrupt.buffer)[24] = 0xff;
  assert.equal(enrichComparisonScene(corrupt).metadata.coverage, undefined);
  const outside = parsedScene({ coverage: wireCoverage });
  new DataView(outside.buffer).setUint32(12, outside.buffer.byteLength, true);
  assert.equal(enrichComparisonScene({ ...outside, pointOffset: 24 + outside.buffer.byteLength }).metadata.coverage, undefined);
});
