import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";

async function loadNarrowGallery(page, scenario = "ready") {
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
  await page.evaluate(async ({ tag, scenario }) => {
    await customElements.whenDefined(tag);
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.scenario = scenario;
    gallery.narrow = true;
    document.body.style.margin = "0";
    document.body.append(gallery);
  }, { tag: GALLERY_TAG, scenario });
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

    await page.locator(`${GALLERY_TAG} .sheet-body`).evaluate((body) => {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = "Synthetic interactive control";
      body.append(control);
    });
    await dispatchTouchDrag(
      page.locator(`${GALLERY_TAG} .sheet-body`).getByRole("button", { name: "Synthetic interactive control" }),
      100,
      170,
    );

    await expect(sheet).toHaveAttribute("data-detent", "half");
  });

  test("allows an intentional downward drag that starts on the sheet body", async ({ page }) => {
    const sheet = await loadNarrowGallery(page);
    await expect(sheet).toHaveAttribute("data-detent", "half");

    await dispatchTouchDrag(page.locator(`${GALLERY_TAG} .sheet-body`), 100, 170);

    await expect(sheet).toHaveAttribute("data-detent", "peek");
  });

  test("a downward swipe that starts on the pinned heading or notice steps the sheet down", async ({ page }) => {
    const sheet = await loadNarrowGallery(page);
    await page.evaluate((tag) => {
      const shell = document.querySelector(tag).shadowRoot.querySelector(".stage").firstElementChild;
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-notice", notice: { tone: "warning", key: "v4_notice_sample", fallback: "Swipe sample" } },
        bubbles: true,
        composed: true,
      }));
    }, GALLERY_TAG);
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await dispatchTouchDrag(page.locator(`${GALLERY_TAG} .panel-heading h2`), 100, 170);
    await expect(sheet).toHaveAttribute("data-detent", "peek");

    await sheet.getByRole("button", { name: "Expand panel" }).click();
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await dispatchTouchDrag(page.locator(`${GALLERY_TAG} [data-notice-slot] .notice-text`), 100, 170);
    await expect(sheet).toHaveAttribute("data-detent", "peek");
  });

  test("a swipe on the heading scrolls a scrolled pinned top back before it steps the sheet down @mobile", async ({ page }) => {
    const sheet = await loadNarrowGallery(page);
    await page.evaluate((tag) => {
      const shell = document.querySelector(tag).shadowRoot.querySelector(".stage").firstElementChild;
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-notice", notice: { tone: "warning", key: "v4_notice_sample", fallback: "A tall notice. ".repeat(26) } },
        bubbles: true,
        composed: true,
      }));
    }, GALLERY_TAG);
    await expect(page.locator(`${GALLERY_TAG} [data-notice-slot]`)).toBeVisible();
    const top = page.locator(`${GALLERY_TAG} .panel-top`);
    const scrolled = await top.evaluate((element) => {
      element.scrollTop = 40;
      return { scrollTop: element.scrollTop, overflow: element.scrollHeight - element.clientHeight };
    });
    expect(scrolled.scrollTop, `the pinned top must scroll (overflow ${scrolled.overflow} px)`).toBe(40);
    await expect(page.locator(`${GALLERY_TAG} .sheet-body`)).toHaveJSProperty("scrollTop", 0);

    await dispatchTouchDrag(page.locator(`${GALLERY_TAG} .panel-heading h2`), 100, 170);
    await expect(sheet, "the pinned top is scrolled, so the swipe scrolls it, not the sheet").toHaveAttribute("data-detent", "half");

    await top.evaluate((element) => { element.scrollTop = 0; });
    await dispatchTouchDrag(page.locator(`${GALLERY_TAG} .panel-heading h2`), 100, 170);
    await expect(sheet).toHaveAttribute("data-detent", "peek");
  });

  // A scroller is a tab stop only for the keyboard (MS-AXE-02); it is not a
  // control, so a swipe that starts inside one still steps the sheet.
  test("a swipe that starts inside a pinned top that is a tab stop steps the sheet down @mobile", async ({ page }) => {
    const sheet = await loadNarrowGallery(page, "paused");
    // A small phone: the regular sheet at half clips this pinned top. (A
    // landscape phone gets the compact sheet, which has no half.)
    await page.setViewportSize({ width: 360, height: 480 });
    await page.locator(`${GALLERY_TAG} .stage`).evaluate((stage) => {
      Object.assign(stage.style, { blockSize: "100dvh", minBlockSize: "0", maxInlineSize: "none" });
    });
    await expect(page.locator(`${GALLERY_TAG} .panel-top`)).toHaveAttribute("tabindex", "0");
    const detent = await sheet.getAttribute("data-detent");
    await dispatchTouchDrag(page.locator(`${GALLERY_TAG} .panel-heading h2`), 100, 170);
    const lower = { full: "half", half: "peek" }[detent];
    expect(lower, `the sheet starts above peek (${detent})`).toBeDefined();
    await expect(sheet, "a downward swipe steps the sheet down").toHaveAttribute("data-detent", lower);
  });

  test("keeps the toast on the sheet's top edge while the handle is dragged", async ({ page }) => {
    const sheet = await loadNarrowGallery(page);
    await page.evaluate((tag) => {
      const shell = document.querySelector(tag).shadowRoot.querySelector(".stage").firstElementChild;
      shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        detail: { type: "set-notice", notice: { tone: "success", key: "v4_notice_sample", fallback: "Drag sample" } },
        bubbles: true,
        composed: true,
      }));
    }, GALLERY_TAG);
    const toast = page.locator(`${GALLERY_TAG} [data-notice-toast]`);
    await expect(toast).toBeVisible();

    const gaps = await page.locator(`${GALLERY_TAG} .sheet-grip`).evaluate(async (grip) => {
      const root = grip.getRootNode();
      const sheetBox = () => root.querySelector(".mobile-sheet").getBoundingClientRect();
      const toastBox = () => root.querySelector("[data-notice-toast]").getBoundingClientRect();
      const pointer = (type, clientY) => new PointerEvent(type, {
        bubbles: true, composed: true, pointerId: 9, pointerType: "touch", clientY, button: 0,
      });
      const gap = () => sheetBox().top - toastBox().bottom;
      const startY = sheetBox().top + 10;
      const measured = { rest: gap(), during: [] };
      grip.dispatchEvent(pointer("pointerdown", startY));
      for (const dy of [-80, 60, 160]) {
        grip.dispatchEvent(pointer("pointermove", startY + dy));
        await new Promise(requestAnimationFrame);
        measured.during.push(gap());
      }
      grip.dispatchEvent(pointer("pointercancel", startY + 160));
      return measured;
    });
    // At rest the toast sits 8 px (plus the sheet height's sub-pixel ceil)
    // above the sheet, and it keeps that gap at every drag position.
    expect(gaps.rest).toBeGreaterThanOrEqual(8);
    expect(gaps.rest).toBeLessThan(9);
    expect(gaps.during.map((during) => Math.round(during - gaps.rest))).toEqual([0, 0, 0]);
    await expect(sheet).toHaveAttribute("data-detent", "half");
  });

  test("detaching during a drag clears the gesture and restores sheet observation", async ({ page }) => {
    const sheet = await loadNarrowGallery(page);
    await expect(sheet).toHaveAttribute("data-detent", "half");
    const result = await page.locator(GALLERY_TAG).locator(".sheet-grip").evaluate(async (grip) => {
      const shell = grip.getRootNode().host;
      const parent = shell.parentElement;
      const sheet = grip.closest(".mobile-sheet");
      const pointer = (type, clientY) => new PointerEvent(type, {
        bubbles: true, composed: true, pointerId: 9, pointerType: "touch", clientY, button: 0,
      });
      grip.dispatchEvent(pointer("pointerdown", 100));
      grip.dispatchEvent(pointer("pointermove", 150));
      const dragged = sheet.style.transform;
      shell.remove();
      const cleared = sheet.style.transform;
      shell.requestUpdate();
      await shell.updateComplete;
      parent.append(shell);
      await shell.updateComplete;
      grip.dispatchEvent(pointer("pointerdown", 100));
      grip.dispatchEvent(pointer("pointerup", 100));
      await shell.updateComplete;
      return { dragged, cleared, detent: sheet.dataset.detent };
    });
    expect(result.dragged).not.toBe("");
    expect(result.cleared).toBe("");
    expect(result.detent).toBe("full");
    await expect.poll(() => sheet.evaluate((element) => {
      const canvas = element.getRootNode().querySelector("matic-map-canvas-v4");
      return Number.parseInt(canvas.style.getPropertyValue("--map-sheet-offset"), 10) === Math.ceil(element.getBoundingClientRect().height);
    })).toBe(true);
  });

  test("a view change sets the sheet height without a transition; a detent step still animates", async ({ page }) => {
    const sheet = await loadNarrowGallery(page, "plan-saved-intelligent");
    await expect(sheet).toHaveAttribute("data-detent", "half");
    // Each change is made and read in one task, once the shell has rendered
    // it, so a 180 ms transition cannot finish before it is counted.
    const heightTransitions = (change) => page.evaluate(async ({ tag, change }) => {
      const gallery = document.querySelector(tag);
      const shell = gallery.shadowRoot.querySelector(".stage").firstElementChild;
      const sheet = shell.shadowRoot.querySelector(".mobile-sheet");
      if (change === "edit") {
        shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
          detail: { type: "set-plan-view", view: "edit" },
          bubbles: true,
          composed: true,
        }));
      } else {
        sheet.querySelector('button[aria-label="Collapse panel"]').click();
      }
      await gallery.updateComplete;
      await shell.updateComplete;
      return {
        detent: sheet.dataset.detent,
        // Engines report the logical block-size as the physical height.
        running: sheet.getAnimations()
          .filter((animation) => ["block-size", "height"].includes(animation.transitionProperty)).length,
      };
    }, { tag: GALLERY_TAG, change });

    // Run to Edit opens the sheet to full: the view, not the user, moved it,
    // so it lands at once and leaves nothing running under the next click.
    expect(await heightTransitions("edit")).toEqual({ detent: "full", running: 0 });
    // A step the user asks for still eases between detents.
    expect(await heightTransitions("step")).toEqual({ detent: "half", running: 1 });
  });

  test("More actions, which takes Edit's place under the pointer, changes colour without a fade", async ({ page }) => {
    await loadNarrowGallery(page, "plan-saved-intelligent");
    const edit = page.locator(GALLERY_TAG).getByRole("button", { name: "Edit Daily clean", exact: true });
    await edit.hover();
    await edit.click();
    const more = page.locator(GALLERY_TAG).getByRole("button", { name: "More actions", exact: true });
    await expect(more).toBeVisible();
    // A colour fade started by the button appearing under a still pointer
    // would still be running under the next click.
    expect(await more.evaluate((button) => getComputedStyle(button).transitionDuration.split(", ")
      .every((duration) => duration === "0s"))).toBe(true);
  });
});
