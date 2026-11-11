import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { LayerRestore, parseLayerChoices, rememberLayer } from "./layer-choices"; export { parsePreferences } from "./preferences";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { LayerRestore, parseLayerChoices, rememberLayer, parsePreferences } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`,
);

const state = (patch = {}) => ({
  selection: { entryId: "robot-a" }, layerChoices: {}, trail: null, wifiSignal: null, floorTypes: null, ...patch,
});

test("a stored record keeps only well-formed choices, for at most sixteen robots", () => {
  const stored = Object.fromEntries(Array.from({ length: 18 }, (_, index) => [`robot-${index}`, { wifi: true }]));
  const parsed = parseLayerChoices({ ...stored, broken: "yes", ["x".repeat(129)]: { wifi: true } });
  assert.deepEqual(Object.keys(parsed), Object.keys(stored).slice(2));
  assert.deepEqual(parsed["robot-17"], { trail: false, wifi: true, floorTypes: false });
  assert.deepEqual(parseLayerChoices(null), {});
  assert.deepEqual(parseLayerChoices({ "robot-a": { trail: "yes", floorTypes: true } }),
    { "robot-a": { trail: false, wifi: false, floorTypes: true } });
});

test("map preferences saved before layer choices existed read as none saved", () => {
  assert.deepEqual(parsePreferences({ version: 4, view: "top" }).layers, {});
  assert.deepEqual(parsePreferences({ layers: { "robot-a": { trail: true } } }).layers,
    { "robot-a": { trail: true, wifi: false, floorTypes: false } });
});

test("turning a layer on or off records it for the open robot only", () => {
  const others = { "robot-b": { trail: true, wifi: false, floorTypes: false } };
  assert.deepEqual(rememberLayer(state({ layerChoices: others }), { type: "toggle-wifi-signal" }), {
    ...others, "robot-a": { trail: false, wifi: true, floorTypes: false },
  });
  assert.deepEqual(rememberLayer(state({ floorTypes: { status: "ready" } }), { type: "toggle-floor-types" }),
    { "robot-a": { trail: false, wifi: false, floorTypes: false } });
  assert.deepEqual(rememberLayer(state(), { type: "show-trail", trail: "live" }),
    { "robot-a": { trail: true, wifi: false, floorTypes: false } });
  assert.deepEqual(rememberLayer(state({ trail: { id: "live" } }), { type: "show-trail", trail: null }),
    { "robot-a": { trail: false, wifi: false, floorTypes: false } });
  assert.equal(rememberLayer(state({ selection: { entryId: null } }), { type: "toggle-wifi-signal" }), null);
  assert.equal(rememberLayer(state(), { type: "toggle-labels" }), null);
});

test("a past run's trail from Cleaning history leaves the live trail's choice alone", () => {
  const saved = { "robot-a": { trail: true, wifi: false, floorTypes: false } };
  assert.equal(rememberLayer(state({ layerChoices: saved }), { type: "show-trail", trail: "run-7" }), null);
  assert.equal(rememberLayer(state({ layerChoices: saved, trail: { id: "run-7" } }), { type: "show-trail", trail: null }), null);
});

test("the robot changed last is kept when a seventeenth robot is recorded", () => {
  const layerChoices = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`robot-${index}`, { trail: true, wifi: false, floorTypes: false }]));
  const next = rememberLayer(state({ layerChoices, selection: { entryId: "robot-new" } }), { type: "toggle-wifi-signal" });
  assert.deepEqual(Object.keys(next), [...Object.keys(layerChoices).slice(1), "robot-new"]);
});

test("switching back to a robot restores its layers even when the other robot's map never came in", () => {
  let listener;
  const routed = [];
  new LayerRestore({ subscribe: (next) => { listener = next; return () => {}; } }, (intent) => routed.push(intent.type));
  const robot = (entryId, ready) => state({
    owner: { userKey: "user" }, optionalUiReady: true, map: { available: ready }, dataMode: "live",
    selection: { entryId }, resources: { entry: { entryId, wifiHeatmapUrl: "/wifi" } },
    layerChoices: { "robot-a": { trail: false, wifi: true, floorTypes: false } },
  });
  listener(robot("robot-a", true));
  listener(robot("robot-b", false));
  listener(robot("robot-a", true));
  assert.deepEqual(routed, ["toggle-wifi-signal", "toggle-wifi-signal"]);
});
