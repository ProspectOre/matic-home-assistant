import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

async function bundledModule(page, name, contents) {
  const bundle = await build({
    stdin: { contents, resolveDir: process.cwd() },
    bundle: true,
    format: "esm",
    write: false,
  });
  await page.route(`**/${name}`, (route) => route.fulfill({
    contentType: "text/javascript",
    body: bundle.outputFiles[0].text,
  }));
  return `/${name}`;
}

test("persists camera preferences once after camera input settles", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.__preferenceSerializations = 0;
    window.__preferenceWrites = 0;
    const stringify = JSON.stringify;
    JSON.stringify = function (value, replacer, space) {
      if (value && typeof value === "object" && value.version === 4 && "cameras" in value) {
        window.__preferenceSerializations += 1;
      }
      return stringify.call(this, value, replacer, space);
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("matic-map-studio:v4:")) window.__preferenceWrites += 1;
      return setItem.call(this, key, value);
    };
  });
  const fixture = await installPanelFixture(page);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  await expect.poll(() => page.evaluate((tag) => {
    const panel = document.querySelector(tag);
    return panel?.getWorkspaceSnapshot().map.available === true;
  }, fixture.panelTag)).toBe(true);

  await page.clock.runFor(1000);
  await page.evaluate(() => {
    window.__preferenceSerializations = 0;
    window.__preferenceWrites = 0;
  });

  await page.evaluate((tag) => {
    const panel = document.querySelector(tag);
    const canvas = panel.shadowRoot.querySelector("matic-map-shell-v4").shadowRoot.querySelector("matic-map-canvas-v4");
    canvas.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      bubbles: true,
      composed: true,
      detail: { type: "set-narrow-hint", value: !panel.getWorkspaceSnapshot().narrowHint },
    }));
  }, fixture.panelTag);
  await page.clock.runFor(300);
  expect(await page.evaluate(() => ({
    serializations: window.__preferenceSerializations,
    writes: window.__preferenceWrites,
  }))).toEqual({ serializations: 0, writes: 0 });

  const camera = await page.evaluate((tag) => {
    const panel = document.querySelector(tag);
    const shell = panel.shadowRoot.querySelector("matic-map-shell-v4");
    const canvas = shell.shadowRoot.querySelector("matic-map-canvas-v4");
    for (let index = 0; index < 12; index += 1) {
      canvas.dispatchEvent(new CustomEvent("matic-workspace-intent", {
        bubbles: true,
        composed: true,
        detail: {
          type: "set-camera",
          view: "top",
          camera: {
            yaw: index * 0.01,
            pitch: 1.2,
            zoom: 1 + index * 0.01,
            targetX: index * 0.02,
            targetZ: 0,
          },
        },
      }));
    }
    return panel.getWorkspaceSnapshot().cameras.top;
  }, fixture.panelTag);
  expect(camera).toBeTruthy();
  expect(await page.evaluate(() => ({
    serializations: window.__preferenceSerializations,
    writes: window.__preferenceWrites,
  }))).toEqual({ serializations: 0, writes: 0 });

  await page.clock.runFor(1000);
  expect(await page.evaluate(() => ({
    serializations: window.__preferenceSerializations,
    writes: window.__preferenceWrites,
  }))).toEqual({ serializations: 1, writes: 1 });
});

test("flushes the latest camera snapshot once on teardown", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.__preferenceWrites = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("matic-map-studio:v4:")) window.__preferenceWrites += 1;
      return setItem.call(this, key, value);
    };
  });
  const fixture = await installPanelFixture(page);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  await expect.poll(() => page.evaluate((tag) =>
    document.querySelector(tag)?.getWorkspaceSnapshot().map.available === true, fixture.panelTag)).toBe(true);
  await page.clock.runFor(1000);
  await page.evaluate(() => { window.__preferenceWrites = 0; });
  await page.evaluate((tag) => {
    const panel = document.querySelector(tag);
    const canvas = panel.shadowRoot.querySelector("matic-map-shell-v4").shadowRoot.querySelector("matic-map-canvas-v4");
    canvas.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      bubbles: true,
      composed: true,
      detail: { type: "set-camera", view: "top", camera: { yaw: 0.23, pitch: 1.2, zoom: 1.4, targetX: 0.3, targetZ: -0.2 } },
    }));
    panel.remove();
  }, fixture.panelTag);
  expect(await page.evaluate(() => window.__preferenceWrites)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("matic-map-studio:v4:synthetic-admin")).cameras.top))
    .toMatchObject({ yaw: 0.23, targetX: 0.3, targetZ: -0.2 });
});

