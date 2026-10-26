import { expect, test } from "@playwright/test";

const tag = "matic-map-studio-gallery-v0-4-0";
async function mount(page, scenario, narrow) {
  await page.setViewportSize(narrow ? { width: 390, height: 844 } : { width: 1180, height: 760 });
  await page.goto("/");
  await page.evaluate(async ({ tag, scenario, narrow }) => {
    await import("/map_studio_v4-review/review.js");
    await customElements.whenDefined(tag);
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.scenario = scenario;
    gallery.narrow = narrow;
    document.body.style.margin = "0";
    document.body.append(gallery);
  }, { tag, scenario, narrow });
  return page.locator(tag);
}
const snapshot = (page) => page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot(), tag);
const percent = (canvas) => canvas.evaluate((element) => {
  const d = element.rendererDiagnostics();
  return d.fitDistance / d.cameraDistance * 100;
});
async function openZoom(gallery) {
  await gallery.getByRole("button", { name: "Map options", exact: true }).click();
  await gallery.getByRole("menuitem", { name: "Map zoom", exact: true }).click();
  return gallery.getByRole("dialog", { name: "Map zoom", exact: true });
}

for (const mode of ["top", "three", "draw"]) for (const narrow of [false, true]) {
  test(`numeric zoom shares the ${mode} camera and Fit${narrow ? " @mobile" : ""}`, async ({ page }) => {
    const gallery = await mount(page, mode === "draw" ? "draw" : "ready", narrow);
    if (mode !== "draw") await gallery.getByRole("button", { name: mode === "top" ? "2D" : "3D", exact: true }).click();
    const canvas = gallery.locator(".map-canvas");
    const before = await snapshot(page);
    const dialog = await openZoom(gallery);
    const input = dialog.getByLabel("Map zoom percent", { exact: true });
    await expect(input).toBeFocused();
    await expect(gallery.getByRole("button", { name: "Map options", exact: true })).toHaveAttribute("aria-haspopup", "dialog");
    for (const value of [100, 400, 1000]) {
      await dialog.getByRole("button", { name: `${value}%`, exact: true }).click();
      await expect.poll(() => percent(canvas)).toBeCloseTo(value, 5);
      await expect(input).toHaveValue(String(value));
      const state = await snapshot(page);
      const view = mode === "draw" ? "top" : mode;
      expect(state.cameras[view].zoom).toBe(value / 100);
      if (mode === "draw") {
        expect(state.draw.zoomPercent).toBe(value);
        expect(state.draw.circles).toEqual(before.draw.circles);
        await expect.poll(() => gallery.locator(".map-scale").evaluate((element) => {
          const canvas = element.getRootNode().host;
          const pixelsPerMeter = canvas.rendererDiagnostics().topPixelsPerMeter;
          const label = element.lastElementChild.textContent.trim();
          const meters = parseFloat(label) / (label.endsWith("cm") ? 100 : 1);
          const pixels = parseFloat(element.firstElementChild.style.getPropertyValue("--scale-width"));
          return Math.abs(pixels - meters * pixelsPerMeter);
        })).toBeLessThan(0.01);
      }
    }
    if (mode === "draw") await page.screenshot({ path: test.info().outputPath("numeric-zoom.png") });
    await input.fill("375");
    await input.press("Enter");
    await expect.poll(() => percent(canvas)).toBeCloseTo(375, 5);
    await input.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Map options", exact: true })).toBeFocused();
    await gallery.getByRole("button", { name: "Fit the whole map on screen" }).click();
    await expect.poll(() => percent(canvas)).toBeCloseTo(100, 5);
    await gallery.getByRole("button", { name: "Map options", exact: true }).click();
    await expect(gallery.getByRole("menu", { name: "Map options" })).toBeVisible();
  });
}

test("numeric zoom rejects invalid input and closes without losing camera state", async ({ page }) => {
  const gallery = await mount(page, "ready", false);
  const canvas = gallery.locator(".map-canvas");
  const dialog = await openZoom(gallery);
  const input = dialog.getByLabel("Map zoom percent", { exact: true });
  await dialog.getByRole("button", { name: "400%", exact: true }).click();
  for (const value of ["", "99", "1001", "375.5"]) {
    await input.fill(value);
    await input.press("Enter");
    await expect.poll(() => percent(canvas)).toBeCloseTo(400, 5);
    expect(await input.evaluate((element) => element.checkValidity())).toBe(false);
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => percent(canvas)).toBeCloseTo(400, 5);
});

