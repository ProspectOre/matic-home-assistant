import { expect, test } from "@playwright/test";
import { build } from "esbuild";

// The floor-plane shapes are drawn in WebGL, and painted on a 2D canvas where
// WebGL2 is missing. Both are read back here over mid grey, on a 200 px
// canvas that shows a 4 m map at 50 px per metre with vertices on pixel
// centres: the map point (x, y) in metres is the pixel (50x, 50y).

const GREY = [128, 128, 128];
const PALETTE = { accent: [12, 120, 200], onAccent: [255, 255, 255], text: [20, 30, 40], quiet: [70, 80, 90],
  plate: [250, 250, 250], roomFill: [231, 238, 242], forced: false };
const over = (colour, alpha, under = GREY) => colour.map((value, channel) => Math.round(value * alpha + under[channel] * (1 - alpha)));
const square = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];

async function loadGeometry(page) {
  const bundle = await build({
    stdin: { contents: 'export { OverlayGeometry } from "./frontend/map-studio-v4/overlay-geometry";', resolveDir: process.cwd() },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/overlay-geometry.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return page.evaluate(async (palette) => {
    const { OverlayGeometry } = await import("/overlay-geometry.js");
    const SIZE = 200;
    const canvases = Array.from({ length: 2 }, () => Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE }));
    const gl = canvases[0].getContext("webgl2", { alpha: true, antialias: true, depth: true, stencil: true, preserveDrawingBuffer: true });
    if (!gl) return false;
    // The blend the renderer sets once for everything it draws.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const context = canvases[1].getContext("2d");
    const drawn = new OverlayGeometry(gl);
    const painted = new OverlayGeometry(null);
    // World x is mirrored and world z runs down the screen; the last column is half a pixel.
    const matrix = new Float32Array(16);
    matrix[0] = -1 / 2; matrix[9] = -1 / 2; matrix[12] = 1 / SIZE; matrix[13] = -1 / SIZE; matrix[15] = 1;
    const read = (source) => {
      const canvas = Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
      const target = canvas.getContext("2d");
      target.fillStyle = "rgb(128, 128, 128)";
      target.fillRect(0, 0, SIZE, SIZE);
      target.drawImage(source, 0, 0);
      const { data } = target.getImageData(0, 0, SIZE, SIZE);
      return ([x, y]) => [...data.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3)];
    };
    window.__overlayGeometry = { OverlayGeometry, gl, sample(rooms, patch, points) {
      const scene = { metadata: { metersPerCell: 0.1, origin: [0, 0], span: [41, 41], rooms } };
      const state = {
        labelsVisible: false, view: "top", appearance: "photo", workflow: "home", dataMode: "live",
        floor: { readOnly: false }, selection: { floorId: "current", roomIds: [] }, planDraft: { rooms: [] },
        floorTypes: null, wifiSignal: null, wifiScale: "fixed", trail: null,
        resources: { entry: { mapSessionKey: "session" }, plans: { value: null }, areas: { value: { rooms: [], zones: [] } } },
        ...patch,
      };
      drawn.update(scene, state, palette);
      gl.viewport(0, 0, SIZE, SIZE);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      drawn.draw(matrix, SIZE, SIZE, 1, 50);
      painted.update(scene, state, palette);
      context.clearRect(0, 0, SIZE, SIZE);
      painted.paint(context, (x, _height, z) => ({ x: 50 * (2 - x) + 0.5, y: 50 * (z + 2) + 0.5 }));
      const webgl = read(canvases[0]);
      const canvas = read(canvases[1]);
      return points.map((point) => ({ webgl: webgl(point), canvas: canvas(point) }));
    } };
    return true;
  }, PALETTE);
}

const sample = (page, rooms, patch, points) => page.evaluate(
  ([rooms, patch, points]) => window.__overlayGeometry.sample(rooms, patch, points), [rooms, patch, points]);
const zones = (...list) => ({ resources: { entry: { mapSessionKey: "session" }, plans: { value: null },
  areas: { value: { rooms: [], zones: list } } } });
const expectColour = (actual, expected, tolerance, message) => {
  for (const [channel, value] of expected.entries()) {
    expect(Math.abs(actual[channel] - value), `${message}: ${actual} is not ${expected}`).toBeLessThanOrEqual(tolerance);
  }
};

test.beforeEach(async ({ page }) => {
  test.skip(!await loadGeometry(page), "WebGL2 is unavailable in this browser project");
});

test("a fill blends at its own opacity and leaves its holes clear", async ({ page }) => {
  const zone = { kind: "no_go", outline: square(0.4, 0.4, 1.2), holes: [square(0.8, 0.8, 0.4)] };
  const [inside, hole, outside] = await sample(page, [], zones(zone), [[30, 30], [50, 50], [10, 10]]);
  for (const [path, pixels] of Object.entries({ WebGL: [inside.webgl, hole.webgl, outside.webgl], "Canvas 2D": [inside.canvas, hole.canvas, outside.canvas] })) {
    expectColour(pixels[0], over(PALETTE.text, 0.22), 2, `${path} no-go shade`);
    expectColour(pixels[1], GREY, 0, `${path} hole`);
    expectColour(pixels[2], GREY, 0, `${path} outside`);
  }
});

