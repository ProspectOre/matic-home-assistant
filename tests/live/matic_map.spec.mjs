import { expect, test } from "./fixtures.mjs";

// Drives Matic Map in Home Assistant while tests/live/server.py plays the
// robot. Robot steps go through the simulator's control server.
const control = "http://127.0.0.1:8124";

async function step(request, name) {
  const response = await request.post(`${control}/step/${name}`);
  expect(response.ok()).toBe(true);
}

async function robotState(request) {
  const response = await request.get(`${control}/state`);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function expectReadyToClean(page, request) {
  await expect.poll(async () => (await robotState(request)).phase).toBe("docked");
  await expect(page.getByRole("button", { name: /Clean rooms/ })).toBeEnabled({
    timeout: 30_000,
  });
}

async function clearRoomSelection(page) {
  const panel = page.getByRole("complementary", { name: "Cleaning panel" });
  const clear = panel.getByRole("button", { name: "Clear", exact: true });
  if (await clear.isVisible()) await clear.click();
}

async function returnToTasksHome(page) {
  const back = page.getByRole("button", { name: "Back to all tasks" });
  if (await back.isVisible()) await back.click();
}

async function runHistory(page, entryId) {
  return page.evaluate(async (id) => {
    const token = Array.from(document.querySelectorAll("*"))
      .map((element) => element.hass?.auth?.accessToken ?? element.hass?.auth?.data?.access_token)
      .find((value) => typeof value === "string" && value.length > 0);
    const response = await fetch(`/api/matic_robot/runs/${encodeURIComponent(id)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await response.text();
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return { status: response.status, body: body.slice(0, 200) };
    }
    return { status: response.status, data };
  }, entryId);
}

async function workspaceState(page) {
  return page.evaluate(() => {
    const visit = (root) => {
      for (const element of root.querySelectorAll("*")) {
        if (typeof element.getWorkspaceSnapshot === "function") return element.getWorkspaceSnapshot();
        if (element.shadowRoot) {
          const value = visit(element.shadowRoot);
          if (value) return value;
        }
      }
      return null;
    };
    return visit(document);
  });
}

async function callWifiSurveyService(page, service) {
  return page.evaluate(async (name) => {
    const elements = [];
    const visit = (root) => {
      for (const element of root.querySelectorAll("*")) {
        elements.push(element);
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(document);
    const hass = elements.map((element) => element.hass).find((value) => value?.states && value?.auth);
    const token = hass?.auth?.accessToken ?? hass?.auth?.data?.access_token;
    const state = Object.entries(hass?.states ?? {}).find(([id, value]) =>
      id.startsWith("switch.") && /wi-?fi survey/i.test(`${value.attributes?.friendly_name ?? ""} ${id}`),
    );
    if (typeof token !== "string" || !state) return { status: 0, entityId: null };
    const response = await fetch(`/api/services/switch/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: state[0] }),
    });
    return { status: response.status, entityId: state[0] };
  }, service);
}

