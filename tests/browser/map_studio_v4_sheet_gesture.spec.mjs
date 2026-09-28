import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";

async function loadNarrowGallery(page) {
  const bundle = await build({
    stdin: {
      contents: 'export * from "./frontend/map-studio-v4/review";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route("**/sheet-gesture-review.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await import("/sheet-gesture-review.js");
  });
  await page.evaluate(async (tag) => {
    await customElements.whenDefined(tag);
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.scenario = "ready";
    gallery.narrow = true;
    document.body.style.margin = "0";
    document.body.append(gallery);
  }, GALLERY_TAG);
  return page.locator(`${GALLERY_TAG} .mobile-sheet`);
}

async function dispatchTouchDrag(target, startY, endY) {
  await target.evaluate((element, { from, to }) => {
    const pointer = (type, clientY) => new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerId: 7,
      pointerType: "touch",
      clientY,
      button: 0,
      timeStamp: performance.now(),
    });
    element.dispatchEvent(pointer("pointerdown", from));
    element.dispatchEvent(pointer("pointermove", to));
    element.dispatchEvent(pointer("pointerup", to));
  }, { from: startY, to: endY });
}

test.describe("Map Studio mobile sheet gesture ownership", () => {
  test("does not collapse the sheet when a downward drag starts on an interactive control", async ({ page }) => {
    const sheet = await loadNarrowGallery(page);
    await expect(sheet).toHaveAttribute("data-detent", "half");

    await page.locator(`${GALLERY_TAG} #sheet-body`).evaluate((body) => {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = "Synthetic interactive control";
      body.append(control);
    });
    await dispatchTouchDrag(
      page.locator(`${GALLERY_TAG} #sheet-body`).getByRole("button", { name: "Synthetic interactive control" }),
      100,
      170,
    );

    await expect(sheet).toHaveAttribute("data-detent", "half");
  });

  test("allows an intentional downward drag that starts on the sheet body", async ({ page }) => {
    const sheet = await loadNarrowGallery(page);
    await expect(sheet).toHaveAttribute("data-detent", "half");

    await dispatchTouchDrag(page.locator(`${GALLERY_TAG} #sheet-body`), 100, 170);

    await expect(sheet).toHaveAttribute("data-detent", "peek");
  });
});
