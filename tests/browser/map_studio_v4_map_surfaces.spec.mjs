// UX5 Map surfaces (docs/ux-spec-0.5/map-surfaces.md; D1-D3 accepted
// 2026-10-11): one input-aware help popover in every workflow, Full map,
// the Draw tool row and precision, area review and history.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";
const CANVAS_TAG = "matic-map-canvas-v4";

async function loadGallery(page, { scenario = "ready", narrow = false, viewport = null } = {}) {
  if (viewport) await page.setViewportSize(viewport);
  else if (narrow) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    window.__galleryModule = await import("/map_studio_v4-review/review.js");
  });
  await page.evaluate(async ({ tag, selectedScenario, selectedNarrow }) => {
    await customElements.whenDefined(tag);
    const gallery = document.createElement(tag);
    gallery.controls = false;
    gallery.scenario = selectedScenario;
    gallery.narrow = selectedNarrow;
    document.body.style.margin = "0";
    document.body.append(gallery);
  }, { tag: GALLERY_TAG, selectedScenario: scenario, selectedNarrow: narrow });
  return page.locator(GALLERY_TAG);
}

const snapshot = (page) => page.evaluate((tag) => document.querySelector(tag).getWorkspaceSnapshot(), GALLERY_TAG);

const patchState = (gallery, patch) => gallery.evaluate((element, applied) => {
  element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), ...applied });
}, patch);

const canvasOf = (gallery) => gallery.locator(CANVAS_TAG);
const panelOf = (gallery) => gallery.getByRole("complementary", { name: "Cleaning panel" });
const helpButton = (gallery) => canvasOf(gallery).getByRole("button", { name: "How to move the map", exact: true });
const helpDialog = (gallery) => canvasOf(gallery).getByRole("dialog", { name: "How to move the map" });
const optionsButton = (gallery) => gallery.getByRole("button", { name: "Map options", exact: true });
const optionsMenu = (gallery) => gallery.getByRole("menu", { name: "Map options" });

test("empty Home Map options stays styled when the workflow chunk is unavailable", async ({ page }) => {
  const workflowRequests = [];
  await page.route("**/chunks/workflow-panel-*.js", (route) => {
    workflowRequests.push(route.request().url());
    return route.abort();
  });
  const gallery = await loadGallery(page, { scenario: "home-unpinned", narrow: true });
  const launcher = optionsButton(gallery);
  await launcher.click();
  const menu = optionsMenu(gallery);
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("position", "absolute");
  await expect(menu.getByRole("menuitemradio").first()).toBeFocused();
  const names = menu.getByRole("menuitemcheckbox", { name: "Room names" });
  await expect(names.locator(".ms-switch")).toHaveCSS("position", "relative");
  const checked = await names.getAttribute("aria-checked");
  await names.click();
  await expect(names).toHaveAttribute("aria-checked", String(checked !== "true"));
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(launcher).toBeFocused();
  expect(workflowRequests).toHaveLength(0);
});

const rows = async (dialog) => {
  // The first "?" press may wait for the views chunk; the rows follow it.
  await dialog.locator("dt").first().waitFor();
  const terms = await dialog.locator("dt").allTextContents();
  const details = await dialog.locator("dd").allTextContents();
  return Object.fromEntries(terms.map((term, index) => [term, details[index]]));
};

const drag = async (page, from, to, options = {}) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down(options);
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up(options);
};

test.describe("help (map-surfaces.md §5 Help, §11 MS-HELP-01/02)", () => {
  test("empty Home Help loads its own styled chunk and returns focus without workflow views", async ({ page }) => {
    const workflowRequests = [];
    const helpRequests = [];
    page.on("request", (request) => {
      if (request.url().includes("/chunks/workflow-panel-")) workflowRequests.push(request.url());
      if (request.url().includes("/chunks/map-help-")) helpRequests.push(request.url());
    });
    const gallery = await loadGallery(page, { scenario: "home-unpinned" });
    const help = helpButton(gallery);
    await expect(help).toBeVisible();
    await help.click();
    const dialog = helpDialog(gallery);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("dt")).toHaveCount(3);
    const bounds = await dialog.boundingBox();
    expect(bounds?.width).toBeGreaterThan(0);
    expect(bounds?.height).toBeGreaterThan(0);
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(help).toBeFocused();
    expect(helpRequests).toHaveLength(1);
    expect(workflowRequests).toHaveLength(0);
  });

  test("the rail shows ? whenever a map shows and nothing is locating", async ({ page }) => {
    for (const scenario of ["ready", "rooms", "draw", "history", "area-review-new"]) {
      const gallery = await loadGallery(page, { scenario });
      await expect(helpButton(gallery), scenario).toBeVisible();
    }
    for (const scenario of ["transition", "empty", "access"]) {
      const gallery = await loadGallery(page, { scenario });
      await expect(helpButton(gallery), scenario).toHaveCount(0);
    }

    const retained = await loadGallery(page, { scenario: "ready" });
    const state = await snapshot(page);
    await patchState(retained, {
      coherence: "verifying",
      map: { ...state.map, exactPose: false },
    });
    const canvas = canvasOf(retained);
    await expect(canvas.locator(".scene-window")).toBeVisible();
    await expect(canvas.locator(".map-message")).toHaveCount(0);
    await expect(retained.locator(".status-copy strong")).toHaveText("Locating");
    await expect(canvas.getByRole("button", { name: "Fit the whole map on screen" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Room names" })).toBeVisible();
    await expect(helpButton(retained)).toBeVisible();
  });

  test("a fine pointer reads Trackpad, Mouse and Keyboard rows for the one gesture model", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await patchState(gallery, { view: "three" });
    const help = helpButton(gallery);
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await help.click();
    const dialog = helpDialog(gallery);
    await expect(dialog).toHaveAttribute("aria-modal", "false");
    await expect(help).toHaveAttribute("aria-expanded", "true");
    await expect(help).toHaveAttribute("aria-controls", "navigation-help");
    expect(await canvasOf(gallery).evaluate((canvas) => Boolean(canvas.shadowRoot.getElementById("navigation-help")))).toBe(true);
    expect(await rows(dialog)).toEqual({
      Trackpad: "Scroll to move the map · pinch to zoom · twist to rotate",
      Mouse: "Drag to move the map · right-drag or Shift-drag to rotate · wheel to zoom",
      Keyboard: "WASD to move · Q/E or arrows to orbit · +/− to zoom · 0 to fit",
    });
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(help).toBeFocused();
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await help.click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(help).toBeFocused();
  });

  test("a coarse pointer reads one Touch row and a 44 px Close @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    await helpButton(gallery).click();
    const dialog = helpDialog(gallery);
    expect(await rows(dialog)).toEqual({ Touch: "Drag to move the map · pinch to zoom · twist two fingers to rotate" });
    const close = dialog.getByRole("button", { name: "Close" });
    await expect(close).toBeFocused();
    const box = await close.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(helpButton(gallery)).toBeFocused();
  });

  test("Draw swaps in the drawing rows and the keyboard recipe leaves the panel", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    await expect(panelOf(gallery).getByText(/arrow keys to aim/)).toHaveCount(0);
    await helpButton(gallery).click();
    const dialog = helpDialog(gallery);
    const paint = await rows(dialog);
    expect(Object.keys(paint)).toEqual(["Trackpad", "Mouse", "Keyboard"]);
    expect(paint.Mouse).toBe("Drag to paint · right-drag or Space-drag to move · wheel to zoom");
    expect(paint.Keyboard).toBe("Focus the map, use arrow keys to aim, then Enter to paint or erase at the crosshair. D selects Paint; E selects Erase.");
    await patchState(gallery, { draw: { ...(await snapshot(page)).draw, tool: "outline" } });
    await expect(dialog.locator("dd").last()).toContainText("press Enter to place points");
  });

  test("Draw on a phone reads the touch drawing row @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", narrow: true });
    await helpButton(gallery).click();
    expect(await rows(helpDialog(gallery))).toEqual({ Touch: "Drag to paint · two fingers to move or zoom" });
  });

  test("Escape closes Map options, then help, then the workflow (shell.md §5)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "rooms" });
    await helpButton(gallery).click();
    await expect(helpDialog(gallery)).toBeVisible();
    await optionsButton(gallery).click();
    await expect(optionsMenu(gallery)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(optionsMenu(gallery)).toHaveCount(0);
    await expect(helpDialog(gallery)).toBeVisible();
    await expect(optionsButton(gallery)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(helpDialog(gallery)).toHaveCount(0);
    await expect(helpButton(gallery)).toBeFocused();
    expect((await snapshot(page)).workflow).toBe("rooms");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("none");
  });

  test("a plain drag moves the map and Shift-, right- or middle-drag rotates in 3D (D1)", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    const bounds = await gallery.locator(".map-root").boundingBox();
    const from = { x: bounds.x + bounds.width * 0.45, y: bounds.y + bounds.height * 0.48 };
    const to = { x: from.x + 90, y: from.y + 45 };
    const three = async () => (await snapshot(page)).cameras.three;
    const moved = (a, b) => Math.hypot(b.targetX - a.targetX, b.targetZ - a.targetZ);

    await drag(page, from, to);
    await expect.poll(async () => Boolean(await three())).toBe(true);
    const afterPan = await three();
    expect(afterPan.yaw).toBeCloseTo(-Math.PI / 4, 3);
    expect(afterPan.pitch).toBeCloseTo(0.82, 3);

    await page.keyboard.down("Shift");
    await drag(page, from, to);
    await page.keyboard.up("Shift");
    const afterShift = await three();
    expect(afterShift.yaw).not.toBeCloseTo(afterPan.yaw, 3);
    expect(moved(afterPan, afterShift)).toBeLessThan(0.001);

    await drag(page, from, to, { button: "right" });
    const afterRight = await three();
    expect(afterRight.yaw).not.toBeCloseTo(afterShift.yaw, 3);

    await drag(page, from, to, { button: "middle" });
    const afterMiddle = await three();
    expect(afterMiddle.yaw).not.toBeCloseTo(afterRight.yaw, 3);

    await drag(page, from, to);
    expect(moved(afterMiddle, await three())).toBeGreaterThan(0.01);

    await gallery.getByRole("button", { name: "2D", exact: true }).click();
    await drag(page, from, to, { button: "right" });
    await expect.poll(async () => Boolean((await snapshot(page)).cameras.top)).toBe(true);
    const top = (await snapshot(page)).cameras.top;
    await drag(page, from, to, { button: "right" });
    expect(moved(top, (await snapshot(page)).cameras.top)).toBeGreaterThan(0.01);
  });
});


