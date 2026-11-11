#!/usr/bin/env node
// Stages one interface stage cell live (docs/testing.md#interface-stage).
//
//   npm run stage:walkthrough -- --list
//   npm run stage:walkthrough -- R01-C01            # opens Safari at the cell
//   npm run stage:walkthrough -- R04-C05 --lan      # touch: also serve on the Wi-Fi
//   npm run stage:walkthrough -- R02-C01 --print    # print the URL only
//
// Synthetic fixtures only: nothing here talks to Home Assistant or a robot.
// The server runs until Ctrl-C; with --lan it is reachable on the local
// network only while this script runs.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FRAME_PATH, accessibilityReadout, cellHash, cellIds, cellUrl, findCell, startStaging } from "./walkthrough.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

if (flag("--list")) {
  for (const id of cellIds()) {
    const { row, column } = findCell(id);
    process.stdout.write(`${id}\t${row.journey} at ${column.setup}\t#${cellHash(id)}\n`);
  }
  process.exit(0);
}

const id = args.find((arg) => !arg.startsWith("--") && arg !== option("--port", null));
const cell = findCell(id);
if (!cell) fail(`Usage: npm run stage:walkthrough -- <cell, e.g. R01-C01> [--lan] [--print] [--port 4180] | --list`);

const bundle = fileURLToPath(new URL("../tests/browser/.generated/map-studio-v4-review/stage.js", import.meta.url));
if (!existsSync(bundle)) fail("The review bundle has no stage. Run npm run build:map-studio-v4 first.");

const lan = flag("--lan");
const staging = await startStaging({ lan, port: Number(option("--port", "4180")) });
const url = cellUrl(staging.origins[0], id);
const position = cellIds().indexOf(id) + 1;
const out = (line) => process.stdout.write(`${line}\n`);
out(`Cell ${id} (${position} of ${cellIds().length}): ${cell.row.journey} at ${cell.column.setup}.`);
out(`Try: ${cell.row.check}.`);
out(url);
if (lan) {
  out("On the iPhone or iPad (same Wi-Fi), open:");
  for (const origin of staging.origins.slice(1)) out(`  ${cellUrl(origin, id)}`);
  out("These addresses work only while this script runs.");
} else if (cell.column.stage === "touch") {
  out("Touch cells need the phone or tablet: run again with --lan.");
}

const browsers = [];
const stop = async () => {
  await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
  await staging.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const [width, height] = ["w", "h"].map((key) => Number(new URLSearchParams(cellHash(id)).get(key)) || undefined);

const print = flag("--print");

if (cell.column.stage === "readout" && !print) {
  // Browser accessibility snapshots, names and roles as text, for every step.
  // These supplement the Safari check; --print launches no browser at all.
  const { webkit } = await import("@playwright/test");
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: width ?? 390, height: height ?? 844 } });
  for (const [index, step] of cell.row.steps.entries()) {
    await page.goto("about:blank");
    await page.goto(`${cellUrl(staging.origins[0], id, FRAME_PATH)}&step=${index + 1}`);
    await page.locator("html[data-stage-ready]").waitFor({ state: "attached" });
    out(`Step ${index + 1} of ${cell.row.steps.length}, ${step}: accessibility tree (names and roles):`);
    out(await accessibilityReadout(page));
  }
  await browser.close();
}

if (print) {
  out("Not opening a browser (--print).");
} else if (cell.column.stage === "chromium") {
  // Safari has no forced-colours mode, so this cell opens Chromium with
  // forced colours and reduced motion emulated, live and interactive.
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: false, args: ["--window-size=1400,1000"] });
  browsers.push(browser);
  const page = await browser.newPage({ viewport: null });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto(url);
  browser.on("disconnected", stop);
  out("Opened in Chromium with forced colours and reduced motion. Close the window or press Ctrl-C to stop.");
} else if (process.platform === "darwin") {
  spawn("open", ["-a", "Safari", url], { stdio: "ignore" }).unref();
  out("Opened in Safari. Press Ctrl-C to stop.");
} else {
  out("Open the URL above in a browser. Press Ctrl-C to stop.");
}

