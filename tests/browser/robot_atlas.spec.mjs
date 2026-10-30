import { expect, test } from "@playwright/test";
import { readdir } from "node:fs/promises";

test("packaged robot atlas resolves beneath the installed versioned module root", async ({ page }) => {
  const chunks = await readdir("custom_components/matic_robot/map_studio_v4/chunks");
  const models = chunks.filter(name => /^robot-model-.*\.js$/u.test(name));
  expect(models).toHaveLength(1);
  const root = "/matic_robot/0.6.0-0123456789ab/map-studio-v4";
  const responses = [];
  page.on("response", response => {
    if (response.url().includes("robot-atlas.")) responses.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
      type: response.headers()["content-type"],
    });
  });
  await page.goto("/");
  const bodyFrame = await page.evaluate(async url => {
    const { drawRobot } = await import(url);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 400;
    const context = canvas.getContext("2d");
    const palette = { accent: [6, 120, 206], onAccent: [255, 255, 255], forced: false };
    const project = (forward, left, height) => ({ x: 200 + forward * 100, y: 200 - left * 100 - height * 100 });
    await new Promise(resolve => drawRobot(context, project, 0, palette, Math.PI / 2, resolve));
    const original = context.drawImage;
    let body = null;
    context.drawImage = function(image, x, y, width, height, ...destination) {
      if (image instanceof HTMLImageElement && y < 384) body = [x, y, width, height];
      return original.call(this, image, x, y, width, height, ...destination);
    };
    drawRobot(context, project, 0, palette, Math.PI / 2, () => {});
    return body;
  }, `${root}/chunks/${models[0]}`);
  expect(bodyFrame).toEqual([0, 0, 128, 128]);
  expect(responses.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
    { path: `${root}/assets/robot-atlas.json`, status: 200, type: "application/json" },
    { path: `${root}/assets/robot-atlas.webp`, status: 200, type: "image/webp" },
  ]);
});
