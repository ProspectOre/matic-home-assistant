import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const frontend = fileURLToPath(new URL("../../frontend/map-studio-v4", import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: 'export { WorkspaceStore, reduceWorkspace, canSelectRooms } from "./state"; export { isWorkspaceIntent } from "./contracts"; export { layerDepth } from "./layer-history"; export { createGalleryState } from "../map-studio-v4-review/gallery-state";',
    resolveDir: frontend, loader: "ts",
  }, bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
});
const { WorkspaceStore, reduceWorkspace, canSelectRooms, isWorkspaceIntent, layerDepth, createGalleryState } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

// Dispatches `intents` to a store holding the gallery scenario (with `patch`
// spread over it) and returns the fields the plan rules change.
const run = (scenario, intents, patch = {}) => {
  const store = new WorkspaceStore({ ...createGalleryState(scenario), ...patch });
  const before = store.value;
  for (const intent of intents) store.dispatch(intent);
  const state = store.value;
  return {
    unchanged: state === before,
    workflow: state.workflow,
    planView: state.planView,
    expandedRoom: state.expandedRoom,
    dialog: state.dialog,
    planId: state.selection.planId,
    draft: { id: state.planDraft.id, dirty: state.planDraft.dirty, enabled: state.planDraft.enabled,
      rooms: state.planDraft.rooms.map((room) => room.roomId), parked: state.planDraft.parkedRooms },
    selectedRooms: state.selection.roomIds,
  };
};
const has = (actual, expected) => assert.partialDeepStrictEqual(actual, expected);

test("a result replaces the fields it names and merges the nested objects", () => {
  const before = createGalleryState("ready");
  const pose = { status: "idle", value: null, problem: null };
  const after = reduceWorkspace(before, {
    type: "result", batteryPercent: 41, seen: undefined, resources: { pose }, map: { exactPose: false },
  });
  assert.equal(after.batteryPercent, 41);
  assert.equal(after.seen, undefined);
  assert.equal(after.resources.pose, pose);
  assert.equal(after.resources.scene, before.resources.scene);
  assert.deepEqual(after.map, { ...before.map, exactPose: false });
  // What a result does not name keeps its identity, so nothing redraws for it.
  assert.equal(after.floor, before.floor);
  assert.equal(after.selection, before.selection);
  assert.equal(after.planDraft, before.planDraft);
});

test("a transition also changes what the user has open", () => {
  const before = createGalleryState("plan-saved-intelligent");
  const after = reduceWorkspace(before, {
    type: "transition", workflow: "plans", precisionOpen: false, selection: { planId: null }, floor: { readOnly: true },
  });
  assert.equal(after.workflow, "plans");
  assert.deepEqual(after.selection, { ...before.selection, planId: null });
  assert.deepEqual(after.floor, { ...before.floor, readOnly: true });
  assert.equal(after.resources, before.resources);
});

test("a result passes the store's commit rules and is not an intent the page can send", () => {
  const store = new WorkspaceStore({ ...createGalleryState("ready"), followMode: "follow" });
  store.dispatch({ type: "result", dataMode: "history" });
  assert.equal(store.value.followMode, "off");
  assert.equal(isWorkspaceIntent({ type: "result", dataMode: "history" }), false);
  assert.equal(isWorkspaceIntent({ type: "transition", workflow: "plans" }), false);
});

