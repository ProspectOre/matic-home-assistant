import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function gesture(page, view, kind, delta = 60) {
  const bundle = await build({
    stdin: {
      contents: 'export { GestureController } from "./frontend/map-studio-v4/gesture-controller"; export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/two-finger-pan.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return page.evaluate(async ({ view, kind, delta }) => {
    const { GestureController, RendererController, createGalleryState } = await import("/two-finger-pan.js");
    const state = view === "draw"
      ? createGalleryState("draw")
      : { ...createGalleryState("ready"), view };
    const host = document.createElement("div");
    host.tabIndex = 0;
    Object.assign(host.style, { position: "absolute", left: "20px", top: "20px", width: "800px", height: "600px" });
    // Synthetic events do not register active browser pointers for capture.
    const capturedPointers = new Set();
    const releasedPointers = [];
    host.setPointerCapture = (id) => capturedPointers.add(id);
    host.hasPointerCapture = (id) => capturedPointers.has(id);
    host.releasePointerCapture = (id) => {
      if (capturedPointers.delete(id)) releasedPointers.push(id);
    };
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    for (const canvas of canvases) {
      Object.assign(canvas.style, { position: "absolute", width: "800px", height: "600px" });
      host.append(canvas);
    }
    document.body.append(host);
    const renderer = new RendererController(...canvases);
    let mutations = 0;
    let cancelledFrames = 0;
    const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    window.cancelAnimationFrame = (frameId) => {
      cancelledFrames += 1;
      return cancelAnimationFrame(frameId);
    };
    const controller = new GestureController(host, renderer, {
      state: () => state,
      onCircles: () => { mutations += 1; },
      onCirclePreview: (circles) => { if (circles?.length) mutations += 1; },
      onRoom: () => { mutations += 1; },
    });
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const dispatch = (type, id, x, y) => host.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: "touch", pointerId: id,
      isPrimary: id === 11, button: 0, clientX: x, clientY: y,
    }));
    try {
      renderer.setState(state);
      await frame();
      renderer.setCamera({ ...renderer.camera, yaw: 0.3, pitch: 1,
        distance: renderer.camera.distance * 0.7, targetX: 0, targetZ: 0 });
      const before = renderer.camera;
      const first = kind === "largeGapStationary" ? [100, 320]
        : kind === "angleWrap" ? [520, 320] : [320, 320];
      const second = kind === "largeGapStationary" ? [700, 320]
        : kind === "angleWrap" ? [320, 321.75]
        : kind === "closeLeadTilt" ? [380, 320] : [520, 320];
      dispatch("pointerdown", 11, ...first);
      if (kind === "singlePan") {
        const samples = [];
        for (let step = 1; step <= 4; step += 1) {
          first[0] = 320 + 48 * step / 4;
          first[1] = 320 + 36 * step / 4;
          dispatch("pointermove", 11, ...first);
          await frame();
          samples.push(renderer.camera);
        }
        dispatch("pointerup", 11, ...first);
        return { before, samples, mutations };
      }
      if (kind === "preJoinPan") {
        first[0] = 360;
        first[1] = 350;
        dispatch("pointermove", 11, ...first);
        await frame();
        const joinCamera = renderer.camera;
        second[0] = 560;
        second[1] = 350;
        dispatch("pointerdown", 12, ...second);
        first[1] += delta;
        second[1] += delta;
        dispatch("pointermove", 11, ...first);
        dispatch("pointermove", 12, ...second);
        await frame();
        const after = renderer.camera;
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before: joinCamera, samples: [after], mutations };
      }
      dispatch("pointerdown", 12, ...second);
      if (kind === "angleWrap") {
        second[1] = 318.25;
        dispatch("pointermove", 12, ...second);
        await frame();
        const pending = renderer.camera;
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before, samples: [pending, renderer.camera], mutations };
      }
      if (kind === "largeGapStationary") {
        second[1] = 344;
        dispatch("pointermove", 12, ...second);
        await frame();
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        const samples = [renderer.camera];
        return { before, samples, mutations };
      }
      if (kind === "gradualTilt") {
        const samples = [];
        first[1] = 324;
        dispatch("pointermove", 11, ...first);
        await frame();
        samples.push(renderer.camera);
        dispatch("pointermove", 12, 520, 324);
        second[1] = 324;
        await frame();
        samples.push(renderer.camera);
        for (const y of [328, 332]) {
          first[1] = second[1] = y;
          dispatch("pointermove", 11, ...first);
          dispatch("pointermove", 12, ...second);
          await frame();
          samples.push(renderer.camera);
        }
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before, samples, mutations, cancelledFrames };
      }
      if (kind === "closeLeadTilt") {
        // Close fingers make a lone 11px lead look like an 0.18rad twist.
        first[1] = 331;
        dispatch("pointermove", 11, ...first);
        await frame();
        const firstOnly = renderer.camera;
        second[1] = 331;
        dispatch("pointermove", 12, ...second);
        await frame();
        const aligned = renderer.camera;
        first[1] = second[1] = 352;
        dispatch("pointermove", 11, ...first);
        dispatch("pointermove", 12, ...second);
        await frame();
        const tilted = renderer.camera;
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before, samples: [firstOnly, aligned, tilted], mutations };
      }
      if (kind === "largeLeadTilt") {
        first[1] = 336;
        dispatch("pointermove", 11, ...first);
        await frame();
        const firstOnly = renderer.camera;
        second[1] = 336;
        dispatch("pointermove", 12, ...second);
        await frame();
        const aligned = renderer.camera;
        first[1] = second[1] = 352;
        dispatch("pointermove", 11, ...first);
        dispatch("pointermove", 12, ...second);
        await frame();
        const tilted = renderer.camera;
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before, samples: [firstOnly, aligned, tilted], mutations };
      }
      if (kind === "noisyTilt") {
        const samples = [];
        for (const [firstX, firstY, secondX, secondY] of [
          [315, 328, 525, 330],
          [318, 334, 524, 338],
          [318, 346, 524, 344],
        ]) {
          first[0] = firstX;
          first[1] = firstY;
          second[0] = secondX;
          second[1] = secondY;
          dispatch("pointermove", 11, ...first);
          dispatch("pointermove", 12, ...second);
          await frame();
          samples.push(renderer.camera);
        }
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before, samples, mutations };
      }
      if (kind === "spreadThenParallel") {
        const samples = [];
        first[0] = 315;
        first[1] = 333;
        second[0] = 525;
        second[1] = 333;
        dispatch("pointermove", 11, ...first);
        dispatch("pointermove", 12, ...second);
        await frame();
        samples.push(renderer.camera);
        first[0] = 318;
        first[1] = 353;
        second[0] = 524;
        second[1] = 353;
        dispatch("pointermove", 11, ...first);
        dispatch("pointermove", 12, ...second);
        await frame();
        samples.push(renderer.camera);
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before, samples, mutations };
      }
      if (kind === "zeroJitterThenTilt" || kind === "horizontalJitterThenTilt") {
        if (kind === "horizontalJitterThenTilt") first[0] += 1;
        dispatch("pointermove", 11, ...first);
        await frame();
        const jitter = renderer.camera;
        first[1] += 60;
        second[1] += 60;
        dispatch("pointermove", 11, ...first);
        dispatch("pointermove", 12, ...second);
        await frame();
        const tilted = renderer.camera;
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before, samples: [jitter, tilted], mutations };
      }
      if (kind === "shortVerticalRelease") {
        first[1] = second[1] = 328;
        dispatch("pointermove", 11, ...first);
        dispatch("pointermove", 12, ...second);
        await frame();
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        const samples = [renderer.camera];
        return { before, samples, mutations };
      }
      if (kind === "cancelSecond") {
        dispatch("pointercancel", 12, ...second);
        first[0] = 360;
        first[1] = 350;
        dispatch("pointermove", 11, ...first);
        await frame();
        const samples = [renderer.camera];
        dispatch("pointerup", 11, ...first);
        return { before, samples, mutations };
      }
      if (kind === "stationaryPinch") {
        first[0] = 260;
        dispatch("pointermove", 11, ...first);
        await frame();
        const samples = [renderer.camera];
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before, samples, mutations };
      }
      if (kind === "stationaryTwist") {
        second[0] = 320;
        second[1] = 520;
        dispatch("pointermove", 12, ...second);
        await frame();
        const samples = [renderer.camera];
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before, samples, mutations };
      }
      if (kind === "stationaryVertical18") {
        first[1] = 338;
        dispatch("pointermove", 11, ...first);
        await frame();
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        const samples = [renderer.camera];
        return { before, samples, mutations };
      }
      if (kind === "spreadVertical") {
        first[0] = 315;
        first[1] = 340;
        second[0] = 525;
        second[1] = 340;
        dispatch("pointermove", 11, ...first);
        dispatch("pointermove", 12, ...second);
        await frame();
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before, samples: [renderer.camera], mutations };
      }
      if (kind === "blurQueued") {
        first[1] = second[1] = 350;
        dispatch("pointermove", 11, ...first);
        dispatch("pointermove", 12, ...second);
        host.dispatchEvent(new Event("blur"));
        await frame();
        return { before, samples: [renderer.camera], mutations, cancelledFrames, releasedPointers };
      }
      if (kind === "combined") {
        first[0] = 380;
        first[1] = 350;
        second[0] = 550;
        second[1] = 410;
        dispatch("pointermove", 11, ...first);
        dispatch("pointermove", 12, ...second);
        await frame();
        const samples = [renderer.camera];
        dispatch("pointerup", 11, ...first);
        dispatch("pointerup", 12, ...second);
        return { before, samples, mutations };
      }
      const samples = [];
      let firstMove;
      for (let step = 1; step <= 4; step += 1) {
        const t = step / 4;
        if (kind === "pan") {
          first[1] = second[1] = 320 + delta * t;
        } else if (kind === "pinch") {
          first[0] = 320 - 40 * t;
          second[0] = 520 + 40 * t;
        } else {
          const angle = Math.PI / 2 * t;
          first[0] = 420 - 100 * Math.cos(angle);
          first[1] = 320 - 100 * Math.sin(angle);
          second[0] = 420 + 100 * Math.cos(angle);
          second[1] = 320 + 100 * Math.sin(angle);
        }
        dispatch("pointermove", 11, ...first);
        if (step === 1) firstMove = renderer.camera;
        dispatch("pointermove", 12, ...second);
        await frame();
        samples.push(renderer.camera);
      }
      dispatch("pointerup", 11, ...first);
      dispatch("pointerup", 12, ...second);
      return { before, samples, firstMove, mutations };
    } finally {
      controller.dispose();
      renderer.dispose();
      host.remove();
    }
  }, { view, kind, delta });
}

