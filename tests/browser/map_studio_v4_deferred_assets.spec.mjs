import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { installPanelFixture } from "./map_studio_v4_panel_fixture.mjs";

test("default Map Studio keeps the whole registered startup graph below 90 KiB", async ({ page }) => {
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  await page.evaluate(async () => {
    await import("/matic_icons.js");
    await import("/room-plan-editor-loader.js");
  });
  await page.evaluate(() => document.body.append(window.__panelFixture.createPanel()));
  await expect.poll(() => page.evaluate((tag) =>
    document.querySelector(tag)?.getWorkspaceSnapshot().map.available === true,
  fixture.panelTag)).toBe(true);

  const scriptResources = await page.evaluate(() => performance.getEntriesByType("resource")
    .map(({ name }) => name)
    .filter((name) => name.endsWith(".js") || name.includes(".js?")));
  expect(scriptResources.some((url) => url.includes("room-plan-editor.js"))).toBe(false);
  expect(scriptResources.some((url) => url.includes("matic_map_studio.js"))).toBe(false);
  const resources = scriptResources.filter((name) => name.includes("matic_icons.js")
      || name.includes("room-plan-editor-loader.js")
      || name.includes("/map_studio_v4/"));
  expect(resources.some((url) => url.includes("matic_icons.js"))).toBe(true);
  expect(resources.some((url) => url.includes("room-plan-editor-loader.js"))).toBe(true);
  expect(resources.some((url) => url.includes("/map_studio_v4/index.js"))).toBe(true);
  expect(resources.some((url) => url.includes("room-plan-editor.js"))).toBe(false);

  const sizes = await Promise.all(resources.map(async (url) => {
    const response = await page.request.get(url);
    expect(response.ok(), `could not read startup asset ${url}`).toBe(true);
    return gzipSync(await response.body(), { level: 9 }).byteLength;
  }));
  expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(90 * 1024);
});

test("configuration selectors defer implementation and preserve HA properties and editor state", async ({ page }) => {
  await page.goto("/");
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("room-plan-editor.js")) requests.push(request.url());
  });
  await page.evaluate(async () => {
    const room = document.createElement("ha-selector-matic-room-plan");
    room.hass = { locale: { language: "en" }, localize: (key) => key };
    room.selector = { rooms: [{ room_id: "kitchen", name: "Kitchen" }] };
    room.value = [{ room_id: "kitchen", cleaning_mode: "vacuum" }];
    room.disabled = true;
    room.required = true;
    window.__deferredRoomSelector = room;
    await import("/room-plan-editor-loader.js");
  });
  expect(requests).toHaveLength(0);
  await page.evaluate(() => document.body.append(window.__deferredRoomSelector));
  await expect.poll(() => requests.length).toBe(1);
  await expect.poll(() => page.evaluate(() =>
    window.__deferredRoomSelector.shadowRoot.querySelector("matic-room-plan-editor-impl")?.value?.[0]?.room_id,
  )).toBe("kitchen");
  expect(await page.evaluate(() => ({
    disabled: window.__deferredRoomSelector.shadowRoot.querySelector("matic-room-plan-editor-impl")._disabled,
    required: window.__deferredRoomSelector.shadowRoot.querySelector("matic-room-plan-editor-impl")._required,
    valid: window.__deferredRoomSelector.reportValidity(),
  }))).toEqual({ disabled: true, required: true, valid: true });

  expect(await page.evaluate(async () => {
    const area = document.createElement("ha-selector-matic-area");
    const requests = window.__areaPhotoRequests = [];
    area.hass = {
      locale: { language: "en" },
      localize: (key) => key,
      fetchWithAuth: (_url, { signal }) => new Promise((resolve) => requests.push({ signal, resolve })),
    };
    area.selector = { scene_url: "/api/matic_robot/slam_scene/synthetic", rooms: [] };
    area.value = [];
    area.disabled = true;
    area.required = true;
    document.body.append(area);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const implementation = area.shadowRoot.querySelector("matic-area-editor-impl");
    window.__areaImplementation = implementation;
    return {
      disabled: implementation._disabled,
      required: implementation._required,
      valid: area.reportValidity(),
      photoFetches: requests.length,
    };
  })).toEqual({ disabled: true, required: true, valid: false, photoFetches: 1 });

  await page.evaluate(() => {
    const area = document.querySelector("ha-selector-matic-area");
    const implementation = area.shadowRoot.querySelector("matic-area-editor-impl");
    implementation._viewBox = { x: 3, y: 4, width: 5, height: 6 };
    implementation.value = [{ x: 1, y: 2, radius: 0.3 }];
    area.remove();
    document.body.append(area);
  });
  await expect.poll(() => page.evaluate(() => window.__areaPhotoRequests.length)).toBe(2);
  expect(await page.evaluate(() => window.__areaPhotoRequests[0].signal.aborted)).toBe(true);
  await page.evaluate(() => window.__areaPhotoRequests[1].resolve({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
  await expect.poll(() => page.evaluate(() =>
    document.querySelector("ha-selector-matic-area").shadowRoot
      .querySelector("matic-area-editor-impl").shadowRoot
      .querySelector(".photo-status").dataset.state,
  )).toBe("unavailable");
  await page.evaluate(async () => {
    window.__areaPhotoRequests[0].resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => {
    const area = document.querySelector("ha-selector-matic-area");
    const implementation = area.shadowRoot.querySelector("matic-area-editor-impl");
    return {
      requestCount: window.__areaPhotoRequests.length,
      sameImplementation: implementation === window.__areaImplementation,
      viewBox: implementation._viewBox,
      radius: implementation.value[0].radius,
      photoStatus: implementation.shadowRoot.querySelector(".photo-status").dataset.state,
    };
  })).toMatchObject({
    requestCount: 2,
    sameImplementation: true,
    viewBox: { x: 3, y: 4, width: 5, height: 6 },
    radius: 0.3,
    photoStatus: "unavailable",
  });

  const forwardedEvents = await page.evaluate(() => {
    const wrapper = window.__deferredRoomSelector;
    let count = 0;
    wrapper.addEventListener("value-changed", (event) => {
      count += 1;
      if (!event.bubbles || !event.composed || event.detail?.value?.[0]?.room_id !== "office") {
        throw new Error("selector event did not retain its public contract");
      }
    });
    wrapper.shadowRoot.querySelector("matic-room-plan-editor-impl").dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: [{ room_id: "office" }] }, bubbles: true, composed: true,
      }),
    );
    return count;
  });
  expect(forwardedEvents).toBe(1);

  const originalChild = await page.evaluate(() => {
    const wrapper = window.__deferredRoomSelector;
    const child = wrapper.shadowRoot.querySelector("matic-room-plan-editor-impl");
    child.value = [{ room_id: "office", cleaning_mode: "mop" }];
    wrapper.remove();
    document.body.append(wrapper);
    return child === wrapper.shadowRoot.querySelector("matic-room-plan-editor-impl");
  });
  expect(originalChild).toBe(true);
  expect(await page.evaluate(() => window.__deferredRoomSelector.value[0].room_id)).toBe("office");
  expect(requests).toHaveLength(1);
});

