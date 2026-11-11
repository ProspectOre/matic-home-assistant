import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { chevrons, overlayShapes } from "./overlay-shapes";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { chevrons, overlayShapes } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`,
);

const PALETTE = { accent: [6, 120, 206], onAccent: [255, 255, 255], text: [38, 50, 56], quiet: [75, 92, 105],
  plate: [250, 252, 253], roomFill: [231, 238, 242], forced: false };
const square = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
const room = (id, name, x) => ({ id, roomId: id, name, center: [x + 2, 2], boundary: square(x, 0, 4) });
// A 10 m square map of 0.1 m cells whose corner cell sits at (1 m, 2 m).
const scene = (rooms = [room("room-b", "Kitchen", 0), room("room-a", "Office", 6)]) => ({
  metadata: { metersPerCell: 0.1, origin: [10, 20], span: [101, 101], rooms },
});
const state = (patch = {}) => ({
  labelsVisible: false, view: "top", appearance: "photo", workflow: "home", dataMode: "live",
  floor: { readOnly: false }, selection: { floorId: "current", roomIds: [] }, planDraft: { rooms: [] },
  floorTypes: null, wifiSignal: null, trail: null,
  resources: { entry: { mapSessionKey: "session" }, plans: { value: null },
    areas: { value: { rooms: [{ roomId: "room-a", name: "Office" }, { roomId: "room-b", name: "Kitchen" }], zones: [] } } },
  ...patch,
});
const close = (actual, expected) => assert.deepEqual([...actual].map((value) => Math.round(value * 1e4) / 1e4), expected);

test("no room is drawn with names off and nothing selected", () => {
  assert.deepEqual(overlayShapes(scene(), state(), PALETTE), []);
});

test("rooms sit on the floor plane mirrored in x, in metres from the scene centre", () => {
  const [fill, outline] = overlayShapes(scene([room("room-a", "Office", 0)]), state({ labelsVisible: true }), PALETTE);
  // Cell (0, 0) is 5 m from the centre of a 101-cell span on both axes.
  close(fill.rings[0], [5, -5, 4.6, -5, 4.6, -4.6, 5, -4.6]);
  assert.equal(outline.rings, fill.rings);
  close([fill.height], [0.02]);
});

test("Room names on outlines every room quietly and fills the selected one with the accent", () => {
  const shapes = overlayShapes(scene(), state({ labelsVisible: true, workflow: "rooms",
    selection: { floorId: "current", roomIds: ["room-a"] } }), PALETTE);
  assert.deepEqual(shapes.map(({ kind, colour, alpha, width, closed }) => ({ kind, colour, alpha, width, closed })), [
    { kind: "fill", colour: PALETTE.plate, alpha: 0.04, width: undefined, closed: undefined },
    { kind: "stroke", colour: PALETTE.quiet, alpha: 0.7, width: 1.5, closed: true },
    { kind: "fill", colour: PALETTE.accent, alpha: 0.26, width: undefined, closed: undefined },
    { kind: "stroke", colour: PALETTE.accent, alpha: 1, width: 3, closed: true },
  ]);
});

test("with names off only the selected rooms are drawn, and Home selects none", () => {
  const selection = { floorId: "current", roomIds: ["room-a"] };
  const shapes = overlayShapes(scene(), state({ workflow: "rooms", selection }), PALETTE);
  assert.deepEqual(shapes.map(({ kind, colour }) => [kind, colour]), [["fill", PALETTE.accent], ["stroke", PALETTE.accent]]);
  assert.deepEqual(overlayShapes(scene(), state({ workflow: "home", selection }), PALETTE), []);
  const plan = overlayShapes(scene(), state({ workflow: "plan", planDraft: { rooms: [{ roomId: "room-b" }] } }), PALETTE);
  close(plan[0].rings[0].subarray(0, 2), [5, -5]);
});

test("Room colors gives each room a hue by its id, whatever order the scene lists them in", () => {
  const rooms = state({ appearance: "rooms" });
  const [kitchen, kitchenOutline, office] = overlayShapes(scene(), rooms, PALETTE);
  const reordered = overlayShapes(scene([room("room-a", "Office", 6), room("room-b", "Kitchen", 0)]), rooms, PALETTE);
  assert.deepEqual(reordered[0].colour, office.colour);
  assert.deepEqual(reordered[2].colour, kitchen.colour);
  assert.notDeepEqual(kitchen.colour, office.colour);
  assert.equal(kitchen.alpha, 0.94);
  assert.deepEqual([kitchenOutline.colour, kitchenOutline.alpha, kitchenOutline.width], [PALETTE.text, 1, 2]);
  // The 3D view keeps the photo, so the colours do not apply there.
  assert.deepEqual(overlayShapes(scene(), state({ appearance: "rooms", view: "three" }), PALETTE), []);
});

test("forced colours fill every room with the system canvas colour and outline it in text", () => {
  const forced = { ...PALETTE, forced: true };
  const coloured = overlayShapes(scene(), state({ appearance: "rooms" }), forced);
  assert.deepEqual(coloured.filter(({ kind }) => kind === "fill").map(({ colour }) => colour), [forced.roomFill, forced.roomFill]);
  const [, outline] = overlayShapes(scene(), state({ labelsVisible: true }), forced);
  assert.deepEqual([outline.colour, outline.alpha, outline.width], [forced.text, 1, 1.5]);
});

test("a boundary of more than 512 points is thinned to at most 512", () => {
  const boundary = Array.from({ length: 1_300 }, (_, index) => [index % 100, Math.floor(index / 100)]);
  const [fill] = overlayShapes(scene([{ ...room("room-a", "Office", 0), boundary }]), state({ labelsVisible: true }), PALETTE);
  assert.equal(fill.rings[0].length / 2, Math.ceil(1_300 / 3));
});

test("a no-go zone is shaded around its holes and outlined; another zone gets a dashed outline only", () => {
  const zones = [
    { kind: "no_go", outline: square(1, 2, 2), holes: [square(1.5, 2.5, 0.5)] },
    { kind: "unknown", outline: square(5, 5, 1), holes: [] },
  ];
  const resources = { ...state().resources, areas: { value: { rooms: [], zones } } };
  const shapes = overlayShapes(scene(), state({ resources }), PALETTE);
  assert.deepEqual(shapes.map(({ kind, alpha, dashed, width, height }) => ({ kind, alpha, dashed, width, height })), [
    { kind: "fill", alpha: 0.22, dashed: undefined, width: undefined, height: 0 },
    { kind: "stroke", alpha: 0.9, dashed: false, width: 1.5, height: 0 },
    { kind: "stroke", alpha: 0.6, dashed: true, width: 1.5, height: 0 },
  ]);
  assert.equal(shapes[0].rings.length, 2, "the hole is a ring of the same fill");
  // (1 m, 2 m) is the corner cell: 5 m from the centre.
  close(shapes[0].rings[0].subarray(0, 2), [5, -5]);
  assert.deepEqual(shapes.map(({ colour }) => colour), [PALETTE.text, PALETTE.text, PALETTE.text]);
  for (const patch of [{ dataMode: "history" }, { selection: { floorId: "floor-2", roomIds: [] } }]) {
    assert.deepEqual(overlayShapes(scene(), state({ resources, ...patch }), PALETTE), [], "zones belong to the robot's current map");
  }
});

test("floor types fill carpet and vents with their holes, on the live floor only", () => {
  const floorTypes = { status: "ready", carpet: [square(1, 2, 3), square(2, 3, 1)], vent: [square(6, 6, 0.3)] };
  const shapes = overlayShapes(scene(), state({ floorTypes }), PALETTE);
  assert.deepEqual(shapes.map(({ kind, alpha, width, rings }) => [kind, alpha, width, rings.length]), [
    ["fill", 0.35, undefined, 2], ["stroke", 0.8, 1.25, 2], ["fill", 0.35, undefined, 1], ["stroke", 0.8, 1.25, 1],
  ]);
  assert.deepEqual([shapes[0].colour, shapes[2].colour], [[166, 103, 48], [25, 145, 230]]);
  assert.deepEqual(overlayShapes(scene(), state({ floorTypes: { ...floorTypes, vent: [] } }), PALETTE).length, 2);
  assert.deepEqual(overlayShapes(scene(), state({ floorTypes: { status: "loading", carpet: [], vent: [] } }), PALETTE), []);
  assert.deepEqual(overlayShapes(scene(), state({ floorTypes, floor: { readOnly: true } }), PALETTE), [],
    "a held scene may belong to another floor");
});

test("Wi-Fi readings become one texture on the floor plane, with dead zones outlined", () => {
  const now = Date.now() / 1000;
  const cells = [{ x: 1.5, y: 2.5, dbm: -50, samples: 5, updatedAt: now }, { x: 2.5, y: 2.5, dbm: -95, samples: 5, updatedAt: now }];
  // Without rooms nothing is clipped.
  const [surface, outline] = overlayShapes(scene([]), state({ wifiSignal: { status: "ready", cells, rooms: [] } }), PALETTE);
  assert.equal(surface.kind, "surface");
  assert.equal(surface.values.length, surface.columns * surface.rows * 2);
  // 0.1 m texels span the readings plus the 1.5 m reach and a texel: map x -0.1 to 4.1 m and
  // y 0.9 to 4.1 m, mirrored in x like every shape.
  assert.deepEqual([surface.columns, surface.rows], [42, 32]);
  close(surface.corners, [6.1, -6.1, 1.9, -6.1, 6.1, -2.9]);
  assert.deepEqual({ kind: outline.kind, colour: outline.colour, closed: outline.closed, rings: outline.rings.length },
    { kind: "stroke", colour: PALETTE.text, closed: true, rings: 1 });
  assert.equal(overlayShapes(scene(), state({ wifiSignal: { status: "ready", cells: [], rooms: [] } }), PALETTE).length, 0);
});

test("the travel path breaks at gaps over a metre and keeps a lone observation as a dot", () => {
  const trail = { id: "live", mapSessionKey: "session", segments: [
    [[1, 2], [1.5, 2], [2, 2], [4, 2], [4.5, 2], [8, 2]],
    [],
    [[3, 3]],
  ] };
  const shapes = overlayShapes(scene(), state({ trail }), PALETTE);
  assert.deepEqual(shapes.map(({ kind, colour, width, closed, dashed }) => ({ kind, colour, width, closed, dashed })), [
    { kind: "stroke", colour: PALETTE.onAccent, width: 4, closed: false, dashed: false },
    { kind: "stroke", colour: PALETTE.accent, width: 2, closed: false, dashed: false },
  ]);
  assert.equal(shapes[0].rings, shapes[1].rings, "both strokes share one set of segments");
  // The first run is a metre long, so it carries one chevron after its three points.
  assert.deepEqual(shapes[0].rings.map((ring) => ring.length / 2), [3, 3, 2, 1, 1]);
  assert.deepEqual(overlayShapes(scene(), state({ trail: { ...trail, mapSessionKey: "other" } }), PALETTE), [],
    "a trail from another map session is not drawn");
  assert.deepEqual(overlayShapes(scene(), state({ trail: { ...trail, id: "run-1" } }), PALETTE), [],
    "a past run's trail waits for Cleaning history");
  assert.equal(overlayShapes(scene(), state({ trail: { ...trail, id: "run-1" }, workflow: "runs" }), PALETTE).length, 2);
});

test("trail chevrons sit every 1.2 m along the path and point the way it went", () => {
  const east = chevrons([[0, 0], [1, 0], [2.5, 0, 1_800_000_000]]);
  assert.deepEqual(east.map(([, tip]) => tip.map((value) => Math.round(value * 100) / 100)), [[0.6, 0], [1.8, 0]]);
  for (const [first, [tipX, tipY], second] of east) {
    // Both wings trail behind the tip, one either side of the path.
    assert.ok(first[0] < tipX && second[0] < tipX);
    assert.ok(Math.sign(first[1] - tipY) === -Math.sign(second[1] - tipY));
  }
  const [[wing, tip]] = chevrons([[3, 0], [0, 0]]);
  assert.ok(wing[0] > tip[0], "a path running west points west");
  assert.deepEqual(chevrons([[0, 0], [0.5, 0]]), [], "a path shorter than half the spacing has none");
  assert.deepEqual(chevrons([[0, 0], [0, 0]]), []);
});

test("shapes come in paint order: rooms, floor types, Wi-Fi, zones, travel path", () => {
  const resources = { ...state().resources,
    areas: { value: { rooms: [], zones: [{ kind: "no_go", outline: square(1, 2, 2), holes: [] }] } } };
  const shapes = overlayShapes(scene([room("room-a", "Office", 0)]), state({
    labelsVisible: true, resources,
    floorTypes: { status: "ready", carpet: [square(1, 2, 3)], vent: [] },
    wifiSignal: { status: "ready", cells: [{ x: 1, y: 2, dbm: -60, samples: 1, updatedAt: Date.now() / 1000 }], rooms: [] },
    trail: { id: "live", mapSessionKey: "session", segments: [[[1, 2], [1.5, 2]]] },
  }), PALETTE);
  assert.deepEqual(shapes.map(({ kind, height }) => [kind, Math.round(height * 1e3) / 1e3]), [
    ["fill", 0.02], ["stroke", 0.02], ["fill", 0.005], ["stroke", 0.005], ["surface", 0.01],
    ["fill", 0], ["stroke", 0], ["stroke", 0], ["stroke", 0],
  ]);
});
