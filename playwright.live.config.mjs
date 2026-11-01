import { defineConfig, devices } from "@playwright/test";

const python = process.env.MATIC_E2E_PYTHON ?? process.env.PYTHON ?? "python";
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const requestedPushMode = process.env.MATIC_LIVE_WORKSPACE_PUSH ?? "off";
const pairedPushMode = requestedPushMode === "paired";
const pushModes = pairedPushMode
  ? ["off", "on"]
  : [requestedPushMode === "on" ? "on" : "off"];
const instances = pushModes.map((mode, index) => ({
  mode,
  port: index === 0 ? 8123 : 8125,
  controlPort: index === 0 ? 8124 : 8126,
}));

// Matic Map in a real Home Assistant, paired to the simulated robot
// (tests/live/server.py). Each server holds one robot; tests run serially per mode.
export default defineConfig({
  testDir: "./tests/live",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:8123",
    trace: "off",
  },
  projects: instances.map(({ mode, port }) => ({
    name: pushModes.length > 1 ? `chromium-workspace-push-${mode}` : "chromium",
    use: {
      ...devices["Desktop Chrome"],
      baseURL: `http://127.0.0.1:${port}`,
      workspacePushMode: mode,
    },
  })),
  webServer: instances.map(({ mode, port, controlPort }) => ({
    command: `${shellQuote(python)} tests/live/server.py --port ${port} --control-port ${controlPort} --workspace-push ${mode}`,
    // The panel route exists once the integration has registered it.
    url: `http://127.0.0.1:${port}/matic-map`,
    reuseExistingServer: false,
    timeout: 180_000,
  })),
});
