import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: `
      export { thinSegments } from "./trail-path";
      export { extendLiveTrail } from "./run-history-data";
      export { WorkspaceStore } from "./state";
      export { createGalleryState } from "../map-studio-v4-review/gallery-state";
    `,
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { thinSegments, extendLiveTrail, WorkspaceStore, createGalleryState } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

// The cases run_history.py and trail_path.py are held to (tests/test_trail_path.py).
const fixture = JSON.parse(readFileSync(new URL("../fixtures/trail_path_v1.json", import.meta.url), "utf8"));
globalThis.window ??= globalThis;

for (const { name, poses, segments } of fixture.record) {
  test(`the live trail ${name}, as the server records it`, () => {
    const ready = createGalleryState("ready");
    const key = ready.resources.entry.mapSessionKey;
    const store = new WorkspaceStore({ ...ready, activity: "cleaning", trail: { id: "live", mapSessionKey: key, segments: [[]] } });
    for (const [x, y, observedAt] of poses) {
      extendLiveTrail(store, { ...ready.resources.pose.value, mapSessionKey: key, position: [x, y], observedAt });
    }
    assert.deepEqual(store.value.trail.segments, segments);
  });
}

for (const { name, limit, segments, kept } of fixture.thin) {
  test(`thinning: ${name}, as the server thins`, () => {
    assert.deepEqual(thinSegments(segments, limit), kept);
  });
}
