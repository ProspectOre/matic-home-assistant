import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadCameraFollowHarness(page) {
  const bundle = await build({
    stdin: {
      contents: 'export { CameraFollowController } from "./frontend/map-studio-v4/camera-follow"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/camera-follow-harness.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  await page.evaluate(async () => {
    window.__cameraFollowModule = await import("/camera-follow-harness.js");
    window.makeCameraFollowFixture = () => {
      const { CameraFollowController, createGalleryState } = window.__cameraFollowModule;
      const base = createGalleryState("ready");
      const entry = { ...base.resources.entry, mapSessionKey: "session-a", mapSessionVerified: true };
      const state = {
        ...base,
        owner: { userKey: "follow-test", entryKey: entry.entryId },
        coherence: "current",
        dataMode: "live",
        map: { ...base.map, floorCoherent: true, sessionVerified: true, exactPose: true },
        resources: { ...base.resources, entry },
      };
      const manual = { yaw: 0.3, pitch: 0.7, distance: 8, targetX: 0, targetZ: 0, orthographic: false };
      let camera = { ...manual };
      let fitActive = true;
      const pose = {
        position: [3, 2], heading: 0.8, freshness: "live", floorCoherent: true,
        mapSessionKey: "session-a",
      };
      const controller = new CameraFollowController({
        state: () => state,
        camera: () => camera,
        setCamera: (next) => { camera = { ...next }; },
        fitActive: () => fitActive,
        worldForMeters: (x, y) => [x, y],
        radius: () => 8,
        setFitActive: (active) => { fitActive = active; },
        requestRender() {},
        notifyCamera() {},
        disposed: () => false,
      });
      const waitFor = async (predicate) => {
        const deadline = performance.now() + 3_000;
        while (!predicate()) {
          if (performance.now() >= deadline) throw new Error("Camera follow did not settle");
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      };
      return { controller, camera: () => ({ ...camera }), setCamera: (next) => { camera = { ...next }; },
        fitActive: () => fitActive, manual, pose, waitFor };
    };
  });
}

test("ride camera uses admitted heading, stays close, and restores on explicit exit", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/follow-camera.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/follow-camera.js");
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    for (const canvas of canvases) {
      Object.assign(canvas.style, { width: "800px", height: "600px" });
      document.body.append(canvas);
    }
    const renderer = new RendererController(...canvases);
    const base = createGalleryState("ready");
    const entry = { ...base.resources.entry, mapSessionKey: "session-a", mapSessionVerified: true };
    const state = {
      ...base,
      owner: { userKey: "ride-user", entryKey: entry.entryId },
      coherence: "current",
      dataMode: "live",
      map: { ...base.map, floorCoherent: true, sessionVerified: true, exactPose: true },
      resources: { ...base.resources, entry },
    };
    renderer.setState(state);
    const overview = renderer.camera;
    const pose = { position: [3, 2], heading: 0, freshness: "live", floorCoherent: true,
      mapSessionKey: "session-a" };
    renderer.updateFollow(pose, "ride", true);
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 5_000;
      const waitForRide = () => {
        const camera = renderer.camera;
        if (!camera.orthographic && Math.abs(camera.pitch - 1.04) < 0.001
          && Math.abs(camera.yaw - Math.PI / 2) < 0.001 && camera.distance < overview.distance) {
          resolve();
        } else if (performance.now() >= deadline) {
          reject(new Error("Ride camera did not reach its admitted pose"));
        } else {
          requestAnimationFrame(waitForRide);
        }
      };
      waitForRide();
    });
    const ride = renderer.camera;
    renderer.updateFollow(pose, "off", true);
    const restored = renderer.camera;
    renderer.dispose();
    canvases.forEach((canvas) => canvas.remove());
    return { overview, ride, restored };
  });
  expect(result.ride.orthographic).toBe(false);
  expect(result.ride.pitch).toBeCloseTo(1.04, 6);
  expect(result.ride.yaw).toBeCloseTo(Math.PI / 2, 6);
  expect(result.ride.distance).toBeLessThan(result.overview.distance);
  expect(result.restored).toEqual(result.overview);
});

