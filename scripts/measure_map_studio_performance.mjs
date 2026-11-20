// Offline, synthetic lab comparison. Build the candidate (npm run build:map-studio-v4)
// and the baseline revision the same way in its own checkout, then run:
// node scripts/measure_map_studio_performance.mjs <baseline-checkout> [--headed] [--trace-dir path]
// Both builds need the production/review bundle split: the gallery is in the review bundle.
// Prints JSON; does not contact HA, a robot, or external origins. Lab Event
// Timing samples do not establish field INP, mobile performance, or GPU FPS.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus, loadavg, platform, arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = "custom_components/matic_robot/map_studio_v4";
const reviewBundlePath = "tests/browser/.generated/map-studio-v4-review";
const { values, positionals } = parseArgs({ options: {
  headed: { type: "boolean", default: false },
  "trace-dir": { type: "string" },
}, allowPositionals: true });
if (positionals.length !== 1) throw new Error("Expected one baseline checkout directory");
const headless = !values.headed;
const traceDirectory = values["trace-dir"] ? resolve(values["trace-dir"]) : null;
if (traceDirectory) await mkdir(traceDirectory, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const baselineRoot = resolve(positionals[0]);
const collectorSha256 = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
const candidateSource = { commit: git("rev-parse", "HEAD").toString().trim(),
  trackedWorktreeDirty: Boolean(git("status", "--porcelain", "--untracked-files=no").toString().trim()) };
const assets = { baseline: new Map(), candidate: new Map() };
const reviewAssets = { baseline: new Map(), candidate: new Map() };
async function loadScripts(directory, files, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await loadScripts(join(directory, entry.name), files, `${path}/`);
    else if (path.endsWith(".js")) files.set(path, await readFile(join(directory, entry.name)));
  }
}
for (const [variant, checkout] of [["baseline", baselineRoot], ["candidate", root]]) {
  await loadScripts(join(checkout, bundlePath), assets[variant]);
  await loadScripts(join(checkout, reviewBundlePath), reviewAssets[variant]);
}
// Use the actual HA registration, including host-wide extra modules that the
// isolated panel harness would otherwise omit. This requires the test venv.
const registration = JSON.parse(execFileSync(join(root, ".venv/bin/python"),
  [join(root, "scripts/frontend_assets.py")], { cwd: root, encoding: "utf8" }));
const registeredAssets = new Map();
for (const [url, path] of Object.entries(registration.staticPaths)) {
  const local = join(root, path);
  if ((await stat(local)).isDirectory()) {
    const files = new Map();
    await loadScripts(local, files);
    for (const [name, contents] of files) registeredAssets.set(`${url}/${name}`, contents);
  } else registeredAssets.set(url, await readFile(local));
}
const fingerprint = (files) => {
  const hash = createHash("sha256");
  for (const [path, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(path).update("\0").update(content).update("\0");
  }
  return hash.digest("hex");
};
const galleryTag = "matic-map-studio-gallery-v0-4-0";
const server = createServer((request, response) => {
  const requestPath = new URL(request.url, "http://localhost").pathname;
  response.setHeader("Cache-Control", "no-store");
  if (registeredAssets.has(requestPath)) {
    response.setHeader("Content-Type", "text/javascript");
    response.end(registeredAssets.get(requestPath));
    return;
  }
  const [, variant, ...segments] = requestPath.split("/");
  const path = segments.join("/");
  const known = Object.hasOwn(assets, variant);
  response.setHeader("Cache-Control", "no-store");
  if (known && path === "") {
    response.setHeader("Content-Type", "text/html");
    const hostImports = variant === "candidate" ? registration.extraModuleUrls.map(url => `import ${JSON.stringify(url)};`).join(" ") : "";
    response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic Map Studio benchmark</title><style>html,body{height:100%;margin:0}</style><body><script type="module">${hostImports} import "/${variant}/index.js"; import "/${variant}/review.js"; await customElements.whenDefined("${galleryTag}"); const gallery=document.createElement("${galleryTag}"); gallery.controls=false; document.body.append(gallery);</script></body></html>`);
  } else if (known && assets[variant].has(path)) {
    response.setHeader("Content-Type", "text/javascript");
    response.end(assets[variant].get(path));
  } else if (known && reviewAssets[variant].has(path)) {
    // Review chunks import the shared production chunks by their installed
    // URL; point them at this variant's copy so each build keeps one module identity.
    response.setHeader("Content-Type", "text/javascript");
    response.end(reviewAssets[variant].get(path).toString().replaceAll('"/map_studio_v4/', `"/${variant}/`));
  } else { response.writeHead(404); response.end(); }
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const samples = [];
// An action labelled `measured: false` is a step one variant needs to reach a
// shared screen; its interactions are left out so both journeys compare the
// same transitions.
const settle = (page, action = null, measured = true) => page.evaluate(({ label, measured }) => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
  const benchmark = window.__maticBenchmark;
  if (label && benchmark.start) {
    const end = performance.now();
    benchmark.actions.push({ label, start: benchmark.lastActionEnd, end, measured });
    benchmark.lastActionEnd = end;
  }
  resolve();
}))), { label: action, measured });
const quantile = (values, probability) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * probability) - 1] ?? null;

