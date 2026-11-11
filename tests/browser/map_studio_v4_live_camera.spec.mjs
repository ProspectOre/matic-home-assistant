import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadCamera(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController, topView } from "./frontend/map-studio-v4/renderer-controller"; export { EffectController } from "./frontend/map-studio-v4/effects"; export { WorkspaceStore } from "./frontend/map-studio-v4/state"; export { liveCameraKey, cameraPreferences } from "./frontend/map-studio-v4/camera-preferences"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state"; export { sceneGeometryBounds, perspectiveBoundsFitDistance } from "./frontend/map-studio-v4/renderer-math"; export { PreferenceStore, parsePreferences } from "./frontend/map-studio-v4/preferences";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/live-camera.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

for (const [view, boundary, mobile] of [
  ["top", "same", false], ["three", "same", false],
  ["top", "session", false], ["top", "floor", false],
  ["top", "entry", false], ["top", "user", false], ["top", "same", true],
]) {
  test(`history camera stays separate from ${view} live framing across ${boundary} identity${mobile ? " @mobile" : ""}`, async ({ page }) => {
    await loadCamera(page);
    const result = await page.evaluate(async ({ view, boundary }) => {
      const { RendererController, topView, WorkspaceStore, createGalleryState } = await import("/live-camera.js");
      const base = createGalleryState("ready");
      const entry = { ...base.resources.entry, selectedFloorOrdinal: 1, mapFloorOrdinal: 1,
        mapFloorCoherent: true, mapSessionVerified: true, mapSessionKey: "a".repeat(64) };
      const liveScene = base.resources.scene.value;
      const store = new WorkspaceStore({ ...base, view, owner: { userKey: "camera-user", entryKey: entry.entryId },
        resources: { ...base.resources, entry } });
      const canvases = [document.createElement("canvas"), document.createElement("canvas")];
      for (const canvas of canvases) {
        Object.assign(canvas.style, { width: "900px", height: "700px" });
        document.body.append(canvas);
      }
      const renderer = new RendererController(...canvases, {
        onCamera: (camera, zoomPercent) => store.dispatch({ type: "set-camera", view: topView(store.value), camera: {
          yaw: camera.yaw, pitch: camera.pitch, zoom: zoomPercent / 100, targetX: camera.targetX, targetZ: camera.targetZ,
        } }),
        onCameraPreferences: (cameras) => {
          for (const [cameraView, camera] of Object.entries(cameras)) store.dispatch({ type: "set-camera", view: cameraView, camera });
        },
      });
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sync = async (patch = {}) => { store.patch(patch); renderer.setState(store.value); await frame(); };
      const capture = () => ({ camera: renderer.camera, zoom: renderer.diagnostics().fitDistance / renderer.diagnostics().cameraDistance });
      try {
        await sync();
        const initialFit = renderer.camera;
        renderer.zoomAt(2);
        renderer.panBy(35, -24);
        await sync();
        const before = capture();
        const livePreferences = structuredClone(store.value.cameras);
        const historyScene = { ...liveScene, source: "history", revision: liveScene.revision + 1,
          metadata: { ...liveScene.metadata, span: [100, 90] } };
        await sync({ dataMode: "history", floor: { ...store.value.floor, readOnly: true },
          selection: { ...store.value.selection, floorId: "saved-shed", historyId: "saved-one" },
          resources: { ...store.value.resources, scene: { status: "ready", value: historyScene, problem: null } } });
        renderer.zoomAt(1.4);
        renderer.panBy(-50, 12);
        await sync();
        const history = capture();
        const afterHistoryPreferences = structuredClone(store.value.cameras);
        // A view toggle within history keeps its own framing too.
        await sync({ view: view === "top" ? "three" : "top" });
        await sync({ view });
        const historyAfterToggle = capture();
        await sync({ dataMode: "live", coherence: "verifying",
          selection: { ...store.value.selection, floorId: "current", historyId: null },
          resources: { ...store.value.resources, scene: { status: "loading", value: historyScene, problem: null } } });
        const loading = capture();
        const nextEntry = { ...entry,
          ...(boundary === "session" ? { mapSessionKey: "b".repeat(64) } : {}),
          ...(boundary === "floor" ? { selectedFloorOrdinal: 2, mapFloorOrdinal: 2 } : {}),
          ...(boundary === "entry" ? { entryId: "other-entry" } : {}),
        };
        await sync({ coherence: "current", floor: { ...store.value.floor, readOnly: false },
          ...(boundary === "user" ? { owner: { userKey: "other-user", entryKey: entry.entryId } } : {}),
          selection: { ...store.value.selection, entryId: nextEntry.entryId },
          resources: { ...store.value.resources, entry: nextEntry,
            scene: { status: "ready", value: { ...liveScene, revision: liveScene.revision + 2 }, problem: null } } });
        return { initialFit, before, livePreferences, afterHistoryPreferences, history, historyAfterToggle, loading, restored: capture() };
      } finally {
        renderer.dispose();
        canvases.forEach((canvas) => canvas.remove());
      }
    }, { view, boundary });

    expect(result.afterHistoryPreferences, "history gestures preserve live preferences").toEqual(result.livePreferences);
    expect(result.historyAfterToggle.zoom).toBeCloseTo(result.history.zoom, 4);
    expect(result.historyAfterToggle.camera.targetX).toBeCloseTo(result.history.camera.targetX, 4);
    expect(result.loading.camera, "held saved geometry does not receive the live camera").toEqual(result.historyAfterToggle.camera);
    if (boundary === "same") {
      expect(result.restored.zoom).toBeCloseTo(result.before.zoom, 4);
      expect(result.restored.camera.targetX).toBeCloseTo(result.before.camera.targetX, 4);
      expect(result.restored.camera.targetZ).toBeCloseTo(result.before.camera.targetZ, 4);
      expect(result.restored.camera.yaw).toBeCloseTo(result.before.camera.yaw, 4);
    } else {
      expect(result.restored.zoom, "a different live identity starts fitted").toBeCloseTo(1, 4);
      expect(result.restored.camera.targetX).toBeCloseTo(result.initialFit.targetX, 4);
      expect(result.restored.camera.targetZ).toBeCloseTo(result.initialFit.targetZ, 4);
    }
  });
}

