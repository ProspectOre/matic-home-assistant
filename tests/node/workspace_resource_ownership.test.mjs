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
  entryId: "robot-a", sceneUrl: "/scene", deltaUrl: null, poseUrl: "/pose", historyUrl: "/history",
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
  store.patch({
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
    ownsLiveDelta: () => false,
    admitSpatial: (...args) => admissions.push(args),
    syncWorkspace() {}, clearPrivate() {}, resumePins() {},
    ...overrides,
  });
  return { owner, admissions };
};
const sceneOwner = (f, read, overrides = {}) => new SpatialScene(
  f.store, { scene: read }, f.coherence, f.requests, {
    ...f.callbacks, admitted() {}, replacementFinished() {}, recovered() {}, failed() {},
    loadPose: async () => {}, loadPlans() {}, resumeAreaCatalog() {}, ...overrides,
  },
);
const sceneResponse = (label) => ({ floorCoherent: true, revision: 10, scene: { revision: 10, label } });

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
  f.store.patch({ generation: next.generation });
  read.resolve({ entryId: f.entry.entryId, floors: [{ id: "stale-floor", snapshots: [] }] });
  await loading;
  assert.equal(f.store.value.resources.history.value, null);
  assert.equal(f.store.value.generation, next.generation);
});

test("queued pose refresh follows the current generation and expiry belongs to its admitted pose", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const reads = [];
  const owner = new SpatialPose(f.store, { pose: () => {
    const read = deferred(); reads.push(read); return read.promise;
  } }, f.coherence, f.requests, { ...f.callbacks, failed() {}, recovered() {}, extendLiveTrail() {} });
  const first = owner.load(f.entry, f.stamp);
  const next = f.coherence.begin(f.entry.entryId, entryFloorKey(f.entry), entryMissionKey(f.entry), 10);
  f.store.patch({ generation: next.generation });
  await owner.refreshPose();
  const pose = { floorCoherent: true, mapSessionKey: "session-a", position: [1, 2], freshness: "live", nativeObservationAgeSeconds: 0 };
  reads[0].resolve({ ...pose, position: [99, 99] });
  await first;
  assert.equal(f.store.value.resources.pose.value, null);
  assert.equal(reads.length, 2);
  reads[1].resolve(pose);
  await flush();
  assert.equal(f.store.value.resources.pose.value, pose);
  assert.equal(f.store.value.map.exactPose, true);
  t.mock.timers.tick(5_000);
  assert.equal(f.store.value.resources.pose.value, null);
  assert.equal(f.store.value.map.exactPose, false);
});

