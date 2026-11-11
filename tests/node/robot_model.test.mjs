import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { LENGTH, robotMesh } from "./robot-model";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { LENGTH, robotMesh } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`,
);

const { vertices, indices } = robotMesh();
const count = vertices.length / 7;
const at = (index) => vertices.subarray(index * 7, index * 7 + 7);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test("the mesh is a few hundred triangles of known materials and unit normals", () => {
  assert.equal(indices.length % 3, 0);
  assert.ok(indices.length / 3 >= 300 && indices.length / 3 <= 800, `${indices.length / 3} triangles`);
  assert.ok(indices.every((index) => index < count));
  for (let index = 0; index < count; index += 1) {
    const vertex = at(index);
    assert.ok(Math.abs(Math.hypot(vertex[3], vertex[4], vertex[5]) - 1) < 1e-5, `normal of vertex ${index}`);
    assert.ok([0, 1, 2, 3, 4].includes(vertex[6]), `material of vertex ${index}`);
  }
});

test("every triangle winds the way its vertex normals face", () => {
  // A fan over a section that is not star-shaped, or a part built inside out
  // only on one side, turns some triangles against their normals.
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const [a, b, c] = [0, 1, 2].map((corner) => at(indices[triangle + corner]));
    const face = cross(sub(b, a), sub(c, a));
    for (const vertex of [a, b, c]) {
      assert.ok(dot(face, vertex.subarray(3, 6)) > 0, `triangle ${triangle / 3}`);
    }
  }
});

test("the robot spans its published size from the floor up, centred on its pose", () => {
  const solid = Array.from({ length: count }, (_, index) => at(index)).filter((vertex) => vertex[6] < 3);
  const extent = (axis) => [Math.min(...solid.map((vertex) => vertex[axis])), Math.max(...solid.map((vertex) => vertex[axis]))];
  const [[back, front], [right, left], [floor, top]] = [extent(0), extent(1), extent(2)];
  assert.ok(Math.abs(front - back - LENGTH) < 1e-6, `length ${front - back}`);
  assert.ok(Math.abs(LENGTH - 0.406) < 0.001);
  // The wheels stand 2 mm proud of the 238.76 mm body.
  assert.ok(Math.abs(left - 0.12138) < 1e-6 && Math.abs(right + 0.12138) < 1e-6, `width ${left - right}`);
  assert.ok(floor >= 0 && floor < 0.003 && Math.abs(top - 0.198) < 1e-6, `height ${floor} to ${top}`);
});