test("selector retries share one import after a shared failure", async ({ page }) => {
  await page.goto("/");
  let firstRequestCount = 0;
  let retryRequestCount = 0;
  let releaseRetry;
  let notifyRetry;
  const retryStarted = new Promise((resolve) => { notifyRetry = resolve; });
  const retryReleased = new Promise((resolve) => { releaseRetry = resolve; });
  await page.route("**/room-plan-editor.js?load_attempt=**", async (route) => {
    const attempt = new URL(route.request().url()).searchParams.get("load_attempt");
    if (attempt === "1") {
      firstRequestCount += 1;
      await route.fulfill({ status: 503, contentType: "text/javascript", body: "unavailable" });
      return;
    }
    retryRequestCount += 1;
    notifyRetry();
    await retryReleased;
    await route.continue();
  });
  await page.evaluate(async () => {
    await import("/room-plan-editor-loader.js");
    const room = document.createElement("ha-selector-matic-room-plan");
    room.selector = { rooms: [] };
    const area = document.createElement("ha-selector-matic-area");
    area.selector = { scene_url: null, rooms: [] };
    document.body.append(room, area);
  });
  await expect(page.locator("[role=alert]")).toHaveCount(2);
  expect(firstRequestCount).toBe(1);

  await page.getByRole("button", { name: "Retry" }).nth(0).click();
  await retryStarted;
  await page.getByRole("button", { name: "Retry" }).nth(0).click();
  await page.waitForTimeout(50);
  expect(retryRequestCount).toBe(1);
  releaseRetry();
  await expect.poll(() => page.locator("matic-room-plan-editor-impl").count()).toBe(1);
  await expect.poll(() => page.locator("matic-area-editor-impl").count()).toBe(1);
  expect(retryRequestCount).toBe(1);
});

