// The one definition of the Map Studio startup graph and its budget, read by
// tests/test_frontend.py and tests/browser/map_studio_v4_deferred_assets.spec.mjs.
// The graph is the icon module Home Assistant registers plus the panel entry and
// every chunk it reaches through static imports; import() targets load later.
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// 0.6 raises the 0.5.0 limit of 92 KiB once, for every 0.6 feature together.
// Before the 0.6 features, release/0.6 used 93,611 bytes; history and trail,
// the heading marker and Go to room add about 840 more, and zones and alerts
// still need a share. New views load as lazy chunks; the startup graph only
// gains the controls that must render on first paint. The lazy workflow and
// diagnostics chunks retain their separate limits.
export const STARTUP_BUDGET_BYTES = 96 * 1024;

const COMPONENT = fileURLToPath(new URL("../custom_components/matic_robot/", import.meta.url));
const STATIC_IMPORT = /(?:^|[;}\n])\s*(?:import|export)\s*(?:[\w$\s,{}*]*?from\s*)?"(\.[^"]+)"/gu;

/** Gzip size (level 9) of each startup asset, keyed by its path under custom_components/matic_robot. */
export function startupGraph() {
  const sizes = new Map();
  const visit = (path) => {
    if (sizes.has(path)) return;
    const source = readFileSync(join(COMPONENT, path));
    sizes.set(path, gzipSync(source, { level: 9 }).byteLength);
    for (const [, specifier] of source.toString("utf8").matchAll(STATIC_IMPORT)) {
      visit(posix.join(posix.dirname(path), specifier));
    }
  };
  visit("matic_icons.js");
  visit("map_studio_v4/index.js");
  return Object.fromEntries(sizes);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify({ budget: STARTUP_BUDGET_BYTES, assets: startupGraph() })}\n`);
}
