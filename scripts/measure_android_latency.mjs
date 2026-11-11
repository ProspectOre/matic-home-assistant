// Synthetic touch latency on an adb-attached Android device running Chrome.
// Build first, then run:
// node scripts/measure_android_latency.mjs [--swipes 40] [--points 1200000] [--scale 2.25]
// Serves the built gallery over `adb reverse`, injects real touchscreen swipes
// with `adb shell input`, and prints JSON: Event Timing interactions and
// Chrome's EventLatency for touch moves (touch to presented frame). Contacts no
// HA, robot or external origin; --scale emulates browser zoom by overriding
// the device scale factor.
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { loadDenseScene } from "./dense_gallery_scene.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: {
  swipes: { type: "string", default: "40" },
  points: { type: "string", default: "1200000" },
  scale: { type: "string" },
} });
const tag = "matic-map-studio-gallery-v0-4-0";
const roots = [join(root, "custom_components/matic_robot"), join(root, "tests/browser/.generated/map-studio-v4-review")];
const html = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic latency</title><style>html,body{height:100%;margin:0}</style><body><script type="module">import "/map_studio_v4/index.js"; import "/review.js"; await customElements.whenDefined("${tag}"); const gallery=document.createElement("${tag}"); gallery.controls=false; document.body.append(gallery);</script></body></html>`;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  response.setHeader("Cache-Control", "no-store");
  if (path === "/") return response.end(html);
  for (const base of roots) {
    const file = join(base, path);
    if (file.startsWith(base) && await stat(file).then(entry => entry.isFile(), () => false)) {
      response.setHeader("Content-Type", "text/javascript");
      return response.end(await readFile(file));
    }
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" }).trim();
const devtoolsPort = 9300 + (port % 500);
adb("reverse", `tcp:${port}`, `tcp:${port}`);
adb("forward", `tcp:${devtoolsPort}`, "localabstract:chrome_devtools_remote");
const quantile = (list, probability) => list.length
  ? Math.round([...list].sort((a, b) => a - b)[Math.ceil(list.length * probability) - 1] * 10) / 10 : null;
const summary = list => ({ count: list.length, p50: quantile(list, 0.5), p95: quantile(list, 0.95), max: quantile(list, 1) });
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${devtoolsPort}`);
const tab = await browser.contexts()[0].newPage();
try {
  adb("shell", "monkey", "-p", "com.android.chrome", "-c", "android.intent.category.LAUNCHER", "1");
  await tab.goto(`http://127.0.0.1:${port}/`);
  await tab.bringToFront();
  const cdp = await tab.context().newCDPSession(tab);
  if (values.scale) await cdp.send("Emulation.setDeviceMetricsOverride",
    { width: 0, height: 0, deviceScaleFactor: Number(values.scale), mobile: false });
  const gallery = tab.locator(tag);
  await gallery.getByRole("button", { name: "3D", exact: true }).click();
  await gallery.evaluate(loadDenseScene, Number(values.points));
  const canvas = gallery.locator(".scene-canvas");
  await canvas.evaluate((element, total) => new Promise((resolve) => {
    const map = element.getRootNode().host;
    const poll = () => map.rendererDiagnostics()?.renderedPoints > 0
      && map.rendererDiagnostics().sourcePoints === total ? resolve() : setTimeout(poll, 100);
    poll();
  }), Number(values.points));
  await tab.waitForTimeout(2000);
  const bounds = await canvas.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, ratio: devicePixelRatio,
      backing: [element.width, element.height] };
  });
  // Map CSS pixels to touchscreen pixels from two observed taps in the
  // middle of the screen, which always land inside the page.
  const [displayWidth, displayHeight] = adb("shell", "wm", "size").match(/(\d+)x(\d+)\s*$/u).slice(1).map(Number);
  const landscape = await tab.evaluate(() => matchMedia("(orientation: landscape)").matches);
  const [screenWidth, screenHeight] = landscape === displayWidth > displayHeight
    ? [displayWidth, displayHeight] : [displayHeight, displayWidth];
  const tapAt = async (x, y) => {
    await tab.evaluate(() => { window.__probe = new Promise(resolve => addEventListener("pointerdown",
      event => resolve([event.clientX, event.clientY]), { capture: true, once: true })); });
    adb("shell", "input", "touchscreen", "tap", String(x), String(y));
    return tab.evaluate(() => window.__probe);
  };
  const first = [Math.round(screenWidth * 0.4), Math.round(screenHeight * 0.45)];
  const second = [Math.round(screenWidth * 0.6), Math.round(screenHeight * 0.6)];
  const [one, two] = [await tapAt(...first), await tapAt(...second)];
  const scaleX = (second[0] - first[0]) / (two[0] - one[0]);
  const scaleY = (second[1] - first[1]) / (two[1] - one[1]);
  const toScreen = (x, y) => [Math.round(first[0] + (x - one[0]) * scaleX), Math.round(first[1] + (y - one[1]) * scaleY)];
  await tab.evaluate(() => {
    window.__events = [];
    new PerformanceObserver(list => window.__events.push(...list.getEntries().filter(entry => entry.interactionId)
      .map(entry => [entry.interactionId, entry.duration]))).observe({ type: "event", durationThreshold: 16 });
  });
  await cdp.send("Tracing.start", { transferMode: "ReturnAsStream",
    traceConfig: { includedCategories: ["benchmark", "input"], excludedCategories: ["*"] } });
  const center = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
  const reach = Math.min(bounds.width / 4, 200);
  for (let index = 0; index < Number(values.swipes); index += 1) {
    const direction = index % 2 ? 1 : -1;
    const from = toScreen(center[0] - direction * reach, center[1]);
    const to = toScreen(center[0] + direction * reach, center[1] + direction * reach / 4);
    adb("shell", "input", "touchscreen", "swipe", ...[...from, ...to].map(String), "250");
    await tab.waitForTimeout(700);
  }
  await tab.waitForTimeout(1000);
  const complete = new Promise(resolve => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.end");
  const { stream } = await complete;
  const chunks = [];
  for (;;) {
    const chunk = await cdp.send("IO.read", { handle: stream, size: 1 << 22 });
    chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, "base64") : Buffer.from(chunk.data));
    if (chunk.eof) break;
  }
  const trace = JSON.parse(Buffer.concat(chunks).toString());
  const open = new Map(), touchMoves = [];
  for (const event of Array.isArray(trace) ? trace : trace.traceEvents) {
    if (event.name !== "EventLatency") continue;
    const key = `${event.pid}:${event.id ?? event.id2?.local}`;
    if (event.ph === "b") open.set(key, event);
    else if (event.ph === "e" && open.has(key)) {
      const begin = open.get(key);
      open.delete(key);
      if (begin.args?.event_latency?.event_type === "TOUCH_MOVED") touchMoves.push((event.ts - begin.ts) / 1000);
    }
  }
  const interactions = new Map();
  for (const [id, duration] of await tab.evaluate(() => window.__events)) {
    interactions.set(id, Math.max(interactions.get(id) ?? 0, duration));
  }
  const version = await browser.version();
  console.log(JSON.stringify({
    device: adb("shell", "getprop", "ro.product.model"), chrome: version,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    swipes: Number(values.swipes), points: Number(values.points), scale: values.scale ? Number(values.scale) : null,
    canvas: bounds, interactions: summary([...interactions.values()]), touchMoveToPresent: summary(touchMoves),
  }, null, 2));
} finally {
  await tab.close().catch(() => {});
  await browser.close().catch(() => {});
  adb("reverse", "--remove", `tcp:${port}`);
  adb("forward", "--remove", `tcp:${devtoolsPort}`);
  server.close();
}
