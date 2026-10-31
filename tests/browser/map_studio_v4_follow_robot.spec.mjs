import { expect, test } from "@playwright/test";
import { build } from "esbuild";
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
  const following = () => panel.evaluate((element) => element.getWorkspaceSnapshot().followRobot);
  await expect.poll(() => panel.evaluate((element) => element.getWorkspaceSnapshot().resources.scene.status)).toBe("ready");
  expect(await following()).toBe(false);

  await clickInShadow(panel, "[aria-controls=map-options]");
  await clickInShadow(panel, "[data-follow-robot]");
  await expect.poll(following).toBe(true);
  await page.keyboard.press("Escape");

  const map = panel.locator("matic-map-shell-v4").locator(".map-root");
  const bounds = await map.boundingBox();
  return { following, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
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

test("renderer centres a map point without saving the camera", async ({ page }) => {
  const bundle = await build({ stdin: { contents: 'export { RendererController } from "./frontend/map-studio-v4/renderer-controller"; export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";', resolveDir: process.cwd() }, bundle: true, format: "esm", write: false });
  await page.route("**/follow-renderer.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { RendererController, createGalleryState } = await import("/follow-renderer.js");
    const scene = document.createElement("canvas"), overlay = document.createElement("canvas");
    for (const canvas of [scene, overlay]) {
      Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", width: "720px", height: "540px" });
      document.body.append(canvas);
    }
    let notified = 0;
    const renderer = new RendererController(scene, overlay, { onCamera: () => { notified += 1; } });
    const state = createGalleryState("ready");
    renderer.setState(state);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const centre = renderer.screenToMap(360, 270);
    const target = { x: centre.x + 0.4, y: centre.y - 0.3 };
    notified = 0;
    renderer.centerOnMeters(target.x, target.y);
    const after = renderer.screenToMap(360, 270);
    renderer.dispose();
    return { dx: after.x - target.x, dy: after.y - target.y, notified };
  });
  expect(Math.abs(result.dx)).toBeLessThan(0.01);
  expect(Math.abs(result.dy)).toBeLessThan(0.01);
  expect(result.notified).toBe(0);
});
