import { appendFile } from "node:fs/promises";
import { expect, test as baseTest } from "./fixtures.mjs";

const test = baseTest.extend({
  workspacePushMode: ["off", { option: true }],
  workspacePush: async ({ request, workspacePushMode }, use, testInfo) => {
    const project = testInfo.project.use;
    const port = Number(new URL(project.baseURL).port);
    const controlURL = `http://127.0.0.1:${port + 1}`;
    await use({
      mode: workspacePushMode,
      step: async (name) => {
        const response = await request.post(`${controlURL}/step/${name}`);
        expect(response.ok()).toBe(true);
      },
      state: async () => {
        const response = await request.get(`${controlURL}/state`);
        expect(response.ok()).toBe(true);
        return response.json();
      },
    });
  },
});

// Drives Matic Map in Home Assistant while the live harness plays the robot.
async function step(robot, name) {
  await robot.step(name);
}

async function robotState(robot) {
  return robot.state();
}

async function expectReadyToClean(page, robot) {
  await expect.poll(async () => (await robotState(robot)).phase).toBe("docked");
  const clean = page.getByRole("button", { name: /Clean rooms/ });
  await expect.poll(async () => {
    const state = await workspaceState(page);
    const ready = await clean.isEnabled();
    if (ready) return "ready";
    return JSON.stringify({
      enabled: ready,
      workspace: state && {
        host: state.host,
        activity: state.activity,
        coherence: state.coherence,
        command: state.command,
        smartStop: state.smartStop,
        map: state.map,
        floor: state.floor,
        entry: state.resources.entry && {
          activePlan: state.resources.entry.activePlan,
          activePlanProjection: state.resources.entry.activePlan,
          runnerLocked: state.resources.entry.runnerLocked,
          stopSettlePending: state.resources.entry.stopSettlePending,
          nativeSessionActive: state.resources.entry.nativeSessionActive,
          nativeReconciliationPending: state.resources.entry.nativeReconciliationPending,
          mapFloorCoherent: state.resources.entry.mapFloorCoherent,
          mapSessionVerified: state.resources.entry.mapSessionVerified,
        },
        lastRun: state.lastRun && {
          runId: state.lastRun.runId,
          outcome: state.lastRun.outcome,
          completedRoomCount: state.lastRun.completedRoomCount,
          roomCount: state.lastRun.roomCount,
        },
        disabledReason: await clean.evaluate((button) => {
          const id = button.getAttribute("aria-describedby")?.split(/\s+/u)[0];
          if (!id) return null;
          const root = button.getRootNode();
          return root.querySelector(`#${CSS.escape(id)}`)?.textContent?.trim() ?? null;
        }),
      },
    });
  }, {
    timeout: 30_000,
  }).toBe("ready");
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

async function captureNativeOwnership(page, robot, testInfo, label) {
  const simulator = await robotState(robot);
  const workspace = await workspaceState(page);
  const entry = workspace?.resources?.entry;
  const capture = {
    label,
    simulator: {
      phase: simulator.phase,
      currentArea: simulator.current_area,
      plan: simulator.plan,
      lastFinishedSession: simulator.last_finished_session && {
        historyRecorded: simulator.last_finished_session.history_recorded,
        completed: simulator.last_finished_session.completed,
        rooms: simulator.last_finished_session.rooms,
      },
      identityTrace: simulator.identity_trace.slice(-24),
    },
    coordinator: simulator.coordinator_trace.slice(-32),
    publishedWorkspace: workspace && {
      generation: workspace.generation,
      hostConnected: workspace.host?.connected,
      activity: workspace.activity,
      coherence: workspace.coherence,
      command: workspace.command,
      nativeSessionActive: entry?.nativeSessionActive,
      activePlan: entry?.activePlan,
      runnerLocked: entry?.runnerLocked,
      stopSettlePending: entry?.stopSettlePending,
      lastRun: workspace.lastRun && {
        outcome: workspace.lastRun.outcome,
        completedRoomCount: workspace.lastRun.completedRoomCount,
        roomCount: workspace.lastRun.roomCount,
      },
    },
  };
  await testInfo.attach(`native-session-${label}.json`, {
    body: JSON.stringify(capture, null, 2),
    contentType: "application/json",
  });
  const tracePath = process.env.MATIC_LIVE_TRACE_PATH;
  if (tracePath) {
    await appendFile(tracePath, `${JSON.stringify(capture)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

async function workspaceDiagnostics(page) {
  return page.evaluate(() => {
    const visit = (root) => {
      for (const element of root.querySelectorAll("*")) {
        if (typeof element.getRequestDiagnostics === "function") {
          return element.getRequestDiagnostics();
        }
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

function observeWorkspaceFrames(page) {
  const counts = {
    snapshots: 0,
    subscriptions: 0,
    workspaceSocketClosures: 0,
    homeAssistantSocketClosures: 0,
  };
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/api/websocket") {
      socket.on("close", () => counts.homeAssistantSocketClosures += 1);
    }
    let carriedWorkspaceRequest = false;
    socket.on("framesent", ({ payload }) => {
      let message;
      if (typeof payload === "string") {
        try {
          message = JSON.parse(payload);
        } catch {
          return;
        }
      } else if (payload && typeof payload === "object") {
        message = payload;
      }
      if (message.type === "matic_robot/workspace_snapshot") {
        counts.snapshots += 1;
        carriedWorkspaceRequest = true;
      } else if (message.type === "matic_robot/workspace_subscribe") {
        counts.subscriptions += 1;
        carriedWorkspaceRequest = true;
      }
    });
    socket.on("close", () => {
      if (carriedWorkspaceRequest) counts.workspaceSocketClosures += 1;
    });
  });
  return counts;
}

async function workspacePushEvidence(page, entryId) {
  try {
    return await page.evaluate(async (id) => {
      const visit = (root) => {
        for (const element of root.querySelectorAll("*")) {
          if (typeof element.getRequestDiagnostics === "function") return element;
          if (element.shadowRoot) {
            const value = visit(element.shadowRoot);
            if (value) return value;
          }
        }
        return null;
      };
      const panel = visit(document);
      if (!panel) return { status: 0, entry: null, diagnostics: null, capabilities: null };
      const hass = panel.hass;
      const token = hass?.auth?.accessToken ?? hass?.auth?.data?.access_token;
      const response = await fetch("/api/matic_robot/slam_entries", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const catalog = await response.json();
      const entry = catalog.entries?.find((candidate) => candidate.entry_id === id) ?? null;
      const workspaceRpcCounts = window.__maticWorkspaceRpcCounts ?? null;
      let capabilities = null;
      if (entry?.live_workspace_transport_enabled === true) {
        const snapshot = await hass.connection.sendMessagePromise({
          type: "matic_robot/workspace_snapshot",
          version: 1,
          entry_id: id,
        });
        capabilities = snapshot.capabilities;
      }
      return {
        status: response.status,
        entry,
        capabilityPresent: Object.hasOwn(entry ?? {}, "live_workspace_transport_enabled"),
        workspaceRpcCounts,
        diagnostics: panel.getRequestDiagnostics(),
        capabilities,
      };
    }, entryId);
  } catch (error) {
    // HA can redirect/reload while the page is attaching its authenticated
    // connection. Treat only Playwright's navigation-context errors as a
    // transient missing observation so expect.poll can retry; surface auth,
    // API, and closed-browser failures unchanged.
    const message = error instanceof Error ? error.message : String(error);
    if (/Execution context was destroyed|Cannot find context with specified id/u.test(message)) {
      return { status: 0, entry: null, diagnostics: null, capabilities: null };
    }
    throw error;
  }
}

async function expectWorkspacePushMode(page, robot) {
  const entryId = (await robotState(robot)).entry_id;
  const enabled = robot.mode === "on";
  await expect(page.getByRole("heading", { name: "Matic Map", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const result = await workspacePushEvidence(page, entryId);
    return result.status === 200
      && (enabled
        ? result.entry?.live_workspace_transport_enabled === true
        : result.capabilityPresent === false)
      && (enabled
        ? result.capabilities?.subscription === 1
          && result.diagnostics?.workspace?.snapshotAttempts?.completed > 0
          && result.diagnostics.workspace.snapshotAttempts.failed === 0
          && result.diagnostics.workspace.activeRecovery === null
          && result.workspaceRpcCounts?.snapshot > 0
          && result.workspaceRpcCounts?.subscribe > 0
        : result.diagnostics?.workspace === null
          && result.workspaceRpcCounts?.snapshot === 0
          && result.workspaceRpcCounts?.subscribe === 0);
  }, { timeout: 30_000 }).toBe(true);
  const result = await workspacePushEvidence(page, entryId);
  if (enabled) expect(result.entry.live_workspace_transport_enabled).toBe(true);
  else expect(result.capabilityPresent).toBe(false);
  if (enabled) {
    expect(result.capabilities.subscription).toBe(1);
    expect(result.diagnostics.workspace.snapshotAttempts.completed).toBeGreaterThan(0);
    expect(result.diagnostics.workspace.snapshotAttempts.failed).toBe(0);
    expect(result.diagnostics.workspace.activeRecovery).toBeNull();
    expect(result.workspaceRpcCounts.snapshot).toBeGreaterThan(0);
    expect(result.workspaceRpcCounts.subscribe).toBeGreaterThan(0);
  } else {
    expect(result.diagnostics.workspace).toBeNull();
    expect(result.workspaceRpcCounts).toEqual({ snapshot: 0, subscribe: 0 });
  }
}

test.beforeEach(async ({ sharedPage: page, workspacePush: robot }) => {
  if (page.url() !== "about:blank") return expectWorkspacePushMode(page, robot);
  await page.addInitScript(() => {
    const counts = { snapshot: 0, subscribe: 0 };
    window.__maticWorkspaceRpcCounts = counts;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") {
        try {
          const message = JSON.parse(data);
          if (message.type === "matic_robot/workspace_snapshot") counts.snapshot += 1;
          if (message.type === "matic_robot/workspace_subscribe") counts.subscribe += 1;
        } catch { /* non-JSON websocket payload */ }
      }
      return send.call(this, data);
    };
  });
});

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

test("rooms chosen in Matic Map are cleaned and the run finishes", async ({ sharedPage: page, workspacePush: robot }, testInfo) => {
  await step(robot, "hold_history");
  await page.goto("/matic-map");
  await expectWorkspacePushMode(page, robot);
  await expect(
    page.getByRole("complementary", { name: "Cleaning panel" }).getByText("Docked", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await captureNativeOwnership(page, robot, testInfo, "initial-docked");

  await page.getByRole("button", { name: "Clean rooms" }).click();
  await page.getByRole("checkbox", { name: "Kitchen" }).check();
  await page.getByRole("checkbox", { name: "Study" }).check();
  await page.getByRole("button", { name: "Clean 2 rooms" }).click();

  // The robot receives one coverage command and starts in the Kitchen.
  await expect.poll(async () => (await robotState(robot)).phase).toBe("cleaning");
  const started = await robotState(robot);
  expect(started.current_area).toBe("Kitchen");
  expect(started.commands.filter(({ channel }) => channel === "user_command")).toHaveLength(1);
  await captureNativeOwnership(page, robot, testInfo, "first-command-cleaning");
  await expect(page.getByText("0 of 2 rooms completed · In Kitchen")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

  await step(robot, "finish_room");
  await expect(page.getByText("In Study")).toBeVisible({ timeout: 30_000 });
  await captureNativeOwnership(page, robot, testInfo, "first-room-finished");
  await step(robot, "finish_room");
  await captureNativeOwnership(page, robot, testInfo, "second-room-finished");
  await step(robot, "finish_session");
  await captureNativeOwnership(page, robot, testInfo, "session-finished-history-held");
  // The robot can finish before it publishes native history. Open history
  // while that update is held and verify it does not report success early.
  await page.getByRole("button", { name: "Back to all tasks" }).click();
  await page.getByRole("button", { name: /Cleaning history/ }).click();
  const history = page.locator("matic-run-history-v4");
  const latest = history.locator("section.run:not(.next)").first();
  const entryId = (await robotState(robot)).entry_id;
  expect(entryId).toBeTruthy();
  const before = await runHistory(page, entryId);
  expect(before.status).toBe(200);
  const runBefore = before.data.runs.find(({ source, rooms }) =>
    source === "home_assistant" && rooms.some(({ name }) => name === "Kitchen")
      && rooms.some(({ name }) => name === "Study"),
  );
  await captureNativeOwnership(page, robot, testInfo, "held-history-run-observation");
  expect(runBefore?.outcome).toBe("running");
  await expect(latest).toContainText("In progress");
  const pageMarker = await page.evaluate(() => {
    const value = `${Date.now()}-${Math.random()}`;
    window.__maticRunHistoryMarker = value;
    return value;
  });
  await step(robot, "release_history");
  await captureNativeOwnership(page, robot, testInfo, "released-history");
  await step(robot, "arrive_at_dock");
  await captureNativeOwnership(page, robot, testInfo, "arrived-at-dock");
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

test("Go to room sends the docked robot to one room", async ({ sharedPage: page, workspacePush: robot }) => {
  await returnToTasksHome(page);
  await expectReadyToClean(page, robot);
  const panel = page.getByRole("complementary", { name: "Cleaning panel" });
  await panel.getByRole("button", { name: /Clean rooms/ }).click();
  await clearRoomSelection(page);
  const commandsBefore = (await robotState(robot)).commands.filter(
    ({ channel }) => channel === "user_command",
  ).length;

  await page.getByRole("checkbox", { name: "Study" }).check();
  await page.getByRole("button", { name: "Go to room" }).click();

  await expect.poll(async () => (await robotState(robot)).destination).toBe("Study");
  const state = await robotState(robot);
  expect(state.current_area).toBe("Study");
  // The visit sends one new navigation command and starts no coverage task.
  expect(state.commands.filter(({ channel }) => channel === "user_command")).toHaveLength(
    commandsBefore + 1,
  );

  // Leave the shared robot docked for the next test.
  await step(robot, "arrive_at_dock");
  await expect.poll(async () => (await robotState(robot)).phase).toBe("docked");
  // Keep the live UI assertion scoped to its status panel; the responsive
  // shell also has a second, visually hidden copy of the robot status.
  await expect(
    page.getByRole("complementary", { name: "Cleaning panel" }).getByText("Docked", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await returnToTasksHome(page);
});

test("Skip in Change this clean drops a room from a clean started in Matic Map", async ({ sharedPage: page, workspacePush: robot }) => {
  await returnToTasksHome(page);
  await expectReadyToClean(page, robot);
  const panel = page.getByRole("complementary", { name: "Cleaning panel" });
  await panel.getByRole("button", { name: /Clean rooms/ }).click();
  await clearRoomSelection(page);
  await page.getByRole("checkbox", { name: "Kitchen" }).check();
  await page.getByRole("checkbox", { name: "Study" }).check();
  await page.getByRole("button", { name: "Clean 2 rooms" }).click();
  await expect.poll(async () => (await robotState(robot)).phase).toBe("cleaning");
  expect((await robotState(robot)).plan).toEqual(["Kitchen", "Study"]);
  await expect(page.getByText("0 of 2 rooms completed · In Kitchen")).toBeVisible();

  // Queue changes live on Home, the all-tasks view.
  await page.getByRole("button", { name: "Back to all tasks" }).click();
  const queue = page.getByRole("region", { name: "Change this clean" });
  await queue.getByLabel("Room").selectOption({ label: "Study" });
  await queue.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByLabel("Cleaning panel").getByText("Study skipped.")).toBeVisible({
    timeout: 30_000,
  });
  expect((await robotState(robot)).plan).toEqual(["Kitchen"]);

  await step(robot, "finish_room");
  await step(robot, "finish_session");
  await step(robot, "arrive_at_dock");
  await returnToTasksHome(page);
  await expectReadyToClean(page, robot);
});

test("a custom area is drawn, saved and cleaned through Home Assistant", async ({ sharedPage: page, workspacePush: robot }) => {
  await returnToTasksHome(page);
  const panel = page.getByRole("complementary", { name: "Cleaning panel" });
  await expectReadyToClean(page, robot);
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
  await expect.poll(async () => (await robotState(robot)).phase).toBe("cleaning");
  const started = await robotState(robot);
  expect(started.current_area).toBe("Custom area");
  expect(started.plan).toEqual(["Custom area"]);
  await step(robot, "finish_room");
  await expect.poll(async () => (await robotState(robot)).phase).toBe("cleaning");
  await step(robot, "finish_session");
  await expect.poll(async () => (await robotState(robot)).phase).toBe("returning");
  const beforeDock = await robotState(robot);
  expect(beforeDock.last_finished_session).toMatchObject({
    history_recorded: true,
    custom_area: true,
  });
  expect(beforeDock.last_finished_session.custom_area_circles).toHaveLength(1);
  expect(beforeDock.last_finished_session.custom_area_circles[0]).toHaveLength(3);
  await step(robot, "arrive_at_dock");
  await expect.poll(async () => (await robotState(robot)).phase).toBe("docked");
  const entryId = (await robotState(robot)).entry_id;
  const customHistory = await runHistory(page, entryId);
  expect(customHistory.status).toBe(200);
  expect(customHistory.data.runs.some(({ source, outcome }) => source === "robot" && outcome === "finished")).toBe(true);

  await panel.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete area?" });
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(panel.getByRole("button", { name: "E2E corner", exact: false })).toHaveCount(0);
  await panel.getByRole("button", { name: "Back to all tasks" }).click();
});

test("the native schedule appears in Cleaning history", async ({ sharedPage: page, workspacePush: robot }) => {
  await returnToTasksHome(page);
  const panel = page.getByRole("complementary", { name: "Cleaning panel" });
  await expectReadyToClean(page, robot);
  await panel.getByRole("button", { name: /Cleaning history/ }).click();
  const history = page.locator("matic-run-history-v4");
  const next = history.getByRole("region", { name: "Next scheduled clean" });
  await expect(next).toContainText("Live schedule sample", { timeout: 30_000 });
  await expect(next).toContainText("Set in the Matic app");
});

test("the Wi-Fi signal layer reads a real survey cell and follows its switch", async ({ sharedPage: page, workspacePush: robot }) => {
  await returnToTasksHome(page);
  const panel = page.getByRole("complementary", { name: "Cleaning panel" });
  await expectReadyToClean(page, robot);
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
  await step(robot, "queue_wifi_sample");
  await expect.poll(async () => (await robotState(robot)).phase).toBe("cleaning");

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
  await expect(updatedWifi).toContainText("Approximate samples: green strong, red weak");
  expect((await workspaceState(page)).wifiSignal.cells.length).toBeGreaterThan(0);

  await step(robot, "finish_room");
  await step(robot, "finish_session");
  await step(robot, "arrive_at_dock");
  await page.getByRole("button", { name: "Back to all tasks" }).click();
  await expectReadyToClean(page, robot);
  const disabled = await callWifiSurveyService(page, "turn_off");
  expect(disabled.status).toBe(200);
});

test("Home Assistant reconnect restores fresh robot state without replaying commands", async ({ sharedPage: page, workspacePush: robot }) => {
  const workspaceFrames = observeWorkspaceFrames(page);
  const homeAssistantTransport = { opened: 0, current: null };
  await page.routeWebSocket((url) => url.pathname === "/api/websocket", (route) => {
    const server = route.connectToServer();
    homeAssistantTransport.opened += 1;
    homeAssistantTransport.current = server;
  });
  await page.reload();
  await returnToTasksHome(page);
  await expectReadyToClean(page, robot);
  await expect.poll(() => homeAssistantTransport.opened).toBeGreaterThan(0);
  const initial = await robotState(robot);
  const commandCount = initial.commands.length;
  if (robot.mode === "on") {
    await expect.poll(() => workspaceFrames.snapshots).toBeGreaterThan(0);
    await expect.poll(() => workspaceFrames.subscriptions).toBeGreaterThan(0);
  } else {
    expect(workspaceFrames.snapshots).toBe(0);
    expect(workspaceFrames.subscriptions).toBe(0);
  }
  await expectWorkspacePushMode(page, robot);
  const snapshotsBeforeDisconnect = workspaceFrames.snapshots;
  const closuresBeforeDisconnect = workspaceFrames.workspaceSocketClosures;
  const homeAssistantClosuresBeforeDisconnect = workspaceFrames.homeAssistantSocketClosures;

  let homeAssistantSocketsBeforeFinalReconnect = null;
  try {
    await page.context().setOffline(true);
    const clean = page.getByRole("complementary", { name: "Cleaning panel" })
      .getByRole("button", { name: /Clean rooms/ });
    const firstSocket = homeAssistantTransport.current;
    expect(firstSocket).toBeTruthy();
    // Chromium's offline emulation blocks fetches but keeps established sockets
    // open. Close the routed server side while offline to test HA's actual
    // disconnect/reconnect handling rather than treating lost fetches as a drop.
    await firstSocket.close({ code: 3000, reason: "test-owned offline interruption" });
    await expect.poll(() => workspaceFrames.homeAssistantSocketClosures)
      .toBeGreaterThan(homeAssistantClosuresBeforeDisconnect);
    await expect.poll(async () => (await workspaceState(page))?.host.connected, {
      timeout: 30_000,
    }).toBe(false);
    await expect.poll(async () => !(await clean.isVisible()) || await clean.isDisabled())
      .toBe(true);

    if (robot.mode === "on") {
      await expect.poll(() => workspaceFrames.workspaceSocketClosures, {
        timeout: 30_000,
      }).toBeGreaterThan(closuresBeforeDisconnect);
    }

    // The independent loopback control API still reaches the simulator while
    // the browser is offline. This changes reported state without a robot command.
    await step(robot, "move_reported_area");
    await expect.poll(async () => (await robotState(robot)).current_area).toBe("Study");
    expect((await robotState(robot)).commands).toHaveLength(commandCount);

    const homeAssistantSocketsBeforeReconnect = homeAssistantTransport.opened;
    await page.context().setOffline(false);
    await expect.poll(() => homeAssistantTransport.opened, { timeout: 30_000 })
      .toBeGreaterThan(homeAssistantSocketsBeforeReconnect);
    await expect.poll(async () => (await workspaceState(page))?.host.connected, {
      timeout: 30_000,
    }).toBe(true);
    await expect.poll(async () => (await workspaceState(page))?.currentArea).toBe("Study");

    if (robot.mode === "on") {
      await expect.poll(async () => {
        const diagnostics = (await workspaceDiagnostics(page))?.workspace;
        return diagnostics?.activeRecovery === null
          && diagnostics.snapshotAttempts.completed >= 1;
      }, { timeout: 30_000 }).toBe(true);
      await expect.poll(() => workspaceFrames.snapshots, {
        timeout: 30_000,
      }).toBeGreaterThan(snapshotsBeforeDisconnect);
    }

    // Enter a dirty, unsaved area draft locally, then verify its write gate
    // closes during a second real browser network outage.
    await page.getByRole("button", { name: /Clean custom area/ }).click();
    await page.getByRole("button", { name: "New area", exact: true }).click();
    await page.getByRole("button", { name: "Paint", exact: true }).click();
    await page.getByRole("button", { name: "Fit the whole map on screen" }).click();
    await expect.poll(async () => (await workspaceState(page))?.map.complete, {
      timeout: 30_000,
    }).toBe(true);
    const map = page.getByRole("region", { name: "Interactive Matic 3D map" });
    await map.focus();
    await map.press("Enter");
    await expect.poll(async () => (await workspaceState(page))?.draw.circles.length ?? 0)
      .toBeGreaterThan(0);
    const panel = page.getByRole("complementary", { name: "Cleaning panel" });
    await panel.getByRole("button", { name: "Name and save", exact: true }).click();
    await panel.getByRole("textbox", { name: "Area name" }).fill("Reconnect guard draft");
    await expect(panel.getByRole("button", { name: "Save area", exact: true })).toBeEnabled();

    const homeAssistantClosuresBeforeSecondDisconnect = workspaceFrames.homeAssistantSocketClosures;
    const workspaceClosuresBeforeSecondDisconnect = workspaceFrames.workspaceSocketClosures;
    await page.context().setOffline(true);
    const save = panel.getByRole("button", { name: "Save area", exact: true });
    const secondSocket = homeAssistantTransport.current;
    expect(secondSocket).toBeTruthy();
    homeAssistantSocketsBeforeFinalReconnect = homeAssistantTransport.opened;
    await secondSocket.close({ code: 3000, reason: "test-owned offline interruption" });
    await expect.poll(() => workspaceFrames.homeAssistantSocketClosures)
      .toBeGreaterThan(homeAssistantClosuresBeforeSecondDisconnect);
    if (robot.mode === "on") {
      await expect.poll(() => workspaceFrames.workspaceSocketClosures)
        .toBeGreaterThan(workspaceClosuresBeforeSecondDisconnect);
    }
    await expect.poll(async () => (await workspaceState(page))?.host.connected, {
      timeout: 30_000,
    }).toBe(false);
    await expect.poll(async () => !(await save.isVisible()) || await save.isDisabled())
      .toBe(true);
    expect((await robotState(robot)).commands).toHaveLength(commandCount);
  } finally {
    await page.context().setOffline(false);
    if (homeAssistantSocketsBeforeFinalReconnect !== null) {
      await expect.poll(() => homeAssistantTransport.opened, { timeout: 30_000 })
        .toBeGreaterThan(homeAssistantSocketsBeforeFinalReconnect);
    }
    await step(robot, "arrive_at_dock");
    await expect.poll(async () => (await robotState(robot)).phase).toBe("docked");
    await expect.poll(async () => (await workspaceState(page))?.host.connected, {
      timeout: 30_000,
    }).toBe(true);
    expect((await robotState(robot)).commands).toHaveLength(commandCount);
  }
});
