import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Effects use browser frame scheduling to admit optional UI after the map has
// rendered. Model each frame as a cancellable macrotask for Node tests.
let nextAnimationFrame = 0;
const animationFrames = new Map();
globalThis.requestAnimationFrame = (callback) => {
  const id = ++nextAnimationFrame;
  const handle = setImmediate(() => {
    animationFrames.delete(id);
    callback(Date.now());
  });
  animationFrames.set(id, handle);
  return id;
};
globalThis.cancelAnimationFrame = (id) => {
  const handle = animationFrames.get(id);
  if (handle !== undefined) clearImmediate(handle);
  animationFrames.delete(id);
};

// Compile only these resource owners in memory. This does not build or load the
// production bundle; the tests exercise real stores and coherence admission.
const { outputFiles } = await build({
  stdin: {
    contents: `
      import { notice } from "./contracts";
      import { entryFloorKey, entryMissionKey } from "./backend-contracts";
      import { admittedManualRoomPreview, manualRoomPreviewKey, canStartMotion } from "./state";
      import { resource, isAbort, problemCode } from "./resource-state";
      export const previewHelpers = { notice, entryFloorKey, entryMissionKey, admittedManualRoomPreview, manualRoomPreviewKey, canStartMotion, resource, isAbort, problemCode };
      export { CatalogResources } from "./catalog-resources";
      export { SpatialScene } from "./spatial-scene";
      export { SpatialPose } from "./spatial-pose";
      export { SpatialHistory } from "./spatial-history";
      export { SpatialResources } from "./spatial-resources";
      export { RoomPreviewController } from "./room-preview-controller";
      export { HomePinResources } from "./home-pin-resources";
      export { RunHistoryResources } from "./run-history-resources";
      export { WorkspaceStore, CoherenceMachine } from "./state";
      export { ResourceRequests } from "./resource-requests";
      export { BackendError } from "./backend";
      export { entryFloorKey, entryMissionKey } from "./backend-contracts";
    `,
    resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "es2022",
});
const {
  CatalogResources, SpatialScene, SpatialPose, SpatialHistory, SpatialResources,
  RoomPreviewController, HomePinResources, RunHistoryResources, previewHelpers,
  WorkspaceStore, CoherenceMachine, ResourceRequests, BackendError,
  entryFloorKey, entryMissionKey,
} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

globalThis.window = globalThis;
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const entryFor = (overrides = {}) => ({
  entryId: "robot-a", sceneUrl: "/scene", historyUrl: "/history",
  areasUrl: "/areas", plansUrl: "/plans", wifiHeatmapUrl: null, floorTypesUrl: null,
  mapRevision: 10, mapSceneEpoch: "epoch-a", mapFloorCoherent: true,
  mapSessionVerified: true, mapSessionKey: "session-a", selectedFloorOrdinal: 1,
  mapFloorOrdinal: 1, mapComplete: true, mapTruncated: false, historyFloorCount: 1,
  health: "ready", ...overrides,
});
const fixture = () => {
  const store = new WorkspaceStore();
  const coherence = new CoherenceMachine();
  const requests = new ResourceRequests();
  const entry = entryFor();
  const host = { connected: true, administrator: true, robotConnected: true, robotCount: 1 };
  const stamp = coherence.begin(entry.entryId, entryFloorKey(entry), entryMissionKey(entry), entry.mapRevision);
  store.replace({ ...store.value,
    generation: stamp.generation,
    host: { ...store.value.host, ...host },
    coherence: "current",
    selection: { ...store.value.selection, entryId: entry.entryId },
    map: { available: true, complete: true, floorCoherent: true, sessionVerified: true, exactPose: false },
    resources: { ...store.value.resources, entry },
  });
  const callbacks = {
    disposed: () => false, pageActive: () => true,
    projection: () => ({ entryKey: entry.entryId, host }),
  };
  return { store, coherence, requests, entry, stamp, callbacks };
};
const catalogOwner = (f, read, overrides = {}) => {
  const admissions = [];
  const owner = new CatalogResources(f.store, { catalog: read }, f.coherence, f.requests, {
    ...f.callbacks,
    recoveryPending: () => false,
    ownsLiveScene: () => false, sceneRevision: () => {},
    admitSpatial: (...args) => admissions.push(args),
    syncWorkspace() {}, clearPrivate() {}, resumePins() {},
    ...overrides,
  });
  return { owner, admissions };
};
const sceneOwner = (f, read, overrides = {}) => new SpatialScene(
  f.store, { scene: read }, f.coherence, f.requests, {
    ...f.callbacks, admitted() {}, replacementFinished() {}, recovered() {}, failed() {},
    admitPose() {}, loadPlans() {}, resumeAreaCatalog() {}, ...overrides,
  },
);
const sceneResponse = (label) => ({ floorCoherent: true, revision: 10, scene: { revision: 10, label } });
const livePose = (overrides = {}) => ({
  floorCoherent: true, mapSessionKey: "session-a", position: [1, 2], heading: null, ageSeconds: 0, ...overrides,
});
const poseOwner = (f, overrides = {}) => new SpatialPose(f.store, f.coherence, {
  ...f.callbacks, failed() {}, recovered() {}, moved() {}, ...overrides,
});

test("forced catalog reads coalesce, discard the superseded response and retain the strongest invalidation", async () => {
  const f = fixture();
  const reads = [];
  const { owner, admissions } = catalogOwner(f, (signal) => {
    const next = deferred();
    reads.push({ ...next, signal });
    return next.promise;
  });
  const attach = owner.refreshCatalog();
  const first = owner.refreshCatalog(true, true, true);
  const second = owner.refreshCatalog(true, true, false);
  const third = owner.refreshCatalog(true, true, true);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].signal.aborted, true);
  reads[0].resolve([entryFor({ mapRevision: 11 })]);
  await flush();
  assert.equal(reads.length, 2);
  assert.equal(admissions.length, 0);
  reads[1].resolve([entryFor({ mapRevision: 12 })]);
  await Promise.all([attach, first, second, third]);
  assert.equal(reads.length, 2);
  assert.equal(admissions.length, 1);
  assert.equal(admissions[0][0].mapRevision, 12);
  assert.equal(admissions[0][2], true);
  assert.equal(admissions[0][3], false);
});

