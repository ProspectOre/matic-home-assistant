import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(testDirectory, "..", "..");
const scripts = new Map([
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
  const file = scripts.get(path);
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
