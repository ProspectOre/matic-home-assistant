import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(testDirectory, "..", "..");
const isFile = (path) => Boolean(path && statSync(path, { throwIfNoEntry: false })?.isFile());
const scripts = new Map([
  [
    "/matic_icons.js",
    join(repositoryRoot, "custom_components", "matic_robot", "matic_icons.js"),
  ],

]);

/**
 * The synthetic test and review server: the audit/review harness, the B2
 * mockups and the owner walkthrough stage, plus the bundles they load. It
 * never talks to Home Assistant or a robot. `server.mjs` listens on
 * 127.0.0.1:4173 for Playwright; `scripts/stage_walkthrough.mjs` starts its own.
 */
export function createGalleryServer() {
  return createServer((request, response) => {
    const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (path === "/map-studio-v4-audit" || path === "/map-studio-v4-review") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="description" content="Synthetic private Map Studio accessibility and performance harness.">
      <title>Synthetic Matic test harness — not live Home Assistant</title>
      <style>html, body { height: 100%; margin: 0; }</style>
    </head>
    <body>
      <aside style="padding:6px 12px;background:#fff3cd;color:#513d00;font:13px system-ui" role="note">Synthetic test harness — not live Home Assistant. No robot is connected.</aside>
      <script type="module">
        import "/map_studio_v4-review/review.js";
        await customElements.whenDefined("matic-map-studio-gallery-v0-4-0");
        const gallery = document.createElement("matic-map-studio-gallery-v0-4-0");
        gallery.controls = ${path === "/map-studio-v4-review"};
        gallery.scenario = "ready";
        document.body.append(gallery);
      </script>
    </body>
  </html>`);
      return;
    }
    if (path === "/map-studio-v4-mockups") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="description" content="Synthetic Map Studio 0.5 mockups for design sign-off.">
      <title>Synthetic Matic mockups — not live Home Assistant</title>
      <style>html, body { height: 100%; margin: 0; }</style>
    </head>
    <body>
      <aside style="padding:6px 12px;background:#fff3cd;color:#513d00;font:13px system-ui" role="note">Synthetic test harness — not live Home Assistant. No robot is connected.</aside>
      <script type="module">
        import "/map_studio_v4-review/mockups.js";
        await customElements.whenDefined("matic-map-studio-mockups");
        document.body.append(document.createElement("matic-map-studio-mockups"));
      </script>
    </body>
  </html>`);
      return;
    }
    if (path === "/map-studio-v4-stage" || path === "/map-studio-v4-stage-frame") {
      const frame = path === "/map-studio-v4-stage-frame";
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="description" content="Synthetic Matic Map stage for the owner walkthrough.">
      <title>${frame ? "Staged Matic Map (synthetic)" : "Owner walkthrough stage (synthetic, not live Home Assistant)"}</title>
      <style>html, body { min-height: 100%; margin: 0; }</style>
    </head>
    <body>
      <script type="module">
        import("/map_studio_v4-review/stage.js")
          .catch(() => {
            throw new Error("The review bundle has no stage. Run npm run build:map-studio-v4, then reload.");
          })
          .then((stage) => stage.${frame ? "mountStageFrame" : "mountStagePage"}(document))
          .catch((error) => {
            const alert = document.createElement("p");
            alert.setAttribute("role", "alert");
            alert.textContent = String(error?.message ?? error);
            document.body.append(alert);
          });
      </script>
    </body>
  </html>`);
      return;
    }
    if (path === "/map-studio-v4-stage/strings.json") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      createReadStream(join(repositoryRoot, "custom_components", "matic_robot", "strings.json"))
        .on("error", () => response.destroy())
        .pipe(response);
      return;
    }
    if (path === "/" || path === "/health") {
      response.writeHead(200, {
        "Content-Type": path === "/" ? "text/html; charset=utf-8" : "text/plain",
        "Cache-Control": "no-store",
      });
      response.end(path === "/"
        ? "<!doctype html><html lang=\"en\"><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Matic UI test</title></head><body></body></html>"
        : "ok");
      return;
    }
    let file = scripts.get(path);
    if (path.startsWith("/map_studio_v4/")) {
      const root = join(repositoryRoot, "custom_components", "matic_robot", "map_studio_v4");
      const candidate = normalize(join(root, path.slice("/map_studio_v4/".length)));
      if (candidate.startsWith(`${root}${sep}`)) file = candidate;
    }
    if (path.startsWith("/map_studio_v4-review/")) {
      const relativePath = path.slice("/map_studio_v4-review/".length);
      for (const root of [
        join(repositoryRoot, "custom_components", "matic_robot", "map_studio_v4"),
        join(testDirectory, ".generated", "map-studio-v4-review"),
      ]) {
        const candidate = normalize(join(root, relativePath));
        if (candidate.startsWith(`${root}${sep}`) && isFile(candidate)) {
          file = candidate;
          break;
        }
      }
    }
    const versionedV4 = path.match(
      /^\/matic_robot\/[^/]+-[a-f0-9]{12}\/map-studio-v4\/(.+)$/u,
    );
    if (versionedV4) {
      const root = join(repositoryRoot, "custom_components", "matic_robot", "map_studio_v4");
      const candidate = normalize(join(root, versionedV4[1]));
      if (candidate.startsWith(`${root}${sep}`)) file = candidate;
    }
    if (!isFile(file)) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": file.endsWith(".webp") ? "image/webp"
        : file.endsWith(".json") ? "application/json" : "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    createReadStream(file).on("error", () => response.destroy()).pipe(response);
  });
}
