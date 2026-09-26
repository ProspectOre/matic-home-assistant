// Offline, synthetic lab comparison. Build the candidate first, then run:
// node scripts/measure_map_studio_performance.mjs [baseline-ref]
// Prints JSON; does not contact HA, a robot, or external origins. Lab Event
// Timing samples do not establish field INP, mobile performance, or GPU FPS.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus, platform, arch } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = "custom_components/matic_robot/map_studio_v4";
const reviewBundlePath = "tests/browser/.generated/map-studio-v4-review";
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const baseline = git("rev-parse", "--verify", "--end-of-options", `${process.argv[2] || "v0.4.5"}^{commit}`).toString().trim();
const assets = { baseline: new Map(), candidate: new Map() };
const reviewAssets = new Map();
for (const path of git("ls-tree", "-r", "--name-only", baseline, "--", bundlePath).toString().trim().split("\n")) {
  if (path.endsWith(".js")) assets.baseline.set(path.slice(bundlePath.length + 1), git("show", `${baseline}:${path}`));
}
async function loadCandidate(directory, files, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await loadCandidate(join(directory, entry.name), files, `${path}/`);
    else if (path.endsWith(".js")) files.set(path, await readFile(join(directory, entry.name)));
  }
}
await loadCandidate(join(root, bundlePath), assets.candidate);
await loadCandidate(join(root, reviewBundlePath), reviewAssets);
const fingerprint = (files) => {
  const hash = createHash("sha256");
  for (const [path, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(path).update("\0").update(content).update("\0");
  }
  return hash.digest("hex");
};
const galleryTag = "matic-map-studio-gallery-v0-4-0";
const server = createServer((request, response) => {
  const [, variant, ...segments] = new URL(request.url, "http://localhost").pathname.split("/");
  const files = variant === "map_studio_v4" ? assets.candidate : variant === "candidate"
    ? new Map([...assets.candidate, ...reviewAssets])
    : Object.hasOwn(assets, variant) ? assets[variant] : null;
  const path = segments.join("/");
  response.setHeader("Cache-Control", "no-store");
  if (files && path === "") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic Map Studio benchmark</title><style>html,body{height:100%;margin:0}</style><body><script type="module">import "/${variant === "candidate" ? "map_studio_v4" : variant}/index.js"; ${variant === "candidate" ? 'import "/candidate/review.js";' : ""} await customElements.whenDefined("${galleryTag}"); const gallery=document.createElement("${galleryTag}"); gallery.controls=false; document.body.append(gallery);</script></body></html>`);
  } else if (files?.has(path)) {
    response.setHeader("Content-Type", "text/javascript");
    response.end(files.get(path));
  } else { response.writeHead(404); response.end(); }
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const samples = [];
const settle = (page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const quantile = (values, probability) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * probability) - 1] ?? null;

try {
  browser = await chromium.launch({ headless: true });
  // Alternate pair order to reduce consistent warm-up and system-load bias.
  for (const order of [["baseline", "candidate"], ["candidate", "baseline"], ["baseline", "candidate"]]) {
    for (const variant of order) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, serviceWorkers: "block" });
      try {
        const page = await context.newPage();
        const errors = [];
        const requests = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("request", request => { if (request.resourceType() === "script") requests.push(new URL(request.url()).pathname); });
        await context.route("**/*", route => {
          const url = route.request().url();
          if (url.startsWith(`${origin}/`) || url.startsWith("blob:")) return route.continue();
          errors.push("unexpected non-benchmark request");
          return route.abort();
        });
        await page.addInitScript(() => {
          if (!["event", "longtask"].every(type => PerformanceObserver.supportedEntryTypes.includes(type))) {
            throw new Error("required performance observers unavailable");
          }
          const events = [], tasks = [];
          const recordEvents = entries => events.push(...entries.map(entry => ({ start: entry.startTime, duration: entry.duration, id: entry.interactionId })));
          const recordTasks = entries => tasks.push(...entries.map(entry => ({ start: entry.startTime, duration: entry.duration })));
          const eventObserver = new PerformanceObserver(list => recordEvents(list.getEntries()));
          const taskObserver = new PerformanceObserver(list => recordTasks(list.getEntries()));
          eventObserver.observe({ type: "event", durationThreshold: 16 });
          taskObserver.observe({ type: "longtask" });
          window.__maticBenchmark = { events, tasks, start: 0,
            flush: () => { recordEvents(eventObserver.takeRecords()); recordTasks(taskObserver.takeRecords()); } };
        });
        const session = await context.newCDPSession(page);
        await session.send("Performance.enable");
        await page.goto(`${origin}/${variant}/`);
        const gallery = page.locator(galleryTag);
        await gallery.getByRole("button", { name: "3D", exact: true }).waitFor();
        await settle(page);
        const productionPrefix = `/${variant === "candidate" ? "map_studio_v4" : variant}/`;
        const productionRequest = path => path.startsWith(productionPrefix) && assets[variant].has(path.slice(productionPrefix.length));
        const initialScripts = [...new Set(requests)].filter(productionRequest);
        const initialReviewScripts = [...new Set(requests)].filter(path => !productionRequest(path));
        const sceneFingerprint = await gallery.evaluate(async element => {
          const buffer = element.getWorkspaceSnapshot().resources.scene.value.buffer;
          return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map(byte => byte.toString(16).padStart(2, "0")).join("");
        });
        const planJourney = async () => {
          for (const name of [/^Run a plan/, /Daily clean.*Edit plan/, "Back to plans", "Back to all tasks"]) {
            await gallery.getByRole("button", { name, exact: typeof name === "string" }).click();
            await settle(page);
          }
        };
        await planJourney(); // Warm the lazy workflow before the common journey.
        const warmedScripts = [...new Set(requests)].filter(productionRequest);
        await page.evaluate(() => { window.__maticBenchmark.start = performance.now(); });
        for (let index = 0; index < 60; index++) {
          await gallery.getByRole("button", { name: index % 2 ? "2D" : "3D", exact: true }).click();
          await settle(page);
        }
        for (let index = 0; index < 5; index++) await planJourney();
        for (let index = 0; index < 10; index++) {
          await gallery.getByRole("button", { name: /^One-time clean/ }).click();
          await settle(page);
          await gallery.getByRole("button", { name: "Back to all tasks", exact: true }).click();
          await settle(page);
        }
        const measured = await page.evaluate(() => {
          window.__maticBenchmark.flush();
          const { events, tasks, start } = window.__maticBenchmark;
          const interactions = new Map();
          for (const event of events.filter(event => event.start >= start && event.id)) {
            interactions.set(event.id, Math.max(interactions.get(event.id) || 0, event.duration));
          }
          return { interactions: [...interactions.values()], longTasks: tasks.filter(task => task.start >= start).map(task => task.duration) };
        });
        if (errors.length) throw new Error(JSON.stringify(errors));
        if (measured.interactions.length > 100) throw new Error("unexpected interaction count");
        const metricValues = (await session.send("Performance.getMetrics")).metrics;
        const gzipBytes = paths => paths.reduce((sum, path) => sum + gzipSync(assets[variant].get(path.slice(productionPrefix.length)), { level: 9 }).length, 0);
        // Impute unreported interactions at the 16 ms reporting threshold.
        // This is an estimate: recorded durations retain browser quantization.
        const estimated = [...measured.interactions, ...Array(100 - measured.interactions.length).fill(16)];
        samples.push({ variant, sceneFingerprint, initialUniqueScripts: initialScripts.length,
          initialScriptEstimatedGzipBytes: gzipBytes(initialScripts), workflowAddedUniqueScripts: warmedScripts.length - initialScripts.length,
          reviewOnlyInitialScriptEstimatedGzipBytes: initialReviewScripts.reduce((sum, path) => sum + gzipSync(reviewAssets.get(path.slice(variant.length + 2)), { level: 9 }).length, 0),
          workflowAddedScriptEstimatedGzipBytes: gzipBytes(warmedScripts.filter(path => !initialScripts.includes(path))),
          inputs: 100, recordedInteractions: measured.interactions.length, inputP95EstimateMs: quantile(estimated, 0.95),
          inputMaxEstimateMs: Math.max(...estimated), longTasksOver50Ms: measured.longTasks.length,
          longestTaskMs: Math.max(0, ...measured.longTasks),
          jsHeapUsedBytesAfterJourney: metricValues.find(metric => metric.name === "JSHeapUsedSize")?.value ?? null });
      } finally { await context.close(); }
    }
  }
  if (new Set(samples.map(sample => sample.sceneFingerprint)).size !== 1) throw new Error("baseline and candidate synthetic scenes differ");
  const summary = Object.fromEntries(Object.keys(assets).map(variant => {
    const runs = samples.filter(sample => sample.variant === variant);
    const values = runs.map(sample => sample.inputP95EstimateMs);
    return [variant, { inputP95EstimateMs: { min: Math.min(...values), median: quantile(values, 0.5), max: Math.max(...values) },
      longTasksOver50MsByRun: runs.map(sample => sample.longTasksOver50Ms) }];
  }));
  console.log(JSON.stringify({ schema: 2, measuredAt: new Date().toISOString(), baseline,
    bundles: Object.fromEntries(Object.entries(assets).map(([name, files]) => [name, fingerprint(files)])),
    reviewOnlyBundle: fingerprint(reviewAssets),
    conditions: { browser: browser.version(), platform: platform(), arch: arch(), cpuModel: cpus()[0]?.model,
      viewport: "1280x900", dpr: 1, headless: true, network: "loopback, unthrottled", cpuThrottle: 1,
      cache: "new browser context per sample; no-store assets", order: "AB BA AB",
      journey: "60 2D/3D toggles, 5 plan-preview/edit/back loops, 10 room-list/back loops; lazy workflow warmed first" },
    limits: ["Synthetic lab proxy; not field INP or mobile/robot acceptance", "Scene hash must match between builds",
      "Event Timing threshold 16 ms; unreported interactions imputed at 16 ms; browser quantization retained",
      "Gzip bytes are offline size estimates; the loopback server sends uncompressed JavaScript",
      "Candidate review-only assets are reported separately; shared compiled production chunks serve the synthetic journey",
      "Heap is one observation after each journey, not a leak bound; no GPU FPS or transport latency measurement"],
    summary, samples }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
