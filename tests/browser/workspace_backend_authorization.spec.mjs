import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { MaticBackend } from "./frontend/map-studio-v4/backend";', resolveDir: process.cwd() },
  bundle: true, format: "esm", write: false,
});

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Workspace backend authorization runs once in Chromium");
  await page.route("**/workspace-backend-auth.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/");
});

for (const operation of ["plans", "areas", "history", "scene"]) {
  for (const status of [401, 403]) {
    test(`${operation} HTTP ${status} notifies the current access owner`, async ({ page }) => {
      const result = await page.evaluate(async ({ operation, status }) => {
        const { MaticBackend } = await import("/workspace-backend-auth.js");
        const hass = { user: { id: "user-a" }, connection: {},
          fetchWithAuth: async () => new Response(null, { status }) };
        const backend = new MaticBackend(() => hass);
        let denied = 0;
        backend.setAccessDeniedHandler(() => { denied += 1; });
        const error = await (operation === "scene"
          ? backend.scene("/api/matic_robot/scene", 7, true, "live")
          : backend[operation](`/api/matic_robot/${operation}`)).catch(error => error);
        backend.dispose();
        return { denied, status: error.status };
      }, { operation, status });
      expect(result).toEqual({ denied: 1, status });
    });
  }
}

for (const boundary of ["abort", "dispose", "user", "connection", "owner epoch"]) {
  test(`late HTTP 403 cannot revoke access after ${boundary}`, async ({ page }) => {
    const result = await page.evaluate(async boundary => {
      const { MaticBackend } = await import("/workspace-backend-auth.js");
      let respond;
      let hass = { user: { id: "user-a" }, connection: {},
        fetchWithAuth: async () => await new Promise(resolve => { respond = resolve; }) };
      const backend = new MaticBackend(() => hass);
      let denied = 0;
      backend.setAccessDeniedHandler(() => { denied += 1; });
      const controller = new AbortController();
      const pending = backend.plans("/api/matic_robot/plans", controller.signal).catch(() => {});
      if (boundary === "abort") controller.abort();
      if (boundary === "dispose") backend.dispose();
      if (boundary === "user") hass = { ...hass, user: { id: "user-b" } };
      if (boundary === "connection") hass = { ...hass, connection: {} };
      // An entry switch or a new authority episode can keep the same HA user.
      if (boundary === "owner epoch") backend.setAccessDeniedHandler(() => { denied += 100; });
      respond(new Response(null, { status: 403 }));
      await pending;
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
      backend.dispose();
      return denied;
    }, boundary);
    expect(result).toBe(0);
  });
}

for (const operation of ["preview", "service"]) {
  for (const boundary of ["current", "user", "owner epoch", "dispose", ...(operation === "preview" ? ["abort"] : [])]) {
    test(`${operation} RPC denial reports only the current owner (${boundary})`, async ({ page }) => {
      const denied = await page.evaluate(async ({ operation, boundary }) => {
        const { MaticBackend } = await import("/workspace-backend-auth.js");
        let rejectWire;
        const wire = () => new Promise((_resolve, reject) => { rejectWire = reject; });
        let hass = { user: { id: "user-a" }, connection: { sendMessagePromise: wire }, callService: wire };
        const backend = new MaticBackend(() => hass);
        let denied = 0;
        backend.setAccessDeniedHandler(() => { denied += 1; });
        const controller = new AbortController();
        const pending = (operation === "preview"
          ? backend.previewRoomSequence("vacuum.synthetic", [{ room: "Kitchen", cleaning_mode: "both", coverage_setting: "optimal" }], false, controller.signal)
          : backend.service("matic_robot", "set_deep_mop", {}, "vacuum.synthetic")).catch(() => {});
        for (let tick = 0; tick < 100 && !rejectWire; tick += 1) await Promise.resolve();
        if (!rejectWire) throw new Error("RPC was not started");
        if (boundary === "user") hass = { ...hass, user: { id: "user-b" } };
        if (boundary === "owner epoch") backend.setAccessDeniedHandler(() => { denied += 100; });
        if (boundary === "dispose") backend.dispose();
        if (boundary === "abort") controller.abort();
        rejectWire({ code: "unauthorized" });
        await pending;
        backend.dispose();
        return denied;
      }, { operation, boundary });
      expect(denied).toBe(boundary === "current" ? 1 : 0);
    });
  }
}

for (const operation of ["preview", "service"]) {
  for (const retired of [false, true]) {
    test(`late ${operation} denial after its deadline respects owner retirement (${retired})`, async ({ page }) => {
      await page.clock.install();
      await page.evaluate(async operation => {
        const { MaticBackend } = await import("/workspace-backend-auth.js");
        let rejectWire;
        const wire = () => new Promise((_resolve, reject) => { rejectWire = reject; });
        const hass = { user: { id: "user-a" }, connection: { sendMessagePromise: wire }, callService: wire };
        const backend = new MaticBackend(() => hass);
        let denied = 0, settled = false;
        backend.setAccessDeniedHandler(() => { denied += 1; });
        const pending = operation === "preview"
          ? backend.previewRoomSequence("vacuum.synthetic", [{ room: "Kitchen", cleaning_mode: "both", coverage_setting: "optimal" }], false)
          : backend.service("matic_robot", "set_deep_mop", {}, "vacuum.synthetic", { acknowledgementTimeout: "mutation" });
        void pending.catch(() => { settled = true; });
        for (let tick = 0; tick < 100 && !rejectWire; tick += 1) await Promise.resolve();
        if (!rejectWire) throw new Error("RPC was not started");
        window.lateBackend = { backend, rejectWire, get denied() { return denied; }, get settled() { return settled; } };
      }, operation);
      await page.clock.fastForward(operation === "preview" ? 15_001 : 20_001);
      await expect.poll(() => page.evaluate(() => window.lateBackend.settled)).toBe(true);
      await page.evaluate(async retired => {
        const h = window.lateBackend;
        if (retired) h.backend.setAccessDeniedHandler(() => { throw new Error("retired request reached new owner"); });
        h.rejectWire({ code: "unauthorized" });
        for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
      }, retired);
      expect(await page.evaluate(() => window.lateBackend.denied)).toBe(retired ? 0 : 1);
      await page.evaluate(() => window.lateBackend.backend.dispose());
    });
  }
}
