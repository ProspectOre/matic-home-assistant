import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function loadControllerHarness(page) {
  const bundle = await build({
    stdin: {
      contents: `
        export { GestureController } from "./frontend/map-studio-v4/gesture-controller";
        export { RendererController } from "./frontend/map-studio-v4/renderer-controller";
        export { initialWorkspaceState } from "./frontend/map-studio-v4/state";
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/page-suspension-controller-test.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    window.__pageSuspension = await import("/page-suspension-controller-test.js");
  });
}

test("@safety page suspension cancels gestures and rendering while retaining the renderer for one-frame resume", async ({ page }) => {
  await loadControllerHarness(page);
  const result = await page.evaluate(() => {
    const { GestureController, RendererController, initialWorkspaceState } = window.__pageSuspension;
    const pendingFrames = new Map();
    let nextFrame = 0;
    let canceledFrames = 0;
    window.requestAnimationFrame = (callback) => {
      const id = ++nextFrame;
      pendingFrames.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (pendingFrames.delete(id)) canceledFrames += 1;
    };

    const sceneCanvas = document.createElement("canvas");
    const overlayCanvas = document.createElement("canvas");
    document.body.append(sceneCanvas, overlayCanvas);
    let state = { ...initialWorkspaceState(), pageActive: true, workflow: "none", view: "three" };
    const renderer = new RendererController(sceneCanvas, overlayCanvas);
    renderer.setState(state);

    const gestureHost = document.createElement("div");
    gestureHost.tabIndex = 0;
    document.body.append(gestureHost);
    gestureHost.setPointerCapture = () => {};
    gestureHost.releasePointerCapture = () => {};
    gestureHost.hasPointerCapture = () => true;
    let mockCamera = { yaw: 0, pitch: 0.8, distance: 8, targetX: 0, targetZ: 0, orthographic: false };
    let cameraChanges = 0;
    const cursorValues = [];
    const mockRenderer = {
      get camera() { return { ...mockCamera }; },
      setCamera(camera) { mockCamera = camera; cameraChanges += 1; },
      cameraAfterPan(camera) { return camera; },
      screenToMap(x, y) { return { x, y }; },
      setCursor(point) { cursorValues.push(point); },
      roomAt() { return null; },
      panBy() { cameraChanges += 1; },
      orbitBy() { cameraChanges += 1; },
      zoomAt() { cameraChanges += 1; },
      fit() { cameraChanges += 1; },
      containsMapPoint() { return true; },
    };
    const gesture = new GestureController(gestureHost, mockRenderer, {
      state: () => state,
      onCirclePreview: () => {},
      onCircles: () => {},
      onRoom: () => {},
    });
    const pointer = (type, x, y) => new PointerEvent(type, {
      pointerId: 9,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    gestureHost.dispatchEvent(pointer("pointerdown", 20, 20));
    gestureHost.dispatchEvent(pointer("pointermove", 100, 20));
    gestureHost.dispatchEvent(pointer("pointerup", 100, 20));
    const inertiaFrameQueued = pendingFrames.size > 0;

    state = { ...state, pageActive: false };
    gesture.observeState(state);
    renderer.setState(state);
    const queuedWhileSuspended = pendingFrames.size;
    const changesAtSuspend = cameraChanges;
    gestureHost.dispatchEvent(pointer("pointermove", 140, 40));
    gestureHost.dispatchEvent(pointer("pointerup", 140, 40));
    renderer.setCamera({ ...renderer.camera, yaw: 0.4 });
    const queuedAfterSuspendedUpdates = pendingFrames.size;
    const changesAfterSuspendedEvents = cameraChanges;

    state = { ...state, pageActive: true };
    gesture.observeState(state);
    renderer.setState(state);
    const queuedOnResume = pendingFrames.size;
    const resumedFrameCallbacks = [...pendingFrames.values()];
    pendingFrames.clear();
    resumedFrameCallbacks.forEach((callback) => callback(performance.now()));

    gesture.dispose();
    renderer.dispose();
    return {
      inertiaFrameQueued,
      queuedWhileSuspended,
      queuedAfterSuspendedUpdates,
      queuedOnResume,
      canceledFrames,
      changesAtSuspend,
      changesAfterSuspendedEvents,
      lastCursor: cursorValues.at(-1),
      navigatingClass: gestureHost.classList.contains("navigating"),
      cameraYawAfterResume: renderer.camera.yaw,
      canvasRetained: sceneCanvas.isConnected,
    };
  });

  expect(result).toMatchObject({
    inertiaFrameQueued: true,
    queuedWhileSuspended: 0,
    queuedAfterSuspendedUpdates: 0,
    queuedOnResume: 1,
    changesAfterSuspendedEvents: result.changesAtSuspend,
    lastCursor: null,
    navigatingClass: false,
    cameraYawAfterResume: 0.4,
    canvasRetained: true,
  });
  expect(result.canceledFrames).toBeGreaterThan(0);
});