const fullMapToggle = (gallery) => gallery.getByRole("button", { name: "Full map", exact: true });
const hudOf = (gallery) => gallery.getByRole("region", { name: "Robot status and action" });
const exitButton = (gallery) => hudOf(gallery).getByRole("button", { name: "Exit full map", exact: true });

// A browser full screen double: records requests on the shell's root (which
// owns the app, its dialogs and toasts), answers fullscreenchange, and lets a
// test leave full screen from outside.
const installFullscreen = (page) => page.evaluate((tag) => {
  const shell = document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4");
  const app = shell.shadowRoot.querySelector(".root");
  let current = null;
  window.__fs = { requests: 0, exits: 0 };
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => current });
  Element.prototype.requestFullscreen = async function requestFullscreen() {
    window.__fs.requests += this === app ? 1 : 0;
    current = this;
    document.dispatchEvent(new Event("fullscreenchange"));
  };
  document.exitFullscreen = async () => {
    window.__fs.exits += 1;
    current = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  };
  window.__fs.leave = () => { current = null; document.dispatchEvent(new Event("fullscreenchange")); };
}, GALLERY_TAG);

test.describe("Full map (map-surfaces.md §5 Full map, §11 MS-FULL-01…04)", () => {
  for (const narrow of [false, true]) {
    test(`the toggle is pressed in Full map and the HUD holds the status, the primary and Exit${narrow ? " @mobile" : ""}`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "ready", narrow, viewport: narrow ? null : { width: 1024, height: 768 } });
      const toggle = fullMapToggle(gallery);
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(toggle).not.toHaveAttribute("aria-expanded", /.*/);
      await expect(gallery.getByRole("button", { name: /cleaning panel/ })).toHaveCount(0);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(panelOf(gallery)).toBeHidden();
      const hud = hudOf(gallery);
      await expect(hud).toContainText("Docked");
      await expect(exitButton(gallery)).toBeVisible();
      await expect(toggle).toBeFocused();
      await exitButton(gallery).click();
      await expect.poll(async () => (await snapshot(page)).fullMap).toBe(false);
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(toggle).toBeFocused();
      await expect(panelOf(gallery)).toBeVisible();
    });
  }

  test("every exit lands on the toggle and closes precision and help", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", viewport: { width: 1024, height: 768 } });
    // Browser full screen is stubbed: a real one would turn Escape into
    // its own exit (the D3 trade-off), which the @safety test covers.
    await installFullscreen(page);
    const toggle = fullMapToggle(gallery);
    await toggle.click();
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await helpButton(gallery).click();
    await expect(helpDialog(gallery)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(helpDialog(gallery)).toHaveCount(0);
    expect((await snapshot(page)).fullMap).toBe(true);
    await helpButton(gallery).click();
    await expect(helpDialog(gallery)).toBeVisible();
    await patchState(gallery, { precisionOpen: true });
    await exitButton(gallery).click();
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(false);
    expect((await snapshot(page)).precisionOpen).toBe(false);
    await expect(helpDialog(gallery)).toHaveCount(0);
    await expect(toggle).toBeFocused();
    expect((await snapshot(page)).workflow).toBe("draw");

    await toggle.click();
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await toggle.press("Escape");
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(false);
    await expect(toggle).toBeFocused();
  });

  test("a working robot keeps Stop in the HUD and cold-start Locating keeps Stop and Exit with its canvas explanation", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "cleaning", viewport: { width: 1024, height: 768 } });
    await fullMapToggle(gallery).click();
    const hud = hudOf(gallery);
    await expect(hud.getByRole("button")).toHaveText([/Stop/, "Exit full map"]);
    await expect(hud.getByRole("button", { name: "Stop cleaning" })).toHaveClass(/ms-btn--danger/);

    const locating = await loadGallery(page, { scenario: "full-map-locating", viewport: { width: 1024, height: 768 } });
    await expect(hudOf(locating).getByRole("button")).toHaveText(["Exit full map"]);
    await expect(locating.locator(".map-message")).toContainText("Locating");
  });

  test("entering asks the browser for full screen, leaving releases it, and an outside exit leaves Full map @safety", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", viewport: { width: 1024, height: 768 } });
    await installFullscreen(page);
    const toggle = fullMapToggle(gallery);
    await toggle.click();
    await expect.poll(() => page.evaluate(() => window.__fs.requests)).toBe(1);
    expect((await snapshot(page)).fullMap).toBe(true);
    await exitButton(gallery).click();
    await expect.poll(() => page.evaluate(() => window.__fs.exits)).toBe(1);
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(false);

    await toggle.click();
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await page.evaluate(() => window.__fs.leave());
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(false);
    await expect(toggle).toBeFocused();
    expect(await page.evaluate(() => window.__fs.exits)).toBe(1);

    await optionsButton(gallery).click();
    await expect(optionsMenu(gallery).getByRole("menuitem")).toHaveText(["Map diagnostics"]);
  });

  test("the HUD is content-sized at the bottom inline-end on wide and the Draw dock sits above it", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", viewport: { width: 1024, height: 768 } });
    await fullMapToggle(gallery).click();
    const hud = hudOf(gallery);
    const canvas = await canvasOf(gallery).boundingBox();
    let box = await hud.boundingBox();
    expect(canvas.x + canvas.width - (box.x + box.width)).toBeLessThanOrEqual(12.5);
    expect(canvas.y + canvas.height - (box.y + box.height)).toBeLessThanOrEqual(12.5);
    expect(box.width).toBeLessThan(24 * 16);

    const draw = await loadGallery(page, { scenario: "draw", viewport: { width: 1024, height: 768 } });
    await fullMapToggle(draw).click();
    await expect(hudOf(draw)).toBeVisible();
    const dock = await draw.getByRole("toolbar", { name: "Draw area tools" }).boundingBox();
    box = await hudOf(draw).boundingBox();
    expect(dock.y + dock.height).toBeLessThanOrEqual(box.y);
    const help = await helpButton(draw).boundingBox();
    expect(help.y + help.height).toBeLessThanOrEqual(box.y);
  });

  test("the HUD spans the phone's width minus the gutters and its Exit is 44 px @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "full-map", narrow: true });
    const hud = hudOf(gallery);
    const box = await hud.boundingBox();
    expect(box.width).toBeCloseTo(390 - 24, 0);
    const exit = await exitButton(gallery).boundingBox();
    expect(exit.height).toBeGreaterThanOrEqual(44);
    expect(exit.width).toBeGreaterThanOrEqual(44);
  });

  test("a fitted map stays fitted across the toggle and a moved one keeps its target (framed bounds)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", viewport: { width: 1024, height: 768 } });
    await gallery.getByRole("button", { name: "3D", exact: true }).click();
    const fit = gallery.getByRole("button", { name: "Fit the whole map on screen" });
    await fit.click();
    const three = async () => (await snapshot(page)).cameras.three;
    const renderer = () => canvasOf(gallery).evaluate((canvas) => canvas.rendererDiagnostics());
    await expect.poll(async () => (await renderer()).fitActive).toBe(true);
    const fitted = await renderer();
    expect(fitted.cameraDistance).toBeCloseTo(fitted.fitDistance, 6);
    const width = (await canvasOf(gallery).boundingBox()).width;
    await fullMapToggle(gallery).click();
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    // The wider canvas keeps the framed map: the camera sits at its fit distance.
    await expect.poll(async () => (await canvasOf(gallery).boundingBox()).width).toBeGreaterThan(width);
    await page.waitForTimeout(100);
    const refitted = await renderer();
    expect(refitted.fitActive).toBe(true);
    expect(refitted.cameraDistance).toBeCloseTo(refitted.fitDistance, 6);
    await exitButton(gallery).click();
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(false);

    const bounds = await gallery.locator(".map-root").boundingBox();
    const from = { x: bounds.x + bounds.width * 0.45, y: bounds.y + bounds.height * 0.48 };
    await drag(page, from, { x: from.x + 80, y: from.y + 30 });
    await expect.poll(async () => (await renderer()).fitActive).toBe(false);
    const moved = await three();
    const movedDistance = (await renderer()).cameraDistance;
    await fullMapToggle(gallery).click();
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(true);
    await page.waitForTimeout(100);
    const after = await three();
    expect(after.targetX).toBeCloseTo(moved.targetX, 4);
    expect(after.targetZ).toBeCloseTo(moved.targetZ, 4);
    expect(after.yaw).toBeCloseTo(moved.yaw, 4);
    expect((await renderer()).cameraDistance).toBeCloseTo(movedDistance, 6);
  });
});

// ---- Draw (map-surfaces.md §3-§8 Draw, §11 MS-DRAW-01…07, MS-RESP-02) ------
const DRAW_TOOLS = ["Points", "Paint", "Erase", "Move map", "Undo", "Redo", "Clear", "Brush width, 60 cm. Opens brush settings."];
const toolbarOf = (scope) => scope.getByRole("toolbar", { name: "Draw area tools" });
const labelWidth = (button) => button.locator(".ms-btn__label").evaluate((label) => label.getBoundingClientRect().width);
const describedBy = (control) => control.evaluate((element) => {
  const id = element.getAttribute("aria-describedby");
  return id ? element.getRootNode().getElementById(id)?.textContent.trim() ?? null : null;
});

