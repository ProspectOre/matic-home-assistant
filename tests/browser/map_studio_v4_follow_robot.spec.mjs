import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

// Follow the robot keeps the live robot centred until the user moves the map.

const clickInShadow = (panel, selector) => panel.evaluate((element, target) => {
  const scan = (root) => {
    const match = root.querySelector(target);
    if (match) return match;
    for (const child of root.querySelectorAll("*")) {
      const found = child.shadowRoot && scan(child.shadowRoot);
      if (found) return found;
    }
    return null;
  };
  scan(element.shadowRoot).click();
}, selector);

const openFollowing = async (page) => {
  const { panelTag } = await installPanelFixture(page);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  const panel = page.locator(panelTag);
  const following = () => panel.evaluate((element) => element.getWorkspaceSnapshot().followMode === "follow");
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  expect(await following()).toBe(false);

  await clickInShadow(panel, "[aria-controls=map-options]");
  await clickInShadow(panel, "[data-follow-robot]");
  await expect.poll(following).toBe(true);
  await page.keyboard.press("Escape");

  const map = panel.locator("matic-map-shell-v4").locator(".map-root");
  const bounds = await map.boundingBox();
  return { panel, following, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
};

test("Map options turns following on and a drag turns it off", async ({ page }) => {
  const { following, x, y } = await openFollowing(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 30, { steps: 4 });
  await page.mouse.up();
  await expect.poll(following).toBe(false);
});

test("the wheel and the arrow keys turn following off too", async ({ page }) => {
  const wheel = await openFollowing(page);
  await page.mouse.move(wheel.x, wheel.y);
  await page.mouse.wheel(40, 30);
  await expect.poll(wheel.following).toBe(false);

  await page.reload();
  const keys = await openFollowing(page);
  await page.mouse.click(keys.x, keys.y);
  expect(await keys.following()).toBe(true);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(keys.following).toBe(false);
});

test("Fit map turns following off", async ({ page }) => {
  const { following } = await openFollowing(page);
  await page.locator("matic-map-canvas-v4").getByRole("button", { name: "Fit the whole map on screen" }).click();
  await expect.poll(following).toBe(false);
});

test("following pauses during a missing pose and resumes when it returns", async ({ page }) => {
  const { panel, following } = await openFollowing(page);
  await page.evaluate(() => { window.__posePosition = null; });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.exactPose)).toBe(false);
  expect(await following()).toBe(true);
  await page.evaluate(() => { delete window.__posePosition; });
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().map.exactPose)).toBe(true);
  expect(await following()).toBe(true);
});