test("@safety camera preferences reload only for their verified map and ignore held-scene gestures", async ({ page }) => {
  await loadCamera(page);
  const result = await page.evaluate(async () => {
    const { WorkspaceStore, liveCameraKey, cameraPreferences, createGalleryState, PreferenceStore, parsePreferences } = await import("/live-camera.js");
    const base = createGalleryState("ready");
    const owner = { userKey: "reload-user", entryKey: base.selection.entryId };
    const store = new WorkspaceStore({ ...base, owner });
    const preference = { yaw: .3, pitch: 1.2, zoom: 2, targetX: .2, targetZ: -.3 };
    store.dispatch({ type: "set-camera", view: "top", camera: preference });
    const preferences = new PreferenceStore();
    preferences.load(owner.userKey);
    preferences.schedule({ version: 4, view: "top", appearance: "photo", labels: true, quality: "auto",
      cameras: store.value.cameras, cameraKey: store.value.cameraKey });
    preferences.dispose();
    const loaded = preferences.load(owner.userKey);
    const reload = { ...base, owner, cameras: loaded.cameras, cameraKey: loaded.cameraKey };
    const same = cameraPreferences(reload);
    const changed = cameraPreferences({ ...reload, resources: { ...reload.resources,
      entry: { ...reload.resources.entry, mapSessionKey: "c".repeat(64) } } });
    const legacy = parsePreferences({ cameras: { top: preference } });
    const unbound = cameraPreferences({ ...reload, ...legacy });
    const before = store.value.cameras;
    store.patch({ coherence: "verifying", floor: { ...store.value.floor, readOnly: true } });
    store.dispatch({ type: "set-camera", view: "top", camera: { ...preference, zoom: 3 } });
    const heldUntouched = before === store.value.cameras;
    // A content-only refresh can keep a verified live scene interactive.
    store.patch({ coherence: "current", floor: { ...store.value.floor, readOnly: false },
      resources: { ...store.value.resources, scene: { ...store.value.resources.scene, status: "loading" } } });
    store.dispatch({ type: "set-camera", view: "top", camera: { ...preference, zoom: 4 } });
    return { same, changed, unbound, heldUntouched, refreshedZoom: store.value.cameras.top.zoom,
      keyMatches: loaded.cameraKey === liveCameraKey(reload), invalidKey: parsePreferences({ cameraKey: "x".repeat(1025) }).cameraKey };
  });
  expect(result.same.top).toEqual({ yaw: .3, pitch: 1.2, zoom: 2, targetX: .2, targetZ: -.3 });
  expect(result.changed).toEqual({});
  expect(result.unbound).toEqual({});
  expect(result.keyMatches).toBe(true);
  expect(result.heldUntouched).toBe(true);
  expect(result.refreshedZoom).toBe(4);
  expect(result.invalidKey).toBeNull();
});

