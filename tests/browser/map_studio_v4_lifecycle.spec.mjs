import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const modulePath = "/panel-lifecycle-test.js";

async function loadPanelModule(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { MATIC_MAP_PANEL_TAG } from "./frontend/map-studio-v4/panel";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route(`**${modulePath}`, route => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
}

function syntheticScene() {
  const metadata = Buffer.from(JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: [10, 10],
    sample_step: 1,
    rooms: [],
  }));
  const bytes = Buffer.alloc(24 + metadata.length + 8);
  bytes.write("MATIC3D\0", 0, "binary");
  bytes.writeUInt16LE(1, 8);
  bytes.writeUInt16LE(8, 10);
  bytes.writeUInt32LE(metadata.length, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(0, 20);
  metadata.copy(bytes, 24);
  return [...bytes];
}

test("20 admitted panel lifecycles release resources and ignore late history scenes", async ({ page }) => {
  await page.addInitScript(() => {
    window.__life = { workersCreated: 0, workersTerminated: 0, urlsCreated: 0, urlsRevoked: 0 };
    window.__lateHistoryScenes = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        window.__life.workersCreated += 1;
      }
      terminate() {
        window.__life.workersTerminated += 1;
        super.terminate();
      }
    };
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      window.__life.urlsCreated += 1;
      return createObjectURL(blob);
    };
    URL.revokeObjectURL = url => {
      window.__life.urlsRevoked += 1;
      revokeObjectURL(url);
    };
    const activePopstate = new Set();
    window.__activePanelPopstateCount = () => activePopstate.size;
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (this === window && type === "popstate" && listener) activePopstate.add(listener);
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (this === window && type === "popstate" && listener) activePopstate.delete(listener);
      return remove.call(this, type, listener, options);
    };
  });
  await loadPanelModule(page);

  const result = await page.evaluate(async ({ module, sceneBytes }) => {
    const { MATIC_MAP_PANEL_TAG } = await import(module);
    await customElements.whenDefined(MATIC_MAP_PANEL_TAG);
    const sceneBuffer = new Uint8Array(sceneBytes);
    const json = (body, headers = {}) => new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json", ...headers },
    });
    const catalog = {
      entries: [{
        entry_id: "synthetic-entry",
        scene_url: "/api/matic_robot/slam_scene/synthetic",
        pose_url: "/api/matic_robot/slam_pose/synthetic",
        history_url: "/api/matic_robot/slam_history/synthetic",
        areas_url: "/api/matic_robot/areas/synthetic",
        plans_url: "/api/matic_robot/plans/synthetic",
        map_revision: 7,
        map_floor_coherent: true,
        map_session_verified: true,
        map_session_key: "a".repeat(64),
        map_complete: true,
        map_truncated: false,
        selected_floor_ordinal: 1,
        map_floor_ordinal: 1,
        history_count: 1,
        history_floor_count: 2,
        map_health: "ready",
        stream_failures: 0,
        bootstrap_state: "complete",
        bootstrap_photo_seen: true,
        bootstrap_structure_seen: true,
        bootstrap_failures: 0,
        runner_locked: false,
        stop_settle_pending: false,
        active_plan: false,
        native_reconciliation_pending: false,
        native_session_active: false,
      }],
    };
    const history = {
      entry_id: "synthetic-entry",
      live_available: true,
      floors: [
        { id: "current", active: true, read_only: false, live_available: true, label: "Home", ordinal: null, snapshots: [] },
        { id: "saved-1", active: false, read_only: true, live_available: false, label: "Loft", ordinal: 2,
          snapshots: [{ id: "saved-shot", created_at: "2026-09-25T12:00:00Z", revision: 6, point_count: 1, scene_url: "/api/matic_robot/slam_scene/history" }] },
      ],
    };
    const pose = { position: [1, 1], source: "latest_pose", revision: 7, pose_revision: 1, map_floor_coherent: true, map_session_key: "a".repeat(64), pose_freshness: "live" };
    const areas = { scene_url: catalog.entries[0].scene_url, rooms: [], areas: [] };
    const plans = { rooms: [], plans: [], selected_plan: null };
    const fetchWithAuth = async path => {
      if (path.endsWith("slam_entries")) return json(catalog);
      if (path.endsWith("slam_history/synthetic")) return json(history);
      if (path.endsWith("slam_pose/synthetic")) return json(pose);
      if (path.endsWith("areas/synthetic")) return json(areas);
      if (path.endsWith("plans/synthetic")) return json(plans);
      if (path.endsWith("slam_scene/history")) {
        return new Promise(resolve => window.__lateHistoryScenes.push(() => resolve(new Response(sceneBuffer, {
          headers: { "Content-Type": "application/vnd.matic.slam-scene", "X-Matic-Revision": "6" },
        }))));
      }
      if (path.endsWith("slam_scene/synthetic")) return new Response(sceneBuffer.slice(), {
        headers: { "Content-Type": "application/vnd.matic.slam-scene", "X-Matic-Revision": "7" },
      });
      throw new Error(`unexpected synthetic request: ${path}`);
    };
    const waitFor = async (predicate, label) => {
      for (let attempt = 0; attempt < 2_000; attempt += 1) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      throw new Error(`panel state did not reach ${label}`);
    };
    const send = (shell, detail) => shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail, bubbles: true, composed: true,
    }));

    let resolvedHistoryScenes = 0;
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const panel = document.createElement(MATIC_MAP_PANEL_TAG);
      panel.panel = { config: {} };
      panel.hass = {
        connected: true,
        user: { id: "synthetic-user", is_admin: true },
        states: { "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry" } } },
        fetchWithAuth,
      };
      document.body.append(panel);
      await panel.updateComplete;
      await waitFor(() => panel.getWorkspaceSnapshot().resources.scene.status === "ready", "initial live scene");
      if (window.__activePanelPopstateCount() !== 1) throw new Error("mounted panel did not own exactly one popstate listener");
      const shell = panel.shadowRoot.querySelector("matic-map-shell-v4");

      send(shell, { type: "open-workflow", workflow: "plans" });
      await waitFor(() => panel.getWorkspaceSnapshot().workflow === "plans"
        && panel.getWorkspaceSnapshot().resources.plans.status === "ready", "plans workflow");
      send(shell, { type: "open-workflow", workflow: "draw" });
      await waitFor(() => panel.getWorkspaceSnapshot().workflow === "draw"
        && panel.getWorkspaceSnapshot().resources.areas.status === "ready", "draw workflow");
      send(shell, { type: "open-workflow", workflow: "history" });
      await waitFor(() => panel.getWorkspaceSnapshot().workflow === "history"
        && panel.getWorkspaceSnapshot().resources.history.status === "ready", "history workflow");
      // Opening history selects its current snapshot, so settle that admitted
      // request before starting the intentionally late saved-floor request.
      while (resolvedHistoryScenes < window.__lateHistoryScenes.length) {
        window.__lateHistoryScenes[resolvedHistoryScenes++]();
      }
      await waitFor(() => panel.getWorkspaceSnapshot().resources.scene.status === "ready", "history workflow scene");
      const savedFloorResponseIndex = window.__lateHistoryScenes.length;
      send(shell, { type: "set-floor", floorId: "saved-1" });
      await waitFor(() => panel.getWorkspaceSnapshot().selection.floorId === "saved-1"
        && panel.getWorkspaceSnapshot().dataMode === "history"
        && panel.getWorkspaceSnapshot().resources.scene.status === "loading"
        && window.__lateHistoryScenes.length > savedFloorResponseIndex, "saved floor scene request");

      panel.remove();
      await panel.updateComplete;
      if (window.__activePanelPopstateCount() !== 0) throw new Error("panel popstate listener survived detach");
      // Disposal may legitimately normalize transient preview state; use the
      // post-disposal snapshot so the following assertion isolates only the
      // response that was left pending for this saved floor.
      const disposedState = panel.getWorkspaceSnapshot();
      window.__lateHistoryScenes[savedFloorResponseIndex]();
      resolvedHistoryScenes = savedFloorResponseIndex + 1;
      await new Promise(resolve => setTimeout(resolve, 0));
      if (panel.getWorkspaceSnapshot() !== disposedState
        || panel.getWorkspaceSnapshot().selection.floorId !== "saved-1"
        || panel.getWorkspaceSnapshot().resources.scene.status !== "loading") {
        throw new Error("late history response revived a detached panel");
      }
    }
    return {
      workersCreated: window.__life.workersCreated,
      workersTerminated: window.__life.workersTerminated,
      urlsCreated: window.__life.urlsCreated,
      urlsRevoked: window.__life.urlsRevoked,
      activePopstateListeners: window.__activePanelPopstateCount(),
      lateHistoryResponses: window.__lateHistoryScenes.length,
    };
  }, { module: modulePath, sceneBytes: syntheticScene() });

  expect(result).toEqual({
    workersCreated: 20,
    workersTerminated: 20,
    urlsCreated: 20,
    urlsRevoked: 20,
    activePopstateListeners: 0,
    lateHistoryResponses: 40,
  });
});
