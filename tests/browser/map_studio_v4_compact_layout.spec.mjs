// The UX audit's last open P0/P1 rows, closed in UX8: the status strip after
// Stop (MS-STATUS-01, shell.md §4 row 15), details that never restate their
// title (MS-STATUS-05, rows 11-18), the compact sheet under 480 px of height
// (MS-RESP-01/02/03, design-system.md §7) and the 320 px inspector at 768 to
// 1023 px landscape (MS-RESP-04, the frozen responsive row).
import { expect, test } from "@playwright/test";

const GALLERY = "matic-map-studio-gallery-v0-4-0";

// The walkthrough stage frame fills the viewport, as the panel does in HA.
async function stage(page, steps, viewport) {
  await page.setViewportSize(viewport);
  // A hash-only change is not a navigation, so leave first: each call mounts afresh.
  await page.goto("about:blank");
  await page.goto(`/map-studio-v4-stage-frame#steps=${steps}`);
  await page.locator("html[data-stage-ready]").waitFor({ state: "attached" });
  return page.locator(GALLERY);
}

const patch = (gallery, change) => gallery.evaluate((element, applied) => {
  const state = element.getWorkspaceSnapshot();
  element.replaceWorkspaceState(typeof applied === "function" ? applied(state) : { ...state, ...applied });
}, change);

const strip = (gallery) => ({
  title: gallery.locator(".status-copy strong"),
  detail: gallery.locator(".status-copy small"),
});

async function stableSheetHeight(sheet) {
  return sheet.evaluate(async (element) => {
    let previous = null;
    let stableFrames = 0;
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let frame = 0; frame < 60; frame += 1) {
      await nextFrame();
      const height = element.getBoundingClientRect().height;
      const sizeTransition = element.getAnimations().some((animation) => {
        if (animation.playState !== "running") return false;
        if (animation.transitionProperty === "block-size" || animation.transitionProperty === "height") return true;
        return animation.effect?.getKeyframes().some((keyframe) =>
          Object.hasOwn(keyframe, "blockSize") || Object.hasOwn(keyframe, "height"),
        ) ?? false;
      });
      stableFrames = !sizeTransition && previous !== null && Math.abs(height - previous) < 0.05
        ? stableFrames + 1
        : 0;
      if (stableFrames >= 3) return height;
      previous = height;
    }
    throw new Error("Mobile sheet did not reach stable geometry within 60 animation frames");
  });
}

test.describe("status strip (MS-STATUS-01, MS-STATUS-05)", () => {
  test("Stop accepted reads Stopping at once, with Stop's reason shown on wide", async ({ page }) => {
    const gallery = await stage(page, "stopping-command", { width: 1440, height: 900 });
    await expect(strip(gallery).title).toHaveText("Stopping");
    await expect(strip(gallery).detail).toHaveText("Waiting for the robot");
    const stop = gallery.locator(".status-strip").getByRole("button", { name: "Stop cleaning", exact: true });
    await expect(stop).toHaveAttribute("aria-disabled", "true");
    await expect(gallery.locator("#status-reason")).toBeVisible();
    await expect(gallery.locator("#status-reason")).not.toHaveText("");
  });

  test("the backend's Stop fence keeps Stopping while the robot still reports cleaning", async ({ page }) => {
    const gallery = await stage(page, "cleaning", { width: 1440, height: 900 });
    await expect(strip(gallery).title).toHaveText("Cleaning");
    await gallery.evaluate((element) => {
      const state = element.getWorkspaceSnapshot();
      element.replaceWorkspaceState({
        ...state,
        resources: { ...state.resources, entry: { ...state.resources.entry, stopSettlePending: true } },
      });
    });
    await expect(strip(gallery).title).toHaveText("Stopping");
    await expect(strip(gallery).detail).toHaveText("Waiting for the robot");
  });

  test("cleaning names the room the robot reports when it is on this floor", async ({ page }) => {
    const gallery = await stage(page, "cleaning", { width: 1440, height: 900 });
    await patch(gallery, { currentArea: "the kitchen" });
    await expect(strip(gallery).detail).toHaveText("In Kitchen");
    await patch(gallery, { currentArea: "Garage" });
    await expect(strip(gallery).detail).toHaveText("92% battery");
    await patch(gallery, { currentArea: null, coherence: "unavailable" });
    await expect(strip(gallery).detail).toHaveText("Live map unavailable");
  });

  test("no status detail restates its title", async ({ page }) => {
    // Every gallery scenario, twice: the walk grows with the scenario list.
    test.setTimeout(90_000);
    const gallery = await stage(page, "ready", { width: 1440, height: 900 });
    const scenarios = await page.evaluate(async () => (await import("/map_studio_v4-review/review.js")).GALLERY_SCENARIOS);
    for (const battery of [92, null]) {
      for (const scenario of scenarios) {
        await gallery.evaluate((element, name) => element.setScenario(name), scenario);
        await patch(gallery, { batteryPercent: battery });
        const title = (await strip(gallery).title.allTextContents()).join("").trim();
        const detail = (await strip(gallery).detail.allTextContents()).join("").trim();
        if (!title) continue;
        expect(detail.toLowerCase().includes(title.toLowerCase()), `${scenario} (${battery}): ${title} · ${detail}`).toBe(false);
      }
    }
  });
});

