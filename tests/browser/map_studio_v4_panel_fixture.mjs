import { build } from "esbuild";

const PANEL_MODULE = "/panel-fixture-test.js";

function sceneBytes(scenePoint, rooms) {
  const metadata = Buffer.from(JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: [10, 10],
    sample_step: 1,
    rooms,
  }));
  const bytes = Buffer.alloc(24 + metadata.length + 8);
  bytes.write("MATIC3D\0", 0, "binary");
  bytes.writeUInt16LE(1, 8);
  bytes.writeUInt16LE(8, 10);
  bytes.writeUInt32LE(metadata.length, 12);
  bytes.writeUInt32LE(1, 16);
  metadata.copy(bytes, 24);
  if (scenePoint) {
    const pointOffset = 24 + metadata.length;
    bytes.writeUInt16LE(scenePoint.x, pointOffset);
    bytes.writeUInt16LE(scenePoint.y, pointOffset + 2);
    bytes[pointOffset + 5] = scenePoint.color[0];
    bytes[pointOffset + 6] = scenePoint.color[1];
    bytes[pointOffset + 7] = scenePoint.color[2];
  }
  return [...bytes];
}

const emptyPlans = { rooms: [], plans: [], selected_plan: null };

// Opens the plan picker through the public intent. The home plan card opens
// the default plan's Run view (home-rooms.md D1), so tests that need the
// picker ask for it directly. `root` is the gallery or panel locator.
export const openPlanPicker = (root) => root.locator("matic-map-shell-v4").first().evaluate((shell) => shell.dispatchEvent(
  new CustomEvent("matic-workspace-intent", { detail: { type: "open-workflow", workflow: "plans" }, bubbles: true, composed: true }),
));