test("history camera resets on a new selection and owner while live preferences remain separate", async ({ page }) => {
  await loadCamera(page);
  const result = await page.evaluate(async () => {
    const { EffectController, WorkspaceStore, createGalleryState } = await import("/live-camera.js");
    const initial = createGalleryState("ready");
    const entry = { ...initial.resources.entry, deltaUrl: null };
    const store = new WorkspaceStore(initial);
    const effects = new EffectController(store, {
      catalog: async () => [entry],
      history: async () => initial.resources.history.value,
      scene: async (_url, revision, floorCoherent, source) => ({ revision, floorCoherent,
        scene: { ...initial.resources.scene.value, revision, source } }),
      pose: async () => { throw new DOMException("Aborted", "AbortError"); },
      plans: async () => initial.resources.plans.value,
      areas: async () => initial.resources.areas.value,
      dispose() {},
    });
    const projection = (userKey) => ({ host: initial.host, activity: initial.activity,
      batteryPercent: 92, robotLabel: "Synthetic", robots: initial.robots, language: "en",
      userKey, entryKey: entry.entryId, vacuumEntityId: "vacuum.synthetic" });
    const preference = { yaw: .3, pitch: 1.2, zoom: 2, targetX: .2, targetZ: -.3 };
    const saveCamera = () => store.dispatch({ type: "set-camera", view: "top", camera: preference });
    try {
      effects.sync(projection("selection-user"));
      await effects.refreshCatalog(true);
      await effects.refreshHistory();
      saveCamera();
      const live = store.value.cameras;
      await effects.selectFloor("saved-1");
      saveCamera();
      const saved = store.value.historyCameras;
      await effects.selectFloor("saved-1");
      const sameSelection = store.value.historyCameras;
      await effects.selectHistory("current-old");
      const changedSelection = store.value.historyCameras;
      saveCamera();
      await effects.selectHistory("current-new");
      const changedSnapshot = store.value.historyCameras;
      const liveUntouched = live === store.value.cameras;
      saveCamera();
      effects.sync(projection("replacement-user"));
      const previousOwner = JSON.parse(localStorage.getItem("matic-map-studio:v4:selection-user"));
      return { saved, sameSelection, changedSelection, changedSnapshot, liveUntouched,
        ownerHistory: store.value.historyCameras, ownerCameras: store.value.cameras, ownerKey: store.value.cameraKey,
        previousOwner: previousOwner.cameras };
    } finally { effects.dispose(); }
  });
  expect(result.saved.top).toEqual({ yaw: .3, pitch: 1.2, zoom: 2, targetX: .2, targetZ: -.3 });
  expect(result.sameSelection).toEqual(result.saved);
  expect(result.changedSelection).toEqual({});
  expect(result.changedSnapshot).toEqual({});
  expect(result.liveUntouched).toBe(true);
  expect(result.ownerHistory).toEqual({});
  expect(result.ownerCameras).toEqual({});
  expect(result.ownerKey).toBeNull();
  expect(result.previousOwner.top).toEqual(result.saved.top);
});