test("catalog polling refreshes runner locks without stealing a cooling spatial frame", async () => {
  const f = fixture();
  const { owner, admissions } = catalogOwner(f, async () => [entryFor({ mapRevision: 11, runnerLocked: true })], {
    recoveryPending: () => true,
  });
  await owner.refreshCatalog();
  assert.equal(f.store.value.managedLock, true);
  assert.equal(f.store.value.resources.entry, f.entry);
  assert.equal(admissions.length, 0);
  const lease = { isCurrent: () => true, bind() {}, release() {}, finish() {} };
  await owner.refreshCatalog(true, false, true, lease);
  assert.equal(admissions.length, 1);
  assert.equal(admissions[0][4], true);
});

test("a catalog recovery lease that loses its owner cannot admit a late response", async () => {
  const f = fixture();
  const read = deferred();
  const { owner, admissions } = catalogOwner(f, () => read.promise);
  let current = true;
  let bound;
  let released;
  const lease = {
    isCurrent: () => current, bind: (controller) => { bound = controller; },
    release: (controller) => { released = controller; }, finish() {},
  };
  const result = owner.refreshCatalog(true, false, false, lease);
  current = false;
  read.resolve([entryFor({ mapRevision: 20 })]);
  await result;
  assert.equal(admissions.length, 0);
  assert.equal(f.store.value.resources.entry, f.entry);
  assert.equal(released, bound);
});

test("a cancelled scene response cannot overwrite its replacement in the same generation", async () => {
  const f = fixture();
  const reads = [];
  const owner = sceneOwner(f, (_url, _revision, _coherent, _mode, signal) => {
    const read = deferred(); reads.push({ ...read, signal }); return read.promise;
  });
  const older = owner.load(f.entry, f.stamp);
  const replacement = owner.load(f.entry, f.stamp);
  assert.equal(reads[0].signal.aborted, true);
  reads[1].resolve(sceneResponse("replacement"));
  await replacement;
  reads[0].resolve(sceneResponse("cancelled"));
  await older;
  assert.equal(f.store.value.resources.scene.value.label, "replacement");
  assert.equal(f.store.value.generation, f.stamp.generation);
});

test("scene retirement clears a delayed building retry without a new generation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let calls = 0;
  const owner = sceneOwner(f, async () => { calls += 1; throw new BackendError("request-timeout"); });
  await owner.load(f.entry, f.stamp);
  assert.equal(calls, 1);
  owner.stop();
  t.mock.timers.tick(250);
  await flush();
  assert.equal(calls, 1);
});

test("a history read from a retired generation cannot replace the current floor catalog", async () => {
  const f = fixture();
  const read = deferred();
  const owner = new SpatialHistory(f.store, { history: () => read.promise }, f.coherence, f.requests, {
    ...f.callbacks, clearRecovery() {}, resetIdentity() {}, abortResources() {}, refreshCatalog: async () => {},
  });
  const loading = owner.loadHistory(f.entry, f.stamp);
  const next = f.coherence.begin(f.entry.entryId, "other-floor", "other-session", 10);
  f.store.replace({ ...f.store.value, generation: next.generation });
  read.resolve({ entryId: f.entry.entryId, floors: [{ id: "stale-floor", snapshots: [] }] });
  await loading;
  assert.equal(f.store.value.resources.history.value, null);
  assert.equal(f.store.value.generation, next.generation);
});

test("a pushed pose is admitted only to its robot's current map and its position expires with its observation", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(performance, "now", () => 0);
  const f = fixture();
  const moved = [];
  const owner = poseOwner(f, { moved: (pose) => moved.push(pose) });
  owner.receive("robot-b", livePose());
  assert.equal(f.store.value.resources.pose.value, null);
  const first = livePose({ ageSeconds: 0.75 });
  owner.receive("robot-a", first);
  assert.equal(f.store.value.resources.pose.value, first);
  assert.equal(f.store.value.map.exactPose, true);
  // A step on the same map moves the robot without a store update.
  const store = f.store.value;
  const second = livePose({ ageSeconds: 0.75, position: [1.5, 2] });
  owner.receive("robot-a", second);
  assert.equal(f.store.value, store);
  assert.deepEqual(moved, [first, second]);
  t.mock.timers.tick(4_249);
  assert.equal(f.store.value.map.exactPose, true);
  t.mock.timers.tick(1);
  // The expired pose keeps its map session, which the last-seen marker needs.
  assert.deepEqual([f.store.value.resources.pose.value.mapSessionKey, f.store.value.resources.pose.value.position, f.store.value.map.exactPose], ["session-a", null, false]);
  assert.equal(moved.at(-1), null);
});

test("a pose from another map session revokes the robot unless it predates the admitted scene", () => {
  const f = fixture();
  const failures = [];
  const owner = poseOwner(f, { failed: (entry) => failures.push(entry.entryId) });
  owner.receive("robot-a", livePose());
  owner.receive("robot-a", livePose({ mapSessionKey: "session-b", sceneEpoch: "epoch-a", sceneRevision: 9 }));
  assert.equal(f.store.value.map.exactPose, true);
  assert.deepEqual(failures, []);
  owner.receive("robot-a", livePose({ mapSessionKey: "session-b", sceneEpoch: "epoch-a", sceneRevision: 10 }));
  assert.equal(f.store.value.resources.pose.value, null);
  assert.equal(f.store.value.map.exactPose, false);
  // The recovery's catalog re-admits the rejected pose without starting another.
  owner.admit();
  assert.deepEqual(failures, ["robot-a"]);
});