test.describe("Draw tools", () => {
  for (const width of [390, 360, 320]) {
    test(`the sheet holds the eight tools in two rows at ${width}px, labelled from 360 @mobile`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "draw", viewport: { width, height: 844 } });
      const toolbar = toolbarOf(gallery.locator(".sheet-tools"));
      const tools = toolbar.locator("button");
      await expect(tools).toHaveCount(8);
      for (const [index, name] of DRAW_TOOLS.entries()) {
        const tool = tools.nth(index);
        await expect(tool).toHaveAccessibleName(name);
        const box = await tool.boundingBox();
        expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
        if (width >= 360) expect(await labelWidth(tool), `${name} label shows`).toBeGreaterThan(8);
        else expect(await labelWidth(tool), `${name} label is assistive`).toBeLessThanOrEqual(1);
      }
      const rowsY = new Set((await Promise.all((await tools.all()).map(async (tool) => Math.round((await tool.boundingBox()).y)))));
      expect(rowsY.size, "two rows").toBe(2);
      await expect(tools.nth(7)).toHaveText("Brush · 60 cm");
      const brush = await tools.nth(7).boundingBox();
      expect(brush.height, "Brush never wraps").toBeLessThan(60);
      expect(await page.evaluate((limit) => document.documentElement.scrollWidth <= limit, width)).toBe(true);
      const sheet = await gallery.locator(".mobile-sheet").boundingBox();
      const bar = await toolbar.boundingBox();
      expect(bar.x + bar.width).toBeLessThanOrEqual(sheet.x + sheet.width + 0.5);
      await tools.nth(0).click();
      await expect(tools).toHaveCount(7);
    });
  }

  test("a landscape phone gets one icon-only row that scrolls sideways when the sheet is narrower @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", viewport: { width: 844, height: 390 } });
    // Fill the viewport, as the HA panel does: the stage's 36rem floor would
    // make the host taller than the phone, and so a wide layout.
    await gallery.locator(".stage").evaluate((stage) => {
      Object.assign(stage.style, { blockSize: "100dvh", minBlockSize: "0", maxInlineSize: "none" });
    });
    const toolbar = toolbarOf(gallery.locator(".sheet-tools"));
    const tools = toolbar.locator("button");
    await expect(tools).toHaveCount(8);
    const boxes = await Promise.all((await tools.all()).map((tool) => tool.boundingBox()));
    expect(new Set(boxes.map((box) => Math.round(box.y))).size, "one row").toBe(1);
    for (const [index, box] of boxes.entries()) {
      expect(box.width, `${DRAW_TOOLS[index]} width`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${DRAW_TOOLS[index]} icon-only`).toBeLessThanOrEqual(48);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await labelWidth(tools.nth(index))).toBeLessThanOrEqual(1);
    }
    expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 320, height: 256 });
    await expect.poll(() => toolbar.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await toolbar.evaluate((element) => getComputedStyle(element).overflowX)).toMatch(/auto|scroll/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
    await expect(tools.nth(7)).toHaveAccessibleName(DRAW_TOOLS[7]);
  });

  test("the desktop dock holds the eight labelled tools and Clear leaves the action bar", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", viewport: { width: 1024, height: 768 } });
    const toolbar = toolbarOf(canvasOf(gallery));
    const tools = toolbar.locator("button");
    await expect(tools).toHaveCount(8);
    for (const [index, name] of DRAW_TOOLS.entries()) await expect(tools.nth(index)).toHaveAccessibleName(name);
    await expect(gallery.locator(".action-bar").getByRole("button", { name: "Clear" })).toHaveCount(0);
    const clear = toolbar.getByRole("button", { name: "Clear", exact: true });
    const before = (await snapshot(page)).draw.circles.length;
    expect(before).toBeGreaterThan(0);
    await expect(clear).toBeEnabled();
    await clear.click();
    await expect.poll(async () => (await snapshot(page)).draw.circles.length).toBe(0);
    await expect(clear).toBeDisabled();
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).draw.circles.length).toBe(before);
    await expect(clear).toBeEnabled();
  });

  test("the brush reads in centimetres through Intl in the host locale", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const brush = toolbarOf(canvasOf(gallery)).locator(".draw-brush");
    await expect(brush).toHaveText("Brush · 60 cm");
    await expect(brush).toHaveAccessibleName("Brush width, 60 cm. Opens brush settings.");
    const state = await snapshot(page);
    await patchState(gallery, { draw: { ...state.draw, brushMeters: 1.5 }, locale: "de" });
    const expected = await page.evaluate(() => new Intl.NumberFormat("de", { style: "unit", unit: "centimeter", unitDisplay: "short" }).format(150));
    await expect(brush).toHaveText(`Brush · ${expected}`);
    await expect(brush).toHaveAccessibleName(`Brush width, ${expected}. Opens brush settings.`);
  });

  test("Undo and Redo mirror under RTL; Points does not", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    const toolbar = toolbarOf(canvasOf(gallery));
    const scaleOf = (name) => toolbar.getByRole("button", { name, exact: true }).locator(".ms-icon").evaluate((icon) => getComputedStyle(icon).scale);
    expect(await scaleOf("Undo")).toBe("-1 1");
    expect(await scaleOf("Redo")).toBe("-1 1");
    expect(await scaleOf("Points")).toBe("none");
    await page.evaluate(() => { document.documentElement.dir = "ltr"; });
    expect(await scaleOf("Undo")).toBe("none");
  });

  test("the panel shows one pointer hint per tool and no keyboard paragraph", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const panel = panelOf(gallery);
    const hint = panel.locator(".draw-hint");
    await expect(hint).toHaveText("Drag to paint · right-drag or Space-drag to move the map");
    await gallery.getByRole("button", { name: "Erase", exact: true }).click();
    await expect(hint).toHaveText("Drag to paint · right-drag or Space-drag to move the map");
    await gallery.getByRole("button", { name: "Points", exact: true }).click();
    await expect(hint).toHaveText("Click to add points · right-drag to move the map");
    await gallery.getByRole("button", { name: "Move map", exact: true }).click();
    await expect(hint).toHaveCount(0);
    await expect(panel.getByText(/Keyboard/)).toHaveCount(0);
    await expect(panel.getByText(/mapped floor|narrow edges/)).toHaveCount(0);
  });

  test("a touch screen reads the touch hints above the tool rows, at peek @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", narrow: true });
    await expect(panelOf(gallery)).toHaveAttribute("data-detent", "peek");
    const hint = gallery.locator(".mobile-sheet .draw-hint");
    await expect(hint).toHaveCount(1);
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText("Drag to paint · two fingers to move the map");
    await gallery.getByRole("button", { name: "Points", exact: true }).click();
    await expect(hint).toHaveText("Tap to add points · two fingers to move the map");
    await gallery.getByRole("button", { name: "Expand panel", exact: true }).click();
    await expect(hint).toHaveCount(1);
    await gallery.getByRole("button", { name: "Move map", exact: true }).click();
    await expect(hint).toHaveCount(0);
  });
});

test.describe("Draw bar and Custom areas", () => {
  test("Draw pairs Cancel with Name and save; a redraw reads Done and returns to Redraw", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const bar = gallery.locator(".action-bar");
    await expect(bar).toHaveClass(/paired/);
    await expect(bar.getByRole("button")).toHaveText(["Cancel", "Name and save"]);
    await gallery.evaluate((element) => element.setScenario("area-review-rebind"));
    const redraw = gallery.getByRole("button", { name: "Redraw", exact: true });
    await redraw.click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
    await expect(bar.getByRole("button")).toHaveText(["Cancel", "Done"]);
    const done = bar.getByRole("button", { name: "Done", exact: true });
    await expect(done).toBeEnabled();
    await done.click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("areaReview");
    await expect(redraw).toBeFocused();
  });

  // UX9: a new area starts from Your areas' New area, and Cancel returns there.
  test("Cancel from a dirty fresh Draw asks, then lands on the New area that opened it", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready" });
    await gallery.getByRole("button", { name: /^Clean custom area/ }).click();
    const card = gallery.getByRole("button", { name: "New area", exact: true });
    await card.click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
    const state = await snapshot(page);
    await patchState(gallery, { draw: { ...state.draw, dirty: true, strokeCount: 1, circles: [{ x: 1, z: 1, radius: 0.3 }] } });
    const cancel = gallery.locator(".action-bar").getByRole("button", { name: "Cancel", exact: true });
    await cancel.click();
    const dialog = gallery.getByRole("dialog", { name: "Discard changes?" });
    await expect(dialog).toHaveAccessibleDescription("This new area hasn't been saved, and discarding it can't be undone.");
    await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(cancel).toBeFocused();
    expect((await snapshot(page)).workflow).toBe("draw");
    await cancel.click();
    await dialog.getByRole("button", { name: "Discard", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("areas");
    await expect(card).toBeFocused();
  });

  test("Cancel from a redraw asks, then restores the saved outline in the review", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-rebind" });
    const saved = (await snapshot(page)).resources.areas.value.areas[0].circles;
    await gallery.getByRole("button", { name: "Redraw", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
    const state = await snapshot(page);
    await patchState(gallery, { draw: { ...state.draw, circles: [], dirty: true, strokeCount: 1 } });
    await gallery.locator(".action-bar").getByRole("button", { name: "Cancel", exact: true }).click();
    const dialog = gallery.getByRole("dialog", { name: "Discard changes?" });
    await expect(dialog).toHaveAccessibleDescription("Your changes to \"Entryway\" haven't been saved, and discarding them can't be undone.");
    await dialog.getByRole("button", { name: "Discard", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("areaReview");
    const after = await snapshot(page);
    expect(after.draw.circles).toEqual(saved);
    expect(after.areaDraft).toMatchObject({ id: "entryway", name: "Entryway", dirty: false });
    // The heading's Back takes the same road.
    await gallery.getByRole("button", { name: "Redraw", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
    const back = gallery.getByRole("button", { name: "Back to Entryway", exact: true });
    await expect(back).toHaveText("Entryway");
    await back.click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("areaReview");
  });

  for (const narrow of [false, true]) {
    test(`held Draw controls say why while a command runs${narrow ? " @mobile" : ""}`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "draw", narrow });
      if (narrow) await gallery.getByRole("button", { name: "Expand panel", exact: true }).click();
      const toolbar = toolbarOf(narrow ? gallery.locator(".sheet-tools") : canvasOf(gallery));
      const panel = narrow ? gallery.locator(".mobile-sheet") : panelOf(gallery);
      const before = (await snapshot(page)).draw;
      await patchState(gallery, { command: "pending" });
      for (const name of ["Undo", "Redo", "Clear"]) {
        const tool = toolbar.getByRole("button", { name, exact: true });
        await expect(tool).toHaveAttribute("aria-disabled", "true");
        expect(await describedBy(tool), name).toBe("Waiting for the current change to finish.");
      }
      await toolbar.getByRole("button", { name: "Clear", exact: true }).click({ force: true });
      expect((await snapshot(page)).draw).toEqual(before);
      for (const name of ["Points", "Paint", "Erase", "Move map"]) {
        const tool = toolbar.getByRole("button", { name, exact: true });
        await expect(tool).toBeEnabled();
        await expect(tool).not.toHaveAttribute("aria-disabled", "true");
      }
      // UX9: Draw no longer lists saved areas or New area (Your areas does).
      await expect(panel.getByRole("button", { name: "New area", exact: true })).toHaveCount(0);
      await patchState(gallery, { command: "starting" });
      expect(await describedBy(toolbar.getByRole("button", { name: "Undo", exact: true }))).toBe("Waiting for the robot to begin.");
      await patchState(gallery, { command: "settling" });
      expect(await describedBy(toolbar.getByRole("button", { name: "Undo", exact: true }))).toBe("Waiting for the robot to stop.");
      await patchState(gallery, { command: "idle" });
      await expect(toolbar.getByRole("button", { name: "Undo", exact: true })).not.toHaveAttribute("aria-disabled", "true");
      await expect(panel.locator("fieldset")).toHaveCount(0);
    });
  }

  // UX9 owner ruling: saved areas live in Your areas; Draw only draws.
  test("Draw lists no saved areas: no Custom areas section and no area rows", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw" });
    const panel = panelOf(gallery);
    await expect(panel.getByRole("heading", { level: 3, name: "Custom areas" })).toHaveCount(0);
    await expect(panel.getByRole("group", { name: "Custom areas" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /^Entryway/ })).toHaveCount(0);
    await expect(panel.locator(".draw-hint")).toBeVisible();
  });
});

// ---- Precision (map-surfaces.md §5 Precision; design-system.md §4 .ms-stepper, .ms-range) ----
const brushOf = (scope) => scope.getByRole("button", { name: /^Brush width, / });
const precisionOf = (scope) => scope.getByRole("group", { name: "Drawing precision" });
const brushField = (scope) => scope.getByRole("spinbutton", { name: "Brush width in centimeters" });

test.describe("Precision", () => {
  test("the Brush button docks the settings in the Draw body below the hint, and Escape returns to it", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", viewport: { width: 1024, height: 768 } });
    const brush = brushOf(canvasOf(gallery));
    await expect(brush).toHaveAttribute("aria-expanded", "false");
    await expect(precisionOf(gallery)).toHaveCount(0);
    await brush.click();
    await expect(brush).toHaveAttribute("aria-expanded", "true");
    const panel = panelOf(gallery);
    const group = precisionOf(panel);
    await expect(group).toBeVisible();
    await expect(precisionOf(canvasOf(gallery))).toHaveCount(0);
    const groupBox = await group.boundingBox();
    const hint = panel.locator(".draw-hint");
    expect((await hint.boundingBox()).y).toBeLessThan(groupBox.y);
    await expect(group).toContainText("Strokes follow the map's resolution. Zooming changes the view, not the area.");
    // Docked settings are a section, not a layer: the app bar keeps its menu.
    await expect(gallery.getByRole("button", { name: "Open Home Assistant sidebar", exact: true })).toBeVisible();
    await brushField(group).press("Escape");
    await expect.poll(async () => (await snapshot(page)).precisionOpen).toBe(false);
    await expect(group).toHaveCount(0);
    await expect(brush).toBeFocused();
    await expect(brush).toHaveAttribute("aria-expanded", "false");
  });

  test("on a phone the settings sit above the tool row while the sheet stays at peek @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", narrow: true });
    const sheet = gallery.locator(".mobile-sheet");
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    const toolbar = toolbarOf(gallery.locator(".sheet-tools"));
    const brush = brushOf(toolbar);
    await brush.click();
    const group = precisionOf(gallery.locator(".sheet-tools"));
    await expect(group).toBeVisible();
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    const groupBox = await group.boundingBox();
    const toolbarBox = await toolbar.boundingBox();
    expect(groupBox.y + groupBox.height).toBeLessThanOrEqual(toolbarBox.y + 1);
    const slider = group.getByRole("slider");
    const sliderBox = await slider.boundingBox();
    expect(sliderBox.x + sliderBox.width).toBeLessThanOrEqual(groupBox.x + groupBox.width + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
    await brush.click();
    await expect(group).toHaveCount(0);
    await expect(brush).toBeFocused();
  });

  test("the stepper works in centimetres: 5 cm steps, snapped ends with reasons, a 44 px range", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", viewport: { width: 1024, height: 768 } });
    await brushOf(canvasOf(gallery)).click();
    const group = precisionOf(panelOf(gallery));
    const field = brushField(group);
    const minus = group.getByRole("button", { name: "Decrease Brush width", exact: true });
    const plus = group.getByRole("button", { name: "Increase Brush width", exact: true });
    await expect(field).toHaveValue("60");
    await expect(field).toHaveAttribute("inputmode", "numeric");
    await expect(field).toHaveAttribute("min", "20");
    await expect(field).toHaveAttribute("max", "250");
    await expect(plus).toHaveAttribute("aria-controls", await field.getAttribute("id"));
    await plus.click();
    await expect(field).toHaveValue("65");
    await expect.poll(async () => (await snapshot(page)).draw.brushMeters).toBeCloseTo(0.65, 6);
    await expect(brushOf(canvasOf(gallery))).toHaveText("Brush · 65 cm");
    await minus.click();
    await expect(field).toHaveValue("60");
    // A brush off the 5 cm grid steps to the next multiple.
    const state = await snapshot(page);
    await patchState(gallery, { draw: { ...state.draw, brushMeters: 0.63 } });
    await expect(field).toHaveValue("63");
    await plus.click();
    await expect(field).toHaveValue("65");
    await patchState(gallery, { draw: { ...state.draw, brushMeters: 0.63 } });
    await minus.click();
    await expect(field).toHaveValue("60");
    await patchState(gallery, { draw: { ...state.draw, brushMeters: 2.5 } });
    await expect(plus).toHaveAttribute("aria-disabled", "true");
    expect(await describedBy(plus)).toBe("Can't make the brush wider than 250 cm.");
    await expect(minus).not.toHaveAttribute("aria-disabled", "true");
    await plus.click({ force: true });
    expect((await snapshot(page)).draw.brushMeters).toBe(2.5);
    await patchState(gallery, { draw: { ...state.draw, brushMeters: 0.2 } });
    await expect(minus).toHaveAttribute("aria-disabled", "true");
    expect(await describedBy(minus)).toBe("Can't make the brush narrower than 20 cm.");
    await expect(plus).not.toHaveAttribute("aria-disabled", "true");
    await field.fill("7");
    await field.press("Tab");
    await expect(field).toHaveValue("20");
    await field.fill("300");
    await field.press("Enter");
    await expect(field).toHaveValue("250");
    await expect.poll(async () => (await snapshot(page)).draw.brushMeters).toBe(2.5);
    await field.fill("42");
    await field.press("Tab");
    await expect(field).toHaveValue("42");
    await expect.poll(async () => (await snapshot(page)).draw.brushMeters).toBeCloseTo(0.42, 6);
    const slider = group.getByRole("slider", { name: "Brush width slider" });
    await expect(slider).toHaveAttribute("aria-valuetext", "42 cm");
    await expect(slider).toHaveClass(/ms-range/);
    const sliderBox = await slider.boundingBox();
    expect(sliderBox.height).toBeGreaterThanOrEqual(44);
    expect(await slider.evaluate((element) => getComputedStyle(element).marginInline)).toBe("0px");
    const groupBox = await group.boundingBox();
    expect(sliderBox.x + sliderBox.width).toBeLessThanOrEqual(groupBox.x + groupBox.width + 0.5);
    expect(await slider.evaluate((element) => [element.min, element.max, element.step])).toEqual(["20", "250", "1"]);
  });
});

// ---- Area review (map-surfaces.md §4 Area review, §5 Area review, §11 MS-AREA-01…04) ----
const overlayAlpha = (gallery, x, y) => canvasOf(gallery).locator(".overlay-canvas").evaluate((canvas, point) => {
  const ratio = canvas.width / canvas.getBoundingClientRect().width;
  return canvas.getContext("2d").getImageData(Math.round(point.x * ratio), Math.round(point.y * ratio), 1, 1).data[3];
}, { x, y });

test.describe("Area review", () => {
  test("a new area is titled Name this area with Redraw paired to a reasoned Save area and no Delete", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-new" });
    const panel = panelOf(gallery);
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Name this area");
    await expect(panel).toContainText("Name the area and choose cleaning settings.");
    await expect(panel.getByRole("textbox", { name: "Area name" })).toBeVisible();
    await expect(panel.getByRole("combobox", { name: "Cleaning mode" })).toBeVisible();
    await expect(panel.getByRole("combobox", { name: "Vacuum coverage" })).toBeVisible();
    const bar = gallery.locator(".action-bar");
    await expect(bar).toHaveClass(/paired/);
    await expect(bar.getByRole("button")).toHaveText(["Redraw", "Save area"]);
    const save = bar.getByRole("button", { name: "Save area", exact: true });
    await expect(save).toHaveAttribute("aria-disabled", "true");
    await expect(save).toHaveAccessibleDescription("Can't save until you name the area.");
    await expect(panel.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    // Redraw lives in the bar, not the body, while the bar is Stop-free.
    await expect(panel.locator(".workflow-body").getByRole("button", { name: "Redraw", exact: true })).toHaveCount(0);
  });

  test("a saved area is titled by its name, cleans from the bar and deletes from the last body row", async ({ page }) => {
    // UX9: a saved area opens from its row in Your areas.
    const gallery = await loadGallery(page, { scenario: "areas-list" });
    const panel = panelOf(gallery);
    await panel.getByRole("button", { name: /^Entryway/ }).click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("areaReview");
    const heading = panel.getByRole("heading", { level: 2 });
    await expect(heading).toHaveText("Entryway");
    await expect(heading.locator("bdi")).toHaveText("Entryway");
    await expect(panel.getByText("Name the area and choose cleaning settings.")).toHaveCount(0);
    const bar = gallery.locator(".action-bar");
    await expect(bar.getByRole("button")).toHaveText(["Redraw", "Clean this area"]);
    const remove = panel.getByRole("button", { name: "Delete", exact: true });
    await expect(remove).toHaveClass(/ms-row--danger/);
    expect(await panel.locator(".workflow-body .stack > :last-child").evaluate((last) => last.textContent.trim())).toBe("Delete");
    await remove.click();
    const dialog = gallery.getByRole("dialog", { name: "Delete area?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button")).toHaveText(["Cancel", "Delete"]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(remove).toBeFocused();
  });

  test("a changed map titles the review Check {name} with the warning first and Save area ready", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-rebind" });
    const panel = panelOf(gallery);
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Check Entryway");
    const body = panel.locator(".workflow-body .stack");
    await expect(body.locator("> :first-child")).toHaveText("The map changed since you saved this area, so save it again or redraw it.");
    await expect(body.locator("> :first-child")).toHaveAttribute("data-tone", "warning");
    const save = gallery.locator(".action-bar").getByRole("button", { name: "Save area", exact: true });
    await expect(save).toBeEnabled();
    const state = await snapshot(page);
    await patchState(gallery, { areaDraft: { ...state.areaDraft, status: "stale", canRebind: false } });
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Entryway");
    await expect(body.locator("> :first-child")).toHaveText("Home Assistant can't use this area as it was saved, so redraw it.");
    await expect(body.locator("> :first-child")).toHaveRole("alert");
    await expect(gallery.locator(".action-bar").getByRole("button", { name: "Clean this area", exact: true })).toHaveAccessibleDescription("Can't clean this area until you redraw it.");
  });

  test("entering the review frames the area in the top view and dims the rest; leaving restores the camera", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", viewport: { width: 1024, height: 768 } });
    await page.waitForTimeout(150);
    const bounds = await gallery.locator(".map-root").boundingBox();
    const corner = { x: 4, y: 4 };
    expect(await overlayAlpha(gallery, corner.x, corner.y), "no scrim in Draw").toBe(0);
    const top = async () => (await snapshot(page)).cameras.top ?? { targetX: 0, targetZ: 0, zoom: 1 };
    const before = await top();
    // Use the drawn circles' centre in map metres and the scene's origin.
    const expected = await page.evaluate((tag) => {
      const state = document.querySelector(tag).getWorkspaceSnapshot();
      const { span, metersPerCell: m, origin } = state.resources.scene.value.metadata;
      const circles = state.draw.circles;
      const xs = circles.flatMap((c) => [c.x - c.radius, c.x + c.radius]);
      const ys = circles.flatMap((c) => [c.y - c.radius, c.y + c.radius]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      return { targetX: -cx + m * (origin[0] + (span[0] - 1) / 2), targetZ: cy - m * (origin[1] + (span[1] - 1) / 2) };
    }, GALLERY_TAG);
    await gallery.locator(".action-bar").getByRole("button", { name: "Name and save", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("areaReview");
    await page.waitForTimeout(150);
    const framed = await top();
    expect(framed.targetX).toBeCloseTo(expected.targetX, 1);
    expect(framed.targetZ).toBeCloseTo(expected.targetZ, 1);
    expect(framed.zoom).toBeGreaterThan(before.zoom + 0.5);
    expect(await overlayAlpha(gallery, corner.x, corner.y), "scrim outside the area").toBeGreaterThan(60);
    // The area itself is cut out of the scrim: its centre pixel is not dimmed
    // beyond the area fill the Draw view already paints.
    const centre = await overlayAlpha(gallery, bounds.width / 2, bounds.height / 2);
    expect(centre).toBeLessThan(await overlayAlpha(gallery, corner.x, corner.y) + 1);
    await gallery.locator(".action-bar").getByRole("button", { name: "Redraw", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
    await page.waitForTimeout(150);
    const restored = await top();
    expect(restored.targetX).toBeCloseTo(before.targetX, 4);
    expect(restored.targetZ).toBeCloseTo(before.targetZ, 4);
    expect(restored.zoom).toBeCloseTo(before.zoom, 4);
    expect(await overlayAlpha(gallery, corner.x, corner.y), "scrim gone").toBe(0);
    expect((await snapshot(page)).areaDraft.id).toBeNull();
    expect((await snapshot(page)).draw.circles.length).toBeGreaterThan(0);
  });

  test("reduced motion lands on the same framed camera", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const gallery = await loadGallery(page, { scenario: "draw", viewport: { width: 1024, height: 768 } });
    await page.waitForTimeout(150);
    await gallery.locator(".action-bar").getByRole("button", { name: "Name and save", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).cameras.top?.zoom ?? 1).toBeGreaterThan(1.5);
    await expect.poll(() => overlayAlpha(gallery, 4, 4)).toBeGreaterThan(60);
  });

  test("Redraw from a saved review keeps the outline and Done comes back to Redraw", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-rebind" });
    const circles = (await snapshot(page)).draw.circles;
    const redraw = gallery.locator(".action-bar").getByRole("button", { name: "Redraw", exact: true });
    await redraw.click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
    expect((await snapshot(page)).draw.circles).toEqual(circles);
    expect((await snapshot(page)).areaDraft.id).toBe("entryway");
    await gallery.locator(".action-bar").getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).workflow).toBe("areaReview");
    await expect(redraw).toBeFocused();
  });

  for (const narrow of [false, true]) {
    test(`held review controls say why while a command runs${narrow ? " @mobile" : ""}`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "area-review-rebind", narrow });
      const panel = narrow ? gallery.locator(".mobile-sheet") : panelOf(gallery);
      const name = panel.getByRole("textbox", { name: "Area name" });
      const mode = panel.getByRole("combobox", { name: "Cleaning mode" });
      const remove = panel.getByRole("button", { name: "Delete", exact: true });
      const redraw = gallery.locator(".action-bar").getByRole("button", { name: "Redraw", exact: true });
      await expect(name).toBeEditable();
      await patchState(gallery, { command: "pending" });
      for (const [control, label] of [[name, "name"], [mode, "mode"], [remove, "Delete"], [redraw, "Redraw"]]) {
        await expect(control, label).toHaveAttribute("aria-disabled", "true");
        await expect(control, label).toHaveAccessibleDescription("Waiting for the current change to finish.");
      }
      await expect(name).toHaveAttribute("readonly", "");
      await remove.click({ force: true });
      await expect(gallery.getByRole("dialog")).toHaveCount(0);
      expect((await snapshot(page)).dialog).toBeNull();
      await redraw.click({ force: true });
      expect((await snapshot(page)).workflow).toBe("areaReview");
      await expect(panel.locator("fieldset")).toHaveCount(0);
      await patchState(gallery, { command: "starting" });
      await expect(remove).toHaveAccessibleDescription("Waiting for the robot to begin.");
      await patchState(gallery, { command: "idle" });
      await expect(remove).not.toHaveAttribute("aria-disabled", "true");
      await expect(name).not.toHaveAttribute("readonly", "");
    });
  }

  test("while Stop holds the bar, Redraw is a body button", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-rebind", narrow: true });
    await patchState(gallery, { activity: "cleaning" });
    const bar = gallery.locator(".action-bar");
    await expect(bar.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Redraw", exact: true })).toHaveCount(0);
    await expect(bar).not.toHaveClass(/paired/);
    await expect(gallery.locator(".mobile-sheet .sheet-body").getByRole("button", { name: "Redraw", exact: true })).toBeVisible();
  });
});

// ---- History (map-surfaces.md §4 History, §5 History, §11 MS-HIST-01…05, MS-RESP-09) ----
// The shell formats dates as formatDateTime does: medium date, short time, in
// the host's language and zone (the gallery leaves both to the browser).
const formatted = (page, iso, dates = null) => page.evaluate(({ iso, dates }) =>
  new Intl.DateTimeFormat(dates?.language, { dateStyle: "medium", timeStyle: "short", timeZone: dates?.timeZone }).format(new Date(iso)), { iso, dates });
const SAVED_ONE = "2026-08-28T11:30:00Z";
const chipOf = (gallery) => canvasOf(gallery).locator(".map-chip");
const floorSnapshots = async (page, floorId) => (await snapshot(page)).resources.history.value.floors.find((floor) => floor.id === floorId).snapshots;

test.describe("History", () => {
  test("the strip and the chip date the saved map and give its position; the map loses its colour", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history", viewport: { width: 1024, height: 768 } });
    const date = await formatted(page, SAVED_ONE);
    const strip = gallery.locator(".status-strip");
    await expect(strip.locator("strong")).toHaveText("Saved map");
    await expect(strip.locator("small")).toHaveText(`${date} · 1 of 1`);
    const chip = chipOf(gallery);
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Saved map");
    await expect(chip).toContainText(`${date} · 1 of 1`);
    expect(await chip.evaluate((element) => [element.getAttribute("role"), element.getAttribute("aria-live")])).toEqual([null, null]);
    await expect(chip.locator(".sr-only")).toHaveText(`Saved map, read only, ${date}, 1 of 1`);
    const root = await canvasOf(gallery).locator(".map-root").boundingBox();
    const box = await chip.boundingBox();
    expect(Math.abs(box.x + box.width / 2 - (root.x + root.width / 2)), "top centre").toBeLessThan(2);
    expect(box.y - root.y).toBeLessThan(root.height / 4);
    expect(await canvasOf(gallery).locator(".scene-canvas").evaluate((canvas) => getComputedStyle(canvas).filter)).toContain("saturate");
    await expect(gallery.getByText("Read only", { exact: true })).toHaveCount(0);
    await gallery.getByRole("button", { name: "Full map", exact: true }).click();
    await expect(gallery.getByRole("button", { name: "Exit full map", exact: true })).toBeVisible();
    await expect(chip).toBeVisible();
  });

  test("the grip line reads the saved map's date and position too @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history", narrow: true });
    const date = await formatted(page, SAVED_ONE);
    await expect(gallery.locator(".sheet-status")).toHaveText(`Saved map · ${date} · 1 of 1`);
    await expect(chipOf(gallery)).toBeVisible();
  });

  test("forced colors border the chip", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    const gallery = await loadGallery(page, { scenario: "history" });
    const probe = await page.evaluate(() => {
      const element = document.createElement("span");
      element.style.color = "CanvasText";
      document.body.append(element);
      return getComputedStyle(element).color;
    });
    const chip = chipOf(gallery);
    expect(await chip.evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe("solid");
    expect(await chip.evaluate((element) => getComputedStyle(element).borderTopColor)).toBe(probe);
  });

  test("the body says it once, lists floors with Live or Saved map trails and offers no row back", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history-floors" });
    const panel = panelOf(gallery);
    await expect(panel.getByText(/never show where the robot is now/)).toHaveCount(1);
    await expect(panel.getByText(/Return to current floor/)).toHaveCount(0);
    await expect(panel.getByText("Current", { exact: true })).toHaveCount(0);
    await expect(panel.getByText("Read only", { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("heading", { level: 3, name: "Mapped floors" })).toBeVisible();
    const floors = panel.getByRole("group", { name: "Mapped floors" });
    const live = floors.getByRole("button", { name: "Current floor Live", exact: true });
    const saved = floors.getByRole("button", { name: "Saved floor 1 Saved map", exact: true });
    await expect(live).toHaveAttribute("aria-current", "false");
    await expect(saved).toHaveAttribute("aria-current", "true");
    await live.click();
    await expect.poll(async () => (await snapshot(page)).selection.floorId).toBe("current");
    await expect(live).toHaveAttribute("aria-current", "true");
    // Two snapshots on the live floor: rows, no scrubber.
    await expect(panel.getByRole("slider")).toHaveCount(0);
    await expect(panel.locator(".snapshot")).toHaveCount(2);
    // One floor: no group at all.
    const state = await snapshot(page);
    const catalog = state.resources.history.value;
    await patchState(gallery, { resources: { ...state.resources, history: { ...state.resources.history, value: { ...catalog, floors: catalog.floors.filter((floor) => floor.id === "current") } } } });
    await expect(panel.getByRole("group", { name: "Mapped floors" })).toHaveCount(0);
  });

  test("the scrubber appears from three snapshots, ends at Oldest and Newest on a saved floor and fits a 320 px sheet @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history-floors", narrow: true, viewport: { width: 320, height: 844 } });
    const panel = gallery.locator(".mobile-sheet");
    const snapshots = await floorSnapshots(page, "saved-1");
    expect(snapshots).toHaveLength(4);
    const slider = panel.getByRole("slider", { name: "Map timeline" });
    await expect(slider).toHaveAttribute("min", "0");
    await expect(slider).toHaveAttribute("max", "3");
    await expect(slider).toHaveClass(/ms-range/);
    await expect(panel.locator(".timeline-ends span")).toHaveText(["Oldest", "Newest"]);
    const [width, container] = await slider.evaluate((input) => [input.getBoundingClientRect().width, input.parentElement.getBoundingClientRect().width]);
    expect(width).toBeLessThanOrEqual(container + 0.5);
    expect(await panel.locator(".sheet-body").evaluate((body) => body.scrollWidth <= body.clientWidth), "no sideways scroll").toBe(true);
    await expect(slider).toHaveAttribute("aria-valuetext", await formatted(page, snapshots[1].createdAt));
    await expect(slider).toHaveValue("1");
    const preview = (value) => slider.evaluate((input, next) => { input.value = next; input.dispatchEvent(new Event("input", { bubbles: true })); }, value);
    await preview("3");
    await expect(slider).toHaveAttribute("aria-valuetext", await formatted(page, snapshots[3].createdAt));
    await preview("0");
    await expect(slider).toHaveAttribute("aria-valuetext", await formatted(page, snapshots[0].createdAt));
    const rows = panel.locator(".snapshot");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(rows.nth(0)).toHaveAttribute("aria-current", "false");
    await expect(rows.nth(1).locator("span").first()).toHaveText(await formatted(page, snapshots[1].createdAt));
    await expect(rows.nth(1).locator("small")).toHaveText("2 of 4");
    await rows.nth(3).click();
    await expect.poll(async () => (await snapshot(page)).selection.historyId).toBe(snapshots[3].id);
    // A saved floor has no live map, so its scrubber ends at its newest map
    // and never changes floor under the thumb; Show live map is the way back.
    await slider.evaluate((input) => { input.value = "3"; input.dispatchEvent(new Event("change", { bubbles: true })); });
    await expect.poll(async () => (await snapshot(page)).selection.historyId).toBe(snapshots[3].id);
    expect((await snapshot(page)).selection.floorId).toBe("saved-1");
    expect((await snapshot(page)).workflow).toBe("history");
    await expect(chipOf(gallery)).toBeVisible();
  });

  test("Show live map is the one way back; Stop is its secondary while the robot works; a saved floor while live shows only the reason", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history" });
    const bar = gallery.locator(".action-bar");
    const strip = gallery.locator(".status-strip");
    await expect(bar.getByRole("button")).toHaveText(["Show live map"]);
    await patchState(gallery, { activity: "cleaning" });
    // Wide: Stop keeps its strip place (shell.md §3) and the bar keeps the primary.
    await expect(bar.getByRole("button")).toHaveText(["Show live map"]);
    await expect(strip.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: /^Start|^Clean|^Run/ })).toHaveCount(0);
    // The last saved map while the live one is unavailable: no button, one
    // reason, first in the body (the selectors leave history without a branch).
    const panel = panelOf(gallery);
    await patchState(gallery, { activity: "docked", dataMode: "live" });
    await expect(bar).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /Live map required|Show live map/ })).toHaveCount(0);
    await expect(panel.locator(".workflow-body .stack > :first-child")).toHaveText("Can't edit until you show the live map.");
    await patchState(gallery, { dataMode: "live", activity: "cleaning" });
    await expect(strip.getByRole("button", { name: "Stop cleaning" })).toBeVisible();
    await expect(panel.locator(".workflow-body .stack > :first-child")).toHaveText("Can't edit until you show the live map.");
    // Show live map returns to the live current floor and stays in History.
    await patchState(gallery, { dataMode: "history", activity: "docked" });
    await bar.getByRole("button", { name: "Show live map", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).dataMode).toBe("live");
    const after = await snapshot(page);
    expect(after.workflow).toBe("history");
    expect(after.selection.floorId).toBe("current");
    expect(after.floor.readOnly).toBe(false);
    await expect(chipOf(gallery)).toHaveCount(0);
    await expect(panelOf(gallery).getByRole("button", { name: "House Live", exact: true })).toHaveAttribute("aria-current", "true");
    await expect(gallery.locator(".status-strip strong")).not.toHaveText("Saved map");
  });

  test("on a phone the bar holds Show live map with Stop as its secondary @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history", narrow: true });
    const bar = gallery.locator(".action-bar");
    await patchState(gallery, { activity: "cleaning" });
    await expect(bar.getByRole("button")).toHaveText(["Show live map", "Stop"]);
    await expect(bar.getByRole("button", { name: "Stop cleaning" })).toHaveClass(/ms-btn--secondary/);
    await patchState(gallery, { activity: "cleaning", dataMode: "live" });
    await expect(bar.getByRole("button")).toHaveText(["Stop"]);
  });

  for (const narrow of [false, true]) {
    test(`held floor rows, saved-map rows and scrubber say why while a command runs${narrow ? " @mobile" : ""}`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario: "history-floors", narrow });
      const panel = narrow ? gallery.locator(".mobile-sheet") : panelOf(gallery);
      const before = await snapshot(page);
      await patchState(gallery, { command: "pending" });
      const live = panel.getByRole("button", { name: "Current floor Live", exact: true });
      const row = panel.locator(".snapshot").nth(0);
      const slider = panel.getByRole("slider", { name: "Map timeline" });
      for (const [control, label] of [[live, "floor row"], [row, "saved-map row"], [slider, "scrubber"]]) {
        await expect(control, label).toHaveAttribute("aria-disabled", "true");
        await expect(control, label).toHaveAccessibleDescription("Waiting for the current change to finish.");
      }
      await expect(panel.locator("fieldset")).toHaveCount(0);
      await live.click({ force: true });
      await row.click({ force: true });
      await slider.evaluate((input) => { input.value = "0"; input.dispatchEvent(new Event("change", { bubbles: true })); });
      const after = await snapshot(page);
      expect(after.selection).toEqual(before.selection);
      await expect(slider).toHaveValue("1");
      await patchState(gallery, { command: "starting" });
      await expect(slider).toHaveAccessibleDescription("Waiting for the robot to begin.");
      await patchState(gallery, { command: "idle" });
      await expect(slider).not.toHaveAttribute("aria-disabled", "true");
      await expect(live).not.toHaveAttribute("aria-disabled", "true");
    });
  }

  test("a German host dates the strip, chip and rows alike", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history", viewport: { width: 1024, height: 768 } });
    const dates = { language: "de", timeZone: "Europe/Berlin" };
    await gallery.evaluate((element, applied) => { element.dates = applied; }, dates);
    const date = await formatted(page, SAVED_ONE, dates);
    expect(date).not.toBe(await formatted(page, SAVED_ONE));
    await expect(gallery.locator(".status-strip small")).toHaveText(`${date} · 1 of 1`);
    await expect(chipOf(gallery)).toContainText(`${date} · 1 of 1`);
    await expect(chipOf(gallery).locator(".sr-only")).toHaveText(`Saved map, read only, ${date}, 1 of 1`);
    await expect(panelOf(gallery).locator(".snapshot span").first()).toHaveText(date);
  });
});

// design-system.md §8, map-surfaces.md §9: the open surfaces and the themed
// Draw and History states carry no serious or critical axe finding.
const axeFindings = (results) => results.map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.flat().join(" >> ")).join(" | ")}`);
const expectNoSeriousFinding = async (page, { forced = false } = {}) => {
  // Linux WebKit's emulated forced colours fail axe's contrast rule (UX3
  // R34), so under forced colors that rule is replaced by the style checks.
  const builder = new AxeBuilder({ page });
  const { violations, incomplete } = await (forced ? builder.disableRules(["color-contrast"]) : builder).analyze();
  expect(axeFindings(violations.filter(({ impact }) => impact === "serious" || impact === "critical"))).toEqual([]);
  expect(axeFindings(incomplete.filter(({ id }) => id === "aria-prohibited-attr"))).toEqual([]);
};

test.describe("Accessibility", () => {
  test("Draw with help open at 390 has no serious axe finding @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", narrow: true });
    await helpButton(gallery).click();
    await expect(helpDialog(gallery)).toBeVisible();
    await expectNoSeriousFinding(page);
  });

  test("Draw with precision docked at 1024 has no serious axe finding", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", viewport: { width: 1024, height: 768 } });
    await patchState(gallery, { precisionOpen: true });
    await expect(precisionOf(panelOf(gallery))).toBeVisible();
    await expectNoSeriousFinding(page);
  });

  test("Full map with the HUD at 390 has no serious axe finding @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "full-map-cleaning", narrow: true });
    await expect(hudOf(gallery).getByRole("button", { name: "Stop cleaning" })).toBeVisible();
    await expectNoSeriousFinding(page);
  });

  for (const [label, setup] of [
    ["dark", (page) => page.emulateMedia({ colorScheme: "dark" })],
    // The parsed <html> replaces the one an init script would set dir on, so
    // the direction is set once the page is up.
    ["RTL", (page) => page.evaluate(() => { document.documentElement.dir = "rtl"; })],
    ["forced colors", (page) => page.emulateMedia({ forcedColors: "active" })],
  ]) {
    const rtl = label === "RTL";
    const load = async (page, scenario) => {
      if (!rtl) await setup(page);
      const gallery = await loadGallery(page, { scenario, narrow: true });
      if (rtl) await setup(page);
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).direction)).toBe(rtl ? "rtl" : "ltr");
      return gallery;
    };

    test(`Draw at 390 in ${label} has no serious axe finding and keeps Undo first in reading order @mobile`, async ({ page }) => {
      const gallery = await load(page, "draw");
      const undo = gallery.getByRole("button", { name: "Undo", exact: true });
      const redo = gallery.getByRole("button", { name: "Redo", exact: true });
      await expect(undo).toBeVisible();
      await expectNoSeriousFinding(page, { forced: label === "forced colors" });
      // Undo precedes Redo along the reading direction and its arrow turns
      // with it (MS-DRAW-06).
      const [undoBox, redoBox] = [await undo.boundingBox(), await redo.boundingBox()];
      if (rtl) expect(undoBox.x).toBeGreaterThan(redoBox.x);
      else expect(undoBox.x).toBeLessThan(redoBox.x);
      expect(await undo.locator(".ms-icon").evaluate((icon) => getComputedStyle(icon).scale)).toBe(rtl ? "-1 1" : "none");
    });

    test(`History at 390 in ${label} has no serious axe finding and keeps the chip${label === "forced colors" ? " bordered" : ""} @mobile`, async ({ page }) => {
      const gallery = await load(page, "history-floors");
      const chip = chipOf(gallery);
      await expect(chip).toBeVisible();
      await expectNoSeriousFinding(page, { forced: label === "forced colors" });
      if (label === "forced colors") expect(await chip.evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe("solid");
    });
  }
});

