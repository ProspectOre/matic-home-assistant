import { expect, test } from "@playwright/test";
import { readdir } from "node:fs/promises";
import { build } from "esbuild";

// The robot is a mesh in the WebGL scene. These tests read the scene canvas
// back and compare frames with and without a heading, which shows the robot
// alone; the thresholds leave room for each engine's antialiasing.

async function installRobot(page) {
  const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { readCanvasPalette } from "./frontend/map-studio-v4/theme-probe"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/robot-model.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  await page.evaluate(async () => {
    const { RendererController, createGalleryState, readCanvasPalette } = await import("/robot-model.js");
    const palette = readCanvasPalette(document.body);
    const [width, height] = [720, 540];
    const scene = document.createElement("canvas"), overlay = document.createElement("canvas");
    for (const canvas of [scene, overlay]) {
      Object.assign(canvas.style, { position: "absolute", width: `${width}px`, height: `${height}px` });
      document.body.append(canvas);
    }
    // Copy the scene after every frame that draws it, before the browser
    // composites and clears it.
    let drew = false, vectors = 0, points = 0;
    const pixels = new Uint8Array(width * height * 4);
    const nativeFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => nativeFrame((time) => {
      drew = false;
      callback(time);
      const gl = scene.getContext("webgl2");
      if (drew && gl && !gl.isContextLost()) gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    });
    const clear = WebGL2RenderingContext.prototype.clear;
    WebGL2RenderingContext.prototype.clear = function(...args) { drew = true; return clear.apply(this, args); };
    // The 2D robot's body is filled in its body or forced accent colour.
    const context = overlay.getContext("2d");
    const { moveTo, lineTo, fill } = context;
    context.moveTo = function(...args) { points = 1; return moveTo.apply(this, args); };
    context.lineTo = function(...args) { points++; return lineTo.apply(this, args); };
    context.fill = function(...args) {
      if (points >= 14 && ["#ecf0f2", "#0c2238"].includes(this.fillStyle)) vectors++;
      return fill.apply(this, args);
    };
    const renderer = new RendererController(scene, overlay);
    const initial = createGalleryState("ready");
    const base = initial.resources.scene.value;
    const { metersPerCell, origin, span } = base.metadata;
    // Four corner points, and optionally a wall half a metre high 0.4 m in
    // front of the robot (towards +y, where a yaw of 0 puts the camera). Its
    // points are sized by the floor's cell, so five rows close the gaps.
    const sceneWith = (wall) => {
      const cells = [[10, 10, 0], [170, 10, 0], [10, 130, 0], [170, 130, 0]];
      if (wall) for (let y = 76; y <= 80; y++) for (let x = 78; x <= 102; x++) for (let z = 0; z <= 10; z++) cells.push([x, y, z]);
      const buffer = new ArrayBuffer(cells.length * 8), view = new DataView(buffer);
      cells.forEach(([x, y, z], index) => {
        view.setUint16(index * 8, x, true);
        view.setUint16(index * 8 + 2, y, true);
        view.setUint8(index * 8 + 4, z);
        for (let channel = 5; channel < 8; channel++) view.setUint8(index * 8 + channel, 90);
      });
      return { ...base, buffer, pointOffset: 0, total: cells.length, floorCount: 4, surfaceCount: cells.length - 4,
        revision: base.revision + (wall ? 2 : 1) };
    };
    const scenes = { open: sceneWith(false), walled: sceneWith(true) };
    // Close-zoom surfaces stay off, so the wall is the points themselves.
    const state = (heading, sceneName) => ({ ...initial, optionalUiReady: false, map: { ...initial.map, exactPose: true },
      resources: { ...initial.resources, scene: { ...initial.resources.scene, value: scenes[sceneName] },
        pose: { status: "ready", problem: null, value: { ...initial.resources.pose.value, position: [4.475, 3.475], heading } } } });
    const frame = () => new Promise(resolve => nativeFrame(() => nativeFrame(resolve)));
    const view = (pitch, yaw, distance) => renderer.setCamera({ ...renderer.camera,
      orthographic: pitch === 90, pitch: pitch * Math.PI / 180, yaw, distance,
      targetX: -(4.475 / metersPerCell - origin[0] - (span[0] - 1) / 2) * metersPerCell,
      targetZ: (3.475 / metersPerCell - origin[1] - (span[1] - 1) / 2) * metersPerCell });
    // The pixels the robot changes, from a frame with its heading and one without.
    const robot = async (heading, camera, sceneName = "open") => {
      renderer.setState(state(null, sceneName));
      view(...camera);
      await frame();
      const without = pixels.slice();
      vectors = 0;
      renderer.setState(state(heading, sceneName));
      await frame();
      let count = 0, sumX = 0, sumY = 0, xx = 0, yy = 0, xy = 0;
      const changed = [];
      for (let index = 0; index < width * height; index++) {
        const offset = index * 4;
        if ([0, 1, 2, 3].every(channel => Math.abs(pixels[offset + channel] - without[offset + channel]) <= 32)) continue;
        const [x, y] = [index % width, Math.floor(index / width)];
        changed.push([x, y]);
        count++; sumX += x; sumY += y;
      }
      const [cx, cy] = [sumX / count, sumY / count];
      for (const [x, y] of changed) { xx += (x - cx) ** 2; yy += (y - cy) ** 2; xy += (x - cx) * (y - cy); }
      const angle = Math.atan2(2 * xy, xx - yy) / 2;
      const along = changed.map(([x, y]) => (x - cx) * Math.cos(angle) + (y - cy) * Math.sin(angle));
      return { count, angle, length: count ? Math.max(...along) - Math.min(...along) : 0, vectors };
    };
    window.__robot = {
      robot,
      forced: (forced) => renderer.setPalette(forced
        ? { ...palette, forced: true, accent: [12, 34, 56], onAccent: [250, 251, 252] } : palette),
      loseContext: () => scene.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext(),
      dispose: () => renderer.dispose(),
    };
  });
}