test("a pose that arrives after a disconnect revoked the map is not admitted", () => {
  const f = fixture();
  const moved = [];
  const owner = poseOwner(f, { moved: (pose) => moved.push(pose) });
  f.coherence.invalidate();
  const store = f.store.value;
  owner.receive("robot-a", livePose());
  assert.equal(f.store.value, store);
  assert.deepEqual(moved, []);
});

test("room previews retain the captured generation when an older request settles late", async () => {
  const f = fixture();
  f.store.replace({ ...f.store.value,
    workflow: "rooms",
    selection: { ...f.store.value.selection, roomIds: ["kitchen"], roomSettings: [{ roomId: "kitchen", cleaningMode: "vacuum", coverageSetting: "standard" }] },
    resources: { ...f.store.value.resources, plans: { status: "ready", value: { plans: [] }, problem: null } },
  });
  const reads = [];
  const owner = new RoomPreviewController(f.store, { previewRoomSequence: () => {
    const read = deferred(); reads.push(read); return read.promise;
  } }, f.requests, {
    ...f.callbacks,
    projection: () => ({ ...f.callbacks.projection(), vacuumEntityId: "vacuum.robot" }),
    dispatchMotion: async () => { assert.fail("a preview read must not dispatch motion"); },
  }, previewHelpers);
  owner.reconcile();
  const next = f.coherence.begin(f.entry.entryId, entryFloorKey(f.entry), entryMissionKey(f.entry), 10);
  f.store.replace({ ...f.store.value, generation: next.generation });
  owner.reconcile();
  assert.equal(reads.length, 2);
  reads[1].resolve({ entryId: f.entry.entryId, previewToken: "current", rooms: [] });
  await flush();
  reads[0].resolve({ entryId: f.entry.entryId, previewToken: "retired", rooms: [] });
  await flush();
  assert.equal(f.store.value.manualRoomPreview.value.generation, next.generation);
  assert.equal(f.store.value.manualRoomPreview.value.preview.previewToken, "current");
});

test("home shortcut reads cannot survive an owner loss and return to the same user and robot", async () => {
  const f = fixture();
  const identity = { userKey: "owner", entryKey: f.entry.entryId };
  f.store.replace({ ...f.store.value, owner: identity });
  const reads = [];
  let planLoads = 0;
  let areaLoads = 0;
  const owner = new HomePinResources(f.store, { sendMessagePromise: () => {
    const read = deferred(); reads.push(read); return read.promise;
  } }, { disposed: () => false, loadAreas() { areaLoads += 1; }, loadPlans() { planLoads += 1; }, resumeAreas() {}, requestFailed() {} });
  const first = owner.loadHomePins();
  await flush();
  assert.equal(reads.length, 1);
  f.store.replace({ ...f.store.value, owner: null });
  owner.syncOwner();
  f.store.replace({ ...f.store.value, owner: identity });
  const second = owner.loadHomePins();
  await flush();
  assert.equal(reads.length, 2);
  reads[0].resolve({ value: { version: 2, pins: [{ kind: "plan", id: "retired" }], excluded: [] } });
  await first;
  assert.equal(f.store.value.homePins.status, "loading");
  reads[1].resolve({ value: { version: 2, pins: [{ kind: "plan", id: "current" }], excluded: [] } });
  await second;
  assert.equal(f.store.value.homePins.status, "ready");
  assert.deepEqual(f.store.value.homePins.pins, [{ kind: "plan", id: "current" }]);
  assert.equal(planLoads, 1);
  assert.equal(areaLoads, 0);
});

test("home shortcut reads retain area catalogs only for actual area pins", async () => {
  const f = fixture();
  f.store.replace({ ...f.store.value, owner: { userKey: "owner", entryKey: f.entry.entryId } });
  let areaLoads = 0;
  const owner = new HomePinResources(f.store, {
    sendMessagePromise: async () => ({ value: { version: 2, pins: [{ kind: "area", id: "area-1" }], excluded: [] } }),
    subscribeMessage: async () => () => undefined,
  }, { disposed: () => false, loadAreas() { areaLoads += 1; }, loadPlans() {}, resumeAreas() {}, requestFailed() {} });
  await owner.loadHomePins();
  assert.equal(f.store.value.homePins.status, "ready");
  assert.equal(areaLoads, 1);
});

test("catalog area reads wait for an area workflow or an area pin", async () => {
  const f = fixture();
  let areaReads = 0;
  const owner = new CatalogResources(f.store, {
    areas: async () => {
      areaReads += 1;
      return { sceneUrl: f.entry.sceneUrl, areas: [], selectedArea: null };
    },
  }, f.coherence, f.requests, {
    ...f.callbacks,
    recoveryPending: () => false,
    ownsLiveScene: () => false, sceneRevision: () => {},
    admitSpatial() {},
    syncWorkspace() {},
    clearPrivate() {},
    resumePins() {},
  });
  f.store.replace({ ...f.store.value, homePins: { status: "ready", pins: [{ kind: "plan", id: "plan-1" }] } });
  owner.resumeAreas();
  await flush();
  assert.equal(areaReads, 0);

  f.store.replace({ ...f.store.value, homePins: { status: "ready", pins: [{ kind: "area", id: "area-1" }] } });
  owner.resumeAreas();
  await flush();
  assert.equal(areaReads, 1);
  assert.equal(f.store.value.resources.areas.status, "ready");
});

