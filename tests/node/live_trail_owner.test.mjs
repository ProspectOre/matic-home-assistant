import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: `
      export { RunHistoryResources } from "./run-history-resources";
      export { WorkspaceStore } from "./state";
      export { ResourceRequests } from "./resource-requests";
    `,
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { RunHistoryResources, WorkspaceStore, ResourceRequests } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
globalThis.window = globalThis;

const pose = (x) => ({ floorCoherent: true, mapSessionKey: "session-a", position: [x, 0], heading: null, ageSeconds: 0 });
const cleaning = () => {
  const store = new WorkspaceStore();
  store.replace({ ...store.value, activity: "cleaning", owner: { entryKey: "robot-a", userKey: "user-a" },
    selection: { ...store.value.selection, entryId: "robot-a" },
    trail: { id: "live", mapSessionKey: "session-a", segments: [[[0, 0]]] } });
  const owner = new RunHistoryResources(store, {}, new ResourceRequests(), { disposed: () => false, pageActive: () => true });
  return { store, owner };
};
const points = (store) => store.value.trail.segments.flat().map(([x]) => x);

test("a live trail kept from before the owner existed grows once the trail code loads", async () => {
  const { store, owner } = cleaning();
  await owner.extendLiveTrail(pose(1));
  await owner.extendLiveTrail(pose(2));
  assert.deepEqual(points(store), [0, 1, 2]);
  owner.dispose();
});

test("a pose whose user or robot changed while the trail code loaded is dropped", async () => {
  const { store, owner } = cleaning();
  const extended = owner.extendLiveTrail(pose(1));
  store.replace({ ...store.value, generation: store.value.generation + 1, owner: { entryKey: "robot-b", userKey: "user-b" } });
  await extended;
  assert.deepEqual(points(store), [0]);
  owner.dispose();
});
