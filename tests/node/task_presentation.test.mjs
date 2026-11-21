import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { WorkspaceStore, initialWorkspaceState } from "./state"; export { cameraPreferences } from "./camera-preferences";',
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)), loader: "ts",
  }, bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { WorkspaceStore, initialWorkspaceState, cameraPreferences } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

test("task navigation preserves the overview presentation across task-to-task changes", () => {
  const store = new WorkspaceStore({ ...initialWorkspaceState(), view: "three", appearance: "photo" });
  store.replace({ ...store.value, workflow: "rooms" });
  assert.equal(store.value.view, "top");
  assert.equal(store.value.appearance, "rooms");
  store.replace({ ...store.value, workflow: "plans" });
  store.replace({ ...store.value, workflow: "draw" });
  store.replace({ ...store.value, workflow: "none" });
  assert.equal(store.value.view, "three");
  assert.equal(store.value.appearance, "photo");
  assert.equal(store.value.homePresentation, null);
});

test("task camera preferences stay separate from Home and survive task-to-task navigation", () => {
  const initial = initialWorkspaceState();
  const entry = {
    entryId: "robot", selectedFloorOrdinal: 1, mapFloorOrdinal: 1,
    mapFloorCoherent: true, mapSessionVerified: true, mapSessionKey: "a".repeat(64),
  };
  const store = new WorkspaceStore({
    ...initial,
    owner: { userKey: "user", entryKey: "robot" },
    coherence: "current",
    map: { ...initial.map, floorCoherent: true, sessionVerified: true },
    resources: {
      ...initial.resources,
      entry,
      scene: { status: "ready", value: { source: "live" }, problem: null },
    },
    selection: { ...initial.selection, entryId: "robot", floorId: "current" },
  });
  const homeTop = { yaw: 0, pitch: 1.5, zoom: 1.4, targetX: 2, targetZ: -3 };
  const homeThree = { yaw: -0.6, pitch: 1.1, zoom: 1.8, targetX: 4, targetZ: -5 };
  store.dispatch({ type: "set-camera", view: "top", camera: homeTop });
  store.dispatch({ type: "set-camera", view: "three", camera: homeThree });

  store.replace({ ...store.value, workflow: "rooms" });
  assert.equal(store.value.view, "top");
  assert.deepEqual(cameraPreferences(store.value), {});
  const taskTop = { yaw: 0.2, pitch: 1.4, zoom: 2.3, targetX: -1, targetZ: 6 };
  store.dispatch({ type: "set-camera", view: "top", camera: taskTop });
  assert.deepEqual(cameraPreferences(store.value).top, taskTop);
  store.replace({ ...store.value, workflow: "plan" });
  assert.deepEqual(cameraPreferences(store.value).top, taskTop);

  store.replace({ ...store.value, workflow: "none" });
  assert.equal(store.value.view, "three");
  assert.deepEqual(cameraPreferences(store.value), { top: homeTop, three: homeThree });
  store.replace({ ...store.value, workflow: "rooms" });
  assert.deepEqual(cameraPreferences(store.value).top, taskTop);
});

test("losing live authority clears following immediately", () => {
  const state = { ...initialWorkspaceState(), followMode: "ride" };
  const store = new WorkspaceStore(state);
  store.replace({ ...store.value, dataMode: "history" });
  assert.equal(store.value.followMode, "off");
  store.replace({ ...store.value, followMode: "follow", dataMode: "live" });
  assert.equal(store.value.followMode, "off");
});

