import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: `export { wifiSurface, wifiReadingAt } from "./wifi-surface";
      export { wifiBand, wifiConfidence, wifiKernel, WIFI_REACH_METERS } from "./wifi-scale";
      export { parseWifiSignal } from "./wifi-signal";`,
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { wifiSurface, wifiReadingAt, wifiBand, wifiConfidence, wifiKernel, WIFI_REACH_METERS, parseWifiSignal } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`,
);

const NOW = 1_800_000_000;
const DAY = 86_400;
// 0.1 m cells from the map origin: room A is x 0 to 4 m, room B x 4 to 8 m, both y 0 to 4 m.
const square = (x, size) => [[x, 0], [x + size, 0], [x + size, size], [x, size]];
const metadata = (rooms = [{ id: "a", name: "A", boundary: square(0, 40) }, { id: "b", name: "B", boundary: square(40, 40) }]) =>
  ({ metersPerCell: 0.1, origin: [0, 0], rooms });
const cell = (x, y, dbm, samples = 5, age = 0) => ({ x, y, dbm, samples, updatedAt: NOW - age });
// The texel holding a map point: its mean dBm and its opacity.
const at = (surface, x, y) => {
  const index = (Math.floor((y - surface.y) / surface.texel) * surface.width + Math.floor((x - surface.x) / surface.texel)) * 2;
  const alpha = surface.values[index + 1];
  return { dbm: alpha ? surface.values[index] / alpha : null, alpha };
};

test("four bands on whole dBm, strongest first", () => {
  assert.deepEqual([-40, -55, -55.4, -55.6, -67, -68, -80, -80.6, -110].map((dbm) => wifiBand(dbm).band),
    ["strong", "strong", "strong", "good", "good", "weak", "weak", "dead", "dead"]);
});

test("a reading's weight eases to nothing at the reach, and fades with few or old readings", () => {
  assert.equal(wifiKernel(0), 1);
  assert.ok(wifiKernel(WIFI_REACH_METERS / 2) > 0.5 && wifiKernel(WIFI_REACH_METERS / 2) < 0.6);
  assert.equal(wifiKernel(WIFI_REACH_METERS), 0);
  assert.equal(wifiConfidence(cell(0, 0, -50, 5), NOW), 1);
  assert.equal(wifiConfidence(cell(0, 0, -50, 1), NOW), 0.4);
  assert.equal(wifiConfidence(cell(0, 0, -50, 5, 30 * DAY), NOW), 0.5);
  assert.equal(wifiConfidence(cell(0, 0, -50, 1, 365 * DAY), NOW), 0.1);
});

test("the surface is the weighted mean, clipped to the reading's own room", () => {
  const surface = wifiSurface([cell(3.5, 2, -50), cell(3, 2, -60)], metadata(), NOW);
  assert.equal(surface.texel, 0.1);
  // Halfway between the readings the mean is -55 dBm, at full opacity.
  const middle = at(surface, 3.25, 2);
  assert.equal(Math.round(middle.dbm * 100) / 100, -55);
  assert.equal(middle.alpha, 0.75);
  // Opacity fades towards the reach; room B, 0.55 m from a reading, stays clear.
  const fading = [3, 3.2, 3.4].map((y) => at(surface, 3.25, y).alpha);
  assert.ok(fading[0] > fading[1] && fading[1] > fading[2] && fading[2] > 0, `${fading}`);
  assert.equal(at(surface, 4.05, 2).alpha, 0);
  // Nothing is drawn beyond the reach, or outside every room.
  assert.equal(at(surface, 1.45, 2).alpha, 0);
  const edge = wifiSurface([cell(2, 0.3, -60)], metadata(), NOW);
  assert.ok(at(edge, 2, 0.05).alpha > 0);
  assert.equal(at(edge, 2, -0.05).alpha, 0);
});

test("a reading by a wall stays in its own room when its texel's centre is across the wall", () => {
  const cells = [cell(3.98, 2, -50)];
  const surface = wifiSurface(cells, metadata(), NOW);
  assert.ok(at(surface, 3.5, 2).alpha > 0);
  assert.equal(at(surface, 4.5, 2).alpha, 0);
  assert.equal(wifiReadingAt(cells, metadata(), { x: 4.5, y: 2 }, NOW), null);
});

test("few and old readings are drawn fainter than many fresh ones", () => {
  const alpha = (reading) => at(wifiSurface([reading], metadata(), NOW), reading.x, reading.y).alpha;
  const fresh = alpha(cell(2, 2, -60, 5));
  assert.ok(fresh >= 0.74, "a texel centre lies within 0.07 m of the reading");
  assert.ok(alpha(cell(2, 2, -60, 1)) < fresh * 0.45);
  assert.ok(alpha(cell(2, 2, -60, 5, 60 * DAY)) < fresh * 0.3);
});

test("a map without rooms is not clipped", () => {
  const surface = wifiSurface([cell(2, 2, -60)], metadata([]), NOW);
  assert.ok(at(surface, 2, 2).alpha >= 0.74);
  assert.ok(at(surface, 2, 1).alpha > 0);
  assert.equal(wifiSurface([], metadata(), NOW), null);
});

test("each dead zone is one closed outline around its readings", () => {
  const cells = [cell(1, 1, -85), cell(1.3, 1, -86), cell(3, 3, -90), cell(6, 2, -50)];
  const { deadZones } = wifiSurface(cells, metadata(), NOW);
  assert.equal(deadZones.length, 2);
  for (const ring of deadZones) {
    const xs = ring.map(([x]) => x);
    const ys = ring.map(([, y]) => y);
    // The outline follows the weight cut-off, under the reach, around one dead area.
    assert.ok(Math.max(...xs) - Math.min(...xs) < 2 * WIFI_REACH_METERS + 0.4);
    assert.ok(Math.max(...ys) - Math.min(...ys) < 2 * WIFI_REACH_METERS);
    // A straight run keeps only its ends.
    assert.ok(ring.length < 200);
  }
  const around = (x, y) => deadZones.some((ring) => {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const [ax, ay] = ring[index];
      const [bx, by] = ring[previous];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  });
  assert.ok(around(1.15, 1) && around(3, 3));
  assert.ok(!around(6, 2), "a strong reading has no outline");
});

test("a dead zone's outline runs where the estimate crosses into the dead band", () => {
  const cells = [cell(1, 2, -96), cell(2, 2, -66)];
  const between = wifiSurface(cells, metadata(), NOW).deadZones.flat().filter(([x, y]) => x > 1 && x < 2 && Math.abs(y - 2) < 0.1);
  assert.ok(between.length);
  for (const [x, y] of between) {
    const { dbm } = wifiReadingAt(cells, metadata(), { x, y }, NOW);
    assert.ok(Math.abs(dbm + 80.5) < 0.2, `${dbm} dBm at ${x}, ${y}`);
  }
});

test("a tapped spot reads the same estimate, with the readings it rests on", () => {
  const cells = [cell(1, 1, -60, 3, 2 * DAY), cell(1.5, 1, -70, 4, DAY), cell(4.5, 1, -40)];
  const reading = wifiReadingAt(cells, metadata(), { x: 1.25, y: 1 }, NOW);
  assert.equal(Math.round(reading.dbm * 10) / 10, -65.5);
  assert.equal(reading.samples, 7, "the reading across the wall in room B is left out");
  assert.equal(reading.updatedAt, NOW - DAY);
  assert.equal(wifiReadingAt(cells, metadata(), { x: 3.5, y: 3.5 }, NOW), null, "nothing within reach");
  assert.equal(wifiReadingAt(cells, metadata(), { x: 1, y: -1 }, NOW), null, "outside every room");
  assert.equal(wifiReadingAt(cells, metadata([]), { x: 0.6, y: -0.4 }, NOW).samples, 3, "without rooms nothing is clipped");
});

test("the survey reply keeps counts, ages and rooms, weakest room first", () => {
  const layer = parseWifiSignal({ enabled: true, cell_size: 0.3048, cells: [
    { x: 0.152, y: 0.152, dbm: -48, samples: 3, updated_at: 100, size: 0.3048 },
  ], rooms: [
    { name: "Kitchen", dbm: -50, weakest: -55, samples: 4 },
    { name: "Study", dbm: -71.5, weakest: -80, samples: 2 },
  ] });
  assert.deepEqual(layer, { status: "ready", surveying: true,
    cells: [{ x: 0.152, y: 0.152, dbm: -48, samples: 3, updatedAt: 100 }],
    rooms: [{ name: "Study", dbm: -71.5, weakest: -80, samples: 2 }, { name: "Kitchen", dbm: -50, weakest: -55, samples: 4 }] });
  assert.deepEqual(parseWifiSignal({ enabled: false, cells: [] }).rooms, []);
  for (const reply of [
    { enabled: true, cells: [{ x: 0, y: 0, dbm: -50, samples: 0, updated_at: 1 }] },
    { enabled: true, cells: [{ x: 0, y: 0, dbm: -50, samples: 1.5, updated_at: 1 }] },
    { enabled: true, cells: [{ x: 0, y: 0, dbm: -50, samples: 1 }] },
    { enabled: true, cells: [], rooms: [{ name: " ", dbm: -50, weakest: -50, samples: 1 }] },
    { enabled: true, cells: [], rooms: {} },
  ]) assert.throws(() => parseWifiSignal(reply), /invalid-wifi-signal/u);
});
