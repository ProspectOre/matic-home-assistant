import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { PERSPECTIVE_FIELD_OF_VIEW, perspectiveBoundsFitDistance } from "./renderer-math";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { PERSPECTIVE_FIELD_OF_VIEW, perspectiveBoundsFitDistance } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`,
);

const corners = (bounds) => [
  ...[bounds.minX, bounds.maxX].flatMap((x) => [bounds.minZ, bounds.maxZ].flatMap((z) =>
    [bounds.minHeight, bounds.maxHeight].map((height) => ({ x, z, height })))),
];

test("perspective geometry fit keeps every varied footprint and height inside five-percent padding", () => {
  const scenarios = [
    { aspect: 16 / 10, bounds: { minX: -6, maxX: 6, minZ: -1, maxZ: 1, minHeight: 0, maxHeight: 0 } },
    { aspect: 0.7, bounds: { minX: -1, maxX: 1, minZ: -10, maxZ: 10, minHeight: 0, maxHeight: 0 } },
    { aspect: 480 / 680, bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4, minHeight: 0, maxHeight: 1.2 } },
    { aspect: 1.4, bounds: { minX: -8, maxX: 3, minZ: -2, maxZ: 5, minHeight: -0.4, maxHeight: 3.5 } },
  ];
  const pitch = 1.12;
  const yaw = -Math.PI / 4;
  const focal = 1 / Math.tan(PERSPECTIVE_FIELD_OF_VIEW / 2);
  const safeEdge = 0.9;

  for (const { aspect, bounds } of scenarios) {
    const distance = perspectiveBoundsFitDistance(bounds, aspect, pitch, yaw, 0.05);
    const projected = corners(bounds).map(({ x, z, height }) => {
      const right = x * Math.cos(yaw) - z * Math.sin(yaw);
      const up = -x * Math.sin(yaw) * Math.sin(pitch)
        + height * Math.cos(pitch)
        - z * Math.cos(yaw) * Math.sin(pitch);
      const towardCamera = x * Math.sin(yaw) * Math.cos(pitch)
        + height * Math.sin(pitch)
        + z * Math.cos(yaw) * Math.cos(pitch);
      const depth = distance - towardCamera;
      return { x: Math.abs(focal * right / aspect / depth), y: Math.abs(focal * up / depth) };
    });
    assert.ok(projected.every(({ x, y }) => x <= safeEdge + 1e-9 && y <= safeEdge + 1e-9),
      `all corners fit for aspect ${aspect}: ${JSON.stringify(projected)}`);
    assert.ok(projected.some(({ x, y }) => Math.abs(Math.max(x, y) - safeEdge) < 1e-8),
      `distance is tight against the five-percent padding for aspect ${aspect}`);
  }
});

test("rectangular fitting is materially closer than the same floor's conservative sphere fit", () => {
  const bounds = { minX: -6, maxX: 6, minZ: -1, maxZ: 1, minHeight: 0, maxHeight: 0 };
  const fit = perspectiveBoundsFitDistance(bounds, 16 / 10, 1.12, -Math.PI / 4, 0.05);
  const radius = Math.hypot(12, 2) / 2;
  const halfVertical = PERSPECTIVE_FIELD_OF_VIEW / 2;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * 16 / 10);
  const sphereFit = radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.08 / Math.sin(1.12);
  assert.ok(fit < sphereFit * 0.8, `rectangle fit ${fit} should use less than 80% of sphere fit ${sphereFit}`);
});