test("following pauses through a missing pose and ends when the robot or its map changes", () => {
  const base = initialWorkspaceState();
  const entry = { entryId: "robot", mapFloorCoherent: true, mapSessionVerified: true,
    mapSessionKey: "session-a", mapSceneEpoch: "epoch-a" };
  const pose = { position: [1, 2], floorCoherent: true, mapSessionKey: "session-a", heading: 0 };
  const posed = (value) => ({ map: { ...store.value.map, exactPose: value !== null },
    resources: { ...store.value.resources, pose: { status: value ? "ready" : "idle", value, problem: null } } });
  const store = new WorkspaceStore({ ...base, pageActive: true, coherence: "current",
    host: { ...base.host, administrator: true, connected: true, robotConnected: true },
    map: { ...base.map, available: true, floorCoherent: true, sessionVerified: true, exactPose: true },
    resources: { ...base.resources, entry, scene: { status: "ready", value: { source: "live" }, problem: null },
      pose: { status: "ready", value: pose, problem: null } },
  });
  store.dispatch({ type: "set-follow-mode", mode: "ride" });
  assert.equal(store.value.followMode, "ride");
  store.replace({ ...store.value, ...posed(null) });
  assert.equal(store.value.followMode, "ride");
  // A catalog refresh hands over an equal entry, which is the same robot and map.
  store.replace({ ...store.value, resources: { ...store.value.resources, entry: { ...entry } } });
  assert.equal(store.value.followMode, "ride");
  store.replace({ ...store.value, ...posed({ ...pose, heading: null }) });
  assert.equal(store.value.followMode, "ride");
  store.replace({ ...store.value, ...posed(pose) });
  assert.equal(store.value.followMode, "ride");
  // Switching to another mode still needs the pose it follows.
  store.replace({ ...store.value, ...posed(null) });
  store.dispatch({ type: "set-follow-mode", mode: "follow" });
  assert.equal(store.value.followMode, "ride");
  store.replace({ ...store.value, ...posed(pose) });
  store.dispatch({ type: "set-follow-mode", mode: "follow" });
  assert.equal(store.value.followMode, "follow");
  store.replace({ ...store.value, ...posed(null), resources: { ...store.value.resources,
    pose: { status: "idle", value: null, problem: null }, entry: { ...entry, mapSceneEpoch: "epoch-b" } } });
  assert.equal(store.value.followMode, "off");
  store.replace({ ...store.value, ...posed(pose), resources: { ...store.value.resources, entry } });
  store.dispatch({ type: "set-follow-mode", mode: "follow" });
  store.replace({ ...store.value, ...posed(null), resources: { ...store.value.resources,
    pose: { status: "idle", value: null, problem: null }, entry: { ...entry, entryId: "robot-b" } } });
  assert.equal(store.value.followMode, "off");
});

test("overlap candidates include both catalogs and discard stale ids", () => {
  const state = initialWorkspaceState();
  const store = new WorkspaceStore({ ...state, resources: { ...state.resources,
    plans: { status: "ready", value: { rooms: [{ roomId: "a", name: "A" }], plans: [], selectedPlan: null }, problem: null },
    areas: { status: "ready", value: { rooms: [{ roomId: "b", name: "B" }], areas: [] }, problem: null },
  } });
  store.dispatch({ type: "show-room-candidates", roomIds: ["a", "b", "a", "removed"] });
  assert.deepEqual(store.value.roomCandidates, ["a", "b"]);
});

test("a room choice cannot cross task, plan, map, account or catalog changes", () => {
  const base = initialWorkspaceState();
  const initial = {
    ...base, workflow: "rooms", roomCandidates: ["a", "b"],
    owner: { userKey: "user", entryKey: "robot" },
    selection: { ...base.selection, entryId: "robot", floorId: "current" },
    resources: { ...base.resources,
      entry: { entryId: "robot", mapSessionKey: "session-a" },
      plans: { status: "ready", value: { rooms: [{ roomId: "a", name: "A" }, { roomId: "b", name: "B" }], plans: [], selectedPlan: null }, problem: null },
    },
  };
  const changes = [
    { workflow: "plans" },
    { selection: { ...initial.selection, planId: "another-plan" } },
    { selection: { ...initial.selection, floorId: "older-floor" } },
    { selection: { ...initial.selection, historyId: "older-map" } },
    { owner: { userKey: "another-user", entryKey: "robot" } },
    { resources: { ...initial.resources, entry: { ...initial.resources.entry, mapSessionKey: "session-b" } } },
    { resources: { ...initial.resources, plans: { ...initial.resources.plans, value: { ...initial.resources.plans.value, rooms: [{ roomId: "a", name: "Renamed" }] } } } },
  ];
  for (const change of changes) {
    const store = new WorkspaceStore(initial);
    store.replace({ ...store.value, ...change });
    assert.deepEqual(store.value.roomCandidates, [], JSON.stringify(change));
  }
  const store = new WorkspaceStore(initial);
  store.replace({ ...store.value, batteryPercent: 70 });
  assert.deepEqual(store.value.roomCandidates, ["a", "b"]);
});