// R26: the sheet detent and the status title are announced once each through
// the shell's polite region, in the host's language; the chip and HUD are
// plain content with no live role of their own.
test.describe("Announcements", () => {
  const GERMAN = { v4_workspace_height_half: "Bedienfeld, halbe Höhe", v4_workspace_height_full: "Bedienfeld, volle Höhe", v4_cleaning: "Reinigt" };
  const speakGerman = (gallery) => gallery.evaluate((element, templates) => {
    const prefix = "component.matic_robot.common.";
    window.__announced = [];
    const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
    shell.localize = (key) => templates[key.slice(prefix.length)] ?? key;
    const region = shell.shadowRoot.querySelector('.root > .sr-only[aria-live="polite"]');
    new MutationObserver(() => { if (region.textContent.trim()) window.__announced.push(region.textContent.trim()); })
      .observe(region, { childList: true, characterData: true, subtree: true });
  }, GERMAN);
  const announced = (page) => page.evaluate(() => window.__announced);

  test("a detent change and a status change are each announced once, translated @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    await expect(gallery.locator(".mobile-sheet")).toHaveAttribute("data-detent", "half");
    await speakGerman(gallery);
    await gallery.getByRole("button", { name: "Expand panel" }).click();
    await expect(gallery.locator(".mobile-sheet")).toHaveAttribute("data-detent", "full");
    await expect.poll(() => announced(page)).toEqual(["Bedienfeld, volle Höhe"]);
    await patchState(gallery, { activity: "cleaning" });
    await expect.poll(() => announced(page)).toEqual(["Bedienfeld, volle Höhe", "Reinigt"]);
    await patchState(gallery, { activity: "cleaning", batteryPercent: 60 });
    await page.waitForTimeout(200);
    expect(await announced(page)).toEqual(["Bedienfeld, volle Höhe", "Reinigt"]);
  });

  test("the chip and the HUD carry no live role", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history", viewport: { width: 1024, height: 768 } });
    const chip = chipOf(gallery);
    await expect(chip).toBeVisible();
    expect(await chip.evaluate((element) => [element.getAttribute("role"), element.getAttribute("aria-live"), element.closest("[aria-live], [role=status], [role=alert]")])).toEqual([null, null, null]);
    const full = await loadGallery(page, { scenario: "full-map-cleaning", viewport: { width: 1024, height: 768 } });
    const hud = hudOf(full);
    await expect(hud).toBeVisible();
    expect(await hud.evaluate((element) => [element.getAttribute("aria-live"), element.querySelector("[aria-live], [role=status], [role=alert]")])).toEqual([null, null]);
  });
});