test("@safety a held saved scene honors explicit view changes and keeps automatic updates still", async ({ page }) => {
  await loadCamera(page);
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/live-camera.js");
    const base = createGalleryState("ready");
    const saved = { ...base, view: "three", dataMode: "history", floor: { ...base.floor, readOnly: true },
      selection: { ...base.selection, floorId: "saved", historyId: "saved-one" },
      resources: { ...base.resources, scene: { ...base.resources.scene, value: { ...base.resources.scene.value, source: "history" } } } };
    const canvases = Array.from({ length: 2 }, () => document.createElement("canvas"));
    canvases.forEach((canvas) => { Object.assign(canvas.style, { width: "700px", height: "500px" }); document.body.append(canvas); });
    const renderer = new RendererController(...canvases);
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      renderer.setState(saved);
      await frame();
      renderer.zoomAt(1.5);
      renderer.panBy(20, -15);
      const before = renderer.camera;
      const held = { ...saved, dataMode: "live", coherence: "verifying",
        selection: { ...saved.selection, floorId: "current", historyId: null },
        resources: { ...saved.resources, scene: { ...saved.resources.scene, status: "loading" } } };
      renderer.setState(held);
      await frame();
      const automatic = renderer.camera;
      renderer.setState({ ...held, view: "top" });
      await frame();
      const top = renderer.camera;
      renderer.setState({ ...held, view: "top" });
      await frame();
      const topAutomatic = renderer.camera;
      renderer.setState(held);
      await frame();
      const three = renderer.camera;
      renderer.setState({ ...held });
      await frame();
      return { before, automatic, top, topAutomatic, three, threeAutomatic: renderer.camera };
    } finally { renderer.dispose(); canvases.forEach((canvas) => canvas.remove()); }
  });
  expect(result.automatic).toEqual(result.before);
  expect(result.top.orthographic).toBe(true);
  expect(result.topAutomatic).toEqual(result.top);
  expect(result.three.orthographic).toBe(false);
  expect(result.threeAutomatic).toEqual(result.three);
});

test("ground-plane pan follows the pointer across pitch, zoom, and aspect", async ({ page }) => {
  await loadCamera(page);
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/live-camera.js");
    const state = createGalleryState("ready");
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    canvases.forEach((canvas) => { Object.assign(canvas.style, { width: "800px", height: "600px" }); document.body.append(canvas); });
    const renderer = new RendererController(...canvases);
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      renderer.setState({ ...state, view: "three" });
      await frame();
      const cases = [
        { width: 800, height: 600, pitch: 1.12, distance: 12 },
        { width: 800, height: 600, pitch: 0.18, distance: 12 },
        { width: 1200, height: 500, pitch: 0.55, distance: 7 },
      ];
      const results = [];
      for (const { width, height, pitch, distance } of cases) {
        canvases.forEach((canvas) => { canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; });
        await frame();
        const rect = canvases[0].getBoundingClientRect();
        const anchor = { x: rect.left + width * 0.5, y: rect.top + height * 0.58 };
        const delta = { x: 24, y: 50 };
        const camera = { ...renderer.camera, pitch, distance, targetX: 0, targetZ: 0, orthographic: false };
        renderer.setCamera(camera, false);
        const before = renderer.screenToMap(anchor.x, anchor.y);
        const moved = renderer.cameraAfterPan(camera, delta.x, delta.y, anchor.x, anchor.y);
        renderer.setCamera(moved, false);
        const projected = before && renderer.mapToScreen(before);
        results.push({ projected, expected: { x: width * 0.5 + delta.x, y: height * 0.58 + delta.y } });
      }
      const rect = canvases[0].getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const centerPoint = renderer.screenToMap(center.x, center.y);
      renderer.panBy(0, 25);
      results.push({ projected: centerPoint && renderer.mapToScreen(centerPoint),
        expected: { x: rect.width / 2, y: rect.height / 2 + 25 } });
      return results;
    } finally { renderer.dispose(); canvases.forEach((canvas) => canvas.remove()); }
  });
  for (const item of result) {
    expect(item.projected).not.toBeNull();
    expect(item.projected.x).toBeCloseTo(item.expected.x, 1);
    expect(item.projected.y).toBeCloseTo(item.expected.y, 1);
  }
});

