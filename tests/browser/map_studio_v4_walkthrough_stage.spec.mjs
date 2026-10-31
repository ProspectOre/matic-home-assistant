import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { accessibilityReadout, cellHash, cellIds, findCell, startStaging } from "../../scripts/walkthrough.mjs";

// The owner walkthrough stage (docs/owner-walkthrough-0.5.md): one URL hash
// puts the real shell gallery into a matrix cell's state, size and setup.
const STAGE = "/map-studio-v4-stage";
const FRAME = "/map-studio-v4-stage-frame";
const GALLERY = "matic-map-studio-gallery-v0-4-0";

async function openFrame(page, hash) {
  await page.goto(`${FRAME}#${hash}`);
  await page.locator("html[data-stage-ready]").waitFor({ state: "attached" });
}

const snapshot = (target) => target.locator(GALLERY).evaluate((gallery) => gallery.getWorkspaceSnapshot());

const stageFrame = async (page) => {
  const frame = page.frameLocator("iframe");
  await frame.locator("html[data-stage-ready]").waitFor({ state: "attached" });
  return frame;
};

test("readouts include the plan heading actions through display:contents", async ({ page }) => {
  await openFrame(page, "steps=plan-saved-intelligent");
  expect(await accessibilityReadout(page)).toContain('button "Edit Daily clean"');
  await page.goto("about:blank");
  await openFrame(page, "steps=plan-edit-areas");
  expect(await accessibilityReadout(page)).toContain('button "More actions"');
});

test("a shared-progress reset fits a short zoomed viewport and keeps actions reachable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 256 });
  await openFrame(page, "steps=plan-cadence-shared:confirmResetCadence");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(256);
  for (const button of await dialog.getByRole("button").all()) {
    await button.focus();
    await button.scrollIntoViewIfNeeded();
    const action = await button.boundingBox();
    expect(action.y).toBeGreaterThanOrEqual(box.y);
    expect(action.y + action.height).toBeLessThanOrEqual(box.y + box.height);
  }
});

for (const [width, height] of [[390, 844], [1024, 768], [1440, 900]]) {
  test(`plan item names wrap and hidden reasons stay inside the page at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openFrame(page, "steps=plan-edit-area-stale");
    const last = page.getByRole("button", { name: "Move Old rug later", exact: true });
    await expect(last).toHaveAccessibleDescription("Old rug is already last");
    expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual({ width, height });
    await page.goto("about:blank");
    await openFrame(page, "steps=plan-edit-areas");
    const name = page.locator(".row-lines bdi").filter({ hasText: "Under the dining table" });
    await expect(name).toBeVisible();
    const bounds = await name.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const box = element.getBoundingClientRect();
      return { text: [...range.getClientRects()].map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })), box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom } };
    });
    for (const text of bounds.text) {
      expect(text.left).toBeGreaterThanOrEqual(bounds.box.left - 1);
      expect(text.right).toBeLessThanOrEqual(bounds.box.right + 1);
      expect(text.top).toBeGreaterThanOrEqual(bounds.box.top - 1);
      expect(text.bottom).toBeLessThanOrEqual(bounds.box.bottom + 1);
    }
  });
}

test("a staged frame lands in its step's scenario and dialog", async ({ page }) => {
  await openFrame(page, "steps=plans,plan-saved-intelligent:confirmDeletePlan&step=2");
  const state = await snapshot(page);
  expect(state.workflow).toBe("plan");
  expect(state.dialog).toBe("confirmDeletePlan");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-stage-error");
});

test("the stage page sizes the frame, names the cell and switches steps", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto(`${STAGE}#${cellHash("R02-C01")}`);
  await expect(page.getByRole("note").locator("strong")).toHaveText("Cell R02-C01");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const banner = page.getByRole("note");
  await expect(banner).toContainText("R02-C01");
  await expect(banner).toContainText("not live Home Assistant");
  const box = await page.locator("iframe").boundingBox();
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.height)).toBe(844);
  expect((await snapshot(await stageFrame(page))).workflow).toBe("plans");
  await page.getByRole("button", { name: "2. plan-saved-intelligent" }).click();
  await expect(page).toHaveURL(/step=2/u);
  await expect(page.getByRole("button", { name: "2. plan-saved-intelligent" })).toHaveAttribute("aria-pressed", "true");
  expect((await snapshot(await stageFrame(page))).workflow).toBe("plan");
});

test("theme and direction stage Home Assistant's dark palette and RTL", async ({ page }) => {
  await openFrame(page, "steps=ready&theme=dark&dir=rtl");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const background = await page.evaluate((tag) =>
    document.querySelector(tag).style.getPropertyValue("--primary-background-color"), GALLERY);
  expect(background).toBe("#111111");
});

test("the pseudo-language translates every common key and keeps placeholders", async ({ page }) => {
  await openFrame(page, "steps=rooms&lang=xa");
  const result = await page.evaluate((tag) => {
    const { localize } = document.querySelector(tag);
    return {
      plain: localize("component.matic_robot.common.area_erase"),
      counted: localize("component.matic_robot.common.v4_rooms_more", { count: 3 }),
      missing: localize("component.matic_robot.common.not_a_key"),
    };
  }, GALLERY);
  expect(result.plain).toMatch(/^\[Éŕåšé·+\]$/u);
  expect(result.counted).toContain("3");
  expect(result.counted).not.toContain("{count}");
  expect(result.missing).toBe("component.matic_robot.common.not_a_key");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-XA");
  // The rooms heading is drawn through the synthetic language.
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(/^\[.+\]$/u);
});

