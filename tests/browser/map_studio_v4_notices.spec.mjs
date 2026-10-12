import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

const MAP_CHANGED = {
  tone: "info",
  key: "v4_notice_map_changed",
  fallback: "The map changed, so choose what to clean again.",
};

const PLAN_CATALOG = {
  rooms: [{ room_id: "room-a", name: "Kitchen" }],
  selected_plan: "daily",
  plans: [{
    id: "daily",
    name: "Daily clean",
    enabled: true,
    run_behavior: "intelligent",
    rooms: [{ room_id: "room-a", cleaning_mode: "vacuum", coverage_setting: "standard" }],
    room_order: ["room-a"],
    return_to_base: true,
    finish_current_room: false,
    finish_current_room_threshold: 50,
    next_run_preview: {
      preview_token: "e".repeat(64),
      rooms: [{
        room_id: "room-a", name: "Kitchen", cleaning_mode: "vacuum",
        coverage_setting: "standard", cadence_reasons: [],
      }],
      mission_boundaries: [],
      blocker: null,
    },
  }],
};

async function mountPanel(page, { localize = null, ...options } = {}) {
  const fixture = await installPanelFixture(page, options);
  await page.evaluate((translations) => {
    const panel = window.__panelFixture.createPanel();
    if (translations) {
      panel.hass = { ...panel.hass, localize: (key) => translations[key] ?? key };
    }
    window.__noticePanel = panel;
    document.body.append(panel);
  }, localize);
  const panel = page.locator(fixture.panelTag);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__noticePanel.getWorkspaceSnapshot();
    return state.resources.scene.status === "ready" && state.map.exactPose;
  })).toBe(true);
  return panel;
}

const snapshot = (page) => page.evaluate(() => {
  const state = window.__noticePanel.getWorkspaceSnapshot();
  return { command: state.command, notice: state.notice, workflow: state.workflow };
});

const sendIntent = (page, detail) => page.evaluate((intent) => {
  window.__noticePanel.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent(
    "matic-workspace-intent",
    { detail: intent, bubbles: true, composed: true },
  ));
}, detail);

const serviceCalls = (page, service) => page.evaluate((name) =>
  window.__panelFixture.serviceCalls.filter((call) => call.service === name).length, service);

test("notice text is translated at render time", async ({ page }) => {
  const panel = await mountPanel(page, {
    localize: { "component.matic_robot.common.v4_notice_map_changed": "Karte geändert" },
  });
  await sendIntent(page, { type: "set-notice", notice: MAP_CHANGED });

  expect((await snapshot(page)).notice).toEqual(MAP_CHANGED);
  await expect(panel.getByText("Karte geändert").first()).toBeAttached();
  await expect(panel.getByText(MAP_CHANGED.fallback)).toHaveCount(0);
});

test("a set-notice intent without a valid notice is ignored", async ({ page }) => {
  await mountPanel(page);
  expect((await snapshot(page)).notice).toBeNull();
  for (const notice of [
    { tone: "error", text: "x" },
    { tone: "error", key: "__proto__", fallback: "x" },
    { tone: "error", key: "v4_notice_map_changed", fallback: 42 },
  ]) {
    await sendIntent(page, { type: "set-notice", notice });
    expect((await snapshot(page)).notice, JSON.stringify(notice)).toBeNull();
  }
});

// A date placeholder carries one ISO timestamp; the view formats it as it
// renders, in Home Assistant's language and time zone.
test("a notice date placeholder holds exactly one valid timestamp", async ({ page }) => {
  const panel = await mountPanel(page);
  const dated = (date) => ({
    tone: "warning",
    key: "v4_notice_saved_map",
    fallback: "Showing the saved map from {date} without the robot's position.",
    placeholders: { date },
  });
  for (const date of [{ date: "nonsense" }, { date: 1 }, { date: "2026-09-25T12:00:00Z", extra: "x" }, {}]) {
    await sendIntent(page, { type: "set-notice", notice: dated(date) });
    expect((await snapshot(page)).notice, JSON.stringify(date)).toBeNull();
  }
  const valid = dated({ date: "2026-09-25T12:00:00Z" });
  await sendIntent(page, { type: "set-notice", notice: valid });
  expect((await snapshot(page)).notice).toEqual(valid);
  expect(await page.evaluate(() => {
    const { placeholders } = window.__noticePanel.getWorkspaceSnapshot().notice;
    return Object.isFrozen(placeholders) && Object.isFrozen(placeholders.date);
  }), "the stored placeholders and their date are frozen").toBe(true);
  const shown = await page.evaluate(() => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date("2026-09-25T12:00:00Z")));
  await expect(panel.getByText(`Showing the saved map from ${shown} without the robot's position.`).first()).toBeAttached();
});

test("@safety a Stop the robot rejects reports that Home Assistant can't confirm it stopped", async ({ page }) => {
  const panel = await mountPanel(page, {
    initialRobotStates: {
      "vacuum.synthetic": { state: "cleaning", attributes: { matic_entry_id: "synthetic-entry" } },
    },
  });
  await page.evaluate(() => window.__panelFixture.failNextService("stop_intelligent_cleaning"));
  await panel.getByRole("button", { name: "Stop cleaning", exact: true }).first().click();

  await expect.poll(async () => (await snapshot(page)).command).toBe("failed");
  expect((await snapshot(page)).notice).toMatchObject({ tone: "error", key: "v4_notice_stop_unconfirmed" });
  expect(await serviceCalls(page, "stop_intelligent_cleaning")).toBe(1);
});

