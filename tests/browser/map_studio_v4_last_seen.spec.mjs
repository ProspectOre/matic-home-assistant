import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("last-seen trail annotations require the latest finished run and a matching map session", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { parseRunHistory, parseRunTrail, lastSeenDuringLatestRun } from "./frontend/map-studio-v4/run-history-data"; export { initialWorkspaceState, canFollowRobot } from "./frontend/map-studio-v4/state"; export { canShowLastSeenDuringRun, drawLastSeenDuringRun } from "./frontend/map-studio-v4/renderer-layers"; export { describeMap } from "./frontend/map-studio-v4/map-canvas";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/last-seen.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { parseRunHistory, parseRunTrail, lastSeenDuringLatestRun,
      initialWorkspaceState, canShowLastSeenDuringRun, canFollowRobot, drawLastSeenDuringRun, describeMap } = await import("/last-seen.js");
    const session = "a".repeat(64);
    const history = parseRunHistory({
      entry_id: "entry", map_session_key: session, robot_history: true,
      runs: [{ id: "done", source: "robot", started_at: "2026-11-01T10:00:00Z",
        ended_at: "2026-11-01T10:30:00Z", plan_name: null, outcome: "finished", ending: "finished",
        rooms: [], areas: [], trail: "trail-1", thumbnail: null }],
    });
    const trail = parseRunTrail({ trail: "trail-1", map_session_key: session,
      segments: [[], [[1.25, 2.5]]] });
    const marker = lastSeenDuringLatestRun(history, trail, "entry", session);
    const base = initialWorkspaceState();
    const state = {
      ...base, pageActive: true, activity: "docked", dataMode: "live", coherence: "current",
      selection: { ...base.selection, entryId: "entry", floorId: "current" },
      map: { ...base.map, available: true, floorCoherent: true, sessionVerified: true, exactPose: false },
      host: { ...base.host, connected: true, administrator: true, robotConnected: true },
      seen: marker,
      resources: { ...base.resources,
        entry: { entryId: "entry", mapSessionKey: session, mapFloorCoherent: true, mapSessionVerified: true },
        pose: { status: "ready", value: { position: null, mapSessionKey: session, freshness: "live" }, problem: null },
      },
    };
    const isDisplayable = canShowLastSeenDuringRun(state);
    const canFollowFromHistorical = canFollowRobot(state, "follow");
    const canRideFromHistorical = canFollowRobot(state, "ride");
    const accessibleDescription = describeMap(state, (key) => key.endsWith("v4_robot_last_seen")
      ? "Last clean: last seen" : key);
    const canvasLabels = [];
    const context = { canvas: { parentElement: null }, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
      closePath() {}, setLineDash() {}, stroke() {}, strokeText(text) { canvasLabels.push(text); },
      fillText(text) { canvasLabels.push(text); } };
    drawLastSeenDuringRun(context, state,
    { text: [0, 0, 0], onAccent: [255, 255, 255] }, () => ({ x: 100, y: 100 }));
    const wrongSession = lastSeenDuringLatestRun(history, trail, "entry", "b".repeat(64));
    const wrongEntry = lastSeenDuringLatestRun(history, trail, "other-entry", session);
    const emptyTrail = parseRunTrail({ trail: "trail-1", map_session_key: session, segments: [[], []] });
    const emptyMarker = lastSeenDuringLatestRun(history, emptyTrail, "entry", session);
    const newerRunning = parseRunHistory({
      entry_id: "entry", map_session_key: session, robot_history: true,
      runs: [{ ...history.runs[0], id: "new", started_at: "2026-11-02T10:00:00Z",
        ended_at: null, outcome: "running", ending: "running", trail: null },
      { ...history.runs[0], id: "done", started_at: "2026-11-01T10:00:00Z",
        ended_at: "2026-11-01T10:30:00Z", outcome: "finished", ending: "finished", trail: "trail-1" }],
    });
    const staleAfterNewerRun = lastSeenDuringLatestRun(newerRunning, trail, "entry", session);
    const newerUnknown = parseRunHistory({
      entry_id: "entry", map_session_key: session, robot_history: true,
      runs: [{ ...history.runs[0], id: "unknown", started_at: "2026-11-02T10:00:00Z",
        ended_at: null, outcome: "unknown", ending: "unknown", trail: null },
      { ...history.runs[0], id: "done", started_at: "2026-11-01T10:00:00Z",
        ended_at: "2026-11-01T10:30:00Z", outcome: "finished", ending: "finished", trail: "trail-1" }],
    });
    const staleAfterUnknown = lastSeenDuringLatestRun(newerUnknown, trail, "entry", session);
    const ambiguousHistory = parseRunHistory({
      entry_id: "entry", map_session_key: session, robot_history: true,
      runs: [{ ...history.runs[0], id: "ambiguous", started_at: "not-a-date",
        ended_at: null, outcome: "unknown", ending: "unknown", trail: null }],
    });
    const staleAfterAmbiguous = lastSeenDuringLatestRun(ambiguousHistory, trail, "entry", session);
    const liveState = {
      ...state, map: { ...state.map, exactPose: true },
      resources: { ...state.resources, scene: { status: "ready", value: { source: "live" }, problem: null }, pose: { status: "ready",
        value: { position: [3, 4], mapSessionKey: session, freshness: "live", floorCoherent: true, heading: 0 }, problem: null } },
    };
    const liveAccessibleDescription = describeMap(liveState);
    return {
      marker, isDisplayable, canFollowFromHistorical, canRideFromHistorical,
      accessibleDescription,
      liveAccessibleDescription,
      canvasLabels,
      wrongSession, wrongEntry, emptyMarker, staleAfterNewerRun,
      staleAfterUnknown, staleAfterAmbiguous,
      wrongFloorHidden: !canShowLastSeenDuringRun({ ...state,
        selection: { ...state.selection, floorId: "2" } }),
      staleHiddenWhenFreshLive: !canShowLastSeenDuringRun(liveState),
      liveFollowWorks: canFollowRobot(liveState, "follow"),
    };
  });
  expect(result.marker).toEqual({ entryId: "entry", mapSessionKey: "a".repeat(64), position: [1.25, 2.5] });
  expect(result.isDisplayable).toBe(true);
  expect(result.accessibleDescription).toContain("Last clean: last seen");
  expect(result.liveAccessibleDescription).not.toContain("Last seen during last clean");
  expect(result.canvasLabels).toEqual(["Last seen during last clean", "Last seen during last clean"]);
  expect(result.canFollowFromHistorical).toBe(false);
  expect(result.canRideFromHistorical).toBe(false);
  expect(result.wrongSession).toBeNull();
  expect(result.wrongEntry).toBeNull();
  expect(result.emptyMarker).toBeNull();
  expect(result.staleAfterNewerRun).toBeNull();
  expect(result.staleAfterUnknown).toBeNull();
  expect(result.staleAfterAmbiguous).toBeNull();
  expect(result.wrongFloorHidden).toBe(true);
  expect(result.staleHiddenWhenFreshLive).toBe(true);
  expect(result.liveFollowWorks).toBe(true);
});