export async function installPanelFixture(page, {
  initialPlanCatalog = emptyPlans,
  initialAreasCatalog = null,
  moduleSource = "typescript",
  onNavigationComplete = null,
  sceneDeltaPayload = null,
  posePosition = [1, 1],
  scenePoint = null,
  sceneRooms = [],
  initialCatalogEntries = null,
  initialRobotStates = null,
  // Home Assistant's per-user frontend data (frontend/get_user_data), keyed by
  // key. Null leaves the fixture without a websocket connection, as before.
  userData = null,
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
  await onNavigationComplete?.();
  // Home Assistant mounts the panel again on every page load; `remount` does
  // the same after a test reloads the page.
  const remount = () => page.evaluate(async ({ module, scenes, plans, areas, sceneDeltaPayload, posePosition, initialCatalogEntries, initialRobotStates, userData }) => {
    const { MATIC_MAP_PANEL_TAG } = await import(module);
    const json = (body, headers = {}) => new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json", ...headers },
    });
    const catalog = { entries: [{
      entry_id: "synthetic-entry",
      scene_url: "/api/matic_robot/slam_scene/synthetic",
      delta_url: sceneDeltaPayload ? "/api/matic_robot/slam_delta/synthetic" : null,
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
    let catalogEntries = initialCatalogEntries || catalog.entries;
    let robotStates = initialRobotStates || { "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry" } } };
    let catalogReads = 0;
    let deferredCatalogs = 0;
    const pendingCatalogs = [];
    const history = { entry_id: "synthetic-entry", live_available: true, floors: [
      { id: "current", active: true, read_only: false, live_available: true, label: "Home", ordinal: null, snapshots: [] },
      { id: "saved-1", active: false, read_only: true, live_available: false, label: "Loft", ordinal: 2,
        snapshots: [{ id: "saved-shot", created_at: "2026-09-25T12:00:00Z", revision: 6, point_count: 1,
          scene_url: "/api/matic_robot/slam_scene/history" }] },
    ] };
    const entryBHistory = { ...history, entry_id: "synthetic-entry-b", floors: history.floors.map((floor) => ({
      ...floor,
      snapshots: floor.snapshots.map((snapshot) => ({
        ...snapshot,
        scene_url: snapshot.scene_url.replace("/history", "/history-b"),
      })),
    })) };
    const pendingHistoryScenes = [];
    const serviceCalls = [];
    const serviceFailures = [];
    let deferredServices = 0;
    let deferredServiceResponses = 0;
    let failedPlanReads = 0;
    let deferredPlanReads = 0;
    const pendingPlanReads = [];
    let deferredAreaReads = 0;
    const pendingAreaReads = [];
    const pendingServices = [];
    let deferredAreaWrites = 0;
    const pendingAreaWrites = [];
    let areaCatalog = structuredClone(areas);
    const areaRequests = [];
    let planReads = 0;
    let deltaReads = 0;
    let deltaPayloadResponses = 0;
    let deltaNoChangeResponses = 0;
    const planCatalog = structuredClone(plans || { rooms: [], plans: [], selected_plan: null });
    const applySavedPlan = (data) => {
      let plan = data.plan_id && planCatalog.plans.find((candidate) => candidate.id === data.plan_id);
      if (data.plan_id && !plan) throw new Error(`unknown synthetic plan: ${data.plan_id}`);
      if (!plan) {
        plan = { id: `synthetic-plan-${planCatalog.plans.length + 1}` };
        planCatalog.plans.push(plan);
      }
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
      if (data.select || !planCatalog.selected_plan) planCatalog.selected_plan = plan.id;
      return { response: { plan: { id: plan.id } } };
    };
    const fetchWithAuth = async (path, options = {}) => {
      const entryB = path.endsWith("-b");
      if (/areas\/synthetic(?:-b)?$/.test(path) && options.method === "POST") {
        const body = JSON.parse(options.body);
        areaRequests.push({ method: "POST", body });
        const savedId = typeof body.area_id === "string" ? body.area_id : "synthetic-area";
        const commitArea = () => {
          if (!areaCatalog?.areas) return;
          areaCatalog = {
            ...areaCatalog,
            areas: areaCatalog.areas.some((candidate) => candidate.id === savedId)
              ? areaCatalog.areas.map((candidate) => candidate.id === savedId
                ? { ...candidate, name: body.name, circles: body.circles, outline: body.outline ?? null,
                    cleaning_mode: body.cleaning_mode, coverage_setting: body.coverage_setting,
                    status: "current", can_rebind: false }
                : candidate)
              : [...areaCatalog.areas, { id: savedId, name: body.name, circles: body.circles,
                  outline: body.outline ?? null, cleaning_mode: body.cleaning_mode,
                  coverage_setting: body.coverage_setting, status: "current", can_rebind: false }],
          };
        };
        const result = json({ id: savedId });
        if (deferredAreaWrites > 0) {
          deferredAreaWrites -= 1;
          return new Promise((resolve, reject) => pendingAreaWrites.push({ release: () => { commitArea(); resolve(result); }, reject }));
        }
        commitArea();
        return result;
      }
      if (path.endsWith("slam_entries")) {
        catalogReads += 1;
        const result = json({ entries: structuredClone(catalogEntries) });
        if (deferredCatalogs > 0) {
          deferredCatalogs -= 1;
          return new Promise((resolve) => pendingCatalogs.push(() => resolve(result)));
        }
        return result;
      }
      if (/slam_history\/synthetic(?:-b)?$/.test(path)) return json(entryB ? entryBHistory : history);
      if (/slam_pose\/synthetic(?:-b)?$/.test(path)) return json({
        position: posePosition,
        source: "latest_pose",
        revision: 7,
        pose_revision: 1,
        map_floor_coherent: true,
        map_session_key: entryB ? "b".repeat(64) : "a".repeat(64),
        pose_freshness: "live",
      });
      if (/areas\/synthetic(?:-b)?$/.test(path)) {
        areaRequests.push({ method: "GET" });
        const result = json(areaCatalog ?? {
        scene_url: `/api/matic_robot/slam_scene/${entryB ? "synthetic-b" : "synthetic"}`,
        rooms: [],
        areas: [],
        selected_area: null,
        });
        if (deferredAreaReads > 0) {
          deferredAreaReads -= 1;
          return new Promise((resolve) => pendingAreaReads.push(() => resolve(result)));
        }
        return result;
      }
      if (/plans\/synthetic(?:-b)?$/.test(path)) {
        planReads += 1;
        if (failedPlanReads > 0) {
          failedPlanReads -= 1;
          return new Response(null, { status: 503 });
        }
        const result = json(structuredClone(planCatalog));
        if (deferredPlanReads > 0) {
          deferredPlanReads -= 1;
          return new Promise((resolve) => pendingPlanReads.push(() => resolve(result)));
        }
        return result;
      }
      if (/slam_scene\/history(?:-b)?$/.test(path)) {
        return new Promise((resolve) => pendingHistoryScenes.push(() => resolve(new Response(new Uint8Array(scenes), {
          headers: { "Content-Type": "application/vnd.matic.slam-scene", "X-Matic-Revision": "6" },
        }))));
      }
      if (sceneDeltaPayload && path.includes("slam_delta/synthetic")) {
        deltaReads += 1;
        if (deltaReads > 1) {
          deltaNoChangeResponses += 1;
          return new Response(null, { status: 204 });
        }
        deltaPayloadResponses += 1;
        return new Response(new Uint8Array(sceneDeltaPayload), {
          headers: {
            "Content-Type": "application/vnd.matic.slam-delta",
            "X-Matic-Revision": "8",
            "X-Matic-Base-Revision": "7",
            "X-Matic-Floor-Coherent": "1",
          },
        });
      }
      if (/slam_scene\/synthetic(?:-b)?$/.test(path)) return new Response(new Uint8Array(scenes), {
        headers: { "Content-Type": "application/vnd.matic.slam-scene", "X-Matic-Revision": "7" },
      });
      throw new Error(`unexpected synthetic request: ${path}`);
    };
    // Only the frontend user data messages; anything else is not served here.
    const userStore = userData ? structuredClone(userData) : null;
    const userDataCalls = [];
    const userDataFailures = [];
    let deferredUserDataReads = 0;
    const pendingUserDataReads = [];
    const connection = userStore ? {
      sendMessagePromise: async (message) => {
        userDataCalls.push(structuredClone(message));
        const failure = userDataFailures.findIndex((type) => type === message.type);
        if (failure >= 0) {
          userDataFailures.splice(failure, 1);
          throw new Error("synthetic user data failure");
        }
        if (message.type === "frontend/get_user_data") {
          const result = { value: structuredClone(userStore[message.key] ?? null) };
          if (deferredUserDataReads > 0) {
            deferredUserDataReads -= 1;
            return new Promise((resolve) => pendingUserDataReads.push(() => resolve(result)));
          }
          return result;
        }
        if (message.type === "frontend/set_user_data") {
          userStore[message.key] = structuredClone(message.value);
          return null;
        }
        throw new Error(`unexpected synthetic message: ${message.type}`);
      },
      subscribeMessage: async () => () => undefined,
    } : null;
    const makePanel = () => {
      const panel = document.createElement(MATIC_MAP_PANEL_TAG);
      // Home Assistant gives a panel the page's height; a panel in a bare
      // body would be 0 px tall and lay out as a phone held sideways.
      panel.style.blockSize = "100dvh";
      panel.panel = { config: {} };
      panel.hass = {
        connected: true,
        user: { id: "synthetic-admin", is_admin: true },
        states: robotStates,
        ...(connection ? { connection } : {}),
        fetchWithAuth,
        callService: async (domain, service, data, target) => {
          serviceCalls.push({ domain, service, data: structuredClone(data), target: structuredClone(target) });
          const failure = serviceFailures.findIndex((candidate) => candidate.service === service);
          if (failure >= 0) throw serviceFailures.splice(failure, 1)[0].error;
          const apply = () => {
            if (domain === "matic_robot" && service === "save_plan") return applySavedPlan(data);
            if (domain === "matic_robot" && service === "delete_plan") {
              planCatalog.plans = planCatalog.plans.filter((plan) => plan.id !== data.plan);
              if (planCatalog.selected_plan === data.plan) planCatalog.selected_plan = planCatalog.plans[0]?.id ?? null;
            }
            if (domain === "matic_robot" && service === "delete_room_schedule") {
              const roomId = data.room_id;
              const deletedPlanIds = planCatalog.plans
                .filter((plan) => plan.rooms.some((room) => room.room_id === roomId && room.cadence?.scope === "shared"))
                .map((plan) => plan.id);
              for (const plan of planCatalog.plans) {
                if (!deletedPlanIds.includes(plan.id)) continue;
                plan.rooms = plan.rooms.map((room) => {
                  if (room.room_id !== roomId) return room;
                  const { cadence: _cadence, cadence_identity: _identity, cadence_progress: _progress,
                    cadence_reasons: _reasons, ...rest } = room;
                  return rest;
                });
              }
              planCatalog.rooms = planCatalog.rooms.map((room) => {
                if (room.room_id !== roomId) return room;
                const { shared_cadence: _cadence, shared_cadence_progress: _progress,
                  shared_cadence_reasons: _reasons, shared_cadence_delete_token: _token, ...rest } = room;
                return rest;
              });
              return { response: { room_id: roomId, affected_plan_ids: deletedPlanIds } };
            }
            return undefined;
          };
          if (deferredServiceResponses > 0) {
            deferredServiceResponses -= 1;
            const result = apply();
            return new Promise((resolve, reject) => pendingServices.push({ release: () => resolve(result), reject }));
          }
          if (deferredServices > 0) {
            deferredServices -= 1;
            return new Promise((resolve, reject) => pendingServices.push({
              release: () => { try { resolve(apply()); } catch (error) { reject(error); } },
              reject,
            }));
          }
          return apply();
        },
      };
      return panel;
    };
    window.__panelFixture = {
      panelTag: MATIC_MAP_PANEL_TAG,
      createPanel: makePanel,
      setCatalogEntries: (entries) => { catalogEntries = structuredClone(entries); },
      deferNextCatalog: () => { deferredCatalogs += 1; },
      releaseCatalog: (index = 0) => {
        const release = pendingCatalogs.splice(index, 1)[0];
        if (!release) throw new Error("no deferred catalog request");
        release();
      },
      pendingCatalogCount: () => pendingCatalogs.length,
      get catalogReads() { return catalogReads; },
      serviceCalls,
      deferNextService: () => { deferredServices += 1; },
      deferNextServiceResponse: () => { deferredServiceResponses += 1; },
      failNextPlansRead: () => { failedPlanReads += 1; },
      deferNextPlansRead: () => { deferredPlanReads += 1; },
      pendingPlanReadCount: () => pendingPlanReads.length,
      releasePlansRead: () => { const release = pendingPlanReads.shift(); if (!release) throw new Error("no deferred plans read"); release(); },
      deferNextAreasRead: () => { deferredAreaReads += 1; },
      pendingAreasReadCount: () => pendingAreaReads.length,
      releaseAreasRead: () => { const release = pendingAreaReads.shift(); if (!release) throw new Error("no deferred areas read"); release(); },
      pendingServiceCount: () => pendingServices.length,
      releaseService: (index = 0) => {
        const pending = pendingServices.splice(index, 1)[0];
        if (!pending) throw new Error("no deferred service call");
        pending.release();
      },
      rejectService: (index = 0, error = new Error("synthetic deferred service failure")) => {
        const pending = pendingServices.splice(index, 1)[0];
        if (!pending) throw new Error("no deferred service call");
        pending.reject(error);
      },
      deferNextAreaWrite: () => { deferredAreaWrites += 1; },
      pendingAreaWriteCount: () => pendingAreaWrites.length,
      releaseAreaWrite: (index = 0) => {
        const pending = pendingAreaWrites.splice(index, 1)[0];
        if (!pending) throw new Error("no deferred area write");
        pending.release();
      },
      rejectAreaWrite: (index = 0, error = new Error("synthetic deferred area failure")) => {
        const pending = pendingAreaWrites.splice(index, 1)[0];
        if (!pending) throw new Error("no deferred area write");
        pending.reject(error);
      },
      // Record the next call to `service`, then reject it once with `error`.
      failNextService: (service, error = new Error("synthetic failure")) => {
        serviceFailures.push({ service, error });
      },
      pendingHistoryScenes,
      get planReads() { return planReads; },
      setPlanCatalog: (value) => Object.assign(planCatalog, structuredClone(value)),
      areaRequests,
      userData: () => structuredClone(userStore),
      userDataCalls,
      // Reject the next frontend user data message of `type` once.
      failNextUserData: (type) => { userDataFailures.push(type); },
      deferNextUserDataRead: () => { deferredUserDataReads += 1; },
      pendingUserDataReadCount: () => pendingUserDataReads.length,
      releaseUserDataRead: () => { const release = pendingUserDataReads.shift(); if (!release) throw new Error("no deferred user data read"); release(); },
      stats: () => ({
        ...window.__panelFixtureResources,
        activePopstateListeners: window.__panelFixturePopstateCount(),
        pendingHistoryScenes: pendingHistoryScenes.length,
        planReads,
        ...(sceneDeltaPayload ? { deltaReads, deltaPayloadResponses, deltaNoChangeResponses } : {}),
        serviceCalls: serviceCalls.length,
      }),
    };
  }, {
    module: modulePath,
    scenes: sceneBytes(scenePoint, sceneRooms),
    plans: initialPlanCatalog,
    areas: initialAreasCatalog,
    sceneDeltaPayload,
    posePosition,
    initialCatalogEntries,
    initialRobotStates,
    userData,
  });
  await remount();
  return {
    panelTag: await page.evaluate(() => window.__panelFixture.panelTag),
    modulePath,
    remount,
  };
}