test("only the store commits state", async () => {
  for (const name of await readdir(frontend)) {
    if (!name.endsWith(".ts")) continue;
    const source = await readFile(`${frontend}/${name}`, "utf8");
    assert.doesNotMatch(source, /\.patch\(|store\.replace\(/iu, name);
  }
});

test("dismisses dialog, precision, expanded map, and workflow one layer at a time", () => {
  let state = { ...createGalleryState("draw"), fullMap: true, precisionOpen: true, dialog: "discardDraft" };
  const layers = [];
  for (let index = 0; index < 4; index += 1) {
    state = reduceWorkspace(state, { type: "dismiss-top-layer" });
    layers.push({ dialog: state.dialog, precision: state.precisionOpen, fullMap: state.fullMap, workflow: state.workflow });
  }
  assert.deepEqual(layers, [
    { dialog: null, precision: true, fullMap: true, workflow: "draw" },
    { dialog: null, precision: false, fullMap: true, workflow: "draw" },
    { dialog: null, precision: false, fullMap: false, workflow: "draw" },
    { dialog: "discardDraft", precision: false, fullMap: false, workflow: "draw" },
  ]);
});

test("opens History without hiding the live map and preserves a chosen saved map", () => {
  const opened = reduceWorkspace(createGalleryState("ready"), { type: "open-workflow", workflow: "history" });
  const saved = { ...opened, dataMode: "history", selection: { ...opened.selection, floorId: "saved-floor", historyId: "saved-map" } };
  const closed = reduceWorkspace(saved, { type: "dismiss-top-layer" });
  assert.deepEqual([opened.dataMode, opened.workflow], ["live", "history"]);
  assert.deepEqual([closed.dataMode, closed.workflow, closed.selection.historyId], ["history", "none", "saved-map"]);
});

// home-rooms.md §5 Cards D1; plan.md §5 State.
test("a plan opened from home returns to home, one opened from the picker returns to the picker", () => {
  const store = new WorkspaceStore(createGalleryState("ready"));
  store.dispatch({ type: "select-plan", planId: "daily", origin: "home" });
  assert.deepEqual([store.value.planOrigin, store.value.planView, store.value.workflow], ["home", "run", "plan"]);
  store.dispatch({ type: "select-plan", planId: "daily" });
  assert.equal(store.value.planOrigin, "home");
  store.dispatch({ type: "set-plan-view", view: "edit" });
  store.dispatch({ type: "dismiss-top-layer" });
  assert.deepEqual([store.value.planView, store.value.planOrigin], ["run", "home"]);
  store.dispatch({ type: "dismiss-top-layer" });
  assert.deepEqual([store.value.workflow, store.value.planOrigin], ["none", "plans"]);
  store.dispatch({ type: "open-workflow", workflow: "plans" });
  store.dispatch({ type: "select-plan", planId: "daily" });
  assert.equal(store.value.planOrigin, "plans");
  store.dispatch({ type: "dismiss-top-layer" });
  assert.equal(store.value.workflow, "plans");
  store.dispatch({ type: "open-workflow", workflow: "none" });
  store.dispatch({ type: "select-plan", planId: "daily" });
  assert.equal(store.value.planOrigin, "plans");
});

// home-rooms.md §5 Settings, Selection gate.
test("a whole-clean change becomes the default and rewrites every selected room", () => {
  const store = new WorkspaceStore(createGalleryState("rooms"));
  store.dispatch({ type: "set-clean-settings", cleaningMode: "vacuum_and_mop" });
  store.dispatch({ type: "set-clean-settings", coverageSetting: "quick" });
  store.dispatch({ type: "toggle-room", roomId: "room-a" });
  assert.deepEqual(store.value.selection.roomSettings.find((room) => room.roomId === "room-a"),
    { roomId: "room-a", cleaningMode: "vacuum_and_mop", coverageSetting: "quick" });
  store.dispatch({ type: "toggle-room", roomId: "room-b" });
  store.dispatch({ type: "patch-room-settings", roomId: "room-b", cleaningMode: "mop" });
  store.dispatch({ type: "set-clean-settings", coverageSetting: "heavy_duty" });
  assert.deepEqual(store.value.selection.roomSettings.map((room) => [room.roomId, room.cleaningMode, room.coverageSetting]), [
    ["room-a", "vacuum_and_mop", "heavy_duty"],
    ["room-b", "vacuum_and_mop", "heavy_duty"],
  ]);
  store.dispatch({ type: "clear-selection" });
  const { roomIds, cleaningMode, coverageSetting } = store.value.selection;
  assert.deepEqual([roomIds.length, cleaningMode, coverageSetting], [0, "vacuum_and_mop", "heavy_duty"]);
});

test("every rooms intent is refused while the selection is locked", () => {
  const base = createGalleryState("rooms");
  const locked = {
    ...base,
    activity: "cleaning",
    selection: {
      ...base.selection,
      roomIds: ["room-a", "room-b"],
      roomSettings: [
        { roomId: "room-a", cleaningMode: "vacuum", coverageSetting: "standard" },
        { roomId: "room-b", cleaningMode: "vacuum", coverageSetting: "standard" },
      ],
    },
  };
  assert.equal(canSelectRooms(locked), false);
  const store = new WorkspaceStore(locked);
  for (const intent of [
    { type: "toggle-room", roomId: "room-c" },
    { type: "toggle-room", roomId: "room-a" },
    { type: "patch-room-settings", roomId: "room-a", cleaningMode: "mop" },
    { type: "set-clean-settings", cleaningMode: "mop", coverageSetting: "quick" },
    { type: "set-use-room-schedule", value: false },
    { type: "clear-selection" },
  ]) {
    store.dispatch(intent);
    assert.deepEqual(store.value.selection, locked.selection, intent.type);
  }
});

test("a refused add at the limit raises the limit notice", () => {
  const store = new WorkspaceStore(createGalleryState("room-limit"));
  store.dispatch({ type: "toggle-room", roomId: "room-extra" });
  assert.equal(store.value.selection.roomIds.length, 100);
  has(store.value.notice, { tone: "info", key: "v4_room_limit_reached", placeholders: { limit: 100 } });
});

// plan.md §5 State, Map, Navigation; home-rooms.md §5 selection gate.
test("the plan starts in Run with nothing pending and no open row", () => {
  const { planView, pendingAction, expandedRoom, planDraft } = new WorkspaceStore().value;
  assert.deepEqual({ planView, pendingAction, expandedRoom, parked: planDraft.parkedRooms },
    { planView: "run", pendingAction: null, expandedRoom: null, parked: [] });
});

test("select-plan opens Create in Edit and a saved plan in Run", () => {
  has(run("plans", [{ type: "select-plan", planId: null }]), { workflow: "plan", planView: "edit", expandedRoom: null, planId: null });
  has(run("plans", [{ type: "select-plan", planId: "weekend" }]), { workflow: "plan", planView: "run", expandedRoom: null, planId: "weekend" });
  // Entering the plan workflow opens Run even for the plan already selected.
  has(run("plans", [{ type: "select-plan", planId: "daily" }]), { workflow: "plan", planView: "run", planId: "daily" });
  // Another saved plan from an open Edit opens in Run and closes the row.
  has(run("plans", [
    { type: "select-plan", planId: "daily" },
    { type: "set-plan-view", view: "edit", roomId: "room-a" },
    { type: "select-plan", planId: "weekend" },
  ]), { workflow: "plan", planView: "run", expandedRoom: null, planId: "weekend" });
});

test("reselecting the open plan keeps its view and open row", () => {
  has(run("plan-saved-intelligent", [
    { type: "set-plan-view", view: "edit", roomId: "room-b" },
    { type: "select-plan", planId: "daily" },
  ]), { workflow: "plan", planView: "edit", expandedRoom: "room-b", planId: "daily" });
});

test("leaving the plan workflow resets the view, Try again keeps it", () => {
  const edit = { type: "set-plan-view", view: "edit", roomId: "room-a" };
  has(run("plan-saved-intelligent", [edit, { type: "open-workflow", workflow: "rooms" }]), { workflow: "rooms", planView: "run", expandedRoom: null });
  has(run("plan-saved-intelligent", [edit, { type: "open-workflow", workflow: "plan" }]), { workflow: "plan", planView: "edit", expandedRoom: "room-a" });
  has(run("plan-saved-intelligent", [edit, { type: "return-live" }]), { workflow: "none", planView: "run", expandedRoom: null });
});

test("set-plan-view edit opens, keeps or closes the room row", () => {
  const open = { type: "set-plan-view", view: "edit", roomId: "room-a" };
  has(run("plan-saved-intelligent", [open]), { planView: "edit", expandedRoom: "room-a" });
  has(run("plan-saved-intelligent", [open, { type: "set-plan-view", view: "edit" }]), { planView: "edit", expandedRoom: "room-a" });
  has(run("plan-saved-intelligent", [open, { type: "set-plan-view", view: "edit", roomId: null }]), { planView: "edit", expandedRoom: null });
  has(run("plans", [open]), { unchanged: true, workflow: "plans" });
});

test("set-plan-view run needs a saved, clean draft", () => {
  has(run("plan-saved-intelligent", [
    { type: "set-plan-view", view: "edit", roomId: "room-a" },
    { type: "set-plan-view", view: "run" },
  ]), { planView: "run", expandedRoom: null });
  has(run("plan-dirty", [{ type: "set-plan-view", view: "run" }]), { unchanged: true, planView: "edit" });
  has(run("plan-new", [{ type: "set-plan-view", view: "run" }]), { unchanged: true, planView: "edit" });
});

test("set-plan-enabled reflects the Run switch on a saved, clean draft only", () => {
  const off = [{ type: "set-plan-enabled", enabled: false }];
  has(run("plan-saved-intelligent", off), { planView: "run", draft: { id: "daily", enabled: false, dirty: false } });
  for (const scenario of ["plan-dirty", "plan-cadence-shared", "plan-new", "plans"]) has(run(scenario, off), { unchanged: true });
});

test("discarding returns a saved plan to Run and a new plan to the picker", () => {
  has(run("plan-dirty", [
    { type: "set-plan-view", view: "edit", roomId: "room-a" },
    { type: "open-dialog", dialog: "discardDraft" },
    { type: "discard-draft" },
  ]), { workflow: "plan", planView: "run", expandedRoom: null, dialog: null, planId: "daily",
    draft: { id: "daily", dirty: false, rooms: ["room-a", "room-b", "room-c"], parked: [] } });
  has(run("plan-new", [{ type: "toggle-room", roomId: "room-a" }, { type: "discard-draft" }]),
    { workflow: "plans", planView: "run", dialog: null, planId: null, draft: { id: null, dirty: false, rooms: [] } });
  // A saved plan the catalog no longer holds has no Run view to return to.
  const state = createGalleryState("plan-dirty");
  has(run("plan-dirty", [{ type: "discard-draft" }], { resources: { ...state.resources,
    plans: { ...state.resources.plans, value: { ...state.resources.plans.value, plans: [] } } } }),
  { workflow: "plans", planView: "run", planId: null, draft: { id: null, dirty: false } });
});

test("dismissing steps Edit to Run, then Run or a new plan to the picker", () => {
  const dismiss = { type: "dismiss-top-layer" };
  has(run("plan-saved-intelligent", [{ type: "set-plan-view", view: "edit", roomId: "room-a" }, dismiss]), { workflow: "plan", planView: "run", expandedRoom: null });
  has(run("plan-saved-intelligent", [dismiss]), { workflow: "plans", planView: "run" });
  has(run("plan-new", [dismiss]), { workflow: "plans", planView: "run" });
  has(run("plan-dirty", [dismiss]), { workflow: "plan", planView: "edit", dialog: "discardDraft" });
  has(run("plans", [dismiss]), { workflow: "none" });
});

test("map taps never change the plan in Run", () => {
  has(run("plan-saved-intelligent", [{ type: "toggle-room", roomId: "room-d" }]), { unchanged: true });
});

test("unticking a room in Edit parks its settings until it is ticked again", () => {
  const parked = run("plan-cadence-shared", [{ type: "toggle-room", roomId: "room-a" }]);
  assert.deepEqual(parked.draft.rooms, ["room-b", "room-c"]);
  assert.deepEqual(parked.draft.parked.map((room) => room.roomId), ["room-a"]);
  assert.ok(parked.draft.parked[0].cadence);
  const store = new WorkspaceStore(createGalleryState("plan-cadence-shared"));
  const saved = store.value.planDraft.rooms[0];
  for (const roomId of ["room-b", "room-a", "room-a", "room-d"]) store.dispatch({ type: "toggle-room", roomId });
  const { rooms, parkedRooms, dirty } = store.value.planDraft;
  assert.deepEqual([parkedRooms.map((room) => room.roomId), dirty], [["room-b"], true]);
  assert.deepEqual(rooms[1], saved);
  assert.deepEqual(rooms.map((room) => room.roomId), ["room-c", "room-a", "room-d"]);
  assert.deepEqual(rooms[2], { roomId: "room-d", cleaningMode: "vacuum", coverageSetting: "standard" });
});

test("the plan room limit still refuses a new room in Edit", () => {
  has(run("plan-legacy-oversized", [{ type: "toggle-room", roomId: "room-extra" }]), { unchanged: true });
});

test("Rooms selection waits for an editable map with no robot work to stop", () => {
  const toggle = [{ type: "open-workflow", workflow: "rooms" }, { type: "toggle-room", roomId: "room-a" }];
  assert.deepEqual(run("ready", toggle).selectedRooms, ["room-a"]);
  assert.deepEqual(run("ready", toggle, { activity: "cleaning" }).selectedRooms, []);
  assert.deepEqual(run("ready", toggle, { coherence: "degraded" }).selectedRooms, []);
});

test("layerDepth puts Run and a new plan's Edit under a saved plan's Edit", () => {
  assert.deepEqual(["ready", "plans", "plan-saved-intelligent", "plan-new", "plan-dirty"]
    .map((scenario) => layerDepth(createGalleryState(scenario))), [0, 1, 2, 2, 3]);
});
