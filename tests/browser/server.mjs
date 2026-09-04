import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(testDirectory, "..", "..");
const scripts = new Map([
  [
    "/matic_icons.js",
    join(repositoryRoot, "custom_components", "matic_robot", "matic_icons.js"),
  ],
  [
    "/matic_map_studio.js",
    join(repositoryRoot, "custom_components", "matic_robot", "matic_map_studio.js"),
  ],
  [
    "/room_plan_editor.js",
    join(repositoryRoot, "custom_components", "matic_robot", "room_plan_editor.js"),
  ],
]);

const server = createServer((request, response) => {
  const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
  if (path === "/map-studio-v4-audit") {
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
    <title>Matic Map Studio audit</title>
    <style>html, body { height: 100%; margin: 0; }</style>
  </head>
  <body>
    <script type="module">
      import "/map_studio_v4/index.js";
      await customElements.whenDefined("matic-map-studio-gallery-v0-4-0");
      const gallery = document.createElement("matic-map-studio-gallery-v0-4-0");
      gallery.controls = false;
      gallery.scenario = "ready";
      document.body.append(gallery);
    </script>
  </body>
</html>`);
    return;
  }
  if (path === "/" || path === "/health") {
    response.writeHead(200, {
      "Content-Type": path === "/" ? "text/html; charset=utf-8" : "text/plain",
      "Cache-Control": "no-store",
    });
    response.end(path === "/"
      ? "<!doctype html><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Matic UI test</title>"
      : "ok");
    return;
  }
  let file = scripts.get(path);
  if (path.startsWith("/map_studio_v4/")) {
    const root = join(repositoryRoot, "custom_components", "matic_robot", "map_studio_v4");
    const candidate = normalize(join(root, path.slice("/map_studio_v4/".length)));
    if (candidate === root || candidate.startsWith(`${root}${sep}`)) file = candidate;
  }
  const versionedV4 = path.match(
    /^\/matic_robot\/[^/]+-[a-f0-9]{12}\/map-studio-v4\/(.+)$/u,
  );
  if (versionedV4) {
    const root = join(repositoryRoot, "custom_components", "matic_robot", "map_studio_v4");
    const candidate = normalize(join(root, versionedV4[1]));
    if (candidate.startsWith(`${root}${sep}`)) file = candidate;
  }
  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
});

server.listen(4173, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