test("pan that starts above the floor horizon resumes with finite movement below it", async ({ page }) => {
  await loadCamera(page);
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/live-camera.js");
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    canvases.forEach((canvas) => { Object.assign(canvas.style, { width: "800px", height: "600px" }); document.body.append(canvas); });
    const renderer = new RendererController(...canvases);
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      renderer.setState({ ...createGalleryState("ready"), view: "three" });
      await frame();
      const rect = canvases[0].getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      for (const pitch of [0.18, 0.3, 0.45, 0.6]) {
        const camera = { ...renderer.camera, pitch, distance: 12, targetX: 0, targetZ: 0, orthographic: false };
        renderer.setCamera(camera, false);
        let firstGroundY = null;
        for (let y = 0; y <= rect.height; y += 1) {
          if (renderer.screenToMap(x, rect.top + y)) { firstGroundY = y; break; }
        }
        if (firstGroundY === null || firstGroundY < 20) continue;
        const startY = rect.top + firstGroundY - 12;
        const endY = rect.top + Math.min(rect.height, firstGroundY + 180);
        if (renderer.screenToMap(x, startY) || !renderer.screenToMap(x, endY)) continue;
        const moved = renderer.cameraAfterPan(camera, 0, endY - startY, x, startY);
        return { pitch, firstGroundY, moved, crossedIntoGround: true,
          changed: Math.hypot(moved.targetX - camera.targetX, moved.targetZ - camera.targetZ) > 0.001 };
      }
      return null;
    } finally { renderer.dispose(); canvases.forEach((canvas) => canvas.remove()); }
  });
  expect(result, "the test camera should expose a floor horizon in the viewport").not.toBeNull();
  expect(result.crossedIntoGround).toBe(true);
  expect(result.changed).toBe(true);
  expect(Number.isFinite(result.moved.targetX)).toBe(true);
  expect(Number.isFinite(result.moved.targetZ)).toBe(true);
  expect(Math.hypot(result.moved.targetX, result.moved.targetZ)).toBeLessThan(100);
});

test("source camera fit frames admitted floor geometry across desktop and tablet aspects", async ({ page }) => {
  await loadCamera(page);
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState, sceneGeometryBounds } = await import("/live-camera.js");
    const base = createGalleryState("ready");
    const scene = base.resources.scene.value;
    const geometry = sceneGeometryBounds(scene.buffer, scene.pointOffset, scene.floorCount,
      scene.total, scene.metadata.span).floor;
    const outputs = [];
    for (const { width, height } of [{ width: 1080, height: 680 }, { width: 480, height: 680 }]) {
      const canvases = [document.createElement("canvas"), document.createElement("canvas")];
      canvases.forEach((canvas) => {
        Object.assign(canvas.style, { width: `${width}px`, height: `${height}px` });
        document.body.append(canvas);
      });
      const renderer = new RendererController(...canvases);
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      try {
        renderer.setState({ ...base, view: "three" });
        await frame();
        const meters = scene.metadata.metersPerCell;
        const origin = scene.metadata.origin;
        const cells = [
          [geometry.minX, geometry.minY], [geometry.minX, geometry.maxY],
          [geometry.maxX, geometry.minY], [geometry.maxX, geometry.maxY],
        ];
        const projected = cells.map(([x, y]) => renderer.mapToScreen({
          x: (x + origin[0]) * meters, y: (y + origin[1]) * meters,
        }));
        outputs.push({ width, height, camera: renderer.camera,
          fitDistance: renderer.diagnostics().fitDistance, projected });
      } finally {
        renderer.dispose();
        canvases.forEach((canvas) => canvas.remove());
      }
    }
    return outputs;
  });
  for (const item of result) {
    expect(item.camera.pitch).toBeCloseTo(1.12, 4);
    expect(item.projected.every(Boolean)).toBe(true);
    const xs = item.projected.map(({ x }) => x);
    const ys = item.projected.map(({ y }) => y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(item.width * 0.045);
    expect(Math.max(...xs)).toBeLessThanOrEqual(item.width * 0.955);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(item.height * 0.045);
    expect(Math.max(...ys)).toBeLessThanOrEqual(item.height * 0.955);
  }
});