const turn = (from, to) => {
  const difference = ((to - from) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2;
  return Math.abs(difference);
};

test("the robot turns continuously with its heading and the camera and keeps its size", async ({ page }) => {
  await installRobot(page);
  const robot = (heading, camera) => page.evaluate(([heading, camera]) => window.__robot.robot(heading, camera), [heading, camera]);
  // The chunk loads on the first heading; until then the scene has no robot.
  await expect.poll(async () => (await robot(0, [90, 0, 1])).count).toBeGreaterThan(1000);
  const ahead = await robot(0, [90, 0, 1]);
  expect(ahead.vectors, "WebGL draws the robot, not the 2D canvas").toBe(0);
  // The atlas turned in steps of 11.25 degrees; 0.1 rad is 5.7.
  expect(turn(ahead.angle, (await robot(0.1, [90, 0, 1])).angle)).toBeCloseTo(0.1, 1);
  expect(turn(ahead.angle, (await robot(0.6, [90, 0, 1])).angle)).toBeCloseTo(0.6, 1);
  expect(turn(ahead.angle, (await robot(0, [90, 0.1, 1])).angle)).toBeCloseTo(0.1, 1);
  // Close up it grows with the zoom; zoomed out it stays 18 CSS pixels long
  // (the shadow adds a little).
  const close = await robot(0, [90, 0, 0.3]);
  expect(close.length).toBeGreaterThan(ahead.length * 2.5);
  const far = await robot(0, [90, 0, 40]);
  expect(far.length).toBeGreaterThanOrEqual(17);
  expect(far.length).toBeLessThanOrEqual(24);
  // Lower pitches show its sides: the same robot, seen at a different angle.
  const side = await robot(0, [30, 0, 1]);
  expect(side.count).toBeGreaterThan(1000);
  expect(side.vectors).toBe(0);
  await page.evaluate(() => window.__robot.dispose());
});

test("walls in front of the robot hide it", async ({ page }) => {
  await installRobot(page);
  const robot = (scene) => page.evaluate((scene) => window.__robot.robot(0.6, [20, 0, 6], scene), scene);
  await expect.poll(async () => (await robot("open")).count).toBeGreaterThan(300);
  const open = await robot("open");
  const walled = await robot("walled");
  expect(walled.count).toBeLessThan(open.count * 0.05);
  await page.evaluate(() => window.__robot.dispose());
});

test("forced colours and a lost context draw the vector robot on the 2D canvas", async ({ page }) => {
  await installRobot(page);
  const robot = () => page.evaluate(() => window.__robot.robot(0, [90, 0, 1]));
  await expect.poll(async () => (await robot()).count).toBeGreaterThan(1000);
  await page.evaluate(() => window.__robot.forced(true));
  const forced = await robot();
  expect(forced.vectors).toBeGreaterThan(0);
  expect(forced.count).toBe(0);
  await page.evaluate(() => window.__robot.forced(false));
  expect((await robot()).vectors).toBe(0);
  await page.evaluate(() => window.__robot.loseContext());
  await expect.poll(async () => (await robot()).vectors).toBeGreaterThan(0);
  await page.evaluate(() => window.__robot.dispose());
});

test("the vector robot remains visible without dominating the zoomed-out map", async ({ page }) => {
  const chunks = await readdir("custom_components/matic_robot/map_studio_v4/chunks");
  const model = chunks.find(name => /^robot-model-.*\.js$/u.test(name));
  expect(model).toBeTruthy();
  await page.goto("/");
  const dimensions = await page.evaluate(async url => {
    const { drawVectorRobot } = await import(url);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 400;
    const context = canvas.getContext("2d");
    const palette = { accent: [6, 120, 206], onAccent: [255, 255, 255], forced: false };
    const render = (pixelsPerMeter, forced = false) => {
      context.clearRect(0, 0, 400, 400);
      const project = (forward, left, height) => ({
        x: 200 + forward * pixelsPerMeter,
        y: 200 - left * pixelsPerMeter - height * pixelsPerMeter,
      });
      drawVectorRobot(context, project, 0, { ...palette, forced });
      const pixels = context.getImageData(0, 0, 400, 400).data;
      let minX = 400, maxX = -1;
      for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) {
        if (pixels[(y * 400 + x) * 4 + 3] < 128) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      return maxX - minX + 1;
    };
    return { overview: render(10), close: render(100), forcedOverview: render(10, true), forcedClose: render(100, true) };
  }, `/matic_robot/0.6.0-0123456789ab/map-studio-v4/chunks/${model}`);
  expect(dimensions.overview).toBeGreaterThanOrEqual(12);
  expect(dimensions.overview).toBeLessThanOrEqual(24);
  expect(dimensions.close).toBeGreaterThan(dimensions.overview * 1.5);
  expect(dimensions.forcedOverview).toBeGreaterThanOrEqual(12);
  expect(dimensions.forcedOverview).toBeLessThanOrEqual(24);
  expect(dimensions.forcedClose).toBeGreaterThan(dimensions.forcedOverview * 1.5);
});
