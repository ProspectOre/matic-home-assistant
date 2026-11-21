// Diagnostic only (never merged): which way of leaving a stage page corrupts
// Linux WebKit, and which WebKit process dies.
import { readdirSync, readFileSync } from "node:fs";
import { test } from "@playwright/test";

const SCALE = Number(process.env.STRESS_SCALE ?? 1);
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

async function run(name, page, rounds, round) {
  const requests = inflight(page);
  const started = Date.now();
  const stamp = () => `${new Date().toISOString()} [${name}]`;
  let before = network();
  console.log(`${stamp()} start; processes: ${processes().join(" ")}`);
  const failures = [];
  let cancelled = 0;
  for (let index = 0; index < rounds * SCALE; index += 1) {
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
  console.log(`${stamp()} done: ${rounds * SCALE} rounds in ${Date.now() - started} ms, ${cancelled} requests in flight when left, ${failures.length} failures`);
  if (failures.length) throw new Error(`${name}: ${failures.join("; ")}`);
}

const open = async (page, index, query = "?preload=0") => {
  const [steps, viewport] = SETUPS[index % SETUPS.length];
  await page.setViewportSize(viewport);
  await page.goto("about:blank");
  await page.goto(`/map-studio-v4-stage-frame${query}#steps=${steps}`);
  await page.locator("html[data-stage-ready]").waitFor({ state: "attached" });
};

test.describe.configure({ timeout: 25 * 60_000 });

test("A: lazy chunks, leave the stage frame as soon as it says ready", async ({ page }) => {
  await run("A", page, 3000, async (index, requests) => {
    await open(page, index);
    return requests.open.size;
  });
});

test("P: chunks loaded before mount, leave the stage frame as soon as it says ready", async ({ page }) => {
  await run("P", page, 3000, async (index, requests) => {
    await open(page, index, "");
    return requests.open.size;
  });
});