test("a held plan-module import retries for the new user and drops the retired error callback", async () => {
  const f = fixture();
  const held = deferred();
  const loads = [];
  let imports = 0;
  class PlanModule {
    constructor(store) { this.store = store; }
    async loadPlans() { loads.push(this.store.value.owner.userKey); return null; }
  }
  const { owner } = catalogOwner(f, async () => [], {
    loadPlanResources: () => ++imports === 1 ? held.promise : Promise.resolve({ PlanCatalogResources: PlanModule }),
  });
  f.store.replace({ ...f.store.value, owner: { entryKey: "robot-a", userKey: "user-a" } });
  let retiredError = 0;
  const oldRequest = owner.loadPlans({ onError: () => { retiredError += 1; } });
  await flush();
  f.store.replace({ ...f.store.value, generation: f.store.value.generation + 1, owner: { entryKey: "robot-a", userKey: "user-b" } });
  const currentRequest = owner.loadPlans();
  held.resolve({ PlanCatalogResources: PlanModule });
  await Promise.all([oldRequest, currentRequest]);
  assert.deepEqual(loads, ["user-b"]);
  assert.equal(retiredError, 0);
  assert.equal(imports, 2);
});

test("plan-module import failure reports readback failure once and permits explicit retry", async () => {
  const f = fixture();
  let imports = 0;
  let reported = 0;
  class PlanModule { async loadPlans() { return null; } }
  const { owner } = catalogOwner(f, async () => [], {
    loadPlanResources: () => ++imports === 1
      ? Promise.reject(new Error("chunk unavailable")) : Promise.resolve({ PlanCatalogResources: PlanModule }),
  });
  f.store.replace({ ...f.store.value, owner: { entryKey: "robot-a", userKey: "user-a" } });
  assert.equal(await owner.loadPlans({ onError: () => { reported += 1; } }), null);
  assert.equal(f.store.value.resources.plans.status, "error");
  assert.equal(reported, 1);
  assert.equal(await owner.loadPlans({ onError: () => { reported += 1; } }), null);
  assert.equal(imports, 1);
  assert.equal(await owner.loadPlans({ force: true }), null);
  assert.equal(imports, 2);
});

test("a plan-module rejection after page suspension does not publish a stale readback error", async () => {
  const f = fixture();
  const held = deferred();
  let active = true;
  let reported = 0;
  const { owner } = catalogOwner(f, async () => [], {
    pageActive: () => active,
    loadPlanResources: () => held.promise,
  });
  f.store.replace({ ...f.store.value, owner: { entryKey: "robot-a", userKey: "user-a" } });
  const request = owner.loadPlans({ onError: () => { reported += 1; } });
  assert.equal(f.store.value.resources.plans.status, "loading");
  active = false;
  f.store.replace({ ...f.store.value, resources: { ...f.store.value.resources,
    plans: { status: "idle", value: null, problem: null } } });
  held.reject(new Error("page suspended"));
  assert.equal(await request, null);
  assert.equal(f.store.value.resources.plans.status, "idle");
  assert.equal(reported, 0);
});

test("disposing while run-history code loads cannot start a request or resurrect loading state", async () => {
  const f = fixture();
  let disposed = false;
  let calls = 0;
  const owner = new RunHistoryResources(f.store, { runs: async () => { calls += 1; } }, f.requests, {
    disposed: () => disposed, pageActive: () => true,
  });
  const read = owner.loadRuns();
  disposed = true;
  owner.dispose();
  await read;
  assert.equal(calls, 0);
  assert.equal(f.store.value.resources.runs.status, "idle");
  assert.equal(f.requests.has("runs"), false);
});

const spatialOwner = (f) => new SpatialResources(f.store, {
  history: async () => ({ entryId: f.entry.entryId, floors: [] }),
  scene: async () => sceneResponse("live"),
}, f.coherence, f.requests, {
  ...f.callbacks, refreshCatalog: async () => {}, cancelCatalogRecovery() {},
  abortResources: (except) => f.requests.abort(except), invalidateMotion() {},
  loadPlans() {}, resumeAreaCatalog() {}, movePose() {}, loadWorkspaceResources() {},
});

test("a pose's freshness counts its age when sent and the time since it arrived", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const f = fixture();
  const owner = poseOwner(f);
  f.store.replace({ ...f.store.value, selection: { ...f.store.value.selection, floorId: "saved-1" } });
  owner.receive("robot-a", livePose({ ageSeconds: 0.75 }));
  assert.equal(f.store.value.map.exactPose, false);
  // The map is admitted 3 s later, leaving 1.25 s of the observation's life.
  now = 3_000;
  f.store.replace({ ...f.store.value, selection: { ...f.store.value.selection, floorId: "current" } });
  owner.admit();
  assert.equal(f.store.value.map.exactPose, true);
  t.mock.timers.tick(1_249);
  assert.equal(f.store.value.map.exactPose, true);
  t.mock.timers.tick(1);
  assert.equal(f.store.value.map.exactPose, false);
  now = 5_001; // Viewing a saved floor clears the pose; back on Live its session returns without a position.
  f.store.replace({ ...f.store.value, resources: { ...f.store.value.resources, pose: { status: "idle", problem: null, value: null } } });
  owner.admit();
  assert.deepEqual([f.store.value.resources.pose.value?.mapSessionKey, f.store.value.resources.pose.value?.position, f.store.value.map.exactPose], ["session-a", null, false]);
});

