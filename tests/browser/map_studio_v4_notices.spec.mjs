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
  await panel.getByRole("button", { name: "Run this plan", exact: true }).first().click();

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
  await expect(gallery.locator(".panel-heading h2")).toBeAttached();
  return gallery;
}

const sampleNotice = (tone, fallback = `Sample ${tone} notice`) => ({
  tone, key: `v4_notice_sample_${tone}`, fallback,
});

const galleryIntent = (page, intent) => page.evaluate(({ tag, detail }) => {
  const shell = document.querySelector(tag).shadowRoot.querySelector(".stage").firstElementChild;
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

const shellActive = (page) => page.evaluate((tag) => {
  const shell = document.querySelector(tag).shadowRoot.querySelector(".stage").firstElementChild;
  const active = shell.shadowRoot.activeElement;
  return active ? `${active.localName}${active.closest(".panel-heading") ? " in heading" : ""}` : null;
}, GALLERY_TAG);

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
      const heading = root.querySelector(".panel-heading h2");
      const description = root.querySelector(".panel-description");
      const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        afterHeading: follows(heading, element),
        beforeDescription: follows(element, description),
        previous: element.previousElementSibling?.className ?? null,
        next: element.nextElementSibling?.className ?? null,
      };
    });
    expect(order, scenario).toEqual({
      afterHeading: true,
      beforeDescription: true,
      previous: "panel-heading",
      next: "panel-description",
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
  const sheet = gallery.locator(".mobile-sheet");
  const toast = gallery.locator("[data-notice-toast]");
  await expect(sheet).toHaveAttribute("data-detent", "half");

  await setGalleryNotice(page, sampleNotice("info", "Info at half"));
  await expect(gallery.locator("[data-notice-slot]")).toBeVisible();
  await expect(toast).toBeHidden();

  await gallery.getByRole("button", { name: "Show less of the map workspace" }).click();
  await expect(sheet).toHaveAttribute("data-detent", "peek");
  await setGalleryNotice(page, sampleNotice("warning", "Warning at peek"));
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-tone", "warning");
  await expect(toast).toContainText("Warning at peek");
  // Anchored to the sheet's top edge.
  await expect.poll(() => toast.evaluate((element) => {
    const sheetTop = element.getRootNode().querySelector(".mobile-sheet").getBoundingClientRect().top;
    const gap = sheetTop - element.getBoundingClientRect().bottom;
    return gap >= 0 && gap <= 24;
  })).toBe(true);

  await setGalleryNotice(page, sampleNotice("info", "Info at peek"));
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Info at peek");

  await gallery.getByRole("button", { name: "Show more of the map workspace" }).click();
  await expect(sheet).toHaveAttribute("data-detent", "half");
  await expect(toast).toBeHidden();
  await expect(gallery.locator("[data-notice-slot]")).toContainText("Info at peek");
});

test("info notices toast in Full map", async ({ page }) => {
  const gallery = await loadGallery(page, { scenario: "full-map" });
  const toast = gallery.locator("[data-notice-toast]");
  await setGalleryNotice(page, sampleNotice("info", "Info in full map"));
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-tone", "info");
  await expect(toast).toContainText("Info in full map");
  // Anchored above the HUD.
  const gap = await toast.evaluate((element) => {
    const hud = element.getRootNode().querySelector(".full-map-hud").getBoundingClientRect();
    return hud.top - element.getBoundingClientRect().bottom;
  });
  // The anchor clears a HUD holding a large action button; this HUD has no
  // button (choose-cleaning renders none), so it sits about 31 px lower.
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(40);
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
  const close = toast.getByRole("button", { name: "Close" });
  await close.focus();
  await page.clock.runFor(8000);
  await expect(toast).toBeVisible();
  await close.evaluate((element) => element.blur());
  await page.clock.runFor(3900);
  await expect(toast).toBeVisible();
  await page.clock.runFor(100);
  await expect(toast).toBeHidden();
});

test("slot Close clears the notice and toast Close hides only the toast", async ({ page }) => {
  const gallery = await loadGallery(page);
  const toast = gallery.locator("[data-notice-toast]");
  const slot = gallery.locator("[data-notice-slot]");
  await setGalleryNotice(page, sampleNotice("success", "Closable sample"));
  await expect(toast).toBeVisible();
  await expect(slot).toBeVisible();

  const toastClose = toast.getByRole("button", { name: "Close", exact: true });
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

  for (const close of [slot.getByRole("button", { name: "Close" }), toast.getByRole("button", { name: "Close" })]) {
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
    const stage = document.querySelector(tag).shadowRoot.querySelector(".stage");
    const shell = stage.firstElementChild;
    shell.remove();
    stage.append(shell);
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
  await toast.getByRole("button", { name: "Close" }).focus();
  expect(await shellActive(page)).toBe("button");

  await setGalleryNotice(page, null);
  await expect(toast).toBeHidden();
  await expect.poll(() => shellActive(page)).toBe("h2 in heading");
});

test("@safety errors announce through the alert region and other tones through the polite region, once each", async ({ page }) => {
  await loadGallery(page);
  const setup = await page.evaluate((tag) => {
    const root = document.querySelector(tag).shadowRoot.querySelector(".stage").firstElementChild.shadowRoot;
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
    const shell = document.querySelector(tag).shadowRoot.querySelector(".stage").firstElementChild;
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
    expect(await current("alert")).toBe("");
    await galleryIntent(page, { type: "toggle-labels" });
    expect(await announced("polite", text)).toBe(1);
    expect(await announced("alert", text)).toBe(0);
  }

  await setGalleryNotice(page, null);
  await expect.poll(() => current("polite")).toBe("");
  expect(await current("alert")).toBe("");
});

test("slot, toast and canvas chip carry no live role", async ({ page }) => {
  const gallery = await loadGallery(page);
  await setGalleryNotice(page, sampleNotice("error", "Silent surfaces sample"));
  for (const surface of [gallery.locator("[data-notice-slot]"), gallery.locator("[data-notice-toast]")]) {
    await expect(surface).toBeVisible();
    expect(await surface.evaluate((element) => {
      const found = [];
      for (const node of [element, ...element.querySelectorAll("*")]) {
        found.push(node.getAttribute("role"), node.getAttribute("aria-live"));
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