test("one-finger touch drag pans the 3D map", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "singlePan");
  const after = samples.at(-1);
  expect(Math.hypot(after.targetX - before.targetX, after.targetZ - before.targetZ)).toBeGreaterThan(0.01);
  expect(after.pitch).toBeCloseTo(before.pitch, 8);
  expect(after.yaw).toBeCloseTo(before.yaw, 8);
  expect(mutations).toBe(0);
});

test("two-finger movement in Draw pans the top view and cancels the pending paint without editing", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "draw", "pan", 60);
  const after = samples.at(-1);
  expect(Math.hypot(after.targetX - before.targetX, after.targetZ - before.targetZ)).toBeGreaterThan(0.01);
  expect(after.yaw).toBeCloseTo(before.yaw, 8);
  expect(mutations).toBe(0);
});

test("when one contact is cancelled, the remaining finger pans without editing", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "cancelSecond");
  const after = samples.at(-1);
  expect(Math.hypot(after.targetX - before.targetX, after.targetZ - before.targetZ)).toBeGreaterThan(0.01);
  expect(after.pitch).toBeCloseTo(before.pitch, 8);
  expect(after.yaw).toBeCloseTo(before.yaw, 8);
  expect(mutations).toBe(0);
});

test("pinching with one stationary anchor still zooms", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "stationaryPinch");
  const after = samples.at(-1);
  expect(after.distance).toBeLessThan(before.distance * 0.8);
  expect(after.pitch).toBeCloseTo(before.pitch, 8);
  expect(after.yaw).toBeCloseTo(before.yaw, 8);
  expect(mutations).toBe(0);
});

