import { expect, test } from "@playwright/test";

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

test("rooms chosen in Matic Map are cleaned and the run finishes", async ({ page, request }) => {
  await page.goto("/matic-map");
  await expect(page.getByText("Docked").first()).toBeVisible();

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
  await step(request, "arrive_at_dock");
  await expect(page.getByText("Docked").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Clean 2 rooms" })).toBeEnabled();
});

test("Go to room sends the docked robot to one room", async ({ page, request }) => {
  await page.goto("/matic-map");
  await expect(page.getByText("Docked").first()).toBeVisible();

  await page.getByRole("button", { name: "Clean rooms" }).click();
  await page.getByRole("checkbox", { name: "Study" }).check();
  await page.getByRole("button", { name: "Go to room" }).click();

  await expect.poll(async () => (await robotState(request)).destination).toBe("Study");
  const state = await robotState(request);
  expect(state.current_area).toBe("Study");
  // A visit starts no task, so no coverage command follows the first test's.
  expect(state.commands.filter(({ channel }) => channel === "user_command")).toHaveLength(2);

  // Leave the shared robot docked for the next test.
  await step(request, "arrive_at_dock");
  await expect(page.getByText("Docked").first()).toBeVisible({ timeout: 30_000 });
});

test("Skip in Change this clean drops a room from a running clean", async ({ page, request }) => {
  await page.goto("/matic-map");
  await expect(page.getByText("Docked").first()).toBeVisible();
  // Started as an automation would. A clean started from Matic Map keeps its
  // queue buttons disabled until the run ends; that is reported separately.
  await page.evaluate(() => {
    const hass = document.querySelector("home-assistant").hass;
    void hass.callService("matic_robot", "clean_room_sequence", {
      entity_id: "vacuum.simulated_matic",
      rooms: [{ room: "Kitchen" }, { room: "Study" }],
    });
  });
  await expect.poll(async () => (await robotState(request)).phase).toBe("cleaning");
  expect((await robotState(request)).plan).toEqual(["Kitchen", "Study"]);

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
  await expect(page.getByText("Docked").first()).toBeVisible({ timeout: 30_000 });
});