test("3D home fit includes tall surface points outside the floor footprint", async ({ page }) => {
  await loadCamera(page);
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState, sceneGeometryBounds, perspectiveBoundsFitDistance } = await import("/live-camera.js");
    const base = createGalleryState("ready");
    const meters = 0.05;
    const buffer = new ArrayBuffer(5 * 8);
    const view = new DataView(buffer);
    const points = [[2, 2, 0], [8, 2, 0], [2, 8, 0], [8, 8, 0], [13, 5, 255]];
    points.forEach(([x, y, height], index) => {
      const offset = index * 8;
      view.setUint16(offset, x, true);
      view.setUint16(offset + 2, y, true);
      view.setUint8(offset + 4, height);
      view.setUint8(offset + 5, 180);
      view.setUint8(offset + 6, 190);
      view.setUint8(offset + 7, 200);
    });
    const scene = { ...base.resources.scene.value, buffer, pointOffset: 0, floorCount: 4,
      surfaceCount: 1, total: 5,
      metadata: { ...base.resources.scene.value.metadata, span: [16, 12], origin: [0, 0], metersPerCell: meters } };
    const state = { ...base, view: "three", resources: { ...base.resources,
      scene: { ...base.resources.scene, status: "ready", value: scene } } };
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    canvases.forEach((canvas) => { Object.assign(canvas.style, { width: "480px", height: "680px" }); document.body.append(canvas); });
    const renderer = new RendererController(...canvases);
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      renderer.setState(state);
      await frame();
      const geometry = sceneGeometryBounds(buffer, 0, 4, 5, scene.metadata.span);
      const centerX = (geometry.floor.minX + geometry.floor.maxX) / 2;
      const centerZ = (geometry.floor.minY + geometry.floor.maxY) / 2;
      const toFitBounds = (bounds) => ({
        minX: -(bounds.maxX - centerX) * meters,
        maxX: -(bounds.minX - centerX) * meters,
        minZ: (bounds.minY - centerZ) * meters,
        maxZ: (bounds.maxY - centerZ) * meters,
        minHeight: bounds.minHeight * meters,
        maxHeight: bounds.maxHeight * meters,
      });
      const aspect = 480 / 680;
      const floorOnlyFit = perspectiveBoundsFitDistance(toFitBounds(geometry.floor), aspect, 1.12, -Math.PI / 4, 0.05);
      const allPointsFit = perspectiveBoundsFitDistance(toFitBounds(geometry.all), aspect, 1.12, -Math.PI / 4, 0.05);
      const camera = renderer.camera;
      const focal = 1 / Math.tan(Math.PI / 3.15 / 2);
      const projected = points.map(([x, y, height]) => {
        const worldX = -(x - centerX) * meters;
        const worldZ = (y - centerZ) * meters;
        const worldHeight = height * meters;
        const sinPitch = Math.sin(camera.pitch), cosPitch = Math.cos(camera.pitch);
        const sinYaw = Math.sin(camera.yaw), cosYaw = Math.cos(camera.yaw);
        const right = worldX * cosYaw - worldZ * sinYaw;
        const up = -worldX * sinYaw * sinPitch + worldHeight * cosPitch - worldZ * cosYaw * sinPitch;
        const towardCamera = worldX * sinYaw * cosPitch + worldHeight * sinPitch + worldZ * cosYaw * cosPitch;
        const depth = camera.distance - towardCamera;
        return { x: focal * right / aspect / depth, y: focal * up / depth };
      });
      return { geometry, floorOnlyFit, allPointsFit, camera, projected };
    } finally { renderer.dispose(); canvases.forEach((canvas) => canvas.remove()); }
  });
  expect(result.geometry.all.maxHeight).toBe(255);
  expect(result.geometry.all.maxX).toBe(13);
  expect(result.geometry.floor.maxX).toBe(8);
  expect(result.allPointsFit).toBeGreaterThan(result.floorOnlyFit);
  expect(result.camera.distance).toBeCloseTo(result.allPointsFit, 4);
  expect(result.projected.every(({ x, y }) => Math.abs(x) <= 0.9 && Math.abs(y) <= 0.9)).toBe(true);
});