test("twisting around one stationary anchor still rotates and pans", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "stationaryTwist");
  const after = samples.at(-1);
  expect(Math.abs(after.yaw - before.yaw)).toBeGreaterThan(1);
  expect(after.distance).toBeCloseTo(before.distance, 8);
  expect(Math.hypot(after.targetX - before.targetX, after.targetZ - before.targetZ)).toBeGreaterThan(0.01);
  expect(mutations).toBe(0);
});

test("a stationary anchor with an 18px vertical move remains a composed transform, not tilt", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "stationaryVertical18");
  const after = samples.at(-1);
  expect(Math.abs(after.yaw - before.yaw)).toBeGreaterThan(0.05);
  expect(after.pitch).toBeCloseTo(before.pitch, 8);
  expect(after.distance).not.toBeCloseTo(before.distance, 4);
  expect(mutations).toBe(0);
});

test("a wide stationary-anchor vertical movement remains composed instead of tilting", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "largeGapStationary");
  const after = samples.at(-1);
  expect(after.pitch).toBeCloseTo(before.pitch, 8);
  expect(Math.abs(after.yaw - before.yaw)).toBeGreaterThan(0.02);
  expect(after.distance).not.toBeCloseTo(before.distance, 4);
  expect(Math.hypot(after.targetX - before.targetX, after.targetZ - before.targetZ)).toBeGreaterThan(0.01);
  expect(mutations).toBe(0);
});