test("a coverage guard rejection maps to its notice key", async ({ page }) => {
  const panel = await mountPanel(page, { initialPlanCatalog: PLAN_CATALOG });
  await expect.poll(() => page.evaluate(() =>
    window.__noticePanel.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
  await sendIntent(page, { type: "open-workflow", workflow: "plan" });
  await expect.poll(async () => (await snapshot(page)).workflow).toBe("plan");
  await page.evaluate(() => window.__panelFixture.failNextService("run_selected_plan", {
    translation_domain: "matic_robot",
    translation_key: "coverage_native_session_active",
  }));
  await panel.getByRole("button", { name: "Run plan", exact: true }).first().click();

  await expect.poll(async () => (await snapshot(page)).command).toBe("failed");
  expect((await snapshot(page)).notice).toMatchObject({ tone: "error", key: "v4_notice_coverage_robot_busy" });
  expect(await serviceCalls(page, "run_selected_plan")).toBe(1);
});

test("a failed area save reports the area notice key", async ({ page }) => {
  const panel = await mountPanel(page);
  await page.evaluate(() => {
    const panel = window.__noticePanel;
    const fetchWithAuth = panel.hass.fetchWithAuth;
    window.__areaSaves = 0;
    panel.hass = {
      ...panel.hass,
      fetchWithAuth: (path, init) => {
        if (init?.method === "POST" && path.includes("/areas/")) {
          window.__areaSaves += 1;
          return Promise.resolve(new Response("{}", { status: 500 }));
        }
        return fetchWithAuth(path, init);
      },
    };
  });
  await sendIntent(page, { type: "open-workflow", workflow: "draw" });
  await expect.poll(async () => (await snapshot(page)).workflow).toBe("draw");
  await sendIntent(page, { type: "set-draw-tool", tool: "paint" });
  await page.evaluate(() => {
    const state = window.__noticePanel.getWorkspaceSnapshot();
    window.__noticePanel.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent(
      "matic-workspace-intent",
      {
        detail: {
          type: "set-draft-circles",
          circles: [{ x: 1, y: 1, radius: 0.4 }],
          coordinateEdit: {
            generation: state.generation,
            tool: "paint",
            baselineCircles: state.draw.circles,
            baselineOutline: state.draw.outline ?? null,
          },
        },
        bubbles: true,
        composed: true,
      },
    ));
  });
  await panel.getByRole("button", { name: "Name and save", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).workflow).toBe("areaReview");
  await sendIntent(page, { type: "patch-area-draft", patch: { name: "Hallway" } });
  await panel.getByRole("button", { name: "Save area", exact: true }).first().click();

  await expect.poll(async () => (await snapshot(page)).notice?.key ?? null).toBe("v4_notice_area_save_failed");
  expect((await snapshot(page)).notice?.tone).toBe("error");
  expect(await page.evaluate(() => window.__areaSaves)).toBe(1);
});

// ---- Notice surfaces: the slot, the toast and the two live regions ----------

const GALLERY_TAG = "matic-map-studio-gallery-v0-4-0";

async function loadGallery(page, { scenario = "ready", narrow = false } = {}) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await import("/map_studio_v4-review/review.js");
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
  const gallery = page.locator(GALLERY_TAG);
  await expect(gallery.getByRole("heading", { level: 2 })).toBeAttached();
  return gallery;
}

const sampleNotice = (tone, fallback = `Sample ${tone} notice`) => ({
  tone, key: `v4_notice_sample_${tone}`, fallback,
});

const galleryIntent = (page, intent) => page.evaluate(({ tag, detail }) => {
  const shell = document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4");
  shell.dispatchEvent(new CustomEvent("matic-workspace-intent", { detail, bubbles: true, composed: true }));
}, { tag: GALLERY_TAG, detail: intent });

const setGalleryNotice = (page, notice) => galleryIntent(page, { type: "set-notice", notice });

const galleryNotice = (page) => page.evaluate((tag) =>
  document.querySelector(tag).getWorkspaceSnapshot().notice, GALLERY_TAG);

// After install() fake time still follows the wall clock. Pause it once the
// page is up, so runFor() is the only thing that moves it.
const freezeClock = async (page) => {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
};

test("the notice slot sits directly under the workflow heading in every workflow", async ({ page }) => {
  for (const scenario of [
    "ready", "rooms", "plans", "plan-saved-intelligent", "draw", "area-review-new", "history", "support",
  ]) {
    const gallery = await loadGallery(page, { scenario });
    await setGalleryNotice(page, sampleNotice("warning", `Slot sample for ${scenario}`));
    const slot = gallery.locator("[data-notice-slot]");
    await expect(slot, scenario).toHaveCount(1);
    await expect(slot, scenario).toContainText(`Slot sample for ${scenario}`);
    const order = await slot.evaluate((element) => {
      const root = element.getRootNode();
      const heading = root.querySelector("h2");
      const description = root.querySelector(".panel-description");
      const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        afterHeading: follows(heading, element),
        beforeDescription: follows(element, description),
        previous: element.previousElementSibling?.className ?? null,
        pinnedWith: element.parentElement.className,
        next: element.nextElementSibling?.className ?? null,
      };
    });
    expect(order, scenario).toEqual({
      afterHeading: true,
      beforeDescription: true,
      previous: "panel-heading",
      pinnedWith: "panel-top",
      next: null,
    });
  }
});