test("a catalog refresh re-admits the newest pose without extending its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const f = fixture();
  const owner = spatialOwner(f);
  owner.receivePose("robot-a", livePose());
  owner.admitCatalog(f.entry, null, true, false, false);
  await flush();
  assert.equal(f.store.value.map.exactPose, true);
  const generation = f.store.value.generation;
  now = 1_000;
  t.mock.timers.tick(1_000);
  owner.admitCatalog(f.entry, f.entry, true, false, false);
  await flush();
  assert.ok(f.store.value.generation > generation);
  assert.equal(f.store.value.map.exactPose, true);
  t.mock.timers.tick(4_000);
  assert.equal(f.store.value.map.exactPose, false);
  assert.equal(f.store.value.resources.pose.value.position, null);
  const current = livePose({ position: [3, 4] });
  owner.receivePose("robot-a", current);
  assert.equal(f.store.value.resources.pose.value, current);
  assert.equal(f.store.value.map.exactPose, true);
  owner.clearPoseExpiry();
});

test("a catalog refresh cannot promote an unknown-age or stale pose to exact", async () => {
  for (const retained of [livePose({ ageSeconds: null }), livePose({ ageSeconds: 6 })]) {
    const f = fixture();
    const owner = spatialOwner(f);
    owner.receivePose("robot-a", retained);
    owner.admitCatalog(f.entry, null, true, false, false);
    await flush();
    assert.equal(f.store.value.map.exactPose, false);
    owner.admitCatalog(f.entry, f.entry, true, false, false);
    await flush();
    assert.equal(f.store.value.map.exactPose, false); // An observation older than the window keeps only its session:
    assert.deepEqual(f.store.value.resources.pose.value, retained.ageSeconds === null ? retained : { ...retained, position: null, heading: null });
  }
});

const changeOwner = (f, userKey, entryId) => {
  const entry = entryFor({ entryId });
  f.store.replace({ ...f.store.value,
    owner: { userKey, entryKey: entryId },
    selection: { ...f.store.value.selection, entryId },
    resources: { ...f.store.value.resources, entry },
  });
};
const thumbnailOwner = (f, read) => new RunHistoryResources(f.store, { runThumbnail: read }, f.requests, {
  disposed: () => false, pageActive: () => true,
});

test("thumbnail reads and cached URLs belong to a user/robot incarnation, including ID collisions", async (t) => {
  const f = fixture();
  changeOwner(f, "user-a", "robot-a");
  const reads = [];
  const created = [];
  const revoked = [];
  t.mock.method(URL, "createObjectURL", () => { const url = `blob:${created.length}`; created.push(url); return url; });
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  const owner = thumbnailOwner(f, (entryId, id, signal) => {
    const read = deferred(); reads.push({ ...read, entryId, id, signal }); return read.promise;
  });
  const older = owner.loadRunThumbnail("shared-id");
  await flush();
  changeOwner(f, "user-b", "robot-b");
  assert.equal(reads[0].signal.aborted, true);
  const current = owner.loadRunThumbnail("shared-id");
  await flush();
  assert.deepEqual(reads.map(({ entryId }) => entryId), ["robot-a", "robot-b"]);
  reads[0].resolve(new Blob(["retired"]));
  await older;
  assert.deepEqual(f.store.value.runThumbnails, {});
  assert.deepEqual(created, []);
  reads[1].resolve(new Blob(["current"]));
  await current;
  assert.equal(f.store.value.runThumbnails["shared-id"], "blob:0");
  changeOwner(f, "other-user", "robot-b");
  assert.deepEqual(f.store.value.runThumbnails, {});
  assert.deepEqual(revoked, ["blob:0"]);
  const nextUser = owner.loadRunThumbnail("shared-id");
  await flush();
  assert.equal(reads.length, 3);
  reads[2].resolve(new Blob(["next-user"]));
  await nextUser;
  owner.dispose();
  assert.deepEqual(revoked, ["blob:0", "blob:1"]);
});

test("returning to the same thumbnail owner cannot revive a pre-transition response", async () => {
  const f = fixture();
  changeOwner(f, "user-a", "robot-a");
  const reads = [];
  const owner = thumbnailOwner(f, () => { const read = deferred(); reads.push(read); return read.promise; });
  const older = owner.loadRunThumbnail("same-id");
  await flush();
  changeOwner(f, "user-b", "robot-b");
  changeOwner(f, "user-a", "robot-a");
  reads[0].resolve(new Blob(["old-incarnation"]));
  await older;
  assert.deepEqual(f.store.value.runThumbnails, {});
  const current = owner.loadRunThumbnail("same-id");
  await flush();
  assert.equal(reads.length, 2);
  reads[1].resolve(new Blob(["current-incarnation"]));
  await current;
  assert.ok(f.store.value.runThumbnails["same-id"]);
  owner.dispose();
});

test("owner changes during lazy thumbnail loading prevent the retired read from starting", async () => {
  const f = fixture();
  changeOwner(f, "user-a", "robot-a");
  let calls = 0;
  const owner = thumbnailOwner(f, async () => { calls += 1; return new Blob(["picture"]); });
  const read = owner.loadRunThumbnail("same-id");
  changeOwner(f, "user-b", "robot-b");
  await read;
  assert.equal(calls, 0);
  assert.deepEqual(f.store.value.runThumbnails, {});
  owner.dispose();
});

test("thumbnail retry cooldowns and timers are retired when ownership changes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  changeOwner(f, "user-a", "robot-a");
  let calls = 0;
  const owner = thumbnailOwner(f, async () => {
    if (++calls === 1) throw new Error("thumbnail-unavailable");
    return new Blob(["new-owner"]);
  });
  await owner.loadRunThumbnail("shared-id");
  changeOwner(f, "user-b", "robot-b");
  await owner.loadRunThumbnail("shared-id");
  assert.equal(calls, 2);
  const current = f.store.value;
  t.mock.timers.tick(60_000);
  assert.equal(f.store.value, current);
  owner.dispose();
});