test("interleaved gradual vertical movement buffers pan until 3D tilt is resolved", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "gradualTilt");
  for (const sample of samples.slice(0, 2)) {
    expect(sample.targetX).toBeCloseTo(before.targetX, 8);
    expect(sample.targetZ).toBeCloseTo(before.targetZ, 8);
    expect(sample.pitch).toBeCloseTo(before.pitch, 8);
  }
  const after = samples.at(-1);
  expect(Math.abs(after.pitch - before.pitch)).toBeGreaterThan(0.02);
  expect(after.targetX).toBeCloseTo(before.targetX, 8);
  expect(after.targetZ).toBeCloseTo(before.targetZ, 8);
  expect(mutations).toBe(0);
});

test("a large one-finger lead stays buffered until the second finger confirms 3D tilt", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "largeLeadTilt");
  expect(samples[0].targetX).toBeCloseTo(before.targetX, 8);
  expect(samples[0].targetZ).toBeCloseTo(before.targetZ, 8);
  expect(samples[0].pitch).toBeCloseTo(before.pitch, 8);
  expect(samples[1].targetX).toBeCloseTo(before.targetX, 8);
  expect(samples[1].targetZ).toBeCloseTo(before.targetZ, 8);
  const after = samples.at(-1);
  expect(Math.abs(after.pitch - before.pitch)).toBeGreaterThan(0.02);
  expect(after.targetX).toBeCloseTo(before.targetX, 8);
  expect(after.targetZ).toBeCloseTo(before.targetZ, 8);
  expect(mutations).toBe(0);
});

test("a lone lead between close fingers is not mistaken for a twist before 3D tilt", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "closeLeadTilt");
  for (const sample of samples) {
    expect(sample.targetX).toBeCloseTo(before.targetX, 8);
    expect(sample.targetZ).toBeCloseTo(before.targetZ, 8);
    expect(sample.yaw).toBeCloseTo(before.yaw, 8);
    expect(sample.distance).toBeCloseTo(before.distance, 8);
  }
  expect(samples[0].pitch).toBeCloseTo(before.pitch, 8);
  expect(samples[1].pitch).toBeCloseTo(before.pitch, 8);
  expect(Math.abs(samples.at(-1).pitch - before.pitch)).toBeGreaterThan(0.05);
  expect(mutations).toBe(0);
});