test("success and error notices toast at once", async ({ page }) => {
  const gallery = await loadGallery(page);
  const toast = gallery.locator("[data-notice-toast]");
  await expect(toast).toBeAttached();
  await expect(toast).toBeHidden();

  await setGalleryNotice(page, sampleNotice("success", "Saved sample"));
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-tone", "success");
  await expect(toast).toContainText("Saved sample");

  await setGalleryNotice(page, sampleNotice("error", "Failed sample"));
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-tone", "error");
  await expect(toast).toContainText("Failed sample");
  await expect(toast).not.toContainText("Saved sample");

  // The slot is on screen on a wide layout, so info stays out of the toast.
  await setGalleryNotice(page, sampleNotice("info", "Info sample"));
  await expect(toast).toBeHidden();
  await expect(gallery.locator("[data-notice-slot]")).toContainText("Info sample");
});

test("@mobile info and warning notices toast only while the sheet is at peek", async ({ page }) => {
  const gallery = await loadGallery(page, { narrow: true });
  const sheet = gallery.getByRole("complementary", { name: "Cleaning panel" });
  const toast = gallery.locator("[data-notice-toast]");
  await expect(sheet).toHaveAttribute("data-detent", "half");

  await setGalleryNotice(page, sampleNotice("info", "Info at half"));
  await expect(gallery.locator("[data-notice-slot]")).toBeVisible();
  await expect(toast).toBeHidden();

  await gallery.getByRole("complementary", { name: "Cleaning panel" }).getByRole("button", { name: "Collapse panel", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-detent", "peek");
  await setGalleryNotice(page, sampleNotice("warning", "Warning at peek"));
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-tone", "warning");
  await expect(toast).toContainText("Warning at peek");
  // Anchored to the sheet's top edge.
  await expect.poll(async () => {
    const [sheetBox, toastBox] = [await sheet.boundingBox(), await toast.boundingBox()];
    const gap = sheetBox.y - (toastBox.y + toastBox.height);
    return gap >= 0 && gap <= 24;
  }).toBe(true);

  await setGalleryNotice(page, sampleNotice("info", "Info at peek"));
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Info at peek");

  await gallery.getByRole("button", { name: "Expand panel" }).click();
  await expect(sheet).toHaveAttribute("data-detent", "half");
  await expect(toast).toBeHidden();
  await expect(gallery.locator("[data-notice-slot]")).toContainText("Info at peek");
});

test("info notices toast in Full map", async ({ page }) => {
  // A selected room gives the HUD its large Clean button, which the anchor clears.
  const gallery = await loadGallery(page, { scenario: "rooms" });
  const roomId = await page.evaluate((tag) =>
    document.querySelector(tag).getWorkspaceSnapshot().resources.plans.value.rooms[0].roomId, GALLERY_TAG);
  await galleryIntent(page, { type: "toggle-room", roomId });
  await galleryIntent(page, { type: "enter-full-map" });
  const hud = gallery.getByRole("region", { name: "Robot status and action" });
  await expect(hud.getByRole("button", { name: /^Clean/u })).toBeVisible();

  const toast = gallery.locator("[data-notice-toast]");
  await setGalleryNotice(page, sampleNotice("info", "Info in full map"));
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-tone", "info");
  await expect(toast).toContainText("Info in full map");
  // Anchored above the HUD.
  const [hudBox, toastBox] = [await hud.boundingBox(), await toast.boundingBox()];
  const gap = hudBox.y - (toastBox.y + toastBox.height);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(24);
});

test("the toast hides on its timer but the slot keeps the notice", async ({ page }) => {
  await page.clock.install();
  const gallery = await loadGallery(page);
  await freezeClock(page);
  const toast = gallery.locator("[data-notice-toast]");
  await setGalleryNotice(page, sampleNotice("success", "Timed sample"));
  await expect(toast).toBeVisible();

  await page.clock.runFor(3900);
  await expect(toast).toBeVisible();
  await page.clock.runFor(100);
  await expect(toast).toBeHidden();
  await expect(gallery.locator("[data-notice-slot]")).toContainText("Timed sample");
  expect(await galleryNotice(page)).toMatchObject({ tone: "success", fallback: "Timed sample" });

  // Errors stay for ten seconds.
  await setGalleryNotice(page, sampleNotice("error", "Timed error"));
  await expect(toast).toBeVisible();
  await page.clock.runFor(9900);
  await expect(toast).toBeVisible();
  await page.clock.runFor(100);
  await expect(toast).toBeHidden();
  expect(await galleryNotice(page)).toMatchObject({ tone: "error", fallback: "Timed error" });
});

test("a success toast finishes its timer after Back clears the slot", async ({ page }) => {
  await page.clock.install();
  const gallery = await loadGallery(page, { scenario: "rooms" });
  await freezeClock(page);
  const toast = gallery.locator("[data-notice-toast]");
  await setGalleryNotice(page, sampleNotice("success", "Saved then Back"));
  await expect(toast).toBeVisible();
  await page.clock.runFor(1000);

  await galleryIntent(page, { type: "open-workflow", workflow: "none" });
  await expect(gallery.locator("[data-notice-slot]")).toHaveCount(0);
  expect(await galleryNotice(page)).toBeNull();
  await expect(toast).toContainText("Saved then Back");
  await page.clock.runFor(2900);
  await expect(toast).toBeVisible();
  await page.clock.runFor(100);
  await expect(toast).toBeHidden();
});

test("hovering or focusing the toast pauses its timer", async ({ page }) => {
  await page.clock.install();
  const gallery = await loadGallery(page);
  await freezeClock(page);
  const toast = gallery.locator("[data-notice-toast]");

  await setGalleryNotice(page, sampleNotice("success", "Hovered sample"));
  await expect(toast).toBeVisible();
  await toast.hover();
  await page.clock.runFor(8000);
  await expect(toast).toBeVisible();
  await page.mouse.move(1, 1);
  await page.clock.runFor(3900);
  await expect(toast).toBeVisible();
  await page.clock.runFor(100);
  await expect(toast).toBeHidden();

  await setGalleryNotice(page, sampleNotice("success", "Focused sample"));
  await expect(toast).toBeVisible();
  const close = toast.getByRole("button", { name: "Hide notification" });
  await close.focus();
  await page.clock.runFor(8000);
  await expect(toast).toBeVisible();
  await close.evaluate((element) => element.blur());
  await page.clock.runFor(3900);
  await expect(toast).toBeVisible();
  await page.clock.runFor(100);
  await expect(toast).toBeHidden();
});

test("slot Close clears the notice and the toast's Hide notification hides only the toast", async ({ page }) => {
  const gallery = await loadGallery(page);
  const toast = gallery.locator("[data-notice-toast]");
  const slot = gallery.locator("[data-notice-slot]");
  await setGalleryNotice(page, sampleNotice("success", "Closable sample"));
  await expect(toast).toBeVisible();
  await expect(slot).toBeVisible();

  const toastClose = toast.getByRole("button", { name: "Hide notification", exact: true });
  const slotClose = slot.getByRole("button", { name: "Close", exact: true });
  for (const close of [toastClose, slotClose]) {
    const box = await close.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  await toastClose.click();
  await expect(toast).toBeHidden();
  await expect(slot).toContainText("Closable sample");
  expect(await galleryNotice(page)).toMatchObject({ tone: "success", fallback: "Closable sample" });

  await slotClose.click();
  await expect(slot).toHaveCount(0);
  expect(await galleryNotice(page)).toBeNull();
});

test("Escape leaves the notice in place", async ({ page }) => {
  const gallery = await loadGallery(page);
  const toast = gallery.locator("[data-notice-toast]");
  const slot = gallery.locator("[data-notice-slot]");
  await setGalleryNotice(page, sampleNotice("error", "Escape sample"));
  await expect(toast).toBeVisible();

  for (const close of [slot.getByRole("button", { name: "Close" }), toast.getByRole("button", { name: "Hide notification" })]) {
    await close.focus();
    await page.keyboard.press("Escape");
    await expect(slot).toContainText("Escape sample");
    await expect(toast).toBeVisible();
    expect(await galleryNotice(page)).toMatchObject({ tone: "error", fallback: "Escape sample" });
  }
});

test("Escape leaves a workflow without clearing its error notice", async ({ page }) => {
  const gallery = await loadGallery(page, { scenario: "rooms" });
  const slot = gallery.locator("[data-notice-slot]");
  const toast = gallery.locator("[data-notice-toast]");
  await setGalleryNotice(page, sampleNotice("error", "Workflow escape sample"));
  await expect(toast).toBeVisible();
  expect((await page.evaluate((tag) =>
    document.querySelector(tag).getWorkspaceSnapshot().workflow, GALLERY_TAG)), "workflow before Escape").not.toBe("none");

  await slot.getByRole("button", { name: "Close" }).focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate((tag) =>
    document.querySelector(tag).getWorkspaceSnapshot().workflow, GALLERY_TAG)).toBe("none");
  expect(await galleryNotice(page)).toMatchObject({ tone: "error", fallback: "Workflow escape sample" });
  await expect(slot).toContainText("Workflow escape sample");
  await expect(toast).toBeVisible();
});

test("a detached and reattached shell does not keep a stale toast", async ({ page }) => {
  await page.clock.install();
  const gallery = await loadGallery(page);
  await freezeClock(page);
  const toast = gallery.locator("[data-notice-toast]");
  await setGalleryNotice(page, sampleNotice("success", "Detached sample"));
  await expect(toast).toBeVisible();

  await page.evaluate(async (tag) => {
    const shell = document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4");
    const parent = shell.parentElement;
    shell.remove();
    parent.append(shell);
    await shell.updateComplete;
  }, GALLERY_TAG);
  await expect(toast).toBeHidden();
  await expect(gallery.locator("[data-notice-slot]")).toContainText("Detached sample");
  expect(await galleryNotice(page)).toMatchObject({ tone: "success", fallback: "Detached sample" });
});

test("a toast replaced under the pointer keeps its timer paused", async ({ page }) => {
  await page.clock.install();
  const gallery = await loadGallery(page);
  await freezeClock(page);
  const toast = gallery.locator("[data-notice-toast]");
  await setGalleryNotice(page, sampleNotice("success", "First under pointer"));
  await expect(toast).toBeVisible();
  await toast.hover();

  await setGalleryNotice(page, sampleNotice("success", "Second under pointer"));
  await expect(toast).toContainText("Second under pointer");
  await page.clock.runFor(8000);
  await expect(toast).toBeVisible();
  await page.mouse.move(1, 1);
  await page.clock.runFor(3900);
  await expect(toast).toBeVisible();
  await page.clock.runFor(100);
  await expect(toast).toBeHidden();
});

test("focus leaves a toast that a cleared notice hides for the panel heading", async ({ page }) => {
  const gallery = await loadGallery(page);
  const toast = gallery.locator("[data-notice-toast]");
  await setGalleryNotice(page, sampleNotice("error", "Focused then cleared"));
  const hide = toast.getByRole("button", { name: "Hide notification" });
  await hide.focus();
  await expect(hide).toBeFocused();

  await setGalleryNotice(page, null);
  await expect(toast).toBeHidden();
  await expect(gallery.getByRole("heading", { level: 2 })).toBeFocused();
});

test("@safety errors announce through the alert region and other tones through the polite region, once each", async ({ page }) => {
  await loadGallery(page);
  const setup = await page.evaluate((tag) => {
    const root = document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4").shadowRoot;
    const alert = root.querySelector('.root > [role="alert"]');
    const polite = root.querySelector('.root > [aria-live="polite"]');
    window.__regionLog = { alert: [], polite: [] };
    for (const [name, region] of [["alert", alert], ["polite", polite]]) {
      if (!region) continue;
      window.__regionLog[name].push(region.textContent.trim());
      new MutationObserver(() => window.__regionLog[name].push(region.textContent.trim()))
        .observe(region, { childList: true, characterData: true, subtree: true });
    }
    return {
      alerts: root.querySelectorAll('[role="alert"]').length,
      polite: root.querySelectorAll('.root > [aria-live="polite"]').length,
      alert: alert && {
        live: alert.getAttribute("aria-live"),
        atomic: alert.getAttribute("aria-atomic"),
        srOnly: alert.classList.contains("sr-only"),
      },
    };
  }, GALLERY_TAG);
  expect(setup).toEqual({ alerts: 1, polite: 1, alert: { live: null, atomic: "true", srOnly: true } });

  // How many times a region's text changed to include `text`.
  const announced = (region, text) => page.evaluate(({ name, value }) => {
    let count = 0;
    let before = false;
    for (const entry of window.__regionLog[name]) {
      const now = entry.includes(value);
      if (now && !before) count += 1;
      before = now;
    }
    return count;
  }, { name: region, value: text });
  const current = (region) => page.evaluate((name) => window.__regionLog[name].at(-1) ?? "", region);
  const setLocalize = (translations) => page.evaluate(({ tag, map }) => {
    const shell = document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4");
    shell.localize = map ? (key) => map[key] ?? key : undefined;
    return shell.updateComplete;
  }, { tag: GALLERY_TAG, map: translations });

  await setGalleryNotice(page, sampleNotice("error", "Stop failed sample"));
  await expect.poll(() => announced("alert", "Stop failed sample")).toBe(1);
  // Re-renders and a language swap do not announce it again.
  await galleryIntent(page, { type: "toggle-labels" });
  await galleryIntent(page, { type: "toggle-labels" });
  await setLocalize({ "component.matic_robot.common.v4_notice_sample_error": "Arrêt échoué" });
  await expect(page.locator(GALLERY_TAG).locator("[data-notice-slot]")).toContainText("Arrêt échoué");
  await setLocalize(null);
  expect(await announced("alert", "Stop failed sample")).toBe(1);
  expect(await announced("alert", "Arrêt échoué")).toBe(0);
  expect(await announced("polite", "Stop failed sample")).toBe(0);

  for (const tone of ["info", "success", "warning"]) {
    const text = `Polite ${tone} sample`;
    await setGalleryNotice(page, sampleNotice(tone, text));
    await expect.poll(() => announced("polite", text)).toBe(1);
    await galleryIntent(page, { type: "toggle-labels" });
    expect(await announced("polite", text)).toBe(1);
    expect(await announced("alert", text)).toBe(0);
  }

  // Clearing announces nothing: both regions keep their last message.
  await setGalleryNotice(page, null);
  await expect(page.locator(GALLERY_TAG).locator("[data-notice-slot]")).toHaveCount(0);
  expect(await current("polite")).toBe("Polite warning sample");
  expect(await current("alert")).toBe("Stop failed sample");
});

// Starts recording each text a shell live region changes to; readRegion()
// returns that list for "polite" or "alert".
const watchRegions = (page) => page.evaluate((tag) => {
  const shell = window.__noticePanel?.shadowRoot.querySelector("matic-map-shell-v4")
    ?? document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4");
  window.__regionChanges = { alert: [], polite: [] };
  for (const [name, selector] of [["alert", '.root > [role="alert"]'], ["polite", '.root > [aria-live="polite"]']]) {
    const region = shell.shadowRoot.querySelector(selector);
    let last = region.textContent.trim();
    new MutationObserver(() => {
      const now = region.textContent.trim();
      if (now !== last) window.__regionChanges[name].push(now);
      last = now;
    }).observe(region, { childList: true, characterData: true, subtree: true });
  }
}, GALLERY_TAG);
const readRegion = (page, name) => page.evaluate((region) => window.__regionChanges[region], name);

test("@mobile the polite region holds only the newest message and a cleared notice writes nothing", async ({ page }) => {
  const gallery = await loadGallery(page, { narrow: true });
  await gallery.getByRole("complementary", { name: "Cleaning panel" }).getByRole("button", { name: "Collapse panel", exact: true }).click();
  await expect(gallery.locator('.root > [aria-live="polite"]')).toHaveText("Cleaning panel, collapsed");
  await watchRegions(page);

  await setGalleryNotice(page, sampleNotice("info", "Newest sample"));
  await expect.poll(() => readRegion(page, "polite")).toEqual(["Newest sample"]);
  await setGalleryNotice(page, null);
  await galleryIntent(page, { type: "toggle-labels" });
  await expect(gallery.locator("[data-notice-slot]")).toHaveCount(0);
  expect(await readRegion(page, "polite")).toEqual(["Newest sample"]);
});

test("Try again on a limited map rereads the catalog once and is disabled meanwhile", async ({ page }) => {
  const limited = {
    entry_id: "synthetic-entry",
    scene_url: "/api/matic_robot/slam_scene/synthetic",
    delta_url: null,
    pose_url: "/api/matic_robot/slam_pose/synthetic",
    history_url: "/api/matic_robot/slam_history/synthetic",
    areas_url: "/api/matic_robot/areas/synthetic",
    plans_url: "/api/matic_robot/plans/synthetic",
    map_revision: 7,
    map_floor_coherent: true,
    map_session_verified: true,
    map_session_key: "a".repeat(64),
    map_complete: true,
    map_truncated: false,
    selected_floor_ordinal: 1,
    map_floor_ordinal: 1,
    history_count: 1,
    history_floor_count: 2,
    map_health: "limited",
    stream_failures: 0,
    bootstrap_state: "complete",
    bootstrap_photo_seen: true,
    bootstrap_structure_seen: true,
    bootstrap_failures: 0,
    runner_locked: false,
    stop_settle_pending: false,
    active_plan: false,
    native_reconciliation_pending: false,
    native_session_active: false,
  };
  const panel = await mountPanel(page, { initialCatalogEntries: [limited] });
  // The fixture panel lays out narrow, so the strip is the sheet's status line.
  const strip = panel.locator(".sheet-status");
  await expect(strip).toContainText("Map limited");
  await expect(strip).toContainText("Cleaning can't start");
  const retry = panel.locator(".host-state").getByRole("button", { name: "Try again", exact: true });
  await expect(retry).not.toHaveAttribute("aria-disabled", "true");

  await page.evaluate(() => window.__panelFixture.deferNextCatalog());
  const reads = await page.evaluate(() => window.__panelFixture.catalogReads);
  await retry.click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.pendingCatalogCount())).toBe(1);
  await expect(retry).toHaveAttribute("aria-disabled", "true");
  await expect(strip).toContainText("Checking again");
  await retry.dispatchEvent("click");
  expect(await page.evaluate(() => window.__panelFixture.catalogReads)).toBe(reads + 1);

  await page.evaluate(() => window.__panelFixture.releaseCatalog());
  await expect(retry).not.toHaveAttribute("aria-disabled", "true");
  await expect(strip).toContainText("Cleaning can't start");
  expect(await page.evaluate(() => window.__panelFixture.serviceCalls)).toEqual([]);

  // The controller that set the flag clears it when it ends: a detach in
  // mid-recheck leaves Try again working for the reattached panel.
  await page.evaluate(() => window.__panelFixture.deferNextCatalog());
  await retry.click();
  await expect(retry).toHaveAttribute("aria-disabled", "true");
  await page.evaluate(() => {
    window.__noticePanel.remove();
    document.body.append(window.__noticePanel);
  });
  await expect.poll(() => page.evaluate(() => window.__noticePanel.getWorkspaceSnapshot().rechecking),
    "rechecking after a detach mid-recheck").toBe(false);
  await expect(retry).not.toHaveAttribute("aria-disabled", "true");
  const before = await page.evaluate(() => window.__panelFixture.catalogReads);
  await retry.click();
  await expect.poll(() => page.evaluate(() => window.__panelFixture.catalogReads),
    "catalog reads after Try again on the reattached panel").toBeGreaterThan(before);
  await page.evaluate(() => window.__panelFixture.releaseCatalog());
});

