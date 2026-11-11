import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: `
      export { inspectAt, inspectMarker, stillInspectable } from "./map-inspect";
      export { extendLiveTrail, parseRunTrail } from "./run-history-data";
      export { WorkspaceStore } from "./state";
      export { createGalleryState } from "../map-studio-v4-review/gallery-state";
    `,
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { inspectAt, inspectMarker, stillInspectable, extendLiveTrail, parseRunTrail, WorkspaceStore, createGalleryState } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

// The gallery's ready map: Kitchen spans 0.5 to 4 m by 0.5 to 3 m, and the
// robot stands at (4.475, 3.475), between rooms.
const ready = createGalleryState("ready");
const key = ready.resources.entry.mapSessionKey;
const scene = ready.resources.scene.value;
const zone = { kind: "no_go", outline: [[1, 1], [2, 1], [2, 2], [1, 2]], holes: [[[1.4, 1.4], [1.6, 1.4], [1.6, 1.6]]],
  roomIds: ["room-a"], areaIds: [] };
const trail = { id: "live", mapSessionKey: key, segments: [[[3, 1, 1_800_000_000], [3.2, 1, 1_800_000_002]], [[3.6, 1]]] };
const state = (patch = {}) => ({ ...ready, trail,
  resources: { ...ready.resources, areas: { ...ready.resources.areas, value: { ...ready.resources.areas.value, zones: [zone] } } },
  ...patch });
// 100 CSS pixels a metre, so a 22 px reach is 22 cm.
const toScreen = ({ x, y }) => ({ x: x * 100, y: y * 100 });
const at = (x, y, current = state()) => inspectAt(current, scene, { x, y }, toScreen);

test("a tap picks the robot, then the nearest trail point, then a zone, then a room", () => {
  assert.deepEqual(at(4.4, 3.4), { kind: "robot" });
  assert.deepEqual(at(3.15, 1.05), { kind: "trail", point: trail.segments[0][1] });
  assert.deepEqual(at(3.5, 1), { kind: "trail", point: trail.segments[1][0] });
  assert.deepEqual(at(1.2, 1.2), { kind: "zone", zone, at: { x: 1.2, y: 1.2 } });
  assert.deepEqual(at(1.55, 1.45), { kind: "room", roomId: "room-a", at: { x: 1.55, y: 1.45 } }, "a zone's hole is the room");
  assert.equal(at(4.2, 0.2), null, "no room, zone or trail");
});

test("the reach follows the map's scale", () => {
  assert.deepEqual(inspectAt(state(), scene, { x: 3.5, y: 1 }, ({ x, y }) => ({ x: x * 10, y: y * 10 })),
    { kind: "trail", point: trail.segments[1][0] });
  assert.deepEqual(inspectAt(state(), scene, { x: 3.4, y: 1.3 }, ({ x, y }) => ({ x: x * 400, y: y * 400 })),
    { kind: "room", roomId: "room-a", at: { x: 3.4, y: 1.3 } });
});

test("a tap the map can't scale hits only rooms and zones", () => {
  assert.deepEqual(inspectAt(state(), scene, { x: 4.475, y: 3.475 }, () => null), null);
  assert.deepEqual(inspectAt(state(), scene, { x: 1.2, y: 1.2 }, () => null), { kind: "zone", zone, at: { x: 1.2, y: 1.2 } });
});

test("in a tilted view the reach is measured on screen", () => {
  // Rows further up the map are drawn closer together, as in a tilted 3D view:
  // the trail point 0.6 m north of the tap is 12 px away on screen.
  const tilted = ({ x, y }) => ({ x: x * 100, y: y * 20 });
  assert.deepEqual(inspectAt(state(), scene, { x: 3.6, y: 0.4 }, tilted), { kind: "trail", point: trail.segments[1][0] });
});

test("an inspected trail point stays the same observation as the live trail drops its oldest", () => {
  const point = { kind: "trail", point: trail.segments[0][1] };
  const shifted = state({ trail: { ...trail, segments: [[trail.segments[0][1]], trail.segments[1]] } });
  assert.deepEqual(inspectMarker(shifted, point), { x: 3.2, y: 1 });
  const evicted = state({ trail: { ...trail, segments: [[], trail.segments[1]] } });
  assert.equal(stillInspectable(evicted, point), false);
  const reloaded = state({ trail: { ...trail, segments: trail.segments.map((points) => points.map((each) => [...each])) } });
  assert.equal(stillInspectable(reloaded, point), false, "a reloaded trail closes the card");
});

test("taps pick rooms instead in the rooms workflow, and saved maps and other floors inspect nothing", () => {
  assert.equal(at(2, 2, state({ workflow: "rooms" })), null);
  assert.equal(at(2, 2, state({ dataMode: "history" })), null);
  assert.equal(at(2, 2, state({ selection: { ...ready.selection, floorId: "other" } })), null);
  assert.deepEqual(at(2, 2, state({ workflow: "runs" })), { kind: "room", roomId: "room-a", at: { x: 2, y: 2 } });
});

test("a trail point is ringed while the trail still holds it", () => {
  const point = { kind: "trail", point: trail.segments[0][1] };
  assert.deepEqual(inspectMarker(state(), point), { x: 3.2, y: 1 });
  assert.equal(inspectMarker(state(), { kind: "robot" }), null);
  assert.equal(stillInspectable(state(), point), true);
  const restarted = state({ trail: { ...trail, segments: [[]] } });
  assert.equal(stillInspectable(restarted, point), false);
  assert.equal(inspectMarker(restarted, point), null);
  assert.equal(stillInspectable(state(), { kind: "zone", zone: { ...zone } }), false, "a replaced zone list closes the card");
  assert.equal(stillInspectable(state(), { kind: "room", roomId: "gone" }), false);
  assert.equal(stillInspectable(state({ workflow: "rooms" }), { kind: "robot" }), false);
});

test("trail points carry the robot's time when the server sends one", () => {
  const payload = (point) => ({ trail: "t1", map_session_key: key, segments: [[point]] });
  assert.deepEqual(parseRunTrail(payload([1, 2, 1_800_000_000])).segments, [[[1, 2, 1_800_000_000]]]);
  assert.deepEqual(parseRunTrail(payload([1, 2])).segments, [[[1, 2]]]);
  for (const bad of [[1, 2, 0], [1, 2, "1"], [1, 2, 5e9], [1, 2, 3, 4], [1]]) {
    assert.throws(() => parseRunTrail(payload(bad)), /invalid-trail/u, JSON.stringify(bad));
  }
});

test("the live trail keeps each pose's robot time in whole seconds", () => {
  globalThis.window ??= globalThis;
  const store = new WorkspaceStore();
  store.replace({ ...store.value, activity: "cleaning", trail: { id: "live", mapSessionKey: "session-a", segments: [[]] } });
  const pose = (x, observedAt) => ({ position: [x, 0], mapSessionKey: "session-a", observedAt });
  extendLiveTrail(store, pose(0, 1_800_000_000.6));
  extendLiveTrail(store, pose(1, null));
  assert.deepEqual(store.value.trail.segments, [[[0, 0, 1_800_000_001], [1, 0]]]);
});
