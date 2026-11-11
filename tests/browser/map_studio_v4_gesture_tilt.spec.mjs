import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export { GestureController } from "./frontend/map-studio-v4/gesture-controller";
export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  write: false,
});

test.beforeEach(async ({ page }) => {
  await page.route("**/gesture-tilt-test.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.goto("/");
  await page.evaluate(async () => {
    window.__gestureTilt = await import("/gesture-tilt-test.js");
  });
});

async function runGesture(page, { kind, gap = 90, jitter = 0, lag = 0, commonDrift = 0 }) {
  return page.evaluate(async ({ kind, gap, jitter, lag, commonDrift }) => {
    const { GestureController, createGalleryState } = window.__gestureTilt;
    const host = document.createElement("div");
    document.body.append(host);
    host.setPointerCapture = () => {};
    host.releasePointerCapture = () => {};
    host.hasPointerCapture = () => false;

    let camera = {
      yaw: 0.2,
      pitch: 0.82,
      distance: 10,
      targetX: 2,
      targetZ: -1,
      orthographic: false,
    };
    let panCalls = 0;
    const renderer = {
      get camera() { return camera; },
      setCamera(next) { camera = next; },
      cameraAfterPan(start, dx, dy) {
        panCalls += 1;
        return { ...start, targetX: start.targetX + dx, targetZ: start.targetZ + dy };
      },
      panBy(dx, dy) { camera = this.cameraAfterPan(camera, dx, dy); },
      orbitBy(dx, dy) {
        camera = { ...camera, yaw: camera.yaw + dx * 0.0045, pitch: camera.pitch - dy * 0.004 };
      },
      screenToMap() { return { x: 0, y: 0 }; },
      setCursor() {},
      roomAt() { return null; },
      roomCandidatesAt() { return Promise.resolve([]); },
    };
    const controller = new GestureController(host, renderer, {
      state: () => createGalleryState("ready"),
      drawReady: () => false,
      onCircles() {},
      onCirclePreview() {},
      onRoom() {},
    });
    const emit = (type, pointerId, x, y, shiftKey = false) => host.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: "touch",
      isPrimary: pointerId === 11,
      button: 0,
      clientX: x,
      clientY: y,
      shiftKey,
    }));
    const originY = 300;
    const originX = 100;
    if (kind === "orbit") emit("pointerdown", 11, originX, originY, true);
    else emit("pointerdown", 11, originX, originY);
    if (kind === "tilt" || kind === "pinch" || kind === "twist") {
      emit("pointerdown", 12, originX + gap, originY);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));

    if (kind === "tilt") {
      // The first contact's updates arrive a few milliseconds before the second
      // contact. This produces intervening animation frames with a stale partner.
      for (let step = 1; step <= 16; step += 1) {
        const progress = step / 16;
        const y = originY + 80 * progress;
        emit("pointermove", 11, originX + commonDrift * progress + jitter * Math.sin(step), y);
        await new Promise((resolve) => setTimeout(resolve, 8));
        emit("pointermove", 12, originX + gap + commonDrift * progress + jitter * (Math.cos(step) - 1),
          y - lag * Math.sin(Math.PI * progress));
        await new Promise((resolve) => setTimeout(resolve, 18));
      }
      const finalY = originY + 80;
      emit("pointerup", 11, originX + commonDrift + jitter * Math.sin(16), finalY);
      emit("pointerup", 12, originX + gap + commonDrift + jitter * (Math.cos(16) - 1), finalY);
    } else if (kind === "pinch") {
      for (let step = 1; step <= 8; step += 1) {
        const progress = step / 8;
        emit("pointermove", 11, originX - 30 * progress, originY);
        await new Promise((resolve) => setTimeout(resolve, 5));
        emit("pointermove", 12, originX + gap + 30 * progress, originY);
        await new Promise((resolve) => setTimeout(resolve, 11));
      }
      emit("pointerup", 11, originX - 30, originY);
      emit("pointerup", 12, originX + gap + 30, originY);
    } else if (kind === "twist") {
      for (let step = 1; step <= 8; step += 1) {
        const angle = 0.45 * step / 8;
        const half = gap / 2;
        emit("pointermove", 11, originX + half - half * Math.cos(angle), originY - half * Math.sin(angle));
        await new Promise((resolve) => setTimeout(resolve, 5));
        emit("pointermove", 12, originX + half + half * Math.cos(angle), originY + half * Math.sin(angle));
        await new Promise((resolve) => setTimeout(resolve, 11));
      }
      const half = gap / 2;
      emit("pointerup", 11, originX + half - half * Math.cos(0.45), originY - half * Math.sin(0.45));
      emit("pointerup", 12, originX + half + half * Math.cos(0.45), originY + half * Math.sin(0.45));
    } else {
      const x = originX + 60;
      const y = originY + 24;
      emit("pointermove", 11, originX + 30, originY + 12);
      await new Promise((resolve) => setTimeout(resolve, 16));
      emit("pointermove", 11, x, y);
      emit("pointerup", 11, x, y);
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const result = { camera, panCalls };
    controller.dispose();
    host.remove();
    return result;
  }, { kind, gap, jitter, lag, commonDrift });
}

