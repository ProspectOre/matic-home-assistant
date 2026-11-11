import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { ROOM_PALETTE, roomNeighbours, roomSlots } from "./room-palette";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { ROOM_PALETTE, roomNeighbours, roomSlots } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`,
);

// Cells are 5 cm; a 3 m square room is 60 cells across.
const CELL = 0.05;
const square = (id, x, y, size = 60) => ({ id, name: id, center: [x + size / 2, y + size / 2],
  boundary: [[x, y], [x + size, y], [x + size, y + size], [x, y + size]] });

test("rooms that share a wall or sit within 30 cm are neighbours; rooms further apart are not", () => {
  const rooms = [square("a", 0, 0), square("b", 60, 0), square("c", 125, 0), square("d", 200, 0)];
  assert.deepEqual(roomNeighbours(rooms, CELL).map((set) => [...set].sort()), [[1], [0, 2], [1], []]);
});

test("in a three by three grid no room shares a colour with any room it touches, corners included", () => {
  const rooms = [];
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
    rooms.push(square(`room-${row}-${column}`, column * 60, row * 60));
  }
  const slots = roomSlots(rooms, CELL);
  const neighbours = roomNeighbours(rooms, CELL);
  assert.equal(neighbours[4].size, 8);
  neighbours.forEach((set, index) => {
    for (const other of set) assert.notEqual(slots.get(rooms[index].id), slots.get(rooms[other].id));
  });
  assert.ok(Math.max(...slots.values()) < ROOM_PALETTE.length);
});

test("colours follow the rooms, not the order the scene lists them in", () => {
  const rooms = [square("hall", 60, 0), square("kitchen", 0, 0), square("office", 120, 0)];
  const forward = roomSlots(rooms, CELL);
  const reversed = roomSlots([...rooms].reverse(), CELL);
  assert.deepEqual([...reversed].sort(), [...forward].sort());
  // Rooms that do not touch may share a colour; the hall touches both.
  assert.equal(forward.get("kitchen"), forward.get("office"));
  assert.notEqual(forward.get("hall"), forward.get("kitchen"));
});

// Machado, Oliveira and Fernandes (2009) at full severity, in linear RGB.
const VISION = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const linear = (value) => (value /= 255) <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const lab = ([r, g, b]) => {
  const f = (t) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
// As overlay-shapes.ts paints them over the light theme's room fill.
const ROOM_FILL = [231, 238, 242];
const seen = (colour, matrix) => {
  const rgb = colour.map((value, channel) => linear(Math.round(value * 0.8 + ROOM_FILL[channel] * 0.2)));
  return lab(matrix.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))));
};
const closest = (colours) => Math.min(...Object.values(VISION).flatMap((matrix) => colours.flatMap((a, i) =>
  colours.slice(i + 1).map((b) => Math.hypot(...seen(a, matrix).map((value, k) => value - seen(b, matrix)[k]))))));

test("the palette stays apart with normal vision and each simulated colour-vision deficiency", () => {
  assert.ok(closest(ROOM_PALETTE.slice(0, 5)) >= 25, `first five: ${closest(ROOM_PALETTE.slice(0, 5))}`);
  assert.ok(closest(ROOM_PALETTE) >= 12, `all nine: ${closest(ROOM_PALETTE)}`);
  // Every fill is light enough for the dark room outline.
  for (const colour of ROOM_PALETTE) assert.ok(seen(colour, VISION.normal)[0] >= 50, `${colour}`);
});
