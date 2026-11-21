import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { HassAdapter } from "./hass-adapter";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)), loader: "ts",
  }, bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { HassAdapter } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const vacuum = (entryId, friendlyName) => ({ state: "docked",
  attributes: { matic_entry_id: entryId, ...(friendlyName === undefined ? {} : { friendly_name: friendlyName }) } });
const labels = (hass) => new HassAdapter().project(hass, undefined).robots.map((robot) => robot.label);

test("robots that share a name are told apart by area, then device name, then entity id", () => {
  const states = { "vacuum.matic": vacuum("a", "Matic"), "vacuum.matic_2": vacuum("b", "matic"), "vacuum.other": vacuum("c", "Other") };
  const entities = { "vacuum.matic": { device_id: "d1" }, "vacuum.matic_2": { device_id: "d2", area_id: "down" } };
  const areas = { up: { name: "Upstairs" }, down: { name: "Downstairs" } };
  // The entity's own area overrides its device's.
  assert.deepEqual(labels({ states, entities, areas,
    devices: { d1: { name: "Matic", area_id: "up" }, d2: { name: "Matic", area_id: "up" } } }),
  ["Downstairs · matic", "Upstairs · Matic", "Other"]);
  // One area for both: the name the user gave the device, else its own name.
  assert.deepEqual(labels({ states, entities: { "vacuum.matic": { device_id: "d1" }, "vacuum.matic_2": { device_id: "d2" } },
    areas, devices: { d1: { name: "Matic", name_by_user: "Front", area_id: "up" }, d2: { name: "Matic Pro", area_id: "up" } } }),
  ["Front · Matic", "Matic Pro · matic", "Other"]);
  // Nothing in the registries tells them apart.
  assert.deepEqual(labels({ states }), ["vacuum.matic · Matic", "vacuum.matic_2 · matic", "Other"]);
});

test("a robot without a usable friendly name takes its entity's object id", () => {
  const hass = { states: { "vacuum.kitchen_robot": vacuum("a"), "vacuum.hall": vacuum("b", " \u0007 ") } };
  assert.deepEqual(labels(hass), ["hall", "kitchen robot"]);
  assert.equal(new HassAdapter().project(hass, undefined, "a").robotLabel, "kitchen robot");
});