test("stale or historical pose cannot start ride camera", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/follow-camera.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const camera = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/follow-camera.js");
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    for (const canvas of canvases) {
      Object.assign(canvas.style, { width: "800px", height: "600px" });
      document.body.append(canvas);
    }
    const renderer = new RendererController(...canvases);
    const base = createGalleryState("ready");
    const state = { ...base, dataMode: "history", map: { ...base.map, exactPose: true } };
    renderer.setState(state);
    const before = renderer.camera;
    renderer.updateFollow({ position: [3, 2], heading: 0, freshness: "live", floorCoherent: true,
      mapSessionKey: "wrong-session" }, "ride", true);
    const after = renderer.camera;
    renderer.dispose();
    canvases.forEach((canvas) => canvas.remove());
    return { before, after };
  });
  expect(camera.after).toEqual(camera.before);
});

test("source renderer fits first-launch 3D at its high overview angle", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/follow-camera.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/follow-camera.js");
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    for (const canvas of canvases) {
      Object.assign(canvas.style, { width: "800px", height: "600px" });
      document.body.append(canvas);
    }
    const renderer = new RendererController(...canvases);
    renderer.setState({ ...createGalleryState("ready"), workflow: "none", view: "three" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const result = { camera: renderer.camera, diagnostics: renderer.diagnostics() };
    renderer.dispose();
    canvases.forEach((canvas) => canvas.remove());
    return result;
  });
  expect(result.camera.pitch).toBeCloseTo(1.12, 6);
  expect(result.camera.orthographic).toBe(false);
  expect(result.diagnostics.cameraDistance).toBeCloseTo(result.diagnostics.fitDistance, 6);
});

test("Ride to Follow restores the manual view with reduced motion and explicit off restores it", async ({ page }) => {
  await loadCameraFollowHarness(page);
  const result = await page.evaluate(() => {
    const fixture = window.makeCameraFollowFixture();
    fixture.controller.update(fixture.pose, "ride", true);
    const ride = fixture.camera();
    fixture.controller.update(fixture.pose, "follow", true);
    const follow = fixture.camera();
    fixture.controller.update(null, "off", true);
    const off = fixture.camera();
    fixture.controller.dispose();
    return { manual: fixture.manual, ride, follow, off };
  });
  expect(result.ride.pitch).toBeCloseTo(1.04, 6);
  expect(result.follow.yaw).toBeCloseTo(result.manual.yaw, 8);
  expect(result.follow.pitch).toBeCloseTo(result.manual.pitch, 8);
  expect(result.follow.distance).toBeCloseTo(result.manual.distance, 8);
  expect(result.follow.targetX).toBe(3);
  expect(result.follow.targetZ).toBe(2);
  expect(result.off).toEqual(result.manual);
});