test("room preflight cannot dispatch after leaving Rooms or disposing its owner", async () => {
  for (const retire of ["leave", "dispose"]) {
    const f = fixture();
    f.store.replace({ ...f.store.value,
      workflow: "rooms", activity: "idle",
      selection: { ...f.store.value.selection, roomIds: ["kitchen"], roomSettings: [{ roomId: "kitchen", cleaningMode: "vacuum", coverageSetting: "standard" }] },
      resources: { ...f.store.value.resources, plans: { status: "ready", value: { plans: [] }, problem: null } },
    });
    let disposed = false;
    const reads = [];
    let commands = 0;
    const owner = new RoomPreviewController(f.store, { previewRoomSequence: () => {
      const read = deferred(); reads.push(read); return read.promise;
    } }, f.requests, {
      disposed: () => disposed,
      projection: () => ({ ...f.callbacks.projection(), vacuumEntityId: "vacuum.robot" }),
      dispatchMotion: async () => { commands += 1; },
    }, previewHelpers);
    const preview = { entryId: f.entry.entryId, previewToken: "initial", blocker: null, rooms: [{ room: "kitchen" }] };
    owner.reconcile();
    reads[0].resolve(preview);
    await flush();
    const preflight = owner.clean();
    assert.equal(reads.length, 2);
    if (retire === "leave") f.store.replace({ ...f.store.value, workflow: "none" });
    else disposed = true;
    reads[1].resolve({ ...preview, previewToken: "rechecked" });
    await preflight;
    assert.equal(commands, 0, retire);
  }
});

test("a room-module failure after leaving Rooms is reported on return and explicit retry", async (t) => {
  const result = await build({
    stdin: {
      contents: 'export { EffectController } from "./effects"; export { WorkspaceStore } from "./state";',
      resolveDir: fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url)), loader: "ts",
    },
    bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
    plugins: [{
      name: "failed-preview-module",
      setup(compiler) {
        compiler.onResolve({ filter: /^\.\/room-preview-controller$/ }, () => ({ path: "preview", namespace: "failed" }));
        compiler.onLoad({ filter: /.*/, namespace: "failed" }, () => ({
          contents: 'throw new Error("simulated module load failure"); export class RoomPreviewController {}', loader: "js",
        }));
      },
    }],
  });
  const { EffectController, WorkspaceStore: Store } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = {
    addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval() {}, localStorage: { getItem: () => null, setItem() {} },
  };
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const store = new Store();
  const effects = new EffectController(store, { catalog: () => new Promise(() => {}), dispose() {} });
  t.after(() => {
    effects.dispose();
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  });
  effects.sync({
    userKey: "owner", entryKey: "robot-a", vacuumEntityId: "vacuum.robot",
    host: { ...store.value.host, connected: true, administrator: true, robotConnected: true, robotCount: 1 },
    robots: [], language: "en",
  });
  store.replace({ ...store.value, workflow: "rooms" });
  store.replace({ ...store.value, workflow: "none" });
  await flush();
  let publications = 0;
  const unsubscribe = store.subscribe(() => { publications += 1; });
  store.replace({ ...store.value, workflow: "rooms" });
  await flush();
  assert.equal(store.value.manualRoomPreview.status, "error");
  assert.ok(publications <= 3, "reporting a cached module failure must not recurse through the store");
  store.dispatch({ type: "retry-room-preview" });
  await flush();
  assert.equal(store.value.manualRoomPreview.status, "error");
  assert.equal(store.value.manualRoomPreviewRetry, 1);
  unsubscribe();
});