test("last-seen history read is revoked when map identity becomes unverified", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RunHistoryResources } from "./frontend/map-studio-v4/run-history-resources"; export { initialWorkspaceState, WorkspaceStore } from "./frontend/map-studio-v4/state"; export { ResourceRequests } from "./frontend/map-studio-v4/resource-requests";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/revoked-seen.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { RunHistoryResources, initialWorkspaceState, WorkspaceStore, ResourceRequests } = await import("/revoked-seen.js");
    const session = "b".repeat(64);
    const base = initialWorkspaceState();
    const state = {
      ...base, pageActive: true, activity: "docked", coherence: "current",
      selection: { ...base.selection, entryId: "entry", floorId: "current" },
      map: { ...base.map, available: true, floorCoherent: true, sessionVerified: true, exactPose: false },
      host: { ...base.host, connected: true, robotConnected: true },
      resources: { ...base.resources,
        entry: { entryId: "entry", mapSessionKey: session, mapFloorCoherent: true, mapSessionVerified: true },
        pose: { status: "ready", value: { position: null, mapSessionKey: session, freshness: "live" }, problem: null },
      },
    };
    const store = new WorkspaceStore(state);
    let requestStarted;
    const started = new Promise((resolve) => { requestStarted = resolve; });
    let finishHistory;
    const historyResponse = new Promise((resolve) => { finishHistory = resolve; });
    let trailReads = 0;
    const history = { entry_id: "entry", map_session_key: session, robot_history: true,
      runs: [{ id: "done", source: "robot", started_at: "2026-11-01T10:00:00Z", ended_at: "2026-11-01T10:30:00Z",
        plan_name: null, outcome: "finished", ending: "finished", rooms: [], areas: [], trail: "trail-1", thumbnail: null }] };
    const backend = { runs: async (_entry, trail) => {
      if (trail) { trailReads += 1; return { trail: "trail-1", map_session_key: session, segments: [[[1, 2]]] }; }
      requestStarted(); return historyResponse;
    } };
    const resources = new RunHistoryResources(store, backend, new ResourceRequests(), { disposed: () => false, pageActive: () => true });
    await started;
    store.patch({ resources: { ...store.value.resources,
      entry: { ...store.value.resources.entry, mapSessionVerified: false } } });
    finishHistory(history);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const seen = store.value.seen ?? null;
    resources.dispose();

    const poseStore = new WorkspaceStore(state);
    let poseRequestStarted;
    const poseStarted = new Promise((resolve) => { poseRequestStarted = resolve; });
    let finishPoseHistory;
    const poseHistoryResponse = new Promise((resolve) => { finishPoseHistory = resolve; });
    let poseTrailReads = 0;
    const poseBackend = { runs: async (_entry, trail) => {
      if (trail) { poseTrailReads += 1; return { trail: "trail-1", map_session_key: session, segments: [[[1, 2]]] }; }
      poseRequestStarted(); return poseHistoryResponse;
    } };
    const poseResources = new RunHistoryResources(poseStore, poseBackend, new ResourceRequests(),
      { disposed: () => false, pageActive: () => true });
    await poseStarted;
    poseStore.patch({ resources: { ...poseStore.value.resources,
      pose: { ...poseStore.value.resources.pose, value: { ...poseStore.value.resources.pose.value, mapSessionKey: "c".repeat(64) } } } });
    finishPoseHistory(history);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const seenAfterPoseSessionChange = poseStore.value.seen ?? null;
    poseResources.dispose();
    return { seen, trailReads, seenAfterPoseSessionChange, poseTrailReads };
  });
  expect(result.seen).toBeNull();
  expect(result.trailReads).toBe(0);
  expect(result.seenAfterPoseSessionChange).toBeNull();
  expect(result.poseTrailReads).toBe(0);
});