test("explicit Follow exit restores fit behavior so a later resize refits the map", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/follow-camera.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/follow-camera.js");
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    for (const canvas of canvases) {
      Object.assign(canvas.style, { width: "800px", height: "600px" });
      document.body.append(canvas);
    }
    const renderer = new RendererController(...canvases);
    const base = createGalleryState("ready");
    const entry = { ...base.resources.entry, mapSessionKey: "session-a", mapSessionVerified: true };
    renderer.setState({
      ...base,
      owner: { userKey: "fit-restore-user", entryKey: entry.entryId },
      coherence: "current",
      dataMode: "live",
      workflow: "none",
      view: "three",
      map: { ...base.map, floorCoherent: true, sessionVerified: true, exactPose: true },
      resources: { ...base.resources, entry },
    });
    const waitFor = async (label, predicate) => {
      const deadline = performance.now() + 5_000;
      while (!predicate()) {
        if (performance.now() >= deadline) throw new Error(`${label} did not settle: ${JSON.stringify(renderer.diagnostics())}`);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    };
    await waitFor("initial fit", () => renderer.diagnostics().fitActive
      && renderer.diagnostics().cameraDistance === renderer.diagnostics().fitDistance);
    const initialFit = renderer.diagnostics().fitDistance;
    const pose = { position: [3, 2], heading: 0, freshness: "live", floorCoherent: true,
      mapSessionKey: "session-a" };
    renderer.updateFollow(pose, "follow", true);
    await waitFor("follow start", () => !renderer.diagnostics().fitActive);
    renderer.updateFollow(pose, "off", true);
    const restoredFit = renderer.diagnostics().fitActive;
    Object.assign(canvases[0].style, { width: "400px", height: "800px" });
    Object.assign(canvases[1].style, { width: "400px", height: "800px" });
    await waitFor("resize fit distance", () => renderer.diagnostics().fitDistance !== initialFit);
    await waitFor("camera resize refit", () => renderer.diagnostics().cameraDistance === renderer.diagnostics().fitDistance);
    const result = { initialFit, restoredFit, resizedFit: renderer.diagnostics().fitDistance,
      cameraDistance: renderer.diagnostics().cameraDistance, fitActive: renderer.diagnostics().fitActive };
    renderer.dispose();
    canvases.forEach((canvas) => canvas.remove());
    return result;
  });
  expect(result.restoredFit).toBe(true);
  expect(result.resizedFit).not.toBe(result.initialFit);
  expect(result.cameraDistance).toBe(result.resizedFit);
  expect(result.fitActive).toBe(true);
});

test("efficient LOD keeps framebuffer coverage from collapsing when it strides packed points", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/lod-coverage.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/lod-coverage.js");
    const base = createGalleryState("ready");
    const scene = base.resources.scene.value;
    const measure = async (quality, sampleStepScale = 1) => {
      const canvas = document.createElement("canvas");
      const overlay = document.createElement("canvas");
      for (const element of [canvas, overlay]) {
        Object.assign(element.style, { position: "absolute", width: "160px", height: "120px" });
        document.body.append(element);
      }
      const renderer = new RendererController(canvas, overlay);
      const sampledScene = { ...scene, metadata: { ...scene.metadata,
        sampleStep: scene.metadata.sampleStep * sampleStepScale } };
      renderer.setState({ ...base, workflow: "none", view: "top", appearance: "photo",
        labelsVisible: false, quality, resources: { ...base.resources,
          scene: { status: "ready", value: sampledScene, problem: null } } });
      const deadline = performance.now() + 5_000;
      while (renderer.diagnostics().sceneRevision !== sampledScene.revision
        || renderer.diagnostics().renderedPoints <= 0) {
        if (performance.now() >= deadline) throw new Error(`LOD render did not settle (${quality})`);
        renderer.requestRender();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const diagnostics = renderer.diagnostics();
      const gl = canvas.getContext("webgl2");
      if (diagnostics.mode !== "webgl2" || !gl) {
        renderer.dispose();
        canvas.remove();
        overlay.remove();
        return { mode: diagnostics.mode, sourcePoints: diagnostics.sourcePoints,
          renderedPoints: diagnostics.renderedPoints, coveredPixels: 0, coveragePercent: 0 };
      }
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let covered = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) covered += 1;
      renderer.dispose();
      canvas.remove();
      overlay.remove();
      return { mode: diagnostics.mode, sourcePoints: diagnostics.sourcePoints,
        renderedPoints: diagnostics.renderedPoints, coveredPixels: covered,
        coveragePercent: covered / (canvas.width * canvas.height) * 100 };
    };
    return {
      maximum: await measure("maximum"),
      efficient: await measure("efficient"),
      // Efficient has stride 3. Scaling the metadata spacing by 1/sqrt(3)
      // cancels the renderer's compensation and captures the prior footprint.
      efficientUnadjusted: await measure("efficient", 1 / Math.sqrt(3)),
    };
  });
  test.skip(result.maximum.mode !== "webgl2" || result.efficient.mode !== "webgl2",
    "WebGL2 is unavailable in this browser project");
  expect(result.maximum.renderedPoints).toBe(result.maximum.sourcePoints);
  expect(result.efficient.renderedPoints).toBeLessThan(result.efficient.sourcePoints);
  expect(result.efficient.coveragePercent).toBeGreaterThan(result.efficientUnadjusted.coveragePercent + 10);
});