test("room previews retain the captured generation when an older request settles late", async () => {
  const f = fixture();
  f.store.patch({
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
  f.store.patch({ generation: next.generation });
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
  f.store.patch({ owner: identity });
  const reads = [];
  let planLoads = 0;
  let areaLoads = 0;
  const owner = new HomePinResources(f.store, { sendMessagePromise: () => {
    const read = deferred(); reads.push(read); return read.promise;
  } }, { disposed: () => false, loadAreas() { areaLoads += 1; }, loadPlans() { planLoads += 1; }, resumeAreas() {}, requestFailed() {} });
  const first = owner.loadHomePins();
  await flush();
  assert.equal(reads.length, 1);
  f.store.patch({ owner: null });
  owner.syncOwner();
  f.store.patch({ owner: identity });
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
  f.store.patch({ owner: { userKey: "owner", entryKey: f.entry.entryId } });
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
    ownsLiveDelta: () => false,
    admitSpatial() {},
    syncWorkspace() {},
    clearPrivate() {},
    resumePins() {},
  });
  f.store.patch({ homePins: { status: "ready", pins: [{ kind: "plan", id: "plan-1" }] } });
  owner.resumeAreas();
  await flush();
  assert.equal(areaReads, 0);

  f.store.patch({ homePins: { status: "ready", pins: [{ kind: "area", id: "area-1" }] } });
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
  f.store.patch({ owner: { entryKey: "robot-a", userKey: "user-a" } });
  let retiredError = 0;
  const oldRequest = owner.loadPlans({ onError: () => { retiredError += 1; } });
  await flush();
  f.store.patch({ generation: f.store.value.generation + 1, owner: { entryKey: "robot-a", userKey: "user-b" } });
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
  f.store.patch({ owner: { entryKey: "robot-a", userKey: "user-a" } });
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
  f.store.patch({ owner: { entryKey: "robot-a", userKey: "user-a" } });
  const request = owner.loadPlans({ onError: () => { reported += 1; } });
  assert.equal(f.store.value.resources.plans.status, "loading");
  active = false;
  f.store.patch({ resources: { ...f.store.value.resources,
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

const spatialOwner = (f, pose) => new SpatialResources(f.store, {
  history: async () => ({ entryId: f.entry.entryId, floors: [] }),
  scene: async () => sceneResponse("live"), pose,
}, f.coherence, f.requests, {
  ...f.callbacks, refreshCatalog: async () => {}, cancelCatalogRecovery() {},
  abortResources: (except) => f.requests.abort(except), invalidateMotion() {},
  loadPlans() {}, resumeAreaCatalog() {}, extendLiveTrail() {}, loadWorkspaceResources() {},
});
const livePose = (overrides = {}) => ({
  floorCoherent: true, mapSessionKey: "session-a", position: [1, 2],
  freshness: "live", nativeObservationAgeSeconds: 0, ...overrides,
});

test("slow server work does not consume fresh-pose lifetime twice", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const f = fixture();
  const reply = deferred();
  const owner = new SpatialPose(f.store, { pose: () => reply.promise }, f.coherence, f.requests, {
    ...f.callbacks, failed() {}, recovered() {}, extendLiveTrail() {},
  });
  const load = owner.load(f.entry, f.stamp);
  now = 6_000;
  reply.resolve(livePose({ nativeObservationAgeSeconds: 0.75, poseProcessingSeconds: 5.5 }));
  await load;
  assert.equal(f.store.value.map.exactPose, true);
  t.mock.timers.tick(3_749);
  assert.equal(f.store.value.map.exactPose, true);
  t.mock.timers.tick(1);
  assert.equal(f.store.value.map.exactPose, false);

  const oldServer = deferred();
  const conservative = new SpatialPose(f.store, { pose: () => oldServer.promise }, f.coherence, f.requests, {
    ...f.callbacks, failed() {}, recovered() {}, extendLiveTrail() {},
  });
  const pending = conservative.load(f.entry, f.stamp);
  now += 6_000;
  oldServer.resolve(livePose({ nativeObservationAgeSeconds: 0.75 }));
  await pending;
  assert.equal(f.store.value.map.exactPose, false);
});

test("a retained pose expires on its original deadline across a forced same-frame refresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const replacement = deferred();
  let reads = 0;
  const owner = spatialOwner(f, () => ++reads === 1 ? Promise.resolve(livePose()) : replacement.promise);
  owner.admitCatalog(f.entry, null, true, false, false);
  await flush();
  assert.equal(f.store.value.map.exactPose, true);
  const generation = f.store.value.generation;
  t.mock.timers.tick(1_000);
  owner.admitCatalog(f.entry, f.entry, true, false, false);
  await flush();
  assert.ok(f.store.value.generation > generation);
  assert.equal(f.store.value.map.exactPose, true);
  t.mock.timers.tick(4_000);
  assert.equal(f.store.value.map.exactPose, false);
  assert.equal(f.store.value.resources.pose.value, null);
  replacement.resolve(livePose({ position: [3, 4] }));
  await flush();
  assert.equal(f.store.value.map.exactPose, true);
  owner.clearPoseExpiry();
});

test("a replacement observation keeps its own deadline when the retained pose would have expired", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const replacement = deferred();
  let reads = 0;
  const owner = spatialOwner(f, () => ++reads === 1 ? Promise.resolve(livePose()) : replacement.promise);
  owner.admitCatalog(f.entry, null, true, false, false);
  await flush();
  t.mock.timers.tick(1_000);
  owner.admitCatalog(f.entry, f.entry, true, false, false);
  const current = livePose({ position: [5, 6] });
  replacement.resolve(current);
  await flush();
  t.mock.timers.tick(4_000);
  assert.equal(f.store.value.map.exactPose, true);
  assert.equal(f.store.value.resources.pose.value, current);
  t.mock.timers.tick(1_000);
  assert.equal(f.store.value.map.exactPose, false);
});

test("live trail restore backfills the latest verified pose and rejects owner changes", async () => {
  const f = fixture();
  f.store.patch({ activity: "cleaning", owner: { entryKey: "robot-a", userKey: "user-a" },
    trail: { id: "live", mapSessionKey: "session-a", segments: [[[0, 0]]], },
    resources: { ...f.store.value.resources, pose: { status: "ready", problem: null, value: livePose({ position: [1, 1] }) } } });
  const owner = new RunHistoryResources(f.store, {}, f.requests, { disposed: () => false, pageActive: () => true });
  const restore = owner.restoreLiveTrail();
  f.store.patch({ resources: { ...f.store.value.resources,
    pose: { status: "ready", problem: null, value: livePose({ position: [2, 2] }) } } });
  await restore;
  assert.deepEqual(f.store.value.trail.segments.at(-1).at(-1), [2, 2]);

  const staleRestore = owner.restoreLiveTrail();
  f.store.patch({ generation: f.store.value.generation + 1, owner: { entryKey: "robot-b", userKey: "other" } });
  await staleRestore;
  assert.deepEqual(f.store.value.trail.segments.at(-1).at(-1), [2, 2]);
  owner.dispose();
});

test("a forced catalog refresh cannot promote fallback, unknown-age or stale poses to exact", async () => {
  for (const retained of [
    livePose({ freshness: "coordinator_fallback" }),
    livePose({ nativeObservationAgeSeconds: null }),
    livePose({ nativeObservationAgeSeconds: 6 }),
  ]) {
    const f = fixture();
    let reads = 0;
    const owner = spatialOwner(f, () => ++reads === 1 ? Promise.resolve(retained) : new Promise(() => {}));
    owner.admitCatalog(f.entry, null, true, false, false);
    await flush();
    assert.equal(f.store.value.map.exactPose, false);
    owner.admitCatalog(f.entry, f.entry, true, false, false);
    await flush();
    assert.equal(f.store.value.resources.pose.value, retained);
    assert.equal(f.store.value.map.exactPose, false);
  }
});

const changeOwner = (f, userKey, entryId) => {
  const entry = entryFor({ entryId });
  f.store.patch({
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
    f.store.patch({
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
    if (retire === "leave") f.store.patch({ workflow: "none" });
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
  store.patch({ workflow: "rooms" });
  store.patch({ workflow: "none" });
  await flush();
  let publications = 0;
  const unsubscribe = store.subscribe(() => { publications += 1; });
  store.patch({ workflow: "rooms" });
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
  store.patch({
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
    if (retire === "leave") f.store.patch({ workflow: "none" });
    if (retire === "draft") f.store.patch({ planDraft: { ...f.store.value.planDraft, name: "Changed" } });
    if (retire === "generation") f.store.patch({ generation: f.store.value.generation + 1, command: "idle" });
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
    if (leave) f.store.patch({ workflow: "none" });
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
  f.store.patch({ command: "pending", pendingAction: "save-plan" });
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
      export { createGalleryState, withGalleryRoomPreview } from "./gallery-state";`, resolveDir, loader: "ts" },
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
        f.store.patch({ selection: { ...before.selection, roomIds: ["room-b"] } });
        f.store.patch({ selection: before.selection });
      }
      if (retire === "owner-aba") {
        f.store.patch({ owner: { ...before.owner, userKey: "another-owner" } });
        f.store.patch({ owner: before.owner });
      }
      if (retire === "entity-aba") {
        f.effects.sync({ ...f.projection, vacuumEntityId: "vacuum.replacement" });
        f.effects.sync(f.projection);
      }
      if (retire === "generation") f.store.patch({ generation: before.generation + 1 });
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
    f.store.patch({ manualRoomPreview: { ...resource, value: { ...resource.value, preview: {
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