for (const narrow of [false, true]) test(`numeric zoom stays reachable in compact RTL forced colors${narrow ? " @mobile" : ""}`, async ({ page }) => {
  const gallery = await mount(page, "draw", narrow);
  await page.setViewportSize({ width: 320, height: 256 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  const dialog = await openZoom(gallery);
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(box.y + box.height).toBeLessThanOrEqual(256);
  for (const button of await dialog.getByRole("button").all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await dialog.getByRole("button", { name: "1000%", exact: true }).click();
  await expect.poll(() => percent(gallery.locator(".map-canvas"))).toBeCloseTo(1000, 5);
  await page.screenshot({ path: test.info().outputPath("compact-zoom.png") });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("numeric zoom is absent without an admitted visible map", async ({ page }) => {
  const gallery = await mount(page, "map-unavailable", false);
  await gallery.getByRole("button", { name: "Map options", exact: true }).click();
  await expect(gallery.getByRole("menu", { name: "Map options" })).toBeVisible();
  await expect(gallery.getByRole("menuitem", { name: "Map zoom", exact: true })).toHaveCount(0);
});

test("out-of-range gesture zoom remains visible without an invalid prefilled entry", async ({ page }) => {
  const gallery = await mount(page, "ready", false);
  const canvas = gallery.locator(".map-canvas");
  await canvas.locator(".map-root").press("-");
  const actual = await percent(canvas);
  expect(actual).toBeLessThan(100);
  const dialog = await openZoom(gallery);
  await expect(dialog.getByLabel("Current zoom", { exact: true })).toHaveText(`${Math.round(actual)}%`);
  await expect(dialog.getByLabel("Map zoom percent", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "400%", exact: true }).click();
  await expect.poll(() => percent(canvas)).toBeCloseTo(400, 5);
});

test("numeric zoom keeps live and saved camera preferences separate", async ({ page }) => {
  const gallery = await mount(page, "history", false);
  const before = await snapshot(page);
  const dialog = await openZoom(gallery);
  await dialog.getByRole("button", { name: "400%", exact: true }).click();
  const after = await snapshot(page);
  expect(after.cameras).toEqual(before.cameras);
  expect(after.historyCameras[after.view].zoom).toBe(4);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
});

test("numeric zoom remains available with Room colors and matching popup semantics", async ({ page }) => {
  const gallery = await mount(page, "ready", false);
  await gallery.getByRole("button", { name: "2D", exact: true }).click();
  await gallery.getByRole("button", { name: "Room colors", exact: true }).click();
  const canvas = gallery.locator(".map-canvas");
  await expect.poll(() => canvas.evaluate(element => element.rendererDiagnostics().renderedPoints)).toBe(0);
  const dialog = await openZoom(gallery);
  await expect(gallery.getByRole("button", { name: "Map options", exact: true })).toHaveAttribute("aria-haspopup", "dialog");
  await dialog.getByRole("button", { name: "400%", exact: true }).click();
  await expect.poll(() => percent(canvas)).toBeCloseTo(400, 5);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await gallery.getByRole("button", { name: "Map options", exact: true }).click();
  await expect(gallery.getByRole("button", { name: "Map options", exact: true })).toHaveAttribute("aria-haspopup", "menu");
});

for (const [width, depth] of [[1, 1], [10, 1]]) test(`numeric presets persist on a ${width} by ${depth} meter map`, async ({ page }) => {
  const gallery = await mount(page, "ready", false);
  await page.setViewportSize({ width: 1000, height: 300 });
  await page.evaluate(({ tag, width, depth }) => {
    const gallery = document.querySelector(tag);
    const state = gallery.getWorkspaceSnapshot();
    const scene = state.resources.scene.value;
    gallery.replaceWorkspaceState({ ...state, resources: { ...state.resources, scene: { ...state.resources.scene, value: {
      ...scene, revision: scene.revision + 1, metadata: { ...scene.metadata, metersPerCell: 0.05, span: [width * 20, depth * 20] },
    } } } });
  }, { tag, width, depth });
  const canvas = gallery.locator(".map-canvas");
  for (const mode of ["2D", "3D"]) {
    await gallery.getByRole("button", { name: mode, exact: true }).click();
    const dialog = await openZoom(gallery);
    for (const value of [100, 400, 1000]) {
      await dialog.getByRole("button", { name: `${value}%`, exact: true }).click();
      await expect.poll(() => percent(canvas)).toBeCloseTo(value, 5);
    }
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await gallery.getByRole("button", { name: mode === "2D" ? "3D" : "2D", exact: true }).click();
    await gallery.getByRole("button", { name: mode, exact: true }).click();
    await expect.poll(() => percent(canvas)).toBeCloseTo(1000, 5);
  }
});