test("an outline keeps one opacity at its corners and where it crosses itself", async ({ page }) => {
  // The edge along y = 2 m crosses the edge along x = 2 m at the canvas centre.
  const boundary = [[8, 20], [32, 20], [32, 32], [20, 32], [20, 8], [8, 8]];
  const rooms = [{ id: "room", roomId: "room", name: "Room", center: [14, 14], boundary }];
  const [edge, corner, crossing, beside] = await sample(page, rooms, { labelsVisible: true },
    [[70, 100], [160, 100], [100, 100], [70, 97]]);
  // The room's 4 % plate fill lies under half of each outline pixel at most.
  const quiet = over(PALETTE.quiet, 0.7);
  for (const path of ["webgl", "canvas"]) {
    expectColour(edge[path], quiet, 4, `${path} edge`);
    expectColour(corner[path], quiet, 4, `${path} corner`);
    expectColour(crossing[path], quiet, 4, `${path} crossing`);
    expectColour(beside[path], over(PALETTE.plate, 0.04), 1, `${path} three pixels inside the 1.5 px line`);
  }
});

test("a robot-made zone is outlined in dashes of five pixels with gaps of four", async ({ page }) => {
  const zone = { kind: "unknown", outline: square(2, 0.4, 1.2), holes: [] };
  const pixels = await sample(page, [], zones(zone), [[102, 20], [107, 20], [111, 20], [116, 20], [130, 50]]);
  const dash = over(PALETTE.text, 0.6);
  for (const path of ["webgl", "canvas"]) {
    expectColour(pixels[0][path], dash, 3, `${path} first dash`);
    expectColour(pixels[1][path], GREY, 0, `${path} first gap`);
    expectColour(pixels[2][path], dash, 3, `${path} second dash`);
    expectColour(pixels[3][path], GREY, 0, `${path} second gap`);
    expectColour(pixels[4][path], GREY, 0, `${path} inside: no shade`);
  }
});

test("the travel path is the accent on a light edge, stops at a gap and marks a lone observation", async ({ page }) => {
  const trail = { id: "live", mapSessionKey: "session", segments: [[[0.4, 3], [1, 3], [3, 3]]] };
  const [core, halo, gap, dot, dotHalo] = await sample(page, [], { trail },
    [[35, 150], [35, 149], [100, 150], [150, 150], [150, 152]]);
  for (const path of ["webgl", "canvas"]) {
    expectColour(core[path], PALETTE.accent, 3, `${path} path`);
    // The 2 px accent line covers half of the pixel beside its centre, over the light edge.
    expectColour(halo[path], over(PALETTE.accent, 0.5, PALETTE.onAccent), 6, `${path} edge`);
    expectColour(gap[path], GREY, 0, `${path} two metres with no observation`);
    expectColour(dot[path], PALETTE.accent, 3, `${path} lone observation`);
    expectColour(dotHalo[path], over(PALETTE.onAccent, 0.5), 12, `${path} lone observation's edge`);
  }
});

test("Wi-Fi heat fades from each sample to nothing without rings, over the room colour", async ({ page }) => {
  const rooms = [{ id: "room", roomId: "room", name: "Room", center: [20, 20], boundary: [[4, 4], [36, 4], [36, 36], [4, 36]] }];
  const wifiSignal = { status: "ready", cells: [{ x: 2, y: 2, dbm: -50, size: 0.3 }] };
  // The sample's footprint is 0.45 m, 22.5 px.
  const offsets = [0, 3, 6, 9, 12, 15, 18, 21, 24, 40];
  const pixels = await sample(page, rooms, { appearance: "rooms", wifiSignal }, offsets.map((offset) => [100 + offset, 100]));
  for (const path of ["webgl", "canvas"]) {
    const room = pixels.at(-1)[path];
    const heat = pixels.map((pixel) => Math.hypot(...pixel[path].map((value, channel) => value - room[channel])));
    expect(heat[0], `${path} sample`).toBeGreaterThan(60);
    for (let index = 1; index < heat.length; index += 1) {
      expect(heat[index], `${path} fades at ${offsets[index]} px`).toBeLessThanOrEqual(heat[index - 1] + 1.5);
    }
    expect(heat.at(-2), `${path} past the footprint`).toBe(0);
  }
  for (const [index, pixel] of pixels.entries()) {
    expectColour(pixel.webgl, pixel.canvas, 3, `WebGL matches Canvas 2D ${offsets[index]} px from the sample`);
  }
});

