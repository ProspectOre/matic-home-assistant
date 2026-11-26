import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { liveScene, pageId } from "./scene_manifest_fixture.mjs";

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

// The same one-point scene as a live manifest and its page.
function sceneManifest(scenePoint, rooms) {
  const metadata = Buffer.from(JSON.stringify({
    meters_per_cell: 0.015,
    span_cells: [100, 80],
    origin_cells: [10, 10],
    sample_step: 1,
    rooms,
  }));
  const { x = 0, y = 0, color = [0, 0, 0] } = scenePoint ?? {};
  const [cellX, cellY] = [x + 10, y + 10];
  return liveScene(metadata, [{
    x: Math.floor(cellX / 32), y: Math.floor(cellY / 32), id: pageId(1), floor: 1,
    points: [[cellX % 32, cellY % 32, 0, ...color]],
  }]);
}

// What Home Assistant sends Matic Map, recorded by tests/e2e/test_browser_wire.py.
const wire = JSON.parse(readFileSync(new URL("fixtures/backend_wire.json", import.meta.url), "utf8"));

/** A recorded read with this fixture's values; it cannot add a field Home Assistant does not send. */
const recorded = (read, values = {}) => {
  const unknown = Object.keys(values).filter((key) => !(key in read));
  if (unknown.length > 0) throw new Error(`not in the recorded read: ${unknown.join(", ")}`);
  return { ...structuredClone(read), ...values };
};

const [liveFloor, savedFloor] = wire.history.floors;
const [savedMap] = wire.history.snapshots;
// The fixture's own paths, which it routes below; the robot is on its live floor
// with one saved map of another floor.
const backend = {
  catalogEntry: recorded(wire.catalog, {
    scene_url: "/api/matic_robot/slam_scene/synthetic",
    history_url: "/api/matic_robot/slam_history/synthetic",
    areas_url: "/api/matic_robot/areas/synthetic",
    plans_url: "/api/matic_robot/plans/synthetic",
    wifi_heatmap_url: "/api/matic_robot/wifi_heatmap/synthetic",
    floor_layers_url: "/api/matic_robot/floor_layers/synthetic",
  }),
  history: recorded(wire.history, { snapshots: [], floors: [
    recorded(liveFloor, { label: "Home", snapshots: [] }),
    recorded(savedFloor, { label: "Loft", ordinal: 2, snapshots: [recorded(savedMap, {
      created_at: "2026-09-25T12:00:00Z", point_count: 1, scene_url: "/api/matic_robot/slam_scene/history",
      // No comparison: the saved scene is the one-point scene below.
      comparison_group: null, frame: null,
    })] }),
  ] }),
  areas: recorded(wire.areas, { rooms: [], areas: [], selected_area: null }),
  area: wire.areas.areas[0],
  plan: wire.plans.plans[0],
  savedPlan: wire.saved_plan,
  snapshot: wire.workspace_snapshot,
  invalidation: wire.invalidation,
  pose: wire.pose,
};
/** The fixture's catalog row, as Home Assistant sends it. */
export const catalogEntry = () => structuredClone(backend.catalogEntry);
const emptyPlans = recorded(wire.plans, { rooms: [], plans: [], selected_plan: null });

// Opens the plan picker through the public intent. The home plan card opens
// the default plan's Run view, so tests that need the
// picker ask for it directly. `root` is the gallery or panel locator.
export const openPlanPicker = (root) => root.locator("matic-map-shell-v4").first().evaluate((shell) => shell.dispatchEvent(
  new CustomEvent("matic-workspace-intent", { detail: { type: "open-workflow", workflow: "plans" }, bubbles: true, composed: true }),
));