test("flushes a previous user's pending camera before loading the next user", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem("matic-map-studio:v4:synthetic-next", JSON.stringify({
      version: 4, view: "top", appearance: "photo", labels: true, quality: "auto",
      cameras: { top: { yaw: -0.44, pitch: 1.1, zoom: 1.7, targetX: -0.8, targetZ: 0.6 } },
    }));
  });
  const fixture = await installPanelFixture(page);
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  await expect.poll(() => page.evaluate((tag) =>
    document.querySelector(tag)?.getWorkspaceSnapshot().map.available === true, fixture.panelTag)).toBe(true);
  await page.clock.runFor(1000);
  await page.evaluate((tag) => {
    const panel = document.querySelector(tag);
    const canvas = panel.shadowRoot.querySelector("matic-map-shell-v4").shadowRoot.querySelector("matic-map-canvas-v4");
    canvas.dispatchEvent(new CustomEvent("matic-workspace-intent", {
      bubbles: true,
      composed: true,
      detail: { type: "set-camera", view: "top", camera: { yaw: 0.36, pitch: 1.2, zoom: 1.2, targetX: 0.5, targetZ: -0.1 } },
    }));
    panel.hass = { ...panel.hass, user: { id: "synthetic-next", is_admin: true } };
    panel.requestUpdate();
  }, fixture.panelTag);
  await expect.poll(() => page.evaluate((tag) =>
    document.querySelector(tag)?.getWorkspaceSnapshot().owner?.userKey, fixture.panelTag)).toBe("synthetic-next");
  await page.clock.runFor(300);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("matic-map-studio:v4:synthetic-admin")).cameras.top))
    .toMatchObject({ yaw: 0.36, targetX: 0.5, targetZ: -0.1 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("matic-map-studio:v4:synthetic-next")).cameras.top))
    .toMatchObject({ yaw: -0.44, targetX: -0.8, targetZ: 0.6 });
});

test("history slider previews on input and loads only on settled change, including keyboard", async ({ page }) => {
  const module = await bundledModule(page, "interaction-bounds-workflow.js", `
    export { MaticMapWorkflowV4 } from "./frontend/map-studio-v4/workflow-panel";
    export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
  `);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (path) => {
    const { createGalleryState } = await import(path);
    const element = document.createElement("matic-map-workflow-v4");
    element.state = createGalleryState("history");
    element.addEventListener("matic-workspace-intent", (event) => {
      window.__historyIntents.push(event.detail);
    });
    window.__historyIntents = [];
    document.body.append(element);
  }, module);
  const slider = page.locator("matic-map-workflow-v4").locator('input[type="range"]');
  await expect(slider).toBeVisible();
  await slider.evaluate((input) => {
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(await page.evaluate(() => window.__historyIntents.length)).toBe(0);
  expect(await slider.getAttribute("aria-valuetext")).toContain("2026");
  await slider.evaluate((input) => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(await page.evaluate(() => window.__historyIntents)).toHaveLength(1);
  expect(await page.evaluate(() => window.__historyIntents[0])).toMatchObject({
    type: "set-history",
    historyId: expect.any(String),
  });

  await slider.focus();
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => window.__historyIntents)).toHaveLength(2);
});

test("normalizes only the four allowlisted Matic coverage guard service errors", async ({ page }) => {
  const module = await bundledModule(page, "interaction-bounds-backend.js", `
    export { MaticBackend } from "./frontend/map-studio-v4/backend";
  `);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async (path) => {
    const { MaticBackend } = await import(path);
    const keys = [
      "coverage_identity_unavailable",
      "coverage_activity_unavailable",
      "coverage_native_session_active",
      "coverage_identity_changed",
    ];
    const errors = [];
    const backend = new MaticBackend(() => ({ localize: (key) => `Localized ${key}`, callService: async () => {
      const key = keys[errors.length];
      throw Object.assign(new Error("secret arbitrary server text"), {
        translation_domain: "matic_robot", translation_key: key,
      });
    } }));
    for (const key of keys) {
      try { await backend.service("matic_robot", "run_selected_plan", {}, "vacuum.synthetic"); }
      catch (error) { errors.push({ code: error.code, message: error.message }); }
    }
    const malicious = new MaticBackend(() => ({ callService: async () => {
      throw Object.assign(new Error("secret arbitrary server text"), {
        translation_domain: "other_domain", translation_key: keys[0],
      });
    } }));
    let untrusted;
    try { await malicious.service("matic_robot", "run_selected_plan", {}, "vacuum.synthetic"); }
    catch (error) { untrusted = error.message; }
    backend.dispose();
    malicious.dispose();
    return { errors, untrusted };
  }, module);
  expect(result.errors.map(({ code }) => code)).toEqual([
    "coverage_identity_unavailable",
    "coverage_activity_unavailable",
    "coverage_native_session_active",
    "coverage_identity_changed",
  ]);
  expect(result.errors.map(({ message }) => message)).toEqual([
    "Localized component.matic_robot.exceptions.coverage_identity_unavailable.message",
    "Localized component.matic_robot.exceptions.coverage_activity_unavailable.message",
    "Localized component.matic_robot.exceptions.coverage_native_session_active.message",
    "Localized component.matic_robot.exceptions.coverage_identity_changed.message",
  ]);
  expect(result.untrusted).toBe("secret arbitrary server text");
});

