import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Map Studio relies on Safari-specific native gesture events as well as
      // standard pointer input. Keep its complete suite on Desktop Safari;
      // the small mobile project below remains focused on viewport behavior.
      name: "webkit",
      testMatch: "tests/browser/map_studio_v4.spec.mjs",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-webkit",
      grep: /mobile maps touch-first|does not paint when a touch|matches native mobile/,
      use: { ...devices["iPhone 15"] },
    },
  ],
  webServer: {
    command: "node tests/browser/server.mjs",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