test("a slightly uneven parallel two-finger drag still tilts smoothly", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "noisyTilt");
  expect(samples[0].pitch).toBeCloseTo(before.pitch, 8);
  expect(samples[0].targetX).toBeCloseTo(before.targetX, 8);
  expect(samples[0].targetZ).toBeCloseTo(before.targetZ, 8);
  for (const sample of samples) {
    expect(sample.targetX).toBeCloseTo(before.targetX, 8);
    expect(sample.targetZ).toBeCloseTo(before.targetZ, 8);
    expect(sample.yaw).toBeCloseTo(before.yaw, 8);
    expect(sample.distance).toBeCloseTo(before.distance, 8);
  }
  expect(Math.abs(samples.at(-1).pitch - before.pitch)).toBeGreaterThan(0.05);
  expect(mutations).toBe(0);
});

test("a composed vertical transform stays composed when finger spread settles", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "spreadThenParallel");
  expect(samples[0].pitch).toBeCloseTo(before.pitch, 8);
  expect(samples[1].pitch).toBeCloseTo(before.pitch, 8);
  expect(samples[1].yaw).toBeCloseTo(before.yaw, 8);
  expect(samples[0].distance).toBeLessThan(before.distance);
  expect(samples[1].distance).toBeGreaterThan(samples[0].distance);
  expect(mutations).toBe(0);
});

for (const kind of ["zeroJitterThenTilt", "horizontalJitterThenTilt"]) {
  test(`${kind === "zeroJitterThenTilt" ? "a zero-delta move" : "one-pixel horizontal jitter"} does not preempt 3D tilt`, async ({ page }) => {
    const { before, samples, mutations } = await gesture(page, "three", kind);
    const [jitter, tilted] = samples;
    expect(jitter.targetX).toBeCloseTo(before.targetX, 8);
    expect(jitter.targetZ).toBeCloseTo(before.targetZ, 8);
    expect(jitter.pitch).toBeCloseTo(before.pitch, 8);
    expect(tilted.targetX).toBeCloseTo(before.targetX, 8);
    expect(tilted.targetZ).toBeCloseTo(before.targetZ, 8);
    expect(tilted.yaw).toBeCloseTo(before.yaw, 8);
    expect(tilted.distance).toBeCloseTo(before.distance, 8);
    expect(Math.abs(tilted.pitch - before.pitch)).toBeGreaterThan(0.15);
    expect(mutations).toBe(0);
  });
}

test("a small twist crossing the atan2 boundary stays small and does not jump", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "angleWrap");
  expect(samples[0].yaw).toBeCloseTo(before.yaw, 8);
  expect(samples[0].pitch).toBeCloseTo(before.pitch, 8);
  expect(Math.abs(samples[1].yaw - before.yaw)).toBeGreaterThan(0.01);
  expect(Math.abs(samples[1].yaw - before.yaw)).toBeLessThan(0.03);
  expect(mutations).toBe(0);
});

test("a short parallel vertical gesture pans when released before tilt threshold", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "shortVerticalRelease");
  const after = samples.at(-1);
  expect(after.pitch).toBeCloseTo(before.pitch, 8);
  expect(Math.hypot(after.targetX - before.targetX, after.targetZ - before.targetZ)).toBeGreaterThan(0.01);
  expect(mutations).toBe(0);
});

test("vertical translation with deliberate finger spread preserves zoom instead of tilting", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "spreadVertical");
  const after = samples.at(-1);
  expect(after.pitch).toBeCloseTo(before.pitch, 8);
  expect(after.distance).not.toBeCloseTo(before.distance, 3);
  expect(Math.hypot(after.targetX - before.targetX, after.targetZ - before.targetZ)).toBeGreaterThan(0.01);
  expect(mutations).toBe(0);
});

