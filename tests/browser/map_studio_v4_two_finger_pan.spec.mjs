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
    const state = { ...createGalleryState("ready"), view };
    const host = document.createElement("div");
    host.tabIndex = 0;
    Object.assign(host.style, { position: "absolute", left: "20px", top: "20px", width: "800px", height: "600px" });
    // Synthetic events do not register active browser pointers for capture.
    host.setPointerCapture = host.releasePointerCapture = () => {};
    const canvases = [document.createElement("canvas"), document.createElement("canvas")];
    for (const canvas of canvases) {
      Object.assign(canvas.style, { position: "absolute", width: "800px", height: "600px" });
      host.append(canvas);
    }
    document.body.append(host);
    const renderer = new RendererController(...canvases);
    let mutations = 0;
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
      const first = [320, 320];
      const second = [520, 320];
      dispatch("pointerdown", 11, ...first);
      dispatch("pointerdown", 12, ...second);
      const samples = [];
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
        dispatch("pointermove", 12, ...second);
        await frame();
        samples.push(renderer.camera);
      }
      dispatch("pointerup", 11, ...first);
      dispatch("pointerup", 12, ...second);
      return { before, samples, mutations };
    } finally {
      controller.dispose();
      renderer.dispose();
      host.remove();
    }
  }, { view, kind, delta });
}

for (const view of ["three", "top"]) {
  for (const delta of [-60, 60]) {
    test(`parallel two-finger ${delta < 0 ? "up" : "down"} pan preserves the ${view} camera angle and scale`, async ({ page }) => {
      const result = await gesture(page, view, "pan", delta);
      for (const sample of result.samples) {
        expect(sample.pitch).toBeCloseTo(result.before.pitch, 8);
        expect(sample.yaw).toBeCloseTo(result.before.yaw, 8);
        expect(sample.distance).toBeCloseTo(result.before.distance, 8);
      }
      const after = result.samples.at(-1);
      expect(Math.hypot(after.targetX - result.before.targetX, after.targetZ - result.before.targetZ)).toBeGreaterThan(0.01);
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