test("a misspelled step is reported, not staged as another state", async ({ page }) => {
  await page.goto(`${STAGE}#cell=R99-C01&steps=plan-savd&w=390&h=844`);
  await expect(page.getByRole("alert")).toContainText('Unknown step "plan-savd"');
  await openFrame(page, "steps=plan-savd");
  await expect(page.locator("html")).toHaveAttribute("data-stage-error", /plan-savd/u);
  await page.goto("about:blank");
  await openFrame(page, "steps=ready&widht=390");
  await expect(page.locator("html")).toHaveAttribute("data-stage-error", /Unknown setting "widht"/u);
});

test("forced colours are flagged unless the browser has them on", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Only Chromium emulates forced colours.");
  await page.goto(`${STAGE}#steps=ready&contrast=forced&motion=reduce&w=1024&h=768`);
  await expect(page.getByText("Forced colours are off in this browser.", { exact: false })).toBeVisible();
  await expect(page.getByText("Reduced motion is off in this browser.", { exact: false })).toBeVisible();
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.reload();
  await stageFrame(page);
  await expect(page.getByText("Forced colours are off in this browser.", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Reduced motion is off in this browser.", { exact: false })).toHaveCount(0);
});

test("every walkthrough cell's hash parses without an error", async ({ page }) => {
  await page.goto("/");
  const ids = cellIds();
  expect(ids).toHaveLength(117);
  const errors = await page.evaluate(async (hashes) => {
    const { parseStageHash } = await import("/map_studio_v4-review/stage.js");
    return hashes.flatMap((hash) => parseStageHash(hash).errors.map((error) => `${hash}: ${error}`));
  }, ids.map((id) => cellHash(id)));
  expect(errors).toEqual([]);
  expect(findCell("R14-C01")).toBeNull();
});

test("a cell ID staged with another cell's settings is refused, not labelled as that cell", async ({ page }) => {
  await page.goto(`${STAGE}#cell=R01-C01&steps=plans&w=1024&h=768`);
  await expect(page.getByRole("alert")).toContainText("do not match cell R01-C01");
  await expect(page.getByRole("note")).not.toContainText(/^Cell R01-C01/u);
  await expect(page.getByRole("note").locator("strong")).toHaveText("Not cell R01-C01");
  // Leaving while the iframe still mounts the gallery can stall WebKit's next navigation.
  await stageFrame(page);
  await page.goto("about:blank");
  await openFrame(page, "cell=R01-C01&steps=plans&w=1024&h=768");
  await expect(page.locator("html")).toHaveAttribute("data-stage-error", /do not match cell R01-C01/u);
  const errors = await page.evaluate(async (hashes) => {
    const { parseStageHash } = await import("/map_studio_v4-review/stage.js");
    return hashes.map((hash) => parseStageHash(hash).errors);
  }, [`${cellHash("R01-C01")}&step=2`, "cell=R14-C01&steps=ready", "steps=plans&w=1024&h=768"]);
  expect(errors[0]).toEqual([]);
  expect(errors[1].join()).toContain("R14-C01 is not a walkthrough cell");
  expect(errors[2]).toEqual([]);
});

test("--print on a read-out cell launches no browser", async ({ browserName }) => {
  test.skip(browserName !== "chromium", "The script does not depend on the test browser.");
  const script = fileURLToPath(new URL("../../scripts/stage_walkthrough.mjs", import.meta.url));
  // No browser binaries: any launch fails, so only a launch-free run prints the line.
  const child = spawn(process.execPath, [script, "R02-C09", "--print", "--port", "0"], {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "/nonexistent-playwright-browsers" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await expect.poll(() => output, { timeout: 15_000 }).toMatch(/Not opening a browser \(--print\)\.|Error/u);
    expect(output).toContain("Not opening a browser (--print).");
    expect(output).not.toContain("accessibility tree");
    expect(child.exitCode).toBeNull();
  } finally {
    child.kill("SIGTERM");
  }
});

test("three cells land in their first step at their size", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  for (const [id, workflow, width, height] of [
    ["R02-C03", "plans", 1024, 768],
    ["R05-C02", "draw", 844, 390],
    ["R03-C07", "plan", 390, 844],
  ]) {
    await page.goto(`${STAGE}#${cellHash(id)}`);
    const frame = await stageFrame(page);
    expect((await snapshot(frame)).workflow).toBe(workflow);
    const box = await page.locator("iframe").boundingBox();
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([width, height]);
  }
});

test("staging binds to this computer unless the network is asked for", async ({ browserName }) => {
  test.skip(browserName !== "chromium", "Server binding does not depend on the browser.");
  const local = await startStaging({ port: 0 });
  try {
    expect(local.server.address().address).toBe("127.0.0.1");
    expect(local.origins).toHaveLength(1);
  } finally {
    await local.close();
  }
  expect(local.server.listening).toBe(false);
  const lan = await startStaging({ port: 0, lan: true });
  try {
    expect(lan.server.address().address).toBe("0.0.0.0");
  } finally {
    await lan.close();
  }
  expect(lan.server.listening).toBe(false);
});
