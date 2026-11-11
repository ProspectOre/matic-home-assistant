import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: { contents: 'export { statusCopy } from "./shell-presentation"; export { createGalleryState } from "../map-studio-v4-review/gallery-state";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { statusCopy, createGalleryState } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

test("comparison status is read-only and authorization/connectivity gates retain priority", () => {
  const ready = createGalleryState("ready");
  const comparing = { ...ready, comparisonActive: true };
  assert.equal(statusCopy(comparing).title, "Comparing saved maps");
  assert.match(statusCopy(comparing).detail, /Read-only comparison/);

  const locating = { ...comparing, comparisonActive: false, coherence: "verifying" };
  assert.equal(statusCopy(locating).title, "Locating");

  assert.equal(statusCopy({ ...comparing, host: { ...comparing.host, connected: false } }).title, "Reconnecting");
  assert.equal(statusCopy({ ...comparing, host: { ...comparing.host, administrator: false } }).title, "Access required");
  assert.equal(statusCopy({ ...comparing, host: { ...comparing.host, robotConnected: false } }).title, "Robot offline");
  assert.equal(statusCopy({ ...comparing, activity: "problem" }).title, "Needs attention");
  assert.equal(statusCopy({ ...comparing, command: "settling" }).title, "Stopping");
  assert.equal(statusCopy({ ...comparing, resources: { ...comparing.resources, entry: { ...comparing.resources.entry, stopSettlePending: true } } }).title, "Stopping");
  assert.equal(statusCopy({ ...comparing, smartStop: { phase: "returning_to_dock", kind: "room", target: null } }).title, "Smart Stop");
});


test("comparison keeps current robot work visible", () => {
  const ready = createGalleryState("ready");
  for (const dataMode of ["live", "history"]) {
    const comparing = { ...ready, dataMode, comparisonActive: true, coherence: "verifying" };
    for (const [activity, title] of [["starting", "Starting"], ["cleaning", "Cleaning"], ["paused", "Paused"],
      ["returning", "Returning"], ["recharging", "Charging to resume"]]) {
      const actual = statusCopy({ ...comparing, activity });
      assert.equal(actual.title, title, `${dataMode} ${activity}`);
      assert.equal(actual.notable, true, `${dataMode} ${activity}`);
    }
    for (const activity of ["idle", "docked", "unknown"]) {
      const active = { ...comparing, activity, resources: { ...comparing.resources, entry: {
        ...comparing.resources.entry, nativeSessionActive: true,
      } } };
      assert.equal(statusCopy(active).title, "Run in progress", `${dataMode} ${activity}`);
    }
    for (const activity of ["idle", "docked", "unknown"]) {
      assert.equal(statusCopy({ ...comparing, activity, command: "starting" }).title, "Starting");
    }
    assert.equal(statusCopy({ ...comparing, activity: "idle" }).title, "Comparing saved maps");
  }
});