try {
  browser = await chromium.launch({ headless });
  // Alternate pair order to reduce consistent warm-up and system-load bias.
  for (const order of [["baseline", "candidate"], ["candidate", "baseline"], ["baseline", "candidate"]]) {
    for (const variant of order) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, serviceWorkers: "block" });
      let tracing = false;
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
          const events = [], tasks = [], actions = [];
          const recordEvents = entries => events.push(...entries.map(entry => ({
            start: entry.startTime, duration: entry.duration, interactionId: entry.interactionId,
            type: entry.name, processingStart: entry.processingStart, processingEnd: entry.processingEnd,
          })));
          const recordTasks = entries => tasks.push(...entries.map(entry => ({ start: entry.startTime, duration: entry.duration })));
          const eventObserver = new PerformanceObserver(list => recordEvents(list.getEntries()));
          const taskObserver = new PerformanceObserver(list => recordTasks(list.getEntries()));
          eventObserver.observe({ type: "event", durationThreshold: 16 });
          taskObserver.observe({ type: "longtask" });
          window.__maticBenchmark = { events, tasks, actions, start: 0, lastActionEnd: 0,
            flush: () => { recordEvents(eventObserver.takeRecords()); recordTasks(taskObserver.takeRecords()); } };
        });
        const session = await context.newCDPSession(page);
        await session.send("Performance.enable");
        await page.goto(`${origin}/${variant}/`);
        const gallery = page.locator(galleryTag);
        await gallery.getByRole("button", { name: "3D", exact: true }).waitFor();
        await settle(page);
        const productionPrefix = `/${variant}/`;
        const productionRequest = path => path.startsWith(productionPrefix) && assets[variant].has(path.slice(productionPrefix.length));
        const initialScripts = [...new Set(requests)].filter(productionRequest);
        const initialHostScripts = [...new Set(requests)].filter(path => registeredAssets.has(path));
        const initialReviewScripts = [...new Set(requests)].filter(path => !productionRequest(path) && !registeredAssets.has(path));
        const sceneFingerprint = await gallery.evaluate(async element => {
          const buffer = element.getWorkspaceSnapshot().resources.scene.value.buffer;
          return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map(byte => byte.toString(16).padStart(2, "0")).join("");
        });
        // Both revisions measure the same four transitions: Home to the
        // picker, into the saved plan's editor, out of it, and back Home.
        // The journey follows what the picker offers, so two revisions with
        // the same UI take the same steps: a UX1 picker row opens its editor
        // and Back to plans leaves it; from UX2 on, Edit is reached through
        // Run and Cancel returns there, so the picker-to-Run and
        // Run-to-picker steps are taken but not measured.
        const button = name => gallery.getByRole("button", { name, exact: typeof name === "string" });
        const step = async (name, label, measured = true) => {
          await button(name).click();
          await settle(page, label, measured);
        };
        const journeys = new Set();
        // From UX4 on the home card opens the default plan's Run view,
        // so Edit is one step away and every hop is
        // measured.
        const planJourney = async () => {
          // From UX9 the plan is a home shortcut whose main button runs it;
          // its Open control is the journey's way in.
          const opener = await button("Open Daily clean").count() > 0 ? "Open Daily clean" : /^(Run a plan|Plans|Run Daily clean)/;
          await step(opener, "plan:open");
          // The first open loads the lazy views; choose the branch once the
          // plan's row or Run view has rendered, not while it is loading.
          await button(/Daily clean/).first().waitFor();
          const homeRun = await button("Edit Daily clean").count() > 0;
          const pickerEdits = !homeRun && await button(/Daily clean.*Edit plan/).count() > 0;
          journeys.add(homeRun ? "home-run-edit" : pickerEdits ? "picker-edit" : "run-edit");
          if (homeRun) {
            await step("Edit Daily clean", "plan:open-editor");
            await step("Cancel", "plan:leave-editor");
          } else if (pickerEdits) {
            await step(/Daily clean.*Edit plan/, "plan:open-editor");
            await step("Back to plans", "plan:leave-editor");
          } else {
            await step(/Daily clean/, "plan:to-run", false);
            await step("Edit Daily clean", "plan:open-editor");
            await step("Cancel", "plan:leave-editor");
            await step("Back to plans", "plan:to-picker", false);
          }
          await step("Back to all tasks", "plan:back-to-home");
        };
        await planJourney(); // Warm the lazy workflow before the common journey.
        const warmedScripts = [...new Set(requests)].filter(productionRequest);
        const traceFile = traceDirectory ? `${samples.length + 1}-${variant}.json` : null;
        if (traceFile) {
          await browser.startTracing(page, { path: join(traceDirectory, traceFile), screenshots: false,
            categories: ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing", "v8", "cc", "gpu"] });
          tracing = true;
        }
        const hostLoadBefore = loadavg();
        await page.evaluate(() => {
          const benchmark = window.__maticBenchmark;
          benchmark.start = performance.now();
          benchmark.lastActionEnd = benchmark.start;
        });
        for (let index = 0; index < 60; index++) {
          await gallery.getByRole("button", { name: index % 2 ? "2D" : "3D", exact: true }).click();
          await settle(page, index % 2 ? "view:2D" : "view:3D");
        }
        for (let index = 0; index < 5; index++) await planJourney();
        for (let index = 0; index < 10; index++) {
          await gallery.getByRole("button", { name: /^(One-time clean|Clean rooms)/ }).click();
          await settle(page, "rooms:open");
          await gallery.getByRole("button", { name: "Back to all tasks", exact: true }).click();
          await settle(page, "rooms:back");
        }
        const measured = await page.evaluate(() => {
          window.__maticBenchmark.flush();
          const { events, tasks, actions, start } = window.__maticBenchmark;
          const interactions = new Map();
          const unmeasured = actions.filter(action => !action.measured);
          const inMeasuredAction = event => !unmeasured.some(action => event.start >= action.start && event.start < action.end);
          for (const event of events.filter(event => event.start >= start && event.interactionId && inMeasuredAction(event))) {
            const previous = interactions.get(event.interactionId);
            if (!previous || event.duration > previous.duration) interactions.set(event.interactionId, event);
          }
          const details = [...interactions.values()];
          return {
            interactions: details.map(event => event.duration),
            slowestInteractions: details.sort((a, b) => b.duration - a.duration).slice(0, 10).map(event => ({
              ...event, action: actions.find(action => event.start >= action.start && event.start < action.end)?.label ?? null,
            })),
            recordedActions: actions.filter(action => action.measured).length,
            longTasks: tasks.filter(task => task.start >= start && inMeasuredAction(task)).map(task => task.duration),
          };
        });
        const hostLoadAfter = loadavg();
        if (tracing) { await browser.stopTracing(); tracing = false; }
        if (errors.length) throw new Error(JSON.stringify(errors));
        if (measured.interactions.length > 100 || measured.recordedActions !== 100) throw new Error("unexpected interaction/action count");
        const metricValues = (await session.send("Performance.getMetrics")).metrics;
        const gzipBytes = paths => paths.reduce((sum, path) => sum + gzipSync(assets[variant].get(path.slice(productionPrefix.length)), { level: 9 }).length, 0);
        const hostGzipBytes = initialHostScripts.reduce((sum, path) => sum + gzipSync(registeredAssets.get(path), { level: 9 }).length, 0);
        // Impute unreported interactions at the 16 ms reporting threshold.
        // This is an estimate: recorded durations retain browser quantization.
        const estimated = [...measured.interactions, ...Array(100 - measured.interactions.length).fill(16)];
        samples.push({ variant, journey: [...journeys].join(","), sceneFingerprint, traceFile, hostLoadBefore, hostLoadAfter,
          initialUniqueScripts: initialScripts.length,
          initialScriptEstimatedGzipBytes: gzipBytes(initialScripts), workflowAddedUniqueScripts: warmedScripts.length - initialScripts.length,
          hostExtraModuleEstimatedGzipBytes: variant === "candidate" ? hostGzipBytes : null,
          wholeIntegrationInitialEstimatedGzipBytes: variant === "candidate" ? hostGzipBytes + gzipBytes(initialScripts) : null,
          hostExtraModuleRequests: initialHostScripts,
          reviewOnlyInitialScriptEstimatedGzipBytes: initialReviewScripts.reduce((sum, path) => sum + gzipSync(reviewAssets[variant].get(path.slice(variant.length + 2)), { level: 9 }).length, 0),
          workflowAddedScriptEstimatedGzipBytes: gzipBytes(warmedScripts.filter(path => !initialScripts.includes(path))),
          inputs: 100, recordedInteractions: measured.interactions.length, inputP95EstimateMs: quantile(estimated, 0.95),
          inputMaxEstimateMs: Math.max(...estimated), slowestInteractions: measured.slowestInteractions, longTasksOver50Ms: measured.longTasks.length,
          longestTaskMs: Math.max(0, ...measured.longTasks),
          jsHeapUsedBytesAfterJourney: metricValues.find(metric => metric.name === "JSHeapUsedSize")?.value ?? null });
      } finally {
        if (tracing) await browser.stopTracing();
        await context.close();
      }
    }
  }
  if (new Set(samples.map(sample => sample.sceneFingerprint)).size !== 1) throw new Error("baseline and candidate synthetic scenes differ");
  const summary = Object.fromEntries(Object.keys(assets).map(variant => {
    const runs = samples.filter(sample => sample.variant === variant);
    const values = runs.map(sample => sample.inputP95EstimateMs);
    return [variant, { inputP95EstimateMs: { min: Math.min(...values), median: quantile(values, 0.5), max: Math.max(...values) },
      longTasksOver50MsByRun: runs.map(sample => sample.longTasksOver50Ms) }];
  }));
  console.log(JSON.stringify({ schema: 6, collectorSha256, candidateSource,
    measuredAt: new Date().toISOString(),
    bundles: Object.fromEntries(Object.entries(assets).map(([name, files]) => [name, fingerprint(files)])),
    reviewOnlyBundles: Object.fromEntries(Object.entries(reviewAssets).map(([name, files]) => [name, fingerprint(files)])),
    registeredFrontendAssets: fingerprint(registeredAssets),
    conditions: { browser: browser.version(), platform: platform(), arch: arch(), cpuModel: cpus()[0]?.model,
      logicalCpus: cpus().length, tracing: Boolean(traceDirectory),
      viewport: "1280x900", dpr: 1, headless, network: "loopback, unthrottled", cpuThrottle: 1,
      cache: "new browser context per sample; no-store assets", order: "AB BA AB",
      journey: "60 2D/3D toggles, 5 four-action plan editor loops (home → the saved plan's Edit → out of Edit → home, by the route the home card or picker offers), 10 room-list/back loops; lazy workflow warmed first; unmeasured Run hops excluded" },
    limits: ["Synthetic lab proxy; not field INP or mobile/robot acceptance", "Scene hash must match between builds",
      "Event Timing threshold 16 ms; unreported interactions imputed at 16 ms; browser quantization retained",
      "Tracing adds diagnostic overhead; trace-enabled timings do not qualify the untraced performance gate",
      "Gzip bytes are offline size estimates; the loopback server sends uncompressed JavaScript",
      "Candidate review-only assets are reported separately; shared compiled production chunks serve the synthetic journey",
      "Candidate includes actual registered HA extra modules; historical baseline is panel-only and has no host-wide byte total",
      "Both variants measure opening and leaving the saved plan's Edit view by the route their home offers (each sample records it): a UX1 picker row, UX2's Run hops (taken but not measured), or from UX4 the home card's Run view",
      "Heap is one observation after each journey, not a leak bound; no GPU FPS or transport latency measurement"],
    summary, samples }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