let planModuleCode;
let planGateSequence = 0;
const heldPlanController = async (t, failModule = false) => {
  const resolveDir = fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url));
  planModuleCode ??= (await build({
    stdin: { contents: 'export * from "./catalog-writes";', resolveDir, loader: "ts" },
    bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
  })).outputFiles[0].text;
  const gate = deferred();
  const gateKey = `__maticPlanModuleGate${++planGateSequence}`;
  globalThis[gateKey] = gate.promise;
  const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const moduleUrl = dataUrl(`await globalThis[${JSON.stringify(gateKey)}];\n${failModule
    ? 'throw new Error("simulated catalog module failure");'
    : `export * from ${JSON.stringify(dataUrl(planModuleCode))};`}`);
  const result = await build({
    stdin: { contents: 'export { EffectController } from "./effects"; export { WorkspaceStore } from "./state";', resolveDir, loader: "ts" },
    bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
    plugins: [{ name: "held-catalog-module", setup(compiler) {
      compiler.onResolve({ filter: /^\.\/catalog-writes$/ }, () => ({ path: moduleUrl, external: true }));
    } }],
  });
  const { EffectController, WorkspaceStore: Store } = await import(dataUrl(result.outputFiles[0].text));
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = {
    addEventListener() {}, removeEventListener() {}, setTimeout: () => 1, clearTimeout() {},
    setInterval: () => 1, clearInterval() {}, localStorage: { getItem: () => null, setItem() {} },
  };
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const store = new Store();
  const entry = entryFor();
  const plan = { ...store.value.planDraft, id: "saved-plan", name: "Saved", enabled: true, roomOrder: [], nextRunPreview: { previewToken: "a".repeat(64), blocker: null, rooms: [], missionBoundaries: [] } };
  const plans = { selectedPlan: plan.id, plans: [plan] };
  const service = deferred();
  const calls = [];
  let planReads = 0;
  const effects = new EffectController(store, {
    catalog: async () => [entry], history: async () => ({ entryId: entry.entryId, floors: [] }),
    scene: async () => sceneResponse("live"), pose: () => new Promise(() => {}),
    plans: async () => { planReads += 1; return plans; },
    service: (_domain, name) => { calls.push(name); return name === "run_selected_plan" ? service.promise : Promise.resolve(); },
    dispose() {},
  });
  t.after(() => {
    gate.resolve(); service.resolve(); effects.dispose();
    globalThis.window = savedWindow; globalThis.document = savedDocument;
    delete globalThis[gateKey];
  });
  effects.sync({
    userKey: "owner", entryKey: entry.entryId, vacuumEntityId: "vacuum.robot", activity: "idle",
    host: { ...store.value.host, connected: true, administrator: true, robotConnected: true, robotCount: 1 },
    robots: [], language: "en",
  });
  await flush();
  store.replace({ ...store.value,
    workflow: "plan", activity: "idle", command: "idle",
    selection: { ...store.value.selection, planId: plan.id },
    planDraft: { ...store.value.planDraft, id: plan.id, enabled: true },
    resources: { ...store.value.resources, plans: { status: "ready", value: plans, problem: null } },
  });
  planReads = 0;
  return { effects, store, gate, service, calls, planReads: () => planReads };
};
const waitFor = async (predicate) => {
  for (let i = 0; i < 40 && !predicate(); i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(predicate(), "expected asynchronous module continuation");
};

test("a held plan module claims pending immediately and coalesces duplicate Run clicks", async (t) => {
  const f = await heldPlanController(t);
  const first = f.effects.executeAction("run-plan");
  assert.equal(f.store.value.command, "pending");
  assert.equal(f.store.value.pendingAction, "run-plan");
  await f.effects.executeAction("run-plan");
  assert.equal(f.planReads(), 0);
  assert.deepEqual(f.calls, []);
  f.gate.resolve();
  await waitFor(() => f.calls.includes("run_selected_plan"));
  assert.equal(f.planReads(), 1);
  assert.deepEqual(f.calls, ["run_selected_plan"]);
  f.service.resolve();
  await first;
});

test("a held plan module cannot start after its workflow, draft, generation or owner is retired", async (t) => {
  for (const retire of ["leave", "draft", "generation", "dispose"]) await t.test(retire, async (subtest) => {
    const f = await heldPlanController(subtest);
    const action = f.effects.executeAction("run-plan");
    if (retire === "leave") f.store.replace({ ...f.store.value, workflow: "none" });
    if (retire === "draft") f.store.replace({ ...f.store.value, planDraft: { ...f.store.value.planDraft, name: "Changed" } });
    if (retire === "generation") f.store.replace({ ...f.store.value, generation: f.store.value.generation + 1, command: "idle" });
    if (retire === "dispose") f.effects.dispose();
    f.gate.resolve();
    await action;
    assert.equal(f.planReads(), 0);
    assert.deepEqual(f.calls, []);
  });
});

test("plan-module failure reports only to the captured workflow", async (t) => {
  for (const leave of [false, true]) await t.test(leave ? "left" : "current", async (subtest) => {
    const f = await heldPlanController(subtest, true);
    const action = f.effects.executeAction("run-plan");
    if (leave) f.store.replace({ ...f.store.value, workflow: "none" });
    f.gate.resolve();
    await action;
    assert.equal(f.store.value.command, "idle");
    assert.equal(f.store.value.notice?.key ?? null, leave ? null : "v4_notice_plan_preview_refresh_failed");
    assert.deepEqual(f.calls, []);
  });
});

test("settling an old managed start cannot release a newer pending write", async (t) => {
  const f = await heldPlanController(t);
  const action = f.effects.executeAction("run-plan");
  f.gate.resolve();
  await waitFor(() => f.calls.includes("run_selected_plan"));
  await f.effects.executeAction("stop");
  f.store.replace({ ...f.store.value, command: "pending", pendingAction: "save-plan" });
  f.service.resolve();
  await action;
  assert.equal(f.store.value.command, "pending");
  assert.equal(f.store.value.pendingAction, "save-plan");
});

let previewModuleCode;
let previewGateSequence = 0;
const heldRoomController = async (t, failModule = false) => {
  const resolveDir = fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url));
  previewModuleCode ??= (await build({
    stdin: { contents: 'export * from "./room-preview-controller";', resolveDir, loader: "ts" },
    bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
  })).outputFiles[0].text;
  const gate = deferred();
  const gateKey = `__maticPreviewModuleGate${++previewGateSequence}`;
  globalThis[gateKey] = gate.promise;
  const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const moduleUrl = dataUrl(`await globalThis[${JSON.stringify(gateKey)}];\n${failModule
    ? 'throw new Error("simulated preview module failure");'
    : `export * from ${JSON.stringify(dataUrl(previewModuleCode))};`}`);
  const result = await build({
    stdin: { contents: `export { EffectController } from "./effects";
      export { WorkspaceStore } from "./state";
      export { createGalleryState, withGalleryRoomPreview } from "../map-studio-v4-review/gallery-state";`, resolveDir, loader: "ts" },
    bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
    plugins: [{ name: "held-preview-module", setup(compiler) {
      compiler.onResolve({ filter: /^\.\/room-preview-controller$/ }, () => ({ path: moduleUrl, external: true }));
    } }],
  });
  const { EffectController, WorkspaceStore: Store, createGalleryState, withGalleryRoomPreview } = await import(dataUrl(result.outputFiles[0].text));
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = {
    addEventListener() {}, removeEventListener() {}, setTimeout: () => 1, clearTimeout() {},
    setInterval: () => 1, clearInterval() {}, localStorage: { getItem: () => null, setItem() {} },
  };
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const base = createGalleryState("ready");
  const initial = withGalleryRoomPreview({ ...base, workflow: "rooms", selection: {
    ...base.selection, roomIds: ["room-a"],
    roomSettings: [{ roomId: "room-a", cleaningMode: "vacuum", coverageSetting: "quick" }],
  } });
  const store = new Store(initial);
  const service = deferred();
  const calls = [];
  let previews = 0;
  const effects = new EffectController(store, {
    catalog: () => new Promise(() => {}),
    previewRoomSequence: async (_entityId, rooms) => {
      previews += 1;
      return {
        entryId: initial.selection.entryId, floorToken: "f".repeat(64), previewToken: "b".repeat(64),
        rooms: rooms.map((room) => ({ roomId: room.room, name: room.room === "room-a" ? "Kitchen" : room.room,
          cleaningMode: room.cleaning_mode, coverageSetting: room.coverage_setting, cadenceReasons: [] })),
        missionBoundaries: [], blocker: null,
      };
    },
    service: (_domain, name, data, entityId) => { calls.push({ name, data, entityId }); return service.promise; },
    dispose() {},
  });
  const projection = {
    userKey: "owner", entryKey: initial.selection.entryId, vacuumEntityId: "vacuum.robot", activity: "idle",
    host: initial.host, robots: initial.robots, language: "en", batteryPercent: 92, robotLabel: "Synthetic",
  };
  effects.sync(projection);
  t.after(() => {
    gate.resolve(); service.resolve(); effects.dispose();
    globalThis.window = savedWindow; globalThis.document = savedDocument;
    delete globalThis[gateKey];
  });
  return { effects, store, gate, service, calls, projection, previews: () => previews };
};