test("rooms chosen in Matic Map are cleaned and the run finishes", async ({ sharedPage: page, request }) => {
  await step(request, "hold_history");
  await page.goto("/matic-map");
  await expect(
    page.getByRole("complementary", { name: "Cleaning panel" }).getByText("Docked", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Clean rooms" }).click();
  await page.getByRole("checkbox", { name: "Kitchen" }).check();
  await page.getByRole("checkbox", { name: "Study" }).check();
  await page.getByRole("button", { name: "Clean 2 rooms" }).click();

  // The robot receives one coverage command and starts in the Kitchen.
  await expect.poll(async () => (await robotState(request)).phase).toBe("cleaning");
  const started = await robotState(request);
  expect(started.current_area).toBe("Kitchen");
  expect(started.commands.filter(({ channel }) => channel === "user_command")).toHaveLength(1);
  await expect(page.getByText("0 of 2 rooms completed · In Kitchen")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

  await step(request, "finish_room");
  await expect(page.getByText("In Study")).toBeVisible({ timeout: 30_000 });
  await step(request, "finish_room");
  await step(request, "finish_session");
  // The robot can finish before it publishes native history. Open history
  // while that update is held and verify it does not report success early.
  await page.getByRole("button", { name: "Back to all tasks" }).click();
  await page.getByRole("button", { name: /Cleaning history/ }).click();
  const history = page.locator("matic-run-history-v4");
  const latest = history.locator("section.run:not(.next)").first();
  const entryId = (await robotState(request)).entry_id;
  expect(entryId).toBeTruthy();
  const before = await runHistory(page, entryId);
  expect(before.status).toBe(200);
  const runBefore = before.data.runs.find(({ source, rooms }) =>
    source === "home_assistant" && rooms.some(({ name }) => name === "Kitchen")
      && rooms.some(({ name }) => name === "Study"),
  );
  expect(runBefore?.outcome).toBe("running");
  await expect(latest).toContainText("In progress");
  const pageMarker = await page.evaluate(() => {
    const value = `${Date.now()}-${Math.random()}`;
    window.__maticRunHistoryMarker = value;
    return value;
  });
  await step(request, "release_history");
  await step(request, "arrive_at_dock");
  await expect(
    page.getByRole("complementary", { name: "Cleaning panel" }).getByText("Docked", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const response = await runHistory(page, entryId);
    return response.data.runs.find(({ id }) => id === runBefore.id)?.outcome;
  }, { timeout: 30_000 }).toBe("finished");
  await expect(latest).toContainText("Finished", { timeout: 30_000 });
  await expect(latest).toContainText("Kitchen");
  await expect(latest).toContainText("Study");
  await expect(latest.locator("dd[data-done]")).toHaveCount(2);
  expect(await page.evaluate(() => window.__maticRunHistoryMarker)).toBe(pageMarker);
});

test("Go to room sends the docked robot to one room", async ({ sharedPage: page, request }) => {
  await returnToTasksHome(page);
  await expectReadyToClean(page, request);
  const panel = page.getByRole("complementary", { name: "Cleaning panel" });
  await panel.getByRole("button", { name: /Clean rooms/ }).click();
  await clearRoomSelection(page);
  const commandsBefore = (await robotState(request)).commands.filter(
    ({ channel }) => channel === "user_command",
  ).length;

  await page.getByRole("checkbox", { name: "Study" }).check();
  await page.getByRole("button", { name: "Go to room" }).click();

  await expect.poll(async () => (await robotState(request)).destination).toBe("Study");
  const state = await robotState(request);
  expect(state.current_area).toBe("Study");
  // The visit sends one new navigation command and starts no coverage task.
  expect(state.commands.filter(({ channel }) => channel === "user_command")).toHaveLength(
    commandsBefore + 1,
  );

  // Leave the shared robot docked for the next test.
  await step(request, "arrive_at_dock");
  await expect.poll(async () => (await robotState(request)).phase).toBe("docked");
  // Keep the live UI assertion scoped to its status panel; the responsive
  // shell also has a second, visually hidden copy of the robot status.
  await expect(
    page.getByRole("complementary", { name: "Cleaning panel" }).getByText("Docked", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await returnToTasksHome(page);
});

test("Skip in Change this clean drops a room from a clean started in Matic Map", async ({ sharedPage: page, request }) => {
  await returnToTasksHome(page);
  await expectReadyToClean(page, request);
  const panel = page.getByRole("complementary", { name: "Cleaning panel" });
  await panel.getByRole("button", { name: /Clean rooms/ }).click();
  await clearRoomSelection(page);
  await page.getByRole("checkbox", { name: "Kitchen" }).check();
  await page.getByRole("checkbox", { name: "Study" }).check();
  await page.getByRole("button", { name: "Clean 2 rooms" }).click();
  await expect.poll(async () => (await robotState(request)).phase).toBe("cleaning");
  expect((await robotState(request)).plan).toEqual(["Kitchen", "Study"]);
  await expect(page.getByText("0 of 2 rooms completed · In Kitchen")).toBeVisible();

  // Queue changes live on Home, the all-tasks view.
  await page.getByRole("button", { name: "Back to all tasks" }).click();
  const queue = page.getByRole("region", { name: "Change this clean" });
  await queue.getByLabel("Room").selectOption({ label: "Study" });
  await queue.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByLabel("Cleaning panel").getByText("Study skipped.")).toBeVisible({
    timeout: 30_000,
  });
  expect((await robotState(request)).plan).toEqual(["Kitchen"]);

  await step(request, "finish_room");
  await step(request, "finish_session");
  await step(request, "arrive_at_dock");
  await returnToTasksHome(page);
  await expectReadyToClean(page, request);
});

test("a custom area is drawn, saved and cleaned through Home Assistant", async ({ sharedPage: page, request }) => {
  await returnToTasksHome(page);
  const panel = page.getByRole("complementary", { name: "Cleaning panel" });
  await expectReadyToClean(page, request);
  await panel.getByRole("button", { name: /Clean custom area/ }).click();
  await panel.getByRole("button", { name: "New area", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Draw an area" })).toBeVisible();
  await page.getByRole("button", { name: "Paint", exact: true }).click();
  await page.getByRole("button", { name: "Fit the whole map on screen" }).click();
  // The simulator sends photo and structure collections over separate live
  // streams. Wait for the integration's normal completeness admission before
  // drawing; coordinate edits remain production-gated until both settle.
  await expect.poll(async () => (await workspaceState(page))?.map.complete, { timeout: 30_000 }).toBe(true);
  const map = page.getByRole("region", { name: "Interactive Matic 3D map" });
  await map.focus();
  await expect(map).toBeFocused();
  await map.press("Enter");
  await expect.poll(async () => (await workspaceState(page))?.draw.circles.length ?? 0).toBeGreaterThan(0);
  await panel.getByRole("button", { name: "Name and save", exact: true }).click();
  const name = panel.getByRole("textbox", { name: "Area name" });
  await expect(name).toBeVisible();
  await name.fill("E2E corner");
  await panel.getByRole("button", { name: "Save area", exact: true }).click();
  await expect(panel.getByText("Area saved", { exact: true })).toBeVisible({ timeout: 30_000 });

  const stateAfterSave = await workspaceState(page);
  const savedId = stateAfterSave.areaDraft.id;
  expect(savedId).toBe("e2e_corner");
  const areas = await page.evaluate(async ({ path }) => {
    const elements = Array.from(document.querySelectorAll("*"));
    const token = elements.map((element) => element.hass?.auth?.accessToken ?? element.hass?.auth?.data?.access_token)
      .find((value) => typeof value === "string" && value.length > 0);
    const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: response.status, data: await response.json() };
  }, { path: stateAfterSave.resources.entry.areasUrl });
  expect(areas.status).toBe(200);
  expect(areas.data.areas.find(({ id }) => id === savedId)).toMatchObject({ name: "E2E corner", status: "current" });
  expect((await workspaceState(page)).draw.circles.length).toBeGreaterThan(0);

  await panel.getByRole("button", { name: "Clean this area", exact: true }).click();
  await expect.poll(async () => (await robotState(request)).phase).toBe("cleaning");
  const started = await robotState(request);
  expect(started.current_area).toBe("Custom area");
  expect(started.plan).toEqual(["Custom area"]);
  await step(request, "finish_room");
  await expect.poll(async () => (await robotState(request)).phase).toBe("cleaning");
  await step(request, "finish_session");
  await expect.poll(async () => (await robotState(request)).phase).toBe("returning");
  const beforeDock = await robotState(request);
  expect(beforeDock.last_finished_session).toMatchObject({
    history_recorded: true,
    custom_area: true,
  });
  expect(beforeDock.last_finished_session.custom_area_circles).toHaveLength(1);
  expect(beforeDock.last_finished_session.custom_area_circles[0]).toHaveLength(3);
  await step(request, "arrive_at_dock");
  await expect.poll(async () => (await robotState(request)).phase).toBe("docked");
  const entryId = (await robotState(request)).entry_id;
  const customHistory = await runHistory(page, entryId);
  expect(customHistory.status).toBe(200);
  expect(customHistory.data.runs.some(({ source, outcome }) => source === "robot" && outcome === "finished")).toBe(true);

  await panel.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete area?" });
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(panel.getByRole("button", { name: "E2E corner", exact: false })).toHaveCount(0);
  await panel.getByRole("button", { name: "Back to all tasks" }).click();
});

test("the native schedule appears in Cleaning history", async ({ sharedPage: page, request }) => {
  await returnToTasksHome(page);
  const panel = page.getByRole("complementary", { name: "Cleaning panel" });
  await expectReadyToClean(page, request);
  await panel.getByRole("button", { name: /Cleaning history/ }).click();
  const history = page.locator("matic-run-history-v4");
  const next = history.getByRole("region", { name: "Next scheduled clean" });
  await expect(next).toContainText("Live schedule sample", { timeout: 30_000 });
  await expect(next).toContainText("Set in the Matic app");
});

test("the Wi-Fi signal layer reads a real survey cell and follows its switch", async ({ sharedPage: page, request }) => {
  await returnToTasksHome(page);
  const panel = page.getByRole("complementary", { name: "Cleaning panel" });
  await expectReadyToClean(page, request);
  await page.getByRole("button", { name: "Map options" }).click();
  const menu = page.getByRole("menu", { name: "Map options" });
  const wifi = menu.getByRole("menuitemcheckbox", { name: /Wi-Fi signal/ });
  await expect(wifi).toBeVisible();
  await wifi.click();
  await expect(wifi).toHaveAttribute("aria-checked", "true");
  await expect(wifi).toContainText("Turn on Wi-Fi survey in the robot's settings");

  const enabled = await callWifiSurveyService(page, "turn_on");
  expect(enabled.status).toBe(200);
  expect(enabled.entityId).toBeTruthy();
  await page.getByRole("button", { name: "Map options" }).click();
  await panel.getByRole("button", { name: "Clean rooms", exact: false }).click();
  await clearRoomSelection(page);
  await panel.getByRole("checkbox", { name: "Kitchen" }).check();
  await page.getByRole("button", { name: "Clean 1 room", exact: true }).click();
  await step(request, "queue_wifi_sample");
  await expect.poll(async () => (await robotState(request)).phase).toBe("cleaning");

  const heatmapUrl = (await workspaceState(page)).resources.entry.wifiHeatmapUrl;
  await expect.poll(async () => {
    const payload = await page.evaluate(async (path) => {
      const elements = Array.from(document.querySelectorAll("*"));
      const token = elements.map((element) => element.hass?.auth?.accessToken ?? element.hass?.auth?.data?.access_token)
        .find((value) => typeof value === "string" && value.length > 0);
      const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      return response.json();
    }, heatmapUrl);
    return payload.cells.length;
  }, { timeout: 15_000 }).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Map options" }).click();
  const updatedWifi = page.getByRole("menu", { name: "Map options" }).getByRole("menuitemcheckbox", { name: /Wi-Fi signal/ });
  await updatedWifi.click();
  await updatedWifi.click();
  await expect(updatedWifi).toHaveAttribute("aria-checked", "true");
  await expect(updatedWifi).toContainText("Green is strong, red is weak");
  expect((await workspaceState(page)).wifiSignal.cells.length).toBeGreaterThan(0);

  await step(request, "finish_room");
  await step(request, "finish_session");
  await step(request, "arrive_at_dock");
  await page.getByRole("button", { name: "Back to all tasks" }).click();
  await expectReadyToClean(page, request);
  const disabled = await callWifiSurveyService(page, "turn_off");
  expect(disabled.status).toBe(200);
});