test("a repeated workspace notice toasts and announces again", async ({ page }) => {
  const catalog = structuredClone(PLAN_CATALOG);
  catalog.plans[0].next_run_preview = null;
  const panel = await mountPanel(page, { initialPlanCatalog: catalog });
  await expect.poll(() => page.evaluate(() =>
    window.__noticePanel.getWorkspaceSnapshot().resources.plans.status)).toBe("ready");
  await sendIntent(page, { type: "open-workflow", workflow: "plan" });
  await expect.poll(async () => (await snapshot(page)).workflow).toBe("plan");
  // Full map hides the slot, so a warning toasts (shell.md §4 rule 3).
  await sendIntent(page, { type: "enter-full-map" });
  await watchRegions(page);
  const runPlan = () => page.evaluate(() => {
    window.__noticePanel.shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent(
      "matic-workspace-action",
      { detail: { id: "run-plan" }, bubbles: true, composed: true },
    ));
  });
  const toast = panel.locator("[data-notice-toast]");
  const missing = "The next-run preview isn't ready; reload your plans, then try again.";

  await runPlan();
  await expect(toast).toContainText(missing);
  await toast.getByRole("button", { name: "Hide notification" }).click();
  await expect(toast).toBeHidden();
  await runPlan();
  await expect(toast).toContainText(missing);
  await expect.poll(async () => (await readRegion(page, "polite")).filter((text) => text === missing).length)
    .toBe(2);
});