// Final whole-branch review (Task 8): what two reviewers found a first-time
// user could misread, each pinned here.
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const dispatchIntent = (page, detail) => page.evaluate(({ tag, detail }) => {
  const shell = document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4");
  shell.dispatchEvent(new CustomEvent("matic-workspace-intent", { detail, bubbles: true, composed: true }));
}, { tag: GALLERY_TAG, detail });

test.describe("Final review", () => {
  test("entering Full map closes the brush settings, so Brush never says expanded over nothing", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", viewport: { width: 1024, height: 768 } });
    await brushOf(canvasOf(gallery)).click();
    await expect(brushOf(canvasOf(gallery))).toHaveAttribute("aria-expanded", "true");
    await fullMapToggle(gallery).click();
    await expect.poll(async () => (await snapshot(page)).precisionOpen).toBe(false);
    await expect(brushOf(canvasOf(gallery))).toHaveAttribute("aria-expanded", "false");
    // The first Escape now leaves Full map, not an invisible layer.
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await snapshot(page)).fullMap).toBe(false);
  });

  test("the HUD holds the primary and Exit, with Stop as its only secondary (spec §4)", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-saved", viewport: { width: 1024, height: 768 } });
    await fullMapToggle(gallery).click();
    const hud = hudOf(gallery);
    await expect(hud.getByRole("button")).toHaveText(["Clean this area", "Exit full map"]);
    await patchState(gallery, { activity: "cleaning" });
    await expect(hud.getByRole("button")).toHaveText([/Stop/, "Exit full map"]);
    await patchState(gallery, { activity: "paused" });
    await expect(hud.getByRole("button")).toHaveText([/^Resume/, /Stop/, "Exit full map"]);
  });

  test("the area review hides the 3D/2D and map style switches it cannot honour", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-saved", viewport: { width: 1024, height: 768 } });
    await expect(helpButton(gallery)).toBeVisible();
    await expect(gallery.getByRole("group", { name: "Map view" })).toHaveCount(0);
    await expect(gallery.getByRole("group", { name: "Map style" })).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "3D", exact: true })).toHaveCount(0);
  });

  test("Points keeps one hint, in the panel, and its handles never cover the rail's ? on a phone @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw-points", narrow: true });
    await expect(canvasOf(gallery).locator(".zone-guidance")).toHaveCount(0);
    await expect(canvasOf(gallery).getByText("Place points around the area")).toHaveCount(0);
    await expect(gallery.locator(".mobile-sheet").getByText("Tap to add points · two fingers to move the map")).toBeVisible();
    const help = helpButton(gallery);
    await help.click();
    await expect(helpDialog(gallery)).toBeVisible();
    await page.keyboard.press("Escape");
    // Select a point: its action bar sits above the rail's bottom row.
    const state = await snapshot(page);
    await patchState(gallery, { draw: { ...state.draw, outline: { closed: true, points: [{ x: 1, y: 1 }, { x: 3.5, y: 1 }, { x: 3.5, y: 2.5 }, { x: 1, y: 2.5 }] } } });
    await canvasOf(gallery).getByRole("button", { name: "Point 1", exact: true }).tap();
    const actions = canvasOf(gallery).locator(".zone-point-actions");
    await expect(actions).toBeVisible();
    expect(intersects(await actions.boundingBox(), await help.boundingBox())).toBe(false);
  });

  test("a toast in Full map sits above the Draw dock and the dock stays centred under RTL", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", viewport: { width: 1024, height: 768 } });
    await fullMapToggle(gallery).click();
    const dock = gallery.getByRole("toolbar", { name: "Draw area tools" });
    await dispatchIntent(page, { type: "set-notice", notice: { key: "v4_notice_area_saved", fallback: "Area saved", tone: "success" } });
    const toast = gallery.getByRole("region", { name: "Notifications" });
    await expect(toast).toBeVisible();
    expect(intersects(await toast.boundingBox(), await dock.boundingBox()), "toast over the dock").toBe(false);
    expect(intersects(await toast.boundingBox(), await hudOf(gallery).boundingBox()), "toast over the HUD").toBe(false);
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    const canvas = await canvasOf(gallery).boundingBox();
    const box = await dock.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(canvas.x);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(Math.abs(box.x + box.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThanOrEqual(2);
  });

  test("the saved-map chip keeps its own row: centred under RTL and clear of the map style switch", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history", viewport: { width: 1024, height: 768 } });
    const chip = chipOf(gallery);
    const style = gallery.getByRole("group", { name: "Map style" });
    await expect(style).toBeVisible();
    expect(intersects(await chip.boundingBox(), await style.boundingBox())).toBe(false);
    const fit = gallery.getByRole("button", { name: "Fit the whole map on screen", exact: true });
    expect(intersects(await chip.boundingBox(), await fit.boundingBox())).toBe(false);
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    const canvas = await canvasOf(gallery).boundingBox();
    const box = await chip.boundingBox();
    expect(Math.abs(box.x + box.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThanOrEqual(2);
    const narrow = await loadGallery(page, { scenario: "history", narrow: true, viewport: { width: 320, height: 844 } });
    const floor = narrow.getByRole("combobox").first();
    expect(intersects(await chipOf(narrow).boundingBox(), await floor.boundingBox())).toBe(false);
  });

  test("a saved floor's scrubber ends at Newest and keeps its floor; the live floor's ends at Live and keeps focus", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "history-floors", viewport: { width: 1024, height: 768 } });
    const panel = panelOf(gallery);
    const slider = panel.getByRole("slider", { name: "Map timeline" });
    const saved = await floorSnapshots(page, "saved-1");
    await expect(slider).toHaveAttribute("max", "3");
    await expect(panel.locator(".timeline-ends span")).toHaveText(["Oldest", "Newest"]);
    await slider.focus();
    await slider.evaluate((input) => { input.value = "3"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await expect(slider).toHaveAttribute("aria-valuetext", await formatted(page, saved[3].createdAt));
    await slider.evaluate((input) => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await expect.poll(async () => (await snapshot(page)).selection.historyId).toBe(saved[3].id);
    expect((await snapshot(page)).selection.floorId).toBe("saved-1");
    await expect(slider).toBeFocused();
    // The live floor with three saved maps: the end is Live, and Live keeps the scrubber under the thumb.
    const state = await snapshot(page);
    const catalog = state.resources.history.value;
    const current = catalog.floors.find((floor) => floor.id === "current");
    const extra = { ...current.snapshots[0], id: "current-extra", createdAt: "2026-08-20T08:00:00Z" };
    await patchState(gallery, {
      dataMode: "live",
      floor: { ...state.floor, readOnly: false },
      selection: { ...state.selection, floorId: "current", historyId: null },
      resources: { ...state.resources, history: { ...state.resources.history, value: { ...catalog, floors: catalog.floors.map((floor) => floor.id === "current" ? { ...floor, snapshots: [extra, ...floor.snapshots] } : floor) } } },
    });
    await expect(slider).toHaveAttribute("max", "3");
    await expect(panel.locator(".timeline-ends span")).toHaveText(["Oldest", "Live"]);
    await expect(slider).toHaveValue("3");
    await expect(slider).toHaveAttribute("aria-valuetext", "Live");
    await slider.focus();
    await slider.evaluate((input) => { input.value = "0"; input.dispatchEvent(new Event("change", { bubbles: true })); });
    await expect.poll(async () => (await snapshot(page)).selection.historyId).toBe("current-extra");
    await expect(slider).toBeFocused();
    await slider.evaluate((input) => { input.value = "3"; input.dispatchEvent(new Event("change", { bubbles: true })); });
    await expect.poll(async () => (await snapshot(page)).selection.historyId).toBeNull();
    expect((await snapshot(page)).workflow).toBe("history");
    await expect(slider).toBeFocused();
  });

  test("the dock fits its canvas: icon-only with tooltips beside the 1024 inspector, labelled and whole in Full map", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "draw", viewport: { width: 1024, height: 768 } });
    const toolbar = gallery.getByRole("toolbar", { name: "Draw area tools" });
    const buttons = toolbar.getByRole("button");
    await expect(buttons).toHaveCount(8);
    const inside = async () => {
      const canvas = await canvasOf(gallery).boundingBox();
      const box = await toolbar.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(canvas.x);
      expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
      expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    };
    const labelWidth = () => buttons.last().locator(".ms-btn__label").evaluate((label) => label.getBoundingClientRect().width);
    // The 664 px inspector canvas cannot hold eight labelled 44 px tools (≈766 px): labels drop first.
    await inside();
    expect(await labelWidth()).toBeLessThanOrEqual(1);
    for (const button of await buttons.all()) {
      const box = await button.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(await button.getAttribute("title")).toBeTruthy();
    }
    await expect(toolbar.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("title", "Undo");
    await expect(toolbar.getByRole("button", { name: /^Brush width, / })).toHaveAccessibleDescription("");
    await fullMapToggle(gallery).click();
    await expect(hudOf(gallery)).toBeVisible();
    await inside();
    await expect.poll(labelWidth).toBeGreaterThan(40);
    for (const button of await buttons.all()) {
      expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth), await button.textContent()).toBe(true);
    }
  });

  test("a toast in Full map on a phone stays clear of the rail's ? @mobile", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "ready", narrow: true });
    await fullMapToggle(gallery).click();
    await expect(hudOf(gallery)).toBeVisible();
    await dispatchIntent(page, { type: "set-notice", notice: { key: "v4_notice_area_saved", fallback: "Area saved", tone: "success" } });
    const toast = gallery.getByRole("region", { name: "Notifications" });
    await expect(toast).toBeVisible();
    const box = await toast.boundingBox();
    expect(intersects(box, await helpButton(gallery).boundingBox())).toBe(false);
    expect(intersects(box, await hudOf(gallery).boundingBox())).toBe(false);
    expect(box.y + box.height).toBeLessThanOrEqual((await hudOf(gallery).boundingBox()).y);
  });

  test("Clean this area says why it waits and why a redrawn area is needed", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-saved" });
    const clean = gallery.locator(".action-bar").getByRole("button", { name: "Clean this area", exact: true });
    await expect(clean).toBeEnabled();
    const state = await snapshot(page);
    await patchState(gallery, { command: "pending" });
    await expect(clean).toHaveAttribute("aria-disabled", "true");
    await expect(clean).toHaveAccessibleDescription("Waiting for the current change to finish.");
    await patchState(gallery, { command: "idle", areaDraft: { ...state.areaDraft, status: "stale", canRebind: false } });
    await expect(clean).toHaveAccessibleDescription("Can't clean this area until you redraw it.");
  });
});

