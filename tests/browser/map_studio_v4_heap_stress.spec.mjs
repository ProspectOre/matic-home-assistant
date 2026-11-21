// Diagnostic only (never merged): which way of leaving a stage page corrupts
// Linux WebKit, and which WebKit process dies.
import { readdirSync, readFileSync } from "node:fs";
import { test } from "@playwright/test";

const ROUNDS = Number(process.env.STRESS_ROUNDS ?? 150);
const SETUPS = [
  ["ready", { width: 844, height: 390 }],
  ["cleaning", { width: 844, height: 390 }],
  ["plans", { width: 320, height: 256 }],
  ["rooms", { width: 844, height: 390 }],
  ["draw", { width: 844, height: 390 }],
  ["plan-saved-intelligent", { width: 1440, height: 900 }],
  ["history", { width: 844, height: 390 }],
];

const processes = () => readdirSync("/proc").filter((entry) => /^\d+$/u.test(entry)).flatMap((pid) => {
  try {
    const comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    const ppid = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").pop().split(" ")[1];
    return /Network|WebProc|GPU|MiniBrowser|WPE|WebKit/iu.test(comm) ? [`${comm}:${pid}<${ppid}`] : [];
  } catch {
    return [];
  }
});
const network = () => processes().filter((entry) => /Network/iu.test(entry)).sort().join(" ");

function inflight(page) {
  const open = new Set();
  page.on("request", (request) => open.add(request));
  page.on("requestfinished", (request) => open.delete(request));
  page.on("requestfailed", (request) => open.delete(request));
  return {
    open,
    async settled() {
      for (let quiet = 0; quiet < 3;) {
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve))));
        quiet = open.size === 0 ? quiet + 1 : 0;
      }
    },
  };
}

async function run(name, page, round) {
  const requests = inflight(page);
  const started = Date.now();
  const stamp = () => `${new Date().toISOString()} [${name}]`;
  let before = network();
  console.log(`${stamp()} start; processes: ${processes().join(" ")}`);
  const failures = [];
  let cancelled = 0;
  for (let index = 0; index < ROUNDS; index += 1) {
    try {
      cancelled += await round(index, requests);
    } catch (error) {
      failures.push(`round ${index}: ${String(error.message).split("\n")[0]}`);
      console.log(`${stamp()} round ${index} FAILED: ${String(error.message).split("\n")[0]}; processes: ${processes().join(" ")}`);
    }
    const now = network();
    if (now !== before) {
      console.log(`${stamp()} round ${index}: network processes changed: ${before} -> ${now}`);
      before = now;
    }
  }
  console.log(`${stamp()} done: ${ROUNDS} rounds in ${Date.now() - started} ms, ${cancelled} requests in flight when left, ${failures.length} failures`);
  if (failures.length) throw new Error(`${name}: ${failures.join("; ")}`);
}

const open = async (page, index) => {
  const [steps, viewport] = SETUPS[index % SETUPS.length];
  await page.setViewportSize(viewport);
  await page.goto("about:blank");
  await page.goto(`/map-studio-v4-stage-frame#steps=${steps}`);
  await page.locator("html[data-stage-ready]").waitFor({ state: "attached" });
};

test.describe.configure({ timeout: 20 * 60_000 });

test("A: leave the stage frame as soon as it says ready", async ({ page }) => {
  await run("A", page, async (index, requests) => {
    await open(page, index);
    return requests.open.size;
  });
});

test("B: leave the stage frame once its requests have settled", async ({ page }) => {
  await run("B", page, async (index, requests) => {
    await open(page, index);
    await requests.settled();
    return requests.open.size;
  });
});

test("C: leave a page with no map while its module requests are in flight", async ({ page }) => {
  await run("C", page, async (index, requests) => {
    await page.goto("about:blank");
    await page.goto("/");
    // Starts the review graph's fetches and leaves without waiting for them.
    await page.evaluate(() => { void import(`/map_studio_v4-review/review.js?round=${Math.random()}`).catch(() => {}); });
    await page.waitForTimeout(index % 4 * 5);
    return requests.open.size;
  });
});

test("D: change the stage page's hash as soon as its frame says ready", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/map-studio-v4-stage#steps=ready&w=1024&h=768");
  await run("D", page, async (index, requests) => {
    const [steps] = SETUPS[index % SETUPS.length];
    await page.evaluate((hash) => new Promise((resolve) => {
      addEventListener("hashchange", () => resolve(), { once: true });
      location.hash = hash;
    }), `steps=${steps}&w=${index % 2 ? 844 : 1024}&h=${index % 2 ? 390 : 768}&step=1`);
    await page.frameLocator("iframe").locator(`html[data-stage-ready]`).waitFor({ state: "attached" });
    return requests.open.size;
  });
});

test("E: change the stage page's hash once its frame's requests have settled", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/map-studio-v4-stage#steps=ready&w=1024&h=768");
  await run("E", page, async (index, requests) => {
    const [steps] = SETUPS[index % SETUPS.length];
    await page.evaluate((hash) => new Promise((resolve) => {
      addEventListener("hashchange", () => resolve(), { once: true });
      location.hash = hash;
    }), `steps=${steps}&w=${index % 2 ? 844 : 1024}&h=${index % 2 ? 390 : 768}&step=1`);
    await page.frameLocator("iframe").locator(`html[data-stage-ready]`).waitFor({ state: "attached" });
    await requests.settled();
    return requests.open.size;
  });
});
