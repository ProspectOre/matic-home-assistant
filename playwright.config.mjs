import { defineConfig, devices } from "@playwright/test";

// Project selection is tag-based: tests whose title carries `@mobile` run only
// on the two mobile-device projects; everything else runs on the desktop ones.
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
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Map Studio relies on Safari-specific native gesture events as well as
      // standard pointer input. Keep its complete (non-@mobile) suite on
      // Desktop Safari; the @mobile-tagged tests below cover real device
      // viewports and touch input on both engines.
      name: "webkit",
      testMatch: "tests/browser/map_studio_v4.spec.mjs",
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-webkit",
      grep: /@mobile/,
      use: { ...devices["iPhone 15"] },
    },
    {
      name: "mobile-chrome",
      grep: /@mobile/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "node tests/browser/server.mjs",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
