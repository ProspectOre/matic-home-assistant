import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

async function mount(page, { visual = true, top = 0, embedded = false, moduleSource = "typescript" } = {}) {
  await page.setViewportSize({ width: 402, height: 714 });
  await page.addInitScript(({ visual }) => {
    const viewport = visual ? Object.assign(new EventTarget(), { height: 714, offsetTop: 0 }) : undefined;
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  }, { visual });
  const { panelTag } = await installPanelFixture(page, {
    moduleSource,
    initialPlanCatalog: { rooms: [{ room_id: "office", name: "Office" }], plans: [], selected_plan: null },
  });
  await page.evaluate(({ embedded, top }) => {
    document.documentElement.style.height = "754px";
    document.body.style.cssText = `margin:0;padding-top:${top}px;height:754px;box-sizing:border-box`;
    const parent = document.createElement("div");
    parent.style.height = embedded ? "400px" : "754px";
    const panel = window.__panelFixture.createPanel();
    panel.style.blockSize = "100%";
    parent.append(panel);
    document.body.replaceChildren(parent);
    window.__viewportPanel = panel;
    window.__viewportParent = parent;
  }, { embedded, top });
  const panel = page.locator(panelTag);
  await expect(panel.locator(".app")).toBeVisible();
  await panel.getByRole("button", { name: /^Clean rooms /u }).click();
  return panel;
}

async function expectHeight(panel, height) {
  const action = panel.locator(".action-bar").getByRole("button", { name: "Clean rooms", exact: true });
  await expect(action).toBeVisible();
  const panelTag = await panel.evaluate(element => element.localName);
  // A responsive rerender can replace the action between separate awaits.
  // Read visibility and both rectangles in one task, retrying until settled.
  await expect.poll(() => action.evaluateAll((buttons, tag) => {
    if (buttons.length !== 1) return null;
    const bounds = buttons[0].getBoundingClientRect();
    const host = document.querySelector(tag)?.getBoundingClientRect();
    return host ? {
      height: Math.round(host.height),
      visible: bounds.width > 0 && bounds.height > 0,
      contained: bounds.bottom <= host.bottom + 1,
    } : null;
  }, panelTag)).toEqual({ height, visible: true, contained: true });
}

test("visible viewport bounds the primary and recovers after toolbar and keyboard changes", async ({ page }) => {
  const panel = await mount(page);
  await expectHeight(panel, 714);
  for (const [height, event, target] of [[440, "resize", "visualViewport"], [600, "resize", "window"], [800, "scroll", "visualViewport"]]) {
    await page.evaluate(({ height, event, target }) => {
      window.visualViewport.height = height;
      (target === "window" ? window : window.visualViewport).dispatchEvent(new Event(event));
    }, { height, event, target });
    await expectHeight(panel, Math.min(height, 754));
  }
});

test("visual offset and host inset share layout coordinates", async ({ page }) => {
  const panel = await mount(page, { top: 64 });
  await page.evaluate(() => {
    Object.assign(window.visualViewport, { height: 500, offsetTop: 100 });
    window.visualViewport.dispatchEvent(new Event("scroll"));
  });
  await expectHeight(panel, 536);
  await page.evaluate(() => {
    window.__viewportParent.style.transform = "translateY(20px)";
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  await expectHeight(panel, 516);
});

test("a smaller embedded parent stays small and can grow again", async ({ page }) => {
  const panel = await mount(page, { embedded: true });
  await expectHeight(panel, 400);
  await page.evaluate(() => { window.__viewportParent.style.height = "900px"; });
  await expectHeight(panel, 714);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.evaluate(() => {
    window.visualViewport.height = 1024;
    window.dispatchEvent(new Event("resize"));
  });
  await expectHeight(panel, 900);
});

test("window sizing remains available without VisualViewport", async ({ page }) => {
  const panel = await mount(page, { visual: false, top: 64 });
  await expectHeight(panel, 650);
  await page.setViewportSize({ width: 768, height: 834 });
  await expectHeight(panel, 754);
});

test("detached panels stop reacting and reconnect to current viewport geometry", async ({ page }) => {
  const panel = await mount(page);
  await expectHeight(panel, 714);
  const result = await page.evaluate(async () => {
    const panel = window.__viewportPanel;
    panel.remove();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const before = panel.getAttribute("style");
    window.visualViewport.height = 500;
    window.visualViewport.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("fullscreenchange"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const unchanged = panel.getAttribute("style") === before;
    window.__viewportParent.append(panel);
    return unchanged;
  });
  expect(result).toBe(true);
  await expectHeight(panel, 500);
});

test("packaged panel keeps its primary inside the visible viewport after rotation", async ({ page }) => {
  const panel = await mount(page, { moduleSource: "packaged" });
  await expectHeight(panel, 714);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    window.visualViewport.height = 390;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expectHeight(panel, 390);
});