test("a status title change is announced once through the polite region", async ({ page }) => {
  await loadGallery(page);
  await watchRegions(page);
  await page.evaluate((tag) => document.querySelector(tag).setScenario("transition"), GALLERY_TAG);
  await expect.poll(() => readRegion(page, "polite")).toEqual(["Locating"]);
  await galleryIntent(page, { type: "toggle-labels" });
  await galleryIntent(page, { type: "toggle-labels" });
  expect(await readRegion(page, "polite")).toEqual(["Locating"]);
});

test("an invalid notice is ignored alike through an intent and a state replacement", async ({ page }) => {
  await loadGallery(page);
  const kept = sampleNotice("info", "Kept sample");
  await setGalleryNotice(page, kept);
  const results = await page.evaluate(({ tag, invalid }) => {
    const gallery = document.querySelector(tag);
    const shell = gallery.shadowRoot.querySelector("matic-map-shell-v4");
    shell.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      detail: { type: "set-notice", notice: invalid }, bubbles: true, composed: true,
    }));
    const viaIntent = gallery.getWorkspaceSnapshot().notice;
    gallery.replaceWorkspaceState({ ...gallery.getWorkspaceSnapshot(), notice: invalid });
    return { viaIntent, viaReplace: gallery.getWorkspaceSnapshot().notice };
  }, { tag: GALLERY_TAG, invalid: { tone: "error", key: "__proto__", fallback: "x" } });
  expect(results.viaIntent).toEqual(kept);
  expect(results.viaReplace).toEqual(kept);
});