// Codex review of 6d97a6fc: what the first review missed.
test.describe("Codex review", () => {
  test("help rows follow the view the map shows: top-down rows in 2D, Draw and the area review, rotate rows in 3D", async ({ page }) => {
    const top = {
      Trackpad: "Scroll to move the map · pinch to zoom · twist to rotate",
      Mouse: "Drag to move the map · wheel to zoom",
      Keyboard: "WASD or arrows to move · +/− to zoom · 0 to fit",
    };
    const gallery = await loadGallery(page, { scenario: "ready" });
    await helpButton(gallery).click();
    expect(await rows(helpDialog(gallery)), "2D").toEqual(top);
    await patchState(gallery, { view: "three" });
    await expect(helpDialog(gallery).locator("dd").nth(1)).toHaveText("Drag to move the map · right-drag or Shift-drag to rotate · wheel to zoom");
    const review = await loadGallery(page, { scenario: "area-review-saved" });
    await patchState(review, { view: "three" });
    await helpButton(review).click();
    expect(await rows(helpDialog(review)), "area review from 3D").toEqual(top);
  });

  test("Alt-wheel tilts only a 3D map; in the forced top view it zooms like a wheel", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-saved", viewport: { width: 1024, height: 768 } });
    await patchState(gallery, { view: "three" });
    const bounds = await gallery.locator(".map-root").boundingBox();
    await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.4);
    await page.mouse.wheel(0, 1);
    await expect.poll(async () => Boolean((await snapshot(page)).cameras.top)).toBe(true);
    const before = (await snapshot(page)).cameras.top;
    await page.keyboard.down("Alt");
    await page.mouse.wheel(0, 200);
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await snapshot(page)).cameras.top.zoom, "zoomed, not panned").not.toBeCloseTo(before.zoom, 3);
  });

  test("Room colors apply to the top view Draw and the area review show, whatever the saved view", async ({ page }) => {
    const gallery = await loadGallery(page, { scenario: "area-review-saved", viewport: { width: 1024, height: 768 } });
    const map = canvasOf(gallery);
    const points = () => map.evaluate((element) => element.rendererDiagnostics()?.renderedPoints ?? -1);
    await patchState(gallery, { view: "three", appearance: "photo" });
    await expect.poll(points).toBeGreaterThan(0);
    await patchState(gallery, { appearance: "rooms" });
    await expect.poll(points, "room colours replace the photo").toBe(0);
    const phone = await loadGallery(page, { scenario: "draw", narrow: true });
    await patchState(phone, { view: "three" });
    await optionsButton(phone).click();
    await expect(optionsMenu(phone).getByRole("menuitemradio", { name: "Room colors" })).toBeVisible();
  });
  test("in browser full screen the discard dialog and the toast show and take the pointer", async ({ page, browserName }) => {
    const gallery = await loadGallery(page, { scenario: "draw-saved", viewport: { width: 1024, height: 768 } });
    await fullMapToggle(gallery).click();
    const fullscreen = await page.waitForFunction(() => Boolean(document.fullscreenElement), null, { timeout: 5000 }).then(() => true, () => false);
    test.skip(!fullscreen, `${browserName} headless refused full screen`);
    await expect(hudOf(gallery)).toBeVisible();
    // What a user sees in the browser's full screen: the top layer is the
    // full-screen element, so anything outside it is neither painted nor hit.
    const shown = (selector) => page.evaluate(({ tag, selector }) => {
      const root = document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4").shadowRoot;
      const element = root.querySelector(selector);
      const owner = root.fullscreenElement;
      if (!element || !owner) return { inside: false, hit: false };
      const box = element.getBoundingClientRect();
      const hit = root.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { inside: owner.contains(element), hit: Boolean(hit) && element.contains(hit) };
    }, { tag: GALLERY_TAG, selector });
    await dispatchIntent(page, { type: "set-notice", notice: { key: "v4_notice_area_saved", fallback: "Area saved", tone: "success" } });
    await expect(gallery.getByRole("region", { name: "Notifications" })).toBeVisible();
    expect(await shown("[data-notice-toast] .ms-notice, [data-notice-toast] > *")).toEqual({ inside: true, hit: true });
    await patchState(gallery, { dialog: "discardDraft" });
    const dialog = gallery.getByRole("dialog", { name: "Discard changes?" });
    await expect(dialog).toBeVisible();
    expect(await shown(".dialog [data-dialog-initial-focus]")).toEqual({ inside: true, hit: true });
    await expect(dialog.locator("[data-dialog-initial-focus]")).toBeFocused();
    // The browser may take Escape to leave full screen (D3, R24), so close by the button.
    await dialog.locator("[data-dialog-initial-focus]").click();
    await expect(dialog).toHaveCount(0);
    expect((await snapshot(page)).fullMap).toBe(true);
  });

  for (const scenario of ["draw", "area-review-saved"]) {
    test(`${scenario} entered from 3D moves the map on a right-, Shift- or arrow-key move, as in 2D`, async ({ page }) => {
      const gallery = await loadGallery(page, { scenario, viewport: { width: 1024, height: 768 } });
      await patchState(gallery, { view: "three" });
      expect((await snapshot(page)).view).toBe("three");
      const bounds = await gallery.locator(".map-root").boundingBox();
      const from = { x: bounds.x + bounds.width * 0.45, y: bounds.y + bounds.height * 0.3 };
      const to = { x: from.x + 90, y: from.y + 45 };
      const top = async () => (await snapshot(page)).cameras.top;
      const moved = (a, b) => Math.hypot(b.targetX - a.targetX, b.targetZ - a.targetZ);
      await drag(page, from, to, { button: "right" });
      await expect.poll(async () => Boolean(await top())).toBe(true);
      const first = await top();
      await drag(page, from, to, { button: "right" });
      const second = await top();
      expect(moved(first, second), "right-drag moves the map").toBeGreaterThan(0.01);
      expect(second.yaw).toBeCloseTo(first.yaw, 6);
      await page.keyboard.down("Shift");
      await drag(page, from, to);
      await page.keyboard.up("Shift");
      const third = await top();
      expect(moved(second, third), "Shift-drag moves the map").toBeGreaterThan(0.01);
      expect(third.yaw).toBeCloseTo(second.yaw, 6);
      await gallery.locator(".map-root").focus();
      await page.keyboard.press("ArrowLeft");
      await expect.poll(async () => moved(third, await top()), "an arrow key moves the map").toBeGreaterThan(0.01);
      expect((await top()).yaw).toBeCloseTo(third.yaw, 6);
    });
  }
});
