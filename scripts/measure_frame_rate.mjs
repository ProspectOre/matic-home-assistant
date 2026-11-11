// Frame rate of the built map with every layer on, in whichever browser opens the page.
// Build first, then run:
// node scripts/measure_frame_rate.mjs [--points 1200000] [--seconds 10] [--host 127.0.0.1] [--port 0]
// Open the printed address on the device under test; a phone needs
// --host 0.0.0.0 and this machine's address, or `adb reverse`. The page loads
// the built gallery, a deterministic dense scene and every layer, moves the
// camera for --seconds in the 3D view and in the top view, and posts back the
// intervals between animation frames. Each run prints one JSON line, also
// shown on the page. Contacts no HA, robot or external origin.
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadDenseScene } from "./dense_gallery_scene.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: {
  points: { type: "string", default: "1200000" },
  seconds: { type: "string", default: "10" },
  host: { type: "string", default: "127.0.0.1" },
  port: { type: "string", default: "0" },
} });

// Runs in the page.
const measure = async (loadDenseScene, points, seconds) => {
  const report = document.querySelector("pre");
  const tag = "matic-map-studio-gallery-v0-4-0";
  await customElements.whenDefined(tag);
  const gallery = document.createElement(tag);
  gallery.controls = false;
  document.body.append(gallery);
  const find = (scope, selector) => {
    const match = scope.querySelector(selector);
    if (match) return match;
    for (const element of scope.querySelectorAll("*")) {
      const nested = element.shadowRoot && find(element.shadowRoot, selector);
      if (nested) return nested;
    }
    return null;
  };
  const until = async (ready) => { while (!ready()) await new Promise((resolve) => setTimeout(resolve, 100)); };
  // The gallery loads its own scenario when it first renders the map.
  await until(() => gallery.shadowRoot && find(gallery.shadowRoot, ".scene-canvas"));
  const canvas = find(gallery.shadowRoot, ".scene-canvas");
  const map = canvas.getRootNode().host;
  loadDenseScene(gallery, points);
  const state = gallery.getWorkspaceSnapshot();
  const { span, origin, metersPerCell } = state.resources.scene.value.metadata;
  // A point at fractions of the map's width and depth, in the map's metres.
  const at = (across, down) => [(across * span[0] + origin[0]) * metersPerCell, (down * span[1] + origin[1]) * metersPerCell];
  const ring = (across, down, width, depth) =>
    [at(across, down), at(across + width, down), at(across + width, down + depth), at(across, down + depth)];
  const cells = [];
  for (let column = 0; column < 12; column += 1) for (let row = 0; row < 8; row += 1) {
    const [x, y] = at(0.5 + column * 0.03, 0.5 + row * 0.04);
    cells.push({ x, y, dbm: -45 - column * 3 - row * 2, size: 0.5 });
  }
  gallery.replaceWorkspaceState({ ...state, labelsVisible: true,
    floorTypes: { status: "ready", carpet: [ring(0.1, 0.1, 0.25, 0.2), ring(0.15, 0.15, 0.05, 0.05)], vent: [ring(0.8, 0.1, 0.04, 0.03)] },
    wifiSignal: { status: "ready", surveying: false, cellSize: 0.5, cells },
    trail: { id: "live", mapSessionKey: state.resources.entry?.mapSessionKey ?? "",
      segments: [Array.from({ length: 400 }, (_, index) => at(0.1 + index * 0.002, 0.5 + Math.sin(index / 20) * 0.3))] },
    resources: { ...state.resources, areas: { ...state.resources.areas, value: { ...state.resources.areas.value, zones: [
      { kind: "no_go", outline: ring(0.55, 0.1, 0.2, 0.15), holes: [ring(0.6, 0.15, 0.05, 0.05)], roomIds: [], areaIds: [] },
      { kind: "unknown", outline: ring(0.1, 0.6, 0.2, 0.2), holes: [], roomIds: [], areaIds: [] },
    ] } } } });
  const quantile = (list, probability) => Math.round(list[Math.ceil(list.length * probability) - 1] * 10) / 10;
  const views = {};
  for (const view of ["three", "top"]) {
    report.textContent = `Measuring the ${view === "three" ? "3D" : "top"} view…`;
    gallery.replaceWorkspaceState({ ...gallery.getWorkspaceSnapshot(), view });
    await until(() => map.rendererDiagnostics()?.sourcePoints === points && map.rendererDiagnostics().renderedPoints > 0);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const renderer = map.rendererController;
    const start = renderer.camera;
    const stamps = [];
    await new Promise((resolve) => {
      const began = performance.now();
      const tick = (time) => {
        stamps.push(time);
        const elapsed = (performance.now() - began) / 1000;
        if (elapsed >= seconds) return resolve();
        // Turn, pan and zoom together, as a hand on the map does.
        renderer.setCamera({ ...start, yaw: start.yaw + Math.sin(elapsed * 0.8) * 0.6,
          distance: start.distance * (1 - 0.35 * Math.sin(elapsed * 1.3) ** 2),
          targetX: start.targetX + Math.sin(elapsed * 0.7) * start.distance * 0.1 }, false);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const intervals = stamps.slice(1).map((time, index) => time - stamps[index]).sort((left, right) => left - right);
    const { mode, sourcePoints, renderedPoints, detailScale } = map.rendererDiagnostics();
    views[view] = { frames: intervals.length,
      framesPerSecond: Math.round(intervals.length / (stamps.at(-1) - stamps[0]) * 10000) / 10,
      intervalMs: { p50: quantile(intervals, 0.5), p95: quantile(intervals, 0.95), max: quantile(intervals, 1) },
      mode, sourcePoints, renderedPoints, detailScale };
  }
  const probe = document.createElement("canvas").getContext("webgl2");
  const result = { userAgent: navigator.userAgent,
    graphics: probe?.getParameter(probe.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? probe.RENDERER) ?? null,
    touch: matchMedia("(any-pointer: coarse)").matches, pixelRatio: devicePixelRatio,
    canvas: [canvas.clientWidth, canvas.clientHeight, canvas.width, canvas.height], points, seconds, views };
  probe?.getExtension("WEBGL_lose_context")?.loseContext();
  report.textContent = JSON.stringify(result, null, 2);
  await fetch("/result", { method: "POST", body: JSON.stringify(result) });
};

const html = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic frame rate</title><style>html,body{height:100%;margin:0}pre{position:fixed;inset:auto 0 0 0;max-height:40%;overflow:auto;margin:0;padding:8px;background:#000c;color:#fff;font:12px monospace;z-index:1}</style><body><pre>Loading…</pre><script type="module">import "/map_studio_v4/index.js"; import "/review.js"; await (${measure})(${loadDenseScene}, ${Number(values.points)}, ${Number(values.seconds)});</script></body></html>`;
const roots = [join(root, "custom_components/matic_robot"), join(root, "tests/browser/.generated/map-studio-v4-review")];
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  response.setHeader("Cache-Control", "no-store");
  if (path === "/") return response.setHeader("Content-Type", "text/html; charset=utf-8").end(html);
  if (path === "/result" && request.method === "POST") {
    let body = "";
    for await (const chunk of request) body += chunk;
    try {
      console.log(JSON.stringify({ commit, ...JSON.parse(body) }));
    } catch {
      return response.writeHead(400).end();
    }
    return response.writeHead(204).end();
  }
  for (const base of roots) {
    const file = join(base, path);
    if (file.startsWith(base) && await stat(file).then((entry) => entry.isFile(), () => false)) {
      response.setHeader("Content-Type", "text/javascript");
      return response.end(await readFile(file));
    }
  }
  response.writeHead(404).end();
});
server.listen(Number(values.port), values.host, () => {
  console.error(`Open http://${values.host === "0.0.0.0" ? "<this machine>" : values.host}:${server.address().port}/ on the device under test.`);
});
