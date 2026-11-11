import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { SurfaceGeometry, aabbIntersectsFrustum, frustumPlanes, writeTileWorldBounds } from "./surface-geometry";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { SurfaceGeometry, aabbIntersectsFrustum, frustumPlanes, writeTileWorldBounds } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`,
);

test("six extracted clip planes retain and reject axis-aligned boxes", () => {
  const planes = frustumPlanes(new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]));
  assert.equal(planes.length, 6);
  assert.equal(aabbIntersectsFrustum(planes, -1, 1, -1, 1, -1, 1), true);
  assert.equal(aabbIntersectsFrustum(planes, 1.1, 2, 0, 1, 0, 1), false);
  assert.equal(aabbIntersectsFrustum(planes, 0.9, 1.1, -0.1, 0.1, -0.1, 0.1), true);
});

test("invalid matrices disable culling instead of excluding geometry", () => {
  const invalid = frustumPlanes(new Float32Array(16));
  assert.equal(invalid, null);
  const nan = new Float32Array(16);
  nan[4] = Number.NaN;
  assert.equal(frustumPlanes(nan), null);
});

const mockGl = () => {
  let next = 0;
  const calls = [];
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, UNSIGNED_SHORT: 6, UNSIGNED_BYTE: 7, TRIANGLES: 8,
    createShader: () => ({ id: ++next }), shaderSource() {}, compileShader() {},
    getShaderParameter: () => true, deleteShader() {},
    createProgram: () => ({ id: ++next }), attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, deleteProgram() {},
    getUniformLocation: (_program, name) => ({ name }),
    useProgram() {}, uniformMatrix4fv() {}, uniform2f() {}, uniform1f() {},
    uniform3f() {}, uniform1i() {}, bindVertexArray() {}, bindBuffer() {},
    enableVertexAttribArray() {}, vertexAttribIPointer() {}, vertexAttribPointer() {},
    vertexAttribDivisor() {},
    drawArraysInstanced: (...args) => calls.push(args),
  };
  return { gl, calls };
};

const frameFor = (tileIndex) => ({
  scene: {
    buffer: new ArrayBuffer(24 + 4 * 8), pointOffset: 24,
    floorCount: 2, surfaceCount: 2, total: 4, revision: 1, etag: null,
    metadata: { metersPerCell: 1, origin: [0, 0], span: [256, 32], sampleStep: 1, rooms: [] },
    tileIndex, source: "live",
  },
  matrix: new Float32Array([
    0.05, 0, 0, 0,
    0, 0.2, 0, 0,
    0, 0, 0.05, 0,
    0, 0, 0, 1,
  ]),
  buffer: {}, vertexArray: {}, initializedPoints: 4, qualityScale: 1,
  maxVisiblePoints: 350_000,
  camera: { yaw: 0, pitch: Math.PI / 4, distance: 14, targetX: 0, targetZ: 0, orthographic: false },
  saturation: 1,
});

test("valid floor and surface runs cull outside tiles while retaining the visible layer", () => {
  const { gl, calls } = mockGl();
  const geometry = new SurfaceGeometry(gl);
  const frame = frameFor({
    runs: new Uint32Array([
      0, 2, 4, 0, 0, // floor points in the visible middle tile
      2, 4, 0, 0, 1, // surface points in an off-frustum tile
    ]),
    floorRuns: 1,
  });
  assert.equal(geometry.draw(frame), 2);
  assert.deepEqual(calls.map((call) => call[2]), [6]);
  assert.deepEqual(calls.map((call) => call[3]), [2]);
  geometry.dispose();
});

test("malformed tile runs fall back to uncullable floor and surface ranges", () => {
  const { gl, calls } = mockGl();
  const geometry = new SurfaceGeometry(gl);
  const frame = frameFor({
    runs: new Uint32Array([
      0, 1, 4, 0, 0, // gap before the next run makes the index invalid
      2, 4, 0, 0, 1,
    ]),
    floorRuns: 1,
  });
  assert.equal(geometry.draw(frame), 4);
  assert.deepEqual(calls.map((call) => call[2]), [6, 18]);
  assert.deepEqual(calls.map((call) => call[3]), [2, 2]);
  geometry.dispose();
});

test("a replacement scene is validated independently of a previous scene", () => {
  const { gl } = mockGl();
  const geometry = new SurfaceGeometry(gl);
  const valid = frameFor({
    runs: new Uint32Array([0, 2, 4, 0, 0, 2, 4, 0, 0, 1]),
    floorRuns: 1,
  });
  const invalid = frameFor({
    runs: new Uint32Array([0, 1, 4, 0, 0, 2, 4, 0, 0, 1]),
    floorRuns: 1,
  });
  assert.equal(geometry.draw(valid), 2);
  assert.equal(geometry.draw(invalid), 4);
  assert.equal(geometry.draw(valid), 2);
  geometry.dispose();
});

test("tile bounds include the final partial 32-cell tile through its edge", () => {
  // Span 33 gives tile 1 a single center at x=32 and exact edges [31.5, 32.5].
  const bounds = new Float64Array(6);
  writeTileWorldBounds(bounds, 1, 0, [33, 1], 0.015, 0, true);
  const expected = [-0.2475, -0.2325, -0.0075, 0.0075, -0.0075, 0.0075];
  bounds.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12));
});

test("reports reduced detail when the source or the visible budget omits cells", () => {
  const { gl } = mockGl();
  const geometry = new SurfaceGeometry(gl);
  const frame = frameFor(undefined);

  assert.equal(geometry.draw({ ...frame, maxVisiblePoints: 2 }), 2);
  assert.equal(geometry.detail, "limited");

  const sampledScene = { ...frame.scene, metadata: { ...frame.scene.metadata, sampleStep: 2 } };
  assert.equal(geometry.draw({ ...frame, scene: sampledScene, maxVisiblePoints: null }), 4);
  assert.equal(geometry.detail, "sampled");

  assert.equal(geometry.draw({ ...frame, maxVisiblePoints: null }), 4);
  assert.equal(geometry.detail, "complete");
  geometry.dispose();
});

test("Auto keeps small views complete and reduces a large view after slow frames", () => {
  const { gl } = mockGl();
  const geometry = new SurfaceGeometry(gl);
  const frame = frameFor(undefined);
  const scene = { ...frame.scene, floorCount: 600_000, surfaceCount: 0, total: 600_000 };
  const auto = { ...frame, scene, initializedPoints: scene.total, adaptiveQuality: true };

  assert.equal(geometry.draw({ ...auto, qualityScale: 1, maxVisiblePoints: null }), 600_000);
  assert.equal(geometry.detail, "complete");
  assert.equal(geometry.draw({ ...auto, qualityScale: 1, maxVisiblePoints: 350_000 }), 300_000);
  assert.equal(geometry.detail, "limited");
  assert.equal(geometry.draw({ ...auto, qualityScale: 0.5, maxVisiblePoints: null }), 300_000);
  assert.equal(geometry.detail, "limited");
  assert.equal(geometry.draw({ ...auto, qualityScale: 0.5, maxVisiblePoints: 350_000 }), 150_000);
  assert.equal(geometry.detail, "limited");

  assert.equal(geometry.draw({ ...frame, adaptiveQuality: true, qualityScale: 0.25, maxVisiblePoints: null }), 4);
  assert.equal(geometry.detail, "complete");
  geometry.dispose();
});