for (const sample of [
  { name: "close contacts with 3px lateral jitter and 4px vertical lag", gap: 65, jitter: 3, lag: 4 },
  { name: "uneven contacts with 4px lateral jitter and 8px vertical lag", gap: 100, jitter: 4, lag: 8 },
  { name: "staggered contacts with 2px lateral jitter and 14px vertical lag", gap: 90, jitter: 2, lag: 14 },
]) {
  test(`tilts instead of panning for ${sample.name}`, async ({ page }) => {
    const result = await runGesture(page, { ...sample, kind: "tilt" });

    expect(Math.abs(result.camera.pitch - 0.82)).toBeGreaterThan(0.2);
    expect(result.camera.targetX).toBe(2);
    expect(result.camera.targetZ).toBe(-1);
    expect(result.camera.distance).toBe(10);
    expect(result.camera.yaw).toBe(0.2);
    expect(result.panCalls).toBe(0);
  });
}

test("common 5px horizontal drift does not count as finger spread during tilt", async ({ page }) => {
  const result = await runGesture(page, { kind: "tilt", gap: 100, commonDrift: 5 });

  expect(Math.abs(result.camera.pitch - 0.82)).toBeGreaterThan(0.2);
  expect(result.camera.targetX).toBe(2);
  expect(result.camera.targetZ).toBe(-1);
  expect(result.camera.distance).toBe(10);
  expect(result.camera.yaw).toBe(0.2);
  expect(result.panCalls).toBe(0);
});

test("keeps pinch zoom, two-finger twist, one-finger pan, and Shift orbit", async ({ page }) => {
  const pinch = await runGesture(page, { kind: "pinch" });
  expect(pinch.camera.distance).toBeLessThan(10);
  expect(pinch.camera.pitch).toBe(0.82);
  expect(pinch.camera.targetX).toBe(2);
  expect(pinch.camera.targetZ).toBe(-1);

  const twist = await runGesture(page, { kind: "twist" });
  expect(twist.camera.yaw).toBeGreaterThan(0.2 + 0.3);
  expect(twist.camera.pitch).toBe(0.82);
  expect(twist.camera.targetX).toBe(2);
  expect(twist.camera.targetZ).toBe(-1);

  const pan = await runGesture(page, { kind: "pan" });
  expect(pan.camera.targetX).toBeGreaterThan(2);
  expect(pan.camera.targetZ).toBeGreaterThan(-1);
  expect(pan.camera.yaw).toBe(0.2);
  expect(pan.camera.pitch).toBe(0.82);

  const orbit = await runGesture(page, { kind: "orbit" });
  expect(orbit.camera.yaw).toBeGreaterThan(0.2);
  expect(orbit.camera.pitch).toBeLessThan(0.82);
  expect(orbit.camera.targetX).toBe(2);
  expect(orbit.camera.targetZ).toBe(-1);
});