test("a status title and a notice committed together are both announced once, in order", async ({ page }) => {
  await loadGallery(page);
  await watchRegions(page);
  await page.evaluate(({ tag, notice }) => {
    const gallery = document.querySelector(tag);
    gallery.replaceWorkspaceState({ ...gallery.getWorkspaceSnapshot(), coherence: "verifying", notice });
  }, { tag: GALLERY_TAG, notice: sampleNotice("info", "Together sample") });
  await expect.poll(() => readRegion(page, "polite")).toEqual(["Locating", "Together sample"]);
  await galleryIntent(page, { type: "toggle-labels" });
  expect(await readRegion(page, "polite")).toEqual(["Locating", "Together sample"]);
});

test("a language swap does not announce the status title again", async ({ page }) => {
  await loadGallery(page);
  await watchRegions(page);
  await page.evaluate((tag) => {
    const shell = document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4");
    shell.localize = (key) => (key.endsWith(".v4_docked") ? "Angedockt" : key);
    return shell.updateComplete;
  }, GALLERY_TAG);
  await expect(page.locator(GALLERY_TAG).locator(".status-strip strong")).toHaveText("Angedockt");
  expect(await readRegion(page, "polite")).toEqual([]);
});

test("a notice is validated and stored from one read of each field", async ({ page }) => {
  await loadGallery(page);
  const stored = await page.evaluate(async (tag) => {
    const gallery = document.querySelector(tag);
    const shell = gallery.shadowRoot.querySelector("matic-map-shell-v4");
    const send = (notice) => shell.dispatchEvent(new CustomEvent(
      "matic-workspace-intent",
      { detail: { type: "set-notice", notice }, bubbles: true, composed: true },
    ));
    const shifting = (first, later) => {
      let reads = 0;
      return () => (reads++ === 0 ? first : later);
    };
    const tone = shifting("success", "evil");
    send({ get tone() { return tone(); }, key: "v4_notice_sample_success", fallback: "Tone sample" });
    const afterTone = gallery.getWorkspaceSnapshot().notice;
    const placeholders = shifting({ name: "Kitchen" }, { name: { evil: true } });
    send({ tone: "info", key: "v4_notice_sample_info", fallback: "{name} sample", get placeholders() { return placeholders(); } });
    return { afterTone, afterPlaceholders: gallery.getWorkspaceSnapshot().notice };
  }, GALLERY_TAG);
  expect([null, "success"], JSON.stringify(stored.afterTone)).toContain(stored.afterTone?.tone ?? null);
  expect([null, "Kitchen"], JSON.stringify(stored.afterPlaceholders))
    .toContain(stored.afterPlaceholders?.placeholders?.name ?? null);
});