test("an admitted room click waits for its module and duplicate clicks start only once", async (t) => {
  const f = await heldRoomController(t);
  const first = f.effects.executeAction("clean-rooms");
  const duplicate = f.effects.executeAction("clean-rooms");
  assert.equal(f.previews(), 0);
  assert.deepEqual(f.calls, []);
  f.gate.resolve();
  await waitFor(() => f.calls.length > 0);
  assert.equal(f.previews(), 1, "the click must still perform a fresh server preflight");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { name: "clean_room_sequence", entityId: "vacuum.robot", data: {
    rooms: [{ room: "room-a", cleaning_mode: "vacuum", coverage_setting: "quick" }],
    use_room_schedule: true, override_room_schedule: false, return_to_base: true, preview_token: "b".repeat(64),
  } });
  f.service.resolve();
  await Promise.all([first, duplicate]);
});

test("a room click waiting for its module is retired by changed admission boundaries", async (t) => {
  for (const retire of ["workflow-aba", "selection-aba", "owner-aba", "entity-aba", "generation", "retry", "dispose"]) {
    await t.test(retire, async (subtest) => {
      const f = await heldRoomController(subtest);
      const before = f.store.value;
      const action = f.effects.executeAction("clean-rooms");
      if (retire === "workflow-aba") {
        f.store.dispatch({ type: "open-workflow", workflow: "plan" });
        f.store.dispatch({ type: "open-workflow", workflow: "rooms" });
      }
      if (retire === "selection-aba") {
        f.store.replace({ ...f.store.value, selection: { ...before.selection, roomIds: ["room-b"] } });
        f.store.replace({ ...f.store.value, selection: before.selection });
      }
      if (retire === "owner-aba") {
        f.store.replace({ ...f.store.value, owner: { ...before.owner, userKey: "another-owner" } });
        f.store.replace({ ...f.store.value, owner: before.owner });
      }
      if (retire === "entity-aba") {
        f.effects.sync({ ...f.projection, vacuumEntityId: "vacuum.replacement" });
        f.effects.sync(f.projection);
      }
      if (retire === "generation") f.store.replace({ ...f.store.value, generation: before.generation + 1 });
      if (retire === "retry") f.store.dispatch({ type: "retry-room-preview" });
      if (retire === "dispose") f.effects.dispose();
      f.gate.resolve();
      await action;
      assert.deepEqual(f.calls, [], "the retired click cannot dispatch after loading");
    });
  }
});

test("a room click reports a failed controller import without dispatching", async (t) => {
  const f = await heldRoomController(t, true);
  const action = f.effects.executeAction("clean-rooms");
  f.gate.resolve();
  await action;
  assert.equal(f.previews(), 0);
  assert.deepEqual(f.calls, []);
  assert.equal(f.store.value.manualRoomPreview.status, "error");
});


test("blocked and empty room admissions never preflight or dispatch after the module loads", async (t) => {
  for (const denied of ["blocked", "empty"]) await t.test(denied, async (subtest) => {
    const f = await heldRoomController(subtest);
    const resource = f.store.value.manualRoomPreview;
    f.store.replace({ ...f.store.value, manualRoomPreview: { ...resource, value: { ...resource.value, preview: {
      ...resource.value.preview,
      ...(denied === "blocked" ? { blocker: "unavailable-room" } : { rooms: [] }),
    } } } });
    const action = f.effects.executeAction("clean-rooms");
    f.gate.resolve();
    await action;
    assert.equal(f.previews(), 0);
    assert.deepEqual(f.calls, []);
  });
});


test("loaded room actions still coalesce duplicates and retire a click on navigation", async (t) => {
  const f = await heldRoomController(t);
  const warmup = f.effects.executeAction("clean-rooms");
  f.gate.resolve();
  f.service.resolve();
  await warmup;
  await waitFor(() => f.store.value.manualRoomPreview.status === "ready");
  f.calls.length = 0;
  const first = f.effects.executeAction("clean-rooms");
  const duplicate = f.effects.executeAction("clean-rooms");
  await Promise.all([first, duplicate]);
  assert.equal(f.calls.length, 1);
  await waitFor(() => f.store.value.manualRoomPreview.status === "ready");
  const retired = f.effects.executeAction("clean-rooms");
  f.store.dispatch({ type: "open-workflow", workflow: "plan" });
  f.store.dispatch({ type: "open-workflow", workflow: "rooms" });
  await retired;
  assert.equal(f.calls.length, 1, "returning to Rooms cannot restore the old click");
});