test("blur cancels a queued camera update and releases both pointer captures", async ({ page }) => {
  const { before, samples, mutations, cancelledFrames, releasedPointers } = await gesture(page, "three", "blurQueued");
  const after = samples.at(-1);
  expect(after.pitch).toBeCloseTo(before.pitch, 8);
  expect(after.yaw).toBeCloseTo(before.yaw, 8);
  expect(after.distance).toBeCloseTo(before.distance, 8);
  expect(after.targetX).toBeCloseTo(before.targetX, 8);
  expect(after.targetZ).toBeCloseTo(before.targetZ, 8);
  expect(mutations).toBe(0);
  expect(cancelledFrames).toBeGreaterThan(0);
  expect(releasedPointers.sort()).toEqual([11, 12]);
});

test("combined two-finger translation, pinch, and twist preserve all transform components", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "combined");
  const after = samples.at(-1);
  expect(after.distance).not.toBeCloseTo(before.distance, 2);
  expect(Math.abs(after.yaw - before.yaw)).toBeGreaterThan(0.1);
  expect(Math.hypot(after.targetX - before.targetX, after.targetZ - before.targetZ)).toBeGreaterThan(0.01);
  expect(mutations).toBe(0);
});

test("a one-finger pan before the second contact does not contaminate 3D tilt intent", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "preJoinPan", 60);
  const after = samples.at(-1);
  expect(Math.abs(after.pitch - before.pitch)).toBeGreaterThan(0.15);
  expect(after.yaw).toBeCloseTo(before.yaw, 8);
  expect(after.distance).toBeCloseTo(before.distance, 8);
  expect(after.targetX).toBeCloseTo(before.targetX, 8);
  expect(after.targetZ).toBeCloseTo(before.targetZ, 8);
  expect(mutations).toBe(0);
});

for (const view of ["three", "top"]) {
  for (const delta of [-60, 60]) {
    test(`parallel two-finger ${delta < 0 ? "up" : "down"} drag ${view === "three" ? "tilts" : "pans"} without editing areas`, async ({ page }) => {
      const result = await gesture(page, view, "pan", delta);
      // PointerEvents for the two fingers arrive separately. Do not apply the
      // first contact's half-movement while its partner is still stationary.
      expect(result.firstMove.pitch).toBeCloseTo(result.before.pitch, 8);
      expect(result.firstMove.yaw).toBeCloseTo(result.before.yaw, 8);
      expect(result.firstMove.targetX).toBeCloseTo(result.before.targetX, 8);
      expect(result.firstMove.targetZ).toBeCloseTo(result.before.targetZ, 8);
      for (const sample of result.samples) {
        expect(sample.yaw).toBeCloseTo(result.before.yaw, 8);
        expect(sample.distance).toBeCloseTo(result.before.distance, 8);
      }
      const after = result.samples.at(-1);
      if (view === "three") {
        expect(Math.abs(after.pitch - result.before.pitch)).toBeGreaterThan(0.15);
        expect(after.pitch).toBeLessThanOrEqual(1.38);
        expect(after.pitch).toBeGreaterThanOrEqual(0.18);
        expect(after.targetX).toBeCloseTo(result.before.targetX, 8);
        expect(after.targetZ).toBeCloseTo(result.before.targetZ, 8);
      } else {
        expect(after.pitch).toBeCloseTo(result.before.pitch, 8);
        expect(Math.hypot(after.targetX - result.before.targetX, after.targetZ - result.before.targetZ)).toBeGreaterThan(0.01);
      }
      expect(result.mutations).toBe(0);
    });
  }
}

test("intentional two-finger pinch still zooms without changing camera angle", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "pinch");
  const after = samples.at(-1);
  expect(after.distance).toBeLessThan(before.distance * 0.9);
  expect(after.pitch).toBeCloseTo(before.pitch, 8);
  expect(after.yaw).toBeCloseTo(before.yaw, 8);
  expect(mutations).toBe(0);
});

test("intentional two-finger twist still rotates without changing scale or tilt", async ({ page }) => {
  const { before, samples, mutations } = await gesture(page, "three", "twist");
  const after = samples.at(-1);
  expect(Math.abs(after.yaw - before.yaw)).toBeGreaterThan(1);
  expect(after.distance).toBeCloseTo(before.distance, 8);
  expect(after.pitch).toBeCloseTo(before.pitch, 8);
  expect(mutations).toBe(0);
});