test.describe("compact sheet at 844×390 (MS-RESP-01, -02, -03)", () => {
  const LANDSCAPE = { width: 844, height: 390 };

  test("the page never scrolls and the primary sits in the grip row on screen", async ({ page }) => {
    for (const [steps, name] of [["rooms-ready", /^Clean \d+ rooms$/u], ["plan-saved-intelligent", /^Run plan /u], ["cleaning", /^Stop cleaning$/u]]) {
      const gallery = await stage(page, steps, LANDSCAPE);
      const scroll = await page.evaluate(() => document.scrollingElement.scrollHeight);
      expect(scroll, steps).toBeLessThanOrEqual(LANDSCAPE.height);
      const action = gallery.locator(".sheet-grip").getByRole("button", { name });
      await expect(action, steps).toBeVisible();
      const box = await action.boundingBox();
      expect(box.y + box.height, steps).toBeLessThanOrEqual(LANDSCAPE.height);
      expect(box.height, steps).toBeGreaterThanOrEqual(44);
    }
  });

  test("compact sheets start at shell.md's detents and step between peek and full only", async ({ page }) => {
    for (const [steps, start] of [["rooms", "peek"], ["draw", "peek"], ["history", "peek"], ["area-review-new", "peek"], ["plans", "full"], ["plan-saved-intelligent", "full"], ["ready", "full"]]) {
      const gallery = await stage(page, steps, LANDSCAPE);
      await expect(gallery.locator(".mobile-sheet"), steps).toHaveAttribute("data-detent", start);
    }
    const gallery = await stage(page, "rooms", LANDSCAPE);
    const sheet = gallery.locator(".mobile-sheet");
    const grip = gallery.locator(".sheet-grip");
    // One toggle: it expands, then collapses at full, and keeps keyboard focus
    // as it flips. (Desktop Safari does not focus a clicked button, so drive
    // it from the keyboard.)
    await grip.getByRole("button", { name: "Expand panel", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toHaveAttribute("data-detent", "full");
    await expect(grip.getByRole("button", { name: "Expand panel", exact: true })).toBeHidden();
    await expect(grip.getByRole("button", { name: "Collapse panel", exact: true })).toBeFocused();
    await expect(grip.getByRole("button", { name: "Collapse panel", exact: true })).toBeEnabled();
    await page.keyboard.press("Enter");
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    await expect(grip.getByRole("button", { name: "Collapse panel", exact: true })).toBeHidden();
    await expect(grip.getByRole("button", { name: "Expand panel", exact: true })).toBeFocused();
  });

  test("peek leaves the map most of the height: 72 px, 92 with a reason, Draw about 120 to 140", async ({ page }) => {
    for (const [steps, limit, viewport] of [["rooms-ready", 73], ["rooms", 93], ["draw", 141], ["draw", 141, { width: 320, height: 256 }]]) {
      const gallery = await stage(page, steps, viewport ?? LANDSCAPE);
      const sheet = gallery.locator(".mobile-sheet");
      if (steps === "draw") {
        await expect(gallery.getByRole("toolbar", { name: "Draw area tools", exact: true })).toBeVisible();
      }
      const height = await stableSheetHeight(sheet);
      expect(height, steps).toBeLessThanOrEqual(limit);
    }
  });

  test("at full, the map's controls never cover each other", async ({ page }) => {
    for (const [steps, viewport] of [["ready", LANDSCAPE], ["cleaning", LANDSCAPE], ["plans", { width: 320, height: 256 }]]) {
      const gallery = await stage(page, steps, viewport);
      await expect(gallery.locator(".mobile-sheet"), steps).toHaveAttribute("data-detent", "full");
      const covered = await gallery.evaluate((element) => {
        const shell = element.shadowRoot.querySelector(".map-shell, [class*='shell']")?.shadowRoot
          ?? [...element.shadowRoot.querySelectorAll("*")].find((node) => node.shadowRoot?.querySelector(".floor-switcher"))?.shadowRoot;
        const select = shell?.querySelector(".floor-switcher");
        if (!select) return "no floor select";
        const box = select.getBoundingClientRect();
        // Retargeted to the shell's tree: a control over the select reads as the canvas.
        const hit = shell.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit === select ? null : hit?.className || hit?.tagName || "nothing";
      });
      expect(covered, `${steps} ${JSON.stringify(viewport)}`).toBeNull();
    }
  });

  test("Full map keeps help and the 3D camera steps while the hidden sheet sits at full", async ({ page }) => {
    const gallery = await stage(page, "ready", LANDSCAPE);
    await expect(gallery.locator(".mobile-sheet")).toHaveAttribute("data-detent", "full");
    await patch(gallery, { view: "three", fullMap: true });
    const canvas = gallery.locator("matic-map-canvas-v4");
    await expect(canvas).not.toHaveAttribute("data-short", /.*/u);
    await expect(canvas.locator(".camera-steps")).toBeVisible();
    await expect(gallery.locator("[data-map-toolbar]")).toBeVisible();
    await expect(canvas.locator(".map-tools")).toBeVisible();
  });

  test("a disabled primary keeps its reason under the grip row", async ({ page }) => {
    const gallery = await stage(page, "rooms", LANDSCAPE);
    const clean = gallery.locator(".sheet-grip").getByRole("button", { name: /^Clean rooms$/u });
    await expect(clean).toHaveAttribute("aria-disabled", "true");
    const reason = gallery.locator("#primary-reason");
    await expect(reason).toBeVisible();
    const [button, line] = [await clean.boundingBox(), await reason.boundingBox()];
    expect(line.y).toBeGreaterThanOrEqual(button.y + button.height - 1);
    expect(line.y + line.height).toBeLessThanOrEqual(LANDSCAPE.height);
  });
});

// A narrow-hint change lays out from the host's size at that moment, not
// from the last ResizeObserver delivery, which can land frames later (as on
// Linux WebKit in CI). A control focused in between would otherwise move
// under the user's key press (the phone-bar Stop test).
test.describe("layout follows the host at once", () => {
  test("a narrow hint change measures the host in the same update; the measurement still wins", async ({ page }) => {
    await page.addInitScript(() => {
      const Native = window.ResizeObserver;
      window.ResizeObserver = class extends Native {
        constructor(callback) {
          super((entries, observer) => setTimeout(() => callback(entries.map((entry) => ({
            target: entry.target, contentRect: entry.target.getBoundingClientRect(),
          })), observer), 300));
        }
      };
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const gallery = page.locator(GALLERY);
    await page.evaluate(async (tag) => {
      await import("/map_studio_v4-review/review.js");
      await customElements.whenDefined(tag);
      const element = document.createElement(tag);
      Object.assign(element, { controls: false, scenario: "cleaning", narrow: false });
      document.body.style.margin = "0";
      document.body.append(element);
    }, GALLERY);
    // The hint alone, as Home Assistant sets it: the gallery's own narrow
    // attribute would also resize its stage.
    const layoutAfterHint = (narrow) => gallery.evaluate(async (element, next) => {
      element.replaceWorkspaceState({ ...element.getWorkspaceSnapshot(), narrowHint: next });
      const shell = element.shadowRoot.querySelector("matic-map-shell-v4");
      await element.updateComplete;
      await shell.updateComplete;
      return shell.shadowRoot.querySelector(".root").classList.contains("narrow") ? "narrow" : "wide";
    }, narrow);
    await expect(gallery.locator(".root.wide")).toBeAttached();
    await page.waitForTimeout(500);
    expect(await layoutAfterHint(true), "a wide host keeps the inspector whatever the hint").toBe("wide");
    await layoutAfterHint(false);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await layoutAfterHint(true), "the phone layout before the observer reports").toBe("narrow");
  });
});

test.describe("compact inspector (MS-RESP-04)", () => {
  for (const rootFont of [14, 20]) {
    test(`inspector widths keep their pixel contract at a ${rootFont}px root font`, async ({ page }) => {
      for (const [viewport, expectedWidth] of [
        [{ width: 768, height: 600 }, 320],
        [{ width: 1024, height: 768 }, 360],
      ]) {
        const gallery = await stage(page, "rooms", viewport);
        await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, rootFont);
        await expect(gallery.locator(".mobile-sheet")).toHaveCount(0);
        const width = await gallery.locator("#map-workspace").evaluate((panel) => panel.getBoundingClientRect().width);
        expect(Math.round(width), `${viewport.width}px viewport at ${rootFont}px root`).toBe(expectedWidth);
        for (const target of [".root", "#map-workspace"]) {
          const overflow = await gallery.locator(target).evaluate((element) => element.scrollWidth - element.clientWidth);
          expect(overflow, `${target} horizontal overflow at ${rootFont}px root`).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  test("768×600 gets the 320 px inspector; portrait and narrower keep the sheet", async ({ page }) => {
    let gallery = await stage(page, "rooms", { width: 768, height: 600 });
    await expect(gallery.locator(".mobile-sheet")).toHaveCount(0);
    const width = await gallery.locator("#map-workspace").evaluate((panel) => panel.getBoundingClientRect().width);
    expect(Math.round(width)).toBe(320);
    gallery = await stage(page, "rooms", { width: 1024, height: 768 });
    expect(Math.round(await gallery.locator("#map-workspace").evaluate((panel) => panel.getBoundingClientRect().width))).toBe(360);
    for (const viewport of [{ width: 768, height: 1024 }, { width: 600, height: 1024 }, { width: 390, height: 844 }]) {
      gallery = await stage(page, "rooms", viewport);
      await expect(gallery.locator(".mobile-sheet"), JSON.stringify(viewport)).toHaveCount(1);
    }
  });
});