export async function installPanelFixture(page, {
  initialPlanCatalog = emptyPlans,
  initialAreasCatalog = null,
  moduleSource = "typescript",
  onNavigationComplete = null,
  // True serves the live scene as a manifest, which the panel updates when the
  // workspace socket announces a revision; false serves the saved-map form.
  liveManifest = false,
  // A manifest body served once as revision 8, which the socket announces
  // when it opens; setting it also serves the live scene as a manifest.
  sceneUpdate = null,
  posePosition = [1, 1],
  scenePoint = null,
  sceneRooms = [],
  initialCatalogEntries = null,
  initialRobotStates = null,
  // Home Assistant's entity, device and area registries ({ entities, devices, areas }).
  registries = {},
  // Home Assistant's per-user frontend data (frontend/get_user_data), keyed by
  // key. Null leaves the fixture without a websocket connection, so without a pose.
  userData = {},
  // The Wi-Fi survey response. Null leaves it unserved.
  wifiSignal = null,
  // The carpet and vent response. Null leaves it unserved.
  floorTypes = null,
  // The Photos read (photo_gallery_view.py); every photo route answers with a
  // 1x1 WebP. Null leaves both unserved.
  photoGallery = null,
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
  const remount = () => page.evaluate(async ({ module, scenes, liveManifest, plans, areas, followed, sceneUpdate, posePosition, initialCatalogEntries, initialRobotStates, registries, userData, wifiSignal, floorTypes, photoGallery, backend }) => {
    const { MATIC_MAP_PANEL_TAG } = await import(module);
    const json = (body, headers = {}) => new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json", ...headers },
    });
    const catalog = { entries: [backend.catalogEntry] };
    let catalogEntries = initialCatalogEntries || catalog.entries;
    let robotStates = initialRobotStates || { "vacuum.synthetic": { state: "idle", attributes: { matic_entry_id: "synthetic-entry" } } };
    let catalogReads = 0;
    let deferredCatalogs = 0;
    const pendingCatalogs = [];
    let historyReads = 0;
    let history = backend.history;
    const entryBHistory = { ...history, entry_id: "synthetic-entry-b", floors: history.floors.map((floor) => ({
      ...floor,
      snapshots: floor.snapshots.map((snapshot) => ({
        ...snapshot,
        scene_url: snapshot.scene_url.replace("/history", "/history-b"),
      })),
    })) };
    const pendingHistoryScenes = [];
    let deferredSceneReads = 0;
    const pendingSceneReads = [];
    let deferredLayerReads = 0;
    const pendingLayerReads = [];
    const serviceCalls = [];
    const serviceFailures = [];
    let deferredServices = 0;
    let deferredServiceResponses = 0;
    let failedPlanReads = 0;
    let failedAreaReads = 0;
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
    let latestReads = 0;
    let sceneUpdates = 0;
    let latestUnchanged = 0;
    const planCatalog = structuredClone(plans);
    // A new plan as the list shows it, without the next-run preview this fixture does not compute.
    const { next_run_preview: _preview, next_run_estimate_seconds: _estimate, ...listedPlan } = backend.plan;
    const applySavedPlan = (data) => {
      let plan = data.plan_id && planCatalog.plans.find((candidate) => candidate.id === data.plan_id);
      if (data.plan_id && !plan) throw new Error(`unknown synthetic plan: ${data.plan_id}`);
      if (!plan) {
        plan = { ...structuredClone(listedPlan), id: `synthetic-plan-${planCatalog.plans.length + 1}` };
        planCatalog.plans.push(plan);
      }
      plan.name = data.name;
      plan.enabled = data.enabled;
      plan.run_behavior = data.run_behavior;
      plan.return_to_base = data.return_to_base;
      plan.finish_current_room = data.finish_current_room;
      plan.finish_current_room_threshold = data.finish_current_room_threshold;
      plan.occupancy_aware = data.occupancy_aware ?? false;
      plan.occupancy_sensors = data.occupancy_sensors ?? {};
      // Custom areas are steps of the plan, not rooms.
      plan.entries = data.rooms.map((step) => step.area === undefined
        ? { kind: "room", room_id: step.room }
        : { kind: "area", area_id: step.area, cleaning_mode: step.cleaning_mode, coverage_setting: step.coverage_setting,
            name: areaCatalog?.areas?.find((area) => area.id === step.area)?.name ?? step.area });
      const rooms = data.rooms.filter((step) => step.area === undefined);
      plan.room_order = rooms.map((room) => room.room);
      plan.rooms = rooms.map((room) => ({
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
      // save_plan returns the stored plan: its fields as the list shows them, area
      // steps without the name the list adds, and the stored timeouts.
      const saved = Object.fromEntries(Object.entries(backend.savedPlan)
        .map(([key, value]) => [key, structuredClone(key in plan ? plan[key] : value)]));
      saved.entries = saved.entries.map(({ name: _name, ...step }) => step);
      return { response: { plan: saved } };
    };
    const fetchWithAuth = async (path, options = {}) => {
      const entryB = path.endsWith("-b");
      if (/areas\/synthetic(?:-b)?$/.test(path) && options.method === "POST") {
        const body = JSON.parse(options.body);
        areaRequests.push({ method: "POST", body });
        const savedId = typeof body.area_id === "string" ? body.area_id : "synthetic-area";
        const commitArea = () => {
          if (!areaCatalog?.areas) return;
          // The saved area as the areas view lists it; it has an outline only when one was drawn.
          const saved = { ...structuredClone(backend.area), id: savedId, name: body.name, circles: body.circles,
            ...(body.outline ? { outline: body.outline } : {}), cleaning_mode: body.cleaning_mode,
            coverage_setting: body.coverage_setting, status: "current", can_rebind: false };
          areaCatalog = {
            ...areaCatalog,
            areas: areaCatalog.areas.some((candidate) => candidate.id === savedId)
              ? areaCatalog.areas.map((candidate) => candidate.id === savedId ? saved : candidate)
              : [...areaCatalog.areas, saved],
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
      // Each robot's Wi-Fi and carpet layers answer from `window.__layerReplies[path]`, else the shared reply.
      const layer = wifiSignal && /\/wifi_heatmap\/[^/]+$/.test(path) ? window.__wifiSignalReply ?? wifiSignal
        : floorTypes && /\/floor_layers\/[^/]+$/.test(path) ? window.__floorTypesReply ?? floorTypes : null;
      if (layer) {
        const result = json(window.__layerReplies?.[path] ?? layer);
        if (deferredLayerReads === 0) return result;
        deferredLayerReads -= 1;
        return new Promise((resolve) => pendingLayerReads.push(() => resolve(result)));
      }
      if (photoGallery && path === "/api/matic_robot/photo_gallery/synthetic-entry") return json(window.__photoGalleryReply ?? photoGallery);
      // A photo's star (photo_star_view.py): recorded, then answered with
      // window.__photoStarReply ({ status, body }) or as the server would.
      if (photoGallery && /^\/api\/matic_robot\/photo_gallery\/synthetic-entry\/photos\/[^/]+\/star$/.test(path)) {
        const body = JSON.parse(options.body);
        window.__photoStars = [...window.__photoStars ?? [], { method: options.method, path, body }];
        const reply = window.__photoStarReply ?? { status: 200, body: { starred: body.starred } };
        return new Response(JSON.stringify(reply.body ?? null), { status: reply.status, headers: { "Content-Type": "application/json" } });
      }
      // Viewpoint saves and deletes (viewpoint_view.py): recorded, then answered
      // with window.__viewpointReply ({ status, body }) or as the server would.
      if (photoGallery && path.startsWith("/api/matic_robot/photo_gallery/synthetic-entry/viewpoints")) {
        const body = options.body ? JSON.parse(options.body) : null;
        window.__viewpointWrites = [...window.__viewpointWrites ?? [], { method: options.method, path, body }];
        // A test can hold the answer until it resolves window.__viewpointHold.
        await window.__viewpointHold;
        const reply = window.__viewpointReply;
        if (reply) return new Response(reply.body ? JSON.stringify(reply.body) : null, { status: reply.status, headers: { "Content-Type": "application/json" } });
        if (options.method === "DELETE") return new Response(null, { status: 204 });
        const { map_session_key: _key, ...saved } = body;
        return new Response(JSON.stringify({ viewpoint_id: `v${window.__viewpointWrites.length + 10}`, mission_id: 7, room_id: "r1", ...saved }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (photoGallery && path.startsWith("/api/matic_robot/photo/synthetic-entry/")) {
        window.__photoReads = [...window.__photoReads ?? [], path];
        if (window.__photoFailures?.includes(path)) return new Response(null, { status: 404 });
        const webp = "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";
        return new Response(Uint8Array.from(atob(webp), (char) => char.charCodeAt(0)), { headers: { "Content-Type": "image/webp" } });
      }
      if (/slam_history\/synthetic(?:-b)?$/.test(path)) {
        historyReads += 1;
        return json(entryB ? entryBHistory : history);
      }
      // No live trail is stored before a run records a point.
      if (path.endsWith("runs/synthetic-entry?trail=live")) return new Response(null, { status: 404 });
      if (/areas\/synthetic(?:-b)?$/.test(path)) {
        areaRequests.push({ method: "GET" });
        if (failedAreaReads > 0) {
          failedAreaReads -= 1;
          return new Response(null, { status: 503 });
        }
        const result = json(areaCatalog ?? {
          ...backend.areas,
          scene_url: `/api/matic_robot/slam_scene/${entryB ? "synthetic-b" : "synthetic"}`,
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
      const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
      // A read for the newest scene (no X-Matic-Prefer-Cached) gets the update
      // once; after that the server is still encoding it and answers revision 7.
      const latest = !new Headers(options.headers).has("X-Matic-Prefer-Cached");
      if (followed && latest && path.endsWith("slam_scene/synthetic")) {
        latestReads += 1;
        if (sceneUpdate && sceneUpdates === 0) {
          sceneUpdates += 1;
          return new Response(new Uint8Array(sceneUpdate), {
            headers: {
              "Content-Type": "application/vnd.matic.slam-manifest",
              "X-Matic-Revision": "8",
              "X-Matic-Floor-Coherent": "1",
            },
          });
        }
        latestUnchanged += 1;
      }
      if (followed && path.startsWith("/api/matic_robot/slam_scene/synthetic/pages?ids=")) {
        return new Response(decode(Object.values(liveManifest.pages)[0]), { headers: { "Content-Type": "application/octet-stream" } });
      }
      if (followed && path.endsWith("slam_scene/synthetic")) {
        return new Response(decode(liveManifest.manifest), {
          headers: { "Content-Type": "application/vnd.matic.slam-manifest", "X-Matic-Revision": "7" },
        });
      }
      if (/slam_scene\/synthetic(?:-b)?$/.test(path)) {
        const result = new Response(new Uint8Array(scenes), {
          headers: { "Content-Type": "application/vnd.matic.slam-scene", "X-Matic-Revision": "7" },
        });
        if (deferredSceneReads > 0) {
          deferredSceneReads -= 1;
          return new Promise((resolve) => pendingSceneReads.push(() => resolve(result)));
        }
        return result;
      }
      throw new Error(`unexpected synthetic request: ${path}`);
    };
    // Only the frontend user data and workspace messages; anything else is not served here.
    const userStore = userData && structuredClone(userData);
    const userDataCalls = [];
    const poseSubscribers = new Set();
    const invalidationSubscribers = new Set();
    let workspaceSequence = 0;
    // Every resource's revision, as each snapshot and invalidation carries them.
    const revisions = { ...backend.snapshot.revisions };
    // The invalidation the server sends when `resource` reaches `revision`.
    const announce = (resource, revision) => {
      workspaceSequence += 1;
      Object.assign(revisions, { workspace: workspaceSequence, [resource]: revision });
      const invalidation = { ...backend.invalidation, sequence: workspaceSequence,
        revisions: { ...revisions }, resources: [resource] };
      for (const send of invalidationSubscribers) send({ type: "invalidate", invalidation });
    };
    // The scene invalidation the server sends when the map changes.
    const announceScene = (revision) => announce("scene", revision);
    // Without robot time (observed_at), which the integration also sends when the robot gives none.
    const wirePose = (entryId, position) => ({
      ...backend.pose, position, source: position ? "exact_pose" : "current_area",
      map_session_key: entryId.endsWith("-b") ? "b".repeat(64) : "a".repeat(64),
      pose_age_seconds: position ? 0 : null, observed_at: null,
    });
    // The snapshot's projection of the entry, from the catalog row: the same fields, without its map diagnostics.
    const projectedEntry = (entryId) => {
      const row = catalogEntries.find((entry) => entry.entry_id === entryId);
      return row ? Object.fromEntries(Object.keys(backend.snapshot.payload.entry)
        .filter((key) => key in row).map((key) => [key, structuredClone(row[key])])) : null;
    };
    let heldSnapshots = null;
    const userDataFailures = [];
    const workspaceCalls = [];
    let deferredUserDataReads = 0;
    const pendingUserDataReads = [];
    const connection = userStore ? {
      sendMessagePromise: async (message) => {
        if (message.type?.startsWith("matic_robot/workspace_")) {
          const panel = document.querySelector(MATIC_MAP_PANEL_TAG);
          workspaceCalls.push({
            type: message.type,
            mapAvailable: panel?.getWorkspaceSnapshot?.().map.available === true,
          });
        } else {
          userDataCalls.push(structuredClone(message));
        }
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
        if (message.type === "matic_robot/workspace_snapshot" && heldSnapshots) {
          return new Promise((resolve) => heldSnapshots.push(() => resolve(connection.sendMessagePromise(message))));
        }
        if (message.type === "matic_robot/workspace_snapshot") {
          // As workspace_socket.snapshot: Home Assistant refuses an entry it has not
          // loaded, and while the robot is away sends a stale, unverified snapshot.
          if (!catalogEntries.some((row) => row.entry_id === message.entry_id)) {
            throw { code: "home_assistant_error", message: "Matic entry is unavailable" };
          }
          const available = Object.values(robotStates)
            .find((state) => state.attributes?.matic_entry_id === message.entry_id)?.state !== "unavailable";
          const entry = available ? projectedEntry(message.entry_id) : null;
          const verified = Boolean(entry?.map_floor_coherent && entry.map_session_verified);
          const { scene: _scene, ...withoutScene } = revisions;
          return {
            ...backend.snapshot,
            sequence: workspaceSequence,
            revisions: entry ? { ...revisions } : withoutScene,
            entry_id: message.entry_id,
            identity: { ...backend.snapshot.identity, entry_id: message.entry_id,
              floor_mission_id: verified ? backend.snapshot.identity.floor_mission_id : null, floor_verified: verified },
            status: available ? backend.snapshot.status : { state: "stale", reason: "snapshot_required", retryable: true },
            payload: { available, entry },
          };
        }
        throw new Error(`unexpected synthetic message: ${message.type}`);
      },
      subscribeMessage: async (callback, message) => {
        if (message?.type?.startsWith("matic_robot/workspace_")) {
          const panel = document.querySelector(MATIC_MAP_PANEL_TAG);
          workspaceCalls.push({
            type: message.type,
            mapAvailable: panel?.getWorkspaceSnapshot?.().map.available === true,
          });
        }
        if (message?.type !== "matic_robot/workspace_subscribe" || !message.poses) return () => undefined;
        // Home Assistant sends the robot's position once the subscription is open.
        const subscriber = (position, fields = {}) =>
          callback({ type: "pose", pose: { ...wirePose(message.entry_id, position), ...fields } });
        poseSubscribers.add(subscriber);
        invalidationSubscribers.add(callback);
        queueMicrotask(() => {
          subscriber(posePosition);
          if (sceneUpdate && revisions.scene !== 8) announceScene(8);
        });
        return () => {
          poseSubscribers.delete(subscriber);
          invalidationSubscribers.delete(callback);
        };
      },
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
        ...registries,
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
      failNextAreasRead: () => { failedAreaReads += 1; },
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
      deferNextSceneRead: () => { deferredSceneReads += 1; },
      pendingSceneReadCount: () => pendingSceneReads.length,
      deferNextLayerRead: () => { deferredLayerReads += 1; },
      pendingLayerReadCount: () => pendingLayerReads.length,
      releaseLayerRead: () => { const release = pendingLayerReads.shift(); if (!release) throw new Error("no deferred layer read"); release(); },
      releaseSceneRead: () => { const release = pendingSceneReads.shift(); if (!release) throw new Error("no deferred scene read"); release(); },
      get planReads() { return planReads; },
      setPlanCatalog: (value) => Object.assign(planCatalog, structuredClone(value)),
      areaRequests,
      userData: () => structuredClone(userStore),
      workspaceCalls,
      // Push the robot's position, and any other wire fields, to every open workspace subscription.
      pushPose: (position, fields = {}) => { for (const subscriber of poseSubscribers) subscriber(position, fields); },
      announceScene,
      // Hold workspace snapshots until released: each carries the entry's
      // catalog row, so a test that holds the catalog read holds them too.
      holdWorkspaceSnapshots: () => { heldSnapshots ??= []; },
      releaseWorkspaceSnapshots: () => {
        const held = heldSnapshots ?? [];
        heldSnapshots = null;
        for (const release of held) release();
      },
      // `resource` changed on the server.
      announce: (resource) => announce(resource, (revisions[resource] ?? 0) + 1),
      // The saved-map list changed on the server.
      announceHistory: () => announce("history", workspaceSequence + 1),
      get openSubscriptions() { return invalidationSubscribers.size; },
      get historyReads() { return historyReads; },
      getHistory: () => structuredClone(history),
      setHistory: (value) => { history = structuredClone(value); },
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
        ...(followed ? { latestReads, sceneUpdates, latestUnchanged } : {}),
        serviceCalls: serviceCalls.length,
      }),
    };
  }, {
    module: modulePath,
    scenes: sceneBytes(scenePoint, sceneRooms),
    liveManifest: sceneManifest(scenePoint, sceneRooms),
    plans: initialPlanCatalog,
    areas: initialAreasCatalog,
    followed: liveManifest || sceneUpdate !== null,
    sceneUpdate,
    posePosition,
    initialCatalogEntries,
    initialRobotStates,
    registries,
    userData,
    wifiSignal,
    floorTypes,
    photoGallery,
    backend,
  });
  await remount();
  return {
    panelTag: await page.evaluate(() => window.__panelFixture.panelTag),
    modulePath,
    remount,
  };
}