test("keeps keyboard dismissal on the shell after unfocused Full map activation", async ({ page }) => {
  const module = await bundledModule(page, "interaction-bounds-shell-focus.js", `
    export { MaticMapShellV4 } from "./frontend/map-studio-v4/shell";
    export { WorkspaceStore } from "./frontend/map-studio-v4/state";
    export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
  `);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (path) => {
    const { WorkspaceStore, createGalleryState } = await import(path);
    const store = new WorkspaceStore(createGalleryState("ready"));
    const shell = document.createElement("matic-map-shell-v4");
    shell.state = store.value;
    shell.addEventListener("matic-workspace-intent", (event) => {
      store.dispatch(event.detail);
      shell.state = store.value;
    });
    window.__focusStore = store;
    document.body.append(shell);
  }, module);
  const shell = page.locator("matic-map-shell-v4");
  const toggle = shell.locator(".workspace-toggle");
  await expect(toggle).toHaveAccessibleName("Hide cleaning panel");
  await toggle.evaluate((button) => {
    document.activeElement instanceof HTMLElement && document.activeElement.blur();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__focusStore.value.fullMap)).toBe(true);
  await expect(toggle).toBeFocused();
  await toggle.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__focusStore.value.fullMap)).toBe(false);
  await expect(toggle).toBeFocused();
});

test("shows one saved-floor read-only explanation with the live-map recovery action", async ({ page }) => {
  const module = await bundledModule(page, "interaction-bounds-shell-history.js", `
    export { MaticMapShellV4 } from "./frontend/map-studio-v4/shell";
    export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
  `);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (path) => {
    const { createGalleryState } = await import(path);
    const shell = document.createElement("matic-map-shell-v4");
    const state = createGalleryState("ready");
    shell.state = {
      ...state,
      dataMode: "history",
      workflow: "none",
      floor: { ...state.floor, readOnly: true },
      selection: { ...state.selection, floorId: "saved-1", historyId: "saved-one" },
    };
    document.body.append(shell);
  }, module);
  const shell = page.locator("matic-map-shell-v4");
  await expect(shell.getByRole("heading", { name: "Saved map is read only" })).toHaveCount(1);
  await expect(shell.getByText("Cleaning is unavailable on a saved map", { exact: true })).toHaveCount(0);
  await expect(shell.getByText("Return to the live map to choose rooms, run a plan, or draw a custom area.", { exact: true })).toHaveCount(1);
});

test("outline state changes render in one Lit update", async ({ page }) => {
  const module = await bundledModule(page, "interaction-bounds-canvas.js", `
    export { MaticMapCanvasV4 } from "./frontend/map-studio-v4/map-canvas";
    export { createGalleryState } from "./frontend/map-studio-v4/gallery-state";
  `);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (path) => {
    const { createGalleryState } = await import(path);
    const element = document.createElement("matic-map-canvas-v4");
    element.state = createGalleryState("draw");
    document.body.append(element);
    await element.updateComplete;
    const requestUpdate = element.requestUpdate.bind(element);
    element.updateRequests = 0;
    element.requestUpdate = (...args) => {
      element.updateRequests += 1;
      return requestUpdate(...args);
    };
    element.state = { ...element.state, draw: { ...element.state.draw, brushMeters: element.state.draw.brushMeters + 0.1 } };
    await element.updateComplete;
    await element.updateComplete;
    window.__outlineUpdateRequests = element.updateRequests;
  }, module);
  expect(await page.evaluate(() => window.__outlineUpdateRequests)).toBe(1);
});
