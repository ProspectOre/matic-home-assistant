import { test as base } from "@playwright/test";

// Reuse one page in an isolated context to keep the trusted-network session
// active across this serial simulator suite.
export const test = base.extend({
  sharedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      await use(context);
      await context.close();
    },
    { scope: "worker" },
  ],
  context: async ({ sharedContext }, use) => {
    await use(sharedContext);
  },
  sharedPage: [
    async ({ sharedContext }, use) => {
      const page = await sharedContext.newPage();
      await use(page);
      await page.close();
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