for (const pose of [null, [9, 9]]) {
test(`visible initial map loads the historical marker without a visibility transition (${pose ? "stale pose" : "no pose"})`, async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { EffectController } from "./frontend/map-studio-v4/effects"; export { initialWorkspaceState, WorkspaceStore } from "./frontend/map-studio-v4/state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/initial-seen.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async (pose) => {
    const { EffectController, initialWorkspaceState, WorkspaceStore } = await import("/initial-seen.js");
    const session = "d".repeat(64);
    const base = initialWorkspaceState();
    const state = {
      ...base, pageActive: true, activity: "docked", dataMode: "live", coherence: "current",
      selection: { ...base.selection, entryId: "entry", floorId: "current" },
      map: { ...base.map, available: true, floorCoherent: true, sessionVerified: true, exactPose: false },
      host: { ...base.host, connected: true, administrator: true, robotConnected: true, robotCount: 1 },
      owner: { userKey: "user", entryKey: "entry" },
      resources: { ...base.resources,
        entry: { entryId: "entry", mapSessionKey: session, mapFloorCoherent: true, mapSessionVerified: true },
        scene: { status: "ready", value: { source: "live" }, problem: null },
        pose: { status: "ready", value: { position: pose, mapSessionKey: session, freshness: "live",
          nativeObservationAgeSeconds: null }, problem: null },
      },
    };
    const history = { entry_id: "entry", map_session_key: session, robot_history: true,
      runs: [{ id: "done", source: "robot", started_at: "2026-11-01T10:00:00Z", ended_at: "2026-11-01T10:30:00Z",
        plan_name: null, outcome: "finished", ending: "finished", rooms: [], areas: [], trail: "trail-1", thumbnail: null }] };
    const reads = [];
    const backend = { dispose() {}, runs: async (_entry, trail) => {
      reads.push(trail ?? "history");
      return trail
        ? { trail: "trail-1", map_session_key: session, segments: [[[1.25, 2.5]]] }
        : history;
    } };
    const store = new WorkspaceStore(state);
    const controller = new EffectController(store, backend);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const result = { visible: document.visibilityState === "visible", reads, seen: store.value.seen ?? null };
    controller.dispose();
    return result;
  });
  expect(result.visible).toBe(true);
  expect(result.reads).toEqual(["history", "trail-1"]);
  expect(result.seen).toEqual({ entryId: "entry", mapSessionKey: "d".repeat(64), position: [1.25, 2.5] });
});
}
