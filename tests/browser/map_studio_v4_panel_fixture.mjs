import { build } from "esbuild";

const PANEL_MODULE = "/panel-fixture-test.js";

function sceneBytes() {
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
  metadata.copy(bytes, 24);
  return [...bytes];
}

const emptyPlans = { rooms: [], plans: [], selected_plan: null };

export async function installPanelFixture(page, {
  initialPlanCatalog = emptyPlans,
  moduleSource = "typescript",
} = {}) {
  const modulePath = moduleSource === "packaged" ? "/map_studio_v4/index.js" : PANEL_MODULE;
  const bundle = moduleSource === "typescript" ? await build({
    stdin: {
      contents: 'export { MATIC_MAP_PANEL_TAG } from "./frontend/map-studio-v4/panel";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  }) : null;
  await page.addInitScript(() => {
    window.__panelFixtureResources = {
      workersCreated: 0, workersTerminated: 0, urlsCreated: 0, urlsRevoked: 0,
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        window.__panelFixtureResources.workersCreated += 1;
      }
      terminate() {
        window.__panelFixtureResources.workersTerminated += 1;
        super.terminate();
      }
    };
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      window.__panelFixtureResources.urlsCreated += 1;
      return createObjectURL(blob);
    };
    URL.revokeObjectURL = (url) => {
      window.__panelFixtureResources.urlsRevoked += 1;
      revokeObjectURL(url);
    };
    const activePopstate = new Set();
    window.__panelFixturePopstateCount = () => activePopstate.size;
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
  if (bundle) {
    await page.route(`**${PANEL_MODULE}`, (route) => route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }));
  }
  await page.goto("/");
  await page.evaluate(async ({ module, scenes, plans }) => {
    const { MATIC_MAP_PANEL_TAG } = await import(module);
    const json = (body, headers = {}) => new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json", ...headers },
    });
    const catalog = { entries: [{
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
    }] };
    const history = { entry_id: "synthetic-entry", live_available: true, floors: [
      { id: "current", active: true, read_only: false, live_available: true, label: "Home", ordinal: null, snapshots: [] },
      { id: "saved-1", active: false, read_only: true, live_available: false, label: "Loft", ordinal: 2,
        snapshots: [{ id: "saved-shot", created_at: "2026-09-25T12:00:00Z", revision: 6, point_count: 1,
          scene_url: "/api/matic_robot/slam_scene/history" }] },
    ] };
    const pose = { position: [1, 1], source: "latest_pose", revision: 7, pose_revision: 1,
      map_floor_coherent: true, map_session_key: "a".repeat(64), pose_freshness: "live" };
    const areas = { scene_url: catalog.entries[0].scene_url, rooms: [], areas: [] };
    const pendingHistoryScenes = [];
    const serviceCalls = [];
    let planReads = 0;
    const planCatalog = structuredClone(plans || { rooms: [], plans: [], selected_plan: null });
    const applySavedPlan = (data) => {
      const plan = planCatalog.plans.find((candidate) => candidate.id === data.plan_id);
      if (!plan) throw new Error(`unknown synthetic plan: ${data.plan_id}`);
      plan.name = data.name;
      plan.enabled = data.enabled;
      plan.run_behavior = data.run_behavior;
      plan.return_to_base = data.return_to_base;
      plan.finish_current_room = data.finish_current_room;
      plan.finish_current_room_threshold = data.finish_current_room_threshold;
      plan.room_order = data.rooms.map((room) => room.room);
      plan.rooms = data.rooms.map((room) => ({
        room_id: room.room,
        cleaning_mode: room.cleaning_mode,
        coverage_setting: room.coverage_setting,
        cadence: room.cadence && {
          scope: room.cadence.scope,
          mop_every_n: room.cadence.mop_every_n,
          coverage_every_n: room.cadence.coverage_every_n,
          // save_plan clears this when coverage cadence is disabled; backend tests cover it.
          periodic_coverage_setting: room.cadence.coverage_every_n == null
            ? null
            : room.cadence.periodic_coverage_setting,
          do_mop_next: room.cadence.do_mop_next,
          do_coverage_next: room.cadence.do_coverage_next,
        },
      }));
      if (data.select) planCatalog.selected_plan = plan.id;
    };
    const fetchWithAuth = async (path) => {
      if (path.endsWith("slam_entries")) return json(catalog);
      if (path.endsWith("slam_history/synthetic")) return json(history);
      if (path.endsWith("slam_pose/synthetic")) return json(pose);
      if (path.endsWith("areas/synthetic")) return json(areas);
      if (path.endsWith("plans/synthetic")) {
        planReads += 1;
        return json(structuredClone(planCatalog));
      }
      if (path.endsWith("slam_scene/history")) {
        return new Promise((resolve) => pendingHistoryScenes.push(() => resolve(new Response(new Uint8Array(scenes), {
          headers: { "Content-Type": "application/vnd.matic.slam-scene", "X-Matic-Revision": "6" },
        }))));
      }
      if (path.endsWith("slam_scene/synthetic")) return new Response(new Uint8Array(scenes), {
        headers: { "Content-Type": "application/vnd.matic.slam-scene", "X-Matic-Revision": "7" },
      });
      throw new Error(`unexpected synthetic request: ${path}`);
    };
    const makePanel = () => {
      const panel = document.createElement(MATIC_MAP_PANEL_TAG);
      panel.panel = { config: {} };
      panel.hass = {
        connected: true,
        user: { id: "synthetic-admin", is_admin: true },
        states: { "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry" } } },
        fetchWithAuth,
        callService: async (domain, service, data, target) => {
          serviceCalls.push({ domain, service, data: structuredClone(data), target: structuredClone(target) });
          if (domain === "matic_robot" && service === "save_plan") {
            applySavedPlan(data);
          }
        },
      };
      return panel;
    };
    window.__panelFixture = {
      panelTag: MATIC_MAP_PANEL_TAG,
      createPanel: makePanel,
      serviceCalls,
      pendingHistoryScenes,
      get planReads() { return planReads; },
      stats: () => ({
        ...window.__panelFixtureResources,
        activePopstateListeners: window.__panelFixturePopstateCount(),
        pendingHistoryScenes: pendingHistoryScenes.length,
        planReads,
        serviceCalls: serviceCalls.length,
      }),
    };
  }, { module: modulePath, scenes: sceneBytes(), plans: initialPlanCatalog });
  return {
    panelTag: await page.evaluate(() => window.__panelFixture.panelTag),
    modulePath,
  };
}
