import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { resolveSceneRoom, resolveSceneRoomHits } from "./spatial-identity"; export { parsePreferences } from "./preferences"; export { sceneGeometryBounds } from "./renderer-math";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { resolveSceneRoom, resolveSceneRoomHits, parsePreferences, sceneGeometryBounds } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`,
);

const room = (id, name) => ({ id, name, boundary: [], center: [0, 0] });

test("spatial identity prefers a unique protocol key and otherwise requires a unique normalized name", () => {
  const catalog = [
    { roomId: "room_0123456789abcdef", name: "Kitchen renamed" },
    { roomId: "catalog-2", name: "  Living Room " },
  ];
  assert.deepEqual(resolveSceneRoom(room("room_0123456789abcdef", "Kitchen"), catalog),
    { status: "resolved", roomId: "room_0123456789abcdef" });
  assert.deepEqual(resolveSceneRoom(room("scene-room-1", "living room"), catalog),
    { status: "resolved", roomId: "catalog-2" });
  assert.deepEqual(resolveSceneRoom(room("scene-room-2", "missing"), catalog), { status: "unmatched" });
});

test("duplicate names and overlapping polygons return candidates instead of selecting the first", () => {
  const catalog = [
    { roomId: "catalog-a", name: "Office" },
    { roomId: "catalog-b", name: " office " },
  ];
  assert.deepEqual(resolveSceneRoom(room("scene-room-1", "Office"), catalog),
    { status: "ambiguous", roomIds: ["catalog-a", "catalog-b"] });
  assert.deepEqual(resolveSceneRoomHits(
    [room("scene-room-1", "Kitchen"), room("scene-room-2", "Living")],
    () => true,
    [{ roomId: "k", name: "Kitchen" }, { roomId: "l", name: "Living" }],
  ), { status: "ambiguous", roomIds: ["k", "l"] });
});

test("new preference records default to the restrained 3D launch while saved view choices survive", () => {
  assert.equal(parsePreferences(null).view, "three");
  assert.equal(parsePreferences({ version: 4, view: "top" }).view, "top");
});

test("scene fit bounds include disconnected surface samples and separate floor bounds", () => {
  const buffer = new ArrayBuffer(3 * 8);
  const points = new DataView(buffer);
  [[10, 20], [12, 22], [90, 80]].forEach(([x, y], index) => {
    points.setUint16(index * 8, x, true);
    points.setUint16(index * 8 + 2, y, true);
    points.setUint8(index * 8 + 4, index * 3);
  });
  const bounds = sceneGeometryBounds(buffer, 0, 2, 3, [100, 100]);
  assert.deepEqual(bounds.floor, { minX: 10, maxX: 12, minY: 20, maxY: 22, minHeight: 0, maxHeight: 3 });
  assert.deepEqual(bounds.all, { minX: 10, maxX: 90, minY: 20, maxY: 80, minHeight: 0, maxHeight: 6 });
  assert.deepEqual(sceneGeometryBounds(buffer, 24, 0, 0, [100, 50]), {
    floor: { minX: 0, maxX: 99, minY: 0, maxY: 49, minHeight: 0, maxHeight: 0 },
    all: { minX: 0, maxX: 99, minY: 0, maxY: 49, minHeight: 0, maxHeight: 0 },
  });
});
