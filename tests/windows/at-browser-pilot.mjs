import assert from "node:assert/strict";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createGalleryServer, GALLERY_ORIGIN, GALLERY_PORT } from "../browser/gallery_server.mjs";
import { installPanelFixture } from "../browser/map_studio_v4_panel_fixture.mjs";

const root = process.env.NVDA_PILOT_DIR;
if (!root) throw new Error("NVDA_PILOT_DIR is required");
const path = (name) => `${root}/${name}`;
const server = createGalleryServer();
const startedAt = Date.now();
const diagnosticPath = path("diagnostics.jsonl");
const diagnosticLimit = 24;
let browser;
let previousPhase = "";
let previousSent = "";
let sawPanelFocus = false;
let diagnosticCount = 0;
let stage = "startup";

function safeDiagnosticMessage(value) {
  return String(value)
    .replace(/(?:[A-Za-z]:\\|\\\\)[^"'<>]+/gu, "<path>")
    .replace(/\/(?:Users|home|tmp|private|var|opt|Applications)\/[^"'<>]+/gu, "<path>")
    .replace(/[\r\n\t]+/gu, " ")
    .slice(0, 240);
}

async function recordDiagnostic(event, details = {}) {
  if (diagnosticCount >= diagnosticLimit) return;
  diagnosticCount += 1;
  const record = {
    stage,
    event,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    browserVersion: details.browserVersion ? safeDiagnosticMessage(details.browserVersion) : null,
    forcedColors: typeof details.forcedColors === "boolean" ? details.forcedColors : null,
    sceneReady: typeof details.sceneReady === "boolean" ? details.sceneReady : null,
    errorType: details.errorType ? safeDiagnosticMessage(details.errorType) : null,
    error: details.error ? safeDiagnosticMessage(details.error) : null,
  };
  await appendFile(diagnosticPath, `${JSON.stringify(record)}\n`).catch(() => {});
}

async function readText(name) {
  try { return (await readFile(path(name), "utf8")).trim(); } catch { return ""; }
}

async function readJson(name) {
  try { return JSON.parse(await readFile(path(name), "utf8")); } catch { return null; }
}

try {
  await mkdir(root, { recursive: true });
  await recordDiagnostic("server-listen-start");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(GALLERY_PORT, "127.0.0.1", resolve);
  });
  stage = "edge-launch";
  await recordDiagnostic("edge-launch-start");
  browser = await chromium.launch({ channel: "msedge", headless: false });
  await recordDiagnostic("edge-launched", { browserVersion: browser.version() });
  const context = await browser.newContext({
    baseURL: GALLERY_ORIGIN,
    viewport: { width: 1180, height: 760 },
    forcedColors: null,
  });
  const page = await context.newPage();
  stage = "gallery-navigation";
  await page.goto("/");
  await recordDiagnostic("gallery-page-loaded");
  stage = "fixture-navigation";
  const fixture = await installPanelFixture(page, {
    moduleSource: "packaged",
    onNavigationComplete: () => { stage = "fixture-install"; },
  });
  await recordDiagnostic("fixture-installed");
  await page.evaluate((tag) => {
    document.body.style.margin = "0";
    const panel = window.__panelFixture.createPanel();
    panel.style.cssText = "display:block;width:100vw;height:100vh";
    window.__pilotPanel = panel;
    document.body.append(panel);
    window.__pilotPanelTag = tag;
  }, fixture.panelTag);
  stage = "scene-readiness";
  await page.waitForFunction(() => window.__pilotPanel?.getWorkspaceSnapshot().resources.scene.status === "ready", null, { timeout: 15_000 });
  const sceneReady = await page.evaluate(() => window.__pilotPanel?.getWorkspaceSnapshot().resources.scene.status === "ready");
  await recordDiagnostic("fixture-scene-ready", { sceneReady });
  const forcedColors = await page.evaluate(() => matchMedia("(forced-colors: active)").matches);
  await recordDiagnostic("forced-colors-readback", { forcedColors });
  if (!forcedColors) throw new Error("headed Edge did not observe Windows forced colors");
  await page.bringToFront();
  await writeFile(path("ready"), JSON.stringify({ forcedColors, processId: process.pid }));
  stage = "keyboard-pilot";
  await recordDiagnostic("readiness-published", { forcedColors, browserVersion: browser.version() });

  const deadline = Date.now() + 120_000;
  let requestedReport = false;
  while (Date.now() < deadline) {
    const phase = await readJson("phase.json");
    if (phase?.phase && phase.phase !== previousPhase) {
      previousPhase = phase.phase;
      await writeFile(path(`armed-${phase.phase}`), "armed");
    }
    const sent = await readText("key-sent");
    if (sent && sent !== previousSent) {
      previousSent = sent;
      await new Promise((resolve) => setTimeout(resolve, 350));
      const focusWithinPanel = await page.evaluate(() => {
        const panel = document.querySelector(window.__pilotPanelTag);
        let node = document.activeElement;
        while (node) {
          if (node === panel) return true;
          if (node.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
          else {
            const rootNode = node.getRootNode();
            node = node.parentElement || rootNode.host || null;
          }
        }
        return false;
      });
      sawPanelFocus ||= focusWithinPanel;
      await appendFile(path("browser-observations.jsonl"), `${JSON.stringify({ phase: sent, focusWithinPanel })}\n`);
      if (sent === "nvda-report") requestedReport = true;
      await writeFile(path(`ack-${sent}`), "observed");
      if (requestedReport) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!requestedReport) throw new Error("Timed out waiting for the native-keyboard NVDA+Tab phase");

  // Allow the final queued speech callbacks to flush to the temporary receipt.
  await new Promise((resolve) => setTimeout(resolve, 700));
  const events = (await readText("events.jsonl"))
    .split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  const boundaries = (await readText("key-boundaries.jsonl"))
    .split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  const boundaryByPhase = new Map(boundaries.map((boundary) => [boundary.phase, BigInt(boundary.timeNs)]));
  const afterBoundary = (event) => {
    const boundary = boundaryByPhase.get(event.phase);
    return boundary !== undefined && /^\d+$/u.test(event.timeNs)
      && BigInt(event.timeNs) > boundary;
  };
  const loaded = events.some((event) => event.kind === "loaded");
  const reportSpeech = events.filter((event) => event.phase === "nvda-report"
    && event.kind === "speech" && afterBoundary(event));
  const tabSpeech = events.filter((event) => /^tab-[1-8]$/u.test(event.phase)
    && event.kind === "speech" && afterBoundary(event));
  const tabFocusEvents = events.filter((event) => /^tab-[1-8]$/u.test(event.phase) && event.kind === "focus");
  const observedTerms = (records) => new Set(records.flatMap((event) => event.segments || []));
  const correlatedToNvdaFocus = (records) => records.some((event) => event.focusName
    && (event.segments || []).some((segment) => segment.toLowerCase().includes(event.focusName.toLowerCase())
      || event.focusName.toLowerCase().includes(segment.toLowerCase())));
  const tabTerms = observedTerms(tabSpeech);
  const reportTerms = observedTerms(reportSpeech);
  const matchedTerms = [...tabTerms].filter((term) => reportTerms.has(term));
  const currentPid = events.find((event) => event.kind === "loaded")?.pid;
  const sourceHash = events.find((event) => event.kind === "loaded")?.sourceHash;
  const expectedPid = Number(process.env.NVDA_PILOT_PID);
  assert.equal(loaded, true, "NVDA test-only passive plugin did not load");
  assert.ok(Number.isInteger(expectedPid) && currentPid === expectedPid, "NVDA callback PID did not match the launched process");
  assert.ok(events.filter((event) => event.kind !== "loaded").every((event) => event.pid === currentPid
    && event.sourceHash === sourceHash && event.module === "msedge"), "NVDA callback provenance is inconsistent");
  assert.ok(tabSpeech.length > 0, "NVDA queued no whitelisted synthetic-fixture speech during OS Tab navigation");
  assert.ok(reportSpeech.length > 0, "NVDA queued no whitelisted synthetic-fixture speech after NVDA+Tab");
  assert.equal(correlatedToNvdaFocus(tabSpeech), true, "Tab speech did not correlate with NVDA's recognized focused object");
  assert.equal(correlatedToNvdaFocus(reportSpeech), true, "NVDA+Tab speech did not correlate with NVDA's recognized focused object");
  assert.ok(tabFocusEvents.some((focus) => tabSpeech.some((speech) => speech.focusName === focus.name)), "NVDA focus event did not correlate with queued Tab speech");
  assert.ok(matchedTerms.length > 0, "Tab and NVDA+Tab queued no matching synthetic fixture label");
  assert.equal(sawPanelFocus, true, "native OS Tab input did not focus inside the Map Studio fixture");
  assert.ok(currentPid > 0 && sourceHash?.length === 64, "NVDA process/source provenance is missing");

  await writeFile(path("result.json"), JSON.stringify({
    status: "QUEUED_SPEECH_PROOF",
    forcedColors,
    edgeVersion: browser.version(),
    focusEnteredPanel: sawPanelFocus,
    nvdaPid: currentPid,
    pluginSourceHash: sourceHash,
    speechCallbacks: tabSpeech.length + reportSpeech.length,
    matchedSyntheticTerms: matchedTerms,
    audibleOutputVerified: false,
  }));
} catch (error) {
  await recordDiagnostic("stage-failed", {
    errorType: error?.name || "Error",
    error: error?.message || String(error),
  });
  throw error;
} finally {
  await browser?.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await writeFile(path("closed"), "closed").catch(() => {});
}