test("Ride to Follow animates from the restored manual view; manual interruption keeps its camera", async ({ page }) => {
  await loadCameraFollowHarness(page);
  const result = await page.evaluate(async () => {
    const fixture = window.makeCameraFollowFixture();
    fixture.controller.update(fixture.pose, "ride", false);
    await fixture.waitFor(() => Math.abs(fixture.camera().pitch - 1.04) < 0.001);
    const ride = fixture.camera();
    fixture.controller.update(fixture.pose, "follow", false);
    const transitionStart = fixture.camera();
    await fixture.waitFor(() => Math.abs(fixture.camera().targetX - 3) < 0.01
      && Math.abs(fixture.camera().targetZ - 2) < 0.01);
    const follow = fixture.camera();
    fixture.controller.dispose();

    const interrupted = window.makeCameraFollowFixture();
    interrupted.controller.update(interrupted.pose, "ride", true);
    const userCamera = { ...interrupted.camera(), yaw: -0.4, pitch: 0.9, distance: 4, targetX: 1, targetZ: 2 };
    interrupted.setCamera(userCamera);
    interrupted.controller.cancel(false);
    const afterManualInterrupt = interrupted.camera();
    interrupted.controller.dispose();
    return { manual: fixture.manual, ride, transitionStart, follow, userCamera, afterManualInterrupt };
  });
  expect(result.ride.pitch).toBeCloseTo(1.04, 2);
  expect(result.transitionStart.yaw).toBeCloseTo(result.manual.yaw, 8);
  expect(result.transitionStart.pitch).toBeCloseTo(result.manual.pitch, 8);
  expect(result.transitionStart.distance).toBeCloseTo(result.manual.distance, 8);
  expect(result.follow.yaw).toBeCloseTo(result.manual.yaw, 8);
  expect(result.follow.pitch).toBeCloseTo(result.manual.pitch, 8);
  expect(result.follow.distance).toBeCloseTo(result.manual.distance, 8);
  expect(result.afterManualInterrupt).toEqual(result.userCamera);
});