test("selector reconnect during a pending import mounts once with its latest properties", async ({ page }) => {
  await page.goto("/");
  let requestCount = 0;
  let releaseImport;
  let notifyRequest;
  const requestStarted = new Promise((resolve) => { notifyRequest = resolve; });
  const importReleased = new Promise((resolve) => { releaseImport = resolve; });
  await page.route("**/room-plan-editor.js?load_attempt=**", async (route) => {
    requestCount += 1;
    notifyRequest();
    await importReleased;
    await route.continue();
  });
  await page.evaluate(async () => {
    await import("/room-plan-editor-loader.js");
    const room = document.createElement("ha-selector-matic-room-plan");
    room.selector = { rooms: [{ room_id: "first", name: "First" }] };
    room.value = [{ room_id: "first" }];
    window.__pendingRoomSelector = room;
    document.body.append(room);
  });
  await requestStarted;
  await page.evaluate(() => {
    const room = window.__pendingRoomSelector;
    room.remove();
    room.selector = { rooms: [{ room_id: "latest", name: "Latest" }] };
    room.value = [{ room_id: "latest" }];
    room.disabled = true;
    document.body.append(room);
  });
  releaseImport();
  await expect.poll(() => page.evaluate(() => {
    const wrapper = window.__pendingRoomSelector;
    const implementations = wrapper.shadowRoot.querySelectorAll("matic-room-plan-editor-impl");
    return {
      count: implementations.length,
      roomId: implementations[0]?.value?.[0]?.room_id,
      disabled: implementations[0]?._disabled,
    };
  })).toEqual({ count: 1, roomId: "latest", disabled: true });
  expect(requestCount).toBe(1);
});

test("classic Map Studio loads only on selection, returns to v4, and retries a failed request", async ({ page }) => {
  await page.goto("/");
  const classicRequests = [];
  let shouldFail = true;
  await page.route("**/matic_map_studio.js?load_attempt=1", async (route) => {
    classicRequests.push(route.request().url());
    if (shouldFail) await route.abort();
    else await route.continue();
  });
  await page.route("**/matic_map_studio.js?load_attempt=2", (route) => {
    classicRequests.push(route.request().url());
    return route.continue();
  });
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  await page.evaluate((tag) => {
    const panel = window.__panelFixture.createPanel();
    panel.panel = { config: { classic_module_url: "/matic_map_studio.js" } };
    document.body.append(panel);
  }, fixture.panelTag);
  await expect.poll(() => page.evaluate(() =>
    document.querySelector(window.__panelFixture.panelTag)?.getWorkspaceSnapshot().map.available === true,
  )).toBe(true);
  expect(classicRequests).toHaveLength(0);

  await page.evaluate((tag) => {
    document.querySelector(tag).shadowRoot.querySelector("matic-map-shell-v4").dispatchEvent(new CustomEvent("matic-workspace-action", {
      detail: { id: "use-classic" }, bubbles: true, composed: true,
    }));
  }, fixture.panelTag);
  await expect(page.locator("[role=alert]")).toContainText("Classic map could not");
  expect(await page.evaluate((tag) => document.querySelector(tag)._classic, fixture.panelTag)).toBe(false);
  await page.getByRole("button", { name: "Retry" }).click();
  shouldFail = false;
  await expect.poll(() => page.evaluate((tag) => document.querySelector(tag)._classic, fixture.panelTag)).toBe(true);
  expect(classicRequests).toHaveLength(2);
  expect(new URL(classicRequests[0]).searchParams.get("load_attempt")).toBe("1");
  expect(new URL(classicRequests[1]).searchParams.get("load_attempt")).toBe("2");

  await page.getByRole("button", { name: "Use Map Studio" }).click();
  await expect.poll(() => page.evaluate((tag) => document.querySelector(tag)._classic, fixture.panelTag)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("matic-map-studio:preferred-frontend"))).toBe("v4");
});

test("saved classic preference restores the fallback and can return to v4", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("matic-map-studio:preferred-frontend", "v3"));
  await page.goto("/");
  const fixture = await installPanelFixture(page, { moduleSource: "packaged" });
  await page.evaluate((tag) => {
    const panel = window.__panelFixture.createPanel();
    panel.panel = { config: { classic_module_url: "/matic_map_studio.js" } };
    document.body.append(panel);
  }, fixture.panelTag);
  await expect.poll(() => page.evaluate((tag) => document.querySelector(tag)._classic, fixture.panelTag)).toBe(true);
  await page.getByRole("button", { name: "Use Map Studio" }).click();
  await expect.poll(() => page.evaluate((tag) => document.querySelector(tag)._classic, fixture.panelTag)).toBe(false);
});