test("a context that cannot link the overlay programs throws and frees what it made", async ({ page }) => {
  const outcome = await page.evaluate(() => {
    const { OverlayGeometry, gl } = window.__overlayGeometry;
    const made = [];
    const freed = [];
    const failing = new Proxy(gl, { get(target, name) {
      if (name === "getProgramParameter") return () => false;
      const value = Reflect.get(target, name, target);
      if (typeof value !== "function") return value;
      return (...args) => {
        const result = value.apply(target, args);
        if (name === "createProgram" || name === "createVertexArray" || name === "createBuffer") made.push(result);
        if (name === "deleteProgram" || name === "deleteVertexArray" || name === "deleteBuffer") freed.push(args[0]);
        return result;
      };
    } });
    try {
      new OverlayGeometry(failing);
      return null;
    } catch (error) {
      return { message: error.message, made: made.length, leaked: made.filter((object) => !freed.includes(object)).length };
    }
  });
  expect(outcome).toEqual({ message: "overlay-program-failed", made: 3, leaked: 0 });
});

test("the renderer draws the shapes in WebGL and paints them in 2D only when their programs fail", async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4-review/gallery-state";',
      resolveDir: process.cwd(),
    },
    bundle: true, format: "esm", write: false,
  });
  await page.route("**/overlay-renderer.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bundle.outputFiles[0].text,
  }));
  const result = await page.evaluate(async (palette) => {
    const { RendererController, createGalleryState } = await import("/overlay-renderer.js");
    // Keep each WebGL frame readable after it is presented, and fail program links on request.
    const getContext = HTMLCanvasElement.prototype.getContext;
    let failLinks = false;
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      const context = getContext.call(this, kind, kind === "webgl2" ? { ...options, preserveDrawingBuffer: true } : options);
      return kind !== "webgl2" || !context ? context : new Proxy(context, { get(target, name) {
        if (name === "getProgramParameter" && failLinks) return () => false;
        const value = Reflect.get(target, name, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const run = async (fail) => {
      const canvases = Array.from({ length: 2 }, () => {
        const canvas = document.createElement("canvas");
        Object.assign(canvas.style, { position: "absolute", width: "400px", height: "300px" });
        document.body.append(canvas);
        return canvas;
      });
      let layers = "idle";
      const renderer = new RendererController(...canvases, {
        onModuleStatus: (module, status) => { if (module === "renderer-layers") layers = status; },
      });
      // The point programs are linked by now; the overlay's come with its chunk.
      failLinks = fail;
      renderer.setPalette(palette);
      const base = { ...createGalleryState("ready"), optionalUiReady: true, labelsVisible: false, view: "top" };
      const zone = { kind: "no_go", outline: [[0.8, 0.8], [1.6, 0.8], [1.6, 1.6], [0.8, 1.6]], holes: [], roomIds: [], areaIds: [] };
      const state = { ...base, resources: { ...base.resources, pose: { ...base.resources.pose, value: null },
        areas: { status: "ready", problem: null, value: { ...base.resources.areas.value, zones: [zone] } } } };
      renderer.setState(state);
      for (let attempt = 0; attempt < 120 && layers !== "ready"; attempt += 1) await frame();
      failLinks = false;
      renderer.requestRender();
      await frame();
      const point = renderer.mapToScreen({ x: 1.2, y: 1.2 });
      const pixel = (canvas) => {
        const copy = Object.assign(document.createElement("canvas"), { width: canvas.width, height: canvas.height });
        const context = copy.getContext("2d");
        context.drawImage(canvas, 0, 0);
        const ratio = canvas.width / 400;
        return [...context.getImageData(Math.floor(point.x * ratio), Math.floor(point.y * ratio), 1, 1).data];
      };
      const live = canvases.map(pixel);
      renderer.setState({ ...state, dataMode: "history" });
      await frame();
      const history = canvases.map(pixel);
      const mode = renderer.diagnostics().mode;
      renderer.dispose();
      canvases.forEach((canvas) => canvas.remove());
      return { mode, live, history };
    };
    return { drawn: await run(false), painted: await run(true) };
  }, PALETTE);
  expect(result.drawn.mode).toBe("webgl2");
  expect(result.painted.mode).toBe("webgl2");
  // Each pair is [WebGL canvas, 2D canvas] at a point inside the no-go zone; alpha is the fourth channel.
  const { drawn, painted } = result;
  expectColour(drawn.live[0], over(PALETTE.text, 0.22, drawn.history[0]), 2, "the WebGL canvas shades the live map only");
  expect(drawn.live[1][3], "the 2D canvas holds no shape").toBe(0);
  expect(painted.live[0], "the WebGL canvas is left to the map").toEqual(painted.history[0]);
  expect(Math.abs(painted.live[1][3] - 0.22 * 255), "the 2D canvas holds the shade").toBeLessThanOrEqual(2);
  expect(painted.history[1][3]).toBe(0);
});