// Home Assistant's default palettes (home-assistant/frontend color.globals.ts),
// the colours ha_theme_axe.mjs audits with.
const HA_PALETTES = {
  light: {
    "--primary-color": "#009ac7", "--card-background-color": "#ffffff", "--secondary-background-color": "#e5e5e5",
    "--primary-text-color": "#141414", "--error-color": "#db4437", "--warning-color": "#ffa600", "--success-color": "#43a047",
  },
  dark: {
    "--primary-color": "#009ac7", "--card-background-color": "#1c1c1c", "--secondary-background-color": "#282828",
    "--primary-text-color": "#e1e1e1", "--error-color": "#db4437", "--warning-color": "#ffa600", "--success-color": "#43a047",
  },
};

test("notice text keeps 4.5:1 contrast in every tone with Home Assistant's palettes", async ({ page }) => {
  for (const [scheme, palette] of Object.entries(HA_PALETTES)) {
    await page.emulateMedia({ colorScheme: scheme });
    const gallery = await loadGallery(page);
    await page.evaluate((colors) => {
      for (const [name, value] of Object.entries(colors)) document.documentElement.style.setProperty(name, value);
    }, palette);
    for (const tone of ["info", "success", "warning", "error"]) {
      await setGalleryNotice(page, sampleNotice(tone, `${tone} contrast sample`));
      const ratios = await gallery.locator(".notice-text").evaluateAll((elements) => elements.map((element) => {
        const luminance = (color) => {
          const values = color.match(/[\d.]+/g).slice(0, 3).map(Number);
          const rgb = color.startsWith("color(srgb") ? values : values.map((value) => value / 255);
          const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const text = luminance(getComputedStyle(element).color);
        const surface = luminance(getComputedStyle(element.parentElement).backgroundColor);
        return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05);
      }));
      expect(ratios.length, `${scheme} ${tone} rendered`).toBeGreaterThan(0);
      expect(Math.min(...ratios), `${scheme} ${tone} ${JSON.stringify(ratios)}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

// shell.md §2: on a "No button" row the policy still returns its disabled
// branch, but it carries no copy, since no view renders it; the strip says
// the state.
test("rows the spec marks No button render no footer button and carry no copy", async ({ page }) => {
  for (const [scenario, id] of [
    ["ready", "choose-cleaning"],
    ["ha-offline", "reconnecting"],
    ["access", "administrator"],
    ["empty", "setup"],
    ["robot-offline", "robot-offline"],
    ["problem", "problem"],
    ["map-unavailable", "map-unavailable"],
    ["map-limited", "locating"],
    ["transition", "locating"],
    ["stopping", "stopping"],
  ]) {
    const gallery = await loadGallery(page, { scenario });
    await expect(gallery.locator(".status-strip"), scenario).toBeVisible();
    await expect(gallery.locator(".action-bar button"), scenario).toHaveCount(0);
    await expect(gallery.locator(".action-bar .action-reason"), scenario).toHaveCount(0);
    const action = await gallery.evaluate(async (element) => {
      const { selectPrimaryAction } = await import("/map_studio_v4-review/review.js");
      return selectPrimaryAction(element.getWorkspaceSnapshot());
    });
    expect(action, scenario).toEqual({ id, enabled: false });
  }
});

// design-system.md: text never uses a raw tone colour; the tone is the rule
// and the tint.
test("workflow problems and warnings keep their text in the primary text colour", async ({ page }) => {
  for (const [scenario, selector] of [["plan-cadence-blocked", ".problem"], ["area-review-rebind", '.notice[data-tone="warning"]']]) {
    const gallery = await loadGallery(page, { scenario });
    const box = gallery.locator(selector).first();
    await expect(box, scenario).toBeVisible();
    const colours = await box.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--ms-text)";
      element.after(probe);
      const style = getComputedStyle(element);
      const result = { text: style.color, primary: getComputedStyle(probe).color, rule: style.borderInlineStartWidth };
      probe.remove();
      return result;
    });
    expect(colours.text, scenario).toBe(colours.primary);
    expect(colours.rule, scenario).toBe("3px");
  }
});

test("a wide toast is centred over the canvas", async ({ page }) => {
  for (const [width, height] of [[1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    const gallery = await loadGallery(page);
    await setGalleryNotice(page, sampleNotice("success", `Centred at ${width}`));
    const toast = gallery.locator("[data-notice-toast]");
    await expect(toast).toBeVisible();
    const offset = await toast.evaluate((element) => {
      const centre = (box) => box.left + box.width / 2;
      const canvas = element.getRootNode().querySelector(".canvas").getBoundingClientRect();
      return centre(element.getBoundingClientRect()) - centre(canvas);
    });
    expect(Math.abs(offset), `toast centre offset at ${width}`).toBeLessThanOrEqual(1);
  }
});

test("slot, toast and canvas chip carry no live role", async ({ page }) => {
  const gallery = await loadGallery(page);
  await setGalleryNotice(page, sampleNotice("error", "Silent surfaces sample"));
  for (const surface of [gallery.locator("[data-notice-slot]"), gallery.locator("[data-notice-toast]")]) {
    await expect(surface).toBeVisible();
    expect(await surface.evaluate((element) => {
      // The toast's region role names a landmark; it is not a live role.
      const live = ["alert", "status", "log", "marquee", "timer"];
      const found = [];
      for (const node of [element, ...element.querySelectorAll("*")]) {
        found.push(live.find((role) => role === node.getAttribute("role")), node.getAttribute("aria-live"));
      }
      for (let node = element.parentElement; node; node = node.parentElement) {
        found.push(node.getAttribute("aria-live"));
      }
      return found.filter(Boolean);
    })).toEqual([]);
  }

  const offline = await loadGallery(page, { scenario: "ha-offline" });
  const chip = offline.locator("matic-map-canvas-v4 .map-message");
  await expect(chip).toBeVisible();
  expect(await chip.evaluate((element) => [element.getAttribute("role"), element.getAttribute("aria-live")]))
    .toEqual([null, null]);
});

test("the heading and notice slot stay put while the plan editor body scrolls", async ({ page }) => {
  for (const [width, height, narrow] of [[1024, 768, false], [390, 844, true]]) {
    await page.setViewportSize({ width, height });
    const gallery = await loadGallery(page, { scenario: "plan-saved-intelligent", narrow });
    await setGalleryNotice(page, sampleNotice("warning", `Pinned at ${width}`));
    await expect(gallery.locator("[data-notice-slot]")).toBeVisible();
    const moved = await gallery.getByRole("heading", { level: 2 }).evaluate(async (heading) => {
      const root = heading.getRootNode();
      // Let the sheet finish opening to its detent before measuring.
      await Promise.all(root.getAnimations().map((animation) => animation.finished));
      const body = root.querySelector(".workflow-body, .sheet-body");
      const tops = () => ({
        heading: heading.getBoundingClientRect().top,
        slot: root.querySelector("[data-notice-slot]").getBoundingClientRect().top,
        description: root.querySelector(".panel-description").getBoundingClientRect().top,
      });
      const before = tops();
      body.scrollTop = body.scrollHeight;
      await new Promise(requestAnimationFrame);
      const after = tops();
      return {
        scrolled: body.scrollTop,
        heading: after.heading - before.heading,
        slot: after.slot - before.slot,
        description: after.description - before.description,
      };
    });
    expect(moved.scrolled, `body scrolls at ${width}`).toBeGreaterThan(40);
    expect(moved.description, `description scrolls at ${width}`).toBeLessThan(-40);
    expect({ heading: moved.heading, slot: moved.slot }, `pinned at ${width}`).toEqual({ heading: 0, slot: 0 });
  }
});