test("optional renderer chunks report delayed and failed imports and ignore late disposal completions", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/optional-renderer.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/optional-renderer.js");
    const waitFor = async (predicate) => {
      const deadline = performance.now() + 3_000;
      while (!predicate()) {
        if (performance.now() >= deadline) throw new Error("Timed out waiting for optional renderer status");
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    const canvases = () => [document.createElement("canvas"), document.createElement("canvas")];
    const attach = (pairs) => pairs.forEach((canvas) => {
      Object.assign(canvas.style, { width: "800px", height: "600px" });
      document.body.append(canvas);
    });
    const detach = (pairs) => pairs.forEach((canvas) => canvas.remove());
    const overlay = () => ({ drawTaskOverlays: () => undefined });
    const delayedCanvases = canvases();
    attach(delayedCanvases);
    let resolveDelayed;
    const delayedStatuses = [];
    const delayed = new RendererController(...delayedCanvases, {
      onModuleStatus: (module, status) => delayedStatuses.push([module, status]),
      loadDrawOverlays: () => new Promise((resolve) => { resolveDelayed = resolve; }),
    });
    delayed.setState(createGalleryState("draw"));
    await waitFor(() => delayedStatuses.some(([module, status]) => module === "draw-overlays" && status === "loading"));
    const stayedLoading = !delayedStatuses.some(([module, status]) => module === "draw-overlays" && status === "ready");
    resolveDelayed(overlay());
    await waitFor(() => delayedStatuses.some(([module, status]) => module === "draw-overlays" && status === "ready"));
    delayed.dispose();
    detach(delayedCanvases);

    const failedCanvases = canvases();
    attach(failedCanvases);
    let failures = 0;
    const failedStatuses = [];
    const failed = new RendererController(...failedCanvases, {
      onModuleStatus: (module, status) => failedStatuses.push([module, status]),
      loadDrawOverlays: () => { failures += 1; return Promise.reject(new Error("offline")); },
    });
    const draw = createGalleryState("draw");
    failed.setState(draw);
    await waitFor(() => failedStatuses.some(([module, status]) => module === "draw-overlays" && status === "failed"));
    failed.setState(draw);
    await new Promise((resolve) => setTimeout(resolve, 40));
    failed.dispose();
    detach(failedCanvases);

    const timedCanvases = canvases();
    attach(timedCanvases);
    const timedStatuses = [];
    const originalSetTimeout = window.setTimeout;
    window.setTimeout = function (callback, delay, ...args) {
      return originalSetTimeout.call(window, callback, delay > 1_000 ? 0 : delay, ...args);
    };
    const timed = new RendererController(...timedCanvases, {
      onModuleStatus: (module, status) => timedStatuses.push([module, status]),
      loadDrawOverlays: () => new Promise(() => undefined),
    });
    timed.setState(createGalleryState("draw"));
    try {
      await waitFor(() => timedStatuses.some(([module, status]) => module === "draw-overlays" && status === "failed"));
    } finally {
      window.setTimeout = originalSetTimeout;
    }
    timed.dispose();
    detach(timedCanvases);

    const disposedCanvases = canvases();
    attach(disposedCanvases);
    let resolveLate;
    const disposedStatuses = [];
    const disposed = new RendererController(...disposedCanvases, {
      onModuleStatus: (module, status) => disposedStatuses.push([module, status]),
      loadDrawOverlays: () => new Promise((resolve) => { resolveLate = resolve; }),
    });
    disposed.setState(createGalleryState("draw"));
    await waitFor(() => disposedStatuses.some(([module, status]) => module === "draw-overlays" && status === "loading"));
    disposed.dispose();
    resolveLate(overlay());
    await new Promise((resolve) => setTimeout(resolve, 40));
    detach(disposedCanvases);

    const neverCanvases = canvases();
    attach(neverCanvases);
    const neverStatuses = [];
    const originalThen = Promise.prototype.then;
    let disposalRejections = 0;
    Promise.prototype.then = function (onFulfilled, onRejected) {
      return originalThen.call(this, onFulfilled, onRejected && function (reason) {
        if (reason?.message === "renderer-module-disposed") disposalRejections += 1;
        return onRejected.call(this, reason);
      });
    };
    const never = new RendererController(...neverCanvases, {
      onModuleStatus: (module, status) => neverStatuses.push([module, status]),
      loadDrawOverlays: () => new Promise(() => undefined),
    });
    never.setState(createGalleryState("draw"));
    await waitFor(() => neverStatuses.some(([module, status]) => module === "draw-overlays" && status === "loading"));
    never.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    Promise.prototype.then = originalThen;
    detach(neverCanvases);
    return {
      stayedLoading,
      delayedReady: delayedStatuses.some(([module, status]) => module === "draw-overlays" && status === "ready"),
      failedOnce: failures === 1,
      failedVisible: failedStatuses.some(([module, status]) => module === "draw-overlays" && status === "failed"),
      unresolvedTimedOut: timedStatuses.some(([module, status]) => module === "draw-overlays" && status === "failed"),
      noLateReady: !disposedStatuses.some(([module, status]) => module === "draw-overlays" && status === "ready"),
      neverSettledOnDispose: disposalRejections === 1,
    };
  });
  expect(result).toEqual({ stayedLoading: true, delayedReady: true, failedOnce: true, failedVisible: true, unresolvedTimedOut: true, noLateReady: true, neverSettledOnDispose: true });
});
