import { defineConfig, devices } from "@playwright/test";

const python = process.env.MATIC_E2E_PYTHON ?? process.env.PYTHON ?? "python";
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

// Matic Map in a real Home Assistant, paired to the simulated robot
// (tests/live/server.py). One server holds one robot, so tests run serially.
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${shellQuote(python)} tests/live/server.py --port 8123 --control-port 8124`,
    // The panel route exists once the integration has registered it.
    url: "http://127.0.0.1:8123/matic-map",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
